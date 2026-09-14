export type Phase3BroadcastEnv = {
  [key: string]: string | undefined
  PHASE3_LIVE_TRANSACTIONS_ENABLED?: string
  PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED?: string
}

const REQUIRED_LIVE_FLAG = "PHASE3_LIVE_TRANSACTIONS_ENABLED=true"
const REQUIRED_OUTBOUND_FLAG = "PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED=true"

export class Phase3BroadcastDisabledError extends Error {
  constructor(action: string) {
    super(`${action} requires ${REQUIRED_LIVE_FLAG} and ${REQUIRED_OUTBOUND_FLAG}`)
    this.name = "Phase3BroadcastDisabledError"
  }
}

export function isPhase3BroadcastEnabled(env: Phase3BroadcastEnv = process.env): boolean {
  return (
    env.PHASE3_LIVE_TRANSACTIONS_ENABLED === "true" &&
    env.PHASE3_RELAY_OUTBOUND_BROADCAST_ENABLED === "true"
  )
}

export function requirePhase3BroadcastEnabled(
  action: string,
  env: Phase3BroadcastEnv = process.env
): void {
  if (!isPhase3BroadcastEnabled(env)) {
    throw new Phase3BroadcastDisabledError(action)
  }
}
