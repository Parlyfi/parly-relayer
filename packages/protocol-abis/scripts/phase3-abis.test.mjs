import assert from "node:assert/strict"
import test from "node:test"
import {
  parlyPayoutAdapterV3Abi,
  parlyPayoutLiabilityVaultAbi,
  parlyPayoutProofVerifierAbi,
  parlyIngressReceiverAbi,
  parlyVirtualDepositMasterAbi,
  parlyRelayDepositAddressTargetAbi,
  parlyRelayOutboundProviderV2Abi
} from "../dist/index.js"

function abiNames(abi, type) {
  return new Set(abi.filter((item) => item.type === type).map((item) => item.name))
}

function abiItem(abi, type, name) {
  const item = abi.find((candidate) => candidate.type === type && candidate.name === name)
  assert.ok(item, `${name} ${type} missing`)
  return item
}

function tupleComponentNames(input) {
  return new Set((input.components ?? []).map((component) => component.name))
}

test("ParlyPayoutAdapterV3 ABI exposes the full lifecycle surface needed by clients and indexer", () => {
  const functions = abiNames(parlyPayoutAdapterV3Abi, "function")
  const events = abiNames(parlyPayoutAdapterV3Abi, "event")

  for (const name of [
    "acceptQuote",
    "confirmEscrowReceipt",
    "submitPayout",
    "completePayout",
    "makeRefundAvailableAfterDeadline",
    "makeEscrowRefundAvailableAfterDeadline",
    "startVerifierPausedRecovery",
    "claimRefund",
    "hashPayoutIntent",
    "hashProvenanceAttestation",
    "getPayoutRecord",
    "status",
    "setExecutionEnabled",
    "setPool",
    "setToken",
    "setProviderContract",
    "setDestinationChain",
    "setPayoutSigner",
    "setProvenanceSigner"
  ]) {
    assert.equal(functions.has(name), true, `${name} function missing`)
  }

  for (const name of [
    "QuoteAccepted",
    "EscrowReceiptConfirmed",
    "PayoutSubmitted",
    "PayoutCompleted",
    "EscrowRefundAvailable",
    "VerifierPausedRecoveryStarted",
    "RefundAvailable",
    "RefundClaimed",
    "PoolSet",
    "TokenSet",
    "ProviderContractSet",
    "DestinationChainSet",
    "PayoutSignerSet",
    "ProvenanceSignerSet",
    "ExecutionEnabledSet",
    "Paused",
    "Unpaused"
  ]) {
    assert.equal(events.has(name), true, `${name} event missing`)
  }

  const submitPayout = abiItem(parlyPayoutAdapterV3Abi, "function", "submitPayout")
  assert.equal(submitPayout.inputs.length, 3, "submitPayout must bind a revealed destination recipient")
  assert.equal(submitPayout.inputs[1].name, "destinationRecipient")
  assert.equal(submitPayout.inputs[1].type, "address")

  const acceptQuoteIntent = abiItem(parlyPayoutAdapterV3Abi, "function", "acceptQuote").inputs[0]
  const acceptQuoteFields = tupleComponentNames(acceptQuoteIntent)
  assert.equal(acceptQuoteFields.has("destinationRecipientHash"), true)
  assert.equal(acceptQuoteFields.has("destinationRecipient"), false)

  const payoutRecordFields = tupleComponentNames(
    abiItem(parlyPayoutAdapterV3Abi, "function", "getPayoutRecord").outputs[0]
  )
  assert.equal(payoutRecordFields.has("destinationRecipientHash"), true)
  assert.equal(payoutRecordFields.has("destinationRecipient"), false)
})

