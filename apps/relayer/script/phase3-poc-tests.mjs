import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { encodeAbiParameters, encodeFunctionData, keccak256 } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { tempoShieldedPoolV3Abi } from "@parly/protocol-abis"
import {
  createMockFinalizerPocAuthorization,
  createMockFinalizerPocJobs,
  runFinalizerDryRunPoc
} from "./phase3-finalizer-poc.mjs"
import { runPayoutDryRunPoc } from "./phase3-payout-poc.mjs"

const phase3 = await import("../dist/apps/relayer/src/phase3/index.js")
const poolV3 = await import("../dist/apps/relayer/src/phase3/pool-v3-runtime.js")
const feeScheduleV2 = await import(
  "../dist/apps/relayer/src/phase3/relay-execution-fee-schedule-v2.js"
)
const registryHeartbeat = await import("../dist/apps/relayer/src/registry-heartbeat.js")

const POOL_V3 = "0x1111111111111111111111111111111111111111"
const POOL_V3_B = "0x2222222222222222222222222222222222222222"
const RELAYER_ACCOUNT = privateKeyToAccount(`0x${"2".repeat(64)}`)
const RELAYER = RELAYER_ACCOUNT.address
const EXECUTOR_V2 = "0x3333333333333333333333333333333333333333"
const ADAPTER_V6 = "0x4444444444444444444444444444444444444444"
const TOKEN = "0x5555555555555555555555555555555555555555"
const ESCROW = "0x6666666666666666666666666666666666666666"
const ARTIFACT = `0x${"a".repeat(64)}`
const ZERO_HASH = `0x${"0".repeat(64)}`
const PAYLOAD_DOMAIN = keccak256(new TextEncoder().encode("PARLY_POOL_V3_WITHDRAWAL_PAYLOAD_V1"))

async function signedFeeSchedule({
  mode = 0,
  inputCount = 1,
  outputCount = mode === 0 ? 1 : 0,
  fee = 5n,
  maximumGasPrice = 100n,
  validAfter = 1000,
  expiry = 1300,
  account = RELAYER_ACCOUNT
} = {}) {
  return feeScheduleV2.signRelayExecutionFeeScheduleV2(account, {
    chainId: 4217,
    pool: POOL_V3,
    executionMode: mode,
    inputCount,
    outputCount,
    executorFee: fee.toString(),
    maximumGasPrice: maximumGasPrice.toString(),
    scheduleNonce: `0x${"9".repeat(64)}`,
    validAfter,
    expiry,
    relayer: account.address
  })
}

async function poolV3Payload({ mode = 0, executor = RELAYER, fee = 5n } = {}) {
  const signals = Array(57).fill(0n)
  signals[11] = 1n
  signals[15] = 1n
  signals[16] = fee
  signals[18] = 1n
  signals[19] = 4217n
  signals[20] = 4217n
  signals[21] = BigInt(POOL_V3)
  signals[22] = 3n
  signals[23] = BigInt(mode)
  signals[24] = BigInt(ESCROW)
  signals[34] = 100n
  for (let index = 44; index < 54; index += 1) signals[index] = 4217n
  signals[56] = BigInt(executor)
  return {
    version: 2,
    poolVersion: 3,
    verifierArtifactHash: ARTIFACT,
    executionMode: mode,
    pool: POOL_V3,
    pA: ["0x01", "0x02"],
    pB: [["0x03", "0x04"], ["0x05", "0x06"]],
    pC: ["0x07", "0x08"],
    pubSignals: signals.map(String),
    recipients: [ESCROW, ...Array(9).fill("0x0000000000000000000000000000000000000000")],
    amounts: ["100", ...Array(9).fill("0")],
    settlementDomains: Array(10).fill(4217),
    newChangeCommitment: ZERO_HASH,
    newChangeEnvelope: "0x",
    executorFee: fee.toString(),
    feeSchedule: await signedFeeSchedule({ mode, fee })
  }
}

function runtimeConfig(relayer = RELAYER) {
  return {
    chainId: 4217,
    settlementDomainId: 4217,
    relayer,
    pools: new Map([[POOL_V3.toLowerCase(), ARTIFACT]]),
    maximumExecutorFeeByMode: new Map([[0, 20n], [1, 30n]]),
    maximumScheduleValiditySeconds: 300
  }
}

