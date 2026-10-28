import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { privateKeyToAccount } from 'viem/accounts'
import { Transaction } from 'viem/tempo'
import { keccak256 } from 'viem'
const require = createRequire(import.meta.url), module = { exports: {} }
const source = readFileSync(new URL('../src/phase3/payout-v7-tempo.ts', import.meta.url), 'utf8')
vm.runInNewContext('(function(require,module,exports){' + ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\n})')(require, module, module.exports)
const { payoutV7NonceKey, assertPayoutV7NonceAvailable, validatePayoutV7SignedTempo } = module.exports
const signer = privateKeyToAccount('0x' + '15'.repeat(32)), address = n => '0x' + n.toString(16).padStart(40, '0')

test('V7 native lane is deterministic and isolated by chain/operator/manifest/step identity; gapped or pending lane cannot sign', async () => {
  const id = `4217:${address(1)}:${signer.address}:manifest:source`, lane = payoutV7NonceKey(id), tags = []
  assert.equal(payoutV7NonceKey(id), lane)
  assert.ok(lane > 0n && lane < 1n << 192n)
  assert.notEqual(lane, payoutV7NonceKey(id + ':other'))
  const client = { readContract: async call => { tags.push(call.blockTag); assert.equal(call.args[0], signer.address); assert.equal(call.args[1], lane); return 0n } }
  await assertPayoutV7NonceAvailable(client, signer.address, lane)
  assert.deepEqual(tags, ['latest', 'pending'])
  client.readContract = async () => 1n
  await assert.rejects(() => assertPayoutV7NonceAvailable(client, signer.address, lane))
})

test('V7 validates real signed 0x76 bytes, lane, exact call, fee token, domain and signer without sponsorship', async () => {
  const id = `4217:${address(1)}:${signer.address}:manifest:source`, lane = payoutV7NonceKey(id), feeToken = address(31), to = address(71), data = '0x1234'
  const tx = { type: 'tempo', chainId: 4217, nonceKey: lane, nonce: 0, feeToken, calls: [{ to, data, value: 0n }], gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 0n }
  const raw = await signer.signTransaction(tx, { serializer: Transaction.serialize }), row = { id, to, data, serializedTransaction: raw, transactionHash: keccak256(raw) }, context = { chainId: 4217, operator: signer.address, feeToken }
  await validatePayoutV7SignedTempo(row, context)
  for (const patch of [{ id: id + ':other' }, { to: address(72) }, { data: '0x5678' }, { transactionHash: '0x' + '1'.repeat(64) }]) await assert.rejects(() => validatePayoutV7SignedTempo({ ...row, ...patch }, context))
  for (const patch of [{ chainId: 42431 }, { operator: address(73) }, { feeToken: address(32) }]) await assert.rejects(() => validatePayoutV7SignedTempo(row, { ...context, ...patch }))
  const other = privateKeyToAccount('0x' + '16'.repeat(32)), wrong = await other.signTransaction(tx, { serializer: Transaction.serialize })
  await assert.rejects(() => validatePayoutV7SignedTempo({ ...row, serializedTransaction: wrong, transactionHash: keccak256(wrong) }, context))
})
