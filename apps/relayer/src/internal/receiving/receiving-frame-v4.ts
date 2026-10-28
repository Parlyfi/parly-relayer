import { encodeRecipientPublication, type RecipientPublication } from "@parly/crypto-utils/recipient-publication-v4"

export function restorePublicationFrameV4(input: unknown): RecipientPublication {
  const frame = structuredClone(input) as Record<string, unknown>
  for (const key of ["chainId", "nonce", "epoch", "validUntil", "assetMask"]) {
    if (typeof frame?.[key] !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(frame[key] as string)) throw Error("Invalid receiving publication.")
    frame[key] = BigInt(frame[key] as string)
  }
  encodeRecipientPublication(frame as unknown as RecipientPublication)
  return frame as unknown as RecipientPublication
}
