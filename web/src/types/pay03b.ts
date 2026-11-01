/**
 * CARUP-PAY-03B — Dealer & Business subscription contract, as projected by
 * backend/services/payment/pay03bSubscriptionService.js and pay03bReconciliationService.js.
 *
 * Money is always in MINOR units of the stated currency. A paid catalogue plan has NO approved
 * commercial price: the public projection always carries `amountMinor: null` / `currency: null`, and
 * only a `sandbox_fixture` plan (visible to an authenticated dealer in a sandbox runtime) carries a
 * fixture amount — which is a test value, never a commercial offer.
 */

export type Pay03bPricingKind = 'free' | 'approved_tariff' | 'sandbox_fixture' | 'contract_quotation' | 'unpriced'

export type Pay03bCommercialStatus =
  | 'free'
  | 'not_available'
  | 'request_quote'
  | 'sandbox_test_only_not_a_commercial_offer'

export type Pay03bActivationStatus = 'draft' | 'commercially_blocked' | 'sandbox_only' | 'approved' | 'retired'

export type Pay03bPlanChangeMode = 'period_end' | 'immediate'

export type Pay03bCancelMode = 'period_end' | 'immediate' | 'resume'

export type Pay03bProviderMode = 'local_simulator' | 'stripe_sandbox'

// ------------------------------------------------------------------------------------------ public

export interface Pay03bPublicPlan {
  planCode: string
  displayName: string
  pricingKind: Pay03bPricingKind | string
  commercialStatus: Pay03bCommercialStatus | string
  billingInterval: string | null
  blockerClass: string | null
  blockerReason: string | null
  amountMinor: null
  currency: null
}

export interface Pay03bPublicProduct {
  productCode: string
  title: string
  plans: Pay03bPublicPlan[]
}

export interface Pay03bPublicCatalogue {
  products: Pay03bPublicProduct[]
  pricingAuthority: string
}

// ------------------------------------------------------------------------------------------ plans

export interface Pay03bChangePolicy {
  upgrade: 'period_end' | 'immediate_prorated' | 'not_allowed' | string
  downgrade: 'period_end' | 'not_allowed' | string
  proration: 'none' | 'always_invoice' | string
}

export interface Pay03bCancellationPolicy {
  period_end: boolean
  immediate: boolean
}

export interface Pay03bPlan {
  id: string
  planCode: string
  planVersion: number
  productCode?: string
  displayName: string
  subscriptionScope?: string
  tierRank: number
  pricingKind: Pay03bPricingKind | string
  activationStatus: Pay03bActivationStatus | string
  commercialStatus: Pay03bCommercialStatus | string
  amountMinor: number | null
  currency: string | null
  currencyScale: number | null
  billingInterval: string | null
  intervalCount: number | null
  jurisdiction?: string | null
  merchantOfRecord?: string | null
  providerAllowlist?: string[]
  entitlements: Record<string, unknown>
  trialDays: number | null
  graceDays: number | null
  changePolicy: Pay03bChangePolicy | null
  cancellationPolicy: Pay03bCancellationPolicy | null
  refundPolicy: string | null
  blockerClass: string | null
  blockerReason: string | null
  approvalEvidenceRef?: string | null
  approvedBy?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  simulated: boolean
  purchasable: boolean
}

// ------------------------------------------------------------------------------------------ subscription

