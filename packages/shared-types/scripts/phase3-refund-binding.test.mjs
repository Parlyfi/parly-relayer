import assert from "node:assert/strict"
import test from "node:test"
import {
  PHASE3_PAYMENT_CONTEXTS,
  REFUND_CLAIMANT_BINDINGS,
  assertRefundClaimantBinding,
  getRefundClaimantBinding
} from "../dist/index.js"

const expectedBindings = {
  shield_self_funding: "authenticated_connected_wallet",
  privacy_link_pay_with_wallet: "connected_payer_wallet",
  privacy_link_one_time_address: "payer_entered_refund_wallet"
}

test("each Phase 3 payment context has one locked refund claimant binding", () => {
  assert.deepEqual(PHASE3_PAYMENT_CONTEXTS, Object.keys(expectedBindings))
  assert.deepEqual(REFUND_CLAIMANT_BINDINGS, Object.values(expectedBindings))

  for (const [context, expected] of Object.entries(expectedBindings)) {
    assert.equal(getRefundClaimantBinding(context), expected)
  }
})

test("refund claimant binding assertion rejects an override", () => {
  assert.throws(
    () => assertRefundClaimantBinding("shield_self_funding", "payer_entered_refund_wallet"),
    /refund claimant binding mismatch/i
  )
})
