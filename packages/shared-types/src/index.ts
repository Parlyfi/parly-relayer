export type CanonicalRelayExecutionPayload = {
  pool: `0x${string}`
  pA: [`0x${string}`, `0x${string}`]
  pB: [[`0x${string}`, `0x${string}`], [`0x${string}`, `0x${string}`]]
  pC: [`0x${string}`, `0x${string}`]
  pubSignals: string[]
  recipients: `0x${string}`[]
  amounts: string[]
  destEids: number[]
  newChangeCommitment: `0x${string}`
  newChangeEnvelope: `0x${string}`
  lzOptions: `0x${string}`[]
}

export {
  TEMPO_TIP1022_ADDRESS_REGISTRY,
  TIP1022_VIRTUAL_ADDRESS_MAGIC,
  assertTip1022VirtualAddressBinding,
  decodeTip1022VirtualAddress,
  deriveTip1022VirtualAddress,
  isTip1022VirtualAddress,
  requireTip1022MasterId,
  requireTip1022UserTag
} from "./phase3/tip1022.js"

export type RelayCipherBundle = {
  version: 1
  launchScope: "tempo-only"
  relayerAddress: `0x${string}`
  ciphertext: `0x${string}`
}

export type RelayerRegistryEntry = {
  executionAddress: `0x${string}`
  publicKeyB64: string
}

export type RelayerRegistryResponse = {
  items: RelayerRegistryEntry[]
  liveCount: number
  maxCount: number
  registryOpen: boolean
}

export type PublicSurfaceRecord = {
  name: "relayer" | "sdk" | "mcp"
  description: string
  audience: string
}

export const PHASE3_ROUTE_KINDS = [
  "direct_tempo_deposit",
  "relay_multichain_deposit",
  "relay_connected_wallet_auto_shield",
  "direct_tempo_connected_wallet"
] as const

export type Phase3RouteKind = (typeof PHASE3_ROUTE_KINDS)[number]

export const PHASE3_PAYMENT_CONTEXTS = [
  "shield_self_funding",
  "privacy_link_pay_with_wallet",
  "privacy_link_one_time_address"
] as const

export type Phase3PaymentContext = (typeof PHASE3_PAYMENT_CONTEXTS)[number]

export const REFUND_CLAIMANT_BINDINGS = [
  "authenticated_connected_wallet",
  "connected_payer_wallet",
  "payer_entered_refund_wallet"
] as const

export type RefundClaimantBinding = (typeof REFUND_CLAIMANT_BINDINGS)[number]

export const PHASE3_ATTEMPT_STATUSES = [
  "awaiting_payment",
  "payment_detected",
  "ignored",
  "settlement_in_progress",
  "shielding",
  "completed",
  "refund_available",
  "refund_claimed",
  "expired",
  "cancelled",
  "manual_review",
  "failed"
] as const

export type Phase3AttemptStatus = (typeof PHASE3_ATTEMPT_STATUSES)[number]

export const PHASE3_PAYOUT_STATUSES = [
  "payout_requested",
  "quote_accepted",
  "escrow_address_reserved",
  "pool_withdrawal_pending",
  "escrow_receipt_confirmed",
  "payout_pending",
  "payout_submitted",
  "payout_completed",
  "payout_expired",
  "provider_failed",
  "manual_review",
  "refund_available",
  "refunded"
] as const

export type Phase3PayoutStatus = (typeof PHASE3_PAYOUT_STATUSES)[number]

export const PHASE3_PAYOUT_V3_STATUSES = [
  "none",
  "escrow_pending",
  "escrow_receipt_confirmed",
  "payout_submitted",
  "payout_completed",
  "refund_available",
  "refunded",
  "manual_review"
] as const

export type Phase3PayoutV3Status = (typeof PHASE3_PAYOUT_V3_STATUSES)[number]

export type Phase3PayoutV3LifecycleEventType =
  | "quote_accepted"
  | "escrow_receipt_confirmed"
  | "payout_submitted"
  | "payout_completed"
  | "escrow_refund_available"
  | "refund_available"
  | "refund_claimed"

