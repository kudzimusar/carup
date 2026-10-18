/**
 * CA-OWNER-02 — one Corporate management read model for the CURRENT session.
 *
 * Keyed on the session exactly like usePeopleAccessProjection: a different account, a new session or sign-out changes the
 * key, and the previous answer stops counting in that same render. Nothing is cached in storage or across mounts; "Try
 * again" asks the server afresh.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { MANAGEMENT_TIMEOUT_MS, fetchManagementArea, type ManagementArea, type ManagementPayload, type ManagementResult } from './management'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

const PENDING = { status: 'pending' } as const

export type AreaPayload<A extends ManagementArea> = Extract<ManagementPayload, { area: A }>

export function useManagementArea<A extends ManagementArea>(area: A): { result: ManagementResult<AreaPayload<A>>; retry: () => void } {
  const { user, token, loading } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const sessionKey = !loading && user?.id && token ? `${user.id}\u0000${token}\u0000${area}\u0000${attempt}` : null
  const [answer, setAnswer] = useState<{ key: string; result: ManagementResult } | null>(null)

  useEffect(() => {
    if (!sessionKey || !token) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MANAGEMENT_TIMEOUT_MS)
    fetchManagementArea({ baseUrl: API_BASE, sessionToken: token, area, signal: controller.signal })
      .then((result) => { if (current) setAnswer({ key: sessionKey, result }) })
      .finally(() => clearTimeout(timer))
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [sessionKey, token, area])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const result = answer && answer.key === sessionKey ? answer.result : PENDING
  // The parser only returns a payload for the area it was asked about, so the narrowing below is exact.
  return { result: result as ManagementResult<AreaPayload<A>>, retry }
}
