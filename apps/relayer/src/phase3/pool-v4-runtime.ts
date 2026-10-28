import { createHash } from "node:crypto"
import { assertReceivingProfileV4, parseReceivingProfileV4, receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import type { CanonicalRelayExecutionPayloadV4 } from "@parly/shared-types"
import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, sha256, type Abi, type AbiParameter, type Address, type Hex } from "viem"
import { normalizeSignedRelayExecutionFeeScheduleV2, validateRelayExecutionFeeScheduleV2 } from "./relay-execution-fee-schedule-v2.js"
import { requireCostCoveredRelayReward } from "./relay-reward.js"

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const LIMIT = 1n << 128n
export const poolV4RuntimeAbi: Abi = parseAbi([
  "function spend(bytes,uint256[60],bytes)", "event Spent(uint256[60] signals,bytes changeEnvelope)",
  ...["underlyingToken", "receiver", "master", "registry", "verifier", "hasher", "spendVerifier"].map(n => `function ${n}() view returns(address)`),
  "function circuitVersion() view returns(uint8)", "function assetId() view returns(uint256)", "function settlementDomain() view returns(uint256)",
  "function knownRoots(uint256) view returns(bool)", "function nullifiers(uint256) view returns(bool)", "function globalFeeBps() view returns(uint256)"
])
const verifierAbi = parseAbi(["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[60]) view returns(bool)"])
const proofParameters = [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }] as const
function check(ok: unknown, reason: string): asserts ok { if (!ok) throw Error("PoolV4 " + reason) }
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
export function poolV4ProfileDigest(profile: ReceivingProfileV4) { return createHash("sha256").update(receivingProfileJsonV4(profile)).digest("hex") }
export function readPoolV4RuntimeConfig(env: Record<string, string | undefined>, chainId: number, relayer: Address) {
  if (env.PHASE3_POOL_V4_RELAYER_ENABLED !== "true") return { enabled: false as const }
  check(typeof env.PHASE3_RECEIVING_V4_PROFILE_JSON === "string", "profile unavailable.")
  const profile = parseReceivingProfileV4(env.PHASE3_RECEIVING_V4_PROFILE_JSON)
  check(profile.chainId === chainId && /^0x[a-fA-F0-9]{40}$/.test(relayer) && BigInt(relayer) !== 0n, "runtime domain mismatch.")
  return { enabled: true as const, config: { profile, relayer } }
}
export function poolV4ActiveNullifiers(payload: CanonicalRelayExecutionPayloadV4) { return payload.publicSignals.slice(15, 19).map(BigInt).filter(n => n !== 0n).map(n => `0x${n.toString(16).padStart(64, "0")}` as Hex) }
export function validatePoolV4ProofPayload(value: unknown, config: { profile: ReceivingProfileV4; relayer: Address }) {
  assertReceivingProfileV4(config.profile)
  check(value && typeof value === "object" && !Array.isArray(value), "payload malformed.")
  const p = value as CanonicalRelayExecutionPayloadV4
  check(Object.keys(p).sort().join(",") === "changeEnvelope,feeSchedule,poolVersion,profileDigest,proof,publicSignals,version" && p.version === 4 && p.poolVersion === 4 && p.profileDigest === poolV4ProfileDigest(config.profile), "payload version/profile mismatch.")
  check(/^0x[a-fA-F0-9]{512}$/.test(p.proof) && /^0x(?:[a-fA-F0-9]{2}){0,4096}$/.test(p.changeEnvelope), "proof or envelope malformed.")
  check(Array.isArray(p.publicSignals) && p.publicSignals.length === 60 && p.publicSignals.every(n => typeof n === "string" && /^(0|[1-9][0-9]{0,76})$/.test(n) && BigInt(n) < FIELD), "requires canonical Spend60 fields.")
  const s = p.publicSignals.map(BigInt), asset = config.profile.assets.find(a => BigInt(a.pool) === s[11] && BigInt(a.assetId) === s[12])
  check(asset && s[10] === BigInt(config.profile.chainId) && s[13] === config.profile.settlementDomain && s[52] === BigInt(config.relayer) && s[53]! <= 1n, "proof domain/executor/mode mismatch.")
  const nfs = poolV4ActiveNullifiers(p), count = Number(s[19])
  check(count > 0 && count <= 4 && count === nfs.length && new Set(nfs).size === count && s.slice(15, 15 + count).every(n => n > 0n) && s.slice(15 + count, 19).every(n => n === 0n), "nullifiers malformed.")
  let outputCount = 0, total = 0n
  for (let i = 0; i < 10; i++) {
    const amount = s[20 + i]!, recipient = s[30 + i]!
    check(amount < LIMIT && recipient < 1n << 160n && s[40 + i] === config.profile.settlementDomain, "output domain/range mismatch.")
    check(amount === 0n ? recipient === 0n && s[i] === 0n : recipient > 0n && s[i]! > 0n, "output tuple mismatch.")
    if (amount > 0n) { outputCount++; total += amount }
  }
  check(total < LIMIT && s[50]! < LIMIT && s[51]! > 0n && s[51]! <= (outputCount === 1 ? 5000n : 10000n), "reward exceeds immutable cap.")
  check(s[53] === 1n ? count >= 2 && outputCount === 0 && s[57]! > 0n : outputCount > 0, "consolidation mismatch.")
  check(s[57] === 0n ? p.changeEnvelope === "0x" && s[58] === 0n && s[59] === 0n : /^0x505204/.test(p.changeEnvelope) && p.changeEnvelope.length >= 136 && BigInt("0x" + p.changeEnvelope.slice(8, 72)) === s[58] && BigInt("0x" + p.changeEnvelope.slice(72, 136)) === s[59], "change envelope mismatch.")
  const bodyParameters: AbiParameter[] = [{ type: "uint256[45]" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }]
  const digest = BigInt(sha256(encodeAbiParameters(bodyParameters, [s.slice(10, 55), s[57]!, s[58]!, s[59]!, p.changeEnvelope])))
  check(s[55] === (digest & (LIMIT - 1n)) && s[56] === digest >> 128n, "execution body mismatch.")
  const feeSchedule = normalizeSignedRelayExecutionFeeScheduleV2(p.feeSchedule), f = feeSchedule.schedule
  check(f.chainId === config.profile.chainId && same(f.pool, asset.pool) && f.executionMode === Number(s[53]) && f.inputCount === count && f.outputCount === outputCount && BigInt(f.executorFee) === s[51] && same(f.relayer, config.relayer), "fee schedule tuple mismatch.")
  return { ...p, feeSchedule }
}
export function preparePoolV4Transaction(payload: CanonicalRelayExecutionPayloadV4) {
  return { to: getAddress(`0x${BigInt(payload.publicSignals[11]!).toString(16).padStart(40, "0")}`), data: encodeFunctionData({ abi: poolV4RuntimeAbi, functionName: "spend", args: [payload.proof, payload.publicSignals.map(BigInt), payload.changeEnvelope] }) }
}

