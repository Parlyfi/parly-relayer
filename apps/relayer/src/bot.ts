import "dotenv/config"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { requireEnv, requirePositiveInt } from "@parly/env-utils"
import {
  POOL_ABI,
  parlyPayoutAdapterV4Abi,
  parlyPayoutAdapterV5Abi,
  parlyPayoutAdapterV6Abi,
  parlyPayoutWithdrawalExecutorAbi,
  parlyPayoutWithdrawalExecutorV2Abi,
  relayerOperatorRegistryAbi,
  tempoShieldedPoolV2Abi,
  tempoShieldedPoolV3Abi
} from "@parly/protocol-abis"
import {
  MAX_RELAY_CIPHER_BUNDLE_BYTES,
  type CanonicalRelayExecutionPayload,
  type RelayCipherBundle
} from "@parly/shared-types"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { safeApproveExactRelayer } from "./erc20.js"
import { requirePhase3BroadcastEnabled } from "./phase3-broadcast-gate.js"
import { startRelayerOwnedExecutionWorkerLoop } from "./phase3/execution-worker.js"
import { createReceivingBotHostV4 } from "./phase3/receiving-bot-host-v4.js"
import { startPayoutV7ExecutionLoop } from "./phase3/payout-v7-runtime.js"
import {
  poolV3ActiveNullifiers,
  preparePoolV3Transaction,
  readPoolV3RuntimeConfig,
  redactRelayerRuntimeError,
  validatePoolV3ProofPayload
} from "./phase3/pool-v3-runtime.js"
import {
  buildSignedRelayExecutionFeeSchedulesV2,
  readRelayExecutionFeeScheduleTemplatesV2,
  validateRelayExecutionFeeScheduleV2
} from "./phase3/relay-execution-fee-schedule-v2.js"
import { costCoveringRelayReward, requireCostCoveredRelayReward } from "./phase3/relay-reward.js"
import { readRelayRewardPolicyV4, relayRewardPolicyTargetV4 } from "@parly/protocol-abis/relay-reward-policy-v4"
import { assertPoolV4ExecutionReady, poolV4ActiveNullifiers, preparePoolV4Transaction, readPoolV4CanonicalReceipt, readPoolV4RuntimeConfig, validatePoolV4ProofPayload } from "./phase3/pool-v4-runtime.js"
import {
  isPayoutV4ExecutionBroadcastEnabled,
  preparePayoutV4AcceptQuoteTransaction,
  preparePayoutV4AcceptQuoteTransactionFromAuthority,
  preparePayoutV4CompletePayoutTransaction,
  preparePayoutV4ConfirmEscrowReceiptTransaction,
  preparePayoutV4SubmitPayoutTransaction,
  preparePayoutV6WithdrawalTransaction,
  claimPayoutV6Execution,
  listPayoutV6ReadyJobs,
  readPayoutV6AuthorityClientConfig,
  runPayoutV6CheckpointedExecution,
  runPayoutV6DownstreamExecution,
  type PayoutV4ProvenanceAttestationPayload,
  type PayoutV4RelayerAuthorityPayload,
  validatePayoutV4PrivateBundleBinding,
  validatePayoutV4PrivateBundleBindings,
  validatePayoutV4RelayerAuthorityForBinding
} from "./phase3/index.js"
import {
  claimPayoutV4RelayerAuthority,
  readPayoutV4RelayerAuthorityClientConfig,
  recordPayoutV4RelayerCheckpoint
} from "./phase3/payout-v4-authority-client.js"
import {
  claimPayoutV5Execution,
  listPayoutV5DownstreamJobs,
  listPayoutV5ReadyJobs,
  readPayoutV5AuthorityClientConfig,
  recordPayoutV5Checkpoint
} from "./phase3/payout-v5-authority-client.js"
import { observePayoutV5RelayStatus } from "./phase3/payout-v5-status-worker.js"
import { runPayoutV5CheckpointedExecution } from "./phase3/payout-v5-checkpointed-worker.js"
import { runPayoutV5BatchCheckpointedExecution } from "./phase3/payout-v5-batch-worker.js"
import { runPayoutV5DownstreamExecution } from "./phase3/payout-v5-downstream-worker.js"
import { runPayoutV4CheckpointedExecution } from "./phase3/payout-v4-checkpointed-worker.js"
import { runPayoutV4BatchCheckpointedExecution } from "./phase3/payout-v4-batch-worker.js"
import { runPayoutV4DownstreamExecution } from "./phase3/payout-v4-downstream-worker.js"
import {
  readPayoutV4AttesterClientConfig,
  readPayoutV4ProofQuorum,
  requestPayoutV4ProofAttestation,
  requestPayoutV4Provenance
} from "./phase3/payout-v4-attester-client.js"
import {
  readPayoutV5AttesterClientConfig,
  readPayoutV5ProofQuorum,
  readPayoutV5RefundQuorum,
  requestPayoutV5ProofAttestation,
  requestPayoutV5RefundAttestation,
  requestPayoutV5Provenance,
  readPayoutV6AttesterClientConfig,
  readPayoutV6RefundQuorum,
  requestPayoutV6ProofAttestation,
  requestPayoutV6Provenance,
  requestPayoutV6RefundAttestation
} from "./phase3/payout-v4-attester-client.js"
import { startPayoutV3ExecutionWorkerLoop } from "./phase3/payout-execution-worker.js"
import {
  claimRelayInboxBatch,
  enqueueRelayInboxBundle,
  getPayoutV4LocalCheckpoint,
  getPayoutV5LocalCheckpoint,
  getPayoutV6LocalCheckpoint,
  listPayoutV6DownstreamCheckpoints,
  listPayoutV4LocalSubmissions,
  listPayoutV5LocalSubmissions,
  listPayoutV6LocalSubmissions,
  markRelayInboxProcessed,
  persistPendingExecution,
  recordPayoutV4LocalCheckpoint,
  recordPayoutV4LocalSubmission,
  recordPayoutV5LocalCheckpoint,
  recordPayoutV5LocalSubmission,
  recordPayoutV6LocalCheckpoint,
  recordPayoutV6LocalSubmission,
  resetRelayInboxClaim,
  retainPoolV4RelayExecution,
  recordPoolV4RelaySubmission,
  type PendingRelayerRecord
} from "./pending-store.js"
import { postRelayerHeartbeat } from "./registry-heartbeat.js"
import { ensureRelayerRegistryRegistration } from "./registry-registration.js"
import { startWakuRelay } from "./waku.js"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const

class RelayInboxDeferredError extends Error {
  readonly retryAfterSeconds: number

  constructor(message: string, retryAfterSeconds: number) {
    super(message)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function assertTempoOnlyRelayerProductionEnv() {
  if (process.env.PARLY_ENV !== "mainnet" && process.env.NEXT_PUBLIC_PARLY_ENV !== "mainnet") {
    return
  }

  throw new Error(
    "Tempo mainnet relayer startup is intentionally fail-closed until explicit mainnet env validation replaces the staging-locked runtime."
  )
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length")
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("Invalid hex value")
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error("Invalid hex byte")
    out[i] = byte
  }
  return out
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)
}

function shortId(value: string | null | undefined) {
  if (!value) return "unknown"
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
}

function isUint32Number(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}

function isHexTuple2(value: unknown): value is [`0x${string}`, `0x${string}`] {
  return Array.isArray(value) && value.length === 2 && value.every(isHexString)
}

function isHexTuple2x2(
  value: unknown
): value is [[`0x${string}`, `0x${string}`], [`0x${string}`, `0x${string}`]] {
  return Array.isArray(value) && value.length === 2 && value.every(isHexTuple2)
}

type VersionedRelayCipherBundle = Omit<RelayCipherBundle, "version"> & { version: 1 | 2 }

function isRelayCipherBundle(x: unknown): x is VersionedRelayCipherBundle {
  return (
    !!x &&
    typeof x === "object" &&
    ((x as any).version === 1 || (x as any).version === 2) &&
    (((x as any).version === 1 &&
      ((x as any).launchScope === "tempo-only" ||
        (x as any).launchScope === "phase3-mainnet")) ||
      ((x as any).version === 2 && (x as any).launchScope === "phase3-mainnet")) &&
    typeof (x as any).relayerAddress === "string" &&
    isAddress((x as any).relayerAddress as `0x${string}`) &&
    isHexString((x as any).ciphertext)
  )
}

function isPayoutV4BundleBinding(value: unknown) {
  if (!value || typeof value !== "object") return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.intentHash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(binding.intentHash) &&
    typeof binding.adapter === "string" && isAddress(binding.adapter as Address) &&
    typeof binding.escrow === "string" && isAddress(binding.escrow as Address) &&
    typeof binding.amountIn === "string" && /^(?:[1-9][0-9]*)$/u.test(binding.amountIn) &&
    typeof binding.payoutAuthority === "string" && isAddress(binding.payoutAuthority as Address)
  )
}

function isPayoutV4BatchBinding(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 10 &&
    value.every(isPayoutV4BundleBinding)
  )
}

function isPayoutV5WithdrawalBinding(value: unknown) {
  if (!value || typeof value !== "object") return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.intentHash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(binding.intentHash) &&
    typeof binding.adapter === "string" && isAddress(binding.adapter as Address) &&
    typeof binding.withdrawalExecutor === "string" && isAddress(binding.withdrawalExecutor as Address) &&
    typeof binding.escrow === "string" && isAddress(binding.escrow as Address) &&
    typeof binding.amountIn === "string" && /^(?:[1-9][0-9]*)$/u.test(binding.amountIn) &&
    typeof binding.executorFee === "string" && /^(?:0|[1-9][0-9]*)$/u.test(binding.executorFee)
  )
}

function isPayoutV5BatchBinding(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10 || !value.every(isPayoutV5WithdrawalBinding)) {
    return false
  }
  const bindings = value as Array<Record<string, string>>
  return (
    new Set(bindings.map((binding) => binding.intentHash.toLowerCase())).size === bindings.length &&
    new Set(bindings.map((binding) => getAddress(binding.escrow).toLowerCase())).size === bindings.length &&
    new Set(bindings.map((binding) => getAddress(binding.adapter).toLowerCase())).size === 1 &&
    new Set(bindings.map((binding) => getAddress(binding.withdrawalExecutor).toLowerCase())).size === 1
  )
}

function hasExactPayoutBindingShape(payload: CanonicalRelayExecutionPayload) {
  return [payload.payoutV4, payload.payoutV4Batch, payload.payoutV5, payload.payoutV5Batch]
    .filter((binding) => binding !== undefined).length <= 1
}

