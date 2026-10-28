import { createHash } from "node:crypto"
import { assertReceivingProfileV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, stringToHex, type Hex } from "viem"
import {
  parlyPayoutAdapterV3Abi,
  parlyPayoutAdapterV4Abi,
  parlyIngressReceiverAbi,
  parlyVirtualDepositMasterAbi,
  parlyVirtualDepositMasterAttemptRegistrationAbi,
  parlyVirtualDepositMasterObservationRecordingAbi
} from "@parly/protocol-abis"
import {
  redactPhase3PublicPaymentStatus,
  PAYOUT_V4_EXECUTION_STEPS,
  type CanonicalRelayExecutionPayload,
  type PayoutV4RelayBundleBinding,
  type PayoutV4ExecutionStep,
  type Phase3FinalizerObservationEligibility,
  type Phase3InternalFinalizerJobRecord
} from "@parly/shared-types"

export {
  poolV3ActiveNullifiers,
  preparePayoutV6WithdrawalTransaction,
  preparePoolV3Transaction,
  readPoolV3RuntimeConfig,
  redactRelayerRuntimeError,
  validatePayoutV6ExecutionPayload,
  validatePoolV3ProofPayload
} from "./pool-v3-runtime.js"
export type {
  PayoutV6ExecutionPayload,
  PayoutV6RuntimeConfig,
  PoolV3ProofPayload,
  PoolV3RuntimeConfig
} from "./pool-v3-runtime.js"
export {
  claimPayoutV6Execution,
  listPayoutV6ReadyJobs,
  readPayoutV6AuthorityClientConfig
} from "./payout-v6-authority-client.js"
export type {
  PayoutV6AuthorityClientConfig,
  PayoutV6ClaimedExecution,
  PayoutV6ExecutionChild
} from "./payout-v6-authority-client.js"
export {
  runPayoutV6CheckpointedExecution,
  runPayoutV6DownstreamExecution
} from "./payout-v6-checkpointed-worker.js"
export type {
  PayoutV6CheckpointedExecutionArgs,
  PayoutV6DownstreamExecutionArgs
} from "./payout-v6-checkpointed-worker.js"
export {
  RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN_NAME,
  RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN_VERSION,
  RELAY_EXECUTION_FEE_SCHEDULE_V2_TYPES,
  buildSignedRelayExecutionFeeSchedulesV2,
  hashRelayExecutionFeeScheduleV2,
  normalizeSignedRelayExecutionFeeScheduleV2,
  readRelayExecutionFeeScheduleTemplatesV2,
  signRelayExecutionFeeScheduleV2,
  validateRelayExecutionFeeScheduleV2
} from "./relay-execution-fee-schedule-v2.js"
export type {
  RelayExecutionFeeScheduleTemplateV2,
  RelayExecutionFeeScheduleValidationV2
} from "./relay-execution-fee-schedule-v2.js"

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/u
const HEX_RE = /^0x(?:[a-fA-F0-9]{2})*$/u
const PRIVATE_KEY_RE = /^0x[a-fA-F0-9]{64}$/u
const ZERO_ADDRESS_RE = /^0x0{40}$/iu
const FORBIDDEN_PUBLIC_RELAY_KEY = ["NEXT", "PUBLIC", "RELAY", "API", "KEY"].join("_")

export const PHASE3_FINALIZER_ALLOWED_ACTIONS = ["finalize_success"] as const
export const CAPABILITY_SETTLEMENT = keccak256(stringToHex("CAPABILITY_SETTLEMENT"))
export const CAPABILITY_PAYOUT = keccak256(stringToHex("CAPABILITY_PAYOUT"))

export type Phase3FinalizerAction = (typeof PHASE3_FINALIZER_ALLOWED_ACTIONS)[number]

export type Phase3FinalizerConfig =
  | {
      enabled: false
      reason: "phase3_finalizer_disabled"
    }
  | {
      enabled: true
      parlyEnv: string
      tempoRpcUrl: string
      tempoChainId: number
      settlementDomainId: number
      poolV2Addresses: {
        usdc: `0x${string}`
        usdt: `0x${string}`
      }
      ingressReceiverAddress: `0x${string}`
      virtualDepositMasterAddress: `0x${string}`
      finalizerPrivateKey: `0x${string}`
      relayerOperatorAddress: `0x${string}`
      maxFinalizerFeeBaseUnits: bigint
      maxFinalizerFeeBps: number
      allowedTokenAddresses: `0x${string}`[]
      indexerInternalDataSourceUrl: string
      relayApiKeyConfigured: boolean
    }

export type Phase3PayoutV3RuntimeConfig =
  | {
      enabled: false
      reason: "phase3_v3_payout_runtime_disabled"
    }
  | {
      enabled: true
      tempoChainId: number
      settlementDomainId: number
      payoutAdapterV3: `0x${string}`
      payoutLiabilityVault: `0x${string}`
      payoutProofVerifier: `0x${string}`
      relayOutboundProvider: `0x${string}`
      relayOutboundProviderV2: `0x${string}` | null
      relayOutboundProviderV3: `0x${string}`
      relayDepositAddressTarget: `0x${string}` | null
      relayDepositAddressTargetV3: `0x${string}`
      payoutExecutionEnabled: boolean
      broadcastEnabled: boolean
      feePayerEnabled: boolean
      fundedPocEnabled: boolean
      campaignAwardsEnabled: boolean
    }

export type FinalizerJobStatus =
  | "queued"
  | "locked"
  | "submitted"
  | "confirmed"
  | "failed_retryable"
  | "failed_manual_review"
  | "abandoned"
  | "refund_available"
  | "refund_claimed"
  | "manual_review"
  | "ignored"

export type FinalizerJob = {
  jobId: string
  attemptId: `0x${string}`
  routeHash: `0x${string}`
  observationId: `0x${string}`
  observationEligibility: Phase3FinalizerObservationEligibility
  status: FinalizerJobStatus
  lockedBy: string | null
  lockedUntil: number | null
  attemptNumber: number
  maxAttempts: number
  retryable?: boolean
  idempotencyKey: string
  lastError: string | null
  createdAt: number
  updatedAt: number
  requiredPrincipal: bigint
  observedAmount: bigint
  maxFinalizerFee: bigint
  settlementFeeBudget: bigint
  finalizerFee: bigint
}

export type SettlementAuthorization = {
  chainId: bigint
  settlementDomainId: bigint
  environment: Hex
  verifyingContract: `0x${string}`
  attemptId: Hex
  authorizationNonce: Hex
  depositObservationId: Hex
  routeType: number
  paymentMethod: number
  assetId: bigint
  token: `0x${string}`
  pool: `0x${string}`
  receiver: `0x${string}`
  virtualMasterId: Hex
  userTagHash: Hex
  virtualAddress: `0x${string}`
  expectedAmount: bigint
  observedAmount: bigint
  payerTotal: bigint
  settlementFee: bigint
  finalizerFee: bigint
  amountToShield: bigint
  feeRecipient: `0x${string}`
  maxFinalizerFee: bigint
  beneficiaryPolicySubject: `0x${string}`
  refundWalletCommitment: Hex
  depositTxHash: Hex
  depositLogIndexA: bigint
  depositLogIndexB: bigint
  depositBlockNumber: bigint
  relayRequestIdHash: Hex
  routeHash: Hex
  statusAccessTokenHash: Hex
  expiresAt: bigint
  innerCommitment: bigint
  envelopeHash: Hex
}

export type AttemptAuthorization = {
  chainId: bigint
  settlementDomainId: bigint
  environment: Hex
  verifyingContract: `0x${string}`
  attemptId: Hex
  authorizationNonce: Hex
  userTagHash: Hex
  routeHash: Hex
  token: `0x${string}`
  pool: `0x${string}`
  assetId: bigint
  expectedAmount: bigint
  expiresAt: bigint
  refundWalletCommitment: Hex
  paymentContext: number
  refundClaimantBinding: number
  statusAccessTokenHash: Hex
}

export type DepositObservation = {
  token: `0x${string}`
  virtualAddress: `0x${string}`
  masterAddress: `0x${string}`
  amount: bigint
  observationId: Hex
  txHash: Hex
  logIndexA: bigint
  logIndexB: bigint
  observedBlockNumber: bigint
  routeHash: Hex
  userTagHash: Hex
}

export type ObservationAttestation = {
  chainId: bigint
  settlementDomainId: bigint
  environment: Hex
  verifyingContract: `0x${string}`
  attemptId: Hex
  observationId: Hex
  token: `0x${string}`
  amount: bigint
  virtualAddress: `0x${string}`
  txHash: Hex
  logIndexA: bigint
  logIndexB: bigint
  observedBlockNumber: bigint
  routeHash: Hex
  userTagHash: Hex
  expiresAt: bigint
  nonce: Hex
}

export type RelayerOwnedOneTimeExecutionJob = {
  jobId: string
  leaseToken: string
  masterAddress: `0x${string}`
  relayerOperatorAddress: `0x${string}`
  attemptAuthorization: AttemptAuthorization
  attemptSignature: Hex
  observation: DepositObservation
  observationAttestation: ObservationAttestation
  observationSignature: Hex
  settlementAuthorization: SettlementAuthorization
  envelope: Hex
  settlementSignature: Hex
  confirmedTransactions?: Array<{
    functionName: RelayerOwnedOneTimeExecutionFunctionName
    transactionHash: Hex
  }>
}

export type ReceivingExecutionRuntimeV4 = {
  profile: ReceivingProfileV4
  refreshFinalization(job: Readonly<RelayerOwnedOneTimeExecutionJob>): Promise<{ envelope: Hex; settlementSignature: Hex }>
  executeTransaction(job: Readonly<RelayerOwnedOneTimeExecutionJob>, transaction: Parameters<RelayerOwnedOneTimeExecutionBroadcaster["broadcastPreparedTransaction"]>[0]): Promise<{ hash: Hex; status: "success" | "reverted" } | { status: "pending" }>
}

export type RelayerOwnedOneTimeExecutionFunctionName =
  | "registerAttemptWithAuthorization"
  | "recordDepositObservationWithAttestation"
  | "finalizeVirtualDeposit"

