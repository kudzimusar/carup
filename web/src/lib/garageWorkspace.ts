/**
 * The garage operator's vocabulary (R5).
 *
 * Owner UAT: the backend has a queue, cases, work orders, assignments and service records, all
 * certified — and a garage tenant-member logging in landed on the OWNER dashboard, which offers to
 * sell their car. Every one of those capabilities was reachable only by calling the API by hand.
 *
 * This module holds the language and the state→action mapping for the operator surfaces so the
 * queue and the case screen can never disagree about what a job is waiting for. It computes
 * nothing the server does not already know: `next_action` comes from `/api/garage/queue`, and where
 * the case screen must derive it (a single case read has no queue row), `nextActionFor` reproduces
 * the server's rule in one place rather than scattering status checks through JSX.
 */

import {
  ESTIMATE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type AllowedAction,
  type CaseHub,
  type EstimateStatus,
  type NextAction as HubNextAction,
  type OwnerAuthorization,
  type PaymentRecord,
} from '@/lib/garageBusiness'

export type CaseStatus = 'requested' | 'accepted' | 'active' | 'completed' | 'declined' | 'cancelled' | string
export type WorkOrderStatus = 'In Progress' | 'Completed' | 'Cancelled' | string

/**
 * What a job can be waiting for.
 *
 * `garageBusiness.NextAction` is the superset the backend now derives (estimate, customer decision,
 * assignment, completion, invoice, payment). `open_work_order` is the LEGACY two-argument answer: a job
 * card used to be opened by hand, and the two-argument `nextActionFor` still returns it for callers that
 * have no facts to give. The hub never produces it — the server owns the work order's opening now.
 */
export type NextAction = HubNextAction | 'open_work_order'

export type QueueCase = {
  id: string
  status: CaseStatus
  vin: string
  vehicle: { make: string | null; model: string | null; year: number | null } | null
  service_category: string | null
  requested_at: string | null
  accepted_at?: string | null
  branch_id?: string | null
  work_order: { id: string; status: WorkOrderStatus; assigned_mechanic_user_id?: string | null } | null
  next_action?: NextAction
}

/**
 * The recorded facts the full rule needs. Every field is something the hub (or the queue) already
 * carries; nothing here is guessed, and an absent fact reads as the cautious answer (pending, no
 * mechanic, no records).
 */
export type NextActionFacts = {
  ownerAuthorization?: OwnerAuthorization | null
  assignedMechanicUserId?: string | null
  /** the LATEST estimate version's status */
  latestEstimateStatus?: EstimateStatus | null
  /** null / undefined = not known, which is treated as none */
  serviceRecordCount?: number | null
  /** the live (issued) invoice, if any */
  invoice?: { status: string; payment_status?: string | null } | null
}

/**
 * What this case is waiting for.
 *
 * TWO ARGUMENTS (legacy, kept exactly): mirrors the original `getGarageQueue` — requested → accept or
 * decline; accepted → open a work order, or start once one exists; active → record what was done. A
 * terminal case is waiting for nothing, and saying "none" is how the UI knows to offer no buttons
 * rather than offering ones that will 409.
 *
 * THREE ARGUMENTS: the web mirror of the backend's `deriveNextAction`. Passing `facts` selects it. A job
 * card now exists before the customer has authorized anything, so "accepted + has a work order" no longer
 * means "start": that needs the customer's authorization and an assigned mechanic.
 */
export function nextActionFor(status: CaseStatus, hasWorkOrder: boolean, facts?: NextActionFacts): NextAction {
  if (facts) return nextActionFromFacts(String(status).toLowerCase(), hasWorkOrder, facts)
  if (status === 'requested') return 'accept_or_decline'
  if (status === 'accepted') return hasWorkOrder ? 'start_work' : 'open_work_order'
  if (status === 'active') return 'record_service'
  return 'none'
}

function nextActionFromFacts(status: string, hasWorkOrder: boolean, facts: NextActionFacts): NextAction {
  if (status === 'requested') return 'accept_or_decline'

  if (status === 'accepted') {
    if (!hasWorkOrder) return 'prepare_estimate'
    const authorization = facts.ownerAuthorization || 'pending'
    if (authorization === 'authorized') return facts.assignedMechanicUserId ? 'start_work' : 'assign_mechanic'
    if (authorization === 'revoked') return 'authorization_revoked'
    // pending | declined: the customer's word is what the job is waiting for
    if (facts.latestEstimateStatus === 'draft') return 'send_estimate'
    if (facts.latestEstimateStatus === 'sent') return 'await_customer'
    if (authorization === 'declined' || facts.latestEstimateStatus === 'declined') return 'revise_estimate'
    return 'prepare_estimate'
  }

  if (status === 'active') {
    if (facts.ownerAuthorization === 'revoked') return 'authorization_revoked'
    return facts.serviceRecordCount && facts.serviceRecordCount > 0 ? 'complete_job' : 'record_service'
  }

  if (status === 'completed') {
    if (!facts.invoice || facts.invoice.status === 'voided') return 'issue_invoice'
    return facts.invoice.payment_status === 'paid' ? 'none' : 'await_payment'
  }

  return 'none'
}

