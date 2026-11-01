/**
 * CARUP-PAY-03B — Dealer & Business subscription API client.
 *
 * Same conventions as verificationAdminApi: every call goes through `apiRequest`, which sends the
 * caller's identity headers (x-session-token / x-user-id / x-stakeholder-role / x-tenant-id) and, for
 * unsafe methods, a CSRF token bound to that same identity. Nothing here decides money, price or
 * access: the backend and the database are authoritative, and this module only transports.
 *
 * Safety rules encoded here:
 *  - Writes that the backend makes idempotent carry an `Idempotency-Key` header supplied by the caller.
 *    The caller generates ONE key per reviewed intent (createPay03bIdempotencyKey) and reuses it on a
 *    retry; this module never retries a POST by itself.
 *  - A response that does not have the documented shape is an ERROR (Pay03bResponseError), never an
 *    empty list: a failed or malformed read must not be rendered as "nothing exists".
 *
 * Only `apiRequest` is imported at runtime from ./apiClient (tests that mock that module provide it).
 */
import { apiRequest, type AuthHeaders } from './apiClient'
import type {
  Pay03bAdminCatalogue,
  Pay03bAdminSubscriptionDetail,
  Pay03bAdminSubscriptionList,
  Pay03bCancelRequest,
  Pay03bChangePreview,
  Pay03bChangeRequest,
  Pay03bChangeResult,
  Pay03bCheckoutRequest,
  Pay03bCheckoutResponse,
  Pay03bDealerOverview,
  Pay03bExceptionStatusFilter,
  Pay03bPlanChangeMode,
  Pay03bPublicCatalogue,
  Pay03bReconciliationExceptionDetail,
  Pay03bReconciliationExceptionList,
  Pay03bRedirect,
  Pay03bResolveRequest,
  Pay03bResolveResult,
  Pay03bSuspensionAction,
} from '@/types/pay03b'

export interface Pay03bClientConfig {
  baseUrl: string
  authHeaders: AuthHeaders
  fetchImpl?: typeof fetch
}

/** Backend contract: /^[A-Za-z0-9_-]{16,96}$/ (pay03bSubscriptionService.validateRequestKey). */
export const PAY03B_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,96}$/

/** Thrown when a 2xx response does not carry the documented shape. */
export class Pay03bResponseError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'Pay03bResponseError'
    this.code = code
  }
}

function randomHex(bytes: number): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes)
    cryptoObj.getRandomValues(buffer)
    return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID().replace(/-/g, '').slice(0, bytes * 2).padEnd(bytes * 2, '0')
  }
  // Last resort (no Web Crypto): uniqueness, not secrecy, is what an idempotency key needs.
  let out = ''
  while (out.length < bytes * 2) out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return out.slice(0, bytes * 2)
}

/**
 * A fresh idempotency key: `pay03b_` + 32 hex characters (39 chars). Generate it once per reviewed
 * intent (e.g. when a terms-review dialog opens) and reuse it for every retry of that intent.
 */
export function createPay03bIdempotencyKey(): string {
  return `pay03b_${randomHex(16)}`
}

function idempotencyHeader(key: string): Record<string, string> {
  if (typeof key !== 'string' || !PAY03B_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Pay03bResponseError('PAY03B_IDEMPOTENCY_KEY_INVALID')
  }
  return { 'Idempotency-Key': key }
}