function hasPayoutV4Binding(payload: CanonicalRelayExecutionPayload) {
  return Boolean(payload.payoutV4 || payload.payoutV4Batch)
}

function payoutV4IntentHashes(payload: CanonicalRelayExecutionPayload) {
  if (payload.payoutV4) return [payload.payoutV4.intentHash.toLowerCase() as Hex]
  return (payload.payoutV4Batch ?? []).map((binding) => binding.intentHash.toLowerCase() as Hex)
}

function isCanonicalPayload(x: any): x is CanonicalRelayExecutionPayload {
  return (
    x &&
    typeof x.pool === "string" &&
    isAddress(x.pool) &&
    isHexTuple2(x.pA) &&
    isHexTuple2x2(x.pB) &&
    isHexTuple2(x.pC) &&
    Array.isArray(x.pubSignals) &&
    x.pubSignals.length === 50 &&
    x.pubSignals.every(isDecimalString) &&
    Array.isArray(x.recipients) &&
    x.recipients.length === 10 &&
    x.recipients.every((a: unknown) => typeof a === "string" && isAddress(a as `0x${string}`)) &&
    Array.isArray(x.amounts) &&
    x.amounts.length === 10 &&
    x.amounts.every(isDecimalString) &&
    Array.isArray(x.destEids) &&
    x.destEids.length === 10 &&
    x.destEids.every(isUint32Number) &&
    Array.isArray(x.lzOptions) &&
    x.lzOptions.length === 10 &&
    x.lzOptions.every(isHexString) &&
    isHexString(x.newChangeCommitment) &&
    isHexString(x.newChangeEnvelope) &&
    (x.payoutV4 === undefined || isPayoutV4BundleBinding(x.payoutV4)) &&
    (x.payoutV4Batch === undefined || isPayoutV4BatchBinding(x.payoutV4Batch)) &&
    (x.payoutV5 === undefined || isPayoutV5WithdrawalBinding(x.payoutV5)) &&
    (x.payoutV5Batch === undefined || isPayoutV5BatchBinding(x.payoutV5Batch)) &&
    hasExactPayoutBindingShape(x)
  )
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  const value = Number(raw ?? String(fallback))
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} invalid`)
  }
  return value
}

function isRetryablePreSubmitError(error: unknown): boolean {
  const message = String((error as any)?.message || error).toLowerCase()
  return (
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("temporar") ||
    message.includes("503") ||
    message.includes("429") ||
    message.includes("gateway timeout") ||
    message.includes("connection")
  )
}

assertTempoOnlyRelayerProductionEnv()

const tempoRpcUrl = requireEnv("TEMPO_RPC_URL")
const tempoChainId = requirePositiveInt("TEMPO_CHAIN_ID")
const relayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY") as `0x${string}`

const tempo = defineChain({
  id: tempoChainId,
  name: "Tempo",
  nativeCurrency: { name: "TMP", symbol: "TMP", decimals: 18 },
  rpcUrls: {
    default: { http: [tempoRpcUrl] }
  }
})

const account = privateKeyToAccount(relayerPrivateKey)
const relayerAddressEnv = String(process.env.RELAYER_ADDRESS || "").toLowerCase()
const preSubmitRetryLimit = parseNonNegativeInt(
  process.env.RELAYER_PRE_SUBMIT_RETRY_LIMIT,
  2,
  "RELAYER_PRE_SUBMIT_RETRY_LIMIT"
)
const preSubmitRetryBackoffMs = parseNonNegativeInt(
  process.env.RELAYER_PRE_SUBMIT_RETRY_BACKOFF_MS,
  1500,
  "RELAYER_PRE_SUBMIT_RETRY_BACKOFF_MS"
)
const receiptTimeoutMs = parseNonNegativeInt(
  process.env.RELAYER_RECEIPT_TIMEOUT_MS,
  300000,
  "RELAYER_RECEIPT_TIMEOUT_MS"
)
const maxPayloadBytes = Math.min(
  parseNonNegativeInt(
    process.env.RELAYER_MAX_PAYLOAD_BYTES,
    MAX_RELAY_CIPHER_BUNDLE_BYTES,
    "RELAYER_MAX_PAYLOAD_BYTES"
  ),
  MAX_RELAY_CIPHER_BUNDLE_BYTES
)
const inboxPollIntervalMs = parseNonNegativeInt(
  process.env.RELAYER_INBOX_POLL_INTERVAL_MS,
  3000,
  "RELAYER_INBOX_POLL_INTERVAL_MS"
)
const registrySyncIntervalMs = parseNonNegativeInt(
  process.env.RELAYER_REGISTRY_SYNC_INTERVAL_MS,
  60000,
  "RELAYER_REGISTRY_SYNC_INTERVAL_MS"
)

const publicClient = createPublicClient({
  chain: tempo,
  transport: http(tempoRpcUrl)
})

const walletClient = createWalletClient({
  account,
  chain: tempo,
  transport: http(process.env.TEMPO_RPC_URL)
})

async function readCrossChainFeeFundingToken(poolAddress: Address): Promise<Address> {
  try {
    return (await publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "lzFeeFundingToken"
    })) as Address
  } catch {
    return (await publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "lzFeeToken"
    })) as Address
  }
}

const seenNullifiers = new Set<string>()
const inFlightNullifiers = new Set<string>()
const inFlightPayoutV4Intents = new Set<string>()

const preparedTransactionBroadcaster = {
  async broadcastPreparedTransaction(
    tx: { to: Address; data: `0x${string}` },
    options?: {
      gasPrice?: bigint
      onSubmitted?: (transactionHash: Hex) => Promise<void>
    }
  ) {
    const hash = await walletClient.sendTransaction({
      account,
      chain: tempo,
      to: tx.to,
      data: tx.data,
      ...(options?.gasPrice === undefined ? {} : { gasPrice: options.gasPrice })
    })
    await options?.onSubmitted?.(hash)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    return {
      hash,
      status: receipt.status === "success" ? "success" as const : "reverted" as const
    }
  }
}

async function syncRelayerRegistryKey() {
  try {
    const registrySync = await ensureRelayerRegistryRegistration(account)
    if (!registrySync.checked) {
      return
    }

    if (registrySync.updated) {
      console.log("Relayer registry key synced to the active box key.")
    } else {
      console.log("Relayer registry key already matches the active box key.")
    }

    let feeSchedules: Awaited<
      ReturnType<typeof buildSignedRelayExecutionFeeSchedulesV2>
    > = []
    try {
      const poolV3Runtime = readPoolV3RuntimeConfig(process.env, tempoChainId, account.address)
      if (poolV3Runtime.enabled) {
        const ttl = parseNonNegativeInt(
          process.env.PHASE3_POOL_V3_FEE_SCHEDULE_TTL_SECONDS,
          Math.min(300, poolV3Runtime.config.maximumScheduleValiditySeconds),
          "PHASE3_POOL_V3_FEE_SCHEDULE_TTL_SECONDS"
        )
        if (ttl > poolV3Runtime.config.maximumScheduleValiditySeconds) {
          throw new Error(
            "PoolV3 fee schedule publication TTL exceeds the configured validity ceiling."
          )
        }
        const templates = readRelayExecutionFeeScheduleTemplatesV2(process.env, poolV3Runtime.config)
        const gasBudget = process.env.PHASE3_POOL_V3_REWARD_GAS_UNITS?.trim()
        if (gasBudget && (!/^[1-9][0-9]*$/u.test(gasBudget) || BigInt(gasBudget) > 100_000_000n)) {
          throw new Error("PoolV3 reward gas budget is invalid.")
        }
        const gasPrice = gasBudget ? await publicClient.getGasPrice() : null
        // shortcut: one gas allowance for all shapes; recalibrate when the real-calldata cost guard rejects a supported shape.
        const pricedTemplates = templates.map((template) => {
          if (!gasBudget || gasPrice == null) return template
          if (gasPrice > BigInt(template.maximumGasPrice)) {
            throw new Error("Current gas price exceeds the configured fee schedule ceiling.")
          }
          const minimum = costCoveringRelayReward(BigInt(gasBudget), gasPrice)
          const fee = BigInt(template.executorFee) > minimum ? BigInt(template.executorFee) : minimum
          if (fee > (poolV3Runtime.config.maximumExecutorFeeByMode.get(template.executionMode) ?? 0n)) {
            throw new Error("PoolV3 cost-covering reward exceeds its configured absolute ceiling.")
          }
          return { ...template, executorFee: fee.toString(), maximumGasPrice: gasPrice.toString() }
        })
        feeSchedules = await buildSignedRelayExecutionFeeSchedulesV2({
          account,
          chainId: tempoChainId,
          templates: pricedTemplates,
          validAfter: Math.floor(Date.now() / 1000),
          ttlSeconds: ttl
        })
      }
    } catch (error) {
      console.error(
        `PoolV3 fee schedule publication unavailable: ${redactRelayerRuntimeError(error)}`
      )
    }
    try {
      const v4 = readPoolV4RuntimeConfig(process.env, tempoChainId, account.address)
      if (v4.enabled) {
        const policy = await readRelayRewardPolicyV4(publicClient, relayRewardPolicyTargetV4(process.env, tempoChainId))
        const gasUnits = process.env.PHASE3_POOL_V4_REWARD_GAS_UNITS
        const batchGasUnits = process.env.PHASE3_POOL_V4_BATCH_REWARD_GAS_UNITS
        if (!gasUnits || !/^[1-9][0-9]{0,8}$/.test(gasUnits)) throw Error("V4 reward gas budget unavailable.")
        if (!batchGasUnits || !/^[1-9][0-9]{0,8}$/.test(batchGasUnits)) throw Error("V4 batch reward gas budget unavailable.")
        const gasPrice = await publicClient.getGasPrice(), reward = costCoveringRelayReward(BigInt(gasUnits), gasPrice), batchReward = costCoveringRelayReward(BigInt(batchGasUnits), gasPrice)
        const templates = v4.config.profile.assets.flatMap(asset => Array.from({ length: 4 }, (_, i) => {
          const inputCount = (i + 1) as 1 | 2 | 3 | 4
          return Array.from({ length: 10 }, (_, j) => ({ pool: asset.pool, executionMode: 0 as const, inputCount, outputCount: j + 1, executorFee: String(j === 0 ? reward : batchReward), maximumGasPrice: String(gasPrice) }))
            .filter(t => BigInt(t.executorFee) <= (t.outputCount === 1 ? policy.singleSourceMaximum : policy.batchSourceMaximum))
            .concat(inputCount >= 2 && batchReward <= policy.batchSourceMaximum ? [{ pool: asset.pool, executionMode: 1 as 0, inputCount, outputCount: 0, executorFee: String(batchReward), maximumGasPrice: String(gasPrice) }] : [])
        }).flat())
        feeSchedules.push(...await buildSignedRelayExecutionFeeSchedulesV2({ account, chainId: tempoChainId, templates, validAfter: Math.floor(Date.now() / 1000), ttlSeconds: 300 }))
      }
    } catch (error) { console.error(`PoolV4 fee publication unavailable: ${redactRelayerRuntimeError(error)}`) }
    await postRelayerHeartbeat(account, feeSchedules)
  } catch (error: any) {
    console.error(`Relayer registry key sync error: ${error?.message || error}`)
  }
}

async function openBundle(bundle: unknown) {
  await sodium.ready

  if (!isRelayCipherBundle(bundle)) {
    console.error("Dropped bundle: invalid outer bundle")
    return null
  }

  if (bundle.relayerAddress.toLowerCase() !== relayerAddressEnv) {
    console.log(`Ignored bundle for relayer ${bundle.relayerAddress}`)
    return null
  }

  if (!process.env.RELAYER_BOX_PRIVATE_KEY_B64) {
    throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 missing")
  }

  const sk = sodium.from_base64(
    process.env.RELAYER_BOX_PRIVATE_KEY_B64,
    sodium.base64_variants.ORIGINAL
  )

  const pk = sodium.crypto_scalarmult_base(sk)
  const sealed = hexToBytes(bundle.ciphertext)
  const opened = sodium.crypto_box_seal_open(sealed, pk, sk)

  if (!opened) {
    console.error("Dropped bundle: unable to decrypt for configured relayer box key")
    return null
  }
  return { version: bundle.version, payload: JSON.parse(sodium.to_string(opened)) as unknown }
}

type ProcessBundleOptions = {
  source?: "waku" | "inbox" | "v4-pool"
  allowPayoutV4PoolWithdrawal?: boolean
  onPayoutV4PoolWithdrawalSubmitted?: (transactionHash: Hex) => Promise<void>
  onPayoutV4PoolWithdrawalConfirmed?: (transactionHash: Hex) => Promise<void>
}

type PayoutV4Binding = NonNullable<CanonicalRelayExecutionPayload["payoutV4"]>
type EnabledAuthorityClient = Extract<ReturnType<typeof readPayoutV4RelayerAuthorityClientConfig>, { enabled: true }>
type EnabledAttesterClient = Extract<ReturnType<typeof readPayoutV4AttesterClientConfig>, { enabled: true }>

async function processPoolV3Bundle(payloadValue: unknown) {
  const runtime = readPoolV3RuntimeConfig(process.env, tempoChainId, account.address)
  if (!runtime.enabled) throw new Error("PoolV3 relayer dispatch is disabled.")
  const payload = validatePoolV3ProofPayload(payloadValue, runtime.config)
  const nullifiers = poolV3ActiveNullifiers(payload)
  const inputCount = nullifiers.length
  const outputCount = payload.amounts.filter((amount) => BigInt(amount) > 0n).length
  const validateFeeSchedule = (currentGasPrice: bigint) =>
    validateRelayExecutionFeeScheduleV2(payload.feeSchedule, {
      chainId: tempoChainId,
      pool: payload.pool,
      executionMode: payload.executionMode,
      inputCount,
      outputCount,
      executorFee: BigInt(payload.executorFee),
      relayer: account.address,
      maximumExecutorFee:
        runtime.config.maximumExecutorFeeByMode.get(payload.executionMode) ?? 0n,
      maximumValiditySeconds: runtime.config.maximumScheduleValiditySeconds,
      currentGasPrice,
      nowSeconds: Math.floor(Date.now() / 1000)
    })
  await validateFeeSchedule(await publicClient.getGasPrice())
  const replayKey = nullifiers.map((value) => value.toLowerCase()).join(":")
  if (inFlightNullifiers.has(replayKey)) throw new Error("PoolV3 nullifier set is already processing.")

  inFlightNullifiers.add(replayKey)
  try {
    const spent = await Promise.all(nullifiers.map((nullifier) =>
      publicClient.readContract({
        address: payload.pool,
        abi: tempoShieldedPoolV3Abi,
        functionName: "nullifierHashes",
        args: [nullifier]
      })
    ))
    if (spent.some(Boolean)) throw new Error("PoolV3 payload contains an already-spent nullifier.")

    requirePhase3BroadcastEnabled("PoolV3 batch withdrawal broadcast")
    const prepared = preparePoolV3Transaction(payload)
    await publicClient.call({ account, to: prepared.to, data: prepared.data })
    const broadcastGasPrice = await publicClient.getGasPrice()
    await validateFeeSchedule(broadcastGasPrice)
    if (process.env.PHASE3_POOL_V3_REWARD_GAS_UNITS?.trim()) {
      const gas = await publicClient.estimateGas({ account, to: prepared.to, data: prepared.data })
      requireCostCoveredRelayReward(BigInt(payload.executorFee), gas, broadcastGasPrice)
    }
    const result = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
      prepared,
      { gasPrice: broadcastGasPrice }
    )
    if (result.status !== "success") throw new Error("PoolV3 batch withdrawal reverted.")
    for (const nullifier of nullifiers) seenNullifiers.add(nullifier.toLowerCase())
    console.log(`Relayed PoolV3 mode ${payload.executionMode} transaction ${shortId(result.hash)}.`)
  } finally {
    inFlightNullifiers.delete(replayKey)
  }
}

async function processPoolV4Bundle(payloadValue: unknown, raw: unknown) {
  const runtime = readPoolV4RuntimeConfig(process.env, tempoChainId, account.address)
  if (!runtime.enabled) throw Error("PoolV4 relayer dispatch is disabled.")
  const payload = validatePoolV4ProofPayload(payloadValue, runtime.config), transaction = preparePoolV4Transaction(payload), nullifiers = poolV4ActiveNullifiers(payload), callHash = keccak256(transaction.data)
  const bundleKey = createHash("sha256").update(JSON.stringify(raw)).digest("hex")
  if (nullifiers.some(n => inFlightNullifiers.has(n))) throw new RelayInboxDeferredError("PoolV4 input is already processing.", 15)
  nullifiers.forEach(n => inFlightNullifiers.add(n))
  try {
    // Retention precedes submission. A lost send response never authorizes another broadcast.
    const identity = { callHash, pool: transaction.to, relayer: account.address, nullifiers }
    const retained = await retainPoolV4RelayExecution(identity, false)
    let hash = retained.transactionHash
    if (retained.fresh) {
      const ready = await assertPoolV4ExecutionReady({ ...runtime.config, payload, client: publicClient })
      requirePhase3BroadcastEnabled("PoolV4 private spend broadcast")
      const claimed = await retainPoolV4RelayExecution(identity)
      if (!claimed.fresh) throw new RelayInboxDeferredError("PoolV4 original submission is already retained.", 15)
      const sent = await preparedTransactionBroadcaster.broadcastPreparedTransaction(ready.transaction, { gasPrice: ready.gasPrice, onSubmitted: async submitted => {
        hash = submitted
        await recordPoolV4RelaySubmission({ callHash, relayer: account.address, hash: submitted, bundleKey })
      } })
      hash = sent.hash
    }
    if (!hash) throw new RelayInboxDeferredError("PoolV4 original submission is uncertain and remains retained.", 60)
    await recordPoolV4RelaySubmission({ callHash, relayer: account.address, hash, bundleKey })
    const settled = await readPoolV4CanonicalReceipt({ payload, profile: runtime.config.profile, relayer: account.address, hash, client: publicClient })
    if (settled === "pending") throw new RelayInboxDeferredError("PoolV4 original transaction awaits canonical finality.", 15)
    if (settled === "reverted") throw Error("POOL_V4_CANONICAL_REVERT")
    nullifiers.forEach(n => seenNullifiers.add(n))
  } finally { nullifiers.forEach(n => inFlightNullifiers.delete(n)) }
}

async function runPayoutV4DownstreamForBinding(args: {
  binding: PayoutV4Binding
  bundlePool: Address
  authorityClient: EnabledAuthorityClient
  attesterClient: EnabledAttesterClient
}) {
  const { binding, bundlePool, authorityClient, attesterClient } = args
  return runPayoutV4DownstreamExecution({
    bundle: { payoutV4: binding },
    executionAddress: account.address,
    readAdapterStatus: async (intentHash) =>
      Number(
        await publicClient.readContract({
          address: getAddress(binding.adapter) as Address,
          abi: parlyPayoutAdapterV4Abi,
          functionName: "status",
          args: [intentHash]
        })
      ),
    claimAuthority: async (intentHash) => {
      const claimed = await claimPayoutV4RelayerAuthority({ config: authorityClient, account, intentHash })
      return { authority: claimed.authority }
    },
    validateAuthority: ({ authority, executionAddress }) => {
      validatePayoutV4RelayerAuthorityForBinding({
        binding,
        authority: authority as PayoutV4RelayerAuthorityPayload,
        relayerOperatorAddress: executionAddress,
        bundlePool
      })
    },
    getLocalCheckpoint: async ({ intentHash, step }) =>
      getPayoutV4LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
    getLocalSubmissions: async ({ intentHash, step }) =>
      listPayoutV4LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
    readTransactionOutcome: async (transactionHash) => {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
        return receipt.status === "success" ? "success" : "failed"
      } catch {
        return "pending"
      }
    },
    recordLocalSubmission: async ({ intentHash, step, transactionHash }) => {
      await recordPayoutV4LocalSubmission({ intentHash, step, transactionHash, relayerAddress: account.address })
    },
    recordLocalCheckpoint: async ({ intentHash, step, transactionHash }) => {
      await recordPayoutV4LocalCheckpoint({ intentHash, step, transactionHash, relayerAddress: account.address })
    },
    recordRemoteCheckpoint: async ({ intentHash, step, transactionHash }) => {
      await recordPayoutV4RelayerCheckpoint({ config: authorityClient, account, intentHash, step, transactionHash })
    },
    requestProvenance: ({ intentHash, withdrawalTxHash }) =>
      requestPayoutV4Provenance({ config: attesterClient, intentHash, withdrawalTxHash }),
    confirmEscrowReceipt: async ({ provenance, onSubmitted }) => {
      const prepared = preparePayoutV4ConfirmEscrowReceiptTransaction({
        adapterAddress: getAddress(binding.adapter) as Address,
        attestation: provenance.attestation as PayoutV4ProvenanceAttestationPayload,
        signature: provenance.signature
      })
      const broadcast = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
        { to: prepared.to, data: prepared.data },
        { onSubmitted }
      )
      if (broadcast.status !== "success") throw new Error("V4 escrow receipt confirmation reverted.")
      return { transactionHash: broadcast.hash }
    },
    submitPayout: async ({ authority, onSubmitted }) => {
      const prepared = await preparePayoutV4SubmitPayoutTransaction({
        adapterAddress: getAddress(binding.adapter) as Address,
        authority: authority as PayoutV4RelayerAuthorityPayload,
        eligibilityReader: {
          async isEligibleOperatorFor(operatorAddress, capability) {
            const operatorRegistry = await publicClient.readContract({
              address: getAddress(binding.adapter) as Address,
              abi: parlyPayoutAdapterV4Abi,
              functionName: "operatorRegistry"
            })
            return (await publicClient.readContract({
              address: getAddress(operatorRegistry) as Address,
              abi: relayerOperatorRegistryAbi,
              functionName: "isEligibleOperatorFor",
              args: [operatorAddress, capability]
            })) as boolean
          }
        },
        relayerOperatorAddress: account.address
      })
      const broadcast = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
        { to: prepared.to, data: prepared.data },
        { onSubmitted }
      )
      if (broadcast.status !== "success") throw new Error("V4 payout submission reverted.")
      return { transactionHash: broadcast.hash }
    },
    requestProof: ({ intentHash, submissionTxHash }) =>
      requestPayoutV4ProofAttestation({ config: attesterClient, intentHash, submissionTxHash }),
    getProofQuorum: ({ intentHash, submissionTxHash }) =>
      readPayoutV4ProofQuorum({ config: attesterClient, intentHash, submissionTxHash }),
    completePayout: async ({ proof, signatures, onSubmitted }) => {
      const prepared = preparePayoutV4CompletePayoutTransaction({
        adapterAddress: getAddress(binding.adapter) as Address,
        proof: proof as Parameters<typeof preparePayoutV4CompletePayoutTransaction>[0]["proof"],
        signatures
      })
      const broadcast = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
        { to: prepared.to, data: prepared.data },
        { onSubmitted }
      )
      if (broadcast.status !== "success") throw new Error("V4 payout completion reverted.")
      return { transactionHash: broadcast.hash }
    }
  })
}

function payoutV5Intent(value: Record<string, unknown>) {
  const uintFields = new Set([
    "chainId", "settlementDomainId", "assetId", "amountIn", "sourceAmountOut", "destinationAmountOut",
    "providerSourceAmount", "submissionReimbursement", "deliverySuccessFee", "maxOperatorFee",
    "destinationChainId", "quoteExpiry", "preSubmissionRecoveryDelay", "maxCompletionDelay"
  ])
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, uintFields.has(key) ? BigInt(String(field)) : field]))
}

function payoutV6Intent(value: Record<string, unknown>) {
  const uintFields = new Set([
    "chainId", "settlementDomainId", "sourceExecutorFeeAllocation", "assetId", "amountIn",
    "sourceAmountOut", "destinationAmountOut", "providerSourceAmount", "submissionReimbursement",
    "deliverySuccessFee", "maxOperatorFee", "destinationChainId", "quoteExpiry",
    "preSubmissionRecoveryDelay", "maxCompletionDelay"
  ])
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      uintFields.has(key) ? BigInt(String(field)) : field
    ])
  )
}

function assertApprovedLegacyPool(pool: Address) {
  const approvedPools = [
    getAddress(requireEnv("PHASE3_USDC_POOL_V2")),
    getAddress(requireEnv("PHASE3_USDT_POOL_V2"))
  ]
  if (!approvedPools.includes(getAddress(pool))) {
    throw new Error("Legacy PoolV2 bundle targets an unconfigured pool.")
  }
}

function startPayoutV5ExecutionLoop() {
  const authority = readPayoutV5AuthorityClientConfig(process.env)
  if (!authority.enabled) {
    console.info(`[phase3-payout-v5] ${authority.reason}`)
    return
  }
  const attester = readPayoutV5AttesterClientConfig(process.env)
  if (!attester.enabled) throw new Error("V5 provenance attester client is not configured.")
  if (process.env.PHASE3_PAYOUT_V5_BROADCAST_ENABLED !== "true") {
    console.info("[phase3-payout-v5] phase3_payout_v5_broadcast_disabled")
    return
  }
  const pollMs = parseNonNegativeInt(process.env.PHASE3_PAYOUT_V5_POLL_MS, 5_000, "PHASE3_PAYOUT_V5_POLL_MS")
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      requirePhase3BroadcastEnabled("Payout V5 execution")
      const broadcast = async (to: Address, data: Hex, onSubmitted: (transactionHash: Hex) => Promise<void>) => {
        const result = await preparedTransactionBroadcaster.broadcastPreparedTransaction({ to, data }, { onSubmitted })
        if (result.status !== "success") throw new Error("V5 payout transaction reverted.")
        return { transactionHash: result.hash }
      }
      const downstreamJobs = await listPayoutV5DownstreamJobs({ config: authority, account })
      const downstream = downstreamJobs[0]
      if (downstream) {
        const payload = downstream.payload
        const downstreamResult = await runPayoutV5DownstreamExecution({
          payload,
          intentHash: downstream.intentHash,
          submissionTransactionHash: downstream.submissionTransactionHash,
          readAdapterStatus: async (intentHash) => Number(await publicClient.readContract({
            address: getAddress(payload.lease.adapter), abi: parlyPayoutAdapterV5Abi, functionName: "status", args: [intentHash]
          })),
          readTransactionOutcome: async (transactionHash) => {
            try {
              const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
              return receipt.status === "success" ? "success" : "failed"
            } catch {
              return "pending"
            }
          },
          getLocalCheckpoint: ({ intentHash, step }) => getPayoutV5LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
          getLocalSubmissions: ({ intentHash, step }) => listPayoutV5LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
          recordLocalSubmission: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5LocalSubmission({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
          recordLocalCheckpoint: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5LocalCheckpoint({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
          recordRemoteCheckpoint: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5Checkpoint({ config: authority, account, intentHash, step, transactionHash }),
          observeRelayStatus: ({ intentHash, relayRequestId }) =>
            observePayoutV5RelayStatus({ config: authority, account, intentHash, relayRequestId }),
          requestCompletionProof: ({ intentHash, submissionTxHash }) =>
            requestPayoutV5ProofAttestation({ config: attester, intentHash, submissionTxHash }),
          readCompletionQuorum: ({ intentHash, submissionTxHash }) =>
            readPayoutV5ProofQuorum({ config: attester, intentHash, submissionTxHash }),
          completePayout: ({ proof, signatures, onSubmitted }) => broadcast(
            getAddress(payload.lease.adapter),
            encodeFunctionData({ abi: parlyPayoutAdapterV5Abi, functionName: "completePayout", args: [proof as any, signatures] }),
            onSubmitted
          ),
          requestRefundProof: ({ intentHash, submissionTxHash }) =>
            requestPayoutV5RefundAttestation({ config: attester, intentHash, submissionTxHash }),
          readRefundQuorum: ({ intentHash, submissionTxHash }) =>
            readPayoutV5RefundQuorum({ config: attester, intentHash, submissionTxHash }),
          proveRelayRefund: ({ proof, signatures, onSubmitted }) => broadcast(
            getAddress(payload.lease.adapter),
            encodeFunctionData({ abi: parlyPayoutAdapterV5Abi, functionName: "proveRelayRefund", args: [proof as any, signatures] }),
            onSubmitted
          )
        })
        console.info(`[phase3-payout-v5-downstream] ${downstreamResult.state}`)
      }
      const jobs = await listPayoutV5ReadyJobs({ config: authority, account })
      const job = jobs[0]
      if (!job) return
      const claimed = await claimPayoutV5Execution({ config: authority, account, intentHash: job.intentHash })
      const payload = claimed.payload
      if ("preparations" in payload) {
        const result = await runPayoutV5BatchCheckpointedExecution({
          payload,
          executionAddress: account.address,
          leaseExpiresAt: claimed.leaseExpiresAt,
          readAdapterStatus: async (intentHash) => Number(await publicClient.readContract({
            address: getAddress(payload.lease.adapter), abi: parlyPayoutAdapterV5Abi, functionName: "status", args: [intentHash]
          })),
          readTransactionOutcome: async (transactionHash) => {
            try {
              const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
              return receipt.status === "success" ? "success" : "failed"
            } catch {
              return "pending"
            }
          },
          getLocalCheckpoint: ({ intentHash, step }) => getPayoutV5LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
          getLocalSubmissions: ({ intentHash, step }) => listPayoutV5LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
          recordLocalSubmission: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5LocalSubmission({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
          recordLocalCheckpoint: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5LocalCheckpoint({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
          recordRemoteCheckpoint: ({ intentHash, step, transactionHash }) =>
            recordPayoutV5Checkpoint({ config: authority, account, intentHash, step, transactionHash }),
          acceptQuote: ({ preparation, onSubmitted }) => broadcast(
            getAddress(payload.lease.adapter),
            encodeFunctionData({
              abi: parlyPayoutAdapterV5Abi,
              functionName: "acceptQuote",
              args: [payoutV5Intent(preparation.intent) as any, preparation.payoutSignature]
            }),
            onSubmitted
          ),
          executeWithdrawal: ({ payload: execution, onSubmitted }) => broadcast(
            getAddress(execution.preparations[0]!.poolPayload.payoutV5Batch![0]!.withdrawalExecutor),
            encodeFunctionData({
              abi: parlyPayoutWithdrawalExecutorAbi,
              functionName: "executeWithdrawal",
              args: [{
                ...execution.lease,
                maximumExecutorFee: BigInt(execution.lease.maximumExecutorFee),
                expiry: BigInt(execution.lease.expiry)
              }, execution.leaseSignature, execution.poolCall]
            }),
            onSubmitted
          ),
          requestProvenance: ({ intentHash, withdrawalTxHash }) =>
            requestPayoutV5Provenance({ config: attester, intentHash, withdrawalTxHash }),
          confirmEscrowReceipt: ({ provenance, onSubmitted }) => broadcast(
            getAddress(payload.lease.adapter),
            encodeFunctionData({
              abi: parlyPayoutAdapterV5Abi,
              functionName: "confirmEscrowReceipt",
              args: [provenance.attestation as any, provenance.signature]
            }),
            onSubmitted
          ),
          submitPayout: ({ preparation, onSubmitted }) => broadcast(
            getAddress(payload.lease.adapter),
            encodeFunctionData({
              abi: parlyPayoutAdapterV5Abi,
              functionName: "submitPayout",
              args: [preparation.intentHash, getAddress(preparation.destinationRecipient), preparation.providerData]
            }),
            onSubmitted
          )
        })
        console.info(`[phase3-payout-v5-batch] ${result.state}`)
        return
      }
      const result = await runPayoutV5CheckpointedExecution({
        payload,
        executionAddress: account.address,
        leaseExpiresAt: claimed.leaseExpiresAt,
        readAdapterStatus: async (intentHash) => Number(await publicClient.readContract({
          address: getAddress(payload.lease.adapter), abi: parlyPayoutAdapterV5Abi, functionName: "status", args: [intentHash]
        })),
        readTransactionOutcome: async (transactionHash) => {
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
            return receipt.status === "success" ? "success" : "failed"
          } catch {
            return "pending"
          }
        },
        getLocalCheckpoint: ({ intentHash, step }) => getPayoutV5LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
        getLocalSubmissions: ({ intentHash, step }) => listPayoutV5LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
        recordLocalSubmission: ({ intentHash, step, transactionHash }) =>
          recordPayoutV5LocalSubmission({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
        recordLocalCheckpoint: ({ intentHash, step, transactionHash }) =>
          recordPayoutV5LocalCheckpoint({ intentHash, step, transactionHash, relayerAddress: account.address }).then(() => undefined),
        recordRemoteCheckpoint: ({ intentHash, step, transactionHash }) =>
          recordPayoutV5Checkpoint({ config: authority, account, intentHash, step, transactionHash }),
        acceptQuote: ({ payload: execution, onSubmitted }) => broadcast(
          getAddress(execution.lease.adapter),
          encodeFunctionData({
            abi: parlyPayoutAdapterV5Abi,
            functionName: "acceptQuote",
            args: [payoutV5Intent(execution.preparation.intent) as any, execution.preparation.payoutSignature]
          }),
          onSubmitted
        ),
        executeWithdrawal: ({ payload: execution, onSubmitted }) => broadcast(
          getAddress(execution.preparation.poolPayload.payoutV5!.withdrawalExecutor),
          encodeFunctionData({
            abi: parlyPayoutWithdrawalExecutorAbi,
            functionName: "executeWithdrawal",
            args: [{
              ...execution.lease,
              maximumExecutorFee: BigInt(execution.lease.maximumExecutorFee),
              expiry: BigInt(execution.lease.expiry)
            }, execution.leaseSignature, execution.poolCall]
          }),
          onSubmitted
        ),
        requestProvenance: ({ intentHash, withdrawalTxHash }) =>
          requestPayoutV5Provenance({ config: attester, intentHash, withdrawalTxHash }),
        confirmEscrowReceipt: ({ provenance, onSubmitted }) => broadcast(
          getAddress(payload.lease.adapter),
          encodeFunctionData({
            abi: parlyPayoutAdapterV5Abi,
            functionName: "confirmEscrowReceipt",
            args: [provenance.attestation as any, provenance.signature]
          }),
          onSubmitted
        ),
        submitPayout: ({ payload: execution, onSubmitted }) => broadcast(
          getAddress(execution.lease.adapter),
          encodeFunctionData({
            abi: parlyPayoutAdapterV5Abi,
            functionName: "submitPayout",
            args: [execution.preparation.intentHash, getAddress(execution.preparation.destinationRecipient), execution.preparation.providerData]
          }),
          onSubmitted
        ),
        requestCompletionProof: ({ intentHash, submissionTxHash }) =>
          requestPayoutV5ProofAttestation({ config: attester, intentHash, submissionTxHash }),
        readCompletionQuorum: ({ intentHash, submissionTxHash }) =>
          readPayoutV5ProofQuorum({ config: attester, intentHash, submissionTxHash }),
        completePayout: ({ proof, signatures, onSubmitted }) => broadcast(
          getAddress(payload.lease.adapter),
          encodeFunctionData({
            abi: parlyPayoutAdapterV5Abi,
            functionName: "completePayout",
            args: [proof as any, signatures]
          }),
          onSubmitted
        ),
        requestRefundProof: ({ intentHash, submissionTxHash }) =>
          requestPayoutV5RefundAttestation({ config: attester, intentHash, submissionTxHash }),
        readRefundQuorum: ({ intentHash, submissionTxHash }) =>
          readPayoutV5RefundQuorum({ config: attester, intentHash, submissionTxHash }),
        proveRelayRefund: ({ proof, signatures, onSubmitted }) => broadcast(
          getAddress(payload.lease.adapter),
          encodeFunctionData({
            abi: parlyPayoutAdapterV5Abi,
            functionName: "proveRelayRefund",
            args: [proof as any, signatures]
          }),
          onSubmitted
        ),
        observeRelayStatus: ({ intentHash, relayRequestId }) =>
          observePayoutV5RelayStatus({ config: authority, account, intentHash, relayRequestId })
      })
      console.info(`[phase3-payout-v5] ${result.state}`)
    } catch (error) {
      console.error(`[phase3-payout-v5] ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
    }
  }
  void tick()
  setInterval(() => void tick(), pollMs)
}

