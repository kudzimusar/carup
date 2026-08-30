import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileCheck2, FileText, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { statedCount } from './ownerStatedValues'
import type { Vehicle } from '@/types'

export default function EvidenceVault() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetchOwnedVehicles()
      .then(rows => {
        if (!active) return
        setVehicles(rows)
        setState('ready')
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => { active = false }
  }, [fetchOwnedVehicles])

  return (
    <div className="mx-auto max-w-[1440px] space-y-8" data-testid="owner-evidence-vault">
      <header className="border-b border-slate-200 pb-7">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Seller / Owner home
        </Link>
        <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">Evidence & provenance</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">Evidence Vault</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Upload and review evidence against the correct Vehicle Passport. Listing photography stays separate from governed evidence.
            </p>
          </div>
          <div className="max-w-md border-l-2 border-orange-500 bg-orange-50 px-4 py-3 text-xs leading-5 text-slate-700">
            Evidence can be pending, verified, rejected, private or public-safe. A file is never treated as verified simply because it was uploaded.
          </div>
        </div>
      </header>

      {state === 'loading' && (
        <div className="border-y border-slate-200 py-12 text-sm text-slate-500" role="status">
          Loading your vehicle evidence workspaces…
        </div>
      )}

      {state === 'error' && (
        <div className="border-y border-amber-200 bg-amber-50 px-5 py-8" role="alert">
          <p className="font-bold text-slate-950">Evidence workspaces could not be read.</p>
          <p className="mt-1 text-sm text-slate-600">CarUp has not converted that failure into zero documents.</p>
        </div>
      )}

      {state === 'ready' && vehicles.length === 0 && (
        <div className="border-y border-dashed border-slate-300 py-14 text-center">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-xl font-black text-slate-950">No vehicle workspace yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">Add or identify a vehicle first so evidence can be attached to the correct Passport.</p>
          <Button asChild className="mt-5 rounded-none bg-orange-600 hover:bg-orange-700">
            <Link to="/sell">Add or find a vehicle</Link>
          </Button>
        </div>
      )}

      {state === 'ready' && vehicles.length > 0 && (
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {vehicles.map(vehicle => (
            <article
              key={vehicle.vin}
              className="grid gap-5 py-6 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center"
              data-testid={`evidence-vehicle-${vehicle.vin}`}
            >
              <div className="aspect-[16/10] overflow-hidden bg-slate-100">
                <ListingImage
                  src={primaryListingImageUrl(vehicle.listing_media)}
                  alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
                  className="h-full w-full"
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Vehicle Passport</p>
                  <span className="h-1 w-1 bg-orange-500" />
                  <p className="truncate font-mono text-[11px] text-slate-500">{vehicle.vin}</p>
                </div>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.035em] text-slate-950">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                </h2>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <FileCheck2 className="h-4 w-4 text-orange-600" />
                    {statedCount(vehicle.counts?.verified_documents, 'verified document')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-slate-500" />
                    Verification state lives in the Passport
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
                <Button asChild className="rounded-none bg-orange-600 font-black hover:bg-orange-700">
                  <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}?upload=1`}>
                    <Upload className="mr-2 h-4 w-4" /> Upload evidence
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-none font-bold">
                  <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}>
                    Open Passport <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
