export type PayoutV4RelayBundleBinding = {
  intentHash: `0x${string}`
  adapter: `0x${string}`
  escrow: `0x${string}`
  amountIn: string
  payoutAuthority: `0x${string}`
}

export type PayoutV4RelayBatchBinding = readonly PayoutV4RelayBundleBinding[]

export type PayoutV5WithdrawalBinding = {
  intentHash: `0x${string}`
  adapter: `0x${string}`
  withdrawalExecutor: `0x${string}`
  escrow: `0x${string}`
  amountIn: string
  executorFee: string
}

export type CanonicalPayoutV5AuthorizationMessageInput = {
  wallet: string
  quoteHash: string
  assetId: number
  sourcePool: string
  sourceToken: string
  escrow: string
  escrowAmountBaseUnits: string
  executorFeeBaseUnits: string
  protocolFeeBaseUnits: string
  destinationChainId: number
  destinationToken: string
  destinationRecipient: string
  destinationAmountOutBaseUnits: string
  relaySourceAmountBaseUnits: string
  relayRouteCostBaseUnits: string
  submissionReimbursementBaseUnits: string
  deliverySuccessFeeBaseUnits: string
  maximumOperatorFeeBaseUnits: string
  primaryRefundToken: string
  secondaryRefundToken: string
  refundRecipientCommitment: string
  requestIdHash: string
  refundRouteBindingHash: string
  quoteExpiresAt: number
  preSubmissionRecoveryDelaySeconds: number
  maximumCompletionDelaySeconds: number
  issuedAt: number
  nonce: string
}

/**
 * Formats already-validated V5 route terms into the one message accepted by
 * every Parly client and the web verifier. Validation remains at each trust
 * boundary; this function only prevents signed-text drift.
 */
export function buildCanonicalPayoutV5AuthorizationMessage(
  input: CanonicalPayoutV5AuthorizationMessageInput
) {
  return [
    "Parly Cross-Chain Payout Authorization",
    "Domain: parly.fi",
    "Action: authorize-payout-v5",
    `Wallet: ${input.wallet}`,
    `Quote: ${input.quoteHash}`,
    `Asset: ${input.assetId}`,
    `Source Pool: ${input.sourcePool}`,
    `Source Token: ${input.sourceToken}`,
    `Escrow: ${input.escrow}`,
    `Escrow Amount: ${input.escrowAmountBaseUnits}`,
    `Pool Executor Fee: ${input.executorFeeBaseUnits}`,
    `Pool Protocol Fee: ${input.protocolFeeBaseUnits}`,
    `Destination Chain: ${input.destinationChainId}`,
    `Destination Token: ${input.destinationToken}`,
    `Destination Recipient: ${input.destinationRecipient}`,
    `Destination Amount: ${input.destinationAmountOutBaseUnits}`,
    `Relay Source Amount: ${input.relaySourceAmountBaseUnits}`,
    `Relay Route Cost: ${input.relayRouteCostBaseUnits}`,
    `Submission Reimbursement: ${input.submissionReimbursementBaseUnits}`,
    `Delivery Success Fee: ${input.deliverySuccessFeeBaseUnits}`,
    `Maximum Operator Fee: ${input.maximumOperatorFeeBaseUnits}`,
    `Primary Refund Token: ${input.primaryRefundToken}`,
    `Secondary Refund Token: ${input.secondaryRefundToken}`,
    `Refund Claimant Commitment: ${input.refundRecipientCommitment}`,
    `Relay Request: ${input.requestIdHash}`,
    `Refund Route Binding: ${input.refundRouteBindingHash}`,
    `Quote Expires At: ${input.quoteExpiresAt}`,
    `Pre-Submission Recovery Delay: ${input.preSubmissionRecoveryDelaySeconds}`,
    `Maximum Completion Delay: ${input.maximumCompletionDelaySeconds}`,
    `Issued At: ${input.issuedAt}`,
    `Nonce: ${input.nonce}`,
    "The protocol and pool executor fees are charged after the Tempo withdrawal confirms and are non-refundable.",
    "The submission reimbursement is earned only after Relay accepts the exact route.",
    "The delivery fee is earned only after objective destination proof and is returned after a proven Relay refund."
  ].join("\n")
}

