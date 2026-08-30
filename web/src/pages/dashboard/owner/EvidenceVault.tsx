import { useEffect, useState } from 'react'
import { FileText, ShieldCheck, Upload, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { WorkspaceHeader } from '@/components/dashboard/WorkspaceHeader'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'

function evidenceCount(vehicle: Vehicle & Record<string, any>): number | null {
  const candidates = [
    vehicle?.counts?.evidence,
    vehicle?.counts?.evidence_count,
    vehicle?.evidence_count,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export default function EvidenceVault() {
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
    <div className="mx-auto max-w-[1440px] space-y-8" data-testid="evidence-vault-page">
      <WorkspaceHeader
        eyebrow="Evidence Vault"
        title="Evidence belongs to the vehicle."
        subtitle="Open one vehicle to upload or review governed documents and media. Listing photos stay separate from evidence."
        breadcrumbs={[
          { label: 'Seller home', href: '/dashboard' },
          { label: 'Evidence Vault' },
        ]}
        action={(
          <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
            <Link to="/dashboard/garage">Choose from My Garage</Link>
          </Button>
        )}
      />

      {state === 'loading' && (
        <div className="border-y border-slate-200 py-12 text-sm font-semibold text-slate-500" role="status">
          Loading the vehicles in your evidence scope…
        </div>
      )}

      {state === 'error' && (
        <div className="border-l-4 border-amber-500 bg-amber-50 p-5 text-sm text-amber-950" role="alert">
          CarUp could not read your vehicle scope. This is not a statement that you have no evidence.
        </div>
      )}

      {state === 'ready' && vehicles.length === 0 && (
        <div className="border-y border-slate-200 py-14">
          <p className="text-lg font-black text-slate-950">No vehicle is available in your Evidence Vault yet.</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Add or identify a vehicle first. Evidence is always attached to a durable Vehicle Passport rather than stored as a loose file.
          </p>
          <Button asChild className="mt-5 rounded-none bg-slate-950 text-white hover:bg-orange-600">
            <Link to="/sell">Add or find a vehicle</Link>
          </Button>
        </div>
      )}

      {vehicles.length > 0 && (
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {vehicles.map(vehicle => {
            const count = evidenceCount(vehicle as Vehicle & Record<string, any>)
            return (
              <article key={vehicle.vin} className="grid gap-5 py-6 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center" data-testid={`evidence-vehicle-${vehicle.vin}`}>
                <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}?tab=evidence`} className="block h-36 overflow-hidden bg-slate-100">
                  <ListingImage
                    src={primaryListingImageUrl(vehicle.listing_media)}
                    alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
                    className="h-full w-full"
                  />
                </Link>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-5 w-5 text-orange-500" aria-hidden="true" />
                    <h2 className="text-2xl font-black tracking-[-0.035em] text-slate-950">
                      {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                    </h2>
                  </div>
                  <p className="mt-2 font-mono text-xs text-slate-500">{vehicle.vin}</p>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      Vehicle Passport linked
                    </span>
                    <span>
                      {count === null
                        ? 'Evidence count not read'
                        : `${count} evidence ${count === 1 ? 'record' : 'records'}`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 md:flex-col">
                  <Button asChild className="min-h-11 rounded-none bg-orange-500 font-black text-white hover:bg-orange-600">
                    <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}?tab=evidence&upload=1`}>
                      <Upload className="mr-2 h-4 w-4" /> Upload evidence
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="min-h-11 rounded-none">
                    <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}?tab=evidence`}>
                      Open evidence <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
