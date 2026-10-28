import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from "viem"
import { parlyPayoutAdapterV7Abi, parlyPayoutWithdrawalExecutorV3Abi } from "@parly/protocol-abis/payout-v7"
import { hashPayoutV7Batch, hashPayoutV7Payload, type PayoutV7Manifest } from "../internal/sdk/payout-v7.js"
import { validatePayoutV7SignedTempo } from "./payout-v7-tempo.js"
import type { PayoutV7SignedCall } from "./payout-v7-worker.js"

function check(ok: unknown): asserts ok { if (!ok) throw Error("V7 retained signature can still execute or is not exactly bound.") }
export async function validatePayoutV7RetirementCalls(args: { rows: PayoutV7SignedCall[]; prefix: string; manifest: PayoutV7Manifest; poolCall: Hex; signatures: Hex[]; operator: Address; feeToken: Address; timestamp: bigint }) {
  const { manifest: m } = args, calls = []
  check(args.timestamp > BigInt(m.quoteExpiresAt) && m.children.every(c => args.timestamp > c.intent.quoteExpiry))
  for (const row of args.rows) {
    await validatePayoutV7SignedTempo(row, { chainId: m.chainId, operator: args.operator, feeToken: args.feeToken })
    check(row.id.startsWith(args.prefix))
    const step = row.id.slice(args.prefix.length)
    if (step === "source") {
      check(getAddress(row.to) === getAddress(m.withdrawalExecutor))
      const decoded = decodeFunctionData({ abi: parlyPayoutWithdrawalExecutorV3Abi, data: row.data }); check(decoded.functionName === "executeWithdrawal")
      const [lease, , poolCall, hashes, allocations] = decoded.args
      check(encodeFunctionData({ abi: parlyPayoutWithdrawalExecutorV3Abi, functionName: "executeWithdrawal", args: decoded.args }) === row.data && poolCall === args.poolCall)
      check(lease.expiry <= BigInt(m.quoteExpiresAt) - 300n && lease.expiry < args.timestamp && getAddress(lease.operator) === getAddress(args.operator) && getAddress(lease.pool) === getAddress(m.sourcePool) && getAddress(lease.adapter) === getAddress(m.adapter) && getAddress(lease.token) === getAddress(m.sourceToken))
      check(hashes.join() === m.children.map(c => c.intentHash).join() && allocations.map(String).join() === m.children.map(c => String(c.intent.sourceExecutorFeeAllocation)).join() && lease.intentHash === hashPayoutV7Batch([...hashes]) && lease.payloadHash === hashPayoutV7Payload(poolCall, hashes, allocations))
      calls.push({ transactionHash: row.transactionHash, expiry: String(lease.expiry) })
    } else {
      const index = m.children.findIndex(c => step === `accept:${c.intentHash}`); check(index >= 0 && getAddress(row.to) === getAddress(m.adapter))
      const child = m.children[index]!
      check(row.data === encodeFunctionData({ abi: parlyPayoutAdapterV7Abi, functionName: "acceptQuote", args: [child.intent, args.signatures[index]!] }))
      calls.push({ transactionHash: row.transactionHash, expiry: String(child.intent.quoteExpiry) })
    }
  }
  return calls
}