function startPayoutV6ExecutionLoop() {
  const authority = readPayoutV6AuthorityClientConfig(process.env)
  if (!authority.enabled) {
    console.info(`[phase3-payout-v6] ${authority.reason}`)
    return
  }
  const attester = readPayoutV6AttesterClientConfig(process.env)
  if (!attester.enabled) throw new Error("V6 provenance attester client is not configured.")
  if (process.env.PHASE3_PAYOUT_V6_BROADCAST_ENABLED !== "true") {
    console.info("[phase3-payout-v6] phase3_payout_v6_broadcast_disabled")
    return
  }
  const pollMs = parseNonNegativeInt(
    process.env.PHASE3_PAYOUT_V6_POLL_MS,
    5_000,
    "PHASE3_PAYOUT_V6_POLL_MS"
  )
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      requirePhase3BroadcastEnabled("Payout V6 execution")
      const broadcast = async (
        to: Address,
        data: Hex,
        onSubmitted: (transactionHash: Hex) => Promise<void>
      ) => {
        const result = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
          { to, data },
          { onSubmitted }
        )
        if (result.status !== "success") throw new Error("V6 payout transaction reverted.")
        return { transactionHash: result.hash }
      }
      const readAdapterStatus = async (intentHash: Hex) =>
        Number(await publicClient.readContract({
          address: authority.adapter,
          abi: parlyPayoutAdapterV6Abi,
          functionName: "status",
          args: [intentHash]
        }))
      const readTransactionOutcome = async (transactionHash: Hex) => {
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: transactionHash
          })
          return receipt.status === "success"
            ? "success" as const
            : "failed" as const
        } catch {
          return "pending" as const
        }
      }
      for (const downstream of await listPayoutV6DownstreamCheckpoints({
        relayerAddress: account.address
      })) {
        const result = await runPayoutV6DownstreamExecution({
          intentHash: downstream.intentHash,
          submissionTransactionHash: downstream.transactionHash,
          readAdapterStatus,
          readTransactionOutcome,
          getLocalCheckpoint: ({ intentHash, step }) =>
            getPayoutV6LocalCheckpoint({
              intentHash,
              step,
              relayerAddress: account.address
            }),
          getLocalSubmissions: ({ intentHash, step }) =>
            listPayoutV6LocalSubmissions({
              intentHash,
              step,
              relayerAddress: account.address
            }),
          recordLocalSubmission: ({ intentHash, step, transactionHash }) =>
            recordPayoutV6LocalSubmission({
              intentHash,
              step,
              transactionHash,
              relayerAddress: account.address
            }).then(() => undefined),
          recordLocalCheckpoint: ({ intentHash, step, transactionHash }) =>
            recordPayoutV6LocalCheckpoint({
              intentHash,
              step,
              transactionHash,
              relayerAddress: account.address
            }).then(() => undefined),
          requestCompletionProof: ({ intentHash, submissionTxHash }) =>
            requestPayoutV6ProofAttestation({
              config: attester,
              intentHash,
              submissionTxHash
            }),
          completePayout: ({ proof, signatures, onSubmitted }) =>
            broadcast(
              authority.adapter,
              encodeFunctionData({
                abi: parlyPayoutAdapterV6Abi,
                functionName: "completePayout",
                args: [proof as any, signatures]
              }),
              onSubmitted
            ),
          requestRefundProof: ({ intentHash, submissionTxHash }) =>
            requestPayoutV6RefundAttestation({
              config: attester,
              intentHash,
              submissionTxHash
            }),
          readRefundQuorum: ({ intentHash, submissionTxHash }) =>
            readPayoutV6RefundQuorum({
              config: attester,
              intentHash,
              submissionTxHash
            }),
          proveRelayRefund: ({ proof, signatures, onSubmitted }) =>
            broadcast(
              authority.adapter,
              encodeFunctionData({
                abi: parlyPayoutAdapterV6Abi,
                functionName: "proveRelayRefund",
                args: [proof as any, signatures]
              }),
              onSubmitted
            )
        })
        console.info(`[phase3-payout-v6-downstream] ${result.state}`)
        if ("completionRetry" in result && result.completionRetry) {
          console.warn(`[phase3-payout-v6-downstream] ${result.completionRetry}`)
        }
      }
      const jobs = await listPayoutV6ReadyJobs({ config: authority, account })
      const job = jobs[0]
      if (!job) return
      const claimed = await claimPayoutV6Execution({
        config: authority,
        account,
        manifestHash: job.manifestHash
      })
      const result = await runPayoutV6CheckpointedExecution({
        claimed,
        executionAddress: account.address,
        readAdapterStatus,
        readEscrowFundedAt: async (intentHash) => {
          const record = await publicClient.readContract({
            address: authority.adapter,
            abi: parlyPayoutAdapterV6Abi,
            functionName: "getPayoutRecord",
            args: [intentHash]
          })
          return record.escrowFundedAt
        },
        readTransactionOutcome,
        getLocalCheckpoint: ({ intentHash, step }) =>
          getPayoutV6LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
        getLocalSubmissions: ({ intentHash, step }) =>
          listPayoutV6LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
        recordLocalSubmission: ({ intentHash, step, transactionHash }) =>
          recordPayoutV6LocalSubmission({
            intentHash,
            step,
            transactionHash,
            relayerAddress: account.address
          }).then(() => undefined),
        recordLocalCheckpoint: ({ intentHash, step, transactionHash }) =>
          recordPayoutV6LocalCheckpoint({
            intentHash,
            step,
            transactionHash,
            relayerAddress: account.address
          }).then(() => undefined),
        acceptQuote: ({ child, onSubmitted }) => broadcast(
          authority.adapter,
          encodeFunctionData({
            abi: parlyPayoutAdapterV6Abi,
            functionName: "acceptQuote",
            args: [payoutV6Intent(child.intent) as any, child.payoutSignature]
          }),
          onSubmitted
        ),
        executeWithdrawal: async ({ claimed: execution, onSubmitted }) => {
          const runtime = readPoolV3RuntimeConfig(process.env, tempoChainId, account.address)
          if (!runtime.enabled) throw new Error("PoolV3 relayer dispatch is disabled.")
          const inputCount = poolV3ActiveNullifiers(execution.proofPayload).length
          const outputCount = execution.proofPayload.amounts.filter(
            (amount) => BigInt(amount) > 0n
          ).length
          const validateFees = (currentGasPrice: bigint) =>
            validateRelayExecutionFeeScheduleV2(execution.proofPayload.feeSchedule, {
              chainId: tempoChainId,
              pool: execution.proofPayload.pool,
              executionMode: execution.proofPayload.executionMode,
              inputCount,
              outputCount,
              executorFee: BigInt(execution.proofPayload.executorFee),
              relayer: account.address,
              maximumExecutorFee:
                runtime.config.maximumExecutorFeeByMode.get(
                  execution.proofPayload.executionMode
                ) ?? 0n,
              maximumValiditySeconds: runtime.config.maximumScheduleValiditySeconds,
              currentGasPrice,
              nowSeconds: Math.floor(Date.now() / 1000)
            })
          await validateFees(await publicClient.getGasPrice())
          const prepared = preparePayoutV6WithdrawalTransaction(execution.payload)
          await publicClient.call({ account, to: prepared.to, data: prepared.data })
          const gasPrice = await publicClient.getGasPrice()
          await validateFees(gasPrice)
          if (process.env.PHASE3_POOL_V3_REWARD_GAS_UNITS?.trim()) {
            const gas = await publicClient.estimateGas({ account, to: prepared.to, data: prepared.data })
            requireCostCoveredRelayReward(BigInt(execution.proofPayload.executorFee), gas, gasPrice)
          }
          const sent = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
            { to: prepared.to, data: prepared.data },
            { gasPrice, onSubmitted }
          )
          if (sent.status !== "success") throw new Error("V6 payout withdrawal reverted.")
          return { transactionHash: sent.hash }
        },
        requestProvenance: ({ intentHash, withdrawalTxHash }) =>
          requestPayoutV6Provenance({ config: attester, intentHash, withdrawalTxHash }),
        confirmEscrowReceipt: ({ child, provenance, onSubmitted }) => broadcast(
          authority.adapter,
          encodeFunctionData({
            abi: parlyPayoutAdapterV6Abi,
            functionName: "confirmEscrowReceipt",
            args: [provenance.attestation as any, provenance.signature]
          }),
          onSubmitted
        ),
        submitPayout: ({ child, onSubmitted }) => broadcast(
          authority.adapter,
          encodeFunctionData({
            abi: parlyPayoutAdapterV6Abi,
            functionName: "submitPayout",
            args: [child.intentHash, child.destinationRecipient, child.providerData]
          }),
          onSubmitted
        )
      })
      console.info(`[phase3-payout-v6] ${result.state}`)
    } catch (error) {
      console.error(
        `[phase3-payout-v6] ${redactRelayerRuntimeError(error)}`
      )
    } finally {
      running = false
    }
  }
  void tick()
  setInterval(() => void tick(), pollMs)
}

