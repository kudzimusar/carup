/**
 * CARUP-PAY-03B — presentation semantics for Dealer & Business subscriptions.
 *
 * Pure functions only (no transport, no React). These encode the product rules the UI must never
 * break:
 *  - a paid catalogue plan has no approved commercial price: it is "Not yet available" or
 *    "Request a quote"; only a free tier is "Free";
 *  - a sandbox fixture is always labelled as a sandbox test plan, never as an offer, and a simulated
 *    provider is always labelled as not Stripe;
 *  - access comes from paid periods (entitlements), not from a subscription status;
 *  - amounts are minor units of the stated currency (JPY scale 0, USD scale 2, ...).
 */
import type {
  Pay03bCancellationPolicy,
  Pay03bChangePolicy,
  Pay03bPlan,
  Pay03bPlanChangeMode,
  Pay03bSubscription,
} from '@/types/pay03b'

export const PAY03B_SANDBOX_PLAN_LABEL = 'Sandbox test plan — not a commercial offer'
export const PAY03B_SIMULATED_PROVIDER_LABEL = 'Simulated provider (local test) — not Stripe'
export const PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL = 'Stripe sandbox (test mode) — no real money moves'
export const PAY03B_LISTING_CAPACITY_KEY = 'dealer.inventory.published_listing_capacity'
export const PAY03B_REDIRECT_NOTICE =
  'You will be redirected to the provider; CarUp confirms payment with the provider before granting access.'
export const PAY03B_RECONCILIATION_HOLD_TEXT =
  'A payment on this subscription is under reconciliation; paid features are suspended until it is resolved'

// ------------------------------------------------------------------------------------------ errors

const TERMS_RELOADED =
  'The plan terms changed since you opened this review. The plans have been reloaded — review the current terms before continuing.'

