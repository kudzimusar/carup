import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, Loader2, Package } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { supplierVoice } from './intakeVocabularies'
import { ChargeComponentEditor, ChargeComponentReview } from './chargeComponentEditor'
import type { DraftComponent } from './commercialFormat'
import type { DiasporaMyQuote, DiasporaQuotePayload, DiasporaRfqOpportunity } from '@/types'

/**
 * Buyer Requests — the supplier's opportunity marketplace (Trade OS T2 §9.5/§9.8).
 *
 * Everything rendered here comes from the SANITIZED cross-tenant projection: what the buyer needs,
 * never who they are. The supplier's job is one decision — is this worth quoting — so each
 * opportunity leads with the requirement and why it may suit them, and the offer builder captures a
 * real commercial proposal rather than a bare amount.
 */

type Tab = 'open' | 'mine'

const NOT_PROVIDED = 'Not provided'
const control = 'mt-1 block w-full min-w-0 border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'
const fieldLabel = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-gray-600'

const OUTCOME_LABEL: Record<string, { label: string; tone: string }> = {
  won: { label: 'Won', tone: 'border-emerald-400 bg-emerald-50 text-emerald-900' },
  not_selected: { label: 'Not selected', tone: 'border-gray-300 bg-gray-100 text-gray-600' },
  DRAFT: { label: 'Draft', tone: 'border-gray-300 bg-gray-100 text-gray-700' },
  ISSUED: { label: 'Submitted', tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  ACCEPTED: { label: 'Won', tone: 'border-emerald-400 bg-emerald-50 text-emerald-900' },
  REJECTED: { label: 'Not selected', tone: 'border-gray-300 bg-gray-100 text-gray-600' },
}

function genKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
}

/**
 * Match strength from the deterministic score. The number sorts; the words explain. A supplier is
 * never shown a bare figure like "87".
 */
function matchStrength(score: number): string {
  if (score >= 60) return 'Strong match'
  if (score >= 30) return 'Possible match'
  return 'Partial match'
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  return Math.ceil((then - new Date().getTime()) / 86_400_000)
}

