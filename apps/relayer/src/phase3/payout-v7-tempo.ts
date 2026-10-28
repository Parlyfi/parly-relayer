import { keccak256, recoverAddress, toHex, type Address } from "viem"
import { Actions, Transaction } from "viem/tempo"
import type { PayoutV7SignedCall } from "./payout-v7-worker.js"

function check(ok: unknown): asserts ok { if (!ok) throw Error("V7 native signed call or nonce lane is invalid.") }
export function payoutV7NonceKey(id: string) {
  const lane = BigInt(keccak256(toHex(`PARLY_PAYOUT_V7_NATIVE_CALL_V1:${id}`)).slice(0, 50))
  check(lane > 0n); return lane
}
export async function assertPayoutV7NonceAvailable(client: { readContract(args: any): Promise<any> }, operator: Address, lane: bigint) {
  const call = Actions.nonce.getNonce.call({ account: operator, nonceKey: lane })
  for (const blockTag of ["latest", "pending"] as const) check(await client.readContract({ ...call, blockTag }) === 0n)
}
export async function validatePayoutV7SignedTempo(row: PayoutV7SignedCall, context: { chainId: number; operator: Address; feeToken: Address }) {
  check(/^0x76(?:[a-f0-9]{2}){1,65536}$/.test(row.serializedTransaction) && keccak256(row.serializedTransaction) === row.transactionHash)
  const tx = Transaction.deserialize(row.serializedTransaction as `0x76${string}`)
  check(tx.type === "tempo")
  const signature = tx.signature, call = tx.calls[0]
  check(tx.chainId === context.chainId && tx.nonce === 0 && tx.nonceKey === payoutV7NonceKey(row.id) && tx.calls.length === 1 && call?.to?.toLowerCase() === row.to.toLowerCase() && call.data === row.data && (call.value ?? 0n) === 0n && typeof tx.feeToken === "string" && tx.feeToken.toLowerCase() === context.feeToken.toLowerCase())
  const authorizations = (tx as { authorizationList?: unknown }).authorizationList
  check(tx.feePayerSignature === undefined && !tx.keyAuthorization && (authorizations === undefined || Array.isArray(authorizations) && authorizations.length === 0) && !tx.accessList?.length && tx.validBefore === undefined && tx.validAfter === undefined && signature?.type === "secp256k1")
  check(await Transaction.serialize(tx) === row.serializedTransaction && typeof tx.gas === "bigint" && tx.gas > 0n && typeof tx.maxFeePerGas === "bigint" && tx.maxFeePerGas > 0n)
  const signer = await recoverAddress({ hash: keccak256(await Transaction.serialize({ ...tx, signature: undefined })), signature: { r: toHex(signature.signature.r, { size: 32 }), s: toHex(signature.signature.s, { size: 32 }), yParity: signature.signature.yParity } })
  check(signer.toLowerCase() === context.operator.toLowerCase())
}
