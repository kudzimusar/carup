import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  BookOpen,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Gauge,
  Globe2,
  Headphones,
  KeyRound,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import { BuyerAssistantDrawer } from '@/components/marketplace/BuyerAssistantDrawer'
import { JourneyMediaStory, type JourneyScene } from '@/components/home/JourneyMediaStory'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'
import { summaryLocationLine } from '@/lib/governedLocation'
import type { MarketplaceListingSummary } from '@/types'

const popularSearches = [
  { label: 'Brand New', href: '/marketplace?category=brand_new' },
  { label: 'Recently Imported', href: '/marketplace?category=recently_imported' },
  { label: 'Fresh Imports', href: '/marketplace?tag=fresh_import' },
  { label: 'Locally Used', href: '/marketplace?category=locally_used' },
  { label: 'Second Hand', href: '/marketplace?category=second_hand' },
  { label: 'Low Mileage', href: '/marketplace?tag=low_mileage' },
  { label: 'Toyota Hilux', href: '/marketplace?make=Toyota&model=Hilux' },
  { label: 'Honda Fit', href: '/marketplace?make=Honda&model=Fit' },
  { label: 'Mazda Demio', href: '/marketplace?make=Mazda&model=Demio' },
  { label: 'Passport Verified', href: '/marketplace?tag=passport_verified' },
  { label: 'Under $5,000', href: '/marketplace?maxPrice=5000' },
  { label: 'Under $10,000', href: '/marketplace?maxPrice=10000' },
  { label: 'Dealer Verified', href: '/marketplace?tag=dealer_verified' },
  { label: 'Parts & Accessories', href: '/marketplace/parts' },
  { label: 'Harare', href: '/marketplace?location=Harare' },
  { label: 'Bulawayo', href: '/marketplace?location=Bulawayo' },
  { label: 'Diesel', href: '/marketplace?fuel=Diesel' },
  { label: 'Automatic', href: '/marketplace?transmission=Automatic' },
  { label: 'PartSentry Checked', href: '/marketplace?tag=partsentry_checked' },
]

const trustStrip = [
  { label: 'Plate Check', icon: FileSearch },
  { label: 'Evidence Timeline', icon: ClipboardCheck },
  { label: 'Owner Privacy', icon: Lock },
  { label: 'Canonical Trust', icon: Gauge },
  { label: 'SafePay routes', icon: KeyRound },
  { label: 'PartSentry', icon: Package, testId: 'home-partsentry-trust-signal' },
]

const ecosystemJourneys = [
  {
    eyebrow: 'Buy',
    title: 'Find the right car',
    copy: 'Search published inventory, compare vehicles and open the Passport before the next decision.',
    href: '/marketplace',
    icon: CarFront,
    scene: 'buy' as JourneyScene,
  },
  {
    eyebrow: 'Sell',
    title: 'Turn your car into a credible listing',
    copy: 'Build the vehicle, listing and photos first. Authenticate when you reach the commitment boundary.',
    href: '/sell',
    icon: ArrowUpRight,
    scene: 'sell' as JourneyScene,
  },
  {
    eyebrow: 'Verify',
    title: 'Found a car somewhere else?',
    copy: 'Use the public VIN route or sign in for protected identifier lookups before you treat silence as evidence.',
    href: '/search',
    icon: ShieldCheck,
    scene: 'verify' as JourneyScene,
  },
  {
    eyebrow: 'Diaspora',
    title: 'Source and move a vehicle',
    copy: 'Connect import orders, documents, shipment context and the vehicle record instead of losing the trail.',
    href: '/diaspora',
    icon: Globe2,
    scene: 'diaspora' as JourneyScene,
  },
  {
    eyebrow: 'Finance',
    title: 'Explore how to fund the deal',
    copy: 'Move from vehicle discovery into the finance routes CarUp can actually support.',
    href: '/pricing',
    icon: BadgeDollarSign,
    scene: 'finance' as JourneyScene,
  },
  {
    eyebrow: 'Protect',
    title: 'Connect insurance to the vehicle',
    copy: 'Keep protection choices beside the same vehicle identity and buying context.',
    href: '/insurance',
    icon: ShieldCheck,
    scene: 'protect' as JourneyScene,
  },
  {
    eyebrow: 'Maintain',
    title: 'Find garages and service context',
    copy: 'Connect service work, mechanics and the lifecycle record instead of treating maintenance as a separate app.',
    href: '/garages',
    icon: Wrench,
    scene: 'maintain' as JourneyScene,
  },
  {
    eyebrow: 'Parts',
    title: 'Match parts to the vehicle',
    copy: 'Use normalized fitment and PartSentry context without fabricating availability.',
    href: '/marketplace/parts',
    icon: Package,
    scene: 'parts' as JourneyScene,
  },
]

