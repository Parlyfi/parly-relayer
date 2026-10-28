import type { Address, Hex } from "viem"

export type PayoutV7SignedCall = { id: string; to: Address; data: Hex; serializedTransaction: Hex; transactionHash: Hex }
export type PayoutV7CallStore = {
  read(id: string): Promise<PayoutV7SignedCall | null>
  retain(row: PayoutV7SignedCall): Promise<boolean>
}
export async function runPayoutV7Transaction(args: {
  id: string; to: Address; data: Hex; store: PayoutV7CallStore
  prepare(): Promise<Pick<PayoutV7SignedCall, "serializedTransaction" | "transactionHash">>
  broadcast(serializedTransaction: Hex): Promise<Hex>
  outcome(transactionHash: Hex): Promise<"pending" | "success" | "failed">
}) {
  let retained = await args.store.read(args.id)
  if (!retained) {
    const signed = await args.prepare()
    const row = { id: args.id, to: args.to, data: args.data, ...signed }
    // Retention is the one-shot broadcast claim, including a crash before the RPC call.
    if (await args.store.retain(row)) {
      const hash = await args.broadcast(row.serializedTransaction)
      if (hash !== row.transactionHash) throw Error("V7 submitted transaction hash mismatch.")
      retained = row
    } else retained = await args.store.read(args.id)
  }
  if (!retained || retained.to.toLowerCase() !== args.to.toLowerCase() || retained.data !== args.data) throw Error("V7 retained signed call changed.")
  const outcome = await args.outcome(retained.transactionHash)
  if (outcome !== "success") throw Error(`V7 retained transaction ${outcome}; rebroadcast is forbidden.`)
  return retained.transactionHash
}

export async function runPayoutV7Execution<T>(args: {
  children: T[]
  readState(child: T): Promise<{ status: number; escrowFundedAt: bigint }>
  preflight(): Promise<void>
  accept(child: T): Promise<unknown>; source(): Promise<Hex>; sourceHash(): Promise<Hex | null>
  registration(child: T): Promise<unknown>
  provenance(child: T, hash: Hex): Promise<unknown>; confirm(child: T, provenance: unknown): Promise<unknown>
  submit(child: T): Promise<Hex>; submissionHash(child: T): Promise<Hex | null>
  downstream(child: T, submissionHash: Hex): Promise<unknown>
}) {
  let states = await Promise.all(args.children.map(args.readState))
  if (states.some(s => s.escrowFundedAt > 0n) && states.some(s => s.escrowFundedAt === 0n)) throw Error("V7 atomic source funding has a mixed state.")
  if (states.every(s => s.escrowFundedAt === 0n) && states.some(s => s.status < 3)) await args.preflight()
  for (const [index, child] of args.children.entries()) if (states[index]!.status === 0) await args.accept(child)
  states = await Promise.all(args.children.map(args.readState))
  if (states.some(s => s.status < 1 || s.status > 6)) throw Error("V7 quote acceptance is not finalized.")
  const funded = states.map(s => s.escrowFundedAt > 0n)
  if (funded.some(Boolean) && !funded.every(Boolean)) throw Error("V7 atomic source funding has a mixed state.")
  let sourceHash = await args.sourceHash()
  if (!funded.some(Boolean) && states.some(s => s.status < 3)) sourceHash = await args.source()
  if (!sourceHash && states.some(s => s.status < 3)) throw Error("V7 funded source lacks a retained transaction.")
  for (const child of args.children) {
    let state = await args.readState(child)
    if (state.status === 1 || state.status === 2) {
      if (!state.escrowFundedAt) throw Error("V7 registration reimbursement requires finalized source funding.")
      await args.registration(child)
    }
    if (state.status === 1) {
      if (!state.escrowFundedAt || !sourceHash) throw Error("V7 atomic source funding is not finalized.")
      await args.confirm(child, await args.provenance(child, sourceHash))
      state = await args.readState(child)
    }
    let submissionHash = await args.submissionHash(child)
    if (state.status === 2) { submissionHash = await args.submit(child); state = await args.readState(child) }
    if (state.status === 3) {
      if (!submissionHash) throw Error("V7 submitted child lacks a retained transaction.")
      await args.downstream(child, submissionHash)
    }
  }
}
