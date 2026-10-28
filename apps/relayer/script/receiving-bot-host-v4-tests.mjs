import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

test('the actual bot mounts the concrete V4 host, not a callback-only stub', async () => {
  const file = new URL('../dist/apps/relayer/src/phase3/receiving-bot-host-v4.js', import.meta.url)
  assert.ok(existsSync(file), 'concrete V4 bot host is missing')
  const { createReceivingBotHostV4 } = await import(file.href)
  assert.equal(await createReceivingBotHostV4({ env: {} }), undefined)
  await assert.rejects(() => createReceivingBotHostV4({ env: { PHASE3_RECEIVING_V4_PROFILE_JSON: '{}' } }), /V4|receiving/)
  const source = readFileSync(new URL('../src/bot.ts', import.meta.url), 'utf8')
  assert.match(source, /await createReceivingBotHostV4\(/)
  assert.match(source, /receivingV4:\s*receivingHost/)
  const hostSource=readFileSync(new URL('../src/phase3/receiving-bot-host-v4.ts',import.meta.url),'utf8')
  assert.match(hostSource,/env\.PHASE3_MIN_CONFIRMATIONS \|\| "0"/,'the host must use the observation worker confirmation policy without a weaker fallback')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.scripts['test:phase3'].includes('receiving-bot-host-v4-tests.mjs'))
})
