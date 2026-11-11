#!/usr/bin/env node
/**
 * RX-02A style-drift + no-new-glass gate (S1-1, R2-hardened).
 *
 * Ratchet, not Big-Bang — now PER-PATH and PER-OCCURRENCE. The R2 review found
 * the original file-count gate was bypassable: adding another violation to an
 * already-flagged file passed, and an increase in one file could be masked by
 * a decrease elsewhere. This gate therefore records, for every tracked
 * pattern, an explicit map of { relativePath: occurrenceCount } captured at
 * the Day-0 baseline, and fails on ANY of:
 *   - a file whose occurrence count for a pattern INCREASED vs baseline,
 *   - a file matching a pattern that is NOT in the baseline map,
 *   - a brand-new file matching a pattern.
 * Decreases are allowed (ratchet direction) and shrink the reported baseline.
 *
 * Governance preserved from S1-1:
 *   - no blanket removal of legacy utilities while callers remain,
 *   - no NEW callers of legacy glass utilities (glass-card / glass-dark) until
 *     the owning component/screen is migrated with before/after evidence (S1-3).
 *
 * Exits 0 when clean, 1 with a diagnostic report otherwise.
 * `--write-baseline` regenerates the baseline from the current tree
 * (Moderator-gated operation; never run silently in CI).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Env overrides exist so the gate's negative paths can be exercised against
// synthetic fixtures without touching the real tree (see scripts/tests/tokens.test.mjs).
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

function countMatches(content, re) {
  const m = content.match(re)
  return m ? m.length : 0
}

function scanPattern(p) {
  const flags = p.flags ?? ''
  // global flag so we count occurrences, not just presence
  const re = new RegExp(p.regex, flags.includes('g') ? flags : flags + 'g')
  const skip = new Set(p.excludeFiles ?? [])
  const counts = {}
  for (const f of files) {
    const r = rel(f)
    if (skip.has(r)) continue
    const n = countMatches(readFileSync(f, 'utf8'), re)
    if (n > 0) counts[r] = n
  }
  return counts
}

if (process.argv.includes('--write-baseline')) {
  const out = { ...baseline, recordedAt: new Date().toISOString().slice(0, 10), patterns: {} }
  for (const [name, p] of Object.entries(baseline.patterns)) {
    out.patterns[name] = { ...p, baseline: scanPattern(p) }
    delete out.patterns[name].baselineFiles
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log('[style-gate] baseline rewritten with per-path occurrence counts:', BASELINE_PATH)
  process.exit(0)
}

let failures = 0
const report = []
console.log('[style-gate] scanning', files.length, 'files under', baseline.scope)

for (const [name, p] of Object.entries(baseline.patterns)) {
  const current = scanPattern(p)
  const base = p.baseline ?? {}
  const violations = []
  for (const [file, n] of Object.entries(current)) {
    const baseCount = base[file] ?? 0
    if (n > baseCount) violations.push({ file, n, baseCount })
  }
  const curTotal = Object.values(current).reduce((a, b) => a + b, 0)
  const baseTotal = Object.values(base).reduce((a, b) => a + b, 0)
  const curFiles = Object.keys(current).length
  const baseFiles = Object.keys(base).length
  const status = violations.length > 0 ? 'FAIL' : curTotal < baseTotal ? 'ok (ratchet ↓)' : 'ok'
  report.push(`  ${status.padEnd(14)} ${name}: ${curFiles} files / ${curTotal} occurrences (baseline ${baseFiles} files / ${baseTotal} occurrences)`)
  if (violations.length > 0) {
    failures++
    console.log(`\n[style-gate] VIOLATIONS for "${name}":`)
    for (const v of violations) {
      console.log(`   + ${v.file}: ${v.n} occurrences (baseline ${v.baseCount})`)
    }
  }
}

console.log('\n[style-gate] baseline report:')
for (const line of report) console.log(line)

if (failures > 0) {
  console.error(`\n[style-gate] FAILED — ${failures} pattern(s) gained occurrences above the per-path Day-0 baseline.`)
  console.error('[style-gate] Increases inside already-flagged files are violations and cannot be masked')
  console.error('[style-gate] by unrelated decreases. Fix: migrate the owning component/screen to semantic')
  console.error('[style-gate] carup tokens (ratchet the count down), or record an explicit Moderator-approved')
  console.error('[style-gate] baseline amendment via --write-baseline.')
  process.exit(1)
}
console.log('\n[style-gate] PASS — no per-path occurrence increase over the Day-0 baseline.')
