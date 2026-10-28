import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/phase3/payout-v7-worker.ts', import.meta.url), 'utf8')
const module = { exports: {} }
vm.runInNewContext('(function(require,module,exports){' + ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\n})', { console })(require, module, module.exports)
const { runPayoutV7Transaction, runPayoutV7Execution } = module.exports
const hex = n => '0x' + n.toString(16).padStart(64, '0')

test('signed call is retained before broadcast and an unknown response never rebroadcasts after restart', async () => {
  const rows = new Map(), events = []
  const args = { id: 'source', to: '0x' + '1'.repeat(40), data: '0x1234', store: {
    read: async id => rows.get(id) ?? null,
    retain: async row => { if (rows.has(row.id)) return false; rows.set(row.id, row); events.push('retain'); return true }
  }, prepare: async () => ({ serializedTransaction: '0xabcd', transactionHash: hex(1) }),
  broadcast: async () => { events.push('broadcast'); throw Error('lost response') },
  outcome: async () => 'pending' }
  await assert.rejects(() => runPayoutV7Transaction(args), /lost response/)
  await assert.rejects(() => runPayoutV7Transaction(args), /retained|pending/)
  assert.deepEqual(events, ['retain', 'broadcast'])
  args.outcome = async () => 'success'
  assert.equal(await runPayoutV7Transaction(args), hex(1))
  assert.deepEqual(events, ['retain', 'broadcast'])
})

test('source dispatch accepts each ordered child and confirms each before submitting; funded work does not need a fresh lease', async () => {
  const children = [1, 2].map(n => ({ intentHash: hex(n) })), statuses = [0, 0], events = []
  let funded = 0n
  const args = { children, readState: async child => ({ status: statuses[children.indexOf(child)], escrowFundedAt: funded }),
    preflight: async () => { assert.equal(funded, 0n) },
    accept: async child => { const i = children.indexOf(child); statuses[i] = 1; events.push('accept' + i) },
    source: async () => { assert.deepEqual(statuses, [1, 1]); funded = 1n; events.push('source'); return hex(3) },
    sourceHash: async () => hex(3),
    registration: async child => { assert.ok(funded > 0n); events.push('registration' + children.indexOf(child)) },
    provenance: async child => { events.push('provenance' + children.indexOf(child)); return {} },
    confirm: async child => { const i = children.indexOf(child); statuses[i] = 2; events.push('confirm' + i) },
    submit: async child => { const i = children.indexOf(child); statuses[i] = 3; events.push('submit' + i); return hex(i + 4) },
    submissionHash: async child => hex(children.indexOf(child) + 4), downstream: async child => events.push('downstream' + children.indexOf(child)) }
  await runPayoutV7Execution(args)
  assert.deepEqual(events, ['accept0', 'accept1', 'source', 'registration0', 'provenance0', 'confirm0', 'submit0', 'downstream0', 'registration1', 'provenance1', 'confirm1', 'submit1', 'downstream1'])
  events.length = 0
  args.source = async () => { throw Error('must not reacquire expired source lease') }
  await runPayoutV7Execution(args)
  assert.deepEqual(events, ['downstream0', 'downstream1'])
})

test('mixed atomic funding is rejected without source or downstream work', async () => {
  let writes = 0
  await assert.rejects(() => runPayoutV7Execution({ children: [0, 1], readState: async c => ({ status: 1, escrowFundedAt: BigInt(c) }), accept: async () => writes++, source: async () => writes++ }), /mixed/)
  assert.equal(writes, 0)
})

test('invalid genuine-proof preflight cannot spend acceptance gas and funded restart never resimulates spent inputs', async () => {
  let paid = 0, preflights = 0
  const args = { children: [0], readState: async () => ({ status: 0, escrowFundedAt: 0n }), preflight: async () => { preflights++; throw Error('invalid proof') }, accept: async () => paid++ }
  await assert.rejects(() => runPayoutV7Execution(args), /invalid proof/)
  assert.equal(paid, 0); assert.equal(preflights, 1)
  args.preflight = async () => { preflights++; throw Error('overlapping input reservation') }
  await assert.rejects(() => runPayoutV7Execution(args), /overlapping/)
  assert.equal(paid, 0); assert.equal(preflights, 2)
  args.readState = async () => ({ status: 4, escrowFundedAt: 100n })
  args.sourceHash = async () => null; args.submissionHash = async () => null
  await runPayoutV7Execution(args)
  assert.equal(preflights, 2); assert.equal(paid, 0)
})

