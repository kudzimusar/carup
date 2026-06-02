import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star, MapPin, Phone, Mail, CheckCircle, ArrowRight, Search } from 'lucide-react'
import { dealers } from '@/data/mockData'
import { useState } from 'react'

export default function DealerDirectory() {
  const [search, setSearch] = useState('')
  const filtered = dealers.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.location.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Dealer Directory</h1>
          <p className="text-gray-600 mb-6">Find verified car dealers across Zimbabwe</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search dealers by name or location..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((dealer) => (
            <Card key={dealer.id} className="border-0 card-shadow hover-lift">
              <CardContent className="p-6">
                <div className="flex items-start gap-4 mb-4">
                  <img src={dealer.logo} alt="" className="w-16 h-16 rounded-xl object-cover" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{dealer.name}</h3>
                      {dealer.isVerified && <CheckCircle className="w-4 h-4 text-green-500" />}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                      <MapPin className="w-3.5 h-3.5" />{dealer.location}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium">{dealer.rating}</span>
                      <span className="text-xs text-gray-500">({dealer.reviewCount} reviews)</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {dealer.specialties.map(s => (
                    <Badge key={s} variant="secondary" className="text-xs font-normal">{s}</Badge>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="font-semibold">{dealer.inventoryCount}</p>
                    <p className="text-xs text-gray-500">Vehicles</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="font-semibold">{dealer.yearsInBusiness} yrs</p>
                    <p className="text-xs text-gray-500">In Business</p>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm mb-4">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" />{dealer.phone}</div>
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-400" />{dealer.email}</div>
                </div>
                <Button className="w-full gap-1" variant="outline" asChild>
                  <Link to="/marketplace">View Inventory <ArrowRight className="w-4 h-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}