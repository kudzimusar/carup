/**
 * T11-CAP-03 — Journey & Arrival: "What is happening to my vehicle?"
 *
 * A VIEW over the Journey projection. It records nothing and decides nothing, and it says only what
 * the projection was able to say. Three habits carry the whole page:
 *
 *   · a plan is worded as a plan, an estimate as an estimate, and only an observed date as an event
 *     (the wording is T11's own, reused, so both pages read identically);
 *   · a section the projection has not composed says so — it is never rendered as an empty list,
 *     because "not connected to this view" is not "nothing to report";
 *   · a field the service did not send is not rendered at all (chassis, engine, consignee), so a
 *     private value can never be shown by a layout that expected it.
 *
 * No other order's identity is ever shown, and the full order id is never printed — only a short
 * reference. The page uses CarUp's own design language.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, AlertTriangle, Anchor, ClipboardList, Clock, FileText, ListChecks, Loader2, MapPin, Ship, ShieldCheck, UserCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type Journey } from '@/hooks/useTradeLogisticsApi'
import {
  CARUP_IS_NOT_ZIMRA,
  GATEWAY_IS_NOT_DESTINATION,
  NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED,
  STEP_STATE_UI,
  STRENGTH_UI,
  describeAssessment,
  describeCustomsRate,
  describeHandoffs,
  when as customsWhen,
} from './customsDisplay'
import {
  CONSIGNEE_KIND_UI,
  CUSTOMS_UNSHOWN_FALLBACK,
  DOCUMENTS_NOT_APPLICABLE,
  DOCUMENTS_UNAVAILABLE_FALLBACK,
  DOCUMENTS_WITHHELD_FALLBACK,
  JOURNEY_STATE_UI,
  NO_ESTIMATE_REVISIONS,
  NO_ORDER_NO_DESTINATION,
  NO_STEPS_RECORDED,
  NOTHING_CONNECTED_YET,
  PORT_OF_DISCHARGE_IS_NOT_DESTINATION,
  PROVENANCE_PART_UI,
  REFERENCE_IS_NOT_MOVEMENT,
  SECTION_UI,
  STATISTICS_ARE_NOT_A_PREDICTION,
  TABS,
  actionBadge,
  againstFirstEstimateText,
  authorityLabel,
  customsPath,
  describeArrival,
  describeDeparture,
  destinationFacts,
  documentWorkspacePath,
  documentsSummaryLine,
  estimateChange,
  estimatedArrival,
  exceptionText,
  laneText,
  lastRecordedUpdate,
  legRoute,
  legTitle,
  plannedDeparture,
  revisionReason,
  revisionTitle,
  routeBasis,
  routeLabel,
  sectionKeyForTab,
  shortDate,
  shortRef,
  sourceLabel,
  timelineLabel,
  transitText,
  vehicleTitle,
  when,
  type TabId,
} from './journeyDisplay'
import { reportedProgressSummary } from './capDisplay'
import { CapWorkspaceChrome } from './chrome/CapWorkspaceChrome'
import { useOrderVehicle } from './chrome/useOrderVehicle'
import { CapNav } from './cap/CapNav'
import { CapSection, Unshown } from './cap/ui'
import { DestinationAgent } from './cap/DestinationAgent'
import { DocumentDelivery } from './cap/DocumentDelivery'
import { DocumentsList } from './cap/DocumentsList'
import { ImportantUpdate } from './cap/ImportantUpdate'
import { PaymentsSection } from './cap/PaymentsSection'
import { ProgressGroups } from './cap/ProgressGroups'
import { PurchasedVehicle } from './cap/PurchasedVehicle'
import { TransactionParties } from './cap/TransactionParties'

const card = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'
const eyebrow = 'text-xs font-semibold uppercase tracking-wide text-slate-500'

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  const missing = value === null || value === undefined || String(value).trim() === ''
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-sm ${missing ? 'text-slate-500' : 'text-slate-900'}`}>{missing ? 'Not recorded' : value}</dd>
    </div>
  )
}

export default function JourneyArrival() {
  const { subjectType = 'import_order', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { getJourney } = useTradeLogisticsApi()
  const [data, setData] = useState<Journey | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabId>('journey')
  // R3: the Vehicle Passport link is offered only when the order endpoint shows this viewer owns the vehicle.
  const orderVehicle = useOrderVehicle(data?.subject.order_id ?? null)

  const load = useCallback(async () => {
    try {
      const view = await getJourney(subjectType, subjectId)
      if (!view || typeof view !== 'object' || !view.state) throw new Error('This could not be read')
      setData(view)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This could not be read')
      setState('unreadable')
    }
  }, [getJourney, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectId) void load() }, [authLoading, subjectId, load])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600" data-testid="journey-spinner"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable' || !data) {
    return (
      <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="journey-unreadable">
        <CapWorkspaceChrome journey={null} vehicleVin={null} />
        <h1 className="mt-4 text-2xl font-bold text-slate-950">Journey &amp; arrival</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that nothing has happened.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const ui = JOURNEY_STATE_UI[data.state] ?? { label: 'Status unavailable', tone: 'border-slate-300 bg-slate-50 text-slate-700' }
  // When a sender has REPORTED progress, "shipment set up — nothing moving yet" alone would read as a journey that has not started. The sender's report
  // is headlined as the sender's, and CarUp's own movement sentence stays beneath it, verbatim.
  const reported = reportedProgressSummary(data)
  const route = routeLabel(data)
  const last = lastRecordedUpdate(data.timeline)
  const shipping = data.shipping
  const dates = shipping?.dates ?? null
  const departure = describeDeparture(dates)
  // The estimate: the latest accepted revision BESIDE the shipment record's own. An older service may
  // send none, and an ambiguous shipment has none to show.
  const eta = shipping?.eta && shipping.eta.availability === 'composed' ? shipping.eta : null
  const arrival = describeArrival(dates && eta?.current ? { ...dates, estimated_arrival: eta.current } : dates)
  const etaBasis = eta?.current ? (eta.basis === 'revision' ? 'Latest revised estimate' : 'From the shipment record') : null
  // A vehicle with no order has no order reference, and a vehicle identifier is not printed as one.
  const orderRef = data.subject.order_id || data.subject.type !== 'vehicle' ? shortRef(data.subject.order_id || data.subject.id) : null
  // CAP-06. A section is shown as what it says it is: composed, withheld from this viewer, unavailable
  // right now, or not applicable. Only a service that sends none of those falls back to the placeholder.
  const documents = data.sections?.documents
  const documentsShown = Boolean(documents) && documents?.availability !== 'not_yet_composed'
  // CAP-07. Customs is T12's, composed only for a viewer T12 admits. Every other state says what it is.
  const customs = data.sections?.customs
  const customsShown = Boolean(customs) && customs?.availability !== 'not_yet_composed'
  const agents = data.contacts?.agents
  // CAP-09. Statistics are an extension: a service that does not send them shows nothing, and says nothing about them.
  const stats = data.sections?.intelligence && data.sections.intelligence.availability === 'composed' ? data.sections.intelligence : null
  const destination = destinationFacts(data)
  const basis = routeBasis(data)
  const actions = data.sections?.actions && data.sections.actions.availability === 'composed' ? data.sections.actions : null
  // T11-CAP-LR01-R2. The sections that exist for this viewer, in the order the page draws them (the "On this page" links).
  const capNav = [
    data.important_update?.availability === 'composed' ? { id: 'cap-important-update', label: 'Update' } : null,
    data.asset && (data.asset.specifications || data.asset.media) ? { id: 'cap-vehicle', label: 'Vehicle' } : null,
    data.contacts?.parties ? { id: 'cap-parties', label: 'Parties' } : null,
    data.sections?.document_delivery ? { id: 'cap-delivery', label: 'Document delivery' } : null,
    shipping ? { id: 'cap-shipping', label: 'Shipping' } : null,
    documents && documentsShown && ['composed', 'withheld', 'unavailable'].includes(documents.availability) ? { id: 'cap-documents', label: 'Documents' } : null,
    data.sections?.progress ? { id: 'cap-progress', label: 'Progress' } : null,
    data.sections?.payments && data.sections.payments.availability !== 'not_yet_composed' ? { id: 'cap-payments', label: 'Payments' } : null,
  ].filter((item): item is { id: string; label: string } => item !== null)
  const workspacePath = documentWorkspacePath(data.subject.order_id ? { type: 'document_workspace', subject: { type: 'import_order', id: data.subject.order_id } } : null)

  return (
    <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="journey-page">
      <CapWorkspaceChrome journey={data} vehicleVin={orderVehicle?.vin ?? null} />
      <header className="mt-4 min-w-0">
        <p className="text-xs uppercase tracking-wide text-orange-600">Journey &amp; arrival{orderRef ? ` · ${orderRef}` : ''}</p>
        <h1 className="mt-1 min-w-0 break-words text-2xl font-bold text-slate-950 sm:text-3xl" data-testid="journey-title">{vehicleTitle(data.asset)}</h1>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 break-words text-sm text-slate-600" data-testid="journey-route">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {route.text}
            {basis ? <span className="text-slate-500" data-testid="journey-route-basis"> · {basis}</span> : null}
          </span>
        </p>
      </header>

      <div className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="journey-state">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${reported ? 'border-sky-300 bg-sky-50 text-sky-900' : ui.tone}`} data-testid="journey-badge">
          <Ship className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{reported ? reported.badge : ui.label}
        </span>
        <p className="mt-3 min-w-0 break-words text-sm text-slate-800" data-testid="journey-sentence">{reported ? reported.sentence : data.sentence}</p>
        {reported ? (
          <p className="mt-2 min-w-0 break-words text-sm text-slate-700" data-testid="journey-carup-record">
            <span className="font-semibold">CarUp&rsquo;s own movement record: </span>{ui.label}. {data.sentence}
          </p>
        ) : null}
        <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="journey-last-update">
          {reported ? 'Last update recorded by CarUp' : 'Last recorded update'}: {last.label}{last.at ? ` · ${when(last.at)}` : ''}
        </p>
      </div>

      <div className="mt-5 -mx-1 overflow-x-auto px-1" data-testid="journey-tabs-scroll">
        <div role="tablist" aria-label="Journey sections" className="flex min-w-max gap-1 border-b border-slate-200">
          {TABS.map((t) => {
            const selected = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`journey-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`journey-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${selected ? 'border-orange-500 text-orange-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div role="tabpanel" id={`journey-panel-${tab}`} aria-labelledby={`journey-tab-${tab}`} className="min-w-0">
        {tab === 'journey' ? (
          <>
            {data.exceptions.map((e) => (
              <Alert key={e.code} className="mt-5 border-amber-200 bg-amber-50" data-testid={`journey-exception-${e.code}`}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="min-w-0 break-words text-amber-900">
                  {exceptionText(e.code, e.note)}
                  {e.recorded_at ? <span className="text-amber-800"> · {when(e.recorded_at)}</span> : null}
                </AlertDescription>
              </Alert>
            ))}

            {!shipping ? (
              <p className="mt-5 min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid="journey-nothing-connected">
                {NOTHING_CONNECTED_YET}
              </p>
            ) : null}

            {data.candidates?.length ? (
              <div className={`mt-5 ${card}`} data-testid="journey-candidates">
                <h2 className={eyebrow}>Orders for this vehicle</h2>
                <ul className="mt-3 space-y-2">
                  {data.candidates.map((c) => (
                    <li key={c.order_id} className="min-w-0">
                      <Link to={`/diaspora/journey/import_order/${encodeURIComponent(c.order_id)}`} className="text-sm font-semibold text-orange-700 underline" data-testid={`journey-candidate-${c.order_id}`}>
                        Order {shortRef(c.order_id)}
                      </Link>
                      <span className="text-xs text-slate-600">{c.status ? ` · ${c.status.replace(/_/g, ' ').toLowerCase()}` : ''}{c.created_at ? ` · started ${when(c.created_at)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <CapNav items={capNav} />
            <ImportantUpdate update={data.important_update} />
            <PurchasedVehicle asset={data.asset} price={data.transaction?.purchase_price} />
            <TransactionParties parties={data.contacts?.parties} />
            <DocumentDelivery delivery={data.sections?.document_delivery} parties={data.contacts?.parties} />

            <div id="cap-shipping" className="scroll-mt-20" data-testid="cap-shipping">
              {shipping ? <h2 id="cap-shipping-heading" className="mt-6 text-base font-semibold text-slate-950">Shipping information</h2> : null}
              {dates ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className={card} data-testid="journey-departure">
                    <p className={`flex items-center gap-1.5 ${eyebrow}`}><Anchor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Leaving</p>
                    <p className={`mt-1 min-w-0 break-words text-base font-semibold ${departure.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="journey-departure-headline">{departure.headline}</p>
                    <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600" data-testid="journey-departure-detail">{departure.detail}</p>
                  </div>
                  <div className={card} data-testid="journey-arrival">
                    <p className={`flex items-center gap-1.5 ${eyebrow}`}><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Arriving</p>
                    <p className={`mt-1 min-w-0 break-words text-base font-semibold ${arrival.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="journey-arrival-headline">{arrival.headline}</p>
                    <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600" data-testid="journey-arrival-detail">{arrival.detail}</p>
                    {etaBasis ? <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid="journey-eta-basis">{etaBasis}</p> : null}
                    {eta && eta.current && eta.revision_count === 0 ? (
                      <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid="journey-eta-no-revisions">{NO_ESTIMATE_REVISIONS}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {eta && eta.revision_count > 0 ? (
                <div className={`mt-5 ${card}`} data-testid="journey-eta">
                  <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Estimate history</h2>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Row label="Current estimate" value={shortDate(eta.current)} />
                    <Row label="Original (shipment record)" value={shortDate(eta.original)} />
                  </dl>
                  {estimateChange(eta.change_days) ? (
                    <p className="mt-2 min-w-0 break-words text-sm text-slate-700">{estimateChange(eta.change_days)}</p>
                  ) : null}
                  <ol className="mt-3 space-y-2">
                    {eta.revisions.map((r, i) => (
                      <li key={`${r.observed_at}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
                        <p className="min-w-0 break-words text-sm font-semibold text-slate-900">
                          {revisionTitle(r)}{r.superseded ? <span className="font-normal text-slate-500"> · Superseded</span> : null}
                        </p>
                        <p className="min-w-0 break-words text-xs text-slate-600">Recorded {when(r.observed_at)} · {sourceLabel(r.source)}</p>
                        <p className="min-w-0 break-words text-xs text-slate-600">{revisionReason(r.reason)}</p>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 min-w-0 break-words text-xs text-slate-500">{eta.note}</p>
                </div>
              ) : null}

              {stats ? (
                <div className={`mt-5 ${card}`} data-testid="journey-statistics">
                  <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Statistics</h2>
                  {(() => {
                    const transit = transitText(stats.own.days_in_transit)
                    const versus = againstFirstEstimateText(stats.own.arrival_vs_first_estimate_days)
                    const lane = laneText(stats.lane)
                    return (
                      <>
                        <div className="mt-3 min-w-0" data-testid="journey-statistics-own">
                          <h3 className="text-xs font-semibold text-slate-700">This shipment</h3>
                          {transit ? <p className="mt-1 min-w-0 break-words text-sm text-slate-900" data-testid="journey-stat-transit">{transit}</p> : null}
                          {versus ? <p className="mt-1 min-w-0 break-words text-sm text-slate-900" data-testid="journey-stat-versus">{versus}</p> : null}
                          {!transit && !versus ? <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="journey-stat-own-none">{stats.own.days_in_transit.note}</p> : null}
                        </div>
                        <div className="mt-3 min-w-0" data-testid="journey-statistics-lane">
                          <h3 className="text-xs font-semibold text-slate-700">On this route</h3>
                          <p className="mt-1 min-w-0 break-words text-sm text-slate-900" data-testid="journey-stat-lane">{lane.headline}</p>
                          {lane.estimate ? <p className="mt-1 min-w-0 break-words text-sm text-slate-900" data-testid="journey-stat-lane-estimate">{lane.estimate}</p> : null}
                          {lane.detail ? <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid="journey-stat-lane-detail">{lane.detail}</p> : null}
                        </div>
                      </>
                    )
                  })()}
                  <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="journey-statistics-note">{STATISTICS_ARE_NOT_A_PREDICTION}</p>
                </div>
              ) : null}

              <div className={`mt-5 ${card}`}>
                <h2 className={eyebrow}>What has been recorded</h2>
                {data.timeline.length ? (
                  <ol className="mt-3 space-y-2" data-testid="journey-timeline">
                    {data.timeline.map((e, i) => (
                      <li key={`${e.kind}-${e.stage}-${e.event_time}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
                        <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{timelineLabel(e)}</p>
                        <p className="min-w-0 break-words text-xs text-slate-600">
                          {when(e.event_time)}{e.location ? ` · ${e.location}` : ''} · {sourceLabel(e.source)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="journey-timeline-empty">No movement has been recorded.</p>
                )}
              </div>

              {/* Declared vessel legs. Declared, never observed: a leg cannot say a vessel sailed. */}
              {shipping?.legs?.availability === 'composed' ? (
                <div className={`mt-5 ${card}`} data-testid="journey-legs">
                  <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><Ship className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Vessel and route</h2>
                  {shipping.legs.items.length ? (
                    <ol className="mt-3 space-y-3">
                      {shipping.legs.items.map((l) => (
                        <li key={l.sequence} className="min-w-0 border-l-2 border-slate-200 pl-3">
                          <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{legTitle(l)}</p>
                          <p className="min-w-0 break-words text-sm text-slate-700">{legRoute(l)}</p>
                          <p className="min-w-0 break-words text-xs text-slate-600">
                            {plannedDeparture(l.planned_departure)} · {estimatedArrival(l.estimated_arrival)}
                          </p>
                          {l.vessel_name && l.carrier_name ? <p className="min-w-0 break-words text-xs text-slate-600">Carrier: {l.carrier_name}</p> : null}
                          {l.imo || l.mmsi ? (
                            <p className="min-w-0 break-words text-xs text-slate-600">
                              {[l.imo ? `IMO ${l.imo}` : null, l.mmsi ? `MMSI ${l.mmsi}` : null].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="journey-legs-note">{shipping.legs.note}</p>
                </div>
              ) : dates && (!shipping?.legs || shipping.legs.availability === 'not_yet_composed') ? (
                // The API said legs are not connected, or sent nothing about them: say so rather than imply there are none.
                <p className="mt-5 min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid="journey-legs-note">
                  <strong className="font-semibold">{SECTION_UI.legs.title}: </strong>{SECTION_UI.legs.message}
                </p>
              ) : null}

              {shipping?.references ? (
                <div className={`mt-5 ${card}`} data-testid="journey-references">
                  <h2 className={eyebrow}>Shipping references</h2>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Row label="Carrier" value={shipping.references.carrier} />
                    <Row label="Tracking reference" value={shipping.references.tracking_reference} />
                    <Row label="Port of loading" value={shipping.references.origin_port} />
                    <Row label="Port of discharge" value={shipping.references.destination_port} />
                  </dl>
                  <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="journey-reference-note">{REFERENCE_IS_NOT_MOVEMENT}</p>
                  <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid="journey-port-note">{PORT_OF_DISCHARGE_IS_NOT_DESTINATION}</p>
                </div>
              ) : null}

            </div>

            {documents && documentsShown && (documents.availability === 'composed' || documents.availability === 'withheld' || documents.availability === 'unavailable') ? (
              <CapSection id="cap-documents" title="Documents" icon={<FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
                {documents.availability === 'composed' ? (
                  <>
                    <DocumentsList documents={documents} />
                    <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="cap-documents-disclaimer">{documents.disclaimer}</p>
                    {workspacePath ? <Link to={workspacePath} className="mt-3 inline-block text-sm font-semibold text-orange-700 underline" data-testid="cap-documents-link">Open the document workspace</Link> : null}
                  </>
                ) : (
                  <Unshown availability={documents.availability} note={documents.note} testId="cap-documents-unshown" />
                )}
              </CapSection>
            ) : null}

            <DestinationAgent journey={data} />
            <ProgressGroups progress={data.sections?.progress} />
            <PaymentsSection payments={data.sections?.payments} />

            {actions ? (
              <div className={`mt-5 ${card}`} data-testid="journey-actions">
                <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{SECTION_UI.actions.title}</h2>
                {actions.items.length ? (
                  <ul className="mt-3 space-y-3" data-testid="journey-actions-list">
                    {actions.items.map((a, i) => {
                      const docPath = documentWorkspacePath(a.link)
                      const path = docPath ?? customsPath(a.link)
                      return (
                        <li key={`${a.code}-${i}`} className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid={`journey-action-${a.code}`}>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${a.kind === 'YOUR_ACTION' ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-300 bg-slate-50 text-slate-800'}`}>{actionBadge(a)}</span>
                          <p className="mt-1.5 min-w-0 break-words text-sm text-slate-800">{a.text}</p>
                          {path ? <Link to={path} className="mt-1 inline-block text-sm font-semibold text-orange-700 underline">{docPath ? 'Open the document workspace' : 'Open the customs page'}</Link> : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="journey-actions-empty">{NO_STEPS_RECORDED}</p>
                )}
                <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="journey-actions-caveat">{actions.note}</p>
              </div>
            ) : data.sections?.actions?.availability !== 'not_applicable' ? (
              // Not composed, not sent, or a state this page does not know: never an empty list.
              <p className="mt-5 min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid="journey-actions-note">
                <strong className="font-semibold">{SECTION_UI.actions.title}: </strong>{SECTION_UI.actions.message}
              </p>
            ) : null}

            <div className={`mt-5 ${card}`} data-testid="journey-provenance">
              <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Where this comes from</h2>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(PROVENANCE_PART_UI).filter(([key]) => data.provenance?.[key]).map(([key, name]) => (
                  <Row key={key} label={name} value={authorityLabel(data.provenance[key].authority)} />
                ))}
              </dl>
              <p className="mt-2 min-w-0 break-words text-xs text-slate-500">
                Read {data.generated_at ? when(data.generated_at) : 'just now'}. Each part is read from the record that owns it; nothing is stored here.
              </p>
            </div>
          </>
        ) : null}

        {tab === 'documents' && documents && documentsShown ? (
          <div className="mt-5 space-y-5" data-testid="journey-documents">
            {documents.availability === 'composed' ? (
              <div className={card}>
                <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Shipping documents</h2>
                {documentsSummaryLine(documents.summary) ? (
                  <p className="mt-2 min-w-0 break-words text-sm text-slate-700" data-testid="journey-documents-summary">{documentsSummaryLine(documents.summary)}</p>
                ) : null}
                <DocumentsList documents={documents} />
                <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="journey-documents-disclaimer">{documents.disclaimer}</p>
                {workspacePath ? <Link to={workspacePath} className="mt-3 inline-block text-sm font-semibold text-orange-700 underline" data-testid="journey-documents-link">Open the document workspace</Link> : null}
              </div>
            ) : documents.availability === 'withheld' ? (
              <Alert className="border-slate-300 bg-slate-50" data-testid="journey-documents-withheld">
                <AlertDescription className="min-w-0 break-words text-slate-800">{documents.note || DOCUMENTS_WITHHELD_FALLBACK}</AlertDescription>
              </Alert>
            ) : documents.availability === 'unavailable' ? (
              <Alert className="border-amber-200 bg-amber-50" data-testid="journey-documents-unavailable">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="min-w-0 break-words text-amber-900">{documents.note || DOCUMENTS_UNAVAILABLE_FALLBACK}</AlertDescription>
              </Alert>
            ) : documents.availability === 'not_applicable' ? (
              <p className="min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid="journey-documents-not-applicable">{DOCUMENTS_NOT_APPLICABLE}</p>
            ) : (
              // A state this page does not know is not "no documents": say they could not be shown.
              <Alert className="border-amber-200 bg-amber-50" data-testid="journey-documents-unavailable">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="min-w-0 break-words text-amber-900">{DOCUMENTS_UNAVAILABLE_FALLBACK}</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        {tab === 'customs' && customs && customsShown ? (
          <div className="mt-5 space-y-5" data-testid="journey-customs">
            {/* The destination is a fact about the order; the port of discharge is a fact about the shipment.
                Neither is customs, and neither is the other — so they are shown for every viewer, apart. */}
            <div className={card} data-testid="journey-destination">
              <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Where it is going</h2>
              {data.transaction ? (
                <>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {destination.showPort ? <Row label="Port of discharge (shipment record)" value={destination.port} /> : null}
                    <Row label="Destination (on the order)" value={destination.place} />
                  </dl>
                  <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="journey-destination-note">{PORT_OF_DISCHARGE_IS_NOT_DESTINATION}</p>
                </>
              ) : (
                <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="journey-destination-no-order">{NO_ORDER_NO_DESTINATION}</p>
              )}
            </div>

            {customs.availability === 'composed' ? (
              <>
                <div className={card} data-testid="journey-customs-status">
                  <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Customs</h2>
                  <p className="mt-2 min-w-0 break-words text-base text-slate-900" data-testid="journey-customs-sentence">{customs.sentence}</p>
                  <p className="mt-1 min-w-0 break-words text-sm font-medium text-slate-900" data-testid="journey-customs-next">{customs.next_action}</p>
                  {customs.reference ? <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid="journey-customs-reference">Customs case {customs.reference}</p> : null}
                </div>

                {agents && agents.availability === 'composed' ? (
                  <div className={card} data-testid="journey-customs-agent">
                    <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Who is handling clearance</h2>
                    {agents.items.length ? (
                      <ul className="mt-3 space-y-2">
                        {agents.items.map((a, i) => (
                          <li key={`${a.display_name}-${i}`} className="min-w-0">
                            <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="journey-customs-agent-name">{a.display_name}</p>
                            <p className="min-w-0 break-words text-xs text-slate-500">{a.role}</p>
                            {a.note ? <p className="mt-1 min-w-0 break-words text-sm text-slate-600">{a.note}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="journey-customs-no-agent">{agents.note}</p>
                    )}
                  </div>
                ) : null}

                {(() => {
                  const assessment = describeAssessment(customs.assessment)
                  const rate = describeCustomsRate(customs.assessment)
                  return (
                    <div className={card} data-testid="journey-customs-assessment">
                      <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Duty and tax</h2>
                      <p className="mt-2 min-w-0 break-words text-xl font-semibold text-slate-900" data-testid="journey-customs-amount">{assessment.amount}</p>
                      <p className="mt-1 min-w-0 break-words text-sm text-slate-600">{assessment.detail}</p>
                      <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="journey-customs-rate">{rate.headline}</p>
                      <p className="mt-1 min-w-0 break-words text-xs text-slate-500">{rate.detail}</p>
                    </div>
                  )
                })()}

                {customs.payment ? (
                  <div className={card} data-testid="journey-customs-payment">
                    <h2 className={eyebrow}>Payment</h2>
                    <p className="mt-2 min-w-0 break-words text-base font-semibold text-slate-900">{customs.payment.headline}</p>
                    <p className="mt-1 min-w-0 break-words text-sm text-slate-600">{customs.payment.detail}</p>
                  </div>
                ) : null}

                {customs.release ? (
                  <div className={card} data-testid="journey-customs-release">
                    <h2 className={eyebrow}>Release</h2>
                    <p className="mt-2 min-w-0 break-words text-base font-semibold text-slate-900">{customs.release.headline}</p>
                    <p className="mt-1 min-w-0 break-words text-sm text-slate-600">{customs.release.detail}</p>
                  </div>
                ) : null}

                {customs.handoffs ? (
                  <div className={card} data-testid="journey-customs-handoffs">
                    <h2 className={eyebrow}>Where your cargo has got to</h2>
                    <ul className="mt-3 space-y-2">
                      {describeHandoffs(customs.handoffs).map((h) => (
                        <li key={h.key} className="min-w-0 border-l-2 border-slate-200 pl-3" data-testid={`journey-customs-handoff-${h.key}`}>
                          <p className="min-w-0 break-words text-sm font-medium text-slate-900">{h.label}</p>
                          <p className="min-w-0 break-words text-xs text-slate-600">{h.value}</p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 min-w-0 break-words text-xs text-slate-600" data-testid="journey-customs-handoff-note">{customs.handoffs.note || GATEWAY_IS_NOT_DESTINATION}</p>
                  </div>
                ) : null}

                {customs.checklist ? (
                  <div className={card} data-testid="journey-customs-checklist">
                    <h2 className={eyebrow}>What is still needed</h2>
                    <ul className="mt-3 space-y-2">
                      {customs.checklist.map((step) => (
                        <li key={step.key} className="min-w-0" data-testid={`journey-customs-step-${step.key}`}>
                          <p className="min-w-0 break-words text-sm font-medium text-slate-900">
                            {step.label} — <span className="font-normal text-slate-600">{STEP_STATE_UI[step.state]?.label ?? 'Status not recognised'}</span>
                          </p>
                          {step.needed ? <p className="min-w-0 break-words text-xs text-slate-600">{step.needed}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {customs.timeline.length ? (
                  <div className={card} data-testid="journey-customs-timeline">
                    <h2 className={eyebrow}>What has happened</h2>
                    <ol className="mt-3 space-y-3">
                      {customs.timeline.map((e, i) => (
                        <li key={`${e.event_type}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
                          <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{e.sentence}</p>
                          <p className="min-w-0 break-words text-xs text-slate-600">{STRENGTH_UI[e.strength]?.label ?? 'Source not stated'}</p>
                          <p className="min-w-0 break-words text-xs text-slate-500">{customsWhen(e.event_time)}{e.location ? ` · ${e.location}` : ''}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <p className="min-w-0 break-words text-xs text-slate-600" data-testid="journey-customs-disclaimer">{customs.note || CARUP_IS_NOT_ZIMRA}</p>
                <p className="min-w-0 break-words text-xs text-slate-600" data-testid="journey-customs-unknown-note">{customs.unknown_note || NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED}</p>
                {customsPath(customs.link) ? (
                  <Link to={customsPath(customs.link) as string} className="inline-block text-sm font-semibold text-orange-700 underline" data-testid="journey-customs-link">Open the full customs page</Link>
                ) : null}
              </>
            ) : customs.availability === 'not_applicable' && !data.transaction ? null : customs.availability === 'withheld' || customs.availability === 'not_applicable' ? (
              <p className="min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid={`journey-customs-${customs.availability}`}>
                {('note' in customs && customs.note) || CUSTOMS_UNSHOWN_FALLBACK}
              </p>
            ) : (
              // unavailable, ambiguous, disagrees — or a state this page does not know. Each says why; none is "no customs".
              <Alert className="border-amber-200 bg-amber-50" data-testid={`journey-customs-${customs.availability === 'unavailable' || customs.availability === 'ambiguous' || customs.availability === 'disagrees' ? customs.availability : 'unshown'}`}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="min-w-0 break-words text-amber-900">{('note' in customs && customs.note) || CUSTOMS_UNSHOWN_FALLBACK}</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        {tab === 'vehicle' ? (
          <div className="mt-5 space-y-5">
            <div className={card} data-testid="journey-vehicle">
              <h2 className={eyebrow}>Vehicle</h2>
              {data.asset ? (
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Row label="Make" value={data.asset.make} />
                  <Row label="Model" value={data.asset.model} />
                  <Row label="Year" value={data.asset.year} />
                  <Row label="Colour" value={data.asset.color} />
                  <Row label="Mileage" value={typeof data.asset.mileage === 'number' ? `${data.asset.mileage.toLocaleString()} km` : null} />
                  {'chassis_number' in data.asset ? <Row label="Chassis number" value={data.asset.chassis_number} /> : null}
                  {'engine_number' in data.asset ? <Row label="Engine number" value={data.asset.engine_number} /> : null}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-slate-700">No vehicle details are recorded.</p>
              )}
              <p className="mt-2 min-w-0 break-words text-xs text-slate-500">
                {data.asset?.source === 'vehicles' ? 'Read from the vehicle record.' : 'No vehicle record is linked to this order yet.'}
              </p>
            </div>

            {data.contacts?.consignee ? (
              <div className={card} data-testid="journey-consignee">
                <h2 className={`flex items-center gap-1.5 ${eyebrow}`}><FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Consignee</h2>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Row label="Consignee is" value={data.contacts.consignee.kind ? (CONSIGNEE_KIND_UI[data.contacts.consignee.kind] ?? null) : null} />
                  <Row label="Name" value={data.contacts.consignee.name} />
                  <Row label="Phone" value={data.contacts.consignee.phone} />
                </dl>
                <p className="mt-2 min-w-0 break-words text-xs text-slate-500">
                  {data.viewer.kind === 'OWNER'
                    ? 'Only you can see this.'
                    : 'Private — visible to the order owner and platform administrators.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {(() => {
          const key = sectionKeyForTab(tab)
          if (!key) return null
          if (key === 'documents' && documentsShown) return null
          if (key === 'customs' && customsShown) return null
          const ui2 = SECTION_UI[key]
          return (
            <p className="mt-5 min-w-0 break-words rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" data-testid="journey-section-note">
              <strong className="font-semibold">{ui2.title}: </strong>{ui2.message}
            </p>
          )
        })()}
      </div>

      <p className="mt-6 min-w-0 break-words text-xs text-slate-500" data-testid="journey-disclaimer">{data.note}</p>
    </section>
  )
}
