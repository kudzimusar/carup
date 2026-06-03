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
import { vehicles as mockVehicles, zimbabweLocations } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import type { MarketplaceListingSummary, Vehicle } from '@/types'

const categories = ['All', 'Sedan', 'SUV', 'Hatchback', 'Pickup', 'Luxury', 'Commercial']
const conditions = ['All', 'New', 'Used', 'Certified Pre-Owned']
const makes = ['All', 'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Mazda', 'Volkswagen', 'Ford', 'Honda', 'Land Rover', 'Audi']
const fuelTypes = ['All', 'Petrol', 'Diesel', 'Hybrid', 'Electric']
const transmissions = ['All', 'Automatic', 'Manual']

const marketplaceCategoryChips = [
  'Brand New',
  'Recently Imported',
  'Fresh Import',
  'Locally Used',
  'Second Hand',
  'Dealer Verified',
  'Passport Verified',
  'Duty Cleared',
  'Low Mileage',
  'Evidence Available',
  'PartSentry Checked',
  'Repair History Available',
  'Verified Parts',
  'Parts & Accessories',
]

function normalizeText(value?: string | null) {
  return (value || '').toLowerCase()
}

function normalizePlate(value?: string | null) {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function getTrustScore(vehicle: Vehicle) {
  return vehicle.trust_score ?? vehicle.trustScore ?? 0
}

function getFuelType(vehicle: Vehicle) {
  return vehicle.fuel_type || vehicle.fuelType || 'Petrol'
}

function isVerifiedVehicle(vehicle: Vehicle) {
  return Boolean(vehicle.police_verified || vehicle.isVerified || vehicle.plate_verified_at)
}

function getVehicleEvidenceCount(vehicle: Vehicle) {
  const candidate = vehicle as Vehicle & {
    evidence_count?: number
    evidenceCount?: number
    evidence_summary?: { count?: number }
  }
  return candidate.evidence_count ?? candidate.evidenceCount ?? candidate.evidence_summary?.count ?? 0
}

function getRepairHistoryCount(vehicle: Vehicle) {
  return (vehicle.repair_history_count || 0) + (vehicle.service_history?.length || 0) + (vehicle.service_records?.length || 0)
}

function hasPartSentrySignal(vehicle: Vehicle) {
  const candidate = vehicle as Vehicle & {
    partsentry_checked?: boolean
    partSentryChecked?: boolean
    partsentry_status?: string
  }
  return Boolean(
    candidate.partsentry_checked ||
    candidate.partSentryChecked ||
    candidate.partsentry_status === 'checked'
  )
}

function hasVerifiedParts(vehicle: Vehicle) {
  return Boolean(vehicle.verified_parts_count || vehicle.parts?.some(part => part.blockchainHash || part.type === 'OEM'))
}

function isDealerListing(vehicle: Vehicle) {
  const sellerType = normalizeText(vehicle.sellerType || vehicle.current_seller_type)
  return Boolean(vehicle.tenant || sellerType.includes('dealer') || sellerType.includes('dealership'))
}

function getSellerLabel(vehicle: Vehicle) {
  if (isDealerListing(vehicle)) {
    return vehicle.tenant?.name || vehicle.sellerName || 'Verified dealer'
  }
  return 'Private seller'
}

function getVehicleLabels(vehicle: Vehicle) {
  const labels: string[] = []
  const condition = normalizeText(vehicle.condition)
  const conditionCategory = normalizeText(vehicle.vehicle_condition_category)
  const importSource = normalizeText((vehicle as Vehicle & { import_source?: string }).import_source)
  const registrationCountry = normalizeText(vehicle.registration_country)

  if (condition === 'new' || conditionCategory === 'brand_new') labels.push('Brand New')
  if (condition === 'used' || conditionCategory === 'second_hand') labels.push('Second Hand')
  if (condition === 'certified pre-owned' || conditionCategory === 'certified_dealer') labels.push('Dealer Verified')
  if (isDealerListing(vehicle) && isVerifiedVehicle(vehicle)) labels.push('Dealer Verified')
  if (isVerifiedVehicle(vehicle)) labels.push('Verified')
  if ((vehicle as Vehicle & { passport_verified?: boolean }).passport_verified) labels.push('Passport Verified')
  if ((vehicle as Vehicle & { duty_paid?: boolean }).duty_paid) labels.push('Duty Cleared')
  if (importSource || conditionCategory === 'recently_imported') labels.push('Recently Imported', 'Fresh Import')
  if (registrationCountry === 'zimbabwe' || conditionCategory === 'locally_used') labels.push('Locally Used')
  if ((vehicle.mileage || 0) > 0 && (vehicle.mileage || 0) <= 50000) labels.push('Low Mileage')
  if (getVehicleEvidenceCount(vehicle) > 0) labels.push('Evidence Available')
  if (hasPartSentrySignal(vehicle)) labels.push('PartSentry Checked')
  if (getRepairHistoryCount(vehicle) > 0) labels.push('Repair History Available')
  if (hasVerifiedParts(vehicle)) labels.push('Verified Parts')

  const backendTags = vehicle.marketplace_tags || []
  const backendTagLabels = backendTags.map(tag => tag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '))
  return Array.from(new Set([...labels, ...backendTagLabels]))
}

function matchesCategoryChip(vehicle: Vehicle, chip: string) {
  if (chip === 'All') return true
  if (chip === 'Parts & Accessories') return true
  return getVehicleLabels(vehicle).includes(chip)
}

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

function marketplaceSummaryToVehicle(summary: MarketplaceListingSummary): Vehicle {
  return {
    vin: summary.vin,
    make: summary.make,
    model: summary.model,
    year: summary.year,
    mileage: summary.mileage,
    fuel_type: summary.fuel_type || undefined,
    transmission: summary.transmission || undefined,
    status: summary.status,
    trust_score: summary.trust_score,
    price: summary.price,
    currency: summary.currency,
    created_at: summary.created_at || undefined,
    location: summary.location || 'Zimbabwe',
    images: summary.primary_image_url ? [summary.primary_image_url] : undefined,
    plate_number: summary.plate_number || undefined,
    normalized_plate_number: summary.normalized_plate_number || undefined,
    chassis_number: summary.chassis_number || undefined,
    vehicle_condition_category: summary.condition_category,
    marketplace_tags: summary.marketplace_tags,
    passport_verified: summary.passport_verified,
    plate_status: summary.plate_status || undefined,
    plate_verified_at: summary.plate_verified ? summary.created_at || new Date(0).toISOString() : undefined,
    evidence_count: summary.evidence_count,
    partsentry_checked: summary.partsentry_checked,
    repair_history_count: summary.repair_history_count,
    verified_parts_count: summary.verified_parts_count,
    duty_paid: summary.duty_cleared,
    zimra_verified: summary.zimra_verified,
    police_verified: summary.cid_clear,
    cid_clear: summary.cid_clear,
    sellerType: summary.seller_type === 'dealer' ? 'Dealership' : 'Private Owner',
    sellerName: summary.seller_display_label,
    current_seller_type: summary.seller_type,
    public_seller_display_enabled: summary.seller_public_profile_enabled,
  }
}

export default function Marketplace() {
  const { fetchMarketplaceListings, fetchVehicles } = useCarUpApi()
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedMake, setSelectedMake] = useState('All')
  const [selectedCondition, setSelectedCondition] = useState('All')
  const [selectedFuel, setSelectedFuel] = useState('All')
  const [selectedTrans, setSelectedTrans] = useState('All')
  const [selectedLocation, setSelectedLocation] = useState('All')
  const [selectedCategoryChip, setSelectedCategoryChip] = useState('All')
  const [priceRange, setPriceRange] = useState([0, 100000])
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState('newest')

  useEffect(() => {
    setLoadingVehicles(true)
    fetchMarketplaceListings()
      .then((data) => {
        if (data && Array.isArray(data.listings)) {
          setLiveVehicles(data.listings.length > 0 ? data.listings.map(marketplaceSummaryToVehicle) : mockVehicles as unknown as Vehicle[])
        }
      })
      .catch(async (err) => {
        console.error('Failed to fetch marketplace listing summaries:', err)
        try {
          const data = await fetchVehicles()
          setLiveVehicles(data.length > 0 ? data : mockVehicles as unknown as Vehicle[])
        } catch (fallbackErr) {
          console.error('Failed to fetch marketplace vehicles:', fallbackErr)
          setLiveVehicles(mockVehicles as unknown as Vehicle[])
        }
      })
      .finally(() => setLoadingVehicles(false))
  }, [fetchMarketplaceListings, fetchVehicles])

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

  const filtered = liveVehicles.filter((v: Vehicle) => {
    const loc = v.location || ''
    const q = searchQuery.toLowerCase()
    const normalizedQuery = normalizePlate(searchQuery)
    const searchableText = [
      v.make,
      v.model,
      loc,
      v.vin,
      v.plate_number,
      v.normalized_plate_number,
      v.chassis_number,
      v.condition,
      v.category,
      v.sellerName,
      v.sellerType,
      v.current_seller_type,
      v.tenant?.name,
      hasPartSentrySignal(v) ? 'partsentry repair part history checked' : '',
      getRepairHistoryCount(v) > 0 ? 'repair history service logs work orders' : '',
    ].map(value => value || '').join(' ').toLowerCase()
    const matchSearch = !searchQuery ||
      searchableText.includes(q) ||
      normalizePlate(v.plate_number).includes(normalizedQuery) ||
      normalizePlate(v.normalized_plate_number).includes(normalizedQuery) ||
      normalizePlate(v.chassis_number).includes(normalizedQuery)
    const matchCat = selectedCategory === 'All' || v.category === selectedCategory
    const matchMarketplaceCategory = matchesCategoryChip(v, selectedCategoryChip)
    const matchMake = selectedMake === 'All' || v.make === selectedMake
    const matchCond = selectedCondition === 'All' || v.condition === selectedCondition
    const matchFuel = selectedFuel === 'All' || getFuelType(v) === selectedFuel
    const matchTrans = selectedTrans === 'All' || v.transmission === selectedTrans
    const matchLoc = selectedLocation === 'All' || loc === selectedLocation
    const matchPrice = (v.price || 0) >= priceRange[0] && (v.price || 0) <= priceRange[1]
    return matchSearch && matchCat && matchMarketplaceCategory && matchMake && matchCond && matchFuel && matchTrans && matchLoc && matchPrice
  })

  const sorted = [...filtered].sort((a: Vehicle, b: Vehicle) => {
    if (sortBy === 'price-low') return (a.price || 0) - (b.price || 0)
    if (sortBy === 'price-high') return (b.price || 0) - (a.price || 0)
    if (sortBy === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    if (sortBy === 'trust') return getTrustScore(b) - getTrustScore(a)
    return 0
  })

  const activeFilterCount = [
    selectedCategory !== 'All', selectedMake !== 'All', selectedCondition !== 'All',
    selectedFuel !== 'All', selectedTrans !== 'All', selectedLocation !== 'All',
    selectedCategoryChip !== 'All',
    priceRange[0] > 0 || priceRange[1] < 100000,
  ].filter(Boolean).length

  const resetFilters = () => {
    setSelectedCategory('All'); setSelectedMake('All'); setSelectedCondition('All')
    setSelectedFuel('All'); setSelectedTrans('All'); setSelectedLocation('All')
    setSelectedCategoryChip('All'); setPriceRange([0, 100000]); setSearchQuery('')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-8">
          <h1 className="text-3xl font-bold mb-2">Vehicle Marketplace</h1>
          <p className="text-gray-600">
            Browse {liveVehicles.length} verified vehicles across Zimbabwe, with parts and repair trust signals where data exists.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {/* Search & Sort Bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search make, model, location, VIN, plate, chassis, or seller type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="marketplace-search-input"
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

        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Marketplace categories</p>
              <p className="text-xs text-gray-500">
                Unsupported backend tags stay frontend-only or Phase 2B until real data exists.
              </p>
            </div>
            {selectedCategoryChip !== 'All' && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedCategoryChip('All')}>
                Clear category
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {['All', ...marketplaceCategoryChips].map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setSelectedCategoryChip(chip)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selectedCategoryChip === chip
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                }`}
                data-testid="marketplace-category-chip"
              >
                {chip}
              </button>
            ))}
          </div>
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
            {sorted.map((vehicle: Vehicle) => {
              const isFav = favorites.includes(vehicle.vin || '')
              const isReserved = vehicle.status === 'reserved' || vehicle.status === 'Reserved'
              const fallbackImage = 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=800'
              const primaryImage = vehicle.images?.[0] || vehicle.primary_image_url || fallbackImage
              const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
              const vehicleLabels = getVehicleLabels(vehicle)
              const cardLabels = vehicleLabels.filter(label => label !== 'Verified').slice(0, 4)
              const trustScore = getTrustScore(vehicle)
              const passportHref = `/marketplace/${encodeURIComponent(vehicle.vin || vehicle.id || '')}`
              const plateStatus = vehicle.plate_number
                ? vehicle.plate_verified_at ? 'Plate verified' : 'Plate on file'
                : ''
              return (
                <Link
                  key={vehicle.vin || vehicle.id || ''}
                  to={passportHref}
                  className="group"
                  data-testid="marketplace-view-passport"
                >
                  <Card className="overflow-hidden border-0 card-shadow hover-lift h-full bg-white" data-testid="marketplace-vehicle-card">
                    <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                      <img
                        src={primaryImage}
                        alt={vehicleName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                        {isVerifiedVehicle(vehicle) && (
                          <Badge className="bg-green-500 text-white text-[10px]" data-testid="marketplace-verified-badge">
                            <CheckCircle className="w-3 h-3 mr-1" /> Verified
                          </Badge>
                        )}
                        {trustScore > 90 && (
                          <Badge className="bg-orange-500 text-white text-[10px]">High Trust</Badge>
                        )}
                        {isReserved && (
                          <Badge className="bg-amber-500 text-white text-[10px]">Reserved</Badge>
                        )}
                        {hasPartSentrySignal(vehicle) && (
                          <Badge className="bg-purple-600 text-white text-[10px]" data-testid="marketplace-partsentry-badge">
                            PartSentry Checked
                          </Badge>
                        )}
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(e, vehicle.vin || vehicle.id || '', vehicleName)}
                        className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
                      >
                        <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                      </button>
                    </div>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-semibold text-sm line-clamp-1">{vehicleName}</h3>
                        {trustScore > 0 && (
                          <Badge variant="secondary" className="ml-2 shrink-0" data-testid="marketplace-trust-score">
                            Trust {trustScore}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xl font-bold text-orange-600">${(vehicle.price || 0).toLocaleString()}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(cardLabels.length > 0 ? cardLabels : [vehicle.condition || vehicle.category || 'Listed vehicle']).map(label => (
                          <Badge
                            key={label}
                            variant="outline"
                            className="border-gray-200 bg-gray-50 text-[10px] text-gray-700"
                            data-testid="marketplace-condition-tag"
                          >
                            {label}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{(vehicle.mileage || 0).toLocaleString()} km</span>
                        <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission || 'Auto'}</span>
                        <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{getFuelType(vehicle)}</span>
                      </div>
                      {plateStatus && (
                        <p className="mt-2 text-xs font-medium text-blue-700" data-testid="marketplace-plate-status">
                          {plateStatus}
                        </p>
                      )}
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 bg-gray-200 rounded-full" />
                          <span className="text-xs text-gray-600 line-clamp-1">{getSellerLabel(vehicle)}</span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <MapPin className="w-3 h-3" />{vehicle.location || 'Zimbabwe'}
                        </span>
                      </div>
                      <Button
                        asChild
                        className="mt-4 w-full bg-gray-950 text-white hover:bg-gray-800"
                      >
                        <span>View Passport</span>
                      </Button>
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
