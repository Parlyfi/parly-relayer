import { createHash } from "node:crypto"
import pg from "pg"
import { requireEnv } from "@parly/env-utils"
import type { PayoutV4ExecutionStep, PayoutV5ExecutionStep, PayoutV6ExecutionStep } from "@parly/shared-types"

const { Pool } = pg
type PoolClient = pg.PoolClient

export type PendingRelayerRecord = {
  version: 1
  recordedAt: number
  phase: "pre_submit_exhausted" | "submitted_receipt_unknown"
  attempt: number
  relayerAddress: `0x${string}`
  pool: `0x${string}` | null
  nullifierHash: `0x${string}` | null
  submittedHash: `0x${string}` | null
  approvalToken: `0x${string}` | null
  approvalSpender: `0x${string}` | null
  reason: string
  rawBundle: unknown
}

export type PendingRelayerResolution = {
  resolvedAt: number
  resolution:
    | "confirmed_success"
    | "confirmed_failure"
    | "external_success_without_receipt"
    | "pre_submit_terminal_failure"
  cleanupAttempted: boolean
  cleanupSucceeded: boolean
}

export type StoredPendingRelayerRecord = PendingRelayerRecord & {
  id: number
  persistenceKey: string
}

export type RelayInboxRecord = {
  id: number
  bundleKey: string
  relayerAddress: `0x${string}`
  rawBundle: unknown
  source: string
}

export type PayoutV4LocalCheckpoint = {
  intentHash: `0x${string}`
  step: PayoutV4ExecutionStep
  transactionHash: `0x${string}`
  relayerAddress: `0x${string}`
}

export type PayoutV4LocalSubmission = PayoutV4LocalCheckpoint

export type PayoutV5LocalCheckpoint = {
  intentHash: `0x${string}`
  step: PayoutV5ExecutionStep
  transactionHash: `0x${string}`
  relayerAddress: `0x${string}`
}

export type PayoutV5LocalSubmission = PayoutV5LocalCheckpoint

export type PayoutV6LocalCheckpoint = {
  intentHash: `0x${string}`
  step: PayoutV6ExecutionStep
  transactionHash: `0x${string}`
  relayerAddress: `0x${string}`
}

export type PayoutV6LocalSubmission = PayoutV6LocalCheckpoint

declare global {
  var __parlyPendingExecutionPool: pg.Pool | undefined
  var __parlyPendingExecutionSchemaReady: Promise<void> | undefined
}

const PENDING_EXECUTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_pool_v4_executions (
  call_hash VARCHAR(66) PRIMARY KEY,
  relayer_address VARCHAR(42) NOT NULL,
  pool_address VARCHAR(42) NOT NULL,
  nullifiers TEXT[] NOT NULL,
  transaction_hash VARCHAR(66),
  released_at TIMESTAMPTZ,
  retirement_proof JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE relay_pool_v4_executions ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE relay_pool_v4_executions ADD COLUMN IF NOT EXISTS retirement_proof JSONB;
CREATE TABLE IF NOT EXISTS relay_pending_executions (
  id BIGSERIAL PRIMARY KEY,
  persistence_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version = 1),
  phase VARCHAR(32) NOT NULL CHECK (phase IN ('pre_submit_exhausted', 'submitted_receipt_unknown')),
  recorded_at BIGINT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  relayer_address VARCHAR(42) NOT NULL,
  pool VARCHAR(42),
  nullifier_hash VARCHAR(66),
  submitted_hash VARCHAR(66),
  approval_token VARCHAR(42),
  approval_spender VARCHAR(42),
  reason TEXT NOT NULL,
  raw_bundle JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS relay_pending_executions_recorded_idx
  ON relay_pending_executions(recorded_at);
CREATE INDEX IF NOT EXISTS relay_pending_executions_nullifier_idx
  ON relay_pending_executions(nullifier_hash);
CREATE INDEX IF NOT EXISTS relay_pending_executions_submitted_hash_idx
  ON relay_pending_executions(submitted_hash);

CREATE TABLE IF NOT EXISTS relay_pending_execution_archive (
  id BIGSERIAL PRIMARY KEY,
  pending_execution_id BIGINT,
  persistence_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version = 1),
  phase VARCHAR(32) NOT NULL CHECK (phase IN ('pre_submit_exhausted', 'submitted_receipt_unknown')),
  recorded_at BIGINT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  relayer_address VARCHAR(42) NOT NULL,
  pool VARCHAR(42),
  nullifier_hash VARCHAR(66),
  submitted_hash VARCHAR(66),
  approval_token VARCHAR(42),
  approval_spender VARCHAR(42),
  reason TEXT NOT NULL,
  raw_bundle JSONB NOT NULL,
  resolved_at BIGINT NOT NULL,
  resolution VARCHAR(48) NOT NULL CHECK (
    resolution IN (
      'confirmed_success',
      'confirmed_failure',
      'external_success_without_receipt',
      'pre_submit_terminal_failure'
    )
  ),
  cleanup_attempted BOOLEAN NOT NULL,
  cleanup_succeeded BOOLEAN NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS relay_pending_execution_archive_resolved_idx
  ON relay_pending_execution_archive(resolved_at);
CREATE INDEX IF NOT EXISTS relay_pending_execution_archive_nullifier_idx
  ON relay_pending_execution_archive(nullifier_hash);
CREATE INDEX IF NOT EXISTS relay_pending_execution_archive_submitted_hash_idx
  ON relay_pending_execution_archive(submitted_hash);

CREATE TABLE IF NOT EXISTS relay_private_inbox (
  id BIGSERIAL PRIMARY KEY,
  bundle_key TEXT NOT NULL UNIQUE,
  relayer_address VARCHAR(42) NOT NULL,
  raw_bundle JSONB NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'web_api',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed')),
  claimed_at TIMESTAMPTZ,
  claimed_by VARCHAR(42),
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE relay_private_inbox
  ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(66);
ALTER TABLE relay_private_inbox
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE relay_private_inbox
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);

CREATE INDEX IF NOT EXISTS relay_private_inbox_relayer_status_idx
  ON relay_private_inbox(relayer_address, status, received_at);

-- This journal contains only immutable public transaction facts. It lets the
-- selected relayer retry a remote V4 checkpoint after a restart without ever
-- rebroadcasting the private Pool withdrawal.
CREATE TABLE IF NOT EXISTS relay_v4_execution_checkpoints (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'completePayout')),
  transaction_hash VARCHAR(66) NOT NULL UNIQUE,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step)
);