async function processPayoutV4Bundle(raw: unknown, decoded: CanonicalRelayExecutionPayload) {
  const binding = decoded.payoutV4
  if (!binding) throw new Error("V4 payout bundle binding is required.")
  if (!isPayoutV4ExecutionBroadcastEnabled(process.env)) {
    throw new Error("V4 payout execution is disabled until all explicit relayer broadcast gates are enabled.")
  }

  const authorityClient = readPayoutV4RelayerAuthorityClientConfig(process.env)
  if (!authorityClient.enabled) {
    throw new Error("V4 payout authority client is not configured.")
  }
  const attesterClient = readPayoutV4AttesterClientConfig(process.env)
  if (!attesterClient.enabled) {
    throw new Error("V4 proof attester client is not configured.")
  }

  const intentHash = binding.intentHash.toLowerCase()
  if (inFlightPayoutV4Intents.has(intentHash)) {
    throw new Error("V4 payout intent is already processing.")
  }
  inFlightPayoutV4Intents.add(intentHash)

  try {
    const result = await runPayoutV4CheckpointedExecution({
      bundle: decoded,
      executionAddress: account.address,
      settlementDomainId: tempoChainId,
      readAdapterStatus: async (nextIntentHash) =>
        Number(
          await publicClient.readContract({
            address: getAddress(binding.adapter) as Address,
            abi: parlyPayoutAdapterV4Abi,
            functionName: "status",
            args: [nextIntentHash]
          })
        ),
      claimAuthority: async (nextIntentHash) => {
        const claimed = await claimPayoutV4RelayerAuthority({
          config: authorityClient,
          account,
          intentHash: nextIntentHash
        })
        return { authority: claimed.authority }
      },
      validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) =>
        validatePayoutV4PrivateBundleBinding({
          bundle,
          authority,
          relayerOperatorAddress,
          settlementDomainId
        }),
      getLocalCheckpoint: async ({ intentHash: nextIntentHash, step }) =>
        getPayoutV4LocalCheckpoint({
          intentHash: nextIntentHash,
          step,
          relayerAddress: account.address
        }),
      getLocalSubmissions: async ({ intentHash: nextIntentHash, step }) =>
        listPayoutV4LocalSubmissions({
          intentHash: nextIntentHash,
          step,
          relayerAddress: account.address
        }),
      readTransactionOutcome: async (transactionHash) => {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
          return receipt.status === "success" ? "success" : "failed"
        } catch {
          // A missing receipt is treated as pending so a retry never replaces an
          // unknown transaction solely because an RPC endpoint is temporarily behind.
          return "pending"
        }
      },
      recordLocalSubmission: async ({ intentHash: nextIntentHash, step, transactionHash }) => {
        await recordPayoutV4LocalSubmission({
          intentHash: nextIntentHash,
          step,
          transactionHash,
          relayerAddress: account.address
        })
      },
      recordLocalCheckpoint: async ({ intentHash: nextIntentHash, step, transactionHash }) => {
        await recordPayoutV4LocalCheckpoint({
          intentHash: nextIntentHash,
          step,
          transactionHash,
          relayerAddress: account.address
        })
      },
      recordRemoteCheckpoint: async ({ intentHash: nextIntentHash, step, transactionHash }) => {
        await recordPayoutV4RelayerCheckpoint({
          config: authorityClient,
          account,
          intentHash: nextIntentHash,
          step,
          transactionHash
        })
      },
      acceptQuote: async ({ authority, binding: validatedBinding, onSubmitted }) => {
        const prepared = await preparePayoutV4AcceptQuoteTransaction({
          adapterAddress: getAddress(binding.adapter) as Address,
          bundle: decoded,
          authority,
          eligibilityReader: {
            async isEligibleOperatorFor(operatorAddress, capability) {
              const operatorRegistry = await publicClient.readContract({
                address: getAddress(authority.intent.adapter) as Address,
                abi: parlyPayoutAdapterV4Abi,
                functionName: "operatorRegistry"
              })
              return (await publicClient.readContract({
                address: getAddress(operatorRegistry) as Address,
                abi: relayerOperatorRegistryAbi,
                functionName: "isEligibleOperatorFor",
                args: [operatorAddress, capability]
              })) as boolean
            }
          },
          relayerOperatorAddress: account.address,
          settlementDomainId: tempoChainId
        })
        if (prepared.intentHash.toLowerCase() !== validatedBinding.intentHash.toLowerCase()) {
          throw new Error("V4 prepared quote does not match the private bundle.")
        }
        const broadcast = await preparedTransactionBroadcaster.broadcastPreparedTransaction({
          to: prepared.to,
          data: prepared.data
        }, {
          onSubmitted
        })
        if (broadcast.status !== "success") throw new Error("V4 quote acceptance reverted.")
        return { transactionHash: broadcast.hash }
      },
      withdrawPoolBundle: async ({ onSubmitted }) => {
        let transactionHash: Hex | null = null
        await processBundle(raw, 0, {
          source: "v4-pool",
          allowPayoutV4PoolWithdrawal: true,
          onPayoutV4PoolWithdrawalSubmitted: onSubmitted,
          onPayoutV4PoolWithdrawalConfirmed: async (confirmedHash) => {
            transactionHash = confirmedHash
          }
        })
        if (!transactionHash) throw new Error("V4 Pool withdrawal did not reach a confirmed checkpoint.")
        return { transactionHash }
      }
    })
    const downstream = await runPayoutV4DownstreamForBinding({
      binding,
      bundlePool: getAddress(decoded.pool) as Address,
      authorityClient,
      attesterClient
    })
    console.log(`V4 payout ${shortId(result.intentHash)} ${result.status}; downstream ${downstream.status}`)
    if (downstream.status === "awaiting_proof_quorum") {
      throw new RelayInboxDeferredError("V4 payout is awaiting an independent proof signature.", 60)
    }
  } finally {
    inFlightPayoutV4Intents.delete(intentHash)
  }
}

