import { describe, it, expect } from 'vitest'
import { evaluateRouteAccess } from '@/lib/routeAccess'

describe('U1 — an unregistered protected route must not loop an authenticated caller to login', () => {
  const base = { route: '/dealer/onboarding', isBootstrapping: false, effectiveStates: {} }

  it('renders for an AUTHENTICATED caller instead of bouncing to login', () => {
    const d = evaluateRouteAccess({ ...base, isAuthenticated: true, role: 'owner' as never, enforceAuth: true })
    expect(d.kind).toBe('render')
  })

  it('renders when the layout asked for lifecycle-only gating', () => {
    const d = evaluateRouteAccess({ ...base, isAuthenticated: false, role: null, enforceAuth: false })
    expect(d.kind).toBe('render')
  })

  it('still sends a genuinely ANONYMOUS caller to login with a safe returnTo', () => {
    const d = evaluateRouteAccess({ ...base, isAuthenticated: false, role: null, enforceAuth: true })
    expect(d).toMatchObject({ kind: 'redirect', reason: 'auth', to: '/login?returnTo=%2Fdealer%2Fonboarding' })
  })
})
