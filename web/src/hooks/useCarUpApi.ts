import { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, DEFAULT_PRODUCTION_API_BASE_URL, type AuthHeaders } from '@/lib/apiClient'
import type { 
  User, 
  Vehicle, 
  WorkOrder, 
  Part, 
  Claim, 
  RegistryVerification,
  ApiMutationResponse,
  VehiclePassport,
  VehicleEvidence,
  TimelineEvent,
  MarketplaceListingsResponse,
  MarketplaceListingDetail,
  MarketplaceInquiry,
  MarketplaceInquiryInput,
  NavCoverageResponse,
  TrustAuditTrailResponse,
  TrustFactDecisionPayload,
  TrustFactDecisionResponse,
  TrustFactReviewQueueResponse,
  TrustFactReviewStatus,
  TrustFactName,
  DiasporaImportOrder,
  DiasporaImportOrderPayload,
  DiasporaTradeDocument,
  DiasporaComplianceReview,
  DiasporaCargoReservation,
  DiasporaCargoReservationPayload,
  DiasporaShipment,
  DiasporaContainerShipment,
  DiasporaWorkbookOperatorBatchSummary,
  DiasporaWorkbookOperatorDashboard,
  DiasporaWorkbookOperatorDashboardFilters,
  DiasporaWorkbookOperatorHold,
  DiasporaWorkbookOperatorNextActions,
  DiasporaWorkbookOperatorNote,
  DiasporaWorkbookDryRunPayload,
  DiasporaWorkbookDryRunResult,
  DiasporaWorkbookTemplateDownloadStatus,
  DiasporaWorkbookTemplateSchemaResponse
} from '@/types'
import type {
  ReferralCampaignFilters,
  ReferralCampaignListResponse,
  ReferralCampaignResponse,
  ReferralCodeResponse,
  ReferralValidateResponse,
  ReferralShareAssetResponse,
  ReferralCouponResponse,
  ReferralCouponApplyResponse,
  ReferralCouponRedeemResponse,
  ReferralWalletResponse,
  ReferralWalletTransactionResponse,
  ReferralAdminEventFilters,
  ReferralAdminEventsResponse,
  ReferralAgentToolsResponse,
  ReferralRuleCatalogResponse,
  ReferralMarketingAssetFilters,
  ReferralMarketingAssetListResponse,
  ReferralReviewCaseFilters,
  ReferralReviewCaseListResponse,
  ReferralServiceResponse,
  ReferralAuditExportFilters,
  ReferralListFilters,
  ReferralCodeListResponse,
  ReferralCouponListResponse,
  ReferralLocalLeadListResponse,
  ReferralImportRouteListResponse,
  ReferralDisputeListResponse,
} from '@/types/referral'


// Honor VITE_API_URL so each environment targets its own backend (staging → staging backend),
// falling back to same-origin /api on localhost and to the production backend otherwise.
const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

// Diagnostic: a deployed (non-localhost) frontend with NO VITE_API_URL silently targets the PRODUCTION
// backend. On a staging/preview deployment this is a misconfiguration — it calls the unseeded, route-less
// prod backend (marketplace shows 0 vehicles; new routes 404 "Route not found"). Warn loudly so it's caught.
if (
  typeof window !== 'undefined' &&
  !import.meta.env.VITE_API_URL &&
  BASE_URL === DEFAULT_PRODUCTION_API_BASE_URL &&
  !['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
) {
  // eslint-disable-next-line no-console
  console.warn(
    `[CarUp] VITE_API_URL is not set — API calls default to the PRODUCTION backend (${BASE_URL}). ` +
    `On a staging/preview deployment, set VITE_API_URL to the matching staging backend, ` +
    `otherwise marketplace data is empty and new routes 404.`,
  );
}

/**
 * Build a `?a=1&b=2` query string from a filter object, dropping undefined/null/empty
 * values. Accepts any object (uses Object.entries) so typed filter interfaces pass
 * without index-signature friction. Returns '' when there is nothing to encode.
 */
function referralQuery(filters?: object): string {
  if (!filters) return ''
  const pairs = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string])
  return pairs.length ? `?${new URLSearchParams(pairs).toString()}` : ''
}

type CommunicationThreadSummary = {
  id: string
  tenant_id?: string | null
  thread_key?: string
  thread_type?: string
  status?: string
  priority?: string
  primary_channel?: string
  ai_mode?: string
  assigned_team?: string
  assigned_admin_id?: string | null
  primary_user_id?: string | null
  marketplace_listing_id?: string
  escrow_id?: string
  financing_application_id?: string
  subject_type?: string | null
  subject_id?: string | null
  sla_due_at?: string | null
  sla_paused_at?: string | null
  sla_pause_reason?: string | null
  last_message_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  // Identity-first projection (communication_inbox_threads view / RPC). Optional so legacy rows
  // that predate the projection still type-check.
  identity_display_name?: string | null
  identity_address?: string | null
  identity_external_id?: string | null
  identity_verified?: boolean | null
  identity_channel?: string | null
  identity_provider?: string | null
  latest_message_text?: string | null
  latest_message_direction?: string | null
  latest_message_at?: string | null
  latest_message_status?: string | null
  latest_provider_message_id?: string | null
  unread_count?: number
  failed_outbound_count?: number
}

type CommunicationMessageSummary = {
  id: string
  direction?: string
  channel?: string
  status?: string
  content_text?: string
  created_at?: string | null
  sender_user_id?: string | null
  provider_message_id?: string | null
  human_approved?: boolean
}

type CommunicationNotificationSummary = {
  id: string
  read?: boolean
  title?: string
  message?: string
  status?: string
  channel?: string
  notification_type?: string
  last_error_code?: string
  last_error_message?: string
  created_at?: string | null
  updated_at?: string | null
}

