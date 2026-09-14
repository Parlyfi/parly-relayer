import { isAddress } from "viem"
import type { RelayerRegistryEntry, RelayerRegistryResponse } from "@parly/shared-types"

export type FetchRelayerRegistryOptions = {
  fetchImpl?: typeof fetch
  endpoint?: string
  allowLegacyFallback?: boolean
  legacyRegistryRaw?: string
}

function decodeBase64(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (!trimmed || !/^[A-Za-z0-9+/_=-]+$/.test(trimmed)) {
    return null
  }

  const normalized = trimmed
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(trimmed.length / 4) * 4, "=")

  try {
    const BufferCtor = (globalThis as any).Buffer
    if (BufferCtor) {
      const decoded = BufferCtor.from(normalized, "base64")
      return decoded.length ? new Uint8Array(decoded) : null
    }

    if (typeof (globalThis as any).atob === "function") {
      const binary = (globalThis as any).atob(normalized)
      const out = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i)
      }
      return out
    }
  } catch {
    return null
  }

  return null
}

function encodeOriginalBase64(bytes: Uint8Array): string | null {
  try {
    const BufferCtor = (globalThis as any).Buffer
    if (BufferCtor) {
      return BufferCtor.from(bytes).toString("base64")
    }

    if (typeof (globalThis as any).btoa === "function") {
      let binary = ""
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i])
      }
      return (globalThis as any).btoa(binary)
    }
  } catch {
    return null
  }

  return null
}

function canonicalizeRelayerPublicKeyB64(value: string) {
  const decoded = decodeBase64(value)
  if (!decoded || decoded.length !== 32) {
    return null
  }

  return encodeOriginalBase64(decoded)
}

function normalizeRegistryRow(
  executionAddress: unknown,
  publicKeyB64: unknown
): RelayerRegistryEntry | null {
  const normalizedAddress = String(executionAddress || "").trim().toLowerCase() as `0x${string}`
  if (!isAddress(normalizedAddress)) {
    return null
  }

  const normalizedPublicKey = canonicalizeRelayerPublicKeyB64(String(publicKeyB64 || ""))
  if (!normalizedPublicKey) {
    return null
  }

  return {
    executionAddress: normalizedAddress,
    publicKeyB64: normalizedPublicKey
  }
}

export function parseLegacyRelayerRegistry(raw = ""): RelayerRegistryEntry[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [executionAddress, publicKeyB64] = entry.split(":")
      return normalizeRegistryRow(executionAddress, publicKeyB64)
    })
    .filter((row): row is RelayerRegistryEntry => Boolean(row))
}

export function isLikelyRelayerPublicKey(value: string) {
  return Boolean(canonicalizeRelayerPublicKeyB64(value.trim()))
}

export async function fetchOfficialRelayerRegistry(
  options: FetchRelayerRegistryOptions = {}
): Promise<RelayerRegistryResponse> {
  const fetchImpl = options.fetchImpl || fetch
  const endpoint = options.endpoint || "/api/relayers"

  try {
    const res = await fetchImpl(endpoint, { cache: "no-store" as RequestCache })
    if (!res.ok) {
      throw new Error(`Registry request failed with HTTP ${res.status}`)
    }

    const json = await res.json()
    if (!Array.isArray(json.items)) {
      throw new Error("Registry response malformed")
    }

    const items = json.items
      .map((row: any) => normalizeRegistryRow(row.executionAddress, row.publicKeyB64))
      .filter((row: RelayerRegistryEntry | null): row is RelayerRegistryEntry => Boolean(row))

    return {
      items,
      liveCount: Number(json.liveCount || items.length),
      maxCount: Number(json.maxCount || items.length || 10),
      registryOpen: Boolean(json.registryOpen ?? items.length < Number(json.maxCount || 10))
    }
  } catch (error: any) {
    if (options.allowLegacyFallback) {
      const items = parseLegacyRelayerRegistry(options.legacyRegistryRaw || "")
      return {
        items,
        liveCount: items.length,
        maxCount: 10,
        registryOpen: items.length < 10
      }
    }

    throw new Error(error?.message || "Official relayer registry unavailable")
  }
}
