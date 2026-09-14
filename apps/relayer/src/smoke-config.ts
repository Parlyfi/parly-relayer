import "dotenv/config"
import {
  requireEnv,
  requirePositiveChainId,
  requirePositiveInt
} from "@parly/env-utils"
import { readPhase3PayoutV3RuntimeConfig } from "./phase3/index.js"
import { requireWakuContentTopic } from "./waku-content-topic.js"

const PHASE3_TEMPO_CHAIN_ID = 4217
const PHASE3_SETTLEMENT_DOMAIN_ID = 4217

function assertNoMainnetOnStagingRelayer(env: NodeJS.ProcessEnv) {
  if (env.PARLY_ENV === "mainnet" || env.NEXT_PUBLIC_PARLY_ENV === "mainnet") {
    throw new Error(
      "This smoke config is dry-run only. Tempo mainnet launch requires an explicit mainnet relayer config before startup."
    )
  }
}

export type RelayerRuntimeConfig = {
  databaseUrl: string
  relayerPrivateKey: `0x${string}`
  relayerBoxPrivateKeyB64: string
  tempoRpcUrl: string
  tempoChainId: number
  settlementDomainId: number
  wakuClusterId: number
  wakuBootstrap: boolean
  wakuContentTopic: string
  registryApiBaseUrl?: string
  v3PayoutRuntime: ReturnType<typeof readPhase3PayoutV3RuntimeConfig>
}

function requireHexPrivateKey(name: string, env: NodeJS.ProcessEnv) {
  const value = requireEnv(name, env)
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key.`)
  }
  return value as `0x${string}`
}

function requireBoxPrivateKeyB64(name: string, env: NodeJS.ProcessEnv) {
  const value = requireEnv(name, env).trim()
  try {
    const decoded = Buffer.from(value, "base64")
    if (decoded.length !== 32) {
      throw new Error("decoded length must be 32 bytes")
    }
  } catch (error: any) {
    throw new Error(`${name} must be valid base64 for a 32-byte X25519 secret key.`)
  }
  return value
}

export function assertRelayerConfig(env: NodeJS.ProcessEnv = process.env): RelayerRuntimeConfig {
  assertNoMainnetOnStagingRelayer(env)

  const wakuBootstrap = requireEnv("WAKU_BOOTSTRAP", env)
  if (wakuBootstrap !== "true" && wakuBootstrap !== "false") {
    throw new Error("WAKU_BOOTSTRAP must be either true or false.")
  }

  const registryApiBaseUrl = env.RELAYER_REGISTRY_API_BASE_URL
  if (registryApiBaseUrl) {
    new URL(registryApiBaseUrl)
  }

  const tempoChainId = requirePositiveChainId("TEMPO_CHAIN_ID", env)
  if (tempoChainId !== PHASE3_TEMPO_CHAIN_ID) {
    throw new Error(`TEMPO_CHAIN_ID must stay locked to ${PHASE3_TEMPO_CHAIN_ID} for Phase 3 Tempo dry-run config.`)
  }

  const settlementDomainId = requirePositiveInt("SETTLEMENT_DOMAIN_ID", env)
  if (settlementDomainId !== PHASE3_SETTLEMENT_DOMAIN_ID) {
    throw new Error(`SETTLEMENT_DOMAIN_ID must stay locked to ${PHASE3_SETTLEMENT_DOMAIN_ID} for Phase 3 Tempo dry-run config.`)
  }

  return {
    databaseUrl: requireEnv("DATABASE_URL", env),
    relayerPrivateKey: requireHexPrivateKey("RELAYER_PRIVATE_KEY", env),
    relayerBoxPrivateKeyB64: requireBoxPrivateKeyB64("RELAYER_BOX_PRIVATE_KEY_B64", env),
    tempoRpcUrl: requireEnv("TEMPO_RPC_URL", env),
    tempoChainId,
    settlementDomainId,
    wakuClusterId: requirePositiveInt("WAKU_CLUSTER_ID", env),
    wakuBootstrap: wakuBootstrap === "true",
    wakuContentTopic: requireWakuContentTopic("WAKU_CONTENT_TOPIC", env),
    registryApiBaseUrl,
    v3PayoutRuntime: readPhase3PayoutV3RuntimeConfig(env)
  }
}

if (process.argv[1] && process.argv[1].endsWith("smoke-config.js")) {
  const config = assertRelayerConfig()
  console.log(
    JSON.stringify(
      {
        status: "relayer-config-valid",
        databaseUrlConfigured: true,
        relayerPrivateKeyConfigured: true,
        relayerBoxPrivateKeyConfigured: true,
        tempoRpcUrlConfigured: Boolean(config.tempoRpcUrl),
        tempoChainId: config.tempoChainId,
        settlementDomainId: config.settlementDomainId,
        wakuClusterId: config.wakuClusterId,
        wakuBootstrap: config.wakuBootstrap,
        wakuContentTopicConfigured: Boolean(config.wakuContentTopic),
        registryApiBaseUrlConfigured: Boolean(config.registryApiBaseUrl),
        v3PayoutRuntime:
          config.v3PayoutRuntime.enabled === false
            ? config.v3PayoutRuntime
            : {
                enabled: true,
                tempoChainId: config.v3PayoutRuntime.tempoChainId,
                settlementDomainId: config.v3PayoutRuntime.settlementDomainId,
                payoutAdapterV3: config.v3PayoutRuntime.payoutAdapterV3,
                payoutLiabilityVault: config.v3PayoutRuntime.payoutLiabilityVault,
                payoutProofVerifier: config.v3PayoutRuntime.payoutProofVerifier,
                relayOutboundProvider: config.v3PayoutRuntime.relayOutboundProvider,
                relayOutboundProviderV2: config.v3PayoutRuntime.relayOutboundProviderV2,
                relayDepositAddressTarget: config.v3PayoutRuntime.relayDepositAddressTarget,
                payoutExecutionEnabled: config.v3PayoutRuntime.payoutExecutionEnabled,
                broadcastEnabled: config.v3PayoutRuntime.broadcastEnabled,
                feePayerEnabled: config.v3PayoutRuntime.feePayerEnabled,
                fundedPocEnabled: config.v3PayoutRuntime.fundedPocEnabled,
                campaignAwardsEnabled: config.v3PayoutRuntime.campaignAwardsEnabled
              }
      },
      null,
      2
    )
  )
}
