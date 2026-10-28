import type { PayoutV5ExecutionStep } from "@parly/shared-types"
import type { Address, Hex } from "viem"

import type {
  PayoutV5BatchExecutionPayload,
  PayoutV5ExecutionPreparation
} from "./payout-v5-authority-client.js"

type TransactionOutcome = "pending" | "success" | "failed"
type TransactionResult = { transactionHash: Hex }

export type PayoutV5BatchCheckpointedExecutionArgs = {
  payload: PayoutV5BatchExecutionPayload
  executionAddress: Address
  leaseExpiresAt: string
  readAdapterStatus(intentHash: Hex): Promise<number>
  readTransactionOutcome(transactionHash: Hex): Promise<TransactionOutcome>
  getLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<{ transactionHash: Hex } | null>
  getLocalSubmissions(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<Hex[]>
  recordLocalSubmission(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordRemoteCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<unknown>
  acceptQuote(args: { preparation: PayoutV5ExecutionPreparation; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  executeWithdrawal(args: { payload: PayoutV5BatchExecutionPayload; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestProvenance(args: { intentHash: Hex; withdrawalTxHash: Hex }): Promise<{ attestation: unknown; signature: Hex }>
  confirmEscrowReceipt(args: { preparation: PayoutV5ExecutionPreparation; provenance: { attestation: unknown; signature: Hex }; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  submitPayout(args: { preparation: PayoutV5ExecutionPreparation; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
}

function assertBatch(args: PayoutV5BatchCheckpointedExecutionArgs) {
  const { payload } = args
  if (payload.preparations.length < 2 || payload.preparations.length > 10 ||
      payload.lease.operator.toLowerCase() !== args.executionAddress.toLowerCase()) {
    throw new Error("V5 payout batch execution bindings do not match.")
  }
  const leaseExpiry = Date.parse(args.leaseExpiresAt)
  if (!Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now() + 15_000 ||
      BigInt(payload.lease.expiry) * 1000n < BigInt(Date.now() + 15_000)) {
    throw new Error("V5 payout batch execution lease expired before broadcast.")
  }
}

async function recoverSubmitted(args: PayoutV5BatchCheckpointedExecutionArgs, intentHash: Hex, step: PayoutV5ExecutionStep) {
  const checkpoint = await args.getLocalCheckpoint({ intentHash, step })
  if (checkpoint) return checkpoint.transactionHash
  for (const transactionHash of await args.getLocalSubmissions({ intentHash, step })) {
    const outcome = await args.readTransactionOutcome(transactionHash)
    if (outcome === "pending") throw new Error(`V5 ${step} transaction is still pending.`)
    if (outcome !== "success") continue
    await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
    await args.recordRemoteCheckpoint({ intentHash, step, transactionHash })
    return transactionHash
  }
  return null
}

async function runChildTransaction(args: PayoutV5BatchCheckpointedExecutionArgs, intentHash: Hex, step: PayoutV5ExecutionStep, broadcast: (onSubmitted: (hash: Hex) => Promise<void>) => Promise<TransactionResult>) {
  const recovered = await recoverSubmitted(args, intentHash, step)
  if (recovered) return recovered
  let submitted: Hex | null = null
  const result = await broadcast(async (transactionHash) => {
    submitted = transactionHash
    await args.recordLocalSubmission({ intentHash, step, transactionHash })
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) {
    throw new Error(`V5 ${step} broadcaster returned a different transaction hash.`)
  }
  await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
  await args.recordRemoteCheckpoint({ intentHash, step, transactionHash })
  return transactionHash
}

async function recordSharedWithdrawal(args: PayoutV5BatchCheckpointedExecutionArgs, transactionHash: Hex) {
  for (const preparation of args.payload.preparations) {
    const intentHash = preparation.intentHash
    await args.recordLocalCheckpoint({ intentHash, step: "poolWithdraw", transactionHash })
    await args.recordRemoteCheckpoint({ intentHash, step: "poolWithdraw", transactionHash })
  }
}

async function sharedWithdrawal(args: PayoutV5BatchCheckpointedExecutionArgs, allowBroadcast: boolean) {
  const checkpoints = await Promise.all(args.payload.preparations.map((preparation) =>
    args.getLocalCheckpoint({ intentHash: preparation.intentHash, step: "poolWithdraw" })))
  const hashes = [...new Set(checkpoints.filter((value): value is { transactionHash: Hex } => Boolean(value)).map((value) => value.transactionHash.toLowerCase() as Hex))]
  if (hashes.length > 1) throw new Error("V5 payout batch has conflicting Pool withdrawal checkpoints.")
  if (hashes[0]) {
    await recordSharedWithdrawal(args, hashes[0])
    return hashes[0]
  }
  const recovered = new Set<Hex>()
  for (const preparation of args.payload.preparations) {
    const transactionHash = await recoverSubmitted(args, preparation.intentHash, "poolWithdraw")
    if (transactionHash) recovered.add(transactionHash.toLowerCase() as Hex)
  }
  if (recovered.size > 1) throw new Error("V5 payout batch has conflicting Pool withdrawal submissions.")
  if (recovered.size === 1) {
    const transactionHash = [...recovered][0]!
    await recordSharedWithdrawal(args, transactionHash)
    return transactionHash
  }
  if (!allowBroadcast) throw new Error("V5 payout batch withdrawal checkpoint is unavailable.")
  let submitted: Hex | null = null
  const result = await args.executeWithdrawal({
    payload: args.payload,
    onSubmitted: async (transactionHash) => {
      submitted = transactionHash
      for (const preparation of args.payload.preparations) {
        await args.recordLocalSubmission({ intentHash: preparation.intentHash, step: "poolWithdraw", transactionHash })
      }
    }
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) {
    throw new Error("V5 poolWithdraw broadcaster returned a different transaction hash.")
  }
  await recordSharedWithdrawal(args, transactionHash)
  return transactionHash
}

export async function runPayoutV5BatchCheckpointedExecution(args: PayoutV5BatchCheckpointedExecutionArgs) {
  assertBatch(args)
  let statuses = await Promise.all(args.payload.preparations.map((preparation) => args.readAdapterStatus(preparation.intentHash)))
  if (statuses.some((status) => status === 0) && statuses.some((status) => status >= 2)) {
    throw new Error("V5 payout batch has impossible mixed acceptance and escrow states.")
  }
  for (let index = 0; index < args.payload.preparations.length; index += 1) {
    if (statuses[index] !== 0) continue
    const preparation = args.payload.preparations[index]!
    await runChildTransaction(args, preparation.intentHash, "acceptQuote", (onSubmitted) =>
      args.acceptQuote({ preparation, onSubmitted }))
  }
  statuses = await Promise.all(args.payload.preparations.map((preparation) => args.readAdapterStatus(preparation.intentHash)))
  if (statuses.some((status) => status === 0)) throw new Error("V5 payout batch quote acceptance is incomplete.")

  const withdrawalKnown = statuses.some((status) => status >= 2)
  const withdrawalTxHash = withdrawalKnown
    ? await sharedWithdrawal(args, false).catch(() => { throw new Error("V5 payout batch withdrawal checkpoint requires recovery review.") })
    : await sharedWithdrawal(args, true)

  for (let index = 0; index < args.payload.preparations.length; index += 1) {
    const preparation = args.payload.preparations[index]!
    let status = await args.readAdapterStatus(preparation.intentHash)
    if (status === 1) {
      const provenance = await args.requestProvenance({ intentHash: preparation.intentHash, withdrawalTxHash })
      await runChildTransaction(args, preparation.intentHash, "confirmEscrowReceipt", (onSubmitted) =>
        args.confirmEscrowReceipt({ preparation, provenance, onSubmitted }))
      status = await args.readAdapterStatus(preparation.intentHash)
    }
    if (status === 2) {
      await runChildTransaction(args, preparation.intentHash, "submitPayout", (onSubmitted) =>
        args.submitPayout({ preparation, onSubmitted }))
    }
  }
  return { intentHashes: args.payload.preparations.map((preparation) => preparation.intentHash), state: "awaiting_independent_delivery" as const }
}
