#!/usr/bin/env node
/**
 * CI-04 (S1-2) gate regression tests.
 *
 * Proves the per-path style ratchet fails closed on intentional violations
 * and that the controlled-exceptions mechanism cannot be abused:
 *   - a new occurrence in an already-baselined file FAILS,
 *   - a brand-new file matching a pattern FAILS,
 *   - a decrease vs baseline PASSES (ratchet direction),
 *   - a violation covered by a justified, approved exception PASSES and is
 *     reported EXCUSED,
 *   - an exception missing justification or approvedBy FAILS as malformed,
 *   - raw-palette and rgb()/hsl() hardcoded colors fail like hex colors.
 *
 * The gate is exercised as a subprocess against synthetic fixture trees via
 * the RX02A_GATE_SCOPE / RX02A_GATE_BASELINE env overrides — the real tree
 * and real baseline are never touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = path.join(ROOT, 'scripts', 'no-new-glass-gate.mjs')

function makeFixture({ files, baseline, exceptions }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci04-gate-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, 'src', rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const baselinePath = path.join(dir, 'baseline.json')
  writeFileSync(baselinePath, JSON.stringify({
    scope: 'fixture',
    exclude: [],
    patterns: baseline,
    exceptions: exceptions ?? {},
  }, null, 2) + '\n')
  return { scope: path.join(dir, 'src'), baselinePath }
}

function runGate({ scope, baselinePath }) {
  try {
    const stdout = execFileSync(process.execPath, [GATE], {
      env: { ...process.env, RX02A_GATE_SCOPE: scope, RX02A_GATE_BASELINE: baselinePath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout }
  } catch (err) {
    return { code: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const HEX = { regex: '#[0-9a-fA-F]{3,8}\\b' }
const RGB = { regex: '\\b(?:rgb|rgba|hsl|hsla)\\(' }
const PALETTE = { regex: '\\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|accent|caret|divide|placeholder|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|zinc|neutral|stone)-\\d{2,3}\\b' }

test('CI-04: new hex occurrence in an already-baselined file FAILS', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const c = "#ffffff"; const d = "#000000"; const e = "#ff0000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'a.tsx': 2 } } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /VIOLATIONS for "hardcoded-hex-color"/)
  assert.match(r.stdout, /a\.tsx: 3 occurrences \(baseline 2\)/)
})

test('CI-04: brand-new file matching a pattern FAILS', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const c = "#ffffff";\n', 'new.tsx': 'const x = "#123456";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'a.tsx': 1 } } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /new\.tsx: 1 occurrences \(baseline 0\)/)
})

test('CI-04: decrease vs baseline PASSES (ratchet direction)', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const c = "#ffffff";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'a.tsx': 5 } } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /PASS/)
})

test('CI-04: justified + approved exception PASSES and is reported EXCUSED', () => {
  const fx = makeFixture({
    files: { 'legacy.tsx': 'const c = "#ffffff"; const d = "#000000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'legacy.tsx': 1 } } },
    exceptions: {
      'hardcoded-hex-color': [{
        file: 'legacy.tsx',
        justification: 'Brand-critical legacy campaign palette frozen until S1-3 migration of the owning screen (evidence: verifier run 2026-11-11T0900Z).',
        approvedBy: 'Moderator CARUP-UX-REBUILD-01',
        reviewBy: '2027-02-01',
      }],
    },
  })
  const r = runGate(fx)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /EXCUSED violation/)
  assert.match(r.stdout, /justification: Brand-critical legacy campaign palette/)
})

test('CI-04: exception without justification FAILS as malformed', () => {
  const fx = makeFixture({
    files: { 'legacy.tsx': 'const c = "#ffffff"; const d = "#000000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'legacy.tsx': 1 } } },
    exceptions: {
      'hardcoded-hex-color': [{ file: 'legacy.tsx', approvedBy: 'someone' }],
    },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /MALFORMED EXCEPTIONS/)
})

test('CI-04: exception without approvedBy FAILS as malformed', () => {
  const fx = makeFixture({
    files: { 'legacy.tsx': 'const c = "#ffffff"; const d = "#000000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'legacy.tsx': 1 } } },
    exceptions: {
      'hardcoded-hex-color': [{ file: 'legacy.tsx', justification: 'looks fine' }],
    },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /MALFORMED EXCEPTIONS/)
})

test('CI-04: exception naming a different file does NOT excuse the violation', () => {
  const fx = makeFixture({
    files: { 'legacy.tsx': 'const c = "#ffffff"; const d = "#000000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'legacy.tsx': 1 } } },
    exceptions: {
      'hardcoded-hex-color': [{ file: 'other.tsx', justification: 'j', approvedBy: 'a' }],
    },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /VIOLATIONS/)
})

test('CI-04: new raw-palette utility class in a new file FAILS', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const k = "text-slate-900";\n', 'b.tsx': 'const k = "bg-blue-500";\n' },
    baseline: { 'tailwind-raw-palette': { ...PALETTE, baseline: { 'a.tsx': 1 } } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /b\.tsx: 1 occurrences \(baseline 0\)/)
})

test('CI-04: new rgb()/hsl() functional color FAILS', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const s = { color: "rgba(0, 0, 0, 0.5)" };\n' },
    baseline: { 'hardcoded-rgb-hsl-color': { ...RGB, baseline: {} } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /VIOLATIONS for "hardcoded-rgb-hsl-color"/)
})

test('CI-04: baseline decrease in one file cannot mask an increase in another', () => {
  const fx = makeFixture({
    files: { 'a.tsx': 'const c = "#ffffff";\n', 'b.tsx': 'const c = "#ffffff"; const d = "#000000";\n' },
    baseline: { 'hardcoded-hex-color': { ...HEX, baseline: { 'a.tsx': 3, 'b.tsx': 1 } } },
  })
  const r = runGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /b\.tsx: 2 occurrences \(baseline 1\)/)
})

/* ------------------------------------------------------------------ *
 * Contrast-defect ratchet (R5) — zero allowance for new violations.  *
 * ------------------------------------------------------------------ */