function read<T>(config: Pay03bClientConfig, path: string): Promise<T> {
  return apiRequest<T>({
    baseUrl: config.baseUrl,
    path,
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
}

function write<T>(
  config: Pay03bClientConfig,
  path: string,
  body: Record<string, unknown> = {},
  headers?: Record<string, string>,
): Promise<T> {
  return apiRequest<T>({
    baseUrl: config.baseUrl,
    path,
    options: { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) },
    authHeaders: config.authHeaders,
    fetchImpl: config.fetchImpl,
  })
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function requireShape<T>(value: unknown, valid: boolean, code: string): T {
  if (!valid) throw new Pay03bResponseError(code)
  return value as T
}

function isOverview(value: unknown): value is Pay03bDealerOverview {
  return isObject(value) && isObject(value.organization) && Array.isArray(value.plans)
    && Array.isArray(value.invoices) && Array.isArray(value.history) && isObject(value.entitlements)
    && typeof value.billingAuthority === 'boolean' && 'subscription' in value
}

const enc = encodeURIComponent

// ------------------------------------------------------------------------------------------ public

export async function fetchPay03bCatalogue(config: Pay03bClientConfig): Promise<Pay03bPublicCatalogue> {
  const res = await read<unknown>(config, '/pay03b/catalogue')
  return requireShape<Pay03bPublicCatalogue>(res, isObject(res) && Array.isArray(res.products)
    && res.products.every((p) => isObject(p) && Array.isArray(p.plans)), 'PAY03B_CATALOGUE_RESPONSE_INVALID')
}

// ------------------------------------------------------------------------------------------ dealer

export async function fetchPay03bDealerOverview(config: Pay03bClientConfig): Promise<Pay03bDealerOverview> {
  const res = await read<unknown>(config, '/pay03b/dealer/subscription')
  return requireShape<Pay03bDealerOverview>(res, isOverview(res), 'PAY03B_OVERVIEW_RESPONSE_INVALID')
}

/** Re-reads the provider into the canonical authority, then returns the overview. Not payment proof by itself. */
export async function verifyPay03bDealerSubscription(config: Pay03bClientConfig): Promise<Pay03bDealerOverview> {
  const res = await write<unknown>(config, '/pay03b/dealer/subscription/verify')
  return requireShape<Pay03bDealerOverview>(res, isOverview(res), 'PAY03B_OVERVIEW_RESPONSE_INVALID')
}

export async function createPay03bDealerCheckout(
  config: Pay03bClientConfig,
  body: Pay03bCheckoutRequest,
  idempotencyKey: string,
): Promise<Pay03bCheckoutResponse> {
  const res = await write<unknown>(
    config,
    '/pay03b/dealer/subscription/checkout',
    { planId: body.planId, acknowledgedTerms: { ...body.acknowledgedTerms } },
    idempotencyHeader(idempotencyKey),
  )
  return requireShape<Pay03bCheckoutResponse>(res, isObject(res) && typeof res.subscriptionId === 'string'
    && typeof res.checkoutStatus === 'string', 'PAY03B_CHECKOUT_RESPONSE_INVALID')
}

export async function previewPay03bPlanChange(
  config: Pay03bClientConfig,
  targetPlanId: string,
  mode: Pay03bPlanChangeMode,
): Promise<Pay03bChangePreview> {
  const query = new URLSearchParams({ targetPlanId, mode }).toString()
  const res = await read<unknown>(config, `/pay03b/dealer/subscription/change-preview?${query}`)
  return requireShape<Pay03bChangePreview>(res, isObject(res) && typeof res.chargeNowMinor === 'number'
    && typeof res.currency === 'string' && Array.isArray(res.lines), 'PAY03B_CHANGE_PREVIEW_RESPONSE_INVALID')
}

function isChangeResult(value: unknown): value is Pay03bChangeResult {
  return isObject(value) && typeof value.requestId === 'string' && typeof value.status === 'string'
    && isOverview(value.overview)
}

export async function changePay03bDealerPlan(
  config: Pay03bClientConfig,
  body: Pay03bChangeRequest,
  idempotencyKey: string,
): Promise<Pay03bChangeResult> {
  const res = await write<unknown>(config, '/pay03b/dealer/subscription/change',
    { targetPlanId: body.targetPlanId, mode: body.mode }, idempotencyHeader(idempotencyKey))
  return requireShape<Pay03bChangeResult>(res, isChangeResult(res), 'PAY03B_CHANGE_RESPONSE_INVALID')
}

export async function cancelPay03bDealerSubscription(
  config: Pay03bClientConfig,
  body: Pay03bCancelRequest,
  idempotencyKey: string,
): Promise<Pay03bChangeResult> {
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined
  const res = await write<unknown>(config, '/pay03b/dealer/subscription/cancel',
    { mode: body.mode, ...(reason ? { reason } : {}) }, idempotencyHeader(idempotencyKey))
  return requireShape<Pay03bChangeResult>(res, isChangeResult(res), 'PAY03B_CANCEL_RESPONSE_INVALID')
}

function isRedirect(value: unknown): value is Pay03bRedirect {
  return isObject(value) && typeof value.url === 'string' && value.url.length > 0
}

export async function createPay03bPaymentMethodUpdate(config: Pay03bClientConfig): Promise<Pay03bRedirect> {
  const res = await write<unknown>(config, '/pay03b/dealer/subscription/payment-method')
  return requireShape<Pay03bRedirect>(res, isRedirect(res), 'PAY03B_REDIRECT_RESPONSE_INVALID')
}

export async function getPay03bInvoicePaymentLink(config: Pay03bClientConfig, invoiceId: string): Promise<Pay03bRedirect> {
  const res = await write<unknown>(config, `/pay03b/dealer/subscription/invoices/${enc(invoiceId)}/pay`)
  return requireShape<Pay03bRedirect>(res, isRedirect(res), 'PAY03B_REDIRECT_RESPONSE_INVALID')
}

// ------------------------------------------------------------------------------------------ administrator

export async function fetchPay03bAdminCatalogue(config: Pay03bClientConfig): Promise<Pay03bAdminCatalogue> {
  const res = await read<unknown>(config, '/pay03b/admin/catalogue')
  return requireShape<Pay03bAdminCatalogue>(res, isObject(res) && Array.isArray(res.plans)
    && res.plans.every((p) => isObject(p) && typeof p.planCode === 'string'), 'PAY03B_ADMIN_CATALOGUE_RESPONSE_INVALID')
}

export async function fetchPay03bAdminSubscriptions(config: Pay03bClientConfig): Promise<Pay03bAdminSubscriptionList> {
  const res = await read<unknown>(config, '/pay03b/admin/subscriptions')
  return requireShape<Pay03bAdminSubscriptionList>(res, isObject(res) && Array.isArray(res.subscriptions)
    && res.subscriptions.every((s) => isObject(s) && typeof s.id === 'string'), 'PAY03B_ADMIN_SUBSCRIPTIONS_RESPONSE_INVALID')
}

function isAdminDetail(value: unknown): value is Pay03bAdminSubscriptionDetail {
  return isObject(value) && isObject(value.subscription) && Array.isArray(value.invoices)
    && Array.isArray(value.transitions) && Array.isArray(value.changeRequests) && isObject(value.entitlements)
}

export async function fetchPay03bAdminSubscription(
  config: Pay03bClientConfig,
  subscriptionId: string,
): Promise<Pay03bAdminSubscriptionDetail> {
  const res = await read<unknown>(config, `/pay03b/admin/subscriptions/${enc(subscriptionId)}`)
  return requireShape<Pay03bAdminSubscriptionDetail>(res, isAdminDetail(res), 'PAY03B_ADMIN_SUBSCRIPTION_RESPONSE_INVALID')
}

export async function reconcilePay03bAdminSubscription(
  config: Pay03bClientConfig,
  subscriptionId: string,
): Promise<Pay03bAdminSubscriptionDetail> {
  const res = await write<unknown>(config, `/pay03b/admin/subscriptions/${enc(subscriptionId)}/reconcile`)
  return requireShape<Pay03bAdminSubscriptionDetail>(res, isAdminDetail(res), 'PAY03B_ADMIN_SUBSCRIPTION_RESPONSE_INVALID')
}

export async function setPay03bAdminSuspension(
  config: Pay03bClientConfig,
  subscriptionId: string,
  body: { action: Pay03bSuspensionAction; reason: string },
  idempotencyKey: string,
): Promise<Pay03bAdminSubscriptionDetail> {
  const res = await write<unknown>(config, `/pay03b/admin/subscriptions/${enc(subscriptionId)}/suspension`,
    { action: body.action, reason: body.reason.trim() }, idempotencyHeader(idempotencyKey))
  return requireShape<Pay03bAdminSubscriptionDetail>(res, isAdminDetail(res), 'PAY03B_ADMIN_SUBSCRIPTION_RESPONSE_INVALID')
}

export async function refundPay03bAdminInvoice(
  config: Pay03bClientConfig,
  subscriptionId: string,
  invoiceId: string,
  body: { reason: string },
): Promise<Pay03bAdminSubscriptionDetail> {
  const res = await write<unknown>(
    config,
    `/pay03b/admin/subscriptions/${enc(subscriptionId)}/invoices/${enc(invoiceId)}/refund`,
    { reason: body.reason.trim() },
  )
  return requireShape<Pay03bAdminSubscriptionDetail>(res, isAdminDetail(res), 'PAY03B_ADMIN_SUBSCRIPTION_RESPONSE_INVALID')
}

// ------------------------------------------------------------------------------------------ F5 reconciliation

export async function fetchPay03bReconciliationExceptions(
  config: Pay03bClientConfig,
  status: Pay03bExceptionStatusFilter = 'open',
): Promise<Pay03bReconciliationExceptionList> {
  const res = await read<unknown>(config, `/pay03b/admin/reconciliation-exceptions?status=${enc(status)}`)
  return requireShape<Pay03bReconciliationExceptionList>(res, isObject(res) && Array.isArray(res.exceptions)
    && typeof res.openCount === 'number' && res.exceptions.every((e) => isObject(e) && typeof e.id === 'string'),
  'PAY03B_RECONCILIATION_EXCEPTIONS_RESPONSE_INVALID')
}

export async function fetchPay03bReconciliationException(
  config: Pay03bClientConfig,
  exceptionId: string,
  options: { verify?: boolean } = {},
): Promise<Pay03bReconciliationExceptionDetail> {
  const res = await read<unknown>(config,
    `/pay03b/admin/reconciliation-exceptions/${enc(exceptionId)}${options.verify ? '?verify=1' : ''}`)
  return requireShape<Pay03bReconciliationExceptionDetail>(res, isObject(res) && isObject(res.exception)
    && (res.providerTruth === null || isObject(res.providerTruth)), 'PAY03B_RECONCILIATION_EXCEPTION_RESPONSE_INVALID')
}

export async function acknowledgePay03bReconciliationException(
  config: Pay03bClientConfig,
  exceptionId: string,
): Promise<{ exception: Pay03bReconciliationExceptionDetail['exception'] }> {
  const res = await write<unknown>(config, `/pay03b/admin/reconciliation-exceptions/${enc(exceptionId)}/acknowledge`)
  return requireShape<{ exception: Pay03bReconciliationExceptionDetail['exception'] }>(res,
    isObject(res) && isObject(res.exception), 'PAY03B_RECONCILIATION_EXCEPTION_RESPONSE_INVALID')
}

export async function resolvePay03bReconciliationException(
  config: Pay03bClientConfig,
  exceptionId: string,
  body: Pay03bResolveRequest,
): Promise<Pay03bResolveResult> {
  const res = await write<unknown>(config, `/pay03b/admin/reconciliation-exceptions/${enc(exceptionId)}/resolve`,
    { resolution: body.resolution, note: body.note.trim() })
  return requireShape<Pay03bResolveResult>(res, isObject(res) && isObject(res.exception),
    'PAY03B_RECONCILIATION_EXCEPTION_RESPONSE_INVALID')
}
