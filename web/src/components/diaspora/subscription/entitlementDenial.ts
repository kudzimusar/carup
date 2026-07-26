/**
 * Phase 8 — Structured entitlement-denial parsing (pure, reusable, SAFE).
 *
 * The web apiClient throws a plain Error whose `.message` is the backend's `error.message` STRING
 * (the structured `error.code`/`requestId`/`details` are not propagated to callers — see
 * web/src/lib/apiClient.ts). So this parser classifies a denial from (a) a thrown Error's message,
 * (b) an already-structured object a caller passes directly, or (c) a raw backend error body.
 *
 * It NEVER surfaces db details, stack traces, internal tenant ids, raw provider errors, or secrets:
 * the human-facing `message` is always one of our own safe summaries, derived from the CATEGORY — the
 * raw backend string is used only for classification, not displayed verbatim for the sensitive cases.
 */
import type {
  StructuredEntitlementDenial,
  EntitlementDenialCategory,
} from '@/types'

export interface DenialContext {
  /** What the user attempted, e.g. "manage subscription" / "start checkout". */
  requestedOperation?: string
  /** Canonical feature key the operation needed, when known. */
  requiredFeature?: string
  /** The caller's current plan key, when known. */
  currentPlan?: string
  /** Lowest plan that grants the required feature, when known. */
  requiredPlan?: string | null
  /** Remaining quota for the feature, when known. */
  remaining?: number | null
}

/** Safe, category-specific human summaries. Never echoes raw backend/provider/db text. */
const CATEGORY_MESSAGE: Record<EntitlementDenialCategory, string> = {
  'feature-unavailable-on-plan': 'This feature is not included in your current plan.',
  'quota-exhausted': 'You have reached the usage limit for this feature on your current plan.',
  'inactive-subscription': 'Your subscription is not currently active, so this feature is unavailable.',
  'tenant-context-missing': 'No tenant context is available. Select or join a tenant to manage a subscription.',
  'external-activation-unavailable': 'This action could not be completed right now. Please try again shortly.',
  'ordinary-authorization-failure': 'You do not have permission to perform this action.',
  'network-or-server-failure': 'We could not reach the service. Please check your connection and try again.',
}

const CATEGORY_RETRYABLE: Record<EntitlementDenialCategory, boolean> = {
  'feature-unavailable-on-plan': false,
  'quota-exhausted': false,
  'inactive-subscription': false,
  'tenant-context-missing': false,
  'external-activation-unavailable': true,
  'ordinary-authorization-failure': false,
  'network-or-server-failure': true,
}

const CATEGORY_UPGRADE_ELIGIBLE: Record<EntitlementDenialCategory, boolean> = {
  'feature-unavailable-on-plan': true,
  'quota-exhausted': true,
  'inactive-subscription': false,
  'tenant-context-missing': false,
  'external-activation-unavailable': false,
  'ordinary-authorization-failure': false,
  'network-or-server-failure': false,
}

function lower(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : ''
}

/**
 * Classify a denial category from the safe signals available: an explicit backend error `code`
 * (when a caller passes the raw body), and/or the backend message string.
 */
