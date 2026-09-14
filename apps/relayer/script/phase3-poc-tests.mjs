import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
  createMockFinalizerPocAuthorization,
  createMockFinalizerPocJobs,
  runFinalizerDryRunPoc
} from "./phase3-finalizer-poc.mjs"
import { runPayoutDryRunPoc } from "./phase3-payout-poc.mjs"

const phase3 = await import("../dist/apps/relayer/src/phase3/index.js")

test("finalizer POC prepares eligible payloads and skips unsafe jobs without broadcasting", async () => {
  const output = await runFinalizerDryRunPoc({
    phase3,
    jobs: createMockFinalizerPocJobs(),
    authorization: createMockFinalizerPocAuthorization()
  })

  assert.equal(output.dryRun, true)
  assert.deepEqual(output.prepared.map((item) => item.jobId), ["queued-poc-job"])
  assert.equal(output.prepared[0].broadcast, false)
  assert.equal(typeof output.prepared[0].idempotencyKey, "string")
  assert.equal(
    output.skipped.some(
      (item) => item.status === "queued" && item.observationEligibility === "pending_confirmations"
    ),
    true
  )
  assert.deepEqual(
    output.skipped.map((item) => item.status).sort(),
    ["confirmed", "ignored", "manual_review", "queued", "refund_available"].sort()
  )
  assert.equal(JSON.stringify(output).includes("private"), false)
})

test("finalizer POC source contains no transaction broadcaster or private-key logger", async () => {
  const source = await readFile(new URL("./phase3-finalizer-poc.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /\bsendTransaction\b|\bwriteContract\b|\bbroadcastTransaction\b/u)
  assert.doesNotMatch(source, /PRIVATE_KEY|FINALIZER_PRIVATE_KEY/u)
})

test("finalizer POC refuses jobs for an unregistered or emergency-blocked operator", async () => {
  const output = await runFinalizerDryRunPoc({
    phase3,
    jobs: createMockFinalizerPocJobs(),
    authorization: createMockFinalizerPocAuthorization(),
    eligibilityReader: {
      async isEligibleOperatorFor() {
        return false
      }
    }
  })

  assert.deepEqual(output.prepared, [])
  assert.equal(output.operatorEligible, false)
})

test("payout POC remains dry-run only and never implies operator escrow funding", async () => {
  const output = await runPayoutDryRunPoc({ phase3 })

  assert.equal(output.dryRun, true)
  assert.equal(output.broadcast, false)
  assert.equal(output.operatorFundsEscrow, false)
  assert.equal(output.status, "payout_submitted")
  assert.equal(output.amountOut, "900")
})

test("payout POC source contains no transaction broadcaster, signer, or private-key logger", async () => {
  const source = await readFile(new URL("./phase3-payout-poc.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /\bsendTransaction\b|\bwriteContract\b|\bbroadcastTransaction\b/u)
  assert.doesNotMatch(source, /PRIVATE_KEY|FINALIZER_PRIVATE_KEY|\bsignMessage\b|\bsignTypedData\b/u)
})
