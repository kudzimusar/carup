import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, Car, ClipboardList, UserCog, CheckCircle2 } from 'lucide-react'
import { useCarUpApi, type ServiceCaseView } from '@/hooks/useCarUpApi'
import {
  caseStatusLabel,
  categoryLabel,
  isTerminalCase,
  mechanicLabel,
  nextActionFor,
  nextActionLabel,
  STATUS_TONE,
  validateCost,
  validateMileage,
  vehicleLabel,
  whenLabel,
  type QueueCase,
} from '@/lib/garageWorkspace'

/**
 * One job, start to finish (R5).
 *
 * Owner UAT: accept, decline, job cards, mechanic assignment, service records and mileage
 * observations were all certified backend capabilities with no way to reach them. This screen is
 * the whole operator loop and nothing more — it is not a garage ERP, and it deliberately has no
 * quoting, no scheduling, no invoicing and no parts ordering.
 *
 * Two rules run through it:
 *   - only the action the case is actually waiting for is offered, so an operator is never given a
 *     button that will come back 409;
 *   - a completed, declined or withdrawn case is history and is shown read-only.
 *
 * Mileage entered here is an OBSERVATION recorded against the service record. It does not change
 * the vehicle's odometer, and the screen says so where it is typed.
 */

/**
 * The case projection, as the route returns it.
 *
 * Imported rather than re-declared: a local copy is how the two drift, and CI caught exactly that —
 * a locally-declared `conversation_thread_id: string | null` against the hook's optional field.
 */
type CaseView = ServiceCaseView

type Mechanic = { user_id: string; display_name: string | null; role: string | null }

