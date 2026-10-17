/**
 * Round 2 UAT — a real garage tenant-member must be able to reach their garage (PR #197, ported by
 * OC-5D onto the explicit, verified active-tenant context).
 *
 * THE DEFECT THIS PINS. Round 2 signed in as a garage employee whose `tenant_users` row says
 * `role = 'mechanic'` on a `garage` tenant, and watched them get redirected off `/garage` onto the
 * Owner Dashboard — public registration makes every self-registered garage employee an `owner`.
 *
 * #197 answered by letting the TENANT role satisfy the PLATFORM role list (F4): `roles.includes(
 * tenantRole)`. That also let a garage's own admin satisfy every `roles: ['admin']` feature. OC-5D keeps
 * the person reaching their garage and closes F4: a garage feature declares a TENANT SCOPE
 * (`tenantTypes` / `tenantRoles`), satisfied only by the organisation the person SELECTED and the server
 * verified (`AuthUser.active_tenant`); a platform role satisfies `roles` and nothing else.
 *
 * These tests pin BOTH directions, because a change that lets a tenant role satisfy a route is
 * worthless if it also lets an unrelated one.
 */
import { describe, it, expect } from 'vitest'
import { evaluateRouteAccess } from './routeAccess'
import { activeTenantScopeOf, getFeatureByRoute, resolveFeatureVisibility, type ActiveTenantScope, type NavigationContext } from '@/config/featureRegistry'

const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined }
const garage = (role: string): ActiveTenantScope => ({ type: 'garage', role })

describe('a garage employee holds two true roles — in two namespaces', () => {
  it('reaches the Workshop on the strength of their SELECTED garage', () => {
    const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', activeTenant: garage('mechanic') })
    expect(decision.kind, 'a real garage tenant-member must not be redirected off /garage').toBe('render')
  })

  it('reaches the workspace surfaces their role inside the garage allows — and not the admin\'s', () => {
    for (const route of ['/garage', '/garage/customers']) {
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', activeTenant: garage('mechanic') }).kind, route).toBe('render')
    }
    // The public profile is an ADMIN's (the backend's PUT/publish gates say so); a mechanic is not sent there.
    expect(evaluateRouteAccess({ ...base, route: '/garage/profile', role: 'owner', activeTenant: garage('mechanic') }).kind).toBe('redirect')
    expect(evaluateRouteAccess({ ...base, route: '/garage/profile', role: 'owner', activeTenant: garage('admin') }).kind).toBe('render')
  })

  it('is still redirected without a selected garage — the control case', () => {
    // If this ever renders, the tests above prove nothing.
    const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', activeTenant: null })
    expect(decision.kind).toBe('redirect')
    expect(decision.kind === 'redirect' && decision.reason).toBe('role')
  })

  it('keeps the owner surfaces the platform role entitles them to', () => {
    for (const route of ['/dashboard', '/dashboard/service-requests', '/dashboard/service-history']) {
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', activeTenant: garage('mechanic') }).kind, route).toBe('render')
    }
  })
})

describe('the tenant scope widens nothing it should not', () => {
  it('a garage\'s own ADMIN is not a CarUp administrator (F4)', () => {
    const decision = evaluateRouteAccess({ ...base, route: '/admin', role: 'owner', activeTenant: garage('admin') })
    expect(decision.kind).toBe('redirect')
  })

  it('a PLATFORM mechanic with no garage selected does not reach a garage workspace', () => {
    expect(evaluateRouteAccess({ ...base, route: '/garage', role: 'mechanic', activeTenant: null }).kind).toBe('redirect')
  })

  it('a role inside the WRONG kind of organisation opens nothing', () => {
    const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', activeTenant: { type: 'dealership', role: 'mechanic' } })
    expect(decision.kind).toBe('redirect')
  })

  it('a tenant label that is not in the scope satisfies nothing', () => {
    for (const label of ['member', 'workshop_lead', 'front_desk', '', 'MECHANIC ']) {
      const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', activeTenant: garage(label) })
      expect(decision.kind, `"${label}" must not open the garage workspace`).toBe('redirect')
    }
  })

  it('an unauthenticated visitor is not admitted by a tenant scope', () => {
    const decision = evaluateRouteAccess({
      ...base, route: '/garage', isAuthenticated: false, role: null, activeTenant: garage('mechanic'),
    })
    expect(decision.kind).toBe('redirect')
    expect(decision.kind === 'redirect' && decision.reason).toBe('auth')
  })
})

