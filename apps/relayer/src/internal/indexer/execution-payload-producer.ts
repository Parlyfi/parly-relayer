import { createCipheriv, createDecipheriv, createHash, randomBytes as nodeRandomBytes } from "node:crypto"
import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
  type TypedDataDefinition
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { assertPhase3AttemptDomain, type Phase3LiveFeederAttempt, type Phase3Tip1022FeederObservation } from "./live-feeder.js"
import { assertTip1022VirtualAddressBinding } from "./tip1022.js"
import {
  buildAttemptRegistrationSubmission,
  buildObservationSubmission,
  toDepositObservation,
  type DepositObservation
} from "./observation-worker.js"

const HASH_RE = /^0x[a-fA-F0-9]{64}$/u
const EXECUTION_AAD = Buffer.from("parly-phase3-relayer-execution-v1", "utf8")

type QueryExecutor = {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>
}

type Sealed = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; payloadHash: string }
type Seed = {
  envelope: Hex
  innerCommitment: string
  beneficiaryPolicySubject: Address
  principalAmountBaseUnits: string
  finalizerFeeBaseUnits: string
  payerTotalBaseUnits: string
  relayRequestIdHash: Hex
  routeType: 0 | 3
  paymentMethod: 1 | 2
}

export type ReceivingExecutionSeedValidation = (input: {
  attempt: Phase3LiveFeederAttempt
  observation: DepositObservation
  seed: Readonly<Seed>
  domain: Pick<PrivateExecutionProducerConfig, "chainId" | "settlementDomainId" | "environment" | "masterAddress" | "receiverAddress" | "virtualMasterId">
}) => Promise<void | { version: 4 }>

export type PrivateExecutionProducerConfig = {
  chainId: 4217
  settlementDomainId: 4217
  environment: Hex
  masterAddress: Address
  receiverAddress: Address
  virtualMasterId: Hex
  relayerOperatorAddress: Address
  attemptSignerPrivateKey: Hex
  observationSignerPrivateKey: Hex
  settlementSignerPrivateKey: Hex
  attemptSigner: Address
  observationSigner: Address
  settlementSigner: Address
  seedEncryptionKey: Buffer
  seedEncryptionKeyVersion?: string
  seedEncryptionKeys?: Record<string, Buffer>
  executionEncryptionKey: Buffer
  maxAttempts: number
}

const ATTEMPT_TYPES = {
  AttemptAuthorization: [
    { name: "chainId", type: "uint256" },
    { name: "settlementDomainId", type: "uint256" },
    { name: "environment", type: "bytes32" },
    { name: "verifyingContract", type: "address" },
    { name: "attemptId", type: "bytes32" },
    { name: "authorizationNonce", type: "bytes32" },
    { name: "userTagHash", type: "bytes32" },
    { name: "routeHash", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "pool", type: "address" },
    { name: "assetId", type: "uint256" },
    { name: "expectedAmount", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "refundWalletCommitment", type: "bytes32" },
    { name: "paymentContext", type: "uint8" },
    { name: "refundClaimantBinding", type: "uint8" },
    { name: "statusAccessTokenHash", type: "bytes32" }
  ]
} as const

