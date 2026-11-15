import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import {
  ArrowUpDown,
  CarFront,
  GitCompare,
  Info,
  Loader2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
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
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'
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
import { track as trackActivity } from '@/lib/intelligenceActivity'
import { displayCurrencyCode } from '@/lib/currencyDisplay'
import { BODY_STYLES, FUEL_TYPES, TRANSMISSIONS, VEHICLE_COLORS, VEHICLE_MAKES, VEHICLE_TAXONOMY, modelsForMake, vehicleYearOptions } from '@/data/vehicleTaxonomy'

const MAX_COMPARE = 4
const makes = ['All', ...VEHICLE_MAKES]
const fuelTypes = ['All', ...FUEL_TYPES]
const transmissions = ['All', ...TRANSMISSIONS]
const marketplaceYears = vehicleYearOptions()
const allTaxonomyModels = Array.from(new Set(VEHICLE_TAXONOMY.flatMap(make => make.models.map(model => model.name)))).sort()
const CONDITION_CHIPS = [...CATEGORY_CHIPS, 'Parts & Accessories']
const TRUST_CHIPS = TRUST_TAG_CHIPS

/** Marketplace's own sub-navigation. Same destinations as before; presentation only. */
const CATEGORY_LINKS: Array<{ to: string; label: string; current?: boolean }> = [
  { to: '/marketplace', label: 'Cars', current: true },
  { to: '/marketplace/parts', label: 'Parts' },
  { to: '/marketplace/services', label: 'Garages' },
  { to: '/diaspora', label: 'Imports' },
  { to: '/insurance', label: 'Insurance' },
  { to: '/pricing', label: 'Finance' },
]

/* Shared Showroom (Option 5) class strings for this page. */
const FOCUS_LIGHT = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em]'
const FIELD_LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500'
const FIELD_TRIGGER = 'w-full rounded-xl border-slate-200 bg-white text-[15px] text-[#09122A] shadow-none data-[size=default]:h-11'
const FIELD_INPUT = 'h-11 rounded-xl border-slate-200 bg-white text-[15px] shadow-none md:text-[15px]'

function chipClass(active: boolean) {
  return `inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-[14px] font-medium transition-colors ${FOCUS_LIGHT} ${active
    ? 'border-[#09122A] bg-[#09122A] text-white hover:bg-[#111D3D]'
    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-[#09122A]'}`
}

/** Live `min-width` media query; false where matchMedia is unavailable (SSR, jsdom). */
function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const list = window.matchMedia(query)
    list.addEventListener?.('change', onChange)
    return () => list.removeEventListener?.('change', onChange)
  }, [query])
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

function MarketplaceImpression({
  vin,
  position,
  children,
}: {
  vin: string
  position: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.25)) return
      trackActivity({
        event_type: 'marketplace_listing_impression',
        listing_id: vin,
        source_surface: 'marketplace_list',
        metadata: { position: position + 1, result_page: 1 },
      })
      observer.disconnect()
    }, { threshold: 0.25 })

    observer.observe(node)
    return () => observer.disconnect()
  }, [position, vin])

  return <div ref={ref} className="h-full min-w-0">{children}</div>
}

const ALLOW_MOCK_LISTINGS = import.meta.env.DEV || import.meta.env.VITE_MARKETPLACE_ALLOW_MOCK === 'true'

function marketplacePriceLabel(price: number | null | undefined, currency: string | null | undefined) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded'
  const amount = price.toLocaleString()
  if (!currency?.trim()) return `${amount} · currency not recorded`
  return currency.toUpperCase() === 'USD' ? `$${amount}` : `${displayCurrencyCode(currency)} ${amount}`
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

