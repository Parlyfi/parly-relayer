import { createCipheriv, createDecipheriv, createHash, randomBytes as nodeRandomBytes } from "node:crypto"
import pg from "pg"
import type { Hex } from "viem"
import type {
  RelayerOwnedOneTimeExecutionDataSource,
  RelayerOwnedOneTimeExecutionFunctionName,
  RelayerOwnedOneTimeExecutionJob
} from "./index.js"

const { Pool } = pg
const PAYLOAD_AAD = Buffer.from("parly-phase3-relayer-execution-v1", "utf8")
const FUNCTION_ORDER: readonly RelayerOwnedOneTimeExecutionFunctionName[] = [
  "registerAttemptWithAuthorization",
  "recordDepositObservationWithAttestation",
  "finalizeVirtualDeposit"
]
const HEX_32_RE = /^0x[a-f0-9]{64}$/u

type ExecutionPayload = Omit<
  RelayerOwnedOneTimeExecutionJob,
  "jobId" | "leaseToken" | "confirmedTransactions"
>

type QueryResult<Row> = { rowCount?: number | null; rows: Row[] }
type QueryClient = {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>
  release(): void
}
type QueryPool = {
  connect(): Promise<QueryClient>
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>
}

type StoreOptions = {
  pool?: QueryPool
  encryptionKey?: Buffer
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  now?: () => Date
  randomBytes?: (size: number) => Buffer
}

type EncryptedPayload = {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  payloadHash: string
}

type PayloadRow = {
  job_id: string
  attempt_id: Hex
  payload_ciphertext: Buffer
  payload_iv: Buffer
  payload_auth_tag: Buffer
  payload_hash: string
}

type CheckpointRow = {
  step_index: number
  function_name: RelayerOwnedOneTimeExecutionFunctionName
  transaction_hash: Hex
}

declare global {
  var __parlyExecutionPayloadPool: pg.Pool | undefined
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function encodePayload(payload: unknown) {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? { __parlyBigInt: value.toString() } : value
  )
}

function decodePayload(serialized: string) {
  return JSON.parse(serialized, (_key, value) => {
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      typeof value.__parlyBigInt === "string" &&
      /^(0|[1-9][0-9]*)$/u.test(value.__parlyBigInt)
    ) {
      return BigInt(value.__parlyBigInt)
    }
    return value
  })
}

function requireEncryptionKey(options: StoreOptions) {
  if (options.encryptionKey) {
    if (options.encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
    return Buffer.from(options.encryptionKey)
  }
  const encoded = options.env?.PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64?.trim()
    ?? process.env.PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64?.trim()
  if (!encoded) throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 is required.")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 must decode to 32 bytes.")
  return key
}

export function readRelayerOwnedExecutionPayloadStoreConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
) {
  const connectionString = env.PHASE3_EXECUTION_DATABASE_URL?.trim()
  if (!connectionString) throw new Error("PHASE3_EXECUTION_DATABASE_URL is required.")
  const encoded = env.PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64?.trim()
  if (!encoded) throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 is required.")
  const encryptionKey = Buffer.from(encoded, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 must decode to 32 bytes.")
  }
  return { connectionString, encryptionKey }
}

function getPool(options: StoreOptions): QueryPool {
  if (options.pool) return options.pool
  if (!globalThis.__parlyExecutionPayloadPool) {
    const { connectionString } = readRelayerOwnedExecutionPayloadStoreConfig(options.env)
    globalThis.__parlyExecutionPayloadPool = new Pool({
      connectionString,
      application_name: "parly-relayer-execution-payloads",
      max: 3,
      statement_timeout: 5_000,
      query_timeout: 7_500
    })
  }
  return globalThis.__parlyExecutionPayloadPool
}

function assertIdentifier(value: string, name: string) {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/u.test(value)) throw new Error(`${name} is invalid.`)
}

function assertAttemptId(value: string) {
  if (!HEX_32_RE.test(value.toLowerCase())) throw new Error("attemptId must be a bytes32 hex value.")
}

function leaseTokenHash(leaseToken: string) {
  if (!leaseToken.trim()) throw new Error("leaseToken is required.")
  return sha256(leaseToken)
}