const ERROR_MESSAGES: Record<string, string> = {
  // dealer context and authority
  PAY03B_TENANT_CONTEXT_REQUIRED: 'Select your dealership organization first.',
  PAY03B_TENANT_MEMBERSHIP_REQUIRED: 'Your account is not a member of the selected dealership organization.',
  PAY03B_NO_LEGAL_ORGANIZATION_BOUND:
    'No active dealership organization is bound to your account, so billing is not available yet.',
  PAY03B_ORGANIZATION_AMBIGUOUS:
    'More than one dealership organization is bound to your account. Billing is paused until CarUp support resolves it.',
  PAY03B_ORGANIZATION_AUTHORITY_REFUSED: 'This dealership organization is not active, so its billing cannot change.',
  PAY03B_BILLING_AUTHORITY_REFUSED: 'Only a billing administrator of this organization can change billing.',
  PAY03B_AUTHENTICATION_REQUIRED: 'Your session has ended. Sign in again to continue.',
  // checkout
  PAY03B_SUBSCRIPTION_ALREADY_EXISTS:
    'This organization already has a subscription or an unfinished checkout. Refresh to see its current state.',
  PAY03B_TERMS_CHANGED: TERMS_RELOADED,
  PAY03B_PLAN_NOT_CURRENT: TERMS_RELOADED,
  PAY03B_PLAN_NOT_FOUND: 'This plan no longer exists. The plans have been reloaded.',
  PAY03B_PLAN_NOT_PURCHASABLE: 'This plan cannot be purchased.',
  PAY03B_PLAN_SUBSCRIBER_MISMATCH: 'This plan is not available to this type of organization.',
  PAY03B_FREE_PLAN_NEEDS_NO_PAYMENT: 'The free tier needs no subscription or payment.',
  PAY03B_PROVIDER_NOT_PERMITTED_FOR_PLAN: 'This plan cannot be paid through the provider configured here.',
  PAY03B_CHECKOUT_IDEMPOTENCY_CONFLICT: 'This review was already used for a different checkout. Close it and start again.',
  PAY03B_SANDBOX_DISABLED: 'Subscription billing is not enabled in this environment.',
  PAY03B_RETURN_ORIGIN_REQUIRED: 'Checkout is not configured in this environment.',
  PAY03B_CHECKOUT_PROVIDER_UNAVAILABLE: 'The payment provider could not start checkout. Try again later.',
  // plan changes and cancellation
  PAY03B_NO_LIVE_SUBSCRIPTION: 'There is no live subscription to change.',
  PAY03B_SUBSCRIPTION_NOT_CHANGEABLE: 'This subscription cannot be changed in its current state.',
  PAY03B_TARGET_PLAN_NOT_PURCHASABLE: 'That plan cannot be selected for a change.',
  PAY03B_UPGRADE_POLICY_REFUSED: 'Your current plan’s terms do not allow this upgrade.',
  PAY03B_DOWNGRADE_POLICY_REFUSED: 'Your current plan’s terms do not allow this downgrade.',
  PAY03B_IMMEDIATE_CANCELLATION_NOT_IN_TERMS: 'Immediate cancellation is not part of this plan’s terms.',
  PAY03B_PERIOD_END_CANCELLATION_NOT_IN_TERMS: 'Cancelling at the end of the period is not part of this plan’s terms.',
  PAY03B_CHANGE_IDEMPOTENCY_CONFLICT: 'This request was already used for a different change. Close the dialog and start again.',
  PAY03B_PLAN_CHANGE_MODE_INVALID: 'That change option is not valid.',
  PAY03B_CANCELLATION_MODE_INVALID: 'That cancellation option is not valid.',
  PAY03B_PREVIEW_PROVIDER_UNAVAILABLE: 'The provider could not preview this change. Nothing was changed.',
  PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE: 'The payment provider did not respond. Refresh before trying again.',
  // payment method and invoices
  PAY03B_PAYMENT_METHOD_UPDATE_NOT_CONFIGURED:
    'Updating the payment method is not configured for this provider in this environment.',
  PAY03B_BILLING_CUSTOMER_MISSING: 'No billing customer is on file for this organization yet.',
  PAY03B_PORTAL_PROVIDER_UNAVAILABLE: 'The provider could not open the payment-method page. Try again later.',
  PAY03B_INVOICE_NOT_FOUND: 'That invoice was not found for this organization.',
  PAY03B_INVOICE_NOT_PAYABLE: 'That invoice is not open for payment.',
  // reads and transport
  PAY03B_CATALOGUE_UNAVAILABLE: 'The plan catalogue could not be read.',
  PAY03B_READ_UNAVAILABLE: 'Billing records could not be read.',
  PAY03B_ENTITLEMENT_UNAVAILABLE: 'Access could not be evaluated.',
  PAY03B_CANONICAL_RPC_UNAVAILABLE: 'The billing authority is unavailable right now.',
  PAY03B_OPERATION_UNAVAILABLE: 'The billing service could not complete this request.',
  PAY03B_IDEMPOTENCY_KEY_REQUIRED: 'The request could not be safely identified. Close the dialog and start again.',
  PAY03B_IDEMPOTENCY_KEY_INVALID: 'The request could not be safely identified. Close the dialog and start again.',
  PAY03B_REDIRECT_URL_INVALID: 'The provider returned an address CarUp will not open.',
  // administrator
  PAY03B_ADMIN_REASON_REQUIRED: 'A reason of at least 10 characters is required.',
  PAY03B_ADMIN_ACTOR_REQUIRED: 'Your administrator session could not be identified. Sign in again.',
  PAY03B_ADMIN_AUTHORITY_REFUSED: 'Only a CarUp platform administrator can do this.',
  PAY03B_ADMIN_ACTION_INVALID: 'That administrator action is not valid.',
  PAY03B_ALREADY_SUSPENDED: 'This subscription is already suspended by an administrator.',
  PAY03B_NOT_ADMIN_SUSPENDED: 'This subscription is not under an administrator suspension.',
  PAY03B_SUBSCRIPTION_NOT_FOUND: 'Subscription not found.',
  PAY03B_INVOICE_NOT_REFUNDABLE: 'Only a fully paid invoice whose canonical payment is paid can be refunded.',
  PAY03B_REFUND_AUDIT_UNAVAILABLE: 'The refund was not attempted because its audit record could not be written.',
  PAY03B_REFUND_PROVIDER_UNAVAILABLE: 'The provider did not confirm the refund. Reconcile before trying again.',
  PAY03B_PROVIDER_GATEWAY_MISMATCH: 'The configured provider is not the one that took this payment.',
  // F5 reconciliation
  PAY03B_RECONCILIATION_EXCEPTION_NOT_FOUND: 'Reconciliation exception not found.',
  PAY03B_RECONCILIATION_EXCEPTION_NOT_OPEN: 'This exception is no longer open.',
  PAY03B_RECONCILIATION_READ_UNAVAILABLE: 'Reconciliation exceptions could not be read.',
  PAY03B_RECONCILIATION_AUDIT_UNAVAILABLE: 'Nothing was resolved because the audit record could not be written.',
  PAY03B_RESOLUTION_INVALID: 'Choose a valid resolution.',
  PAY03B_RESOLUTION_NOTE_REQUIRED: 'A resolution note of 10 to 1,000 characters is required.',
  PAY03B_RESOLUTION_AUTHORITY_REFUSED: 'Only a CarUp platform administrator can resolve this.',
  PAY03B_RESOLUTION_SELF_DEALING_REFUSED: 'You cannot resolve an exception on a payment you made yourself.',
  PAY03B_PROVIDER_VERIFICATION_STALE: 'The provider evidence was stale. Verify with the provider again, then retry.',
  PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE:
    'The provider does not show this payment as unrefunded, so access cannot be restored.',
  PAY03B_REVOKE_FINAL_REQUIRES_SETTLED_PARTIAL_REFUND:
    'The provider does not show a settled partial refund, so this cannot be finalised as revoked.',
  PAY03B_RECONCILIATION_PROVIDER_READER_MISSING: 'No provider reader exists for this payment reference.',
  PAY01A_SANDBOX_DISABLED: 'The sandbox payment operator surface is not enabled in this environment.',
  PAY01A_TEST_KEY_REQUIRED: 'The sandbox payment provider is not configured in this environment.',
  PAY01A_MERCHANT_MISMATCH: 'The sandbox payment provider is not configured in this environment.',
}

