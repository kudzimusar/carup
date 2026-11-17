/**
 * RX04-B — Compare, in the showroom grammar (presentation only).
 *
 * MarketplaceCompare keeps the data read (`compareMarketplaceListings`, `?vins=`) and every truthful
 * label rule; this view only re-composes it when the showroom presentation is on (flags OFF keeps the
 * accepted page byte-for-byte). Desktop: one column per vehicle under grouped decision signals.
 * Phones: a swipeable vehicle strip, then each signal as a short list — never a sideways-scrolling
 * table. A failed read is an error with Retry, never "nothing to compare". Missing facts stay missing.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CircleHelp, MessageSquare, X } from 'lucide-react'
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
  /** Backend verification projection (compareListings passes the detail's summary through). */
  verification_summary?: {
    seller_verified?: boolean
    identity_status?: 'unverified' | 'pending_review' | 'verified' | 'rejected' | string
    vehicle_evidence_verified?: boolean
    inspection_available?: boolean
    inspection_verified?: boolean
  } | null
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

/** Where a row's values come from, in CarUp's own provenance words. */
type RowSource = 'seller' | 'governed' | 'estimate'
const SOURCE_LABEL: Record<RowSource, string> = { seller: 'Seller-stated', governed: 'Governed record', estimate: 'Estimate' }

interface Signal {
  label: string
  render: (v: CompareVehicle) => ReactNode
  /** Comparable value for "where do they differ" (null = not recorded). */
  key: (v: CompareVehicle) => string | null
  source: RowSource
  strong?: boolean
  /** Value is too wide to share a phone row with the car's name. */
  stacked?: boolean
}
interface SignalGroup { title: string; note: string; signals: Signal[] }

function inspectionText(v: CompareVehicle): string | null {
  const vs = v.verification_summary
  if (!vs) return null
  if (vs.inspection_verified) return 'Verified inspection'
  if (vs.inspection_available) return 'Inspection on file — not verified'
  return 'No inspection on record'
}

