/**
 * RX-02A S1-1 token contract tests (node:test, dependency-free).
 * Run: node --test scripts/tests/tokens.test.mjs
 *
 * Covers: schema validation (R3), generation parity, WCAG AA contrast on every
 * shipped pairing (light, status tints incl. S0 alpha-composited dark tints,
 * shadcn slots), certified RX-01B 45-pairing reference parity (R5), a
 * deliberately-failing mutation regression, font-weight discipline with
 * corrupted-hash negative fixtures (R1), self-hosted typography, the inert
 * dark-body scope, and the per-path no-new-glass gate incl. both R2 bypass
 * fixtures.
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
const { validateTokens } = await import(path.join(ROOT, 'scripts/validate-tokens.mjs'))

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

/* R5 — map certified RX-01B reference roles onto tokens.json values.
   Reference names → [layer, key]. Light roles resolve name refs through raw;
   dark roles resolve through semantic.darkBody or the status registry with
   S0 alpha-compositing for dark soft tints. */
const RAW = tokens.raw
const LIGHT = tokens.semantic.light
const DARK = tokens.semantic.darkBody
const STATUS = tokens.status
const STATUS_NAME = { ok: 'success', warn: 'warning', danger: 'danger', info: 'info', neutral: 'neutral', action: 'action' }
const LIGHT_ROLES = {
  paper: LIGHT['color-bg'], surface: LIGHT['color-bg-surface'], 'surface-2': LIGHT['color-bg-surface-2'],
  text: LIGHT['color-text'], 'text-2': LIGHT['color-text-2'], 'text-3': LIGHT['color-text-3'],
  action: LIGHT['color-action'], 'action-hover': LIGHT['color-action-hover'], 'action-soft': LIGHT['color-action-soft'],
}
const DARK_ROLES = {
  'dm-ink': DARK['color-bg'], 'dm-ink-2': DARK['color-bg-surface'], 'dm-work': DARK['color-bg-surface-2'], 'dm-elev': DARK['color-bg-raised'],
  'dm-text': DARK['color-text'], 'dm-text-2': DARK['color-text-2'], 'dm-text-3': DARK['color-text-3'],
  'dm-action': DARK['color-action'], 'dm-action-hover': DARK['color-action-hover'],
}
function referenceValue(mode, name) {
  if (mode === 'light') {
    if (name.endsWith('-soft')) {
      const st = STATUS[STATUS_NAME[name.slice(0, -5)]]
      return st ? resolve(st.lightSoft) : undefined
    }
    // explicit semantic roles take precedence ('action' exists both as a
    // semantic role and as a status entry; the certified matrix means the
    // semantic action ink #C2410C)
    if (name in LIGHT_ROLES) return resolve(LIGHT_ROLES[name])
    if (STATUS_NAME[name] && STATUS[STATUS_NAME[name]]) return resolve(STATUS[STATUS_NAME[name]].lightInk)
    return undefined
  }
  if (name.endsWith('-soft')) {
    const st = STATUS[STATUS_NAME[name.slice(3, -5)]]
    return st ? composite(tokens.darkSoftBase, st.darkSoftRgba) : undefined
  }
  if (name.startsWith('dm-') && STATUS_NAME[name.slice(3)] && STATUS[STATUS_NAME[name.slice(3)]]) {
    return STATUS[STATUS_NAME[name.slice(3)]].darkInk
  }
  const v = DARK_ROLES[name]
  return v === undefined ? undefined : v
}

/* ── R3: schema validation ────────────────────────────────────────── */
test('R3: token package validates against the declared schema authority', () => {
  assert.doesNotThrow(() => validateTokens(tokens), 'shared/tokens/tokens.json must satisfy shared/schemas/token-package.schema.json')
  // the declared authority file must actually exist and be valid JSON
  assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(ROOT, 'shared/schemas/token-package.schema.json'), 'utf8')))
})