export type RelayerOwnedOneTimeExecutionDataSource = {
  acquireRelayerOwnedOneTimeExecutionJob(args: {
    workerId: string
    leaseMs: number
  }): Promise<RelayerOwnedOneTimeExecutionJob | null>
  recordRelayerOwnedOneTimeExecutionDryRun?(args: {
    jobId: string
    leaseToken: string
    transactionNames: readonly string[]
  }): Promise<void>
  renewRelayerOwnedOneTimeExecutionLease?(args: {
    jobId: string
    leaseToken: string
  }): Promise<void>
  deferRelayerOwnedOneTimeExecutionJob?(args: { jobId: string; leaseToken: string }): Promise<void>
  recordRelayerOwnedOneTimeExecutionSubmitted?(args: {
    jobId: string
    leaseToken: string
    transactionHashes: readonly Hex[]
  }): Promise<void>
  recordRelayerOwnedOneTimeExecutionTransactionConfirmed?(args: {
    jobId: string
    leaseToken: string
    functionName: RelayerOwnedOneTimeExecutionFunctionName
    transactionHash: Hex
  }): Promise<void>
  recordRelayerOwnedOneTimeExecutionFailed?(args: {
    jobId: string
    leaseToken: string
    failedFunctionName: RelayerOwnedOneTimeExecutionFunctionName
    failureCode: "transaction_reverted" | "broadcast_failed"
  }): Promise<void>
  recordRelayerOwnedOneTimeExecutionPayloadInvalid?(args: {
    jobId: string
    leaseToken: string
    failureCode: "invalid_execution_payload"
  }): Promise<void>
}

export type RelayerOwnedOneTimeExecutionBroadcaster = {
  broadcastPreparedTransaction(args: {
    to: `0x${string}`
    functionName: string
    data: Hex
  }): Promise<{ hash: Hex; status: "success" | "reverted" }>
}

export type PayoutV3ExecutionJob = PayoutV3SubmitJob & {
  leaseToken: string
  confirmedTransaction?: {
    functionName: "submitPayout"
    transactionHash: Hex
  }
}

export type PayoutV3ExecutionDataSource = {
  acquirePayoutV3ExecutionJob(args: {
    workerId: string
    leaseMs: number
  }): Promise<PayoutV3ExecutionJob | null>
  recordPayoutV3ExecutionDryRun?(args: {
    payoutId: string
    leaseToken: string
    transactionName: "submitPayout"
  }): Promise<void>
  renewPayoutV3ExecutionLease?(args: {
    payoutId: string
    leaseToken: string
  }): Promise<void>
  recordPayoutV3ExecutionTransactionConfirmed?(args: {
    payoutId: string
    leaseToken: string
    functionName: "submitPayout"
    transactionHash: Hex
  }): Promise<void>
  recordPayoutV3ExecutionSubmitted?(args: {
    payoutId: string
    leaseToken: string
    transactionHash: Hex
  }): Promise<void>
  recordPayoutV3ExecutionFailed?(args: {
    payoutId: string
    leaseToken: string
    failedFunctionName: "submitPayout"
    failureCode: "transaction_reverted" | "broadcast_failed"
  }): Promise<void>
  recordPayoutV3ExecutionPayloadInvalid?(args: {
    payoutId: string
    leaseToken: string
    failureCode: "invalid_execution_payload"
  }): Promise<void>
}

export { PAYOUT_V4_EXECUTION_STEPS }
export type { PayoutV4ExecutionStep }

type PayoutV4IntentPayload = {
  environment: Hex
  chainId: string
  settlementDomainId: string
  adapter: `0x${string}`
  escrowSalt: Hex
  escrow: `0x${string}`
  sourcePool: `0x${string}`
  token: `0x${string}`
  assetId: string
  amountIn: string
  sourceAmountOut: string
  destinationAmountOut: string
  providerSourceAmount: string
  outboundExecutionFee: string
  maxOutboundExecutionFee: string
  providerContract: `0x${string}`
  destinationChainId: string
  destinationToken: `0x${string}`
  destinationRecipientHash: Hex
  refundRecipientCommitment: Hex
  providerDataHash: Hex
  requestIdHash: Hex
  nonce: Hex
  quoteExpiry: string
  maxCompletionDelay: string
  payoutAuthority: `0x${string}`
}

/** Internal relayer-only data, received through the sealed V4 authority claim. */
export type PayoutV4RelayerAuthorityPayload = {
  version: 4
  payoutId: string
  quoteHash: Hex
  intentHash: Hex
  intent: PayoutV4IntentPayload
  payoutSignature: Hex
  requesterWallet: `0x${string}`
  payoutAuthority: `0x${string}`
  relayerPublicKeyHash: string
  destinationRecipient: `0x${string}`
  providerData: Hex
  providerDataHash: Hex
  refundRecipientCommitment: Hex
  quoteExpiry: string
}

export type ValidatedPayoutV4PrivateBundle = {
  intentHash: Hex
  escrow: `0x${string}`
  amountIn: bigint
  sourcePool: `0x${string}`
  token: `0x${string}`
  assetId: bigint
}

export type PayoutV4ProvenanceAttestationPayload = {
  intentHash: Hex
  sourcePool: `0x${string}`
  token: `0x${string}`
  assetId: bigint
  amount: bigint
  escrow: `0x${string}`
  withdrawalTxHash: Hex
  transferLogIndex: bigint
  blockNumber: bigint
  blockHash: Hex
  attestationNonce: Hex
}

export type PayoutV4CompletionProofPayload = {
  intentHash: Hex
  providerSubmissionId: Hex
  requestIdHash: Hex
  destinationChainId: bigint
  destinationToken: `0x${string}`
  destinationRecipientHash: Hex
  destinationAmountOut: bigint
  destinationTxHash: Hex
  destinationLogIndex: bigint
  destinationBlockNumber: bigint
  destinationBlockHash: Hex
  finalityConfirmations: bigint
  proofNonce: Hex
}

export type ConnectedWalletSettlement = {
  attemptId: Hex
  authorizationNonce: Hex
  provider: `0x${string}`
  token: `0x${string}`
  pool: `0x${string}`
  assetId: bigint
  amountToShield: bigint
  expectedAmount: bigint
  innerCommitment: bigint
  policySubjectField: bigint
  routeType: number
  paymentContext: number
  refundClaimantBinding: number
  refundWalletCommitment: Hex
  routeHash: Hex
  expiresAt: bigint
  envelopeHash: Hex
}

type Env = NodeJS.ProcessEnv

function requireEnv(name: string, env: Env) {
  const value = env[name]
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required for Phase 3 finalizer.`)
  }
  return value.trim()
}

function requirePositiveInt(name: string, env: Env) {
  const value = requireEnv(name, env)
  if (!/^\d+$/u.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return Number(value)
}

function requirePositiveBigInt(name: string, env: Env) {
  const value = requireEnv(name, env)
  if (!/^\d+$/u.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return BigInt(value)
}

function requireAddress(name: string, env: Env) {
  const value = requireEnv(name, env)
  if (!ADDRESS_RE.test(value) || ZERO_ADDRESS_RE.test(value)) {
    throw new Error(`${name} must be a non-zero 20-byte address.`)
  }
  return getAddress(value) as `0x${string}`
}

function optionalAddress(name: string, env: Env) {
  const value = env[name]?.trim()
  if (!value) return null
  if (!ADDRESS_RE.test(value) || ZERO_ADDRESS_RE.test(value)) {
    throw new Error(`${name} must be a non-zero 20-byte address when configured.`)
  }
  return getAddress(value) as `0x${string}`
}

function requireRelayerOperatorAddress(env: Env) {
  const value = env.RELAYER_OPERATOR_ADDRESS?.trim() || env.FINALIZER_ADDRESS?.trim()
  return requireAddress("RELAYER_OPERATOR_ADDRESS", { ...env, RELAYER_OPERATOR_ADDRESS: value })
}

function requirePrivateKey(name: string, env: Env) {
  const value = requireEnv(name, env)
  if (!PRIVATE_KEY_RE.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key.`)
  }
  return value as `0x${string}`
}

function parseAllowedTokenAddresses(env: Env) {
  return requireEnv("PHASE3_ALLOWED_TOKEN_ADDRESSES", env)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!ADDRESS_RE.test(value) || ZERO_ADDRESS_RE.test(value)) {
        throw new Error("PHASE3_ALLOWED_TOKEN_ADDRESSES must contain non-zero 20-byte addresses.")
      }
      return getAddress(value) as `0x${string}`
    })
}

