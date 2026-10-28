import "dotenv/config"
import { parlyPayoutAdapterV3Abi, relayerOperatorRegistryAbi } from "@parly/protocol-abis"
import type { PublicClient } from "viem"
import {
  isPayoutV3ExecutionBroadcastEnabled,
  readPhase3PayoutV3RuntimeConfig,
  runPayoutV3ExecutionOnce,
  type RelayerOwnedOneTimeExecutionBroadcaster
} from "./index.js"
import {
  createPayoutV3ExecutionPayloadDataSource,
  createPayoutV3PreparationPayloadDataSource
} from "./execution-payload-store.js"

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>

export type PayoutV3ExecutionWorkerConfig =
  | { enabled: false; reason: "phase3_payout_v3_execution_worker_disabled" | "phase3_payout_v3_runtime_disabled" }
  | {
      enabled: true
      workerId: string
      leaseMs: number
      pollIntervalMs: number
      broadcast: boolean
      payoutAdapterV3: `0x${string}`
      relayerOperatorAddress: `0x${string}`
      operatorRegistryAddress: `0x${string}`
      executionDatabaseConfigured: true
      executionPayloadEncryptionKeyConfigured: true
      preparationPromotionLimit: number
    }

function requireAddress(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value || !/^0x[a-fA-F0-9]{40}$/u.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${name} must be a non-zero address for payout V3 execution worker.`)
  }
  return value as `0x${string}`
}

function requireEnv(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for payout V3 execution worker.`)
  return value
}

function optionalPositiveInt(env: Env, name: string, fallback: number) {
  const value = env[name]?.trim()
  if (!value) return fallback
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return Number(value)
}

function requireEncryptionKeyConfigured(env: Env) {
  const encoded = requireEnv(env, "PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) {
    throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 must decode to 32 bytes.")
  }
}

export function readPayoutV3ExecutionWorkerConfig(env: Env = process.env): PayoutV3ExecutionWorkerConfig {
  const runtime = readPhase3PayoutV3RuntimeConfig(env)
  if (!runtime.enabled) {
    return { enabled: false, reason: "phase3_payout_v3_runtime_disabled" }
  }
  if (runtime.payoutExecutionEnabled !== true) {
    return { enabled: false, reason: "phase3_payout_v3_execution_worker_disabled" }
  }
  requireEnv(env, "PHASE3_EXECUTION_DATABASE_URL")
  requireEncryptionKeyConfigured(env)
  const relayerOperatorAddress = requireAddress(env, "RELAYER_ADDRESS")
  const operatorRegistryAddress = requireAddress(env, "PARLY_RELAYER_OPERATOR_REGISTRY")
  return {
    enabled: true,
    workerId: env.PHASE3_PAYOUT_V3_EXECUTION_WORKER_ID?.trim() || relayerOperatorAddress,
    leaseMs: optionalPositiveInt(env, "PHASE3_PAYOUT_V3_EXECUTION_LEASE_MS", 30_000),
    pollIntervalMs: optionalPositiveInt(env, "PHASE3_PAYOUT_V3_EXECUTION_POLL_MS", 5_000),
    preparationPromotionLimit: optionalPositiveInt(env, "PHASE3_PAYOUT_V3_PREPARATION_PROMOTION_LIMIT", 5),
    broadcast: isPayoutV3ExecutionBroadcastEnabled(env),
    payoutAdapterV3: runtime.payoutAdapterV3,
    relayerOperatorAddress,
    operatorRegistryAddress,
    executionDatabaseConfigured: true,
    executionPayloadEncryptionKeyConfigured: true
  }
}

type PayoutV3PreparationDataSource = ReturnType<typeof createPayoutV3PreparationPayloadDataSource>

function receiptConfirmedAtFromRecord(record: unknown) {
  const keyed = record as { receiptConfirmedAt?: bigint | number | string }
  const tuple = record as readonly unknown[]
  const raw = keyed.receiptConfirmedAt ?? tuple[23] ?? 0n
  return BigInt(raw as bigint | number | string)
}

