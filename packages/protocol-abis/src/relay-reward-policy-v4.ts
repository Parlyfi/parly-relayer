import { encodeFunctionData, isAddress, keccak256, parseAbi, type Address, type Hex } from "viem"

export const relayRewardPolicyV4Abi = parseAbi([
  "function owner() view returns (address)",
  "function MAX_SINGLE_SOURCE_REWARD() view returns (uint256)",
  "function MAX_BATCH_SOURCE_REWARD() view returns (uint256)",
  "function MAX_CROSS_CHAIN_CHILD_REWARD() view returns (uint256)",
  "function singleSourceMaximum() view returns (uint64)",
  "function batchSourceMaximum() view returns (uint64)",
  "function childMaximum() view returns (uint64)",
  "function childQuote() view returns (uint64)",
  "function revision() view returns (uint64)",
  "function setLimits(uint64 single_,uint64 batch_,uint64 child_,uint64 quote_) external"
])

export type RelayRewardPolicyV4 = Readonly<{
  singleSourceMaximum: bigint
  batchSourceMaximum: bigint
  childMaximum: bigint
  childQuote: bigint
}>
export type RelayRewardPolicyTargetV4 = Readonly<{ chainId: number; address: Address; codeHash: Hex }>
export type RelayRewardPolicySnapshotV4 = RelayRewardPolicyV4 & RelayRewardPolicyTargetV4 & Readonly<{
  owner: Address; revision: bigint; blockNumber: bigint; blockHash: Hex
}>

export function validateRelayRewardPolicyV4(policy: RelayRewardPolicyV4) {
  for (const [value, maximum] of [
    [policy.singleSourceMaximum, 5000n], [policy.batchSourceMaximum, 10000n],
    [policy.childMaximum, 20000n], [policy.childQuote, 20000n]
  ] as const) {
    if (typeof value !== "bigint" || value < 0n || value > maximum) throw new Error("Relay reward exceeds the immutable maximum.")
  }
  if (policy.childQuote > policy.childMaximum) throw new Error("Relay reward exceeds the configured ceiling.")
}

function validateTarget(target: RelayRewardPolicyTargetV4) {
  if (!Number.isSafeInteger(target.chainId) || target.chainId <= 0
    || !isAddress(target.address) || BigInt(target.address) === 0n
    || !/^0x[0-9a-fA-F]{64}$/.test(target.codeHash) || BigInt(target.codeHash) === 0n) {
    throw new Error("V4 relay reward policy requires an explicit chain, address and code-hash pin.")
  }
}

export function relayRewardPolicyTargetV4(
  env: Record<string, string | undefined>, chainId: number, prefix: "" | "NEXT_PUBLIC_" = ""
): RelayRewardPolicyTargetV4 {
  const target = { chainId, address: env[`${prefix}RELAY_REWARD_POLICY_V4_ADDRESS`] as Address,
    codeHash: env[`${prefix}RELAY_REWARD_POLICY_V4_CODE_HASH`] as Hex }
  validateTarget(target)
  return target
}

export type RelayRewardPolicyClientV4 = {
  getChainId(): Promise<number>
  getBlock(args: { blockTag: "latest" } | { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null }>
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
  readContract(args: { address: Address; abi: typeof relayRewardPolicyV4Abi; functionName: Exclude<(typeof relayRewardPolicyV4Abi)[number]["name"], "setLimits">; blockNumber: bigint }): Promise<unknown>
}

export async function readRelayRewardPolicyV4(
  client: RelayRewardPolicyClientV4, target: RelayRewardPolicyTargetV4
): Promise<RelayRewardPolicySnapshotV4> {
  validateTarget(target)
  if (await client.getChainId() !== target.chainId) throw new Error("V4 relay reward policy chain mismatch.")
  const block = await client.getBlock({ blockTag: "latest" })
  if (typeof block.number !== "bigint" || block.number < 0n || !block.hash || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    throw new Error("V4 relay reward policy block is unavailable.")
  }
  const blockNumber = block.number, code = await client.getCode({ address: target.address, blockNumber })
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== target.codeHash.toLowerCase()) {
    throw new Error("V4 relay reward policy bytecode does not match the configured pin.")
  }
  const getters = ["singleSourceMaximum", "batchSourceMaximum", "childMaximum", "childQuote", "revision", "owner",
    "MAX_SINGLE_SOURCE_REWARD", "MAX_BATCH_SOURCE_REWARD", "MAX_CROSS_CHAIN_CHILD_REWARD"] as const
  const values = await Promise.all(getters.map(functionName => client.readContract({ address: target.address, abi: relayRewardPolicyV4Abi, functionName, blockNumber })))
  const [singleSourceMaximum, batchSourceMaximum, childMaximum, childQuote, revision, owner, single, batch, child] = values as [bigint, bigint, bigint, bigint, bigint, Address, bigint, bigint, bigint]
  const policy = { singleSourceMaximum, batchSourceMaximum, childMaximum, childQuote }
  validateRelayRewardPolicyV4(policy)
  if (single !== 5000n || batch !== 10000n || child !== 20000n || typeof revision !== "bigint" || revision < 1n || revision >= 1n << 64n
    || !isAddress(owner) || BigInt(owner) === 0n) throw new Error("V4 relay reward policy getters are invalid.")
  // A canonical recheck prevents mixing state across a same-height reorganization.
  const canonical = await client.getBlock({ blockNumber })
  if (canonical.number !== blockNumber || canonical.hash?.toLowerCase() !== block.hash.toLowerCase()
    || await client.getChainId() !== target.chainId) throw new Error("V4 relay reward policy block changed during the read.")
  return { ...target, ...policy, owner, revision, blockNumber, blockHash: block.hash }
}

export function encodeRelayRewardPolicyUpdateV4(policy: RelayRewardPolicyV4): Hex {
  validateRelayRewardPolicyV4(policy)
  return encodeFunctionData({ abi: relayRewardPolicyV4Abi, functionName: "setLimits",
    args: [policy.singleSourceMaximum, policy.batchSourceMaximum, policy.childMaximum, policy.childQuote] })
}
