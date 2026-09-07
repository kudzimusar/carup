/**
 * Trade OS T9.3 — the warehouse intake workspace.
 *
 * The operator's side of the same truth. Before this there was no product path to receiving cargo at
 * all: the authority existed, the service existed, and the only way to say "this arrived" would have
 * been a SQL statement. A phase whose central act can only be performed by an engineer is not a
 * phase that has been built.
 *
 * Two design decisions carry most of the weight:
 *
 *  1. **Receiving is confirmed, not clicked.** It is the row that says somebody else's goods are in
 *     your building, and the wrong booking is one mis-tap away — so the panel names the customer's
 *     own reference back at the operator before it will submit.
 *
 *  2. **The estimate is shown beside the measurement form, not replaced by it.** The operator is the
 *     person best placed to notice that 3.0 booked and 3.8 measured is a real difference, and the
 *     form deliberately does not pre-fill the estimate into the actual fields — a pre-filled number
 *     that nobody re-measured is how an estimate quietly becomes an observation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Box, Check, ClipboardList, Loader2, MapPin, Package, Ruler, Warehouse, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type IntakeQueue, type WarehouseIntake } from '@/hooks/useTradeLogisticsApi'
import {
  CONDITION_OPTIONS,
  CONDITION_UI,
  INTAKE_STATUS_UI,
  SUBJECT_LABEL,
  describeDiscrepancy,
  describeEstimate,
  formatDimensions,
  formatVolume,
  formatWeight,
  shortDate,
  shortRef,
} from './warehouseDisplay'

type Outcome = 'RECEIVED' | 'CONDITIONALLY_RECEIVED' | 'REFUSED'

const OUTCOME_UI: Array<{ value: Outcome; label: string; hint: string }> = [
  { value: 'RECEIVED', label: 'Take it in', hint: 'The cargo arrived and there is nothing to flag.' },
  { value: 'CONDITIONALLY_RECEIVED', label: 'Take it in, with a note', hint: 'It is in the building, but something needs recording.' },
  { value: 'REFUSED', label: 'Do not take it in', hint: 'It was not accepted. Say why — the customer has to be able to act on it.' },
]

export default function WarehouseIntakeWorkspace() {
  const { loading: authLoading } = useAuth()
  const api = useTradeLogisticsApi()
  const [queue, setQueue] = useState<IntakeQueue | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.listIntakeQueue()
      // Guard the shape: an unrecognised payload must not crash the operator's screen.
      if (!data || !Array.isArray(data.intakes) || !Array.isArray(data.warehouses)) {
        throw new Error('The intake queue could not be read')
      }
      setQueue(data)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The intake queue could not be read')
      setState('unreadable')
    }
  }, [api])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  const selected = useMemo(
    () => (queue?.intakes || []).find((i) => i.id === selectedId) || null,
    [queue, selectedId],
  )

  const act = useCallback(async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setActionError(''); setNotice('')
    try {
      await fn()
      setNotice(success)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That could not be recorded')
    } finally {
      setBusy(false)
    }
  }, [load])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600" data-testid="intake-loading"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable') {
    return (
      <section className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="intake-unreadable">
        <h1 className="text-2xl font-bold text-slate-950">Warehouse intake</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription>{error} That is not a report that there is nothing to receive.</AlertDescription>
        </Alert>
      </section>
    )
  }

  // No warehouse authority means an empty queue, not a locked door — there is simply nothing here
  // that belongs to this person.
  if (!queue?.warehouses.length) {
    return (
      <section className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="intake-no-warehouse">
        <h1 className="text-2xl font-bold text-slate-950">Warehouse intake</h1>
        <p className="mt-3 max-w-prose text-sm text-slate-600">
          You are not set up to receive cargo at any warehouse, so there is nothing here. Receiving is
          done by the people who run a warehouse, not by the people whose cargo it is.
        </p>
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="warehouse-intake-workspace">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Warehouse intake</h1>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          Cargo expected at, and received by, {queue.warehouses.map((w) => w.name).join(', ')}.
        </p>
      </header>

      {notice ? <Alert className="mt-4 border-emerald-200 bg-emerald-50" data-testid="intake-notice"><AlertDescription className="text-emerald-900">{notice}</AlertDescription></Alert> : null}
      {actionError ? <Alert className="mt-4 border-red-200 bg-red-50" data-testid="intake-error"><AlertDescription className="min-w-0 break-words text-red-900">{actionError}</AlertDescription></Alert> : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* ── The queue ── */}
        <div className="min-w-0 space-y-2" data-testid="intake-queue">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
            {queue.intakes.length} {queue.intakes.length === 1 ? 'consignment' : 'consignments'}
          </h2>
          {!queue.intakes.length ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              Nothing is booked in. Cargo appears here once an approved booking or an awarded shipping
              request is expected at one of your warehouses.
            </p>
          ) : queue.intakes.map((intake) => {
            const ui = INTAKE_STATUS_UI[intake.status]
            return (
              <button
                key={intake.id}
                type="button"
                onClick={() => { setSelectedId(intake.id); setActionError(''); setNotice('') }}
                className={`w-full min-w-0 rounded-lg border p-3 text-left transition ${selectedId === intake.id ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                data-testid={`intake-row-${intake.id}`}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-xs text-slate-700">{intake.reference}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ui?.tone}`}>{ui?.label}</span>
                </div>
                <p className="mt-1 min-w-0 break-words text-sm text-slate-800">
                  {SUBJECT_LABEL[intake.subject.type]} {shortRef(intake.subject.id)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Booked as {formatVolume(intake.estimate.volume_cbm)}
                  {intake.actual ? ` · measured ${formatVolume(intake.actual.volume_cbm)}` : ' · not measured'}
                </p>
              </button>
            )
          })}
        </div>

        {/* ── The consignment ── */}
        <div className="min-w-0">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600" data-testid="intake-none-selected">
              Choose a consignment to receive, inspect or measure it.
            </div>
          ) : (
            <IntakeDetail
              intake={selected}
              busy={busy}
              onReceive={(payload) => act(() => api.receiveIntake(selected.id, payload), 'Recorded. The customer has been told.')}
              onMeasure={(payload) => act(() => api.recordMeasurement(selected.id, payload), 'Measurement recorded.')}
              onAssign={(location) => act(() => api.assignStorageLocation(selected.id, location), 'Storage position recorded.')}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function IntakeDetail({ intake, busy, onReceive, onMeasure, onAssign }: {
  intake: WarehouseIntake
  busy: boolean
  onReceive: (payload: Record<string, unknown>) => void
  onMeasure: (payload: Record<string, unknown>) => void
  onAssign: (location: string) => void
}) {
  const [outcome, setOutcome] = useState<Outcome>('RECEIVED')
  const [condition, setCondition] = useState('')
  const [reason, setReason] = useState('')
  const [packages, setPackages] = useState('')
  const [confirmRef, setConfirmRef] = useState('')
  const [dims, setDims] = useState({ length: '', width: '', height: '', unit: 'cm' })
  const [weight, setWeight] = useState({ value: '', unit: 'kg' })
  const [measuredPackages, setMeasuredPackages] = useState('')
  const [location, setLocation] = useState('')

  const estimate = describeEstimate(intake.estimate)
  const expected = intake.status === 'EXPECTED'
  const held = intake.status === 'RECEIVED' || intake.status === 'CONDITIONALLY_RECEIVED'
  // Confirmation is against the CUSTOMER's own reference, so receiving the wrong consignment takes a
  // deliberate act rather than a mis-tap.
  const requiredRef = shortRef(intake.subject.id)
  const confirmed = confirmRef.trim().toUpperCase() === requiredRef

  return (
    <div className="min-w-0 space-y-4" data-testid="intake-detail">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="min-w-0 break-all font-mono text-xs text-slate-500">{intake.reference}</p>
            <h2 className="mt-0.5 min-w-0 break-words text-lg font-bold text-slate-950">
              {SUBJECT_LABEL[intake.subject.type]} {requiredRef}
            </h2>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${INTAKE_STATUS_UI[intake.status]?.tone}`} data-testid="intake-detail-status">
            {INTAKE_STATUS_UI[intake.status]?.label}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Box className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Booked as</dt>
            <dd className="mt-1 min-w-0 break-words text-base font-semibold text-slate-900" data-testid="intake-estimate">{estimate.headline}</dd>
            {estimate.caveat ? <dd className="mt-0.5 min-w-0 break-words text-xs text-amber-700">{estimate.caveat}</dd> : null}
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Ruler className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Measured</dt>
            <dd className="mt-1 min-w-0 break-words text-base font-semibold text-slate-900" data-testid="intake-actual">
              {intake.actual ? formatVolume(intake.actual.volume_cbm) : 'Not measured'}
            </dd>
            {intake.actual ? (
              <dd className="mt-0.5 min-w-0 break-words text-xs text-slate-600">
                {formatDimensions(intake.actual)}
                {intake.actual.weight_value !== null ? ` · ${formatWeight(intake.actual.weight_value, intake.actual.weight_unit)}` : ''}
              </dd>
            ) : null}
          </div>
        </dl>

        {intake.discrepancy.status !== 'NOT_MEASURED' ? (
          <div className="mt-3 min-w-0 rounded-lg border border-slate-200 p-3" data-testid="intake-discrepancy">
            {(() => {
              const d = describeDiscrepancy(intake.discrepancy)
              return (
                <>
                  <p className={`break-words text-sm font-semibold ${d.tone === 'attention' ? 'text-amber-800' : 'text-slate-800'}`}>{d.headline}</p>
                  {d.detail ? <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600">{d.detail}</p> : null}
                  <p className="mt-2 min-w-0 break-words text-xs text-slate-500">{intake.discrepancy.note}</p>
                </>
              )
            })()}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span data-testid="intake-received-at">Arrived: {intake.received_at ? shortDate(intake.received_at) : 'not recorded'}</span>
          <span data-testid="intake-storage">Position: {intake.storage_location || 'not assigned'}</span>
          {intake.condition ? <span>Condition: {CONDITION_UI[intake.condition]?.label || intake.condition}</span> : null}
        </div>

        <Link
          to={`/diaspora/documents/warehouse_intake/${encodeURIComponent(intake.id)}`}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
          data-testid="intake-evidence-link"
        >
          <Package className="h-4 w-4 shrink-0" aria-hidden="true" />
          Photos and paperwork
        </Link>
      </div>

      {/* ── Receive ── */}
      {expected ? (
        <form
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
          data-testid="intake-receive-form"
          onSubmit={(e) => {
            e.preventDefault()
            onReceive({
              outcome,
              condition: condition || null,
              outcomeReason: reason || null,
              observedPackageCount: packages === '' ? null : Number(packages),
            })
          }}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Warehouse className="h-4 w-4 shrink-0" aria-hidden="true" />Record what happened
          </h3>

          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Intake outcome</legend>
            {OUTCOME_UI.map((o) => (
              <label key={o.value} className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${outcome === o.value ? 'border-orange-400 bg-orange-50' : 'border-slate-200'}`}>
                <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-1 shrink-0" data-testid={`intake-outcome-${o.value}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
                  <span className="block min-w-0 break-words text-xs text-slate-600">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="condition" className="text-xs font-semibold uppercase tracking-wide text-slate-500">What you saw</Label>
              <select
                id="condition" value={condition} onChange={(e) => setCondition(e.target.value)}
                className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm"
                data-testid="intake-condition"
              >
                <option value="">Not recorded</option>
                {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{CONDITION_UI[c].label}</option>)}
              </select>
              {/* The rule that keeps a suggestion from becoming a fact. */}
              <p className="mt-1 min-w-0 break-words text-xs text-slate-500">Your own observation. Not read off a photo.</p>
            </div>
            <div className="min-w-0">
              <Label htmlFor="packages" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pieces counted</Label>
              <Input id="packages" type="number" min="0" value={packages} onChange={(e) => setPackages(e.target.value)} placeholder="Leave blank if not counted" className="mt-1" data-testid="intake-packages" />
            </div>
          </div>

          <div className="mt-3 min-w-0">
            <Label htmlFor="reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {outcome === 'RECEIVED' ? 'Anything to note (optional)' : 'Why — the customer will read this'}
            </Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" data-testid="intake-reason" />
          </div>

          <div className="mt-4 min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Label htmlFor="confirm" className="min-w-0 break-words text-xs font-semibold text-amber-900">
              This records that somebody else&apos;s goods are in your building. Type <span className="font-mono">{requiredRef}</span> to confirm it is the right consignment.
            </Label>
            <Input id="confirm" value={confirmRef} onChange={(e) => setConfirmRef(e.target.value)} className="mt-1.5 bg-white font-mono" data-testid="intake-confirm" />
          </div>

          <Button type="submit" disabled={busy || !confirmed} className="mt-4 w-full sm:w-auto" data-testid="intake-receive-submit">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : outcome === 'REFUSED' ? <X className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}
            {OUTCOME_UI.find((o) => o.value === outcome)?.label}
          </Button>
        </form>
      ) : null}

      {/* ── Measure ── */}
      {held ? (
        <form
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
          data-testid="intake-measure-form"
          onSubmit={(e) => {
            e.preventDefault()
            onMeasure({
              lengthValue: dims.length === '' ? null : Number(dims.length),
              widthValue: dims.width === '' ? null : Number(dims.width),
              heightValue: dims.height === '' ? null : Number(dims.height),
              dimensionUnit: dims.length === '' ? null : dims.unit,
              weightValue: weight.value === '' ? null : Number(weight.value),
              weightUnit: weight.value === '' ? null : weight.unit,
              packageCount: measuredPackages === '' ? null : Number(measuredPackages),
            })
          }}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Ruler className="h-4 w-4 shrink-0" aria-hidden="true" />Measure it
          </h3>
          {/* Says what the dimensions mean, so a receiver measuring one carton of five does not
              silently produce a fifth of the real volume. */}
          <p className="mt-1 min-w-0 break-words text-xs text-slate-600">
            Overall size of the consignment as it stands, not one carton. The volume is worked out from
            these three figures — leave them blank if you did not measure.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {(['length', 'width', 'height'] as const).map((k) => (
              <div key={k} className="min-w-0">
                <Label htmlFor={`dim-${k}`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</Label>
                <Input id={`dim-${k}`} type="number" step="0.001" min="0" value={dims[k]} onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))} className="mt-1" data-testid={`measure-${k}`} />
              </div>
            ))}
            <div className="min-w-0">
              <Label htmlFor="dim-unit" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</Label>
              <select id="dim-unit" value={dims.unit} onChange={(e) => setDims((d) => ({ ...d, unit: e.target.value }))} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="measure-unit">
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <Label htmlFor="weight-value" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weight</Label>
              <Input id="weight-value" type="number" step="0.001" min="0" value={weight.value} onChange={(e) => setWeight((w) => ({ ...w, value: e.target.value }))} className="mt-1" data-testid="measure-weight" />
            </div>
            <div className="min-w-0">
              <Label htmlFor="weight-unit" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</Label>
              <select id="weight-unit" value={weight.unit} onChange={(e) => setWeight((w) => ({ ...w, unit: e.target.value }))} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="measure-weight-unit">
                <option value="kg">kg</option>
                <option value="t">t</option>
              </select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="measured-packages" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pieces</Label>
              <Input id="measured-packages" type="number" min="0" value={measuredPackages} onChange={(e) => setMeasuredPackages(e.target.value)} className="mt-1" data-testid="measure-packages" />
            </div>
          </div>

          <Button type="submit" disabled={busy} className="mt-4 w-full sm:w-auto" data-testid="intake-measure-submit">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ruler className="mr-2 h-4 w-4" />}Record measurement
          </Button>
        </form>
      ) : null}

      {/* ── Put it somewhere ── */}
      {held ? (
        <form
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
          data-testid="intake-storage-form"
          onSubmit={(e) => { e.preventDefault(); if (location.trim()) onAssign(location.trim()) }}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />Where you put it
          </h3>
          <p className="mt-1 min-w-0 break-words text-xs text-slate-600">
            Only fill this in once the cargo is actually somewhere. An invented position is a place
            somebody will later go and look.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={intake.storage_location || 'e.g. Bay 4, rack C'} className="min-w-0 flex-1" data-testid="storage-input" />
            <Button type="submit" disabled={busy || !location.trim()} className="shrink-0" data-testid="storage-submit">Record position</Button>
          </div>
        </form>
      ) : null}

      {intake.status === 'REFUSED' ? (
        <Alert className="border-red-200 bg-red-50" data-testid="intake-refused-note">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="min-w-0 break-words text-red-900">
            This cargo was not taken in. The booking and its history are untouched — what happens next
            is decided with the customer, not here.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
