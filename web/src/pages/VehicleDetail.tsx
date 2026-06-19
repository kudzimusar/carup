import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { PremiumEvidenceGallery } from '@/components/PremiumEvidenceGallery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Car, CheckCircle, Shield, Gauge, Fuel, Settings2, MapPin, Calendar,
  Phone, MessageSquare, Heart, Share2, ArrowLeft, AlertTriangle, Search,
  FileCheck, Star, Loader2, Lock, CreditCard, ChevronLeft, ChevronRight,
  XCircle, HelpCircle, Wrench, UserCheck, TrendingDown, ClipboardCheck,
  Clock, Image as ImageIcon, FileText
} from 'lucide-react'
import { formatPrice } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import type {
  Vehicle,
  VehiclePassport,
  TimelineEvent,
  PassportVerificationSource,
  MarketplaceListingDetail,
} from '@/types'
import { TrustSummaryPanel } from '@/components/marketplace/TrustSummaryPanel'
import { AllInPricePanel } from '@/components/marketplace/AllInPricePanel'
import { SafetyWarnings } from '@/components/marketplace/SafetyWarnings'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import { captureReferralFromUrl, getStoredAttribution } from '@/lib/marketplaceReferral'

/** Minimal Vehicle hydrated from the governed marketplace detail (fallback when passport lookup misses). */
function vehicleFromMarketplaceDetail(d: MarketplaceListingDetail): Vehicle {
  return {
    vin: d.vin,
    id: d.vin,
    make: d.make,
    model: d.model,
    year: d.year,
    mileage: d.mileage,
    price: d.price,
    currency: d.currency,
    fuel_type: d.fuel_type || undefined,
    transmission: d.transmission || undefined,
    status: d.status,
    trust_score: d.trust_score,
    images: (d.media || []).filter((m) => m.type === 'image').map((m) => m.url),
    location: d.location || 'Zimbabwe',
    sellerName: d.seller_summary?.display_label || 'Seller',
    sellerType: d.seller_summary?.seller_type === 'dealer' ? 'Dealership' : 'Private Owner',
    created_at: d.created_at || undefined,
  } as Vehicle
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function getFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem('carup_favorites') || '[]') } catch { return [] }
}
function getReservations(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem('carup_reservations') || '{}') } catch { return {} }
}

