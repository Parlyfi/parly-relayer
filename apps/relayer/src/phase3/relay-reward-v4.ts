import { costCoveringRelayReward } from "./relay-reward.js"

// Versioned upgrade candidate; active V3/V6 routes must not use these bounds.
export type RelayRewardPolicyV4 = Readonly<{
  singleSourceMaximum: bigint
  batchSourceMaximum: bigint
  childMaximum: bigint
  childQuote: bigint
}>

export type RelayChildGasV4 = Readonly<{
  acceptance: bigint
  confirmation: bigint
  submission: bigint
  completion: bigint
}>

function validatePolicy(policy: RelayRewardPolicyV4) {
  for (const [value, maximum] of [
    [policy.singleSourceMaximum, 5000n],
    [policy.batchSourceMaximum, 10000n],
    [policy.childMaximum, 20000n],
    [policy.childQuote, 20000n]
  ] as const) {
    if (typeof value !== "bigint" || value < 0n || value > maximum) {
      throw new Error("Relay reward exceeds the immutable maximum.")
    }
  }
  if (policy.childQuote > policy.childMaximum) throw new Error("Relay reward exceeds the configured ceiling.")
}

export function quoteSourceRewardV4(
  gasUnits: bigint,
  gasPrice: bigint,
  recipientCount: number,
  policy: RelayRewardPolicyV4
) {
  validatePolicy(policy)
  if (!Number.isInteger(recipientCount) || recipientCount < 1 || recipientCount > 10) {
    throw new Error("Relay recipient count is invalid.")
  }
  const reward = costCoveringRelayReward(gasUnits, gasPrice)
  const maximum = recipientCount === 1 ? policy.singleSourceMaximum : policy.batchSourceMaximum
  if (reward > maximum) throw new Error("Relay source cost exceeds the configured ceiling.")
  return reward
}

export function quoteCrossChainRewardsV4(
  sourceGasUnits: bigint,
  gasPrice: bigint,
  children: readonly RelayChildGasV4[],
  policy: RelayRewardPolicyV4
) {
  const sourceReward = quoteSourceRewardV4(sourceGasUnits, gasPrice, children.length, policy)
  const count = BigInt(children.length)
  const childrenQuotes = children.map((gas, index) => {
    const sourceAllocation = sourceReward / count + (BigInt(index) < sourceReward % count ? 1n : 0n)
    const submissionReimbursement = costCoveringRelayReward(gas.acceptance, gasPrice)
      + costCoveringRelayReward(gas.confirmation, gasPrice)
      + costCoveringRelayReward(gas.submission, gasPrice)
    const minimumDelivery = costCoveringRelayReward(gas.completion, gasPrice)
    if (sourceAllocation + submissionReimbursement + minimumDelivery > policy.childQuote) {
      throw new Error("The quoted relay reward cannot cover this payout's network cost.")
    }
    return {
      sourceExecutorFeeAllocation: sourceAllocation,
      sourceGroupReward: sourceReward,
      sourceRecipientCount: count,
      sourceRecipientIndex: BigInt(index),
      submissionReimbursement,
      deliverySuccessFee: policy.childQuote - sourceAllocation - submissionReimbursement,
      maxOperatorFee: policy.childMaximum,
      totalReward: policy.childQuote
    }
  })
  return { sourceReward, children: childrenQuotes }
}
