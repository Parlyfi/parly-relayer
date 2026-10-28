import assert from "node:assert/strict"
import { test } from "node:test"

const downstream = await import("../dist/apps/relayer/src/phase3/payout-v4-downstream-worker.js")

const HASH_A = `0x${"a".repeat(64)}`
const HASH_B = `0x${"b".repeat(64)}`
const HASH_C = `0x${"c".repeat(64)}`
const RELAYER = "0x1111111111111111111111111111111111111111"

function makeWorker({ initialStatus = 1, proofReady = false, withSubmitCheckpoint = true } = {}) {
  let status = initialStatus
  const checkpoints = new Map()
  if (initialStatus >= 1) checkpoints.set("poolWithdraw", HASH_A)
  if (withSubmitCheckpoint && initialStatus >= 3) checkpoints.set("submitPayout", HASH_B)
  const actions = []
  const authority = {
    version: 4,
    intentHash: HASH_A,
    payoutAuthority: RELAYER,
    intent: { payoutAuthority: RELAYER },
    destinationRecipient: "0x2222222222222222222222222222222222222222",
    providerData: "0x1234"
  }
  const proof = { intentHash: HASH_A, destinationTxHash: HASH_C }
  return {
    actions,
    worker: {
      bundle: { payoutV4: { intentHash: HASH_A } },
      executionAddress: RELAYER,
      readAdapterStatus: async () => status,
      claimAuthority: async () => ({ authority }),
      validateAuthority: ({ authority: received }) => {
        assert.equal(received, authority)
      },
      getLocalCheckpoint: async ({ step }) => checkpoints.get(step) ? { transactionHash: checkpoints.get(step) } : null,
      getLocalSubmissions: async () => [],
      readTransactionOutcome: async () => "success",
      recordLocalSubmission: async ({ step, transactionHash }) => actions.push(`local-submitted:${step}:${transactionHash.slice(2, 6)}`),
      recordLocalCheckpoint: async ({ step, transactionHash }) => {
        checkpoints.set(step, transactionHash)
        actions.push(`local-checkpoint:${step}:${transactionHash.slice(2, 6)}`)
      },
      recordRemoteCheckpoint: async ({ step, transactionHash }) => actions.push(`remote-checkpoint:${step}:${transactionHash.slice(2, 6)}`),
      requestProvenance: async () => ({ attestation: { intentHash: HASH_A }, signature: `0x${"1".repeat(130)}` }),
      confirmEscrowReceipt: async ({ onSubmitted }) => {
        await onSubmitted(HASH_A)
        status = 2
        actions.push("confirm")
        return { transactionHash: HASH_A }
      },
      submitPayout: async ({ authority: received, onSubmitted }) => {
        assert.equal(received, authority)
        await onSubmitted(HASH_B)
        status = 3
        actions.push("submit")
        return { transactionHash: HASH_B }
      },
      requestProof: async () => ({ proof, proofHash: HASH_C }),
      getProofQuorum: async () => ({ ready: proofReady, proof, proofHash: HASH_C, signatures: proofReady ? [`0x${"2".repeat(130)}`, `0x${"3".repeat(130)}`] : [`0x${"2".repeat(130)}`] }),
      completePayout: async ({ onSubmitted, signatures }) => {
        assert.equal(signatures.length, 2)
        await onSubmitted(HASH_C)
        status = 4
        actions.push("complete")
        return { transactionHash: HASH_C }
      }
    }
  }
}

test("V4 downstream path confirms escrow and submits before waiting for proof quorum", async () => {
  const fixture = makeWorker({ initialStatus: 1, proofReady: false })
  const result = await downstream.runPayoutV4DownstreamExecution(fixture.worker)
  assert.equal(result.status, "awaiting_proof_quorum")
  assert.deepEqual(fixture.actions.filter((value) => ["confirm", "submit", "complete"].includes(value)), ["confirm", "submit"])
  assert.ok(fixture.actions.some((value) => value.startsWith("remote-checkpoint:confirmEscrowReceipt")))
  assert.ok(fixture.actions.some((value) => value.startsWith("remote-checkpoint:submitPayout")))
  assert.ok(!fixture.actions.includes("complete"))
})

test("V4 downstream path completes only after two independently supplied signatures", async () => {
  const fixture = makeWorker({ initialStatus: 3, proofReady: true, withSubmitCheckpoint: true })
  const result = await downstream.runPayoutV4DownstreamExecution(fixture.worker)
  assert.equal(result.status, "completed")
  assert.deepEqual(fixture.actions.filter((value) => ["confirm", "submit", "complete"].includes(value)), ["complete"])
  assert.ok(fixture.actions.some((value) => value.startsWith("remote-checkpoint:completePayout")))
})

test("V4 downstream path fails closed when submitted state lacks a durable submission checkpoint", async () => {
  const fixture = makeWorker({ initialStatus: 3, proofReady: true, withSubmitCheckpoint: false })
  await assert.rejects(
    () => downstream.runPayoutV4DownstreamExecution(fixture.worker),
    /durable local submission checkpoint/u
  )
  assert.deepEqual(fixture.actions, [])
})

test("V4 downstream path never broadcasts after completion", async () => {
  const fixture = makeWorker({ initialStatus: 4, proofReady: true })
  const result = await downstream.runPayoutV4DownstreamExecution(fixture.worker)
  assert.equal(result.status, "completed")
  assert.deepEqual(fixture.actions, [])
})
