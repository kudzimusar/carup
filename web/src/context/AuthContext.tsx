import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UserRole, AuthUser } from '@shared/types'
import { apiRequest, resolveApiBaseUrl, setUnauthorizedHandler, SessionExpiredError } from '@/lib/apiClient'
import { readStoredAuth, storeAuth, clearStoredAuth, validateStoredSession } from '@/lib/authSession'

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
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,
  login: () => {},
  logout: () => {},
  switchRole: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    }
  }, [user, token, clearAuth])

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, loading, login, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