test("finalizer POC prepares eligible payloads and skips unsafe jobs without broadcasting", async () => {
  const output = await runFinalizerDryRunPoc({
    phase3,
    jobs: createMockFinalizerPocJobs(),
    authorization: createMockFinalizerPocAuthorization()
  })

  assert.equal(output.dryRun, true)
  assert.deepEqual(output.prepared.map((item) => item.jobId), ["queued-poc-job"])
  assert.equal(output.prepared[0].broadcast, false)
  assert.equal(typeof output.prepared[0].idempotencyKey, "string")
  assert.equal(
    output.skipped.some(
      (item) => item.status === "queued" && item.observationEligibility === "pending_confirmations"
    ),
    true
  )
  assert.deepEqual(
    output.skipped.map((item) => item.status).sort(),
    ["confirmed", "ignored", "manual_review", "queued", "refund_available"].sort()
  )
  assert.equal(JSON.stringify(output).includes("private"), false)
})

test("finalizer POC source contains no transaction broadcaster or private-key logger", async () => {
  const source = await readFile(new URL("./phase3-finalizer-poc.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /\bsendTransaction\b|\bwriteContract\b|\bbroadcastTransaction\b/u)
  assert.doesNotMatch(source, /PRIVATE_KEY|FINALIZER_PRIVATE_KEY/u)
})

test("finalizer POC refuses jobs for an unregistered or emergency-blocked operator", async () => {
  const output = await runFinalizerDryRunPoc({
    phase3,
    jobs: createMockFinalizerPocJobs(),
    authorization: createMockFinalizerPocAuthorization(),
    eligibilityReader: {
      async isEligibleOperatorFor() {
        return false
      }
    }
  })

  assert.deepEqual(output.prepared, [])
  assert.equal(output.operatorEligible, false)
})

test("payout POC remains dry-run only and never implies operator escrow funding", async () => {
  const output = await runPayoutDryRunPoc({ phase3 })

  assert.equal(output.dryRun, true)
  assert.equal(output.broadcast, false)
  assert.equal(output.operatorFundsEscrow, false)
  assert.equal(output.status, "payout_submitted")
  assert.equal(output.amountOut, "900")
})

test("payout POC source contains no transaction broadcaster, signer, or private-key logger", async () => {
  const source = await readFile(new URL("./phase3-payout-poc.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /\bsendTransaction\b|\bwriteContract\b|\bbroadcastTransaction\b/u)
  assert.doesNotMatch(source, /PRIVATE_KEY|FINALIZER_PRIVATE_KEY|\bsignMessage\b|\bsignTypedData\b/u)
})

test("PoolV3 relayer accepts only exact version-2 57-signal private payloads", async () => {
  const payload = await poolV3Payload()
  const validated = poolV3.validatePoolV3ProofPayload(payload, runtimeConfig())
  assert.equal(validated.version, 2)
  assert.equal(validated.pubSignals.length, 57)
  assert.equal(poolV3.poolV3ActiveNullifiers(validated).length, 1)
  assert.match(poolV3.preparePoolV3Transaction(validated).data, /^0x[0-9a-f]+$/u)

  assert.throws(
    () => poolV3.validatePoolV3ProofPayload({ ...payload, version: 3 }, runtimeConfig()),
    /version/u
  )
  assert.throws(
    () => poolV3.validatePoolV3ProofPayload({ ...payload, executionMode: 2 }, runtimeConfig()),
    /mode/u
  )
  assert.throws(
    () => poolV3.validatePoolV3ProofPayload(
      { ...payload, pubSignals: payload.pubSignals.slice(0, 56) },
      runtimeConfig()
    ),
    /57/u
  )
  const oversizedSignal = await poolV3Payload()
  oversizedSignal.pubSignals[0] = "9".repeat(100_000)
  assert.throws(
    () => poolV3.validatePoolV3ProofPayload(oversizedSignal, runtimeConfig()),
    /unsigned public signals/u
  )
  const wrongSettlementDomain = await poolV3Payload()
  wrongSettlementDomain.pubSignals[19] = "40444"
  wrongSettlementDomain.settlementDomains = Array(10).fill(40444)
  assert.throws(
    () => poolV3.validatePoolV3ProofPayload(wrongSettlementDomain, runtimeConfig()),
    /domain/u
  )
})

test("PoolV3 relayer accepts consolidation and rejects cross-version, replay, and output mismatches", async () => {
  const consolidation = await poolV3Payload({ mode: 1 })
  consolidation.pubSignals[12] = "2"
  consolidation.pubSignals[15] = "2"
  consolidation.pubSignals[24] = "0"
  consolidation.pubSignals[34] = "0"
  consolidation.recipients[0] = "0x0000000000000000000000000000000000000000"
  consolidation.amounts[0] = "0"
  consolidation.newChangeCommitment = `0x${"1".padStart(64, "0")}`
  consolidation.pubSignals[54] = "1"
  consolidation.newChangeEnvelope = "0x01"
  consolidation.pubSignals[55] = String(BigInt(keccak256("0x01")) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n)
  assert.equal(poolV3.validatePoolV3ProofPayload(consolidation, runtimeConfig()).executionMode, 1)

  const duplicate = await poolV3Payload()
  duplicate.pubSignals[12] = duplicate.pubSignals[11]
  duplicate.pubSignals[15] = "2"
  assert.throws(() => poolV3.validatePoolV3ProofPayload(duplicate, runtimeConfig()), /duplicate/u)
  const mismatch = await poolV3Payload()
  mismatch.amounts[0] = "99"
  assert.throws(() => poolV3.validatePoolV3ProofPayload(mismatch, runtimeConfig()), /output/u)
  const wrongExecutor = await poolV3Payload()
  assert.throws(
    () => poolV3.validatePoolV3ProofPayload(wrongExecutor, runtimeConfig(EXECUTOR_V2)),
    /executor/u
  )
})

test("RelayExecutionFeeScheduleV2 binds the exact PoolV3 proof tuple and gas ceiling", async () => {
  const signed = await signedFeeSchedule()
  const expected = {
    chainId: 4217,
    pool: POOL_V3,
    executionMode: 0,
    inputCount: 1,
    outputCount: 1,
    executorFee: 5n,
    relayer: RELAYER,
    maximumExecutorFee: 20n,
    maximumValiditySeconds: 300,
    currentGasPrice: 100n,
    nowSeconds: 1000
  }
  const validated = await feeScheduleV2.validateRelayExecutionFeeScheduleV2(signed, expected)
  assert.equal(validated.scheduleHash, feeScheduleV2.hashRelayExecutionFeeScheduleV2(signed.schedule))
  assert.equal(validated.schedule.relayer, RELAYER)
  assert.equal(
    (await feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      signed,
      { ...expected, nowSeconds: 1300 }
    )).schedule.expiry,
    1300
  )

  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      { ...signed, schedule: { ...signed.schedule, executorFee: "6" } },
      expected
    ),
    /hash/u
  )
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(signed, {
      ...expected,
      currentGasPrice: 101n
    }),
    /gas price/u
  )
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(signed, {
      ...expected,
      inputCount: 2
    }),
    /proof tuple/u
  )
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      await signedFeeSchedule({ validAfter: 1001, expiry: 1301 }),
      expected
    ),
    /not yet valid/u
  )
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      await signedFeeSchedule({ validAfter: 699, expiry: 999 }),
      expected
    ),
    /expired/u
  )
  const otherRelayer = privateKeyToAccount(`0x${"3".repeat(64)}`)
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      await signedFeeSchedule({ account: otherRelayer }),
      expected
    ),
    /proof tuple/u
  )
  await assert.rejects(
    feeScheduleV2.validateRelayExecutionFeeScheduleV2(
      { ...signed, signature: `0x${"1".repeat(130)}` },
      expected
    ),
    /signature|signer|recovered|invalid/iu
  )
})

