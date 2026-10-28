import { randomBytes as nodeRandomBytes } from "node:crypto"
import { createRequire } from "node:module"
import {
  buildPayoutV4RelayerCheckpointMessage,
  buildPayoutV4RelayerAuthorityClaimMessage,
  PAYOUT_V4_EXECUTION_STEPS,
  type PayoutV4ExecutionStep,
  type PayoutV4RelayerAuthorityClaimMessageInput
} from "@parly/shared-types"
import { isAddress, type Hex } from "viem"
import type { PrivateKeyAccount } from "viem/accounts"

import type { PayoutV4RelayerAuthorityPayload } from "./index.js"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/u
const NONCE_RE = /^[A-Za-z0-9_-]{24,128}$/u

type AuthorityClaimResponse = {
  intentHash?: unknown
  leaseExpiresAt?: unknown
  authorityPayloadSealedB64?: unknown
}

type FetchLike = (input: string, init: RequestInit) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export type PayoutV4RelayerAuthorityClientConfig =
  | { enabled: false; reason: "phase3_payout_v4_relayer_worker_disabled" }
  | { enabled: true; apiBaseUrl: string; boxPrivateKeyB64: string }

function readApiBaseUrl(value: string | undefined) {
  const raw = value?.trim()
  if (!raw) throw new Error("PHASE3_PAYOUT_V4_WEB_API_BASE_URL is required for V4 payout execution.")
  const parsed = new URL(raw)
  const localHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new Error("PHASE3_PAYOUT_V4_WEB_API_BASE_URL must use HTTPS outside local development.")
  }
  return parsed.toString()
}

function readBoxPrivateKey(value: string | undefined) {
  const encoded = value?.trim()
  if (!encoded) throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 is required for V4 payout execution.")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 must be a canonical 32-byte base64 key.")
  }
  return encoded
}

export function readPayoutV4RelayerAuthorityClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV4RelayerAuthorityClientConfig {
  if (env.PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_payout_v4_relayer_worker_disabled" }
  }
  return {
    enabled: true,
    apiBaseUrl: readApiBaseUrl(env.PHASE3_PAYOUT_V4_WEB_API_BASE_URL),
    boxPrivateKeyB64: readBoxPrivateKey(env.RELAYER_BOX_PRIVATE_KEY_B64)
  }
}

function readAuthorityClaimResponse(value: unknown, intentHash: Hex) {
  if (!value || typeof value !== "object") throw new Error("V4 relayer authority claim is unavailable.")
  const body = value as AuthorityClaimResponse
  if (
    typeof body.intentHash !== "string" ||
    !BYTES32_RE.test(body.intentHash) ||
    body.intentHash.toLowerCase() !== intentHash.toLowerCase() ||
    typeof body.leaseExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.leaseExpiresAt)) ||
    typeof body.authorityPayloadSealedB64 !== "string" ||
    body.authorityPayloadSealedB64.length < 32
  ) {
    throw new Error("V4 relayer authority claim is unavailable.")
  }
  return {
    intentHash: body.intentHash.toLowerCase() as Hex,
    leaseExpiresAt: body.leaseExpiresAt,
    authorityPayloadSealedB64: body.authorityPayloadSealedB64
  }
}

function readAuthorityPayload(value: unknown, claim: PayoutV4RelayerAuthorityClaimMessageInput) {
  if (!value || typeof value !== "object") throw new Error("V4 relayer authority payload is invalid.")
  const payload = value as Partial<PayoutV4RelayerAuthorityPayload>
  if (
    payload.version !== 4 ||
    typeof payload.intentHash !== "string" ||
    !BYTES32_RE.test(payload.intentHash) ||
    payload.intentHash.toLowerCase() !== claim.intentHash.toLowerCase() ||
    typeof payload.payoutAuthority !== "string" ||
    !isAddress(payload.payoutAuthority) ||
    payload.payoutAuthority.toLowerCase() !== claim.executionAddress.toLowerCase() ||
    !payload.intent ||
    typeof payload.intent !== "object" ||
    typeof payload.payoutSignature !== "string" ||
    !/^0x[a-fA-F0-9]{130}$/u.test(payload.payoutSignature)
  ) {
    throw new Error("V4 relayer authority payload is invalid.")
  }
  return payload as PayoutV4RelayerAuthorityPayload
}

async function openSealedAuthorityPayload(args: { sealedB64: string; boxPrivateKeyB64: string }) {
  await sodium.ready
  const privateKey = sodium.from_base64(args.boxPrivateKeyB64, sodium.base64_variants.ORIGINAL)
  const publicKey = sodium.crypto_scalarmult_base(privateKey)
  const sealed = sodium.from_base64(args.sealedB64, sodium.base64_variants.ORIGINAL)
  const opened = sodium.crypto_box_seal_open(sealed, publicKey, privateKey)
  if (!opened) throw new Error("V4 relayer authority payload is unavailable.")
  return Buffer.from(opened)
}

