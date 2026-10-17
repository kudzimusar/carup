/**
 * CA-K3-AUTH-01 — the server's Corporate Admin decision for the CURRENT session.
 *
 * Keyed on the session (account id + session token). A different account, a new session, or sign-out
 * changes the key, and in that same render the previous decision stops counting — it reads as pending
 * until the server answers for the new session — so a grant can never outlive the session it was given
 * to. Nothing is cached in storage or across mounts: a deep link, a refresh or a new tab asks again.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { CORPORATE_ACCESS_TIMEOUT_MS, fetchCorporateAccess, type CorporateServerDecision } from './access'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

const PENDING: CorporateServerDecision = { status: 'pending' }

export function useCorporateServerDecision(): { decision: CorporateServerDecision; retry: () => void } {
  const { user, token, loading } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const sessionKey = !loading && user?.id && token ? `${user.id}\u0000${token}` : null
  const requestKey = sessionKey ? `${sessionKey}\u0000${attempt}` : null
  const [answer, setAnswer] = useState<{ key: string; decision: CorporateServerDecision } | null>(null)

  useEffect(() => {
    if (!requestKey || !token) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CORPORATE_ACCESS_TIMEOUT_MS)
    fetchCorporateAccess({ baseUrl: API_BASE, sessionToken: token, signal: controller.signal })
      .then((decision) => { if (current) setAnswer({ key: requestKey, decision }) })
      .finally(() => clearTimeout(timer))
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [requestKey, token])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  // Only an answer for exactly this session and attempt counts.
  return { decision: answer && answer.key === requestKey ? answer.decision : PENDING, retry }
}
