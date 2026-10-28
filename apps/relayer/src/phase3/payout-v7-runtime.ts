import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, hexToBytes, http, isAddress, keccak256, parseEventLogs, type Address, type Hex } from "viem"
import { tempoTestnet } from "viem/chains"
import { Transaction } from "viem/tempo"
import type { PrivateKeyAccount } from "viem/accounts"
import { parseReceivingProfileV4 } from "@parly/crypto-utils/receiving-profile-v4"
import { parlyPayoutAdapterV7Abi, parlyPayoutWithdrawalExecutorV3Abi } from "@parly/protocol-abis/payout-v7"
import { hashPayoutV7Batch, hashPayoutV7Payload, canonicalPayoutV7, type PayoutV7Child } from "../internal/sdk/payout-v7.js"
import { requirePhase3BroadcastEnabled } from "../phase3-broadcast-gate.js"
import { retainPoolV4RelayExecution, retirePayoutV7SourceLock } from "../pending-store.js"
import { createPayoutV7WorkerStore } from "./payout-v7-worker-store.js"
import { runPayoutV7Execution, runPayoutV7Transaction } from "./payout-v7-worker.js"
import { validatePayoutV7Execution } from "./payout-v7-execution.js"
import { requireCostCoveredRelayReward } from "./relay-reward.js"
import { assertPayoutV7NonceAvailable, payoutV7NonceKey, validatePayoutV7SignedTempo } from "./payout-v7-tempo.js"
import { validatePayoutV7RetirementCalls } from "./payout-v7-retirement.js"
import { readPayoutV7RetirementProof } from "../internal/receiving/payout-v7-retirement.js"
import { readPayoutV7AttesterClientConfig, requestPayoutV7Provenance, requestPayoutV7ProofAttestation, requestPayoutV7RefundAttestation, readPayoutV7RefundQuorum } from "./payout-v4-attester-client.js"
import { recoverPayoutV7RelayDeposit, relayRecoveryDepositAbi } from "./payout-v7-relay-recovery.js"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default
function check(ok: unknown): asserts ok { if (!ok) throw Error("V7 worker configuration or canonical evidence is unavailable.") }
export function buildPayoutV7WorkerMessage(body: { action: string; executionAddress: Address; manifestHash?: Hex; poolCall?: Hex; timestamp: number; nonce: Hex; retirementBlockNumber?: string; retirementBlockHash?: Hex }) {
  return `Parly payout V7 worker\nAction: ${body.action}\nOperator: ${body.executionAddress.toLowerCase()}\nManifest: ${body.manifestHash ?? "none"}\nPool Call: ${body.poolCall ? keccak256(body.poolCall) : "none"}\nTimestamp: ${body.timestamp}\nNonce: ${body.nonce}${body.action === "retire" ? `\nRetirement Block: ${body.retirementBlockNumber}\nRetirement Block Hash: ${body.retirementBlockHash}` : ""}`
}

