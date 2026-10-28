type Hex = `0x${string}`
export type ReceivingProfileV4 = {
  version: 4; chainId: 4217 | 42431; settlementDomain: bigint; environment: Hex; virtualMasterId: Hex; origin: string
  registry: Hex; verifier: Hex; master: Hex; receiver: Hex; hasher: Hex
  owner: Hex; treasury: Hex; preparationAuthority: Hex
  proofs: Record<"enrollment" | "shield" | "publication" | "membership" | "spend", Hex>
  assets: { assetId: 1 | 2 | 3; token: Hex; pool: Hex; policyId: bigint; sourceChainIds: bigint[] }[]
  codePins: { address: Hex; codeHash: Hex }[]
}
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: V4 receiving profile") }
const keys = (v: unknown, expected: string) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === expected
const address = (v: unknown): v is Hex => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v) && BigInt(v) !== 0n
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x[a-f0-9]{64}$/.test(v) && BigInt(v) !== 0n
const uint64 = (v: unknown): v is bigint => typeof v === "bigint" && v >= 0n && v < 1n << 64n
export function assertReceivingProfileV4(value: unknown): asserts value is ReceivingProfileV4 {
  check(keys(value, "assets,chainId,codePins,environment,hasher,master,origin,owner,preparationAuthority,proofs,receiver,registry,settlementDomain,treasury,verifier,version,virtualMasterId"))
  const p = value as ReceivingProfileV4
  check(p.version === 4 && [4217, 42431].includes(p.chainId) && uint64(p.settlementDomain) && p.settlementDomain > 0n && hash(p.environment) && /^0x[a-f0-9]{8}$/.test(p.virtualMasterId) && BigInt(p.virtualMasterId) !== 0n)
  const origin = new URL(p.origin)
  check(origin.protocol === "https:" && origin.origin === p.origin && !origin.username && !origin.password)
  check(keys(p.proofs, "enrollment,membership,publication,shield,spend") && Array.isArray(p.assets) && p.assets.length > 0 && p.assets.length <= 3 && Array.isArray(p.codePins) && p.codePins.length <= 64)
  const pins = new Set<string>()
  for (const pin of p.codePins) { check(keys(pin, "address,codeHash") && address(pin.address) && hash(pin.codeHash) && !pins.has(pin.address.toLowerCase())); pins.add(pin.address.toLowerCase()) }
  for (const a of [p.registry, p.verifier, p.master, p.receiver, p.hasher, ...Object.values(p.proofs)]) check(address(a) && pins.has(a.toLowerCase()))
  for (const a of [p.owner, p.treasury, p.preparationAuthority]) check(address(a))
  const ids = new Set<number>(), tokens = new Set<string>(), pools = new Set<string>()
  for (const a of p.assets) {
    check(keys(a, "assetId,policyId,pool,sourceChainIds,token") && [1, 2, 3].includes(a.assetId) && !ids.has(a.assetId) && uint64(a.policyId) && address(a.token) && address(a.pool) && !tokens.has(a.token.toLowerCase()) && !pools.has(a.pool.toLowerCase()))
    check(pins.has(a.token.toLowerCase()) && pins.has(a.pool.toLowerCase()) && Array.isArray(a.sourceChainIds) && a.sourceChainIds.length > 0 && a.sourceChainIds.every(id => uint64(id) && id > 0n) && new Set(a.sourceChainIds).size === a.sourceChainIds.length)
    ids.add(a.assetId); tokens.add(a.token.toLowerCase()); pools.add(a.pool.toLowerCase())
  }
}
export function parseReceivingProfileV4(raw: string): ReceivingProfileV4 {
  check(typeof raw === "string" && raw.length > 0 && raw.length <= 32768)
  const p = JSON.parse(raw), integer = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v)
  check(integer(p.settlementDomain) && Array.isArray(p.assets)); p.settlementDomain = BigInt(p.settlementDomain)
  for (const a of p.assets) { check(a && integer(a.policyId) && Array.isArray(a.sourceChainIds) && a.sourceChainIds.every(integer)); a.policyId = BigInt(a.policyId); a.sourceChainIds = a.sourceChainIds.map(BigInt) }
  assertReceivingProfileV4(p); return p
}
export function receivingProfileJsonV4(profile: ReceivingProfileV4) {
  assertReceivingProfileV4(profile)
  const stable = (v: unknown): unknown => typeof v === "bigint" ? String(v) : Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v
  return JSON.stringify(stable(profile))
}
