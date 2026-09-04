import { useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, DEFAULT_PRODUCTION_API_BASE_URL, type AuthHeaders } from '@/lib/apiClient'
import type {
  LogisticsAcceptResult,
  LogisticsMyQuote,
  LogisticsOpportunity,
  LogisticsQuote,
  LogisticsQuoteInput,
  LogisticsRequest,
  LogisticsRequestInput,
  LogisticsReservationResult,
  LogisticsSailingMatch,
} from '@/types/tradeLogistics'

const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

if (
  typeof window !== 'undefined'
  && !import.meta.env.VITE_API_URL
  && BASE_URL === DEFAULT_PRODUCTION_API_BASE_URL
  && !['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
) {
  // Same deployment guard as useCarUpApi: never silently point a preview Trade OS at production.
  // eslint-disable-next-line no-console
  console.warn('[CarUp Trade OS] VITE_API_URL is not set; logistics requests would default to the production API.')
}

export function useTradeLogisticsApi() {
  const { user, token } = useAuth()

  const request = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (user?.id) authHeaders['x-user-id'] = user.id
    if (user?.role) authHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) authHeaders['x-tenant-id'] = user.active_tenant_id
    return apiRequest<T>({ baseUrl: BASE_URL, path, options, authHeaders })
  }, [token, user])

  const listMyRequests = useCallback(async (): Promise<LogisticsRequest[]> => {
    const response = await request<{ data: LogisticsRequest[] }>('/diaspora/logistics-requests/mine')
    return response.data || []
  }, [request])

  const getRequest = useCallback(async (id: string): Promise<LogisticsRequest> => {
    const response = await request<{ data: LogisticsRequest }>(`/diaspora/logistics-requests/${encodeURIComponent(id)}`)
    return response.data
  }, [request])

  const createRequest = useCallback(async (payload: LogisticsRequestInput): Promise<LogisticsRequest> => {
    const response = await request<{ data: LogisticsRequest }>('/diaspora/logistics-requests', {
      method: 'POST', body: JSON.stringify(payload),
    })
    return response.data
  }, [request])

  const updateRequest = useCallback(async (id: string, payload: LogisticsRequestInput): Promise<LogisticsRequest> => {
    const response = await request<{ data: LogisticsRequest }>(`/diaspora/logistics-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
    return response.data
  }, [request])

  const publishRequest = useCallback(async (id: string): Promise<LogisticsRequest> => {
    const response = await request<{ data: LogisticsRequest }>(`/diaspora/logistics-requests/${encodeURIComponent(id)}/publish`, {
      method: 'POST', body: JSON.stringify({}),
    })
    return response.data
  }, [request])

  const listOpportunities = useCallback(async (): Promise<LogisticsOpportunity[]> => {
    const response = await request<{ data: LogisticsOpportunity[] }>('/diaspora/logistics-opportunities')
    return response.data || []
  }, [request])

  const getOpportunity = useCallback(async (id: string): Promise<LogisticsOpportunity> => {
    const response = await request<{ data: LogisticsOpportunity }>(`/diaspora/logistics-opportunities/${encodeURIComponent(id)}`)
    return response.data
  }, [request])

  const createQuote = useCallback(async (requestId: string, payload: LogisticsQuoteInput): Promise<LogisticsQuote> => {
    const response = await request<{ data: LogisticsQuote }>(`/diaspora/logistics-opportunities/${encodeURIComponent(requestId)}/quotes`, {
      method: 'POST', body: JSON.stringify(payload),
    })
    return response.data
  }, [request])

  const updateQuote = useCallback(async (quoteId: string, payload: LogisticsQuoteInput): Promise<LogisticsQuote> => {
    const response = await request<{ data: LogisticsQuote }>(`/diaspora/logistics-quotes/${encodeURIComponent(quoteId)}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
    return response.data
  }, [request])

  const submitQuote = useCallback(async (quoteId: string): Promise<LogisticsQuote> => {
    const response = await request<{ data: LogisticsQuote }>(`/diaspora/logistics-quotes/${encodeURIComponent(quoteId)}/submit`, {
      method: 'POST', body: JSON.stringify({}),
    })
    return response.data
  }, [request])

  const withdrawQuote = useCallback(async (quoteId: string): Promise<LogisticsQuote> => {
    const response = await request<{ data: LogisticsQuote }>(`/diaspora/logistics-quotes/${encodeURIComponent(quoteId)}/withdraw`, {
      method: 'POST', body: JSON.stringify({}),
    })
    return response.data
  }, [request])

  const listMyQuotes = useCallback(async (): Promise<LogisticsMyQuote[]> => {
    const response = await request<{ data: LogisticsMyQuote[] }>('/diaspora/logistics-quotes/mine')
    return response.data || []
  }, [request])

  const acceptQuote = useCallback(async (requestId: string, quoteId: string): Promise<LogisticsAcceptResult> => {
    const response = await request<{ data: LogisticsAcceptResult }>(`/diaspora/logistics-requests/${encodeURIComponent(requestId)}/accept-quote`, {
      method: 'POST', body: JSON.stringify({ quoteId }),
    })
    return response.data
  }, [request])

  const findSailingMatches = useCallback(async (requestId: string): Promise<LogisticsSailingMatch[]> => {
    const response = await request<{ data: LogisticsSailingMatch[] }>(`/diaspora/logistics-requests/${encodeURIComponent(requestId)}/sailing-matches`)
    return response.data || []
  }, [request])

  const requestContainerSpace = useCallback(async (requestId: string): Promise<LogisticsReservationResult> => {
    const response = await request<{ data: LogisticsReservationResult }>(`/diaspora/logistics-requests/${encodeURIComponent(requestId)}/request-space`, {
      method: 'POST', body: JSON.stringify({}),
    })
    return response.data
  }, [request])

  const ensureConversation = useCallback(async (requestId: string, providerId?: string): Promise<{ threadId: string | null; role: string }> => {
    const response = await request<{ data: { threadId: string | null; role: string } }>(`/diaspora/logistics-requests/${encodeURIComponent(requestId)}/conversation`, {
      method: 'POST', body: JSON.stringify(providerId ? { providerId } : {}),
    })
    return response.data
  }, [request])

  const listOpenContainers = useCallback(async (): Promise<Array<Record<string, unknown>>> => {
    const response = await request<{ data: Array<Record<string, unknown>> }>('/diaspora/container-marketplace/containers')
    return response.data || []
  }, [request])

  return {
    listMyRequests,
    getRequest,
    createRequest,
    updateRequest,
    publishRequest,
    listOpportunities,
    getOpportunity,
    createQuote,
    updateQuote,
    submitQuote,
    withdrawQuote,
    listMyQuotes,
    acceptQuote,
    findSailingMatches,
    requestContainerSpace,
    ensureConversation,
    listOpenContainers,
  }
}
