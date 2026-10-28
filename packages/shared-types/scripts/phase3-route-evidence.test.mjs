import assert from "node:assert/strict"
import test from "node:test"
import {
  PHASE3_DISCLOSURE_FIELDS,
  PHASE3_RECEIPT_PROOF_TYPES,
  PHASE3_RECEIPT_SUBJECT_TYPES,
  PHASE3_ROUTE_EVIDENCE_CONTEXTS,
  isPhase3OwnerDepositReceiptSubject
} from "../dist/index.js"

test("owner deposits are route evidence contexts but never receipt subjects", () => {
  assert.ok(PHASE3_ROUTE_EVIDENCE_CONTEXTS.includes("owner_wallet_deposit"))
  assert.ok(PHASE3_ROUTE_EVIDENCE_CONTEXTS.includes("owner_one_time_deposit"))
  assert.equal(PHASE3_RECEIPT_SUBJECT_TYPES.includes("owner_wallet_deposit"), false)
  assert.equal(PHASE3_RECEIPT_SUBJECT_TYPES.includes("owner_one_time_deposit"), false)
  assert.equal(isPhase3OwnerDepositReceiptSubject("owner_wallet_deposit"), false)
  assert.equal(isPhase3OwnerDepositReceiptSubject("owner_one_time_deposit"), false)
})

test("existing verify proof models remain canonical", () => {
  assert.ok(PHASE3_RECEIPT_PROOF_TYPES.includes("tx_hash_child_key"))
  assert.ok(PHASE3_RECEIPT_PROOF_TYPES.includes("verification_token"))
  assert.equal(PHASE3_RECEIPT_PROOF_TYPES.includes("receipt_disclosure_key"), false)
  assert.equal(PHASE3_RECEIPT_PROOF_TYPES.includes("fragment_key"), false)
})

test("receipt disclosure fields cover source, payer, receiver, and funding references", () => {
  for (const field of [
    "source_chain",
    "source_tx",
    "source_wallet",
    "relay_request",
    "settlement_tx",
    "payer_display_name",
    "payer_reference",
    "receiver_public_profile",
    "invoice_label",
    "funding_source_reference"
  ]) {
    assert.ok(PHASE3_DISCLOSURE_FIELDS.includes(field), `missing disclosure field ${field}`)
  }
})
