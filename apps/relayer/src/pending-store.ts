import { createHash } from "node:crypto"
import pg from "pg"
import { requireEnv } from "@parly/env-utils"

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

declare global {
  var __parlyPendingExecutionPool: pg.Pool | undefined
  var __parlyPendingExecutionSchemaReady: Promise<void> | undefined
}

const PENDING_EXECUTION_SCHEMA = `
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
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS relay_private_inbox_relayer_status_idx
  ON relay_private_inbox(relayer_address, status, received_at);
`

const ADVISORY_LOCK_KEY = 1_609_393_249

function getPendingExecutionPool() {
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

export async function markRelayInboxProcessed(id: number) {
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `
      UPDATE relay_private_inbox
      SET
        status = 'processed',
        processed_at = CURRENT_TIMESTAMP,
        processing_error = NULL
      WHERE id = $1
    `,
    [id]
  )
}

export async function resetRelayInboxClaim(id: number, errorMessage: string) {
  await ensurePendingExecutionSchema()
  await getPendingExecutionPool().query(
    `
      UPDATE relay_private_inbox
      SET
        status = 'pending',
        processing_error = $2
      WHERE id = $1
    `,
    [id, errorMessage]
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
