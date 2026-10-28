// V4 authorization only. No active endpoint selects this module or a QA verifier.
import { hashTypedData, verifyTypedData, type Address, type Hex } from "viem"
import { buildBabyjub, buildPoseidon } from "circomlibjs"
import { deriveRecipientKeys, type RecipientKeyContext } from "@parly/crypto-utils/recipient-keys"
import { hashRecipientPublication, type RecipientPublication } from "@parly/crypto-utils/recipient-publication-v4"

type Domain = { name: string; version: string; chainId: number; verifyingContract: Address }
type Point = [string, string]
type Enrollment = { proof: Hex; publicSignals: string[] }
type Authorization = Enrollment & { scheme: "native-receiving-v4"; descriptor: string; spendPublicKey: Point; viewPublicKey: Point; signature: Hex }
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const SECP_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n
const types = { Publication: [{ name: "owner", type: "address" }, { name: "descriptor", type: "uint256" }, { name: "nonce", type: "uint64" }, { name: "epoch", type: "uint64" }, { name: "kind", type: "uint8" }, { name: "validUntil", type: "uint64" }] } as const
let primitives: Promise<{ jub: any; poseidon: any }> | undefined
function loadPrimitives() { return primitives ??= Promise.all([buildBabyjub(), buildPoseidon()]).then(([jub, poseidon]) => ({ jub, poseidon })) }
function decimal(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= FIELD) throw new Error("Invalid receiving field.")
  return BigInt(value)
}
function checkDomain(frame: RecipientPublication, domain: Domain) {
  if (!domain || Object.keys(domain).sort().join(",") !== "chainId,name,verifyingContract,version" ||
      domain.name !== "Parly Receiving Authorization" || domain.version !== "4" ||
      !Number.isSafeInteger(domain.chainId) || BigInt(domain.chainId) !== frame.chainId ||
      typeof domain.verifyingContract !== "string" || domain.verifyingContract.toLowerCase() !== frame.registry.toLowerCase()) throw new Error("Receiving authorization domain mismatch.")
}
function checkEnrollment(enrollment: Enrollment, signals: string[]) {
  if (!enrollment || typeof enrollment.proof !== "string" || !/^0x[a-fA-F0-9]{512}$/.test(enrollment.proof) ||
      !Array.isArray(enrollment.publicSignals) || enrollment.publicSignals.length !== 9 ||
      enrollment.publicSignals.some((value, index) => decimal(value) !== BigInt(signals[index]))) throw new Error("Receiving enrollment does not match the publication.")
  for (const word of enrollment.proof.slice(2).match(/.{64}/g)!) if (BigInt("0x" + word) >= BASE_FIELD) throw new Error("Noncanonical enrollment proof.")
}
function checkSignature(signature: Hex) {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error("Invalid receiving signature.")
  const r = BigInt("0x" + signature.slice(2, 66)), s = BigInt("0x" + signature.slice(66, 130)), v = signature.slice(130).toLowerCase()
  if (r === 0n || r >= SECP_ORDER || s === 0n || s > SECP_ORDER / 2n || !["1b", "1c"].includes(v)) throw new Error("Noncanonical receiving signature.")
}
async function opening(frame: RecipientPublication, domain: Domain, A: Point, V: Point) {
  checkDomain(frame, domain)
  const digest = await hashRecipientPublication(frame), { jub, poseidon } = await loadPrimitives()
  const H = (...xs: bigint[]) => BigInt(poseidon.F.toString(poseidon(xs)))
  for (const point of [A, V]) {
    if (!Array.isArray(point) || point.length !== 2) throw new Error("Invalid receiving key.")
    const canonical = point.map(decimal), native = canonical.map(value => jub.F.e(value))
    if (!jub.inCurve(native) || !jub.inSubgroup(native) || (canonical[0] === 0n && canonical[1] === 1n)) throw new Error("Invalid receiving subgroup key.")
  }
  if ((A[0] === V[0] && A[1] === V[1]) || (decimal(A[0]) + decimal(V[0])) % FIELD === 0n && A[1] === V[1]) throw new Error("Receiving key roles must be distinct.")
  const kind = frame.kind === "invoice" ? 1n : 2n
  const descriptor = H(942n, 1n, H(941n, frame.chainId, BigInt(frame.registry), 1n), BigInt(frame.owner), frame.nonce, frame.epoch, kind, frame.validUntil, ...A.map(decimal), ...V.map(decimal), digest.lo, digest.hi, frame.assetMask, 2n)
  if (descriptor === 0n) throw new Error("Invalid zero receiving descriptor.")
  const leaf = H(H(BigInt(frame.owner), descriptor), H(H(frame.nonce, frame.epoch), H(kind, frame.validUntil)))
  const signals = [leaf, descriptor, frame.chainId, BigInt(frame.registry), BigInt(frame.owner), frame.nonce, frame.epoch, kind, frame.validUntil].map(String)
  if (leaf === 0n) throw new Error("Invalid zero receiving leaf.")
  const typedData = Object.freeze({ domain: Object.freeze({ ...domain }), types: Object.freeze({ Publication: Object.freeze(types.Publication.map(field => Object.freeze({ ...field }))) }), primaryType: "Publication" as const, message: Object.freeze({ owner: frame.owner, descriptor, nonce: frame.nonce, epoch: frame.epoch, kind: Number(kind), validUntil: frame.validUntil }) })
  return { descriptor, signals, typedData, digest, kind }
}

