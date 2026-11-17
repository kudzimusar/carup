/**
 * RX03-P2-R4 — My CarUp, vehicle-first (unified presentation only; flags OFF keep the legacy
 * Owner Dashboard composition byte-for-byte).
 *
 * Same data, same truth rules as OwnerDashboard — this file only re-composes what the container
 * already read: the owner's vehicles lead, then what needs doing, then the places an owner goes
 * (garage, saved cars, service, insurance, PartSentry, Gutu AI). Money and Trust facts that have
 * no authoritative source keep their honest "Not available / Not calculated" wording in one
 * compact standing card instead of four empty tiles, and the session-scoped market intelligence
 * moves below the owner's own objects. Every data-testid the truthfulness tests read is kept.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Bookmark, Car, Columns3, FileText, Gauge, Gift, Globe2, ImageOff, LineChart, ListChecks, Mail, MessageSquare, PencilLine, Search, Shield, ShieldCheck, Tag, Wrench } from 'lucide-react'
import MarketplacePulse from '@/components/intelligence/MarketplacePulse'
import NextBestActions from '@/components/intelligence/NextBestActions'
import PeriodicReport from '@/components/intelligence/PeriodicReport'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'
import type { MarketplaceListingSummary, Vehicle } from '@/types'
import { readOwnerTrustClaim, statedCount, statedMileage } from './ownerStatedValues'
import { LISTING_TONE_CLASS, vehicleListingState } from '@/lib/vehicleListingState'
import { readGuestSellDraft } from '@/lib/guestSellDraft'
import { sellerDiscoverabilityFacets } from '@/lib/sellerListingPreview'
import { sellerReadiness } from '@/lib/sellerReadiness'
import { listingToShowroomCardModel } from '@/lib/showroomCardModel'

export interface MyCarUpHomeProps {
  userName?: string | null
  vehicles: Vehicle[]
  vehiclesState: 'loading' | 'ready' | 'unavailable'
  escrow: { status: 'loading' | 'ready' | 'error'; usd: number; count: number }
  notificationsState: 'loading' | 'ready' | 'unavailable'
  recentNotifications: Array<{ id: string; read?: boolean; title?: string; message?: string; priority?: string | null }>
  attentionItems: Array<{ key: string; label: string; detail: string; to: string; cta: string }>
  lowBandwidth: boolean
  onToggleLowBandwidth: () => void
  /** RX04-C I-01: the owner's saved Marketplace cars (read only in the unified presentation). */
  savedState?: 'loading' | 'ready' | 'unavailable'
  savedListings?: MarketplaceListingSummary[]
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'

// RX04-C: a complete directory — every My CarUp capability is one tap from home, grouped by what
// the owner is doing (the legacy dashboard left several of these reachable only from a desktop rail).
const DESTINATION_GROUPS: Array<{ title: string; items: Array<{ label: string; detail: string; href: string; icon: typeof Car }> }> = [
  {
    title: 'Your cars',
    items: [
      { label: 'My garage', detail: 'Every vehicle and its Passport', href: '/dashboard/garage', icon: Car },
      { label: 'Evidence', detail: 'Documents behind each car', href: '/dashboard/evidence', icon: FileText },
      { label: 'Service history', detail: 'Work recorded on your cars', href: '/dashboard/service-history', icon: Wrench },
      { label: 'Insurance', detail: 'Policies and records', href: '/dashboard/insurance', icon: Shield },
      { label: 'PartSentry', detail: 'Parts provenance', href: '/dashboard/partsentry', icon: Gauge },
    ],
  },
  {
    title: 'Buying',
    items: [
      { label: 'Saved cars', detail: 'Cars you are considering', href: '/dashboard/saved', icon: Bookmark },
      { label: 'Verify a VIN', detail: 'Look up a public Passport', href: '/search', icon: Search },
    ],
  },
  {
    title: 'Selling',
    items: [
      { label: 'Sell a car', detail: 'Seller Studio, with your draft', href: '/dashboard/sell-vehicle', icon: Tag },
      { label: 'My listings', detail: 'What is live and what is pending', href: '/dashboard/listings', icon: ListChecks },
      { label: 'Seller insights', detail: 'How your listings are doing', href: '/dashboard/intelligence', icon: LineChart },
    ],
  },
  {
    title: 'Help and account',
    items: [
      { label: 'Gutu AI', detail: 'Ask about your cars', href: '/dashboard/ai', icon: MessageSquare },
      { label: 'Messages', detail: 'Enquiries and replies', href: '/dashboard/communications', icon: Mail },
      { label: 'Referrals', detail: 'Invite people you know', href: '/dashboard/referrals', icon: Gift },
      { label: 'Identity check', detail: 'Verify who you are', href: '/kyc', icon: BadgeCheck },
    ],
  },
]

