import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, Loader2, Send } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaBuyerOrder, DiasporaQuote, DiasporaRequestLine } from '@/types'

/**
 * One sourcing request, from the buyer's side (Trade OS T2 §9.9/§9.10).
 *
 * Two jobs: show what was asked for and where the request stands, and — once offers arrive — make
 * the supplier decision comparable. Comparison is deliberately NOT "cheapest wins": a missing term
 * reads "Not provided" rather than becoming a favourable assumption, and the only highlights CarUp
 * draws are ones the recorded data actually supports.
 */

/** Database words → words a person uses. The database keeps its own vocabulary. */
const LIFECYCLE_LABEL: Record<string, { label: string; blurb: string; tone: string }> = {
  DRAFT: { label: 'Draft', blurb: 'Only you can see this. Publish it when you are ready for offers.', tone: 'border-gray-300 bg-gray-100 text-gray-700' },
  OPEN_FOR_QUOTES: { label: 'Open for offers', blurb: 'Suppliers can see this request and send you offers.', tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  QUOTES_RECEIVED: { label: 'Offers received', blurb: 'Compare the offers below and choose a supplier.', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  AWARDED: { label: 'Supplier selected', blurb: 'You accepted an offer. The trade continues as an order.', tone: 'border-emerald-400 bg-emerald-50 text-emerald-900' },
  CLOSED: { label: 'Closed', blurb: 'This request is no longer open.', tone: 'border-gray-300 bg-gray-100 text-gray-600' },
}

const QUOTE_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ISSUED: 'Offer received', ACCEPTED: 'Accepted', REJECTED: 'Not selected', EXPIRED: 'Expired',
}

const NOT_PROVIDED = 'Not provided'

function money(amount: unknown, currency?: string | null) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return NOT_PROVIDED
  return `${n.toLocaleString()} ${currency || ''}`.trim()
}

function shippingLabel(q: DiasporaQuote) {
  if (q.shipping_included === true) return 'Included'
  if (q.shipping_included === false) return 'Not included'
  return NOT_PROVIDED
}

function leadTimeLabel(q: DiasporaQuote) {
  const days = Number(q.lead_time_days)
  return Number.isFinite(days) && days > 0 ? `${days} day${days === 1 ? '' : 's'}` : NOT_PROVIDED
}

