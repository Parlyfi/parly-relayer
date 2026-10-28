import assert from "node:assert/strict"
import { test } from "node:test"

const workerModule = await import("../dist/apps/relayer/src/phase3/payout-v5-checkpointed-worker.js")
const batchWorkerModule = await import("../dist/apps/relayer/src/phase3/payout-v5-batch-worker.js")
const downstreamModule = await import("../dist/apps/relayer/src/phase3/payout-v5-downstream-worker.js")
const H = (character) => `0x${character.repeat(64)}`
const A = (character) => `0x${character.repeat(40)}`

function fixture({ status = 3, quorumReady = true, submissionCheckpoint = true } = {}) {
  const checkpoints = new Map(submissionCheckpoint ? [["submitPayout", H("b")]] : [])
  const actions = []
  const payload = {
    preparation: { intentHash: H("a"), quoteHash: H("a"), relayRequestId: "relay-request-fixture" },
    lease: { intentHash: H("a"), operator: A("1"), expiry: String(Math.floor(Date.now() / 1000) + 600) }
  }
  return {
    actions,
    args: {
      payload,
      executionAddress: A("1"),
      leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      readAdapterStatus: async () => status,
      readTransactionOutcome: async () => "success",
      getLocalCheckpoint: async ({ step }) => checkpoints.has(step) ? { transactionHash: checkpoints.get(step) } : null,
      getLocalSubmissions: async () => [],
      recordLocalSubmission: async ({ step, transactionHash }) => actions.push(`submitted:${step}:${transactionHash}`),
      recordLocalCheckpoint: async ({ step, transactionHash }) => { checkpoints.set(step, transactionHash); actions.push(`local:${step}`) },
      recordRemoteCheckpoint: async ({ step }) => actions.push(`remote:${step}`),
      acceptQuote: async () => { throw new Error("unexpected accept") },
      executeWithdrawal: async () => { throw new Error("unexpected withdrawal") },
      requestProvenance: async () => { throw new Error("unexpected provenance") },
      confirmEscrowReceipt: async () => { throw new Error("unexpected confirmation") },
      submitPayout: async () => { throw new Error("unexpected submission") },
      requestCompletionProof: async () => actions.push("attest"),
      readCompletionQuorum: async () => ({ ready: quorumReady, proof: { intentHash: H("a") }, signatures: quorumReady ? [H("c"), H("d")] : [H("c")] }),
      completePayout: async ({ onSubmitted }) => { await onSubmitted(H("e")); status = 4; actions.push("complete"); return { transactionHash: H("e") } },
      requestRefundProof: async () => { throw new Error("not refunded") },
      readRefundQuorum: async () => ({ ready: false, proof: {}, signatures: [] }),
      proveRelayRefund: async () => { throw new Error("unexpected refund proof") }
      ,observeRelayStatus: async () => actions.push("observed")
    }
  }
}

test("V5 waits for independent completion quorum without broadcasting", async () => {
  const value = fixture({ quorumReady: false })
  const result = await workerModule.runPayoutV5CheckpointedExecution(value.args)
  assert.equal(result.state, "awaiting_objective_delivery_proof")
  assert.deepEqual(value.actions, ["observed", "attest"])
})

test("V5 completes and checkpoints only after quorum", async () => {
  const value = fixture({ quorumReady: true })
  const result = await workerModule.runPayoutV5CheckpointedExecution(value.args)
  assert.equal(result.state, "completed")
  assert.ok(value.actions.includes("complete"))
  assert.ok(value.actions.includes("remote:proveCompletion"))
})

test("V5 submitted state fails closed without durable submission checkpoint", async () => {
  const value = fixture({ submissionCheckpoint: false })
  await assert.rejects(() => workerModule.runPayoutV5CheckpointedExecution(value.args), /durable checkpoint/u)
})

test("V5 proves a Relay refund only after refund quorum", async () => {
  const value = fixture({ quorumReady: false })
  value.args.requestRefundProof = async () => value.actions.push("refund-attest")
  value.args.readRefundQuorum = async () => ({ ready: true, proof: { intentHash: H("a") }, signatures: [H("c"), H("d")] })
  value.args.proveRelayRefund = async ({ onSubmitted }) => {
    await onSubmitted(H("f"))
    value.actions.push("refund-proven")
    return { transactionHash: H("f") }
  }
  value.args.readAdapterStatus = async () => value.actions.includes("refund-proven") ? 5 : 3
  const result = await workerModule.runPayoutV5CheckpointedExecution(value.args)
  assert.equal(result.state, "refund_available")
  assert.ok(value.actions.includes("remote:proveRelayRefund"))
})

