import { createRequire } from "node:module"
import type { PrivateKeyAccount } from "viem/accounts"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default

function relayerRegistryBaseUrl() {
  return String(process.env.RELAYER_REGISTRY_API_BASE_URL || "").trim()
}

async function fetchRegisteredPublicKeyB64(
  baseUrl: string,
  executionAddress: `0x${string}`
) {
  try {
    const endpoint = new URL("/api/relayers", baseUrl).toString()
    const response = await fetch(endpoint)

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      items?: Array<{
        executionAddress?: string
        publicKeyB64?: string
      }>
    }

    const match = payload.items?.find(
      (item) =>
        String(item.executionAddress || "").trim().toLowerCase() ===
        executionAddress.toLowerCase()
    )

    return typeof match?.publicKeyB64 === "string"
      ? match.publicKeyB64.trim()
      : null
  } catch {
    return null
  }
}

async function deriveBoxPublicKeyB64() {
  await sodium.ready

  const privateKeyB64 = String(process.env.RELAYER_BOX_PRIVATE_KEY_B64 || "").trim()
  if (!privateKeyB64) {
    throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 missing")
  }

  const privateKey = sodium.from_base64(privateKeyB64, sodium.base64_variants.ORIGINAL)
  const publicKey = sodium.crypto_scalarmult_base(privateKey)
  return sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL)
}

export async function ensureRelayerRegistryRegistration(account: PrivateKeyAccount) {
  const baseUrl = relayerRegistryBaseUrl()
  if (!baseUrl) {
    return { checked: false as const, reason: "registry_not_configured" as const }
  }

  const currentPublicKeyB64 = await deriveBoxPublicKeyB64()
  const registeredPublicKeyB64 = await fetchRegisteredPublicKeyB64(
    baseUrl,
    account.address
  )

  if (registeredPublicKeyB64 === currentPublicKeyB64) {
    return {
      checked: true as const,
      updated: false as const,
      publicKeyB64: currentPublicKeyB64,
      result: {
        success: true as const,
        status: "verified" as const,
        alreadyCurrent: true as const
      }
    }
  }

  const initEndpoint = new URL("/api/relayers/register/init", baseUrl).toString()
  const initResponse = await fetch(initEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      executionAddress: account.address
    })
  })

  if (!initResponse.ok) {
    throw new Error(`Relayer registration challenge failed with HTTP ${initResponse.status}`)
  }

  const challenge = (await initResponse.json()) as {
    nonce: string
    message: string
  }
  const signature = await account.signMessage({
    message: challenge.message
  })

  const confirmEndpoint = new URL("/api/relayers/register/confirm", baseUrl).toString()
  const confirmResponse = await fetch(confirmEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      executionAddress: account.address,
      publicKeyB64: currentPublicKeyB64,
      signature,
      nonce: challenge.nonce
    })
  })

  if (!confirmResponse.ok) {
    throw new Error(`Relayer registration confirm failed with HTTP ${confirmResponse.status}`)
  }

  const confirmed = await confirmResponse.json()
  return {
    checked: true as const,
    updated: true as const,
    publicKeyB64: currentPublicKeyB64,
    result: confirmed
  }
}
