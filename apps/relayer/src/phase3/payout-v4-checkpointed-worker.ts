import type { CanonicalRelayExecutionPayload } from "@parly/shared-types"
import type { Hex } from "viem"

import type { PayoutV4RelayerAuthorityPayload, ValidatedPayoutV4PrivateBundle } from "./index.js"

type PayoutV4CheckpointStep = "acceptQuote" | "poolWithdraw"
type LocalCheckpoint = { transactionHash: Hex } | null
type PayoutV4TransactionOutcome = "pending" | "success" | "failed"

export type PayoutV4CheckpointedExecutionResult = {
  intentHash: Hex
  status: "withdrawal_confirmed" | "awaiting_downstream_worker"
}

export type PayoutV4CheckpointedExecutionArgs = {
  bundle: CanonicalRelayExecutionPayload
  executionAddress: `0x${string}`
  settlementDomainId: number
  readAdapterStatus: (intentHash: Hex) => Promise<number>
  claimAuthority: (intentHash: Hex) => Promise<{ authority: PayoutV4RelayerAuthorityPayload }>
  validateBundle: (args: {
    bundle: CanonicalRelayExecutionPayload
    authority: PayoutV4RelayerAuthorityPayload
    relayerOperatorAddress: `0x${string}`
    settlementDomainId: number
  }) => ValidatedPayoutV4PrivateBundle
  getLocalCheckpoint: (args: { intentHash: Hex; step: PayoutV4CheckpointStep }) => Promise<LocalCheckpoint>
  getLocalSubmissions: (args: { intentHash: Hex; step: PayoutV4CheckpointStep }) => Promise<Hex[]>
  readTransactionOutcome: (transactionHash: Hex) => Promise<PayoutV4TransactionOutcome>
  recordLocalSubmission: (args: {
    intentHash: Hex
    step: PayoutV4CheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  recordLocalCheckpoint: (args: {
    intentHash: Hex
    step: PayoutV4CheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  recordRemoteCheckpoint: (args: {
    intentHash: Hex
    step: PayoutV4CheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  acceptQuote: (args: {
    authority: PayoutV4RelayerAuthorityPayload
    binding: ValidatedPayoutV4PrivateBundle
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
  withdrawPoolBundle: (args: {
    binding: ValidatedPayoutV4PrivateBundle
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
}

function readIntentHash(bundle: CanonicalRelayExecutionPayload) {
  const intentHash = bundle.payoutV4?.intentHash
  if (!intentHash || !/^0x[a-fA-F0-9]{64}$/u.test(intentHash)) {
    throw new Error("V4 payout bundle is missing a valid intent hash.")
  }
  return intentHash.toLowerCase() as Hex
}

function readAdapterStatus(status: number) {
  if (!Number.isInteger(status) || status < 0 || status > 7) {
    throw new Error("V4 payout adapter returned an invalid status.")
  }
  return status
}

function readTransactionHash(transactionHash: Hex, step: PayoutV4CheckpointStep) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(transactionHash)) {
    throw new Error(`V4 ${step} did not return a transaction hash.`)
  }
  return transactionHash.toLowerCase() as Hex
}

async function replaySubmittedCheckpoint(args: {
  worker: PayoutV4CheckpointedExecutionArgs
  intentHash: Hex
  step: PayoutV4CheckpointStep
}) {
  const submissions = await args.worker.getLocalSubmissions({ intentHash: args.intentHash, step: args.step })
  for (const submittedHash of submissions) {
    const transactionHash = readTransactionHash(submittedHash, args.step)
    const outcome = await args.worker.readTransactionOutcome(transactionHash)
    if (outcome === "pending") {
      throw new Error(`V4 ${args.step} transaction is still pending.`)
    }
    if (outcome !== "success") continue
    await args.worker.recordLocalCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
    await args.worker.recordRemoteCheckpoint({ intentHash: args.intentHash, step: args.step, transactionHash })
    return true
  }
  return false
}

/**
 * Coordinates only the two irreversible source-side V4 actions. Later
 * destination/proof work is deliberately handed to the independent worker.
 */
export async function runPayoutV4CheckpointedExecution(
  args: PayoutV4CheckpointedExecutionArgs
): Promise<PayoutV4CheckpointedExecutionResult> {
  const intentHash = readIntentHash(args.bundle)
  const initialStatus = readAdapterStatus(await args.readAdapterStatus(intentHash))

  // Receipt confirmation and later states must never cause another local Pool
  // withdrawal. Their proof-controlled path is handled separately.
  if (initialStatus >= 2) {
    return { intentHash, status: "awaiting_downstream_worker" }
  }

  const claimed = await args.claimAuthority(intentHash)
  const binding = args.validateBundle({
    bundle: args.bundle,
    authority: claimed.authority,
    relayerOperatorAddress: args.executionAddress,
    settlementDomainId: args.settlementDomainId
  })
  if (binding.intentHash.toLowerCase() !== intentHash) {
    throw new Error("V4 payout authority does not match the private bundle.")
  }

  const acceptedCheckpoint = await args.getLocalCheckpoint({ intentHash, step: "acceptQuote" })
  if (initialStatus === 0) {
    if (acceptedCheckpoint) {
      throw new Error("V4 local quote checkpoint exists but the adapter has not accepted the quote.")
    }
    const replayed = await replaySubmittedCheckpoint({ worker: args, intentHash, step: "acceptQuote" })
    if (!replayed) {
      const accepted = await args.acceptQuote({
        authority: claimed.authority,
        binding,
        onSubmitted: async (submittedHash) => {
          await args.recordLocalSubmission({
            intentHash,
            step: "acceptQuote",
            transactionHash: readTransactionHash(submittedHash, "acceptQuote")
          })
        }
      })
      const transactionHash = readTransactionHash(accepted.transactionHash, "acceptQuote")
      await args.recordLocalCheckpoint({ intentHash, step: "acceptQuote", transactionHash })
      await args.recordRemoteCheckpoint({ intentHash, step: "acceptQuote", transactionHash })
    }
  } else {
    if (acceptedCheckpoint) {
      await args.recordRemoteCheckpoint({
        intentHash,
        step: "acceptQuote",
        transactionHash: readTransactionHash(acceptedCheckpoint.transactionHash, "acceptQuote")
      })
    } else if (!(await replaySubmittedCheckpoint({ worker: args, intentHash, step: "acceptQuote" }))) {
      throw new Error("V4 payout adapter accepted the quote without a durable local quote checkpoint.")
    }
  }

  const acceptedStatus = readAdapterStatus(await args.readAdapterStatus(intentHash))
  if (acceptedStatus >= 2) {
    return { intentHash, status: "awaiting_downstream_worker" }
  }
  if (acceptedStatus !== 1) {
    throw new Error("V4 payout quote acceptance was not confirmed on-chain.")
  }

  const withdrawalCheckpoint = await args.getLocalCheckpoint({ intentHash, step: "poolWithdraw" })
  if (withdrawalCheckpoint) {
    await args.recordRemoteCheckpoint({
      intentHash,
      step: "poolWithdraw",
      transactionHash: readTransactionHash(withdrawalCheckpoint.transactionHash, "poolWithdraw")
    })
    return { intentHash, status: "withdrawal_confirmed" }
  }

  const replayedWithdrawal = await replaySubmittedCheckpoint({ worker: args, intentHash, step: "poolWithdraw" })
  if (replayedWithdrawal) {
    return { intentHash, status: "withdrawal_confirmed" }
  }

  const withdrawal = await args.withdrawPoolBundle({
    binding,
    onSubmitted: async (submittedHash) => {
      await args.recordLocalSubmission({
        intentHash,
        step: "poolWithdraw",
        transactionHash: readTransactionHash(submittedHash, "poolWithdraw")
      })
    }
  })
  const transactionHash = readTransactionHash(withdrawal.transactionHash, "poolWithdraw")
  await args.recordLocalCheckpoint({ intentHash, step: "poolWithdraw", transactionHash })
  await args.recordRemoteCheckpoint({ intentHash, step: "poolWithdraw", transactionHash })
  return { intentHash, status: "withdrawal_confirmed" }
}
