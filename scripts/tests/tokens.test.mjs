/**
 * RX-02A S1-1 token contract tests (node:test, dependency-free).
 * Run: node --test scripts/tests/tokens.test.mjs
 *
 * Covers: generation parity, WCAG AA contrast on every shipped pairing
 * (light, status tints incl. S0 alpha-composited dark tints, shadcn slots),
 * a deliberately-failing mutation regression, font-weight discipline,
 * self-hosted typography, and the inert dark-body scope.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tokens = JSON.parse(readFileSync(path.join(ROOT, 'shared/tokens/tokens.json'), 'utf8'))
const generated = await import(path.join(ROOT, 'scripts/build-tokens.mjs'))
const { buildArtifacts, composite, hexToRgb } = generated

const artifacts = buildArtifacts(tokens)
const cssOnDisk = readFileSync(path.join(ROOT, 'web/src/styles/tokens.css'), 'utf8')
const twOnDisk = readFileSync(path.join(ROOT, 'web/tailwind.tokens.js'), 'utf8')

/* ── WCAG relative-luminance contrast ─────────────────────────────── */
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (fg, bg) => {
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}
const resolve = (v) => generated.resolveValue(tokens.raw, v)

/* Pairings the platform ships. Each [fg, bg, label]. */
function shippedPairings() {
  const s = tokens.semantic.light
  const pair = (fg, bg, label) => [resolve(fg), resolve(bg), label]
  const out = [
    pair(s['color-text'], s['color-bg'], 'text on bg'),
    pair(s['color-text'], s['color-bg-surface'], 'text on surface'),
    pair(s['color-text'], s['color-bg-surface-2'], 'text on surface-2'),
    pair(s['color-text'], s['color-bg-raised'], 'text on raised'),
    pair(s['color-text-2'], s['color-bg'], 'text-2 on bg'),
    pair(s['color-text-2'], s['color-bg-surface'], 'text-2 on surface'),
    pair(s['color-text-3'], s['color-bg'], 'text-3 on bg'),
    pair(s['color-action-on'], s['color-action'], 'action-on on action'),
    pair(s['color-action-on'], s['color-action-hover'], 'action-on on action-hover'),
    pair(s['color-action-hover'], s['color-action-soft'], 'action-hover on action-soft'),
  ]
  for (const [name, st] of Object.entries(tokens.status)) {
    out.push(pair(st.lightInk, st.lightSoft, `status ${name} ink on soft`))
    out.push(pair(st.lightInk, s['color-bg'], `status ${name} ink on bg`))
    // dark-body tints: composited soft over the dark soft base (S0 methodology)
    const softComp = composite(tokens.darkSoftBase, st.darkSoftRgba)
    out.push(pair(resolve(st.darkInk), tokens.darkSoftBase, `status ${name} dark ink on dark base`))
    out.push([resolve(st.darkInk), softComp, `status ${name} dark ink on composited soft`].flat())
  }
  const slots = tokens.shadcnSlots.light
  out.push(pair(slots.foreground, slots.background, 'shadcn foreground on background'))
  out.push(pair(slots['primary-foreground'], slots.primary, 'shadcn primary-foreground on primary'))
  out.push(pair(slots['muted-foreground'], slots.muted, 'shadcn muted-foreground on muted'))
  out.push(pair(slots['accent-foreground'], slots.accent, 'shadcn accent-foreground on accent'))
  out.push(pair(slots['card-foreground'], slots.card, 'shadcn card-foreground on card'))
  out.push(pair(slots['destructive-foreground'], slots.destructive, 'shadcn destructive-foreground on destructive'))
  out.push(pair(slots['sidebar-foreground'], slots['sidebar-background'], 'shadcn sidebar-foreground on sidebar-background'))
  out.push(pair(slots['sidebar-accent-foreground'], slots['sidebar-accent'], 'shadcn sidebar accent-foreground on accent'))
  return out
}

test('generated artifacts match the token source (no drift)', () => {
  assert.equal(cssOnDisk, artifacts.css, 'tokens.css is stale — run node scripts/build-tokens.mjs')
  assert.equal(twOnDisk, artifacts.tailwind, 'tailwind.tokens.js is stale — run node scripts/build-tokens.mjs')
})

test('every shipped pairing meets WCAG AA (>= 4.5:1)', () => {
  const failures = []
  for (const [fg, bg, label] of shippedPairings()) {
    const c = contrast(fg, bg)
    if (c < 4.5) failures.push(`${label}: ${c.toFixed(2)}:1`)
    assert.ok(c >= 4.5, `${label} — ${c.toFixed(2)}:1 < 4.5:1`)
  }
  assert.deepEqual(failures, [])
})

