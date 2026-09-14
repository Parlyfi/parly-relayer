export type EnvLike = Record<string, string | undefined>

export function requireEnv(name: string, env: EnvLike = process.env): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} missing`)
  }
  return value
}

function requirePositiveNumber(raw: string | undefined, name: string, label: string): number {
  const value = Number(raw ?? "")
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a ${label}.`)
  }
  return value
}

export function requirePositiveInt(name: string, env: EnvLike = process.env): number {
  return requirePositiveNumber(env[name], name, "positive integer")
}

export function requirePositiveChainId(name: string, env: EnvLike = process.env): number {
  return requirePositiveNumber(env[name], name, "positive integer chain ID")
}

export function requirePositiveEid(name: string, env: EnvLike = process.env): number {
  return requirePositiveNumber(env[name], name, "positive LayerZero EID")
}

export function requirePositiveIntValue(raw: string | undefined, name: string): number {
  return requirePositiveNumber(raw, name, "positive integer")
}

export function requirePositiveChainIdValue(raw: string | undefined, name: string): number {
  return requirePositiveNumber(raw, name, "positive integer chain ID")
}

export function requirePositiveEidValue(raw: string | undefined, name: string): number {
  return requirePositiveNumber(raw, name, "positive LayerZero EID")
}
