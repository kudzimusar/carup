/**
 * RX-06 Trade — the command desk's catalogue and read-outs (no components here).
 *
 * The catalogue mirrors the backend intent list (backend/constants/diaspora/diasporaAiConstants.js
 * AI_INTENTS, AI_LOW_RISK_DRAFT_ACTIONS, AI_MEDIUM_RISK_EXECUTABLE) and what
 * diasporaAiCommandService.executeAiCommand really does for each. It describes; it never decides —
 * the server re-validates permission, risk and confirmation on every call.
 *
 * Truth: the "AI" is CarUp's command parser. Its output is a PROPOSAL. Nothing happens until a person
 * applies it through the existing action, and high-risk commands are never executed here.
 */
import type { DiasporaAiCommand, DiasporaAiCommandCreateResult, DiasporaAiParseResult } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import type { ReadFailure } from './deskFormat'

export type ApplyKind = 'draft' | 'record-only' | 'ledger' | 'refused' | 'blocked'

export interface CommandSpec {
  intent: string
  label: string
  risk: 'LOW' | 'MEDIUM' | 'HIGH'
  apply: ApplyKind
  /** What pressing the existing apply action does on the server, in plain words. */
  does: string
  /** An example phrasing built from the parser's own keywords. */
  example: string
  /** Where the real action lives when the command desk does not apply it. */
  via?: { label: string; to: string }
}

export const COMMAND_CATALOGUE: readonly CommandSpec[] = [
  { intent: 'CREATE_BUYER_REQUEST', label: 'Create a buyer request', risk: 'LOW', apply: 'draft', example: 'create demand for a Toyota part',
    does: 'Applying creates a DRAFT parts request. Only the details the parser found are carried over.' },
  { intent: 'CREATE_SUPPLIER_STOCK', label: 'Create a stock line', risk: 'LOW', apply: 'draft', example: 'add stock brake pads',
    does: 'Applying creates a private DRAFT stock line in your stock ledger, named by the command service.', via: { label: 'Stock ledger', to: '/diaspora/stock' } },
  { intent: 'ADD_NOTE', label: 'Add a note', risk: 'LOW', apply: 'record-only', example: 'add note call the supplier on Monday',
    does: 'Applying marks the proposal as applied. No other record is created.' },
  { intent: 'CLASSIFY_DOCUMENT', label: 'Classify a document', risk: 'LOW', apply: 'record-only', example: 'classify document doc-12',
    does: 'Applying marks the proposal as applied. No document is changed or verified.' },
  { intent: 'PREPARE_QUOTE', label: 'Prepare a quote', risk: 'LOW', apply: 'record-only', example: 'prepare quote for ord-7',
    does: 'Applying marks the proposal as applied. No quote is created or sent.' },
  { intent: 'RESERVE_STOCK', label: 'Reserve stock', risk: 'MEDIUM', apply: 'ledger', example: 'reserve stock stk-1 5 units',
    does: 'After you confirm, applying reserves the units on that stock line through the ledger (the ledger can still refuse).', via: { label: 'Stock ledger', to: '/diaspora/stock' } },
  { intent: 'PUBLISH_SUPPLY_DOCUMENT', label: 'Publish a supply document', risk: 'MEDIUM', apply: 'refused', example: 'publish supply doc-3',
    does: 'Can be confirmed, but the command service refuses to apply it. Publish the document yourself.', via: { label: 'Stock ledger', to: '/diaspora/stock' } },
  { intent: 'SUBMIT_QUOTE', label: 'Submit a quote', risk: 'MEDIUM', apply: 'refused', example: 'submit quote q-9',
    does: 'Can be confirmed, but the command service refuses to apply it. Submit quotes from Reverse RFQ.', via: { label: 'Reverse RFQ', to: '/diaspora/rfq' } },
  { intent: 'RESERVE_CONTAINER', label: 'Reserve container space', risk: 'MEDIUM', apply: 'refused', example: 'reserve container cont-2',
    does: 'Can be confirmed, but the command service refuses to apply it. Reserve space from Containers.', via: { label: 'Containers', to: '/diaspora/containers' } },
  { intent: 'CREATE_PAYMENT_MILESTONE_DRAFT', label: 'Draft a payment milestone', risk: 'MEDIUM', apply: 'refused', example: 'create milestone for ord-7',
    does: 'Can be confirmed, but the command service refuses to apply it. Payment milestones are not created from commands.' },
  { intent: 'VERIFY_PROFILE', label: 'Verify a profile', risk: 'HIGH', apply: 'blocked', example: 'verify profile …', does: 'Never executed here. Queued for a reviewer and handled manually.' },
  { intent: 'VERIFY_DOCUMENT', label: 'Verify a document', risk: 'HIGH', apply: 'blocked', example: 'verify document …', does: 'Never executed here. Queued for a reviewer and handled manually.' },
  { intent: 'APPROVE_COMPLIANCE', label: 'Approve compliance', risk: 'HIGH', apply: 'blocked', example: 'approve compliance …', does: 'Never executed here. Queued for a reviewer and handled manually.' },
  { intent: 'RELEASE_ESCROW', label: 'Release payment', risk: 'HIGH', apply: 'blocked', example: 'release payment …', does: 'Never executed here. AI cannot release payment.' },
  { intent: 'MARK_SHIPMENT_DELIVERED', label: 'Mark a shipment delivered', risk: 'HIGH', apply: 'blocked', example: 'mark delivered …', does: 'Never executed here. Shipments are completed by recorded events only.' },
  { intent: 'OVERRIDE_STOCK_LEDGER', label: 'Override the stock ledger', risk: 'HIGH', apply: 'blocked', example: 'override stock …', does: 'Never executed here. Quantities change only through ledger movements.' },
  { intent: 'CANCEL_PAID_ORDER', label: 'Cancel a paid order', risk: 'HIGH', apply: 'blocked', example: 'cancel paid order …', does: 'Never executed here. Queued for a reviewer and handled manually.' },
  { intent: 'CHANGE_CUSTOMS_STATE', label: 'Change customs state', risk: 'HIGH', apply: 'blocked', example: 'change customs …', does: 'Never executed here. Customs state comes from the authority.' },
]

