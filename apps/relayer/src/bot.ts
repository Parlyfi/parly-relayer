import "dotenv/config"
import { createRequire } from "node:module"
import { requireEnv, requirePositiveInt } from "@parly/env-utils"
import { POOL_ABI } from "@parly/protocol-abis"
import type { CanonicalRelayExecutionPayload, RelayCipherBundle } from "@parly/shared-types"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  isAddress,
  type Address
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { safeApproveExactRelayer } from "./erc20.js"
import { requirePhase3BroadcastEnabled } from "./phase3-broadcast-gate.js"
import { startRelayerOwnedExecutionWorkerLoop } from "./phase3/execution-worker.js"
import {
  claimRelayInboxBatch,
  markRelayInboxProcessed,
  persistPendingExecution,
  resetRelayInboxClaim,
  type PendingRelayerRecord
} from "./pending-store.js"
import { postRelayerHeartbeat } from "./registry-heartbeat.js"
import { ensureRelayerRegistryRegistration } from "./registry-registration.js"
import { startWakuRelay } from "./waku.js"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const

function assertTempoOnlyRelayerProductionEnv() {
  if (process.env.PARLY_ENV !== "mainnet" && process.env.NEXT_PUBLIC_PARLY_ENV !== "mainnet") {
    return
  }

  throw new Error(
    "Tempo mainnet relayer startup is intentionally fail-closed until explicit mainnet env validation replaces the staging-locked runtime."
  )
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length")
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("Invalid hex value")
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error("Invalid hex byte")
    out[i] = byte
  }
  return out
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)
}

function shortId(value: string | null | undefined) {
  if (!value) return "unknown"
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
}

function isUint32Number(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}

function isHexTuple2(value: unknown): value is [`0x${string}`, `0x${string}`] {
  return Array.isArray(value) && value.length === 2 && value.every(isHexString)
}

function isHexTuple2x2(
  value: unknown
): value is [[`0x${string}`, `0x${string}`], [`0x${string}`, `0x${string}`]] {
  return Array.isArray(value) && value.length === 2 && value.every(isHexTuple2)
}

function isRelayCipherBundle(x: unknown): x is RelayCipherBundle {
  return (
    !!x &&
    typeof x === "object" &&
    (x as any).version === 1 &&
    (x as any).launchScope === "tempo-only" &&
    typeof (x as any).relayerAddress === "string" &&
    isAddress((x as any).relayerAddress as `0x${string}`) &&
    isHexString((x as any).ciphertext)
  )
}

