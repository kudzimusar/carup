import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, DEFAULT_PRODUCTION_API_BASE_URL, extractApiErrorMessage, fetchCsrfToken, type AuthHeaders } from '@/lib/apiClient'
import {
  fetchVerificationReviewQueue as fetchVerificationReviewQueueRequest,
  fetchVerificationSessionDetail as fetchVerificationSessionDetailRequest,
  fetchEvidencePreview as fetchEvidencePreviewRequest,
  reviewVerificationSession as reviewVerificationSessionRequest,
  type VerificationAdminClientConfig,
} from '@/lib/verificationAdminApi'
import type {
  AdminVerificationSession,
  DecisionAction,
  DecisionResponse,
  EvidencePreview,
  VerificationReviewRequest,
  VerificationSessionStatus,
} from '@shared/types'
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
  EvidenceTaxonomyResponse,
  EvidenceSourcesResponse,
  TemporalFindingsResponse,
  DisclosureConflictsResponse,
  VehicleDocumentExtractionsResponse,
  ExtractionReviewDecisionPayload,
  VehicleDocumentExtraction,
  VehicleCompleteness,
  SourceCoverageEntry,
  TrustDecision,
  GovernanceTaskType,
  GovernanceReviewQueueResponse,
  GovernanceDecisionPayload,
  GovernanceDecisionResponse,
  VehicleDisputesResponse,
  SubmitDisputePayload,
  DisputeMutationResponse,
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
  DiasporaGovernmentDocument,
  DiasporaAuditEntry,
  DiasporaShipmentStageEvent,
  DiasporaTradeProfile,
  DiasporaTradeProfileInput,
  DiasporaTradeProfileUpdate,
  DiasporaPaymentMilestone,
  DiasporaPaymentMilestoneInput,
  DiasporaOwnershipHandoffStatus,
  DiasporaOwnershipHandoffResult,
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
  DiasporaWorkbookTemplateSchemaResponse,
  DiasporaStockItem,
  DiasporaStockItemPayload,
  DiasporaStockLedgerEntry,
  DiasporaStockMovementPayload,
  DiasporaStockMovementResult,
  DiasporaSupplyDocument,
  DiasporaSupplyDocumentPayload,
  DiasporaBuyerOrder,
  DiasporaBuyerOrderPayload,
  DiasporaQuote,
  DiasporaQuotePayload,
  DiasporaMatchCandidate,
  DiasporaAcceptQuoteResult,
  DiasporaAiParseResult,
  DiasporaAiCommand,
  DiasporaAiCommandCreateResult,
  DiasporaAiExecuteResult,
  DiasporaMarketplaceContainer,
  DiasporaMarketplaceContainerPayload,
  DiasporaContainerCapacityResult,
  DiasporaMarketplaceReservation,
  DiasporaReservationRequestPayload,
  DiasporaReservationActionResult,
  DiasporaDriveStatus,
  DiasporaDriveAuthUrl,
  DiasporaDriveFile,
  DiasporaDriveConnection,
  Plan,
  SubscriptionStatus,
  EffectiveEntitlements,
  UsageResponse,
  SandboxBillingActionResponse,
  SafeTradeTransaction,
  SafeTradeTimelineEvent,
  SafeTradeEligibilityVerdict,
  SafeTradeMilestone,
  SafeTradeDispute,
  SafeTradeDisputeEvidence,
  SafeTradeAvailableAction,
  SafeTradeActionResponse,
  SafeTradeCommitPayload,
  SafeTradeCommitEvent,
  SafeTradeCreateResponse,
  SafeTradeListResponse,
  SafeTradeEvaluateReleaseResponse,
  SafeTradeDisputeOpenResponse,
  SafeTradeDisputeResolveResponse,
  VehicleHistoryReportData,
  ReportVersionResponse,
  ReportShareLinkResponse,
  SharedReportResponse,
  SharedReportResult
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
  OwnerReferralDisputesResponse,
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
  team_unread_count?: number
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
type ProviderSmokeTestResult = {
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
    provider_http_status?: number | null
    provider_error_code?: number | string | null
    provider_error_subcode?: number | string | null
    provider_error_type?: string | null
    provider_error_message?: string | null
    provider_trace_id?: string | null
  }
  details?: unknown
  inspect?: Record<string, string>
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
type CommunicationProviderTelemetry = {
  channel: string
  provider?: string | null
  mode?: string | null
  available?: boolean
  webhook?: { path?: string | null; configured?: boolean; latest_inbound_at?: string | null; last_signature_valid?: boolean | null }
  outbound?: { latest_success_at?: string | null; latest_success_provider_message_id?: string | null }
  latest_error?: { at?: string | null; code?: string | null; message?: string | null } | null
  queue?: { queued?: number; retry_scheduled?: number; dead_letter?: number }
  credentials?: { complete?: boolean; missing?: string[] }
}
type CommunicationSlaPolicy = {
  id?: string
  name?: string
  tenant_id?: string | null
  channel?: string | null
  priority?: string | null
  first_response_minutes?: number | null
  next_response_minutes?: number | null
  resolution_minutes?: number | null
  business_timezone?: string | null
  business_hours?: Record<string, unknown> | null
  active?: boolean
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

  // Identity-verification admin review (Phase 7C). Built from the same auth
  // identity as `request` and delegated to the dedicated, unit-tested client
  // module so the page never issues raw fetches.
  const verificationClientConfig = useMemo<VerificationAdminClientConfig>(() => {
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (user?.id) authHeaders['x-user-id'] = user.id
    if (user?.role) authHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) authHeaders['x-tenant-id'] = user.active_tenant_id
    return { baseUrl: BASE_URL, authHeaders }
  }, [user, token])

  const fetchVerificationReviewQueue = useCallback(
    (filter?: VerificationSessionStatus | string | { workflow_phase?: string; status?: string }): Promise<AdminVerificationSession[]> =>
      fetchVerificationReviewQueueRequest(
        verificationClientConfig,
        typeof filter === 'string' ? { status: filter } : filter || undefined,
      ),
    [verificationClientConfig],
  )

  const fetchVerificationSessionDetail = useCallback(
    (sessionId: string): Promise<AdminVerificationSession> =>
      fetchVerificationSessionDetailRequest(verificationClientConfig, sessionId),
    [verificationClientConfig],
  )

  const fetchEvidencePreview = useCallback(
    (sessionId: string, side: 'front' | 'back' | 'selfie'): Promise<EvidencePreview> =>
      fetchEvidencePreviewRequest(verificationClientConfig, sessionId, side),
    [verificationClientConfig],
  )

  const reviewVerificationSession = useCallback(
    (sessionId: string, body: VerificationReviewRequest): Promise<{ decision: DecisionResponse['decision']; session: AdminVerificationSession; allowed_actions: DecisionAction[] }> =>
      reviewVerificationSessionRequest(verificationClientConfig, sessionId, body),
    [verificationClientConfig],
  )

  // Phase 7C case management: the new decision contract (reason codes, notes,
  // applicant messaging) with backend idempotency via x-idempotency-key.
  const reviewVerificationCase = useCallback(
    (
      sessionId: string,
      body: { action: string; reasonCode?: string | null; internalNote?: string | null; applicantMessage?: string | null },
      opts?: { idempotencyKey?: string },
    ): Promise<DecisionResponse> =>
      reviewVerificationSessionRequest(verificationClientConfig, sessionId, body, opts),
    [verificationClientConfig],
  )

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

  // ── Vehicle Life Evidence Taxonomy (M1): public discovery endpoints ──
  // GET /api/evidence/taxonomy — the eight life-stage classes, their subtypes,
  // and the legacy evidence_type → class map, used to drive upload forms and
  // to derive a life-stage class for legacy evidence records.
  const fetchEvidenceTaxonomy = useCallback(async (): Promise<EvidenceTaxonomyResponse> => {
    return request<EvidenceTaxonomyResponse>('/evidence/taxonomy')
  }, [request])

  // GET /api/evidence/sources — public-safe source registry.
  const fetchEvidenceSources = useCallback(async (): Promise<EvidenceSourcesResponse> => {
    return request<EvidenceSourcesResponse>('/evidence/sources')
  }, [request])

  // ── Vehicle Life Intelligence: Temporal Comparison + Disclosure (M3) ──
  // GET /api/vehicles/:vin/temporal-findings — component-change findings across the
  // vehicle's life. For buyers the backend returns only reviewer-CONFIRMED findings
  // in a public-safe shape (backend/routes/intelligenceRoutes.js); empty is expected
  // and correct for most buyer-facing vehicles.
  const fetchTemporalFindings = useCallback(async (vin: string): Promise<TemporalFindingsResponse> => {
    return request<TemporalFindingsResponse>(`/vehicles/${encodeURIComponent(vin)}/temporal-findings`)
  }, [request])

  // GET /api/vehicles/:vin/disclosure-conflicts — disclosure claims compared against
  // evidence. Buyers see only reviewer-CONFIRMED conflicts in a neutral public-safe
  // shape; empty is expected and correct for most buyer-facing vehicles.
  const fetchDisclosureConflicts = useCallback(async (vin: string): Promise<DisclosureConflictsResponse> => {
    return request<DisclosureConflictsResponse>(`/vehicles/${encodeURIComponent(vin)}/disclosure-conflicts`)
  }, [request])

  // ── OCR document extractions (Phase 12): admin/reviewer surface ──
  // GET /api/vehicles/:vin/extractions — per-field OCR results with match_status + per-field
  // confidence + review_status. Privileged roles only (backend enforces).
  const fetchVehicleExtractions = useCallback(async (
    vin: string,
    opts?: { evidenceId?: string; matchStatus?: string; pendingOnly?: boolean },
  ): Promise<VehicleDocumentExtractionsResponse> => {
    const qs = new URLSearchParams()
    if (opts?.evidenceId) qs.set('evidence_id', opts.evidenceId)
    if (opts?.matchStatus) qs.set('match_status', opts.matchStatus)
    if (opts?.pendingOnly) qs.set('pending_only', 'true')
    const q = qs.toString() ? `?${qs.toString()}` : ''
    return request<VehicleDocumentExtractionsResponse>(`/vehicles/${encodeURIComponent(vin)}/extractions${q}`)
  }, [request])

  // PATCH /api/vehicles/:vin/extractions/:id/review — reviewer decision. Only review_status +
  // mismatch_reason change; the extracted content stays immutable (no overwrite of the original).
  const reviewVehicleExtraction = useCallback(async (
    vin: string,
    extractionId: string,
    payload: ExtractionReviewDecisionPayload,
  ): Promise<{ extraction: VehicleDocumentExtraction }> => {
    return request<{ extraction: VehicleDocumentExtraction }>(`/vehicles/${encodeURIComponent(vin)}/extractions/${encodeURIComponent(extractionId)}/review`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  }, [request])

  // ── WS2/WS10 — Source coverage + unified trust decision (buyer-safe) ──────────
  const fetchVehicleSourceCoverage = useCallback(async (vin: string): Promise<{ coverage: SourceCoverageEntry[] }> => {
    return request<{ coverage: SourceCoverageEntry[] }>(`/vehicles/${encodeURIComponent(vin.toUpperCase())}/sources/coverage`)
  }, [request])

  const fetchVehicleTrustDecision = useCallback(async (vin: string): Promise<{ decision: TrustDecision }> => {
    return request<{ decision: TrustDecision }>(`/vehicles/${encodeURIComponent(vin.toUpperCase())}/trust-decision`)
  }, [request])

  // ── WS-A fraud queue + WS-B dealer compliance (admin/reviewer) ────────────────
  const fetchFraudCases = useCallback(async (filters?: { status?: string; severity?: string }): Promise<{ cases: unknown[] }> => {
    const qs = new URLSearchParams(filters as Record<string, string>).toString()
    return request<{ cases: unknown[] }>(`/fraud/cases${qs ? `?${qs}` : ''}`)
  }, [request])
  const fetchFraudCase = useCallback(async (id: string): Promise<{ case: unknown }> =>
    request<{ case: unknown }>(`/fraud/cases/${encodeURIComponent(id)}`), [request])
  const resolveFraudCase = useCallback(async (id: string, body: { resolution: string; reason: string }): Promise<unknown> =>
    request(`/fraud/cases/${encodeURIComponent(id)}/resolve`, { method: 'PATCH', body: JSON.stringify(body) }), [request])
  const evaluateVehicleFraud = useCallback(async (vin: string): Promise<unknown> =>
    request(`/vehicles/${encodeURIComponent(vin.toUpperCase())}/fraud/evaluate`, { method: 'POST' }), [request])
  const fetchDealers = useCallback(async (): Promise<{ dealers: unknown[] }> =>
    request<{ dealers: unknown[] }>(`/admin/dealers`), [request])
  const fetchDealer = useCallback(async (id: string): Promise<{ dealer: unknown }> =>
    request<{ dealer: unknown }>(`/admin/dealers/${encodeURIComponent(id)}`), [request])
  const recordDealerDecision = useCallback(async (id: string, body: { decision: string; requirement_key?: string; reason?: string }): Promise<unknown> =>
    request(`/admin/dealers/${encodeURIComponent(id)}/decision`, { method: 'PATCH', body: JSON.stringify(body) }), [request])
  const fetchMyDealerProfile = useCallback(async (): Promise<{ profile: unknown }> =>
    request<{ profile: unknown }>(`/dealer/profile`), [request])
  const saveMyDealerProfile = useCallback(async (body: Record<string, unknown>): Promise<unknown> =>
    request(`/dealer/profile`, { method: 'POST', body: JSON.stringify(body) }), [request])

  // ── Phase 4 — Publication completeness gate ──────────────────────────────────
  // GET /api/vehicles/:vin/completeness — deterministic requirements evaluator.
  // Returns blocking gaps, advisory gaps, completeness %, and publication_status.
  // Requires owner/dealer/admin/reviewer role (enforced on the server).
  const fetchVehicleCompleteness = useCallback(async (vin: string): Promise<VehicleCompleteness> => {
    return request<VehicleCompleteness>(`/vehicles/${encodeURIComponent(vin.toUpperCase())}/completeness`)
  }, [request])

  // ── Vehicle History Report (M4): buyer-facing report + owner version/share ──
  // GET /api/vehicles/:vin/report — assembled public-safe report. Audience is
  // derived server-side from role (optionalAuth); buyers receive only verified,
  // public-safe evidence and reviewer-confirmed findings. Missing data is reported
  // explicitly via `limitations` and never presented as a clean history.
  const fetchVehicleReport = useCallback(async (vin: string): Promise<VehicleHistoryReportData> => {
    return request<VehicleHistoryReportData>(`/vehicles/${encodeURIComponent(vin)}/report`)
  }, [request])

  // POST /api/vehicles/:vin/report/versions — snapshot an immutable version
  // (owner/dealer/admin/government, backend role-gated).
  const generateReportVersion = useCallback(async (vin: string): Promise<ReportVersionResponse> => {
    return request<ReportVersionResponse>(`/vehicles/${encodeURIComponent(vin)}/report/versions`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  }, [request])

  // POST /api/report-versions/:id/share — create an expiring share link
  // (owner/dealer/admin/government, backend role-gated).
  const createReportShareLink = useCallback(async (versionId: string, ttlSeconds?: number): Promise<ReportShareLinkResponse> => {
    return request<ReportShareLinkResponse>(`/report-versions/${encodeURIComponent(versionId)}/share`, {
      method: 'POST',
      body: JSON.stringify(ttlSeconds ? { ttl_seconds: ttlSeconds } : {})
    })
  }, [request])

  // GET /api/reports/shared/:token — PUBLIC, no auth. Resolved with a plain fetch
  // (not the auth/CSRF `request` helper) so the HTTP status is preserved: 410 for
  // expired/revoked links, 404 for missing tokens. Returns a discriminated result
  // the page renders distinct friendly states from.
  const fetchSharedReport = useCallback(async (token: string): Promise<SharedReportResult> => {
    try {
      const res = await fetch(`${BASE_URL}/reports/shared/${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = (await res.json()) as SharedReportResponse
        return { status: 'ok', data }
      }
      const body = await res.json().catch(() => ({}))
      const message = extractApiErrorMessage(body)
      if (res.status === 410) return { status: 'gone', reason: message || 'This shared report has expired or been revoked.' }
      if (res.status === 404) return { status: 'not_found' }
      return { status: 'error', message: message || `Unable to load shared report (status ${res.status}).` }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Unable to load shared report.' }
    }
  }, [])

  // --- Milestone 5: governance, disputes & corrections ---
  const fetchReviewQueue = useCallback(async (taskType?: GovernanceTaskType): Promise<GovernanceReviewQueueResponse> => {
    const query = taskType ? `?taskType=${encodeURIComponent(taskType)}` : ''
    return request<GovernanceReviewQueueResponse>(`/governance/review-queue${query}`)
  }, [request])

  const submitGovernanceDecision = useCallback(async (payload: GovernanceDecisionPayload): Promise<GovernanceDecisionResponse> => {
    return request<GovernanceDecisionResponse>('/governance/decisions', { method: 'POST', body: JSON.stringify(payload) })
  }, [request])

  const fetchVehicleDisputes = useCallback(async (vin: string): Promise<VehicleDisputesResponse> => {
    return request<VehicleDisputesResponse>(`/vehicles/${encodeURIComponent(vin)}/disputes`)
  }, [request])

  const submitDispute = useCallback(async (payload: SubmitDisputePayload): Promise<DisputeMutationResponse> => {
    return request<DisputeMutationResponse>('/governance/disputes', { method: 'POST', body: JSON.stringify(payload) })
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

  // --- Final-closure operability + passport reads. Backend stays authoritative on every action;
  // these controls are convenience — hidden/disabled UI is never the security boundary. ---
  const fetchDiasporaGovernmentFootprint = useCallback(async (importOrderId: string): Promise<DiasporaGovernmentDocument[]> => {
    const response = await request<{ data: DiasporaGovernmentDocument[] }>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/government-footprint`)
    return response.data || []
  }, [request])

  const fetchDiasporaOrderAudit = useCallback(async (importOrderId: string): Promise<DiasporaAuditEntry[]> => {
    const response = await request<{ data: DiasporaAuditEntry[] }>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/audit`)
    return response.data || []
  }, [request])

  const fetchDiasporaShipmentTimeline = useCallback(async (shipmentId: string): Promise<DiasporaShipmentStageEvent[]> => {
    const response = await request<{ data: DiasporaShipmentStageEvent[] }>(`/diaspora/shipments/${encodeURIComponent(shipmentId)}/timeline`)
    return response.data || []
  }, [request])

  const fetchDiasporaTradeProfile = useCallback(async (id: string): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>(`/diaspora/trade-profiles/${encodeURIComponent(id)}`)
  }, [request])

  const fetchOwnDiasporaTradeProfiles = useCallback(async (): Promise<DiasporaTradeProfile[]> => {
    const response = await request<{ data: DiasporaTradeProfile[] }>('/diaspora/trade-profiles/me')
    return response.data || []
  }, [request])

  const submitDiasporaTradeProfileForReview = useCallback(async (id: string, payload: { notes?: string } = {}): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>(`/diaspora/trade-profiles/${encodeURIComponent(id)}/submit-review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const listDiasporaTradeProfiles = useCallback(async (filters: { roleType?: string; verificationStatus?: string; country?: string } = {}): Promise<DiasporaTradeProfile[]> => {
    const params = new URLSearchParams()
    if (filters.roleType) params.set('roleType', filters.roleType)
    if (filters.verificationStatus) params.set('verificationStatus', filters.verificationStatus)
    if (filters.country) params.set('country', filters.country)
    const qs = params.toString()
    const response = await request<{ data: DiasporaTradeProfile[] }>(`/diaspora/trade-profiles${qs ? `?${qs}` : ''}`)
    return response.data || []
  }, [request])

  const createDiasporaTradeProfile = useCallback(async (payload: DiasporaTradeProfileInput): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>('/diaspora/trade-profiles', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const updateDiasporaTradeProfile = useCallback(async (id: string, payload: DiasporaTradeProfileUpdate): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>(`/diaspora/trade-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])

  const verifyDiasporaTradeProfile = useCallback(async (id: string, payload: { trust_score?: number; notes?: string } = {}): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>(`/diaspora/trade-profiles/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const suspendDiasporaTradeProfile = useCallback(async (id: string, payload: { reason?: string; notes?: string } = {}): Promise<DiasporaTradeProfile> => {
    return request<DiasporaTradeProfile>(`/diaspora/trade-profiles/${encodeURIComponent(id)}/suspend`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const addDiasporaPaymentMilestone = useCallback(async (importOrderId: string, payload: DiasporaPaymentMilestoneInput): Promise<DiasporaPaymentMilestone> => {
    return request<DiasporaPaymentMilestone>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/payment-milestones`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  // Tenant-scoped, DATABASE-sourced workbook export. Streams a binary .xlsx from the backend (built
  // from live DB rows the caller is allowed to see) and triggers a browser download. Uses a raw
  // fetch (not the JSON `request` helper) because the response is a binary blob, not JSON, but
  // fetches a CSRF token the same way apiRequest does for unsafe methods. The request body carries
  // templateType + optional safe filters — NEVER data rows.
  const downloadDiasporaWorkbookDbExport = useCallback(async (templateType: string, filters: { createdFrom?: string; createdTo?: string } = {}): Promise<void> => {
    const authHeaders: AuthHeaders = {}
    if (token) authHeaders['x-session-token'] = token
    if (user?.id) authHeaders['x-user-id'] = user.id
    if (user?.role) authHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) authHeaders['x-tenant-id'] = user.active_tenant_id
    const csrfToken = await fetchCsrfToken(BASE_URL, authHeaders)

    const res = await fetch(`${BASE_URL}/diaspora/workbook/xlsx/export-from-db`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ templateType, filters }),
    })
    if (!res.ok) {
      let message = `Export failed (${res.status})`
      try {
        const body = await res.json()
        message = extractApiErrorMessage(body) || message
      } catch {
        // non-JSON error body; keep the status message
      }
      throw new Error(message)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `diaspora-${templateType}-db-export.xlsx`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [token, user])

  const assignDiasporaSeller = useCallback(async (importOrderId: string, payload: { sellerId: string; roleType?: string; notes?: string }): Promise<DiasporaImportOrder> => {
    return request<DiasporaImportOrder>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/assign-seller`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const transitionDiasporaImportOrder = useCallback(async (importOrderId: string, payload: { nextStatus: string; metadata?: Record<string, unknown> }): Promise<DiasporaImportOrder> => {
    return request<DiasporaImportOrder>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/stages`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }, [request])

  const createDiasporaComplianceReview = useCallback(async (payload: { importOrderId: string; reviewType?: string; notes?: string }): Promise<DiasporaComplianceReview> => {
    return request<DiasporaComplianceReview>('/diaspora/compliance', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const approveDiasporaComplianceReview = useCallback(async (id: string, payload: { notes?: string } = {}): Promise<DiasporaComplianceReview> => {
    return request<DiasporaComplianceReview>(`/diaspora/compliance/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const flagDiasporaComplianceReview = useCallback(async (id: string, payload: { notes?: string } = {}): Promise<DiasporaComplianceReview> => {
    return request<DiasporaComplianceReview>(`/diaspora/compliance/${encodeURIComponent(id)}/flag`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const linkDiasporaVehicleImportRecord = useCallback(async (importOrderId: string, payload: { vehicle_vin?: string; chassis_number?: string; verification_status?: string; metadata?: Record<string, unknown> }): Promise<Record<string, unknown>> => {
    return request<Record<string, unknown>>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/vehicle-import-record`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const completeDiasporaOwnershipHandoff = useCallback(async (importOrderId: string, payload: { idempotencyKey?: string } = {}): Promise<DiasporaOwnershipHandoffResult> => {
    return request<DiasporaOwnershipHandoffResult>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/ownership-handoff`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const fetchDiasporaOwnershipHandoffStatus = useCallback(async (importOrderId: string): Promise<DiasporaOwnershipHandoffStatus> => {
    return request<DiasporaOwnershipHandoffStatus>(`/diaspora/import-orders/${encodeURIComponent(importOrderId)}/ownership-handoff`)
  }, [request])

  const publishDiasporaStockItem = useCallback(async (id: string): Promise<DiasporaStockItem> => {
    const response = await request<{ data: DiasporaStockItem }>(`/diaspora/stock/${encodeURIComponent(id)}/publish`, { method: 'POST' })
    return response.data
  }, [request])

  const unpublishDiasporaStockItem = useCallback(async (id: string): Promise<DiasporaStockItem> => {
    const response = await request<{ data: DiasporaStockItem }>(`/diaspora/stock/${encodeURIComponent(id)}/unpublish`, { method: 'POST' })
    return response.data
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

  // ── Phase 3: Stock & Supply Documents ──
  const fetchDiasporaStockItems = useCallback(async (filters?: Record<string, string | number | undefined>): Promise<DiasporaStockItem[]> => {
    const query = filters
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : ''
    const response = await request<{ data: DiasporaStockItem[] }>(`/diaspora/stock${query}`)
    return response.data || []
  }, [request])

  const fetchDiasporaStockItem = useCallback(async (id: string): Promise<DiasporaStockItem> => {
    const response = await request<{ data: DiasporaStockItem }>(`/diaspora/stock/${encodeURIComponent(id)}`)
    return response.data
  }, [request])

  const createDiasporaStockItem = useCallback(async (payload: DiasporaStockItemPayload): Promise<DiasporaStockItem> => {
    const response = await request<{ data: DiasporaStockItem }>('/diaspora/stock', { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const updateDiasporaStockItem = useCallback(async (id: string, payload: Partial<DiasporaStockItemPayload>): Promise<DiasporaStockItem> => {
    const response = await request<{ data: DiasporaStockItem }>(`/diaspora/stock/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const fetchDiasporaStockLedger = useCallback(async (id: string): Promise<DiasporaStockLedgerEntry[]> => {
    const response = await request<{ data: DiasporaStockLedgerEntry[] }>(`/diaspora/stock/${encodeURIComponent(id)}/ledger`)
    return response.data || []
  }, [request])

  const appendDiasporaStockMovement = useCallback(async (id: string, payload: DiasporaStockMovementPayload): Promise<DiasporaStockMovementResult> => {
    const response = await request<{ data: DiasporaStockMovementResult }>(`/diaspora/stock/${encodeURIComponent(id)}/ledger`, { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const fetchDiasporaSupplyDocuments = useCallback(async (filters?: Record<string, string | undefined>): Promise<DiasporaSupplyDocument[]> => {
    const query = filters
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : ''
    const response = await request<{ data: DiasporaSupplyDocument[] }>(`/diaspora/supply-documents${query}`)
    return response.data || []
  }, [request])

  const createDiasporaSupplyDocument = useCallback(async (payload: DiasporaSupplyDocumentPayload): Promise<DiasporaSupplyDocument> => {
    const response = await request<{ data: DiasporaSupplyDocument }>('/diaspora/supply-documents', { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const updateDiasporaSupplyDocument = useCallback(async (id: string, payload: Partial<DiasporaSupplyDocumentPayload>): Promise<DiasporaSupplyDocument> => {
    const response = await request<{ data: DiasporaSupplyDocument }>(`/diaspora/supply-documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const publishDiasporaSupplyDocument = useCallback(async (id: string): Promise<DiasporaSupplyDocument> => {
    const response = await request<{ data: DiasporaSupplyDocument }>(`/diaspora/supply-documents/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const unpublishDiasporaSupplyDocument = useCallback(async (id: string): Promise<DiasporaSupplyDocument> => {
    const response = await request<{ data: DiasporaSupplyDocument }>(`/diaspora/supply-documents/${encodeURIComponent(id)}/unpublish`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  // ── Phase 4: Buyer Orders & Reverse RFQ ──
  const fetchDiasporaBuyerOrders = useCallback(async (): Promise<DiasporaBuyerOrder[]> => {
    const response = await request<{ data: DiasporaBuyerOrder[] }>('/diaspora/buyer-orders')
    return response.data || []
  }, [request])

  const fetchDiasporaBuyerOrder = useCallback(async (id: string): Promise<DiasporaBuyerOrder> => {
    const response = await request<{ data: DiasporaBuyerOrder }>(`/diaspora/buyer-orders/${encodeURIComponent(id)}`)
    return response.data
  }, [request])

  const createDiasporaBuyerOrder = useCallback(async (payload: DiasporaBuyerOrderPayload): Promise<DiasporaBuyerOrder> => {
    const response = await request<{ data: DiasporaBuyerOrder }>('/diaspora/buyer-orders', { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const updateDiasporaBuyerOrder = useCallback(async (id: string, payload: Partial<DiasporaBuyerOrderPayload>): Promise<DiasporaBuyerOrder> => {
    const response = await request<{ data: DiasporaBuyerOrder }>(`/diaspora/buyer-orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const publishDiasporaRfq = useCallback(async (id: string): Promise<DiasporaBuyerOrder> => {
    const response = await request<{ data: DiasporaBuyerOrder }>(`/diaspora/buyer-orders/${encodeURIComponent(id)}/publish-rfq`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const fetchDiasporaOrderMatches = useCallback(async (id: string): Promise<DiasporaMatchCandidate[]> => {
    const response = await request<{ data: DiasporaMatchCandidate[] }>(`/diaspora/buyer-orders/${encodeURIComponent(id)}/matches`)
    return response.data || []
  }, [request])

  const acceptDiasporaQuote = useCallback(async (orderId: string, quoteId: string): Promise<DiasporaAcceptQuoteResult> => {
    const response = await request<{ data: DiasporaAcceptQuoteResult }>(`/diaspora/buyer-orders/${encodeURIComponent(orderId)}/accept-quote`, { method: 'POST', body: JSON.stringify({ quoteId }) })
    return response.data
  }, [request])

  const fetchDiasporaRfqs = useCallback(async (): Promise<DiasporaBuyerOrder[]> => {
    const response = await request<{ data: DiasporaBuyerOrder[] }>('/diaspora/rfqs')
    return response.data || []
  }, [request])

  const createDiasporaQuote = useCallback(async (orderId: string, payload: DiasporaQuotePayload): Promise<{ quote: DiasporaQuote; idempotentReplay?: boolean }> => {
    const response = await request<{ data: { quote: DiasporaQuote; idempotentReplay?: boolean } }>(`/diaspora/buyer-orders/${encodeURIComponent(orderId)}/quotes`, { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const submitDiasporaQuote = useCallback(async (quoteId: string): Promise<DiasporaQuote> => {
    const response = await request<{ data: DiasporaQuote }>(`/diaspora/quotes/${encodeURIComponent(quoteId)}/submit`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const withdrawDiasporaQuote = useCallback(async (quoteId: string): Promise<{ withdrawn: boolean }> => {
    const response = await request<{ data: { withdrawn: boolean } }>(`/diaspora/quotes/${encodeURIComponent(quoteId)}/withdraw`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  // ── Phase 5: AI Command Center ──
  const parseDiasporaAiCommand = useCallback(async (rawCommand: string): Promise<DiasporaAiParseResult> => {
    const response = await request<{ data: DiasporaAiParseResult }>('/diaspora/ai-commands/parse', { method: 'POST', body: JSON.stringify({ rawCommand }) })
    return response.data
  }, [request])

  const createDiasporaAiCommand = useCallback(async (rawCommand: string): Promise<DiasporaAiCommandCreateResult> => {
    const response = await request<{ data: DiasporaAiCommandCreateResult }>('/diaspora/ai-commands', { method: 'POST', body: JSON.stringify({ rawCommand }) })
    return response.data
  }, [request])

  const fetchDiasporaAiCommands = useCallback(async (): Promise<DiasporaAiCommand[]> => {
    const response = await request<{ data: DiasporaAiCommand[] }>('/diaspora/ai-commands')
    return response.data || []
  }, [request])

  const confirmDiasporaAiCommand = useCallback(async (id: string): Promise<DiasporaAiCommand> => {
    const response = await request<{ data: DiasporaAiCommand }>(`/diaspora/ai-commands/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const approveDiasporaAiCommand = useCallback(async (id: string): Promise<DiasporaAiCommand> => {
    const response = await request<{ data: DiasporaAiCommand }>(`/diaspora/ai-commands/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const rejectDiasporaAiCommand = useCallback(async (id: string): Promise<DiasporaAiCommand> => {
    const response = await request<{ data: DiasporaAiCommand }>(`/diaspora/ai-commands/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const executeDiasporaAiCommand = useCallback(async (id: string): Promise<DiasporaAiExecuteResult> => {
    const response = await request<{ data: DiasporaAiExecuteResult }>(`/diaspora/ai-commands/${encodeURIComponent(id)}/execute`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  // ── Phase 6: Container Co-Loading Marketplace ──
  const fetchDiasporaMarketplaceContainers = useCallback(async (): Promise<DiasporaMarketplaceContainer[]> => {
    const response = await request<{ data: DiasporaMarketplaceContainer[] }>('/diaspora/container-marketplace/containers')
    return response.data || []
  }, [request])

  const createDiasporaMarketplaceContainer = useCallback(async (payload: DiasporaMarketplaceContainerPayload): Promise<DiasporaMarketplaceContainer> => {
    const response = await request<{ data: DiasporaMarketplaceContainer }>('/diaspora/container-marketplace/containers', { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const fetchDiasporaContainerCapacity = useCallback(async (id: string): Promise<DiasporaContainerCapacityResult> => {
    const response = await request<{ data: DiasporaContainerCapacityResult }>(`/diaspora/container-marketplace/containers/${encodeURIComponent(id)}/capacity`)
    return response.data
  }, [request])

  const fetchDiasporaContainerReservations = useCallback(async (id: string): Promise<DiasporaMarketplaceReservation[]> => {
    const response = await request<{ data: DiasporaMarketplaceReservation[] }>(`/diaspora/container-marketplace/containers/${encodeURIComponent(id)}/reservations`)
    return response.data || []
  }, [request])

  const requestDiasporaReservation = useCallback(async (containerId: string, payload: DiasporaReservationRequestPayload): Promise<DiasporaMarketplaceReservation> => {
    const response = await request<{ data: DiasporaMarketplaceReservation }>(`/diaspora/container-marketplace/containers/${encodeURIComponent(containerId)}/reservations`, { method: 'POST', body: JSON.stringify(payload) })
    return response.data
  }, [request])

  const approveDiasporaMarketplaceReservation = useCallback(async (id: string): Promise<DiasporaReservationActionResult> => {
    const response = await request<{ data: DiasporaReservationActionResult }>(`/diaspora/container-marketplace/reservations/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const rejectDiasporaMarketplaceReservation = useCallback(async (id: string): Promise<DiasporaReservationActionResult> => {
    const response = await request<{ data: DiasporaReservationActionResult }>(`/diaspora/container-marketplace/reservations/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const cancelDiasporaMarketplaceReservation = useCallback(async (id: string): Promise<DiasporaReservationActionResult> => {
    const response = await request<{ data: DiasporaReservationActionResult }>(`/diaspora/container-marketplace/reservations/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const closeDiasporaContainerBooking = useCallback(async (id: string): Promise<DiasporaMarketplaceContainer> => {
    const response = await request<{ data: DiasporaMarketplaceContainer }>(`/diaspora/container-marketplace/containers/${encodeURIComponent(id)}/close-booking`, { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  // ── Phase 7: Google Drive Integration ──
  const fetchDiasporaDriveStatus = useCallback(async (): Promise<DiasporaDriveStatus> => {
    const response = await request<{ data: DiasporaDriveStatus }>('/diaspora/drive/status')
    return response.data
  }, [request])

  const fetchDiasporaDriveAuthorizeUrl = useCallback(async (): Promise<DiasporaDriveAuthUrl> => {
    const response = await request<{ data: DiasporaDriveAuthUrl }>('/diaspora/drive/google/authorize')
    return response.data
  }, [request])

  const fetchDiasporaDriveFiles = useCallback(async (): Promise<DiasporaDriveFile[]> => {
    const response = await request<{ data: DiasporaDriveFile[] }>('/diaspora/drive/files')
    return response.data || []
  }, [request])

  const disconnectDiasporaDrive = useCallback(async (): Promise<DiasporaDriveConnection> => {
    const response = await request<{ data: DiasporaDriveConnection }>('/diaspora/drive/disconnect', { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const syncDiasporaDrive = useCallback(async (): Promise<DiasporaDriveConnection> => {
    const response = await request<{ data: DiasporaDriveConnection }>('/diaspora/drive/sync', { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  // ── Phase 8: Subscription, entitlements & sandbox billing ──
  // Reads are tenant-scoped to any authenticated user; management actions are server-gated (Gate S8-A
  // returns 403 for non-managers — the backend remains authoritative).
  const getDiasporaSubscriptionPlans = useCallback(async (): Promise<Plan[]> => {
    const response = await request<{ data: Plan[] }>('/diaspora/subscription/plans')
    return response.data || []
  }, [request])

  const getDiasporaSubscriptionStatus = useCallback(async (): Promise<SubscriptionStatus> => {
    const response = await request<{ data: SubscriptionStatus }>('/diaspora/subscription/status')
    return response.data
  }, [request])

  const getDiasporaEntitlements = useCallback(async (): Promise<EffectiveEntitlements> => {
    const response = await request<{ data: EffectiveEntitlements }>('/diaspora/subscription/entitlements')
    return response.data || {}
  }, [request])

  const getDiasporaUsage = useCallback(async (): Promise<UsageResponse> => {
    const response = await request<{ data: UsageResponse }>('/diaspora/subscription/usage')
    return response.data
  }, [request])

  const createDiasporaCheckout = useCallback(async (planKey: string): Promise<SandboxBillingActionResponse> => {
    const response = await request<{ data: SandboxBillingActionResponse }>('/diaspora/subscription/checkout', { method: 'POST', body: JSON.stringify({ planKey }) })
    return response.data
  }, [request])

  const createDiasporaBillingPortal = useCallback(async (): Promise<SandboxBillingActionResponse> => {
    const response = await request<{ data: SandboxBillingActionResponse }>('/diaspora/subscription/portal', { method: 'POST', body: JSON.stringify({}) })
    return response.data
  }, [request])

  const changeDiasporaPlan = useCallback(async (planKey: string): Promise<SandboxBillingActionResponse> => {
    const response = await request<{ data: SandboxBillingActionResponse }>('/diaspora/subscription/change-plan', { method: 'POST', body: JSON.stringify({ planKey }) })
    return response.data
  }, [request])

  const cancelDiasporaSubscription = useCallback(async (atPeriodEnd: boolean): Promise<SandboxBillingActionResponse> => {
    const response = await request<{ data: SandboxBillingActionResponse }>('/diaspora/subscription/cancel', { method: 'POST', body: JSON.stringify({ atPeriodEnd }) })
    return response.data
  }, [request])

  // ── Phase 9: SafeTrade (escrow/assurance overlay) — sandbox payment-state simulation only ──
  // The UI renders action controls ONLY from getSafeTradeAvailableActions; the backend stays
  // authoritative on every submit. Money never moves through a live provider (sandbox + fail-closed).
  // An idempotency key is forwarded as the x-idempotency-key header on every consequential mutation
  // so a duplicate submit is a safe no-op replay backend-side (defense-in-depth with the UI guard).
  const idemHeaders = (idempotencyKey?: string): Record<string, string> =>
    idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}

  const getSafeTradeCases = useCallback(async (filters?: { status?: string; importOrderId?: string; limit?: number; offset?: number }): Promise<SafeTradeListResponse> => {
    const query = filters
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : ''
    return request<SafeTradeListResponse>(`/diaspora/safetrade${query}`)
  }, [request])

  const getSafeTradeCase = useCallback(async (id: string): Promise<SafeTradeTransaction> => {
    return request<SafeTradeTransaction>(`/diaspora/safetrade/${encodeURIComponent(id)}`)
  }, [request])

  const getSafeTradeTimeline = useCallback(async (id: string): Promise<SafeTradeTimelineEvent[]> => {
    const response = await request<{ data: SafeTradeTimelineEvent[] }>(`/diaspora/safetrade/${encodeURIComponent(id)}/timeline`)
    return response.data || []
  }, [request])

  const getSafeTradeEligibility = useCallback(async (id: string): Promise<SafeTradeEligibilityVerdict> => {
    return request<SafeTradeEligibilityVerdict>(`/diaspora/safetrade/${encodeURIComponent(id)}/eligibility`)
  }, [request])

  const getSafeTradeMilestones = useCallback(async (id: string): Promise<SafeTradeMilestone[]> => {
    const response = await request<{ data: SafeTradeMilestone[] }>(`/diaspora/safetrade/${encodeURIComponent(id)}/milestones`)
    return response.data || []
  }, [request])

  const getSafeTradeDisputes = useCallback(async (id: string): Promise<SafeTradeDispute[]> => {
    const response = await request<{ data: SafeTradeDispute[] }>(`/diaspora/safetrade/${encodeURIComponent(id)}/disputes`)
    return response.data || []
  }, [request])

  const getSafeTradeAvailableActions = useCallback(async (id: string): Promise<SafeTradeAvailableAction[]> => {
    const response = await request<{ data: SafeTradeAvailableAction[] }>(`/diaspora/safetrade/${encodeURIComponent(id)}/available-actions`)
    return response.data || []
  }, [request])

  const createSafeTrade = useCallback(async (payload: { importOrderId: string; sellerId?: string | null; currency?: string; totalAmount: number; idempotencyKey?: string }): Promise<SafeTradeCreateResponse> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeCreateResponse>('/diaspora/safetrade', {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  // commit accepts ONLY an allowlisted SafeTradeCommitEvent (no untyped commit(event:string)).
  const commitSafeTrade = useCallback(async (id: string, payload: SafeTradeCommitPayload): Promise<SafeTradeActionResponse> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeActionResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  const defineSafeTradeMilestones = useCallback(async (id: string, milestones: Array<Record<string, unknown>>, idempotencyKey?: string): Promise<unknown> => {
    return request(`/diaspora/safetrade/${encodeURIComponent(id)}/milestones`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify({ milestones }),
    })
  }, [request])

  const evaluateSafeTradeRelease = useCallback(async (id: string, payload?: { milestoneId?: string }): Promise<SafeTradeEvaluateReleaseResponse> => {
    return request<SafeTradeEvaluateReleaseResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/evaluate-release`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    })
  }, [request])

  const requestSafeTradeRelease = useCallback(async (id: string, payload?: { milestoneId?: string; operation?: string; evaluationId?: string; event?: SafeTradeCommitEvent; reason?: string; idempotencyKey?: string }): Promise<SafeTradeActionResponse> => {
    const { idempotencyKey, ...body } = payload || {}
    return request<SafeTradeActionResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/request-release`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  // approve-release requires a prior evaluation reference (evaluationId) for the bare RELEASE_ESCROW path.
  const approveSafeTradeRelease = useCallback(async (id: string, payload: { evaluationId?: string; milestoneId?: string; operation?: string; reason?: string; idempotencyKey?: string }): Promise<SafeTradeActionResponse> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeActionResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/approve-release`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  const cancelSafeTrade = useCallback(async (id: string, payload?: { reason?: string; idempotencyKey?: string }): Promise<SafeTradeActionResponse> => {
    const { idempotencyKey, ...body } = payload || {}
    return request<SafeTradeActionResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  const openSafeTradeDispute = useCallback(async (id: string, payload: { category: string; reason: string; milestoneId?: string; idempotencyKey?: string }): Promise<SafeTradeDisputeOpenResponse> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeDisputeOpenResponse>(`/diaspora/safetrade/${encodeURIComponent(id)}/disputes`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  const addSafeTradeDisputeEvidence = useCallback(async (disputeId: string, payload: { evidenceType?: string; statement?: string; documentRef?: string; visibility?: string; idempotencyKey?: string }): Promise<SafeTradeDisputeEvidence> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeDisputeEvidence>(`/diaspora/safetrade/disputes/${encodeURIComponent(disputeId)}/evidence`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
  }, [request])

  // ST-4B: read the server-redacted dispute evidence timeline. The backend (listEvidence) is the privacy
  // boundary — it denies non-participants (403) and strips REVIEWERS_ONLY / others' AUTHOR_ONLY rows for
  // ordinary participants. Returns [] on the (fail-closed) empty case.
  const getSafeTradeDisputeEvidence = useCallback(async (disputeId: string): Promise<SafeTradeDisputeEvidence[]> => {
    const response = await request<{ data: SafeTradeDisputeEvidence[] }>(`/diaspora/safetrade/disputes/${encodeURIComponent(disputeId)}/evidence`)
    return response.data || []
  }, [request])

  const resolveSafeTradeDispute = useCallback(async (disputeId: string, payload: { resolution: string; milestoneId?: string; evaluationId?: string; notes?: string; idempotencyKey?: string }): Promise<SafeTradeDisputeResolveResponse> => {
    const { idempotencyKey, ...body } = payload
    return request<SafeTradeDisputeResolveResponse>(`/diaspora/safetrade/disputes/${encodeURIComponent(disputeId)}/resolve`, {
      method: 'POST',
      headers: idemHeaders(idempotencyKey),
      body: JSON.stringify(body),
    })
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

  const fetchCommunicationAudit = useCallback(async (filters?: Record<string, string | undefined>): Promise<{ events: CommunicationAuditEvent[] }> => {
    const query = filters ? referralQuery(filters) : ''
    return request(`/admin/communications/audit${query}`, { method: 'GET' })
  }, [request])

  const fetchCommunicationSlaPolicies = useCallback(async (): Promise<{ policies: CommunicationSlaPolicy[] }> => {
    return request('/admin/communications/sla/policies', { method: 'GET' })
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

  const fetchCommunicationProviders = useCallback(async (): Promise<{ channels: CommunicationProviderTelemetry[]; worker?: { stale_locks?: number; scheduler?: Record<string, unknown> } }> => {
    return request('/admin/communications/providers', { method: 'GET' })
  }, [request])

  // Provider smoke test: sends one real message through the Communication Engine's queue +
  // delivery-worker path. Admin-authed; refuses fake adapters server-side (ok:false / error).
  const sendCommunicationProviderSmokeTest = useCallback(async (payload: {
    channel?: string
    to: string
    message?: string
    client_message_id?: string
  }): Promise<ProviderSmokeTestResult> => {
    try {
      return await request<ProviderSmokeTestResult>('/admin/communications/test/provider-smoke', { method: 'POST', body: JSON.stringify(payload) })
    } catch (err) {
      // A provider rejection returns HTTP 502 WITH a JSON body carrying the sanitized delivery detail.
      // Surface that body (not a bare "HTTP 502") so the panel shows the real Meta error.
      const data = (err as { data?: unknown })?.data
      if (data && typeof data === 'object' && 'ok' in (data as Record<string, unknown>)) {
        return data as ProviderSmokeTestResult
      }
      throw err
    }
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
    // Vehicle Life Evidence Taxonomy + provenance (M1) — all optional; the
    // backend still requires the legacy evidence_type above.
    evidence_class?: string;
    evidence_subtype?: string;
    event_date?: string;
    event_date_precision?: 'day' | 'month' | 'year' | 'unknown';
    capture_country?: string;
    odometer_value?: number;
    odometer_unit?: string;
    component_tags?: string[] | string;
    declared_condition?: string;
    source_code?: string;
    source_record_id?: string;
    evidence_set_id?: string;
    retention_class?: string;
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
  const getOwnerReferralDisputes = useCallback((): Promise<OwnerReferralDisputesResponse> =>
    request<OwnerReferralDisputesResponse>('/referrals/trust/disputes/mine'), [request])
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
    fetchCommunicationAudit,
    fetchCommunicationSlaPolicies,
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
    fetchCommunicationProviders,
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
    fetchVerificationReviewQueue,
    fetchVerificationSessionDetail,
    fetchEvidencePreview,
    reviewVerificationSession,
    reviewVerificationCase,
    fetchTrustReviewQueue,
    approveTrustFactRequest,
    rejectTrustFactRequest,
    revokeTrustFactRequest,
    fetchTrustAuditTrail,
    fetchVehicleEvidence,
    fetchEvidenceTaxonomy,
    fetchEvidenceSources,
    fetchTemporalFindings,
    fetchDisclosureConflicts,
    fetchVehicleExtractions,
    reviewVehicleExtraction,
    fetchVehicleCompleteness,
    fetchVehicleSourceCoverage,
    fetchVehicleTrustDecision,
    fetchFraudCases,
    fetchFraudCase,
    resolveFraudCase,
    evaluateVehicleFraud,
    fetchDealers,
    fetchDealer,
    recordDealerDecision,
    fetchMyDealerProfile,
    saveMyDealerProfile,
    fetchVehicleReport,
    generateReportVersion,
    createReportShareLink,
    fetchSharedReport,
    fetchReviewQueue,
    submitGovernanceDecision,
    fetchVehicleDisputes,
    submitDispute,
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
    fetchDiasporaGovernmentFootprint,
    fetchDiasporaOrderAudit,
    fetchDiasporaShipmentTimeline,
    fetchDiasporaTradeProfile,
    fetchOwnDiasporaTradeProfiles,
    submitDiasporaTradeProfileForReview,
    listDiasporaTradeProfiles,
    createDiasporaTradeProfile,
    updateDiasporaTradeProfile,
    verifyDiasporaTradeProfile,
    suspendDiasporaTradeProfile,
    addDiasporaPaymentMilestone,
    downloadDiasporaWorkbookDbExport,
    assignDiasporaSeller,
    transitionDiasporaImportOrder,
    createDiasporaComplianceReview,
    approveDiasporaComplianceReview,
    flagDiasporaComplianceReview,
    linkDiasporaVehicleImportRecord,
    completeDiasporaOwnershipHandoff,
    fetchDiasporaOwnershipHandoffStatus,
    publishDiasporaStockItem,
    unpublishDiasporaStockItem,
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
    fetchDiasporaStockItems,
    fetchDiasporaStockItem,
    createDiasporaStockItem,
    updateDiasporaStockItem,
    fetchDiasporaStockLedger,
    appendDiasporaStockMovement,
    fetchDiasporaSupplyDocuments,
    createDiasporaSupplyDocument,
    updateDiasporaSupplyDocument,
    publishDiasporaSupplyDocument,
    unpublishDiasporaSupplyDocument,
    fetchDiasporaBuyerOrders,
    fetchDiasporaBuyerOrder,
    createDiasporaBuyerOrder,
    updateDiasporaBuyerOrder,
    publishDiasporaRfq,
    fetchDiasporaOrderMatches,
    acceptDiasporaQuote,
    fetchDiasporaRfqs,
    createDiasporaQuote,
    submitDiasporaQuote,
    withdrawDiasporaQuote,
    parseDiasporaAiCommand,
    createDiasporaAiCommand,
    fetchDiasporaAiCommands,
    confirmDiasporaAiCommand,
    approveDiasporaAiCommand,
    rejectDiasporaAiCommand,
    executeDiasporaAiCommand,
    fetchDiasporaMarketplaceContainers,
    createDiasporaMarketplaceContainer,
    fetchDiasporaContainerCapacity,
    fetchDiasporaContainerReservations,
    requestDiasporaReservation,
    approveDiasporaMarketplaceReservation,
    rejectDiasporaMarketplaceReservation,
    cancelDiasporaMarketplaceReservation,
    closeDiasporaContainerBooking,
    fetchDiasporaDriveStatus,
    fetchDiasporaDriveAuthorizeUrl,
    fetchDiasporaDriveFiles,
    disconnectDiasporaDrive,
    syncDiasporaDrive,
    getDiasporaSubscriptionPlans,
    getDiasporaSubscriptionStatus,
    getDiasporaEntitlements,
    getDiasporaUsage,
    createDiasporaCheckout,
    createDiasporaBillingPortal,
    changeDiasporaPlan,
    cancelDiasporaSubscription,
    // ── Phase 9: SafeTrade ──
    getSafeTradeCases,
    getSafeTradeCase,
    getSafeTradeTimeline,
    getSafeTradeEligibility,
    getSafeTradeMilestones,
    getSafeTradeDisputes,
    getSafeTradeAvailableActions,
    createSafeTrade,
    commitSafeTrade,
    defineSafeTradeMilestones,
    evaluateSafeTradeRelease,
    requestSafeTradeRelease,
    approveSafeTradeRelease,
    cancelSafeTrade,
    openSafeTradeDispute,
    addSafeTradeDisputeEvidence,
    getSafeTradeDisputeEvidence,
    resolveSafeTradeDispute,
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
    getOwnerReferralDisputes,
    resolveReferralDispute,
    exportReferralAudit
  }
}
