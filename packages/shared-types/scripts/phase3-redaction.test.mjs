import assert from "node:assert/strict"
import test from "node:test"
import {
  redactPhase3AdminPaymentRecord,
  redactPhase3PublicInvoiceVerifyResult,
  redactPhase3PublicPaymentStatus
} from "../dist/index.js"

const sensitiveRecord = {
  paymentId: "payment_123",
  invoiceId: "invoice_123",
  status: "payment_detected",
  amount: "3.00",
  tokenSymbol: "USDC",
  payerWallet: "0x1111111111111111111111111111111111111111",
  refundWallet: "0x2222222222222222222222222222222222222222",
  recipientAuthorityWallet: "0x3333333333333333333333333333333333333333",
  providerRouteWallet: "0x4444444444444444444444444444444444444444",
  walletAddress: "0x6666666666666666666666666666666666666666",
  privateNoteIdentifier: "note_private_123",
  privateCommitment: "commitment_private_123",
  userTag: "tag_private_123",
  statusAccessToken: "status_token_private_123",
  campaignBeneficiaryUserId: "campaign_user_private_123",
  beneficiaryOwner: "0x7777777777777777777777777777777777777777",
  destinationRecipient: "0x8888888888888888888888888888888888888888",
  escrowAddress: "0x9999999999999999999999999999999999999999",
  providerRequestId: "relay-request-private",
  providerContract: "0x9999999999999999999999999999999999999998",
  sourceWithdrawalTxHash: `0x${"ab".repeat(32)}`,
  sourceWithdrawalLogIndex: 15,
  batchWithdrawalLogIndex: 16,
  sourceWithdrawalBlockNumber: 123,
  sourceWithdrawalBlockHash: `0x${"cd".repeat(32)}`,
  sourcePool: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  provenanceAttestationId: "private-provenance-attestation",
  refundRecipientCommitment: "refund-commitment-private",
  nested: {
    refundWallet: "0x5555555555555555555555555555555555555555",
    safeLabel: "Confirmed"
  }
}

const sensitiveKeys = [
  "payerWallet",
  "refundWallet",
  "recipientAuthorityWallet",
  "providerRouteWallet",
  "walletAddress",
  "privateNoteIdentifier",
  "privateCommitment",
  "userTag",
  "statusAccessToken",
  "campaignBeneficiaryUserId",
  "beneficiaryOwner",
  "destinationRecipient",
  "escrowAddress",
  "providerRequestId",
  "providerContract",
  "sourceWithdrawalTxHash",
  "sourceWithdrawalLogIndex",
  "batchWithdrawalLogIndex",
  "sourceWithdrawalBlockNumber",
  "sourceWithdrawalBlockHash",
  "sourcePool",
  "provenanceAttestationId",
  "refundRecipientCommitment"
]

function assertSensitiveFieldsRemoved(value) {
  const serialized = JSON.stringify(value)
  for (const key of sensitiveKeys) {
    assert.equal(serialized.includes(key), false, `${key} must be redacted`)
  }
  assert.equal(serialized.includes("0x1111111111111111111111111111111111111111"), false)
  assert.equal(serialized.includes("0x5555555555555555555555555555555555555555"), false)
}

test("public invoice verification removes sensitive wallets and private note identifiers", () => {
  const result = redactPhase3PublicInvoiceVerifyResult(sensitiveRecord)

  assert.equal(result.invoiceId, "invoice_123")
  assert.equal(result.status, "payment_detected")
  assertSensitiveFieldsRemoved(result)
})

test("public payment status removes raw wallet addresses recursively", () => {
  const result = redactPhase3PublicPaymentStatus(sensitiveRecord)

  assert.equal(result.paymentId, "payment_123")
  assert.equal(result.status, "payment_detected")
  assertSensitiveFieldsRemoved(result)
})

test("admin export redaction removes sensitive fields unless explicitly privileged", () => {
  const redacted = redactPhase3AdminPaymentRecord(sensitiveRecord)
  assertSensitiveFieldsRemoved(redacted)

  const privileged = redactPhase3AdminPaymentRecord(sensitiveRecord, { privileged: true })
  assert.equal(privileged.refundWallet, sensitiveRecord.refundWallet)
  assert.equal(privileged.nested.refundWallet, sensitiveRecord.nested.refundWallet)
})
