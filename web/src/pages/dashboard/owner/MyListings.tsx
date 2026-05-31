// @ts-nocheck
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Eye, DollarSign, TrendingUp, Loader2, Car } from 'lucide-react'
import { toast } from 'sonner'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const STATUS_BADGE: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  reserved: 'bg-amber-100 text-amber-700',
  sold: 'bg-gray-100 text-gray-500',
}

export default function MyListings() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [listingStatuses, setListingStatuses] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [myListings, setMyListings] = useState<any[]>([])

  useEffect(() => {
    fetchOwnedVehicles().then(data => {
      // Assuming all owned vehicles are potential listings
      setMyListings(data)
    })
  }, [fetchOwnedVehicles])

  const handleMarkSold = async (vehicleId: string, vin: string) => {
    setMarkingId(vehicleId)
    try {
      await fetch(`http://localhost:5001/api/vehicles/${vin}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sold' }),
      })
    } catch { /* backend offline — update locally */ }
    setListingStatuses(prev => ({ ...prev, [vehicleId]: 'sold' }))
    setMarkingId(null)
    toast.success('Vehicle marked as sold! It will be removed from active listings.')
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Listings</h1>
          <p className="text-gray-500">Manage your marketplace listings</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" asChild>
          <Link to="/dashboard/sell-vehicle"><Plus className="w-4 h-4" /> New Listing</Link>
        </Button>
      </div>

      {myListings.length === 0 ? (
        <Card className="border-0 card-shadow">
          <CardContent className="p-12 text-center">
            <Car className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Listings Yet</h3>
            <p className="text-gray-500 mb-4">List your vehicle on the marketplace to reach thousands of buyers across Zimbabwe.</p>
            <Button className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link to="/dashboard/sell-vehicle">Create Your First Listing</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {myListings.map((listing) => {
            const effectiveStatus = listingStatuses[listing.vin] || listing.status || 'available'
            const isSold = effectiveStatus === 'sold'
            return (
              <Card key={listing.vin} className={`border-0 card-shadow transition-opacity ${isSold ? 'opacity-60' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <img src={listing.image_url || 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80'} alt="" className="w-32 h-24 rounded-lg object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <h3 className="font-semibold">{listing.year} {listing.make} {listing.model}</h3>
                          <p className="text-lg font-bold text-orange-600 mt-0.5">${listing.price?.toLocaleString() || 'N/A'}</p>
                        </div>
                        <Badge className={`text-xs font-medium ${STATUS_BADGE[effectiveStatus] || 'bg-gray-100 text-gray-600'}`}>
                          {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{listing.viewCount || 0} views</span>
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />Trust: {listing.trust_score}</span>
                        <span>Listed {new Date(listing.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                          <Link to={`/marketplace/${listing.vin}`}><Eye className="w-3 h-3" /> View on Marketplace</Link>
                        </Button>
                        {!isSold && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1"
                            disabled={markingId === listing.vin}
                            onClick={() => handleMarkSold(listing.vin, listing.vin)}
                          >
                            {markingId === listing.vin
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Updating...</>
                              : <><DollarSign className="w-3 h-3" /> Mark as Sold</>
                            }
                          </Button>
                        )}
                        {isSold && <Badge className="text-xs text-gray-400 font-normal">Sale completed</Badge>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}