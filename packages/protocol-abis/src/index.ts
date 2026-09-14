import { parseAbi } from "viem"

export const POOL_ABI = parseAbi([
  "function deposit(uint256,uint256,uint256,bytes) external",
  "function batchWithdraw(uint256[2],uint256[2][2],uint256[2],uint256[50],address[],uint256[],uint32[],bytes32,bytes,bytes[]) external",
  "function quoteCrossChainFee(uint32,address,uint256,bytes) view returns (uint256)",
  "function globalFeeBps() view returns (uint256)",
  "function setGlobalFeeBps(uint256) external",
  "function lzFeeToken() view returns (address)",
  "function lzFeeFundingToken() view returns (address)",
  "function nullifierHashes(bytes32) view returns (bool)",
  "function currentRoot() view returns (bytes32)",
  "function verifier() view returns (address)"
])

export const tempoShieldedPoolV2Abi = parseAbi([
  "function deposit(uint256 innerCommitment,uint256 principalAmount,bytes envelope) external",
  "function depositFromIngress(uint256 innerCommitment,uint256 principalAmount,uint256 policySubjectField,bytes envelope,bytes32 attemptId) external returns (bytes32 finalCommitment,uint32 leafIndex)",
  "function batchWithdraw(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,uint256[50] pubSignals,address[] recipients,uint256[] amounts,uint32[] settlementDomains,bytes32 newChangeCommitment,bytes newChangeEnvelope) external",
  "function currentRoot() view returns (bytes32)",
  "function globalFeeBps() view returns (uint256)",
  "function nullifierHashes(bytes32) view returns (bool)",
  "function settlementDomainId() view returns (uint32)",
  "function assetId() view returns (uint256)",
  "function underlyingToken() view returns (address)",
  "function knownCommitments(bytes32) view returns (bool)",
  "event DepositV2(bytes32 indexed commitment,uint256 amount,uint32 leafIndex,uint256 indexed assetId,uint8 kind)",
  "event LeafInserted(bytes32 indexed commitment,uint32 indexed leafIndex,uint256 indexed assetId,uint8 kind)",
  "event NoteEnvelope(bytes32 indexed commitment,uint8 indexed kind,uint256 indexed assetId,bytes envelope)",
  "event BatchWithdrawal(bytes32 indexed nullifierHash,address indexed executor,uint256 indexed assetId,uint256 protocolFee,uint256 executorFee,bytes32[] childKeys)",
  "event IngressReceiverSet(address indexed receiver)",
  "event GlobalFeeUpdated(uint256 oldFeeBps,uint256 newFeeBps)"
])

export const relayerOperatorRegistryAbi = parseAbi([
  "function CAPABILITY_SETTLEMENT() view returns (bytes32)",
  "function CAPABILITY_PAYOUT() view returns (bytes32)",
  "function registerOperator() external",
  "function activateCapability(bytes32 capability) external",
  "function registeredOperators(address) view returns (bool)",
  "function blockedOperators(address) view returns (bool)",
  "function activeCapabilities(address,bytes32) view returns (bool)",
  "function blockedCapabilities(address,bytes32) view returns (bool)",
  "function paused() view returns (bool)",
  "function isEligibleOperator(address) view returns (bool)",
  "function isEligibleOperatorFor(address operator,bytes32 capability) view returns (bool)",
  "event OperatorRegistered(address indexed operator)",
  "event OperatorBlocked(address indexed operator,bool blocked)",
  "event OperatorCapabilityActivated(address indexed operator,bytes32 indexed capability)",
  "event OperatorCapabilityBlocked(address indexed operator,bytes32 indexed capability,bool blocked)",
  "event Paused(address account)",
  "event Unpaused(address account)"
])

