import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  Car,
  Wrench,
  Shield,
  FileText,
  ArrowRight,
  Plus,
  Gauge,
  CheckCircle,
  MessageSquare,
  WifiOff,
  Wallet,
  Upload
} from 'lucide-react'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { Vehicle, Notification, Escrow } from '@/types'

// ── The canonical trust claim on the owner's list surfaces (Issue #164, Phases 3 & 4) ───────
/**
 * Phase 3 made `canonicalTrustService` the only authority that may state a vehicle's trust
 * position, and every list endpoint an owner sees — `/api/vehicles/me`, `/api/vehicles/saved`,
 * the marketplace listing summaries — now carries its projection verbatim on `trust`. These
 * dashboard rows still read the flat `trust_score` and drew `<Progress value={trust_score} />`
 * beside it. With no evaluation that number is null, so the row rendered "Trust Index: %" over a
 * track filled to 0%: a vehicle CarUp has never assessed, presented as one it assessed and found
 * worthless. That is the same absence-as-proof Phase 3 removed from VehicleDetail and
 * VehicleProfile, left live on four further pages.
 *
 * `evaluation_state` is the required discriminator, which is what makes the deprecated
 * `{vin, trustScore, metrics}` body parse as no trust record rather than as a score of 90.
 *
 * Exported because MyGarage and MyListings are this same surface in another layout. One
 * definition of what a trust claim is, three call sites — a per-page copy is how the surfaces
 * drifted apart in the first place. All four pages are statically imported by App.tsx into one
 * bundle, so the shared import adds no chunk.
 */
export type OwnerTrustClaim = {
  /** A number ONLY in the `evaluated` state. Null everywhere else, and null never becomes 0. */
  score: number | null
  state: string
  headline: string
}

/** Band vocabulary, verbatim from the authority. No 'Excellent'/'Good'/'Fair' tier is invented. */
const TRUST_BAND_LABELS: Record<string, string> = {
  high: 'High trust',
  moderate: 'Moderate trust',
  low: 'Low trust',
  insufficient_evidence: 'Insufficient evidence',
}

const TRUST_STATE_LABELS: Record<string, string> = {
  evaluated: 'Evaluated',
  stale: 'Assessment out of date',
  not_evaluated: 'Not evaluated',
  unavailable: 'Trust assessment unavailable',
}

/**
 * Narrowing only. Nothing here computes a score, applies a threshold, or lets another field on the
 * row stand in for one — in particular the row's own `trust_score`, which is what these pages read
 * before and which no page may read again.
 */
export function readOwnerTrustClaim(row: unknown): OwnerTrustClaim {
  const raw = (row as { trust?: unknown } | null | undefined)?.trust
  const trust = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const state = typeof trust?.evaluation_state === 'string' ? trust.evaluation_state : 'unavailable'
  // Fails closed. A score arriving under a stale or not_evaluated state is still not printed, so a
  // route that ever published an ungoverned number shows the lifecycle state instead of the number.
  const score = state === 'evaluated' && typeof trust?.score === 'number' && Number.isFinite(trust.score)
    ? (trust.score as number)
    : null
  const band = typeof trust?.band === 'string' ? trust.band : null
  const headline = score !== null
    ? (TRUST_BAND_LABELS[band ?? ''] ?? band ?? TRUST_STATE_LABELS.evaluated)
    : (TRUST_STATE_LABELS[state] ?? TRUST_STATE_LABELS.unavailable)
  return { score, state, headline }
}

/**
 * A recorded 0 is a fact — Phase 1's FIELD_STATES counts 0 and false as `recorded`, because a
 * genuine zero-mileage import is not a missing odometer. Only null/undefined is missing, and
 * missing renders as words. `vehicle.mileage?.toLocaleString() + ' km'` rendered a bare " km".
 */
export function statedMileage(km: unknown): string {
  return typeof km === 'number' && Number.isFinite(km) ? `${km.toLocaleString()} km` : 'Mileage not recorded'
}

/** Same rule for money: a real 0 prints, an absent price is named rather than shown as $0 or $. */
export function statedPrice(amount: unknown): string {
  return typeof amount === 'number' && Number.isFinite(amount) ? `$${amount.toLocaleString()}` : 'Price not recorded'
}

/** `new Date('').toLocaleDateString()` is the string "Invalid Date"; an absent date says so. */
export function statedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
}

