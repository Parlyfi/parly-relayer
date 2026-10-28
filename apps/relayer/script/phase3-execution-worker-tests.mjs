import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const worker = await import("../dist/apps/relayer/src/phase3/execution-worker.js")
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const botSource = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8")
const source = await readFile(new URL("../src/phase3/execution-worker.ts", import.meta.url), "utf8")

const KEY = Buffer.alloc(32, 9).toString("base64")
const RELAYER = "0x5555555555555555555555555555555555555555"

function env(overrides = {}) {
  return {
    PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED: "true",
    PHASE3_EXECUTION_DATABASE_URL: "postgresql://example.invalid/private-execution",
    PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64: KEY,
    RELAYER_ADDRESS: RELAYER,
    PHASE3_FINALIZER_ENABLED: "false",
    PHASE3_LIVE_TRANSACTIONS_ENABLED: "false",
    PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "false",
    ...overrides
  }
}

test("relayer-owned execution worker is disabled by default", () => {
  assert.deepEqual(worker.readRelayerOwnedExecutionWorkerConfig({}), {
    enabled: false,
    reason: "phase3_relayer_owned_execution_worker_disabled"
  })
})

test('selected V4 profile cannot start or consume work with an unassembled funded host', async () => {
  const { profile, wire } = await import('../../indexer/test/phase3/receiving-v4.fixture.mjs')
  const selected = env({ PHASE3_RECEIVING_V4_PROFILE_JSON: JSON.stringify(wire(profile())) })
  const config = worker.readRelayerOwnedExecutionWorkerConfig(selected)
  await assert.rejects(() => worker.runRelayerOwnedExecutionWorkerOnce({ config, env: selected,
    dataSource: { acquireRelayerOwnedOneTimeExecutionJob: async () => assert.fail('missing host must fail before consuming work') }
  }), /V4 confirmed-funding host/)
  assert.throws(() => worker.startRelayerOwnedExecutionWorkerLoop({ config, env: selected }), /V4 confirmed-funding host/)
  for (const missing of ['refreshFinalization', 'executeTransaction', 'sourcePool', 'fundedHost']) {
    const bindings = { profile: profile(), refreshFinalization() {}, executeTransaction() {}, sourcePool: { connect() {} }, fundedHost: { assertFunded() {}, prepare() {}, assertPrepared() {} } }
    delete bindings[missing]
    assert.throws(() => worker.startRelayerOwnedExecutionWorkerLoop({ config, env: selected, receivingV4: bindings }), /V4 confirmed-funding host/)
  }
})

test('a failed funded preparation does not stop draining already-executable history', async () => {
  const { profile, wire } = await import('../../indexer/test/phase3/receiving-v4.fixture.mjs'), { createHash } = await import('node:crypto')
  const p = profile(), selected = env({ PHASE3_RECEIVING_V4_PROFILE_JSON: JSON.stringify(wire(p)), PHASE3_FINALIZER_ENABLED: 'true', PHASE3_LIVE_TRANSACTIONS_ENABLED: 'true', PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: 'true' })
  const profileDigest = createHash('sha256').update((await import('@parly/crypto-utils/receiving-profile-v4')).receivingProfileJsonV4(p)).digest('hex')
  const id = '0x' + '11'.repeat(32), logs = []; let drains = 0
  const result = await worker.runRelayerOwnedExecutionWorkerOnce({ config: worker.readRelayerOwnedExecutionWorkerConfig(selected), env: selected,
    logger: { error: text => logs.push(text) },
    receivingV4: { profile: p, sourcePool: { connect: async () => ({ release() {}, query: async sql => ({ rows: sql.includes('RETURNING w.attempt_id,w.observation_id,w.block_hash') ? [{ attempt_id: id, observation_id: id, block_hash: id }] : sql.includes('RETURNING w.attempt_id') ? [{ attempt_id: id }] : [] }) }) },
      fundedHost: { profileDigest, assertFunded: async () => { throw Error('credential-must-not-leak') }, prepare: async () => assert.fail('invalid funding'), assertPrepared: async () => assert.fail('invalid funding') },
      refreshFinalization: async () => assert.fail('idle'), executeTransaction: async () => assert.fail('idle') },
    dataSource: { acquireRelayerOwnedOneTimeExecutionJob: async () => { drains++; return null } }
  })
  assert.equal(result.status, 'idle'); assert.equal(drains, 1); assert.equal(logs.length, 1)
  assert.equal(logs[0].includes('credential'), false)
})

test("relayer-owned execution worker requires private queue env only when enabled", () => {
  assert.throws(
    () =>
      worker.readRelayerOwnedExecutionWorkerConfig({
        PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED: "true"
      }),
    /PHASE3_EXECUTION_DATABASE_URL/u
  )
  const config = worker.readRelayerOwnedExecutionWorkerConfig(env())
  assert.equal(config.enabled, true)
  assert.equal(config.workerId, RELAYER)
  assert.equal(config.broadcast, false)
  assert.equal(config.executionDatabaseConfigured, true)
  assert.equal(config.executionPayloadEncryptionKeyConfigured, true)
})

test("relayer-owned execution worker runs dry-run when live flags are closed", async () => {
  const config = worker.readRelayerOwnedExecutionWorkerConfig(env())
  const calls = []
  const result = await worker.runRelayerOwnedExecutionWorkerOnce({
    config,
    env: env(),
    dataSource: {
      async acquireRelayerOwnedOneTimeExecutionJob(args) {
        calls.push(args)
        return null
      }
    }
  })

  assert.deepEqual(calls, [{ workerId: RELAYER, leaseMs: 30000 }])
  assert.equal(result.status, "idle")
  assert.equal(result.broadcast, false)
})

test("relayer-owned execution worker only broadcasts when all explicit live gates are true", () => {
  const config = worker.readRelayerOwnedExecutionWorkerConfig(
    env({
      PHASE3_FINALIZER_ENABLED: "true",
      PHASE3_LIVE_TRANSACTIONS_ENABLED: "true",
      PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED: "true"
    })
  )
  assert.equal(config.enabled, true)
  assert.equal(config.broadcast, true)
})

test("relayer-owned execution wiring is production-safe", () => {
  assert.match(botSource, /startRelayerOwnedExecutionWorkerLoop/u)
  assert.match(botSource, /broadcastPreparedTransaction/u)
  assert.match(botSource, /waitForTransactionReceipt/u)
  assert.match(source, /PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED/u)
  assert.match(source, /PHASE3_EXECUTION_DATABASE_URL/u)
  assert.match(source, /PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64/u)
  assert.doesNotMatch(source, /PRIVATE_KEY|SECRET_ACCESS_KEY|console\.log\(.*env/u)
  assert.equal(packageJson.dependencies.pg, "8.13.3")
  assert.equal(packageJson.devDependencies.pg, undefined)
})