test('real local SQL retains the signed raw call across store restart and concurrent claim cannot replace it', async t => {
  const fixture = new URL('../../indexer/node_modules/ponder/package.json', import.meta.url)
  if (!existsSync(fixture)) { t.skip('Canonical-only indexer SQL fixture is not part of the standalone relayer.'); return }
  const { PGlite } = createRequire(realpathSync(fixture))('@electric-sql/pglite')
  const db = new PGlite(), viem = require('viem')
  try {
    const src = readFileSync(new URL('../src/phase3/payout-v7-worker-store.ts', import.meta.url), 'utf8'), mod = { exports: {} }
    const dep = name => name === '../pending-store.js' ? {} : require(name)
    vm.runInNewContext('(function(require,module,exports){' + ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\n})')(dep, mod, mod.exports)
    const store = mod.exports.createPayoutV7WorkerStore(db), row = { id: 'manifest:source', to: '0x' + '1'.repeat(40), data: '0xabcd', serializedTransaction: '0x1234', transactionHash: viem.keccak256('0x1234') }
    assert.equal(await store.retain(row), true)
    const restarted = mod.exports.createPayoutV7WorkerStore(db)
    assert.equal(await restarted.retain({ ...row, serializedTransaction: '0x5678', transactionHash: viem.keccak256('0x5678') }), false)
    assert.equal((await restarted.read(row.id)).serializedTransaction, row.serializedTransaction)
    const checkpoint = { prepared: { amount: '1', nonce: hex(1) }, preparedAt: 1000 }
    await store.saveRecovery('child', checkpoint)
    assert.deepEqual(await restarted.readRecovery('child'), checkpoint)
    await store.saveRecovery('child', { ...checkpoint, jobId: 'retained-job' })
    await restarted.saveRecovery('child', checkpoint)
    assert.equal((await store.readRecovery('child')).jobId, 'retained-job')
    await store.removeRecovery('child')
    assert.equal(await restarted.readRecovery('child'), null)
    await db.query("UPDATE relay_v7_signed_calls SET signed_transaction='0x5678' WHERE id=$1", [row.id])
    await assert.rejects(() => restarted.read(row.id), /corrupt/)
  } finally { await db.close() }
})

test('stage budgets count registration once, outside the pool reward, and reject underpayment before signing', async () => {
  const runtime = readFileSync(new URL('../src/phase3/payout-v7-runtime.ts', import.meta.url), 'utf8')
  const start = runtime.indexOf('if (step === "source") {'), end = runtime.indexOf('const serializedTransaction =', start)
  assert.ok(start > 0 && end > start)
  const rewardModule = { exports: {} }, rewardSource = readFileSync(new URL('../src/phase3/relay-reward.ts', import.meta.url), 'utf8')
  vm.runInNewContext('(function(module,exports){' + ts.transpileModule(rewardSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\n})')(rewardModule, rewardModule.exports)
  const address='0x'+'1'.repeat(40),child={intentHash:hex(1),intent:{registrationOperator:address,registrationReimbursement:3000n,submissionReimbursement:3000n,deliverySuccessFee:1200n}},reads=[]
  const context = {
    step: 'source', prepared: { gas: 100000n, gasPrice: 10000000000n }, m: { sourceExecutorFeeBaseUnits: '2000', children: [child] },
    c:{registrationSettlementGasUnits:'100000'},account:{address},getAddress:x=>x,
    id: x => x, store: { read: async key => {reads.push(key);return { transactionHash: hex(2) }} }, outcome: async () => 'success',
    client: { getTransactionReceipt: async () => ({ gasUsed: 100000n, effectiveGasPrice: 10000000000n }) },
    check: x => { assert.ok(x) }, requireCostCoveredRelayReward: rewardModule.exports.requireCostCoveredRelayReward
  }
  const js=ts.transpileModule('const guard=async()=>{'+runtime.slice(start,end)+'};guard',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const guard=vm.runInNewContext(js,context)
  await guard();assert.deepEqual(reads,[],'source never charges registration receipts a second time')
  context.m.sourceExecutorFeeBaseUnits='1099';await assert.rejects(guard,/cannot cover/)
  for(const stage of ['accept','registration','confirm','submit','complete']){
    context.step=stage+':'+child.intentHash;reads.length=0
    await guard()
    assert.deepEqual(reads,stage==='registration'?['accept:'+child.intentHash]:stage==='submit'?['confirm:'+child.intentHash]:[])
    const field=stage==='accept'||stage==='registration'?'registrationReimbursement':stage==='complete'?'deliverySuccessFee':'submissionReimbursement',saved=child.intent[field]
    child.intent[field]=1000n;await assert.rejects(guard,/cannot cover/);child.intent[field]=saved
  }
  context.step='accept:'+child.intentHash;child.intent.registrationOperator='0x'+'2'.repeat(40)
  await assert.rejects(guard)
})