export const PHASE3_PAYOUT_STATUS_LABELS: Record<Phase3PayoutStatus, string> = {
  payout_requested: "Payout Requested",
  quote_accepted: "Quote Accepted",
  escrow_address_reserved: "Escrow Address Reserved",
  pool_withdrawal_pending: "Pool Withdrawal Pending",
  escrow_receipt_confirmed: "Escrow Receipt Confirmed",
  payout_pending: "Payout Pending",
  payout_submitted: "Payout Submitted",
  payout_completed: "Payout Completed",
  payout_expired: "Payout Expired",
  provider_failed: "Provider Failed",
  manual_review: "Manual Review",
  refund_available: "Refund Available",
  refunded: "Refunded"
}

export function getPhase3PayoutStatusLabel(status: Phase3PayoutStatus) {
  return PHASE3_PAYOUT_STATUS_LABELS[status]
}

export const PHASE3_PUBLIC_PAYOUT_STATUS_LABELS: Record<Phase3PayoutStatus, string> = {
  payout_requested: "Payout Requested",
  quote_accepted: "Quote Accepted",
  escrow_address_reserved: "Payout Route Reserved",
  pool_withdrawal_pending: "Pool Withdrawal Pending",
  escrow_receipt_confirmed: "Withdrawal Received",
  payout_pending: "Payout Pending",
  payout_submitted: "Payout Submitted",
  payout_completed: "Payout Completed",
  payout_expired: "Payout Expired",
  provider_failed: "Payout Unavailable",
  manual_review: "Manual Review",
  refund_available: "Refund Available",
  refunded: "Refunded"
}

export function getPhase3PublicPayoutStatusLabel(status: Phase3PayoutStatus) {
  return PHASE3_PUBLIC_PAYOUT_STATUS_LABELS[status]
}

const PHASE3_PAYOUT_TRANSITIONS: Record<Phase3PayoutStatus, readonly Phase3PayoutStatus[]> = {
  payout_requested: ["quote_accepted"],
  quote_accepted: ["escrow_address_reserved"],
  escrow_address_reserved: ["pool_withdrawal_pending", "payout_expired"],
  pool_withdrawal_pending: ["escrow_receipt_confirmed", "payout_expired", "manual_review", "provider_failed"],
  escrow_receipt_confirmed: ["payout_pending", "payout_expired", "manual_review", "provider_failed"],
  payout_pending: ["payout_submitted", "payout_expired", "manual_review", "provider_failed"],
  payout_submitted: ["payout_completed", "payout_expired", "provider_failed", "manual_review"],
  payout_completed: [],
  payout_expired: ["refund_available"],
  provider_failed: ["payout_expired", "refund_available"],
  manual_review: ["payout_completed", "provider_failed", "refund_available"],
  refund_available: ["refunded"],
  refunded: []
}

export type Phase3PayoutLifecycleEvent = {
  eventId: string
  status: Phase3PayoutStatus
  authority: NonNullable<Phase3InternalPayoutRecord["statusAuthority"]>
  reasonHash?: string
  updatedAt?: string
}

export type Phase3PayoutV3PublicLifecycleProjection = {
  v3EventType: Phase3PayoutV3LifecycleEventType
  v3Status?: Phase3PayoutV3Status
  publicEvents: Phase3PayoutLifecycleEvent[]
  requiredDatasourceEffects: readonly string[]
  redactionPolicy: readonly string[]
}

export function phase3PayoutRecoveryPath(status: Phase3PayoutStatus) {
  if (status === "payout_completed" || status === "refunded") return "terminal"
  if (status === "refund_available") return "refund claimant can claim with bound secret"
  if (status === "provider_failed") return "provider must return full compensation before claimant refund"
  if (status === "manual_review") return "claimant may recover after expiry while escrow remains funded"
  if (status === "payout_expired") return "any actor may make refund available while escrow remains funded"
  return "continue payout lifecycle while live and broadcast flags remain gated"
}