export const parlyPayoutAdapterAbi = parseAbi([
  "function executionEnabled() view returns (bool)",
  "function payoutSigner() view returns (address)",
  "function provenanceSigner() view returns (address)",
  "function settlementDomainId() view returns (uint256)",
  "function environment() view returns (bytes32)",
  "function operatorRegistry() view returns (address)",
  "function approvedPools(address) view returns (bool)",
  "function approvedTokens(address) view returns (bool)",
  "function approvedProviders(bytes32) view returns (bool)",
  "function providerContracts(bytes32) view returns (address)",
  "function approvedDestinationChains(uint256) view returns (bool)",
  "function consumedNonces(bytes32) view returns (bool)",
  "function consumedQuoteHashes(bytes32) view returns (bool)",
  "function consumedProvenanceAttestations(bytes32) view returns (bool)",
  "function consumedProviderCompletionProofs(bytes32) view returns (bool)",
  "function consumedDestinationEvents(bytes32) view returns (bool)",
  "function minimumFinalityConfirmations(uint256) view returns (uint256)",
  "function maxCompletionDelay() view returns (uint256)",
  "function intentByEscrowSalt(bytes32) view returns (bytes32)",
  "function intentByEscrow(address) view returns (bytes32)",
  "function payoutStatus(bytes32) view returns (uint8)",
  "function predictEscrowAddress(bytes32 escrowSalt) view returns (address)",
  "function hashPayoutIntent((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,bytes32 provider,address providerContract,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 refundRecipientCommitment,uint256 maxProviderFee,uint256 maxOperatorFee,bytes32 quoteHash,bytes32 requestIdHash,bytes32 providerDataHash,bytes32 nonce,uint256 expiry,address payoutAuthority) intent) view returns (bytes32)",
  "function hashProvenanceAttestation((bytes32 intentHash,address sourcePool,address token,uint256 assetId,uint256 amount,address escrow,bytes32 withdrawalTxHash,uint256 transferLogIndex,uint256 batchWithdrawalLogIndex,uint256 blockNumber,bytes32 blockHash,bytes32 environment,uint256 chainId,uint256 settlementDomainId,bytes32 attestationId) attestation) view returns (bytes32)",
  "function validatePayoutIntent((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,bytes32 provider,address providerContract,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 refundRecipientCommitment,uint256 maxProviderFee,uint256 maxOperatorFee,bytes32 quoteHash,bytes32 requestIdHash,bytes32 providerDataHash,bytes32 nonce,uint256 expiry,address payoutAuthority) intent,bytes signature) view returns (bytes32 intentHash,address escrow)",
  "function getPayoutRecord(bytes32 intentHash) view returns ((address escrow,address sourcePool,address token,bytes32 escrowSalt,bytes32 refundRecipientCommitment,bytes32 requestIdHash,bytes32 providerSubmissionId,bytes32 providerCompletionProofHash,bytes32 providerFailureProofHash,bytes32 destinationRecipientHash,bytes32 provenanceAttestationId,bytes32 sourceWithdrawalTxHash,uint256 sourceWithdrawalLogIndex,uint256 batchWithdrawalLogIndex,uint256 sourceWithdrawalBlockNumber,bytes32 sourceWithdrawalBlockHash,uint256 assetId,uint256 amountIn,uint256 minAmountOut,uint256 maxProviderFee,uint256 maxOperatorFee,address providerContract,uint256 providerFee,uint256 operatorFee,uint256 amountOut,uint256 destinationChainId,address destinationToken,uint256 expiry,uint256 completionDeadline,address payoutAuthority,address preparedBy))",
  "function pause() external",
  "function unpause() external",
  "function setPool(address pool,bool approved) external",
  "function setToken(address token,bool approved) external",
  "function setProvider(bytes32 provider,bool approved) external",
  "function markPoolWithdrawalPending(bytes32 intentHash) external",
  "function setProviderContract(bytes32 provider,address providerContract) external",
  "function setDestinationChain(uint256 chainId,bool approved) external",
  "function setMinimumFinalityConfirmations(uint256 chainId,uint256 confirmations) external",
  "function setPayoutSigner(address signer) external",
  "function setProvenanceSigner(address signer) external",
  "function setExecutionEnabled(bool enabled) external",
  "function setMaxCompletionDelay(uint256 delay) external",
  "function acceptQuote((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,bytes32 provider,address providerContract,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 refundRecipientCommitment,uint256 maxProviderFee,uint256 maxOperatorFee,bytes32 quoteHash,bytes32 requestIdHash,bytes32 providerDataHash,bytes32 nonce,uint256 expiry,address payoutAuthority) intent,bytes signature) external",
  "function confirmEscrowReceipt(bytes32 intentHash,bytes32 sourceWithdrawalTxHash,uint256 sourceWithdrawalLogIndex) external",
  "function confirmEscrowReceipt(bytes32 intentHash,(bytes32 intentHash,address sourcePool,address token,uint256 assetId,uint256 amount,address escrow,bytes32 withdrawalTxHash,uint256 transferLogIndex,uint256 batchWithdrawalLogIndex,uint256 blockNumber,bytes32 blockHash,bytes32 environment,uint256 chainId,uint256 settlementDomainId,bytes32 attestationId) attestation,bytes signature) external",
  "function executePayoutWithReceipt((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,bytes32 provider,address providerContract,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 refundRecipientCommitment,uint256 maxProviderFee,uint256 maxOperatorFee,bytes32 quoteHash,bytes32 requestIdHash,bytes32 providerDataHash,bytes32 nonce,uint256 expiry,address payoutAuthority) intent,bytes payoutSignature,(bytes32 intentHash,address sourcePool,address token,uint256 assetId,uint256 amount,address escrow,bytes32 withdrawalTxHash,uint256 transferLogIndex,uint256 batchWithdrawalLogIndex,uint256 blockNumber,bytes32 blockHash,bytes32 environment,uint256 chainId,uint256 settlementDomainId,bytes32 attestationId) attestation,bytes provenanceSignature,uint256 providerFee,uint256 operatorFee,bytes providerData) external",
  "function submitPreparedPayout((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,bytes32 provider,address providerContract,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 refundRecipientCommitment,uint256 maxProviderFee,uint256 maxOperatorFee,bytes32 quoteHash,bytes32 requestIdHash,bytes32 providerDataHash,bytes32 nonce,uint256 expiry,address payoutAuthority) intent,bytes payoutSignature,bytes providerData) external",
  "function hashProviderCompletionProof((bytes32 intentHash,bytes32 providerSubmissionId,bytes32 requestIdHash,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,uint256 amountOut,bytes32 destinationTxHash,uint256 destinationLogIndex,uint256 destinationBlockNumber,bytes32 destinationBlockHash,uint256 finalityConfirmations,bytes32 proofId) proof) pure returns (bytes32)",
  "function confirmProviderPayout((bytes32 intentHash,bytes32 providerSubmissionId,bytes32 requestIdHash,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,uint256 amountOut,bytes32 destinationTxHash,uint256 destinationLogIndex,uint256 destinationBlockNumber,bytes32 destinationBlockHash,uint256 finalityConfirmations,bytes32 proofId) proof) external",
  "function confirmProviderFailure(bytes32 intentHash,bytes32 providerSubmissionId,bytes32 failureProofHash,bytes32 reasonHash) external",
  "function prepareExecution(bytes32 intentHash,uint256 providerFee,uint256 operatorFee) external",
  "function markPayoutExpired(bytes32 intentHash) external",
  "function markProviderFailed(bytes32 intentHash,bytes32 reasonHash) external",
  "function markManualReview(bytes32 intentHash,bytes32 reasonHash) external",
  "function makeRefundAvailable(bytes32 intentHash,bytes32 reasonHash) external",
  "function makeRefundAvailableAfterExpiry(bytes32 intentHash) external",
  "function escalateSubmittedPayoutAfterExpiry(bytes32 intentHash) external",
  "function claimRefundAfterExpiry(bytes32 intentHash,bytes32 salt) external",
  "function claimRefund(bytes32 intentHash,bytes32 salt) external",
  "event PayoutStatusChanged(bytes32 indexed intentHash,address indexed escrow,uint8 status,bytes32 reasonHash)",
  "event EscrowReserved(bytes32 indexed intentHash,address indexed escrow,bytes32 indexed escrowSalt)",
  "event EscrowReceiptConfirmed(bytes32 indexed intentHash,address indexed escrow,bytes32 indexed provenanceAttestationId,bytes32 sourceWithdrawalTxHash,address sourcePool,uint256 transferLogIndex,uint256 batchWithdrawalLogIndex,uint256 blockNumber,bytes32 blockHash)",
  "event PayoutSubmitted(bytes32 indexed intentHash,address indexed escrow,bytes32 indexed provider,address providerContract,bytes32 requestIdHash,bytes32 providerSubmissionId,uint256 amountOut,uint256 providerFee,uint256 operatorFee)",
  "event ProviderPayoutConfirmed(bytes32 indexed intentHash,address indexed providerContract,bytes32 indexed providerSubmissionId,bytes32 proofId,bytes32 completionProofHash)",
  "event ProviderPayoutFailed(bytes32 indexed intentHash,address indexed providerContract,bytes32 indexed providerSubmissionId,bytes32 failureProofHash,bytes32 reasonHash)",
  "event PoolSet(address indexed pool,bool approved)",
  "event TokenSet(address indexed token,bool approved)",
  "event ProviderSet(bytes32 indexed provider,bool approved)",
  "event ProviderContractSet(bytes32 indexed provider,address indexed providerContract)",
  "event DestinationChainSet(uint256 indexed chainId,bool approved)",
  "event MinimumFinalityConfirmationsSet(uint256 indexed chainId,uint256 confirmations)",
  "event PayoutSignerSet(address indexed signer)",
  "event ProvenanceSignerSet(address indexed signer)",
  "event ExecutionEnabledSet(bool enabled)",
  "event MaxCompletionDelaySet(uint256 delay)"
])

