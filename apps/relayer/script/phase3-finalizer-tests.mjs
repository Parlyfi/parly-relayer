import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { encodeFunctionData, encodeAbiParameters, decodeFunctionData, keccak256 } from "viem"
import { parlyVirtualDepositMasterV2Abi } from "@parly/protocol-abis"

const phase3 = await import("../dist/apps/relayer/src/phase3/index.js")
const payoutV4AuthorityClient = await import("../dist/apps/relayer/src/phase3/payout-v4-authority-client.js")
const payoutV4CheckpointedWorker = await import("../dist/apps/relayer/src/phase3/payout-v4-checkpointed-worker.js")
const broadcastGate = await import("../dist/apps/relayer/src/phase3-broadcast-gate.js")
const sharedTypes = await import("../dist/packages/shared-types/src/index.js")

const ZERO32 = `0x${"0".repeat(64)}`
const ONE32 = `0x${"1".repeat(64)}`
const TWO32 = `0x${"2".repeat(64)}`
const THREE32 = `0x${"3".repeat(64)}`
const FOUR32 = `0x${"4".repeat(64)}`
const ADDRESS_A = "0x1111111111111111111111111111111111111111"
const ADDRESS_B = "0x2222222222222222222222222222222222222222"
const ADDRESS_C = "0x3333333333333333333333333333333333333333"
const ADDRESS_D = "0x4444444444444444444444444444444444444444"
const ADDRESS_E = "0x5555555555555555555555555555555555555555"
const ADDRESS_F = "0x6666666666666666666666666666666666666666"
const PRIVATE_KEY = `0x${"a".repeat(64)}`
const FORBIDDEN_PUBLIC_RELAY_KEY = ["NEXT", "PUBLIC", "RELAY", "API", "KEY"].join("_")

function baseEnv(overrides = {}) {
  return {
    PARLY_ENV: "mainnet",
    PHASE3_FINALIZER_ENABLED: "true",
    INDEXER_INTERNAL_DATA_SOURCE_URL: "https://internal.example.invalid/phase3",
    TEMPO_RPC_URL: "https://tempo.example.invalid",
    TEMPO_CHAIN_ID: "4217",
    SETTLEMENT_DOMAIN_ID: "4217",
    PHASE3_USDC_POOL_V2: ADDRESS_A,
    PHASE3_USDT_POOL_V2: ADDRESS_B,
    PARLY_INGRESS_RECEIVER_ADDRESS: ADDRESS_C,
    PARLY_VIRTUAL_DEPOSIT_MASTER_ADDRESS: ADDRESS_D,
    PHASE3_ALLOWED_TOKEN_ADDRESSES: `${ADDRESS_A},${ADDRESS_B}`,
    FINALIZER_PRIVATE_KEY: PRIVATE_KEY,
    RELAYER_OPERATOR_ADDRESS: ADDRESS_E,
    MAX_FINALIZER_FEE_BASE_UNITS: "1000",
    MAX_FINALIZER_FEE_BPS: "100",
    ...overrides
  }
}

function baseJob(overrides = {}) {
  return {
    jobId: "job-1",
    attemptId: ONE32,
    routeHash: TWO32,
    observationId: THREE32,
    observationEligibility: "eligible",
    status: "queued",
    lockedBy: null,
    lockedUntil: null,
    attemptNumber: 0,
    maxAttempts: 3,
    idempotencyKey: phase3.buildFinalizerIdempotencyKey({
      attemptId: ONE32,
      observationId: THREE32,
      routeHash: TWO32,
      action: "finalize_success"
    }),
    lastError: null,
    createdAt: 1000,
    updatedAt: 1000,
    requiredPrincipal: 900n,
    observedAmount: 1000n,
    maxFinalizerFee: 100n,
    settlementFeeBudget: 100n,
    finalizerFee: 100n,
    ...overrides
  }
}

function baseAuthorization(overrides = {}) {
  return {
    chainId: 4217n,
    settlementDomainId: 4217n,
    environment: ONE32,
    verifyingContract: ADDRESS_D,
    attemptId: ONE32,
    authorizationNonce: TWO32,
    depositObservationId: THREE32,
    routeType: 1,
    paymentMethod: 1,
    assetId: 1n,
    token: ADDRESS_A,
    pool: ADDRESS_B,
    receiver: ADDRESS_C,
    virtualMasterId: ZERO32,
    userTagHash: ONE32,
    virtualAddress: ADDRESS_A,
    expectedAmount: 1000n,
    observedAmount: 1000n,
    payerTotal: 1000n,
    settlementFee: 100n,
    finalizerFee: 100n,
    amountToShield: 900n,
    feeRecipient: ADDRESS_E,
    maxFinalizerFee: 100n,
    beneficiaryPolicySubject: ADDRESS_E,
    refundWalletCommitment: TWO32,
    depositTxHash: THREE32,
    depositLogIndexA: 1n,
    depositLogIndexB: 2n,
    depositBlockNumber: 3n,
    relayRequestIdHash: ZERO32,
    routeHash: TWO32,
    statusAccessTokenHash: THREE32,
    expiresAt: 9999999999n,
    innerCommitment: 123n,
    envelopeHash: ONE32,
    ...overrides
  }
}

function baseAttemptAuthorization(overrides = {}) {
  return {
    chainId: 4217n,
    settlementDomainId: 4217n,
    environment: ONE32,
    verifyingContract: ADDRESS_D,
    attemptId: ONE32,
    authorizationNonce: TWO32,
    userTagHash: ONE32,
    routeHash: TWO32,
    token: ADDRESS_A,
    pool: ADDRESS_B,
    assetId: 1n,
    expectedAmount: 1000n,
    expiresAt: 9999999999n,
    refundWalletCommitment: TWO32,
    paymentContext: 0,
    refundClaimantBinding: 0,
    statusAccessTokenHash: THREE32,
    ...overrides
  }
}

function baseDepositObservation(overrides = {}) {
  return {
    token: ADDRESS_A,
    virtualAddress: ADDRESS_B,
    masterAddress: ADDRESS_D,
    amount: 1000n,
    observationId: THREE32,
    txHash: TWO32,
    logIndexA: 4n,
    logIndexB: 5n,
    observedBlockNumber: 23760000n,
    routeHash: TWO32,
    userTagHash: ONE32,
    ...overrides
  }
}

function basePayoutV4AuthorityPayload(overrides = {}) {
  const intentHash = ONE32
  const escrow = ADDRESS_D
  return {
    version: 4,
    payoutId: "payout-v4-1",
    quoteHash: intentHash,
    intentHash,
    intent: {
      environment: TWO32,
      chainId: "4217",
      settlementDomainId: "4217",
      adapter: ADDRESS_A,
      escrowSalt: THREE32,
      escrow,
      sourcePool: ADDRESS_B,
      token: ADDRESS_C,
      assetId: "1",
      amountIn: "1000000",
      sourceAmountOut: "995000",
      destinationAmountOut: "995000000000000000",
      providerSourceAmount: "997000",
      outboundExecutionFee: "3000",
      maxOutboundExecutionFee: "3000",
      providerContract: ADDRESS_A,
      destinationChainId: "56",
      destinationToken: ADDRESS_B,
      destinationRecipientHash: TWO32,
      refundRecipientCommitment: THREE32,
      providerDataHash: ONE32,
      requestIdHash: TWO32,
      nonce: THREE32,
      quoteExpiry: "1783000600",
      maxCompletionDelay: "172800",
      payoutAuthority: ADDRESS_E
    },
    payoutSignature: `0x${"ab".repeat(65)}`,
    requesterWallet: ADDRESS_C,
    payoutAuthority: ADDRESS_E,
    relayerPublicKeyHash: "7".repeat(64),
    destinationRecipient: ADDRESS_C,
    providerData: "0x1234",
    providerDataHash: ONE32,
    refundRecipientCommitment: THREE32,
    quoteExpiry: "2026-07-11T00:10:00.000Z",
    ...overrides
  }
}

function basePayoutV4PrivateBundle(overrides = {}) {
  const relayerSignal = BigInt(ADDRESS_E).toString()
  return {
    pool: ADDRESS_B,
    pA: [ONE32, TWO32],
    pB: [[ONE32, TWO32], [TWO32, THREE32]],
    pC: [ONE32, THREE32],
    pubSignals: Array.from({ length: 50 }, (_, index) => {
      if (index === 17) return "4217"
      if (index === 49) return relayerSignal
      return "0"
    }),
    recipients: [ADDRESS_D, ...Array(9).fill("0x0000000000000000000000000000000000000000")],
    amounts: ["1000000", ...Array(9).fill("0")],
    destEids: Array(10).fill(4217),
    newChangeCommitment: ONE32,
    newChangeEnvelope: "0x",
    lzOptions: Array(10).fill("0x"),
    payoutV4: {
      intentHash: ONE32,
      adapter: ADDRESS_A,
      escrow: ADDRESS_D,
      amountIn: "1000000",
      payoutAuthority: ADDRESS_E
    },
    ...overrides
  }
}

function baseSecondPayoutV4AuthorityPayload() {
  const authority = basePayoutV4AuthorityPayload()
  return {
    ...authority,
    payoutId: "payout-v4-2",
    quoteHash: FOUR32,
    intentHash: FOUR32,
    intent: {
      ...authority.intent,
      escrow: ADDRESS_F,
      payoutAuthority: ADDRESS_E
    }
  }
}

function basePayoutV4BatchBundle(overrides = {}) {
  const first = basePayoutV4PrivateBundle()
  const second = baseSecondPayoutV4AuthorityPayload()
  return {
    ...first,
    recipients: [ADDRESS_D, ADDRESS_F, ...Array(8).fill("0x0000000000000000000000000000000000000000")],
    amounts: ["1000000", "1000000", ...Array(8).fill("0")],
    payoutV4: undefined,
    payoutV4Batch: [
      first.payoutV4,
      {
        intentHash: second.intentHash,
        adapter: second.intent.adapter,
        escrow: second.intent.escrow,
        amountIn: second.intent.amountIn,
        payoutAuthority: second.payoutAuthority
      }
    ],
    ...overrides
  }
}