export function encryptRelayerOwnedExecutionPayload(
  payload: ExecutionPayload,
  encryptionKey: Buffer,
  iv = nodeRandomBytes(12)
): EncryptedPayload {
  if (encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
  if (iv.length !== 12) throw new Error("execution payload IV must be 12 bytes.")
  const serialized = encodePayload(payload)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
  cipher.setAAD(PAYLOAD_AAD)
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()])
  return {
    ciphertext,
    iv: Buffer.from(iv),
    authTag: cipher.getAuthTag(),
    payloadHash: sha256(serialized)
  }
}

export function decryptRelayerOwnedExecutionPayload(
  sealed: EncryptedPayload,
  encryptionKey: Buffer
): ExecutionPayload {
  if (encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, sealed.iv)
  decipher.setAAD(PAYLOAD_AAD)
  decipher.setAuthTag(sealed.authTag)
  const serialized = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8")
  if (sha256(serialized) !== sealed.payloadHash) throw new Error("execution payload hash mismatch.")
  return decodePayload(serialized) as ExecutionPayload
}

async function withTransaction<T>(pool: QueryPool, action: (client: QueryClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await action(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function assertSingleRow(
  rowCount: number | null | undefined,
  message = "execution payload lease is stale or no longer active."
) {
  if (rowCount !== 1) throw new Error(message)
}

export function createRelayerOwnedExecutionPayloadWriter(options: StoreOptions = {}) {
  const pool = getPool(options)
  const encryptionKey = requireEncryptionKey(options)
  const randomBytes = options.randomBytes ?? nodeRandomBytes
  return {
    async enqueueRelayerOwnedOneTimeExecutionPayload(args: {
      jobId: string
      attemptId: Hex
      payload: ExecutionPayload
      maxAttempts: number
    }) {
      assertIdentifier(args.jobId, "jobId")
      assertAttemptId(args.attemptId)
      const normalizedAttemptId = args.attemptId.toLowerCase()
      if (
        args.payload.attemptAuthorization.attemptId.toLowerCase() !== normalizedAttemptId ||
        args.payload.observationAttestation.attemptId.toLowerCase() !== normalizedAttemptId ||
        args.payload.settlementAuthorization.attemptId.toLowerCase() !== normalizedAttemptId
      ) {
        throw new Error("execution payload signatures are not bound to the queued attemptId.")
      }
      if (!Number.isInteger(args.maxAttempts) || args.maxAttempts < 1 || args.maxAttempts > 20) {
        throw new Error("maxAttempts must be an integer from 1 to 20.")
      }
      const sealed = encryptRelayerOwnedExecutionPayload(args.payload, encryptionKey, randomBytes(12))
      await withTransaction(pool, async (client) => {
        const existing = await client.query<{ payload_hash: string }>(
          `SELECT payload_hash
           FROM phase3_private.relayer_execution_payloads
           WHERE attempt_id = $1
           FOR UPDATE`,
          [normalizedAttemptId]
        )
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash !== sealed.payloadHash) {
            throw new Error("attempt already has a different execution payload.")
          }
          return
        }
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_payloads (
             job_id, attempt_id, payload_ciphertext, payload_iv, payload_auth_tag,
             payload_hash, status, max_attempts
           ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
          [
            args.jobId,
            normalizedAttemptId,
            sealed.ciphertext,
            sealed.iv,
            sealed.authTag,
            sealed.payloadHash,
            args.maxAttempts
          ]
        )
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, evidence_hash
           ) VALUES ($1, $2, 'queued', $3)`,
          [`${args.jobId}:queued:${randomBytes(12).toString("hex")}`, args.jobId, sealed.payloadHash]
        )
      })
    },
    async confirmRelayerOwnedOneTimeExecution(args: {
      jobId: string
      finalizationTransactionHash: Hex
    }) {
      assertIdentifier(args.jobId, "jobId")
      if (!HEX_32_RE.test(args.finalizationTransactionHash.toLowerCase())) {
        throw new Error("finalizationTransactionHash must be a 32-byte transaction hash.")
      }
      await withTransaction(pool, async (client) => {
        const checkpoint = await client.query<{ transaction_hash: Hex }>(
          `SELECT transaction_hash
           FROM phase3_private.relayer_execution_checkpoints
           WHERE job_id = $1 AND step_index = 2
           FOR UPDATE`,
          [args.jobId]
        )
        if (
          checkpoint.rows[0]?.transaction_hash.toLowerCase() !==
          args.finalizationTransactionHash.toLowerCase()
        ) {
          throw new Error("finalization transaction does not match the confirmed checkpoint.")
        }
        const updated = await client.query(
          `UPDATE phase3_private.relayer_execution_payloads
           SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $1 AND status = 'submitted'`,
          [args.jobId]
        )
        assertSingleRow(updated.rowCount, "execution payload is not submitted or is missing.")
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, evidence_hash
           ) VALUES ($1, $2, 'confirmed', $3)`,
          [
            `${args.jobId}:confirmed:${randomBytes(12).toString("hex")}`,
            args.jobId,
            sha256(args.finalizationTransactionHash.toLowerCase())
          ]
        )
      })
    }
  }
}