/** Codes after which the dealer page must reload the governed plans before anything else. */
export const PAY03B_RELOAD_PLAN_CODES = new Set(['PAY03B_TERMS_CHANGED', 'PAY03B_PLAN_NOT_CURRENT', 'PAY03B_PLAN_NOT_FOUND'])

export interface Pay03bErrorDescription {
  /** The backend's stable code (e.g. PAY03B_TERMS_CHANGED), when one was returned. */
  code: string | null
  status: number | null
  message: string
}

const CODE_PATTERN = /^PAY0[0-9][A-Z0-9]*_[A-Z0-9_]+$/

/** Turn any thrown value from apiRequest / pay03bApi into a code plus a human message. */
export function describePay03bError(err: unknown, fallback = 'The request could not be completed.'): Pay03bErrorDescription {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; status?: unknown; message?: unknown; data?: unknown }
  const data = (e.data && typeof e.data === 'object' ? e.data : {}) as { code?: unknown; error?: unknown }
  const code = [e.code, data.code, data.error, e.message].find(
    (candidate): candidate is string => typeof candidate === 'string' && CODE_PATTERN.test(candidate),
  ) ?? null
  const status = typeof e.status === 'number' ? e.status : null
  if (code) {
    if (ERROR_MESSAGES[code]) return { code, status, message: ERROR_MESSAGES[code] }
    if (code.endsWith('_RESPONSE_INVALID')) {
      return { code, status, message: 'The billing service returned an unexpected response.' }
    }
    return { code, status, message: fallback }
  }
  const message = typeof e.message === 'string' && e.message.trim() ? e.message : fallback
  return { code: null, status, message }
}

// ------------------------------------------------------------------------------------------ access

const ACCESS_REASONS: Record<string, string> = {
  paid_period: 'Access comes from a paid period CarUp confirmed with the provider.',
  paid_through_after_period_end_cancellation:
    'The subscription is cancelled, but the period you already paid for continues until the paid-through date.',
  approved_grace_period: 'A payment is past due. Access continues during the plan’s approved grace period.',
  approved_trial: 'Access comes from the plan’s approved trial period.',
  no_subscription: 'This organization has no subscription.',
  no_paid_period: 'No paid period has been confirmed yet.',
  paid_period_ended: 'The last paid period has ended.',
  past_due_without_approved_grace:
    'A payment is past due and this plan has no approved grace period, so paid features are paused.',
  payment_reconciliation_hold: `${PAY03B_RECONCILIATION_HOLD_TEXT}.`,
  admin_suspension: 'A CarUp administrator suspended this subscription; paid features are suspended.',
  unauthorized_provider_trial:
    'The provider reported a trial this plan does not include, so paid features are suspended until CarUp resolves it.',
  provider_unpaid: 'The provider reports the subscription as unpaid, so paid features are suspended.',
  suspended: 'The subscription is suspended.',
  cancelled_immediately: 'The subscription was cancelled immediately; paid access ended at cancellation.',
  status_incomplete: 'Checkout has not been completed and confirmed yet.',
  status_incomplete_expired: 'The checkout expired before a payment was completed.',
  status_expired: 'The subscription has expired.',
  status_paused: 'The subscription is paused.',
  not_current: 'This is not the organization’s current subscription.',
}

export function describePay03bAccessReason(reason: string | null | undefined): string {
  if (!reason) return 'No access decision was returned.'
  return ACCESS_REASONS[reason] ?? `Access decision: ${humanizePay03bToken(reason)}.`
}

