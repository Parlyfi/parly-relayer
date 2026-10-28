import { createCipheriv, createDecipheriv, createHash, randomBytes as nodeRandomBytes } from "node:crypto"
import pg from "pg"
import { getAddress, keccak256, type Hex } from "viem"
import type {
  PayoutV3ExecutionDataSource,
  PayoutV3ExecutionJob,
  PayoutV3SubmitJob,
  RelayerOwnedOneTimeExecutionDataSource,
  RelayerOwnedOneTimeExecutionFunctionName,
  RelayerOwnedOneTimeExecutionJob
} from "./index.js"

const { Pool } = pg
const PAYLOAD_AAD = Buffer.from("parly-phase3-relayer-execution-v1", "utf8")
const PAYOUT_PAYLOAD_AAD = Buffer.from("parly-phase3-payout-v3-execution-v1", "utf8")
const PAYOUT_PREPARATION_AAD = Buffer.from("parly-phase3-payout-v3-preparation-v1", "utf8")
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
type PayoutExecutionPayload = PayoutV3SubmitJob

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

type PayoutPayloadRow = {
  payout_id: string
  payload_ciphertext: Buffer
  payload_iv: Buffer
  payload_auth_tag: Buffer
  payload_hash: string
}

type PayoutPreparationCandidateRow = {
  payout_id: string
  intent_hash: Hex
  max_attempts: number
}

