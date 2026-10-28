import { createHash, timingSafeEqual } from "node:crypto"
import type {
  Phase3InternalPaymentAttemptRecord,
  Phase3InternalVirtualDepositObservationRecord,
  Phase3PaymentContext,
  Phase3RouteKind
} from "@parly/shared-types"
import { decodeTip1022VirtualAddress } from "./tip1022.js"

export {
  decodeTip1022VirtualAddress,
  deriveTip1022VirtualAddress,
  isTip1022VirtualAddress,
  TEMPO_TIP1022_ADDRESS_REGISTRY,
  TIP1022_VIRTUAL_ADDRESS_MAGIC
} from "./tip1022.js"

export type Phase3AttemptStatus =
  | "awaiting_payment"
  | "payment_detected"
  | "ignored"
  | "settlement_in_progress"
  | "shielding"
  | "completed"
  | "refund_available"
  | "refund_claimed"
  | "expired"
  | "cancelled"
  | "manual_review"
  | "failed"

export type Phase3ObservationMatchStatus =
  | "exact"
  | "ignored_dust"
  | "underpayment"
  | "overpayment"
  | "duplicate_payment"
  | "late"
  | "wrong_token"

export type Tip1022Transfer = {
  token: string
  from: string
  to: string
  amount: bigint
  txHash: string
  logIndex: number
  blockNumber: bigint
}

export type Tip1022TransferPairInput = {
  paymentAttemptId: string
  routeHash: string
  paymentTagHash: string
  expectedRouteHash: string
  expectedPaymentTagHash: string
  expectedToken: string
  expectedVirtualAddress: string
  expectedMasterAddress: string
  first: Tip1022Transfer
  second: Tip1022Transfer
  transactionTransfers: readonly Tip1022Transfer[]
}

export type Tip1022Observation = {
  observationId: string
  transferPairId: string
  paymentAttemptId: string
  routeHash: string
  paymentTagHash: string
  token: string
  amount: bigint
  virtualAddress: string
  masterAddress: string
  txHash: string
  firstLogIndex: number
  secondLogIndex: number
  observedBlockNumber: bigint
}

export type VirtualDepositEventRecord = Tip1022Observation & {
  id: string
  custodyClass: number
  attemptStatus: Phase3AttemptStatus
  timestamp: bigint
}

export type VirtualDepositAttemptState = {
  paymentAttemptId: string
  expectedToken: string
  expectedAmount: bigint
  dustThreshold: bigint
  expiresAt: bigint
  status: Phase3AttemptStatus
  observationIds: string[]
  canonicalObservationId?: string
  lastMatchStatus?: Phase3ObservationMatchStatus
  manualReviewRequired?: boolean
}

export type DepositV2Record = {
  id: string
  commitment: string
  amount: bigint
  leafIndex: number
  assetId: number
  kind: number
  pool: string
  txHash: string
  timestamp: bigint
}

export type PoolV3WithdrawalRecord = {
  id: string
  nullifierSetHash: string
  nullifierHashes: readonly string[]
  inputCount: number
  executor: string
  protocolFee: bigint
  sourceExecutorFee: bigint
  childKeyCount: number
  assetId: number
  pool: string
  txHash: string
  timestamp: bigint
  executionMode: number
}

export type PoolV3WithdrawalFact = Omit<PoolV3WithdrawalRecord, "nullifierHashes"> & {
  poolVersion: 3
  circuitVersion: 3
  consolidation: boolean
}

export type PoolV3NullifierFact = {
  id: string
  withdrawalId: string
  nullifierIndex: number
  nullifierHash: string
  assetId: number
  pool: string
  txHash: string
  timestamp: bigint
}

export type PoolV2SettlementCompletionFact = {
  kind: "poolv2_settlement_completion_fact"
  internalPaymentAttemptId: string
  depositEventId: string
  commitment: string
  amount: string
  assetId: number
  pool: string
  txHash: string
  timestamp: string
  confirmed: boolean
}

