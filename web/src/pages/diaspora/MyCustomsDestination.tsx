/**
 * Trade OS T12 — what the person whose cargo it is reads.
 *
 * The failures this guards against are all one shape: a customer reading a line and concluding an
 * authority did something nobody has evidence of.
 *
 * So the page leads with plain language and never with a government table's vocabulary. It says
 * which step is being worked on, who is handling the clearance, what is still needed, and — only
 * when a source entitles it to — an amount. An unassessed consignment reads **"Not yet assessed"**.
 * It never reads `0`, never a dash, and never an estimate CarUp worked out, because CarUp cannot
 * work one out.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ClipboardList, MapPin, ShieldCheck, UserCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import {
  CARUP_IS_NOT_ZIMRA,
  GATEWAY_IS_NOT_DESTINATION,
  NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED,
  STEP_STATE_UI,
  STRENGTH_UI,
  type MyCustomsStatus,
  describeAssessment,
  describeCustomsRate,
  describeHandoffs,
  when,
} from './customsDisplay'

function Panel({ title, icon: Icon, children, testId }: {
  title: string; icon: typeof MapPin; children: React.ReactNode; testId?: string
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

function looksLikeStatus(value: unknown): value is MyCustomsStatus {
  const v = value as MyCustomsStatus | null
  return Boolean(v && typeof v.state === 'string' && typeof v.sentence === 'string')
}

export default function MyCustomsDestination() {
  const { subjectType = '', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { getMyCustoms } = useTradeLogisticsApi()
  const [data, setData] = useState<MyCustomsStatus | null>(null)
  const [unreadable, setUnreadable] = useState(false)

  const load = useCallback(async () => {
    setUnreadable(false)
    try {
      const view = await getMyCustoms(subjectType, subjectId)
      if (!looksLikeStatus(view)) { setData(null); setUnreadable(true); return }
      setData(view)
    } catch { setData(null); setUnreadable(true) }
  }, [getMyCustoms, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectId) void load() }, [authLoading, subjectId, load])

  if (authLoading) return <div className="p-8 text-sm text-slate-600">Loading…</div>

  if (unreadable) {
    return (
      <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6" data-testid="my-customs-unreadable">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="min-w-0 break-words">
            We could not load the customs status for your cargo just now. That is a problem reading it — it is not a report that nothing has happened.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  if (!data) return <div className="p-8 text-sm text-slate-600">Loading…</div>

  const assessment = describeAssessment(data.assessment)
  const rate = describeCustomsRate(data.assessment)
  const handoffs = describeHandoffs(data.handoffs)

  return (
    <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6" data-testid="my-customs-destination">
      <header className="min-w-0">
        <h1 className="min-w-0 break-words text-2xl font-semibold text-slate-900">Your cargo &amp; customs</h1>
        <p className="mt-2 min-w-0 break-words text-base text-slate-800" data-testid="my-customs-sentence">{data.sentence}</p>
        <p className="mt-2 min-w-0 break-words text-sm font-medium text-slate-900" data-testid="my-customs-next-action">{data.next_action}</p>
      </header>

      <div className="mt-6 space-y-4">
        {/* Who is handling it — a name and what they do. Never an internal id. */}
        <Panel title="Who is handling clearance" icon={UserCheck} testId="my-customs-agent">
          {data.agent ? (
            <>
              <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="my-customs-agent-name">{data.agent.display_name}</p>
              <p className="mt-1 min-w-0 break-words text-sm text-slate-600">{data.agent.note}</p>
            </>
          ) : (
            <p className="min-w-0 break-words text-sm text-slate-700" data-testid="my-customs-no-agent">{data.agent_note}</p>
          )}
        </Panel>

        {/* The amount, only if a source entitles it to be shown. */}
        <Panel title="Duty and tax" icon={ShieldCheck} testId="my-customs-assessment">
          <p className="min-w-0 break-words text-2xl font-semibold text-slate-900" data-testid="my-customs-amount">{assessment.amount}</p>
          <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="my-customs-assessment-detail">{assessment.detail}</p>
          <p className="mt-2 min-w-0 break-words text-xs text-slate-600" data-testid="my-customs-rate">{rate.headline}</p>
        </Panel>

        {data.payment ? (
          <Panel title="Payment" icon={ShieldCheck} testId="my-customs-payment">
            <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="my-customs-payment-headline">{data.payment.headline}</p>
            <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="my-customs-payment-detail">{data.payment.detail}</p>
          </Panel>
        ) : null}

        {data.release ? (
          <Panel title="Release" icon={ShieldCheck} testId="my-customs-release">
            <p className="min-w-0 break-words text-base font-semibold text-slate-900" data-testid="my-customs-release-headline">{data.release.headline}</p>
            <p className="mt-1 min-w-0 break-words text-sm text-slate-600" data-testid="my-customs-release-detail">{data.release.detail}</p>
          </Panel>
        ) : null}

        {handoffs.length ? (
          <Panel title="Where your cargo has got to" icon={MapPin} testId="my-customs-handoffs">
            <ul className="space-y-2">
              {handoffs.map((h) => (
                <li key={h.key} className="min-w-0 border-l-2 border-slate-200 pl-3" data-testid={`my-customs-handoff-${h.key}`}>
                  <p className="min-w-0 break-words text-sm font-medium text-slate-900">{h.label}</p>
                  <p className="min-w-0 break-words text-xs text-slate-600">{h.value}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 min-w-0 break-words text-xs text-slate-600" data-testid="my-customs-handoff-note">{GATEWAY_IS_NOT_DESTINATION}</p>
          </Panel>
        ) : null}

        {data.checklist ? (
          <Panel title="What is still needed" icon={ClipboardList} testId="my-customs-checklist">
            <ul className="space-y-2">
              {data.checklist.map((step) => (
                <li key={step.key} className="min-w-0" data-testid={`my-customs-step-${step.key}`}>
                  <p className="min-w-0 break-words text-sm font-medium text-slate-900">
                    {step.label} — <span className="font-normal text-slate-600">{STEP_STATE_UI[step.state].label}</span>
                  </p>
                  {step.needed ? <p className="min-w-0 break-words text-xs text-slate-600">{step.needed}</p> : null}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {data.timeline.length ? (
          <Panel title="What has happened" icon={ClipboardList} testId="my-customs-timeline">
            <ol className="space-y-3">
              {data.timeline.map((e, i) => (
                <li key={`${e.event_type}-${i}`} className="min-w-0 border-l-2 border-slate-200 pl-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{e.sentence}</p>
                  <p className="min-w-0 break-words text-xs text-slate-600">{STRENGTH_UI[e.strength].label}</p>
                  <p className="min-w-0 break-words text-xs text-slate-500">{when(e.event_time)}{e.location ? ` · ${e.location}` : ''}</p>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}

        <p className="min-w-0 break-words text-xs text-slate-600" data-testid="my-customs-disclaimer">{CARUP_IS_NOT_ZIMRA}</p>
        <p className="min-w-0 break-words text-xs text-slate-600" data-testid="my-customs-unknown-note">{NOTHING_RECORDED_IS_NOT_NOTHING_HAPPENED}</p>

        <Link
          className="inline-block text-sm font-medium text-blue-700 underline"
          to={`/diaspora/tracking/${subjectType}/${subjectId}`}
          data-testid="my-customs-tracking-link"
        >
          Follow the shipment itself
        </Link>
      </div>
    </section>
  )
}
