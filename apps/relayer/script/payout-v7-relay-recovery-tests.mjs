import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
const req = createRequire(import.meta.url), viem = req('viem'), mod = { exports: {} }
const source = readFileSync(new URL('../src/phase3/payout-v7-relay-recovery.ts', import.meta.url), 'utf8')
vm.runInNewContext('(function(require,module,exports){' + ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\n})', { URL, AbortSignal, fetch })(req, mod, mod.exports)
const { recoverPayoutV7RelayDeposit, relayRecoveryExecuteAbi } = mod.exports
const address = n => '0x' + n.toString(16).padStart(40, '0'), hash = n => '0x' + n.toString(16).padStart(64, '0')

function fixture() {
  let checkpoint = null, request = null
  const escrow = address(1), token = address(2), depository = address(3), target = address(4), submissionTxHash = hash(5), requestId = hash(6), depositId = hash(7)
  const child = { intentHash: hash(8), providerData: viem.encodeAbiParameters([{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes' }], [1, target, 9999999999n,
    viem.encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }], [depository, depositId, viem.keccak256(viem.toHex(requestId)), escrow])]),
    intent: { escrow, token, requestIdHash: viem.keccak256(viem.toHex(requestId)), providerSourceAmount: 1000000n, chainId: 4217n } }
  const calls = [], broadcasts = [], checked = []
  const origin = { chainId: 4217, currency: token, depositor: escrow, depository, amount: '1000000', transactionId: submissionTxHash }
  let status = { status: 'processing' }, withdrawal = { status: 'processing', jobId: 'synthetic-job' }, extra = {}
  const payload = { requests: [{ id: requestId, status: 'failure', protocol: { orderId: depositId, hubType: 'onchain', isWithdrawable: true, deposit: { origin } } }] }
  const args = { child, submissionTxHash, transactionTarget: target, now: () => 1000, apiKey: undefined,
    store: { readRecovery: async () => checkpoint, saveRecovery: async (_id, value) => { checkpoint = structuredClone(value) }, removeRecovery: async () => { checkpoint = null } },
    verifyDeposit: async value => { checked.push(value) },
    broadcast: async value => { broadcasts.push(value); return hash(10) },
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname; calls.push(path)
      if (path === '/requests/v3') return Response.json(payload)
      if (path === '/withdrawals/attest-deposit') return Response.json({ success: true })
      if (path === '/withdrawals/status') return Response.json(status)
      if (path === '/withdrawals/request') {
        const body = JSON.parse(init.body)
        if (!body.signature) return Response.json({ nonce: hash(9), amount: '950000', ...extra })
        request = body; return Response.json(withdrawal)
      }
      throw Error('unexpected endpoint')
    }
  }
  const ready = (recipient = escrow, currency = token, amount = 950000n, to = depository) => ({ status: 'ready', transaction: { chainId: 4217, to, value: '0', data: viem.encodeFunctionData({ abi: relayRecoveryExecuteAbi, functionName: 'execute', args: [{ calls: [{ to: currency, data: viem.encodeFunctionData({ abi: viem.parseAbi(['function transfer(address,uint256) returns(bool)']), functionName: 'transfer', args: [recipient, amount] }), value: 0n, allowFailure: false }], nonce: 3n, expiration: 1200n }, '0x1234'] }) } })
  return { args, payload, origin, calls, broadcasts, checked, ready, escrow, token, depository,
    get checkpoint() { return checkpoint }, get request() { return request }, set status(v) { status = v }, set withdrawal(v) { withdrawal = v }, set extra(v) { extra = v } }
}