export async function authorizeReceivingPublicationV4(args: {
  frame: RecipientPublication; domain: Domain; keyContext: RecipientKeyContext; privateRoot: Uint8Array
  proveEnrollment(input: Record<string, bigint>): Promise<Enrollment>
  signTypedData(data: Awaited<ReturnType<typeof opening>>["typedData"]): Promise<Hex>
  isCurrentSession(): boolean
}): Promise<Authorization> {
  const frame = Object.freeze({ ...args.frame }), domain = Object.freeze({ ...args.domain }), context = { ...args.keyContext }
  checkDomain(frame, domain)
  const assertCurrent = () => {
    if (!args.isCurrentSession()) throw new Error("Publication session changed. Try again.")
    if (frame.validUntil <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Publication authorization expired. Try again.")
  }
  assertCurrent()
  if (context.walletAddress.toLowerCase() !== frame.owner.toLowerCase() || context.origin !== frame.origin) throw new Error("Publication key context changed. Try again.")
  const keys = await deriveRecipientKeys(args.privateRoot, context), { jub } = await loadPrimitives()
  keys.sodiumSeed.fill(0)
  const point = (scalar: bigint): Point => jub.mulPointEscalar(jub.Base8, scalar).map((value: unknown) => jub.F.toString(value))
  const A = point(keys.spendScalar), V = point(keys.viewScalar), prepared = await opening(frame, domain, A, V)
  assertCurrent()
  const enrollment = await args.proveEnrollment({ spendScalar: keys.spendScalar, viewScalar: keys.viewScalar, chainId: frame.chainId, registryAddress: BigInt(frame.registry), owner: BigInt(frame.owner), nonce: frame.nonce, epoch: frame.epoch, kind: prepared.kind, validUntil: frame.validUntil, metadataLo: prepared.digest.lo, metadataHi: prepared.digest.hi, assetMask: frame.assetMask, requiredClass: 2n, descriptor: prepared.descriptor })
  assertCurrent()
  checkEnrollment(enrollment, prepared.signals)
  const proof = enrollment.proof, publicSignals = [...enrollment.publicSignals]
  const signature = await args.signTypedData(prepared.typedData)
  assertCurrent()
  checkSignature(signature)
  if (!await verifyTypedData({ ...prepared.typedData, address: frame.owner, signature })) throw new Error("Owner signature could not authorize receiving.")
  assertCurrent()
  return { scheme: "native-receiving-v4", descriptor: String(prepared.descriptor), spendPublicKey: A, viewPublicKey: V, proof, publicSignals, signature }
}

// The host supplies the original frame/domain and pinned genuine verifier, not payer JSON.
export async function verifyReceivingPublicationV4(args: { frame: RecipientPublication; domain: Domain; authorization: unknown; verifyEnrollment(proof: Hex, signals: string[]): Promise<boolean> }) {
  const frame = Object.freeze({ ...args.frame }), domain = Object.freeze({ ...args.domain }), value = args.authorization as Authorization
  if (!value || Object.keys(value).sort().join(",") !== "descriptor,proof,publicSignals,scheme,signature,spendPublicKey,viewPublicKey" || value.scheme !== "native-receiving-v4" || !Array.isArray(value.spendPublicKey) || !Array.isArray(value.viewPublicKey) || !Array.isArray(value.publicSignals)) throw new Error("Unknown receiving authorization.")
  const authorization = { ...value, spendPublicKey: [...value.spendPublicKey] as Point, viewPublicKey: [...value.viewPublicKey] as Point, publicSignals: [...value.publicSignals] }
  const prepared = await opening(frame, domain, authorization.spendPublicKey, authorization.viewPublicKey)
  if (decimal(authorization.descriptor) !== prepared.descriptor) throw new Error("Receiving descriptor changed.")
  checkEnrollment(authorization, prepared.signals); checkSignature(authorization.signature)
  if (await verifyTypedData({ ...prepared.typedData, address: frame.owner, signature: authorization.signature }) !== true || await args.verifyEnrollment(authorization.proof, [...prepared.signals]) !== true) throw new Error("Receiving authorization could not be verified.")
  return { authorizationDigest: hashTypedData(prepared.typedData), descriptor: String(prepared.descriptor), leaf: prepared.signals[0] }
}
