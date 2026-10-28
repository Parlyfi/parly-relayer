import { createHash } from "node:crypto"
import { decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, hexToBytes, keccak256, parseAbi, sha256, toHex, type Abi, type Address, type Hex } from "viem"
import { decodeReceivingBody, hashReceivingBody } from "@parly/crypto-utils/recipient-format-v4"
import { assertReceivingProfileV4, receivingProfileJsonV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { createTip1022Observation } from "./index.js"
import { decodeTip1022VirtualAddress } from "./tip1022.js"
import type { ReceivingExecutionSeedValidation } from "./execution-payload-producer.js"
import { receivingProviderSourceFrameV4, type ReceivingProviderSourceV4 } from "@parly/crypto-utils/receiving-source-v4"
import type { createReceivingProviderSourceVerifierV4 } from "./receiving-provider-source-v4.js"
type Rpc = (q: { method: string; params: unknown[] }) => Promise<unknown>
type Db = { query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> }
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n
const proofTypes = [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }] as const
const bytes4 = Array.from({ length: 4 }, () => ({ type: "bytes" } as const))
const abi: Abi = parseAbi([
  ...["underlyingToken", "receiver", "master", "registry", "verifier", "hasher", "spendVerifier", "owner", "treasury", "preparationAuthority", "enrollmentVerifier", "enrollment", "shield", "publication", "membership"].map(n => `function ${n}() view returns(address)`),
  "function circuitVersion() view returns(uint8)", "function assetId() view returns(uint256)", "function settlementDomain() view returns(uint256)", "function settlementDomainId() view returns(uint256)", "function environment() view returns(bytes32)", "function kytPolicyId() view returns(uint64)",
  "function paused() view returns(bool)", "function registryConfigured() view returns(bool)", "function registeredVirtualMasterId() view returns(bytes4)", "function virtualMasterId() view returns(bytes32)", "function officialVirtualAddressRegistry() view returns(address)",
  "function approvedTokens(address) view returns(bool)", "function approvedPools(address) view returns(bool)", "function approvedMasters(address) view returns(bool)",
  "function originalExpectation(bytes32) view returns(bytes32,uint8,uint256,bytes32)", "function activeRoot() view returns(uint256)", "function finalizedAttempts(bytes32) view returns(bool)", "function refundedAttempts(bytes32) view returns(bool)", "function consumedAttempts(bytes32) view returns(bool)", "function consumedCommitments(uint256) view returns(bool)",
  "function verifyAdmission(bytes,uint256[13]) view returns(bool)", "function verifyMembership(bytes,uint256[10]) view returns(bool)", "function isAuthorized(uint64,address) view returns(bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)"
])
function check(ok: unknown): asserts ok { if (!ok) throw Error("UNAVAILABLE: original V4 execution seed") }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase()
function stable(v: unknown): unknown { return typeof v === "bigint" ? String(v) : Array.isArray(v) ? v.map(stable) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v }
const json = (v: unknown) => JSON.stringify(stable(v))
const digest = (v: unknown) => createHash("sha256").update(json(v)).digest("hex")
function integer(v: unknown) { check(typeof v === "string" && /^0x[0-9a-f]{1,64}$/.test(v)); return BigInt(v) }
function proof(v: unknown): asserts v is Hex {
  check(typeof v === "string" && /^0x[a-f0-9]{512}$/.test(v))
  for (const word of v.slice(2).match(/.{64}/g)!) check(BigInt("0x" + word) < BASE_FIELD)
  check(encodeAbiParameters(proofTypes, decodeAbiParameters(proofTypes, v as Hex)) === v)
}

