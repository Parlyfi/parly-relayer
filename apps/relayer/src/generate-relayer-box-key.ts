import "dotenv/config"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { privateKeyToAccount } from "viem/accounts"
import { requireEnv } from "@parly/env-utils"

const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo").default

async function main() {
  await sodium.ready

  const relayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY") as `0x${string}`
  const account = privateKeyToAccount(relayerPrivateKey)
  const outputFile = path.resolve(
    process.cwd(),
    process.env.RELAYER_KEY_OUTPUT_FILE || ".secrets/relayer-box.env"
  )

  const keypair = sodium.crypto_box_keypair()
  const publicKeyB64 = sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL)
  const privateKeyB64 = sodium.to_base64(keypair.privateKey, sodium.base64_variants.ORIGINAL)

  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.writeFileSync(
    outputFile,
    [
      `RELAYER_ADDRESS=${account.address}`,
      `RELAYER_BOX_PRIVATE_KEY_B64=${privateKeyB64}`,
      `RELAYER_BOX_PUBLIC_KEY_B64=${publicKeyB64}`,
      `RELAYER_REGISTRATION_EXECUTION_ADDRESS=${account.address}`,
      `RELAYER_REGISTRATION_PUBLIC_KEY_B64=${publicKeyB64}`
    ].join("\n") + "\n",
    "utf8"
  )

  console.log(`RELAYER_EXECUTION_ADDRESS=${account.address}`)
  console.log(`RELAYER_BOX_PUBLIC_KEY_B64=${publicKeyB64}`)
  console.log(`RELAYER_KEY_OUTPUT_FILE=${outputFile}`)
}

void main()
