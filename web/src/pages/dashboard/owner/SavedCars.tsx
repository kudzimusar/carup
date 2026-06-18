import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Heart, X, Gauge, Settings2, Fuel, MapPin, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
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
      .then((response) => {
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
    setSavedVehicles(prev => prev.filter(v => v.vin !== vin))
  }, [unsaveMarketplaceListing])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Saved Cars</h1>
          <p className="text-gray-500">Vehicles you've bookmarked for later</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/marketplace">Browse More</Link>
        </Button>
      </div>

      {loading ? (
        <Card className="border-0 card-shadow">
          <CardContent className="p-12 text-center">
            <Loader2 className="w-10 h-10 text-orange-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold mb-2">Loading saved cars</h3>
            <p className="text-gray-500">Checking your marketplace saved listings...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-0 card-shadow">
          <CardContent className="p-12 text-center">
            <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Saved Cars Unavailable</h3>
            <p className="text-gray-500 mb-4">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      ) : savedVehicles.length === 0 ? (
        <Card className="border-0 card-shadow">
          <CardContent className="p-12 text-center">
            <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Saved Vehicles</h3>
            <p className="text-gray-500 mb-4">Browse the marketplace and click the heart icon on any vehicle to save it here.</p>
            <Button className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link to="/marketplace">Browse Marketplace</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {savedVehicles.map((vehicle) => (
            <Card key={vehicle.vin} className="border-0 card-shadow hover-lift overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-[16/10] overflow-hidden">
                  {vehicle.primary_image_url ? (
                    <img src={vehicle.primary_image_url} alt={`${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
                      No image available
                    </div>
                  )}
                  <button
                    onClick={() => remove(vehicle.vin)}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center hover:bg-red-50 transition-colors"
                    title="Remove from saved"
                  >
                    <X className="w-4 h-4 text-red-500" />
                  </button>
                  {vehicle.trust_score > 80 && (
                    <Badge className="absolute top-3 left-3 bg-green-500 text-white text-[10px]">Verified</Badge>
                  )}
                </div>
                <div className="p-4">
                  <Link to={`/marketplace/${vehicle.vin}`}>
                    <h3 className="font-semibold text-sm hover:text-orange-500 transition-colors">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                    <p className="text-lg font-bold text-orange-600">${vehicle.price?.toLocaleString()}</p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{vehicle.mileage?.toLocaleString()} km</span>
                      {vehicle.transmission && <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission}</span>}
                      {vehicle.fuel_type && <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{vehicle.fuel_type}</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" />{vehicle.location || 'Zimbabwe'}
                    </div>
                  </Link>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-xs" asChild>
                      <Link to={`/marketplace/${vehicle.vin}`}>View Details</Link>
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => remove(vehicle.vin)}>Remove</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
