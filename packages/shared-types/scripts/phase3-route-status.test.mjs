import assert from "node:assert/strict"
import test from "node:test"
import {
  PHASE3_ATTEMPT_STATUSES,
  PHASE3_PAYOUT_STATUSES,
  PHASE3_PAYOUT_V3_STATUSES,
  PHASE3_ROUTE_KINDS,
  getPhase3PayoutStatusLabel,
  getPhase3PublicPayoutStatusLabel
} from "../dist/index.js"

test("Phase 3 route kinds contain only the approved routing model", () => {
  assert.deepEqual(PHASE3_ROUTE_KINDS, [
    "direct_tempo_deposit",
    "relay_multichain_deposit",
    "relay_connected_wallet_auto_shield",
    "direct_tempo_connected_wallet"
  ])
})

test("Phase 3 attempt statuses contain the approved public lifecycle", () => {
  assert.deepEqual(PHASE3_ATTEMPT_STATUSES, [
    "awaiting_payment",
    "payment_detected",
    "ignored",
    "settlement_in_progress",
    "shielding",
    "completed",
    "refund_available",
    "refund_claimed",
    "expired",
    "cancelled",
    "manual_review",
    "failed"
  ])
})

test("Phase 3 payout statuses contain the approved disabled-foundation lifecycle", () => {
  assert.deepEqual(PHASE3_PAYOUT_STATUSES, [
    "payout_requested",
    "quote_accepted",
    "escrow_address_reserved",
    "pool_withdrawal_pending",
    "escrow_receipt_confirmed",
    "payout_pending",
    "payout_submitted",
    "payout_completed",
    "payout_expired",
    "provider_failed",
    "manual_review",
    "refund_available",
    "refunded"
  ])
  assert.equal(getPhase3PayoutStatusLabel("escrow_receipt_confirmed"), "Escrow Receipt Confirmed")
  assert.equal(getPhase3PayoutStatusLabel("payout_completed"), "Payout Completed")
  assert.equal(getPhase3PublicPayoutStatusLabel("escrow_address_reserved"), "Payout Route Reserved")
  assert.equal(getPhase3PublicPayoutStatusLabel("escrow_receipt_confirmed"), "Withdrawal Received")
})

test("Phase 3 payout V3 statuses match the zero-based adapter enum", () => {
  assert.deepEqual(PHASE3_PAYOUT_V3_STATUSES, [
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
