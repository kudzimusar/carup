/**
 * Phase 9 — Pure helpers for the SafeTrade UI (no React, no DOM, no network).
 *
 * Every lifecycle/state/label fact is DERIVED FROM THE API RESPONSE — never hardcoded business logic
 * and NEVER a re-implementation of the backend's 16-state transition table. Action permission is read
 * ONLY from the server's available-actions projection. These helpers only classify/format/derive what
 * the API returns so the components stay thin and the logic stays unit-testable.
 *
 * NON-CUSTODIAL: nothing here ever asserts CarUp holds/receives/releases real funds. Money-state labels
 * are explicitly framed as SANDBOX SIMULATION.
 */
import type {
  SafeTradeTransaction,
  SafeTradeState,
  SafeTradeTimelineEvent,
  SafeTradeAvailableAction,
  SafeTradeDisabledReasonCode,
  SafeTradeMilestone,
  SafeTradeDispute,
  SafeTradeDisputeEvidence,
} from '@/types'

// ── 1. Canonical lifecycle ordering (presentation order for the timeline) ───
// This is the DISPLAY ORDER of the 16 design states — a presentational concern, NOT a transition
// table. The backend remains authoritative on what is reachable; the UI never fabricates completion.
export const SAFETRADE_LIFECYCLE_PHASES: SafeTradeState[] = [
  'DRAFT',
  'ELIGIBILITY_PENDING',
  'AWAITING_BUYER_COMMITMENT',
  'AWAITING_SELLER_COMMITMENT',
  'PAYMENT_PENDING',
  'PAYMENT_HELD',
  'DOCUMENTS_PENDING',
  'COMPLIANCE_REVIEW',
  'SHIPMENT_IN_PROGRESS',
  'DELIVERY_CONFIRMATION_PENDING',
  'COMPLETED',
  'DISPUTED',
  'SUSPENDED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]

const TERMINAL_STATES = new Set<SafeTradeState>(['COMPLETED', 'CANCELLED', 'REFUNDED'])
const ESCAPE_HATCH_STATES = new Set<SafeTradeState>(['DISPUTED', 'SUSPENDED'])

// Mirror of the backend DB_STATUS_TO_DESIGN_STATE map (diasporaSafeTradeAvailableActions.js). Used
// ONLY to render the canonical state label; the backend stays authoritative for any decision.
const DB_STATUS_TO_DESIGN_STATE: Record<string, SafeTradeState> = {
  DRAFT: 'DRAFT',
  INITIATED: 'AWAITING_BUYER_COMMITMENT',
  FUNDS_PENDING: 'PAYMENT_PENDING',
  FUNDS_HELD: 'PAYMENT_HELD',
  IN_PROGRESS: 'COMPLIANCE_REVIEW',
  RELEASE_REVIEW: 'DELIVERY_CONFIRMATION_PENDING',
  RELEASE_AUTHORIZED: 'DELIVERY_CONFIRMATION_PENDING',
  SETTLED: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  SUSPENDED: 'SUSPENDED',
  CANCELLED: 'CANCELLED',
  REFUND_REVIEW: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
}

/** Map a transaction's coarse DB status to its canonical design state (display only). */
export function designStateOf(txn: Pick<SafeTradeTransaction, 'status'> | null | undefined): SafeTradeState | null {
  if (!txn?.status) return null
  return DB_STATUS_TO_DESIGN_STATE[String(txn.status)] ?? (txn.status as SafeTradeState)
}

/** Human, accessible label for a canonical state (never "funds secured"/"escrow balance"/"guaranteed"). */
const STATE_LABELS: Record<SafeTradeState, string> = {
  DRAFT: 'Draft',
  ELIGIBILITY_PENDING: 'Eligibility checks pending',
  AWAITING_BUYER_COMMITMENT: 'Awaiting buyer commitment',
  AWAITING_SELLER_COMMITMENT: 'Awaiting seller commitment',
  PAYMENT_PENDING: 'Sandbox payment pending',
  PAYMENT_HELD: 'Sandbox payment held (simulated)',
  DOCUMENTS_PENDING: 'Documents pending',
  COMPLIANCE_REVIEW: 'Compliance review',
  SHIPMENT_IN_PROGRESS: 'Shipment in progress',
  DELIVERY_CONFIRMATION_PENDING: 'Delivery confirmation pending',
  COMPLETED: 'Completed',
  DISPUTED: 'In dispute',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Sandbox refund pending',
  REFUNDED: 'Sandbox refund completed (simulated)',
}

export function stateLabel(state: SafeTradeState | null | undefined): string {
  if (!state) return 'Unknown'
  return STATE_LABELS[state] ?? String(state)
}

export function isTerminalState(state: SafeTradeState | null | undefined): boolean {
  return state != null && TERMINAL_STATES.has(state)
}

export function isEscapeHatchState(state: SafeTradeState | null | undefined): boolean {
  return state != null && ESCAPE_HATCH_STATES.has(state)
}

// ── 2. Timeline phase derivation (current / completed / blocked / unavailable) ─
export type SafeTradePhaseStatus = 'completed' | 'current' | 'blocked' | 'unavailable'

export interface SafeTradeTimelinePhase {
  state: SafeTradeState
  label: string
  status: SafeTradePhaseStatus
  /** The latest audit event observed for this phase, if the backend recorded one. */
  event?: SafeTradeTimelineEvent
  timestamp?: string | null
  source?: string | null
}

// The audit action -> design-state association used ONLY to attach observed timestamps/sources to a
// phase. A phase is marked completed ONLY when the backend recorded an event for it (or the current
// state is strictly later in the happy-path order) — the UI never fabricates a completed stage.
const ACTION_TO_STATE: Record<string, SafeTradeState> = {
  SAFETRADE_INITIATED: 'DRAFT',
  SAFETRADE_ELIGIBILITY_STARTED: 'ELIGIBILITY_PENDING',
  SAFETRADE_ELIGIBILITY_CLEARED: 'AWAITING_BUYER_COMMITMENT',
  SAFETRADE_BUYER_COMMITTED: 'AWAITING_SELLER_COMMITMENT',
  SAFETRADE_SELLER_COMMITTED: 'PAYMENT_PENDING',
  SAFETRADE_PAYMENT_REQUESTED: 'PAYMENT_PENDING',
  SAFETRADE_PAYMENT_HELD: 'PAYMENT_HELD',
  SAFETRADE_DOCUMENTS_STAGE: 'DOCUMENTS_PENDING',
  SAFETRADE_COMPLIANCE_SUBMITTED: 'COMPLIANCE_REVIEW',
  SAFETRADE_COMPLIANCE_PASSED: 'SHIPMENT_IN_PROGRESS',
  SAFETRADE_COMPLIANCE_FAILED: 'DISPUTED',
  SAFETRADE_SHIPMENT_BEGAN: 'SHIPMENT_IN_PROGRESS',
  SAFETRADE_SHIPMENT_ARRIVED: 'DELIVERY_CONFIRMATION_PENDING',
  SAFETRADE_AWAITING_DELIVERY: 'DELIVERY_CONFIRMATION_PENDING',
  SAFETRADE_DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMATION_PENDING',
  SAFETRADE_ESCROW_RELEASED: 'COMPLETED',
  SAFETRADE_DISPUTE_RAISED: 'DISPUTED',
  SAFETRADE_SUSPENDED: 'SUSPENDED',
  SAFETRADE_CANCELLED: 'CANCELLED',
  SAFETRADE_REFUND_INITIATED: 'REFUND_PENDING',
  SAFETRADE_REFUNDED: 'REFUNDED',
}

// The strictly linear "happy path" used to decide what is structurally behind the current state.
const HAPPY_PATH: SafeTradeState[] = [
  'DRAFT',
  'ELIGIBILITY_PENDING',
  'AWAITING_BUYER_COMMITMENT',
  'AWAITING_SELLER_COMMITMENT',
  'PAYMENT_PENDING',
  'PAYMENT_HELD',
  'DOCUMENTS_PENDING',
  'COMPLIANCE_REVIEW',
  'SHIPMENT_IN_PROGRESS',
  'DELIVERY_CONFIRMATION_PENDING',
  'COMPLETED',
]

/**
 * Derive the renderable timeline from the authoritative current state + the backend audit events.
 * - The current canonical state is marked `current`.
 * - A happy-path phase strictly before the current state (or one the backend recorded an event for)
 *   is `completed`.
 * - When the transaction is in an escape hatch (DISPUTED/SUSPENDED) the corresponding phase is
 *   `blocked`; happy-path phases after the recorded progress remain `unavailable`.
 * - Everything else is `unavailable`. The UI NEVER invents a completed stage the backend didn't record.
 */
export function deriveTimeline(
  currentState: SafeTradeState | null,
  events: SafeTradeTimelineEvent[],
): SafeTradeTimelinePhase[] {
  const eventByState = new Map<SafeTradeState, SafeTradeTimelineEvent>()
  for (const e of events) {
    const st = ACTION_TO_STATE[String(e.action)]
    if (st) eventByState.set(st, e) // last write wins → latest observed event for the phase
  }

  const currentIdx = currentState ? HAPPY_PATH.indexOf(currentState) : -1
  const inHatch = isEscapeHatchState(currentState)

  return SAFETRADE_LIFECYCLE_PHASES.map((state) => {
    const event = eventByState.get(state)
    const happyIdx = HAPPY_PATH.indexOf(state)
    let status: SafeTradePhaseStatus = 'unavailable'

    if (state === currentState) {
      status = inHatch ? 'blocked' : 'current'
    } else if (event && state !== currentState) {
      // The backend recorded an observed event for this phase → it genuinely happened.
      status = 'completed'
    } else if (currentIdx >= 0 && happyIdx >= 0 && happyIdx < currentIdx) {
      status = 'completed'
    }

    return {
      state,
      label: stateLabel(state),
      status,
      event,
      timestamp: event?.created_at ?? null,
      source: (event?.source as string | undefined) ?? (event?.metadata?.source as string | undefined) ?? null,
    }
  })
}

// ── 3. Available-action mapping (the ONLY source of action permission) ──────
const DISABLED_REASON_LABELS: Record<SafeTradeDisabledReasonCode, string> = {
  WRONG_ROLE: 'Not available for your role on this case.',
  WRONG_STATE: 'Not available at this stage.',
  DISPUTE_ACTIVE: 'Blocked while a dispute is active.',
  NEEDS_EVALUATION: 'A reviewer must record a release evaluation first.',
  NEEDS_REVIEWER: 'A reviewer or administrator must perform this.',
  LIVE_PAYMENT_DISABLED: 'Live payment is not active (sandbox only).',
  HELD_FUNDS_BOUNDARY: 'Cannot cancel once a sandbox payment hold is in place.',
  NOT_ELIGIBLE: 'The release policy reports this is not eligible.',
  DISABLED: 'SafeTrade is currently unavailable.',
}

export function disabledReasonLabel(code: SafeTradeDisabledReasonCode | null | undefined): string | null {
  if (!code) return null
  return DISABLED_REASON_LABELS[code] ?? 'Not available.'
}

/** Human, accessible label for an action key (presentational; keyed off the server's actionKey). */
const ACTION_LABELS: Record<string, string> = {
  'run-eligibility': 'Run eligibility checks',
  'buyer-commit': 'Confirm as buyer',
  'seller-commit': 'Confirm as seller',
  'request-payment': 'Request sandbox payment',
  'hold-payment': 'Place sandbox payment hold',
  'attach-documents': 'Attach documents',
  'submit-compliance': 'Submit for compliance review',
  'compliance-pass': 'Mark compliance passed',
  'compliance-fail': 'Mark compliance failed',
  'begin-shipment': 'Record shipment start',
  'mark-arrived': 'Record shipment arrival',
  'await-delivery': 'Await delivery',
  'confirm-delivery': 'Confirm delivery',
  'release-escrow': 'Authorize sandbox release',
  'suspend': 'Suspend case',
  'resume': 'Resume case',
  'cancel': 'Cancel case',
  'initiate-refund': 'Initiate sandbox refund',
  'complete-refund': 'Complete sandbox refund',
  'evaluate-release': 'Evaluate release',
  'approve-release': 'Approve sandbox release',
  'request-release': 'Request release',
  'open-dispute': 'Raise a dispute',
  'add-evidence': 'Add evidence',
  'resolve-dispute': 'Resolve dispute',
  'define-milestone': 'Define milestones',
}

export function actionLabel(action: Pick<SafeTradeAvailableAction, 'actionKey' | 'labelKey'>): string {
  return ACTION_LABELS[action.actionKey] ?? action.actionKey
}

/** Reviewer/admin-only actions are visually separated and carry a high-risk warning. */
export function isReviewerAction(action: SafeTradeAvailableAction): boolean {
  return action.reviewerRequired === true
}

/** Partition the server actions into participant vs reviewer groups (presentation grouping only). */
export function partitionActions(actions: SafeTradeAvailableAction[]): {
  participant: SafeTradeAvailableAction[]
  reviewer: SafeTradeAvailableAction[]
} {
  const participant: SafeTradeAvailableAction[] = []
  const reviewer: SafeTradeAvailableAction[] = []
  for (const a of actions) {
    if (isReviewerAction(a)) reviewer.push(a)
    else participant.push(a)
  }
  return { participant, reviewer }
}

/** The subset of actions the caller can actually perform right now (permitted === true). */
export function permittedActions(actions: SafeTradeAvailableAction[]): SafeTradeAvailableAction[] {
  return actions.filter((a) => a.permitted)
}

// ── 4. Money formatting (sandbox framing) ───────────────────────────────────
/** Format an amount + currency without any custodial claim. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  const value = Number(amount)
  const ccy = (currency || 'USD').toUpperCase()
  if (!Number.isFinite(value)) return `— ${ccy}`
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(value)
  } catch {
    // Unknown currency code → safe fallback (never throw in render).
    return `${value.toFixed(2)} ${ccy}`
  }
}

/** A truthful, color-independent sandbox label for a milestone's escrow-simulation status. */
const MILESTONE_STATUS_LABELS: Record<string, string> = {
  DUE: 'Due (sandbox)',
  FUNDS_PENDING: 'Sandbox payment pending',
  FUNDED: 'Sandbox funds simulated',
  HELD: 'Sandbox held (simulated)',
  RELEASE_REVIEW: 'Release under review (sandbox)',
  RELEASE_AUTHORIZED: 'Release authorized (sandbox)',
  RELEASED: 'Sandbox released (simulated)',
  REFUND_REVIEW: 'Refund under review (sandbox)',
  REFUNDED: 'Sandbox refunded (simulated)',
  CANCELLED: 'Cancelled',
  WAIVED: 'Waived',
  FAILED: 'Failed',
}

export function milestoneStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return MILESTONE_STATUS_LABELS[String(status)] ?? String(status)
}

