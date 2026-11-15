/**
 * TI-10 / TI-24 — every sign-out entry point goes through the ONE session mechanism, and none
 * leaves the page before server revocation was attempted.
 *
 * Found by a real-browser replay against a local full stack at PR 271's first head (9a037cc9):
 *  - DashboardLayout's sidebar "Sign Out" wiped all of localStorage and hard-navigated — no server
 *    call at all (the token kept answering 200) and the guest Sell draft's durable copy, saved cars
 *    and referral attribution were destroyed;
 *  - Navbar's "Sign Out" called logout() and immediately hard-navigated — the navigation aborted the
 *    CSRF prefetch, so the revocation POST was never sent (token still 200).
 * Unit tests that mock `apiRequest` could not see either: this is a wiring guard over the source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** Code only: comments may (and do) quote the forbidden patterns while explaining them. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: stripComments(readFileSync(path, 'utf8')) }))

describe('TI-10 sign-out wiring', () => {
  it('no application source nukes localStorage (it destroys the guest Sell draft and other continuity state)', () => {
    const offenders = files.filter((f) => /localStorage\.clear\(\)/.test(f.text)).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('no sign-out path starts a full-page navigation without awaiting logout() first', () => {
    const offenders = files
      .filter((f) => /(?<!await )\blogout\(\)[\s\S]{0,160}window\.location(\.href\s*=|\.assign\(|\.replace\()/.test(f.text))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it.each([
    ['components/layout/Navbar.tsx'],
    ['components/layout/DashboardLayout.tsx'],
  ])('%s signs out through `await logout()` and then navigates in-app', (path) => {
    const text = files.find((f) => f.path === path)?.text ?? ''
    const at = text.indexOf('data-testid="logout-button"')
    expect(at).toBeGreaterThan(-1)
    const handler = text.slice(Math.max(0, at - 900), at + 200)
    expect(handler).toMatch(/await logout\(\)\s*\n\s*navigate\('\/'\)/)
    expect(handler).not.toMatch(/window\.location/)
  })

  it('every component that offers a Sign Out control obtains logout from the auth context', () => {
    const signOutControls = files.filter((f) => /Sign Out/.test(f.text) && /onClick|onSignOut/.test(f.text) && !/WorkspaceShell\.tsx$/.test(f.path))
    expect(signOutControls.map((f) => f.path).sort()).toEqual([
      'components/layout/DashboardLayout.tsx',
      'components/layout/MobileNavDrawer.tsx',
      'components/layout/Navbar.tsx',
    ])
    for (const f of signOutControls) expect(f.text, f.path).toMatch(/\{[^}]*\blogout\b[^}]*\}\s*=\s*useAuth\(\)/)
  })
})
