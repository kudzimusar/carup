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
import { PROVIDER_STATE_TONE, pay04ErrorText, type CollectionOutcome, type ProviderPayment, type ProviderPaymentState } from './pay04GaragePayments'

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

/** What Paynow reported, in words: said alongside CarUp's own state, never instead of it. */
export const PAYNOW_REPORTED: Record<PaynowStatus, string> = {
  created: 'Paynow reports it waiting for payment',
  sent: 'Paynow reports it waiting for approval on the phone',
  awaiting_delivery: 'Paynow reports it paid into Paynow and held by Paynow',
  delivered: 'Paynow reports it paid into Paynow and held until Paynow releases it',
  paid: 'Paynow reports it paid',
  cancelled: 'Paynow reports it cancelled',
  failed: 'Paynow reports it not completed',
  disputed: 'Paynow reports it disputed',
  refunded: 'Paynow reports it refunded',
  unrecognized: 'Paynow reported a status CarUp does not recognise',
}

const WAITING_TONE = 'bg-amber-50 text-amber-900 border-amber-300'
const REVIEW_STATES: ReadonlySet<string> = new Set(['under_review', 'confirmed_unallocated'])

/**
 * The badge of a Paynow payment. provider_status is only what CarUp APPLIED; the collection state is the truth. So the
 * tone and the word come from the state: green and "Paid" only when the state is confirmed (counted), "Under review — not
 * counted" for review, and a Paynow word otherwise — a paid status CarUp did not count is never called paid.
 */
export function paynowStateBadge(state: string | null | undefined, status: PaynowStatus | null): { label: string; tone: string } {
  if (state === 'confirmed') return { label: 'Paid — counted on the invoice', tone: PROVIDER_STATE_TONE.confirmed }
  if (state && REVIEW_STATES.has(state)) return { label: 'Under review — not counted', tone: PROVIDER_STATE_TONE.under_review }
  const tone = state && state in PROVIDER_STATE_TONE ? PROVIDER_STATE_TONE[state as ProviderPaymentState] : WAITING_TONE
  if (status === 'paid') return { label: 'Paynow reports it paid — not counted yet', tone }
  return { label: status ? PAYNOW_STATUS_SHORT[status] : 'Waiting for Paynow', tone }
}

/** The sentence about a Paynow payment, by the same rule: under review says so first, then what Paynow reported. */
export function paynowStatusLine(state: string | null | undefined, view: PaynowView): string {
  const status = view.provider_status
  if (state && REVIEW_STATES.has(state)) return `Under review — not counted.${status ? ` ${PAYNOW_REPORTED[status]}.` : ''}`
  if (status === 'paid' && state !== 'confirmed') return 'Paynow reports it paid, but CarUp has not counted it yet.'
  return view.provider_status_label
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

/**
 * A Paynow request the customer can still continue (its page link, an InnBucks code, an O'mari code): CarUp is still
 * waiting on it, Paynow has neither refused it nor lost it, and its hold was not released. `needs_otp` is trusted as
 * the server sends it — it may be true while the status is still "created" or "sent".
 */
export function paynowContinuable(state: string | null | undefined, view: PaynowView | null | undefined): view is PaynowView {
  if (!view || view.hold_released) return false
  if (state && state !== 'awaiting_provider') return false
  if (view.initiation === 'refused' || view.initiation === 'traced_absent') return false
  return view.needs_otp || view.provider_status === null || view.provider_status === 'created' || view.provider_status === 'sent'
}

/** A failed PAY-05 or PAY-04 call in words (the message itself when it carries no code). */
export function paynowErrorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : ''
  return (message && (pay05ErrorText(message) ?? pay04ErrorText(message))) || fallback
}

/** Said when CarUp cannot be reached, or cannot say, whether a payment request went out: it may exist, so look first. */
export const PAYNOW_START_UNREACHABLE =
  'We could not reach CarUp. Your payment request may still have been sent — check this invoice’s payments below before trying again.'
export const PAYNOW_START_UNCONFIRMED =
  'CarUp could not confirm your payment request. It may still have been sent — check this invoice’s payments below before trying again.'