async function processPayoutV4BatchBundle(raw: unknown, decoded: CanonicalRelayExecutionPayload) {
  const bindings = decoded.payoutV4Batch
  if (!bindings || bindings.length < 2) throw new Error("V4 payout batch binding is required.")
  if (!isPayoutV4ExecutionBroadcastEnabled(process.env)) {
    throw new Error("V4 payout execution is disabled until all explicit relayer broadcast gates are enabled.")
  }

  const authorityClient = readPayoutV4RelayerAuthorityClientConfig(process.env)
  if (!authorityClient.enabled) throw new Error("V4 payout authority client is not configured.")
  const attesterClient = readPayoutV4AttesterClientConfig(process.env)
  if (!attesterClient.enabled) throw new Error("V4 proof attester client is not configured.")

  const intentHashes = payoutV4IntentHashes(decoded)
  if (intentHashes.some((intentHash) => inFlightPayoutV4Intents.has(intentHash))) {
    throw new Error("V4 payout batch contains an intent that is already processing.")
  }
  for (const intentHash of intentHashes) inFlightPayoutV4Intents.add(intentHash)

  const bindingByIntent = new Map(bindings.map((binding) => [binding.intentHash.toLowerCase(), binding]))
  const readBinding = (intentHash: Hex) => {
    const binding = bindingByIntent.get(intentHash.toLowerCase())
    if (!binding) throw new Error("V4 payout batch intent does not match its private bundle.")
    return binding
  }

  try {
    const source = await runPayoutV4BatchCheckpointedExecution({
      intentHashes,
      readAdapterStatus: async (intentHash) => {
        const binding = readBinding(intentHash)
        return Number(
          await publicClient.readContract({
            address: getAddress(binding.adapter) as Address,
            abi: parlyPayoutAdapterV4Abi,
            functionName: "status",
            args: [intentHash]
          })
        )
      },
      claimAuthority: async (intentHash) => {
        const claimed = await claimPayoutV4RelayerAuthority({ config: authorityClient, account, intentHash })
        return { authority: claimed.authority }
      },
      validateBundle: ({ authorities }) =>
        validatePayoutV4PrivateBundleBindings({
          bundle: decoded,
          authorities,
          relayerOperatorAddress: account.address,
          settlementDomainId: tempoChainId
        }),
      getLocalCheckpoint: async ({ intentHash, step }) =>
        getPayoutV4LocalCheckpoint({ intentHash, step, relayerAddress: account.address }),
      getLocalSubmissions: async ({ intentHash, step }) =>
        listPayoutV4LocalSubmissions({ intentHash, step, relayerAddress: account.address }),
      readTransactionOutcome: async (transactionHash) => {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash })
          return receipt.status === "success" ? "success" : "failed"
        } catch {
          return "pending"
        }
      },
      recordLocalSubmission: async ({ intentHash, step, transactionHash }) => {
        await recordPayoutV4LocalSubmission({ intentHash, step, transactionHash, relayerAddress: account.address })
      },
      recordLocalCheckpoint: async ({ intentHash, step, transactionHash }) => {
        await recordPayoutV4LocalCheckpoint({ intentHash, step, transactionHash, relayerAddress: account.address })
      },
      recordRemoteCheckpoint: async ({ intentHash, step, transactionHash }) => {
        await recordPayoutV4RelayerCheckpoint({ config: authorityClient, account, intentHash, step, transactionHash })
      },
      acceptQuote: async ({ authority, binding, onSubmitted }) => {
        const prepared = await preparePayoutV4AcceptQuoteTransactionFromAuthority({
          adapterAddress: getAddress(authority.intent.adapter) as Address,
          authority,
          eligibilityReader: {
            async isEligibleOperatorFor(operatorAddress, capability) {
              const operatorRegistry = await publicClient.readContract({
                address: getAddress(authority.intent.adapter) as Address,
                abi: parlyPayoutAdapterV4Abi,
                functionName: "operatorRegistry"
              })
              return (await publicClient.readContract({
                address: getAddress(operatorRegistry) as Address,
                abi: relayerOperatorRegistryAbi,
                functionName: "isEligibleOperatorFor",
                args: [operatorAddress, capability]
              })) as boolean
            }
          },
          relayerOperatorAddress: account.address
        })
        if (
          prepared.intentHash.toLowerCase() !== binding.intentHash.toLowerCase() ||
          getAddress(prepared.escrow) !== getAddress(binding.escrow) ||
          prepared.amountIn !== binding.amountIn
        ) {
          throw new Error("V4 prepared quote does not match the private batch bundle.")
        }
        const broadcast = await preparedTransactionBroadcaster.broadcastPreparedTransaction(
          { to: prepared.to, data: prepared.data },
          { onSubmitted }
        )
        if (broadcast.status !== "success") throw new Error("V4 quote acceptance reverted.")
        return { transactionHash: broadcast.hash }
      },
      withdrawPoolBundle: async ({ onSubmitted }) => {
        let transactionHash: Hex | null = null
        await processBundle(raw, 0, {
          source: "v4-pool",
          allowPayoutV4PoolWithdrawal: true,
          onPayoutV4PoolWithdrawalSubmitted: onSubmitted,
          onPayoutV4PoolWithdrawalConfirmed: async (confirmedHash) => {
            transactionHash = confirmedHash
          }
        })
        if (!transactionHash) throw new Error("V4 Pool withdrawal did not reach a confirmed checkpoint.")
        return { transactionHash }
      }
    })

    let awaitingProof = false
    for (const binding of bindings) {
      const downstream = await runPayoutV4DownstreamForBinding({
        binding,
        bundlePool: getAddress(decoded.pool) as Address,
        authorityClient,
        attesterClient
      })
      awaitingProof ||= downstream.status === "awaiting_proof_quorum"
    }
    console.log(`V4 payout batch (${bindings.length}) ${source.status}`)
    if (awaitingProof) {
      throw new RelayInboxDeferredError("V4 payout batch is awaiting an independent proof signature.", 60)
    }
  } finally {
    for (const intentHash of intentHashes) inFlightPayoutV4Intents.delete(intentHash)
  }
}

