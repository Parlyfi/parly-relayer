import { existsSync } from 'node:fs'
if (!existsSync(new URL('../dist/apps/relayer/src/internal/receiving/receiving-preparation-v4.js', import.meta.url))) throw Error('Receiving runtime build is incomplete')