function batchFixture({ statuses: initialStatuses = [0, 0], failSecondSubmission = false } = {}) {
  const intents = [H("1"), H("2")]
  const statuses = new Map(intents.map((intentHash, index) => [intentHash, initialStatuses[index] ?? 0]))
  const checkpoints = new Map()
  const submissions = new Map()
  const actions = []
  let rejectSecondSubmission = failSecondSubmission
  const preparations = intents.map((intentHash, index) => ({
    intentHash,
    quoteHash: H(index === 0 ? "3" : "4"),
    relayRequestId: `relay-request-${index + 1}`
  }))
  const payload = {
    preparations,
    lease: {
      intentHash: H("5"),
      operator: A("1"),
      expiry: String(Math.floor(Date.now() / 1000) + 600)
    }
  }
  const key = (intentHash, step) => `${intentHash}:${step}`
  return {
    actions,
    intents,
    statuses,
    allowSecondSubmission() {
      rejectSecondSubmission = false
    },
    args: {
      payload,
      executionAddress: A("1"),
      leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      readAdapterStatus: async (intentHash) => statuses.get(intentHash) ?? 0,
      readTransactionOutcome: async () => "success",
      getLocalCheckpoint: async ({ intentHash, step }) => checkpoints.get(key(intentHash, step)) ?? null,
      getLocalSubmissions: async ({ intentHash, step }) => submissions.get(key(intentHash, step)) ?? [],
      recordLocalSubmission: async ({ intentHash, step, transactionHash }) => {
        const submissionKey = key(intentHash, step)
        submissions.set(submissionKey, [...(submissions.get(submissionKey) ?? []), transactionHash])
        actions.push(`submitted:${step}:${intentHash}`)
      },
      recordLocalCheckpoint: async ({ intentHash, step, transactionHash }) => {
        checkpoints.set(key(intentHash, step), { transactionHash })
        actions.push(`local:${step}:${intentHash}`)
      },
      recordRemoteCheckpoint: async ({ intentHash, step }) => actions.push(`remote:${step}:${intentHash}`),
      acceptQuote: async ({ preparation, onSubmitted }) => {
        const transactionHash = preparation.intentHash === intents[0] ? H("6") : H("7")
        await onSubmitted(transactionHash)
        statuses.set(preparation.intentHash, 1)
        actions.push(`accept:${preparation.intentHash}`)
        return { transactionHash }
      },
      executeWithdrawal: async ({ onSubmitted }) => {
        const transactionHash = H("8")
        await onSubmitted(transactionHash)
        actions.push("withdraw")
        return { transactionHash }
      },
      requestProvenance: async ({ intentHash }) => {
        actions.push(`provenance:${intentHash}`)
        return { attestation: { intentHash }, signature: H("9") }
      },
      confirmEscrowReceipt: async ({ preparation, onSubmitted }) => {
        const transactionHash = preparation.intentHash === intents[0] ? H("a") : H("b")
        await onSubmitted(transactionHash)
        statuses.set(preparation.intentHash, 2)
        actions.push(`confirm:${preparation.intentHash}`)
        return { transactionHash }
      },
      submitPayout: async ({ preparation, onSubmitted }) => {
        if (rejectSecondSubmission && preparation.intentHash === intents[1]) {
          actions.push(`submit-failed:${preparation.intentHash}`)
          throw new Error("fixture child delivery unavailable")
        }
        const transactionHash = preparation.intentHash === intents[0] ? H("c") : H("d")
        await onSubmitted(transactionHash)
        statuses.set(preparation.intentHash, 3)
        actions.push(`submit:${preparation.intentHash}`)
        return { transactionHash }
      }
    }
  }
}

test("V5 batch accepts every child, performs one withdrawal, then submits children independently", async () => {
  const value = batchFixture()
  const result = await batchWorkerModule.runPayoutV5BatchCheckpointedExecution(value.args)
  assert.equal(result.state, "awaiting_independent_delivery")
  assert.deepEqual(result.intentHashes, value.intents)
  assert.equal(value.actions.filter((action) => action === "withdraw").length, 1)
  assert.equal(value.actions.filter((action) => action.startsWith("accept:")).length, 2)
  assert.equal(value.actions.filter((action) => action.startsWith("submit:")).length, 2)
  assert.deepEqual(value.intents.map((intentHash) => value.statuses.get(intentHash)), [3, 3])
})