export function classifyDenial(input: { code?: string | null; message?: string | null }): EntitlementDenialCategory {
  const code = lower(input.code)
  const msg = lower(input.message)

  // Transport / no-response failures (fetch TypeError surfaces as "failed to fetch"/"network").
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('networkerror') ||
    msg.includes('timeout') ||
    msg.includes('http error') ||
    code === 'internal_server_error'
  ) {
    return 'network-or-server-failure'
  }

  // Tenant context missing (validation from requireTenantId / assertCanManageSubscription).
  if (msg.includes('tenant context') || msg.includes('x-tenant-id') || code === 'tenant_context_missing') {
    return 'tenant-context-missing'
  }

  // External activation / provider could not be wired (sandbox/provider unavailable — never echoed raw).
  if (
    code === 'billing_provider_unavailable' ||
    code === 'external_activation_unavailable' ||
    msg.includes('provider is not available') ||
    msg.includes('billing provider') ||
    msg.includes('activation is unavailable')
  ) {
    return 'external-activation-unavailable'
  }

  // Quota exhausted (reserveUsage QUOTA_EXCEEDED / "would exceed the N quota").
  if (
    code === 'quota_exceeded' ||
    msg.includes('quota exceeded') ||
    msg.includes('would exceed') ||
    msg.includes('usage limit') ||
    msg.includes('exhausted')
  ) {
    return 'quota-exhausted'
  }

  // Feature not included in the plan (checkFeature FEATURE_NOT_ENTITLED / "not included in plan").
  if (
    code === 'feature_not_entitled' ||
    code === 'not_entitled' ||
    msg.includes('not included in plan') ||
    msg.includes('not included in your plan') ||
    msg.includes('no quota on plan') ||
    msg.includes('not available on plan')
  ) {
    return 'feature-unavailable-on-plan'
  }

  // Inactive subscription.
  if (
    code === 'subscription_inactive' ||
    msg.includes('subscription is not active') ||
    msg.includes('inactive subscription') ||
    msg.includes('not currently active')
  ) {
    return 'inactive-subscription'
  }

  // Management forbidden / ordinary authorization failure (Gate S8-A: 403 INSUFFICIENT_PERMISSIONS,
  // SUBSCRIPTION_MANAGEMENT_FORBIDDEN, "not authorized to manage this tenant subscription").
  if (
    code === 'insufficient_permissions' ||
    code === 'subscription_management_forbidden' ||
    code === 'forbidden' ||
    msg.includes('not authorized') ||
    msg.includes('not permitted') ||
    msg.includes('permission')
  ) {
    return 'ordinary-authorization-failure'
  }

  // Unknown 4xx → treat as an ordinary authorization failure (do NOT echo the raw string).
  return 'ordinary-authorization-failure'
}

/** Build a safe, structured denial from an explicit category + context. */
export function buildDenial(
  category: EntitlementDenialCategory,
  context: DenialContext = {},
): StructuredEntitlementDenial {
  return {
    category,
    message: CATEGORY_MESSAGE[category],
    requestedOperation: context.requestedOperation,
    requiredFeature: context.requiredFeature,
    currentPlan: context.currentPlan,
    requiredPlan: context.requiredPlan ?? null,
    remaining: context.remaining ?? null,
    upgradeEligible: CATEGORY_UPGRADE_ELIGIBLE[category],
    retryable: CATEGORY_RETRYABLE[category],
  }
}

/**
 * Parse ANY caught value into a safe StructuredEntitlementDenial.
 * Accepts: an already-structured denial (returned as-is, re-normalized), a thrown Error,
 * a raw backend body { error: { code, message } } / { success:false, error:{...} }, or a string.
 */
export function parseEntitlementDenial(
  input: unknown,
  context: DenialContext = {},
): StructuredEntitlementDenial {
  // Already structured? Trust the category but re-derive the safe message + flags.
  if (input && typeof input === 'object' && 'category' in (input as Record<string, unknown>)) {
    const d = input as StructuredEntitlementDenial
    return {
      ...buildDenial(d.category, {
        requestedOperation: d.requestedOperation ?? context.requestedOperation,
        requiredFeature: d.requiredFeature ?? context.requiredFeature,
        currentPlan: d.currentPlan ?? context.currentPlan,
        requiredPlan: d.requiredPlan ?? context.requiredPlan,
        remaining: d.remaining ?? context.remaining,
      }),
      // Honor an explicit custom message only if the caller already authored a safe one.
      message: typeof d.message === 'string' && d.message ? d.message : CATEGORY_MESSAGE[d.category],
    }
  }

  let code: string | null = null
  let message: string | null = null

  if (typeof input === 'string') {
    message = input
  } else if (input instanceof Error) {
    message = input.message
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const err = obj.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      code = typeof e.code === 'string' ? e.code : null
      message = typeof e.message === 'string' ? e.message : null
    } else if (typeof err === 'string') {
      message = err
    }
    if (!message && typeof obj.message === 'string') message = obj.message
    if (!code && typeof obj.code === 'string') code = obj.code
  }

  const category = classifyDenial({ code, message })
  return buildDenial(category, context)
}
