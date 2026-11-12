#!/usr/bin/env node
/**
 * CI-04 (S1-2) contrast-defect ratchet — R5 enforcement.
 *
 * Compares a contrast scan report (scripts/ci04-contrast-scan.mjs) against
 * `scripts/ci04-contrast-baseline.json`, the per-file inventory of
 * PRE-EXISTING low-contrast defects recorded at the Day-0 scan.
 *
 * Fails closed on ANY of:
 *   - a scan violation whose (route, width, target) is NOT in the baseline
 *     (zero allowance for new violations — R5),
 *   - a malformed baseline entry (missing route/width/target),
 *   - a missing or unreadable scan report.
 * Baseline entries absent from the scan are ratchet ↓ (fixed defects) and
 * shrink the effective baseline; they are reported, not failed.
 *
 * Env overrides (negative-path fixtures):
 *   RX02A_CONTRAST_SCAN      path to scan report JSON
 *   RX02A_CONTRAST_BASELINE  path to baseline JSON
 *
 * Exits 0 when clean, 1 with a diagnostic report otherwise.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_PATH = process.env.RX02A_CONTRAST_SCAN
  ? path.resolve(process.env.RX02A_CONTRAST_SCAN)
  : path.join(ROOT, 'test-results', 'contrast-scan.json')
const BASELINE_PATH = process.env.RX02A_CONTRAST_BASELINE
  ? path.resolve(process.env.RX02A_CONTRAST_BASELINE)
  : path.join(ROOT, 'scripts', 'ci04-contrast-baseline.json')

const key = (e) => `${e.route} ${e.width} ${e.target}`

let scan
try {
  scan = JSON.parse(readFileSync(SCAN_PATH, 'utf8'))
} catch {
  console.error(`[contrast-gate] FAILED — scan report not found or unreadable: ${SCAN_PATH}`)
  console.error('[contrast-gate] Run: npm run scan:contrast')
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

const malformed = []
const baselineKeys = new Set()
for (const e of baseline.entries ?? []) {
  if (!e || typeof e.route !== 'string' || typeof e.width !== 'number' || typeof e.target !== 'string' || e.target.length === 0) {
    malformed.push(JSON.stringify(e))
    continue
  }
  baselineKeys.add(key(e))
}

const scanKeys = new Set(scan.entries.map(key))
const newViolations = scan.entries.filter((e) => !baselineKeys.has(key(e)))
const fixed = [...baselineKeys].filter((k) => !scanKeys.has(k))

console.log(`[contrast-gate] scan: ${scan.entries.length} violation node(s) across widths {${scan.widths?.join(', ')}}; baseline: ${baselineKeys.size} recorded defect(s) (recorded ${baseline.recordedAt ?? 'unknown'})`)

let failures = 0
if (malformed.length > 0) {
  failures++
  console.error('\n[contrast-gate] MALFORMED baseline entries (route, width and target are required):')
  for (const m of malformed) console.error(`   ! ${m}`)
}
if (newViolations.length > 0) {
  failures++
  console.error(`\n[contrast-gate] NEW contrast violations (${newViolations.length}) — zero allowance (R5):`)
  for (const v of newViolations) {
    console.error(`   + ${v.route} @${v.width}: ${v.target}`)
    if (v.summary) console.error(`     ${String(v.summary).split('\n')[0]}`)
  }
}
if (fixed.length > 0) {
  console.log(`\n[contrast-gate] ratchet ↓ — ${fixed.length} baseline defect(s) no longer detected:`)
  for (const k of fixed) console.log(`   - ${k}`)
}

if (failures > 0) {
  console.error('\n[contrast-gate] FAILED — new contrast defects must be fixed, not baselined.')
  console.error('[contrast-gate] Only PRE-EXISTING defects recorded in scripts/ci04-contrast-baseline.json are tolerated.')
  process.exit(1)
}
console.log('\n[contrast-gate] PASS — no new contrast violations beyond the recorded Day-0 baseline.')