// ------------------------------------------------------------------------------------------ labels

export function humanizePay03bToken(value: string | null | undefined): string {
  if (!value) return '—'
  const text = value.replace(/_/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const SUBSCRIPTION_STATUS: Record<string, string> = {
  incomplete: 'Checkout not completed',
  incomplete_expired: 'Checkout expired',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  grace_period: 'Grace period',
  paused: 'Paused',
  cancelled: 'Cancelled',
  expired: 'Expired',
  suspended: 'Suspended',
}

export function describePay03bSubscriptionStatus(status: string | null | undefined): string {
  if (!status) return 'No subscription'
  return SUBSCRIPTION_STATUS[status] ?? humanizePay03bToken(status)
}

const INVOICE_STATUS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open — awaiting payment',
  paid: 'Paid at provider',
  uncollectible: 'Uncollectible',
  void: 'Void',
}

export function describePay03bInvoiceStatus(status: string | null | undefined): string {
  return status ? INVOICE_STATUS[status] ?? humanizePay03bToken(status) : '—'
}

const PAYMENT_STATUS: Record<string, string> = {
  paid: 'Payment confirmed',
  refunded: 'Refunded',
  refund_pending: 'Refund pending',
  reconciliation_hold: 'Under reconciliation',
  failed: 'Failed',
  pending: 'Pending',
}

/** Status of the CANONICAL payment row (public.payment_transactions), not the provider invoice. */
export function describePay03bPaymentStatus(status: string | null | undefined): string {
  if (!status) return 'No payment recorded'
  return PAYMENT_STATUS[status] ?? humanizePay03bToken(status)
}

const BILLING_REASON: Record<string, string> = {
  subscription_create: 'First period',
  subscription_cycle: 'Renewal',
  subscription_update: 'Plan change (prorated)',
  manual: 'Manual invoice',
}

export function describePay03bBillingReason(reason: string | null | undefined): string {
  return reason ? BILLING_REASON[reason] ?? humanizePay03bToken(reason) : '—'
}

export type Pay03bCommercialKind = 'free' | 'not_available' | 'request_quote' | 'sandbox'

/**
 * Fail-closed commercial classification. Anything that is not explicitly free, a quotation or a
 * labelled sandbox fixture is "not yet available" — an unknown kind is never presented as purchasable.
 */
export function pay03bCommercialKind(plan: { pricingKind?: string | null; commercialStatus?: string | null }): Pay03bCommercialKind {
  if (plan.pricingKind === 'sandbox_fixture' || plan.commercialStatus === 'sandbox_test_only_not_a_commercial_offer') {
    return 'sandbox'
  }
  if (plan.pricingKind === 'free') return 'free'
  if (plan.pricingKind === 'contract_quotation' || plan.commercialStatus === 'request_quote') return 'request_quote'
  return 'not_available'
}

export function pay03bCommercialLabel(kind: Pay03bCommercialKind): string {
  switch (kind) {
    case 'free':
      return 'Free'
    case 'request_quote':
      return 'Request a quote'
    case 'sandbox':
      return PAY03B_SANDBOX_PLAN_LABEL
    default:
      return 'Not yet available'
  }
}

export function pay03bProviderLabel(input: { simulated?: boolean | null; gateway?: string | null }): string {
  if (input.simulated || input.gateway === 'pay03b_local_provider_simulator') return PAY03B_SIMULATED_PROVIDER_LABEL
  return PAY03B_STRIPE_SANDBOX_PROVIDER_LABEL
}

// ------------------------------------------------------------------------------------------ money & time

/** ISO 4217 minor-unit scale; an explicit governed scale wins. */
export function pay03bCurrencyScale(currency: string, explicitScale?: number | null): number {
  if (typeof explicitScale === 'number' && Number.isInteger(explicitScale) && explicitScale >= 0 && explicitScale <= 3) {
    return explicitScale
  }
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
    return typeof digits === 'number' ? digits : 2
  } catch {
    return 2
  }
}

/** Format an amount in MINOR units, e.g. (3000, 'JPY') → "¥3,000"; (1999, 'USD') → "$19.99". */
export function formatPay03bMinor(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
  scale?: number | null,
): string | null {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor) || !currency) return null
  const code = currency.trim().toUpperCase()
  const digits = pay03bCurrencyScale(code, scale)
  const major = amountMinor / 10 ** digits
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major)
  } catch {
    return `${code} ${major.toFixed(digits)}`
  }
}

