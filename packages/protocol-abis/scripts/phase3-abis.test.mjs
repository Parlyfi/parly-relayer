import assert from "node:assert/strict"
import test from "node:test"
import { decodeErrorResult, encodeErrorResult } from "viem"
import {
  parlyPayoutAdapterV3Abi,
  parlyPayoutAdapterV4Abi,
  parlyPayoutAdapterV5Abi,
  parlyPayoutAdapterV6Abi,
  parlyPayoutEscrowFactoryV5Abi,
  parlyPayoutWithdrawalExecutorAbi,
  parlyPayoutLiabilityVaultAbi,
  parlyPayoutProofVerifierAbi,
  parlyIngressReceiverAbi,
  parlyVirtualDepositMasterAbi,
  parlyVirtualDepositMasterV2Abi,
  parlyVirtualDepositMasterAttemptRegistrationAbi,
  parlyVirtualDepositMasterObservationRecordingAbi,
  parlyRelayDepositAddressTargetAbi,
  parlyRelayRouterTargetAbi,
  parlyRelayTransactionTargetAbi,
  parlyRelayOutboundProviderV2Abi,
  parlyRelayOutboundProviderV3Abi,
  parlyRelayOutboundProviderV4Abi
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

function abiInputNames(item) {
  return new Set((item.inputs ?? []).map((input) => input.name))
}

test("replacement master ABI excludes manual owner recovery and exposes expiry refunds", () => {
  const functions = abiNames(parlyVirtualDepositMasterV2Abi, "function")
  for (const name of ["registerAttempt", "recordDepositObservation", "makeRefundAvailable",
    "makeQuarantineRefundAvailable", "claimRefund", "pendingRefunds"]) {
    assert.equal(functions.has(name), false, `${name} is retired from the replacement`)
    assert.equal(abiNames(parlyVirtualDepositMasterAbi, "function").has(name), true,
      "historical ABI is not rewritten")
  }
  for (const name of ["registerAttemptWithAuthorization", "recordDepositObservationWithAttestation",
    "claimRefundAfterExpiry", "claimObservedRefundAfterExpiry", "refundClaim"]) {
    assert.equal(functions.has(name), true, `${name} replacement entrypoint missing`)
  }
  assert.equal(abiNames(parlyVirtualDepositMasterV2Abi, "event").has("RefundMadeAvailable"), false)
  const attribution = abiItem(parlyVirtualDepositMasterV2Abi, "event", "RefundAttributed")
  assert.deepEqual(attribution.inputs.filter((input) => input.indexed).map((input) => input.name),
    ["claimId", "attemptId", "token"])
  for (const narrow of [parlyVirtualDepositMasterAttemptRegistrationAbi, parlyVirtualDepositMasterObservationRecordingAbi]) {
    for (const item of narrow) {
      assert.deepEqual(item, abiItem(parlyVirtualDepositMasterV2Abi, item.type, item.name))
    }
  }
})

test("replacement master custom errors can be decoded without changing the historical ABI", () => {
  for (const name of ["InvalidToken", "InvalidAttemptSignature", "ObservationAttestationNonceConsumed",
    "UnbackedObservation", "MainnetRegistryBlocked", "RefundBindingMismatch"]) {
    const data = encodeErrorResult({ abi: parlyVirtualDepositMasterV2Abi, errorName: name })
    assert.equal(data.length, 10, "argument-free custom error is four bytes")
    assert.equal(decodeErrorResult({ abi: parlyVirtualDepositMasterV2Abi, data }).errorName, name)
    assert.equal(abiNames(parlyVirtualDepositMasterAbi, "error").has(name), false)
  }
})

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

test("ParlyPayoutAdapterV4 ABI exposes bounded relayer-fee accounting without raw recipients", () => {
  const functions = abiNames(parlyPayoutAdapterV4Abi, "function")
  const events = abiNames(parlyPayoutAdapterV4Abi, "event")

  for (const name of [
    "outboundExecutionFeeCap",
    "hashPayoutIntent",
    "hashCompletionProof",
    "getPayoutRecord",
    "acceptQuote",
    "confirmEscrowReceipt",
    "submitPayout",
    "completePayout",
    "makeRefundAvailableAfterDeadline",
    "claimRefund"
  ]) {
    assert.equal(functions.has(name), true, `${name} V4 function missing`)
  }

  for (const name of ["QuoteAccepted", "PayoutSubmitted", "PayoutCompleted", "RefundAvailable", "RefundClaimed"]) {
    assert.equal(events.has(name), true, `${name} V4 event missing`)
  }

  const intentFields = tupleComponentNames(abiItem(parlyPayoutAdapterV4Abi, "function", "acceptQuote").inputs[0])
  for (const field of ["sourceAmountOut", "destinationAmountOut", "providerSourceAmount", "outboundExecutionFee", "maxOutboundExecutionFee"]) {
    assert.equal(intentFields.has(field), true, `${field} V4 intent field missing`)
  }
  assert.equal(intentFields.has("destinationRecipient"), false)

  const recordFields = tupleComponentNames(abiItem(parlyPayoutAdapterV4Abi, "function", "getPayoutRecord").outputs[0])
  assert.equal(recordFields.has("providerSourceAmount"), true)
  assert.equal(recordFields.has("sourceAmountOut"), true)
  assert.equal(recordFields.has("destinationAmountOut"), true)
  assert.equal(recordFields.has("outboundExecutionFee"), true)
  assert.equal(recordFields.has("destinationRecipient"), false)
})

test("ParlyPayoutAdapterV5 ABI exposes collateral-free proof-backed completion and recovery", () => {
  const functions = abiNames(parlyPayoutAdapterV5Abi, "function")
  const events = abiNames(parlyPayoutAdapterV5Abi, "event")
  for (const name of [
    "acceptQuote",
    "submitPayout",
    "completePayout",
    "proveRelayRefund",
    "claimRefund",
    "recoveryAvailableAt",
    "hashRefundProof",
    "setRefundTerminalStatus"
  ]) assert.equal(functions.has(name), true, `${name} V5 function missing`)
  for (const name of ["PayoutCompleted", "RelayRefundProven", "RefundClaimed"]) {
    assert.equal(events.has(name), true, `${name} V5 event missing`)
  }

  for (const forbidden of ["liabilityVault", "depositLiabilityCollateral", "withdrawLiabilityCollateral"]) {
    assert.equal(functions.has(forbidden), false, `${forbidden} must not exist on collateral-free V5`)
  }
  const intentFields = tupleComponentNames(abiItem(parlyPayoutAdapterV5Abi, "function", "acceptQuote").inputs[0])
  for (const field of [
    "refundRouteBindingHash",
    "primaryRefundToken",
    "secondaryRefundToken",
    "submissionReimbursement",
    "deliverySuccessFee",
    "preSubmissionRecoveryDelay"
  ]) assert.equal(intentFields.has(field), true, `${field} V5 intent field missing`)

  const withdrawalFunctions = abiNames(parlyPayoutWithdrawalExecutorAbi, "function")
  assert.equal(withdrawalFunctions.has("executeWithdrawal"), true)
  assert.equal(withdrawalFunctions.has("payoutAdapterV5"), true)
  assert.equal(abiNames(parlyPayoutEscrowFactoryV5Abi, "function").has("bindAdapter"), true)
})

test("ParlyPayoutAdapterV6 ABI exposes completion and refund proof reads to attesters", () => {
  const functions = abiNames(parlyPayoutAdapterV6Abi, "function")
  for (const name of [
    "consumedDestinationEvents",
    "consumedRefundEvents",
    "hashProvenanceAttestation",
    "hashCompletionProof",
    "hashRefundProof"
  ]) assert.equal(functions.has(name), true, `${name} V6 attester function missing`)
})

test("Phase 3 Relay provider V2/V3 and deposit-address target ABIs expose bounded route controls", () => {
  const providerFunctions = abiNames(parlyRelayOutboundProviderV2Abi, "function")
  const providerEvents = abiNames(parlyRelayOutboundProviderV2Abi, "event")
  const providerV3Functions = abiNames(parlyRelayOutboundProviderV3Abi, "function")
  const providerV3Events = abiNames(parlyRelayOutboundProviderV3Abi, "event")
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
    assert.equal(providerV3Functions.has(name), true, `${name} provider V3 function missing`)
  }
  assert.equal(providerV3Functions.has("PROVIDER_DATA_VERSION"), true, "PROVIDER_DATA_VERSION provider V3 function missing")

  for (const name of ["setSourceToken", "setDestinationRoute", "executeRelay", "approvedSourceTokens"]) {
    assert.equal(targetFunctions.has(name), true, `${name} deposit target function missing`)
  }

  for (const name of ["RelayTargetSet", "RelayOutboundSubmitted", "ExecutionEnabledSet"]) {
    assert.equal(providerEvents.has(name), true, `${name} provider V2 event missing`)
    assert.equal(providerV3Events.has(name), true, `${name} provider V3 event missing`)
  }

  const providerV2Submission = abiItem(parlyRelayOutboundProviderV2Abi, "event", "RelayOutboundSubmitted")
  const providerV3Submission = abiItem(parlyRelayOutboundProviderV3Abi, "event", "RelayOutboundSubmitted")
  assert.equal(abiInputNames(providerV2Submission).has("boundCalldataHash"), true)
  assert.equal(abiInputNames(providerV3Submission).has("boundCalldataHash"), false)

  for (const name of ["SourceTokenSet", "DestinationRouteSet", "RelayDepositSubmitted"]) {
    assert.equal(targetEvents.has(name), true, `${name} deposit target event missing`)
  }

  const executeRelay = abiItem(parlyRelayDepositAddressTargetAbi, "function", "executeRelay")
  assert.equal(executeRelay.inputs.length, 2)
  assert.equal(executeRelay.inputs[1].name, "targetData")
  assert.equal(executeRelay.inputs[1].type, "bytes")
})

