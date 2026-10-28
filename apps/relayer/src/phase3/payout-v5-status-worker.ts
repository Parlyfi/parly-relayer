import { createHash, randomBytes } from "node:crypto"
import {
  buildPayoutV5RelayObservationMessage,
  type PayoutV5RelayStateCategory
} from "@parly/shared-types"
import { keccak256, toHex, type Hex } from "viem"
import type { PrivateKeyAccount } from "viem/accounts"

import type { PayoutV5AuthorityClientConfig } from "./payout-v5-authority-client.js"

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> }
type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>
const HASH_RE = /^0x[a-fA-F0-9]{64}$/u

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`
}

function collect(value: unknown, key: string, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 8) return []
  if (Array.isArray(value)) return value.flatMap((item) => collect(item, key, depth + 1))
  return Object.entries(value as Record<string, unknown>).flatMap(([name, nested]) => [
    ...(name === key && typeof nested === "string" ? [nested] : []), ...collect(nested, key, depth + 1)
  ])
}

function collectHashArrays(value: unknown, depth = 0): Hex[] {
  if (!value || typeof value !== "object" || depth > 8) return []
  if (Array.isArray(value)) return value.flatMap((item) => collectHashArrays(item, depth + 1))
  return Object.entries(value as Record<string, unknown>).flatMap(([name, nested]) => {
    const direct = (name === "inTxHashes" || name === "txHashes") && Array.isArray(nested)
      ? nested.filter((item): item is Hex => typeof item === "string" && HASH_RE.test(item))
      : []
    return [...direct, ...collectHashArrays(nested, depth + 1)]
  })
}

export function classifyPayoutV5RelayStatus(response: unknown): PayoutV5RelayStateCategory {
  const statuses = [...collect(response, "status"), ...collect(response, "state")]
    .map((value) => value.trim().toLowerCase().replace(/[-\s]+/gu, "_"))
  const success = statuses.some((value) => ["success", "succeeded", "complete", "completed", "fulfilled", "executed"].includes(value))
  const refund = statuses.some((value) => ["refunded", "refund", "refund_available"].includes(value))
  if (success && refund) return "terminal_unresolved"
  if (success) return "destination_candidate"
  if (refund) return "refund_candidate"
  if (statuses.some((value) => ["failure", "failed", "fallback", "reverted", "error", "failed_unrecoverable", "expired", "timeout", "timed_out", "cancelled", "canceled"].includes(value))) {
    return "terminal_unresolved"
  }
  if (statuses.some((value) => ["received", "processing", "in_progress", "executing", "settling", "pending", "waiting", "queued", "created", "incomplete"].includes(value))) {
    return "processing"
  }
  return "terminal_unresolved"
}

export function payoutV5RelayTransactionHashes(response: unknown) {
  return [...new Set(collectHashArrays(response)
    .map((value) => value.toLowerCase() as Hex))].slice(0, 8).sort()
}

export async function observePayoutV5RelayStatus(args: {
  config: Extract<PayoutV5AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  intentHash: Hex
  relayRequestId: string
  fetchImpl?: FetchLike
  now?: () => number
}) {
  const fetchImpl = args.fetchImpl ?? fetch
  const nowSeconds = Math.floor((args.now ?? Date.now)() / 1000)
  const relayUrl = new URL("https://api.relay.link/intents/status/v3")
  relayUrl.searchParams.set("requestId", args.relayRequestId)
  const response = await fetchImpl(relayUrl.toString(), { method: "GET", headers: { accept: "application/json" } })
  if (!response.ok) throw new Error("V5 Relay status provider is unavailable.")
  const body = await response.json()
  if (!body || typeof body !== "object") throw new Error("V5 Relay status response is invalid.")
  const serialized = stable(body)
  const observation = {
    intentHash: args.intentHash.toLowerCase() as Hex,
    executionAddress: args.account.address.toLowerCase() as `0x${string}`,
    requestIdHash: keccak256(toHex(args.relayRequestId)),
    responseHash: createHash("sha256").update(serialized).digest("hex"),
    stateCategory: classifyPayoutV5RelayStatus(body),
    observedAt: nowSeconds,
    transactionHashes: payoutV5RelayTransactionHashes(body),
    timestamp: nowSeconds,
    nonce: randomBytes(32).toString("base64url")
  }
  const signature = await args.account.signMessage({ message: buildPayoutV5RelayObservationMessage(observation) })
  const recorded = await fetchImpl(new URL("/api/phase3/payout-v5/relayer/observation", args.config.apiBaseUrl).toString(), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...observation, signature })
  })
  if (!recorded.ok) throw new Error("V5 Relay status observation was not recorded.")
  return recorded.json()
}
