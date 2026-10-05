import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { UserRole, AuthUser } from '@shared/types'
import { apiRequest, resolveApiBaseUrl, setUnauthorizedHandler, setTenantContextHandler, SessionExpiredError, type AuthHeaders } from '@/lib/apiClient'
import { readStoredAuth, storeAuth, clearStoredAuth, validateStoredSession, withServerTenantContext } from '@/lib/authSession'
import { setNavAnalyticsAuthProvider } from '@/lib/navigationAnalytics'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
  loading: boolean
  login: (userData: AuthUser, token: string) => void
  logout: () => void
  switchRole: (role: UserRole, tenantId?: string) => Promise<void>
  /**
   * OC-5D — choose the organisation this session acts for (null = act for yourself). The server
   * verifies it and records it on the session; nothing is ever selected for the person.
   */
  selectActiveTenant: (tenantId: string | null) => Promise<void>
  /** Re-read the session's organisation and memberships from the server. */
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,
  login: () => {},
  logout: () => {},
  switchRole: async () => {},
  selectActiveTenant: async () => {},
  refreshSession: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage SYNCHRONOUSLY (lazy init) so the token exists on the very first
  // render. Child page effects run before AuthProvider's boot effect, so without this they fire
  // protected requests with no token → 401 → clearAuth → spurious logout on hard reload / deep link.
  const [user, setUser] = useState<AuthUser | null>(
    () => (typeof window !== 'undefined' ? readStoredAuth(localStorage)?.user ?? null : null),
  )
  const [token, setToken] = useState<string | null>(
    () => (typeof window !== 'undefined' ? readStoredAuth(localStorage)?.token ?? null : null),
  )
  const [loading, setLoading] = useState(true)
  // The latest identity, for callbacks invoked from outside React (the API client's handlers).
  const userRef = useRef(user)
  const tokenRef = useRef(token)
  useEffect(() => { userRef.current = user; tokenRef.current = token }, [user, token])
  const refreshInFlight = useRef<Promise<void> | null>(null)

  // Clear ALL client auth state + storage. Used on logout and whenever the backend reports the
  // session is invalid/expired.
  const clearAuth = useCallback(() => {
    setUser(null)
    setToken(null)
    clearStoredAuth(localStorage)
  }, [])

  // Any API call that fails with an invalid session (401) clears auth here, so the app stops
  // trusting a stale token and protected routes redirect to /login.
  useEffect(() => {
    setUnauthorizedHandler(clearAuth)
    return () => setUnauthorizedHandler(null)
  }, [clearAuth])

  // Let the navigation analytics client read the CURRENT identity headers so its CSRF token (and
  // the analytics POST) is bound to the signed-in user/session — matching how apiRequest binds the
  // token. Mirrors the setUnauthorizedHandler wiring above. Undefined values are filtered so a
  // guest sends no identity headers (and gets a guest-bound token).
  useEffect(() => {
    setNavAnalyticsAuthProvider(() => {
      const headers: AuthHeaders = {
        'x-session-token': token ?? undefined,
        'x-user-id': user?.id,
        'x-stakeholder-role': user?.role,
        'x-tenant-id': user?.active_tenant_id ?? undefined,
      }
      return Object.fromEntries(
        Object.entries(headers).filter(([, v]) => v !== undefined),
      ) as AuthHeaders
    })
    return () => setNavAnalyticsAuthProvider(null)
  }, [token, user?.id, user?.role, user?.active_tenant_id])

  // On boot, restore the stored session optimistically, then VALIDATE the token against the
  // backend. Only an explicit "session invalid/expired" (401) clears auth; transient/ambiguous
  // failures keep the session (fail open) so a network blip never logs the user out.
  useEffect(() => {
    const stored = readStoredAuth(localStorage)
    if (!stored) {
      setLoading(false)
      return
    }

    setUser(stored.user)
    setToken(stored.token)

    let cancelled = false
    validateStoredSession({ baseUrl: API_BASE, token: stored.token, userId: stored.user?.id })
      .then((serverUser) => {
        // OC-5D: adopt the server's view of the session's organisation. A user stored by an older
        // build may carry the organisation login used to guess; the server's answer replaces it.
        if (cancelled || !serverUser) return
        if (readStoredAuth(localStorage)?.token !== stored.token) return // a newer sign-in won
        // The server's answer wins for the whole identity (PR #197's adoption: a renamed account or a
        // changed role must not outlive the session), and its organisation REPLACES the stored one.
        const next = withServerTenantContext({ ...stored.user, ...serverUser }, serverUser)
        setUser(next)
        storeAuth(localStorage, next, stored.token)
      })
      .catch((err: unknown) => {
        if (!cancelled && err instanceof SessionExpiredError) clearAuth()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [clearAuth])

  const login = useCallback((userData: AuthUser, sessionToken: string) => {
    setUser(userData)
    setToken(sessionToken)
    storeAuth(localStorage, userData, sessionToken)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
  }, [clearAuth])

  const switchRole = useCallback(async (role: UserRole, tenantId?: string) => {
    if (!user || !token) return
    try {
      // Routed through apiRequest so it carries a correctly-bound CSRF token and so an invalid
      // session clears auth via the global handler instead of silently failing.
      const data = await apiRequest<{ user?: Partial<AuthUser>; token?: string }>({
        baseUrl: API_BASE,
        path: '/auth/switch-role',
        options: { method: 'POST', body: JSON.stringify({ userId: user.id, role, tenantId }) },
        authHeaders: {
          'x-session-token': token,
          'x-user-id': user.id,
          ...(user.role ? { 'x-stakeholder-role': user.role } : {}),
        },
      })
      // Update user + token atomically to avoid a stale token/user mismatch.
      const updated = { ...user, ...(data.user ?? {}) }
      const nextToken = data.token ?? token
      setUser(updated)
      setToken(nextToken)
      storeAuth(localStorage, updated, nextToken)
    } catch (e) {
      if (e instanceof SessionExpiredError) clearAuth()
      else console.error('Role switch failed', e)
      // Re-throw so callers can skip post-switch navigation and surface accessible
      // feedback instead of silently routing into a role that was never switched.
      throw e
    }
  }, [user, token, clearAuth])

  const refreshSession = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current
    const currentToken = tokenRef.current
    const currentUser = userRef.current
    if (!currentToken || !currentUser) return
    const run = (async () => {
      try {
        const serverUser = await validateStoredSession({ baseUrl: API_BASE, token: currentToken, userId: currentUser.id })
        if (tokenRef.current !== currentToken || !userRef.current) return
        const next = withServerTenantContext({ ...userRef.current, ...serverUser }, serverUser)
        setUser(next)
        storeAuth(localStorage, next, currentToken)
      } catch (e) {
        if (e instanceof SessionExpiredError) clearAuth()
      } finally {
        refreshInFlight.current = null
      }
    })()
    refreshInFlight.current = run
    return run
  }, [clearAuth])

  // A request refused because the session's organisation changed under it: re-read the session.
  useEffect(() => {
    setTenantContextHandler(() => { void refreshSession() })
    return () => setTenantContextHandler(null)
  }, [refreshSession])

  const selectActiveTenant = useCallback(async (tenantId: string | null) => {
    const currentToken = tokenRef.current
    const currentUser = userRef.current
    if (!currentToken || !currentUser) return
    try {
      const data = await apiRequest<{ user?: Partial<AuthUser> }>({
        baseUrl: API_BASE,
        path: '/auth/active-tenant',
        options: { method: 'PUT', body: JSON.stringify({ tenantId }) },
        // Deliberately no x-tenant-id: this call CHANGES the organisation, it does not act for one.
        authHeaders: { 'x-session-token': currentToken, 'x-user-id': currentUser.id },
      })
      if (tokenRef.current !== currentToken || !userRef.current) return
      const next = withServerTenantContext(userRef.current, data.user ?? { active_tenant_id: null })
      setUser(next)
      storeAuth(localStorage, next, currentToken)
    } catch (e) {
      if (e instanceof SessionExpiredError) clearAuth()
      throw e
    }
  }, [clearAuth])

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, loading, login, logout, switchRole, selectActiveTenant, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
