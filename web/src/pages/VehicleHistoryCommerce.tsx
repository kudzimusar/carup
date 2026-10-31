import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Car,
  CheckCircle2,
  Clock3,
  Copy,
  FileSearch,
  FileText,
  LockKeyhole,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)
const PENDING_ORDER_KEY = 'carup_pay03a_pending_report_order'

export interface Pay03aVehicleItem {
  vin: string
  make: string
  model: string
  generation?: string | null
  trim?: string | null
  year: number
  color?: string | null
  mileage?: number | null
  fuelType?: string | null
  transmission?: string | null
  importSource?: string | null
  dutyPaid?: boolean
  policeVerified?: boolean
  status?: string
  trustScore?: number | null
  eligibleForReport: boolean
  eligibilityStatus?: string
  ineligibilityReason?: string | null
  historicalEventCount?: number
  evidenceIndexCount?: number
  isSyntheticFixture?: boolean
}

export interface Pay03aDeliverableComparison {
  policyStatus: string
  freeLiveReport: {
    endpoint: string
    cost: string
    nature: string
    includes: string[]
    excludes: string[]
  }
  paidCommercialSnapshot: {
    productCode: string
    cost: string
    nature: string
    includes: string[]
    honestyDisclosure: string
  }
}

export interface Pay03aVehicleReadiness {
  eligibleForPurchase: boolean
  eligibilityStatus?: string
  ineligibilityReason?: string | null
  ineligibilityDetail?: string | null
  sandboxOnly: boolean
  liveCommercialActive: boolean
  productCode: string
  productTitle: string
  vehicle: Pay03aVehicleItem
  readiness: {
    reportSchema: string
    completenessState: string
    lifecycleSourceCoverage: number
    sourceDiversity: number
    classesPresent: string[]
    classesMissing: string[]
    classesUnavailable: string[]
    timelineEventCount: number
    historicalEventCount?: number
    evidenceIndexCount?: number
    keyAlertCount: number
    listingSnapshotCount: number
    mileageObservationCount: number
    limitations: string[]
    prePurchaseDisclosure: string
  }
  deliverableComparison?: Pay03aDeliverableComparison
  commercialTerms: {
    mode: string
    authoritative: boolean
    checkoutEligible: boolean
    merchantOfRecord: string
    merchantCode: string
    legalBeneficiary: string
    fundsOwner: string
    sandboxAccountId: string
    currency: string
    currencyScale: number
    amountMinor: number
    formattedPrice: string
    priceNotice: string
    refundPolicy: string
  }
}