export const parlyPayoutAdapterV3Abi = parseAbi([
  "function executionEnabled() view returns (bool)",
  "function operatorRegistry() view returns (address)",
  "function liabilityVault() view returns (address)",
  "function proofVerifier() view returns (address)",
  "function VERIFIER_PAUSED_RECOVERY_DELAY() view returns (uint256)",
  "function payoutSigner() view returns (address)",
  "function provenanceSigner() view returns (address)",
  "function environment() view returns (bytes32)",
  "function settlementDomainId() view returns (uint256)",
  "function approvedPools(address pool) view returns (bool)",
  "function approvedTokens(address token) view returns (bool)",
  "function approvedProviderContracts(address providerContract) view returns (bool)",
  "function consumedNonces(bytes32 nonce) view returns (bool)",
  "function consumedProvenanceAttestations(bytes32 provenanceHash) view returns (bool)",
  "function status(bytes32 intentHash) view returns (uint8)",
  "function minimumFinalityConfirmations(uint256 chainId) view returns (uint256)",
  "function consumedDestinationEvents(bytes32 destinationEventId) view returns (bool)",
  "function consumedProviderSubmissionIds(bytes32 providerSubmissionId) view returns (bool)",
  "function verifierPausedRecoveryStartedAt(bytes32 intentHash) view returns (uint256)",
  "function predictEscrowAddress(bytes32 escrowSalt) view returns (address)",
  "function hashPayoutIntent((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,address providerContract,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,bytes32 refundRecipientCommitment,bytes32 providerDataHash,bytes32 requestIdHash,bytes32 nonce,uint256 quoteExpiry,uint256 maxCompletionDelay,address payoutAuthority) intent) view returns (bytes32)",
  "function hashProvenanceAttestation((bytes32 intentHash,address sourcePool,address token,uint256 assetId,uint256 amount,address escrow,bytes32 withdrawalTxHash,uint256 transferLogIndex,uint256 blockNumber,bytes32 blockHash,bytes32 attestationNonce) attestation) view returns (bytes32)",
  "function getPayoutRecord(bytes32 intentHash) view returns ((address escrow,address sourcePool,address token,address providerContract,address payoutAuthority,bytes32 escrowSalt,bytes32 refundRecipientCommitment,bytes32 providerDataHash,bytes32 requestIdHash,bytes32 providerSubmissionId,bytes32 liabilityId,bytes32 destinationRecipientHash,bytes32 provenanceHash,uint256 assetId,uint256 amountIn,uint256 minAmountOut,uint256 amountOut,uint256 destinationChainId,address destinationToken,uint256 requiredFinalityConfirmations,uint256 quoteExpiry,uint256 maxCompletionDelay,uint256 completionDeadline,uint256 receiptConfirmedAt))",
  "function pause() external",
  "function unpause() external",
  "function setExecutionEnabled(bool enabled) external",
  "function setPool(address pool,bool approved) external",
  "function setToken(address token,bool approved) external",
  "function setProviderContract(address providerContract,bool approved) external",
  "function setDestinationChain(uint256 chainId,uint256 confirmations) external",
  "function setPayoutSigner(address signer) external",
  "function setProvenanceSigner(address signer) external",
  "function acceptQuote((bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address token,uint256 assetId,uint256 amountIn,uint256 minAmountOut,address providerContract,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,bytes32 refundRecipientCommitment,bytes32 providerDataHash,bytes32 requestIdHash,bytes32 nonce,uint256 quoteExpiry,uint256 maxCompletionDelay,address payoutAuthority) intent,bytes signature) external",
  "function confirmEscrowReceipt((bytes32 intentHash,address sourcePool,address token,uint256 assetId,uint256 amount,address escrow,bytes32 withdrawalTxHash,uint256 transferLogIndex,uint256 blockNumber,bytes32 blockHash,bytes32 attestationNonce) attestation,bytes signature) external",
  "function submitPayout(bytes32 intentHash,address destinationRecipient,bytes providerData) external",
  "function completePayout((bytes32 intentHash,bytes32 providerSubmissionId,bytes32 requestIdHash,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,uint256 amountOut,bytes32 destinationTxHash,uint256 destinationLogIndex,uint256 destinationBlockNumber,bytes32 destinationBlockHash,uint256 finalityConfirmations,bytes32 proofNonce) proof,bytes[] signatures) external",
  "function makeRefundAvailableAfterDeadline(bytes32 intentHash) external",
  "function startVerifierPausedRecovery(bytes32 intentHash) external",
  "function makeEscrowRefundAvailableAfterDeadline(bytes32 intentHash) external",
  "function claimRefund(bytes32 intentHash,bytes32 refundSalt) external",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event PoolSet(address indexed pool,bool approved)",
  "event TokenSet(address indexed token,bool approved)",
  "event ProviderContractSet(address indexed providerContract,bool approved)",
  "event DestinationChainSet(uint256 indexed chainId,uint256 minimumFinalityConfirmations)",
  "event PayoutSignerSet(address indexed signer)",
  "event ProvenanceSignerSet(address indexed signer)",
  "event QuoteAccepted(bytes32 indexed intentHash,address indexed escrow,address indexed providerContract)",
  "event EscrowReceiptConfirmed(bytes32 indexed intentHash,bytes32 indexed provenanceHash)",
  "event PayoutSubmitted(bytes32 indexed intentHash,address indexed providerContract,bytes32 indexed providerSubmissionId,bytes32 liabilityId,uint256 completionDeadline,uint256 amountIn,uint256 amountOut)",
  "event PayoutCompleted(bytes32 indexed intentHash,bytes32 indexed proofHash,address indexed caller)",
  "event EscrowRefundAvailable(bytes32 indexed intentHash,uint256 principal,address indexed caller)",
  "event VerifierPausedRecoveryStarted(bytes32 indexed intentHash,uint256 recoveryAvailableAt,address indexed caller)",
  "event RefundAvailable(bytes32 indexed intentHash,uint256 principal,address indexed caller)",
  "event RefundClaimed(bytes32 indexed intentHash,address indexed recipient,uint256 principal)",
  "event ExecutionEnabledSet(bool enabled)"
])

