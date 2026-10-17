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

export type CaseStatus = 'requested' | 'accepted' | 'active' | 'completed' | 'declined' | 'cancelled' | string
export type WorkOrderStatus = 'In Progress' | 'Completed' | 'Cancelled' | string

/** The four things a garage can be waiting to do. Anything else is not actionable. */
export type NextAction = 'accept_or_decline' | 'open_work_order' | 'start_work' | 'record_service' | 'none'

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
 * What this case is waiting for.
 *
 * Mirrors `getGarageQueue`: requested → accept or decline; accepted → open a work order, or start
 * once one exists; active → record what was done. A terminal case is waiting for nothing, and
 * saying "none" is how the UI knows to offer no buttons rather than offering ones that will 409.
 */
export function nextActionFor(status: CaseStatus, hasWorkOrder: boolean): NextAction {
  if (status === 'requested') return 'accept_or_decline'
  if (status === 'accepted') return hasWorkOrder ? 'start_work' : 'open_work_order'
  if (status === 'active') return 'record_service'
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
