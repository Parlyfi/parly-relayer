import "dotenv/config"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { requireEnv, requirePositiveInt } from "@parly/env-utils"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  zeroAddress
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { safeApproveExactRelayer } from "./erc20.js"
import { isPhase3BroadcastEnabled } from "./phase3-broadcast-gate.js"
import {
  acquirePendingExecutionLock,
  archiveResolvedPendingExecution,
  listPendingExecutions,
  type PendingRelayerResolution,
  type StoredPendingRelayerRecord
} from "./pending-store.js"

const NULLIFIER_ABI = [
  {
    type: "function",
    name: "nullifierHashes",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }]
  }
] as const

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
const publicClient = createPublicClient({
  chain: tempo,
  transport: http(tempoRpcUrl)
})
const walletClient = createWalletClient({
  account,
  chain: tempo,
  transport: http(tempoRpcUrl)
})

async function tryCleanup(record: StoredPendingRelayerRecord) {
  if (
    !record.approvalToken ||
    !record.approvalSpender ||
    !isAddress(record.approvalToken) ||
    !isAddress(record.approvalSpender) ||
    record.approvalToken.toLowerCase() === zeroAddress
  ) {
    return { attempted: false, succeeded: false }
  }

  if (!isPhase3BroadcastEnabled()) {
    console.warn(
      `Skipping pending approval cleanup for ${record.submittedHash || record.nullifierHash || "unknown"} because Phase 3 live/outbound broadcast flags are disabled.`
    )
    return { attempted: false, succeeded: false }
  }

  try {
    await safeApproveExactRelayer({
      token: record.approvalToken,
      spender: record.approvalSpender,
      amount: 0n,
      owner: account.address,
      publicClient,
      walletClient
    })
    return { attempted: true, succeeded: true }
  } catch (e: any) {
    console.error(
      `Cleanup failed for ${record.submittedHash || record.nullifierHash || "unknown"}: ${e.message || e}`
    )
    return { attempted: true, succeeded: false }
  }
}

async function isNullifierSpent(record: StoredPendingRelayerRecord): Promise<boolean> {
  if (!record.pool || !record.nullifierHash || !isAddress(record.pool)) return false

  return (await publicClient.readContract({
    address: record.pool,
    abi: NULLIFIER_ABI,
    functionName: "nullifierHashes",
    args: [record.nullifierHash]
  })) as boolean
}

async function resolveRecord(record: StoredPendingRelayerRecord): Promise<{
  keep: boolean
  resolved?: PendingRelayerResolution
}> {
  const resolvedAt = Math.floor(Date.now() / 1000)

  if (!record.submittedHash) {
    const spent = await isNullifierSpent(record)
    if (spent) {
      return {
        keep: false,
        resolved: {
          resolvedAt,
          resolution: "external_success_without_receipt",
          cleanupAttempted: false,
          cleanupSucceeded: false
        }
      }
    }

    const cleanup = await tryCleanup(record)
    return {
      keep: false,
      resolved: {
        resolvedAt,
        resolution: "pre_submit_terminal_failure",
        cleanupAttempted: cleanup.attempted,
        cleanupSucceeded: cleanup.succeeded
      }
    }
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: record.submittedHash })
    if (receipt.status === "success") {
      return {
        keep: false,
        resolved: {
          resolvedAt,
          resolution: "confirmed_success",
          cleanupAttempted: false,
          cleanupSucceeded: false
        }
      }
    }

    const cleanup = await tryCleanup(record)
    return {
      keep: false,
      resolved: {
        resolvedAt,
        resolution: "confirmed_failure",
        cleanupAttempted: cleanup.attempted,
        cleanupSucceeded: cleanup.succeeded
      }
    }
  } catch {
    const spent = await isNullifierSpent(record)
    if (spent) {
      return {
        keep: false,
        resolved: {
          resolvedAt,
          resolution: "external_success_without_receipt",
          cleanupAttempted: false,
          cleanupSucceeded: false
        }
      }
    }
    return { keep: true }
  }
}

export async function reconcilePendingOnce() {
  const releaseLock = await acquirePendingExecutionLock()
  if (!releaseLock) {
    return
  }

  try {
    const pending = await listPendingExecutions()
    if (!pending.length) {
      console.log("No pending relay executions to reconcile.")
      return
    }

    let keepCount = 0
    let resolvedCount = 0

    for (const record of pending) {
      const outcome = await resolveRecord(record)
      if (outcome.keep) {
        keepCount += 1
      } else if (outcome.resolved) {
        await archiveResolvedPendingExecution(record, outcome.resolved)
        resolvedCount += 1
      }
    }

    console.log(`Reconciled relay executions: resolved=${resolvedCount} still_pending=${keepCount} archive=postgres`)
  } finally {
    await releaseLock()
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectExecution) {
  reconcilePendingOnce().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
