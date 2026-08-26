import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  Search,
  SlidersHorizontal,
  X,
  Loader2,
  ShieldCheck,
  GitCompare,
  Globe2,
  Sparkles,
  CarFront,
  Route,
  Wrench,
} from 'lucide-react'
import { vehicles as mockVehicles, zimbabweLocations } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import type { MarketplaceListingSummary, Vehicle, MarketplaceInquiryType } from '@/types'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import { summaryLocationLine } from '@/lib/governedLocation'
import { InquiryModal } from '@/components/marketplace/InquiryModal'
import { BuyerAssistantDrawer } from '@/components/marketplace/BuyerAssistantDrawer'
import {
  MarketplaceListingCard,
  type MarketplaceCardTrust,
  type MarketplaceListingCardModel,
} from '@/components/marketplace/MarketplaceListingCard'
import {
  paramsToState,
  stateToParams,
  stateToApiFilters,
  getActiveFilterChips,
  getResultSummary,
  TRUST_QUICK_FILTERS,
  CATEGORY_CHIPS,
  TRUST_TAG_CHIPS,
  isCategoryChip,
  ALL,
} from '@/lib/marketplaceParams'
import type { MarketplaceUrlState, MarketplaceSort, ActiveFilterKey } from '@/lib/marketplaceParams'

const DIASPORA_INQUIRY_TYPES: MarketplaceInquiryType[] = [
  'import_quote_request',
  'container_space_interest',
  'diaspora_vehicle_request',
  'diaspora_parts_request',
  'family_purchase_support',
]

const MAX_COMPARE = 4
const categories = ['All', 'Sedan', 'SUV', 'Hatchback', 'Pickup', 'Luxury', 'Commercial']
const conditions = ['All', 'New', 'Used', 'Certified Pre-Owned']
const makes = ['All', 'Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Mazda', 'Volkswagen', 'Ford', 'Honda', 'Land Rover', 'Audi']
const fuelTypes = ['All', 'Petrol', 'Diesel', 'Hybrid', 'Electric']
const transmissions = ['All', 'Automatic', 'Manual']
const CONDITION_CHIPS = [...CATEGORY_CHIPS, 'Parts & Accessories']
const TRUST_CHIPS = TRUST_TAG_CHIPS

const ALLOW_MOCK_LISTINGS = import.meta.env.DEV || import.meta.env.VITE_MARKETPLACE_ALLOW_MOCK === 'true'

/** Real listings when present; mock only when explicitly allowed; otherwise an honest empty list. */
export function withMockFallback<T>(live: T[], mock: T[], allowMock: boolean = ALLOW_MOCK_LISTINGS): T[] {
  if (live.length > 0) return live
  return allowMock ? mock : []
}

type TrustRanking = { requested?: string; applied?: string; note?: string }
type MarketplaceCardVehicle = Vehicle & {
  plate_verified?: boolean
  canonicalTrust?: MarketplaceCardTrust | null
  reservation_summary?: { state?: string; reserved?: boolean | null }
  primary_image_state?: string | null
}
type MarketplaceListingSummaryWire = MarketplaceListingSummary & { trust?: MarketplaceCardTrust | null }

function readTrustRanking(payload: unknown): TrustRanking | null {
  const ranking = (payload as { ranking?: unknown } | null | undefined)?.ranking
  if (!ranking || typeof ranking !== 'object' || Array.isArray(ranking)) return null
  const value = ranking as Record<string, unknown>
  return {
    requested: typeof value.requested === 'string' ? value.requested : undefined,
    applied: typeof value.applied === 'string' ? value.applied : undefined,
    note: typeof value.note === 'string' ? value.note : undefined,
  }
}

function normalizeText(value?: string | null) {
  return (value || '').toLowerCase()
}

function getFuelType(vehicle: Vehicle): string | null {
  return vehicle.fuel_type || vehicle.fuelType || null
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
  return Boolean(candidate.partsentry_checked || candidate.partSentryChecked || candidate.partsentry_status === 'checked')
}

function hasVerifiedParts(vehicle: Vehicle) {
  return Boolean(vehicle.verified_parts_count || vehicle.parts?.some(part => part.type === 'OEM'))
}

function getSellerLabel(vehicle: Vehicle): string {
  const label = normalizeText(vehicle.sellerName)
  return label ? (vehicle.sellerName as string) : 'Seller not disclosed'
}

