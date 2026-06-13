/**
 * Admin identity-verification API client (Phase 7C, Workstream D).
 *
 * A small, framework-agnostic module so admin verification calls aren't
 * scattered as raw fetches across components, and so they can be unit-tested
 * without rendering React (mirrors apiClient.test.ts).
 *
 * It delegates transport to apiRequest, which already:
 *   - attaches the identity headers (x-session-token / x-user-id / role / tenant),
 *   - fetches a correctly-bound CSRF token for the mutating review POST,
 *   - guards against non-JSON (HTML/proxy) responses, and
 *   - maps 401 → SessionExpiredError and surfaces actionable messages otherwise.
 *
 * The backend never returns private document storage paths or URLs in these
 * payloads (sanitizeReviewSession strips them), so this client cannot leak them.
 */
import { apiRequest, type AuthHeaders } from './apiClient'
import type {
  AdminVerificationSession,
  VerificationReviewRequest,
  VerificationSessionStatus,
} from '@shared/types'

const BASE_PATH = '/admin/identity/verification-sessions'

export interface VerificationAdminClientConfig {
  baseUrl: string
  authHeaders: AuthHeaders
  /** Injectable for tests; defaults to global fetch via apiRequest. */
  fetchImpl?: typeof fetch
}

interface ListResponse {
  success: boolean
  sessions: AdminVerificationSession[]
}

interface SessionResponse {
  success: boolean
  session: AdminVerificationSession
}

/** List sessions in the review queue, optionally filtered by backend status. */
export async function fetchVerificationReviewQueue(
  config: VerificationAdminClientConfig,
  status?: VerificationSessionStatus | string,
): Promise<AdminVerificationSession[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await apiRequest<ListResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}${query}`,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.sessions ?? []
}

/** Fetch one session's review detail. */
export async function fetchVerificationSessionDetail(
  config: VerificationAdminClientConfig,
  sessionId: string,
): Promise<AdminVerificationSession> {
  const res = await apiRequest<SessionResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}`,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.session
}

/** Submit a review decision. The POST is CSRF-protected by apiRequest. */
export async function reviewVerificationSession(
  config: VerificationAdminClientConfig,
  sessionId: string,
  body: VerificationReviewRequest,
): Promise<AdminVerificationSession> {
  const res = await apiRequest<SessionResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/review`,
    options: { method: 'POST', body: JSON.stringify(body) },
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.session
}
