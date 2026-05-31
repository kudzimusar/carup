// @ts-nocheck
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import {
  Search, SlidersHorizontal, CheckCircle, Heart, MapPin, Gauge, Fuel, Settings2, X, Loader2
} from 'lucide-react'
import { zimbabweLocations } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'

const categories = ['All', 'Sedan', 'SUV', 'Hatchback', 'Pickup', 'Luxury', 'Commercial']
const conditions = ['All', 'New', 'Used', 'Certified Pre-Owned']
const makes = ['All', 'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Mazda', 'Volkswagen', 'Ford', 'Honda', 'Land Rover', 'Audi']
const fuelTypes = ['All', 'Petrol', 'Diesel', 'Hybrid', 'Electric']
const transmissions = ['All', 'Automatic', 'Manual']

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-white shadow-md animate-pulse">
      <div className="aspect-[16/10] bg-gray-200" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-5 bg-gray-200 rounded w-1/2" />
        <div className="h-3 bg-gray-200 rounded w-full" />
        <div className="h-px bg-gray-100 my-2" />
        <div className="h-3 bg-gray-200 rounded w-2/3" />
      </div>
    </div>
  )
}

function getFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem('carup_favorites') || '[]')
  } catch { return [] }
}

function setFavorites(ids: string[]) {
  localStorage.setItem('carup_favorites', JSON.stringify(ids))
}

