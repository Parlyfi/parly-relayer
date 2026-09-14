import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const store = await import("../dist/apps/relayer/src/phase3/execution-payload-store.js")

const KEY = Buffer.alloc(32, 7)
const LEASE_BYTES = Buffer.alloc(32, 9)

function samplePayload() {
  return {
    masterAddress: "0x1111111111111111111111111111111111111111",
    relayerOperatorAddress: "0x2222222222222222222222222222222222222222",
    attemptAuthorization: { attemptId: `0x${"a".repeat(64)}`, expectedAmount: 1000n },
    attemptSignature: "0xaaaa",
    observation: { observationId: `0x${"b".repeat(64)}`, amount: 1000n },
    observationAttestation: { attemptId: `0x${"a".repeat(64)}` },
    observationSignature: "0xbbbb",
    settlementAuthorization: { attemptId: `0x${"a".repeat(64)}`, observedAmount: 1000n },
    envelope: "0xdeadbeef",
    settlementSignature: "0xcccc"
  }
}

function fakePool(respond) {
  const calls = []
  const client = {
    async query(text, values = []) {
      calls.push({ text, values })
      return respond({ text, values, calls })
    },
    release() {
      calls.push({ text: "RELEASE", values: [] })
    }
  }
  return {
    calls,
    async connect() {
      return client
    },
    async query(text, values = []) {
      calls.push({ text, values })
      return respond({ text, values, calls })
    }
  }
}

test("execution payload encryption preserves bigint fields without plaintext persistence", () => {
  const payload = samplePayload()
  const sealed = store.encryptRelayerOwnedExecutionPayload(payload, KEY, Buffer.alloc(12, 3))
  const persisted = Buffer.concat([sealed.iv, sealed.authTag, sealed.ciphertext]).toString("utf8")

  assert.doesNotMatch(persisted, /deadbeef|attemptSignature|1000/u)
  assert.deepEqual(store.decryptRelayerOwnedExecutionPayload(sealed, KEY), payload)
  assert.match(sealed.payloadHash, /^[a-f0-9]{64}$/u)
})

test("execution payload datasource acquires one encrypted job with an opaque lease", async () => {
  const payload = samplePayload()
  const sealed = store.encryptRelayerOwnedExecutionPayload(payload, KEY, Buffer.alloc(12, 3))
  const pool = fakePool(({ text }) => {
    if (/UPDATE phase3_private\.relayer_execution_payloads/u.test(text)) {
      return {
        rowCount: 1,
        rows: [
          {
            job_id: "job-1",
            attempt_id: `0x${"a".repeat(64)}`,
            payload_ciphertext: sealed.ciphertext,
            payload_iv: sealed.iv,
            payload_auth_tag: sealed.authTag,
            payload_hash: sealed.payloadHash
          }
        ]
      }
    }
    if (/FROM phase3_private\.relayer_execution_checkpoints/u.test(text)) return { rowCount: 0, rows: [] }
    return { rowCount: 0, rows: [] }
  })
  const datasource = store.createRelayerOwnedExecutionPayloadDataSource({
    pool,
    encryptionKey: KEY,
    randomBytes: () => LEASE_BYTES,
    now: () => new Date("2026-06-20T20:00:00.000Z")
  })

  const job = await datasource.acquireRelayerOwnedOneTimeExecutionJob({
    workerId: "relayer-0xa4ce",
    leaseMs: 30_000
  })

  assert.equal(job.jobId, "job-1")
  assert.equal(job.leaseToken, LEASE_BYTES.toString("base64url"))
  assert.deepEqual(job.attemptAuthorization, payload.attemptAuthorization)
  const leaseCall = pool.calls.find((call) => /lease_token_hash = \$3/u.test(call.text))
  assert.ok(leaseCall)
  assert.equal(leaseCall.values.includes(job.leaseToken), false)
  assert.ok(leaseCall.values.some((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)))
  assert.match(leaseCall.text, /FOR UPDATE SKIP LOCKED/u)
})

