/**
 * RX-06 — the Import Order, the anchor object of CarUp Trade (master plan §22.5, UX-REF-07).
 *
 *   ONE object header (vehicle identity, references, route glyph, recorded status, pulse line)
 *   → the ONE lifecycle presentation (core ImportOrderLifecycle)
 *   → "Next move" (the order's real next step, where it stands, who it is usually with)
 *   → section tabs as a scrollable segmented control + the Passport mode switch
 *   → the section itself.
 *
 * PURE: everything comes from props (see orderViewTypes.ts). No API call happens here; the pages wire
 * the same reads and writes the legacy pages use. Tabs are URLs (deep-linkable): Overview, Documents,
 * Shipping & CAP and Passport are routes; Quotes, Customs, Payments and Activity are ?tab= on the order.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpenCheck, CarFront, LayoutList, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImportOrderLifecycle, UsuallyWith } from '@/components/trade/core/ImportOrderLifecycleRail'
import { positionOf } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { EmptyState, WorkspaceNotice } from '@/components/dealer/workspace/EmptyState'
import { WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import {
  ORDER_TABS,
  cargoLabel,
  catalogueMatch,
  formatDay,
  isTradeOperator,
  lastRecordedAt,
  nextStepFor,
  orderIdentifiers,
  orderStatusTone,
  orderTitle,
  phaseLine,
  place,
  requiredDocumentTally,
  shortRef,
  statusLabel,
  titledByLinkedVehicle,
  vehiclePassportHref,
  yearsLabel,
  type OrderMode,
  type TradeOrder,
} from './orderModel'
import { useOrderHref, useOrderSurface } from './orderLinks'
import type { ImportOrderViewProps } from './orderViewTypes'
import type { DiasporaTradeDocument } from '@/types'
import { Provenance, RefCode, RouteGlyph } from './TradeKit'
import { OrderOverviewPanel } from './OrderOverviewPanel'
import { OrderQuotesPanel } from './OrderQuotesPanel'
import { OrderDocumentsPanel } from './OrderDocumentsPanel'
import { OrderShippingPanel } from './OrderShippingPanel'
import { OrderCustomsPanel } from './OrderCustomsPanel'
import { OrderPaymentsPanel } from './OrderPaymentsPanel'
import { OrderActivityPanel } from './OrderActivityPanel'
import { OrderPassportView } from './OrderPassportView'

const BACK = `${WS_TEXT_ACTION} -ml-1`

export function ImportOrderView(props: ImportOrderViewProps) {
  const { order, orderId } = props
  const surface = useOrderSurface()
  if (order.state !== 'ready') {
    return (
      <div className="space-y-4" data-testid="trade-order-view" data-state={order.state}>
        <Link to={surface.ledgerHref} className={BACK} data-testid="trade-order-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {surface.ledgerLabel}</Link>
        {order.state === 'loading' && (
          <EmptyState kind="loading" title="Loading this import order…" testId="trade-order-loading" />
        )}
        {order.state === 'failed' && (
          <EmptyState kind="error" title="This import order could not be loaded" onRetry={order.onRetry} testId="trade-order-failed">
            {order.message && <span className="[overflow-wrap:anywhere]">{order.message} </span>}
            Nothing about the order has changed. Try again; CarUp support sees the same record.
          </EmptyState>
        )}
        {order.state === 'denied' && (
          <EmptyState kind="denied" title="This import order is not available to this account" testId="trade-order-denied">
            Only the order’s buyer, its assigned participants and CarUp operations can open it. Reference <code className="font-mono text-xs">{shortRef(orderId)}</code>.
          </EmptyState>
        )}
        {order.state === 'unavailable' && (
          <EmptyState kind="denied" title="This import order was not found" testId="trade-order-unavailable">
            It may have been removed, or the link is wrong. Your other orders are in the ledger.
          </EmptyState>
        )}
      </div>
    )
  }
  return <ReadyOrder {...props} order={order} />
}

function ReadyOrder(props: ImportOrderViewProps & { order: { state: 'ready'; data: TradeOrder } }) {
  const orderHref = useOrderHref()
  const { mode, viewer, orders, onRefresh, refreshing } = props
  const order = props.order.data
  // The documents route reads the list on its own; every other view uses the order's embedded list.
  const documents: DiasporaTradeDocument[] = props.documents?.state === 'ready'
    ? props.documents.data
    : order.diaspora_trade_documents ?? []
  const nextMoveRef = useRef<HTMLElement | null>(null)
  const scrolledPast = useScrolledPast(nextMoveRef)
  const step = nextStepFor(order, documents)
  const stickyTarget = step.cta && step.cta.target !== mode ? step.cta : null

  return (
    <div className="relative min-w-0 space-y-5" data-testid="trade-order-view" data-state="ready" data-mode={mode}>
      <OrderHeader order={order} mode={mode} documents={documents} orders={orders} onRefresh={onRefresh} refreshing={refreshing} />
      {props.refreshError && (
        <WorkspaceNotice tone="warning" testId="trade-order-refresh-error">
          The latest refresh failed ({props.refreshError}). Showing the order as it was last read.
        </WorkspaceNotice>
      )}
      {mode === 'passport' ? (
        <OrderPassportView order={order} viewer={viewer} footprint={props.footprint} audit={props.audit} handoff={props.handoff} stageEvents={props.stageEvents} />
      ) : (
        <>
          <section aria-label="Where this order is" className="rounded-card border border-carup-line bg-carup-bg-raised p-4 sm:p-5">
            <ImportOrderLifecycle status={order.status} />
          </section>
          <NextMove order={order} documents={documents} mode={mode} operator={isTradeOperator(viewer.role)} sectionRef={nextMoveRef} />
          <OrderTabs order={order} documents={documents} mode={mode} />
          <div role="region" aria-label={`${ORDER_TABS.find(t => t.key === mode)?.label ?? 'Order'} section`} data-testid={`trade-order-panel-${mode}`}>
            <ModePanel {...props} order={order} documents={documents} documentsRead={props.documents} />
          </div>
          {stickyTarget && scrolledPast && (
            <div
              className="sticky z-20 rounded-card border border-carup-line-strong bg-carup-bg-raised p-2 pl-3 shadow-sheet md:hidden"
              style={{ bottom: 'calc(var(--carup-trade-sticky-offset, 0px) + 0.5rem)' }}
              data-testid="trade-next-move-sticky"
            >
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-carup-text">{step.title}</p>
                <Link to={orderHref(order.id, stickyTarget.target)} className={WS_PRIMARY} data-testid="trade-next-move-sticky-action">
                  {stickyTarget.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ModePanel(props: Omit<ImportOrderViewProps, 'order' | 'documents'> & {
  order: TradeOrder
  documents: DiasporaTradeDocument[]
  documentsRead?: ImportOrderViewProps['documents']
}) {
  const { mode, order, viewer, actions, documents } = props
  switch (mode) {
    case 'quotes':
      return <OrderQuotesPanel order={order} viewer={viewer} />
    case 'documents':
      return <OrderDocumentsPanel order={order} viewer={viewer} documents={props.documentsRead ?? { state: 'ready', data: documents }} actions={actions} />
    case 'shipping':
      return <OrderShippingPanel order={order} viewer={viewer} logistics={props.logistics} stageEvents={props.stageEvents} journey={props.journey} />
    case 'customs':
      return <OrderCustomsPanel order={order} viewer={viewer} documents={documents} footprint={props.footprint} />
    case 'payments':
      return <OrderPaymentsPanel order={order} viewer={viewer} actions={actions} />
    case 'activity':
      return <OrderActivityPanel order={order} viewer={viewer} audit={props.audit} documents={documents} />
    default:
      return <OrderOverviewPanel order={order} viewer={viewer} documents={documents} handoff={props.handoff} actions={actions} />
  }
}

/* ── Object header ─────────────────────────────────────────────────────────────────────────────── */