export default function TradeRequestDetail() {
  const { id = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { fetchDiasporaBuyerOrder, publishDiasporaRfq, acceptDiasporaQuote } = useCarUpApi()

  const [order, setOrder] = useState<DiasporaBuyerOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrder(await fetchDiasporaBuyerOrder(id))
      setUnreadable(false)
    } catch (err) {
      setOrder(null)
      setUnreadable(true)
      setError(err instanceof Error ? err.message : 'Request could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [fetchDiasporaBuyerOrder, id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && id) void load() }, [authLoading, id, load])

  const lifecycle = String(order?.rfq_lifecycle || 'DRAFT')
  const meta = LIFECYCLE_LABEL[lifecycle] || LIFECYCLE_LABEL.DRAFT
  const lines = (order?.request_lines as DiasporaRequestLine[] | undefined) || []
  const acceptedQuoteId = order?.metadata?.rfq?.acceptedQuoteId as string | undefined

  // Only real offers are comparable: drafts belong to the supplier and are not visible decisions.
  const offers = useMemo(
    () => (order?.quotes || []).filter((q) => q.status !== 'DRAFT'),
    [order],
  )

  /**
   * Deterministic highlights. Each is a fact read off the recorded offers — never a score, never a
   * recommendation, and never computed across currencies (which would need an FX authority).
   */
  const highlights = useMemo(() => {
    const out = new Map<string, string[]>()
    const add = (qid: string, text: string) => out.set(qid, [...(out.get(qid) || []), text])
    const currencies = new Set(offers.map((q) => q.quote_currency || 'USD'))
    if (offers.length > 1 && currencies.size === 1) {
      const cheapest = offers.reduce((a, b) => (Number(a.quote_amount) <= Number(b.quote_amount) ? a : b))
      add(cheapest.id, 'Lowest recorded total')
    }
    const withLead = offers.filter((q) => Number(q.lead_time_days) > 0)
    if (withLead.length > 1) {
      const fastest = withLead.reduce((a, b) => (Number(a.lead_time_days) <= Number(b.lead_time_days) ? a : b))
      add(fastest.id, 'Fastest stated dispatch')
    }
    for (const q of offers) if (q.shipping_included === true) add(q.id, 'Shipping included')
    return out
  }, [offers])

  const mixedCurrency = new Set(offers.map((q) => q.quote_currency || 'USD')).size > 1

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try { await fn(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Action failed') } finally { setBusy(false) }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (unreadable || !order) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6 lg:px-10">
        <Alert className="border-amber-200 bg-amber-50" data-testid="trade-request-unreadable">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription>
            This request could not be loaded. That is not a report that it does not exist — try again shortly.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="mt-4 rounded-none"><Link to="/diaspora/requests">Back to my requests</Link></Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="trade-request-detail">
      <Link to="/diaspora/requests" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-orange-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My requests
      </Link>

      <div className="mt-4 border-b-2 border-gray-950 pb-4">
        <p className="font-mono text-xs text-gray-500">RFQ-{String(order.id).replace(/-/g, '').slice(0, 8).toUpperCase()}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
          {/* A parts request is titled by WHAT was asked for; only a vehicle request is titled by
              make/model. Titling a shocks request "Honda" tells the buyer nothing they asked. */}
          {(order.order_type === 'vehicle'
            ? [order.requested_make, order.requested_model].filter(Boolean).join(' ')
            : lines[0]?.item_description)
            || [order.requested_make, order.requested_model].filter(Boolean).join(' ')
            || 'Sourcing request'}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.tone}`} data-testid="trade-request-status">
            {meta.label}
          </span>
          <span className="text-sm text-gray-600" data-testid="trade-request-status-blurb">{meta.blurb}</span>
        </div>
      </div>

      <div className="mt-6 grid min-w-0 gap-8 xl:grid-cols-[2fr_3fr]">
        {/* What was asked for */}
        <section className="min-w-0">
          <h2 className="border-b border-gray-300 pb-2 text-sm font-bold uppercase tracking-wide text-gray-700">What you asked for</h2>
          <ul className="mt-3 space-y-3" data-testid="trade-request-lines">
            {lines.length === 0 ? (
              <li className="text-sm text-gray-500">No items recorded on this request.</li>
            ) : lines.map((line) => (
              <li key={line.id} className="min-w-0 border-l-2 border-orange-500 pl-3">
                <p className="font-medium text-gray-950">
                  {line.quantity && line.quantity > 1 ? `${line.quantity} × ` : ''}{line.item_description}
                </p>
                <p className="text-xs text-gray-600">
                  {[line.vehicle_make, line.vehicle_model].filter(Boolean).join(' ') || 'Vehicle not specified'}
                  {line.part_number_known && line.part_number ? ` · part ${line.part_number}` : ' · part number not known'}
                </p>
              </li>
            ))}
          </ul>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Destination</dt>
              <dd className="text-sm text-gray-900">{[order.destination_city, order.destination_country].filter(Boolean).join(', ') || NOT_PROVIDED}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Source preference</dt>
              <dd className="text-sm text-gray-900">{order.origin_country || NOT_PROVIDED}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Your budget</dt>
              <dd className="text-sm text-gray-900">
                {order.budget_amount ? money(order.budget_amount, order.budget_currency) : NOT_PROVIDED}
                {order.budget_amount ? (
                  <span className="block text-[11px] text-gray-500">
                    {order.metadata?.rfq?.discloseBudget ? 'Shown to suppliers' : 'Kept private'}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Needed by</dt>
              <dd className="text-sm text-gray-900">{(order.metadata?.rfq?.neededBy as string) || NOT_PROVIDED}</dd>
            </div>
          </dl>

          {lifecycle === 'DRAFT' && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => act(() => publishDiasporaRfq(order.id))} disabled={busy} data-testid="trade-request-publish-now">
                <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> Publish request
              </Button>
              <p className="mt-2 text-xs text-gray-500">Suppliers will be able to see what you need and send offers.</p>
            </div>
          )}
        </section>

        {/* Offers */}
        <section className="min-w-0">
          <div className="flex items-baseline justify-between border-b border-gray-300 pb-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Offers</h2>
            <span className="text-xs text-gray-500" data-testid="trade-offer-count">
              {offers.length === 0 ? 'None yet' : `${offers.length} received`}
            </span>
          </div>

          {error && <Alert className="mt-3 border-red-200 bg-red-50" data-testid="trade-request-action-error"><AlertDescription>{error}</AlertDescription></Alert>}

          {offers.length === 0 ? (
            <div className="mt-4 border border-dashed border-gray-300 p-6" data-testid="trade-offers-empty">
              <p className="font-medium text-gray-900">
                {lifecycle === 'DRAFT' ? 'Not published yet' : 'No offers yet'}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {lifecycle === 'DRAFT'
                  ? 'Publish this request and suppliers who can fulfil it will be able to send you offers.'
                  : 'Suppliers can see your request. Offers will appear here as they arrive, and you will be notified.'}
              </p>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-gray-600">
                The cheapest offer is not always the most complete. Compare what each supplier
                actually includes.
              </p>
              {mixedCurrency && (
                <p className="mt-2 text-xs text-amber-800" data-testid="trade-mixed-currency-note">
                  These offers are in different currencies. CarUp does not convert them, so totals
                  are not directly comparable.
                </p>
              )}
              <div className="mt-4 space-y-4" data-testid="trade-offer-list">
                {offers.map((q) => {
                  const isAccepted = q.id === acceptedQuoteId
                  const notSelected = Boolean(acceptedQuoteId) && !isAccepted
                  return (
                    <article
                      key={q.id}
                      className={`min-w-0 border p-4 sm:p-5 ${isAccepted ? 'border-emerald-500 bg-emerald-50/40' : notSelected ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}
                      data-testid="trade-offer-card"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-lg font-bold text-gray-950" data-testid="trade-offer-total">
                            {money(q.quote_amount, q.quote_currency)}
                          </p>
                          {Number(q.offered_quantity) > 0 && (
                            <p className="text-xs text-gray-600">
                              {q.offered_quantity} unit{Number(q.offered_quantity) === 1 ? '' : 's'}
                              {Number(q.unit_price) > 0 ? ` · ${money(q.unit_price, q.quote_currency)} each` : ''}
                            </p>
                          )}
                        </div>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          isAccepted ? 'border-emerald-400 bg-emerald-100 text-emerald-900'
                            : notSelected ? 'border-gray-300 bg-gray-100 text-gray-600'
                              : 'border-orange-300 bg-orange-50 text-orange-900'
                        }`} data-testid="trade-offer-status">
                          {isAccepted ? 'Accepted' : notSelected ? 'Not selected' : QUOTE_LABEL[q.status] || q.status}
                        </span>
                      </div>

                      {typeof q.offered_description === 'string' && q.offered_description && (
                        <p className="mt-2 text-sm text-gray-700">{q.offered_description}</p>
                      )}

                      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                        {([
                          ['Shipping', shippingLabel(q)],
                          ['Dispatch', leadTimeLabel(q)],
                          ['Condition', (q.offered_condition as string) || NOT_PROVIDED],
                          ['Valid until', q.valid_until ? String(q.valid_until).slice(0, 10) : NOT_PROVIDED],
                        ] as Array<[string, string]>).map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                            <dd className={`truncate text-sm ${value === NOT_PROVIDED ? 'italic text-gray-400' : 'text-gray-900'}`}>{value}</dd>
                          </div>
                        ))}
                      </dl>

                      {(highlights.get(q.id) || []).length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="trade-offer-highlights">
                          {(highlights.get(q.id) || []).map((h) => (
                            <li key={h} className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">{h}</li>
                          ))}
                        </ul>
                      )}

                      {Array.isArray(q.inclusions) && q.inclusions.length > 0 && (
                        <p className="mt-2 text-xs text-gray-600"><span className="font-semibold">Includes:</span> {(q.inclusions as string[]).join(', ')}</p>
                      )}
                      {Array.isArray(q.exclusions) && q.exclusions.length > 0 && (
                        <p className="text-xs text-gray-600"><span className="font-semibold">Excludes:</span> {(q.exclusions as string[]).join(', ')}</p>
                      )}

                      {!acceptedQuoteId && q.status === 'ISSUED' && (
                        <div className="mt-4">
                          <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => act(() => acceptDiasporaQuote(order.id, q.id))} disabled={busy} data-testid="trade-offer-accept">
                            Choose this supplier
                          </Button>
                          <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
                            This supplier becomes your awarded supplier, the other offers close, and the
                            request continues as an order — you will not re-enter any of these details.
                          </p>
                        </div>
                      )}
                      {isAccepted && (
                        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-800" data-testid="trade-offer-accepted-note">
                          <Check className="h-4 w-4" aria-hidden="true" /> You selected this supplier.
                        </p>
                      )}
                    </article>
                  )
                })}
              </div>
            </>
          )}

          {/* After acceptance the mental model changes: this is a trade, not a shopping decision. */}
          {acceptedQuoteId && (
            <div className="mt-6 border border-slate-300 bg-slate-50 p-5" data-testid="trade-next-step">
              <h3 className="text-base font-bold text-gray-950">What happens next</h3>
              <ol className="mt-3 space-y-1.5 text-sm">
                <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> <span><strong>Request</strong> — complete</span></li>
                <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> <span><strong>Supplier</strong> — selected</span></li>
                <li className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-hidden="true" /> <span><strong>Order</strong> — in progress</span></li>
                <li className="flex gap-2 text-gray-500"><span className="mt-1 h-2 w-2 shrink-0 rounded-full border border-gray-300" aria-hidden="true" /> <span>Shipping — not arranged</span></li>
                <li className="flex gap-2 text-gray-500"><span className="mt-1 h-2 w-2 shrink-0 rounded-full border border-gray-300" aria-hidden="true" /> <span>Documents — not started</span></li>
                <li className="flex gap-2 text-gray-500"><span className="mt-1 h-2 w-2 shrink-0 rounded-full border border-gray-300" aria-hidden="true" /> <span>Zimbabwe handoff — not started</span></li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild className="bg-orange-500 text-white hover:bg-orange-600">
                  <Link to={`/diaspora/imports/${order.id}/passport`} data-testid="trade-open-order">Open the order</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-none">
                  <Link to="/diaspora/containers">Arrange shipping</Link>
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
