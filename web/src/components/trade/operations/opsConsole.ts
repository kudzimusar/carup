/**
 * RX-06 Trade — SafeTrade operations console: the page → view contract and small read-outs
 * (no components here, so OpsConsoleView.tsx exports components only).
 *
 * Everything the console shows is fed by DiasporaSafeTradeOperations' OWN reads and its OWN `act`
 * handler. Nothing here decides anything: permissions come from the server (`canApprove`,
 * `selfApprovalBlocked`) or from the page's existing role display rule, and every action is
 * re-authorized server-side.
 */
import type {
  SafeTradeApproval, SafeTradeOperation, SafeTradeOutboxBacklog, SafeTradeOutboxDeadLetter, SafeTradeOutboxDrainSummary,
} from '@/types'
import type { ReadFailure } from '@/components/trade/seller/deskFormat'
import { shortRef } from '@/components/trade/seller/deskFormat'

export type OpsReadKey = 'approvals' | 'queue' | 'backlog' | 'deadLetters'
export type OpsQueueKey = 'approvals' | 'confirmation' | 'undeliverable'

/** The outcome of the last action `act` ran: the page's own notice text plus whether it succeeded. */
export interface OpsActionOutcome {
  tone: 'ok' | 'bad'
  id: string
  /** The server's own words when the action was refused (the legacy notice is generic). */
  serverMessage: string | null
}

export interface OpsConsoleModel {
  flagEnabled: boolean
  isAuthenticated: boolean
  authLoading: boolean
  /** The page's display rule (the server re-checks every read and action). */
  isReviewer: boolean
  /** The page's display rule for drain / retry delivery (platform_admin, super_admin, admin). */
  isPlatformAdmin: boolean
  role: string
  viewerId: string | null
  loading: boolean
  loadedOnce: boolean
  approvals: SafeTradeApproval[]
  queue: SafeTradeOperation[]
  backlog: SafeTradeOutboxBacklog | null
  deadLetters: SafeTradeOutboxDeadLetter[]
  failures: Record<OpsReadKey, ReadFailure | null>
  busyId: string | null
  notice: string | null
  outcome: OpsActionOutcome | null
  lastDrain: SafeTradeOutboxDrainSummary | null
  onRefresh: () => void
  onApprove: (approvalId: string, notes: string) => void
  onReject: (approvalId: string, reason: string) => void
  onReplay: (deadLetterId: string) => void
  onDrain: () => void
}

export type OpsQueueState = 'loading' | 'failed' | 'empty' | 'ready'

/** A queue's state from its read: never "empty" when the read failed or has not finished. */
export function opsQueueState(loading: boolean, loadedOnce: boolean, failure: ReadFailure | null, count: number): OpsQueueState {
  if (count > 0) return 'ready'
  if (failure) return 'failed'
  if (loading || !loadedOnce) return 'loading'
  return 'empty'
}

/** Who requested a decision, relative to the viewer. Never a raw email or name. */
export function requesterLabel(requestedBy: string | null | undefined, viewerId: string | null): string {
  if (!requestedBy) return 'Requester not recorded'
  if (viewerId && requestedBy === viewerId) return 'You'
  return `Reviewer ${shortRef(requestedBy)}`
}

/** Self-approval is refused by the server; the list carries the server's own verdict for this viewer. */
export function approvalBlockedForViewer(a: SafeTradeApproval): boolean {
  return a.selfApprovalBlocked === true || a.canApprove === false
}

export const OPS_MESSAGES = {
  approveOk: 'Approval recorded. The release can now be authorized.',
  approveBad: 'That approval could not be recorded. It may have expired or been actioned already.',
  rejectOk: 'Approval rejected.',
  rejectBad: 'That rejection could not be recorded.',
  replayOk: 'Event re-queued for delivery.',
  replayBad: 'That event could not be re-queued.',
  drainOk: 'Drain complete.',
  drainBad: 'The drain could not be run.',
} as const