test("V4 private payout binding requires one local escrow output and the selected relayer", () => {
  const validated = phase3.validatePayoutV4PrivateBundleBinding({
    bundle: basePayoutV4PrivateBundle(),
    authority: basePayoutV4AuthorityPayload(),
    relayerOperatorAddress: ADDRESS_E,
    settlementDomainId: 4217
  })

  assert.deepEqual(validated, {
    intentHash: ONE32,
    escrow: ADDRESS_D,
    amountIn: 1000000n,
    sourcePool: ADDRESS_B,
    token: ADDRESS_C,
    assetId: 1n
  })
  assert.deepEqual(phase3.PAYOUT_V4_EXECUTION_STEPS, [
    "acceptQuote",
    "poolWithdraw",
    "confirmEscrowReceipt",
    "submitPayout",
    "completePayout"
  ])
  assert.throws(
    () =>
      phase3.validatePayoutV4PrivateBundleBinding({
        bundle: basePayoutV4PrivateBundle({
          payoutV4: { ...basePayoutV4PrivateBundle().payoutV4, payoutAuthority: ADDRESS_D }
        }),
        authority: basePayoutV4AuthorityPayload(),
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217
      }),
    /authority|relayer/i
  )
  assert.throws(
    () =>
      phase3.validatePayoutV4PrivateBundleBinding({
        bundle: basePayoutV4PrivateBundle({
          recipients: [ADDRESS_D, ADDRESS_C, ...Array(8).fill("0x0000000000000000000000000000000000000000")],
          amounts: ["1000000", "1", ...Array(8).fill("0")]
        }),
        authority: basePayoutV4AuthorityPayload(),
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217
      }),
    /one local escrow output/i
  )
  assert.throws(
    () => {
      const bundle = basePayoutV4PrivateBundle()
      bundle.pubSignals[14] = "1"
      return phase3.validatePayoutV4PrivateBundleBinding({
        bundle,
        authority: basePayoutV4AuthorityPayload(),
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217
      })
    },
    /Pool executor fee/i
  )
})

test("V4 batch payout bindings require one exact local escrow output per intent and one relayer", () => {
  const first = basePayoutV4AuthorityPayload()
  const second = baseSecondPayoutV4AuthorityPayload()
  const validated = phase3.validatePayoutV4PrivateBundleBindings({
    bundle: basePayoutV4BatchBundle(),
    authorities: [first, second],
    relayerOperatorAddress: ADDRESS_E,
    settlementDomainId: 4217
  })

  assert.deepEqual(
    validated.map((entry) => entry.intentHash),
    [ONE32, FOUR32]
  )
  assert.throws(
    () =>
      phase3.validatePayoutV4PrivateBundleBindings({
        bundle: basePayoutV4BatchBundle({
          payoutV4Batch: [
            basePayoutV4PrivateBundle().payoutV4,
            { ...basePayoutV4BatchBundle().payoutV4Batch[1], payoutAuthority: ADDRESS_D }
          ]
        }),
        authorities: [first, second],
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217
      }),
    /authority|relayer/i
  )
  assert.throws(
    () =>
      phase3.validatePayoutV4PrivateBundleBindings({
        bundle: basePayoutV4BatchBundle({
          recipients: [ADDRESS_D, ADDRESS_F, ADDRESS_C, ...Array(7).fill("0x0000000000000000000000000000000000000000")],
          amounts: ["1000000", "1000000", "1", ...Array(7).fill("0")]
        }),
        authorities: [first, second],
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217
      }),
    /exact local escrow outputs/i
  )
})

test("V4 quote acceptance is prepared by the selected relayer without destination data", async () => {
  const authority = basePayoutV4AuthorityPayload({ destinationRecipient: ADDRESS_F })
  const calls = []
  const transaction = await phase3.preparePayoutV4AcceptQuoteTransaction({
    adapterAddress: ADDRESS_A,
    bundle: basePayoutV4PrivateBundle(),
    authority,
    relayerOperatorAddress: ADDRESS_E,
    settlementDomainId: 4217,
    eligibilityReader: {
      async isEligibleOperatorFor(operator, capability) {
        calls.push({ operator, capability })
        return true
      }
    }
  })

  assert.equal(transaction.functionName, "acceptQuote")
  assert.equal(transaction.to, ADDRESS_A)
  assert.equal(transaction.intentHash, ONE32)
  assert.equal(transaction.amountIn, 1000000n)
  assert.equal(transaction.data.toLowerCase().includes(ADDRESS_F.slice(2).toLowerCase()), false)
  assert.equal(calls.length, 1)

  await assert.rejects(
    () =>
      phase3.preparePayoutV4AcceptQuoteTransaction({
        adapterAddress: ADDRESS_A,
        bundle: basePayoutV4PrivateBundle({
          payoutV4: { ...basePayoutV4PrivateBundle().payoutV4, payoutAuthority: ADDRESS_D }
        }),
        authority,
        relayerOperatorAddress: ADDRESS_E,
        settlementDomainId: 4217,
        eligibilityReader: { async isEligibleOperatorFor() { return true } }
      }),
    /authority|relayer/i
  )
})

test("V4 payout execution requires its dedicated worker gate plus the existing broadcast gates", () => {
  assert.equal(phase3.isPayoutV4ExecutionBroadcastEnabled({}), false)
  assert.equal(
    phase3.isPayoutV4ExecutionBroadcastEnabled({
      PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED: "true",
      PHASE3_PAYOUT_EXECUTION_ENABLED: "true",
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    }),
    true
  )
})

test("V4 authority client signs only the selected relayer claim and opens sealed authority data locally", async () => {
  const intentHash = ONE32
  const authority = basePayoutV4AuthorityPayload({ intentHash, quoteHash: intentHash })
  const sealedBody = Buffer.from(JSON.stringify({
    preparation: authority,
    leaseToken: "v4-relayer-lease-token-123456"
  })).toString("base64")
  let request = null
  const result = await payoutV4AuthorityClient.claimPayoutV4RelayerAuthority({
    config: {
      enabled: true,
      apiBaseUrl: "https://parly.fi",
      boxPrivateKeyB64: Buffer.alloc(32, 9).toString("base64")
    },
    account: {
      address: ADDRESS_E,
      signMessage: async ({ message }) => {
        assert.match(message, /claim-payout-v4-authority/u)
        assert.match(message, new RegExp(ADDRESS_E.toLowerCase(), "u"))
        return `0x${"ab".repeat(65)}`
      }
    },
    intentHash,
    nowSeconds: () => 1_783_000_000,
    randomBytes: () => Buffer.alloc(32, 4),
    fetchImpl: async (_url, init) => {
      request = JSON.parse(String(init.body))
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            intentHash,
            leaseExpiresAt: "2026-07-11T12:05:00.000Z",
            authorityPayloadSealedB64: sealedBody
          }
        }
      }
    },
    openSealed: async ({ sealedB64 }) => Buffer.from(sealedB64, "base64")
  })

  assert.deepEqual(result.authority, authority)
  assert.equal(result.leaseToken, "v4-relayer-lease-token-123456")
  assert.equal(request.intentHash, intentHash)
  assert.equal(request.executionAddress, ADDRESS_E.toLowerCase())
  assert.equal(JSON.stringify(request).includes(ADDRESS_C), false)
  assert.equal(JSON.stringify(request).includes("0x1234"), false)
})

test("V4 checkpoint client signs only immutable transaction facts", async () => {
  const intentHash = ONE32
  const transactionHash = TWO32
  let request = null
  const result = await payoutV4AuthorityClient.recordPayoutV4RelayerCheckpoint({
    config: {
      enabled: true,
      apiBaseUrl: "https://parly.fi",
      boxPrivateKeyB64: Buffer.alloc(32, 9).toString("base64")
    },
    account: {
      address: ADDRESS_E,
      signMessage: async ({ message }) => {
        assert.match(message, /record-payout-v4-checkpoint/u)
        assert.match(message, /poolWithdraw/u)
        return `0x${"cd".repeat(65)}`
      }
    },
    intentHash,
    step: "poolWithdraw",
    transactionHash,
    nowSeconds: () => 1_783_000_000,
    randomBytes: () => Buffer.alloc(32, 5),
    fetchImpl: async (_url, init) => {
      request = JSON.parse(String(init.body))
      return {
        ok: true,
        status: 200,
        async json() {
          return { intentHash, step: "poolWithdraw", transactionHash, recorded: true }
        }
      }
    }
  })

  assert.deepEqual(result, { intentHash, step: "poolWithdraw", transactionHash, recorded: true })
  assert.equal(request.executionAddress, ADDRESS_E.toLowerCase())
  assert.equal(request.intentHash, intentHash)
  assert.equal(JSON.stringify(request).includes(ADDRESS_C), false)
  assert.equal(JSON.stringify(request).includes("0x1234"), false)
})

test("V4 checkpoint worker records quote acceptance before it can withdraw the Pool bundle", async () => {
  const events = []
  let remoteQuoteRecorded = false
  const result = await payoutV4CheckpointedWorker.runPayoutV4CheckpointedExecution({
    bundle: basePayoutV4PrivateBundle(),
    executionAddress: ADDRESS_E,
    settlementDomainId: 4217,
    readAdapterStatus: async () => {
      events.push("status")
      return events.includes("accept") ? 1 : 0
    },
    claimAuthority: async () => {
      events.push("claim")
      return { authority: basePayoutV4AuthorityPayload() }
    },
    validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) => {
      events.push("validate")
      return phase3.validatePayoutV4PrivateBundleBinding({
        bundle,
        authority,
        relayerOperatorAddress,
        settlementDomainId
      })
    },
    getLocalCheckpoint: async ({ step }) => {
      events.push(`read-local:${step}`)
      return null
    },
    getLocalSubmissions: async () => [],
    readTransactionOutcome: async () => "failed",
    recordLocalSubmission: async ({ step }) => {
      events.push(`record-submitted:${step}`)
    },
    recordLocalCheckpoint: async ({ step }) => {
      events.push(`record-local:${step}`)
    },
    recordRemoteCheckpoint: async ({ step }) => {
      events.push(`record-remote:${step}`)
      if (step === "acceptQuote") remoteQuoteRecorded = true
    },
    acceptQuote: async ({ onSubmitted }) => {
      events.push("accept")
      await onSubmitted(TWO32)
      return { transactionHash: TWO32 }
    },
    withdrawPoolBundle: async ({ onSubmitted }) => {
      assert.equal(remoteQuoteRecorded, true)
      events.push("withdraw")
      await onSubmitted(THREE32)
      return { transactionHash: THREE32 }
    }
  })

  assert.deepEqual(result, { intentHash: ONE32, status: "withdrawal_confirmed" })
  assert.deepEqual(events, [
    "status",
    "claim",
    "validate",
    "read-local:acceptQuote",
    "accept",
    "record-submitted:acceptQuote",
    "record-local:acceptQuote",
    "record-remote:acceptQuote",
    "status",
    "read-local:poolWithdraw",
    "withdraw",
    "record-submitted:poolWithdraw",
    "record-local:poolWithdraw",
    "record-remote:poolWithdraw"
  ])
})

