import type { PrivateKeyAccount } from "viem/accounts"
import { buildRelayerHeartbeatMessage } from "@parly/crypto-utils"
import type { SignedRelayExecutionFeeScheduleV2 } from "@parly/shared-types"

export async function postRelayerHeartbeat(
  account: PrivateKeyAccount,
  feeSchedules: readonly SignedRelayExecutionFeeScheduleV2[] = []
) {
  const baseUrl = String(process.env.RELAYER_REGISTRY_API_BASE_URL || "").trim()
  if (!baseUrl) {
    return { sent: false as const, reason: "registry_not_configured" as const }
  }

  const endpoint = new URL("/api/relayers/heartbeat", baseUrl).toString()
  const timestamp = Math.floor(Date.now() / 1000)
  const executionAddress = account.address.toLowerCase() as `0x${string}`
  const signature = await account.signMessage({
    message: buildRelayerHeartbeatMessage(executionAddress, "SUCCESS", timestamp)
  })
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      executionAddress,
      event: "SUCCESS",
      timestamp,
      signature,
      ...(feeSchedules.length === 0 ? {} : { feeSchedules })
    })
  })

  if (!res.ok) {
    throw new Error(`Relayer heartbeat failed with HTTP ${res.status}`)
  }

  return { sent: true as const }
}
