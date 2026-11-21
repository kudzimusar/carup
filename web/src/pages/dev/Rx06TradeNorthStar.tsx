/**
 * RX-06 — the Trade fixture tour (DEV ONLY; never in a production build — App.tsx creates the route
 * only when import.meta.env.DEV and scripts/assert-no-dev-pages.mjs proves no chunk, test id or route
 * ships). It replaces the RX05-F static north-star prototype with the REAL code:
 *
 *  - the Import Order is rendered by the same pure views the real pages use
 *    (components/trade/order/ImportOrderView), fed by labelled fixtures (./rx06TradeFixtures) with NO
 *    actions, so no write control can appear and nothing can be changed;
 *  - one fictional importer holds ten orders: one in each of the seven lifecycle phases, plus the
 *    three exception states, so every phase, tab and the Passport can be seen without a backend;
 *  - the read-state switch shows how the same view answers loading / failed / refused / not found;
 *  - the "Walk the real journey" links open the real Trade pages on this dev server (local API).
 *
 * Links inside the order (tabs, next move, order switch) stay in the tour through OrderLinkContext.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImportOrderView } from '@/components/trade/order/ImportOrderView'
import { OrderLinkContext, type OrderLinkBuilder } from '@/components/trade/order/orderLinks'
import { ORDER_TABS, readReady, type OrderMode, type Read, type TradeOrder } from '@/components/trade/order/orderModel'
import { positionOf, statusLabel } from '@/components/trade/core/importOrderLifecycle'
import { FIXTURE_CONTAINERS, FIXTURE_ORDERS, FX_BUYER, FX_OPERATOR, fixtureByKey } from './rx06TradeFixtures'

const MODES = new Set<string>([...ORDER_TABS.map(t => t.key), 'passport'])
const READS = ['ready', 'loading', 'failed', 'denied', 'unavailable'] as const
type ReadKind = typeof READS[number]
const READ_LABELS: Record<ReadKind, string> = { ready: 'Ready', loading: 'Loading', failed: 'Failed', denied: 'Refused (403)', unavailable: 'Not found (404)' }

/** The real Trade pages on this dev server, in journey order (they read the local API). */
const JOURNEY: Array<{ href: string; label: string; note: string }> = [
  { href: '/diaspora', label: 'Trade home', note: 'entry' },
  { href: '/diaspora/imports', label: 'Import orders', note: 'ledger' },
  { href: '/diaspora/imports/new', label: 'New import request', note: 'focused flow' },
  { href: '/diaspora/rfq', label: 'Sourcing requests', note: 'reverse RFQ' },
  { href: '/diaspora/containers', label: 'Shared containers', note: 'co-loading' },
  { href: '/diaspora/safetrade', label: 'SafeTrade', note: 'not yet released' },
  { href: '/diaspora/trade-profile', label: 'Trade profile', note: 'identity' },
  { href: '/diaspora/subscription', label: 'Plan & entitlements', note: 'not yet released' },
  { href: '/diaspora/drive', label: 'Drive connections', note: 'switched off locally' },
  { href: '/diaspora/stock', label: 'Stock', note: 'dealer' },
  { href: '/diaspora/ai-commands', label: 'AI command centre', note: 'dealer' },
  { href: '/diaspora/workbook/import', label: 'Workbook import', note: 'not yet released' },
  { href: '/diaspora/trade-graph', label: 'Trade graph', note: 'not yet released' },
  { href: '/diaspora/safetrade/operations', label: 'SafeTrade operations', note: 'reviewers' },
]

function Chip({ to, active, children, testId }: { to: string; active: boolean; children: ReactNode; testId?: string }) {
  return (
    <Link
      to={to}
      replace
      preventScrollReset
      aria-current={active ? 'true' : undefined}
      data-testid={testId}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus',
        active ? 'bg-carup-text text-carup-bg' : 'bg-carup-bg-raised text-carup-text-2 ring-1 ring-carup-line hover:text-carup-text',
      )}
    >
      {children}
    </Link>
  )
}

