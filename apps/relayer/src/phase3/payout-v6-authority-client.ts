import { randomBytes as nodeRandomBytes } from "node:crypto"
import { createRequire } from "node:module"
import {
  buildPayoutV6RelayerJobListMessage,
  buildPayoutV6RelayerLeaseClaimMessage
} from "@parly/shared-types"
import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem"
import type { PrivateKeyAccount } from "viem/accounts"

import {
  preparePoolV3Transaction,
  readPoolV3RuntimeConfig,
  validatePoolV3ProofPayload,
  validatePayoutV6ExecutionPayload,
  type PoolV3ProofPayload,
  type PayoutV6ExecutionPayload
} from "./pool-v3-runtime.js"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default
const HASH_RE = /^0x[a-fA-F0-9]{64}$/u
const HEX_RE = /^0x(?:[a-fA-F0-9]{2})+$/u
const SIGNATURE_RE = /^0x[a-fA-F0-9]{130}$/u
const NONCE_RE = /^[A-Za-z0-9_-]{24,128}$/u
const TEMPO_CHAIN_ID = 4217

type FetchLike = (
  input: string,
  init: RequestInit
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type PayoutV6ExecutionChild = {
  intentHash: Hex
  intent: Record<string, unknown>
  payoutSignature: Hex
  destinationRecipient: Address
  providerData: Hex
}

export type PayoutV6ClaimedExecution = {
  manifestHash: Hex
  leaseExpiresAt: string
  payload: PayoutV6ExecutionPayload
  proofPayload: PoolV3ProofPayload
  children: PayoutV6ExecutionChild[]
  leaseToken: string
}

export type PayoutV6AuthorityClientConfig =
  | { enabled: false; reason: "phase3_payout_v6_relayer_worker_disabled" }
  | {
      enabled: true
      apiBaseUrl: string
      boxPrivateKeyB64: string
      adapter: Address
      withdrawalExecutor: Address
    }

function apiBaseUrl(value: string | undefined) {
  const raw = value?.trim()
  if (!raw) throw new Error("PHASE3_PAYOUT_V6_WEB_API_BASE_URL is required.")
  const url = new URL(raw)
  const local =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  if (url.protocol !== "https:" && !local) {
    throw new Error("PHASE3_PAYOUT_V6_WEB_API_BASE_URL must use HTTPS outside local development.")
  }
  return url.toString()
}

function addressEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: readonly string[]
) {
  const value = names.map((name) => env[name]?.trim()).find(Boolean)
  if (!value || !isAddress(value)) throw new Error(`${names[0]} is required.`)
  return getAddress(value) as Address
}

function boxKey(value: string | undefined) {
  const encoded = value?.trim()
  if (!encoded) throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 is required.")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 must be a canonical 32-byte base64 key.")
  }
  return encoded
}

export function readPayoutV6AuthorityClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV6AuthorityClientConfig {
  if (env.PHASE3_PAYOUT_V6_RELAYER_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_payout_v6_relayer_worker_disabled" }
  }
  return {
    enabled: true,
    apiBaseUrl: apiBaseUrl(env.PHASE3_PAYOUT_V6_WEB_API_BASE_URL),
    boxPrivateKeyB64: boxKey(env.RELAYER_BOX_PRIVATE_KEY_B64),
    adapter: addressEnv(env, [
      "PARLY_PAYOUT_ADAPTER_V6",
      "PHASE3_V6_PAYOUT_ADAPTER"
    ]),
    withdrawalExecutor: addressEnv(env, [
      "PARLY_PAYOUT_WITHDRAWAL_EXECUTOR_V2",
      "PHASE3_V6_PAYOUT_WITHDRAWAL_EXECUTOR"
    ])
  }
}

function requestFields(
  account: PrivateKeyAccount,
  nowSeconds = () => Date.now() / 1000,
  randomBytes = nodeRandomBytes
) {
  const timestamp = Math.floor(nowSeconds())
  const nonce = randomBytes(32).toString("base64url")
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !NONCE_RE.test(nonce)) {
    throw new Error("V6 relayer request is invalid.")
  }
  return {
    executionAddress: account.address.toLowerCase() as Address,
    timestamp,
    nonce
  }
}

