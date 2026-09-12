/**
 * D1 — the CSRF-retry path must preserve the server's error `code`.
 *
 * Every unsafe 403 is presumed to be a stale CSRF token and retried once, so a genuine 403 —
 * `STEP_UP_REQUIRED` above all — arrives through the RETRY path, not the direct one. That path
 * used to copy `status` and `data` but not `code`, so `error.code` was undefined for every real
 * API call and the step-up prompt could never open. Unit tests that reject with a hand-made
 * error carrying `code` could not see it; only a test that goes through `apiRequest` can.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiRequest, resetCsrfTokenCache, type AuthHeaders } from './apiClient'

const BASE = 'https://api.test/api'
const ADMIN: AuthHeaders = { 'x-user-id': 'admin-1', 'x-session-token': 'sess-1' }

const STEP_UP_BODY = {
  error: 'Recent re-authentication is required for this action.',
  code: 'STEP_UP_REQUIRED',
  action_class: 'sensitive_action',
  required_strength: 'recent_reauth',
}

function makeResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** Answers the CSRF endpoint, and 403s every API call — the shape a guarded route produces. */
function alwaysStepUpRequired() {
  const calls: string[] = []
  const impl = vi.fn(async (url: unknown) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/security/csrf-token')) return makeResponse({ csrfToken: 'tok' })
    return makeResponse(STEP_UP_BODY, { ok: false, status: 403 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

beforeEach(() => { resetCsrfTokenCache() })

describe('D1 — guarded refusals survive the CSRF retry', () => {
  it('carries STEP_UP_REQUIRED as `code` after the 403 retry, not just in the body', async () => {
    const { impl, calls } = alwaysStepUpRequired()
    let thrown: unknown
    try {
      await apiRequest({
        baseUrl: BASE,
        path: '/admin/identity/verification-sessions/vs-1/review',
        options: { method: 'POST', body: JSON.stringify({ action: 'approve' }) },
        authHeaders: ADMIN,
        fetchImpl: impl,
      })
    } catch (error) { thrown = error }

    // The retry really happened — this is the path a real guarded call takes.
    expect(calls.filter((u) => u.includes('/review')).length).toBe(2)

    const failure = thrown as Error & { code?: string; status?: number; data?: { code?: string } }
    expect(failure).toBeInstanceOf(Error)
    expect(failure.status).toBe(403)
    expect(failure.code).toBe('STEP_UP_REQUIRED')
    expect(failure.data?.code).toBe('STEP_UP_REQUIRED')
  })

  it('carries the code on the direct (non-retried) failure path too — both paths agree', async () => {
    const impl = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('/security/csrf-token')) return makeResponse({ csrfToken: 'tok' })
      return makeResponse(STEP_UP_BODY, { ok: false, status: 409 })
    }) as unknown as typeof fetch

    let thrown: unknown
    try {
      await apiRequest({
        baseUrl: BASE, path: '/admin/dealers/dp-1/decision',
        options: { method: 'PATCH', body: '{}' }, authHeaders: ADMIN, fetchImpl: impl,
      })
    } catch (error) { thrown = error }
    const failure = thrown as Error & { code?: string; status?: number }
    expect(failure.status).toBe(409)
    expect(failure.code).toBe('STEP_UP_REQUIRED')
  })

  it('a GET is never retried, and still reports its code', async () => {
    const { impl, calls } = alwaysStepUpRequired()
    let thrown: unknown
    try {
      await apiRequest({ baseUrl: BASE, path: '/admin/people/u1/review', authHeaders: ADMIN, fetchImpl: impl })
    } catch (error) { thrown = error }
    expect(calls.filter((u) => u.includes('/review')).length).toBe(1)
    expect((thrown as { code?: string }).code).toBe('STEP_UP_REQUIRED')
  })
})
