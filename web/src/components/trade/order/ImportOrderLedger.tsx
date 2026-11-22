/**
 * RX-06 — the import-order ledger (/diaspora/imports): every order this account can see, as rows —
 * vehicle identity, route, where it stands (core positionOf), who the next move is usually with, and
 * the last recorded update. A failed read is never shown as an empty ledger; a refusal is its own state.
 * PURE: the page passes the same read the legacy list uses.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, Plus } from 'lucide-react'
import { PARTY_LABELS, TRADE_PHASES, positionOf } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { EmptyState } from '@/components/dealer/workspace/EmptyState'
import { WS_PRIMARY } from '@/components/dealer/workspace/workspaceStyles'
import {
  cargoLabel,
  formatDay,
  orderStatusTone,
  orderTitle,
  phaseLine,
  place,
  shortRef,
  statusLabel,
  statusOutcome,
  timeOf,
  titledByLinkedVehicle,
  yearsLabel,
  type Read,
  type TradeOrder,
} from './orderModel'
import { useOrderHref } from './orderLinks'
import { RouteGlyph } from './TradeKit'

function nextMoveLine(order: TradeOrder): string {
  const outcome = statusOutcome(order.status)
  if (outcome) return outcome.title
  const guide = positionOf(order.status).guide
  if (!guide || guide.usuallyWith === 'none') return 'Nothing pending'
  return guide.usuallyWith === 'you' ? 'Usually with you' : `Usually with ${PARTY_LABELS[guide.usuallyWith].replace(/^The /, 'the ')}`
}

export function ImportOrderLedger({ orders, insights }: { orders: Read<TradeOrder[]>; insights?: ReactNode }) {
  return (
    <div className="space-y-6" data-testid="trade-order-ledger">
      <header className="flex flex-col gap-4 border-b border-carup-line pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full" style={{ background: 'var(--carup-raw-orange-signal)' }} />CarUp Trade
          </p>
          <h1 className="mt-2 text-[1.625rem] font-bold leading-tight tracking-[-0.025em] text-carup-text sm:text-[2rem]">Import orders</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-carup-text-2">Each order keeps its quotes, documents, shipping, customs and payments together — with what is recorded, who recorded it and when.</p>
        </div>
        <Link to="/diaspora/imports/new" className={WS_PRIMARY} data-testid="diaspora-new-import-button"><Plus className="h-4 w-4" aria-hidden="true" />Start an import</Link>
      </header>

      {orders.state === 'loading' && <EmptyState kind="loading" title="Loading your import orders…" testId="diaspora-import-list-loading" />}
      {orders.state === 'failed' && (
        <EmptyState kind="error" title="Your import orders could not be loaded" onRetry={orders.onRetry} testId="diaspora-import-list-error">
          {orders.message && <span className="[overflow-wrap:anywhere]">{orders.message} </span>}
          This is a failed read, not an empty list — your orders are unchanged.
        </EmptyState>
      )}
      {orders.state === 'denied' && (
        <EmptyState kind="denied" title="Import orders are not available to this account" testId="diaspora-import-list-denied">
          CarUp refused to list import orders for the signed-in account. Import orders belong to the importer who requested them and the participants CarUp assigns.
        </EmptyState>
      )}
      {orders.state === 'unavailable' && (
        <EmptyState kind="denied" title="Import orders are not available on this server" testId="diaspora-import-list-unavailable">
          The server answered “not found” (404) for the import order list. The feature may be switched off here; this is not a report that you have no orders.
        </EmptyState>
      )}
      {orders.state === 'ready' && (orders.data.length === 0 ? <EmptyLedger /> : <Ledger orders={orders.data} />)}

      {insights && (
        <section aria-labelledby="trade-ledger-insights" className="space-y-3 pt-2" data-testid="trade-ledger-insights">
          <div>
            <h2 id="trade-ledger-insights" className="text-base font-semibold text-carup-text">Trade signals</h2>
            <p className="text-sm text-carup-text-2">Market-wide demand from CarUp Intelligence — not your orders, and never money that moved.</p>
          </div>
          {insights}
        </section>
      )}
    </div>
  )
}

function Ledger({ orders }: { orders: TradeOrder[] }) {
  const orderHref = useOrderHref()
  const sorted = [...orders].sort((a, b) => (timeOf(b.updated_at ?? b.created_at) ?? 0) - (timeOf(a.updated_at ?? a.created_at) ?? 0))
  const byPhase = new Map<string, number>()
  for (const o of orders) {
    const pos = positionOf(o.status)
    const key = pos.exception ? statusLabel(pos.status) : pos.known ? TRADE_PHASES[pos.phaseIndex].label : 'Status not recognised'
    byPhase.set(key, (byPhase.get(key) ?? 0) + 1)
  }
  return (
    <section aria-labelledby="trade-ledger-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trade-ledger-title" className="text-base font-semibold text-carup-text">{orders.length} order{orders.length === 1 ? '' : 's'}</h2>
        <p className="text-xs text-carup-text-2" data-testid="trade-ledger-pulse">{[...byPhase.entries()].map(([k, n]) => `${n} in ${k}`).join(' · ')}</p>
      </div>
      <div className="overflow-hidden rounded-card border border-carup-line bg-carup-bg-raised">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_1.25rem] gap-4 border-b border-carup-line bg-carup-bg-surface px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3 lg:grid">
          <span>Order</span><span>Route</span><span>Where it stands</span><span>Next move</span><span>Last update</span><span />
        </div>
        <ul className="divide-y divide-carup-line" data-testid="diaspora-import-list">
          {sorted.map(order => {
            const years = titledByLinkedVehicle(order) ? null : yearsLabel(order.requested_year_min, order.requested_year_max)
            const last = formatDay(order.updated_at ?? order.created_at)
            return (
              <li key={order.id}>
                <Link
                  to={orderHref(order.id)}
                  className="group grid gap-3 px-4 py-4 transition-colors hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_1.25rem] lg:items-center lg:gap-4"
                  data-testid="diaspora-import-row"
                >
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-carup-text [overflow-wrap:anywhere]">{orderTitle(order)}{years && <span className="font-normal text-carup-text-2"> · {years}</span>}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-carup-text-3">
                      <span>{cargoLabel(order.order_type)}</span>
                      <code className="rounded-control bg-carup-bg-surface px-1.5 py-0.5 font-mono text-carup-text-2 ring-1 ring-carup-line">{shortRef(order.id)}</code>
                    </span>
                  </span>
                  <RouteGlyph origin={place(order.origin_city, order.origin_country)} destination={place(order.destination_city, order.destination_country)} testId="trade-ledger-route" className="text-[13px]" />
                  <span className="min-w-0">
                    <StatusChip tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</StatusChip>
                    <span className="mt-1 block text-xs text-carup-text-2">{phaseLine(order.status)}</span>
                  </span>
                  <span className="min-w-0 text-sm text-carup-text">
                    <span className="mr-1 text-xs text-carup-text-3 lg:hidden">Next move:</span>{nextMoveLine(order)}
                  </span>
                  <span className="text-xs tabular-nums text-carup-text-2"><span className="lg:hidden">Last update </span>{last ?? 'not recorded'}</span>
                  <ChevronRight className="hidden h-5 w-5 text-carup-text-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none lg:block" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function EmptyLedger() {
  return (
    <section className="rounded-card border border-carup-line bg-carup-bg-raised p-5 sm:p-6" data-testid="diaspora-import-list-empty" aria-labelledby="trade-ledger-empty-title">
      <h2 id="trade-ledger-empty-title" className="text-lg font-semibold text-carup-text">No import orders yet</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-carup-text-2">An import order is where CarUp coordinates one vehicle or parts import for you. It starts when you send a request — the vehicle, where it is coming from, where it should arrive and your budget — and then moves through these phases as each step is recorded:</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TRADE_PHASES.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2 rounded-control bg-carup-bg-surface px-3 py-2 text-sm text-carup-text">
            <span className="font-mono text-xs tabular-nums text-carup-text-3">{i + 1}</span>{p.label}
          </li>
        ))}
      </ol>
      <Link to="/diaspora/imports/new" className={`${WS_PRIMARY} mt-5`}>Start your first import <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    </section>
  )
}
