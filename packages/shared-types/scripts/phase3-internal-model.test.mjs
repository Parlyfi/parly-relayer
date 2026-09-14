import assert from "node:assert/strict"
import test from "node:test"
import {
  PHASE3_CAMPAIGN_ATTRIBUTION_FLOWS,
  PHASE3_CAMPAIGN_ATTRIBUTION_REJECTION_REASONS,
  PHASE3_CAMPAIGN_ATTRIBUTION_SOURCES,
  PHASE3_CAMPAIGN_ATTRIBUTION_STATUSES,
  PHASE3_CAMPAIGN_AWARD_CATEGORIES,
  PHASE3_INTERNAL_RECORD_KINDS,
  assertPhase3StatusTokenNotInternalId,
  redactPhase3AdminPaymentRecord
} from "../dist/index.js"

const ADDRESS_A = "0x1111111111111111111111111111111111111111"
const ADDRESS_B = "0x2222222222222222222222222222222222222222"

test("Phase 3 internal record kinds cover persistence and finalizer source records", () => {
  assert.deepEqual(PHASE3_INTERNAL_RECORD_KINDS, [
    "payment_attempt",
    "route_record",
    "virtual_deposit_observation",
    "receipt",
    "invoice_verify",
    "refund_claim",
    "finalizer_job",
    "payout_record",
    "phase3_campaign_attribution",
    "admin_redacted_export"
  ])
})

test("Phase 3 payout records redact private withdrawal and destination linkage", () => {
  const redacted = redactPhase3AdminPaymentRecord({
    kind: "payout_record",
    paymentId: "payout_public_1",
    status: "payout_pending",
    payoutId: "payout_public_1",
    destinationRecipient: ADDRESS_A,
    escrowAddress: ADDRESS_B,
    providerRequestId: "relay-request-private",
    sourceWithdrawalTxHash: `0x${"ab".repeat(32)}`,
    refundRecipientCommitment: "refund-commitment-private"
  })
  const serialized = JSON.stringify(redacted)

  assert.equal(serialized.includes(ADDRESS_A), false)
  assert.equal(serialized.includes(ADDRESS_B), false)
  assert.equal(serialized.includes("relay-request-private"), false)
  assert.equal(serialized.includes("sourceWithdrawalTxHash"), false)
  assert.equal(serialized.includes("refundRecipientCommitment"), false)
})

test("Phase 3 campaign attribution records remain internal and redact beneficiary fields", () => {
  const redacted = redactPhase3AdminPaymentRecord({
    kind: "phase3_campaign_attribution",
    paymentId: "payment_public_1",
    status: "completed",
    internalPaymentAttemptId: "attempt_internal_1",
    campaignBeneficiaryUserId: "campaign_user_1",
    beneficiaryOwnerHash: "owner-hash-private",
    attributionSource: "authenticated_account_owner",
    attributionFlow: "connected_wallet_shield",
    awardCategory: "shield_deposit_finalized",
    verificationStatus: "verified",
    idempotencyKey: "phase3:campaign:private"
  })
  const serialized = JSON.stringify(redacted)

  assert.equal(serialized.includes("campaign_user_1"), false)
  assert.equal(serialized.includes(ADDRESS_A), false)
  assert.equal(serialized.includes("owner-hash-private"), false)
  assert.equal(serialized.includes("campaignBeneficiaryUserId"), false)
  assert.equal(serialized.includes("beneficiaryOwnerHash"), false)
  assert.equal(serialized.includes("idempotencyKey"), false)
})

test("Phase 3 campaign attribution model names approved flows, sources, and award categories", () => {
  assert.deepEqual(PHASE3_CAMPAIGN_ATTRIBUTION_FLOWS, [
    "connected_wallet_shield",
    "one_time_deposit_funding",
    "privacy_link_payment",
    "profile_payment",
    "direct_tempo_payment"
  ])
  assert.deepEqual(PHASE3_CAMPAIGN_ATTRIBUTION_SOURCES, [
    "authenticated_account_owner",
    "profile_beneficiary_owner",
    "authenticated_claimant",
    "campaign_account_owner"
  ])
  assert.deepEqual(PHASE3_CAMPAIGN_AWARD_CATEGORIES, [
    "shield_deposit_finalized",
    "private_payment_received"
  ])
  assert.deepEqual(PHASE3_CAMPAIGN_ATTRIBUTION_STATUSES, [
    "pending",
    "verified",
    "rejected",
    "awarded"
  ])
  assert.equal(
    PHASE3_CAMPAIGN_ATTRIBUTION_REJECTION_REASONS.includes("infrastructure_address_candidate"),
    true
  )
  assert.equal(
    PHASE3_CAMPAIGN_ATTRIBUTION_REJECTION_REASONS.includes("payer_credit_disabled"),
    true
  )
})

test("status access token must not equal raw internal IDs", () => {
  assert.throws(
    () =>
      assertPhase3StatusTokenNotInternalId({
        statusAccessToken: "attempt_internal_1",
        internalIds: ["attempt_internal_1", "route_internal_1"]
      }),
    /must not equal an internal id/u
  )

  assert.doesNotThrow(() =>
    assertPhase3StatusTokenNotInternalId({
      statusAccessToken: "unguessable_status_token",
      internalIds: ["attempt_internal_1", "route_internal_1"]
    })
  )
})

test("admin redacted export records can carry public fields without sensitive wallets", () => {
  const redacted = redactPhase3AdminPaymentRecord({
    kind: "admin_redacted_export",
    paymentId: "payment_public_1",
    internalPaymentAttemptId: "attempt_internal_1",
    status: "completed",
    amount: "3.00",
    payerWallet: ADDRESS_A,
    refundWallet: ADDRESS_B,
    publicPaymentId: "payment_public_1"
  })
  const serialized = JSON.stringify(redacted)

  assert.equal(redacted.kind, "admin_redacted_export")
  assert.equal(redacted.paymentId, "payment_public_1")
  assert.equal(serialized.includes(ADDRESS_A), false)
  assert.equal(serialized.includes(ADDRESS_B), false)
})
