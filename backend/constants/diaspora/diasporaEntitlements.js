/**
 * Phase 8 — Subscription entitlement registry (config-driven).
 *
 * Subscription granularity (authoritative product decision PD-1): TENANT PLAN + PER-USER OVERRIDES.
 * Subscriptions and quotas attach to the tenant (tenant_id). Effective entitlements derive from the
 * tenant's plan and may be overridden per user via diaspora_user_entitlement_overrides.
 *
 * This module is the SINGLE source of truth for feature keys and the plan catalog. The migration
 * seeds diaspora_subscription_plans from PLAN_CATALOG; the service resolves entitlements from the DB
 * subscription row but falls back to this catalog so plans are never hardcoded across the codebase.
 */

// Canonical feature registry. Every gated capability/quota has exactly one key here.
export const FEATURE_KEYS = Object.freeze({
  WORKBOOK_DOWNLOAD: 'diaspora.workbook.download',
  WORKBOOK_UPLOAD: 'diaspora.workbook.upload',
  WORKBOOK_BULK_IMPORT: 'diaspora.workbook.bulk_import',
  STOCK_CREATE: 'diaspora.stock.create',
  STOCK_PUBLISH: 'diaspora.stock.publish',
  STOCK_MAX_ITEMS: 'diaspora.stock.max_items',
  RFQ_CREATE: 'diaspora.rfq.create',
  RFQ_RESPOND: 'diaspora.rfq.respond',
  RFQ_MAX_OPEN: 'diaspora.rfq.max_open',
  AI_PARSE: 'diaspora.ai.parse',
  AI_EXECUTE_MEDIUM: 'diaspora.ai.execute_medium',
  CONTAINER_RESERVE: 'diaspora.container.reserve',
  CONTAINER_MANAGE: 'diaspora.container.manage',
  DRIVE_CONNECT: 'diaspora.drive.connect',
  DRIVE_EXPORT: 'diaspora.drive.export',
  API_ACCESS: 'diaspora.api.access',
  AUDIT_EXPORT: 'diaspora.audit.export',
  SAFETRADE_CREATE: 'diaspora.safetrade.create',
  GRAPH_ADVANCED: 'diaspora.graph.advanced',
});

// Monthly-metered quota features. The integer entitlement value is the per-period ceiling enforced
// by diaspora_reserve_usage_atomic. Non-metered integers (e.g. max_items / max_open) are point-in-time
// caps checked by the owning domain service, not by the usage meter.
export const METERED_FEATURE_KEYS = Object.freeze([
  FEATURE_KEYS.WORKBOOK_BULK_IMPORT,
  FEATURE_KEYS.AI_EXECUTE_MEDIUM,
]);

// Entitlement value semantics.
export const ENTITLEMENT_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  INTEGER_QUOTA: 'integer_quota',
  DATE_LIMITED: 'date_limited',
});

// Type classification per feature key (drives how checkFeature/checkQuota interpret the value).
export const FEATURE_ENTITLEMENT_TYPES = Object.freeze({
  [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.WORKBOOK_UPLOAD]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: ENTITLEMENT_TYPES.INTEGER_QUOTA,
  [FEATURE_KEYS.STOCK_CREATE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.STOCK_PUBLISH]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.STOCK_MAX_ITEMS]: ENTITLEMENT_TYPES.INTEGER_QUOTA,
  [FEATURE_KEYS.RFQ_CREATE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.RFQ_RESPOND]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.RFQ_MAX_OPEN]: ENTITLEMENT_TYPES.INTEGER_QUOTA,
  [FEATURE_KEYS.AI_PARSE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: ENTITLEMENT_TYPES.INTEGER_QUOTA,
  [FEATURE_KEYS.CONTAINER_RESERVE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.CONTAINER_MANAGE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.DRIVE_CONNECT]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.DRIVE_EXPORT]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.API_ACCESS]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.AUDIT_EXPORT]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.SAFETRADE_CREATE]: ENTITLEMENT_TYPES.BOOLEAN,
  [FEATURE_KEYS.GRAPH_ADVANCED]: ENTITLEMENT_TYPES.BOOLEAN,
});

// Subscription lifecycle states (mirrors the DB CHECK on diaspora_subscriptions.status).
export const SUBSCRIPTION_STATES = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  GRACE_PERIOD: 'grace_period',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  INCOMPLETE: 'incomplete',
  SUSPENDED: 'suspended',
});

// States that grant feature access.
//
// Policy: active, trialing and grace_period are access-granting. past_due is NOT access-granting by
// default — a past_due subscription must first be transitioned into grace_period (an explicit, dunning-
// driven decision) to retain access. This keeps "soft dunning" a deliberate, auditable state change
// rather than an implicit grant, while still letting operators offer a grace window. paused, cancelled,
// expired, incomplete and suspended never grant access.
const ACCESS_GRANTING_STATES = Object.freeze(new Set([
  SUBSCRIPTION_STATES.ACTIVE,
  SUBSCRIPTION_STATES.TRIALING,
  SUBSCRIPTION_STATES.GRACE_PERIOD,
]));

