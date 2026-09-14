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
