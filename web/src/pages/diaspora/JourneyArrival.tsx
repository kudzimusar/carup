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
import { useParams } from 'react-router-dom'
import { AlertTriangle, Anchor, FileText, Loader2, MapPin, Ship, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type Journey } from '@/hooks/useTradeLogisticsApi'
import {
  CONSIGNEE_KIND_UI,
  JOURNEY_STATE_UI,
  PROVENANCE_PART_UI,
  REFERENCE_IS_NOT_MOVEMENT,
  SECTION_UI,
  TABS,
  associationNote,
  authorityLabel,
  describeArrival,
  describeDeparture,
  exceptionText,
  lastRecordedUpdate,
  routeLabel,
  sectionKeyForTab,
  shortRef,
  sourceLabel,
  timelineLabel,
  vehicleTitle,
  when,
  type TabId,
} from './journeyDisplay'

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
        <h1 className="text-2xl font-bold text-slate-950">Journey &amp; arrival</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that nothing has happened.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const ui = JOURNEY_STATE_UI[data.state] ?? { label: 'Status unavailable', tone: 'border-slate-300 bg-slate-50 text-slate-700' }
  const route = routeLabel(data)
  const last = lastRecordedUpdate(data.timeline)
  const shipping = data.shipping
  const dates = shipping?.dates ?? null
  const departure = describeDeparture(dates)
  const arrival = describeArrival(dates)
  // Shown only where it adds something. An ambiguous or mismatched shipment already has its own alert,
  // and repeating the same sentence three times would bury the one that matters.
  const association = shipping?.association === 'container' ? associationNote('container') : null
  const orderRef = shortRef(data.subject.order_id || data.subject.id)
  const notComposed = (key: string) => {
    const section = data.sections?.[key]
    return !section || section.availability === 'not_yet_composed'
  }

  return (
    <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="journey-page">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-orange-600">Journey &amp; arrival · {orderRef}</p>
        <h1 className="mt-1 min-w-0 break-words text-2xl font-bold text-slate-950 sm:text-3xl" data-testid="journey-title">{vehicleTitle(data.asset)}</h1>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 break-words text-sm text-slate-600" data-testid="journey-route">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{route.text}
        </p>
      </header>

      <div className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="journey-state">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${ui.tone}`} data-testid="journey-badge">
          <Ship className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{ui.label}
        </span>
        <p className="mt-3 min-w-0 break-words text-sm text-slate-800" data-testid="journey-sentence">{data.sentence}</p>
        <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="journey-last-update">
          Last recorded update: {last.label}{last.at ? ` · ${when(last.at)}` : ''}
        </p>
        {association ? (
          <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="journey-association">{association}</p>
        ) : null}
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
                </div>
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

            {dates && notComposed('legs') ? (
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
                  <Row label="From" value={shipping.references.origin_port} />
                  <Row label="To" value={shipping.references.destination_port} />
                </dl>
                <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="journey-reference-note">{REFERENCE_IS_NOT_MOVEMENT}</p>
              </div>
            ) : null}

            {notComposed('actions') ? (
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
