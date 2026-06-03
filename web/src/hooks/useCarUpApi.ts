import { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
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
  MarketplaceListingsResponse
} from '@/types'


const BASE_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:5001/api'
  : 'https://carup-backend.vercel.app/api';

export function useCarUpApi() {
  const { user, token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(async <T = any>(path: string, options?: RequestInit): Promise<T> => {
    setLoading(true)
    setError(null)
    
    // Build Headers Dynamically based on current auth state
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    if (token) defaultHeaders['x-session-token'] = token
    if (user?.id) defaultHeaders['x-user-id'] = user.id
    if (user?.role) defaultHeaders['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) defaultHeaders['x-tenant-id'] = user.active_tenant_id

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
          ...defaultHeaders,
          ...(options?.headers || {})
        },
        ...options
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      setLoading(false)
      return data as T
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


  return {
    uploadKycDocument,
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
    fetchDealerInventory,
    fetchVehiclePassport,
    fetchVehicleEvidenceTimeline,
    fetchEvidenceReviewQueue,
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
    updateVehicleStatus
  }
}
