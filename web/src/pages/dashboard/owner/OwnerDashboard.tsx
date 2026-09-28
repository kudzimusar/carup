import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRight,
  BarChart3,
  Bell,
  Car,
  FileCheck2,
  FileText,
  Gauge,
  MessageSquare,
  Plus,
  Shield,
  Upload,
  WifiOff,
  Wrench,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ListingImage } from '@/components/marketplace/ListingImage'
import MarketplacePulse from '@/components/intelligence/MarketplacePulse'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { Escrow, Notification, Vehicle } from '@/types'
import { readOwnerTrustClaim, statedMileage } from './ownerStatedValues'

function isSold(vehicle: Vehicle) {
  return String(vehicle.status || '').toLowerCase() === 'sold'
}

function isPublished(vehicle: Vehicle) {
  return String(vehicle.publication_status || '').toLowerCase() === 'published'
}

function hasSellerThread(vehicle: Vehicle, userId?: string | null) {
  const row = vehicle as Vehicle & { current_seller_id?: string | null }
  return Boolean(
    (userId && row.current_seller_id === userId)
    || vehicle.seller_description
    || (Array.isArray(vehicle.seller_features) && vehicle.seller_features.length > 0),
  )
}

export default function OwnerDashboard() {
  const { fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications } = useCarUpApi()
  const { user } = useAuth()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [liveNotifications, setLiveNotifications] = useState<Notification[]>([])
  const [vehiclesState, setVehiclesState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [notificationsState, setNotificationsState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [lowBandwidth, setLowBandwidth] = useState(false)
  const [escrow, setEscrow] = useState<{ status: 'loading' | 'ready' | 'error'; usd: number; count: number }>({
    status: 'loading',
    usd: 0,
    count: 0,
  })

  useEffect(() => {
    let mounted = true
    fetchOwnedVehicles()
      .then(data => {
        if (!mounted) return
        setVehicles(Array.isArray(data) ? data : [])
        setVehiclesState('ready')
      })
      .catch(() => {
        if (!mounted) return
        setVehicles([])
        setVehiclesState('unavailable')
      })

    fetchNotifications()
      .then(data => {
        if (!mounted) return
        setLiveNotifications(Array.isArray(data) ? data : [])
        setNotificationsState('ready')
      })
      .catch(() => {
        if (!mounted) return
        setLiveNotifications([])
        setNotificationsState('unavailable')
      })

    return () => { mounted = false }
  }, [fetchNotifications, fetchOwnedVehicles])

  useEffect(() => {
    let mounted = true
    fetchSafePayEscrows()
      .then((rows) => {
        if (!mounted) return
        const list = Array.isArray(rows) ? rows : []
        const usd = list.reduce((sum: number, item: Escrow) =>
          item.currency === 'USD' ? sum + item.amount : sum, 0)
        setEscrow({ status: 'ready', usd, count: list.length })
      })
      .catch((error) => {
        console.error('Failed to load escrows', error)
        if (mounted) setEscrow({ status: 'error', usd: 0, count: 0 })
      })
    return () => { mounted = false }
  }, [fetchSafePayEscrows])

  const draftSellerVehicle = useMemo(() => vehicles.find(vehicle =>
    !isSold(vehicle)
    && !isPublished(vehicle)
    && hasSellerThread(vehicle, user?.id),
  ) || null, [user?.id, vehicles])

  const unreadNotifications = notificationsState === 'ready'
    ? liveNotifications.filter(item => !item.read).length
    : null
  const awaitingTrust = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => readOwnerTrustClaim(vehicle).state !== 'evaluated').length
    : null
  const publishedCount = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => isPublished(vehicle) && !isSold(vehicle)).length
    : null
  const activeDraftCount = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => !isPublished(vehicle) && !isSold(vehicle) && hasSellerThread(vehicle, user?.id)).length
    : null
  const recentNotifications = liveNotifications.slice(0, 3)

  const attentionItems = useMemo(() => {
    const items: Array<{ key: string; label: string; detail: string; to: string; cta: string }> = []
    if (vehiclesState === 'unavailable') {
      items.push({
        key: 'garage-unavailable',
        label: 'Your Garage could not be loaded',
        detail: 'This is a read failure, not an empty Garage.',
        to: '/dashboard/garage',
        cta: 'Open Garage',
      })
      return items
    }
    if (vehiclesState !== 'ready') return items

    if (draftSellerVehicle) {
      items.push({
        key: 'continue-listing',
        label: `Continue ${[draftSellerVehicle.year, draftSellerVehicle.make, draftSellerVehicle.model].filter(Boolean).join(' ') || draftSellerVehicle.vin}`,
        detail: 'A private Seller draft is already attached to this Vehicle Passport.',
        to: `/dashboard/sell-vehicle?vin=${encodeURIComponent(draftSellerVehicle.vin)}`,
        cta: 'Continue listing',
      })
    } else if (vehicles.length === 0) {
      items.push({
        key: 'no-vehicles',
        label: 'Start your first vehicle thread',
        detail: 'Identify an existing Passport or add a vehicle new to CarUp.',
        to: '/sell',
        cta: 'Choose vehicle',
      })
    }

    if ((awaitingTrust || 0) > 0) {
      items.push({
        key: 'trust',
        label: `${awaitingTrust} ${awaitingTrust === 1 ? 'vehicle needs' : 'vehicles need'} Trust/evidence attention`,
        detail: 'Canonical Trust is not complete for these vehicle records.',
        to: '/dashboard/evidence',
        cta: 'Review evidence',
      })
    }

    if ((unreadNotifications || 0) > 0) {
      items.push({
        key: 'messages',
        label: `${unreadNotifications} unread ${unreadNotifications === 1 ? 'notification' : 'notifications'}`,
        detail: 'Review activity that may need an owner or Seller response.',
        to: '/dashboard/communications',
        cta: 'Open communications',
      })
    }
    return items
  }, [awaitingTrust, draftSellerVehicle, unreadNotifications, vehicles.length, vehiclesState])

  return (
    <div className="mx-auto max-w-[1440px] space-y-10" data-testid="owner-dashboard-cockpit">
      <header className="border-b border-slate-200 pb-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">Ownership &amp; Seller cockpit</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">Owner Dashboard</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Welcome back{user?.name ? `, ${user.name}` : ''}! Start with what needs attention, then move through vehicles, buyer activity, evidence, operating records, communications and measured Seller intelligence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 items-center gap-2 border border-slate-200 px-3 text-xs font-bold text-slate-600">
              <WifiOff className={`h-4 w-4 ${lowBandwidth ? 'text-orange-600' : 'text-slate-400'}`} />
              Low-bandwidth
              <input
                type="checkbox"
                checked={lowBandwidth}
                onChange={() => {
                  setLowBandwidth(value => !value)
                  toast.success(lowBandwidth ? 'Images restored.' : 'Low-bandwidth mode enabled. Images are not loaded.')
                }}
                className="h-4 w-4"
              />
            </label>
            <Button asChild className="min-h-11 rounded-none bg-orange-600 font-black hover:bg-orange-700">
              <Link to="/sell"><Plus className="mr-2 h-4 w-4" /> Sell / add vehicle</Link>
            </Button>
          </div>
        </div>
      </header>

      <section data-testid="owner-priority-attention">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 1</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">What needs attention</h2>
          </div>
        </div>
        {attentionItems.length ? (
          <div className="divide-y divide-slate-200 border-y border-slate-200" data-testid="owner-needs-attention">
            {attentionItems.map(item => (
              <div key={item.key} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black text-slate-950">{item.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                </div>
                <Button variant="outline" className="min-h-11 rounded-none font-bold" asChild>
                  <Link to={item.to}>{item.cta} <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              </div>
            ))}
          </div>
        ) : vehiclesState === 'loading' || notificationsState === 'loading' ? (
          <p className="border-y border-slate-200 py-6 text-sm text-slate-500" role="status">Checking current owner/Seller priorities…</p>
        ) : (
          <p className="border-y border-slate-200 py-6 text-sm text-slate-500">No governed attention item is currently recorded.</p>
        )}
      </section>

      <section data-testid="owner-priority-vehicles">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 2</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Vehicles &amp; listings</h2>
            <p className="mt-1 text-sm text-slate-500">
              {vehiclesState === 'ready'
                ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · ${publishedCount} published · ${activeDraftCount} active drafts`
                : vehiclesState === 'unavailable' ? 'Vehicle state unavailable' : 'Loading governed vehicle state'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-none" asChild><Link to="/dashboard/garage">My Garage</Link></Button>
            <Button variant="outline" className="rounded-none" asChild><Link to="/dashboard/listings">My Listings</Link></Button>
          </div>
        </div>

        {vehiclesState === 'ready' && vehicles.length > 0 ? (
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {vehicles.slice(0, 3).map(vehicle => {
              const trust = readOwnerTrustClaim(vehicle)
              const draft = !isPublished(vehicle) && !isSold(vehicle) && hasSellerThread(vehicle, user?.id)
              return (
                <article key={vehicle.vin} className="grid gap-5 py-6 sm:grid-cols-[180px_1fr_auto] sm:items-center">
                  {!lowBandwidth ? (
                    <ListingImage
                      src={primaryListingImageUrl(vehicle.listing_media)}
                      alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle media'}
                      className="h-32 overflow-hidden bg-slate-100"
                      imgClassName="h-full w-full"
                    />
                  ) : <div className="flex h-20 items-center justify-center bg-slate-100 text-xs text-slate-500">Image not loaded</div>}
                  <div className="min-w-0">
                    <h3 className="text-xl font-black tracking-[-0.03em] text-slate-950">
                      {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle identity incomplete'}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">{vehicle.vin}</p>
                    <p className="mt-2 text-xs text-slate-500"><Gauge className="mr-1 inline h-3.5 w-3.5" />{statedMileage(vehicle.mileage)}</p>
                    <div className="mt-3" data-testid={`trust-claim-${vehicle.vin}`}>
                      {trust.score !== null ? (
                        <>
                          <p className="text-xs font-bold text-slate-700">
                            Canonical Trust: <span data-testid={`trust-claim-score-${vehicle.vin}`}>{trust.score} / 100</span> · {trust.headline}
                          </p>
                          <Progress value={trust.score} className="mt-2 h-1.5" />
                        </>
                      ) : (
                        <p className="text-xs font-bold text-slate-500" data-testid={`trust-claim-state-${vehicle.vin}`}>
                          Canonical Trust: {trust.headline}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button asChild className="min-h-11 rounded-none bg-slate-950 font-black hover:bg-orange-600">
                    <Link to={draft ? `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` : `/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}>
                      {draft ? 'Continue listing' : 'Open Passport'} <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </article>
              )
            })}
          </div>
        ) : vehiclesState === 'ready' ? (
          <p className="border-y border-slate-200 py-8 text-sm text-slate-500">No vehicle is recorded in this Garage yet.</p>
        ) : vehiclesState === 'unavailable' ? (
          <p className="border-y border-amber-200 bg-amber-50 px-4 py-7 text-sm text-slate-700">Garage read unavailable — this is not an empty-Garage claim.</p>
        ) : (
          <p className="border-y border-slate-200 py-8 text-sm text-slate-500" role="status">Loading vehicles…</p>
        )}
      </section>

      <section className="grid gap-8 lg:grid-cols-2" data-testid="owner-priority-buyer-activity">
        <div className="border-y border-slate-200 py-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 3</p>
          <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Buyer activity</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Inquiries, listing lifecycle and performance stay attached to My Listings. No buyer count is invented when the Communications/Intelligence authorities are unread.</p>
          <Button variant="outline" className="mt-5 min-h-11 rounded-none font-bold" asChild>
            <Link to="/dashboard/listings">Open buyer activity <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>

        <div className="border-y border-slate-200 py-6" data-testid="owner-priority-trust">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 4</p>
          <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Trust &amp; evidence readiness</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {awaitingTrust === null
              ? 'Trust/evidence readiness is unavailable because the Garage read did not complete.'
              : awaitingTrust === 0
                ? 'Every loaded vehicle currently carries an evaluated canonical Trust state.'
                : `${awaitingTrust} loaded ${awaitingTrust === 1 ? 'vehicle has' : 'vehicles have'} no completed canonical Trust assessment.`}
          </p>
          <Button variant="outline" className="mt-5 min-h-11 rounded-none font-bold" asChild>
            <Link to="/dashboard/evidence">Open Evidence Vault <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      <section data-testid="owner-priority-operating-records">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 5</p>
        <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Service, insurance &amp; PartSentry</h2>
        <div className="mt-5 grid gap-px bg-slate-200 sm:grid-cols-3">
          {[
            ['Service history', 'Governed maintenance records', '/dashboard/service-history', Wrench],
            ['Insurance records', 'Recorded insurance/claim history', '/dashboard/insurance', Shield],
            ['PartSentry', 'Parts provenance and tracked components', '/dashboard/partsentry', FileText],
          ].map(([label, detail, href, Icon]) => (
            <Link key={String(label)} to={String(href)} className="group bg-white p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              <Icon className="h-5 w-5 text-orange-600" />
              <p className="mt-4 font-black text-slate-950">{String(label)}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{String(detail)}</p>
              <span className="mt-4 inline-flex items-center text-xs font-black text-slate-600 group-hover:text-orange-600">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-8 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="border-y border-slate-200 py-6" data-testid="owner-priority-communications">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 6</p>
          <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Communications</h2>
          {notificationsState === 'unavailable' ? (
            <p className="mt-4 text-sm text-slate-600">Notification state is unavailable, not zero.</p>
          ) : recentNotifications.length ? (
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {recentNotifications.map(item => (
                <div key={item.id} className="py-3">
                  <p className="text-sm font-black text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{notificationsState === 'loading' ? 'Loading communications activity…' : 'No notifications recorded.'}</p>
          )}
          <Button variant="outline" className="mt-5 min-h-11 rounded-none font-bold" asChild>
            <Link to="/dashboard/communications"><MessageSquare className="mr-2 h-4 w-4" /> Open Communications</Link>
          </Button>
        </div>

        <div className="border-y border-slate-200 py-6" data-testid="owner-priority-intelligence">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Priority 7</p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">Seller Intelligence</h2>
              <p className="mt-2 text-sm text-slate-500">Measured Marketplace activity only; unread signals remain unavailable rather than becoming decorative zeroes.</p>
            </div>
            <Button variant="outline" className="min-h-11 rounded-none font-bold" asChild>
              <Link to="/dashboard/intelligence"><BarChart3 className="mr-2 h-4 w-4" /> Open cockpit</Link>
            </Button>
          </div>
          <div className="mt-5"><MarketplacePulse /></div>
          <Link to="/dashboard/ai" className="mt-4 inline-flex min-h-11 items-center text-xs font-bold text-slate-500 hover:text-slate-900">
            Gutu AI vehicle assistant <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <details className="border-t border-slate-200 pt-5 text-sm" data-testid="owner-unavailable-capabilities">
        <summary className="cursor-pointer font-bold text-slate-600">Unavailable or not-yet-governed account capabilities</summary>
        <div className="mt-5 grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Automotive Wallet (USD)</p>
            <p data-testid="wallet-usd-value" className="mt-2 font-bold text-slate-500">Not available</p>
          </div>
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Automotive Wallet (ZiG)</p>
            <p data-testid="wallet-zig-value" className="mt-2 font-bold text-slate-500">Not available</p>
          </div>
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Account-wide Trust index</p>
            <p data-testid="trust-index-value" className="mt-2 font-bold text-slate-500">Not calculated</p>
            <p data-testid="trust-index-label" className="mt-1 text-xs text-slate-400">Verification pending</p>
          </div>
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Vehicle value trend</p>
            <p data-testid="value-trend-unavailable" className="mt-2 text-xs leading-5 text-slate-500">Valuation history is not available for your account yet.</p>
          </div>
        </div>

        <div className="mt-px grid gap-px bg-slate-200 sm:grid-cols-2">
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">SafePay escrow authority</p>
            <p data-testid="escrow-usd-value" className="mt-2 font-bold text-slate-700">
              {escrow.status === 'loading' ? 'Loading…' : escrow.status === 'error' ? 'Not available' : `$${escrow.usd.toLocaleString()}`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {escrow.status === 'ready' ? `${escrow.count} active purchase escrow${escrow.count === 1 ? '' : 's'}` : escrow.status === 'error' ? 'Could not load your escrows' : 'Checking your escrows'}
            </p>
          </div>
          <div className="bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Digital Document Vault</p>
            <p data-testid="document-vault-empty" className="mt-2 text-xs text-slate-500">No documents uploaded yet.</p>
            <p data-testid="document-vault-unavailable" className="mt-1 text-xs text-slate-400">Document upload is not available from this dashboard yet.</p>
            <Button size="sm" disabled data-testid="ocr-upload-btn" className="mt-3 rounded-none">
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload unavailable
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}
