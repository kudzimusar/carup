/**
 * CA-OWNER-02 — one Corporate management read model for the CURRENT session.
 *
 * Keyed on the session exactly like usePeopleAccessProjection: a different account, a new session or sign-out changes the
 * key, and the previous answer stops counting in that same render. Nothing is stored in browser storage; "Try again" asks the
 * server afresh.
 *
 * CA-OWNER-02-R3 (D3): an area this session has already read renders AT ONCE from its last answer (held in memory, keyed on
 * the session) while a new read runs — `revalidating` says so — and the new answer replaces it. A failed re-read shows the
 * failure: an old answer is never kept on screen as if current. (D1) Every answer and failure is reported to the shell's
 * read status, which the header shows.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { MANAGEMENT_TIMEOUT_MS, fetchManagementArea, type ManagementArea, type ManagementPayload, type ManagementResult } from './management'
import { useManagementReadStatus } from './managementReadStatus'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

const PENDING = { status: 'pending' } as const

export type AreaPayload<A extends ManagementArea> = Extract<ManagementPayload, { area: A }>

/** The last successful answer per (session, area), for an instant re-render. Memory only; never across sessions. */
const lastAnswers = new Map<string, ManagementResult>()
const MAX_REMEMBERED = 32

/** Test seam: forget every remembered answer. */
export function resetManagementAreaCache(): void { lastAnswers.clear() }

function remember(key: string, result: ManagementResult) {
  if (result.status !== 'ok') { lastAnswers.delete(key); return }
  lastAnswers.delete(key)
  lastAnswers.set(key, result)
  while (lastAnswers.size > MAX_REMEMBERED) lastAnswers.delete(lastAnswers.keys().next().value as string)
}

export function useManagementArea<A extends ManagementArea>(area: A): { result: ManagementResult<AreaPayload<A>>; retry: () => void; revalidating: boolean } {
  const { user, token, loading } = useAuth()
  const status = useManagementReadStatus()
  const [attempt, setAttempt] = useState(0)
  const sessionArea = !loading && user?.id && token ? `${user.id}\u0000${token}\u0000${area}` : null
  const sessionKey = sessionArea ? `${sessionArea}\u0000${attempt}` : null
  const [answer, setAnswer] = useState<{ key: string; result: ManagementResult } | null>(null)

  useEffect(() => {
    if (!sessionKey || !sessionArea || !token) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MANAGEMENT_TIMEOUT_MS)
    fetchManagementArea({ baseUrl: API_BASE, sessionToken: token, area, signal: controller.signal })
      .then((result) => {
        if (!current) return
        remember(sessionArea, result)
        setAnswer({ key: sessionKey, result })
      })
      .finally(() => clearTimeout(timer))
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [sessionKey, sessionArea, token, area])

  // Report each settled answer to the shell's header (D1). Only the stable callbacks are dependencies: depending on the
  // status object itself would re-report on every status change — a render loop.
  const settled = answer && answer.key === sessionKey ? answer.result : null
  const report = status?.report
  const reportFailure = status?.reportFailure
  useEffect(() => {
    if (!settled) return
    if (settled.status === 'ok') report?.(area, settled.payload)
    else if (settled.status === 'unavailable' || settled.status === 'denied') reportFailure?.(area)
  }, [report, reportFailure, settled, area])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  if (settled) return { result: settled as ManagementResult<AreaPayload<A>>, retry, revalidating: false }
  const remembered = sessionArea && attempt === 0 ? lastAnswers.get(sessionArea) : undefined
  if (remembered) return { result: remembered as ManagementResult<AreaPayload<A>>, retry, revalidating: true }
  // The parser only returns a payload for the area it was asked about, so the narrowing below is exact.
  return { result: PENDING as ManagementResult<AreaPayload<A>>, retry, revalidating: false }
}
