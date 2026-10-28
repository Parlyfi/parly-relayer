import assert from "node:assert/strict"
import { test } from "node:test"

const worker = await import("../dist/apps/relayer/src/phase3/payout-v4-batch-worker.js")

const ONE = `0x${"1".repeat(64)}`
const TWO = `0x${"2".repeat(64)}`
const THREE = `0x${"3".repeat(64)}`
const FOUR = `0x${"4".repeat(64)}`

function fixture(overrides = {}) {
  const events = []
  const statuses = new Map([
    [ONE, 0],
    [TWO, 0]
  ])
  const checkpoints = new Map()
  const submissions = new Map()
  const bindings = [
    { intentHash: ONE, escrow: "0x1111111111111111111111111111111111111111", amountIn: 1_000_000n },
    { intentHash: TWO, escrow: "0x2222222222222222222222222222222222222222", amountIn: 2_000_000n }
  ]
  const authority = (intentHash) => ({ intentHash, payoutAuthority: "0x3333333333333333333333333333333333333333" })
  const checkpointKey = (intentHash, step) => `${intentHash}:${step}`

  return {
    events,
    statuses,
    checkpoints,
    submissions,
    args: {
      intentHashes: [ONE, TWO],
      readAdapterStatus: async (intentHash) => statuses.get(intentHash) ?? 0,
      claimAuthority: async (intentHash) => {
        events.push(`claim:${intentHash}`)
        return { authority: authority(intentHash) }
      },
      validateBundle: ({ authorities }) => {
        events.push(`validate:${authorities.length}`)
        return bindings
      },
      getLocalCheckpoint: async ({ intentHash, step }) => checkpoints.get(checkpointKey(intentHash, step)) ?? null,
      getLocalSubmissions: async ({ intentHash, step }) => submissions.get(checkpointKey(intentHash, step)) ?? [],
      readTransactionOutcome: async () => "failed",
      recordLocalSubmission: async ({ intentHash, step, transactionHash }) => {
        events.push(`submitted:${intentHash}:${step}:${transactionHash}`)
        const key = checkpointKey(intentHash, step)
        submissions.set(key, [...(submissions.get(key) ?? []), transactionHash])
      },
      recordLocalCheckpoint: async ({ intentHash, step, transactionHash }) => {
        events.push(`local:${intentHash}:${step}:${transactionHash}`)
        checkpoints.set(checkpointKey(intentHash, step), { transactionHash })
      },
      recordRemoteCheckpoint: async ({ intentHash, step, transactionHash }) => {
        events.push(`remote:${intentHash}:${step}:${transactionHash}`)
      },
      acceptQuote: async ({ intentHash, onSubmitted }) => {
        const transactionHash = intentHash === ONE ? THREE : FOUR
        events.push(`accept:${intentHash}`)
        await onSubmitted(transactionHash)
        statuses.set(intentHash, 1)
        return { transactionHash }
      },
      withdrawPoolBundle: async ({ onSubmitted }) => {
        events.push("withdraw")
        await onSubmitted(FOUR)
        return { transactionHash: FOUR }
      },
      ...overrides
    }
  }
}

test("V4 batch worker accepts every intent before one shared Pool withdrawal", async () => {
  const run = fixture()
  const result = await worker.runPayoutV4BatchCheckpointedExecution(run.args)

  assert.deepEqual(result, { intentHashes: [ONE, TWO], status: "withdrawal_confirmed" })
  assert.ok(run.events.indexOf(`accept:${ONE}`) < run.events.indexOf("withdraw"))
  assert.ok(run.events.indexOf(`accept:${TWO}`) < run.events.indexOf("withdraw"))
  assert.equal(run.events.filter((event) => event === "withdraw").length, 1)
  assert.deepEqual(run.checkpoints.get(`${ONE}:poolWithdraw`), { transactionHash: FOUR })
  assert.deepEqual(run.checkpoints.get(`${TWO}:poolWithdraw`), { transactionHash: FOUR })
})

test("V4 batch worker never withdraws when any accepted intent has advanced independently", async () => {
  const run = fixture({
    readAdapterStatus: async (intentHash) => (intentHash === ONE ? 2 : 1),
    withdrawPoolBundle: async () => {
      throw new Error("must not withdraw")
    }
  })

  await assert.rejects(
    () => worker.runPayoutV4BatchCheckpointedExecution(run.args),
    /mixed escrow states/i
  )
})

test("V4 batch worker replays one confirmed shared withdrawal without broadcasting another", async () => {
  const run = fixture({
    readAdapterStatus: async () => 1,
    getLocalCheckpoint: async ({ intentHash, step }) =>
      step === "poolWithdraw" ? { transactionHash: THREE } : { transactionHash: FOUR },
    withdrawPoolBundle: async () => {
      throw new Error("must not withdraw")
    }
  })

  const result = await worker.runPayoutV4BatchCheckpointedExecution(run.args)
  assert.deepEqual(result, { intentHashes: [ONE, TWO], status: "withdrawal_confirmed" })
  assert.equal(run.events.includes("withdraw"), false)
})

test("V4 batch worker rejects a partial withdrawal checkpoint without a shared submission", async () => {
  const run = fixture({
    readAdapterStatus: async () => 1,
    getLocalCheckpoint: async ({ intentHash, step }) =>
      step === "acceptQuote"
        ? { transactionHash: FOUR }
        : intentHash === ONE
          ? { transactionHash: THREE }
          : null,
    getLocalSubmissions: async () => [],
    withdrawPoolBundle: async () => {
      throw new Error("must not withdraw")
    }
  })

  await assert.rejects(
    () => worker.runPayoutV4BatchCheckpointedExecution(run.args),
    /shared withdrawal submission/i
  )
})