CREATE INDEX IF NOT EXISTS relay_v4_execution_checkpoints_relayer_idx
  ON relay_v4_execution_checkpoints(relayer_address, created_at);

-- A submission is recorded as soon as the node receives its transaction hash.
-- It is append-only evidence, not a success checkpoint: retries inspect its
-- receipt before deciding whether a replacement transaction is safe.
CREATE TABLE IF NOT EXISTS relay_v4_execution_submissions (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'completePayout')),
  transaction_hash VARCHAR(66) NOT NULL,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step, transaction_hash)
);

CREATE INDEX IF NOT EXISTS relay_v4_execution_submissions_lookup_idx
  ON relay_v4_execution_submissions(intent_hash, step, relayer_address, created_at DESC);

ALTER TABLE relay_v4_execution_checkpoints
  DROP CONSTRAINT IF EXISTS relay_v4_execution_checkpoints_step_check;
ALTER TABLE relay_v4_execution_checkpoints
  ADD CONSTRAINT relay_v4_execution_checkpoints_step_check CHECK (
    step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'completePayout')
  );

ALTER TABLE relay_v4_execution_submissions
  DROP CONSTRAINT IF EXISTS relay_v4_execution_submissions_step_check;
ALTER TABLE relay_v4_execution_submissions
  ADD CONSTRAINT relay_v4_execution_submissions_step_check CHECK (
    step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'completePayout')
  );

CREATE TABLE IF NOT EXISTS relay_v5_execution_checkpoints (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'proveCompletion', 'proveRelayRefund', 'claimRefund')),
  transaction_hash VARCHAR(66) NOT NULL UNIQUE,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step)
);

CREATE TABLE IF NOT EXISTS relay_v5_execution_submissions (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'proveCompletion', 'proveRelayRefund', 'claimRefund')),
  transaction_hash VARCHAR(66) NOT NULL,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step, transaction_hash)
);

CREATE INDEX IF NOT EXISTS relay_v5_execution_checkpoints_relayer_idx
  ON relay_v5_execution_checkpoints(relayer_address, created_at);
CREATE INDEX IF NOT EXISTS relay_v5_execution_submissions_lookup_idx
  ON relay_v5_execution_submissions(intent_hash, step, relayer_address, created_at DESC);

CREATE TABLE IF NOT EXISTS relay_v6_execution_checkpoints (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'proveCompletion', 'proveRelayRefund', 'claimRefund')),
  transaction_hash VARCHAR(66) NOT NULL UNIQUE,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step)
);

CREATE TABLE IF NOT EXISTS relay_v6_execution_submissions (
  intent_hash VARCHAR(66) NOT NULL,
  step VARCHAR(32) NOT NULL CHECK (step IN ('acceptQuote', 'poolWithdraw', 'confirmEscrowReceipt', 'submitPayout', 'proveCompletion', 'proveRelayRefund', 'claimRefund')),
  transaction_hash VARCHAR(66) NOT NULL,
  relayer_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (intent_hash, step, transaction_hash)
);

