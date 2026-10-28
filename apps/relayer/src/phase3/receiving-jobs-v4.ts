import { createHash } from "node:crypto"
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, recoverAddress, toHex, type Abi, type Address, type Hex } from "viem"
import { Actions, Transaction } from "viem/tempo"
import { parlyVirtualDepositMasterV2Abi } from "@parly/protocol-abis"
import { assertReceivingProfileV4, receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { costCoveringRelayReward } from "./relay-reward.js"

type Db = { query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>; release(): void }
type Kind = "publication" | "preparation" | "registration" | "observation" | "finalization"
type Request = { to: Address; data: Hex; rewardMicro: bigint }
type Subject = {
  kind: Kind; subjectId: string
  revision?: Hex
  readRequest(db?: Db): Promise<Request | null>
  assertFunded(db?: Db): Promise<void>
  assertLease(): Promise<void>
}
type Row = { kind: Kind; subject_id: string; revision_hash: Hex; sender: string; profile_digest: string; chain_id: number; nonce_key: string; nonce: string; to_address: Address; calldata: Hex; reward_micro: string; raw_transaction: `0x76${string}`; tx_hash: Hex }
type Rpc = (input: { method: string; params: unknown[] }) => Promise<unknown>
const prefixAbi = parseAbi(["function prepare(bytes32,uint8,uint256[13],uint256)", "function register(address,uint256,uint64,uint64,uint8,uint64,bytes,bytes,uint256[9])"])
const masterAbi = parlyVirtualDepositMasterV2Abi as unknown as Abi
const names = { publication: "register", preparation: "prepare", registration: "registerAttemptWithAuthorization", observation: "recordDepositObservationWithAttestation", finalization: "finalizeVirtualDeposit" }
const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const address = (v: unknown): v is Address => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v) && BigInt(v) !== 0n
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x[a-f0-9]{64}$/.test(v)
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
class Unavailable extends Error {}
function check(ok: unknown, why: string): asserts ok { if (!ok) throw new Unavailable("UNAVAILABLE: " + why) }

