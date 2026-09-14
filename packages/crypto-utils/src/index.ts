export function looksLikeBase64(value: string) {
  return /^[A-Za-z0-9+/=]+$/.test(value)
}

export function buildRelayerHeartbeatMessage(
  executionAddress: `0x${string}`,
  event: "SUCCESS",
  timestamp: number
) {
  return [
    "Parly Relayer Heartbeat",
    `Execution Address: ${executionAddress}`,
    `Event: ${event}`,
    `Timestamp: ${timestamp}`,
    "Domain: parly.fi"
  ].join("\n")
}