const OBSERVATION_TYPES = {
  ObservationAttestation: [
    { name: "chainId", type: "uint256" },
    { name: "settlementDomainId", type: "uint256" },
    { name: "environment", type: "bytes32" },
    { name: "verifyingContract", type: "address" },
    { name: "attemptId", type: "bytes32" },
    { name: "observationId", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "virtualAddress", type: "address" },
    { name: "txHash", type: "bytes32" },
    { name: "logIndexA", type: "uint256" },
    { name: "logIndexB", type: "uint256" },
    { name: "observedBlockNumber", type: "uint256" },
    { name: "routeHash", type: "bytes32" },
    { name: "userTagHash", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const

const SETTLEMENT_TYPES = {
  SettlementAuthorization: [
    { name: "chainId", type: "uint256" }, { name: "settlementDomainId", type: "uint256" },
    { name: "environment", type: "bytes32" }, { name: "verifyingContract", type: "address" },
    { name: "attemptId", type: "bytes32" }, { name: "authorizationNonce", type: "bytes32" },
    { name: "depositObservationId", type: "bytes32" }, { name: "routeType", type: "uint8" },
    { name: "paymentMethod", type: "uint8" }, { name: "assetId", type: "uint256" },
    { name: "token", type: "address" }, { name: "pool", type: "address" },
    { name: "receiver", type: "address" }, { name: "virtualMasterId", type: "bytes32" },
    { name: "userTagHash", type: "bytes32" }, { name: "virtualAddress", type: "address" },
    { name: "expectedAmount", type: "uint256" }, { name: "observedAmount", type: "uint256" },
    { name: "payerTotal", type: "uint256" }, { name: "settlementFee", type: "uint256" },
    { name: "finalizerFee", type: "uint256" }, { name: "amountToShield", type: "uint256" },
    { name: "feeRecipient", type: "address" }, { name: "maxFinalizerFee", type: "uint256" },
    { name: "beneficiaryPolicySubject", type: "address" },
    { name: "refundWalletCommitment", type: "bytes32" },
    { name: "depositTxHash", type: "bytes32" }, { name: "depositLogIndexA", type: "uint256" },
    { name: "depositLogIndexB", type: "uint256" }, { name: "depositBlockNumber", type: "uint256" },
    { name: "relayRequestIdHash", type: "bytes32" }, { name: "routeHash", type: "bytes32" },
    { name: "statusAccessTokenHash", type: "bytes32" }, { name: "expiresAt", type: "uint256" },
    { name: "innerCommitment", type: "uint256" }, { name: "envelopeHash", type: "bytes32" }
  ]
} as const

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function encodePayload(payload: unknown) {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? { __parlyBigInt: value.toString() } : value
  )
}

function decodePayload(serialized: string) {
  return JSON.parse(serialized, (_key, value) =>
    value && typeof value === "object" && Object.keys(value).length === 1 &&
    typeof value.__parlyBigInt === "string" && /^(0|[1-9][0-9]*)$/u.test(value.__parlyBigInt)
      ? BigInt(value.__parlyBigInt)
      : value
  )
}

function seedAad(attemptId: string) {
  if (!HASH_RE.test(attemptId)) throw new Error("attemptId must be bytes32")
  return Buffer.from(`parly-phase3-one-time-seed-v1:${attemptId.toLowerCase()}`, "utf8")
}

function seal(serialized: string, key: Buffer, aad: Buffer, iv: Buffer): Sealed {
  if (key.length !== 32 || iv.length !== 12) throw new Error("private payload encryption configuration is invalid")
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()])
  return { ciphertext, iv: Buffer.from(iv), authTag: cipher.getAuthTag(), payloadHash: sha256(serialized) }
}

function open(sealed: Sealed, key: Buffer, aad: Buffer) {
  if (key.length !== 32) throw new Error("private payload encryption key is invalid")
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(sealed.authTag)
  const serialized = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8")
  if (sha256(serialized) !== sealed.payloadHash) throw new Error("private payload hash mismatch")
  return serialized
}

export function encryptOneTimeExecutionSeed(args: {
  attemptId: string; seed: Seed; encryptionKey: Buffer; iv: Buffer
}): Sealed {
  return seal(JSON.stringify(args.seed), args.encryptionKey, seedAad(args.attemptId), args.iv)
}

function decryptSeed(args: { attemptId: string; sealed: Sealed; encryptionKey: Buffer }): Seed {
  return JSON.parse(open(args.sealed, args.encryptionKey, seedAad(args.attemptId))) as Seed
}
export { decryptSeed as decryptOneTimeExecutionSeed }
export async function signReceivingSettlementV4(config: PrivateExecutionProducerConfig, message: TypedDataDefinition<typeof SETTLEMENT_TYPES, "SettlementAuthorization">["message"]) {
  if (message.chainId !== BigInt(config.chainId) || message.settlementDomainId !== BigInt(config.settlementDomainId) || message.environment !== config.environment || getAddress(message.verifyingContract) !== getAddress(config.masterAddress) || message.paymentMethod !== 2 || ![0, 3].includes(message.routeType)) throw Error("V4 settlement domain mismatch")
  return privateKeyToAccount(config.settlementSignerPrivateKey).signTypedData({
    domain: { name: "ParlyPhase3Settlement", version: "1", chainId: config.chainId, verifyingContract: config.masterAddress },
    primaryType: "SettlementAuthorization", types: SETTLEMENT_TYPES, message
  })
}

function encryptExecutionPayload(payload: unknown, key: Buffer, iv: Buffer): Sealed {
  return seal(encodePayload(payload), key, EXECUTION_AAD, iv)
}

