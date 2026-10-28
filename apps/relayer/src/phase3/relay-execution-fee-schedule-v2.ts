import { randomBytes } from "node:crypto"
import type {
  RelayExecutionFeeScheduleV2,
  SignedRelayExecutionFeeScheduleV2
} from "@parly/shared-types"
import {
  RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN,
  RELAY_EXECUTION_FEE_SCHEDULE_V2_TYPES
} from "@parly/shared-types"
import {
  getAddress,
  hashTypedData,
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex
} from "viem"
import type { PrivateKeyAccount } from "viem/accounts"

const HASH_RE = /^0x[a-fA-F0-9]{64}$/u
const SIGNATURE_RE = /^0x[a-fA-F0-9]{130}$/u
const UINT_RE = /^(0|[1-9][0-9]*)$/u
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex

export const RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN_NAME =
  RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN.name
export const RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN_VERSION =
  RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN.version
export { RELAY_EXECUTION_FEE_SCHEDULE_V2_TYPES }

export type RelayExecutionFeeScheduleTemplateV2 = Pick<
  RelayExecutionFeeScheduleV2,
  | "pool"
  | "executionMode"
  | "inputCount"
  | "outputCount"
  | "executorFee"
  | "maximumGasPrice"
>

export type RelayExecutionFeeScheduleValidationV2 = {
  chainId: number
  pool: Address
  executionMode: 0 | 1
  inputCount: number
  outputCount: number
  executorFee: bigint
  relayer: Address
  maximumExecutorFee: bigint
  maximumValiditySeconds: number
  currentGasPrice: bigint
  nowSeconds: number
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has an unknown or missing field.`)
  }
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${label} must be a non-zero address.`)
  }
  return getAddress(value) as Address
}

function bytes32(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH_RE.test(value)) {
    throw new Error(`${label} must be bytes32.`)
  }
  return value.toLowerCase() as Hex
}

function uintString(value: unknown, label: string) {
  if (typeof value !== "string" || !UINT_RE.test(value)) {
    throw new Error(`${label} must be an unsigned integer string.`)
  }
  return BigInt(value)
}

