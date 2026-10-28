import assert from "node:assert/strict"
import { test } from "node:test"
import { privateKeyToAccount } from "viem/accounts"

const client = await import("../dist/apps/relayer/src/phase3/payout-v4-attester-client.js")

const HASH_A = `0x${"a".repeat(64)}`
const HASH_B = `0x${"b".repeat(64)}`
const SIGNATURE_A = `0x${"1".repeat(130)}`
const SIGNATURE_B = `0x${"2".repeat(130)}`
const SIGNATURE_C = `0x${"3".repeat(130)}`
const ADDRESS_A = "0x1111111111111111111111111111111111111111"
const ADDRESS_B = "0x2222222222222222222222222222222222222222"
const ADDRESS_C = "0x3333333333333333333333333333333333333333"
const V6_SIGNERS = ["4", "5"].map((digit) => privateKeyToAccount(`0x${digit.repeat(64)}`))

function v6Config() {
  return v5Config({
    adapterVersion: "v6",
    primaryProofSigner: V6_SIGNERS[0].address,
    secondaryProofSigner: V6_SIGNERS[1].address
  })
}

async function v6ProofPayload(url, extra = {}) {
  const account = V6_SIGNERS[url.includes("proof-b") ? 1 : 0]
  const payload = proofPayload({
    signer: account.address,
    threshold: "2",
    verifierEpoch: "5",
    proofDigest: HASH_A,
    ...extra
  })
  payload.signature = extra.signature ?? await account.sign({ hash: payload.proofDigest ?? HASH_A })
  return payload
}

function config() {
  return {
    enabled: true,
    adapterVersion: "v4",
    provenanceApiBaseUrl: "https://provenance.example.test",
    proofApiBaseUrl: "https://proof.example.test",
    internalToken: "t".repeat(48)
  }
}

function v5Config(extra = {}) {
  return {
    ...config(),
    adapterVersion: "v5",
    secondaryProofApiBaseUrl: "https://proof-b.example.test",
    primaryProofSigner: ADDRESS_A,
    secondaryProofSigner: ADDRESS_B,
    ...extra
  }
}

function proofPayload(extra = {}) {
  return {
    proof: {
      intentHash: HASH_A,
      providerSubmissionId: HASH_B,
      requestIdHash: HASH_A,
      destinationChainId: "56",
      destinationToken: ADDRESS_A,
      destinationRecipientHash: HASH_B,
      destinationAmountOut: "1000000",
      destinationTxHash: HASH_A,
      destinationLogIndex: "4",
      destinationBlockNumber: "100",
      destinationBlockHash: HASH_B,
      finalityConfirmations: "12",
      proofNonce: HASH_A
    },
    proofHash: HASH_B,
    signer: ADDRESS_A,
    ...extra
  }
}

function refundPayload(extra = {}) {
  return {
    proof: {
      intentHash: HASH_A,
      requestIdHash: HASH_B,
      escrow: ADDRESS_A,
      refundToken: ADDRESS_B,
      refundAmount: "900000",
      refundChainId: "4217",
      refundTxHash: HASH_A,
      refundLogIndex: "3",
      refundBlockNumber: "200",
      refundBlockHash: HASH_B,
      finalityConfirmations: "1",
      terminalStatusHash: HASH_A,
      proofNonce: HASH_B
    },
    proofHash: HASH_A,
    signer: ADDRESS_A,
    ...extra
  }
}

test("V4 attester client is disabled by default and requires both internal attesters when enabled", () => {
  assert.deepEqual(client.readPayoutV4AttesterClientConfig({}), {
    enabled: false,
    reason: "phase3_payout_v4_relayer_worker_disabled"
  })
  assert.throws(
    () => client.readPayoutV4AttesterClientConfig({ PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED: "true" }),
    /PROVENANCE_ATTESTER_URL/u
  )
})

