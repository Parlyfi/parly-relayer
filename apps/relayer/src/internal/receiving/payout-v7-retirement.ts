import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem"
import { parlyPayoutAdapterV7Abi, payoutPoolV4Abi } from "@parly/protocol-abis/payout-v7"
import type { ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"

type Manifest = { chainId: number; adapter: Address; withdrawalExecutor: Address; sourcePool: Address; sourceToken: Address; inputCount: number; quoteExpiresAt: number; sourceCallHash: Hex; children: { intentHash: Hex; intent: { escrow: Address; amountIn: bigint; quoteExpiry: bigint } }[] }
export type PayoutV7RetirementProof = { sourceCallHash: Hex; pool: Address; nullifiers: Hex[]; blockNumber: string; blockHash: Hex; blockTimestamp: string; leaseExpiry: string | null }
const stateAbi = parseAbi(["function nullifiers(uint256) view returns(bool)", "function balanceOf(address) view returns(uint256)"])
function check(ok: unknown): asserts ok { if (!ok) throw Error("V7 expired-unfunded retirement is not positively verified.") }

// Missing pool calldata is allowed only for the browser marker; worker lock release requires exact nullifiers.
export async function readPayoutV7RetirementProof(args: {
  client: { getChainId(): Promise<number>; getBlock(args: any): Promise<any>; getCode(args: any): Promise<Hex | undefined>; readContract(args: any): Promise<any> }
  profile: ReceivingProfileV4; pins: { address: Address; codeHash: Hex }[]; manifest: Manifest; poolCall?: Hex; leaseExpiry?: bigint; blockNumber?: bigint; blockHash?: Hex
}): Promise<PayoutV7RetirementProof> {
  const { client, profile, manifest: m } = args
  check(m.chainId === profile.chainId && profile.assets.some(a => getAddress(a.pool) === getAddress(m.sourcePool) && getAddress(a.token) === getAddress(m.sourceToken)))
  check(await client.getChainId() === m.chainId)
  const finalized = await client.getBlock({ blockTag: "finalized" })
  const block = args.blockNumber === undefined ? finalized : await client.getBlock({ blockNumber: args.blockNumber })
  check(typeof finalized.number === "bigint" && block.number <= finalized.number)
  if (args.blockHash !== undefined) check(block.hash === args.blockHash)
  check(typeof block.number === "bigint" && /^0x[a-fA-F0-9]{64}$/.test(block.hash) && typeof block.timestamp === "bigint" && block.timestamp > BigInt(m.quoteExpiresAt) && m.children.every(c => block.timestamp > c.intent.quoteExpiry))
  if (args.leaseExpiry !== undefined) check(args.leaseExpiry <= BigInt(m.quoteExpiresAt) - 300n && args.leaseExpiry < block.timestamp)
  for (const pin of [...profile.codePins, ...args.pins]) check(keccak256(await client.getCode({ address: pin.address, blockNumber: block.number }) ?? "0x") === pin.codeHash)
  const nullifiers: Hex[] = []
  if (args.poolCall !== undefined) {
    check(keccak256(args.poolCall) === m.sourceCallHash)
    const decoded = decodeFunctionData({ abi: payoutPoolV4Abi, data: args.poolCall }); check(decoded.functionName === "spend")
    check(encodeFunctionData({ abi: payoutPoolV4Abi, functionName: "spend", args: decoded.args }) === args.poolCall)
    const s = decoded.args[1]
    check(m.inputCount >= 1 && m.inputCount <= 4 && s[10] === BigInt(m.chainId) && s[11] === BigInt(m.sourcePool) && s[13] === profile.settlementDomain && s[19] === BigInt(m.inputCount) && s[52] === BigInt(m.withdrawalExecutor) && s[53] === 0n)
    check(s.slice(15, 15 + m.inputCount).every(n => n > 0n) && s.slice(15 + m.inputCount, 19).every(n => n === 0n))
    for (let i = 0; i < 10; i++) check(s[20 + i] === (m.children[i]?.intent.amountIn ?? 0n) && s[30 + i] === (m.children[i] ? BigInt(m.children[i]!.intent.escrow) : 0n))
    for (const nf of s.slice(15, 15 + m.inputCount)) {
      check(await client.readContract({ address: m.sourcePool, abi: stateAbi, functionName: "nullifiers", args: [nf], blockNumber: block.number }) === false)
      nullifiers.push(`0x${nf.toString(16).padStart(64, "0")}`)
    }
    check(new Set(nullifiers).size === m.inputCount)
  }
  for (const child of m.children) {
    const read = (functionName: string) => client.readContract({ address: m.adapter, abi: parlyPayoutAdapterV7Abi, functionName, args: [child.intentHash], blockNumber: block.number })
    const [status, record, recovery, balance] = await Promise.all([read("status"), read("getPayoutRecord"), read("recoveryAvailableAt"), client.readContract({ address: m.sourceToken, abi: stateAbi, functionName: "balanceOf", args: [child.intent.escrow], blockNumber: block.number })])
    check([0, 1].includes(Number(status)) && BigInt(record.escrowFundedAt) === 0n && BigInt(recovery) === 0n && typeof balance === "bigint" && balance >= 0n)
    // Outsider dust cannot invalidate the exact proof that every original source nullifier is still live.
    if (args.poolCall === undefined) check(balance === 0n)
    if (Number(status) === 1) check(getAddress(record.sourcePool) === getAddress(m.sourcePool) && getAddress(record.sourceExecutor) === getAddress(m.withdrawalExecutor) && record.sourceCallHash === m.sourceCallHash && BigInt(record.quoteExpiry) === child.intent.quoteExpiry)
  }
  const canonical = await client.getBlock({ blockNumber: block.number })
  check(canonical.number === block.number && canonical.hash === block.hash && (await client.getBlock({ blockNumber: finalized.number })).hash === finalized.hash && await client.getChainId() === m.chainId)
  return { sourceCallHash: m.sourceCallHash, pool: m.sourcePool, nullifiers, blockNumber: String(block.number), blockHash: block.hash, blockTimestamp: String(block.timestamp), leaseExpiry: args.leaseExpiry === undefined ? null : String(args.leaseExpiry) }
}
