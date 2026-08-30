import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Car, FileText, Gauge, MessageSquare, Plus, Shield, Tag, Wallet, WifiOff, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { WorkspaceHeader } from '@/components/dashboard/WorkspaceHeader'
import MarketplacePulse from '@/components/intelligence/MarketplacePulse'
import NextBestActions from '@/components/intelligence/NextBestActions'
import PeriodicReport from '@/components/intelligence/PeriodicReport'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { readOwnerTrustClaim, statedMileage, statedPrice } from './ownerStatedValues'
import type { Escrow, Notification, Vehicle } from '@/types'

function sellerAction(vehicle: Vehicle) {
  const status = String(vehicle.status || '').toLowerCase()
  const publication = String(vehicle.publication_status || '').toLowerCase()
  if (status === 'sold') return { label: 'Open Passport', href: `/dashboard/garage/${encodeURIComponent(vehicle.vin)}` }
  if (publication === 'published') return { label: 'Manage listing', href: '/dashboard/listings' }
  if (publication === 'draft' || publication === 'publishable') return { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
  return { label: 'Sell this vehicle', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
}

export default function OwnerDashboard() {
  const { fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications } = useCarUpApi()
  const { user } = useAuth()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
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
      .then(data => { if (mounted) { setVehicles(Array.isArray(data) ? data : []); setVehiclesState('ready') } })
      .catch(() => { if (mounted) { setVehicles([]); setVehiclesState('unavailable') } })
    fetchNotifications()
      .then(data => { if (mounted) { setNotifications(Array.isArray(data) ? data : []); setNotificationsState('ready') } })
      .catch(() => { if (mounted) { setNotifications([]); setNotificationsState('unavailable') } })
    fetchSafePayEscrows()
      .then(rows => {
        if (!mounted) return
        const list = rows || []
        const totalUsd = list.reduce((sum: number, item: Escrow) => item.currency === 'USD' ? sum + item.amount : sum, 0)
        setEscrow({ status: 'ready', usd: totalUsd, count: list.length })
      })
      .catch(() => { if (mounted) setEscrow({ status: 'error', usd: 0, count: 0 }) })
    return () => { mounted = false }
  }, [fetchNotifications, fetchOwnedVehicles, fetchSafePayEscrows])

  const unreadNotifications = notificationsState === 'ready' ? notifications.filter(item => !item.read).length : null
  const activeListings = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => vehicle.publication_status === 'published' && String(vehicle.status || '').toLowerCase() !== 'sold').length
    : null
  const draftsNeedingAction = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => ['draft', 'publishable'].includes(String(vehicle.publication_status || '').toLowerCase())).length
    : null
  const trustPending = vehiclesState === 'ready'
    ? vehicles.filter(vehicle => readOwnerTrustClaim(vehicle).state !== 'evaluated').length
    : null

  const attention = useMemo(() => {
    const items: Array<{ key: string; title: string; detail: string; href: string; cta: string }> = []
    if (vehiclesState === 'unavailable') {
      items.push({ key: 'garage-read', title: 'My Garage could not be read', detail: 'This is a data-read failure, not an empty Garage.', href: '/dashboard/garage', cta: 'Retry Garage' })
    } else if (vehiclesState === 'ready' && vehicles.length === 0) {
      items.push({ key: 'first-vehicle', title: 'Start with your first vehicle', detail: 'Create or reuse a Vehicle Passport before building the listing.', href: '/sell', cta: 'Add or find vehicle' })
    }
    if ((draftsNeedingAction || 0) > 0) {
      items.push({ key: 'drafts', title: `${draftsNeedingAction} ${draftsNeedingAction === 1 ? 'listing needs' : 'listings need'} a next step`, detail: 'Continue the Seller Studio or review publication readiness.', href: '/dashboard/listings', cta: 'Open listings' })
    }
    if ((unreadNotifications || 0) > 0) {
      items.push({ key: 'unread', title: `${unreadNotifications} unread ${unreadNotifications === 1 ? 'notification' : 'notifications'}`, detail: 'Review buyer, vehicle or workflow activity.', href: '/dashboard/communications', cta: 'Open communications' })
    }
    return items
  }, [draftsNeedingAction, unreadNotifications, vehicles, vehiclesState])

  return (
    <div className="mx-auto max-w-[1440px] space-y-10" data-testid="owner-dashboard">
      <WorkspaceHeader
        eyebrow="Owner + Seller cockpit"
        title={user?.name ? `Welcome back, ${user.name}.` : 'Your CarUp cockpit.'}
        subtitle="See what needs attention, continue a Seller journey and read measured buyer activity without turning missing data into zero."
        breadcrumbs={[{ label: 'Owner Dashboard' }]}
        action={(
          <div className="flex flex-wrap gap-2">
            <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
              <Link to="/sell"><Tag className="mr-2 h-4 w-4" /> Sell a vehicle</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11 rounded-none">
              <Link to="/dashboard/garage"><Car className="mr-2 h-4 w-4" /> My Garage</Link>
            </Button>
          </div>
        )}
      />

      <section aria-labelledby="attention-title" className="border-y border-slate-200 py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Priority first</p>
            <h2 id="attention-title" className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950">What needs your attention</h2>
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-slate-600">
            <WifiOff className={`h-4 w-4 ${lowBandwidth ? 'text-orange-500' : 'text-slate-400'}`} />
            Low-bandwidth images
            <input
              type="checkbox"
              checked={lowBandwidth}
              onChange={() => {
                setLowBandwidth(current => !current)
                toast.success(lowBandwidth ? 'Vehicle images restored.' : 'Low-bandwidth mode enabled. Vehicle images are hidden.')
              }}
              className="h-4 w-4"
            />
          </label>
        </div>

        {attention.length === 0 ? (
          <p className="mt-5 border-l-2 border-emerald-500 pl-4 text-sm font-semibold text-slate-600" data-testid="owner-attention-none">
            No action is currently surfaced from the checks that successfully ran.
          </p>
        ) : (
          <div className="mt-5 divide-y divide-slate-200" data-testid="owner-needs-attention">
            {attention.map(item => (
              <div key={item.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="text-base font-black text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                </div>
                <Button asChild variant="outline" className="min-h-11 rounded-none">
                  <Link to={item.href}>{item.cta}<ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Owner operational summary" className="grid gap-px overflow-hidden border-y border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Vehicles', vehiclesState === 'ready' ? String(vehicles.length) : 'Not read', vehiclesState === 'unavailable' ? 'Garage unavailable' : 'Vehicle identities in your scope'],
          ['Published listings', activeListings === null ? 'Not read' : String(activeListings), 'Active public Seller inventory'],
          ['Drafts', draftsNeedingAction === null ? 'Not read' : String(draftsNeedingAction), 'Draft / ready-to-publish listings'],
          ['Trust awaiting evidence', trustPending === null ? 'Not read' : String(trustPending), 'Not a Trust score — vehicles without completed evaluation'],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-5 py-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className={`mt-2 font-black tracking-[-0.04em] text-slate-950 ${/^[0-9]+$/.test(value) ? 'text-3xl' : 'text-lg'}`}>{value}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="vehicles-title">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Vehicles + listings</p>
            <h2 id="vehicles-title" className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950">Continue from the car, not from a menu.</h2>
          </div>
          <Link to="/dashboard/garage" className="inline-flex min-h-11 items-center gap-2 border-b-2 border-slate-950 text-sm font-black hover:border-orange-500 hover:text-orange-700">
            Open My Garage <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {vehiclesState === 'loading' && <p className="py-10 text-sm text-slate-500">Reading your vehicles…</p>}
        {vehiclesState === 'unavailable' && <p className="py-10 text-sm text-amber-700">Vehicle scope could not be read. This is not an empty Garage.</p>}

        {vehiclesState === 'ready' && vehicles.slice(0, 3).map(vehicle => {
          const trust = readOwnerTrustClaim(vehicle)
          const action = sellerAction(vehicle)
          return (
            <article key={vehicle.vin} className="grid gap-5 border-b border-slate-200 py-6 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center">
              {!lowBandwidth ? (
                <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`} className="block h-36 overflow-hidden bg-slate-100">
                  <ListingImage
                    src={primaryListingImageUrl(vehicle.listing_media)}
                    alt={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                    className="h-full w-full"
                  />
                </Link>
              ) : (
                <div className="flex h-36 items-center justify-center bg-slate-100 text-xs font-semibold text-slate-400">Image hidden in low-bandwidth mode</div>
              )}
              <div>
                <p className="font-mono text-[11px] text-slate-400">{vehicle.vin}</p>
                <h3 className="mt-1 text-2xl font-black tracking-[-0.035em] text-slate-950">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}</h3>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" />{statedMileage(vehicle.mileage)}</span>
                  <span>{statedPrice(vehicle.price)}</span>
                  <span className="capitalize">Listing: {vehicle.publication_status || 'not recorded'}</span>
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-600" data-testid={`trust-claim-${vehicle.vin}`}>
                  Canonical Trust: {trust.score !== null ? `${trust.score}/100 · ${trust.headline}` : trust.headline}
                </p>
              </div>
              <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
                <Link to={action.href}>{action.label}<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </article>
          )
        })}

        {vehiclesState === 'ready' && vehicles.length === 0 && (
          <div className="grid gap-5 border-b border-slate-200 py-10 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h3 className="text-xl font-black text-slate-950">No vehicle identity in your Garage yet.</h3>
              <p className="mt-2 text-sm text-slate-600">Find a known Passport or create a new vehicle identity before listing.</p>
            </div>
            <Button asChild className="rounded-none bg-orange-500 font-black text-white hover:bg-orange-600"><Link to="/sell"><Plus className="mr-2 h-4 w-4" /> Add or find vehicle</Link></Button>
          </div>
        )}
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]" aria-label="Buyer activity and next actions">
        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Buyer activity</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950">Measured Marketplace activity</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Unavailable measurement stays unavailable; it never becomes a flat zero line.</p>
          </div>
          <MarketplacePulse />
          <PeriodicReport period="monthly" />
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Next action</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950">Evidence-backed suggestions</h2>
          </div>
          <NextBestActions />
        </div>
      </section>

      <section className="grid gap-6 border-y border-slate-200 py-8 lg:grid-cols-3" aria-label="Ownership operations">
        <div>
          <Wallet className="h-5 w-5 text-orange-500" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">SafePay escrow</p>
          {escrow.status === 'ready' ? (
            <>
              <p className="mt-1 text-2xl font-black text-slate-950" data-testid="escrow-usd-value">${escrow.usd.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">{escrow.count} active purchase {escrow.count === 1 ? 'escrow' : 'escrows'} · USD only in this aggregate</p>
            </>
          ) : (
            <p className="mt-1 text-sm font-black text-slate-600" data-testid="escrow-usd-value">{escrow.status === 'loading' ? 'Loading…' : 'Not available'}</p>
          )}
        </div>
        <div>
          <Shield className="h-5 w-5 text-orange-500" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Evidence + protection</p>
          <div className="mt-2 flex flex-col gap-2 text-sm font-bold">
            <Link to="/dashboard/evidence" className="inline-flex items-center gap-2 hover:text-orange-700"><FileText className="h-4 w-4" /> Evidence Vault</Link>
            <Link to="/dashboard/insurance" className="inline-flex items-center gap-2 hover:text-orange-700"><Shield className="h-4 w-4" /> Insurance</Link>
            <Link to="/dashboard/partsentry" className="inline-flex items-center gap-2 hover:text-orange-700"><Wrench className="h-4 w-4" /> PartSentry</Link>
          </div>
        </div>
        <div>
          <MessageSquare className="h-5 w-5 text-orange-500" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Communications</p>
          {notificationsState === 'ready' ? (
            <p className="mt-1 text-sm font-black text-slate-950">{unreadNotifications} unread notification{unreadNotifications === 1 ? '' : 's'}</p>
          ) : (
            <p className="mt-1 text-sm font-black text-slate-600">Notifications not read</p>
          )}
          <Button asChild variant="outline" className="mt-3 min-h-11 rounded-none">
            <Link to="/dashboard/communications">Open Communications</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
