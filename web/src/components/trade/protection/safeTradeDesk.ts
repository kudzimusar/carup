/**
 * RX-06 Protection — pure helpers for the SafeTrade desk (/diaspora/safetrade, /diaspora/safetrade/:id).
 *
 * The lifecycle, labels and permission facts come ONLY from components/diaspora/safetrade/safeTradeHelpers
 * (designStateOf, stateLabel, deriveTimeline, partitionActions, disabledReasonLabel, …) and from the
 * server's available-actions projection. Nothing here re-implements the 16-state transition table: an
 * action is operable only if the server returned it and marked it permitted.
 *
 * The submission mapping below is the SAME mapping the shared SafeTradeActions component uses
 * (commit-style keys → POST /commit with the allowlisted UPPER_SNAKE event; evaluate / request / approve
 * release and cancel → their dedicated routes; dispute keys → the dispute routes). It is repeated here
 * only because that component keeps it module-private; tests pin both to the same API calls.
 *
 * NON-CUSTODIAL: SafeTrade is assurance coordination plus a sandbox payment-state simulation. Nothing
 * here may say CarUp holds, receives or releases real funds.
 */
import type {
  SafeTradeAvailableAction, SafeTradeCommitEvent, SafeTradeDispute, SafeTradeEligibilityVerdict, SafeTradeEvaluateReleaseResponse,
  SafeTradeMilestone, SafeTradeTimelineEvent, SafeTradeTransaction,
} from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { SAFETRADE_SANDBOX_LABEL } from '@/config/safeTradeFlag'
import {
  actionLabel, designStateOf, disabledReasonLabel, isEscapeHatchState, isTerminalState, stateLabel,
} from '@/components/diaspora/safetrade/safeTradeHelpers'

/* ── Relationship and list facts ───────────────────────────────────────────────────────────── */

/** The viewer's relationship to a case (the legacy list's rule, unchanged). */
export function relationshipOf(txn: Pick<SafeTradeTransaction, 'buyer_id' | 'seller_id'>, viewerId: string | null): 'buyer' | 'seller' | 'other' {
  const v = (viewerId || '').toLowerCase()
  if (v && String(txn.buyer_id || '').toLowerCase() === v) return 'buyer'
  if (v && String(txn.seller_id || '').toLowerCase() === v) return 'seller'
  return 'other'
}

export const RELATIONSHIP_LABEL: Record<'buyer' | 'seller' | 'other', string> = {
  buyer: 'You are the buyer',
  seller: 'You are the seller',
  other: 'Not a party (oversight view)',
}

/** The coarse DB statuses the list endpoint filters on (the migration's CHECK enum). */
export const SAFETRADE_DB_STATUSES = [
  'DRAFT', 'INITIATED', 'FUNDS_PENDING', 'FUNDS_HELD', 'IN_PROGRESS', 'RELEASE_REVIEW', 'RELEASE_AUTHORIZED',
  'SETTLED', 'COMPLETED', 'DISPUTED', 'SUSPENDED', 'CANCELLED', 'REFUND_REVIEW', 'REFUNDED',
] as const

/** "Sandbox payment held (simulated) · FUNDS_HELD" — the design label plus the recorded code it filters on. */
export function dbStatusOptionLabel(code: string): string {
  return `${stateLabel(designStateOf({ status: code }))} · ${code}`
}

export function caseTone(txn: Pick<SafeTradeTransaction, 'status'>): StatusTone {
  const state = designStateOf(txn)
  if (isEscapeHatchState(state)) return 'danger'
  if (isTerminalState(state)) return 'neutral'
  return 'info'
}

export function isDisputed(txn: Pick<SafeTradeTransaction, 'status'>): boolean {
  return String(txn.status).toUpperCase() === 'DISPUTED'
}

/* ── Actions: what this page can submit, mirrored from SafeTradeActions ─────────────────────── */