// This structural client also permits deterministic RPC fixtures without a wallet or secret.
type Client = {
  getChainId(): Promise<number>; getGasPrice(): Promise<bigint>
  getBlock(args: { blockTag: "latest" | "finalized" } | { blockNumber: bigint }): Promise<any>
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
  readContract(args: any): Promise<any>; estimateGas(args: any): Promise<bigint>
  getTransaction(args: { hash: Hex }): Promise<any>; getTransactionReceipt(args: { hash: Hex }): Promise<any>
}
export async function assertPoolV4ExecutionReady(args: { payload: CanonicalRelayExecutionPayloadV4; profile: ReceivingProfileV4; relayer: Address; client: Client }) {
  const payload = validatePoolV4ProofPayload(args.payload, args), s = payload.publicSignals.map(BigInt), tx = preparePoolV4Transaction(payload), client = args.client
  check(await client.getChainId() === args.profile.chainId, "RPC chain mismatch.")
  const block = await client.getBlock({ blockTag: "latest" })
  check(typeof block?.number === "bigint" && /^0x[a-fA-F0-9]{64}$/.test(block.hash), "snapshot unavailable.")
  for (const pin of args.profile.codePins) { const code = await client.getCode({ address: pin.address, blockNumber: block.number }); check(code && keccak256(code) === pin.codeHash, "code pin mismatch.") }
  const read = (name: string, values: unknown[] = []) => client.readContract({ address: tx.to, abi: poolV4RuntimeAbi, functionName: name, args: values, blockNumber: block.number })
  const asset = args.profile.assets.find(a => same(a.pool, tx.to))!
  for (const [name, expected] of Object.entries({ circuitVersion: 4, assetId: asset.assetId, settlementDomain: args.profile.settlementDomain, underlyingToken: asset.token, receiver: args.profile.receiver, master: args.profile.master, registry: args.profile.registry, verifier: args.profile.verifier, hasher: args.profile.hasher, spendVerifier: args.profile.proofs.spend })) check(same(await read(name), expected), "pool getter mismatch.")
  check(await read("knownRoots", [s[14]]) === true, "unknown root.")
  for (const nf of poolV4ActiveNullifiers(payload)) check(await read("nullifiers", [BigInt(nf)]) === false, "already-spent input.")
  const bps = BigInt(await read("globalFeeBps")); check(bps >= 0n && bps <= 100n && s.slice(20, 30).reduce((fee, amount) => fee + amount * bps / 10000n, 0n) === s[50], "protocol fee mismatch.")
  const proof = decodeAbiParameters(proofParameters, payload.proof)
  check(await client.readContract({ address: args.profile.proofs.spend, abi: verifierAbi, functionName: "verifyProof", args: [...proof, s], blockNumber: block.number }) === true, "invalid contributed spend proof.")
  const gasPrice = await client.getGasPrice()
  await validateRelayExecutionFeeScheduleV2(payload.feeSchedule, { chainId: args.profile.chainId, pool: tx.to, executionMode: Number(s[53]) as 0 | 1, inputCount: Number(s[19]), outputCount: s.slice(20, 30).filter(n => n > 0n).length, executorFee: s[51]!, relayer: args.relayer, maximumExecutorFee: s.slice(20, 30).filter(n => n > 0n).length === 1 ? 5000n : 10000n, maximumValiditySeconds: 900, currentGasPrice: gasPrice, nowSeconds: Math.floor(Date.now() / 1000) })
  const gas = await client.estimateGas({ account: args.relayer, ...tx })
  requireCostCoveredRelayReward(s[51]!, gas, gasPrice)
  check((await client.getBlock({ blockNumber: block.number })).hash === block.hash && await client.getChainId() === args.profile.chainId, "snapshot changed.")
  return { transaction: tx, gasPrice }
}
export async function readPoolV4CanonicalReceipt(args: { payload: CanonicalRelayExecutionPayloadV4; profile: ReceivingProfileV4; relayer: Address; hash: Hex; client: Client }) {
  try {
    const prepared = preparePoolV4Transaction(args.payload), tx = await args.client.getTransaction({ hash: args.hash }), r = await args.client.getTransactionReceipt({ hash: args.hash })
    check(tx?.hash === args.hash && r?.transactionHash === args.hash && same(tx.from, args.relayer) && same(r.from, args.relayer) && same(tx.to, prepared.to) && same(r.to, prepared.to) && tx.input === prepared.data && tx.blockHash === r.blockHash && tx.blockNumber === r.blockNumber && tx.transactionIndex === r.transactionIndex, "receipt transaction mismatch.")
    const block = await args.client.getBlock({ blockNumber: r.blockNumber }), finalized = await args.client.getBlock({ blockTag: "finalized" })
    check(block?.hash === r.blockHash && block.transactions[Number(r.transactionIndex)] === args.hash && finalized?.number >= r.blockNumber && (await args.client.getBlock({ blockNumber: finalized.number })).hash === finalized.hash, "receipt not finalized/canonical.")
    check(await args.client.getChainId() === args.profile.chainId, "receipt chain mismatch.")
    for (const pin of args.profile.codePins) { const code = await args.client.getCode({ address: pin.address, blockNumber: r.blockNumber }); check(code && keccak256(code) === pin.codeHash, "receipt code pin mismatch.") }
    check((await args.client.getBlock({ blockNumber: r.blockNumber })).hash === r.blockHash, "receipt block changed.")
    if (r.status === "reverted") return "reverted" as const
    check(r.status === "success", "receipt status invalid.")
    let found = 0
    for (const log of r.logs) if (same(log.address, prepared.to)) try {
      const event = decodeEventLog({ abi: poolV4RuntimeAbi, data: log.data, topics: log.topics, strict: true })
      if (event.eventName === "Spent" && (event.args as any).changeEnvelope === args.payload.changeEnvelope && (event.args as any).signals?.map(String).join(",") === args.payload.publicSignals.join(",")) found++
    } catch { /* Unrelated pool events cannot settle an execution. */ }
    check(found === 1, "exact Spent event missing.")
    return "confirmed" as const
  } catch { return "pending" as const }
}
