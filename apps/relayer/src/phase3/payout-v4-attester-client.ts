import { recoverAddress, type Hex } from "viem"

import type { PayoutV4CompletionProofPayload, PayoutV4ProvenanceAttestationPayload } from "./index.js"

type FetchLike = (input: string, init: RequestInit) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export type PayoutV4AttesterClientConfig =
  | { enabled: false; reason: "phase3_payout_v4_relayer_worker_disabled" }
  | {
      enabled: true
      adapterVersion: "v4"
      provenanceApiBaseUrl: string
      proofApiBaseUrl: string
      internalToken: string
    }

export type PayoutV5AttesterClientConfig =
  | { enabled: false; reason: "phase3_payout_v5_relayer_worker_disabled" }
  | {
      enabled: true
      adapterVersion: "v5"
      provenanceApiBaseUrl: string
      proofApiBaseUrl: string
      secondaryProofApiBaseUrl: string
      primaryProofSigner: `0x${string}`
      secondaryProofSigner: `0x${string}`
      internalToken: string
    }

export type PayoutV6AttesterClientConfig =
  | { enabled: false; reason: "phase3_payout_v6_relayer_worker_disabled" }
  | {
      enabled: true
      adapterVersion: "v6"
      provenanceApiBaseUrl: string
      proofApiBaseUrl: string
      secondaryProofApiBaseUrl: string
      primaryProofSigner: `0x${string}`
      secondaryProofSigner: `0x${string}`
      internalToken: string
    }

export type PayoutV7AttesterClientConfig =
  | { enabled: false; reason: "phase3_payout_v7_relayer_worker_disabled" }
  | (Omit<Extract<PayoutV6AttesterClientConfig, { enabled: true }>, "adapterVersion"> & { adapterVersion: "v7" })

type EnabledAttesterClientConfig =
  | Extract<PayoutV4AttesterClientConfig, { enabled: true }>
  | Extract<PayoutV5AttesterClientConfig, { enabled: true }>
  | Extract<PayoutV6AttesterClientConfig, { enabled: true }>
  | Extract<PayoutV7AttesterClientConfig, { enabled: true }>

type EnabledQuorumAttesterClientConfig =
  | Extract<PayoutV5AttesterClientConfig, { enabled: true }>
  | Extract<PayoutV6AttesterClientConfig, { enabled: true }>
  | Extract<PayoutV7AttesterClientConfig, { enabled: true }>

function requireHttpsUrl(value: string | undefined, name: string) {
  const raw = value?.trim()
  if (!raw) throw new Error(`${name} is required for payout execution.`)
  const parsed = new URL(raw)
  const localHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  const privateAttesterPorts: Record<string, string> = {
    "proof-attester-a": "8083",
    "proof-attester-b": "8084",
    "proof-attester-provenance": "8085"
  }
  const privateAttesterHttp =
    parsed.protocol === "http:" &&
    privateAttesterPorts[parsed.hostname] === parsed.port &&
    !parsed.username &&
    !parsed.password
  if (parsed.protocol !== "https:" && !localHttp && !privateAttesterHttp) {
    throw new Error(`${name} must use HTTPS outside local development.`)
  }
  return parsed.toString()
}

function requireToken(value: string | undefined) {
  const token = value?.trim()
  if (!token || token.length < 32) throw new Error("The payout attester internal token must be at least 32 characters.")
  return token
}

function assertHash(value: unknown, field: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/u.test(value)) throw new Error(`${field} is invalid.`)
  return value.toLowerCase() as Hex
}

function assertAddress(value: unknown, field: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/u.test(value)) throw new Error(`${field} is invalid.`)
  return value.toLowerCase() as `0x${string}`
}

function assertUnsigned(value: unknown, field: string) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new Error(`${field} is invalid.`)
  const parsed = BigInt(value)
  if (parsed < 0n) throw new Error(`${field} is invalid.`)
  return parsed
}

