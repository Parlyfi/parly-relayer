import { parseAbi } from "viem"
import { parlyPayoutAdapterV6Abi, parlyPayoutWithdrawalExecutorV2Abi } from "@parly/protocol-abis"

const intent = "(bytes32 environment,uint256 chainId,uint256 settlementDomainId,address adapter,bytes32 escrowSalt,address escrow,address sourcePool,address sourceExecutor,bytes32 sourceCallHash,uint256 sourceExecutorFeeAllocation,uint256 sourceGroupReward,uint256 sourceRecipientCount,uint256 sourceRecipientIndex,address token,uint256 assetId,uint256 amountIn,uint256 sourceAmountOut,uint256 destinationAmountOut,uint256 providerSourceAmount,uint256 submissionReimbursement,uint256 deliverySuccessFee,uint256 maxOperatorFee,address providerContract,uint256 destinationChainId,address destinationToken,bytes32 destinationRecipientHash,bytes32 refundRecipientCommitment,address primaryRefundToken,address secondaryRefundToken,bytes32 providerDataHash,bytes32 requestIdHash,bytes32 refundRouteBindingHash,bytes32 nonce,uint256 quoteExpiry,uint256 preSubmissionRecoveryDelay,uint256 maxCompletionDelay,address registrationOperator,uint256 registrationReimbursement)" as const

// V7 preserves the predecessor record layout; signed intents and fee settlement are versioned here.
export const parlyPayoutAdapterV7Abi = [
  ...parlyPayoutAdapterV6Abi.filter((entry) => !(entry.type === "function" && (entry.name === "acceptQuote" || entry.name === "hashPayoutIntent"))),
  ...parseAbi([
    `function hashPayoutIntent(${intent} intent) view returns (bytes32)`,
    `function acceptQuote(${intent} intent,bytes signature) external`,
    "function rewardPolicy() view returns (address)",
    "function registrationFees(bytes32 intentHash) view returns (address operator,uint64 amount,bool paid)",
    "function payRegistrationReimbursement(bytes32 intentHash) external",
    "event RegistrationReimbursed(bytes32 indexed intentHash,address indexed operator,uint256 amount)",
    "function sourceFeeGroupOfIntent(bytes32 intentHash) view returns (bytes32)",
    "function sourceRecipientIndexOfIntent(bytes32 intentHash) view returns (uint256)",
    "function sourceFeeGroups(bytes32 group) view returns (uint256 reward,uint256 recipientCount,uint256 acceptedMask)"
  ])
] as const

export const parlyPayoutWithdrawalExecutorV3Abi = [
  ...parlyPayoutWithdrawalExecutorV2Abi,
  ...parseAbi([
    "function poolCodeHashes(address pool) view returns (bytes32)",
    "function poolTokens(address pool) view returns (address)",
    "function setPoolV4(address pool,address token,bytes32 codeHash,bool approved) external"
  ])
] as const

export const payoutPoolV4Abi = parseAbi([
  "function circuitVersion() view returns (uint8)",
  "function underlyingToken() view returns (address)",
  "function settlementDomain() view returns (uint256)",
  "function assetId() view returns (uint256)",
  "function globalFeeBps() view returns (uint256)",
  "function spend(bytes proof,uint256[60] signals,bytes changeEnvelope) external",
  "event Spent(uint256[60] signals,bytes changeEnvelope)"
])

export const parlyRelayTransactionTargetV7Abi = parseAbi([
  "function approvedSourceTokens(address token) view returns (bool)",
  "function approvedDestinationRoutes(uint256 chainId,address token) view returns (bool)",
  "function relayDepositoryCodeHashes(address depository) view returns (bytes32)",
  "function setRelayDepository(address depository,bytes32 codeHash) external"
])