test("Relay fee schedules publish only bounded approved templates through heartbeat", async () => {
  const templates = feeScheduleV2.readRelayExecutionFeeScheduleTemplatesV2(
    {
      PHASE3_POOL_V3_FEE_SCHEDULES_JSON: JSON.stringify([{
        pool: POOL_V3,
        executionMode: 0,
        inputCount: 1,
        outputCount: 1,
        executorFee: "5",
        maximumGasPrice: "100"
      }])
    },
    {
      pools: runtimeConfig().pools,
      maximumExecutorFeeByMode: runtimeConfig().maximumExecutorFeeByMode
    }
  )
  let nonce = 0
  const signed = await feeScheduleV2.buildSignedRelayExecutionFeeSchedulesV2({
    account: RELAYER_ACCOUNT,
    chainId: 4217,
    templates,
    validAfter: 1000,
    ttlSeconds: 300,
    nonceFactory: () => `0x${(++nonce).toString(16).padStart(64, "0")}`
  })
  assert.equal(signed.length, 1)
  assert.equal(signed[0].schedule.expiry, 1300)

  const oldBaseUrl = process.env.RELAYER_REGISTRY_API_BASE_URL
  const oldFetch = globalThis.fetch
  const heartbeatBodies = []
  process.env.RELAYER_REGISTRY_API_BASE_URL = "https://registry.example"
  globalThis.fetch = async (_url, init) => {
    heartbeatBodies.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 200 })
  }
  try {
    assert.deepEqual(await registryHeartbeat.postRelayerHeartbeat(RELAYER_ACCOUNT, signed), {
      sent: true
    })
    assert.deepEqual(await registryHeartbeat.postRelayerHeartbeat(RELAYER_ACCOUNT), {
      sent: true
    })
  } finally {
    globalThis.fetch = oldFetch
    if (oldBaseUrl === undefined) delete process.env.RELAYER_REGISTRY_API_BASE_URL
    else process.env.RELAYER_REGISTRY_API_BASE_URL = oldBaseUrl
  }
  assert.equal(heartbeatBodies[0].feeSchedules.length, 1)
  assert.equal(heartbeatBodies[0].feeSchedules[0].scheduleHash, signed[0].scheduleHash)
  assert.equal(Object.hasOwn(heartbeatBodies[1], "feeSchedules"), false)

  assert.throws(
    () => feeScheduleV2.readRelayExecutionFeeScheduleTemplatesV2(
      {
        PHASE3_POOL_V3_FEE_SCHEDULES_JSON: JSON.stringify([{
          pool: POOL_V3,
          executionMode: 1,
          inputCount: 2,
          outputCount: 1,
          executorFee: "5",
          maximumGasPrice: "100"
        }])
      },
      {
        pools: runtimeConfig().pools,
        maximumExecutorFeeByMode: runtimeConfig().maximumExecutorFeeByMode
      }
    ),
    /output count/u
  )
})

