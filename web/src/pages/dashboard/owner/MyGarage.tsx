// @ts-nocheck
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Plus, ArrowRight, Gauge, Calendar, FileText, Shield, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export default function MyGarage() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<any[]>([])

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
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1">
          <Plus className="w-4 h-4" /> Add Vehicle
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {vehicles.map((vehicle) => (
          <Link key={vehicle.vin} to={`/dashboard/garage/${vehicle.vin}`}>
            <Card className="border-0 card-shadow hover-lift overflow-hidden">
              <CardContent className="p-0">
                <div className="relative h-44">
                  <img src={vehicle.image_url || 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80'} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3">
                    <Badge className="bg-white/90 text-gray-900">{vehicle.vin}</Badge>
                  </div>
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-green-500 text-white">
                      <Shield className="w-3 h-3 mr-1" /> {vehicle.status || 'Active'}
                    </Badge>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <p className="text-sm text-gray-500">{vehicle.color} • {vehicle.vin?.slice(0, 8)}...</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Current Value</p>
                      <p className="font-bold text-orange-600">${vehicle.price?.toLocaleString() || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                    <span className="flex items-center gap-1"><Gauge className="w-3.5 h-3.5" />{vehicle.mileage?.toLocaleString()} km</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Added {new Date(vehicle.created_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{vehicle.documents?.length || 0} docs</span>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-gray-600">Trust Score</span>
                      <span className="font-semibold">{vehicle.trust_score}%</span>
                    </div>
                    <Progress value={vehicle.trust_score} className="h-2" />
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t">
                    <div className="flex gap-3 text-xs">
                      <span className="text-gray-600">{vehicle.service_records?.length || 0} services</span>
                      <span className="text-gray-600">{vehicle.insurance_records?.filter((r: any) => r.status === 'active').length || 0} active insurance</span>
                      <span className="text-gray-600">{vehicle.parts?.length || 0} parts tracked</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Add Vehicle Card */}
        <button className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 hover:border-orange-500 hover:text-orange-500 hover:bg-orange-50 transition-all min-h-[200px]">
          <Plus className="w-10 h-10 mb-3" />
          <span className="font-medium">Add New Vehicle</span>
          <span className="text-sm">Scan logbook or enter VIN</span>
        </button>
      </div>
    </div>
  )
}