import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Plus, Phone, Mail, Car, Wrench } from 'lucide-react'
import { useState } from 'react'

const customers = [
  { id: 1, name: 'Tendai Moyo', phone: '+263 773 345 678', email: 'tendai@email.co.zw', vehicles: 2, visits: 8, totalSpent: 1240, lastVisit: '2026-04-20' },
  { id: 2, name: 'Sarah Chikomo', phone: '+263 775 567 890', email: 'sarah@email.co.zw', vehicles: 1, visits: 5, totalSpent: 890, lastVisit: '2026-05-21' },
  { id: 3, name: 'James Ncube', phone: '+263 777 789 012', email: 'james@email.co.zw', vehicles: 2, visits: 12, totalSpent: 2340, lastVisit: '2026-03-10' },
  { id: 4, name: 'Grace Mupfumi', phone: '+263 778 890 123', email: 'grace@email.co.zw', vehicles: 1, visits: 3, totalSpent: 450, lastVisit: '2026-05-15' },
]

export default function CustomerRecords() {
  const [search, setSearch] = useState('')
  const filtered = customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customer Records</h1>
          <p className="text-gray-500">Manage your customer relationships</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1"><Plus className="w-4 h-4" /> Add Customer</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="space-y-4">
        {filtered.map((customer) => (
          <Card key={customer.id} className="border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                  <span className="font-semibold text-orange-600">{customer.name.charAt(0)}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold">{customer.name}</h3>
                    <Badge variant="secondary" className="text-xs">{customer.visits} visits</Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-gray-500 mb-2">
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{customer.phone}</span>
                    <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{customer.email}</span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Car className="w-3 h-3" />{customer.vehicles} vehicles</span>
                    <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />${customer.totalSpent.toLocaleString()} total</span>
                    <span>Last visit: {customer.lastVisit}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}