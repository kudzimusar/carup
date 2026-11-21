/**
 * RX-06 — Import Order › Quotes. Every quote exactly as recorded: amount and currency, status, when it
 * was recorded, validity and the inclusions/exclusions only when the record carries them. There is no
 * accept/decline action for import-order quotes in CarUp today, so none is offered — the page says so.
 */
import { Inbox } from 'lucide-react'
import { positionOf } from '@/components/trade/core/importOrderLifecycle'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { actorLabel, formatDay, money, recordStatusTone, sentence, timeOf, type TradeOrder, type TradeQuote } from './orderModel'
import type { TradeViewer } from './orderViewTypes'
import { NotRecorded, Panel, Provenance, RefCode } from './TradeKit'

function terms(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

export function OrderQuotesPanel({ order, viewer }: { order: TradeOrder; viewer: TradeViewer }) {
  const quotes = [...(order.diaspora_import_quotes ?? [])].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))
  const budget = money(order.budget_amount, order.budget_currency)
  const own = Boolean(viewer.id && order.buyer_id && viewer.id === order.buyer_id)
  const pos = positionOf(order.status)
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]" data-testid="trade-quotes">
      <Panel title="Quotes" eyebrow={`${quotes.length} recorded`} testId="trade-quotes-ledger">
        {quotes.length === 0 ? (
          <div className="flex items-start gap-3" data-testid="trade-quotes-empty">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-carup-bg-surface text-carup-text-2" aria-hidden="true"><Inbox className="h-4 w-4" /></span>
            <div className="min-w-0 text-sm leading-6">
              <p className="font-semibold text-carup-text">No quotes recorded yet</p>
              <p className="text-carup-text-2">
                When a seller or CarUp operations records a quote for this order, it appears here with its amount, currency and status exactly as recorded.
                {pos.status === 'IMPORT_REQUESTED' ? ' Your request is recorded, so sellers can now quote.' : ''}
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {quotes.map(q => <QuoteRow key={q.id} quote={q} viewerId={viewer.id} />)}
          </ul>
        )}
      </Panel>
      <aside className="min-w-0 space-y-5" aria-label="About quotes">
        <Panel title="Your reference" testId="trade-quotes-budget">
          <p className="text-sm text-carup-text-2">Budget on the request</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-carup-text">{budget ?? <NotRecorded>Not stated</NotRecorded>}</p>
          {budget && <p className="mt-1.5"><Provenance kind="stated">{own ? 'Stated by you' : 'Stated by the buyer'} · not a price</Provenance></p>}
        </Panel>
        <Panel title="How quotes work here" testId="trade-quotes-actions-note">
          <ul className="space-y-2 text-sm leading-6 text-carup-text-2">
            <li>Accepting or declining an import-order quote is not available in CarUp yet, so this page offers no such button. The status shown is the one recorded.</li>
            <li>An accepted quote’s amount becomes the cap for payment milestones recorded on this order.</li>
            <li>Freight, insurance and duty appear only when a quote records them; CarUp never estimates them.</li>
          </ul>
        </Panel>
      </aside>
    </div>
  )
}

function QuoteRow({ quote, viewerId }: { quote: TradeQuote; viewerId?: string | null }) {
  const accepted = String(quote.status || '').toUpperCase() === 'ACCEPTED'
  const amount = money(quote.quote_amount, quote.quote_currency)
  const included = terms(quote.inclusions)
  const excluded = terms(quote.exclusions)
  return (
    <li
      className={`rounded-card border p-4 ${accepted ? 'border-status-success bg-status-success-soft' : 'border-carup-line'}`}
      data-testid="trade-quote-row"
      data-status={quote.status ?? ''}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums tracking-[-0.02em] text-carup-text">{amount ?? <NotRecorded>Amount not recorded</NotRecorded>}</p>
          <p className="mt-0.5 text-xs text-carup-text-3">As recorded{quote.quote_currency ? ` in ${quote.quote_currency.toUpperCase()}` : ''} · no conversion applied</p>
        </div>
        <StatusChip tone={recordStatusTone(quote.status)} testId="trade-quote-status">{quote.status ? sentence(quote.status) : 'Status not recorded'}</StatusChip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-carup-text-3">Recorded</dt><dd className="font-semibold text-carup-text">{formatDay(quote.created_at) ?? <NotRecorded />}</dd></div>
        <div><dt className="text-xs text-carup-text-3">Valid until</dt><dd className="font-semibold text-carup-text">{formatDay(quote.valid_until) ?? <NotRecorded>Not stated</NotRecorded>}</dd></div>
        <div><dt className="text-xs text-carup-text-3">Seller</dt><dd className="font-semibold text-carup-text">{quote.seller_id ? actorLabel(quote.seller_id, viewerId) : <NotRecorded />}</dd></div>
        <div><dt className="text-xs text-carup-text-3">Quote</dt><dd><RefCode value={quote.id.slice(0, 8)} full={quote.id} /></dd></div>
      </dl>
      {(included.length > 0 || excluded.length > 0) && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {included.length > 0 && <p><span className="text-xs font-semibold text-carup-text-3">Includes · </span><span className="text-carup-text">{included.join(', ')}</span></p>}
          {excluded.length > 0 && <p><span className="text-xs font-semibold text-carup-text-3">Excludes · </span><span className="text-carup-text">{excluded.join(', ')}</span></p>}
        </div>
      )}
      {accepted && <p className="mt-3 text-xs font-semibold text-status-success">Accepted — this amount caps the payment milestones recorded on the order.</p>}
    </li>
  )
}
