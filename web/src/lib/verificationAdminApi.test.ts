import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchVerificationReviewQueue,
  fetchVerificationSessionDetail,
  fetchEvidencePreview,
  reviewVerificationSession,
  type VerificationAdminClientConfig,
} from './verificationAdminApi'
import { resetCsrfTokenCache, setUnauthorizedHandler, SessionExpiredError, type AuthHeaders } from './apiClient'
import {
  getVerificationStatusMeta,
  VERIFICATION_STATUS_META,
  REVIEWABLE_VERIFICATION_STATUSES,
  type AdminVerificationSession,
} from '@shared/types'

const BASE = 'https://api.test/api'
const ADMIN: AuthHeaders = { 'x-user-id': 'admin-1', 'x-session-token': 'sess-admin' }

// Sanitized session as the backend's sanitizeReviewSession returns it — note
// there are NO *_storage_path keys and NO document URLs.
const SANITIZED_SESSION: AdminVerificationSession = {
  id: 'vs-1',
  user_id: 'user-9',
  document_type: 'national_id',
  double_sided: true,
  status: 'pending_manual_review',
  uploaded_sides: { front: true, back: true, selfie: true },
  ocr_document_id: 'ocr-1',
  ocr_result: { first_name: 'Ada', last_name: 'Banda', national_id_number: 'ZN1' },
  confidence_score: 0.42,
  failure_reason: 'OCR confidence below threshold.',
  review_notes: null,
  review_decision: null,
  retry_reason: null,
  liveness_status: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-06-13T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
  submitted_at: '2026-06-13T00:00:00.000Z',
  ocr_started_at: '2026-06-13T00:00:00.000Z',
  ocr_completed_at: '2026-06-13T00:00:00.000Z',
}

interface RecordedCall { url: string; init: RequestInit }

function makeResponse(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

function makeFetch(opts: {
  csrf?: () => Response | Promise<Response>
  api?: (url: string, init: RequestInit) => Response | Promise<Response>
} = {}) {
  const calls: RecordedCall[] = []
  const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    if (u.endsWith('/security/csrf-token')) {
      return opts.csrf ? opts.csrf() : makeResponse({ csrfToken: 'csrf-1' })
    }
    return opts.api ? opts.api(u, init ?? {}) : makeResponse({ success: true, sessions: [] })
  }) as unknown as typeof fetch
  return { impl, calls }
}

function config(impl: typeof fetch): VerificationAdminClientConfig {
  return { baseUrl: BASE, authHeaders: ADMIN, fetchImpl: impl }
}

beforeEach(() => {
  resetCsrfTokenCache()
  setUnauthorizedHandler(null)
})

describe('verificationAdminApi — list', () => {
  it('builds the status-filtered URL, sends auth headers, and skips CSRF on GET', async () => {
    const { impl, calls } = makeFetch({ api: () => makeResponse({ success: true, sessions: [SANITIZED_SESSION] }) })
    const sessions = await fetchVerificationReviewQueue(config(impl), { status: 'pending_manual_review' })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('vs-1')
    expect(calls.some((c) => c.url.includes('/security/csrf-token'))).toBe(false)
    expect(calls[0].url).toContain('/admin/identity/verification-sessions?status=pending_manual_review')
    expect((calls[0].init.headers as Record<string, string>)['x-session-token']).toBe('sess-admin')
  })

  it('omits the status query when no filter is given', async () => {
    const { impl, calls } = makeFetch()
    await fetchVerificationReviewQueue(config(impl))
    expect(calls[0].url).toMatch(/\/admin\/identity\/verification-sessions$/)
  })
})

describe('verificationAdminApi — detail', () => {
  it('returns a single session', async () => {
    const { impl, calls } = makeFetch({ api: () => makeResponse({ success: true, session: SANITIZED_SESSION }) })
    const session = await fetchVerificationSessionDetail(config(impl), 'vs-1')
    expect(session.document_type).toBe('national_id')
    expect(calls[0].url).toContain('/admin/identity/verification-sessions/vs-1')
  })
})

describe('verificationAdminApi — evidence preview (Workstream G)', () => {
  it('GETs the per-side preview URL (no CSRF) and returns the signed URL', async () => {
    const { impl, calls } = makeFetch({
      api: (u) =>
        u.includes('/evidence/front/preview')
          ? makeResponse({ success: true, preview: { side: 'front', url: 'https://signed.test/front?exp=180', expiresInSeconds: 180 } })
          : makeResponse({ success: true }),
    })
    const preview = await fetchEvidencePreview(config(impl), 'vs-1', 'front')

    expect(preview.url).toBe('https://signed.test/front?exp=180')
    expect(preview.expiresInSeconds).toBe(180)
    expect(calls[0].url).toContain('/admin/identity/verification-sessions/vs-1/evidence/front/preview')
    // Read-only: must not fetch a CSRF token.
    expect(calls.some((c) => c.url.includes('/security/csrf-token'))).toBe(false)
    expect((calls[0].init.headers as Record<string, string>)['x-session-token']).toBe('sess-admin')
  })

  it('surfaces a 403 when a non-admin requests a preview', async () => {
    const { impl } = makeFetch({ api: () => makeResponse({ error: "Forbidden. Role 'owner' cannot access this resource." }, { ok: false, status: 403 }) })
    await expect(fetchEvidencePreview(config(impl), 'vs-1', 'selfie')).rejects.toThrow(/Forbidden/)
  })
})

