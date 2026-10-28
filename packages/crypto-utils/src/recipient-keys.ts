// Local construction candidate; active wallet recovery and package exports are unchanged.
export type RecipientKeyContext = {
  version: 1
  walletAddress: `0x${string}`
  environment: "development" | "staging" | "mainnet"
  origin: string
}

const SUBGROUP_ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n
const encoder = new TextEncoder()

export async function deriveRecipientKeys(privateRoot: Uint8Array, context: RecipientKeyContext) {
  if (!(privateRoot instanceof Uint8Array) || privateRoot.length !== 32) {
    throw new Error("Recipient derivation requires a private 32-byte root.")
  }
  // Keep the validated primitive context stable across asynchronous derivation.
  context = { ...context }
  if (!context || Object.keys(context).sort().join(",") !== "environment,origin,version,walletAddress" ||
      context.version !== 1 || !["development", "staging", "mainnet"].includes(context.environment) ||
      typeof context.walletAddress !== "string" || typeof context.origin !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(context.walletAddress) || /^0x0{40}$/.test(context.walletAddress)) {
    throw new Error("Invalid recipient key context.")
  }
  const origin = new URL(context.origin)
  if (origin.origin !== context.origin || origin.username || origin.password ||
      (origin.protocol !== "https:" && !(context.environment === "development" && origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("Recipient key origin must be canonical and secure.")
  }
  const root = new Uint8Array(privateRoot)
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey("raw", root, "HKDF", false, ["deriveBits"])
  } finally {
    root.fill(0)
  }
  const deriveBytes = async (role: string, counter: number) => new Uint8Array(await crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt: encoder.encode("Parly recipient private keys v1"),
    info: encoder.encode(JSON.stringify(["Parly recipient private keys", 1, context.walletAddress.toLowerCase(), context.environment, context.origin, role, counter]))
  }, key, 256))
  const deriveScalar = async (role: string) => {
    for (let counter = 0; counter < 256; counter++) {
      const bytes = await deriveBytes(role, counter)
      bytes[31] &= 7
      const scalar = bytes.reduceRight((value, byte) => (value << 8n) + BigInt(byte), 0n)
      bytes.fill(0)
      if (scalar > 0n && scalar < SUBGROUP_ORDER) return scalar
    }
    throw new Error("Recipient scalar derivation exhausted its bounded attempts.")
  }
  const spendScalar = await deriveScalar("spend")
  const viewScalar = await deriveScalar("view")
  if (spendScalar === viewScalar || spendScalar + viewScalar === SUBGROUP_ORDER) {
    throw new Error("Recipient key roles must be distinct.")
  }
  return { spendScalar, viewScalar, sodiumSeed: await deriveBytes("sodium", 0) }
}