test("V5 batch never rebroadcasts withdrawal after escrow state without a durable checkpoint", async () => {
  const value = batchFixture({ statuses: [2, 2] })
  await assert.rejects(
    () => batchWorkerModule.runPayoutV5BatchCheckpointedExecution(value.args),
    /withdrawal checkpoint requires recovery review/u
  )
  assert.equal(value.actions.includes("withdraw"), false)
})

test("V5 batch retry resumes only the failed child and never replays its successful sibling", async () => {
  const value = batchFixture({ failSecondSubmission: true })
  await assert.rejects(
    () => batchWorkerModule.runPayoutV5BatchCheckpointedExecution(value.args),
    /fixture child delivery unavailable/u
  )
  assert.deepEqual(value.intents.map((intentHash) => value.statuses.get(intentHash)), [3, 2])
  const firstChildSubmissions = value.actions.filter((action) => action === `submit:${value.intents[0]}`).length
  value.allowSecondSubmission()
  const result = await batchWorkerModule.runPayoutV5BatchCheckpointedExecution(value.args)
  assert.equal(result.state, "awaiting_independent_delivery")
  assert.equal(value.actions.filter((action) => action === "withdraw").length, 1)
  assert.equal(value.actions.filter((action) => action === `submit:${value.intents[0]}`).length, firstChildSubmissions)
  assert.equal(value.actions.filter((action) => action === `submit:${value.intents[1]}`).length, 1)
  assert.deepEqual(value.intents.map((intentHash) => value.statuses.get(intentHash)), [3, 3])
})

function downstreamFixture({ completionReady = true, pendingSubmission = false } = {}) {
  let status = 3
  const actions = []
  const submissions = pendingSubmission ? [H("9")] : []
  const args = {
    payload: { preparation: { intentHash: H("a"), relayRequestId: "relay-request-fixture" } },
    intentHash: H("a"),
    submissionTransactionHash: H("b"),
    readAdapterStatus: async () => status,
    readTransactionOutcome: async () => "pending",
    getLocalCheckpoint: async () => null,
    getLocalSubmissions: async ({ step }) => step === "proveCompletion" ? submissions : [],
    recordLocalSubmission: async ({ step }) => actions.push(`submitted:${step}`),
    recordLocalCheckpoint: async ({ step }) => actions.push(`local:${step}`),
    recordRemoteCheckpoint: async ({ step }) => actions.push(`remote:${step}`),
    observeRelayStatus: async () => { throw new Error("status unavailable") },
    requestCompletionProof: async () => actions.push("completion-requested"),
    readCompletionQuorum: async () => ({ ready: completionReady, proof: {}, signatures: completionReady ? [H("c"), H("d")] : [] }),
    completePayout: async ({ onSubmitted }) => { await onSubmitted(H("e")); status = 4; actions.push("completed"); return { transactionHash: H("e") } },
    requestRefundProof: async () => actions.push("refund-requested"),
    readRefundQuorum: async () => ({ ready: false, proof: {}, signatures: [] }),
    proveRelayRefund: async () => { throw new Error("unexpected refund") }
  }
  return { actions, args }
}

test("V5 downstream completion remains live when Relay status is unavailable", async () => {
  const value = downstreamFixture()
  const result = await downstreamModule.runPayoutV5DownstreamExecution(value.args)
  assert.equal(result.state, "completed")
  assert.ok(value.actions.includes("completed"))
  assert.ok(value.actions.includes("remote:proveCompletion"))
})

test("V5 downstream does not rebroadcast a pending terminal transaction", async () => {
  const value = downstreamFixture({ pendingSubmission: true })
  const result = await downstreamModule.runPayoutV5DownstreamExecution(value.args)
  assert.equal(result.state, "monitoring")
  assert.equal(value.actions.includes("completed"), false)
  assert.equal(value.actions.some((action) => action.startsWith("submitted:")), false)
})

test("V5 downstream refund remains blocked without independent quorum", async () => {
  const value = downstreamFixture({ completionReady: false })
  const result = await downstreamModule.runPayoutV5DownstreamExecution(value.args)
  assert.equal(result.state, "monitoring")
  assert.ok(value.actions.includes("refund-requested"))
  assert.equal(value.actions.some((action) => action.startsWith("submitted:proveRelayRefund")), false)
})