CREATE INDEX IF NOT EXISTS relay_v6_execution_checkpoints_relayer_idx
  ON relay_v6_execution_checkpoints(relayer_address, created_at);
CREATE INDEX IF NOT EXISTS relay_v6_execution_submissions_lookup_idx
  ON relay_v6_execution_submissions(intent_hash, step, relayer_address, created_at DESC);
`

const ADVISORY_LOCK_KEY = 1_609_393_249

export function getPendingExecutionPool() {
  if (!globalThis.__parlyPendingExecutionPool) {
    globalThis.__parlyPendingExecutionPool = new Pool({
      connectionString: requireEnv("DATABASE_URL")
    })
  }

  return globalThis.__parlyPendingExecutionPool
}

async function ensurePendingExecutionSchema() {
  if (!globalThis.__parlyPendingExecutionSchemaReady) {
    globalThis.__parlyPendingExecutionSchemaReady = getPendingExecutionPool()
      .query(PENDING_EXECUTION_SCHEMA)
      .then(() => undefined)
  }

  return globalThis.__parlyPendingExecutionSchemaReady
}

function buildPersistenceKey(record: PendingRelayerRecord) {
  if (record.submittedHash) {
    return `submitted:${record.submittedHash.toLowerCase()}`
  }

  if (record.nullifierHash) {
    return `nullifier:${record.nullifierHash.toLowerCase()}`
  }

  const raw = JSON.stringify(record.rawBundle)
  return `bundle:${createHash("sha256").update(raw).digest("hex")}`
}

function assertPayoutV4Checkpoint(value: PayoutV4LocalCheckpoint) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.intentHash)) throw new Error("V4 intentHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.transactionHash)) throw new Error("V4 transactionHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{40}$/u.test(value.relayerAddress)) throw new Error("V4 relayerAddress must be an address.")
}

function assertPayoutV5Checkpoint(value: PayoutV5LocalCheckpoint) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.intentHash)) throw new Error("V5 intentHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.transactionHash)) throw new Error("V5 transactionHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{40}$/u.test(value.relayerAddress)) throw new Error("V5 relayerAddress must be an address.")
}

function assertPayoutV6Checkpoint(value: PayoutV6LocalCheckpoint) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.intentHash)) throw new Error("V6 intentHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value.transactionHash)) throw new Error("V6 transactionHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{40}$/u.test(value.relayerAddress)) throw new Error("V6 relayerAddress must be an address.")
}

type PendingExecutionRow = {
  id: string
  persistence_key: string
  version: number
  recorded_at: string
  phase: PendingRelayerRecord["phase"]
  attempt: number
  relayer_address: `0x${string}`
  pool: `0x${string}` | null
  nullifier_hash: `0x${string}` | null
  submitted_hash: `0x${string}` | null
  approval_token: `0x${string}` | null
  approval_spender: `0x${string}` | null
  reason: string
  raw_bundle: unknown
}

function mapPendingRow(row: PendingExecutionRow): StoredPendingRelayerRecord {
  return {
    id: Number(row.id),
    persistenceKey: row.persistence_key,
    version: 1,
    recordedAt: Number(row.recorded_at),
    phase: row.phase,
    attempt: row.attempt,
    relayerAddress: row.relayer_address,
    pool: row.pool,
    nullifierHash: row.nullifier_hash,
    submittedHash: row.submitted_hash,
    approvalToken: row.approval_token,
    approvalSpender: row.approval_spender,
    reason: row.reason,
    rawBundle: row.raw_bundle
  }
}

export async function persistPendingExecution(record: PendingRelayerRecord) {
  await ensurePendingExecutionSchema()

  const persistenceKey = buildPersistenceKey(record)

  await getPendingExecutionPool().query(
    `
      INSERT INTO relay_pending_executions (
        persistence_key,
        version,
        recorded_at,
        phase,
        attempt,
        relayer_address,
        pool,
        nullifier_hash,
        submitted_hash,
        approval_token,
        approval_spender,
        reason,
        raw_bundle,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (persistence_key) DO UPDATE
      SET
        version = EXCLUDED.version,
        recorded_at = EXCLUDED.recorded_at,
        phase = EXCLUDED.phase,
        attempt = EXCLUDED.attempt,
        relayer_address = EXCLUDED.relayer_address,
        pool = EXCLUDED.pool,
        nullifier_hash = EXCLUDED.nullifier_hash,
        submitted_hash = EXCLUDED.submitted_hash,
        approval_token = EXCLUDED.approval_token,
        approval_spender = EXCLUDED.approval_spender,
        reason = EXCLUDED.reason,
        raw_bundle = EXCLUDED.raw_bundle,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      persistenceKey,
      record.version,
      record.recordedAt,
      record.phase,
      record.attempt,
      record.relayerAddress,
      record.pool,
      record.nullifierHash,
      record.submittedHash,
      record.approvalToken,
      record.approvalSpender,
      record.reason,
      JSON.stringify(record.rawBundle)
    ]
  )
}