function parseProvenance(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("V4 provenance attestation is unavailable.")
  const body = value as Record<string, unknown>
  const attestation = body.attestation
  if (!attestation || typeof attestation !== "object") throw new Error("V4 provenance attestation is unavailable.")
  const row = attestation as Record<string, unknown>
  return {
    attestation: {
      intentHash: assertHash(row.intentHash, "provenance intentHash"),
      sourcePool: assertAddress(row.sourcePool, "provenance sourcePool"),
      token: assertAddress(row.token, "provenance token"),
      assetId: assertUnsigned(row.assetId, "provenance assetId"),
      amount: assertUnsigned(row.amount, "provenance amount"),
      escrow: assertAddress(row.escrow, "provenance escrow"),
      withdrawalTxHash: assertHash(row.withdrawalTxHash, "provenance withdrawalTxHash"),
      transferLogIndex: assertUnsigned(row.transferLogIndex, "provenance transferLogIndex"),
      blockNumber: assertUnsigned(row.blockNumber, "provenance blockNumber"),
      blockHash: assertHash(row.blockHash, "provenance blockHash"),
      attestationNonce: assertHash(row.attestationNonce, "provenance attestationNonce")
    } satisfies PayoutV4ProvenanceAttestationPayload,
    signature: readSignature(body.signature, "provenance signature")
  }
}

function parseProof(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("V4 completion proof is unavailable.")
  const body = value as Record<string, unknown>
  const proof = body.proof
  if (!proof || typeof proof !== "object") throw new Error("V4 completion proof is unavailable.")
  const row = proof as Record<string, unknown>
  return {
    proof: {
      intentHash: assertHash(row.intentHash, "proof intentHash"),
      providerSubmissionId: assertHash(row.providerSubmissionId, "proof providerSubmissionId"),
      requestIdHash: assertHash(row.requestIdHash, "proof requestIdHash"),
      destinationChainId: assertUnsigned(row.destinationChainId, "proof destinationChainId"),
      destinationToken: assertAddress(row.destinationToken, "proof destinationToken"),
      destinationRecipientHash: assertHash(row.destinationRecipientHash, "proof destinationRecipientHash"),
      destinationAmountOut: assertUnsigned(row.destinationAmountOut, "proof destinationAmountOut"),
      destinationTxHash: assertHash(row.destinationTxHash, "proof destinationTxHash"),
      destinationLogIndex: assertUnsigned(row.destinationLogIndex, "proof destinationLogIndex"),
      destinationBlockNumber: assertUnsigned(row.destinationBlockNumber, "proof destinationBlockNumber"),
      destinationBlockHash: assertHash(row.destinationBlockHash, "proof destinationBlockHash"),
      finalityConfirmations: assertUnsigned(row.finalityConfirmations, "proof finalityConfirmations"),
      proofNonce: assertHash(row.proofNonce, "proof proofNonce")
    } satisfies PayoutV4CompletionProofPayload,
    proofHash: assertHash(body.proofHash, "proofHash")
  }
}

function readSignature(value: unknown, field: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{130}$/u.test(value)) throw new Error(`${field} is invalid.`)
  return value.toLowerCase() as Hex
}

function parseQuorum(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("V4 proof quorum is unavailable.")
  const body = value as Record<string, unknown>
  const parsed = parseProof(body)
  if (typeof body.ready !== "boolean" || !Array.isArray(body.signatures) || !Array.isArray(body.signers)) throw new Error("V4 proof quorum is unavailable.")
  if (body.signatures.length !== body.signers.length) throw new Error("V4 proof quorum is unavailable.")
  return {
    ...parsed,
    ready: body.ready,
    threshold: assertUnsigned(body.threshold, "proof threshold"),
    verifierEpoch: assertUnsigned(body.verifierEpoch, "proof verifier epoch"),
    proofDigest: assertHash(body.proofDigest, "proof digest"),
    signatures: body.signatures.map((signature, index) => readSignature(signature, `proof signature ${index}`)),
    signers: body.signers.map((signer, index) => assertAddress(signer, `proof signer ${index}`))
  }
}