export default function Rx06TradeNorthStar() {
  const [params] = useSearchParams()
  const fixture = fixtureByKey(params.get('order'))
  const modeParam = params.get('mode') ?? 'overview'
  const mode = (MODES.has(modeParam) ? modeParam : 'overview') as OrderMode
  const asOperator = params.get('as') === 'operator'
  const readParam = params.get('read') as ReadKind | null
  const readKind: ReadKind = readParam && (READS as readonly string[]).includes(readParam) ? readParam : 'ready'

  /** Every tour URL keeps the other choices; the order is addressed by its fixture key. */
  const tourUrl = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    return `/dev/rx06-trade?${next.toString()}`
  }, [params])

  const linkBuilder = useCallback<OrderLinkBuilder>((orderId, m = 'overview') => {
    const target = FIXTURE_ORDERS.find(f => f.order.id === orderId)
    return tourUrl({ order: target?.key ?? orderId, mode: m })
  }, [tourUrl])

  const orderRead: Read<TradeOrder> = useMemo(() => {
    switch (readKind) {
      case 'loading': return { state: 'loading' }
      case 'failed': return { state: 'failed', message: 'FIXTURE: the server did not answer (simulated failure).' }
      case 'denied': return { state: 'denied', message: 'FIXTURE: you do not have access to this import order (simulated 403).' }
      case 'unavailable': return { state: 'unavailable', message: 'FIXTURE: import order not found (simulated 404).' }
      default: return readReady(fixture.order)
    }
  }, [readKind, fixture])

  const order = fixture.order
  return (
    <div className="min-h-screen bg-carup-bg text-carup-text" data-testid="rx06-trade-tour">
      <div className="sticky top-0 z-40 border-b border-status-warning bg-status-warning-soft px-4 py-2 sm:px-8" data-testid="rx06-tour-fixture-banner">
        <p className="mx-auto flex max-w-7xl items-start gap-2 text-sm font-semibold text-status-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>FIXTURE TOUR · DEV only. Every order on this page is invented to show the real Import Order views at each phase. None of it is an order, shipment, document or payment, and nothing here can be changed.</span>
        </p>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <header className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">RX-06 · CarUp Trade</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">The Import Order, phase by phase</h1>
          <p className="mt-2 text-sm leading-6 text-carup-text-2">
            One anchor object from request to handover: seven phases over the twenty recorded states, the next move and who it is usually with,
            and the three exceptions that never sit on the progress rail. Pick a phase, then use the order&apos;s own tabs and Passport.
          </p>
        </header>

        <section aria-labelledby="rx06-tour-journey" className="mt-6 rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid="rx06-tour-journey">
          <h2 id="rx06-tour-journey" className="text-sm font-bold">Walk the real journey <span className="font-normal text-carup-text-2">— real pages on this dev server, reading the local API (fictional accounts)</span></h2>
          <ol className="mt-3 flex flex-wrap gap-2">
            {JOURNEY.map((step, i) => (
              <li key={step.href}>
                <Link to={step.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-carup-bg-surface px-3 text-sm text-carup-text ring-1 ring-carup-line hover:ring-carup-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus">
                  <span className="font-mono text-xs text-carup-text-3">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-semibold">{step.label}</span>
                  <span className="text-xs text-carup-text-3">{step.note}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-carup-text-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="rx06-tour-picker" className="mt-6" data-testid="rx06-tour-picker">
          <h2 id="rx06-tour-picker" className="text-sm font-bold">Choose a phase</h2>
          <nav aria-label="Fixture orders by phase" className="mt-2">
            <ol className="flex flex-wrap gap-2">
              {FIXTURE_ORDERS.map(f => {
                const pos = positionOf(f.order.status)
                const tag = pos.exception ? 'Exception' : `${pos.phaseIndex + 1}`
                return (
                  <li key={f.key}>
                    <Chip to={tourUrl({ order: f.key, read: null })} active={f.key === fixture.key && readKind === 'ready'} testId={`rx06-tour-phase-${f.key}`}>
                      <span className={cn('font-mono text-xs', pos.exception ? 'text-status-warning' : 'opacity-70')}>{tag}</span>
                      {f.label}
                    </Chip>
                  </li>
                )
              })}
            </ol>
          </nav>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-carup-text-2" data-testid="rx06-tour-shows">
            <span className="font-semibold text-carup-text">{statusLabel(order.status)} · </span>{fixture.shows}
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-carup-text-3">Viewing as</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Chip to={tourUrl({ as: null })} active={!asOperator} testId="rx06-tour-as-importer">Importer</Chip>
                <Chip to={tourUrl({ as: 'operator' })} active={asOperator} testId="rx06-tour-as-operator">CarUp operations</Chip>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-carup-text-3">The role only changes what is shown; the server decides who may act. The tour passes no actions, so no control appears.</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-carup-text-3">The order read</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {READS.map(r => (
                  <Chip key={r} to={tourUrl({ read: r === 'ready' ? null : r })} active={readKind === r} testId={`rx06-tour-read-${r}`}>{READ_LABELS[r]}</Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-carup-text-3">Refused, not found and failed are three different answers — never shown as an empty order.</p>
            </div>
          </div>
        </section>

        <div className="mt-6 rounded-card border-2 border-dashed border-status-warning p-2 sm:p-4" data-testid="rx06-tour-order">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-status-warning">Fixture order · rendered by the real Import Order view</p>
          <OrderLinkContext.Provider value={linkBuilder}>
            <ImportOrderView
              orderId={order.id}
              mode={mode}
              order={orderRead}
              viewer={{ id: asOperator ? FX_OPERATOR : FX_BUYER, role: asOperator ? 'admin' : 'owner' }}
              orders={readReady(FIXTURE_ORDERS.map(f => f.order))}
              documents={readReady(order.diaspora_trade_documents ?? [])}
              audit={readReady(fixture.audit)}
              footprint={readReady(fixture.footprint)}
              handoff={readReady(fixture.handoff)}
              stageEvents={readReady(fixture.stageEvents)}
              logistics={{
                reservations: readReady(order.diaspora_cargo_reservations ?? []),
                shipments: readReady(order.diaspora_shipments ?? []),
                containers: readReady(FIXTURE_CONTAINERS),
              }}
            />
          </OrderLinkContext.Provider>
        </div>
      </div>
    </div>
  )
}
