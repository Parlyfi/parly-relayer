import process from "node:process"

const required = [
  "RELAYER_PRIVATE_KEY",
  "RELAYER_BOX_PRIVATE_KEY_B64",
  "TEMPO_RPC_URL",
  "TEMPO_CHAIN_ID",
  "SETTLEMENT_DOMAIN_ID",
  "WAKU_CLUSTER_ID",
  "WAKU_BOOTSTRAP",
  "WAKU_CONTENT_TOPIC"
]

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} missing`)
  }
}

if (!/^[1-9][0-9]*$/.test(String(process.env.TEMPO_CHAIN_ID))) {
  throw new Error("TEMPO_CHAIN_ID must be a positive integer chain ID")
}

if (!/^[1-9][0-9]*$/.test(String(process.env.SETTLEMENT_DOMAIN_ID)) || String(process.env.SETTLEMENT_DOMAIN_ID).includes("REPLACE_WITH_REAL")) {
  throw new Error("SETTLEMENT_DOMAIN_ID must be the real Tempo 4217 settlement domain")
}

if (!/^[1-9][0-9]*$/.test(String(process.env.WAKU_CLUSTER_ID))) {
  throw new Error("WAKU_CLUSTER_ID must be a positive integer")
}

if (process.env.WAKU_BOOTSTRAP !== "true" && process.env.WAKU_BOOTSTRAP !== "false") {
  throw new Error("WAKU_BOOTSTRAP must be either true or false")
}

if (process.env.RELAYER_REGISTRY_API_BASE_URL) {
  new URL(String(process.env.RELAYER_REGISTRY_API_BASE_URL))
}

console.log("Relayer healthcheck configuration OK")