export async function recordPayoutV4LocalCheckpoint(checkpoint: PayoutV4LocalCheckpoint) {
  assertPayoutV4Checkpoint(checkpoint)
  await ensurePendingExecutionSchema()
  const inserted = await getPendingExecutionPool().query<{ transaction_hash: string }>(
    `INSERT INTO relay_v4_execution_checkpoints (
       intent_hash, step, transaction_hash, relayer_address
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (intent_hash, step) DO NOTHING
     RETURNING transaction_hash`,
    [
      checkpoint.intentHash.toLowerCase(),
      checkpoint.step,
      checkpoint.transactionHash.toLowerCase(),
      checkpoint.relayerAddress.toLowerCase()
    ]
  )
  if (inserted.rows[0]) return { recorded: true as const }
  const existing = await getPendingExecutionPool().query<{ transaction_hash: string; relayer_address: string }>(
    `SELECT transaction_hash, relayer_address
     FROM relay_v4_execution_checkpoints
     WHERE intent_hash = $1 AND step = $2`,
    [checkpoint.intentHash.toLowerCase(), checkpoint.step]
  )
  if (
    existing.rows[0]?.transaction_hash.toLowerCase() !== checkpoint.transactionHash.toLowerCase() ||
    existing.rows[0]?.relayer_address.toLowerCase() !== checkpoint.relayerAddress.toLowerCase()
  ) {
    throw new Error("V4 local checkpoint already records a different transaction.")
  }
  return { recorded: false as const }
}

export async function recordPayoutV4LocalSubmission(submission: PayoutV4LocalSubmission) {
  assertPayoutV4Checkpoint(submission)
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `INSERT INTO relay_v4_execution_submissions (
       intent_hash, step, transaction_hash, relayer_address
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (intent_hash, step, transaction_hash) DO NOTHING`,
    [
      submission.intentHash.toLowerCase(),
      submission.step,
      submission.transactionHash.toLowerCase(),
      submission.relayerAddress.toLowerCase()
    ]
  )
}

export async function listPayoutV4LocalSubmissions(args: {
  intentHash: `0x${string}`
  step: PayoutV4LocalSubmission["step"]
  relayerAddress: `0x${string}`
}) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash)) throw new Error("V4 intentHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V4 relayerAddress must be an address.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash
     FROM relay_v4_execution_submissions
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3
     ORDER BY created_at DESC, transaction_hash DESC`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  return result.rows.map((row) => row.transaction_hash.toLowerCase() as `0x${string}`)
}

export async function getPayoutV4LocalCheckpoint(args: {
  intentHash: `0x${string}`
  step: PayoutV4LocalCheckpoint["step"]
  relayerAddress: `0x${string}`
}) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash)) throw new Error("V4 intentHash must be bytes32.")
  if (!/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V4 relayerAddress must be an address.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash
     FROM relay_v4_execution_checkpoints
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3
     LIMIT 1`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  const transactionHash = result.rows[0]?.transaction_hash
  return transactionHash ? { transactionHash: transactionHash.toLowerCase() as `0x${string}` } : null
}

export async function recordPayoutV5LocalCheckpoint(checkpoint: PayoutV5LocalCheckpoint) {
  assertPayoutV5Checkpoint(checkpoint)
  await ensurePendingExecutionSchema()
  const inserted = await getPendingExecutionPool().query<{ transaction_hash: string }>(
    `INSERT INTO relay_v5_execution_checkpoints (intent_hash, step, transaction_hash, relayer_address)
     VALUES ($1, $2, $3, $4) ON CONFLICT (intent_hash, step) DO NOTHING RETURNING transaction_hash`,
    [checkpoint.intentHash.toLowerCase(), checkpoint.step, checkpoint.transactionHash.toLowerCase(), checkpoint.relayerAddress.toLowerCase()]
  )
  if (inserted.rows[0]) return { recorded: true as const }
  const existing = await getPendingExecutionPool().query<{ transaction_hash: string; relayer_address: string }>(
    `SELECT transaction_hash, relayer_address FROM relay_v5_execution_checkpoints WHERE intent_hash = $1 AND step = $2`,
    [checkpoint.intentHash.toLowerCase(), checkpoint.step]
  )
  if (existing.rows[0]?.transaction_hash.toLowerCase() !== checkpoint.transactionHash.toLowerCase() ||
      existing.rows[0]?.relayer_address.toLowerCase() !== checkpoint.relayerAddress.toLowerCase()) {
    throw new Error("V5 local checkpoint already records a different transaction.")
  }
  return { recorded: false as const }
}

