/**
 * Trade OS T11.3 — "Where is my cargo?", from the customer's side.
 *
 * The whole page is built around refusing four collapses, each of which is how a tracking page
 * quietly starts lying:
 *
 *   · a **planned** departure shown as a departure. The dangerous case is a planned date in the
 *     past with nothing observed — the ship was *meant* to have left, and saying "departed" there
 *     invents the event;
 *   · an **ETA** shown as an arrival. Same shape, and more tempting, because a customer looking at a
 *     past estimate will assume it arrived;
 *   · a **carrier reference** shown as movement. A booking number means paperwork exists;
 *   · a **customs hold** shown as a customs decision. T11 knows where the goods are stuck. What
 *     customs decided is T12's, and this page says so rather than guessing.
 *
 * And the one inherited from T10, at the moment it matters most: **loaded is not sailed.**
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Anchor, Loader2, MapPin, Package, Ship } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type MyTracking } from '@/hooks/useTradeLogisticsApi'
import {
  CUSTOMS_IS_ELSEWHERE,
  REFERENCE_IS_NOT_MOVEMENT,
  STAGE_UI,
  TRACKING_STATE_UI,
  describeArrival,
  describeDeparture,
  shortRef,
  when,
} from './trackingDisplay'
import { LEFT_BEHIND_UI } from './loadingDisplay'

export default function MyShipmentTracking() {
  const { subjectType = 'cargo_reservation', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { getMyTracking } = useTradeLogisticsApi()
  const [data, setData] = useState<MyTracking | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const view = await getMyTracking(subjectType, subjectId)
      if (!view || typeof view !== 'object' || !view.state) throw new Error('This could not be read')
      setData(view)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This could not be read')
      setState('unreadable')
    }
  }, [getMyTracking, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectId) void load() }, [authLoading, subjectId, load])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600" data-testid="tracking-spinner"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable' || !data) {
    return (
      <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="tracking-unreadable">
        <h1 className="text-2xl font-bold text-slate-950">Where your cargo is</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that nothing has happened.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const ui = TRACKING_STATE_UI[data.state]
  const departure = describeDeparture(data.dates)
  const arrival = describeArrival(data.dates)

  return (
    <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="my-shipment-tracking">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-orange-600">Container booking · {shortRef(data.subject.id)}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">Where your cargo is</h1>
      </header>

      <div className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="tracking-state">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${ui?.tone}`} data-testid="tracking-badge">
          <Ship className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{ui?.label}
        </span>
        <p className="mt-3 min-w-0 break-words text-sm text-slate-800" data-testid="tracking-sentence">{data.sentence}</p>

        {data.state === 'LEFT_BEHIND' ? (
          <Alert className="mt-3 border-amber-200 bg-amber-50" data-testid="tracking-left-behind">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="min-w-0 break-words text-amber-900">
              <strong className="font-semibold">Why: </strong>
              {LEFT_BEHIND_UI[data.left_behind_reason || ''] || 'The organiser has not given a reason.'}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {/* ── Departure and arrival, each stated as plan-or-fact ── */}
      {data.dates ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" data-testid="tracking-departure">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Anchor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Leaving
            </p>
            <p className={`mt-1 min-w-0 break-words text-base font-semibold ${departure.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="tracking-departure-headline">
              {departure.headline}
            </p>
            {/* The planned date is shown, and shown AS a plan. */}
            <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600" data-testid="tracking-departure-detail">{departure.detail}</p>
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" data-testid="tracking-arrival">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Arriving
            </p>
            <p className={`mt-1 min-w-0 break-words text-base font-semibold ${arrival.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="tracking-arrival-headline">
              {arrival.headline}
            </p>
            <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600" data-testid="tracking-arrival-detail">{arrival.detail}</p>
          </div>
        </div>
      ) : null}

      {/* ── An exception, without a customs verdict ── */}
      {data.exception ? (
        <Alert className="mt-5 border-amber-200 bg-amber-50" data-testid="tracking-exception">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="min-w-0 break-words text-amber-900">
            <strong className="font-semibold">{STAGE_UI[data.exception.stage] || data.exception.stage}</strong>
            {data.exception.recorded_at ? <span className="text-amber-800"> · {when(data.exception.recorded_at)}</span> : null}
            {/* T11 knows the goods are held. What customs decided is not knowable here. */}
            <span className="mt-1 block text-xs text-amber-800" data-testid="tracking-exception-note">{data.exception.note}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ── The journey so far ── */}
      {data.timeline.length ? (
        <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="tracking-timeline">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What has happened</h2>
          <ol className="mt-3 space-y-2">
            {data.timeline.map((e, i) => (
              <li key={`${e.stage}-${e.event_time}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
                <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{STAGE_UI[e.stage] || e.stage}</p>
                <p className="min-w-0 break-words text-xs text-slate-600">
                  {when(e.event_time)}
                  {/* Unknown stays unknown — no port is inferred from a stage name. */}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* ── References, labelled as paperwork ── */}
      {data.references ? (
        <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="tracking-references">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shipping references</h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {([['Carrier', data.references.carrier], ['Tracking reference', data.references.tracking_reference],
               ['From', data.references.origin_port], ['To', data.references.destination_port]] as Array<[string, string | null]>)
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="min-w-0 break-words text-sm text-slate-900">{value || 'Not recorded'}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="tracking-reference-note">{REFERENCE_IS_NOT_MOVEMENT}</p>
        </div>
      ) : null}

      <Link
        to={`/diaspora/cargo-loading/${encodeURIComponent(data.subject.type)}/${encodeURIComponent(data.subject.id)}`}
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
        data-testid="tracking-loading-link"
      >
        <Package className="h-4 w-4 shrink-0" aria-hidden="true" />Whether your cargo was loaded
      </Link>

      <p className="mt-6 min-w-0 break-words text-xs text-slate-500" data-testid="tracking-disclaimer">
        {data.note || CUSTOMS_IS_ELSEWHERE}
      </p>
    </section>
  )
}