export function decryptRelayerExecutionPayload(args: { sealed: Sealed; encryptionKey: Buffer }) {
  return decodePayload(open(args.sealed, args.encryptionKey, EXECUTION_AAD))
}

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKey(env: Record<string, string | undefined>, name: string) {
  const value = required(env, name)
  if (!/^0x[a-fA-F0-9]{64}$/u.test(value)) throw new Error(`${name} must be a private key`)
  return value as Hex
}

function encryptionKey(env: Record<string, string | undefined>, name: string) {
  const key = Buffer.from(required(env, name), "base64")
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`)
  return key
}

function environmentHash(env: Record<string, string | undefined>) {
  const explicit = env.PHASE3_ENVIRONMENT_HASH?.trim()
  if (explicit) {
    if (!HASH_RE.test(explicit)) throw new Error("PHASE3_ENVIRONMENT_HASH must be bytes32")
    return explicit as Hex
  }
  return keccak256(stringToHex(required(env, "PHASE3_ENVIRONMENT_LABEL")))
}

export function readPrivateExecutionProducerConfig(env: Record<string, string | undefined> = process.env) {
  if (env.PHASE3_PRIVATE_EXECUTION_PAYLOAD_PRODUCTION_ENABLED !== "true") return { enabled: false as const }
  const value: PrivateExecutionProducerConfig = {
    chainId: 4217,
    settlementDomainId: 4217,
    environment: environmentHash(env),
    masterAddress: required(env, "PARLY_VIRTUAL_DEPOSIT_MASTER") as Address,
    receiverAddress: required(env, "PARLY_INGRESS_RECEIVER") as Address,
    virtualMasterId: required(env, "PHASE3_VIRTUAL_MASTER_ID") as Hex,
    relayerOperatorAddress: required(env, "RELAYER_ADDRESS") as Address,
    attemptSignerPrivateKey: privateKey(env, "PHASE3_ATTEMPT_SIGNER_PRIVATE_KEY"),
    observationSignerPrivateKey: privateKey(env, "PHASE3_OBSERVATION_SIGNER_PRIVATE_KEY"),
    settlementSignerPrivateKey: privateKey(env, "PHASE3_SETTLEMENT_SIGNER_PRIVATE_KEY"),
    attemptSigner: required(env, "PHASE3_ATTEMPT_SIGNER") as Address,
    observationSigner: required(env, "PHASE3_OBSERVATION_SIGNER") as Address,
    settlementSigner: required(env, "PHASE3_SETTLEMENT_SIGNER") as Address,
    seedEncryptionKey: encryptionKey(env, "PHASE3_ONE_TIME_SEED_ENCRYPTION_KEY_B64"),
    seedEncryptionKeyVersion: env.PHASE3_ONE_TIME_SEED_ENCRYPTION_KEY_VERSION || "v1",
    seedEncryptionKeys: readSeedEncryptionKeys(env),
    executionEncryptionKey: encryptionKey(env, "PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64"),
    maxAttempts: Number(env.PHASE3_EXECUTION_MAX_ATTEMPTS || "3")
  }
  assertPrivateExecutionProducerConfig(value)
  return { enabled: true as const, value, executionDatabaseUrl: required(env, "PHASE3_EXECUTION_DATABASE_URL") }
}

function readSeedEncryptionKeys(env: Record<string, string | undefined>) {
  const versions = JSON.parse(env.PHASE3_ONE_TIME_SEED_ENCRYPTION_KEYS_JSON || "{}") as Record<string, unknown>
  if (!versions || Array.isArray(versions) || typeof versions !== "object" || Object.keys(versions).length > 16) throw new Error("seed key versions are invalid")
  return Object.fromEntries(Object.entries(versions).map(([version, encoded]) => {
    if (!/^[a-zA-Z0-9_-]{1,32}$/u.test(version) || typeof encoded !== "string") throw new Error("seed key version is invalid")
    const key = Buffer.from(encoded, "base64")
    if (key.length !== 32) throw new Error("seed key version must decode to 32 bytes")
    return [version, key]
  }))
}

export function assertPrivateExecutionProducerConfig(config: PrivateExecutionProducerConfig) {
  if (!/^[a-zA-Z0-9_-]{1,32}$/u.test(config.seedEncryptionKeyVersion || "v1")) throw new Error("seed key version is invalid")
  for (const [label, address] of [
    ["master", config.masterAddress], ["receiver", config.receiverAddress],
    ["relayer", config.relayerOperatorAddress], ["attempt signer", config.attemptSigner],
    ["observation signer", config.observationSigner], ["settlement signer", config.settlementSigner]
  ] as const) if (!isAddress(address)) throw new Error(`${label} address is invalid`)
  if (!HASH_RE.test(config.environment) || !HASH_RE.test(config.virtualMasterId)) {
    throw new Error("environment and virtual master id must be bytes32")
  }
  if (getAddress(privateKeyToAccount(config.attemptSignerPrivateKey).address) !== getAddress(config.attemptSigner)) {
    throw new Error("attempt signer private key does not match configured address")
  }
  if (getAddress(privateKeyToAccount(config.observationSignerPrivateKey).address) !== getAddress(config.observationSigner)) {
    throw new Error("observation signer private key does not match configured address")
  }
  if (getAddress(privateKeyToAccount(config.settlementSignerPrivateKey).address) !== getAddress(config.settlementSigner)) {
    throw new Error("settlement signer private key does not match configured address")
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 20) {
    throw new Error("execution max attempts is invalid")
  }
}

export async function validatePrivateExecutionAmounts(args: {
  expectedAmount: bigint; observedAmount: bigint; principalAmountBaseUnits: string;
  finalizerFeeBaseUnits: string; payerTotalBaseUnits: string
}, capBps:100n|300n=100n) {
  const principal = BigInt(args.principalAmountBaseUnits)
  const fee = BigInt(args.finalizerFeeBaseUnits)
  const total = BigInt(args.payerTotalBaseUnits)
  if (fee < 0n || principal <= 0n || principal + fee !== total ||
      args.expectedAmount !== total || args.observedAmount !== total) {
    throw new Error("seed, expected, and observed amounts must exactly match")
  }
  if (![100n,300n].includes(capBps) || fee * 10_000n > total * capBps) throw new Error(`finalizer fee exceeds ${capBps} bps cap`)
  return { principal, fee, total }
}

export type RefundObservationSignerConfig = Pick<PrivateExecutionProducerConfig,
  "chainId" | "settlementDomainId" | "environment" | "masterAddress" | "virtualMasterId" |
  "attemptSignerPrivateKey" | "observationSignerPrivateKey" | "attemptSigner" | "observationSigner"
>

// Internal builder only: the authenticated handler must reread canonical receipt/custody before calling.
export async function signExpiredRefundObservation(args: {
  config: RefundObservationSignerConfig
  funding: Phase3Tip1022FeederObservation
  nowSeconds: bigint
}) {
  const { config, funding, nowSeconds } = args
  const attempt = funding.attempt
  assertPhase3AttemptDomain(attempt, config)
  if (config.chainId !== 4217 || config.settlementDomainId !== 4217 ||
      !/^0x[a-fA-F0-9]{8}0{56}$/u.test(config.virtualMasterId)) throw new Error("refund domain is invalid")
  const registration = buildAttemptRegistrationSubmission({ ...config, attempt })
  if (nowSeconds <= 0n || nowSeconds < registration.authorization.expiresAt) throw new Error("attempt is not expired")
  const raw = funding.observation
  if (!raw || funding.confirmationStatus !== "confirmed" || !funding.blockHash ||
      !HASH_RE.test(funding.blockHash) || /^0x0+$/u.test(funding.blockHash) ||
      !Number.isInteger(funding.minimumConfirmations) || funding.minimumConfirmations < 1 ||
      !Number.isInteger(funding.confirmations) || funding.confirmations < funding.minimumConfirmations ||
      funding.status === "ignored_dust" || raw.amount <= 0n) throw new Error("confirmed refundable funding is required")
  for (const [actual, expected] of [
    [raw.paymentAttemptId, attempt.paymentAttemptId], [raw.masterAddress, config.masterAddress],
    [raw.routeHash, attempt.routeHash], [raw.paymentTagHash, attempt.paymentTagHash]
  ]) if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error("refund observation binding mismatch")
  assertTip1022VirtualAddressBinding({
    address: raw.virtualAddress, expectedMasterId: config.virtualMasterId.slice(0, 10), expectedUserTag: attempt.userTag
  })
  const observation = toDepositObservation(raw)
  if (observation.logIndexA < 0n || observation.logIndexA >= observation.logIndexB ||
      observation.observedBlockNumber <= 0n ||
      !HASH_RE.test(observation.observationId) || /^0x0+$/u.test(observation.observationId) ||
      !HASH_RE.test(observation.txHash) || /^0x0+$/u.test(observation.txHash)) throw new Error("refund observation is invalid")
  const attemptAccount = privateKeyToAccount(config.attemptSignerPrivateKey)
  const observationAccount = privateKeyToAccount(config.observationSignerPrivateKey)
  if (getAddress(attemptAccount.address) !== getAddress(config.attemptSigner)) throw new Error("attempt signer key mismatch")
  if (getAddress(observationAccount.address) !== getAddress(config.observationSigner)) throw new Error("observation signer key mismatch")
  const domain = { name: "ParlyPhase3Settlement", version: "1", chainId: config.chainId, verifyingContract: config.masterAddress } as const
  const prepared = buildObservationSubmission({
    ...config, attemptId: registration.authorization.attemptId, observation,
    expiresAt: nowSeconds + 900n,
    nonce: keccak256(toHex(`refund:${attempt.paymentAttemptId}:${observation.observationId}:${nowSeconds}`))
  })
  return {
    masterAddress: config.masterAddress,
    attemptAuthorization: registration.authorization,
    attemptSignature: await attemptAccount.signTypedData({
      domain, primaryType: "AttemptAuthorization", types: ATTEMPT_TYPES, message: registration.authorization
    }),
    observation,
    observationAttestation: prepared.attestation,
    observationSignature: await observationAccount.signTypedData({
      domain, primaryType: "ObservationAttestation", types: OBSERVATION_TYPES, message: prepared.attestation
    }),
    broadcast: false as const
  }
}

export async function producePrivateExecutionPayload(args: {
  config: PrivateExecutionProducerConfig
  sourceDb: QueryExecutor
  executionDb: QueryExecutor
  attempt: Phase3LiveFeederAttempt
  observation: DepositObservation
  now?: () => Date
  randomBytes?: (size: number) => Buffer
  expectedPaymentMethod?: 1 | 2
  expectedReceivingVersion?: 4 | 99
  validateReceivingSeed?: ReceivingExecutionSeedValidation
  receivingSeedV4?: Seed
}) {
  assertPrivateExecutionProducerConfig(args.config)
  assertPhase3AttemptDomain(args.attempt, args.config)
  const attemptId = args.attempt.paymentAttemptId as Hex
  const result = await args.sourceDb.query<{
    payload_ciphertext: Buffer; payload_iv: Buffer; payload_auth_tag: Buffer; payload_hash: string; payload_key_version?: string
  }>(
    `SELECT payload_ciphertext, payload_iv, payload_auth_tag, payload_hash, payload_key_version
     FROM phase3_private.one_time_execution_seeds WHERE attempt_id = $1`,
    [attemptId.toLowerCase()]
  )
  const row = result.rows[0]
  if (args.receivingSeedV4 && args.expectedReceivingVersion !== 4) throw Error("V4 seed override requires the V4 validation path")
  if (!row && !args.receivingSeedV4) {
    if (args.expectedReceivingVersion === 4) {
      const pending = await args.sourceDb.query(`SELECT a.attempt_id FROM phase3_private.receiving_attempts_v4 a
        JOIN phase3_private.receiving_pending_v4 s ON s.attempt_id=a.attempt_id
        JOIN phase3_private.payment_attempts p ON p.internal_payment_attempt_id=a.attempt_id
        LEFT JOIN phase3_private.receiving_funded_work_v4 w ON w.attempt_id=a.attempt_id AND w.profile_digest=a.profile_digest
        WHERE a.attempt_id=$1 AND p.one_time_chain_id=$2 AND p.one_time_settlement_domain_id=$3
          AND p.one_time_master_address=$4 AND p.one_time_environment=$5
          AND ((p.route_kind='direct_tempo_deposit' AND p.source_chain_id=p.one_time_chain_id)
            OR (p.route_kind='relay_multichain_deposit' AND p.source_chain_id<>p.one_time_chain_id)) AND p.expires_at>CURRENT_TIMESTAMP
          AND (w.status IS NULL OR w.status IN ('queued','leased'))`,
      [attemptId.toLowerCase(), args.config.chainId, args.config.settlementDomainId, args.config.masterAddress.toLowerCase(), args.config.environment.slice(2)])
      if (pending.rows.length === 1) return { queued: false as const, status: "awaiting_preparation" as const }
    }
    throw new Error("private one-time execution seed is missing")
  }
  const version = row?.payload_key_version || "v1"
  const seedKey = version === (args.config.seedEncryptionKeyVersion || "v1")
    ? args.config.seedEncryptionKey : args.config.seedEncryptionKeys?.[version]
  if (!seedKey) throw new Error("original seed encryption key is unavailable")
  const seed = args.receivingSeedV4 ? structuredClone(args.receivingSeedV4) : decryptSeed({
    attemptId,
    sealed: { ciphertext: row!.payload_ciphertext, iv: row!.payload_iv, authTag: row!.payload_auth_tag, payloadHash: row!.payload_hash },
    encryptionKey: seedKey
  })
  const expectedMethod = args.expectedPaymentMethod ?? 1
  if (![1, 2].includes(expectedMethod) || seed.paymentMethod !== expectedMethod) throw new Error("execution seed payment method does not match worker route")
  if (seed.paymentMethod === 2) {
    if (!args.validateReceivingSeed) throw new Error("receiving validator is required")
    const { chainId, settlementDomainId, environment, masterAddress, receiverAddress, virtualMasterId } = args.config
    const validated = await args.validateReceivingSeed(structuredClone({ attempt: args.attempt, observation: args.observation, seed,
      domain: { chainId, settlementDomainId, environment, masterAddress, receiverAddress, virtualMasterId } }))
    if (args.expectedReceivingVersion === 4 && validated?.version !== 4) throw new Error("V4 seed validation receipt is required")
  }
  const amounts = await validatePrivateExecutionAmounts({
    expectedAmount: args.attempt.expectedAmount,
    observedAmount: args.observation.amount,
    ...seed
  }, seed.paymentMethod === 2 && (args.expectedReceivingVersion === 4 || Number(args.config.chainId) === 31337 && Number(args.config.settlementDomainId) === 99) ? 300n : 100n)
  if (!args.attempt.authorizationNonce || !args.attempt.refundWalletCommitment ||
      !args.attempt.poolAddress || args.attempt.assetId === undefined ||
      args.attempt.paymentContext === undefined || args.attempt.refundClaimantBinding === undefined ||
      !args.attempt.statusAccessTokenHash) throw new Error("retained attempt is incomplete")
  const existing = await args.executionDb.query<{
    payload_hash: string; payload_ciphertext: Buffer; payload_iv: Buffer; payload_auth_tag: Buffer
  }>(
    `SELECT payload_hash, payload_ciphertext, payload_iv, payload_auth_tag
     FROM phase3_private.relayer_execution_payloads WHERE attempt_id = $1`,
    [attemptId.toLowerCase()]
  )
  const queued = existing.rows[0]
  const accepted = queued ? decryptRelayerExecutionPayload({
    sealed: { ciphertext: queued.payload_ciphertext, iv: queued.payload_iv, authTag: queued.payload_auth_tag, payloadHash: queued.payload_hash },
    encryptionKey: args.config.executionEncryptionKey
  }) : undefined

  const domain = {
    name: "ParlyPhase3Settlement", version: "1", chainId: args.config.chainId,
    verifyingContract: args.config.masterAddress
  } as const
  const registration = buildAttemptRegistrationSubmission({
    chainId: args.config.chainId,
    settlementDomainId: args.config.settlementDomainId,
    environment: args.config.environment,
    masterAddress: args.config.masterAddress,
    virtualMasterId: args.config.virtualMasterId,
    attempt: args.attempt
  })
  const attemptSignature = await privateKeyToAccount(args.config.attemptSignerPrivateKey).signTypedData({
    domain, primaryType: "AttemptAuthorization", types: ATTEMPT_TYPES, message: registration.authorization
  })
  const nowSeconds = BigInt(Math.floor((args.now ?? (() => new Date()))().getTime() / 1000))
  const attemptExpires = BigInt(Math.floor(args.attempt.expiresAt / 1000))
  // A queued authorization is immutable; retries must not issue a new deadline.
  const expiresAt = queued ? accepted?.settlementAuthorization?.expiresAt
    : attemptExpires < nowSeconds + 900n ? attemptExpires : nowSeconds + 900n
  if (typeof expiresAt !== "bigint" || expiresAt <= 0n || expiresAt > attemptExpires ||
      (queued && accepted?.observationAttestation?.expiresAt !== expiresAt)) throw new Error("queued execution deadline is invalid")
  if (!queued && expiresAt <= nowSeconds) throw new Error("funded attempt authorization is expired")
  const observationPrepared = buildObservationSubmission({
    chainId: args.config.chainId,
    settlementDomainId: args.config.settlementDomainId,
    environment: args.config.environment,
    masterAddress: args.config.masterAddress,
    attemptId,
    observation: args.observation,
    nonce: keccak256(toHex(`${args.observation.observationId}:${args.observation.txHash}`)),
    expiresAt
  })
  const observationSignature = await privateKeyToAccount(args.config.observationSignerPrivateKey).signTypedData({
    domain, primaryType: "ObservationAttestation", types: OBSERVATION_TYPES,
    message: observationPrepared.attestation
  })
  const settlementAuthorization = {
    chainId: BigInt(args.config.chainId), settlementDomainId: BigInt(args.config.settlementDomainId),
    environment: args.config.environment, verifyingContract: args.config.masterAddress,
    attemptId, authorizationNonce: args.attempt.authorizationNonce as Hex,
    depositObservationId: args.observation.observationId, routeType: seed.routeType,
    paymentMethod: seed.paymentMethod, assetId: args.attempt.assetId,
    token: getAddress(args.observation.token), pool: getAddress(args.attempt.poolAddress),
    receiver: getAddress(args.config.receiverAddress), virtualMasterId: args.config.virtualMasterId,
    userTagHash: args.attempt.paymentTagHash as Hex, virtualAddress: getAddress(args.observation.virtualAddress),
    expectedAmount: amounts.total, observedAmount: amounts.total, payerTotal: amounts.total,
    settlementFee: amounts.fee, finalizerFee: amounts.fee, amountToShield: amounts.principal,
    feeRecipient: getAddress(args.config.relayerOperatorAddress), maxFinalizerFee: amounts.fee,
    beneficiaryPolicySubject: getAddress(seed.beneficiaryPolicySubject),
    refundWalletCommitment: args.attempt.refundWalletCommitment as Hex,
    depositTxHash: args.observation.txHash, depositLogIndexA: args.observation.logIndexA,
    depositLogIndexB: args.observation.logIndexB, depositBlockNumber: args.observation.observedBlockNumber,
    relayRequestIdHash: seed.relayRequestIdHash, routeHash: args.attempt.routeHash as Hex,
    statusAccessTokenHash: args.attempt.statusAccessTokenHash as Hex, expiresAt,
    innerCommitment: BigInt(seed.innerCommitment), envelopeHash: keccak256(seed.envelope)
  }
  const settlementSignature = await privateKeyToAccount(args.config.settlementSignerPrivateKey).signTypedData({
    domain, primaryType: "SettlementAuthorization", types: SETTLEMENT_TYPES,
    message: settlementAuthorization
  })
  const payload = {
    masterAddress: args.config.masterAddress,
    relayerOperatorAddress: args.config.relayerOperatorAddress,
    attemptAuthorization: registration.authorization,
    attemptSignature,
    observation: args.observation,
    observationAttestation: observationPrepared.attestation,
    observationSignature,
    settlementAuthorization,
    envelope: seed.envelope,
    settlementSignature
  }
  const randomBytes = args.randomBytes ?? nodeRandomBytes
  const sealed = encryptExecutionPayload(payload, args.config.executionEncryptionKey, randomBytes(12))
  const jobId = `one-time:${attemptId.slice(2).toLowerCase()}`
  if (existing.rows[0]) {
    if (existing.rows[0].payload_hash !== sealed.payloadHash) throw new Error("attempt has a different queued payload")
    return { queued: false, jobId, payloadHash: sealed.payloadHash }
  }
  await args.executionDb.query(
    `WITH inserted AS (
       INSERT INTO phase3_private.relayer_execution_payloads (
         job_id, attempt_id, payload_ciphertext, payload_iv, payload_auth_tag, payload_hash, status, max_attempts
       ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
       ON CONFLICT (attempt_id) DO NOTHING RETURNING job_id
     )
     INSERT INTO phase3_private.relayer_execution_events (event_id, job_id, event_type, evidence_hash)
     SELECT $8, job_id, 'queued', $6 FROM inserted`,
    [
      jobId, attemptId.toLowerCase(), sealed.ciphertext, sealed.iv, sealed.authTag,
      sealed.payloadHash, args.config.maxAttempts,
      `${jobId}:queued:${randomBytes(12).toString("hex")}`
    ]
  )
  return { queued: true, jobId, payloadHash: sealed.payloadHash }
}
