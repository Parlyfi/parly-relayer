import { createHash, randomBytes as nodeRandomBytes } from "node:crypto"
import { createRequire } from "node:module"
import {
  buildPayoutV5RelayerCheckpointMessage,
  buildPayoutV5RelayerDownstreamListMessage,
  buildPayoutV5RelayerJobListMessage,
  buildPayoutV5RelayerLeaseClaimMessage,
  PAYOUT_V5_EXECUTION_STEPS,
  type CanonicalRelayExecutionPayload,
  type PayoutV5ExecutionStep
} from "@parly/shared-types"
import { getAddress, isAddress, keccak256, toHex, type Address, type Hex } from "viem"
import type { PrivateKeyAccount } from "viem/accounts"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default
const HASH_RE = /^0x[a-fA-F0-9]{64}$/u
const NONCE_RE = /^[A-Za-z0-9_-]{24,128}$/u

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type PayoutV5ExecutionPreparation = {
    payoutId: string
    intentHash: Hex
    quoteHash: Hex
    intent: Record<string, unknown>
    payoutSignature: Hex
    destinationRecipient: Address
    providerData: Hex
    relayRequestId: string
    executorFee: string
    poolPayload: CanonicalRelayExecutionPayload
}

type PayoutV5ExecutionPayloadBase = {
  poolCall: Hex
  lease: {
    intentHash: Hex
    adapter: Address
    pool: Address
    callHash: Hex
    operator: Address
    token: Address
    maximumExecutorFee: string
    nonce: Hex
    expiry: string
  }
  leaseSignature: Hex
  leaseToken: string
}

export type PayoutV5SingleExecutionPayload = PayoutV5ExecutionPayloadBase & {
  preparation: PayoutV5ExecutionPreparation
}

export type PayoutV5BatchExecutionPayload = PayoutV5ExecutionPayloadBase & {
  preparations: PayoutV5ExecutionPreparation[]
}

export type PayoutV5ExecutionPayload = PayoutV5SingleExecutionPayload | PayoutV5BatchExecutionPayload

export type PayoutV5AuthorityClientConfig =
  | { enabled: false; reason: "phase3_payout_v5_relayer_worker_disabled" }
  | { enabled: true; apiBaseUrl: string; boxPrivateKeyB64: string }

function apiBaseUrl(value: string | undefined) {
  const raw = value?.trim()
  if (!raw) throw new Error("PHASE3_PAYOUT_V5_WEB_API_BASE_URL is required for V5 payout execution.")
  const url = new URL(raw)
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  if (url.protocol !== "https:" && !local) throw new Error("PHASE3_PAYOUT_V5_WEB_API_BASE_URL must use HTTPS outside local development.")
  return url.toString()
}

function boxKey(value: string | undefined) {
  const encoded = value?.trim()
  if (!encoded) throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 is required for V5 payout execution.")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 must be a canonical 32-byte base64 key.")
  return encoded
}

export function readPayoutV5AuthorityClientConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): PayoutV5AuthorityClientConfig {
  if (env.PHASE3_PAYOUT_V5_RELAYER_WORKER_ENABLED !== "true") return { enabled: false, reason: "phase3_payout_v5_relayer_worker_disabled" }
  return {
    enabled: true,
    apiBaseUrl: apiBaseUrl(env.PHASE3_PAYOUT_V5_WEB_API_BASE_URL),
    boxPrivateKeyB64: boxKey(env.RELAYER_BOX_PRIVATE_KEY_B64)
  }
}

function requestFields(account: PrivateKeyAccount, nowSeconds = () => Date.now() / 1000, randomBytes = nodeRandomBytes) {
  const timestamp = Math.floor(nowSeconds())
  const nonce = randomBytes(32).toString("base64url")
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !NONCE_RE.test(nonce)) throw new Error("V5 relayer request is invalid.")
  return { executionAddress: account.address.toLowerCase() as Address, timestamp, nonce }
}

async function openSealed(sealedB64: string, privateKeyB64: string) {
  await sodium.ready
  const privateKey = sodium.from_base64(privateKeyB64, sodium.base64_variants.ORIGINAL)
  const publicKey = sodium.crypto_scalarmult_base(privateKey)
  const sealed = sodium.from_base64(sealedB64, sodium.base64_variants.ORIGINAL)
  const opened = sodium.crypto_box_seal_open(sealed, publicKey, privateKey)
  if (!opened) throw new Error("V5 payout execution package is unavailable.")
  return JSON.parse(Buffer.from(opened).toString("utf8")) as unknown
}

