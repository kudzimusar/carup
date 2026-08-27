import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle,
  ArrowRight,
  CarFront,
  FileSearch,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { looksLikeIdentifier } from '@/lib/marketplaceParams'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary, Vehicle } from '@/types'

function labelize(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function VehicleSearch() {
  const {
    fetchMarketplaceListings,
    fetchMarketplaceCategories,
    lookupVehiclePassport,
    fetchMarketplaceListingDetail,
  } = useCarUpApi()

  const [query, setQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [make, setMake] = useState('All')
  const [category, setCategory] = useState('All')

  const [listings, setListings] = useState<MarketplaceListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [passportMatch, setPassportMatch] = useState<Vehicle | null>(null)
  const [passportListed, setPassportListed] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState<{ slug: string; label: string }[]>([])

  useEffect(() => {
    const timer = setTimeout(() => setCommittedQuery(query.trim()), 350)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let mounted = true
    fetchMarketplaceCategories()
      .then(data => {
        if (!mounted) return
        setCategoryOptions((data?.condition_categories || []).map(c => ({
          slug: c.slug,
          label: c.label || labelize(c.slug),
        })))
      })
      .catch(() => { /* listing-derived categories below */ })
    return () => { mounted = false }
  }, [fetchMarketplaceCategories])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setLoadError(false)

      let matched: Vehicle | null = null
      if (looksLikeIdentifier(committedQuery)) {
        try {
          const passport = await lookupVehiclePassport(committedQuery)
          if (passport?.vehicle?.vin) matched = passport.vehicle
        } catch {
          // Public lookup is fail-closed. A miss is never published as proof that a vehicle does not exist.
        }
      }

      let matchedListed = false
      if (matched?.vin) {
        try {
          await fetchMarketplaceListingDetail(matched.vin)
          matchedListed = true
        } catch {
          // Passport record exists but is not currently public marketplace inventory.
        }
      }

      if (cancelled) return
      setPassportMatch(matched)
      setPassportListed(matchedListed)

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
  }, [
    committedQuery,
    make,
    category,
    fetchMarketplaceListings,
    lookupVehiclePassport,
    fetchMarketplaceListingDetail,
  ])

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
    <div className="min-h-screen bg-white text-slate-950" data-testid="vehicle-search-page">
      <section className="relative overflow-hidden bg-[#060a11] text-white">
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.18),transparent_27%),linear-gradient(120deg,transparent_0%,transparent_62%,rgba(255,255,255,0.04)_62%,rgba(255,255,255,0.04)_63%,transparent_63%)]" />
        <div className="section-padding relative mx-auto max-w-[1440px] pb-24 pt-9 sm:pb-28 lg:pt-14">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-14">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">
                <ShieldCheck className="h-4 w-4" /> CarUp Verify
              </div>
              <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.06em] sm:text-6xl">
                Verify before commitment.
                <span className="mt-2 block text-orange-400">Silence is not evidence.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Search live published vehicles by make/model, or use an exact VIN to look for a public
                Passport. Protected identifiers such as plate, chassis and temporary ID require a signed-in account.
              </p>
            </div>

            <div className="grid border-y border-white/10 sm:grid-cols-3" data-testid="vehicle-search-policy">
              <div className="px-0 py-5 sm:px-5">
                <FileSearch className="h-5 w-5 text-orange-400" />
                <p className="mt-3 text-xs font-black uppercase tracking-[0.12em]">Exact VIN</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Public lookup is available.</p>
              </div>
              <div className="border-t border-white/10 px-0 py-5 sm:border-l sm:border-t-0 sm:px-5">
                <Lock className="h-5 w-5 text-orange-400" />
                <p className="mt-3 text-xs font-black uppercase tracking-[0.12em]">Protected IDs</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Plate/chassis lookup requires sign-in.</p>
              </div>
              <div className="border-t border-white/10 px-0 py-5 sm:border-l sm:border-t-0 sm:px-5">
                <Sparkles className="h-5 w-5 text-orange-400" />
                <p className="mt-3 text-xs font-black uppercase tracking-[0.12em]">Marketplace browse</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Published inventory stays separate from private identifiers.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="section-padding relative mx-auto -mt-14 max-w-[1440px] pb-16">
        <section className="relative z-10 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]" data-testid="vehicle-search-command">
          <div className="border-b border-slate-200 px-4 py-3 sm:px-6">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-600">Search or verify</p>
            <p className="mt-0.5 text-xs text-slate-500" data-testid="vehicle-search-scope">Exact VIN lookup, or browse by make/model and listing category.</p>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_0.7fr_0.8fr]">
            <div className="relative border-b border-slate-200 lg:border-b-0 lg:border-r">
              <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-orange-500" />
              <Input
                placeholder="Enter an exact VIN, or search make and model…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="h-16 rounded-none border-0 pl-14 text-base font-semibold shadow-none placeholder:font-normal focus-visible:ring-0 sm:h-[72px]"
                data-testid="vehicle-search-input"
              />
            </div>

            <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
              <Select value={make} onValueChange={setMake}>
                <SelectTrigger className="h-16 rounded-none border-0 px-5 shadow-none focus:ring-0 sm:h-[72px]">
                  <div className="text-left">
                    <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Make</span>
                    <SelectValue placeholder="Make" />
                  </div>
                </SelectTrigger>
                <SelectContent>{makes.map(m => <SelectItem key={m} value={m}>{m === 'All' ? 'Any make' : m}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-16 rounded-none border-0 px-5 shadow-none focus:ring-0 sm:h-[72px]">
                  <div className="text-left">
                    <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Listing category</span>
                    <SelectValue placeholder="Category" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">Any category</SelectItem>
                  {categories.map(c => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <p className="mt-4 max-w-4xl text-[11px] leading-5 text-slate-500" data-testid="vehicle-search-lookup-policy">
          Signed out, plate/chassis/temporary-ID searches return the same outcome whether or not a matching
          vehicle exists. An empty result therefore must not be read as proof that the identifier is unknown.
        </p>

        {passportMatch && passportListed && (
          <Link
            to={`/marketplace/listing/${encodeURIComponent(passportMatch.vin)}`}
            className="group mt-8 grid gap-4 bg-[#08111f] p-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.16)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
            data-testid="vehicle-search-passport-match"
          >
            <div className="flex h-12 w-12 items-center justify-center bg-orange-500 text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">Public Passport match</p>
              <p className="mt-1 truncate text-xl font-black tracking-[-0.03em]">
                {[passportMatch.year, passportMatch.make, passportMatch.model].filter(Boolean).join(' ') || passportMatch.vin}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-slate-400">VIN {passportMatch.vin}</p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-black text-orange-300 group-hover:text-orange-200">
              Open Passport <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        )}

        {passportMatch && !passportListed && (
          <div
            className="mt-8 border-y border-slate-200 bg-slate-50 px-5 py-5"
            data-testid="vehicle-search-passport-history-only"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
              <div>
                <p className="font-black text-slate-900">
                  Vehicle history record found: {[passportMatch.year, passportMatch.make, passportMatch.model].filter(Boolean).join(' ') || passportMatch.vin}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-500">VIN {passportMatch.vin} · not currently listed on the marketplace</p>
              </div>
            </div>
          </div>
        )}

        {loadError && (
          <div className="mt-8 flex items-center gap-2 border-y border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="vehicle-search-error">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Live marketplace results could not be loaded. CarUp has not substituted fabricated inventory.
          </div>
        )}

        <div className="mt-12 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Published Marketplace</p>
            <h2 className="mt-1 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Vehicles you can inspect now.</h2>
          </div>
          {!loading && (
            <p className="text-sm text-slate-500">
              <span className="text-2xl font-black text-slate-950">{listings.length}</span> {listings.length === 1 ? 'vehicle' : 'vehicles'} found
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500" data-testid="vehicle-search-loading">
            <Loader2 className="h-5 w-5 animate-spin" /> Searching live listings…
          </div>
        ) : (
          <>
            <span className="sr-only">{listings.length} vehicles found</span>
            {listings.length === 0 && !loadError && (
              <div className="border-y border-dashed border-slate-300 px-6 py-16 text-center" data-testid="vehicle-search-empty">
                <CarFront className="mx-auto h-10 w-10 text-slate-300" />
                <h3 className="mt-4 text-xl font-black">No published listings match this search.</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  Broaden the make/model filters, or use the appropriate signed-in identifier lookup.
                  CarUp will not fill the gap with demo inventory.
                </p>
              </div>
            )}

            {listings.length > 0 && (
              <div className="mt-8 grid gap-x-7 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
                {listings.map(vehicle => (
                  <MarketplaceListingCard
                    key={vehicle.vin}
                    vehicle={marketplaceListingToCardModel(vehicle)}
                    href={`/marketplace/listing/${encodeURIComponent(vehicle.vin)}`}
                    dataTestId="vehicle-search-result"
                    ctaLabel="Open listing & Passport"
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