function listingName(listing: MarketplaceListingSummary) {
  return [listing.year, listing.make, listing.model].filter(Boolean).join(' ')
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
  selectedBodyStyle: string
  onBodyStyle: (value: string) => void
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
  selectedBodyStyle,
  onBodyStyle,
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
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Make</label>
          <Select value={selectedMake} onValueChange={onMake}>
            <SelectTrigger aria-label="Make" data-testid="marketplace-make-filter" className={FIELD_TRIGGER}><SelectValue /></SelectTrigger>
            <SelectContent>{makes.map(make => <SelectItem key={make} value={make}>{make}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <label className={FIELD_LABEL}>Model</label>
          <Input
            list="marketplace-model-options"
            value={selectedModel === ALL ? '' : selectedModel}
            onChange={event => onModel(event.target.value.trim() || ALL)}
            placeholder={selectedMake === ALL ? 'Any model' : `Any ${selectedMake} model`}
            aria-label="Model"
            data-testid="marketplace-model-filter"
            className={FIELD_INPUT}
          />
          <datalist id="marketplace-model-options">
            {(selectedMake === ALL ? allTaxonomyModels : modelsForMake(selectedMake).map(model => model.name))
              .map(model => <option key={model} value={model} />)}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Year</label>
          <Select value={selectedYear} onValueChange={onYear}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Year" data-testid="marketplace-year-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {marketplaceYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Colour</label>
          <Select value={selectedColor} onValueChange={onColor}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Colour" data-testid="marketplace-color-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All colours</SelectItem>
              {VEHICLE_COLORS.map(color => <SelectItem key={color} value={color}>{color}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Body style</label>
          <Select value={selectedBodyStyle} onValueChange={onBodyStyle}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Body style" data-testid="marketplace-body-style-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All body styles</SelectItem>
              {BODY_STYLES.map(bodyStyle => <SelectItem key={bodyStyle} value={bodyStyle}>{bodyStyle}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0">
          <label className={FIELD_LABEL}>Location</label>
          <Select value={selectedLocation} onValueChange={onLocation}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Location" data-testid="marketplace-location-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All locations</SelectItem>
              {zimbabweLocations.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Fuel</label>
          <Select value={selectedFuel} onValueChange={onFuel}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Fuel" data-testid="marketplace-fuel-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{fuelTypes.map(fuel => <SelectItem key={fuel} value={fuel}>{fuel}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <label className={FIELD_LABEL}>Transmission</label>
          <Select value={selectedTransmission} onValueChange={onTransmission}>
            <SelectTrigger className={FIELD_TRIGGER} aria-label="Transmission" data-testid="marketplace-transmission-filter"><SelectValue /></SelectTrigger>
            <SelectContent>{transmissions.map(transmission => <SelectItem key={transmission} value={transmission}>{transmission}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className={`${FIELD_LABEL} mb-0`}>Price</label>
          <span className="text-[13px] font-medium tabular-nums text-slate-600">
            ${priceRange[0].toLocaleString()} – {priceRange[1] >= 100000 ? 'Any max' : `$${priceRange[1].toLocaleString()}`}
          </span>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min $"
            aria-label="Minimum price"
            data-testid="marketplace-price-min-filter"
            className={FIELD_INPUT}
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
            className={FIELD_INPUT}
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

/** Skeleton shaped like the Showroom card so the page does not jump when results land. */
function SkeletonCard() {
  return (
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className="aspect-[4/3] rounded-2xl bg-slate-100 max-sm:-mx-4 max-sm:rounded-none" />
      <div className="pt-4">
        <div className="h-3 w-1/3 rounded-full bg-slate-100" />
        <div className="mt-3 h-5 w-3/4 rounded-full bg-slate-200/80" />
        <div className="mt-2.5 h-4 w-1/2 rounded-full bg-slate-100" />
        <div className="mt-4 h-7 w-2/5 rounded-full bg-slate-200/80" />
        <div className="mt-6 h-px bg-slate-200" />
        <div className="mt-4 h-4 w-2/3 rounded-full bg-slate-100" />
      </div>
    </div>
  )
}

/**
 * The stage the empty and failed states stand on: an empty studio floor with the state's own
 * sentence, then the headline and the way out. `spotlight` keeps the spotlight slot's message
 * (`marketplace-showroom-spotlight`) — it says what the first position of the showroom holds.
 */
function ShowroomStageNotice({
  testId,
  role,
  spotlight,
  spotlightTone,
  title,
  children,
  action,
}: {
  testId: string
  role?: 'alert'
  spotlight: string
  spotlightTone: 'amber' | 'slate'
  title: string
  children: ReactNode
  action: ReactNode
}) {
  return (
    <div role={role} className="rounded-3xl bg-[#F6F4F0] px-5 py-12 text-center sm:px-8 sm:py-16" data-testid={testId}>
      <div className="mx-auto flex max-w-sm flex-col items-center" data-testid="marketplace-showroom-spotlight">
        <VehicleSilhouette tone="muted" accent={false} strokeWidth={1.75} className="w-44 opacity-80 sm:w-52" />
        <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-[1.25rem] bg-white px-3 py-1.5 text-balance text-[12px] font-medium sm:px-3.5 sm:text-[13px] text-slate-700 shadow-[0_1px_2px_rgba(9,18,42,0.06)]">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${spotlightTone === 'amber' ? 'bg-amber-500' : 'bg-slate-400'}`} />
          {spotlight}
        </p>
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-[-0.015em] text-[#09122A] sm:text-2xl">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-6 text-slate-600">{children}</p>
      <div className="mt-6">{action}</div>
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
  const isMdUp = useMinWidth(768)

  useEffect(() => { captureReferralFromUrl() }, [])

  const [compareVins, setCompareVins] = useState<string[]>([])
  const [liveListings, setLiveListings] = useState<CanonicalListing[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Bumped by the error state's "Try again" so the listings read re-runs without touching the URL.
  const [listingsReadAttempt, setListingsReadAttempt] = useState(0)
  const [trustRanking, setTrustRanking] = useState<TrustRanking | null>(null)
  const [favorites, setFavoritesState] = useState<string[]>(getFavorites)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  // Set the instant a save/unsave click fires, so the in-flight initial-load fetch (which started
  // before that click and can resolve after it) never overwrites a more recent optimistic update.
  const favoritesMutatedRef = useRef(false)

  const url = useMemo(() => paramsToState(searchParams), [searchParams])
  const fixtureScope = searchParams.get('fixture_scope') || undefined
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
        // A save/unsave click already told us the true state more recently than this request
        // started; applying this response on top would revert that optimistic update back to
        // whatever was saved before the click, even though the mutation itself succeeded.
        if (active && !favoritesMutatedRef.current) {
          setFavoritesState((response.listings || []).map(listing => listing.vin).filter(Boolean))
        }
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
    if (fixtureScope) apiFilters.fixture_scope = fixtureScope

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
        // TI-13: a failed read is not an empty result. Hold NO listings (not even dev mock inventory)
        // so nothing downstream can derive an empty state, a spotlight or a count from it.
        setLiveListings([])
      })
      .finally(() => {
        if (!cancelled) setLoadingVehicles(false)
      })

    return () => { cancelled = true }
  }, [url, fixtureScope, fetchMarketplaceListings, listingsReadAttempt])

  const toggleCompare = useCallback((event: React.MouseEvent, vin: string) => {
    event.preventDefault()
    event.stopPropagation()
    const removing = compareVins.includes(vin)
    if (!removing && compareVins.length >= MAX_COMPARE) {
      toast.info(`You can compare up to ${MAX_COMPARE} listings.`)
      return
    }
    const next = removing ? compareVins.filter(value => value !== vin) : [...compareVins, vin]
    setCompareVins(next)
    trackActivity({
      event_type: removing ? 'marketplace_compare_removed' : 'marketplace_compare_added',
      listing_id: vin,
      source_surface: 'marketplace_list',
      compare_listing_ids: next,
      metadata: { compare_set_size: next.length },
    })
  }, [compareVins])

  const toggleFavorite = useCallback(async (event: React.MouseEvent, vin: string, vehicleName: string) => {
    event.preventDefault()
    event.stopPropagation()
    favoritesMutatedRef.current = true
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

  // The first result is the showroom spotlight. From 1024 px it opens up into a wide feature card,
  // but only when there is enough inventory to break the rhythm and the buyer is not mid-compare
  // (a uniform grid is easier to compare across).
  const featureFirstResult = visibleListings.length >= 3 && compareVins.length === 0
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
  const publishedCountLabel = `published ${visibleListings.length === 1 ? 'listing' : 'listings'}`

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
    else if (key === 'bodyStyle') updateUrl({ selectedBodyStyle: ALL })
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
      selectedBodyStyle={url.selectedBodyStyle}
      onBodyStyle={value => updateUrl({ selectedBodyStyle: value })}
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
    <div className="space-y-6">
      <div data-testid="marketplace-condition-group">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-[#09122A]">Vehicle condition</p>
            <p className="mt-0.5 text-[13px] leading-5 text-slate-500">Choose one classification.</p>
          </div>
          {url.selectedCategory !== ALL && (
            <Button variant="ghost" size="sm" className="h-9 rounded-full px-3 text-[13px] text-[#C2410C] hover:bg-orange-50 hover:text-[#C2410C]" onClick={() => updateUrl({ selectedCategory: ALL })} data-testid="marketplace-clear-condition">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {['All', ...CONDITION_CHIPS].map(chip => {
            const active = chip === 'All' ? url.selectedCategory === ALL : url.selectedCategory === chip
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => (chip === 'All' ? updateUrl({ selectedCategory: ALL }) : setCategoryFilter(chip))}
                className={chipClass(active)}
                data-testid="marketplace-category-chip"
              >
                {chip}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6" data-testid="marketplace-trust-group">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-[#09122A]">
              <ShieldCheck className="h-4 w-4 text-[#C2410C]" aria-hidden="true" /> Trust signals
            </p>
            <p className="mt-0.5 text-[13px] leading-5 text-slate-500">Stack filters; every selected signal must match.</p>
          </div>
          {url.selectedTags.length > 0 && (
            <Button variant="ghost" size="sm" className="h-9 rounded-full px-3 text-[13px] text-[#C2410C] hover:bg-orange-50 hover:text-[#C2410C]" onClick={() => updateUrl({ selectedTags: [] })} data-testid="marketplace-clear-trust">
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {TRUST_CHIPS.map(chip => {
            const active = url.selectedTags.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTrustTag(chip)}
                className={chipClass(active)}
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

  const sheetSide = isMdUp ? 'left' : 'bottom'
  const commandSelectTrigger = `h-12 w-[7.75rem] shrink-0 rounded-xl border-0 bg-transparent px-3.5 text-left text-[15px] text-[#09122A] shadow-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#C2410C] data-[size=default]:h-12 xl:w-[8.5rem] 2xl:w-[10rem]`
  const commandLabel = 'block text-[10px] font-semibold uppercase leading-3 tracking-[0.16em] text-slate-500'

  return (
    <div className="min-h-screen bg-white text-[#09122A]" data-testid="marketplace-page">
      <section className="bg-white" data-testid="marketplace-compact-header" aria-labelledby="marketplace-title">
        <div className="section-padding mx-auto max-w-[1440px] pt-4 sm:pt-8 lg:pt-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
            <div className="min-w-0">
              <p className={`${EYEBROW} text-[#C2410C]`}>CarUp Marketplace</p>
              <h1
                id="marketplace-title"
                className="mt-2 text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#09122A]"
              >
                Find the car.{' '}
                <span className="text-slate-500 sm:block">Know what stands behind it.</span>
              </h1>
              {/* TI-13: no count at all while the read has failed — a failure is not a measured zero. */}
              {!loadError && (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-500" data-testid="marketplace-results-count">
                  {loadingVehicles
                    ? <><Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Loading vehicles…</>
                    : <>
                        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="font-semibold tabular-nums text-[#09122A]">{visibleListings.length}</span> {publishedCountLabel}
                      </>}
                </p>
              )}
            </div>

            <nav
              aria-label="Marketplace categories"
              className="carup-rail -mx-4 hidden scroll-px-4 gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:flex sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:shrink-0 lg:px-0"
            >
              {CATEGORY_LINKS.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  aria-current={link.current ? 'page' : undefined}
                  className={`inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-medium transition-colors ${FOCUS_LIGHT} ${link.current
                    ? 'bg-[#09122A] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-[#09122A]'}`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </section>

      {/* The command bar follows the buyer down the showroom from tablet up (under the 64 px site header). */}
      <div className="relative z-30 bg-white/90 backdrop-blur-md md:sticky md:top-16">
        <div className="section-padding mx-auto max-w-[1440px] py-3 sm:py-4">
          <div
            role="search"
            aria-label="Search the Marketplace"
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 md:flex md:items-center md:gap-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-1.5 md:shadow-[0_1px_2px_rgba(9,18,42,0.06),0_18px_40px_-24px_rgba(9,18,42,0.35)]"
          >
            <div className="relative col-span-2 min-w-0 md:flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#C2410C]" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Search published vehicles"
                placeholder="Search make, model, location or VIN"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-12 rounded-xl border-slate-200 bg-white pl-12 pr-4 text-base text-[#09122A] shadow-[0_1px_2px_rgba(9,18,42,0.05)] placeholder:text-slate-500 focus-visible:border-slate-300 focus-visible:ring-2 focus-visible:ring-[#C2410C]/30 md:border-transparent md:text-[16px] md:shadow-none xl:text-[17px]"
                data-testid="marketplace-search-input"
              />
            </div>

            <div className="hidden shrink-0 items-center lg:flex">
              <span aria-hidden="true" className="mx-1 h-8 w-px bg-slate-200" />
              <Select value={url.selectedMake} onValueChange={value => updateUrl({ selectedMake: value, selectedModel: ALL })}>
                <SelectTrigger className={commandSelectTrigger} aria-label="Make" data-testid="marketplace-command-make">
                  <span className="min-w-0 truncate">
                    <span className={commandLabel}>Make</span>
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>{makes.map(make => <SelectItem key={make} value={make}>{make}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="hidden shrink-0 items-center lg:flex">
              <span aria-hidden="true" className="mx-1 h-8 w-px bg-slate-200" />
              <Select value={url.selectedYear} onValueChange={value => updateUrl({ selectedYear: value })}>
                <SelectTrigger className={commandSelectTrigger} aria-label="Year" data-testid="marketplace-command-year">
                  <span className="min-w-0 truncate">
                    <span className={commandLabel}>Year</span>
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any year</SelectItem>
                  {marketplaceYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden shrink-0 items-center lg:flex">
              <span aria-hidden="true" className="mx-1 h-8 w-px bg-slate-200" />
              <Select value={url.selectedLocation} onValueChange={value => updateUrl({ selectedLocation: value })}>
                <SelectTrigger className={commandSelectTrigger} aria-label="Location" data-testid="marketplace-command-location">
                  <span className="min-w-0 truncate">
                    <span className={commandLabel}>Location</span>
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">Anywhere</SelectItem>
                  {zimbabweLocations.map(location => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-[14px] font-semibold text-[#09122A] transition-colors hover:border-slate-300 ${FOCUS_LIGHT} md:order-last md:ml-1.5 md:h-12 md:rounded-xl md:border-transparent md:bg-[#09122A] md:px-5 md:text-white md:hover:bg-[#111D3D]`}
                  data-testid="marketplace-mobile-filter-button"
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-1.5 text-[11px] font-bold tabular-nums text-[#09122A]">
                      {activeFilterCount}<span className="sr-only"> active</span>
                    </span>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent
                side={sheetSide}
                className={sheetSide === 'bottom'
                  ? 'max-h-[88svh] gap-0 overflow-hidden rounded-t-3xl border-0 bg-white p-0'
                  : 'w-[92vw] max-w-md gap-0 border-0 bg-white p-0 sm:max-w-md'}
                data-testid="marketplace-mobile-filter-drawer"
              >
                {sheetSide === 'bottom' && <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />}
                <SheetHeader className="shrink-0 gap-1 border-b border-slate-200 px-5 pb-4 pt-4 pr-14 text-left">
                  <SheetTitle className="text-lg font-semibold tracking-[-0.015em] text-[#09122A]">Build your shortlist</SheetTitle>
                  <SheetDescription className="text-[13px] leading-5 text-slate-500">
                    Refine the published inventory. Seller-stated and governed facts keep their original evidence states.
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-6">
                  {filterControls}
                  <div className="border-t border-slate-200 pt-6">{taxonomyControls}</div>
                </div>
                <SheetFooter className="mt-0 shrink-0 flex-row gap-2 border-t border-slate-200 bg-white px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                  <button
                    type="button"
                    className={`h-12 flex-1 rounded-xl text-[15px] font-semibold text-[#09122A] transition-colors hover:bg-slate-100 ${FOCUS_LIGHT}`}
                    onClick={resetFilters}
                  >
                    Clear all
                  </button>
                  <button
                    type="button"
                    className={`h-12 flex-[2] rounded-xl bg-[#09122A] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#111D3D] ${FOCUS_LIGHT}`}
                    onClick={() => setMobileFiltersOpen(false)}
                    data-testid="marketplace-mobile-filter-close"
                  >
                    {loadError
                      ? 'Close filters'
                      : `Show ${visibleListings.length} ${publishedCountLabel}`}
                  </button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 items-center md:shrink-0">
              <span aria-hidden="true" className="mx-1 hidden h-8 w-px bg-slate-200 md:block" />
              <Select value={url.sortBy} onValueChange={value => updateUrl({ sortBy: value as MarketplaceSort })}>
                <SelectTrigger
                  className="w-full min-w-0 rounded-full border-slate-200 bg-white px-4 text-left text-[14px] font-medium text-[#09122A] shadow-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-[#C2410C] data-[size=default]:h-11 md:w-[12rem] md:rounded-xl lg:w-[10.5rem] xl:w-[11rem] 2xl:w-[12rem] md:border-transparent md:text-[15px] md:font-normal md:hover:bg-slate-50 md:data-[size=default]:h-12"
                  aria-label="Sort results" data-testid="marketplace-sort-select"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDown className="h-4 w-4 shrink-0 text-slate-500 md:hidden" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      <span className={`sr-only md:not-sr-only ${commandLabel}`}>Sort</span>
                      <SelectValue />
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="price-low">Price: low to high</SelectItem>
                  <SelectItem value="price-high">Price: high to low</SelectItem>
                  <SelectItem value="trust">Highest canonical Trust</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] pb-16 sm:pb-20">
        <div
          role="group"
          aria-label="Quick filters"
          className="carup-rail -mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0"
          data-testid="marketplace-quick-filters"
        >
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
                className={chipClass(active)}
              >
                {filter.label}
              </button>
            )
          })}
        </div>

        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Active filters" data-testid="marketplace-active-filters">
            {activeChips.map(chip => (
              <button
                key={`${chip.key}:${chip.value ?? chip.label}`}
                type="button"
                onClick={() => removeChip(chip.key, chip.value)}
                aria-label={`Remove filter: ${chip.label}`}
                data-testid="marketplace-active-filter-chip"
                className={`relative inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F6F4F0] pl-3.5 pr-2.5 text-[13px] font-medium text-[#09122A] transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:bg-[#ECE8E1] ${FOCUS_LIGHT}`}
              >
                {chip.label}
                <X className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              data-testid="marketplace-clear-filters"
              className={`relative h-9 rounded-full px-3 text-[13px] font-semibold text-[#C2410C] underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:underline ${FOCUS_LIGHT}`}
            >
              Clear all
            </button>
          </div>
        )}

        <section className="mt-6 min-w-0 sm:mt-8" aria-labelledby="marketplace-results-heading">
          <h2 id="marketplace-results-heading" className="sr-only">Published vehicles</h2>

          {!loadingVehicles && trustRanking?.requested === 'trust' && trustRanking.applied !== 'trust' && (
            <div className="mb-6 flex gap-3 rounded-2xl bg-[#F6F4F0] px-4 py-3 text-[13px] leading-5 text-slate-600" data-testid="marketplace-trust-ranking-notice">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span>{trustRanking.note || 'No listing on this page carries a canonical Trust evaluation, so these results are not ordered by Trust.'}</span>
            </div>
          )}

          <div className="mb-4 flex flex-col gap-0.5 sm:mb-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <p className="text-[15px] font-semibold text-[#09122A]" data-testid="marketplace-results-summary">{getResultSummary(filterState)}</p>
            <p className="text-[12px] leading-4 text-slate-500 sm:text-[13px]">Published listings only · Trust and vehicle facts retain their governed states.</p>
          </div>

          {loadingVehicles ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-12 md:grid-cols-2 xl:grid-cols-3 xl:gap-x-8" data-testid="marketplace-loading-state">
              {Array.from({ length: 6 }).map((_, index) => (index === 0
                ? (
                    <div key={index} data-testid="marketplace-showroom-spotlight">
                      <span className="sr-only">Loading live showroom…</span>
                      <SkeletonCard />
                    </div>
                  )
                : <SkeletonCard key={index} />))}
            </div>
          ) : loadError ? (
            <ShowroomStageNotice
              testId="marketplace-error-state"
              role="alert"
              spotlight="The live showroom is unavailable right now"
              spotlightTone="amber"
              title="Vehicles could not be loaded"
              action={(
                <button
                  type="button"
                  className={`inline-flex h-11 items-center rounded-full bg-[#09122A] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#111D3D] ${FOCUS_LIGHT}`}
                  onClick={() => setListingsReadAttempt(attempt => attempt + 1)}
                >
                  Try again
                </button>
              )}
            >
              Marketplace data is temporarily unavailable, so this is not an empty showroom. CarUp has not
              substituted another public vehicle endpoint or fabricated production inventory.
            </ShowroomStageNotice>
          ) : visibleListings.length === 0 ? (
            <ShowroomStageNotice
              testId="marketplace-empty-state"
              spotlight="No published vehicle to spotlight"
              spotlightTone="slate"
              title="No matching vehicles"
              action={(
                <button
                  type="button"
                  className={`inline-flex h-11 items-center rounded-full border border-slate-300 bg-white px-6 text-[15px] font-semibold text-[#09122A] transition-colors hover:border-slate-400 ${FOCUS_LIGHT}`}
                  onClick={resetFilters}
                >
                  Clear all filters
                </button>
              )}
            >
              Broaden the search or remove one of the active filters. CarUp will not fill an empty result with demo inventory.
            </ShowroomStageNotice>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-12 md:grid-cols-2 xl:grid-cols-3 xl:gap-x-8" data-testid="marketplace-results-grid">
              {visibleListings.map((listing, position) => {
                const vin = listing.vin
                const vehicleName = [listing.year, listing.make, listing.model].filter(value => value !== null && value !== undefined && value !== '').join(' ')
                const labels = listingLabels(listing)
                const href = `/marketplace/${encodeURIComponent(vin)}${fixtureScope ? `?fixture_scope=${encodeURIComponent(fixtureScope)}` : ''}`
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
                  bodyStyle: typeof listing.body_style === 'string' && listing.body_style.trim() ? listing.body_style.trim() : null,
                }
                const isFeature = position === 0 && featureFirstResult

                const card = (
                  <MarketplaceImpression vin={vin} position={position}>
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
                      layout={isFeature ? 'feature' : 'standard'}
                      edgeToEdgeOnPhones
                    />
                  </MarketplaceImpression>
                )

                // The first position is the showroom spotlight, whether or not it opens into a feature card.
                return position === 0
                  ? (
                      <div key={vin} className={`min-w-0 ${isFeature ? 'lg:col-span-2 xl:col-span-3' : ''}`} data-testid="marketplace-showroom-spotlight">
                        {card}
                      </div>
                    )
                  : <div key={vin} className="min-w-0">{card}</div>
              })}
            </div>
          )}
        </section>
      </div>

      {compareVins.length > 0 && !mobileFiltersOpen && (
        <div
          className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-3xl rounded-2xl bg-[#09122A]/95 p-2 pl-3 text-white shadow-[0_24px_60px_-20px_rgba(9,18,42,0.7)] ring-1 ring-white/10 backdrop-blur-xl lg:bottom-6"
          data-testid="marketplace-compare-bar"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <div className="hidden shrink-0 -space-x-3 sm:flex" aria-hidden="true">
              {compareSelections.map(listing => {
                const thumb = primaryImageForListing(listing)
                return (
                  <div key={listing.vin} className="h-10 w-14 overflow-hidden rounded-lg bg-[#111D3D] ring-2 ring-[#09122A]">
                    {thumb
                      ? (
                          <ListingImage
                            src={thumb}
                            alt={listingName(listing) || 'Selected vehicle'}
                            bodyStyle={listing.body_style ?? null}
                            className="h-full w-full"
                          />
                        )
                      : <div className="grid h-full w-full place-items-center text-slate-400"><CarFront className="h-4 w-4" /></div>}
                  </div>
                )
              })}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{compareVins.length} selected to compare</p>
              <p className="mt-0.5 truncate text-[12px] text-slate-300">
                {compareVins.length < 2 ? 'Select one more vehicle.' : 'Your side-by-side shortlist is ready.'}
              </p>
              <p className="sr-only">
                {compareSelections.map(listing => `${listingName(listing)}, ${marketplacePriceLabel(listing.price, listing.currency)}`).join('; ')}
              </p>
            </div>

            <button
              type="button"
              className="hidden h-11 shrink-0 rounded-xl px-3 text-[14px] font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] sm:inline-flex sm:items-center"
              onClick={() => setCompareVins([])}
            >
              Clear
            </button>
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-3.5 text-[14px] font-semibold text-[#09122A] transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A] disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-slate-300 sm:px-4"
              disabled={compareVins.length < 2}
              onClick={() => {
                trackActivity({
                  event_type: 'marketplace_compare_viewed',
                  source_surface: 'marketplace_list',
                  compare_listing_ids: compareVins,
                  metadata: { compare_set_size: compareVins.length },
                })
                navigate(`/marketplace/compare?vins=${compareVins.join(',')}`)
              }}
              data-testid="marketplace-compare-go"
            >
              <GitCompare className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              {compareVins.length < 2 ? 'Select one more' : `Compare ${compareVins.length} vehicles`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
