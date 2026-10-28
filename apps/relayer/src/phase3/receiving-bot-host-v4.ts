import { parseReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import type { PrivateKeyAccount } from "viem/accounts"
import type { Transaction as TempoTransaction } from "viem/tempo"

export async function createReceivingBotHostV4(args: { env?: NodeJS.ProcessEnv; account?: PrivateKeyAccount }) {
  try { return await build(args) }
  catch { throw Error("UNAVAILABLE: V4 receiving bot host startup") }
}

async function build(args: { env?: NodeJS.ProcessEnv; account?: PrivateKeyAccount }) {
  const env = args.env ?? process.env, raw = env.PHASE3_RECEIVING_V4_PROFILE_JSON
  if (!raw) return undefined
  const profile = parseReceivingProfileV4(raw)
  if (!args.account || profile.chainId !== 4217 || profile.settlementDomain !== 4217n
    || args.account.address.toLowerCase() !== profile.preparationAuthority.toLowerCase()) throw Error("V4 receiving operator or native domain is unavailable")
  const { readPrivateExecutionProducerConfig } = await import("../internal/indexer/execution-payload-producer.js")
  const config = readPrivateExecutionProducerConfig(env)
  if (!config.enabled || env.PHASE3_RELAYER_OWNED_EXECUTION_WORKER_ENABLED !== "true") throw Error("V4 receiving execution must be enabled explicitly")
  const url = env.PHASE3_TEMPO_RPC_URL || env.TEMPO_RPC_URL, sourceUrl = env.PHASE3_DATABASE_URL || env.DATABASE_URL
  if (!url || new URL(url).protocol !== "https:" || !sourceUrl) throw Error("V4 receiving RPC and original database are required")
  const gas = JSON.parse(env.PHASE3_RECEIVING_V4_GAS_JSON || "null") as Record<string, string> | null
  if (!gas || Object.keys(gas).sort().join() !== "finalization,observation,preparation,publication,registration"
    || Object.values(gas).some(v => typeof v !== "string" || !/^[1-9][0-9]{0,14}$/.test(v))) throw Error("V4 receiving qualified gas allowances are required")
  const feeToken = env.PHASE3_RECEIVING_V4_FEE_TOKEN
  if (!feeToken || !profile.assets.some(a => a.token.toLowerCase() === feeToken.toLowerCase())) throw Error("V4 receiving fee token must be admitted")
  const { createReceivingRuntimeV4 } = await import("./receiving-runtime-v4.js")
  const { createReceivingProviderSourceHostV4 } = await import("../internal/indexer/receiving-provider-source-v4.js")
  const { createRelayerOwnedExecutionPayloadDataSource } = await import("./execution-payload-store.js")
  const { readRelayerOwnedExecutionWorkerConfig } = await import("./execution-worker.js")
  const worker = readRelayerOwnedExecutionWorkerConfig(env)
  if (!worker.enabled || worker.leaseMs < 3000) throw Error("V4 receiving lease is unavailable")
  const minimumConfirmations = Number(env.PHASE3_MIN_CONFIRMATIONS || "0")
  if (!Number.isSafeInteger(minimumConfirmations) || minimumConfirmations < 1) throw Error("V4 receiving confirmations are invalid")
  const { createPublicClient, createWalletClient, defineChain, http } = await import("viem")
  const { tempoTestnet } = await import("viem/chains")
  const { Transaction } = await import("viem/tempo")
  // Reuse native formatters, never the installed library's historical testnet domain or RPC.
  const chain = defineChain({ id: profile.chainId, name: "Tempo", nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 }, rpcUrls: { default: { http: [url] } },
    formatters: tempoTestnet.formatters, serializers: tempoTestnet.serializers, prepareTransactionRequest: tempoTestnet.prepareTransactionRequest })
  const transport = http(url, { timeout: 7000, retryCount: 0 }), client = createPublicClient({ chain, transport }), account = args.account
  const wallet = createWalletClient({ account, chain, transport })
  const rpc = (q: { method: string; params: unknown[] }) => (client.request as (q: unknown) => Promise<unknown>)(q)
  const proveMembership = await loadReceivingMembershipProverV4(env)
  const pg = (await import("pg")).default
  const sourcePool = new pg.Pool({ connectionString: sourceUrl, max: 4, connectionTimeoutMillis: 7000, statement_timeout: 10000 })
  const executionPool = new pg.Pool({ connectionString: config.executionDatabaseUrl, max: 4, connectionTimeoutMillis: 7000, statement_timeout: 10000 })
  try {
    const dataSource = createRelayerOwnedExecutionPayloadDataSource({ pool: executionPool, encryptionKey: config.value.executionEncryptionKey })
    const runtime = createReceivingRuntimeV4({ profile, config: config.value, sourcePool, executionPool, dataSource, rpc, sender: account.address, feeToken: feeToken as `0x${string}`,
      gas: Object.fromEntries(Object.entries(gas).map(([k, v]) => [k, BigInt(v)])) as import("./receiving-runtime-v4.js").ReceivingGasV4,
      gasPrice: () => client.getGasPrice(), leaseMs: worker.leaseMs, minimumConfirmations,
      sign: async tx => {
        const prepared = await wallet.prepareTransactionRequest({ ...tx, maxFeePerGas: await client.getGasPrice(), maxPriorityFeePerGas: 0n, account, chain } as never)
        if (prepared.type !== "tempo") throw Error("V4 requires native Tempo signing")
        return account.signTransaction(prepared as TempoTransaction.TransactionSerializableTempo, { serializer: Transaction.serialize })
      },
      proveMembership, verifyProviderSource: createReceivingProviderSourceHostV4(env)
    })
    await runtime.assertReady()
    return { ...runtime, close: async () => { await sourcePool.end(); await executionPool.end() } }
  } catch (e) { await sourcePool.end(); await executionPool.end(); throw e }
}

