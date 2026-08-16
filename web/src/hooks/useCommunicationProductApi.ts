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
    unique_participants?: number
    by_workflow: Record<string, number>
    by_funnel_stage: Record<string, number>
  }
  marketplace?: { conversations: number; converted: number; inquiry_to_next_step_pct: number }
  response_time?: { measured: number; average_minutes: number; median_minutes: number; p95_minutes: number }
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
  campaigns?: { touches: number; suppressed: number; converted: number; conversion_rate_pct: number; by_status: Record<string, number> }
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

export type CommunicationMessagePart = {
  id: string
  message_id: string
  part_index?: number
  part_type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'contact' | 'structured_card' | 'button' | 'quick_reply' | 'quote' | 'system_event'
  text_content?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  sha256?: string | null
  storage_key?: string | null
  metadata?: Record<string, unknown>
}

type PreparedUpload = {
  artifact_id: string
  bucket: string
  path: string
  token: string
  part_type: string
  file_name: string
  mime_type: string
  size_bytes: number
  private: true
}

async function sha256File(file: File) {
  if (!globalThis.crypto?.subtle) return null
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
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
    () => request<{ ai: { available: boolean; provider?: string | null; model?: string | null; mode?: string; multimodal?: boolean } }>('/communications/ai/health'),
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

  const nextBestAction = useCallback(
    (threadId: string) => request<{ derivation: CommunicationAiDerivation; auto_executed: false; requires_human_review: true }>(
      `/communications/threads/${encodeURIComponent(threadId)}/ai/next-action`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
    [request],
  )

  const analyzeMedia = useCallback(
    (threadId: string, partId: string) => request<{ derivation: CommunicationAiDerivation; source_artifact_unchanged: true }>(
      `/communications/threads/${encodeURIComponent(threadId)}/ai/media/${encodeURIComponent(partId)}`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
    [request],
  )

  const mediaAccess = useCallback(
    (threadId: string, partId: string) => request<{ access: { part_id: string; url: string; expires_in: number; private: true } }>(
      `/communications/threads/${encodeURIComponent(threadId)}/media/${encodeURIComponent(partId)}/access`,
    ),
    [request],
  )

  const sendLocation = useCallback(
    (threadId: string, latitude: number, longitude: number, label?: string) => request(
      `/communications/threads/${encodeURIComponent(threadId)}/media/location`,
      {
        method: 'POST',
        body: JSON.stringify({ latitude, longitude, label: label || null }),
      },
    ),
    [request],
  )

  const uploadMedia = useCallback(async (threadId: string, file: File, caption = '', capture?: string | null) => {
    const prepared = await request<{ upload: PreparedUpload }>(
      `/communications/threads/${encodeURIComponent(threadId)}/media/prepare`,
      {
        method: 'POST',
        body: JSON.stringify({
          file_name: file.name || `capture-${Date.now()}`,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      },
    )
    const upload = prepared.upload
    // Supabase is intentionally loaded only for a real media-upload action. This keeps
    // unrelated CarUp routes and mocked UI test environments independent of storage env.
    const { supabase } = await import('@/lib/supabase')
    const { error } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(
      upload.path,
      upload.token,
      file,
      { contentType: upload.mime_type },
    )
    if (error) throw error
    const sha256 = await sha256File(file)
    return request(
      `/communications/threads/${encodeURIComponent(threadId)}/media/commit`,
      {
        method: 'POST',
        body: JSON.stringify({
          artifact_id: upload.artifact_id,
          file_name: upload.file_name,
          mime_type: upload.mime_type,
          size_bytes: upload.size_bytes,
          sha256,
          caption,
          capture: capture || null,
        }),
      },
    )
  }, [request])

  return {
    fetchAnalytics,
    fetchAiHealth,
    suggestReply,
    summarize,
    translate,
    nextBestAction,
    analyzeMedia,
    mediaAccess,
    sendLocation,
    uploadMedia,
  }
}