export type CanonicalPayoutV5BatchAuthorizationMessageInput = {
  wallet: string
  sourceNoteNullifierHash: string
  assetId: number
  sourcePool: string
  sourceToken: string
  quoteHashes: readonly string[]
  recipientCount: number
  aggregateEscrowAmountBaseUnits: string
  aggregateExecutorFeeBaseUnits: string
  aggregateProtocolFeeBaseUnits: string
  aggregateDestinationAmountBaseUnits: string
  maximumTotalNoteDeductionBaseUnits: string
  earliestQuoteExpiresAt: number
  issuedAt: number
  nonce: string
}

/**
 * Authorizes one ordered V5 batch manifest without selecting a relayer or
 * broadcasting a wallet transaction. Each quote hash retains its independent
 * destination, Relay route, escrow and claimant-bound recovery terms.
 */
export function buildCanonicalPayoutV5BatchAuthorizationMessage(
  input: CanonicalPayoutV5BatchAuthorizationMessageInput
) {
  return [
    "Parly Cross-Chain Batch Payout Authorization",
    "Domain: parly.fi",
    "Action: authorize-payout-v5-batch",
    `Wallet: ${input.wallet}`,
    `Source Note Nullifier Hash: ${input.sourceNoteNullifierHash}`,
    `Asset: ${input.assetId}`,
    `Source Pool: ${input.sourcePool}`,
    `Source Token: ${input.sourceToken}`,
    `Recipient Count: ${input.recipientCount}`,
    ...input.quoteHashes.map((quoteHash, index) => `Quote ${index + 1}: ${quoteHash}`),
    `Aggregate Escrow Amount: ${input.aggregateEscrowAmountBaseUnits}`,
    `Aggregate Pool Executor Fee: ${input.aggregateExecutorFeeBaseUnits}`,
    `Aggregate Pool Protocol Fee: ${input.aggregateProtocolFeeBaseUnits}`,
    `Aggregate Destination Amount: ${input.aggregateDestinationAmountBaseUnits}`,
    `Maximum Total Note Deduction: ${input.maximumTotalNoteDeductionBaseUnits}`,
    `Earliest Quote Expires At: ${input.earliestQuoteExpiresAt}`,
    `Issued At: ${input.issuedAt}`,
    `Nonce: ${input.nonce}`,
    "This authorization covers only the ordered payout routes and maximum deduction shown above.",
    "It does not broadcast a wallet transaction or select a relayer.",
    "Each recipient retains independent delivery proof, status and claimant-bound recovery."
  ].join("\n")
}

/**
 * The selected payout operator signs this exact message before the web service
 * releases a sealed V4 authority payload. It contains no recipient, provider,
 * refund, or proof material.
 */
export type PayoutV4RelayerAuthorityClaimMessageInput = {
  intentHash: `0x${string}`
  executionAddress: `0x${string}`
  timestamp: number
  nonce: string
}

export function buildPayoutV4RelayerAuthorityClaimMessage(
  claim: PayoutV4RelayerAuthorityClaimMessageInput
) {
  return [
    "Parly Payout V4 Relayer Authority Claim",
    "Domain: parly.fi",
    "Action: claim-payout-v4-authority",
    `Intent Hash: ${claim.intentHash.toLowerCase()}`,
    `Execution Address: ${claim.executionAddress.toLowerCase()}`,
    `Timestamp: ${claim.timestamp}`,
    `Nonce: ${claim.nonce}`
  ].join("\n")
}

export const PAYOUT_V4_EXECUTION_STEPS = [
  "acceptQuote",
  "poolWithdraw",
  "confirmEscrowReceipt",
  "submitPayout",
  "completePayout"
] as const

export type PayoutV4ExecutionStep = (typeof PAYOUT_V4_EXECUTION_STEPS)[number]

export const PAYOUT_V5_EXECUTION_STEPS = [
  "acceptQuote",
  "poolWithdraw",
  "confirmEscrowReceipt",
  "submitPayout",
  "proveCompletion",
  "proveRelayRefund",
  "claimRefund"
] as const

export type PayoutV5ExecutionStep = (typeof PAYOUT_V5_EXECUTION_STEPS)[number]

