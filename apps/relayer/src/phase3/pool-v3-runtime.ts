import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem"
import {
  parlyPayoutWithdrawalExecutorV2Abi,
  tempoShieldedPoolV3Abi
} from "@parly/protocol-abis"
import type { SignedRelayExecutionFeeScheduleV2 } from "@parly/shared-types"
import { normalizeSignedRelayExecutionFeeScheduleV2 } from "./relay-execution-fee-schedule-v2.js"

const HASH_RE = /^0x[a-fA-F0-9]{64}$/u
const HEX_RE = /^0x(?:[a-fA-F0-9]{2})+$/u
const BYTES_RE = /^0x(?:[a-fA-F0-9]{2})*$/u
const UINT_RE = /^(0|[1-9][0-9]*)$/u
const MAX_UINT256_DECIMAL_DIGITS = 78
const SIGNATURE_RE = /^0x[a-fA-F0-9]{130}$/u
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex
const POOL_PAYLOAD_DOMAIN = keccak256(new TextEncoder().encode("PARLY_POOL_V3_WITHDRAWAL_PAYLOAD_V1"))
const PAYOUT_BATCH_DOMAIN = keccak256(new TextEncoder().encode("PARLY_PAYOUT_BATCH_V6"))

export type PoolV3ProofPayload = {
  version: 2
  poolVersion: 3
  verifierArtifactHash: Hex
  executionMode: 0 | 1
  pool: Address
  pA: [Hex, Hex]
  pB: [[Hex, Hex], [Hex, Hex]]
  pC: [Hex, Hex]
  pubSignals: string[]
  recipients: Address[]
  amounts: string[]
  settlementDomains: number[]
  newChangeCommitment: Hex
  newChangeEnvelope: Hex
  executorFee: string
  feeSchedule: SignedRelayExecutionFeeScheduleV2
}

export type PoolV3RuntimeConfig = {
  chainId: number
  settlementDomainId: number
  relayer: Address
  proofExecutor?: Address
  pools: ReadonlyMap<string, Hex>
  maximumExecutorFeeByMode: ReadonlyMap<0 | 1, bigint>
  maximumScheduleValiditySeconds: number
}

export function readPoolV3RuntimeConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  chainId: number,
  relayer: Address
) {
  if (env.PHASE3_POOL_V3_RELAYER_ENABLED !== "true") {
    return { enabled: false as const, reason: "pool_v3_relayer_disabled" as const }
  }
  const artifact = hash(env.PHASE3_POOL_V3_VERIFIER_ARTIFACT_HASH, "PoolV3 verifier artifact hash")
  const pools = new Map<string, Hex>()
  for (const name of ["PHASE3_USDC_POOL_V3", "PHASE3_USDT_POOL_V3"] as const) {
    const raw = env[name]?.trim()
    if (!raw) throw new Error(`${name} is required when the PoolV3 relayer is enabled.`)
    const pool = address(raw, name)
    if (pools.has(pool.toLowerCase())) throw new Error("PoolV3 relayer pools must be distinct.")
    pools.set(pool.toLowerCase(), artifact)
  }
  const maximumExecutorFeeByMode = new Map<0 | 1, bigint>([
    [
      0,
      requiredPositiveUintEnv(
        env.PHASE3_POOL_V3_NORMAL_MAX_EXECUTOR_FEE,
        "PHASE3_POOL_V3_NORMAL_MAX_EXECUTOR_FEE"
      )
    ],
    [
      1,
      requiredPositiveUintEnv(
        env.PHASE3_POOL_V3_CONSOLIDATION_MAX_EXECUTOR_FEE,
        "PHASE3_POOL_V3_CONSOLIDATION_MAX_EXECUTOR_FEE"
      )
    ]
  ])
  const maximumScheduleValiditySeconds = Number(
    env.PHASE3_POOL_V3_MAX_FEE_SCHEDULE_VALIDITY_SECONDS ?? "300"
  )
  if (
    !Number.isSafeInteger(maximumScheduleValiditySeconds) ||
    maximumScheduleValiditySeconds < 30 ||
    maximumScheduleValiditySeconds > 900
  ) {
    throw new Error(
      "PHASE3_POOL_V3_MAX_FEE_SCHEDULE_VALIDITY_SECONDS must be between 30 and 900."
    )
  }
  return {
    enabled: true as const,
    config: {
      chainId,
      settlementDomainId: chainId,
      relayer: address(relayer, "PoolV3 relayer"),
      pools,
      maximumExecutorFeeByMode,
      maximumScheduleValiditySeconds
    } satisfies PoolV3RuntimeConfig
  }
}

