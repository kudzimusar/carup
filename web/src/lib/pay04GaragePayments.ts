/**
 * CARUP-PAY-04 — garage invoice payments in the browser: types and the words people read.
 *
 * Nothing here decides money. The server's canonical functions say what was recorded by the garage, what the garage's
 * payment provider confirmed, what is in flight and what is still owed; this module only names those facts. Two rules
 * shape every label:
 *  - money is never "paid" before the provider confirmed it — a checkout, a return from the provider or a webhook in
 *    flight is "in progress", never success;
 *  - garage revenue is the garage's: nothing says CarUp received, holds or settles it.
 */
import type { Decimal, GarageInvoice, PaymentStatus } from './garageBusiness'

export type InvoiceMoney = {
  declared_paid: Decimal
  provider_paid: Decimal
  provider_reserved: Decimal
  uncommitted_balance: Decimal
}

export type ProviderPaymentState =
  | 'awaiting_provider' | 'stopping' | 'stopped' | 'expired' | 'confirmed' | 'confirmed_unallocated' | 'under_review'
  | 'refund_pending' | 'refunded' | 'partially_refunded' | 'cancelled' | 'unknown'
  // PAY-05 (Paynow cannot cancel or expire a request, and what counts is what was counted)
  | 'at_paynow' | 'released' | 'settled_outside' | 'not_counted' | 'closed_not_counted' | 'closed_live' | 'reviewed_held'
  | 'no_longer_needed' | 'confirmed_partial'

export type ProviderPayment = {
  id: string
  amount: Decimal
  currency: string
  initiated_at: string
  expires_at: string
  cancelled_at: string | null
  state: ProviderPaymentState
  state_label: string
  payment_status: string | null
  gateway: string
  simulated: boolean
  source_label: string
  /** PAY-05: what CarUp counts of this payment */
  counted_amount?: Decimal
  /** garage and operator views only */
  open_discrepancies?: Array<{ id: string; type: string; amount: Decimal | null; first_detected_at: string; observation_count: number; opened_by_operator?: boolean }>
}

export type ProviderReceipt = {
  id: string
  receipt_number: string
  collection_id: string
  amount: Decimal
  currency: string
  status: 'issued' | 'voided'
  issued_at: string
  voided_at: string | null
  payment_source: 'provider_confirmed'
  payment_source_label: string
}

export type ProviderActivity = { event_type: string; actor: string; detail: Record<string, unknown>; created_at: string; collection_id?: string }

/** The fields PAY-04 adds to an OPS07 invoice view (absent where PAY-04 is not installed). */
export type InvoiceProviderFields = {
  provider_payments_supported?: boolean
  money?: InvoiceMoney | null
  provider_payments?: ProviderPayment[]
  provider_receipts?: ProviderReceipt[]
  provider_source_label?: string
  /** garage view only: the append-only provider-payment activity of the invoice */
  provider_history?: ProviderActivity[]
}

export const PROVIDER_EVENT_LABEL: Record<string, string> = {
  initiated: 'Customer started a payment through the provider',
  provider_attached: 'Provider checkout created',
  provider_observed: 'Provider status read',
  allocated: 'Counted on the invoice',
  deallocated: 'No longer counted on the invoice',
  receipt_issued: 'Receipt issued',
  receipt_voided: 'Receipt voided',
  refund_requested: 'Refund requested by the garage',
  cancelled: 'Checkout stopped or closed',
  // PAY-05 (Paynow)
  hold_released: 'A CarUp operator released the amount this request held',
  discrepancy_opened: 'Discrepancy opened',
  discrepancy_observed: 'Discrepancy seen again',
  discrepancy_resolved: 'Discrepancy closed',
}

/** Who did it, in words: the provider, or the person (by role, never by guessed name). */
export function activityActor(actor: string): string {
  if (actor.startsWith('provider:')) return 'Payment provider'
  return actor.startsWith('system:') ? 'CarUp' : 'CarUp user'
}