test("Phase 3 Relay provider V2 and deposit-address target ABIs expose bounded route controls", () => {
  const providerFunctions = abiNames(parlyRelayOutboundProviderV2Abi, "function")
  const providerEvents = abiNames(parlyRelayOutboundProviderV2Abi, "event")
  const targetFunctions = abiNames(parlyRelayDepositAddressTargetAbi, "function")
  const targetEvents = abiNames(parlyRelayDepositAddressTargetAbi, "event")

  for (const name of [
    "setRelayTarget",
    "setExecutionEnabled",
    "submitOutboundPayout",
    "approvedRelayRoutes",
    "consumedIntentHashes",
    "consumedRequestHashes"
  ]) {
    assert.equal(providerFunctions.has(name), true, `${name} provider V2 function missing`)
  }

  for (const name of ["setSourceToken", "setDestinationRoute", "executeRelay", "approvedSourceTokens"]) {
    assert.equal(targetFunctions.has(name), true, `${name} deposit target function missing`)
  }

  for (const name of ["RelayTargetSet", "RelayOutboundSubmitted", "ExecutionEnabledSet"]) {
    assert.equal(providerEvents.has(name), true, `${name} provider V2 event missing`)
  }

  for (const name of ["SourceTokenSet", "DestinationRouteSet", "RelayDepositSubmitted"]) {
    assert.equal(targetEvents.has(name), true, `${name} deposit target event missing`)
  }

  const executeRelay = abiItem(parlyRelayDepositAddressTargetAbi, "function", "executeRelay")
  assert.equal(executeRelay.inputs.length, 2)
  assert.equal(executeRelay.inputs[1].name, "targetData")
  assert.equal(executeRelay.inputs[1].type, "bytes")
})

test("Phase 3 payout V3 support ABIs expose liability and proof-verifier evidence events", () => {
  const liabilityFunctions = abiNames(parlyPayoutLiabilityVaultAbi, "function")
  const liabilityEvents = abiNames(parlyPayoutLiabilityVaultAbi, "event")
  const verifierFunctions = abiNames(parlyPayoutProofVerifierAbi, "function")
  const verifierEvents = abiNames(parlyPayoutProofVerifierAbi, "event")

  for (const name of [
    "setAdapter",
    "pause",
    "unpause",
    "deposit",
    "withdraw",
    "reserveLiability",
    "releaseLiability",
    "slashLiability",
    "getLiability"
  ]) {
    assert.equal(liabilityFunctions.has(name), true, `${name} liability function missing`)
  }

  for (const name of [
    "setSourceAdapter",
    "setSigner",
    "setForbiddenRole",
    "setThreshold",
    "advanceVerifierEpoch",
    "pause",
    "unpause",
    "verifyCompletionProof",
    "isProofConsumed"
  ]) {
    assert.equal(verifierFunctions.has(name), true, `${name} verifier function missing`)
  }

  for (const name of [
    "ProviderDeposit",
    "ProviderWithdrawal",
    "LiabilityReserved",
    "LiabilityReleased",
    "LiabilitySlashed",
    "Paused",
    "Unpaused"
  ]) {
    assert.equal(liabilityEvents.has(name), true, `${name} liability event missing`)
  }

  for (const name of [
    "SourceAdapterSet",
    "SignerSet",
    "ForbiddenRoleSet",
    "ThresholdSet",
    "VerifierEpochAdvanced",
    "CompletionProofVerified",
    "Paused",
    "Unpaused"
  ]) {
    assert.equal(verifierEvents.has(name), true, `${name} verifier event missing`)
  }
})

test("Phase 3 ingress and virtual master ABIs expose treasury-managed route controls", () => {
  const receiverFunctions = abiNames(parlyIngressReceiverAbi, "function")
  const masterFunctions = abiNames(parlyVirtualDepositMasterAbi, "function")

  for (const name of [
    "pause",
    "unpause",
    "paused",
    "setProvider",
    "setMaster",
    "setToken",
    "setPool",
    "setSettlementSigner",
    "approvedProviders",
    "approvedMasters",
    "approvedTokens",
    "approvedPools"
  ]) {
    assert.equal(receiverFunctions.has(name), true, `${name} ingress receiver function missing`)
  }

  for (const name of [
    "pause",
    "unpause",
    "paused",
    "setToken",
    "setSettlementSigner",
    "setAttemptSigner",
    "setObservationSigner",
    "approvedTokens",
    "settlementSigner",
    "attemptSigner",
    "observationSigner"
  ]) {
    assert.equal(masterFunctions.has(name), true, `${name} virtual master function missing`)
  }
})
