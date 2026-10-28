import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { decodeFunctionData, keccak256 } from 'viem'

const require = createRequire(import.meta.url), path = new URL('../src/relay-reward-policy-v4.ts', import.meta.url), api = {}
if (existsSync(path)) new Function('exports', 'require', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(api, require)
const address = '0x1111111111111111111111111111111111111111', owner = '0x2222222222222222222222222222222222222222'
const blockHash = '0x' + '33'.repeat(32), code = '0x60016000', codeHash = keccak256(code)
const target = { chainId: 42431, address, codeHash }
const policy = { singleSourceMaximum: 5000n, batchSourceMaximum: 10000n, childMaximum: 20000n, childQuote: 15000n }
function fixture(overrides = {}) {
  const calls = [], values = { ...policy, revision: 7n, owner, MAX_SINGLE_SOURCE_REWARD: 5000n, MAX_BATCH_SOURCE_REWARD: 10000n, MAX_CROSS_CHAIN_CHILD_REWARD: 20000n }
  return { calls, client: {
    getChainId: async () => 42431,
    getBlock: async () => ({ number: 123n, hash: blockHash }),
    getCode: async args => { calls.push(args); return code },
    readContract: async args => { calls.push(args); return values[args.functionName] },
    ...overrides
  } }
}

test('policy reader is canonical, block-pinned and code-hash pinned', async () => {
  assert.equal(typeof api.readRelayRewardPolicyV4, 'function', 'missing canonical policy reader')
  const { client, calls } = fixture(), result = await api.readRelayRewardPolicyV4(client, target)
  assert.deepEqual(result, { ...target, ...policy, owner, revision: 7n, blockNumber: 123n, blockHash })
  assert.equal(calls.length, 10)
  assert.ok(calls.every(call => call.address === address && call.blockNumber === 123n))
})

test('policy rejects wrong chain, missing or changed code, reorg and tampered immutable getters', async () => {
  assert.equal(typeof api.readRelayRewardPolicyV4, 'function', 'missing canonical policy reader')
  for (const overrides of [
    { getChainId: async () => 1 },
    { getCode: async () => '0x' },
    { getCode: async () => '0x6000' },
    { getBlock: async args => ({ number: 123n, hash: args.blockNumber ? '0x' + '44'.repeat(32) : blockHash }) },
    { readContract: async args => args.functionName === 'MAX_SINGLE_SOURCE_REWARD' ? 5001n : fixture().client.readContract(args) },
    { readContract: async args => args.functionName === 'childQuote' ? 20001n : fixture().client.readContract(args) },
    { readContract: async args => args.functionName === 'childMaximum' ? 14000n : fixture().client.readContract(args) }
  ]) await assert.rejects(api.readRelayRewardPolicyV4(fixture(overrides).client, target))
})

test('policy target is explicit and does not fall back to legacy or signed profile values', () => {
  assert.equal(typeof api.relayRewardPolicyTargetV4, 'function', 'missing explicit target parser')
  const env = { RELAY_REWARD_POLICY_V4_ADDRESS: address, RELAY_REWARD_POLICY_V4_CODE_HASH: codeHash }
  assert.deepEqual(api.relayRewardPolicyTargetV4(env, 42431), target)
  assert.throws(() => api.relayRewardPolicyTargetV4(env, 42431, 'NEXT_PUBLIC_'))
  assert.throws(() => api.relayRewardPolicyTargetV4({ ...env, RELAY_REWARD_POLICY_V4_ADDRESS: '0x' + '0'.repeat(40) }, 42431))
  assert.throws(() => api.relayRewardPolicyTargetV4({ ...env, RELAY_REWARD_POLICY_V4_CODE_HASH: '0x' + '0'.repeat(64) }, 42431))
})

test('admin calldata atomically closes, lowers or restores ceilings but cannot exceed immutable bounds', () => {
  assert.equal(typeof api.encodeRelayRewardPolicyUpdateV4, 'function', 'missing bounded atomic policy update')
  for (const p of [policy, { singleSourceMaximum: 0n, batchSourceMaximum: 0n, childMaximum: 0n, childQuote: 0n }, { ...policy, singleSourceMaximum: 1n, batchSourceMaximum: 2n, childMaximum: 3n, childQuote: 2n }]) {
    const decoded = decodeFunctionData({ abi: api.relayRewardPolicyV4Abi, data: api.encodeRelayRewardPolicyUpdateV4(p) })
    assert.equal(decoded.functionName, 'setLimits')
    assert.deepEqual(decoded.args, [p.singleSourceMaximum, p.batchSourceMaximum, p.childMaximum, p.childQuote])
  }
  for (const key of Object.keys(policy)) for (const value of [-1n, 20001n]) assert.throws(() => api.encodeRelayRewardPolicyUpdateV4({ ...policy, [key]: value }))
  assert.throws(() => api.encodeRelayRewardPolicyUpdateV4({ ...policy, childMaximum: 14999n }))
})
