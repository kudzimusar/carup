/**
 * Admin identity-verification API client (Phase 7C).
 *
 * Updated to support the new case management response format including
 * decisions, assessment summaries, and allowed actions.
 */

import { apiRequest, type AuthHeaders } from './apiClient'
import type { EvidencePreview, DecisionAction, DecisionResponse } from '@shared/types'

const BASE_PATH = '/admin/identity/verification-sessions'

export interface VerificationAdminClientConfig {
  baseUrl: string
  authHeaders: AuthHeaders
  fetchImpl?: typeof fetch
}

interface ListResponse {
  success: boolean
  sessions: any[]
}

interface SessionResponse {
  success: boolean
  session: any
}

interface EvidencePreviewResponse {
  success: boolean
  preview: EvidencePreview
}

/** List sessions in the review queue, optionally filtered by workflow phase or status. */
export async function fetchVerificationReviewQueue(
  config: VerificationAdminClientConfig,
  filter?: { workflow_phase?: string; status?: string },
): Promise<any[]> {
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
): Promise<any> {
  const res = await apiRequest<SessionResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}`,
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
): Promise<EvidencePreview> {
  const res = await apiRequest<EvidencePreviewResponse>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(side)}/preview`,
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
    reasonCode?: string | null
    internalNote?: string | null
    applicantMessage?: string | null
  },
): Promise<{
  decision: DecisionResponse['decision']
  session: import('@shared/types').AdminVerificationSession
  allowed_actions: DecisionAction[]
  success?: boolean
  idempotent_replay?: boolean
}> {
  const res = await apiRequest<any>({
    baseUrl: config.baseUrl,
    path: `${BASE_PATH}/${encodeURIComponent(sessionId)}/review`,
    options: { method: 'POST', body: JSON.stringify(body) },
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
  return res
}
