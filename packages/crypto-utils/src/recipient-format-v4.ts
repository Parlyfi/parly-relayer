// V4 canonical body. Deployment bindings and payment terms are validated by the host and contracts.
export type ReceivingBody = { version: 4 } & Record<
  "chainId" | "sourceChainId" | "settlementDomain" | "assetId" | "commitment" | "ephemeralX" | "ephemeralY" |
  "binding" | "principal" | "expectedAmount" | "maxFinalizerFee" | "expiresAt", bigint
> & Record<"registry" | "pool" | "master" | "receiver" | "token" | "attemptId" | "sourceRouteHash" |
  "refundWalletCommitment" | "payloadHash", `0x${string}`>

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const schema = [
  ["chainId", 8, "integer"], ["sourceChainId", 8, "integer"], ["settlementDomain", 8, "integer"],
  ["registry", 20, "hex"], ["pool", 20, "hex"], ["master", 20, "hex"], ["receiver", 20, "hex"], ["token", 20, "hex"],
  ["assetId", 4, "integer"], ["attemptId", 32, "hex"], ["sourceRouteHash", 32, "hex"], ["refundWalletCommitment", 32, "hex"],
  ["commitment", 32, "field"], ["ephemeralX", 32, "field"], ["ephemeralY", 32, "field"], ["binding", 32, "field"],
  ["principal", 16, "integer"], ["expectedAmount", 16, "integer"], ["maxFinalizerFee", 16, "integer"],
  ["expiresAt", 8, "integer"], ["payloadHash", 32, "hex"]
] as const
const keys = ["version", ...schema.map(([name]) => name)].sort().join(",")
const length = 3 + schema.reduce((total, [, bytes]) => total + bytes, 0)

export function encodeReceivingBody(body: ReceivingBody): Uint8Array {
  if (!body || body.version !== 4 || Object.keys(body).sort().join(",") !== keys) {
    throw new Error("Unknown receiving body version or fields.")
  }
  if (![1n, 2n, 3n].includes(body.assetId)) throw new Error("Invalid receiving asset.")
  const bytes = new Uint8Array(length)
  bytes.set([0x50, 0x52, 4])
  let offset = 3
  for (const [name, size, kind] of schema) {
    const input = body[name]
    let value: bigint
    if (kind === "hex") {
      if (typeof input !== "string" || !new RegExp(`^0x[a-fA-F0-9]{${size * 2}}$`).test(input)) {
        throw new Error(`Invalid ${name} encoding.`)
      }
      value = BigInt(input)
    } else {
      if (typeof input !== "bigint") throw new Error(`Canonical integer required for ${name}.`)
      value = input
    }
    const bound = kind === "field" ? FIELD_PRIME : 1n << BigInt(size * 8)
    if (value < 0n || value >= bound || (value === 0n && name !== "maxFinalizerFee")) {
      throw new Error(`Invalid ${name} range.`)
    }
    for (let i = size - 1; i >= 0; i--) {
      bytes[offset + i] = Number(value & 255n)
      value >>= 8n
    }
    offset += size
  }
  return bytes
}

export function decodeReceivingBody(bytes: Uint8Array): ReceivingBody {
  if (!(bytes instanceof Uint8Array) || bytes.length !== length || bytes[0] !== 0x50 || bytes[1] !== 0x52 || bytes[2] !== 4) {
    throw new Error("Invalid receiving body length or version.")
  }
  const body: Record<string, unknown> = { version: 4 }
  let offset = 3
  for (const [name, size, kind] of schema) {
    let value = 0n
    for (const byte of bytes.subarray(offset, offset + size)) value = (value << 8n) + BigInt(byte)
    body[name] = kind === "hex" ? `0x${value.toString(16).padStart(size * 2, "0")}` : value
    offset += size
  }
  const result = body as ReceivingBody
  encodeReceivingBody(result)
  return result
}

export async function hashReceivingBody(body: ReceivingBody) {
  const bytes = new Uint8Array(encodeReceivingBody(body))
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  let value = 0n
  for (const byte of hash) value = (value << 8n) + BigInt(byte)
  return { hash, lo: value & ((1n << 128n) - 1n), hi: value >> 128n }
}