/** Terminal cases are history. The workspace shows them; it must not offer to change them. */
export function isTerminalCase(status: CaseStatus): boolean {
  return ['completed', 'declined', 'cancelled'].includes(String(status).toLowerCase())
}

const ACTION_LABEL: Record<NextAction, string> = {
  accept_or_decline: 'Waiting for you to accept or decline',
  open_work_order: 'Accepted — open a job card to start',
  start_work: 'Job card open — start when the car is in',
  record_service: 'In the workshop — record what was done',
  none: 'No action needed',
  prepare_estimate: 'Accepted — prepare an estimate for the customer',
  send_estimate: 'Estimate drafted — send it to the customer',
  await_customer: 'Estimate sent — waiting for the customer to decide',
  revise_estimate: 'The customer declined — revise the estimate',
  assign_mechanic: 'Customer authorized — assign a mechanic',
  complete_job: 'Work recorded — complete the job when the car is handed back',
  authorization_revoked: 'The customer withdrew their authorization',
  issue_invoice: 'Job complete — issue the invoice',
  await_payment: 'Invoice issued — waiting for a payment to be recorded',
}

export function nextActionLabel(action: NextAction | undefined | null): string {
  return ACTION_LABEL[(action || 'none') as NextAction] ?? ACTION_LABEL.none
}

const STATUS_LABEL: Record<string, string> = {
  requested: 'New request',
  accepted: 'Accepted',
  active: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Withdrawn by customer',
}

export function caseStatusLabel(status: CaseStatus): string {
  return STATUS_LABEL[String(status).toLowerCase()] ?? String(status)
}

export const STATUS_TONE: Record<string, string> = {
  requested: 'bg-amber-500 text-white',
  accepted: 'bg-blue-500 text-white',
  active: 'bg-indigo-500 text-white',
  completed: 'bg-green-600 text-white',
  declined: 'bg-gray-400 text-white',
  cancelled: 'bg-gray-400 text-white',
}

/**
 * A vehicle we could not resolve is named by VIN.
 *
 * The queue deliberately returns `vehicle: null` rather than a placeholder, and this keeps that
 * decision intact: a car with no make/model on file is "VIN <vin>", never "Unknown Vehicle".
 */
export function vehicleLabel(vehicle: QueueCase['vehicle'], vin: string): string {
  if (!vehicle) return `VIN ${vin}`
  const parts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean)
  return parts.length ? parts.join(' ') : `VIN ${vin}`
}

/** An unrecorded category is stated as unrecorded — never defaulted to "General". */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return 'Not specified'
  return category.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** A member with no name on file is unnamed, not invented. */
export function mechanicLabel(m: { display_name?: string | null; user_id: string }): string {
  return m.display_name || 'Unnamed team member'
}

export function whenLabel(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Money is refused rather than guessed.
 *
 * `updateWorkOrderStatus` and `recordService` both require an ISO-4217 currency whenever a cost is
 * present, and both reject a bare amount. Validating here means the operator is told before the
 * request rather than after a 400 they cannot interpret.
 */
export function validateCost(amount: string, currency: string): string | null {
  const hasAmount = amount.trim() !== ''
  const hasCurrency = currency.trim() !== ''
  if (!hasAmount && !hasCurrency) return null // absent cost stays absent — that is allowed
  if (!hasAmount) return 'Enter the amount, or clear the currency to record no cost.'
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) return 'The amount must be a number that is not negative.'
  if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
    return 'A cost must carry its currency as a three-letter code, for example USD or ZWG.'
  }
  return null
}

/** Mileage is an OBSERVATION. It never becomes the vehicle's odometer. */
export function validateMileage(value: string): string | null {
  if (value.trim() === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) return 'A mileage reading must be a whole number of kilometres.'
  return null
}

/**
 * A mechanic's own jobs (R6).
 *
 * The garage manager and the mechanic look at one queue and need different things from it. Without
 * a "mine" view they are the same screen, and a mechanic has to open every job to find out which
 * are theirs.
 *
 * Assignment is read from `work_order_assignments` via the queue, which is the authority. A job
 * with no work order cannot be assigned to anyone and is therefore never "mine" — it is the
 * garage's to triage first.
 */
export function assignedTo(c: QueueCase, userId: string | null | undefined): boolean {
  if (!userId) return false
  return c.work_order?.assigned_mechanic_user_id === userId
}