// V7 is isolated from older funded readers and from the new-quote enable switch.
export function startPayoutV7ExecutionLoop(args: { account: PrivateKeyAccount; chainId: number; env?: NodeJS.ProcessEnv }) {
  const env = args.env ?? process.env
  if (env.PHASE3_PAYOUT_V7_RELAYER_WORKER_ENABLED !== "true") return
  if (env.PHASE3_PAYOUT_V7_BROADCAST_ENABLED !== "true") return
  const profile = parseReceivingProfileV4(env.PHASE3_RECEIVING_V4_PROFILE_JSON ?? ""), c = JSON.parse(env.PHASE3_PAYOUT_V7_CONFIG_JSON ?? "null")
  check(c && profile.chainId === args.chainId && [c.adapter, c.executor, c.provider].every(a => isAddress(a) && BigInt(a) > 0n))
  check(typeof c.registrationSettlementGasUnits === "string" && /^[1-9][0-9]{0,7}$/.test(c.registrationSettlementGasUnits) && BigInt(c.registrationSettlementGasUnits) < 30000000n)
  check(Array.isArray(c.codePins) && c.codePins.length <= 32 && [c.adapter, c.executor, c.provider].every(a => c.codePins.some((p: any) => getAddress(p.address) === getAddress(a))))
  const url = new URL(env.PHASE3_PAYOUT_V7_WEB_API_BASE_URL ?? "")
  check((url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) && !url.username && !url.password)
  const privateKey = Buffer.from(env.RELAYER_BOX_PRIVATE_KEY_B64 ?? "", "base64"); check(privateKey.length === 32)
  const attester = readPayoutV7AttesterClientConfig(env); check(attester.enabled)
  const rpc = env.PHASE3_TEMPO_RPC_URL || env.TEMPO_RPC_URL, feeToken = env.PHASE3_RECEIVING_V4_FEE_TOKEN as Address
  check(rpc && new URL(rpc).protocol === "https:" && feeToken && profile.assets.some(a => a.token.toLowerCase() === feeToken.toLowerCase()))
  const chain = defineChain({ id: profile.chainId, name: "Tempo", nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 }, rpcUrls: { default: { http: [rpc] } },
    formatters: tempoTestnet.formatters, serializers: tempoTestnet.serializers, prepareTransactionRequest: tempoTestnet.prepareTransactionRequest })
  const transport = http(rpc, { timeout: 12000, retryCount: 0 }), client: any = createPublicClient({ chain, transport }), account = args.account
  const wallet = createWalletClient({ account, chain, transport }), store = createPayoutV7WorkerStore()
  const pollMs = Number(env.PHASE3_PAYOUT_V7_POLL_MS ?? 5000); check(Number.isSafeInteger(pollMs) && pollMs >= 1000)
  const pins = [...profile.codePins, ...c.codePins]
  async function snapshot<T>(run: (blockNumber: bigint) => Promise<T>) {
    check(await client.getChainId() === profile.chainId)
    const block = await client.getBlock({ blockTag: "finalized" }); check(typeof block.number === "bigint" && block.hash)
    for (const pin of pins) check(keccak256(await client.getCode({ address: pin.address, blockNumber: block.number }) ?? "0x") === pin.codeHash)
    const result = await run(block.number)
    check((await client.getBlock({ blockNumber: block.number })).hash === block.hash && await client.getChainId() === profile.chainId)
    return result
  }
  const readState = (child: { intentHash: Hex }) => snapshot(async blockNumber => {
    const [status, record] = await Promise.all(["status", "getPayoutRecord"].map(functionName => client.readContract({ address: c.adapter, abi: parlyPayoutAdapterV7Abi, functionName, args: [child.intentHash], blockNumber })))
    return { status: Number(status), escrowFundedAt: BigInt(record.escrowFundedAt) }
  })
  const outcome = async (hash: Hex) => {
    try {
      return await snapshot(async finalized => {
        const r = await client.getTransactionReceipt({ hash }), tx = await client.getTransaction({ hash })
        check(r.transactionHash === hash && tx.hash === hash && r.blockNumber <= finalized && r.blockHash === tx.blockHash && r.blockNumber === tx.blockNumber && r.transactionIndex === tx.transactionIndex && tx.from.toLowerCase() === account.address.toLowerCase() && r.from.toLowerCase() === account.address.toLowerCase())
        const block = await client.getBlock({ blockNumber: r.blockNumber }); check(block.hash === r.blockHash && block.transactions[Number(r.transactionIndex)] === hash)
        return r.status === "success" ? "success" as const : "failed" as const
      })
    } catch { return "pending" as const }
  }
  async function request(action: string, fields: { manifestHash?: Hex; poolCall?: Hex; retirementBlockNumber?: string; retirementBlockHash?: Hex } = {}) {
    const body = { action, executionAddress: account.address, ...fields, timestamp: Math.floor(Date.now() / 1000), nonce: `0x${randomBytes(32).toString("hex")}` as Hex }
    const signature = await account.signMessage({ message: buildPayoutV7WorkerMessage(body) })
    const response = await fetch(new URL(`/api/phase3/payout-v7/${action}`, url), { method: "POST", headers: { "content-type": "application/json" }, body: canonicalPayoutV7({ ...body, signature }), signal: AbortSignal.timeout(15000) })
    check(response.ok)
    const result = await response.json() as any; check(result.ok === true); return result
  }
  let running = false, nextJob = 0
  const nextRecovery = new Map<string, number>()
  const tick = async () => {
    if (running) return
    running = true
    try {
      requirePhase3BroadcastEnabled("Payout V7 execution")
      const jobs = (await request("jobs")).jobs; check(Array.isArray(jobs) && jobs.length <= 32)
      // One rotating group per tick leaves room in the existing HTTP rate budget.
      for (const manifestHash of jobs.length ? [jobs[nextJob++ % jobs.length]] : []) {
        try {
          check(/^0x[a-fA-F0-9]{64}$/.test(manifestHash))
          const value = (await request("package", { manifestHash })).package
          check(value && typeof value.sealedExecutionPayload === "string" && /^0x(?:[a-fA-F0-9]{2})+$/.test(value.sealedExecutionPayload) && value.sealedExecutionPayload.length <= 131074)
          await sodium.ready
          const publicKey = sodium.crypto_scalarmult_base(privateKey), publicKeyB64 = sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL)
          const bytes = sodium.crypto_box_seal_open(hexToBytes(value.sealedExecutionPayload), publicKey, privateKey); check(bytes)
          const execution = validatePayoutV7Execution({ value, manifestHash, proof: JSON.parse(Buffer.from(bytes).toString("utf8")), profile, operator: account.address, adapter: c.adapter, executor: c.executor, publicKeyB64 })
          const { manifest: m, poolCall } = execution
          const id = (step: string) => `${profile.chainId}:${c.adapter.toLowerCase()}:${account.address.toLowerCase()}:${manifestHash}:${step}`
          if ((await client.getBlock({ blockTag: "finalized" })).timestamp > BigInt(m.quoteExpiresAt)) {
            const states = await Promise.all(m.children.map(readState))
            if (states.every(s => [0, 1].includes(s.status) && s.escrowFundedAt === 0n)) {
              const retirement = await retirePayoutV7SourceLock({ callHash: m.sourceCallHash, pool: m.sourcePool, relayer: account.address, nullifiers: execution.nullifiers }, async () => {
                const rows = await store.list(id(""))
                const source = rows.find(row => row.id === id("source"))
                check(Object.hasOwn(value, "sourceLeaseExpiry") && (value.sourceLeaseExpiry === null || typeof value.sourceLeaseExpiry === "string" && /^(0|[1-9][0-9]*)$/.test(value.sourceLeaseExpiry)))
                let leaseExpiry: bigint | undefined = value.sourceLeaseExpiry === null ? undefined : BigInt(value.sourceLeaseExpiry)
                if (source) {
                  const decoded = (await import("viem")).decodeFunctionData({ abi: parlyPayoutWithdrawalExecutorV3Abi, data: source.data })
                  check(decoded.functionName === "executeWithdrawal" && (leaseExpiry === undefined || leaseExpiry === decoded.args[0].expiry)); leaseExpiry = decoded.args[0].expiry
                }
                const proof = await readPayoutV7RetirementProof({ client, profile, pins: c.codePins, manifest: m, poolCall, leaseExpiry })
                const calls = await validatePayoutV7RetirementCalls({ rows, prefix: id(""), manifest: m, poolCall, signatures: execution.signatures, operator: account.address, feeToken, timestamp: BigInt(proof.blockTimestamp) })
                return { ...proof, calls }
              })
              await request("retire", { manifestHash, poolCall, retirementBlockNumber: retirement.blockNumber, retirementBlockHash: retirement.blockHash })
              continue
            }
          }
          async function transaction(step: string, prepare: () => Promise<{ to: Address; data: Hex }>) {
            const retained = await store.read(id(step)), tx = retained ?? await prepare()
            const context = { chainId: profile.chainId, operator: account.address, feeToken }, lane = payoutV7NonceKey(id(step))
            if (retained) await validatePayoutV7SignedTempo(retained, context)
            return runPayoutV7Transaction({ id: id(step), to: tx.to, data: tx.data, store,
              outcome: async hash => {
                try { const mined = await client.getTransaction({ hash }); check(mined.calls?.length === 1 && mined.calls[0].to?.toLowerCase() === tx.to.toLowerCase() && mined.calls[0].data === tx.data && (mined.calls[0].value ?? 0n) === 0n) }
                catch { return "pending" as const }
                return outcome(hash)
              },
              prepare: async () => {
                await snapshot(async () => undefined)
                requirePhase3BroadcastEnabled("Payout V7 execution"); check(env.PHASE3_PAYOUT_V7_BROADCAST_ENABLED === "true")
                await client.call({ account, to: tx.to, data: tx.data })
                await assertPayoutV7NonceAvailable(client, account.address, lane)
                const prepared = await wallet.prepareTransactionRequest({ type: "tempo", chain, account, nonceKey: lane, nonce: 0, feeToken, calls: [{ to: tx.to, data: tx.data, value: 0n }], maxFeePerGas: await client.getGasPrice(), maxPriorityFeePerGas: 0n } as never)
                check(prepared.type === "tempo")
                if (step === "source") {
                  const price = BigInt(prepared.gasPrice ?? prepared.maxFeePerGas ?? 0), gas = BigInt(prepared.gas ?? 0)
                  check(price > 0n && gas > 0n)
                  requireCostCoveredRelayReward(BigInt(m.sourceExecutorFeeBaseUnits), gas, price)
                } else {
                  const child = m.children.find(child => step.endsWith(`:${child.intentHash}`))
                  if (child && ["accept", "registration", "confirm", "submit", "complete"].some(stage => step.startsWith(stage + ":"))) {
                    const price = BigInt(prepared.gasPrice ?? prepared.maxFeePerGas ?? 0), gas = BigInt(prepared.gas ?? 0)
                    check(price > 0n && gas > 0n && getAddress(child.intent.registrationOperator) === getAddress(account.address))
                    const priorCost = async (stage: string) => {
                      const retained = await store.read(id(`${stage}:${child.intentHash}`)); check(retained && await outcome(retained.transactionHash) === "success")
                      const r = await client.getTransactionReceipt({ hash: retained.transactionHash })
                      check(typeof r.gasUsed === "bigint" && r.gasUsed > 0n && typeof r.effectiveGasPrice === "bigint" && r.effectiveGasPrice > 0n)
                      return BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)
                    }
                    if (step.startsWith("accept:")) requireCostCoveredRelayReward(child.intent.registrationReimbursement, gas + BigInt(c.registrationSettlementGasUnits), price)
                    if (step.startsWith("registration:")) requireCostCoveredRelayReward(child.intent.registrationReimbursement, 1n, gas * price + await priorCost("accept"))
                    if (step.startsWith("confirm:")) requireCostCoveredRelayReward(child.intent.submissionReimbursement, gas, price)
                    if (step.startsWith("submit:")) requireCostCoveredRelayReward(child.intent.submissionReimbursement, 1n, gas * price + await priorCost("confirm"))
                    if (step.startsWith("complete:")) requireCostCoveredRelayReward(child.intent.deliverySuccessFee, gas, price)
                  }
                }
                const serializedTransaction = await account.signTransaction(prepared as Transaction.TransactionSerializableTempo, { serializer: Transaction.serialize })
                await validatePayoutV7SignedTempo({ id: id(step), to: tx.to, data: tx.data, serializedTransaction, transactionHash: keccak256(serializedTransaction) }, context)
                await assertPayoutV7NonceAvailable(client, account.address, lane)
                return { serializedTransaction, transactionHash: keccak256(serializedTransaction) }
              },
              broadcast: async serializedTransaction => {
                requirePhase3BroadcastEnabled("Payout V7 execution"); check(env.PHASE3_PAYOUT_V7_BROADCAST_ENABLED === "true")
                await retainPoolV4RelayExecution({ callHash: m.sourceCallHash, pool: m.sourcePool, relayer: account.address, nullifiers: execution.nullifiers })
                await validatePayoutV7SignedTempo({ id: id(step), to: tx.to, data: tx.data, serializedTransaction, transactionHash: keccak256(serializedTransaction) }, context)
                await assertPayoutV7NonceAvailable(client, account.address, lane)
                return wallet.sendRawTransaction({ serializedTransaction })
              }
            })
          }
          const adapterTx = (functionName: string, values: any[]) => Promise.resolve({ to: m.adapter, data: encodeFunctionData({ abi: parlyPayoutAdapterV7Abi, functionName, args: values } as any) })
          await runPayoutV7Execution<PayoutV7Child>({ children: m.children, readState,
            preflight: async () => {
              await snapshot(async blockNumber => { await client.call({ account: m.withdrawalExecutor, to: m.sourcePool, data: poolCall, blockNumber }) })
              await retainPoolV4RelayExecution({ callHash: m.sourceCallHash, pool: m.sourcePool, relayer: account.address, nullifiers: execution.nullifiers })
            },
            accept: child => transaction(`accept:${child.intentHash}`, () => adapterTx("acceptQuote", [child.intent, execution.signatures[m.children.indexOf(child)]])),
            registration: async child => {
              const fee = await snapshot<readonly [Address, bigint, boolean]>(blockNumber => client.readContract({ address: c.adapter, abi: parlyPayoutAdapterV7Abi, functionName: "registrationFees", args: [child.intentHash], blockNumber }))
              check(getAddress(fee[0]) === getAddress(account.address) && fee[1] === child.intent.registrationReimbursement)
              if (!fee[2]) await transaction(`registration:${child.intentHash}`, () => adapterTx("payRegistrationReimbursement", [child.intentHash]))
            },
            sourceHash: async () => (await store.read(id("source")))?.transactionHash ?? null,
            source: () => transaction("source", async () => {
              const leaseResult = (await request("claim", { manifestHash, poolCall })).claim
              const lease = Object.fromEntries(Object.entries(leaseResult.lease).map(([k, v]) => [k, ["maximumExecutorFee", "expiry"].includes(k) ? BigInt(String(v)) : v])) as any
              check(lease.intentHash === hashPayoutV7Batch(m.children.map(c => c.intentHash)) && lease.payloadHash === hashPayoutV7Payload(poolCall, m.children.map(c => c.intentHash), m.children.map(c => c.intent.sourceExecutorFeeAllocation)))
              check(getAddress(lease.adapter) === getAddress(m.adapter) && getAddress(lease.pool) === getAddress(m.sourcePool) && getAddress(lease.operator) === getAddress(account.address) && getAddress(lease.token) === getAddress(m.sourceToken) && lease.maximumExecutorFee === BigInt(m.sourceExecutorFeeBaseUnits) && lease.expiry > BigInt(Math.floor(Date.now() / 1000) + 15))
              check(/^0x[a-fA-F0-9]{130}$/.test(leaseResult.leaseSignature))
              return { to: m.withdrawalExecutor, data: encodeFunctionData({ abi: parlyPayoutWithdrawalExecutorV3Abi, functionName: "executeWithdrawal", args: [lease, leaseResult.leaseSignature, poolCall, m.children.map(c => c.intentHash), m.children.map(c => c.intent.sourceExecutorFeeAllocation)] }) }
            }),
            provenance: (child, withdrawalTxHash) => requestPayoutV7Provenance({ config: attester, intentHash: child.intentHash, withdrawalTxHash }),
            confirm: (child, provenance: any) => transaction(`confirm:${child.intentHash}`, () => adapterTx("confirmEscrowReceipt", [provenance.attestation, provenance.signature])),
            submit: child => transaction(`submit:${child.intentHash}`, () => adapterTx("submitPayout", [child.intentHash, child.destinationRecipient, child.providerData])),
            submissionHash: async child => (await store.read(id(`submit:${child.intentHash}`)))?.transactionHash ?? null,
            downstream: async (child, submissionTxHash) => {
              const completion = `complete:${child.intentHash}`, refund = `refund:${child.intentHash}`
              for (const step of [completion, refund]) if (await store.read(id(step))) { await transaction(step, async () => { throw Error("V7 retained terminal call missing.") }); return }
              let quorum
              try { quorum = await requestPayoutV7ProofAttestation({ config: attester, intentHash: child.intentHash, submissionTxHash }) } catch { /* Independent delivery may still be pending. */ }
              if (quorum?.ready && quorum.signatures.length >= 2) { await transaction(completion, () => adapterTx("completePayout", [quorum!.proof, quorum!.signatures])); return }
              if (c.directRefundBindingVerified && c.transactionTarget && Date.now() >= (nextRecovery.get(child.intentHash) ?? 0)) {
                nextRecovery.set(child.intentHash, Date.now() + 60000)
                try {
                  await recoverPayoutV7RelayDeposit({ child, submissionTxHash, transactionTarget: c.transactionTarget, store, apiKey: env.RELAY_API_KEY,
                    verifyDeposit: deposit => snapshot(async finalized => {
                      const receipt = await client.getTransactionReceipt({ hash: submissionTxHash })
                      const canonical = await client.getBlock({ blockNumber: receipt.blockNumber })
                      check(receipt.transactionHash === submissionTxHash && receipt.status === "success" && receipt.blockNumber <= finalized && canonical.hash === receipt.blockHash)
                      const events = parseEventLogs({ abi: relayRecoveryDepositAbi, logs: receipt.logs.filter((log: any) => getAddress(log.address) === getAddress(deposit.depository)), eventName: "RelayErc20Deposit", strict: true })
                        .filter(event => getAddress(event.args.from) === getAddress(deposit.escrow) && getAddress(event.args.token) === getAddress(deposit.token) && event.args.amount === deposit.amount && event.args.id === deposit.depositId)
                      check(events.length === 1)
                    }),
                    broadcast: call => transaction(`relay-recovery:${child.intentHash}:${call.key}`, async () => ({ to: call.to, data: call.data }))
                  })
                } catch { /* Recovery is not a refund proof; leave custody and terminal guards unchanged. */ }
              }
              try { await requestPayoutV7RefundAttestation({ config: attester, intentHash: child.intentHash, submissionTxHash }) } catch { return }
              const proof = await readPayoutV7RefundQuorum({ config: attester, intentHash: child.intentHash, submissionTxHash })
              if (proof.ready && proof.signatures.length >= 2) await transaction(refund, () => adapterTx("proveRelayRefund", [proof.proof, proof.signatures]))
            }
          })
        } catch { console.warn("[phase3-payout-v7] retained job awaits canonical evidence or configuration; no automatic rebroadcast.") }
      }
    } catch { console.warn("[phase3-payout-v7] worker unavailable; retained work is preserved.") }
    finally { running = false }
  }
  void tick()
  return setInterval(() => void tick(), pollMs)
}
