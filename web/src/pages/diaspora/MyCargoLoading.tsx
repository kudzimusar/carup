/**
 * Trade OS T10.3 — "Was my cargo loaded?", from the customer's side.
 *
 * One question, and the whole design follows from refusing to answer it with anything other than
 * what somebody actually recorded.
 *
 * The distinction this page exists to protect is between **nothing recorded yet** and **left
 * behind**. They look similar from the outside and mean opposite things: the first is silence, the
 * second is a decision somebody made about your goods. Collapsing them would tell a customer their
 * cargo was excluded when nobody has said anything at all — or, worse, reassure them it is fine when
 * it has been left on the dock.
 *
 * And the sentence at the bottom is the point of the whole screen: **loaded is not sailed.** That is
 * the moment a person starts assuming their goods are on their way, and T10 cannot know whether they
 * are. T11 owns that, and until it exists this page says so rather than implying movement.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Check, Clock, Loader2, Package, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type MyLoadStatus } from '@/hooks/useTradeLogisticsApi'
import { LEFT_BEHIND_UI, LOADED_IS_NOT_SAILED, PARTICIPANT_STATE_UI, cbm, shortDate, shortRef } from './loadingDisplay'

export default function MyCargoLoading() {
  const { subjectType = 'cargo_reservation', subjectId = '' } = useParams()
  const { loading: authLoading } = useAuth()
  const { getMyLoadStatus } = useTradeLogisticsApi()
  const [data, setData] = useState<MyLoadStatus | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unreadable'>('loading')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const view = await getMyLoadStatus(subjectType, subjectId)
      if (!view || typeof view !== 'object' || !view.state) throw new Error('This could not be read')
      setData(view)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This could not be read')
      setState('unreadable')
    }
  }, [getMyLoadStatus, subjectType, subjectId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && subjectId) void load() }, [authLoading, subjectId, load])

  if (authLoading || state === 'loading') {
    return <div className="flex min-h-48 items-center justify-center text-orange-600" data-testid="my-loading-spinner"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  if (state === 'unreadable' || !data) {
    return (
      <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="my-loading-unreadable">
        <h1 className="text-2xl font-bold text-slate-950">Your cargo and the container</h1>
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that your cargo was left behind.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  const ui = PARTICIPANT_STATE_UI[data.state]
  const Icon = data.state === 'LOADED' ? Check : data.state === 'LEFT_BEHIND' ? X : Clock

  return (
    <section className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="my-cargo-loading">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-orange-600">Container booking · {shortRef(data.subject.id)}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">Your cargo and the container</h1>
      </header>

      <div className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="my-loading-state">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${ui?.tone}`} data-testid="my-loading-badge">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{ui?.label}
        </span>
        <p className="mt-3 min-w-0 break-words text-sm text-slate-800" data-testid="my-loading-sentence">{data.sentence}</p>

        {data.state === 'LOADED' ? (
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-slate-500">Volume recorded</dt>
              {/* Unknown stays unknown — never 0.000. */}
              <dd className="min-w-0 break-words text-slate-800" data-testid="my-loading-volume">{cbm(data.loaded_volume_cbm ?? null)}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-slate-500">When</dt>
              <dd className="min-w-0 break-words text-slate-800" data-testid="my-loading-when">{shortDate(data.loaded_at)}</dd>
            </div>
          </dl>
        ) : null}

        {data.state === 'LEFT_BEHIND' ? (
          <Alert className="mt-3 border-amber-200 bg-amber-50" data-testid="my-loading-reason">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="min-w-0 break-words text-amber-900">
              <strong className="font-semibold">Why: </strong>
              {LEFT_BEHIND_UI[data.left_behind_reason || ''] || 'The organiser has not given a reason.'}
              {/* T10 records that it did not travel. What happens next is somebody's decision, and
                  this page must not invent one. */}
              <span className="mt-1 block text-xs text-amber-800">
                What happens to it next is arranged with the organiser. Nothing has been decided here.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {data.state === 'NOT_RECORDED' ? (
          <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="my-loading-not-recorded-note">
            This is not the same as being left behind — it means nobody has written anything down
            about your cargo yet.
          </p>
        ) : null}
      </div>

      <Link
        to={`/diaspora/cargo/${encodeURIComponent(data.subject.type)}/${encodeURIComponent(data.subject.id)}`}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
        data-testid="my-loading-cargo-link"
      >
        <Package className="h-4 w-4 shrink-0" aria-hidden="true" />What the warehouse recorded about this cargo
      </Link>

      {/* The sentence the whole page exists for. */}
      <p className="mt-6 min-w-0 break-words text-xs text-slate-500" data-testid="my-loading-disclaimer">
        {data.note || LOADED_IS_NOT_SAILED} Where the container is, and when it sails, is recorded
        separately and is not shown here.
      </p>
    </section>
  )
}