export const PAYOUT_V6_EXECUTION_STEPS = [
  "acceptQuote",
  "poolWithdraw",
  "confirmEscrowReceipt",
  "submitPayout",
  "proveCompletion",
  "proveRelayRefund",
  "claimRefund"
] as const

export type PayoutV6ExecutionStep = (typeof PAYOUT_V6_EXECUTION_STEPS)[number]

export type PayoutV5RelayerLeaseClaimMessageInput = {
  intentHash: `0x${string}`
  executionAddress: `0x${string}`
  timestamp: number
  nonce: string
}

export type PayoutV5RelayerJobListMessageInput = {
  executionAddress: `0x${string}`
  timestamp: number
  nonce: string
}

export function buildPayoutV5RelayerJobListMessage(input: PayoutV5RelayerJobListMessageInput) {
  return [
    "Parly payout V5 ready-job request",
    `Execution address: ${input.executionAddress.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    "This signature only requests redacted ready-job identifiers. It does not authorize a transaction."
  ].join("\n")
}

export function buildPayoutV5RelayerDownstreamListMessage(input: PayoutV5RelayerJobListMessageInput) {
  return [
    "Parly payout V5 downstream-job request",
    `Execution address: ${input.executionAddress.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    "This signature only requests encrypted downstream jobs previously submitted by this operator. It does not authorize a transaction."
  ].join("\n")
}

export function buildPayoutV5RelayerLeaseClaimMessage(claim: PayoutV5RelayerLeaseClaimMessageInput) {
  return [
    "Parly Payout V5 Relayer Lease",
    "Domain: parly.fi",
    "Action: claim-payout-v5-lease",
    `Intent Hash: ${claim.intentHash.toLowerCase()}`,
    `Execution Address: ${claim.executionAddress.toLowerCase()}`,
    `Timestamp: ${claim.timestamp}`,
    `Nonce: ${claim.nonce}`
  ].join("\n")
}

export type PayoutV5RelayerCheckpointMessageInput = PayoutV5RelayerLeaseClaimMessageInput & {
  step: PayoutV5ExecutionStep
  transactionHash: `0x${string}`
  evidenceHash: string
}

export function buildPayoutV5RelayerCheckpointMessage(checkpoint: PayoutV5RelayerCheckpointMessageInput) {
  return [
    "Parly Payout V5 Relayer Checkpoint",
    "Domain: parly.fi",
    "Action: record-payout-v5-checkpoint",
    `Intent Hash: ${checkpoint.intentHash.toLowerCase()}`,
    `Execution Address: ${checkpoint.executionAddress.toLowerCase()}`,
    `Step: ${checkpoint.step}`,
    `Transaction Hash: ${checkpoint.transactionHash.toLowerCase()}`,
    `Evidence Hash: ${checkpoint.evidenceHash.toLowerCase()}`,
    `Timestamp: ${checkpoint.timestamp}`,
    `Nonce: ${checkpoint.nonce}`
  ].join("\n")
}

export type PayoutV6RelayerJobListMessageInput = PayoutV5RelayerJobListMessageInput

export type PayoutV6RelayerLeaseClaimMessageInput = {
  manifestHash: `0x${string}`
  executionAddress: `0x${string}`
  timestamp: number
  nonce: string
}

export function buildPayoutV6RelayerJobListMessage(input: PayoutV6RelayerJobListMessageInput) {
  return [
    "Parly payout V6 ready-job request",
    `Execution address: ${input.executionAddress.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    "This signature only requests redacted ready-job identifiers. It does not authorize a transaction."
  ].join("\n")
}

export function buildPayoutV6RelayerLeaseClaimMessage(claim: PayoutV6RelayerLeaseClaimMessageInput) {
  return [
    "Parly Payout V6 Relayer Lease",
    "Domain: parly.fi",
    "Action: claim-payout-v6-lease",
    `Manifest Hash: ${claim.manifestHash.toLowerCase()}`,
    `Execution Address: ${claim.executionAddress.toLowerCase()}`,
    `Timestamp: ${claim.timestamp}`,
    `Nonce: ${claim.nonce}`
  ].join("\n")
}

export const PAYOUT_V5_RELAY_STATE_CATEGORIES = [
  "processing",
  "delayed",
  "destination_candidate",
  "refund_candidate",
  "terminal_unresolved"
] as const

export type PayoutV5RelayStateCategory = (typeof PAYOUT_V5_RELAY_STATE_CATEGORIES)[number]

export type PayoutV5RelayObservationMessageInput = PayoutV5RelayerLeaseClaimMessageInput & {
  requestIdHash: `0x${string}`
  responseHash: string
  stateCategory: PayoutV5RelayStateCategory
  observedAt: number
  expectedDeliveryAt?: number
  transactionHashes: readonly `0x${string}`[]
}

export function buildPayoutV5RelayObservationMessage(observation: PayoutV5RelayObservationMessageInput) {
  return [
    "Parly Payout V5 Relay Observation",
    "Domain: parly.fi",
    "Action: record-payout-v5-relay-observation",
    `Intent Hash: ${observation.intentHash.toLowerCase()}`,
    `Execution Address: ${observation.executionAddress.toLowerCase()}`,
    `Request Hash: ${observation.requestIdHash.toLowerCase()}`,
    `Response Hash: ${observation.responseHash.toLowerCase()}`,
    `State: ${observation.stateCategory}`,
    `Observed At: ${observation.observedAt}`,
    `Expected Delivery At: ${observation.expectedDeliveryAt ?? 0}`,
    `Transaction Hashes: ${observation.transactionHashes.map((hash) => hash.toLowerCase()).sort().join(",")}`,
    `Timestamp: ${observation.timestamp}`,
    `Nonce: ${observation.nonce}`
  ].join("\n")
}

export type PayoutV4RelayerCheckpointMessageInput = {
  intentHash: `0x${string}`
  executionAddress: `0x${string}`
  step: PayoutV4ExecutionStep
  transactionHash: `0x${string}`
  timestamp: number
  nonce: string
}

export function buildPayoutV4RelayerCheckpointMessage(
  checkpoint: PayoutV4RelayerCheckpointMessageInput
) {
  return [
    "Parly Payout V4 Relayer Checkpoint",
    "Domain: parly.fi",
    "Action: record-payout-v4-checkpoint",
    `Intent Hash: ${checkpoint.intentHash.toLowerCase()}`,
    `Execution Address: ${checkpoint.executionAddress.toLowerCase()}`,
    `Step: ${checkpoint.step}`,
    `Transaction Hash: ${checkpoint.transactionHash.toLowerCase()}`,
    `Timestamp: ${checkpoint.timestamp}`,
    `Nonce: ${checkpoint.nonce}`
  ].join("\n")
}

export type CanonicalRelayExecutionPayloadV1 = {
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
  // V4 contains only public intent bindings. Destination and provider data stay in the relayer-only authority payload.
  payoutV4?: PayoutV4RelayBundleBinding
  payoutV4Batch?: PayoutV4RelayBatchBinding
  payoutV5?: PayoutV5WithdrawalBinding
  payoutV5Batch?: readonly PayoutV5WithdrawalBinding[]
}

export type CanonicalPayoutV6ChildManifest = {
  intentHash: string
  escrow: string
  escrowAmountBaseUnits: string
  sourceExecutorFeeAllocationBaseUnits: string
  destinationChainId: number
  destinationToken: string
  destinationRecipient: string
  destinationAmountOutBaseUnits: string
  relaySourceAmountBaseUnits: string
  relayRouteCostBaseUnits: string
  submissionReimbursementBaseUnits: string
  deliverySuccessFeeBaseUnits: string
  refundRecipientCommitment: string
  requestIdHash: string
  refundRouteBindingHash: string
}

export type CanonicalPayoutV6Manifest = {
  version: 6
  manifestHash: string
  clientAuthorizationId: string
  adapter: string
  withdrawalExecutor: string
  selectedRelayer: string
  relayerPublicKeyHash: string
  sourcePool: string
  sourceToken: string
  assetId: number
  inputCount: number
  sourceCallHash: string
  sealedExecutionPayloadHash: string
  protocolFeeBaseUnits: string
  sourceExecutorFeeBaseUnits: string
  totalDestinationAmountBaseUnits: string
  totalEscrowAmountBaseUnits: string
  maximumTotalNoteDeductionBaseUnits: string
  quoteExpiresAt: number
  preSubmissionRecoveryDelaySeconds: number
  children: readonly CanonicalPayoutV6ChildManifest[]
}

export function buildCanonicalPayoutV6ManifestText(input: CanonicalPayoutV6Manifest) {
  return [
    "Payout Version: 6",
    `Client Authorization: ${input.clientAuthorizationId}`,
    `Adapter: ${input.adapter}`,
    `Withdrawal Executor: ${input.withdrawalExecutor}`,
    `Selected Relayer: ${input.selectedRelayer}`,
    `Relayer Box Key: ${input.relayerPublicKeyHash}`,
    `Source Pool: ${input.sourcePool}`,
    `Source Token: ${input.sourceToken}`,
    `Asset: ${input.assetId}`,
    `Source Input Count: ${input.inputCount}`,
    `Source Call: ${input.sourceCallHash}`,
    `Sealed Execution Payload: ${input.sealedExecutionPayloadHash}`,
    `Pool Protocol Fee: ${input.protocolFeeBaseUnits}`,
    `Source Executor Fee: ${input.sourceExecutorFeeBaseUnits}`,
    `Total Destination Amount: ${input.totalDestinationAmountBaseUnits}`,
    `Total Escrow Amount: ${input.totalEscrowAmountBaseUnits}`,
    `Maximum Total Private Balance Deduction: ${input.maximumTotalNoteDeductionBaseUnits}`,
    `Quote Expires At: ${input.quoteExpiresAt}`,
    `Pre-Submission Recovery Delay: ${input.preSubmissionRecoveryDelaySeconds}`,
    `Recipient Count: ${input.children.length}`,
    ...input.children.flatMap((child, index) => [
      `Ordered Child ${index + 1}: ${child.intentHash}`,
      `Child ${index + 1} Escrow: ${child.escrow}`,
      `Child ${index + 1} Escrow Amount: ${child.escrowAmountBaseUnits}`,
      `Child ${index + 1} Source Fee Allocation: ${child.sourceExecutorFeeAllocationBaseUnits}`,
      `Child ${index + 1} Destination Chain: ${child.destinationChainId}`,
      `Child ${index + 1} Destination Token: ${child.destinationToken}`,
      `Child ${index + 1} Destination Recipient: ${child.destinationRecipient}`,
      `Child ${index + 1} Destination Amount: ${child.destinationAmountOutBaseUnits}`,
      `Child ${index + 1} Relay Source Amount: ${child.relaySourceAmountBaseUnits}`,
      `Child ${index + 1} Relay Route Cost: ${child.relayRouteCostBaseUnits}`,
      `Child ${index + 1} Submission Reimbursement: ${child.submissionReimbursementBaseUnits}`,
      `Child ${index + 1} Delivery Success Fee: ${child.deliverySuccessFeeBaseUnits}`,
      `Child ${index + 1} Refund Claimant Commitment: ${child.refundRecipientCommitment}`,
      `Child ${index + 1} Relay Request: ${child.requestIdHash}`,
      `Child ${index + 1} Refund Route Binding: ${child.refundRouteBindingHash}`
    ])
  ].join("\n")
}

export function buildCanonicalPayoutV6AuthorizationMessage(input: {
  manifest: CanonicalPayoutV6Manifest
  wallet: string
  issuedAt: number
  nonce: string
}) {
  return [
    "Parly Cross-Chain Payout V6 Authorization",
    "Domain: parly.fi",
    "Action: authorize-payout-v6-manifest",
    `Wallet: ${input.wallet}`,
    `Manifest: ${input.manifest.manifestHash}`,
    buildCanonicalPayoutV6ManifestText(input.manifest),
    `Issued At: ${input.issuedAt}`,
    `Nonce: ${input.nonce}`,
    "This authorization covers only the exact ordered routes, fees, recovery policy, and sealed execution payload shown above.",
    "It does not broadcast a wallet transaction or reveal private source-note material.",
    "Completion requires objective destination proof. Before provider submission, the escrowed route amount becomes claimant-recoverable after the signed recovery delay."
  ].join("\n")
}

export type RelayExecutionFeeScheduleV2 = {
  chainId: number
  pool: `0x${string}`
  executionMode: 0 | 1
  inputCount: 1 | 2 | 3 | 4
  outputCount: number
  executorFee: string
  maximumGasPrice: string
  scheduleNonce: `0x${string}`
  validAfter: number
  expiry: number
  relayer: `0x${string}`
}

export type SignedRelayExecutionFeeScheduleV2 = {
  schedule: RelayExecutionFeeScheduleV2
  scheduleHash: `0x${string}`
  signature: `0x${string}`
}

export const RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN = {
  name: "ParlyRelayExecutionFeeScheduleV2",
  version: "2"
} as const

export const RELAY_EXECUTION_FEE_SCHEDULE_V2_TYPES = {
  RelayExecutionFeeScheduleV2: [
    { name: "chainId", type: "uint256" },
    { name: "pool", type: "address" },
    { name: "executionMode", type: "uint8" },
    { name: "inputCount", type: "uint8" },
    { name: "outputCount", type: "uint8" },
    { name: "executorFee", type: "uint256" },
    { name: "maximumGasPrice", type: "uint256" },
    { name: "scheduleNonce", type: "bytes32" },
    { name: "validAfter", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "relayer", type: "address" }
  ]
} as const

export type CanonicalRelayExecutionPayloadV2 = {
  version: 2
  poolVersion: 3
  verifierArtifactHash: `0x${string}`
  executionMode: 0 | 1
  pool: `0x${string}`
  pA: [`0x${string}`, `0x${string}`]
  pB: [[`0x${string}`, `0x${string}`], [`0x${string}`, `0x${string}`]]
  pC: [`0x${string}`, `0x${string}`]
  pubSignals: string[]
  recipients: `0x${string}`[]
  amounts: string[]
  settlementDomains: number[]
  newChangeCommitment: `0x${string}`
  newChangeEnvelope: `0x${string}`
  executorFee: string
  feeSchedule: SignedRelayExecutionFeeScheduleV2
}

export type CanonicalRelayExecutionPayloadV4 = {
  version: 4
  poolVersion: 4
  profileDigest: string
  proof: `0x${string}`
  publicSignals: string[]
  changeEnvelope: `0x${string}`
  feeSchedule: SignedRelayExecutionFeeScheduleV2
}

// Historical callers remain PoolV2-only until their explicit PoolV3 cutover.
export type CanonicalRelayExecutionPayload = CanonicalRelayExecutionPayloadV1
export type VersionedCanonicalRelayExecutionPayload =
  | CanonicalRelayExecutionPayloadV1
  | CanonicalRelayExecutionPayloadV2
  | CanonicalRelayExecutionPayloadV4

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

export type RelayCipherBundleV1 = {
  version: 1
  launchScope: "tempo-only" | "phase3-mainnet"
  relayerAddress: `0x${string}`
  ciphertext: `0x${string}`
}

export type RelayCipherBundleV2 = {
  version: 2
  launchScope: "phase3-mainnet"
  relayerAddress: `0x${string}`
  ciphertext: `0x${string}`
}

export type RelayCipherBundle = RelayCipherBundleV1 | RelayCipherBundleV2

export const MAX_RELAY_CIPHER_BUNDLE_BYTES = 32_768

export function relayCipherBundleByteLength(bundle: RelayCipherBundle) {
  return new TextEncoder().encode(JSON.stringify(bundle)).byteLength
}

export type RelayerRegistryEntry = {
  executionAddress: `0x${string}`
  publicKeyB64: string
  feeSchedules?: SignedRelayExecutionFeeScheduleV2[]
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

export const PHASE3_ROUTE_EVIDENCE_CONTEXTS = [
  "owner_wallet_deposit",
  "owner_one_time_deposit",
  "profile_payment",
  "invoice_payment",
  "private_payout",
  "refund"
] as const

export type Phase3RouteEvidenceContext = (typeof PHASE3_ROUTE_EVIDENCE_CONTEXTS)[number]

export const PHASE3_RECEIPT_SUBJECT_TYPES = [
  "profile_payment",
  "invoice_payment",
  "private_payout",
  "refund"
] as const

export type Phase3ReceiptSubjectType = (typeof PHASE3_RECEIPT_SUBJECT_TYPES)[number]

export const PHASE3_RECEIPT_PROOF_TYPES = [
  "tx_hash_child_key",
  "verification_token"
] as const

export type Phase3ReceiptProofType = (typeof PHASE3_RECEIPT_PROOF_TYPES)[number]

export const PHASE3_DISCLOSURE_FIELDS = [
  "source_chain",
  "source_tx",
  "source_wallet",
  "relay_request",
  "settlement_tx",
  "payer_display_name",
  "payer_reference",
  "receiver_public_profile",
  "invoice_label",
  "funding_source_reference"
] as const

export type Phase3DisclosureField = (typeof PHASE3_DISCLOSURE_FIELDS)[number]

export function isPhase3OwnerDepositReceiptSubject(_value: string): false {
  return false
}

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

// V4 preserves the V3 public lifecycle vocabulary while changing the
// on-chain fee settlement and relayer authority model.
export const PHASE3_PAYOUT_V4_STATUSES = [...PHASE3_PAYOUT_V3_STATUSES] as const

export type Phase3PayoutV4Status = (typeof PHASE3_PAYOUT_V4_STATUSES)[number]

export const PHASE3_PAYOUT_V5_STATUSES = [
  "none",
  "escrow_pending",
  "escrow_receipt_confirmed",
  "payout_submitted",
  "payout_completed",
  "refund_available",
  "refunded",
  "manual_review"
] as const

export type Phase3PayoutV5Status = (typeof PHASE3_PAYOUT_V5_STATUSES)[number]

export type Phase3PayoutV5LifecycleEventType =
  | "quote_accepted"
  | "pool_withdrawal_confirmed"
  | "escrow_receipt_confirmed"
  | "payout_submitted"
  | "payout_completed"
  | "pre_submission_refund_available"
  | "relay_refund_proven"
  | "refund_claimed"
  | "residual_refund_claimed"

export type Phase3PayoutV3LifecycleEventType =
  | "quote_accepted"
  | "escrow_receipt_confirmed"
  | "payout_submitted"
  | "payout_completed"
  | "escrow_refund_available"
  | "refund_available"
  | "refund_claimed"

export type Phase3PayoutV4LifecycleEventType =
  | "quote_accepted"
  | "pool_withdrawal_confirmed"
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

export function mapPhase3PayoutV4EventToPublicLifecycle(input: {
  eventId: string
  eventType: Phase3PayoutV4LifecycleEventType
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
    case "pool_withdrawal_confirmed":
      return [event("withdrawal", "pool_withdrawal_pending", "operator")]
    case "escrow_receipt_confirmed":
      return [event("receipt", "escrow_receipt_confirmed", "system")]
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

export type Phase3PayoutV5PublicLifecycleProjection = {
  v5EventType: Phase3PayoutV5LifecycleEventType
  v5Status?: Phase3PayoutV5Status
  publicEvents: Phase3PayoutLifecycleEvent[]
  requiredDatasourceEffects: readonly string[]
  redactionPolicy: readonly string[]
}

export function mapPhase3PayoutV5EventToPublicLifecycle(input: {
  eventId: string
  eventType: Phase3PayoutV5LifecycleEventType
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
    case "pool_withdrawal_confirmed":
      return [event("withdrawal", "pool_withdrawal_pending", "operator")]
    case "escrow_receipt_confirmed":
      return [event("receipt", "escrow_receipt_confirmed", "system")]
    case "payout_submitted":
      return [
        event("pending", "payout_pending", "operator"),
        event("submitted", "payout_submitted", "provider_contract")
      ]
    case "payout_completed":
      if (!input.evidenceHash?.trim()) throw new Error("evidence hash required for V5 completion")
      return [event("completed", "payout_completed", "proof_verifier", input.evidenceHash)]
    case "pre_submission_refund_available":
      return [
        event("expired", "payout_expired", "public_expiry", input.evidenceHash),
        event("available", "refund_available", "public_expiry", input.evidenceHash)
      ]
    case "relay_refund_proven":
      if (!input.evidenceHash?.trim()) throw new Error("evidence hash required for V5 Relay refund")
      return [event("available", "refund_available", "proof_verifier", input.evidenceHash)]
    case "refund_claimed":
      if (!input.evidenceHash?.trim()) throw new Error("evidence hash required for refunded")
      return [event("refunded", "refunded", "refund_claimant", input.evidenceHash)]
    case "residual_refund_claimed":
      if (!input.evidenceHash?.trim()) throw new Error("evidence hash required for residual refund")
      return []
  }
}

export function projectPhase3PayoutV5EventForDatasource(input: {
  eventId: string
  eventType: Phase3PayoutV5LifecycleEventType
  v5Status?: Phase3PayoutV5Status
  evidenceHash?: string
  updatedAt?: string
}): Phase3PayoutV5PublicLifecycleProjection {
  const publicEvents = mapPhase3PayoutV5EventToPublicLifecycle(input)
  const effects = publicEvents.map((event) => `append:${event.status}`)
  if (input.eventType === "payout_submitted") effects.push("set:relay_state=processing")
  if (input.eventType === "payout_completed") effects.push("set:terminal_path=completed")
  if (input.eventType === "relay_refund_proven") effects.push("set:proof_kind=relay_refund")
  if (input.eventType === "refund_claimed") effects.push("set:terminal_path=refunded")
  if (input.eventType === "residual_refund_claimed") effects.push("append:residual_refund_claimed")
  return {
    v5EventType: input.eventType,
    v5Status: input.v5Status,
    publicEvents,
    requiredDatasourceEffects: effects,
    redactionPolicy: [
      "store Relay request ids and executable provider payloads only inside encrypted preparation records",
      "publish only opaque support references and hashed request, recipient, and evidence identifiers",
      "never store note secrets, refund salts, raw status tokens, or destination recipients in projections"
    ]
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

export type Phase3PayoutV4PublicLifecycleProjection = {
  v4EventType: Phase3PayoutV4LifecycleEventType
  v4Status?: Phase3PayoutV4Status
  publicEvents: Phase3PayoutLifecycleEvent[]
  requiredDatasourceEffects: readonly string[]
  redactionPolicy: readonly string[]
}

export function projectPhase3PayoutV4EventForDatasource(input: {
  eventId: string
  eventType: Phase3PayoutV4LifecycleEventType
  v4Status?: Phase3PayoutV4Status
  evidenceHash?: string
  updatedAt?: string
}): Phase3PayoutV4PublicLifecycleProjection {
  const publicEvents = mapPhase3PayoutV4EventToPublicLifecycle(input)
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
    v4EventType: input.eventType,
    v4Status: input.v4Status,
    publicEvents,
    requiredDatasourceEffects,
    redactionPolicy: [
      "hash escrow, provider contract, payout authority, actor, source adapter, and signer",
      "store provider submission and proof ids only as already-hashed identifiers",
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
  adapterVersion?: "v3" | "v4" | "v5"
  amount?: string
  amountDecimals?: number
  tokenSymbol?: string
  networkLabel?: string
  destinationChainId?: number
  refundAmount?: string
  sourceAmountOut?: string
  providerSourceAmount?: string
  outboundExecutionFee?: string
  submissionReimbursement?: string
  deliverySuccessFee?: string
  actualRefundAmounts?: ReadonlyArray<{ tokenSymbol: string; amount: string }>
  supportReference?: string
  relayState?: "not_submitted" | "processing" | "delayed" | "refund_pending" | "terminal"
  lastCheckedAt?: string
  nextCheckAt?: string
  expectedDeliveryAt?: string
  proofState?: "pending" | "quorum_pending" | "verified" | "refund_available" | "refunded"
  refundEligible?: boolean
  quoteExpiresAt?: number
  onChainStatus?: number
  recoveryAvailableAt?: number
  recoveryMatured?: boolean
  recoveryAction?: "none" | "waiting" | "start_verifier_recovery" | "make_refund_available" | "claim_refund" | "refunded"
  progressStep?: number
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
  quoteExpiresAt?: string
  tokenSymbol?: string
  networkLabel?: string
  adapterVersion?: "v3" | "v4" | "v5"
  sourceAmountOut?: string
  providerSourceAmount?: string
  outboundExecutionFee?: string
  submissionReimbursement?: string
  deliverySuccessFee?: string
  actualRefundAmounts?: ReadonlyArray<{ tokenSymbol: string; amount: string }>
  supportReference?: string
  relayState?: "not_submitted" | "processing" | "delayed" | "refund_pending" | "terminal"
  lastCheckedAt?: string
  nextCheckAt?: string
  expectedDeliveryAt?: string
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
