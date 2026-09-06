import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useNavigate } from 'react-router-dom'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import { formatRoute } from './tradeRoute'
import { ChargeComponentEditor, ChargeComponentReview } from './chargeComponentEditor'
import type { DraftComponent } from './commercialFormat'
import type { DiasporaTradeContext } from '@/types'
import type { LogisticsMyQuote, LogisticsOpportunity, LogisticsQuoteInput } from '@/types/tradeLogistics'


// Provider-voice renderings. The customer answered these in their own words ("Deliver it to my
// address"); a provider needs the same fact stated as the job they are being asked to price.
const PICKUP_REQUIRED_LABELS: Record<string, string> = {
  yes: 'Inland collection required', no: 'Customer delivers to origin port/yard',
  unsure: 'Customer is unsure — confirm before pricing',
}
const ORIGIN_SITE_LABELS: Record<string, string> = {
  auction: 'Auction house', dealer: 'Dealer', exporter: 'Exporter', private_seller: 'Private seller',
  warehouse_yard: 'Warehouse / yard', carup_partner_yard: 'CarUp partner yard',
  customer_location: 'Customer location', other: 'Other site',
}
const PROVIDER_OUTCOME_LABELS: Record<string, string> = {
  port_only: 'Customer collects at destination port', port_plus_clearing: 'Port + clearing help wanted',
  cross_border_transit: 'Port, then across the border', port_to_city: "Deliver to customer's city",
  door_delivery: "Deliver to customer's address", unsure: 'Customer unsure — propose options',
}
const PROVIDER_OBJECTIVE_LABELS: Record<string, string> = {
  lowest_cost: 'Lowest reasonable cost', faster_arrival: 'Faster arrival',
  better_protection: 'Protection / security', extra_goods: 'Extra goods travelling with it',
  non_running: 'Vehicle does not run', multiple_vehicles: 'Multiple vehicles',
  private_container: 'Wants a private container', flexible: 'Flexible — propose options',
}
const PROVIDER_TIMING_LABELS: Record<string, string> = {
  fixed: 'Fixed', somewhat_flexible: 'Somewhat flexible', flexible: 'Flexible',
}
const RUNNING_LABELS: Record<string, string> = {
  runs_and_drives: 'Runs and drives', starts_only: 'Starts but does not drive',
  non_running: 'Non-running — needs winching', unknown: 'Unknown',
}
const KEYS_LABELS: Record<string, string> = { available: 'Available', missing: 'Missing', unknown: 'Unknown' }
const HANDLING_LABELS: Record<string, string> = {
  fragile: 'Fragile', stackable: 'Stackable', oversized: 'Oversized', heavy_lift: 'Heavy lift',
  temperature_sensitive: 'Temperature sensitive', hazardous: 'Hazardous',
}
const DECLARATION_LABELS: Record<string, string> = {
  batteries: 'Batteries', fluids: 'Fluids', aerosols: 'Aerosols', personal_effects: 'Personal effects',
  food: 'Food', electronics: 'Electronics', none_of_these: 'None of these',
}
const humaniseCargo = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

type Tab = 'opportunities' | 'offers'
type Stage = 'edit' | 'review'

const fieldLabel = 'block min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-600'
// Width is deliberately NOT part of the shared chrome. Appending `w-24` to a string that already
// contains `w-full` does not narrow anything — both are width utilities of equal specificity, so
// the generated stylesheet decides, and `w-full` won. That is what made the currency select render
// full-width inside the Offer total row and push the page 18px wide at 393px.
const selectChrome = 'mt-1 block min-w-0 border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none'
const selectClass = `${selectChrome} w-full`
const SERVICE_MODES: Array<[LogisticsQuoteInput['service_mode'], string]> = [
  ['shared_container', 'Shared container / co-loading'],
  ['lcl', 'LCL freight'],
  ['fcl', 'Full container'],
  ['road', 'Road transport'],
  ['multimodal', 'Multimodal'],
  ['other', 'Other service'],
]
const CURRENCIES = ['USD', 'JPY', 'ZWG', 'ZAR', 'GBP', 'EUR']

