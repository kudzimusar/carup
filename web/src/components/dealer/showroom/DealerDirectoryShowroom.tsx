/**
 * RX05-A — the unified (showroom) presentation of /dealers. The page container owns the filters,
 * the debounced directory read and pagination; this view only arranges what the API returned.
 *
 *  - Filters use ONLY values the API returned: `available_categories`, `available_tiers`, and the
 *    cities present in returned entries (the city filter is an exact match on the server).
 *  - A card's standing comes from `business_verified` / `claimed` / `tier` (dealerStanding). An
 *    unclaimed research entry never reads as an active or approved CarUp dealer.
 *  - The hero art is an original illustration with a visible disclosure; it is never a dealer's
 *    premises or stock.
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, MapPin, MessageSquareWarning, RotateCcw, Search, Store, X } from 'lucide-react'
import { SceneDisclosure, ShowroomFloorScene } from '@/components/media/rx05/AutomotiveScenes'
import { dealerDate } from '@/lib/dealerDates'
import { cn } from '@/lib/utils'
import {
  dealerStanding, mergeCities, standingForTier, tierOptionLabel, type ShowroomDealer,
} from './dealerShowroomModel'
import {
  ACTION_GHOST_ON_INK, ACTION_ON_INK, ACTION_PRIMARY, ACTION_SECONDARY, CARD, DealerMark, EYEBROW, EYEBROW_ON_INK,
  FIELD, LABEL, Notice, PAGE_WIDTH, SkeletonBlock, StatusChip, TEXT_LINK,
} from './ShowroomPrimitives'

export interface DirectoryShowroomEnvelope {
  entries: ShowroomDealer[]
  total: number | null
  page: number
  limit: number
  available_categories?: string[]
  available_tiers?: string[]
}

export interface DealerDirectoryShowroomProps {
  search: string
  city: string
  category: string
  tier: string
  onSearch: (value: string) => void
  onCity: (value: string) => void
  onCategory: (value: string) => void
  onTier: (value: string) => void
  onClear: () => void
  hasFilters: boolean
  page: number
  onPage: (next: number) => void
  state: 'loading' | 'ready' | 'unavailable'
  directory: DirectoryShowroomEnvelope | null
  onRetry: () => void
}

const SIGNAL = 'var(--carup-raw-orange-signal)'

/** The abstract brand plate at the top of each card: glazing bars and a light rail, never a photo. */
function CardPlate({ dealer }: { dealer: ShowroomDealer }) {
  return (
    <div className="relative h-28 overflow-hidden bg-carup-raw-ink" aria-hidden="true">
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--carup-raw-navy) 90%, transparent) 0%, var(--carup-raw-ink) 100%)' }} />
      {[14, 30, 46, 62, 78, 94].map(left => (
        <div key={left} className="absolute top-3 h-[62%] w-px bg-white/[0.07]" style={{ left: `${left}%` }} />
      ))}
      <div
        className="absolute -left-4 -right-4 top-4 h-[2px] -rotate-[1.2deg] opacity-80 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${SIGNAL} 22%, ${SIGNAL} 78%, transparent)`, boxShadow: `0 0 18px 2px color-mix(in srgb, ${SIGNAL} 40%, transparent)` }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--carup-raw-ink-2) 92%, black), var(--carup-raw-ink))' }} />
      <p className="absolute right-4 top-7 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
        <MapPin className="h-3 w-3" />{dealer.city}
      </p>
      <DealerMark name={dealer.name} size="md" onInk className="absolute bottom-4 left-5 shadow-sheet" />
    </div>
  )
}