/** The milestones a plan total counts: not a refund, not cancelled or waived. */
function countableMilestones(milestones: SafeTradeMilestone[]): SafeTradeMilestone[] {
  return milestones.filter(
    (m) => m.milestone_type !== 'REFUND' && !['CANCELLED', 'WAIVED'].includes(String(m.status)),
  )
}

/** Sum of non-refund, non-cancelled milestone amounts (mirrors the backend reconciliation filter). */
export function milestoneHeldTotal(milestones: SafeTradeMilestone[]): number {
  return round2(
    countableMilestones(milestones).reduce((s, m) => s + Number(m.amount || 0), 0),
  )
}

/**
 * The plan total, grouped by the currency each milestone actually carries.
 *
 * Each row already renders its own `m.currency`, so a plan can hold more than one
 * — but the header summed the raw amounts and then labelled the result with the
 * single case currency, presenting arithmetic across currencies as one figure.
 * CarUp applies no exchange rate, so the currencies are kept apart.
 *
 * A milestone with no recorded amount is reported as unpriced rather than added
 * as zero, which would quietly understate the plan.
 */
export function milestoneTotalsByCurrency(
  milestones: SafeTradeMilestone[],
  fallbackCurrency = 'USD',
): { totals: Array<{ currency: string; amount: number }>; unpriced: number } {
  const buckets = new Map<string, number>()
  let unpriced = 0
  for (const m of countableMilestones(milestones)) {
    const amount = m.amount === null || m.amount === undefined ? Number.NaN : Number(m.amount)
    if (!Number.isFinite(amount)) { unpriced += 1; continue }
    const currency = String(m.currency || fallbackCurrency).toUpperCase()
    buckets.set(currency, (buckets.get(currency) || 0) + amount)
  }
  return {
    totals: [...buckets.entries()].map(([currency, amount]) => ({ currency, amount: round2(amount) })),
    unpriced,
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ── 5. Eligibility / blockers ───────────────────────────────────────────────
/** Coarse, role-safe requirement categories surfaced from the blocker evidence (never raw refs). */
export function blockerCategory(code: string): string {
  if (/IDENTITY|VERIFIED/i.test(code)) return 'Identity verification'
  if (/QUOTE|RESERVATION|ORDER/i.test(code)) return 'Order readiness'
  if (/COMPLIANCE|SANCTION|SUSPEND/i.test(code)) return 'Compliance'
  if (/CURRENCY/i.test(code)) return 'Currency'
  if (/ENTITLEMENT/i.test(code)) return 'Subscription'
  if (/DISABLED/i.test(code)) return 'Availability'
  if (/CONFLICT/i.test(code)) return 'Conflict'
  return 'Requirement'
}

// ── 6. Dispute / evidence visibility (privacy) ──────────────────────────────
const ACTIVE_DISPUTE_STATUSES = new Set(['OPEN', 'UNDER_REVIEW', 'AWAITING_INFO'])

export function isActiveDispute(dispute: Pick<SafeTradeDispute, 'status'> | null | undefined): boolean {
  return dispute != null && ACTIVE_DISPUTE_STATUSES.has(String(dispute.status).toUpperCase())
}

export function hasActiveDispute(disputes: SafeTradeDispute[] | null | undefined): boolean {
  return Array.isArray(disputes) && disputes.some(isActiveDispute)
}

export function disputeCategoryLabel(category: string): string {
  return String(category)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export function disputeStatusLabel(status: string): string {
  return disputeCategoryLabel(status)
}

/**
 * Defense-in-depth privacy filter for dispute evidence. The backend already redacts
 * REVIEWERS_ONLY / others' AUTHOR_ONLY rows for non-privileged callers; this NEVER widens what the
 * backend returned — it only hides any REVIEWERS_ONLY / foreign AUTHOR_ONLY row that should not be
 * shown to an ordinary participant, in case a mock/test feeds unredacted data.
 */
export function visibleEvidence(
  evidence: SafeTradeDisputeEvidence[],
  viewer: { id?: string | null; isReviewer: boolean },
): SafeTradeDisputeEvidence[] {
  if (viewer.isReviewer) return evidence
  const viewerId = normalizeId(viewer.id)
  return evidence.filter((e) => {
    const vis = String(e.visibility || 'PARTICIPANTS').toUpperCase()
    if (vis === 'PARTICIPANTS') return true
    if (vis === 'AUTHOR_ONLY') return normalizeId(e.author_id) === viewerId && viewerId != null
    // Fail CLOSED: REVIEWERS_ONLY and any unrecognized/future visibility value are hidden from a
    // non-reviewer. A privacy filter must never default-open on an unknown visibility.
    return false
  })
}

function normalizeId(id: string | null | undefined): string | null {
  if (id == null) return null
  const s = String(id).trim().toLowerCase()
  return s.length ? s : null
}

// ── 7. Stale-state / conflict detection (re-fetch trigger) ──────────────────
/** True when a thrown error / backend body indicates a stale-state / invalid-transition conflict. */
export function isStaleStateError(input: unknown): boolean {
  const msg = extractMessage(input).toUpperCase()
  return (
    msg.includes('INVALID_TRANSITION') ||
    msg.includes('IDEMPOTENCY_CONFLICT') ||
    msg.includes('CONFLICT') ||
    msg.includes('STALE') ||
    msg.includes('409')
  )
}

/**
 * True when the error indicates the live-escrow external activation is unavailable (fail-closed).
 * The web apiClient surfaces the backend's human MESSAGE (not the structured code), so this matches
 * BOTH the raw code (if ever present) and the human phrasing of assertSafeTradeProductionSafety().
 */
export function isExternalActivationError(input: unknown): boolean {
  const msg = extractMessage(input).toUpperCase()
  return (
    msg.includes('EXTERNAL_ACTIVATION_REQUIRED') ||
    msg.includes('LIVE ESCROW') ||
    msg.includes('REGULATED PROVIDER') ||
    msg.includes('EXTERNAL ACTIVATION')
  )
}

/**
 * Categorize a thrown API error into a SafeTrade-safe class + default user message.
 *
 * IMPORTANT: the web apiClient (lib/apiClient.ts) throws plain Errors carrying only the backend's
 * human MESSAGE — it discards the structured `{ error: { code } }`. So UI code must classify by
 * message CONTENT, never by a `.code` property (which is always undefined). Matchers are deliberately
 * broad and fail-safe: an unrecognized error always falls through to `generic`. No raw provider/db
 * detail is ever surfaced — only the safe default copy below is shown to the user.
 */
export type SafeTradeErrorKind =
  | 'session'
  | 'external-activation'
  | 'conflict'
  | 'notfound'
  | 'tenant'
  | 'forbidden'
  | 'generic'

const ERROR_DEFAULT_MESSAGES: Record<SafeTradeErrorKind, string> = {
  session: 'Your session has expired. Please sign in again.',
  'external-activation': 'Live escrow is not active. SafeTrade runs in sandbox mode only; no real funds moved.',
  conflict: 'This case changed since you loaded it. Refresh and try again.',
  notfound: 'This SafeTrade case was not found.',
  tenant: 'A tenant context is required for SafeTrade.',
  forbidden: 'You are not authorized to perform this action. The server rejected it.',
  generic: 'The action could not be completed. Please refresh and try again.',
}

export function classifyActionError(input: unknown): { kind: SafeTradeErrorKind; message: string } {
  const msg = extractMessage(input).toLowerCase()
  let kind: SafeTradeErrorKind = 'generic'
  // Order matters: session/external-activation/conflict are checked before the broad forbidden matcher
  // (which would otherwise swallow a 401 "Unauthorized. Session is invalid…").
  if (/session is invalid|session is expired|session has expired|session expired/.test(msg)) kind = 'session'
  else if (isExternalActivationError(input)) kind = 'external-activation'
  else if (isStaleStateError(input)) kind = 'conflict'
  else if (/not found|no safetrade|does not exist|\b404\b/.test(msg)) kind = 'notfound'
  else if (/tenant context|x-tenant-id|tenant is required|tenant membership/.test(msg)) kind = 'tenant'
  else if (/not authorized|do not have access|forbidden|insufficient|permission|not permitted|actor role|reviewer (is )?required|\b403\b/.test(msg)) kind = 'forbidden'
  return { kind, message: ERROR_DEFAULT_MESSAGES[kind] }
}

function extractMessage(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof Error) return input.message
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const err = obj.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      if (typeof e.message === 'string') return e.message
      if (typeof e.code === 'string') return e.code
    }
    if (typeof obj.message === 'string') return obj.message
  }
  return ''
}