export interface Pay03aOrderRecord {
  orderId: string
  productCode: string
  productVersion: number
  productTitle: string
  sandboxOnly: boolean
  buyerId: string
  vin: string
  vehicleId: string
  quoteId: string
  quoteNumber: string | null
  quoteStatus: string | null
  paymentReference: string
  paymentStatus: 'pending' | 'paid' | 'cancelled' | 'refund_pending' | 'refunded' | string
  amountMinor: number
  currency: string
  currencyScale: number
  merchantOfRecord: string
  legalBeneficiary: string
  fundsOwner: string
  sandboxAccountId: string
  checkoutId: string | null
  paymentIntentId: string | null
  refundId: string | null
  entitlementStatus: 'awaiting_payment' | 'entitled' | 'refund_suspended' | 'revoked_refunded' | 'expired' | string
  reportAvailable: boolean
  reportVersionId: string | null
  reportVersionNumber: number | null
  reportContentHash: string | null
  completenessSummary: Record<string, unknown> | null
  shareToken: string | null
  shareExpiresAt: string | null
  shareRevoked: boolean
  grantedAt: string | null
  revokedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface Pay03aAssembledReport {
  schema: string
  vin: string
  audience: string
  identity: {
    vin: string
    make?: string
    model?: string
    year?: number
  }
  key_alerts: Array<{
    category: string
    type: string
    component?: string
    severity?: string
    summary: string
    reviewed: boolean
    evidence_count: number
    recommended_action: string
  }>
  timeline: Array<{
    evidence_id: string | null
    evidence_class: string
    evidence_subtype: string
    date: string | null
    source_id: string
    source_kind: string
    verification_status: string
    mileage?: number | null
    mileage_unit?: string | null
  }>
  mileage_history?: {
    observations: Array<{ date: string | null; value: number; unit: string; source: string }>
    anomaly: boolean
  }
  completeness: {
    identity_coverage?: number
    timeline_coverage?: number
    lifecycle_source_coverage?: number
    source_diversity?: number
    classes_present?: string[]
    classes_missing?: string[]
    classes_unavailable?: string[]
    unresolved_conflict_count?: number
  }
  limitations: string[]
  generated_at_note?: string
}

export interface Pay03aReportResponse {
  order: Pay03aOrderRecord
  reportVersionId: string
  reportVersion: number
  contentHash: string
  completeness: Pay03aAssembledReport['completeness']
  provenance: {
    verified: boolean
    vin: string
    completenessState: string
    lifecycleSourceCoverage: number
    sourceDiversity: number
    limitationsCount: number
  }
  idempotentReplay: boolean
  report: Pay03aAssembledReport
}

function formatJpySandbox(amountMinor: number, currency: string): string {
  if (amountMinor === 100 && currency === 'JPY') {
    return new Intl.NumberFormat('en-US', { currency: 'JPY', style: 'currency' }).format(amountMinor)
  }
  return `${currency} ${amountMinor}`
}

function validateOrder(order: Pay03aOrderRecord): Pay03aOrderRecord {
  if (
    !order
    || typeof order.orderId !== 'string'
    || order.productCode !== 'intel.report.vehicle_history_single'
    || typeof order.paymentReference !== 'string'
    || order.currency !== 'JPY'
    || order.amountMinor !== 100
    || order.sandboxAccountId !== 'acct_1UVnGaEjgXqvlsJk'
  ) {
    throw new Error('Order response failed canonical PAY-03A contract validation.')
  }
  return order
}

function orderStatusSummary(order: Pay03aOrderRecord): string {
  if (order.paymentStatus === 'refunded' || order.entitlementStatus === 'revoked_refunded') {
    return 'Refund confirmed — Vehicle History Report entitlement and share links are revoked.'
  }
  if (order.paymentStatus === 'refund_pending' || order.entitlementStatus === 'refund_suspended') {
    return 'Refund pending — report access is suspended while refund settles.'
  }
  if (order.paymentStatus === 'paid' && order.reportAvailable) {
    return `Payment verified — Vehicle History Report v${order.reportVersionNumber ?? 1} is entitled and ready.`
  }
  if (order.paymentStatus === 'cancelled') {
    return 'Stripe Checkout session cancelled or expired — no report generated.'
  }
  return 'Awaiting authoritative Stripe sandbox payment verification.'
}

export default function VehicleHistoryCommerce() {
  const { user, token } = useAuth()
  const [vehicles, setVehicles] = useState<Pay03aVehicleItem[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedVin, setSelectedVin] = useState<string>('')
  const [readiness, setReadiness] = useState<Pay03aVehicleReadiness | null>(null)
  const [orders, setOrders] = useState<Pay03aOrderRecord[]>([])
  const [openReportData, setOpenReportData] = useState<Pay03aReportResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [readinessLoading, setReadinessLoading] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const consumedRedirectRef = useRef<boolean>(false)

  const authHeaders = useCallback(
    () => ({
      'x-session-token': token ?? undefined,
      'x-user-id': user?.id,
    }),
    [token, user?.id],
  )

  const loadOrders = useCallback(async () => {
    if (!token) {
      setOrders([])
      return
    }
    const res = await apiRequest<{ orders: Pay03aOrderRecord[] }>({
      baseUrl: API_BASE,
      path: '/pay03a/orders',
      authHeaders: authHeaders(),
    })
    if (!Array.isArray(res.orders)) {
      throw new Error('Unable to load your Vehicle History Report orders.')
    }
    const validated = res.orders.map(validateOrder)
    setOrders(validated)
    setOpenReportData((prev) =>
      prev && validated.some((o) => o.orderId === prev.order.orderId && o.reportAvailable)
        ? prev
        : null,
    )
  }, [token, authHeaders])

  const loadReadiness = useCallback(
    async (vin: string) => {
      if (!token || !vin) return
      setReadinessLoading(true)
      setError(null)
      try {
        const res = await apiRequest<Pay03aVehicleReadiness>({
          baseUrl: API_BASE,
          path: `/pay03a/vehicles/${encodeURIComponent(vin)}/readiness`,
          authHeaders: authHeaders(),
        })
        if (
          !res
          || res.productCode !== 'intel.report.vehicle_history_single'
          || res.vehicle?.vin !== vin
          || res.commercialTerms?.amountMinor !== 100
          || res.commercialTerms?.currency !== 'JPY'
        ) {
          throw new Error('Vehicle pre-purchase readiness response failed validation.')
        }
        setReadiness(res)
      } catch (err) {
        setReadiness(null)
        setError(err instanceof Error ? err.message : 'Unable to inspect vehicle report readiness.')
      } finally {
        setReadinessLoading(false)
      }
    },
    [token, authHeaders],
  )

  const loadVehicles = useCallback(
    async (search = '') => {
      if (!token) {
        setVehicles([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
        const res = await apiRequest<{
          productCode: string
          vehicles: Pay03aVehicleItem[]
        }>({
          baseUrl: API_BASE,
          path: `/pay03a/vehicles${query}`,
          authHeaders: authHeaders(),
        })
        const list = Array.isArray(res.vehicles) ? res.vehicles : []
        setVehicles(list)
        if (list.length > 0) {
          const initialVin = list[0].vin
          setSelectedVin((prev) => (prev && list.some((v) => v.vin === prev) ? prev : initialVin))
        }
        await loadOrders()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load eligible vehicles.')
      } finally {
        setLoading(false)
      }
    },
    [token, authHeaders, loadOrders],
  )

  useEffect(() => {
    void loadVehicles()
  }, [loadVehicles])

  useEffect(() => {
    if (token && selectedVin) {
      void loadReadiness(selectedVin)
    }
  }, [token, selectedVin, loadReadiness])

  const verifyOrder = useCallback(
    async (orderId: string) => {
      if (!token) return null
      setBusy(true)
      setError(null)
      try {
        const verified = validateOrder(
          await apiRequest<Pay03aOrderRecord>({
            baseUrl: API_BASE,
            path: `/pay03a/orders/${encodeURIComponent(orderId)}/verify`,
            options: { method: 'POST', body: JSON.stringify({}) },
            authHeaders: authHeaders(),
          }),
        )
        setMessage(orderStatusSummary(verified))
        await loadOrders()
        return verified
      } catch (err) {
        setMessage(
          'Payment verification is pending. Browser redirect parameters alone never grant report entitlement.',
        )
        setError(err instanceof Error ? err.message : 'Unable to verify payment with Stripe.')
        return null
      } finally {
        setBusy(false)
      }
    },
    [token, authHeaders, loadOrders],
  )

  useEffect(() => {
    if (!token || consumedRedirectRef.current) return
    const params = new URLSearchParams(window.location.search)
    const redirectState = params.get('carup_pay03a')
    if (redirectState !== 'returned' && redirectState !== 'cancelled') return
    consumedRedirectRef.current = true
    const orderIdFromUrl = params.get('order_id')
    const orderIdFromStorage = sessionStorage.getItem(PENDING_ORDER_KEY)
    const targetOrderId = orderIdFromUrl || orderIdFromStorage

    params.delete('carup_pay03a')
    params.delete('order_id')
    params.delete('session_id')
    const nextSearch = params.toString()
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + window.location.hash,
    )

    if (!targetOrderId) {
      queueMicrotask(() =>
        setMessage('Returned from Stripe Checkout. Select your order below to verify status.'),
      )
      return
    }
    queueMicrotask(() => {
      setMessage(
        redirectState === 'cancelled'
          ? 'Stripe Checkout was cancelled in browser. Reconciling order status...'
          : 'Returned from Stripe Checkout. Verifying authoritative payment status and generating report...',
      )
      sessionStorage.removeItem(PENDING_ORDER_KEY)
      void verifyOrder(targetOrderId)
    })
  }, [token, verifyOrder])

  const startCheckout = async () => {
    if (!token || !readiness || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const randomPart = globalThis.crypto.randomUUID().replace(/-/g, '')
      const idempotencyKey = `pay03a_${randomPart}`
      const res = await apiRequest<
        Pay03aOrderRecord & {
          checkoutUrl: string
          live: boolean
        }
      >({
        baseUrl: API_BASE,
        path: '/pay03a/orders/checkout',
        options: {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ vin: readiness.vehicle.vin }),
        },
        authHeaders: authHeaders(),
      })
      validateOrder(res)
      if (
        !res.checkoutUrl?.startsWith('https://checkout.stripe.com/')
        || res.live !== false
        || res.sandboxAccountId !== 'acct_1UVnGaEjgXqvlsJk'
      ) {
        throw new Error('Stripe Checkout session failed CarUp Japan sandbox verification.')
      }
      sessionStorage.setItem(PENDING_ORDER_KEY, res.orderId)
      window.location.assign(res.checkoutUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate Stripe sandbox Checkout.')
      setBusy(false)
    }
  }

  const openReport = async (order: Pay03aOrderRecord) => {
    if (!token || !order.reportAvailable) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiRequest<Pay03aReportResponse>({
        baseUrl: API_BASE,
        path: `/pay03a/orders/${encodeURIComponent(order.orderId)}/report`,
        authHeaders: authHeaders(),
      })
      validateOrder(res.order)
      if (!res.order.reportAvailable || res.report?.vin !== order.vin) {
        throw new Error('Verified Vehicle History Report snapshot is not available.')
      }
      setOpenReportData(res)
    } catch (err) {
      setOpenReportData(null)
      setError(err instanceof Error ? err.message : 'Unable to open Vehicle History Report.')
    } finally {
      setBusy(false)
    }
  }