function isCanonicalPayload(x: any): x is CanonicalRelayExecutionPayload {
  return (
    x &&
    typeof x.pool === "string" &&
    isAddress(x.pool) &&
    isHexTuple2(x.pA) &&
    isHexTuple2x2(x.pB) &&
    isHexTuple2(x.pC) &&
    Array.isArray(x.pubSignals) &&
    x.pubSignals.length === 50 &&
    x.pubSignals.every(isDecimalString) &&
    Array.isArray(x.recipients) &&
    x.recipients.length === 10 &&
    x.recipients.every((a: unknown) => typeof a === "string" && isAddress(a as `0x${string}`)) &&
    Array.isArray(x.amounts) &&
    x.amounts.length === 10 &&
    x.amounts.every(isDecimalString) &&
    Array.isArray(x.destEids) &&
    x.destEids.length === 10 &&
    x.destEids.every(isUint32Number) &&
    Array.isArray(x.lzOptions) &&
    x.lzOptions.length === 10 &&
    x.lzOptions.every(isHexString) &&
    isHexString(x.newChangeCommitment) &&
    isHexString(x.newChangeEnvelope)
  )
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  const value = Number(raw ?? String(fallback))
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} invalid`)
  }
  return value
}

function isRetryablePreSubmitError(error: unknown): boolean {
  const message = String((error as any)?.message || error).toLowerCase()
  return (
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("temporar") ||
    message.includes("503") ||
    message.includes("429") ||
    message.includes("gateway timeout") ||
    message.includes("connection")
  )
}

assertTempoOnlyRelayerProductionEnv()

const tempoRpcUrl = requireEnv("TEMPO_RPC_URL")
const tempoChainId = requirePositiveInt("TEMPO_CHAIN_ID")
const relayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY") as `0x${string}`

const tempo = defineChain({
  id: tempoChainId,
  name: "Tempo",
  nativeCurrency: { name: "TMP", symbol: "TMP", decimals: 18 },
  rpcUrls: {
    default: { http: [tempoRpcUrl] }
  }
})

const account = privateKeyToAccount(relayerPrivateKey)
const relayerAddressEnv = String(process.env.RELAYER_ADDRESS || "").toLowerCase()
const preSubmitRetryLimit = parseNonNegativeInt(
  process.env.RELAYER_PRE_SUBMIT_RETRY_LIMIT,
  2,
  "RELAYER_PRE_SUBMIT_RETRY_LIMIT"
)
const preSubmitRetryBackoffMs = parseNonNegativeInt(
  process.env.RELAYER_PRE_SUBMIT_RETRY_BACKOFF_MS,
  1500,
  "RELAYER_PRE_SUBMIT_RETRY_BACKOFF_MS"
)
const receiptTimeoutMs = parseNonNegativeInt(
  process.env.RELAYER_RECEIPT_TIMEOUT_MS,
  300000,
  "RELAYER_RECEIPT_TIMEOUT_MS"
)
const maxPayloadBytes = parseNonNegativeInt(
  process.env.RELAYER_MAX_PAYLOAD_BYTES,
  32768,
  "RELAYER_MAX_PAYLOAD_BYTES"
)
const inboxPollIntervalMs = parseNonNegativeInt(
  process.env.RELAYER_INBOX_POLL_INTERVAL_MS,
  3000,
  "RELAYER_INBOX_POLL_INTERVAL_MS"
)
const registrySyncIntervalMs = parseNonNegativeInt(
  process.env.RELAYER_REGISTRY_SYNC_INTERVAL_MS,
  60000,
  "RELAYER_REGISTRY_SYNC_INTERVAL_MS"
)

const publicClient = createPublicClient({
  chain: tempo,
  transport: http(tempoRpcUrl)
})

const walletClient = createWalletClient({
  account,
  chain: tempo,
  transport: http(process.env.TEMPO_RPC_URL)
})

async function readCrossChainFeeFundingToken(poolAddress: Address): Promise<Address> {
  try {
    return (await publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "lzFeeFundingToken"
    })) as Address
  } catch {
    return (await publicClient.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "lzFeeToken"
    })) as Address
  }
}

const seenNullifiers = new Set<string>()
const inFlightNullifiers = new Set<string>()

async function syncRelayerRegistryKey() {
  try {
    const registrySync = await ensureRelayerRegistryRegistration(account)
    if (!registrySync.checked) {
      return
    }

    if (registrySync.updated) {
      console.log("Relayer registry key synced to the active box key.")
    } else {
      console.log("Relayer registry key already matches the active box key.")
    }
  } catch (error: any) {
    console.error(`Relayer registry key sync error: ${error?.message || error}`)
  }
}

async function openBundle(bundle: unknown) {
  await sodium.ready

  if (!isRelayCipherBundle(bundle)) {
    console.error("Dropped bundle: invalid outer bundle")
    return null
  }

  if (bundle.relayerAddress.toLowerCase() !== relayerAddressEnv) {
    console.log(`Ignored bundle for relayer ${bundle.relayerAddress}`)
    return null
  }

  if (!process.env.RELAYER_BOX_PRIVATE_KEY_B64) {
    throw new Error("RELAYER_BOX_PRIVATE_KEY_B64 missing")
  }

  const sk = sodium.from_base64(
    process.env.RELAYER_BOX_PRIVATE_KEY_B64,
    sodium.base64_variants.ORIGINAL
  )

  const pk = sodium.crypto_scalarmult_base(sk)
  const sealed = hexToBytes(bundle.ciphertext)
  const opened = sodium.crypto_box_seal_open(sealed, pk, sk)

  if (!opened) {
    console.error("Dropped bundle: unable to decrypt for configured relayer box key")
    return null
  }
  return JSON.parse(sodium.to_string(opened))
}

async function processBundle(raw: unknown, attempt = 0) {
  let decoded: CanonicalRelayExecutionPayload | null = null
  let approvalToken: `0x${string}` | null = null
  let approvalSpender: `0x${string}` | null = null
  let nullifierHash: `0x${string}` | null = null
  let submittedHash: `0x${string}` | null = null
  let finalHash: `0x${string}` | null = null
  let shouldCleanupApproval = false
  let persistedForReconciliation = false
  let replacementReason: "replaced" | "repriced" | "cancelled" | null = null
  let inFlightNullifierKey: string | null = null

  try {
    decoded = await openBundle(raw)
    if (!decoded) return
    if (!isCanonicalPayload(decoded)) {
      console.error("Dropped bundle: decrypted payload failed canonical validation")
      return
    }

    nullifierHash =
      `0x${BigInt(decoded.pubSignals[12]).toString(16).padStart(64, "0")}` as `0x${string}`

    if (seenNullifiers.has(nullifierHash.toLowerCase())) {
      console.log(`Ignored cached replay ${shortId(nullifierHash)}`)
      return
    }

    inFlightNullifierKey = nullifierHash.toLowerCase()
    if (inFlightNullifiers.has(inFlightNullifierKey)) {
      console.log(`Ignored in-flight replay ${shortId(nullifierHash)}`)
      return
    }
    inFlightNullifiers.add(inFlightNullifierKey)

    const proofRelayerAddress =
      `0x${BigInt(decoded.pubSignals[49]).toString(16).padStart(40, "0")}`.toLowerCase()

    if (proofRelayerAddress !== account.address.toLowerCase()) {
      console.error(`Dropping bundle bound to ${proofRelayerAddress}`)
      return
    }

    const spent = (await publicClient.readContract({
      address: decoded.pool,
      abi: POOL_ABI,
      functionName: "nullifierHashes",
      args: [nullifierHash]
    })) as boolean

    if (spent) {
      console.log(`On-chain spent, dropping ${shortId(nullifierHash)}`)
      seenNullifiers.add(nullifierHash.toLowerCase())
      return
    }

    const localEid = Number(decoded.pubSignals[17])
    let totalCrossChainFee = 0n
    let sameChainOutputCount = 0
    let crossChainOutputCount = 0

    for (let i = 0; i < decoded.amounts.length; i++) {
      const amt = BigInt(decoded.amounts[i])
      const dst = decoded.destEids[i]

      if (amt === 0n) continue
      if (dst !== localEid) {
        console.error("Dropped bundle: cross-chain routes are disabled for Tempo-only launch.")
        return
      }
      if (decoded.recipients[i].toLowerCase() === ZERO_ADDRESS) {
        console.error("Dropped bundle: zero recipient")
        return
      }
      if (dst === localEid) {
        sameChainOutputCount += 1
        continue
      }

      crossChainOutputCount += 1

      const fee = (await publicClient.readContract({
        address: decoded.pool,
        abi: POOL_ABI,
        functionName: "quoteCrossChainFee",
        args: [dst, decoded.recipients[i], amt, decoded.lzOptions[i]]
      })) as bigint

      totalCrossChainFee += fee
    }

    const executorFee = BigInt(decoded.pubSignals[14])
    const feeTokenDecimals = BigInt(process.env.TEMPO_LZ_FEE_TOKEN_DECIMALS || "6")
    const feeTokenUsd6 = BigInt(process.env.TEMPO_LZ_FEE_TOKEN_USD_6DEC || "1000000")
    const totalCrossChainFeeUsd6 =
      feeTokenUsd6 === 0n ? 0n : (totalCrossChainFee * feeTokenUsd6) / 10n ** feeTokenDecimals
    const requiredMarginUsd6 =
      crossChainOutputCount === 0
        ? 100_000n + (sameChainOutputCount > 0 ? BigInt(sameChainOutputCount - 1) * 20_000n : 0n)
        : (() => {
            const dynamicMargin =
              totalCrossChainFeeUsd6 / 5n +
              BigInt(crossChainOutputCount) * 50_000n +
              BigInt(sameChainOutputCount) * 20_000n
            return dynamicMargin > 350_000n ? dynamicMargin : 350_000n
          })()
    const recommendedExecutorFee =
      crossChainOutputCount === 0
        ? requiredMarginUsd6
        : totalCrossChainFeeUsd6 + requiredMarginUsd6

    if (executorFee < recommendedExecutorFee) {
      console.log(
        `Ignored bundle: executor fee ${formatUnits(executorFee, 6)} below recommended floor ${formatUnits(recommendedExecutorFee, 6)}`
      )
      return
    }

    if (totalCrossChainFee > 0n) {
      requirePhase3BroadcastEnabled("cross-chain fee approval")
      approvalToken = (await readCrossChainFeeFundingToken(decoded.pool)) as `0x${string}`
      approvalSpender = decoded.pool

      await safeApproveExactRelayer({
        token: approvalToken,
        spender: approvalSpender,
        amount: totalCrossChainFee,
        owner: account.address,
        publicClient,
        walletClient
      })
    }

    const { request } = await publicClient.simulateContract({
      account,
      address: decoded.pool,
      abi: POOL_ABI,
      functionName: "batchWithdraw",
      args: [
        [BigInt(decoded.pA[0]), BigInt(decoded.pA[1])],
        [
          [BigInt(decoded.pB[0][0]), BigInt(decoded.pB[0][1])],
          [BigInt(decoded.pB[1][0]), BigInt(decoded.pB[1][1])]
        ],
        [BigInt(decoded.pC[0]), BigInt(decoded.pC[1])],
        decoded.pubSignals.map((x) => BigInt(x)) as any,
        decoded.recipients,
        decoded.amounts.map((x) => BigInt(x)),
        decoded.destEids,
        decoded.newChangeCommitment,
        decoded.newChangeEnvelope,
        decoded.lzOptions
      ]
    })

    requirePhase3BroadcastEnabled("batch withdrawal broadcast")
    submittedHash = await walletClient.writeContract(request)
    finalHash = submittedHash

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: submittedHash,
      timeout: receiptTimeoutMs,
      onReplaced: (replacement) => {
        replacementReason = replacement.reason
        finalHash = replacement.transactionReceipt.transactionHash as `0x${string}`
      }
    })

    if (replacementReason === "cancelled") {
      shouldCleanupApproval = true
      console.error(`Execution cancelled before inclusion for ${finalHash}`)
      return
    }

    if (replacementReason === "replaced") {
      shouldCleanupApproval = true
      console.error(`Execution replaced before inclusion for ${finalHash}`)
      return
    }

    if (receipt.status !== "success") {
      shouldCleanupApproval = true
      console.error(`Execution reverted for ${finalHash}`)
      return
    }

    seenNullifiers.add(nullifierHash.toLowerCase())
    try {
      const heartbeat = await postRelayerHeartbeat(account)
      if (!heartbeat.sent) {
        console.log("Registry heartbeat skipped: RELAYER_REGISTRY_API_BASE_URL not configured.")
      }
    } catch (heartbeatError: any) {
      console.error(`Relayer heartbeat error: ${heartbeatError.message || heartbeatError}`)
    }
    console.log(`Relayed ${finalHash}`)
  } catch (e: any) {
    const message = String(e?.message || e)

    if (!submittedHash && isRetryablePreSubmitError(e) && attempt < preSubmitRetryLimit) {
      shouldCleanupApproval = true
      const delayMs = preSubmitRetryBackoffMs * 2 ** attempt
      console.error(
        `Retrying bundle in ${delayMs}ms after transient pre-submit error (${attempt + 1}/${preSubmitRetryLimit}): ${message}`
      )
      setTimeout(() => {
        void processBundle(raw, attempt + 1)
      }, delayMs)
      return
    }

    if (!submittedHash) {
      shouldCleanupApproval = true

      if (isRetryablePreSubmitError(e)) {
        persistedForReconciliation = true
        await persistPendingExecution({
          version: 1,
          recordedAt: Math.floor(Date.now() / 1000),
          phase: "pre_submit_exhausted",
          attempt,
          relayerAddress: account.address,
          pool: decoded ? decoded.pool : null,
          nullifierHash,
          submittedHash: null,
          approvalToken,
          approvalSpender,
          reason: message,
          rawBundle: raw
        })
        console.error(`Persisted exhausted pre-submit bundle: ${message}`)
      } else {
        console.error(`Dropped bundle: ${message}`)
      }
      return
    }

    persistedForReconciliation = true
    await persistPendingExecution({
      version: 1,
      recordedAt: Math.floor(Date.now() / 1000),
      phase: "submitted_receipt_unknown",
      attempt,
      relayerAddress: account.address,
      pool: decoded ? decoded.pool : null,
      nullifierHash,
      submittedHash: finalHash || submittedHash,
      approvalToken,
      approvalSpender,
      reason: message,
      rawBundle: raw
    })
    console.error(`Persisted pending execution ${finalHash || submittedHash}: ${message}`)
  } finally {
    if (inFlightNullifierKey) {
      inFlightNullifiers.delete(inFlightNullifierKey)
    }

    if (approvalToken && approvalSpender && (shouldCleanupApproval || !submittedHash) && !persistedForReconciliation) {
      try {
        requirePhase3BroadcastEnabled("cross-chain fee approval cleanup")
        await safeApproveExactRelayer({
          token: approvalToken,
          spender: approvalSpender,
          amount: 0n,
          owner: account.address,
          publicClient,
          walletClient
        })
      } catch (cleanupError: any) {
        console.error(`Relayer cleanup error: ${cleanupError.message || cleanupError}`)
      }
    }
  }
}

async function pollRelayInbox() {
  const records = await claimRelayInboxBatch(account.address)
  for (const record of records) {
    try {
      console.log(`Processing relay inbox bundle ${record.bundleKey}`)
      await processBundle(record.rawBundle, 0)
      await markRelayInboxProcessed(record.id)
    } catch (error: any) {
      const message = String(error?.message || error)
      console.error(`Relay inbox processing error: ${message}`)
      await resetRelayInboxClaim(record.id, message)
    }
  }
}

async function main() {
  if (!relayerAddressEnv) {
    throw new Error("RELAYER_ADDRESS missing")
  }
  if (relayerAddressEnv !== account.address.toLowerCase()) {
    throw new Error("RELAYER_ADDRESS must equal the address derived from RELAYER_PRIVATE_KEY")
  }

  await syncRelayerRegistryKey()
  startRelayerOwnedExecutionWorkerLoop()

  console.log(`Relayer listening as ${account.address}`)

  await startWakuRelay(async (payloadBytes) => {
    try {
      console.log(`Received Waku payload (${payloadBytes.byteLength} bytes)`)
      if (payloadBytes.byteLength > maxPayloadBytes) {
        console.error("Dropped oversized payload")
        return
      }

      const rawPayload = JSON.parse(new TextDecoder().decode(payloadBytes))
      const bundles = Array.isArray(rawPayload) ? rawPayload : [rawPayload]

      for (const raw of bundles) {
        await processBundle(raw, 0)
      }
    } catch (e: any) {
      console.error(`Relayer error: ${e.message || e}`)
    }
  })

  await pollRelayInbox()
  setInterval(() => {
    void pollRelayInbox().catch((error: any) => {
      console.error(`Relay inbox poll error: ${error?.message || error}`)
    })
  }, inboxPollIntervalMs)
  setInterval(() => {
    void syncRelayerRegistryKey()
  }, registrySyncIntervalMs)
}

main().catch(console.error)
