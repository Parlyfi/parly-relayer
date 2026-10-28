import { encodeFunctionData, getAddress, keccak256, sha256, toHex, type Address, type Hex } from "viem"
import { payoutPoolV4Abi } from "@parly/protocol-abis/payout-v7"
import { receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { buildPayoutV7AuthorizationMessage, hashPayoutV7Manifest, restorePayoutIntentV7, type PayoutV7Manifest } from "../internal/sdk/payout-v7.js"

export function validatePayoutV7Execution(args: { value: any; manifestHash: Hex; proof: any; profile: ReceivingProfileV4; operator: Address; adapter: Address; executor: Address; publicKeyB64: string }) {
  const check = (ok: unknown) => { if (!ok) throw Error("V7 execution binding is invalid.") }
  const { value, proof: p, profile } = args
  check(value?.manifest && Array.isArray(value.manifest.children) && value.manifest.children.length >= 1 && value.manifest.children.length <= 10)
  const m = { ...value.manifest, children: value.manifest.children.map((c: any) => ({ ...c, intent: restorePayoutIntentV7(c.intent) })) } as PayoutV7Manifest
  check(m.version === 7 && m.poolVersion === 4 && m.chainId === profile.chainId && m.profileDigest === sha256(toHex(receivingProfileJsonV4(profile))) && hashPayoutV7Manifest(m) === args.manifestHash)
  check(getAddress(m.adapter) === getAddress(args.adapter) && getAddress(m.withdrawalExecutor) === getAddress(args.executor) && getAddress(m.selectedRelayer) === getAddress(args.operator) && m.relayerPublicKeyHash === keccak256(toHex(args.publicKeyB64)))
  buildPayoutV7AuthorizationMessage(m, { wallet: m.children[0]!.refundWallet, issuedAt: 0, nonce: m.clientAuthorizationId })
  check(Array.isArray(value.payoutSignatures) && value.payoutSignatures.length === m.children.length && value.payoutSignatures.every((s: unknown) => typeof s === "string" && /^0x[a-fA-F0-9]{130}$/.test(s)))
  check(typeof value.sealedExecutionPayload === "string" && keccak256(value.sealedExecutionPayload) === m.sealedExecutionPayloadHash)
  check(p && Object.keys(p).sort().join() === "changeEnvelope,poolVersion,profileDigest,proof,publicSignals60,version" && p.version === 7 && p.poolVersion === 4 && p.profileDigest === m.profileDigest)
  check(/^0x[a-fA-F0-9]{512}$/.test(p.proof) && /^0x(?:[a-fA-F0-9]{2}){0,4096}$/.test(p.changeEnvelope) && Array.isArray(p.publicSignals60) && p.publicSignals60.length === 60)
  const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
  check(p.publicSignals60.every((s: unknown) => typeof s === "string" && /^(0|[1-9][0-9]{0,76})$/.test(s) && BigInt(s) < field))
  const s = p.publicSignals60.map(BigInt) as bigint[], asset = profile.assets.find(a => getAddress(a.pool) === getAddress(m.sourcePool))
  check(asset && asset.assetId === m.assetId && getAddress(asset.token) === getAddress(m.sourceToken))
  check(s[10] === BigInt(m.chainId) && s[11] === BigInt(m.sourcePool) && s[12] === BigInt(m.assetId) && s[13] === profile.settlementDomain && s[19] === BigInt(m.inputCount) && s[50] === BigInt(m.protocolFeeBaseUnits) && s[51] === BigInt(m.sourceExecutorFeeBaseUnits) && s[52] === BigInt(m.withdrawalExecutor) && s[53] === 0n)
  check(m.inputCount >= 1 && m.inputCount <= 4 && s.slice(15, 15 + m.inputCount).every(n => n > 0n) && s.slice(15 + m.inputCount, 19).every(n => n === 0n) && new Set(s.slice(15, 15 + m.inputCount).map(String)).size === m.inputCount)
  for (let i = 0; i < 10; i++) check(s[20 + i] === (m.children[i]?.intent.amountIn ?? 0n) && s[30 + i] === (m.children[i] ? BigInt(m.children[i]!.intent.escrow) : 0n) && s[40 + i] === profile.settlementDomain)
  check(m.children.every(c => c.intent.environment === profile.environment))
  const poolCall = encodeFunctionData({ abi: payoutPoolV4Abi, functionName: "spend", args: [p.proof, s as any, p.changeEnvelope] })
  check(keccak256(poolCall) === m.sourceCallHash)
  return { manifest: m, poolCall, signatures: value.payoutSignatures as Hex[], nullifiers: s.slice(15, 15 + m.inputCount).map(n => `0x${n.toString(16).padStart(64, "0")}` as Hex) }
}
