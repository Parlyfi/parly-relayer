import { getPendingExecutionPool } from "../pending-store.js"
import { keccak256 } from "viem"
import type { PayoutV7CallStore, PayoutV7SignedCall } from "./payout-v7-worker.js"
import type { RelayRecoveryCheckpointV7, RelayRecoveryStoreV7 } from "./payout-v7-relay-recovery.js"

export const payoutV7WorkerSchema = `CREATE TABLE IF NOT EXISTS relay_v7_signed_calls (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, calldata TEXT NOT NULL,
  signed_transaction TEXT NOT NULL, transaction_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`
export function createPayoutV7WorkerStore(db = getPendingExecutionPool()): PayoutV7CallStore & RelayRecoveryStoreV7 & { list(prefix: string): Promise<PayoutV7SignedCall[]> } {
  const ready = db.query(payoutV7WorkerSchema).then(() => db.query(
    "CREATE TABLE IF NOT EXISTS relay_v7_recovery_jobs (id TEXT PRIMARY KEY, checkpoint JSONB NOT NULL)"
  ))
  const open = (row: any): PayoutV7SignedCall => {
    if (keccak256(row.signed_transaction) !== row.transaction_hash) throw Error("V7 retained signed transaction is corrupt.")
    return { id: row.id, to: row.target, data: row.calldata, serializedTransaction: row.signed_transaction, transactionHash: row.transaction_hash }
  }
  return {
    async readRecovery(id) {
      await ready
      const result = await db.query("SELECT checkpoint FROM relay_v7_recovery_jobs WHERE id=$1", [id])
      return result.rows[0]?.checkpoint as RelayRecoveryCheckpointV7 ?? null
    },
    async saveRecovery(id, value) {
      await ready
      await db.query("INSERT INTO relay_v7_recovery_jobs(id,checkpoint) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET checkpoint=EXCLUDED.checkpoint WHERE relay_v7_recovery_jobs.checkpoint->>'jobId' IS NULL", [id, JSON.stringify(value)])
    },
    async removeRecovery(id) {
      await ready
      await db.query("DELETE FROM relay_v7_recovery_jobs WHERE id=$1", [id])
    },
    async read(id) {
      await ready
      const result = await db.query("SELECT * FROM relay_v7_signed_calls WHERE id=$1", [id])
      const row = result.rows[0]
      if (!row) return null
      return open(row)
    },
    async retain(row: PayoutV7SignedCall) {
      await ready
      if (keccak256(row.serializedTransaction) !== row.transactionHash) throw Error("V7 signed transaction hash mismatch.")
      const result = await db.query("INSERT INTO relay_v7_signed_calls(id,target,calldata,signed_transaction,transaction_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id", [row.id, row.to.toLowerCase(), row.data, row.serializedTransaction, row.transactionHash])
      return result.rows.length === 1
    },
    async list(prefix) {
      await ready
      const result = await db.query("SELECT * FROM relay_v7_signed_calls WHERE starts_with(id,$1) ORDER BY id LIMIT 64", [prefix])
      if (result.rows.length >= 64) throw Error("V7 signed group is ambiguous.")
      return result.rows.map(open)
    }
  }
}
