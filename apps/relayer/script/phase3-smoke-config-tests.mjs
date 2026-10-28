import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const source = await readFile(new URL("../src/smoke-config.ts", import.meta.url), "utf8")
const mainnetConfigSource = await readFile(new URL("../src/mainnet-config.ts", import.meta.url), "utf8")
const botSource = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8")
const reconcilePendingSource = await readFile(new URL("../src/reconcile-pending.ts", import.meta.url), "utf8")
const reconcilePendingLoopSource = await readFile(new URL("../src/reconcile-pending-loop.ts", import.meta.url), "utf8")
const payoutV6AuthoritySource = await readFile(
  new URL("../src/phase3/payout-v6-authority-client.ts", import.meta.url),
  "utf8"
)

test("relayer Phase 3 smoke config uses Tempo 4217 settlement-domain semantics", () => {
  assert.match(source, /PHASE3_TEMPO_CHAIN_ID\s*=\s*4217/u)
  assert.match(source, /PHASE3_SETTLEMENT_DOMAIN_ID\s*=\s*4217/u)
  assert.match(source, /SETTLEMENT_DOMAIN_ID/u)
  assert.doesNotMatch(source, /LOCKED_TEMPO_CHAIN_ID\s*=\s*42431/u)
  assert.doesNotMatch(source, /LOCKED_TEMPO_LZ_EID/u)
})

test("relayer Phase 3 smoke config does not require public LayerZero EID envs", () => {
  assert.doesNotMatch(source, /requirePositiveEid/u)
  assert.doesNotMatch(source, /TEMPO_LZ_EID/u)
  assert.doesNotMatch(source, /Moderato staging/u)
})

test("PayoutV6 authority requires its version-specific API endpoint", () => {
  assert.match(payoutV6AuthoritySource, /apiBaseUrl:\s*apiBaseUrl\(env\.PHASE3_PAYOUT_V6_WEB_API_BASE_URL\)/u)
  assert.doesNotMatch(payoutV6AuthoritySource, /PHASE3_PAYOUT_V5_WEB_API_BASE_URL/u)
})

test("relayer mainnet config uses settlement domain instead of LayerZero EID envs", () => {
  assert.match(mainnetConfigSource, /SETTLEMENT_DOMAIN_ID/u)
  assert.doesNotMatch(mainnetConfigSource, /TEMPO_LZ_EID/u)
  assert.doesNotMatch(mainnetConfigSource, /requirePositiveEid/u)
})

test("relayer smoke config includes V3 payout runtime readiness without enabling execution", () => {
  assert.match(source, /readPhase3PayoutV3RuntimeConfig/u)
  assert.match(source, /v3PayoutRuntime/u)
  assert.match(source, /relayOutboundProviderV3/u)
  assert.match(source, /relayDepositAddressTargetV3/u)
  assert.match(source, /payoutExecutionEnabled/u)
  assert.match(source, /broadcastEnabled/u)
  assert.match(source, /feePayerEnabled/u)
  assert.doesNotMatch(source, /writeContract/u)
  assert.doesNotMatch(source, /sendTransaction/u)
})

test("relayer process starts the payout V3 execution worker from private payloads", async () => {
  assert.match(botSource, /startPayoutV3ExecutionWorkerLoop/u)
  assert.match(botSource, /preparedTransactionBroadcaster/u)
  assert.match(botSource, /publicClient/u)

  const workerSource = await readFile(new URL("../src/phase3/payout-execution-worker.ts", import.meta.url), "utf8")
  assert.match(workerSource, /createPayoutV3ExecutionPayloadDataSource/u)
  assert.match(workerSource, /createPayoutV3PreparationPayloadDataSource/u)
  assert.match(workerSource, /promoteConfirmedPayoutV3PreparationJobs/u)
  assert.match(workerSource, /getPayoutRecord/u)
  assert.match(workerSource, /receiptConfirmedAt/u)
  assert.match(workerSource, /runPayoutV3ExecutionOnce/u)
  assert.match(workerSource, /isEligibleOperatorFor/u)
  assert.match(workerSource, /payoutExecutionEnabled/u)
})

