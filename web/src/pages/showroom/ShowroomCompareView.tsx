/**
 * RX04-B — Compare, in the showroom grammar (presentation only).
 *
 * MarketplaceCompare keeps the data read (`compareMarketplaceListings`, `?vins=`) and every truthful
 * label rule; this view only re-composes it when the showroom presentation is on (flags OFF keeps the
 * accepted page byte-for-byte). Desktop: one column per vehicle under grouped decision signals.
 * Phones: a swipeable vehicle strip, then each signal as a short list — never a sideways-scrolling
 * table. A failed read is an error with Retry, never "nothing to compare". Missing facts stay missing.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { ShowroomListingImage } from '@/components/showroom/ShowroomListingImage'
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'
import { DataState, MoneyDisplay, TrustLens } from '@/components/truth'
import { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'

export interface CompareVehicle {
  vin: string
  make: string
  model: string
  year: number | null
  price: number | null
  currency: string | null
  mileage: number | null
  condition_category: string | null
  trust?: { score: number | null; band: string | null; evaluation_state: string; confidence: string | null } | null
  primary_image_url?: string | null
  primary_image_state?: string | null
  trust_summary?: { trust_badges: string[]; risk_status: string; partsentry_public_status: string; evidence_status: string }
  pricing_summary?: { estimated_total?: number | null; currency?: string | null }
}

export interface ShowroomCompareViewProps {
  state: 'loading' | 'ready' | 'error'
  requestedCount: number
  entries: CompareVehicle[]
  onRetry: () => void
  onRemove: (vin: string) => void
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em]'

function titleCase(value: string | null | undefined) {
  if (!value) return null
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function NotRecorded({ children = 'Not recorded' }: { children?: ReactNode }) {
  return <span className="text-carup-text-3">{children}</span>
}

function name(v: CompareVehicle) {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle identity incomplete'
}

function trustCell(v: CompareVehicle) {
  const t = v.trust
  if (!t || t.evaluation_state !== 'evaluated' || typeof t.score !== 'number') {
    return <TrustLens state="not-evaluated" />
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <TrustLens state="evaluated" />
      <span className="font-semibold tabular-nums text-carup-raw-ink">{titleCase(t.band) ?? 'Band not recorded'} · {t.score}/100</span>
    </span>
  )
}

interface Signal { label: string; render: (v: CompareVehicle) => ReactNode; strong?: boolean }
interface SignalGroup { title: string; signals: Signal[] }

const GROUPS: SignalGroup[] = [
  {
    title: 'Price',
    signals: [
      { label: 'Asking price', strong: true, render: v => <MoneyDisplay amount={v.price} currency={v.currency} /> },
      {
        label: 'All-in estimate',
        render: v => typeof v.pricing_summary?.estimated_total === 'number'
          ? <MoneyDisplay amount={v.pricing_summary.estimated_total} currency={v.pricing_summary.currency ?? v.currency} source="estimate" />
          : <NotRecorded>Not available</NotRecorded>,
      },
    ],
  },
  {
    title: 'Vehicle',
    signals: [
      { label: 'Year', render: v => v.year ?? <NotRecorded /> },
      { label: 'Mileage', render: v => typeof v.mileage === 'number' ? <span className="tabular-nums">{v.mileage.toLocaleString()} km</span> : <NotRecorded /> },
      { label: 'Condition', render: v => titleCase(v.condition_category) ?? <NotRecorded /> },
    ],
  },
  {
    title: 'CarUp Trust',
    signals: [
      { label: 'Trust evaluation', strong: true, render: trustCell },
      { label: 'Confidence', render: v => titleCase(v.trust?.confidence) ?? <NotRecorded /> },
      {
        label: 'Published badges',
        render: v => v.trust_summary?.trust_badges?.length
          ? (
            <span className="flex flex-wrap gap-1.5">
              {v.trust_summary.trust_badges.map(b => (
                <span key={b} className="rounded-full border border-carup-line px-2 py-0.5 text-[12px] text-carup-text-2">{titleCase(b)}</span>
              ))}
            </span>
          )
          : <NotRecorded>None published</NotRecorded>,
      },
      { label: 'Evidence', render: v => titleCase(v.trust_summary?.evidence_status) ?? <NotRecorded /> },
      { label: 'PartSentry', render: v => titleCase(v.trust_summary?.partsentry_public_status) ?? <NotRecorded /> },
      { label: 'Risk', render: v => titleCase(v.trust_summary?.risk_status) ?? <NotRecorded /> },
    ],
  },
]

function imageOf(v: CompareVehicle) {
  return canRenderMarketplacePrimaryImage(v.primary_image_state, v.primary_image_url) ? v.primary_image_url : null
}

function VehicleHead({ v, onRemove, compact = false }: { v: CompareVehicle; onRemove: (vin: string) => void; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid={`compare-vehicle-${v.vin}`}>
      <Link to={`/marketplace/${encodeURIComponent(v.vin)}`} className={`group block rounded-2xl ${FOCUS}`}>
        <div className={`${compact ? 'aspect-[4/3]' : 'aspect-[16/10]'} overflow-hidden rounded-2xl bg-carup-bg-surface`}>
          <ShowroomListingImage src={imageOf(v)} alt={name(v)} className="h-full w-full" imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" plate="compact" />
        </div>
        <p className={`mt-3 font-semibold leading-snug tracking-[-0.01em] text-carup-raw-ink group-hover:text-carup-action ${compact ? 'text-[15px]' : 'text-[17px]'}`}>{name(v)}</p>
      </Link>
      <div className="mt-1"><MoneyDisplay amount={v.price} currency={v.currency} size={compact ? 'md' : 'lg'} /></div>
      <button
        type="button"
        onClick={() => onRemove(v.vin)}
        className={`mt-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full text-[13px] font-medium text-carup-text-2 hover:text-carup-raw-ink ${FOCUS}`}
        aria-label={`Remove ${name(v)} from the comparison`}
        data-testid={`compare-remove-${v.vin}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
      </button>
    </div>
  )
}

function EmptyCompare() {
  return (
    <section className="grid items-center gap-8 rounded-3xl bg-carup-bg-surface px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1.1fr_0.9fr]" data-testid="marketplace-compare-empty">
      <div>
        <p className={`${EYEBROW} text-carup-action`}>Nothing to compare yet</p>
        <h2 className="mt-3 max-w-xl text-[clamp(1.5rem,2.6vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.03em] text-carup-raw-ink">
          Pick up to four cars in the Marketplace, then compare them here.
        </h2>
        <p className="mt-3 max-w-lg text-[15px] leading-6 text-carup-text-2">
          Use “Add to compare” on any listing. Price, condition and CarUp Trust line up side by side, and anything a seller has not recorded stays visibly missing.
        </p>
        <Link to="/marketplace" className={`mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-carup-raw-ink px-5 text-[15px] font-semibold text-white hover:bg-carup-raw-ink-2 ${FOCUS}`}>
          Browse the Marketplace <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="mx-auto w-full max-w-sm text-carup-raw-ink" aria-hidden="true">
        <VehicleSilhouette bodyStyle="sedan" className="h-auto w-full" />
      </div>
    </section>
  )
}

export function ShowroomCompareView({ state, requestedCount, entries, onRetry, onRemove }: ShowroomCompareViewProps) {
  const count = entries.length
  const columns = { gridTemplateColumns: `minmax(10rem, 13rem) repeat(${Math.max(count, 1)}, minmax(0, 1fr))` }

  return (
    <div className="min-h-screen bg-white text-carup-raw-ink" data-testid="marketplace-compare-page" data-presentation="rx04">
      <header className="section-padding mx-auto max-w-[1440px] pb-6 pt-5 sm:pb-8 sm:pt-10">
        <Link to="/marketplace" className={`inline-flex min-h-11 items-center gap-2 rounded-full text-[14px] font-semibold text-carup-text-2 hover:text-carup-raw-ink ${FOCUS}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Marketplace
        </Link>
        <p className={`${EYEBROW} mt-3 text-carup-action`}>Compare</p>
        <h1 className="mt-2 text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]">
          {state === 'ready' && count > 1 ? `Compare ${count} vehicles` : 'Compare vehicles'}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-carup-text-2">
          Asking price, condition and CarUp Trust side by side. When a fact is not recorded it says so — nothing is filled in to make the comparison look complete.
        </p>
      </header>

      <main className="section-padding mx-auto max-w-[1440px] pb-16">
        {state === 'loading' && <DataState state="loading" subject="Comparison" />}
        {state === 'error' && <DataState state="error" subject="Comparison" action={{ label: 'Try again', onClick: onRetry }} />}
        {state === 'ready' && requestedCount === 0 && <EmptyCompare />}
        {state === 'ready' && requestedCount > 0 && count === 0 && (
          <DataState
            state="empty"
            subject="Comparison"
            description="None of the selected vehicles is publicly listed any more."
          />
        )}

        {state === 'ready' && count > 0 && (
          <>
            {/* Phones and small tablets: vehicle strip + attribute-first lists. */}
            <div className="md:hidden" data-testid="compare-mobile">
              <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2" role="list" aria-label="Vehicles in this comparison">
                {entries.map(v => (
                  <div key={v.vin} role="listitem" className="w-[min(72vw,16rem)] shrink-0 snap-start">
                    <VehicleHead v={v} onRemove={onRemove} compact />
                  </div>
                ))}
              </div>
              {GROUPS.map(group => (
                <section key={group.title} className="mt-8" aria-labelledby={`compare-m-${group.title}`}>
                  <h2 id={`compare-m-${group.title}`} className="border-b border-carup-line pb-2 text-[17px] font-semibold tracking-[-0.01em]">{group.title}</h2>
                  <dl className="divide-y divide-carup-line">
                    {group.signals.map(signal => (
                      <div key={signal.label} className="py-3">
                        <dt className="text-[13px] font-medium text-carup-text-2">{signal.label}</dt>
                        <dd className="mt-2 space-y-1.5">
                          {entries.map(v => (
                            <div key={v.vin} className="flex items-baseline justify-between gap-3 text-[14px]">
                              <span className="min-w-0 truncate text-carup-text-2">{name(v)}</span>
                              <span className={`shrink-0 text-right ${signal.strong ? 'font-semibold text-carup-raw-ink' : 'text-carup-text'}`}>{signal.render(v)}</span>
                            </div>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>

            {/* Tablet and desktop: one column per vehicle. */}
            <div className="hidden md:block" data-testid="compare-desktop">
              <div className="grid gap-x-6 border-b border-carup-line pb-6" style={columns}>
                <div className="self-end pb-2 text-[13px] text-carup-text-2">{count} of {Math.max(requestedCount, count)} selected</div>
                {entries.map(v => <VehicleHead key={v.vin} v={v} onRemove={onRemove} />)}
              </div>
              {GROUPS.map(group => (
                <section key={group.title} aria-labelledby={`compare-d-${group.title}`}>
                  <h2 id={`compare-d-${group.title}`} className={`${EYEBROW} pb-2 pt-8 text-carup-text-2`}>{group.title}</h2>
                  <div role="table" aria-label={`${group.title} comparison`} className="border-t border-carup-line">
                    {group.signals.map(signal => (
                      <div key={signal.label} role="row" className="grid gap-x-6 border-b border-carup-line py-3.5" style={columns}>
                        <div role="rowheader" className="text-[14px] font-medium text-carup-text-2">{signal.label}</div>
                        {entries.map(v => (
                          <div key={v.vin} role="cell" className={`min-w-0 text-[14px] ${signal.strong ? 'font-semibold text-carup-raw-ink' : 'text-carup-text'}`}>
                            {signal.render(v)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
