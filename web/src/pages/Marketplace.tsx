import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
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
  Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  Search, SlidersHorizontal, CheckCircle, Heart, MapPin, Gauge, Fuel, Settings2, X, Loader2, ShieldCheck,
  GitCompare, Share2, Globe2,
} from 'lucide-react'
import { vehicles as mockVehicles, zimbabweLocations } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import type { MarketplaceListingSummary, Vehicle, MarketplaceInquiryType } from '@/types'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import { BuyerAssistantDrawer } from '@/components/marketplace/BuyerAssistantDrawer'

const DIASPORA_INQUIRY_TYPES: MarketplaceInquiryType[] = [
  'import_quote_request',
  'container_space_interest',
  'diaspora_vehicle_request',
  'diaspora_parts_request',
  'family_purchase_support',
]
const MAX_COMPARE = 4

async function shareListing(vin: string, name: string) {
  const url = `${window.location.origin}/marketplace/${encodeURIComponent(vin)}`
  try {
    if (navigator.share) {
      await navigator.share({ title: name, text: `Check out ${name} on CarUp`, url })
    } else {
      await navigator.clipboard.writeText(url)
      toast.success('Listing link copied to clipboard')
    }
  } catch {
    /* user cancelled share — ignore */
  }
}

// Mock listings are a DEV/demo convenience ONLY. In staging/production an empty or failed live result
// must NOT render fake cards — those link to nonexistent detail pages ("Vehicle Not Found"). Enable
// explicitly with VITE_MARKETPLACE_ALLOW_MOCK=true only for a backend-less demo.
const ALLOW_MOCK_LISTINGS =
  import.meta.env.DEV || import.meta.env.VITE_MARKETPLACE_ALLOW_MOCK === 'true'

/** Real listings when present; mock only when explicitly allowed; otherwise an honest empty list. */
export function withMockFallback<T>(live: T[], mock: T[], allowMock: boolean = ALLOW_MOCK_LISTINGS): T[] {
  if (live.length > 0) return live
  return allowMock ? mock : []
}
import {
  paramsToState,
  stateToParams,
  stateToApiFilters,
  getActiveFilterChips,
  getResultSummary,
  TRUST_QUICK_FILTERS,
  ALL,
} from '@/lib/marketplaceParams'
import type { MarketplaceUrlState, MarketplaceSort, ActiveFilterKey } from '@/lib/marketplaceParams'

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

interface FilterControlsProps {
  selectedMake: string
  setSelectedMake: (value: string) => void
  selectedCategory: string
  setSelectedCategory: (value: string) => void
  selectedCondition: string
  setSelectedCondition: (value: string) => void
  selectedLocation: string
  setSelectedLocation: (value: string) => void
  selectedFuel: string
  setSelectedFuel: (value: string) => void
  selectedTrans: string
  setSelectedTrans: (value: string) => void
  priceRange: number[]
  setPriceRange: (value: number[]) => void
}

/**
 * Advanced filter controls, shared by the desktop panel and the mobile drawer.
 * Note: make + price are part of the URL contract; category(body type)/condition/
 * location/fuel/transmission remain client-side refinements only (see marketplaceParams.ts).
 */