export type PaymentInstructions = {
  id: string
  version: number
  status: 'active' | 'superseded'
  payee_name: string
  instructions: string
  accepted_methods: string[]
  currencies: string[]
  created_at: string
  superseded_at: string | null
  disclosure: string
}

export type OnlinePaymentOption =
  | { available: true; simulated: boolean; merchant_display_name: string; max_amount: Decimal; currency: string; simulation_notice: string | null }
  | { available: false; reason: 'not_offered' | 'invoice_not_payable' | 'garage_not_connected' | 'currency_not_supported' | 'provider_not_enabled' | 'payment_in_progress' | 'nothing_due' | 'earlier_request_unresolved' }

export type CustomerInvoicePayment = {
  invoice_id: string
  invoice_number: string
  status: 'issued' | 'voided'
  currency: string
  money: {
    currency: string; invoice_status: string; total_amount: Decimal; declared_paid: Decimal; provider_paid: Decimal; paid_amount: Decimal
    balance_amount: Decimal; provider_reserved: Decimal; uncommitted_balance: Decimal; payment_status: PaymentStatus
  }
  payment_instructions: PaymentInstructions | null
  instructions_missing_label: string | null
  online_payment: OnlinePaymentOption
  provider_payments: ProviderPayment[]
  provider_receipts: ProviderReceipt[]
  labels: { declared: string; provider: string; in_flight: string }
}

export type StartPaymentResult = {
  collection_id: string
  checkout_url: string
  replayed: boolean
  simulated: boolean
  amount: Decimal
  currency: string
  expires_at: string
  notice: string
}

export type CollectionOutcome = {
  collection: ProviderPayment | null
  applied: boolean
  refused: string | null
  duplicate_event: boolean
  payment_status: string | null
  money: CustomerInvoicePayment['money']
}

export type GarageFinancialOverview = {
  currencies: Array<{
    currency: string; invoiced: Decimal; declared_paid: Decimal; provider_paid: Decimal; outstanding: Decimal; in_flight: Decimal
    counts: { issued: number; voided: number; unpaid: number; partially_paid: number; paid: number }
  }>
  truncated: boolean
  invoice_count: number
  open_discrepancies: number
  /** connected = customers can pay through it. A merchant still awaiting CarUp's verification is named, and not connected. */
  provider: { connected: false; status?: undefined } | { connected: boolean; gateway: string; simulated: boolean; display_name: string; currencies: string[]; status: string }
  provider_payments_enabled: boolean
  payment_instructions: PaymentInstructions | null
  revenue_owner_note: string
  labels: { declared: string; provider: string }
}

export type GaragePaymentInstructionsView = { active: PaymentInstructions | null; history: PaymentInstructions[]; disclosure: string }

export type GaragePaymentExceptions = {
  discrepancies: Array<{
    id: string; type: string; garage: string | null; tenant_id: string; invoice_id: string; collection_id: string
    amount: Decimal | null; currency: string; evidence: Record<string, unknown>; detected_via: string; first_detected_at: string; observation_count: number
    history?: ProviderActivity[]
    /** whose collection it is: 'pay04_garage_provider_simulator', or 'paynow_zimbabwe' for the garage's own Paynow merchant (PAY-05) */
    gateway?: string
  }>
  reconciliation_holds: Array<{
    history?: ProviderActivity[]
    id: string; payment_reference: string; status: string; gateway: string; payment_amount_minor: number; currency: string; mismatch: string
    detected_refunded_minor: number; detected_pending_refund_minor: number; first_detected_at: string; observation_count: number
    acknowledged_at: string | null; collection: { id: string; tenant_id: string; invoice_id: string } | null; resolve_via: string
  }>
}

export type GarageMerchantAccount = {
  id: string; tenant_id: string; gateway: string; merchant_reference: string; display_name: string; currencies: string[]
  status: 'simulated' | 'suspended'; authority_note: string; registered_by: string; registered_at: string
  suspended_at: string | null; suspended_reason: string | null
}

