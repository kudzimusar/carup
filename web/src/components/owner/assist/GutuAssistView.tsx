/**
 * RX04-C2 — Gutu AI, unified presentation (flag ON only; the accepted view is unchanged).
 *
 * Same read, same truth rules as the container (CarUp Intelligence I18): Gutu shows what CarUp
 * records about the signed-in owner, what it does NOT hold and the rules it works under. This page
 * takes no free-form questions, so nothing here imitates a conversation and no answer is ever
 * written for Gutu. When the governed context cannot be read, the page says so plainly and offers
 * the owner's own records directly instead.
 *
 * Every link below is navigation only, keyed to a fact the server named. A fact key this page does
 * not recognise simply has no link.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Car, CheckCircle2, CircleSlash, Search, Shield, Sparkles, Wrench } from 'lucide-react'
import { DataState } from '@/components/truth'
import { OWNER_FOCUS, OWNER_SECONDARY_ACTION, OwnerPageHeader } from '@/components/owner/OwnerPageHeader'

export interface GutuFact {
  key: string
  label: string
  value: number | null
  unit: string | null
  available: boolean
  reason: string | null
  source: string
}

export interface GutuContextPayload {
  ok?: boolean
  availability?: string
  message?: string
  facts?: GutuFact[]
  boundaries?: string[]
}

/** Where each fact Gutu can see lives in My CarUp. */
const FACT_LINKS: Record<string, { label: string; href: string }> = {
  vehicles_owned: { label: 'Open my garage', href: '/dashboard/garage' },
  vehicles_published: { label: 'Manage listings', href: '/dashboard/listings' },
  enquiries_received: { label: 'Open messages', href: '/dashboard/communications' },
  enquiries_awaiting_reply: { label: 'Open messages', href: '/dashboard/communications' },
}

/** For the things Gutu will not guess: the place an owner can look for themselves. */
const NOT_HELD_LINKS: Record<string, { label: string; href: string }> = {
  market_valuation: { label: 'See asking prices on the Marketplace', href: '/marketplace' },
  service_due: { label: 'See the services recorded on your cars', href: '/dashboard/service-history' },
  insurance_policy: { label: 'Open your insurance records', href: '/dashboard/insurance' },
  nearby_mechanics: { label: 'Browse the garage directory', href: '/garages' },
}

/** Useful without Gutu — the owner's own records, one tap away. */
const RECORD_DOORS: Array<{ label: string; detail: string; href: string; icon: typeof Car }> = [
  { label: 'Garage & Passports', detail: 'Every car on your account and its Vehicle Passport', href: '/dashboard/garage', icon: Car },
  { label: 'Service history', detail: 'Work recorded on your cars', href: '/dashboard/service-history', icon: Wrench },
  { label: 'Insurance', detail: 'Policies you have recorded', href: '/dashboard/insurance', icon: Shield },
  { label: 'Marketplace', detail: 'Browse cars for sale', href: '/marketplace', icon: Search },
  { label: 'Verify a VIN', detail: 'See what CarUp knows about any car', href: '/search', icon: BadgeCheck },
]

const H2 = 'text-[17px] font-semibold tracking-[-0.01em] text-carup-text'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3'

