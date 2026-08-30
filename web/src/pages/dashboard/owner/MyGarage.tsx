import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  FileCheck2,
  Gauge,
  Plus,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { SellerWorkspaceHeader } from '@/components/seller/SellerWorkspaceHeader'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { readOwnerTrustClaim, statedDate, statedMileage, statedPrice, statedCount } from './ownerStatedValues'
import type { Vehicle } from '@/types'

function publicationLabel(value: unknown) {
  switch (String(value || '').toLowerCase()) {
    case 'published': return 'Published on Marketplace'
    case 'publishable': return 'Ready to publish'
    case 'review_pending': return 'Review pending'
    case 'documents_submitted': return 'Documents submitted'
    case 'identity_complete': return 'Identity complete'
    case 'draft': return 'Draft'
    default: return 'Publication state not recorded'
  }
}

function relationshipLabel(vehicle: Vehicle, userId?: string | null) {
  const row = vehicle as Vehicle & { owner_id?: string | null; current_seller_id?: string | null }
  if (userId && row.owner_id === userId && row.current_seller_id === userId) return 'Owner · current Seller'
  if (userId && row.owner_id === userId) return 'Owned by this account'
  if (userId && row.current_seller_id === userId) return 'Current Seller authority'
  return 'Vehicle in your governed Garage scope'
}