test("Relay fee schedule capacity covers both pools, ten outputs, and consolidation", () => {
  const templates = [POOL_V3, POOL_V3_B].flatMap((pool) => [
    ...Array.from({ length: 4 }, (_, inputIndex) =>
      Array.from({ length: 10 }, (_, outputIndex) => ({
        pool,
        executionMode: 0,
        inputCount: inputIndex + 1,
        outputCount: outputIndex + 1,
        executorFee: "5",
        maximumGasPrice: "100"
      }))
    ).flat(),
    {
      pool,
      executionMode: 1,
      inputCount: 4,
      outputCount: 0,
      executorFee: "5",
      maximumGasPrice: "100"
    }
  ])
  const config = {
    pools: new Map([
      [POOL_V3.toLowerCase(), ARTIFACT],
      [POOL_V3_B.toLowerCase(), ARTIFACT]
    ]),
    maximumExecutorFeeByMode: new Map([[0, 20n], [1, 30n]])
  }

  assert.equal(templates.length, 82)
  assert.equal(feeScheduleV2.readRelayExecutionFeeScheduleTemplatesV2({
    PHASE3_POOL_V3_FEE_SCHEDULES_JSON: JSON.stringify(templates)
  }, config).length, 82)
  assert.throws(
    () => feeScheduleV2.readRelayExecutionFeeScheduleTemplatesV2({
      PHASE3_POOL_V3_FEE_SCHEDULES_JSON: JSON.stringify([...templates, templates[0]])
    }, config),
    /between 1 and 82 entries/u
  )
})

test("PoolV3 broadcast revalidates the schedule and pins the accepted gas price", async () => {
  const source = await readFile(
    new URL("../src/bot.ts", import.meta.url),
    "utf8"
  )
  assert.match(source, /await validateFeeSchedule\(await publicClient\.getGasPrice\(\)\)/u)
  assert.match(source, /const broadcastGasPrice = await publicClient\.getGasPrice\(\)/u)
  assert.match(source, /await validateFeeSchedule\(broadcastGasPrice\)/u)
  assert.match(source, /\{ gasPrice: broadcastGasPrice \}/u)
  assert.doesNotMatch(source, /feeSchedule.*console|console.*feeSchedule/iu)
})

