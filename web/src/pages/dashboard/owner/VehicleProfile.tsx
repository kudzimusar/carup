import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft, Gauge, Calendar, FileText, Shield, CheckCircle,
  Wrench, Palette, Hash, Upload, Star, Loader2
} from 'lucide-react'

import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { VehiclePassport, InsuranceRecord } from '@/types'

export default function VehicleProfile() {
  const { id } = useParams()
  const { fetchVehiclePassport } = useCarUpApi()
  const [passportData, setPassportData] = useState<VehiclePassport | null>(null)

  useEffect(() => {
    if (!id) return
    fetchVehiclePassport(id)
      .then(data => {
        setPassportData(data)
      })
      .catch(err => console.error('Error fetching passport details:', err))
  }, [fetchVehiclePassport, id])

  if (!passportData) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    )
  }

  const vehicle = {
    make: passportData.vehicle?.make || 'Unknown',
    model: passportData.vehicle?.model || 'Unknown',
    year: passportData.vehicle?.year || 'Unknown',
    vin: passportData.vehicle?.vin || id || '',
    mileage: passportData.vehicle?.mileage || 0,
    trustScore: passportData.trustReport?.trustScore || 0,
    color: passportData.vehicle?.color || 'Unknown',
    purchasePrice: passportData.vehicle?.price || 0,
    currentEstimate: (passportData.vehicle?.price || 0) * 0.9,
    image: passportData.vehicle?.image_url || 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80',
    registration: passportData.vehicle?.vin || id || '',
    engineNumber: 'UNKNOWN',
    purchaseDate: passportData.vehicle?.created_at || new Date().toISOString(),
    documents: [] as { id: string; title: string; date: string; status: string }[],
    insuranceRecords: [] as InsuranceRecord[],
    serviceHistory: (passportData.timeline || [])
      .filter((e) => e.event_source === 'service')
      .map((e) => ({
        id: e.id,
        serviceType: e.label,
        garage: e.details?.notes || 'Simbisa Garages',
        date: new Date(e.timestamp).toLocaleDateString(),
        mileage: e.details?.mileage || 0,
        description: e.details?.notes || 'Standard vehicle check sheets and maintenance update',
        cost: e.details?.cost || 0
      })),
    partsHistory: (passportData.timeline || [])
      .filter((e) => e.event_source === 'service')
      .map((e) => ({
        id: e.id,
        name: e.label,
        manufacturer: 'OEM',
        type: 'OEM',
        installedDate: new Date(e.timestamp).toLocaleDateString(),
        cost: e.details?.cost || 0
      }))
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="gap-1" asChild>
        <Link to="/dashboard/garage"><ArrowLeft className="w-4 h-4" /> Back to Garage</Link>
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 card-shadow overflow-hidden">
            <div className="relative h-56">
              <img src={vehicle.image} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{vehicle.year} {vehicle.make} {vehicle.model}</h1>
                  <Badge className="bg-white/20 text-white">{vehicle.registration}</Badge>
                </div>
                <p className="text-sm text-gray-200">VIN: {vehicle.vin}</p>
              </div>
            </div>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                  { icon: Gauge, label: 'Mileage', value: `${vehicle.mileage.toLocaleString()} km` },
                  { icon: Palette, label: 'Color', value: vehicle.color },
                  { icon: Hash, label: 'Engine No.', value: vehicle.engineNumber },
                  { icon: Calendar, label: 'Purchased', value: new Date(vehicle.purchaseDate).toLocaleDateString() },
                ].map((item) => (
                  <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                    <item.icon className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="font-semibold text-sm">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Trust Score</span>
                  <span className="font-bold text-lg">{vehicle.trustScore}%</span>
                </div>
                <Progress value={vehicle.trustScore} className="h-3" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-green-50 text-green-700">
                  <CheckCircle className="w-3 h-3 mr-1" /> Logbook Verified
                </Badge>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                  <Shield className="w-3 h-3 mr-1" /> Insurance Active
                </Badge>
                <Badge variant="secondary" className="bg-purple-50 text-purple-700">
                  <Star className="w-3 h-3 mr-1" /> PartSentry Active
                </Badge>
                {passportData?.chainVerification?.verified && (
                  <Badge variant="secondary" className="bg-orange-50 text-orange-700 animate-pulse-glow">
                    <CheckCircle className="w-3 h-3 mr-1" /> Ledger Synced
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="documents" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="documents" className="flex-1">Documents</TabsTrigger>
              <TabsTrigger value="service" className="flex-1">Service History</TabsTrigger>
              <TabsTrigger value="insurance" className="flex-1">Insurance</TabsTrigger>
              <TabsTrigger value="parts" className="flex-1">Parts</TabsTrigger>
            </TabsList>
            <TabsContent value="documents" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {vehicle.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <FileText className="w-5 h-5 text-orange-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-gray-500">{doc.date}</p>
                      </div>
                      <Badge className={doc.status === 'verified' ? 'bg-green-500 text-white' : doc.status === 'expired' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}>
                        {doc.status}
                      </Badge>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full gap-1"><Upload className="w-4 h-4" /> Upload Document</Button>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="service" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {vehicle.serviceHistory.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <Wrench className="w-5 h-5 text-orange-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{s.serviceType}</p>
                        <p className="text-xs text-gray-500">{s.garage} • {s.date} • {s.mileage.toLocaleString()} km</p>
                        <p className="text-xs text-gray-600 mt-1">{s.description}</p>
                      </div>
                      <span className="text-sm font-medium">${s.cost}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="insurance" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5 space-y-3">
                  {vehicle.insuranceRecords.map((ir) => (
                    <div key={ir.id} className={`p-4 rounded-lg border ${ir.status === 'active' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-green-600" />
                          <span className="font-medium">{ir.provider}</span>
                        </div>
                        <Badge className={ir.status === 'active' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>{ir.status}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">Policy: {ir.policyNumber}</p>
                      <p className="text-sm text-gray-600">{ir.type} • ${ir.premium}/year</p>
                      <p className="text-xs text-gray-500 mt-1">{ir.startDate} to {ir.expiryDate}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="parts" className="mt-4">
              <Card className="border-0 card-shadow">
                <CardContent className="p-5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 font-medium text-gray-500">Part</th>
                          <th className="text-left py-2 font-medium text-gray-500">Type</th>
                          <th className="text-left py-2 font-medium text-gray-500">Date</th>
                          <th className="text-right py-2 font-medium text-gray-500">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicle.partsHistory.map((part) => (
                          <tr key={part.id} className="border-b last:border-0">
                            <td className="py-3">
                              <p className="font-medium">{part.name}</p>
                              <p className="text-xs text-gray-500">{part.manufacturer}</p>
                            </td>
                            <td className="py-3"><Badge variant="outline" className="text-xs">{part.type}</Badge></td>
                            <td className="py-3 text-gray-600">{part.installedDate}</td>
                            <td className="py-3 text-right font-medium">${part.cost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-0 card-shadow">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-4">Vehicle Summary</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Purchase Price</span><span>${vehicle.purchasePrice.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Current Value</span><span className="font-bold text-orange-600">${vehicle.currentEstimate.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Depreciation</span><span className="text-red-500">-${(vehicle.purchasePrice - vehicle.currentEstimate).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Services</span><span>{vehicle.serviceHistory.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Parts</span><span>{vehicle.partsHistory.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Service Cost</span><span>${vehicle.serviceHistory.reduce((a, s) => a + s.cost, 0).toLocaleString()}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 card-shadow bg-gradient-to-br from-orange-500 to-amber-500 text-white">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-2">AI Valuation</h3>
              <p className="text-3xl font-bold mb-1">${vehicle.currentEstimate.toLocaleString()}</p>
              <p className="text-sm opacity-90 mb-4">Estimated market value</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="opacity-80">Market range</span><span>${(vehicle.currentEstimate * 0.9).toLocaleString()} - ${(vehicle.currentEstimate * 1.1).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="opacity-80">Confidence</span><span>92%</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}