function FilterControls(props: FilterControlsProps) {
  const {
    selectedMake, setSelectedMake,
    selectedCategory, setSelectedCategory,
    selectedCondition, setSelectedCondition,
    selectedLocation, setSelectedLocation,
    selectedFuel, setSelectedFuel,
    selectedTrans, setSelectedTrans,
    priceRange, setPriceRange,
  } = props

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Make</label>
        <Select value={selectedMake} onValueChange={setSelectedMake}>
          <SelectTrigger data-testid="marketplace-make-filter"><SelectValue /></SelectTrigger>
          <SelectContent>{makes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Body type</label>
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
        <div className="flex items-center gap-2 mb-3">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min $"
            aria-label="Minimum price"
            data-testid="marketplace-price-min-filter"
            value={priceRange[0] > 0 ? priceRange[0] : ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              const min = Number.isFinite(n) && n > 0 ? Math.min(n, priceRange[1]) : 0
              setPriceRange([min, priceRange[1]])
            }}
          />
          <span className="text-gray-400">–</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="No max"
            aria-label="Maximum price"
            data-testid="marketplace-price-max-filter"
            value={priceRange[1] < 100000 ? priceRange[1] : ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              const max = Number.isFinite(n) && n > 0 ? Math.max(n, priceRange[0]) : 100000
              setPriceRange([priceRange[0], max])
            }}
          />
        </div>
        <Slider value={priceRange} onValueChange={setPriceRange} max={100000} step={1000} className="mt-1" />
      </div>
    </div>
  )
}

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams()

  const { fetchMarketplaceListings, fetchVehicles } = useCarUpApi()
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  // Capture referral/campaign/UTM attribution from the URL once, so a later inquiry can forward it.
  useEffect(() => { captureReferralFromUrl() }, [])

  // Compare selection (up to 4 listings) -> /marketplace/compare?vins=...
  const [compareVins, setCompareVins] = useState<string[]>([])
  const toggleCompare = useCallback((e: React.MouseEvent, vin: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCompareVins((prev) => {
      if (prev.includes(vin)) return prev.filter((v) => v !== vin)
      if (prev.length >= MAX_COMPARE) {
        toast.info(`You can compare up to ${MAX_COMPARE} listings.`)
        return prev
      }
      return [...prev, vin]
    })
  }, [])

  // The URL is the single source of truth for the shareable, structural filters. Deriving them
  // straight from searchParams means browser back/forward and deep-links update the page for free.
  const url = useMemo(() => paramsToState(searchParams), [searchParams])
  const selectedMake = url.selectedMake
  const selectedCategoryChip = url.selectedCategoryChip
  const sortBy = url.sortBy
  // Committed (URL) price drives the API fetch; the live `priceRange` draft below drives the slider
  // and instant client-side filtering. They diverge only while the user is dragging/typing.
  const committedMinPrice = url.priceRange[0]
  const committedMaxPrice = url.priceRange[1]

  // Free-flowing controls keep a local draft for instant feedback, mirrored to the URL on change.
  const [searchQuery, setSearchQuery] = useState(url.searchQuery)
  const [priceRange, setPriceRange] = useState<number[]>(url.priceRange)

  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)

  // Client-side-only refinements (not yet in the URL contract — see marketplaceParams.ts / Phase 6)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedCondition, setSelectedCondition] = useState('All')
  const [selectedFuel, setSelectedFuel] = useState('All')
  const [selectedTrans, setSelectedTrans] = useState('All')
  const [selectedLocation, setSelectedLocation] = useState('All')

  const [showFilters, setShowFilters] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  // Merge a filter patch into the URL. Structural changes (make/chip/sort) push a history entry so
  // back/forward step between filter states; free-text/price changes replace it to avoid history spam.
  const updateUrl = useCallback((patch: Partial<MarketplaceUrlState>, replace = false) => {
    setSearchParams(prev => stateToParams({ ...paramsToState(prev), ...patch }), { replace })
  }, [setSearchParams])

  const setMakeFilter = (value: string) => updateUrl({ selectedMake: value })
  const setChipFilter = (value: string) => updateUrl({ selectedCategoryChip: value })
  const setSortFilter = (value: string) => updateUrl({ sortBy: value as MarketplaceSort })
  const setSearchFilter = (value: string) => { setSearchQuery(value); updateUrl({ searchQuery: value }, true) }

  const filterState: MarketplaceUrlState = {
    searchQuery,
    selectedMake,
    selectedCategoryChip,
    priceRange: [priceRange[0], priceRange[1]],
    sortBy,
  }

  // Latest search text, read by the fetch effect so typing filters client-side instantly without a
  // network round-trip per keystroke.
  const searchQueryRef = useRef(searchQuery)
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])

  // Pull local drafts back into sync when the URL changes externally (back/forward, deep-links).
  // Functional updaters that return the previous value when unchanged stop our own writes from
  // clobbering in-progress typing (e.g. a trailing space the URL trims away).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSearchQuery(prev => (prev.trim() === url.searchQuery ? prev : url.searchQuery))
    setPriceRange(prev => (prev[0] === url.priceRange[0] && prev[1] === url.priceRange[1] ? prev : url.priceRange))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [url])

  // Phase 1.1: debounce price -> URL. Dragging the slider or editing the min/max inputs updates the
  // local `priceRange` instantly (live client-side filtering + slider position), but the committed
  // value is only written to the URL after a short pause — so price changes no longer fire an API
  // refetch on every drag tick / keystroke. The selected price still updates the URL and the results.
  useEffect(() => {
    if (priceRange[0] === url.priceRange[0] && priceRange[1] === url.priceRange[1]) return
    const timer = setTimeout(() => {
      updateUrl({ priceRange: [priceRange[0], priceRange[1]] }, true)
    }, 350)
    return () => clearTimeout(timer)
  }, [priceRange, url, updateUrl])

  // Re-fetch when backend-supported structural filters change (make/chip/sort + the COMMITTED price).
  // Search text (q) and the live price draft don't re-trigger this: q is read via a ref and price via
  // the committed URL value — so typing and dragging the price slider never fire a network request.
  useEffect(() => {
    let cancelled = false
    const apiFilters = stateToApiFilters({
      searchQuery: searchQueryRef.current,
      selectedMake,
      selectedCategoryChip,
      priceRange: [committedMinPrice, committedMaxPrice],
      sortBy,
    }) as Record<string, string | number | boolean | undefined>
    // Standard data-fetch loading reset: the listings API is an external system this effect drives.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingVehicles(true)
    setLoadError(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchMarketplaceListings(apiFilters)
      .then((data) => {
        if (cancelled) return
        if (data && Array.isArray(data.listings)) {
          setLiveVehicles(withMockFallback(data.listings.map(marketplaceSummaryToVehicle), mockVehicles as unknown as Vehicle[]))
        } else {
          setLiveVehicles(withMockFallback([], mockVehicles as unknown as Vehicle[]))
        }
      })
      .catch(async (err) => {
        if (cancelled) return
        console.error('Failed to fetch marketplace listing summaries:', err)
        try {
          const data = await fetchVehicles(apiFilters)
          if (cancelled) return
          setLiveVehicles(withMockFallback(data, mockVehicles as unknown as Vehicle[]))
          setLoadError(true)
        } catch (fallbackErr) {
          if (cancelled) return
          console.error('Failed to fetch marketplace vehicles:', fallbackErr)
          setLiveVehicles(withMockFallback([], mockVehicles as unknown as Vehicle[]))
          setLoadError(true)
        }
      })
      .finally(() => { if (!cancelled) setLoadingVehicles(false) })
    return () => { cancelled = true }
  }, [selectedMake, selectedCategoryChip, committedMinPrice, committedMaxPrice, sortBy, fetchMarketplaceListings, fetchVehicles])

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
  }, [setFavoritesState])

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
    setSelectedCategory('All'); setSelectedCondition('All')
    setSelectedFuel('All'); setSelectedTrans('All'); setSelectedLocation('All')
    setSearchQuery(''); setPriceRange([0, 100000])
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  const activeChips = getActiveFilterChips(filterState)
  const removeChip = (key: ActiveFilterKey) => {
    if (key === 'make') updateUrl({ selectedMake: ALL })
    else if (key === 'q') setSearchFilter('')
    else if (key === 'chip') updateUrl({ selectedCategoryChip: ALL })
    else if (key === 'price') updateUrl({ priceRange: [0, 100000] }, true)
    else if (key === 'sort') updateUrl({ sortBy: 'newest' })
  }

  const filterControls = (
    <FilterControls
      selectedMake={selectedMake} setSelectedMake={setMakeFilter}
      selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
      selectedCondition={selectedCondition} setSelectedCondition={setSelectedCondition}
      selectedLocation={selectedLocation} setSelectedLocation={setSelectedLocation}
      selectedFuel={selectedFuel} setSelectedFuel={setSelectedFuel}
      selectedTrans={selectedTrans} setSelectedTrans={setSelectedTrans}
      priceRange={priceRange} setPriceRange={setPriceRange}
    />
  )

  return (
    <div className="min-h-screen bg-gray-50" data-testid="marketplace-page">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-8">
          <h1 className="text-3xl font-bold mb-2">Vehicle Marketplace</h1>
          <p className="text-gray-600">
            Browse {liveVehicles.length} verified vehicles across Zimbabwe, with parts and repair trust signals where data exists.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="marketplace-entry-actions">
            <BuyerAssistantDrawer />
            <Button asChild variant="outline" data-testid="marketplace-parts-link">
              <Link to="/marketplace/parts">Parts</Link>
            </Button>
            <Button asChild variant="outline" data-testid="marketplace-services-link">
              <Link to="/marketplace/services">Garages &amp; Services</Link>
            </Button>
            <InquiryModal
              inquiryTypes={DIASPORA_INQUIRY_TYPES}
              defaultInquiryType="import_quote_request"
              triggerLabel="Import to Zimbabwe"
              triggerVariant="outline"
            />
            <span className="hidden items-center gap-1 text-xs text-gray-500 sm:flex">
              <Globe2 className="h-3.5 w-3.5 text-blue-500" /> Diaspora & import inquiries — no shipment data exposed
            </span>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-6">
        {/* Search & Sort Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search make, model, location, VIN, plate, chassis, or seller type..."
              value={searchQuery}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-10"
              data-testid="marketplace-search-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={setSortFilter}>
              <SelectTrigger className="w-[150px] sm:w-[170px]" data-testid="marketplace-sort-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="price-low">Price: Low to High</SelectItem>
                <SelectItem value="price-high">Price: High to Low</SelectItem>
                <SelectItem value="trust">Highest Trust Score</SelectItem>
              </SelectContent>
            </Select>

            {isMobile ? (
              <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" data-testid="marketplace-mobile-filter-button">
                    <SlidersHorizontal className="w-4 h-4 mr-2" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">{activeFilterCount}</Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[88%] max-w-sm overflow-y-auto"
                  data-testid="marketplace-mobile-filter-drawer"
                >
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="px-4 pb-2">
                    {filterControls}
                  </div>
                  <SheetFooter className="flex-row gap-2">
                    <Button variant="ghost" className="flex-1" onClick={resetFilters}>
                      Clear all
                    </Button>
                    <Button
                      className="flex-1 bg-orange-500 hover:bg-orange-600"
                      onClick={() => setMobileFiltersOpen(false)}
                      data-testid="marketplace-mobile-filter-close"
                    >
                      Show results
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            ) : (
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
            )}
          </div>
        </div>

        {/* Quick filters (trust tags + condition categories) */}
        <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5 text-orange-500" /> Trust filters
            <span className="font-normal text-gray-400">(pick one)</span>
          </span>
          {TRUST_QUICK_FILTERS.map(filter => {
            const active = selectedCategoryChip === filter.label
            return (
              <button
                key={filter.label}
                type="button"
                data-testid={filter.testId}
                aria-pressed={active}
                onClick={() => setChipFilter(active ? 'All' : filter.label)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
        </div>

        {/* Marketplace category taxonomy */}
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Browse by category <span className="font-normal text-gray-400">(pick one)</span></p>
              <p className="text-xs text-gray-500">
                One filter is active at a time — choosing a category or a trust filter above replaces the current selection. Use "Clear" to reset.
              </p>
            </div>
            {selectedCategoryChip !== 'All' && (
              <Button variant="ghost" size="sm" onClick={() => setChipFilter('All')}>
                Clear category
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {['All', ...marketplaceCategoryChips].map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setChipFilter(chip)}
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

        {/* Active filters */}
        {activeChips.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="marketplace-active-filters">
            <span className="text-xs font-medium text-gray-500">Active:</span>
            {activeChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeChip(chip.key)}
                data-testid="marketplace-active-filter-chip"
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-100"
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              data-testid="marketplace-clear-filters"
              className="text-xs text-gray-600"
            >
              Clear all
            </Button>
          </div>
        )}

        {/* Desktop Filters Panel */}
        {!isMobile && showFilters && (
          <Card className="mb-6 border-0 card-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Filters</h3>
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <X className="w-4 h-4 mr-1" /> Reset
                </Button>
              </div>
              <div data-testid="marketplace-filter-sidebar">
                {filterControls}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fallback notice */}
        {loadError && !loadingVehicles && (
          <div
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
            data-testid="marketplace-error-state"
          >
            Showing sample marketplace listings while live data is unavailable.
          </div>
        )}

        {/* Result summary + count */}
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-gray-800" data-testid="marketplace-results-summary">
            {getResultSummary(filterState)}
          </p>
          <p className="text-sm text-gray-600" data-testid="marketplace-results-count">
            {loadingVehicles
              ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading vehicles...</span>
              : <><span className="font-semibold">{sorted.length}</span> vehicles found</>
            }
          </p>
        </div>

        {/* Grid */}
        {loadingVehicles ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" data-testid="marketplace-loading-state">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20" data-testid="marketplace-empty-state">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No matching vehicles found</h3>
            <p className="text-gray-500 mb-4">Try removing a filter or broadening your search term.</p>
            <Button variant="outline" onClick={resetFilters}>Clear all filters</Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" data-testid="marketplace-results-grid">
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
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Add to compare"
                          aria-pressed={compareVins.includes(vehicle.vin || '')}
                          onClick={(e) => toggleCompare(e, vehicle.vin || '')}
                          data-testid="marketplace-compare-toggle"
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:scale-110 ${
                            compareVins.includes(vehicle.vin || '')
                              ? 'bg-orange-500 text-white opacity-100'
                              : 'bg-white/90 text-gray-600 opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <GitCompare className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Share listing"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); shareListing(vehicle.vin || '', vehicleName) }}
                          data-testid="marketplace-share-button"
                          className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 text-gray-600"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Save listing"
                          onClick={(e) => toggleFavorite(e, vehicle.vin || vehicle.id || '', vehicleName)}
                          className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
                        >
                          <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
                        </button>
                      </div>
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

      {/* Floating compare bar */}
      {compareVins.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-lg"
          data-testid="marketplace-compare-bar"
        >
          <span className="text-sm font-medium text-gray-700">{compareVins.length} selected to compare</span>
          <Button variant="ghost" size="sm" onClick={() => setCompareVins([])}>Clear</Button>
          <Button
            size="sm"
            className="bg-orange-500 hover:bg-orange-600"
            disabled={compareVins.length < 2}
            onClick={() => navigate(`/marketplace/compare?vins=${compareVins.join(',')}`)}
            data-testid="marketplace-compare-go"
          >
            <GitCompare className="mr-1 h-4 w-4" /> Compare
          </Button>
        </div>
      )}
    </div>
  )
}