type PayoutPreparationPayloadRow = PayoutPreparationCandidateRow & {
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

type PayoutCheckpointRow = {
  function_name: "submitPayout"
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

function assertBytes32(value: string, name: string) {
  if (!HEX_32_RE.test(value.toLowerCase())) throw new Error(`${name} must be a bytes32 hex value.`)
}

function assertHexBytes(value: string, name: string) {
  if (!/^0x(?:[a-fA-F0-9]{2})*$/u.test(value)) throw new Error(`${name} must be hex bytes.`)
}

function assertAddress(value: string, name: string) {
  if (!/^0x[a-fA-F0-9]{40}$/u.test(value)) throw new Error(`${name} must be an address.`)
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

export function encryptPayoutV3ExecutionPayload(
  payload: PayoutExecutionPayload,
  encryptionKey: Buffer,
  iv = nodeRandomBytes(12)
): EncryptedPayload {
  if (encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
  if (iv.length !== 12) throw new Error("execution payload IV must be 12 bytes.")
  const serialized = encodePayload(payload)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
  cipher.setAAD(PAYOUT_PAYLOAD_AAD)
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()])
  return {
    ciphertext,
    iv: Buffer.from(iv),
    authTag: cipher.getAuthTag(),
    payloadHash: sha256(serialized)
  }
}

export function decryptPayoutV3ExecutionPayload(
  sealed: EncryptedPayload,
  encryptionKey: Buffer
): PayoutExecutionPayload {
  if (encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, sealed.iv)
  decipher.setAAD(PAYOUT_PAYLOAD_AAD)
  decipher.setAuthTag(sealed.authTag)
  const serialized = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8")
  if (sha256(serialized) !== sealed.payloadHash) throw new Error("payout execution payload hash mismatch.")
  return decodePayload(serialized) as PayoutExecutionPayload
}

type PayoutV3PreparationPayload = {
  payoutId: string
  intentHash: Hex
  payoutAuthority: `0x${string}`
  destinationRecipient: `0x${string}`
  providerData: Hex
  providerDataHash: Hex
}

function decryptPayoutV3PreparationPayload(
  sealed: EncryptedPayload,
  encryptionKey: Buffer
): PayoutV3PreparationPayload {
  if (encryptionKey.length !== 32) throw new Error("execution payload encryption key must be 32 bytes.")
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, sealed.iv)
  decipher.setAAD(PAYOUT_PREPARATION_AAD)
  decipher.setAuthTag(sealed.authTag)
  const serialized = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8")
  if (sha256(serialized) !== sealed.payloadHash) throw new Error("payout preparation payload hash mismatch.")
  const payload = JSON.parse(serialized) as PayoutV3PreparationPayload
  assertIdentifier(payload.payoutId, "payoutId")
  assertBytes32(payload.intentHash, "intentHash")
  assertAddress(payload.payoutAuthority, "payoutAuthority")
  assertAddress(payload.destinationRecipient, "destinationRecipient")
  assertHexBytes(payload.providerData, "providerData")
  assertBytes32(payload.providerDataHash, "providerDataHash")
  if (keccak256(payload.providerData) !== payload.providerDataHash) {
    throw new Error("payout preparation providerDataHash mismatch.")
  }
  return {
    payoutId: payload.payoutId,
    intentHash: payload.intentHash.toLowerCase() as Hex,
    payoutAuthority: getAddress(payload.payoutAuthority) as `0x${string}`,
    destinationRecipient: getAddress(payload.destinationRecipient) as `0x${string}`,
    providerData: payload.providerData,
    providerDataHash: payload.providerDataHash.toLowerCase() as Hex
  }
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

export function createPayoutV3ExecutionPayloadWriter(options: StoreOptions = {}) {
  const pool = getPool(options)
  const encryptionKey = requireEncryptionKey(options)
  const randomBytes = options.randomBytes ?? nodeRandomBytes
  return {
    async enqueuePayoutV3ExecutionPayload(args: {
      payoutId: string
      payload: PayoutExecutionPayload
      maxAttempts: number
    }) {
      assertIdentifier(args.payoutId, "payoutId")
      if (args.payload.payoutId !== args.payoutId) {
        throw new Error("payout execution payload is not bound to payoutId.")
      }
      if (!Number.isInteger(args.maxAttempts) || args.maxAttempts < 1 || args.maxAttempts > 20) {
        throw new Error("maxAttempts must be an integer from 1 to 20.")
      }
      const sealed = encryptPayoutV3ExecutionPayload(args.payload, encryptionKey, randomBytes(12))
      await withTransaction(pool, async (client) => {
        const existing = await client.query<{ payload_hash: string }>(
          `SELECT payload_hash
           FROM phase3_private.payout_execution_payloads
           WHERE payout_id = $1
           FOR UPDATE`,
          [args.payoutId]
        )
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash !== sealed.payloadHash) {
            throw new Error("payout already has a different execution payload.")
          }
          return
        }
        await client.query(
          `INSERT INTO phase3_private.payout_execution_payloads (
             payout_id, intent_hash, payload_ciphertext, payload_iv, payload_auth_tag,
             payload_hash, status, max_attempts
           ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
          [
            args.payoutId,
            args.payload.intentHash.toLowerCase(),
            sealed.ciphertext,
            sealed.iv,
            sealed.authTag,
            sealed.payloadHash,
            args.maxAttempts
          ]
        )
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, evidence_hash
           ) VALUES ($1, $2, 'queued', $3)`,
          [`${args.payoutId}:queued:${randomBytes(12).toString("hex")}`, args.payoutId, sealed.payloadHash]
        )
      })
    }
  }
}

