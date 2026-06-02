import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, Eye, CheckCircle, XCircle, Flag } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

export default function MarketplaceModeration() {
  const { fetchVehicles, updateVehicleStatus } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  const loadVehicles = async () => {
    setLoading(true)
    try {
      const data = await fetchVehicles()
      setVehicles(data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch vehicles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVehicles()
  }, [fetchVehicles])

  const handleUpdateStatus = async (vin: string, status: string) => {
    if (!vin) return
    try {
      await updateVehicleStatus(vin, status)
      toast.success(`Vehicle status updated to ${status}`)
      loadVehicles()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Marketplace Moderation</h1>
          <p className="text-gray-500">Review flagged content and user reports</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Listings</p><p className="text-2xl font-bold text-blue-600">{vehicles.length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Pending Review</p><p className="text-2xl font-bold">{vehicles.filter(v => v.status === 'pending').length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Approved</p><p className="text-2xl font-bold text-green-600">{vehicles.filter(v => v.status === 'approved').length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Banned</p><p className="text-2xl font-bold text-red-600">{vehicles.filter(v => v.status === 'banned').length}</p></CardContent></Card>
      </div>

      <div className="space-y-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-5 flex items-start gap-4">
                <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : vehicles.length > 0 ? vehicles.map((vehicle) => (
          <Card key={vehicle.vin} className={`border-0 card-shadow ${vehicle.status === 'banned' ? 'ring-1 ring-red-200' : ''}`}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${vehicle.status === 'banned' ? 'bg-red-100' : 'bg-amber-100'}`}>
                  <ShieldAlert className={`w-5 h-5 ${vehicle.status === 'banned' ? 'text-red-600' : 'text-amber-600'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <Badge className={vehicle.status === 'banned' ? 'bg-red-500' : vehicle.status === 'approved' ? 'bg-green-500' : 'bg-amber-500'}>
                        {vehicle.status || 'pending'}
                      </Badge>
                    </div>
                    <span className="text-sm text-gray-500">{vehicle.vin}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">Price: ${vehicle.price?.toLocaleString()} | Mileage: {vehicle.mileage?.toLocaleString()} km</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Flag className="w-3 h-3" />System</span>
                    <span>Type: Listing</span>
                    <span>Date: {new Date(vehicle.created_at || Date.now()).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline"><Eye className="w-4 h-4" /></Button>
                  <Button size="sm" variant="outline" className="text-green-600" onClick={() => handleUpdateStatus(vehicle.vin, 'approved')}><CheckCircle className="w-4 h-4" /></Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleUpdateStatus(vehicle.vin, 'banned')}><XCircle className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )) : (
          <div className="text-center py-8 text-gray-500">No vehicles found.</div>
        )}
      </div>
    </div>
  )
}