export function formatPay03bInterval(interval: string | null | undefined, count: number | null | undefined): string | null {
  if (!interval) return null
  const n = typeof count === 'number' && Number.isInteger(count) && count > 1 ? count : 1
  return n === 1 ? `per ${interval}` : `every ${n} ${interval}s`
}

export function formatPay03bDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

// ------------------------------------------------------------------------------------------ terms

const REFUND_POLICIES: Record<string, string> = {
  governed_admin_refund:
    'Refunds are not self-service. A refund is issued only by a CarUp administrator, as a governed and audited full refund of a specific invoice payment.',
  cancel_at_period_end:
    'Cancelling stops renewal at the end of the paid period. No other refund terms are defined for this plan.',
  cancel_at_period_end_or_governed_admin_refund:
    'Cancelling stops renewal at the end of the paid period. Any refund is issued only by a CarUp administrator, as a governed and audited refund.',
  no_charge_tier: 'Nothing is charged for this tier, so there is nothing to refund.',
  pro_rata_or_period_end_cancellation_pending_terms: 'Refund terms are not yet approved.',
  enterprise_msa_terms: 'Refunds follow the signed enterprise agreement.',
}

export function describePay03bRefundPolicy(code: string | null | undefined): string {
  if (!code) return 'No refund terms are recorded for this plan.'
  return REFUND_POLICIES[code] ?? `Refund terms: ${humanizePay03bToken(code)}.`
}

export function describePay03bCancellationPolicy(policy: Pay03bCancellationPolicy | null | undefined): string[] {
  if (!policy) return ['Cancellation terms are not recorded for this plan.']
  return [
    policy.period_end
      ? 'You can cancel at the end of a paid period: renewal stops and access continues until the paid-through date.'
      : 'Cancelling at the end of a period is not offered under these terms.',
    policy.immediate
      ? 'You can cancel immediately: access to paid features ends at once.'
      : 'Immediate cancellation is not offered under these terms.',
  ]
}

export function describePay03bChangePolicy(policy: Pay03bChangePolicy | null | undefined): string[] {
  if (!policy) return ['Plan-change terms are not recorded for this plan.']
  const upgrade = policy.upgrade === 'immediate_prorated'
    ? 'Upgrades can take effect immediately; the provider invoices the prorated difference.'
    : policy.upgrade === 'period_end'
      ? 'Upgrades take effect from the next billing period.'
      : 'Upgrades are not offered from this plan.'
  const downgrade = policy.downgrade === 'period_end'
    ? 'Downgrades take effect from the next billing period.'
    : 'Downgrades are not offered from this plan.'
  return [upgrade, downgrade]
}

/** Plan-change modes the CURRENT plan's governed change policy allows for this target (mirrors the database). */
export function pay03bAllowedChangeModes(
  current: Pick<Pay03bPlan, 'tierRank' | 'changePolicy'> | null | undefined,
  target: Pick<Pay03bPlan, 'tierRank'>,
): Pay03bPlanChangeMode[] {
  const policy = current?.changePolicy
  if (!current || !policy) return []
  if (target.tierRank > current.tierRank) {
    if (policy.upgrade === 'immediate_prorated') return ['period_end', 'immediate']
    return policy.upgrade === 'period_end' ? ['period_end'] : []
  }
  return policy.downgrade === 'period_end' ? ['period_end'] : []
}

// ------------------------------------------------------------------------------------------ lifecycle

const TERMINAL_STATUSES = new Set(['incomplete_expired', 'cancelled', 'expired'])

/** A live agreement blocks a new checkout (one live subscription per organization and scope). */
export function isPay03bSubscriptionLive(sub: Pick<Pay03bSubscription, 'status'> | null | undefined): boolean {
  return Boolean(sub) && !TERMINAL_STATUSES.has(String(sub?.status))
}

/** Change / cancel / resume need a provider-backed live subscription past checkout. */
export function isPay03bSubscriptionChangeable(
  sub: Pick<Pay03bSubscription, 'status' | 'providerSubscriptionId'> | null | undefined,
): boolean {
  return isPay03bSubscriptionLive(sub) && sub?.status !== 'incomplete' && Boolean(sub?.providerSubscriptionId)
}

export function describePay03bEntitlementKey(key: string, value: unknown): string {
  if (key === PAY03B_LISTING_CAPACITY_KEY && typeof value === 'number') return `Published listings: up to ${value}`
  const label = humanizePay03bToken(key.split('.').pop() || key)
  if (typeof value === 'boolean') return `${label}: ${value ? 'included' : 'not included'}`
  if (typeof value === 'number' || typeof value === 'string') return `${label}: ${value}`
  return label
}