export function createPayoutV3PreparationPayloadDataSource(options: StoreOptions = {}) {
  const pool = getPool(options)
  const encryptionKey = requireEncryptionKey(options)
  const randomBytes = options.randomBytes ?? nodeRandomBytes
  return {
    async listPayoutV3PreparationCandidates(args: { limit: number }) {
      if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) {
        throw new Error("limit must be an integer from 1 to 50.")
      }
      const result = await pool.query<PayoutPreparationCandidateRow>(
        `SELECT prep.payout_id, prep.intent_hash, prep.max_attempts
         FROM phase3_private.payout_preparation_payloads prep
         LEFT JOIN phase3_private.payout_execution_payloads execution
           ON execution.payout_id = prep.payout_id
         WHERE execution.payout_id IS NULL
           AND prep.attempt_number < prep.max_attempts
           AND prep.status IN (
             'awaiting_withdrawal',
             'withdrawal_submitted',
             'withdrawal_confirmed',
             'quote_accepted',
             'receipt_confirmed',
             'failed_retryable'
           )
         ORDER BY prep.created_at, prep.payout_id
         LIMIT $1`,
        [args.limit]
      )
      return result.rows.map((row) => ({
        payoutId: row.payout_id,
        intentHash: row.intent_hash.toLowerCase() as Hex,
        maxAttempts: row.max_attempts
      }))
    },
    async promotePayoutV3PreparationToExecution(args: {
      payoutId: string
      intentHash: Hex
      status: "escrow_receipt_confirmed"
    }) {
      assertIdentifier(args.payoutId, "payoutId")
      assertAttemptId(args.intentHash)
      if (args.status !== "escrow_receipt_confirmed") {
        throw new Error("payout preparation can only be promoted after escrow receipt confirmation.")
      }
      return withTransaction<{ status: "queued"; payoutId: string } | { status: "already_queued"; payoutId: string } | null>(
        pool,
        async (client) => {
          const locked = await client.query<PayoutPreparationPayloadRow>(
            `UPDATE phase3_private.payout_preparation_payloads
             SET status = 'receipt_confirmed',
                 attempt_number = attempt_number + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE payout_id = $1
               AND intent_hash = $2
               AND attempt_number < max_attempts
               AND status IN (
                 'awaiting_withdrawal',
                 'withdrawal_submitted',
                 'withdrawal_confirmed',
                 'quote_accepted',
                 'receipt_confirmed',
                 'failed_retryable'
               )
             RETURNING payout_id, intent_hash, payload_ciphertext, payload_iv,
               payload_auth_tag, payload_hash, max_attempts`,
            [args.payoutId, args.intentHash.toLowerCase()]
          )
          const row = locked.rows[0]
          if (!row) {
            const existing = await client.query(
              `SELECT payout_id FROM phase3_private.payout_execution_payloads WHERE payout_id = $1 LIMIT 1`,
              [args.payoutId]
            )
            return existing.rows[0] ? { status: "already_queued" as const, payoutId: args.payoutId } : null
          }

          try {
            const preparation = decryptPayoutV3PreparationPayload(
              {
                ciphertext: row.payload_ciphertext,
                iv: row.payload_iv,
                authTag: row.payload_auth_tag,
                payloadHash: row.payload_hash
              },
              encryptionKey
            )
            if (preparation.payoutId !== row.payout_id) {
              throw new Error("payout preparation payload payoutId mismatch.")
            }
            if (preparation.intentHash !== row.intent_hash.toLowerCase()) {
              throw new Error("payout preparation payload intentHash mismatch.")
            }
            const executionPayload: PayoutExecutionPayload = {
              payoutId: preparation.payoutId,
              intentHash: preparation.intentHash,
              idempotencyKey: `phase3-payout-v3:${preparation.payoutId}:submitPayout`,
              status: "escrow_receipt_confirmed",
              payoutAuthority: preparation.payoutAuthority,
              destinationRecipient: preparation.destinationRecipient,
              providerData: preparation.providerData,
              providerDataHash: preparation.providerDataHash
            }
            const sealed = encryptPayoutV3ExecutionPayload(
              executionPayload,
              encryptionKey,
              randomBytes(12)
            )
            await client.query(
              `INSERT INTO phase3_private.payout_execution_payloads (
                 payout_id, intent_hash, payload_ciphertext, payload_iv,
                 payload_auth_tag, payload_hash, status, max_attempts
               ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
               ON CONFLICT (payout_id) DO NOTHING`,
              [
                row.payout_id,
                preparation.intentHash,
                sealed.ciphertext,
                sealed.iv,
                sealed.authTag,
                sealed.payloadHash,
                row.max_attempts
              ]
            )
            await client.query(
              `INSERT INTO phase3_private.payout_execution_events (
                 event_id, payout_id, event_type, evidence_hash
               ) VALUES ($1, $2, 'queued', $3)
               ON CONFLICT DO NOTHING`,
              [`${row.payout_id}:queued:${randomBytes(12).toString("hex")}`, row.payout_id, sealed.payloadHash]
            )
            await client.query(
              `UPDATE phase3_private.payout_preparation_payloads
               SET status = 'submitted', failure_code = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE payout_id = $1 AND status = 'receipt_confirmed'`,
              [row.payout_id]
            )
            return { status: "queued" as const, payoutId: row.payout_id }
          } catch (error) {
            await client.query(
              `UPDATE phase3_private.payout_preparation_payloads
               SET status = 'manual_review',
                   failure_code = 'invalid_execution_payload',
                   updated_at = CURRENT_TIMESTAMP
               WHERE payout_id = $1`,
              [row.payout_id]
            )
            throw error
          }
        }
      )
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
             ORDER BY updated_at, job_id
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

    async deferRelayerOwnedOneTimeExecutionJob(args) {
      assertIdentifier(args.jobId, "jobId")
      const updated = await pool.query(`UPDATE phase3_private.relayer_execution_payloads
        SET status='queued',attempt_number=GREATEST(0,attempt_number-1),locked_by=NULL,locked_until=NULL,
          lease_duration_ms=NULL,lease_token_hash=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE job_id=$1 AND lease_token_hash=$2 AND status='leased' AND locked_until>=CURRENT_TIMESTAMP
        RETURNING job_id`, [args.jobId, leaseTokenHash(args.leaseToken)])
      assertSingleRow(updated.rowCount)
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

export function createPayoutV3ExecutionPayloadDataSource(
  options: StoreOptions = {}
): PayoutV3ExecutionDataSource {
  const pool = getPool(options)
  const encryptionKey = requireEncryptionKey(options)
  const now = options.now ?? (() => new Date())
  const randomBytes = options.randomBytes ?? nodeRandomBytes

  return {
    async acquirePayoutV3ExecutionJob({ workerId, leaseMs }) {
      assertIdentifier(workerId, "workerId")
      if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000) {
        throw new Error("leaseMs must be between 1000 and 900000.")
      }
      const leaseToken = randomBytes(32).toString("base64url")
      const lockedUntil = new Date(now().getTime() + leaseMs)
      const result = await withTransaction<PayoutV3ExecutionJob | null | { invalidPayloadError: unknown }>(
        pool,
        async (client) => {
          const exhausted = await client.query<{ payout_id: string }>(
            `WITH candidates AS (
               SELECT payout_id
               FROM phase3_private.payout_execution_payloads
               WHERE status = 'leased' AND locked_until < CURRENT_TIMESTAMP
                 AND attempt_number >= max_attempts
               ORDER BY locked_until, payout_id
               FOR UPDATE SKIP LOCKED
               LIMIT 100
             )
             UPDATE phase3_private.payout_execution_payloads AS job
             SET status = 'manual_review', failure_code = 'lease_exhausted',
                 locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
                 lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
             FROM candidates
             WHERE job.payout_id = candidates.payout_id
             RETURNING job.payout_id`
          )
          for (const exhaustedJob of exhausted.rows) {
            await client.query(
              `INSERT INTO phase3_private.payout_execution_events (
                 event_id, payout_id, event_type, failure_code
               ) VALUES ($1, $2, 'manual_review', 'lease_exhausted')`,
              [
                `${exhaustedJob.payout_id}:lease-exhausted:${randomBytes(12).toString("hex")}`,
                exhaustedJob.payout_id
              ]
            )
          }
          const leased = await client.query<PayoutPayloadRow>(
            `WITH candidate AS (
               SELECT payout_id
               FROM phase3_private.payout_execution_payloads
               WHERE attempt_number < max_attempts
                 AND (
                   status IN ('queued', 'failed_retryable')
                   OR (status = 'leased' AND locked_until < CURRENT_TIMESTAMP)
                 )
               ORDER BY created_at, payout_id
               FOR UPDATE SKIP LOCKED
               LIMIT 1
             )
             UPDATE phase3_private.payout_execution_payloads AS job
             SET status = 'leased',
                 locked_by = $1,
                 locked_until = $2,
                 lease_token_hash = $3,
                 lease_duration_ms = $4,
                 attempt_number = attempt_number + 1,
                 updated_at = CURRENT_TIMESTAMP
             FROM candidate
             WHERE job.payout_id = candidate.payout_id
             RETURNING job.payout_id, job.payload_ciphertext, job.payload_iv,
               job.payload_auth_tag, job.payload_hash`,
            [workerId, lockedUntil.toISOString(), leaseTokenHash(leaseToken), leaseMs]
          )
          const row = leased.rows[0]
          if (!row) return null
          await client.query(
            `INSERT INTO phase3_private.payout_execution_events (
               event_id, payout_id, event_type, lease_token_hash
             ) VALUES ($1, $2, 'leased', $3)`,
            [
              `${row.payout_id}:leased:${randomBytes(12).toString("hex")}`,
              row.payout_id,
              leaseTokenHash(leaseToken)
            ]
          )
          try {
            const checkpoints = await client.query<PayoutCheckpointRow>(
              `SELECT function_name, transaction_hash
               FROM phase3_private.payout_execution_checkpoints
               WHERE payout_id = $1
               ORDER BY created_at, transaction_hash
               LIMIT 1`,
              [row.payout_id]
            )
            const payload = decryptPayoutV3ExecutionPayload(
              {
                ciphertext: row.payload_ciphertext,
                iv: row.payload_iv,
                authTag: row.payload_auth_tag,
                payloadHash: row.payload_hash
              },
              encryptionKey
            )
            if (payload.payoutId !== row.payout_id) {
              throw new Error("payout execution payload payoutId does not match its database binding.")
            }
            const confirmed = checkpoints.rows[0]
            return {
              leaseToken,
              ...payload,
              confirmedTransaction: confirmed
                ? {
                    functionName: confirmed.function_name,
                    transactionHash: confirmed.transaction_hash
                  }
                : undefined
            }
          } catch (invalidPayloadError) {
            await client.query(
              `UPDATE phase3_private.payout_execution_payloads
               SET status = 'manual_review', failure_code = 'invalid_execution_payload',
                   locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
                   lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE payout_id = $1 AND lease_token_hash = $2 AND status = 'leased'`,
              [row.payout_id, leaseTokenHash(leaseToken)]
            )
            await client.query(
              `INSERT INTO phase3_private.payout_execution_events (
                 event_id, payout_id, event_type, failure_code
               ) VALUES ($1, $2, 'manual_review', 'invalid_execution_payload')`,
              [
                `${row.payout_id}:invalid-acquire:${randomBytes(12).toString("hex")}`,
                row.payout_id
              ]
            )
            return { invalidPayloadError }
          }
        }
      )
      if (result && "invalidPayloadError" in result) throw result.invalidPayloadError
      return result
    },

    async recordPayoutV3ExecutionDryRun(args) {
      assertIdentifier(args.payoutId, "payoutId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE phase3_private.payout_execution_payloads
           SET status = 'queued', locked_by = NULL, locked_until = NULL,
               lease_duration_ms = NULL, lease_token_hash = NULL,
               attempt_number = GREATEST(attempt_number - 1, 0),
               updated_at = CURRENT_TIMESTAMP
           WHERE payout_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
          [args.payoutId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, lease_token_hash
           ) VALUES ($1, $2, 'dry_run', $3)`,
          [
            `${args.payoutId}:dry-run:${randomBytes(12).toString("hex")}`,
            args.payoutId,
            leaseTokenHash(args.leaseToken)
          ]
        )
      })
    },

    async renewPayoutV3ExecutionLease(args) {
      assertIdentifier(args.payoutId, "payoutId")
      const updated = await pool.query(
        `UPDATE phase3_private.payout_execution_payloads
         SET locked_until = CURRENT_TIMESTAMP + (lease_duration_ms * INTERVAL '1 millisecond'),
             updated_at = CURRENT_TIMESTAMP
         WHERE payout_id = $1 AND lease_token_hash = $2
           AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
        [args.payoutId, leaseTokenHash(args.leaseToken)]
      )
      assertSingleRow(updated.rowCount)
    },

    async recordPayoutV3ExecutionTransactionConfirmed(args) {
      if (args.functionName !== "submitPayout") throw new Error("unsupported payout execution function checkpoint.")
      await withTransaction(pool, async (client) => {
        const active = await client.query(
          `SELECT payout_id
           FROM phase3_private.payout_execution_payloads
           WHERE payout_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           FOR UPDATE`,
          [args.payoutId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(active.rowCount)
        await client.query(
          `INSERT INTO phase3_private.payout_execution_checkpoints (
             payout_id, function_name, transaction_hash
           ) VALUES ($1, 'submitPayout', $2)`,
          [args.payoutId, args.transactionHash.toLowerCase()]
        )
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, lease_token_hash, evidence_hash
           ) VALUES ($1, $2, 'checkpoint_confirmed', $3, $4)`,
          [
            `${args.payoutId}:checkpoint:${randomBytes(12).toString("hex")}`,
            args.payoutId,
            leaseTokenHash(args.leaseToken),
            sha256(args.transactionHash.toLowerCase())
          ]
        )
      })
    },

    async recordPayoutV3ExecutionSubmitted(args) {
      await withTransaction(pool, async (client) => {
        const active = await client.query(
          `SELECT payout_id
           FROM phase3_private.payout_execution_payloads
           WHERE payout_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           FOR UPDATE`,
          [args.payoutId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(active.rowCount)
        const checkpoint = await client.query<PayoutCheckpointRow>(
          `SELECT function_name, transaction_hash
           FROM phase3_private.payout_execution_checkpoints
           WHERE payout_id = $1
           LIMIT 1`,
          [args.payoutId]
        )
        if (checkpoint.rows[0]?.transaction_hash.toLowerCase() !== args.transactionHash.toLowerCase()) {
          throw new Error("submitted payout transaction hash does not match confirmed checkpoint.")
        }
        const updated = await client.query(
          `UPDATE phase3_private.payout_execution_payloads
           SET status = 'submitted', locked_by = NULL, locked_until = NULL,
               lease_duration_ms = NULL, lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE payout_id = $1 AND lease_token_hash = $2 AND status = 'leased'`,
          [args.payoutId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, lease_token_hash, evidence_hash
           ) VALUES ($1, $2, 'submitted', $3, $4)`,
          [
            `${args.payoutId}:submitted:${randomBytes(12).toString("hex")}`,
            args.payoutId,
            leaseTokenHash(args.leaseToken),
            sha256(args.transactionHash.toLowerCase())
          ]
        )
      })
    },

    async recordPayoutV3ExecutionFailed(args) {
      const retryable = args.failureCode === "broadcast_failed"
      assertIdentifier(args.payoutId, "payoutId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query<{ status: "failed_retryable" | "manual_review" }>(
          `UPDATE phase3_private.payout_execution_payloads
           SET status = CASE
                 WHEN $3::boolean AND attempt_number < max_attempts THEN 'failed_retryable'
                 ELSE 'manual_review'
               END,
               failure_code = $4,
               locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
               lease_token_hash = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE payout_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP
           RETURNING status`,
          [args.payoutId, leaseTokenHash(args.leaseToken), retryable, args.failureCode]
        )
        assertSingleRow(updated.rowCount)
        const status = updated.rows[0]?.status ?? "manual_review"
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, lease_token_hash, failure_code
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            `${args.payoutId}:failed:${randomBytes(12).toString("hex")}`,
            args.payoutId,
            status,
            leaseTokenHash(args.leaseToken),
            args.failureCode
          ]
        )
      })
    },

    async recordPayoutV3ExecutionPayloadInvalid(args) {
      assertIdentifier(args.payoutId, "payoutId")
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE phase3_private.payout_execution_payloads
           SET status = 'manual_review', failure_code = 'invalid_execution_payload',
               locked_by = NULL, locked_until = NULL, lease_duration_ms = NULL,
               lease_token_hash = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE payout_id = $1 AND lease_token_hash = $2
             AND status = 'leased' AND locked_until >= CURRENT_TIMESTAMP`,
          [args.payoutId, leaseTokenHash(args.leaseToken)]
        )
        assertSingleRow(updated.rowCount)
        await client.query(
          `INSERT INTO phase3_private.payout_execution_events (
             event_id, payout_id, event_type, lease_token_hash, failure_code
           ) VALUES ($1, $2, 'manual_review', $3, 'invalid_execution_payload')`,
          [
            `${args.payoutId}:invalid:${randomBytes(12).toString("hex")}`,
            args.payoutId,
            leaseTokenHash(args.leaseToken)
          ]
        )
      })
    }
  }
}