async function postJson(args: {
  baseUrl: string
  path: string
  token: string
  body: Record<string, string>
  fetchImpl?: FetchLike
}) {
  const endpoint = new URL(args.path, args.baseUrl).toString()
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(args.body),
    ...(args.body.adapterVersion === "v6" || args.body.adapterVersion === "v7" ? { signal: AbortSignal.timeout(15_000) } : {})
  })
  if (!response.ok) {
    if (args.body.adapterVersion === "v6" || args.body.adapterVersion === "v7") {
      throw Object.assign(new Error(`${args.body.adapterVersion.toUpperCase()} proof attester is unavailable.`), { code: `attester_http_${response.status}` })
    }
    throw new Error("V4 proof attester is unavailable.")
  }
  return response.json()
}

export function readPayoutV4AttesterClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV4AttesterClientConfig {
  if (env.PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_payout_v4_relayer_worker_disabled" }
  }
  return {
    enabled: true,
    adapterVersion: "v4",
    provenanceApiBaseUrl: requireHttpsUrl(env.PHASE3_PAYOUT_V4_PROVENANCE_ATTESTER_URL, "PHASE3_PAYOUT_V4_PROVENANCE_ATTESTER_URL"),
    proofApiBaseUrl: requireHttpsUrl(env.PHASE3_PAYOUT_V4_PROOF_ATTESTER_URL, "PHASE3_PAYOUT_V4_PROOF_ATTESTER_URL"),
    internalToken: requireToken(env.PHASE3_PAYOUT_V4_ATTESTER_INTERNAL_TOKEN)
  }
}

export function readPayoutV5AttesterClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV5AttesterClientConfig {
  if (env.PHASE3_PAYOUT_V5_RELAYER_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_payout_v5_relayer_worker_disabled" }
  }
  return {
    enabled: true,
    adapterVersion: "v5",
    provenanceApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V5_PROVENANCE_ATTESTER_URL,
      "PHASE3_PAYOUT_V5_PROVENANCE_ATTESTER_URL"
    ),
    proofApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V5_PROOF_ATTESTER_URL,
      "PHASE3_PAYOUT_V5_PROOF_ATTESTER_URL"
    ),
    secondaryProofApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V5_PROOF_ATTESTER_B_URL,
      "PHASE3_PAYOUT_V5_PROOF_ATTESTER_B_URL"
    ),
    primaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V5_PROOF_SIGNER_A, "PHASE3_PAYOUT_V5_PROOF_SIGNER_A"),
    secondaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V5_PROOF_SIGNER_B, "PHASE3_PAYOUT_V5_PROOF_SIGNER_B"),
    internalToken: requireToken(env.PHASE3_PAYOUT_V5_ATTESTER_INTERNAL_TOKEN)
  }
}

export function readPayoutV6AttesterClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV6AttesterClientConfig {
  if (env.PHASE3_PAYOUT_V6_RELAYER_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_payout_v6_relayer_worker_disabled" }
  }
  return {
    enabled: true,
    adapterVersion: "v6",
    provenanceApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V6_PROVENANCE_ATTESTER_URL,
      "PHASE3_PAYOUT_V6_PROVENANCE_ATTESTER_URL"
    ),
    proofApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V6_PROOF_ATTESTER_URL,
      "PHASE3_PAYOUT_V6_PROOF_ATTESTER_URL"
    ),
    secondaryProofApiBaseUrl: requireHttpsUrl(
      env.PHASE3_PAYOUT_V6_PROOF_ATTESTER_B_URL,
      "PHASE3_PAYOUT_V6_PROOF_ATTESTER_B_URL"
    ),
    primaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V6_PROOF_SIGNER_A, "PHASE3_PAYOUT_V6_PROOF_SIGNER_A"),
    secondaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V6_PROOF_SIGNER_B, "PHASE3_PAYOUT_V6_PROOF_SIGNER_B"),
    internalToken: requireToken(env.PHASE3_PAYOUT_V6_ATTESTER_INTERNAL_TOKEN)
  }
}