function contextualAction(vehicle: Vehicle) {
  const row = vehicle as Vehicle & { current_seller_id?: string | null }
  const publication = String(vehicle.publication_status || '').toLowerCase()
  const hasSellerThread = Boolean(
    row.current_seller_id
    || vehicle.seller_description
    || (Array.isArray(vehicle.seller_features) && vehicle.seller_features.length)
    || publication !== 'draft',
  )

  if (publication === 'published') {
    return { label: 'Manage listing', href: '/dashboard/listings', testId: `garage-manage-${vehicle.vin}` }
  }
  if (hasSellerThread) {
    return {
      label: 'Continue listing',
      href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`,
      testId: `garage-continue-${vehicle.vin}`,
    }
  }
  return {
    label: 'Sell this vehicle',
    href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`,
    testId: `garage-sell-${vehicle.vin}`,
  }
}

export default function MyGarage() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const { user } = useAuth()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehiclesState, setVehiclesState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    setVehiclesState('loading')
    fetchOwnedVehicles()
      .then(rows => {
        if (!active) return
        setVehicles(Array.isArray(rows) ? rows : [])
        setVehiclesState('ready')
      })
      .catch(() => {
        if (!active) return
        setVehicles([])
        setVehiclesState('error')
      })
    return () => { active = false }
  }, [fetchOwnedVehicles])

  return (
    <div className="mx-auto max-w-[1440px] space-y-9">
      <SellerWorkspaceHeader
        eyebrow="Vehicle workspace"
        title="My Garage"
        description="One durable place for the vehicles in your CarUp ownership and Seller lifecycle — Passport, evidence, listing and service context stay attached to the same VIN."
        statusLabel={vehiclesState === 'loading'
          ? 'Loading owned vehicles'
          : vehiclesState === 'error'
            ? 'Garage read unavailable'
            : vehicles.length === 1
              ? '1 governed vehicle workspace'
              : `${vehicles.length} governed vehicle workspaces`}
        primaryAction={(
          <Button className="min-h-11 rounded-none bg-orange-600 font-black hover:bg-orange-700" data-testid="create-vehicle-button" asChild>
            <Link to="/sell"><Plus className="mr-2 h-4 w-4" /> Add or sell a vehicle</Link>
          </Button>
        )}
      />

      {vehiclesState === 'loading' && (
        <div className="border-y border-slate-200 py-14 text-sm text-slate-500" role="status">
          Loading your Garage…
        </div>
      )}

      {vehiclesState === 'error' && (
        <div className="border-y border-amber-200 bg-amber-50 px-5 py-9" role="alert">
          <p className="font-black text-slate-950">Your Garage could not be read.</p>
          <p className="mt-1 text-sm text-slate-600">CarUp has not converted that failure into an empty Garage.</p>
        </div>
      )}

      {vehiclesState === 'ready' && vehicles.length === 0 && (
        <section className="grid gap-8 border-y border-slate-200 py-12 lg:grid-cols-[1fr_0.7fr] lg:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">Start the vehicle thread</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-4xl">
              No vehicle is recorded in this Garage yet.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Identify an existing Vehicle Passport or add a vehicle new to CarUp. Nothing is published simply by entering the Garage.
            </p>
          </div>
          <Button asChild className="min-h-12 rounded-none bg-orange-600 font-black hover:bg-orange-700">
            <Link to="/sell">Choose a vehicle path <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </section>
      )}

      {vehiclesState === 'ready' && vehicles.length > 0 && (
        <section className="divide-y divide-slate-200 border-y border-slate-200" data-testid="owner-vehicles-table">
          {vehicles.map((vehicle, index) => {
            const trust = readOwnerTrustClaim(vehicle)
            const addedOn = statedDate(vehicle.created_at)
            const action = contextualAction(vehicle)
            const media = primaryListingImageUrl(vehicle.listing_media)
            const publication = publicationLabel(vehicle.publication_status)
            const relation = relationshipLabel(vehicle, user?.id)

            return (
              <article
                key={vehicle.vin}
                className="grid gap-0 py-8 lg:grid-cols-[minmax(310px,0.82fr)_minmax(0,1.18fr)] lg:gap-10"
                data-testid={`vehicle-row-${vehicle.vin}`}
              >
                <div className="relative min-h-[250px] overflow-hidden bg-slate-100 sm:min-h-[320px]">
                  <ListingImage
                    src={media}
                    alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle listing media'}
                    className="absolute inset-0 h-full w-full"
                    imgClassName="h-full w-full"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent px-5 pb-5 pt-14 text-white">
                    <p className="font-mono text-[11px] tracking-wide">{vehicle.vin}</p>
                    <p className="mt-1 text-xs text-slate-200">
                      {media ? 'Seller listing media' : 'No seller listing photo recorded'}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col py-6 lg:py-2">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        Vehicle {String(index + 1).padStart(2, '0')} · Vehicle Passport
                      </p>
                      <h2 className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950 sm:text-4xl">
                        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle identity incomplete'}
                      </h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {vehicle.color || 'Colour not recorded'} · {statedMileage(vehicle.mileage)}
                      </p>
                    </div>
                    <div className="border-l-2 border-orange-500 pl-4 text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-400">Recorded asking price</p>
                      <p className="mt-1 text-xl font-black text-slate-950" data-testid={`vehicle-price-${vehicle.vin}`}>
                        {statedPrice(vehicle.price)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-7 grid gap-px bg-slate-200 sm:grid-cols-3">
                    <div className="bg-white px-4 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Relationship</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">{relation}</p>
                    </div>
                    <div className="bg-white px-4 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Commerce lifecycle</p>
                      <p className="mt-2 text-sm font-bold text-slate-800" data-testid={`vehicle-status-${vehicle.vin}`}>
                        {publication}
                      </p>
                    </div>
                    <div className="bg-white px-4 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Garage record</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">{addedOn ? `Added ${addedOn}` : 'Date added not recorded'}</p>
                    </div>
                  </div>

                  <div className="mt-7 grid gap-6 xl:grid-cols-[1fr_1fr]">
                    <div data-testid={`trust-claim-${vehicle.vin}`}>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Canonical Trust</p>
                          <p className="mt-2 text-sm font-bold text-slate-800">
                            {trust.score !== null ? `${trust.score} / 100 · ${trust.headline}` : trust.headline}
                          </p>
                        </div>
                        {trust.score !== null && (
                          <span className="font-mono text-xs text-slate-500" data-testid={`trust-claim-score-${vehicle.vin}`}>
                            evaluated
                          </span>
                        )}
                      </div>
                      {trust.score !== null ? (
                        <Progress value={trust.score} className="mt-3 h-1.5" />
                      ) : (
                        <p className="mt-2 text-xs leading-5 text-slate-500" data-testid={`trust-claim-state-${vehicle.vin}`}>
                          No decorative score substitutes for an unavailable canonical assessment.
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Governed supporting state</p>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <FileCheck2 className="h-3.5 w-3.5 text-orange-600" />
                          {statedCount(vehicle.counts?.verified_documents, 'verified document')}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Wrench className="h-3.5 w-3.5" />
                          {statedCount(vehicle.counts?.services, 'service')}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {statedCount(vehicle.counts?.active_insurance, 'active policy', 'active policies')}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Gauge className="h-3.5 w-3.5" />
                          {statedCount(vehicle.counts?.parts, 'part tracked', 'parts tracked')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}
                      className="inline-flex min-h-11 items-center text-sm font-bold text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    >
                      View Vehicle Passport <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                    <Button asChild className="min-h-11 rounded-none bg-slate-950 px-6 font-black hover:bg-orange-600">
                      <Link to={action.href} data-testid={action.testId}>
                        {action.label} <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {vehiclesState === 'ready' && vehicles.length > 0 && (
        <Link
          to="/sell"
          className="flex min-h-24 items-center justify-between border border-dashed border-slate-300 px-5 text-sm font-bold text-slate-500 transition hover:border-orange-500 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          data-testid="create-vehicle-card"
        >
          <span><Plus className="mr-2 inline h-4 w-4" /> Add or sell another vehicle</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}
