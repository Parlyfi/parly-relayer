import { decodeEventLog, encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, toHex, type Hex } from "viem"
import type { ReceivingProviderSourceV4 } from "@parly/crypto-utils/receiving-source-v4"

type Rpc = (chainId: number, q: { method: string; params: unknown[] }) => Promise<unknown>
type Input = { attemptId: Hex; source: ReceivingProviderSourceV4; createdAt: bigint; destinationChainId: number; destinationTxHash: Hex; destinationTimestamp: bigint }
const abi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"])
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x[a-f0-9]{64}$/.test(v) && BigInt(v) !== 0n
const address = (v: unknown): v is Hex => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v) && BigInt(v) !== 0n
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: original V4 provider source") }
function number(v: unknown) { check(typeof v === "string" && /^0x[0-9a-f]{1,64}$/.test(v)); return BigInt(v) }

// Provider status correlates the retained request; it is never proof of a source payment.
export function createReceivingProviderSourceVerifierV4(args: { sourceRpc: Rpc; readProviderStatus(requestId: string): Promise<unknown> }) {
  const retained = new Map<string, { log: Record<string, unknown>; barrier: { number: bigint; hash: Hex } }>()
  return async (input: Input) => {
    const key = JSON.stringify(input, (_, v) => typeof v === "bigint" ? String(v) : v), deadline = Date.now() + 20000
    try {
      const { source: s, createdAt, destinationTimestamp } = structuredClone(input)
      check(hash(input.attemptId) && hash(input.destinationTxHash) && input.destinationChainId === 4217 && [1, 56, 8453, 42161].includes(s.sourceChainId))
      check(address(s.sourceToken) && address(s.depositAddress) && address(s.refundWallet) && hash(s.requestId) && Number.isInteger(s.sourceDecimals) && s.sourceDecimals >= 0 && s.sourceDecimals <= 18 && /^[1-9][0-9]{0,77}$/.test(s.sourceAmountBaseUnits) && BigInt(s.sourceAmountBaseUnits) < 1n << 256n)
      const expiry = BigInt(Date.parse(s.quoteExpiresAt) / 1000), attemptExpiry = BigInt(Date.parse(s.attemptExpiresAt) / 1000)
      check(new Date(Number(expiry) * 1000).toISOString() === s.quoteExpiresAt && expiry <= attemptExpiry && expiry >= createdAt && createdAt > 0n && destinationTimestamp >= createdAt)
      const rpc = (q: Parameters<Rpc>[1]) => { check(Date.now() < deadline); return args.sourceRpc(s.sourceChainId, q) }
      check(await rpc({ method: "eth_chainId", params: [] }) === toHex(s.sourceChainId))
      const header = async (tag: string) => {
        const b = await rpc({ method: "eth_getBlockByNumber", params: [tag, false] })
        check(object(b) && hash(b.hash) && Array.isArray(b.transactions)); return { hash: b.hash, number: number(b.number), timestamp: number(b.timestamp), transactions: b.transactions }
      }
      const head = await header("finalized")
      const last = destinationTimestamp < expiry ? destinationTimestamp : expiry
      check(head.timestamp >= last)
      // Recent attempts need at most a 13-step search; older history is still bounded by the deadline.
      const before = async (time: bigint, start = 0n) => {
        let low = start, high = head.number
        while (low < high) {
          const mid = (low + high + 1n) / 2n
          if ((await header(toHex(mid))).timestamp < time) low = mid; else high = mid - 1n
        }
        return low
      }
      const cached = retained.get(key), logs: unknown[] = []
      if (cached) {
        check(head.number >= cached.barrier.number && (await header(toHex(cached.barrier.number))).hash === cached.barrier.hash)
        logs.push(cached.log)
      } else {
        const recent = head.number > 7999n ? head.number - 7999n : 0n
        const first = await before(createdAt, (await header(toHex(recent))).timestamp < createdAt ? recent : 0n)
        const end = head.timestamp > last ? await before(last + 1n, first) : head.number
        check(end >= first && end - first < 8000n)
        for (let from = first; from <= end; from += 2000n) {
          const to = from + 1999n < end ? from + 1999n : end
          const page = await rpc({ method: "eth_getLogs", params: [{ address: s.sourceToken, topics: [keccak256(toHex("Transfer(address,address,uint256)")), null, toHex(BigInt(s.depositAddress), { size: 32 })], fromBlock: toHex(from), toBlock: toHex(to) }] })
          check(Array.isArray(page) && page.length <= 100); logs.push(...page)
        }
      }
      const incoming = logs.filter(log => {
        check(object(log) && same(log.address, s.sourceToken) && log.removed !== true && Array.isArray(log.topics) && typeof log.data === "string")
        const e = decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex, strict: true })
        check(same(e.args.to, s.depositAddress)); return e.args.value > 0n
      })
      check(incoming.length === 1)
      const log = incoming[0]; check(object(log) && hash(log.transactionHash) && hash(log.blockHash))
      const receipt = await rpc({ method: "eth_getTransactionReceipt", params: [log.transactionHash] })
      check(object(receipt) && receipt.status === "0x1" && receipt.transactionHash === log.transactionHash && receipt.blockHash === log.blockHash && receipt.blockNumber === log.blockNumber && receipt.transactionIndex === log.transactionIndex && Array.isArray(receipt.logs))
      const b = await header(String(receipt.blockNumber))
      check(b.hash === receipt.blockHash && b.number === number(receipt.blockNumber) && b.number <= head.number && b.timestamp >= createdAt && b.timestamp <= last && b.transactions[Number(number(receipt.transactionIndex))] === receipt.transactionHash)
      const exact = receipt.logs.filter(v => object(v) && v.logIndex === log.logIndex)
      check(exact.length === 1 && object(exact[0]) && exact[0].removed !== true)
      for (const k of ["address", "transactionHash", "blockHash", "blockNumber", "transactionIndex", "logIndex", "data", "topics"]) check(JSON.stringify(exact[0][k]) === JSON.stringify(log[k]))
      const event = decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex, strict: true })
      check(address(event.args.from) && event.args.value === BigInt(s.sourceAmountBaseUnits))
      check(JSON.stringify(encodeEventTopics({ abi, eventName: "Transfer", args: event.args })) === JSON.stringify(log.topics) && encodeAbiParameters([{ type: "uint256" }], [event.args.value]) === log.data)
      check(Date.now() < deadline)
      const status = await args.readProviderStatus(s.requestId)
      check(object(status) && status.requestId === s.requestId && status.status === "success" && status.originChainId === s.sourceChainId && status.destinationChainId === input.destinationChainId && Array.isArray(status.txHashes) && status.txHashes.length === 1 && status.txHashes[0] === input.destinationTxHash)
      check((await header(toHex(head.number))).hash === head.hash && (await header(toHex(b.number))).hash === b.hash && await rpc({ method: "eth_chainId", params: [] }) === toHex(s.sourceChainId))
      if (!cached) { if (retained.size >= 256) retained.delete(retained.keys().next().value!); retained.set(key, { log: structuredClone(log), barrier: { number: head.number, hash: head.hash } }) }
      return { sourceChainId: s.sourceChainId, sourceTxHash: receipt.transactionHash, sourceSender: event.args.from, sourceAmountBaseUnits: String(event.args.value), blockHash: b.hash, blockNumber: String(b.number), logIndex: String(number(log.logIndex)) }
    } catch { retained.delete(key); throw Error("UNAVAILABLE: original V4 provider source") }
  }
}

