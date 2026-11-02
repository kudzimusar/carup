import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ArrowRight, CarFront, ShieldCheck, Globe2, Wrench, Package } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import { BuyerAssistantDrawer } from '@/components/marketplace/BuyerAssistantDrawer'
import { PublicCommunicationChannels } from '@/components/communications/PublicCommunicationChannels'
import { PUBLIC_IDENTITY } from '@/config/publicIdentity'
import { usePageMetadata } from '@/lib/usePageMetadata'
import type { MarketplaceListingSummary } from '@/types'

const POPULAR_SEARCHES = [
  { label: 'Harare', href: '/marketplace?location=Harare' },
  { label: 'Bulawayo', href: '/marketplace?location=Bulawayo' },
  { label: 'Low mileage', href: '/marketplace?tag=low_mileage' },
  { label: 'Under $10k', href: '/marketplace?maxPrice=10000' },
  { label: 'Recently imported', href: '/marketplace?category=recently_imported' },
  { label: 'Locally used', href: '/marketplace?category=locally_used' },
]
const SHORTCUTS = [
  { href: '/diaspora', label: 'Import a vehicle', detail: 'Explore the import journey', icon: Globe2 },
  { href: '/garages', label: 'Find a garage', detail: 'Browse published profiles', icon: Wrench },
  { href: '/marketplace/parts', label: 'Find parts', detail: 'Search parts and fitment', icon: Package },
]

