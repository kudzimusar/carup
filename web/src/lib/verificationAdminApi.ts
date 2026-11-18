/**
 * Admin identity-verification API client (Phase 7C).
 *
 * Updated to support the new case management response format including
 * decisions, assessment summaries, and allowed actions.
 */

import { apiRequest, type AuthHeaders } from './apiClient'
import type { AdminVerificationSession, EvidencePreview, DecisionResponse } from '@shared/types'

const BASE_PATH = '/admin/identity/verification-sessions'

export interface VerificationAdminClientConfig {
  baseUrl: string
  authHeaders: AuthHeaders
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

interface ReviewDecisionResponse extends DecisionResponse {
  success?: boolean
}

interface EvidencePreviewResponse {
  success: boolean
  preview: EvidencePreview
}

export async function issueVerificationReviewStepUp(
  config: VerificationAdminClientConfig,
  sessionId: string,
  operation: string,
  password: string,
): Promise<string> {
  const result = await apiRequest<{ proof: string }>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/step-up`,
    options: { method: 'POST', body: JSON.stringify({ operation, password }) },
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return result.proof
}

/** List sessions in the review queue, optionally filtered by workflow phase or status. */
export async function fetchVerificationReviewQueue(
  config: VerificationAdminClientConfig,
  filter?: { workflow_phase?: string; status?: string },
): Promise<AdminVerificationSession[]> {
  const params = new URLSearchParams()
  if (filter?.workflow_phase) params.set('workflow_phase', filter.workflow_phase)
  else if (filter?.status) params.set('status', filter.status)
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await apiRequest<ListResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}${query}`,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.sessions ?? []
}

/** Fetch one session's review detail including assessment and decisions. */
export async function fetchVerificationSessionDetail(
  config: VerificationAdminClientConfig,
  sessionId: string,
  stepUpProof?: string,
): Promise<AdminVerificationSession> {
  const res = await apiRequest<SessionResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}`,
    options: stepUpProof ? { headers: { 'x-review-step-up': stepUpProof } } : undefined,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.session
}

/**
 * Fetch a short-lived signed preview URL for one evidence side.
 */
export async function fetchEvidencePreview(
  config: VerificationAdminClientConfig,
  sessionId: string,
  side: 'front' | 'back' | 'selfie',
  stepUpProof?: string,
): Promise<EvidencePreview> {
  const res = await apiRequest<EvidencePreviewResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(side)}/preview`,
    options: stepUpProof ? { headers: { 'x-review-step-up': stepUpProof } } : undefined,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res.preview
}

/**
 * Submit a review decision. Returns the full decision response including
 * allowed_actions for the resulting state.
 */
export async function reviewVerificationSession(
  config: VerificationAdminClientConfig,
  sessionId: string,
  body: {
    action: string
    expectedRevision?: number
    reasonCode?: string | null
    internalNote?: string | null
    applicantMessage?: string | null
  },
  opts?: { idempotencyKey?: string; stepUpProof?: string },
): Promise<ReviewDecisionResponse> {
  const res = await apiRequest<ReviewDecisionResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/review`,
    options: {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        ...(opts?.idempotencyKey ? { 'x-idempotency-key': opts.idempotencyKey } : {}),
        ...(opts?.stepUpProof ? { 'x-review-step-up': opts.stepUpProof } : {}),
      },
    },
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res
}
