import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, CheckCircle, Gauge, Fuel, Settings2, MapPin } from 'lucide-react'
import { vehicles, zimbabweLocations } from '@/data/mockData'

export default function VehicleSearch() {
  const [query, setQuery] = useState('')
  const [make, setMake] = useState('All')
  const [category, setCategory] = useState('All')
  const [location, setLocation] = useState('All')

  const makes = ['All', ...Array.from(new Set(vehicles.map(v => v.make)))]
  const categories = ['All', ...Array.from(new Set(vehicles.map(v => v.category)))]

  const filtered = vehicles.filter(v => {
    const q = query.toLowerCase()
    const normQ = query.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const matchQuery = !query ||
      `${v.make} ${v.model}`.toLowerCase().includes(q) ||
      v.vin.toLowerCase().includes(q) ||
      v.location.toLowerCase().includes(q) ||
      (v.plate_number && (
        v.plate_number.toLowerCase().includes(q) ||
        v.plate_number.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(normQ)
      )) ||
      (v.chassis_number && (
        v.chassis_number.toLowerCase().includes(q) ||
        v.chassis_number.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(normQ)
      )) ||
      (v.temporary_identification_number && (
        v.temporary_identification_number.toLowerCase().includes(q) ||
        v.temporary_identification_number.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(normQ)
      ))
    const matchMake = make === 'All' || v.make === make
    const matchCat = category === 'All' || v.category === category
    const matchLoc = location === 'All' || v.location === location
    return matchQuery && matchMake && matchCat && matchLoc
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px]">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Vehicle Search</h1>
          <p className="text-gray-300 mb-8">Search by VIN, chassis, plate, or temporary ID</p>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Enter VIN, chassis, plate, or temporary ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400"
              />
            </div>
            <Select value={make} onValueChange={setMake}>
              <SelectTrigger className="w-[150px] bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Make" />
              </SelectTrigger>
              <SelectContent>{makes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[150px] bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger className="w-[150px] bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Locations</SelectItem>
                {zimbabweLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-8">
        <p className="text-sm text-gray-600 mb-4">{filtered.length} vehicles found</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((vehicle) => (
            <Link key={vehicle.id} to={`/marketplace/${vehicle.id}`} className="group">
              <Card className="overflow-hidden border-0 card-shadow hover-lift h-full bg-white">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img src={vehicle.images[0]} alt={`${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  {vehicle.isVerified && (
                    <Badge className="absolute top-3 left-3 bg-green-500 text-white text-[10px]">
                      <CheckCircle className="w-3 h-3 mr-1" /> Verified
                    </Badge>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-sm">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                  <p className="text-lg font-bold text-orange-600 mt-1">${vehicle.price.toLocaleString()}</p>
                  <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{vehicle.mileage.toLocaleString()} km</span>
                    <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission}</span>
                    <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{vehicle.fuelType}</span>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600">{vehicle.sellerName}</span>
                    <span className="flex items-center gap-1 text-xs text-gray-400"><MapPin className="w-3 h-3" />{vehicle.location}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}