import { encodeAbiParameters, hashTypedData, keccak256, toHex, type Address, type Hex } from "viem"

const context = ["environment", "chainId", "settlementDomainId", "adapter", "escrowSalt", "escrow", "sourcePool", "sourceExecutor", "token", "assetId", "sourceGroupReward", "sourceRecipientCount", "sourceRecipientIndex"] as const
const route = ["amountIn", "sourceAmountOut", "destinationAmountOut", "providerSourceAmount", "sourceExecutorFeeAllocation", "submissionReimbursement", "deliverySuccessFee", "maxOperatorFee", "providerContract", "destinationChainId", "destinationToken", "destinationRecipientHash", "registrationOperator", "registrationReimbursement"] as const
const policy = ["refundRecipientCommitment", "primaryRefundToken", "secondaryRefundToken", "providerDataHash", "requestIdHash", "refundRouteBindingHash", "sourceCallHash", "nonce", "quoteExpiry", "preSubmissionRecoveryDelay", "maxCompletionDelay"] as const
const addresses = new Set(["adapter", "escrow", "sourcePool", "sourceExecutor", "token", "providerContract", "destinationToken", "primaryRefundToken", "secondaryRefundToken", "registrationOperator"])
const hashes = new Set(["environment", "escrowSalt", "destinationRecipientHash", "refundRecipientCommitment", "providerDataHash", "requestIdHash", "refundRouteBindingHash", "sourceCallHash", "nonce"])
type Name = typeof context[number] | typeof route[number] | typeof policy[number]
export type PayoutIntentV7 = { [K in Name]: K extends "environment" | "escrowSalt" | "destinationRecipientHash" | "refundRecipientCommitment" | "providerDataHash" | "requestIdHash" | "refundRouteBindingHash" | "sourceCallHash" | "nonce" ? Hex : K extends "adapter" | "escrow" | "sourcePool" | "sourceExecutor" | "token" | "providerContract" | "destinationToken" | "primaryRefundToken" | "secondaryRefundToken" | "registrationOperator" ? Address : bigint }
export type PayoutLeaseV3 = { intentHash: Hex; adapter: Address; pool: Address; payloadHash: Hex; operator: Address; token: Address; maximumExecutorFee: bigint; nonce: Hex; expiry: bigint }
export type PayoutV7Child = { intentHash: Hex; intent: PayoutIntentV7; providerData: Hex; destinationRecipient: Address; refundWallet: Address }
export type PayoutV7Manifest = {
  version: 7; poolVersion: 4; profileDigest: Hex; chainId: number; adapter: Address; withdrawalExecutor: Address
  sourcePool: Address; sourceToken: Address; assetId: 1 | 2 | 3; inputCount: number; sourceCallHash: Hex
  selectedRelayer: Address; relayerPublicKeyHash: Hex; sealedExecutionPayloadHash: Hex; clientAuthorizationId: Hex
  protocolFeeBaseUnits: string; sourceExecutorFeeBaseUnits: string; maximumTotalNoteDeductionBaseUnits: string
  quoteExpiresAt: number; children: PayoutV7Child[]
}
function structHash(intent: PayoutIntentV7, names: readonly Name[]) {
  return keccak256(encodeAbiParameters(names.map(name => ({ type: addresses.has(name) ? "address" : hashes.has(name) ? "bytes32" : "uint256" })), names.map(name => intent[name])))
}
export function hashPayoutIntentV7(intent: PayoutIntentV7) {
  return hashTypedData({ domain: { name: "ParlyPayoutAdapterV7", version: "1", chainId: Number(intent.chainId), verifyingContract: intent.adapter }, types: { PayoutIntentV7: [{ name: "contextHash", type: "bytes32" }, { name: "routeHash", type: "bytes32" }, { name: "policyHash", type: "bytes32" }] }, primaryType: "PayoutIntentV7", message: { contextHash: structHash(intent, context), routeHash: structHash(intent, route), policyHash: structHash(intent, policy) } })
}
export function hashPayoutV7Payload(poolCall: Hex, intentHashes: readonly Hex[], allocations: readonly bigint[]) {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32[]" }, { type: "uint256[]" }], [keccak256(toHex("PARLY_POOL_V4_PAYOUT_PAYLOAD_V1")), keccak256(poolCall), intentHashes, allocations]))
}
export function hashPayoutV7Batch(intentHashes: readonly Hex[]) {
  return intentHashes.length === 1 ? intentHashes[0]! : keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32[]" }], [keccak256(toHex("PARLY_PAYOUT_BATCH_V7")), intentHashes]))
}
export function hashPayoutLeaseV3(lease: PayoutLeaseV3, chainId: number, executor: Address) {
  return hashTypedData({ domain: { name: "ParlyPayoutWithdrawalExecutor", version: "3", chainId, verifyingContract: executor }, types: { WithdrawalLeaseV3: ["intentHash", "adapter", "pool", "payloadHash", "operator", "token", "maximumExecutorFee", "nonce", "expiry"].map(name => ({ name, type: ["adapter", "pool", "operator", "token"].includes(name) ? "address" : ["maximumExecutorFee", "expiry"].includes(name) ? "uint256" : "bytes32" })) }, primaryType: "WithdrawalLeaseV3", message: lease })
}
export function allocatePayoutV7SourceFee(reward: bigint, count: number) {
  if (count < 1 || count > 10 || !Number.isSafeInteger(count) || reward < 0n || reward > (count === 1 ? 5_000n : 10_000n)) throw Error("Invalid V7 source fee group.")
  return Array.from({ length: count }, (_, index) => reward / BigInt(count) + (BigInt(index) < reward % BigInt(count) ? 1n : 0n))
}
export function canonicalPayoutV7(value: unknown): string {
  const stable = (v: unknown): unknown => typeof v === "bigint" ? String(v) : Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, stable(x)])) : v
  return JSON.stringify(stable(value))
}
export function hashPayoutV7Manifest(manifest: PayoutV7Manifest) { return keccak256(toHex(canonicalPayoutV7(manifest))) }
export function buildPayoutV7ProvenanceTypedData(args: { chainId: number; adapter: Address; attestation: { intentHash: Hex; sourcePool: Address; token: Address; assetId: bigint; amount: bigint; escrow: Address; withdrawalTxHash: Hex; transferLogIndex: bigint; blockNumber: bigint; blockHash: Hex; attestationNonce: Hex } }) {
  const a = args.attestation
  return { domain: { name: "ParlyPayoutAdapterV7", version: "1", chainId: args.chainId, verifyingContract: args.adapter }, types: { ProvenanceAttestationV7: [{ name: "contextHash", type: "bytes32" }, { name: "observationHash", type: "bytes32" }] }, primaryType: "ProvenanceAttestationV7" as const, message: {
    contextHash: keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }], [a.intentHash, a.sourcePool, a.token, a.assetId, a.amount, a.escrow])),
    observationHash: keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }], [a.withdrawalTxHash, a.transferLogIndex, a.blockNumber, a.blockHash, a.attestationNonce]))
  } }
}
export function buildPayoutV7AuthorizationMessage(manifest: PayoutV7Manifest, authorization: { wallet: Address; issuedAt: number; nonce: Hex }) {
  if (manifest.version !== 7 || manifest.poolVersion !== 4 || manifest.children.length < 1 || manifest.children.length > 10) throw Error("Invalid V7 manifest.")
  const sourceReward = BigInt(manifest.sourceExecutorFeeBaseUnits), allocations = allocatePayoutV7SourceFee(sourceReward, manifest.children.length)
  let total = BigInt(manifest.protocolFeeBaseUnits) + sourceReward
  for (const [index, child] of manifest.children.entries()) {
    const i = child.intent
    if (keccak256(encodeAbiParameters([{type:"address"}],[child.destinationRecipient])) !== i.destinationRecipientHash) throw Error("Invalid V7 destination recipient binding.")
    if (hashPayoutIntentV7(i) !== child.intentHash || i.registrationOperator.toLowerCase() !== manifest.selectedRelayer.toLowerCase() || i.registrationReimbursement <= 0n || i.sourceGroupReward !== sourceReward || i.sourceRecipientIndex !== BigInt(index) || i.sourceRecipientCount !== BigInt(manifest.children.length) || i.sourceExecutorFeeAllocation !== allocations[index] || i.sourceCallHash !== manifest.sourceCallHash || i.sourcePool.toLowerCase() !== manifest.sourcePool.toLowerCase() || i.sourceExecutor.toLowerCase() !== manifest.withdrawalExecutor.toLowerCase() || i.adapter.toLowerCase() !== manifest.adapter.toLowerCase() || i.token.toLowerCase() !== manifest.sourceToken.toLowerCase() || i.chainId !== BigInt(manifest.chainId) || i.assetId !== BigInt(manifest.assetId) || i.amountIn !== i.providerSourceAmount + i.registrationReimbursement + i.submissionReimbursement + i.deliverySuccessFee || i.sourceExecutorFeeAllocation + i.registrationReimbursement + i.submissionReimbursement + i.deliverySuccessFee > i.maxOperatorFee || i.maxOperatorFee > 20_000n || i.quoteExpiry < BigInt(manifest.quoteExpiresAt) || keccak256(child.providerData) !== i.providerDataHash) throw Error("Invalid V7 child binding.")
    total += i.amountIn
  }
  if (String(total) !== manifest.maximumTotalNoteDeductionBaseUnits) throw Error("Invalid V7 manifest totals.")
  return `Parly cross-chain payout authorization V7\nManifest: ${hashPayoutV7Manifest(manifest)}\nWallet: ${authorization.wallet.toLowerCase()}\nIssued At: ${authorization.issuedAt}\nNonce: ${authorization.nonce}\n${canonicalPayoutV7(manifest)}`
}
export function restorePayoutIntentV7(raw: Record<string, unknown>): PayoutIntentV7 {
  if (Object.keys(raw).sort().join() !== [...context, ...route, ...policy].sort().join()) throw Error("Invalid V7 intent fields.")
  const result: Record<string, unknown> = {}
  for (const name of [...context, ...route, ...policy]) {
    const value = raw[name]
    if (addresses.has(name) || hashes.has(name)) {
      if (typeof value !== "string" || !(addresses.has(name) ? /^0x[a-fA-F0-9]{40}$/ : /^0x[a-fA-F0-9]{64}$/).test(value)) throw Error("Invalid V7 intent field.")
      result[name] = value
    } else {
      if (!(typeof value === "bigint" && value >= 0n) && !(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value))) throw Error("Invalid V7 intent integer.")
      result[name] = BigInt(value)
    }
  }
  return result as PayoutIntentV7
}