test("Phase 3 Relay provider V4 ABI exposes provider-scoped liability collateral controls", () => {
  const functions = abiNames(parlyRelayOutboundProviderV4Abi, "function")
  const events = abiNames(parlyRelayOutboundProviderV4Abi, "event")

  for (const name of [
    "liabilityVault",
    "depositLiabilityCollateral",
    "withdrawLiabilityCollateral",
    "submitOutboundPayout"
  ]) {
    assert.equal(functions.has(name), true, `${name} provider V4 function missing`)
  }
  for (const name of ["LiabilityCollateralDeposited", "LiabilityCollateralWithdrawn", "RelayOutboundSubmitted"]) {
    assert.equal(events.has(name), true, `${name} provider V4 event missing`)
  }
})

test("Phase 3 Relay transaction target ABI exposes only bounded depository execution controls", () => {
  const functions = abiNames(parlyRelayTransactionTargetAbi, "function")
  const events = abiNames(parlyRelayTransactionTargetAbi, "event")

  for (const name of [
    "provider",
    "approvedSourceTokens",
    "approvedDestinationRoutes",
    "approvedRelayDepositories",
    "setSourceToken",
    "setDestinationRoute",
    "setRelayDepository",
    "executeRelay",
    "pause",
    "unpause"
  ]) {
    assert.equal(functions.has(name), true, `${name} transaction target function missing`)
  }
  for (const name of [
    "SourceTokenSet",
    "DestinationRouteSet",
    "RelayDepositorySet",
    "RelayTransactionSubmitted"
  ]) {
    assert.equal(events.has(name), true, `${name} transaction target event missing`)
  }
  assert.equal(functions.has("execute"), false)
  assert.equal(functions.has("call"), false)
})

