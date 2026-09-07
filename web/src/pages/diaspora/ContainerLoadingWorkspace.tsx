/**
 * Trade OS T10.3 — the operator's loading workspace.
 *
 * Before this, T10's services were reachable by HTTP and by nothing a person uses. A phase whose
 * central act can only be performed with curl is not a phase that has been built — that is the exact
 * gap that kept T9 from being accepted at its first candidate.
 *
 * Three decisions carry the screen:
 *
 *  1. **Readiness shows its reasons, and whose they are.** "Not ready" alone gives an operator
 *     nothing to do. Every blocker names the phase that owns it, so they can see whether to chase
 *     the warehouse, the booking, or nobody.
 *
 *  2. **The plan and the manifest are two panels, not one list with a checkbox.** Planning to put
 *     something in a container and putting it in are different acts by different people at different
 *     times, and a UI that merges them is how a plan silently becomes a claim about reality.
 *
 *  3. **Capacity pressure is shown while the plan is being built**, not sprung as a refusal at
 *     confirmation. The refusal still exists — an impossible plan is refused — but an operator
 *     should watch the room run out rather than discover it.
 *
 * What this screen will never say: departed, in transit, arrived, customs. T10 cannot know them, and
 * the footer says so in words rather than relying on their absence.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Check, ClipboardList, Container, Loader2, Package, Ship, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi, type ContainerLoadState, type LoadCandidate } from '@/hooks/useTradeLogisticsApi'
import {
  EXCLUSION_UI,
  LEFT_BEHIND_UI,
  LOADED_IS_NOT_SAILED,
  LOAD_STATUS_UI,
  PLAN_STATUS_UI,
  cbm,
  describePressure,
  describeReadiness,
  describeSource,
  shortDate,
  shortRef,
} from './loadingDisplay'

function Panel({ title, icon: Icon, children, testId }: {
  title: string; icon: typeof Box; children: React.ReactNode; testId?: string
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

export default function ContainerLoadingWorkspace() {
  const { loading: authLoading } = useAuth()
  const api = useTradeLogisticsApi()
  const [containerId, setContainerId] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [state, setState] = useState<ContainerLoadState | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'unreadable'>('idle')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (id: string) => {
    setPhase('loading')
    try {
      const data = await api.getContainerLoadState(id)
      // Guard the shape: an unrecognised payload must not crash the operator's screen.
      if (!data || !data.container || !Array.isArray(data.candidates)) {
        throw new Error('This sailing’s loading state could not be read')
      }
      setState(data)
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This sailing’s loading state could not be read')
      setPhase('unreadable')
    }
  }, [api])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && submitted) void load(submitted) }, [authLoading, submitted, load])

  const act = useCallback(async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setActionError(''); setNotice('')
    try {
      await fn()
      setNotice(success)
      await load(submitted)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That could not be recorded')
    } finally {
      setBusy(false)
    }
  }, [load, submitted])

  const manifestBySubject = useMemo(() => {
    const map = new Map<string, ContainerLoadState['load'] extends null ? never : NonNullable<ContainerLoadState['load']>['items'][number]>()
    for (const i of state?.load?.items || []) map.set(i.subject.id, i)
    return map
  }, [state])

  const planBySubject = useMemo(() => {
    const map = new Map<string, NonNullable<ContainerLoadState['plan']>['items'][number]>()
    for (const i of state?.plan?.items || []) map.set(i.subject.id, i)
    return map
  }, [state])

  if (authLoading) {
    return <div className="flex min-h-48 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <section className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="container-loading-workspace">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Loading a container</h1>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          What is ready to go in, what you plan to put in, and what actually went in.
        </p>
      </header>

      <form
        className="mt-5 flex min-w-0 flex-col gap-2 sm:flex-row"
        data-testid="loading-sailing-form"
        onSubmit={(e) => { e.preventDefault(); setSubmitted(containerId.trim()); setNotice(''); setActionError('') }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="container-id" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sailing reference</Label>
          <Input id="container-id" value={containerId} onChange={(e) => setContainerId(e.target.value)} placeholder="Container booking id" className="mt-1" data-testid="loading-sailing-input" />
        </div>
        <Button type="submit" className="shrink-0 self-end" disabled={!containerId.trim()} data-testid="loading-sailing-submit">Open</Button>
      </form>

      {notice ? <Alert className="mt-4 border-emerald-200 bg-emerald-50" data-testid="loading-notice"><AlertDescription className="text-emerald-900">{notice}</AlertDescription></Alert> : null}
      {actionError ? <Alert className="mt-4 border-red-200 bg-red-50" data-testid="loading-error"><AlertDescription className="min-w-0 break-words text-red-900">{actionError}</AlertDescription></Alert> : null}

      {phase === 'loading' ? (
        <div className="mt-8 flex justify-center text-orange-600" data-testid="loading-state-loading"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : null}

      {phase === 'unreadable' ? (
        <Alert className="mt-6 border-amber-200 bg-amber-50" data-testid="loading-unreadable">
          <AlertDescription className="min-w-0 break-words">
            {error} That is not a report that this sailing has nothing in it.
          </AlertDescription>
        </Alert>
      ) : null}

      {phase === 'ready' && state ? (
        <div className="mt-6 space-y-5">
          {/* ── The sailing ── */}
          <Panel title="This sailing" icon={Ship} testId="loading-sailing">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              <span className="min-w-0 break-all font-mono text-xs text-slate-700">{state.container.reference}</span>
              <span className="text-slate-600">Status: <span className="font-semibold text-slate-900">{state.container.status}</span></span>
              <span className="text-slate-600" data-testid="loading-booked-capacity">
                Booked: {state.container.booked_capacity.used_cbm.toFixed(3)} of {state.container.booked_capacity.total_cbm.toFixed(3)} CBM
              </span>
            </div>
            {/* T5's numbers, labelled so nothing mistakes them for actuals. */}
            <p className="mt-1 min-w-0 break-words text-xs text-slate-500">{state.container.booked_capacity.basis}</p>
          </Panel>

          {/* ── Readiness ── */}
          <Panel title={`Ready to load — ${state.summary.ready} of ${state.summary.total}`} icon={ClipboardList} testId="loading-readiness">
            {!state.candidates.length ? (
              <p className="text-sm text-slate-600">Nothing is booked on this sailing.</p>
            ) : (
              <ul className="space-y-2">
                {state.candidates.map((c: LoadCandidate) => {
                  const r = describeReadiness(c.readiness)
                  const planned = planBySubject.get(c.subject.id)
                  const manifest = manifestBySubject.get(c.subject.id)
                  return (
                    <li key={c.subject.id} className="min-w-0 rounded-lg border border-slate-200 p-3" data-testid={`candidate-${c.subject.id}`}>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-all font-mono text-xs text-slate-700">{c.reference}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${r.tone}`}>{r.label}</span>
                      </div>
                      {/* Booked and measured side by side — the operator is the person best placed
                          to notice they differ. */}
                      <p className="mt-1 min-w-0 break-words text-xs text-slate-600" data-testid={`candidate-figures-${c.subject.id}`}>
                        Booked {cbm(c.booked_volume_cbm)} · Warehouse {cbm(c.warehouse_volume_cbm)}
                      </p>
                      {r.reasons.length ? (
                        <ul className="mt-1 space-y-0.5" data-testid={`candidate-blockers-${c.subject.id}`}>
                          {r.reasons.map((reason) => (
                            <li key={reason} className="min-w-0 break-words text-xs text-amber-700">· {reason}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                        {state.plan && state.plan.status === 'DRAFT' ? (
                          <>
                            <Button
                              type="button" size="sm" variant="outline" disabled={busy}
                              data-testid={`plan-in-${c.subject.id}`}
                              onClick={() => act(() => api.setLoadPlanItem(state.plan!.id, { subjectId: c.subject.id, disposition: 'PLANNED_IN' }), 'Added to the plan.')}
                            >Plan in</Button>
                            <select
                              className="h-8 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"
                              data-testid={`plan-out-${c.subject.id}`}
                              value=""
                              onChange={(e) => { if (e.target.value) act(() => api.setLoadPlanItem(state.plan!.id, { subjectId: c.subject.id, disposition: 'PLANNED_OUT', exclusionReason: e.target.value }), 'Left off the plan, with a reason.') }}
                            >
                              <option value="">Leave off the plan…</option>
                              {Object.entries(EXCLUSION_UI).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                            </select>
                          </>
                        ) : null}
                        {planned ? (
                          <span className="min-w-0 break-words text-xs text-slate-500" data-testid={`planned-${c.subject.id}`}>
                            {planned.disposition === 'PLANNED_IN'
                              ? `Planned: ${cbm(planned.planned_volume_cbm)} ${describeSource(planned.planned_source)}`
                              : `Left off: ${EXCLUSION_UI[planned.exclusion_reason || ''] || planned.exclusion_reason}`}
                          </span>
                        ) : null}
                        {manifest ? (
                          <span className={`min-w-0 break-words text-xs font-semibold ${manifest.outcome === 'LOADED' ? 'text-emerald-700' : 'text-amber-700'}`} data-testid={`manifest-${c.subject.id}`}>
                            {manifest.outcome === 'LOADED' ? `Loaded ${cbm(manifest.loaded_volume_cbm)}` : `Left behind — ${LEFT_BEHIND_UI[manifest.left_behind_reason || ''] || manifest.left_behind_reason}`}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="loading-readiness-disclaimer">
              {state.candidates[0]?.readiness.disclaimer
                || 'Ready to load means the cargo is here, measured and booked. It is not a statement about customs, duties or any legal permission to travel.'}
            </p>
          </Panel>

          {/* ── The plan ── */}
          <Panel title="The plan" icon={Box} testId="loading-plan">
            {!state.plan ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">No plan yet. A plan says what you intend to put in — it does not put anything in.</p>
                <Button type="button" disabled={busy} data-testid="create-plan" onClick={() => act(() => api.createLoadPlan(state.container.id), 'Plan started.')}>
                  Start a plan
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="min-w-0 break-all font-mono text-xs text-slate-700">{state.plan.reference}</span>
                  <span className="text-slate-600">{PLAN_STATUS_UI[state.plan.status] || state.plan.status}</span>
                  <span className="text-slate-600">{state.plan.items.filter((i) => i.disposition === 'PLANNED_IN').length} planned in</span>
                </div>

                {/* Pressure shown while building, not sprung at confirmation. */}
                {(() => {
                  const p = describePressure(state.plan!.pressure)
                  if (!p) return null
                  return (
                    <div className={`min-w-0 rounded-lg border p-3 ${p.tone === 'attention' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} data-testid="loading-pressure">
                      <p className={`break-words text-sm font-semibold ${p.tone === 'attention' ? 'text-amber-900' : 'text-slate-800'}`}>{p.headline}</p>
                      <p className="mt-0.5 min-w-0 break-words text-sm text-slate-600">{p.detail}</p>
                    </div>
                  )
                })()}

                {state.plan.status === 'DRAFT' ? (
                  <Button type="button" disabled={busy} data-testid="confirm-plan" onClick={() => act(() => api.confirmLoadPlan(state.plan!.id), 'Plan confirmed.')}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm the plan
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500" data-testid="plan-confirmed-at">Confirmed {shortDate(state.plan.confirmed_at)}</p>
                )}
              </div>
            )}
          </Panel>

          {/* ── Actual loading ── */}
          <Panel title="What actually went in" icon={Container} testId="loading-actual">
            {!state.load ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Loading has not started. Recording a load is separate from planning one — this is where you write down what you watched go in.
                </p>
                <Button type="button" disabled={busy} data-testid="open-load" onClick={() => act(() => api.openLoad(state.container.id), 'Loading started.')}>
                  Start loading
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="min-w-0 break-all font-mono text-xs text-slate-700">{state.load.reference}</span>
                  <span className="text-slate-600" data-testid="load-status">{LOAD_STATUS_UI[state.load.status] || state.load.status}</span>
                  <span className="text-slate-600" data-testid="load-total">Loaded total: {cbm(state.load.actual_loaded_volume_cbm)}</span>
                </div>

                {state.load.status === 'IN_PROGRESS' ? (
                  <LoadItemForm
                    candidates={state.candidates}
                    busy={busy}
                    onRecord={(payload) => act(() => api.recordLoadItem(state.load!.id, payload), 'Recorded.')}
                  />
                ) : null}

                {state.load.items.length ? (
                  <ul className="space-y-1" data-testid="load-manifest">
                    {state.load.items.map((i) => (
                      <li key={i.subject.id} className="min-w-0 break-words text-sm text-slate-700">
                        <span className="font-mono text-xs">{shortRef(i.subject.id)}</span>{' '}
                        {i.outcome === 'LOADED'
                          ? <>loaded {cbm(i.loaded_volume_cbm)} · {shortDate(i.loaded_at)}</>
                          : <span className="text-amber-700">left behind — {LEFT_BEHIND_UI[i.left_behind_reason || ''] || i.left_behind_reason}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-slate-600">Nothing recorded yet.</p>}

                {state.load.status === 'IN_PROGRESS' && state.load.items.some((i) => i.outcome === 'LOADED') ? (
                  <Button type="button" disabled={busy} data-testid="complete-load" onClick={() => act(() => api.completeLoad(state.load!.id), 'Loading completed.')}>
                    Complete loading
                  </Button>
                ) : null}
              </div>
            )}
          </Panel>

          {/* ── Container and seal ── */}
          {state.load ? (
            <Panel title="Container and seal" icon={Package} testId="loading-seal">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Container number</dt>
                  {/* Unknown stays unknown. A plausible number invented here is one somebody will
                      later quote to a shipping line. */}
                  <dd className="min-w-0 break-all text-sm text-slate-900" data-testid="seal-container-number">{state.load.container_number || 'Not recorded'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Seal</dt>
                  <dd className="min-w-0 break-all text-sm text-slate-900" data-testid="seal-number">{state.load.seal_number || 'Not recorded'}</dd>
                </div>
              </dl>
              {state.load.seal_history > 1 ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="seal-history">
                  {state.load.seal_history} records kept. Earlier container and seal numbers stay on the record with who wrote them down.
                </p>
              ) : null}
              <SealForm busy={busy} onRecord={(payload) => act(() => api.recordSeal(state.load!.id, payload), 'Recorded.')} />
              <Link
                to={`/diaspora/documents/container_load/${encodeURIComponent(state.load.id)}`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
                data-testid="loading-evidence-link"
              >
                <Package className="h-4 w-4 shrink-0" aria-hidden="true" />Loading photos and paperwork
              </Link>
            </Panel>
          ) : null}

          <p className="min-w-0 break-words text-xs text-slate-500" data-testid="loading-disclaimer">{state.note}</p>
        </div>
      ) : null}
    </section>
  )
}

/** Recording what went in — deliberately its own act, with its own submit. */
function LoadItemForm({ candidates, busy, onRecord }: {
  candidates: LoadCandidate[]
  busy: boolean
  onRecord: (payload: { subjectId: string; outcome: 'LOADED' | 'LEFT_BEHIND'; loadedVolumeCbm?: number | null; leftBehindReason?: string | null }) => void
}) {
  const [subjectId, setSubjectId] = useState('')
  const [outcome, setOutcome] = useState<'LOADED' | 'LEFT_BEHIND'>('LOADED')
  const [volume, setVolume] = useState('')
  const [reason, setReason] = useState('')

  return (
    <form
      className="min-w-0 rounded-lg border border-slate-200 p-3"
      data-testid="load-item-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!subjectId) return
        onRecord({
          subjectId,
          outcome,
          loadedVolumeCbm: outcome === 'LOADED' && volume !== '' ? Number(volume) : null,
          leftBehindReason: outcome === 'LEFT_BEHIND' ? reason : null,
        })
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="load-subject" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consignment</Label>
          <select id="load-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="load-item-subject">
            <option value="">Choose…</option>
            {candidates.map((c) => <option key={c.subject.id} value={c.subject.id}>{c.reference}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="load-outcome" className="text-xs font-semibold uppercase tracking-wide text-slate-500">What happened</Label>
          <select id="load-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as 'LOADED' | 'LEFT_BEHIND')} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="load-item-outcome">
            <option value="LOADED">It went in</option>
            <option value="LEFT_BEHIND">It did not go in</option>
          </select>
        </div>
      </div>
      {outcome === 'LOADED' ? (
        <div className="mt-2 min-w-0">
          <Label htmlFor="load-volume" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Volume that went in (optional)</Label>
          <Input id="load-volume" type="number" step="0.001" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Leave blank to use the warehouse measurement" className="mt-1" data-testid="load-item-volume" />
        </div>
      ) : (
        <div className="mt-2 min-w-0">
          <Label htmlFor="load-reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why not — the customer will read this</Label>
          <select id="load-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm" data-testid="load-item-reason">
            <option value="">Choose a reason…</option>
            {Object.entries(LEFT_BEHIND_UI).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
      )}
      <Button type="submit" size="sm" className="mt-3" disabled={busy || !subjectId || (outcome === 'LEFT_BEHIND' && !reason)} data-testid="load-item-submit">
        {outcome === 'LOADED' ? <Check className="mr-2 h-4 w-4" /> : <X className="mr-2 h-4 w-4" />}Record it
      </Button>
    </form>
  )
}

function SealForm({ busy, onRecord }: {
  busy: boolean
  onRecord: (payload: { containerNumber?: string | null; sealNumber?: string | null; recordReason?: 'OBSERVED' | 'CORRECTED' | 'SEAL_REPLACED'; reasonNote?: string | null }) => void
}) {
  const [containerNumber, setContainerNumber] = useState('')
  const [sealNumber, setSealNumber] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [note, setNote] = useState('')

  return (
    <form
      className="mt-3 min-w-0 rounded-lg border border-slate-200 p-3"
      data-testid="seal-form"
      onSubmit={(e) => {
        e.preventDefault()
        onRecord({
          containerNumber: containerNumber.trim() || null,
          sealNumber: sealNumber.trim() || null,
          recordReason: replacing ? 'SEAL_REPLACED' : 'OBSERVED',
          reasonNote: replacing ? note : null,
        })
      }}
    >
      <p className="min-w-0 break-words text-xs text-slate-600">
        Record these only when you have actually seen them. A number invented to fill the box is one somebody will later quote to a shipping line.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} placeholder="Container number" className="min-w-0" data-testid="seal-container-input" />
        <Input value={sealNumber} onChange={(e) => setSealNumber(e.target.value)} placeholder="Seal number" className="min-w-0" data-testid="seal-seal-input" />
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={replacing} onChange={(e) => setReplacing(e.target.checked)} data-testid="seal-replacing" />
        This replaces a seal that was already recorded
      </label>
      {replacing ? (
        <div className="mt-2 min-w-0">
          <Label htmlFor="seal-note" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it was replaced</Label>
          <Input id="seal-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" data-testid="seal-note" />
        </div>
      ) : null}
      <Button type="submit" size="sm" variant="outline" className="mt-3" disabled={busy || (!containerNumber.trim() && !sealNumber.trim()) || (replacing && !note.trim())} data-testid="seal-submit">
        Record
      </Button>
      {/* Marked as a disclaimer so certification can tell a page STATING the boundary from a page
          CROSSING it. Without the marker a scanner sees the word "sailed" and cannot tell which. */}
      <p className="mt-2 min-w-0 break-words text-xs text-slate-500" data-testid="seal-loaded-disclaimer">{LOADED_IS_NOT_SAILED}</p>
    </form>
  )
}
