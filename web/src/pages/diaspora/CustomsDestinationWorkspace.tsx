/**
 * Trade OS T12 — the coordinator's customs and destination workspace.
 *
 * The screen is organised around one distinction, because it is the one that decides whether the
 * product tells the truth: **who said this, and what does it rest on.**
 *
 * The same 900 USD is "Assessment amount" when it came off an authority document and
 * "Agent-reported amount" when somebody typed it. Not one heading with two badges — two headings.
 * A reader skimming for a number will not read a badge.
 *
 * Two things this screen will never offer:
 *
 *   · a way to declare goods cleared. There is no such control, because CarUp is not ZIMRA;
 *   · a duty or tax calculator. There is no arithmetic on this page at all. An amount is transcribed
 *     from evidence or it does not exist, and an unassessed consignment reads "Not yet assessed" —
 *     never 0, never a dash.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, FileText, Loader2, MapPin, ShieldCheck, UserCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import {
  CARUP_IS_NOT_ZIMRA,
  GATEWAY_IS_NOT_DESTINATION,
  LICENCE_UNVERIFIED,
  NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED,
  RECORDABLE_CUSTOMS_EVENTS,
  SOURCE_OPTIONS,
  STEP_STATE_UI,
  STRENGTH_UI,
  type CustomsCaseWorkspace,
  describeAssessment,
  describeCustomsRate,
  describeHandoffs,
  when,
} from './customsDisplay'

function Panel({ title, icon: Icon, children, testId }: {
  title: string; icon: typeof FileText; children: React.ReactNode; testId?: string
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

function looksLikeWorkspace(value: unknown): value is CustomsCaseWorkspace {
  const v = value as CustomsCaseWorkspace | null
  return Boolean(v && v.case && Array.isArray(v.checklist) && v.assessment)
}

function EventForm({ busy, onRecord }: {
  busy: boolean
  onRecord: (payload: Record<string, unknown>) => void
}) {
  const [eventType, setEventType] = useState('')
  const [sourceKind, setSourceKind] = useState('AGENT_REPORT')
  const [documentId, setDocumentId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [rateValue, setRateValue] = useState('')
  const [rateSource, setRateSource] = useState('')
  const [rateFrom, setRateFrom] = useState('')
  const [notes, setNotes] = useState('')

  const chosen = RECORDABLE_CUSTOMS_EVENTS.find((e) => e.value === eventType)
  const carriesAmount = ['ASSESSMENT_EVIDENCE_RECEIVED', 'PAYMENT_EVIDENCE_RECEIVED'].includes(eventType)
  const carriesRate = eventType === 'ASSESSMENT_EVIDENCE_RECEIVED'

  return (
    <form
      className="space-y-3"
      data-testid="customs-event-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!eventType) return
        onRecord({
          event_type: eventType,
          ...(chosen?.needsSource ? { source_kind: sourceKind } : {}),
          ...(documentId.trim() ? { evidence_document_id: documentId.trim() } : {}),
          ...(carriesAmount && amount.trim() ? { amount_value: amount.trim(), amount_currency: currency.trim() } : {}),
          ...(carriesRate && rateValue.trim() ? {
            customs_rate_value: rateValue.trim(), customs_rate_source: rateSource.trim(), customs_rate_effective_from: rateFrom.trim(),
          } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        })
      }}
    >
      <div className="min-w-0">
        <Label htmlFor="customs-event">What happened</Label>
        <select
          id="customs-event"
          className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          data-testid="customs-event-select"
        >
          <option value="">Choose…</option>
          {RECORDABLE_CUSTOMS_EVENTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        {chosen ? <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid="customs-event-hint">{chosen.hint}</p> : null}
      </div>

      {chosen?.needsSource ? (
        <div className="min-w-0">
          <Label htmlFor="customs-source">Where this comes from</Label>
          <select
            id="customs-source"
            className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
            data-testid="customs-source-select"
          >
            {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid="customs-source-hint">
            {SOURCE_OPTIONS.find((s) => s.value === sourceKind)?.hint}
          </p>
        </div>
      ) : null}

      {chosen && chosen.needsSource ? (
        <div className="min-w-0">
          <Label htmlFor="customs-document">Attached document</Label>
          <Input id="customs-document" value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="mt-1" data-testid="customs-document-input" />
          {sourceKind === 'AUTHORITY_DOCUMENT' ? (
            <p className="mt-1 min-w-0 break-words text-xs text-amber-700" data-testid="customs-document-required-note">
              A claim on an authority document has to have the document. Without it this will be refused — and recorded as a report if you change the source.
            </p>
          ) : null}
        </div>
      ) : null}

      {carriesAmount ? (
        <div className="grid gap-3 sm:grid-cols-[2fr,1fr]">
          <div className="min-w-0">
            <Label htmlFor="customs-amount">Amount, exactly as the evidence states it</Label>
            <Input id="customs-amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" data-testid="customs-amount-input" />
          </div>
          <div className="min-w-0">
            <Label htmlFor="customs-currency">Currency</Label>
            <Input id="customs-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1" data-testid="customs-currency-input" />
          </div>
          <p className="min-w-0 break-words text-xs text-slate-600 sm:col-span-2" data-testid="customs-amount-note">
            Transcribe the figure from the document. CarUp does not calculate duty, VAT or surtax, and nothing on this page adds anything up.
          </p>
        </div>
      ) : null}

      {carriesRate ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <Label htmlFor="customs-rate">Customs exchange rate</Label>
            <Input id="customs-rate" value={rateValue} onChange={(e) => setRateValue(e.target.value)} className="mt-1" data-testid="customs-rate-input" />
          </div>
          <div className="min-w-0">
            <Label htmlFor="customs-rate-source">Its source</Label>
            <Input id="customs-rate-source" value={rateSource} onChange={(e) => setRateSource(e.target.value)} className="mt-1" data-testid="customs-rate-source-input" />
          </div>
          <div className="min-w-0">
            <Label htmlFor="customs-rate-from">Effective from</Label>
            <Input id="customs-rate-from" type="date" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} className="mt-1" data-testid="customs-rate-from-input" />
          </div>
          <p className="min-w-0 break-words text-xs text-slate-600 sm:col-span-3" data-testid="customs-rate-note">
            The rate the assessment itself used, with the source that published it and the date it takes effect. Never a market rate, and never a reference rate from anywhere else in CarUp.
          </p>
        </div>
      ) : null}

      <div className="min-w-0">
        <Label htmlFor="customs-notes">Notes</Label>
        <Input id="customs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" data-testid="customs-notes-input" />
      </div>

      <p className="min-w-0 break-words text-xs text-slate-600" data-testid="customs-firewall-note">
        There is no option here to declare the goods cleared. CarUp records what an authority did only as somebody&apos;s attributed claim, and never as its own.
      </p>
      <Button type="submit" disabled={busy || !eventType} data-testid="customs-event-submit">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Record it
      </Button>
    </form>
  )
}

export default function CustomsDestinationWorkspace() {
  const { loading: authLoading } = useAuth()
  const { getCustomsCase, appointClearingAgent, recordCustomsEvent } = useTradeLogisticsApi()
  const [caseInput, setCaseInput] = useState('')
  const [caseId, setCaseId] = useState('')
  const [data, setData] = useState<CustomsCaseWorkspace | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [busy, setBusy] = useState(false)
  // A READ failure and an ACTION refusal are separate state on purpose. They were one field, and a
  // background reload wiped the refusal the operator had just been given — which in this phase means
  // silently swallowing precisely the messages it exists to deliver ("this claim must be bound to
  // that document", "you cannot record that on this case").
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [agentName, setAgentName] = useState('')
  const [agentUserId, setAgentUserId] = useState('')
  const [licence, setLicence] = useState('')

  const load = useCallback(async (id: string) => {
    setError(null); setUnreadable(false)
    try {
      const view = await getCustomsCase(id)
      if (!looksLikeWorkspace(view)) { setData(null); setUnreadable(true); return }
      setData(view)
    } catch (e) {
      setData(null); setUnreadable(true)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [getCustomsCase])

  // Fetch-on-open: the effect's whole job is to load the case and set it. Same suppression, for the
  // same reason, as the T11 workspace beside it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (caseId) void load(caseId) }, [caseId, load])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setActionError(null)
    try { await fn(); await load(caseId) }
    catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (authLoading) return <div className="p-8 text-sm text-slate-600">Loading…</div>

  const assessment = describeAssessment(data?.assessment)
  const rate = describeCustomsRate(data?.assessment)
  const handoffs = describeHandoffs(data?.handoffs)

  return (
    <section className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="customs-destination-workspace">
      <header className="min-w-0">
        <h1 className="min-w-0 break-words text-2xl font-semibold text-slate-900">Customs &amp; destination</h1>
        <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-header-note">{CARUP_IS_NOT_ZIMRA}</p>
      </header>

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        data-testid="customs-form"
        onSubmit={(e) => { e.preventDefault(); setCaseId(caseInput.trim()) }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="customs-case-id">Customs case</Label>
          <Input id="customs-case-id" value={caseInput} onChange={(e) => setCaseInput(e.target.value)} placeholder="Customs case id" className="mt-1" data-testid="customs-input" />
        </div>
        <Button type="submit" className="shrink-0 self-end" disabled={!caseInput.trim()} data-testid="customs-submit">Open</Button>
      </form>

      {actionError || error ? (
        <Alert className="mt-4" data-testid="customs-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="min-w-0 break-words">{actionError || error}</AlertDescription>
        </Alert>
      ) : null}

      {unreadable ? (
        <Alert className="mt-4" data-testid="customs-unreadable">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="min-w-0 break-words">
            This customs case could not be read. That is a failure to load it — it is not a report that nothing has happened to it.
          </AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <div className="mt-6 space-y-4">
          <Panel title="Case" icon={ClipboardList} testId="customs-case">
            <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-reference">{data.case.reference}</p>
            <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-cargo-kind">
              {data.case.cargo_kind === 'VEHICLE' ? 'Vehicle cargo' : 'General cargo'} · case is {data.case.status.toLowerCase()}
            </p>
          </Panel>

          {/* ── Who is handling clearance ── */}
          <Panel title="Clearing agent" icon={UserCheck} testId="customs-agent">
            {data.agent ? (
              <>
                <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-agent-name">{data.agent.display_name}</p>
                <p className="mt-1 min-w-0 break-words text-sm text-slate-600">Appointed {when(data.agent.appointed_at)}</p>
                {data.agent.licence_reference_claimed ? (
                  <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-agent-licence">
                    Licence reference given: {data.agent.licence_reference_claimed}
                  </p>
                ) : null}
                <p className="mt-1 min-w-0 break-words text-xs text-amber-700" data-testid="customs-agent-licence-note">{LICENCE_UNVERIFIED}</p>
              </>
            ) : (
              <>
                <p className="min-w-0 break-words text-sm text-slate-700" data-testid="customs-no-agent">{data.agent_note}</p>
                <form
                  className="mt-3 grid gap-3 sm:grid-cols-3"
                  data-testid="customs-appoint-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act(() => appointClearingAgent(data.case.id, {
                      agent_kind: 'PERSON',
                      agent_user_id: agentUserId.trim() || null,
                      agent_display_name: agentName.trim(),
                      licence_reference_claimed: licence.trim() || null,
                    }))
                  }}
                >
                  <div className="min-w-0">
                    <Label htmlFor="agent-name">Agent name</Label>
                    <Input id="agent-name" value={agentName} onChange={(e) => setAgentName(e.target.value)} className="mt-1" data-testid="customs-agent-name-input" />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="agent-user">Their CarUp user</Label>
                    <Input id="agent-user" value={agentUserId} onChange={(e) => setAgentUserId(e.target.value)} className="mt-1" data-testid="customs-agent-user-input" />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="agent-licence">Licence reference</Label>
                    <Input id="agent-licence" value={licence} onChange={(e) => setLicence(e.target.value)} className="mt-1" data-testid="customs-agent-licence-input" />
                  </div>
                  <p className="min-w-0 break-words text-xs text-slate-600 sm:col-span-3" data-testid="customs-appoint-note">
                    This records that you appointed them. CarUp cannot check a clearing-agent licence with the authority, so the reference is stored as what you supplied.
                  </p>
                  <Button type="submit" className="sm:col-span-3 sm:justify-self-start" disabled={busy || !agentName.trim()} data-testid="customs-appoint-submit">
                    Appoint clearing agent
                  </Button>
                </form>
              </>
            )}
          </Panel>

          {/* ── The money, and who stands behind it ── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Duty and tax" icon={FileText} testId="customs-assessment">
              <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-assessment-headline">{assessment.headline}</p>
              <p className="mt-1 min-w-0 break-words text-2xl font-semibold text-slate-900" data-testid="customs-assessment-amount">{assessment.amount}</p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-assessment-detail">{assessment.detail}</p>
              {data.assessment.assessment_date ? (
                <p className="mt-1 min-w-0 break-words text-xs text-slate-500" data-testid="customs-assessment-date">Recorded {when(data.assessment.assessment_date)}</p>
              ) : null}
            </Panel>
            <Panel title="Customs exchange rate" icon={FileText} testId="customs-rate">
              <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-rate-headline">{rate.headline}</p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-rate-detail">{rate.detail}</p>
            </Panel>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Payment" icon={FileText} testId="customs-payment">
              <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-payment-headline">{data.payment.headline}</p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-payment-detail">{data.payment.detail}</p>
            </Panel>
            <Panel title="Release" icon={ShieldCheck} testId="customs-release">
              <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="customs-release-headline">{data.release.headline}</p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="customs-release-detail">{data.release.detail}</p>
            </Panel>
          </div>

          {/* ── §L — the handoffs, one line each ── */}
          <Panel title="Where the goods have got to" icon={MapPin} testId="customs-handoffs">
            <ul className="space-y-2">
              {handoffs.map((h) => (
                <li key={h.key} className="min-w-0 border-l-2 border-slate-200 pl-3" data-testid={`customs-handoff-${h.key}`}>
                  <p className="min-w-0 break-words text-sm font-medium text-slate-900">{h.label}</p>
                  <p className="min-w-0 break-words text-xs text-slate-600">{h.value}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 min-w-0 break-words text-xs text-slate-600" data-testid="customs-handoff-note">{GATEWAY_IS_NOT_DESTINATION}</p>
          </Panel>

          {/* ── The checklist and what is still needed ── */}
          <Panel title="Evidence" icon={ClipboardList} testId="customs-checklist">
            <ul className="space-y-2">
              {data.checklist.map((step) => (
                <li key={step.key} className="min-w-0" data-testid={`customs-step-${step.key}`}>
                  <p className="min-w-0 break-words text-sm font-medium text-slate-900">
                    {step.label} — <span className="font-normal text-slate-600">{STEP_STATE_UI[step.state].label}</span>
                  </p>
                  {step.needed ? <p className="min-w-0 break-words text-xs text-slate-600">{step.needed}</p> : null}
                  {step.at ? <p className="min-w-0 break-words text-xs text-slate-500">{when(step.at)}</p> : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 min-w-0 break-words text-xs text-slate-600" data-testid="customs-unknown-note">{NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED}</p>
          </Panel>

          {data.open_actions.length ? (
            <Panel title="Open actions" icon={ClipboardList} testId="customs-open-actions">
              <ul className="space-y-1">
                {data.open_actions.map((a) => (
                  <li key={a.key} className="min-w-0 break-words text-sm text-slate-700">{a.label}: {a.needed}</li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Record what you know" icon={FileText} testId="customs-record">
            <EventForm busy={busy} onRecord={(payload) => void act(() => recordCustomsEvent(data.case.id, payload as never))} />
          </Panel>

          <Panel title="What has been recorded" icon={ClipboardList} testId="customs-timeline">
            {!data.timeline.length ? (
              <p className="text-sm text-slate-600">Nothing has been recorded on this customs case.</p>
            ) : (
              <ol className="space-y-3">
                {data.timeline.map((e) => (
                  <li key={e.id} className="min-w-0 border-l-2 border-slate-200 pl-3" data-testid={`customs-event-${e.id}`}>
                    <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{e.sentence}</p>
                    <p className="min-w-0 break-words text-xs text-slate-600" data-testid={`customs-strength-${e.id}`}>
                      {STRENGTH_UI[e.strength].label} — {STRENGTH_UI[e.strength].explains}
                    </p>
                    <p className="min-w-0 break-words text-xs text-slate-500" data-testid={`customs-provenance-${e.id}`}>
                      {when(e.event_time)}{e.location ? ` · ${e.location}` : ''} · recorded by {e.recorded_by}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 min-w-0 break-words text-xs text-slate-600" data-testid="customs-append-only-note">
              This history cannot be edited or deleted. If something here is wrong, record what actually happened as a new event.
            </p>
          </Panel>

          {data.vehicle ? (
            <Panel title="Vehicle" icon={ShieldCheck} testId="customs-vehicle">
              <p className="min-w-0 break-words text-sm text-slate-700" data-testid="customs-vehicle-note">{data.vehicle.note}</p>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