test("attester clients allow only the fixed private service aliases over HTTP", () => {
  const internalToken = "t".repeat(48)
  const config = client.readPayoutV4AttesterClientConfig({
    PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED: "true",
    PHASE3_PAYOUT_V4_PROVENANCE_ATTESTER_URL: "http://proof-attester-provenance:8085",
    PHASE3_PAYOUT_V4_PROOF_ATTESTER_URL: "http://proof-attester-a:8083",
    PHASE3_PAYOUT_V4_ATTESTER_INTERNAL_TOKEN: internalToken
  })
  assert.equal(config.provenanceApiBaseUrl, "http://proof-attester-provenance:8085/")
  assert.equal(config.proofApiBaseUrl, "http://proof-attester-a:8083/")
  assert.throws(
    () => client.readPayoutV4AttesterClientConfig({
      PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED: "true",
      PHASE3_PAYOUT_V4_PROVENANCE_ATTESTER_URL: "http://proof-attester-provenance:8085",
      PHASE3_PAYOUT_V4_PROOF_ATTESTER_URL: "http://proof-attester-a:8084",
      PHASE3_PAYOUT_V4_ATTESTER_INTERNAL_TOKEN: internalToken
    }),
    /must use HTTPS/u
  )
})

test("V4 attester client sends only immutable public evidence identifiers", async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    return { ok: true, status: 200, async json() { return proofPayload({ signature: SIGNATURE_A }) } }
  }
  const result = await client.requestPayoutV4ProofAttestation({
    config: config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl
  })
  assert.equal(result.proof.intentHash, HASH_A)
  assert.equal(result.signature, SIGNATURE_A)
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.match(request.url, /\/attest$/u)
  assert.equal(request.init.headers.authorization, `Bearer ${"t".repeat(48)}`)
  assert.deepEqual(JSON.parse(request.init.body), {
    adapterVersion: "v4",
    intentHash: HASH_A,
    submissionTxHash: HASH_B
  })
  assert.doesNotMatch(request.init.body, /recipient|providerData|refund|private/iu)
})

test("V4 attester client accepts a quorum only when the attester returns canonical signatures", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return proofPayload({
        ready: true,
        threshold: "2",
        verifierEpoch: "5",
        proofDigest: HASH_A,
        signatures: [SIGNATURE_A, SIGNATURE_B],
        signers: [ADDRESS_A, ADDRESS_B]
      })
    }
  })
  const quorum = await client.readPayoutV4ProofQuorum({
    config: config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl
  })
  assert.equal(quorum.ready, true)
  assert.deepEqual(quorum.signatures, [SIGNATURE_A, SIGNATURE_B])
})

test("V5 attester client requires a distinct automated signer-B service", () => {
  assert.deepEqual(client.readPayoutV5AttesterClientConfig({}), {
    enabled: false,
    reason: "phase3_payout_v5_relayer_worker_disabled"
  })
  assert.throws(
    () => client.readPayoutV5AttesterClientConfig({
      PHASE3_PAYOUT_V5_RELAYER_WORKER_ENABLED: "true",
      PHASE3_PAYOUT_V5_PROVENANCE_ATTESTER_URL: "https://provenance.example.test",
      PHASE3_PAYOUT_V5_PROOF_ATTESTER_URL: "https://proof.example.test",
      PHASE3_PAYOUT_V5_ATTESTER_INTERNAL_TOKEN: "t".repeat(48)
    }),
    /PROOF_ATTESTER_B_URL/u
  )
})

test("V5 requests matching completion signatures from both automated proof services", async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      async json() {
        return proofPayload({
          signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A,
          signer: url.includes("proof-b") ? ADDRESS_B : ADDRESS_A
        })
      }
    }
  }
  const result = await client.requestPayoutV5ProofAttestation({
    config: v5Config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl
  })
  assert.equal(result.proofHash, HASH_B)
  assert.deepEqual(requests.map((request) => request.url).sort(), ["https://proof-b.example.test/attest", "https://proof.example.test/attest"])
  assert.equal(requests.every((request) => request.body.adapterVersion === "v5"), true)
})