describe('verificationAdminApi — review (mutating, CSRF-protected)', () => {
  it('fetches a CSRF token then POSTs the action with x-csrf-token and the body', async () => {
    const { impl, calls } = makeFetch({
      api: (_u, init) =>
        init.method === 'POST'
          ? makeResponse({
              success: true,
              session: { ...SANITIZED_SESSION, status: 'verified', review_decision: 'approve' },
              decision: { action: 'approve', reason_code: null },
              allowed_actions: [],
            })
          : makeResponse({ success: true }),
    })
    const result = await reviewVerificationSession(config(impl), 'vs-1', { action: 'approve', reviewNotes: 'ID matches selfie.' })

    expect(result.session.status).toBe('verified')
    expect(result.decision.action).toBe('approve')
    expect(calls.some((c) => c.url.endsWith('/security/csrf-token'))).toBe(true)
    const post = calls.find((c) => (c.init.method || 'GET') === 'POST')!
    expect(post.url).toContain('/admin/identity/verification-sessions/vs-1/review')
    expect((post.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1')
    expect(JSON.parse(post.init.body as string)).toEqual({ action: 'approve', reviewNotes: 'ID matches selfie.' })
  })
})

describe('verificationAdminApi — error handling', () => {
  it('maps a 401 session failure to SessionExpiredError', async () => {
    const { impl } = makeFetch({ api: () => makeResponse({ error: 'Unauthorized. Session is invalid or expired.' }, { ok: false, status: 401 }) })
    await expect(fetchVerificationReviewQueue(config(impl))).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('surfaces a 403 forbidden message (string error shape)', async () => {
    const { impl } = makeFetch({ api: () => makeResponse({ error: "Forbidden. Role 'owner' cannot access this resource." }, { ok: false, status: 403 }) })
    await expect(fetchVerificationReviewQueue(config(impl))).rejects.toThrow(/Forbidden/)
  })

  it('surfaces a 404 from the errorMiddleware object shape ({error:{message}})', async () => {
    const { impl } = makeFetch({
      api: () => makeResponse({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Verification session not found.' } }, { ok: false, status: 404 }),
    })
    await expect(fetchVerificationSessionDetail(config(impl), 'missing')).rejects.toThrow(/not found/i)
  })

  it('surfaces a 400 validation message from the object shape on review', async () => {
    const { impl } = makeFetch({
      api: (_u, init) =>
        init.method === 'POST'
          ? makeResponse({ success: false, error: { code: 'VALIDATION_FAILED', message: 'retryReason is required to request a retry.' } }, { ok: false, status: 400 })
          : makeResponse({ success: true }),
    })
    await expect(reviewVerificationSession(config(impl), 'vs-1', { action: 'request_retry' })).rejects.toThrow(/retryReason is required/)
  })
})

describe('verificationAdminApi — no private document URL leak', () => {
  it('returns only sanitized fields (no storage paths, no document URLs)', async () => {
    const { impl } = makeFetch({ api: () => makeResponse({ success: true, sessions: [SANITIZED_SESSION] }) })
    const [session] = await fetchVerificationReviewQueue(config(impl))
    const serialized = JSON.stringify(session)
    expect(serialized).not.toMatch(/storage_path/)
    expect(serialized).not.toMatch(/https?:\/\//)
    expect(serialized).not.toMatch(/\.(?:jpg|jpeg|png|webp)/i)
    // Only uploaded-side booleans are exposed.
    expect(session.uploaded_sides).toEqual({ front: true, back: true, selfie: true })
  })
})

describe('shared verification status map', () => {
  it('defines meta for every reviewable status', () => {
    for (const status of REVIEWABLE_VERIFICATION_STATUSES) {
      expect(VERIFICATION_STATUS_META[status]).toBeDefined()
      expect(VERIFICATION_STATUS_META[status].label.length).toBeGreaterThan(0)
    }
  })

  it('verified is positive and never retry-able; rejected/retry_requested allow restart', () => {
    expect(getVerificationStatusMeta('verified').tone).toBe('positive')
    expect(getVerificationStatusMeta('verified').retryAllowed).toBe(false)
    expect(getVerificationStatusMeta('retry_requested').retryAllowed).toBe(true)
    expect(getVerificationStatusMeta('rejected').retryAllowed).toBe(true)
  })

  it('only pending_manual_review / ocr_failed / retry_requested allow admin decisions', () => {
    expect(getVerificationStatusMeta('pending_manual_review').adminActionAllowed).toBe(true)
    expect(getVerificationStatusMeta('ocr_failed').adminActionAllowed).toBe(true)
    expect(getVerificationStatusMeta('retry_requested').adminActionAllowed).toBe(true)
    expect(getVerificationStatusMeta('verified').adminActionAllowed).toBe(false)
    expect(getVerificationStatusMeta('rejected').adminActionAllowed).toBe(false)
  })

  it('falls back safely for unknown / null status', () => {
    expect(getVerificationStatusMeta('totally-unknown').label).toBeTruthy()
    expect(getVerificationStatusMeta(null).tone).toBe('neutral')
  })
})