export async function recordPayoutV5LocalSubmission(submission: PayoutV5LocalSubmission) {
  assertPayoutV5Checkpoint(submission)
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `INSERT INTO relay_v5_execution_submissions (intent_hash, step, transaction_hash, relayer_address)
     VALUES ($1, $2, $3, $4) ON CONFLICT (intent_hash, step, transaction_hash) DO NOTHING`,
    [submission.intentHash.toLowerCase(), submission.step, submission.transactionHash.toLowerCase(), submission.relayerAddress.toLowerCase()]
  )
}

export async function listPayoutV5LocalSubmissions(args: { intentHash: `0x${string}`; step: PayoutV5ExecutionStep; relayerAddress: `0x${string}` }) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash) || !/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V5 local submission lookup is invalid.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash FROM relay_v5_execution_submissions
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3 ORDER BY created_at DESC, transaction_hash DESC`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  return result.rows.map((row) => row.transaction_hash.toLowerCase() as `0x${string}`)
}

export async function getPayoutV5LocalCheckpoint(args: { intentHash: `0x${string}`; step: PayoutV5ExecutionStep; relayerAddress: `0x${string}` }) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash) || !/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V5 local checkpoint lookup is invalid.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash FROM relay_v5_execution_checkpoints
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3 LIMIT 1`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  return result.rows[0]?.transaction_hash ? { transactionHash: result.rows[0].transaction_hash.toLowerCase() as `0x${string}` } : null
}

export async function recordPayoutV6LocalCheckpoint(checkpoint: PayoutV6LocalCheckpoint) {
  assertPayoutV6Checkpoint(checkpoint)
  await ensurePendingExecutionSchema()
  const inserted = await getPendingExecutionPool().query<{ transaction_hash: string }>(
    `INSERT INTO relay_v6_execution_checkpoints (intent_hash, step, transaction_hash, relayer_address)
     VALUES ($1, $2, $3, $4) ON CONFLICT (intent_hash, step) DO NOTHING RETURNING transaction_hash`,
    [checkpoint.intentHash.toLowerCase(), checkpoint.step, checkpoint.transactionHash.toLowerCase(), checkpoint.relayerAddress.toLowerCase()]
  )
  if (inserted.rows[0]) return { recorded: true as const }
  const existing = await getPendingExecutionPool().query<{ transaction_hash: string; relayer_address: string }>(
    `SELECT transaction_hash, relayer_address FROM relay_v6_execution_checkpoints WHERE intent_hash = $1 AND step = $2`,
    [checkpoint.intentHash.toLowerCase(), checkpoint.step]
  )
  if (existing.rows[0]?.transaction_hash.toLowerCase() !== checkpoint.transactionHash.toLowerCase() ||
      existing.rows[0]?.relayer_address.toLowerCase() !== checkpoint.relayerAddress.toLowerCase()) {
    throw new Error("V6 local checkpoint already records a different transaction.")
  }
  return { recorded: false as const }
}

export async function recordPayoutV6LocalSubmission(submission: PayoutV6LocalSubmission) {
  assertPayoutV6Checkpoint(submission)
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `INSERT INTO relay_v6_execution_submissions (intent_hash, step, transaction_hash, relayer_address)
     VALUES ($1, $2, $3, $4) ON CONFLICT (intent_hash, step, transaction_hash) DO NOTHING`,
    [submission.intentHash.toLowerCase(), submission.step, submission.transactionHash.toLowerCase(), submission.relayerAddress.toLowerCase()]
  )
}