function executionPayload(value: unknown, intentHash: Hex, executionAddress: Address): PayoutV5ExecutionPayload {
  if (!value || typeof value !== "object") throw new Error("V5 payout execution package is invalid.")
  const payload = value as PayoutV5ExecutionPayload
  if (!HASH_RE.test(payload.lease?.intentHash) ||
      !isAddress(payload.lease.operator) || getAddress(payload.lease.operator) !== getAddress(executionAddress) ||
      !/^0x(?:[a-fA-F0-9]{2})+$/u.test(payload.poolCall) ||
      !/^0x[a-fA-F0-9]{130}$/u.test(payload.leaseSignature) ||
      !NONCE_RE.test(payload.leaseToken)) {
    throw new Error("V5 payout execution package is invalid.")
  }
  if (keccak256(payload.poolCall).toLowerCase() !== payload.lease.callHash.toLowerCase()) {
    throw new Error("V5 payout execution package binding is invalid.")
  }
  if ("preparation" in payload) {
    const preparation = payload.preparation
    const binding = preparation.poolPayload?.payoutV5
    if (payload.lease.intentHash.toLowerCase() !== intentHash.toLowerCase() ||
        preparation.intentHash?.toLowerCase() !== intentHash.toLowerCase() || !HASH_RE.test(preparation.quoteHash) ||
        typeof preparation.relayRequestId !== "string" || !preparation.relayRequestId.trim() ||
        preparation.relayRequestId.length > 512 || /[\r\n]/u.test(preparation.relayRequestId) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(preparation.executorFee) ||
        !binding || binding.intentHash.toLowerCase() !== intentHash.toLowerCase() ||
        getAddress(binding.adapter) !== getAddress(payload.lease.adapter) ||
        getAddress(binding.withdrawalExecutor) === getAddress(payload.lease.adapter) ||
        getAddress(preparation.poolPayload.pool) !== getAddress(payload.lease.pool) ||
        getAddress(binding.escrow) !== getAddress(String(preparation.intent.escrow)) ||
        String(binding.amountIn) !== String(preparation.intent.amountIn) ||
        binding.executorFee !== payload.lease.maximumExecutorFee) {
      throw new Error("V5 payout execution package binding is invalid.")
    }
    return payload
  }
  const preparations = payload.preparations
  const poolPayload = preparations[0]?.poolPayload
  const bindings = poolPayload?.payoutV5Batch
  const batchGroupHash = bindings
    ? keccak256(toHex(`parly-payout-v5-batch:${bindings.map((binding) => binding.intentHash.toLowerCase()).join(":")}`)).toLowerCase()
    : ""
  if (!bindings || preparations.length < 2 || preparations.length > 10 || bindings.length !== preparations.length ||
      batchGroupHash !== payload.lease.intentHash.toLowerCase() ||
      (intentHash.toLowerCase() !== batchGroupHash && !bindings.some((binding) => binding.intentHash.toLowerCase() === intentHash.toLowerCase())) ||
      getAddress(poolPayload.pool) !== getAddress(payload.lease.pool) ||
      bindings.reduce((total, binding) => total + BigInt(binding.executorFee), 0n).toString() !== payload.lease.maximumExecutorFee) {
    throw new Error("V5 payout batch execution package binding is invalid.")
  }
  const byIntent = new Map(preparations.map((preparation) => [preparation.intentHash.toLowerCase(), preparation]))
  if (bindings.some((binding) => {
    const preparation = byIntent.get(binding.intentHash.toLowerCase())
    return !preparation || !HASH_RE.test(preparation.quoteHash) || preparation.quoteHash.toLowerCase() !== binding.intentHash.toLowerCase() ||
      typeof preparation.relayRequestId !== "string" || !preparation.relayRequestId.trim() ||
      preparation.relayRequestId.length > 512 || /[\r\n]/u.test(preparation.relayRequestId) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(preparation.executorFee) ||
      getAddress(binding.adapter) !== getAddress(payload.lease.adapter) ||
      getAddress(binding.withdrawalExecutor) === getAddress(payload.lease.adapter) ||
      getAddress(binding.escrow) !== getAddress(String(preparation.intent.escrow)) ||
      String(binding.amountIn) !== String(preparation.intent.amountIn) ||
      JSON.stringify(preparation.poolPayload) !== JSON.stringify(poolPayload)
  })) {
    throw new Error("V5 payout batch execution package binding is invalid.")
  }
  return payload
}

export async function listPayoutV5ReadyJobs(args: {
  config: Extract<PayoutV5AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  fetchImpl?: FetchLike
}) {
  const request = requestFields(args.account)
  const signature = await args.account.signMessage({ message: buildPayoutV5RelayerJobListMessage(request) })
  const response = await (args.fetchImpl ?? fetch)(new URL("/api/phase3/payout-v5/relayer/jobs", args.config.apiBaseUrl).toString(), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, signature })
  })
  if (!response.ok) throw new Error("V5 payout ready jobs are unavailable.")
  const body = await response.json() as { jobs?: unknown }
  if (!Array.isArray(body.jobs)) throw new Error("V5 payout ready jobs are unavailable.")
  return body.jobs.flatMap((job) => {
    if (!job || typeof job !== "object") return []
    const value = job as Record<string, unknown>
    return typeof value.intentHash === "string" && HASH_RE.test(value.intentHash) && typeof value.supportReference === "string"
      ? [{ intentHash: value.intentHash.toLowerCase() as Hex, supportReference: value.supportReference }]
      : []
  })
}