export default function Marketplace() {
  const { fetchVehicles } = useCarUpApi()
  const [liveVehicles, setLiveVehicles] = useState<any[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedMake, setSelectedMake] = useState('All')
  const [selectedCondition, setSelectedCondition] = useState('All')
  const [selectedFuel, setSelectedFuel] = useState('All')
  const [selectedTrans, setSelectedTrans] = useState('All')
  const [selectedLocation, setSelectedLocation] = useState('All')
  const [priceRange, setPriceRange] = useState([0, 100000])
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState('newest')

  useEffect(() => {
    setLoadingVehicles(true)
    fetchVehicles()
      .then((data) => {
        if (data && Array.isArray(data)) {
          setLiveVehicles(data)
        }
      })
      .catch((err) => {
        console.error('Failed to fetch marketplace vehicles:', err)
      })
      .finally(() => setLoadingVehicles(false))
  }, [])

  const toggleFavorite = useCallback((e: React.MouseEvent, vehicleId: string, vehicleName: string) => {
    e.preventDefault()
    e.stopPropagation()
    const current = getFavorites()
    let updated: string[]
    if (current.includes(vehicleId)) {
      updated = current.filter(id => id !== vehicleId)
      toast.info(`Removed from saved cars`)
    } else {
      updated = [...current, vehicleId]
      toast.success(`${vehicleName} saved!`)
    }
    setFavorites(updated)
    setFavoritesState(updated)
  }, [])

  const filtered = liveVehicles.filter((v: any) => {
    const loc = v.location || ''
    const matchSearch = !searchQuery ||
      `${v.make} ${v.model}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.toLowerCase().includes(searchQuery.toLowerCase())
    const matchCat = selectedCategory === 'All' || v.category === selectedCategory
    const matchMake = selectedMake === 'All' || v.make === selectedMake
    const matchCond = selectedCondition === 'All' || v.condition === selectedCondition
    const matchFuel = selectedFuel === 'All' || v.fuel_type === selectedFuel
    const matchTrans = selectedTrans === 'All' || v.transmission === selectedTrans
    const matchLoc = selectedLocation === 'All' || loc === selectedLocation
    const matchPrice = v.price >= priceRange[0] && v.price <= priceRange[1]
    return matchSearch && matchCat && matchMake && matchCond && matchFuel && matchTrans && matchLoc && matchPrice
  })

  const sorted = [...filtered].sort((a: any, b: any) => {
    if (sortBy === 'price-low') return a.price - b.price
    if (sortBy === 'price-high') return b.price - a.price
    if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'trust') return (b.trust_score || 0) - (a.trust_score || 0)
    return 0
  })

  const activeFilterCount = [
    selectedCategory !== 'All', selectedMake !== 'All', selectedCondition !== 'All',
    selectedFuel !== 'All', selectedTrans !== 'All', selectedLocation !== 'All',
    priceRange[0] > 0 || priceRange[1] < 100000,
  ].filter(Boolean).length

  const resetFilters = () => {
    setSelectedCategory('All'); setSelectedMake('All'); setSelectedCondition('All')
    setSelectedFuel('All'); setSelectedTrans('All'); setSelectedLocation('All')
    setPriceRange([0, 100000]); setSearchQuery('')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-8">
          <h1 className="text-3xl font-bold mb-2">Vehicle Marketplace</h1>
          <p className="text-gray-600">Browse {liveVehicles.length} verified vehicles across Zimbabwe</p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {/* Search & Sort Bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search make, model, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="price-low">Price: Low to High</SelectItem>
              <SelectItem value="price-high">Price: High to Low</SelectItem>
              <SelectItem value="trust">Highest Trust Score</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            className={showFilters ? 'bg-orange-500 hover:bg-orange-600' : ''}
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">{activeFilterCount}</Badge>
            )}
          </Button>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card className="mb-6 border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Filters</h3>
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <X className="w-4 h-4 mr-1" /> Reset
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Make</label>
                  <Select value={selectedMake} onValueChange={setSelectedMake}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{makes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Category</label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Condition</label>
                  <Select value={selectedCondition} onValueChange={setSelectedCondition}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{conditions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Location</label>
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Locations</SelectItem>
                      {zimbabweLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Fuel Type</label>
                  <Select value={selectedFuel} onValueChange={setSelectedFuel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{fuelTypes.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Transmission</label>
                  <Select value={selectedTrans} onValueChange={setSelectedTrans}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{transmissions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">
                    Price Range: ${priceRange[0].toLocaleString()} - ${priceRange[1].toLocaleString()}
                  </label>
                  <Slider value={priceRange} onValueChange={setPriceRange} max={100000} step={1000} className="mt-3" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-600">
            {loadingVehicles
              ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading vehicles...</span>
              : <><span className="font-semibold">{sorted.length}</span> vehicles found</>
            }
          </p>
        </div>

        {/* Grid */}
        {loadingVehicles ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No vehicles found</h3>
            <p className="text-gray-500 mb-4">Try adjusting your filters or search term</p>
            <Button variant="outline" onClick={resetFilters}>Reset Filters</Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {sorted.map((vehicle: any) => {
              const isFav = favorites.includes(vehicle.vin)
              const isReserved = vehicle.status === 'reserved' || vehicle.status === 'Reserved'
              const fallbackImage = 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=800'
              const primaryImage = vehicle.images?.[0] || fallbackImage
              return (
                <Link key={vehicle.vin} to={`/marketplace/${vehicle.vin}`} className="group">
                  <Card className="overflow-hidden border-0 card-shadow hover-lift h-full bg-white">
                    <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                      <img
                        src={primaryImage}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute top-3 left-3 flex gap-2">
                        {vehicle.police_verified && (
                          <Badge className="bg-green-500 text-white text-[10px]">
                            <CheckCircle className="w-3 h-3 mr-1" /> Verified
                          </Badge>
                        )}
                        {vehicle.trust_score > 90 && (
                          <Badge className="bg-orange-500 text-white text-[10px]">Featured</Badge>
                        )}
                        {isReserved && (
                          <Badge className="bg-amber-500 text-white text-[10px]">Reserved</Badge>
                        )}
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(e, vehicle.vin, `${vehicle.year} ${vehicle.make} ${vehicle.model}`)}
                        className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
                      >
                        <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                      </button>
                    </div>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-semibold text-sm line-clamp-1">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      </div>
                      <p className="text-xl font-bold text-orange-600">${vehicle.price.toLocaleString()}</p>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{(vehicle.mileage || 0).toLocaleString()} km</span>
                        <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission || 'Auto'}</span>
                        <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{vehicle.fuel_type || 'Petrol'}</span>
                      </div>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {vehicle.sellerAvatar ? <img src={vehicle.sellerAvatar} alt="" className="w-5 h-5 rounded-full" /> : <div className="w-5 h-5 bg-gray-200 rounded-full" />}
                          <span className="text-xs text-gray-600 line-clamp-1">{vehicle.sellerName || 'Verified Dealer'}</span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <MapPin className="w-3 h-3" />{vehicle.location || 'Zimbabwe'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}