const SERVICE_PREFERENCE_LABELS: Record<string, string> = {
  flexible: 'Flexible — provider proposes the service',
  door_to_door: 'Door to door requested',
  door_to_port: 'Pickup to port requested',
  port_to_door: 'Port to door requested',
  port_to_port: 'Port to port requested',
}

function parseMoney(value: string): number | undefined {
  if (!value.trim()) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function labelCategory(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function TradeLogisticsProviderPanel({ context }: { context: DiasporaTradeContext | null }) {
  const api = useTradeLogisticsApi()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('opportunities')
  const [opportunities, setOpportunities] = useState<LogisticsOpportunity[]>([])
  const [myQuotes, setMyQuotes] = useState<LogisticsMyQuote[]>([])
  const [containers, setContainers] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [composerRequestId, setComposerRequestId] = useState<string | null>(null)
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('edit')
  // T6 — the structured cost breakdown. Separate from the headline total, which is unchanged.
  const [components, setComponents] = useState<DraftComponent[]>([])
  const [breakdownComplete, setBreakdownComplete] = useState(false)

  const [serviceMode, setServiceMode] = useState<LogisticsQuoteInput['service_mode']>('shared_container')
  const [containerId, setContainerId] = useState('')
  const [freight, setFreight] = useState('')
  const [handling, setHandling] = useState('')
  const [originCharges, setOriginCharges] = useState('')
  const [destinationCharges, setDestinationCharges] = useState('')
  const [documentFees, setDocumentFees] = useState('')
  const [total, setTotal] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [transitDays, setTransitDays] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [pickup, setPickup] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [delivery, setDelivery] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [inclusions, setInclusions] = useState('')
  const [exclusions, setExclusions] = useState('')
  const [conditions, setConditions] = useState('')

  const isProvider = context?.business_type === 'logistics_provider'

  const load = useCallback(async () => {
    if (!isProvider) return
    setLoading(true)
    try {
      const [requests, quotes, openContainers] = await Promise.all([
        api.listOpportunities(),
        api.listMyQuotes(),
        api.listOpenContainers(),
      ])
      setOpportunities(requests); setMyQuotes(quotes); setContainers(openContainers); setUnreadable(false)
    } catch {
      setOpportunities([]); setMyQuotes([]); setContainers([]); setUnreadable(true)
    } finally { setLoading(false) }
  }, [api, isProvider])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical repo data-fetch pattern: load() flips the loading flag before awaiting so the panel never renders a false empty state.
  useEffect(() => { void load() }, [load])

  const myContainers = useMemo(() => containers.filter((container) => {
    const tenantId = typeof container.tenant_id === 'string' ? container.tenant_id : null
    const coordinatorId = typeof container.coordinator_id === 'string' ? container.coordinator_id : null
    return tenantId === context?.organisation?.id || coordinatorId === context?.user?.id
  }), [containers, context])

  const resetComposer = () => {
    setEditingQuoteId(null); setServiceMode('shared_container'); setContainerId('')
    setFreight(''); setHandling(''); setOriginCharges(''); setDestinationCharges(''); setDocumentFees(''); setTotal('')
    setCurrency('USD'); setTransitDays(''); setValidUntil(''); setPickup('unknown'); setDelivery('unknown')
    setInclusions(''); setExclusions(''); setConditions(''); setStage('edit'); setError('')
    setComponents([]); setBreakdownComplete(false)
  }

  const openComposer = (requestId: string) => { resetComposer(); setComposerRequestId(requestId) }

  const editDraft = (entry: LogisticsMyQuote) => {
    const quote = entry.quote
    setComposerRequestId(quote.logistics_request_id); setEditingQuoteId(quote.id); setStage('edit')
    setServiceMode(quote.service_mode || 'other'); setContainerId(quote.compatible_container_id || '')
    setFreight(quote.freight_amount == null ? '' : String(quote.freight_amount)); setHandling(quote.handling_amount == null ? '' : String(quote.handling_amount))
    setOriginCharges(quote.origin_charges == null ? '' : String(quote.origin_charges)); setDestinationCharges(quote.destination_charges == null ? '' : String(quote.destination_charges))
    setDocumentFees(quote.documentation_fees == null ? '' : String(quote.documentation_fees)); setTotal(String(quote.total_amount || ''))
    setCurrency(quote.currency || 'USD'); setTransitDays(quote.transit_days == null ? '' : String(quote.transit_days)); setValidUntil(quote.valid_until ? String(quote.valid_until).slice(0, 10) : '')
    setPickup(quote.pickup_included === true ? 'yes' : quote.pickup_included === false ? 'no' : 'unknown')
    setDelivery(quote.delivery_included === true ? 'yes' : quote.delivery_included === false ? 'no' : 'unknown')
    setInclusions((quote.inclusions || []).join(', ')); setExclusions((quote.exclusions || []).join(', ')); setConditions(quote.conditions || ''); setError('')
  }

  const payload = useMemo<LogisticsQuoteInput>(() => ({
    service_mode: serviceMode,
    compatible_container_id: containerId || null,
    freight_amount: parseMoney(freight),
    handling_amount: parseMoney(handling),
    origin_charges: parseMoney(originCharges),
    destination_charges: parseMoney(destinationCharges),
    documentation_fees: parseMoney(documentFees),
    total_amount: Number(total),
    currency,
    transit_days: transitDays ? Number(transitDays) : null,
    valid_until: validUntil || null,
    pickup_included: pickup === 'unknown' ? null : pickup === 'yes',
    delivery_included: delivery === 'unknown' ? null : delivery === 'yes',
    inclusions: inclusions.split(',').map((value) => value.trim()).filter(Boolean),
    exclusions: exclusions.split(',').map((value) => value.trim()).filter(Boolean),
    conditions: conditions.trim() || null,
  }), [serviceMode, containerId, freight, handling, originCharges, destinationCharges, documentFees, total, currency, transitDays, validUntil, pickup, delivery, inclusions, exclusions, conditions])

  const save = async (submit: boolean) => {
    if (!composerRequestId || busy) return
    if (!(Number(total) > 0)) { setError('Enter the total amount the customer would pay for this stated offer.'); return }
    setBusy(true); setError('')
    try {
      // The quote header is saved first; components attach to it. A failed component write must
      // not silently succeed, so the error surfaces and the provider can correct the breakdown
      // before submitting — which is exactly when a "complete" declaration is refused.
      let quoteId = editingQuoteId
      if (editingQuoteId) {
        await api.updateQuote(editingQuoteId, payload)
      } else {
        const created = await api.createQuote(composerRequestId, payload)
        quoteId = created.id
      }
      const usable = components.filter((c) => c.label.trim() || c.amount !== '')
      if (quoteId && usable.length) {
        await api.saveChargeComponents('logistics-quotes', quoteId, usable, breakdownComplete)
      }
      if (submit && quoteId) await api.submitQuote(quoteId)
      setComposerRequestId(null); resetComposer(); await load(); setTab('offers')
    } catch (err) { setError(err instanceof Error ? err.message : 'Logistics offer could not be saved') }
    finally { setBusy(false) }
  }

  const askQuestion = async (requestId: string) => {
    if (busy) return
    setBusy(true); setError('')
    try { await api.ensureConversation(requestId); navigate('/diaspora/messages') }
    catch (err) { setError(err instanceof Error ? err.message : 'Conversation could not be opened'); setBusy(false) }
  }

  if (!isProvider) return null
  if (loading) return <div className="flex min-h-32 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>

  const currentOpportunity = opportunities.find((request) => request.id === composerRequestId)
    || myQuotes.find((entry) => entry.quote.logistics_request_id === composerRequestId)?.request

  return (
    <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="logistics-provider-workspace"><div className="max-w-[1280px]">
      <div className="border-b-2 border-slate-950 pb-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Provider workspace</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Shipping requests you can respond to</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Customers describe what needs moving. Build a transparent offer with the route, service mode and charge components you actually provide. Unknown charges stay unknown — do not hide them inside an “all-in” claim.</p></div>
      <div className="mt-4 flex gap-1" role="tablist">{([['opportunities', `Open requests${opportunities.length ? ` (${opportunities.length})` : ''}`], ['offers', `My offers${myQuotes.length ? ` (${myQuotes.length})` : ''}`]] as Array<[Tab, string]>).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm ${tab === value ? 'border-orange-500 font-semibold text-slate-950' : 'border-transparent text-slate-600'}`}>{label}</button>)}</div>
      {unreadable && <Alert className="mt-4 border-amber-200 bg-amber-50"><AlertDescription>Shipping opportunities could not be loaded. This is not a report that there are none.</AlertDescription></Alert>}
      {error && <Alert className="mt-4 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}

      {tab === 'opportunities' && <div className="mt-5 space-y-5">{!unreadable && opportunities.length === 0 && <div className="border border-dashed border-slate-300 p-7"><h2 className="font-bold text-slate-950">No open shipping requests</h2><p className="mt-1 text-sm text-slate-600">When participants publish requests matching the Trade OS logistics marketplace, they will appear here without exposing private contact information.</p></div>}{opportunities.map((request) => {
        // DESIGN.md §8.1 — unknown is never zero. `some()` on an EMPTY array returns false, so a
        // request with no cargo rows previously skipped the "unknown" branch and reduce() published
        // a confident "0.000 CBM estimated across the request" for cargo nobody had described.
        const items = request.items || []
        const hasItems = items.length > 0
        const unknownVolume = !hasItems || items.some((item) => !(Number(item.estimated_volume_cbm) > 0))
        const totalVolume = hasItems ? items.reduce((sum, item) => sum + Number(item.estimated_volume_cbm || 0), 0) : 0
        const cargoTitle = items[0]?.description || (hasItems ? 'Cargo described without a title' : 'Cargo details not recorded')
        return <article key={request.id} className="border border-slate-300 bg-white p-5" data-testid="logistics-opportunity"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{request.reference}</p><h2 className="mt-1 text-lg font-bold text-slate-950">{cargoTitle}</h2><p className="mt-1 text-sm text-slate-600">{formatRoute({ city: request.origin_city, country: request.origin_country }, { city: request.destination_city, country: request.destination_country })}</p><p className="mt-1 text-xs font-medium text-slate-700" data-testid="logistics-opportunity-service-preference">{SERVICE_PREFERENCE_LABELS[String(request.service_preference || 'flexible')] || 'Flexible — provider proposes the service'}</p></div><div className="text-right text-xs text-slate-500"><p>{request.quote_count || 0} submitted offer{request.quote_count === 1 ? '' : 's'}</p>{request.needed_by && <p>Needed by {String(request.needed_by).slice(0, 10)}</p>}</div></div>{hasItems ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <div key={item.id} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-900">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{labelCategory(item.cargo_category)} · {item.estimated_volume_cbm ? `${item.estimated_volume_cbm} CBM est.` : 'Volume unknown'} · {item.estimated_weight_kg ? `${item.estimated_weight_kg} kg est.` : 'Weight unknown'}</p></div>)}</div> : <p className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-slate-600" data-testid="logistics-opportunity-no-cargo">No cargo rows are recorded on this request. Ask the requester what needs moving before pricing it.</p>}{(() => {
          // Intake 2.0 — the facts that actually change a logistics price: whether there is an
          // inland collection leg, what kind of site it comes from, whether the vehicle runs (a
          // non-runner needs winching and cannot go RoRo), and what the customer declared is
          // inside. All of it is allow-listed by the projection; a field the projection withheld
          // is simply absent here, so this panel can never widen what providers see.
          const facts: Array<[string, string]> = []
          const push = (label: string, value?: string | null) => { if (value) facts.push([label, value]) }
          push('Collection', PICKUP_REQUIRED_LABELS[String(request.pickup_required || '')])
          push('Origin site', ORIGIN_SITE_LABELS[String(request.origin_site_type || '')])
          push('At destination', PROVIDER_OUTCOME_LABELS[String(request.destination_outcome || '')])
          push('Customer priority', PROVIDER_OBJECTIVE_LABELS[String(request.shipping_objective || '')])
          push('Timing', PROVIDER_TIMING_LABELS[String(request.timing_flexibility || '')])
          if (request.available_from) push('Cargo ready from', String(request.available_from).slice(0, 10))
          const handling = [...new Set(items.flatMap((i) => i.handling_flags || []))]
          const declared = [...new Set(items.flatMap((i) => i.content_declarations || []))]
          const running = items.map((i) => i.vehicle_running_state).filter(Boolean)
          const keys = items.map((i) => i.vehicle_keys_state).filter(Boolean)
          if (running.length) push('Vehicle state', [...new Set(running)].map((r) => RUNNING_LABELS[String(r)] || String(r)).join(', '))
          if (keys.length) push('Keys', [...new Set(keys)].map((k) => KEYS_LABELS[String(k)] || String(k)).join(', '))
          const packaging = [...new Set(items.map((i) => i.packaging_type).filter(Boolean))]
          if (packaging.length) push('Packaging', packaging.map((x) => humaniseCargo(String(x))).join(', '))
          const nature = [...new Set(items.map((i) => i.goods_nature).filter(Boolean))]
          if (nature.length) push('Goods', nature.map((x) => humaniseCargo(String(x))).join(', '))
          if (!facts.length && !handling.length && !declared.length) return null
          return <div className="mt-4 border-t border-slate-200 pt-4" data-testid="logistics-opportunity-brief">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">What the customer told us</p>
            {facts.length > 0 && <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">{facts.map(([label, value]) =>
              <div key={label} className="min-w-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{value}</dd></div>)}</dl>}
            {handling.length > 0 && <p className="mt-3 text-xs text-slate-700" data-testid="logistics-opportunity-handling">
              <span className="font-semibold">Handling:</span> {handling.map((f) => HANDLING_LABELS[String(f)] || humaniseCargo(String(f))).join(', ')}</p>}
            {declared.length > 0 && <p className="mt-1.5 text-xs text-slate-700" data-testid="logistics-opportunity-declarations">
              <span className="font-semibold">Customer declares inside:</span> {declared.map((f) => DECLARATION_LABELS[String(f)] || humaniseCargo(String(f))).join(', ')}
              {' '}<span className="italic text-slate-500">— customer-stated, confirm before carriage.</span></p>}
          </div>
        })()}<div className="mt-4 border-l-2 border-emerald-500 pl-3 text-xs text-slate-600"><strong>What CarUp can establish:</strong> route {formatRoute({ city: request.origin_city, country: request.origin_country }, { city: request.destination_city, country: request.destination_country })}; {!hasItems ? 'no cargo has been described yet, so no volume is recorded' : unknownVolume ? 'one or more cargo volumes are still unknown' : `${totalVolume.toFixed(3)} CBM estimated across the request`}. Cargo suitability and final measurements still require provider/carrier assessment.</div><div className="mt-4 flex flex-wrap gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => openComposer(request.id)}>Prepare offer</Button><Button variant="outline" className="rounded-none" onClick={() => void askQuestion(request.id)} disabled={busy}><MessageSquare className="mr-1.5 h-4 w-4" /> Ask a question</Button></div></article>
      })}</div>}

      {tab === 'offers' && <div className="mt-5 space-y-4">{!unreadable && myQuotes.length === 0 && <div className="border border-dashed border-slate-300 p-7"><h2 className="font-bold text-slate-950">No logistics offers yet</h2><p className="mt-1 text-sm text-slate-600">Prepare an offer from an open request. Drafts remain private until submitted.</p></div>}{myQuotes.map((entry) => <article key={entry.quote.id} className="border border-slate-300 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-950">{entry.request?.items?.[0]?.description || entry.request?.reference || 'Shipping request'}</p><p className="text-xs text-slate-500">{entry.quote.reference}</p><p className="mt-2 text-lg font-bold text-slate-950">{Number(entry.quote.total_amount).toLocaleString()} {entry.quote.currency}</p></div><span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{entry.quote.status.replace(/_/g, ' ')}</span></div><p className="mt-2 text-xs text-slate-600">{entry.quote.service_mode.replace(/_/g, ' ')} · freight {entry.quote.freight_amount == null ? 'not provided' : `${entry.quote.freight_amount} ${entry.quote.currency}`} · destination charges {entry.quote.destination_charges == null ? 'not provided' : `${entry.quote.destination_charges} ${entry.quote.currency}`}</p>{entry.quote.status === 'DRAFT' && <div className="mt-4 flex gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => editDraft(entry)} disabled={busy}>Edit offer</Button><Button variant="outline" className="rounded-none" disabled={busy} onClick={() => { if (busy) return; setBusy(true); setError(''); void api.submitQuote(entry.quote.id).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Offer could not be submitted')).finally(() => setBusy(false)) }}>Submit</Button></div>}{entry.quote.status === 'SUBMITTED' && <Button variant="outline" className="mt-4 rounded-none" disabled={busy} onClick={() => { if (busy) return; setBusy(true); setError(''); void api.withdrawQuote(entry.quote.id).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Offer could not be withdrawn')).finally(() => setBusy(false)) }}>Withdraw offer</Button>}</article>)}</div>}

      {composerRequestId && currentOpportunity && <div className="mt-7 border-t-2 border-slate-950 pt-6" data-testid="logistics-quote-composer">{stage === 'edit' ? <><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Prepare offer</p><h2 className="mt-1 text-xl font-bold text-slate-950">{currentOpportunity.items?.[0]?.description || currentOpportunity.reference}</h2><p className="mt-1 text-sm text-slate-600">State each known charge separately. The total is your stated offer total; CarUp will not describe it as “all-in” when components are unknown.</p></div><div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className={fieldLabel}>Service mode<select className={selectClass} value={serviceMode} onChange={(e) => setServiceMode(e.target.value as LogisticsQuoteInput['service_mode'])}>{SERVICE_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={`${fieldLabel} sm:col-span-2`}>CarUp sailing (optional)<select className={selectClass} value={containerId} onChange={(e) => setContainerId(e.target.value)}><option value="">No CarUp sailing attached</option>{myContainers.map((container) => <option key={String(container.id)} value={String(container.id)}>{[container.origin_city, container.origin_country].filter(Boolean).join(', ')} → {[container.destination_city, container.destination_country].filter(Boolean).join(', ')} · {String(container.container_type || 'container')} · departs {String(container.departure_date || '').slice(0, 10)}</option>)}</select><span className="mt-1 block text-[11px] normal-case tracking-normal text-slate-500">Only a container you coordinate / administer can be attached. The server re-checks this.</span></label><label className={fieldLabel}>Freight charge<Input className="mt-1 rounded-none" type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} /></label><label className={fieldLabel}>Handling<Input className="mt-1 rounded-none" type="number" min="0" value={handling} onChange={(e) => setHandling(e.target.value)} /></label><label className={fieldLabel}>Origin charges<Input className="mt-1 rounded-none" type="number" min="0" value={originCharges} onChange={(e) => setOriginCharges(e.target.value)} /></label><label className={fieldLabel}>Destination charges<Input className="mt-1 rounded-none" type="number" min="0" value={destinationCharges} onChange={(e) => setDestinationCharges(e.target.value)} /></label><label className={fieldLabel}>Documentation fees<Input className="mt-1 rounded-none" type="number" min="0" value={documentFees} onChange={(e) => setDocumentFees(e.target.value)} /></label><label className={fieldLabel}>Offer total *<div className="flex gap-2"><Input className="mt-1 min-w-0 rounded-none" type="number" min="0" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="logistics-offer-total" /><select className={`${selectChrome} w-24 shrink-0`} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="logistics-offer-currency">{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></div></label><label className={fieldLabel}>Transit days (stated)<Input className="mt-1 rounded-none" type="number" min="1" value={transitDays} onChange={(e) => setTransitDays(e.target.value)} /></label><label className={fieldLabel}>Valid until<Input className="mt-1 rounded-none" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label><label className={fieldLabel}>Pickup<select className={selectClass} value={pickup} onChange={(e) => setPickup(e.target.value as typeof pickup)}><option value="unknown">Not provided</option><option value="yes">Included</option><option value="no">Not included</option></select></label><label className={fieldLabel}>Destination delivery<select className={selectClass} value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="unknown">Not provided</option><option value="yes">Included</option><option value="no">Not included</option></select></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Included (comma separated)<Input className="mt-1 rounded-none" value={inclusions} onChange={(e) => setInclusions(e.target.value)} placeholder="e.g. export handling, port delivery" /></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Excluded (comma separated)<Input className="mt-1 rounded-none" value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="e.g. customs duty, Zimbabwe inland delivery" /></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Conditions<textarea className={selectClass} rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Conditions the customer needs to understand before choosing" /></label></div><ChargeComponentEditor components={components} onChange={setComponents} total={total} currency={currency} breakdownComplete={breakdownComplete} onBreakdownCompleteChange={setBreakdownComplete} /><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => { if (!(Number(total) > 0)) { setError('Enter an offer total before review.'); return } setError(''); setStage('review') }} data-testid="logistics-offer-review">Review offer</Button><Button variant="outline" className="rounded-none" onClick={() => void save(false)} disabled={busy}>Save draft</Button><Button variant="ghost" onClick={() => { setComposerRequestId(null); resetComposer() }}>Cancel</Button></div></> : <><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Review offer</p><h2 className="mt-1 text-xl font-bold text-slate-950">Exactly what the customer will compare</h2><div className="mt-5 grid gap-5 lg:grid-cols-[2fr_3fr]"><div className="border border-slate-300 bg-slate-50 p-5"><p className="text-xs uppercase tracking-wide text-slate-500">Provider</p><p className="font-semibold text-slate-950">{context?.organisation?.name || context?.organization_name || context?.user?.name || 'Logistics provider'}</p><p className="mt-4 text-xs uppercase tracking-wide text-slate-500">Service</p><p className="font-medium text-slate-900">{SERVICE_MODES.find(([value]) => value === serviceMode)?.[1]}</p><p className="mt-4 text-xs uppercase tracking-wide text-slate-500">Stated total</p><p className="text-2xl font-bold text-slate-950">{Number(total).toLocaleString()} {currency}</p></div><div className="border border-slate-300 bg-white p-5"><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase text-slate-500">Freight</dt><dd>{freight || 'Not provided'} {freight ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Handling</dt><dd>{handling || 'Not provided'} {handling ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Origin charges</dt><dd>{originCharges || 'Not provided'} {originCharges ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Destination charges</dt><dd>{destinationCharges || 'Not provided'} {destinationCharges ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Documentation</dt><dd>{documentFees || 'Not provided'} {documentFees ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Transit</dt><dd>{transitDays ? `${transitDays} days stated` : 'Not provided'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Valid until</dt><dd data-testid="logistics-review-valid-until">{validUntil || 'Not provided'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Pickup</dt><dd>{pickup === 'yes' ? 'Included' : pickup === 'no' ? 'Not included' : 'Not provided'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Delivery</dt><dd>{delivery === 'yes' ? 'Included' : delivery === 'no' ? 'Not included' : 'Not provided'}</dd></div></dl>{inclusions && <p className="mt-4 text-xs text-slate-600"><strong>Includes:</strong> {inclusions}</p>}{exclusions && <p className="text-xs text-slate-600"><strong>Excludes:</strong> {exclusions}</p>}{conditions && <p className="mt-2 text-xs text-slate-600"><strong>Conditions:</strong> {conditions}</p>}<ChargeComponentReview components={components} total={total} currency={currency} /></div></div><p className="mt-4 text-xs text-slate-500">Submitting makes this offer visible to the requester. It does not approve container space, customs, carrier acceptance or payment.</p><div className="mt-5 flex gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void save(true)} disabled={busy} data-testid="logistics-offer-submit">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Submit offer</Button><Button variant="outline" className="rounded-none" onClick={() => setStage('edit')}>Back to edit</Button></div></>}</div>}
      </div>
    </section>
  )
}