export function specOf(intent: string | null | undefined): CommandSpec | null {
  return COMMAND_CATALOGUE.find((c) => c.intent === intent) ?? null
}

/* ───────────────────────── statuses ───────────────────────── */

export const EXECUTION_LABEL: Record<string, string> = {
  DRAFT: 'Proposal · ready to apply',
  AWAITING_CONFIRMATION: 'Waiting for your confirmation',
  CONFIRMED: 'Confirmed · ready to apply',
  AWAITING_APPROVAL: 'With a reviewer · execution stays blocked',
  NEEDS_REVIEW: 'Needs a person — the parser was unsure',
  EXECUTED: 'Applied',
  BLOCKED: 'Blocked — never executed here',
  REJECTED: 'Discarded',
  FAILED: 'Apply failed',
}

/** Presentation only. "Applied" is a receipt of a draft/ledger action, not a verification — never green. */
export function executionTone(status: string | null | undefined): StatusTone {
  switch (String(status || '').toUpperCase()) {
    case 'EXECUTED': return 'info'
    case 'FAILED': return 'danger'
    case 'BLOCKED': case 'NEEDS_REVIEW': return 'warning'
    default: return 'neutral'
  }
}

export function riskTone(risk: string | null | undefined): StatusTone {
  const r = String(risk || '').toUpperCase()
  if (r === 'HIGH') return 'danger'
  if (r === 'MEDIUM') return 'warning'
  return 'neutral'
}

/** The legacy page's action rule, unchanged: which ONE existing action a proposal offers. */
export type OfferedAction = 'approve' | 'confirm' | 'execute' | 'none'
export function offeredAction(cmd: DiasporaAiCommand, isReviewer: boolean): OfferedAction {
  if (cmd.risk_level === 'HIGH') return isReviewer && cmd.approval_status === 'PENDING' ? 'approve' : 'none'
  if (cmd.execution_status === 'AWAITING_CONFIRMATION') return 'confirm'
  if (cmd.execution_status === 'DRAFT' || cmd.execution_status === 'CONFIRMED') return 'execute'
  return 'none'
}

/** Discarding (reject) is open to the requester or a reviewer while a proposal is still open. */
export function canDiscard(cmd: DiasporaAiCommand, viewerId: string | null, isReviewer: boolean): boolean {
  const open = !['EXECUTED', 'REJECTED'].includes(String(cmd.execution_status || '').toUpperCase())
  const requester = Boolean(viewerId) && String(cmd.requested_by ?? '') === viewerId
  return open && (requester || isReviewer)
}

/** What an applied command produced, from the result the server stored on the command. */
export interface AppliedResult { text: string; link: { label: string; to: string } | null }
export function appliedResult(cmd: DiasporaAiCommand): AppliedResult | null {
  const meta = (cmd.metadata ?? {}) as Record<string, unknown>
  const r = meta.executionResult as Record<string, unknown> | null | undefined
  if (!r || typeof r !== 'object') return null
  const id = typeof r.id === 'string' ? r.id : null
  switch (r.type) {
    case 'stock_item_draft':
      return { text: 'Created a private draft stock line.', link: id ? { label: 'Open its passport', to: `/diaspora/stock/${encodeURIComponent(id)}/passport` } : null }
    case 'buyer_order_draft':
      return { text: 'Created a draft parts request.', link: id ? { label: 'Open the request', to: `/diaspora/imports/${encodeURIComponent(id)}` } : null }
    case 'stock_reservation': {
      const stockId = typeof r.stockItemId === 'string' ? r.stockItemId : null
      return { text: 'Reserved units through the stock ledger.', link: stockId ? { label: 'Open the stock passport', to: `/diaspora/stock/${encodeURIComponent(stockId)}/passport` } : null }
    }
    case 'draft_only':
      return { text: 'Marked as applied. No other record was created.', link: null }
    default:
      return { text: `The server recorded a result of type “${String(r.type ?? 'unknown')}”.`, link: null }
  }
}

/** Labels for the entities the parser extracts (diasporaAiIntentParser.extractEntities). */
const ENTITY_LABELS: Record<string, string> = { targetId: 'Target', quantity: 'Quantity', partName: 'Part name', make: 'Make', origin: 'Origin' }
export function entityLabel(key: string): string {
  return ENTITY_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())
}

/** Confidence exactly as returned (0–1 → percent), or null when not reported. */
export function confidenceText(value: unknown): string | null {
  const n = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null
  return `${Math.round(n * 100)}%`
}

/* ───────────────────────── the page → view contract ───────────────────────── */

export interface CommandDeskModel {
  isAuthenticated: boolean
  authLoading: boolean
  canView: boolean
  role: string
  viewerId: string | null
  isReviewer: boolean
  voiceAvailable: boolean
  text: string
  setText: (v: string) => void
  parsed: DiasporaAiParseResult | null
  commands: DiasporaAiCommand[]
  commandsLoaded: boolean
  commandsFailure: ReadFailure | null
  onRetryCommands: () => void
  error: string
  busy: boolean
  lastSubmit: DiasporaAiCommandCreateResult | null
  actingId: string | null
  onParse: () => void
  onSubmit: () => void
  onConfirm: (id: string) => void
  onApprove: (id: string) => void
  onExecute: (id: string) => void
  onDiscard: (id: string) => void
}