test("V6 attester client never falls back to a V5 or V4 internal token", () => {
  const env = {
    PHASE3_PAYOUT_V6_RELAYER_WORKER_ENABLED: "true",
    PHASE3_PAYOUT_V6_PROVENANCE_ATTESTER_URL: "https://provenance.example.test",
    PHASE3_PAYOUT_V6_PROOF_ATTESTER_URL: "https://proof.example.test",
    PHASE3_PAYOUT_V6_PROOF_ATTESTER_B_URL: "https://proof-b.example.test",
    PHASE3_PAYOUT_V6_PROOF_SIGNER_A: ADDRESS_A,
    PHASE3_PAYOUT_V6_PROOF_SIGNER_B: ADDRESS_B,
    PHASE3_PAYOUT_V5_ATTESTER_INTERNAL_TOKEN: "v".repeat(48),
    PHASE3_PAYOUT_V4_ATTESTER_INTERNAL_TOKEN: "w".repeat(48)
  }
  assert.throws(() => client.readPayoutV6AttesterClientConfig(env), /internal token/u)
})

test("V6 requests bind provenance, completion and refund proofs to the V6 domain", async () => {
  const configV6 = v6Config()
  const bodies = []
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      async json() {
        if (url.endsWith("/provenance")) {
          return {
            attestation: {
              intentHash: HASH_A,
              sourcePool: ADDRESS_A,
              token: ADDRESS_B,
              assetId: "1",
              amount: "1000000",
              escrow: ADDRESS_C,
              withdrawalTxHash: HASH_B,
              transferLogIndex: "0",
              blockNumber: "1",
              blockHash: HASH_A,
              attestationNonce: HASH_B
            },
            signature: SIGNATURE_A
          }
        }
        if (url.endsWith("/attest-refund")) {
          return refundPayload({
            signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A,
            signer: url.includes("proof-b") ? configV6.secondaryProofSigner : configV6.primaryProofSigner
          })
        }
        return v6ProofPayload(url)
      }
    }
  }
  await client.requestPayoutV6Provenance({ config: configV6, intentHash: HASH_A, withdrawalTxHash: HASH_B, fetchImpl })
  await client.requestPayoutV6ProofAttestation({ config: configV6, intentHash: HASH_A, submissionTxHash: HASH_B, fetchImpl })
  await client.requestPayoutV6RefundAttestation({ config: configV6, intentHash: HASH_A, submissionTxHash: HASH_B, fetchImpl })
  assert.equal(bodies.length, 5)
  assert.equal(bodies.every((body) => body.adapterVersion === "v6"), true)
})

test("V6 completion uses both signed responses without another quorum request", async () => {
  const paths = []
  const result = await client.requestPayoutV6ProofAttestation({
    config: v6Config(), intentHash: HASH_A, submissionTxHash: HASH_B,
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname)
      assert.equal(new URL(url).pathname, "/attest")
      return { ok: true, status: 200, json: () => v6ProofPayload(url) }
    }
  })
  assert.equal(result.ready, true)
  assert.equal(result.threshold, 2n)
  assert.equal(result.verifierEpoch, 5n)
  assert.equal(result.proofDigest, HASH_A)
  assert.deepEqual(result.signers, V6_SIGNERS.map((account) => account.address))
  assert.equal(result.signatures.length, 2)
  assert.deepEqual(paths, ["/attest", "/attest"])
})

test("V6 completion rejects mismatched proof, epoch, digest, signer and missing metadata", async () => {
  for (const extra of [
    { proofHash: HASH_A }, { verifierEpoch: "6" }, { proofDigest: HASH_B },
    { signer: ADDRESS_C }, { signature: SIGNATURE_C }, { threshold: undefined },
    { verifierEpoch: undefined }, { proofDigest: undefined },
    { proof: { ...proofPayload().proof, intentHash: HASH_B } }
  ]) {
    await assert.rejects(client.requestPayoutV6ProofAttestation({
      config: v6Config(), intentHash: HASH_A, submissionTxHash: HASH_B,
      fetchImpl: async (url) => ({
        ok: true, status: 200,
        json: () => v6ProofPayload(url, url.includes("proof-b") ? extra : {})
      })
    }))
  }
})

