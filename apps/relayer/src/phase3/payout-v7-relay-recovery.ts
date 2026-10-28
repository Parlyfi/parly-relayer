import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem"
import type { PayoutV7Child } from "../internal/sdk/payout-v7.js"

export const relayRecoveryExecuteAbi = parseAbi(["function execute(((address to,bytes data,uint256 value,bool allowFailure)[] calls,uint256 nonce,uint256 expiration) request,bytes signature) returns ((bool success,bytes returnData)[] results)"])
export const relayRecoveryDepositAbi = parseAbi(["event RelayErc20Deposit(address from,address token,uint256 amount,bytes32 id)"])
const transferAbi = parseAbi(["function transfer(address to,uint256 amount) returns (bool)"])
type Prepared = { amount: string; chainId: "tempo"; currency: Address; nonce: Hex; operation: "withdrawal"; owner: Address; ownerChainId: "tempo"; recipient: Address; additionalData?: Record<string, never> }
export type RelayRecoveryCheckpointV7 = { prepared: Prepared; preparedAt: number; jobId?: string }
export type RelayRecoveryStoreV7 = {
  readRecovery(id: string): Promise<RelayRecoveryCheckpointV7 | null>
  saveRecovery(id: string, value: RelayRecoveryCheckpointV7): Promise<void>
  removeRecovery(id: string): Promise<void>
}
function check(ok: unknown): asserts ok { if (!ok) throw Error("V7 Relay recovery evidence is unavailable or does not match this payout.") }
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase()
const integer = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,77}$/.test(v)
const jobId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v)