// ───────────────────────────── the operating hub (GARAGE-1.0) ─────────────────────────────
//
// Pure functions over ONE read model (`CaseHub`). They decide how the hub is *explained*; they never decide
// what is *allowed* — that is `hub.allowed_actions`, computed by the backend, and a control is rendered only
// when its key is in it. Nothing here adds, converts or compares an amount.

/** Date and time, or "Not recorded". The garage reads these to see WHEN something happened. */
export function dateTimeLabel(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return 'Not recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

/** Exactly what the backend will accept from THIS caller now. */
export function isAllowed(hub: Pick<CaseHub, 'allowed_actions'>, action: AllowedAction): boolean {
  return hub.allowed_actions.includes(action)
}

/**
 * Money is a garage-admin matter. The server says so twice: `money_visible: false` (it has already redacted
 * every price, total and cost it sent — "hidden from you", which is NOT the same as "not recorded") and
 * `closeout: null`. Either one withholds money from the screen: a mechanic sees no price, invoice or payment
 * anywhere on the hub, and nothing is rendered in a hidden price's place (a "Not recorded" there would be a
 * false statement about the record).
 */
export function hubShowsMoney(hub: Pick<CaseHub, 'closeout' | 'money_visible'>): boolean {
  return hub.money_visible !== false && hub.closeout !== null
}

/**
 * The headline. For a viewer who sees no money, the invoice and payment stages are not part of their job —
 * the backend derives `issue_invoice` / `await_payment` from an invoice they cannot see, so they read as "nothing
 * further" rather than leaking that there is a commercial step.
 */
export function visibleNextAction(hub: Pick<CaseHub, 'next_action' | 'closeout' | 'money_visible'>): HubNextAction {
  if (!hubShowsMoney(hub) && (hub.next_action === 'issue_invoice' || hub.next_action === 'await_payment')) return 'none'
  return hub.next_action
}

/** The allowed-action keys that mean "the next step can be taken by this caller". */
const ACTIONS_THAT_ADVANCE: Partial<Record<HubNextAction, AllowedAction[]>> = {
  accept_or_decline: ['accept_case', 'decline_case'],
  prepare_estimate: ['prepare_estimate'],
  send_estimate: ['send_estimate'],
  revise_estimate: ['revise_estimate'],
  assign_mechanic: ['assign_mechanic'],
  start_work: ['start_work'],
  record_service: ['record_service'],
  complete_job: ['complete_job'],
  issue_invoice: ['issue_invoice'],
  await_payment: ['record_payment'],
}

/**
 * True when the job is waiting on a step this caller cannot take (a mechanic looking at "prepare an estimate").
 * The hub says so rather than leaving the viewer looking for a button that is deliberately not there.
 */
export function nextStepIsSomeoneElses(hub: Pick<CaseHub, 'next_action' | 'closeout' | 'money_visible' | 'allowed_actions'>): boolean {
  const keys = ACTIONS_THAT_ADVANCE[visibleNextAction(hub)]
  if (!keys) return false
  return !keys.some((k) => hub.allowed_actions.includes(k))
}

export const OWNER_AUTHORIZATION_LABEL: Record<OwnerAuthorization, string> = {
  pending: 'The customer has not authorized this work yet',
  authorized: 'Authorized by the customer',
  declined: 'The customer declined the estimate',
  revoked: 'The customer withdrew their authorization',
}

/**
 * Why "Start work" is not available — in plain words, from the recorded facts. Null when it IS allowed, or
 * when the case is not at the stage where starting is a question (requested, active, finished).
 */
export function startBlockedReason(hub: CaseHub): string | null {
  if (isAllowed(hub, 'start_work')) return null
  if (String(hub.case.status).toLowerCase() !== 'accepted') return null
  const wo = hub.work_order
  if (!wo) return 'The customer has not authorized this work yet. An estimate has to be prepared and accepted first.'
  switch (wo.owner_authorization) {
    case 'pending': return 'The customer has not authorized this work yet.'
    case 'declined': return 'The customer declined the estimate, so work cannot start until they authorize it.'
    case 'revoked': return 'The customer withdrew their authorization, so work cannot start.'
    case 'authorized':
      if (!wo.assigned_mechanic_user_id) {
        return hub.viewer.is_admin ? 'Assign a mechanic first.' : 'A garage administrator has to assign a mechanic first.'
      }
      return 'The job card is closed, so work cannot start.'
    default: return 'Work cannot start yet.'
  }
}

/** How a payment was received. All of them happen OUTSIDE CarUp — the garage states it, CarUp does not verify it. */
export const PAYMENT_METHOD_LABEL: Record<PaymentRecord['method'], string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  card_external: 'Card (taken outside CarUp)',
  other: 'Other',
}

