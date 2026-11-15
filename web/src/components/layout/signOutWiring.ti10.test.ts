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
 *
 * The entry-point inventory is closed: a component that starts taking `logout` from the auth
 * context, or an entry point that stops awaiting it (`logout()`, `void logout()`,
 * `onClick={logout}`, `logout().then(…)`), fails here.
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

/** The provider that DEFINES logout; every other file may only consume it. */
const AUTH_PROVIDER = 'context/AuthContext.tsx'

/** Every sign-out entry point and how many sign-out handlers it owns. */
const ENTRY_POINTS: Record<string, number> = {
  'components/layout/Navbar.tsx': 1,
  'components/layout/DashboardLayout.tsx': 1,
  'components/layout/MobileNavDrawer.tsx': 1,
  'components/shell/UnifiedRouteShell.tsx': 2, // personal + dealer unified workspace shells
  'components/dealer/DealerReviewerLayout.tsx': 1,
}

const USE_AUTH_LOGOUT = /\{[^}]*\blogout\b[^}]*\}\s*=\s*useAuth\(\)/

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

  it('the sign-out entry-point inventory is closed: exactly these components take logout from the auth context', () => {
    const consumers = files.filter((f) => USE_AUTH_LOGOUT.test(f.text)).map((f) => f.path).sort()
    expect(consumers).toEqual(Object.keys(ENTRY_POINTS).sort())
  })

  it('outside the provider, logout is only ever destructured from useAuth() or AWAITED — never fired and forgotten', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (f.path === AUTH_PROVIDER) continue
      const code = f.text.replace(new RegExp(USE_AUTH_LOGOUT.source, 'g'), '')
      // The identifier only — not string content such as data-testid="logout-button" or '/auth/logout'.
      for (const m of code.matchAll(/(?<![-/'"\w])logout\b(?![-'"])/g)) {
        const at = m.index ?? 0
        const awaitedCall = /\bawait\s+$/.test(code.slice(Math.max(0, at - 12), at)) && code.startsWith('logout()', at)
        if (!awaitedCall) offenders.push(`${f.path}: …${code.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ')}…`)
      }
    }
    expect(offenders).toEqual([])
  })

  it.each(Object.entries(ENTRY_POINTS))(
    '%s awaits logout() and only then navigates in-app (×%i)',
    (path, handlers) => {
      const text = files.find((f) => f.path === path)?.text ?? ''
      const awaited = [...text.matchAll(/await logout\(\)/g)]
      expect(awaited, `${path} must await logout() in each of its ${handlers} sign-out handler(s)`).toHaveLength(handlers)
      for (const m of awaited) {
        const after = text.slice(m.index ?? 0, (m.index ?? 0) + 200)
        // `close()` (MobileNavDrawer) only dismisses the drawer; the in-app navigation must follow the await.
        expect(after, path).toMatch(/^await logout\(\)\s*\n\s*(?:close\(\)\s*\n\s*)?navigate\('\/'\)/)
        expect(after, path).not.toMatch(/window\.location/)
      }
    },
  )

  it('every component that renders a visible Sign Out control is a known entry point (or the shell that delegates to one)', () => {
    const rendersSignOut = files
      .filter((f) => /(?:>|\/>)[^<>{}]*\bSign[ -]?out\s*<\//i.test(f.text))
      .map((f) => f.path)
      .sort()
    // WorkspaceShell renders the control for both unified shells but owns no logout: it calls the
    // `onSignOut` prop, which only UnifiedRouteShell supplies (asserted below).
    expect(rendersSignOut).toEqual([
      'components/dealer/DealerReviewerLayout.tsx',
      'components/layout/DashboardLayout.tsx',
      'components/layout/MobileNavDrawer.tsx',
      'components/layout/Navbar.tsx',
      'components/shell/WorkspaceShell.tsx',
    ])

    const workspaceShell = files.find((f) => f.path === 'components/shell/WorkspaceShell.tsx')?.text ?? ''
    expect(workspaceShell).not.toMatch(/\blogout\b/)
    const suppliers = files.filter((f) => /<WorkspaceShell\b[\s\S]*?onSignOut=/.test(f.text)).map((f) => f.path)
    expect(suppliers).toEqual(['components/shell/UnifiedRouteShell.tsx'])
  })
})
