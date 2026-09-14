import assert from "node:assert/strict"
import { test } from "node:test"

const phase3 = await import("../dist/apps/relayer/src/phase3/index.js")
const broadcastGate = await import("../dist/apps/relayer/src/phase3-broadcast-gate.js")
const sharedTypes = await import("../dist/packages/shared-types/src/index.js")

const ZERO32 = `0x${"0".repeat(64)}`
const ONE32 = `0x${"1".repeat(64)}`
const TWO32 = `0x${"2".repeat(64)}`
const THREE32 = `0x${"3".repeat(64)}`
const ADDRESS_A = "0x1111111111111111111111111111111111111111"
const ADDRESS_B = "0x2222222222222222222222222222222222222222"
const ADDRESS_C = "0x3333333333333333333333333333333333333333"
const ADDRESS_D = "0x4444444444444444444444444444444444444444"
const ADDRESS_E = "0x5555555555555555555555555555555555555555"
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

test("V3 payout runtime config accepts deployed addresses only while execution flags are closed", () => {
  const config = phase3.readPhase3PayoutV3RuntimeConfig({
    PHASE3_V3_PAYOUT_RUNTIME_ENABLED: "true",
    TEMPO_CHAIN_ID: "4217",
    SETTLEMENT_DOMAIN_ID: "4217",
    PHASE3_V3_PAYOUT_ADAPTER: ADDRESS_A,
    PHASE3_V3_PAYOUT_LIABILITY_VAULT: ADDRESS_B,
    PHASE3_V3_PAYOUT_PROOF_VERIFIER: ADDRESS_C,
    PHASE3_V3_RELAY_OUTBOUND_PROVIDER: ADDRESS_D,
    PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2: ADDRESS_E,
    PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET: "0x6666666666666666666666666666666666666666",
    PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
    PHASE3_PRODUCTION_ROUTES_ENABLED: "false",
    PHASE3_PAYOUT_EXECUTION_ENABLED: "false",
    PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "false",
    PHASE3_FEE_PAYER_ENABLED: "false",
    PHASE3_FUNDED_POC_ENABLED: "false",
    CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED: "false"
  })

  assert.equal(config.enabled, true)
  assert.equal(config.tempoChainId, 4217)
  assert.equal(config.settlementDomainId, 4217)
  assert.equal(config.payoutAdapterV3, ADDRESS_A)
  assert.equal(config.relayOutboundProviderV2, ADDRESS_E)
  assert.equal(config.broadcastEnabled, false)
  assert.equal(config.payoutExecutionEnabled, false)
})

test("V3 payout runtime config fails closed if a live or payout flag is enabled", () => {
  assert.throws(
    () =>
      phase3.readPhase3PayoutV3RuntimeConfig({
        PHASE3_V3_PAYOUT_RUNTIME_ENABLED: "true",
        TEMPO_CHAIN_ID: "4217",
        SETTLEMENT_DOMAIN_ID: "4217",
        PHASE3_V3_PAYOUT_ADAPTER: ADDRESS_A,
        PHASE3_V3_PAYOUT_LIABILITY_VAULT: ADDRESS_B,
        PHASE3_V3_PAYOUT_PROOF_VERIFIER: ADDRESS_C,
        PHASE3_V3_RELAY_OUTBOUND_PROVIDER: ADDRESS_D,
        PHASE3_V3_RELAY_OUTBOUND_PROVIDER_V2: ADDRESS_E,
        PHASE3_V3_RELAY_DEPOSIT_ADDRESS_TARGET: "0x6666666666666666666666666666666666666666",
        PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
        PHASE3_PRODUCTION_ROUTES_ENABLED: "false",
        PHASE3_PAYOUT_EXECUTION_ENABLED: "true",
        PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "false",
        PHASE3_FEE_PAYER_ENABLED: "false",
        PHASE3_FUNDED_POC_ENABLED: "false",
        CAMPAIGN_POOLV2_ATTRIBUTION_AWARDS_ENABLED: "false"
      }),
    /PHASE3_PAYOUT_EXECUTION_ENABLED must remain false/u
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
