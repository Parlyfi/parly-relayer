import { encodeAbiParameters, hexToBytes, keccak256, toHex } from "viem"
import { decodeReceivingBody, encodeReceivingBody, hashReceivingBody, type ReceivingBody } from "@parly/crypto-utils/recipient-format-v4"
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const publication = (v: unknown) => typeof v === "string" && /^privacy-link:(invoice|profile):[a-z0-9-]{1,64}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: original V4 preparation") }
const wire = (v: unknown) => JSON.stringify(v, (_, n) => typeof n === "bigint" ? String(n) : n)
export async function createReceivingPreparationV4(body: ReceivingBody, binding: bigint, policySubject: bigint, purpose: 1 | 2, publicationId: string | null) {
  encodeReceivingBody(body)
  check(binding > 0n && binding < FIELD && policySubject > 0n && policySubject < 1n << 160n)
  check(purpose === 1 ? publicationId === null : purpose === 2 && publication(publicationId))
  check(body.expectedAmount >= body.principal && body.expectedAmount - body.principal <= body.maxFinalizerFee && body.maxFinalizerFee * 10000n <= body.expectedAmount * 300n)
  const digest = await hashReceivingBody(body)
  const expected = [body.chainId, BigInt(body.registry), BigInt(body.pool), body.assetId, body.settlementDomain, body.expiresAt, body.commitment, body.ephemeralX, body.ephemeralY, body.binding, body.principal, digest.lo, digest.hi]
  const tupleHash = keccak256(encodeAbiParameters([{ type: "uint256[13]" }], [expected as [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint]]))
  const routeHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(toHex("PARLY_RECEIVING_BODY_POLICY_V4")), body.attemptId, toHex(digest.hash), policySubject, purpose, binding, tupleHash]))
  return Object.freeze({ publicationId, purpose, body: toHex(encodeReceivingBody(body)), expected: Object.freeze(expected), binding: String(binding), policySubject: String(policySubject), routeHash })
}
export async function restoreReceivingPreparationV4(input: unknown) {
  const v = structuredClone(input) as Record<string, unknown>
  check(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === "binding,body,expected,policySubject,publicationId,purpose,routeHash")
  check(typeof v.body === "string" && /^0x[0-9a-f]{886}$/.test(v.body) && [1, 2].includes(v.purpose as number))
  check(Array.isArray(v.expected) && v.expected.length === 13 && v.expected.every(n => typeof n === "string" && /^(0|[1-9][0-9]{0,77})$/.test(n)))
  check([v.binding, v.policySubject].every(n => typeof n === "string" && /^[1-9][0-9]{0,76}$/.test(n)))
  const body = decodeReceivingBody(hexToBytes(v.body as `0x${string}`))
  const restored = await createReceivingPreparationV4(body, BigInt(v.binding as string), BigInt(v.policySubject as string), v.purpose as 1 | 2, v.publicationId as string | null)
  check(wire(restored) === wire(Object.fromEntries(Object.keys(restored).map(k => [k, v[k]]))))
  return restored
}
