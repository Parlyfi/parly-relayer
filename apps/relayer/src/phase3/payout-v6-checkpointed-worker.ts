import type { PayoutV6ExecutionStep } from "@parly/shared-types"
import type { Address, Hex } from "viem"

import type {
  PayoutV6ClaimedExecution,
  PayoutV6ExecutionChild
} from "./payout-v6-authority-client.js"

type TransactionOutcome = "pending" | "success" | "failed"
type TransactionResult = { transactionHash: Hex }
type Broadcast = (onSubmitted: (transactionHash: Hex) => Promise<void>) => Promise<TransactionResult>

export type PayoutSourceClaim = Pick<PayoutV6ClaimedExecution, "manifestHash" | "leaseExpiresAt" | "children"> & {
  payload: Pick<PayoutV6ClaimedExecution["payload"], "lease" | "intentHashes">
}
export type PayoutV6CheckpointedExecutionArgs<T extends PayoutSourceClaim = PayoutV6ClaimedExecution> = {
  claimed: T
  executionAddress: Address
  readAdapterStatus(intentHash: Hex): Promise<number>
  readEscrowFundedAt(intentHash: Hex): Promise<bigint>
  readTransactionOutcome(transactionHash: Hex): Promise<TransactionOutcome>
  getLocalCheckpoint(args: { intentHash: Hex; step: PayoutV6ExecutionStep }): Promise<{ transactionHash: Hex } | null>
  getLocalSubmissions(args: { intentHash: Hex; step: PayoutV6ExecutionStep }): Promise<Hex[]>
  recordLocalSubmission(args: { intentHash: Hex; step: PayoutV6ExecutionStep; transactionHash: Hex }): Promise<void>
  recordLocalCheckpoint(args: { intentHash: Hex; step: PayoutV6ExecutionStep; transactionHash: Hex }): Promise<void>
  acceptQuote(args: { child: PayoutV6ExecutionChild; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  executeWithdrawal(args: { claimed: T; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestProvenance(args: { intentHash: Hex; withdrawalTxHash: Hex }): Promise<{ attestation: unknown; signature: Hex }>
  confirmEscrowReceipt(args: { child: PayoutV6ExecutionChild; provenance: { attestation: unknown; signature: Hex }; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  submitPayout(args: { child: PayoutV6ExecutionChild; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
}

export type PayoutV6DownstreamExecutionArgs = {
  intentHash: Hex
  submissionTransactionHash: Hex
  readAdapterStatus(intentHash: Hex): Promise<number>
  readTransactionOutcome(transactionHash: Hex): Promise<TransactionOutcome>
  getLocalCheckpoint(args: { intentHash: Hex; step: PayoutV6ExecutionStep }): Promise<{ transactionHash: Hex } | null>
  getLocalSubmissions(args: { intentHash: Hex; step: PayoutV6ExecutionStep }): Promise<Hex[]>
  recordLocalSubmission(args: { intentHash: Hex; step: PayoutV6ExecutionStep; transactionHash: Hex }): Promise<void>
  recordLocalCheckpoint(args: { intentHash: Hex; step: PayoutV6ExecutionStep; transactionHash: Hex }): Promise<void>
  requestCompletionProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{ ready: boolean; proof: unknown; signatures: Hex[] }>
  completePayout(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
  requestRefundProof(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<unknown>
  readRefundQuorum(args: { intentHash: Hex; submissionTxHash: Hex }): Promise<{ ready: boolean; proof: unknown; signatures: Hex[] }>
  proveRelayRefund(args: { proof: unknown; signatures: Hex[]; onSubmitted(transactionHash: Hex): Promise<void> }): Promise<TransactionResult>
}

function assertClaim<T extends PayoutSourceClaim>(args: PayoutV6CheckpointedExecutionArgs<T>) {
  const { claimed } = args
  if (
    claimed.payload.lease.operator.toLowerCase() !== args.executionAddress.toLowerCase() ||
    claimed.children.length !== claimed.payload.intentHashes.length ||
    claimed.children.some(
      (child, index) =>
        child.intentHash.toLowerCase() !==
        claimed.payload.intentHashes[index]!.toLowerCase()
    )
  ) {
    throw new Error("V6 payout execution bindings do not match.")
  }
  const leaseExpiry = Date.parse(claimed.leaseExpiresAt)
  if (
    !Number.isFinite(leaseExpiry) ||
    leaseExpiry <= Date.now() + 15_000 ||
    BigInt(claimed.payload.lease.expiry) * 1000n < BigInt(Date.now() + 15_000)
  ) {
    throw new Error("V6 payout execution lease expired before broadcast.")
  }
}

async function recoverSubmitted<T extends PayoutSourceClaim>(
  args: PayoutV6CheckpointedExecutionArgs<T>,
  intentHash: Hex,
  step: PayoutV6ExecutionStep
) {
  const existing = await args.getLocalCheckpoint({ intentHash, step })
  if (existing) return existing.transactionHash
  for (const transactionHash of await args.getLocalSubmissions({ intentHash, step })) {
    const outcome = await args.readTransactionOutcome(transactionHash)
    if (outcome === "pending") throw new Error(`V6 ${step} transaction is still pending.`)
    if (outcome !== "success") continue
    await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
    return transactionHash
  }
  return null
}

async function runTransaction<T extends PayoutSourceClaim>(
  args: PayoutV6CheckpointedExecutionArgs<T>,
  intentHash: Hex,
  step: PayoutV6ExecutionStep,
  broadcast: Broadcast
) {
  const recovered = await recoverSubmitted(args, intentHash, step)
  if (recovered) return recovered
  let submitted: Hex | null = null
  const result = await broadcast(async (transactionHash) => {
    submitted = transactionHash
    await args.recordLocalSubmission({ intentHash, step, transactionHash })
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) {
    throw new Error(`V6 ${step} broadcaster returned a different transaction hash.`)
  }
  await args.recordLocalCheckpoint({ intentHash, step, transactionHash })
  return transactionHash
}

export async function runPayoutV6CheckpointedExecution<T extends PayoutSourceClaim = PayoutV6ClaimedExecution>(
  args: PayoutV6CheckpointedExecutionArgs<T>
) {
  assertClaim(args)
  let statuses = await Promise.all(
    args.claimed.children.map((child) => args.readAdapterStatus(child.intentHash))
  )
  for (let index = 0; index < args.claimed.children.length; index += 1) {
    if (statuses[index] !== 0) continue
    const child = args.claimed.children[index]!
    await runTransaction(args, child.intentHash, "acceptQuote", (onSubmitted) =>
      args.acceptQuote({ child, onSubmitted })
    )
  }
  statuses = await Promise.all(
    args.claimed.children.map((child) => args.readAdapterStatus(child.intentHash))
  )
  if (statuses.some((status) => status === 0)) {
    throw new Error("V6 payout quote acceptance is incomplete.")
  }

  const funded = await Promise.all(
    args.claimed.children.map((child) => args.readEscrowFundedAt(child.intentHash))
  )
  if (funded.some((value) => value > 0n) && funded.some((value) => value === 0n)) {
    throw new Error("V6 atomic source funding has an impossible mixed state.")
  }
  let withdrawalTxHash = await recoverSubmitted(
    args,
    args.claimed.payload.lease.intentHash,
    "poolWithdraw"
  )
  if (funded.every((value) => value === 0n)) {
    withdrawalTxHash = await runTransaction(
      args,
      args.claimed.payload.lease.intentHash,
      "poolWithdraw",
      (onSubmitted) => args.executeWithdrawal({ claimed: args.claimed, onSubmitted })
    )
  }
  if (!withdrawalTxHash) {
    throw new Error("V6 funded payout is missing its durable withdrawal transaction.")
  }

  for (const child of args.claimed.children) {
    let status = await args.readAdapterStatus(child.intentHash)
    if (status === 1) {
      if ((await args.readEscrowFundedAt(child.intentHash)) === 0n) {
        throw new Error("V6 source funding was not recorded atomically.")
      }
      const provenance = await args.requestProvenance({
        intentHash: child.intentHash,
        withdrawalTxHash
      })
      await runTransaction(
        args,
        child.intentHash,
        "confirmEscrowReceipt",
        (onSubmitted) =>
          args.confirmEscrowReceipt({ child, provenance, onSubmitted })
      )
      status = await args.readAdapterStatus(child.intentHash)
    }
    if (status === 2) {
      await runTransaction(args, child.intentHash, "submitPayout", (onSubmitted) =>
        args.submitPayout({ child, onSubmitted })
      )
      status = await args.readAdapterStatus(child.intentHash)
    }
    if (status < 1 || status > 6) {
      throw new Error("V6 payout adapter returned an invalid status.")
    }
  }
  return {
    manifestHash: args.claimed.manifestHash,
    intentHashes: args.claimed.payload.intentHashes,
    state: "awaiting_independent_delivery" as const
  }
}

async function runTerminalTransaction(
  args: PayoutV6DownstreamExecutionArgs,
  step: "proveCompletion" | "proveRelayRefund",
  broadcast: Broadcast
) {
  const checkpoint = await args.getLocalCheckpoint({
    intentHash: args.intentHash,
    step
  })
  if (checkpoint) return checkpoint.transactionHash
  for (const transactionHash of await args.getLocalSubmissions({
    intentHash: args.intentHash,
    step
  })) {
    const outcome = await args.readTransactionOutcome(transactionHash)
    if (outcome === "pending") return transactionHash
    if (outcome === "success") {
      await args.recordLocalCheckpoint({
        intentHash: args.intentHash,
        step,
        transactionHash
      })
      return transactionHash
    }
  }
  let submitted: Hex | null = null
  const result = await broadcast(async (transactionHash) => {
    submitted = transactionHash
    await args.recordLocalSubmission({
      intentHash: args.intentHash,
      step,
      transactionHash
    })
  })
  const transactionHash = submitted ?? result.transactionHash
  if (transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()) {
    throw new Error(`V6 ${step} transaction hash mismatch.`)
  }
  await args.recordLocalCheckpoint({
    intentHash: args.intentHash,
    step,
    transactionHash
  })
  return transactionHash
}

export async function runPayoutV6DownstreamExecution(
  args: PayoutV6DownstreamExecutionArgs
) {
  let status = await args.readAdapterStatus(args.intentHash)
  if (status !== 3) {
    return {
      intentHash: args.intentHash,
      status,
      state:
        status === 4
          ? "completed" as const
          : status === 5
            ? "refund_available" as const
            : status === 6
              ? "refunded" as const
              : "not_submitted" as const
    }
  }
  let completionRetry: string | undefined
  let completionStage = "attestation"
  try {
    const quorum = await args.requestCompletionProof({
      intentHash: args.intentHash,
      submissionTxHash: args.submissionTransactionHash
    })
    if (quorum.ready && quorum.signatures.length >= 2) {
      completionStage = "submission"
      await runTerminalTransaction(args, "proveCompletion", (onSubmitted) =>
        args.completePayout({
          proof: quorum.proof,
          signatures: quorum.signatures,
          onSubmitted
        })
      )
      status = await args.readAdapterStatus(args.intentHash)
    } else {
      completionRetry = "attestation:quorum_pending"
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null
    const reason = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "request_timeout"
      : typeof code === "string" && /^attester_http_[1-5][0-9]{2}$/u.test(code)
        ? code
        : "verification_failed"
    completionRetry = `${completionStage}:${reason}`
  }
  if (status === 3) {
    try {
      await args.requestRefundProof({
        intentHash: args.intentHash,
        submissionTxHash: args.submissionTransactionHash
      })
      const quorum = await args.readRefundQuorum({
        intentHash: args.intentHash,
        submissionTxHash: args.submissionTransactionHash
      })
      if (quorum.ready && quorum.signatures.length >= 2) {
        await runTerminalTransaction(args, "proveRelayRefund", (onSubmitted) =>
          args.proveRelayRefund({
            proof: quorum.proof,
            signatures: quorum.signatures,
            onSubmitted
          })
        )
        status = await args.readAdapterStatus(args.intentHash)
      }
    } catch {
      // Elapsed time or provider status never substitutes for refund proof.
    }
  }
  return {
    intentHash: args.intentHash,
    status,
    completionRetry,
    state:
      status === 4
        ? "completed" as const
        : status === 5
          ? "refund_available" as const
          : status === 6
            ? "refunded" as const
            : "monitoring" as const
  }
}