async function processBundle(raw: unknown, attempt = 0, options: ProcessBundleOptions = {}) {
  let decoded: CanonicalRelayExecutionPayload | null = null
  let approvalToken: `0x${string}` | null = null
  let approvalSpender: `0x${string}` | null = null
  let nullifierHash: `0x${string}` | null = null
  let submittedHash: `0x${string}` | null = null
  let finalHash: `0x${string}` | null = null
  let shouldCleanupApproval = false
  let persistedForReconciliation = false
  let replacementReason: "replaced" | "repriced" | "cancelled" | null = null
  let inFlightNullifierKey: string | null = null

  try {
    const opened = await openBundle(raw)
    if (!opened) return
    if (opened.version === 2) {
      try {
        if (opened.payload && typeof opened.payload === "object" && (opened.payload as { version?: number }).version === 4) await processPoolV4Bundle(opened.payload, raw)
        else await processPoolV3Bundle(opened.payload)
      } catch (error) {
        if (options.source === "inbox") throw error
        console.error(`Dropped PoolV3 bundle: ${redactRelayerRuntimeError(error)}`)
      }
      return
    }
    decoded = opened.payload as CanonicalRelayExecutionPayload
    if (!isCanonicalPayload(decoded)) {
      console.error("Dropped bundle: decrypted payload failed canonical validation")
      return
    }
    assertApprovedLegacyPool(decoded.pool)
    if (hasPayoutV4Binding(decoded) && !options.allowPayoutV4PoolWithdrawal) {
      if (options.source !== "inbox") {
        await enqueueRelayInboxBundle({
          relayerAddress: account.address,
          rawBundle: raw,
          source: "waku"
        })
        console.log(`Queued V4 payout ${shortId(payoutV4IntentHashes(decoded)[0])} for durable relayer execution.`)
        return
      }
      if (decoded.payoutV4Batch) await processPayoutV4BatchBundle(raw, decoded)
      else await processPayoutV4Bundle(raw, decoded)
      return
    }
    if (
      hasPayoutV4Binding(decoded) &&
      (!options.onPayoutV4PoolWithdrawalSubmitted || !options.onPayoutV4PoolWithdrawalConfirmed)
    ) {
      throw new Error("V4 Pool withdrawal requires durable submission and checkpoint callbacks.")
    }

    nullifierHash =
      `0x${BigInt(decoded.pubSignals[12]).toString(16).padStart(64, "0")}` as `0x${string}`

    if (seenNullifiers.has(nullifierHash.toLowerCase())) {
      if (hasPayoutV4Binding(decoded)) {
        throw new Error("V4 Pool withdrawal is already spent without a durable local checkpoint.")
      }
      console.log(`Ignored cached replay ${shortId(nullifierHash)}`)
      return
    }

    inFlightNullifierKey = nullifierHash.toLowerCase()
    if (inFlightNullifiers.has(inFlightNullifierKey)) {
      if (hasPayoutV4Binding(decoded)) {
        throw new Error("V4 Pool withdrawal is already processing.")
      }
      console.log(`Ignored in-flight replay ${shortId(nullifierHash)}`)
      return
    }
    inFlightNullifiers.add(inFlightNullifierKey)

    const proofRelayerAddress =
      `0x${BigInt(decoded.pubSignals[49]).toString(16).padStart(40, "0")}`.toLowerCase()

    if (proofRelayerAddress !== account.address.toLowerCase()) {
      console.error(`Dropping bundle bound to ${proofRelayerAddress}`)
      return
    }

    const spent = (await publicClient.readContract({
      address: decoded.pool,
      abi: POOL_ABI,
      functionName: "nullifierHashes",
      args: [nullifierHash]
    })) as boolean

    if (spent) {
      if (hasPayoutV4Binding(decoded)) {
        throw new Error("V4 Pool withdrawal is already spent without a durable local checkpoint.")
      }
      console.log(`On-chain spent, dropping ${shortId(nullifierHash)}`)
      seenNullifiers.add(nullifierHash.toLowerCase())
      return
    }

    const localEid = Number(decoded.pubSignals[17])
    const decodedAmounts = decoded.amounts
    if (
      decoded.destEids.some(
        (eid, index) => BigInt(decodedAmounts[index] || "0") > 0n && eid !== localEid
      )
    ) {
      console.error("Dropped bundle: PoolV2 cross-chain payout is disabled; use V3 payout route.")
      return
    }

    let totalCrossChainFee = 0n
    let sameChainOutputCount = 0
    let crossChainOutputCount = 0

    for (let i = 0; i < decoded.amounts.length; i++) {
      const amt = BigInt(decoded.amounts[i])
      const dst = decoded.destEids[i]

      if (amt === 0n) continue
      if (decoded.recipients[i].toLowerCase() === ZERO_ADDRESS) {
        console.error("Dropped bundle: zero recipient")
        return
      }
      if (dst === localEid) {
        sameChainOutputCount += 1
        continue
      }

      crossChainOutputCount += 1

      const fee = (await publicClient.readContract({
        address: decoded.pool,
        abi: POOL_ABI,
        functionName: "quoteCrossChainFee",
        args: [dst, decoded.recipients[i], amt, decoded.lzOptions[i]]
      })) as bigint

      totalCrossChainFee += fee
    }

    const executorFee = BigInt(decoded.pubSignals[14])
    const feeTokenDecimals = BigInt(process.env.TEMPO_LZ_FEE_TOKEN_DECIMALS || "6")
    const feeTokenUsd6 = BigInt(process.env.TEMPO_LZ_FEE_TOKEN_USD_6DEC || "1000000")
    const totalCrossChainFeeUsd6 =
      feeTokenUsd6 === 0n ? 0n : (totalCrossChainFee * feeTokenUsd6) / 10n ** feeTokenDecimals
    const requiredMarginUsd6 =
      crossChainOutputCount === 0
        ? 100_000n + (sameChainOutputCount > 0 ? BigInt(sameChainOutputCount - 1) * 20_000n : 0n)
        : (() => {
            const dynamicMargin =
              totalCrossChainFeeUsd6 / 5n +
              BigInt(crossChainOutputCount) * 50_000n +
              BigInt(sameChainOutputCount) * 20_000n
            return dynamicMargin > 350_000n ? dynamicMargin : 350_000n
          })()
    const recommendedExecutorFee =
      crossChainOutputCount === 0
        ? requiredMarginUsd6
        : totalCrossChainFeeUsd6 + requiredMarginUsd6

    if (hasPayoutV4Binding(decoded) && executorFee !== 0n) {
      console.error("Dropped V4 bundle: Pool executor fee must be zero; V4 pays only on successful completion.")
      return
    }

    if (!hasPayoutV4Binding(decoded) && executorFee < recommendedExecutorFee) {
      console.log(
        `Ignored bundle: executor fee ${formatUnits(executorFee, 6)} below recommended floor ${formatUnits(recommendedExecutorFee, 6)}`
      )
      return
    }

    if (totalCrossChainFee > 0n) {
      requirePhase3BroadcastEnabled("cross-chain fee approval")
      approvalToken = (await readCrossChainFeeFundingToken(decoded.pool)) as `0x${string}`
      approvalSpender = decoded.pool

      await safeApproveExactRelayer({
        token: approvalToken,
        spender: approvalSpender,
        amount: totalCrossChainFee,
        owner: account.address,
        publicClient,
        walletClient
      })
    }

    const proofArgs = [
      [BigInt(decoded.pA[0]), BigInt(decoded.pA[1])],
      [
        [BigInt(decoded.pB[0][0]), BigInt(decoded.pB[0][1])],
        [BigInt(decoded.pB[1][0]), BigInt(decoded.pB[1][1])]
      ],
      [BigInt(decoded.pC[0]), BigInt(decoded.pC[1])],
      decoded.pubSignals.map((x) => BigInt(x)) as any,
      decoded.recipients,
      decoded.amounts.map((x) => BigInt(x)),
      decoded.destEids,
      decoded.newChangeCommitment,
      decoded.newChangeEnvelope
    ] as const
    requirePhase3BroadcastEnabled("batch withdrawal broadcast")
    if (hasPayoutV4Binding(decoded)) {
      const { request } = await publicClient.simulateContract({
        account,
        address: decoded.pool,
        abi: tempoShieldedPoolV2Abi,
        functionName: "batchWithdraw",
        args: proofArgs
      })
      submittedHash = await walletClient.writeContract(request)
    } else {
      const { request } = await publicClient.simulateContract({
        account,
        address: decoded.pool,
        abi: POOL_ABI,
        functionName: "batchWithdraw",
        args: [...proofArgs, decoded.lzOptions]
      })
      submittedHash = await walletClient.writeContract(request)
    }
    finalHash = submittedHash
    if (hasPayoutV4Binding(decoded)) {
      await options.onPayoutV4PoolWithdrawalSubmitted?.(submittedHash)
    }

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: submittedHash,
      timeout: receiptTimeoutMs,
      onReplaced: (replacement) => {
        replacementReason = replacement.reason
        finalHash = replacement.transactionReceipt.transactionHash as `0x${string}`
      }
    })

    if (replacementReason === "cancelled") {
      shouldCleanupApproval = true
      console.error(`Execution cancelled before inclusion for ${finalHash}`)
      return
    }

    if (replacementReason === "replaced") {
      shouldCleanupApproval = true
      console.error(`Execution replaced before inclusion for ${finalHash}`)
      return
    }

    if (receipt.status !== "success") {
      shouldCleanupApproval = true
      console.error(`Execution reverted for ${finalHash}`)
      return
    }

    if (hasPayoutV4Binding(decoded)) {
      await options.onPayoutV4PoolWithdrawalConfirmed?.((finalHash || submittedHash) as Hex)
    }

    seenNullifiers.add(nullifierHash.toLowerCase())
    try {
      const heartbeat = await postRelayerHeartbeat(account)
      if (!heartbeat.sent) {
        console.log("Registry heartbeat skipped: RELAYER_REGISTRY_API_BASE_URL not configured.")
      }
    } catch (heartbeatError: any) {
      console.error(`Relayer heartbeat error: ${heartbeatError.message || heartbeatError}`)
    }
    console.log(`Relayed ${finalHash}`)
  } catch (e: any) {
    const message = String(e?.message || e)

    if (decoded && hasPayoutV4Binding(decoded) && options.allowPayoutV4PoolWithdrawal) {
      throw e
    }
    if (decoded && hasPayoutV4Binding(decoded) && options.source === "inbox") {
      throw e
    }

    if (!submittedHash && isRetryablePreSubmitError(e) && attempt < preSubmitRetryLimit) {
      shouldCleanupApproval = true
      const delayMs = preSubmitRetryBackoffMs * 2 ** attempt
      console.error(
        `Retrying bundle in ${delayMs}ms after transient pre-submit error (${attempt + 1}/${preSubmitRetryLimit}): ${message}`
      )
      setTimeout(() => {
        void processBundle(raw, attempt + 1)
      }, delayMs)
      return
    }

    if (!submittedHash) {
      shouldCleanupApproval = true

      if (isRetryablePreSubmitError(e)) {
        persistedForReconciliation = true
        await persistPendingExecution({
          version: 1,
          recordedAt: Math.floor(Date.now() / 1000),
          phase: "pre_submit_exhausted",
          attempt,
          relayerAddress: account.address,
          pool: decoded ? decoded.pool : null,
          nullifierHash,
          submittedHash: null,
          approvalToken,
          approvalSpender,
          reason: message,
          rawBundle: raw
        })
        console.error(`Persisted exhausted pre-submit bundle: ${message}`)
      } else {
        console.error(`Dropped bundle: ${message}`)
      }
      return
    }

    persistedForReconciliation = true
    await persistPendingExecution({
      version: 1,
      recordedAt: Math.floor(Date.now() / 1000),
      phase: "submitted_receipt_unknown",
      attempt,
      relayerAddress: account.address,
      pool: decoded ? decoded.pool : null,
      nullifierHash,
      submittedHash: finalHash || submittedHash,
      approvalToken,
      approvalSpender,
      reason: message,
      rawBundle: raw
    })
    console.error(`Persisted pending execution ${finalHash || submittedHash}: ${message}`)
  } finally {
    if (inFlightNullifierKey) {
      inFlightNullifiers.delete(inFlightNullifierKey)
    }

    if (approvalToken && approvalSpender && (shouldCleanupApproval || !submittedHash) && !persistedForReconciliation) {
      try {
        requirePhase3BroadcastEnabled("cross-chain fee approval cleanup")
        await safeApproveExactRelayer({
          token: approvalToken,
          spender: approvalSpender,
          amount: 0n,
          owner: account.address,
          publicClient,
          walletClient
        })
      } catch (cleanupError: any) {
        console.error(`Relayer cleanup error: ${cleanupError.message || cleanupError}`)
      }
    }
  }
}

