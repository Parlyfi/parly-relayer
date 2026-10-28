import { createTip1022Observation, type Tip1022Observation, type Tip1022Transfer } from "./index.js"
import { assertTip1022VirtualAddressBinding } from "./tip1022.js"

const TEMPO_CHAIN_ID = 4217

export type Phase3LiveFeederAttempt = {
  paymentAttemptId: string
  userTag: `0x${string}`
  paymentTagHash: string
  routeHash: string
  expectedToken: string
  expectedAmount: bigint
  dustThreshold: bigint
  expiresAt: number
  status: string
  authorizationNonce?: `0x${string}`
  refundWalletCommitment?: `0x${string}`
  poolAddress?: string
  assetId?: bigint
  paymentContext?: number
  refundClaimantBinding?: number
  statusAccessTokenHash?: `0x${string}`
  canonicalObservationId?: string
  chainId?: number
  settlementDomainId?: number
  environment?: string
  masterAddress?: string
  virtualMasterId?: string
}

export type Phase3AttemptDomain = {
  chainId: number
  settlementDomainId: number
  environment: string
  masterAddress: string
  virtualMasterId: string
}

export function assertPhase3AttemptDomain(attempt: Phase3LiveFeederAttempt, expected: Phase3AttemptDomain) {
  if (attempt.chainId !== expected.chainId || attempt.settlementDomainId !== expected.settlementDomainId) {
    throw new Error("retained attempt domain binding mismatch")
  }
  for (const field of ["environment", "masterAddress", "virtualMasterId"] as const) {
    const pattern = field === "masterAddress" ? /^0x[a-fA-F0-9]{40}$/u : /^0x[a-fA-F0-9]{64}$/u
    const value = attempt[field]
    if (!value || !pattern.test(value) || /^0x0+$/u.test(value) ||
        value.toLowerCase() !== expected[field].toLowerCase()) {
      throw new Error("retained attempt master/domain binding mismatch")
    }
  }
}

export type Phase3Tip1022TransferLog = Tip1022Transfer & {
  chainId: number
  blockHash?: string
  transactionIndex?: number
  confirmations: number
  observedAt?: number
}

export type Phase3Tip1022TransactionContext = {
  chainId: number
  txHash: string
  blockNumber: bigint
  blockHash?: string
  transactionIndex?: number
  confirmations: number
  observedAt?: number
  transfers: readonly Phase3Tip1022TransferLog[]
}

export type Phase3Tip1022FeederStatus =
  | "pending_confirmations"
  | "eligible"
  | "ignored_dust"
  | "manual_review"

export type Phase3Tip1022FeederObservation = {
  status: Phase3Tip1022FeederStatus
  confirmationStatus: "pending" | "confirmed" | "reorged"
  finalizerEligible: boolean
  reason?: string
  attempt: Phase3LiveFeederAttempt
  observation?: Tip1022Observation
  blockHash?: string
  confirmations: number
  minimumConfirmations: number
  observedAt?: number
  sourcePayerKnown: false
  sourcePayer: null
}

function normalize(value: string) {
  return value.toLowerCase()
}

function assertEqual(label: string, left: string, right: string) {
  if (normalize(left) !== normalize(right)) throw new Error(`${label} mismatch`)
}

