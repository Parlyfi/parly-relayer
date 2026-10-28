import type { PayoutV5ExecutionStep } from "@parly/shared-types"
import type { Address, Hex } from "viem"

import type { PayoutV5SingleExecutionPayload } from "./payout-v5-authority-client.js"

type TransactionOutcome = "pending" | "success" | "failed"
type TransactionResult = { transactionHash: Hex }
type Broadcast = (onSubmitted: (transactionHash: Hex) => Promise<void>) => Promise<TransactionResult>

export type PayoutV5CheckpointedExecutionArgs = {
  payload: PayoutV5SingleExecutionPayload
  executionAddress: Address
  leaseExpiresAt: string
  readAdapterStatus(intentHash: Hex): Promise<number>
  readTransactionOutcome(transactionHash: Hex): Promise<TransactionOutcome>
  getLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<{ transactionHash: Hex } | null>
  getLocalSubmissions(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<Hex[]>
  recordLocalSubmission(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordRemoteCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<unknown>
  acceptQuote(args: { payload: PayoutV5SingleExecutionPayload; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  executeWithdrawal(args: { payload: PayoutV5SingleExecutionPayload; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestProvenance(args: { intentHash: Hex; withdrawalTxHash: Hex }): Promise<{ attestation: unknown; signature: Hex }>
  confirmEscrowReceipt(args: { provenance: { attestation: unknown; signature: Hex }; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  submitPayout(args: { payload: PayoutV5SingleExecutionPayload; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestCompletionProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<unknown>
  readCompletionQuorum(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{
    ready: boolean
    proof: unknown
    signatures: Hex[]
  }>
  completePayout(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestRefundProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<unknown>
  readRefundQuorum(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{ ready: boolean; proof: unknown; signatures: Hex[] }>
  proveRelayRefund(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  observeRelayStatus(args: { intentHash: Hex; relayRequestId: string }): Promise<unknown>
}

function assertPayload(args: PayoutV5CheckpointedExecutionArgs) {
  const { payload, executionAddress } = args
  if (payload.preparation.intentHash.toLowerCase() !== payload.lease.intentHash.toLowerCase() ||
      payload.preparation.quoteHash.toLowerCase() !== payload.lease.intentHash.toLowerCase() ||
      payload.lease.operator.toLowerCase() !== executionAddress.toLowerCase()) {
    throw new Error("V5 payout execution bindings do not match.")
  }
  const leaseExpiry = Date.parse(args.leaseExpiresAt)
  if (!Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now() + 15_000 || BigInt(payload.lease.expiry) * 1000n < BigInt(Date.now() + 15_000)) {
    throw new Error("V5 payout execution lease expired before broadcast.")
  }
}

async function recoverSubmittedTransaction(args: PayoutV5CheckpointedExecutionArgs, step: PayoutV5ExecutionStep) {
  const existing = await args.getLocalCheckpoint({ intentHash: args.payload.preparation.intentHash, step })
  if (existing) return existing.transactionHash
  const submissions = await args.getLocalSubmissions({ intentHash: args.payload.preparation.intentHash, step })
  for (const transactionHash of submissions) {
    const outcome = await args.readTransactionOutcome(transactionHash)
    if (outcome === "pending") throw new Error(`V5 ${step} transaction is still pending.`)
    if (outcome !== "success") continue
    await args.recordLocalCheckpoint({ intentHash: args.payload.preparation.intentHash, step, transactionHash })
    await args.recordRemoteCheckpoint({ intentHash: args.payload.preparation.intentHash, step, transactionHash })
    return transactionHash
  }
  return null
}

async function runTransaction(args: PayoutV5CheckpointedExecutionArgs, step: PayoutV5ExecutionStep, broadcast: Broadcast) {
  const recovered = await recoverSubmittedTransaction(args, step)
  if (recovered) return recovered
  let submitted: Hex | null = null
  const result = await broadcast(async (transactionHash) => {
    submitted = transactionHash
    await args.recordLocalSubmission({ intentHash: args.payload.preparation.intentHash, step, transactionHash })
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) {
    throw new Error(`V5 ${step} broadcaster returned a different transaction hash.`)
  }
  await args.recordLocalCheckpoint({ intentHash: args.payload.preparation.intentHash, step, transactionHash })
  await args.recordRemoteCheckpoint({ intentHash: args.payload.preparation.intentHash, step, transactionHash })
  return transactionHash
}

export async function runPayoutV5CheckpointedExecution(args: PayoutV5CheckpointedExecutionArgs) {
  assertPayload(args)
  const intentHash = args.payload.preparation.intentHash
  let status = await args.readAdapterStatus(intentHash)
  if (status === 0) {
    await runTransaction(args, "acceptQuote", (onSubmitted) => args.acceptQuote({ payload: args.payload, onSubmitted }))
    status = await args.readAdapterStatus(intentHash)
  }
  if (status === 1) {
    const withdrawalTxHash = await runTransaction(args, "poolWithdraw", (onSubmitted) =>
      args.executeWithdrawal({ payload: args.payload, onSubmitted }))
    const provenance = await args.requestProvenance({ intentHash, withdrawalTxHash })
    await runTransaction(args, "confirmEscrowReceipt", (onSubmitted) =>
      args.confirmEscrowReceipt({ provenance, onSubmitted }))
    status = await args.readAdapterStatus(intentHash)
  }
  if (status === 2) {
    await runTransaction(args, "submitPayout", (onSubmitted) => args.submitPayout({ payload: args.payload, onSubmitted }))
    status = await args.readAdapterStatus(intentHash)
  }
  if (status === 3 || status === 5 || status === 6) {
    const submission = await args.getLocalCheckpoint({ intentHash, step: "submitPayout" })
    if (!submission) throw new Error("V5 payout submission is missing its durable checkpoint.")
    if (status === 3) {
      try {
        await args.observeRelayStatus({ intentHash, relayRequestId: args.payload.preparation.relayRequestId })
      } catch {
        // Objective chain proof remains authoritative when the provider status endpoint is degraded.
      }
      try {
        await args.requestCompletionProof({ intentHash, submissionTxHash: submission.transactionHash })
        const quorum = await args.readCompletionQuorum({ intentHash, submissionTxHash: submission.transactionHash })
        if (quorum.ready && quorum.signatures.length >= 2) {
          await runTransaction(args, "proveCompletion", (onSubmitted) =>
            args.completePayout({ proof: quorum.proof, signatures: quorum.signatures, onSubmitted }))
          status = await args.readAdapterStatus(intentHash)
        }
      } catch {
        // A pending Relay route has no objective completion evidence yet.
      }
    }
    if (status === 3 || status === 5 || status === 6) {
      try {
        await args.requestRefundProof({ intentHash, submissionTxHash: submission.transactionHash })
        const refund = await args.readRefundQuorum({ intentHash, submissionTxHash: submission.transactionHash })
        if (refund.ready && refund.signatures.length >= 2) {
          await runTransaction(args, "proveRelayRefund", (onSubmitted) =>
            args.proveRelayRefund({ proof: refund.proof, signatures: refund.signatures, onSubmitted }))
          status = await args.readAdapterStatus(intentHash)
        }
      } catch {
        // Keep the payout pending; elapsed time is never treated as refund evidence.
      }
    }
  }
  if (status < 0 || status > 7) throw new Error("V5 payout adapter returned an invalid status.")
  return {
    intentHash,
    status,
    state: status === 3 ? "awaiting_objective_delivery_proof" as const
      : status === 4 ? "completed" as const
        : status === 5 ? "refund_available" as const
          : status === 6 ? "refunded" as const
            : "pending" as const
  }
}
