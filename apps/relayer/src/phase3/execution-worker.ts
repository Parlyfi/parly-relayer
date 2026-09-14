import "dotenv/config"
import {
  isRelayerOwnedOneTimeExecutionBroadcastEnabled,
  runRelayerOwnedOneTimeExecutionOnce
} from "./index.js"
import { createRelayerOwnedExecutionPayloadDataSource } from "./execution-payload-store.js"

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>

export type RelayerOwnedExecutionWorkerConfig =
  | { enabled: false; reason: "phase3_relayer_owned_execution_worker_disabled" }
  | {
      enabled: true
      workerId: string
      leaseMs: number
      pollIntervalMs: number
      broadcast: boolean
      executionDatabaseConfigured: true
      executionPayloadEncryptionKeyConfigured: true
    }

function requireEnv(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for relayer-owned execution worker.`)
  return value
}

function optionalPositiveInt(env: Env, name: string, fallback: number) {
  const value = env[name]?.trim()
  if (!value) return fallback
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return Number(value)
}

function requireEncryptionKeyConfigured(env: Env) {
  const encoded = requireEnv(env, "PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) {
    throw new Error("PHASE3_EXECUTION_PAYLOAD_ENCRYPTION_KEY_B64 must decode to 32 bytes.")
  }
}

export function readRelayerOwnedExecutionWorkerConfig(
  env: Env = process.env
): RelayerOwnedExecutionWorkerConfig {
  if (env.PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED !== "true") {
    return { enabled: false, reason: "phase3_relayer_owned_execution_worker_disabled" }
  }
  requireEnv(env, "PHASE3_EXECUTION_DATABASE_URL")
  requireEncryptionKeyConfigured(env)
  const workerId = env.PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ID?.trim() || requireEnv(env, "RELAYER_ADDRESS")
  return {
    enabled: true,
    workerId,
    leaseMs: optionalPositiveInt(env, "PHASE3_RELAYER_OWNED_EXECUTION_LEASE_MS", 30_000),
    pollIntervalMs: optionalPositiveInt(env, "PHASE3_RELAYER_OWNED_EXECUTION_POLL_MS", 5_000),
    broadcast: isRelayerOwnedOneTimeExecutionBroadcastEnabled(env as NodeJS.ProcessEnv),
    executionDatabaseConfigured: true,
    executionPayloadEncryptionKeyConfigured: true
  }
}

export async function runRelayerOwnedExecutionWorkerOnce(args: {
  config: Extract<RelayerOwnedExecutionWorkerConfig, { enabled: true }>
  dataSource?: Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["dataSource"]
  env?: NodeJS.ProcessEnv
}) {
  const dataSource = args.dataSource ?? createRelayerOwnedExecutionPayloadDataSource()
  return runRelayerOwnedOneTimeExecutionOnce({
    dataSource,
    workerId: args.config.workerId,
    leaseMs: args.config.leaseMs,
    broadcast: args.config.broadcast,
    env: args.env ?? process.env
  })
}

export function startRelayerOwnedExecutionWorkerLoop(args: {
  config?: RelayerOwnedExecutionWorkerConfig
  dataSource?: Parameters<typeof runRelayerOwnedOneTimeExecutionOnce>[0]["dataSource"]
  env?: NodeJS.ProcessEnv
  logger?: Pick<Console, "info" | "error">
} = {}) {
  const logger = args.logger ?? console
  const config = args.config ?? readRelayerOwnedExecutionWorkerConfig(args.env ?? process.env)
  if (!config.enabled) {
    logger.info(`[phase3-relayer-owned-execution] ${config.reason}`)
    return { started: false as const, reason: config.reason }
  }

  const tick = async () => {
    try {
      const result = await runRelayerOwnedExecutionWorkerOnce({
        config,
        dataSource: args.dataSource,
        env: args.env ?? process.env
      })
      if (result.status !== "idle") {
        logger.info(
          `[phase3-relayer-owned-execution] ${result.status} job=${result.jobId} broadcast=${result.broadcast}`
        )
      }
    } catch (error) {
      logger.error(
        `[phase3-relayer-owned-execution] ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  void tick()
  const interval = setInterval(() => {
    void tick()
  }, config.pollIntervalMs)
  return {
    started: true as const,
    broadcast: config.broadcast,
    workerId: config.workerId,
    stop() {
      clearInterval(interval)
    }
  }
}