test("relayer private PoolV2 bundles reject cross-chain destination EIDs before legacy fee quotes", () => {
  assert.match(botSource, /PoolV2 cross-chain payout is disabled; use V3 payout route/u)
  assert.match(botSource, /decoded\.destEids\.some/u)
  assert.match(botSource, /quoteCrossChainFee/u)
  assert.ok(
    botSource.indexOf("PoolV2 cross-chain payout is disabled; use V3 payout route") <
      botSource.indexOf("quoteCrossChainFee"),
    "cross-chain PoolV2 guard must run before legacy fee quote"
  )
})

test("relayer rejects an unconfigured legacy PoolV2 before the first pool RPC", () => {
  assert.match(botSource, /function assertApprovedLegacyPool/u)
  assert.match(botSource, /PHASE3_USDC_POOL_V2/u)
  assert.match(botSource, /PHASE3_USDT_POOL_V2/u)
  assert.match(botSource, /assertApprovedLegacyPool\(decoded\.pool\)/u)
  assert.ok(
    botSource.indexOf("assertApprovedLegacyPool(decoded.pool)") <
      botSource.indexOf("address: decoded.pool"),
    "legacy pool admission must run before the first payload-selected pool RPC"
  )
})

test("relayer canonical payload validation isolates V4 and V5 authority bindings", () => {
  assert.match(botSource, /isPayoutV5WithdrawalBinding/u)
  assert.match(botSource, /isPayoutV5BatchBinding/u)
  assert.match(botSource, /hasExactPayoutBindingShape/u)
  assert.match(botSource, /new Set\(bindings\.map\(\(binding\) => binding\.intentHash/u)
  assert.match(botSource, /new Set\(bindings\.map\(\(binding\) => getAddress\(binding\.escrow\)/u)
})

test("durable relay inbox stays active for PoolV3 while retired workers remain disabled", () => {
  const v4Guard = 'process.env.PHASE3_PAYOUT_V4_RELAYER_WORKER_ENABLED !== "true"'
  const poolV3Guard = 'process.env.PHASE3_POOL_V3_RELAYER_ENABLED !== "true"'
  assert.match(botSource, new RegExp(v4Guard.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
  assert.match(botSource, new RegExp(poolV3Guard.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
  assert.ok(botSource.indexOf(v4Guard) < botSource.indexOf("claimRelayInboxBatch(account.address)"))
  assert.ok(botSource.indexOf(poolV3Guard) < botSource.indexOf("claimRelayInboxBatch(account.address)"))
})

test("expired PoolV3 inbox routes terminate without pretending a transaction was submitted", () => {
  assert.match(botSource, /if \(options\.source === "inbox"\) throw error/u)
  assert.match(botSource, /message === "Relay fee schedule is expired\."/u)
  assert.match(botSource, /markRelayInboxProcessed\(record\.id, "ROUTE_EXPIRED"\)/u)
})

test("normal relayer transaction sinks are gated by Phase 3 live and outbound flags", async () => {
  const gateSource = await readFile(new URL("../src/phase3-broadcast-gate.ts", import.meta.url), "utf8")
  assert.match(gateSource, /PHASE3_LIVE_TRANSACTIONS_ENABLED/u)
  assert.match(gateSource, /PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED/u)

  const botSinkCount = (botSource.match(/safeApproveExactRelayer\(|walletClient\.writeContract\(/gu) ?? []).length
  const botGateCount = (botSource.match(/requirePhase3BroadcastEnabled\(/gu) ?? []).length
  assert.equal(botSinkCount, 4)
  assert.ok(botGateCount >= botSinkCount, "every bot approval/write sink must have a local broadcast gate")

  const reconcileSinkCount = (reconcilePendingSource.match(/safeApproveExactRelayer\(/gu) ?? []).length
  const reconcileGateCount = (reconcilePendingSource.match(/isPhase3BroadcastEnabled\(/gu) ?? []).length
  assert.equal(reconcileSinkCount, 1)
  assert.ok(
    reconcileGateCount >= reconcileSinkCount,
    "pending reconciliation cleanup must not approve unless broadcast flags are enabled"
  )
})

test("pending reconciler exposes a Railway health probe without changing reconciliation", () => {
  assert.match(reconcilePendingLoopSource, /createServer/u)
  assert.match(reconcilePendingLoopSource, /process\.env\.PORT/u)
  assert.match(reconcilePendingLoopSource, /\/health/u)
  assert.match(reconcilePendingLoopSource, /pending-reconciler/u)
})
