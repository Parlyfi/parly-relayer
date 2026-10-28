import assert from "node:assert/strict"

import {
  classifyPayoutV5RelayStatus,
  payoutV5RelayTransactionHashes
} from "../dist/apps/relayer/src/phase3/payout-v5-status-worker.js"

const a = `0x${"11".repeat(32)}`
const b = `0x${"22".repeat(32)}`

assert.equal(classifyPayoutV5RelayStatus({ status: "success" }), "destination_candidate")
assert.equal(classifyPayoutV5RelayStatus({ status: "pending" }), "processing")
assert.equal(classifyPayoutV5RelayStatus({ status: "refunded" }), "refund_candidate")
assert.equal(classifyPayoutV5RelayStatus({ status: "failed" }), "terminal_unresolved")
assert.equal(classifyPayoutV5RelayStatus({ status: "success", details: { state: "refunded" } }), "terminal_unresolved")
assert.equal(classifyPayoutV5RelayStatus({ unexpected: true }), "terminal_unresolved")
assert.deepEqual(
  payoutV5RelayTransactionHashes({ inTxHashes: [a], details: [{ txHashes: [b, a] }] }),
  [a, b]
)
assert.deepEqual(payoutV5RelayTransactionHashes({ txHashes: ["not-a-hash"], hash: a }), [])

console.log("Phase 3 payout V5 status worker tests passed (8/8).")