test('R3 NEGATIVE: malformed token packages are rejected', () => {
  const cases = [
    [(x) => { delete x.status }, 'missing required section'],
    [(x) => { x.semantic.light['color-text'] = 'no-such-raw' }, 'unresolved name reference'],
    [(x) => { x.spacing = '8' }, 'non-array spacing scale'],
    [(x) => { x.raw.ink = 'rgba(1,2,3,0.5)' }, 'raw layer must be opaque hex'],
    [(x) => { delete x.status.success.darkSoftRgba }, 'status missing darkSoftRgba'],
    [(x) => { delete x.shadcnSlots.light.ring }, 'shadcn missing required slot'],
  ]
  for (const [mutate, label] of cases) {
    const m = structuredClone(tokens)
    mutate(m)
    const errors = validateTokens(m)
    assert.ok(errors.length > 0, `malformed package (${label}) was accepted — validator is not discriminating`)
  }
})

/* ── generation parity ────────────────────────────────────────────── */
test('generated artifacts match the token source (no drift)', () => {
  assert.equal(cssOnDisk, artifacts.css, 'tokens.css is stale — run node scripts/build-tokens.mjs')
  assert.equal(twOnDisk, artifacts.tailwind, 'tailwind.tokens.js is stale — run node scripts/build-tokens.mjs')
})

/* ── contrast ─────────────────────────────────────────────────────── */
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

/* ── R5: certified reference parity (45 pairings) ─────────────────── */
test('R5: every certified RX-01B reference pairing resolves from the token source and passes AA', () => {
  const matrix = JSON.parse(readFileSync(path.join(ROOT, 'scripts/rx01b-reference-matrix.json'), 'utf8'))
  assert.equal(matrix.length, 45, 'certified reference matrix must carry all 45 pairings')
  const unresolved = []
  const failures = []
  const ratioMismatches = []
  // Documented S0→S1-2 carry: the certified checker measured surface-2 as
  // #EBEBE5 while the governing contract (PR #260) pins #E9E9E4; tokens.json
  // ships the contract value. These pairs are verified on the contract value
  // (AA holds — the darker surface raises contrast) and reconciled in S1-2 CI-04.
  const CARRIED_SURFACE2_DRIFT = new Set(['text on surface-2', 'text-2 on surface-2', 'text-3 on surface-2'])
  const carried = []
  for (const row of matrix) {
    const label = `${row.foreground} on ${row.background}`
    const fg = referenceValue(row.mode, row.foreground)
    const bg = referenceValue(row.mode, row.background)
    if (fg === undefined || bg === undefined) { unresolved.push(label); continue }
    const c = contrast(fg, bg)
    if (c < 4.5) failures.push(`${label}: ${c.toFixed(2)}:1`)
    const label2 = row.mode === 'dark-body' ? label.replace(/^dm-/, '') : label
    if (CARRIED_SURFACE2_DRIFT.has(label2) && bg.toUpperCase() === '#E9E9E4') {
      carried.push(`${label} (contract ${bg} vs certified ${row.bg_hex}; carried to S1-2 CI-04)`)
      continue
    }
    if (Math.abs(c - row.ratio) > 0.05) ratioMismatches.push(`${label}: computed ${c.toFixed(2)} vs certified ${row.ratio}`)
  }
  assert.deepEqual(unresolved, [], `reference roles unresolved from token source: ${unresolved.join(', ')}`)
  assert.deepEqual(failures, [], `reference pairings below AA: ${failures.join(', ')}`)
  assert.deepEqual(ratioMismatches, [], `ratios diverge from certified matrix beyond tolerance: ${ratioMismatches.join(', ')}`)
  assert.equal(carried.length, 3, 'exactly the 3 documented surface-2 pairs carry the drift')
  assert.ok(tokens.semantic.light['color-bg-surface-2'] === '#E9E9E4' || RAW[tokens.semantic.light['color-bg-surface-2']] === '#E9E9E4', 'token source must pin the contract surface-2 value #E9E9E4')
})