export const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'card_external', label: 'Card (taken by the garage)' },
  { value: 'other', label: 'Other' },
]

export const ONLINE_PAYMENT_REASON_LABEL: Record<Extract<OnlinePaymentOption, { available: false }>['reason'], string> = {
  not_offered: 'Online payment is not offered here. Pay the garage directly.',
  invoice_not_payable: 'This invoice is not open for payment.',
  garage_not_connected: 'This garage does not take payments through CarUp. Pay the garage directly.',
  currency_not_supported: 'The garage’s payment provider does not take this currency. Pay the garage directly.',
  provider_not_enabled: 'Online payment is switched off right now. Pay the garage directly.',
  payment_in_progress: 'A payment on this invoice is already in progress with the provider.',
  nothing_due: 'Nothing is left to pay on this invoice.',
  // PAY-05: never prompt a second payment while an earlier request may hold the customer's money
  earlier_request_unresolved: 'An earlier Paynow request on this invoice may still hold your money. Do not pay again: check its status below, or ask the garage.',
}

export const DISCREPANCY_LABEL: Record<string, string> = {
  unallocated_provider_money: 'Provider confirmed money this invoice could not absorb',
  amount_mismatch: 'Provider reported a different amount',
  currency_mismatch: 'Provider reported a different currency',
  merchant_mismatch: 'Provider evidence named another merchant',
  refund_after_resolution: 'Provider reported more refund than the operator verified',
  // PAY-05 (Paynow)
  provider_disputed: 'Paynow holds this payment in a dispute',
  provider_status_unrecognized: 'Paynow reported a status CarUp does not recognise, or a step backwards',
  provider_refund_unquantified: 'Paynow reports a refund without an amount — confirm it in the garage’s Paynow records',
  provider_paid_after_close: 'Paynow took money after CarUp had closed this payment',
}

/**
 * The money-action button colours (record, pay, save, confirm); call sites add the min-h-11 touch target. WCAG 2 AA: white on orange-700 is 5.2:1 at rest and on
 * orange-800 7.3:1 on hover; the orange-500/600 shades it replaces were 2.7:1 and 3.6:1 (found by axe in physical UAT).
 */
export const MONEY_ACTION_BUTTON_CLASS = 'bg-orange-700 text-white hover:bg-orange-800'

const zero = (v: Decimal | null | undefined) => v === null || v === undefined || Number(v) === 0

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
/** A provider minor-unit amount in the currency's own precision (the same table the database uses). */
export function minorToMajor(minor: number, currency: string): string {
  const scale = ZERO_DECIMAL.has(currency) ? 0 : 2
  return `${(Number(minor) / 10 ** scale).toFixed(scale)} ${currency}`
}

/**
 * The payment state in words. OPS07's labels say "(recorded by the garage)", which is only true while every counted
 * payment WAS recorded by the garage. Once provider-confirmed money counts, the label names both sources.
 */
export function paymentStatusLabel(invoice: Pick<GarageInvoice, 'payment_status' | 'status'> & InvoiceProviderFields): string {
  if (invoice.status === 'voided' || invoice.payment_status === 'voided') return 'Voided'
  const provider = invoice.money && !zero(invoice.money.provider_paid)
  const declared = invoice.money ? !zero(invoice.money.declared_paid) : true
  if (invoice.payment_status === 'unpaid') {
    // reserved money may be a checkout in progress, a refund in progress or money held for review: none of it counts
    if (!invoice.money || zero(invoice.money.provider_reserved)) return 'No payment counted yet'
    // PAY-05: a Paynow request may only be waiting for the customer's approval: CarUp does not know any money moved (ICR-W9)
    return invoice.provider_payments?.some((p) => p.gateway === 'paynow_zimbabwe')
      ? 'Not paid yet — a Paynow payment is in progress or under review and is not counted'
      : 'Not paid yet — money is with the provider (in progress or under review) and not counted'
  }
  if (invoice.payment_status !== 'paid' && invoice.payment_status !== 'partially_paid') return 'Payment status unavailable'
  const whole = invoice.payment_status === 'paid' ? 'Paid in full' : 'Partly paid'
  if (!provider) return `${whole} (recorded by the garage)`
  return declared ? `${whole} (recorded by the garage and confirmed by its payment provider)` : `${whole} (confirmed by the garage’s payment provider)`
}

