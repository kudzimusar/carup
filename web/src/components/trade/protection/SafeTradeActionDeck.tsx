/**
 * RX-06 Protection — every action the server returned for a SafeTrade case, with its permission.
 *
 * Controls exist only for actions the server's available-actions projection returned; a control is
 * enabled only when the server marked it `permitted`, and a refused action stays visible, disabled, with
 * the server's reason in words (never only a tooltip). Reviewer actions are grouped apart with their risk
 * stated. Actions the server reports but no page can submit are listed as such — never faked.
 */
import { useId } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_DANGER, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { actionLabel, partitionActions } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type { SafeTradeAvailableAction } from '@/types'
import { DeskState, InlineConfirm } from '@/components/trade/sourcing/TradeDesk'
import { humanizeCode } from '@/components/trade/sourcing/deskKit'
import { blockedBecause, confirmCopy, operableActions, reportedOnlyActions } from './safeTradeDesk'
import type { SafeTradeActionRunner } from './useSafeTradeActionRunner'

/** The runner's outcome line (announced politely; the shared component's wording). */
export function RunnerOutcome({ runner, testId }: { runner: SafeTradeActionRunner; testId: string }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {runner.error && <p role="alert" className="rounded-control border border-status-danger bg-status-danger-soft px-3 py-2.5 text-sm text-carup-text" data-testid={`${testId}-error`}>{runner.error}</p>}
      {!runner.error && runner.result && <p role="status" className="rounded-control border border-status-info bg-status-info-soft px-3 py-2.5 text-sm text-carup-text" data-testid={`${testId}-result`}>{runner.result}</p>}
    </div>
  )
}

/** The confirmation for whichever action the runner is holding. */
export function RunnerConfirm({ runner, testId }: { runner: SafeTradeActionRunner; testId: string }) {
  const action = runner.confirm
  if (!action) return null
  const copy = confirmCopy(action, runner.evaluationId)
  return (
    <InlineConfirm
      tone={action.reviewerRequired ? 'danger' : 'neutral'}
      testId={`${testId}-confirm`}
      title={`Confirm: ${actionLabel(action)}`}
      confirm={(
        <button type="button" className={action.reviewerRequired ? WS_DANGER : WS_PRIMARY} disabled={runner.pending !== null || copy.blocked} onClick={() => void runner.submit(action)} data-testid={`${testId}-confirm-submit`}>
          {runner.pending === action.actionKey && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Confirm
        </button>
      )}
      cancel={<button type="button" className={WS_SECONDARY} disabled={runner.pending !== null} onClick={() => runner.setConfirm(null)} data-testid={`${testId}-confirm-cancel`}>Cancel</button>}
    >
      {copy.body}
    </InlineConfirm>
  )
}

function ActionRow({ action, runner, reviewer }: { action: SafeTradeAvailableAction; runner: SafeTradeActionRunner; reviewer: boolean }) {
  const reason = blockedBecause(action)
  const disabled = !action.permitted || runner.pending !== null
  const reasonId = useId()
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between" data-testid={`trade-safetrade-action-${action.actionKey}`} data-permitted={action.permitted ? 'true' : 'false'} data-disabled-reason={action.disabledReasonCode || ''}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-carup-text">
          {actionLabel(action)}
          {action.sandboxOnly && <StatusChip tone="warning">Sandbox</StatusChip>}
          {action.confirmationRequired && <span className="text-xs font-normal text-carup-text-3">· asks to confirm</span>}
        </p>
        {reason && <p id={reasonId} className="mt-0.5 text-xs text-carup-text-2" data-testid={`trade-safetrade-action-${action.actionKey}-reason`}><span className="font-semibold text-carup-text">Server says:</span> {reason}</p>}
        {action.requiredEvidenceCategories?.length > 0 && <p className="mt-0.5 text-xs text-carup-text-3">Evidence it relies on: {action.requiredEvidenceCategories.map((c) => humanizeCode(c)).join(', ')}</p>}
      </div>
      <button
        type="button"
        className={cn(reviewer ? WS_DANGER : action.permitted ? WS_PRIMARY : WS_SECONDARY, 'shrink-0')}
        disabled={disabled}
        aria-disabled={disabled}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => runner.start(action)}
        data-testid={`trade-safetrade-action-${action.actionKey}-button`}
      >
        {runner.pending === action.actionKey && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {action.permitted ? actionLabel(action) : 'Not available'}
      </button>
    </li>
  )
}

