/**
 * LR02 — the public SAMPLE import journey (/diaspora/sample). No account, no API call, nothing to change.
 *
 *  - Ten fictional orders (content/trade/sampleImportJourney.ts): one in each of the seven phases, plus
 *    the three exceptions, each labelled SAMPLE on screen and in every identifier.
 *  - Each is rendered by the REAL Import Order view (components/trade/order/ImportOrderView), with NO
 *    actions, so no write control can appear, from the importer's side (a sample buyer).
 *  - Every link the order makes stays inside the sample (OrderLinkContext: ?order=<key>&mode=<mode>); the
 *    order's back link goes to the Trade entry and its tool links are hidden (OrderSurfaceContext), so
 *    nothing here leads to a real order or a protected tool.
 *  - Shown only with the Trade presentation on (showroom pages or the unified UI). App.tsx declares the
 *    route only then, so with it off this path falls through to the catch-all exactly as before it existed;
 *    the page also refuses on its own (not found) if it is ever routed with the presentation off.
 *  - The one way out besides the Trade entry is "Prepare a request" (/diaspora/imports/new), outside the
 *    sample order's frame: the public request preparation, not an action on any order.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Eye, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isShowroomPagesEnabled } from '@/lib/presentationFlags'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { NotFoundPage } from '@/components/routing/FeatureStatePages'
import { ImportOrderView } from '@/components/trade/order/ImportOrderView'
import { OrderLinkContext, OrderSurfaceContext, type OrderLinkBuilder, type OrderSurface } from '@/components/trade/order/orderLinks'
import { readReady, type OrderMode } from '@/components/trade/order/orderModel'
import { positionOf, statusLabel } from '@/components/trade/core/importOrderLifecycle'
import { SAMPLE_ORDERS, SAMPLE_VIEWER, sampleKeyOf, sampleModeFrom, sampleOrderByKey, type SampleOrder } from '@/content/trade/sampleImportJourney'
import { sampleJourneyHref } from '@/content/trade/sampleJourneyLinks'

/** The sample's back link goes to the Trade entry, and its panels show no links to other tools. */
const SAMPLE_SURFACE: OrderSurface = { ledgerHref: '/diaspora', ledgerLabel: 'CarUp Trade', toolLinks: false }

/**
 * Order links (tabs, next move, Passport) stay in the sample, addressed by the sample's key: one stable
 * builder per sample order (an id that is not a sample's stays on the current sample).
 */
const SAMPLE_LINKS: Record<string, OrderLinkBuilder> = Object.fromEntries(
  SAMPLE_ORDERS.map(s => [s.key, (orderId: string, target: OrderMode = 'overview') => sampleJourneyHref(sampleKeyOf(orderId) ?? s.key, target)]),
)