test('R5 NEGATIVE: a token drifted from the certified reference is detected', () => {
  const matrix = JSON.parse(readFileSync(path.join(ROOT, 'scripts/rx01b-reference-matrix.json'), 'utf8'))
  const mutated = structuredClone(tokens)
  mutated.semantic.light['color-text-2'] = '#596170' // one digit off the certified #59616F
  const mResolve = (v) => generated.resolveValue(mutated.raw, v)
  const drifted = []
  for (const row of matrix) {
    if (row.mode !== 'light' || row.foreground !== 'text-2') continue
    const fg = mResolve(mutated.semantic.light['color-text-2'])
    if (fg.toUpperCase() !== row.fg_hex.toUpperCase()) drifted.push(`${row.foreground}: ${fg} vs certified ${row.fg_hex}`)
  }
  assert.ok(drifted.length > 0, 'certified-value drift was not detected — parity check is not discriminating')
})

/* ── R1: fonts ────────────────────────────────────────────────────── */
test('R1: font packaging resolves from installed pinned packages, hash-verified', async () => {
  const fonts = await import(path.join(ROOT, 'scripts/ensure-fonts.mjs'))
  const manifest = fonts.loadManifest()
  // fonts.css is a manifest of the generated per-face files — its imports must
  // match the manifest keys exactly, no more, no less.
  const fontsCss = readFileSync(path.join(ROOT, 'web/src/styles/fonts.css'), 'utf8')
  const imports = [...fontsCss.matchAll(/@import '\.\/fonts\/(.+?)\.css';/g)].map((m) => m[1]).sort()
  assert.deepEqual(imports, Object.keys(manifest).sort(), 'fonts.css imports must match the font manifest exactly')
  // the pinned packages must be declared + lockfile-resolvable
  const webPkg = JSON.parse(readFileSync(path.join(ROOT, 'web/package.json'), 'utf8'))
  assert.equal(webPkg.devDependencies['@fontsource/inter'], '5.2.5', 'Inter release must be pinned exactly')
  assert.equal(webPkg.devDependencies['@fontsource/jetbrains-mono'], '5.2.5', 'JetBrains Mono release must be pinned exactly')
  const lockRaw = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')
  assert.match(lockRaw, /"node_modules\/@fontsource\/inter"/, 'package-lock.json must resolve @fontsource/inter')
  assert.match(lockRaw, /"node_modules\/@fontsource\/jetbrains-mono"/, 'package-lock.json must resolve @fontsource/jetbrains-mono')
  // buildFace must resolve locally (fail-closed: throws when the package is absent)
  let css = ''
  for (const slug of Object.keys(manifest)) css += (await fonts.buildFace(slug, manifest[slug])).css + '\n'
  const inter = [...css.matchAll(/font-family: "Inter"[\s\S]*?font-weight: (\d+);/g)].map((m) => Number(m[1]))
  const mono = [...css.matchAll(/font-family: "JetBrains Mono"[\s\S]*?font-weight: (\d+);/g)].map((m) => Number(m[1]))
  assert.deepEqual(inter.sort(), [400, 500, 600, 700])
  assert.deepEqual(mono.sort(), [400, 500])
  assert.match(css, /font-display: swap/)
})

test('R1 NEGATIVE: corrupted font bytes fail hash verification', async () => {
  const fonts = await import(path.join(ROOT, 'scripts/ensure-fonts.mjs'))
  const manifest = fonts.loadManifest()
  assert.throws(
    () => fonts.verifyFaceBytes('inter-latin-400', manifest['inter-latin-400'], Buffer.from('corrupted-font-bytes')),
    /hash mismatch/,
    'corrupted font bytes must fail SHA-256 verification'
  )
  // fail-closed sourcing: unknown source file must throw without CDN opt-in
  const entry = { ...manifest['inter-latin-400'], sourceFile: 'files/does-not-exist.woff2' }
  await assert.rejects(() => fonts.buildFace('x', entry), /font source not found/, 'missing package must fail closed')
})

test('font discipline: Inter ships exactly 400/500/600/700; mono 400/500', () => {
  assert.deepEqual(tokens.fonts.sans.weightsShipped, [400, 500, 600, 700])
  assert.deepEqual(tokens.fonts.mono.weightsShipped, [400, 500])
  assert.deepEqual(tokens.fonts.sans.weightsDeprecated, [300, 800, 900])
})