const CONTRAST_GATE = path.join(ROOT, 'scripts', 'contrast-ratchet-gate.mjs')

const FIXTURE_WIDTHS = [360, 390, 768, 1280, 1920]
const FIXTURE_ROUTES = ['/', '/marketplace', '/pricing']

// A complete, fully-rendered coverage block over all 15 route/viewport
// combinations. Tests that need an incomplete / unrendered / duplicate
// scenario override `coverage` or `duplicates`.
function fullCoverage({ render = true } = {}) {
  const combos = []
  for (const width of FIXTURE_WIDTHS) {
    for (const route of FIXTURE_ROUTES) {
      combos.push({
        route, width,
        httpStatus: render ? 200 : 500,
        title: 'Fixture',
        textLength: render ? 5000 : 0,
        rendered: render,
        violationCount: 0,
      })
    }
  }
  const rendered = combos.filter((c) => c.rendered).length
  return {
    expected: combos.length,
    rendered,
    complete: rendered === combos.length,
    widths: FIXTURE_WIDTHS,
    routes: FIXTURE_ROUTES,
    combos,
  }
}

function makeContrastFixture({ scanEntries, baselineEntries, coverage, duplicates }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci04-contrast-'))
  const scanPath = path.join(dir, 'scan.json')
  const baselinePath = path.join(dir, 'baseline.json')
  writeFileSync(scanPath, JSON.stringify({
    scannedAt: '2026-11-12T00:00:00Z', baseUrl: 'http://fixture',
    widths: FIXTURE_WIDTHS, routes: FIXTURE_ROUTES,
    coverage: coverage ?? fullCoverage(),
    duplicates: duplicates ?? [],
    entries: scanEntries,
  }, null, 2) + '\n')
  writeFileSync(baselinePath, JSON.stringify({
    recordedAt: '2026-11-11', widths: FIXTURE_WIDTHS,
    routes: FIXTURE_ROUTES, entries: baselineEntries,
  }, null, 2) + '\n')
  return { scanPath, baselinePath }
}