export const parlyPayoutLiabilityVaultAbi = parseAbi([
  "function adapter() view returns (address)",
  "function adapterLocked() view returns (bool)",
  "function providerBalance(address provider,address token) view returns (uint256)",
  "function activeLiability(address provider,address token) view returns (uint256)",
  "function availableBalance(address provider,address token) view returns (uint256)",
  "function getLiability(bytes32 liabilityId) view returns ((address provider,address token,address compensationRecipient,uint256 amount,uint256 deadline,uint8 status))",
  "function setAdapter(address newAdapter) external",
  "function pause() external",
  "function unpause() external",
  "function deposit(address token,uint256 amount) external",
  "function withdraw(address token,address recipient,uint256 amount) external",
  "function reserveLiability(bytes32 liabilityId,address provider,address token,uint256 amount,uint256 deadline,address compensationRecipient) external",
  "function releaseLiability(bytes32 liabilityId) external",
  "function slashLiability(bytes32 liabilityId) external returns (uint256 amount)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event AdapterSet(address indexed previousAdapter,address indexed newAdapter)",
  "event AdapterLocked(address indexed adapter)",
  "event ProviderDeposit(address indexed provider,address indexed token,uint256 amount,uint256 providerBalance)",
  "event ProviderWithdrawal(address indexed provider,address indexed token,address indexed recipient,uint256 amount,uint256 providerBalance)",
  "event LiabilityReserved(bytes32 indexed liabilityId,address indexed provider,address indexed token,uint256 amount,uint256 deadline,address compensationRecipient)",
  "event LiabilityReleased(bytes32 indexed liabilityId,address indexed provider,address indexed token,uint256 amount)",
  "event LiabilitySlashed(bytes32 indexed liabilityId,address indexed provider,address indexed token,address compensationRecipient,uint256 amount,address caller)"
])