export async function promoteConfirmedPayoutV3PreparationJobs(args: {
  adapterAddress: `0x${string}`
  publicClient: PublicClient
  dataSource: PayoutV3PreparationDataSource
  limit: number
}) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) {
    throw new Error("limit must be an integer from 1 to 50.")
  }
  const candidates = await args.dataSource.listPayoutV3PreparationCandidates({ limit: args.limit })
  let inspected = 0
  let queued = 0
  for (const candidate of candidates) {
    inspected += 1
    const record = await args.publicClient.readContract({
      address: args.adapterAddress,
      abi: parlyPayoutAdapterV3Abi,
      functionName: "getPayoutRecord",
      args: [candidate.intentHash]
    })
    if (receiptConfirmedAtFromRecord(record) <= 0n) continue
    const result = await args.dataSource.promotePayoutV3PreparationToExecution({
      payoutId: candidate.payoutId,
      intentHash: candidate.intentHash,
      status: "escrow_receipt_confirmed"
    })
    if (result?.status === "queued") queued += 1
  }
  return { inspected, queued }
}

export async function runPayoutV3ExecutionWorkerOnce(args: {
  config: Extract<PayoutV3ExecutionWorkerConfig, { enabled: true }>
  publicClient: PublicClient
  dataSource?: Parameters<typeof runPayoutV3ExecutionOnce>[0]["dataSource"]
  preparationDataSource?: PayoutV3PreparationDataSource
  env?: Env
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
}) {
  const dataSource = args.dataSource ?? createPayoutV3ExecutionPayloadDataSource()
  const preparationDataSource = args.preparationDataSource ?? createPayoutV3PreparationPayloadDataSource()
  await promoteConfirmedPayoutV3PreparationJobs({
    adapterAddress: args.config.payoutAdapterV3,
    publicClient: args.publicClient,
    dataSource: preparationDataSource,
    limit: args.config.preparationPromotionLimit
  })
  return runPayoutV3ExecutionOnce({
    adapterAddress: args.config.payoutAdapterV3,
    dataSource,
    eligibilityReader: {
      async isEligibleOperatorFor(operatorAddress, capability) {
        return (await args.publicClient.readContract({
          address: args.config.operatorRegistryAddress,
          abi: relayerOperatorRegistryAbi,
          functionName: "isEligibleOperatorFor",
          args: [operatorAddress, capability]
        })) as boolean
      }
    },
    relayerOperatorAddress: args.config.relayerOperatorAddress,
    workerId: args.config.workerId,
    leaseMs: args.config.leaseMs,
    broadcast: args.config.broadcast,
    env: args.env ?? process.env,
    broadcaster: args.broadcaster
  })
}

export function startPayoutV3ExecutionWorkerLoop(args: {
  config?: PayoutV3ExecutionWorkerConfig
  publicClient: PublicClient
  dataSource?: Parameters<typeof runPayoutV3ExecutionOnce>[0]["dataSource"]
  preparationDataSource?: PayoutV3PreparationDataSource
  env?: Env
  logger?: Pick<Console, "info" | "error">
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
}) {
  const logger = args.logger ?? console
  const config = args.config ?? readPayoutV3ExecutionWorkerConfig(args.env ?? process.env)
  if (!config.enabled) {
    logger.info(`[phase3-payout-v3-execution] ${config.reason}`)
    return { started: false as const, reason: config.reason }
  }

  const tick = async () => {
    try {
      const result = await runPayoutV3ExecutionWorkerOnce({
        config,
        publicClient: args.publicClient,
        dataSource: args.dataSource,
        preparationDataSource: args.preparationDataSource,
        env: args.env ?? process.env,
        broadcaster: args.broadcaster
      })
      if (result.status !== "idle") {
        logger.info(`[phase3-payout-v3-execution] ${result.status} payout=${result.payoutId} broadcast=${result.broadcast}`)
      }
    } catch (error) {
      logger.error(`[phase3-payout-v3-execution] ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  void tick()
  const interval = setInterval(() => {
    void tick()
  }, config.pollIntervalMs)
  return {
    started: true as const,
    broadcast: config.broadcast,
    workerId: config.workerId,
    stop() {
      clearInterval(interval)
    }
  }
}
