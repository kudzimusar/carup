/**
 * GARAGE-1.0 — the typed contract between the Garage business screens and the API.
 *
 * Money rules the types encode (the server enforces them; the types make a screen unable to forget):
 *  - every amount is a decimal STRING with an explicit currency beside it — never a float, never a default;
 *  - `null` is "not recorded". A screen must render it as such ("Not recorded"), never as 0;
 *  - payment state is DERIVED server-side from the payment records the garage entered; nothing here is
 *    ever "paid" because a job finished or an invoice exists.
 */

export type Decimal = string
export type MoneyAmount = { amount: Decimal; currency: string }

// ───────────────────────────── estimates ─────────────────────────────

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'superseded' | 'cancelled'
export type EstimateLineCategory = 'labour' | 'part' | 'fee' | 'other'

export type EstimateLine = {
  line_no: number
  category: EstimateLineCategory
  description: string
  quantity: Decimal
  unit_price: Decimal | null
  line_total: Decimal | null
  price_recorded: boolean
}

export type EstimateLineInput = {
  category: EstimateLineCategory
  description: string
  quantity: Decimal | number
  /** omit / null = not recorded. 0 = explicitly free. */
  unit_price?: Decimal | number | null
}

export type EstimateTotalState = 'not_recorded' | 'draft_total' | 'frozen_at_send'

export type GarageEstimate = {
  id: string
  service_case_id: string
  work_order_id: string
  version: number
  status: EstimateStatus
  currency: string
  customer_note: string | null
  /** garage-admin only */
  internal_note?: string | null
  valid_until: string | null
  expired: boolean
  sent_at: string | null
  decided_at: string | null
  decision_basis: 'owner' | 'dealer' | 'platform' | null
  decision_reason: string | null
  total_amount: Decimal | null
  total_state: EstimateTotalState
  line_count: number
  lines: EstimateLine[]
  created_at?: string
  updated_at?: string
  cancel_reason?: string | null
  history?: Array<{ event_type: string; actor_scope: string; previous_status: string | null; new_status: string | null; estimate_version: number; work_order_authorization: string | null; created_at: string }>
  notification?: NotificationOutcome
}

export type NotificationOutcome = { attempted: number; emitted: number; failures: string[]; replayed?: boolean }

export type CaseEstimatesResponse = {
  service_case_id: string
  case_status: string
  work_order: { id: string; status: string; owner_authorization: OwnerAuthorization; owner_authorized_at: string | null } | null
  estimates: GarageEstimate[]
  latest: GarageEstimate | null
}

export type EstimateDraftInput = {
  currency: string
  lines: EstimateLineInput[]
  customer_note?: string | null
  internal_note?: string | null
  valid_until?: string | null
  /** optimistic concurrency: the draft's updated_at you last saw */
  expected_updated_at?: string | null
}

export type OwnerAuthorization = 'pending' | 'authorized' | 'declined' | 'revoked'

/** What the CUSTOMER sees: never a draft, never the garage's internal note. */
export type CustomerEstimate = Omit<GarageEstimate, 'internal_note' | 'history' | 'notification' | 'created_at' | 'updated_at' | 'cancel_reason'> & {
  vin: string | null
  /** true only for the vehicle's registered owner, while the estimate is sent and unexpired */
  can_decide: boolean
  /** the person asked for the work but is not the registered owner: they can follow it, not decide it */
  awaiting_owner: boolean
}

export type EstimateDecisionResult = { success: true; decision: 'accepted' | 'declined'; estimate_id: string; work_order_authorization: OwnerAuthorization }

// ───────────────────────────── the operating hub ─────────────────────────────

export type NextAction =
  | 'accept_or_decline' | 'prepare_estimate' | 'send_estimate' | 'await_customer' | 'revise_estimate'
  | 'assign_mechanic' | 'start_work' | 'record_service' | 'complete_job' | 'authorization_revoked'
  | 'issue_invoice' | 'await_payment' | 'none'

export type AllowedAction =
  | 'accept_case' | 'decline_case' | 'prepare_estimate' | 'edit_estimate' | 'send_estimate' | 'cancel_estimate'
  | 'revise_estimate' | 'assign_mechanic' | 'start_work' | 'record_service' | 'use_part' | 'complete_job'
  | 'issue_invoice' | 'record_payment' | 'void_invoice' | 'reverse_payment'

export type HubServiceRecord = {
  id: string
  service_category: string | null
  service_authority: string
  /** the workshop's own account of the work — private to the garage */
  work_performed: string | null
  cost: MoneyAmount | null
  performed_at: string | null
  recorded_by_user_id: string
}

export type PartUsage = {
  id: string
  service_record_id: string
  part_id: string
  quantity: number
  part_name_snapshot: string
  part_sku_snapshot: string
  unit_cost_snapshot: Decimal | null
  sell_price_snapshot: Decimal | null
  price_currency_snapshot: string | null
  partsentry_log_id: number | string | null
  reversed_at: string | null
  active: boolean
}

