// @ts-nocheck
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Heart, X, Gauge, Settings2, Fuel, MapPin } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export default function SavedCars() {
  const { fetchSavedVehicles, unsaveVehicle } = useCarUpApi()
  const [savedVehicles, setSavedVehicles] = useState<any[]>([])

  useEffect(() => {
    fetchSavedVehicles().then(setSavedVehicles)
  }, [fetchSavedVehicles])

  const remove = useCallback(async (vin: string) => {
    await unsaveVehicle(vin)
    setSavedVehicles(prev => prev.filter(v => v.vin !== vin))
  }, [unsaveVehicle])

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

      {savedVehicles.length === 0 ? (
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
                  <img src={vehicle.image_url || 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80'} alt={`${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover" />
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
                      <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission}</span>
                      <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{vehicle.fuel_type}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" />Harare, ZW
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