test("V6 never treats one signature or an unmet verifier threshold as completion", async () => {
  await assert.rejects(client.requestPayoutV6ProofAttestation({
    config: v6Config(), intentHash: HASH_A, submissionTxHash: HASH_B,
    fetchImpl: async (url) => ({
      ok: !url.includes("proof-b"), status: url.includes("proof-b") ? 503 : 200,
      json: () => v6ProofPayload(url)
    })
  }))
  const quorum = await client.requestPayoutV6ProofAttestation({
    config: v6Config(), intentHash: HASH_A, submissionTxHash: HASH_B,
    fetchImpl: async (url) => ({
      ok: true, status: 200, json: () => v6ProofPayload(url, { threshold: "3" })
    })
  })
  assert.equal(quorum.ready, false)
})

test("V6 attester requests propagate deadline cancellation", async (t) => {
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("deadline", "TimeoutError")))
  await assert.rejects(client.requestPayoutV6ProofAttestation({
    config: v6Config(), intentHash: HASH_A, submissionTxHash: HASH_B,
    fetchImpl: async (url, init) => {
      init.signal?.throwIfAborted()
      return { ok: true, status: 200, json: () => v6ProofPayload(url) }
    }
  }), { name: "TimeoutError" })
})

test("V5 aggregates completion quorum from independent signature stores", async () => {
  const quorum = await client.readPayoutV5ProofQuorum({
    config: v5Config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async json() {
        return proofPayload({
          ready: false,
          threshold: "2",
          verifierEpoch: "5",
          proofDigest: HASH_A,
          signatures: [url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A],
          signers: [url.includes("proof-b") ? ADDRESS_B : ADDRESS_A]
        })
      }
    })
  })
  assert.equal(quorum.ready, true)
  assert.equal(quorum.threshold, 2n)
  assert.deepEqual(quorum.signatures.sort(), [SIGNATURE_A, SIGNATURE_B])
})

test("V5 ignores additional approved signatures while requiring automated A and B", async () => {
  const quorum = await client.readPayoutV5ProofQuorum({
    config: v5Config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async json() {
        const isSecondary = url.includes("proof-b")
        return proofPayload({
          ready: true,
          threshold: "2",
          verifierEpoch: "5",
          proofDigest: HASH_A,
          signatures: isSecondary ? [SIGNATURE_B] : [SIGNATURE_A, SIGNATURE_C],
          signers: isSecondary ? [ADDRESS_B] : [ADDRESS_A, ADDRESS_C]
        })
      }
    })
  })
  assert.equal(quorum.ready, true)
  assert.deepEqual(quorum.signatures, [SIGNATURE_A, SIGNATURE_B])
  assert.deepEqual(quorum.signers, [ADDRESS_A, ADDRESS_B])
})

test("V5 rejects base URLs that resolve to the same attestation endpoint", async () => {
  await assert.rejects(
    () => client.requestPayoutV5ProofAttestation({
      config: v5Config({ secondaryProofApiBaseUrl: "https://proof.example.test/other-path?service=b" }),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async () => { throw new Error("must not fetch") }
    }),
    /distinct service endpoints/u
  )
})

test("V5 rejects duplicate signer identities even across distinct services", async () => {
  await assert.rejects(
    () => client.requestPayoutV5ProofAttestation({
      config: v5Config({ secondaryProofSigner: ADDRESS_A }),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async () => { throw new Error("must not fetch") }
    }),
    /distinct signer identities/u
  )
})

test("V5 rejects a service that does not return its configured signer identity", async () => {
  await assert.rejects(
    () => client.requestPayoutV5ProofAttestation({
      config: v5Config(),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return proofPayload({ signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A, signer: ADDRESS_A })
        }
      })
    }),
    /signer identity is invalid/u
  )
})

test("V5 rejects quorum signatures built under different verifier epochs", async () => {
  await assert.rejects(
    () => client.readPayoutV5ProofQuorum({
      config: v5Config(),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return proofPayload({
            ready: false,
            threshold: "2",
            verifierEpoch: url.includes("proof-b") ? "6" : "5",
            proofDigest: url.includes("proof-b") ? HASH_B : HASH_A,
            signatures: [url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A],
            signers: [url.includes("proof-b") ? ADDRESS_B : ADDRESS_A]
          })
        }
      })
    }),
    /verifier proof digest/u
  )
})