test("execution payload datasource quarantines expired leases after retry exhaustion", async () => {
  const pool = fakePool(({ text }) => {
    if (/failure_code = 'lease_exhausted'/u.test(text)) {
      return { rowCount: 1, rows: [{ job_id: "job-exhausted" }] }
    }
    if (/UPDATE phase3_private\.relayer_execution_payloads AS job/u.test(text)) {
      return { rowCount: 0, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })
  const datasource = store.createRelayerOwnedExecutionPayloadDataSource({
    pool,
    encryptionKey: KEY,
    randomBytes: () => LEASE_BYTES,
    now: () => new Date("2026-06-20T20:00:00.000Z")
  })

  const job = await datasource.acquireRelayerOwnedOneTimeExecutionJob({
    workerId: "relayer-0xa4ce",
    leaseMs: 30_000
  })

  assert.equal(job, null)
  assert.ok(pool.calls.some((call) => /status = 'manual_review'/u.test(call.text)))
  assert.ok(pool.calls.some((call) => /'manual_review'.*'lease_exhausted'/us.test(call.text)))
})

test("execution payload datasource quarantines corrupt encrypted work without poisoning the queue", async () => {
  const payload = samplePayload()
  const sealed = store.encryptRelayerOwnedExecutionPayload(payload, KEY, Buffer.alloc(12, 3))
  const pool = fakePool(({ text }) => {
    if (/UPDATE phase3_private\.relayer_execution_payloads AS job/u.test(text) && /lease_token_hash = \$3/u.test(text)) {
      return {
        rowCount: 1,
        rows: [{
          job_id: "job-corrupt",
          attempt_id: `0x${"a".repeat(64)}`,
          payload_ciphertext: sealed.ciphertext,
          payload_iv: sealed.iv,
          payload_auth_tag: Buffer.alloc(16, 0),
          payload_hash: sealed.payloadHash
        }]
      }
    }
    if (/FROM phase3_private\.relayer_execution_checkpoints/u.test(text)) return { rowCount: 0, rows: [] }
    if (/failure_code = 'invalid_execution_payload'/u.test(text)) return { rowCount: 1, rows: [] }
    return { rowCount: 0, rows: [] }
  })
  const datasource = store.createRelayerOwnedExecutionPayloadDataSource({
    pool,
    encryptionKey: KEY,
    randomBytes: () => LEASE_BYTES
  })

  await assert.rejects(
    () => datasource.acquireRelayerOwnedOneTimeExecutionJob({ workerId: "worker-a", leaseMs: 30_000 })
  )
  assert.ok(pool.calls.some((call) => /failure_code = 'invalid_execution_payload'/u.test(call.text)))
  assert.ok(pool.calls.some((call) => /'manual_review'.*'invalid_execution_payload'/us.test(call.text)))
})

test("execution payload writer persists ciphertext and is idempotent by attempt", async () => {
  const pool = fakePool(({ text }) => {
    if (/SELECT payload_hash/u.test(text)) return { rowCount: 0, rows: [] }
    if (/INSERT INTO phase3_private\.relayer_execution_payloads/u.test(text)) return { rowCount: 1, rows: [] }
    return { rowCount: 0, rows: [] }
  })
  const writer = store.createRelayerOwnedExecutionPayloadWriter({
    pool,
    encryptionKey: KEY,
    randomBytes: (size) => Buffer.alloc(size, 4)
  })
  await writer.enqueueRelayerOwnedOneTimeExecutionPayload({
    jobId: "job-1",
    attemptId: `0x${"a".repeat(64)}`,
    payload: samplePayload(),
    maxAttempts: 3
  })

  const insert = pool.calls.find((call) => /INSERT INTO phase3_private\.relayer_execution_payloads/u.test(call.text))
  assert.ok(insert)
  assert.equal(insert.values.some((value) => JSON.stringify(value).includes("deadbeef")), false)
  assert.ok(insert.values.some((value) => Buffer.isBuffer(value)))
})

test("execution payload writer confirms only the checkpointed finalization transaction", async () => {
  const finalizationHash = `0x${"f".repeat(64)}`
  const pool = fakePool(({ text }) => {
    if (/step_index = 2/u.test(text)) {
      return { rowCount: 1, rows: [{ transaction_hash: finalizationHash }] }
    }
    if (/SET status = 'confirmed'/u.test(text)) return { rowCount: 1, rows: [] }
    return { rowCount: 1, rows: [] }
  })
  const writer = store.createRelayerOwnedExecutionPayloadWriter({ pool, encryptionKey: KEY })

  await writer.confirmRelayerOwnedOneTimeExecution({
    jobId: "job-1",
    finalizationTransactionHash: finalizationHash
  })

  assert.ok(pool.calls.some((call) => /SET status = 'confirmed'/u.test(call.text)))
  assert.ok(pool.calls.some((call) => /event_type.*confirmed/us.test(call.text)))
})

test("execution payload datasource rejects stale lease mutations", async () => {
  const pool = fakePool(({ text }) => {
    if (/UPDATE phase3_private\.relayer_execution_payloads/u.test(text)) return { rowCount: 0, rows: [] }
    return { rowCount: 0, rows: [] }
  })
  const datasource = store.createRelayerOwnedExecutionPayloadDataSource({ pool, encryptionKey: KEY })

  await assert.rejects(
    () =>
      datasource.recordRelayerOwnedOneTimeExecutionFailed({
        jobId: "job-1",
        leaseToken: "stale-token",
        failedFunctionName: "registerAttemptWithAuthorization",
        failureCode: "broadcast_failed"
      }),
    /lease is stale or no longer active/u
  )
})

test("execution payload datasource rejects out-of-order checkpoints", async () => {
  const pool = fakePool(({ text }) => {
    if (/SELECT job_id/u.test(text)) return { rowCount: 1, rows: [{ job_id: "job-1" }] }
    if (/checkpoint_count/u.test(text)) return { rowCount: 1, rows: [{ checkpoint_count: "0" }] }
    return { rowCount: 1, rows: [] }
  })
  const datasource = store.createRelayerOwnedExecutionPayloadDataSource({ pool, encryptionKey: KEY })

  await assert.rejects(
    () =>
      datasource.recordRelayerOwnedOneTimeExecutionTransactionConfirmed({
        jobId: "job-1",
        leaseToken: "active-token",
        functionName: "finalizeVirtualDeposit",
        transactionHash: `0x${"f".repeat(64)}`
      }),
    /not the next ordered step/u
  )
})

test("execution datasource configuration requires a dedicated private database URL", () => {
  assert.throws(
    () => store.readRelayerOwnedExecutionPayloadStoreConfig({ DATABASE_URL: "postgres://broad-role" }),
    /PHASE3_EXECUTION_DATABASE_URL is required/u
  )
  assert.deepEqual(
    store.readRelayerOwnedExecutionPayloadStoreConfig({
      PHASE3_EXECUTION_DATABASE_URL: "postgres://execution-role",
      PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64: KEY.toString("base64")
    }),
    {
      connectionString: "postgres://execution-role",
      encryptionKey: KEY
    }
  )
})

test("execution payload migration keeps payloads private and checkpoints ordered", async () => {
  const migration = await readFile(new URL("../../web/migrations/phase3-datasource.sql", import.meta.url), "utf8")

  assert.match(migration, /CREATE TABLE IF NOT EXISTS phase3_private\.relayer_execution_payloads/u)
  assert.match(migration, /payload_ciphertext BYTEA NOT NULL/u)
  assert.match(migration, /lease_token_hash CHAR\(64\)/u)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS phase3_private\.relayer_execution_checkpoints/u)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS phase3_private\.relayer_execution_events/u)
  assert.match(migration, /'lease_exhausted'/u)
  assert.match(migration, /CREATE OR REPLACE VIEW phase3_private\.relayer_execution_status_current/u)
  assert.match(migration, /UNIQUE \(job_id, step_index\)/u)
  const statusView = migration.match(
    /CREATE OR REPLACE VIEW phase3_private\.relayer_execution_status_current AS(?<body>.*?);/us
  )?.groups?.body ?? ""
  assert.doesNotMatch(statusView, /payload_ciphertext|payload_auth_tag|payload_hash|lease_token_hash/u)
  assert.match(statusView, /checkpoint_count/u)
  assert.match(migration, /REVOKE ALL ON phase3_private\.relayer_execution_payloads FROM PUBLIC/u)
  assert.match(migration, /REVOKE ALL ON phase3_private\.relayer_execution_status_current FROM PUBLIC/u)
})

test("dry-run releases its lease without consuming broadcast retry budget", async () => {
  const source = await readFile(new URL("../src/phase3/execution-payload-store.ts", import.meta.url), "utf8")
  assert.match(source, /attempt_number = GREATEST\(attempt_number - 1, 0\)/u)
  assert.match(source, /INSERT INTO phase3_private\.relayer_execution_events/u)
})
