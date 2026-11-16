import '@/styles/showroom.css'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Globe2,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { ShowroomListingCard } from '@/components/showroom/ShowroomListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import { CinematicHero } from '@/components/showroom/CinematicHero'
import { reelFramesFrom } from '@/lib/homeReel'
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'
import { SCAN_FILM, SOURCING_FILM, playableFilm } from '@/content/media/homeFilm'
import { isLaunchPreviewEnabled } from '@/lib/presentationFlags'
import { AskCarUp } from '@/components/showroom/launch/AskCarUp'
import { AskCarUpMark } from '@/components/showroom/launch/AskCarUpMark'
import { ScanToStart } from '@/components/showroom/launch/ScanToStart'
import { SourcingJourney } from '@/components/showroom/launch/SourcingJourney'
import { VehicleStory } from '@/components/showroom/launch/VehicleStory'
import { ConversationsBand } from '@/components/showroom/launch/ConversationsBand'
import type { MarketplaceListingSummary } from '@/types'
import { canonicalMake, canonicalModel, makeTaxon, modelsForMake, resolveFuelType, resolveTransmission } from '@/data/vehicleTaxonomy'

function taxonomyVehicleHref(make: string, model: string) {
  const makeEntry = makeTaxon(make)
  if (!makeEntry) return '/marketplace'
  const canonical = canonicalMake(make)
  const modelLabel = canonicalModel(canonical, model)
  if (!modelsForMake(canonical).some(item => item.name === modelLabel)) return '/marketplace'
  return `/marketplace?make=${encodeURIComponent(canonical)}&model=${encodeURIComponent(modelLabel)}`
}

function taxonomyFacetHref(kind: 'fuel' | 'transmission', value: string) {
  const resolved = kind === 'fuel' ? resolveFuelType(value) : resolveTransmission(value)
  if (resolved.state !== 'canonical' && resolved.state !== 'alias_match') return '/marketplace'
  return `/marketplace?${kind}=${encodeURIComponent(String(resolved.value))}`
}

const popularSearches = [
  { label: 'Brand New', href: '/marketplace?category=brand_new' },
  { label: 'Recently Imported', href: '/marketplace?category=recently_imported' },
  { label: 'Fresh Imports', href: '/marketplace?tag=fresh_import' },
  { label: 'Locally Used', href: '/marketplace?category=locally_used' },
  { label: 'Second Hand', href: '/marketplace?category=second_hand' },
  { label: 'Low Mileage', href: '/marketplace?tag=low_mileage' },
  { label: 'Toyota Hilux', href: taxonomyVehicleHref('Toyota', 'Hilux') },
  { label: 'Honda Fit', href: taxonomyVehicleHref('Honda', 'Fit') },
  { label: 'Mazda Demio', href: taxonomyVehicleHref('Mazda', 'Demio') },
  { label: 'Passport Verified', href: '/marketplace?tag=passport_verified' },
  { label: 'Under $5,000', href: '/marketplace?maxPrice=5000' },
  { label: 'Under $10,000', href: '/marketplace?maxPrice=10000' },
  { label: 'Dealer Verified', href: '/marketplace?tag=dealer_verified' },
  { label: 'Parts & Accessories', href: '/marketplace/parts' },
  { label: 'Harare', href: '/marketplace?location=Harare' },
  { label: 'Bulawayo', href: '/marketplace?location=Bulawayo' },
  { label: 'Diesel', href: taxonomyFacetHref('fuel', 'Diesel') },
  { label: 'Automatic', href: taxonomyFacetHref('transmission', 'Automatic') },
  { label: 'PartSentry Checked', href: '/marketplace?tag=partsentry_checked' },
]

