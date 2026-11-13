#!/usr/bin/env node
/**
 * CI-04 (S1-2) contrast-defect scanner — R5 evidence producer.
 *
 * Measures WCAG color-contrast violations (axe `color-contrast` rule only)
 * on the approved RX-01A evidence matrix: routes /, /marketplace, /pricing at
 * the five approved responsive widths {360, 390, 768, 1280, 1920}
 * (3 × 5 = 15 route/viewport combinations).
 *
 * Scan-completeness hardening (LR-03 objective 4):
 *   - EVERY (route, width) combination is recorded in `coverage.combos`
 *     with its HTTP status, document title, text length and a `rendered`
 *     boolean, so a blank / error / partially-hydrated page can never be
 *     silently treated as "0 violations". `coverage.complete` is true only
 *     when all expected combinations rendered.
 *   - `duplicates` records any violation target that appears more than once
 *     within a single combination (a selector-anomaly / double-count signal
 *     that would otherwise inflate or mask the defect set).
 *
 * This script is a MEASUREMENT tool: it always exits 0 after writing a JSON
 * report. Enforcement is `scripts/contrast-ratchet-gate.mjs`, which compares
 * the report against `scripts/ci04-contrast-baseline.json` (per-file ratchet:
 * zero allowance for NEW violations; disappeared defects are ratchet ↓) AND
 * fails closed when coverage is incomplete or duplicates are present.
 *
 * Usage:
 *   node scripts/ci04-contrast-scan.mjs [--out test-results/contrast-scan.json]
 *
 * Requires the dev server to be reachable (the script boots `vite` itself on
 * a dedicated port unless RX02A_CONTRAST_BASE_URL is provided).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIDTHS = [360, 390, 768, 1280, 1920]
const ROUTES = ['/', '/marketplace', '/pricing']
const EXPECTED_COMBOS = WIDTHS.length * ROUTES.length
// A combination that renders less text than this is treated as blank/error.
// All three target routes are content-rich public pages (hero + body copy),
// so any genuine render far exceeds the threshold.
const MIN_TEXT_LENGTH = 100
const PORT = process.env.RX02A_CONTRAST_PORT ?? '5199'
const BASE_URL = process.env.RX02A_CONTRAST_BASE_URL ?? `http://localhost:${PORT}`
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(ROOT, 'test-results', 'contrast-scan.json')

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' })
      if (res.status < 500) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`dev server did not become ready at ${url}`)
}

let server = null
if (!process.env.RX02A_CONTRAST_BASE_URL) {
  server = spawn('npm', ['run', 'dev', '--workspace=web', '--', '--port', PORT, '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
  await waitForServer(BASE_URL)
}

const entries = []
const combos = []
const duplicates = []
const browser = await chromium.launch()
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    for (const route of ROUTES) {
      const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 60_000 })

      // ---- render-completeness evidence (LR-03 obj 4) --------------------
      const httpStatus = response ? response.status() : 0
      const title = await page.title().catch(() => '')
      const textLength = await page.evaluate(() => {
        const t = document.body ? document.body.innerText : ''
        return t ? t.trim().length : 0
      }).catch(() => 0)
      const rendered = httpStatus > 0 && httpStatus < 400 && textLength >= MIN_TEXT_LENGTH

      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()

      const targets = []
      for (const v of results.violations) {
        for (const node of v.nodes) {
          const target = node.target.join(' ')
          targets.push(target)
          entries.push({
            route,
            width,
            rule: v.id,
            impact: v.impact ?? null,
            target,
            summary: node.failureSummary ?? null,
          })
        }
      }

      // ---- duplicate-selector detection within this combination ----------
      const seen = new Map()
      for (const t of targets) seen.set(t, (seen.get(t) ?? 0) + 1)
      for (const [target, count] of seen) {
        if (count > 1) duplicates.push({ route, width, target, count })
      }

      combos.push({
        route,
        width,
        httpStatus,
        title,
        textLength,
        rendered,
        violationCount: targets.length,
      })
      console.log(`[contrast-scan] ${route} @${width}: status=${httpStatus} text=${textLength} rendered=${rendered} violations=${targets.length}`)
    }
    await context.close()
  }
} finally {
  await browser.close()
  if (server) { try { process.kill(-server.pid) } catch { /* already gone */ } }
}

const renderedCount = combos.filter((c) => c.rendered).length
const coverage = {
  expected: EXPECTED_COMBOS,
  rendered: renderedCount,
  complete: combos.length === EXPECTED_COMBOS && renderedCount === EXPECTED_COMBOS,
  widths: WIDTHS,
  routes: ROUTES,
  combos,
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  scannedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  widths: WIDTHS,
  routes: ROUTES,
  coverage,
  duplicates,
  entries,
}, null, 2) + '\n')
console.log(`[contrast-scan] coverage: ${renderedCount}/${EXPECTED_COMBOS} combos rendered; complete=${coverage.complete}; duplicates=${duplicates.length}`)
console.log(`[contrast-scan] wrote ${entries.length} violation node(s) -> ${OUT}`)
