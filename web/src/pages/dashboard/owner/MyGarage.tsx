import { useEffect, useState } from 'react'
import { ArrowRight, FileText, Gauge, Plus, ShieldCheck, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { WorkspaceHeader } from '@/components/dashboard/WorkspaceHeader'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { readOwnerTrustClaim, statedCount, statedMileage, statedPrice } from './ownerStatedValues'
import type { Vehicle } from '@/types'

function lifecycleAction(vehicle: Vehicle) {
  const status = String(vehicle.status || '').toLowerCase()
  const publication = String(vehicle.publication_status || '').toLowerCase()
  if (status === 'sold') {
    return { label: 'View sale history', href: '/dashboard/listings', tone: 'secondary' as const }
  }
  if (publication === 'published') {
    return { label: 'Manage listing', href: `/dashboard/listings?vin=${encodeURIComponent(vehicle.vin)}`, tone: 'primary' as const }
  }
  if (publication === 'draft' || publication === 'publishable') {
    return { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`, tone: 'primary' as const }
  }
  return { label: 'Sell this vehicle', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}`, tone: 'primary' as const }
}

function publicationLabel(vehicle: Vehicle) {
  const value = String(vehicle.publication_status || '').trim()
  return value ? value.replace(/_/g, ' ') : 'No listing state recorded'
}

export default function MyGarage() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetchOwnedVehicles()
      .then(rows => {
        if (!active) return
        setVehicles(rows || [])
        setState('ready')
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => { active = false }
  }, [fetchOwnedVehicles])

  return (
    <div className="mx-auto max-w-[1440px] space-y-8" data-testid="owner-garage-page">
      <WorkspaceHeader
        eyebrow="My Garage"
        title="Your durable vehicle identities."
        subtitle="Vehicle Passport, listing state, evidence and ownership stay attached to the same car before, during and after a sale."
        breadcrumbs={[
          { label: 'Seller home', href: '/dashboard' },
          { label: 'My Garage' },
        ]}
        action={(
          <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600" data-testid="create-vehicle-button">
            <Link to="/sell"><Plus className="mr-2 h-4 w-4" /> Add or find vehicle</Link>
          </Button>
        )}
      />

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Vehicle scope</p>
          <p className="mt-1 text-3xl font-black tracking-[-0.04em] text-slate-950">
            {state === 'ready' ? vehicles.length : '—'}
            <span className="ml-2 text-base font-semibold tracking-normal text-slate-500">
              {state === 'ready' ? (vehicles.length === 1 ? 'vehicle' : 'vehicles') : 'reading Garage'}
            </span>
          </p>
        </div>
        <Link to="/dashboard/evidence" className="inline-flex min-h-11 items-center gap-2 border-b-2 border-slate-950 text-sm font-black text-slate-950 hover:border-orange-500 hover:text-orange-700">
          Open Evidence Vault <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {state === 'loading' && (
        <div className="border-y border-slate-200 py-12 text-sm font-semibold text-slate-500" role="status">
          Reading your vehicle scope…
        </div>
      )}

      {state === 'error' && (
        <div className="border-l-4 border-amber-500 bg-amber-50 p-5 text-sm text-amber-950" role="alert">
          CarUp could not read My Garage. This is not a statement that you have no vehicles.
        </div>
      )}

      {state === 'ready' && vehicles.length === 0 && (
        <section className="grid gap-6 border-y border-slate-200 py-12 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950">Your first vehicle starts one CarUp thread.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Find a vehicle CarUp already knows or create a new Vehicle Passport. A listing is a commercial state on that vehicle, not a disposable duplicate record.
            </p>
          </div>
          <Button asChild className="min-h-12 rounded-none bg-slate-950 px-6 font-black text-white hover:bg-orange-600">
            <Link to="/sell">Add or find vehicle</Link>
          </Button>
        </section>
      )}

      {vehicles.length > 0 && (
        <div className="divide-y divide-slate-200 border-y border-slate-200" data-testid="owner-vehicles-table">
          {vehicles.map(vehicle => {
            const trust = readOwnerTrustClaim(vehicle)
            const action = lifecycleAction(vehicle)
            return (
              <article
                key={vehicle.vin}
                className="grid gap-6 py-7 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] lg:items-stretch"
                data-testid={`vehicle-row-${vehicle.vin}`}
              >
                <Link
                  to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}
                  className="group relative block min-h-[240px] overflow-hidden bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  aria-label={`Open Vehicle Passport for ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`}
                >
                  <ListingImage
                    src={primaryListingImageUrl(vehicle.listing_media)}
                    alt={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                    className="absolute inset-0 h-full w-full"
                    imgClassName="transition duration-500 group-hover:scale-[1.025]"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-16 text-white">
                    <p className="font-mono text-[11px] text-white/75">{vehicle.vin}</p>
                    <p className="mt-1 text-2xl font-black tracking-[-0.04em]">
                      {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                    </p>
                  </div>
                </Link>

                <div className="flex min-w-0 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Vehicle + listing state</p>
                      <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">
                        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">{vehicle.color || 'Colour not recorded'} · {statedMileage(vehicle.mileage)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Asking price</p>
                      <p className="mt-1 text-2xl font-black text-slate-950" data-testid={`vehicle-price-${vehicle.vin}`}>{statedPrice(vehicle.price)}</p>
                    </div>
                  </div>

                  <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
                    <div className="bg-white py-4 pr-4" data-testid={`vehicle-status-${vehicle.vin}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Lifecycle</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{vehicle.status || 'Status not recorded'}</p>
                      <p className="mt-1 text-xs text-slate-500 capitalize">{publicationLabel(vehicle)}</p>
                    </div>
                    <div className="bg-white p-4" data-testid={`trust-claim-${vehicle.vin}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Canonical Trust</p>
                      {trust.score !== null ? (
                        <>
                          <p className="mt-1 text-sm font-black text-slate-900" data-testid={`trust-claim-score-${vehicle.vin}`}>{trust.score}/100 · {trust.headline}</p>
                          <p className="mt-1 text-xs text-slate-500">Open Passport for evidence basis and confidence.</p>
                        </>
                      ) : (
                        <p className="mt-1 text-sm font-black text-slate-600" data-testid={`trust-claim-state-${vehicle.vin}`}>{trust.headline}</p>
                      )}
                    </div>
                    <div className="bg-white py-4 pl-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Evidence</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{statedCount(vehicle.counts?.verified_documents, 'verified document')}</p>
                      <p className="mt-1 text-xs text-slate-500">Governed evidence only.</p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><Wrench className="h-4 w-4" />{statedCount(vehicle.counts?.services, 'service')}</span>
                    <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" />{statedCount(vehicle.counts?.active_insurance, 'active policy', 'active policies')}</span>
                    <span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" />{statedCount(vehicle.counts?.parts, 'part tracked', 'parts tracked')}</span>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-slate-950 pt-5">
                    <Button asChild className={`min-h-11 rounded-none px-5 font-black ${action.tone === 'primary' ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-slate-950 text-white hover:bg-slate-800'}`}>
                      <Link to={action.href} data-testid={`garage-primary-action-${vehicle.vin}`}>{action.label}<ArrowRight className="ml-2 h-4 w-4" /></Link>
                    </Button>
                    <Button asChild variant="outline" className="min-h-11 rounded-none">
                      <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}><FileText className="mr-2 h-4 w-4" /> View Vehicle Passport</Link>
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