export function poolV3ActiveNullifiers(payload: PoolV3ProofPayload) {
  return payload.pubSignals.slice(11, 15)
    .map(BigInt)
    .filter((value) => value !== 0n)
    .map((value) => `0x${value.toString(16).padStart(64, "0")}` as Hex)
}

export type PayoutV6ExecutionPayload = {
  version: 6
  adapter: Address
  withdrawalExecutor: Address
  lease: {
    intentHash: Hex
    adapter: Address
    pool: Address
    payloadHash: Hex
    operator: Address
    token: Address
    maximumExecutorFee: string
    nonce: Hex
    expiry: string
  }
  leaseSignature: Hex
  poolCall: Hex
  intentHashes: Hex[]
  sourceFeeAllocations: string[]
}

export type PayoutV6RuntimeConfig = {
  adapter: Address
  withdrawalExecutor: Address
  relayer: Address
  pools: ReadonlySet<string>
  nowSeconds?: number
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unknown or missing field.`)
  }
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${label} must be a non-zero address.`)
  }
  return getAddress(value) as Address
}

function addressOrZero(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be an address.`)
  }
  return getAddress(value) as Address
}

function hash(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH_RE.test(value)) throw new Error(`${label} must be bytes32.`)
  return value.toLowerCase() as Hex
}

function hex(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX_RE.test(value)) throw new Error(`${label} must be non-empty hex bytes.`)
  return value.toLowerCase() as Hex
}

function bytes(value: unknown, label: string) {
  if (typeof value !== "string" || !BYTES_RE.test(value)) throw new Error(`${label} must be hex bytes.`)
  return value.toLowerCase() as Hex
}

function uint(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > MAX_UINT256_DECIMAL_DIGITS ||
    !UINT_RE.test(value)
  ) throw new Error(`${label} must be an unsigned integer string.`)
  return BigInt(value)
}

function requiredPositiveUintEnv(value: unknown, label: string) {
  const parsed = uint(value, label)
  if (parsed === 0n) throw new Error(`${label} must be greater than zero.`)
  return parsed
}

function number(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an unsigned integer.`)
  }
  return value
}