// Only the trusted confirmed-funding host supplies requests, guards and signing capabilities.
export function createReceivingJobsV4(args: {
  pool: { connect(): Promise<Db> }; profile: ReceivingProfileV4; sender: Address; feeToken: Address
  rpc: Rpc; broadcast(raw: Hex): Promise<Hex>
}) {
  const profile = structuredClone(args.profile), { sender, pool, rpc, broadcast, feeToken } = args
  assertReceivingProfileV4(profile)
  check(address(sender) && address(feeToken) && profile.assets.some(a => same(a.token, feeToken)), "native job signer or fee token")
  const profileDigest = createHash("sha256").update(receivingProfileJsonV4(profile)).digest("hex")
  // Unused retained signatures must not block unrelated funded jobs or spend gas to clear a lane.
  function nonceKey(s: Subject) {
    subject(s)
    const key = BigInt(keccak256(toHex("PARLY_RECEIVING_JOB_V4:" + profileDigest + ":" + sender.toLowerCase() + ":" + s.kind + ":" + s.subjectId + (s.revision ? ":" + s.revision : ""))).slice(0, 50))
    check(key > 0n, "native job nonce lane"); return key
  }
  async function guard<T>(fn: () => Promise<T>) { try { return await fn() } catch (e) { if (e instanceof Unavailable) throw e; throw new Unavailable("UNAVAILABLE: native job remains retained; retry status checking") } }
  async function chain() { check(await rpc({ method: "eth_chainId", params: [] }) === toHex(profile.chainId), "native job chain") }
  function subject(s: Subject) {
    check(Object.hasOwn(names, s.kind) && typeof s.subjectId === "string" && (s.kind === "publication"
      ? /^privacy-link:(invoice|profile):[a-z0-9-]{1,64}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s.subjectId)
      : hash(s.subjectId) && BigInt(s.subjectId) !== 0n), "native job subject")
    check(typeof s.assertFunded === "function" && typeof s.assertLease === "function" && typeof s.readRequest === "function", "funding and lease guards required")
    check(s.revision === undefined || s.kind === "finalization" && hash(s.revision) && BigInt(s.revision) !== 0n, "native revision is finalization-only")
  }
  async function live(s: Subject, db?: Db) { await s.assertLease(); await s.assertFunded(db); await s.assertLease() }
  function request(r: Request, s: Subject) {
    check(!s.revision || r && keccak256(r.data) === s.revision, "native finalization revision changed")
    check(r && Object.keys(r).sort().join(",") === "data,rewardMicro,to" && address(r.to) && typeof r.data === "string" && /^0x(?:[a-f0-9]{2}){4,16384}$/.test(r.data) && typeof r.rewardMicro === "bigint" && r.rewardMicro > 0n && r.rewardMicro < 1n << 128n, "native job request")
    const target = s.kind === "publication" ? profile.registry : s.kind === "preparation" ? profile.verifier : profile.master
    check(same(r.to, target), "native job target")
    const abi = s.kind === "publication" || s.kind === "preparation" ? prefixAbi : masterAbi
    const decoded = decodeFunctionData({ abi, data: r.data }), values = decoded.args as readonly unknown[]
    check(decoded.functionName === names[s.kind] && encodeFunctionData({ abi, functionName: decoded.functionName, args: values }) === r.data, "native job canonical calldata")
    if (s.kind === "preparation") {
      const signals = values[2] as bigint[], asset = profile.assets.find(a => BigInt(a.assetId) === signals[3])
      check(same(sender, profile.preparationAuthority) && values[0] === s.subjectId && [1, 2].includes(Number(values[1])) && asset && signals.every(n => n >= 0n && n < field) && signals[0] === BigInt(profile.chainId) && signals[1] === BigInt(profile.registry) && signals[2] === BigInt(asset.pool) && signals[4] === profile.settlementDomain && typeof values[3] === "bigint" && values[3] > 0n && values[3] < field, "native preparation subject or domain")
    } else if (s.kind === "publication") {
      check(address(values[0]) && values[1] !== 0n && Number(values[4]) === (s.subjectId.startsWith("privacy-link:invoice:") ? 1 : 2), "native publication kind")
    } else {
      const authorization = values[s.kind === "observation" ? 2 : 0] as Record<string, unknown>
      check(authorization.chainId === BigInt(profile.chainId) && authorization.settlementDomainId === profile.settlementDomain && authorization.environment === profile.environment && same(authorization.verifyingContract, profile.master) && authorization.attemptId === s.subjectId, "native master subject or domain")
      const asset = profile.assets.find(a => same(a.token, authorization.token))
      check(asset && (s.kind === "observation" || authorization.assetId === BigInt(asset.assetId) && same(authorization.pool, asset.pool)), "native master asset")
      if (s.kind === "observation") {
        const observation = values[1] as Record<string, unknown>
        check(values[0] === s.subjectId && same(observation.masterAddress, profile.master) && ["token", "virtualAddress", "amount", "observationId", "txHash", "logIndexA", "logIndexB", "observedBlockNumber", "routeHash", "userTagHash"].every(k => same(observation[k], authorization[k])), "native observation binding")
      } else if (s.kind === "finalization") {
        check(authorization.paymentMethod === 2 && (authorization.routeType === 0 || authorization.routeType === 3) && same(authorization.receiver, profile.receiver) && authorization.virtualMasterId === profile.virtualMasterId + "0".repeat(56), "native settlement route")
      }
    }
  }
  async function nonce(tag: "pending" | "latest", s: Subject) {
    const call = Actions.nonce.getNonce.call({ account: sender, nonceKey: nonceKey(s) })
    const data = await rpc({ method: "eth_call", params: [{ to: call.address, data: encodeFunctionData(call) }, tag] })
    check(typeof data === "string" && /^0x[a-f0-9]{64}$/.test(data), "native job nonce result")
    const value = decodeFunctionResult({ ...call, data: data as Hex })
    check(typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) && encodeFunctionResult({ ...call, result: value }) === data, "native job nonce range")
    return value
  }
  async function validate(row: Row, s: Subject) {
    const lane = nonceKey(s)
    request({ to: row.to_address, data: row.calldata, rewardMicro: BigInt(row.reward_micro) }, s)
    check(row.kind === s.kind && row.subject_id === s.subjectId && row.revision_hash === (s.revision ?? toHex(0n,{size:32})) && row.chain_id === profile.chainId && row.profile_digest === profileDigest && row.sender === sender.toLowerCase() && row.nonce_key === String(lane) && row.nonce === "0" && typeof row.raw_transaction === "string" && /^0x76(?:[a-f0-9]{2}){1,32768}$/.test(row.raw_transaction) && hash(row.tx_hash) && keccak256(row.raw_transaction) === row.tx_hash, "retained native job")
    const tx = Transaction.deserialize(row.raw_transaction), signature = tx.signature
    check(tx.chainId === profile.chainId && tx.nonce === Number(row.nonce) && tx.nonceKey === lane && tx.calls.length === 1 && same(tx.calls[0].to, row.to_address) && tx.calls[0].data === row.calldata && (tx.calls[0].value ?? 0n) === 0n && same(tx.feeToken, feeToken), "native job transaction changed")
    const authorizations = (tx as { authorizationList?: unknown }).authorizationList
    check(tx.feePayerSignature === undefined && !tx.keyAuthorization && (authorizations === undefined || Array.isArray(authorizations) && authorizations.length === 0) && !tx.accessList?.length && tx.validBefore === undefined && tx.validAfter === undefined && signature?.type === "secp256k1", "native operator signature required")
    check(await Transaction.serialize(tx) === row.raw_transaction && typeof tx.gas === "bigint" && tx.gas > 0n && typeof tx.maxFeePerGas === "bigint" && tx.maxFeePerGas > 0n && costCoveringRelayReward(tx.gas, tx.maxFeePerGas) <= BigInt(row.reward_micro), "native job reward coverage")
    const signedBy = await recoverAddress({ hash: keccak256(await Transaction.serialize({ ...tx, signature: undefined })), signature: { r: toHex(signature.signature.r, { size: 32 }), s: toHex(signature.signature.s, { size: 32 }), yParity: signature.signature.yParity } })
    check(same(signedBy, sender), "native job signature")
  }
  async function read(db: Db, s: Subject) {
    const rows = await db.query<Row>("SELECT * FROM phase3_private.receiving_native_jobs_v4 WHERE profile_digest=$1 AND kind=$2 AND subject_id=$3 AND revision_hash=$4", [profileDigest, s.kind, s.subjectId, s.revision ?? toHex(0n,{size:32})])
    check(rows.rows.length <= 1, "native job identity"); return rows.rows[0]
  }
  function matches(fresh: Request | null, row: Row) { check(fresh === null || same(fresh.to, row.to_address) && fresh.data === row.calldata && String(fresh.rewardMicro) === row.reward_micro, "original native job changed") }
  return {
    nonceKey,
    prepare: (s: Subject & { sign(tx: Transaction.TransactionSerializableTempo): Promise<Hex> }) => guard(async () => {
      subject(s); const lane = nonceKey(s); await live(s); await chain()
      const db = await pool.connect()
      try {
        await db.query("BEGIN")
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["receiving-v4:" + profile.chainId + ":" + sender.toLowerCase() + ":" + lane])
        await live(s, db)
        const old = await read(db, s), fresh = structuredClone(await s.readRequest(db))
        if (fresh !== null) request(fresh, s)
        if (old) { await validate(old, s); matches(fresh, old); await live(s, db); await db.query("COMMIT"); return { txHash: old.tx_hash } }
        if (fresh === null) { await db.query("COMMIT"); return null }
        const pending = await nonce("pending", s), latest = await nonce("latest", s)
        check(pending === 0n && latest === 0n, "native job nonce reconciliation required")
        await live(s, db)
        const raw = await s.sign({ type: "tempo", chainId: profile.chainId, nonceKey: lane, nonce: 0, feeToken, calls: [{ to: fresh.to, data: fresh.data, value: 0n }] })
        check(/^0x76(?:[a-f0-9]{2}){1,32768}$/.test(raw), "native job signed bytes")
        const row: Row = { kind: s.kind, subject_id: s.subjectId, revision_hash: s.revision ?? toHex(0n,{size:32}), sender: sender.toLowerCase(), profile_digest: profileDigest, chain_id: profile.chainId, nonce_key: String(lane), nonce: "0", to_address: fresh.to, calldata: fresh.data, reward_micro: String(fresh.rewardMicro), raw_transaction: raw as `0x76${string}`, tx_hash: keccak256(raw) }
        await validate(row, s); await chain(); await live(s, db)
        const current = structuredClone(await s.readRequest(db)); if (current !== null) request(current, s)
        check(current !== null, "native job satisfied before commit"); matches(current, row)
        check(await nonce("latest", s) === latest && await nonce("pending", s) === latest, "native job nonce changed before commit")
        await db.query("INSERT INTO phase3_private.receiving_native_jobs_v4(profile_digest,chain_id,kind,subject_id,sender,nonce_key,nonce,to_address,calldata,reward_micro,raw_transaction,tx_hash,revision_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [profileDigest, profile.chainId, s.kind, s.subjectId, row.sender, row.nonce_key, row.nonce, row.to_address, row.calldata, row.reward_micro, raw, row.tx_hash,row.revision_hash])
        await live(s, db); await db.query("COMMIT"); return { txHash: row.tx_hash }
      } catch (e) { await db.query("ROLLBACK").catch(() => undefined); throw e } finally { db.release() }
    }),
    resume: (s: Subject & { confirm(txHash: Hex): Promise<unknown> }) => guard(async () => {
      subject(s); await live(s); await chain()
      const db = await pool.connect(); let row: Row | undefined
      try { row = await read(db, s) } finally { db.release() }
      check(row, "retained native job not found"); await validate(row, s)
      const fresh = structuredClone(await s.readRequest()); if (fresh !== null) request(fresh, s); matches(fresh, row)
      const receipt = await rpc({ method: "eth_getTransactionReceipt", params: [row.tx_hash] }) as { transactionHash: Hex; status: string } | null
      if (receipt !== null) {
        check(receipt.transactionHash === row.tx_hash && receipt.status === "0x1", "native job receipt unsuccessful or changed")
        const confirmed = await s.confirm(row.tx_hash); await chain(); await live(s)
        return { status: confirmed === false ? "pending" as const : "confirmed" as const, txHash: row.tx_hash }
      }
      if (fresh === null) { await chain(); return { status: "already_satisfied" as const, txHash: row.tx_hash } }
      const known = await rpc({ method: "eth_getTransactionByHash", params: [row.tx_hash] }) as { hash: Hex } | null
      if (known === null) {
        check(await nonce("latest", s) === BigInt(row.nonce), "original native job nonce consumed or gapped")
        await chain(); await live(s)
        const current = structuredClone(await s.readRequest())
        if (current === null) return { status: "already_satisfied" as const, txHash: row.tx_hash }
        request(current, s); matches(current, row); await live(s)
        check(await broadcast(row.raw_transaction) === row.tx_hash, "native broadcast hash changed")
      } else check(known.hash === row.tx_hash, "native pending job identity")
      await chain(); return { status: "pending" as const, txHash: row.tx_hash }
    })
  }
}
