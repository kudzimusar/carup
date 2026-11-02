/**
 * CARUP-PAY-05 — paying a garage through the garage's OWN Paynow merchant: types and the words people read.
 *
 * Nothing here decides money. Three rules shape every label:
 *  - Paynow's own statuses stay distinct: waiting, paid into Paynow's escrow (not yet the garage's), paid, disputed,
 *    refunded, cancelled — only "Paid" counts on the invoice;
 *  - coming back from Paynow, or a message that is not Paynow's signed status, is never proof of payment;
 *  - Paynow cannot cancel a request or refund through CarUp, and the words say so instead of pretending otherwise.
 */
import type { Decimal } from './garageBusiness'
import type { CollectionOutcome, ProviderPayment } from './pay04GaragePayments'

export type PaynowMethod = 'web' | 'ecocash' | 'onemoney' | 'innbucks' | 'omari'
export type PaynowStatus =
  | 'created' | 'sent' | 'awaiting_delivery' | 'delivered' | 'paid' | 'cancelled' | 'failed' | 'disputed' | 'refunded' | 'unrecognized'

export type PaynowView = {
  method: PaynowMethod
  initiation: 'sending' | 'attached' | 'refused' | 'unknown' | 'traced_absent'
  provider_status: PaynowStatus | null
  provider_status_label: string
  checkout_url: string | null
  instructions: string | null
  authorization_code: string | null
  authorization_expires: string | null
  otp_reference: string | null
  needs_otp: boolean
  phone: string | null
  hold_released: boolean
  paynow_reference?: string | null
  provider_error?: string | null
  simulated?: boolean
}

export type PaynowOnlineOption = {
  available: true
  gateway: 'paynow_zimbabwe'
  provider: 'paynow'
  simulated: boolean
  merchant_display_name: string
  max_amount: Decimal
  currency: string
  methods: PaynowMethod[]
  simulation_notice: string | null
  notices: { no_redirect_proof: string; cannot_cancel: string; channel: string }
}

export type PaynowStartResult = {
  collection_id: string
  gateway: 'paynow_zimbabwe'
  replayed: boolean
  simulated: boolean
  amount: Decimal
  currency: string
  expires_at: string
  checkout_url: string | null
  paynow: PaynowView | null
  notice: string
  cannot_cancel: string
}

export type PaynowOutcome = CollectionOutcome & { paynow?: PaynowView | null; notice?: string }
export type PaynowProviderPayment = ProviderPayment & { paynow?: PaynowView | null }

export const PAYNOW_METHOD_LABEL: Record<PaynowMethod, string> = {
  web: 'Card, Zimswitch or another method on Paynow’s page',
  ecocash: 'EcoCash',
  onemoney: 'OneMoney',
  innbucks: 'InnBucks',
  omari: 'O’mari',
}

export const PAYNOW_METHOD_HINT: Record<PaynowMethod, string> = {
  web: 'You will go to Paynow’s own page to pay.',
  ecocash: 'Paynow sends a payment request to your EcoCash phone; you approve it with your PIN.',
  onemoney: 'Paynow sends a payment request to your OneMoney phone; you approve it with your PIN.',
  innbucks: 'Enter the mobile number of your InnBucks account; Paynow gives you an InnBucks code to pay in the InnBucks app (US dollars only).',
  omari: 'O’mari sends a one-time password to your phone by SMS; you enter it here.',
}

/** Paynow's express methods all start from the payer's mobile number; only Paynow's own page does not need one. */
export const PHONE_METHODS: PaynowMethod[] = ['ecocash', 'onemoney', 'omari', 'innbucks']
export const needsPhone = (method: PaynowMethod) => PHONE_METHODS.includes(method)

/** Paynow documents mobile numbers as 07XXXXXXXX; +263 7… is accepted and normalised by the server. */
export function phoneProblem(raw: string): string | null {
  const compact = raw.replace(/[\s()-]/g, '')
  const local = /^\+263\d{9}$/.test(compact) ? `0${compact.slice(4)}` : /^263\d{9}$/.test(compact) ? `0${compact.slice(3)}` : compact
  return /^07[1-9]\d{7}$/.test(local) ? null : 'Enter a Zimbabwe mobile number, for example 0771234567.'
}

/** A short badge word for each Paynow status (the full sentence is provider_status_label). */
export const PAYNOW_STATUS_SHORT: Record<PaynowStatus, string> = {
  created: 'Waiting', sent: 'Waiting for approval', awaiting_delivery: 'Held by Paynow', delivered: 'Held by Paynow', paid: 'Paid',
  cancelled: 'Cancelled', failed: 'Not completed', disputed: 'Disputed', refunded: 'Refunded', unrecognized: 'Under review',
}

export const PAYNOW_STATUS_TONE: Record<PaynowStatus, string> = {
  created: 'bg-amber-50 text-amber-900 border-amber-300',
  sent: 'bg-amber-50 text-amber-900 border-amber-300',
  awaiting_delivery: 'bg-amber-50 text-amber-900 border-amber-300',
  delivered: 'bg-amber-50 text-amber-900 border-amber-300',
  paid: 'bg-green-50 text-green-900 border-green-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
  failed: 'bg-gray-100 text-gray-800 border-gray-300',
  disputed: 'bg-red-50 text-red-900 border-red-300',
  refunded: 'bg-gray-100 text-gray-800 border-gray-300',
  unrecognized: 'bg-red-50 text-red-900 border-red-300',
}