export function createRelayerOwnedExecutionPayloadDataSource(
  options: StoreOptions = {}
): RelayerOwnedOneTimeExecutionDataSource {
  const pool = getPool(options)
  const encryptionKey = requireEncryptionKey(options)
  const now = options.now ?? (() => new Date())
  const randomBytes = options.randomBytes ?? nodeRandomBytes

  return {
    async acquireRelayerOwnedOneTimeExecutionJob({ workerId, leaseMs }) {
      assertIdentifier(workerId, "workerId")
      if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000) {
        throw new Error("leaseMs must be between 1000 and 900000.")
      }
      const leaseToken = randomBytes(32).toString("base64url")
      const lockedUntil = new Date(now().getTime() + leaseMs)
      const result = await withTransaction<RelayerOwnedOneTimeExecutionJob | null | { invalidPayloadError: unknown }>(
        pool,
        async (client) => {
        const exhausted = await client.query<{ job_id: string }>(
          `WITH candidates AS (
             SELECT job_id
             FROM phase3_private.relayer_execution_payloads
             WHERE status = 'leased' AND locked_until < CURRENT_TIMESTAMP
               AND attempt_number >= max_attempts
             ORDER BY locked_until, job_id
             FOR UPDATE SKIP LOCKED
             LIMIT 100
           )
           UPDATE phase3_private.relayer_execution_payloads AS job
           SET status = 'manual_review', failure_code = 'lease_exhausted',
               locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
               lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
           FROM candidates
           WHERE job.job_id = candidates.job_id
           RETURNING job.job_id`
        )
        for (const exhaustedJob of exhausted.rows) {
          await client.query(
            `INSERT INTO phase3_private.relayer_execution_events (
               event_id, job_id, event_type, failure_code
             ) VALUES ($1, $2, 'manual_review', 'lease_exhausted')`,
            [
              `${exhaustedJob.job_id}:lease-exhausted:${randomBytes(12).toString("hex")}`,
              exhaustedJob.job_id
            ]
          )
        }
        const leased = await client.query<PayloadRow>(
          `WITH candidate AS (
             SELECT job_id
             FROM phase3_private.relayer_execution_payloads
             WHERE attempt_number < max_attempts
               AND (
                 status IN ('queued', 'failed_retryable')
                 OR (status = 'leased' AND locked_until < CURRENT_TIMESTAMP)
               )
             ORDER BY created_at, job_id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE phase3_private.relayer_execution_payloads AS job
           SET status = 'leased',
               locked_by = $1,
               locked_until = $2,
               lease_token_hash = $3,
               lease_duration_ms = $4,
               attempt_number = attempt_number + 1,
               updated_at = CURRENT_TIMESTAMP
           FROM candidate
           WHERE job.job_id = candidate.job_id
           RETURNING job.job_id, job.attempt_id, job.payload_ciphertext, job.payload_iv,
             job.payload_auth_tag, job.payload_hash`,
          [workerId, lockedUntil.toISOString(), leaseTokenHash(leaseToken), leaseMs]
        )
        const row = leased.rows[0]
        if (!row) return null
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, lease_token_hash
           ) VALUES ($1, $2, 'leased', $3)`,
          [
            `${row.job_id}:leased:${randomBytes(12).toString("hex")}`,
            row.job_id,
            leaseTokenHash(leaseToken)
          ]
        )
        try {
          const checkpoints = await client.query<CheckpointRow>(
            `SELECT step_index, function_name, transaction_hash
             FROM phase3_private.relayer_execution_checkpoints
             WHERE job_id = $1
             ORDER BY step_index`,
            [row.job_id]
          )
          const confirmedTransactions = checkpoints.rows.map((checkpoint, index) => {
            if (checkpoint.step_index !== index || FUNCTION_ORDER[index] !== checkpoint.function_name) {
              throw new Error("stored execution checkpoints are not an ordered prefix.")
            }
            return {
              functionName: checkpoint.function_name,
              transactionHash: checkpoint.transaction_hash
            }
          })
          const payload = decryptRelayerOwnedExecutionPayload(
            {
              ciphertext: row.payload_ciphertext,
              iv: row.payload_iv,
              authTag: row.payload_auth_tag,
              payloadHash: row.payload_hash
            },
            encryptionKey
          )
          if (payload.attemptAuthorization.attemptId.toLowerCase() !== row.attempt_id.toLowerCase()) {
            throw new Error("execution payload attemptId does not match its database binding.")
          }
          return { jobId: row.job_id, leaseToken, ...payload, confirmedTransactions }
        } catch (invalidPayloadError) {
          await client.query(
            `UPDATE phase3_private.relayer_execution_payloads
             SET status = 'manual_review', failure_code = 'invalid_execution_payload',
                 locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
                 lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE job_id = $1 AND lease_token_hash = $2 AND status = 'leased'`,
            [row.job_id, leaseTokenHash(leaseToken)]
          )
          await client.query(
            `INSERT INTO phase3_private.relayer_execution_events (
               event_id, job_id, event_type, failure_code
             ) VALUES ($1, $2, 'manual_review', 'invalid_execution_payload')`,
            [
              `${row.job_id}:invalid-acquire:${randomBytes(12).toString("hex")}`,
              row.job_id
            ]
          )
          return { invalidPayloadError }
        }
      })
      if (result && "invalidPayloadError" in result) throw result.invalidPayloadError
      return result
    },

    async recordRelayerOwnedOneTimeExecutionDryRun(args) {
      assertIdentifier(args.jobId, "jobId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE phase3_private.relayer_execution_payloads
           SET status = 'queued', locked_by = NULL, locked_until = NULL,
               lease_duration_ms = NULL, lease_token_hash = NULL,
               attempt_number = GREATEST(attempt_number - 1, 0),
               updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
          [args.jobId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, lease_token_hash
           ) VALUES ($1, $2, 'dry_run', $3)`,
          [
            `${args.jobId}:dry-run:${randomBytes(12).toString("hex")}`,
            args.jobId,
            leaseTokenHash(args.leaseToken)
          ]
        )
      })
    },

    async renewRelayerOwnedOneTimeExecutionLease(args) {
      assertIdentifier(args.jobId, "jobId")
      const updated = await pool.query(
        `UPDATE phase3_private.relayer_execution_payloads
         SET locked_until = CURRENT_TIMESTAMP + (lease_duration_ms * INTERVAL '1 millisecond'),
             updated_at = CURRENT_TIMESTAMP
         WHERE job_id = $1 AND lease_token_hash = $2
           AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
        [args.jobId, leaseTokenHash(args.leaseToken)]
      )
      assertSingleRow(updated.rowCount)
    },

    async recordRelayerOwnedOneTimeExecutionTransactionConfirmed(args) {
      const expectedIndex = FUNCTION_ORDER.indexOf(args.functionName)
      if (expectedIndex < 0) throw new Error("unsupported execution function checkpoint.")
      await withTransaction(pool, async (client) => {
        const active = await client.query(
          `SELECT job_id
           FROM phase3_private.relayer_execution_payloads
           WHERE job_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           FOR UPDATE`,
          [args.jobId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(active.rowCount)
        const count = await client.query<{ checkpoint_count: string }>(
          `SELECT count(*)::text AS checkpoint_count
           FROM phase3_private.relayer_execution_checkpoints
           WHERE job_id = $1`,
          [args.jobId]
        )
        if (Number(count.rows[0]?.checkpoint_count ?? "0") !== expectedIndex) {
          throw new Error("execution checkpoint is not the next ordered step.")
        }
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_checkpoints (
             job_id, step_index, function_name, transaction_hash
           ) VALUES ($1, $2, $3, $4)`,
          [args.jobId, expectedIndex, args.functionName, args.transactionHash.toLowerCase()]
        )
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, step_index, lease_token_hash, evidence_hash
           ) VALUES ($1, $2, 'checkpoint_confirmed', $3, $4, $5)`,
          [
            `${args.jobId}:checkpoint:${expectedIndex}:${randomBytes(12).toString("hex")}`,
            args.jobId,
            expectedIndex,
            leaseTokenHash(args.leaseToken),
            sha256(args.transactionHash.toLowerCase())
          ]
        )
      })
    },

    async recordRelayerOwnedOneTimeExecutionFailed(args) {
      const retryable = args.failureCode === "broadcast_failed"
      assertIdentifier(args.jobId, "jobId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query<{ status: "failed_retryable" | "manual_review" }>(
          `UPDATE phase3_private.relayer_execution_payloads
           SET status = CASE
                 WHEN $3::boolean AND attempt_number < max_attempts THEN 'failed_retryable'
                 ELSE 'manual_review'
               END,
               failure_code = $4,
               locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
               lease_token_hash = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           RETURNING status`,
          [args.jobId, leaseTokenHash(args.leaseToken), retryable, args.failureCode]
        )
        assertSingleRow(updated.rowCount)
        const status = updated.rows[0]?.status ?? "manual_review"
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, lease_token_hash, failure_code
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            `${args.jobId}:failed:${randomBytes(12).toString("hex")}`,
            args.jobId,
            status,
            leaseTokenHash(args.leaseToken),
            args.failureCode
          ]
        )
      })
    },

    async recordRelayerOwnedOneTimeExecutionPayloadInvalid(args) {
      assertIdentifier(args.jobId, "jobId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE phase3_private.relayer_execution_payloads
           SET status = 'manual_review', failure_code = 'invalid_execution_payload',
               locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
               lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
          [args.jobId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, lease_token_hash, failure_code
           ) VALUES ($1, $2, 'manual_review', $3, 'invalid_execution_payload')`,
          [
            `${args.jobId}:invalid:${randomBytes(12).toString("hex")}`,
            args.jobId,
            leaseTokenHash(args.leaseToken)
          ]
        )
      })
    },

    async recordRelayerOwnedOneTimeExecutionSubmitted(args) {
      if (args.transactionHashes.length !== FUNCTION_ORDER.length) {
        throw new Error("submitted execution must contain exactly three transaction hashes.")
      }
      await withTransaction(pool, async (client) => {
        const active = await client.query(
          `SELECT job_id
           FROM phase3_private.relayer_execution_payloads
           WHERE job_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           FOR UPDATE`,
          [args.jobId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(active.rowCount)
        const checkpoints = await client.query<CheckpointRow>(
          `SELECT step_index, function_name, transaction_hash
           FROM phase3_private.relayer_execution_checkpoints
           WHERE job_id = $1
           ORDER BY step_index`,
          [args.jobId]
        )
        if (
          checkpoints.rows.length !== FUNCTION_ORDER.length ||
          checkpoints.rows.some((row, index) =>
            row.step_index !== index ||
            row.function_name !== FUNCTION_ORDER[index] ||
            row.transaction_hash.toLowerCase() !== args.transactionHashes[index]?.toLowerCase()
          )
        ) {
          throw new Error("submitted transaction hashes do not match confirmed checkpoints.")
        }
        const updated = await client.query(
          `UPDATE phase3_private.relayer_execution_payloads
           SET status = 'submitted', locked_by = NULL, locked_until = NULL,
               lease_duration_ms = NULL, lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $1 AND lease_token_hash = $2 AND status = 'leased'`,
          [args.jobId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.relayer_execution_events (
             event_id, job_id, event_type, lease_token_hash, evidence_hash
           ) VALUES ($1, $2, 'submitted', $3, $4)`,
          [
            `${args.jobId}:submitted:${randomBytes(12).toString("hex")}`,
            args.jobId,
            leaseTokenHash(args.leaseToken),
            sha256(args.transactionHashes.map((hash) => hash.toLowerCase()).join(":"))
          ]
        )
      })
    }
  }
}
