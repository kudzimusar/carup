import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { summaryLocationLine } from '@/lib/governedLocation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ArrowRight,
  CheckCircle,
  ClipboardCheck,
  FileSearch,
  Gauge,
  KeyRound,
  Lock,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  Tag,
  UserRoundCheck,
} from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { BuyerAssistantDrawer } from '@/components/marketplace/BuyerAssistantDrawer'
import type { MarketplaceListingSummary } from '@/types'

const popularSearches = [
  'Brand New',
  'Recently Imported',
  'Fresh Imports',
  'Locally Used',
  'Second Hand',
  // 'Duty Cleared', 'ZIMRA Verified' and 'CID Clear' were removed here. They are
  // GOVERNMENT_APPROVAL_FACTS with no legitimate writer anywhere in the platform, so the tags they
  // filter on are now suppressed server-side — these chips would return zero results while still
  // advertising a capability CarUp cannot substantiate.
  'Low Mileage',
  'Toyota Hilux',
  'Honda Fit',
  'Mazda Demio',
  'SUVs',
  'Under $5,000',
  'Under $10,000',
  'Dealer Verified',
  'Parts & Accessories',
  'Harare',
  'Bulawayo',
]

const trustStrip = [
  { label: 'Plate Check', icon: FileSearch },
  { label: 'Evidence Timeline', icon: ClipboardCheck },
  { label: 'Owner Privacy', icon: UserRoundCheck },
  { label: 'Trust Score', icon: Gauge },
  { label: 'SafePay Ready', icon: Lock },
  { label: 'PartSentry', icon: Package, testId: 'home-partsentry-trust-signal' },
]

const productMap = ['Buy Cars', 'Sell Cars', 'Verify Cars', 'Trade Parts']

const howItWorks = [
  {
    title: 'Search cars',
    description: 'Browse verified listings by make, location, budget, or category.',
    icon: Search,
  },
  {
    title: 'Verify Passport',
    description: 'Open the vehicle Passport with plate, VIN, chassis, and trust data.',
    icon: ShieldCheck,
  },
  {
    title: 'Reserve / SafePay',
    description: 'Use CarUp reservation and SafePay flows where the listing supports it.',
    icon: KeyRound,
  },
  {
    title: 'Complete ownership transfer',
    description: 'Move forward with clearer identity, seller, and history context.',
    icon: CheckCircle,
  },
]

// A price shows only when the amount AND a real currency are both recorded — no fabricated USD.
function governedPrice(price: unknown, currency: unknown): string | null {
  const amount = typeof price === 'number' && Number.isFinite(price) ? price : null
  const ccy = typeof currency === 'string' && currency.trim() ? currency.trim() : null
  if (amount === null || ccy === null) return null
  return `${ccy} ${amount.toLocaleString()}`
}

function vehiclePassportPath(vin: string) {
  return `/marketplace/${encodeURIComponent(vin)}`
}