export type PayoutEscrowTransfer = {
  token: string
  from: string
  to: string
  amount: bigint
  txHash: string
  logIndex: number
}

export type PayoutEscrowReceiptMatch = {
  intentHash: string
  sourcePool: string
  escrowAddress: string
  token: string
  amount: bigint
  poolWithdrawalTxHash: string
  poolWithdrawalLogIndex: number
  escrowTransferLogIndex: number
  status: "escrow_receipt_confirmed"
}

export type LegacyV1DepositRecord = DepositV2Record & {
  depositor: string
}

export type Phase3IndexerSourceConfig = {
  address: `0x${string}`
  startBlock: number
}

export type Phase3IndexerConfig =
  | { enabled: false }
  | {
      enabled: true
      environment: string
      usdcPoolV2: Phase3IndexerSourceConfig
      usdtPoolV2: Phase3IndexerSourceConfig
      usdcPoolV3?: Phase3IndexerSourceConfig
      usdtPoolV3?: Phase3IndexerSourceConfig
      ingressReceiver: Phase3IndexerSourceConfig
      virtualDepositMaster: Phase3IndexerSourceConfig
      relayerOperatorRegistry: Phase3IndexerSourceConfig
      payoutAdapter?: Phase3IndexerSourceConfig
      payoutAdapterV3?: Phase3IndexerSourceConfig
      payoutAdapterV4?: Phase3IndexerSourceConfig
      payoutAdapterV5?: Phase3IndexerSourceConfig
      payoutAdapterV6?: Phase3IndexerSourceConfig
      payoutLiabilityVault?: Phase3IndexerSourceConfig
      payoutProofVerifier?: Phase3IndexerSourceConfig
    }

type EnvLike = Record<string, string | undefined>

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u
const HASH32_RE = /^0x[a-fA-F0-9]{64}$/u
const PHASE3_PUBLIC_REDACTED_FIELDS = new Set([
  "authorityWallet",
  "depositor",
  "destinationRecipient",
  "envelope",
  "escrowAddress",
  "escrowSalt",
  "encryptedRefundWallet",
  "masterAddress",
  "observationId",
  "payerAddress",
  "payerWallet",
  "paymentAttemptId",
  "paymentTag",
  "paymentTagHash",
  "privateCommitment",
  "privateNoteId",
  "privateNoteIdentifier",
  "noteSecret",
  "noteSecrets",
  "nullifierHashes",
  "rawNullifierArray",
  "providerRouteAddress",
  "providerRouteWallet",
  "providerRequestId",
  "providerRequestIdHash",
  "rawEnvelope",
  "rawRefundClaimant",
  "recipientAuthorityAddress",
  "recipientAuthorityWallet",
  "refundAddress",
  "refundRecipientCommitment",
  "refundSalt",
  "refundWallet",
  "routeHash",
  "sourceAddress",
  "sourcePool",
  "sourceWithdrawalBlockHash",
  "sourceWithdrawalBlockNumber",
  "batchWithdrawalLogIndex",
  "provenanceAttestationId",
  "sourceWithdrawalLogIndex",
  "sourceWithdrawalTxHash",
  "sourcePayer",
  "sourceWallet",
  "statusAccessToken",
  "statusAccessTokenHash",
  "transferPairId",
  "userTag",
  "virtualAddress"
])

const ZERO_HASH = `0x${"00".repeat(32)}`

function normalize(value: string) {
  return value.toLowerCase()
}

function assertEqual(label: string, left: string | bigint, right: string | bigint) {
  if (typeof left === "string" && typeof right === "string") {
    if (normalize(left) !== normalize(right)) throw new Error(`${label} mismatch`)
    return
  }
  if (left !== right) throw new Error(`${label} mismatch`)
}

function assertNonZeroHash32(label: string, value: string) {
  if (!HASH32_RE.test(value) || /^0x0{64}$/iu.test(value)) {
    throw new Error(`${label} must be a non-zero 32-byte hex value`)
  }
}

