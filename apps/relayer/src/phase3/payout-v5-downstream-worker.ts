import type { PayoutV5ExecutionStep } from "@parly/shared-types"
import type { Hex } from "viem"

import type { PayoutV5ExecutionPayload } from "./payout-v5-authority-client.js"

type TransactionOutcome = "pending" | "success" | "failed"
type TransactionResult = { transactionHash: Hex }

export type PayoutV5DownstreamExecutionArgs = {
  payload: PayoutV5ExecutionPayload
  intentHash: Hex
  submissionTransactionHash: Hex
  readAdapterStatus(intentHash: Hex): Promise<number>
  readTransactionOutcome(transactionHash: Hex): Promise<TransactionOutcome>
  getLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<{ transactionHash: Hex } | null>
  getLocalSubmissions(args: { intentHash: Hex; step: PayoutV5ExecutionStep }): Promise<Hex[]>
  recordLocalSubmission(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordLocalCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<void>
  recordRemoteCheckpoint(args: { intentHash: Hex; step: PayoutV5ExecutionStep; transactionHash: Hex }): Promise<unknown>
  observeRelayStatus(args: { intentHash: Hex; relayRequestId: string }): Promise<unknown>
  requestCompletionProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<unknown>
  readCompletionQuorum(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{ ready: boolean; proof: unknown; signatures: Hex[] }>
  completePayout(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestRefundProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<unknown>
  readRefundQuorum(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{ ready: boolean; proof: unknown; signatures: Hex[] }>
  proveRelayRefund(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
}

function preparation(args: PayoutV5DownstreamExecutionArgs) {
  const selected = "preparation" in args.payload
    ? args.payload.preparation
    : args.payload.preparations.find((item) => item.intentHash.toLowerCase() === args.intentHash.toLowerCase())
  if (!selected || selected.intentHash.toLowerCase() !== args.intentHash.toLowerCase()) {
    throw new Error("V5 downstream payout preparation is unavailable.")
  }
  return selected
}

async function runTerminalTransaction(
  args: PayoutV5DownstreamExecutionArgs,
  step: "proveCompletion" | "proveRelayRefund",
  broadcast: (onSubmitted: (transactionHash: Hex) => Promise<void>) => Promise<TransactionResult>
) {
  const intentHash = preparation(args).intentHash
  const checkpoint = await args.getLocalCheckpoint({ intentHash, step })
  if (checkpoint) return checkpoint.transactionHash
  for (const transactionHash of await args.getLocalSubmissions({ intentHash, step })) {
    const outcome = await args.readTransactionOutcome(transactionHash)
    if (outcome === "pending") return transactionHash
    if (outcome === "success") {
      await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
      await args.recordRemoteCheckpoint({ intentHash, step, transactionHash })
      return transactionHash
    }
  }
  let submitted: Hex | null = null
  const result = await broadcast(async (transactionHash) => {
    submitted = transactionHash
    await args.recordLocalSubmission({ intentHash, step, transactionHash })
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) throw new Error(`V5 ${step} transaction hash mismatch.`)
  await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
  await args.recordRemoteCheckpoint({ intentHash, step, transactionHash })
  return transactionHash
}

export async function runPayoutV5DownstreamExecution(args: PayoutV5DownstreamExecutionArgs) {
  const selected = preparation(args)
  const intentHash = selected.intentHash
  let status = await args.readAdapterStatus(intentHash)
  if (status !== 3) return { intentHash, status, state: status === 4 ? "completed" as const : status === 5 ? "refund_available" as const : status === 6 ? "refunded" as const : "not_submitted" as const }

  try {
    await args.observeRelayStatus({ intentHash, relayRequestId: selected.relayRequestId })
  } catch {
    // Relay status is a progress hint. Objective chain proofs remain authoritative.
  }
  try {
    await args.requestCompletionProof({ intentHash, submissionTxHash: args.submissionTransactionHash })
    const quorum = await args.readCompletionQuorum({ intentHash, submissionTxHash: args.submissionTransactionHash })
    if (quorum.ready && quorum.signatures.length >= 2) {
      await runTerminalTransaction(args, "proveCompletion", (onSubmitted) => args.completePayout({ proof: quorum.proof, signatures: quorum.signatures, onSubmitted }))
      status = await args.readAdapterStatus(intentHash)
    }
  } catch {
    // No finalized destination evidence yet. Relay status remains a non-authoritative progress hint.
  }
  if (status === 3) {
    try {
      await args.requestRefundProof({ intentHash, submissionTxHash: args.submissionTransactionHash })
      const quorum = await args.readRefundQuorum({ intentHash, submissionTxHash: args.submissionTransactionHash })
      if (quorum.ready && quorum.signatures.length >= 2) {
        await runTerminalTransaction(args, "proveRelayRefund", (onSubmitted) => args.proveRelayRefund({ proof: quorum.proof, signatures: quorum.signatures, onSubmitted }))
        status = await args.readAdapterStatus(intentHash)
      }
    } catch {
      // A timeout or status label never substitutes for finalized Relay refund evidence.
    }
  }
  return { intentHash, status, state: status === 4 ? "completed" as const : status === 5 ? "refund_available" as const : status === 6 ? "refunded" as const : "monitoring" as const }
}