function readBooleanFlag(name: string, env: Env) {
  const value = env[name]
  if (value === undefined || value.trim() === "") return false
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name} must be true or false.`)
}

export function readPhase3PayoutV3RuntimeConfig(env: Env = process.env): Phase3PayoutV3RuntimeConfig {
  if (env.PHASE3_V3_PAYOUT_RUNTIME_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_v3_payout_runtime_disabled" }
  }

  const tempoChainId = requirePositiveInt("TEMPO_CHAIN_ID", env)
  const settlementDomainId = requirePositiveInt("SETTLEMENT_DOMAIN_ID", env)
  if (tempoChainId !== 4217 || settlementDomainId !== 4217) {
    throw new Error("Phase 3 V3 relayer runtime requires Tempo chain/domain 4217.")
  }

  return {
    enabled: true,
    tempoChainId,
    settlementDomainId,
    payoutAdapterV3: requireAddress("PHASE3_V3_PAYOUT_ADAPTER", env),
    payoutLiabilityVault: requireAddress("PHASE3_V3_PAYOUT_LIABILITY_VAULT", env),
    payoutProofVerifier: requireAddress("PHASE3_V3_PAYOUT_PROOF_VERIFIER", env),
    relayOutboundProvider: requireAddress("PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V3", env),
    relayOutboundProviderV2: optionalAddress("PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2", env),
    relayOutboundProviderV3: requireAddress("PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V3", env),
    relayDepositAddressTarget: optionalAddress("PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET", env),
    relayDepositAddressTargetV3: requireAddress("PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET_V3", env),
    payoutExecutionEnabled: readBooleanFlag("PHASE3_PAYOUT_EXECUTION_ENABLED", env),
    broadcastEnabled: readBooleanFlag("PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED", env),
    feePayerEnabled: readBooleanFlag("PHASE3_FEE_PAYER_ENABLED", env),
    fundedPocEnabled: readBooleanFlag("PHASE3_FUNDED_POC_ENABLED", env),
    campaignAwardsEnabled: readBooleanFlag("CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED", env)
  }
}

export function readPhase3FinalizerConfig(env: Env = process.env): Phase3FinalizerConfig {
  if (env[FORBIDDEN_PUBLIC_RELAY_KEY] && env[FORBIDDEN_PUBLIC_RELAY_KEY]?.trim() !== "") {
    throw new Error(`${FORBIDDEN_PUBLIC_RELAY_KEY} is forbidden. Relay keys must remain server-only.`)
  }

  if (env.PHASE3_FINALIZER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_finalizer_disabled" }
  }

  const parlyEnv = requireEnv("PARLY_ENV", env)
  const tempoChainId = requirePositiveInt("TEMPO_CHAIN_ID", env)
  const settlementDomainId = requirePositiveInt("SETTLEMENT_DOMAIN_ID", env)
  if (parlyEnv === "mainnet" && (tempoChainId !== 4217 || settlementDomainId !== 4217)) {
    throw new Error("Phase 3 mainnet finalizer requires TEMPO_CHAIN_ID=4217 and SETTLEMENT_DOMAIN_ID=4217.")
  }

  const maxFinalizerFeeBps = requirePositiveInt("MAX_FINALIZER_FEE_BPS", env)
  if (maxFinalizerFeeBps > 10_000) {
    throw new Error("MAX_FINALIZER_FEE_BPS cannot exceed 10000.")
  }

  const indexerInternalDataSourceUrl = requireEnv("INDEXER_INTERNAL_DATA_SOURCE_URL", env)
  new URL(indexerInternalDataSourceUrl)

  return {
    enabled: true,
    parlyEnv,
    tempoRpcUrl: requireEnv("TEMPO_RPC_URL", env),
    tempoChainId,
    settlementDomainId,
    poolV2Addresses: {
      usdc: requireAddress("PHASE3_USDC_POOL_V2", env),
      usdt: requireAddress("PHASE3_USDT_POOL_V2", env)
    },
    ingressReceiverAddress: requireAddress("PARLY_INGRESS_RECEIVER_ADDRESS", env),
    virtualDepositMasterAddress: requireAddress("PARLY_VIRTUAL_DEPOSIT_MASTER_ADDRESS", env),
    finalizerPrivateKey: requirePrivateKey("FINALIZER_PRIVATE_KEY", env),
    relayerOperatorAddress: requireRelayerOperatorAddress(env),
    maxFinalizerFeeBaseUnits: requirePositiveBigInt("MAX_FINALIZER_FEE_BASE_UNITS", env),
    maxFinalizerFeeBps,
    allowedTokenAddresses: parseAllowedTokenAddresses(env),
    indexerInternalDataSourceUrl,
    relayApiKeyConfigured: Boolean(env.RELAY_API_KEY && env.RELAY_API_KEY.trim() !== "")
  }
}

export function describePhase3FinalizerConfigForLogs(config: Phase3FinalizerConfig) {
  if (!config.enabled) return config

  return {
    enabled: true,
    parlyEnv: config.parlyEnv,
    tempoRpcUrlConfigured: Boolean(config.tempoRpcUrl),
    tempoChainId: config.tempoChainId,
    settlementDomainId: config.settlementDomainId,
    poolV2Addresses: config.poolV2Addresses,
    ingressReceiverAddress: config.ingressReceiverAddress,
    virtualDepositMasterAddress: config.virtualDepositMasterAddress,
    relayerOperatorPrivateKeyConfigured: Boolean(config.finalizerPrivateKey),
    relayerOperatorAddress: config.relayerOperatorAddress,
    maxFinalizerFeeBaseUnits: config.maxFinalizerFeeBaseUnits.toString(),
    maxFinalizerFeeBps: config.maxFinalizerFeeBps,
    allowedTokenAddresses: config.allowedTokenAddresses,
    indexerInternalDataSourceUrlConfigured: Boolean(config.indexerInternalDataSourceUrl),
    relayApiKeyConfigured: config.relayApiKeyConfigured
  }
}

export function buildFinalizerIdempotencyKey(args: {
  attemptId: `0x${string}`
  observationId: `0x${string}`
  routeHash: `0x${string}`
  action: string
}) {
  return createHash("sha256")
    .update(
      [
        "phase3-finalizer",
        args.action,
        args.attemptId.toLowerCase(),
        args.observationId.toLowerCase(),
        args.routeHash.toLowerCase()
      ].join(":")
    )
    .digest("hex")
}

export function canFinalizeJob(job: FinalizerJob, options: { nowMs?: number } = {}):
  | { ok: true }
  | { ok: false; reason: string } {
  const nowMs = options.nowMs ?? Date.now()
  if (job.observationEligibility !== "eligible") {
    return { ok: false, reason: "observation_not_eligible" }
  }
  if (job.status === "queued") {
    if (job.attemptNumber >= job.maxAttempts) {
      return { ok: false, reason: "max_attempts_exceeded" }
    }
    if (job.lockedUntil && job.lockedUntil > nowMs) {
      return { ok: false, reason: "active_lease_not_finalizable" }
    }
    return { ok: true }
  }
  if (job.status === "locked") {
    if (!job.lockedUntil || job.lockedUntil > nowMs) {
      return { ok: false, reason: "active_lease_not_finalizable" }
    }
    if (job.attemptNumber >= job.maxAttempts) {
      return { ok: false, reason: "max_attempts_exceeded" }
    }
    return { ok: true }
  }
  if (job.status === "failed_retryable") {
    if (job.retryable !== true) return { ok: false, reason: "retry_not_explicitly_enabled" }
    if (job.attemptNumber >= job.maxAttempts) {
      return { ok: false, reason: "max_attempts_exceeded" }
    }
    if (job.lockedUntil && job.lockedUntil > nowMs) {
      return { ok: false, reason: "active_lease_not_finalizable" }
    }
    return { ok: true }
  }
  return { ok: false, reason: "job_status_not_finalizable" }
}

export function createInMemoryFinalizerJobStore(args: { nowMs: number }) {
  const jobs = new Map<string, FinalizerJob>()
  let nowMs = args.nowMs

  return {
    setNow(nextNowMs: number) {
      nowMs = nextNowMs
    },
    upsert(job: FinalizerJob) {
      jobs.set(job.jobId, { ...job })
    },
    acquireLease(workerId: string, leaseMs: number) {
      const orderedJobs = [...jobs.values()].sort((left, right) => left.createdAt - right.createdAt)
      const job = orderedJobs.find((candidate) => {
        const canFinalize = canFinalizeJob(candidate, { nowMs })
        if (!canFinalize.ok) return false
        if (candidate.status === "locked") {
          return Boolean(candidate.lockedUntil && candidate.lockedUntil <= nowMs)
        }
        if (candidate.status !== "queued" && candidate.status !== "failed_retryable") return false
        return !candidate.lockedUntil || candidate.lockedUntil <= nowMs
      })
      if (!job) return null

      const leased = {
        ...job,
        status: "locked" as const,
        lockedBy: workerId,
        lockedUntil: nowMs + leaseMs,
        attemptNumber: job.attemptNumber + 1,
        updatedAt: nowMs
      }
      jobs.set(leased.jobId, leased)
      return { ...leased }
    },
    get(jobId: string) {
      const job = jobs.get(jobId)
      return job ? { ...job } : null
    }
  }
}

export type Phase3FinalizerJobDataSource = {
  listFinalizerJobs(): Promise<Array<FinalizerJob | Phase3InternalFinalizerJobRecord>>
}

function isInternalFinalizerJob(
  record: FinalizerJob | Phase3InternalFinalizerJobRecord
): record is Phase3InternalFinalizerJobRecord {
  return (record as Phase3InternalFinalizerJobRecord).kind === "finalizer_job"
}

function coerceFinalizerJob(record: FinalizerJob | Phase3InternalFinalizerJobRecord): FinalizerJob {
  if (isInternalFinalizerJob(record)) {
    return {
      jobId: record.jobId,
      attemptId: record.attemptId,
      routeHash: record.routeHash,
      observationId: record.observationId,
      observationEligibility: record.observationEligibility,
      status: record.status,
      lockedBy: record.lockedBy,
      lockedUntil: record.lockedUntil,
      attemptNumber: record.attemptNumber,
      maxAttempts: record.maxAttempts,
      retryable: record.status === "failed_retryable" ? true : undefined,
      idempotencyKey: record.idempotencyKey,
      lastError: record.lastError,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      requiredPrincipal: BigInt(record.requiredPrincipal),
      observedAmount: BigInt(record.observedAmount),
      maxFinalizerFee: BigInt(record.maxFinalizerFee),
      settlementFeeBudget: BigInt(record.settlementFeeBudget),
      finalizerFee: BigInt(record.finalizerFee)
    }
  }

  return { ...(record as FinalizerJob) }
}

export function createInMemoryPhase3FinalizerJobDataSource(args: {
  jobs: Array<FinalizerJob | Phase3InternalFinalizerJobRecord>
}): Phase3FinalizerJobDataSource {
  const jobs = args.jobs.map(coerceFinalizerJob)
  return {
    async listFinalizerJobs() {
      return jobs.map((job) => ({ ...job }))
    }
  }
}

export async function listFinalizableJobsFromDataSource(
  dataSource: Phase3FinalizerJobDataSource,
  options: { nowMs?: number } = {}
): Promise<FinalizerJob[]> {
  const jobs = (await dataSource.listFinalizerJobs()).map(coerceFinalizerJob)
  return jobs
    .filter((job) => canFinalizeJob(job, options).ok)
    .sort((left, right) => left.createdAt - right.createdAt)
}

export type RelayerOperatorEligibilityReader = {
  isEligibleOperatorFor(operatorAddress: `0x${string}`, capability: Hex): Promise<boolean>
}

export async function listFinalizableJobsForEligibleOperator(args: {
  dataSource: Phase3FinalizerJobDataSource
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
  nowMs?: number
}) {
  if (
    !(await args.eligibilityReader.isEligibleOperatorFor(
      args.relayerOperatorAddress,
      CAPABILITY_SETTLEMENT
    ))
  ) {
    return []
  }
  return listFinalizableJobsFromDataSource(args.dataSource, { nowMs: args.nowMs })
}

export type PayoutDryRunJob = {
  payoutId: string
  intentHash: Hex
  idempotencyKey: string
  status: string
  amountIn: bigint
  minAmountOut: bigint
  maxProviderFee: bigint
  maxOperatorFee: bigint
  providerContract?: `0x${string}`
}

export type PayoutV3SubmitJob = {
  payoutId: string
  intentHash: Hex
  idempotencyKey: string
  status: string
  payoutAuthority: `0x${string}`
  destinationRecipient: `0x${string}`
  providerData: Hex
  providerDataHash: Hex
}

export async function preparePayoutExecutionDryRun(args: {
  job: PayoutDryRunJob
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
  providerFee: bigint
  operatorFee: bigint
}) {
  assertAddress(args.relayerOperatorAddress, "relayerOperatorAddress")
  assertHex32(args.job.intentHash, "intentHash")
  if (!args.job.providerContract) {
    throw new Error("Payout provider contract is required.")
  }
  assertAddress(args.job.providerContract, "providerContract")
  if (args.job.status !== "escrow_receipt_confirmed") {
    throw new Error("Payout escrow receipt must be confirmed before execution preparation.")
  }
  if (
    !(await args.eligibilityReader.isEligibleOperatorFor(
      args.relayerOperatorAddress,
      CAPABILITY_PAYOUT
    ))
  ) {
    throw new Error("Relayer/operator payout capability is required.")
  }
  if (args.providerFee < 0n || args.providerFee > args.job.maxProviderFee) {
    throw new Error("Payout provider fee cap exceeded.")
  }
  if (args.operatorFee < 0n || args.operatorFee > args.job.maxOperatorFee) {
    throw new Error("Payout operator fee cap exceeded.")
  }
  if (args.providerFee + args.operatorFee > args.job.amountIn - args.job.minAmountOut) {
    throw new Error("Payout minimum output exceeded.")
  }
  const amountOut = args.job.amountIn - args.providerFee - args.operatorFee

  return {
    dryRun: true as const,
    broadcast: false as const,
    operatorFundsEscrow: false as const,
    payoutId: args.job.payoutId,
    intentHash: args.job.intentHash,
    idempotencyKey: args.job.idempotencyKey,
    status: "payout_submitted" as const,
    providerContract: args.job.providerContract,
    amountOut: amountOut.toString(),
    providerFee: args.providerFee.toString(),
    operatorFee: args.operatorFee.toString()
  }
}

export async function preparePayoutV3SubmitPayoutTransaction(args: {
  adapterAddress: `0x${string}`
  job: PayoutV3SubmitJob
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
}) {
  assertAddress(args.adapterAddress, "adapterAddress")
  assertAddress(args.relayerOperatorAddress, "relayerOperatorAddress")
  assertHex32(args.job.intentHash, "intentHash")
  assertAddress(args.job.payoutAuthority, "payoutAuthority")
  assertAddress(args.job.destinationRecipient, "destinationRecipient")
  if (args.job.status !== "escrow_receipt_confirmed") {
    throw new Error("Payout escrow receipt must be confirmed before execution preparation.")
  }
  if (getAddress(args.job.payoutAuthority) !== getAddress(args.relayerOperatorAddress)) {
    throw new Error("Payout authority must match relayer operator before execution preparation.")
  }
  if (
    !(await args.eligibilityReader.isEligibleOperatorFor(
      args.relayerOperatorAddress,
      CAPABILITY_PAYOUT
    ))
  ) {
    throw new Error("Relayer/operator payout capability is required.")
  }
  assertHex32(args.job.providerDataHash, "providerDataHash")
  assertHexBytes(args.job.providerData, "providerData")
  if (keccak256(args.job.providerData) !== args.job.providerDataHash) {
    throw new Error("Payout provider data hash mismatch.")
  }

  const txArgs = [
    args.job.intentHash,
    getAddress(args.job.destinationRecipient),
    args.job.providerData
  ] as const
  const data = encodeFunctionData({
    abi: parlyPayoutAdapterV3Abi,
    functionName: "submitPayout",
    args: txArgs
  })

  return {
    dryRun: false as const,
    broadcast: false as const,
    to: getAddress(args.adapterAddress),
    functionName: "submitPayout" as const,
    args: txArgs,
    data,
    payoutId: args.job.payoutId,
    intentHash: args.job.intentHash,
    idempotencyKey: args.job.idempotencyKey,
    status: "payout_submitted" as const
  }
}

export function isPayoutV3ExecutionBroadcastEnabled(env: Env = process.env) {
  return (
    env.PHASE3_PAYOUT_EXECUTION_ENABLED === "true" &&
    env.PHASE3_LIVE_TRANSACTIONS_ENABLED === "true" &&
    env.PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED === "true"
  )
}

export async function runPayoutV3ExecutionOnce(args: {
  adapterAddress: `0x${string}`
  dataSource: PayoutV3ExecutionDataSource
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
  workerId: string
  leaseMs: number
  env?: Env
  broadcast?: boolean
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
}) {
  assertAddress(args.adapterAddress, "adapterAddress")
  assertAddress(args.relayerOperatorAddress, "relayerOperatorAddress")
  if (!args.workerId.trim()) throw new Error("workerId is required.")
  if (!Number.isInteger(args.leaseMs) || args.leaseMs <= 0) {
    throw new Error("leaseMs must be a positive integer.")
  }

  const job = await args.dataSource.acquirePayoutV3ExecutionJob({
    workerId: args.workerId,
    leaseMs: args.leaseMs
  })
  if (!job) {
    return { status: "idle" as const, broadcast: false as const, transactionNames: [] as string[] }
  }
  if (!job.leaseToken.trim()) throw new Error("leased payout execution job is missing its lease token.")

  let tx: Awaited<ReturnType<typeof preparePayoutV3SubmitPayoutTransaction>>
  try {
    tx = await preparePayoutV3SubmitPayoutTransaction({
      adapterAddress: args.adapterAddress,
      job,
      eligibilityReader: args.eligibilityReader,
      relayerOperatorAddress: args.relayerOperatorAddress
    })
  } catch (error) {
    await args.dataSource.recordPayoutV3ExecutionPayloadInvalid?.({
      payoutId: job.payoutId,
      leaseToken: job.leaseToken,
      failureCode: "invalid_execution_payload"
    })
    throw error
  }

  if (args.broadcast !== true) {
    await args.dataSource.recordPayoutV3ExecutionDryRun?.({
      payoutId: job.payoutId,
      leaseToken: job.leaseToken,
      transactionName: tx.functionName
    })
    return {
      status: "prepared" as const,
      payoutId: job.payoutId,
      broadcast: false as const,
      transactionNames: [tx.functionName],
      payoutAuthority: getAddress(job.payoutAuthority) as `0x${string}`
    }
  }

  if (!isPayoutV3ExecutionBroadcastEnabled(args.env)) {
    throw new Error(
      "payout V3 execution broadcast requires PHASE3_PAYOUT_EXECUTION_ENABLED=true, PHASE3_LIVE_TRANSACTIONS_ENABLED=true, and PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED=true."
    )
  }
  if (!args.broadcaster) throw new Error("broadcaster is required for payout V3 execution broadcast.")

  if (job.confirmedTransaction) {
    if (job.confirmedTransaction.functionName !== tx.functionName) {
      throw new Error("confirmed payout transaction checkpoint must match the execution plan.")
    }
    await args.dataSource.recordPayoutV3ExecutionSubmitted?.({
      payoutId: job.payoutId,
      leaseToken: job.leaseToken,
      transactionHash: job.confirmedTransaction.transactionHash
    })
    return {
      status: "submitted" as const,
      payoutId: job.payoutId,
      broadcast: true as const,
      transactionNames: [tx.functionName],
      transactionHash: job.confirmedTransaction.transactionHash,
      resumed: true as const
    }
  }

  await args.dataSource.renewPayoutV3ExecutionLease?.({
    payoutId: job.payoutId,
    leaseToken: job.leaseToken
  })
  let receipt: Awaited<ReturnType<RelayerOwnedOneTimeExecutionBroadcaster["broadcastPreparedTransaction"]>>
  try {
    receipt = await args.broadcaster.broadcastPreparedTransaction({
      to: tx.to,
      functionName: tx.functionName,
      data: tx.data
    })
  } catch {
    await args.dataSource.recordPayoutV3ExecutionFailed?.({
      payoutId: job.payoutId,
      leaseToken: job.leaseToken,
      failedFunctionName: tx.functionName,
      failureCode: "broadcast_failed"
    })
    throw new Error(`${tx.functionName} broadcast failed.`)
  }
  if (receipt.status !== "success") {
    await args.dataSource.recordPayoutV3ExecutionFailed?.({
      payoutId: job.payoutId,
      leaseToken: job.leaseToken,
      failedFunctionName: tx.functionName,
      failureCode: "transaction_reverted"
    })
    throw new Error(`${tx.functionName} reverted.`)
  }
  await args.dataSource.recordPayoutV3ExecutionTransactionConfirmed?.({
    payoutId: job.payoutId,
    leaseToken: job.leaseToken,
    functionName: tx.functionName,
    transactionHash: receipt.hash
  })
  await args.dataSource.recordPayoutV3ExecutionSubmitted?.({
    payoutId: job.payoutId,
    leaseToken: job.leaseToken,
    transactionHash: receipt.hash
  })
  return {
    status: "submitted" as const,
    payoutId: job.payoutId,
    broadcast: true as const,
    transactionNames: [tx.functionName],
    transactionHash: receipt.hash
  }
}

export function validateFinalizerFee(args: {
  observedAmount: bigint
  requiredPrincipal: bigint
  requestedFee: bigint
  maxFinalizerFee: bigint
  settlementFeeBudget: bigint
}): { ok: true; fee: bigint } | { ok: false; reason: string } {
  if (args.requestedFee < 0n) return { ok: false, reason: "negative_fee" }
  if (args.requestedFee > args.maxFinalizerFee) return { ok: false, reason: "fee_cap_exceeded" }
  if (args.requestedFee > args.settlementFeeBudget) return { ok: false, reason: "fee_budget_exceeded" }
  if (args.observedAmount - args.requestedFee < args.requiredPrincipal) {
    return { ok: false, reason: "principal_floor_exceeded" }
  }
  return { ok: true, fee: args.requestedFee }
}

export function computeCappedFinalizerFee(args: {
  estimatedGasCostBaseUnits: bigint
  observedAmount: bigint
  requiredPrincipal: bigint
  maxFinalizerFee: bigint
  settlementFeeBudget: bigint
}) {
  const requestedFee =
    args.estimatedGasCostBaseUnits <= args.maxFinalizerFee
      ? args.estimatedGasCostBaseUnits
      : args.maxFinalizerFee
  return validateFinalizerFee({ ...args, requestedFee })
}

export function isFinalizerActionAllowed(action: string): action is Phase3FinalizerAction {
  return PHASE3_FINALIZER_ALLOWED_ACTIONS.includes(action as Phase3FinalizerAction)
}

function assertHex32(value: string, label: string) {
  if (!BYTES32_RE.test(value)) {
    throw new Error(`${label} must be bytes32.`)
  }
}

function assertHexBytes(value: string, label: string) {
  if (!HEX_RE.test(value)) {
    throw new Error(`${label} must be hex bytes.`)
  }
}

function assertAddress(value: string, label: string) {
  if (!isAddress(value) || ZERO_ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a non-zero address.`)
  }
}