/* ── self-hosted typography ───────────────────────────────────────── */
test('typography is self-hosted: no external font requests anywhere in the CSS chain', () => {
  const indexCss = readFileSync(path.join(ROOT, 'web/src/index.css'), 'utf8')
  for (const [name, text] of [['index.css', indexCss], ['fonts.css', readFileSync(path.join(ROOT, 'web/src/styles/fonts.css'), 'utf8')], ['tokens.css', cssOnDisk]]) {
    assert.doesNotMatch(text, /@import\s+url\(\s*['"]?https?:\/\//, `${name} imports an external URL`)
    assert.doesNotMatch(text, /url\(\s*['"]?https?:\/\/[^)]*fonts\.(googleapis|gstatic)\.com/, `${name} references Google Fonts`)
  }
})

/* ── D-07 inert dark body ─────────────────────────────────────────── */
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

/* ── R2: per-path no-new-glass gate ───────────────────────────────── */
function runGate(env) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/no-new-glass-gate.mjs')], { env: { ...process.env, ...env }, encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status, out: (err.stdout ?? '') + (err.stderr ?? '') }
  }
}

function fixtureBaseline(patterns) {
  const fx = mkdtempSync(path.join(os.tmpdir(), 'rx02a-gate-'))
  writeFileSync(path.join(fx, 'baseline.json'), JSON.stringify({ scope: 'web/src', exclude: [], patterns }))
  return fx
}

test('R2 NEGATIVE: net-new glass caller fails the gate (fixture)', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'rx02a-gate-'))
  try {
    writeFileSync(path.join(fixture, 'NewGlassCaller.tsx'), 'export const x = <div className="glass-card" />;\n')
    const { code } = runGate({ RX02A_GATE_SCOPE: fixture })
    assert.equal(code, 1, 'gate should have failed on the synthetic glass-card caller')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('R2 NEGATIVE: an extra violation inside an ALREADY-flagged file fails (original bypass)', () => {
  const fx = mkdtempSync(path.join(os.tmpdir(), 'rx02a-gate-'))
  try {
    writeFileSync(path.join(fx, 'Flagged.tsx'), 'const a = "orange-500"; const b = "orange-500";\n')
    writeFileSync(path.join(fx, 'baseline.json'), JSON.stringify({
      scope: 'web/src', exclude: [],
      patterns: { 'tailwind-orange-500': { regex: 'orange-500', baseline: { 'Flagged.tsx': 1 } } },
    }))
    const { code } = runGate({ RX02A_GATE_SCOPE: fx, RX02A_GATE_BASELINE: path.join(fx, 'baseline.json') })
    assert.equal(code, 1, 'gate must fail when an already-flagged file gains another violation')
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }
})

test('R2 NEGATIVE: an increase cannot be masked by a decrease elsewhere (original bypass)', () => {
  const fx = mkdtempSync(path.join(os.tmpdir(), 'rx02a-gate-'))
  try {
    writeFileSync(path.join(fx, 'A.tsx'), 'const a = "orange-500";\n')          // 3 → 1 (decrease)
    writeFileSync(path.join(fx, 'B.tsx'), 'const b = "orange-500"; const c = "orange-500";\n') // 1 → 2 (increase)
    writeFileSync(path.join(fx, 'baseline.json'), JSON.stringify({
      scope: 'web/src', exclude: [],
      patterns: { 'tailwind-orange-500': { regex: 'orange-500', baseline: { 'A.tsx': 3, 'B.tsx': 1 } } },
    }))
    const { code } = runGate({ RX02A_GATE_SCOPE: fx, RX02A_GATE_BASELINE: path.join(fx, 'baseline.json') })
    assert.equal(code, 1, 'gate must fail on the increase even though another file decreased')
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }
})

test('R2 POSITIVE: gate passes on the real tree at the per-path baseline', () => {
  const { code, out } = runGate({})
  assert.equal(code, 0, out)
  assert.match(out, /PASS/)
})