export default function TradeBuyerRequests() {
  const { loading: authLoading } = useAuth()
  const {
    fetchDiasporaRfqs, fetchDiasporaMyQuotes, createDiasporaQuote, updateDiasporaQuote,
    submitDiasporaQuote, withdrawDiasporaQuote, ensureDiasporaRfqConversation, saveChargeComponents,
  } = useCarUpApi()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('open')
  const [rfqs, setRfqs] = useState<DiasporaRfqOpportunity[]>([])
  const [myQuotes, setMyQuotes] = useState<DiasporaMyQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [composerFor, setComposerFor] = useState<string | null>(null)
  // A commercial offer must not jump from typing to irrevocable submission (audit item 7).
  const [composerStage, setComposerStage] = useState<'edit' | 'review'>('edit')
  // T6 — the structured cost breakdown. The headline amount below is unchanged.
  const [components, setComponents] = useState<DraftComponent[]>([])
  const [breakdownComplete, setBreakdownComplete] = useState(false)
  // Set when editing an EXISTING draft rather than creating a new offer (audit item 6).
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null)
  const [makeFilter, setMakeFilter] = useState('')

  // Offer builder state
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [description, setDescription] = useState('')
  const [conditionOffered, setConditionOffered] = useState('')
  const [leadTime, setLeadTime] = useState('')
  const [shipping, setShipping] = useState<'unstated' | 'included' | 'excluded'>('unstated')
  const [validUntil, setValidUntil] = useState('')
  const [inclusions, setInclusions] = useState('')
  const [exclusions, setExclusions] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [open, mine] = await Promise.all([fetchDiasporaRfqs(), fetchDiasporaMyQuotes()])
      setRfqs(open)
      setMyQuotes(mine)
      setUnreadable(false)
    } catch {
      setRfqs([])
      setMyQuotes([])
      setUnreadable(true)
    } finally {
      setLoading(false)
    }
  }, [fetchDiasporaRfqs, fetchDiasporaMyQuotes])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  const quotedOrderIds = useMemo(
    () => new Set(myQuotes.map((q) => q.quote.import_order_id)),
    [myQuotes],
  )

  const visible = useMemo(() => {
    if (!makeFilter.trim()) return rfqs
    const needle = makeFilter.trim().toLowerCase()
    return rfqs.filter((r) =>
      String(r.requested_make || '').toLowerCase().includes(needle)
      || r.lines.some((l) => String(l.vehicle_make || '').toLowerCase().includes(needle)))
  }, [rfqs, makeFilter])

  const resetComposer = () => {
    setAmount(''); setCurrency('USD'); setQuantity(''); setUnitPrice(''); setDescription('')
    setConditionOffered(''); setLeadTime(''); setShipping('unstated'); setValidUntil('')
    setInclusions(''); setExclusions('')
    setComponents([]); setBreakdownComplete(false)
  }

  const openComposer = (rfq: DiasporaRfqOpportunity) => {
    resetComposer()
    const totalQty = rfq.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
    if (totalQty > 0) setQuantity(String(totalQty))
    setEditingQuoteId(null)
    setComposerStage('edit')
    setComposerFor(rfq.id)
    setError('')
  }

  /** Reopen an existing DRAFT offer with its saved values, so nothing is retyped (audit item 6). */
  const editDraft = (row: DiasporaMyQuote) => {
    const q = row.quote
    setAmount(String(q.quote_amount ?? ''))
    setCurrency(q.quote_currency || 'USD')
    setQuantity(q.offered_quantity ? String(q.offered_quantity) : '')
    setUnitPrice(q.unit_price ? String(q.unit_price) : '')
    setDescription(String(q.offered_description || ''))
    setConditionOffered(String(q.offered_condition || ''))
    setLeadTime(q.lead_time_days ? String(q.lead_time_days) : '')
    setShipping(q.shipping_included === true ? 'included' : q.shipping_included === false ? 'excluded' : 'unstated')
    setValidUntil(q.valid_until ? String(q.valid_until).slice(0, 10) : '')
    setInclusions(Array.isArray(q.inclusions) ? (q.inclusions as string[]).join(', ') : '')
    setExclusions(Array.isArray(q.exclusions) ? (q.exclusions as string[]).join(', ') : '')
    setEditingQuoteId(q.id)
    setComposerStage('edit')
    setComposerFor(q.import_order_id)
    setError('')
    setTab('open')
  }

  const buildQuotePayload = (submit: boolean): DiasporaQuotePayload => {
    const payload: DiasporaQuotePayload = {
      quote_amount: Number(amount),
      quote_currency: currency,
      submit,
      idempotencyKey: genKey(),
    }
    if (Number(quantity) > 0) payload.offered_quantity = Number(quantity)
    if (Number(unitPrice) > 0) payload.unit_price = Number(unitPrice)
    if (Number(leadTime) > 0) payload.lead_time_days = Number(leadTime)
    if (shipping !== 'unstated') payload.shipping_included = shipping === 'included'
    if (conditionOffered.trim()) payload.offered_condition = conditionOffered.trim()
    if (description.trim()) payload.offered_description = description.trim()
    if (validUntil) payload.valid_until = validUntil
    const inc = inclusions.split(',').map((s) => s.trim()).filter(Boolean)
    const exc = exclusions.split(',').map((s) => s.trim()).filter(Boolean)
    if (inc.length) payload.inclusions = inc
    if (exc.length) payload.exclusions = exc
    return payload
  }

  const sendOffer = async (rfqId: string, submit: boolean) => {
    if (busy) return
    setError('')
    if (!(Number(amount) > 0)) { setError('Enter the total price you are offering.'); return }
    setBusy(true)
    try {
      // The quote header saves first, then its components attach. A rejected breakdown surfaces
      // here — which is exactly when a "complete" declaration that does not add up is refused.
      let quoteId = editingQuoteId
      if (editingQuoteId) {
        // Governed: only a DRAFT is editable, and the backend re-checks that.
        await updateDiasporaQuote(editingQuoteId, buildQuotePayload(false))
      } else {
        const created = await createDiasporaQuote(rfqId, buildQuotePayload(false))
        quoteId = created.quote?.id || null
      }
      const usable = components.filter((c) => c.label.trim() || c.amount !== '')
      if (quoteId && usable.length) {
        await saveChargeComponents('import-quotes', quoteId, usable, breakdownComplete)
      }
      if (submit && quoteId) await submitDiasporaQuote(quoteId)
      setComposerFor(null)
      setEditingQuoteId(null)
      setComposerStage('edit')
      resetComposer()
      await load()
      setTab('mine')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your offer could not be sent')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Open the canonical clarification thread and hand the supplier to the inbox. Deliberately NOT
   * routed through act(): act() refetches this page afterwards, which races the navigation away.
   */
  const askQuestion = async (rfqId: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await ensureDiasporaRfqConversation(rfqId)
      navigate('/diaspora/messages')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The conversation could not be opened')
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try { await fn(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Action failed') } finally { setBusy(false) }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="trade-buyer-requests">
      <div className="border-b-2 border-gray-950 pb-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-950">Buyer requests</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Customers actively looking for products you can supply. Send an offer with your price,
          availability and terms — they compare offers before choosing.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1" role="tablist">
        {([['open', `Open requests${rfqs.length ? ` (${rfqs.length})` : ''}`], ['mine', `My offers${myQuotes.length ? ` (${myQuotes.length})` : ''}`]] as Array<[Tab, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-1.5 text-sm transition-colors ${tab === value ? 'border-orange-500 font-semibold text-gray-950' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            data-testid={`trade-tab-${value}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Alert className="mt-4 border-red-200 bg-red-50" data-testid="trade-seller-error"><AlertDescription>{error}</AlertDescription></Alert>}
      {unreadable && (
        <Alert className="mt-4 border-amber-200 bg-amber-50" data-testid="trade-seller-unreadable">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription>Buyer requests could not be loaded. This is not a report that there are none.</AlertDescription>
        </Alert>
      )}

      {/* ── Open opportunities ─────────────────────────────────────────────── */}
      {tab === 'open' && (
        <>
          {rfqs.length > 0 && (
            <div className="mt-4 max-w-xs">
              <label className={fieldLabel}>Filter by vehicle make
                <Input className="mt-1 rounded-none" placeholder="e.g. Honda" value={makeFilter} onChange={(e) => setMakeFilter(e.target.value)} data-testid="trade-filter-make" />
              </label>
            </div>
          )}

          {!unreadable && visible.length === 0 && (
            <div className="mt-6 border border-dashed border-gray-300 p-8" data-testid="trade-opportunities-empty">
              <h2 className="text-lg font-bold text-gray-950">
                {rfqs.length === 0 ? 'No buyer requests yet' : 'No requests match that filter'}
              </h2>
              <p className="mt-2 max-w-xl text-sm text-gray-600">
                {rfqs.length === 0
                  ? 'When customers publish requests for products you can supply, they will appear here with the details you need to decide whether to quote.'
                  : 'Clear the filter to see every open request.'}
              </p>
            </div>
          )}

          <div className="mt-5 space-y-5">
            {visible.map((rfq) => {
              const closes = daysUntil(rfq.quote_deadline || rfq.needed_by)
              const alreadyQuoted = quotedOrderIds.has(rfq.id)
              return (
                <article key={rfq.id} className="min-w-0 border border-gray-300 bg-white p-5" data-testid="trade-opportunity-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-gray-950" data-testid="trade-opportunity-title">
                        {rfq.lines[0]?.item_description
                          || [rfq.requested_make, rfq.requested_model].filter(Boolean).join(' ')
                          || 'Sourcing request'}
                      </h2>
                      <p className="font-mono text-xs text-gray-500">{rfq.reference}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {typeof rfq.quote_count === 'number' && rfq.quote_count > 0 && (
                        <p className="mt-1 text-xs text-gray-600" data-testid="trade-opportunity-quote-count">
                          {rfq.quote_count} offer{rfq.quote_count === 1 ? '' : 's'} sent
                        </p>
                      )}
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1.5" data-testid="trade-opportunity-lines">
                    {rfq.lines.map((line) => (
                      <li key={line.id} className="min-w-0 text-sm text-gray-800">
                        <span className="font-medium">{line.quantity && line.quantity > 1 ? `${line.quantity} × ` : ''}{line.item_description}</span>
                        <span className="block text-xs text-gray-600">
                          {[line.vehicle_make, line.vehicle_model].filter(Boolean).join(' ') || 'Vehicle not specified'}
                          {/* Part-number copy is meaningful for a part and nonsense for a vehicle —
                              a car request must never read "buyer does not know the part number". */}
                          {line.item_kind === 'part' && (
                            <>
                              {' · '}
                              {line.part_number_known && line.part_number
                                ? `part ${line.part_number}`
                                : 'buyer does not know the part number'}
                            </>
                          )}
                          {line.condition_preference && line.condition_preference !== 'any' ? ` · wants ${line.condition_preference}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                    {([
                      ['Destination', [rfq.destination_city, rfq.destination_country].filter(Boolean).join(', ') || NOT_PROVIDED],
                      ['Needed by', rfq.needed_by || NOT_PROVIDED],
                      ['Source preference', rfq.origin_country || NOT_PROVIDED],
                      ['Buyer budget', rfq.budget_disclosed ? `${rfq.budget_amount} ${rfq.budget_currency || ''}`.trim() : 'Not disclosed'],
                    ] as Array<[string, string]>).map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                        <dd className={`truncate text-sm ${value === NOT_PROVIDED || value === 'Not disclosed' ? 'italic text-gray-400' : 'text-gray-900'}`}>{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {(() => {
                    // Intake 2.0: the buyer answered these, projectRfqForMarketplace() published
                    // them, and until now the supplier UI dropped them on the floor. Render only
                    // what the projection carries — a field absent from the payload is a field the
                    // allow-list withheld, so nothing here can widen what suppliers see.
                    const line = rfq.lines[0]
                    const facts: Array<[string, string]> = []
                    const add = (label: string, field: string, value: unknown) => {
                      if (value === null || value === undefined || value === '') return
                      if (Array.isArray(value)) {
                        if (!value.length) return
                        facts.push([label, value.map((v) => supplierVoice(field, String(v))).join(', ')])
                        return
                      }
                      facts.push([label, typeof value === 'string' ? supplierVoice(field, value) : String(value)])
                    }
                    add('Steering', 'vehicle_steering', line?.vehicle_steering)
                    add('Transmission', 'vehicle_transmission', line?.vehicle_transmission)
                    add('Drivetrain', 'vehicle_drivetrain', line?.vehicle_drivetrain)
                    add('Fuel', 'vehicle_fuel_type', line?.vehicle_fuel_type)
                    add('Body', 'vehicle_body_type', line?.vehicle_body_type)
                    if (line?.vehicle_mileage_max_km) facts.push(['Max mileage', `${Number(line.vehicle_mileage_max_km).toLocaleString()} km`])
                    if (line?.vehicle_seats_min) facts.push(['Seats', `${line.vehicle_seats_min}+`])
                    add('Colour', 'vehicle_colour_preference', line?.vehicle_colour_preference)
                    add('Grade', 'vehicle_auction_grade', line?.vehicle_auction_grade)
                    add('Accident history', 'accident_repair_tolerance', line?.accident_repair_tolerance)
                    add('Rust', 'rust_tolerance', line?.rust_tolerance)
                    add('Purpose', 'intended_use', line?.intended_use)
                    add('Also considering', 'alternative_models', line?.alternative_models)
                    add('Brand', 'brand_preference', line?.brand_preference)
                    add('Side', 'part_side', line?.part_side)
                    add('Part origin', 'part_origin_preference', line?.part_origin_preference)
                    add('Delivery outcome', 'destination_outcome', rfq.destination_outcome)
                    add('Port', 'preferred_port', rfq.preferred_port)
                    add('Priority', 'shipping_objective', rfq.shipping_objective)
                    add('Shipping mode', 'shipping_mode_preference', rfq.shipping_mode_preference)
                    add('Alternatives', 'alternatives_policy', rfq.alternatives_policy)
                    add('Timing', 'timing_flexibility', rfq.timing_flexibility)
                    if (!facts.length) return null
                    return (
                      <div className="mt-4 border-t border-gray-200 pt-4" data-testid="trade-opportunity-brief">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">What the buyer asked for</p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
                          {facts.map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-[11px] text-gray-500">{label}</dt>
                              <dd className="break-words text-sm text-gray-900">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {rfq.requested_quote_components?.length ? (
                          <p className="mt-3 text-xs text-gray-700" data-testid="trade-opportunity-quote-components">
                            Buyer wants your price to cover:{' '}
                            <span className="font-medium">
                              {rfq.requested_quote_components.map((c) => supplierVoice('requested_quote_components', c)).join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    )
                  })()}

                  {rfq.supplier_match ? (
                    <div className="mt-3 border-l-2 border-emerald-500 pl-3" data-testid="trade-match-reasons">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                        {matchStrength(rfq.supplier_match.score)} · your stock
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        <li className="flex gap-1.5 text-xs text-gray-700">
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                          You have {rfq.supplier_match.available_quantity} available — {rfq.supplier_match.stock_name}
                        </li>
                        {/* The scorer emits its own availability/export lines; the two headline
                            rows above already say those, so drop the duplicates rather than
                            listing the same fact twice in different words. */}
                        {rfq.supplier_match.reasons
                          .filter((r) => !/^available quantity/i.test(r) && !/^export ready$/i.test(r))
                          .map((reason) => (
                            <li key={reason} className="flex gap-1.5 text-xs text-gray-700">
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" /> {reason}
                            </li>
                          ))}
                        {rfq.supplier_match.export_ready && (
                          <li className="flex gap-1.5 text-xs text-gray-700">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" /> Stock is recorded as export-ready
                          </li>
                        )}
                      </ul>
                    </div>
                  ) : (
                    // Honest absence: restating the buyer's own request as a "reason" would be
                    // dressing up request facts as evidence about this supplier.
                    <p className="mt-3 border-l-2 border-gray-300 pl-3 text-xs italic text-gray-500" data-testid="trade-no-match">
                      No stock match confirmed yet — you can still quote.
                    </p>
                  )}

                  {closes !== null && closes >= 0 && (
                    <p className="mt-3 text-xs text-gray-600">Buyer needs this in {closes} day{closes === 1 ? '' : 's'}.</p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {composerFor === rfq.id ? (
                      <Button variant="outline" className="rounded-none" onClick={() => setComposerFor(null)}>Cancel</Button>
                    ) : (
                      <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => openComposer(rfq)} data-testid="trade-prepare-offer">
                        {alreadyQuoted ? 'Send another offer' : 'Prepare offer'}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="rounded-none"
                      disabled={busy}
                      onClick={() => askQuestion(rfq.id)}
                      data-testid="trade-ask-question"
                    >
                      Ask a question
                    </Button>
                    {alreadyQuoted && <span className="text-xs text-gray-600">You have already offered on this request.</span>}
                  </div>

                  {/* ── Offer builder ──────────────────────────────────────── */}
                  {composerFor === rfq.id && (
                    <div className="mt-5 min-w-0 border-t border-gray-200 pt-5" data-testid="trade-quote-composer">
                      <h3 className="text-base font-bold text-gray-950">
                        {editingQuoteId ? 'Edit your draft offer' : 'Your offer'}
                      </h3>
                      <p className="mt-1 text-xs text-gray-600">
                        Anything you leave blank shows to the buyer as “Not provided” — it is never
                        assumed in your favour or against you.
                      </p>

                      {composerStage === 'review' ? (
                        <div className="mt-4 min-w-0" data-testid="trade-offer-review-panel">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Exactly what the buyer will see</p>
                          <div className="mt-2 border border-gray-300 bg-white p-4">
                            <p className="text-lg font-bold text-gray-950">
                              {Number(amount).toLocaleString()} {currency}
                            </p>
                            {description.trim() && <p className="mt-1 text-sm text-gray-700">{description.trim()}</p>}
                            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
                              {([
                                ['Quantity', quantity ? String(quantity) : NOT_PROVIDED],
                                ['Unit price', unitPrice ? `${unitPrice} ${currency}` : NOT_PROVIDED],
                                ['Condition', conditionOffered.trim() || NOT_PROVIDED],
                                ['Shipping', shipping === 'included' ? 'Included' : shipping === 'excluded' ? 'Not included' : NOT_PROVIDED],
                                ['Dispatch', leadTime ? `${leadTime} days` : NOT_PROVIDED],
                                ['Valid until', validUntil || NOT_PROVIDED],
                                ['Includes', inclusions.trim() || NOT_PROVIDED],
                                ['Excludes', exclusions.trim() || NOT_PROVIDED],
                              ] as Array<[string, string]>).map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                                  <dd className={`truncate text-sm ${value === NOT_PROVIDED ? 'italic text-gray-400' : 'text-gray-900'}`}>{value}</dd>
                                </div>
                              ))}
                            </dl>
                            <ChargeComponentReview components={components} total={amount} currency={currency} />
                          </div>
                          <div className="mt-5 flex flex-wrap items-center gap-3">
                            <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => sendOffer(rfq.id, true)} disabled={busy} data-testid="trade-offer-submit">
                              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Submit offer
                            </Button>
                            <Button variant="outline" className="rounded-none" onClick={() => setComposerStage('edit')} disabled={busy} data-testid="trade-offer-back-to-edit">
                              Back to edit
                            </Button>
                            <span className="text-xs text-gray-500">A submitted offer is visible to the buyer and cannot be edited.</span>
                          </div>
                        </div>
                      ) : (
                      <>

                      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">What you are supplying</p>
                      <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-2">
                        <label className={`${fieldLabel} sm:col-span-2`}>Description
                          <Input className="mt-1 rounded-none" placeholder="e.g. New aftermarket front shocks, KYB" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="trade-offer-description" />
                        </label>
                        <label className={fieldLabel}>Quantity you can supply
                          <Input className="mt-1 rounded-none" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="trade-offer-quantity" />
                        </label>
                        <label className={fieldLabel}>Condition
                          <Input className="mt-1 rounded-none" placeholder="e.g. New / OEM" value={conditionOffered} onChange={(e) => setConditionOffered(e.target.value)} data-testid="trade-offer-condition" />
                        </label>
                      </div>

                      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Price</p>
                      <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-3">
                        <label className={fieldLabel}>Price per unit (optional)
                          <Input className="mt-1 rounded-none" type="number" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} data-testid="trade-offer-unit-price" />
                        </label>
                        <label className={fieldLabel}>Total price *
                          <Input className="mt-1 rounded-none" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="trade-offer-amount" />
                        </label>
                        <label className={fieldLabel}>Currency
                          <select className={control} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="trade-offer-currency">
                            {['USD', 'JPY', 'ZWG', 'ZAR', 'GBP', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                      </div>
                      {Number(unitPrice) > 0 && Number(quantity) > 0 && (
                        <p className="mt-1.5 text-xs text-gray-600" data-testid="trade-offer-subtotal">
                          {quantity} × {unitPrice} = {(Number(unitPrice) * Number(quantity)).toLocaleString()} {currency} before any extras.
                        </p>
                      )}

                      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Timing and shipping</p>
                      <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-3">
                        <label className={fieldLabel}>Dispatch lead time (days)
                          <Input className="mt-1 rounded-none" type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} data-testid="trade-offer-lead-time" />
                        </label>
                        <label className={fieldLabel}>Shipping
                          <select className={control} value={shipping} onChange={(e) => setShipping(e.target.value as typeof shipping)} data-testid="trade-offer-shipping">
                            <option value="unstated">I&apos;d rather not say yet</option>
                            <option value="included">Included in my price</option>
                            <option value="excluded">Not included</option>
                          </select>
                        </label>
                        <label className={fieldLabel}>Offer valid until
                          <Input className="mt-1 rounded-none" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} data-testid="trade-offer-valid-until" />
                        </label>
                      </div>

                      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Inclusions and exclusions</p>
                      <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-2">
                        <label className={fieldLabel}>Included (comma separated)
                          <Input className="mt-1 rounded-none" placeholder="e.g. packaging, export preparation" value={inclusions} onChange={(e) => setInclusions(e.target.value)} data-testid="trade-offer-inclusions" />
                        </label>
                        <label className={fieldLabel}>Excluded (comma separated)
                          <Input className="mt-1 rounded-none" placeholder="e.g. freight, customs duty" value={exclusions} onChange={(e) => setExclusions(e.target.value)} data-testid="trade-offer-exclusions" />
                        </label>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <ChargeComponentEditor components={components} onChange={setComponents} total={amount} currency={currency} breakdownComplete={breakdownComplete} onBreakdownCompleteChange={setBreakdownComplete} />
                        <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => { setError(''); setComposerStage('review') }} disabled={busy} data-testid="trade-offer-review">
                          Review offer
                        </Button>
                        <Button variant="outline" className="rounded-none" onClick={() => sendOffer(rfq.id, false)} disabled={busy} data-testid="trade-offer-save-draft">
                          Save as draft
                        </Button>
                        <span className="text-xs text-gray-500">You will see exactly what the buyer sees before anything is sent.</span>
                      </div>
                      </>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}

      {/* ── My offers ──────────────────────────────────────────────────────── */}
      {tab === 'mine' && (
        <div className="mt-5 space-y-4" data-testid="trade-my-offers">
          {myQuotes.length === 0 && !unreadable && (
            <div className="border border-dashed border-gray-300 p-8" data-testid="trade-my-offers-empty">
              <h2 className="text-lg font-bold text-gray-950">You haven&apos;t sent any offers yet</h2>
              <p className="mt-2 max-w-xl text-sm text-gray-600">
                Open a buyer request and prepare an offer. Your drafts and submitted offers, and
                whether you won them, appear here.
              </p>
            </div>
          )}
          {myQuotes.map(({ quote, outcome, request }) => {
            const badge = OUTCOME_LABEL[outcome] || OUTCOME_LABEL[quote.status] || { label: quote.status, tone: 'border-gray-300 bg-gray-50 text-gray-700' }
            return (
              <article key={quote.id} className="min-w-0 border border-gray-300 bg-white p-5" data-testid="trade-my-offer-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-950">
                      {request?.lines?.[0]?.item_description || request?.reference || 'Request'}
                    </p>
                    <p className="font-mono text-xs text-gray-500">{request?.reference || '—'}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.tone}`} data-testid="trade-my-offer-status">
                    {badge.label}
                  </span>
                </div>
                <p className="mt-2 text-lg font-bold text-gray-950">
                  {Number(quote.quote_amount).toLocaleString()} {quote.quote_currency || ''}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-4">
                  {([
                    ['Quantity', quote.offered_quantity ? String(quote.offered_quantity) : NOT_PROVIDED],
                    ['Dispatch', quote.lead_time_days ? `${quote.lead_time_days} days` : NOT_PROVIDED],
                    ['Shipping', quote.shipping_included === true ? 'Included' : quote.shipping_included === false ? 'Not included' : NOT_PROVIDED],
                    ['Valid until', quote.valid_until ? String(quote.valid_until).slice(0, 10) : NOT_PROVIDED],
                  ] as Array<[string, string]>).map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                      <dd className={`truncate text-sm ${value === NOT_PROVIDED ? 'italic text-gray-400' : 'text-gray-900'}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
                {quote.status === 'DRAFT' && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" className="rounded-none bg-orange-500 text-white hover:bg-orange-600" onClick={() => editDraft({ quote, outcome, request })} disabled={busy} data-testid="trade-my-offer-edit">
                      Edit offer
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-none" onClick={() => act(() => submitDiasporaQuote(quote.id))} disabled={busy} data-testid="trade-my-offer-submit">
                      Submit this offer
                    </Button>
                    <Button size="sm" variant="ghost" className="rounded-none text-gray-600" onClick={() => act(() => withdrawDiasporaQuote(quote.id))} disabled={busy} data-testid="trade-my-offer-withdraw">
                      Withdraw
                    </Button>
                  </div>
                )}
                {outcome === 'won' && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                    <Package className="h-4 w-4" aria-hidden="true" /> The buyer chose your offer.
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