export interface Pay03bSubscription {
  id: string
  subscriptionReference?: string
  ownerTenantId?: string
  ownerOrganizationId?: string
  status: string
  providerStatus: string | null
  gateway: string
  simulated: boolean
  planId: string
  planCode: string | null
  paidPlanId?: string | null
  paidPlanCode: string | null
  scheduledPlanChange: boolean
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  paidThrough: string | null
  graceUntil: string | null
  cancelAtPeriodEnd: boolean
  cancellationMode: string | null
  canceledAt: string | null
  endedAt: string | null
  suspendedReason: string | null
  providerSubscriptionId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface Pay03bEntitlements {
  access: boolean
  reason: string
  status: string | null
  planCode: string | null
  paidThrough: string | null
  graceUntil: string | null
  baselineEntitlements: Record<string, unknown>
  subscriptionEntitlements: Record<string, unknown>
  effective: Record<string, number | null>
}

export interface Pay03bInvoice {
  id: string
  providerInvoiceId: string
  billingReason: string
  periodStart: string
  periodEnd: string
  currency: string
  amountDueMinor: number
  amountPaidMinor: number
  providerStatus: string
  anomaly: string | null
  attemptCount: number
  paymentReference: string | null
  paymentStatus: string | null
  paymentRefundId?: string | null
}

export interface Pay03bOrganization {
  id: string
  name: string
  type: string
  status: string
}

export interface Pay03bDealerOverview {
  organization: Pay03bOrganization
  tenantRole: string
  billingAuthority: boolean
  plans: Pay03bPlan[]
  subscription: Pay03bSubscription | null
  history: Pay03bSubscription[]
  entitlements: Pay03bEntitlements
  invoices: Pay03bInvoice[]
  enforcementActive: boolean
  providerMode: Pay03bProviderMode | string
  sourceOfTruth: string
}

// ------------------------------------------------------------------------------------------ dealer actions

/** Exactly the governed plan-version terms the dealer reviewed; the backend only compares them. */
export interface Pay03bAcknowledgedTerms {
  planVersion: number
  amountMinor: number
  currency: string
  billingInterval: string
  intervalCount: number
}

export interface Pay03bCheckoutRequest {
  planId: string
  acknowledgedTerms: Pay03bAcknowledgedTerms
}

export interface Pay03bCheckoutResponse {
  subscriptionId: string
  checkoutId: string
  checkoutUrl: string | null
  checkoutStatus: string
  idempotentReplay: boolean
  /** True when an unfinished checkout for the same plan was resumed instead of creating a new one. */
  resumed?: boolean
  gateway: string
  simulated: boolean
  amountMinor: number
  currency: string
  live: false
}

export interface Pay03bChangePreviewLine {
  amountMinor: number
  proration: boolean
  priceRef?: string | null
  periodStart: string | null
  periodEnd: string | null
}

export interface Pay03bChangePreview {
  mode: Pay03bPlanChangeMode
  targetPlanCode: string
  chargeNowMinor: number
  currency: string
  /** ISO timestamp for period_end changes, or the literal 'on_successful_payment' for immediate ones. */
  effectiveFrom: string
  lines: Pay03bChangePreviewLine[]
  providerBacked: boolean
  simulated: boolean
}

export interface Pay03bChangeRequest {
  targetPlanId: string
  mode: Pay03bPlanChangeMode
}

export interface Pay03bCancelRequest {
  mode: Pay03bCancelMode
  reason?: string | null
}

export interface Pay03bChangeResult {
  requestId: string
  status: string
  replay?: boolean
  overview: Pay03bDealerOverview
}

export interface Pay03bRedirect {
  url: string
}

// ------------------------------------------------------------------------------------------ administrator

export interface Pay03bAdminCatalogue {
  plans: Pay03bPlan[]
  sourceOfTruth: string
}

export interface Pay03bAdminSubscriptionRow extends Pay03bSubscription {
  organizationName: string | null
  access: boolean
  accessReason: string
}

export interface Pay03bAdminSubscriptionList {
  subscriptions: Pay03bAdminSubscriptionRow[]
  sourceOfTruth: string
}

/** Raw append-only lifecycle row (public.pay03b_subscription_transitions). */
export interface Pay03bTransitionRow {
  id: number | string
  subscription_id: string
  from_status: string | null
  to_status: string
  from_plan_id: string | null
  to_plan_id: string | null
  paid_through: string | null
  cause: string
  actor_id: string | null
  event_id: string | null
  recorded_at: string
}

/** Raw attributable change-request row (public.pay03b_subscription_change_requests). */
export interface Pay03bChangeRequestRow {
  id: string
  subscription_id: string
  change_type: string
  target_plan_id: string | null
  invoice_id: string | null
  requested_by: string
  requested_role: string
  request_key: string
  reason: string | null
  status: string
  outcome_code: string | null
  requested_at: string
  completed_at: string | null
}

export interface Pay03bAdminSubscriptionDetail {
  subscription: Pay03bSubscription
  invoices: Pay03bInvoice[]
  transitions: Pay03bTransitionRow[]
  changeRequests: Pay03bChangeRequestRow[]
  entitlements: Pay03bEntitlements
  sourceOfTruth: string
  /** Present on a reconcile response: what the fresh provider read did. */
  result?: { state: string; duplicateEvent?: boolean; invoicesSynced?: number }
}

export type Pay03bSuspensionAction = 'suspend' | 'resume'

// ------------------------------------------------------------------------------------------ F5 reconciliation

export type Pay03bExceptionStatusFilter = 'open' | 'resolved' | 'superseded' | 'all'

export type Pay03bResolution = 'restore_access_provider_unrefunded' | 'revoke_access_partial_refund_final'

export interface Pay03bReconciliationException {
  id: string
  paymentReference: string
  exceptionType?: string
  status: string
  severity: string
  gateway?: string
  providerPaymentIntentId?: string | null
  paymentAmountMinor: number
  currency: string
  priorPaymentStatus?: string | null
  mismatch: string | null
  detectedRefundedMinor: number
  detectedPendingRefundMinor: number
  detectedRefundIds: string[]
  detectedVia: string
  detectionEventType?: string | null
  firstDetectedAt: string
  observationCount: number
  lastObservedStatus: string | null
  lastObservedRefundedMinor: number | null
  lastObservedPendingRefundMinor?: number | null
  lastObservedVia?: string | null
  lastObservedAt?: string | null
  acknowledgedBy: string | null
  acknowledgedAt: string | null
  resolution: string | null
  resolvedBy: string | null
  resolutionNote: string | null
  resolvedAt: string | null
}

export interface Pay03bReconciliationExceptionList {
  exceptions: Pay03bReconciliationException[]
  openCount: number
  sourceOfFinancialTruth: string
}

export interface Pay03bProviderTruth {
  reference?: string
  status: string
  intentId?: string | null
  refundedMinor: number
  pendingRefundMinor: number
  refundIds: string[]
  mismatch?: string | null
  verifiedAt: string
}

export interface Pay03bReconciliationExceptionDetail {
  exception: Pay03bReconciliationException
  providerTruth: Pay03bProviderTruth | null
  sourceOfFinancialTruth?: string
}

export interface Pay03bResolveRequest {
  resolution: Pay03bResolution
  note: string
}

export interface Pay03bResolveResult {
  exception: Pay03bReconciliationException
  paymentStatus: string
  entitlementStatus: string | null
  providerTruth: Pay03bProviderTruth
  sourceOfFinancialTruth: string
}
