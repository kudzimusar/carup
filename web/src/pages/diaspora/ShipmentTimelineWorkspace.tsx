/**
 * Trade OS T11.2 — the operator's shipment timeline.
 *
 * The screen is organised around one distinction, because it is the one the database column names
 * hide: **a plan, an estimate, and an observed fact are three different things.** `departure_date`
 * and `estimated_arrival_date` sit next to each other in the schema and read alike; on this page
 * they are in separate panels with different words, and the recording form says which one it writes.
 *
 * The timeline below them is append-only in the database. That is stated on the page rather than
 * left as a surprise, because an operator who expects to be able to edit a mistake needs to know
 * the correction is a new event before they make one.
 *
 * What this screen will never offer: a customs decision. It can record that goods are held — where
 * they are — and nothing about what customs concluded. That belongs to T12 and does not exist yet.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Anchor, Container, Loader2, MapPin, Ship } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type ShipmentOperatorView } from '@/hooks/useTradeLogisticsApi'
import {
  CUSTOMS_IS_ELSEWHERE,
  REFERENCE_IS_NOT_MOVEMENT,
  STAGE_UI,
  describeArrival,
  describeDeparture,
  when,
} from './trackingDisplay'

/**
 * The stages an operator may record here.
 *
 * `RELEASED` and `COMPLETED` are deliberately absent. They are reachable in the underlying enum, but
 * on the purchase's own ladder `RELEASED` sits after duty paid — so offering them as buttons would
 * invite an operator to assert a customs outcome from a movement screen. T12 owns those.
 */
const RECORDABLE_STAGES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'BOOKED', label: 'Booked with the carrier', hint: 'The space is confirmed. Nothing has moved.' },
  { value: 'LOADING', label: 'Being loaded', hint: 'Loading onto the vessel has started.' },
  { value: 'IN_TRANSIT', label: 'It has left', hint: 'This records an ACTUAL departure and stamps the departure time.' },
  { value: 'ARRIVED', label: 'It has arrived', hint: 'This records an ACTUAL arrival and stamps the arrival time.' },
  { value: 'CUSTOMS_HOLD', label: 'Held at customs', hint: 'Where the goods are. This says nothing about what customs decided.' },
  { value: 'EXCEPTION', label: 'Something else happened', hint: 'Anything that affects the shipment without moving it.' },
]

function Panel({ title, icon: Icon, children, testId }: {
  title: string; icon: typeof Ship; children: React.ReactNode; testId?: string
}) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid={testId}>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{title}
      </h2>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  )
}