export function isSubscriptionActiveState(status) {
  return ACCESS_GRANTING_STATES.has(String(status || '').toLowerCase());
}

export const DEFAULT_PLAN_KEY = 'free';

/**
 * Plan catalog (config-driven). plan_key -> { name, tier, sort_order, entitlements }.
 * Booleans gate capabilities; integers express quotas/caps. Absent boolean keys are treated as false;
 * absent integer keys are treated as 0 by the resolver (deny / no quota) unless overridden per user.
 *
 * Tier mapping to the system plan (docs/CARUP_DIASPORA_TRADE_OS_SYSTEM_PLAN.md §10.1):
 *   free            — anonymous/trial floor: browse + download templates only.
 *   diaspora_buyer  — buyer requests, RFQ create, workbook download/upload, limited AI, drive connect.
 *   seller          — stock create/publish, RFQ respond, seller workbook, seller AI, drive connect.
 *   trade_pro       — bulk import/export, drive sync, container reservations, higher quotas, analytics.
 *   enterprise      — everything + API access, audit export, advanced graph, highest/unlimited quotas.
 */
export const PLAN_CATALOG = Object.freeze({
  free: Object.freeze({
    name: 'Free',
    tier: 'free',
    sort_order: 0,
    description: 'Browse the marketplace and download blank workbook templates.',
    entitlements: Object.freeze({
      [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_UPLOAD]: false,
      [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: 0,
      [FEATURE_KEYS.STOCK_CREATE]: false,
      [FEATURE_KEYS.STOCK_PUBLISH]: false,
      [FEATURE_KEYS.STOCK_MAX_ITEMS]: 0,
      [FEATURE_KEYS.RFQ_CREATE]: false,
      [FEATURE_KEYS.RFQ_RESPOND]: false,
      [FEATURE_KEYS.RFQ_MAX_OPEN]: 0,
      [FEATURE_KEYS.AI_PARSE]: false,
      [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: 0,
      [FEATURE_KEYS.CONTAINER_RESERVE]: false,
      [FEATURE_KEYS.CONTAINER_MANAGE]: false,
      [FEATURE_KEYS.DRIVE_CONNECT]: false,
      [FEATURE_KEYS.DRIVE_EXPORT]: false,
      [FEATURE_KEYS.API_ACCESS]: false,
      [FEATURE_KEYS.AUDIT_EXPORT]: false,
      [FEATURE_KEYS.SAFETRADE_CREATE]: false,
      [FEATURE_KEYS.GRAPH_ADVANCED]: false,
    }),
  }),
  diaspora_buyer: Object.freeze({
    name: 'Diaspora Buyer',
    tier: 'buyer',
    sort_order: 10,
    description: 'Create buyer requests and RFQs, upload documents, use the limited AI assistant.',
    entitlements: Object.freeze({
      [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_UPLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: 0,
      [FEATURE_KEYS.STOCK_CREATE]: false,
      [FEATURE_KEYS.STOCK_PUBLISH]: false,
      [FEATURE_KEYS.STOCK_MAX_ITEMS]: 0,
      [FEATURE_KEYS.RFQ_CREATE]: true,
      [FEATURE_KEYS.RFQ_RESPOND]: false,
      [FEATURE_KEYS.RFQ_MAX_OPEN]: 10,
      [FEATURE_KEYS.AI_PARSE]: true,
      [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: 25,
      [FEATURE_KEYS.CONTAINER_RESERVE]: false,
      [FEATURE_KEYS.CONTAINER_MANAGE]: false,
      [FEATURE_KEYS.DRIVE_CONNECT]: true,
      [FEATURE_KEYS.DRIVE_EXPORT]: false,
      [FEATURE_KEYS.API_ACCESS]: false,
      [FEATURE_KEYS.AUDIT_EXPORT]: false,
      [FEATURE_KEYS.SAFETRADE_CREATE]: true,
      [FEATURE_KEYS.GRAPH_ADVANCED]: false,
    }),
  }),
  seller: Object.freeze({
    name: 'Seller / Supplier',
    tier: 'seller',
    sort_order: 20,
    description: 'Upload and publish stock, respond to RFQs, use the seller AI assistant.',
    entitlements: Object.freeze({
      [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_UPLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: 0,
      [FEATURE_KEYS.STOCK_CREATE]: true,
      [FEATURE_KEYS.STOCK_PUBLISH]: true,
      [FEATURE_KEYS.STOCK_MAX_ITEMS]: 250,
      [FEATURE_KEYS.RFQ_CREATE]: false,
      [FEATURE_KEYS.RFQ_RESPOND]: true,
      [FEATURE_KEYS.RFQ_MAX_OPEN]: 0,
      [FEATURE_KEYS.AI_PARSE]: true,
      [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: 25,
      [FEATURE_KEYS.CONTAINER_RESERVE]: false,
      [FEATURE_KEYS.CONTAINER_MANAGE]: false,
      [FEATURE_KEYS.DRIVE_CONNECT]: true,
      [FEATURE_KEYS.DRIVE_EXPORT]: false,
      [FEATURE_KEYS.API_ACCESS]: false,
      [FEATURE_KEYS.AUDIT_EXPORT]: false,
      [FEATURE_KEYS.SAFETRADE_CREATE]: true,
      [FEATURE_KEYS.GRAPH_ADVANCED]: false,
    }),
  }),
  trade_pro: Object.freeze({
    name: 'Trade Pro',
    tier: 'pro',
    sort_order: 30,
    description: 'Bulk workbook import/export, drive sync, container reservations, advanced analytics.',
    entitlements: Object.freeze({
      [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_UPLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: 200,
      [FEATURE_KEYS.STOCK_CREATE]: true,
      [FEATURE_KEYS.STOCK_PUBLISH]: true,
      [FEATURE_KEYS.STOCK_MAX_ITEMS]: 5000,
      [FEATURE_KEYS.RFQ_CREATE]: true,
      [FEATURE_KEYS.RFQ_RESPOND]: true,
      [FEATURE_KEYS.RFQ_MAX_OPEN]: 100,
      [FEATURE_KEYS.AI_PARSE]: true,
      [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: 250,
      [FEATURE_KEYS.CONTAINER_RESERVE]: true,
      [FEATURE_KEYS.CONTAINER_MANAGE]: true,
      [FEATURE_KEYS.DRIVE_CONNECT]: true,
      [FEATURE_KEYS.DRIVE_EXPORT]: true,
      [FEATURE_KEYS.API_ACCESS]: false,
      [FEATURE_KEYS.AUDIT_EXPORT]: true,
      [FEATURE_KEYS.SAFETRADE_CREATE]: true,
      [FEATURE_KEYS.GRAPH_ADVANCED]: true,
    }),
  }),
  enterprise: Object.freeze({
    name: 'Enterprise Partner',
    tier: 'enterprise',
    sort_order: 40,
    description: 'API access, branch/staff management, advanced dashboards, dedicated trade operations.',
    entitlements: Object.freeze({
      [FEATURE_KEYS.WORKBOOK_DOWNLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_UPLOAD]: true,
      [FEATURE_KEYS.WORKBOOK_BULK_IMPORT]: 2000,
      [FEATURE_KEYS.STOCK_CREATE]: true,
      [FEATURE_KEYS.STOCK_PUBLISH]: true,
      [FEATURE_KEYS.STOCK_MAX_ITEMS]: 100000,
      [FEATURE_KEYS.RFQ_CREATE]: true,
      [FEATURE_KEYS.RFQ_RESPOND]: true,
      [FEATURE_KEYS.RFQ_MAX_OPEN]: 1000,
      [FEATURE_KEYS.AI_PARSE]: true,
      [FEATURE_KEYS.AI_EXECUTE_MEDIUM]: 2000,
      [FEATURE_KEYS.CONTAINER_RESERVE]: true,
      [FEATURE_KEYS.CONTAINER_MANAGE]: true,
      [FEATURE_KEYS.DRIVE_CONNECT]: true,
      [FEATURE_KEYS.DRIVE_EXPORT]: true,
      [FEATURE_KEYS.API_ACCESS]: true,
      [FEATURE_KEYS.AUDIT_EXPORT]: true,
      [FEATURE_KEYS.SAFETRADE_CREATE]: true,
      [FEATURE_KEYS.GRAPH_ADVANCED]: true,
    }),
  }),
});

export const PLAN_KEYS = Object.freeze(Object.keys(PLAN_CATALOG));

/** Lowest plan that grants a boolean feature (used for explainable "required plan" denials). */
export function lowestPlanGranting(featureKey) {
  const ordered = [...PLAN_KEYS].sort(
    (a, b) => (PLAN_CATALOG[a].sort_order ?? 0) - (PLAN_CATALOG[b].sort_order ?? 0),
  );
  for (const key of ordered) {
    const value = PLAN_CATALOG[key].entitlements[featureKey];
    if (value === true || (typeof value === 'number' && value > 0)) return key;
  }
  return null;
}

/** The catalog entry for a plan key, or the Free default. */
export function planCatalogEntry(planKey) {
  return PLAN_CATALOG[planKey] || PLAN_CATALOG[DEFAULT_PLAN_KEY];
}

export function isMeteredFeature(featureKey) {
  return METERED_FEATURE_KEYS.includes(featureKey);
}

export function entitlementTypeFor(featureKey) {
  return FEATURE_ENTITLEMENT_TYPES[featureKey] || ENTITLEMENT_TYPES.BOOLEAN;
}
