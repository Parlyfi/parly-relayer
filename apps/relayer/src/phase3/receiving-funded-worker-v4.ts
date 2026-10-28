import { createHash, randomBytes } from "node:crypto"
import { assertReceivingProfileV4, receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"

type Db = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>; release(): void }
export type ReceivingFundedJobV4 = Readonly<{ attemptId: `0x${string}`; observationId: `0x${string}`; blockHash: `0x${string}` }>
export type ReceivingFundedHostV4 = {
  profileDigest: string
  assertFunded(job: ReceivingFundedJobV4): Promise<void>
  prepare(job: ReceivingFundedJobV4, assertLease: () => Promise<void>): Promise<{ status: "pending" | "prepared" }>
  assertPrepared(job: ReceivingFundedJobV4): Promise<void>
}
type Row = { attempt_id: `0x${string}`; observation_id: `0x${string}`; block_hash: `0x${string}` }
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: confirmed-funded V4 preparation") }

export function createReceivingFundedWorkerV4(args: {
  pool: { connect(): Promise<Db> }; profile: ReceivingProfileV4; host: ReceivingFundedHostV4; workerId: string; leaseMs: number
}) {
  const profile = structuredClone(args.profile), { pool, host, workerId, leaseMs } = args
  assertReceivingProfileV4(profile)
  const digest = createHash("sha256").update(receivingProfileJsonV4(profile)).digest("hex")
  check(host?.profileDigest === digest && [host.assertFunded, host.prepare, host.assertPrepared].every(fn => typeof fn === "function") && typeof workerId === "string" && /^[a-zA-Z0-9:_-]{1,120}$/.test(workerId) && Number.isSafeInteger(leaseMs) && leaseMs >= 3000 && leaseMs <= 600000)
  const values = [digest, profile.chainId, profile.master.toLowerCase(), String(profile.settlementDomain), profile.environment.slice(2), JSON.stringify(profile.assets.map(a => ({ id: a.assetId, token: a.token.toLowerCase(), pool: a.pool.toLowerCase(), sources: a.sourceChainIds.map(String) })))]
  // Historical originals, never current/active publications: payment was already accepted.
  const eligible = `SELECT a.attempt_id,f.observation_id,f.block_hash
    FROM phase3_private.receiving_attempts_v4 a
    JOIN phase3_private.receiving_pending_v4 s ON s.attempt_id=a.attempt_id
    JOIN phase3_private.payment_attempts p ON p.internal_payment_attempt_id=a.attempt_id
    JOIN phase3_private.one_time_funding_observations f ON f.internal_payment_attempt_id=a.attempt_id
    WHERE a.profile_digest=$1 AND p.one_time_chain_id=$2 AND f.chain_id=$2
      AND p.one_time_master_address=$3 AND f.master_address=$3
      AND p.one_time_settlement_domain_id=$4::numeric AND p.one_time_environment=$5
      AND ((p.route_kind='direct_tempo_deposit' AND p.source_chain_id=$2)
        OR (p.route_kind='relay_multichain_deposit' AND p.source_chain_id<>$2)) AND p.expires_at>CURRENT_TIMESTAMP
      AND EXISTS (SELECT 1 FROM jsonb_to_recordset($6::jsonb) AS assets(id INTEGER,token TEXT,pool TEXT,sources JSONB)
        WHERE assets.id=p.asset_id AND assets.token=lower(p.tempo_token_address) AND assets.pool=lower(p.pool_address)
          AND p.source_chain_id::text IN (SELECT jsonb_array_elements_text(assets.sources)))
      AND ((a.publication_id IS NULL AND p.one_time_publication_id IS NULL AND p.payment_context='shield_self_funding')
        OR (a.publication_id=p.one_time_publication_id AND p.payment_context IN ('privacy_link_one_time_address','privacy_link_pay_with_wallet')))
      AND f.token_address=lower(p.tempo_token_address) AND f.virtual_address=lower(p.tempo_virtual_address)
      AND f.amount_base_units=p.amount_base_units::numeric AND f.amount_base_units>0
      AND f.classification='eligible' AND f.confirmation_status='confirmed' AND f.verified_at IS NOT NULL
      AND f.block_hash ~ '^0x[a-f0-9]{64}$'
      AND 1=(SELECT count(*) FROM phase3_private.one_time_funding_observations other
        WHERE other.internal_payment_attempt_id=a.attempt_id AND other.chain_id=$2 AND other.master_address=$3
          AND other.classification='eligible' AND other.confirmation_status='confirmed' AND other.verified_at IS NOT NULL)`
  async function connection<T>(fn: (db: Db) => Promise<T>) { const db = await pool.connect(); try { return await fn(db) } finally { db.release() } }
  return {
    async runOnce() {
      let job: ReceivingFundedJobV4 | undefined, token: string | undefined
      let timer: ReturnType<typeof setInterval> | undefined, renewal: Promise<void> | undefined, leaseLost = false
      try {
        token = createHash("sha256").update(randomBytes(32)).digest("hex")
        const row = await connection(async db => {
          await db.query("BEGIN")
          try {
            await db.query(`INSERT INTO phase3_private.receiving_funded_work_v4(profile_digest,attempt_id,observation_id,block_hash)
              ${eligible.replace("SELECT a.attempt_id", "SELECT $1,a.attempt_id")}
              ON CONFLICT(profile_digest,attempt_id) DO NOTHING`, values)
            const result = await db.query<Row>(`WITH eligible AS (${eligible}), selected AS (
              SELECT w.attempt_id FROM phase3_private.receiving_funded_work_v4 w
              JOIN eligible e ON e.attempt_id=w.attempt_id AND e.observation_id=w.observation_id AND e.block_hash=w.block_hash
              WHERE w.profile_digest=$1 AND w.status<>'prepared'
                AND (w.lease_expires_at IS NULL OR w.lease_expires_at<=CURRENT_TIMESTAMP)
              ORDER BY w.checked_at NULLS FIRST,w.created_at,w.attempt_id FOR UPDATE OF w SKIP LOCKED LIMIT 1)
              UPDATE phase3_private.receiving_funded_work_v4 w SET status='leased',lease_token_hash=$7,
                worker_id=$8,lease_expires_at=CURRENT_TIMESTAMP+$9::bigint*INTERVAL '1 millisecond',checked_at=CURRENT_TIMESTAMP
              FROM selected WHERE w.profile_digest=$1 AND w.attempt_id=selected.attempt_id
              RETURNING w.attempt_id,w.observation_id,w.block_hash`, [...values, token, workerId, leaseMs])
            check(result.rows.length <= 1); await db.query("COMMIT"); return result.rows[0]
          } catch (e) { await db.query("ROLLBACK").catch(() => undefined); throw e }
        })
        if (!row) return { status: "idle" as const }
        job = Object.freeze({ attemptId: row.attempt_id, observationId: row.observation_id, blockHash: row.block_hash })
        const held = job, leaseToken = token
        const assertLease = async () => {
          check(!leaseLost)
          const result = await connection(db => db.query(`WITH eligible AS (${eligible})
            UPDATE phase3_private.receiving_funded_work_v4 w
            SET lease_expires_at=CURRENT_TIMESTAMP+$10::bigint*INTERVAL '1 millisecond'
            FROM eligible e WHERE w.profile_digest=$1 AND w.attempt_id=$7 AND w.lease_token_hash=$8
              AND w.worker_id=$9 AND w.status='leased' AND w.lease_expires_at>CURRENT_TIMESTAMP
              AND e.attempt_id=w.attempt_id AND e.observation_id=w.observation_id AND e.block_hash=w.block_hash
            RETURNING w.attempt_id`, [...values, held.attemptId, leaseToken, workerId, leaseMs]))
          check(result.rows.length === 1)
        }
        timer = setInterval(() => {
          if (!renewal) renewal = assertLease().catch(() => { leaseLost = true }).finally(() => { renewal = undefined })
        }, Math.max(1000, Math.floor(leaseMs / 3)))
        timer.unref()
        await assertLease(); await host.assertFunded(held); await assertLease()
        const result = await host.prepare(held, assertLease)
        check(result?.status === "pending" || result?.status === "prepared")
        await assertLease(); await host.assertFunded(held)
        if (result.status === "prepared") await host.assertPrepared(held)
        await assertLease()
        const updated = await connection(db => db.query(`UPDATE phase3_private.receiving_funded_work_v4
          SET status=$5,lease_token_hash=NULL,worker_id=NULL,lease_expires_at=NULL
          WHERE profile_digest=$1 AND attempt_id=$2 AND lease_token_hash=$3 AND worker_id=$4
            AND status='leased' AND lease_expires_at>CURRENT_TIMESTAMP RETURNING attempt_id`,
        [digest, held.attemptId, leaseToken, workerId, result.status === "prepared" ? "prepared" : "queued"]))
        check(updated.rows.length === 1)
        return { status: result.status, attemptId: held.attemptId }
      } catch {
        if (job && token) await connection(db => db.query(`UPDATE phase3_private.receiving_funded_work_v4
          SET status='queued',lease_token_hash=NULL,worker_id=NULL,lease_expires_at=NULL
          WHERE profile_digest=$1 AND attempt_id=$2 AND lease_token_hash=$3 AND worker_id=$4 AND status='leased'`,
        [digest, job!.attemptId, token, workerId])).catch(() => undefined)
        throw Error("UNAVAILABLE: confirmed-funded V4 preparation")
      } finally { if (timer) clearInterval(timer); await renewal }
    }
  }
}
