import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  ESTIMATE_STATUS_LABEL, formatMoney,
  type AllowedAction, type EstimateDraftInput, type EstimateTotalState, type GarageEstimate,
} from '@/lib/garageBusiness'
import { categoryLabel, dateTimeLabel, hubShowsMoney, isAllowed, OWNER_AUTHORIZATION_LABEL } from '@/lib/garageWorkspace'
import { EstimateForm } from './EstimateForm'
import { HubSection, INPUT_CLASS, ScopedError, type HubPanelProps } from './hubUi'

const TOTAL_STATE_LABEL: Record<EstimateTotalState, string> = {
  not_recorded: 'No price has been recorded yet',
  draft_total: 'Draft total — it can still change',
  frozen_at_send: 'Fixed when it was sent',
  // never shown: a hidden total is rendered as nothing at all (see `canSeeMoney`)
  hidden: 'Not shown to your role',
}

/**
 * Prices appear only when the hub says money is visible AND this version was not redacted by the server.
 * A hidden price is rendered as NOTHING — "Not recorded" would claim the record has no price, which is false.
 */
const canSeeMoney = (hubMoney: boolean, estimate: GarageEstimate) => hubMoney && estimate.money_visible !== false && estimate.total_state !== 'hidden'

const ESTIMATE_ACTIONS: AllowedAction[] = ['prepare_estimate', 'edit_estimate', 'send_estimate', 'cancel_estimate', 'revise_estimate']