function OrderHeader({ order, mode, documents, orders, onRefresh, refreshing }: {
  order: TradeOrder
  mode: OrderMode
  documents: DiasporaTradeDocument[]
  orders?: ImportOrderViewProps['orders']
  onRefresh?: () => void
  refreshing?: boolean
}) {
  // A title from the linked vehicle already carries its year; the requested range is not shown beside it.
  const years = titledByLinkedVehicle(order) ? null : yearsLabel(order.requested_year_min, order.requested_year_max)
  const identifiers = orderIdentifiers(order)
  const match = catalogueMatch(order)
  const tally = requiredDocumentTally(documents)
  const quotes = order.diaspora_import_quotes?.length ?? 0
  const recorded = formatDay(order.created_at)
  const last = formatDay(lastRecordedAt(order))
  const surface = useOrderSurface()
  return (
    <header className="space-y-4" data-testid="trade-order-header">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={surface.ledgerHref} className={cn(BACK, 'mr-auto')} data-testid="trade-order-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {surface.ledgerLabel}</Link>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshing} className={cn(WS_SECONDARY, 'order-2 w-11 px-0 sm:order-3 sm:w-auto sm:px-4')} data-testid="trade-order-refresh" aria-busy={refreshing} aria-label={refreshing ? 'Refreshing this order' : 'Refresh this order'}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        )}
        <OrderSwitcher order={order} mode={mode} orders={orders} className="order-3 w-full sm:order-2 sm:w-auto" />
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full" style={{ background: 'var(--carup-raw-orange-signal)' }} />
            Import order
            <RefCode value={shortRef(order.id)} full={order.id} testId="trade-order-reference" />
          </p>
          <h1 className="mt-2 text-[1.625rem] font-bold leading-tight tracking-[-0.025em] text-carup-text [overflow-wrap:anywhere] sm:text-[2rem]" data-testid="trade-order-title">
            {orderTitle(order)}
            {years && <span className="ml-2 font-semibold text-carup-text-2">{years}</span>}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip tone={orderStatusTone(order.status)} testId="trade-order-status">{statusLabel(order.status)}</StatusChip>
            <span className="text-sm text-carup-text-2">{cargoLabel(order.order_type)}</span>
            {match === 'matched' && <Provenance kind="record">Matched to CarUp’s vehicle catalogue</Provenance>}
            {match === 'unmatched' && <Provenance kind="unverified">Not matched to CarUp’s catalogue — recorded as typed</Provenance>}
          </div>
          <RouteGlyph className="mt-3" origin={place(order.origin_city, order.origin_country)} destination={place(order.destination_city, order.destination_country)} />
          {/* CAP S1: only the vehicle's owner or current seller is sent `linked_vehicle`; the sample shows no tool links. */}
          {surface.toolLinks && order.linked_vehicle?.vin && (
            <p className="mt-3">
              <Link to={vehiclePassportHref(order.linked_vehicle.vin)} className={WS_TEXT_ACTION} data-testid="trade-order-vehicle-passport">
                <CarFront className="h-4 w-4" aria-hidden="true" /> Vehicle Passport
              </Link>
            </p>
          )}
          {identifiers.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-2" data-testid="trade-order-identifiers">
              {identifiers.map(id => (
                <div key={id.key} className="flex min-w-0 items-center gap-1.5">
                  <dt className="text-xs font-medium text-carup-text-3">{id.label}</dt>
                  <dd className="min-w-0"><RefCode value={id.value} /></dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <ModeSwitch orderId={order.id} mode={mode} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-carup-line py-2.5 text-xs text-carup-text-2" data-testid="trade-order-pulse">
        <span className="font-semibold text-carup-text">{phaseLine(order.status)}</span>
        <span aria-hidden="true" className="text-carup-line-strong">/</span>
        <span>Recorded {recorded ?? 'date not recorded'}</span>
        <span aria-hidden="true" className="text-carup-line-strong">/</span>
        <span>Last update {last ?? 'not recorded'}</span>
        <span aria-hidden="true" className="text-carup-line-strong">/</span>
        <span>{quotes === 0 ? 'No quotes' : `${quotes} quote${quotes === 1 ? '' : 's'}`}</span>
        <span aria-hidden="true" className="text-carup-line-strong">/</span>
        <span>{tally.uploaded} of {tally.total} required documents uploaded · {tally.verified} verified</span>
      </p>
    </header>
  )
}

/** Order ⇄ Passport: the passport is a read-only MODE of the same order, not another product. */
function ModeSwitch({ orderId, mode }: { orderId: string; mode: OrderMode }) {
  const orderHref = useOrderHref()
  const passport = mode === 'passport'
  const item = (active: boolean) => cn(
    'inline-flex min-h-11 items-center gap-1.5 rounded-control px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus',
    active ? 'bg-carup-bg-raised text-carup-text shadow-sm ring-1 ring-carup-line' : 'text-carup-text-2 hover:text-carup-text',
  )
  return (
    <nav aria-label="Order view" className="shrink-0" data-testid="trade-order-mode-switch">
      <ul className="inline-flex gap-1 rounded-control bg-carup-bg-surface p-1 ring-1 ring-carup-line">
        <li><Link to={orderHref(orderId, 'overview')} aria-current={!passport ? 'page' : undefined} className={item(!passport)}><LayoutList className="h-4 w-4" aria-hidden="true" />Order</Link></li>
        <li><Link to={orderHref(orderId, 'passport')} aria-current={passport ? 'page' : undefined} className={item(passport)} data-testid="trade-order-passport-link"><BookOpenCheck className="h-4 w-4" aria-hidden="true" />Passport</Link></li>
      </ul>
    </nav>
  )
}

/** Quick switch between the account's orders, keeping the current tab. */
function OrderSwitcher({ order, mode, orders, className }: { order: TradeOrder; mode: OrderMode; orders?: ImportOrderViewProps['orders']; className?: string }) {
  const orderHref = useOrderHref()
  const navigate = useNavigate()
  if (!orders || orders.state === 'loading') return null
  if (orders.state !== 'ready') {
    return orders.state === 'failed' && orders.onRetry ? (
      <button type="button" onClick={orders.onRetry} className={cn(WS_TEXT_ACTION, className)} data-testid="trade-order-switch-failed">
        Your other orders could not be listed · Try again
      </button>
    ) : null
  }
  const others = orders.data.filter(o => o.id !== order.id)
  if (others.length === 0) return null
  const options = orders.data.some(o => o.id === order.id) ? orders.data : [order, ...orders.data]
  return (
    <label className={cn('relative flex min-w-0 items-center gap-2 text-sm font-semibold text-carup-text', className)} data-testid="trade-order-switch">
      <span className="sr-only">Switch to another import order</span>
      <span aria-hidden="true" className="hidden text-xs font-medium text-carup-text-3 sm:inline">Order</span>
      <select
        value={order.id}
        onChange={event => navigate(orderHref(event.target.value, mode))}
        className="min-h-11 w-full min-w-0 truncate rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 text-sm text-carup-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus sm:w-[20rem]"
      >
        {options.map(o => (
          <option key={o.id} value={o.id}>{`${orderTitle(o)} · ${shortRef(o.id)} · ${statusLabel(o.status)}`}</option>
        ))}
      </select>
    </label>
  )
}

/* ── Next move ─────────────────────────────────────────────────────────────────────────────────── */

function NextMove({ order, documents, mode, operator, sectionRef }: {
  order: TradeOrder
  documents: DiasporaTradeDocument[]
  mode: OrderMode
  operator: boolean
  sectionRef: RefObject<HTMLElement | null>
}) {
  const orderHref = useOrderHref()
  const step = nextStepFor(order, documents)
  const pos = positionOf(order.status)
  const here = step.cta && step.cta.target === mode
  return (
    <section ref={sectionRef} aria-labelledby="trade-next-step-title" data-testid="trade-next-step" className="relative overflow-hidden rounded-card border border-carup-line-strong bg-carup-bg-raised">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: 'var(--carup-raw-orange-signal)' }} />
      <div className="grid gap-4 p-4 pl-5 sm:p-5 sm:pl-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Next move</p>
          <h2 id="trade-next-step-title" className="mt-1 text-lg font-bold tracking-[-0.02em] text-carup-text sm:text-xl">{step.title}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-carup-text-2">{step.detail}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {step.cta && !here && (
              <Link to={orderHref(order.id, step.cta.target)} className={WS_PRIMARY} data-testid="trade-next-step-action">
                {step.cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            {here && <p className="text-sm font-semibold text-carup-text" data-testid="trade-next-step-here">This section is where it happens — see below.</p>}
            {!step.cta && !pos.exception && pos.known && <p className="text-sm font-semibold text-carup-text" data-testid="trade-next-step-nothing">Nothing is needed from you right now.</p>}
          </div>
          {operator && (
            <p className="mt-3 text-xs leading-5 text-carup-text-2" data-testid="trade-next-step-operator">
              As CarUp operations you can also act here:{' '}
              <Link className="font-semibold text-carup-action underline-offset-4 hover:underline" to={orderHref(order.id, 'overview')}>operations controls (Overview)</Link>,{' '}
              <Link className="font-semibold text-carup-action underline-offset-4 hover:underline" to={orderHref(order.id, 'documents')}>document review</Link> and{' '}
              <Link className="font-semibold text-carup-action underline-offset-4 hover:underline" to={orderHref(order.id, 'shipping')}>logistics</Link>.
            </p>
          )}
        </div>
        <div className="min-w-0 rounded-control bg-carup-bg-surface p-3 md:self-start" data-testid="trade-next-step-standing">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Where it stands</p>
          <p className="mt-1 text-sm font-semibold text-carup-text">{pos.guide?.label ?? statusLabel(order.status)}</p>
          {pos.guide && <p className="mt-0.5 text-sm leading-6 text-carup-text-2">{pos.guide.meaning}</p>}
          <UsuallyWith status={order.status} className="mt-2 block" />
        </div>
      </div>
    </section>
  )
}

/* ── Section tabs: a horizontally scrollable segmented control ────────────────────────────────── */

function OrderTabs({ order, documents, mode }: { order: TradeOrder; documents: DiasporaTradeDocument[]; mode: OrderMode }) {
  const orderHref = useOrderHref()
  const counts = useMemo<Partial<Record<string, number>>>(() => ({
    quotes: order.diaspora_import_quotes?.length ?? 0,
    documents: documents.length,
    payments: order.diaspora_payment_milestones?.length ?? 0,
  }), [order, documents])
  // Keep the current section in view inside the scrollable control (phones), without moving the page.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!scroller || !active || scroller.scrollWidth <= scroller.clientWidth) return
    scroller.scrollLeft = Math.max(0, active.offsetLeft - (scroller.clientWidth - active.offsetWidth) / 2)
  }, [mode])
  return (
    <nav aria-label="Order sections" className="sticky top-14 z-20 bg-carup-bg py-2" data-testid="trade-order-tabs">
      <div ref={scrollerRef} className="relative overflow-x-auto pb-1">
        <ul className="flex w-max min-w-full gap-1 rounded-control bg-carup-bg-surface p-1 ring-1 ring-carup-line">
          {ORDER_TABS.map(tab => {
            const active = mode === tab.key
            const count = counts[tab.key]
            return (
              <li key={tab.key} className="shrink-0">
                <Link
                  to={orderHref(order.id, tab.key)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`trade-order-tab-${tab.key}`}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-control px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus',
                    active ? 'bg-carup-bg-raised text-carup-text shadow-sm ring-1 ring-carup-line' : 'text-carup-text-2 hover:text-carup-text',
                  )}
                >
                  {tab.label}
                  {typeof count === 'number' && count > 0 && (
                    <span className="rounded-full bg-carup-bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums text-carup-text-2">
                      <span className="sr-only">(</span>{count}<span className="sr-only"> recorded)</span>
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

/**
 * True once the element has scrolled ABOVE the viewport (the person has read past it), so the phone
 * bar repeats the next move only when the region itself is out of reach. False where
 * IntersectionObserver is unavailable (the region is then the only place the action lives).
 */
function useScrolledPast(ref: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { threshold: 0 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return past
}
