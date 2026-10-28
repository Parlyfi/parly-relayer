import type { Hex } from "viem"

type PayoutV4DownstreamStep = "confirmEscrowReceipt" | "submitPayout" | "completePayout"
type PayoutV4CheckpointStep = "poolWithdraw" | PayoutV4DownstreamStep
type LocalCheckpoint = { transactionHash: Hex } | null
type TransactionOutcome = "pending" | "success" | "failed"

export type PayoutV4DownstreamExecutionResult = {
  intentHash: Hex
  status: "awaiting_proof_quorum" | "completed"
}

export type PayoutV4DownstreamExecutionArgs = {
  bundle: { payoutV4?: { intentHash?: Hex } }
  executionAddress: `0x${string}`
  readAdapterStatus: (intentHash: Hex) => Promise<number>
  claimAuthority: (intentHash: Hex) => Promise<{ authority: unknown }>
  validateAuthority: (args: { authority: unknown; executionAddress: `0x${string}` }) => void
  getLocalCheckpoint: (args: { intentHash: Hex; step: PayoutV4CheckpointStep }) => Promise<LocalCheckpoint>
  getLocalSubmissions: (args: { intentHash: Hex; step: PayoutV4DownstreamStep }) => Promise<Hex[]>
  readTransactionOutcome: (transactionHash: Hex) => Promise<TransactionOutcome>
  recordLocalSubmission: (args: { intentHash: Hex; step: PayoutV4DownstreamStep; transactionHash: Hex }) => Promise<void>
  recordLocalCheckpoint: (args: { intentHash: Hex; step: PayoutV4DownstreamStep; transactionHash: Hex }) => Promise<void>
  recordRemoteCheckpoint: (args: { intentHash: Hex; step: PayoutV4DownstreamStep; transactionHash: Hex }) => Promise<void>
  requestProvenance: (args: { intentHash: Hex; withdrawalTxHash: Hex }) => Promise<{ attestation: unknown; signature: Hex }>
  confirmEscrowReceipt: (args: {
    provenance: { attestation: unknown; signature: Hex }
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
  submitPayout: (args: {
    authority: unknown
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
  requestProof: (args: { intentHash: Hex; submissionTxHash: Hex }) => Promise<{ proof: unknown; proofHash: Hex }>
  getProofQuorum: (args: {
    intentHash: Hex
    submissionTxHash: Hex
  }) => Promise<{ ready: boolean; proof: unknown; proofHash: Hex; signatures: Hex[] }>
  completePayout: (args: {
    proof: unknown
    signatures: Hex[]
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
}

function readIntentHash(bundle: PayoutV4DownstreamExecutionArgs["bundle"]) {
  const intentHash = bundle.payoutV4?.intentHash
  if (!intentHash || !/^0x[a-fA-F0-9]{64}$/u.test(intentHash)) throw new Error("V4 payout bundle is missing a valid intent hash.")
  return intentHash.toLowerCase() as Hex
}

function readStatus(status: number) {
  if (!Number.isInteger(status) || status < 0 || status > 7) throw new Error("V4 payout adapter returned an invalid status.")
  return status
}

function readTransactionHash(transactionHash: Hex, step: PayoutV4DownstreamStep) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(transactionHash)) throw new Error(`V4 ${step} did not return a transaction hash.`)
  return transactionHash.toLowerCase() as Hex
}

async function replaySubmittedCheckpoint(args: {
  worker: PayoutV4DownstreamExecutionArgs
  intentHash: Hex
  step: PayoutV4DownstreamStep
}) {
  const submissions = await args.worker.getLocalSubmissions({ intentHash: args.intentHash, step: args.step })
  for (const submittedHash of submissions) {
    const transactionHash = readTransactionHash(submittedHash, args.step)
    const outcome = await args.worker.readTransactionOutcome(transactionHash)
    if (outcome === "pending") throw new Error(`V4 ${args.step} transaction is still pending.`)
    if (outcome !== "success") continue
    await args.worker.recordLocalCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
    await args.worker.recordRemoteCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
    return transactionHash
  }
  return null
}

async function checkpointOrBroadcast(args: {
  worker: PayoutV4DownstreamExecutionArgs
  intentHash: Hex
  step: PayoutV4DownstreamStep
  broadcast: (onSubmitted: (transactionHash: Hex) => Promise<void>) => Promise<{ transactionHash: Hex }>
}) {
  const checkpoint = await args.worker.getLocalCheckpoint({ intentHash: args.intentHash, step: args.step })
  if (checkpoint) {
    const transactionHash = readTransactionHash(checkpoint.transactionHash, args.step)
    await args.worker.recordRemoteCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
    return transactionHash
  }
  const replayed = await replaySubmittedCheckpoint({ worker: args.worker, intentHash: args.intentHash, step: args.step })
  if (replayed) return replayed
  const result = await args.broadcast(async (submittedHash) => {
    await args.worker.recordLocalSubmission({
      intentHash: args.intentHash,
      step: args.step,
      transactionHash: readTransactionHash(submittedHash, args.step)
    })
  })
  const transactionHash = readTransactionHash(result.transactionHash, args.step)
  await args.worker.recordLocalCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
  await args.worker.recordRemoteCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
  return transactionHash
}

/**
 * Continues the V4 path only after the irreversible Pool withdrawal has a
 * durable checkpoint. The relayer submits transactions but never signs a
 * provenance or completion proof.
 */
export async function runPayoutV4DownstreamExecution(
  args: PayoutV4DownstreamExecutionArgs
): Promise<PayoutV4DownstreamExecutionResult> {
  const intentHash = readIntentHash(args.bundle)
  let status = readStatus(await args.readAdapterStatus(intentHash))
  if (status >= 4) return { intentHash, status: "completed" }
  if (status < 1) throw new Error("V4 payout has not accepted its quote.")

  const withdrawal = await args.getLocalCheckpoint({ intentHash, step: "poolWithdraw" })
  if (!withdrawal) throw new Error("V4 payout requires a durable local Pool withdrawal checkpoint.")
  const withdrawalTxHash = readTransactionHash(withdrawal.transactionHash, "confirmEscrowReceipt")

  if (status === 1) {
    const provenance = await args.requestProvenance({ intentHash, withdrawalTxHash })
    await checkpointOrBroadcast({
      worker: args,
      intentHash,
      step: "confirmEscrowReceipt",
      broadcast: (onSubmitted) => args.confirmEscrowReceipt({ provenance, onSubmitted })
    })
    status = readStatus(await args.readAdapterStatus(intentHash))
  }

  if (status === 2) {
    const claimed = await args.claimAuthority(intentHash)
    args.validateAuthority({ authority: claimed.authority, executionAddress: args.executionAddress })
    await checkpointOrBroadcast({
      worker: args,
      intentHash,
      step: "submitPayout",
      broadcast: (onSubmitted) => args.submitPayout({ authority: claimed.authority, onSubmitted })
    })
    status = readStatus(await args.readAdapterStatus(intentHash))
  }

  if (status >= 4) return { intentHash, status: "completed" }
  if (status !== 3) throw new Error("V4 payout submission was not confirmed on-chain.")

  const submission = await args.getLocalCheckpoint({ intentHash, step: "submitPayout" })
  if (!submission) throw new Error("V4 payout submitted without a durable local submission checkpoint.")
  const submissionTxHash = readTransactionHash(submission.transactionHash, "submitPayout")
  await args.requestProof({ intentHash, submissionTxHash })
  const quorum = await args.getProofQuorum({ intentHash, submissionTxHash })
  if (!quorum.ready || quorum.signatures.length < 2) return { intentHash, status: "awaiting_proof_quorum" }

  await checkpointOrBroadcast({
    worker: args,
    intentHash,
    step: "completePayout",
    broadcast: (onSubmitted) => args.completePayout({ proof: quorum.proof, signatures: quorum.signatures, onSubmitted })
  })
  status = readStatus(await args.readAdapterStatus(intentHash))
  if (status < 4) throw new Error("V4 payout completion was not confirmed on-chain.")
  return { intentHash, status: "completed" }
}
