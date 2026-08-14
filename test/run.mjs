/**
 * Test runner: executes every test/*.mjs suite as its own process (the
 * suites call process.exit, so importing them in-process would stop at the
 * first one). Exit code is non-zero if any suite fails.
 * Run: node test/run.mjs  (or: npm test)
 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const dir = dirname(fileURLToPath(import.meta.url))
const suites = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
  .sort()

let failed = 0
for (const f of suites) {
  console.log(`\n=== ${f} ===`)
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${suites.length} suites, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
