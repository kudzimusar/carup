import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storeAuth: vi.fn(),
  validateStoredSession: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  setNavAnalyticsAuthProvider: vi.fn(),
}))

vi.mock('@/lib/authSession', () => ({
  readStoredAuth: () => ({
    user: { id: 'u-1', name: 'Stored User', email: 'u@example.test', role: 'admin' },
    token: 'session-token',
  }),
  storeAuth: mocks.storeAuth,
  clearStoredAuth: vi.fn(),
  validateStoredSession: mocks.validateStoredSession,
}))

vi.mock('@/lib/apiClient', () => ({
  apiRequest: vi.fn(),
  resolveApiBaseUrl: () => 'http://api.test',
  setUnauthorizedHandler: mocks.setUnauthorizedHandler,
  SessionExpiredError: class SessionExpiredError extends Error {},
}))

vi.mock('@/lib/navigationAnalytics', () => ({
  setNavAnalyticsAuthProvider: mocks.setNavAnalyticsAuthProvider,
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { user, loading } = useAuth()
  return <div data-testid="truth">{loading ? 'loading' : `${user?.role}:${user?.active_tenant_id || 'none'}`}</div>
}

describe('AuthProvider session truth', () => {
  it('replaces a stale or tampered stored role with /auth/me truth', async () => {
    mocks.validateStoredSession.mockResolvedValueOnce({
      id: 'u-1',
      name: 'Authoritative User',
      email: 'u@example.test',
      role: 'owner',
      active_tenant_id: null,
    })

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('truth').textContent).toBe('owner:none'))
    expect(mocks.storeAuth).toHaveBeenCalledWith(
      localStorage,
      expect.objectContaining({ role: 'owner' }),
      'session-token',
    )
  })
})
