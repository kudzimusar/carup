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