export default function ShipmentTimelineWorkspace() {
  const { loading: authLoading } = useAuth()
  const api = useTradeLogisticsApi()
  const [shipmentId, setShipmentId] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [data, setData] = useState<ShipmentOperatorView | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'unreadable'>('idle')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (id: string) => {
    setPhase('loading')
    try {
      const view = await api.getShipmentOperatorView(id)
      if (!view || !view.shipment || !Array.isArray(view.timeline)) throw new Error('This shipment could not be read')
      setData(view)
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This shipment could not be read')
      setPhase('unreadable')
    }
  }, [api])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && submitted) void load(submitted) }, [authLoading, submitted, load])

  const record = useCallback(async (payload: { stage: string; notes?: string | null; event_time?: string | null }) => {
    setBusy(true); setActionError(''); setNotice('')
    try {
      await api.recordShipmentStage(submitted, payload)
      setNotice('Recorded.')
      await load(submitted)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That could not be recorded')
    } finally {
      setBusy(false)
    }
  }, [api, submitted, load])

  if (authLoading) {
    return <div className="flex min-h-48 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  const departure = data ? describeDeparture(data.dates) : null
  const arrival = data ? describeArrival(data.dates) : null

  return (
    <section className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="shipment-timeline-workspace">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Shipment movement</h1>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          What was planned, what was estimated, and what has actually been observed.
        </p>
      </header>

      <form
        className="mt-5 flex min-w-0 flex-col gap-2 sm:flex-row"
        data-testid="shipment-form"
        onSubmit={(e) => { e.preventDefault(); setSubmitted(shipmentId.trim()); setNotice(''); setActionError('') }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="shipment-id" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment</Label>
          <Input id="shipment-id" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="Shipment id" className="mt-1" data-testid="shipment-input" />
        </div>
        <Button type="submit" className="shrink-0 self-end" disabled={!shipmentId.trim()} data-testid="shipment-submit">Open</Button>
      </form>

      {notice ? <Alert className="mt-4 border-emerald-200 bg-emerald-50" data-testid="shipment-notice"><AlertDescription className="text-emerald-900">{notice}</AlertDescription></Alert> : null}
      {actionError ? <Alert className="mt-4 border-red-200 bg-red-50" data-testid="shipment-error"><AlertDescription className="min-w-0 break-words text-red-900">{actionError}</AlertDescription></Alert> : null}

      {phase === 'loading' ? <div className="mt-8 flex justify-center text-orange-600" data-testid="shipment-loading"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}

      {phase === 'unreadable' ? (
        <Alert className="mt-6 border-amber-200 bg-amber-50" data-testid="shipment-unreadable">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that nothing has happened to it.
          </AlertDescription>
        </Alert>
      ) : null}

      {phase === 'ready' && data ? (
        <div className="mt-6 space-y-5">
          <Panel title="This shipment" icon={Ship} testId="shipment-identity">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <span className="min-w-0 break-all font-mono text-xs text-slate-700">{data.shipment.reference}</span>
              <span className="text-slate-600">Stage: <span className="font-semibold text-slate-900" data-testid="shipment-stage">{STAGE_UI[data.shipment.stage] || data.shipment.stage}</span></span>
            </div>
          </Panel>

          {/* ── Where it came from ── */}
          {data.load ? (
            <Panel title="What is inside it" icon={Container} testId="shipment-load">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-slate-700">
                <span className="min-w-0 break-all font-mono text-xs">{data.load.reference}</span>
                <span data-testid="shipment-loaded-lines">{data.load.loaded_lines} consignment(s) loaded</span>
                {/* Left-behind cargo stays attached to the load and is NOT travelling. Both numbers
                    are shown so the operator can see the difference. */}
                <span className="text-amber-700" data-testid="shipment-left-behind-lines">{data.load.left_behind_lines} left behind — not travelling</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Loading completed {when(data.load.completed_at)}
                {data.load.actual_loaded_volume_cbm !== null ? ` · ${data.load.actual_loaded_volume_cbm.toFixed(3)} CBM recorded as loaded` : ' · loaded volume not recorded'}
              </p>
            </Panel>
          ) : null}

          {/* ── Plan vs observed, kept apart ── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Leaving" icon={Anchor} testId="shipment-departure">
              <p className={`min-w-0 break-words text-base font-semibold ${departure?.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="shipment-departure-headline">
                {departure?.headline}
              </p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="shipment-departure-detail">{departure?.detail}</p>
            </Panel>
            <Panel title="Arriving" icon={MapPin} testId="shipment-arrival">
              <p className={`min-w-0 break-words text-base font-semibold ${arrival?.observed ? 'text-slate-900' : 'text-slate-700'}`} data-testid="shipment-arrival-headline">
                {arrival?.headline}
              </p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="shipment-arrival-detail">{arrival?.detail}</p>
            </Panel>
          </div>

          {/* ── Recording an observation ── */}
          <Panel title="Record what you have observed" icon={Ship} testId="shipment-record">
            <StageForm busy={busy} onRecord={record} />
          </Panel>

          {/* ── The timeline ── */}
          <Panel title="What has happened" icon={MapPin} testId="shipment-timeline">
            {!data.timeline.length ? (
              <p className="text-sm text-slate-600">Nothing has been recorded about this shipment moving.</p>
            ) : (
              <ol className="space-y-3">
                {data.timeline.map((e) => (
                  <li key={e.id} className="min-w-0 border-l-2 border-slate-200 pl-3">
                    <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{STAGE_UI[e.stage] || e.stage}</p>
                    <p className="min-w-0 break-words text-xs text-slate-600">
                      {when(e.event_time)}{e.location ? ` · ${e.location}` : ''}
                    </p>
                    {e.notes ? <p className="mt-0.5 min-w-0 break-words text-xs text-slate-700">{e.notes}</p> : null}
                    <p className="mt-0.5 min-w-0 break-words text-[11px] text-slate-500" data-testid={`event-provenance-${e.id}`}>
                      Recorded by {e.recorded_by || 'unknown'} on {when(e.recorded_at)}
                      {e.source ? ` · source: ${e.source}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {/* Said up front, because an operator who expects to edit a mistake needs to know the
                correction is a new event before they make one. */}
            <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="shipment-append-only-note">
              This history cannot be edited or deleted. If something was recorded wrongly, record what
              actually happened as a new event — the original stays on the record with who wrote it.
            </p>
          </Panel>

          {/* ── References ── */}
          <Panel title="Shipping references" icon={Container} testId="shipment-references">
            <dl className="grid gap-2 sm:grid-cols-3">
              {([['Carrier', data.references.carrier], ['Tracking', data.references.tracking_reference],
                 ['Container', data.references.container_number], ['Seal', data.references.seal_number],
                 ['From', data.references.origin_port], ['To', data.references.destination_port]] as Array<[string, string | null]>)
                .map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-slate-500">{label}</dt>
                    {/* Unknown stays unknown. */}
                    <dd className="min-w-0 break-words text-sm text-slate-900">{value || 'Not recorded'}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="shipment-reference-note">{REFERENCE_IS_NOT_MOVEMENT}</p>
          </Panel>

          <p className="min-w-0 break-words text-xs text-slate-500" data-testid="shipment-disclaimer">{data.note || CUSTOMS_IS_ELSEWHERE}</p>
        </div>
      ) : null}
    </section>
  )
}

/** Recording an observation — deliberately its own act, saying which fact it writes. */
function StageForm({ busy, onRecord }: {
  busy: boolean
  onRecord: (payload: { stage: string; notes?: string | null; event_time?: string | null }) => void
}) {
  const [stage, setStage] = useState('')
  const [notes, setNotes] = useState('')
  const [eventTime, setEventTime] = useState('')
  const chosen = RECORDABLE_STAGES.find((s) => s.value === stage)

  return (
    <form
      className="min-w-0"
      data-testid="stage-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!stage) return
        onRecord({ stage, notes: notes.trim() || null, event_time: eventTime || null })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="stage" className="text-xs font-semibold uppercase tracking-wide text-slate-500">What happened</Label>
          <select id="stage" value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="stage-select">
            <option value="">Choose…</option>
            {RECORDABLE_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {chosen ? <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid="stage-hint">{chosen.hint}</p> : null}
        </div>
        <div className="min-w-0">
          <Label htmlFor="event-time" className="text-xs font-semibold uppercase tracking-wide text-slate-500">When it happened</Label>
          <Input id="event-time" type="datetime-local" value={eventTime} onChange={(e) => setEventTime(e.target.value)} className="mt-1" data-testid="stage-time" />
          {/* The server refuses a future time; saying so here saves the operator a round trip. */}
          <p className="mt-1 min-w-0 break-words text-xs text-slate-500">Leave blank for now. It cannot be in the future.</p>
        </div>
      </div>
      <div className="mt-3 min-w-0">
        <Label htmlFor="stage-notes" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anything to note (optional)</Label>
        <Input id="stage-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" data-testid="stage-notes" />
      </div>
      <Button type="submit" className="mt-3" disabled={busy || !stage} data-testid="stage-submit">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Record it
      </Button>
      <Alert className="mt-3 border-slate-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="min-w-0 break-words text-xs text-slate-600" data-testid="stage-customs-note">
          Recording a customs hold says where the goods are. It does not record what customs decided —
          duties, assessment and release are handled separately and cannot be entered here.
        </AlertDescription>
      </Alert>
    </form>
  )
}
