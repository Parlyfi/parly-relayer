import { pathToFileURL } from "node:url"

const ZERO32 = `0x${"0".repeat(64)}`
const ONE32 = `0x${"1".repeat(64)}`
const TWO32 = `0x${"2".repeat(64)}`
const THREE32 = `0x${"3".repeat(64)}`
const ADDRESS_A = "0x1111111111111111111111111111111111111111"
const ADDRESS_B = "0x2222222222222222222222222222222222222222"
const ADDRESS_C = "0x3333333333333333333333333333333333333333"
const ADDRESS_D = "0x4444444444444444444444444444444444444444"
const ADDRESS_E = "0x5555555555555555555555555555555555555555"

async function loadPhase3() {
  return import("../dist/apps/relayer/src/phase3/index.js")
}

function createJob(phase3, overrides = {}) {
  const attemptId = ONE32
  const routeHash = TWO32
  const observationId = THREE32
  return {
    jobId: "queued-poc-job",
    attemptId,
    routeHash,
    observationId,
    observationEligibility: "eligible",
    status: "queued",
    lockedBy: null,
    lockedUntil: null,
    attemptNumber: 0,
    maxAttempts: 3,
    idempotencyKey: phase3.buildFinalizerIdempotencyKey({
      attemptId,
      observationId,
      routeHash,
      action: "finalize_success"
    }),
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    requiredPrincipal: 900n,
    observedAmount: 1_000n,
    maxFinalizerFee: 100n,
    settlementFeeBudget: 100n,
    finalizerFee: 100n,
    ...overrides
  }
}

export async function createMockFinalizerPocJobs(phase3Input) {
  const phase3 = phase3Input ?? (await loadPhase3())
  return [
    createJob(phase3),
    createJob(phase3, {
      jobId: "pending-confirmations-poc-job",
      observationEligibility: "pending_confirmations"
    }),
    createJob(phase3, { jobId: "manual-poc-job", status: "manual_review" }),
    createJob(phase3, { jobId: "refund-poc-job", status: "refund_available" }),
    createJob(phase3, { jobId: "ignored-poc-job", status: "ignored" }),
    createJob(phase3, { jobId: "confirmed-poc-job", status: "confirmed" })
  ]
}

export function createMockFinalizerPocAuthorization(overrides = {}) {
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
    expectedAmount: 1_000n,
    observedAmount: 1_000n,
    payerTotal: 1_000n,
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
    expiresAt: 9_999_999_999n,
    innerCommitment: 123n,
    envelopeHash: ONE32,
    ...overrides
  }
}

export async function runFinalizerDryRunPoc({
  phase3: phase3Input,
  jobs: jobsInput,
  authorization = createMockFinalizerPocAuthorization(),
  relayerOperatorAddress = ADDRESS_E,
  eligibilityReader = {
    async isEligibleOperatorFor() {
      return true
    }
  }
} = {}) {
  const phase3 = phase3Input ?? (await loadPhase3())
  const jobs = jobsInput ? await jobsInput : await createMockFinalizerPocJobs(phase3)
  const dataSource = phase3.createInMemoryPhase3FinalizerJobDataSource({ jobs })
  const operatorEligible = await eligibilityReader.isEligibleOperatorFor(
    relayerOperatorAddress,
    phase3.CAPABILITY_SETTLEMENT
  )
  const eligibleJobs = await phase3.listFinalizableJobsForEligibleOperator({
    dataSource,
    eligibilityReader,
    relayerOperatorAddress
  })
  const eligibleIds = new Set(eligibleJobs.map((job) => job.jobId))
  const prepared = eligibleJobs.map((job) => {
    const tx = phase3.prepareFinalizeVirtualDepositTransaction({
      masterAddress: ADDRESS_D,
      relayerOperatorAddress,
      authorization,
      envelope: "0x1234",
      signature: "0xabcd"
    })
    return {
      jobId: job.jobId,
      idempotencyKey: job.idempotencyKey,
      to: tx.to,
      functionName: tx.functionName,
      calldataBytes: (tx.data.length - 2) / 2,
      broadcast: tx.broadcast
    }
  })

  return {
    dryRun: true,
    operatorEligible,
    prepared,
    skipped: jobs
      .filter((job) => !eligibleIds.has(job.jobId))
      .map((job) => ({
        jobId: job.jobId,
        status: job.status,
        observationEligibility: job.observationEligibility
      }))
  }
}

async function main() {
  console.log(JSON.stringify(await runFinalizerDryRunPoc(), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Finalizer POC failed.")
    process.exitCode = 1
  })
}
