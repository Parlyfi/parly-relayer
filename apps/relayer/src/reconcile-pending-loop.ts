import "dotenv/config"
import { createServer } from "node:http"
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

function startHealthServer() {
  const port = Number(process.env.PORT || "0")
  if (!Number.isInteger(port) || port <= 0) return

  createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, service: "pending-reconciler" }))
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: false }))
  }).listen(port)
}

async function main() {
  const intervalMs = parseInterval(process.env.RELAYER_PENDING_RECONCILE_INTERVAL_MS, 30000)
  startHealthServer()

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