export default function GarageCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const api = useCarUpApi()
  const {
    fetchServiceRequest, fetchGarageQueue, fetchGarageMechanics, fetchWorkOrderAssignment,
    acceptServiceCase, declineServiceCase, startServiceCase, completeServiceCase,
    openWorkOrderForCase, assignMechanicToWorkOrder, unassignMechanicFromWorkOrder,
    recordServiceOnWorkOrder, recordMileageObservation,
  } = api

  const [caseView, setCaseView] = useState<CaseView | null>(null)
  const [queueRow, setQueueRow] = useState<QueueCase | null>(null)
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Record-service form
  const [workPerformed, setWorkPerformed] = useState('')
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState('')
  const [mileage, setMileage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!caseId) return Promise.resolve()
    return fetchServiceRequest(caseId)
      .then((detail) => {
        const view = (detail?.case ?? detail) as CaseView
        setCaseView(view)
        // The case projection carries no work-order id, so the queue — filtered to this case's own
        // status so a finished job is found too — is where the job card is discovered. Reading it
        // is the alternative to calling the idempotent create endpoint, which would OPEN a job card
        // as a side effect of viewing the page.
        return fetchGarageQueue(view.status)
          .catch(() => null)
          .then((queue) => {
            setQueueRow(((queue?.queue || []) as QueueCase[]).find((q) => q.id === caseId) ?? null)
            setState('ready')
          })
      })
      .catch(() => { setState('error') })
  }, [caseId, fetchServiceRequest, fetchGarageQueue])

  useEffect(() => { load() }, [load])

  // The garage's own members, so a mechanic is picked rather than a UUID typed.
  useEffect(() => {
    let mounted = true
    fetchGarageMechanics()
      .then((res) => { if (mounted) setMechanics((res?.mechanics || []) as Mechanic[]) })
      .catch(() => { if (mounted) setMechanics([]) })
    return () => { mounted = false }
  }, [fetchGarageMechanics])

  const workOrderId = queueRow?.work_order?.id ?? null

  useEffect(() => {
    let mounted = true
    // No job card means nobody can be assigned, and `assignedTo` is derived below rather than
    // cleared here — a synchronous setState in an effect body cascades a render for nothing.
    if (!workOrderId) return () => { mounted = false }
    fetchWorkOrderAssignment(workOrderId)
      .then((res) => { if (mounted) setAssignedTo(res?.assigned_mechanic_user_id ?? null) })
      .catch(() => { if (mounted) setAssignedTo(null) })
    return () => { mounted = false }
  }, [workOrderId, fetchWorkOrderAssignment])

  /** Every mutation goes through here so a refusal is always shown in the operator's words. */
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(success)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That did not go through. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  async function submitRecord() {
    if (!workOrderId) return
    const costProblem = validateCost(cost, currency)
    const mileageProblem = validateMileage(mileage)
    if (costProblem || mileageProblem) { setFormError(costProblem || mileageProblem); return }
    setFormError(null)

    await act(async () => {
      const res = await recordServiceOnWorkOrder(workOrderId, {
        work_performed: workPerformed.trim() || null,
        total_cost: cost.trim() === '' ? null : Number(cost),
        currency: cost.trim() === '' ? null : currency.trim().toUpperCase(),
      })
      const recordId = res?.record?.id
      // The mileage reading belongs to the record that was just written; if the record failed there
      // is nothing to attach it to, and act() has already surfaced that failure.
      if (recordId && mileage.trim() !== '') {
        await recordMileageObservation(String(recordId), Number(mileage))
      }
      setWorkPerformed(''); setCost(''); setCurrency(''); setMileage('')
    }, 'Recorded. This is now part of the vehicle’s service history.')
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        <span className="text-sm text-gray-600">Loading this job…</span>
      </div>
    )
  }

  if (state === 'error' || !caseView) {
    return (
      <Card className="border-0 card-shadow max-w-2xl mx-auto" data-testid="case-error">
        <CardContent className="p-6 text-center">
          <p className="font-semibold text-gray-800">This job could not be opened</p>
          <p className="text-sm text-gray-500 mt-1">
            It may not belong to your garage, or it could not be loaded right now.
          </p>
          <Link to="/garage"><Button variant="outline" className="mt-4 min-h-11">Back to the workshop</Button></Link>
        </CardContent>
      </Card>
    )
  }

  // Without a job card there is no assignment, whatever a previous read left behind.
  const assignedMechanicId = workOrderId ? assignedTo : null
  const terminal = isTerminalCase(caseView.status)
  const next = nextActionFor(caseView.status, Boolean(workOrderId))

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>

      <Card className="border-0 card-shadow">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex items-center gap-2" data-testid="case-vehicle">
                <Car className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
                {vehicleLabel(queueRow?.vehicle ?? null, caseView.vin)}
              </h1>
              <p className="text-sm text-gray-500 mt-1" data-testid="case-vin">{caseView.vin}</p>
            </div>
            <Badge className={STATUS_TONE[String(caseView.status).toLowerCase()]} data-testid="case-status">
              {caseStatusLabel(caseView.status)}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4">
            <div><dt className="text-gray-500">What it is about</dt>
              <dd data-testid="case-category">{categoryLabel(caseView.service_category)}</dd></div>
            <div><dt className="text-gray-500">Requested</dt>
              <dd>{whenLabel(caseView.requested_at)}</dd></div>
          </dl>

          {caseView.request_summary && (
            <p className="text-sm text-gray-700 mt-4 border-l-2 border-gray-200 pl-3" data-testid="case-summary">
              {caseView.request_summary}
            </p>
          )}

          <p className="text-sm text-gray-700 mt-4 font-medium" data-testid="case-next-action">
            {nextActionLabel(next)}
          </p>
        </CardContent>
      </Card>

      {notice && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status" data-testid="case-notice">{notice}</p>
      )}
      {actionError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="case-action-error">{actionError}</p>
      )}

      {terminal ? (
        <Card className="border-0 card-shadow" data-testid="case-closed">
          <CardContent className="p-5 text-sm text-gray-600">
            This job is {caseStatusLabel(caseView.status).toLowerCase()} and is kept as history. It
            cannot be reopened, and what was recorded on it stays as it was recorded.
          </CardContent>
        </Card>
      ) : (
        <>
          {next === 'accept_or_decline' && (
            <Card className="border-0 card-shadow">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Can you take this job?</p>
                <p className="text-sm text-gray-600">
                  Accepting tells the customer you will look at the car. It does not commit you to a
                  price — CarUp does not carry quotes.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy}
                    data-testid="accept-case"
                    onClick={() => act(() => acceptServiceCase(caseView.id), 'Accepted. The customer can see this.')}
                  >
                    Accept this job
                  </Button>
                  <Button
                    variant="outline" className="min-h-11" disabled={busy} data-testid="decline-case"
                    onClick={() => act(() => declineServiceCase(caseView.id, 'garage_declined'), 'Declined. The customer can see this.')}
                  >
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {next === 'open_work_order' && (
            <Card className="border-0 card-shadow">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-gray-400" aria-hidden="true" /> Open a job card
                </p>
                <p className="text-sm text-gray-600">
                  The job card is what a mechanic is assigned to and what work gets recorded against.
                </p>
                <Button
                  className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy}
                  data-testid="open-work-order"
                  onClick={() => act(() => openWorkOrderForCase(caseView.id), 'Job card opened.')}
                >
                  Open job card
                </Button>
              </CardContent>
            </Card>
          )}

          {workOrderId && (
            <Card className="border-0 card-shadow" data-testid="assignment-panel">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold flex items-center gap-2">
                  <UserCog className="w-4 h-4 text-gray-400" aria-hidden="true" /> Who is doing the work
                </p>

                {assignedMechanicId ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm" data-testid="assigned-mechanic">
                      {mechanicLabel(mechanics.find((m) => m.user_id === assignedMechanicId) ?? { user_id: assignedMechanicId })}
                    </p>
                    <Button
                      variant="outline" className="min-h-11" disabled={busy} data-testid="unassign-mechanic"
                      onClick={() => act(() => unassignMechanicFromWorkOrder(workOrderId), 'Unassigned.')}
                    >
                      Unassign
                    </Button>
                  </div>
                ) : mechanics.length === 0 ? (
                  <p className="text-sm text-gray-600" data-testid="no-mechanics">
                    Nobody else is on your garage’s CarUp account yet, so there is no one to assign
                    this to. You can still record the work yourself.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm flex-1 min-w-[12rem]"
                      data-testid="mechanic-select" defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value
                        if (id) act(() => assignMechanicToWorkOrder(workOrderId, id), 'Assigned.')
                      }}
                      aria-label="Assign a mechanic"
                    >
                      <option value="">Choose a mechanic</option>
                      {mechanics.map((m) => (
                        <option key={m.user_id} value={m.user_id}>{mechanicLabel(m)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {next === 'start_work' && (
            <Card className="border-0 card-shadow">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Is the car in the workshop?</p>
                <Button
                  className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="start-work"
                  onClick={() => act(() => startServiceCase(caseView.id), 'Started. The customer can see the car is being worked on.')}
                >
                  Start work
                </Button>
              </CardContent>
            </Card>
          )}

          {next === 'record_service' && workOrderId && (
            <Card className="border-0 card-shadow">
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="font-semibold">Record what was done</p>
                  <p className="text-sm text-gray-600 mt-1">
                    This becomes part of the vehicle’s permanent service history, and the owner can
                    see it. Leave anything you did not measure blank — a blank is recorded as not
                    known, which is better than a guess.
                  </p>
                </div>

                <div>
                  <label htmlFor="work-performed" className="block text-sm font-medium mb-1">Work performed</label>
                  <textarea
                    id="work-performed" rows={3} value={workPerformed} data-testid="work-performed"
                    onChange={(e) => setWorkPerformed(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                    placeholder="For example: replaced front brake pads and discs, bled brake fluid."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cost" className="block text-sm font-medium mb-1">Amount charged</label>
                    <input
                      id="cost" inputMode="decimal" value={cost} data-testid="record-cost"
                      onChange={(e) => setCost(e.target.value)}
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm" placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label htmlFor="currency" className="block text-sm font-medium mb-1">Currency</label>
                    <input
                      id="currency" value={currency} data-testid="record-currency" maxLength={3}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm uppercase" placeholder="USD"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="mileage" className="block text-sm font-medium mb-1">Odometer reading</label>
                  <input
                    id="mileage" inputMode="numeric" value={mileage} data-testid="record-mileage"
                    onChange={(e) => setMileage(e.target.value)}
                    className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm" placeholder="Optional, in km"
                  />
                  <p className="text-xs text-gray-500 mt-1" data-testid="mileage-note">
                    Recorded as what you saw on the day. CarUp does not change the vehicle’s odometer
                    from this.
                  </p>
                </div>

                {formError && (
                  <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="record-form-error">
                    {formError}
                  </p>
                )}

                <Button
                  className="w-full min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy}
                  onClick={submitRecord} data-testid="submit-record"
                >
                  {busy ? 'Saving…' : 'Save to service history'}
                </Button>

                <div className="border-t pt-4">
                  <p className="text-sm text-gray-600 mb-3">
                    When the car is finished and handed back, close the job.
                  </p>
                  <Button
                    variant="outline" className="min-h-11" disabled={busy} data-testid="complete-case"
                    onClick={() => act(() => completeServiceCase(caseView.id), 'Job completed.')}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" /> Mark this job complete
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