/** Canonical body styles (shared/taxonomy) — the rail hands the choice to the live Marketplace filter. */
const bodyStyles = [
  { label: 'SUV', value: 'SUV', note: 'Room, height and range' },
  { label: 'Pickup', value: 'Pickup', note: 'Work, farm and family' },
  { label: 'Sedan', value: 'Sedan', note: 'Comfort for the commute' },
  { label: 'Hatchback', value: 'Hatchback', note: 'Easy in the city' },
  { label: 'Crossover', value: 'Crossover', note: 'A little of both' },
  { label: 'Van & MPV', value: 'MPV', note: 'Seats for everyone' },
]

/** How CarUp reads a vehicle — names kept from the trust strip; each opens a plain explanation. */
const trustSignals = [
  {
    label: 'Plate Check',
    copy: 'Registration plates are checked against the records CarUp can reach. A missing check is shown as missing, never as a pass.',
  },
  {
    label: 'Evidence Timeline',
    copy: 'Documents and inspections are kept as dated records with their source, separate from the seller’s advertising photos.',
  },
  {
    label: 'Owner Privacy',
    copy: 'Plate, chassis and engine numbers are not shown publicly. That is a privacy rule for every listing, not a finding about one car.',
  },
  {
    label: 'Canonical Trust',
    copy: 'One governed Trust evaluation per vehicle. When a car has not been evaluated, CarUp says so instead of showing a number.',
  },
  {
    label: 'SafePay routes',
    copy: 'Payment steps open only after CarUp confirms the seller, the listing terms and that the transaction is eligible. Never pay outside CarUp.',
  },
  {
    label: 'PartSentry',
    copy: 'Parts that went into a car can be matched to it, so a repair is part of the record rather than a story.',
    testId: 'home-partsentry-trust-signal',
  },
]

