import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import {
  ArrowRight,
  CarFront,
  GitCompare,
  Loader2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { vehicles as mockVehicles, zimbabweLocations } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import type { MarketplaceListingSummary } from '@/types'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import { summaryLocationLine } from '@/lib/governedLocation'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { MarketplaceDecisionStory } from '@/components/marketplace/MarketplaceDecisionStory'
import {
  MarketplaceListingCard,
  type MarketplaceListingCardModel,
} from '@/components/marketplace/MarketplaceListingCard'
import {
  ALL,
  CATEGORY_CHIPS,
  PRICE_MAX_DEFAULT,
  PRICE_MIN_DEFAULT,
  TRUST_QUICK_FILTERS,
  TRUST_TAG_CHIPS,
  getActiveFilterChips,
  getResultSummary,
  isCategoryChip,
  paramsToState,
  stateToApiFilters,
  stateToParams,
} from '@/lib/marketplaceParams'
import type { ActiveFilterKey, MarketplaceSort, MarketplaceUrlState } from '@/lib/marketplaceParams'
import { isAdversePlateStatus, plateStatusLabel, primaryImageForListing } from '@/lib/marketplacePresentation'
import { VEHICLE_COLORS, VEHICLE_MAKES, VEHICLE_TAXONOMY, modelsForMake } from '@/data/vehicleTaxonomy'

const MAX_COMPARE = 4
const makes = ['All', ...VEHICLE_MAKES]
const fuelTypes = ['All', 'Petrol', 'Diesel', 'Hybrid', 'Electric']
const transmissions = ['All', 'Automatic', 'Manual']
const marketplaceYears = Array.from({ length: new Date().getFullYear() - 1959 }, (_, index) => String(new Date().getFullYear() + 1 - index))
const allTaxonomyModels = Array.from(new Set(VEHICLE_TAXONOMY.flatMap(make => make.models.map(model => model.name)))).sort()
const CONDITION_CHIPS = [...CATEGORY_CHIPS, 'Parts & Accessories']
const TRUST_CHIPS = TRUST_TAG_CHIPS

const ALLOW_MOCK_LISTINGS = import.meta.env.DEV || import.meta.env.VITE_MARKETPLACE_ALLOW_MOCK === 'true'

function marketplacePriceLabel(price: number | null | undefined, currency: string | null | undefined) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded'
  const amount = price.toLocaleString()
  if (!currency?.trim()) return `${amount} · currency not recorded`
  return currency.toUpperCase() === 'USD' ? `${amount}` : `${currency.toUpperCase()} ${amount}`
}

/** Real listings when present; mock only when explicitly allowed; otherwise an honest empty list. */
export function withMockFallback<T>(live: T[], mock: T[], allowMock: boolean = ALLOW_MOCK_LISTINGS): T[] {
  if (live.length > 0) return live
  return allowMock ? mock : []
}

type TrustRanking = { requested?: string; applied?: string; note?: string }
type CanonicalListing = MarketplaceListingSummary
type MockVehicle = (typeof mockVehicles)[number]

const CONDITION_LABELS: Record<string, string> = {
  brand_new: 'Brand New',
  recently_imported: 'Recently Imported',
  locally_used: 'Locally Used',
  second_hand: 'Second Hand',
  certified_dealer: 'Certified Pre-Owned',
}