function runContrastGate({ scanPath, baselinePath }) {
  try {
    const stdout = execFileSync(process.execPath, [CONTRAST_GATE], {
      env: { ...process.env, RX02A_CONTRAST_SCAN: scanPath, RX02A_CONTRAST_BASELINE: baselinePath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout }
  } catch (err) {
    return { code: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const V = (route, width, target) => ({ route, width, target, ratio: 2.1, fg: '#ffffff', bg: '#f5f5f5' })

test('CI-04/R5: a NEW contrast violation vs baseline FAILS (zero allowance)', () => {
  const fx = makeContrastFixture({
    scanEntries: [V('/', 390, '.hero h1'), V('/marketplace', 1280, '.card .price')],
    baselineEntries: [V('/', 390, '.hero h1')],
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /NEW contrast violations \(1\)/)
  assert.match(r.stdout, /\/marketplace @1280: \.card \.price/)
})

test('CI-04/R5: baseline defect no longer detected PASSES (ratchet ↓)', () => {
  const fx = makeContrastFixture({
    scanEntries: [V('/', 390, '.hero h1')],
    baselineEntries: [V('/', 390, '.hero h1'), V('/pricing', 768, '.old .defect')],
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /ratchet ↓/)
  assert.match(r.stdout, /\/pricing 768 \.old \.defect/)
})

test('CI-04/R5: malformed baseline entry FAILS', () => {
  const fx = makeContrastFixture({
    scanEntries: [],
    baselineEntries: [{ route: '/', width: '390' /* width must be a number */ }],
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /MALFORMED baseline entries/)
})

test('CI-04/R5: missing scan report FAILS closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci04-contrast-'))
  const baselinePath = path.join(dir, 'baseline.json')
  writeFileSync(baselinePath, JSON.stringify({ recordedAt: '2026-11-11', entries: [] }) + '\n')
  const r = runContrastGate({ scanPath: path.join(dir, 'does-not-exist.json'), baselinePath })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /scan report not found or unreadable/)
})

/* ------------------------------------------------------------------ *
 * Scan-completeness hardening (LR-03 obj 4) — incomplete / blank /    *
 * duplicate scans must never produce a false PASS.                    *
 * ------------------------------------------------------------------ */

test('CI-04: full 15-combo coverage with no new violations PASSES (positive control)', () => {
  const fx = makeContrastFixture({
    scanEntries: [V('/', 390, '.hero h1')],
    baselineEntries: [V('/', 390, '.hero h1')],
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /full 15-combination coverage, no duplicates/)
})

test('CI-04: INCOMPLETE coverage (a combination missing) FAILS closed', () => {
  const coverage = fullCoverage()
  coverage.combos = coverage.combos.slice(0, 14) // drop the 15th combination
  coverage.rendered = coverage.combos.filter((c) => c.rendered).length
  coverage.complete = false
  const fx = makeContrastFixture({
    scanEntries: [], baselineEntries: [],
    coverage,
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /INCOMPLETE COVERAGE/)
})

test('CI-04: an UNRENDERED (blank/error) combination FAILS closed — no false "0 violations"', () => {
  const coverage = fullCoverage()
  coverage.combos[3] = { ...coverage.combos[3], rendered: false, httpStatus: 500, textLength: 0 }
  coverage.rendered = coverage.combos.filter((c) => c.rendered).length
  coverage.complete = false
  const fx = makeContrastFixture({
    scanEntries: [], baselineEntries: [],
    coverage,
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /did NOT render/)
})

test('CI-04: a scan report with NO coverage block FAILS closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci04-contrast-'))
  const scanPath = path.join(dir, 'scan.json')
  const baselinePath = path.join(dir, 'baseline.json')
  writeFileSync(scanPath, JSON.stringify({
    scannedAt: '2026-11-12T00:00:00Z', baseUrl: 'http://fixture',
    widths: FIXTURE_WIDTHS, routes: FIXTURE_ROUTES,
    entries: [],
  }, null, 2) + '\n')
  writeFileSync(baselinePath, JSON.stringify({ recordedAt: '2026-11-11', entries: [] }) + '\n')
  const r = runContrastGate({ scanPath, baselinePath })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /carries no `coverage` block/)
})

test('CI-04: DUPLICATE-SELECTOR anomaly within a combination FAILS closed', () => {
  const fx = makeContrastFixture({
    scanEntries: [V('/', 390, '.dup'), V('/', 768, '.ok')],
    baselineEntries: [],
    duplicates: [{ route: '/', width: 390, target: '.dup', count: 3 }],
  })
  const r = runContrastGate(fx)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /DUPLICATE-SELECTOR anomalies \(1\)/)
  assert.match(r.stdout, /\.dup ×3/)
})

/* ------------------------------------------------------------------ *
 * B3 — surface-2 reconciliation is executable, not just documented.  *
 * ------------------------------------------------------------------ */

import { readFileSync } from 'node:fs'

test('B3: every carried surface-2 pair carries reconciliation metadata naming the contract authority', () => {
  const matrix = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'rx01b-reference-matrix.json'), 'utf8'))
  const carried = matrix.filter((p) => p.background === 'surface-2')
  assert.equal(carried.length, 3, 'exactly 3 surface-2 pairs exist')
  for (const p of carried) {
    assert.equal(p.bg_hex, '#EBEBE5', 'historical certification value preserved')
    const rec = p.reconciliation
    assert.ok(rec, `missing reconciliation block on ${p.foreground} on surface-2`)
    assert.equal(rec.status, 'reconciled')
    assert.equal(rec.authority, 'design-contract')
    assert.equal(rec.contract_bg_hex, '#E9E9E4')
    assert.equal(rec.historical_bg_hex, '#EBEBE5')
    assert.match(rec.decision_ref, /RX02A_S1_2_SURFACE_2_RECONCILIATION\.md$/)
  }
  const tokens = JSON.parse(readFileSync(path.join(ROOT, 'shared', 'tokens', 'tokens.json'), 'utf8'))
  const slot = tokens.semantic.light['color-bg-surface-2']
  const resolved = typeof slot === 'string' && slot.startsWith('#') ? slot : tokens.raw[slot]
  assert.equal(resolved, '#E9E9E4', 'token source must pin the contract surface-2 value')
})
