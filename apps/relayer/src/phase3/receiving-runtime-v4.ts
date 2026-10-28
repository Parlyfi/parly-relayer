import { createHash, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { decodeAbiParameters, decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, hexToBytes, keccak256, parseAbi, toHex, type Abi, type Address, type Hex } from "viem"
import { Transaction } from "viem/tempo"
import { receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { readReceivingPendingV4, receivingPendingDigestV4 } from "@parly/crypto-utils/receiving-pending-v4.node"
import { decodeReceivingBody, hashReceivingBody } from "@parly/crypto-utils/recipient-format-v4"
import { restoreReceivingPreparationV4 } from "../internal/receiving/receiving-preparation-v4.js"
import { restorePublicationFrameV4 } from "../internal/receiving/receiving-frame-v4.js"
import { verifyReceivingPublicationV4 } from "../internal/receiving/receiving-publication-v4.js"
import { receivingPublicationBindingV4 } from "../internal/receiving/receiving-membership-v4.js"
import { createReceivingConfirmationValidationV4, createReceivingFundingValidationV4, createReceivingSeedValidationV4 } from "../internal/indexer/receiving-seed-v4.js"
import type { createReceivingProviderSourceVerifierV4 } from "../internal/indexer/receiving-provider-source-v4.js"
import { assertPrivateExecutionProducerConfig, decryptRelayerExecutionPayload, encryptOneTimeExecutionSeed, producePrivateExecutionPayload, signReceivingSettlementV4, type PrivateExecutionProducerConfig } from "../internal/indexer/execution-payload-producer.js"
import { decodeTip1022VirtualAddress } from "@parly/shared-types"
import { createReceivingJobsV4 } from "./receiving-jobs-v4.js"
import { costCoveringRelayReward } from "./relay-reward.js"
import type { ReceivingFundedJobV4 } from "./receiving-funded-worker-v4.js"
import type { RelayerOwnedOneTimeExecutionDataSource, RelayerOwnedOneTimeExecutionJob } from "./index.js"

type Db = { query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> }
type Pool = Db & { connect(): Promise<Db & { release(): void }> }
type Kind = "publication" | "preparation" | "registration" | "observation" | "finalization"
export type ReceivingGasV4 = Record<Kind, bigint>
type Seed = Parameters<typeof producePrivateExecutionPayload>[0]["receivingSeedV4"] & { recovery: Record<string, unknown> }
type Proof = { proof: Hex; publicSignals: string[] }
type Rpc = Parameters<typeof createReceivingJobsV4>[0]["rpc"]
type Row = Record<string, any>
const { buildPoseidon } = createRequire(import.meta.url)("circomlibjs") as typeof import("circomlibjs")
const parts = Array.from({ length: 4 }, () => ({ type: "bytes" } as const))
const zero = toHex(0n, { size: 32 }), kinds: Kind[] = ["publication", "preparation", "registration", "observation", "finalization"]
const abi: Abi = parseAbi([
  "function originalExpectation(bytes32) view returns(bytes32,uint8,uint256,bytes32)", "function prepare(bytes32,uint8,uint256[13],uint256)",
  "function activeRoot() view returns(uint256)", "function nextIndex() view returns(uint64)", "function records(uint32) view returns(address,bytes32,uint64,uint64,uint256,bool)",
  "function usedNonces(address,uint64) view returns(bool)", "function register(address,uint256,uint64,uint64,uint8,uint64,bytes,bytes,uint256[9])",
  "function verifyMembership(bytes,uint256[10]) view returns(bool)", "function finalizedAttempts(bytes32) view returns(bool)",
  "function attemptObservationId(bytes32) view returns(bytes32)", "function attemptUserTagHash(bytes32) view returns(bytes32)",
  "function attemptSigner() view returns(address)", "function observationSigner() view returns(address)", "function settlementSigner() view returns(address)",
  "function treeInitialized() view returns(bool)"
])
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: funded V4 receiving runtime") }
const wire = (v: unknown) => JSON.parse(JSON.stringify(v, (_, n) => typeof n === "bigint" ? String(n) : n))
const same = (a: unknown, b: unknown) => receivingPendingDigestV4(wire(a)) === receivingPendingDigestV4(wire(b))
const hex32 = (v: string): Hex => { const h = v.startsWith("0x") ? v : "0x" + v; check(/^0x[a-f0-9]{64}$/.test(h)); return h as Hex }

export function createReceivingRuntimeV4(args: {
  profile: ReceivingProfileV4; config: PrivateExecutionProducerConfig; sourcePool: Pool; executionPool: Db; dataSource: RelayerOwnedOneTimeExecutionDataSource
  rpc: Rpc; sender: Address; feeToken: Address; sign: Parameters<ReturnType<typeof createReceivingJobsV4>["prepare"]>[0]["sign"]
  gas: ReceivingGasV4; gasPrice(): Promise<bigint>; minimumConfirmations: number; leaseMs: number
  proveMembership(input: Record<string, unknown>): Promise<Proof>
  verifyProviderSource?: ReturnType<typeof createReceivingProviderSourceVerifierV4>
}) {
  const { sourcePool, executionPool, rpc, dataSource, sign } = args, profile = structuredClone(args.profile), config = { ...args.config }
  assertPrivateExecutionProducerConfig(config)
  check(profile.chainId === config.chainId && profile.settlementDomain === BigInt(config.settlementDomainId) && profile.environment === config.environment && profile.master.toLowerCase() === config.masterAddress.toLowerCase() && profile.receiver.toLowerCase() === config.receiverAddress.toLowerCase() && config.virtualMasterId === profile.virtualMasterId + "0".repeat(56) && args.sender.toLowerCase() === config.relayerOperatorAddress.toLowerCase() && args.sender.toLowerCase() === profile.preparationAuthority.toLowerCase())
  check(kinds.every(k => typeof args.gas[k] === "bigint" && args.gas[k] > 0n) && args.leaseMs >= 3000 && typeof dataSource.renewRelayerOwnedOneTimeExecutionLease === "function")
  const profileDigest = createHash("sha256").update(receivingProfileJsonV4(profile)).digest("hex")
  const jobs = createReceivingJobsV4({ pool: sourcePool, profile, sender: args.sender, feeToken: args.feeToken, rpc, broadcast: async raw => await rpc({ method: "eth_sendRawTransaction", params: [raw] }) as Hex })
  const validatorArgs = { profile, minimumConfirmations: args.minimumConfirmations, sourceDb: sourcePool, rpc, verifyProviderSource: args.verifyProviderSource }
  const funding = createReceivingFundingValidationV4(validatorArgs), full = createReceivingSeedValidationV4(validatorArgs), terminal = createReceivingConfirmationValidationV4(validatorArgs)
  let poseidon: ReturnType<typeof buildPoseidon> | undefined
  const key = (version: string) => { const k = version === (config.seedEncryptionKeyVersion || "v1") ? config.seedEncryptionKey : config.seedEncryptionKeys?.[version]; check(k?.length === 32); return k }
  async function snapshot() {
    check(await rpc({ method: "eth_chainId", params: [] }) === toHex(profile.chainId))
    const head = await rpc({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { hash: Hex; number: Hex }
    check(head && /^0x[a-f0-9]{64}$/.test(head.hash))
    const call = async (to: Address, name: string, values: readonly unknown[] = [], targetAbi = abi): Promise<any> => {
      const data = await rpc({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi: targetAbi, functionName: name, args: values }) }, { blockHash: head.hash, requireCanonical: true }] }) as Hex
      const result = decodeFunctionResult({ abi: targetAbi, functionName: name, data }); check(encodeFunctionResult({ abi: targetAbi, functionName: name, result }) === data); return result
    }
    const finish = async () => { const current = await rpc({ method: "eth_getBlockByNumber", params: [head.number, false] }) as typeof head; check(current?.hash === head.hash && await rpc({ method: "eth_chainId", params: [] }) === toHex(profile.chainId)) }
    return { head, call, finish }
  }
  async function load(job: ReceivingFundedJobV4, confirmed = false) {
    const result = await sourcePool.query<Row>(`SELECT p.*,a.preparation,a.profile_digest,a.preparation_digest,a.publication_id,
      q.publication_authorization,f.observation_id,f.block_hash AS funding_block_hash,f.tx_hash,f.block_number,f.log_index_a,f.log_index_b
      FROM phase3_private.payment_attempts p JOIN phase3_private.receiving_attempts_v4 a ON a.attempt_id=p.internal_payment_attempt_id
      JOIN phase3_private.one_time_funding_observations f ON f.internal_payment_attempt_id=a.attempt_id
      LEFT JOIN phase3_private.privacy_link_publications q ON q.publication_id=a.publication_id
      WHERE a.attempt_id=$1 AND a.profile_digest=$2 AND f.observation_id=$3 AND f.block_hash=$4
        AND f.classification='eligible' AND f.confirmation_status='confirmed' AND f.verified_at IS NOT NULL
        AND ($5::boolean OR p.expires_at>CURRENT_TIMESTAMP) AND f.chain_id=p.one_time_chain_id AND f.master_address=p.one_time_master_address
        AND f.token_address=p.tempo_token_address AND f.virtual_address=p.tempo_virtual_address AND f.amount_base_units=p.amount_base_units::numeric
        AND 1=(SELECT count(*) FROM phase3_private.one_time_funding_observations x WHERE x.internal_payment_attempt_id=a.attempt_id
          AND x.classification='eligible' AND x.confirmation_status='confirmed' AND x.verified_at IS NOT NULL)`, [job.attemptId, profileDigest, job.observationId, job.blockHash, confirmed])
    check(result.rows.length === 1)
    const row = result.rows[0], prepared = await restoreReceivingPreparationV4(row.preparation), body = decodeReceivingBody(hexToBytes(prepared.body))
    const context = prepared.purpose === 1 ? 0 : row.payment_context === "privacy_link_pay_with_wallet" ? 1 : 2
    const pending = await readReceivingPendingV4({ db: sourcePool, attemptId: job.attemptId, encryptionKey: key }) as { seed: Seed; opening: unknown }
    check(pending?.seed && body.attemptId === job.attemptId && row.preparation_digest === receivingPendingDigestV4(row.preparation))
    const tag = decodeTip1022VirtualAddress(row.tempo_virtual_address).userTag
    const attempt = { paymentAttemptId: job.attemptId, chainId: profile.chainId, settlementDomainId: Number(profile.settlementDomain), environment: profile.environment, masterAddress: profile.master, virtualMasterId: config.virtualMasterId,
      userTag: tag, paymentTagHash: keccak256(tag), routeHash: prepared.routeHash, expectedToken: body.token, expectedAmount: body.expectedAmount, dustThreshold: 1n, expiresAt: Number(body.expiresAt) * 1000, status: "payment_detected",
      authorizationNonce: hex32(row.authorization_nonce), refundWalletCommitment: body.refundWalletCommitment, poolAddress: body.pool, assetId: body.assetId, paymentContext: context, refundClaimantBinding: context, statusAccessTokenHash: hex32(row.status_access_token_hash) }
    const observation = { token: body.token, virtualAddress: row.tempo_virtual_address as Address, masterAddress: profile.master, amount: BigInt(row.amount_base_units), observationId: job.observationId, txHash: hex32(row.tx_hash), logIndexA: BigInt(row.log_index_a), logIndexB: BigInt(row.log_index_b), observedBlockNumber: BigInt(row.block_number), routeHash: prepared.routeHash, userTagHash: keccak256(tag) }
    return { row, prepared, body, pending, input: { attempt, observation, seed: pending.seed, domain: config } }
  }
  async function validate(job: ReceivingFundedJobV4, confirmed = false) { const original = await load(job, confirmed); await (confirmed ? terminal : funding)(original.input); return original }
  async function publication(original: Awaited<ReturnType<typeof load>>) {
    const { row, pending, prepared } = original
    if (prepared.purpose === 1) { check(pending.opening === null); return null }
    const retained = row.publication_authorization; check(retained?.scheme === "native-receiving-v4")
    const frame = restorePublicationFrameV4(retained.frame), s = await snapshot()
    check(frame.publicationId === row.publication_id && frame.origin === profile.origin && frame.chainId === BigInt(profile.chainId) && frame.registry.toLowerCase() === profile.registry.toLowerCase())
    const proofAbi = parseAbi(["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[9]) view returns(bool)"])
    const checked = await verifyReceivingPublicationV4({ frame, authorization: retained.authorization, domain: { name: "Parly Receiving Authorization", version: "4", chainId: profile.chainId, verifyingContract: profile.registry }, verifyEnrollment: async (proof, signals) => await s.call(profile.proofs.enrollment, "verifyProof", [...decodeAbiParameters([{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }], proof), signals.map(BigInt)], proofAbi) === true })
    const base = await receivingPublicationBindingV4({ preparation: row.preparation, frame, ...checked, opening: pending.opening })
    const count = await s.call(profile.registry, "nextIndex"); check(typeof count === "bigint" && count <= 10000n)
    let index: number | undefined
    for (let i = 0; i < Number(count); i++) { const r = await s.call(profile.registry, "records", [i]); if (r[1] === checked.authorizationDigest) { check(index === undefined && r[0].toLowerCase() === frame.owner.toLowerCase() && r[2] === frame.epoch && r[4] === BigInt(checked.leaf) && r[5] === false); index = i } }
    check(await s.call(profile.registry, "usedNonces", [frame.owner, frame.nonce]) === (index !== undefined))
    const a = retained.authorization as { proof: Hex; signature: Hex; publicSignals: string[] }
    const transaction = index === undefined ? { to: profile.registry, data: encodeFunctionData({ abi, functionName: "register", args: [frame.owner, BigInt(checked.descriptor), frame.nonce, frame.epoch, frame.kind === "invoice" ? 1 : 2, frame.validUntil, a.signature, a.proof, a.publicSignals.map(BigInt)] }) } : null
    await s.finish(); return { frame, checked, base, index, transaction }
  }
  async function refreshed(original: Awaited<ReturnType<typeof load>>): Promise<Seed> {
    if (original.prepared.purpose === 1) return structuredClone(original.pending.seed)
    for (let retry = 0; retry < 2; retry++) {
      const p = await publication(original); check(p && p.index !== undefined)
      const s = await snapshot(), count = await s.call(profile.registry, "nextIndex"), root = await s.call(profile.registry, "activeRoot")
      check(typeof count === "bigint" && count > 0n && count <= 10000n && typeof root === "bigint")
      const expected = [p.base.chainId, p.base.registryAddress, p.base.poolAddress, p.base.assetId, p.base.settlementDomain, p.base.expiresAt, p.base.binding, p.base.bodyLo, p.base.bodyHi, root].map(String)
      const prior = await sourcePool.query<{ envelope: Hex; envelope_hash: Hex }>("SELECT envelope,envelope_hash FROM phase3_private.receiving_seed_revisions_v4 WHERE profile_digest=$1 AND attempt_id=$2 ORDER BY created_at DESC,envelope_hash LIMIT 16", [profileDigest,original.body.attemptId])
      const originalParts = decodeAbiParameters(parts,original.pending.seed.envelope)
      for (const revision of prior.rows) {
        const saved = decodeAbiParameters(parts,revision.envelope)
        check(keccak256(revision.envelope) === revision.envelope_hash && encodeAbiParameters(parts,saved) === revision.envelope && saved.slice(0,3).every((v,i)=>v===originalParts[i]))
        if (await s.call(profile.verifier,"verifyMembership",[saved[3],expected.map(BigInt)]) === true) {
          const seed = {...original.pending.seed,envelope:revision.envelope}
          await s.finish(); await full({...original.input,seed}); return seed
        }
      }
      // Groth16 proofs are randomized: reuse a valid retained proof before creating a new signed revision.
      const P = await (poseidon ??= buildPoseidon()), H = (l: bigint, r: bigint) => BigInt(P.F.toString(P([l, r])))
      let nodes = new Map<number, bigint>(), zeroNode = 0n, cursor = p.index
      for (let i = 0; i < Number(count); i++) { const record = await s.call(profile.registry, "records", [i]); nodes.set(i, record[5] ? 0n : record[4]); if (i === p.index) check(record[1] === p.checked.authorizationDigest && record[5] === false && record[4] === BigInt(p.checked.leaf)) }
      const siblings: bigint[] = [], indices: number[] = []
      for (let level = 0; level < 32; level++) {
        siblings.push(nodes.get(cursor ^ 1) ?? zeroNode); indices.push(cursor & 1)
        const parents = new Map<number, bigint>()
        for (const i of new Set([...nodes.keys()].map(n => n >> 1))) parents.set(i, H(nodes.get(i * 2) ?? zeroNode, nodes.get(i * 2 + 1) ?? zeroNode))
        nodes = parents; cursor >>= 1; zeroNode = H(zeroNode, zeroNode)
      }
      check((nodes.get(0) ?? zeroNode) === root)
      const input = { ...p.base, currentRoot: root, pathElements: siblings, pathIndices: indices }
      const generated = await args.proveMembership(input)
      check(same(generated.publicSignals, expected) && /^0x[a-f0-9]{512}$/.test(generated.proof))
      const latest = await snapshot()
      if (await latest.call(profile.registry, "activeRoot") !== root) { await s.finish(); await latest.finish(); continue }
      check(await latest.call(profile.verifier, "verifyMembership", [generated.proof, expected.map(BigInt)]) === true)
      await s.finish(); await latest.finish()
      const old = decodeAbiParameters(parts, original.pending.seed.envelope), seed = { ...original.pending.seed, envelope: encodeAbiParameters(parts, [...old.slice(0, 3), generated.proof]) }
      await full({ ...original.input, seed }); return seed
    }
    throw Error("UNAVAILABLE: receiving membership changed while proving")
  }
  async function costs(original: Awaited<ReturnType<typeof load>>) {
    const id = original.body.attemptId, p = await publication(original), db = await sourcePool.connect()
    try {
      await db.query("BEGIN"); await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["receiving-v4-cost:" + profileDigest + ":" + (original.row.publication_id || id)])
      const existing = await db.query<{ budgets: Record<Kind, string> }>("SELECT budgets FROM phase3_private.receiving_costs_v4 WHERE profile_digest=$1 AND attempt_id=$2", [profileDigest, id])
      if (!existing.rows.length) {
        if (p?.transaction) { const owner = await db.query<{ attempt_id: string }>("SELECT attempt_id FROM phase3_private.receiving_costs_v4 WHERE profile_digest=$1 AND publication_id=$2", [profileDigest, p.frame.publicationId]); if (owner.rows.length && owner.rows[0].attempt_id !== id) { await db.query("COMMIT"); return null } }
        const price = await args.gasPrice(), budgets = Object.fromEntries(kinds.map(k => [k, String(k === "publication" && !p?.transaction ? 0n : costCoveringRelayReward(args.gas[k], price))]))
        check(Object.values(budgets).reduce((n, v) => n + BigInt(v), 0n) <= original.body.expectedAmount - original.body.principal)
        await db.query("INSERT INTO phase3_private.receiving_costs_v4(profile_digest,attempt_id,publication_id,budgets) VALUES($1,$2,$3,$4)", [profileDigest, id, p?.transaction ? p.frame.publicationId : null, JSON.stringify(budgets)])
        await db.query("COMMIT"); return budgets as Record<Kind, string>
      }
      const budgets = existing.rows[0].budgets
      check(Object.keys(budgets).sort().join() === [...kinds].sort().join() && kinds.every(k => /^(0|[1-9][0-9]{0,38})$/.test(budgets[k])) && kinds.reduce((n, k) => n + BigInt(budgets[k]), 0n) <= original.body.expectedAmount - original.body.principal)
      await db.query("COMMIT"); return budgets
    } catch (e) { await db.query("ROLLBACK").catch(() => undefined); throw e } finally { db.release() }
  }
  async function canonicalReceipt(hash: Hex) {
    const receipt = await rpc({ method: "eth_getTransactionReceipt", params: [hash] }) as Row | null
    check(receipt?.transactionHash === hash && receipt.status === "0x1")
    const block = await rpc({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] }) as Row, head = await rpc({ method: "eth_getBlockByNumber", params: ["latest", false] }) as Row
    check(block?.hash === receipt.blockHash && block.transactions?.[Number(BigInt(receipt.transactionIndex))] === hash)
    return BigInt(head.number) - BigInt(receipt.blockNumber) + 1n >= BigInt(args.minimumConfirmations) ? receipt : null
  }
  async function recoverPrefix(original: Awaited<ReturnType<typeof load>>, transaction: {to:Address;data:Hex;functionName:string}) {
    const eventName = transaction.functionName === "registerAttemptWithAuthorization" ? "AttemptRegistered" : "DepositClassified"
    const {parlyVirtualDepositMasterV2Abi} = await import("@parly/protocol-abis"), eventAbi = parlyVirtualDepositMasterV2Abi as Abi
    const topics = encodeEventTopics({abi:eventAbi,eventName,args:{attemptId:original.body.attemptId,token:original.body.token}})
    const s = await snapshot(), height = BigInt(s.head.number), start = original.input.observation.observedBlockNumber
    // shortcut: direct prefix recovery scans at most 8192 post-funding blocks; older cases require reviewed recovery.
    check(height >= start && height-start < 8192n)
    for (let from=start;from<=height;from+=1024n) {
      const logs = await rpc({method:"eth_getLogs",params:[{address:profile.master,topics,fromBlock:toHex(from),toBlock:toHex(from+1023n<height?from+1023n:height)}]}) as Row[]
      check(Array.isArray(logs) && logs.length<=100)
      for (const log of logs) {
        check(log.removed!==true && String(log.address).toLowerCase()===profile.master.toLowerCase() && same(log.topics,topics) && BigInt(log.blockNumber)>=from && BigInt(log.blockNumber)<=height)
        const decoded = decodeEventLog({abi:eventAbi,eventName,topics:log.topics,data:log.data,strict:true}), values = decoded.args as unknown as Record<string,unknown>
        check(values.attemptId===original.body.attemptId && String(values.token).toLowerCase()===original.body.token.toLowerCase() && (values.expectedAmount??values.amount)===original.body.expectedAmount && (eventName==="AttemptRegistered" || values.status===1))
        const receipt = await canonicalReceipt(hex32(log.transactionHash)); if (!receipt) { await s.finish(); return null }
        check(receipt.blockHash===log.blockHash && receipt.blockNumber===log.blockNumber && receipt.transactionIndex===log.transactionIndex && Array.isArray(receipt.logs))
        check(receipt.logs.some((r:Row)=>["address","transactionHash","blockHash","blockNumber","transactionIndex","logIndex","topics","data"].every(k=>same(r[k],log[k]))))
        const tx = await rpc({method:"eth_getTransactionByHash",params:[log.transactionHash]}) as Row
        check(tx?.hash===log.transactionHash && tx.blockHash===receipt.blockHash && tx.blockNumber===receipt.blockNumber && tx.transactionIndex===receipt.transactionIndex)
        const calls = Array.isArray(tx.calls)?tx.calls:[{to:tx.to,data:tx.input??tx.data,value:tx.value}]
        check(calls.length===1 && String(calls[0].to).toLowerCase()===transaction.to.toLowerCase() && (calls[0].data??calls[0].input)===transaction.data && BigInt(calls[0].value??0)===0n)
        await s.finish(); return hex32(log.transactionHash)
      }
    }
    await s.finish(); return null
  }
  async function dispatch(original: Awaited<ReturnType<typeof load>>, job: ReceivingFundedJobV4, kind: Kind, guard: () => Promise<void>, readRequest: () => Promise<{ to: Address; data: Hex } | null>, budgets: Record<Kind, string>, revision?: Hex) {
    const subjectId = kind === "publication" ? original.row.publication_id : job.attemptId
    const subject = { kind, subjectId, revision, assertLease: guard, assertFunded: async () => {
      const s = await snapshot(), finalized = await s.call(profile.master, "finalizedAttempts", [job.attemptId]); await s.finish()
      await validate(job, kind === "finalization" && finalized === true)
    }, readRequest: async () => { const r = await readRequest(); return r && { ...r, rewardMicro: BigInt(budgets[kind]) } } }
    const retained = await jobs.prepare({ ...subject, sign: async tx => {
      const raw = await sign(tx), t = Transaction.deserialize(raw); check(t.gas && t.maxFeePerGas)
      const nextCost = costCoveringRelayReward(t.gas, t.maxFeePerGas)
      const previous = await sourcePool.query<{ raw_transaction: Hex }>(`SELECT j.raw_transaction FROM phase3_private.receiving_native_jobs_v4 j
        LEFT JOIN phase3_private.receiving_costs_v4 c ON c.profile_digest=j.profile_digest AND c.publication_id=j.subject_id
        WHERE j.profile_digest=$1 AND (j.subject_id=$2 OR (j.kind='publication' AND c.attempt_id=$2))`, [profileDigest, job.attemptId])
      let total = nextCost
      for (const r of previous.rows) { const saved = Transaction.deserialize(r.raw_transaction); check(saved.gas && saved.maxFeePerGas); total += costCoveringRelayReward(saved.gas, saved.maxFeePerGas) }
      check(total <= original.body.expectedAmount - original.body.principal); return raw
    } })
    if (!retained) return { status: "satisfied" as const }
    const result = await jobs.resume({ ...subject, confirm: async hash => { if (!await canonicalReceipt(hash)) return false; check(await readRequest() === null); return true } })
    return result
  }
  const jobFor = async (job: RelayerOwnedOneTimeExecutionJob) => {
    const rows = await sourcePool.query<{ block_hash: Hex }>("SELECT block_hash FROM phase3_private.one_time_funding_observations WHERE internal_payment_attempt_id=$1 AND observation_id=$2 AND confirmation_status='confirmed' AND classification='eligible' AND verified_at IS NOT NULL", [job.attemptAuthorization.attemptId, job.observation.observationId])
    check(rows.rows.length === 1)
    const funded = { attemptId: job.attemptAuthorization.attemptId, observationId: job.observation.observationId, blockHash: rows.rows[0].block_hash }
    const stored = await executionPool.query<Row>("SELECT * FROM phase3_private.relayer_execution_payloads WHERE attempt_id=$1", [funded.attemptId]); check(stored.rows.length === 1)
    const r = stored.rows[0], payload = decryptRelayerExecutionPayload({ sealed: { ciphertext: r.payload_ciphertext, iv: r.payload_iv, authTag: r.payload_auth_tag, payloadHash: r.payload_hash }, encryptionKey: config.executionEncryptionKey })
    for (const name of Object.keys(payload) as (keyof typeof payload)[]) check(same(payload[name], job[name as keyof RelayerOwnedOneTimeExecutionJob]))
    return funded
  }
  async function withExecutionLease<T>(job: RelayerOwnedOneTimeExecutionJob, fn: (guard: () => Promise<void>) => Promise<T>) {
    let lost = false, renewal: Promise<void> | undefined
    const guard = async () => { check(!lost); await dataSource.renewRelayerOwnedOneTimeExecutionLease!({ jobId: job.jobId, leaseToken: job.leaseToken }); check(!lost) }
    const timer = setInterval(() => { if (!renewal) renewal = guard().catch(() => { lost = true }).finally(() => { renewal = undefined }) }, Math.max(1000, Math.floor(args.leaseMs / 3))); timer.unref()
    try { await guard(); const result = await fn(guard); await guard(); return result } finally { clearInterval(timer); await renewal }
  }
  return {
    profile, sourcePool, dataSource,
    assertReady: async () => {
      const s = await snapshot()
      for (const pin of profile.codePins) check(keccak256(await rpc({ method: "eth_getCode", params: [pin.address, { blockHash: s.head.hash, requireCanonical: true }] }) as Hex) === pin.codeHash)
      for (const asset of profile.assets) check(await s.call(asset.pool,"treeInitialized") === true)
      for (const [name, expected] of [["attemptSigner",config.attemptSigner],["observationSigner",config.observationSigner],["settlementSigner",config.settlementSigner]] as const) check((await s.call(profile.master,name)).toLowerCase() === expected.toLowerCase())
      await s.finish()
      await sourcePool.query("SELECT revision_hash FROM phase3_private.receiving_native_jobs_v4 LIMIT 0")
      await sourcePool.query("SELECT budgets FROM phase3_private.receiving_costs_v4 LIMIT 0")
      await sourcePool.query("SELECT envelope_hash FROM phase3_private.receiving_seed_revisions_v4 LIMIT 0")
      await executionPool.query("SELECT job_id FROM phase3_private.relayer_execution_payloads LIMIT 0")
    },
    fundedHost: { profileDigest,
      assertFunded: async (job: ReceivingFundedJobV4) => { await validate(job) },
      prepare: async (job: ReceivingFundedJobV4, guard: () => Promise<void>) => {
        const original = await validate(job); await guard()
        const queued = await executionPool.query("SELECT job_id FROM phase3_private.relayer_execution_payloads WHERE attempt_id=$1", [job.attemptId])
        if (queued.rows.length) return { status: "prepared" as const }
        const budgets = await costs(original); if (!budgets) return { status: "pending" as const }
        const p = await publication(original)
        if (p?.transaction) { const r = await dispatch(original, job, "publication", guard, async () => (await publication(await validate(job)))!.transaction, budgets); if (r.status === "pending") return { status: "pending" as const } }
        const T = await hashReceivingBody(original.body), expected = [toHex(T.hash), original.prepared.purpose, BigInt(original.prepared.binding), keccak256(encodeAbiParameters([{ type: "uint256[13]" }], [original.prepared.expected as any]))]
        const readPreparation = async () => { const s = await snapshot(), current = await s.call(profile.verifier, "originalExpectation", [job.attemptId]); await s.finish(); if (same(current, expected)) return null; check(same(current, [zero, 0, 0n, zero])); return { to: profile.verifier, data: encodeFunctionData({ abi, functionName: "prepare", args: [job.attemptId, original.prepared.purpose, original.prepared.expected, BigInt(original.prepared.binding)] }) } }
        if ((await dispatch(original, job, "preparation", guard, readPreparation, budgets)).status === "pending") return { status: "pending" as const }
        const seed = await refreshed(original); await full({ ...original.input, seed }); await guard(); await validate(job)
        await sourcePool.query("INSERT INTO phase3_private.receiving_seed_revisions_v4(profile_digest,attempt_id,envelope_hash,envelope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [profileDigest, job.attemptId, keccak256(seed.envelope), seed.envelope])
        const sealed = encryptOneTimeExecutionSeed({ attemptId: job.attemptId, seed, encryptionKey: config.seedEncryptionKey, iv: randomBytes(12) })
        await sourcePool.query("INSERT INTO phase3_private.one_time_execution_seeds(attempt_id,payload_ciphertext,payload_iv,payload_auth_tag,payload_hash,payload_key_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [job.attemptId, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.payloadHash, config.seedEncryptionKeyVersion || "v1"])
        await producePrivateExecutionPayload({ config, sourceDb: sourcePool, executionDb: executionPool, attempt: original.input.attempt, observation: original.input.observation, expectedPaymentMethod: 2, expectedReceivingVersion: 4, validateReceivingSeed: full, receivingSeedV4: seed })
        await guard(); return { status: "prepared" as const }
      },
      assertPrepared: async (job: ReceivingFundedJobV4) => { await validate(job); const q = await executionPool.query("SELECT job_id FROM phase3_private.relayer_execution_payloads WHERE attempt_id=$1", [job.attemptId]); check(q.rows.length === 1) }
    },
    refreshFinalization: (job: RelayerOwnedOneTimeExecutionJob) => withExecutionLease(job, async guard => {
      const funded = await jobFor(job), s = await snapshot(), finalized = await s.call(profile.master, "finalizedAttempts", [funded.attemptId]); await s.finish()
      if (finalized) {
        await validate(funded, true)
        const rows = await sourcePool.query<{ calldata: Hex; tx_hash: Hex }>("SELECT calldata,tx_hash FROM phase3_private.receiving_native_jobs_v4 WHERE profile_digest=$1 AND kind='finalization' AND subject_id=$2 ORDER BY created_at DESC", [profileDigest, funded.attemptId])
        const { parlyVirtualDepositMasterV2Abi } = await import("@parly/protocol-abis")
        for (const r of rows.rows) {
          const receipt = await rpc({ method: "eth_getTransactionReceipt", params: [r.tx_hash] }) as Row | null
          if (receipt?.status !== "0x1") continue
          await canonicalReceipt(r.tx_hash)
          const decoded = decodeFunctionData({ abi: parlyVirtualDepositMasterV2Abi as Abi, data: r.calldata })
          check(decoded.functionName === "finalizeVirtualDeposit")
          const [authorization,envelope,settlementSignature] = decoded.args as [Record<string,unknown>,Hex,Hex]
          check(same(authorization,{...job.settlementAuthorization,envelopeHash:keccak256(envelope)}))
          return { envelope, settlementSignature }
        }
        throw Error("UNAVAILABLE: canonical finalization receipt is missing")
      }
      const original = await validate(funded), seed = await refreshed(original); await full({ ...original.input, seed }); await guard()
      await sourcePool.query("INSERT INTO phase3_private.receiving_seed_revisions_v4(profile_digest,attempt_id,envelope_hash,envelope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [profileDigest, funded.attemptId, keccak256(seed.envelope), seed.envelope])
      const settlementSignature = await signReceivingSettlementV4(config, { ...job.settlementAuthorization, envelopeHash: keccak256(seed.envelope) })
      return { envelope: seed.envelope, settlementSignature }
    }),
    executeTransaction: (job: RelayerOwnedOneTimeExecutionJob, transaction: { to: Address; data: Hex; functionName: string }) => withExecutionLease(job, async guard => {
      const funded = await jobFor(job), s = await snapshot(), finalized = await s.call(profile.master, "finalizedAttempts", [funded.attemptId]); await s.finish()
      const kind: Kind = transaction.functionName === "registerAttemptWithAuthorization" ? "registration" : transaction.functionName === "recordDepositObservationWithAttestation" ? "observation" : "finalization"
      check(["registerAttemptWithAuthorization", "recordDepositObservationWithAttestation", "finalizeVirtualDeposit"].includes(transaction.functionName) && transaction.to.toLowerCase() === profile.master.toLowerCase())
      const original = await validate(funded, kind === "finalization" && finalized === true)
      const saved = await sourcePool.query<{budgets:Record<Kind,string>}>("SELECT budgets FROM phase3_private.receiving_costs_v4 WHERE profile_digest=$1 AND attempt_id=$2",[profileDigest,funded.attemptId])
      check(saved.rows.length===1)
      const budgets = saved.rows[0].budgets
      check(kinds.every(k=> /^(0|[1-9][0-9]{0,38})$/.test(budgets[k])) && kinds.reduce((n,k)=>n+BigInt(budgets[k]),0n)<=original.body.expectedAmount-original.body.principal)
      if (kind!=="finalization") {
        const {prepareRelayerOwnedOneTimeExecutionPlan} = await import("./index.js")
        check(transaction.data===prepareRelayerOwnedOneTimeExecutionPlan(job).transactions[kind==="registration"?0:1].data)
      }
      const readRequest = async () => {
        const current = await snapshot(); let satisfied: boolean
        if (kind === "registration") { const tag = await current.call(profile.master, "attemptUserTagHash", [funded.attemptId]); check(tag === zero || tag === job.attemptAuthorization.userTagHash); satisfied = tag !== zero }
        else if (kind === "observation") { const observation = await current.call(profile.master, "attemptObservationId", [funded.attemptId]); check(observation === zero || observation === job.observation.observationId); satisfied = observation !== zero }
        else satisfied = await current.call(profile.master, "finalizedAttempts", [funded.attemptId]) === true
        await current.finish()
        if (satisfied) return null
        if (kind === "finalization") {
          const { parlyVirtualDepositMasterV2Abi } = await import("@parly/protocol-abis"), decoded = decodeFunctionData({ abi: parlyVirtualDepositMasterV2Abi as Abi, data: transaction.data })
          check(decoded.functionName === transaction.functionName)
          const [authorization, envelope, signature] = decoded.args as [Record<string, unknown>, Hex, Hex]
          check(same(authorization, { ...job.settlementAuthorization, envelopeHash: keccak256(envelope) }) && signature === await signReceivingSettlementV4(config, authorization as any))
          const old = decodeAbiParameters(parts, original.pending.seed.envelope), updated = decodeAbiParameters(parts, envelope); check(old.slice(0, 3).every((v, i) => v === updated[i]))
          await full({ ...original.input, seed: { ...original.pending.seed, envelope } })
        } else {
          const { prepareRelayerOwnedOneTimeExecutionPlan } = await import("./index.js")
          check(transaction.data === prepareRelayerOwnedOneTimeExecutionPlan(job).transactions[kind === "registration" ? 0 : 1].data)
        }
        return { to: transaction.to, data: transaction.data }
      }
      if (kind!=="finalization" && await readRequest()===null) {
        const local = await sourcePool.query<{tx_hash:Hex}>("SELECT tx_hash FROM phase3_private.receiving_native_jobs_v4 WHERE profile_digest=$1 AND kind=$2 AND subject_id=$3",[profileDigest,kind,funded.attemptId])
        const receipt = local.rows.length===1 ? await rpc({method:"eth_getTransactionReceipt",params:[local.rows[0].tx_hash]}) as Row|null : null
        if (receipt?.status!=="0x1") {
          const recovered = await recoverPrefix(original,transaction)
          await guard(); await validate(funded); check(await readRequest()===null)
          return recovered ? {hash:recovered,status:"success" as const} : {status:"pending" as const}
        }
      }
      const result = await dispatch(original, funded, kind, guard, readRequest, budgets, kind === "finalization" ? keccak256(transaction.data) : undefined)
      if (result.status === "confirmed") return { hash: result.txHash, status: "success" as const }
      return { status: "pending" as const }
    })
  }
}