/** What a review is about, in words. A review an operator opened says so: Paynow did not report anything new. */
export function discrepancyLabel(d: { type: string; opened_by_operator?: boolean; evidence?: unknown }): string {
  const opened = d.opened_by_operator || (d.evidence as { reason?: string } | null | undefined)?.reason === 'operator_opened'
  return opened ? 'Opened by a CarUp operator: nothing else could move this request' : DISCREPANCY_LABEL[d.type] ?? d.type
}

export const PROVIDER_STATE_TONE: Record<ProviderPaymentState, string> = {
  awaiting_provider: 'bg-amber-50 text-amber-900 border-amber-300',
  at_paynow: 'bg-amber-50 text-amber-900 border-amber-300',
  released: 'bg-gray-100 text-gray-800 border-gray-300',
  settled_outside: 'bg-gray-100 text-gray-800 border-gray-300',
  not_counted: 'bg-amber-50 text-amber-900 border-amber-300',
  closed_not_counted: 'bg-gray-100 text-gray-800 border-gray-300',
  closed_live: 'bg-amber-50 text-amber-900 border-amber-300',
  reviewed_held: 'bg-amber-50 text-amber-900 border-amber-300',
  no_longer_needed: 'bg-gray-100 text-gray-800 border-gray-300',
  confirmed_partial: 'bg-red-50 text-red-900 border-red-300',
  stopping: 'bg-amber-50 text-amber-900 border-amber-300',
  stopped: 'bg-gray-100 text-gray-800 border-gray-300',
  expired: 'bg-gray-100 text-gray-800 border-gray-300',
  confirmed: 'bg-green-50 text-green-900 border-green-300',
  confirmed_unallocated: 'bg-red-50 text-red-900 border-red-300',
  under_review: 'bg-red-50 text-red-900 border-red-300',
  refund_pending: 'bg-amber-50 text-amber-900 border-amber-300',
  refunded: 'bg-gray-100 text-gray-800 border-gray-300',
  partially_refunded: 'bg-amber-50 text-amber-900 border-amber-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
  unknown: 'bg-gray-100 text-gray-800 border-gray-300',
}

/**
 * What the customer is told after returning from the provider. Success is claimed ONLY when CarUp's own fresh
 * provider read says the payment is confirmed and counted.
 */
export function returnOutcomeMessage(outcome: CollectionOutcome | null, failed: boolean): { tone: 'ok' | 'wait' | 'warn' | 'error'; text: string } {
  if (failed || !outcome) return { tone: 'error', text: 'CarUp could not check this payment with the provider just now. Nothing is shown as paid until it can. Try “Check payment status” again.' }
  const state = outcome.collection?.state
  if (state === 'confirmed') return { tone: 'ok', text: 'The garage’s payment provider confirmed your payment. It now counts on the invoice.' }
  if (state === 'awaiting_provider') return { tone: 'wait', text: 'The provider has not confirmed this payment yet. It is not counted until it does.' }
  if (state === 'under_review' || state === 'confirmed_unallocated') return { tone: 'warn', text: 'This payment needs review before it can count. The garage and CarUp can see it.' }
  // "Nothing was charged" only once the PROVIDER has confirmed the checkout closed unpaid
  if (state === 'stopping' || state === 'expired') {
    return { tone: 'wait', text: 'This checkout ended before the provider confirmed a payment, so it is not counted. CarUp is confirming with the provider that nothing was paid.' }
  }
  if (state === 'stopped' || state === 'cancelled') return { tone: 'warn', text: 'This checkout ended without a payment. The provider confirmed nothing was charged.' }
  return { tone: 'warn', text: outcome.collection?.state_label || 'This payment is not counted.' }
}