export const parlyPayoutProofVerifierAbi = parseAbi([
  "function threshold() view returns (uint256)",
  "function verifierEpoch() view returns (uint256)",
  "function paused() view returns (bool)",
  "function approvedSourceAdapters(address) view returns (bool)",
  "function signerConfigs(address signer) view returns (bytes32 role,bool approved)",
  "function forbiddenRoles(bytes32 role) view returns (bool)",
  "function verifyCompletionProof(bytes32 proofHash,bytes[] signatures) external returns (bool)",
  "function isProofConsumed(bytes32 proofHash) view returns (bool)",
  "function setSourceAdapter(address sourceAdapter,bool approved) external",
  "function setSigner(address signer,bytes32 role,bool approved) external",
  "function setForbiddenRole(bytes32 role,bool forbidden) external",
  "function setThreshold(uint256 threshold) external",
  "function advanceVerifierEpoch() external returns (uint256 newEpoch)",
  "function pause() external",
  "function unpause() external",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event SourceAdapterSet(address indexed sourceAdapter,bool approved)",
  "event SignerSet(address indexed signer,bytes32 indexed role,bool approved)",
  "event ForbiddenRoleSet(bytes32 indexed role,bool forbidden)",
  "event ThresholdSet(uint256 threshold)",
  "event VerifierEpochAdvanced(uint256 indexed previousEpoch,uint256 indexed newEpoch)",
  "event CompletionProofVerified(bytes32 indexed proofHash,address indexed sourceAdapter,uint256 indexed verifierEpoch,uint256 signerCount)"
])

export const parlyRelayOutboundProviderV2Abi = parseAbi([
  "function adapter() view returns (address)",
  "function adapterLocked() view returns (bool)",
  "function executionEnabled() view returns (bool)",
  "function submissionNonce() view returns (uint256)",
  "function RELAY_EXECUTION_SELECTOR() view returns (bytes4)",
  "function approvedRelayRoutes(address target,bytes4 selector) view returns (bool)",
  "function consumedIntentHashes(bytes32 intentHash) view returns (bool)",
  "function consumedRequestHashes(bytes32 requestIdHash) view returns (bool)",
  "function pause() external",
  "function unpause() external",
  "function setAdapter(address adapter) external",
  "function setExecutionEnabled(bool enabled) external",
  "function setRelayTarget(address target,bytes4 selector,bool approved) external",
  "function submitOutboundPayout(bytes32 intentHash,address token,uint256 amountOut,uint256 providerFee,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 requestIdHash,bytes providerData) external returns (bytes32 providerSubmissionId)",
  "event AdapterSet(address indexed adapter)",
  "event ExecutionEnabledSet(bool enabled)",
  "event RelayTargetSet(address indexed target,bytes4 indexed selector,bool approved)",
  "event RelayOutboundSubmitted(bytes32 indexed providerSubmissionId,bytes32 indexed intentHash,bytes32 indexed requestIdHash,address relayTarget,bytes32 relayRequestId,address sourceToken,uint256 sourceAmount,uint256 amountOut,uint256 providerFee,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,uint256 deadline,bytes32 boundCalldataHash)",
  "event Paused(address account)",
  "event Unpaused(address account)"
])