test("AdapterV6 dispatch binds the exact ExecutorV2 payload and rejects unknown selectors", async () => {
  const proof = await poolV3Payload({ executor: EXECUTOR_V2, fee: 5n })
  const poolCall = encodeFunctionData({
    abi: tempoShieldedPoolV3Abi,
    functionName: "batchWithdrawV3",
    args: [
      proof.pA.map(BigInt),
      proof.pB.map((row) => row.map(BigInt)),
      proof.pC.map(BigInt),
      proof.pubSignals.map(BigInt),
      proof.recipients,
      proof.amounts.map(BigInt),
      proof.settlementDomains,
      proof.newChangeCommitment,
      proof.newChangeEnvelope
    ]
  })
  const intentHash = `0x${"b".repeat(64)}`
  const payloadHash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32[]" }, { type: "uint256[]" }],
    [PAYLOAD_DOMAIN, keccak256(poolCall), [intentHash], [5n]]
  ))
  const payload = {
    version: 6,
    adapter: ADAPTER_V6,
    withdrawalExecutor: EXECUTOR_V2,
    lease: {
      intentHash,
      adapter: ADAPTER_V6,
      pool: POOL_V3,
      payloadHash,
      operator: RELAYER,
      token: TOKEN,
      maximumExecutorFee: "5",
      nonce: `0x${"c".repeat(64)}`,
      expiry: "2000"
    },
    leaseSignature: `0x${"d".repeat(130)}`,
    poolCall,
    intentHashes: [intentHash],
    sourceFeeAllocations: ["5"]
  }
  const config = {
    adapter: ADAPTER_V6,
    withdrawalExecutor: EXECUTOR_V2,
    relayer: RELAYER,
    pools: new Set([POOL_V3.toLowerCase()]),
    nowSeconds: 1000
  }
  const validated = poolV3.validatePayoutV6ExecutionPayload(payload, config)
  assert.equal(validated.version, 6)
  assert.match(poolV3.preparePayoutV6WithdrawalTransaction(validated).data, /^0x[0-9a-f]+$/u)
  assert.throws(
    () => poolV3.validatePayoutV6ExecutionPayload(
      { ...payload, poolCall: `0xdeadbeef${poolCall.slice(10)}` },
      config
    ),
    /selector|function/u
  )
  assert.throws(
    () => poolV3.validatePayoutV6ExecutionPayload({ ...payload, version: 5 }, config),
    /version/u
  )
})

test("PoolV3 runtime errors redact witness-like material", () => {
  const secret = `0x${"ab".repeat(64)}`
  const message = poolV3.redactRelayerRuntimeError(new Error(`bad witness ${secret}`))
  assert.doesNotMatch(message, /abababab/u)
  assert.match(message, /\[redacted\]/u)
})

test("V6 downstream monitoring reaches only proof-backed terminal states", async () => {
  for (const outcome of ["completion", "refund"]) {
    let status = 3
    const checkpoints = new Map()
    const submissions = new Map()
    const transactionHash = `0x${(outcome === "completion" ? "8" : "9").repeat(64)}`
    const result = await phase3.runPayoutV6DownstreamExecution({
      intentHash: `0x${"b".repeat(64)}`,
      submissionTransactionHash: `0x${"7".repeat(64)}`,
      readAdapterStatus: async () => status,
      readTransactionOutcome: async () => "success",
      getLocalCheckpoint: async ({ step }) => checkpoints.get(step) ?? null,
      getLocalSubmissions: async ({ step }) => submissions.get(step) ?? [],
      recordLocalSubmission: async ({ step, transactionHash: hash }) => {
        submissions.set(step, [hash])
      },
      recordLocalCheckpoint: async ({ step, transactionHash: hash }) => {
        checkpoints.set(step, { transactionHash: hash })
      },
      requestCompletionProof: async () => ({
        ready: outcome === "completion",
        proof: {},
        signatures: outcome === "completion"
          ? [`0x${"1".repeat(130)}`, `0x${"2".repeat(130)}`]
          : []
      }),
      completePayout: async ({ onSubmitted }) => {
        await onSubmitted(transactionHash)
        status = 4
        return { transactionHash }
      },
      requestRefundProof: async () => {},
      readRefundQuorum: async () => ({
        ready: outcome === "refund",
        proof: {},
        signatures: outcome === "refund"
          ? [`0x${"3".repeat(130)}`, `0x${"4".repeat(130)}`]
          : []
      }),
      proveRelayRefund: async ({ onSubmitted }) => {
        await onSubmitted(transactionHash)
        status = 5
        return { transactionHash }
      }
    })
    assert.equal(result.status, outcome === "completion" ? 4 : 5)
    assert.equal(
      checkpoints.has(outcome === "completion" ? "proveCompletion" : "proveRelayRefund"),
      true
    )
  }
})

