export function looksLikeBase64(value: string) {
  return /^[A-Za-z0-9+/=]+$/.test(value)
}

export function buildRelayerHeartbeatMessage(
  executionAddress: `0x${string}`,
  event: "SUCCESS",
  timestamp: number
) {
  return [
    "Parly Relayer Heartbeat",
    `Execution Address: ${executionAddress}`,
    `Event: ${event}`,
    `Timestamp: ${timestamp}`,
    "Domain: parly.fi"
  ].join("\n")
}

export function buildIndexedMerklePath(args: {
  levels: number
  leaves: Array<{ index: number; value: bigint }>
  leafIndex: number
  zeros: bigint[]
  hash: (left: bigint, right: bigint) => bigint
}) {
  if (!Number.isInteger(args.levels) || args.levels < 1 || args.levels > 52) {
    throw new Error("Merkle tree levels must be an integer between 1 and 52.")
  }
  if (args.zeros.length < args.levels) {
    throw new Error("Merkle zero table is incomplete.")
  }
  if (!Number.isInteger(args.leafIndex) || args.leafIndex < 0) {
    throw new Error("Merkle leaf index must be a non-negative integer.")
  }

  const capacity = 2 ** args.levels
  if (args.leafIndex >= capacity) {
    throw new Error("Merkle leaf index exceeds tree capacity.")
  }

  let layer = new Map<number, bigint>()
  for (const leaf of args.leaves) {
    if (!Number.isInteger(leaf.index) || leaf.index < 0 || leaf.index >= capacity) {
      throw new Error("Merkle leaf set contains an invalid index.")
    }
    if (layer.has(leaf.index)) {
      throw new Error("Merkle leaf set contains a duplicate index.")
    }
    layer.set(leaf.index, leaf.value)
  }

  if (!layer.has(args.leafIndex)) {
    throw new Error("Selected note is missing from the current Merkle tree.")
  }

  const pathElements: bigint[] = []
  const pathIndices: number[] = []
  let currentIndex = args.leafIndex

  for (let level = 0; level < args.levels; level += 1) {
    const siblingIndex = currentIndex ^ 1
    pathElements.push(layer.get(siblingIndex) ?? args.zeros[level]!)
    pathIndices.push(currentIndex & 1)

    const parentIndexes = new Set<number>()
    for (const index of layer.keys()) {
      parentIndexes.add(Math.floor(index / 2))
    }

    const nextLayer = new Map<number, bigint>()
    for (const parentIndex of parentIndexes) {
      const left = layer.get(parentIndex * 2) ?? args.zeros[level]!
      const right = layer.get(parentIndex * 2 + 1) ?? args.zeros[level]!
      nextLayer.set(parentIndex, args.hash(left, right))
    }

    layer = nextLayer
    currentIndex = Math.floor(currentIndex / 2)
  }

  const root = layer.get(0)
  if (root === undefined) {
    throw new Error("Merkle root could not be reconstructed.")
  }

  return { root, pathElements, pathIndices }
}
