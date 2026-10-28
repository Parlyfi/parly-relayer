import { createDecipheriv, createHash } from "node:crypto"

type Db = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> }
export type ReceivingPendingContextV4 = { attempt_id: string; preparation_digest: string; profile_digest: string }
type Sealed = { ciphertext: Uint8Array; iv: Uint8Array; auth_tag: Uint8Array; payload_hash: string; key_version: string }
function check(ok: unknown): asserts ok { if (!ok) throw Error("Recovery material is unavailable.") }
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable)
  if (!v || typeof v !== "object") return v
  return Object.fromEntries(Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => [k, stable((v as Record<string, unknown>)[k])]))
}
export const receivingPendingDigestV4 = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex")
export function receivingPendingAadV4(c: ReceivingPendingContextV4, version: string) {
  check(/^0x[a-f0-9]{64}$/.test(c.attempt_id) && [c.preparation_digest, c.profile_digest].every(h => /^[a-f0-9]{64}$/.test(h)) && /^[a-zA-Z0-9_-]{1,32}$/.test(version))
  return Buffer.from(JSON.stringify(["Parly retained receiving payment", 4, c.attempt_id, c.preparation_digest, c.profile_digest, version]))
}
export async function readReceivingPendingV4(args: { db: Db; attemptId: string; encryptionKey(version: string): Buffer }) {
  check(/^0x[a-f0-9]{64}$/.test(args.attemptId))
  const rows = await args.db.query<ReceivingPendingContextV4 & Sealed>(`SELECT a.attempt_id,a.preparation_digest,a.profile_digest,s.ciphertext,s.iv,s.auth_tag,s.payload_hash,s.key_version
    FROM phase3_private.receiving_attempts_v4 a JOIN phase3_private.receiving_pending_v4 s ON s.attempt_id=a.attempt_id WHERE a.attempt_id=$1`, [args.attemptId])
  check(rows.rows.length === 1)
  const row = rows.rows[0], key = args.encryptionKey(row.key_version)
  check(key.length === 32 && row.iv.length === 12 && row.auth_tag.length === 16 && row.ciphertext.length <= 16384)
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, row.iv); cipher.setAAD(receivingPendingAadV4(row, row.key_version)); cipher.setAuthTag(Buffer.from(row.auth_tag))
    const value: unknown = JSON.parse(Buffer.concat([cipher.update(row.ciphertext), cipher.final()]).toString("utf8"))
    check(receivingPendingDigestV4(value) === row.payload_hash); return value
  } catch { throw Error("Recovery material is unavailable.") }
}