type CommunicationPreferences = Record<string, boolean | string | number | null | undefined>
type CommunicationMutationResponse = {
  success?: boolean
  message?: CommunicationMessageSummary
  notification?: CommunicationNotificationSummary
  duplicate?: boolean
  [key: string]: unknown
}
type CommunicationMetricsResponse = Record<string, number | string | null | undefined>
type CommunicationThreadCounts = {
  total: number
  all_active: number
  unassigned: number
  mine: number
  needs_human?: number
  awaiting_human?: number
  awaiting_ai?: number
  awaiting_user?: number
  escalated?: number
  resolved?: number
  sla_breach: number
  failed_risk: number
  by_workflow: Record<string, number>
  by_channel: Record<string, number>
}
type CommunicationThreadPage = {
  sort: string
  limit: number
  returned: number
  matched?: number
  has_more: boolean
  next_cursor: string | null
  mode?: string
}
type CommunicationChannelIdentity = {
  id?: string
  user_id?: string | null
  display_name?: string | null
  normalized_address?: string | null
  external_id?: string | null
  channel?: string | null
  provider?: string | null
  verified?: boolean | null
  consent_status?: string | null
}
type CommunicationDeliveryAttempt = {
  id: string
  attempt_number?: number
  provider?: string | null
  channel?: string | null
  message_id?: string | null
  provider_request_id?: string | null
  provider_message_id?: string | null
  status?: string | null
  error_code?: string | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  next_retry_at?: string | null
}
type CommunicationPreferencesRow = {
  preferred_channel?: string | null
  timezone?: string | null
  language?: string | null
  consent_status?: string | null
  consent_version?: string | null
  consented_at?: string | null
  whatsapp_enabled?: boolean
  telegram_enabled?: boolean
  email_enabled?: boolean
  sms_enabled?: boolean
  push_enabled?: boolean
  in_app_enabled?: boolean
  marketing_enabled?: boolean
}
type CommunicationAuditEvent = {
  id: string
  event_type: string
  actor_type?: string | null
  actor_id?: string | null
  channel?: string | null
  summary?: string | null
  correlation_id?: string | null
  thread_id?: string | null
  message_id?: string | null
  notification_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export function useCarUpApi() {
  const { user, token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(async <T = any>(path: string, options?: RequestInit): Promise<T> => {
    setLoading(true)
    setError(null)

    // Build identity headers from current auth state. These are sent on every request AND used to
    // bind the CSRF token, so an unsafe request always carries a token bound to its own identity.
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (user?.id) authHeaders['x-user-id'] = user.id
    if (user?.role) authHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) authHeaders['x-tenant-id'] = user.active_tenant_id

    try {
      const data = await apiRequest<T>({ baseUrl: BASE_URL, path, options, authHeaders })
      setLoading(false)
      return data
    } catch (err: unknown) {
      setLoading(false)
      const errMsg = err instanceof Error ? err.message : 'Something went wrong'
      setError(errMsg)
      console.error(`CarUp API Error (${path}):`, err)
      throw err
    }
  }, [user, token])

  const switchRole = useCallback(async (userId: string, role: string): Promise<any> => {
    return request('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ userId, role })
    })
  }, [request])

  const fetchVehicles = useCallback(async (filters?: Record<string, string | number | boolean | undefined>): Promise<Vehicle[]> => {
    const query = filters 
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      : ''
    return request<Vehicle[]>(`/vehicles${query}`)
  }, [request])

  const fetchMarketplaceListings = useCallback(async (filters?: Record<string, string | number | boolean | undefined>): Promise<MarketplaceListingsResponse> => {
    const query = filters
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([_, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : ''
    return request<MarketplaceListingsResponse>(`/marketplace/listings${query}`)
  }, [request])

  const fetchMarketplaceNavCoverage = useCallback(async (): Promise<NavCoverageResponse> => {
    return request<NavCoverageResponse>('/marketplace/nav-coverage')
  }, [request])

  // ── Marketplace v1 (detail / inquiry / save / compare / recommendations / AI) ──
  const fetchMarketplaceListingDetail = useCallback(async (vin: string, attribution?: { ref?: string; campaign?: string; source?: string }): Promise<MarketplaceListingDetail> => {
    const query = attribution
      ? '?' + new URLSearchParams(Object.entries(attribution).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString()
      : ''
    return request<MarketplaceListingDetail>(`/marketplace/listings/${encodeURIComponent(vin)}${query}`)
  }, [request])

  const fetchMarketplaceCategories = useCallback(async (): Promise<{ listing_types: { slug: string; label: string }[]; condition_categories: { slug: string; label: string }[]; trust_tags: { slug: string; label: string }[] }> => {
    return request('/marketplace/categories')
  }, [request])

  const fetchMarketplaceRecommendations = useCallback(async (vin: string): Promise<MarketplaceListingsResponse> => {
    return request<MarketplaceListingsResponse>(`/marketplace/recommendations?vin=${encodeURIComponent(vin)}`)
  }, [request])

  const fetchMarketplaceParts = useCallback(async (filters?: Record<string, string | number | undefined>): Promise<{ listings: any[]; total: number; governed?: boolean; note?: string }> => {
    const query = filters ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
    return request(`/marketplace/parts${query}`)
  }, [request])

  const fetchMarketplaceServices = useCallback(async (filters?: Record<string, string | number | undefined>): Promise<{ listings: any[]; total: number; governed?: boolean; note?: string }> => {
    const query = filters ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : ''
    return request(`/marketplace/services${query}`)
  }, [request])

  const compareMarketplaceListings = useCallback(async (vins: string[]): Promise<{ listings: any[]; total: number }> => {
    return request('/marketplace/compare', { method: 'POST', body: JSON.stringify({ vins }) })
  }, [request])

  const createMarketplaceInquiry = useCallback(async (payload: MarketplaceInquiryInput): Promise<{ inquiry: MarketplaceInquiry }> => {
    return request('/marketplace/inquiries', { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const saveMarketplaceListing = useCallback(async (vin: string): Promise<{ saved: boolean; vin: string }> => {
    return request(`/marketplace/listings/${encodeURIComponent(vin)}/save`, { method: 'POST', body: JSON.stringify({}) })
  }, [request])

  const unsaveMarketplaceListing = useCallback(async (vin: string): Promise<{ saved: boolean; vin: string }> => {
    return request(`/marketplace/listings/${encodeURIComponent(vin)}/save`, { method: 'DELETE' })
  }, [request])

  const fetchSavedMarketplaceListings = useCallback(async (): Promise<MarketplaceListingsResponse> => {
    return request<MarketplaceListingsResponse>('/marketplace/saved')
  }, [request])

  const fetchMyMarketplaceInquiries = useCallback(async (): Promise<{ inquiries: any[] }> => {
    return request('/marketplace/my-listings/inquiries')
  }, [request])

  const marketplaceAiListingDraft = useCallback(async (payload: Record<string, unknown>): Promise<any> =>
    request('/marketplace/ai/listing-draft', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const marketplaceAiBuyerAssistant = useCallback(async (payload: Record<string, unknown>): Promise<any> =>
    request('/marketplace/ai/buyer-assistant', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const marketplaceAiPriceEstimate = useCallback(async (payload: Record<string, unknown>): Promise<any> =>
    request('/marketplace/ai/price-estimate', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const marketplaceAiShareCopy = useCallback(async (payload: Record<string, unknown>): Promise<any> =>
    request('/marketplace/ai/share-copy', { method: 'POST', body: JSON.stringify(payload) }), [request])

  // ── Admin marketplace command center ──
  const fetchAdminMarketplaceListings = useCallback(async (filters?: { public_status?: string; risk_status?: string }): Promise<{ listings: any[]; total: number }> => {
    const query = filters ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString() : ''
    return request(`/admin/marketplace/listings${query}`)
  }, [request])
  const fetchAdminMarketplaceListingDetail = useCallback(async (vin: string): Promise<MarketplaceListingDetail> =>
    request<MarketplaceListingDetail>(`/admin/marketplace/listings/${encodeURIComponent(vin)}`), [request])
  const moderateMarketplaceListing = useCallback(async (vin: string, action: 'approve' | 'reject' | 'suppress' | 'request-evidence' | 'flag-risk' | 'clear-risk', body?: { reason?: string; notes?: string }): Promise<any> =>
    request(`/admin/marketplace/listings/${encodeURIComponent(vin)}/${action}`, { method: 'PATCH', body: JSON.stringify(body || {}) }), [request])
  const fetchAdminMarketplaceInquiries = useCallback(async (filters?: { status?: string; inquiry_type?: string; risk_status?: string }): Promise<{ inquiries: any[] }> => {
    const query = filters ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString() : ''
    return request(`/admin/marketplace/inquiries${query}`)
  }, [request])
  const assignMarketplaceInquiry = useCallback(async (id: string, operatorId: string): Promise<any> =>
    request(`/admin/marketplace/inquiries/${encodeURIComponent(id)}/assign`, { method: 'PATCH', body: JSON.stringify({ operator_id: operatorId }) }), [request])
  const setMarketplaceInquiryStatus = useCallback(async (id: string, status: string): Promise<any> =>
    request(`/admin/marketplace/inquiries/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }), [request])
  const fetchMarketplaceAnalytics = useCallback(async (): Promise<any> =>
    request('/admin/marketplace/analytics'), [request])
  const marketplaceAiModerationSummary = useCallback(async (payload: { vin?: string; listingSummary?: unknown; trustSummary?: unknown }): Promise<any> =>
    request('/admin/marketplace/ai/moderation-summary', { method: 'POST', body: JSON.stringify(payload) }), [request])

  const fetchDealerInventory = useCallback(async (): Promise<Vehicle[]> => {
    return request<Vehicle[]>('/vehicles/inventory')
  }, [request])

  const fetchVehiclePassport = useCallback(async (vin: string): Promise<VehiclePassport> => {
    return request<VehiclePassport>(`/vehicles/${vin}/passport`)
  }, [request])

  const fetchVehicleEvidenceTimeline = useCallback(async (vin: string): Promise<{ vin: string; timeline: TimelineEvent[]; evidence: VehicleEvidence[] }> => {
    return request<{ vin: string; timeline: TimelineEvent[]; evidence: VehicleEvidence[] }>(`/vehicles/${vin}/evidence/timeline`)
  }, [request])

  const fetchEvidenceReviewQueue = useCallback(async (status = 'pending'): Promise<VehicleEvidence[]> => {
    return request<VehicleEvidence[]>(`/evidence/review?status=${encodeURIComponent(status)}`)
  }, [request])

  const fetchTrustReviewQueue = useCallback(async (filters?: {
    status?: TrustFactReviewStatus;
    trust_fact?: TrustFactName | 'all';
    vin?: string;
  }): Promise<TrustFactReviewQueueResponse> => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.trust_fact && filters.trust_fact !== 'all') params.set('trust_fact', filters.trust_fact)
    if (filters?.vin) params.set('vin', filters.vin)
    const query = params.toString()
    return request<TrustFactReviewQueueResponse>(`/verification/review-queue${query ? `?${query}` : ''}`)
  }, [request])

  const approveTrustFactRequest = useCallback(async (requestId: string, payload: TrustFactDecisionPayload): Promise<TrustFactDecisionResponse> => {
    return request<TrustFactDecisionResponse>(`/verification/trust-facts/${requestId}/approve`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])

  const rejectTrustFactRequest = useCallback(async (requestId: string, payload: TrustFactDecisionPayload): Promise<TrustFactDecisionResponse> => {
    return request<TrustFactDecisionResponse>(`/verification/trust-facts/${requestId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])

  const revokeTrustFactRequest = useCallback(async (requestId: string, payload: TrustFactDecisionPayload): Promise<TrustFactDecisionResponse> => {
    return request<TrustFactDecisionResponse>(`/verification/trust-facts/${requestId}/revoke`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])

  const fetchTrustAuditTrail = useCallback(async (vin: string): Promise<TrustAuditTrailResponse> => {
    return request<TrustAuditTrailResponse>(`/verification/audit-trail/${encodeURIComponent(vin)}`)
  }, [request])

  const fetchVehicleEvidence = useCallback(async (vin: string): Promise<VehicleEvidence[]> => {
    return request<VehicleEvidence[]>(`/vehicles/${encodeURIComponent(vin)}/evidence`)
  }, [request])

  const approveEvidence = useCallback(async (vin: string, evidenceId: string, notes: string, trustScoreImpact = 3): Promise<{ success: boolean; evidence: VehicleEvidence }> => {
    return request<{ success: boolean; evidence: VehicleEvidence }>(`/vehicles/${vin}/evidence/${evidenceId}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ notes, trust_score_impact: trustScoreImpact })
    })
  }, [request])

  const rejectEvidence = useCallback(async (vin: string, evidenceId: string, notes: string, trustScoreImpact = -5): Promise<{ success: boolean; evidence: VehicleEvidence }> => {
    return request<{ success: boolean; evidence: VehicleEvidence }>(`/vehicles/${vin}/evidence/${evidenceId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ notes, trust_score_impact: trustScoreImpact })
    })
  }, [request])

  const lookupVehiclePassport = useCallback(async (identifier: string): Promise<VehiclePassport> => {
    return request<VehiclePassport>(`/vehicles/passport/lookup/${identifier}`)
  }, [request])

  const verifyLedger = useCallback(async (vin: string): Promise<{ integrity: string; verified: boolean }> => {
    return request<{ integrity: string; verified: boolean }>(`/vehicles/${vin}/verify-ledger`)
  }, [request])

  const fetchVehicle = useCallback(async (vin: string): Promise<Vehicle> => {
    return request<Vehicle>(`/vehicles/${vin}/details`)
  }, [request])

  const runOdometerAudit = useCallback(async (vin: string): Promise<any> => {
    return request(`/vehicles/${vin}/odometer-audit`)
  }, [request])

  const createSafePayEscrow = useCallback(async (vin: string, sellerId: string, amount: number, currency = 'USD'): Promise<any> => {
    return request('/safepay/create', {
      method: 'POST',
      body: JSON.stringify({ vin, sellerId, amount, currency })
    })
  }, [request])

  const fetchSafePayEscrows = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/safepay/list')
  }, [request])

  const updateSafePayEscrow = useCallback(async (id: string, status: string, details?: Record<string, unknown>): Promise<any> => {
    return request(`/safepay/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status, details })
    })
  }, [request])

  const addRepairLog = useCallback(async (vin: string, mechanicId: string, partName: string, partOem: string, actionType: string, description: string, mileage: number): Promise<any> => {
    return request('/partsentry/add', {
      method: 'POST',
      body: JSON.stringify({ vin, mechanicId, partName, partOem, actionType, description, mileage })
    })
  }, [request])

  const fetchRepairHistory = useCallback(async (vin: string): Promise<any[]> => {
    return request<any[]>(`/partsentry/${vin}`)
  }, [request])

  const runOcrParsing = useCallback(async (docType: string, base64Data: string): Promise<any> => {
    return request('/ai/ocr', {
      method: 'POST',
      body: JSON.stringify({ docType, base64Data })
    })
  }, [request])

  const runFraudScan = useCallback(async (vin: string, price: number, listingTitle: string): Promise<any> => {
    return request('/ai/fraud-scan', {
      method: 'POST',
      body: JSON.stringify({ vin, price, listingTitle })
    })
  }, [request])

  const runRiskAssessment = useCallback(async (vin: string, mileage: number, basePrice: number): Promise<any> => {
    return request('/ai/risk-assessment', {
      method: 'POST',
      body: JSON.stringify({ vin, mileage, basePrice })
    })
  }, [request])

  const submitFinancing = useCallback(async (vin: string, customerId: string, bankId: string, requestedAmount: number): Promise<ApiMutationResponse> => {
    return request<ApiMutationResponse>('/finance/pre-approve', {
      method: 'POST',
      body: JSON.stringify({ vin, customerId, bankId, requestedAmount })
    })
  }, [request])

  const fetchInsuranceQuote = useCallback(async (vin: string, userId: string): Promise<any> => {
    return request('/insurance/quote', {
      method: 'POST',
      body: JSON.stringify({ vin, userId })
    })
  }, [request])

  const fetchZimraDuty = useCallback(async (price: number, year: number, engineCc?: number): Promise<any> => {
    return request('/import/duty-estimate', {
      method: 'POST',
      body: JSON.stringify({ price, year, engineCc })
    })
  }, [request])

  const fetchDiasporaImportOrders = useCallback(async (): Promise<DiasporaImportOrder[]> => {
    const response = await request<{ data: DiasporaImportOrder[] }>('/diaspora/import-orders')
    return response.data || []
  }, [request])

  const createDiasporaImportOrder = useCallback(async (payload: DiasporaImportOrderPayload): Promise<DiasporaImportOrder> => {
    return request<DiasporaImportOrder>('/diaspora/import-orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const fetchDiasporaImportOrder = useCallback(async (id: string): Promise<DiasporaImportOrder> => {
    return request<DiasporaImportOrder>(`/diaspora/import-orders/${encodeURIComponent(id)}`)
  }, [request])

  const fetchDiasporaTradeDocuments = useCallback(async (importOrderId: string): Promise<DiasporaTradeDocument[]> => {
    const response = await request<{ data: DiasporaTradeDocument[] }>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/documents`)
    return response.data || []
  }, [request])

  const uploadDiasporaDocument = useCallback(async (file: File, documentType: string, importOrderId: string): Promise<{ storagePath: string; docType: string; uploadedBy: string }> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    return request<{ storagePath: string; docType: string; uploadedBy: string }>('/media/upload/document', {
      method: 'POST',
      body: JSON.stringify({
        document: base64,
        docType: documentType,
        vin: importOrderId
      })
    })
  }, [request])

  const createDiasporaTradeDocument = useCallback(async (importOrderId: string, payload: { document_type: string; file_name?: string; storage_path?: string; metadata?: Record<string, unknown> }): Promise<DiasporaTradeDocument> => {
    return request<DiasporaTradeDocument>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/documents`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const fetchDiasporaTradeDocument = useCallback(async (documentId: string): Promise<DiasporaTradeDocument> => {
    return request<DiasporaTradeDocument>(`/diaspora/documents/${encodeURIComponent(documentId)}`)
  }, [request])

  const runDiasporaDocumentExtraction = useCallback(async (documentId: string, payload: { extraction_provider?: string; extracted_fields?: Record<string, unknown>; confidence_score?: number; raw_response?: Record<string, unknown> }): Promise<DiasporaTradeDocument> => {
    return request<DiasporaTradeDocument>(`/diaspora/documents/${encodeURIComponent(documentId)}/extractions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const runDiasporaOcr = useCallback(async (documentId: string): Promise<{ extraction: DiasporaTradeDocument; ocr: { success: boolean; ocrDocumentId: string; qualityMetrics: Record<string, unknown> } }> => {
    return request(`/diaspora/documents/${encodeURIComponent(documentId)}/run-ocr`, {
      method: 'POST'
    })
  }, [request])

  const verifyDiasporaTradeDocument = useCallback(async (documentId: string, payload: { notes?: string; metadata?: Record<string, unknown> }): Promise<DiasporaTradeDocument> => {
    return request<DiasporaTradeDocument>(`/diaspora/documents/${encodeURIComponent(documentId)}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const rejectDiasporaTradeDocument = useCallback(async (documentId: string, payload: { reason: string; notes?: string; metadata?: Record<string, unknown> }): Promise<DiasporaTradeDocument> => {
    return request<DiasporaTradeDocument>(`/diaspora/documents/${encodeURIComponent(documentId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const fetchDiasporaComplianceReviews = useCallback(async (): Promise<DiasporaComplianceReview[]> => {
    const response = await request<{ data: DiasporaComplianceReview[] }>('/diaspora/compliance')
    return response.data || []
  }, [request])

  // --- Container reservation + shipment tracking (read-path + buyer reservation request) ---
  const fetchDiasporaReservations = useCallback(async (importOrderId: string): Promise<DiasporaCargoReservation[]> => {
    const response = await request<{ data: DiasporaCargoReservation[] }>(`/diaspora/reservations?importOrderId=${encodeURIComponent(importOrderId)}`)
    return response.data || []
  }, [request])

  const fetchDiasporaShipments = useCallback(async (importOrderId: string): Promise<DiasporaShipment[]> => {
    const response = await request<{ data: DiasporaShipment[] }>(`/diaspora/shipments?importOrderId=${encodeURIComponent(importOrderId)}`)
    return response.data || []
  }, [request])

  const fetchDiasporaOpenContainers = useCallback(async (): Promise<DiasporaContainerShipment[]> => {
    const response = await request<{ data: DiasporaContainerShipment[] }>('/diaspora/containers?status=BOOKING_OPEN')
    return response.data || []
  }, [request])

  const createDiasporaReservation = useCallback(async (payload: DiasporaCargoReservationPayload): Promise<DiasporaCargoReservation> => {
    return request<DiasporaCargoReservation>('/diaspora/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }, [request])

  // Admin/logistics only (UI role-gated). Backend route: POST /diaspora/reservations/:id/{approve|reject}
  // approve/reject are admin/reviewer only; cancel is allowed for the reservation owner (backend-enforced).
  const updateDiasporaReservationStatus = useCallback(async (reservationId: string, action: 'approve' | 'reject' | 'cancel'): Promise<DiasporaCargoReservation> => {
    return request<DiasporaCargoReservation>(`/diaspora/reservations/${encodeURIComponent(reservationId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }, [request])

  // Logistics/admin lifecycle (backend role-gated): create a shipment for an order, advance its stage.
  const createDiasporaShipment = useCallback(async (importOrderId: string): Promise<DiasporaShipment> => {
    return request<DiasporaShipment>('/diaspora/shipments', {
      method: 'POST',
      body: JSON.stringify({ import_order_id: importOrderId }),
    })
  }, [request])

  const updateDiasporaShipmentStage = useCallback(async (shipmentId: string, stage: string): Promise<{ shipment: DiasporaShipment }> => {
    return request<{ shipment: DiasporaShipment }>(`/diaspora/shipments/${encodeURIComponent(shipmentId)}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage }),
    })
  }, [request])

  const fetchDiasporaWorkbookOperatorDashboard = useCallback(async (filters?: DiasporaWorkbookOperatorDashboardFilters): Promise<DiasporaWorkbookOperatorDashboard> => {
    const query = filters
      ? '?' + new URLSearchParams(
        Object.entries(filters)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)])
      ).toString()
      : ''
    return request<DiasporaWorkbookOperatorDashboard>(`/diaspora/workbook/operator-dashboard${query}`)
  }, [request])

  const fetchDiasporaWorkbookOperatorBatchSummary = useCallback(async (batchId: string): Promise<DiasporaWorkbookOperatorBatchSummary> => {
    const response = await request<{ data: DiasporaWorkbookOperatorBatchSummary }>(`/diaspora/workbook/import-batches/${encodeURIComponent(batchId)}/operator-summary`)
    return response.data
  }, [request])

  const fetchDiasporaWorkbookOperatorNextActions = useCallback(async (batchId: string): Promise<DiasporaWorkbookOperatorNextActions> => {
    const response = await request<{ data: DiasporaWorkbookOperatorNextActions }>(`/diaspora/workbook/import-batches/${encodeURIComponent(batchId)}/next-actions`)
    return response.data
  }, [request])

  const addDiasporaWorkbookOperatorNote = useCallback(async (batchId: string, note: string): Promise<{ data?: unknown; note: DiasporaWorkbookOperatorNote }> => {
    return request<{ data?: unknown; note: DiasporaWorkbookOperatorNote }>(`/diaspora/workbook/import-batches/${encodeURIComponent(batchId)}/operator-notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    })
  }, [request])

  const setDiasporaWorkbookOperatorHold = useCallback(async (batchId: string, reason: string): Promise<DiasporaWorkbookOperatorHold> => {
    const response = await request<{ data: DiasporaWorkbookOperatorHold }>(`/diaspora/workbook/import-batches/${encodeURIComponent(batchId)}/operator-hold`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    return response.data
  }, [request])

  const clearDiasporaWorkbookOperatorHold = useCallback(async (batchId: string): Promise<DiasporaWorkbookOperatorHold> => {
    const response = await request<{ data: DiasporaWorkbookOperatorHold }>(`/diaspora/workbook/import-batches/${encodeURIComponent(batchId)}/operator-hold`, {
      method: 'DELETE',
    })
    return response.data
  }, [request])

  const fetchDiasporaWorkbookTemplateSchema = useCallback(async (templateType: string): Promise<DiasporaWorkbookTemplateSchemaResponse> => {
    const query = templateType ? `?templateType=${encodeURIComponent(templateType)}` : ''
    return request<DiasporaWorkbookTemplateSchemaResponse>(`/diaspora/workbook/template-schema${query}`)
  }, [request])

  const fetchDiasporaWorkbookTemplateDownloadStatus = useCallback(async (templateType: string): Promise<DiasporaWorkbookTemplateDownloadStatus> => {
    const query = templateType ? `?templateType=${encodeURIComponent(templateType)}` : ''
    return request<DiasporaWorkbookTemplateDownloadStatus>(`/diaspora/workbook/download-template${query}`)
  }, [request])

  const runDiasporaWorkbookDryRun = useCallback(async (payload: DiasporaWorkbookDryRunPayload): Promise<DiasporaWorkbookDryRunResult> => {
    const response = await request<{ data: DiasporaWorkbookDryRunResult }>('/diaspora/workbook/dry-run', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return response.data
  }, [request])

  const reportStolen = useCallback(async (vin: string, policeReportNumber: string, ownerId: string): Promise<any> => {
    return request('/security/report-stolen', {
      method: 'POST',
      body: JSON.stringify({ vin, policeReportNumber, ownerId })
    })
  }, [request])

  const checkStolen = useCallback(async (vin: string): Promise<any> => {
    return request(`/security/check-stolen/${vin}`)
  }, [request])

  const fetchDealerReputation = useCallback(async (dealerId: string): Promise<any> => {
    return request(`/reputation/${dealerId}`)
  }, [request])

  const fetchRecommendations = useCallback(async (vin: string): Promise<any> => {
    return request(`/vehicles/${vin}/recommendations`)
  }, [request])

  const reserveVehicle = useCallback(async (vin: string, buyerId: string, duration = 7): Promise<any> => {
    return request(`/vehicles/${vin}/reserve`, {
      method: 'POST',
      body: JSON.stringify({ buyerId, duration })
    })
  }, [request])

  // --- Domain 1: Dealer & Mechanic ---
  const fetchDealerLeads = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/leads')
  }, [request])

  const fetchDealerPromotions = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/promotions')
  }, [request])

  const createDealerPromotion = useCallback(async (data: Record<string, unknown>): Promise<any> => {
    return request('/promotions', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchMechanicWorkOrders = useCallback(async (): Promise<WorkOrder[]> => {
    return request<WorkOrder[]>('/mechanic/work-orders')
  }, [request])

  const createMechanicWorkOrder = useCallback(async (data: { vin: string; customer_name: string; issue_description: string }): Promise<any> => {
    return request('/mechanic/work-orders', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchMechanicParts = useCallback(async (): Promise<Part[]> => {
    return request<Part[]>('/mechanic/parts')
  }, [request])

  const createMechanicPart = useCallback(async (data: Omit<Part, 'id' | 'stock' | 'price'>): Promise<any> => {
    return request('/mechanic/parts', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchTelemetry = useCallback(async (): Promise<any> => {
    return request('/telemetry')
  }, [request])

  const fetchFinanceApplications = useCallback(async (): Promise<any[]> => {
    const data = await request<any[]>('/finance/applications')
    return data.map((app) => ({
      ...app,
      make: app.vehicles?.make,
      model: app.vehicles?.model,
      year: app.vehicles?.year,
      user_name: app.users?.name || 'Unknown User'
    }))
  }, [request])

  const updateFinanceApplicationStatus = useCallback(async (id: string, status: string): Promise<any> => {
    return request(`/finance/applications/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status })
    })
  }, [request])

  const fetchClaims = useCallback(async (): Promise<Claim[]> => {
    return request<Claim[]>('/insurance/claims')
  }, [request])

  const updateClaimStatus = useCallback(async (id: string, status: string): Promise<any> => {
    return request(`/insurance/claims/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  }, [request])

  const fetchFraudAlerts = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/security/fraud-alerts')
  }, [request])

  const resolveFraudAlert = useCallback(async (id: string): Promise<any> => {
    return request(`/security/fraud-alerts/${id}/resolve`, {
      method: 'PATCH'
    })
  }, [request])

  const fetchComplianceReports = useCallback(async (): Promise<any> => {
    return request('/compliance/reports')
  }, [request])

  const fetchRegistryVerifications = useCallback(async (): Promise<RegistryVerification[]> => {
    return request<RegistryVerification[]>('/compliance/registry')
  }, [request])

  const updateRegistryVerification = useCallback(async (id: string, status: string, notes?: string): Promise<any> => {
    return request(`/compliance/registry/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status, notes })
    })
  }, [request])

  const fetchServerHealth = useCallback(async (): Promise<any> => {
    return request('/admin/health')
  }, [request])

  const fetchUsers = useCallback(async (): Promise<User[]> => {
    return request<User[]>('/admin/users')
  }, [request])

  const suspendUser = useCallback(async (id: string): Promise<any> => {
    return request(`/admin/users/${id}/suspend`, {
      method: 'PATCH'
    })
  }, [request])

  const updateVehicleStatus = useCallback(async (vin: string, status: string): Promise<any> => {
    return request(`/vehicles/${vin}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  }, [request])

  // ==========================================
  // PHASE 5: OWNER & ADMIN OS HOOKS
  // ==========================================

  const fetchOwnedVehicles = useCallback(async (): Promise<Vehicle[]> => {
    return request<Vehicle[]>('/vehicles/me', { method: 'GET' })
  }, [request])

  const fetchSavedVehicles = useCallback(async (): Promise<Vehicle[]> => {
    return request<Vehicle[]>('/vehicles/saved', { method: 'GET' })
  }, [request])

  const unsaveVehicle = useCallback(async (vin: string): Promise<any> => {
    return request(`/vehicles/saved/${vin}`, { method: 'DELETE' })
  }, [request])

  const saveVehicle = useCallback(async (vin: string): Promise<any> => {
    return request('/vehicles/saved/add', { method: 'POST', body: JSON.stringify({ vin }) })
  }, [request])

  const fetchServiceHistory = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/service-history/me', { method: 'GET' })
  }, [request])

  const fetchNotifications = useCallback(async (): Promise<any[]> => {
    return request<any[]>('/notifications/me', { method: 'GET' })
  }, [request])

  // ── Agent 8 Omnichannel Communication Engine ──
  const fetchCommunicationThreads = useCallback(async (): Promise<{ threads: CommunicationThreadSummary[] }> => {
    return request('/communications/threads', { method: 'GET' })
  }, [request])

  const fetchCommunicationThread = useCallback(async (id: string): Promise<{ thread: CommunicationThreadSummary; messages: CommunicationMessageSummary[] }> => {
    return request(`/communications/threads/${encodeURIComponent(id)}`, { method: 'GET' })
  }, [request])

  const createCommunicationThread = useCallback(async (payload: Record<string, unknown>): Promise<{ thread: CommunicationThreadSummary }> => {
    return request('/communications/threads', { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const sendCommunicationMessage = useCallback(async (threadId: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/communications/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const sendCommunicationFeedback = useCallback(async (threadId: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/communications/threads/${encodeURIComponent(threadId)}/feedback`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const fetchCommunicationNotifications = useCallback(async (): Promise<{ notifications: CommunicationNotificationSummary[] }> => {
    return request('/communications/notifications', { method: 'GET' })
  }, [request])

  const markCommunicationNotificationRead = useCallback(async (id: string): Promise<CommunicationMutationResponse> => {
    return request(`/communications/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({}) })
  }, [request])

  const fetchCommunicationPreferences = useCallback(async (): Promise<{ preferences: CommunicationPreferences | null }> => {
    return request('/communications/preferences', { method: 'GET' })
  }, [request])

  const updateCommunicationPreferences = useCallback(async (payload: Record<string, unknown>): Promise<{ preferences: CommunicationPreferences }> => {
    return request('/communications/preferences', { method: 'PATCH', body: JSON.stringify(payload) })
  }, [request])

  const createCommunicationShare = useCallback(async (payload: Record<string, unknown>): Promise<{ share_url?: string; listing_url?: string }> => {
    return request('/communications/share', { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const fetchAdminCommunicationThreads = useCallback(async (filters?: Record<string, string | undefined>): Promise<{ threads: CommunicationThreadSummary[]; page?: CommunicationThreadPage; counts?: CommunicationThreadCounts }> => {
    const query = filters ? referralQuery(filters) : ''
    return request(`/admin/communications/threads${query}`, { method: 'GET' })
  }, [request])

  const fetchAdminCommunicationThread = useCallback(async (id: string): Promise<{
    thread: CommunicationThreadSummary
    messages: CommunicationMessageSummary[]
    participants: unknown[]
    escalations: unknown[]
    identities?: CommunicationChannelIdentity[]
    linked_identities?: CommunicationChannelIdentity[]
    delivery_attempts?: CommunicationDeliveryAttempt[]
    preferences?: CommunicationPreferencesRow | null
  }> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}`, { method: 'GET' })
  }, [request])

  const markAdminCommunicationThreadRead = useCallback(async (id: string): Promise<{ ok?: boolean; thread_id?: string; last_read_at?: string | null }> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({}) })
  }, [request])

  const fetchAdminCommunicationThreadAudit = useCallback(async (id: string): Promise<{ events: CommunicationAuditEvent[] }> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/audit`, { method: 'GET' })
  }, [request])

  const adminReplyCommunicationThread = useCallback(async (id: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const assignCommunicationThread = useCallback(async (id: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/assignment`, { method: 'PATCH', body: JSON.stringify(payload) })
  }, [request])

  const escalateCommunicationThread = useCallback(async (id: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/escalate`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const resolveCommunicationThread = useCallback(async (id: string, summary: string): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ summary }) })
  }, [request])

  const reopenCommunicationThread = useCallback(async (id: string, reason: string): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) })
  }, [request])

  const pauseCommunicationThreadSla = useCallback(async (id: string, reason: string): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/sla/pause`, { method: 'POST', body: JSON.stringify({ reason }) })
  }, [request])

  const resumeCommunicationThreadSla = useCallback(async (id: string): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/threads/${encodeURIComponent(id)}/sla/resume`, { method: 'POST', body: JSON.stringify({}) })
  }, [request])

  const fetchCommunicationDeadLetters = useCallback(async (): Promise<{ notifications: CommunicationNotificationSummary[] }> => {
    return request('/admin/communications/dead-letter', { method: 'GET' })
  }, [request])

  const retryCommunicationDeadLetter = useCallback(async (id: string, payload: Record<string, unknown> = {}): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/dead-letter/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const cancelCommunicationDeadLetter = useCallback(async (id: string, reason: string): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/dead-letter/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
  }, [request])

  const fetchCommunicationRecovery = useCallback(async (): Promise<{ categories: Record<string, CommunicationNotificationSummary[]>; counts: Record<string, number> }> => {
    return request('/admin/communications/recovery', { method: 'GET' })
  }, [request])

  const bulkRetryCommunicationRecovery = useCallback(async (ids: string[]): Promise<{ retried: number; failed: number; total: number; results: Array<{ id: string; ok: boolean; error?: string }> }> => {
    return request('/admin/communications/recovery/bulk-retry', { method: 'POST', body: JSON.stringify({ ids }) })
  }, [request])

  const requeueCommunicationDeadLetter = useCallback(async (id: string, payload: Record<string, unknown>): Promise<CommunicationMutationResponse> => {
    return request(`/admin/communications/dead-letter/${encodeURIComponent(id)}/requeue`, { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const fetchAdminCommunicationMetrics = useCallback(async (): Promise<CommunicationMetricsResponse> => {
    return request('/admin/communications/metrics', { method: 'GET' })
  }, [request])

  const fetchCommunicationWorkerHealth = useCallback(async (): Promise<{
    timestamp: string
    queue: {
      queued: number
      processing: number
      retry_scheduled: number
      dead_letter: number
      depth: number
      oldest_queued_seconds: number | null
      sla_threshold_seconds: number
      sla_breaching: number
    }
    telegram: { channel: string; provider: string; mode: string; available: boolean; missing?: string[] } | null
    adapters: Array<{ channel: string; provider: string; mode: string; available: boolean; missing?: string[] }>
    scheduler: {
      scheduler_type: string
      pg_cron_available: boolean
      pg_net_available?: boolean
      job_name?: string
      job_configured: boolean
      job_config?: { jobname: string; schedule: string; active: boolean } | null
      latest_run?: { start_time: string; end_time: string; status: string; return_message?: string } | null
      latest_success?: { start_time: string; end_time: string; status: string } | null
      latest_failure?: { start_time: string; end_time: string; status: string; return_message?: string } | null
      latest_http_call?: { status_code: number; created: string; timed_out: boolean } | null
      stale_lock_count: number
    }
    inspect?: Record<string, string>
  }> => {
    return request('/admin/communications/worker/health', { method: 'GET' })
  }, [request])

  // Provider smoke test: sends one real message through the Communication Engine's queue +
  // delivery-worker path. Admin-authed; refuses fake adapters server-side (ok:false / error).
  const sendCommunicationProviderSmokeTest = useCallback(async (payload: {
    channel?: string
    to: string
    message?: string
    client_message_id?: string
  }): Promise<{
    ok: boolean
    error?: string
    message?: string
    channel?: string
    provider?: string
    recipient?: string
    adapter?: { channel: string; provider: string; mode: string; available: boolean }
    thread_id?: string
    message_id?: string
    notification_id?: string
    correlation_token?: string
    delivery?: {
      status: string | null
      worker_result: string | null
      provider: string
      provider_message_id: string | null
      provider_request_id: string | null
      attempt_number: number | null
      error_code: string | null
      error_message: string | null
    }
    details?: unknown
    inspect?: Record<string, string>
  }> => {
    return request('/admin/communications/test/provider-smoke', { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const fetchAdminUsers = useCallback(async (): Promise<User[]> => {
    return request<User[]>('/users/management', { method: 'GET' })
  }, [request])

  const fetchAdminTelemetry = useCallback(async (): Promise<any> => {
    return request('/admin/stats', { method: 'GET' })
  }, [request])

  const createVehicleListing = useCallback(async (payload: any): Promise<any> => {
    return request('/vehicles/add', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const uploadVehicleImages = useCallback(async (vin: string, images: string[]): Promise<{ urls: string[] }> => {
    return request('/media/upload/vehicle', {
      method: 'POST',
      body: JSON.stringify({ vin, images })
    })
  }, [request])

  const uploadKycDocument = useCallback(async (docType: string, base64Data: string, nationalId: string): Promise<ApiMutationResponse> => {
    return request<ApiMutationResponse>('/media/upload/document', {
      method: 'POST',
      body: JSON.stringify({
        document: base64Data,
        docType: docType,
        vin: nationalId || 'KYC-DOCUMENTS'
      })
    })
  }, [request])

  const uploadEvidence = useCallback(async (vin: string, payload: {
    evidence_type: string;
    file: string; // base64 string
    captured_at?: string;
    visibility_level?: string;
    linked_registry_event_id?: string;
    verification_notes?: string;
  }): Promise<VehicleEvidence> => {
    return request<VehicleEvidence>(`/vehicles/${vin}/evidence/upload`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const linkEvidenceToEvent = useCallback(async (vin: string, evidenceId: string, payload: {
    linked_registry_event_id: string;
    event_type: string;
  }): Promise<{ success: boolean; evidence: VehicleEvidence }> => {
    return request<{ success: boolean; evidence: VehicleEvidence }>(`/vehicles/${vin}/evidence/${evidenceId}/link-event`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])


  // ── Referral Engine API (phases 1–7; mounted at /api/referrals) ──────────
  // NOTE (Phase E follow-up): the backend exposes NO list endpoints for referral
  // codes, coupons, local-marketplace leads, import routes, or disputes. Until the
  // additive GET-list endpoints land (see
  // docs/referral-ai-engine/REFERRAL_ENGINE_UI_MOBILE_INTEGRATION_PLAN.md §10/§11),
  // admin surfaces should derive those lists from getReferralAdminEvents(). Do not
  // add fabricated list methods here.

  // Foundation
  const listReferralCampaigns = useCallback((filters?: ReferralCampaignFilters): Promise<ReferralCampaignListResponse> =>
    request<ReferralCampaignListResponse>(`/referrals/campaigns${referralQuery(filters)}`), [request])
  const createReferralCampaign = useCallback((payload: Record<string, unknown>): Promise<ReferralCampaignResponse> =>
    request<ReferralCampaignResponse>('/referrals/campaigns', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const updateReferralCampaign = useCallback((id: string, payload: Record<string, unknown>): Promise<ReferralCampaignResponse> =>
    request<ReferralCampaignResponse>(`/referrals/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }), [request])
  const createReferralCode = useCallback((payload: Record<string, unknown>): Promise<ReferralCodeResponse> =>
    request<ReferralCodeResponse>('/referrals/codes', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const validateReferralCode = useCallback((payload: Record<string, unknown>): Promise<ReferralValidateResponse> =>
    request<ReferralValidateResponse>('/referrals/validate', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const getReferralCode = useCallback((code: string, query?: Record<string, string | undefined>): Promise<ReferralValidateResponse> =>
    request<ReferralValidateResponse>(`/referrals/codes/${encodeURIComponent(code)}${referralQuery(query)}`), [request])
  const createReferralShareAssets = useCallback((payload: Record<string, unknown>): Promise<ReferralShareAssetResponse> =>
    request<ReferralShareAssetResponse>('/referrals/share-assets', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralCoupon = useCallback((payload: Record<string, unknown>): Promise<ReferralCouponResponse> =>
    request<ReferralCouponResponse>('/referrals/coupons', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const applyReferralCoupon = useCallback((payload: Record<string, unknown>): Promise<ReferralCouponApplyResponse> =>
    request<ReferralCouponApplyResponse>('/referrals/coupons/apply', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const redeemReferralCoupon = useCallback((payload: Record<string, unknown>): Promise<ReferralCouponRedeemResponse> =>
    request<ReferralCouponRedeemResponse>('/referrals/coupons/redeem', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const getReferralWallet = useCallback((userId: string): Promise<ReferralWalletResponse> =>
    request<ReferralWalletResponse>(`/referrals/wallets/${encodeURIComponent(userId)}`), [request])
  const createReferralWalletTransaction = useCallback((payload: Record<string, unknown>): Promise<ReferralWalletTransactionResponse> =>
    request<ReferralWalletTransactionResponse>('/referrals/wallets/transactions', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const transitionReferralWalletTransaction = useCallback((id: string, status: string): Promise<ReferralWalletTransactionResponse> =>
    request<ReferralWalletTransactionResponse>(`/referrals/wallets/transactions/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }), [request])
  const getReferralAdminEvents = useCallback((filters?: ReferralAdminEventFilters): Promise<ReferralAdminEventsResponse> =>
    request<ReferralAdminEventsResponse>(`/referrals/admin/events${referralQuery(filters)}`), [request])

  // Phase E: real GET-list endpoints (replace the interim /admin/events views).
  const listReferralCodes = useCallback((filters?: ReferralListFilters): Promise<ReferralCodeListResponse> =>
    request<ReferralCodeListResponse>(`/referrals/codes${referralQuery(filters)}`), [request])
  const listReferralCoupons = useCallback((filters?: ReferralListFilters): Promise<ReferralCouponListResponse> =>
    request<ReferralCouponListResponse>(`/referrals/coupons${referralQuery(filters)}`), [request])
  const listReferralLocalMarketplaceLeads = useCallback((filters?: ReferralListFilters): Promise<ReferralLocalLeadListResponse> =>
    request<ReferralLocalLeadListResponse>(`/referrals/local-marketplace/leads${referralQuery(filters)}`), [request])
  const listReferralImportRoutes = useCallback((filters?: ReferralListFilters): Promise<ReferralImportRouteListResponse> =>
    request<ReferralImportRouteListResponse>(`/referrals/import-campaigns/routes${referralQuery(filters)}`), [request])
  const listReferralDisputes = useCallback((filters?: ReferralListFilters): Promise<ReferralDisputeListResponse> =>
    request<ReferralDisputeListResponse>(`/referrals/trust/disputes${referralQuery(filters)}`), [request])

  // Agent gateway
  const getReferralAgentTools = useCallback((context?: Record<string, string | undefined>): Promise<ReferralAgentToolsResponse> =>
    request<ReferralAgentToolsResponse>(`/referrals/agent/tools${referralQuery(context)}`), [request])
  const triageReferralAgent = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/agent/triage', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const executeReferralAgentTool = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/agent/execute', { method: 'POST', body: JSON.stringify(payload) }), [request])

  // Channels
  const processReferralChannelInbound = useCallback((channel: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/channels/${encodeURIComponent(channel)}/inbound`, { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralChannelShareKit = useCallback((channel: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/channels/${encodeURIComponent(channel)}/share-kit`, { method: 'POST', body: JSON.stringify(payload) }), [request])

  // Local marketplace
  const getReferralLocalMarketplaceRules = useCallback((): Promise<ReferralRuleCatalogResponse> =>
    request<ReferralRuleCatalogResponse>('/referrals/local-marketplace/rules'), [request])
  const createReferralLocalMarketplaceIntent = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/local-marketplace/intent', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralLocalMarketplaceLead = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/local-marketplace/leads', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralLocalMarketplaceBundle = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/local-marketplace/referral-bundles', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const qualifyReferralLocalMarketplaceLead = useCallback((leadEventId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/local-marketplace/leads/${encodeURIComponent(leadEventId)}/qualify`, { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralLocalMarketplaceShareKit = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/local-marketplace/share-kit', { method: 'POST', body: JSON.stringify(payload) }), [request])

  // Import campaigns
  const getReferralImportCampaignRules = useCallback((): Promise<ReferralRuleCatalogResponse> =>
    request<ReferralRuleCatalogResponse>('/referrals/import-campaigns/rules'), [request])
  const createReferralImportRoute = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/import-campaigns/routes', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const getReferralImportRouteStatus = useCallback((routeKey: string): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/import-campaigns/routes/${encodeURIComponent(routeKey)}/status`), [request])
  const updateReferralImportRouteCapacity = useCallback((routeKey: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/import-campaigns/routes/${encodeURIComponent(routeKey)}/capacity`, { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralImportBundle = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/import-campaigns/referral-bundles', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralImportLead = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/import-campaigns/leads', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const qualifyReferralImportLead = useCallback((leadEventId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/import-campaigns/leads/${encodeURIComponent(leadEventId)}/qualify`, { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralImportShareKit = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/import-campaigns/share-kit', { method: 'POST', body: JSON.stringify(payload) }), [request])

  // Marketing & SEO
  const getReferralMarketingRules = useCallback((): Promise<ReferralRuleCatalogResponse> =>
    request<ReferralRuleCatalogResponse>('/referrals/marketing/rules'), [request])
  const createReferralMarketingCampaignKit = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/campaign-kits', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralSeoPage = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/seo-pages', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralChannelMessage = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/channel-messages', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralProofStory = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/proof-stories', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralFaq = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/faqs', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const listReferralMarketingAssets = useCallback((filters?: ReferralMarketingAssetFilters): Promise<ReferralMarketingAssetListResponse> =>
    request<ReferralMarketingAssetListResponse>(`/referrals/marketing/assets${referralQuery(filters)}`), [request])
  const updateReferralMarketingAssetStatus = useCallback((assetId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { method: 'PATCH', body: JSON.stringify(payload) }), [request])
  const createReferralMarketingAnalyticsSuggestion = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/marketing/analytics/suggestions', { method: 'POST', body: JSON.stringify(payload) }), [request])

  // Trust, fraud & compliance
  const getReferralTrustRules = useCallback((): Promise<ReferralRuleCatalogResponse> =>
    request<ReferralRuleCatalogResponse>('/referrals/trust/rules'), [request])
  const runReferralRiskCheck = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/trust/risk-checks', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const createReferralReviewCase = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/trust/review-cases', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const listReferralReviewCases = useCallback((filters?: ReferralReviewCaseFilters): Promise<ReferralReviewCaseListResponse> =>
    request<ReferralReviewCaseListResponse>(`/referrals/trust/review-cases${referralQuery(filters)}`), [request])
  const decideReferralReviewCase = useCallback((caseEventId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/trust/review-cases/${encodeURIComponent(caseEventId)}/decision`, { method: 'PATCH', body: JSON.stringify(payload) }), [request])
  const applyReferralWalletHold = useCallback((transactionId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/trust/wallet-transactions/${encodeURIComponent(transactionId)}/hold`, { method: 'POST', body: JSON.stringify(payload) }), [request])
  const explainReferralBenefit = useCallback((transactionId: string): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/trust/benefits/${encodeURIComponent(transactionId)}/explain`), [request])
  const createReferralDispute = useCallback((payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>('/referrals/trust/disputes', { method: 'POST', body: JSON.stringify(payload) }), [request])
  const resolveReferralDispute = useCallback((disputeEventId: string, payload: Record<string, unknown>): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/trust/disputes/${encodeURIComponent(disputeEventId)}/resolve`, { method: 'PATCH', body: JSON.stringify(payload) }), [request])
  const exportReferralAudit = useCallback((filters?: ReferralAuditExportFilters): Promise<ReferralServiceResponse> =>
    request<ReferralServiceResponse>(`/referrals/trust/audit-export${referralQuery(filters)}`), [request])

  return {
    uploadKycDocument,
    uploadEvidence,
    linkEvidenceToEvent,
    createVehicleListing,
    uploadVehicleImages,
    fetchOwnedVehicles,
    fetchSavedVehicles,
    unsaveVehicle,
    saveVehicle,
    fetchServiceHistory,
    fetchNotifications,
    fetchCommunicationThreads,
    fetchCommunicationThread,
    createCommunicationThread,
    sendCommunicationMessage,
    sendCommunicationFeedback,
    fetchCommunicationNotifications,
    markCommunicationNotificationRead,
    fetchCommunicationPreferences,
    updateCommunicationPreferences,
    createCommunicationShare,
    fetchAdminCommunicationThreads,
    fetchAdminCommunicationThread,
    markAdminCommunicationThreadRead,
    fetchAdminCommunicationThreadAudit,
    adminReplyCommunicationThread,
    assignCommunicationThread,
    escalateCommunicationThread,
    resolveCommunicationThread,
    reopenCommunicationThread,
    pauseCommunicationThreadSla,
    resumeCommunicationThreadSla,
    fetchCommunicationDeadLetters,
    retryCommunicationDeadLetter,
    cancelCommunicationDeadLetter,
    fetchCommunicationRecovery,
    bulkRetryCommunicationRecovery,
    requeueCommunicationDeadLetter,
    fetchAdminCommunicationMetrics,
    fetchCommunicationWorkerHealth,
    sendCommunicationProviderSmokeTest,
    fetchAdminUsers,
    fetchAdminTelemetry,
  
    user,
    loading,
    error,
    switchRole,
    fetchVehicles,
    fetchMarketplaceListings,
    fetchMarketplaceNavCoverage,
    fetchMarketplaceListingDetail,
    fetchMarketplaceCategories,
    fetchMarketplaceRecommendations,
    fetchMarketplaceParts,
    fetchMarketplaceServices,
    compareMarketplaceListings,
    createMarketplaceInquiry,
    saveMarketplaceListing,
    unsaveMarketplaceListing,
    fetchSavedMarketplaceListings,
    fetchMyMarketplaceInquiries,
    marketplaceAiListingDraft,
    marketplaceAiBuyerAssistant,
    marketplaceAiPriceEstimate,
    marketplaceAiShareCopy,
    fetchAdminMarketplaceListings,
    fetchAdminMarketplaceListingDetail,
    moderateMarketplaceListing,
    fetchAdminMarketplaceInquiries,
    assignMarketplaceInquiry,
    setMarketplaceInquiryStatus,
    fetchMarketplaceAnalytics,
    marketplaceAiModerationSummary,
    fetchDealerInventory,
    fetchVehiclePassport,
    fetchVehicleEvidenceTimeline,
    fetchEvidenceReviewQueue,
    fetchTrustReviewQueue,
    approveTrustFactRequest,
    rejectTrustFactRequest,
    revokeTrustFactRequest,
    fetchTrustAuditTrail,
    fetchVehicleEvidence,
    approveEvidence,
    rejectEvidence,
    lookupVehiclePassport,
    fetchVehicle,
    verifyLedger,
    runOdometerAudit,
    createSafePayEscrow,
    fetchSafePayEscrows,
    updateSafePayEscrow,
    addRepairLog,
    fetchRepairHistory,
    runOcrParsing,
    runFraudScan,
    runRiskAssessment,
    submitFinancing,
    fetchInsuranceQuote,
    fetchZimraDuty,
    fetchDiasporaImportOrders,
    createDiasporaImportOrder,
    fetchDiasporaImportOrder,
    fetchDiasporaTradeDocuments,
    uploadDiasporaDocument,
    createDiasporaTradeDocument,
    fetchDiasporaTradeDocument,
    runDiasporaDocumentExtraction,
    runDiasporaOcr,
    verifyDiasporaTradeDocument,
    rejectDiasporaTradeDocument,
    fetchDiasporaComplianceReviews,
    fetchDiasporaReservations,
    fetchDiasporaShipments,
    fetchDiasporaOpenContainers,
    createDiasporaReservation,
    updateDiasporaReservationStatus,
    createDiasporaShipment,
    updateDiasporaShipmentStage,
    fetchDiasporaWorkbookOperatorDashboard,
    fetchDiasporaWorkbookOperatorBatchSummary,
    fetchDiasporaWorkbookOperatorNextActions,
    addDiasporaWorkbookOperatorNote,
    setDiasporaWorkbookOperatorHold,
    clearDiasporaWorkbookOperatorHold,
    fetchDiasporaWorkbookTemplateSchema,
    fetchDiasporaWorkbookTemplateDownloadStatus,
    runDiasporaWorkbookDryRun,
    reportStolen,
    checkStolen,
    fetchDealerReputation,
    fetchRecommendations,
    reserveVehicle,
    fetchDealerLeads,
    fetchDealerPromotions,
    createDealerPromotion,
    fetchMechanicWorkOrders,
    createMechanicWorkOrder,
    fetchMechanicParts,
    createMechanicPart,
    fetchTelemetry,
    fetchFinanceApplications,
    updateFinanceApplicationStatus,
    fetchClaims,
    updateClaimStatus,
    fetchFraudAlerts,
    resolveFraudAlert,
    fetchComplianceReports,
    fetchRegistryVerifications,
    updateRegistryVerification,
    fetchServerHealth,
    fetchUsers,
    suspendUser,
    updateVehicleStatus,

    // ── Referral Engine ──
    listReferralCampaigns,
    createReferralCampaign,
    updateReferralCampaign,
    createReferralCode,
    validateReferralCode,
    getReferralCode,
    createReferralShareAssets,
    createReferralCoupon,
    applyReferralCoupon,
    redeemReferralCoupon,
    getReferralWallet,
    createReferralWalletTransaction,
    transitionReferralWalletTransaction,
    getReferralAdminEvents,
    listReferralCodes,
    listReferralCoupons,
    listReferralLocalMarketplaceLeads,
    listReferralImportRoutes,
    listReferralDisputes,
    getReferralAgentTools,
    triageReferralAgent,
    executeReferralAgentTool,
    processReferralChannelInbound,
    createReferralChannelShareKit,
    getReferralLocalMarketplaceRules,
    createReferralLocalMarketplaceIntent,
    createReferralLocalMarketplaceLead,
    createReferralLocalMarketplaceBundle,
    qualifyReferralLocalMarketplaceLead,
    createReferralLocalMarketplaceShareKit,
    getReferralImportCampaignRules,
    createReferralImportRoute,
    getReferralImportRouteStatus,
    updateReferralImportRouteCapacity,
    createReferralImportBundle,
    createReferralImportLead,
    qualifyReferralImportLead,
    createReferralImportShareKit,
    getReferralMarketingRules,
    createReferralMarketingCampaignKit,
    createReferralSeoPage,
    createReferralChannelMessage,
    createReferralProofStory,
    createReferralFaq,
    listReferralMarketingAssets,
    updateReferralMarketingAssetStatus,
    createReferralMarketingAnalyticsSuggestion,
    getReferralTrustRules,
    runReferralRiskCheck,
    createReferralReviewCase,
    listReferralReviewCases,
    decideReferralReviewCase,
    applyReferralWalletHold,
    explainReferralBenefit,
    createReferralDispute,
    resolveReferralDispute,
    exportReferralAudit
  }
}