/**
 * What the customer is told after checking a Paynow payment. Success only when Paynow's own status is Paid AND CarUp
 * counted it; escrow is "paid to Paynow, not yet counted"; a lost request is "checking", never "nothing was charged".
 */
export function paynowOutcomeMessage(outcome: PaynowOutcome | null, failed: boolean): { tone: 'ok' | 'wait' | 'warn' | 'error'; text: string } {
  if (failed || !outcome) {
    return { tone: 'error', text: 'CarUp could not check this payment with Paynow just now. Nothing is shown as paid until it can. Try “Check payment status” again.' }
  }
  const status = outcome.paynow?.provider_status ?? null
  const state = outcome.collection?.state
  if (status === 'paid' && state === 'confirmed') return { tone: 'ok', text: 'Paynow confirmed your payment. It now counts on the invoice.' }
  if (state === 'under_review' || state === 'confirmed_unallocated' || status === 'disputed' || status === 'unrecognized') {
    return { tone: 'warn', text: 'This payment needs review before it can count. The garage and CarUp have been alerted.' }
  }
  if (status === 'awaiting_delivery' || status === 'delivered') {
    return { tone: 'wait', text: 'Your money reached Paynow and is held by Paynow until it is released to the garage. It is not yet counted on the invoice.' }
  }
  if (status === 'cancelled' || status === 'failed') return { tone: 'warn', text: 'Paynow reports this payment was not completed. Nothing was charged.' }
  if (status === 'refunded') return { tone: 'warn', text: 'Paynow reports this payment was refunded to you.' }
  if (outcome.paynow?.initiation === 'unknown' || outcome.paynow?.initiation === 'sending') {
    return { tone: 'wait', text: 'CarUp is confirming with Paynow whether it received your payment request. Nothing is counted until it does.' }
  }
  return { tone: 'wait', text: outcome.paynow?.provider_status_label ?? 'Paynow has not confirmed this payment yet. It is not counted until it does.' }
}

/** PAY-05 refusals in words (PAY-04 codes keep their own sentences). */
const PAY05_ERROR_TEXT: Record<string, string> = {
  PAY05_PHONE_INVALID: 'Enter a Zimbabwe mobile number, for example 0771234567. Nothing was charged.',
  PAY05_METHOD_NOT_AVAILABLE: 'The garage does not take that payment method for this currency. Choose another. Nothing was charged.',
  PAY05_PROVIDER_REFUSED: 'Paynow refused this payment request. Nothing was charged.',
  PAY05_AUTH_EMAIL_REQUIRED: 'Paynow needs your account’s e-mail address for this method. Add one to your profile, or pay on Paynow’s page.',
  PAY05_INTEGRATION_UNAVAILABLE: 'The garage’s Paynow account cannot take this currency right now. Pay the garage directly.',
  PAY05_OTP_REJECTED: 'Paynow did not accept that code. After five wrong codes Paynow cancels the payment.',
  PAY05_OTP_INVALID: 'Enter the code from the SMS (numbers only).',
  PAY05_OTP_NOT_EXPECTED: 'This payment is not waiting for a code.',
  PAY05_PROVIDER_READ_FAILED: 'CarUp could not reach Paynow just now. Nothing changed; try again shortly.',
  PAY05_PROVIDER_REFUND_UNSUPPORTED: 'Paynow does not let CarUp refund. Refund the customer in your Paynow dashboard; CarUp records it when Paynow reports it.',
  PAY05_DISABLED: 'Paynow payments are switched off right now.',
  PAY05_ATTESTATION_REQUIRED: 'Confirm that this Paynow account and settlement account belong to your garage.',
  PAY05_SETTLEMENT_ACCOUNT_INVALID: 'Enter the last four digits of the settlement bank account.',
  PAY05_INTEGRATION_ID_INVALID: 'The Paynow integration ID is a number (from “Receive Payment Links” in Paynow).',
  PAY05_INTEGRATION_KEY_INVALID: 'Paste the integration key exactly as Paynow e-mailed it.',
  PAY05_INTEGRATIONS_INVALID: 'Add one integration for each currency you take (US dollars and/or ZiG).',
  PAY05_DUPLICATE_CURRENCY: 'Each currency needs its own Paynow integration — add it once.',
  PAY05_PROFILE_INVALID: 'Fill in the business details.',
  PAY05_MERCHANT_ALREADY_CONNECTED: 'This garage already has a Paynow account connected. Disconnect it first.',
  PAY05_INTEGRATION_ALREADY_REGISTERED: 'That Paynow integration is already connected to another account.',
  PAY05_MERCHANT_AUTHORITY_REFUSED: 'Only the garage’s administrator can do this.',
  PAY05_REVIEWER_SEPARATION_REQUIRED: 'Refused: you are connected to this garage, so another CarUp administrator must review it.',
  PAY05_VERIFICATION_AUTHORITY_REFUSED: 'Only a CarUp platform administrator can do this.',
  PAY05_VERIFICATION_EVIDENCE_INCOMPLETE: 'Not verified: confirm both reviews, and every integration key must prove itself with Paynow.',
  PAY05_MERCHANT_NOT_PENDING: 'This account has already been reviewed.',
  PAY05_HOLD_NOT_RELEASABLE: 'This payment cannot be released: it is not an unpaid Paynow request past its time.',
  PAY05_HOLD_RELEASE_REQUIRES_FRESH_UNPAID_READ: 'Paynow must show this request unpaid in a fresh check before its hold can be released.',
  PAY05_RELEASE_SELF_DEALING_REFUSED: 'Refused: you are connected to this payment, so another operator must release it.',
  PAY05_REASON_REQUIRED: 'Give a reason (at least 10 characters).',
  PAY05_REAL_PROVIDER_NOT_AUTHORIZED: 'Real Paynow is not authorised in this environment.',
}
export function pay05ErrorText(message: string): string | null {
  const code = /\bPAY05_[A-Z0-9_]+\b/.exec(message)?.[0]
  if (!code) return null
  return PAY05_ERROR_TEXT[code] ?? 'That did not go through. Nothing was changed. Try again, or contact CarUp support.'
}

