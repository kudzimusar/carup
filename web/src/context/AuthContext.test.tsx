/**
 * TI-10 — web sign-out integrates server-side revocation of the presenting session.
 *
 * Proves that `logout()`:
 *   1. clears the local session (auth keys gone from storage, context unauthenticated);
 *   2. issues POST /api/auth/logout carrying the PRESENTING token (server-side target
 *      selection — the client does not name a session id);
 *   3. on revocation failure still clears the local session and surfaces an honest
 *      console error instead of claiming success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const apiRequestMock = vi.fn()

vi.mock('@/lib/apiClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/apiClient')>()
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  }
})

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  const api = useAuth()
  onReady(api)
  return null
}

function setup() {
  let api!: ReturnType<typeof useAuth>
  render(
    <AuthProvider>
      <Probe onReady={a => { api = a }} />
    </AuthProvider>,
  )
  return { getApi: () => api }
}

describe('TI-10 — logout revokes the presenting server session', () => {
  beforeEach(() => {
    localStorage.clear()
    apiRequestMock.mockReset()
  })

  it('logout clears local auth state and calls POST /api/auth/logout with the presenting token', async () => {
    const { getApi } = setup()
    act(() => {
      getApi().login(
        { id: 'u1', name: 'Tendai', email: 't@carup.test', role: 'owner' } as never,
        'presenting-token-123',
      )
    })
    apiRequestMock.mockResolvedValueOnce({ success: true })

    act(() => {
      getApi().logout()
    })

    // 1. Local session ended immediately.
    expect(getApi().isAuthenticated).toBe(false)
    expect(localStorage.getItem('carup_token')).toBeNull()
    expect(localStorage.getItem('carup_user')).toBeNull()

    // 2. Server revocation attempted with the presenting credential only.
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1))
    const call = apiRequestMock.mock.calls[0][0] as { path: string; options: { method: string }; authHeaders: Record<string, string> }
    expect(call.path).toBe('/auth/logout')
    expect(call.options.method).toBe('POST')
    expect(call.authHeaders['x-session-token']).toBe('presenting-token-123')
    expect(JSON.stringify(call)).not.toContain('sessionId')
  })

  it('a revocation failure still clears the local session and is surfaced honestly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getApi } = setup()
    act(() => {
      getApi().login(
        { id: 'u1', name: 'Tendai', email: 't@carup.test', role: 'owner' } as never,
        'presenting-token-123',
      )
    })
    apiRequestMock.mockRejectedValueOnce(new Error('backend unavailable'))

    act(() => {
      getApi().logout()
    })

    // Local session is gone regardless.
    expect(getApi().isAuthenticated).toBe(false)
    expect(localStorage.getItem('carup_token')).toBeNull()

    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    const message = String(consoleError.mock.calls[0]?.[0])
    expect(message).toMatch(/revocation failed/i)
    expect(message).toMatch(/may remain valid/i)
    consoleError.mockRestore()
  })

  it('logout without a token performs no server call (guests have nothing to revoke)', () => {
    const { getApi } = setup()
    act(() => {
      getApi().logout()
    })
    expect(apiRequestMock).not.toHaveBeenCalled()
  })
})