function requireUnsignedBaseUnits(value: string, label: string, allowZero = false) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} must be unsigned base units.`)
  }
  const parsed = BigInt(value)
  if (!allowZero && parsed === 0n) throw new Error(`${label} must be positive.`)
  return parsed
}

function readPayoutV4BundleBindings(bundle: CanonicalRelayExecutionPayload) {
  if (bundle.payoutV4 && bundle.payoutV4Batch) {
    throw new Error("V4 payout bundles cannot mix single and batch bindings.")
  }
  if (bundle.payoutV4) return [bundle.payoutV4]
  if (!bundle.payoutV4Batch || bundle.payoutV4Batch.length < 2 || bundle.payoutV4Batch.length > 10) {
    throw new Error("V4 payout batch requires two to ten bindings.")
  }
  return [...bundle.payoutV4Batch]
}

export function validatePayoutV4RelayerAuthorityForBinding(args: {
  binding: PayoutV4RelayBundleBinding
  authority: PayoutV4RelayerAuthorityPayload
  relayerOperatorAddress: `0x${string}`
  bundlePool: `0x${string}`
}) {
  const { binding, authority } = args
  assertHex32(binding.intentHash, "V4 bundle intentHash")
  assertAddress(binding.adapter, "V4 bundle adapter")
  assertAddress(binding.escrow, "V4 bundle escrow")
  assertAddress(binding.payoutAuthority, "V4 bundle payout authority")
  const amountIn = requireUnsignedBaseUnits(binding.amountIn, "V4 bundle amountIn")
  const intent = authority.intent
  const relayer = getAddress(args.relayerOperatorAddress) as `0x${string}`

  if (authority.version !== 4) throw new Error("V4 relayer authority payload is required.")
  assertHex32(authority.quoteHash, "V4 quoteHash")
  assertHex32(authority.intentHash, "V4 authority intentHash")
  assertHexBytes(authority.payoutSignature, "V4 payout signature")
  assertAddress(authority.payoutAuthority, "V4 authority payout authority")
  if (!/^[a-f0-9]{64}$/u.test(authority.relayerPublicKeyHash)) {
    throw new Error("V4 authority relayer key binding is invalid.")
  }
  assertAddress(intent.adapter, "V4 intent adapter")
  assertAddress(intent.escrow, "V4 intent escrow")
  assertAddress(intent.sourcePool, "V4 intent source pool")
  assertAddress(intent.token, "V4 intent token")
  assertAddress(intent.payoutAuthority, "V4 intent payout authority")

  if (
    authority.quoteHash.toLowerCase() !== authority.intentHash.toLowerCase() ||
    authority.intentHash.toLowerCase() !== binding.intentHash.toLowerCase()
  ) {
    throw new Error("V4 authority intent hash does not match the private bundle.")
  }
  if (
    getAddress(binding.adapter) !== getAddress(intent.adapter) ||
    getAddress(binding.escrow) !== getAddress(intent.escrow) ||
    getAddress(binding.payoutAuthority) !== getAddress(intent.payoutAuthority) ||
    getAddress(authority.payoutAuthority) !== getAddress(intent.payoutAuthority) ||
    getAddress(intent.payoutAuthority) !== relayer
  ) {
    throw new Error("V4 payout authority does not match the selected relayer.")
  }
  const intentAmountIn = requireUnsignedBaseUnits(intent.amountIn, "V4 intent amountIn")
  if (amountIn !== intentAmountIn) throw new Error("V4 bundle escrow amount does not match its intent.")
  if (getAddress(args.bundlePool) !== getAddress(intent.sourcePool)) {
    throw new Error("V4 bundle pool does not match its intent.")
  }

  return {
    intentHash: authority.intentHash.toLowerCase() as Hex,
    escrow: getAddress(intent.escrow) as `0x${string}`,
    amountIn: intentAmountIn,
    sourcePool: getAddress(intent.sourcePool) as `0x${string}`,
    token: getAddress(intent.token) as `0x${string}`,
    assetId: requireUnsignedBaseUnits(intent.assetId, "V4 intent assetId")
  } satisfies ValidatedPayoutV4PrivateBundle
}

/**
 * V4 batches remain one PoolV2 withdrawal. Every nonzero local output must
 * match one accepted V4 escrow and every intent must bind the same relayer.
 */
export function validatePayoutV4PrivateBundleBindings(args: {
  bundle: CanonicalRelayExecutionPayload
  authorities: readonly PayoutV4RelayerAuthorityPayload[]
  relayerOperatorAddress: `0x${string}`
  settlementDomainId: number
}): ValidatedPayoutV4PrivateBundle[] {
  if (!Number.isSafeInteger(args.settlementDomainId) || args.settlementDomainId <= 0) {
    throw new Error("settlementDomainId must be a positive integer.")
  }
  assertAddress(args.relayerOperatorAddress, "relayerOperatorAddress")
  if (args.bundle.pubSignals.length !== 50) throw new Error("V4 bundle proof shape is invalid.")
  if (BigInt(args.bundle.pubSignals[14]) !== 0n) {
    throw new Error("V4 payout bundles must not include a Pool executor fee.")
  }
  const proofRelayer = `0x${BigInt(args.bundle.pubSignals[49]).toString(16).padStart(40, "0")}` as `0x${string}`
  const localEid = Number(args.bundle.pubSignals[17])
  if (proofRelayer.toLowerCase() !== getAddress(args.relayerOperatorAddress).toLowerCase() || localEid !== args.settlementDomainId) {
    throw new Error("V4 bundle proof is not bound to the selected relayer.")
  }
  if (
    args.bundle.recipients.length !== 10 ||
    args.bundle.amounts.length !== 10 ||
    args.bundle.destEids.length !== 10 ||
    args.bundle.lzOptions.length !== 10
  ) {
    throw new Error("V4 bundle output shape is invalid.")
  }
  if (args.bundle.destEids.some((eid) => eid !== args.settlementDomainId) || args.bundle.lzOptions.some((value) => value !== "0x")) {
    throw new Error("V4 payout bundles must use the local Tempo escrow route.")
  }

  const bindings = readPayoutV4BundleBindings(args.bundle)
  if (bindings.length !== args.authorities.length) {
    throw new Error("V4 payout batch authority count does not match its bindings.")
  }
  const authorityByIntent = new Map<string, PayoutV4RelayerAuthorityPayload>()
  for (const authority of args.authorities) {
    const intentHash = authority.intentHash?.toLowerCase()
    if (!intentHash || authorityByIntent.has(intentHash)) {
      throw new Error("V4 payout batch contains duplicate or invalid authority data.")
    }
    authorityByIntent.set(intentHash, authority)
  }

  const validated = bindings.map((binding) => {
    const authority = authorityByIntent.get(binding.intentHash.toLowerCase())
    if (!authority) throw new Error("V4 payout batch authority does not match the private bundle.")
    return validatePayoutV4RelayerAuthorityForBinding({
      binding,
      authority,
      relayerOperatorAddress: args.relayerOperatorAddress,
      bundlePool: args.bundle.pool
    })
  })
  const first = validated[0]
  if (!first) throw new Error("V4 payout bundle binding is required.")
  const escrowKeys = new Set<string>()
  const intentKeys = new Set<string>()
  for (const entry of validated) {
    if (
      getAddress(entry.sourcePool) !== getAddress(first.sourcePool) ||
      getAddress(entry.token) !== getAddress(first.token) ||
      entry.assetId !== first.assetId
    ) {
      throw new Error("V4 payout batches must use one source pool and asset.")
    }
    const escrow = getAddress(entry.escrow).toLowerCase()
    if (escrowKeys.has(escrow) || intentKeys.has(entry.intentHash.toLowerCase())) {
      throw new Error("V4 payout batch contains duplicate escrow or intent bindings.")
    }
    escrowKeys.add(escrow)
    intentKeys.add(entry.intentHash.toLowerCase())
  }

  const expectedByEscrow = new Map(validated.map((entry) => [getAddress(entry.escrow).toLowerCase(), entry]))
  const nonZeroOutputs = args.bundle.amounts
    .map((rawAmount, index) => ({ amount: requireUnsignedBaseUnits(rawAmount, `V4 output ${index}`, true), index }))
    .filter((output) => output.amount > 0n)
  if (nonZeroOutputs.length !== expectedByEscrow.size) {
    throw new Error("V4 payout batch requires exact local escrow outputs.")
  }
  const matchedEscrows = new Set<string>()
  for (const output of nonZeroOutputs) {
    const recipient = args.bundle.recipients[output.index]
    if (!recipient || !isAddress(recipient)) throw new Error("V4 payout batch requires exact local escrow outputs.")
    const escrow = getAddress(recipient).toLowerCase()
    const expected = expectedByEscrow.get(escrow)
    if (!expected || matchedEscrows.has(escrow) || output.amount !== expected.amountIn) {
      throw new Error("V4 payout batch requires exact local escrow outputs.")
    }
    matchedEscrows.add(escrow)
  }
  if (matchedEscrows.size !== expectedByEscrow.size) {
    throw new Error("V4 payout batch requires exact local escrow outputs.")
  }
  return validated
}

/**
 * V4 uses a local PoolV2 withdrawal to its deterministic escrow. The final
 * recipient and provider data are deliberately absent from the browser bundle.
 */
export function validatePayoutV4PrivateBundleBinding(args: {
  bundle: CanonicalRelayExecutionPayload
  authority: PayoutV4RelayerAuthorityPayload
  relayerOperatorAddress: `0x${string}`
  settlementDomainId: number
}): ValidatedPayoutV4PrivateBundle {
  if (!args.bundle.payoutV4 || args.bundle.payoutV4Batch) {
    throw new Error("V4 payout requires one local escrow output.")
  }
  const nonZeroOutputs = args.bundle.amounts
    .map((rawAmount, index) => ({ amount: requireUnsignedBaseUnits(rawAmount, `V4 output ${index}`, true), index }))
    .filter((output) => output.amount > 0n)
  if (nonZeroOutputs.length !== 1) throw new Error("V4 payout requires one local escrow output.")
  const [validated] = validatePayoutV4PrivateBundleBindings({
    bundle: args.bundle,
    authorities: [args.authority],
    relayerOperatorAddress: args.relayerOperatorAddress,
    settlementDomainId: args.settlementDomainId
  })
  if (!validated) throw new Error("V4 payout requires one local escrow output.")
  return validated
}

function payoutV4IntentContractArgs(intent: PayoutV4IntentPayload) {
  for (const [label, value] of Object.entries({
    environment: intent.environment,
    escrowSalt: intent.escrowSalt,
    destinationRecipientHash: intent.destinationRecipientHash,
    refundRecipientCommitment: intent.refundRecipientCommitment,
    providerDataHash: intent.providerDataHash,
    requestIdHash: intent.requestIdHash,
    nonce: intent.nonce
  })) {
    assertHex32(value, `V4 intent ${label}`)
  }
  for (const [label, value] of Object.entries({
    adapter: intent.adapter,
    escrow: intent.escrow,
    sourcePool: intent.sourcePool,
    token: intent.token,
    providerContract: intent.providerContract,
    destinationToken: intent.destinationToken,
    payoutAuthority: intent.payoutAuthority
  })) {
    assertAddress(value, `V4 intent ${label}`)
  }
  return {
    environment: intent.environment,
    chainId: requireUnsignedBaseUnits(intent.chainId, "V4 intent chainId"),
    settlementDomainId: requireUnsignedBaseUnits(intent.settlementDomainId, "V4 intent settlementDomainId"),
    adapter: getAddress(intent.adapter),
    escrowSalt: intent.escrowSalt,
    escrow: getAddress(intent.escrow),
    sourcePool: getAddress(intent.sourcePool),
    token: getAddress(intent.token),
    assetId: requireUnsignedBaseUnits(intent.assetId, "V4 intent assetId"),
    amountIn: requireUnsignedBaseUnits(intent.amountIn, "V4 intent amountIn"),
    sourceAmountOut: requireUnsignedBaseUnits(intent.sourceAmountOut, "V4 intent sourceAmountOut"),
    destinationAmountOut: requireUnsignedBaseUnits(intent.destinationAmountOut, "V4 intent destinationAmountOut"),
    providerSourceAmount: requireUnsignedBaseUnits(intent.providerSourceAmount, "V4 intent providerSourceAmount"),
    outboundExecutionFee: requireUnsignedBaseUnits(intent.outboundExecutionFee, "V4 intent outboundExecutionFee"),
    maxOutboundExecutionFee: requireUnsignedBaseUnits(intent.maxOutboundExecutionFee, "V4 intent maxOutboundExecutionFee"),
    providerContract: getAddress(intent.providerContract),
    destinationChainId: requireUnsignedBaseUnits(intent.destinationChainId, "V4 intent destinationChainId"),
    destinationToken: getAddress(intent.destinationToken),
    destinationRecipientHash: intent.destinationRecipientHash,
    refundRecipientCommitment: intent.refundRecipientCommitment,
    providerDataHash: intent.providerDataHash,
    requestIdHash: intent.requestIdHash,
    nonce: intent.nonce,
    quoteExpiry: requireUnsignedBaseUnits(intent.quoteExpiry, "V4 intent quoteExpiry"),
    maxCompletionDelay: requireUnsignedBaseUnits(intent.maxCompletionDelay, "V4 intent maxCompletionDelay"),
    payoutAuthority: getAddress(intent.payoutAuthority)
  }
}

export async function preparePayoutV4AcceptQuoteTransactionFromAuthority(args: {
  adapterAddress: `0x${string}`
  authority: PayoutV4RelayerAuthorityPayload
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
}) {
  assertAddress(args.adapterAddress, "V4 adapter address")
  if (args.authority.version !== 4) throw new Error("V4 relayer authority payload is required.")
  assertHex32(args.authority.intentHash, "V4 authority intentHash")
  assertHex32(args.authority.quoteHash, "V4 authority quoteHash")
  assertHexBytes(args.authority.payoutSignature, "V4 payout signature")
  if (args.authority.payoutSignature.length !== 132) throw new Error("V4 payout signature must be 65 bytes.")
  const intent = payoutV4IntentContractArgs(args.authority.intent)
  if (
    getAddress(args.adapterAddress) !== getAddress(intent.adapter) ||
    getAddress(args.authority.payoutAuthority) !== getAddress(args.relayerOperatorAddress) ||
    getAddress(intent.payoutAuthority) !== getAddress(args.relayerOperatorAddress) ||
    args.authority.intentHash.toLowerCase() !== args.authority.quoteHash.toLowerCase()
  ) {
    throw new Error("V4 payout authority does not match the selected relayer.")
  }
  if (
    !(await args.eligibilityReader.isEligibleOperatorFor(
      getAddress(args.relayerOperatorAddress) as `0x${string}`,
      CAPABILITY_PAYOUT
    ))
  ) {
    throw new Error("Relayer/operator payout capability is required.")
  }
  const data = encodeFunctionData({
    abi: parlyPayoutAdapterV4Abi,
    functionName: "acceptQuote",
    args: [intent, args.authority.payoutSignature]
  })
  return {
    to: getAddress(args.adapterAddress),
    functionName: "acceptQuote" as const,
    data,
    intentHash: args.authority.intentHash.toLowerCase() as Hex,
    escrow: getAddress(intent.escrow) as `0x${string}`,
    amountIn: intent.amountIn
  }
}

export async function preparePayoutV4AcceptQuoteTransaction(args: {
  adapterAddress: `0x${string}`
  bundle: CanonicalRelayExecutionPayload
  authority: PayoutV4RelayerAuthorityPayload
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
  settlementDomainId: number
}) {
  assertAddress(args.adapterAddress, "V4 adapter address")
  const binding = validatePayoutV4PrivateBundleBinding({
    bundle: args.bundle,
    authority: args.authority,
    relayerOperatorAddress: args.relayerOperatorAddress,
    settlementDomainId: args.settlementDomainId
  })
  if (getAddress(args.adapterAddress) !== getAddress(args.authority.intent.adapter)) {
    throw new Error("V4 adapter address does not match the relayer authority payload.")
  }
  const prepared = await preparePayoutV4AcceptQuoteTransactionFromAuthority({
    adapterAddress: args.adapterAddress,
    authority: args.authority,
    eligibilityReader: args.eligibilityReader,
    relayerOperatorAddress: args.relayerOperatorAddress
  })
  if (
    prepared.intentHash.toLowerCase() !== binding.intentHash.toLowerCase() ||
    getAddress(prepared.escrow) !== getAddress(binding.escrow) ||
    prepared.amountIn !== binding.amountIn
  ) {
    throw new Error("V4 prepared quote does not match the private bundle.")
  }
  return prepared
}

export async function preparePayoutV4SubmitPayoutTransaction(args: {
  adapterAddress: `0x${string}`
  authority: PayoutV4RelayerAuthorityPayload
  eligibilityReader: RelayerOperatorEligibilityReader
  relayerOperatorAddress: `0x${string}`
}) {
  assertAddress(args.adapterAddress, "V4 adapter address")
  assertHex32(args.authority.intentHash, "V4 authority intentHash")
  assertHex32(args.authority.quoteHash, "V4 authority quoteHash")
  if (args.authority.intentHash.toLowerCase() !== args.authority.quoteHash.toLowerCase()) {
    throw new Error("V4 authority quote hash mismatch.")
  }
  const intent = payoutV4IntentContractArgs(args.authority.intent)
  if (
    getAddress(args.adapterAddress) !== getAddress(intent.adapter) ||
    getAddress(args.authority.payoutAuthority) !== getAddress(args.relayerOperatorAddress) ||
    getAddress(intent.payoutAuthority) !== getAddress(args.relayerOperatorAddress)
  ) {
    throw new Error("V4 payout authority must match the selected relayer.")
  }
  if (
    !(await args.eligibilityReader.isEligibleOperatorFor(
      getAddress(args.relayerOperatorAddress) as `0x${string}`,
      CAPABILITY_PAYOUT
    ))
  ) {
    throw new Error("Relayer/operator payout capability is required.")
  }
  assertAddress(args.authority.destinationRecipient, "V4 destination recipient")
  assertHexBytes(args.authority.providerData, "V4 provider data")
  assertHex32(args.authority.providerDataHash, "V4 provider data hash")
  if (keccak256(args.authority.providerData) !== args.authority.providerDataHash) {
    throw new Error("V4 payout provider data hash mismatch.")
  }
  const data = encodeFunctionData({
    abi: parlyPayoutAdapterV4Abi,
    functionName: "submitPayout",
    args: [args.authority.intentHash, getAddress(args.authority.destinationRecipient), args.authority.providerData]
  })
  return {
    to: getAddress(args.adapterAddress),
    functionName: "submitPayout" as const,
    data,
    intentHash: args.authority.intentHash.toLowerCase() as Hex
  }
}

function validatePayoutV4ProvenanceAttestation(attestation: PayoutV4ProvenanceAttestationPayload) {
  for (const [label, value] of Object.entries({
    intentHash: attestation.intentHash,
    withdrawalTxHash: attestation.withdrawalTxHash,
    blockHash: attestation.blockHash,
    attestationNonce: attestation.attestationNonce
  })) {
    assertHex32(value, `V4 provenance ${label}`)
  }
  for (const [label, value] of Object.entries({
    sourcePool: attestation.sourcePool,
    token: attestation.token,
    escrow: attestation.escrow
  })) {
    assertAddress(value, `V4 provenance ${label}`)
  }
  for (const [label, value] of Object.entries({
    assetId: attestation.assetId,
    amount: attestation.amount,
    transferLogIndex: attestation.transferLogIndex,
    blockNumber: attestation.blockNumber
  })) {
    if (value < 0n || (label !== "assetId" && value === 0n)) throw new Error(`V4 provenance ${label} is invalid.`)
  }
}

export function preparePayoutV4ConfirmEscrowReceiptTransaction(args: {
  adapterAddress: `0x${string}`
  attestation: PayoutV4ProvenanceAttestationPayload
  signature: Hex
}) {
  assertAddress(args.adapterAddress, "V4 adapter address")
  validatePayoutV4ProvenanceAttestation(args.attestation)
  assertHexBytes(args.signature, "V4 provenance signature")
  if (args.signature.length !== 132) throw new Error("V4 provenance signature must be 65 bytes.")
  return {
    to: getAddress(args.adapterAddress),
    functionName: "confirmEscrowReceipt" as const,
    data: encodeFunctionData({
      abi: parlyPayoutAdapterV4Abi,
      functionName: "confirmEscrowReceipt",
      args: [args.attestation, args.signature]
    })
  }
}

function validatePayoutV4CompletionProof(proof: PayoutV4CompletionProofPayload) {
  for (const [label, value] of Object.entries({
    intentHash: proof.intentHash,
    providerSubmissionId: proof.providerSubmissionId,
    requestIdHash: proof.requestIdHash,
    destinationRecipientHash: proof.destinationRecipientHash,
    destinationTxHash: proof.destinationTxHash,
    destinationBlockHash: proof.destinationBlockHash,
    proofNonce: proof.proofNonce
  })) {
    assertHex32(value, `V4 completion ${label}`)
  }
  assertAddress(proof.destinationToken, "V4 completion destinationToken")
  for (const [label, value] of Object.entries({
    destinationChainId: proof.destinationChainId,
    destinationAmountOut: proof.destinationAmountOut,
    destinationLogIndex: proof.destinationLogIndex,
    destinationBlockNumber: proof.destinationBlockNumber,
    finalityConfirmations: proof.finalityConfirmations
  })) {
    if (value < 0n || (label !== "destinationLogIndex" && value === 0n)) {
      throw new Error(`V4 completion ${label} is invalid.`)
    }
  }
}

export function preparePayoutV4CompletePayoutTransaction(args: {
  adapterAddress: `0x${string}`
  proof: PayoutV4CompletionProofPayload
  signatures: Hex[]
}) {
  assertAddress(args.adapterAddress, "V4 adapter address")
  validatePayoutV4CompletionProof(args.proof)
  if (args.signatures.length < 2 || args.signatures.length > 16) {
    throw new Error("V4 completion requires an independently produced proof quorum.")
  }
  const seen = new Set<string>()
  for (const signature of args.signatures) {
    assertHexBytes(signature, "V4 completion signature")
    if (signature.length !== 132) throw new Error("V4 completion signatures must be 65 bytes.")
    if (seen.has(signature.toLowerCase())) throw new Error("V4 completion signatures must be distinct.")
    seen.add(signature.toLowerCase())
  }
  return {
    to: getAddress(args.adapterAddress),
    functionName: "completePayout" as const,
    data: encodeFunctionData({
      abi: parlyPayoutAdapterV4Abi,
      functionName: "completePayout",
      args: [args.proof, args.signatures]
    })
  }
}

export function isPayoutV4ExecutionBroadcastEnabled(env: Env = process.env) {
  return (
    env.PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED === "true" &&
    env.PHASE3_PAYOUT_EXECUTION_ENABLED === "true" &&
    env.PHASE3_LIVE_TRANSACTIONS_ENABLED === "true" &&
    env.PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED === "true"
  )
}

function validateAuthorizationForFinalization(authorization: SettlementAuthorization) {
  assertHex32(authorization.attemptId, "attemptId")
  assertHex32(authorization.depositObservationId, "depositObservationId")
  assertHex32(authorization.routeHash, "routeHash")
  assertAddress(authorization.token, "token")
  assertAddress(authorization.pool, "pool")
  assertAddress(authorization.receiver, "receiver")
  assertAddress(authorization.feeRecipient, "feeRecipient")
  assertAddress(authorization.virtualAddress, "virtualAddress")
  if (authorization.expectedAmount !== authorization.observedAmount) {
    throw new Error("expectedAmount must equal observedAmount for exact settlement.")
  }
  if (authorization.amountToShield + authorization.finalizerFee !== authorization.observedAmount) {
    throw new Error("amountToShield plus finalizerFee must equal observedAmount.")
  }
  const feeResult = validateFinalizerFee({
    observedAmount: authorization.observedAmount,
    requiredPrincipal: authorization.amountToShield,
    requestedFee: authorization.finalizerFee,
    maxFinalizerFee: authorization.maxFinalizerFee,
    settlementFeeBudget: authorization.settlementFee
  })
  if (!feeResult.ok) {
    throw new Error(`Invalid finalizer fee: ${feeResult.reason}.`)
  }
}

export function prepareFinalizeVirtualDepositTransaction(args: {
  masterAddress: `0x${string}`
  relayerOperatorAddress: `0x${string}`
  authorization: SettlementAuthorization
  envelope: Hex
  signature: Hex
}) {
  assertAddress(args.masterAddress, "masterAddress")
  assertAddress(args.relayerOperatorAddress, "relayerOperatorAddress")
  if (getAddress(args.authorization.feeRecipient) !== getAddress(args.relayerOperatorAddress)) {
    throw new Error("feeRecipient must equal relayerOperatorAddress.")
  }
  validateAuthorizationForFinalization(args.authorization)
  const data = encodeFunctionData({
    abi: parlyVirtualDepositMasterAbi,
    functionName: "finalizeVirtualDeposit",
    args: [args.authorization, args.envelope, args.signature]
  })

  return {
    to: getAddress(args.masterAddress) as `0x${string}`,
    abi: parlyVirtualDepositMasterAbi,
    functionName: "finalizeVirtualDeposit" as const,
    args: [args.authorization, args.envelope, args.signature] as const,
    data,
    broadcast: false as const
  }
}

function validateAttemptAuthorizationForRegistration(args: {
  masterAddress: `0x${string}`
  authorization: AttemptAuthorization
}) {
  assertAddress(args.masterAddress, "masterAddress")
  assertHex32(args.authorization.attemptId, "attemptId")
  assertHex32(args.authorization.authorizationNonce, "authorizationNonce")
  assertHex32(args.authorization.userTagHash, "userTagHash")
  assertHex32(args.authorization.routeHash, "routeHash")
  assertAddress(args.authorization.verifyingContract, "verifyingContract")
  assertAddress(args.authorization.token, "token")
  assertAddress(args.authorization.pool, "pool")
  assertHex32(args.authorization.refundWalletCommitment, "refundWalletCommitment")
  assertHex32(args.authorization.statusAccessTokenHash, "statusAccessTokenHash")
  if (getAddress(args.authorization.verifyingContract) !== getAddress(args.masterAddress)) {
    throw new Error("attempt authorization verifyingContract must equal masterAddress.")
  }
  if (args.authorization.expectedAmount <= 0n) throw new Error("attempt expectedAmount must be positive.")
  if (args.authorization.expiresAt <= 0n) throw new Error("attempt expiresAt must be positive.")
}

function validateObservationAttestationForSubmission(args: {
  masterAddress: `0x${string}`
  attemptId: Hex
  observation: DepositObservation
  attestation: ObservationAttestation
}) {
  assertAddress(args.masterAddress, "masterAddress")
  assertHex32(args.attemptId, "attemptId")
  assertHex32(args.observation.observationId, "observationId")
  assertHex32(args.observation.txHash, "txHash")
  assertHex32(args.observation.routeHash, "observation routeHash")
  assertHex32(args.observation.userTagHash, "observation userTagHash")
  assertAddress(args.observation.token, "observation token")
  assertAddress(args.observation.virtualAddress, "observation virtualAddress")
  assertAddress(args.observation.masterAddress, "observation masterAddress")
  assertHex32(args.attestation.nonce, "observation nonce")
  if (getAddress(args.observation.masterAddress) !== getAddress(args.masterAddress)) {
    throw new Error("observation masterAddress must equal masterAddress.")
  }
  if (args.observation.amount <= 0n) throw new Error("observation amount must be positive.")
  if (args.attestation.attemptId !== args.attemptId) throw new Error("attestation attemptId mismatch.")
  if (args.attestation.observationId !== args.observation.observationId) throw new Error("attestation observationId mismatch.")
  if (getAddress(args.attestation.token) !== getAddress(args.observation.token)) throw new Error("attestation token mismatch.")
  if (args.attestation.amount !== args.observation.amount) throw new Error("attestation amount mismatch.")
  if (getAddress(args.attestation.virtualAddress) !== getAddress(args.observation.virtualAddress)) {
    throw new Error("attestation virtualAddress mismatch.")
  }
  if (args.attestation.txHash !== args.observation.txHash) throw new Error("attestation txHash mismatch.")
  if (args.attestation.logIndexA !== args.observation.logIndexA) throw new Error("attestation logIndexA mismatch.")
  if (args.attestation.logIndexB !== args.observation.logIndexB) throw new Error("attestation logIndexB mismatch.")
  if (args.attestation.observedBlockNumber !== args.observation.observedBlockNumber) {
    throw new Error("attestation observedBlockNumber mismatch.")
  }
  if (args.attestation.routeHash !== args.observation.routeHash) throw new Error("attestation routeHash mismatch.")
  if (args.attestation.userTagHash !== args.observation.userTagHash) throw new Error("attestation userTagHash mismatch.")
}

export function prepareAttemptRegistrationTransaction(args: {
  masterAddress: `0x${string}`
  authorization: AttemptAuthorization
  signature: Hex
}) {
  validateAttemptAuthorizationForRegistration(args)
  const data = encodeFunctionData({
    abi: parlyVirtualDepositMasterAttemptRegistrationAbi,
    functionName: "registerAttemptWithAuthorization",
    args: [args.authorization, args.signature]
  })
  return {
    to: getAddress(args.masterAddress) as `0x${string}`,
    abi: parlyVirtualDepositMasterAttemptRegistrationAbi,
    functionName: "registerAttemptWithAuthorization" as const,
    args: [args.authorization, args.signature] as const,
    data,
    broadcast: false as const
  }
}

export function prepareObservationAttestationTransaction(args: {
  masterAddress: `0x${string}`
  attemptId: Hex
  observation: DepositObservation
  attestation: ObservationAttestation
  signature: Hex
}) {
  validateObservationAttestationForSubmission(args)
  const data = encodeFunctionData({
    abi: parlyVirtualDepositMasterObservationRecordingAbi,
    functionName: "recordDepositObservationWithAttestation",
    args: [args.attemptId, args.observation, args.attestation, args.signature]
  })
  return {
    to: getAddress(args.masterAddress) as `0x${string}`,
    abi: parlyVirtualDepositMasterObservationRecordingAbi,
    functionName: "recordDepositObservationWithAttestation" as const,
    args: [args.attemptId, args.observation, args.attestation, args.signature] as const,
    data,
    broadcast: false as const
  }
}

export function prepareRelayerOwnedOneTimeExecutionPlan(args: {
  masterAddress: `0x${string}`
  relayerOperatorAddress: `0x${string}`
  attemptAuthorization: AttemptAuthorization
  attemptSignature: Hex
  observation: DepositObservation
  observationAttestation: ObservationAttestation
  observationSignature: Hex
  settlementAuthorization: SettlementAuthorization
  envelope: Hex
  settlementSignature: Hex
}) {
  if (args.attemptAuthorization.attemptId !== args.observationAttestation.attemptId) {
    throw new Error("attempt authorization and observation attestation must use the same attemptId.")
  }
  if (args.attemptAuthorization.attemptId !== args.settlementAuthorization.attemptId) {
    throw new Error("attempt authorization and settlement authorization must use the same attemptId.")
  }
  if (args.attemptAuthorization.routeHash !== args.observation.routeHash) {
    throw new Error("attempt authorization and observation routeHash mismatch.")
  }
  if (args.observation.amount !== args.attemptAuthorization.expectedAmount) {
    throw new Error("relayer-owned execution requires exact observed amount.")
  }
  if (args.settlementAuthorization.observedAmount !== args.attemptAuthorization.expectedAmount) {
    throw new Error("relayer-owned execution requires exact observed amount.")
  }
  const registration = prepareAttemptRegistrationTransaction({
    masterAddress: args.masterAddress,
    authorization: args.attemptAuthorization,
    signature: args.attemptSignature
  })
  const observation = prepareObservationAttestationTransaction({
    masterAddress: args.masterAddress,
    attemptId: args.attemptAuthorization.attemptId,
    observation: args.observation,
    attestation: args.observationAttestation,
    signature: args.observationSignature
  })
  const finalization = prepareFinalizeVirtualDepositTransaction({
    masterAddress: args.masterAddress,
    relayerOperatorAddress: args.relayerOperatorAddress,
    authorization: args.settlementAuthorization,
    envelope: args.envelope,
    signature: args.settlementSignature
  })
  return {
    relayerPaysGas: true as const,
    finalizerFeeRecipient: getAddress(args.settlementAuthorization.feeRecipient) as `0x${string}`,
    transactions: [registration, observation, finalization] as const
  }
}

export function isRelayerOwnedOneTimeExecutionBroadcastEnabled(env: Env = process.env) {
  return (
    env.PHASE3_FINALIZER_ENABLED === "true" &&
    env.PHASE3_LIVE_TRANSACTIONS_ENABLED === "true" &&
    env.PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED === "true"
  )
}

export async function runRelayerOwnedOneTimeExecutionOnce(args: {
  dataSource: RelayerOwnedOneTimeExecutionDataSource
  workerId: string
  leaseMs: number
  env?: Env
  broadcast?: boolean
  broadcaster?: RelayerOwnedOneTimeExecutionBroadcaster
  refreshReceivingFinalization?(job:Readonly<RelayerOwnedOneTimeExecutionJob>):Promise<{envelope:Hex;settlementSignature:Hex}>
  executeReceivingFinalization?(job:Readonly<RelayerOwnedOneTimeExecutionJob>,transaction:Parameters<RelayerOwnedOneTimeExecutionBroadcaster["broadcastPreparedTransaction"]>[0]):ReturnType<RelayerOwnedOneTimeExecutionBroadcaster["broadcastPreparedTransaction"]>
  receivingV4?: ReceivingExecutionRuntimeV4
}) {
  if (!args.workerId.trim()) throw new Error("workerId is required.")
  if (!Number.isInteger(args.leaseMs) || args.leaseMs <= 0) {
    throw new Error("leaseMs must be a positive integer.")
  }

  const job = await args.dataSource.acquireRelayerOwnedOneTimeExecutionJob({
    workerId: args.workerId,
    leaseMs: args.leaseMs
  })
  if (!job) {
    return { status: "idle" as const, broadcast: false as const, transactionNames: [] as string[] }
  }
  if (!job.leaseToken.trim()) throw new Error("leased execution job is missing its lease token.")

  let plan: ReturnType<typeof prepareRelayerOwnedOneTimeExecutionPlan>
  try {
    plan = prepareRelayerOwnedOneTimeExecutionPlan(job)
  } catch (error) {
    await args.dataSource.recordRelayerOwnedOneTimeExecutionPayloadInvalid?.({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      failureCode: "invalid_execution_payload"
    })
    throw error
  }
  const transactionNames = plan.transactions.map((tx) => tx.functionName)
  if (args.broadcast !== true) {
    await args.dataSource.recordRelayerOwnedOneTimeExecutionDryRun?.({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      transactionNames
    })
    return {
      status: "prepared" as const,
      jobId: job.jobId,
      broadcast: false as const,
      transactionNames,
      finalizerFeeRecipient: plan.finalizerFeeRecipient
    }
  }

  if (!isRelayerOwnedOneTimeExecutionBroadcastEnabled(args.env)) {
    throw new Error(
      "relayer-owned one-time execution broadcast requires PHASE3_FINALIZER_ENABLED=true, PHASE3_LIVE_TRANSACTIONS_ENABLED=true, and PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED=true."
    )
  }
  if (!args.broadcaster) throw new Error("broadcaster is required for relayer-owned execution broadcast.")
  const receivingCandidate=job.settlementAuthorization.chainId===31337n&&job.settlementAuthorization.settlementDomainId===99n&&job.settlementAuthorization.paymentMethod===2
  const nativeReceiving = job.settlementAuthorization.paymentMethod === 2 && !receivingCandidate
  if (nativeReceiving) {
    const runtime = args.receivingV4
    if (!runtime || typeof runtime.refreshFinalization !== "function" || typeof runtime.executeTransaction !== "function" || !args.dataSource.renewRelayerOwnedOneTimeExecutionLease) throw Error("V4 execution requires a matched durable runtime and lease guard.")
    assertReceivingProfileV4(runtime.profile)
    const p = runtime.profile, a = job.settlementAuthorization
    for (const authorization of [job.attemptAuthorization, job.observationAttestation, a]) {
      if (authorization.chainId !== BigInt(p.chainId) || authorization.settlementDomainId !== p.settlementDomain || authorization.environment !== p.environment || authorization.verifyingContract.toLowerCase() !== p.master.toLowerCase()) throw Error("V4 execution runtime domain mismatch.")
    }
    if (job.masterAddress.toLowerCase() !== p.master.toLowerCase() || a.receiver.toLowerCase() !== p.receiver.toLowerCase() || a.virtualMasterId !== p.virtualMasterId + "0".repeat(56) || ![0, 3].includes(a.routeType) || !p.assets.some(asset => BigInt(asset.assetId) === a.assetId && asset.token.toLowerCase() === a.token.toLowerCase() && asset.pool.toLowerCase() === a.pool.toLowerCase())) throw Error("V4 execution runtime asset mismatch.")
  } else if (args.receivingV4 && job.masterAddress.toLowerCase() === args.receivingV4.profile.master.toLowerCase()) throw Error("V4 execution runtime cannot downgrade to a legacy payment method.")
  if(receivingCandidate&&(args.executeReceivingFinalization||args.refreshReceivingFinalization)&&(!args.executeReceivingFinalization||!args.refreshReceivingFinalization||!args.dataSource.renewRelayerOwnedOneTimeExecutionLease)){
    throw Error("Receiving execution requires refresh and lease guards.")
  }

  const confirmedTransactions = job.confirmedTransactions ?? []
  for (const [index, confirmed] of confirmedTransactions.entries()) {
    if (plan.transactions[index]?.functionName !== confirmed.functionName) {
      throw new Error("confirmed transaction checkpoint must be an ordered prefix of the execution plan.")
    }
  }

  const transactionHashes = confirmedTransactions.map((confirmed) => confirmed.transactionHash)
  for (const planned of plan.transactions.slice(confirmedTransactions.length)) {
    let tx:typeof plan.transactions[number]=planned
    await args.dataSource.renewRelayerOwnedOneTimeExecutionLease?.({
      jobId: job.jobId,
      leaseToken: job.leaseToken
    })
    let receipt: Awaited<ReturnType<ReceivingExecutionRuntimeV4["executeTransaction"]>>
    try {
      const refresh = nativeReceiving ? args.receivingV4!.refreshFinalization : args.refreshReceivingFinalization
      if(tx.functionName==="finalizeVirtualDeposit" && refresh && (receivingCandidate || nativeReceiving)){
        if(!args.dataSource.renewRelayerOwnedOneTimeExecutionLease)throw Error("Receiving refresh requires a lease guard.")
        const fresh=await refresh(structuredClone({...job,confirmedTransactions:transactionHashes.map((transactionHash,index)=>({functionName:plan.transactions[index].functionName,transactionHash}))}))
        const types=Array(4).fill({type:"bytes"}),original=decodeAbiParameters(types,job.envelope),updated=decodeAbiParameters(types,fresh.envelope)
        if(encodeAbiParameters(types,updated)!==fresh.envelope || original.slice(0,3).some((part,index)=>part!==updated[index]) ||
          (nativeReceiving && job.attemptAuthorization.paymentContext === 0 ? updated[3] !== "0x" : !/^0x[a-fA-F0-9]{512}$/.test(String(updated[3]))))throw Error("Receiving refresh changed original terms.")
        tx=prepareRelayerOwnedOneTimeExecutionPlan({...job,envelope:fresh.envelope,settlementSignature:fresh.settlementSignature,
          settlementAuthorization:{...job.settlementAuthorization,envelopeHash:keccak256(fresh.envelope)}}).transactions[2]
        await args.dataSource.renewRelayerOwnedOneTimeExecutionLease({jobId:job.jobId,leaseToken:job.leaseToken})
      }
      const transaction={
        to: tx.to,
        functionName: tx.functionName,
        data: tx.data
      }
      if (nativeReceiving) {
        receipt = await args.receivingV4!.executeTransaction(structuredClone({ ...job, confirmedTransactions: transactionHashes.map((transactionHash, index) => ({ functionName: plan.transactions[index].functionName, transactionHash })) }), transaction)
      } else if(tx.functionName==="finalizeVirtualDeposit"&&args.executeReceivingFinalization&&receivingCandidate){
        receipt=await args.executeReceivingFinalization(structuredClone({...job,confirmedTransactions:transactionHashes.map((transactionHash,index)=>({functionName:plan.transactions[index].functionName,transactionHash}))}),transaction)
      }else receipt=await args.broadcaster.broadcastPreparedTransaction(transaction)
    } catch {
      await args.dataSource.recordRelayerOwnedOneTimeExecutionFailed?.({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        failedFunctionName: tx.functionName,
        failureCode: "broadcast_failed"
      })
      throw new Error(`${tx.functionName} broadcast failed.`)
    }
    if (receipt.status === "pending") {
      if (!nativeReceiving || !args.dataSource.deferRelayerOwnedOneTimeExecutionJob) throw Error("Native pending execution requires lease-safe deferral.")
      await args.dataSource.deferRelayerOwnedOneTimeExecutionJob({ jobId: job.jobId, leaseToken: job.leaseToken })
      return { status: "pending" as const, jobId: job.jobId, broadcast: true as const }
    }
    if (receipt.status !== "success") {
      await args.dataSource.recordRelayerOwnedOneTimeExecutionFailed?.({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        failedFunctionName: tx.functionName,
        failureCode: "transaction_reverted"
      })
      throw new Error(`${tx.functionName} reverted.`)
    }
    transactionHashes.push(receipt.hash)
    await args.dataSource.recordRelayerOwnedOneTimeExecutionTransactionConfirmed?.({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      functionName: tx.functionName,
      transactionHash: receipt.hash
    })
  }

  await args.dataSource.recordRelayerOwnedOneTimeExecutionSubmitted?.({
    jobId: job.jobId,
    leaseToken: job.leaseToken,
    transactionHashes
  })
  return {
    status: "submitted" as const,
    jobId: job.jobId,
    broadcast: true as const,
    transactionNames,
    transactionHashes,
    finalizerFeeRecipient: plan.finalizerFeeRecipient
  }
}

export function prepareConnectedWalletSettlementTransaction(args: {
  receiverAddress: `0x${string}`
  settlement: ConnectedWalletSettlement
  envelope: Hex
  signature: Hex
}) {
  assertAddress(args.receiverAddress, "receiverAddress")
  assertAddress(args.settlement.provider, "settlement.provider")
  assertAddress(args.settlement.token, "settlement.token")
  assertAddress(args.settlement.pool, "settlement.pool")
  const data = encodeFunctionData({
    abi: parlyIngressReceiverAbi,
    functionName: "settleConnectedWallet",
    args: [args.settlement, args.envelope, args.signature]
  })

  return {
    to: getAddress(args.receiverAddress) as `0x${string}`,
    abi: parlyIngressReceiverAbi,
    functionName: "settleConnectedWallet" as const,
    args: [args.settlement, args.envelope, args.signature] as const,
    data,
    broadcast: false as const
  }
}

export type Phase3SourceClassification =
  | "direct_tempo_wallet"
  | "relay_connected_wallet"
  | "relay_deposit"
  | "cex_or_custodial"
  | "unknown"
  | "not_sure"

export function classifySourceFromProvider(args: {
  classification?: Phase3SourceClassification
  sourcePayer?: string
  virtualAddress?: string
}) {
  const classification = args.classification ?? "unknown"
  const sourcePayerKnown =
    Boolean(args.sourcePayer && isAddress(args.sourcePayer)) &&
    (classification === "direct_tempo_wallet" || classification === "relay_connected_wallet")

  return {
    classification,
    sourcePayerKnown,
    sourcePayer: sourcePayerKnown ? (getAddress(args.sourcePayer!) as `0x${string}`) : null,
    inferredFromVirtualAddress: false,
    virtualAddressObserved: Boolean(args.virtualAddress)
  }
}

export function redactFinalizerStatusForPublic(record: Record<string, unknown>) {
  return redactPhase3PublicPaymentStatus(record)
}
