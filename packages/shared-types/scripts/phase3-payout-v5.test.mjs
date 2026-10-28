import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCanonicalPayoutV5BatchAuthorizationMessage,
  PAYOUT_V5_EXECUTION_STEPS,
  PHASE3_PAYOUT_V5_STATUSES,
  mapPhase3PayoutV5EventToPublicLifecycle,
  projectPhase3PayoutV5EventForDatasource
} from "../dist/index.js"

test("V5 batch authorization binds ordered children and aggregate ceilings", () => {
  const message = buildCanonicalPayoutV5BatchAuthorizationMessage({
    wallet: "0x1111111111111111111111111111111111111111",
    sourceNoteNullifierHash: `0x${"22".repeat(32)}`,
    assetId: 2,
    sourcePool: "0x3333333333333333333333333333333333333333",
    sourceToken: "0x4444444444444444444444444444444444444444",
    quoteHashes: [`0x${"55".repeat(32)}`, `0x${"66".repeat(32)}`],
    recipientCount: 2,
    aggregateEscrowAmountBaseUnits: "2000000",
    aggregateExecutorFeeBaseUnits: "1000",
    aggregateProtocolFeeBaseUnits: "10000",
    aggregateDestinationAmountBaseUnits: "1800000",
    maximumTotalNoteDeductionBaseUnits: "2011000",
    earliestQuoteExpiresAt: 1_800_000_000,
    issuedAt: 1_799_999_000,
    nonce: "batch-authorization-nonce-123456"
  })
  assert.match(message, /Action: authorize-payout-v5-batch/u)
  assert.ok(message.indexOf(`Quote 1: 0x${"55".repeat(32)}`) < message.indexOf(`Quote 2: 0x${"66".repeat(32)}`))
  assert.match(message, /Maximum Total Note Deduction: 2011000/u)
  assert.match(message, /does not broadcast a wallet transaction or select a relayer/u)
})

test("V5 exposes the exact checkpoint order and zero-based contract statuses", () => {
  assert.deepEqual(PAYOUT_V5_EXECUTION_STEPS, [
    "acceptQuote",
    "poolWithdraw",
    "confirmEscrowReceipt",
    "submitPayout",
    "proveCompletion",
    "proveRelayRefund",
    "claimRefund"
  ])
  assert.deepEqual(PHASE3_PAYOUT_V5_STATUSES, [
    "none",
    "escrow_pending",
    "escrow_receipt_confirmed",
    "payout_submitted",
    "payout_completed",
    "refund_available",
    "refunded",
    "manual_review"
  ])
})

test("V5 submitted payouts cannot become refundable through timeout projection", () => {
  assert.deepEqual(
    mapPhase3PayoutV5EventToPublicLifecycle({ eventId: "v5-submit", eventType: "payout_submitted" })
      .map((event) => event.status),
    ["payout_pending", "payout_submitted"]
  )
  assert.throws(
    () => mapPhase3PayoutV5EventToPublicLifecycle({ eventId: "v5-refund", eventType: "relay_refund_proven" }),
    /evidence hash required/u
  )
})

test("V5 Relay refund requires proof authority and emits no liability effect", () => {
  const projection = projectPhase3PayoutV5EventForDatasource({
    eventId: "v5-refund",
    eventType: "relay_refund_proven",
    evidenceHash: "a".repeat(64)
  })
  assert.equal(projection.publicEvents[0].status, "refund_available")
  assert.equal(projection.publicEvents[0].authority, "proof_verifier")
  assert.equal(projection.requiredDatasourceEffects.includes("set:proof_kind=relay_refund"), true)
  assert.equal(projection.requiredDatasourceEffects.some((effect) => /liability/u.test(effect)), false)
})
