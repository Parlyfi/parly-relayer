import { buildPoseidon } from "circomlibjs"
import { hexToBytes } from "viem"
import { decodeReceivingBody } from "@parly/crypto-utils/recipient-format-v4"
import { hashRecipientPublication, type RecipientPublication } from "@parly/crypto-utils/recipient-publication-v4"
import { restoreReceivingPreparationV4 } from "./receiving-preparation-v4.js"
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
let poseidon: ReturnType<typeof buildPoseidon> | undefined
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: original V4 membership") }
export type ReceivingOpeningV4 = { membershipBlind: string; publicationBlind: string }
export async function receivingPublicationBindingV4(input: { preparation: unknown; frame: RecipientPublication; descriptor: string; leaf: string; opening: unknown }) {
  const { frame, descriptor, leaf, opening } = structuredClone(input), prepared = await restoreReceivingPreparationV4(input.preparation)
  const decimal = (v: unknown) => { check(typeof v === "string" && /^[1-9][0-9]{0,76}$/.test(v) && BigInt(v) < FIELD); return BigInt(v) }
  const o = opening as ReceivingOpeningV4
  check(o && Object.keys(o).sort().join(",") === "membershipBlind,publicationBlind")
  const body = decodeReceivingBody(hexToBytes(prepared.body)), d = decimal(descriptor), memberBlind = decimal(o.membershipBlind), publicationBlind = decimal(o.publicationBlind)
  check(prepared.purpose === 2 && prepared.publicationId === frame.publicationId && BigInt(prepared.policySubject) === BigInt(frame.owner) && body.chainId === frame.chainId && body.registry.toLowerCase() === frame.registry.toLowerCase() && body.expiresAt <= frame.validUntil && (frame.assetMask & 1n << body.assetId - 1n) !== 0n)
  const P = await (poseidon ??= buildPoseidon()), H = (...xs: bigint[]) => BigInt(P.F.toString(P(xs)))
  const digest = await hashRecipientPublication(frame), domain = H(953n, 4n, body.chainId, BigInt(body.pool), body.assetId, body.settlementDomain), kind = frame.kind === "invoice" ? 1n : 2n
  check(H(H(BigInt(frame.owner), d), H(H(frame.nonce, frame.epoch), H(kind, frame.validUntil))) === decimal(leaf) && H(959n, domain, d, memberBlind) === body.binding && H(965n, d, digest.lo, digest.hi, publicationBlind) === BigInt(prepared.binding))
  return { chainId: body.chainId, registryAddress: BigInt(body.registry), poolAddress: BigInt(body.pool), assetId: body.assetId, settlementDomain: body.settlementDomain, expiresAt: body.expiresAt,
    binding: body.binding, bodyLo: prepared.expected[11], bodyHi: prepared.expected[12], descriptor: d, blind: memberBlind, owner: BigInt(frame.owner), nonce: frame.nonce, epoch: frame.epoch, kind, validUntil: frame.validUntil }
}