function assertNonNegativeInteger(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

export function createPhase3AttemptTagRegistry(initialAttempts: readonly Phase3LiveFeederAttempt[] = []) {
  const byUserTag = new Map<string, Phase3LiveFeederAttempt>()

  function register(attempt: Phase3LiveFeederAttempt) {
    const userTag = normalize(attempt.userTag)
    if (byUserTag.has(userTag)) throw new Error("TIP-1022 tag already retained")
    byUserTag.set(userTag, { ...attempt, userTag: userTag as `0x${string}` })
  }

  for (const attempt of initialAttempts) register(attempt)

  function resolveRetained(userTag: string) {
    const attempt = byUserTag.get(normalize(userTag))
    if (!attempt) throw new Error("unknown TIP-1022 tag")
    return { ...attempt }
  }

  return {
    register,
    resolveRetained,
    resolvePayable(userTag: string) {
      const attempt = resolveRetained(userTag)
      if (attempt.status !== "awaiting_payment") {
        throw new Error("TIP-1022 tag does not map to a payable active attempt")
      }
      return { ...attempt }
    }
  }
}

function selectTransferPair(
  context: Phase3Tip1022TransactionContext,
  firstLogIndex: number,
  secondLogIndex: number,
  expectedChainId = TEMPO_CHAIN_ID
) {
  if (!Array.isArray(context.transfers) || context.transfers.length < 2) {
    throw new Error("TIP-1022 observation requires transaction-local transfer context")
  }
  if (![TEMPO_CHAIN_ID, 31337].includes(expectedChainId) || context.chainId !== expectedChainId) throw new Error("TIP-1022 feeder chain binding mismatch")
  assertNonNegativeInteger("confirmation count", context.confirmations)

  const logIndexes = new Set<number>()
  for (const transfer of context.transfers) {
    if (transfer.chainId !== context.chainId) throw new Error("transaction context chain mismatch")
    assertEqual("transaction context hash", transfer.txHash, context.txHash)
    if (transfer.blockNumber !== context.blockNumber) throw new Error("transaction context block number mismatch")
    if (context.blockHash && transfer.blockHash) {
      assertEqual("transaction context block hash", transfer.blockHash, context.blockHash)
    }
    if (
      typeof context.transactionIndex === "number" &&
      typeof transfer.transactionIndex === "number" &&
      transfer.transactionIndex !== context.transactionIndex
    ) {
      throw new Error("transaction context transaction index mismatch")
    }
    if (logIndexes.has(transfer.logIndex)) throw new Error("transaction context contains duplicate log index")
    logIndexes.add(transfer.logIndex)
  }

  const first = context.transfers.find((transfer) => transfer.logIndex === firstLogIndex)
  const second = context.transfers.find((transfer) => transfer.logIndex === secondLogIndex)
  if (!first || !second) throw new Error("selected transfer logs missing from transaction context")
  return { first, second }
}

function manualReview(
  attempt: Phase3LiveFeederAttempt,
  context: Phase3Tip1022TransactionContext,
  minimumConfirmations: number,
  reason: string,
  observation?: Tip1022Observation
): Phase3Tip1022FeederObservation {
  return {
    status: "manual_review",
    confirmationStatus: context.blockHash && context.confirmations >= minimumConfirmations ? "confirmed" : "pending",
    finalizerEligible: false,
    reason,
    attempt,
    observation,
    blockHash: context.blockHash,
    confirmations: context.confirmations,
    minimumConfirmations,
    observedAt: context.observedAt,
    sourcePayerKnown: false,
    sourcePayer: null
  }
}

export function classifyPhase3Tip1022FeederObservation(args: {
  expectedChainId?: number
  registry: ReturnType<typeof createPhase3AttemptTagRegistry>
  transactionContext: Phase3Tip1022TransactionContext
  selectedFirstLogIndex: number
  selectedSecondLogIndex: number
  expectedMasterId: string
  expectedMasterAddress: string
  routeHash: string
  paymentTagHash: string
  supportedTokenAddresses: readonly string[]
  minimumConfirmations: number
  nowMs: number
}): Phase3Tip1022FeederObservation {
  assertNonNegativeInteger("minimum confirmations", args.minimumConfirmations)
  const { first, second } = selectTransferPair(
    args.transactionContext,
    args.selectedFirstLogIndex,
    args.selectedSecondLogIndex,
    args.expectedChainId
  )
  const decoded = assertTip1022VirtualAddressBinding({
    address: first.to,
    expectedMasterId: args.expectedMasterId
  })
  const attempt = args.registry.resolveRetained(decoded.userTag)
  assertEqual("TIP-1022 user tag", decoded.userTag, attempt.userTag)
  assertEqual("route hash", args.routeHash, attempt.routeHash)
  assertEqual("payment tag hash", args.paymentTagHash, attempt.paymentTagHash)

  const observation = createTip1022Observation({
    paymentAttemptId: attempt.paymentAttemptId,
    routeHash: args.routeHash,
    paymentTagHash: args.paymentTagHash,
    expectedRouteHash: attempt.routeHash,
    expectedPaymentTagHash: attempt.paymentTagHash,
    expectedToken: attempt.expectedToken,
    expectedVirtualAddress: first.to,
    expectedMasterAddress: args.expectedMasterAddress,
    first,
    second,
    transactionTransfers: args.transactionContext.transfers
  })

  const supportedToken = args.supportedTokenAddresses.some(
    (token) => normalize(token) === normalize(first.token)
  )
  if (!supportedToken || normalize(first.token) !== normalize(attempt.expectedToken)) {
    return manualReview(
      attempt,
      args.transactionContext,
      args.minimumConfirmations,
      "wrong_or_unsupported_token",
      observation
    )
  }

  if (observation.amount < attempt.dustThreshold) {
    return {
      ...manualReview(attempt, args.transactionContext, args.minimumConfirmations, "ignored_dust", observation),
      status: "ignored_dust"
    }
  }
  if (attempt.canonicalObservationId || attempt.status !== "awaiting_payment") {
    return manualReview(
      attempt,
      args.transactionContext,
      args.minimumConfirmations,
      attempt.canonicalObservationId ? "duplicate_tag_observation" : "attempt_not_payable",
      observation
    )
  }
  if (args.nowMs >= attempt.expiresAt) {
    return manualReview(attempt, args.transactionContext, args.minimumConfirmations, "late_payment", observation)
  }
  if (observation.amount !== attempt.expectedAmount) {
    return manualReview(
      attempt,
      args.transactionContext,
      args.minimumConfirmations,
      observation.amount < attempt.expectedAmount ? "underpayment" : "overpayment",
      observation
    )
  }
  if (!args.transactionContext.blockHash || args.transactionContext.confirmations < args.minimumConfirmations) {
    return {
      status: "pending_confirmations",
      confirmationStatus: "pending",
      finalizerEligible: false,
      reason: args.transactionContext.blockHash ? "minimum_confirmations_pending" : "block_hash_unavailable",
      attempt,
      observation,
      blockHash: args.transactionContext.blockHash,
      confirmations: args.transactionContext.confirmations,
      minimumConfirmations: args.minimumConfirmations,
      observedAt: args.transactionContext.observedAt,
      sourcePayerKnown: false,
      sourcePayer: null
    }
  }
  return {
    status: "eligible",
    confirmationStatus: "confirmed",
    finalizerEligible: true,
    attempt,
    observation,
    blockHash: args.transactionContext.blockHash,
    confirmations: args.transactionContext.confirmations,
    minimumConfirmations: args.minimumConfirmations,
    observedAt: args.transactionContext.observedAt,
    sourcePayerKnown: false,
    sourcePayer: null
  }
}

export function reevaluatePhase3Tip1022Confirmation(args: {
  observation: Phase3Tip1022FeederObservation
  currentBlockHash?: string
  confirmations: number
  minimumConfirmations: number
}): Phase3Tip1022FeederObservation {
  assertNonNegativeInteger("confirmation count", args.confirmations)
  assertNonNegativeInteger("minimum confirmations", args.minimumConfirmations)
  if (args.observation.confirmationStatus === "reorged") {
    return {
      ...args.observation,
      finalizerEligible: false,
      confirmations: args.confirmations,
      minimumConfirmations: args.minimumConfirmations
    }
  }
  if (
    !args.observation.blockHash ||
    !args.currentBlockHash ||
    normalize(args.observation.blockHash) !== normalize(args.currentBlockHash)
  ) {
    return {
      ...args.observation,
      status: "manual_review",
      confirmationStatus: "reorged",
      finalizerEligible: false,
      reason: "observed_block_hash_mismatch",
      confirmations: args.confirmations,
      minimumConfirmations: args.minimumConfirmations
    }
  }
  if (args.confirmations < args.minimumConfirmations) {
    return {
      ...args.observation,
      status: args.observation.status === "manual_review" || args.observation.status === "ignored_dust"
        ? args.observation.status : "pending_confirmations",
      confirmationStatus: "pending",
      finalizerEligible: false,
      reason: args.observation.status === "manual_review" || args.observation.status === "ignored_dust"
        ? args.observation.reason : "minimum_confirmations_pending",
      confirmations: args.confirmations,
      minimumConfirmations: args.minimumConfirmations
    }
  }
  if (args.observation.status === "manual_review" || args.observation.status === "ignored_dust") {
    return {
      ...args.observation,
      confirmationStatus: "confirmed",
      finalizerEligible: false,
      confirmations: args.confirmations,
      minimumConfirmations: args.minimumConfirmations
    }
  }
  return {
    ...args.observation,
    status: "eligible",
    confirmationStatus: "confirmed",
    finalizerEligible: true,
    reason: undefined,
    confirmations: args.confirmations,
    minimumConfirmations: args.minimumConfirmations
  }
}

export function isPhase3Tip1022PendingObservationStale(
  observation: Phase3Tip1022FeederObservation,
  args: { nowMs: number; staleAfterMs: number }
) {
  return (
    observation.status === "pending_confirmations" &&
    typeof observation.observedAt === "number" &&
    args.nowMs - observation.observedAt > args.staleAfterMs
  )
}