export default function OwnerDashboard() {
  const { fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications } = useCarUpApi()
  const { user } = useAuth()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [liveNotifications, setLiveNotifications] = useState<Notification[]>([])

  useEffect(() => {
    let mounted = true
    fetchOwnedVehicles().then(data => { if (mounted) setVehicles(data) })
    fetchNotifications().then(data => { if (mounted) setLiveNotifications(data) })
    return () => { mounted = false }
  }, [fetchOwnedVehicles, fetchNotifications])

  const recentNotifications = liveNotifications.slice(0, 3)

  // Onboarding & settings states.
  //
  // The WhatsApp verification alert that used to live here held its own `whatsappLinked` state,
  // initialised to `true`. No endpoint reports whether this account's WhatsApp is linked, so every
  // owner was told their channel was verified on the strength of a default; and its "Verify Now"
  // button set that flag locally and raised "WhatsApp communication verified successfully" without
  // contacting anything. Both the status and the verification were fabricated, so both are gone
  // rather than restated more carefully.
  const [lowBandwidth, setLowBandwidth] = useState(false)

  // SafePay escrow is the only authoritative money source this dashboard has. There is no
  // per-user wallet/ledger endpoint and no per-user trust-score endpoint, so those cards must
  // report that no authoritative value exists rather than render invented figures — previously
  // fixed balances, a fixed trust percentage and a verified-status label were shown to every
  // account, including brand-new ones.
  const [escrow, setEscrow] = useState<{ status: 'loading' | 'ready' | 'error'; usd: number; count: number }>({
    status: 'loading',
    usd: 0,
    count: 0,
  })

  // Fetch SafePay escrows on mount
  useEffect(() => {
    let mounted = true
    const loadEscrows = async () => {
      try {
        const escrows = await fetchSafePayEscrows()
        if (!mounted) return
        const list = escrows || []
        const totalUsd = list.reduce((sum: number, e: Escrow) => e.currency === 'USD' ? sum + e.amount : sum, 0)
        setEscrow({ status: 'ready', usd: totalUsd, count: list.length })
      } catch (err) {
        console.error('Failed to load escrows', err)
        if (mounted) setEscrow({ status: 'error', usd: 0, count: 0 })
      }
    }
    loadEscrows()
    return () => { mounted = false }
  }, [fetchSafePayEscrows])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Owner Dashboard</h1>
          <p className="text-gray-500">Welcome back{user?.name ? `, ${user.name}` : ''}! Monitor your vehicles, escrows, and insurance logs.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Low Bandwidth mode toggle */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border text-xs text-gray-600">
            <WifiOff className={`w-4 h-4 ${lowBandwidth ? 'text-orange-500 animate-pulse' : 'text-gray-400'}`} />
            <span>Low-Bandwidth Mode</span>
            <input 
              type="checkbox" 
              checked={lowBandwidth} 
              onChange={() => {
                setLowBandwidth(!lowBandwidth);
                // The toggle hides images; it does not compress them, and saying so was a claim
                // about work the page never did.
                toast.success(lowBandwidth ? 'Images restored.' : 'Low-bandwidth mode enabled. Images are not loaded.');
              }}
              className="rounded text-orange-500 focus:ring-orange-400 cursor-pointer h-4 w-4"
            />
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/garage"><Car className="w-4 h-4 mr-1" /> My Garage</Link>
          </Button>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" asChild>
            <Link to="/dashboard/ai"><MessageSquare className="w-4 h-4 mr-1" /> Ask Gutu AI</Link>
          </Button>
        </div>
      </div>

      {/* Multi-currency Wallet Card */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Automotive Wallet (USD)</p>
                <p data-testid="wallet-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>
                <p className="text-[10px] text-gray-400 mt-1">No wallet established for this account</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-50 text-green-500 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Automotive Wallet (ZiG)</p>
                <p data-testid="wallet-zig-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>
                <p className="text-[10px] text-gray-400 mt-1">No wallet established for this account</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Locked SafePay Escrows</p>
                {escrow.status === 'loading' && <p data-testid="escrow-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Loading…</p>}
                {escrow.status === 'error' && <p data-testid="escrow-usd-value" className="text-lg font-semibold mt-1 text-gray-500">Not available</p>}
                {escrow.status === 'ready' && <p data-testid="escrow-usd-value" className="text-2xl font-bold mt-1">${escrow.usd.toLocaleString()}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  {escrow.status === 'ready'
                    ? `${escrow.count} active purchase escrow${escrow.count !== 1 ? 's' : ''}`
                    : escrow.status === 'error'
                      ? 'Could not load your escrows'
                      : 'Checking your escrows'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 card-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Auto-calculated Trust Index</p>
                <p data-testid="trust-index-value" className="text-lg font-semibold mt-1 text-gray-500">Not calculated</p>
                <p data-testid="trust-index-label" className="text-[10px] text-gray-400 font-medium mt-1">Verification pending</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center">
                <CheckCircle className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* My Garage */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">My Vehicles</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard/garage" className="gap-1">View All <ArrowRight className="w-4 h-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {vehicles.slice(0, 3).map((vehicle) => {
                const trust = readOwnerTrustClaim(vehicle)
                return (
                <Link key={vehicle.vin} to={`/dashboard/garage/${vehicle.vin}`} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
                  {/* An unrelated stock car is a claim about this vehicle's condition. ListingImage
                      renders a neutral "Image unavailable" placeholder instead. */}
                  {!lowBandwidth && (
                    <ListingImage
                      src={vehicle.image_url}
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      className="w-20 h-14 rounded-lg overflow-hidden shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-gray-800">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <Badge variant="outline" className="text-[10px]">{vehicle.vin}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{statedMileage(vehicle.mileage)}</span>
                    </div>
                    <div className="mt-2" data-testid={`trust-claim-${vehicle.vin}`}>
                      {trust.score !== null ? (
                        <>
                          <span className="text-xs text-gray-500">
                            Trust Index: <b data-testid={`trust-claim-score-${vehicle.vin}`}>{trust.score} / 100</b> · {trust.headline}
                          </span>
                          <Progress value={trust.score} className="h-1 mt-1" indicatorClassName="bg-orange-500" />
                        </>
                      ) : (
                        /* No bar at all. A track drawn at 0% is a measurement, and none was made —
                           the empty track WAS the fabrication, not the missing number beside it. */
                        <span className="text-xs italic text-gray-400" data-testid={`trust-claim-state-${vehicle.vin}`}>
                          Trust Index: {trust.headline}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-orange-500 transition-colors" />
                </Link>
                )
              })}
            </CardContent>
          </Card>

          {/* Digital Document Vault.
              The upload control is disabled on purpose. It previously called the OCR endpoint with a
              hardcoded mock payload, so a user who never chose a file still got a success toast and a
              fabricated document row. There is no per-user document store to upload into yet, so the
              honest state is an unavailable control and an empty vault — not a simulated upload. */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Digital Document Vault</CardTitle>
              <Button
                size="sm"
                disabled
                data-testid="ocr-upload-btn"
                title="Document upload is not available from this dashboard yet"
                className="gap-1 text-xs font-semibold"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload unavailable
              </Button>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="document-vault-list">
              <p data-testid="document-vault-empty" className="text-xs text-gray-500 py-2">
                No documents uploaded yet.
              </p>
              <p data-testid="document-vault-unavailable" className="text-[10px] text-gray-400">
                Document upload is not available from this dashboard yet.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* There is no per-user valuation history endpoint, so this card must not plot a series.
              It previously rendered a fixed $28k→$26.3k trend for every account, including brand-new
              ones with no vehicles at all. */}
          {!lowBandwidth && (
            <Card className="border-0 card-shadow bg-white">
              <CardHeader className="pb-3"><CardTitle className="text-lg">Vehicle Value Trend</CardTitle></CardHeader>
              <CardContent>
                <p data-testid="value-trend-unavailable" className="text-xs text-gray-500 py-2">
                  Valuation history is not available for your account yet.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Add Vehicle', icon: Plus, href: '/dashboard/garage' },
                { label: 'Service History', icon: Wrench, href: '/dashboard/service-history' },
                { label: 'Insurance Records', icon: Shield, href: '/dashboard/insurance' },
                { label: 'PartSentry', icon: FileText, href: '/dashboard/partsentry' },
                { label: 'Gutu AI Assistant', icon: MessageSquare, href: '/dashboard/ai' },
              ].map((action) => (
                <Link
                  key={action.label}
                  to={action.href}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  <action.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 font-semibold">{action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Notifications</CardTitle>
                <Badge className="bg-orange-100 text-orange-700 text-[10px]">{recentNotifications.filter(n => !n.read).length} new</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentNotifications.map((n) => (
                <div key={n.id} className={`p-3 rounded-lg ${n.read ? 'bg-gray-50' : 'bg-orange-50 border border-orange-100 text-xs'}`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.type === 'warning' ? 'bg-amber-500' : n.type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <div>
                      <p className="font-semibold text-gray-800">{n.title}</p>
                      <p className="text-gray-500 mt-0.5">{n.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