function hashParts(parts: Array<string | number | bigint>) {
  const hash = createHash("sha256")
  for (const part of parts) {
    hash.update(String(part))
    hash.update("\u0000")
  }
  return `0x${hash.digest("hex")}`
}

function sameTip1022Transfer(left: Tip1022Transfer, right: Tip1022Transfer) {
  return (
    normalize(left.token) === normalize(right.token) &&
    normalize(left.from) === normalize(right.from) &&
    normalize(left.to) === normalize(right.to) &&
    left.amount === right.amount &&
    normalize(left.txHash) === normalize(right.txHash) &&
    left.logIndex === right.logIndex &&
    left.blockNumber === right.blockNumber
  )
}

function assertTip1022TransactionContext(input: Tip1022TransferPairInput) {
  const { first, second, transactionTransfers } = input
  if (!Array.isArray(transactionTransfers) || transactionTransfers.length < 2) {
    throw new Error("TIP-1022 observation requires transaction-local transfer context")
  }

  const logIndexes = new Set<number>()
  for (const transfer of transactionTransfers) {
    assertEqual("transaction context hash", transfer.txHash, first.txHash)
    assertEqual("transaction context block number", transfer.blockNumber, first.blockNumber)
    if (logIndexes.has(transfer.logIndex)) {
      throw new Error("TIP-1022 transaction context contains duplicate log index")
    }
    logIndexes.add(transfer.logIndex)
  }

  if (
    !transactionTransfers.some((transfer) => sameTip1022Transfer(transfer, first)) ||
    !transactionTransfers.some((transfer) => sameTip1022Transfer(transfer, second))
  ) {
    throw new Error("TIP-1022 selected transfer pair missing from transaction context")
  }

  for (const transfer of transactionTransfers) {
    if (transfer.logIndex <= first.logIndex || transfer.logIndex >= second.logIndex) continue
    if (
      normalize(transfer.token) === normalize(first.token) &&
      (normalize(transfer.from) === normalize(input.expectedVirtualAddress) ||
        normalize(transfer.to) === normalize(input.expectedVirtualAddress))
    ) {
      throw new Error("TIP-1022 ambiguous transfer pair")
    }
  }
}

export function createDepositV2Record(record: DepositV2Record): DepositV2Record {
  return { ...record }
}

export function createPoolV2SettlementCompletionFact(
  record: Omit<PoolV2SettlementCompletionFact, "kind" | "amount" | "timestamp"> & {
    amount: bigint | string
    timestamp: bigint | string
  }
): PoolV2SettlementCompletionFact {
  return {
    kind: "poolv2_settlement_completion_fact",
    internalPaymentAttemptId: record.internalPaymentAttemptId,
    depositEventId: record.depositEventId,
    commitment: record.commitment,
    amount: record.amount.toString(),
    assetId: record.assetId,
    pool: record.pool,
    txHash: record.txHash,
    timestamp: record.timestamp.toString(),
    confirmed: record.confirmed
  }
}

export function matchPoolV2WithdrawalToEscrowReceipt(input: {
  intentHash: string
  expectedPoolV2: string
  escrowAddress: string
  token: string
  amount: bigint
  poolWithdrawalTxHash: string
  poolWithdrawalLogIndex: number
  indexedTransfers: readonly PayoutEscrowTransfer[]
}): PayoutEscrowReceiptMatch {
  const matches = input.indexedTransfers.filter(
    (transfer) =>
      normalize(transfer.token) === normalize(input.token) &&
      normalize(transfer.from) === normalize(input.expectedPoolV2) &&
      normalize(transfer.to) === normalize(input.escrowAddress) &&
      transfer.amount === input.amount &&
      normalize(transfer.txHash) === normalize(input.poolWithdrawalTxHash) &&
      transfer.logIndex < input.poolWithdrawalLogIndex
  )
  if (matches.length !== 1) {
    throw new Error("PoolV2 payout requires exactly one indexed escrow receipt transfer")
  }

  return {
    intentHash: input.intentHash,
    sourcePool: normalize(input.expectedPoolV2),
    escrowAddress: normalize(input.escrowAddress),
    token: normalize(input.token),
    amount: input.amount,
    poolWithdrawalTxHash: normalize(input.poolWithdrawalTxHash),
    poolWithdrawalLogIndex: input.poolWithdrawalLogIndex,
    escrowTransferLogIndex: matches[0]!.logIndex,
    status: "escrow_receipt_confirmed"
  }
}