export const COMMIT_KEYS: ReadonlySet<string> = new Set([
  'run-eligibility', 'buyer-commit', 'seller-commit', 'request-payment', 'hold-payment',
  'attach-documents', 'submit-compliance', 'compliance-pass', 'compliance-fail',
  'begin-shipment', 'mark-arrived', 'await-delivery', 'confirm-delivery', 'suspend', 'resume',
])
export const DEDICATED_KEYS: ReadonlySet<string> = new Set(['evaluate-release', 'request-release', 'approve-release', 'cancel'])
export const DISPUTE_KEYS: ReadonlySet<string> = new Set(['open-dispute', 'add-evidence', 'resolve-dispute'])
export const SANDBOX_MONEY_KEYS: ReadonlySet<string> = new Set(['hold-payment', 'request-payment', 'request-release', 'approve-release', 'evaluate-release'])

export function eventForKey(key: string): SafeTradeCommitEvent {
  return key.toUpperCase().replace(/-/g, '_') as SafeTradeCommitEvent
}

/** Lifecycle actions this page can submit (dispute actions live with the disputes). */
export function operableActions(actions: ReadonlyArray<SafeTradeAvailableAction>): SafeTradeAvailableAction[] {
  return actions.filter((a) => (COMMIT_KEYS.has(a.actionKey) || DEDICATED_KEYS.has(a.actionKey)) && !DISPUTE_KEYS.has(a.actionKey))
}

/** Actions the server reported that no page wires a submission for — listed, never faked. */
export function reportedOnlyActions(actions: ReadonlyArray<SafeTradeAvailableAction>): SafeTradeAvailableAction[] {
  return actions.filter((a) => !COMMIT_KEYS.has(a.actionKey) && !DEDICATED_KEYS.has(a.actionKey) && !DISPUTE_KEYS.has(a.actionKey))
}

/** The disabled reason a person reads, or null when the action is permitted. */
export function blockedBecause(action: Pick<SafeTradeAvailableAction, 'permitted' | 'disabledReasonCode'>): string | null {
  return action.permitted ? null : (disabledReasonLabel(action.disabledReasonCode) ?? 'Not available.')
}

/** The subset of the API the submission mapping uses (the real hook satisfies it). */
export interface SafeTradeActionApi {
  commitSafeTrade: (id: string, payload: { event: SafeTradeCommitEvent; idempotencyKey?: string }) => Promise<unknown>
  evaluateSafeTradeRelease: (id: string, payload?: { milestoneId?: string }) => Promise<SafeTradeEvaluateReleaseResponse>
  requestSafeTradeRelease: (id: string, payload?: { idempotencyKey?: string }) => Promise<unknown>
  approveSafeTradeRelease: (id: string, payload: { evaluationId?: string; idempotencyKey?: string }) => Promise<unknown>
  cancelSafeTrade: (id: string, payload?: { idempotencyKey?: string }) => Promise<unknown>
}

export function newIdempotencyKey(): string {
  try {
    return (globalThis.crypto as Crypto)?.randomUUID?.() || `idem-${Date.now()}-${Math.round(Math.random() * 1e9)}`
  } catch {
    return `idem-${Date.now()}`
  }
}

/**
 * Submit one server-returned action exactly as SafeTradeActions does. Returns the evaluation id when
 * evaluate-release recorded one (approve-release needs it). The backend stays authoritative.
 */