export type PaynowIntegrationView = {
  id: string; currency: 'USD' | 'ZWG'; integration_id: string; methods: PaynowMethod[]; mode: 'simulator' | 'paynow_test' | 'paynow_live'
  status: 'pending_verification' | 'verified' | 'suspended' | 'rejected'; credential_fingerprint: string; registered_at: string
  verified_at: string | null; verified_by: string | null; closed_at: string | null; closed_reason: string | null
  probe: { result: string; probed_at: string } | null
}

export type PaynowMerchant = {
  id: string; tenant_id: string; gateway: 'paynow_zimbabwe'; display_name: string; merchant_reference: string; currencies: string[]
  status: 'pending_verification' | 'verified' | 'suspended' | 'rejected'; registered_by: string; registered_at: string
  suspended_at: string | null; suspended_reason: string | null
  profile: { legal_entity_name: string; registration_number: string | null; settlement_bank_name: string; settlement_account_last4: string
    settlement_account_holder: string; attested_by: string; attested_at: string } | null
  integrations: PaynowIntegrationView[]
  history: Array<{ seq: number; event_type: string; actor: string; actor_role: string; detail: Record<string, unknown>; created_at: string }>
  garage_name?: string | null
}

export type PaynowAvailability = { available: boolean; simulator_enabled: boolean; real_enabled: boolean; note: string | null; updated_at: string | null; updated_by: string | null }

export type GaragePaynowConnection = {
  enabled: boolean
  can_connect: boolean
  mode: 'simulator' | null
  availability: PaynowAvailability
  capabilities: Record<string, boolean>
  methods: PaynowMethod[]
  currencies: Array<'USD' | 'ZWG'>
  merchant: PaynowMerchant | null
  previous: Array<{ id: string; status: string; registered_at: string; suspended_reason: string | null }>
}

export type PaynowHeldCollection = {
  collection_id: string; garage: string | null; invoice_number: string | null; amount: Decimal; currency: string
  initiated_at: string; expires_at: string; stopped_at: string | null; paynow: PaynowView
}

export type PaynowProviderError = { id: string; seq: number; tenant_id: string | null; collection_id: string | null; merchant_account_id: string | null; kind: string; detail: Record<string, unknown>; created_at: string }

export const MERCHANT_STATUS_LABEL: Record<PaynowMerchant['status'], string> = {
  pending_verification: 'Waiting for CarUp to verify',
  verified: 'Verified — customers can pay through it',
  suspended: 'Suspended — not taking payments',
  rejected: 'Not verified — connect again with correct details',
}

/** The currency's name for people. ZWG is the ISO code; "ZiG" is what people say. Never "ZIG" as a code. */
export const CURRENCY_NAME: Record<string, string> = { USD: 'US dollars (USD)', ZWG: 'Zimbabwe Gold (ZiG, ISO ZWG)' }

export const PROVIDER_ERROR_LABEL: Record<string, string> = {
  callback_signature_invalid: 'A status message failed Paynow’s signature check (refused)',
  callback_binding_mismatch: 'A signed status message named another payment (refused)',
  callback_malformed: 'An unreadable status message (refused)',
  provider_unreachable: 'Paynow could not be reached',
  provider_refused: 'Paynow refused a payment request',
  provider_unauthenticated: 'A Paynow reply could not be authenticated',
  provider_url_refused: 'A Paynow reply named a web address outside Paynow (refused)',
  provider_unexpected: 'An unexpected Paynow reply',
  poll_failed: 'A status check with Paynow failed',
  trace_failed: 'A trace with Paynow failed',
  otp_rejected: 'Paynow rejected an O’mari code',
  credential_probe_failed: 'An integration key did not prove itself with Paynow',
}
