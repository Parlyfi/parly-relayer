import assert from "node:assert/strict"
import test from "node:test"
import {
  buildRecoveryAuthMessage,
  assertRecoveryAuthContext,
  V1_RECOVERY_AUTH_MESSAGE
} from "../dist/index.js"

const baseContext = {
  appName: "Parly",
  officialOrigin: "https://parly.fi",
  currentOrigin: "https://parly.fi",
  purpose: "private payment note recovery",
  recoveryVersion: 2,
  environment: "mainnet",
  chainId: 777777,
  settlementDomainId: 4217,
  poolAddress: "0x1111111111111111111111111111111111111111",
  verifierAddress: "0x2222222222222222222222222222222222222222",
  assetPoolIdentity: "Tempo mainnet USDC.e pool set"
}

test("changing origin changes the recovery auth message", () => {
  assert.notEqual(
    buildRecoveryAuthMessage({ ...baseContext, environment: "staging" }),
    buildRecoveryAuthMessage({
      ...baseContext,
      environment: "staging",
      currentOrigin: "https://evil.example"
    })
  )
})

test("changing chain ID changes the recovery auth message", () => {
  assert.notEqual(
    buildRecoveryAuthMessage(baseContext),
    buildRecoveryAuthMessage({ ...baseContext, chainId: 42431 })
  )
})

test("changing settlement domain changes the recovery auth message", () => {
  assert.notEqual(
    buildRecoveryAuthMessage(baseContext),
    buildRecoveryAuthMessage({ ...baseContext, settlementDomainId: 42431 })
  )
})

test("staging and mainnet settlement domains produce different recovery messages", () => {
  assert.notEqual(
    buildRecoveryAuthMessage({
      ...baseContext,
      environment: "staging",
      chainId: 42431,
      settlementDomainId: 40444
    }),
    buildRecoveryAuthMessage({
      ...baseContext,
      environment: "mainnet",
      chainId: 4217,
      settlementDomainId: 4217
    })
  )
})

test("changing pool changes the recovery auth message", () => {
  assert.notEqual(
    buildRecoveryAuthMessage(baseContext),
    buildRecoveryAuthMessage({
      ...baseContext,
      poolAddress: "0x3333333333333333333333333333333333333333"
    })
  )
})

test("changing environment changes the recovery auth message", () => {
  assert.notEqual(
    buildRecoveryAuthMessage(baseContext),
    buildRecoveryAuthMessage({ ...baseContext, environment: "staging" })
  )
})

test("v2 message does not equal the old static v1 message", () => {
  assert.notEqual(buildRecoveryAuthMessage(baseContext), V1_RECOVERY_AUTH_MESSAGE)
})

test("production refuses v1 recovery context", () => {
  assert.throws(
    () => assertRecoveryAuthContext({ ...baseContext, recoveryVersion: 1 }),
    /v1 recovery signatures are forbidden/i
  )
})

test("production fails closed on origin mismatch", () => {
  assert.throws(
    () =>
      assertRecoveryAuthContext({
        ...baseContext,
        currentOrigin: "https://parly-clone.example"
      }),
    /origin mismatch/i
  )
})
