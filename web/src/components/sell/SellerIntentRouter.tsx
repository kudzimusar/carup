import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CarFront, FileSearch, LogIn, Plus, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'

function sellerLifecycle(vehicle: Vehicle) {
  const status = String(vehicle.status || '').toLowerCase()
  const publication = String(vehicle.publication_status || '').toLowerCase()
  if (status === 'sold') return { label: 'View sale history', href: '/dashboard/listings' }
  if (publication === 'published') return { label: 'Manage listing', href: `/dashboard/listings?vin=${encodeURIComponent(vehicle.vin)}` }
  if (publication === 'publishable') return { label: 'Review & publish', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
  if (publication === 'draft') return { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
  return { label: 'Sell this vehicle', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
}

export function SellerIntentRouter({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehicleState, setVehicleState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!isAuthenticated) {
      setVehicles([])
      setVehicleState('idle')
      return
    }
    let active = true
    setVehicleState('loading')
    fetchOwnedVehicles()
      .then(rows => {
        if (!active) return
        setVehicles(rows || [])
        setVehicleState('ready')
      })
      .catch(() => {
        if (active) setVehicleState('error')
      })
    return () => { active = false }
  }, [fetchOwnedVehicles, isAuthenticated])

  const activeVehicles = useMemo(
    () => vehicles.filter(vehicle => String(vehicle.status || '').toLowerCase() !== 'sold'),
    [vehicles],
  )

  const choosePublicIntent = (intent: 'known' | 'new') => {
    if (isAuthenticated) {
      navigate(`/dashboard/sell-vehicle?mode=${intent}`)
      return
    }
    navigate(`/sell?intent=${intent}`)
  }

  return (
    <section
      className={compact ? 'space-y-6' : 'min-h-[calc(100vh-4rem)] bg-[#07111f] px-4 py-10 text-white sm:px-6 lg:px-10'}
      data-testid="seller-intent-router"
      aria-labelledby="seller-intent-title"
    >
      <div className={compact ? '' : 'mx-auto max-w-[1200px]'}>
        <div className={compact ? 'border-b border-slate-200 pb-6' : 'border-b border-white/10 pb-8'}>
          <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${compact ? 'text-orange-600' : 'text-orange-300'}`}>
            Sell with the vehicle thread intact
          </p>
          <h1 id="seller-intent-title" className={`mt-3 max-w-4xl font-black leading-[0.95] tracking-[-0.055em] ${compact ? 'text-4xl text-slate-950 sm:text-5xl' : 'text-4xl text-white sm:text-6xl'}`}>
            Which vehicle are you selling?
          </h1>
          <p className={`mt-4 max-w-2xl text-sm leading-6 sm:text-base ${compact ? 'text-slate-600' : 'text-slate-300'}`}>
            Reuse a Vehicle Passport when CarUp already knows the car. Create a new identity only when it is genuinely new to CarUp.
          </p>
        </div>

        {isAuthenticated && (
          <div className="mt-8" data-testid="seller-intent-owned-vehicles">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className={`text-xs font-black uppercase tracking-[0.18em] ${compact ? 'text-slate-500' : 'text-slate-400'}`}>Your vehicles</p>
                <p className={`mt-1 text-sm ${compact ? 'text-slate-600' : 'text-slate-300'}`}>Continue an existing Seller journey without typing the VIN again.</p>
              </div>
              {vehicleState === 'loading' && <span className="text-xs text-slate-400">Loading your Garage…</span>}
              {vehicleState === 'error' && <span className="text-xs text-amber-500">CarUp could not read your Garage right now.</span>}
            </div>

            {vehicleState === 'ready' && activeVehicles.length > 0 && (
              <div className={`mt-5 divide-y ${compact ? 'divide-slate-200 border-y border-slate-200' : 'divide-white/10 border-y border-white/10'}`}>
                {activeVehicles.map(vehicle => {
                  const lifecycle = sellerLifecycle(vehicle)
                  return (
                    <article key={vehicle.vin} className="grid gap-4 py-5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center" data-testid={`seller-intent-vehicle-${vehicle.vin}`}>
                      <div className="h-24 overflow-hidden bg-slate-100">
                        <ListingImage
                          src={primaryListingImageUrl(vehicle.listing_media)}
                          alt={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                          className="h-full w-full"
                        />
                      </div>
                      <div>
                        <h2 className={`text-xl font-black ${compact ? 'text-slate-950' : 'text-white'}`}>
                          {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                        </h2>
                        <p className={`mt-1 font-mono text-xs ${compact ? 'text-slate-500' : 'text-slate-400'}`}>{vehicle.vin}</p>
                        <p className={`mt-2 text-xs font-semibold ${compact ? 'text-slate-600' : 'text-slate-300'}`}>
                          {vehicle.publication_status ? `Listing: ${vehicle.publication_status}` : 'No listing state recorded yet'}
                        </p>
                      </div>
                      <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
                        <Link to={lifecycle.href}>{lifecycle.label}<ArrowRight className="ml-2 h-4 w-4" /></Link>
                      </Button>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => choosePublicIntent('known')}
            className={`group min-h-[220px] border p-6 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${compact ? 'border-slate-200 bg-white hover:border-orange-400' : 'border-white/15 bg-white/[0.04] hover:border-orange-400/70 hover:bg-white/[0.07]'}`}
            data-testid="seller-intent-known"
          >
            <FileSearch className="h-8 w-8 text-orange-500" aria-hidden="true" />
            <p className={`mt-8 text-xs font-black uppercase tracking-[0.16em] ${compact ? 'text-slate-500' : 'text-slate-400'}`}>CarUp already knows it</p>
            <h2 className={`mt-2 text-2xl font-black tracking-[-0.035em] ${compact ? 'text-slate-950' : 'text-white'}`}>Find another known vehicle</h2>
            <p className={`mt-3 text-sm leading-6 ${compact ? 'text-slate-600' : 'text-slate-300'}`}>Use VIN or an approved identifier, then claim Seller authority against the existing Passport.</p>
          </button>

          <button
            type="button"
            onClick={() => choosePublicIntent('new')}
            className={`group min-h-[220px] border p-6 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${compact ? 'border-slate-200 bg-white hover:border-orange-400' : 'border-white/15 bg-white/[0.04] hover:border-orange-400/70 hover:bg-white/[0.07]'}`}
            data-testid="seller-intent-new"
          >
            <Plus className="h-8 w-8 text-orange-500" aria-hidden="true" />
            <p className={`mt-8 text-xs font-black uppercase tracking-[0.16em] ${compact ? 'text-slate-500' : 'text-slate-400'}`}>New to CarUp</p>
            <h2 className={`mt-2 text-2xl font-black tracking-[-0.035em] ${compact ? 'text-slate-950' : 'text-white'}`}>Add a vehicle CarUp does not know yet</h2>
            <p className={`mt-3 text-sm leading-6 ${compact ? 'text-slate-600' : 'text-slate-300'}`}>Create one durable identity, then build the Seller listing around it.</p>
          </button>

          {!isAuthenticated ? (
            <Link
              to="/login?returnTo=%2Fsell"
              className="group min-h-[220px] border border-white/15 bg-white/[0.04] p-6 text-left transition hover:border-orange-400/70 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              data-testid="seller-intent-resume"
            >
              <LogIn className="h-8 w-8 text-orange-500" aria-hidden="true" />
              <p className="mt-8 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Already started</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.035em] text-white">Sign in to resume</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">Return to your Garage, saved Seller draft and publication state.</p>
            </Link>
          ) : (
            <Link
              to="/dashboard/garage"
              className={`group min-h-[220px] border p-6 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${compact ? 'border-slate-200 bg-white hover:border-orange-400' : 'border-white/15 bg-white/[0.04] hover:border-orange-400/70 hover:bg-white/[0.07]'}`}
              data-testid="seller-intent-garage"
            >
              <ShieldCheck className="h-8 w-8 text-orange-500" aria-hidden="true" />
              <p className={`mt-8 text-xs font-black uppercase tracking-[0.16em] ${compact ? 'text-slate-500' : 'text-slate-400'}`}>Durable ownership</p>
              <h2 className={`mt-2 text-2xl font-black tracking-[-0.035em] ${compact ? 'text-slate-950' : 'text-white'}`}>Open My Garage</h2>
              <p className={`mt-3 text-sm leading-6 ${compact ? 'text-slate-600' : 'text-slate-300'}`}>Review the vehicle Passport and current listing state before selling.</p>
            </Link>
          )}
        </div>

        <div className={`mt-8 flex items-start gap-3 border-l-2 border-orange-500 pl-4 text-sm ${compact ? 'text-slate-600' : 'text-slate-300'}`}>
          <CarFront className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />
          <p><strong className={compact ? 'text-slate-950' : 'text-white'}>One vehicle identity.</strong> Commercial condition such as “new” or “used” is a Seller statement and is never used to decide whether the vehicle identity itself is new to CarUp.</p>
        </div>
      </div>
    </section>
  )
}
