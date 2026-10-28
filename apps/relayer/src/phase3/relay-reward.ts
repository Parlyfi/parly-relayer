export function costCoveringRelayReward(gasUnits: bigint, gasPrice: bigint) {
  if (gasUnits <= 0n || gasPrice <= 0n) throw new Error("Relay gas cost must be positive.")
  // Tempo prices gas in attodollars; six-decimal rewards are microdollars.
  const divisor = 100n * 1_000_000_000_000n
  return (gasUnits * gasPrice * 110n + divisor - 1n) / divisor
}

export function requireCostCoveredRelayReward(reward: bigint, gasUnits: bigint, gasPrice: bigint) {
  if (reward < costCoveringRelayReward(gasUnits, gasPrice)) {
    throw new Error("The signed relay reward cannot cover this transaction's network cost. Request updated fees.")
  }
}
