import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Heart, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'

export default function SavedCars() {
  const { fetchSavedMarketplaceListings, unsaveMarketplaceListing } = useCarUpApi()
  const [savedVehicles, setSavedVehicles] = useState<MarketplaceListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [fetchSavedMarketplaceListings])

  const remove = useCallback(async (vin: string) => {
    await unsaveMarketplaceListing(vin)
    setSavedVehicles(previous => previous.filter(vehicle => vehicle.vin !== vin))
  }, [unsaveMarketplaceListing])

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
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