type ValidationArgs = { profile: ReceivingProfileV4; minimumConfirmations: number; sourceDb: Db; rpc: Rpc; verifyProviderSource?: (input: Parameters<ReturnType<typeof createReceivingProviderSourceVerifierV4>>[0]) => Promise<unknown> }
function createReceivingValidationV4(args: ValidationArgs, pending: boolean, confirmation = false): ReceivingExecutionSeedValidation {
  const profile = structuredClone(args.profile); assertReceivingProfileV4(profile)
  check(Number.isSafeInteger(args.minimumConfirmations) && args.minimumConfirmations > 0)
  const { sourceDb, rpc } = args, profileDigest = createHash("sha256").update(receivingProfileJsonV4(profile)).digest("hex")
  return async input => {
    try {
      const { attempt, observation, domain } = structuredClone(input), seed = structuredClone(input.seed) as unknown as Record<string, unknown>
      check(/^0x[a-f0-9]{64}$/.test(attempt.paymentAttemptId) && BigInt(attempt.paymentAttemptId) !== 0n)
      const readOriginal = () => sourceDb.query<Record<string, unknown>>(`SELECT a.*,p.tempo_virtual_address,p.payment_context,p.route_kind,p.one_time_publication_id,
        p.one_time_chain_id,p.one_time_settlement_domain_id,p.one_time_master_address,p.one_time_environment,p.one_time_virtual_master_id,p.public_payment_id,p.source_chain_id,p.source_token_address,p.created_at,
        q.owner_wallet_hash AS publication_owner_hash,q.publication_authorization
        FROM phase3_private.receiving_attempts_v4 a JOIN phase3_private.payment_attempts p ON p.internal_payment_attempt_id=a.attempt_id
        LEFT JOIN phase3_private.privacy_link_publications q ON q.publication_id=a.publication_id WHERE a.attempt_id=$1`, [attempt.paymentAttemptId])
      const original = await readOriginal(); check(original.rows.length === 1)
      const row = original.rows[0], prepared = row.preparation
      check(row.attempt_id === attempt.paymentAttemptId && row.profile_digest === profileDigest && object(prepared) && row.preparation_digest === digest(prepared))
      check(Object.keys(prepared).sort().join(",") === "binding,body,expected,policySubject,publicationId,purpose,routeHash" && typeof prepared.body === "string" && /^0x[0-9a-f]{886}$/.test(prepared.body))
      const body = decodeReceivingBody(hexToBytes(prepared.body as Hex)), asset = profile.assets.find(a => BigInt(a.assetId) === body.assetId)
      check(asset && asset.sourceChainIds.includes(body.sourceChainId))
      const provider = body.sourceChainId !== BigInt(profile.chainId)
      const T = await hashReceivingBody(body), expected = [body.chainId, BigInt(body.registry), BigInt(body.pool), body.assetId, body.settlementDomain, body.expiresAt, body.commitment, body.ephemeralX, body.ephemeralY, body.binding, body.principal, T.lo, T.hi]
      check(json(prepared.expected) === json(expected) && typeof prepared.binding === "string" && /^[1-9][0-9]{0,76}$/.test(prepared.binding) && BigInt(prepared.binding) < FIELD && typeof prepared.policySubject === "string" && /^[1-9][0-9]{0,48}$/.test(prepared.policySubject) && BigInt(prepared.policySubject) < 1n << 160n)
      const purpose = prepared.purpose, subject = toHex(BigInt(prepared.policySubject), { size: 20 })
      check(purpose === 1 || purpose === 2)
      const tupleHash = keccak256(encodeAbiParameters([{ type: "uint256[13]" }], [expected as [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint]]))
      const routeHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(toHex("PARLY_RECEIVING_BODY_POLICY_V4")), body.attemptId, toHex(T.hash), BigInt(prepared.policySubject), purpose, BigInt(prepared.binding), tupleHash]))
      check(prepared.routeHash === routeHash && prepared.publicationId === row.publication_id && row.route_kind === (provider ? "relay_multichain_deposit" : "direct_tempo_deposit"))
      const walletPayment = row.payment_context === "privacy_link_pay_with_wallet", context = walletPayment ? 1 : 2
      check(purpose === 1 ? row.publication_id === null && row.one_time_publication_id === null && row.payment_context === "shield_self_funding" && attempt.paymentContext === 0 && attempt.refundClaimantBinding === 0 : typeof row.publication_id === "string" && /^privacy-link:(invoice|profile):[a-z0-9-]{1,64}:[a-f0-9-]{36}$/.test(row.publication_id) && row.one_time_publication_id === row.publication_id && (walletPayment || row.payment_context === "privacy_link_one_time_address") && attempt.paymentContext === context && attempt.refundClaimantBinding === context)
      if (purpose === 2) {
        const authorization = row.publication_authorization
        check(object(authorization) && authorization.scheme === "native-receiving-v4" && object(authorization.frame) && authorization.frame.publicationId === row.publication_id && same(authorization.frame.owner, subject) && row.owner_hash === row.publication_owner_hash)
      }
      for (const [actual, required] of [
        [domain.chainId, profile.chainId], [domain.settlementDomainId, profile.settlementDomain], [domain.masterAddress, profile.master], [domain.receiverAddress, profile.receiver], [domain.environment, profile.environment], [domain.virtualMasterId, profile.virtualMasterId + "0".repeat(56)],
        [row.one_time_chain_id, domain.chainId], [row.one_time_settlement_domain_id, domain.settlementDomainId], [row.one_time_master_address, domain.masterAddress], ["0x" + row.one_time_environment, domain.environment], [row.one_time_virtual_master_id, domain.virtualMasterId],
        [attempt.chainId, domain.chainId], [attempt.settlementDomainId, domain.settlementDomainId], [attempt.environment, domain.environment], [attempt.masterAddress, domain.masterAddress], [attempt.virtualMasterId, domain.virtualMasterId],
        [body.attemptId, attempt.paymentAttemptId], [body.chainId, profile.chainId], [body.settlementDomain, profile.settlementDomain], [body.master, profile.master], [body.receiver, profile.receiver], [body.registry, profile.registry], [body.token, asset.token], [body.pool, asset.pool],
        [body.token, attempt.expectedToken], [body.pool, attempt.poolAddress], [body.assetId, attempt.assetId], [body.expectedAmount, attempt.expectedAmount], [body.expiresAt * 1000n, attempt.expiresAt], [body.refundWalletCommitment, attempt.refundWalletCommitment], [routeHash, attempt.routeHash],
        [observation.token, body.token], [observation.masterAddress, body.master], [observation.routeHash, routeHash], [observation.amount, body.expectedAmount], [observation.virtualAddress, row.tempo_virtual_address]
      ]) check(same(actual, required))
      check(body.principal > 0n && body.expectedAmount >= body.principal && body.expectedAmount - body.principal <= body.maxFinalizerFee && body.maxFinalizerFee * 10000n <= body.expectedAmount * 300n)
      const virtual = decodeTip1022VirtualAddress(String(row.tempo_virtual_address))
      check(same(virtual.masterId, profile.virtualMasterId) && same(virtual.userTag, attempt.userTag) && same(keccak256(virtual.userTag), attempt.paymentTagHash) && same(observation.userTagHash, attempt.paymentTagHash))
      const r = seed.recovery
      check(object(r) && typeof r.refundWallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(r.refundWallet) && BigInt(r.refundWallet) !== 0n && typeof r.refundSalt === "string" && /^0x[a-f0-9]{64}$/.test(r.refundSalt) && BigInt(r.refundSalt) !== 0n)
      check(Object.keys(r).sort().join(",") === (purpose === 1 ? "attemptExpiresAt,depositAddress,quoteExpiresAt,refundSalt,refundWallet,requestId,sourceAmountBaseUnits,sourceChainId,sourceDecimals,sourceToken" : "attemptExpiresAt,depositAddress,originalPublicLink,originalPublicationId,quoteExpiresAt,refundSalt,refundWallet,requestId,sourceAmountBaseUnits,sourceChainId,sourceDecimals,sourceToken"))
      check(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [body.chainId, body.attemptId, r.refundWallet as Address, r.refundSalt as Hex])) === body.refundWalletCommitment)
      check(r.sourceChainId === Number(body.sourceChainId) && r.attemptExpiresAt === new Date(Number(body.expiresAt) * 1000).toISOString())
      if (provider) {
        check(args.verifyProviderSource && same(row.source_chain_id, body.sourceChainId) && same(row.source_token_address, r.sourceToken))
        check(keccak256(toHex(receivingProviderSourceFrameV4(r as unknown as ReceivingProviderSourceV4, { attemptId: body.attemptId, chainId: profile.chainId, token: body.token, virtualAddress: String(row.tempo_virtual_address), amount: String(body.expectedAmount) }))) === body.sourceRouteHash)
      } else check(same(r.sourceToken, body.token) && r.sourceDecimals === 6 && r.sourceAmountBaseUnits === String(body.expectedAmount) && same(r.depositAddress, row.tempo_virtual_address) && r.requestId === row.public_payment_id && r.quoteExpiresAt === r.attemptExpiresAt)
      if (purpose === 1) check(same(subject, r.refundWallet))
      else {
        check(r.originalPublicationId === row.publication_id && typeof r.originalPublicLink === "string")
        const link = new URL(r.originalPublicLink), [, kind, slug] = String(row.publication_id).split(":")
        check(link.origin === profile.origin && !link.username && !link.password && !link.search && !link.hash && (kind === "invoice" ? link.pathname === "/invoice/" + slug : ["/" + slug, "/profile/" + slug].includes(link.pathname)))
      }
      check(typeof seed.envelope === "string" && /^0x(?:[a-f0-9]{2}){1,4096}$/.test(seed.envelope))
      const parts = decodeAbiParameters(bytes4, seed.envelope as Hex), [encodedBody, payload, admission, membership] = parts
      check(encodeAbiParameters(bytes4, parts) === seed.envelope && encodedBody === prepared.body && sha256(payload as Hex) === body.payloadHash)
      proof(admission); if (pending || purpose === 1) check(membership === "0x"); else proof(membership)
      const expectedSeed = { envelope: seed.envelope, innerCommitment: String(body.commitment), beneficiaryPolicySubject: subject, principalAmountBaseUnits: String(body.principal), finalizerFeeBaseUnits: String(body.expectedAmount - body.principal), payerTotalBaseUnits: String(body.expectedAmount), relayRequestIdHash: provider ? keccak256(toHex(String(r.requestId))) : toHex(0n, { size: 32 }), routeType: provider ? 3 : 0, paymentMethod: 2, recovery: r }
      check(json(seed) === json(expectedSeed))
      check(await rpc({ method: "eth_chainId", params: [] }) === toHex(profile.chainId))
      const block = await rpc({ method: "eth_getBlockByNumber", params: ["latest", false] }); check(object(block) && typeof block.hash === "string" && /^0x[a-f0-9]{64}$/.test(block.hash))
      const height = integer(block.number), timestamp = integer(block.timestamp), ref = { blockHash: block.hash, requireCanonical: true }
      check((confirmation || body.expiresAt > timestamp) && observation.observedBlockNumber > 0n && height - observation.observedBlockNumber + 1n >= BigInt(args.minimumConfirmations))
      for (const pin of profile.codePins) { const code = await rpc({ method: "eth_getCode", params: [pin.address, ref] }); check(typeof code === "string" && /^0x(?:[a-f0-9]{2})+$/.test(code) && keccak256(code as Hex) === pin.codeHash) }
      const read = async (to: Address, functionName: string, values: readonly unknown[] = []) => {
        const data = await rpc({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName, args: values }) }, ref] }); check(typeof data === "string")
        const value = decodeFunctionResult({ abi, functionName, data: data as Hex }); check(encodeFunctionResult({ abi, functionName, result: value }) === data); return value
      }
      const matches = async (to: Address, pairs: Record<string, unknown>) => { for (const [name, value] of Object.entries(pairs)) check(same(await read(to, name), value)) }
      await matches(profile.master, { receiver: profile.receiver, settlementDomainId: profile.settlementDomain, environment: profile.environment, registryConfigured: true, registeredVirtualMasterId: profile.virtualMasterId, virtualMasterId: profile.virtualMasterId + "0".repeat(56), officialVirtualAddressRegistry: "0xfDC0000000000000000000000000000000000000" })
      if (!confirmation) {
        await matches(profile.master, {owner:profile.owner,paused:false}); await matches(profile.receiver,{owner:profile.owner,paused:false})
        check(await read(profile.receiver, "approvedMasters", [profile.master]) === true)
      }
      await matches(profile.registry, { hasher: profile.hasher, enrollmentVerifier: profile.verifier })
      const { spend: _spend, ...admissionProofs } = profile.proofs
      await matches(profile.verifier, { preparationAuthority: profile.preparationAuthority, ...admissionProofs })
      await matches(asset.pool, { circuitVersion: 4, underlyingToken: asset.token, receiver: profile.receiver, master: profile.master, registry: profile.registry, verifier: profile.verifier, settlementDomain: profile.settlementDomain, assetId: asset.assetId, hasher: profile.hasher, spendVerifier: profile.proofs.spend, treasury: profile.treasury, kytPolicyId: asset.policyId })
      if (!confirmation) { await matches(asset.pool,{owner:profile.owner}); check(await read(profile.master, "approvedTokens", [asset.token]) === true && await read(profile.receiver, "approvedTokens", [asset.token]) === true && await read(profile.receiver, "approvedPools", [asset.pool]) === true) }
      const expectation = await read(profile.verifier, "originalExpectation", [body.attemptId])
      check(json(expectation) === json([toHex(T.hash), purpose, BigInt(prepared.binding), tupleHash]) || pending && !confirmation && json(expectation) === json([toHex(0n, { size: 32 }), 0, 0n, toHex(0n, { size: 32 })]))
      if (pending) {
        const verifyAbi: Abi = parseAbi(["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[14]) view returns(bool)"])
        const verifier = purpose === 1 ? profile.proofs.shield : profile.proofs.publication
        const signals = purpose === 1 ? [BigInt(prepared.binding), ...expected] : [...expected, BigInt(prepared.binding)]
        const data = await rpc({ method: "eth_call", params: [{ to: verifier, data: encodeFunctionData({ abi: verifyAbi, functionName: "verifyProof", args: [...decodeAbiParameters(proofTypes, admission), signals] }) }, ref] })
        check(typeof data === "string" && decodeFunctionResult({ abi: verifyAbi, functionName: "verifyProof", data: data as Hex }) === true && encodeFunctionResult({ abi: verifyAbi, functionName: "verifyProof", result: true }) === data)
      } else check(await read(profile.verifier, "verifyAdmission", [admission, expected]) === true)
      if (!pending && purpose === 2) {
        const root = await read(profile.registry, "activeRoot"); check(typeof root === "bigint" && root > 0n && root < FIELD)
        check(await read(profile.verifier, "verifyMembership", [membership, [body.chainId, BigInt(body.registry), BigInt(body.pool), body.assetId, body.settlementDomain, body.expiresAt, body.binding, T.lo, T.hi, root]]) === true)
      }
      // Confirming an already-consumed settlement is not authorization for another execution.
      if (!confirmation) {
        check(await read("0x403c000000000000000000000000000000000000", "isAuthorized", [asset.policyId, subject]) === true)
        if (!same(subject, r.refundWallet)) check(await read("0x403c000000000000000000000000000000000000", "isAuthorized", [asset.policyId, r.refundWallet]) === true)
      }
      check(await read(profile.master, "finalizedAttempts", [body.attemptId]) === confirmation && await read(profile.receiver, "finalizedAttempts", [body.attemptId]) === confirmation && await read(profile.receiver, "refundedAttempts", [body.attemptId]) === false && await read(asset.pool, "consumedAttempts", [body.attemptId]) === confirmation && await read(asset.pool, "consumedCommitments", [body.commitment]) === confirmation)
      const receipt = await rpc({ method: "eth_getTransactionReceipt", params: [observation.txHash] }); check(object(receipt) && receipt.status === "0x1" && receipt.transactionHash === observation.txHash && integer(receipt.blockNumber) === observation.observedBlockNumber && Array.isArray(receipt.logs))
      const fundingBlock = await rpc({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] }); check(object(fundingBlock) && fundingBlock.hash === receipt.blockHash && fundingBlock.number === receipt.blockNumber && integer(fundingBlock.timestamp) <= body.expiresAt && Array.isArray(fundingBlock.transactions) && fundingBlock.transactions[Number(integer(receipt.transactionIndex))] === observation.txHash)
      const transfers = receipt.logs.filter(log => object(log) && same(log.address, asset.token) && Array.isArray(log.topics) && log.topics[0] === keccak256(toHex("Transfer(address,address,uint256)"))).map(log => {
        check(object(log) && log.removed !== true && log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber && log.transactionIndex === receipt.transactionIndex && Array.isArray(log.topics) && typeof log.data === "string")
        const event = decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex, strict: true }); check(event.eventName === "Transfer" && object(event.args))
        const a = event.args; check(typeof a.from === "string" && typeof a.to === "string" && typeof a.value === "bigint")
        const index = Number(integer(log.logIndex)); check(Number.isSafeInteger(index))
        return { token: asset.token, from: a.from, to: a.to, amount: a.value, txHash: observation.txHash, logIndex: index, blockNumber: observation.observedBlockNumber }
      })
      const first = transfers.filter(t => BigInt(t.logIndex) === observation.logIndexA), second = transfers.filter(t => BigInt(t.logIndex) === observation.logIndexB)
      check(first.length === 1 && second.length === 1)
      const actual = createTip1022Observation({ paymentAttemptId: body.attemptId, routeHash, paymentTagHash: attempt.paymentTagHash, expectedRouteHash: routeHash, expectedPaymentTagHash: attempt.paymentTagHash, expectedToken: asset.token, expectedVirtualAddress: String(row.tempo_virtual_address), expectedMasterAddress: profile.master, first: first[0], second: second[0], transactionTransfers: transfers })
      check(same(actual.observationId, observation.observationId) && actual.amount === body.expectedAmount)
      if (walletPayment && !provider) check(same(first[0].from, r.refundWallet))
      if (provider) {
        const created = new Date(String(row.created_at)).getTime()
        check(Number.isSafeInteger(created) && created > 0)
        const evidence = await args.verifyProviderSource!({ attemptId: body.attemptId, source: r as unknown as ReceivingProviderSourceV4, createdAt: BigInt(Math.floor(created / 1000)), destinationChainId: profile.chainId, destinationTxHash: observation.txHash, destinationTimestamp: integer(fundingBlock.timestamp) })
        if (walletPayment) check(object(evidence) && same(evidence.sourceSender, r.refundWallet))
      }
      const current = await rpc({ method: "eth_getBlockByNumber", params: [block.number, false] }); check(object(current) && current.hash === block.hash && current.number === block.number && await rpc({ method: "eth_chainId", params: [] }) === toHex(profile.chainId))
      const fresh = await readOriginal(); check(fresh.rows.length === 1 && json(fresh.rows[0]) === json(row))
      return { version: 4 as const }
    } catch { throw Error("UNAVAILABLE: original V4 execution seed") }
  }
}

export function createReceivingSeedValidationV4(args: ValidationArgs): ReceivingExecutionSeedValidation {
  return createReceivingValidationV4(args, false)
}

// A funding-only check must never produce the receipt that unlocks executable V4 seeds.
export function createReceivingFundingValidationV4(args: ValidationArgs) {
  const validate = createReceivingValidationV4(args, true)
  return async (input: Parameters<ReceivingExecutionSeedValidation>[0]): Promise<void> => { await validate(input) }
}

// Terminal confirmation rechecks funding but cannot authorize a new execution seed.
export function createReceivingConfirmationValidationV4(args: ValidationArgs) {
  const validate = createReceivingValidationV4(args, true, true)
  return async (input: Parameters<ReceivingExecutionSeedValidation>[0]): Promise<void> => { await validate(input) }
}
