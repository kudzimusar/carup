import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UserRole, AuthUser } from '@shared/types'
import { apiRequest, resolveApiBaseUrl, setUnauthorizedHandler, SessionExpiredError, type AuthHeaders } from '@/lib/apiClient'
import { readStoredAuth, storeAuth, clearStoredAuth, validateStoredSession } from '@/lib/authSession'
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
  // Initialize from localStorage synchronously so the token exists on the first render. The stored
  // user is provisional only; /auth/me replaces it with authoritative session truth during boot.
  const [user, setUser] = useState<AuthUser | null>(
    () => (typeof window !== 'undefined' ? readStoredAuth(localStorage)?.user ?? null : null),
  )
  const [token, setToken] = useState<string | null>(
    () => (typeof window !== 'undefined' ? readStoredAuth(localStorage)?.token ?? null : null),
  )
  const [loading, setLoading] = useState(true)

  const clearAuth = useCallback(() => {
    setUser(null)
    setToken(null)
    clearStoredAuth(localStorage)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(clearAuth)
    return () => setUnauthorizedHandler(null)
  }, [clearAuth])

  useEffect(() => {
    setNavAnalyticsAuthProvider(() => {
      const headers: AuthHeaders = {
        'x-session-token': token ?? undefined,
        'x-user-id': user?.id,
        'x-stakeholder-role': user?.role,
        'x-tenant-id': user?.active_tenant_id ?? undefined,
      }
      return Object.fromEntries(
        Object.entries(headers).filter(([, value]) => value !== undefined),
      ) as AuthHeaders
    })
    return () => setNavAnalyticsAuthProvider(null)
  }, [token, user?.id, user?.role, user?.active_tenant_id])

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
      .then((authoritativeUser) => {
        if (cancelled) return
        setUser(authoritativeUser)
        storeAuth(localStorage, authoritativeUser, stored.token)
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
      const data = await apiRequest<{ user?: Partial<AuthUser>; token?: string }>({
        baseUrl: API_BASE,
        path: '/auth/switch-role',
        options: { method: 'POST', body: JSON.stringify({ userId: user.id, role, tenantId }) },
        authHeaders: {
          'x-session-token': token,
          'x-user-id': user.id,
          ...(user.role ? { 'x-stakeholder-role': user.role } : {}),
          ...(user.active_tenant_id ? { 'x-tenant-id': user.active_tenant_id } : {}),
        },
      })
      const updated = { ...user, ...(data.user ?? {}) }
      const nextToken = data.token ?? token
      setUser(updated)
      setToken(nextToken)
      storeAuth(localStorage, updated, nextToken)
    } catch (error) {
      if (error instanceof SessionExpiredError) clearAuth()
      else console.error('Role switch failed', error)
      throw error
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