function getPlateStatusLabel(vehicle: Vehicle) {
  if ((vehicle as MarketplaceCardVehicle).plate_verified) return 'Plate confirmed'
  if (normalizeText(vehicle.plate_status)) return 'Plate on file'
  return 'Plate status unknown'
}

function getVehicleLabels(vehicle: Vehicle) {
  const labels: string[] = []
  const condition = normalizeText(vehicle.condition)
  const conditionCategory = normalizeText(vehicle.vehicle_condition_category)
  const importSource = normalizeText((vehicle as Vehicle & { import_source?: string }).import_source)
  const registrationCountry = normalizeText(vehicle.registration_country)

  if (condition === 'new' || conditionCategory === 'brand_new') labels.push('Brand New')
  if (condition === 'used' || conditionCategory === 'second_hand') labels.push('Second Hand')
  if (condition === 'certified pre-owned' || conditionCategory === 'certified_dealer') labels.push('Certified Pre-Owned')
  if ((vehicle as MarketplaceCardVehicle).plate_verified) labels.push('Plate Confirmed')
  if ((vehicle as Vehicle & { passport_verified?: boolean }).passport_verified) labels.push('Evidence Reviewed')
  if (importSource || conditionCategory === 'recently_imported') labels.push('Recently Imported', 'Fresh Import')
  if (registrationCountry === 'zimbabwe' || registrationCountry === 'zw' || conditionCategory === 'locally_used') labels.push('Locally Used')
  if (typeof vehicle.mileage === 'number' && vehicle.mileage > 0 && vehicle.mileage <= 50000) labels.push('Low Mileage')
  if (getVehicleEvidenceCount(vehicle) > 0) labels.push('Evidence Available')
  if (hasPartSentrySignal(vehicle)) labels.push('PartSentry Checked')
  if (getRepairHistoryCount(vehicle) > 0) labels.push('Repair History Available')
  if (hasVerifiedParts(vehicle)) labels.push('Verified Parts')

  const backendTags = vehicle.marketplace_tags || []
  const backendTagLabels = backendTags.map(tag => tag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '))
  return Array.from(new Set([...labels, ...backendTagLabels]))
}

function matchesConditionChip(vehicle: Vehicle, chip: string) {
  if (chip === 'All' || chip === 'Parts & Accessories') return true
  return getVehicleLabels(vehicle).includes(chip)
}

function matchesAllTrustTags(vehicle: Vehicle, tags: string[]) {
  if (!tags.length) return true
  const labels = getVehicleLabels(vehicle)
  return tags.every(tag => labels.includes(tag))
}

function marketplaceSummaryToVehicle(summary: MarketplaceListingSummary): MarketplaceCardVehicle {
  const wire = summary as MarketplaceListingSummaryWire
  return {
    vin: summary.vin,
    make: summary.make,
    model: summary.model,
    year: summary.year,
    mileage: summary.mileage,
    fuel_type: summary.fuel_type || undefined,
    transmission: summary.transmission || undefined,
    status: summary.status || undefined,
    // Vehicle's legacy type still requires this field. It is carried only for compatibility and is
    // never rendered or ranked by this page. Canonical public Trust lives on `wire.trust`.
    trust_score: summary.trust_score,
    price: summary.price,
    currency: summary.currency,
    created_at: summary.created_at || undefined,
    location: summary.location || undefined,
    location_state: summary.location_state,
    images: summary.primary_image_url ? [summary.primary_image_url] : undefined,
    primary_image_state: summary.primary_image_state,
    vehicle_condition_category: summary.condition_category,
    marketplace_tags: summary.marketplace_tags,
    passport_verified: summary.passport_verified,
    plate_status: summary.plate_status || undefined,
    plate_verified: summary.plate_verified,
    evidence_count: summary.evidence_count,
    partsentry_checked: summary.partsentry_checked,
    repair_history_count: summary.repair_history_count,
    verified_parts_count: summary.verified_parts_count,
    duty_paid: summary.duty_cleared,
    zimra_verified: summary.zimra_verified,
    police_verified: summary.cid_clear,
    cid_clear: summary.cid_clear,
    sellerType: summary.seller_type === 'dealer' ? 'Dealership' : (summary.seller_type ? 'Private Owner' : undefined),
    sellerName: summary.seller_display_label || undefined,
    current_seller_type: summary.seller_type,
    public_seller_display_enabled: summary.seller_public_profile_enabled,
    canonicalTrust: wire.trust || null,
    reservation_summary: summary.reservation_summary,
  } as MarketplaceCardVehicle
}

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
    // User cancelled the native share sheet.
  }
}

function getFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem('carup_favorites') || '[]')
  } catch {
    return []
  }
}

function setFavorites(ids: string[]) {
  localStorage.setItem('carup_favorites', JSON.stringify(ids))
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
    <div className="grid gap-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Make</label>
        <Select value={selectedMake} onValueChange={setSelectedMake}>
          <SelectTrigger data-testid="marketplace-make-filter" className="bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{makes.map(make => <SelectItem key={make} value={make}>{make}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Body type</label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Condition</label>
          <Select value={selectedCondition} onValueChange={setSelectedCondition}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{conditions.map(condition => <SelectItem key={condition} value={condition}>{condition}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Location</label>
        <Select value={selectedLocation} onValueChange={setSelectedLocation}>
          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All locations</SelectItem>
            {zimbabweLocations.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Fuel</label>
          <Select value={selectedFuel} onValueChange={setSelectedFuel}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{fuelTypes.map(fuel => <SelectItem key={fuel} value={fuel}>{fuel}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Transmission</label>
          <Select value={selectedTrans} onValueChange={setSelectedTrans}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{transmissions.map(transmission => <SelectItem key={transmission} value={transmission}>{transmission}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price</label>
          <span className="text-[11px] font-medium text-slate-500">
            ${priceRange[0].toLocaleString()} – {priceRange[1] >= 100000 ? 'Any max' : `$${priceRange[1].toLocaleString()}`}
          </span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min $"
            aria-label="Minimum price"
            data-testid="marketplace-price-min-filter"
            value={priceRange[0] > 0 ? priceRange[0] : ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              const min = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, priceRange[1]) : 0
              setPriceRange([min, priceRange[1]])
            }}
          />
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="No max"
            aria-label="Maximum price"
            data-testid="marketplace-price-max-filter"
            value={priceRange[1] < 100000 ? priceRange[1] : ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              const max = Number.isFinite(parsed) && parsed > 0 ? Math.max(parsed, priceRange[0]) : 100000
              setPriceRange([priceRange[0], max])
            }}
          />
        </div>
        <Slider value={priceRange} onValueChange={setPriceRange} max={100000} step={1000} />
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white animate-pulse">
      <div className="aspect-[16/10] bg-slate-200" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="h-6 w-1/2 rounded bg-slate-200" />
        <div className="h-16 rounded-xl bg-slate-100" />
        <div className="h-9 rounded bg-slate-200" />
      </div>
    </div>
  )
}

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    fetchMarketplaceListings,
    fetchVehicles,
    saveMarketplaceListing,
    unsaveMarketplaceListing,
    fetchSavedMarketplaceListings,
  } = useCarUpApi()
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  useEffect(() => { captureReferralFromUrl() }, [])

  const [compareVins, setCompareVins] = useState<string[]>([])
  const [liveVehicles, setLiveVehicles] = useState<MarketplaceCardVehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [trustRanking, setTrustRanking] = useState<TrustRanking | null>(null)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const url = useMemo(() => paramsToState(searchParams), [searchParams])
  const selectedMake = url.selectedMake
  const marketplaceCategory = url.selectedCategory
  const trustTags = url.selectedTags
  const sortBy = url.sortBy
  const committedSearchQuery = url.searchQuery
  const committedMinPrice = url.priceRange[0]
  const committedMaxPrice = url.priceRange[1]

  const [searchQuery, setSearchQuery] = useState(url.searchQuery)
  const [priceRange, setPriceRange] = useState<number[]>(url.priceRange)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedCondition, setSelectedCondition] = useState('All')
  const [selectedFuel, setSelectedFuel] = useState('All')
  const [selectedTrans, setSelectedTrans] = useState('All')
  const [selectedLocation, setSelectedLocation] = useState('All')

  const updateUrl = useCallback((patch: Partial<MarketplaceUrlState>, replace = false) => {
    setSearchParams(prev => stateToParams({ ...paramsToState(prev), ...patch }), { replace })
  }, [setSearchParams])

  const mutateUrl = useCallback((mutate: (state: MarketplaceUrlState) => Partial<MarketplaceUrlState>, replace = false) => {
    const current = paramsToState(new URLSearchParams(window.location.search))
    setSearchParams(stateToParams({ ...current, ...mutate(current) }), { replace })
  }, [setSearchParams])

  const setMakeFilter = (value: string) => updateUrl({ selectedMake: value })
  const setCategoryFilter = (value: string) => mutateUrl(state => ({ selectedCategory: state.selectedCategory === value ? ALL : value }))
  const toggleTrustTag = (label: string) => mutateUrl(state => ({
    selectedTags: state.selectedTags.includes(label)
      ? state.selectedTags.filter(tag => tag !== label)
      : [...state.selectedTags, label],
  }))
  const setSortFilter = (value: string) => updateUrl({ sortBy: value as MarketplaceSort })

  // Browser back/forward and copied deep links always win over local drafts.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSearchQuery(previous => (previous.trim() === url.searchQuery ? previous : url.searchQuery))
    setPriceRange(previous => (
      previous[0] === url.priceRange[0] && previous[1] === url.priceRange[1] ? previous : url.priceRange
    ))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [url])

  // Search is both instant on the currently loaded page AND committed to the URL/API after a short
  // pause. The previous implementation never re-fetched on q, so a match outside the first page of
  // results could not be found even though the backend supports q. This closes that reliability gap.
  useEffect(() => {
    if (searchQuery.trim() === url.searchQuery) return
    const timer = setTimeout(() => {
      mutateUrl(() => ({ searchQuery: searchQuery.trim() }), true)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, url.searchQuery, mutateUrl])

  useEffect(() => {
    if (priceRange[0] === url.priceRange[0] && priceRange[1] === url.priceRange[1]) return
    const timer = setTimeout(() => {
      mutateUrl(() => ({ priceRange: [priceRange[0], priceRange[1]] }), true)
    }, 350)
    return () => clearTimeout(timer)
  }, [priceRange, url.priceRange, mutateUrl])

  // Account-scoped saved listings for authenticated users; browser-local only for guests.
  useEffect(() => {
    if (!isAuthenticated) {
      setFavoritesState(getFavorites())
      return
    }
    let active = true
    fetchSavedMarketplaceListings()
      .then(response => {
        if (active) setFavoritesState((response.listings || []).map(listing => listing.vin).filter(Boolean))
      })
      .catch(() => { /* retain current view; never copy authed state to guest localStorage */ })
    return () => { active = false }
  }, [isAuthenticated, fetchSavedMarketplaceListings])

  // Structural/public filters are re-evaluated by the backend. Search q is deliberately included so
  // discovery is not limited to whichever page happened to be loaded before the buyer typed.
  useEffect(() => {
    let cancelled = false
    const apiFilters = stateToApiFilters({
      searchQuery: committedSearchQuery,
      selectedMake,
      selectedCategory: marketplaceCategory,
      selectedTags: trustTags,
      priceRange: [committedMinPrice, committedMaxPrice],
      sortBy,
    }) as Record<string, string | number | boolean | undefined>

    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingVehicles(true)
    setLoadError(false)
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchMarketplaceListings(apiFilters)
      .then((data) => {
        if (cancelled) return
        setTrustRanking(readTrustRanking(data))
        if (data && Array.isArray(data.listings)) {
          setLiveVehicles(withMockFallback(
            data.listings.map(marketplaceSummaryToVehicle),
            mockVehicles as unknown as MarketplaceCardVehicle[],
          ))
        } else {
          setLiveVehicles(withMockFallback([], mockVehicles as unknown as MarketplaceCardVehicle[]))
        }
      })
      .catch(async (error) => {
        if (cancelled) return
        console.error('Failed to fetch marketplace listing summaries:', error)
        setTrustRanking(null)
        try {
          const data = await fetchVehicles(apiFilters)
          if (cancelled) return
          setLiveVehicles(withMockFallback(data as MarketplaceCardVehicle[], mockVehicles as unknown as MarketplaceCardVehicle[]))
          setLoadError(true)
        } catch (fallbackError) {
          if (cancelled) return
          console.error('Failed to fetch marketplace vehicles:', fallbackError)
          setLiveVehicles(withMockFallback([], mockVehicles as unknown as MarketplaceCardVehicle[]))
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVehicles(false)
      })

    return () => { cancelled = true }
  }, [
    selectedMake,
    marketplaceCategory,
    trustTags,
    committedSearchQuery,
    committedMinPrice,
    committedMaxPrice,
    sortBy,
    fetchMarketplaceListings,
    fetchVehicles,
  ])

  const toggleCompare = useCallback((event: React.MouseEvent, vin: string) => {
    event.preventDefault()
    event.stopPropagation()
    setCompareVins(previous => {
      if (previous.includes(vin)) return previous.filter(value => value !== vin)
      if (previous.length >= MAX_COMPARE) {
        toast.info(`You can compare up to ${MAX_COMPARE} listings.`)
        return previous
      }
      return [...previous, vin]
    })
  }, [])

  const toggleFavorite = useCallback(async (event: React.MouseEvent, vin: string, vehicleName: string) => {
    event.preventDefault()
    event.stopPropagation()
    const isSaved = favorites.includes(vin)
    const optimistic = isSaved ? favorites.filter(id => id !== vin) : [...favorites, vin]

    if (isAuthenticated) {
      const previous = favorites
      setFavoritesState(optimistic)
      try {
        if (isSaved) {
          await unsaveMarketplaceListing(vin)
          toast.info('Removed from saved cars')
        } else {
          await saveMarketplaceListing(vin)
          toast.success(`${vehicleName} saved!`)
        }
      } catch {
        setFavoritesState(previous)
        toast.error('Could not update saved cars. Please try again.')
      }
      return
    }

    setFavorites(optimistic)
    setFavoritesState(optimistic)
    toast[isSaved ? 'info' : 'success'](isSaved ? 'Removed from saved cars' : `${vehicleName} saved!`)
  }, [favorites, isAuthenticated, saveMarketplaceListing, unsaveMarketplaceListing])

  const filtered = liveVehicles.filter((vehicle) => {
    const location = vehicle.location || ''
    const query = searchQuery.trim().toLowerCase()
    // Public discovery can use VIN, but never plate/chassis because those identifiers are not in the
    // public listing contract and the grid must not become an anonymous registry oracle.
    const searchableText = [
      vehicle.make,
      vehicle.model,
      location,
      vehicle.vin,
      vehicle.condition,
      vehicle.category,
      vehicle.sellerName,
      vehicle.sellerType,
      vehicle.current_seller_type,
      vehicle.tenant?.name,
      hasPartSentrySignal(vehicle) ? 'partsentry repair part history checked' : '',
      getRepairHistoryCount(vehicle) > 0 ? 'repair history service logs work orders' : '',
    ].map(value => value || '').join(' ').toLowerCase()

    const matchSearch = !query || searchableText.includes(query)
    const matchBody = selectedCategory === 'All' || vehicle.category === selectedCategory
    const matchMarketplaceCategory = matchesConditionChip(vehicle, marketplaceCategory)
    const matchTrustTags = matchesAllTrustTags(vehicle, trustTags)
    const matchMake = selectedMake === 'All' || vehicle.make === selectedMake
    const matchCondition = selectedCondition === 'All' || vehicle.condition === selectedCondition
    const matchFuel = selectedFuel === 'All' || getFuelType(vehicle) === selectedFuel
    const matchTransmission = selectedTrans === 'All' || vehicle.transmission === selectedTrans
    const matchLocation = selectedLocation === 'All' || location === selectedLocation
    const numericPrice = typeof vehicle.price === 'number' && Number.isFinite(vehicle.price) ? vehicle.price : null
    const matchPrice = numericPrice === null
      ? priceRange[0] === 0 && priceRange[1] === 100000
      : numericPrice >= priceRange[0] && numericPrice <= priceRange[1]

    return matchSearch && matchBody && matchMarketplaceCategory && matchTrustTags && matchMake
      && matchCondition && matchFuel && matchTransmission && matchLocation && matchPrice
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'price-low') return (a.price || 0) - (b.price || 0)
    if (sortBy === 'price-high') return (b.price || 0) - (a.price || 0)
    if (sortBy === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    // Trust order belongs to the backend canonical authority. Preserve the returned order.
    return 0
  })

  const filterState: MarketplaceUrlState = {
    searchQuery,
    selectedMake,
    selectedCategory: marketplaceCategory,
    selectedTags: trustTags,
    priceRange: [priceRange[0], priceRange[1]],
    sortBy,
  }

  const activeFilterCount = [
    selectedCategory !== 'All',
    selectedMake !== 'All',
    selectedCondition !== 'All',
    selectedFuel !== 'All',
    selectedTrans !== 'All',
    selectedLocation !== 'All',
    marketplaceCategory !== 'All',
    priceRange[0] > 0 || priceRange[1] < 100000,
  ].filter(Boolean).length + trustTags.length

  const resetFilters = () => {
    setSelectedCategory('All')
    setSelectedCondition('All')
    setSelectedFuel('All')
    setSelectedTrans('All')
    setSelectedLocation('All')
    setSearchQuery('')
    setPriceRange([0, 100000])
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  const activeChips = getActiveFilterChips(filterState)
  const removeChip = (key: ActiveFilterKey, value?: string) => {
    if (key === 'make') updateUrl({ selectedMake: ALL })
    else if (key === 'q') {
      setSearchQuery('')
      updateUrl({ searchQuery: '' }, true)
    } else if (key === 'category') updateUrl({ selectedCategory: ALL })
    else if (key === 'tag') mutateUrl(state => ({ selectedTags: state.selectedTags.filter(tag => tag !== value) }))
    else if (key === 'price') {
      setPriceRange([0, 100000])
      updateUrl({ priceRange: [0, 100000] }, true)
    } else if (key === 'sort') updateUrl({ sortBy: 'newest' })
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

  const taxonomyControls = (
    <div className="space-y-5">
      <div data-testid="marketplace-condition-group">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Vehicle condition</p>
            <p className="mt-0.5 text-xs leading-4 text-slate-500">Choose one classification.</p>
          </div>
          {marketplaceCategory !== ALL && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => updateUrl({ selectedCategory: ALL })} data-testid="marketplace-clear-condition">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['All', ...CONDITION_CHIPS].map(chip => {
            const active = chip === 'All' ? marketplaceCategory === ALL : marketplaceCategory === chip
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => (chip === 'All' ? updateUrl({ selectedCategory: ALL }) : setCategoryFilter(chip))}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? 'border-orange-500 bg-orange-50 text-orange-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'
                }`}
                data-testid="marketplace-category-chip"
              >
                {chip}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-5" data-testid="marketplace-trust-group">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-orange-600" /> Trust signals
            </p>
            <p className="mt-0.5 text-xs leading-4 text-slate-500">Stack filters; every selected signal must match.</p>
          </div>
          {trustTags.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => updateUrl({ selectedTags: [] })} data-testid="marketplace-clear-trust">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRUST_CHIPS.map(chip => {
            const active = trustTags.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTrustTag(chip)}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? 'border-orange-500 bg-orange-50 text-orange-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'
                }`}
                data-testid="marketplace-trust-chip"
              >
                {chip}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-950" data-testid="marketplace-page">
      <section className="border-b border-slate-800 bg-[#0b1220] text-white">
        <div className="section-padding mx-auto max-w-[1440px] py-8 sm:py-10">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">
                <CarFront className="h-4 w-4" /> CarUp Marketplace
              </div>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                Find the right car. Know what CarUp knows.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Shop published vehicles with clear pricing, governed vehicle facts and canonical Trust states — without turning unknown data into a claim.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="marketplace-entry-actions">
                <BuyerAssistantDrawer />
                <Button asChild variant="outline" className="border-slate-600 bg-transparent text-white hover:bg-slate-800 hover:text-white" data-testid="marketplace-parts-link">
                  <Link to="/marketplace/parts"><Wrench className="mr-2 h-4 w-4" />Parts</Link>
                </Button>
                <Button asChild variant="outline" className="border-slate-600 bg-transparent text-white hover:bg-slate-800 hover:text-white" data-testid="marketplace-services-link">
                  <Link to="/marketplace/services"><Route className="mr-2 h-4 w-4" />Garages &amp; Services</Link>
                </Button>
                <InquiryModal
                  inquiryTypes={DIASPORA_INQUIRY_TYPES}
                  defaultInquiryType="import_quote_request"
                  triggerLabel="Import to Zimbabwe"
                  triggerVariant="outline"
                />
              </div>
            </div>

            <div className="border-l-2 border-orange-500 pl-4 lg:mb-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-orange-400" /> Trust is evidence-led
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-400">
                A numerical score appears only when the canonical Trust service says the vehicle is evaluated. Legacy scores are never substituted.
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                <Globe2 className="h-3.5 w-3.5 text-sky-400" /> Zimbabwe + Diaspora buying journeys
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="section-padding mx-auto max-w-[1440px] py-5 sm:py-7">
        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search make, model, VIN, location or seller..."
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-11 border-slate-200 bg-slate-50 pl-10 text-sm focus-visible:ring-orange-500"
                data-testid="marketplace-search-input"
              />
            </div>

            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortFilter}>
                <SelectTrigger className="h-11 min-w-[170px] border-slate-200 bg-white" data-testid="marketplace-sort-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="price-low">Price: low to high</SelectItem>
                  <SelectItem value="price-high">Price: high to low</SelectItem>
                  <SelectItem value="trust">Highest canonical Trust</SelectItem>
                </SelectContent>
              </Select>

              {isMobile && (
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" className="h-11 border-slate-200" data-testid="marketplace-mobile-filter-button">
                      <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
                      {activeFilterCount > 0 && <Badge className="ml-2 bg-slate-950 text-[10px] text-white">{activeFilterCount}</Badge>}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[92%] max-w-sm overflow-y-auto bg-[#f8fafc]" data-testid="marketplace-mobile-filter-drawer">
                    <SheetHeader>
                      <SheetTitle>Refine vehicles</SheetTitle>
                    </SheetHeader>
                    <div className="space-y-6 px-4 pb-4">
                      {filterControls}
                      <div className="border-t border-slate-200 pt-5">{taxonomyControls}</div>
                    </div>
                    <SheetFooter className="sticky bottom-0 flex-row gap-2 border-t border-slate-200 bg-white p-4">
                      <Button variant="ghost" className="flex-1" onClick={resetFilters}>Clear all</Button>
                      <Button className="flex-1 bg-orange-600 hover:bg-orange-700" onClick={() => setMobileFiltersOpen(false)} data-testid="marketplace-mobile-filter-close">
                        Show results
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1" data-testid="marketplace-quick-filters">
            <span className="flex shrink-0 items-center gap-1.5 pr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-orange-600" /> Quick filters
            </span>
            {TRUST_QUICK_FILTERS.map(filter => {
              const isCategory = isCategoryChip(filter.label)
              const active = isCategory ? marketplaceCategory === filter.label : trustTags.includes(filter.label)
              return (
                <button
                  key={filter.label}
                  type="button"
                  data-testid={filter.testId}
                  aria-pressed={active}
                  onClick={() => (isCategory ? setCategoryFilter(filter.label) : toggleTrustTag(filter.label))}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'border-orange-500 bg-orange-50 text-orange-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'
                  }`}
                >
                  {filter.label}
                </button>
              )
            })}
          </div>
        </section>

        {activeChips.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="marketplace-active-filters">
            <span className="text-xs font-medium text-slate-500">Active</span>
            {activeChips.map(chip => (
              <button
                key={`${chip.key}:${chip.value ?? chip.label}`}
                type="button"
                onClick={() => removeChip(chip.key, chip.value)}
                data-testid="marketplace-active-filter-chip"
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 transition hover:bg-orange-100"
              >
                {chip.label}<X className="h-3 w-3" />
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="marketplace-clear-filters" className="h-7 text-xs text-slate-600">
              Clear all
            </Button>
          </div>
        )}

        <div className="mt-5 grid gap-6 lg:grid-cols-[270px_minmax(0,1fr)]">
          {!isMobile && (
            <aside className="self-start rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4" aria-label="Marketplace filters">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Refine vehicles</p>
                  <p className="mt-0.5 text-xs text-slate-500">Fast filters, without hiding uncertainty.</p>
                </div>
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="bg-slate-100 text-slate-700">{activeFilterCount}</Badge>
                )}
              </div>
              <div data-testid="marketplace-filter-sidebar" className="space-y-6">
                {filterControls}
                <div className="border-t border-slate-200 pt-5">{taxonomyControls}</div>
              </div>
              <Button variant="outline" className="mt-5 w-full" onClick={resetFilters}>Reset filters</Button>
            </aside>
          )}

          <main className="min-w-0">
            {loadError && !loadingVehicles && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900" data-testid="marketplace-error-state">
                The listing-summary service was unavailable. CarUp is showing the safe vehicle fallback where available; no private fields or fabricated cards are added.
              </div>
            )}

            {!loadingVehicles && trustRanking?.requested === 'trust' && trustRanking.applied !== 'trust' && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600" data-testid="marketplace-trust-ranking-notice">
                {trustRanking.note || 'No listing on this page carries a canonical Trust evaluation, so these results are not ordered by Trust.'}
              </div>
            )}

            <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800" data-testid="marketplace-results-summary">{getResultSummary(filterState)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Published listings only. Trust and vehicle facts retain their governed states.
                </p>
              </div>
              <p className="text-sm text-slate-600" data-testid="marketplace-results-count">
                {loadingVehicles
                  ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading vehicles…</span>
                  : <><span className="font-semibold text-slate-950">{sorted.length}</span> {sorted.length === 1 ? 'vehicle' : 'vehicles'} found</>
                }
              </p>
            </div>

            {loadingVehicles ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="marketplace-loading-state">
                {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center" data-testid="marketplace-empty-state">
                <Search className="mx-auto mb-4 h-10 w-10 text-slate-300" />
                <h3 className="text-lg font-semibold text-slate-900">No matching vehicles</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Broaden the search or remove one of the active filters. CarUp will not fill an empty result with demo inventory.
                </p>
                <Button variant="outline" className="mt-5" onClick={resetFilters}>Clear all filters</Button>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="marketplace-results-grid">
                {sorted.map(vehicle => {
                  const vin = vehicle.vin || vehicle.id || ''
                  const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
                  const labels = getVehicleLabels(vehicle)
                  const href = `/marketplace/${encodeURIComponent(vin)}`
                  const reservationReserved = vehicle.reservation_summary?.reserved === true
                  const statusReserved = vehicle.status === 'reserved' || vehicle.status === 'Reserved'
                  const model: MarketplaceListingCardModel = {
                    vin,
                    name: vehicleName,
                    price: typeof vehicle.price === 'number' && Number.isFinite(vehicle.price) ? vehicle.price : null,
                    currency: typeof vehicle.currency === 'string' && vehicle.currency.trim() ? vehicle.currency : null,
                    primaryImage: vehicle.images?.[0] || vehicle.primary_image_url || null,
                    primaryImageState: vehicle.primary_image_state || null,
                    mileage: typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) ? vehicle.mileage : null,
                    transmission: vehicle.transmission || null,
                    fuel: getFuelType(vehicle),
                    sellerLabel: getSellerLabel(vehicle),
                    locationLabel: summaryLocationLine(vehicle.location, vehicle.location_state).label,
                    plateStatus: getPlateStatusLabel(vehicle),
                    plateVerified: Boolean(vehicle.plate_verified),
                    reserved: reservationReserved || statusReserved,
                    partSentryChecked: hasPartSentrySignal(vehicle),
                    labels: labels.length > 0 ? labels : [vehicle.condition || vehicle.category || 'Published listing'],
                    trust: vehicle.canonicalTrust || null,
                  }

                  return (
                    <MarketplaceListingCard
                      key={vin}
                      vehicle={model}
                      href={href}
                      isFavorite={favorites.includes(vin)}
                      isCompared={compareVins.includes(vin)}
                      onFavorite={event => toggleFavorite(event, vin, vehicleName)}
                      onCompare={event => toggleCompare(event, vin)}
                      onShare={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        shareListing(vin, vehicleName)
                      }}
                    />
                  )
                })}
              </div>
            )}
          </main>
        </div>
      </div>

      {compareVins.length > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_18px_50px_rgba(15,23,42,0.20)] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:rounded-full sm:px-4" data-testid="marketplace-compare-bar">
          <span className="min-w-0 truncate text-sm font-medium text-slate-700">{compareVins.length} selected to compare</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setCompareVins([])}>Clear</Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={compareVins.length < 2}
              onClick={() => navigate(`/marketplace/compare?vins=${compareVins.join(',')}`)}
              data-testid="marketplace-compare-go"
            >
              <GitCompare className="mr-1 h-4 w-4" /> Compare
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