function tuple2(value: unknown, label: string): [Hex, Hex] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must contain two field elements.`)
  return [hex(value[0], `${label}[0]`), hex(value[1], `${label}[1]`)]
}

function payoutBatchHash(intentHashes: readonly Hex[]) {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32[]" }],
    [PAYOUT_BATCH_DOMAIN, [...intentHashes]]
  ))
}

export function validatePoolV3ProofPayload(
  value: unknown,
  config: PoolV3RuntimeConfig
): PoolV3ProofPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PoolV3 payload is invalid.")
  const payload = value as Record<string, unknown>
  exactKeys(payload, [
    "version", "poolVersion", "verifierArtifactHash", "executionMode", "pool",
    "pA", "pB", "pC", "pubSignals", "recipients", "amounts", "settlementDomains",
    "newChangeCommitment", "newChangeEnvelope", "executorFee", "feeSchedule"
  ], "PoolV3 payload")
  if (payload.version !== 2 || payload.poolVersion !== 3) throw new Error("Unknown private-bundle version.")
  if (payload.executionMode !== 0 && payload.executionMode !== 1) {
    throw new Error("PoolV3 private relayer accepts only normal or consolidation mode.")
  }

  const pool = address(payload.pool, "PoolV3 pool")
  const expectedArtifact = config.pools.get(pool.toLowerCase())
  if (!expectedArtifact || hash(payload.verifierArtifactHash, "PoolV3 verifier artifact hash") !== expectedArtifact) {
    throw new Error("PoolV3 pool or verifier artifact is not approved.")
  }
  if (!Array.isArray(payload.pB) || payload.pB.length !== 2) throw new Error("PoolV3 pB is invalid.")
  const pA = tuple2(payload.pA, "PoolV3 pA")
  const pB = [tuple2(payload.pB[0], "PoolV3 pB[0]"), tuple2(payload.pB[1], "PoolV3 pB[1]")] as [[Hex, Hex], [Hex, Hex]]
  const pC = tuple2(payload.pC, "PoolV3 pC")
  if (!Array.isArray(payload.pubSignals) || payload.pubSignals.length !== 57 ||
      payload.pubSignals.some((entry) =>
        typeof entry !== "string" || entry.length > MAX_UINT256_DECIMAL_DIGITS || !UINT_RE.test(entry)
      )) {
    throw new Error("PoolV3 payload must contain exactly 57 unsigned public signals.")
  }
  const signals = payload.pubSignals.map(BigInt)
  if (signals[19] !== BigInt(config.settlementDomainId) ||
      signals[20] !== BigInt(config.chainId) ||
      signals[21] !== BigInt(pool) ||
      signals[22] !== 3n ||
      signals[23] !== BigInt(payload.executionMode)) {
    throw new Error("PoolV3 proof domain or mode does not match the runtime tuple.")
  }
  const proofExecutor = address(config.proofExecutor ?? config.relayer, "PoolV3 proof executor")
  if (signals[56] !== BigInt(proofExecutor)) throw new Error("PoolV3 proof is bound to a different executor.")
  const inputCount = signals.slice(11, 15).filter((entry) => entry !== 0n).length
  if (inputCount < 1 || inputCount > 4 || signals[15] !== BigInt(inputCount)) {
    throw new Error("PoolV3 active input count is invalid.")
  }
  const activeNullifiers = signals.slice(11, 15).filter((entry) => entry !== 0n)
  if (new Set(activeNullifiers.map(String)).size !== activeNullifiers.length) {
    throw new Error("PoolV3 payload contains duplicate nullifiers.")
  }

  if (!Array.isArray(payload.recipients) || payload.recipients.length !== 10 ||
      !Array.isArray(payload.amounts) || payload.amounts.length !== 10 ||
      !Array.isArray(payload.settlementDomains) || payload.settlementDomains.length !== 10) {
    throw new Error("PoolV3 payload must contain exactly ten outputs.")
  }
  const recipients = payload.recipients.map((entry, index) => addressOrZero(entry, `PoolV3 recipient ${index}`))
  const amounts = payload.amounts.map((entry, index) => uint(entry, `PoolV3 amount ${index}`))
  const settlementDomains = payload.settlementDomains.map((entry, index) =>
    number(entry, `PoolV3 settlement domain ${index}`, 0xffffffff)
  )
  for (let index = 0; index < 10; index += 1) {
    if (signals[24 + index] !== BigInt(recipients[index]!) ||
        signals[34 + index] !== amounts[index] ||
        signals[44 + index] !== BigInt(settlementDomains[index]!)) {
      throw new Error("PoolV3 output does not match its public signals.")
    }
    if (settlementDomains[index] !== config.settlementDomainId) {
      throw new Error("PoolV3 cross-domain output is not supported.")
    }
    if ((amounts[index] === 0n) !== (recipients[index] === "0x0000000000000000000000000000000000000000")) {
      throw new Error("PoolV3 output padding is invalid.")
    }
  }
  const outputTotal = amounts.reduce((sum, amount) => sum + amount, 0n)
  const executorFee = uint(payload.executorFee, "PoolV3 executor fee")
  if (executorFee === 0n || signals[16] !== executorFee) {
    throw new Error("PoolV3 executor fee does not match its public signal.")
  }
  const feeSchedule = normalizeSignedRelayExecutionFeeScheduleV2(payload.feeSchedule)
  const changeCommitment = hash(payload.newChangeCommitment, "PoolV3 change commitment")
  const changeEnvelope = bytes(payload.newChangeEnvelope, "PoolV3 change envelope")
  if (signals[54] !== BigInt(changeCommitment)) throw new Error("PoolV3 change commitment does not match its public signal.")
  if (changeCommitment === ZERO_HASH) {
    if (signals[55] !== 0n || changeEnvelope !== "0x") throw new Error("PoolV3 zero-change envelope is invalid.")
  } else {
    if (changeEnvelope === "0x" || BigInt(keccak256(changeEnvelope)) % SNARK_SCALAR_FIELD !== signals[55]) {
      throw new Error("PoolV3 change envelope does not match its public signal.")
    }
  }
  if (payload.executionMode === 0 && outputTotal === 0n) throw new Error("PoolV3 normal execution requires an output.")
  if (payload.executionMode === 1 && (inputCount < 2 || outputTotal !== 0n || signals[17] !== 0n || changeCommitment === ZERO_HASH)) {
    throw new Error("PoolV3 consolidation payload is invalid.")
  }

  return {
    version: 2,
    poolVersion: 3,
    verifierArtifactHash: expectedArtifact,
    executionMode: payload.executionMode,
    pool,
    pA,
    pB,
    pC,
    pubSignals: payload.pubSignals as string[],
    recipients,
    amounts: payload.amounts as string[],
    settlementDomains,
    newChangeCommitment: changeCommitment,
    newChangeEnvelope: changeEnvelope,
    executorFee: executorFee.toString(),
    feeSchedule
  }
}

export function preparePoolV3Transaction(payload: PoolV3ProofPayload) {
  return {
    to: payload.pool,
    functionName: "batchWithdrawV3" as const,
    data: encodeFunctionData({
      abi: tempoShieldedPoolV3Abi,
      functionName: "batchWithdrawV3",
      args: [
        payload.pA.map(BigInt) as [bigint, bigint],
        payload.pB.map((row) => row.map(BigInt)) as [[bigint, bigint], [bigint, bigint]],
        payload.pC.map(BigInt) as [bigint, bigint],
        payload.pubSignals.map(BigInt) as any,
        payload.recipients,
        payload.amounts.map(BigInt),
        payload.settlementDomains,
        payload.newChangeCommitment,
        payload.newChangeEnvelope
      ]
    })
  }
}

export function validatePayoutV6ExecutionPayload(
  value: unknown,
  config: PayoutV6RuntimeConfig
): PayoutV6ExecutionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("V6 execution payload is invalid.")
  const root = value as Record<string, unknown>
  exactKeys(root, [
    "version", "adapter", "withdrawalExecutor", "lease", "leaseSignature",
    "poolCall", "intentHashes", "sourceFeeAllocations"
  ], "V6 execution payload")
  if (root.version !== 6) throw new Error("Unknown payout execution version.")
  const adapter = address(root.adapter, "V6 adapter")
  const withdrawalExecutor = address(root.withdrawalExecutor, "V6 withdrawal executor")
  if (adapter !== getAddress(config.adapter) || withdrawalExecutor !== getAddress(config.withdrawalExecutor)) {
    throw new Error("V6 adapter or executor does not match the configured tuple.")
  }
  if (!root.lease || typeof root.lease !== "object" || Array.isArray(root.lease)) throw new Error("V6 lease is invalid.")
  const leaseValue = root.lease as Record<string, unknown>
  exactKeys(leaseValue, [
    "intentHash", "adapter", "pool", "payloadHash", "operator", "token",
    "maximumExecutorFee", "nonce", "expiry"
  ], "V6 lease")
  const lease = {
    intentHash: hash(leaseValue.intentHash, "V6 lease intent hash"),
    adapter: address(leaseValue.adapter, "V6 lease adapter"),
    pool: address(leaseValue.pool, "V6 lease pool"),
    payloadHash: hash(leaseValue.payloadHash, "V6 lease payload hash"),
    operator: address(leaseValue.operator, "V6 lease operator"),
    token: address(leaseValue.token, "V6 lease token"),
    maximumExecutorFee: uint(leaseValue.maximumExecutorFee, "V6 maximum executor fee").toString(),
    nonce: hash(leaseValue.nonce, "V6 lease nonce"),
    expiry: uint(leaseValue.expiry, "V6 lease expiry").toString()
  }
  if (lease.adapter !== adapter || lease.operator !== getAddress(config.relayer) ||
      !config.pools.has(lease.pool.toLowerCase())) {
    throw new Error("V6 lease is outside the configured runtime tuple.")
  }
  const now = BigInt(config.nowSeconds ?? Math.floor(Date.now() / 1000))
  if (BigInt(lease.expiry) < now) throw new Error("V6 lease is expired.")
  if (typeof root.leaseSignature !== "string" || !SIGNATURE_RE.test(root.leaseSignature)) {
    throw new Error("V6 lease signature is invalid.")
  }
  const poolCall = hex(root.poolCall, "V6 pool call")
  const decoded = decodeFunctionData({ abi: tempoShieldedPoolV3Abi, data: poolCall })
  if (decoded.functionName !== "batchWithdrawV3") throw new Error("V6 pool selector is not batchWithdrawV3.")
  const args = decoded.args as readonly unknown[]
  const signals = args[3] as readonly bigint[]
  if (signals.length !== 57 || signals[20] !== 4217n || signals[21] !== BigInt(lease.pool) ||
      signals[22] !== 3n || signals[23] !== 0n || signals[56] !== BigInt(withdrawalExecutor)) {
    throw new Error("V6 pool call has the wrong version, mode, domain, pool, or executor.")
  }
  if (!Array.isArray(root.intentHashes) || root.intentHashes.length < 1 || root.intentHashes.length > 10 ||
      !Array.isArray(root.sourceFeeAllocations) || root.sourceFeeAllocations.length !== root.intentHashes.length) {
    throw new Error("V6 child funding set is invalid.")
  }
  const intentHashes = root.intentHashes.map((entry, index) => hash(entry, `V6 intent ${index}`))
  if (new Set(intentHashes).size !== intentHashes.length) throw new Error("V6 child funding set contains duplicates.")
  const sourceFeeAllocations = root.sourceFeeAllocations.map((entry, index) =>
    uint(entry, `V6 source fee allocation ${index}`).toString()
  )
  const expectedIntentHash = intentHashes.length === 1 ? intentHashes[0]! : payoutBatchHash(intentHashes)
  if (lease.intentHash !== expectedIntentHash) throw new Error("V6 lease intent group does not match its ordered children.")
  const expectedPayloadHash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32[]" }, { type: "uint256[]" }],
    [POOL_PAYLOAD_DOMAIN, keccak256(poolCall), intentHashes, sourceFeeAllocations.map(BigInt)]
  ))
  if (lease.payloadHash !== expectedPayloadHash) throw new Error("V6 payload hash does not match the exact executor payload.")
  if (sourceFeeAllocations.reduce((sum, fee) => sum + BigInt(fee), 0n) !== signals[16] ||
      BigInt(lease.maximumExecutorFee) < signals[16]) {
    throw new Error("V6 source fee allocation does not match the PoolV3 proof.")
  }

  return {
    version: 6,
    adapter,
    withdrawalExecutor,
    lease,
    leaseSignature: root.leaseSignature.toLowerCase() as Hex,
    poolCall,
    intentHashes,
    sourceFeeAllocations
  }
}

export function preparePayoutV6WithdrawalTransaction(payload: PayoutV6ExecutionPayload) {
  return {
    to: payload.withdrawalExecutor,
    functionName: "executeWithdrawal" as const,
    data: encodeFunctionData({
      abi: parlyPayoutWithdrawalExecutorV2Abi,
      functionName: "executeWithdrawal",
      args: [
        {
          ...payload.lease,
          maximumExecutorFee: BigInt(payload.lease.maximumExecutorFee),
          expiry: BigInt(payload.lease.expiry)
        },
        payload.leaseSignature,
        payload.poolCall,
        payload.intentHashes,
        payload.sourceFeeAllocations.map(BigInt)
      ]
    })
  }
}

export function redactRelayerRuntimeError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/0x[a-fA-F0-9]{16,}/gu, "[redacted]")
    .replace(/[A-Za-z0-9+/=_-]{48,}/gu, "[redacted]")
    .slice(0, 256)
}