export function readPayoutV7AttesterClientConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutV7AttesterClientConfig {
  if (env.PHASE3_PAYOUT_V7_RELAYER_WORKER_ENABLED !== "true") return { enabled: false, reason: "phase3_payout_v7_relayer_worker_disabled" }
  return {
    enabled: true, adapterVersion: "v7",
    provenanceApiBaseUrl: requireHttpsUrl(env.PHASE3_PAYOUT_V7_PROVENANCE_ATTESTER_URL, "PHASE3_PAYOUT_V7_PROVENANCE_ATTESTER_URL"),
    proofApiBaseUrl: requireHttpsUrl(env.PHASE3_PAYOUT_V7_PROOF_ATTESTER_URL, "PHASE3_PAYOUT_V7_PROOF_ATTESTER_URL"),
    secondaryProofApiBaseUrl: requireHttpsUrl(env.PHASE3_PAYOUT_V7_PROOF_ATTESTER_B_URL, "PHASE3_PAYOUT_V7_PROOF_ATTESTER_B_URL"),
    primaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V7_PROOF_SIGNER_A, "PHASE3_PAYOUT_V7_PROOF_SIGNER_A"),
    secondaryProofSigner: assertAddress(env.PHASE3_PAYOUT_V7_PROOF_SIGNER_B, "PHASE3_PAYOUT_V7_PROOF_SIGNER_B"),
    internalToken: requireToken(env.PHASE3_PAYOUT_V7_ATTESTER_INTERNAL_TOKEN)
  }
}

export async function requestPayoutV4Provenance(args: {
  config: EnabledAttesterClientConfig
  intentHash: Hex
  withdrawalTxHash: Hex
  fetchImpl?: FetchLike
}) {
  return parseProvenance(await postJson({
    baseUrl: args.config.provenanceApiBaseUrl,
    path: "/provenance",
    token: args.config.internalToken,
    body: {
      adapterVersion: args.config.adapterVersion,
      intentHash: assertHash(args.intentHash, "intentHash"),
      withdrawalTxHash: assertHash(args.withdrawalTxHash, "withdrawalTxHash")
    },
    fetchImpl: args.fetchImpl
  }))
}

export const requestPayoutV5Provenance = requestPayoutV4Provenance
export const requestPayoutV6Provenance = requestPayoutV4Provenance

