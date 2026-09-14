import assert from "node:assert/strict"
import test from "node:test"
import {
  applyPhase3PayoutLifecycleEvent,
  mapPhase3PayoutV3EventToPublicLifecycle,
  projectPhase3PayoutV3EventForDatasource
} from "../dist/index.js"

const base = {
  kind: "payout_record",
  payoutId: "payout_public_1",
  statusAccessTokenHash: "status-token-hash",
  status: "payout_requested",
  auditEventIds: ["event-1"]
}

test("payout lifecycle projection applies canonical transitions with audit and recovery state", () => {
  const next = applyPhase3PayoutLifecycleEvent(base, {
    eventId: "event-2",
    status: "quote_accepted",
    authority: "system",
    updatedAt: "2026-06-09T00:00:00.000Z"
  })

  assert.equal(next.status, "quote_accepted")
  assert.deepEqual(next.auditEventIds, ["event-1", "event-2"])
  assert.match(next.recoveryPath, /continue payout lifecycle/u)
  assert.equal(next.terminalPath, "complete payout or make claimant-bound refund available")
})

test("payout lifecycle projection rejects impossible transitions and reasonless exceptional states", () => {
  assert.throws(
    () =>
      applyPhase3PayoutLifecycleEvent(base, {
        eventId: "event-2",
        status: "payout_completed",
        authority: "provider_contract"
      }),
    /invalid payout status transition/u
  )

  assert.throws(
    () =>
      applyPhase3PayoutLifecycleEvent(
        { ...base, status: "pool_withdrawal_pending" },
        { eventId: "event-2", status: "manual_review", authority: "owner" }
      ),
    /reason hash required/u
  )

  assert.throws(
    () =>
      applyPhase3PayoutLifecycleEvent(
        { ...base, status: "refund_available" },
        { eventId: "event-3", status: "refunded", authority: "refund_claimant" }
      ),
    /reason hash required/u
  )
})

test("payout lifecycle projection allows public-expiry refund availability without manual reason hash", () => {
  const next = applyPhase3PayoutLifecycleEvent(
    { ...base, status: "payout_expired", auditEventIds: [] },
    { eventId: "event-refund", status: "refund_available", authority: "public_expiry" }
  )

  assert.equal(next.status, "refund_available")
  assert.equal(next.statusReasonHash, undefined)
})

test("payout lifecycle projection lets reserved escrow expire to claimant-bound refund", () => {
  const expired = applyPhase3PayoutLifecycleEvent(
    { ...base, status: "escrow_address_reserved", auditEventIds: [] },
    {
      eventId: "event-expired",
      status: "payout_expired",
      authority: "public_expiry",
      reasonHash: "b".repeat(64)
    }
  )
  const available = applyPhase3PayoutLifecycleEvent(expired, {
    eventId: "event-refund",
    status: "refund_available",
    authority: "public_expiry"
  })

  assert.equal(expired.status, "payout_expired")
  assert.equal(available.status, "refund_available")
})

test("payout lifecycle projection lets submitted payout timeout to claimant-bound refund", () => {
  const expired = applyPhase3PayoutLifecycleEvent(
    { ...base, status: "payout_submitted", auditEventIds: [] },
    {
      eventId: "event-submitted-expired",
      status: "payout_expired",
      authority: "public_expiry",
      reasonHash: "d".repeat(64)
    }
  )
  const available = applyPhase3PayoutLifecycleEvent(expired, {
    eventId: "event-submitted-refund",
    status: "refund_available",
    authority: "public_expiry"
  })

  assert.equal(expired.status, "payout_expired")
  assert.equal(available.status, "refund_available")
})

test("payout lifecycle projection is idempotent by audit event id", () => {
  const duplicate = applyPhase3PayoutLifecycleEvent(base, {
    eventId: "event-1",
    status: "quote_accepted",
    authority: "system"
  })

  assert.deepEqual(duplicate, base)
})

test("V3 adapter events project to the public payout lifecycle without leaking V3-only statuses", () => {
  assert.deepEqual(
    mapPhase3PayoutV3EventToPublicLifecycle({ eventId: "v3-quote", eventType: "quote_accepted" }).map(
      (event) => event.status
    ),
    ["quote_accepted", "escrow_address_reserved"]
  )
  assert.deepEqual(
    mapPhase3PayoutV3EventToPublicLifecycle({
      eventId: "v3-submit",
      eventType: "payout_submitted"
    }).map((event) => event.status),
    ["payout_pending", "payout_submitted"]
  )
  assert.deepEqual(
    mapPhase3PayoutV3EventToPublicLifecycle({
      eventId: "v3-escrow-refund",
      eventType: "escrow_refund_available",
      evidenceHash: "c".repeat(64)
    }).map((event) => event.status),
    ["payout_expired", "refund_available"]
  )
  assert.deepEqual(
    mapPhase3PayoutV3EventToPublicLifecycle({
      eventId: "v3-refund",
      eventType: "refund_available",
      evidenceHash: "a".repeat(64)
    }).map((event) => event.status),
    ["payout_expired", "refund_available"]
  )
  assert.equal(
    mapPhase3PayoutV3EventToPublicLifecycle({
      eventId: "v3-complete",
      eventType: "payout_completed"
    })[0].authority,
    "proof_verifier"
  )
  assert.throws(
    () => mapPhase3PayoutV3EventToPublicLifecycle({ eventId: "v3-claim", eventType: "refund_claimed" }),
    /evidence hash required/u
  )
})

test("V3 datasource projection declares append-only effects and redaction policy", () => {
  const projection = projectPhase3PayoutV3EventForDatasource({
    eventId: "v3-submit",
    eventType: "payout_submitted",
    v3Status: "payout_submitted"
  })

  assert.deepEqual(projection.publicEvents.map((event) => event.status), [
    "payout_pending",
    "payout_submitted"
  ])
  assert.deepEqual(projection.requiredDatasourceEffects, [
    "append:payout_pending",
    "append:payout_submitted",
    "set:provider_liability_status=active"
  ])
  assert.equal(
    projection.redactionPolicy.some((rule) => /never store destination recipient/u.test(rule)),
    true
  )

  const escrowRefund = projectPhase3PayoutV3EventForDatasource({
    eventId: "v3-escrow-refund",
    eventType: "escrow_refund_available",
    v3Status: "refund_available"
  })
  assert.equal(
    escrowRefund.requiredDatasourceEffects.includes("set:provider_liability_status=unreserved"),
    true
  )
})