function DealerCard({ dealer }: { dealer: ShowroomDealer }) {
  const standing = dealerStanding(dealer)
  const nameId = useId()
  return (
    <li className="min-w-0">
      <article
        className="group relative flex h-full flex-col overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line transition duration-200 hover:-translate-y-0.5 hover:ring-carup-line-strong hover:shadow-sheet motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        aria-labelledby={nameId}
        data-testid={`dealer-directory-card-${dealer.seed_dealer_id}`}
        data-standing={standing.key}
      >
        <CardPlate dealer={dealer} />
        <div className="flex flex-1 flex-col p-5">
          <h3 id={nameId} className="text-lg font-semibold leading-snug tracking-[-0.015em] text-carup-text [overflow-wrap:anywhere]">
            <Link
              to={`/dealers/${dealer.slug}`}
              className="rounded-control after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-carup-focus"
            >
              {dealer.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-carup-text-2 [overflow-wrap:anywhere]">
            {dealer.category}<span className="sr-only"> · {dealer.city}, Zimbabwe</span>
          </p>
          <div className="mt-4">
            <StatusChip tone={standing.tone} testId={`dealer-directory-standing-${dealer.seed_dealer_id}`}>{standing.chip}</StatusChip>
          </div>
          <p className="mt-4 text-[13px] leading-5 text-carup-text-3 [overflow-wrap:anywhere]">
            Source: {dealer.source_attribution} · reviewed {dealerDate(dealer.reviewed_at)}. Information may be outdated.
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-carup-text" aria-hidden="true">
              View dealership
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
            {standing.key === 'unclaimed' && !dealer.claimed && (
              <Link to={`/dealers/${dealer.slug}/claim`} className={cn(TEXT_LINK, 'relative z-10 text-sm')}>
                Claim this dealership
              </Link>
            )}
          </div>
        </div>
      </article>
    </li>
  )
}

export function DealerDirectoryShowroom(props: DealerDirectoryShowroomProps) {
  const { search, city, category, tier, onSearch, onCity, onCategory, onTier, onClear, hasFilters, page, onPage, state, directory, onRetry } = props

  // Remember what the API has returned so the filters stay stable while a new read is in flight.
  const [seen, setSeen] = useState<{ source: DirectoryShowroomEnvelope | null; cities: string[]; categories: string[]; tiers: string[] }>(
    { source: null, cities: [], categories: [], tiers: [] },
  )
  if (directory && directory !== seen.source) {
    setSeen({
      source: directory,
      cities: mergeCities(seen.cities, directory.entries),
      categories: directory.available_categories?.length ? directory.available_categories : seen.categories,
      tiers: directory.available_tiers?.length ? directory.available_tiers : seen.tiers,
    })
  }
  const cityOptions = city && !seen.cities.includes(city) ? [...seen.cities, city] : seen.cities

  const entries = directory?.entries ?? []
  const pages = directory && directory.total !== null ? Math.ceil(directory.total / directory.limit) : 1

  return (
    <main className="min-h-screen bg-carup-bg text-carup-text" data-testid="dealer-directory-showroom" data-presentation="showroom">
      {/* ── Editorial hero ── */}
      <section className="relative overflow-hidden bg-carup-raw-ink text-carup-raw-paper" aria-labelledby="dealer-directory-title">
        <div className={cn(PAGE_WIDTH, 'grid items-center gap-8 pb-20 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pb-28 lg:pt-16')}>
          <div className="min-w-0">
            <p className={EYEBROW_ON_INK}>CarUp Dealers · Zimbabwe</p>
            <h1 id="dealer-directory-title" className="mt-4 max-w-[14ch] text-[clamp(2.25rem,5.4vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.04em] text-white">
              Dealerships, with the facts on the record.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/75 sm:text-lg">
              Browse automotive businesses published on CarUp. Every profile shows where its information came from and what CarUp has — and has not — reviewed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#dealer-results" className={ACTION_ON_INK}>
                Browse dealerships <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href="#dealer-own" className={ACTION_GHOST_ON_INK}>Own a dealership?</a>
            </div>
          </div>
          <div className="relative min-w-0">
            {/* The disclosure sits on the back wall so it never covers the illustrated cars on phones. */}
            <ShowroomFloorScene className="aspect-[16/10] w-full rounded-card ring-1 ring-white/10" disclosure={false} />
            <SceneDisclosure className="absolute right-3 top-[18%]" />
          </div>
        </div>
      </section>

      {/* ── Finder: overlaps the hero ── */}
      <div className={cn(PAGE_WIDTH, 'relative z-10 -mt-12 lg:-mt-16')}>
        <section id="dealer-finder" aria-label="Find a dealership" className={cn(CARD, 'p-4 shadow-sheet sm:p-6')}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <label htmlFor="dealer-search" className={LABEL}>Dealership name</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-carup-text-3" aria-hidden="true" />
                <input
                  id="dealer-search"
                  type="search"
                  className={cn(FIELD, 'pl-10')}
                  placeholder="Search published profiles"
                  value={search}
                  maxLength={80}
                  onChange={event => onSearch(event.target.value)}
                />
              </div>
            </div>
            {seen.categories.length > 0 && (
              <div className="min-w-0">
                <label htmlFor="dealer-category-filter" className={LABEL}>Category</label>
                <select id="dealer-category-filter" data-testid="dealer-category-filter" className={FIELD} value={category} onChange={event => onCategory(event.target.value)}>
                  <option value="">All categories</option>
                  {seen.categories.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            )}
            {seen.tiers.length > 0 && (
              <div className="min-w-0">
                <label htmlFor="dealer-tier-filter" className={LABEL}>Standing on CarUp</label>
                <select id="dealer-tier-filter" data-testid="dealer-tier-filter" className={FIELD} value={tier} onChange={event => onTier(event.target.value)}>
                  <option value="">Any standing</option>
                  {seen.tiers.map(item => <option key={item} value={item}>{tierOptionLabel(item)}</option>)}
                </select>
              </div>
            )}
          </div>
          {cityOptions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="City">
              <span className="mr-1 text-sm font-semibold text-carup-text">City</span>
              {['', ...cityOptions].map(option => {
                const active = city === option
                return (
                  <button
                    key={option || 'all'}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onCity(option)}
                    data-testid={`dealer-city-chip-${option || 'all'}`}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:min-h-9',
                      active ? 'bg-carup-raw-ink text-carup-raw-paper' : 'bg-carup-bg-surface text-carup-text ring-1 ring-carup-line hover:bg-carup-bg-surface-2',
                    )}
                  >
                    {option || 'All cities'}
                  </button>
                )
              })}
              {hasFilters && (
                <button type="button" onClick={onClear} data-testid="dealer-directory-clear-filters" className={cn(TEXT_LINK, 'ml-auto inline-flex min-h-11 items-center gap-1 text-sm sm:min-h-9')}>
                  <X className="h-4 w-4" aria-hidden="true" />Clear filters
                </button>
              )}
            </div>
          )}
          {cityOptions.length === 0 && hasFilters && (
            <div className="mt-4">
              <button type="button" onClick={onClear} data-testid="dealer-directory-clear-filters" className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center gap-1 text-sm')}>
                <X className="h-4 w-4" aria-hidden="true" />Clear filters
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── Results ── */}
      <section id="dealer-results" className={cn(PAGE_WIDTH, 'scroll-mt-24 pb-16 pt-12')} aria-labelledby="dealer-results-title">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className={EYEBROW}>The directory</p>
            <h2 id="dealer-results-title" className="mt-1.5 text-[clamp(1.5rem,2.4vw,2.125rem)] font-bold leading-[1.08] tracking-[-0.03em]">
              Dealerships on CarUp
            </h2>
          </div>
          {state === 'ready' && directory && entries.length > 0 && (
            <p className="text-sm text-carup-text-2" aria-live="polite" data-testid="dealer-directory-count">
              {directory.total == null
                ? 'Published profiles'
                : `${directory.total} published ${directory.total === 1 ? 'profile' : 'profiles'}${hasFilters ? ' match' : ''}`}
            </p>
          )}
        </div>

        {seen.tiers.length > 0 && (
          <ul className="-mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0" aria-label="What a listing’s standing means" data-testid="dealer-directory-legend">
            {seen.tiers.map(item => {
              const standing = standingForTier(item)
              if (!standing) return null
              return (
                <li key={item} className="w-[82%] min-w-0 shrink-0 snap-start rounded-card bg-carup-bg-surface p-4 md:w-auto">
                  <StatusChip tone={standing.tone}>{standing.chip}</StatusChip>
                  <p className="mt-2 text-[13px] leading-5 text-carup-text-2">{standing.meaning}</p>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-8">
          {state === 'loading' && (
            <div>
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
                {[0, 1, 2].map(index => (
                  <li key={index} className={cn(CARD, 'overflow-hidden')}>
                    <SkeletonBlock className="h-28 rounded-none" />
                    <div className="space-y-3 p-5">
                      <SkeletonBlock className="h-5 w-3/4" />
                      <SkeletonBlock className="h-4 w-1/2" />
                      <SkeletonBlock className="h-6 w-2/3 rounded-full" />
                    </div>
                  </li>
                ))}
              </ul>
              <p role="status" className="mt-4 text-sm text-carup-text-2">Loading reviewed dealership profiles…</p>
            </div>
          )}
          {state === 'unavailable' && (
            <div className="max-w-2xl">
              <Notice tone="warning" role="alert" title="The dealership directory could not be loaded">
                This is not evidence that no dealers exist. Try again in a moment.
              </Notice>
              <button type="button" onClick={onRetry} className={cn(ACTION_SECONDARY, 'mt-4')} data-testid="dealer-directory-retry">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />Try again
              </button>
            </div>
          )}
          {state === 'ready' && directory && entries.length === 0 && (
            <div className={cn(CARD, 'px-6 py-12 text-center')} data-testid="dealer-directory-empty">
              <Store className="mx-auto h-9 w-9 text-carup-text-3" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold">No published profiles match</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-carup-text-2">
                Research records are never listed publicly before a safe publication review, so a missing business may simply not be published yet.
              </p>
              {hasFilters && (
                <button type="button" onClick={onClear} className={cn(ACTION_SECONDARY, 'mt-5')}>Clear filters</button>
              )}
            </div>
          )}
          {state === 'ready' && directory && entries.length > 0 && (
            <>
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="dealer-directory-grid">
                {entries.map(dealer => <DealerCard key={dealer.seed_dealer_id} dealer={dealer} />)}
              </ul>
              {directory.total !== null && directory.total > directory.limit && (
                <nav aria-label="Dealership directory pages" className="mt-10 flex items-center justify-between gap-4 border-t border-carup-line pt-6">
                  <button type="button" className={ACTION_SECONDARY} disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>
                    Previous page
                  </button>
                  <span className="text-sm text-carup-text-2">Page {directory.page} of {pages}</span>
                  <button type="button" className={ACTION_SECONDARY} disabled={page >= pages} onClick={() => onPage(page + 1)}>
                    Next page
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── For dealers ── */}
      <section id="dealer-own" className="scroll-mt-24 border-t border-carup-line bg-carup-bg-surface" aria-labelledby="dealer-own-title">
        <div className={cn(PAGE_WIDTH, 'grid gap-10 py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:py-20')}>
          <div className="min-w-0">
            <p className={EYEBROW}>For dealerships</p>
            <h2 id="dealer-own-title" className="mt-1.5 max-w-md text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.03em]">
              Is your business listed? Claim it.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-7 text-carup-text-2">
              Find your listing above and choose “Claim this dealership”. You provide private evidence; CarUp reviews it independently before any dealer access is granted.
            </p>
            <a href="#dealer-finder" className={cn(ACTION_PRIMARY, 'mt-6')}>Find your listing</a>
            <p className="mt-6 max-w-lg text-sm leading-6 text-carup-text-2" data-testid="dealer-unavailable-new-business">
              Your dealership is not listed, or operates outside Zimbabwe? Applying as a new business without a CarUp research listing is not available yet.
            </p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              ['Request a claim', 'Tell CarUp how you are connected to the business. This opens an evidence-required request only.'],
              ['Upload private evidence', 'Original registration and authority documents go to a private store — never to the public profile.'],
              ['Independent review', 'A CarUp reviewer who is not you inspects the originals and decides the claim.'],
              ['Dealer application', 'Only after an approved claim: your prefilled application, then separate legal review before activation.'],
            ].map(([title, body], index) => (
              <li key={title} className={cn(CARD, 'min-w-0 p-5')}>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-action tabular-nums">Step {String(index + 1).padStart(2, '0')}</span>
                <p className="mt-2 font-semibold text-carup-text">{title}</p>
                <p className="mt-1 text-[13px] leading-5 text-carup-text-2">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={cn(PAGE_WIDTH, 'py-10')} aria-label="Buyer feedback">
        <Link to="/dealers/feedback" className={cn(CARD, 'group flex items-center gap-4 p-5 transition hover:ring-carup-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus')}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-carup-action-soft text-carup-action" aria-hidden="true">
            <MessageSquareWarning className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-carup-text">Transaction-linked buyer complaints and private feedback</span>
            <span className="block text-sm text-carup-text-2">Bought through CarUp from a dealership? Tell CarUp privately. Nothing becomes a public rating.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-carup-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </section>
    </main>
  )
}