test("V4 checkpoint worker replays durable checkpoints without a second quote or Pool withdrawal", async () => {
  const events = []
  const result = await payoutV4CheckpointedWorker.runPayoutV4CheckpointedExecution({
    bundle: basePayoutV4PrivateBundle(),
    executionAddress: ADDRESS_E,
    settlementDomainId: 4217,
    readAdapterStatus: async () => 1,
    claimAuthority: async () => {
      events.push("claim")
      return { authority: basePayoutV4AuthorityPayload() }
    },
    validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) =>
      phase3.validatePayoutV4PrivateBundleBinding({ bundle, authority, relayerOperatorAddress, settlementDomainId }),
    getLocalCheckpoint: async ({ step }) => {
      events.push(`read-local:${step}`)
      return { transactionHash: step === "acceptQuote" ? TWO32 : THREE32 }
    },
    getLocalSubmissions: async () => [],
    readTransactionOutcome: async () => "failed",
    recordLocalSubmission: async () => {
      throw new Error("durable replay must not write a second submission")
    },
    recordLocalCheckpoint: async () => {
      throw new Error("durable replay must not write a second local checkpoint")
    },
    recordRemoteCheckpoint: async ({ step, transactionHash }) => {
      events.push(`record-remote:${step}:${transactionHash}`)
    },
    acceptQuote: async () => {
      throw new Error("durable quote checkpoint must not rebroadcast acceptQuote")
    },
    withdrawPoolBundle: async () => {
      throw new Error("durable Pool checkpoint must not rebroadcast withdrawal")
    }
  })

  assert.deepEqual(result, { intentHash: ONE32, status: "withdrawal_confirmed" })
  assert.deepEqual(events, [
    "claim",
    "read-local:acceptQuote",
    `record-remote:acceptQuote:${TWO32}`,
    "read-local:poolWithdraw",
    `record-remote:poolWithdraw:${THREE32}`
  ])
})

test("V4 checkpoint worker refuses a missing local acceptance record after the adapter already accepted", async () => {
  await assert.rejects(
    () =>
      payoutV4CheckpointedWorker.runPayoutV4CheckpointedExecution({
        bundle: basePayoutV4PrivateBundle(),
        executionAddress: ADDRESS_E,
        settlementDomainId: 4217,
        readAdapterStatus: async () => 1,
        claimAuthority: async () => ({ authority: basePayoutV4AuthorityPayload() }),
        validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) =>
          phase3.validatePayoutV4PrivateBundleBinding({ bundle, authority, relayerOperatorAddress, settlementDomainId }),
        getLocalCheckpoint: async () => null,
        getLocalSubmissions: async () => [],
        readTransactionOutcome: async () => "failed",
        recordLocalSubmission: async () => undefined,
        recordLocalCheckpoint: async () => undefined,
        recordRemoteCheckpoint: async () => undefined,
        acceptQuote: async () => ({ transactionHash: TWO32 }),
        withdrawPoolBundle: async () => ({ transactionHash: THREE32 })
      }),
    /accepted the quote without a durable local quote checkpoint/i
  )
})

test("V4 checkpoint worker promotes a confirmed submitted quote instead of broadcasting it again", async () => {
  const events = []
  let statusReads = 0
  const result = await payoutV4CheckpointedWorker.runPayoutV4CheckpointedExecution({
    bundle: basePayoutV4PrivateBundle(),
    executionAddress: ADDRESS_E,
    settlementDomainId: 4217,
    readAdapterStatus: async () => {
      statusReads += 1
      return statusReads === 1 ? 0 : 2
    },
    claimAuthority: async () => ({ authority: basePayoutV4AuthorityPayload() }),
    validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) =>
      phase3.validatePayoutV4PrivateBundleBinding({ bundle, authority, relayerOperatorAddress, settlementDomainId }),
    getLocalCheckpoint: async () => null,
    getLocalSubmissions: async ({ step }) => (step === "acceptQuote" ? [TWO32] : []),
    readTransactionOutcome: async (transactionHash) => {
      assert.equal(transactionHash, TWO32)
      return "success"
    },
    recordLocalSubmission: async () => {
      throw new Error("existing submission must not be written again")
    },
    recordLocalCheckpoint: async ({ step, transactionHash }) => {
      events.push(`record-local:${step}:${transactionHash}`)
    },
    recordRemoteCheckpoint: async ({ step, transactionHash }) => {
      events.push(`record-remote:${step}:${transactionHash}`)
    },
    acceptQuote: async () => {
      throw new Error("confirmed submitted quote must not broadcast again")
    },
    withdrawPoolBundle: async () => {
      throw new Error("downstream handoff must not withdraw after receipt confirmation")
    }
  })

  assert.deepEqual(result, { intentHash: ONE32, status: "awaiting_downstream_worker" })
  assert.deepEqual(events, [
    `record-local:acceptQuote:${TWO32}`,
    `record-remote:acceptQuote:${TWO32}`
  ])
})

test("V4 checkpoint worker does not replace a still-pending submitted quote", async () => {
  let broadcasts = 0
  await assert.rejects(
    () =>
      payoutV4CheckpointedWorker.runPayoutV4CheckpointedExecution({
        bundle: basePayoutV4PrivateBundle(),
        executionAddress: ADDRESS_E,
        settlementDomainId: 4217,
        readAdapterStatus: async () => 0,
        claimAuthority: async () => ({ authority: basePayoutV4AuthorityPayload() }),
        validateBundle: ({ bundle, authority, relayerOperatorAddress, settlementDomainId }) =>
          phase3.validatePayoutV4PrivateBundleBinding({ bundle, authority, relayerOperatorAddress, settlementDomainId }),
        getLocalCheckpoint: async () => null,
        getLocalSubmissions: async ({ step }) => (step === "acceptQuote" ? [TWO32] : []),
        readTransactionOutcome: async () => "pending",
        recordLocalSubmission: async () => undefined,
        recordLocalCheckpoint: async () => undefined,
        recordRemoteCheckpoint: async () => undefined,
        acceptQuote: async () => {
          broadcasts += 1
          return { transactionHash: THREE32 }
        },
        withdrawPoolBundle: async () => ({ transactionHash: THREE32 })
      }),
    /still pending/i
  )
  assert.equal(broadcasts, 0)
})

function baseObservationAttestation(overrides = {}) {
  return {
    chainId: 4217n,
    settlementDomainId: 4217n,
    environment: ONE32,
    verifyingContract: ADDRESS_D,
    attemptId: ONE32,
    observationId: THREE32,
    token: ADDRESS_A,
    amount: 1000n,
    virtualAddress: ADDRESS_B,
    txHash: TWO32,
    logIndexA: 4n,
    logIndexB: 5n,
    observedBlockNumber: 23760000n,
    routeHash: TWO32,
    userTagHash: ONE32,
    expiresAt: 9999999999n,
    nonce: ZERO32,
    ...overrides
  }
}

test("single and batch V4 bundles are queued durably before checkpointed execution", async () => {
  const source = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8")
  assert.match(source, /hasPayoutV4Binding\(decoded\)/u)
  assert.match(source, /enqueueRelayInboxBundle/u)
  assert.match(source, /processPayoutV4Bundle/u)
  assert.match(source, /processPayoutV4BatchBundle/u)
  assert.match(source, /runPayoutV4BatchCheckpointedExecution/u)
  assert.match(source, /source:\s*"inbox"/u)
  assert.match(source, /allowPayoutV4PoolWithdrawal/u)
  assert.match(source, /isPayoutV4BundleBinding/u)
  assert.match(source, /isPayoutV4BatchBinding/u)
  assert.match(source, /abi:\s*tempoShieldedPoolV2Abi/u)
  assert.match(source, /args:\s*proofArgs/u)
  assert.match(source, /options\.source === "inbox"/u)
})

test("Phase 3 finalizer is disabled by default", () => {
  const config = phase3.readPhase3FinalizerConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.reason, "phase3_finalizer_disabled")
})

test("normal relayer broadcasts require both live and outbound flags", () => {
  assert.equal(broadcastGate.isPhase3BroadcastEnabled({}), false)
  assert.equal(
    broadcastGate.isPhase3BroadcastEnabled({
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "false"
    }),
    false
  )
  assert.equal(
    broadcastGate.isPhase3BroadcastEnabled({
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    }),
    false
  )
  assert.equal(
    broadcastGate.isPhase3BroadcastEnabled({
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    }),
    true
  )

  assert.throws(
    () => broadcastGate.requirePhase3BroadcastEnabled("test broadcast", {}),
    /PHASE3_LIVE_TRANSACTIONS_ENABLED=true and PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED=true/u
  )
})

test("mainnet Phase 3 finalizer fails closed without full env", () => {
  assert.throws(
    () => phase3.readPhase3FinalizerConfig({ PARLY_ENV: "mainnet", PHASE3_FINALIZER_ENABLED: "true" }),
    /required/u
  )
})

test("old LayerZero EID envs are not required for Phase 3 finalizer", () => {
  const config = phase3.readPhase3FinalizerConfig(baseEnv())
  assert.equal(config.enabled, true)
  assert.equal(config.tempoChainId, 4217)
  assert.equal(config.settlementDomainId, 4217)
  assert.equal(config.relayerOperatorAddress, ADDRESS_E)
})

test("Phase 3 runtime temporarily accepts the legacy finalizer address alias", () => {
  const config = phase3.readPhase3FinalizerConfig(
    baseEnv({ RELAYER_OPERATOR_ADDRESS: undefined, FINALIZER_ADDRESS: ADDRESS_E })
  )
  assert.equal(config.enabled, true)
  assert.equal(config.relayerOperatorAddress, ADDRESS_E)
})

test("browser-scoped Relay API key env is rejected", () => {
  assert.throws(
    () => phase3.readPhase3FinalizerConfig(baseEnv({ [FORBIDDEN_PUBLIC_RELAY_KEY]: "leak" })),
    new RegExp(FORBIDDEN_PUBLIC_RELAY_KEY, "u")
  )
})

