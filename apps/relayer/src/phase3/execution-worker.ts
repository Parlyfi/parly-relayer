import "dotenv/config"
import {
  isRelayerOwnedOneTimeExecutionBroadcastEnabled,
  type RelayerOwnedOneTimeExecutionBroadcaster,
  runRelayerOwnedOneTimeExecutionOnce
} from "./index.js"
import { createRelayerOwnedExecutionPayloadDataSource } from "./execution-payload-store.js"
import { parseReceivingProfileV4, receivingProfileJsonV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { createReceivingFundedWorkerV4 } from "./receiving-funded-worker-v4.js"

type ReceivingBindingsV4 = NonNullable<Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["receivingV4"]> & {
  sourcePool: Parameters<typeof createReceivingFundedWorkerV4>[0]["pool"]
  fundedHost: Parameters<typeof createReceivingFundedWorkerV4>[0]["host"]
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>

function requireReceivingBindingsV4(raw: string, bindings?: ReceivingBindingsV4) {
  const profile = parseReceivingProfileV4(raw)
  if (!bindings || receivingProfileJsonV4(profile) !== receivingProfileJsonV4(bindings.profile)
    || [bindings.refreshFinalization, bindings.executeTransaction, bindings.sourcePool?.connect,
      bindings.fundedHost?.assertFunded, bindings.fundedHost?.prepare, bindings.fundedHost?.assertPrepared].some(fn => typeof fn !== "function")) {
    throw Error("V4 confirmed-funding host and durable execution bindings are required.")
  }
  return profile
}

export type RelayerOwnedExecutionWorkerConfig =
  | { enabled: false; reason: "phase3_relayer_owned_execution_worker_disabled" }
  | {
      enabled: true
      workerId: string
      leaseMs: number
      pollIntervalMs: number
      broadcast: boolean
      executionDatabaseConfigured: true
      executionPayloadEncryptionKeyConfigured: true
    }

function requireEnv(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for relayer-owned execution worker.`)
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

export function readRelayerOwnedExecutionWorkerConfig(
  env: Env = process.env
): RelayerOwnedExecutionWorkerConfig {
  if (env.PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_relayer_owned_execution_worker_disabled" }
  }
  requireEnv(env, "PHASE3_EXECUTION_DATABASE_URL")
  requireEncryptionKeyConfigured(env)
  const workerId = env.PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ID?.trim() || requireEnv(env, "RELAYER_ADDRESS")
  return {
    enabled: true,
    workerId,
    leaseMs: optionalPositiveInt(env, "PHASE3_RELAYER_OWNED_EXECUTION_LEASE_MS", 30_000),
    pollIntervalMs: optionalPositiveInt(env, "PHASE3_RELAYER_OWNED_EXECUTION_POLL_MS", 5_000),
    broadcast: isRelayerOwnedOneTimeExecutionBroadcastEnabled(env as NodeJS.ProcessEnv),
    executionDatabaseConfigured: true,
    executionPayloadEncryptionKeyConfigured: true
  }
}

export async function runRelayerOwnedExecutionWorkerOnce(args: {
  config: Extract<RelayerOwnedExecutionWorkerConfig, { enabled: true }>
  dataSource?: Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["dataSource"]
  env?: NodeJS.ProcessEnv
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
  logger?: Pick<Console, "error">
  refreshReceivingFinalization?:Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["refreshReceivingFinalization"]
  executeReceivingFinalization?:Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["executeReceivingFinalization"]
  receivingV4?: ReceivingBindingsV4
}) {
  const env = args.env ?? process.env, raw = env.PHASE3_RECEIVING_V4_PROFILE_JSON
  if (raw) {
    const profile = requireReceivingBindingsV4(raw, args.receivingV4), bindings = args.receivingV4!
    const funded = createReceivingFundedWorkerV4({ pool: bindings.sourcePool, profile, host: bindings.fundedHost, workerId: args.config.workerId, leaseMs: args.config.leaseMs })
    if (args.config.broadcast) {
      try { await funded.runOnce() }
      catch { (args.logger ?? console).error("[phase3-relayer-owned-execution] confirmed-funded V4 preparation unavailable") }
    }
  } else if (args.receivingV4) throw Error("V4 worker profile must be selected explicitly.")
  const dataSource = args.dataSource ?? createRelayerOwnedExecutionPayloadDataSource()
  return runRelayerOwnedOneTimeExecutionOnce({
    dataSource,
    workerId: args.config.workerId,
    leaseMs: args.config.leaseMs,
    broadcast: args.config.broadcast,
    env: args.env ?? process.env,
    broadcaster: args.broadcaster,
    refreshReceivingFinalization: args.refreshReceivingFinalization,
    executeReceivingFinalization: args.executeReceivingFinalization,
    receivingV4: args.receivingV4
  })
}

export function startRelayerOwnedExecutionWorkerLoop(args: {
  config?: RelayerOwnedExecutionWorkerConfig
  dataSource?: Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["dataSource"]
  env?: NodeJS.ProcessEnv
  logger?: Pick<Console, "info" | "error">
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
  refreshReceivingFinalization?:Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["refreshReceivingFinalization"]
  executeReceivingFinalization?:Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["executeReceivingFinalization"]
  receivingV4?: ReceivingBindingsV4
} = {}) {
  const logger = args.logger ?? console
  const config = args.config ?? readRelayerOwnedExecutionWorkerConfig(args.env ?? process.env)
  if (!config.enabled) {
    logger.info(`[phase3-relayer-owned-execution] ${config.reason}`)
    return { started: false as const, reason: config.reason }
  }
  const raw = (args.env ?? process.env).PHASE3_RECEIVING_V4_PROFILE_JSON
  if (raw) {
    requireReceivingBindingsV4(raw, args.receivingV4)
  } else if (args.receivingV4) throw Error("V4 worker profile must be selected explicitly.")

  let tickRunning = false
  const tick = async () => {
    if (args.receivingV4 && tickRunning) return
    tickRunning = true
    try {
      const result = await runRelayerOwnedExecutionWorkerOnce({
        config,
        dataSource: args.dataSource,
        env: args.env ?? process.env,
        broadcaster: args.broadcaster,
        logger,
        refreshReceivingFinalization: args.refreshReceivingFinalization,
        executeReceivingFinalization: args.executeReceivingFinalization,
        receivingV4: args.receivingV4
      })
      if (result.status !== "idle") {
        logger.info(
          `[phase3-relayer-owned-execution] ${result.status} job=${result.jobId} broadcast=${result.broadcast}`
        )
      }
    } catch (error) {
      logger.error(
        `[phase3-relayer-owned-execution] ${error instanceof Error ? error.message : String(error)}`
      )
    } finally { tickRunning = false }
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
