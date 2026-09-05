import { useCallback, useMemo } from 'react'
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

  const confirmMeasurements = useCallback(async (
    requestId: string,
    items: Array<{ item_id: string; estimated_volume_cbm: number; estimated_weight_kg?: number }>,
  ): Promise<LogisticsRequest> => {
    const response = await request<{ data: LogisticsRequest }>(`/diaspora/logistics-requests/${encodeURIComponent(requestId)}/confirm-measurements`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
    return response.data
  }, [request])

  // The participant-scoped container reservations read the hardened marketplace already serves;
  // T3 uses it to show the TRUE reservation state instead of a frozen "pending" sentence.
  const fetchContainerReservations = useCallback(async (containerId: string): Promise<Array<Record<string, unknown>>> => {
    const response = await request<{ data: Array<Record<string, unknown>> }>(`/diaspora/container-marketplace/containers/${encodeURIComponent(containerId)}/reservations`)
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

  /**
   * T4 — the operating transaction passport. One projection, two anchors; `kind` is in the path so
   * the two origins can never be conflated by a missing parameter.
   */
  const getTransactionPassport = useCallback(async (kind: 'procurement' | 'logistics', id: string): Promise<TransactionPassport> => {
    const response = await request<{ data: TransactionPassport }>(
      `/diaspora/trade-transactions/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`)
    return response.data
  }, [request])

  /** Continue an awarded purchase into shipping. Idempotent server-side; safe to retry. */
  const continueToLogistics = useCallback(async (importOrderId: string): Promise<{ request: { id: string }; idempotentReplay: boolean }> => {
    const response = await request<{ data: { request: { id: string }; idempotentReplay: boolean } }>(
      `/diaspora/import-orders/${encodeURIComponent(importOrderId)}/continue-to-logistics`, { method: 'POST' })
    return response.data
  }, [request])

  const listOpenContainers = useCallback(async (): Promise<Array<Record<string, unknown>>> => {
    const response = await request<{ data: Array<Record<string, unknown>> }>('/diaspora/container-marketplace/containers')
    return response.data || []
  }, [request])

  // Consumers use these callbacks inside useEffect/useCallback dependencies. Returning a fresh
  // object every render would make those dependencies change forever and trigger a fetch loop, so
  // the facade itself is memoized just like the individual operations.
  return useMemo(() => ({
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
    confirmMeasurements,
    fetchContainerReservations,
    ensureConversation,
    listOpenContainers,
    getTransactionPassport,
    continueToLogistics,
  }), [
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
    confirmMeasurements,
    fetchContainerReservations,
    ensureConversation,
    listOpenContainers,
    getTransactionPassport,
    continueToLogistics,
  ])
}

// ── T4 — Order & Booking Passport ────────────────────────────────────────
// Mirrors tradeTransactionPassportService's projection. Every field is READ from an authority;
// nothing here is a second copy of a canonical fact. A `null` means CarUp does not know — it is
// never a zero, and the UI must render it as unknown rather than as an answer.

export interface PassportStageEntry { key: string; label: string; state: 'DONE' | 'CURRENT' | 'PENDING' | 'NOT_STARTED' | 'NOT_CONNECTED' | 'NOT_RECORDED'; owner?: string }
export interface PassportParty {
  display_name: string; role: string; business_type?: string | null
  identified?: boolean; withheld?: boolean; verification?: string | null
}
export interface PassportNextStep {
  state: 'ACTION' | 'BLOCKED' | 'WAITING' | 'NONE'
  label: string; detail: string | null; href: string | null
}
export interface PassportCargoLine {
  line_number: number; description: string | null; quantity: number | null
  estimated_volume_cbm: number | null; estimated_weight_kg: number | null
  measurement_basis: string; has_linked_vehicle: boolean; linked_vehicle_vin?: string | null
}
export interface TransactionPassport {
  kind: 'procurement' | 'logistics'
  viewer_role: string
  next_step: PassportNextStep
  identity: {
    reference: string; anchor_id: string; context: string
    stage: string; stage_evidence: string
    origin: { city: string | null; country: string | null }
    destination: { city: string | null; country: string | null }
    continued_from_order?: { reference: string; anchor_id: string } | null
    shipping_continuation?: { reference: string; anchor_id: string; status: string } | null
  }
  participants: Record<string, PassportParty | PassportParty[] | null>
  commercial: {
    quote_reference: string; total_amount: number | string | null; currency: string | null
    service_mode?: string | null; valid_until?: string | null; agreed_at?: string | null
    stock_item_id?: string | null
  } | null
  offers_visible: number
  cargo?: PassportCargoLine[]
  booking: {
    sailing?: {
      reference: string
      origin: { city: string | null; country: string | null }
      destination: { city: string | null; country: string | null }
      departure_date: string | null; booking_deadline: string | null; container_type: string | null
      capacity: { total_cbm: number; used_cbm: number; available_cbm: number }
    } | null
    reservation: { reference: string; state: string; reserved_cbm: number | string | null; consumes_capacity: boolean } | null
  } | null
  documents: { authority_available: boolean; records: Array<{ id: string; document_type: string | null; verification_status: string | null; recorded_at: string | null }>; note?: string }
  lifecycle: PassportStageEntry[]
  communications: { workflow: string; subject_type: string; subject_anchor_id: string; note: string }
}
