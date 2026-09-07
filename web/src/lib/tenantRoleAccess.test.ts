/**
 * Round 2 UAT — a real garage tenant-member must be able to reach their garage.
 *
 * THE DEFECT THIS PINS. Round 2 signed in as `sn.garage.snz020359`, whose `tenant_users` row says
 * `role = 'mechanic'` on a `garage` tenant with a PUBLISHED public profile, and watched them get
 * redirected off `/garage` onto the Owner Dashboard — a screen about selling their own car. Every
 * garage API call answered 403.
 *
 * Nothing was missing from the authority. Sending `x-stakeholder-role: mechanic` with `x-tenant-id`
 * returned 200 on the queue, the members list and the profile. The browser simply never said which
 * tenant it was acting for, because public registration makes every self-registered garage employee
 * an `owner` and `/api/auth/me` reported only that platform role.
 *
 * These tests pin BOTH directions, because a change that lets a tenant role satisfy a route is
 * worthless if it also lets an unrelated one.
 */
import { describe, it, expect } from 'vitest'
import { evaluateRouteAccess } from './routeAccess'
import { getFeatureByRoute, resolveFeatureVisibility, type NavigationContext } from '@/config/featureRegistry'

const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined }

describe('a garage employee holds two true roles', () => {
  it('reaches the Workshop on the strength of the tenant role', () => {
    const decision = evaluateRouteAccess({
      ...base, route: '/garage', role: 'owner', tenantRole: 'mechanic',
    })
    expect(decision.kind, 'a real garage tenant-member must not be redirected off /garage')
      .toBe('render')
  })

  it('reaches every garage surface, not just the landing', () => {
    for (const route of ['/garage', '/garage/customers', '/garage/profile']) {
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', tenantRole: 'mechanic' }).kind, route)
        .toBe('render')
    }
  })

  it('is still redirected without the tenant role — the control case', () => {
    // If this ever renders, the test above proves nothing.
    const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', tenantRole: null })
    expect(decision.kind).toBe('redirect')
    expect(decision.kind === 'redirect' && decision.reason).toBe('role')
  })

  it('keeps the owner surfaces the platform role entitles them to', () => {
    for (const route of ['/dashboard', '/dashboard/service-requests', '/dashboard/service-history']) {
      expect(evaluateRouteAccess({ ...base, route, role: 'owner', tenantRole: 'mechanic' }).kind, route)
        .toBe('render')
    }
  })
})

describe('the tenant role widens nothing it should not', () => {
  it('does not open an admin surface to a garage mechanic', () => {
    const decision = evaluateRouteAccess({ ...base, route: '/admin', role: 'owner', tenantRole: 'mechanic' })
    expect(decision.kind).toBe('redirect')
  })

  it('a tenant label that is not a real role satisfies nothing', () => {
    // A tenant may record any label. Only a label that IS a platform role can match a feature's
    // role list, and an unknown one must fail closed rather than match everything.
    for (const label of ['workshop_lead', 'front_desk', '', 'MECHANIC ']) {
      const decision = evaluateRouteAccess({ ...base, route: '/garage', role: 'owner', tenantRole: label })
      expect(decision.kind, `"${label}" must not open the garage workspace`).toBe('redirect')
    }
  })

  it('an unauthenticated visitor is not admitted by a tenant role', () => {
    const decision = evaluateRouteAccess({
      ...base, route: '/garage', isAuthenticated: false, role: null, tenantRole: 'mechanic',
    })
    expect(decision.kind).toBe('redirect')
    expect(decision.kind === 'redirect' && decision.reason).toBe('auth')
  })
})

describe('what is reachable is also visible', () => {
  // Sidebar visibility and direct access must agree; a workspace you can reach and cannot see is
  // the same defect in the other direction.
  const ctx = (tenantRole: string | null): NavigationContext => ({
    isAuthenticated: true, role: 'owner', tenantRole: tenantRole as never, environment: 'test',
  })

  it('the garage items become visible to a garage tenant-member', () => {
    for (const route of ['/garage', '/garage/customers', '/garage/profile']) {
      const feature = getFeatureByRoute(route)
      expect(feature, `${route} must be registered`).toBeTruthy()
      expect(resolveFeatureVisibility(feature!, ctx('mechanic')).visible, route).toBe(true)
    }
  })

  it('and stay hidden from an ordinary owner', () => {
    for (const route of ['/garage', '/garage/customers', '/garage/profile']) {
      const feature = getFeatureByRoute(route)
      expect(resolveFeatureVisibility(feature!, ctx(null)).visible, route).toBe(false)
    }
  })
})

describe('every gate must be told about the tenant role', () => {
  /**
   * THE DEFECT THIS PINS. `DashboardLayout` was given the tenant role and `RegistryRouteBoundary`
   * was not. The result was an infinite `/garage` ↔ `/dashboard` loop, observed in a browser
   * oscillating hundreds of times: the boundary redirected a garage member to the owner dashboard
   * on their platform role, and the owner dashboard sent a confirmed garage member straight back.
   *
   * Four separate layers judged this person by the wrong one of their two true roles before this,
   * so the risk is not that the rule is wrong — it is that a NEW gate forgets to ask. A source-level
   * check is the only kind that notices a call site nobody thought to update.
   */
  it('no call site of evaluateRouteAccess omits tenantRole', async () => {
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
    const offenders: string[] = []
    for (const [path, raw] of Object.entries(sources)) {
      if (path.includes('.test.')) continue
      const text = String(raw)
      if (path.endsWith('routeAccess.ts')) continue // the definition itself
      let idx = text.indexOf('evaluateRouteAccess({')
      while (idx !== -1) {
        // The call object ends at the first `})` after it — enough to see its keys.
        const call = text.slice(idx, text.indexOf('})', idx) + 2)
        if (!call.includes('tenantRole')) offenders.push(`${path}: ${call.slice(0, 60).replace(/\s+/g, ' ')}…`)
        idx = text.indexOf('evaluateRouteAccess({', idx + 1)
      }
    }
    expect(offenders, `these gates would judge a garage member by their platform role alone:\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('the loop itself cannot form: both sides agree a garage member belongs on /garage', () => {
    // The owner dashboard sends a confirmed garage member to /garage. If the route gate disagrees,
    // the two bounce forever — so they must agree for the SAME user.
    const garageMember = { role: 'owner' as const, tenantRole: 'mechanic' }
    expect(evaluateRouteAccess({ ...base, route: '/garage', ...garageMember }).kind).toBe('render')
    // And an ordinary owner is not sent to /garage in the first place, so no loop there either.
    expect(evaluateRouteAccess({ ...base, route: '/dashboard', role: 'owner', tenantRole: null }).kind)
      .toBe('render')
  })
})
