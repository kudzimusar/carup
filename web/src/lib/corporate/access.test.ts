/**
 * CA-K3-01 tests A, B, C, D, E, M — IA, planes, the compatibility bridge and /admin continuity.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CORPORATE_DESTINATIONS, CORPORATE_PLANES, OPERATE_LINKS, destinationForPath } from '@/config/corporate/navigation'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { EMPTY_GRANT, canSeeDestination, resolveCorporateAccess, visibleDestinations } from './access'

const signedIn = (role: string, extra: Record<string, unknown> = {}) => ({ isBootstrapping: false, isAuthenticated: true, role, ...extra })

describe('A · the ten canonical destinations, in canonical order', () => {
  it('exactly ten, in the binding order, with the binding names and routes', () => {
    expect(CORPORATE_DESTINATIONS.map((d) => d.label)).toEqual([
      'Corporate Overview', 'Business Units', 'Finance', 'Customers & Growth', 'Operations',
      'Trust / Risk / Compliance', 'Data & Intelligence', 'People & Access', 'Reports', 'Platform',
    ])
    expect(CORPORATE_DESTINATIONS.map((d) => d.route)).toEqual([
      '/corporate', '/corporate/business-units', '/corporate/finance', '/corporate/growth', '/corporate/operations',
      '/corporate/trust-risk', '/corporate/data-intelligence', '/corporate/people-access', '/corporate/reports', '/corporate/platform',
    ])
  })
  it('every route resolves to its own destination', () => {
    for (const d of CORPORATE_DESTINATIONS) expect(destinationForPath(d.route)?.id).toBe(d.id)
  })
})

describe('B · each destination has its management plane', () => {
  it('matches the CA-K3-01 §3 mapping', () => {
    const byPlane = (p: string) => CORPORATE_DESTINATIONS.filter((d) => d.plane === p).map((d) => d.label)
    expect(byPlane('corporate_intelligence')).toEqual(['Corporate Overview', 'Business Units', 'Finance', 'Customers & Growth', 'Data & Intelligence', 'Reports'])
    expect(byPlane('business_operations')).toEqual(['Operations', 'Trust / Risk / Compliance', 'People & Access'])
    expect(byPlane('platform_security')).toEqual(['Platform'])
    expect(Object.values(CORPORATE_PLANES).map((p) => p.label)).toEqual(['Corporate Intelligence', 'Business Operations', 'Platform & Security'])
  })
})

describe('C · ordinary users cannot reach Corporate Admin (fail closed)', () => {
  it('admits a platform administrator through the /admin decision only', () => {
    const d = resolveCorporateAccess(signedIn('admin'))
    expect(d.kind).toBe('render')
    if (d.kind === 'render') {
      expect(d.grant.source).toBe('legacy_admin_compatibility_bridge')
      expect(visibleDestinations(d.grant)).toHaveLength(10)
    }
  })
  it.each(['owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'buyer', 'reviewer'])('refuses %s', (role) => {
    const d = resolveCorporateAccess(signedIn(role))
    expect(d.kind).toBe('redirect')
  })
  it('sends an anonymous visitor to sign in, and waits while the session bootstraps', () => {
    expect(resolveCorporateAccess({ isBootstrapping: false, isAuthenticated: false, role: null })).toMatchObject({ kind: 'redirect', reason: 'auth' })
    expect(resolveCorporateAccess({ isBootstrapping: true, isAuthenticated: false, role: null }).kind).toBe('loading')
  })
  it('an empty grant sees nothing', () => {
    for (const d of CORPORATE_DESTINATIONS) expect(canSeeDestination(EMPTY_GRANT, d)).toBe(false)
  })
  it('the bridge grants read-only capabilities — nothing that manages, acts, approves, exports or publishes', () => {
    const d = resolveCorporateAccess(signedIn('admin'))
    if (d.kind !== 'render') throw new Error('expected render')
    for (const c of d.grant.capabilities) expect(c).not.toMatch(/\.(manage|act|approve|export|publish|revoke|delegate|generate)$/)
  })
  it('a tenant role inside a selected organisation does not open Corporate Admin', () => {
    const d = resolveCorporateAccess(signedIn('owner', { activeTenant: { id: 't1', type: 'garage', role: 'admin' } }))
    expect(d.kind).toBe('redirect')
  })
})

describe('D · navigation never uses a job title as permission', () => {
  it('a title has no effect: same decision with or without it', () => {
    const withTitle = resolveCorporateAccess({ ...signedIn('owner'), title: 'CEO', jobTitle: 'Chief Financial Officer' } as never)
    expect(withTitle.kind).toBe('redirect')
    const adminWithTitle = resolveCorporateAccess({ ...signedIn('admin'), title: 'Analyst' } as never)
    const adminPlain = resolveCorporateAccess(signedIn('admin'))
    if (adminWithTitle.kind !== 'render' || adminPlain.kind !== 'render') throw new Error('expected render')
    expect([...adminWithTitle.grant.capabilities].sort()).toEqual([...adminPlain.grant.capabilities].sort())
  })
  it('the access and navigation sources never read a title, position or name', () => {
    for (const f of ['src/lib/corporate/access.ts', 'src/config/corporate/navigation.ts']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/\b(jobTitle|job_title|\.title\b|position|\.name\b)/)
    }
  })
})

describe('E · existing /admin routes remain available', () => {
  const ADMIN_ROUTES = ['/admin', '/admin/users', '/admin/communications', '/admin/features', '/admin/moderation', '/admin/evidence', '/admin/verification', '/admin/fraud-queue', '/admin/dealer-compliance', '/admin/garage-applications', '/admin/referrals', '/admin/ai']
  it('every one is still registered in App.tsx', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    for (const r of ADMIN_ROUTES) expect(app, r).toContain(`path="${r}"`)
    expect(app).toContain('<DashboardLayout role="admin" />')
  })
  it('and still admits an administrator', () => {
    for (const r of ADMIN_ROUTES) {
      const d = evaluateRouteAccess({ route: r, isBootstrapping: false, isAuthenticated: true, role: 'admin' })
      expect(['render', 'render-beta'], r).toContain(d.kind)
    }
  })
})

describe('M · current operational queue links are explicit Operate destinations', () => {
  it('every link opens an existing /admin surface, names what it opens, and declares its plane', () => {
    const all = Object.values(OPERATE_LINKS).flat()
    expect(all.length).toBeGreaterThan(10)
    for (const l of all) {
      expect(l.route.startsWith('/admin/'), l.route).toBe(true)
      expect(l.label, l.label).toMatch(/^Open /)
      expect(l.label, l.label).not.toMatch(/KPI|details|insight|analytics/i)
      expect(['business_operations', 'platform_security']).toContain(l.plane)
    }
  })
  it('Corporate Intelligence destinations hold no queue links of their own plane (cross-plane only)', () => {
    for (const d of CORPORATE_DESTINATIONS.filter((x) => x.plane === 'corporate_intelligence')) {
      for (const l of OPERATE_LINKS[d.id]) expect(l.plane).not.toBe('corporate_intelligence')
    }
  })
})
