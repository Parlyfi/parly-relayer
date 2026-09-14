import { createHash } from "node:crypto"
import { encodeFunctionData, getAddress, isAddress, keccak256, stringToHex, type Hex } from "viem"
import {
  parlyIngressReceiverAbi,
  parlyVirtualDepositMasterAbi,
  parlyVirtualDepositMasterV2Abi
} from "@parly/protocol-abis"
import {
  redactPhase3PublicPaymentStatus,
  type Phase3FinalizerObservationEligibility,
  type Phase3InternalFinalizerJobRecord
} from "@parly/shared-types"

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/u
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
      relayOutboundProviderV2: `0x${string}`
      relayDepositAddressTarget: `0x${string}`
      payoutExecutionEnabled: false
      broadcastEnabled: false
      feePayerEnabled: false
      fundedPocEnabled: false
      campaignAwardsEnabled: false
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

function requireClosedFlag(name: string, env: Env) {
  if (env[name] === "true") {
    throw new Error(`${name} must remain false for Phase 3 V3 relayer dry-run readiness.`)
  }
  return false as const
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
    relayOutboundProvider: requireAddress("PHASE3_V3_RELAY_OUTBOUND_PROVIDER", env),
    relayOutboundProviderV2: requireAddress("PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2", env),
    relayDepositAddressTarget: requireAddress("PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET", env),
    payoutExecutionEnabled: requireClosedFlag("PHASE3_PAYOUT_EXECUTION_ENABLED", env),
    broadcastEnabled: requireClosedFlag("PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED", env),
    feePayerEnabled: requireClosedFlag("PHASE3_FEE_PAYER_ENABLED", env),
    fundedPocEnabled: requireClosedFlag("PHASE3_FUNDED_POC_ENABLED", env),
    campaignAwardsEnabled: requireClosedFlag("CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED", env)
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

function assertAddress(value: string, label: string) {
  if (!isAddress(value) || ZERO_ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a non-zero address.`)
  }
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
    abi: parlyVirtualDepositMasterV2Abi,
    functionName: "registerAttemptWithAuthorization",
    args: [args.authorization, args.signature]
  })
  return {
    to: getAddress(args.masterAddress) as `0x${string}`,
    abi: parlyVirtualDepositMasterV2Abi,
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
    abi: parlyVirtualDepositMasterV2Abi,
    functionName: "recordDepositObservationWithAttestation",
    args: [args.attemptId, args.observation, args.attestation, args.signature]
  })
  return {
    to: getAddress(args.masterAddress) as `0x${string}`,
    abi: parlyVirtualDepositMasterV2Abi,
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

  const confirmedTransactions = job.confirmedTransactions ?? []
  for (const [index, confirmed] of confirmedTransactions.entries()) {
    if (plan.transactions[index]?.functionName !== confirmed.functionName) {
      throw new Error("confirmed transaction checkpoint must be an ordered prefix of the execution plan.")
    }
  }

  const transactionHashes = confirmedTransactions.map((confirmed) => confirmed.transactionHash)
  for (const tx of plan.transactions.slice(confirmedTransactions.length)) {
    await args.dataSource.renewRelayerOwnedOneTimeExecutionLease?.({
      jobId: job.jobId,
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
      await args.dataSource.recordRelayerOwnedOneTimeExecutionFailed?.({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        failedFunctionName: tx.functionName,
        failureCode: "broadcast_failed"
      })
      throw new Error(`${tx.functionName} broadcast failed.`)
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