export type VarianceView =
  | { state: 'no_estimate' }
  | { state: 'awaiting_invoice' }
  | { state: 'not_comparable'; reason: string }
  | { state: 'comparable'; currency: string; estimate_total: Decimal; invoice_total: Decimal; difference: string; direction: 'same' | 'over_estimate' | 'under_estimate' }

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'voided'

export type PaymentRecord = {
  id: string
  kind: 'payment' | 'reversal'
  amount: Decimal
  currency: string
  method: 'cash' | 'bank_transfer' | 'mobile_money' | 'card_external' | 'other'
  reference: string | null
  paid_at: string
  recorded_at: string
  source: 'garage_recorded_external'
  /** always: "Recorded by the garage. CarUp has not processed or verified this payment." */
  source_label: string
  reverses_payment_id: string | null
  reason?: string | null
}

export type Receipt = {
  id: string
  receipt_number: string
  payment_id: string
  amount: Decimal
  currency: string
  status: 'issued' | 'voided'
  issued_at: string
  voided_at: string | null
  payment_source: 'garage_recorded_external'
  payment_source_label: string
}

export type InvoiceLine = { line_no: number; category: EstimateLineCategory; description: string; quantity: Decimal; unit_price: Decimal; line_total: Decimal }

export type GarageInvoice = {
  id: string
  invoice_number: string
  service_case_id: string
  work_order_id: string
  status: 'issued' | 'voided'
  currency: string
  total_amount: Decimal
  line_count: number
  customer_note: string | null
  /** garage-admin only */
  internal_note?: string | null
  due_date: string | null
  issued_at: string
  voided_at: string | null
  void_reason?: string | null
  estimate: { version: number; total_amount: Decimal; currency: string } | null
  variance: VarianceView
  payment_status: PaymentStatus
  paid_amount: Decimal
  balance_amount: Decimal
  payment_source_label: string
  lines: InvoiceLine[]
  payments: PaymentRecord[]
  receipts: Receipt[]
  history?: Array<{ event_type: string; actor_user_id: string; created_at: string; detail: Record<string, unknown> }>
  notification?: NotificationOutcome
}

export type CustomerInvoice = Omit<GarageInvoice, 'internal_note' | 'void_reason' | 'history' | 'notification' | 'issued_by_user_id'> & { vin: string | null }

export type InvoiceLineInput = {
  category: EstimateLineCategory
  description: string
  quantity: Decimal | number
  /** an invoice states amounts: every line must be priced */
  unit_price: Decimal | number
  source_kind?: 'manual' | 'service_record' | 'part_usage'
  source_id?: string | null
}

export type SuggestedInvoiceLine = Omit<InvoiceLineInput, 'unit_price'> & { unit_price: Decimal | null }

export type Closeout = {
  service_case_id: string
  case_status: string
  work_order: { id: string; status: string; owner_authorization: OwnerAuthorization } | null
  estimate: { id: string; version: number; currency: string; total_amount: Decimal } | null
  actual_work: Array<{ service_record_id: string; service_category: string | null; service_authority: string; performed_at: string | null; cost: MoneyAmount | null }>
  parts_used: PartUsage[]
  recorded_cost_by_currency: Array<{ currency: string; total: Decimal | null }>
  suggested_invoice: { currency: string | null; lines: SuggestedInvoiceLine[]; notes: string[] } | null
  invoice: GarageInvoice | null
  variance: VarianceView
  can_issue_invoice: boolean
  payment_source_label: string
}

export type HubServiceCase = {
  id: string
  status: string
  vin: string
  service_category: string | null
  requested_at: string | null
  accepted_at: string | null
  started_at: string | null
  completed_at: string | null
  branch_id: string | null
  request_summary: string | null
}

export type CaseHub = {
  case: HubServiceCase
  vehicle: { vin: string; make: string | null; model: string | null; year: number | null } | null
  work_order: { id: string; status: string; owner_authorization: OwnerAuthorization; owner_authorized_at: string | null; assigned_mechanic_user_id: string | null } | null
  appointment: { id: string; status: string; starts_at: string; ends_at: string; appointment_timezone: string; branch_id: string; planned_workforce_profile_id: string | null } | null
  estimates: { latest: GarageEstimate | null; versions: GarageEstimate[] }
  service_records: HubServiceRecord[]
  parts_used: PartUsage[]
  /** null for a mechanic: money is a garage-admin matter */
  closeout: Closeout | null
  mechanics: Array<Record<string, unknown>>
  history: Array<{ event_type: string; from_status: string | null; to_status: string | null; at: string }>
  next_action: NextAction
  /** exactly what the backend will accept from THIS caller now — offer nothing else */
  allowed_actions: AllowedAction[]
  viewer: { role: string | null; is_admin: boolean }
}

// ───────────────────────────── stock ─────────────────────────────

export type StockState = 'unknown' | 'uncounted' | 'out' | 'low' | 'in_stock'