test("V3 payout runtime config is disabled by default", () => {
  const config = phase3.readPhase3PayoutV3RuntimeConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.reason, "phase3_v3_payout_runtime_disabled")
})

test("V3 payout runtime config accepts deployed addresses and explicit execution booleans", () => {
  const config = phase3.readPhase3PayoutV3RuntimeConfig({
    PHASE3_V3_PAYOUT_RUNTIME_ENABLED: "true",
    TEMPO_CHAIN_ID: "4217",
    SETTLEMENT_DOMAIN_ID: "4217",
    PHASE3_V3_PAYOUT_ADAPTER: ADDRESS_A,
    PHASE3_V3_PAYOUT_LIABILITY_VAULT: ADDRESS_B,
    PHASE3_V3_PAYOUT_PROOF_VERIFIER: ADDRESS_C,
    PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V3: ADDRESS_D,
    PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2: ADDRESS_E,
    PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET: "0x6666666666666666666666666666666666666666",
    PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET_V3: "0x7777777777777777777777777777777777777777",
    PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
    PHASE3_PRODUCTION_ROUTES_ENABLED: "false",
    PHASE3_PAYOUT_EXECUTION_ENABLED: "true",
    PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true",
    PHASE3_FEE_PAYER_ENABLED: "true",
    PHASE3_FUNDED_POC_ENABLED: "false",
    CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED: "true"
  })

  assert.equal(config.enabled, true)
  assert.equal(config.tempoChainId, 4217)
  assert.equal(config.settlementDomainId, 4217)
  assert.equal(config.payoutAdapterV3, ADDRESS_A)
  assert.equal(config.relayOutboundProviderV3, ADDRESS_D)
  assert.equal(config.relayOutboundProviderV2, ADDRESS_E)
  assert.equal(config.relayDepositAddressTargetV3, "0x7777777777777777777777777777777777777777")
  assert.equal(config.broadcastEnabled, true)
  assert.equal(config.payoutExecutionEnabled, true)
  assert.equal(config.feePayerEnabled, true)
  assert.equal(config.fundedPocEnabled, false)
  assert.equal(config.campaignAwardsEnabled, true)
})

test("V3 payout runtime config rejects malformed execution booleans", () => {
  assert.throws(
    () =>
      phase3.readPhase3PayoutV3RuntimeConfig({
        PHASE3_V3_PAYOUT_RUNTIME_ENABLED: "true",
        TEMPO_CHAIN_ID: "4217",
        SETTLEMENT_DOMAIN_ID: "4217",
        PHASE3_V3_PAYOUT_ADAPTER: ADDRESS_A,
        PHASE3_V3_PAYOUT_LIABILITY_VAULT: ADDRESS_B,
        PHASE3_V3_PAYOUT_PROOF_VERIFIER: ADDRESS_C,
        PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V3: ADDRESS_D,
        PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2: ADDRESS_E,
        PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET: "0x6666666666666666666666666666666666666666",
        PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET_V3: "0x7777777777777777777777777777777777777777",
        PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
        PHASE3_PRODUCTION_ROUTES_ENABLED: "false",
        PHASE3_PAYOUT_EXECUTION_ENABLED: "enabled",
        PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "false",
        PHASE3_FEE_PAYER_ENABLED: "false",
        PHASE3_FUNDED_POC_ENABLED: "false",
        CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED: "false"
      }),
    /PHASE3_PAYOUT_EXECUTION_ENABLED must be true or false/u
  )
})

test("safe config summary does not print secrets", () => {
  const config = phase3.readPhase3FinalizerConfig(baseEnv({ RELAY_API_KEY: "relay-secret" }))
  const summary = phase3.describePhase3FinalizerConfigForLogs(config)
  const serialized = JSON.stringify(summary)
  assert.equal(serialized.includes(PRIVATE_KEY), false)
  assert.equal(serialized.includes("relay-secret"), false)
  assert.equal(summary.relayerOperatorPrivateKeyConfigured, true)
  assert.equal(summary.relayerOperatorAddress, ADDRESS_E)
})

test("job lease can be acquired only once until expiry", () => {
  const store = phase3.createInMemoryFinalizerJobStore({ nowMs: 1_000 })
  store.upsert(baseJob())
  const first = store.acquireLease("worker-a", 5_000)
  assert.equal(first?.lockedBy, "worker-a")
  const second = store.acquireLease("worker-b", 5_000)
  assert.equal(second, null)
})

test("expired lease is recoverable", () => {
  const store = phase3.createInMemoryFinalizerJobStore({ nowMs: 1_000 })
  store.upsert(baseJob())
  store.acquireLease("worker-a", 5_000)
  store.setNow(7_000)
  const recovered = store.acquireLease("worker-b", 5_000)
  assert.equal(recovered?.lockedBy, "worker-b")
})

test("queued jobs are finalizable and leaseable only below max attempts", () => {
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "queued", attemptNumber: 2, maxAttempts: 3 })).ok, true)
  assert.deepEqual(
    phase3.canFinalizeJob(baseJob({ status: "queued", attemptNumber: 3, maxAttempts: 3 })),
    { ok: false, reason: "max_attempts_exceeded" }
  )

  const store = phase3.createInMemoryFinalizerJobStore({ nowMs: 1_000 })
  store.upsert(baseJob({ status: "queued", attemptNumber: 4, maxAttempts: 3 }))
  assert.equal(store.acquireLease("worker-a", 5_000), null)
})

test("expired leases and explicitly retryable failures recover only below max attempts", () => {
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "locked", lockedUntil: 999, attemptNumber: 2, maxAttempts: 3 }), { nowMs: 1_000 }).ok,
    true
  )
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "locked", lockedUntil: 999, attemptNumber: 3, maxAttempts: 3 }), { nowMs: 1_000 }).ok,
    false
  )
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "failed_retryable", retryable: true, attemptNumber: 2, maxAttempts: 3 })).ok,
    true
  )
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "failed_retryable", retryable: true, attemptNumber: 3, maxAttempts: 3 })).ok,
    false
  )
})

test("finalizer whitelist rejects submitted and active locks while allowing expired locks", () => {
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "submitted" }), { nowMs: 2_000 }).ok, false)
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "locked", lockedUntil: 3_000 }), { nowMs: 2_000 }).ok,
    false
  )
  assert.equal(
    phase3.canFinalizeJob(baseJob({ status: "locked", lockedUntil: 1_999 }), { nowMs: 2_000 }).ok,
    true
  )
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "queued" }), { nowMs: 2_000 }).ok, true)
})

test("terminal and unsafe jobs cannot be finalized", () => {
  for (const status of ["confirmed", "refund_available", "refund_claimed", "manual_review", "ignored", "abandoned"]) {
    assert.equal(phase3.canFinalizeJob(baseJob({ status })).ok, false, status)
  }
})

test("finalizer datasource returns eligible jobs only", async () => {
  const source = phase3.createInMemoryPhase3FinalizerJobDataSource({
    jobs: [
      baseJob({ jobId: "queued-1", status: "queued", createdAt: 2000 }),
      baseJob({ jobId: "manual-1", status: "manual_review", createdAt: 1000 }),
      baseJob({ jobId: "ignored-1", status: "ignored", createdAt: 500 })
    ]
  })
  const jobs = await phase3.listFinalizableJobsFromDataSource(source)

  assert.deepEqual(jobs.map((job) => job.jobId), ["queued-1"])
})

test("finalizer datasource ignores terminal, manual-review, refund, and ignored jobs", async () => {
  const source = phase3.createInMemoryPhase3FinalizerJobDataSource({
    jobs: [
      baseJob({ jobId: "confirmed", status: "confirmed" }),
      baseJob({ jobId: "manual", status: "manual_review" }),
      baseJob({ jobId: "refund", status: "refund_available" }),
      baseJob({ jobId: "ignored", status: "ignored" })
    ]
  })
  const jobs = await phase3.listFinalizableJobsFromDataSource(source)

  assert.deepEqual(jobs, [])
})

test("only eligible registered operators receive finalizable jobs", async () => {
  const source = phase3.createInMemoryPhase3FinalizerJobDataSource({
    jobs: [baseJob({ jobId: "queued-registered", status: "queued" })]
  })
  const eligibleReader = {
    async isEligibleOperatorFor(operatorAddress, capability) {
      assert.equal(operatorAddress, ADDRESS_E)
      assert.equal(capability, phase3.CAPABILITY_SETTLEMENT)
      return true
    }
  }
  const blockedReader = {
    async isEligibleOperatorFor(operatorAddress, capability) {
      assert.equal(operatorAddress, ADDRESS_E)
      assert.equal(capability, phase3.CAPABILITY_SETTLEMENT)
      return false
    }
  }

  const eligible = await phase3.listFinalizableJobsForEligibleOperator({
    dataSource: source,
    eligibilityReader: eligibleReader,
    relayerOperatorAddress: ADDRESS_E
  })
  const blocked = await phase3.listFinalizableJobsForEligibleOperator({
    dataSource: source,
    eligibilityReader: blockedReader,
    relayerOperatorAddress: ADDRESS_E
  })

  assert.deepEqual(eligible.map((job) => job.jobId), ["queued-registered"])
  assert.deepEqual(blocked, [])
})

test("payout dry-run preflight requires payout capability and confirmed escrow receipt", async () => {
  const payoutJob = {
    payoutId: "payout-1",
    intentHash: ONE32,
    idempotencyKey: "phase3-payout:payout-1",
    status: "escrow_receipt_confirmed",
    amountIn: 1000n,
    minAmountOut: 900n,
    maxProviderFee: 50n,
    maxOperatorFee: 50n,
    providerContract: ADDRESS_D
  }
  const eligible = await phase3.preparePayoutExecutionDryRun({
    job: payoutJob,
    relayerOperatorAddress: ADDRESS_E,
    providerFee: 50n,
    operatorFee: 50n,
    eligibilityReader: {
      async isEligibleOperatorFor(operatorAddress, capability) {
        assert.equal(operatorAddress, ADDRESS_E)
        assert.equal(capability, phase3.CAPABILITY_PAYOUT)
        return true
      }
    }
  })

  assert.equal(eligible.dryRun, true)
  assert.equal(eligible.broadcast, false)
  assert.equal(eligible.operatorFundsEscrow, false)
  assert.equal(eligible.status, "payout_submitted")
  assert.equal(eligible.providerContract, ADDRESS_D)
  assert.equal(eligible.amountOut, "900")

  await assert.rejects(
    () =>
      phase3.preparePayoutExecutionDryRun({
        job: payoutJob,
        relayerOperatorAddress: ADDRESS_E,
        providerFee: 50n,
        operatorFee: 50n,
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return false
          }
        }
      }),
    /payout capability/u
  )
  await assert.rejects(
    () =>
      phase3.preparePayoutExecutionDryRun({
        job: { ...payoutJob, status: "pool_withdrawal_pending" },
        relayerOperatorAddress: ADDRESS_E,
        providerFee: 50n,
        operatorFee: 50n,
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return true
          }
        }
      }),
    /escrow receipt must be confirmed/u
  )
})

