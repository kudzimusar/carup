/**
 * CA-K3-01 tests A, B, C, D, E, M — IA, planes, the server Corporate access decision (CA-K3-AUTH-01) and
 * /admin continuity.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CORPORATE_DESTINATIONS, CORPORATE_PLANES, OPERATE_LINKS, destinationForPath } from '@/config/corporate/navigation'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { EMPTY_GRANT, canSeeDestination, fetchCorporateAccess, parseCorporateAccessGrant, resolveCorporateAccess, visibleDestinations, type CorporateServerDecision } from './access'
import { SERVER_GRANT } from '@/test/corporateAccessFixture'

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

describe('C · CA-K3-AUTH-01: admission is the SERVER decision; the browser only presents it', () => {
  it('a parsed server compatibility grant is the only way to render — and opens all ten destinations', () => {
    const grant = parseCorporateAccessGrant(SERVER_GRANT)
    expect(grant).not.toBeNull()
    const d = resolveCorporateAccess({ isBootstrapping: false, isAuthenticated: true, server: { status: 'granted', grant: grant! } })
    expect(d.kind).toBe('render')
    if (d.kind === 'render') {
      expect(d.grant.source).toBe('legacy_admin_compatibility_bridge')
      expect(visibleDestinations(d.grant)).toHaveLength(10)
      expect(d.grant.explanation).toMatch(/not a Corporate membership/)
    }
  })
  it('every non-granting server outcome refuses: pending waits, denied denies, failure is unavailable, 401 signs in', () => {
    const at = (server: CorporateServerDecision) => resolveCorporateAccess({ isBootstrapping: false, isAuthenticated: true, server }).kind
    expect(at({ status: 'pending' })).toBe('loading')
    expect(at({ status: 'denied' })).toBe('denied')
    expect(at({ status: 'unauthenticated' })).toBe('redirect')
    for (const reason of ['network', 'timeout', 'malformed', 'server'] as const) expect(at({ status: 'unavailable', reason })).toBe('unavailable')
  })
  it('sends an anonymous visitor to sign in, and waits while the session bootstraps', () => {
    expect(resolveCorporateAccess({ isBootstrapping: false, isAuthenticated: false, server: { status: 'pending' } })).toMatchObject({ kind: 'redirect', reason: 'auth' })
    expect(resolveCorporateAccess({ isBootstrapping: true, isAuthenticated: false, server: { status: 'pending' } }).kind).toBe('loading')
    // A stale grant cannot outlive the session: signed out → sign in, whatever the last answer was.
    const grant = parseCorporateAccessGrant(SERVER_GRANT)!
    expect(resolveCorporateAccess({ isBootstrapping: false, isAuthenticated: false, server: { status: 'granted', grant } }).kind).toBe('redirect')
  })
  it('the decision takes no role, tenant or feature state — passing them changes nothing', () => {
    const denied = { isBootstrapping: false, isAuthenticated: true, server: { status: 'denied' } as CorporateServerDecision }
    const withLocalAdmin = { ...denied, role: 'admin', activeTenant: { id: 't', type: 'garage', role: 'admin' }, effectiveStates: {} }
    expect(resolveCorporateAccess(withLocalAdmin as never).kind).toBe('denied')
  })
  it('an empty grant sees nothing', () => {
    for (const d of CORPORATE_DESTINATIONS) expect(canSeeDestination(EMPTY_GRANT, d)).toBe(false)
  })
  it('the server grant is read-only — nothing that manages, acts, approves, exports or publishes', () => {
    const grant = parseCorporateAccessGrant(SERVER_GRANT)!
    for (const c of grant.capabilities) expect(c).toMatch(/\.read$/)
    for (const c of grant.capabilities) expect(c).not.toMatch(/\.(manage|act|approve|export|publish|revoke|delegate|generate)$/)
  })
})

describe('C2 · a malformed, widened or mutation-shaped grant fails closed', () => {
  const withGrant = (patch: Record<string, unknown>) => ({ ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, ...patch } })
  it.each([
    ['null', null],
    ['a string', 'granted'],
    ['an array', [SERVER_GRANT]],
    ['no contract', { ...SERVER_GRANT, contract: undefined }],
    ['another contract', { ...SERVER_GRANT, contract: 'carup.corporate_access.v0' }],
    ['a denial body', { contract: SERVER_GRANT.contract, decision: 'denied', code: 'CORPORATE_ACCESS_DENIED' }],
    ['no grant', { ...SERVER_GRANT, grant: undefined }],
    ['another source', withGrant({ source: 'corporate_membership' })],
    ['not read-only', withGrant({ read_only: false })],
    ['read_only as a string', withGrant({ read_only: 'true' })],
    ['no explanation', withGrant({ explanation: '' })],
    ['capabilities not an array', withGrant({ capabilities: 'corporate.overview.read' })],
    ['no capabilities', withGrant({ capabilities: [] })],
    ['a wildcard', withGrant({ capabilities: ['corporate.*'] })],
    ['a wildcard read', withGrant({ capabilities: ['corporate.*.read'] })],
    ['a manage capability among reads', withGrant({ capabilities: [...SERVER_GRANT.grant.capabilities, 'corporate.finance.manage'] })],
    ['an export capability', withGrant({ capabilities: ['corporate.report.export'] })],
    ['an approve capability', withGrant({ capabilities: ['corporate.report.approve.read'] })],
    ['a non-string capability', withGrant({ capabilities: ['corporate.overview.read', 7] })],
    ['only capabilities no destination understands', withGrant({ capabilities: ['corporate.unknown.read'] })],
  ])('%s → no grant', (_label, payload) => {
    expect(parseCorporateAccessGrant(payload)).toBeNull()
  })
  it('a known subset narrows navigation to exactly the destinations it names', () => {
    const grant = parseCorporateAccessGrant(withGrant({ capabilities: ['corporate.overview.read', 'corporate.report.read', 'corporate.unknown.read'] }))!
    expect(visibleDestinations(grant).map((d) => d.id)).toEqual(['overview', 'reports'])
    expect(grant.capabilities.has('corporate.unknown.read')).toBe(false)
  })
})

describe('C3 · fetchCorporateAccess maps every server answer to a non-throwing decision', () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  const ask = (fetchImpl: unknown, signal?: AbortSignal) => fetchCorporateAccess({ baseUrl: 'https://api.test/api', sessionToken: 'tok', fetchImpl: fetchImpl as typeof fetch, signal })
  it('asks GET /api/corporate/access with the session token ONLY — no role, user or tenant header', async () => {
    const f = respond(200, SERVER_GRANT)
    expect((await ask(f)).status).toBe('granted')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/api/corporate/access')
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET')
    const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    expect(headers['x-session-token']).toBe('tok')
    for (const h of ['x-user-id', 'x-stakeholder-role', 'x-tenant-id']) expect(headers[h], h).toBeUndefined()
  })
  it('403 → denied; 401 → unauthenticated; 500 → unavailable; malformed 200 → unavailable', async () => {
    expect(await ask(respond(403, { decision: 'denied', code: 'CORPORATE_ACCESS_DENIED', error: 'Forbidden.' }))).toEqual({ status: 'denied' })
    expect((await ask(respond(401, { error: 'Unauthorized. Session is invalid or expired.' }))).status).toBe('unauthenticated')
    expect(await ask(respond(500, { error: 'boom' }))).toEqual({ status: 'unavailable', reason: 'server' })
    expect(await ask(respond(200, { ...SERVER_GRANT, grant: { ...SERVER_GRANT.grant, read_only: false } }))).toEqual({ status: 'unavailable', reason: 'malformed' })
    expect(await ask(respond(200, '<html>not json</html>'))).toEqual({ status: 'unavailable', reason: 'malformed' })
  })
  it('a network failure → unavailable; an aborted (timed-out) request → unavailable', async () => {
    expect(await ask(vi.fn(async () => { throw new TypeError('Failed to fetch') }))).toEqual({ status: 'unavailable', reason: 'network' })
    const controller = new AbortController()
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))
    const pending = ask(hang, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ status: 'unavailable', reason: 'timeout' })
  })
})

describe('D · navigation never uses a job title as permission, and access never reads a local role', () => {
  it('the access and navigation sources never read a title, position or name', () => {
    for (const f of ['src/lib/corporate/access.ts', 'src/config/corporate/navigation.ts', 'src/lib/corporate/useCorporateAccess.ts']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/\b(jobTitle|job_title|\.title\b|position|\.name\b)/)
    }
  })
  it('the access module, its hook and the shell gate never read a role, tenant or feature state, nor the /admin route decision', () => {
    for (const f of ['src/lib/corporate/access.ts', 'src/lib/corporate/useCorporateAccess.ts', 'src/components/corporate/CorporateLayout.tsx']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/\.role\b|activeTenant|active_tenant|tenant_role|effectiveStates|useFeatureEffectiveStates|evaluateRouteAccess|isAdmin|'admin'|"admin"/)
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
