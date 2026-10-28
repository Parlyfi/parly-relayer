// Unactivated version99 candidate; active publication signatures and package exports are unchanged.
export type RecipientPublication = {
  version: 99
  origin: string
  chainId: bigint
  registry: `0x${string}`
  owner: `0x${string}`
  kind: "invoice" | "profile"
  slug: string
  publicationId: string
  metadataHash: `0x${string}`
  recipientRecoveryKeyHash: `0x${string}`
  nonce: bigint
  epoch: bigint
  validUntil: bigint
  assetMask: bigint
}

const fields = ["assetMask", "chainId", "epoch", "kind", "metadataHash", "nonce", "origin", "owner",
  "publicationId", "recipientRecoveryKeyHash", "registry", "slug", "validUntil", "version"].join(",")

export function encodeRecipientPublication(input: RecipientPublication): Uint8Array {
  const p = { ...input }
  if (!input || Object.keys(p).sort().join(",") !== fields || p.version !== 99 ||
      (p.kind !== "invoice" && p.kind !== "profile") || typeof p.slug !== "string" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(p.slug)) {
    throw new Error("Invalid original publication fields.")
  }
  const origin = new URL(p.origin)
  if (origin.protocol !== "https:" || origin.origin !== p.origin || origin.username || origin.password) {
    throw new Error("Original publication origin must be canonical HTTPS.")
  }
  const id = `privacy-link:${p.kind}:${p.slug}:`
  if (typeof p.publicationId !== "string" || !p.publicationId.startsWith(id) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.publicationId.slice(id.length))) {
    throw new Error("Original publication identity must match its kind and slug.")
  }
  for (const key of ["chainId", "nonce", "epoch", "validUntil"] as const) {
    if (typeof p[key] !== "bigint" || p[key] < (key === "nonce" ? 0n : 1n) || p[key] >= 1n << 64n) {
      throw new Error("Invalid original publication integer.")
    }
  }
  if (typeof p.assetMask !== "bigint" || p.assetMask < 1n || p.assetMask > 7n) {
    throw new Error("Invalid original publication assets.")
  }
  for (const [key, bytes] of [["registry", 20], ["owner", 20], ["metadataHash", 32], ["recipientRecoveryKeyHash", 32]] as const) {
    if (typeof p[key] !== "string" || !new RegExp(`^0x[a-fA-F0-9]{${bytes * 2}}$`).test(p[key]) || BigInt(p[key]) === 0n) {
      throw new Error("Invalid original publication address or hash.")
    }
  }
  // Descriptor is excluded: it commits to this digest, so including it would be circular.
  return new TextEncoder().encode(JSON.stringify(["Parly receiving publication", 99, p.origin,
    p.chainId.toString(), p.registry.toLowerCase(), p.owner.toLowerCase(), p.kind, p.slug,
    p.publicationId, p.metadataHash.toLowerCase(), p.recipientRecoveryKeyHash.toLowerCase(),
    p.nonce.toString(), p.epoch.toString(), p.validUntil.toString(), p.assetMask.toString(), 2]))
}

export async function hashRecipientPublication(input: RecipientPublication) {
  const encoded = encodeRecipientPublication(input)
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded as BufferSource))
  let value = 0n
  for (const byte of hash) value = (value << 8n) | BigInt(byte)
  return { hash, lo: value & ((1n << 128n) - 1n), hi: value >> 128n }
}
