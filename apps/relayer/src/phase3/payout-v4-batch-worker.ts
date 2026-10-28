import type { Hex } from "viem"

import type { PayoutV4RelayerAuthorityPayload, ValidatedPayoutV4PrivateBundle } from "./index.js"

type PayoutV4BatchCheckpointStep = "acceptQuote" | "poolWithdraw"
type LocalCheckpoint = { transactionHash: Hex } | null
type TransactionOutcome = "pending" | "success" | "failed"

export type PayoutV4BatchCheckpointedExecutionArgs = {
  intentHashes: readonly Hex[]
  readAdapterStatus: (intentHash: Hex) => Promise<number>
  claimAuthority: (intentHash: Hex) => Promise<{ authority: PayoutV4RelayerAuthorityPayload }>
  validateBundle: (args: {
    authorities: readonly PayoutV4RelayerAuthorityPayload[]
  }) => ValidatedPayoutV4PrivateBundle[]
  getLocalCheckpoint: (args: { intentHash: Hex; step: PayoutV4BatchCheckpointStep }) => Promise<LocalCheckpoint>
  getLocalSubmissions: (args: { intentHash: Hex; step: PayoutV4BatchCheckpointStep }) => Promise<Hex[]>
  readTransactionOutcome: (transactionHash: Hex) => Promise<TransactionOutcome>
  recordLocalSubmission: (args: {
    intentHash: Hex
    step: PayoutV4BatchCheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  recordLocalCheckpoint: (args: {
    intentHash: Hex
    step: PayoutV4BatchCheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  recordRemoteCheckpoint: (args: {
    intentHash: Hex
    step: PayoutV4BatchCheckpointStep
    transactionHash: Hex
  }) => Promise<void>
  acceptQuote: (args: {
    intentHash: Hex
    authority: PayoutV4RelayerAuthorityPayload
    binding: ValidatedPayoutV4PrivateBundle
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
  withdrawPoolBundle: (args: {
    bindings: readonly ValidatedPayoutV4PrivateBundle[]
    onSubmitted: (transactionHash: Hex) => Promise<void>
  }) => Promise<{ transactionHash: Hex }>
}

export type PayoutV4BatchCheckpointedExecutionResult = {
  intentHashes: Hex[]
  status: "withdrawal_confirmed" | "awaiting_downstream_worker"
}

function readIntentHashes(value: readonly Hex[]) {
  if (value.length < 2 || value.length > 10) throw new Error("V4 payout batch requires two to ten intents.")
  const normalized = value.map((intentHash) => {
    if (!/^0x[a-fA-F0-9]{64}$/u.test(intentHash)) throw new Error("V4 payout batch has an invalid intent hash.")
    return intentHash.toLowerCase() as Hex
  })
  if (new Set(normalized).size !== normalized.length) throw new Error("V4 payout batch has duplicate intent hashes.")
  return normalized
}

function readStatus(status: number) {
  if (!Number.isInteger(status) || status < 0 || status > 7) throw new Error("V4 payout adapter returned an invalid status.")
  return status
}

function readTransactionHash(transactionHash: Hex, step: PayoutV4BatchCheckpointStep) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(transactionHash)) {
    throw new Error(`V4 ${step} did not return a transaction hash.`)
  }
  return transactionHash.toLowerCase() as Hex
}

async function recordCheckpointForAll(args: {
  worker: PayoutV4BatchCheckpointedExecutionArgs
  intentHashes: readonly Hex[]
  step: PayoutV4BatchCheckpointStep
  transactionHash: Hex
  local: boolean
}) {
  for (const intentHash of args.intentHashes) {
    if (args.local) {
      await args.worker.recordLocalCheckpoint({ intentHash, step: args.step, transactionHash: args.transactionHash })
    }
    await args.worker.recordRemoteCheckpoint({ intentHash, step: args.step, transactionHash: args.transactionHash })
  }
}

async function replaySubmittedStep(args: {
  worker: PayoutV4BatchCheckpointedExecutionArgs
  intentHash: Hex
  step: PayoutV4BatchCheckpointStep
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

async function ensureAccepted(args: {
  worker: PayoutV4BatchCheckpointedExecutionArgs
  intentHash: Hex
  authority: PayoutV4RelayerAuthorityPayload
  binding: ValidatedPayoutV4PrivateBundle
}) {
  const initialStatus = readStatus(await args.worker.readAdapterStatus(args.intentHash))
  if (initialStatus >= 1) {
    const checkpoint = await args.worker.getLocalCheckpoint({ intentHash: args.intentHash, step: "acceptQuote" })
    if (checkpoint) {
      await args.worker.recordRemoteCheckpoint({
        intentHash: args.intentHash,
        step: "acceptQuote",
        transactionHash: readTransactionHash(checkpoint.transactionHash, "acceptQuote")
      })
      return
    }
    if (await replaySubmittedStep({ worker: args.worker, intentHash: args.intentHash, step: "acceptQuote" })) return
    throw new Error("V4 payout adapter accepted the quote without a durable local quote checkpoint.")
  }

  const checkpoint = await args.worker.getLocalCheckpoint({ intentHash: args.intentHash, step: "acceptQuote" })
  if (checkpoint) throw new Error("V4 local quote checkpoint exists but the adapter has not accepted the quote.")
  if (await replaySubmittedStep({ worker: args.worker, intentHash: args.intentHash, step: "acceptQuote" })) return
  const accepted = await args.worker.acceptQuote({
    intentHash: args.intentHash,
    authority: args.authority,
    binding: args.binding,
    onSubmitted: async (submittedHash) => {
      await args.worker.recordLocalSubmission({
        intentHash: args.intentHash,
        step: "acceptQuote",
        transactionHash: readTransactionHash(submittedHash, "acceptQuote")
      })
    }
  })
  const transactionHash = readTransactionHash(accepted.transactionHash, "acceptQuote")
  await args.worker.recordLocalCheckpoint({ intentHash: args.intentHash, step: "acceptQuote", transactionHash })
  await args.worker.recordRemoteCheckpoint({ intentHash: args.intentHash, step: "acceptQuote", transactionHash })
}

async function ensureSharedWithdrawal(args: {
  worker: PayoutV4BatchCheckpointedExecutionArgs
  intentHashes: readonly Hex[]
  bindings: readonly ValidatedPayoutV4PrivateBundle[]
}) {
  const local = await Promise.all(
    args.intentHashes.map((intentHash) => args.worker.getLocalCheckpoint({ intentHash, step: "poolWithdraw" }))
  )
  const localHashes = [...new Set(local.filter((entry): entry is { transactionHash: Hex } => Boolean(entry)).map((entry) => readTransactionHash(entry.transactionHash, "poolWithdraw")))]
  if (localHashes.length > 1) throw new Error("V4 payout batch has conflicting Pool withdrawal checkpoints.")
  if (localHashes.length === 1) {
    const sharedHash = localHashes[0]!
    for (let index = 0; index < args.intentHashes.length; index += 1) {
      if (local[index]) continue
      const submissions = await args.worker.getLocalSubmissions({
        intentHash: args.intentHashes[index]!,
        step: "poolWithdraw"
      })
      const hasConfirmedSharedSubmission = await Promise.all(
        submissions
          .map((transactionHash) => readTransactionHash(transactionHash, "poolWithdraw"))
          .filter((transactionHash) => transactionHash === sharedHash)
          .map(async (transactionHash) => (await args.worker.readTransactionOutcome(transactionHash)) === "success")
      )
      if (!hasConfirmedSharedSubmission.some(Boolean)) {
        throw new Error("V4 payout batch is missing a confirmed shared withdrawal submission.")
      }
    }
    await recordCheckpointForAll({
      worker: args.worker,
      intentHashes: args.intentHashes,
      step: "poolWithdraw",
      transactionHash: sharedHash,
      local: true
    })
    return
  }

  const replayed = new Set<Hex>()
  for (const intentHash of args.intentHashes) {
    const transactionHash = await replaySubmittedStep({ worker: args.worker, intentHash, step: "poolWithdraw" })
    if (transactionHash) replayed.add(transactionHash)
  }
  if (replayed.size > 1) throw new Error("V4 payout batch has conflicting Pool withdrawal submissions.")
  if (replayed.size === 1) {
    await recordCheckpointForAll({
      worker: args.worker,
      intentHashes: args.intentHashes,
      step: "poolWithdraw",
      transactionHash: [...replayed][0]!,
      local: true
    })
    return
  }

  const withdrawal = await args.worker.withdrawPoolBundle({
    bindings: args.bindings,
    onSubmitted: async (submittedHash) => {
      const transactionHash = readTransactionHash(submittedHash, "poolWithdraw")
      for (const intentHash of args.intentHashes) {
        await args.worker.recordLocalSubmission({ intentHash, step: "poolWithdraw", transactionHash })
      }
    }
  })
  await recordCheckpointForAll({
    worker: args.worker,
    intentHashes: args.intentHashes,
    step: "poolWithdraw",
    transactionHash: readTransactionHash(withdrawal.transactionHash, "poolWithdraw"),
    local: true
  })
}

/**
 * Coordinates the shared source withdrawal for a multi-recipient V4 payout.
 * It stops on any ambiguous on-chain state instead of retrying a Pool withdrawal.
 */
export async function runPayoutV4BatchCheckpointedExecution(
  args: PayoutV4BatchCheckpointedExecutionArgs
): Promise<PayoutV4BatchCheckpointedExecutionResult> {
  const intentHashes = readIntentHashes(args.intentHashes)
  const initialStatuses = await Promise.all(intentHashes.map(async (intentHash) => readStatus(await args.readAdapterStatus(intentHash))))
  if (initialStatuses.every((status) => status >= 2)) {
    return { intentHashes, status: "awaiting_downstream_worker" }
  }
  if (initialStatuses.some((status) => status >= 2)) {
    throw new Error("V4 payout batch has mixed escrow states and requires recovery review.")
  }

  const authorities = await Promise.all(intentHashes.map(async (intentHash) => (await args.claimAuthority(intentHash)).authority))
  const bindings = args.validateBundle({ authorities })
  if (bindings.length !== intentHashes.length) throw new Error("V4 payout batch binding count is invalid.")
  const bindingByIntent = new Map(bindings.map((binding) => [binding.intentHash.toLowerCase(), binding]))

  for (let index = 0; index < intentHashes.length; index += 1) {
    const intentHash = intentHashes[index]!
    const binding = bindingByIntent.get(intentHash.toLowerCase())
    const authority = authorities[index]!
    if (!binding || authority.intentHash.toLowerCase() !== intentHash.toLowerCase()) {
      throw new Error("V4 payout batch authority does not match the private bundle.")
    }
    await ensureAccepted({ worker: args, intentHash, authority, binding })
  }

  const acceptedStatuses = await Promise.all(intentHashes.map(async (intentHash) => readStatus(await args.readAdapterStatus(intentHash))))
  if (acceptedStatuses.every((status) => status >= 2)) {
    return { intentHashes, status: "awaiting_downstream_worker" }
  }
  if (acceptedStatuses.some((status) => status >= 2)) {
    throw new Error("V4 payout batch has mixed escrow states and requires recovery review.")
  }
  if (!acceptedStatuses.every((status) => status === 1)) {
    throw new Error("V4 payout batch quote acceptance was not confirmed on-chain.")
  }

  await ensureSharedWithdrawal({ worker: args, intentHashes, bindings })
  return { intentHashes, status: "withdrawal_confirmed" }
}