export type HubStepKey =
  | 'request' | 'appointment' | 'estimate' | 'decision' | 'assign' | 'work' | 'parts' | 'complete' | 'invoice' | 'payment'
export type HubStepState = 'done' | 'current' | 'upcoming' | 'blocked' | 'optional' | 'closed'
export type HubStep = { key: HubStepKey; label: string; state: HubStepState; detail: string | null }

export const HUB_STEP_STATE_LABEL: Record<HubStepState, string> = {
  done: 'Done', current: 'Next', upcoming: 'Later', blocked: 'Blocked', optional: 'Optional', closed: 'Not applicable',
}

const STEP_OF_ACTION: Record<HubNextAction, HubStepKey | null> = {
  accept_or_decline: 'request',
  prepare_estimate: 'estimate', send_estimate: 'estimate', revise_estimate: 'estimate',
  await_customer: 'decision', authorization_revoked: 'decision',
  assign_mechanic: 'assign',
  start_work: 'work', record_service: 'work',
  complete_job: 'complete',
  issue_invoice: 'invoice', await_payment: 'payment',
  none: null,
}

const APPOINTMENT_LABEL: Record<string, string> = {
  requested: 'Requested — not yet confirmed', confirmed: 'Confirmed', fulfilled: 'Fulfilled',
  declined: 'Declined', cancelled: 'Cancelled', no_show: 'Customer did not come',
}
export function appointmentStatusLabel(status: string): string {
  return APPOINTMENT_LABEL[status] ?? status
}

/**
 * The journey as a list of steps, each stated from the recorded facts. `current` is the step the server's
 * `next_action` belongs to; a step is `done` only when a fact says so, never because a later step started.
 * A viewer without money sees no invoice or payment step at all.
 */
export function hubSteps(hub: CaseHub): HubStep[] {
  const status = String(hub.case.status).toLowerCase()
  const failed = status === 'declined' || status === 'cancelled'
  const money = hubShowsMoney(hub)
  const wo = hub.work_order
  const auth = wo?.owner_authorization ?? null
  const latest = hub.estimates.latest
  const live = hub.closeout?.invoice && hub.closeout.invoice.status === 'issued' ? hub.closeout.invoice : null
  const current = STEP_OF_ACTION[visibleNextAction(hub)]
  const records = hub.service_records.length
  const activeParts = hub.parts_used.filter((u) => u.active).length
  const appointment = hub.appointment

  type Row = { key: HubStepKey; label: string; done: boolean; optional?: boolean; detail: string | null }
  const rows: Row[] = [
    { key: 'request', label: 'Request', done: !failed && status !== 'requested', detail: null },
    {
      key: 'appointment', label: 'Appointment',
      done: appointment ? ['confirmed', 'fulfilled'].includes(appointment.status) : false,
      optional: !appointment, detail: appointment ? appointmentStatusLabel(appointment.status) : 'None booked',
    },
    {
      key: 'estimate', label: 'Estimate',
      done: latest ? ['sent', 'accepted'].includes(latest.status) : false,
      detail: latest ? `Version ${latest.version} — ${ESTIMATE_STATUS_LABEL[latest.status]}` : null,
    },
    { key: 'decision', label: 'Customer decision', done: auth === 'authorized', detail: auth ? OWNER_AUTHORIZATION_LABEL[auth] : null },
    { key: 'assign', label: 'Assign a mechanic', done: Boolean(wo?.assigned_mechanic_user_id), detail: null },
    { key: 'work', label: 'Work', done: records > 0 || status === 'completed', detail: records > 0 ? `${records} recorded` : null },
    { key: 'parts', label: 'Parts', done: activeParts > 0, optional: activeParts === 0, detail: activeParts > 0 ? `${activeParts} used` : null },
    { key: 'complete', label: 'Complete', done: status === 'completed', detail: null },
  ]
  if (money) {
    rows.push(
      { key: 'invoice', label: 'Invoice', done: Boolean(live), detail: live ? live.invoice_number : null },
      { key: 'payment', label: 'Payment', done: live?.payment_status === 'paid', detail: live ? PAYMENT_STATUS_LABEL[live.payment_status] : null },
    )
  }

  return rows.map((r): HubStep => {
    const base = { key: r.key, label: r.label, detail: r.detail }
    if (failed) {
      if (r.key === 'request') return { ...base, state: 'blocked', detail: status === 'declined' ? 'Declined' : 'Withdrawn by the customer' }
      return { ...base, state: 'closed' }
    }
    if (r.key === 'decision' && (auth === 'declined' || auth === 'revoked')) return { ...base, state: 'blocked' }
    if (r.key === current) return { ...base, state: 'current' }
    if (r.done) return { ...base, state: 'done' }
    if (r.optional) return { ...base, state: 'optional' }
    return { ...base, state: 'upcoming' }
  })
}
