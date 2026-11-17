import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CarFront, FileSearch, LogIn, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'
import { skin } from '@/lib/unifiedSkin'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { SellStart } from './SellStart'
import { vehicleListingState } from '@/lib/vehicleListingState'

/** `vin_first` (RX04-D): start with the VIN and let the Passport check classify the car. */
export type SellerEntryIntent = 'resume_draft' | 'garage_vehicle' | 'known_vehicle' | 'new_vehicle' | 'vin_first'

function vehicleAction(vehicle: Vehicle) {
  const status = String(vehicle.status || '').toLowerCase()
  const publication = String(vehicle.publication_status || '').toLowerCase()
  if (status === 'sold') return { label: 'View sale history', href: `/dashboard/garage/${encodeURIComponent(vehicle.vin)}` }
  if (publication === 'published') return { label: 'Manage listing', href: '/dashboard/listings' }
  if (publication === 'draft' || publication === 'publishable') {
    return { label: publication === 'publishable' ? 'Review & publish' : 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
  }
  return { label: 'Sell this vehicle', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(vehicle.vin)}` }
}

function IntentCard({
  title,
  copy,
  icon: Icon,
  onClick,
  href,
  testId,
}: {
  title: string
  copy: string
  icon: typeof CarFront
  onClick?: () => void
  href?: string
  testId: string
}) {
  const body = (
    <>
      <span className={skin('flex h-11 w-11 items-center justify-center bg-orange-50 text-orange-600', 'flex h-11 w-11 items-center justify-center bg-carup-action-soft text-carup-action')}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className={skin('mt-6 block text-xl font-black tracking-[-0.025em] text-slate-950', 'mt-6 block text-xl font-bold tracking-[-0.025em] text-carup-text')}>{title}</span>
      <span className={skin('mt-2 block max-w-sm text-sm leading-6 text-slate-500', 'mt-2 block max-w-sm text-sm leading-6 text-carup-text-2')}>{copy}</span>
      <span className={skin('mt-7 inline-flex items-center gap-2 text-xs font-black text-slate-950', 'mt-7 inline-flex items-center gap-2 text-xs font-bold text-carup-text')}>
        Continue <ArrowRight className="h-4 w-4" />
      </span>
    </>
  )

  const classes = 'group min-h-[245px] border border-slate-200 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-[0_24px_60px_rgba(15,23,42,0.12)]'

  if (href) {
    return <Link to={href} className={classes} data-testid={testId}>{body}</Link>
  }
  return <button type="button" onClick={onClick} className={classes} data-testid={testId}>{body}</button>
}

export function SellIntentRouter({
  hasLocalDraft,
  onResolve,
}: {
  hasLocalDraft: boolean
  onResolve: (intent: SellerEntryIntent) => void
}) {
  const { isAuthenticated } = useAuth()
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading')

  // A signed-out visitor has no Garage to read. DERIVED from the auth context rather than copied
  // into state by an effect: mirroring a fact `useAuth` already holds gives it two sources of
  // truth, and writing it synchronously in the effect body is a cascading render. The visible
  // behaviour is unchanged — signed out reads 'idle', signed in reads 'loading' until the fetch
  // settles, and a FAILED read still reports 'error' rather than "you have no vehicles".
  const garageState: 'idle' | 'loading' | 'ready' | 'error' = isAuthenticated ? fetchState : 'idle'
  const garageVehicles = isAuthenticated ? vehicles : []

  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    fetchOwnedVehicles()
      .then(rows => {
        if (!active) return
        setVehicles(rows)
        setFetchState('ready')
      })
      .catch(() => {
        if (active) setFetchState('error')
      })
    return () => { active = false }
  }, [fetchOwnedVehicles, isAuthenticated])

  if (isUnifiedUiEnabled()) {
    return (
      <SellStart
        isAuthenticated={isAuthenticated}
        garageState={garageState}
        garageVehicles={garageVehicles}
        hasLocalDraft={hasLocalDraft}
        onResolve={onResolve}
        vehicleAction={vehicle => vehicleListingState(vehicle).action}
      />
    )
  }

  return (
    <div className={skin('min-h-screen bg-[#f6f7f9] text-slate-950', 'text-carup-text')} data-testid="sell-intent-router">
      <section className={skin('relative overflow-hidden bg-[#07111f] text-white', 'relative')}>
        <div className={skin('absolute inset-0 opacity-90 [background-image:radial-gradient(circle_at_78%_18%,rgba(249,115,22,0.22),transparent_25%),linear-gradient(120deg,transparent_0%,transparent_62%,rgba(255,255,255,0.04)_62%,rgba(255,255,255,0.04)_63%,transparent_63%)]', 'absolute inset-0 opacity-90')} />
        <div className={skin('section-padding relative mx-auto max-w-[1440px] py-14 sm:py-20', 'relative pb-2 pt-1')}>
          <p className={skin('text-[10px] font-black uppercase tracking-[0.22em] text-orange-400', 'text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-2')}>Sell with the vehicle thread intact</p>
          <h1 className={skin('mt-4 max-w-4xl text-5xl font-black leading-[0.9] tracking-[-0.055em] sm:text-6xl', 'mt-3 max-w-4xl text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-tight tracking-[-0.03em]')}>
            Which vehicle are you selling?
          </h1>
          <p className={skin('mt-6 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base', 'mt-3 max-w-2xl text-sm leading-6 text-carup-text-2 sm:text-base')}>
            Reuse a vehicle CarUp already knows whenever possible. A vehicle new to CarUp is different from a seller saying the vehicle condition is “New”.
          </p>
        </div>
      </section>

      <main className={skin('section-padding mx-auto max-w-[1440px] py-10 sm:py-14', 'py-6 sm:py-8')}>
        {hasLocalDraft && (
          <button
            type="button"
            onClick={() => onResolve('resume_draft')}
            className={skin('mb-10 flex w-full flex-col justify-between gap-4 border-l-4 border-orange-500 bg-white px-6 py-5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center', 'mb-10 flex w-full flex-col justify-between gap-4 border-l-4 border-carup-action bg-carup-bg-raised px-6 py-5 text-left sm:flex-row sm:items-center')}
            data-testid="sell-intent-resume-draft"
          >
            <span>
              <span className={skin('text-[10px] font-black uppercase tracking-[0.18em] text-orange-600', 'text-[10px] font-bold uppercase tracking-[0.18em] text-carup-action')}>Draft found in this browser</span>
              <span className={skin('mt-1 block text-lg font-black text-slate-950', 'mt-1 block text-lg font-bold text-carup-text')}>Continue where you left off</span>
              <span className={skin('mt-1 block text-sm text-slate-500', 'mt-1 block text-sm text-carup-text-2')}>Your saved Seller draft remains separate from publication until you explicitly publish it.</span>
            </span>
            <span className={skin('inline-flex shrink-0 items-center gap-2 text-sm font-black text-slate-950', 'inline-flex shrink-0 items-center gap-2 text-sm font-bold text-carup-text')}>Resume draft <RotateCcw className="h-4 w-4" /></span>
          </button>
        )}

        {isAuthenticated && (
          <section className="mb-12" data-testid="sell-intent-garage">
            <div className={skin('flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between', 'flex flex-col gap-3 border-b border-carup-line pb-5 sm:flex-row sm:items-end sm:justify-between')}>
              <div>
                <p className={skin('text-[10px] font-black uppercase tracking-[0.2em] text-orange-600', 'text-[10px] font-bold uppercase tracking-[0.2em] text-carup-action')}>Your vehicles</p>
                <h2 className={skin('mt-2 text-3xl font-black tracking-[-0.04em]', 'mt-2 text-3xl font-bold tracking-[-0.04em]')}>Start with My Garage.</h2>
              </div>
              <Link to="/dashboard/garage" className={skin('text-sm font-black text-slate-700 hover:text-orange-700', 'text-sm font-bold text-carup-text-2 hover:text-carup-action-hover')}>Open My Garage</Link>
            </div>

            {garageState === 'loading' && <p className={skin('py-8 text-sm text-slate-500', 'py-8 text-sm text-carup-text-2')}>Reading your eligible vehicles…</p>}
            {garageState === 'error' && (
              <div className={skin('my-6 border-y border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-900', 'my-6 border-y border-status-warning bg-status-warning-soft px-5 py-5 text-sm text-carup-text')}>
                CarUp could not read your Garage right now. This is not treated as “you have no vehicles”; you can still identify another known vehicle below.
              </div>
            )}
            {garageState === 'ready' && garageVehicles.length === 0 && (
              <p className={skin('py-8 text-sm text-slate-500', 'py-8 text-sm text-carup-text-2')}>No Garage vehicle is recorded for this account yet.</p>
            )}

            {garageVehicles.length > 0 && (
              <div className={skin('divide-y divide-slate-200', 'divide-y divide-carup-line')}>
                {garageVehicles.map(vehicle => {
                  const action = vehicleAction(vehicle)
                  return (
                    <article key={vehicle.vin} className="grid gap-5 py-5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center" data-testid={`sell-garage-vehicle-${vehicle.vin}`}>
                      <div className={skin('aspect-[16/10] overflow-hidden bg-slate-100', 'aspect-[16/10] overflow-hidden bg-carup-bg-surface-2')}>
                        <ListingImage
                          src={primaryListingImageUrl(vehicle.listing_media)}
                          alt={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                          className="h-full w-full"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className={skin('font-mono text-[10px] text-slate-400', 'font-mono text-[10px] text-carup-text-3')}>{vehicle.vin}</p>
                        <h3 className={skin('mt-1 text-xl font-black tracking-[-0.03em]', 'mt-1 text-xl font-bold tracking-[-0.03em]')}>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}</h3>
                        <p className={skin('mt-2 text-xs font-semibold text-slate-500', 'mt-2 text-xs font-semibold text-carup-text-2')}>
                          Passport vehicle · {vehicle.publication_status ? `listing ${String(vehicle.publication_status).replace(/_/g, ' ')}` : 'no listing state recorded'}
                        </p>
                      </div>
                      <Button asChild className={skin('rounded-none bg-orange-600 font-black hover:bg-orange-700', 'rounded-none bg-carup-action font-bold hover:bg-carup-action-hover')}>
                        <Link to={action.href}>{action.label} <ArrowRight className="ml-2 h-4 w-4" /></Link>
                      </Button>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="mb-6">
            <p className={skin('text-[10px] font-black uppercase tracking-[0.2em] text-orange-600', 'text-[10px] font-bold uppercase tracking-[0.2em] text-carup-action')}>{isAuthenticated ? 'Another vehicle' : 'Choose a path'}</p>
            <h2 className={skin('mt-2 text-3xl font-black tracking-[-0.04em]', 'mt-2 text-3xl font-bold tracking-[-0.04em]')}>{isAuthenticated ? 'Find or add the right identity.' : 'Start without losing the vehicle context.'}</h2>
          </div>

          <div className={`grid gap-5 ${isAuthenticated ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
            <IntentCard
              icon={FileSearch}
              title="CarUp already knows this vehicle"
              copy="Identify it by VIN or another approved identifier, reuse the Vehicle Passport, then prove your authority to sell it."
              onClick={() => onResolve('known_vehicle')}
              testId="sell-intent-known"
            />
            <IntentCard
              icon={Plus}
              title="Add a vehicle CarUp does not know yet"
              copy="Create the vehicle identity and Seller listing together. This describes identity history, not whether the car is commercially new or used."
              onClick={() => onResolve('new_vehicle')}
              testId="sell-intent-new"
            />
            {!isAuthenticated && (
              <IntentCard
                icon={LogIn}
                title="Sign in to continue existing work"
                copy="Return to a vehicle, Garage record or server-side Seller draft already attached to your account."
                href="/login?returnTo=%2Fsell"
                testId="sell-intent-sign-in"
              />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
