/**
 * Trade OS T9.3 — "Your cargo", from the customer's side.
 *
 * The person reading this shipped something and wants to know one thing: has it turned up. Every
 * other decision on this page follows from refusing to answer that question with anything other
 * than what the warehouse actually recorded.
 *
 * So: no progress bar that implies motion nobody observed; no "in transit"; no "ready to load" —
 * loading is T10 and does not exist yet, and a screen that says it would be inventing a fact. When
 * the warehouse has not measured the cargo, the page says it has not been measured, rather than
 * showing 0.000 CBM beside the estimate and letting the reader draw the obvious wrong conclusion.
 *
 * The discrepancy panel is the one that mattered most to get right. It states a difference and
 * explicitly says the difference does not change the price, because a customer told their 3.0 CBM
 * booking measured 3.8 will otherwise assume they are about to be charged for it.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Box, Camera, Check, Clock, Loader2, MapPin, Ruler, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type MyCargoView } from '@/hooks/useTradeLogisticsApi'
import {
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

function Panel({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid={testId}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  )
}

export default function MyCargoIntake() {
  const { subjectType = '', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { getMyCargo } = useTradeLogisticsApi()
  const [data, setData] = useState<MyCargoView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const view = await getMyCargo(subjectType, subjectId)
      // A payload we cannot recognise is not "no cargo". Guard the shape before trusting it.
      if (!view || typeof view !== 'object' || !view.subject) throw new Error('This cargo could not be read')
      setData(view)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This cargo could not be read')
      setState('unreadable')
    }
  }, [getMyCargo, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectType && subjectId) void load() }, [authLoading, subjectType, subjectId, load])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600" data-testid="cargo-loading"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable' || !data) {
    return (
      <section className="mx-auto w-full max-w-[1000px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="cargo-unreadable">
        <h1 className="text-2xl font-bold text-slate-950">Your cargo</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription>
            {error || 'This cargo could not be read.'} That is not a report that nothing has arrived.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const intake = data.intake
  const estimate = describeEstimate(data.estimate)
  const statusUi = intake ? INTAKE_STATUS_UI[intake.status] : null

  return (
    <section className="mx-auto w-full max-w-[1000px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="my-cargo">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-orange-600">
          {SUBJECT_LABEL[data.subject.type] || 'cargo'} · {shortRef(data.subject.id)}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">Your cargo</h1>
        <p className="mt-2 text-sm text-slate-600" data-testid="cargo-status-sentence">{data.status_sentence}</p>
      </header>

      {/* ── Has it arrived? The question the page exists to answer. ── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Where it is" testId="cargo-arrival">
          {!intake ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                Not booked in anywhere yet
              </p>
              <p className="text-sm text-slate-600">
                {data.eligible_for_intake
                  ? 'No warehouse has recorded this cargo as expected. Nothing about it has been received.'
                  : data.eligibility_note}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusUi?.tone}`} data-testid="cargo-status-badge">
                {intake.status === 'RECEIVED' ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : intake.status === 'REFUSED' ? <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : intake.status === 'CONDITIONALLY_RECEIVED' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  : <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                {statusUi?.label}
              </span>
              <dl className="space-y-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="min-w-0 break-words font-mono text-xs text-slate-800">{intake.reference}</dd>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <dt className="text-slate-500">Arrived</dt>
                  {/* Never a guess. If no arrival was recorded, the page says so. */}
                  <dd className="min-w-0 break-words text-slate-800" data-testid="cargo-received-at">
                    {intake.received_at ? shortDate(intake.received_at) : 'Not recorded'}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <dt className="flex items-center gap-1 text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Stored at</dt>
                  {/* Unknown stays unknown. No Bay A is invented to fill this line. */}
                  <dd className="min-w-0 break-words text-slate-800" data-testid="cargo-storage">
                    {intake.storage_location || 'Not assigned a position yet'}
                  </dd>
                </div>
              </dl>
              {intake.outcome_reason ? (
                <Alert className="border-amber-200 bg-amber-50" data-testid="cargo-outcome-reason">
                  <AlertDescription className="min-w-0 break-words text-sm text-amber-900">
                    <strong className="font-semibold">What the warehouse said:</strong> {intake.outcome_reason}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </Panel>

        {/* ── Condition: an observation by a person, labelled as one. ── */}
        <Panel title="Condition when it arrived" testId="cargo-condition">
          {!intake || intake.status === 'EXPECTED' ? (
            <p className="text-sm text-slate-600">Nobody has looked at this cargo yet, so there is nothing recorded about its condition.</p>
          ) : !intake.condition ? (
            <p className="text-sm text-slate-600">The person receiving it did not record a condition.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900" data-testid="cargo-condition-label">{CONDITION_UI[intake.condition]?.label || intake.condition}</p>
              <p className="text-sm text-slate-600">{CONDITION_UI[intake.condition]?.detail}</p>
              <p className="text-xs text-slate-500">
                This is what one person saw when the cargo arrived. It is not an inspection, an insurance
                assessment, or a finding about who is responsible.
              </p>
            </div>
          )}
          {intake ? (
            <Link
              to={`/diaspora/documents/warehouse_intake/${encodeURIComponent(intake.id)}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
              data-testid="cargo-evidence-link"
            >
              <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
              Photos and paperwork for this cargo
            </Link>
          ) : null}
        </Panel>
      </div>

      {/* ── Estimated vs actual: two true statements about different moments. ── */}
      <Panel title="Size and weight" testId="cargo-measurements">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Box className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />What you said
            </p>
            <p className="mt-1 break-words text-lg font-semibold text-slate-900" data-testid="cargo-estimate">{estimate.headline}</p>
            {data.estimate.weight_kg !== null ? (
              <p className="text-sm text-slate-600">{formatWeight(data.estimate.weight_kg, 'kg')}</p>
            ) : null}
            {estimate.caveat ? <p className="mt-1 break-words text-xs text-amber-700" data-testid="cargo-estimate-caveat">{estimate.caveat}</p> : null}
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Ruler className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />What the warehouse measured
            </p>
            {/* Not measured is written as not measured. It is never 0.000. */}
            <p className="mt-1 break-words text-lg font-semibold text-slate-900" data-testid="cargo-actual">
              {intake?.actual ? formatVolume(intake.actual.volume_cbm) : 'Not measured'}
            </p>
            {intake?.actual ? (
              <>
                <p className="break-words text-sm text-slate-600">{formatDimensions(intake.actual)}</p>
                {intake.actual.weight_value !== null ? (
                  <p className="text-sm text-slate-600">{formatWeight(intake.actual.weight_value, intake.actual.weight_unit)}</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">Measured {shortDate(intake.actual.measured_at)}</p>
              </>
            ) : (
              <p className="text-sm text-slate-600">Nobody has measured this cargo yet.</p>
            )}
          </div>
        </div>

        {intake ? (
          <div className="mt-4 min-w-0 rounded-lg border border-slate-200 p-3" data-testid="cargo-discrepancy">
            {(() => {
              const d = describeDiscrepancy(intake.discrepancy)
              return (
                <>
                  <p className={`break-words text-sm font-semibold ${d.tone === 'attention' ? 'text-amber-800' : 'text-slate-800'}`}>{d.headline}</p>
                  {d.detail ? <p className="mt-0.5 break-words text-sm text-slate-600" data-testid="cargo-discrepancy-detail">{d.detail}</p> : null}
                  {/* The sentence a customer needs and would otherwise assume the opposite of. */}
                  <p className="mt-2 break-words text-xs text-slate-500" data-testid="cargo-discrepancy-note">{intake.discrepancy.note}</p>
                </>
              )
            })()}
          </div>
        ) : null}

        {intake && intake.earlier_measurements > 0 ? (
          <p className="mt-3 text-xs text-slate-500" data-testid="cargo-earlier-measurements">
            The warehouse has measured this {intake.earlier_measurements + 1} times. The most recent measurement is
            shown; the earlier ones are still on the record.
          </p>
        ) : null}
      </Panel>

      <p className="mt-6 break-words text-xs text-slate-500" data-testid="cargo-disclaimer">
        This page shows what a warehouse recorded about your cargo. What happens to it after that —
        which container it travels in, and when it sails — is decided separately and is not shown here.
      </p>
    </section>
  )
}