test("V5 rejects completion signatures for different proof hashes", async () => {
  await assert.rejects(
    () => client.requestPayoutV5ProofAttestation({
      config: v5Config(),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return proofPayload({
            proofHash: url.includes("proof-b") ? HASH_A : HASH_B,
            signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A,
            signer: url.includes("proof-b") ? ADDRESS_B : ADDRESS_A
          })
        }
      })
    }),
    /disagree on the proof hash/u
  )
})

test("V5 parses refund proofs and requests both automated proof services", async () => {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    return {
      ok: true,
      status: 200,
      async json() {
        return refundPayload({
          signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A,
          signer: url.includes("proof-b") ? ADDRESS_B : ADDRESS_A
        })
      }
    }
  }
  const result = await client.requestPayoutV5RefundAttestation({
    config: v5Config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl
  })
  assert.equal(result.proof.refundAmount, 900000n)
  assert.deepEqual(requests.sort(), ["https://proof-b.example.test/attest-refund", "https://proof.example.test/attest-refund"])

  const quorum = await client.readPayoutV5RefundQuorum({
    config: v5Config(),
    intentHash: HASH_A,
    submissionTxHash: HASH_B,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async json() {
        return refundPayload({
          ready: false,
          threshold: "2",
          verifierEpoch: "5",
          proofDigest: HASH_B,
          signatures: [url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A],
          signers: [url.includes("proof-b") ? ADDRESS_B : ADDRESS_A]
        })
      }
    })
  })
  assert.equal(quorum.ready, true)
  assert.deepEqual(quorum.signatures, [SIGNATURE_A, SIGNATURE_B])
})

test("V5 rejects refund signatures for different proof hashes", async () => {
  await assert.rejects(
    () => client.requestPayoutV5RefundAttestation({
      config: v5Config(),
      intentHash: HASH_A,
      submissionTxHash: HASH_B,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return refundPayload({
            proofHash: url.includes("proof-b") ? HASH_B : HASH_A,
            signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A,
            signer: url.includes("proof-b") ? ADDRESS_B : ADDRESS_A
          })
        }
      })
    }),
    /disagree on the proof hash/u
  )
})

test("V7 attester config uses only explicit V7 endpoints, signer identities and token", () => {
  assert.equal(typeof client.readPayoutV7AttesterClientConfig, "function", "missing V7 client config")
  assert.equal(client.readPayoutV7AttesterClientConfig({}).enabled, false)
  const env = { PHASE3_PAYOUT_V7_RELAYER_WORKER_ENABLED: "true", PHASE3_PAYOUT_V7_PROVENANCE_ATTESTER_URL: "https://v7-provenance.example.test",
    PHASE3_PAYOUT_V7_PROOF_ATTESTER_URL: "https://v7-proof.example.test", PHASE3_PAYOUT_V7_PROOF_ATTESTER_B_URL: "https://v7-proof-b.example.test",
    PHASE3_PAYOUT_V7_PROOF_SIGNER_A: ADDRESS_A, PHASE3_PAYOUT_V7_PROOF_SIGNER_B: ADDRESS_B, PHASE3_PAYOUT_V7_ATTESTER_INTERNAL_TOKEN: "v".repeat(48) }
  const parsed = client.readPayoutV7AttesterClientConfig(env)
  assert.equal(parsed.adapterVersion, "v7")
  assert.equal(parsed.internalToken, env.PHASE3_PAYOUT_V7_ATTESTER_INTERNAL_TOKEN)
  for (const key of Object.keys(env).filter(key => !key.endsWith("ENABLED"))) assert.throws(() => client.readPayoutV7AttesterClientConfig({ ...env, [key]: undefined,
    PHASE3_PAYOUT_V6_ATTESTER_INTERNAL_TOKEN: "t".repeat(48), PHASE3_PAYOUT_V6_PROOF_ATTESTER_URL: "https://proof.example.test" }))
})