const dealFlow = [
  ['01', 'Discover', 'Search live inventory or start from a vehicle you already found.'],
  ['02', 'Understand', 'Read seller-stated facts beside governed Trust, evidence and lifecycle context.'],
  ['03', 'Act', 'Inquire, inspect, compare, finance or sell without breaking the vehicle thread.'],
  ['04', 'Keep the record', 'Service, parts, protection and ownership activity continue around the same identity.'],
]

export default function Landing() {
  const navigate = useNavigate()
  const { fetchMarketplaceListings } = useCarUpApi()
  const [buyQuery, setBuyQuery] = useState('')
  const [verifyQuery, setVerifyQuery] = useState('')
  const [featuredVehicles, setFeaturedVehicles] = useState<MarketplaceListingSummary[]>([])
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
  const heroImage = heroVehicle && canRenderMarketplacePrimaryImage(heroVehicle.primary_image_state, heroVehicle.primary_image_url)
    ? heroVehicle.primary_image_url
    : null

  const journeyMediaAt = (index: number) => {
    if (featuredVehicles.length === 0) return { src: null, alt: 'CarUp vehicle journey' }
    const vehicle = featuredVehicles[index % featuredVehicles.length]
    const src = canRenderMarketplacePrimaryImage(vehicle.primary_image_state, vehicle.primary_image_url)
      ? vehicle.primary_image_url
      : null
    const alt = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'CarUp Marketplace vehicle'
    return { src, alt }
  }

  const submitBuy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const q = buyQuery.trim()
    navigate(q ? `/marketplace?q=${encodeURIComponent(q)}` : '/marketplace')
  }

  const submitVerify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const vin = verifyQuery.trim()
    navigate(vin ? `/marketplace/${encodeURIComponent(vin)}` : '/search')
  }

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <section
        className="relative overflow-hidden bg-[#060a11] text-white"
        data-testid="home-hero"
      >
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_15%_15%,rgba(249,115,22,0.18),transparent_24%),linear-gradient(118deg,transparent_0%,transparent_61%,rgba(255,255,255,0.045)_61%,rgba(255,255,255,0.045)_62%,transparent_62%)]" />

        <div className="section-padding relative mx-auto max-w-[1440px] pb-16 pt-8 sm:pb-20 lg:pb-24 lg:pt-12">
          <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-end lg:gap-14">
            <div className="relative z-10 lg:pb-8">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-orange-400">
                <Sparkles className="h-4 w-4" /> One CarUp · one vehicle thread
              </div>
              <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.88] tracking-[-0.06em] sm:text-6xl lg:text-[5.25rem]">
                Buy. Sell. Verify.
                <span className="mt-2 block text-orange-400">Keep the whole car journey connected.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                CarUp brings the marketplace, Vehicle Passport, evidence, parts, garages, finance,
                insurance, imports and transaction routes around the same vehicle identity.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                <Button asChild className="h-12 rounded-none bg-orange-500 px-6 font-black text-white hover:bg-orange-600">
                  <Link to="/marketplace">Buy Cars <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-none border-white/25 bg-transparent px-6 font-bold text-white hover:bg-white/10 hover:text-white">
                  <Link to="/sell">Sell Cars</Link>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-none border-white/25 bg-transparent px-6 font-bold text-white hover:bg-white/10 hover:text-white">
                  <Link to="/search">Verify Cars</Link>
                </Button>
              </div>

              <form
                onSubmit={submitBuy}
                className="mt-9 max-w-3xl bg-white shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
                data-testid="home-primary-search"
              >
                <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-600">Start with the car</p>
                  <p className="mt-0.5 text-xs text-slate-500">Search make, model, location, seller or a vehicle identifier.</p>
                </div>
                <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-orange-500" />
                    <Input
                      value={buyQuery}
                      onChange={event => setBuyQuery(event.target.value)}
                      placeholder="Try “Hilux diesel”, “Harare” or a VIN…"
                      className="h-16 rounded-none border-0 bg-white pl-14 text-base font-semibold text-slate-950 shadow-none placeholder:font-normal focus-visible:ring-0"
                      data-testid="home-buy-search"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-16 rounded-none bg-slate-950 px-7 font-black text-white hover:bg-orange-600"
                    data-testid="home-search-submit"
                  >
                    Search Marketplace
                  </Button>
                </div>
              </form>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <a href="#talk-to-carup" className="inline-flex items-center gap-2 border-b border-orange-400 pb-1 text-xs font-black text-orange-200 hover:text-white">
                  <MessageCircle className="h-4 w-4 text-orange-400" /> Ask CarUp what to do next
                </a>
                <Link to="/contact" className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white">
                  Human help <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="relative min-h-[420px] sm:min-h-[520px] lg:min-h-[610px]" data-testid="home-live-showroom">
              <div className="absolute -right-8 top-0 h-[90%] w-[94%] border border-white/10 [clip-path:polygon(10%_0,100%_0,100%_87%,82%_100%,0_91%,0_14%)]" />
              {heroVehicle ? (
                <Link
                  to={`/marketplace/${encodeURIComponent(heroVehicle.vin)}`}
                  className="group absolute inset-x-0 top-5 block h-[84%] overflow-hidden bg-slate-900 shadow-[0_40px_110px_rgba(0,0,0,0.58)] [clip-path:polygon(8%_0,100%_0,100%_88%,82%_100%,0_91%,0_14%)]"
                  data-testid="featured-view-passport"
                >
                  <ListingImage
                    src={heroImage}
                    alt={[heroVehicle.year, heroVehicle.make, heroVehicle.model].filter(Boolean).join(' ') || 'Live marketplace vehicle'}
                    className="h-full w-full"
                    imgClassName="transition duration-700 ease-out group-hover:scale-[1.035]"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/10" />
                  <div className="absolute left-5 top-5 border border-white/20 bg-black/35 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] backdrop-blur-sm">
                    Live from Marketplace
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Start with a real vehicle</p>
                    <p className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                      {[heroVehicle.year, heroVehicle.make, heroVehicle.model].filter(Boolean).join(' ')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-orange-400" />
                        {summaryLocationLine(heroVehicle.location, heroVehicle.location_state).label}
                      </span>
                      <span className="inline-flex items-center gap-2 font-bold text-white">
                        Open vehicle <ArrowRight className="h-4 w-4 text-orange-400" />
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="absolute inset-x-0 top-5 flex h-[84%] items-center justify-center bg-slate-900 text-sm text-slate-500 [clip-path:polygon(8%_0,100%_0,100%_88%,82%_100%,0_91%,0_14%)]">
                  {featuredState === 'loading' ? 'Loading the live showroom…' : 'Live showroom unavailable'}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white" data-testid="home-trust-strip">
        <div className="section-padding mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-6 gap-y-3 py-4 lg:justify-between">
          {trustStrip.map((item, index) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 ${index > 0 ? 'lg:border-l lg:border-slate-200 lg:pl-6' : ''}`}
              data-testid={item.testId}
            >
              <item.icon className="h-4 w-4 text-orange-500" />
              <span className="text-xs font-bold text-slate-700">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#f5f6f8] py-16 sm:py-20" data-testid="home-ecosystem-promotions">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">What are you trying to do?</p>
              <h2 className="mt-3 text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-5xl">
                One front door.
                <span className="block text-slate-400">Eight useful next moves.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 lg:justify-self-end">
              Home should not make you learn CarUp’s org chart. Start with your intention and CarUp
              routes you into the right marketplace, trust, transaction or ownership surface.
            </p>
          </div>

          <div className="mt-10 grid gap-5 xl:grid-cols-2" data-testid="home-journey-grid">
            {ecosystemJourneys.map((journey, index) => {
              const media = journeyMediaAt(index)
              return (
                <Link
                  key={journey.title}
                  to={journey.href}
                  className="group grid overflow-hidden border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-1 hover:border-orange-200 hover:shadow-[0_28px_70px_rgba(15,23,42,0.10)] md:grid-cols-[0.88fr_1.12fr]"
                  data-testid="home-journey-card"
                >
                  <div className="relative flex min-h-[260px] flex-col p-6 sm:p-7">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">{journey.eyebrow}</span>
                      <span className="text-[10px] font-black tabular-nums text-slate-300">{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <h3 className="mt-8 max-w-[18rem] text-3xl font-black leading-[0.98] tracking-[-0.045em] text-slate-950">{journey.title}</h3>
                    <p className="mt-4 max-w-sm text-sm leading-6 text-slate-500">{journey.copy}</p>
                    <span className="mt-auto inline-flex items-center gap-2 pt-8 text-xs font-black text-slate-950 transition group-hover:text-orange-700">
                      Go there <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                  </div>
                  <JourneyMediaStory scene={journey.scene} image={media.src} alt={media.alt} />
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20" data-testid="home-live-inventory">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">Live Marketplace</p>
              <h2 className="mt-2 text-4xl font-black tracking-[-0.05em] sm:text-5xl">Cars worth opening.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                The same published vehicle stories used in Marketplace — not a second homepage-only card system.
              </p>
            </div>
            <Link to="/marketplace" className="inline-flex items-center gap-2 border-b border-slate-950 pb-1 text-sm font-black hover:text-orange-700">
              Browse all published vehicles <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {featuredState === 'loading' && (
            <p className="py-12 text-sm text-slate-500" data-testid="featured-loading">Loading live Marketplace vehicles…</p>
          )}
          {featuredState === 'unavailable' && (
            <p className="py-12 text-sm text-amber-700" data-testid="featured-unavailable">
              Live Marketplace vehicles are unavailable right now. CarUp has not substituted demo inventory.
            </p>
          )}
          {featuredState === 'ready' && featuredVehicles.length === 0 && (
            <p className="py-12 text-sm text-slate-500" data-testid="featured-empty">No published listings are available to feature.</p>
          )}

          {featuredVehicles.length > 0 && (
            <div className="mt-9 grid gap-x-7 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
              {featuredVehicles.slice(0, 6).map(vehicle => (
                <MarketplaceListingCard
                  key={vehicle.vin}
                  vehicle={marketplaceListingToCardModel(vehicle)}
                  href={`/marketplace/${encodeURIComponent(vehicle.vin)}`}
                  dataTestId="featured-verified-car"
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden bg-[#08111f] text-white" data-testid="home-conversion-studio">
        <div className="section-padding mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="relative border-b border-white/10 py-14 pr-0 sm:py-16 lg:border-b-0 lg:border-r lg:pr-12">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">Sell with context</p>
            <h2 className="mt-3 max-w-xl text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-5xl">
              Your listing should carry more than a photo and a price.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-300">
              Start the vehicle, listing and photos before authentication. When you are ready to publish,
              CarUp can connect the sale to the vehicle record rather than creating a disposable advert.
            </p>
            <Button asChild className="mt-7 h-12 rounded-none bg-orange-500 px-6 font-black text-white hover:bg-orange-600">
              <Link to="/sell">Start selling <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>

          <div className="py-14 pl-0 sm:py-16 lg:pl-12">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">Verify before commitment</p>
            <h2 className="mt-3 max-w-xl text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-5xl">
              Already found the car somewhere else?
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-300">
              Exact VIN lookup is public. Protected identifiers require an account, and an empty protected
              lookup is never presented as proof that a vehicle does not exist.
            </p>
            <form onSubmit={submitVerify} className="mt-7 grid max-w-xl sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={verifyQuery}
                onChange={event => setVerifyQuery(event.target.value)}
                placeholder="Enter exact VIN"
                className="h-12 rounded-none border-white/20 bg-white/10 font-mono text-white placeholder:text-slate-500"
                data-testid="verify-before-buy-input"
              />
              <Button type="submit" className="h-12 rounded-none bg-white px-6 font-black text-slate-950 hover:bg-orange-500 hover:text-white">
                Open Passport
              </Button>
            </form>
            <Link to="/search" className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-orange-300 hover:text-orange-200">
              Need protected identifier lookup? Open Verify <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">Explore the market</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Start with what buyers ask for most.</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-slate-500">Each shortcut hands the query to the live Marketplace.</p>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-1 gap-y-2 border-y border-slate-200 py-4">
            {popularSearches.map(chip => (
              <Link
                key={chip.label}
                to={chip.href}
                className="border-b-2 border-transparent px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-orange-500 hover:text-slate-950"
                data-testid="popular-search-chip"
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f5f6f8] py-16 sm:py-20">
        <div className="section-padding mx-auto max-w-[1440px]">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-600">One vehicle thread</p>
            <h2 className="mt-3 text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-5xl">
              The deal moves. The context should move with it.
            </h2>
          </div>
          <div className="mt-10 grid border-t border-slate-300 md:grid-cols-4">
            {dealFlow.map(([number, title, copy], index) => (
              <div key={title} className={`min-h-[230px] border-b border-slate-300 py-6 md:border-r md:px-6 ${index === 0 ? 'md:pl-0' : ''} ${index === 3 ? 'md:border-r-0' : ''}`}>
                <p className="text-xs font-black text-orange-600">{number}</p>
                <h3 className="mt-8 text-xl font-black tracking-[-0.025em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="talk-to-carup" className="relative scroll-mt-20 overflow-hidden bg-orange-500 text-slate-950" data-testid="home-communications">
        <div className="pointer-events-none absolute right-[-5%] top-[-40%] text-[22rem] font-black leading-none text-black/[0.045]">C</div>
        <div className="section-padding relative mx-auto grid max-w-[1440px] gap-10 py-14 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em]">
              <MessageCircle className="h-4 w-4" /> CarUp communication layer
            </div>
            <h2 className="mt-4 max-w-3xl text-5xl font-black leading-[0.88] tracking-[-0.06em] sm:text-6xl">
              Need a car, an answer, or simply the next move?
            </h2>
            <p className="mt-6 max-w-2xl text-sm font-medium leading-6 text-slate-900/75">
              Start with Gutu AI for guided discovery, use Help for self-service answers, or contact CarUp when the journey needs a human handoff.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <BuyerAssistantDrawer
              triggerLabel="Ask Gutu AI"
              triggerClassName="h-14 w-full justify-between rounded-none border-0 bg-slate-950 px-5 font-black text-white hover:bg-slate-900 hover:text-white"
            />
            <Link to="/help" className="flex h-14 items-center justify-between bg-white px-5 text-sm font-black transition hover:bg-slate-100">
              <span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4" /> Help centre</span>
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link to="/contact" className="flex h-14 items-center justify-between border border-slate-950 px-5 text-sm font-black transition hover:bg-slate-950 hover:text-white">
              <span className="inline-flex items-center gap-2"><Headphones className="h-4 w-4" /> Contact CarUp</span>
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#060a11] py-14 text-white">
        <div className="section-padding mx-auto flex max-w-[1440px] flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">
              <CheckCircle2 className="h-4 w-4" /> Start where you are
            </div>
            <h2 className="mt-3 max-w-3xl text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-5xl">
              Search the car. Verify what is known. Keep the next step connected.
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-12 rounded-none bg-orange-500 px-6 font-black text-white hover:bg-orange-600">
              <Link to="/marketplace">Browse Marketplace</Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-none border-white/20 bg-transparent px-6 font-bold text-white hover:bg-white/10 hover:text-white">
              <Link to="/sell">Sell your car</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
