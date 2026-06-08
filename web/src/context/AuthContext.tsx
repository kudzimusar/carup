import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UserRole, AuthUser } from '@shared/types'

const API_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? '/api'
  : 'https://carup-backend.vercel.app/api';

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

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('carup_user')
      const savedToken = localStorage.getItem('carup_token')
      if (savedUser && savedToken) {
        setUser(JSON.parse(savedUser))
        setToken(savedToken)
      }
    } catch (e) {
      localStorage.removeItem('carup_user')
      localStorage.removeItem('carup_token')
    } finally {
      setLoading(false)
    }
  }, [])

  const login = useCallback((userData: AuthUser, sessionToken: string) => {
    setUser(userData)
    setToken(sessionToken)
    localStorage.setItem('carup_user', JSON.stringify(userData))
    localStorage.setItem('carup_token', sessionToken)
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('carup_user')
    localStorage.removeItem('carup_token')
    localStorage.removeItem('carup_session') // Cleanup old mocks
  }, [])

  const switchRole = useCallback(async (role: UserRole, tenantId?: string) => {
    if (!user || !token) return
    try {
      const res = await fetch(`${API_BASE}/auth/switch-role`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-session-token': token
        },
        body: JSON.stringify({ userId: user.id, role, tenantId }),
      })
      if (res.ok) {
        const data = await res.json()
        const updated = { ...user, ...data.user }
        setUser(updated)
        if (data.token) {
          setToken(data.token)
          localStorage.setItem('carup_token', data.token)
        }
        localStorage.setItem('carup_user', JSON.stringify(updated))
      }
    } catch (e) {
      console.error('Role switch failed', e)
    }
  }, [user, token])

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, loading, login, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