export async function recoverPayoutV7RelayDeposit(args: {
  child: PayoutV7Child; submissionTxHash: Hex; transactionTarget: Address; store: RelayRecoveryStoreV7
  verifyDeposit(deposit: { depository: Address; escrow: Address; token: Address; amount: bigint; depositId: Hex }): Promise<void>
  broadcast(call: { key: string; to: Address; data: Hex }): Promise<Hex>
  fetchImpl?: typeof fetch; apiKey?: string; now?: () => number
}) {
  const { child } = args, i = child.intent, now = args.now?.() ?? Math.floor(Date.now() / 1000)
  check(i.chainId === 4217n && hash(args.submissionTxHash))
  const [version, target, , targetData] = decodeAbiParameters([{ type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }], child.providerData)
  check(version === 1 && same(target, args.transactionTarget))
  const [depository, depositId, requestHash, escrow] = decodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }], targetData)
  check(same(escrow, i.escrow) && requestHash === i.requestIdHash && BigInt(depositId) > 0n)
  const fetchImpl = args.fetchImpl ?? fetch
  async function request(path: string, body?: unknown) {
    const response = await fetchImpl(new URL(path, "https://api.relay.link"), { method: body ? "POST" : "GET", redirect: "error",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(args.apiKey ? { "x-api-key": args.apiKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) })
    check(response.ok || response.status === 409 && path === "/withdrawals/request")
    const text = await response.text(); check(text.length <= 262144)
    return { status: response.status, value: JSON.parse(text) }
  }
  const id = `${i.adapter}:${child.intentHash}`.toLowerCase()
  let state = await args.store.readRecovery(id)
  if (!state) {
    const result = await request(`/requests/v3?depositTxHash=${args.submissionTxHash}&originChainId=4217&limit=10`)
    check(Array.isArray(result.value.requests) && result.value.requests.length <= 10)
    const matches = result.value.requests.filter((r: any) => hash(r.id) && keccak256(toHex(r.id)) === requestHash)
    if (!matches.length) return
    check(matches.length === 1)
    const r = matches[0], p = r.protocol
    if (!p || p.isWithdrawable !== true) return
    const origin = p.deposit?.origin
    check(["failure", "refund"].includes(r.status) && p.hubType === "onchain" && same(p.orderId, depositId) && origin
      && origin.chainId === 4217 && same(origin.transactionId, args.submissionTxHash) && same(origin.depository, depository)
      && same(origin.depositor, escrow) && same(origin.currency, i.token) && origin.amount === String(i.providerSourceAmount))
  }
  await args.verifyDeposit({ depository, escrow, token: i.token, amount: i.providerSourceAmount, depositId })
  function validatePrepared(p: Prepared) {
    check(p && p.operation === "withdrawal" && p.chainId === "tempo" && p.ownerChainId === "tempo"
      && p.owner === escrow.toLowerCase() && p.recipient === escrow.toLowerCase() && p.currency === i.token.toLowerCase()
      && integer(p.amount) && BigInt(p.amount) <= i.providerSourceAmount && hash(p.nonce) && BigInt(p.nonce) > 0n
      && (p.additionalData === undefined || p.additionalData && !Array.isArray(p.additionalData) && Object.keys(p.additionalData).length === 0))
  }
  if (state) { validatePrepared(state.prepared); check(Number.isSafeInteger(state.preparedAt) && state.preparedAt <= now) }
  if (state?.jobId) {
    check(jobId(state.jobId))
    const { value } = await request(`/withdrawals/status?id=${encodeURIComponent(state.jobId)}`)
    if (value.status === "expired" || value.status === "failed") { await args.store.removeRecovery(id); return }
    if (value.status !== "ready") return
    const tx = value.transaction
    check(tx && (tx.chainId === undefined || Number(tx.chainId) === 4217) && same(tx.to, depository)
      && [undefined, "0", "0x0", 0].includes(tx.value) && typeof tx.data === "string" && /^0x[0-9a-fA-F]+$/.test(tx.data) && tx.data.length <= 32770)
    const decoded = decodeFunctionData({ abi: relayRecoveryExecuteAbi, data: tx.data })
    check(decoded.functionName === "execute")
    const [execution, signature] = decoded.args
    check(execution.calls.length === 1 && execution.expiration > BigInt(now) && signature.length > 2 && signature.length <= 4098)
    const call = execution.calls[0]!
    check(same(call.to, i.token) && call.value === 0n && !call.allowFailure)
    const transfer = decodeFunctionData({ abi: transferAbi, data: call.data })
    check(transfer.functionName === "transfer" && same(transfer.args[0], escrow) && transfer.args[1] > 0n && transfer.args[1] <= BigInt(state.prepared.amount))
    check(encodeFunctionData({ abi: relayRecoveryExecuteAbi, functionName: "execute", args: decoded.args }).toLowerCase() === tx.data.toLowerCase())
    check(encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: transfer.args }).toLowerCase() === call.data.toLowerCase())
    await args.broadcast({ key: state.jobId, to: getAddress(depository), data: tx.data })
    return
  }
  if (!state || state.preparedAt + 45 <= now) {
    const base = { operation: "withdrawal" as const, chainId: "tempo" as const, currency: i.token.toLowerCase() as Address,
      ownerChainId: "tempo" as const, owner: escrow.toLowerCase() as Address, recipient: escrow.toLowerCase() as Address }
    const attested = await request("/withdrawals/attest-deposit", { chainId: 4217, transactionId: args.submissionTxHash })
    check(attested.value.success === true)
    const { operation: _operation, ...wireBase } = base
    const { value } = await request("/withdrawals/request", { ...wireBase, amount: String(i.providerSourceAmount) })
    const prepared: Prepared = { ...base, amount: value.amount, nonce: value.nonce, ...(Object.hasOwn(value, "additionalData") ? { additionalData: value.additionalData } : {}) }
    validatePrepared(prepared)
    state = { prepared, preparedAt: now }
    await args.store.saveRecovery(id, state)
  }
  const p = state.prepared
  const signature = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bool" }], [i.token, BigInt(p.amount), p.nonce, p.additionalData !== undefined])
  const { operation: _operation, ...wire } = p
  const { status, value } = await request("/withdrawals/request", { ...wire, signature })
  const nextJob = status === 409 && value.code === "WITHDRAWAL_IN_PROGRESS" ? value.existingJobId : value.jobId
  check(jobId(nextJob))
  await args.store.saveRecovery(id, { ...state, jobId: nextJob })
}