async function pollRelayInbox() {
  if (
    process.env.PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED !== "true" &&
    process.env.PHASE3_POOL_V3_RELAYER_ENABLED !== "true"
    && process.env.PHASE3_POOL_V4_RELAYER_ENABLED !== "true"
  ) return
  const records = await claimRelayInboxBatch(account.address)
  for (const record of records) {
    try {
      console.log(`Processing relay inbox bundle ${record.bundleKey}`)
      await processBundle(record.rawBundle, 0, { source: "inbox" })
      await markRelayInboxProcessed(record.id)
    } catch (error: any) {
      const message = String(error?.message || error)
      const redacted = message.replace(/0x[a-fA-F0-9]{16,}/gu, "[redacted]").slice(0, 512)
      console.error(`Relay inbox processing error: ${redacted}`)
      if (message === "POOL_V4_CANONICAL_REVERT") { await markRelayInboxProcessed(record.id, "POOL_V4_CANONICAL_REVERT"); continue }
      if (message === "Relay fee schedule is expired.") {
        await markRelayInboxProcessed(record.id, "ROUTE_EXPIRED")
        continue
      }
      await resetRelayInboxClaim(
        record.id,
        redacted,
        error instanceof RelayInboxDeferredError ? error.retryAfterSeconds : 15
      )
    }
  }
}

