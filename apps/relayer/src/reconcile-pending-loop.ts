import "dotenv/config"
import { reconcilePendingOnce } from "./reconcile-pending.js"

function parseInterval(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? String(fallback))
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return fallback
  }
  return value
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const intervalMs = parseInterval(process.env.RELAYER_PENDING_RECONCILE_INTERVAL_MS, 30000)

  while (true) {
    try {
      await reconcilePendingOnce()
    } catch (e: any) {
      console.error(`Pending reconcile loop error: ${e.message || e}`)
    }

    await sleep(intervalMs)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
