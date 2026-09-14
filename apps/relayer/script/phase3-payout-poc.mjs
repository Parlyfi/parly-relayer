import { pathToFileURL } from "node:url"

const INTENT_HASH = `0x${"1".repeat(64)}`
const OPERATOR_ADDRESS = "0x5555555555555555555555555555555555555555"
const PROVIDER_CONTRACT = "0x4444444444444444444444444444444444444444"

async function loadPhase3() {
  return import("../dist/apps/relayer/src/phase3/index.js")
}

export async function runPayoutDryRunPoc({
  phase3: phase3Input,
  eligibilityReader = {
    async isEligibleOperatorFor() {
      return true
    }
  }
} = {}) {
  const phase3 = phase3Input ?? (await loadPhase3())
  return phase3.preparePayoutExecutionDryRun({
    job: {
      payoutId: "payout-poc-1",
      intentHash: INTENT_HASH,
      idempotencyKey: "phase3-payout:payout-poc-1",
      status: "escrow_receipt_confirmed",
      amountIn: 1_000n,
      minAmountOut: 900n,
      maxProviderFee: 50n,
      maxOperatorFee: 50n,
      providerContract: PROVIDER_CONTRACT
    },
    eligibilityReader,
    relayerOperatorAddress: OPERATOR_ADDRESS,
    providerFee: 50n,
    operatorFee: 50n
  })
}

async function main() {
  console.log(JSON.stringify(await runPayoutDryRunPoc(), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Payout POC failed.")
    process.exitCode = 1
  })
}