export function applyPhase3PayoutLifecycleEvent(
  record: Phase3InternalPayoutRecord,
  event: Phase3PayoutLifecycleEvent
): Phase3InternalPayoutRecord {
  if (record.auditEventIds?.includes(event.eventId)) return record
  if (!PHASE3_PAYOUT_TRANSITIONS[record.status].includes(event.status)) {
    throw new Error(`invalid payout status transition: ${record.status} -> ${event.status}`)
  }
  if (
    ["provider_failed", "manual_review", "refunded"].includes(event.status) &&
    !event.reasonHash?.trim()
  ) {
    throw new Error(`reason hash required for ${event.status}`)
  }
  return {
    ...record,
    status: event.status,
    statusReasonHash: event.reasonHash,
    statusAuthority: event.authority,
    auditEventIds: [...(record.auditEventIds ?? []), event.eventId],
    recoveryPath: phase3PayoutRecoveryPath(event.status),
    terminalPath:
      event.status === "payout_completed" || event.status === "refunded"
        ? "terminal"
        : "complete payout or make claimant-bound refund available",
    updatedAt: event.updatedAt ?? record.updatedAt
  }
}

export function mapPhase3PayoutV3EventToPublicLifecycle(input: {
  eventId: string
  eventType: Phase3PayoutV3LifecycleEventType
  evidenceHash?: string
  updatedAt?: string
}): Phase3PayoutLifecycleEvent[] {
  const event = (
    suffix: string,
    status: Phase3PayoutStatus,
    authority: Phase3PayoutLifecycleEvent["authority"],
    reasonHash?: string
  ): Phase3PayoutLifecycleEvent => ({
    eventId: `${input.eventId}:${suffix}`,
    status,
    authority,
    reasonHash,
    updatedAt: input.updatedAt
  })

  switch (input.eventType) {
    case "quote_accepted":
      return [
        event("quote", "quote_accepted", "system"),
        event("escrow", "escrow_address_reserved", "system")
      ]
    case "escrow_receipt_confirmed":
      return [
        event("withdrawal-pending", "pool_withdrawal_pending", "system"),
        event("receipt", "escrow_receipt_confirmed", "system")
      ]
    case "payout_submitted":
      return [
        event("pending", "payout_pending", "operator"),
        event("submitted", "payout_submitted", "provider_contract")
      ]
    case "payout_completed":
      return [event("completed", "payout_completed", "proof_verifier")]
    case "escrow_refund_available":
      return [
        event("expired", "payout_expired", "public_expiry", input.evidenceHash),
        event("available", "refund_available", "public_expiry")
      ]
    case "refund_available":
      return [
        event("expired", "payout_expired", "public_expiry", input.evidenceHash),
        event("available", "refund_available", "public_expiry")
      ]
    case "refund_claimed":
      if (!input.evidenceHash?.trim()) throw new Error("evidence hash required for refunded")
      return [event("refunded", "refunded", "refund_claimant", input.evidenceHash)]
  }
}

export function projectPhase3PayoutV3EventForDatasource(input: {
  eventId: string
  eventType: Phase3PayoutV3LifecycleEventType
  v3Status?: Phase3PayoutV3Status
  evidenceHash?: string
  updatedAt?: string
}): Phase3PayoutV3PublicLifecycleProjection {
  const publicEvents = mapPhase3PayoutV3EventToPublicLifecycle(input)
  const requiredDatasourceEffects = publicEvents.map((event) => `append:${event.status}`)
  if (input.eventType === "payout_submitted") {
    requiredDatasourceEffects.push("set:provider_liability_status=active")
  }
  if (input.eventType === "payout_completed") {
    requiredDatasourceEffects.push("set:provider_liability_status=released")
  }
  if (input.eventType === "escrow_refund_available") {
    requiredDatasourceEffects.push("set:provider_liability_status=unreserved")
  }
  if (input.eventType === "refund_available") {
    requiredDatasourceEffects.push("set:provider_liability_status=slashed")
  }
  if (input.eventType === "refund_claimed") {
    requiredDatasourceEffects.push("set:terminal_path=terminal")
  }

  return {
    v3EventType: input.eventType,
    v3Status: input.v3Status,
    publicEvents,
    requiredDatasourceEffects,
    redactionPolicy: [
      "hash escrow, provider contract, provider, actor, source adapter, signer, and compensation recipient",
      "store provider submission/proof ids only as already-hashed identifiers",
      "never store destination recipient, provider payload, refund salt, or raw status token"
    ]
  }
}