function Section({ title, action, children, testId }: { title: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="min-w-0" data-testid={testId} aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function ListingChip({ vehicle }: { vehicle: Vehicle }) {
  const state = vehicleListingState(vehicle)
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${LISTING_TONE_CLASS[state.tone]}`} data-testid={`mycarup-listing-state-${vehicle.vin}`}>
      {state.label}
    </span>
  )
}

function TrustLine({ vehicle }: { vehicle: Vehicle }) {
  const trust = readOwnerTrustClaim(vehicle)
  return (
    <p className="flex items-center gap-1.5 text-[13px]" data-testid={`trust-claim-${vehicle.vin}`}>
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" />
      {trust.score !== null ? (
        <span className="text-carup-text-2">
          CarUp Trust <b className="text-carup-text" data-testid={`trust-claim-score-${vehicle.vin}`}>{trust.score} / 100</b> · {trust.headline}
        </span>
      ) : (
        <span className="text-carup-text-3" data-testid={`trust-claim-state-${vehicle.vin}`}>CarUp Trust: {trust.headline}</span>
      )}
    </p>
  )
}

/** The owner's first car, composed like a showroom card: photo, identity, Passport facts, next step. */
function FeaturedVehicle({ vehicle, hideMedia }: { vehicle: Vehicle; hideMedia: boolean }) {
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  const state = vehicleListingState(vehicle)
  const records = [
    statedCount(vehicle.counts?.services, 'service record'),
    statedCount(vehicle.counts?.verified_documents, 'verified document'),
    statedCount(vehicle.counts?.active_insurance, 'active policy', 'active policies'),
  ]
  return (
    <article className="overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`} className={`group block ${FOCUS}`} data-testid="mycarup-vehicle-card" aria-label={`${name} — open Vehicle Passport`}>
        {hideMedia ? (
          <div className="flex aspect-[16/10] h-full items-center justify-center bg-carup-bg-surface text-xs text-carup-text-3">
            <ImageOff className="mr-2 h-4 w-4" aria-hidden="true" /> Photos hidden (low-bandwidth)
          </div>
        ) : (
          <OwnerListingMedia media={vehicle.listing_media} alt={name} className="aspect-[16/9] h-full w-full overflow-hidden bg-carup-bg-surface md:aspect-[16/10]" loading="eager" />
        )}
      </Link>
      <div className="flex min-w-0 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ListingChip vehicle={vehicle} />
          <span className="font-mono text-[12px] text-carup-text-3">VIN {vehicle.vin}</span>
        </div>
        <h3 className="text-[clamp(1.25rem,2vw,1.6rem)] font-bold leading-tight tracking-[-0.02em] text-carup-text">{name}</h3>
        <p className="flex items-center gap-1.5 text-[13px] text-carup-text-2"><Gauge className="h-3.5 w-3.5" aria-hidden="true" /> {statedMileage(vehicle.mileage)}</p>
        <TrustLine vehicle={vehicle} />
        <ul className="grid gap-1 border-t border-carup-line pt-3 text-[13px] text-carup-text-2" aria-label="On this car's Passport">
          {records.map(record => <li key={record}>{record.charAt(0).toUpperCase() + record.slice(1)}</li>)}
        </ul>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Link to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-carup-action px-4 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover ${FOCUS}`}>
            Open Passport <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to={state.action.href} className={`inline-flex min-h-11 items-center rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:bg-carup-bg-surface ${FOCUS}`} data-testid={`mycarup-vehicle-action-${vehicle.vin}`}>
            {state.action.label}
          </Link>
        </div>
      </div>
    </article>
  )
}

/** Every other car: a compact, recognisable card in a snap rail on phones, a grid on larger screens. */
function VehicleCard({ vehicle, hideMedia }: { vehicle: Vehicle; hideMedia: boolean }) {
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  return (
    <Link
      to={`/dashboard/garage/${encodeURIComponent(vehicle.vin)}`}
      className={`group flex w-[78vw] max-w-[320px] shrink-0 flex-col overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line transition hover:ring-carup-text-3 sm:w-auto sm:max-w-none ${FOCUS}`}
      data-testid="mycarup-vehicle-card"
    >
      {hideMedia ? (
        <div className="flex aspect-[16/9] items-center justify-center bg-carup-bg-surface text-xs text-carup-text-3">
          <ImageOff className="mr-2 h-4 w-4" aria-hidden="true" /> Photos hidden
        </div>
      ) : (
        <OwnerListingMedia media={vehicle.listing_media} alt={name} className="aspect-[16/9] w-full overflow-hidden bg-carup-bg-surface" />
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="truncate text-[15px] font-semibold text-carup-text">{name}</h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ListingChip vehicle={vehicle} />
          <span className="text-[13px] text-carup-text-2">{statedMileage(vehicle.mileage)}</span>
        </div>
        <p className="truncate font-mono text-[12px] text-carup-text-3">VIN {vehicle.vin}</p>
        <div className="mt-auto border-t border-carup-line pt-2"><TrustLine vehicle={vehicle} /></div>
      </div>
    </Link>
  )
}

interface ContinueItem { key: string; eyebrow: string; title: string; detail: string; to: string; cta: string; testId: string }

function continueItemsFor(vehicles: Vehicle[], savedState: MyCarUpHomeProps['savedState'], saved: MarketplaceListingSummary[]): ContinueItem[] {
  const items: ContinueItem[] = []
  // A Seller Studio draft kept in this browser (the account Studio restores it on open).
  const draft = readGuestSellDraft()
  if (draft && (draft.vin || draft.make || draft.model)) {
    const readiness = sellerReadiness({ ...draft, coverChosen: draft.coverImageIndex !== null, discoverabilityFacets: sellerDiscoverabilityFacets(draft) }, 'guest')
    items.push({
      key: 'browser-draft', eyebrow: 'Seller Studio · this browser',
      title: [draft.year, draft.make, draft.model].filter(Boolean).join(' ') || 'Your listing draft',
      detail: `${readiness.requiredDone} of ${readiness.required.length} needed to save`,
      to: '/dashboard/sell-vehicle', cta: 'Continue draft', testId: 'mycarup-continue-browser-draft',
    })
  }
  for (const vehicle of vehicles) {
    const state = vehicleListingState(vehicle)
    if (state.key === 'review') {
      items.push({
        key: `review-${vehicle.vin}`, eyebrow: 'Listing under review',
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        detail: 'CarUp is reviewing the evidence you submitted.', to: state.action.href, cta: 'View status', testId: `mycarup-continue-review-${vehicle.vin}`,
      })
    }
  }
  if (savedState === 'ready' && saved.length > 0) {
    const models = saved.map(listingToShowroomCardModel)
    const names = models.slice(0, 2).map(m => m.name).join(', ')
    items.push({
      key: 'saved', eyebrow: `${saved.length} saved ${saved.length === 1 ? 'car' : 'cars'}`,
      title: saved.length >= 2 ? 'Compare your shortlist' : 'Your saved car',
      detail: names + (saved.length > 2 ? ` and ${saved.length - 2} more` : ''),
      to: saved.length >= 2 ? `/marketplace/compare?vins=${models.slice(0, 4).map(m => encodeURIComponent(m.vin)).join(',')}` : '/dashboard/saved',
      cta: saved.length >= 2 ? 'Compare side by side' : 'Open saved cars', testId: 'mycarup-continue-saved',
    })
  }
  return items
}

export function MyCarUpHome({
  userName,
  vehicles,
  vehiclesState,
  escrow,
  notificationsState,
  recentNotifications,
  attentionItems,
  lowBandwidth,
  onToggleLowBandwidth,
  savedState,
  savedListings = [],
}: MyCarUpHomeProps) {
  const unread = recentNotifications.filter(n => !n.read).length
  // Listing actions the server has recorded: ready to publish, then drafts to finish.
  const listingAttention = vehiclesState === 'ready'
    ? vehicles
        .map(vehicle => ({ vehicle, state: vehicleListingState(vehicle) }))
        .filter(({ state }) => state.key === 'ready' || state.key === 'draft')
        .sort((a, b) => (a.state.key === 'ready' ? 0 : 1) - (b.state.key === 'ready' ? 0 : 1))
        .map(({ vehicle, state }) => ({
          key: `listing-${vehicle.vin}`,
          // The VIN tail tells two drafts of the same model apart.
          label: `${state.key === 'ready' ? 'Ready to publish' : 'Finish your listing'}: ${vehicle.year} ${vehicle.make} ${vehicle.model} · …${vehicle.vin.slice(-4)}`,
          detail: state.key === 'ready' ? 'CarUp’s publication requirements are met for this draft.' : 'Your draft is saved. Pick up where you stopped.',
          to: state.action.href,
          cta: state.action.label,
        }))
    : []
  const attention = [...listingAttention, ...attentionItems]
  const continueItems = continueItemsFor(vehiclesState === 'ready' ? vehicles : [], savedState, savedListings)
  const featured = vehiclesState === 'ready' ? vehicles[0] : undefined
  const others = vehiclesState === 'ready' ? vehicles.slice(1, 7) : []
  const unlisted = vehiclesState === 'ready' ? vehicles.find(v => vehicleListingState(v).key === 'not_listed') : undefined
  const verifiedDocuments = vehicles.reduce<number | null>((sum, v) => {
    const n = v.counts?.verified_documents
    return typeof n === 'number' && Number.isFinite(n) ? (sum ?? 0) + n : sum
  }, null)
  const discover = [
    {
      key: 'buy', verb: 'Buy', title: 'Find your next car', icon: Search, to: '/marketplace',
      detail: savedState === 'ready' && savedListings.length > 0 ? `${savedListings.length} saved · see what is live today` : 'Live listings, each with its Vehicle Passport',
    },
    {
      key: 'sell', verb: 'Sell', icon: Tag,
      title: unlisted ? `Sell your ${unlisted.make} ${unlisted.model}` : 'List a car',
      detail: unlisted ? 'Its Passport fills the identity — add price, words and photos' : 'Seller Studio starts with the VIN',
      to: unlisted ? `/dashboard/sell-vehicle?vin=${encodeURIComponent(unlisted.vin)}` : '/dashboard/sell-vehicle',
    },
    { key: 'verify', verb: 'Verify', title: 'Check any car by VIN', icon: BadgeCheck, to: '/search', detail: 'See what CarUp knows before you buy' },
    { key: 'trade', verb: 'Trade', title: 'Import from abroad', icon: Globe2, to: '/diaspora', detail: 'Source a car through CarUp Trade' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-8 sm:space-y-10" data-testid="mycarup-home">
      {/* Today: who, how many cars, how many things to do — and the two most common moves. */}
      <header className="flex flex-wrap items-end justify-between gap-4" data-testid="mycarup-today">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">My CarUp · Today</p>
          <h1 className="mt-1 text-[clamp(1.6rem,2.6vw,2.2rem)] font-bold tracking-[-0.025em] text-carup-text">
            Welcome back{userName ? `, ${userName}` : ''}!
          </h1>
          <p className="mt-1 max-w-xl text-sm text-carup-text-2" data-testid="mycarup-today-summary">
            {vehiclesState === 'ready' ? (
              <>
                {vehicles.length === 0 ? 'No cars' : vehicles.length === 1 ? '1 car' : `${vehicles.length} cars`} in your Garage ·{' '}
                {attention.length === 0
                  ? 'nothing needs you right now'
                  : <a href="#mycarup-attention" className="font-semibold text-carup-action-hover underline-offset-2 hover:underline">{attention.length === 1 ? '1 thing to do' : `${attention.length} things to do`}</a>}
              </>
            ) : vehiclesState === 'loading' ? 'Reading your Garage…' : 'Your Garage could not be read just now.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard/ai"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 ${FOCUS}`}
            data-testid="mycarup-gutu"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" /> Ask Gutu AI
          </Link>
          <Link
            to="/dashboard/garage"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover ${FOCUS}`}
            data-testid="mycarup-primary-action"
          >
            <Car className="h-4 w-4" aria-hidden="true" /> Open my garage
          </Link>
        </div>
      </header>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-8">
        <Section
          title="My cars"
          testId="mycarup-vehicles"
          action={
            <div className="flex items-center gap-3">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-carup-text-2">
                <input type="checkbox" checked={lowBandwidth} onChange={onToggleLowBandwidth} className="h-4 w-4 accent-[var(--carup-action)]" />
                Hide photos
              </label>
              <Link to="/dashboard/garage" className={`inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-carup-action-hover ${FOCUS}`}>
                View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          }
        >
          {vehiclesState === 'loading' && (
            <p className="rounded-card bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line" role="status">Loading your garage…</p>
          )}
          {vehiclesState === 'unavailable' && (
            <p className="rounded-card bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line" role="alert" data-testid="mycarup-vehicles-unavailable">
              Your garage could not be loaded. This is a loading failure, not an empty garage.
            </p>
          )}
          {vehiclesState === 'ready' && vehicles.length === 0 && (
            <div className="overflow-hidden rounded-card bg-carup-raw-ink text-white" data-testid="mycarup-vehicles-empty">
              <div className="p-6 sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Your Garage</p>
                <p className="mt-2 text-xl font-bold tracking-[-0.02em] sm:text-2xl">No vehicles in your garage yet</p>
                <p className="mt-2 max-w-lg text-sm leading-6 text-white/75">Add the car you drive and CarUp starts its Vehicle Passport: identity, service records, documents and, once evidence is reviewed, its CarUp Trust.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link to="/dashboard/sell-vehicle" className={`inline-flex min-h-11 items-center rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on ${FOCUS}`}>
                    Add vehicle
                  </Link>
                  <Link to="/marketplace" className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10 ${FOCUS}`}>
                    Browse cars
                  </Link>
                </div>
              </div>
            </div>
          )}
          {featured && (
            <div className="space-y-4">
              <FeaturedVehicle vehicle={featured} hideMedia={lowBandwidth} />
              {others.length > 0 && (
                <div className="carup-rail -mx-4 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0" data-testid="mycarup-vehicle-rail">
                  {others.map(vehicle => <VehicleCard key={vehicle.vin} vehicle={vehicle} hideMedia={lowBandwidth} />)}
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="min-w-0 space-y-6">
          {attention.length > 0 ? (
            <section
              id="mycarup-attention"
              className="scroll-mt-20 rounded-card bg-carup-raw-ink p-4 text-carup-raw-paper sm:p-5"
              data-testid="owner-needs-attention"
              aria-label="Needs your attention"
            >
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--carup-raw-paper)_70%,transparent)]">Needs your attention</h2>
              <ul className="mt-3 divide-y divide-[color-mix(in_srgb,var(--carup-raw-paper)_14%,transparent)]">
                {attention.map(item => (
                  <li key={item.key} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0" data-testid={`mycarup-attention-${item.key}`}>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{item.label}</p>
                      <p className="mt-0.5 text-[13px] text-[color-mix(in_srgb,var(--carup-raw-paper)_72%,transparent)]">{item.detail}</p>
                    </div>
                    <Link
                      to={item.to}
                      className={`inline-flex min-h-11 w-fit items-center rounded-full bg-carup-raw-paper px-4 text-sm font-semibold text-carup-raw-ink ${FOCUS}`}
                    >
                      {item.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : vehiclesState === 'ready' ? (
            <section className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line" data-testid="mycarup-attention-clear" aria-label="Needs your attention">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Needs your attention</p>
              <p className="mt-2 text-sm text-carup-text-2">Nothing outstanding on your cars or listings right now.</p>
            </section>
          ) : null}

          <section className="min-w-0" data-testid="mycarup-continue" aria-labelledby="mycarup-continue-title">
            <h2 id="mycarup-continue-title" className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-carup-text">Continue where you left off</h2>
            {continueItems.length > 0 ? (
              <ul className="space-y-2">
                {continueItems.map(item => (
                  <li key={item.key}>
                    <Link to={item.to} className={`group flex items-center gap-3 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line transition hover:ring-carup-text-3 ${FOCUS}`} data-testid={item.testId} aria-label={`${item.cta}: ${item.title} — ${item.detail}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-carup-action-soft text-carup-action-hover" aria-hidden="true">
                        {item.key === 'saved' ? <Columns3 className="h-4 w-4" /> : item.key === 'browser-draft' ? <PencilLine className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{item.eyebrow}</span>
                        <span className="block truncate text-sm font-semibold text-carup-text">{item.title}</span>
                        <span className="block truncate text-[13px] text-carup-text-2">{item.detail}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-carup-text-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-card bg-carup-bg-raised p-4 text-sm text-carup-text-2 ring-1 ring-carup-line" data-testid="mycarup-continue-empty">
                Nothing in progress — no listing draft, no shortlist yet.
              </p>
            )}
            {savedState === 'unavailable' && (
              <p className="mt-2 text-[12px] text-carup-text-3" data-testid="mycarup-continue-saved-unavailable">Your saved cars could not be read just now, so they are not listed here.</p>
            )}
          </section>
        </div>
      </div>

      {/* Buy · Sell · Verify · Trade — one CarUp, four moves, each pointed at something real. */}
      <section className="min-w-0" data-testid="mycarup-discover" aria-labelledby="mycarup-discover-title">
        <h2 id="mycarup-discover-title" className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-carup-text">What you can do next</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {discover.map(item => (
            <Link key={item.key} to={item.to} className={`group flex min-h-[9.5rem] flex-col rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line transition hover:ring-carup-action sm:p-5 ${FOCUS}`} data-testid={`mycarup-discover-${item.key}`}>
              <span className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-action-hover">{item.verb}</span>
                <item.icon className="h-4 w-4 text-carup-text-3" aria-hidden="true" />
              </span>
              <span className="mt-3 text-[15px] font-semibold leading-snug text-carup-text">{item.title}</span>
              <span className="mt-1 text-[13px] leading-5 text-carup-text-2">{item.detail}</span>
              <ArrowRight className="mt-auto h-4 w-4 pt-1 text-carup-text-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <Section title="Everything in My CarUp" testId="mycarup-destinations">
        <nav aria-label="My CarUp destinations" className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
          {DESTINATION_GROUPS.map(group => (
            <div key={group.title} className="min-w-0">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">{group.title}</h3>
              <ul className="divide-y divide-carup-line overflow-hidden rounded-xl bg-carup-bg-raised ring-1 ring-carup-line">
                {group.items.map(d => (
                  <li key={d.href}>
                    <Link to={d.href} className={`group flex min-h-12 items-center gap-3 px-3 py-2 transition hover:bg-carup-bg-surface ${FOCUS}`}>
                      <d.icon className="h-4 w-4 shrink-0 text-carup-action-hover" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-carup-text">{d.label}</span>
                        <span className="block truncate text-[12px] text-carup-text-3">{d.detail}</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-carup-text-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Account standing" testId="mycarup-standing">
          <dl className="divide-y divide-carup-line rounded-card bg-carup-bg-raised ring-1 ring-carup-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Automotive Wallet (USD)</dt>
              <dd className="text-right">
                <p data-testid="wallet-usd-value" className="text-sm font-semibold text-carup-text-2">Not available</p>
                <p className="text-[12px] text-carup-text-3">No wallet established for this account</p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Automotive Wallet (ZiG)</dt>
              <dd className="text-right">
                <p data-testid="wallet-zig-value" className="text-sm font-semibold text-carup-text-2">Not available</p>
                <p className="text-[12px] text-carup-text-3">No wallet established for this account</p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Locked SafePay Escrows</dt>
              <dd className="text-right">
                {escrow.status === 'loading' && <p data-testid="escrow-usd-value" className="text-sm font-semibold text-carup-text-2">Loading…</p>}
                {escrow.status === 'error' && <p data-testid="escrow-usd-value" className="text-sm font-semibold text-carup-text-2">Not available</p>}
                {escrow.status === 'ready' && <p data-testid="escrow-usd-value" className="text-base font-bold text-carup-text">${escrow.usd.toLocaleString()}</p>}
                <p className="text-[12px] text-carup-text-3">
                  {escrow.status === 'ready'
                    ? `${escrow.count} active purchase escrow${escrow.count !== 1 ? 's' : ''}`
                    : escrow.status === 'error' ? 'Could not load your escrows' : 'Checking your escrows'}
                </p>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <dt className="text-sm text-carup-text-2">Account Trust Index</dt>
              <dd className="text-right">
                <p data-testid="trust-index-value" className="text-sm font-semibold text-carup-text-2">Not calculated</p>
                <p data-testid="trust-index-label" className="text-[12px] text-carup-text-3">Verification pending</p>
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          title="Notifications"
          testId="mycarup-notifications"
          action={notificationsState === 'ready' ? <span className="rounded-full bg-carup-bg-surface px-2.5 py-1 text-[12px] font-semibold text-carup-text-2">{unread} new</span> : undefined}
        >
          <div className="space-y-2 rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line">
            {notificationsState === 'loading' ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-not-read">
                Your notifications have not been read yet. No count is shown, because none has been counted.
              </p>
            ) : notificationsState === 'unavailable' ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-unavailable">
                CarUp could not read your notifications. This is NOT “you have no notifications” — nothing below has been counted.
              </p>
            ) : recentNotifications.length === 0 ? (
              <p className="text-sm text-carup-text-2" data-testid="owner-notifications-none">No notifications yet.</p>
            ) : recentNotifications.map(n => (
              <div key={n.id} className={`rounded-xl p-3 text-sm ${n.read ? 'bg-carup-bg-surface' : 'bg-[color-mix(in_srgb,var(--carup-action)_10%,transparent)]'}`}>
                <p className="font-semibold text-carup-text">{n.title}</p>
                <p className="mt-0.5 text-carup-text-2">{n.message}</p>
              </div>
            ))}
            <Link to="/dashboard/communications" className={`inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-carup-action-hover ${FOCUS}`}>
              Open communications <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Section>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Documents" testId="mycarup-documents">
          {/* Counted from the Passport rows already read — never a vault claim this page did not check. */}
          <div className="rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line" data-testid="document-vault-list">
            <p className="text-sm text-carup-text-2" data-testid="mycarup-documents-count">
              {vehiclesState !== 'ready'
                ? 'Document counts appear once your Garage has been read.'
                : verifiedDocuments === null
                  ? 'Verified document counts are not recorded for your cars.'
                  : `${verifiedDocuments} verified ${verifiedDocuments === 1 ? 'document' : 'documents'} across your cars.`}
            </p>
            <Link to="/dashboard/evidence" className={`mt-1 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-carup-action-hover ${FOCUS}`}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Open evidence <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Section>
        {!lowBandwidth && (
          <Section title="Vehicle value trend" testId="mycarup-value">
            <div className="rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line">
              <p data-testid="value-trend-unavailable" className="text-sm text-carup-text-2">Valuation history is not available for your account yet.</p>
            </div>
          </Section>
        )}
      </div>

      {/* Session-scoped market intelligence follows the owner's own objects. */}
      <Section title="Market insights" testId="mycarup-insights">
        <div className="min-w-0 space-y-6">
          <MarketplacePulse />
          <NextBestActions />
          <PeriodicReport period="monthly" />
        </div>
      </Section>
    </div>
  )
}
