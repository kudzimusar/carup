import { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
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
  DiasporaWorkbookOperatorNote
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
} from '@/types/referral'


// Honor VITE_API_URL so each environment targets its own backend (staging → staging backend),
// falling back to same-origin /api on localhost and to the production backend otherwise.
const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

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
    fetchAdminUsers,
    fetchAdminTelemetry,
  
    user,
    loading,
    error,
    switchRole,
    fetchVehicles,
    fetchMarketplaceListings,
    fetchMarketplaceNavCoverage,
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