test("V7 proof requests retain bounded quorum validation but select the V7 HTTP domain", async () => {
  assert.equal(typeof client.requestPayoutV7ProofAttestation, "function", "missing V7 proof client")
  const requests = [], result = await client.requestPayoutV7ProofAttestation({ config: { ...v6Config(), adapterVersion: "v7" }, intentHash: HASH_A, submissionTxHash: HASH_B,
    fetchImpl: async (url, init) => { requests.push(JSON.parse(init.body)); assert.ok(init.signal); return { ok: true, status: 200, json: async () => v6ProofPayload(url) } } })
  assert.equal(result.ready, true)
  assert.ok(requests.every(body => body.adapterVersion === "v7"))
  assert.deepEqual(result.signers.map(s => s.toLowerCase()), V6_SIGNERS.map(s => s.address.toLowerCase()))
})

test("V7 refund requests and quorum select explicit V7 bodies without changing proof fields", async () => {
  assert.equal(typeof client.requestPayoutV7RefundAttestation, "function", "missing V7 refund client")
  assert.equal(typeof client.readPayoutV7RefundQuorum, "function", "missing V7 refund quorum")
  const cfg = { ...v5Config(), adapterVersion: "v7" }, bodies = []
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => refundPayload({
    signature: url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A, signer: url.includes("proof-b") ? ADDRESS_B : ADDRESS_A,
    ready: true, threshold: "2", verifierEpoch: "5", proofDigest: HASH_B, signatures: [url.includes("proof-b") ? SIGNATURE_B : SIGNATURE_A], signers: [url.includes("proof-b") ? ADDRESS_B : ADDRESS_A] }) } }
  assert.equal((await client.requestPayoutV7RefundAttestation({ config: cfg, intentHash: HASH_A, submissionTxHash: HASH_B, fetchImpl })).proof.refundAmount, 900000n)
  assert.equal((await client.readPayoutV7RefundQuorum({ config: cfg, intentHash: HASH_A, submissionTxHash: HASH_B, fetchImpl })).ready, true)
  assert.ok(bodies.every(body => body.adapterVersion === "v7"))
})

test("V7 entry points reject V6 configuration before making a request", () => {
  assert.equal(typeof client.requestPayoutV7Provenance, "function")
  for (const method of [client.requestPayoutV7Provenance, client.requestPayoutV7ProofAttestation, client.requestPayoutV7RefundAttestation, client.readPayoutV7RefundQuorum]) {
    assert.throws(() => method({ config: v6Config(), intentHash: HASH_A, withdrawalTxHash: HASH_B, submissionTxHash: HASH_B,
      fetchImpl: () => assert.fail("Wrong-domain configuration reached fetch") }), /explicit V7 configuration/)
  }
})

test("V7 provenance client sends only the immutable identifiers under its own authorization domain", async () => {
  let requested
  const result = await client.requestPayoutV7Provenance({ config: { ...v6Config(), adapterVersion: "v7" }, intentHash: HASH_A, withdrawalTxHash: HASH_B,
    fetchImpl: async (url, init) => { requested = { url, init }; return { ok: true, status: 200, json: async () => ({ signature: SIGNATURE_A,
      attestation: { intentHash: HASH_A, sourcePool: ADDRESS_A, token: ADDRESS_B, assetId: "1", amount: "1000000", escrow: ADDRESS_C,
        withdrawalTxHash: HASH_B, transferLogIndex: "1", blockNumber: "123", blockHash: HASH_A, attestationNonce: HASH_B } }) } } })
  assert.equal(result.attestation.intentHash, HASH_A)
  assert.equal(requested.url, "https://provenance.example.test/provenance")
  assert.equal(requested.init.headers.authorization, `Bearer ${"t".repeat(48)}`)
  assert.deepEqual(JSON.parse(requested.init.body), { adapterVersion: "v7", intentHash: HASH_A, withdrawalTxHash: HASH_B })
})