describe('what is reachable is also visible', () => {
  // Sidebar visibility and direct access must agree; a workspace you can reach and cannot see is
  // the same defect in the other direction.
  const ctx = (activeTenant: ActiveTenantScope | null): NavigationContext => ({
    isAuthenticated: true, role: 'owner', activeTenant, environment: 'test',
  })

  it('the garage items become visible to a garage member, by their role inside it', () => {
    for (const route of ['/garage', '/garage/customers']) {
      const feature = getFeatureByRoute(route)
      expect(feature, `${route} must be registered`).toBeTruthy()
      expect(resolveFeatureVisibility(feature!, ctx(garage('mechanic'))).visible, route).toBe(true)
    }
    expect(resolveFeatureVisibility(getFeatureByRoute('/garage/profile')!, ctx(garage('mechanic'))).visible).toBe(false)
    expect(resolveFeatureVisibility(getFeatureByRoute('/garage/profile')!, ctx(garage('admin'))).visible).toBe(true)
  })

  it('and stay hidden from an ordinary owner', () => {
    for (const route of ['/garage', '/garage/customers', '/garage/profile']) {
      const feature = getFeatureByRoute(route)
      expect(resolveFeatureVisibility(feature!, ctx(null)).visible, route).toBe(false)
    }
  })
})

describe('every gate must be told about the selected organisation', () => {
  /**
   * THE DEFECT THIS PINS. `DashboardLayout` was given the tenant context and `RegistryRouteBoundary`
   * was not — an infinite `/garage` ↔ `/dashboard` loop in a real browser. The risk is not that the
   * rule is wrong; it is that a NEW gate forgets to ask. A source-level check notices the call site.
   */
  it('no call site of evaluateRouteAccess, getDashboardItemsFor or resolveOperatingHome omits activeTenant', async () => {
    // The route gate, the sidebar/drawer items and the operating home are three readers of one rule;
    // each forgetting the organisation is the same loop, a sidebar missing the workspace the person
    // was just admitted to, or a "home" that refuses them.
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
    const offenders: string[] = []
    let calls = 0
    for (const [path, raw] of Object.entries(sources)) {
      if (path.includes('.test.')) continue
      const text = String(raw)
      for (const fn of ['evaluateRouteAccess({', 'getDashboardItemsFor({', 'resolveOperatingHome({']) {
        let idx = text.indexOf(fn)
        while (idx !== -1) {
          calls += 1
          const call = text.slice(idx, text.indexOf('})', idx) + 2)
          if (!call.includes('activeTenant')) offenders.push(`${path}: ${call.slice(0, 60).replace(/\s+/g, ' ')}…`)
          idx = text.indexOf(fn, idx + 1)
        }
      }
    }
    expect(calls, 'the scan found no call sites — it is not looking where the gates are').toBeGreaterThanOrEqual(6)
    expect(offenders, `these gates would judge a garage member by their platform role alone:\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('the scope is read from the server-verified active organisation, and from nothing else', () => {
    expect(activeTenantScopeOf(null)).toBeNull()
    expect(activeTenantScopeOf({ active_tenant: null })).toBeNull()
    // `tenant_role` is display-only: on its own it is not an organisation the session acts for.
    expect(activeTenantScopeOf({ active_tenant: null, tenant_role: 'mechanic' } as never)).toBeNull()
    expect(activeTenantScopeOf({ active_tenant: { type: 'dealership', role: 'mechanic' } }))
      .toEqual({ type: 'dealership', role: 'mechanic' })
    expect(activeTenantScopeOf({ active_tenant: { type: 'garage', role: 'admin' } }))
      .toEqual({ type: 'garage', role: 'admin' })
  })

  it('no source reads the retired tenant-role-as-platform-role fields', () => {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, raw]) => /active_tenant_role|isGarageSideRoute/.test(String(raw)))
      .map(([path]) => path)
    expect(offenders, 'the role-header swap and #197\'s active_tenant_role are retired (OC-5D)').toEqual([])
  })

  it('the loop itself cannot form: both sides agree a garage member belongs on /garage', () => {
    const garageMember = { role: 'owner' as const, activeTenant: garage('mechanic') }
    expect(evaluateRouteAccess({ ...base, route: '/garage', ...garageMember }).kind).toBe('render')
    expect(evaluateRouteAccess({ ...base, route: '/dashboard', role: 'owner', activeTenant: null }).kind).toBe('render')
  })
})
