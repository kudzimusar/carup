#!/usr/bin/env node
/**
 * RX-02A style-drift + no-new-glass gate (S1-1).
 *
 * Ratchet, not Big-Bang: legacy patterns recorded in scripts/rx02a-style-baseline.json
 * may only stay flat or DECREASE. Any net-new file matching a tracked pattern fails
 * the gate. This enforces the Moderator's S1-1 correction:
 *   - no blanket removal of legacy utilities while callers remain,
 *   - no NEW callers of legacy glass utilities (glass-card / glass-dark) until the
 *     owning component/screen is migrated with before/after evidence (S1-3).
 *
 * Exits 0 when clean, 1 with a diagnostic report otherwise.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Env overrides exist so the gate's negative path can be exercised against a
// synthetic fixture without touching the real tree (see scripts/tests/tokens.test.mjs).
const SCOPE = process.env.RX02A_GATE_SCOPE ? path.resolve(process.env.RX02A_GATE_SCOPE) : path.join(ROOT, 'web', 'src')
const BASELINE_PATH = process.env.RX02A_GATE_BASELINE
  ? path.resolve(process.env.RX02A_GATE_BASELINE)
  : path.join(ROOT, 'scripts', 'rx02a-style-baseline.json')

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const EXCLUDE = new Set(baseline.exclude ?? [])

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const rel = (p) => path.relative(SCOPE, p).split(path.sep).join('/')
const files = [...walk(SCOPE)].filter((f) => {
  const r = rel(f)
  if (EXCLUDE.has(r)) return false
  return ['.ts', '.tsx', '.css'].includes(path.extname(f))
})

let failures = 0
const report = []
console.log('[style-gate] scanning', files.length, 'files under', baseline.scope)

for (const [name, p] of Object.entries(baseline.patterns)) {
  const flags = p.flags ?? ''
  const re = new RegExp(p.regex, flags)
  const skip = new Set(p.excludeFiles ?? [])
  const hitFiles = files.filter((f) => !skip.has(rel(f)) && re.test(readFileSync(f, 'utf8'))).map(rel)
  const count = hitFiles.length
  const delta = count - p.baselineFiles
  const status = delta > 0 ? 'FAIL' : delta < 0 ? 'ok (decreased)' : 'ok'
  report.push(`  ${status.padEnd(14)} ${name}: ${count} files (baseline ${p.baselineFiles}, delta ${delta >= 0 ? '+' : ''}${delta})`)
  if (delta > 0) {
    failures++
    // show only the net-new files (not explainable by a decrease elsewhere)
    console.log(`\n[style-gate] NET-NEW matches for "${name}":`)
    for (const f of hitFiles) console.log('   +', f)
  }
}

console.log('\n[style-gate] baseline report:')
for (const line of report) console.log(line)

if (failures > 0) {
  console.error(`\n[style-gate] FAILED — ${failures} pattern(s) increased above the Day-0 baseline.`)
  console.error('[style-gate] Fix: migrate the owning component/screen to semantic carup tokens')
  console.error('[style-gate] (lowering the baseline), or record an explicit Moderator-approved')
  console.error('[style-gate] baseline amendment in scripts/rx02a-style-baseline.json.')
  process.exit(1)
}
console.log('\n[style-gate] PASS — no net-new legacy style drift.')