function uintNumber(value: unknown, label: string, minimum: number, maximum: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} is outside its permitted range.`)
  }
  return value
}

function normalizeSchedule(value: unknown): RelayExecutionFeeScheduleV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay fee schedule is invalid.")
  }
  const schedule = value as Record<string, unknown>
  exactKeys(schedule, [
    "chainId",
    "pool",
    "executionMode",
    "inputCount",
    "outputCount",
    "executorFee",
    "maximumGasPrice",
    "scheduleNonce",
    "validAfter",
    "expiry",
    "relayer"
  ], "Relay fee schedule")

  const executionMode = uintNumber(schedule.executionMode, "Relay fee schedule mode", 0, 1) as 0 | 1
  const inputCount = uintNumber(schedule.inputCount, "Relay fee schedule input count", 1, 4) as 1 | 2 | 3 | 4
  const outputCount = uintNumber(schedule.outputCount, "Relay fee schedule output count", 0, 10)
  if ((executionMode === 0 && outputCount < 1) || (executionMode === 1 && outputCount !== 0)) {
    throw new Error("Relay fee schedule output count does not match its execution mode.")
  }
  const executorFee = uintString(schedule.executorFee, "Relay fee schedule executor fee")
  const maximumGasPrice = uintString(
    schedule.maximumGasPrice,
    "Relay fee schedule maximum gas price"
  )
  if (executorFee === 0n || maximumGasPrice === 0n) {
    throw new Error("Relay fee schedule must compensate execution and set a gas-price ceiling.")
  }
  const scheduleNonce = bytes32(schedule.scheduleNonce, "Relay fee schedule nonce")
  if (scheduleNonce === ZERO_HASH) throw new Error("Relay fee schedule nonce must be non-zero.")

  return {
    chainId: uintNumber(schedule.chainId, "Relay fee schedule chain", 1, Number.MAX_SAFE_INTEGER),
    pool: address(schedule.pool, "Relay fee schedule pool"),
    executionMode,
    inputCount,
    outputCount,
    executorFee: executorFee.toString(),
    maximumGasPrice: maximumGasPrice.toString(),
    scheduleNonce,
    validAfter: uintNumber(
      schedule.validAfter,
      "Relay fee schedule valid-after time",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    expiry: uintNumber(
      schedule.expiry,
      "Relay fee schedule expiry",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    relayer: address(schedule.relayer, "Relay fee schedule relayer")
  }
}

function typedData(schedule: RelayExecutionFeeScheduleV2) {
  return {
    domain: {
      ...RELAY_EXECUTION_FEE_SCHEDULE_V2_DOMAIN,
      chainId: schedule.chainId
    },
    types: RELAY_EXECUTION_FEE_SCHEDULE_V2_TYPES,
    primaryType: "RelayExecutionFeeScheduleV2" as const,
    message: {
      ...schedule,
      chainId: BigInt(schedule.chainId),
      executorFee: BigInt(schedule.executorFee),
      maximumGasPrice: BigInt(schedule.maximumGasPrice),
      validAfter: BigInt(schedule.validAfter),
      expiry: BigInt(schedule.expiry)
    }
  }
}

export function hashRelayExecutionFeeScheduleV2(value: unknown) {
  const schedule = normalizeSchedule(value)
  return hashTypedData(typedData(schedule))
}

export async function signRelayExecutionFeeScheduleV2(
  account: PrivateKeyAccount,
  value: unknown
): Promise<SignedRelayExecutionFeeScheduleV2> {
  const schedule = normalizeSchedule(value)
  if (schedule.relayer !== getAddress(account.address)) {
    throw new Error("Relay fee schedule must be signed by its bound relayer.")
  }
  const scheduleHash = hashTypedData(typedData(schedule))
  const signature = await account.signTypedData(typedData(schedule))
  return { schedule, scheduleHash, signature }
}

export function normalizeSignedRelayExecutionFeeScheduleV2(
  value: unknown
): SignedRelayExecutionFeeScheduleV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Signed Relay fee schedule is invalid.")
  }
  const signed = value as Record<string, unknown>
  exactKeys(signed, ["schedule", "scheduleHash", "signature"], "Signed Relay fee schedule")
  const schedule = normalizeSchedule(signed.schedule)
  const scheduleHash = bytes32(signed.scheduleHash, "Relay fee schedule hash")
  if (scheduleHash !== hashTypedData(typedData(schedule)).toLowerCase()) {
    throw new Error("Relay fee schedule hash is invalid.")
  }
  if (typeof signed.signature !== "string" || !SIGNATURE_RE.test(signed.signature)) {
    throw new Error("Relay fee schedule signature is invalid.")
  }
  return {
    schedule,
    scheduleHash,
    signature: signed.signature.toLowerCase() as Hex
  }
}

export async function validateRelayExecutionFeeScheduleV2(
  value: unknown,
  expected: RelayExecutionFeeScheduleValidationV2
): Promise<SignedRelayExecutionFeeScheduleV2> {
  const signed = normalizeSignedRelayExecutionFeeScheduleV2(value)
  const { schedule, scheduleHash } = signed

  const relayer = getAddress(expected.relayer)
  if (
    schedule.chainId !== expected.chainId ||
    schedule.pool !== getAddress(expected.pool) ||
    schedule.executionMode !== expected.executionMode ||
    schedule.inputCount !== expected.inputCount ||
    schedule.outputCount !== expected.outputCount ||
    BigInt(schedule.executorFee) !== expected.executorFee ||
    schedule.relayer !== relayer
  ) {
    throw new Error("Relay fee schedule does not match the exact PoolV3 proof tuple.")
  }
  if (BigInt(schedule.executorFee) > expected.maximumExecutorFee) {
    throw new Error("Relay fee schedule exceeds the mode-specific executor-fee ceiling.")
  }
  if (
    schedule.expiry <= schedule.validAfter ||
    schedule.expiry - schedule.validAfter > expected.maximumValiditySeconds
  ) {
    throw new Error("Relay fee schedule validity window is not permitted.")
  }
  if (expected.nowSeconds < schedule.validAfter) {
    throw new Error("Relay fee schedule is not yet valid.")
  }
  if (expected.nowSeconds > schedule.expiry) {
    throw new Error("Relay fee schedule is expired.")
  }
  if (expected.currentGasPrice > BigInt(schedule.maximumGasPrice)) {
    throw new Error("Current gas price exceeds the signed Relay fee schedule ceiling.")
  }
  const recovered = await recoverTypedDataAddress({
    ...typedData(schedule),
    signature: signed.signature
  })
  if (getAddress(recovered) !== relayer) {
    throw new Error("Relay fee schedule signer is not the bound relayer.")
  }

  return {
    schedule,
    scheduleHash,
    signature: signed.signature
  }
}

export function readRelayExecutionFeeScheduleTemplatesV2(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  input: {
    pools: ReadonlyMap<string, Hex>
    maximumExecutorFeeByMode: ReadonlyMap<0 | 1, bigint>
  }
) {
  const raw = env.PHASE3_POOL_V3_FEE_SCHEDULES_JSON?.trim()
  if (!raw) {
    throw new Error(
      "PHASE3_POOL_V3_FEE_SCHEDULES_JSON is required when the PoolV3 relayer is enabled."
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("PHASE3_POOL_V3_FEE_SCHEDULES_JSON must be valid JSON.")
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 82) {
    throw new Error("PoolV3 fee schedule templates must contain between 1 and 82 entries.")
  }
  const tuples = new Set<string>()
  return parsed.map((entry, index): RelayExecutionFeeScheduleTemplateV2 => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`PoolV3 fee schedule template ${index} is invalid.`)
    }
    const template = entry as Record<string, unknown>
    exactKeys(template, [
      "pool",
      "executionMode",
      "inputCount",
      "outputCount",
      "executorFee",
      "maximumGasPrice"
    ], `PoolV3 fee schedule template ${index}`)
    const pool = address(template.pool, `PoolV3 fee schedule template ${index} pool`)
    if (!input.pools.has(pool.toLowerCase())) {
      throw new Error(`PoolV3 fee schedule template ${index} uses an unapproved pool.`)
    }
    const executionMode = uintNumber(
      template.executionMode,
      `PoolV3 fee schedule template ${index} mode`,
      0,
      1
    ) as 0 | 1
    const inputCount = uintNumber(
      template.inputCount,
      `PoolV3 fee schedule template ${index} input count`,
      1,
      4
    ) as 1 | 2 | 3 | 4
    const outputCount = uintNumber(
      template.outputCount,
      `PoolV3 fee schedule template ${index} output count`,
      0,
      10
    )
    if ((executionMode === 0 && outputCount < 1) || (executionMode === 1 && outputCount !== 0)) {
      throw new Error(`PoolV3 fee schedule template ${index} has an invalid output count.`)
    }
    const executorFee = uintString(
      template.executorFee,
      `PoolV3 fee schedule template ${index} executor fee`
    )
    const maximumGasPrice = uintString(
      template.maximumGasPrice,
      `PoolV3 fee schedule template ${index} maximum gas price`
    )
    if (
      executorFee === 0n ||
      executorFee > (input.maximumExecutorFeeByMode.get(executionMode) ?? 0n) ||
      maximumGasPrice === 0n
    ) {
      throw new Error(`PoolV3 fee schedule template ${index} exceeds its configured ceiling.`)
    }
    const tuple = `${pool.toLowerCase()}:${executionMode}:${inputCount}:${outputCount}`
    if (tuples.has(tuple)) throw new Error("PoolV3 fee schedule templates contain a duplicate tuple.")
    tuples.add(tuple)
    return {
      pool,
      executionMode,
      inputCount,
      outputCount,
      executorFee: executorFee.toString(),
      maximumGasPrice: maximumGasPrice.toString()
    }
  })
}

export async function buildSignedRelayExecutionFeeSchedulesV2(input: {
  account: PrivateKeyAccount
  chainId: number
  templates: readonly RelayExecutionFeeScheduleTemplateV2[]
  validAfter: number
  ttlSeconds: number
  nonceFactory?: () => Hex
}) {
  if (!Number.isSafeInteger(input.validAfter) || input.validAfter < 1) {
    throw new Error("Relay fee schedule publication time is invalid.")
  }
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 900) {
    throw new Error("Relay fee schedule publication TTL must be between 30 and 900 seconds.")
  }
  const nonceFactory = input.nonceFactory ?? (() => `0x${randomBytes(32).toString("hex")}` as Hex)
  const nonces = new Set<string>()
  const schedules = input.templates.map((template) => {
    const scheduleNonce = bytes32(nonceFactory(), "Relay fee schedule publication nonce")
    if (scheduleNonce === ZERO_HASH || nonces.has(scheduleNonce)) {
      throw new Error("Relay fee schedule publication produced an invalid or duplicate nonce.")
    }
    nonces.add(scheduleNonce)
    return {
      chainId: input.chainId,
      ...template,
      scheduleNonce,
      validAfter: input.validAfter,
      expiry: input.validAfter + input.ttlSeconds,
      relayer: input.account.address
    }
  })
  return Promise.all(schedules.map((schedule) =>
    signRelayExecutionFeeScheduleV2(input.account, schedule)
  ))
}
