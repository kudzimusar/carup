/**
 * CA-CLOSE-01 (F1) — the People & Access projection for the CURRENT session.
 *
 * Keyed on the session exactly like useCorporateServerDecision: a different account, a new session or sign-out changes the
 * key, and the previous answer stops counting in that same render. Nothing is cached in storage or across mounts.
 */
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import type { CorporateGrant } from './access'
import { PEOPLE_ACCESS_TIMEOUT_MS, fetchPeopleAccess, type PeopleAccessResult } from './peopleAccess'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

const PENDING: PeopleAccessResult = { status: 'pending' }

export function usePeopleAccessProjection(): PeopleAccessResult {
  const { user, token, loading } = useAuth()
  const sessionKey = !loading && user?.id && token ? `${user.id}\u0000${token}` : null
  const [answer, setAnswer] = useState<{ key: string; result: PeopleAccessResult } | null>(null)

  useEffect(() => {
    if (!sessionKey || !token) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PEOPLE_ACCESS_TIMEOUT_MS)
    fetchPeopleAccess({ baseUrl: API_BASE, sessionToken: token, signal: controller.signal })
      .then((result) => { if (current) setAnswer({ key: sessionKey, result }) })
      .finally(() => clearTimeout(timer))
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [sessionKey, token])

  return answer && answer.key === sessionKey ? answer.result : PENDING
}

/** The server grant the Corporate shell was admitted with (handed to pages through the router outlet), or null. */
export function useCorporateGrant(): CorporateGrant | null {
  const context = useOutletContext<{ grant?: CorporateGrant } | undefined>()
  return context?.grant ?? null
}
