import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Heart, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ShowroomListingCard } from '@/components/showroom/ShowroomListingCard'
import { listingToShowroomCardModel } from '@/lib/showroomCardModel'
import { DataState } from '@/components/truth'
import { OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'
import { ArrowRight, GitCompare, Search } from 'lucide-react'

export default function SavedCars() {
  const { fetchSavedMarketplaceListings, unsaveMarketplaceListing } = useCarUpApi()
  const [savedVehicles, setSavedVehicles] = useState<MarketplaceListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // RX04-C (unified view only): retry without a page reload, an honest failed-remove notice, and a
  // shortlist → Compare selection (navigation only; the same ?vins= link the Marketplace uses).
  const [attempt, setAttempt] = useState(0)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    fetchSavedMarketplaceListings()
      .then(response => {
        if (active) setSavedVehicles(response.listings || [])
      })
      .catch(() => {
        if (active) setError('Could not load saved cars. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [fetchSavedMarketplaceListings, attempt])

  const remove = useCallback(async (vin: string) => {
    await unsaveMarketplaceListing(vin)
    setSavedVehicles(previous => previous.filter(vehicle => vehicle.vin !== vin))
  }, [unsaveMarketplaceListing])

  if (isUnifiedUiEnabled()) {
    const MAX_COMPARE = 4
    const toggle = (vin: string) => setSelected(prev => prev.includes(vin) ? prev.filter(v => v !== vin) : prev.length >= MAX_COMPARE ? prev : [...prev, vin])
    const removeUnified = async (vin: string, name: string) => {
      setRemoveError(null)
      try {
        await unsaveMarketplaceListing(vin)
        setSavedVehicles(previous => previous.filter(vehicle => vehicle.vin !== vin))
        setSelected(prev => prev.filter(v => v !== vin))
      } catch {
        setRemoveError(`${name} could not be removed from your saved cars. It is still saved — please try again.`)
      }
    }
    const count = savedVehicles.length
    return (
      <div className="mx-auto w-full max-w-[1320px] space-y-6" data-testid="saved-cars-page" data-presentation="rx04">
        <OwnerPageHeader
          title="Saved cars"
          description="The cars you saved in the Marketplace, with their current price and CarUp Trust. Pick two to four to compare them."
          meta={!loading && !error ? (count === 1 ? '1 saved car' : `${count} saved cars`) : undefined}
          actions={<Link to="/marketplace" className={OWNER_SECONDARY_ACTION}><Search className="h-4 w-4" aria-hidden="true" /> Find more cars</Link>}
        />
        {removeError && <div role="alert" className="rounded-xl bg-status-warning-soft px-4 py-3 text-[14px] text-carup-text">{removeError}</div>}
        {loading ? (
          <DataState state="loading" subject="Saved cars" />
        ) : error ? (
          <DataState state="error" subject="Saved cars" description="Your saved cars could not be loaded. Nothing has been removed." action={{ label: 'Try again', onClick: () => setAttempt(n => n + 1) }} />
        ) : count === 0 ? (
          <section className="rounded-3xl bg-carup-bg-surface px-6 py-12 text-center sm:px-10" data-testid="saved-cars-empty">
            <Heart className="mx-auto h-10 w-10 text-carup-text-3" aria-hidden="true" />
            <h2 className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-carup-text">No saved cars yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-6 text-carup-text-2">Tap the heart on any car in the Marketplace and it appears here, ready to compare.</p>
            <Link to="/marketplace" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Browse the Marketplace <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
            {savedVehicles.map(vehicle => {
              const model = listingToShowroomCardModel(vehicle)
              const isSelected = selected.includes(vehicle.vin)
              return (
                <div key={vehicle.vin} className="min-w-0">
                  <ShowroomListingCard
                    vehicle={model}
                    href={`/marketplace/${encodeURIComponent(vehicle.vin)}`}
                    isFavorite
                    isCompared={isSelected}
                    onFavorite={event => { event.preventDefault(); event.stopPropagation(); void removeUnified(vehicle.vin, model.name) }}
                    onCompare={event => { event.preventDefault(); event.stopPropagation(); toggle(vehicle.vin) }}
                    dataTestId="saved-marketplace-vehicle"
                    ctaLabel="Open vehicle & Passport"
                    priceTestId={`saved-price-${vehicle.vin}`}
                    mileageTestId={`saved-mileage-${vehicle.vin}`}
                    locationTestId={`saved-location-${vehicle.vin}`}
                    showMissingMileage
                  />
                </div>
              )
            })}
          </div>
        )}
        {selected.length > 0 && (
          <div className="sticky bottom-[4.25rem] z-20 mx-auto max-w-xl rounded-2xl border border-carup-line bg-carup-bg-raised px-4 py-3 shadow-sheet lg:bottom-4" data-testid="saved-compare-bar">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] text-carup-text-2"><b className="text-carup-text">{selected.length}</b> of {MAX_COMPARE} selected{selected.length < 2 ? ' — pick one more to compare' : ''}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected([])} className={`min-h-11 rounded-full px-3 text-[14px] font-semibold text-carup-text-2 hover:text-carup-text ${OWNER_FOCUS}`}>Clear</button>
                {selected.length >= 2 ? (
                  <Link to={`/marketplace/compare?vins=${selected.map(encodeURIComponent).join(',')}`} className={OWNER_PRIMARY_ACTION} data-testid="saved-compare-open">
                    <GitCompare className="h-4 w-4" aria-hidden="true" /> Compare
                  </Link>
                ) : (
                  <span className={`${OWNER_PRIMARY_ACTION} pointer-events-none opacity-50`} aria-disabled="true"><GitCompare className="h-4 w-4" aria-hidden="true" /> Compare</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8" data-testid="saved-cars-page">
      <section className="relative overflow-hidden bg-[#08111f] px-5 py-7 text-white sm:px-7">
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_88%_15%,rgba(249,115,22,0.18),transparent_30%)]" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">Your shortlist</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Saved cars.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Re-open the same vehicle stories you saved in Marketplace. Price, published facts and
              canonical Trust remain in the same visual language here.
            </p>
          </div>
          <Button asChild className="h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
            <Link to="/marketplace">Find more vehicles</Link>
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-56 items-center justify-center gap-3 border-y border-slate-200 bg-white text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          <span className="text-sm">Loading your saved Marketplace vehicles…</span>
        </div>
      ) : error ? (
        <div className="border-y border-slate-200 bg-white px-6 py-14 text-center">
          <Heart className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-xl font-black">Saved cars are unavailable.</h2>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <Button variant="outline" className="mt-5 rounded-none" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      ) : savedVehicles.length === 0 ? (
        <div className="border-y border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <Heart className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-xl font-black">Your shortlist is empty.</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            Save vehicles from Marketplace and they will reappear here with the same current vehicle-story layout.
          </p>
          <Button asChild className="mt-5 rounded-none bg-orange-500 font-black text-white hover:bg-orange-600">
            <Link to="/marketplace">Browse Marketplace</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between border-b border-slate-200 pb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Saved Marketplace inventory</p>
              <p className="mt-1 text-sm text-slate-500">{savedVehicles.length} {savedVehicles.length === 1 ? 'vehicle' : 'vehicles'} in your shortlist</p>
            </div>
          </div>

          <div className="grid gap-x-7 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
            {savedVehicles.map(vehicle => (
              <MarketplaceListingCard
                key={vehicle.vin}
                vehicle={marketplaceListingToCardModel(vehicle)}
                href={`/marketplace/${encodeURIComponent(vehicle.vin)}`}
                isFavorite
                onFavorite={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  void remove(vehicle.vin)
                }}
                dataTestId="saved-marketplace-vehicle"
                ctaLabel="Re-open vehicle & Passport"
                priceTestId={`saved-price-${vehicle.vin}`}
                mileageTestId={`saved-mileage-${vehicle.vin}`}
                locationTestId={`saved-location-${vehicle.vin}`}
                showMissingMileage
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
