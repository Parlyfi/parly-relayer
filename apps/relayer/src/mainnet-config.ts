import "dotenv/config"
import { requireEnv, requirePositiveChainId, requirePositiveInt } from "@parly/env-utils"
export {
  describePhase3FinalizerConfigForLogs,
  readPhase3FinalizerConfig
} from "./phase3/index.js"

const FORBIDDEN_VALUE_RE = /moderato|testnet|sepolia/iu
const FORBIDDEN_KEY_RE = /SPOKE|PATHUSD|LZD|LAYERZERO|DVN|LZ_EID|LZ_FEE/u
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export type MainnetRelayerConfig = {
  launchScope: "tempo-only"
  databaseUrl: string
  relayerPrivateKey: `0x${string}`
  relayerBoxPrivateKeyB64: string
  tempoRpcUrl: string
  tempoChainId: number
  settlementDomainId: number
  usdcAddress: `0x${string}`
  usdtAddress: `0x${string}`
  usdcPool: `0x${string}`
  usdtPool: `0x${string}`
  protocolTreasury: `0x${string}`
  groth16Verifier: `0x${string}`
}

function requireAddress(name: string, env: NodeJS.ProcessEnv) {
  const value = requireEnv(name, env)
  if (!ADDRESS_RE.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new Error(`${name} must be a non-zero 20-byte address.`)
  }
  return value as `0x${string}`
}

function requirePrivateKey(name: string, env: NodeJS.ProcessEnv) {
  const value = requireEnv(name, env)
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key.`)
  }
  return value as `0x${string}`
}

function assertNoForbiddenMainnetRuntime(env: NodeJS.ProcessEnv) {
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.trim() === "" || /^0x0{40}$/iu.test(value.trim())) continue
    if (FORBIDDEN_KEY_RE.test(key)) {
      throw new Error(`${key} is forbidden in Tempo-only mainnet relayer runtime.`)
    }
    if (key.includes("RPC") && FORBIDDEN_VALUE_RE.test(value)) {
      throw new Error(`${key} points at a staging/testnet RPC.`)
    }
  }
}

function assertExpected(name: string, actual: string | number, env: NodeJS.ProcessEnv) {
  const expected = requireEnv(`MAINNET_EXPECTED_${name}`, env)
  if (String(expected).toLowerCase() !== String(actual).toLowerCase()) {
    throw new Error(`${name} does not match MAINNET_EXPECTED_${name}.`)
  }
}

export function assertMainnetRelayerConfig(
  env: NodeJS.ProcessEnv = process.env
): MainnetRelayerConfig {
  if (env.PARLY_ENV !== "mainnet") {
    throw new Error("PARLY_ENV=mainnet is required for the explicit mainnet relayer config check.")
  }
  if (env.LAUNCH_SCOPE !== "tempo-only") {
    throw new Error("LAUNCH_SCOPE must be tempo-only.")
  }

  assertNoForbiddenMainnetRuntime(env)

  const tempoChainId = requirePositiveChainId("TEMPO_CHAIN_ID", env)
  const settlementDomainId = requirePositiveInt("SETTLEMENT_DOMAIN_ID", env)
  const usdcAddress = requireAddress("USDC_ADDRESS", env)
  const usdtAddress = requireAddress("USDT_ADDRESS", env)
  const usdcPool = requireAddress("USDC_POOL", env)
  const usdtPool = requireAddress("USDT_POOL", env)
  const protocolTreasury = requireAddress("PROTOCOL_TREASURY_ADDRESS", env)
  const groth16Verifier = requireAddress("GROTH16_VERIFIER_ADDRESS", env)

  assertExpected("TEMPO_CHAIN_ID", tempoChainId, env)
  assertExpected("SETTLEMENT_DOMAIN_ID", settlementDomainId, env)
  assertExpected("USDC_ADDRESS", usdcAddress, env)
  assertExpected("USDT_ADDRESS", usdtAddress, env)
  assertExpected("USDC_POOL", usdcPool, env)
  assertExpected("USDT_POOL", usdtPool, env)
  assertExpected("PROTOCOL_TREASURY_ADDRESS", protocolTreasury, env)
  assertExpected("GROTH16_VERIFIER_ADDRESS", groth16Verifier, env)

  return {
    launchScope: "tempo-only",
    databaseUrl: requireEnv("DATABASE_URL", env),
    relayerPrivateKey: requirePrivateKey("RELAYER_PRIVATE_KEY", env),
    relayerBoxPrivateKeyB64: requireEnv("RELAYER_BOX_PRIVATE_KEY_B64", env),
    tempoRpcUrl: requireEnv("TEMPO_RPC_URL", env),
    tempoChainId,
    settlementDomainId,
    usdcAddress,
    usdtAddress,
    usdcPool,
    usdtPool,
    protocolTreasury,
    groth16Verifier
  }
}

if (process.argv[1] && process.argv[1].endsWith("mainnet-config.js")) {
  const config = assertMainnetRelayerConfig()
  console.log(
    JSON.stringify(
      {
        status: "mainnet-relayer-config-valid",
        launchScope: config.launchScope,
        databaseUrlConfigured: true,
        relayerPrivateKeyConfigured: true,
        relayerBoxPrivateKeyConfigured: true,
        tempoRpcUrlConfigured: true,
        tempoChainId: config.tempoChainId,
        settlementDomainId: config.settlementDomainId,
        usdcAddress: config.usdcAddress,
        usdtAddress: config.usdtAddress,
        usdcPool: config.usdcPool,
        usdtPool: config.usdtPool,
        protocolTreasury: config.protocolTreasury,
        groth16Verifier: config.groth16Verifier
      },
      null,
      2
    )
  )
}