function RecordDoors({ testId }: { testId: string }) {
  return (
    <section className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <p className={EYEBROW}>Useful without Gutu</p>
      <h2 id={`${testId}-title`} className={`mt-1 ${H2}`}>Go straight to your records</h2>
      <ul className="mt-3 divide-y divide-carup-line">
        {RECORD_DOORS.map(door => (
          <li key={door.label}>
            <Link to={door.href} className={`group flex min-h-14 items-center gap-3 rounded-control py-2.5 ${OWNER_FOCUS}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-carup-action-soft text-carup-action-hover" aria-hidden="true">
                <door.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-carup-text">{door.label}</span>
                <span className="block text-[13px] leading-5 text-carup-text-2">{door.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-carup-text-3 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function GutuAssistView({ state, payload, known, notHeld, onRetry }: {
  state: 'loading' | 'ready' | 'failed'
  payload: GutuContextPayload | null
  known: GutuFact[]
  notHeld: GutuFact[]
  onRetry: () => void
}) {
  const unavailable = (state === 'failed' || payload?.availability === 'unavailable') && state !== 'loading'
  const ready = state === 'ready' && payload?.availability !== 'unavailable'
  const boundaries = payload?.boundaries ?? []

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6" data-testid="gutu-unified" data-presentation="rx04">
      <OwnerPageHeader
        title="Gutu AI"
        description="Gutu answers only from what CarUp records about you. It never estimates, predicts or advises on anything CarUp has not recorded."
        meta={ready
          ? `${known.length === 1 ? '1 fact' : `${known.length} facts`} Gutu can answer from · ${notHeld.length === 1 ? '1 question' : `${notHeld.length} questions`} it will not guess`
          : undefined}
        actions={(
          <Link to="/#ask-carup" className={OWNER_SECONDARY_ACTION}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Find a car with Gutu
          </Link>
        )}
      />

      {state === 'loading' && (
        <div data-testid="assistant-context-loading">
          <DataState state="loading" subject="Your CarUp records" />
        </div>
      )}

      {unavailable && (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section
            role="alert"
            className="rounded-card border border-status-warning bg-status-warning-soft p-5 sm:p-6"
            data-testid="assistant-context-unavailable"
          >
            <p className={EYEBROW}>Gutu is not available right now</p>
            <h2 className={`mt-1 ${H2}`}>Gutu cannot read your records</h2>
            <p className="mt-2 text-[14px] leading-6 text-carup-text" data-testid="assistant-context-message">
              {payload?.message
                || 'Your CarUp records could not be read, so nothing can be shown from them. This is not a report that you have none.'}
            </p>
            <p className="mt-2 text-[14px] leading-6 text-carup-text-2">
              Until it can read them, Gutu will not answer anything about you. You can still open your records directly.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className={`mt-4 inline-flex min-h-11 items-center rounded-full bg-carup-bg-raised px-5 text-sm font-semibold text-carup-text ring-1 ring-carup-line-strong hover:ring-carup-text-3 ${OWNER_FOCUS}`}
            >
              Try again
            </button>
          </section>
          <RecordDoors testId="gutu-record-doors" />
        </div>
      )}

      {ready && (
        <>
            {/* What Gutu can see — the owner's own records, and nothing else. */}
            <section className="rounded-card bg-carup-raw-ink p-5 text-white sm:p-6" data-testid="assistant-known" aria-labelledby="gutu-known-title">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">What Gutu can answer from</p>
              <h2 id="gutu-known-title" className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">What CarUp records about you</h2>
              {known.length === 0 ? (
                <p className="mt-4 text-[14px] leading-6 text-white/80">CarUp returned no facts Gutu can answer from.</p>
              ) : (
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
                  {known.map(f => {
                    const door = FACT_LINKS[f.key]
                    return (
                      <div key={f.key} className="flex min-w-0 flex-col" data-testid={`assistant-fact-${f.key}`}>
                        <dt className="order-2 mt-1.5 text-[13px] leading-5 text-white/80">{f.label}</dt>
                        <dd className="order-1 text-[clamp(1.6rem,3vw,2rem)] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                          <span data-testid={`assistant-fact-${f.key}-value`}>{f.value ?? 'Not recorded'}</span>
                        </dd>
                        {door && (
                          <dd className="order-3 mt-1">
                            <Link to={door.href} className={`inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-[13px] font-semibold text-white underline-offset-4 hover:underline ${OWNER_FOCUS}`}>
                              {door.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                          </dd>
                        )}
                      </div>
                    )
                  })}
                </dl>
              )}
              <p className="mt-4 border-t border-white/15 pt-3 text-[12px] leading-5 text-white/70">
                Every figure here comes from your own records. Gutu answers from these and nothing else.
              </p>
            </section>

        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            {/* As prominent as the facts: a question that cannot be answered must be visibly unanswerable. */}
            <section className="rounded-card bg-carup-bg-raised p-5 ring-1 ring-carup-line sm:p-6" data-testid="assistant-not-held" aria-labelledby="gutu-not-held-title">
              <p className={EYEBROW}>What Gutu will not guess</p>
              <h2 id="gutu-not-held-title" className={`mt-1 ${H2}`}>What CarUp does not hold</h2>
              <p className="mt-1 text-[14px] leading-6 text-carup-text-2">
                Gutu will not answer these. CarUp has no record to answer from, so any figure would be made up.
              </p>
              {notHeld.length === 0 ? (
                <p className="mt-3 text-[14px] text-carup-text-2">CarUp listed nothing it declines to answer.</p>
              ) : (
                <ul className="mt-4 divide-y divide-carup-line">
                  {notHeld.map(f => {
                    const door = NOT_HELD_LINKS[f.key]
                    return (
                      <li key={f.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" data-testid={`assistant-missing-${f.key}`}>
                        <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-status-neutral" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-carup-text">{f.label}</p>
                          <p className="mt-0.5 text-[13px] leading-5 text-carup-text-2">{f.reason}</p>
                          {door && (
                            <Link to={door.href} className={`mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-control text-[13px] font-semibold text-carup-action-hover underline-offset-4 hover:underline ${OWNER_FOCUS}`}>
                              {door.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="min-w-0 space-y-6">
            {boundaries.length > 0 && (
              <section className="rounded-card bg-carup-bg-surface p-5 sm:p-6" data-testid="assistant-boundaries" aria-labelledby="gutu-rules-title">
                <p className={EYEBROW}>How Gutu answers</p>
                <h2 id="gutu-rules-title" className={`mt-1 ${H2}`}>The rules Gutu works under</h2>
                <ul className="mt-3 space-y-3">
                  {boundaries.map(rule => (
                    <li key={rule} className="flex items-start gap-2.5 text-[14px] leading-6 text-carup-text">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <RecordDoors testId="gutu-record-doors" />
          </div>
        </div>
        </>
      )}
    </div>
  )
}