  const generateShareLink = async (order: Pay03aOrderRecord) => {
    if (!token || !order.reportAvailable) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiRequest<{
        order: Pay03aOrderRecord
        shareToken: string
        shareExpiresAt: string
        sharePath: string
      }>({
        baseUrl: API_BASE,
        path: `/pay03a/orders/${encodeURIComponent(order.orderId)}/share`,
        options: { method: 'POST', body: JSON.stringify({ ttlSeconds: 7 * 24 * 3600 }) },
        authHeaders: authHeaders(),
      })
      setMessage(`Expiring share link created (valid until ${new Date(res.shareExpiresAt).toLocaleDateString()}).`)
      await loadOrders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create report share link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-8" data-testid="pay03a-commerce-page">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-3xl bg-slate-950 px-6 py-9 text-white shadow-lg sm:px-10">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge className="bg-orange-500 text-white" data-testid="pay03a-sandbox-badge">
              SANDBOX · TEST ONLY (JPY 100)
            </Badge>
            <Badge variant="outline" className="border-slate-500 text-slate-200">
              PAY-03A · First-Party Commercial Product (`intel.report.vehicle_history_single`)
            </Badge>
            <Badge variant="outline" className="border-emerald-500/60 text-emerald-300">
              Merchant: CarUp Japan (`acct_1UVnGaEjgXqvlsJk`)
            </Badge>
          </div>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
            CarUp Vehicle History Report Commerce
          </h1>
          <p className="mt-2 text-lg text-slate-200">
            Select a real CarUp registry vehicle, inspect pre-purchase data coverage & limitations, and purchase a verified report snapshot.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-5 text-slate-300">
            Unlike the synthetic PAY-01C demo, this workflow queries real vehicle records in{' '}
            <code className="text-orange-300">public.vehicles</code>, issues an immutable PAY-02 quote, collects a JPY 100 Stripe sandbox payment, and binds an immutable <code className="text-orange-300">report_versions</code> snapshot.
          </p>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="pay03a-error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900" data-testid="pay03a-status">
            {message}
          </div>
        )}

        {!user || !token ? (
          <Card className="border-orange-200">
            <CardHeader>
              <CardTitle>Sign in required for Vehicle History Report commerce</CardTitle>
              <CardDescription>
                Report quotes, Stripe sandbox Checkout sessions, and report entitlements are bound to your authenticated CarUp buyer account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild data-testid="pay03a-signin-cta">
                <Link to="/login?returnTo=%2Fvehicle-history">
                  Sign in to select a vehicle and purchase a report <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
              {/* Left Column: Eligible Vehicle Selector */}
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Car className="h-5 w-5 text-orange-600" />
                        1. Select an Eligible Vehicle
                      </CardTitle>
                      <CardDescription>
                        Real vehicles registered in <code className="font-mono text-xs">public.vehicles</code>.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="search"
                        aria-label="Search by VIN, make, or model"
                        placeholder="Search VIN, make, model..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="rounded-md border px-3 py-1.5 text-xs"
                        data-testid="pay03a-vin-search"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void loadVehicles(searchQuery)}
                        disabled={loading}
                      >
                        <Search className="mr-1 h-3.5 w-3.5" />
                        Filter
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loading ? (
                    <p className="text-sm text-slate-500">Loading eligible vehicles…</p>
                  ) : vehicles.length === 0 ? (
                    <p className="text-sm text-slate-500">No matching vehicles found in registry.</p>
                  ) : (
                    vehicles.map((veh) => {
                      const isSelected = veh.vin === selectedVin
                      return (
                        <div
                          key={veh.vin}
                          className={`cursor-pointer rounded-xl border p-3.5 transition ${
                            isSelected
                              ? 'border-orange-500 bg-orange-50/50 ring-1 ring-orange-500'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                          onClick={() => setSelectedVin(veh.vin)}
                          data-testid={`pay03a-vehicle-${veh.vin}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {veh.year} {veh.make} {veh.model} {veh.trim ? `· ${veh.trim}` : ''}
                              </p>
                              <p className="font-mono text-xs text-slate-600">VIN: {veh.vin}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {veh.isSyntheticFixture && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 bg-amber-50 text-amber-800"
                                  data-testid={`pay03a-vehicle-fixture-badge-${veh.vin}`}
                                >
                                  Synthetic Test Fixture
                                </Badge>
                              )}
                              <Badge
                                variant={veh.eligibleForReport ? (isSelected ? 'default' : 'outline') : 'outline'}
                                className={
                                  !veh.eligibleForReport
                                    ? 'border-red-300 bg-red-50 text-red-700'
                                    : undefined
                                }
                              >
                                {!veh.eligibleForReport
                                  ? 'Ineligible (Metadata Only)'
                                  : isSelected
                                    ? 'Selected'
                                    : 'Select VIN'}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                            {veh.mileage != null && <span>Odometer: {veh.mileage.toLocaleString()} km</span>}
                            {veh.importSource && <span>Origin: {veh.importSource}</span>}
                            <span>Duty: {veh.dutyPaid ? 'Paid' : 'Pending'}</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>

              {/* Right Column: Pre-Purchase Readiness & Commercial Checkout */}
              <Card className="border-orange-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSearch className="h-5 w-5 text-orange-600" />
                    2. Pre-Purchase Data Coverage & Commercial Terms
                  </CardTitle>
                  <CardDescription>
                    CarUp verifies data readiness and discloses missing sources before you pay.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {readinessLoading ? (
                    <p className="text-sm text-slate-500">Evaluating vehicle report readiness…</p>
                  ) : !readiness ? (
                    <p className="text-sm text-slate-500">Select a vehicle to inspect report coverage and price.</p>
                  ) : (
                    <>
                      <div className="rounded-xl bg-slate-900 p-4 text-white">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-wider text-orange-400">
                              Selected Vehicle Target
                            </p>
                            <p className="text-base font-bold" data-testid="pay03a-selected-vehicle-title">
                              {readiness.vehicle.year} {readiness.vehicle.make} {readiness.vehicle.model}
                            </p>
                            <p className="font-mono text-xs text-slate-300" data-testid="pay03a-selected-vin">
                              {readiness.vehicle.vin}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Sandbox Test Price</p>
                            <p className="text-2xl font-bold text-orange-400" data-testid="pay03a-price">
                              {formatJpySandbox(
                                readiness.commercialTerms.amountMinor,
                                readiness.commercialTerms.currency,
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 rounded-xl border bg-slate-50 p-3.5 text-xs" data-testid="pay03a-readiness-summary">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">Pre-Purchase Coverage Summary</span>
                          <Badge variant="outline">{readiness.readiness.completenessState}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1 text-slate-700">
                          <div>
                            Source coverage: <strong>{Math.round(readiness.readiness.lifecycleSourceCoverage * 100)}%</strong>
                          </div>
                          <div>
                            Source diversity: <strong>{readiness.readiness.sourceDiversity}</strong>
                          </div>
                          <div>
                            Timeline events: <strong>{readiness.readiness.timelineEventCount}</strong>
                          </div>
                          <div>
                            Mileage readings: <strong>{readiness.readiness.mileageObservationCount}</strong>
                          </div>
                        </div>

                        {readiness.readiness.limitations.length > 0 && (
                          <div className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-950" data-testid="pay03a-limitations-preview">
                            <p className="flex items-center gap-1.5 font-semibold">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                              Mandatory Pre-Purchase Source Limitations:
                            </p>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {readiness.readiness.limitations.map((lim, idx) => (
                                <li key={idx}>{lim}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {!readiness.eligibleForPurchase && (
                          <div
                            className="mt-2 space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900"
                            data-testid="pay03a-ineligible-banner"
                          >
                            <p className="font-semibold">
                              Purchase Refused Before Charging ({readiness.ineligibilityReason || 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE'})
                            </p>
                            <p>
                              {readiness.ineligibilityDetail
                                || 'This vehicle record contains only basic VIN/identity metadata with zero historical lifecycle evidence. Checkout is disabled so customers are never billed for a metadata-only record.'}
                            </p>
                          </div>
                        )}
                      </div>

                      {readiness.deliverableComparison && (
                        <div
                          className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-slate-800"
                          data-testid="pay03a-deliverable-comparison"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-blue-950">
                              Free Live Route vs Paid Sandbox Snapshot Deliverable
                            </span>
                            <Badge variant="outline" className="border-blue-300 text-[10px] text-blue-900">
                              {readiness.deliverableComparison.policyStatus}
                            </Badge>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                              <p className="font-semibold text-slate-900">
                                Free Route (<code className="font-mono">{readiness.deliverableComparison.freeLiveReport.endpoint}</code>)
                              </p>
                              <p className="mt-1 text-slate-600">
                                {readiness.deliverableComparison.freeLiveReport.nature}
                              </p>
                            </div>
                            <div className="rounded-lg border border-orange-200 bg-white p-2.5">
                              <p className="font-semibold text-slate-900">
                                Paid Snapshot (<code className="font-mono">{readiness.deliverableComparison.paidCommercialSnapshot.productCode}</code>)
                              </p>
                              <p className="mt-1 text-slate-600">
                                {readiness.deliverableComparison.paidCommercialSnapshot.nature}
                              </p>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600">
                            {readiness.deliverableComparison.paidCommercialSnapshot.honestyDisclosure}
                          </p>
                        </div>
                      )}

                      <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs text-slate-600">
                        <div>
                          <dt className="text-slate-400">Merchant of Record</dt>
                          <dd className="font-semibold text-slate-800">{readiness.commercialTerms.merchantOfRecord}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Funds Owner / Beneficiary</dt>
                          <dd className="font-mono text-slate-800">{readiness.commercialTerms.legalBeneficiary}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-slate-400">Cancellation & Refund Policy</dt>
                          <dd className="text-slate-700">
                            Unpaid Checkout cancellation creates no entitlement. Governed sandbox refunds immediately revoke report access and any shared links.
                          </dd>
                        </div>
                      </dl>

                      <Button
                        className="w-full"
                        size="lg"
                        disabled={busy || !readiness.eligibleForPurchase}
                        onClick={() => void startCheckout()}
                        data-testid="pay03a-buy-button"
                      >
                        {busy
                          ? 'Creating PAY-02 Quote & Stripe Checkout…'
                          : `Buy Vehicle History Report (${formatJpySandbox(
                              readiness.commercialTerms.amountMinor,
                              readiness.commercialTerms.currency,
                            )})`}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>

                      <p className="flex items-start gap-2 text-xs text-slate-500">
                        <LockKeyhole className="h-4 w-4 shrink-0" />
                        Report version generation occurs only after CarUp verifies payment with Stripe (`acct_1UVnGaEjgXqvlsJk`).
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Buyer Order History & Entitlements */}
            <section aria-label="Your Vehicle History Report Orders">
              <Card>
                <CardHeader>
                  <CardTitle>Your Vehicle History Report Orders</CardTitle>
                  <CardDescription>
                    Governed PAY-03A report purchases linked to your authenticated CarUp buyer account.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {orders.length === 0 ? (
                    <p className="text-sm text-slate-500" data-testid="pay03a-empty-orders">
                      No Vehicle History Report orders yet.
                    </p>
                  ) : (
                    orders.map((ord) => (
                      <div
                        key={ord.orderId}
                        className="space-y-3 rounded-xl border bg-white p-4"
                        data-testid={`pay03a-order-${ord.orderId}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <p className="font-semibold text-slate-900">
                              {ord.productTitle} — VIN <span className="font-mono">{ord.vin}</span>
                            </p>
                            <p className="font-mono text-xs text-slate-500">
                              Order: {ord.orderId} · Quote: {ord.quoteNumber || ord.quoteId} · Ref: {ord.paymentReference}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">Payment: {ord.paymentStatus}</Badge>
                            <Badge
                              className={
                                ord.entitlementStatus === 'entitled'
                                  ? 'bg-emerald-700 text-white'
                                  : ord.entitlementStatus === 'revoked_refunded'
                                    ? 'bg-red-700 text-white'
                                    : 'bg-slate-700 text-white'
                              }
                              data-testid={`pay03a-order-entitlement-${ord.orderId}`}
                            >
                              {ord.entitlementStatus}
                            </Badge>
                          </div>
                        </div>

                        <p className="text-sm text-slate-700">{orderStatusSummary(ord)}</p>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                          <span className="font-semibold">
                            {formatJpySandbox(ord.amountMinor, ord.currency)}
                          </span>
                          {ord.reportVersionNumber != null && (
                            <span className="font-mono">
                              Snapshot: v{ord.reportVersionNumber} ({ord.reportContentHash?.slice(0, 12)}…)
                            </span>
                          )}
                          {ord.refundId && (
                            <span className="font-mono text-red-700">Refund ID: {ord.refundId}</span>
                          )}
                        </div>

                        {ord.shareToken && !ord.shareRevoked && (
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 p-2.5 text-xs"
                            data-testid={`pay03a-share-banner-${ord.orderId}`}
                          >
                            <span className="font-mono break-all">
                              Share link: /reports/shared/{ord.shareToken} (expires{' '}
                              {ord.shareExpiresAt ? new Date(ord.shareExpiresAt).toLocaleDateString() : '7d'})
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void navigator.clipboard?.writeText(
                                  `${window.location.origin}/reports/shared/${ord.shareToken}`,
                                )
                                setMessage('Share link copied to clipboard.')
                              }}
                            >
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              Copy Link
                            </Button>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {ord.reportAvailable && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => void openReport(ord)}
                                data-testid={`pay03a-open-report-${ord.orderId}`}
                              >
                                <FileText className="mr-1.5 h-4 w-4" />
                                Open Verified Report
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void generateShareLink(ord)}
                                data-testid={`pay03a-share-report-${ord.orderId}`}
                              >
                                <Share2 className="mr-1.5 h-4 w-4" />
                                {ord.shareToken ? 'Rotate Share Link' : 'Create Expiring Share Link'}
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void verifyOrder(ord.orderId)}
                            data-testid={`pay03a-verify-order-${ord.orderId}`}
                          >
                            <RefreshCw className="mr-1.5 h-4 w-4" />
                            Verify with Stripe
                          </Button>
                        </div>

                        {ord.reportAvailable ? (
                          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                            Verified report entitlement active
                          </p>
                        ) : ord.paymentStatus === 'refunded' || ord.entitlementStatus === 'revoked_refunded' ? (
                          <p className="flex items-center gap-1.5 text-xs text-red-700">
                            <Undo2 className="h-4 w-4" />
                            Report entitlement and share token revoked after refund
                          </p>
                        ) : (
                          <p className="flex items-center gap-1.5 text-xs text-amber-700">
                            <Clock3 className="h-4 w-4" />
                            Awaiting verified Stripe payment confirmation
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Fulfilled Real Vehicle History Report Viewer */}
            {openReportData && (
              <section
                aria-label="Verified Vehicle History Report"
                data-testid="pay03a-report-viewer"
                className="space-y-4 rounded-2xl border-2 border-emerald-600 bg-white p-6 shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge className="bg-emerald-700 text-white">
                        VERIFIED CANONICAL REPORT SNAPSHOT (v{openReportData.reportVersion})
                      </Badge>
                      <Badge variant="outline" className="font-mono">
                        VIN: {openReportData.report.vin}
                      </Badge>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      {openReportData.report.identity?.year} {openReportData.report.identity?.make}{' '}
                      {openReportData.report.identity?.model} — Vehicle History Report
                    </h2>
                    <p className="font-mono text-xs text-slate-500">
                      Report Version ID: {openReportData.reportVersionId} · SHA-256:{' '}
                      {openReportData.contentHash}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setOpenReportData(null)}>
                    Close Report
                  </Button>
                </div>

                <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">Canonical VIN</dt>
                    <dd className="font-mono font-semibold text-slate-900">{openReportData.report.vin}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Make / Model / Year</dt>
                    <dd className="font-semibold text-slate-900">
                      {openReportData.report.identity?.make} {openReportData.report.identity?.model} (
                      {openReportData.report.identity?.year})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Lifecycle Source Coverage</dt>
                    <dd className="font-semibold text-slate-900">
                      {Math.round((openReportData.completeness?.lifecycle_source_coverage ?? 0) * 100)}% (
                      {openReportData.provenance.completenessState})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Quote & Payment Authority</dt>
                    <dd className="font-mono text-slate-900">
                      {openReportData.order.quoteNumber} · {openReportData.order.paymentReference}
                    </dd>
                  </div>
                </dl>

                {/* Key Alerts */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Key Risk & Intelligence Alerts ({openReportData.report.key_alerts?.length || 0})
                  </h3>
                  {!openReportData.report.key_alerts || openReportData.report.key_alerts.length === 0 ? (
                    <p className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                      No confirmed risk alerts in the sources read at generation time. Review source limitations below.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {openReportData.report.key_alerts.map((alert, i) => (
                        <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                          <p className="font-semibold text-amber-950">
                            [{alert.severity || 'notice'}] {alert.type}: {alert.summary}
                          </p>
                          <p className="mt-1 text-amber-800">{alert.recommended_action}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Canonical Lifecycle Timeline */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Recorded Vehicle Lifecycle Timeline ({openReportData.report.timeline?.length || 0})
                  </h3>
                  {!openReportData.report.timeline || openReportData.report.timeline.length === 0 ? (
                    <p className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                      No verified public-safe timeline events recorded for this VIN yet.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {openReportData.report.timeline.map((item, idx) => (
                        <li key={idx} className="rounded-lg border p-3 text-xs">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {item.evidence_class} · {item.evidence_subtype}
                            </span>
                            <span className="font-mono text-slate-500">{item.date || 'Date unrecorded'}</span>
                          </div>
                          <div className="mt-1 text-slate-600">
                            Source: {item.source_kind} ({item.verification_status})
                            {item.mileage != null ? ` · Odometer: ${item.mileage.toLocaleString()} ${item.mileage_unit || 'km'}` : ''}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                {/* Mandatory Limitations Disclosure */}
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950" data-testid="pay03a-report-limitations">
                  <p className="font-semibold flex items-center gap-1.5 mb-1.5">
                    <ShieldCheck className="h-4 w-4 text-amber-800" />
                    Source Coverage & Limitations Disclosure (Never Omitted)
                  </p>
                  <ul className="list-disc pl-4 space-y-1">
                    {(openReportData.report.limitations || []).map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