export type Phase3PublicInvoiceVerifyResult = {
  invoiceId: string
  status: Phase3PublicInvoiceVerifyStatus
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  invoiceLabel?: string
  receiptId?: string
  recipientDisplayName?: string
  settlementDate?: string
  legalBoundaryCopy?: string
}

export const PHASE3_PUBLIC_INVOICE_VERIFY_STATUSES = [
  "settlement_verified",
  "payment_pending",
  "refund_available",
  "cancelled",
  "expired",
  "unavailable"
] as const

export type Phase3PublicInvoiceVerifyStatus =
  (typeof PHASE3_PUBLIC_INVOICE_VERIFY_STATUSES)[number]

export type Phase3PublicPaymentStatus = {
  paymentId: string
  status: Phase3AttemptStatus
  statusLabel?: string
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  txHash?: `0x${string}`
  receiptId?: string
  updatedAt?: string
}

export type Phase3PublicPayoutStatus = {
  payoutId: string
  status: Phase3PayoutStatus
  statusLabel: string
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  updatedAt?: string
}

export type Phase3AdminPaymentRecord = {
  paymentId: string
  status: Phase3AttemptStatus
  paymentContext?: Phase3PaymentContext
  routeKind?: Phase3RouteKind
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  txHash?: `0x${string}`
  [key: string]: unknown
}

export type Phase3ReceiptMetadata = {
  receiptId: string
  paymentId: string
  status: Extract<Phase3AttemptStatus, "completed" | "refund_available" | "refund_claimed">
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  txHash?: `0x${string}`
  completedAt?: string
}

export const PHASE3_INTERNAL_RECORD_KINDS = [
  "payment_attempt",
  "route_record",
  "virtual_deposit_observation",
  "receipt",
  "invoice_verify",
  "refund_claim",
  "finalizer_job",
  "payout_record",
  "phase3_campaign_attribution",
  "admin_redacted_export"
] as const

export type Phase3InternalRecordKind = (typeof PHASE3_INTERNAL_RECORD_KINDS)[number]

export type Phase3InternalPaymentAttemptRecord = {
  kind: "payment_attempt"
  internalPaymentAttemptId: string
  publicPaymentId: string
  statusAccessTokenHash: string
  status: Phase3AttemptStatus
  statusLabel?: string
  paymentContext: Phase3PaymentContext
  routeKind: Phase3RouteKind
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  txHash?: `0x${string}`
  receiptId?: string
  receiptObjectKey?: string
  updatedAt?: string
  payerDisplayName?: string
  payerReference?: string
  payerWallet?: `0x${string}`
  refundWallet?: `0x${string}`
  authorityWallet?: `0x${string}`
  recipientAuthorityWallet?: `0x${string}`
  providerRouteWallet?: `0x${string}`
  privateNoteId?: string
  noteEnvelope?: string
  internalIndexerId?: string
}

export type Phase3InternalRouteRecord = {
  kind: "route_record"
  internalRouteId: string
  internalPaymentAttemptId: string
  routeKind: Phase3RouteKind
  provider: "relay" | "direct_tempo" | "manual" | "unknown"
  sourceChainId?: number
  settlementDomainId?: number
  tokenSymbol?: string
  tokenAddress?: `0x${string}`
  sourcePayer?: `0x${string}` | null
  providerRouteWallet?: `0x${string}` | null
  rawRouteMetadata?: Record<string, unknown>
}

export type Phase3InternalVirtualDepositObservationRecord = {
  kind: "virtual_deposit_observation"
  observationId: string
  internalPaymentAttemptId: string
  routeHash: string
  token: string
  amount: string
  txHash: `0x${string}`
  observedBlockNumber: string
  firstLogIndex?: number
  secondLogIndex?: number
  sourcePayerKnown: boolean
  sourcePayer: `0x${string}` | null
  virtualAddress?: `0x${string}`
  masterAddress?: `0x${string}`
}

