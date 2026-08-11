import { useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import {
  apiRequest,
  resolveApiBaseUrl,
  DEFAULT_PRODUCTION_API_BASE_URL,
  type AuthHeaders,
} from '@/lib/apiClient'

const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

export type CommunicationProductAnalytics = {
  bounded: boolean
  row_cap: number
  conversations: {
    total: number
    active: number
    converted: number
    conversion_rate_pct: number
    by_workflow: Record<string, number>
    by_funnel_stage: Record<string, number>
  }
  events: { total: number; by_type: Record<string, number> }
  delivery: {
    total: number
    successful: number
    failed: number
    suppressed: number
    success_rate_pct: number
    by_channel: Record<string, number>
    by_status: Record<string, number>
  }
  attribution: {
    by_source: Record<string, number>
    by_referral_code: Record<string, number>
    by_campaign_code: Record<string, number>
  }
  ai: { derivations: number; human_reviewed: number; by_type: Record<string, number> }
}

export type CommunicationAiDerivation = {
  id: string
  derivation_type: string
  output_text?: string | null
  target_language?: string | null
  model_provider?: string | null
  model_name?: string | null
  human_reviewed?: boolean
  created_at?: string | null
}

export function useCommunicationProductApi() {
  const { user, token } = useAuth()

  const request = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (user?.id) authHeaders['x-user-id'] = user.id
    if (user?.role) authHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) authHeaders['x-tenant-id'] = user.active_tenant_id
    return apiRequest<T>({ baseUrl: BASE_URL || DEFAULT_PRODUCTION_API_BASE_URL, path, options, authHeaders })
  }, [token, user])

  const fetchAnalytics = useCallback(
    () => request<{ analytics: CommunicationProductAnalytics }>('/communications/analytics'),
    [request],
  )

  const fetchAiHealth = useCallback(
    () => request<{ ai: { available: boolean; provider?: string | null; model?: string | null; mode?: string } }>('/communications/ai/health'),
    [request],
  )

  const suggestReply = useCallback(
    (threadId: string, sourceMessageId?: string | null) => request<{ derivation: CommunicationAiDerivation; auto_sent: false; requires_human_review: true }>(
      `/communications/threads/${encodeURIComponent(threadId)}/ai/suggest-reply`,
      { method: 'POST', body: JSON.stringify({ source_message_id: sourceMessageId || null }) },
    ),
    [request],
  )

  const summarize = useCallback(
    (threadId: string) => request<{ derivation: CommunicationAiDerivation }>(
      `/communications/threads/${encodeURIComponent(threadId)}/ai/summarize`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
    [request],
  )

  const translate = useCallback(
    (threadId: string, sourceMessageId: string, targetLanguage: string) => request<{ derivation: CommunicationAiDerivation }>(
      `/communications/threads/${encodeURIComponent(threadId)}/ai/translate`,
      { method: 'POST', body: JSON.stringify({ source_message_id: sourceMessageId, target_language: targetLanguage }) },
    ),
    [request],
  )

  return { fetchAnalytics, fetchAiHealth, suggestReply, summarize, translate }
}
