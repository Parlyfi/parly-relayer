import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const source = await readFile(new URL("../src/smoke-config.ts", import.meta.url), "utf8")
const mainnetConfigSource = await readFile(new URL("../src/mainnet-config.ts", import.meta.url), "utf8")
const botSource = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8")
const reconcilePendingSource = await readFile(new URL("../src/reconcile-pending.ts", import.meta.url), "utf8")

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

test("relayer mainnet config uses settlement domain instead of LayerZero EID envs", () => {
  assert.match(mainnetConfigSource, /SETTLEMENT_DOMAIN_ID/u)
  assert.doesNotMatch(mainnetConfigSource, /TEMPO_LZ_EID/u)
  assert.doesNotMatch(mainnetConfigSource, /requirePositiveEid/u)
})

test("relayer smoke config includes V3 payout runtime readiness without enabling execution", () => {
  assert.match(source, /readPhase3PayoutV3RuntimeConfig/u)
  assert.match(source, /v3PayoutRuntime/u)
  assert.match(source, /payoutExecutionEnabled/u)
  assert.match(source, /broadcastEnabled/u)
  assert.match(source, /feePayerEnabled/u)
  assert.doesNotMatch(source, /writeContract/u)
  assert.doesNotMatch(source, /sendTransaction/u)
})

test("normal relayer transaction sinks are gated by Phase 3 live and outbound flags", async () => {
  const gateSource = await readFile(new URL("../src/phase3-broadcast-gate.ts", import.meta.url), "utf8")
  assert.match(gateSource, /PHASE3_LIVE_TRANSACTIONS_ENABLED/u)
  assert.match(gateSource, /PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED/u)

  const botSinkCount = (botSource.match(/safeApproveExactRelayer\(|walletClient\.writeContract\(/gu) ?? []).length
  const botGateCount = (botSource.match(/requirePhase3BroadcastEnabled\(/gu) ?? []).length
  assert.equal(botSinkCount, 3)
  assert.ok(botGateCount >= botSinkCount, "every bot approval/write sink must have a local broadcast gate")

  const reconcileSinkCount = (reconcilePendingSource.match(/safeApproveExactRelayer\(/gu) ?? []).length
  const reconcileGateCount = (reconcilePendingSource.match(/isPhase3BroadcastEnabled\(/gu) ?? []).length
  assert.equal(reconcileSinkCount, 1)
  assert.ok(
    reconcileGateCount >= reconcileSinkCount,
    "pending reconciliation cleanup must not approve unless broadcast flags are enabled"
  )
})