function humanizeTag(tag: string) {
  return tag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function listingLabels(listing: MarketplaceListingSummary) {
  const labels = new Set<string>()
  const condition = CONDITION_LABELS[listing.condition_category]
  if (condition) labels.add(condition)
  for (const tag of listing.marketplace_tags || []) labels.add(humanizeTag(tag))
  return Array.from(labels)
}

function sellerLabel(listing: MarketplaceListingSummary) {
  return listing.seller_display_label?.trim() || 'Seller not disclosed'
}

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

/**
 * Dev-only adapter. Production/staging never use this path. Mock rows intentionally carry no
 * canonical Trust projection, so the reference card presents an unevaluated/unknown Trust state
 * rather than laundering mock `trustScore` into a public claim.
 */
function mockVehicleToListing(vehicle: MockVehicle): CanonicalListing {
  return {
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: vehicle.price,
    currency: vehicle.currency,
    mileage: vehicle.mileage,
    fuel_type: vehicle.fuelType,
    transmission: vehicle.transmission,
    status: vehicle.status || 'Available',
    condition_category: 'unknown',
    marketplace_tags: [],
    trust_score: null,
    trust: null,
    primary_image_url: vehicle.images?.[0] || null,
    primary_image_state: vehicle.images?.[0] ? 'first_published' : 'none',
    primary_image_unpublishable_count: 0,
    plate_verified: false,
    plate_status: null,
    passport_verified: false,
    evidence_count: 0,
    partsentry_checked: false,
    repair_history_count: 0,
    verified_parts_count: 0,
    duty_cleared: false,
    zimra_verified: false,
    cid_clear: false,
    seller_type: vehicle.sellerType === 'Dealer' ? 'dealer' : 'private',
    seller_display_label: vehicle.sellerName,
    seller_public_profile_enabled: true,
    location: vehicle.location,
    location_state: 'recorded',
    created_at: vehicle.listingDate || null,
  }
}

async function shareListing(vin: string, name: string) {
  const url = `${window.location.origin}/marketplace/${encodeURIComponent(vin)}`
  try {
    if (navigator.share) await navigator.share({ title: name, text: `Check out ${name} on CarUp`, url })
    else {
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
  onMake: (value: string) => void
  selectedModel: string
  onModel: (value: string) => void
  selectedYear: string
  onYear: (value: string) => void
  selectedColor: string
  onColor: (value: string) => void
  selectedLocation: string
  onLocation: (value: string) => void
  selectedFuel: string
  onFuel: (value: string) => void
  selectedTransmission: string
  onTransmission: (value: string) => void
  priceRange: number[]
  setPriceRange: (value: number[]) => void
}

function FilterControls({
  selectedMake,
  onMake,
  selectedModel,
  onModel,
  selectedYear,
  onYear,
  selectedColor,
  onColor,
  selectedLocation,
  onLocation,
  selectedFuel,
  onFuel,
  selectedTransmission,
  onTransmission,
  priceRange,
  setPriceRange,
}: FilterControlsProps) {
  return (
    <div className="grid gap-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Make</label>
        <Select value={selectedMake} onValueChange={onMake}>
          <SelectTrigger data-testid="marketplace-make-filter" className="bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{makes.map(make => <SelectItem key={make} value={make}>{make}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Model</label>
        <Input
          list="marketplace-model-options"
          value={selectedModel === ALL ? '' : selectedModel}
          onChange={event => onModel(event.target.value.trim() || ALL)}
          placeholder={selectedMake === ALL ? 'Any model' : `Any ${selectedMake} model`}
          data-testid="marketplace-model-filter"
        />
        <datalist id="marketplace-model-options">
          {(selectedMake === ALL ? allTaxonomyModels : modelsForMake(selectedMake).map(model => model.name))
            .map(model => <option key={model} value={model} />)}
        </datalist>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Year</label>
          <Select value={selectedYear} onValueChange={onYear}>
            <SelectTrigger className="bg-white" data-testid="marketplace-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {marketplaceYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Colour</label>
          <Select value={selectedColor} onValueChange={onColor}>
            <SelectTrigger className="bg-white" data-testid="marketplace-color-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All colours</SelectItem>
              {VEHICLE_COLORS.map(color => <SelectItem key={color} value={color}>{color}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Location</label>
        <Select value={selectedLocation} onValueChange={onLocation}>
          <SelectTrigger className="bg-white" data-testid="marketplace-location-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All locations</SelectItem>
            {zimbabweLocations.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Fuel</label>
          <Select value={selectedFuel} onValueChange={onFuel}>
            <SelectTrigger className="bg-white" data-testid="marketplace-fuel-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{fuelTypes.map(fuel => <SelectItem key={fuel} value={fuel}>{fuel}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Transmission</label>
          <Select value={selectedTransmission} onValueChange={onTransmission}>
            <SelectTrigger className="bg-white" data-testid="marketplace-transmission-filter"><SelectValue /></SelectTrigger>
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
            onChange={event => {
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
            onChange={event => {
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
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
    saveMarketplaceListing,
    unsaveMarketplaceListing,
    fetchSavedMarketplaceListings,
  } = useCarUpApi()
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => { captureReferralFromUrl() }, [])

  const [compareVins, setCompareVins] = useState<string[]>([])
  const [liveListings, setLiveListings] = useState<CanonicalListing[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [trustRanking, setTrustRanking] = useState<TrustRanking | null>(null)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const url = useMemo(() => paramsToState(searchParams), [searchParams])
  const [searchQuery, setSearchQuery] = useState(url.searchQuery)
  const [priceRange, setPriceRange] = useState<number[]>(url.priceRange)

  const updateUrl = useCallback((patch: Partial<MarketplaceUrlState>, replace = false) => {
    setSearchParams(previous => stateToParams({ ...paramsToState(previous), ...patch }), { replace })
  }, [setSearchParams])

  const mutateUrl = useCallback((mutate: (state: MarketplaceUrlState) => Partial<MarketplaceUrlState>, replace = false) => {
    const current = paramsToState(new URLSearchParams(window.location.search))
    setSearchParams(stateToParams({ ...current, ...mutate(current) }), { replace })
  }, [setSearchParams])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSearchQuery(previous => (previous.trim() === url.searchQuery ? previous : url.searchQuery))
    setPriceRange(previous => (
      previous[0] === url.priceRange[0] && previous[1] === url.priceRange[1] ? previous : url.priceRange
    ))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [url])

  useEffect(() => {
    if (searchQuery.trim() === url.searchQuery) return
    const timer = setTimeout(() => mutateUrl(() => ({ searchQuery: searchQuery.trim() }), true), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, url.searchQuery, mutateUrl])

  useEffect(() => {
    if (priceRange[0] === url.priceRange[0] && priceRange[1] === url.priceRange[1]) return
    const timer = setTimeout(() => mutateUrl(() => ({ priceRange: [priceRange[0], priceRange[1]] }), true), 350)
    return () => clearTimeout(timer)
  }, [priceRange, url.priceRange, mutateUrl])

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
      .catch(() => { /* retain current view; never copy authenticated state to guest localStorage */ })
    return () => { active = false }
  }, [isAuthenticated, fetchSavedMarketplaceListings])

  // ONE public contract. Marketplace no longer falls back to /api/vehicles when this request fails:
  // that path lacks the listing-specific ranking/media/reservation contract and creates two answers
  // for the same shopping surface. Production fails closed; explicit dev mode may show mock inventory.
  useEffect(() => {
    let cancelled = false
    const apiFilters = stateToApiFilters(url) as Record<string, string | number | boolean | undefined>

    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingVehicles(true)
    setLoadError(false)
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchMarketplaceListings(apiFilters)
      .then(data => {
        if (cancelled) return
        setTrustRanking(readTrustRanking(data))
        const listings = Array.isArray(data?.listings) ? data.listings as CanonicalListing[] : []
        setLiveListings(withMockFallback(listings, mockVehicles.map(mockVehicleToListing)))
      })
      .catch(error => {
        if (cancelled) return
        console.error('Failed to fetch canonical marketplace listing summaries:', error)
        setTrustRanking(null)
        setLoadError(true)
        setLiveListings(withMockFallback([], mockVehicles.map(mockVehicleToListing)))
      })
      .finally(() => {
        if (!cancelled) setLoadingVehicles(false)
      })

    return () => { cancelled = true }
  }, [url, fetchMarketplaceListings])

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

  // Draft search/price filtering keeps the UI responsive during debounce. All structural facets are
  // already applied by the backend over the full eligible population before its result limit.
  const visibleListings = useMemo(() => liveListings.filter(listing => {
    const query = searchQuery.trim().toLowerCase()
    const searchable = [
      listing.vin,
      listing.make,
      listing.model,
      listing.year,
      listing.color,
      listing.location,
      listing.seller_display_label,
      listing.seller_type,
      listing.condition_category,
      ...(listing.marketplace_tags || []),
    ].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !query || searchable.includes(query)
    const price = typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null
    const atDefaultPriceRange = priceRange[0] === PRICE_MIN_DEFAULT && priceRange[1] === PRICE_MAX_DEFAULT
    const matchesPrice = price === null
      ? atDefaultPriceRange
      : price >= priceRange[0] && (priceRange[1] === PRICE_MAX_DEFAULT || price <= priceRange[1])
    return matchesSearch && matchesPrice
  }), [liveListings, searchQuery, priceRange])

  const spotlightListing = visibleListings[0] ?? null
  const compareSelections = compareVins
    .map(vin => liveListings.find(listing => listing.vin === vin))
    .filter((listing): listing is CanonicalListing => Boolean(listing))

  const filterState: MarketplaceUrlState = {
    ...url,
    searchQuery,
    priceRange: [priceRange[0], priceRange[1]],
  }
  const activeChips = getActiveFilterChips(filterState)
  const activeFilterCount = activeChips.filter(chip => chip.key !== 'sort').length

  const resetFilters = () => {
    setSearchQuery('')
    setPriceRange([PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT])
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  const removeChip = (key: ActiveFilterKey, value?: string) => {
    if (key === 'make') updateUrl({ selectedMake: ALL, selectedModel: ALL })
    else if (key === 'model') updateUrl({ selectedModel: ALL })
    else if (key === 'year') updateUrl({ selectedYear: ALL })
    else if (key === 'color') updateUrl({ selectedColor: ALL })
    else if (key === 'q') {
      setSearchQuery('')
      updateUrl({ searchQuery: '' }, true)
    } else if (key === 'category') updateUrl({ selectedCategory: ALL })
    else if (key === 'tag') mutateUrl(state => ({ selectedTags: state.selectedTags.filter(tag => tag !== value) }))
    else if (key === 'fuel') updateUrl({ selectedFuel: ALL })
    else if (key === 'transmission') updateUrl({ selectedTransmission: ALL })
    else if (key === 'location') updateUrl({ selectedLocation: ALL })
    else if (key === 'price') {
      setPriceRange([PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT])
      updateUrl({ priceRange: [PRICE_MIN_DEFAULT, PRICE_MAX_DEFAULT] }, true)
    } else if (key === 'sort') updateUrl({ sortBy: 'newest' })
  }

  const setCategoryFilter = (value: string) => mutateUrl(state => ({
    selectedCategory: state.selectedCategory === value ? ALL : value,
  }))
  const toggleTrustTag = (label: string) => mutateUrl(state => ({
    selectedTags: state.selectedTags.includes(label)
      ? state.selectedTags.filter(tag => tag !== label)
      : [...state.selectedTags, label],
  }))

  const filterControls = (
    <FilterControls
      selectedMake={url.selectedMake}
      onMake={value => updateUrl({ selectedMake: value, selectedModel: ALL })}
      selectedModel={url.selectedModel}
      onModel={value => updateUrl({ selectedModel: value })}
      selectedYear={url.selectedYear}
      onYear={value => updateUrl({ selectedYear: value })}
      selectedColor={url.selectedColor}
      onColor={value => updateUrl({ selectedColor: value })}
      selectedLocation={url.selectedLocation}
      onLocation={value => updateUrl({ selectedLocation: value })}
      selectedFuel={url.selectedFuel}
      onFuel={value => updateUrl({ selectedFuel: value })}
      selectedTransmission={url.selectedTransmission}
      onTransmission={value => updateUrl({ selectedTransmission: value })}
      priceRange={priceRange}
      setPriceRange={setPriceRange}
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
          {url.selectedCategory !== ALL && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => updateUrl({ selectedCategory: ALL })} data-testid="marketplace-clear-condition">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['All', ...CONDITION_CHIPS].map(chip => {
            const active = chip === 'All' ? url.selectedCategory === ALL : url.selectedCategory === chip
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => (chip === 'All' ? updateUrl({ selectedCategory: ALL }) : setCategoryFilter(chip))}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${active
                  ? 'border-orange-500 bg-orange-50 text-orange-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'}`}
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
          {url.selectedTags.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => updateUrl({ selectedTags: [] })} data-testid="marketplace-clear-trust">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRUST_CHIPS.map(chip => {
            const active = url.selectedTags.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTrustTag(chip)}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${active
                  ? 'border-orange-500 bg-orange-50 text-orange-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'}`}
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
    <div className="min-h-screen bg-white text-slate-950" data-testid="marketplace-page">
      <section
        className="relative overflow-hidden bg-[#070b12] text-white"
        data-testid="marketplace-compact-header"
      >
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_18%_20%,rgba(249,115,22,0.16),transparent_24%),linear-gradient(120deg,transparent_0%,transparent_58%,rgba(255,255,255,0.04)_58%,rgba(255,255,255,0.04)_59%,transparent_59%)]" />
        <div className="section-padding relative mx-auto max-w-[1440px] pb-20 pt-5 sm:pb-24 lg:pb-28 lg:pt-7">
          <div className="flex items-center justify-between gap-5 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-orange-400">
              <CarFront className="h-4 w-4" /> CarUp Marketplace
            </div>
            <nav className="flex max-w-[72vw] gap-1 overflow-x-auto text-xs font-semibold sm:text-sm" aria-label="Marketplace categories">
              <Link to="/marketplace" className="shrink-0 border-b border-orange-400 px-2.5 py-2 text-white">Cars</Link>
              <Link to="/marketplace/parts" className="shrink-0 border-b border-transparent px-2.5 py-2 text-slate-400 hover:text-white">Parts</Link>
              <Link to="/marketplace/services" className="shrink-0 border-b border-transparent px-2.5 py-2 text-slate-400 hover:text-white">Garages</Link>
              <Link to="/diaspora" className="shrink-0 border-b border-transparent px-2.5 py-2 text-slate-400 hover:text-white">Imports</Link>
              <Link to="/insurance" className="hidden shrink-0 border-b border-transparent px-2.5 py-2 text-slate-400 hover:text-white sm:block">Insurance</Link>
              <Link to="/pricing" className="hidden shrink-0 border-b border-transparent px-2.5 py-2 text-slate-400 hover:text-white sm:block">Finance</Link>
            </nav>
          </div>

          <div className="grid gap-8 pt-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end lg:gap-12 lg:pt-12">
            <div className="relative z-10 lg:pb-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Zimbabwe&apos;s vehicle showroom + trust layer</p>
              <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl">
                Find the car.
                <span className="mt-1 block text-orange-400">Know what stands behind it.</span>
              </h1>
              <p className="mt-6 max-w-xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                Shop published vehicles with the commercial facts up front and CarUp&apos;s governed Trust,
                evidence and lifecycle context close enough to act on — without turning seller claims into verified facts.
              </p>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-4 text-xs text-slate-400">
                <span><strong className="text-white">Published</strong> inventory only</span>
                <span><strong className="text-white">Canonical</strong> Trust states</span>
                <span><strong className="text-white">4 cars</strong> max compare</span>
              </div>
            </div>

            <div className="relative min-h-[300px] sm:min-h-[390px] lg:min-h-[470px]" data-testid="marketplace-showroom-spotlight">
              <div className="absolute -right-8 top-0 h-[88%] w-[92%] border border-white/10 [clip-path:polygon(9%_0,100%_0,100%_88%,82%_100%,0_91%,0_14%)]" />
              {spotlightListing ? (
                <Link
                  to={`/marketplace/${encodeURIComponent(spotlightListing.vin)}`}
                  className="group absolute inset-x-0 top-3 block h-[82%] overflow-hidden bg-slate-900 shadow-[0_38px_100px_rgba(0,0,0,0.52)] [clip-path:polygon(8%_0,100%_0,100%_88%,82%_100%,0_91%,0_14%)]"
                  aria-label={`Open ${[spotlightListing.year, spotlightListing.make, spotlightListing.model].filter(Boolean).join(' ')}`}
                >
                  <ListingImage
                    src={primaryImageForListing(spotlightListing)}
                    alt={[spotlightListing.year, spotlightListing.make, spotlightListing.model].filter(Boolean).join(' ') || 'Marketplace vehicle'}
                    className="h-full w-full"
                    imgClassName="transition duration-700 ease-out group-hover:scale-[1.035]"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/10" />
                  <div className="absolute left-5 top-5 border border-white/25 bg-black/35 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    Live inventory
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-5 p-5 sm:p-7">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">Showroom spotlight</p>
                      <p className="mt-1 truncate text-2xl font-black tracking-[-0.035em] text-white sm:text-3xl">
                        {[spotlightListing.year, spotlightListing.make, spotlightListing.model].filter(Boolean).join(' ')}
                      </p>
                      <p className="mt-2 text-sm text-slate-300">
                        {summaryLocationLine(spotlightListing.location, spotlightListing.location_state).label}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xl font-black text-white">{marketplacePriceLabel(spotlightListing.price, spotlightListing.currency)}</p>
                      <span className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-orange-300">
                        Open vehicle <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="absolute inset-x-0 top-3 flex h-[82%] items-center justify-center bg-slate-900 text-sm text-slate-500 [clip-path:polygon(8%_0,100%_0,100%_88%,82%_100%,0_91%,0_14%)]">
                  {loadingVehicles ? 'Loading live showroom…' : 'No published vehicle to spotlight'}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="section-padding relative mx-auto max-w-[1440px] pb-12 pt-0 sm:pb-16">
        <section className="relative z-20 -mt-12 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)] sm:-mt-14">
          <div className="border-b border-slate-200 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Search the showroom</p>
                <p className="mt-0.5 text-xs text-slate-500">Make, model, year, location, seller or a vehicle identifier.</p>
              </div>
              {!loadingVehicles && (
                <p className="hidden text-xs font-semibold text-slate-500 sm:block">
                  <span className="text-slate-950">{visibleListings.length}</span> published {visibleListings.length === 1 ? 'vehicle' : 'vehicles'}
                </p>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1.7fr)_0.7fr_0.6fr_0.85fr_auto]">
            <div className="relative border-b border-slate-200 lg:border-b-0 lg:border-r">
              <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-orange-500" />
              <Input
                placeholder="Try “Hilux diesel”, “Harare”, a VIN, make or model…"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-16 rounded-none border-0 bg-transparent pl-14 pr-4 text-base font-semibold shadow-none placeholder:font-normal placeholder:text-slate-400 focus-visible:ring-0 sm:h-[72px] sm:text-lg"
                data-testid="marketplace-search-input"
              />
            </div>

            <div className="hidden border-r border-slate-200 lg:block">
              <Select value={url.selectedMake} onValueChange={value => updateUrl({ selectedMake: value, selectedModel: ALL })}>
                <SelectTrigger className="h-[72px] rounded-none border-0 bg-white px-4 shadow-none focus:ring-0" data-testid="marketplace-command-make">
                  <div className="text-left">
                    <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Make</span>
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>{makes.map(make => <SelectItem key={make} value={make}>{make}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="hidden border-r border-slate-200 lg:block">
              <Select value={url.selectedYear} onValueChange={value => updateUrl({ selectedYear: value })}>
                <SelectTrigger className="h-[72px] rounded-none border-0 bg-white px-4 shadow-none focus:ring-0" data-testid="marketplace-command-year">
                  <div className="text-left">
                    <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Year</span>
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any year</SelectItem>
                  {marketplaceYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden border-r border-slate-200 lg:block">
              <Select value={url.selectedLocation} onValueChange={value => updateUrl({ selectedLocation: value })}>
                <SelectTrigger className="h-[72px] rounded-none border-0 bg-white px-4 shadow-none focus:ring-0" data-testid="marketplace-command-location">
                  <div className="min-w-0 text-left">
                    <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Location</span>
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">Anywhere</SelectItem>
                  {zimbabweLocations.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <SheetTrigger asChild>
                <Button
                  className="h-16 rounded-none bg-orange-500 px-5 font-black text-white shadow-none hover:bg-orange-600 sm:h-[72px]"
                  data-testid="marketplace-mobile-filter-button"
                >
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  All filters
                  {activeFilterCount > 0 && <span className="ml-2 bg-white px-1.5 py-0.5 text-[10px] font-black text-orange-700">{activeFilterCount}</span>}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[94%] max-w-md overflow-y-auto bg-[#f8fafc] p-0 sm:max-w-lg" data-testid="marketplace-mobile-filter-drawer">
                <SheetHeader className="border-b border-slate-200 bg-[#08111f] px-5 py-5 text-left text-white">
                  <SheetTitle className="text-white">Build your shortlist</SheetTitle>
                  <p className="text-xs leading-5 text-slate-400">Refine the published inventory. Seller-stated and governed facts keep their original evidence states.</p>
                </SheetHeader>
                <div className="space-y-7 px-5 py-6">
                  {filterControls}
                  <div className="border-t border-slate-200 pt-6">{taxonomyControls}</div>
                </div>
                <SheetFooter className="sticky bottom-0 flex-row gap-2 border-t border-slate-200 bg-white p-4">
                  <Button variant="ghost" className="flex-1 rounded-none" onClick={resetFilters}>Clear all</Button>
                  <Button className="flex-1 rounded-none bg-orange-600 hover:bg-orange-700" onClick={() => setMobileFiltersOpen(false)} data-testid="marketplace-mobile-filter-close">
                    Show {visibleListings.length} {visibleListings.length === 1 ? 'vehicle' : 'vehicles'}
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto" data-testid="marketplace-quick-filters">
              <span className="flex shrink-0 items-center gap-1.5 pr-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-orange-600" /> Discover
              </span>
              {TRUST_QUICK_FILTERS.map(filter => {
                const category = isCategoryChip(filter.label)
                const active = category ? url.selectedCategory === filter.label : url.selectedTags.includes(filter.label)
                return (
                  <button
                    key={filter.label}
                    type="button"
                    data-testid={filter.testId}
                    aria-pressed={active}
                    onClick={() => (category ? setCategoryFilter(filter.label) : toggleTrustTag(filter.label))}
                    className={`shrink-0 border-b-2 px-2.5 py-1.5 text-xs font-bold transition ${active
                      ? 'border-orange-500 text-orange-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-950'}`}
                  >
                    {filter.label}
                  </button>
                )
              })}
            </div>

            <Select value={url.sortBy} onValueChange={value => updateUrl({ sortBy: value as MarketplaceSort })}>
              <SelectTrigger className="h-9 w-full rounded-none border-0 border-b border-slate-300 bg-white px-0 text-xs shadow-none focus:ring-0 sm:w-[190px]" data-testid="marketplace-sort-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="price-low">Price: low to high</SelectItem>
                <SelectItem value="price-high">Price: high to low</SelectItem>
                <SelectItem value="trust">Highest canonical Trust</SelectItem>
              </SelectContent>
            </Select>
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

        <main className="mt-10 min-w-0">
          {loadError && !loadingVehicles && (
            <div className="mb-6 border-y border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900" data-testid="marketplace-error-state">
              Marketplace data is temporarily unavailable. CarUp has not substituted another public vehicle endpoint or fabricated production inventory.
            </div>
          )}

          {!loadingVehicles && trustRanking?.requested === 'trust' && trustRanking.applied !== 'trust' && (
            <div className="mb-6 border-y border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600" data-testid="marketplace-trust-ranking-notice">
              {trustRanking.note || 'No listing on this page carries a canonical Trust evaluation, so these results are not ordered by Trust.'}
            </div>
          )}

          <div className="mb-7 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Available now</p>
              <h2 className="mt-1 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">Published vehicles</h2>
              <p className="mt-2 text-sm text-slate-500" data-testid="marketplace-results-summary">{getResultSummary(filterState)}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Published listings only · Trust and vehicle facts retain their governed states.</p>
            </div>
            <div className="flex items-end gap-5">
              <p className="text-sm text-slate-500" data-testid="marketplace-results-count">
                {loadingVehicles
                  ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading vehicles…</span>
                  : <><span className="text-2xl font-black text-slate-950">{visibleListings.length}</span> {visibleListings.length === 1 ? 'vehicle' : 'vehicles'}</>}
              </p>
              <Button
                variant="ghost"
                className="hidden h-auto rounded-none border-b border-slate-300 px-0 pb-1 text-xs font-bold text-slate-600 hover:bg-transparent hover:text-orange-700 sm:inline-flex"
                onClick={() => setMobileFiltersOpen(true)}
              >
                <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Refine
              </Button>
            </div>
          </div>

          {loadingVehicles ? (
            <div className="grid gap-x-7 gap-y-12 md:grid-cols-2" data-testid="marketplace-loading-state">
              {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
            </div>
          ) : visibleListings.length === 0 ? (
            <div className="border-y border-dashed border-slate-300 bg-white px-6 py-20 text-center" data-testid="marketplace-empty-state">
              <Search className="mx-auto mb-4 h-10 w-10 text-slate-300" />
              <h3 className="text-xl font-black text-slate-900">No matching vehicles</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Broaden the search or remove one of the active filters. CarUp will not fill an empty result with demo inventory.
              </p>
              <Button variant="outline" className="mt-5 rounded-none" onClick={resetFilters}>Clear all filters</Button>
            </div>
          ) : (
            <div className="grid gap-x-7 gap-y-12 md:grid-cols-2" data-testid="marketplace-results-grid">
              {visibleListings.map((listing, index) => {
                const vin = listing.vin
                const vehicleName = [listing.year, listing.make, listing.model].filter(value => value !== null && value !== undefined && value !== '').join(' ')
                const labels = listingLabels(listing)
                const href = `/marketplace/${encodeURIComponent(vin)}`
                const model: MarketplaceListingCardModel = {
                  vin,
                  name: vehicleName || `${listing.make} ${listing.model}`,
                  price: typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null,
                  currency: typeof listing.currency === 'string' && listing.currency.trim() ? listing.currency : null,
                  primaryImage: primaryImageForListing(listing),
                  primaryImageState: listing.primary_image_state,
                  mileage: typeof listing.mileage === 'number' && Number.isFinite(listing.mileage) ? listing.mileage : null,
                  transmission: listing.transmission || null,
                  fuel: listing.fuel_type || null,
                  sellerLabel: sellerLabel(listing),
                  locationLabel: summaryLocationLine(listing.location, listing.location_state).label,
                  plateStatus: plateStatusLabel(listing),
                  plateVerified: listing.plate_verified === true && !isAdversePlateStatus(listing.plate_status),
                  reserved: listing.reservation_summary?.reserved === true,
                  partSentryChecked: listing.partsentry_checked,
                  labels: labels.length > 0 ? labels : ['Published listing'],
                  trust: listing.trust || null,
                  carupGold: listing.carup_gold?.state === 'qualified',
                  syntheticDemo: Boolean(listing.primary_image_url?.includes('/marketplace-reference-synthetic/')),
                }

                return (
                  <Fragment key={vin}>
                    <MarketplaceListingCard
                      vehicle={model}
                      href={href}
                      isFavorite={favorites.includes(vin)}
                      isCompared={compareVins.includes(vin)}
                      onFavorite={event => toggleFavorite(event, vin, model.name)}
                      onCompare={event => toggleCompare(event, vin)}
                      onShare={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        shareListing(vin, model.name)
                      }}
                    />
                    {index === 1 && spotlightListing && (
                      <div className="md:col-span-2">
                        <MarketplaceDecisionStory
                          image={primaryImageForListing(spotlightListing)}
                          alt={[spotlightListing.year, spotlightListing.make, spotlightListing.model].filter(Boolean).join(' ') || 'Marketplace vehicle'}
                          href={`/marketplace/${encodeURIComponent(spotlightListing.vin)}`}
                        />
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {compareVins.length > 0 && !mobileFiltersOpen && (
        <div
          className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-5xl border border-slate-700 bg-[#08111f]/[0.98] px-3 py-3 text-white shadow-[0_26px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl lg:bottom-6"
          data-testid="marketplace-compare-bar"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden sm:flex">
              {compareSelections.map(listing => (
                <div key={listing.vin} className="flex min-w-0 max-w-[190px] flex-1 items-center gap-2 border-r border-white/10 pr-2 last:border-r-0">
                  <ListingImage
                    src={primaryImageForListing(listing)}
                    alt={[listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'Selected vehicle'}
                    className="h-11 w-16 shrink-0 overflow-hidden bg-slate-800"
                    imgClassName="object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black text-white">
                      {[listing.year, listing.make, listing.model].filter(Boolean).join(' ')}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">
                      {marketplacePriceLabel(listing.price, listing.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1 sm:hidden">
              <p className="truncate text-sm font-black text-white">{compareVins.length} selected to compare</p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {compareVins.length < 2 ? 'Select one more vehicle.' : 'Your side-by-side shortlist is ready.'}
              </p>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" className="hidden rounded-none text-slate-300 hover:bg-white/10 hover:text-white sm:inline-flex" onClick={() => setCompareVins([])}>
                Clear
              </Button>
              <Button
                size="sm"
                className="min-w-[9.5rem] rounded-none bg-orange-500 font-black text-white hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-400"
                disabled={compareVins.length < 2}
                onClick={() => navigate(`/marketplace/compare?vins=${compareVins.join(',')}`)}
                data-testid="marketplace-compare-go"
              >
                <GitCompare className="mr-1 h-4 w-4" />
                {compareVins.length < 2 ? 'Select one more' : `Compare ${compareVins.length} vehicles`}
              </Button>
            </div>
          </div>
        </div>
      )}    </div>
  )
}
