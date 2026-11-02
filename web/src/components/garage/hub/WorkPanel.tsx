import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { formatMoney } from '@/lib/garageBusiness'
import {
  categoryLabel, dateTimeLabel, hubShowsMoney, isAllowed, OWNER_AUTHORIZATION_LABEL, validateCost, validateMileage,
} from '@/lib/garageWorkspace'
import { FormError, HubSection, INPUT_CLASS, ScopedError, TEXTAREA_CLASS, type HubPanelProps } from './hubUi'

/**
 * The work itself: what has been recorded, the form to record more, and completing the job.
 *
 * Cost fields exist only for a viewer who sees money. A mechanic records what was done and the odometer
 * reading; they are not shown, and do not type, a price.
 */
export function WorkPanel({ hub, busy, run, error }: HubPanelProps) {
  const { recordServiceOnWorkOrder, recordMileageObservation, completeGarageJob } = useCarUpApi()
  const workOrder = hub.work_order
  const records = hub.service_records
  const status = String(hub.case.status).toLowerCase()
  const showMoney = hubShowsMoney(hub)
  const canRecord = isAllowed(hub, 'record_service')
  const canComplete = isAllowed(hub, 'complete_job')

  const [workPerformed, setWorkPerformed] = useState('')
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState('')
  const [mileage, setMileage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  if (!workOrder) return null
  if (!canRecord && !canComplete && records.length === 0 && status !== 'active') return null

  async function submitRecord() {
    if (!workOrder) return
    const costProblem = showMoney ? validateCost(cost, currency) : null
    const mileageProblem = validateMileage(mileage)
    if (costProblem || mileageProblem) { setFormError(costProblem || mileageProblem); return }
    setFormError(null)

    const hasCost = showMoney && cost.trim() !== ''
    const ok = await run('work', async () => {
      const res = await recordServiceOnWorkOrder(workOrder.id, {
        work_performed: workPerformed.trim() || null,
        total_cost: hasCost ? Number(cost) : null,
        currency: hasCost ? currency.trim().toUpperCase() : null,
      })
      const recordId = res?.record?.id
      // The odometer reading belongs to the record that was just written; if the record failed there is
      // nothing to attach it to, and `run` has already surfaced that failure.
      if (recordId && mileage.trim() !== '') await recordMileageObservation(String(recordId), Number(mileage))
    }, 'Recorded. This is now part of the vehicle’s service history.')
    if (ok) { setWorkPerformed(''); setCost(''); setCurrency(''); setMileage('') }
  }

  return (
    <HubSection id="work" title="The work" testId="work-panel">
      {records.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="service-records">
          {records.map((r) => (
            <li key={r.id} className="p-3 text-sm space-y-1" data-testid="service-record">
              <p className="font-medium break-words">{r.work_performed || 'No description of the work was recorded'}</p>
              <p className="text-xs text-gray-500">
                {categoryLabel(r.service_category)} · {dateTimeLabel(r.performed_at)}
              </p>
              {showMoney && (
                <p data-testid="service-record-cost">
                  Cost: {r.cost ? formatMoney(r.cost.amount, r.cost.currency) : 'Not recorded'}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600" data-testid="no-service-records">Nothing has been recorded on this job yet.</p>
      )}

      <ScopedError scope="work" error={error} />

      {canRecord && (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4" data-testid="record-form">
          <div>
            <p className="font-semibold">Record what was done</p>
            <p className="text-sm text-gray-600 mt-1">
              This becomes part of the vehicle’s permanent service history, and the owner can see it. Leave anything
              you did not measure blank — a blank is recorded as not known, which is better than a guess.
            </p>
          </div>

          <div>
            <label htmlFor="work-performed" className="block text-sm font-medium mb-1">Work performed</label>
            <textarea
              id="work-performed" rows={3} value={workPerformed} data-testid="work-performed" className={TEXTAREA_CLASS}
              onChange={(e) => setWorkPerformed(e.target.value)}
              placeholder="For example: replaced front brake pads and discs, bled brake fluid."
            />
          </div>

          {showMoney && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cost" className="block text-sm font-medium mb-1">Amount charged</label>
                <input
                  id="cost" inputMode="decimal" value={cost} data-testid="record-cost" className={INPUT_CLASS} placeholder="Optional"
                  onChange={(e) => setCost(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="currency" className="block text-sm font-medium mb-1">Currency</label>
                <input
                  id="currency" value={currency} data-testid="record-currency" maxLength={3} placeholder="USD"
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={`${INPUT_CLASS} uppercase`}
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="mileage" className="block text-sm font-medium mb-1">Odometer reading</label>
            <input
              id="mileage" inputMode="numeric" value={mileage} data-testid="record-mileage" className={INPUT_CLASS}
              placeholder="Optional, in km" onChange={(e) => setMileage(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1" data-testid="mileage-note">
              Recorded as what you saw on the day. CarUp does not change the vehicle’s odometer from this.
            </p>
          </div>

          <FormError message={formError} testId="record-form-error" />

          <Button
            className="w-full min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy}
            onClick={submitRecord} data-testid="submit-record"
          >
            {busy ? 'Saving…' : 'Save to service history'}
          </Button>
        </div>
      )}

      {status === 'active' && (
        <div className="border-t border-gray-100 pt-4 space-y-3" data-testid="complete-job-block">
          <ScopedError scope="complete" error={error} />
          {canComplete ? (
            <>
              <p className="text-sm text-gray-600">
                When the car is finished and handed back, complete the job. This finishes the job and closes the
                customer’s request; it cannot be reopened afterwards.
              </p>
              <Button
                variant="outline" className="min-h-11" disabled={busy} data-testid="complete-case"
                onClick={() => run('complete', () => completeGarageJob(hub.case.id), 'Job completed.')}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" /> Complete this job
              </Button>
            </>
          ) : (
            <p className="text-sm text-gray-700 rounded-lg bg-gray-50 p-3" data-testid="complete-blocked">
              {workOrder.owner_authorization !== 'authorized'
                ? `${OWNER_AUTHORIZATION_LABEL[workOrder.owner_authorization]}, so the job cannot be completed.`
                : records.length === 0
                  ? 'Record at least one piece of work before the job can be completed.'
                  : 'This job cannot be completed right now.'}
            </p>
          )}
        </div>
      )}
    </HubSection>
  )
}
