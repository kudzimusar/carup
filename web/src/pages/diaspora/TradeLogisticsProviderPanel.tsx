import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useNavigate } from 'react-router-dom'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import type { DiasporaTradeContext } from '@/types'
import type { LogisticsMyQuote, LogisticsOpportunity, LogisticsQuoteInput } from '@/types/tradeLogistics'

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
      if (editingQuoteId) {
        await api.updateQuote(editingQuoteId, payload)
        if (submit) await api.submitQuote(editingQuoteId)
      } else {
        await api.createQuote(composerRequestId, { ...payload, submit })
      }
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
    <section className="mx-auto w-full max-w-[1280px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="logistics-provider-workspace">
      <div className="border-b-2 border-slate-950 pb-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Provider workspace</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Shipping requests you can respond to</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Customers describe what needs moving. Build a transparent offer with the route, service mode and charge components you actually provide. Unknown charges stay unknown — do not hide them inside an “all-in” claim.</p></div>
      <div className="mt-4 flex gap-1" role="tablist">{([['opportunities', `Open requests${opportunities.length ? ` (${opportunities.length})` : ''}`], ['offers', `My offers${myQuotes.length ? ` (${myQuotes.length})` : ''}`]] as Array<[Tab, string]>).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm ${tab === value ? 'border-orange-500 font-semibold text-slate-950' : 'border-transparent text-slate-600'}`}>{label}</button>)}</div>
      {unreadable && <Alert className="mt-4 border-amber-200 bg-amber-50"><AlertDescription>Shipping opportunities could not be loaded. This is not a report that there are none.</AlertDescription></Alert>}
      {error && <Alert className="mt-4 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}

      {tab === 'opportunities' && <div className="mt-5 space-y-5">{!unreadable && opportunities.length === 0 && <div className="border border-dashed border-slate-300 p-7"><h2 className="font-bold text-slate-950">No open shipping requests</h2><p className="mt-1 text-sm text-slate-600">When participants publish requests matching the Trade OS logistics marketplace, they will appear here without exposing private contact information.</p></div>}{opportunities.map((request) => {
        const totalVolume = request.items.reduce((sum, item) => sum + Number(item.estimated_volume_cbm || 0), 0)
        const unknownVolume = request.items.some((item) => !item.estimated_volume_cbm)
        return <article key={request.id} className="border border-slate-300 bg-white p-5" data-testid="logistics-opportunity"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{request.reference}</p><h2 className="mt-1 text-lg font-bold text-slate-950">{request.items[0]?.description || 'Shipping request'}</h2><p className="mt-1 text-sm text-slate-600">{[request.origin_city, request.origin_country].filter(Boolean).join(', ')} → {[request.destination_city, request.destination_country].filter(Boolean).join(', ')}</p></div><div className="text-right text-xs text-slate-500"><p>{request.quote_count || 0} submitted offer{request.quote_count === 1 ? '' : 's'}</p>{request.needed_by && <p>Needed by {String(request.needed_by).slice(0, 10)}</p>}</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{request.items.map((item) => <div key={item.id} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-900">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{labelCategory(item.cargo_category)} · {item.estimated_volume_cbm ? `${item.estimated_volume_cbm} CBM est.` : 'Volume unknown'} · {item.estimated_weight_kg ? `${item.estimated_weight_kg} kg est.` : 'Weight unknown'}</p></div>)}</div><div className="mt-4 border-l-2 border-emerald-500 pl-3 text-xs text-slate-600"><strong>What CarUp can establish:</strong> route {request.origin_country} → {request.destination_country}; {unknownVolume ? 'one or more cargo volumes are still unknown' : `${totalVolume.toFixed(3)} CBM estimated across the request`}. Cargo suitability and final measurements still require provider/carrier assessment.</div><div className="mt-4 flex flex-wrap gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => openComposer(request.id)}>Prepare offer</Button><Button variant="outline" className="rounded-none" onClick={() => void askQuestion(request.id)} disabled={busy}><MessageSquare className="mr-1.5 h-4 w-4" /> Ask a question</Button></div></article>
      })}</div>}

      {tab === 'offers' && <div className="mt-5 space-y-4">{myQuotes.length === 0 && <div className="border border-dashed border-slate-300 p-7"><h2 className="font-bold text-slate-950">No logistics offers yet</h2><p className="mt-1 text-sm text-slate-600">Prepare an offer from an open request. Drafts remain private until submitted.</p></div>}{myQuotes.map((entry) => <article key={entry.quote.id} className="border border-slate-300 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-950">{entry.request?.items?.[0]?.description || entry.request?.reference || 'Shipping request'}</p><p className="text-xs text-slate-500">{entry.quote.reference}</p><p className="mt-2 text-lg font-bold text-slate-950">{Number(entry.quote.total_amount).toLocaleString()} {entry.quote.currency}</p></div><span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{entry.quote.status.replace(/_/g, ' ')}</span></div><p className="mt-2 text-xs text-slate-600">{entry.quote.service_mode.replace(/_/g, ' ')} · freight {entry.quote.freight_amount == null ? 'not provided' : `${entry.quote.freight_amount} ${entry.quote.currency}`} · destination charges {entry.quote.destination_charges == null ? 'not provided' : `${entry.quote.destination_charges} ${entry.quote.currency}`}</p>{entry.quote.status === 'DRAFT' && <div className="mt-4 flex gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => editDraft(entry)}>Edit offer</Button><Button variant="outline" className="rounded-none" onClick={() => void api.submitQuote(entry.quote.id).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Offer could not be submitted'))}>Submit</Button></div>}{entry.quote.status === 'SUBMITTED' && <Button variant="outline" className="mt-4 rounded-none" onClick={() => void api.withdrawQuote(entry.quote.id).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Offer could not be withdrawn'))}>Withdraw offer</Button>}</article>)}</div>}

      {composerRequestId && currentOpportunity && <div className="mt-7 border-t-2 border-slate-950 pt-6" data-testid="logistics-quote-composer">{stage === 'edit' ? <><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Prepare offer</p><h2 className="mt-1 text-xl font-bold text-slate-950">{currentOpportunity.items?.[0]?.description || currentOpportunity.reference}</h2><p className="mt-1 text-sm text-slate-600">State each known charge separately. The total is your stated offer total; CarUp will not describe it as “all-in” when components are unknown.</p></div><div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className={fieldLabel}>Service mode<select className={selectClass} value={serviceMode} onChange={(e) => setServiceMode(e.target.value as LogisticsQuoteInput['service_mode'])}>{SERVICE_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={`${fieldLabel} sm:col-span-2`}>CarUp sailing (optional)<select className={selectClass} value={containerId} onChange={(e) => setContainerId(e.target.value)}><option value="">No CarUp sailing attached</option>{myContainers.map((container) => <option key={String(container.id)} value={String(container.id)}>{[container.origin_city, container.origin_country].filter(Boolean).join(', ')} → {[container.destination_city, container.destination_country].filter(Boolean).join(', ')} · {String(container.container_type || 'container')} · departs {String(container.departure_date || '').slice(0, 10)}</option>)}</select><span className="mt-1 block text-[11px] normal-case tracking-normal text-slate-500">Only a container you coordinate / administer can be attached. The server re-checks this.</span></label><label className={fieldLabel}>Freight charge<Input className="mt-1 rounded-none" type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} /></label><label className={fieldLabel}>Handling<Input className="mt-1 rounded-none" type="number" min="0" value={handling} onChange={(e) => setHandling(e.target.value)} /></label><label className={fieldLabel}>Origin charges<Input className="mt-1 rounded-none" type="number" min="0" value={originCharges} onChange={(e) => setOriginCharges(e.target.value)} /></label><label className={fieldLabel}>Destination charges<Input className="mt-1 rounded-none" type="number" min="0" value={destinationCharges} onChange={(e) => setDestinationCharges(e.target.value)} /></label><label className={fieldLabel}>Documentation fees<Input className="mt-1 rounded-none" type="number" min="0" value={documentFees} onChange={(e) => setDocumentFees(e.target.value)} /></label><label className={fieldLabel}>Offer total *<div className="flex gap-2"><Input className="mt-1 min-w-0 rounded-none" type="number" min="0" value={total} onChange={(e) => setTotal(e.target.value)} /><select className={`${selectChrome} w-24 shrink-0`} value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></div></label><label className={fieldLabel}>Transit days (stated)<Input className="mt-1 rounded-none" type="number" min="1" value={transitDays} onChange={(e) => setTransitDays(e.target.value)} /></label><label className={fieldLabel}>Valid until<Input className="mt-1 rounded-none" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label><label className={fieldLabel}>Pickup<select className={selectClass} value={pickup} onChange={(e) => setPickup(e.target.value as typeof pickup)}><option value="unknown">Not provided</option><option value="yes">Included</option><option value="no">Not included</option></select></label><label className={fieldLabel}>Destination delivery<select className={selectClass} value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="unknown">Not provided</option><option value="yes">Included</option><option value="no">Not included</option></select></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Included (comma separated)<Input className="mt-1 rounded-none" value={inclusions} onChange={(e) => setInclusions(e.target.value)} placeholder="e.g. export handling, port delivery" /></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Excluded (comma separated)<Input className="mt-1 rounded-none" value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="e.g. customs duty, Zimbabwe inland delivery" /></label><label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Conditions<textarea className={selectClass} rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Conditions the customer needs to understand before choosing" /></label></div><div className="mt-5 flex flex-wrap gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => { if (!(Number(total) > 0)) { setError('Enter an offer total before review.'); return } setError(''); setStage('review') }}>Review offer</Button><Button variant="outline" className="rounded-none" onClick={() => void save(false)} disabled={busy}>Save draft</Button><Button variant="ghost" onClick={() => { setComposerRequestId(null); resetComposer() }}>Cancel</Button></div></> : <><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Review offer</p><h2 className="mt-1 text-xl font-bold text-slate-950">Exactly what the customer will compare</h2><div className="mt-5 grid gap-5 lg:grid-cols-[2fr_3fr]"><div className="border border-slate-300 bg-slate-50 p-5"><p className="text-xs uppercase tracking-wide text-slate-500">Provider</p><p className="font-semibold text-slate-950">{context?.organisation?.name || context?.organization_name || context?.user?.name || 'Logistics provider'}</p><p className="mt-4 text-xs uppercase tracking-wide text-slate-500">Service</p><p className="font-medium text-slate-900">{SERVICE_MODES.find(([value]) => value === serviceMode)?.[1]}</p><p className="mt-4 text-xs uppercase tracking-wide text-slate-500">Stated total</p><p className="text-2xl font-bold text-slate-950">{Number(total).toLocaleString()} {currency}</p></div><div className="border border-slate-300 bg-white p-5"><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase text-slate-500">Freight</dt><dd>{freight || 'Not provided'} {freight ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Handling</dt><dd>{handling || 'Not provided'} {handling ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Origin charges</dt><dd>{originCharges || 'Not provided'} {originCharges ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Destination charges</dt><dd>{destinationCharges || 'Not provided'} {destinationCharges ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Documentation</dt><dd>{documentFees || 'Not provided'} {documentFees ? currency : ''}</dd></div><div><dt className="text-xs uppercase text-slate-500">Transit</dt><dd>{transitDays ? `${transitDays} days stated` : 'Not provided'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Pickup</dt><dd>{pickup === 'yes' ? 'Included' : pickup === 'no' ? 'Not included' : 'Not provided'}</dd></div><div><dt className="text-xs uppercase text-slate-500">Delivery</dt><dd>{delivery === 'yes' ? 'Included' : delivery === 'no' ? 'Not included' : 'Not provided'}</dd></div></dl>{inclusions && <p className="mt-4 text-xs text-slate-600"><strong>Includes:</strong> {inclusions}</p>}{exclusions && <p className="text-xs text-slate-600"><strong>Excludes:</strong> {exclusions}</p>}{conditions && <p className="mt-2 text-xs text-slate-600"><strong>Conditions:</strong> {conditions}</p>}</div></div><p className="mt-4 text-xs text-slate-500">Submitting makes this offer visible to the requester. It does not approve container space, customs, carrier acceptance or payment.</p><div className="mt-5 flex gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void save(true)} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Submit offer</Button><Button variant="outline" className="rounded-none" onClick={() => setStage('edit')}>Back to edit</Button></div></>}</div>}
    </section>
  )
}
