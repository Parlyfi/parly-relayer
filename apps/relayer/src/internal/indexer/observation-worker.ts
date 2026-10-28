import {
  parlyVirtualDepositMasterAttemptRegistrationAbi,
  parlyVirtualDepositMasterObservationRecordingAbi
} from "@parly/protocol-abis"
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex
} from "viem"
import { assertPhase3AttemptDomain, type Phase3LiveFeederAttempt } from "./live-feeder.js"
import type { Tip1022Observation } from "./index.js"
import { validatePhase3PoolRoutes, type Phase3PoolRoute } from "./observation-routes.js"
import { parseReceivingProfileV4, type ReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"

const TEMPO_CHAIN_ID = 4217
const HASH_RE = /^0x[a-fA-F0-9]{64}$/u

type Env = Record<string, string | undefined>

export type ObservationTransfer = {
  token: string
  from: string
  to: string
  amount: bigint
  logIndex: number
}

function required(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredAddress(env: Env, name: string) {
  const value = required(env, name)
  if (!isAddress(value)) throw new Error(`${name} must be an address`)
  return getAddress(value)
}

function requiredPositiveInteger(env: Env, name: string) {
  const value = Number(required(env, name))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

export type Phase3ObservationWorkerConfig =
  | { enabled: false; reason: "phase3_observation_worker_disabled" }
  | {
      enabled: true
      submissionEnabled: boolean
      rpcUrl: string
      databaseUrl: string
      chainId: 4217
      settlementDomainId: 4217
      environment: Hex
      masterAddress: Address
      virtualMasterId: Hex
      supportedTokens: readonly Address[]
      poolCircuitVersion: number
      poolRoutes: readonly Phase3PoolRoute[]
      receivingProfile?: ReceivingProfileV4
      minimumConfirmations: number
      startBlock: bigint
      observationSigner: Address
    }

export function readPhase3ObservationWorkerConfig(env: Env = process.env): Phase3ObservationWorkerConfig {
  if (env.PHASE3_OBSERVATION_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_observation_worker_disabled" }
  }

  const parlyEnv = required(env, "PARLY_ENV")
  if (parlyEnv !== "mainnet" && parlyEnv !== "staging") {
    throw new Error("observation worker requires staging or mainnet mode")
  }
  if (requiredPositiveInteger(env, "TEMPO_CHAIN_ID") !== TEMPO_CHAIN_ID) {
    throw new Error("observation worker requires Tempo chain 4217")
  }
  if (requiredPositiveInteger(env, "SETTLEMENT_DOMAIN_ID") !== TEMPO_CHAIN_ID) {
    throw new Error("observation worker requires settlement domain 4217")
  }

  const observationSigner = requiredAddress(env, "PHASE3_OBSERVATION_SIGNER")
  const attemptSigner = requiredAddress(env, "PHASE3_ATTEMPT_SIGNER")
  const settlementSigner = requiredAddress(env, "PHASE3_SETTLEMENT_SIGNER")
  if (observationSigner === settlementSigner) {
    throw new Error("observation signer must be distinct from settlement signer")
  }
  if (observationSigner === attemptSigner) {
    throw new Error("observation signer must be distinct from attempt signer")
  }

  if (env.PHASE3_OBSERVATION_SUBMISSION_ENABLED === "true") {
    throw new Error("observation submission is relayer-owned; keep PHASE3_OBSERVATION_SUBMISSION_ENABLED=false")
  }

  const virtualMasterId = required(env, "PHASE3_VIRTUAL_MASTER_ID")
  if (!HASH_RE.test(virtualMasterId) || /^0x0{64}$/iu.test(virtualMasterId)) {
    throw new Error("PHASE3_VIRTUAL_MASTER_ID must be a non-zero bytes32 value")
  }
  const rpcUrl = required(env, "PHASE3_TEMPO_RPC_URL")
  if (!/^https:\/\//u.test(rpcUrl)) throw new Error("PHASE3_TEMPO_RPC_URL must use HTTPS")
  const environment = env.PHASE3_ENVIRONMENT_HASH?.trim() ||
    keccak256(stringToHex(required(env, "PHASE3_ENVIRONMENT_LABEL")))
  if (!HASH_RE.test(environment) || /^0x0{64}$/iu.test(environment)) {
    throw new Error("environment must be non-zero bytes32")
  }

  let receivingProfile: ReceivingProfileV4 | undefined
  if (env.PHASE3_RECEIVING_V4_PROFILE_JSON) {
    try {
      receivingProfile = parseReceivingProfileV4(env.PHASE3_RECEIVING_V4_PROFILE_JSON)
      if (receivingProfile.chainId !== TEMPO_CHAIN_ID || receivingProfile.settlementDomain !== BigInt(TEMPO_CHAIN_ID) ||
          receivingProfile.environment.toLowerCase() !== environment.toLowerCase() ||
          receivingProfile.master.toLowerCase() !== requiredAddress(env, "PARLY_VIRTUAL_DEPOSIT_MASTER").toLowerCase() ||
          receivingProfile.virtualMasterId + "0".repeat(56) !== virtualMasterId.toLowerCase()) throw Error("domain mismatch")
    } catch { throw Error("V4 observation profile/domain is unavailable") }
  }
  const poolRoutes: readonly Phase3PoolRoute[] = receivingProfile ? receivingProfile.assets.map(a => ({ token: a.token, pool: a.pool, assetId: a.assetId, circuitVersion: 4 })) : [
    { token: requiredAddress(env, "PHASE3_TEMPO_USDCE_TOKEN"), pool: requiredAddress(env, "PHASE3_USDC_POOL_V3"), assetId: 1, circuitVersion: 3 },
    { token: requiredAddress(env, "PHASE3_TEMPO_USDT0_TOKEN"), pool: requiredAddress(env, "PHASE3_USDT_POOL_V3"), assetId: 2, circuitVersion: 3 }
  ]
  const config: Extract<Phase3ObservationWorkerConfig, { enabled: true }> = {
    enabled: true,
    submissionEnabled: env.PHASE3_OBSERVATION_SUBMISSION_ENABLED === "true",
    rpcUrl,
    databaseUrl: required(env, "DATABASE_URL"),
    chainId: TEMPO_CHAIN_ID,
    settlementDomainId: TEMPO_CHAIN_ID,
    environment: environment.toLowerCase() as Hex,
    masterAddress: requiredAddress(env, "PARLY_VIRTUAL_DEPOSIT_MASTER"),
    virtualMasterId: virtualMasterId.toLowerCase() as Hex,
    supportedTokens: poolRoutes.map(route => route.token),
    poolCircuitVersion: receivingProfile ? 4 : 3,
    poolRoutes,
    ...(receivingProfile ? { receivingProfile } : {}),
    minimumConfirmations: requiredPositiveInteger(env, "PHASE3_MIN_CONFIRMATIONS"),
    startBlock: BigInt(requiredPositiveInteger(env, "START_BLOCK_PARLY_VIRTUAL_DEPOSIT_MASTER")),
    observationSigner
  }
  validatePhase3PoolRoutes(config)
  return config
}

export function selectTip1022TransferPair(args: {
  masterAddress: string
  transfers: readonly ObservationTransfer[]
  secondLogIndex?: number
}) {
  const master = args.masterAddress.toLowerCase()
  const egress = args.transfers.filter((transfer) => transfer.to.toLowerCase() === master)
  const selected = args.secondLogIndex === undefined
    ? egress
    : egress.filter((transfer) => transfer.logIndex === args.secondLogIndex)
  if (selected.length !== 1) throw new Error("TIP-1022 transaction requires exactly one master transfer")
  const second = selected[0]!
  const previous = egress.filter((transfer) =>
    transfer.logIndex < second.logIndex &&
    transfer.token.toLowerCase() === second.token.toLowerCase() &&
    transfer.from.toLowerCase() === second.from.toLowerCase()
  ).reduce((index, transfer) => Math.max(index, transfer.logIndex), -1)
  const candidates = args.transfers.filter(
    (transfer) =>
      transfer.logIndex > previous &&
      transfer.logIndex < second.logIndex &&
      transfer.token.toLowerCase() === second.token.toLowerCase() &&
      transfer.to.toLowerCase() === second.from.toLowerCase() &&
      transfer.amount === second.amount
  )
  if (candidates.length !== 1) throw new Error("TIP-1022 transaction requires exactly one ingress transfer")
  return { first: candidates[0]!, second }
}

export type DepositObservation = {
  token: Address
  virtualAddress: Address
  masterAddress: Address
  amount: bigint
  observationId: Hex
  txHash: Hex
  logIndexA: bigint
  logIndexB: bigint
  observedBlockNumber: bigint
  routeHash: Hex
  userTagHash: Hex
}

export function toDepositObservation(observation: Tip1022Observation): DepositObservation {
  return {
    token: getAddress(observation.token),
    virtualAddress: getAddress(observation.virtualAddress),
    masterAddress: getAddress(observation.masterAddress),
    amount: observation.amount,
    observationId: observation.observationId as Hex,
    txHash: observation.txHash as Hex,
    logIndexA: BigInt(observation.firstLogIndex),
    logIndexB: BigInt(observation.secondLogIndex),
    observedBlockNumber: observation.observedBlockNumber,
    routeHash: observation.routeHash as Hex,
    userTagHash: observation.paymentTagHash as Hex
  }
}

export function buildObservationSubmission(args: {
  chainId: number
  settlementDomainId: number
  environment: Hex
  masterAddress: Address
  attemptId: Hex
  observation: DepositObservation
  nonce: Hex
  expiresAt: bigint
}) {
  const attestation = {
    chainId: BigInt(args.chainId),
    settlementDomainId: BigInt(args.settlementDomainId),
    environment: args.environment,
    verifyingContract: args.masterAddress,
    attemptId: args.attemptId,
    observationId: args.observation.observationId,
    token: args.observation.token,
    amount: args.observation.amount,
    virtualAddress: args.observation.virtualAddress,
    txHash: args.observation.txHash,
    logIndexA: args.observation.logIndexA,
    logIndexB: args.observation.logIndexB,
    observedBlockNumber: args.observation.observedBlockNumber,
    routeHash: args.observation.routeHash,
    userTagHash: args.observation.userTagHash,
    expiresAt: args.expiresAt,
    nonce: args.nonce
  }
  return {
    to: args.masterAddress,
    functionName: "recordDepositObservationWithAttestation" as const,
    args: [args.attemptId, args.observation, attestation] as const,
    attestation,
    encode(signature: Hex) {
      return encodeFunctionData({
        abi: parlyVirtualDepositMasterObservationRecordingAbi,
        functionName: "recordDepositObservationWithAttestation",
        args: [args.attemptId, args.observation, attestation, signature]
      })
    },
    broadcast: false as const
  }
}

function requireHex32(value: `0x${string}` | string | undefined, label: string) {
  if (!value || !HASH_RE.test(value)) throw new Error(`${label} is required`)
  return value as Hex
}

function requireAttemptNumber(value: bigint | number | undefined, label: string) {
  if (value === undefined) throw new Error(`${label} is required`)
  const bigintValue = typeof value === "bigint" ? value : BigInt(value)
  if (bigintValue <= 0n) throw new Error(`${label} must be positive`)
  return bigintValue
}

function attemptExpiresAtSeconds(expiresAtMs: number) {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error("attempt expiry is required")
  }
  return BigInt(Math.floor(expiresAtMs / 1000))
}

export function buildAttemptRegistrationSubmission(args: {
  chainId: number
  settlementDomainId: number
  environment: Hex
  masterAddress: Address
  virtualMasterId: Hex
  attempt: Phase3LiveFeederAttempt
}) {
  assertPhase3AttemptDomain(args.attempt, args)
  const authorization = {
    chainId: BigInt(args.chainId),
    settlementDomainId: BigInt(args.settlementDomainId),
    environment: args.environment,
    verifyingContract: args.masterAddress,
    attemptId: requireHex32(args.attempt.paymentAttemptId, "attemptId"),
    authorizationNonce: requireHex32(args.attempt.authorizationNonce, "authorizationNonce"),
    userTagHash: requireHex32(args.attempt.paymentTagHash, "paymentTagHash"),
    routeHash: requireHex32(args.attempt.routeHash, "routeHash"),
    token: requiredAttemptAddress(args.attempt.expectedToken, "expectedToken"),
    pool: requiredAttemptAddress(args.attempt.poolAddress, "poolAddress"),
    assetId: requireAttemptNumber(args.attempt.assetId, "assetId"),
    expectedAmount: args.attempt.expectedAmount,
    expiresAt: attemptExpiresAtSeconds(args.attempt.expiresAt),
    refundWalletCommitment: requireHex32(args.attempt.refundWalletCommitment, "refundWalletCommitment"),
    paymentContext: requiredAttemptEnum(args.attempt.paymentContext, "paymentContext"),
    refundClaimantBinding: requiredAttemptEnum(args.attempt.refundClaimantBinding, "refundClaimantBinding"),
    statusAccessTokenHash: requireHex32(args.attempt.statusAccessTokenHash, "statusAccessTokenHash")
  }
  return {
    to: args.masterAddress,
    functionName: "registerAttemptWithAuthorization" as const,
    args: [authorization] as const,
    authorization,
    encode(signature: Hex) {
      return encodeFunctionData({
        abi: parlyVirtualDepositMasterAttemptRegistrationAbi,
        functionName: "registerAttemptWithAuthorization",
        args: [authorization, signature]
      })
    },
    broadcast: false as const
  }
}

function requiredAttemptAddress(value: string | undefined, label: string) {
  if (!value || !isAddress(value)) throw new Error(`${label} is required`)
  return getAddress(value)
}

function requiredAttemptEnum(value: number | undefined, label: string) {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} is required`)
  }
  return value
}