export function getPoolV2CampaignCreditDecision() {
  return {
    allowed: false as const,
    reason: "authenticated_beneficiary_attribution_required" as const
  }
}

export function createLegacyV1DepositRecord(record: LegacyV1DepositRecord): LegacyV1DepositRecord {
  return { ...record }
}

export function createTip1022Observation(
  input: Tip1022TransferPairInput,
  consumedTransferPairIds: ReadonlySet<string> = new Set(),
  consumedObservationIds: ReadonlySet<string> = new Set()
): Tip1022Observation {
  const { first, second } = input
  if (!first || !second) {
    throw new Error("TIP-1022 observation requires paired transfer logs")
  }
  decodeTip1022VirtualAddress(input.expectedVirtualAddress)
  assertNonZeroHash32("route hash", input.routeHash)
  assertNonZeroHash32("payment tag hash", input.paymentTagHash)
  assertEqual("route hash", input.routeHash, input.expectedRouteHash)
  assertEqual("payment tag hash", input.paymentTagHash, input.expectedPaymentTagHash)
  assertEqual("transaction hash", first.txHash, second.txHash)
  assertEqual("token", first.token, second.token)
  assertEqual("amount", first.amount, second.amount)
  assertEqual("block number", first.blockNumber, second.blockNumber)
  assertEqual("virtual address ingress", first.to, input.expectedVirtualAddress)
  assertEqual("virtual address forwarding", second.from, input.expectedVirtualAddress)
  assertEqual("master address", second.to, input.expectedMasterAddress)
  if (second.logIndex <= first.logIndex) {
    throw new Error("TIP-1022 observation requires ordered transfer logs")
  }
  if (normalize(first.from) === normalize(input.expectedMasterAddress)) {
    throw new Error("TIP-1022 master self-forward is not a net deposit")
  }
  assertTip1022TransactionContext(input)

  const transferPairId = hashParts([first.txHash, first.logIndex, second.logIndex])
  if (consumedTransferPairIds.has(transferPairId)) {
    throw new Error("TIP-1022 observation replayed")
  }

  const observationId = hashParts([
    first.txHash,
    first.logIndex,
    second.logIndex,
    first.token,
    first.amount,
    input.expectedVirtualAddress,
    input.expectedMasterAddress,
    first.blockNumber,
    input.routeHash,
    input.paymentTagHash
  ])
  if (consumedObservationIds.has(observationId)) {
    throw new Error("TIP-1022 observation id replayed")
  }
  return {
    observationId,
    transferPairId,
    paymentAttemptId: input.paymentAttemptId,
    routeHash: input.routeHash,
    paymentTagHash: input.paymentTagHash,
    token: normalize(first.token),
    amount: first.amount,
    virtualAddress: normalize(input.expectedVirtualAddress),
    masterAddress: normalize(input.expectedMasterAddress),
    txHash: normalize(first.txHash),
    firstLogIndex: first.logIndex,
    secondLogIndex: second.logIndex,
    observedBlockNumber: first.blockNumber
  }
}

export function createVirtualDepositEventRecord(
  observation: Tip1022Observation,
  details: Pick<VirtualDepositEventRecord, "custodyClass" | "attemptStatus" | "timestamp">
): VirtualDepositEventRecord {
  return {
    id: observation.observationId,
    ...observation,
    ...details
  }
}

function appendObservation(state: VirtualDepositAttemptState, observationId: string) {
  return state.observationIds.includes(observationId)
    ? [...state.observationIds]
    : [...state.observationIds, observationId]
}

