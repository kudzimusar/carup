import { useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'

const BASE_URL = 'https://carup-backend.vercel.app/api'

export function useCarUpApi() {
  const { user, token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(async (path: string, options?: RequestInit) => {
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
      return data
    } catch (err: any) {
      setLoading(false)
      setError(err.message || 'Something went wrong')
      console.error(`CarUp API Error (${path}):`, err)
      throw err
    }
  }, [user, token])

  const switchRole = useCallback(async (userId: string, role: string) => {
    return request('/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ userId, role })
    })
  }, [request])

  const fetchVehicles = useCallback(async (filters?: any) => {
    const query = filters 
      ? '?' + new URLSearchParams(Object.entries(filters).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      : ''
    return request(`/vehicles${query}`)
  }, [request])

  const fetchDealerInventory = useCallback(async () => {
    return request('/vehicles/inventory')
  }, [request])

  const fetchVehiclePassport = useCallback(async (vin: string) => {
    return request(`/vehicles/${vin}/passport`)
  }, [request])

  const verifyLedger = useCallback(async (vin: string) => {
    return request(`/vehicles/${vin}/verify-ledger`)
  }, [request])

  const fetchVehicle = useCallback(async (vin: string) => {
    return request(`/vehicles/${vin}/details`)
  }, [request])

  const runOdometerAudit = useCallback(async (vin: string) => {
    return request(`/vehicles/${vin}/odometer-audit`)
  }, [request])

  const createSafePayEscrow = useCallback(async (vin: string, sellerId: string, amount: number, currency = 'USD') => {
    return request('/safepay/create', {
      method: 'POST',
      body: JSON.stringify({ vin, sellerId, amount, currency })
    })
  }, [request])

  const fetchSafePayEscrows = useCallback(async () => {
    return request('/safepay/list')
  }, [request])

  const updateSafePayEscrow = useCallback(async (id: string, status: string, details?: any) => {
    return request(`/safepay/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status, details })
    })
  }, [request])

  const addRepairLog = useCallback(async (vin: string, mechanicId: string, partName: string, partOem: string, actionType: string, description: string, mileage: number) => {
    return request('/partsentry/add', {
      method: 'POST',
      body: JSON.stringify({ vin, mechanicId, partName, partOem, actionType, description, mileage })
    })
  }, [request])

  const fetchRepairHistory = useCallback(async (vin: string) => {
    return request(`/partsentry/${vin}`)
  }, [request])

  const runOcrParsing = useCallback(async (docType: string, base64Data: string) => {
    return request('/ai/ocr', {
      method: 'POST',
      body: JSON.stringify({ docType, base64Data })
    })
  }, [request])

  const runFraudScan = useCallback(async (vin: string, price: number, listingTitle: string) => {
    return request('/ai/fraud-scan', {
      method: 'POST',
      body: JSON.stringify({ vin, price, listingTitle })
    })
  }, [request])

  const runRiskAssessment = useCallback(async (vin: string, mileage: number, basePrice: number) => {
    return request('/ai/risk-assessment', {
      method: 'POST',
      body: JSON.stringify({ vin, mileage, basePrice })
    })
  }, [request])

  const submitFinancing = useCallback(async (vin: string, bankId: string, requestedAmount: number) => {
    return request('/finance/pre-approve', {
      method: 'POST',
      body: JSON.stringify({ vin, bankId, requestedAmount })
    })
  }, [request])

  const fetchInsuranceQuote = useCallback(async (vin: string, userId: string) => {
    return request('/insurance/quote', {
      method: 'POST',
      body: JSON.stringify({ vin, userId })
    })
  }, [request])

  const fetchZimraDuty = useCallback(async (price: number, year: number, engineCc?: number) => {
    return request('/import/duty-estimate', {
      method: 'POST',
      body: JSON.stringify({ price, year, engineCc })
    })
  }, [request])

  const reportStolen = useCallback(async (vin: string, policeReportNumber: string, ownerId: string) => {
    return request('/security/report-stolen', {
      method: 'POST',
      body: JSON.stringify({ vin, policeReportNumber, ownerId })
    })
  }, [request])

  const checkStolen = useCallback(async (vin: string) => {
    return request(`/security/check-stolen/${vin}`)
  }, [request])

  const fetchDealerReputation = useCallback(async (dealerId: string) => {
    return request(`/reputation/${dealerId}`)
  }, [request])

  const fetchRecommendations = useCallback(async (vin: string) => {
    return request(`/vehicles/${vin}/recommendations`)
  }, [request])

  const reserveVehicle = useCallback(async (vin: string, buyerId: string, duration = 7) => {
    return request(`/vehicles/${vin}/reserve`, {
      method: 'POST',
      body: JSON.stringify({ buyerId, duration })
    })
  }, [request])

  // --- Domain 1: Dealer & Mechanic ---
  const fetchDealerLeads = useCallback(async () => {
    return request('/leads')
  }, [request])

  const fetchDealerPromotions = useCallback(async () => {
    return request('/promotions')
  }, [request])

  const createDealerPromotion = useCallback(async (data: any) => {
    return request('/promotions', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchMechanicWorkOrders = useCallback(async () => {
    return request('/mechanic/work-orders')
  }, [request])

  const createMechanicWorkOrder = useCallback(async (data: any) => {
    return request('/mechanic/work-orders', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchMechanicParts = useCallback(async () => {
    return request('/mechanic/parts')
  }, [request])

  const createMechanicPart = useCallback(async (data: any) => {
    return request('/mechanic/parts', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }, [request])

  const fetchTelemetry = useCallback(async () => {
    return request('/telemetry')
  }, [request])

  const fetchFinanceApplications = useCallback(async () => {
    const data = await request('/finance/applications')
    return data.map((app: any) => ({
      ...app,
      make: app.vehicles?.make,
      model: app.vehicles?.model,
      year: app.vehicles?.year,
      user_name: app.users?.name || 'Unknown User'
    }))
  }, [request])

  const updateFinanceApplicationStatus = useCallback(async (id: string, status: string) => {
    return request(`/finance/applications/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status })
    })
  }, [request])

  const fetchClaims = useCallback(async () => {
    return request('/insurance/claims')
  }, [request])

  const updateClaimStatus = useCallback(async (id: string, status: string) => {
    return request(`/insurance/claims/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  }, [request])

  const fetchFraudAlerts = useCallback(async () => {
    return request('/security/fraud-alerts')
  }, [request])

  const resolveFraudAlert = useCallback(async (id: string) => {
    return request(`/security/fraud-alerts/${id}/resolve`, {
      method: 'PATCH'
    })
  }, [request])

  const fetchComplianceReports = useCallback(async () => {
    return request('/compliance/reports')
  }, [request])

  const fetchRegistryVerifications = useCallback(async () => {
    return request('/compliance/registry')
  }, [request])

  const updateRegistryVerification = useCallback(async (id: string, status: string, notes?: string) => {
    return request(`/compliance/registry/${id}/update`, {
      method: 'POST',
      body: JSON.stringify({ status, notes })
    })
  }, [request])

  const fetchServerHealth = useCallback(async () => {
    return request('/admin/health')
  }, [request])

  const fetchUsers = useCallback(async () => {
    return request('/admin/users')
  }, [request])

  const suspendUser = useCallback(async (id: string) => {
    return request(`/admin/users/${id}/suspend`, {
      method: 'PATCH'
    })
  }, [request])

  const updateVehicleStatus = useCallback(async (vin: string, status: string) => {
    return request(`/vehicles/${vin}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  }, [request])

  // ==========================================
  // PHASE 5: OWNER & ADMIN OS HOOKS
  // ==========================================

  const fetchOwnedVehicles = useCallback(async () => {
    return request('/vehicles/me', { method: 'GET' })
  }, [request])

  const fetchSavedVehicles = useCallback(async () => {
    return request('/vehicles/saved', { method: 'GET' })
  }, [request])

  const unsaveVehicle = useCallback(async (vin: string) => {
    return request(`/vehicles/saved/${vin}`, { method: 'DELETE' })
  }, [request])

  const saveVehicle = useCallback(async (vin: string) => {
    return request('/vehicles/saved/add', { method: 'POST', body: JSON.stringify({ vin }) })
  }, [request])

  const fetchServiceHistory = useCallback(async () => {
    return request('/service-history/me', { method: 'GET' })
  }, [request])

  const fetchNotifications = useCallback(async () => {
    return request('/notifications/me', { method: 'GET' })
  }, [request])

  const fetchAdminUsers = useCallback(async () => {
    return request('/users/management', { method: 'GET' })
  }, [request])

  const fetchAdminTelemetry = useCallback(async () => {
    return request('/admin/stats', { method: 'GET' })
  }, [request])


  return {
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
    fetchDealerInventory,
    fetchVehiclePassport,
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
