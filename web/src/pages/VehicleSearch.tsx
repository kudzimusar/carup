import { useEffect, useMemo, useState } from 'react'
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
import { Search, CheckCircle, Gauge, Fuel, Settings2, MapPin, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { looksLikeIdentifier } from '@/lib/marketplaceParams'
import { ListingImage } from '@/components/marketplace/ListingImage'
import type { MarketplaceListingSummary, Vehicle } from '@/types'

function labelize(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function VehicleSearch() {
  const { fetchMarketplaceListings, fetchMarketplaceCategories, lookupVehiclePassport, fetchMarketplaceListingDetail } = useCarUpApi()

  const [query, setQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [make, setMake] = useState('All')
  const [category, setCategory] = useState('All')

  const [listings, setListings] = useState<MarketplaceListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [passportMatch, setPassportMatch] = useState<Vehicle | null>(null)
  // Only vehicles that resolve on the gated public marketplace detail endpoint get a
  // listing deep-link; a passport hit for a draft/unpublished vehicle renders as
  // history-only so /search never advertises an unlisted vehicle as live.
  const [passportListed, setPassportListed] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState<{ slug: string; label: string }[]>([])

  // Debounce typed input so keystrokes never fire a network request directly.
  useEffect(() => {
    const timer = setTimeout(() => setCommittedQuery(query.trim()), 350)
    return () => clearTimeout(timer)
  }, [query])

  // Category filter options come from the authoritative categories endpoint; when it is
  // unavailable the options are derived from the returned listings instead (see below).
  useEffect(() => {
    let mounted = true
    fetchMarketplaceCategories()
      .then(data => {
        if (!mounted) return
        setCategoryOptions((data?.condition_categories || []).map(c => ({ slug: c.slug, label: c.label || labelize(c.slug) })))
      })
      .catch(() => { /* fall back to listing-derived categories */ })
    return () => { mounted = false }
  }, [fetchMarketplaceCategories])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setLoadError(false)

      // 1. Identifier-shaped queries try the passport lookup first: an exact VIN /
      //    chassis / plate / temporary ID match deep-links straight to the listing.
      let matched: Vehicle | null = null
      if (looksLikeIdentifier(committedQuery)) {
        try {
          const passport = await lookupVehiclePassport(committedQuery)
          if (passport?.vehicle?.vin) matched = passport.vehicle
        } catch {
          // Not a known identifier — fall through to the plain marketplace search.
        }
      }
      let matchedListed = false
      if (matched?.vin) {
        try {
          await fetchMarketplaceListingDetail(matched.vin)
          matchedListed = true
        } catch {
          // Passport exists but the vehicle is not publicly listed (draft,
          // unpublished, or quarantined) — render without a listing link.
        }
      }
      if (cancelled) return
      setPassportMatch(matched)
      setPassportListed(matchedListed)

      // 2. Browse results always come from the live marketplace listings API; the
      //    backend search haystack covers make/model/VIN/plate/chassis/seller.
      try {
        const data = await fetchMarketplaceListings({
          q: committedQuery || undefined,
          make: make !== 'All' ? make : undefined,
          category: category !== 'All' ? category : undefined,
        })
        if (cancelled) return
        setListings(Array.isArray(data?.listings) ? data.listings : [])
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch marketplace listings for search:', err)
        setListings([])
        setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [committedQuery, make, category, fetchMarketplaceListings, lookupVehiclePassport, fetchMarketplaceListingDetail])

  const makes = useMemo(
    () => ['All', ...Array.from(new Set(listings.map(l => l.make).filter(Boolean))).sort()],
    [listings],
  )
  const categories = useMemo(() => {
    if (categoryOptions.length > 0) return categoryOptions
    return Array.from(new Set(listings.map(l => l.condition_category).filter(Boolean)))
      .sort()
      .map(slug => ({ slug, label: labelize(slug) }))
  }, [categoryOptions, listings])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px]">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Verify Vehicle or Part History</h1>
          <p className="text-gray-300 mb-3">Search by VIN, chassis, plate, or temporary ID</p>
          <p className="mb-8 max-w-3xl text-sm leading-6 text-gray-300">
            PartSentry helps identify swapped, stolen, or undocumented parts by connecting repair logs,
            work orders, mechanics, and parts history to the vehicle Passport where records exist.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Enter VIN, chassis, plate, or temporary ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400"
                data-testid="vehicle-search-input"
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
              <SelectContent>
                <SelectItem value="All">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {/* Exact identifier match: deep-link only when the vehicle is publicly listed. */}
        {passportMatch && passportListed && (
          <Link
            to={`/marketplace/listing/${encodeURIComponent(passportMatch.vin)}`}
            className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 hover:bg-green-100 transition-colors"
            data-testid="vehicle-search-passport-match"
          >
            <ShieldCheck className="w-6 h-6 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-900">
                Passport found: {[passportMatch.year, passportMatch.make, passportMatch.model].filter(Boolean).join(' ') || passportMatch.vin}
              </p>
              <p className="text-xs text-green-700 font-mono">VIN {passportMatch.vin}</p>
            </div>
            <span className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shrink-0">
              View Passport
            </span>
          </Link>
        )}
        {passportMatch && !passportListed && (
          <div
            className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
            data-testid="vehicle-search-passport-history-only"
          >
            <ShieldCheck className="w-6 h-6 text-slate-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">
                Vehicle history record found: {[passportMatch.year, passportMatch.make, passportMatch.model].filter(Boolean).join(' ') || passportMatch.vin}
              </p>
              <p className="text-xs text-slate-600 font-mono">VIN {passportMatch.vin} · not currently listed on the marketplace</p>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="vehicle-search-error">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Live marketplace results could not be loaded. Please try again shortly.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-500" data-testid="vehicle-search-loading">
            <Loader2 className="w-5 h-5 animate-spin" /> Searching live listings…
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-4">{listings.length} vehicles found</p>
            {listings.length === 0 && !loadError && (
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-500" data-testid="vehicle-search-empty">
                No listings match your search. Try a different identifier or clear the filters.
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {listings.map((vehicle) => (
                <Link key={vehicle.vin} to={`/marketplace/listing/${encodeURIComponent(vehicle.vin)}`} className="group" data-testid="vehicle-search-result">
                  <Card className="overflow-hidden border-0 card-shadow hover-lift h-full bg-white">
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <ListingImage
                        src={vehicle.primary_image_url}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full"
                        imgClassName="group-hover:scale-105 transition-transform duration-500"
                      />
                      {vehicle.passport_verified && (
                        <Badge className="absolute top-3 left-3 bg-green-500 text-white text-[10px]">
                          <CheckCircle className="w-3 h-3 mr-1" /> Verified
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-sm">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <p className="text-lg font-bold text-orange-600 mt-1">${(vehicle.price ?? 0).toLocaleString()}</p>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{(vehicle.mileage ?? 0).toLocaleString()} km</span>
                        {vehicle.transmission && <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" />{vehicle.transmission}</span>}
                        {vehicle.fuel_type && <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{vehicle.fuel_type}</span>}
                      </div>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">
                          {vehicle.seller_display_label || (vehicle.seller_type === 'dealer' ? 'Dealer' : 'Private seller')}
                        </span>
                        {vehicle.location && (
                          <span className="flex items-center gap-1 text-xs text-gray-400"><MapPin className="w-3 h-3" />{vehicle.location}</span>
                        )}
                      </div>
                      <span className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-gray-950 px-3 py-2 text-sm font-semibold text-white" data-testid="vehicle-search-view-passport">
                        View Passport
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