export function applyVirtualDepositObservation(
  state: VirtualDepositAttemptState,
  observation: Tip1022Observation,
  observedAt: bigint
): VirtualDepositAttemptState {
  const next = {
    ...state,
    observationIds: appendObservation(state, observation.observationId)
  }

  if (state.canonicalObservationId) {
    return {
      ...next,
      lastMatchStatus: "duplicate_payment",
      manualReviewRequired: true
    }
  }
  if (normalize(observation.token) !== normalize(state.expectedToken)) {
    return {
      ...next,
      status: "manual_review",
      lastMatchStatus: "wrong_token",
      manualReviewRequired: true
    }
  }
  if (observation.amount < state.dustThreshold) {
    return {
      ...next,
      lastMatchStatus: "ignored_dust"
    }
  }
  if (observedAt > state.expiresAt) {
    return {
      ...next,
      status: "manual_review",
      lastMatchStatus: "late",
      manualReviewRequired: true
    }
  }
  if (observation.amount < state.expectedAmount) {
    return {
      ...next,
      status: "manual_review",
      lastMatchStatus: "underpayment",
      manualReviewRequired: true
    }
  }
  if (observation.amount > state.expectedAmount) {
    return {
      ...next,
      status: "manual_review",
      lastMatchStatus: "overpayment",
      manualReviewRequired: true
    }
  }

  return {
    ...next,
    status: "payment_detected",
    canonicalObservationId: observation.observationId,
    lastMatchStatus: "exact"
  }
}

function isPhase3PublicSensitiveField(key: string) {
  return (
    PHASE3_PUBLIC_REDACTED_FIELDS.has(key) ||
    /wallet(?:address)?$/iu.test(key) ||
    /envelope$/iu.test(key)
  )
}

export function redactPhase3IndexerPublicRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPhase3IndexerPublicRecord)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isPhase3PublicSensitiveField(key))
      .map(([key, nestedValue]) => [key, redactPhase3IndexerPublicRecord(nestedValue)])
  )
}

export function createPoolV3WithdrawalFacts(record: PoolV3WithdrawalRecord): {
  withdrawal: PoolV3WithdrawalFact
  nullifiers: PoolV3NullifierFact[]
} {
  if (!Number.isInteger(record.inputCount) || record.inputCount < 1 || record.inputCount > 4) {
    throw new Error("PoolV3 input count must be between 1 and 4")
  }
  if (record.nullifierHashes.length !== 4) {
    throw new Error("PoolV3 withdrawal must contain exactly four nullifier slots")
  }
  if (!Number.isInteger(record.executionMode) || record.executionMode < 0 || record.executionMode > 3) {
    throw new Error("PoolV3 execution mode must be between 0 and 3")
  }

  const nullifiers: PoolV3NullifierFact[] = []
  for (let index = 0; index < record.nullifierHashes.length; index++) {
    const nullifierHash = record.nullifierHashes[index]!
    if (!HASH32_RE.test(nullifierHash)) {
      throw new Error("PoolV3 nullifier must be a 32-byte hex value")
    }
    if (index >= record.inputCount) {
      if (normalize(nullifierHash) !== ZERO_HASH) {
        throw new Error("PoolV3 inactive nullifier slot must be zero")
      }
      continue
    }
    if (normalize(nullifierHash) === ZERO_HASH) {
      throw new Error("PoolV3 active nullifier slot cannot be zero")
    }
    nullifiers.push({
      id: `${record.id}:${index}`,
      withdrawalId: record.id,
      nullifierIndex: index,
      nullifierHash,
      assetId: record.assetId,
      pool: record.pool,
      txHash: record.txHash,
      timestamp: record.timestamp
    })
  }

  const { nullifierHashes: _privateCanonicalNullifiers, ...publicWithdrawal } = record
  return {
    withdrawal: {
      ...publicWithdrawal,
      poolVersion: 3,
      circuitVersion: 3,
      consolidation: record.executionMode === 1 || record.executionMode === 3
    },
    nullifiers
  }
}