export default function Landing() {
  usePageMetadata({ title: 'CarUp | Find your next car', description: 'Browse published cars, compare prices and locations, and read the Vehicle Passport. Know the car. Trust the journey.', canonicalPath: '/' })
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fixtureScope = searchParams.get('fixture_scope') || undefined
  const { fetchMarketplaceListings } = useCarUpApi()
  const [query, setQuery] = useState('')
  const [vehicles, setVehicles] = useState<MarketplaceListingSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => { cancelled = true; setState('unavailable') }, 10000)
    fetchMarketplaceListings({ limit: 6, sort: 'newest', ...(fixtureScope ? { fixture_scope: fixtureScope } : {}) })
      .then(result => { if (!cancelled) { setVehicles(Array.isArray(result?.listings) ? result.listings : []); setState('ready') } })
      .catch(() => { if (!cancelled) { setVehicles([]); setState('unavailable') } })
      .finally(() => clearTimeout(timeout))
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [fetchMarketplaceListings, fixtureScope, retry])
  const tryAgain = () => { setState('loading'); setRetry(value => value + 1) }
  return <div className="bg-slate-50 text-slate-950" data-testid="launch-home">
    <section className="bg-[#0b1628] text-white" data-testid="home-hero">
      <div className="section-padding mx-auto max-w-[1440px] py-8 sm:py-12 lg:py-16">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:items-end lg:gap-12">
          <div>
            <p className="text-sm font-semibold text-amber-400">{PUBLIC_IDENTITY.tagline}</p>
            <h1 className="mt-3 text-[2rem] font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">Your next car.<br />A clearer picture.</h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">Find cars. Compare the price. Read the Passport before you decide.</p>
          </div>
          <form className="rounded-xl bg-white p-3 text-slate-950 sm:p-5" onSubmit={event => { event.preventDefault(); navigate(query.trim() ? `/marketplace?q=${encodeURIComponent(query.trim())}` : '/marketplace') }} data-testid="home-primary-search">
            <label htmlFor="home-query" className="block pb-2 text-sm font-semibold">What are you looking for?</label>
            <div className="flex gap-2">
              <input id="home-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Make, model or vehicle identifier" className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-base" data-testid="home-buy-search" />
              <button type="submit" aria-label="Search cars" className="flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 font-semibold text-slate-950 hover:bg-amber-300 sm:px-5" data-testid="home-search-submit"><Search className="h-5 w-5" aria-hidden /><span className="hidden sm:inline">Search cars</span></button>
            </div>
          </form>
        </div>
        <nav aria-label="Popular Marketplace searches" className="mt-6 flex flex-wrap gap-2">{POPULAR_SEARCHES.map(({ label, href }) => <Link key={label} to={href} className="inline-flex min-h-11 items-center rounded-full border border-slate-600 px-4 py-2 text-sm font-medium hover:border-amber-400 hover:text-amber-300">{label}</Link>)}</nav>
      </div>
    </section>
    <section className="section-padding mx-auto max-w-[1440px] py-8 sm:py-12" data-testid="home-live-inventory">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold sm:text-3xl">Latest cars</h2><Link to="/marketplace" className="inline-flex min-h-11 items-center gap-2 font-semibold text-amber-800">View all cars <ArrowRight className="h-4 w-4" aria-hidden /></Link></div>
      {state === 'loading' && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-6" role="status" data-testid="featured-loading"><p>Loading published listings…</p><p className="mt-2 text-sm text-slate-500">Search, Sell and Verify are ready while the cars load.</p></div>}
      {state === 'unavailable' && <div className="mt-5 rounded-xl border border-amber-200 bg-white p-6" role="status" data-testid="featured-unavailable"><h3 className="text-lg font-semibold">We could not load the cars</h3><p className="mt-2 leading-7 text-slate-600">Check your connection and try again. We will not show an old listing as current.</p><button type="button" onClick={tryAgain} className="mt-4 min-h-11 rounded-lg border border-slate-300 px-5 py-2 font-semibold">Try again</button></div>}
      {state === 'ready' && vehicles.length === 0 && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-6 sm:p-8" data-testid="featured-empty"><CarFront className="h-8 w-8 text-amber-700" aria-hidden /><h3 className="mt-4 text-xl font-bold">Be part of the opening Marketplace</h3><p className="mt-3 max-w-xl leading-7 text-slate-600">There are no published cars to browse right now. Have a car to sell? Build your listing and choose when to publish it.</p><Link to="/sell" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-400 px-5 py-3 font-semibold">Start your listing <ArrowRight className="h-4 w-4" aria-hidden /></Link></div>}
      {state === 'ready' && vehicles.length > 0 && <div className="mt-5 grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="home-live-showroom">{vehicles.map(vehicle => <MarketplaceListingCard key={vehicle.vin} vehicle={marketplaceListingToCardModel(vehicle)} href={`/marketplace/${encodeURIComponent(vehicle.vin)}`} dataTestId="featured-verified-car" ctaLabel="View car & Passport" />)}</div>}
    </section>
    <section className="section-padding mx-auto grid max-w-[1440px] gap-5 pb-10 md:grid-cols-2" aria-label="Sell or verify">
      <article className="rounded-xl bg-[#0b1628] p-6 text-white sm:p-8"><CarFront className="h-7 w-7 text-amber-400" aria-hidden /><h2 className="mt-4 text-2xl font-bold">Your car. Your next chapter.</h2><p className="mt-3 leading-7 text-slate-300">Start with the vehicle, photos and price. Save to your account when you are ready. Publishing is your choice.</p><Link to="/sell" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-400 px-5 py-3 font-semibold text-slate-950">Sell a car <ArrowRight className="h-4 w-4" aria-hidden /></Link></article>
      <article className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"><ShieldCheck className="h-7 w-7 text-amber-700" aria-hidden /><h2 className="mt-4 text-2xl font-bold">Already found a car?</h2><p className="mt-3 leading-7 text-slate-600">Look up its Vehicle Passport. See the recorded facts and gaps before you take the next step.</p><Link to="/search" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-5 py-3 font-semibold">Verify a vehicle <ArrowRight className="h-4 w-4" aria-hidden /></Link></article>
    </section>
    <nav className="section-padding mx-auto grid max-w-[1440px] gap-3 pb-10 sm:grid-cols-3" aria-label="More for your car">{SHORTCUTS.map(({ href, label, detail, icon: Icon }) => <Link key={href} to={href} className="flex min-h-24 items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-amber-400"><Icon className="h-6 w-6 shrink-0 text-amber-700" aria-hidden /><div><p className="font-semibold">{label}</p><p className="mt-1 text-sm text-slate-600">{detail}</p></div></Link>)}</nav>
    <section className="border-y border-slate-200 bg-white" data-testid="home-trust-strip"><div className="section-padding mx-auto max-w-[1440px] py-8 sm:flex sm:items-center sm:justify-between sm:gap-8"><div><h2 className="text-xl font-bold">A Passport for the facts. Space for the gaps.</h2><p className="mt-3 max-w-2xl leading-7 text-slate-600">Ownership, evidence and service history where recorded. CarUp shows what it knows and what it does not. An independent inspection still matters.</p></div><Link to="/trust" className="mt-3 inline-flex min-h-11 shrink-0 items-center gap-2 font-semibold text-amber-800 sm:mt-0">How Trust works <ArrowRight className="h-4 w-4" aria-hidden /></Link></div></section>
    <section className="section-padding mx-auto grid max-w-[1440px] gap-5 py-10 lg:grid-cols-2" data-testid="home-communications"><PublicCommunicationChannels /><div className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold">Help with the next step</h2><p className="mt-3 leading-7 text-slate-600">Find product help, reach the CarUp team, or ask Gutu for guidance. Gutu is an assistant; it does not replace customer support.</p><div className="mt-4 flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 font-semibold" to="/support">Get help</Link><Link className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 font-semibold" to="/contact">Contact CarUp</Link><BuyerAssistantDrawer /></div></div></section>
  </div>
}