const httpStatusOf = (err: unknown) => {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/** The browser never got an answer: fetch rejects with a TypeError ("Failed to fetch", "Load failed", "NetworkError…"). */
export function isNetworkFailure(err: unknown): boolean {
  if (httpStatusOf(err) !== null) return false
  if (err instanceof TypeError) return true
  return /failed to fetch|networkerror|network request failed|load failed/i.test(err instanceof Error ? err.message : '')
}

/**
 * Why starting a Paynow payment failed, in words, and whether the refusal was DEFINITE. Only a definite 4xx refusal
 * (refused before anything was sent) makes the next try a new request with a new idempotency key. After a network error,
 * any 5xx or a 502 PAY05_PROVIDER_* the request may exist, so the retry must reuse the key: the server then replays the
 * request it has instead of creating a second one.
 */
export function paynowStartFailure(err: unknown): { text: string; definite: boolean } {
  if (isNetworkFailure(err)) return { text: PAYNOW_START_UNREACHABLE, definite: false }
  const status = httpStatusOf(err)
  const definite = status !== null && status >= 400 && status < 500
  const message = err instanceof Error ? err.message : ''
  const coded = message ? pay05ErrorText(message) ?? (/\bPAY04_[A-Z0-9_]+\b/.test(message) ? pay04ErrorText(message) : null) : null
  if (coded) return { text: coded, definite }
  if (definite) return { text: 'The payment could not be started. Nothing was charged.', definite }
  if (status !== null) return { text: PAYNOW_START_UNCONFIRMED, definite: false }
  return { text: message || PAYNOW_START_UNCONFIRMED, definite: false }
}

/** PAY-05 is switched off on this server (404 PAY05_DISABLED): a fact to state neutrally, not an error to alarm about. */
export function isPay05Disabled(err: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code === 'PAY05_DISABLED') return true
  return /\bPAY05_DISABLED\b/.test(err instanceof Error ? err.message : '')
}
export const PAY05_NOT_OFFERED = 'Paynow payments are not offered yet.'

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
  PAY05_INTEGRATION_ID_INVALID: 'The integration ID is 1 to 12 digits (from “Receive Payment Links” in Paynow).',
  PAY05_METHODS_INVALID: 'Tick at least one payment method your Paynow integration is set up for.',
  PAY05_REGISTRATION_NUMBER_INVALID: 'Use 2 to 40 letters, numbers, spaces or / . - for the company registration number, or leave it empty.',
  PAY05_GARAGE_REQUIRED: 'CarUp could not tell which garage you are connecting. Open this page from your garage’s workspace and try again.',
  PAY05_INTEGRATION_KEY_INVALID: 'Paste the integration key exactly as Paynow e-mailed it.',
  PAY05_INTEGRATIONS_INVALID: 'Add one integration for each currency you take (US dollars and/or ZiG).',
  PAY05_DUPLICATE_CURRENCY: 'Each currency needs its own Paynow integration — add it once.',
  PAY05_PROFILE_INVALID: 'Fill in the business details: the name customers see (at most 120 characters), the registered business name, the settlement bank (at most 80 characters) and the account holder.',
  PAY05_MERCHANT_ALREADY_CONNECTED: 'This garage already has a Paynow account connected. Disconnect it first.',
  PAY05_INTEGRATION_ALREADY_REGISTERED: 'That Paynow integration is already connected to another account.',
  PAY05_MERCHANT_AUTHORITY_REFUSED: 'Only the garage’s administrator can do this.',
  PAY05_REVIEWER_SEPARATION_REQUIRED: 'Refused: you are connected to this garage, so another CarUp administrator must review it.',
  PAY05_VERIFICATION_AUTHORITY_REFUSED: 'Only a CarUp platform administrator can do this.',
  PAY05_VERIFICATION_EVIDENCE_INCOMPLETE: 'Not verified: confirm all three reviews (legal identity, settlement account, each integration’s currency) and write a note; every integration key must also prove itself with Paynow.',
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
  /** why CarUp did not verify it (status rejected) */
  rejected_reason?: string | null; rejected_at?: string | null
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