/** Phones: lift the order's sticky next move above the site's bottom navigation bar. */
const STICKY_OFFSET = { '--carup-trade-sticky-offset': 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' } as CSSProperties

const PAGE = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-carup-text-3'

export default function DiasporaSampleImport() {
  if (!isShowroomPagesEnabled() && !isUnifiedUiEnabled()) return <NotFoundPage />
  return <SampleJourney />
}

function SampleJourney() {
  const [params] = useSearchParams()
  const sample = sampleOrderByKey(params.get('order'))
  const mode = sampleModeFrom(params.get('mode'))
  const order = sample.order
  const linkBuilder = SAMPLE_LINKS[sample.key]

  return (
    <div className="bg-carup-bg pb-12 text-carup-text sm:pb-16" style={STICKY_OFFSET} data-testid="trade-sample" data-sample-order={sample.key} data-sample-mode={mode}>
      <div className="border-b border-status-warning bg-status-warning-soft" role="note" aria-label="Sample" data-testid="trade-sample-banner">
        <div className={cn(PAGE, 'flex items-start gap-2.5 py-2.5')}>
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
          <p className="text-sm leading-6 text-carup-text">
            <strong className="font-semibold text-status-warning">SAMPLE — an illustrative import, not a real order. Nothing here can be changed.</strong>{' '}
            <span>This is how an import order looks to its buyer.</span>
          </p>
        </div>
      </div>

      <div className={cn(PAGE, 'pt-6 sm:pt-8')}>
        <header className="max-w-3xl">
          <p className={EYEBROW}>CarUp Trade · Sample journey</p>
          <h1 className="mt-2 text-[clamp(1.625rem,3.2vw,2.25rem)] font-bold leading-tight tracking-[-0.03em] text-carup-text">Walk through a sample import</h1>
          <p className="mt-2 text-sm leading-6 text-carup-text-2">
            One fictional importer, ten sample orders: one at each of the seven phases, and three that went off course. Pick a moment, then open the
            order’s sections and its Passport. Dates, amounts and references are illustrative, and every reference says SAMPLE.
          </p>
        </header>

        <PhaseChooser current={sample} mode={mode} />

        <p className="mt-4 max-w-3xl text-sm leading-6 text-carup-text-2" data-testid="trade-sample-shows">
          <span className="font-semibold text-carup-text">{sample.label} · {statusLabel(order.status)}. </span>{sample.shows}
        </p>

        <section
          aria-label="Sample import order"
          className="mt-5 rounded-card border-2 border-dashed border-status-warning p-2 sm:p-4"
          data-testid="trade-sample-order"
        >
          <p className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-status-warning">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Sample order · read only
          </p>
          <OrderLinkContext.Provider value={linkBuilder}>
            <OrderSurfaceContext.Provider value={SAMPLE_SURFACE}>
              <ImportOrderView
                orderId={order.id}
                mode={mode}
                order={readReady(order)}
                viewer={SAMPLE_VIEWER}
                audit={readReady(sample.audit)}
                footprint={readReady(sample.footprint)}
                handoff={readReady(sample.handoff)}
                stageEvents={readReady(sample.stageEvents)}
              />
            </OrderSurfaceContext.Provider>
          </OrderLinkContext.Provider>
        </section>

        <section aria-labelledby="trade-sample-next-title" className="mt-8 rounded-card bg-carup-raw-ink p-5 text-white sm:p-8" data-testid="trade-sample-next">
          <h2 id="trade-sample-next-title" className="text-lg font-bold tracking-[-0.02em] sm:text-xl">Ready to start your own?</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
            You can prepare a request without an account. Sending it needs one, and nothing is booked or charged by sending it.
            Your real order then shows only what is recorded — no estimates.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/diaspora/imports/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-carup-raw-orange-signal px-5 py-2 text-center text-sm font-semibold text-carup-raw-ink transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-carup-raw-ink" data-testid="trade-sample-start">
              Prepare a request — no account needed to start <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/diaspora" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-raw-orange-signal" data-testid="trade-sample-home">
              Back to CarUp Trade
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

/** The seven phases, then the three exceptions. The current section (mode) is kept when switching. */
function PhaseChooser({ current, mode }: { current: SampleOrder; mode: OrderMode }) {
  const phases = SAMPLE_ORDERS.filter(s => !positionOf(s.order.status).exception)
  const exceptions = SAMPLE_ORDERS.filter(s => positionOf(s.order.status).exception)
  return (
    <nav aria-label="Sample orders" className="mt-6 space-y-3" data-testid="trade-sample-chooser">
      <ChipRow title="The seven phases" items={phases} current={current} mode={mode} numbered />
      <ChipRow title="When an import goes off course" items={exceptions} current={current} mode={mode} />
    </nav>
  )
}

function ChipRow({ title, items, current, mode, numbered = false }: { title: string; items: SampleOrder[]; current: SampleOrder; mode: OrderMode; numbered?: boolean }) {
  // Phones: keep the chosen chip in view inside its swipeable row, without moving the page (as the order tabs do).
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!scroller || !active || scroller.scrollWidth <= scroller.clientWidth) return
    scroller.scrollLeft = Math.max(0, active.offsetLeft - (scroller.clientWidth - active.offsetWidth) / 2)
  }, [current.key])
  return (
    <div>
      <p className="text-xs font-semibold text-carup-text-2">{title}</p>
      {/* Phones: one swipeable row; wider screens: the chips wrap. */}
      <div ref={scrollerRef} className="relative -mx-4 mt-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
        <ol className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {items.map((s, i) => {
            const active = s.key === current.key
            return (
              <li key={s.key} className="shrink-0">
                <Link
                  to={sampleJourneyHref(s.key, mode)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`trade-sample-phase-${s.key}`}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2',
                    active ? 'bg-carup-text text-carup-bg' : 'bg-carup-bg-raised text-carup-text-2 ring-1 ring-carup-line hover:text-carup-text',
                  )}
                >
                  {numbered && <span className="font-mono text-xs opacity-80" aria-hidden="true">{i + 1}</span>}
                  {s.label}
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