export async function claimPayoutV5Execution(args: {
  config: Extract<PayoutV5AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  intentHash: Hex
  fetchImpl?: FetchLike
  openSealedImpl?: (sealedB64: string, privateKeyB64: string) => Promise<unknown>
}) {
  if (!HASH_RE.test(args.intentHash)) throw new Error("V5 intent hash must be bytes32.")
  const request = { ...requestFields(args.account), intentHash: args.intentHash.toLowerCase() as Hex }
  const signature = await args.account.signMessage({ message: buildPayoutV5RelayerLeaseClaimMessage(request) })
  const response = await (args.fetchImpl ?? fetch)(new URL("/api/phase3/payout-v5/relayer/claim", args.config.apiBaseUrl).toString(), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, signature })
  })
  if (!response.ok) throw new Error("V5 payout execution lease is unavailable.")
  const body = await response.json() as Record<string, unknown>
  if (typeof body.intentHash !== "string" || body.intentHash.toLowerCase() !== request.intentHash ||
      typeof body.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(body.leaseExpiresAt)) ||
      typeof body.executionPayloadSealedB64 !== "string") throw new Error("V5 payout execution lease is unavailable.")
  const opened = await (args.openSealedImpl ?? openSealed)(body.executionPayloadSealedB64, args.config.boxPrivateKeyB64)
  return { intentHash: request.intentHash, leaseExpiresAt: body.leaseExpiresAt, payload: executionPayload(opened, request.intentHash, args.account.address) }
}

export async function listPayoutV5DownstreamJobs(args: {
  config: Extract<PayoutV5AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  fetchImpl?: FetchLike
  openSealedImpl?: (sealedB64: string, privateKeyB64: string) => Promise<unknown>
}) {
  const request = requestFields(args.account)
  const signature = await args.account.signMessage({ message: buildPayoutV5RelayerDownstreamListMessage(request) })
  const response = await (args.fetchImpl ?? fetch)(new URL("/api/phase3/payout-v5/relayer/downstream", args.config.apiBaseUrl).toString(), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, signature })
  })
  if (!response.ok) throw new Error("V5 payout downstream jobs are unavailable.")
  const body = await response.json() as { jobs?: unknown }
  if (!Array.isArray(body.jobs)) throw new Error("V5 payout downstream jobs are unavailable.")
  const jobs = []
  for (const job of body.jobs) {
    if (!job || typeof job !== "object") throw new Error("V5 payout downstream job is invalid.")
    const value = job as Record<string, unknown>
    if (typeof value.intentHash !== "string" || !HASH_RE.test(value.intentHash) ||
        typeof value.submissionTransactionHash !== "string" || !HASH_RE.test(value.submissionTransactionHash) ||
        typeof value.executionPayloadSealedB64 !== "string") {
      throw new Error("V5 payout downstream job is invalid.")
    }
    const intentHash = value.intentHash.toLowerCase() as Hex
    const opened = await (args.openSealedImpl ?? openSealed)(value.executionPayloadSealedB64, args.config.boxPrivateKeyB64)
    jobs.push({
      intentHash,
      submissionTransactionHash: value.submissionTransactionHash.toLowerCase() as Hex,
      payload: executionPayload(opened, intentHash, args.account.address)
    })
  }
  return jobs
}

export async function recordPayoutV5Checkpoint(args: {
  config: Extract<PayoutV5AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  intentHash: Hex
  step: PayoutV5ExecutionStep
  transactionHash: Hex
  fetchImpl?: FetchLike
}) {
  if (!HASH_RE.test(args.intentHash) || !HASH_RE.test(args.transactionHash) || !PAYOUT_V5_EXECUTION_STEPS.includes(args.step)) {
    throw new Error("V5 payout checkpoint is invalid.")
  }
  const checkpoint = {
    ...requestFields(args.account), intentHash: args.intentHash.toLowerCase() as Hex,
    step: args.step, transactionHash: args.transactionHash.toLowerCase() as Hex,
    evidenceHash: createHash("sha256").update(args.transactionHash.toLowerCase()).digest("hex")
  }
  const signature = await args.account.signMessage({ message: buildPayoutV5RelayerCheckpointMessage(checkpoint) })
  const response = await (args.fetchImpl ?? fetch)(new URL("/api/phase3/payout-v5/relayer/checkpoint", args.config.apiBaseUrl).toString(), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...checkpoint, signature })
  })
  if (!response.ok) throw new Error("V5 payout checkpoint is unavailable.")
  return response.json()
}