async function openSealed(
  sealed: string,
  privateKeyB64: string,
  encoding: "base64" | "hex"
) {
  await sodium.ready
  const privateKey = sodium.from_base64(
    privateKeyB64,
    sodium.base64_variants.ORIGINAL
  )
  const publicKey = sodium.crypto_scalarmult_base(privateKey)
  const ciphertext =
    encoding === "base64"
      ? sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL)
      : hexToBytes(sealed as Hex)
  const opened = sodium.crypto_box_seal_open(ciphertext, publicKey, privateKey)
  if (!opened) throw new Error("V6 payout execution package is unavailable.")
  return JSON.parse(Buffer.from(opened).toString("utf8")) as unknown
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has an unknown or missing field.`)
  }
}

function executionChildren(
  value: unknown,
  intentHashes: readonly Hex[],
  sourceCallHash: Hex
) {
  if (!Array.isArray(value) || value.length !== intentHashes.length) {
    throw new Error("V6 execution children are invalid.")
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("V6 execution child is invalid.")
    }
    const child = entry as Record<string, unknown>
    exactKeys(
      child,
      [
        "intentHash",
        "intent",
        "payoutSignature",
        "destinationRecipient",
        "providerData"
      ],
      "V6 execution child"
    )
    if (
      typeof child.intentHash !== "string" ||
      !HASH_RE.test(child.intentHash) ||
      child.intentHash.toLowerCase() !== intentHashes[index] ||
      !child.intent ||
      typeof child.intent !== "object" ||
      Array.isArray(child.intent) ||
      typeof child.payoutSignature !== "string" ||
      !SIGNATURE_RE.test(child.payoutSignature) ||
      typeof child.destinationRecipient !== "string" ||
      !isAddress(child.destinationRecipient) ||
      typeof child.providerData !== "string" ||
      !HEX_RE.test(child.providerData)
    ) {
      throw new Error("V6 execution child is invalid.")
    }
    const intent = child.intent as Record<string, unknown>
    if (
      String(intent.sourceCallHash).toLowerCase() !== sourceCallHash ||
      keccak256(child.providerData as Hex).toLowerCase() !==
        String(intent.providerDataHash).toLowerCase() ||
      keccak256(
        encodeAbiParameters(
          [{ type: "address" }],
          [getAddress(child.destinationRecipient)]
        )
      ).toLowerCase() !== String(intent.destinationRecipientHash).toLowerCase()
    ) {
      throw new Error("V6 execution child binding is invalid.")
    }
    return {
      intentHash: child.intentHash.toLowerCase() as Hex,
      intent,
      payoutSignature: child.payoutSignature.toLowerCase() as Hex,
      destinationRecipient: getAddress(child.destinationRecipient),
      providerData: child.providerData.toLowerCase() as Hex
    }
  })
}

async function executionPackage(
  outerValue: unknown,
  config: Extract<PayoutV6AuthorityClientConfig, { enabled: true }>,
  executionAddress: Address,
  manifestHash: Hex
) {
  if (!outerValue || typeof outerValue !== "object" || Array.isArray(outerValue)) {
    throw new Error("V6 payout execution package is invalid.")
  }
  const outer = outerValue as Record<string, unknown>
  exactKeys(
    outer,
    [
      "version",
      "manifestHash",
      "adapter",
      "withdrawalExecutor",
      "sealedProofPayload",
      "intentHashes",
      "sourceFeeAllocations",
      "children",
      "lease",
      "leaseSignature",
      "leaseToken"
    ],
    "V6 payout execution package"
  )
  if (
    outer.version !== 6 ||
    typeof outer.manifestHash !== "string" ||
    outer.manifestHash.toLowerCase() !== manifestHash ||
    typeof outer.sealedProofPayload !== "string" ||
    !HEX_RE.test(outer.sealedProofPayload) ||
    typeof outer.leaseToken !== "string" ||
    !NONCE_RE.test(outer.leaseToken)
  ) {
    throw new Error("V6 payout execution package is invalid.")
  }
  const proofValue = await openSealed(
    outer.sealedProofPayload,
    config.boxPrivateKeyB64,
    "hex"
  )
  const poolRuntime = readPoolV3RuntimeConfig(
    process.env,
    TEMPO_CHAIN_ID,
    executionAddress
  )
  if (!poolRuntime.enabled) throw new Error("PoolV3 relayer dispatch is disabled.")
  const proofPayload = validatePoolV3ProofPayload(proofValue, {
    ...poolRuntime.config,
    proofExecutor: config.withdrawalExecutor
  })
  const poolCall = preparePoolV3Transaction(proofPayload).data
  const runtimePayload = validatePayoutV6ExecutionPayload(
    {
      version: outer.version,
      adapter: outer.adapter,
      withdrawalExecutor: outer.withdrawalExecutor,
      lease: outer.lease,
      leaseSignature: outer.leaseSignature,
      poolCall,
      intentHashes: outer.intentHashes,
      sourceFeeAllocations: outer.sourceFeeAllocations
    },
    {
      adapter: config.adapter,
      withdrawalExecutor: config.withdrawalExecutor,
      relayer: executionAddress,
      pools: new Set(poolRuntime.config.pools.keys())
    }
  )
  const children = executionChildren(
    outer.children,
    runtimePayload.intentHashes,
    keccak256(poolCall)
  )
  return {
    payload: runtimePayload,
    proofPayload,
    children,
    leaseToken: outer.leaseToken
  }
}

export async function listPayoutV6ReadyJobs(args: {
  config: Extract<PayoutV6AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  fetchImpl?: FetchLike
}) {
  const request = requestFields(args.account)
  const signature = await args.account.signMessage({
    message: buildPayoutV6RelayerJobListMessage(request)
  })
  const response = await (args.fetchImpl ?? fetch)(
    new URL(
      "/api/phase3/payout-v6/relayer/jobs",
      args.config.apiBaseUrl
    ).toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, signature })
    }
  )
  if (!response.ok) throw new Error("V6 payout ready jobs are unavailable.")
  const body = (await response.json()) as { jobs?: unknown }
  if (!Array.isArray(body.jobs)) throw new Error("V6 payout ready jobs are unavailable.")
  return body.jobs.flatMap((job) => {
    if (!job || typeof job !== "object") return []
    const value = job as Record<string, unknown>
    return typeof value.manifestHash === "string" &&
      HASH_RE.test(value.manifestHash) &&
      typeof value.supportReference === "string"
      ? [
          {
            manifestHash: value.manifestHash.toLowerCase() as Hex,
            supportReference: value.supportReference
          }
        ]
      : []
  })
}

export async function claimPayoutV6Execution(args: {
  config: Extract<PayoutV6AuthorityClientConfig, { enabled: true }>
  account: PrivateKeyAccount
  manifestHash: Hex
  fetchImpl?: FetchLike
  openSealedImpl?: (
    sealed: string,
    privateKeyB64: string,
    encoding: "base64" | "hex"
  ) => Promise<unknown>
}): Promise<PayoutV6ClaimedExecution> {
  if (!HASH_RE.test(args.manifestHash)) throw new Error("V6 manifest hash must be bytes32.")
  const request = {
    ...requestFields(args.account),
    manifestHash: args.manifestHash.toLowerCase() as Hex
  }
  const signature = await args.account.signMessage({
    message: buildPayoutV6RelayerLeaseClaimMessage(request)
  })
  const response = await (args.fetchImpl ?? fetch)(
    new URL(
      "/api/phase3/payout-v6/relayer/claim",
      args.config.apiBaseUrl
    ).toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, signature })
    }
  )
  if (!response.ok) throw new Error("V6 payout execution lease is unavailable.")
  const body = (await response.json()) as Record<string, unknown>
  if (
    typeof body.manifestHash !== "string" ||
    body.manifestHash.toLowerCase() !== request.manifestHash ||
    typeof body.leaseExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.leaseExpiresAt)) ||
    typeof body.executionPayloadSealedB64 !== "string"
  ) {
    throw new Error("V6 payout execution lease is unavailable.")
  }
  const opener = args.openSealedImpl ?? openSealed
  const opened = await opener(
    body.executionPayloadSealedB64,
    args.config.boxPrivateKeyB64,
    "base64"
  )
  const parsed = await executionPackage(
    opened,
    args.config,
    args.account.address,
    request.manifestHash
  )
  return {
    manifestHash: request.manifestHash,
    leaseExpiresAt: body.leaseExpiresAt,
    ...parsed
  }
}