test('isolated recovery retains preparation and resumes a ready job without signing or preparing again', async () => {
  const f = fixture()
  await recoverPayoutV7RelayDeposit(f.args)
  assert.equal(f.checked.length, 1)
  assert.equal(f.checkpoint.jobId, 'synthetic-job')
  assert.equal(f.request.owner, f.escrow); assert.equal(f.request.recipient, f.escrow)
  assert.equal(f.request.amount, '950000'); assert.equal(f.request.chainId, 'tempo')
  assert.equal(f.request.operation, undefined, 'operation belongs in the signed digest, not the API body')
  assert.equal(f.broadcasts.length, 0)
  f.status = f.ready()
  f.calls.length = 0
  await recoverPayoutV7RelayDeposit(f.args)
  assert.deepEqual(f.calls, ['/withdrawals/status'])
  assert.equal(f.broadcasts[0].to, f.depository)
  assert.equal(f.broadcasts[0].key, 'synthetic-job')
})

test('unknown, unwithdrawable and wrong-order deposits never request recovery', async () => {
  for (const change of [f => f.payload.requests.length = 0, f => f.payload.requests[0].protocol.isWithdrawable = false]) {
    const f = fixture(); change(f); await recoverPayoutV7RelayDeposit(f.args)
    assert.equal(f.calls.length, 1); assert.equal(f.checkpoint, null)
  }
  for (const change of [f => f.origin.depositor = address(99), f => f.origin.currency = address(99), f => f.origin.chainId = 8453, f => f.origin.transactionId = hash(99), f => f.origin.amount = '2', f => f.origin.depository = address(99), f => f.payload.requests[0].protocol.orderId = hash(99), f => f.payload.requests[0].status = 'success']) {
    const f = fixture(); change(f); await assert.rejects(() => recoverPayoutV7RelayDeposit(f.args)); assert.equal(f.calls.length, 1); assert.equal(f.checkpoint, null)
  }
})

test('unverified source, arbitrary additionalData and unsafe ready calls cannot broadcast', async () => {
  const unverified = fixture(); unverified.args.verifyDeposit = async () => { throw Error('not finalized') }
  await assert.rejects(() => recoverPayoutV7RelayDeposit(unverified.args), /not finalized/); assert.deepEqual(unverified.calls, ['/requests/v3'])
  const extra = fixture(); extra.extra = { additionalData: { arbitrary: true } }
  await assert.rejects(() => recoverPayoutV7RelayDeposit(extra.args)); assert.equal(extra.checkpoint, null)
  for (const alter of [f => f.ready(address(99)), f => f.ready(f.escrow, address(99)), f => f.ready(f.escrow, f.token, 1000001n), f => f.ready(f.escrow, f.token, 950000n, address(99)), f => ({ ...f.ready(), transaction: { ...f.ready().transaction, chainId: 8453 } })]) {
    const f = fixture(); await recoverPayoutV7RelayDeposit(f.args); f.status = alter(f)
    await assert.rejects(() => recoverPayoutV7RelayDeposit(f.args)); assert.equal(f.broadcasts.length, 0)
  }
})

test('lost execute response resumes retained preparation; 409 reuses the existing job, and expiry can re-prepare', async () => {
  const f = fixture(), fetch = f.args.fetchImpl
  let lost = true
  f.args.fetchImpl = async (url, init) => {
    if (new URL(url).pathname === '/withdrawals/request' && JSON.parse(init.body).signature && lost) { lost = false; throw Error('lost response') }
    if (new URL(url).pathname === '/withdrawals/request' && JSON.parse(init.body).signature) return Response.json({ code: 'WITHDRAWAL_IN_PROGRESS', existingJobId: 'existing-job' }, { status: 409 })
    return fetch(url, init)
  }
  await assert.rejects(() => recoverPayoutV7RelayDeposit(f.args), /lost response/)
  assert.ok(f.checkpoint.prepared); assert.equal(f.checkpoint.jobId, undefined)
  f.calls.length = 0; await recoverPayoutV7RelayDeposit(f.args)
  assert.equal(f.checkpoint.jobId, 'existing-job'); assert.equal(f.calls.length, 0)
  f.status = { status: 'expired' }; await recoverPayoutV7RelayDeposit(f.args); assert.equal(f.checkpoint, null)
})