export const parlyRelayDepositAddressTargetAbi = parseAbi([
  "function provider() view returns (address)",
  "function approvedSourceTokens(address token) view returns (bool)",
  "function approvedDestinationRoutes(uint256 destinationChainId,address destinationToken) view returns (bool)",
  "function pause() external",
  "function unpause() external",
  "function setSourceToken(address token,bool approved) external",
  "function setDestinationRoute(uint256 destinationChainId,address destinationToken,bool approved) external",
  "function executeRelay((bytes32 intentHash,address sourceToken,uint256 sourceAmount,uint256 amountOut,uint256 providerFee,uint256 destinationChainId,address destinationToken,address destinationRecipient,bytes32 requestIdHash,uint256 deadline) execution,bytes targetData) external returns (bytes32 relayRequestId)",
  "event SourceTokenSet(address indexed token,bool approved)",
  "event DestinationRouteSet(uint256 indexed destinationChainId,address indexed destinationToken,bool approved)",
  "event RelayDepositSubmitted(bytes32 indexed intentHash,bytes32 indexed relayRequestIdHash,address indexed depositAddress,address sourceToken,uint256 sourceAmount,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash)",
  "event Paused(address account)",
  "event Unpaused(address account)"
])

export const parlyPayoutEscrowAbi = parseAbi([
  "function adapter() view returns (address)",
  "function escrowSalt() view returns (bytes32)",
  "function released() view returns (bool)",
  "function refunded() view returns (bool)",
  "function releasePayout(address token,address provider,uint256 providerAmount,address operator,uint256 operatorFee) external"
])

export const parlyIngressReceiverAbi = parseAbi([
  "function pause() external",
  "function unpause() external",
  "function paused() view returns (bool)",
  "function setProvider(address provider,bool approved) external",
  "function setMaster(address master,bool approved) external",
  "function setToken(address token,bool approved) external",
  "function setPool(address pool,bool approved) external",
  "function setSettlementSigner(address signer) external",
  "function settlementSigner() view returns (address)",
  "function finalizedAttempts(bytes32) view returns (bool)",
  "function refundedAttempts(bytes32) view returns (bool)",
  "function pendingRefunds(address) view returns (uint256)",
  "function approvedProviders(address) view returns (bool)",
  "function approvedMasters(address) view returns (bool)",
  "function approvedTokens(address) view returns (bool)",
  "function approvedPools(address) view returns (bool)",
  "function registerConnectedWalletRefundBinding(bytes32 attemptId,bytes32 claimantCommitment) external",
  "function hasConnectedWalletRefundBinding(bytes32 attemptId) view returns (bool)",
  "function settleConnectedWallet((bytes32 attemptId,bytes32 authorizationNonce,address provider,address token,address pool,uint256 assetId,uint256 amountToShield,uint256 expectedAmount,uint256 innerCommitment,uint256 policySubjectField,uint8 routeType,uint8 paymentContext,uint8 refundClaimantBinding,bytes32 refundWalletCommitment,bytes32 routeHash,uint256 expiresAt,bytes32 envelopeHash) settlement,bytes envelope,bytes signature) external returns (bytes32 finalCommitment,uint32 leafIndex)",
  "function makeRefundAvailable(bytes32 attemptId,bytes32 claimId,address token,uint256 amount,uint8 reason) external",
  "function claimRefund(bytes32 claimId,address claimant,bytes32 salt) external",
  "function rescueExcess(address token,uint256 amount,address to) external",
  "event ProviderSet(address indexed provider,bool approved)",
  "event MasterSet(address indexed master,bool approved)",
  "event TokenSet(address indexed token,bool approved)",
  "event PoolSet(address indexed pool,bool approved)",
  "event SettlementSignerSet(address indexed signer)",
  "event ConnectedWalletRefundBindingRegistered(bytes32 indexed attemptId)",
  "event IngressReceived(bytes32 indexed attemptId,address indexed token,uint256 amount,uint8 routeType)",
  "event IngressShielded(bytes32 indexed attemptId,bytes32 indexed commitment,address indexed pool,uint256 amount)",
  "event RefundAvailable(bytes32 indexed claimId,address indexed token,uint256 amount,uint8 reason)",
  "event RefundClaimed(bytes32 indexed claimId,address indexed token,uint256 amount)",
  "event AttemptCancelled(bytes32 indexed attemptId,uint8 reason)"
])