export async function listPayoutV6LocalSubmissions(args: { intentHash: `0x${string}`; step: PayoutV6ExecutionStep; relayerAddress: `0x${string}` }) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash) || !/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V6 local submission lookup is invalid.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash FROM relay_v6_execution_submissions
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3 ORDER BY created_at DESC, transaction_hash DESC`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  return result.rows.map((row) => row.transaction_hash.toLowerCase() as `0x${string}`)
}

export async function getPayoutV6LocalCheckpoint(args: { intentHash: `0x${string}`; step: PayoutV6ExecutionStep; relayerAddress: `0x${string}` }) {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(args.intentHash) || !/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) throw new Error("V6 local checkpoint lookup is invalid.")
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{ transaction_hash: `0x${string}` }>(
    `SELECT transaction_hash FROM relay_v6_execution_checkpoints
     WHERE intent_hash = $1 AND step = $2 AND relayer_address = $3 LIMIT 1`,
    [args.intentHash.toLowerCase(), args.step, args.relayerAddress.toLowerCase()]
  )
  return result.rows[0]?.transaction_hash ? { transactionHash: result.rows[0].transaction_hash.toLowerCase() as `0x${string}` } : null
}

export async function listPayoutV6DownstreamCheckpoints(args: {
  relayerAddress: `0x${string}`
}) {
  if (!/^0x[a-fA-F0-9]{40}$/u.test(args.relayerAddress)) {
    throw new Error("V6 local checkpoint lookup is invalid.")
  }
  await ensurePendingExecutionSchema()
  const result = await getPendingExecutionPool().query<{
    intent_hash: `0x${string}`
    transaction_hash: `0x${string}`
  }>(
    `SELECT intent_hash, transaction_hash
       FROM relay_v6_execution_checkpoints submitted
      WHERE step = 'submitPayout'
        AND relayer_address = $1
        AND NOT EXISTS (
          SELECT 1
            FROM relay_v6_execution_checkpoints terminal
           WHERE terminal.intent_hash = submitted.intent_hash
             AND terminal.relayer_address = submitted.relayer_address
             AND terminal.step IN ('proveCompletion', 'proveRelayRefund')
        )
      ORDER BY created_at ASC
      LIMIT 50`,
    [args.relayerAddress.toLowerCase()]
  )
  return result.rows.map((row) => ({
    intentHash: row.intent_hash.toLowerCase() as `0x${string}`,
    transactionHash: row.transaction_hash.toLowerCase() as `0x${string}`
  }))
}

export async function listPendingExecutions(): Promise<StoredPendingRelayerRecord[]> {
  await ensurePendingExecutionSchema()

  const result = await getPendingExecutionPool().query<PendingExecutionRow>(
    `
      SELECT
        id,
        persistence_key,
        version,
        recorded_at,
        phase,
        attempt,
        relayer_address,
        pool,
        nullifier_hash,
        submitted_hash,
        approval_token,
        approval_spender,
        reason,
        raw_bundle
      FROM relay_pending_executions
      ORDER BY recorded_at ASC, id ASC
    `
  )

  return result.rows.map(mapPendingRow)
}

export async function archiveResolvedPendingExecution(
  record: StoredPendingRelayerRecord,
  resolution: PendingRelayerResolution
) {
  await ensurePendingExecutionSchema()

  const client = await getPendingExecutionPool().connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `
        INSERT INTO relay_pending_execution_archive (
          pending_execution_id,
          persistence_key,
          version,
          recorded_at,
          phase,
          attempt,
          relayer_address,
          pool,
          nullifier_hash,
          submitted_hash,
          approval_token,
          approval_spender,
          reason,
          raw_bundle,
          resolved_at,
          resolution,
          cleanup_attempted,
          cleanup_succeeded
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18
        )
        ON CONFLICT (persistence_key) DO NOTHING
      `,
      [
        record.id,
        record.persistenceKey,
        record.version,
        record.recordedAt,
        record.phase,
        record.attempt,
        record.relayerAddress,
        record.pool,
        record.nullifierHash,
        record.submittedHash,
        record.approvalToken,
        record.approvalSpender,
        record.reason,
        JSON.stringify(record.rawBundle),
        resolution.resolvedAt,
        resolution.resolution,
        resolution.cleanupAttempted,
        resolution.cleanupSucceeded
      ]
    )
    await client.query(`DELETE FROM relay_pending_executions WHERE id = $1`, [record.id])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function acquirePendingExecutionLock(): Promise<(() => Promise<void>) | null> {
  await ensurePendingExecutionSchema()

  const client = await getPendingExecutionPool().connect()
  try {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [ADVISORY_LOCK_KEY]
    )

    if (!result.rows[0]?.locked) {
      client.release()
      console.log("Pending reconcile lock already held in Postgres, skipping this pass.")
      return null
    }

    return async () => {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY])
      } finally {
        client.release()
      }
    }
  } catch (error) {
    client.release()
    throw error
  }
}

function buildInboxBundleKey(bundle: unknown) {
  return createHash("sha256").update(JSON.stringify(bundle)).digest("hex")
}

function normalizeRelayAddress(value: `0x${string}`) {
  return value.toLowerCase() as `0x${string}`
}

type RelayInboxRow = {
  id: string
  bundle_key: string
  relayer_address: `0x${string}`
  raw_bundle: unknown
  source: string
}

export async function claimRelayInboxBatch(
  relayerAddress: `0x${string}`,
  limit = 10
): Promise<RelayInboxRecord[]> {
  await ensurePendingExecutionSchema()
  const normalizedRelayerAddress = normalizeRelayAddress(relayerAddress)

  const client = await getPendingExecutionPool().connect()
  try {
    await client.query("BEGIN")
    const result = await client.query<RelayInboxRow>(
      `
        WITH picked AS (
          SELECT id
          FROM relay_private_inbox
          WHERE relayer_address = $1
            AND status = 'pending'
            AND next_attempt_at <= CURRENT_TIMESTAMP
          ORDER BY received_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE relay_private_inbox inbox
        SET
          status = 'processing',
          claimed_at = CURRENT_TIMESTAMP,
          claimed_by = $1,
          processing_error = NULL
        FROM picked
        WHERE inbox.id = picked.id
        RETURNING inbox.id, inbox.bundle_key, inbox.relayer_address, inbox.raw_bundle, inbox.source
      `,
      [normalizedRelayerAddress, limit]
    )
    await client.query("COMMIT")
    return result.rows.map((row) => ({
      id: Number(row.id),
      bundleKey: row.bundle_key,
      relayerAddress: row.relayer_address,
      rawBundle: row.raw_bundle,
      source: row.source
    }))
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function markRelayInboxProcessed(id: number, processingError: string | null = null) {
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `
      UPDATE relay_private_inbox
      SET
        status = 'processed',
        processed_at = CURRENT_TIMESTAMP,
        processing_error = $2
      WHERE id = $1
    `,
    [id, processingError?.slice(0, 512) ?? null]
  )
}

export async function retainPoolV4RelayExecution(args: { callHash: `0x${string}`; pool: `0x${string}`; relayer: `0x${string}`; nullifiers: `0x${string}`[] }, reserve = true) {
  if (!/^0x[a-f0-9]{64}$/.test(args.callHash) || !/^0x[a-fA-F0-9]{40}$/.test(args.pool) || !/^0x[a-fA-F0-9]{40}$/.test(args.relayer) || args.nullifiers.length < 1 || args.nullifiers.length > 4 || args.nullifiers.some(n => !/^0x[a-f0-9]{64}$/.test(n))) throw Error("PoolV4 execution identity is invalid.")
  await ensurePendingExecutionSchema()
  const db = await getPendingExecutionPool().connect()
  try {
    await db.query("BEGIN")
    for (const nf of [...args.nullifiers].sort()) await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["pool-v4:" + args.pool.toLowerCase() + ":" + nf])
    const retired = await db.query("SELECT call_hash FROM relay_pool_v4_executions WHERE call_hash=$1 AND released_at IS NOT NULL", [args.callHash])
    if (retired.rows.length) throw Error("PoolV4 original call is permanently retired.")
    const prior = await db.query<{ call_hash: string; relayer_address: string; transaction_hash: `0x${string}` | null }>("SELECT call_hash,relayer_address,transaction_hash FROM relay_pool_v4_executions WHERE pool_address=$1 AND released_at IS NULL AND nullifiers && $2::text[]", [args.pool.toLowerCase(), args.nullifiers])
    if (prior.rows.length) {
      if (prior.rows.length !== 1 || prior.rows[0]!.call_hash !== args.callHash || prior.rows[0]!.relayer_address !== args.relayer.toLowerCase()) throw Error("PoolV4 inputs already have a retained execution.")
      await db.query("COMMIT")
      return { fresh: false, transactionHash: prior.rows[0]!.transaction_hash }
    }
    if (reserve) await db.query("INSERT INTO relay_pool_v4_executions(call_hash,relayer_address,pool_address,nullifiers) VALUES($1,$2,$3,$4)", [args.callHash, args.relayer.toLowerCase(), args.pool.toLowerCase(), args.nullifiers])
    await db.query("COMMIT")
    return { fresh: true, transactionHash: null }
  } catch (e) { await db.query("ROLLBACK"); throw e } finally { db.release() }
}

// Only the V7 expired-lease verifier may release this exact row; original signatures remain fenced.
export async function retirePayoutV7SourceLock(args: { callHash: `0x${string}`; pool: `0x${string}`; relayer: `0x${string}`; nullifiers: `0x${string}`[] }, verify: () => Promise<{ sourceCallHash: string; pool: string; nullifiers: string[]; blockNumber: string; blockHash: string; blockTimestamp: string }>) {
  if (!/^0x[a-f0-9]{64}$/.test(args.callHash) || !/^0x[a-fA-F0-9]{40}$/.test(args.pool) || !/^0x[a-fA-F0-9]{40}$/.test(args.relayer) || args.nullifiers.length < 1 || args.nullifiers.length > 4 || new Set(args.nullifiers).size !== args.nullifiers.length || args.nullifiers.some(n => !/^0x[a-f0-9]{64}$/.test(n))) throw Error("V7 retirement identity is invalid.")
  await ensurePendingExecutionSchema()
  const db = await getPendingExecutionPool().connect()
  try {
    await db.query("BEGIN")
    for (const nf of [...args.nullifiers].sort()) await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["pool-v4:" + args.pool.toLowerCase() + ":" + nf])
    const result = await db.query("SELECT * FROM relay_pool_v4_executions WHERE call_hash=$1 FOR UPDATE", [args.callHash]), row = result.rows[0]
    if (row && (row.pool_address !== args.pool.toLowerCase() || row.relayer_address !== args.relayer.toLowerCase() || [...row.nullifiers].sort().join() !== [...args.nullifiers].sort().join())) throw Error("V7 retired source binding changed.")
    if (row?.released_at) { await db.query("COMMIT"); return row.retirement_proof }
    const proof = await verify()
    if (proof.sourceCallHash !== args.callHash || proof.pool.toLowerCase() !== args.pool.toLowerCase() || [...proof.nullifiers].sort().join() !== [...args.nullifiers].sort().join() || !/^0x[a-f0-9]{64}$/.test(proof.blockHash) || !/^[1-9][0-9]*$/.test(proof.blockNumber) || !/^[1-9][0-9]*$/.test(proof.blockTimestamp)) throw Error("V7 retirement proof is not bound to the exact lock.")
    if (row) await db.query("UPDATE relay_pool_v4_executions SET released_at=CURRENT_TIMESTAMP,retirement_proof=$2 WHERE call_hash=$1", [args.callHash, JSON.stringify(proof)])
    else await db.query("INSERT INTO relay_pool_v4_executions(call_hash,relayer_address,pool_address,nullifiers,released_at,retirement_proof) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP,$5)", [args.callHash, args.relayer.toLowerCase(), args.pool.toLowerCase(), args.nullifiers, JSON.stringify(proof)])
    await db.query("COMMIT"); return proof
  } catch (e) { await db.query("ROLLBACK"); throw e } finally { db.release() }
}

export async function recordPoolV4RelaySubmission(args: { callHash: `0x${string}`; relayer: `0x${string}`; hash: `0x${string}`; bundleKey: string }) {
  if (!/^0x[a-f0-9]{64}$/.test(args.hash) || !/^0x[a-f0-9]{64}$/.test(args.callHash) || !/^[a-f0-9]{64}$/.test(args.bundleKey)) throw Error("PoolV4 submission identity is invalid.")
  await ensurePendingExecutionSchema()
  const db = await getPendingExecutionPool().connect()
  try {
    await db.query("BEGIN")
    const updated = await db.query("UPDATE relay_pool_v4_executions SET transaction_hash=$3 WHERE call_hash=$1 AND relayer_address=$2 AND (transaction_hash IS NULL OR transaction_hash=$3) RETURNING call_hash", [args.callHash, args.relayer.toLowerCase(), args.hash])
    if (updated.rows.length !== 1) throw Error("PoolV4 retained execution no longer matches.")
    await db.query("UPDATE relay_private_inbox SET transaction_hash=$3 WHERE bundle_key=$1 AND relayer_address=$2 AND (transaction_hash IS NULL OR transaction_hash=$3)", [args.bundleKey, args.relayer.toLowerCase(), args.hash])
    await db.query("COMMIT")
  } catch (e) { await db.query("ROLLBACK"); throw e } finally { db.release() }
}

export async function resetRelayInboxClaim(id: number, errorMessage: string, retryAfterSeconds = 10) {
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 3600) {
    throw new Error("relay inbox retry delay must be between 1 and 3600 seconds.")
  }
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `
      UPDATE relay_private_inbox
      SET
        status = 'pending',
        processing_error = $2,
        next_attempt_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'),
        attempt_count = attempt_count + 1
      WHERE id = $1
    `,
    [id, errorMessage.slice(0, 512), retryAfterSeconds]
  )
}

export async function enqueueRelayInboxBundle(args: {
  relayerAddress: `0x${string}`
  rawBundle: unknown
  source?: string
}) {
  await ensurePendingExecutionSchema()
  const bundleKey = buildInboxBundleKey(args.rawBundle)
  await getPendingExecutionPool().query(
    `
      INSERT INTO relay_private_inbox (
        bundle_key,
        relayer_address,
        raw_bundle,
        source
      )
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (bundle_key) DO NOTHING
    `,
    [
      bundleKey,
      normalizeRelayAddress(args.relayerAddress),
      JSON.stringify(args.rawBundle),
      args.source ?? "web_api"
    ]
  )
  return bundleKey
}