export async function submitSafeTradeAction(
  api: SafeTradeActionApi,
  transactionId: string,
  action: Pick<SafeTradeAvailableAction, 'actionKey'>,
  ctx: { evaluationId: string | null; idempotencyKey?: string },
): Promise<{ evaluationId: string | null; verdict?: { eligible: boolean; blockers: string[] } }> {
  const idempotencyKey = ctx.idempotencyKey ?? newIdempotencyKey()
  switch (action.actionKey) {
    case 'evaluate-release': {
      const resp = await api.evaluateSafeTradeRelease(transactionId, {})
      // RX06-LR03 (TF-03): the server's verdict decides. Only a PASSING evaluation is kept as the
      // approval's evaluation id; an ineligible one is reported with its blockers and never unlocks
      // "Approve sandbox release".
      const eligible = resp?.verdict?.eligible === true || (resp?.verdict === undefined && resp?.evaluation?.eligible === true)
      const blockers = (resp?.verdict?.blockers ?? resp?.evaluation?.blockers ?? []).map(b => b?.message || b?.code).filter((m): m is string => Boolean(m))
      return { evaluationId: eligible ? resp?.evaluation?.id ?? null : null, verdict: { eligible, blockers } }
    }
    case 'request-release':
      await api.requestSafeTradeRelease(transactionId, { idempotencyKey })
      return { evaluationId: null }
    case 'approve-release':
      await api.approveSafeTradeRelease(transactionId, { evaluationId: ctx.evaluationId || undefined, idempotencyKey })
      return { evaluationId: null }
    case 'cancel':
      await api.cancelSafeTrade(transactionId, { idempotencyKey })
      return { evaluationId: null }
    default:
      if (!COMMIT_KEYS.has(action.actionKey)) throw new Error(`This page cannot submit "${action.actionKey}".`)
      await api.commitSafeTrade(transactionId, { event: eventForKey(action.actionKey), idempotencyKey })
      return { evaluationId: null }
  }
}

/** The confirmation wording (the shared component's), and whether confirming is blocked. */
export function confirmCopy(action: Pick<SafeTradeAvailableAction, 'actionKey'>, evaluationId: string | null): { body: string; blocked: boolean } {
  const money = SANDBOX_MONEY_KEYS.has(action.actionKey)
  const needsEvaluation = action.actionKey === 'approve-release' && !evaluationId
  return {
    body: `${money
      ? `${SAFETRADE_SANDBOX_LABEL} This records an assurance/payment-state simulation. CarUp does not hold or release real funds.`
      : 'This submits the action to the SafeTrade workflow. The backend remains authoritative.'}${needsEvaluation ? ' A passing release evaluation is required first.' : ''}`,
    blocked: needsEvaluation,
  }
}

/** The receipt line after a submission (the shared component's wording). */
export function submittedText(action: Pick<SafeTradeAvailableAction, 'actionKey' | 'labelKey' | 'sandboxOnly'>): string {
  return `${actionLabel(action)} submitted${action.sandboxOnly ? ' — sandbox simulation only; no real funds moved.' : '.'}`
}

/* ── Next move for one case ────────────────────────────────────────────────────────────────── */

export interface CaseMove {
  title: string
  usuallyWith: string
  after: string
  primary: SafeTradeAvailableAction | null
}

/**
 * The one next move, read only from the server's projection: the first permitted participant action
 * (or reviewer action, for a reviewer); otherwise who the blocked actions wait on, from their
 * server-given reasons. Never guessed from the state name alone.
 */
export function caseNextMove(
  txn: Pick<SafeTradeTransaction, 'status'>,
  actions: ReadonlyArray<SafeTradeAvailableAction>,
  opts: { actionsUnreadable: boolean; isReviewer: boolean },
): CaseMove {
  const state = designStateOf(txn)
  if (opts.actionsUnreadable) {
    return { title: 'The available actions could not be loaded', usuallyWith: 'Not known', after: 'Refresh to try again. Actions may still be available on this case.', primary: null }
  }
  if (isTerminalState(state)) {
    return { title: `This case is closed — ${stateLabel(state).toLowerCase()}`, usuallyWith: 'Nobody — nothing is waiting', after: 'The timeline keeps the recorded history.', primary: null }
  }
  const operable = operableActions(actions)
  const permitted = operable.filter((a) => a.permitted)
  const participantFirst = permitted.find((a) => !a.reviewerRequired) ?? null
  const reviewerFirst = permitted.find((a) => a.reviewerRequired) ?? null
  const primary = participantFirst ?? (opts.isReviewer ? reviewerFirst : null)
  if (primary) {
    return {
      title: `${actionLabel(primary)} — this step is yours`,
      usuallyWith: primary.reviewerRequired ? 'You, as a CarUp reviewer' : 'You',
      after: primary.sandboxOnly
        ? 'The server records the step as a sandbox simulation — no real funds move — and updates the case.'
        : 'The server records the step and updates the case. The timeline shows it once recorded.',
      primary,
    }
  }
  const reasons = new Set(operable.map((a) => a.disabledReasonCode))
  if (reasons.has('DISPUTE_ACTIVE')) return { title: 'Paused while a dispute is open', usuallyWith: 'A CarUp reviewer', after: 'The dispute is resolved first; then the blocked steps can continue.', primary: null }
  if (operable.some((a) => a.reviewerRequired || a.disabledReasonCode === 'NEEDS_REVIEWER' || a.disabledReasonCode === 'NEEDS_EVALUATION')) {
    return { title: 'Waiting for a CarUp reviewer', usuallyWith: 'A CarUp reviewer', after: 'A reviewer records the next decision. You will see it in the timeline.', primary: null }
  }
  if (reasons.has('WRONG_ROLE')) return { title: 'Waiting for the other party', usuallyWith: 'The other party', after: 'Their step appears in the timeline once the server records it.', primary: null }
  if (reasons.has('LIVE_PAYMENT_DISABLED')) return { title: 'The next step needs live payment, which is not active', usuallyWith: 'Nobody — live payment is off', after: 'SafeTrade runs as a sandbox simulation only; no real funds can move.', primary: null }
  return { title: 'No step is available to you at this stage', usuallyWith: 'Not known', after: 'The server lists every action below with the reason it is not available.', primary: null }
}