test("V6 downstream completes immediately from verified attestation results", async () => {
  let status = 3
  const terminalHash = `0x${"8".repeat(64)}`
  const result = await phase3.runPayoutV6DownstreamExecution({
    intentHash: `0x${"b".repeat(64)}`, submissionTransactionHash: `0x${"7".repeat(64)}`,
    readAdapterStatus: async () => status,
    readTransactionOutcome: async () => "success",
    getLocalCheckpoint: async () => null, getLocalSubmissions: async () => [],
    recordLocalSubmission: async () => {}, recordLocalCheckpoint: async () => {},
    requestCompletionProof: async () => ({ ready: true, proof: {}, signatures: [`0x${"1".repeat(130)}`, `0x${"2".repeat(130)}`] }),
    completePayout: async ({ onSubmitted }) => {
      await onSubmitted(terminalHash)
      status = 4
      return { transactionHash: terminalHash }
    },
    requestRefundProof: async () => { throw new Error("must not request a refund after completion") }
  })
  assert.equal(result.state, "completed")
  assert.equal(result.status, 4)
})

test("V6 downstream keeps failed or incomplete proof checks pending with safe diagnostics", async () => {
  for (const [failure, expected] of [
    [new DOMException("secret-url-and-token", "TimeoutError"), "attestation:request_timeout"],
    [Object.assign(new Error("secret-url-and-token"), { code: "attester_http_422" }), "attestation:attester_http_422"],
    [Object.assign(new Error("secret-url-and-token"), { code: "attester_http_422\nsecret-url-and-token" }), "attestation:verification_failed"],
    [new Error("secret-url-and-token"), "attestation:verification_failed"],
    [null, "attestation:quorum_pending"]
  ]) {
    let broadcasts = 0
    const result = await phase3.runPayoutV6DownstreamExecution({
      intentHash: `0x${"b".repeat(64)}`, submissionTransactionHash: `0x${"7".repeat(64)}`,
      readAdapterStatus: async () => 3,
      requestCompletionProof: async () => {
        if (failure) throw failure
        return { ready: false, proof: {}, signatures: [] }
      },
      completePayout: async () => { broadcasts++; throw new Error("must not broadcast") },
      requestRefundProof: async () => {},
      readRefundQuorum: async () => ({ ready: false, proof: {}, signatures: [] })
    })
    assert.equal(result.state, "monitoring")
    assert.equal(broadcasts, 0)
    assert.equal(result.completionRetry, expected)
    assert.doesNotMatch(JSON.stringify(result), /secret-url-and-token/)
  }
})

test("V6 completion never rebroadcasts a pending terminal transaction", async () => {
  let broadcasts = 0
  const result = await phase3.runPayoutV6DownstreamExecution({
    intentHash: `0x${"b".repeat(64)}`, submissionTransactionHash: `0x${"7".repeat(64)}`,
    readAdapterStatus: async () => 3,
    requestCompletionProof: async () => ({ ready: true, proof: {}, signatures: [`0x${"1".repeat(130)}`, `0x${"2".repeat(130)}`] }),
    getLocalCheckpoint: async () => null,
    getLocalSubmissions: async () => [`0x${"8".repeat(64)}`],
    readTransactionOutcome: async () => "pending",
    completePayout: async () => { broadcasts++; throw new Error("must not broadcast") },
    requestRefundProof: async () => {}, readRefundQuorum: async () => ({ ready: false, proof: {}, signatures: [] })
  })
  assert.equal(result.state, "monitoring")
  assert.equal(broadcasts, 0)
})

test("V6 terminal adapter status stops proof requests and transaction submission", async () => {
  for (const [status, state] of [[4, "completed"], [5, "refund_available"], [6, "refunded"]]) {
    const result = await phase3.runPayoutV6DownstreamExecution({
      intentHash: `0x${"b".repeat(64)}`, submissionTransactionHash: `0x${"7".repeat(64)}`,
      readAdapterStatus: async () => status,
      requestCompletionProof: async () => { throw new Error("must not request proof") },
      completePayout: async () => { throw new Error("must not broadcast") }
    })
    assert.equal(result.state, state)
  }
})