export const parlyVirtualDepositMasterAbi = parseAbi([
  "function pause() external",
  "function unpause() external",
  "function paused() view returns (bool)",
  "function matchStatus(bytes32) view returns (uint8)",
  "function registryConfigured() view returns (bool)",
  "function officialVirtualAddressRegistry() view returns (address)",
  "function virtualMasterId() view returns (bytes32)",
  "function registeredVirtualMasterId() view returns (bytes4)",
  "function protocolTreasury() view returns (address)",
  "function operatorRegistry() view returns (address)",
  "function settlementSigner() view returns (address)",
  "function attemptSigner() view returns (address)",
  "function observationSigner() view returns (address)",
  "function approvedTokens(address) view returns (bool)",
  "function pendingFinalizations(address) view returns (uint256)",
  "function pendingRefunds(address) view returns (uint256)",
  "function manualReviewBalances(address) view returns (uint256)",
  "function quarantinedBalances(address) view returns (uint256)",
  "function custodyBalancesByClass(address,uint8) view returns (uint256)",
  "function attemptCustodyBalances(bytes32,address,uint8) view returns (uint256)",
  "function attempts(bytes32) view returns (address token,address pool,uint256 assetId,uint256 expectedAmount,uint256 observedAmount,uint256 expiresAt,bytes32 refundWalletCommitment,uint8 paymentContext,uint8 refundClaimantBinding,uint8 status)",
  "function attemptUserTagHash(bytes32) view returns (bytes32)",
  "function attemptByUserTagHash(bytes32) view returns (bytes32)",
  "function attemptObservationId(bytes32) view returns (bytes32)",
  "function attemptObservationVirtualAddress(bytes32) view returns (address)",
  "function attemptObservationTxHash(bytes32) view returns (bytes32)",
  "function attemptObservationLogIndexA(bytes32) view returns (uint256)",
  "function attemptObservationLogIndexB(bytes32) view returns (uint256)",
  "function attemptObservationBlockNumber(bytes32) view returns (uint256)",
  "function attemptObservationRouteHash(bytes32) view returns (bytes32)",
  "function consumedObservationPairs(bytes32) view returns (bool)",
  "function consumedObservationIds(bytes32) view returns (bool)",
  "function protocolRescues(bytes32) view returns (bytes32 attributionId,address token,uint256 amount,uint256 availableAt,uint8 reasonCode,bool executed)",
  "function finalizedAttempts(bytes32) view returns (bool)",
  "function accountedBalance(address) view returns (uint256)",
  "function setOfficialVirtualAddressRegistry(address registry) external",
  "function registerVirtualMaster(bytes32 registrationInput) external",
  "function setToken(address token,bool approved) external",
  "function setSettlementSigner(address signer) external",
  "function setAttemptSigner(address signer) external",
  "function setObservationSigner(address signer) external",
  "function registerAttempt(bytes32 attemptId,bytes32 userTagHash,address token,address pool,uint256 assetId,uint256 expectedAmount,uint256 expiresAt,bytes32 refundWalletCommitment,uint8 paymentContext,uint8 refundClaimantBinding) external",
  "function hashAttemptAuthorization((uint256 chainId,uint256 settlementDomainId,bytes32 environment,address verifyingContract,bytes32 attemptId,bytes32 authorizationNonce,bytes32 userTagHash,bytes32 routeHash,address token,address pool,uint256 assetId,uint256 expectedAmount,uint256 expiresAt,bytes32 refundWalletCommitment,uint8 paymentContext,uint8 refundClaimantBinding,bytes32 statusAccessTokenHash) authorization) view returns (bytes32)",
  "function registerAttemptWithAuthorization((uint256 chainId,uint256 settlementDomainId,bytes32 environment,address verifyingContract,bytes32 attemptId,bytes32 authorizationNonce,bytes32 userTagHash,bytes32 routeHash,address token,address pool,uint256 assetId,uint256 expectedAmount,uint256 expiresAt,bytes32 refundWalletCommitment,uint8 paymentContext,uint8 refundClaimantBinding,bytes32 statusAccessTokenHash) authorization,bytes signature) external",
  "function hashObservationAttestation((uint256 chainId,uint256 settlementDomainId,bytes32 environment,address verifyingContract,bytes32 attemptId,bytes32 observationId,address token,uint256 amount,address virtualAddress,bytes32 txHash,uint256 logIndexA,uint256 logIndexB,uint256 observedBlockNumber,bytes32 routeHash,bytes32 userTagHash,uint256 expiresAt,bytes32 nonce) attestation) view returns (bytes32)",
  "function recordDepositObservationWithAttestation(bytes32 attemptId,(address token,address virtualAddress,address masterAddress,uint256 amount,bytes32 observationId,bytes32 txHash,uint256 logIndexA,uint256 logIndexB,uint256 observedBlockNumber,bytes32 routeHash,bytes32 userTagHash) observation,(uint256 chainId,uint256 settlementDomainId,bytes32 environment,address verifyingContract,bytes32 attemptId,bytes32 observationId,address token,uint256 amount,address virtualAddress,bytes32 txHash,uint256 logIndexA,uint256 logIndexB,uint256 observedBlockNumber,bytes32 routeHash,bytes32 userTagHash,uint256 expiresAt,bytes32 nonce) attestation,bytes signature) external",
  "function recordDepositObservation(bytes32 attemptId,(address token,address virtualAddress,address masterAddress,uint256 amount,bytes32 observationId,bytes32 txHash,uint256 logIndexA,uint256 logIndexB,uint256 observedBlockNumber,bytes32 routeHash,bytes32 userTagHash) observation) external",
  "function makeRefundAvailable(bytes32 attemptId,bytes32 claimId,uint256 amount,uint8 reason) external",
  "function finalizeVirtualDeposit((uint256 chainId,uint256 settlementDomainId,bytes32 environment,address verifyingContract,bytes32 attemptId,bytes32 authorizationNonce,bytes32 depositObservationId,uint8 routeType,uint8 paymentMethod,uint256 assetId,address token,address pool,address receiver,bytes32 virtualMasterId,bytes32 userTagHash,address virtualAddress,uint256 expectedAmount,uint256 observedAmount,uint256 payerTotal,uint256 settlementFee,uint256 finalizerFee,uint256 amountToShield,address feeRecipient,uint256 maxFinalizerFee,address beneficiaryPolicySubject,bytes32 refundWalletCommitment,bytes32 depositTxHash,uint256 depositLogIndexA,uint256 depositLogIndexB,uint256 depositBlockNumber,bytes32 relayRequestIdHash,bytes32 routeHash,bytes32 statusAccessTokenHash,uint256 expiresAt,uint256 innerCommitment,bytes32 envelopeHash) authorization,bytes envelope,bytes signature) external",
  "function makeQuarantineRefundAvailable(bytes32 attemptId,address token,bytes32 claimId,uint256 amount,uint8 reason) external",
  "function classifyInvalidUnrecoverable(bytes32 attributionId,address token,uint256 amount,uint8 reasonCode) external",
  "function scheduleProtocolRescue(bytes32 rescueId,bytes32 attributionId,address token,uint256 amount,uint8 sourceClass,uint8 reasonCode) external",
  "function executeProtocolRescue(bytes32 rescueId) external",
  "function claimRefund(bytes32 claimId,address claimant,bytes32 salt) external",
  "event TokenSet(address indexed token,bool approved)",
  "event SettlementSignerSet(address indexed signer)",
  "event AttemptSignerSet(address indexed signer)",
  "event ObservationSignerSet(address indexed signer)",
  "event VirtualAddressRegistrySet(address indexed registry)",
  "event VirtualMasterRegistered(bytes4 indexed masterId,bytes32 registrationInput,bytes32 virtualMasterId)",
  "event AttemptRegistered(bytes32 indexed attemptId,address indexed token,uint256 expectedAmount)",
  "event AttemptTagReserved(bytes32 indexed attemptId,bytes32 indexed userTagHash)",
  "event DepositClassified(bytes32 indexed attemptId,address indexed token,uint256 amount,uint8 status)",
  "event VirtualDepositFinalized(bytes32 indexed attemptId,address indexed token,uint256 amountToShield,uint256 finalizerFee,bytes32 indexed receiptId)",
  "event RefundMadeAvailable(bytes32 indexed claimId,address indexed token,uint256 amount,uint8 reason)",
  "event RefundClaimed(bytes32 indexed claimId,address indexed token,uint256 amount)",
  "event FinalizerFeePaid(bytes32 indexed attemptId,address indexed token,uint256 amount)",
  "event CustodyClassified(bytes32 indexed attemptId,address indexed token,uint256 amount,uint8 custodyClass,uint8 reasonCode)",
  "event ProtocolRescueScheduled(bytes32 indexed rescueId,address indexed token,uint256 amount,uint256 availableAt,uint8 reasonCode)",
  "event ProtocolRescueExecuted(bytes32 indexed rescueId,address indexed token,uint256 amount,address indexed treasury,uint8 reasonCode)"
])