export function createReceivingProviderSourceTransportV4(env: Record<string, string | undefined> = process.env) {
  const urls: Record<number, string | undefined> = {
    1: env.PHASE3_ONE_TIME_ETHEREUM_RPC_URL || env.ETH_RPC_URL,
    56: env.PHASE3_ONE_TIME_BSC_RPC_URL || env.BSC_RPC_URL,
    8453: env.PHASE3_ONE_TIME_BASE_RPC_URL || env.BASE_RPC_URL,
    42161: env.PHASE3_ONE_TIME_ARBITRUM_RPC_URL || env.ARBITRUM_RPC_URL
  }
  const request = async (url: string, init?: RequestInit) => {
    check(new URL(url).protocol === "https:")
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(7000) })
    check(response.ok && response.body)
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let length = 0
    try { while (true) { const p = await reader.read(); if (p.done) break; length += p.value.length; if (length > 1048576) { await reader.cancel(); check(false) }; parts.push(p.value) } }
    finally { reader.releaseLock() }
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown
  }
  return {
    sourceRpc: async (chainId: number, q: { method: string; params: unknown[] }) => {
      const url = urls[chainId]; check(url)
      const value = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...q }) })
      check(object(value) && value.id === 1 && !value.error && "result" in value); return value.result
    },
    readProviderStatus: async (requestId: string) => {
      const headers: Record<string, string> = { Accept: "application/json" }; if (env.RELAY_API_KEY) headers["x-api-key"] = env.RELAY_API_KEY
      const value = await request("https://api.relay.link/intents/status/v3?requestId=" + encodeURIComponent(requestId), { headers })
      check(object(value) && (value.requestId === undefined || value.requestId === requestId)); return { ...value, requestId }
    }
  }
}

export function createReceivingProviderSourceHostV4(env: Record<string, string | undefined> = process.env) {
  return createReceivingProviderSourceVerifierV4(createReceivingProviderSourceTransportV4(env))
}
