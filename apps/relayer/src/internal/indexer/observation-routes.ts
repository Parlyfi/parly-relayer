import type { Address } from "viem"
import { assertPhase3AttemptDomain, type Phase3AttemptDomain, type Phase3LiveFeederAttempt } from "./live-feeder.js"

export type Phase3PoolRoute = { token: Address; pool: Address; assetId: number; circuitVersion: number }
type RouteConfig = Phase3AttemptDomain & {
  supportedTokens: readonly Address[]
  poolCircuitVersion: number
  poolRoutes: readonly Phase3PoolRoute[]
}
const validAddress = (value: unknown): value is Address => typeof value === "string" &&
  /^0x[a-fA-F0-9]{40}$/u.test(value) && !/^0x0{40}$/iu.test(value)

export function validatePhase3PoolRoutes(config: RouteConfig) {
  const { poolRoutes: routes, supportedTokens: tokens, poolCircuitVersion: version } = config
  if (!Array.isArray(routes) || !routes.length || routes.length > 3 || !Array.isArray(tokens) ||
      routes.length !== tokens.length || !Number.isInteger(version) || version < 1 || version > 255 ||
      tokens.some(token => !validAddress(token))) throw new Error("invalid pool route configuration")
  const tokenSet = new Set(tokens.map(token => token.toLowerCase()))
  const pools = new Set<string>(), assets = new Set<number>(), seenTokens = new Set<string>()
  if (tokenSet.size !== tokens.length) throw new Error("duplicate pool route token")
  for (const route of routes) {
    if (!route || !validAddress(route.token) || !validAddress(route.pool) ||
        !Number.isInteger(route.assetId) || route.assetId < 1 || route.assetId > 3 ||
        route.circuitVersion !== version || !tokenSet.has(route.token.toLowerCase()) ||
        seenTokens.has(route.token.toLowerCase()) || pools.has(route.pool.toLowerCase()) || assets.has(route.assetId)) {
      throw new Error("invalid or duplicate pool route binding")
    }
    seenTokens.add(route.token.toLowerCase()); pools.add(route.pool.toLowerCase()); assets.add(route.assetId)
  }
  return routes
}

export function assertPhase3AttemptPoolRoute(attempt: Phase3LiveFeederAttempt, config: RouteConfig) {
  assertPhase3AttemptDomain(attempt, config)
  const route = validatePhase3PoolRoutes(config).find(route => route.token.toLowerCase() === attempt.expectedToken.toLowerCase())
  if (!route || !validAddress(attempt.poolAddress) || route.pool.toLowerCase() !== attempt.poolAddress.toLowerCase() ||
      BigInt(route.assetId) !== attempt.assetId) throw new Error("retained attempt pool route binding mismatch")
}

export async function assertPhase3PoolRouteReadiness(config: RouteConfig, receiver: Address, snap: {
  read(target: Address, functionName: string, args?: readonly unknown[]): Promise<unknown>
  masterRead(functionName: string, args?: readonly unknown[]): Promise<unknown>
}) {
  const equal = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
  for (const route of validatePhase3PoolRoutes(config)) {
    if (await snap.masterRead("approvedTokens", [route.token]) !== true ||
        await snap.read(receiver, "approvedTokens", [route.token]) !== true ||
        await snap.read(receiver, "approvedPools", [route.pool]) !== true) throw new Error("token route unavailable")
    for (const [name, expected] of [
      ["underlyingToken", route.token], ["assetId", route.assetId], ["circuitVersion", route.circuitVersion],
      ...route.circuitVersion === 4
        ? [["settlementDomain", config.settlementDomainId], ["receiver", receiver], ["master", config.masterAddress]] as const
        : [["settlementDomainId", config.settlementDomainId], ["ingressReceiver", receiver]] as const
    ] as const) {
      if (!equal(await snap.read(route.pool, name), expected)) throw new Error("live pool route binding mismatch")
    }
  }
}