export async function requestPayoutV4ProofAttestation(args: {
  config: EnabledAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const response = await postJson({
    baseUrl: args.config.proofApiBaseUrl,
    path: "/attest",
    token: args.config.internalToken,
    body: {
      adapterVersion: args.config.adapterVersion,
      intentHash: assertHash(args.intentHash, "intentHash"),
      submissionTxHash: assertHash(args.submissionTxHash, "submissionTxHash")
    },
    fetchImpl: args.fetchImpl
  })
  return {
    ...parseProof(response),
    signature: readSignature((response as Record<string, unknown>).signature, "proof attester signature"),
    signer: assertAddress((response as Record<string, unknown>).signer, "proof attester signer")
  }
}

function proofUrls(config: EnabledQuorumAttesterClientConfig) {
  const urls = [config.proofApiBaseUrl, config.secondaryProofApiBaseUrl]
  const resolved = urls.map((baseUrl) => new URL("/attest", baseUrl).toString())
  if (resolved[0] === resolved[1]) {
    throw new Error("V5 proof attesters must use distinct service endpoints.")
  }
  if (config.primaryProofSigner.toLowerCase() === config.secondaryProofSigner.toLowerCase()) {
    throw new Error("V5 proof attesters must use distinct signer identities.")
  }
  return urls
}

export async function requestPayoutV5ProofAttestation(args: {
  config: EnabledQuorumAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const results = await Promise.all(proofUrls(args.config).map((proofApiBaseUrl) =>
    requestPayoutV4ProofAttestation({ ...args, config: { ...args.config, proofApiBaseUrl } })
  ))
  if (results.some((result) => result.proofHash !== results[0]!.proofHash)) {
    throw new Error("V5 proof attesters disagree on the proof hash.")
  }
  const expectedSigners = [args.config.primaryProofSigner, args.config.secondaryProofSigner]
  if (results.some((result, index) => result.signer.toLowerCase() !== expectedSigners[index]!.toLowerCase())) {
    throw new Error("V5 proof attester signer identity is invalid.")
  }
  return results[0]!
}

function parseRefundProof(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("V5 refund proof is unavailable.")
  const body = value as Record<string, unknown>
  const proof = body.proof
  if (!proof || typeof proof !== "object") throw new Error("V5 refund proof is unavailable.")
  const row = proof as Record<string, unknown>
  return {
    proof: {
      intentHash: assertHash(row.intentHash, "refund intentHash"),
      requestIdHash: assertHash(row.requestIdHash, "refund requestIdHash"),
      escrow: assertAddress(row.escrow, "refund escrow"),
      refundToken: assertAddress(row.refundToken, "refund token"),
      refundAmount: assertUnsigned(row.refundAmount, "refund amount"),
      refundChainId: assertUnsigned(row.refundChainId, "refund chainId"),
      refundTxHash: assertHash(row.refundTxHash, "refund transaction"),
      refundLogIndex: assertUnsigned(row.refundLogIndex, "refund logIndex"),
      refundBlockNumber: assertUnsigned(row.refundBlockNumber, "refund blockNumber"),
      refundBlockHash: assertHash(row.refundBlockHash, "refund blockHash"),
      finalityConfirmations: assertUnsigned(row.finalityConfirmations, "refund finalityConfirmations"),
      terminalStatusHash: assertHash(row.terminalStatusHash, "refund terminalStatusHash"),
      proofNonce: assertHash(row.proofNonce, "refund proofNonce")
    },
    proofHash: assertHash(body.proofHash, "refund proofHash")
  }
}

function parseRefundQuorum(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("V5 refund quorum is unavailable.")
  const body = value as Record<string, unknown>
  const parsed = parseRefundProof(body)
  if (typeof body.ready !== "boolean" || !Array.isArray(body.signatures) || !Array.isArray(body.signers)) throw new Error("V5 refund quorum is unavailable.")
  if (body.signatures.length !== body.signers.length) throw new Error("V5 refund quorum is unavailable.")
  return {
    ...parsed,
    ready: body.ready,
    threshold: assertUnsigned(body.threshold, "refund threshold"),
    verifierEpoch: assertUnsigned(body.verifierEpoch, "refund verifier epoch"),
    proofDigest: assertHash(body.proofDigest, "refund proof digest"),
    signatures: body.signatures.map((signature, index) => readSignature(signature, `refund signature ${index}`)),
    signers: body.signers.map((signer, index) => assertAddress(signer, `refund signer ${index}`))
  }
}

export async function readPayoutV4ProofQuorum(args: {
  config: EnabledAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  return parseQuorum(await postJson({
    baseUrl: args.config.proofApiBaseUrl,
    path: "/quorum",
    token: args.config.internalToken,
    body: {
      adapterVersion: args.config.adapterVersion,
      intentHash: assertHash(args.intentHash, "intentHash"),
      submissionTxHash: assertHash(args.submissionTxHash, "submissionTxHash")
    },
    fetchImpl: args.fetchImpl
  }))
}

function aggregateQuorums<T extends { proofHash: Hex; threshold: bigint; verifierEpoch: bigint; proofDigest: Hex; signatures: Hex[]; signers: `0x${string}`[] }>(
  quorums: readonly T[],
  label: string,
  expectedSigners: readonly `0x${string}`[]
) {
  const first = quorums[0]
  if (!first || quorums.some((quorum) => quorum.proofHash !== first.proofHash)) {
    throw new Error(`V5 ${label} attesters disagree on the proof hash.`)
  }
  if (quorums.some((quorum) => quorum.threshold !== first.threshold)) {
    throw new Error(`V5 ${label} attesters disagree on the verifier threshold.`)
  }
  if (quorums.some((quorum) => quorum.verifierEpoch !== first.verifierEpoch || quorum.proofDigest !== first.proofDigest)) {
    throw new Error(`V5 ${label} attesters disagree on the verifier proof digest.`)
  }
  const expected = new Set(expectedSigners.map((signer) => signer.toLowerCase()))
  const bySigner = new Map<string, Hex>()
  for (const quorum of quorums) {
    quorum.signers.forEach((signer, index) => {
      const key = signer.toLowerCase()
      const signature = quorum.signatures[index]!
      if (!expected.has(key)) return
      const existing = bySigner.get(key)
      if (existing && existing !== signature) throw new Error(`V5 ${label} quorum contains conflicting signatures.`)
      bySigner.set(key, signature)
    })
  }
  const signatures = expectedSigners.flatMap((signer) => {
    const signature = bySigner.get(signer.toLowerCase())
    return signature ? [signature] : []
  })
  const hasBothAutomatedSigners = expectedSigners.every((signer) => bySigner.has(signer.toLowerCase()))
  return { ...first, ready: hasBothAutomatedSigners && BigInt(signatures.length) >= first.threshold, signatures, signers: expectedSigners }
}

export async function readPayoutV5ProofQuorum(args: {
  config: EnabledQuorumAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const quorums = await Promise.all(proofUrls(args.config).map((baseUrl) =>
    readPayoutV4ProofQuorum({ ...args, config: { ...args.config, proofApiBaseUrl: baseUrl } })
  ))
  return aggregateQuorums(quorums, "completion", [args.config.primaryProofSigner, args.config.secondaryProofSigner])
}

export async function requestPayoutV5RefundAttestation(args: {
  config: EnabledQuorumAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const results = await Promise.all(proofUrls(args.config).map(async (baseUrl) => {
    const response = await postJson({
      baseUrl,
      path: "/attest-refund",
      token: args.config.internalToken,
      body: {
        adapterVersion: args.config.adapterVersion,
        intentHash: assertHash(args.intentHash, "intentHash"),
        submissionTxHash: assertHash(args.submissionTxHash, "submissionTxHash")
      },
      fetchImpl: args.fetchImpl
    })
    return {
      ...parseRefundProof(response),
      signature: readSignature((response as Record<string, unknown>).signature, "refund attester signature"),
      signer: assertAddress((response as Record<string, unknown>).signer, "refund attester signer")
    }
  }))
  if (results.some((result) => result.proofHash !== results[0]!.proofHash)) {
    throw new Error("V5 refund attesters disagree on the proof hash.")
  }
  const expectedSigners = [args.config.primaryProofSigner, args.config.secondaryProofSigner]
  if (results.some((result, index) => result.signer.toLowerCase() !== expectedSigners[index]!.toLowerCase())) {
    throw new Error("V5 refund attester signer identity is invalid.")
  }
  return results[0]!
}

export async function readPayoutV5RefundQuorum(args: {
  config: EnabledQuorumAttesterClientConfig
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const quorums = await Promise.all(proofUrls(args.config).map(async (baseUrl) => parseRefundQuorum(await postJson({
    baseUrl,
    path: "/refund-quorum",
    token: args.config.internalToken,
    body: {
      adapterVersion: args.config.adapterVersion,
      intentHash: assertHash(args.intentHash, "intentHash"),
      submissionTxHash: assertHash(args.submissionTxHash, "submissionTxHash")
    },
    fetchImpl: args.fetchImpl
  }))))
  return aggregateQuorums(quorums, "refund", [args.config.primaryProofSigner, args.config.secondaryProofSigner])
}

export async function requestPayoutV6ProofAttestation(args: {
  config: Extract<PayoutV6AttesterClientConfig | PayoutV7AttesterClientConfig, { enabled: true }>
  intentHash: Hex
  submissionTxHash: Hex
  fetchImpl?: FetchLike
}) {
  const expectedSigners = [args.config.primaryProofSigner, args.config.secondaryProofSigner]
  const quorums = await Promise.all(proofUrls(args.config).map(async (baseUrl, index) => {
    const response = await postJson({
      baseUrl, path: "/attest", token: args.config.internalToken,
      body: {
        adapterVersion: args.config.adapterVersion,
        intentHash: assertHash(args.intentHash, "intentHash"),
        submissionTxHash: assertHash(args.submissionTxHash, "submissionTxHash")
      },
      fetchImpl: args.fetchImpl
    }) as Record<string, unknown>
    const parsed = parseProof(response)
    const signer = assertAddress(response.signer, "proof attester signer")
    const signature = readSignature(response.signature, "proof attester signature")
    const proofDigest = assertHash(response.proofDigest, "proof digest")
    const threshold = assertUnsigned(response.threshold, "proof threshold")
    const verifierEpoch = assertUnsigned(response.verifierEpoch, "proof verifier epoch")
    if (parsed.proof.intentHash !== args.intentHash.toLowerCase() || threshold === 0n) {
      throw new Error(`${args.config.adapterVersion.toUpperCase()} completion proof binding is invalid.`)
    }
    const recovered = await recoverAddress({ hash: proofDigest, signature })
    if (signer !== expectedSigners[index]!.toLowerCase() || recovered.toLowerCase() !== signer) {
      throw new Error(`${args.config.adapterVersion.toUpperCase()} proof attester signer identity is invalid.`)
    }
    return { ...parsed, threshold, verifierEpoch, proofDigest, signatures: [signature], signers: [signer] }
  }))
  return aggregateQuorums(quorums, "completion", expectedSigners)
}

export const requestPayoutV6RefundAttestation = requestPayoutV5RefundAttestation
export const readPayoutV6RefundQuorum = readPayoutV5RefundQuorum

function requirePayoutV7Config(config: Extract<PayoutV7AttesterClientConfig, { enabled: true }>) {
  if (config.adapterVersion !== "v7") throw new Error("V7 attester requests require an explicit V7 configuration.")
  return config
}

export function requestPayoutV7Provenance(args: Omit<Parameters<typeof requestPayoutV4Provenance>[0], "config"> & { config: Extract<PayoutV7AttesterClientConfig, { enabled: true }> }) {
  return requestPayoutV4Provenance({ ...args, config: requirePayoutV7Config(args.config) })
}

export function requestPayoutV7ProofAttestation(args: Omit<Parameters<typeof requestPayoutV6ProofAttestation>[0], "config"> & { config: Extract<PayoutV7AttesterClientConfig, { enabled: true }> }) {
  return requestPayoutV6ProofAttestation({ ...args, config: requirePayoutV7Config(args.config) })
}

export function requestPayoutV7RefundAttestation(args: Omit<Parameters<typeof requestPayoutV5RefundAttestation>[0], "config"> & { config: Extract<PayoutV7AttesterClientConfig, { enabled: true }> }) {
  return requestPayoutV5RefundAttestation({ ...args, config: requirePayoutV7Config(args.config) })
}

export function readPayoutV7RefundQuorum(args: Omit<Parameters<typeof readPayoutV5RefundQuorum>[0], "config"> & { config: Extract<PayoutV7AttesterClientConfig, { enabled: true }> }) {
  return readPayoutV5RefundQuorum({ ...args, config: requirePayoutV7Config(args.config) })
}