export async function loadReceivingMembershipProverV4(env: NodeJS.ProcessEnv = process.env) {
  const { createHash } = await import("node:crypto"), { readFile } = await import("node:fs/promises"), {encodeAbiParameters} = await import("viem")
  const { RECEIVING_V4_ARTIFACTS, receivingArtifactNameV4 } = await import("../internal/receiving/receiving-artifacts-v4.js")
  const { resolve, isAbsolute } = await import("node:path"), { pathToFileURL } = await import("node:url")
  const configured = env.PARLY_SDK_ASSETS_PATH
  if (configured && !isAbsolute(configured)) throw Error("V4 receiving proof artifact directory must be absolute")
  const spec = RECEIVING_V4_ARTIFACTS.membership, root = configured ? pathToFileURL(resolve(configured) + "/") : new URL("../../../../../../../packages/sdk/assets/", import.meta.url)
  const artifact = async (kind: "wasm" | "zkey") => {
    const bytes = await readFile(new URL(receivingArtifactNameV4("membership", kind), root))
    if (createHash("sha256").update(bytes).digest("hex") !== spec[kind]) throw Error("V4 receiving proof artifact mismatch")
    return bytes
  }
  const wasm = await artifact("wasm"), zkey = await artifact("zkey")
  const { createRequire } = await import("node:module"), { groth16 } = createRequire(import.meta.url)("snarkjs")
  return async (input: Record<string,unknown>) => {
    const result = await groth16.fullProve(input, wasm, zkey, undefined, undefined, { singleThread: true })
    if (result.publicSignals.length !== spec.nPublic) throw Error("V4 receiving membership signal count")
    const calldata = JSON.parse("[" + await groth16.exportSolidityCallData(result.proof, result.publicSignals) + "]")
    const values = calldata.slice(0, 3).map((v: unknown) => JSON.parse(JSON.stringify(v), (_, n) => typeof n === "string" ? BigInt(n) : n))
    return { proof: encodeAbiParameters([{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }], values as [readonly [bigint, bigint], readonly [readonly [bigint, bigint], readonly [bigint, bigint]], readonly [bigint, bigint]]), publicSignals: result.publicSignals as string[] }
  }
}