export function SafeTradeActionDeck({ actions, runner, unreadable }: { actions: SafeTradeAvailableAction[]; runner: SafeTradeActionRunner; unreadable: boolean }) {
  if (unreadable) {
    return (
      <DeskState kind="failed" title="The available actions could not be loaded" testId="trade-safetrade-actions-unreadable">
        So none are offered here. Actions may still be available on this case — refresh to try again.
      </DeskState>
    )
  }
  const { participant, reviewer } = partitionActions(operableActions(actions))
  const reportedOnly = reportedOnlyActions(actions)
  if (participant.length === 0 && reviewer.length === 0 && reportedOnly.length === 0) {
    return <DeskState kind="empty" title="No actions are available to you in the current state" testId="trade-safetrade-actions-empty">The server returned no lifecycle action for your role on this case.</DeskState>
  }
  return (
    <div className="space-y-4" data-testid="trade-safetrade-actions">
      <RunnerOutcome runner={runner} testId="trade-safetrade-actions" />
      <RunnerConfirm runner={runner} testId="trade-safetrade-actions" />
      {participant.length > 0 && (
        <section aria-labelledby="trade-safetrade-participant-h" className="rounded-card border border-carup-line bg-carup-bg-raised p-4">
          <h3 id="trade-safetrade-participant-h" className="mb-3 text-sm font-semibold text-carup-text">Participant actions</h3>
          <ul className="divide-y divide-carup-line" data-testid="trade-safetrade-actions-participant">
            {participant.map((a) => <ActionRow key={a.actionKey} action={a} runner={runner} reviewer={false} />)}
          </ul>
        </section>
      )}
      {reviewer.length > 0 && (
        <section aria-labelledby="trade-safetrade-reviewer-h" className="rounded-card border border-status-warning bg-status-warning-soft p-4" data-testid="trade-safetrade-actions-reviewer">
          <h3 id="trade-safetrade-reviewer-h" className="flex items-center gap-1.5 text-sm font-semibold text-carup-text"><ShieldAlert className="h-4 w-4 text-status-warning" aria-hidden="true" />Reviewer and administrator actions</h3>
          <p className="mb-3 mt-1 text-xs leading-5 text-carup-text-2">High-risk: these decisions affect the assurance outcome. Release is a sandbox simulation only — no real funds move.</p>
          <ul className="divide-y divide-carup-line rounded-control bg-carup-bg-raised px-3 py-3">
            {reviewer.map((a) => <ActionRow key={a.actionKey} action={a} runner={runner} reviewer />)}
          </ul>
        </section>
      )}
      {reportedOnly.length > 0 && (
        <section aria-labelledby="trade-safetrade-reported-h" className="rounded-card border border-dashed border-carup-line-strong p-4" data-testid="trade-safetrade-actions-reported">
          <h3 id="trade-safetrade-reported-h" className="text-sm font-semibold text-carup-text">Also reported by the server — not available from this page</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {reportedOnly.map((a) => (
              <li key={a.actionKey} className="flex flex-wrap items-baseline gap-x-2 text-carup-text-2" data-testid={`trade-safetrade-reported-${a.actionKey}`}>
                <span className="font-semibold text-carup-text">{actionLabel(a)}</span>
                <span className="text-xs">{a.permitted ? 'The server would permit it, but no CarUp page can submit it yet.' : `Server says: ${blockedBecause(a)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
