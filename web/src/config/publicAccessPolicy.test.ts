/**
 * PC01-J-R1 §5 — the router agrees with the guest-access policy, route by route.
 *
 * Public surfaces render inside MainLayout (route boundary with auth NOT enforced); the private
 * destinations render inside a layout that enforces auth. Each declared route is evaluated the way its
 * layout evaluates it, for a guest, and must land on its declared class.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { evaluateRouteAccess } from '../lib/routeAccess'
import { matchRoutePattern } from './featureRegistry'
import { PUBLIC_ACCESS_POLICY } from './publicAccessPolicy'

const APP = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf-8')
const APP_ROUTES = [...APP.matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/g)].map(m => m[1])
const sample = (route: string) => route.replace(':id', 'JTDKARFP0H3000731').replace(':slug', 'example-garage')

const guest = (route: string, enforceAuth: boolean) =>
  evaluateRouteAccess({ route: sample(route), isAuthenticated: false, role: null, isBootstrapping: false, enforceAuth })

describe('the guest-access policy (PC01-J-R1 §5)', () => {
  it('names the fourteen public surfaces the brief lists', () => {
    const names = PUBLIC_ACCESS_POLICY.filter(p => p.access === 'PUBLIC' || p.access === 'PUBLIC_READ_AUTH_ACTION').map(p => p.surface)
    expect(names).toEqual([
      'Home', 'Marketplace', 'Vehicle details', 'Vehicle Passport', 'Verify', 'Dealers', 'Garages / Services',
      'Parts', 'Trust & Safety', 'Help', 'Contact', 'Pricing', 'Diaspora info', 'Sell entry',
    ])
  })

  it('every declared route is a route the router declares', () => {
    const missing = PUBLIC_ACCESS_POLICY.flatMap(p => p.routes).filter(r => !APP_ROUTES.some(d => matchRoutePattern(d, sample(r))))
    expect(missing).toEqual([])
  })

  it('a guest can open every PUBLIC and PUBLIC_READ_AUTH_ACTION surface — browsing never needs an account', () => {
    for (const policy of PUBLIC_ACCESS_POLICY.filter(p => p.access === 'PUBLIC' || p.access === 'PUBLIC_READ_AUTH_ACTION')) {
      for (const route of policy.routes) expect(guest(route, false).kind, `${policy.surface} ${route}`).toMatch(/^render/)
    }
  })

  it('a guest is sent to Sign In — with the destination kept — for every private destination', () => {
    for (const policy of PUBLIC_ACCESS_POLICY.filter(p => p.access === 'AUTH_REQUIRED' || p.access === 'ROLE_REQUIRED')) {
      for (const route of policy.routes) {
        const decision = guest(route, true)
        expect(decision.kind, `${policy.surface} ${route}`).toBe('redirect')
        if (decision.kind === 'redirect') {
          expect(decision.reason).toBe('auth')
          expect(decision.to).toBe(`/login?returnTo=${encodeURIComponent(route)}`)
        }
      }
    }
  })

  it('a PLANNED surface renders its planned state, never the unfinished page', () => {
    for (const policy of PUBLIC_ACCESS_POLICY.filter(p => p.access === 'PLANNED')) {
      for (const route of policy.routes) expect(guest(route, false).kind, `${policy.surface} ${route}`).toBe('planned')
    }
  })

  it('every PUBLIC_READ_AUTH_ACTION surface says where an account is asked for, or records why not', () => {
    for (const policy of PUBLIC_ACCESS_POLICY.filter(p => p.access === 'PUBLIC_READ_AUTH_ACTION')) {
      expect(policy.accountAskedAt.length > 0 || Boolean(policy.deviation), policy.surface).toBe(true)
    }
  })

  it('the Trade OS workspace sends a guest to Sign In with the destination kept (not router state Login ignores)', () => {
    const layout = fs.readFileSync(path.resolve(__dirname, '../components/layout/TradeOSWorkspaceLayout.tsx'), 'utf-8')
    expect(layout).toMatch(/<Navigate to=\{buildLoginRedirect\(`\$\{location\.pathname\}\$\{location\.search\}`\)\}/)
  })
})