export function activeDisputeCount(disputes: ReadonlyArray<Pick<SafeTradeDispute, 'status'>>): number {
  return disputes.filter((d) => ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFO'].includes(String(d.status).toUpperCase())).length
}

/** Classify a fatal case-read failure, keeping "switched off" (404 + "not enabled") apart from "not found". */
export type CaseFatalKind = 'session' | 'notfound' | 'unavailable' | 'forbidden' | 'tenant' | 'limited' | 'error'

export function caseFatalKind(legacyKind: string, failure: { status: number | null; message: string | null } | null): CaseFatalKind {
  const status = failure?.status ?? null
  const message = String(failure?.message ?? '').toLowerCase()
  if (status === 429 || /too many requests/.test(message)) return 'limited'
  if (status === 404 && /not enabled/.test(message)) return 'unavailable'
  if (legacyKind === 'session') return 'session'
  if (legacyKind === 'notfound' || status === 404) return 'notfound'
  if (legacyKind === 'forbidden' || status === 403) return 'forbidden'
  if (legacyKind === 'tenant') return 'tenant'
  return 'error'
}

/* ── View models ───────────────────────────────────────────────────────────────────────────── */

export interface ReadFailureInfo { status: number | null; message: string | null }

export interface SafeTradeCasesModel {
  flagEnabled: boolean
  authLoading: boolean
  signedIn: boolean
  viewerId: string | null
  cases: SafeTradeTransaction[]
  filtered: SafeTradeTransaction[]
  loading: boolean
  answered: boolean
  /** The legacy page's own message (tenant vs generic). */
  error: string | null
  failure: ReadFailureInfo | null
  onRetry: () => void
  filters: {
    status: string
    setStatus: (v: string) => void
    rel: 'all' | 'buyer' | 'seller'
    setRel: (v: 'all' | 'buyer' | 'seller') => void
    disputedOnly: boolean
    setDisputedOnly: (v: boolean) => void
    order: string
    setOrder: (v: string) => void
  }
}

export interface SafeTradeCaseModel {
  flagEnabled: boolean
  authLoading: boolean
  signedIn: boolean
  viewerId: string | null
  isReviewer: boolean
  caseId: string
  loading: boolean
  hasLoaded: boolean
  fatal: { kind: string; message: string } | null
  fatalFailure: ReadFailureInfo | null
  onReload: () => void | Promise<void>
  txn: SafeTradeTransaction | null
  timeline: SafeTradeTimelineEvent[]
  eligibility: SafeTradeEligibilityVerdict | null
  milestones: SafeTradeMilestone[]
  disputes: SafeTradeDispute[]
  actions: SafeTradeAvailableAction[]
  unreadable: ReadonlySet<string>
}