const GROUPS: SignalGroup[] = [
  {
    title: 'Commercial',
    note: 'What the seller is asking, and CarUp’s all-in estimate where one exists.',
    signals: [
      { label: 'Asking price', strong: true, source: 'seller', key: v => (v.price == null ? null : `${v.price} ${v.currency ?? ''}`), render: v => <MoneyDisplay amount={v.price} currency={v.currency} /> },
      {
        label: 'All-in estimate', source: 'estimate',
        key: v => (typeof v.pricing_summary?.estimated_total === 'number' ? String(v.pricing_summary.estimated_total) : null),
        render: v => typeof v.pricing_summary?.estimated_total === 'number'
          ? <MoneyDisplay amount={v.pricing_summary.estimated_total} currency={v.pricing_summary.currency ?? v.currency} source="estimate" />
          : <NotRecorded>Not available</NotRecorded>,
      },
    ],
  },
  {
    title: 'The car',
    note: 'Identity and use, as listed.',
    signals: [
      { label: 'Year', source: 'seller', key: v => (v.year == null ? null : String(v.year)), render: v => v.year ?? <NotRecorded /> },
      { label: 'Mileage', source: 'seller', key: v => (typeof v.mileage === 'number' ? String(v.mileage) : null), render: v => typeof v.mileage === 'number' ? <span className="tabular-nums">{v.mileage.toLocaleString()} km</span> : <NotRecorded /> },
      { label: 'Condition', source: 'seller', key: v => v.condition_category ?? null, render: v => titleCase(v.condition_category) ?? <NotRecorded /> },
    ],
  },
  {
    title: 'Evidence',
    note: 'What CarUp has checked. “Not verified” is not a finding against the car — it means no reviewed record yet.',
    signals: [
      { label: 'CarUp Trust', strong: true, stacked: true, source: 'governed', key: v => (v.trust?.evaluation_state === 'evaluated' && typeof v.trust.score === 'number' ? `${v.trust.score}` : 'not-evaluated'), render: trustCell },
      { label: 'Confidence', source: 'governed', key: v => v.trust?.confidence ?? null, render: v => titleCase(v.trust?.confidence) ?? <NotRecorded /> },
      { label: 'Identity', source: 'governed', key: v => v.verification_summary?.identity_status ?? null, render: v => titleCase(v.verification_summary?.identity_status) ?? <NotRecorded /> },
      {
        label: 'Reviewed evidence', source: 'governed',
        key: v => (v.verification_summary ? String(Boolean(v.verification_summary.vehicle_evidence_verified)) : null),
        render: v => !v.verification_summary ? <NotRecorded /> : v.verification_summary.vehicle_evidence_verified ? 'On file' : <NotRecorded>Not verified</NotRecorded>,
      },
      { label: 'Inspection', source: 'governed', key: inspectionText, render: v => inspectionText(v) ?? <NotRecorded /> },
      { label: 'Evidence status', source: 'governed', key: v => v.trust_summary?.evidence_status ?? null, render: v => titleCase(v.trust_summary?.evidence_status) ?? <NotRecorded /> },
      {
        label: 'Published badges', stacked: true, source: 'governed',
        key: v => (v.trust_summary?.trust_badges?.length ? [...v.trust_summary.trust_badges].sort().join(',') : null),
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
      { label: 'PartSentry', source: 'governed', key: v => v.trust_summary?.partsentry_public_status ?? null, render: v => titleCase(v.trust_summary?.partsentry_public_status) ?? <NotRecorded /> },
      { label: 'Risk', source: 'governed', key: v => v.trust_summary?.risk_status ?? null, render: v => titleCase(v.trust_summary?.risk_status) ?? <NotRecorded /> },
    ],
  },
  {
    title: 'Seller',
    note: 'Who is selling, as far as CarUp has verified.',
    signals: [
      {
        label: 'Seller verification', source: 'governed',
        key: v => (v.verification_summary ? String(Boolean(v.verification_summary.seller_verified)) : null),
        render: v => !v.verification_summary ? <NotRecorded /> : v.verification_summary.seller_verified ? 'Verified seller' : <NotRecorded>Not verified</NotRecorded>,
      },
    ],
  },
]

/** Rows where the cars' recorded values differ (an unrecorded value counts as its own value). */
function differs(signal: Signal, entries: CompareVehicle[]) {
  if (entries.length < 2) return false
  const values = entries.map(v => signal.key(v) ?? '∅')
  return values.some(value => value !== values[0])
}

/** What a buyer still does not know about one car — each a question worth asking the seller. */
function unknownsFor(v: CompareVehicle): string[] {
  const out: string[] = []
  if (v.price == null) out.push('What is the asking price?')
  if (typeof v.mileage !== 'number') out.push('What does the odometer read?')
  if (!v.condition_category || v.condition_category === 'unknown') out.push('What condition is the car in?')
  if (!(v.trust?.evaluation_state === 'evaluated' && typeof v.trust.score === 'number')) out.push('Can you share documents so CarUp can evaluate Trust?')
  const vs = v.verification_summary
  if (vs && !vs.vehicle_evidence_verified) out.push('Which records (service, registration) can you provide?')
  if (vs && !vs.inspection_verified) out.push(vs.inspection_available ? 'Can the inspection be verified?' : 'Will you allow an inspection?')
  return out
}

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
  // I-03 Buyer Decision Desk: focus on where the cars differ (local view state only).
  const [differencesOnly, setDifferencesOnly] = useState(false)
  const groups = GROUPS
    .map(group => ({ ...group, signals: group.signals.filter(signal => !differencesOnly || differs(signal, entries)) }))
    .filter(group => group.signals.length > 0)
  const differingRows = GROUPS.reduce((n, group) => n + group.signals.filter(signal => differs(signal, entries)).length, 0)

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
          Price, the car, its evidence and the seller side by side — with where each fact comes from. When a fact is not recorded it says so; nothing is filled in, and no car is scored “best”. The choice is yours.
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
            {count > 1 && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-carup-bg-surface px-4 py-3" data-testid="compare-differences-bar">
                <p className="text-[14px] text-carup-text-2">
                  <span className="font-semibold text-carup-raw-ink" data-testid="compare-differences-count">{differingRows}</span> of {GROUPS.reduce((n, g) => n + g.signals.length, 0)} facts differ between these cars.
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={differencesOnly}
                  onClick={() => setDifferencesOnly(value => !value)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold ring-1 transition ${FOCUS} ${differencesOnly ? 'bg-carup-raw-ink text-white ring-carup-raw-ink' : 'bg-white text-carup-raw-ink ring-carup-line'}`}
                  data-testid="compare-differences-toggle"
                >
                  {differencesOnly ? 'Showing differences only' : 'Show differences only'}
                </button>
              </div>
            )}
            {/* Phones and small tablets: vehicle strip + attribute-first lists. */}
            <div className="md:hidden" data-testid="compare-mobile">
              <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" role="list" aria-label="Vehicles in this comparison">
                {entries.map(v => (
                  <div key={v.vin} role="listitem" className="w-[min(72vw,16rem)] shrink-0 snap-start">
                    <VehicleHead v={v} onRemove={onRemove} compact />
                  </div>
                ))}
              </div>
              {groups.map(group => (
                <section key={group.title} className="mt-8" aria-labelledby={`compare-m-${group.title}`}>
                  <h2 id={`compare-m-${group.title}`} className="text-[17px] font-semibold tracking-[-0.01em]">{group.title}</h2>
                  <p className="mt-0.5 border-b border-carup-line pb-2 text-[13px] leading-5 text-carup-text-2">{group.note}</p>
                  <dl className="divide-y divide-carup-line">
                    {group.signals.map(signal => (
                      <div key={signal.label} className="py-3" data-differs={differs(signal, entries) ? 'true' : 'false'}>
                        <dt className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-carup-text-2">
                          {signal.label}
                          <span className="text-[11px] font-normal text-carup-text-3">{SOURCE_LABEL[signal.source]}</span>
                          {differs(signal, entries) && <span className="rounded-full bg-carup-action-soft px-2 py-0.5 text-[11px] font-semibold text-carup-action-hover">Differs</span>}
                        </dt>
                        <dd className="mt-2 space-y-1.5">
                          {entries.map(v => signal.stacked ? (
                            <div key={v.vin} className="min-w-0 text-[14px]">
                              <span className="block truncate text-carup-text-2">{name(v)}</span>
                              <span className={`mt-1 block min-w-0 ${signal.strong ? 'font-semibold text-carup-raw-ink' : 'text-carup-text'}`}>{signal.render(v)}</span>
                            </div>
                          ) : (
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
              {groups.map(group => (
                <section key={group.title} aria-labelledby={`compare-d-${group.title}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 pb-2 pt-8">
                    <h2 id={`compare-d-${group.title}`} className={`${EYEBROW} text-carup-text-2`}>{group.title}</h2>
                    <p className="text-[13px] text-carup-text-3">{group.note}</p>
                  </div>
                  <div role="table" aria-label={`${group.title} comparison`} className="border-t border-carup-line">
                    {group.signals.map(signal => (
                      <div key={signal.label} role="row" className={`grid gap-x-6 border-b border-carup-line py-3.5 ${differs(signal, entries) ? 'bg-carup-bg-surface' : ''}`} style={columns} data-differs={differs(signal, entries) ? 'true' : 'false'}>
                        <div role="rowheader" className="text-[14px] font-medium text-carup-text-2">
                          {signal.label}
                          <span className="block text-[11px] font-normal text-carup-text-3">{SOURCE_LABEL[signal.source]}{differs(signal, entries) ? ' · differs' : ''}</span>
                        </div>
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

            {/* What is still unknown, per car — each a question worth asking before deciding. */}
            <section className="mt-12" aria-labelledby="compare-unknowns" data-testid="compare-unknowns">
              <h2 id="compare-unknowns" className="text-[clamp(1.25rem,2vw,1.6rem)] font-bold tracking-[-0.02em]">Unknowns and questions</h2>
              <p className="mt-1 max-w-2xl text-[14px] leading-6 text-carup-text-2">What CarUp cannot tell you yet about each car. Ask the seller through the listing, or open the full listing for its specifications and history.</p>
              <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {entries.map(v => {
                  const questions = unknownsFor(v)
                  return (
                    <li key={v.vin} className="flex flex-col rounded-2xl bg-carup-bg-surface p-4" data-testid={`compare-unknowns-${v.vin}`}>
                      <p className="truncate text-[15px] font-semibold text-carup-raw-ink">{name(v)}</p>
                      {questions.length === 0 ? (
                        <p className="mt-2 text-[13px] text-carup-text-2">No gaps in the facts compared here.</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {questions.map(q => (
                            <li key={q} className="flex gap-2 text-[13px] leading-5 text-carup-text-2"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-carup-text-3" aria-hidden="true" />{q}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <Link to={`/marketplace/${encodeURIComponent(v.vin)}#vd-ask`} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-carup-raw-ink px-4 text-[13px] font-semibold text-white ${FOCUS}`} data-testid={`compare-ask-${v.vin}`}>
                          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Ask the seller
                        </Link>
                        <Link to={`/marketplace/${encodeURIComponent(v.vin)}#vd-story`} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-carup-raw-ink ring-1 ring-carup-line ${FOCUS}`}>
                          Vehicle Story <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-4 text-[12px] leading-5 text-carup-text-3">Fuel, gearbox and body style are on each full listing; the comparison read does not carry them yet.</p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