export type Phase3InternalReceiptRecord = {
  kind: "receipt"
  receiptId: string
  internalPaymentAttemptId: string
  invoicePublicId: string
  settlementStatus: Phase3PublicInvoiceVerifyStatus
  settlementTimestamp?: string
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  recipientDisplayName?: string
  recipientProfileHandle?: string
  payerDisplayLabel?: string
  payerWallet?: `0x${string}`
  refundWallet?: `0x${string}`
  recipientAuthorityWallet?: `0x${string}`
  providerRouteWallet?: `0x${string}`
  privateNoteId?: string
}

export type Phase3InternalInvoiceVerifyRecord = {
  kind: "invoice_verify"
  receiptId: string
  invoicePublicId: string
  verifyTokenHash?: string
  status: Phase3PublicInvoiceVerifyStatus
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  invoiceLabel?: string
  recipientDisplayName?: string
  settlementDate?: string
  payerWallet?: `0x${string}`
  refundWallet?: `0x${string}`
  recipientAuthorityWallet?: `0x${string}`
  providerRouteWallet?: `0x${string}`
  privateNoteId?: string
}

export type Phase3InternalRefundClaimRecord = {
  kind: "refund_claim"
  claimId: string
  internalPaymentAttemptId?: string
  binding: RefundClaimantBinding
  paymentContext?: Phase3PaymentContext
  statusTokenHash?: string
  authorityWalletHash?: string
  payerWalletHash?: string
  recoveryWalletHash?: string
  linkRecoveryHash?: string
  payload: {
    contract: `0x${string}`
    claimId: string
    calldata: `0x${string}`
  }
}

export type Phase3InternalFinalizerJobStatus =
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

export type Phase3FinalizerObservationEligibility =
  | "pending_confirmations"
  | "eligible"
  | "reorged"
  | "manual_review"

export type Phase3InternalFinalizerJobRecord = {
  kind: "finalizer_job"
  jobId: string
  attemptId: `0x${string}`
  routeHash: `0x${string}`
  observationId: `0x${string}`
  observationEligibility: Phase3FinalizerObservationEligibility
  status: Phase3InternalFinalizerJobStatus
  lockedBy: string | null
  lockedUntil: number | null
  attemptNumber: number
  maxAttempts: number
  idempotencyKey: string
  lastError: string | null
  createdAt: number
  updatedAt: number
  requiredPrincipal: string
  observedAmount: string
  maxFinalizerFee: string
  settlementFeeBudget: string
  finalizerFee: string
}

export type Phase3InternalPayoutRecord = {
  kind: "payout_record"
  payoutId: string
  statusAccessTokenHash: string
  status: Phase3PayoutStatus
  amount?: string
  tokenSymbol?: string
  networkLabel?: string
  updatedAt?: string
  escrowAddress?: `0x${string}`
  escrowSalt?: string
  provider?: string
  providerContract?: `0x${string}`
  providerRequestId?: string
  providerRequestIdHash?: string
  providerSubmissionId?: string
  providerDataHash?: string
  providerCompletionProofHash?: string
  providerCompletionProofId?: string
  providerFailureProofHash?: string
  providerLiabilityStatus?: "unreserved" | "active" | "released" | "slashed"
  providerLiabilityAmount?: string
  completionDeadline?: string
  proofVerifierHealth?: "unknown" | "healthy" | "degraded" | "paused"
  amountOut?: string
  providerFee?: string
  operatorFee?: string
  destinationChainId?: number
  destinationToken?: `0x${string}`
  destinationRecipient?: `0x${string}`
  destinationRecipientHash?: string
  refundRecipientCommitment?: string
  sourceWithdrawalTxHash?: `0x${string}`
  sourceWithdrawalLogIndex?: number
  batchWithdrawalLogIndex?: number
  sourceWithdrawalBlockNumber?: number
  sourceWithdrawalBlockHash?: `0x${string}`
  sourcePool?: `0x${string}`
  provenanceAttestationId?: string
  operatorAddress?: `0x${string}`
  statusReasonHash?: string
  statusAuthority?:
    | "owner"
    | "provider_contract"
    | "proof_verifier"
    | "operator"
    | "public_expiry"
    | "refund_claimant"
    | "system"
  auditEventIds?: string[]
  recoveryPath?: string
  terminalPath?: string
  privacyControls?: string[]
  spamControls?: string[]
  crossChainPrivacyNotice?: string
}

