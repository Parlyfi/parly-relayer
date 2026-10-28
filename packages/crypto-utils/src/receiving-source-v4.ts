export type ReceivingProviderSourceV4 = {
  sourceChainId: number; sourceToken: string; sourceDecimals: number; sourceAmountBaseUnits: string
  depositAddress: string; requestId: string; refundWallet: string; quoteExpiresAt: string; attemptExpiresAt: string
}
export function receivingProviderSourceFrameV4(s: ReceivingProviderSourceV4, d: { attemptId: string; chainId: number; token: string; virtualAddress: string; amount: string }) {
  const address = (v: unknown): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v) && BigInt(v) !== 0n
  const hash = (v: unknown): v is string => typeof v === "string" && /^0x[a-f0-9]{64}$/.test(v) && BigInt(v) !== 0n
  const amount = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,77}$/.test(v) && BigInt(v) < 1n << 256n
  const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
  if (![1, 56, 8453, 42161].includes(s.sourceChainId) || d.chainId !== 4217 || !address(s.sourceToken) || !address(s.depositAddress) || !address(s.refundWallet) || !address(d.token) || !address(d.virtualAddress) || !hash(s.requestId) || !hash(d.attemptId) || !amount(s.sourceAmountBaseUnits) || !amount(d.amount) || !Number.isInteger(s.sourceDecimals) || s.sourceDecimals < 0 || s.sourceDecimals > 18 || !date(s.quoteExpiresAt) || !date(s.attemptExpiresAt) || Date.parse(s.quoteExpiresAt) > Date.parse(s.attemptExpiresAt)) throw Error("UNAVAILABLE: original V4 provider source")
  return JSON.stringify(["Parly provider receiving source", 4, d.attemptId, d.chainId, d.token.toLowerCase(), d.virtualAddress.toLowerCase(), d.amount, s.sourceChainId, s.sourceToken.toLowerCase(), s.sourceDecimals, s.sourceAmountBaseUnits, s.depositAddress.toLowerCase(), s.requestId, s.refundWallet.toLowerCase(), s.quoteExpiresAt, s.attemptExpiresAt])
}