export async function claimPayoutV4RelayerAuthority(args: {
  config: Extract<PayoutV4RelayerAuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  intentHash: Hex
  nowSeconds?: () => number
  randomBytes?: (size: number) => Buffer
  fetchImpl?: FetchLike
  openSealed?: (input: { sealedB64: string; boxPrivateKeyB64: string }) => Promise<Buffer>
}) {
  if (!BYTES32_RE.test(args.intentHash)) throw new Error("intentHash must be bytes32.")
  const timestamp = Math.floor((args.nowSeconds ?? (() => Date.now() / 1000))())
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("V4 relayer authority timestamp is invalid.")
  const nonce = (args.randomBytes ?? nodeRandomBytes)(32).toString("base64url")
  if (!NONCE_RE.test(nonce)) throw new Error("V4 relayer authority nonce is invalid.")
  const claim: PayoutV4RelayerAuthorityClaimMessageInput = {
    intentHash: args.intentHash.toLowerCase() as Hex,
    executionAddress: args.account.address.toLowerCase() as `0x${string}`,
    timestamp,
    nonce
  }
  const signature = await args.account.signMessage({ message: buildPayoutV4RelayerAuthorityClaimMessage(claim) })
  const endpoint = new URL("/api/phase3/payout-v4/relayer/claim", args.config.apiBaseUrl).toString()
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...claim, signature })
  })
  if (!response.ok) throw new Error("V4 relayer authority claim is unavailable.")
  const delivery = readAuthorityClaimResponse(await response.json(), claim.intentHash)
  const opened = await (args.openSealed ?? openSealedAuthorityPayload)({
    sealedB64: delivery.authorityPayloadSealedB64,
    boxPrivateKeyB64: args.config.boxPrivateKeyB64
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(opened.toString("utf8"))
  } catch {
    throw new Error("V4 relayer authority payload is invalid.")
  }
  if (!parsed || typeof parsed !== "object" || !("preparation" in parsed) || !("leaseToken" in parsed)) {
    throw new Error("V4 relayer authority payload is invalid.")
  }
  const sealed = parsed as { preparation: unknown; leaseToken: unknown }
  if (typeof sealed.leaseToken !== "string" || sealed.leaseToken.length < 24) {
    throw new Error("V4 relayer authority payload is invalid.")
  }
  return {
    ...delivery,
    authority: readAuthorityPayload(sealed.preparation, claim),
    leaseToken: sealed.leaseToken
  }
}

export async function recordPayoutV4RelayerCheckpoint(args: {
  config: Extract<PayoutV4RelayerAuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  intentHash: Hex
  step: PayoutV4ExecutionStep
  transactionHash: Hex
  nowSeconds?: () => number
  randomBytes?: (size: number) => Buffer
  fetchImpl?: FetchLike
}) {
  if (!BYTES32_RE.test(args.intentHash) || !BYTES32_RE.test(args.transactionHash)) {
    throw new Error("V4 relayer checkpoint hashes must be bytes32.")
  }
  if (!PAYOUT_V4_EXECUTION_STEPS.includes(args.step)) throw new Error("V4 relayer checkpoint step is invalid.")
  const timestamp = Math.floor((args.nowSeconds ?? (() => Date.now() / 1000))())
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("V4 relayer checkpoint timestamp is invalid.")
  const nonce = (args.randomBytes ?? nodeRandomBytes)(32).toString("base64url")
  if (!NONCE_RE.test(nonce)) throw new Error("V4 relayer checkpoint nonce is invalid.")
  const checkpoint = {
    intentHash: args.intentHash.toLowerCase() as Hex,
    executionAddress: args.account.address.toLowerCase() as `0x${string}`,
    step: args.step,
    transactionHash: args.transactionHash.toLowerCase() as Hex,
    timestamp,
    nonce
  }
  const signature = await args.account.signMessage({ message: buildPayoutV4RelayerCheckpointMessage(checkpoint) })
  const endpoint = new URL("/api/phase3/payout-v4/relayer/checkpoint", args.config.apiBaseUrl).toString()
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...checkpoint, signature })
  })
  if (!response.ok) throw new Error("V4 relayer checkpoint is unavailable.")
  const body = (await response.json()) as {
    intentHash?: unknown
    step?: unknown
    transactionHash?: unknown
    recorded?: unknown
  }
  if (
    typeof body.intentHash !== "string" ||
    body.intentHash.toLowerCase() !== checkpoint.intentHash ||
    body.step !== checkpoint.step ||
    typeof body.transactionHash !== "string" ||
    body.transactionHash.toLowerCase() !== checkpoint.transactionHash ||
    typeof body.recorded !== "boolean"
  ) {
    throw new Error("V4 relayer checkpoint is unavailable.")
  }
  return {
    intentHash: checkpoint.intentHash,
    step: checkpoint.step,
    transactionHash: checkpoint.transactionHash,
    recorded: body.recorded
  }
}