test("payout V3 submit transaction requires private payload integrity and payout capability", async () => {
  const providerData = "0x1234"
  const providerDataHash = "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432"
  const tx = await phase3.preparePayoutV3SubmitPayoutTransaction({
    adapterAddress: ADDRESS_A,
    relayerOperatorAddress: ADDRESS_E,
    job: {
      payoutId: "payout-submit-1",
      intentHash: ONE32,
      idempotencyKey: "phase3-payout:payout-submit-1",
      status: "escrow_receipt_confirmed",
      payoutAuthority: ADDRESS_E,
      destinationRecipient: ADDRESS_D,
      providerData,
      providerDataHash
    },
    eligibilityReader: {
      async isEligibleOperatorFor(operatorAddress, capability) {
        assert.equal(operatorAddress, ADDRESS_E)
        assert.equal(capability, phase3.CAPABILITY_PAYOUT)
        return true
      }
    }
  })

  assert.equal(tx.broadcast, false)
  assert.equal(tx.to, ADDRESS_A)
  assert.equal(tx.functionName, "submitPayout")
  assert.deepEqual(tx.args, [ONE32, ADDRESS_D, providerData])
  assert.equal(tx.data.startsWith("0x"), true)
  assert.equal(tx.status, "payout_submitted")

  await assert.rejects(
    () =>
      phase3.preparePayoutV3SubmitPayoutTransaction({
        adapterAddress: ADDRESS_A,
        relayerOperatorAddress: ADDRESS_E,
        job: {
          payoutId: "payout-submit-2",
          intentHash: ONE32,
          idempotencyKey: "phase3-payout:payout-submit-2",
          status: "pool_withdrawal_pending",
          payoutAuthority: ADDRESS_E,
          destinationRecipient: ADDRESS_D,
          providerData
        },
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return true
          }
        }
      }),
    /escrow receipt must be confirmed/u
  )

  await assert.rejects(
    () =>
      phase3.preparePayoutV3SubmitPayoutTransaction({
        adapterAddress: ADDRESS_A,
        relayerOperatorAddress: ADDRESS_E,
        job: {
          payoutId: "payout-submit-3",
          intentHash: ONE32,
          idempotencyKey: "phase3-payout:payout-submit-3",
          status: "escrow_receipt_confirmed",
          payoutAuthority: ADDRESS_D,
          destinationRecipient: ADDRESS_D,
          providerData
        },
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return true
          }
        }
      }),
    /Payout authority must match relayer operator/u
  )

  await assert.rejects(
    () =>
      phase3.preparePayoutV3SubmitPayoutTransaction({
        adapterAddress: ADDRESS_A,
        relayerOperatorAddress: ADDRESS_E,
        job: {
          payoutId: "payout-submit-4",
          intentHash: ONE32,
          idempotencyKey: "phase3-payout:payout-submit-4",
          status: "escrow_receipt_confirmed",
          payoutAuthority: ADDRESS_E,
          destinationRecipient: ADDRESS_D,
          providerData,
          providerDataHash: TWO32
        },
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return true
          }
        }
      }),
    /provider data hash mismatch/u
  )

  await assert.rejects(
    () =>
      phase3.preparePayoutV3SubmitPayoutTransaction({
        adapterAddress: ADDRESS_A,
        relayerOperatorAddress: ADDRESS_E,
        job: {
          payoutId: "payout-submit-5",
          intentHash: ONE32,
          idempotencyKey: "phase3-payout:payout-submit-5",
          status: "escrow_receipt_confirmed",
          payoutAuthority: ADDRESS_E,
          destinationRecipient: ADDRESS_D,
          providerData
        },
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return false
          }
        }
      }),
    /payout capability/u
  )
})

test("payout V3 execution loop dry-runs and broadcasts only behind explicit gates", async () => {
  const providerData = "0x1234"
  const providerDataHash = "0x56570de287d73cd1cb6092bb8fdee6173974955fdef345ae579ee9f475ea7432"
  const baseJob = {
    payoutId: "payout-loop-1",
    leaseToken: "lease-token",
    intentHash: ONE32,
    idempotencyKey: "phase3-payout:payout-loop-1",
    status: "escrow_receipt_confirmed",
    payoutAuthority: ADDRESS_E,
    destinationRecipient: ADDRESS_D,
    providerData,
    providerDataHash
  }
  const events = []
  const createDataSource = () => ({
    async acquirePayoutV3ExecutionJob({ workerId, leaseMs }) {
      assert.equal(workerId, "worker-a")
      assert.equal(leaseMs, 30_000)
      return { ...baseJob }
    },
    async recordPayoutV3ExecutionDryRun(args) {
      events.push(["dry_run", args.payoutId, args.transactionName])
    },
    async renewPayoutV3ExecutionLease(args) {
      events.push(["renew", args.payoutId])
    },
    async recordPayoutV3ExecutionTransactionConfirmed(args) {
      events.push(["confirmed", args.payoutId, args.transactionHash])
    },
    async recordPayoutV3ExecutionSubmitted(args) {
      events.push(["submitted", args.payoutId, args.transactionHash])
    },
    async recordPayoutV3ExecutionFailed(args) {
      events.push(["failed", args.payoutId, args.failureCode])
    }
  })
  const eligibilityReader = {
    async isEligibleOperatorFor(_operatorAddress, capability) {
      assert.equal(capability, phase3.CAPABILITY_PAYOUT)
      return true
    }
  }

  const dryRun = await phase3.runPayoutV3ExecutionOnce({
    adapterAddress: ADDRESS_A,
    dataSource: createDataSource(),
    eligibilityReader,
    relayerOperatorAddress: ADDRESS_E,
    workerId: "worker-a",
    leaseMs: 30_000,
    broadcast: false
  })
  assert.equal(dryRun.status, "prepared")
  assert.equal(dryRun.broadcast, false)
  assert.deepEqual(events, [["dry_run", "payout-loop-1", "submitPayout"]])

  await assert.rejects(
    () =>
      phase3.runPayoutV3ExecutionOnce({
        adapterAddress: ADDRESS_A,
        dataSource: createDataSource(),
        eligibilityReader,
        relayerOperatorAddress: ADDRESS_E,
        workerId: "worker-a",
        leaseMs: 30_000,
        broadcast: true,
        env: {
          PHASE3_PAYOUT_EXECUTION_ENABLED: "true",
          PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
          PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
        },
        broadcaster: {
          async broadcastPreparedTransaction() {
            throw new Error("should not broadcast")
          }
        }
      }),
    /PHASE3_LIVE_TRANSACTIONS_ENABLED=true/u
  )

  events.length = 0
  const submitted = await phase3.runPayoutV3ExecutionOnce({
    adapterAddress: ADDRESS_A,
    dataSource: createDataSource(),
    eligibilityReader,
    relayerOperatorAddress: ADDRESS_E,
    workerId: "worker-a",
    leaseMs: 30_000,
    broadcast: true,
    env: {
      PHASE3_PAYOUT_EXECUTION_ENABLED: "true",
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    },
    broadcaster: {
      async broadcastPreparedTransaction(tx) {
        assert.equal(tx.to, ADDRESS_A)
        assert.equal(tx.functionName, "submitPayout")
        assert.equal(tx.data.startsWith("0x"), true)
        return { hash: THREE32, status: "success" }
      }
    }
  })
  assert.equal(submitted.status, "submitted")
  assert.equal(submitted.transactionHash, THREE32)
  assert.deepEqual(events, [
    ["renew", "payout-loop-1"],
    ["confirmed", "payout-loop-1", THREE32],
    ["submitted", "payout-loop-1", THREE32]
  ])
})

test("payout dry-run preflight enforces provider, operator, and minimum-output fee caps", async () => {
  const job = {
    payoutId: "payout-2",
    intentHash: TWO32,
    idempotencyKey: "phase3-payout:payout-2",
    status: "escrow_receipt_confirmed",
    amountIn: 1000n,
    minAmountOut: 900n,
    maxProviderFee: 50n,
    maxOperatorFee: 50n,
    providerContract: ADDRESS_D
  }
  const args = {
    job,
    relayerOperatorAddress: ADDRESS_E,
    eligibilityReader: {
      async isEligibleOperatorFor() {
        return true
      }
    }
  }

  await assert.rejects(
    () => phase3.preparePayoutExecutionDryRun({ ...args, providerFee: 51n, operatorFee: 0n }),
    /provider fee cap/u
  )
  await assert.rejects(
    () => phase3.preparePayoutExecutionDryRun({ ...args, providerFee: 0n, operatorFee: 51n }),
    /operator fee cap/u
  )
  await assert.rejects(
    () =>
      phase3.preparePayoutExecutionDryRun({
        ...args,
        job: { ...job, minAmountOut: 950n },
        providerFee: 50n,
        operatorFee: 50n
      }),
    /minimum output/u
  )
})

test("payout dry-run preflight requires an approved provider contract address", async () => {
  await assert.rejects(
    () =>
      phase3.preparePayoutExecutionDryRun({
        job: {
          payoutId: "payout-missing-provider",
          intentHash: ONE32,
          idempotencyKey: "phase3-payout:payout-missing-provider",
          status: "escrow_receipt_confirmed",
          amountIn: 1000n,
          minAmountOut: 900n,
          maxProviderFee: 50n,
          maxOperatorFee: 50n
        },
        relayerOperatorAddress: ADDRESS_E,
        providerFee: 50n,
        operatorFee: 50n,
        eligibilityReader: {
          async isEligibleOperatorFor() {
            return true
          }
        }
      }),
    /provider contract/u
  )
})

