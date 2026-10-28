import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

const source = await readFile(new URL("../src/phase3/relay-reward.ts", import.meta.url), "utf8")
const api = {}
new Function("exports", ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(api)

test("Tempo attodollar gas cost becomes a rounded-up six-decimal reward plus ten percent", () => {
  assert.equal(api.costCoveringRelayReward(3832139n, 600000000n), 2530n)
  assert.equal(api.costCoveringRelayReward(1n, 1n), 1n)
  assert.throws(() => api.costCoveringRelayReward(0n, 1n))
  assert.throws(() => api.costCoveringRelayReward(1n, -1n))
})

test("a reward is not truncated to its absolute limit and underpaid broadcasts are rejected", () => {
  assert.doesNotThrow(() => api.requireCostCoveredRelayReward(2530n, 3832139n, 600000000n))
  assert.throws(() => api.requireCostCoveredRelayReward(500n, 3832139n, 600000000n), /cannot cover/)
})

const bot = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8")
const start = bot.indexOf("const pricedTemplates = templates.map")
const end = bot.indexOf("feeSchedules = await buildSignedRelayExecutionFeeSchedulesV2", start)
const price = new Function("templates", "gasBudget", "gasPrice", "poolV3Runtime", "costCoveringRelayReward", ts.transpileModule(bot.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText + ";return pricedTemplates")
const template = { executionMode: 0, executorFee: "500", maximumGasPrice: "1000000000" }
const runtime = { config: { maximumExecutorFeeByMode: new Map([[0, 3000n]]) } }

test("publication signs the gas-priced reward without increasing configured ceilings", () => {
  assert.deepEqual(price([template], "3832139", 600000000n, runtime, api.costCoveringRelayReward), [{ ...template, executorFee: "2530", maximumGasPrice: "600000000" }])
  assert.throws(() => price([template], "3832139", 800000000n, runtime, api.costCoveringRelayReward), /absolute ceiling/)
  assert.throws(() => price([template], "3832139", 1100000000n, runtime, api.costCoveringRelayReward), /gas price/)
  assert.deepEqual(price([template], undefined, null, runtime, api.costCoveringRelayReward), [template])
})

test("both direct and V6 withdrawals estimate real calldata before cost-guarded broadcast", () => {
  for (const [startText, endText] of [["async function processPoolV3Bundle", "async function runPayoutV4DownstreamForBinding"], ["executeWithdrawal: async ({ claimed: execution", "requestProvenance: ({ intentHash, withdrawalTxHash"]]) {
    const body = bot.slice(bot.indexOf(startText), bot.indexOf(endText, bot.indexOf(startText)))
    assert.match(body, /publicClient\.estimateGas\(\{ account, to: prepared.to, data: prepared.data \}\)/)
    assert.ok(body.indexOf("requireCostCoveredRelayReward(") < body.indexOf("broadcastPreparedTransaction("))
  }
})

const v4Source = await readFile(new URL('../src/phase3/relay-reward-v4.ts', import.meta.url), 'utf8'), v4 = {}
new Function('exports', 'require', ts.transpileModule(v4Source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(v4, name => { assert.equal(name, './relay-reward.js'); return api })
const policyV4 = { singleSourceMaximum: 5000n, batchSourceMaximum: 10000n, childMaximum: 20000n, childQuote: 15000n }

test('V4 publication prices single and batch independently without hiding affordable single Sends', async () => {
  const start = bot.indexOf('const gasUnits = process.env.PHASE3_POOL_V4_REWARD_GAS_UNITS')
  const end = bot.indexOf('feeSchedules.push(...await buildSignedRelayExecutionFeeSchedulesV2', start)
  assert.ok(start > 0 && end > start)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const publish = new AsyncFunction('process', 'v4', 'policy', 'publicClient', 'costCoveringRelayReward', ts.transpileModule(bot.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText + ';return templates')
  const env = { PHASE3_POOL_V4_REWARD_GAS_UNITS: '6000000', PHASE3_POOL_V4_BATCH_REWARD_GAS_UNITS: '12000000' }
  const run = (settings = env, policy = policyV4) => publish({ env: settings }, { config: { profile: { assets: [{ pool: '0x' + '11'.repeat(20) }] } } }, policy, { getGasPrice: async () => 600000000n }, api.costCoveringRelayReward)
  const templates = await run()
  assert.equal(templates.length, 43)
  assert.ok(templates.filter(t => t.outputCount === 1).every(t => t.executorFee === '3960'))
  assert.ok(templates.filter(t => t.outputCount !== 1).every(t => t.executorFee === '7920'))
  const lower = await run(env, { ...policyV4, batchSourceMaximum: 7000n })
  assert.equal(lower.length, 4)
  assert.ok(lower.every(t => t.outputCount === 1))
  await assert.rejects(() => run({ ...env, PHASE3_POOL_V4_BATCH_REWARD_GAS_UNITS: undefined }), /budget unavailable/)
  await assert.rejects(() => run({ ...env, PHASE3_POOL_V4_BATCH_REWARD_GAS_UNITS: '-1' }), /budget unavailable/)
})

test('V4 reward policy preserves absolute micro-token ceilings and rejects costs above reduced admin limits', () => {
  assert.equal(v4.quoteSourceRewardV4(3832139n, 600000000n, 1, policyV4), 2530n)
  assert.throws(() => v4.quoteSourceRewardV4(3832139n, 600000000n, 1, { ...policyV4, singleSourceMaximum: 2529n }), /configured ceiling/)
  for (const [field, value] of [['singleSourceMaximum', 5001n], ['batchSourceMaximum', 10001n], ['childMaximum', 20001n], ['childQuote', 20001n]]) {
    assert.throws(() => v4.quoteSourceRewardV4(3832139n, 600000000n, 1, { ...policyV4, [field]: value }), /immutable maximum/)
  }
  assert.throws(() => v4.quoteSourceRewardV4(3832139n, 600000000n, 1, { ...policyV4, singleSourceMaximum: 0n }))
  assert.equal(v4.quoteSourceRewardV4(3832139n, 600000000n, 1, { ...policyV4, batchSourceMaximum: 0n }), 2530n)
})

test('V4 batch allocates the source reward once while charging downstream work per recipient', () => {
  const gas = { acceptance: 1000000n, confirmation: 1000000n, submission: 1000000n, completion: 1000000n }
  for (const count of [1, 2, 10]) {
    const result = v4.quoteCrossChainRewardsV4(3832139n, 600000000n, Array(count).fill(gas), policyV4)
    assert.equal(result.children.reduce((sum, child) => sum + child.sourceExecutorFeeAllocation, 0n), result.sourceReward)
    for (const child of result.children) {
      assert.equal(child.totalReward, policyV4.childQuote)
      assert.equal(child.sourceExecutorFeeAllocation + child.submissionReimbursement + child.deliverySuccessFee, child.totalReward)
      assert.ok(child.deliverySuccessFee >= api.costCoveringRelayReward(gas.completion, 600000000n))
    }
  }
  assert.throws(() => v4.quoteCrossChainRewardsV4(3832139n, 600000000n, [gas], { ...policyV4, childQuote: 5000n }), /cannot cover/)
  assert.throws(() => v4.quoteCrossChainRewardsV4(3832139n, 600000000n, Array(11).fill(gas), policyV4), /recipient count/)
})