const ecosystem = [
  { eyebrow: 'Finance', title: 'Explore how to fund the deal', copy: 'The finance routes CarUp can actually support, and nothing it cannot.', href: '/pricing' },
  { eyebrow: 'Protect', title: 'Connect insurance to the vehicle', copy: 'Keep cover beside the same vehicle identity and buying context.', href: '/insurance' },
  { eyebrow: 'Maintain', title: 'Find garages and service context', copy: 'Mechanics and service work that stay with the car’s lifecycle record.', href: '/garages' },
  { eyebrow: 'Parts', title: 'Match parts to the vehicle', copy: 'Normalized fitment and PartSentry context, without invented availability.', href: '/marketplace/parts' },
  { eyebrow: 'Dealers', title: 'Meet the dealers', copy: 'Dealer profiles and the stock they publish on CarUp.', href: '/dealers' },
]

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#09122A]">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export default function ShowroomLanding() {
  const navigate = useNavigate()
  const location = useLocation()
  const { fetchMarketplaceListings } = useCarUpApi()

  // Links such as /#ask-carup from the masthead or Marketplace land on the section they name.
  useEffect(() => {
    if (!location.hash) return
    const id = decodeURIComponent(location.hash.slice(1))
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(id)
      if (!target) return
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash, location.key])
  const [buyQuery, setBuyQuery] = useState('')
  const [verifyQuery, setVerifyQuery] = useState('')
  const [intent, setIntent] = useState('buy')
  const [listings, setListings] = useState<MarketplaceListingSummary[]>([])
  const [featuredState, setFeaturedState] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let cancelled = false
    fetchMarketplaceListings({ limit: 12, sort: 'newest' })
      .then(res => {
        if (cancelled) return
        setListings(Array.isArray(res?.listings) ? res.listings : [])
        setFeaturedState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setListings([])
        setFeaturedState('unavailable')
      })
    return () => { cancelled = true }
  }, [fetchMarketplaceListings])

  const reelFrames = useMemo(() => reelFramesFrom(listings), [listings])
  const justListed = listings.slice(0, 6)
  const launchPreview = isLaunchPreviewEnabled()
  // Vehicle Story: the newest published car that has a usable photo (never a placeholder story).
  const storyVehicle = useMemo(() => {
    const models = listings.map(marketplaceListingToCardModel)
    return models.find(model => model.primaryImage && model.primaryImageState !== 'none') ?? null
  }, [listings])

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

  const tabClass = 'h-11 flex-1 rounded-full px-4 text-sm font-semibold text-slate-600 transition data-[state=active]:bg-[#09122A] data-[state=active]:text-white data-[state=active]:shadow-none focus-visible:ring-2 focus-visible:ring-[#C2410C] sm:flex-none sm:px-6'

  return (
    <div className="bg-white text-[#09122A]">
      <CinematicHero film={playableFilm()} frames={reelFrames} framesState={featuredState}>
        <div className="section-padding mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-end pb-5 pt-12 sm:pb-8 lg:justify-center lg:pb-10 lg:pt-20">
          <p className="carup-rise text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FFB27A]">
            Zimbabwe’s car marketplace
          </p>
          <h1 className="carup-rise-2 mt-4 max-w-[13ch] text-[clamp(2.15rem,6.6vw,6rem)] font-bold leading-[0.94] tracking-[-0.04em] text-white">
            Find the car.{' '}
            <span className="block bg-[linear-gradient(90deg,#FE7D18,#FFB27A)] bg-clip-text text-transparent">Know its story.</span>
          </h1>
          <p className="carup-rise-3 mt-5 max-w-xl text-[15px] leading-6 text-white/85 sm:text-lg sm:leading-7">
            Published cars from private sellers and dealers, each with what CarUp knows about it — and what it does not.
          </p>

          {/* One console for the three intentions. Buy is the default because buying is why most people arrive. */}
          <div
            className="carup-rise-3 mt-7 w-full max-w-2xl rounded-[1.75rem] bg-white p-2 text-[#09122A] shadow-[0_30px_80px_-24px_rgba(0,0,0,0.6)] sm:mt-9"
            data-testid="home-primary-search"
          >
            <Tabs value={intent} onValueChange={setIntent} className="gap-0">
              <TabsList aria-label="What do you want to do?" className="h-auto w-full justify-start gap-1 rounded-full bg-[#F1EFEA] p-1 sm:w-auto">
                <TabsTrigger value="buy" className={tabClass} data-testid="home-intent-buy">Buy</TabsTrigger>
                <TabsTrigger value="sell" className={tabClass} data-testid="home-intent-sell">Sell</TabsTrigger>
                <TabsTrigger value="verify" className={tabClass} data-testid="home-intent-verify">Verify</TabsTrigger>
                <TabsTrigger value="import" className={tabClass} data-testid="home-intent-import">Import</TabsTrigger>
              </TabsList>

              <TabsContent value="buy" className="px-1 pb-1 pt-2">
                <form onSubmit={submitBuy} className="flex flex-col gap-2 sm:flex-row" role="search" aria-label="Search the Marketplace">
                  <label htmlFor="home-buy-search" className="sr-only">Search make, model, city or VIN</label>
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#C2410C]" aria-hidden="true" />
                    <input
                      id="home-buy-search"
                      value={buyQuery}
                      onChange={event => setBuyQuery(event.target.value)}
                      placeholder="Make, model, city or VIN"
                      autoComplete="off"
                      className="h-14 w-full rounded-2xl border-0 bg-transparent pl-12 pr-3 text-base font-medium text-[#09122A] placeholder:font-normal placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
                      data-testid="home-buy-search"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-7 text-base font-semibold text-[#09122A] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09122A] focus-visible:ring-offset-2"
                    data-testid="home-search-submit"
                  >
                    Find a car <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
                <a href="#ask-carup" className="mt-1 inline-flex min-h-11 items-center gap-2 px-3 text-[13px] font-semibold text-[#09122A] hover:text-[#C2410C]" data-testid="home-ask-carup-link">
                  <AskCarUpMark size={20} /> Not sure what to search? Describe it to Gutu AI
                </a>
              </TabsContent>

              <TabsContent value="sell" className="px-3 pb-2 pt-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-sm text-sm leading-6 text-slate-600">
                    Start with the car and its photos. You sign in only when you are ready to publish.
                  </p>
                  <Link
                    to="/sell"
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#09122A] px-6 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2"
                    data-testid="home-sell-start"
                  >
                    Start selling <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </TabsContent>

              <TabsContent value="verify" className="px-1 pb-1 pt-2">
                <form onSubmit={submitVerify} className="flex flex-col gap-2 sm:flex-row" aria-label="Open a Vehicle Passport by VIN">
                  <label htmlFor="verify-before-buy-input" className="sr-only">Exact VIN</label>
                  <input
                    id="verify-before-buy-input"
                    value={verifyQuery}
                    onChange={event => setVerifyQuery(event.target.value)}
                    placeholder="Enter the exact VIN"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-14 flex-1 rounded-2xl border-0 bg-transparent px-4 font-mono text-base text-[#09122A] placeholder:font-sans placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
                    data-testid="verify-before-buy-input"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#09122A] px-6 text-base font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2"
                  >
                    Open Passport
                  </button>
                </form>
                <Link to="/search" className="mt-1 inline-flex min-h-11 items-center gap-1.5 px-3 text-xs font-semibold text-[#C2410C] hover:underline">
                  Plate, chassis or temporary ID? Use protected lookup <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </TabsContent>

              <TabsContent value="import" className="px-3 pb-2 pt-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-sm text-sm leading-6 text-slate-600">
                    Source a car abroad with its request, documents and shipment on one order.
                  </p>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      to="/diaspora/imports/new"
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#09122A] px-5 text-sm font-semibold text-white transition hover:bg-[#111D3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] focus-visible:ring-offset-2"
                      data-testid="home-import-start"
                    >
                      <Globe2 className="h-4 w-4" aria-hidden="true" /> Start an import
                    </Link>
                    <Link to="/diaspora" className="inline-flex h-12 items-center rounded-2xl px-4 text-sm font-semibold text-[#09122A] ring-1 ring-slate-300 hover:bg-[#F6F4F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]">
                      How it works
                    </Link>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link to="/marketplace" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-white hover:text-[#FFB27A]" data-testid="home-browse-all">
              Browse every published car <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="#how-carup-reads-a-car" className="hidden min-h-11 items-center gap-1.5 text-white/80 hover:text-white sm:inline-flex">
              How CarUp reads a car <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </CinematicHero>

      {/* Ask CarUp: say what the car is for; see what CarUp understood; real cars + advice. */}
      <AskCarUp />

      {/* Body styles: the fastest honest shortcut into real inventory. */}
      <section className="bg-[#F6F4F0] py-14 sm:py-20" data-testid="home-body-rail" aria-labelledby="home-body-rail-title">
        <div className="section-padding mx-auto max-w-[1440px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Shop by shape</p>
          <h2 id="home-body-rail-title" className="mt-2 text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
            What are you driving next?
          </h2>
          <ul className="carup-rail -mx-4 mt-8 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
            {bodyStyles.map(style => (
              <li key={style.value} className="w-[46%] shrink-0 sm:w-auto">
                <Link
                  to={`/marketplace?bodyStyle=${encodeURIComponent(style.value)}`}
                  className="group flex h-full flex-col rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(9,18,42,0.06)] ring-1 ring-black/[0.04] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(9,18,42,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] motion-reduce:hover:translate-y-0 sm:p-5"
                  data-testid="home-body-style"
                >
                  <VehicleSilhouette bodyStyle={style.value} className="h-auto w-full transition-transform duration-500 motion-safe:group-hover:translate-x-1" />
                  <span className="mt-3 flex items-center justify-between gap-2 text-base font-semibold tracking-[-0.01em]">
                    {style.label}
                    <ArrowUpRight className="h-4 w-4 text-slate-400 transition group-hover:text-[#C2410C]" aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 text-[13px] leading-5 text-slate-600">{style.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Just listed: real published inventory, with honest loading, outage and empty states. */}
      <section className="bg-white py-14 sm:py-20" data-testid="home-live-inventory">
        <div className="section-padding mx-auto max-w-[1440px]">
          <SectionHeading
            eyebrow="Live Marketplace"
            title="Just listed"
            action={(
              <Link
                to="/marketplace"
                className="inline-flex h-11 items-center gap-2 self-start rounded-full border border-slate-300 px-5 text-sm font-semibold text-[#09122A] transition hover:border-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] sm:self-auto"
              >
                Browse all published vehicles <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          />

          {featuredState === 'loading' && (
            <p className="py-12 text-sm text-slate-600" data-testid="featured-loading" role="status">Loading live Marketplace vehicles…</p>
          )}
          {featuredState === 'unavailable' && (
            <div className="mt-8 rounded-2xl bg-amber-50 px-5 py-6 text-sm leading-6 text-amber-900" data-testid="featured-unavailable" role="status">
              Live Marketplace vehicles are unavailable right now. CarUp has not substituted demo inventory.
            </div>
          )}
          {featuredState === 'ready' && justListed.length === 0 && (
            <p className="py-12 text-sm text-slate-600" data-testid="featured-empty">No published listings are available for the live showroom.</p>
          )}

          {justListed.length > 0 && (
            <ul className="carup-rail -mx-4 mt-9 flex gap-5 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-2 md:gap-x-7 md:gap-y-12 md:overflow-visible md:px-0 xl:grid-cols-3">
              {justListed.map(vehicle => (
                <li key={vehicle.vin} className="w-[84%] shrink-0 md:w-auto">
                  <ShowroomListingCard
                    vehicle={marketplaceListingToCardModel(vehicle)}
                    href={`/marketplace/${encodeURIComponent(vehicle.vin)}`}
                    dataTestId="featured-verified-car"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Trust, in one breath — the detail is one tap away, not a wall of text. */}
      <section
        id="how-carup-reads-a-car"
        className="scroll-mt-20 bg-[#09122A] py-16 text-white sm:py-24"
        data-testid="home-trust-strip"
        aria-labelledby="home-trust-title"
      >
        <div className={`section-padding mx-auto grid max-w-[1440px] gap-10 lg:gap-16 ${storyVehicle ? 'lg:grid-cols-[1.05fr_0.95fr] lg:items-start' : ''}`}>
          {storyVehicle && <VehicleStory vehicle={storyVehicle} />}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">How CarUp reads a car</p>
            <h2 id="home-trust-title" className="mt-3 max-w-lg text-[clamp(2rem,3.6vw,3.25rem)] font-bold leading-[1.02] tracking-[-0.035em]">
              Every listing keeps its record beside it.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-white/75">
              Seller photos are advertising. Records are records. CarUp keeps them apart, says when something has not been checked, and never turns silence into a pass.
            </p>
            <Link
              to="/search"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)] px-6 text-sm font-semibold text-[#09122A] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify a car
            </Link>
          <ul className={`divide-y divide-white/10 border-y border-white/10 ${storyVehicle ? 'mt-10' : ''}`}>
            {trustSignals.map(signal => (
              <li key={signal.label} data-testid={signal.testId}>
                <details className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold tracking-[-0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-3">
                      <span className="h-[3px] w-6 rounded-full bg-[linear-gradient(90deg,#FE7D18,#FD5B0D)]" aria-hidden="true" />
                      {signal.label}
                    </span>
                    <ChevronDown className="h-5 w-5 shrink-0 text-white/60 transition group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="max-w-xl pb-5 pl-9 text-[15px] leading-7 text-white/75">{signal.copy}</p>
                </details>
              </li>
            ))}
          </ul>
          </div>
        </div>
      </section>

      {/* Sell: the Scan to Start launch design (internal launch preview only, until governed OCR is
          live and accepted); otherwise the Sell + Verify front doors. */}
      {launchPreview ? <ScanToStart film={playableFilm(SCAN_FILM)} /> : (
        <>
        {/* Sell + Verify: the two other front doors, each one decision away. */}
        <section className="bg-white py-14 sm:py-20" data-testid="home-conversion-studio">
          <div className="section-padding mx-auto grid max-w-[1440px] gap-4 md:grid-cols-2 md:gap-6">
            <Link
              to="/sell"
              className="group relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-3xl bg-[#F6F4F0] p-7 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] sm:p-10"
            >
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">Sell</p>
                <h2 className="mt-3 max-w-sm text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.03em]">
                  Sell with a record buyers can read.
                </h2>
                <p className="mt-3 max-w-sm text-[15px] leading-6 text-slate-600">
                  Build the listing and photos first. CarUp connects the sale to the vehicle’s record instead of a throwaway advert.
                </p>
              </div>
              <span className="relative mt-8 inline-flex items-center gap-2 text-sm font-semibold">
                Start selling <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
              </span>
              <VehicleSilhouette bodyStyle="SUV" accent className="pointer-events-none absolute -bottom-2 -right-6 w-[46%] max-w-[380px] opacity-90 sm:-bottom-3 sm:-right-8 sm:w-[58%]" />
            </Link>
            <Link
              to="/search"
              className="group relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-3xl bg-[#09122A] p-7 text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C] sm:p-10"
            >
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">Verify</p>
                <h2 className="mt-3 max-w-sm text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.03em]">
                  Found the car somewhere else?
                </h2>
                <p className="mt-3 max-w-sm text-[15px] leading-6 text-white/75">
                  Exact VIN lookup is public. Protected identifiers need an account — and an empty result is never treated as proof.
                </p>
              </div>
              <span className="relative mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#FFB27A]">
                Open Verify <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
              </span>
              <VehicleSilhouette bodyStyle="Sedan" tone="paper" accent className="pointer-events-none absolute -bottom-2 -right-6 w-[46%] max-w-[380px] opacity-60 sm:-bottom-3 sm:-right-8 sm:w-[58%]" />
            </Link>
          </div>
        </section>
        </>
      )}

      {/* Import / international sourcing: a primary proposition, with its editorial film. */}
      <SourcingJourney film={playableFilm(SOURCING_FILM)} />

      {/* The rest of CarUp, as an index rather than eight look-alike cards. */}
      <section className="border-t border-slate-200 bg-white py-14 sm:py-20" data-testid="home-ecosystem-promotions">
        <div className="section-padding mx-auto max-w-[1440px]">
          <SectionHeading eyebrow="Around the car" title="Everything after you find it." />
          <ul className="mt-8 grid border-t border-slate-200 sm:grid-cols-2 lg:grid-cols-3">
            {ecosystem.map(item => (
              <li key={item.href} className="border-b border-slate-200 sm:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-r-0 lg:[&:not(:nth-child(3n))]:border-r">
                <Link
                  to={item.href}
                  className="group flex h-full items-start justify-between gap-4 px-1 py-5 transition hover:bg-[#F6F4F0] sm:min-h-[132px] sm:flex-col sm:p-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C2410C] sm:p-7"
                  data-testid="home-ecosystem-link"
                >
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.eyebrow}</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-[#09122A]">{item.title}</h3>
                    <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-600">{item.copy}</p>
                  </div>
                  <ArrowUpRight className="mt-6 h-5 w-5 shrink-0 text-slate-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#C2410C] sm:mt-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-[#F6F4F0] py-12 sm:py-16" aria-labelledby="home-quick-searches">
        <div className="section-padding mx-auto max-w-[1440px]">
          <h2 id="home-quick-searches" className="text-xl font-semibold tracking-[-0.015em]">Quick searches</h2>
          <p className="mt-1 text-sm text-slate-600">Each one opens the live Marketplace with the filter applied.</p>
          <div className="carup-rail -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {popularSearches.map(chip => (
              <Link
                key={chip.label}
                to={chip.href}
                className="inline-flex h-11 shrink-0 items-center rounded-full bg-white px-4 text-sm font-medium text-[#09122A] ring-1 ring-slate-200 transition hover:ring-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]"
                data-testid="popular-search-chip"
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <ConversationsBand />
    </div>
  )
}
