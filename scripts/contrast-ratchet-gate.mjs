#!/usr/bin/env node
/**
 * CI-04 (S1-2) contrast-defect ratchet — R5 enforcement.
 *
 * Compares a contrast scan report (scripts/ci04-contrast-scan.mjs) against
 * `scripts/ci04-contrast-baseline.json`, the per-file inventory of
 * PRE-EXISTING low-contrast defects recorded at the Day-0 scan.
 *
 * Fails closed on ANY of:
 *   - INCOMPLETE COVERAGE: the scan did not render + scan all expected
 *     (route, width) combinations (LR-03 obj 4 — an empty / error / partially
 *     hydrated page must never be treated as "0 violations", which would let
 *     real defects slip through as false passes or false "ratchet ↓").
 *   - DUPLICATE SELECTORS: a violation target appears more than once within a
 *     single (route, width) combination (selector-anomaly / double-count that
 *     can mask or inflate the defect set).
 *   - a scan violation whose (route, width, target) is NOT in the baseline
 *     (zero allowance for new violations — R5),
 *   - a malformed baseline entry (missing route/width/target),
 *   - a missing or unreadable scan report.
 *
 * Baseline entries absent from the scan are ratchet ↓ (fixed defects) and
 * shrink the effective baseline; they are reported, not failed. The 249-defect
 * Day-0 baseline is retained verbatim and is never auto-trimmed by this gate.
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

/* ---- Scan-completeness hardening (LR-03 obj 4) ------------------------- */
const coverage = scan.coverage
const expectedWidths = scan.widths ?? []
const expectedRoutes = scan.routes ?? []
const expectedCombos = expectedWidths.length * expectedRoutes.length
const combos = coverage?.combos ?? []

if (!coverage || typeof coverage !== 'object') {
  failures++
  console.error('\n[contrast-gate] INCOMPLETE COVERAGE — scan report carries no `coverage` block.')
  console.error('[contrast-gate] Re-run the scanner; every (route, width) combination must be evidenced.')
} else {
  if (coverage.complete !== true) {
    failures++
    console.error(`\n[contrast-gate] INCOMPLETE COVERAGE — coverage.complete is ${coverage.complete} (rendered ${coverage.rendered ?? '?'} of ${coverage.expected ?? expectedCombos} expected combinations).`)
  }
  if (typeof coverage.expected === 'number' && coverage.expected !== expectedCombos) {
    failures++
    console.error(`\n[contrast-gate] INCOMPLETE COVERAGE — coverage.expected (${coverage.expected}) does not match widths×routes (${expectedCombos}).`)
  }
  if (combos.length !== expectedCombos) {
    failures++
    console.error(`\n[contrast-gate] INCOMPLETE COVERAGE — ${combos.length}/${expectedCombos} (route, width) combinations present in the report.`)
  }
  const unrendered = combos.filter((c) => c.rendered !== true)
  if (unrendered.length > 0) {
    failures++
    console.error(`\n[contrast-gate] ${unrendered.length} combination(s) did NOT render (blank / error / under-hydrated) — their "0 violations" cannot be trusted:`)
    for (const c of unrendered) {
      console.error(`   ! ${c.route} @${c.width}: status=${c.httpStatus ?? '?'} textLength=${c.textLength ?? '?'} rendered=${c.rendered}`)
    }
  }
}

/* ---- Duplicate-selector anomaly (LR-03 obj 4) -------------------------- */
const dupes = scan.duplicates ?? []
if (dupes.length > 0) {
  failures++
  console.error(`\n[contrast-gate] DUPLICATE-SELECTOR anomalies (${dupes.length}) — a target appears more than once within a combination (possible scan/render anomaly):`)
  for (const d of dupes) {
    console.error(`   ! ${d.route} @${d.width}: ${d.target} ×${d.count}`)
  }
}

/* ---- Existing ratchet behaviour ---------------------------------------- */
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
  console.error('\n[contrast-gate] FAILED — new contrast defects, incomplete coverage or duplicate selectors must be fixed, not baselined.')
  console.error('[contrast-gate] Only PRE-EXISTING defects recorded in scripts/ci04-contrast-baseline.json are tolerated.')
  process.exit(1)
}
console.log('\n[contrast-gate] PASS — full 15-combination coverage, no duplicates, no new contrast violations beyond the recorded Day-0 baseline.')