test("Phase 3 Relay router target ABI exposes only bounded proxy, call, and refund controls", () => {
  const functions = abiNames(parlyRelayRouterTargetAbi, "function")
  const events = abiNames(parlyRelayRouterTargetAbi, "event")

  for (const name of [
    "provider",
    "approvedSourceTokens",
    "approvedDestinationRoutes",
    "approvedRelayProxies",
    "approvedRelayCalls",
    "approvedRefundRecipients",
    "approvedExecutionAdapters",
    "approvedSettlementTokens",
    "approvedRelayDepositories",
    "setSourceToken",
    "setDestinationRoute",
    "setRelayProxy",
    "setRelayCall",
    "setRefundRecipient",
    "setExecutionAdapter",
    "setSettlementToken",
    "setRelayDepository",
    "executeRelay",
    "pause",
    "unpause"
  ]) {
    assert.equal(functions.has(name), true, `${name} router target function missing`)
  }
  for (const name of [
    "SourceTokenSet",
    "DestinationRouteSet",
    "RelayProxySet",
    "RelayCallSet",
    "RefundRecipientSet",
    "ExecutionAdapterSet",
    "SettlementTokenSet",
    "RelayDepositorySet",
    "RelayRouterSubmitted"
  ]) {
    assert.equal(events.has(name), true, `${name} router target event missing`)
  }
  assert.equal(functions.has("execute"), false)
  assert.equal(functions.has("call"), false)
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
test("refund consumers share exact replacement selectors without retired recovery methods", async () => {
  const { parlyVirtualDepositMasterRefundAbi: narrow, parlyVirtualDepositMasterV2Abi: replacement } = await import("../dist/index.js")
  assert.ok(narrow, "refund ABI must exist")
  for (const name of ["claimRefundAfterExpiry", "claimObservedRefundAfterExpiry", "refundClaim", "RefundAttributed", "RefundClaimed"]) {
    assert.deepEqual(narrow.find((entry) => entry.name === name), replacement.find((entry) => entry.name === name))
  }
  assert.equal(narrow.some((entry) => entry.name === "makeRefundAvailable" || entry.name === "claimRefund"), false)
})