// Governed marketplace tags are the honest per-vehicle signals (e.g. 'zimra_verified'); humanise the
// snake_case token for display, exactly as the Marketplace card does. These are NOT a trust score.
function humanizeTag(tag: string): string {
  return tag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export default function Landing() {
  const navigate = useNavigate()
  const [buyQuery, setBuyQuery] = useState('')
  const [verifyBeforeBuyQuery, setVerifyBeforeBuyQuery] = useState('')
  const [sellSectionQuery, setSellSectionQuery] = useState('')

  // Featured cars are the LIVE canonical published listings — never the old mock inventory with its
  // fabricated `isFeatured`/`isVerified`/`trustScore` fields. Same VIN, same governed facts as the
  // Marketplace (Invariant 13), because this reads the same /marketplace/listings contract.
  const { fetchMarketplaceListings } = useCarUpApi()
  const [featuredVehicles, setFeaturedVehicles] = useState<MarketplaceListingSummary[]>([])
  // "Still loading" and "the read failed" are NOT "the marketplace is empty". Collapsing all three into
  // an empty array made the page assert there are no published listings when it simply did not know.
  const [featuredState, setFeaturedState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  useEffect(() => {
    let cancelled = false
    fetchMarketplaceListings({ limit: 6, sort: 'newest' })
      .then(res => {
        if (cancelled) return
        setFeaturedVehicles(Array.isArray(res?.listings) ? res.listings : [])
        setFeaturedState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setFeaturedVehicles([])
        setFeaturedState('unavailable')
      })
    return () => { cancelled = true }
  }, [fetchMarketplaceListings])

  const heroVehicle = featuredVehicles[0] ?? null

  const submitBuy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Forward the actual query to the Marketplace's `q` contract instead of discarding it.
    const q = buyQuery.trim()
    navigate(q ? `/marketplace?q=${encodeURIComponent(q)}` : '/marketplace')
  }

  const openPassport = (identifier: string) => {
    const cleanIdentifier = identifier.trim()
    if (!cleanIdentifier) return
    navigate(`/marketplace/${encodeURIComponent(cleanIdentifier)}`)
  }

  const sellerHandoff = () => {
    navigate('/sell')
  }

  const submitVerifyBeforeBuy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    openPassport(verifyBeforeBuyQuery)
  }

  const submitSellSection = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sellerHandoff()
  }

  return (
    <div className="min-h-screen bg-white text-gray-950">
      <section className="relative overflow-hidden bg-[#07101f] text-white" data-testid="home-hero">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-12 h-[440px] w-[440px] rounded-full bg-orange-500/20 blur-[120px]" />
          <div className="absolute -right-40 -top-24 h-[560px] w-[560px] rounded-full bg-sky-600/15 blur-[140px]" />
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(115deg,transparent_0%,transparent_43%,rgba(255,255,255,0.06)_43%,rgba(255,255,255,0.06)_44%,transparent_44%,transparent_100%)]" />
        </div>

        <div className="section-padding relative mx-auto max-w-[1440px] py-10 sm:py-14 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)] lg:items-center">
            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">
                Zimbabwe's automotive trust network
              </p>
              <h1 className="mt-4 max-w-4xl text-5xl font-black leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                Buy. Sell. Verify.
                <span className="block text-orange-400">Know the car before the deal.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                CarUp connects the marketplace, Vehicle Passport, evidence, parts, garages, insurance,
                finance, imports and SafePay around one vehicle identity — so every next step can build
                on what is actually recorded.
              </p>

              <div className="mt-7 flex flex-wrap gap-2" aria-label="Primary CarUp journeys">
                <Button asChild className="rounded-none border-l-4 border-white bg-orange-500 px-5 text-white hover:bg-orange-400">
                  <Link to="/marketplace">Buy Cars</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-none border-slate-600 bg-transparent px-5 text-white hover:border-orange-400 hover:bg-slate-900 hover:text-white">
                  <Link to="/sell">Sell Cars</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-none border-slate-600 bg-transparent px-5 text-white hover:border-orange-400 hover:bg-slate-900 hover:text-white">
                  <Link to="/search">Verify Cars</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-none border-slate-600 bg-transparent px-5 text-white hover:border-orange-400 hover:bg-slate-900 hover:text-white">
                  <Link to="/marketplace/parts">Trade Parts</Link>
                </Button>
              </div>

              <form onSubmit={submitBuy} className="mt-8 max-w-3xl" data-testid="home-primary-search">
                <label htmlFor="home-buy-search" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Start anywhere — make, model, location, VIN or seller
                </label>
                <div className="grid gap-2 border-l-4 border-orange-500 bg-white p-2 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="home-buy-search"
                      value={buyQuery}
                      onChange={event => setBuyQuery(event.target.value)}
                      placeholder="Search cars, VIN, location or seller"
                      className="h-13 border-0 bg-transparent pl-12 text-base text-slate-950 shadow-none focus-visible:ring-0"
                      data-testid="home-buy-search"
                    />
                  </div>
                  <Button type="submit" className="h-13 rounded-none bg-slate-950 px-6 font-bold text-white hover:bg-orange-600" data-testid="home-search-submit">
                    Search Marketplace
                  </Button>
                </div>
              </form>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <BuyerAssistantDrawer
                  triggerLabel="Ask Gutu AI"
                  triggerClassName="rounded-none border-orange-400/40 bg-orange-400/10 text-orange-100 hover:bg-orange-400/20 hover:text-white"
                />
                <p className="max-w-md text-xs leading-5 text-slate-400">
                  Ask by text or voice about a budget, vehicle type, import journey or what to verify before paying.
                </p>
              </div>
            </div>

            <div className="relative min-h-[360px] sm:min-h-[430px] lg:min-h-[520px]">
              <div className="absolute -right-10 top-0 h-[82%] w-[92%] border border-orange-400/25 [clip-path:polygon(14%_0,100%_0,100%_88%,76%_100%,0_86%,0_16%)]" />
              {heroVehicle ? (
                <>
                  <ListingImage
                    src={heroVehicle.primary_image_url}
                    alt={[heroVehicle.year, heroVehicle.make, heroVehicle.model].filter(Boolean).join(' ') || 'Featured vehicle'}
                    className="absolute inset-x-0 top-5 h-[78%] w-full object-cover shadow-[0_35px_90px_rgba(0,0,0,0.45)] [clip-path:polygon(12%_0,100%_0,100%_88%,78%_100%,0_86%,0_16%)]"
                  />
                  <div className="absolute bottom-8 left-0 max-w-[78%] bg-orange-500 px-5 py-4 text-slate-950 shadow-[12px_12px_0_rgba(255,255,255,0.08)]">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em]">Live Marketplace</p>
                    <p className="mt-1 text-xl font-black">
                      {[heroVehicle.year, heroVehicle.make, heroVehicle.model].filter(Boolean).join(' ')}
                    </p>
                    <p className="mt-1 text-xs font-semibold">
                      {summaryLocationLine(heroVehicle.location, heroVehicle.location_state).label}
                    </p>
                  </div>
                  <Link
                    to={vehiclePassportPath(heroVehicle.vin)}
                    className="absolute bottom-2 right-0 inline-flex items-center gap-2 bg-white px-4 py-3 text-sm font-black text-slate-950 shadow-xl transition hover:bg-slate-100"
                    data-testid="featured-view-passport"
                  >
                    Open Passport <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center border border-slate-700 bg-slate-900/50 text-sm text-slate-400 [clip-path:polygon(12%_0,100%_0,100%_88%,78%_100%,0_86%,0_16%)]">
                  Marketplace vehicle preview loading…
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 grid border-y border-white/10 sm:grid-cols-2 lg:grid-cols-4" data-testid="home-ecosystem-promotions">
            {[
              ['Finance', 'Compare buyer finance routes', '/pricing'],
              ['Insurance', 'Protect the vehicle and the transaction', '/insurance'],
              ['Garages', 'Inspection, service and trusted work', '/garages'],
              ['Diaspora & Imports', 'Source and move vehicles into Zimbabwe', '/diaspora'],
            ].map(([title, copy, href], index) => (
              <Link
                key={title}
                to={href}
                className={`group px-1 py-5 sm:px-5 ${index > 0 ? 'sm:border-l sm:border-white/10' : ''}`}
              >
                <p className="text-sm font-black text-white group-hover:text-orange-300">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{copy}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b bg-white" data-testid="home-trust-strip">
        <div className="section-padding mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-6 gap-y-3 py-4 lg:justify-between">
          {trustStrip.map((item, index) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 ${index > 0 ? 'lg:border-l lg:border-gray-200 lg:pl-6' : ''}`}
              data-testid={item.testId}
            >
              <item.icon className="h-5 w-5 text-orange-500" />
              <span className="text-sm font-semibold text-gray-800">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <Badge className="mb-3 rounded-none bg-blue-100 text-blue-700 hover:bg-blue-100">Featured Listings</Badge>
              <h2 className="text-3xl font-bold">Shop cars with governed trust signals</h2>
              <p className="mt-2 max-w-2xl text-gray-600">
                Live published listings. Each vehicle shows only the governed signals it has earned —
                open its Passport for the full, versioned trust assessment.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/marketplace">
                Browse all cars <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {featuredState === 'loading' && (
            <p className="mt-8 text-gray-500" data-testid="featured-loading">Loading featured listings…</p>
          )}
          {featuredState === 'unavailable' && (
            <p className="mt-8 text-amber-700" data-testid="featured-unavailable">
              Featured listings are unavailable right now. This is a loading failure, not an empty marketplace.
            </p>
          )}
          {featuredState === 'ready' && featuredVehicles.length === 0 && (
            <p className="mt-8 text-gray-500" data-testid="featured-empty">No published listings to feature yet.</p>
          )}
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredVehicles.map(vehicle => {
              const price = governedPrice(vehicle.price, vehicle.currency)
              return (
              <Card key={vehicle.vin} className="overflow-hidden rounded-none border border-slate-200 border-t-4 border-t-slate-950 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)] transition hover:border-t-orange-500 hover:shadow-[0_18px_44px_rgba(15,23,42,0.12)]" data-testid="featured-verified-car">
                <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                  <ListingImage
                    src={vehicle.primary_image_url}
                    alt={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                    className="h-full w-full"
                  />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                    {/* Governed per-vehicle signals only — no fabricated green "Verified" badge and no
                        trust number. The full assessment lives on the Passport. */}
                    {(vehicle.marketplace_tags ?? []).slice(0, 2).map(tag => (
                      <Badge key={tag} className="bg-gray-950/80 text-white">{humanizeTag(tag)}</Badge>
                    ))}
                  </div>
                </div>
                <CardContent className="p-5">
                  <h3 className="font-semibold">
                    {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                  </h3>
                  {/* Stated, never suppressed. Hiding the row made an absent location silent, and
                      silence is the one rendering that lets absence read as proof. */}
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" />
                    <span data-testid="listing-location">
                      {summaryLocationLine(vehicle.location, vehicle.location_state).label}
                    </span>
                  </p>
                  {price && <p className="mt-3 text-xl font-bold text-orange-600">{price}</p>}
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
                    {Number.isFinite(vehicle.mileage as number) && <span>{(vehicle.mileage as number).toLocaleString()} km</span>}
                    {vehicle.transmission && <span>{vehicle.transmission}</span>}
                    {vehicle.fuel_type && <span>{vehicle.fuel_type}</span>}
                  </div>
                  <Button asChild className="mt-5 w-full bg-gray-950 text-white hover:bg-gray-800" data-testid="featured-view-passport">
                    <Link to={vehiclePassportPath(vehicle.vin)}>
                      View Passport <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )})}
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-14">
        <div className="section-padding mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-2">
          <Card className="border-0 bg-[hsl(222,47%,10%)] text-white shadow-md">
            <CardContent className="p-6 md:p-8">
              <Badge className="mb-4 rounded-none bg-white/10 text-white hover:bg-white/10">Sell with a Passport</Badge>
              <h2 className="text-3xl font-bold">Sell your car with a trusted Passport</h2>
              <p className="mt-3 text-gray-300">
                Start with the current seller verification handoff and create a listing through CarUp.
              </p>
              <form onSubmit={submitSellSection} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={sellSectionQuery}
                  onChange={event => setSellSectionQuery(event.target.value)}
                  placeholder="Plate or VIN"
                  className="h-12 border-white/20 bg-white/10 font-mono text-white placeholder:text-gray-400"
                  data-testid="sell-car-input"
                />
                <Button type="submit" className="h-12 bg-white text-gray-950 hover:bg-gray-100">
                  Start Seller Verification
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardContent className="p-6 md:p-8">
              <Badge className="mb-4 rounded-none bg-green-100 text-green-700 hover:bg-green-100">Verify before you buy</Badge>
              <h2 className="text-3xl font-bold">Already found a car elsewhere?</h2>
              <p className="mt-3 text-gray-600">Check its CarUp Passport before you pay.</p>
              <form onSubmit={submitVerifyBeforeBuy} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Input
                  value={verifyBeforeBuyQuery}
                  onChange={event => setVerifyBeforeBuyQuery(event.target.value)}
                  placeholder="Plate, VIN, or chassis"
                  className="h-12 font-mono"
                  data-testid="verify-before-buy-input"
                />
                <Button type="submit" className="h-12 bg-orange-500 text-white hover:bg-orange-600">
                  Verify Vehicle
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <Badge className="mb-3 rounded-none bg-orange-100 text-orange-700 hover:bg-orange-100">Popular Zimbabwe Categories</Badge>
              <h2 className="text-2xl font-bold md:text-3xl">Start with what buyers ask for most</h2>
            </div>
            <p className="max-w-lg text-sm text-gray-600">
              Quick-search shortcuts — each opens the Marketplace with that term applied.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {popularSearches.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => navigate(`/marketplace?q=${encodeURIComponent(chip)}`)}
                className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                data-testid="popular-search-chip"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="max-w-2xl">
            <Badge className="mb-3 rounded-none bg-orange-100 text-orange-700 hover:bg-orange-100">How CarUp Works</Badge>
            <h2 className="text-3xl font-bold">From search to transfer, keep the trust record visible</h2>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-4">
            {howItWorks.map((item, index) => (
              <Card key={item.title} className="rounded-none border border-slate-200 border-t-4 border-t-orange-500 shadow-none">
                <CardContent className="p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-sm font-bold text-orange-600">0{index + 1}</p>
                  <h3 className="mt-1 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[hsl(222,47%,8%)] py-14 text-white">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <Badge className="mb-3 rounded-none bg-orange-500/20 text-orange-100 hover:bg-orange-500/20">
                Why CarUp is safer
              </Badge>
              <h2 className="max-w-2xl text-3xl font-bold">
                Buy, verify, and sell with Passport-backed confidence
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="bg-orange-500 text-white hover:bg-orange-600">
                <Link to="/marketplace">Buy Cars</Link>
              </Button>
              <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                <Link to="/search">Verify a Vehicle</Link>
              </Button>
            </div>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-4">
            <div>
              <h3 className="font-semibold">Private seller details stay protected</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Homepage cards avoid exposing private owner names or phone numbers.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Passport context before payment</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Buyers can open the current vehicle Passport route from VIN-based listing links.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Seller trust starts early</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Sellers are guided into the existing account and listing flow before publishing.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">PartSentry connects repairs and parts</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                PartSentry helps identify swapped, stolen, or undocumented parts by connecting
                repair logs, work orders, mechanics, and parts history to the vehicle Passport.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
