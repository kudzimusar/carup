#!/usr/bin/env node
/**
 * TI-01 (issue #261) — inspectable scan of the BUILT web bundle for the removed login demo-access
 * affordance and the demo-account identities it signed in as.
 *
 * It reads every file under web/dist (optionally building it first), searches the raw bytes for each
 * marker in scripts/demo-identity-markers.json and writes a JSON report that binds the result to the
 * source: git SHA (and merge parents, for a CI merge ref), dirty state, whether dist was built in this
 * run, a digest over every scanned file, the full scanned file list, and every hit (file + byte offset
 * + short context).
 *
 * Verdict:
 *   - credential, login-affordance and seed-identity markers: any hit FAILS;
 *   - demo-login-identity and tracked-fabricated-identity markers: FAIL unless the marker has a
 *     narrowedResidue entry and its hit count is within that entry's bundleMaxHits. Residue hits stay
 *     in the report, flagged with the owning lane, so the narrowed scope is visible rather than hidden;
 *   - --strict ignores every residue allowance (the closure condition for the whole identity scope).
 *
 * Usage:
 *   node scripts/scan-bundle-demo-identity.mjs [--build] [--dist web/dist] [--out <report.json>]
 *                                               [--markers scripts/demo-identity-markers.json] [--strict]
 * Exit codes: 0 pass, 1 fail (a marker was found outside its allowance), 2 could not scan.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN_CLASSES = new Set(['credential', 'login-affordance', 'seed-identity'])
const RESIDUE_CLASSES = new Set(['demo-login-identity', 'tracked-fabricated-identity'])
const CONTEXT_BYTES = 32

function parseArgs(argv) {
  const opts = {
    build: false,
    strict: false,
    dist: join(REPO, 'web', 'dist'),
    out: join(REPO, 'web', 'test-results', 'demo-identity-bundle-scan.json'),
    markers: join(REPO, 'scripts', 'demo-identity-markers.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--build') opts.build = true
    else if (a === '--strict') opts.strict = true
    else if (a === '--dist' || a === '--out' || a === '--markers') {
      const v = argv[++i]
      if (!v) throw new UsageError(`${a} needs a value`)
      opts[a.slice(2)] = resolve(v)
    } else throw new UsageError(`unknown argument: ${a}`)
  }
  return opts
}

class UsageError extends Error {}

function git(args, cwd, { keepLeadingSpace = false } = {}) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    // Porcelain status lines start with a significant space (" M path"); only trim the end there.
    return keepLeadingSpace ? out.trimEnd() : out.trim()
  } catch {
    return null
  }
}

// Git facts for the tree that CONTAINS the scanned dist (null when the dist is not inside a work tree,
// e.g. a copied artifact), so a report never borrows the scanner's own SHA for someone else's bundle.
function gitInfo(cwd) {
  const sha = git(['rev-parse', 'HEAD'], cwd)
  const parents = (git(['rev-list', '--parents', '-n', '1', 'HEAD'], cwd) ?? '').split(' ').slice(1).filter(Boolean)
  const porcelain = sha ? git(['status', '--porcelain', '--untracked-files=no'], cwd, { keepLeadingSpace: true }) : null
  return {
    sha,
    workTree: sha ? git(['rev-parse', '--show-toplevel'], cwd) : null,
    branch: sha ? git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) : null,
    parents,
    // A CI pull_request checkout is the merge ref; its second parent is the PR head.
    isMergeCommit: parents.length > 1,
    prHeadShaFromEnv: process.env.PR_HEAD_SHA || null,
    trackedFilesDirty: porcelain === null ? null : porcelain.length > 0,
    dirtyPaths: porcelain ? porcelain.split('\n').map(l => l.slice(3)) : [],
  }
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(abs, out)
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

function printable(buf) {
  return buf.toString('latin1').replace(/[^\x20-\x7e]/g, '.')
}

function findAll(haystack, needle) {
  const offsets = []
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) offsets.push(i)
  return offsets
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function runBuild() {
  const started = Date.now()
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const res = spawnSync(npm, ['run', 'build'], { cwd: REPO, stdio: 'inherit', env: process.env })
  return { builtInThisRun: true, command: 'npm run build (repository root)', exitCode: res.status, durationMs: Date.now() - started }
}

export function scan({ distDir, manifest, strict }) {
  const files = listFiles(distDir).sort()
  const fileRows = []
  const hits = []
  const markers = manifest.markers.map(m => ({
    ...m,
    needle: Buffer.from(m.caseInsensitive ? m.value.toLowerCase() : m.value, 'latin1'),
  }))

  for (const abs of files) {
    const rel = relative(distDir, abs).split(sep).join('/')
    const bytes = readFileSync(abs)
    fileRows.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) })
    // latin1 keeps a 1:1 byte <-> char mapping, so offsets are byte offsets and lower-casing
    // cannot shift them.
    const exact = bytes.toString('latin1')
    const lower = exact.toLowerCase()
    for (const m of markers) {
      const text = m.caseInsensitive ? lower : exact
      for (const offset of findAll(text, m.needle.toString('latin1'))) {
        const from = Math.max(0, offset - CONTEXT_BYTES)
        const to = Math.min(bytes.length, offset + m.needle.length + CONTEXT_BYTES)
        hits.push({ markerId: m.id, class: m.class, file: rel, offset, context: printable(bytes.subarray(from, to)) })
      }
    }
  }

  const residueByMarker = new Map(manifest.narrowedResidue.map(r => [r.markerId, r]))
  const perMarker = manifest.markers.map(m => {
    const markerHits = hits.filter(h => h.markerId === m.id)
    const residue = residueByMarker.get(m.id)
    let allowance = 0
    if (!strict && residue && RESIDUE_CLASSES.has(m.class)) allowance = residue.bundleMaxHits
    const pass = markerHits.length <= allowance
    return {
      markerId: m.id,
      class: m.class,
      value: m.value,
      caseInsensitive: m.caseInsensitive,
      hits: markerHits.length,
      allowance,
      residueLane: residue && RESIDUE_CLASSES.has(m.class) ? residue.lane : null,
      pass,
    }
  })
  for (const h of hits) {
    const row = perMarker.find(p => p.markerId === h.markerId)
    h.withinNarrowedResidue = row.allowance > 0 && row.pass
  }

  const failures = perMarker.filter(p => !p.pass).map(p => `${p.markerId} (${p.class}): ${p.hits} hit(s), allowance ${p.allowance}`)
  const unknownClasses = manifest.markers.filter(m => !FORBIDDEN_CLASSES.has(m.class) && !RESIDUE_CLASSES.has(m.class))
  for (const m of unknownClasses) failures.push(`${m.id}: unknown marker class "${m.class}"`)

  const digest = sha256(fileRows.map(f => `${f.path}\t${f.sha256}\n`).join(''))
  return { fileRows, hits, perMarker, failures, digest }
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`scan-bundle-demo-identity: ${err.message}`)
    process.exit(2)
  }

  const manifest = JSON.parse(readFileSync(opts.markers, 'utf8'))
  let build = { builtInThisRun: false, command: null, exitCode: null, durationMs: null }
  if (opts.build) {
    build = runBuild()
    if (build.exitCode !== 0) {
      console.error(`scan-bundle-demo-identity: build failed (exit ${build.exitCode}); nothing scanned`)
      process.exit(2)
    }
  }
  if (!existsSync(opts.dist) || !statSync(opts.dist).isDirectory()) {
    console.error(`scan-bundle-demo-identity: no built bundle at ${opts.dist} (run with --build, or build first)`)
    process.exit(2)
  }
  const indexHtml = join(opts.dist, 'index.html')
  const result = scan({ distDir: opts.dist, manifest, strict: opts.strict })
  if (result.fileRows.length === 0) {
    console.error(`scan-bundle-demo-identity: ${opts.dist} is empty; refusing to report a vacuous pass`)
    process.exit(2)
  }

  const pass = result.failures.length === 0
  const report = {
    schema: 'carup.ti01.demo-identity-bundle-scan/v1',
    tool: 'scripts/scan-bundle-demo-identity.mjs',
    generatedAt: new Date().toISOString(),
    mode: opts.strict ? 'strict' : 'standard',
    scope: 'TI-01: the removed login demo-access affordance (credential, controls, demo-account identities) in the built web bundle. Residue entries are other lanes\' occurrences of the same identity and are listed, not hidden.',
    git: gitInfo(opts.dist),
    scanner: {
      gitSha: git(['rev-parse', 'HEAD'], REPO),
      sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
    build,
    markersFile: relative(REPO, opts.markers).split(sep).join('/'),
    markersSha256: sha256(readFileSync(opts.markers)),
    dist: {
      path: relative(REPO, opts.dist).split(sep).join('/') || opts.dist,
      indexHtmlPresent: existsSync(indexHtml),
      indexHtmlMtime: existsSync(indexHtml) ? statSync(indexHtml).mtime.toISOString() : null,
      fileCount: result.fileRows.length,
      totalBytes: result.fileRows.reduce((n, f) => n + f.bytes, 0),
      digest: { algorithm: 'sha256 over "path<TAB>sha256<LF>" for every file, sorted by path', value: result.digest },
    },
    verdict: { pass, failures: result.failures },
    summary: result.perMarker,
    narrowedResidue: manifest.narrowedResidue,
    hits: result.hits,
    filesScanned: result.fileRows,
  }

  mkdirSync(dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`)

  const residueHits = result.hits.filter(h => h.withinNarrowedResidue).length
  console.log(
    `scan-bundle-demo-identity: ${pass ? 'PASS' : 'FAIL'} (${report.mode}) — ${result.fileRows.length} files, ` +
      `${result.hits.length} hit(s), ${residueHits} within narrowed residue; dist tree sha ${report.git.sha ?? 'none (dist is not inside a git work tree)'}; ` +
      `dist digest ${result.digest.slice(0, 16)}…; report ${relative(process.cwd(), opts.out) || opts.out}`,
  )
  for (const f of result.failures) console.log(`  FAIL ${f}`)
  process.exit(pass ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
