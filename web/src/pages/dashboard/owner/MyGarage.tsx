import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Plus, ArrowRight, Gauge, Calendar, FileText, Shield } from 'lucide-react'
import { useState, useEffect } from 'react'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { readOwnerTrustClaim, statedDate, statedMileage, statedPrice, statedCount } from './ownerStatedValues'
import type { Vehicle } from '@/types'

export default function MyGarage() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  useEffect(() => {
    fetchOwnedVehicles().then(setVehicles)
  }, [fetchOwnedVehicles])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Garage</h1>
          <p className="text-gray-500">Manage your vehicles and their digital identities</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" data-testid="create-vehicle-button">
          <Plus className="w-4 h-4" /> Add Vehicle
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6" data-testid="owner-vehicles-table">
        {vehicles.map((vehicle) => {
          const trust = readOwnerTrustClaim(vehicle)
          const addedOn = statedDate(vehicle.created_at)
          return (
          <Link key={vehicle.vin} to={`/dashboard/garage/${vehicle.vin}`} data-testid={`vehicle-row-${vehicle.vin}`}>
            <Card className="border-0 card-shadow hover-lift overflow-hidden">
              <CardContent className="p-0">
                <div className="relative h-44">
                  {/* Was an Unsplash stock car for every vehicle without a photo — a picture of a
                      different car is a claim about this one. */}
                  <ListingImage
                    src={primaryListingImageUrl(vehicle.listing_media)}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    className="w-full h-full"
                  />
                  <div className="absolute top-3 left-3">
                    <Badge className="bg-white/90 text-gray-900">{vehicle.vin}</Badge>
                  </div>
                  {/* 'Active' was invented whenever `status` was absent, and the green Shield made
                      that invention read as a CarUp assurance. An absent status says so, in grey. */}
                  <div className="absolute top-3 right-3">
                    {vehicle.status ? (
                      <Badge className="bg-green-500 text-white" data-testid={`vehicle-status-${vehicle.vin}`}>
                        <Shield className="w-3 h-3 mr-1" /> {vehicle.status}
                      </Badge>
                    ) : (
                      <Badge className="bg-gray-200 text-gray-600" data-testid={`vehicle-status-${vehicle.vin}`}>
                        Status not recorded
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <p className="text-sm text-gray-500">
                        {vehicle.color || 'Colour not recorded'} • {vehicle.vin?.slice(0, 8)}...
                      </p>
                    </div>
                    {/* `price` is the owner's asking price. Labelling it "Current Value" published a
                        valuation CarUp never produced. */}
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Asking Price</p>
                      <p className="font-bold text-orange-600" data-testid={`vehicle-price-${vehicle.vin}`}>
                        {statedPrice(vehicle.price)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                    <span className="flex items-center gap-1"><Gauge className="w-3.5 h-3.5" />{statedMileage(vehicle.mileage)}</span>
                    {/* `new Date('').toLocaleDateString()` printed the words "Invalid Date". */}
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{addedOn ? `Added ${addedOn}` : 'Date added not recorded'}</span>
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{statedCount(vehicle.counts?.verified_documents, 'verified document')}</span>
                  </div>

                  <div className="mb-4" data-testid={`trust-claim-${vehicle.vin}`}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-gray-600">Trust Score</span>
                      {trust.score !== null ? (
                        <span className="font-semibold" data-testid={`trust-claim-score-${vehicle.vin}`}>
                          {trust.score} / 100 · {trust.headline}
                        </span>
                      ) : (
                        <span className="italic text-gray-400" data-testid={`trust-claim-state-${vehicle.vin}`}>
                          {trust.headline}
                        </span>
                      )}
                    </div>
                    {/* The bar exists only where a measurement exists. `value={null}` fills the
                        track to 0%, which is how a never-assessed vehicle came to look assessed. */}
                    {trust.score !== null && <Progress value={trust.score} className="h-2" />}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t">
                    <div className="flex gap-3 text-xs">
                      <span className="text-gray-600">{statedCount(vehicle.counts?.services, 'service')}</span>
                      <span className="text-gray-600">{statedCount(vehicle.counts?.active_insurance, 'active policy', 'active policies')}</span>
                      <span className="text-gray-600">{statedCount(vehicle.counts?.parts, 'part tracked', 'parts tracked')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-orange-600">
                      <span>{vehicle.publication_status === 'published' ? 'Published' : 'Listing draft'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          )
        })}

        {/* Add Vehicle Card */}
        <button className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 hover:border-orange-500 hover:text-orange-500 hover:bg-orange-50 transition-all min-h-[200px]" data-testid="create-vehicle-button">
          <Plus className="w-10 h-10 mb-3" />
          <span className="font-medium">Add New Vehicle</span>
          <span className="text-sm">Scan logbook or enter VIN</span>
        </button>
      </div>
    </div>
  )
}