test('MUTATION (deliberate regression): danger ink #E45E5E must FAIL AA', () => {
  const mutated = structuredClone(tokens)
  mutated.status.danger.lightInk = '#E45E5E'
  const mutatedResolve = (v) => generated.resolveValue(mutated.raw, v)
  const s = mutated.semantic.light
  const pair = (fg, bg, label) => [mutatedResolve(fg), mutatedResolve(bg), label]
  const bad = []
  const danger = mutated.status.danger
  const candidates = [
    pair(danger.lightInk, danger.lightSoft, 'danger ink on soft'),
    pair(danger.lightInk, s['color-bg'], 'danger ink on bg'),
  ]
  for (const [fg, bg] of candidates) if (contrast(fg, bg) < 4.5) bad.push([fg, bg])
  assert.ok(bad.length > 0, 'mutation #E45E5E was expected to break AA but did not — contrast check is not discriminating')
})

test('font discipline: Inter ships exactly 400/500/600/700; mono 400/500', () => {
  assert.deepEqual(tokens.fonts.sans.weightsShipped, [400, 500, 600, 700])
  assert.deepEqual(tokens.fonts.mono.weightsShipped, [400, 500])
  assert.deepEqual(tokens.fonts.sans.weightsDeprecated, [300, 800, 900])
  // fonts.css is a manifest of per-face files — resolve every @import and
  // verify the emitted faces match the shipped weight set exactly.
  const stylesDir = path.join(ROOT, 'web/src/styles')
  const manifest = readFileSync(path.join(stylesDir, 'fonts.css'), 'utf8')
  const imports = [...manifest.matchAll(/@import '\.\/(.+?)';/g)].map((m) => m[1])
  assert.equal(imports.length, 6, 'expected 6 per-face font files')
  let css = ''
  for (const imp of imports) css += readFileSync(path.join(stylesDir, imp), 'utf8') + '\n'
  const inter = [...css.matchAll(/font-family: "Inter"[\s\S]*?font-weight: (\d+);/g)].map((m) => Number(m[1]))
  const mono = [...css.matchAll(/font-family: "JetBrains Mono"[\s\S]*?font-weight: (\d+);/g)].map((m) => Number(m[1]))
  assert.deepEqual(inter.sort(), [400, 500, 600, 700])
  assert.deepEqual(mono.sort(), [400, 500])
  assert.match(css, /font-display: swap/)
})

test('typography is self-hosted: no external font requests anywhere in the CSS chain', () => {
  const indexCss = readFileSync(path.join(ROOT, 'web/src/index.css'), 'utf8')
  for (const [name, text] of [['index.css', indexCss], ['fonts.css', readFileSync(path.join(ROOT, 'web/src/styles/fonts.css'), 'utf8')], ['tokens.css', cssOnDisk]]) {
    assert.doesNotMatch(text, /@import\s+url\(\s*['"]?https?:\/\//, `${name} imports an external URL`)
    assert.doesNotMatch(text, /url\(\s*['"]?https?:\/\/[^)]*fonts\.(googleapis|gstatic)\.com/, `${name} references Google Fonts`)
  }
})

test('dark-body scope is token-complete but unreferenced by app code (D-07 gate)', () => {
  assert.match(cssOnDisk, /\.carup-theme-dark-body\s*\{/)
  const srcRoot = path.join(ROOT, 'web/src')
  const offenders = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx|css)$/.test(e.name) && e.name !== 'tokens.css') {
        if (readFileSync(full, 'utf8').includes('carup-theme-dark-body')) offenders.push(path.relative(srcRoot, full))
      }
    }
  }
  walk(srcRoot)
  assert.deepEqual(offenders, [], `dark-body scope referenced by: ${offenders.join(', ')}`)
})

test('NEGATIVE: no-new-glass gate fails on a net-new glass caller (fixture)', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'rx02a-gate-'))
  try {
    writeFileSync(path.join(fixture, 'NewGlassCaller.tsx'), 'export const x = <div className="glass-card" />;\n')
    let code = null
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/no-new-glass-gate.mjs')], {
        env: { ...process.env, RX02A_GATE_SCOPE: fixture },
        stdio: 'pipe',
      })
    } catch (err) {
      code = err.status
    }
    assert.equal(code, 1, 'gate should have failed on the synthetic glass-card caller')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('POSITIVE: no-new-glass gate passes on the real tree at baseline', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/no-new-glass-gate.mjs')], { encoding: 'utf8' })
  assert.match(out, /PASS/)
})