test("failed jobs retry only with explicit retryable marker and within max attempts", () => {
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "failed_retryable", retryable: true, attemptNumber: 2, maxAttempts: 3 })).ok, true)
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "failed_retryable", retryable: false, attemptNumber: 2, maxAttempts: 3 })).ok, false)
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "failed_retryable", attemptNumber: 2, maxAttempts: 3 })).ok, false)
  assert.equal(phase3.canFinalizeJob(baseJob({ status: "failed_retryable", retryable: true, attemptNumber: 3, maxAttempts: 3 })).ok, false)
})

test("finalizer consumes only eligible confirmed observations", () => {
  assert.equal(phase3.canFinalizeJob(baseJob({ observationEligibility: "eligible" })).ok, true)
  for (const observationEligibility of [undefined, "pending_confirmations", "reorged", "manual_review"]) {
    const result = phase3.canFinalizeJob(baseJob({ observationEligibility }))
    assert.equal(result.ok, false, String(observationEligibility))
    assert.equal(result.reason, "observation_not_eligible", String(observationEligibility))
  }
})

test("idempotency key is stable and binds action", () => {
  const input = { attemptId: ONE32, observationId: THREE32, routeHash: TWO32, action: "finalize_success" }
  const first = phase3.buildFinalizerIdempotencyKey(input)
  const second = phase3.buildFinalizerIdempotencyKey(input)
  const different = phase3.buildFinalizerIdempotencyKey({ ...input, action: "refund" })
  assert.equal(first, second)
  assert.notEqual(first, different)
})

test("finalizer fee cap and principal floor are enforced", () => {
  assert.equal(phase3.validateFinalizerFee({ observedAmount: 1000n, requiredPrincipal: 900n, requestedFee: 100n, maxFinalizerFee: 100n, settlementFeeBudget: 100n }).ok, true)
  assert.equal(phase3.validateFinalizerFee({ observedAmount: 1000n, requiredPrincipal: 900n, requestedFee: 101n, maxFinalizerFee: 100n, settlementFeeBudget: 200n }).ok, false)
  assert.equal(phase3.validateFinalizerFee({ observedAmount: 1000n, requiredPrincipal: 950n, requestedFee: 100n, maxFinalizerFee: 100n, settlementFeeBudget: 100n }).ok, false)
})

test("virtual-deposit finalizer preparation uses exact grossed-up settlement amount", () => {
  const tx = phase3.prepareFinalizeVirtualDepositTransaction({
    masterAddress: ADDRESS_D,
    relayerOperatorAddress: ADDRESS_E,
    authorization: baseAuthorization({
      expectedAmount: 1000n,
      observedAmount: 1000n,
      amountToShield: 900n,
      finalizerFee: 100n
    }),
    envelope: "0x1234",
    signature: "0xabcd"
  })

  assert.equal(tx.broadcast, false)
})

test("virtual-deposit finalizer preparation rejects non-exact overfunding assumptions", () => {
  assert.throws(
    () =>
      phase3.prepareFinalizeVirtualDepositTransaction({
        masterAddress: ADDRESS_D,
        relayerOperatorAddress: ADDRESS_E,
        authorization: baseAuthorization({
          expectedAmount: 900n,
          observedAmount: 1000n,
          amountToShield: 900n,
          finalizerFee: 100n
        }),
        envelope: "0x1234",
        signature: "0xabcd"
      }),
    /expectedAmount must equal observedAmount/u
  )
})

test("virtual-deposit finalizer preparation rejects a missing virtual-address binding", () => {
  assert.throws(
    () =>
      phase3.prepareFinalizeVirtualDepositTransaction({
        masterAddress: ADDRESS_D,
        relayerOperatorAddress: ADDRESS_E,
        authorization: baseAuthorization({
          virtualAddress: "0x0000000000000000000000000000000000000000"
        }),
        envelope: "0x1234",
        signature: "0xabcd"
      }),
    /virtualAddress must be a non-zero address/u
  )
})

test("virtual-deposit finalizer preparation rejects fee recipient hijack", () => {
  assert.throws(
    () =>
      phase3.prepareFinalizeVirtualDepositTransaction({
        masterAddress: ADDRESS_D,
        relayerOperatorAddress: ADDRESS_E,
        authorization: baseAuthorization({ feeRecipient: ADDRESS_A }),
        envelope: "0x1234",
        signature: "0xabcd"
      }),
    /feeRecipient must equal relayerOperatorAddress/u
  )
})

test("finalizer allowed actions exclude refunds, rescue, admin, and owner operations", () => {
  assert.deepEqual(phase3.PHASE3_FINALIZER_ALLOWED_ACTIONS, ["finalize_success"])
  assert.equal(phase3.isFinalizerActionAllowed("claim_refund"), false)
  assert.equal(phase3.isFinalizerActionAllowed("rescue"), false)
  assert.equal(phase3.isFinalizerActionAllowed("owner_admin"), false)
})

test("source payer is not inferred from virtual address", () => {
  const classification = phase3.classifySourceFromProvider({ virtualAddress: ADDRESS_A })
  assert.equal(classification.sourcePayerKnown, false)
  assert.equal(classification.classification, "unknown")
})

test("explicit provider source classification is preserved without identity proof", () => {
  const classification = phase3.classifySourceFromProvider({ classification: "cex_or_custodial", sourcePayer: ADDRESS_A })
  assert.equal(classification.classification, "cex_or_custodial")
  assert.equal(classification.sourcePayerKnown, false)
})

test("public finalizer status is redacted through shared helpers", () => {
  const publicStatus = phase3.redactFinalizerStatusForPublic({
    paymentId: "payment-1",
    status: "completed",
    payerWallet: ADDRESS_A,
    refundWallet: ADDRESS_B,
    authorityWallet: ADDRESS_C,
    providerRouteWallet: ADDRESS_D,
    txHash: THREE32
  })
  const expected = sharedTypes.redactPhase3PublicPaymentStatus({
    paymentId: "payment-1",
    status: "completed",
    payerWallet: ADDRESS_A,
    refundWallet: ADDRESS_B,
    authorityWallet: ADDRESS_C,
    providerRouteWallet: ADDRESS_D,
    txHash: THREE32
  })
  assert.deepEqual(publicStatus, expected)
  assert.equal("payerWallet" in publicStatus, false)
  assert.equal("refundWallet" in publicStatus, false)
})

test("virtual deposit finalization transaction is prepared but not broadcast", () => {
  const tx = phase3.prepareFinalizeVirtualDepositTransaction({
    masterAddress: ADDRESS_D,
    relayerOperatorAddress: ADDRESS_E,
    authorization: baseAuthorization(),
    envelope: "0x1234",
    signature: "0xabcd"
  })
  assert.equal(tx.to, ADDRESS_D)
  assert.equal(tx.functionName, "finalizeVirtualDeposit")
  assert.equal(tx.broadcast, false)
})

test("relayer-owned one-time execution prepares register, observe, then finalize without broadcasting", () => {
  const attemptTx = phase3.prepareAttemptRegistrationTransaction({
    masterAddress: ADDRESS_D,
    authorization: baseAttemptAuthorization(),
    signature: "0xaaaa"
  })
  const observationTx = phase3.prepareObservationAttestationTransaction({
    masterAddress: ADDRESS_D,
    attemptId: ONE32,
    observation: baseDepositObservation(),
    attestation: baseObservationAttestation(),
    signature: "0xbbbb"
  })
  const plan = phase3.prepareRelayerOwnedOneTimeExecutionPlan({
    masterAddress: ADDRESS_D,
    relayerOperatorAddress: ADDRESS_E,
    attemptAuthorization: baseAttemptAuthorization(),
    attemptSignature: "0xaaaa",
    observation: baseDepositObservation(),
    observationAttestation: baseObservationAttestation(),
    observationSignature: "0xbbbb",
    settlementAuthorization: baseAuthorization({ feeRecipient: ADDRESS_E }),
    envelope: "0x1234",
    settlementSignature: "0xcccc"
  })

  assert.equal(attemptTx.functionName, "registerAttemptWithAuthorization")
  assert.equal(observationTx.functionName, "recordDepositObservationWithAttestation")
  assert.equal(attemptTx.data, encodeFunctionData({
    abi: parlyVirtualDepositMasterV2Abi,
    functionName: "registerAttemptWithAuthorization",
    args: [baseAttemptAuthorization(), "0xaaaa"]
  }))
  assert.equal(observationTx.data, encodeFunctionData({
    abi: parlyVirtualDepositMasterV2Abi,
    functionName: "recordDepositObservationWithAttestation",
    args: [ONE32, baseDepositObservation(), baseObservationAttestation(), "0xbbbb"]
  }))
  assert.deepEqual(plan.transactions.map((tx) => tx.functionName), [
    "registerAttemptWithAuthorization",
    "recordDepositObservationWithAttestation",
    "finalizeVirtualDeposit"
  ])
  assert.ok(plan.transactions.every((tx) => tx.broadcast === false))
  assert.equal(plan.relayerPaysGas, true)
  assert.equal(plan.finalizerFeeRecipient, ADDRESS_E)
})

test("relayer-owned one-time execution rejects non-exact or hijacked finalizer fee recipients", () => {
  assert.throws(
    () =>
      phase3.prepareRelayerOwnedOneTimeExecutionPlan({
        masterAddress: ADDRESS_D,
        relayerOperatorAddress: ADDRESS_E,
        attemptAuthorization: baseAttemptAuthorization(),
        attemptSignature: "0xaaaa",
        observation: baseDepositObservation(),
        observationAttestation: baseObservationAttestation(),
        observationSignature: "0xbbbb",
        settlementAuthorization: baseAuthorization({ feeRecipient: ADDRESS_A }),
        envelope: "0x1234",
        settlementSignature: "0xcccc"
      }),
    /feeRecipient must equal relayerOperatorAddress/u
  )
  assert.throws(
    () =>
      phase3.prepareRelayerOwnedOneTimeExecutionPlan({
        masterAddress: ADDRESS_D,
        relayerOperatorAddress: ADDRESS_E,
        attemptAuthorization: baseAttemptAuthorization(),
        attemptSignature: "0xaaaa",
        observation: baseDepositObservation({ amount: 999n }),
        observationAttestation: baseObservationAttestation({ amount: 999n }),
        observationSignature: "0xbbbb",
        settlementAuthorization: baseAuthorization({ expectedAmount: 1000n, observedAmount: 999n }),
        envelope: "0x1234",
        settlementSignature: "0xcccc"
      }),
    /exact observed amount/u
  )
})

