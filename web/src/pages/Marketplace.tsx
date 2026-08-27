import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
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
import { useIsMobile } from '@/hooks/use-mobile'
import type { MarketplaceListingSummary } from '@/types'
import { captureReferralFromUrl } from '@/lib/marketplaceReferral'
import { summaryLocationLine } from '@/lib/governedLocation'
import {
  MarketplaceListingCard,
  type MarketplaceListingCardModel,
} from '@/components/marketplace/MarketplaceListingCard'
import {
  ALL,
  CATEGORY_CHIPS,
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
import { VEHICLE_MAKES } from '@/data/vehicleTaxonomy'

const MAX_COMPARE = 4
const makes = ['All', ...VEHICLE_MAKES]
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-4 text-slate-500">
        Body style will appear here when CarUp has a governed public body-style field. The production Marketplace does not expose a filter that can only operate on mock/local data.
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
  const isMobile = useIsMobile()
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
      listing.location,
      listing.seller_display_label,
      listing.seller_type,
      listing.condition_category,
      ...(listing.marketplace_tags || []),
    ].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !query || searchable.includes(query)
    const price = typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null
    const matchesPrice = price === null
      ? priceRange[0] === 0 && priceRange[1] === 100000
      : price >= priceRange[0] && price <= priceRange[1]
    return matchesSearch && matchesPrice
  }), [liveListings, searchQuery, priceRange])

  const filterState: MarketplaceUrlState = {
    ...url,
    searchQuery,
    priceRange: [priceRange[0], priceRange[1]],
  }
  const activeChips = getActiveFilterChips(filterState)
  const activeFilterCount = activeChips.filter(chip => chip.key !== 'sort').length

  const resetFilters = () => {
    setSearchQuery('')
    setPriceRange([0, 100000])
    setSearchParams(new URLSearchParams(), { replace: false })
  }

  const removeChip = (key: ActiveFilterKey, value?: string) => {
    if (key === 'make') updateUrl({ selectedMake: ALL })
    else if (key === 'q') {
      setSearchQuery('')
      updateUrl({ searchQuery: '' }, true)
    } else if (key === 'category') updateUrl({ selectedCategory: ALL })
    else if (key === 'tag') mutateUrl(state => ({ selectedTags: state.selectedTags.filter(tag => tag !== value) }))
    else if (key === 'fuel') updateUrl({ selectedFuel: ALL })
    else if (key === 'transmission') updateUrl({ selectedTransmission: ALL })
    else if (key === 'location') updateUrl({ selectedLocation: ALL })
    else if (key === 'price') {
      setPriceRange([0, 100000])
      updateUrl({ priceRange: [0, 100000] }, true)
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
      onMake={value => updateUrl({ selectedMake: value })}
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
    <div className="min-h-screen bg-[#f6f7f9] text-slate-950" data-testid="marketplace-page">
      <section className="border-b border-slate-200 bg-white" data-testid="marketplace-compact-header">
        <div className="section-padding mx-auto flex max-w-[1440px] flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-orange-600">
              <CarFront className="h-4 w-4" /> Marketplace
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Shop vehicles and automotive services
            </h1>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 text-sm font-semibold" aria-label="Marketplace categories">
            <Link to="/marketplace" className="shrink-0 border-b-2 border-orange-500 px-3 py-2 text-slate-950">Cars</Link>
            <Link to="/marketplace/parts" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-slate-500 hover:text-slate-950">Parts</Link>
            <Link to="/marketplace/services" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-slate-500 hover:text-slate-950">Garages</Link>
            <Link to="/diaspora" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-slate-500 hover:text-slate-950">Imports</Link>
            <Link to="/insurance" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-slate-500 hover:text-slate-950">Insurance</Link>
            <Link to="/pricing" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-slate-500 hover:text-slate-950">Finance</Link>
          </nav>
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
              <Select value={url.sortBy} onValueChange={value => updateUrl({ sortBy: value as MarketplaceSort })}>
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
                    <SheetHeader><SheetTitle>Refine vehicles</SheetTitle></SheetHeader>
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
              const category = isCategoryChip(filter.label)
              const active = category ? url.selectedCategory === filter.label : url.selectedTags.includes(filter.label)
              return (
                <button
                  key={filter.label}
                  type="button"
                  data-testid={filter.testId}
                  aria-pressed={active}
                  onClick={() => (category ? setCategoryFilter(filter.label) : toggleTrustTag(filter.label))}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active
                    ? 'border-orange-500 bg-orange-50 text-orange-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-slate-900'}`}
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
                  <p className="mt-0.5 text-xs text-slate-500">Every active facet applies before result limiting.</p>
                </div>
                {activeFilterCount > 0 && <Badge variant="secondary" className="bg-slate-100 text-slate-700">{activeFilterCount}</Badge>}
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
                Marketplace data is temporarily unavailable. CarUp has not substituted another public vehicle endpoint or fabricated production inventory.
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
                <p className="mt-1 text-xs text-slate-500">Published listings only. Trust and vehicle facts retain their governed states.</p>
              </div>
              <p className="text-sm text-slate-600" data-testid="marketplace-results-count">
                {loadingVehicles
                  ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading vehicles…</span>
                  : <><span className="font-semibold text-slate-950">{visibleListings.length}</span> {visibleListings.length === 1 ? 'vehicle' : 'vehicles'} found</>}
              </p>
            </div>

            {loadingVehicles ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="marketplace-loading-state">
                {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
              </div>
            ) : visibleListings.length === 0 ? (
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
                {visibleListings.map(listing => {
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
                    <MarketplaceListingCard
                      key={vin}
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
              <GitCompare className="mr-1 h-4 w-4" />Compare
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
