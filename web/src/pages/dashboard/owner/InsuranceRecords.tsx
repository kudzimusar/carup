// @ts-nocheck
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Shield, Plus, Calendar, FileText, CheckCircle, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

export default function InsuranceRecords() {
  const { fetchOwnedVehicles } = useCarUpApi()
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<string>('')

  useEffect(() => {
    fetchOwnedVehicles().then(data => {
      setVehicles(data)
      if (data.length > 0) setSelectedVehicle(data[0].vin)
    })
  }, [fetchOwnedVehicles])

  const vehicle = vehicles.find(v => v.vin === selectedVehicle) || null
  const insuranceRecords = vehicle?.insurance_records || []

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance Records</h1>
          <p className="text-gray-500">Manage your vehicle insurance policies</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1"><Plus className="w-4 h-4" /> Add Policy</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {vehicles.map(v => (
          <button key={v.vin} onClick={() => setSelectedVehicle(v.vin)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedVehicle === v.vin ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v.make} {v.model}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {insuranceRecords.map((record: any) => (
          <Card key={record.id} className={`border-0 card-shadow ${record.status === 'active' ? 'ring-1 ring-green-200' : ''}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-6 h-6 text-green-600" />
                  <div>
                    <h3 className="font-semibold">{record.provider}</h3>
                    <p className="text-xs text-gray-500">{record.policy_number}</p>
                  </div>
                </div>
                <Badge className={record.status === 'active' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>{record.status}</Badge>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-gray-500">Type</span><span>{record.type}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Premium</span><span className="font-medium">${record.premium}/mo</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Start</span><span>{new Date(record.start_date).toLocaleDateString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Expiry</span><span>{new Date(record.expiry_date).toLocaleDateString()}</span></div>
              </div>

              <div className="pt-3 border-t">
                <p className="text-xs font-medium text-gray-600 mb-2">Coverage:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(record.coverage || []).map((c: string) => (
                    <Badge key={c} variant="secondary" className="text-[10px] font-normal">{c}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {insuranceRecords.some((r: any) => r.status === 'expired') && (
        <Card className="border-0 card-shadow bg-amber-50 border-amber-200">
          <CardContent className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium">Expired Policy Detected</h3>
              <p className="text-sm text-gray-600">You have an expired insurance policy. Renew now to maintain your trust score and stay protected.</p>
              <Button size="sm" className="mt-2 bg-orange-500 hover:bg-orange-600">Renew Policy</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}