function baseRelayerOwnedExecutionJob(overrides = {}) {
  return {
    jobId: "job-one-time-exact",
    leaseToken: "lease-token-worker-a",
    masterAddress: ADDRESS_D,
    relayerOperatorAddress: ADDRESS_E,
    attemptAuthorization: baseAttemptAuthorization(),
    attemptSignature: "0xaaaa",
    observation: baseDepositObservation(),
    observationAttestation: baseObservationAttestation(),
    observationSignature: "0xbbbb",
    settlementAuthorization: baseAuthorization({ feeRecipient: ADDRESS_E }),
    envelope: "0x1234",
    settlementSignature: "0xcccc",
    ...overrides
  }
}

test('receiving finalization refresh changes only membership and its bound signature after prefix confirmation',async()=>{
  const proof=`0x${'00'.repeat(256)}`,freshProof=`0x${'01'.repeat(256)}`
  const envelope=encodeAbiParameters(Array(4).fill({type:'bytes'}),['0x01','0x02','0x03',proof])
  const fresh=encodeAbiParameters(Array(4).fill({type:'bytes'}),['0x01','0x02','0x03',freshProof])
  const job=baseRelayerOwnedExecutionJob({envelope,
    attemptAuthorization:baseAttemptAuthorization({chainId:31337n,settlementDomainId:99n}),
    observationAttestation:baseObservationAttestation({chainId:31337n,settlementDomainId:99n}),
    settlementAuthorization:baseAuthorization({chainId:31337n,settlementDomainId:99n,paymentMethod:2,envelopeHash:keccak256(envelope)})})
  const broadcasts=[];let refreshes=0,lease=true,expireOnRefresh=false
  const run=replacement=>phase3.runRelayerOwnedOneTimeExecutionOnce({workerId:'qa',leaseMs:30000,broadcast:true,
    env:{PHASE3_FINALIZER_ENABLED:'true',PHASE3_LIVE_TRANSACTIONS_ENABLED:'true',PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED:'true'},
    dataSource:{acquireRelayerOwnedOneTimeExecutionJob:async()=>job,renewRelayerOwnedOneTimeExecutionLease:async()=>assert.ok(lease)},
    refreshReceivingFinalization:async current=>{refreshes++;assert.equal(broadcasts.length,2);assert.equal(current.confirmedTransactions.length,2);if(expireOnRefresh)lease=false;return replacement},
    executeReceivingFinalization:async(current,tx)=>{assert.equal(current.confirmedTransactions.length,2);assert.equal(tx.functionName,'finalizeVirtualDeposit');broadcasts.push(tx);return{hash:ONE32,status:'success'}},
    broadcaster:{broadcastPreparedTransaction:async tx=>{assert.notEqual(tx.functionName,'finalizeVirtualDeposit');broadcasts.push(tx);return{hash:ONE32,status:'success'}}}})
  await run({envelope:fresh,settlementSignature:'0xdddd'})
  assert.equal(refreshes,1)
  const decoded=decodeFunctionData({abi:parlyVirtualDepositMasterV2Abi,data:broadcasts[2].data})
  assert.equal(decoded.args[1],fresh);assert.equal(decoded.args[2],'0xdddd')
  assert.equal(decoded.args[0].expiresAt,job.settlementAuthorization.expiresAt)
  assert.equal(decoded.args[0].amountToShield,job.settlementAuthorization.amountToShield)
  assert.equal(job.envelope,envelope,'original queued bytes must remain unchanged')
  broadcasts.length=0
  await assert.rejects(()=>run({envelope:encodeAbiParameters(Array(4).fill({type:'bytes'}),['0xff','0x02','0x03',freshProof]),settlementSignature:'0xdddd'}),/broadcast failed/)
  assert.equal(broadcasts.length,2,'a changed body must not reach finalization broadcast')
  broadcasts.length=0;expireOnRefresh=true
  await assert.rejects(()=>run({envelope:fresh,settlementSignature:'0xdddd'}),/broadcast failed/)
  assert.equal(broadcasts.length,2,'lease loss during refresh must not reach finalization broadcast')
})

test('receiving refresh is never invoked by the active route or a dry run',async()=>{
  const run=overrides=>phase3.runRelayerOwnedOneTimeExecutionOnce({workerId:'qa',leaseMs:30000,broadcast:true,
    env:{PHASE3_FINALIZER_ENABLED:'true',PHASE3_LIVE_TRANSACTIONS_ENABLED:'true',PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED:'true'},
    dataSource:{acquireRelayerOwnedOneTimeExecutionJob:async()=>baseRelayerOwnedExecutionJob()},
    refreshReceivingFinalization:async()=>assert.fail('inactive receiving callback must not run'),
    executeReceivingFinalization:async()=>assert.fail('inactive durable callback must not run'),
    broadcaster:{broadcastPreparedTransaction:async()=>({hash:ONE32,status:'success'})},...overrides})
  assert.equal((await run({})).status,'submitted')
  assert.equal((await run({broadcast:false})).status,'prepared')
})

test('durable receiving dispatch requires both handlers and a lease guard before any prefix broadcast',async()=>{
  const job=baseRelayerOwnedExecutionJob({
    attemptAuthorization:baseAttemptAuthorization({chainId:31337n,settlementDomainId:99n}),
    observationAttestation:baseObservationAttestation({chainId:31337n,settlementDomainId:99n}),
    settlementAuthorization:baseAuthorization({chainId:31337n,settlementDomainId:99n,paymentMethod:2})})
  let broadcasts=0
  const run=overrides=>phase3.runRelayerOwnedOneTimeExecutionOnce({workerId:'qa',leaseMs:30000,broadcast:true,
    env:{PHASE3_FINALIZER_ENABLED:'true',PHASE3_LIVE_TRANSACTIONS_ENABLED:'true',PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED:'true'},
    dataSource:{acquireRelayerOwnedOneTimeExecutionJob:async()=>job},
    executeReceivingFinalization:async()=>assert.fail('incomplete receiving runtime'),
    broadcaster:{broadcastPreparedTransaction:async()=>{broadcasts++;return{hash:ONE32,status:'success'}}},...overrides})
  await assert.rejects(()=>run({}),/requires refresh and lease guards/)
  await assert.rejects(()=>run({executeReceivingFinalization:undefined,refreshReceivingFinalization:async()=>assert.fail('missing durable handler')}),/requires refresh and lease guards/)
  assert.equal(broadcasts,0)
})

test('native V4 jobs cannot use the legacy broadcaster without a matched durable runtime', async () => {
  const envelope = encodeAbiParameters(Array(4).fill({ type: 'bytes' }), ['0x505204', '0x02', '0x03', '0x'])
  const job = baseRelayerOwnedExecutionJob({ envelope, settlementAuthorization: baseAuthorization({ paymentMethod: 2, routeType: 0, envelopeHash: keccak256(envelope) }) })
  let broadcasts = 0
  await assert.rejects(() => phase3.runRelayerOwnedOneTimeExecutionOnce({ workerId: 'qa', leaseMs: 30000, broadcast: true,
    env: { PHASE3_FINALIZER_ENABLED: 'true', PHASE3_LIVE_TRANSACTIONS_ENABLED: 'true', PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: 'true' },
    dataSource: { acquireRelayerOwnedOneTimeExecutionJob: async () => job },
    broadcaster: { broadcastPreparedTransaction: async () => { broadcasts++; return { hash: ONE32, status: 'success' } } }
  }), /V4.*runtime/)
  assert.equal(broadcasts, 0)
})

test('matched native V4 execution dispatches every prefix durably and keeps Shield membership empty', async () => {
  for (const routeType of [0,3]) {
  const envelope = encodeAbiParameters(Array(4).fill({ type: 'bytes' }), ['0x505204', '0x02', '0x03', '0x'])
  const profile = { version: 4, chainId: 4217, settlementDomain: 4217n, environment: ONE32, virtualMasterId: '0x12345678', origin: 'https://parly.fi', registry: ADDRESS_A, verifier: ADDRESS_B, master: ADDRESS_D, receiver: ADDRESS_C, hasher: ADDRESS_A, owner: ADDRESS_E, treasury: ADDRESS_E, preparationAuthority: ADDRESS_E,
    proofs: { enrollment: ADDRESS_A, shield: ADDRESS_B, publication: ADDRESS_C, membership: ADDRESS_D, spend: ADDRESS_E }, assets: [{ assetId: 1, token: ADDRESS_A, pool: ADDRESS_B, policyId: 1n, sourceChainIds: [4217n] }], codePins: [ADDRESS_A, ADDRESS_B, ADDRESS_C, ADDRESS_D, ADDRESS_E].map(address => ({ address, codeHash: ONE32 })) }
  const job = baseRelayerOwnedExecutionJob({ envelope, settlementAuthorization: baseAuthorization({ paymentMethod: 2, routeType, envelopeHash: keccak256(envelope), virtualMasterId: profile.virtualMasterId + '0'.repeat(56) }) })
  const calls = []
  const result = await phase3.runRelayerOwnedOneTimeExecutionOnce({ workerId: 'qa', leaseMs: 30000, broadcast: true,
    env: { PHASE3_FINALIZER_ENABLED: 'true', PHASE3_LIVE_TRANSACTIONS_ENABLED: 'true', PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: 'true' },
    dataSource: { acquireRelayerOwnedOneTimeExecutionJob: async () => job, renewRelayerOwnedOneTimeExecutionLease: async () => {} },
    receivingV4: { profile, refreshFinalization: async current => { assert.equal(current.confirmedTransactions.length, 2); calls.push('refresh'); return { envelope, settlementSignature: '0xdddd' } },
      executeTransaction: async (current, tx) => { assert.equal(current.confirmedTransactions.length, calls.filter(c => c !== 'refresh').length); calls.push(tx.functionName); return { hash: ONE32, status: 'success' } } },
    broadcaster: { broadcastPreparedTransaction: async () => assert.fail('native V4 must not use the legacy broadcaster') }
  })
  assert.equal(result.status, 'submitted')
  assert.deepEqual(calls, ['registerAttemptWithAuthorization', 'recordDepositObservationWithAttestation', 'refresh', 'finalizeVirtualDeposit'])
  for(const pendingAt of [0,1,2]){
    let executed=0,confirmed=0,deferred=0
    const pending=await phase3.runRelayerOwnedOneTimeExecutionOnce({workerId:'qa',leaseMs:30000,broadcast:true,
      env:{PHASE3_FINALIZER_ENABLED:'true',PHASE3_LIVE_TRANSACTIONS_ENABLED:'true',PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED:'true'},
      dataSource:{acquireRelayerOwnedOneTimeExecutionJob:async()=>job,renewRelayerOwnedOneTimeExecutionLease:async()=>{},
        deferRelayerOwnedOneTimeExecutionJob:async args=>{assert.equal(args.leaseToken,job.leaseToken);deferred++},
        recordRelayerOwnedOneTimeExecutionFailed:async()=>assert.fail('pending is not failure'),recordRelayerOwnedOneTimeExecutionSubmitted:async()=>assert.fail('pending is not submitted'),
        recordRelayerOwnedOneTimeExecutionTransactionConfirmed:async()=>{confirmed++}},
      receivingV4:{profile,refreshFinalization:async()=>({envelope,settlementSignature:'0xdddd'}),executeTransaction:async()=>executed++===pendingAt?{status:'pending'}:{hash:ONE32,status:'success'}},
      broadcaster:{broadcastPreparedTransaction:async()=>assert.fail('no legacy fallback')}})
    assert.equal(pending.status,'pending');assert.equal(confirmed,pendingAt);assert.equal(deferred,1)
  }
  }
})