// ── 8. Participant-safe party labels (never leak raw ids) ───────────────────
/** A role-safe label for a participant id relative to the viewer (Buyer / Seller / You / a party). */
export function partySafeLabel(
  txn: Pick<SafeTradeTransaction, 'buyer_id' | 'seller_id' | 'created_by'>,
  partyId: string | null | undefined,
  viewerId: string | null | undefined,
): string {
  const pid = normalizeId(partyId)
  if (!pid) return 'Unassigned'
  if (pid === normalizeId(viewerId)) return 'You'
  if (pid === normalizeId(txn.buyer_id) || pid === normalizeId(txn.created_by)) return 'Buyer'
  if (pid === normalizeId(txn.seller_id)) return 'Seller'
  return 'Counterparty'
}

/** The viewer's server-independent best-guess party role (for presentation grouping only). */
export function viewerPartyRole(
  txn: Pick<SafeTradeTransaction, 'buyer_id' | 'seller_id' | 'created_by'>,
  viewerId: string | null | undefined,
): 'BUYER' | 'SELLER' | null {
  const vid = normalizeId(viewerId)
  if (!vid) return null
  if (vid === normalizeId(txn.buyer_id) || vid === normalizeId(txn.created_by)) return 'BUYER'
  if (vid === normalizeId(txn.seller_id)) return 'SELLER'
  return null
}