async function main() {
  if (!relayerAddressEnv) {
    throw new Error("RELAYER_ADDRESS missing")
  }
  if (relayerAddressEnv !== account.address.toLowerCase()) {
    throw new Error("RELAYER_ADDRESS must equal the address derived from RELAYER_PRIVATE_KEY")
  }

  const receivingHost = await createReceivingBotHostV4({ account, env: process.env })
  await syncRelayerRegistryKey()
  startRelayerOwnedExecutionWorkerLoop({
    broadcaster: preparedTransactionBroadcaster,
    dataSource: receivingHost?.dataSource,
    receivingV4: receivingHost
  })
  startPayoutV3ExecutionWorkerLoop({
    publicClient,
    broadcaster: preparedTransactionBroadcaster
  })
  startPayoutV5ExecutionLoop()
  startPayoutV6ExecutionLoop()
  startPayoutV7ExecutionLoop({ account, chainId: tempoChainId })

  console.log(`Relayer listening as ${account.address}`)

  await startWakuRelay(async (payloadBytes) => {
    try {
      console.log(`Received Waku payload (${payloadBytes.byteLength} bytes)`)
      if (payloadBytes.byteLength > maxPayloadBytes) {
        console.error("Dropped oversized payload")
        return
      }

      const rawPayload = JSON.parse(new TextDecoder().decode(payloadBytes))
      const bundles = Array.isArray(rawPayload) ? rawPayload : [rawPayload]

      for (const raw of bundles) {
        await processBundle(raw, 0)
      }
    } catch (e: any) {
      console.error(`Relayer error: ${e.message || e}`)
    }
  })

  await pollRelayInbox()
  setInterval(() => {
    void pollRelayInbox().catch((error: any) => {
      console.error(`Relay inbox poll error: ${error?.message || error}`)
    })
  }, inboxPollIntervalMs)
  setInterval(() => {
    void syncRelayerRegistryKey()
  }, registrySyncIntervalMs)
}

main().catch(console.error)