export type GaragePart = {
  id: string
  name: string
  sku: string
  /** null = unknown. Never render as 0. */
  stock_level: number | null
  stock_state: StockState
  /** false = a legacy quantity nobody has counted against the shelf */
  counted: boolean | null
  /** null = no threshold was ever set; "low" is then never claimed */
  min_stock: number | null
  /** free text exactly as the garage stated it; null = not stated */
  supplier: string | null
  unit_cost: Decimal | null
  sell_price: Decimal | null
  price_currency: string | null
  legacy_unit_price: Decimal | null
  legacy_price_currency_unknown: boolean
  is_active: boolean
  last_movement_at: string | null
  updated_at: string | null
}

export type StockMovement = {
  id: string
  seq: number | string
  movement_type: 'opening' | 'receipt' | 'consumption' | 'adjustment' | 'reversal'
  quantity_delta: number
  balance_before: number
  balance_after: number
  reason_code: string | null
  note: string | null
  work_order_id: string | null
  service_record_id: string | null
  actor_user_id: string
  created_at: string
}

export type StockListResponse = {
  parts: GaragePart[]
  summary: { total: number; out: number; low: number; uncounted: number; unknown: number }
}
export type StockPartResponse = { part: GaragePart; movements: StockMovement[] }

export type CreatePartInput = {
  name: string
  sku: string
  /** stated, never defaulted: 0 is a count, absence is a refusal */
  opening_quantity: number
  min_stock?: number | null
  supplier?: string | null
  unit_cost?: Decimal | number | null
  sell_price?: Decimal | number | null
  /** required whenever a cost or price is given */
  price_currency?: string | null
  idempotency_key?: string
}

// ───────────────────────────── operations view ─────────────────────────────

export type RateMetric =
  | { state: 'measured'; rate: number; unit: 'percent'; numerator: number; denominator: number; definition: string }
  | { state: 'not_measured'; reason: string; numerator?: number; denominator?: number; definition?: string }

export type OperationsSummary = {
  window_days: 7 | 30 | 90
  window: { from: string; to: string }
  generated_at: string
  truncated: boolean
  work: {
    open_cases: { requested: number; accepted: number; active: number; definition: string }
    completed_jobs: { value: number; definition: string }
    cycle_time: { state: 'measured'; average_hours: number; jobs: number; definition: string } | { state: 'not_measured'; reason: string; definition: string }
    by_site: Array<{ branch_id: string | null; name: string | null; open: number; completed_in_window: number }>
    by_mechanic: Array<{ user_id: string | null; name: string | null; completed_jobs: number; attribution: 'assigned_mechanic' | 'no_assignment_recorded' }>
    repeat_customers: { state: 'measured'; repeat: number; identified: number; definition: string } | { state: 'not_measured'; reason: string }
  }
  appointments: { by_status: Record<string, number>; upcoming_confirmed: { value: number; definition: string }; no_show_rate: RateMetric }
  estimates: { by_status: Record<string, number>; sent_in_window: { value: number; definition: string }; approval_rate: RateMetric }
  money: {
    invoiced_by_currency: Array<{ currency: string; total: Decimal; invoices: number }>
    outstanding_by_currency: Array<{ currency: string; balance: Decimal; definition: string }>
    recorded_payments_by_currency: Array<{ currency: string; net_recorded: Decimal; source: 'garage_recorded_external'; label: string }>
    estimate_vs_invoice: { by_currency: Array<{ currency: string; jobs: number; estimate_total: Decimal; invoice_total: Decimal; difference: string }>; not_comparable: number; definition: string }
    note: string
  }
  parts: { used_in_window: Array<{ part_name: string; sku: string; quantity: number }>; stock_alerts: StockListResponse['summary']; definition: string }
  /** metrics CarUp deliberately does not compute, each with the reason */
  not_measured: Array<{ key: string; reason: string }>
}

// ───────────────────────────── helpers ─────────────────────────────

/** One stable key per user ATTEMPT (generate it when the form opens, not per click) so a retry cannot double-record. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** "Not recorded" is a state, not a zero. */
export function formatMoney(amount: Decimal | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return 'Not recorded'
  return currency ? `${amount} ${currency}` : String(amount)
}

export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  accept_or_decline: 'Accept or decline the request',
  prepare_estimate: 'Prepare an estimate',
  send_estimate: 'Send the estimate to the customer',
  await_customer: 'Waiting for the customer to decide on the estimate',
  revise_estimate: 'The customer declined — revise the estimate',
  assign_mechanic: 'Assign a mechanic',
  start_work: 'Start the work',
  record_service: 'Record the work that was done',
  complete_job: 'Complete the job',
  authorization_revoked: 'The customer withdrew their authorization',
  issue_invoice: 'Issue the invoice',
  await_payment: 'Waiting for payment',
  none: 'Nothing further to do',
}

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: 'Draft', sent: 'Sent to customer', accepted: 'Accepted', declined: 'Declined', superseded: 'Replaced by a newer version', cancelled: 'Cancelled',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'No payment recorded', partially_paid: 'Partly paid (recorded by the garage)', paid: 'Paid in full (recorded by the garage)', voided: 'Voided',
}

export const STOCK_STATE_LABEL: Record<StockState, string> = {
  unknown: 'Quantity unknown', uncounted: 'Not counted yet', out: 'Out of stock', low: 'Low stock', in_stock: 'In stock',
}