function EstimateView({ estimate, hubMoney }: { estimate: GarageEstimate; hubMoney: boolean }) {
  const showMoney = canSeeMoney(hubMoney, estimate)
  return (
    <div className="space-y-3" data-testid="estimate-latest">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Version {estimate.version}</h3>
        <Badge variant="outline" data-testid="estimate-status">{ESTIMATE_STATUS_LABEL[estimate.status]}</Badge>
        {estimate.expired && <Badge variant="outline" data-testid="estimate-expired">Expired</Badge>}
      </div>
      <p className="text-xs text-gray-500">
        {estimate.sent_at ? `Sent ${dateTimeLabel(estimate.sent_at)}` : 'Not sent yet'}
        {estimate.valid_until ? ` · valid until ${dateTimeLabel(estimate.valid_until)}` : ''}
      </p>

      {estimate.lines.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="estimate-no-lines">This estimate has no lines yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="estimate-lines">
          {estimate.lines.map((line) => (
            <li key={line.line_no} className="p-3 text-sm" data-testid="estimate-line-row">
              <p className="font-medium break-words">{line.description}</p>
              <p className="text-xs text-gray-500">
                {categoryLabel(line.category)} · quantity {line.quantity}
                {showMoney && (
                  <> · unit price {line.price_recorded ? formatMoney(line.unit_price, estimate.currency) : 'Not recorded'}</>
                )}
              </p>
              {showMoney && (
                <p className="text-sm mt-1" data-testid="estimate-line-total">
                  Line total: {line.price_recorded ? formatMoney(line.line_total, estimate.currency) : 'Not recorded'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {showMoney && (
        <p className="text-sm" data-testid="estimate-total">
          <span className="font-semibold">Total: {formatMoney(estimate.total_amount, estimate.currency)}</span>
          <span className="text-gray-500"> — {TOTAL_STATE_LABEL[estimate.total_state]}</span>
        </p>
      )}

      {estimate.customer_note && (
        <p className="text-sm text-gray-700 border-l-2 border-gray-200 pl-3 break-words" data-testid="estimate-customer-note-view">
          <span className="block text-xs text-gray-500">Note to the customer</span>
          {estimate.customer_note}
        </p>
      )}
      {showMoney && estimate.internal_note && (
        <p className="text-sm text-gray-700 border-l-2 border-amber-300 pl-3 break-words" data-testid="estimate-internal-note-view">
          <span className="block text-xs text-gray-500">Internal note — the customer never sees this</span>
          {estimate.internal_note}
        </p>
      )}

      {(estimate.status === 'accepted' || estimate.status === 'declined') && (
        <p className="text-sm rounded-lg bg-gray-50 p-3 break-words" data-testid="estimate-decision">
          {estimate.status === 'accepted' ? 'The customer accepted this estimate' : 'The customer declined this estimate'}
          {estimate.decided_at ? ` on ${dateTimeLabel(estimate.decided_at)}` : ''}.
          {estimate.status === 'declined' && (
            <> {estimate.decision_reason ? `Their reason: ${estimate.decision_reason}` : 'They gave no reason.'}</>
          )}
          {estimate.decision_basis && <span className="block text-xs text-gray-500">Decision basis: {estimate.decision_basis}</span>}
        </p>
      )}
    </div>
  )
}

/**
 * The estimate, the customer's decision, and every estimate action the backend allows right now.
 * Creating and editing share one form; sending, revising and cancelling are single calls whose refusals
 * (for example an unpriced line) are shown in the server's own words.
 */
export function EstimatePanel({ hub, busy, run, error }: HubPanelProps) {
  const { createCaseEstimate, saveEstimateDraft, sendGarageEstimate, reviseGarageEstimate, cancelGarageEstimate } = useCarUpApi()
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view')
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const latest = hub.estimates.latest
  const versions = hub.estimates.versions
  const showMoney = hubShowsMoney(hub)
  const workOrder = hub.work_order
  const caseId = hub.case.id
  const canPrepare = isAllowed(hub, 'prepare_estimate')
  const canEdit = isAllowed(hub, 'edit_estimate') && Boolean(latest)
  const canSend = isAllowed(hub, 'send_estimate') && Boolean(latest)
  const canCancel = isAllowed(hub, 'cancel_estimate') && Boolean(latest)
  const canRevise = isAllowed(hub, 'revise_estimate') && Boolean(latest)
  const anyAction = ESTIMATE_ACTIONS.some((a) => isAllowed(hub, a))

  if (!latest && !anyAction) return null

  // The form only exists while its action is still allowed (the hub may change under it after a refresh).
  const formMode = mode === 'create' && canPrepare ? 'create' : mode === 'edit' && canEdit ? 'edit' : null
  const older = versions.filter((v) => !latest || v.id !== latest.id)

  const submitDraft = async (body: EstimateDraftInput) => {
    const ok = formMode === 'edit' && latest
      ? await run('estimate', () => saveEstimateDraft(latest.id, body), 'Draft saved. The customer cannot see it until you send it.')
      : await run('estimate', () => createCaseEstimate(caseId, body), 'Estimate saved as a draft. The customer cannot see it until you send it.')
    if (ok) setMode('view')
    return ok
  }

  return (
    <HubSection id="estimate" title="Estimate and the customer’s decision" testId="estimate-panel">
      {workOrder && (
        <p className="text-sm" data-testid="owner-authorization" data-authorization={workOrder.owner_authorization}>
          <span className="font-medium">{OWNER_AUTHORIZATION_LABEL[workOrder.owner_authorization]}</span>
          {workOrder.owner_authorization === 'authorized' && workOrder.owner_authorized_at
            ? ` · ${dateTimeLabel(workOrder.owner_authorized_at)}` : ''}
        </p>
      )}

      {latest ? (
        <EstimateView estimate={latest} hubMoney={showMoney} />
      ) : (
        <p className="text-sm text-gray-600" data-testid="estimate-none">
          No estimate has been prepared yet. The customer decides on an estimate before any work starts.
        </p>
      )}

      <ScopedError scope="estimate" error={error} />

      {formMode ? (
        <EstimateForm
          key={formMode} mode={formMode} estimate={latest} busy={busy}
          onSubmit={submitDraft} onCancel={() => setMode('view')}
        />
      ) : (
        <div className="space-y-3">
          {canSend && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Sending shows the estimate to the customer and fixes its prices. To change it afterwards you revise it,
                which makes a new version.
              </p>
              <Button
                className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="send-estimate"
                onClick={() => latest && run('estimate', () => sendGarageEstimate(latest.id), 'Sent. The customer can now accept or decline it.')}
              >
                Send the estimate to the customer
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {canPrepare && (
              <Button
                className={canSend || canRevise ? 'min-h-11' : 'min-h-11 bg-orange-500 hover:bg-orange-600'}
                variant={canSend || canRevise ? 'outline' : 'default'} disabled={busy} data-testid="prepare-estimate"
                onClick={() => { setCancelling(false); setMode('create') }}
              >
                {latest ? 'Prepare a new estimate' : 'Prepare an estimate'}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline" className="min-h-11" disabled={busy} data-testid="edit-estimate"
                onClick={() => { setCancelling(false); setMode('edit') }}
              >
                Edit the draft
              </Button>
            )}
            {canRevise && (
              <Button
                className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="revise-estimate"
                onClick={() => latest && run('estimate', () => reviseGarageEstimate(latest.id), 'A new draft version was made. Edit it, then send it.')}
              >
                Revise the estimate
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline" className="min-h-11" disabled={busy} data-testid="cancel-estimate"
                onClick={() => setCancelling((v) => !v)}
              >
                Cancel the estimate
              </Button>
            )}
          </div>

          {canCancel && cancelling && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3" data-testid="cancel-estimate-form">
              <label htmlFor="cancel-estimate-reason" className="block text-sm font-medium">Reason (optional)</label>
              <input
                id="cancel-estimate-reason" value={cancelReason} className={INPUT_CLASS} data-testid="cancel-estimate-reason"
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <Button
                variant="outline" className="min-h-11" disabled={busy} data-testid="confirm-cancel-estimate"
                onClick={async () => {
                  if (!latest) return
                  const ok = await run('estimate', () => cancelGarageEstimate(latest.id, cancelReason.trim() || undefined), 'Estimate cancelled.')
                  if (ok) { setCancelling(false); setCancelReason('') }
                }}
              >
                Confirm: cancel this estimate
              </Button>
            </div>
          )}
        </div>
      )}

      {older.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Earlier versions</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm" data-testid="estimate-versions">
            {older.map((v) => (
              <li key={v.id} className="p-3 flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-medium">Version {v.version}</span>
                <span>{ESTIMATE_STATUS_LABEL[v.status]}</span>
                {canSeeMoney(showMoney, v) && <span>{formatMoney(v.total_amount, v.currency)}</span>}
                <span className="text-gray-500">{v.sent_at ? `Sent ${dateTimeLabel(v.sent_at)}` : 'Never sent'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </HubSection>
  )
}