/** PAY-04 refusals in words. The server answers with a code; people read a sentence that says what happened. */
const PAY04_ERROR_TEXT: Record<string, string> = {
  PAY04_AMOUNT_INVALID: 'Enter an amount in the invoice’s currency, for example 120.00.',
  PAY04_COLLECTION_EXCEEDS_UNCOMMITTED_BALANCE: 'That is more than is still open on this invoice. Nothing was charged.',
  PAY04_IDEMPOTENCY_CONFLICT: 'That request was already started with a different amount. Reload and try again. Nothing was charged.',
  PAY04_INVOICE_NOT_PAYABLE: 'This invoice is not open for payment.',
  PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE: 'CarUp could not reach the garage’s payment provider. Nothing changed; try again shortly.',
  PAY04_PROVIDER_CANCEL_UNAVAILABLE: 'CarUp could not reach the payment provider to stop this checkout. Nothing changed and it is still waiting; try again shortly.',
  PAY04_PROVIDER_REFUND_REFUSED: 'The payment provider refused the refund. Nothing was refunded and the payment still counts on the invoice.',
  PAY04_COLLECTION_NOT_CANCELLABLE: 'This checkout can no longer be stopped — the provider has already settled it. Check its status.',
  PAY04_COLLECTION_CLOSED: 'This checkout has already ended. Start a new payment if one is still due.',
  PAY04_REFUND_NOT_ALLOWED: 'Only a payment the provider has confirmed, and that is not already being refunded, can be refunded.',
  PAY04_REASON_REQUIRED: 'Give a reason (at least a few words).',
  PAY04_RESOLUTION_SELF_DEALING_REFUSED: 'Refused: you are connected to this payment (as payer or garage member), so another operator must close it.',
  PAY04_RESOLUTION_AUTHORITY_REFUSED: 'Only a platform administrator can close this.',
  PAY04_RESOLUTION_INVALID: 'That closure does not fit this kind of exception.',
  PAY04_RESOLUTION_REQUIRES_PROVIDER_REFUND: 'Close it as refunded only after the provider has confirmed the refund.',
  PAY04_RESOLUTION_NOTE_REQUIRED: 'Write a note of at least 10 characters.',
  PAY04_DISCREPANCY_NOT_OPEN: 'This exception is already closed.',
  PAY04_DISABLED: 'Online garage payments are switched off right now.',
}
export function pay04ErrorText(message: string): string {
  const code = /\bPAY04_[A-Z0-9_]+\b/.exec(message)?.[0]
  if (!code) return message
  return PAY04_ERROR_TEXT[code] ?? 'That did not go through. Nothing was changed. Try again, or contact CarUp support.'
}

/** Why an online amount cannot be sent (null when it can): the currency’s own precision, more than zero, at most `max`. */
export function onlineAmountProblem(raw: string, max: string, currency: string): string | null {
  const scale = ZERO_DECIMAL.has(currency) ? 0 : 2
  const text = raw.trim()
  const pattern = scale === 0 ? /^\d{1,12}$/ : /^\d{1,12}(\.\d{1,2})?$/
  if (!pattern.test(text)) return scale === 0 ? `Enter a whole amount in ${currency}.` : `Enter an amount in ${currency}, for example 120.00.`
  const minor = (v: string) => {
    const [whole, frac = ''] = v.split('.')
    return BigInt(whole) * BigInt(10 ** scale) + BigInt((frac + '00').slice(0, scale) || '0')
  }
  if (minor(text) <= 0n) return 'Enter an amount of more than zero.'
  if (minor(text) > minor(max)) return `You can pay at most ${max} ${currency} here.`
  return null
}