export type Phase3InternalAdminRedactedExportRecord = Phase3AdminPaymentRecord & {
  kind: "admin_redacted_export"
  publicPaymentId?: string
}

export const PHASE3_CAMPAIGN_ATTRIBUTION_FLOWS = [
  "connected_wallet_shield",
  "one_time_deposit_funding",
  "privacy_link_payment",
  "profile_payment",
  "direct_tempo_payment"
] as const

export type Phase3CampaignAttributionFlow =
  (typeof PHASE3_CAMPAIGN_ATTRIBUTION_FLOWS)[number]

export const PHASE3_CAMPAIGN_ATTRIBUTION_SOURCES = [
  "authenticated_account_owner",
  "profile_beneficiary_owner",
  "authenticated_claimant",
  "campaign_account_owner"
] as const

export type Phase3CampaignAttributionSource =
  (typeof PHASE3_CAMPAIGN_ATTRIBUTION_SOURCES)[number]

export const PHASE3_CAMPAIGN_AWARD_CATEGORIES = [
  "shield_deposit_finalized",
  "private_payment_received"
] as const

export type Phase3CampaignAwardCategory =
  (typeof PHASE3_CAMPAIGN_AWARD_CATEGORIES)[number]

export const PHASE3_CAMPAIGN_ATTRIBUTION_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "awarded"
] as const

export type Phase3CampaignAttributionStatus =
  (typeof PHASE3_CAMPAIGN_ATTRIBUTION_STATUSES)[number]

export const PHASE3_CAMPAIGN_ATTRIBUTION_REJECTION_REASONS = [
  "missing_verified_attribution",
  "payer_credit_disabled",
  "profile_owner_changed",
  "infrastructure_address_candidate",
  "raw_depositor_candidate",
  "unconfirmed_settlement",
  "unsupported_flow"
] as const

export type Phase3CampaignAttributionRejectionReason =
  (typeof PHASE3_CAMPAIGN_ATTRIBUTION_REJECTION_REASONS)[number]

export type Phase3InternalCampaignAttributionRecord = {
  kind: "phase3_campaign_attribution"
  internalPaymentAttemptId: string
  campaignBeneficiaryUserId: string
  campaignProfileId?: string
  beneficiaryOwnerHash: string
  attributionSource: Phase3CampaignAttributionSource
  attributionFlow: Phase3CampaignAttributionFlow
  awardCategory: Phase3CampaignAwardCategory
  verificationStatus: Phase3CampaignAttributionStatus
  rejectionReason?: Phase3CampaignAttributionRejectionReason
  token: `0x${string}`
  assetId: number
  amount: string
  pool: `0x${string}`
  settlementTxHash?: `0x${string}`
  depositEventId?: string
  idempotencyKey: string
  createdAt?: string
  verifiedAt?: string
  completedAt?: string
}

export type Phase3InternalRecord =
  | Phase3InternalPaymentAttemptRecord
  | Phase3InternalRouteRecord
  | Phase3InternalVirtualDepositObservationRecord
  | Phase3InternalReceiptRecord
  | Phase3InternalInvoiceVerifyRecord
  | Phase3InternalRefundClaimRecord
  | Phase3InternalFinalizerJobRecord
  | Phase3InternalPayoutRecord
  | Phase3InternalCampaignAttributionRecord
  | Phase3InternalAdminRedactedExportRecord

export interface Phase3InternalDataSource {
  findPaymentAttemptByStatusTokenHash(
    statusTokenHash: string
  ): Promise<Phase3InternalPaymentAttemptRecord | null>
  listPaymentAttemptsByRecoveryWalletHash?(
    args: { recoveryWalletHash: string; linkRecoveryHash?: string }
  ): Promise<Phase3InternalPaymentAttemptRecord[]>
  findInvoiceVerifyRecord(args: {
    verifyTokenHash: string
  }): Promise<Phase3InternalInvoiceVerifyRecord | null>
  findRefundClaimById(claimId: string): Promise<Phase3InternalRefundClaimRecord | null>
  findPayoutRecordByStatusTokenHash?(
    statusTokenHash: string
  ): Promise<Phase3InternalPayoutRecord | null>
  listFinalizerJobs?(): Promise<Phase3InternalFinalizerJobRecord[]>
  listPayoutRecords?(): Promise<Phase3InternalPayoutRecord[]>
  listAdminExportRecords?(): Promise<Phase3InternalAdminRedactedExportRecord[]>
  listCampaignAttributions?(): Promise<Phase3InternalCampaignAttributionRecord[]>
}