export const parlyVirtualDepositMasterV2Abi = parlyVirtualDepositMasterAbi

export type DepositV2Event = {
  commitment: `0x${string}`
  amount: bigint
  leafIndex: number
  assetId: bigint
  kind: number
}

export type IngressReceivedEvent = {
  attemptId: `0x${string}`
  token: `0x${string}`
  amount: bigint
  routeType: number
}

export type IngressShieldedEvent = {
  attemptId: `0x${string}`
  commitment: `0x${string}`
  pool: `0x${string}`
  amount: bigint
}

export type RefundAvailableEvent = {
  claimId: `0x${string}`
  token: `0x${string}`
  amount: bigint
  reason: number
}

export type RefundClaimedEvent = {
  claimId: `0x${string}`
  token: `0x${string}`
  amount: bigint
}

export type SettlementFinalizerPaidEvent = {
  attemptId: `0x${string}`
  token: `0x${string}`
  amount: bigint
}

export const SPOKE_GATEWAY_ABI = parseAbi([
  "function quoteShieldFee(uint256,uint256,address,bytes) view returns (uint256,bool)",
  "function shieldCrossChain(uint256,uint256,bytes) payable",
  "function underlyingToken() view returns (address)",
  "function lzFeeToken() view returns (address)",
  "function previewExecutionOptions() view returns (bytes)",
  "event ShieldedCrossChain(address indexed sender, uint16 indexed assetId, bytes32 indexed guid, uint256 amount, uint256 innerCommitment)"
])

export const ERC20_ABI = parseAbi([
  "function approve(address,uint256) external returns (bool)",
  "function allowance(address,address) external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)"
])

export const TREASURY_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function threshold() view returns (uint256)",
  "function getTransactionCount() view returns (uint256)",
  "function pendingTransactionCount() view returns (uint256)",
  "function transactions(uint256) view returns (address target, uint256 value, bytes data, bool executed, bool cancelled, uint256 numConfirmations)",
  "function isConfirmed(uint256,address) view returns (bool)",
  "function submitTransaction(address,uint256,bytes) external",
  "function confirmTransaction(uint256) external",
  "function revokeConfirmation(uint256) external",
  "function executeTransaction(uint256) external",
  "function cancelTransaction(uint256) external",
  "function addSigner(address) external",
  "function removeSigner(address) external",
  "function replaceSigner(address,address) external",
  "function sweepRevenue(address,address,uint256) external"
])
