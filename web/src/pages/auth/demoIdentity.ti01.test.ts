/**
 * TI-01 (issue 261) — source scan for the removed login demo-access affordance.
 *
 * Scope, stated exactly: PR 272 removes the login page's demo sign-in (the demo-access controls,
 * the hardcoded demo-account identities and the shared demo credential). It does NOT claim that
 * every fictional identity in the product is gone. This test therefore checks two things:
 *
 *   1. the login path carries no marker at all — no credential, no demo control, no demo identity,
 *      and exactly one sign-in request built from what the user typed;
 *   2. across every non-test file in web/src, a demo-login marker appears ONLY where
 *      scripts/demo-identity-markers.json lists it as narrowed residue (owned by another lane), and
 *      every residue entry is still real, so the allowlist cannot quietly go stale.
 *
 * The marker list is shared with scripts/scan-bundle-demo-identity.mjs, which checks the built
 * bundle. The marker values are read from that JSON at runtime, so this file holds none of them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

interface Marker {
  id: string
  class: string
  value: string
  caseInsensitive: boolean
}
interface Residue {
  markerId: string
  sourceFiles: string[]
  lane: string
  reason: string
}
interface Manifest {
  markers: Marker[]
  narrowedResidue: Residue[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = resolve(HERE, '../..')
const REPO = resolve(WEB_SRC, '../..')
const MANIFEST: Manifest = JSON.parse(readFileSync(join(REPO, 'scripts', 'demo-identity-markers.json'), 'utf8'))

const SCANNED_EXT = /\.(?:[cm]?[jt]sx?|json|css|html|svg)$/
const TEST_ONLY = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)(?:__tests__|__mocks__)\/|^web\/src\/test\//

function repoPath(abs: string): string {
  return relative(REPO, abs).split(sep).join('/')
}

function listClientSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) listClientSources(abs, out)
    else if (SCANNED_EXT.test(entry.name) && !TEST_ONLY.test(repoPath(abs))) out.push(abs)
  }
  return out
}

function countHits(text: string, marker: Marker): number {
  const haystack = marker.caseInsensitive ? text.toLowerCase() : text
  const needle = marker.caseInsensitive ? marker.value.toLowerCase() : marker.value
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++
  return n
}

function hitsIn(file: string): Array<{ file: string; markerId: string; hits: number }> {
  const text = readFileSync(file, 'utf8')
  return MANIFEST.markers
    .map(m => ({ file: repoPath(file), markerId: m.id, hits: countHits(text, m) }))
    .filter(h => h.hits > 0)
}

const LOGIN_PATH = [
  'pages/auth/Login.tsx',
  'pages/auth/LoginErrorAlert.tsx',
  'pages/auth/loginError.ts',
  'context/AuthContext.tsx',
  'lib/returnTo.ts',
].map(p => join(WEB_SRC, p))

describe('TI-01 — the login demo-access affordance is gone from the login path', () => {
  it('the marker manifest is loaded and non-trivial (guards against a vacuous scan)', () => {
    const classes = new Set(MANIFEST.markers.map(m => m.class))
    expect(classes).toEqual(
      new Set(['credential', 'login-affordance', 'demo-login-identity', 'seed-identity', 'tracked-fabricated-identity']),
    )
    expect(MANIFEST.markers.length).toBeGreaterThanOrEqual(15)
    expect(listClientSources(WEB_SRC).length).toBeGreaterThan(200)
  })

  it('no login-path module carries the demo credential, a demo control or a demo-account identity', () => {
    const found = LOGIN_PATH.flatMap(hitsIn)
    expect(found).toEqual([])
  })

  it('Login.tsx signs in exactly once, with what the user typed — no second, hardcoded sign-in path', () => {
    const src = readFileSync(join(WEB_SRC, 'pages/auth/Login.tsx'), 'utf8')
    expect(src.match(/\/auth\/login\b/g) ?? []).toHaveLength(1)
    expect(src).toContain('body: JSON.stringify({ email: form.email, password: form.password })')
    expect(src.match(/JSON\.stringify\(/g) ?? []).toHaveLength(1)
    expect(src).not.toMatch(/password:\s*['"`][^'"`]/)
  })
})

describe('TI-01 — demo-login identity markers in client source are limited to the declared residue', () => {
  const allHits = listClientSources(WEB_SRC).flatMap(hitsIn)
  const residueKeys = new Set(
    MANIFEST.narrowedResidue.flatMap(r => r.sourceFiles.map(f => `${f}::${r.markerId}`)),
  )

  it('every marker hit outside the test suite is a declared narrowed-residue entry', () => {
    const unexpected = allHits.filter(h => !residueKeys.has(`${h.file}::${h.markerId}`))
    expect(unexpected).toEqual([])
  })

  it('every declared residue entry still exists (remove it from the manifest once its lane fixes it)', () => {
    const present = new Set(allHits.map(h => `${h.file}::${h.markerId}`))
    const stale = [...residueKeys].filter(k => !present.has(k))
    expect(stale).toEqual([])
  })

  it('credential and demo-control markers have no residue allowance at all', () => {
    const forbiddenEverywhere = new Set(
      MANIFEST.markers.filter(m => m.class === 'credential' || m.class === 'login-affordance').map(m => m.id),
    )
    expect(MANIFEST.narrowedResidue.filter(r => forbiddenEverywhere.has(r.markerId))).toEqual([])
    expect(allHits.filter(h => forbiddenEverywhere.has(h.markerId))).toEqual([])
  })
})