function equalStatusTokenHashes(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}

export function createPublicStatusLookupResult(input: {
  expectedStatusAccessTokenHash?: string
  providedStatusAccessTokenHash?: string
  attempt?: Record<string, unknown>
}) {
  const { expectedStatusAccessTokenHash, providedStatusAccessTokenHash, attempt } = input
  if (
    !attempt ||
    !expectedStatusAccessTokenHash ||
    !providedStatusAccessTokenHash ||
    !equalStatusTokenHashes(expectedStatusAccessTokenHash, providedStatusAccessTokenHash)
  ) {
    return { found: false as const }
  }

  return {
    found: true as const,
    payment: redactPhase3IndexerPublicRecord(attempt)
  }
}

function requireEnv(env: EnvLike, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} missing`)
  return value
}

function requireAddress(env: EnvLike, name: string): `0x${string}` {
  const value = requireEnv(env, name)
  if (!ADDRESS_RE.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${name} must be a non-zero 20-byte hex address`)
  }
  return normalize(value) as `0x${string}`
}

function requireStartBlock(env: EnvLike, name: string) {
  const value = Number(requireEnv(env, name))
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function source(env: EnvLike, addressName: string, startBlockName: string): Phase3IndexerSourceConfig {
  return {
    address: requireAddress(env, addressName),
    startBlock: requireStartBlock(env, startBlockName)
  }
}

function assertPhase3MainnetConfig(env: EnvLike) {
  if (env.PARLY_ENV !== "mainnet") return
  if (requireEnv(env, "INDEXER_LAUNCH_SCOPE") !== "phase3-tempo") {
    throw new Error("INDEXER_LAUNCH_SCOPE must be phase3-tempo in Phase 3 mainnet mode")
  }
  if (requireEnv(env, "TEMPO_CHAIN_ID") !== "4217") {
    throw new Error("TEMPO_CHAIN_ID must be 4217 in Phase 3 mainnet mode")
  }
  if (requireEnv(env, "SETTLEMENT_DOMAIN_ID") !== "4217") {
    throw new Error("SETTLEMENT_DOMAIN_ID must be 4217 in Phase 3 mainnet mode")
  }

  for (const name of Object.keys(env)) {
    if (
      /^(NEXT_PUBLIC_)?TEMPO_LZ_EID$/u.test(name) ||
      /^LZ_EID_/u.test(name) ||
      /LAYERZERO|DVN|SPOKE/u.test(name)
    ) {
      throw new Error(`Phase 3 mainnet mode rejects legacy LayerZero runtime variable ${name}`)
    }
  }
}

export function readPhase3IndexerConfig(env: EnvLike = process.env): Phase3IndexerConfig {
  if (String(env.PHASE3_INDEXER_ENABLED ?? "false").toLowerCase() !== "true") {
    return { enabled: false }
  }
  assertPhase3MainnetConfig(env)

  const payoutIndexingEnabled =
    String(env.PHASE3_PAYOUT_INDEXING_ENABLED ?? "false").toLowerCase() === "true"
  const payoutV3IndexingEnabled =
    String(env.PHASE3_PAYOUT_V3_INDEXING_ENABLED ?? "false").toLowerCase() === "true"
  const payoutV4IndexingEnabled =
    String(env.PHASE3_PAYOUT_V4_INDEXING_ENABLED ?? "false").toLowerCase() === "true"
  const payoutV5IndexingEnabled =
    String(env.PHASE3_PAYOUT_V5_INDEXING_ENABLED ?? "false").toLowerCase() === "true"
  const poolV3IndexingEnabled =
    String(env.PHASE3_POOL_V3_INDEXING_ENABLED ?? "false").toLowerCase() === "true"
  const payoutV6IndexingEnabled =
    String(env.PHASE3_PAYOUT_V6_INDEXING_ENABLED ?? "false").toLowerCase() === "true"

  return {
    enabled: true,
    environment: env.PARLY_ENV || "development",
    usdcPoolV2: source(env, "PHASE3_USDC_POOL_V2", "START_BLOCK_PHASE3_USDC_POOL_V2"),
    usdtPoolV2: source(env, "PHASE3_USDT_POOL_V2", "START_BLOCK_PHASE3_USDT_POOL_V2"),
    ...(poolV3IndexingEnabled
      ? {
          usdcPoolV3: source(env, "PHASE3_USDC_POOL_V3", "START_BLOCK_PHASE3_USDC_POOL_V3"),
          usdtPoolV3: source(env, "PHASE3_USDT_POOL_V3", "START_BLOCK_PHASE3_USDT_POOL_V3")
        }
      : {}),
    ingressReceiver: source(env, "PARLY_INGRESS_RECEIVER", "START_BLOCK_PARLY_INGRESS_RECEIVER"),
    virtualDepositMaster: source(
      env,
      "PARLY_VIRTUAL_DEPOSIT_MASTER",
      "START_BLOCK_PARLY_VIRTUAL_DEPOSIT_MASTER"
    ),
    relayerOperatorRegistry: source(
      env,
      "PARLY_RELAYER_OPERATOR_REGISTRY",
      "START_BLOCK_PARLY_RELAYER_OPERATOR_REGISTRY"
    ),
    ...(payoutIndexingEnabled
      ? {
          payoutAdapter: source(env, "PARLY_PAYOUT_ADAPTER", "START_BLOCK_PARLY_PAYOUT_ADAPTER")
        }
      : {}),
    ...(payoutV3IndexingEnabled
      ? {
          payoutAdapterV3: source(env, "PARLY_PAYOUT_ADAPTER_V3", "START_BLOCK_PARLY_PAYOUT_ADAPTER_V3"),
          payoutLiabilityVault: source(
            env,
            "PARLY_PAYOUT_LIABILITY_VAULT",
            "START_BLOCK_PARLY_PAYOUT_LIABILITY_VAULT"
          ),
          payoutProofVerifier: source(
            env,
            "PARLY_PAYOUT_PROOF_VERIFIER",
            "START_BLOCK_PARLY_PAYOUT_PROOF_VERIFIER"
          )
        }
      : {}),
    ...(payoutV4IndexingEnabled
      ? {
          payoutAdapterV4: source(env, "PARLY_PAYOUT_ADAPTER_V4", "START_BLOCK_PARLY_PAYOUT_ADAPTER_V4")
        }
      : {}),
    ...(payoutV5IndexingEnabled
      ? {
          payoutAdapterV5: source(env, "PARLY_PAYOUT_ADAPTER_V5", "START_BLOCK_PARLY_PAYOUT_ADAPTER_V5")
        }
      : {}),
    ...(payoutV6IndexingEnabled
      ? {
          payoutAdapterV6: source(env, "PARLY_PAYOUT_ADAPTER_V6", "START_BLOCK_PARLY_PAYOUT_ADAPTER_V6")
        }
      : {})
  }
}

export function isLegacyV1IndexerEnabled(env: EnvLike = process.env) {
  return String(env.INDEXER_ENABLE_LEGACY_V1 ?? "false").trim().toLowerCase() === "true"
}

export type LegacyV1IndexerRuntimeConfig = {
  enabled: boolean
  tempoSettlementEid: number
  bnbIndexingEnabled: boolean
  sourceEids: {
    ethereum: number
    arbitrum: number
    base: number
    bnb: number
  }
}

function readDisabledFlag(env: EnvLike, name: string) {
  return String(env[name] ?? "false").trim().toLowerCase() === "true"
}

function requirePositiveLegacyEidValue(raw: string | undefined, name: string) {
  const value = Number(raw ?? "")
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive LayerZero EID.`)
  }
  return value
}

export function readLegacyV1IndexerRuntimeConfig(env: EnvLike = process.env): LegacyV1IndexerRuntimeConfig {
  const enabled = isLegacyV1IndexerEnabled(env)
  const bnbIndexingEnabled = enabled && !readDisabledFlag(env, "INDEXER_DISABLE_BNB")

  if (!enabled) {
    return {
      enabled: false,
      tempoSettlementEid: 0,
      bnbIndexingEnabled: false,
      sourceEids: {
        ethereum: 0,
        arbitrum: 0,
        base: 0,
        bnb: 0
      }
    }
  }

  return {
    enabled: true,
    tempoSettlementEid: requirePositiveLegacyEidValue(
      env.NEXT_PUBLIC_TEMPO_LZ_EID || env.TEMPO_LZ_EID,
      "TEMPO_LZ_EID"
    ),
    bnbIndexingEnabled,
    sourceEids: {
      ethereum: requirePositiveLegacyEidValue(
        env.NEXT_PUBLIC_LZ_EID_ETHEREUM || env.LZ_EID_ETHEREUM,
        "LZ_EID_ETHEREUM"
      ),
      arbitrum: requirePositiveLegacyEidValue(
        env.NEXT_PUBLIC_LZ_EID_ARBITRUM || env.LZ_EID_ARBITRUM,
        "LZ_EID_ARBITRUM"
      ),
      base: requirePositiveLegacyEidValue(env.NEXT_PUBLIC_LZ_EID_BASE || env.LZ_EID_BASE, "LZ_EID_BASE"),
      bnb: bnbIndexingEnabled
        ? requirePositiveLegacyEidValue(env.NEXT_PUBLIC_LZ_EID_BNB || env.LZ_EID_BNB, "LZ_EID_BNB")
        : 0
    }
  }
}

export function mapMasterCustodyAttemptStatus(custodyClass: number): Phase3AttemptStatus {
  if (custodyClass === 1) return "refund_available"
  if (custodyClass === 4) return "ignored"
  if (custodyClass === 5) return "failed"
  if (custodyClass === 6) return "payment_detected"
  return "manual_review"
}

export function mapDepositV2RecordToInternalPaymentAttempt(
  record: DepositV2Record,
  details: {
    publicPaymentId: string
    statusAccessTokenHash: string
    paymentContext: Phase3PaymentContext
    routeKind: Phase3RouteKind
    tokenSymbol?: string
    networkLabel?: string
  }
): Phase3InternalPaymentAttemptRecord {
  return {
    kind: "payment_attempt",
    internalPaymentAttemptId: record.id,
    publicPaymentId: details.publicPaymentId,
    statusAccessTokenHash: details.statusAccessTokenHash,
    status: "completed",
    statusLabel: "Completed",
    paymentContext: details.paymentContext,
    routeKind: details.routeKind,
    amount: record.amount.toString(),
    tokenSymbol: details.tokenSymbol,
    networkLabel: details.networkLabel,
    txHash: record.txHash as `0x${string}`,
    updatedAt: record.timestamp.toString(),
    internalIndexerId: record.id
  }
}

export function mapVirtualDepositEventToInternalObservation(
  record: VirtualDepositEventRecord,
  explicitSource?: { sourcePayer?: `0x${string}` | null }
): Phase3InternalVirtualDepositObservationRecord {
  const sourcePayer = explicitSource?.sourcePayer ?? null
  return {
    kind: "virtual_deposit_observation",
    observationId: record.observationId,
    internalPaymentAttemptId: record.paymentAttemptId,
    routeHash: record.routeHash,
    token: record.token,
    amount: record.amount.toString(),
    txHash: record.txHash as `0x${string}`,
    observedBlockNumber: record.observedBlockNumber.toString(),
    firstLogIndex: record.firstLogIndex,
    secondLogIndex: record.secondLogIndex,
    sourcePayerKnown: Boolean(sourcePayer),
    sourcePayer,
    virtualAddress: record.virtualAddress as `0x${string}`,
    masterAddress: record.masterAddress as `0x${string}`
  }
}
