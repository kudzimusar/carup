import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star, MapPin, Phone, Clock, CheckCircle, Search } from 'lucide-react'
import { garages } from '@/data/mockData'
import { useState } from 'react'

export default function GarageDirectory() {
  const [search, setSearch] = useState('')
  const filtered = garages.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.location.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Garage Directory</h1>
          <p className="text-gray-600 mb-6">Find verified mechanics and service centers</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search garages by name or location..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((garage) => (
            <Card key={garage.id} className="border-0 card-shadow hover-lift">
              <CardContent className="p-0">
                <div className="relative h-40 overflow-hidden rounded-t-xl">
                  <img src={garage.image} alt="" className="w-full h-full object-cover" />
                  {garage.isVerified && (
                    <Badge className="absolute top-3 left-3 bg-green-500 text-white">
                      <CheckCircle className="w-3 h-3 mr-1" /> Verified
                    </Badge>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-lg">{garage.name}</h3>
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium">{garage.rating}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mb-3 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{garage.location}, {garage.province}</p>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{garage.description}</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {garage.services.slice(0, 4).map(s => (
                      <Badge key={s} variant="secondary" className="text-xs font-normal">{s}</Badge>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <p className="font-semibold">{garage.mechanics}</p>
                      <p className="text-xs text-gray-500">Mechanics</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <p className="font-semibold">{garage.reviewCount}</p>
                      <p className="text-xs text-gray-500">Reviews</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm mb-4">
                    <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" />{garage.phone}</div>
                    <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" />{garage.openingHours}</div>
                  </div>
                  <Button className="w-full">Book Service</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}