export type Phase3AdminRedactionOptions = {
  privileged?: boolean
}

const PHASE3_SENSITIVE_FIELD_NAMES = new Set([
  "authorityWallet",
  "beneficiaryOwnerHash",
  "beneficiaryOwner",
  "campaignBeneficiaryUserId",
  "campaignProfileId",
  "depositEventId",
  "destinationRecipient",
  "escrowAddress",
  "escrowSalt",
  "idempotencyKey",
  "internalIndexerId",
  "internalPaymentAttemptId",
  "internalRouteId",
  "noteEnvelope",
  "payerWallet",
  "privateCommitment",
  "privateNoteId",
  "privateNoteIdentifier",
  "provider",
  "providerRequestId",
  "providerRequestIdHash",
  "providerSubmissionId",
  "providerDataHash",
  "providerCompletionProofHash",
  "providerCompletionProofId",
  "providerFailureProofHash",
  "providerContract",
  "providerRouteAddress",
  "providerRouteWallet",
  "providerWallet",
  "destinationToken",
  "destinationRecipientHash",
  "recipientAuthorityAddress",
  "recipientAuthorityWallet",
  "refundAddress",
  "refundRecipientCommitment",
  "refundWallet",
  "payerAddress",
  "sourceWallet",
  "sourcePool",
  "sourceWithdrawalBlockHash",
  "sourceWithdrawalBlockNumber",
  "batchWithdrawalLogIndex",
  "provenanceAttestationId",
  "sourceWithdrawalLogIndex",
  "sourceWithdrawalTxHash",
  "statusAccessToken",
  "statusAccessTokenHash",
  "userTag",
  "operatorAddress"
])

function isPhase3SensitiveFieldName(key: string) {
  return PHASE3_SENSITIVE_FIELD_NAMES.has(key) || /wallet(?:address)?$/iu.test(key)
}

function clonePhase3Value(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clonePhase3Value)
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, clonePhase3Value(nestedValue)])
  )
}

function redactPhase3SensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPhase3SensitiveFields)
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isPhase3SensitiveFieldName(key))
      .map(([key, nestedValue]) => [key, redactPhase3SensitiveFields(nestedValue)])
  )
}

export function redactPhase3PublicInvoiceVerifyResult(
  result: Record<string, unknown>
): Phase3PublicInvoiceVerifyResult {
  return redactPhase3SensitiveFields(result) as Phase3PublicInvoiceVerifyResult
}

export function redactPhase3PublicPaymentStatus(
  status: Record<string, unknown>
): Phase3PublicPaymentStatus {
  return redactPhase3SensitiveFields(status) as Phase3PublicPaymentStatus
}

export function redactPhase3AdminPaymentRecord<T extends Phase3AdminPaymentRecord>(
  record: T,
  options: Phase3AdminRedactionOptions = {}
): T {
  return (
    options.privileged ? clonePhase3Value(record) : redactPhase3SensitiveFields(record)
  ) as T
}

export function getRefundClaimantBinding(context: Phase3PaymentContext): RefundClaimantBinding {
  switch (context) {
    case "shield_self_funding":
      return "authenticated_connected_wallet"
    case "privacy_link_pay_with_wallet":
      return "connected_payer_wallet"
    case "privacy_link_one_time_address":
      return "payer_entered_refund_wallet"
  }
}

export function assertPhase3StatusTokenNotInternalId(args: {
  statusAccessToken: string
  internalIds: string[]
}) {
  const token = args.statusAccessToken.trim()
  if (!token) {
    throw new Error("Phase 3 status access token is required.")
  }
  if (args.internalIds.some((internalId) => internalId.trim() === token)) {
    throw new Error("Phase 3 status access token must not equal an internal id.")
  }
}