test("relayer-owned execution loop defaults to dry-run and records no broadcast", async () => {
  const calls = []
  const dryRuns = []
  const result = await phase3.runRelayerOwnedOneTimeExecutionOnce({
    workerId: "worker-a",
    leaseMs: 30_000,
    dataSource: {
      async acquireRelayerOwnedOneTimeExecutionJob(args) {
        calls.push(args)
        return baseRelayerOwnedExecutionJob()
      },
      async recordRelayerOwnedOneTimeExecutionDryRun(args) {
        dryRuns.push(args)
      }
    },
    broadcaster: {
      async broadcastPreparedTransaction() {
        throw new Error("broadcast must not run in dry-run mode")
      }
    }
  })

  assert.equal(result.status, "prepared")
  assert.equal(result.broadcast, false)
  assert.equal(result.jobId, "job-one-time-exact")
  assert.deepEqual(result.transactionNames, [
    "registerAttemptWithAuthorization",
    "recordDepositObservationWithAttestation",
    "finalizeVirtualDeposit"
  ])
  assert.deepEqual(calls, [{ workerId: "worker-a", leaseMs: 30_000 }])
  assert.deepEqual(dryRuns, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      transactionNames: [
        "registerAttemptWithAuthorization",
        "recordDepositObservationWithAttestation",
        "finalizeVirtualDeposit"
      ]
    }
  ])
})

test("relayer-owned execution loop requires explicit finalizer and broadcast flags", async () => {
  await assert.rejects(
    () =>
      phase3.runRelayerOwnedOneTimeExecutionOnce({
        workerId: "worker-a",
        leaseMs: 30_000,
        broadcast: true,
        env: {
          PHASE3_FINALIZER_ENABLED: "true",
          PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
          PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
        },
        dataSource: {
          async acquireRelayerOwnedOneTimeExecutionJob() {
            return baseRelayerOwnedExecutionJob()
          }
        },
        broadcaster: {
          async broadcastPreparedTransaction() {
            throw new Error("broadcast must not run without all gates")
          }
        }
      }),
    /PHASE3_FINALIZER_ENABLED=true.*PHASE3_LIVE_TRANSACTIONS_ENABLED=true.*PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED=true/u
  )
})

test("relayer-owned execution quarantines an invalid leased payload before broadcast", async () => {
  const invalidPayloads = []
  await assert.rejects(
    () =>
      phase3.runRelayerOwnedOneTimeExecutionOnce({
        workerId: "worker-a",
        leaseMs: 30_000,
        dataSource: {
          async acquireRelayerOwnedOneTimeExecutionJob() {
            return baseRelayerOwnedExecutionJob({
              observation: baseDepositObservation({ amount: 999n })
            })
          },
          async recordRelayerOwnedOneTimeExecutionPayloadInvalid(args) {
            invalidPayloads.push(args)
          }
        }
      }),
    /exact observed amount/u
  )
  assert.deepEqual(invalidPayloads, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      failureCode: "invalid_execution_payload"
    }
  ])
})

test("relayer-owned execution loop broadcasts exactly the prepared sequence when explicitly enabled", async () => {
  const broadcasts = []
  const submitted = []
  const renewals = []
  const result = await phase3.runRelayerOwnedOneTimeExecutionOnce({
    workerId: "worker-a",
    leaseMs: 30_000,
    broadcast: true,
    env: {
      PHASE3_FINALIZER_ENABLED: "true",
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    },
    dataSource: {
      async acquireRelayerOwnedOneTimeExecutionJob() {
        return baseRelayerOwnedExecutionJob()
      },
      async renewRelayerOwnedOneTimeExecutionLease(args) {
        renewals.push(args)
      },
      async recordRelayerOwnedOneTimeExecutionSubmitted(args) {
        submitted.push(args)
      }
    },
    broadcaster: {
      async broadcastPreparedTransaction(tx) {
        broadcasts.push(tx)
        return { hash: `0x${String(broadcasts.length).repeat(64)}`, status: "success" }
      }
    }
  })

  assert.equal(result.status, "submitted")
  assert.equal(result.broadcast, true)
  assert.deepEqual(
    broadcasts.map((tx) => tx.functionName),
    ["registerAttemptWithAuthorization", "recordDepositObservationWithAttestation", "finalizeVirtualDeposit"]
  )
  assert.deepEqual(renewals, [
    { jobId: "job-one-time-exact", leaseToken: "lease-token-worker-a" },
    { jobId: "job-one-time-exact", leaseToken: "lease-token-worker-a" },
    { jobId: "job-one-time-exact", leaseToken: "lease-token-worker-a" }
  ])
  assert.deepEqual(submitted, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      transactionHashes: [
        `0x${"1".repeat(64)}`,
        `0x${"2".repeat(64)}`,
        `0x${"3".repeat(64)}`
      ]
    }
  ])
})

test("relayer-owned execution checkpoints a confirmed prefix and resumes without replay", async () => {
  const confirmed = []
  const failures = []
  let broadcastAttempt = 0
  const dataSource = {
    async acquireRelayerOwnedOneTimeExecutionJob() {
      return baseRelayerOwnedExecutionJob()
    },
    async recordRelayerOwnedOneTimeExecutionTransactionConfirmed(args) {
      confirmed.push(args)
    },
    async recordRelayerOwnedOneTimeExecutionFailed(args) {
      failures.push(args)
    }
  }

  await assert.rejects(
    () =>
      phase3.runRelayerOwnedOneTimeExecutionOnce({
        workerId: "worker-a",
        leaseMs: 30_000,
        broadcast: true,
        env: {
          PHASE3_FINALIZER_ENABLED: "true",
          PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
          PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
        },
        dataSource,
        broadcaster: {
          async broadcastPreparedTransaction() {
            broadcastAttempt += 1
            if (broadcastAttempt === 2) return { hash: `0x${"2".repeat(64)}`, status: "reverted" }
            return { hash: `0x${String(broadcastAttempt).repeat(64)}`, status: "success" }
          }
        }
      }),
    /recordDepositObservationWithAttestation reverted/u
  )

  assert.deepEqual(confirmed, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      functionName: "registerAttemptWithAuthorization",
      transactionHash: `0x${"1".repeat(64)}`
    }
  ])
  assert.deepEqual(failures, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      failedFunctionName: "recordDepositObservationWithAttestation",
      failureCode: "transaction_reverted"
    }
  ])

  const resumedBroadcasts = []
  const submitted = []
  const resumed = await phase3.runRelayerOwnedOneTimeExecutionOnce({
    workerId: "worker-b",
    leaseMs: 30_000,
    broadcast: true,
    env: {
      PHASE3_FINALIZER_ENABLED: "true",
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    },
    dataSource: {
      async acquireRelayerOwnedOneTimeExecutionJob() {
        return {
          ...baseRelayerOwnedExecutionJob(),
          confirmedTransactions: [
            {
              functionName: "registerAttemptWithAuthorization",
              transactionHash: `0x${"1".repeat(64)}`
            }
          ]
        }
      },
      async recordRelayerOwnedOneTimeExecutionSubmitted(args) {
        submitted.push(args)
      }
    },
    broadcaster: {
      async broadcastPreparedTransaction(tx) {
        resumedBroadcasts.push(tx)
        return { hash: `0x${String(resumedBroadcasts.length + 2).repeat(64)}`, status: "success" }
      }
    }
  })

  assert.deepEqual(
    resumedBroadcasts.map((tx) => tx.functionName),
    ["recordDepositObservationWithAttestation", "finalizeVirtualDeposit"]
  )
  assert.deepEqual(resumed.transactionHashes, [
    `0x${"1".repeat(64)}`,
    `0x${"3".repeat(64)}`,
    `0x${"4".repeat(64)}`
  ])
  assert.deepEqual(submitted, [
    {
      jobId: "job-one-time-exact",
      leaseToken: "lease-token-worker-a",
      transactionHashes: [`0x${"1".repeat(64)}`, `0x${"3".repeat(64)}`, `0x${"4".repeat(64)}`]
    }
  ])
})

test("connected-wallet settlement transaction is prepared but not broadcast", () => {
  const tx = phase3.prepareConnectedWalletSettlementTransaction({
    receiverAddress: ADDRESS_C,
    settlement: {
      attemptId: ONE32,
      authorizationNonce: TWO32,
      provider: ADDRESS_E,
      token: ADDRESS_A,
      pool: ADDRESS_B,
      assetId: 1n,
      amountToShield: 900n,
      expectedAmount: 900n,
      innerCommitment: 123n,
      policySubjectField: 456n,
      routeType: 2,
      paymentContext: 1,
      refundClaimantBinding: 1,
      refundWalletCommitment: TWO32,
      routeHash: THREE32,
      expiresAt: 9999999999n,
      envelopeHash: ONE32
    },
    envelope: "0x1234",
    signature: "0xabcd"
  })
  assert.equal(tx.to, ADDRESS_C)
  assert.equal(tx.functionName, "settleConnectedWallet")
  assert.equal(tx.broadcast, false)
})
