import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Calendar, DollarSign, Plus } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle, ServiceRecord, Part } from '@/types'

export default function ServiceHistory() {
  const { fetchOwnedVehicles, fetchServiceHistory } = useCarUpApi()
  const [search, setSearch] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allServices, setAllServices] = useState<ServiceRecord[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<string>('')

  useEffect(() => {
    Promise.all([fetchOwnedVehicles(), fetchServiceHistory()]).then(([vData, sData]) => {
      setVehicles(vData)
      setAllServices(sData)
      if (vData.length > 0) setSelectedVehicle(vData[0].vin)
    })
  }, [fetchOwnedVehicles, fetchServiceHistory])

  const services = allServices.filter(s =>
    s.vin === selectedVehicle &&
    (!search || s.issue_description?.toLowerCase().includes(search.toLowerCase()))
  )

  const totalCost = services.reduce((a, s) => a + (s.total_cost || 0), 0)

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Service History</h1>
          <p className="text-gray-500">Complete maintenance records for your vehicles</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1"><Plus className="w-4 h-4" /> Add Service</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {vehicles.map(v => (
          <button
            key={v.vin}
            onClick={() => setSelectedVehicle(v.vin)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedVehicle === v.vin ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {v.make} {v.model}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Services</p><p className="text-2xl font-bold">{services.length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Spent</p><p className="text-2xl font-bold text-orange-600">${totalCost.toLocaleString()}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Next Service</p><p className="text-2xl font-bold">500 km</p></CardContent></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search services..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="space-y-4">
        {services.map((service) => (
          <Card key={service.id} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                  <Wrench className="w-5 h-5 text-orange-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold">{service.issue_description || 'General Service'}</h3>
                    <Badge className={service.status === 'completed' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}>{service.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{service.issue_description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(service.created_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1">Garage ID: {service.tenant_id?.slice(0,8)}</span>
                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${service.total_cost || 0}</span>
                  </div>
                  {service.parts && service.parts.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium text-gray-600 mb-2">Parts Replaced:</p>
                      <div className="flex flex-wrap gap-2">
                        {service.parts.map((p: Part) => (
                          <Badge key={p.id} variant="secondary" className="text-xs font-normal">{p.name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}