export function assertRefundClaimantBinding(
  context: Phase3PaymentContext,
  binding: RefundClaimantBinding
) {
  const expectedBinding = getRefundClaimantBinding(context)
  if (binding !== expectedBinding) {
    throw new Error(
      `Refund claimant binding mismatch for ${context}: expected ${expectedBinding}, received ${binding}.`
    )
  }
}

export type ParlyRecoveryEnvironment = "development" | "staging" | "mainnet"

export type RecoveryAuthContext = {
  appName: "Parly"
  officialOrigin: string
  currentOrigin: string
  purpose: "private payment note recovery"
  recoveryVersion: 2
  environment: ParlyRecoveryEnvironment
  chainId: number
  settlementDomainId: number
  poolAddress: `0x${string}`
  verifierAddress: `0x${string}`
  assetPoolIdentity: string
}

export const V1_RECOVERY_AUTH_MESSAGE =
  "Unlock Parly.fi Privacy.\n" +
  "Domain: app.parly.fi\n" +
  "Purpose: asymmetric note recovery and private execution.\n" +
  "Only sign on the official Parly domain."

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value)
    return url.origin.toLowerCase().replace(/\/+$/u, "")
  } catch {
    throw new Error(`Invalid recovery origin: ${value}`)
  }
}

function normalizeAddress(value: `0x${string}`, label: string) {
  if (!ADDRESS_RE.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address.`)
  }
  return value.toLowerCase()
}

export function assertRecoveryAuthContext(context: RecoveryAuthContext) {
  if (context.recoveryVersion !== 2) {
    throw new Error("v1 recovery signatures are forbidden in the launch recovery flow.")
  }
  if (context.appName !== "Parly") {
    throw new Error("Recovery app name must be Parly.")
  }
  if (context.purpose !== "private payment note recovery") {
    throw new Error("Recovery purpose mismatch.")
  }
  if (!["development", "staging", "mainnet"].includes(context.environment)) {
    throw new Error("Recovery environment must be development, staging, or mainnet.")
  }
  if (!Number.isInteger(context.chainId) || context.chainId <= 0) {
    throw new Error("Recovery chain ID must be a positive integer.")
  }
  if (!Number.isInteger(context.settlementDomainId) || context.settlementDomainId <= 0) {
    throw new Error("Recovery settlement domain ID must be a positive integer.")
  }
  if (!context.assetPoolIdentity.trim()) {
    throw new Error("Recovery asset/pool identity is required.")
  }

  normalizeAddress(context.poolAddress, "Recovery pool address")
  normalizeAddress(context.verifierAddress, "Recovery verifier address")

  if (context.environment === "mainnet") {
    const officialOrigin = normalizeOrigin(context.officialOrigin)
    const currentOrigin = normalizeOrigin(context.currentOrigin)
    if (officialOrigin !== currentOrigin) {
      throw new Error(
        `Recovery origin mismatch: current origin ${currentOrigin} does not match official origin ${officialOrigin}.`
      )
    }
  }
}

export function buildRecoveryAuthMessage(context: RecoveryAuthContext) {
  assertRecoveryAuthContext(context)

  const officialOrigin = normalizeOrigin(context.officialOrigin)
  const currentOrigin = normalizeOrigin(context.currentOrigin)
  const poolAddress = normalizeAddress(context.poolAddress, "Recovery pool address")
  const verifierAddress = normalizeAddress(context.verifierAddress, "Recovery verifier address")

  return [
    "Parly Recovery Authorization",
    "",
    "App: Parly",
    `Official origin: ${officialOrigin}`,
    `Current origin: ${currentOrigin}`,
    "Purpose: private payment note recovery",
    "Recovery version: 2",
    `Environment: ${context.environment}`,
    `Chain ID: ${context.chainId}`,
    `Settlement domain ID: ${context.settlementDomainId}`,
    `Pool address: ${poolAddress}`,
    `Verifier address: ${verifierAddress}`,
    `Asset / pool identity: ${context.assetPoolIdentity.trim()}`,
    "",
    "Warning: this signature controls private payment note recovery. Only sign inside the official Parly application."
  ].join("\n")
}
