/**
 * TI-01 — the bundle scan must be able to fail. Each case builds a throwaway dist directory, plants
 * (or does not plant) a marker, runs the real CLI and checks the exit code and the JSON report.
 * Marker values come from the shared manifest, so this file holds none of them.
 *
 * Run: node --test scripts/tests/scan-bundle-demo-identity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO, 'scripts', 'scan-bundle-demo-identity.mjs')
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'scripts', 'demo-identity-markers.json'), 'utf8'))
const marker = id => {
  const m = MANIFEST.markers.find(x => x.id === id)
  assert.ok(m, `manifest has marker ${id}`)
  return m.value
}

function makeDist(files) {
  const root = mkdtempSync(join(tmpdir(), 'ti01-scan-'))
  const dist = join(root, 'dist')
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, rel)), { recursive: true })
    writeFileSync(join(dist, rel), content)
  }
  return { root, dist }
}

function runScan(dist, root, extra = []) {
  const out = join(root, 'report.json')
  const res = spawnSync(process.execPath, [SCRIPT, '--dist', dist, '--out', out, ...extra], { encoding: 'utf8' })
  let report = null
  try {
    report = JSON.parse(readFileSync(out, 'utf8'))
  } catch {
    /* no report written */
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, report }
}

const CLEAN = {
  'index.html': '<!doctype html><title>CarUp</title><script type="module" src="/assets/index-abc.js"></script>',
  'assets/index-abc.js': 'const x="Sign In";export{x};',
  'assets/index-abc.css': '.a{color:red}',
}

test('a clean bundle passes and the report binds digest and file list (no borrowed SHA outside a repo)', () => {
  const { root, dist } = makeDist(CLEAN)
  try {
    const r = runScan(dist, root)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.report.verdict.pass, true)
    // The throwaway dist is not inside a git work tree, so the report must not claim a source SHA;
    // the scanner's own SHA is reported separately.
    assert.equal(r.report.git.sha, null)
    assert.match(r.report.scanner.gitSha, /^[0-9a-f]{40}$/)
    assert.equal(r.report.dist.fileCount, 3)
    assert.deepEqual(r.report.filesScanned.map(f => f.path), ['assets/index-abc.css', 'assets/index-abc.js', 'index.html'])
    assert.match(r.report.dist.digest.value, /^[0-9a-f]{64}$/)
    assert.equal(r.report.hits.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a dist inside a git work tree is bound to THAT tree\'s HEAD and dirty state', () => {
  const { root, dist } = makeDist(CLEAN)
  const g = (...args) =>
    execFileSync('git', ['-c', 'user.name=scan-test', '-c', 'user.email=scan-test@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  try {
    g('init', '-q')
    writeFileSync(join(root, 'source.txt'), 'v1\n')
    g('add', 'source.txt')
    g('commit', '-q', '-m', 'fixture')
    const head = g('rev-parse', 'HEAD')
    const clean = runScan(dist, root)
    assert.equal(clean.report.git.sha, head)
    assert.equal(clean.report.git.trackedFilesDirty, false)
    writeFileSync(join(root, 'source.txt'), 'v2\n')
    const dirty = runScan(dist, root)
    assert.equal(dirty.report.git.trackedFilesDirty, true)
    assert.deepEqual(dirty.report.git.dirtyPaths, ['source.txt'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a planted shared credential fails, with file and byte offset', () => {
  const planted = `const a=1;const p="${marker('shared-demo-credential')}";`
  const { root, dist } = makeDist({ ...CLEAN, 'assets/Login-x.js': planted })
  try {
    const r = runScan(dist, root)
    assert.equal(r.status, 1)
    assert.equal(r.report.verdict.pass, false)
    const hit = r.report.hits.find(h => h.markerId === 'shared-demo-credential')
    assert.equal(hit.file, 'assets/Login-x.js')
    assert.equal(hit.offset, planted.indexOf(marker('shared-demo-credential')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a planted demo control label fails regardless of case', () => {
  const { root, dist } = makeDist({ ...CLEAN, 'index.html': `<p>${marker('demo-block-heading').toUpperCase()}</p>` })
  try {
    const r = runScan(dist, root)
    assert.equal(r.status, 1)
    assert.ok(r.report.hits.some(h => h.markerId === 'demo-block-heading'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a demo-account identity with no residue entry fails', () => {
  const { root, dist } = makeDist({ ...CLEAN, 'assets/chunk.js': `x="${marker('u1-name')}"` })
  try {
    const r = runScan(dist, root)
    assert.equal(r.status, 1)
    assert.ok(r.report.verdict.failures.some(f => f.startsWith('u1-name')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('declared residue within its allowance passes but stays visible; above it, or in --strict, it fails', () => {
  const one = `t="+263 ${marker('u1-phone')}"`
  const withinBudget = makeDist({ ...CLEAN, 'assets/privacy.js': one })
  const overBudget = makeDist({ ...CLEAN, 'assets/privacy.js': one, 'assets/other.js': one })
  try {
    const ok = runScan(withinBudget.dist, withinBudget.root)
    assert.equal(ok.status, 0, ok.stdout)
    const hit = ok.report.hits.find(h => h.markerId === 'u1-phone')
    assert.equal(hit.withinNarrowedResidue, true)
    assert.ok(ok.report.summary.find(s => s.markerId === 'u1-phone').residueLane)

    const strict = runScan(withinBudget.dist, withinBudget.root, ['--strict'])
    assert.equal(strict.status, 1)
    assert.equal(strict.report.mode, 'strict')

    const over = runScan(overBudget.dist, overBudget.root)
    assert.equal(over.status, 1)
  } finally {
    rmSync(withinBudget.root, { recursive: true, force: true })
    rmSync(overBudget.root, { recursive: true, force: true })
  }
})

test('a missing or empty dist cannot produce a pass', () => {
  const { root, dist } = makeDist({})
  try {
    mkdirSync(dist, { recursive: true })
    assert.equal(runScan(dist, root).status, 2)
    assert.equal(runScan(join(root, 'nope'), root).status, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
