// @ts-nocheck
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Star, Phone, Mail, MapPin, Shield, CheckCircle, Search, FileText } from 'lucide-react'
import { insuranceProviders } from '@/data/mockData'

export default function InsuranceDirectory() {
  const [search, setSearch] = useState('')
  const filtered = insuranceProviders.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Insurance Directory</h1>
          <p className="text-gray-600 mb-6">Compare and connect with trusted motor insurance providers</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search insurance providers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((provider) => (
            <Card key={provider.id} className="border-0 card-shadow hover-lift">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <img src={provider.logo} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{provider.name}</h3>
                      {provider.isVerified && <CheckCircle className="w-4 h-4 text-green-500" />}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium">{provider.rating}</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4">{provider.description}</p>
                <div className="space-y-2 mb-4">
                  <h4 className="text-sm font-medium">Available Policies</h4>
                  <div className="flex flex-wrap gap-2">
                    {provider.policies.map(p => (
                      <Badge key={p} variant="secondary" className="bg-blue-50 text-blue-700 font-normal">{p}</Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 text-sm mb-4">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" />{provider.phone}</div>
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-400" />{provider.email}</div>
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" />{provider.location}</div>
                </div>
                <Button className="w-full gap-1"><Shield className="w-4 h-4" /> Get a Quote</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}