// ── Timeline event icon & color mapping ────────────────────────────────────
function timelineIcon(source: string) {
  const map: Record<string, { icon: typeof Wrench; color: string }> = {
    service:            { icon: Wrench,        color: 'text-blue-600 bg-blue-50' },
    ownership_transfer: { icon: UserCheck,     color: 'text-purple-600 bg-purple-50' },
    insurance:          { icon: Shield,        color: 'text-green-600 bg-green-50' },
    escrow:             { icon: Lock,          color: 'text-amber-600 bg-amber-50' },
    zimra:              { icon: ClipboardCheck,color: 'text-orange-600 bg-orange-50' },
    cvr:                { icon: FileCheck,     color: 'text-teal-600 bg-teal-50' },
    vid:                { icon: CheckCircle,   color: 'text-green-700 bg-green-50' },
    cid:                { icon: Shield,        color: 'text-red-600 bg-red-50' },
    zinara:             { icon: TrendingDown,  color: 'text-gray-600 bg-gray-50' },
    plate_assigned:      { icon: FileCheck,     color: 'text-blue-600 bg-blue-50' },
    temporary_id_issued: { icon: ClipboardCheck,color: 'text-amber-600 bg-amber-50' },
    plate_verified:      { icon: CheckCircle,   color: 'text-green-600 bg-green-50' },
    plate_changed:       { icon: Calendar,      color: 'text-purple-600 bg-purple-50' },
    plate_flagged:       { icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    plate_suspended:     { icon: XCircle,       color: 'text-red-700 bg-red-50' },
    evidence:            { icon: ImageIcon,     color: 'text-orange-600 bg-orange-50' },
  }
  return map[source] ?? { icon: Clock, color: 'text-gray-500 bg-gray-50' }
}

// Removed formatEvidenceLabel since it is no longer used here

// ── Derive Verification sources from passport data ──────────────────────────
function buildVerificationSources(passport: VehiclePassport | null): PassportVerificationSource[] {
  if (!passport) return []

  const m = passport.trustReport?.metrics
  const chain = passport.chainVerification

  return [
    {
      label: 'VIN / Ledger Integrity',
      status: chain?.verified ? 'verified' : 'not_verified',
      detail: chain?.verified
        ? 'Blockchain hash chain verified — no tampering detected'
        : 'Ledger integrity check failed or no events recorded',
    },
    {
      label: 'ZIMRA Customs Cleared',
      status: m?.zimra_duty ? 'verified' : 'not_verified',
      detail: m?.zimra_duty
        ? 'Import duty paid and confirmed via ZIMRA registry'
        : 'No ZIMRA customs declaration found',
    },
    {
      label: 'CVR Ownership Registration',
      status: m?.cvr_synced ? 'verified' : 'not_verified',
      detail: m?.cvr_synced
        ? 'Vehicle registered in Central Vehicle Registry'
        : 'CVR record not yet linked',
    },
    {
      label: 'ZRP Police Clearance',
      status: m?.zrp_police_cleared ? 'verified' : 'not_verified',
      detail: m?.zrp_police_cleared
        ? 'CID check passed — not flagged as stolen'
        : 'CID police clearance not yet recorded',
    },
    {
      label: 'Odometer Consistency',
      status: m?.odometer_consistent ? 'verified' : 'warning',
      detail: m?.odometer_consistent
        ? 'No odometer rollback anomalies detected across service logs'
        : 'Potential mileage discrepancy detected — inspect service history',
    },
    {
      label: 'Active Stolen Alert',
      status: m?.stolen_alert_active ? 'warning' : 'verified',
      detail: m?.stolen_alert_active
        ? '⚠️ Active police alert on this VIN — do not purchase'
        : 'No active stolen vehicle alert',
    },
    {
      label: 'Service Records',
      status: (m?.maintenance_logs_count ?? 0) >= 1 ? 'verified' : 'not_verified',
      detail: (m?.maintenance_logs_count ?? 0) >= 1
        ? `${m?.maintenance_logs_count} signed maintenance log(s) on the blockchain ledger`
        : 'No mechanic-signed service records found',
    },
  ]
}

// ── Status badge for verification sources ───────────────────────────────────
function VerificationBadge({ status }: { status: PassportVerificationSource['status'] }) {
  const map = {
    verified:     { label: 'Verified',   cls: 'bg-green-500 text-white' },
    not_verified: { label: 'Unverified', cls: 'bg-gray-400 text-white' },
    warning:      { label: 'Warning',    cls: 'bg-amber-500 text-white' },
    unknown:      { label: 'Unknown',    cls: 'bg-gray-300 text-gray-700' },
  }
  const { label, cls } = map[status]
  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>
}

// ── Trust breakdown: map TrustMetrics → percentage display scores ─────────
function buildTrustBreakdown(passport: VehiclePassport | null): { label: string; score: number }[] {
  if (!passport?.trustReport?.metrics) return []

  const m = passport.trustReport.metrics
  const base = passport.trustReport.trustScore ?? 70

  return [
    { label: 'Documentation',    score: m.cvr_synced && m.zimra_duty ? 95 : m.cvr_synced || m.zimra_duty ? 70 : 40 },
    { label: 'Service History',  score: Math.min(100, 50 + m.maintenance_logs_count * 10) },
    { label: 'Ownership Clarity',score: m.cvr_synced ? 92 : 55 },
    { label: 'Police Clearance', score: m.zrp_police_cleared ? 98 : m.stolen_alert_active ? 0 : 50 },
    { label: 'Ledger Integrity', score: m.blockchain_audit_valid ? 100 : 20 },
    { label: 'Odometer',         score: m.odometer_consistent ? Math.round(base) : 30 },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VehicleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport, lookupVehiclePassport, fetchMarketplaceListingDetail, saveMarketplaceListing, unsaveMarketplaceListing, fetchSavedMarketplaceListings } = useCarUpApi()
  const { isAuthenticated } = useAuth()

  const [vehicle, setVehicle]   = useState<Vehicle | null>(null)
  const [passport, setPassport] = useState<VehiclePassport | null>(null)
  const [detail, setDetail]     = useState<MarketplaceListingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [loading, setLoading]   = useState(true)

  const [currentImageIdx, setCurrentImageIdx] = useState(0)
  const [isFav, setIsFav]         = useState(() => getFavorites().includes(id || ''))
  const [isReserved, setIsReserved] = useState(false)
  const [isFinanced, setIsFinanced] = useState(false)

  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reserveLoading, setReserveLoading]     = useState(false)

  const [showFinanceModal, setShowFinanceModal] = useState(false)
  const [financeLoading, setFinanceLoading]     = useState(false)
  const [loanAmount, setLoanAmount]             = useState('')
  const [loanTerm, setLoanTerm]                 = useState('36')
  const [selectedBank, setSelectedBank]         = useState('cbz')

  const [lookupQuery, setLookupQuery] = useState('')

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (lookupQuery.trim()) {
      navigate(`/marketplace/${lookupQuery.trim()}`)
    }
  }

  useEffect(() => {
    if (!id) return
    let mounted = true

    const load = async () => {
      try {
        setLoading(true)
        // 1. Try looking up the passport using the new lookup endpoint
        const passportData = await lookupVehiclePassport(id)
        if (!mounted) return

        if (passportData) {
          setPassport(passportData)
          const d = passportData.vehicle
          setVehicle({
            ...d,
            id: d.vin,
            images: (d.images && d.images.length > 0) ? d.images : [],
            features: d.features ?? [],
            sellerName:   d.tenant?.name  ?? passportData.ownershipSummary?.currentSellerDisplayName ?? 'Private Seller',
            sellerPhone:  d.tenant?.phone ?? '+263 77 123 4567',
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   passportData.ownershipSummary?.currentSellerType ?? (d.tenant?.name ? 'Dealership' : 'Private Owner'),
            location:     d.location ?? 'Harare',
            province:     d.province  ?? 'Harare Province',
            listingDate:  d.created_at ?? new Date().toISOString(),
          })
          setLoanAmount((d.price ?? 0).toString())
          const reservations = getReservations()
          if (reservations[d.vin ?? '']) setIsReserved(true)
          setLoading(false)
          return
        }
      } catch (err) {
        console.warn('lookupVehiclePassport failed, trying fallback details fetch:', err)
      }

      // 2. Fallback to VIN canonical endpoints if lookup fails
      try {
        const [vehicleData, passportData] = await Promise.allSettled([
          fetchVehicle(id),
          fetchVehiclePassport(id),
        ])

        if (!mounted) return

        if (vehicleData.status === 'fulfilled' && vehicleData.value) {
          const d = vehicleData.value
          setVehicle({
            ...d,
            id: d.vin,
            images: (d.images && d.images.length > 0) ? d.images : [],
            features: d.features ?? [],
            sellerName:   d.tenant?.name  ?? 'Private Seller',
            sellerPhone:  d.tenant?.phone ?? '+263 77 123 4567',
            sellerAvatar: d.tenant?.logo_url ?? null,
            sellerType:   d.tenant?.name ? 'Dealership' : 'Private Owner',
            location:     d.location ?? 'Harare',
            province:     d.province  ?? 'Harare Province',
            listingDate:  d.created_at ?? new Date().toISOString(),
          })
          setLoanAmount((d.price ?? 0).toString())
          const reservations = getReservations()
          if (reservations[d.vin ?? '']) setIsReserved(true)
        }

        if (passportData.status === 'fulfilled' && passportData.value) {
          setPassport(passportData.value)
        }
      } catch (err) {
        console.error('VehicleDetail load fallback error:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [id, fetchVehicle, fetchVehiclePassport, lookupVehiclePassport])

  // Backend-governed marketplace detail (trust/verification/pricing summaries). Best-effort: if the
  // listing is not a public marketplace listing this stays null and the page renders the passport view.
  useEffect(() => {
    if (!id) return
    let mounted = true
    captureReferralFromUrl()
    const attr = getStoredAttribution()
    setDetailLoading(true)
    fetchMarketplaceListingDetail(id, { ref: attr.referral_code, campaign: attr.campaign_code, source: attr.source })
      .then((d) => {
        if (!mounted) return
        setDetail(d)
        // Fallback: a real public marketplace listing must always open a real detail page. If the
        // passport lookup didn't resolve a vehicle, hydrate from the marketplace detail so the page
        // renders instead of showing "Vehicle Not Found".
        setVehicle((prev) => prev ?? vehicleFromMarketplaceDetail(d))
      })
      .catch(() => { if (mounted) setDetail(null) })
      .finally(() => { if (mounted) setDetailLoading(false) })
    return () => { mounted = false }
  }, [id, fetchMarketplaceListingDetail])

  // Saved state is SERVER-backed + account-scoped for authenticated users (existing /marketplace/saved
  // API), so it survives refresh and never leaks across accounts. Guests keep the browser-local list.
  useEffect(() => {
    if (!isAuthenticated) return
    const vin = vehicle?.vin || id
    if (!vin) return
    let active = true
    fetchSavedMarketplaceListings()
      .then(res => { if (active) setIsFav((res.listings || []).some(l => l.vin === vin)) })
      .catch(() => { /* server unavailable — keep current */ })
    return () => { active = false }
  }, [isAuthenticated, vehicle?.vin, id, fetchSavedMarketplaceListings])

  const toggleFavorite = useCallback(async () => {
    if (!vehicle) return

    if (isAuthenticated) {
      // Server-backed + account-scoped. Optimistic toggle, rolled back on error. No localStorage write.
      const vin = vehicle.vin || id || ''
      if (!vin) return
      const previous = isFav
      setIsFav(!previous)
      try {
        if (previous) {
          await unsaveMarketplaceListing(vin)
          toast.info('Removed from saved cars')
        } else {
          await saveMarketplaceListing(vin)
          toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
        }
      } catch {
        setIsFav(previous)
        toast.error('Could not update saved cars. Please try again.')
      }
      return
    }

    // Guest fallback: browser-local only (unchanged behavior).
    const current = getFavorites()
    let updated: string[]
    if (current.includes(vehicle.id || '')) {
      updated = current.filter(i => i !== vehicle.id)
      setIsFav(false)
      toast.info('Removed from saved cars')
    } else {
      updated = [...current, vehicle.id || '']
      setIsFav(true)
      toast.success(`${vehicle.make ?? ''} ${vehicle.model ?? ''} saved!`)
    }
    localStorage.setItem('carup_favorites', JSON.stringify(updated))
  }, [vehicle, id, isAuthenticated, isFav, saveMarketplaceListing, unsaveMarketplaceListing])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: `${vehicle?.year ?? ''} ${vehicle?.make ?? ''} ${vehicle?.model ?? ''}`, url }) } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success('Link copied to clipboard!')
    }
  }, [vehicle])

  const handleReserve = async () => {
    if (!vehicle) return
    setReserveLoading(true)
    try {
      const seller = vehicle.tenant_id ?? vehicle.sellerId ?? 'unknown_seller'
      await reserveVehicle(vehicle.vin ?? '', 'u1', 7)
      await createSafePayEscrow(vehicle.vin ?? '', seller, 500)
      const reservations = getReservations()
      ;(reservations as Record<string, unknown>)[vehicle.vin ?? ''] = { vehicleId: vehicle.id ?? '', timestamp: new Date().toISOString() }
      localStorage.setItem('carup_reservations', JSON.stringify(reservations))
      setIsReserved(true)
      setShowReserveModal(false)
      toast.success('Vehicle reserved! SafePay escrow of $500 initiated.', { duration: 5000 })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to initiate Escrow. Make sure you are logged in.')
    } finally {
      setReserveLoading(false)
    }
  }

  const handleFinance = async () => {
    if (!vehicle) return
    setFinanceLoading(true)
    try {
      await submitFinancing(vehicle.vin ?? '', 'u1', selectedBank, parseFloat(loanAmount))
      setIsFinanced(true)
      setShowFinanceModal(false)
      toast.success('Financing application submitted!', { duration: 6000 })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit application. Make sure you are logged in.')
    } finally {
      setFinanceLoading(false)
    }
  }

  // ── Loading / 404 states ─────────────────────────────────────────────────
  if (loading || (!vehicle && detailLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Car className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Vehicle Not Found</h1>
          <p className="text-gray-500 mb-6">The vehicle you're looking for doesn't exist or has been removed.</p>
          <Button className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link to="/marketplace">Back to Marketplace</Link>
          </Button>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const FALLBACK_IMAGE = null // No fake Unsplash image
  const allImages: string[] = (vehicle.images && vehicle.images.length > 0)
    ? vehicle.images
    : (FALLBACK_IMAGE ? [FALLBACK_IMAGE] : [])

  const hasRealImages  = allImages.length > 0
  const trustScore     = passport?.trustReport?.trustScore ?? vehicle.trust_score ?? 0
  const trustColor     = trustScore >= 90 ? 'bg-green-500' : trustScore >= 75 ? 'bg-amber-500' : 'bg-red-500'
  const trustLabel     = trustScore >= 90 ? 'Excellent' : trustScore >= 75 ? 'Good' : 'Fair'
  const waLink         = `https://wa.me/${(vehicle.sellerPhone ?? '').replace(/[^0-9]/g, '')}?text=Hi%2C%20I%20am%20interested%20in%20your%20${vehicle.year ?? ''}%20${vehicle.make ?? ''}%20${vehicle.model ?? ''}%20listed%20on%20CarUp.`

  const timeline            = passport?.timeline ?? []
  const evidenceVault       = passport?.evidenceVault ?? []
  const publicEvidence      = evidenceVault.filter(e => e.verification_status === 'verified' && e.visibility_level === 'public_safe')
  const verificationSources = buildVerificationSources(passport)
  const trustBreakdown      = buildTrustBreakdown(passport)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Link to="/" className="hover:text-orange-500">Home</Link>
              <span>/</span>
              <Link to="/marketplace" className="hover:text-orange-500">Marketplace</Link>
              <span>/</span>
              <span className="text-gray-900">{vehicle.make} {vehicle.model}</span>
            </div>
            
            <form onSubmit={handleLookupSubmit} className="flex gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Enter VIN, chassis, plate, or temporary ID"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  className="pl-9 h-9 text-xs bg-gray-50"
                />
              </div>
              <Button type="submit" size="sm" className="bg-orange-500 hover:bg-orange-600 text-xs">Lookup</Button>
            </form>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        <Button variant="ghost" size="sm" className="mb-4 gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>

        {/* Backend-governed marketplace panels (trust, all-in price, inquiry, safety) */}
        {detail && (
          <div className="mb-6 grid gap-4 lg:grid-cols-3" data-testid="marketplace-detail-panels">
            <div className="space-y-4 lg:col-span-2">
              <TrustSummaryPanel trust={detail.trust_summary} verification={detail.verification_summary} />
              <SafetyWarnings warnings={detail.safety_warnings} />
            </div>
            <div className="space-y-4">
              <AllInPricePanel pricing={detail.pricing_summary} />
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Contact &amp; inquire</h3>
                <div className="flex flex-col gap-2">
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_purchase_interest', 'vehicle_inspection_request']}
                    triggerLabel="Send inquiry"
                    triggerClassName="w-full"
                  />
                  <InquiryModal
                    listingId={detail.vin}
                    inquiryTypes={['vehicle_inspection_request']}
                    defaultInquiryType="vehicle_inspection_request"
                    triggerLabel="Request inspection"
                    triggerVariant="outline"
                    triggerClassName="w-full"
                  />
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Inquiries are safe — the CarUp team helps connect you. Never pay outside CarUp.</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Plate Advisory Banner */}
            {passport && (
              (() => {
                const isMissing = !passport.identity?.plateNumber && !passport.identity?.temporaryIdentificationNumber;
                const isUnverified = passport.identity?.plateNumber && !passport.identity?.plateVerifiedAt;
                const isFlagged = passport.identity?.plateStatus === 'Flagged' || passport.identity?.plateStatus === 'Suspended';
                
                if (isFlagged) {
                  return (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-red-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">SECURITY WARNING: Plate Flagged/Suspended</p>
                        <p className="text-xs mt-0.5">The registration plate registered to this vehicle has been marked as Flagged or Suspended by the registry authority. Proceed with caution.</p>
                      </div>
                    </div>
                  );
                } else if (isMissing) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Missing Number Plate</p>
                        <p className="text-xs mt-0.5">This vehicle does not have a permanent registration plate or temporary identification number registered. Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                } else if (isUnverified) {
                  return (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-800 flex items-start gap-3" data-testid="plate-advisory">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Confidence Advisory: Unverified Number Plate</p>
                        <p className="text-xs mt-0.5">A number plate is assigned but has not yet been verified against the Central Vehicle Registry (CVR). Trust score confidence has been reduced.</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()
            )}

            {/* Image gallery */}
            <div className="relative rounded-xl overflow-hidden bg-white card-shadow" data-testid="image-gallery">
              {hasRealImages ? (
                <>
                  <img
                    src={allImages[currentImageIdx]}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    className="w-full aspect-[16/9] object-cover"
                    data-testid="vehicle-image"
                  />
                  {allImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setCurrentImageIdx(i => (i - 1 + allImages.length) % allImages.length)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setCurrentImageIdx(i => (i + 1) % allImages.length)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                        {currentImageIdx + 1} / {allImages.length}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div
                  className="w-full aspect-[16/9] bg-gray-100 flex flex-col items-center justify-center text-gray-400 gap-3"
                  data-testid="no-images-placeholder"
                >
                  <Car className="w-16 h-16 opacity-30" />
                  <p className="text-sm font-medium">No verified images uploaded yet</p>
                  <p className="text-xs text-gray-400">The seller has not uploaded any images for this vehicle</p>
                </div>
              )}
              <div className="absolute top-4 left-4 flex gap-2">
                {vehicle.police_verified && (
                  <Badge className="bg-green-500 text-white"><CheckCircle className="w-3 h-3 mr-1" /> CarUp Verified</Badge>
                )}
                {(trustScore ?? 0) > 90 && (
                  <Badge className="bg-orange-500 text-white">Featured</Badge>
                )}
                {isReserved && <Badge className="bg-amber-500 text-white">Reserved</Badge>}
              </div>
              <div className="absolute top-4 right-4 flex gap-2">
                <button onClick={toggleFavorite} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Heart className={`w-5 h-5 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                </button>
                <button onClick={handleShare} className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                  <Share2 className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            {/* Thumbnails */}
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allImages.map((img, i) => (
                  <button key={i} onClick={() => setCurrentImageIdx(i)}
                    className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === currentImageIdx ? 'border-orange-500' : 'border-transparent'}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Info card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}</h1>
                    
                    {/* Plate, VIN and Registration Status identity block */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded text-gray-700 font-mono">
                        VIN: {vehicle.vin}
                      </span>
                      {passport?.identity?.plateNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-mono flex items-center gap-1" data-testid="identity-plate">
                          Plate: {passport.identity.plateNumber}
                        </span>
                      ) : passport?.identity?.temporaryIdentificationNumber ? (
                        <span className="text-xs font-bold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded font-mono flex items-center gap-1" data-testid="identity-temp-id">
                          Temp ID: {passport.identity.temporaryIdentificationNumber}
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded" data-testid="identity-no-plate">
                          No Plate Assigned
                        </span>
                      )}
                      {passport?.identity?.registrationStatus && (
                        <Badge className={`${
                          passport.identity.registrationStatus === 'Current' || passport.identity.registrationStatus === 'Active' ? 'bg-green-500 text-white' : 
                          passport.identity.registrationStatus === 'Pending' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                        } text-[10px] font-semibold`} data-testid="registration-status-badge">
                          {passport.identity.registrationStatus}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
                      <MapPin className="w-4 h-4" />{vehicle.location ?? ''}, {vehicle.province ?? ''}
                      <span className="mx-1">•</span>
                      <Calendar className="w-4 h-4" />Listed {vehicle.listingDate ? new Date(vehicle.listingDate).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                  <div className={`${trustColor} text-white px-4 py-2 rounded-xl text-center min-w-[70px]`} data-testid="trust-score-badge">
                    <p className="text-2xl font-bold">{Math.round(trustScore)}</p>
                    <p className="text-xs">{trustLabel}</p>
                  </div>
                </div>
                {vehicle.description && <p className="text-gray-700 mb-6 leading-relaxed">{vehicle.description}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Mileage',       value: `${(vehicle.mileage ?? 0).toLocaleString()} km`, icon: Gauge },
                    { label: 'Transmission',  value: vehicle.transmission ?? 'Auto', icon: Settings2 },
                    { label: 'Fuel Type',     value: vehicle.fuel_type ?? vehicle.fuelType ?? 'Petrol', icon: Fuel },
                    { label: 'Condition',     value: vehicle.condition ?? 'Used', icon: FileCheck },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="font-semibold text-sm">{item.value}</p>
                    </div>
                  ))}
                </div>
                {(vehicle.features ?? []).length > 0 && (
                  <>
                    <Separator className="mb-6" />
                    <h3 className="font-semibold mb-3">Features</h3>
                    <div className="flex flex-wrap gap-2">
                      {(vehicle.features ?? []).map((f) => (
                        <Badge key={f} variant="secondary" className="bg-gray-100 text-gray-700 font-normal">{f}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <Tabs defaultValue="history">
                  <TabsList className="w-full">
                    <TabsTrigger value="history" className="flex-1">Vehicle History</TabsTrigger>
                    <TabsTrigger value="evidence" className="flex-1">Evidence Vault</TabsTrigger>
                    <TabsTrigger value="verification" className="flex-1">Verification</TabsTrigger>
                    <TabsTrigger value="market" className="flex-1">Market Analysis</TabsTrigger>
                  </TabsList>

                  {/* ── History tab: real timeline ── */}
                  <TabsContent value="history" className="mt-4" data-testid="history-tab-content">
                    {timeline.length === 0 ? (
                      <div className="text-center py-8 text-gray-400" data-testid="history-empty-state">
                        <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No history events recorded yet</p>
                        <p className="text-xs mt-1 text-gray-400">Events appear as service records, ownership transfers, and inspections are logged on the CarUp blockchain</p>
                      </div>
                    ) : (
                      <div className="space-y-3" data-testid="history-timeline">
                        {timeline.map((event: TimelineEvent, idx) => {
                          const { icon: Icon, color } = timelineIcon(event.event_source)
                          return (
                            <div key={`${event.event_source}-${event.id ?? idx}`}
                              className="flex items-start gap-3 p-3 rounded-lg bg-gray-50"
                              data-testid="timeline-event"
                            >
                              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{event.label}</p>
                                {event.desc && <p className="text-xs text-gray-500 mt-0.5 truncate">{event.desc}</p>}
                                <p className="text-xs text-gray-400 mt-1">
                                  {event.timestamp ? new Date(event.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown'}
                                  {event.details?.mileage ? ` · ${event.details.mileage.toLocaleString()} km` : ''}
                                </p>
                                {event.event_source === 'evidence' && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Badge className="bg-green-100 text-green-700 border-0 shadow-none">
                                      Verified Proof
                                    </Badge>
                                    {event.linked_registry_event_id && (
                                      <span className="text-[11px] text-gray-500 font-mono">
                                        Linked: {event.linked_registry_event_id}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {/* Add chronological evidence thumbnails */}
                                {publicEvidence.filter(e => e.linked_registry_event_id === String(event.id) || e.timeline_event_id === String(event.id)).length > 0 && (
                                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                                    {publicEvidence.filter(e => e.linked_registry_event_id === String(event.id) || e.timeline_event_id === String(event.id)).map(item => {
                                      const isDoc = item.mime_type?.includes('pdf') || item.file_url.endsWith('.pdf') || item.evidence_type.includes('document');
                                      return (
                                        <div key={item.id} className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border border-gray-200" data-testid={`history-thumbnail-${item.id}`}>
                                          {isDoc ? (
                                            <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                                              <FileText className="w-6 h-6 text-gray-400" />
                                            </div>
                                          ) : (
                                            <img src={item.file_url} className="w-full h-full object-cover" alt="" />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Evidence tab: buyer-facing visual proof timeline ── */}
                  <TabsContent value="evidence" className="mt-4" data-testid="evidence-timeline-tab-content">
                    <PremiumEvidenceGallery evidence={evidenceVault} />
                  </TabsContent>

                  {/* ── Verification tab: real trust metrics ── */}
                  <TabsContent value="verification" className="mt-4" data-testid="verification-tab-content">
                    {verificationSources.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">Verification data unavailable</p>
                        <p className="text-xs mt-1">Trust report could not be loaded for this vehicle</p>
                      </div>
                    ) : (
                      <div className="space-y-2" data-testid="verification-list">
                        {verificationSources.map((src: PassportVerificationSource) => {
                          const Icon = src.status === 'verified' ? CheckCircle
                            : src.status === 'warning' ? AlertTriangle
                            : src.status === 'not_verified' ? XCircle
                            : HelpCircle
                          const iconColor = src.status === 'verified' ? 'text-green-600'
                            : src.status === 'warning' ? 'text-amber-600'
                            : 'text-gray-400'

                          return (
                            <div key={src.label}
                              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
                              data-testid="verification-item"
                            >
                              <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{src.label}</p>
                                {src.detail && <p className="text-xs text-gray-500 mt-0.5">{src.detail}</p>}
                              </div>
                              <VerificationBadge status={src.status} />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Market Analysis tab ── */}
                  <TabsContent value="market" className="mt-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Listed Price</p>
                        <p className="text-xl font-bold">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Trust Score</p>
                        <p className={`text-xl font-bold ${trustScore >= 90 ? 'text-green-600' : trustScore >= 75 ? 'text-amber-600' : 'text-red-600'}`}>
                          {Math.round(trustScore)} / 100
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <p className="text-xs text-gray-500 mb-1">Service Records</p>
                        <p className="text-xl font-bold">{passport?.trustReport?.metrics?.maintenance_logs_count ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                      <h4 className="font-medium text-sm mb-2">CarUp Data Summary</h4>
                      <p className="text-sm text-gray-600">
                        This vehicle has a trust score of {Math.round(trustScore)}/100 based on {passport?.timeline?.length ?? 0} verified blockchain events.
                        {(passport?.trustReport?.metrics?.maintenance_logs_count ?? 0) > 0
                          ? ` It has ${passport?.trustReport?.metrics?.maintenance_logs_count} mechanic-signed service record(s) on the ledger.`
                          : ' No mechanic-signed service records have been submitted yet.'}
                        {passport?.trustReport?.metrics?.stolen_alert_active
                          ? ' ⚠️ WARNING: This vehicle has an active police alert.'
                          : ' No active stolen vehicle alert.'}
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* ── Right sidebar ────────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Price / CTA card */}
            <Card className="border-0 card-shadow bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white sticky top-6">
              <CardContent className="p-6">
                <p className="text-sm text-gray-300 mb-1">Price</p>
                <p className="text-3xl font-bold">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm text-gray-300">CarUp Trust Score: {Math.round(trustScore)}</span>
                </div>
                <div className="flex gap-2 mt-6">
                  <a href={`tel:${vehicle.sellerPhone}`} onClick={() => toast.info(`Calling ${vehicle.sellerName}...`)} className="flex-1">
                    <Button className="w-full bg-orange-500 hover:bg-orange-600 gap-1"><Phone className="w-4 h-4" /> Call</Button>
                  </a>
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="outline" className="w-full border-white/30 text-white hover:bg-white/10 gap-1"><MessageSquare className="w-4 h-4" /> WhatsApp</Button>
                  </a>
                </div>
                <Separator className="my-4 border-white/20" />
                {isReserved ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg py-3 text-green-400 font-semibold text-sm">
                    <CheckCircle className="w-4 h-4" /> Vehicle Reserved — SafePay Active
                  </div>
                ) : (
                  <Button className="w-full bg-white text-gray-900 hover:bg-gray-100 font-semibold gap-2" onClick={() => setShowReserveModal(true)}>
                    <Lock className="w-4 h-4" /> Reserve Vehicle
                  </Button>
                )}
                {isFinanced ? (
                  <div className="w-full flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg py-3 text-blue-400 font-semibold text-sm mt-3">
                    <CheckCircle className="w-4 h-4" /> Financing Applied ✓
                  </div>
                ) : (
                  <Button variant="outline" className="w-full mt-3 border-white/20 text-white hover:bg-white/10 gap-2" onClick={() => setShowFinanceModal(true)}>
                    <CreditCard className="w-4 h-4" /> Apply for Financing
                  </Button>
                )}
                <p className="text-xs text-gray-400 text-center mt-3">🔒 Protected by CarUp SafePay Escrow</p>
              </CardContent>
            </Card>

            {/* Seller card */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Seller Information</h3>
                <div className="flex items-center gap-3 mb-4">
                  {vehicle.sellerAvatar && <img src={vehicle.sellerAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />}
                  <div>
                    <p className="font-medium">{vehicle.sellerName}</p>
                    <Badge variant="outline" className="text-[10px] mt-0.5">{vehicle.sellerType}</Badge>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <a href={`tel:${vehicle.sellerPhone}`} className="hover:text-orange-500">{vehicle.sellerPhone}</a>
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-4" asChild>
                  <Link to="/dealers">View All Listings</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Vehicle Identity */}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Vehicle Identity</h3>
                <div className="space-y-3 text-sm">
                  {[
                    ['VIN', passport?.identity?.vin || vehicle.vin || '—'],
                    ['Chassis No.', passport?.identity?.chassisNumber || vehicle.chassis_number || '—'],
                    ['Engine No.', passport?.identity?.engineNumber || vehicle.engine_number || vehicle.engineNumber || '—'],
                    ['Reg. Country', passport?.identity?.registrationCountry || vehicle.registration_country || 'ZW'],
                    ['Reg. Authority', passport?.identity?.registrationAuthority || vehicle.registration_authority || 'CVR'],
                    ['Color', vehicle.color ?? '—']
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-mono text-xs">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Ownership Summary */}
            {passport?.ownershipSummary && (
              <Card className="border-0 card-shadow" data-testid="ownership-summary-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Ownership Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Seller</span>
                      <span className="font-medium">{passport.ownershipSummary.currentSellerDisplayName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Current Owner Type</span>
                      <span className="font-medium">{passport.ownershipSummary.currentSellerType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Previous Owners</span>
                      <span className="font-medium" data-testid="prev-owner-count">
                        {passport.ownershipSummary.previousOwnerCount} owner(s) ({passport.ownershipSummary.previousOwnersPublicLabel})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Owner PII Status</span>
                      <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
                        {passport.ownershipSummary.ownerNamesRedacted ? 'Redacted' : 'Full Access'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Plate History */}
            {passport?.plateHistory && (
              <Card className="border-0 card-shadow" data-testid="plate-history-card">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Plate Registration History</h3>
                  {passport.plateHistory.length === 0 ? (
                    <p className="text-xs text-gray-400">No previous plates logged in history.</p>
                  ) : (
                    <div className="space-y-3">
                      {passport.plateHistory.map((h, i) => (
                        <div key={h.id || i} className="border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-mono font-bold text-xs">{h.plate_number}</span>
                            <Badge variant="outline" className={`text-[9px] uppercase ${
                              h.status === 'active' ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'
                            }`}>
                              {h.status}
                            </Badge>
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                            <span>Type: {h.plate_type}</span>
                            <span>{h.issued_at ? new Date(h.issued_at).toLocaleDateString() : '—'}</span>
                          </div>
                          {h.reason && <p className="text-[10px] text-gray-500 mt-1 italic">Reason: {h.reason}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Trust score breakdown — real data */}
            {trustBreakdown.length > 0 && (
              <Card className="border-0 card-shadow" data-testid="trust-breakdown">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Trust Score Breakdown</h3>
                  <div className="space-y-3">
                    {trustBreakdown.map(({ label, score }) => (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600">{label}</span>
                          <span className="font-medium">{score}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${score >= 90 ? 'bg-green-500' : score >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ledger verification badge */}
            {passport?.chainVerification && (
              <Card className="border-0 card-shadow">
                <CardContent className="p-4">
                  <div className={`flex items-center gap-2 text-sm ${passport.chainVerification.verified ? 'text-green-700' : 'text-amber-700'}`}>
                    {passport.chainVerification.verified
                      ? <><CheckCircle className="w-4 h-4" /> Blockchain ledger verified — tamper-proof record</>
                      : <><AlertTriangle className="w-4 h-4" /> Ledger integrity unconfirmed</>
                    }
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ── Reserve Modal ─────────────────────────────────────────────────── */}
      <Dialog open={showReserveModal} onOpenChange={setShowReserveModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-orange-500" /> Reserve this Vehicle</DialogTitle>
            <DialogDescription>Secure your interest with a CarUp SafePay reservation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-semibold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>✓ Vehicle held exclusively for you for 7 days</p>
              <p>✓ Refundable deposit of <strong>$500</strong> held in SafePay escrow</p>
              <p>✓ Seller notified immediately via WhatsApp</p>
              <p>✓ Funds released only on successful transfer</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowReserveModal(false)} disabled={reserveLoading}>Cancel</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={handleReserve} disabled={reserveLoading}>
                {reserveLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : 'Confirm Reservation'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Finance Modal ─────────────────────────────────────────────────── */}
      <Dialog open={showFinanceModal} onOpenChange={setShowFinanceModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-blue-500" /> Apply for Financing</DialogTitle>
            <DialogDescription>Get pre-approved through CarUp's banking partners</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Vehicle</p>
              <p className="font-semibold">{vehicle.year ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''} — {formatPrice(vehicle.price ?? 0, vehicle.currency ?? 'USD')}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Amount (USD)</label>
              <Input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} min={1000} max={vehicle.price ?? 0} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Loan Term</label>
              <Select value={loanTerm} onValueChange={setLoanTerm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['12', '24', '36', '48', '60'].map(m => <SelectItem key={m} value={m}>{m} months</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Preferred Bank</label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cbz">CBZ Bank</SelectItem>
                  <SelectItem value="stanbic">Stanbic Zimbabwe</SelectItem>
                  <SelectItem value="cabs">CABS Bank</SelectItem>
                  <SelectItem value="fbc">FBC Bank</SelectItem>
                  <SelectItem value="zb">ZB Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowFinanceModal(false)} disabled={financeLoading}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleFinance} disabled={financeLoading || !loanAmount}>
                {financeLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Application'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
