/**
 * The gated-operations registry (Issue #127, Deliverable D).
 *
 * "Complete entitlement enforcement across the documented gated operations" is only checkable if the
 * documented set is written down somewhere a test can read. This module is that place: one entry per
 * feature key, naming the operation it guards, where the guard lives, and — for the keys that are NOT
 * enforced — the specific reason, so an unwired key is a recorded decision rather than an oversight
 * nobody noticed.
 *
 * THE ZERO-LIMIT TRAP. A feature key that is absent from PLAN_CATALOG resolves to `undefined`, which
 * the resolver treats as 0 / false, which denies every tenant on every plan. From the outside that is
 * indistinguishable from correct enforcement: the guard runs, the denial is explainable, the tests
 * pass, and every customer is locked out of a feature they paid for. `assertRegistryIntegrity()` runs
 * at import time and refuses to load a registry containing a key that no plan grants.
 *
 * Enforcement itself always goes through the entitlement GUARD (requireFeature /
 * reserveQuotaForFeature / withEntitlement), never through the raw usage service. The guard is what
 * makes enforcement a no-op while DIASPORA_SUBSCRIPTION_ENFORCEMENT is off (the default), so wiring a
 * new call site changes nothing until enforcement is deliberately switched on.
 */
import {
  FEATURE_KEYS,
  PLAN_CATALOG,
  PLAN_KEYS,
  METERED_FEATURE_KEYS,
  lowestPlanGranting,
} from '../../../constants/diaspora/diasporaEntitlements.js';
import { requireFeature, reserveQuotaForFeature, withEntitlement } from '../diasporaEntitlementGuard.js';

/** How a feature key is enforced. */
export const ENFORCEMENT_MODES = Object.freeze({
  BOOLEAN: 'boolean',            // requireFeature only
  BOOLEAN_PLUS_QUOTA: 'boolean+quota', // requireFeature + reserveQuotaForFeature (or withEntitlement)
  QUOTA_ONLY: 'quota',           // the key IS the quota (a cap, not a capability)
  NOT_ENFORCED: 'not-enforced',  // deliberately unwired, with a reason
});

/**
 * The registry. `site` is the function that carries the guard; `reason` is required whenever
 * mode is NOT_ENFORCED.
 */
export const GATED_OPERATIONS = Object.freeze([
  {
    featureKey: FEATURE_KEYS.WORKBOOK_DOWNLOAD,
    operation: 'Download a blank workbook template',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaWorkbookXlsxRoutes.GET /workbook/template.xlsx',
  },
  {
    featureKey: FEATURE_KEYS.WORKBOOK_UPLOAD,
    operation: 'Upload a workbook (dry-run persistence)',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaWorkbookSyncService.runAndPersistDiasporaWorkbookDryRun',
  },
  {
    featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT,
    operation: 'Execute a confirmed bulk workbook import',
    mode: ENFORCEMENT_MODES.BOOLEAN_PLUS_QUOTA,
    site: 'diasporaWorkbookConfirmedImportService.executeConfirmedImport',
  },
  {
    featureKey: FEATURE_KEYS.STOCK_CREATE,
    operation: 'Create a stock item / supply document',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaStockService.createStockItem + diasporaSupplyDocumentService.createSupplyDocument',
  },
  {
    featureKey: FEATURE_KEYS.STOCK_PUBLISH,
    operation: 'Publish stock to the marketplace',
    mode: ENFORCEMENT_MODES.BOOLEAN_PLUS_QUOTA,
    site: 'diasporaSupplyDocumentService.publishSupplyDocument + diasporaStockService.publishStockItem',
  },
  {
    featureKey: FEATURE_KEYS.STOCK_MAX_ITEMS,
    operation: 'Published stock ceiling',
    mode: ENFORCEMENT_MODES.QUOTA_ONLY,
    site: 'reserved by the two publish paths above',
  },
  {
    featureKey: FEATURE_KEYS.RFQ_CREATE,
    operation: 'Publish a buyer RFQ',
    mode: ENFORCEMENT_MODES.BOOLEAN_PLUS_QUOTA,
    site: 'diasporaBuyerOrderService.publishRfq',
  },
  {
    featureKey: FEATURE_KEYS.RFQ_RESPOND,
    operation: 'Respond to an RFQ with a quote',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaRfqService.createQuote + diasporaRfqService.submitQuoteById',
  },
  {
    featureKey: FEATURE_KEYS.RFQ_MAX_OPEN,
    operation: 'Open RFQ ceiling',
    mode: ENFORCEMENT_MODES.QUOTA_ONLY,
    site: 'reserved by publishRfq',
  },
  {
    featureKey: FEATURE_KEYS.AI_PARSE,
    operation: 'Parse a natural-language trade command',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaAiCommandService.createAiCommand',
  },
  {
    featureKey: FEATURE_KEYS.AI_EXECUTE_MEDIUM,
    operation: 'Execute a medium-risk AI command',
    mode: ENFORCEMENT_MODES.BOOLEAN_PLUS_QUOTA,
    site: 'diasporaAiCommandService.executeAiCommand',
  },
  {
    featureKey: FEATURE_KEYS.CONTAINER_RESERVE,
    operation: 'Request a container reservation',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaContainerMarketplaceService.requestReservation',
  },
  {
    featureKey: FEATURE_KEYS.CONTAINER_MANAGE,
    operation: 'Create/manage a container',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaContainerMarketplaceService.createContainer',
  },
  {
    featureKey: FEATURE_KEYS.SAFETRADE_CREATE,
    operation: 'Open a SafeTrade transaction',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaSafeTradeTransactionService.createSafeTradeTransaction',
  },
  {
    featureKey: FEATURE_KEYS.AUDIT_EXPORT,
    operation: 'Bulk export tenant trade data from the database into a workbook',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaWorkbookDbExportService.exportWorkbookFromDatabase',
  },
  {
    featureKey: FEATURE_KEYS.DRIVE_CONNECT,
    operation: 'Connect a Google Drive account',
    mode: ENFORCEMENT_MODES.NOT_ENFORCED,
    site: null,
    reason: 'The Drive connect/export surface is being rebuilt in a separate lane (OAuth/PKCE, vault, '
      + 'durable sync). Wiring a guard into files under active reconstruction would collide; the guard '
      + 'belongs at the connect boundary that lane creates.',
  },
  {
    featureKey: FEATURE_KEYS.DRIVE_EXPORT,
    operation: 'Export to Google Drive',
    mode: ENFORCEMENT_MODES.NOT_ENFORCED,
    site: null,
    reason: 'Same lane as DRIVE_CONNECT — the export path runs through the durable sync layer being '
      + 'rebuilt there, and the correct gate is at the export boundary that lane defines rather than '
      + 'at a call site that is about to move.',
  },
  {
    featureKey: FEATURE_KEYS.GRAPH_ADVANCED,
    operation: 'Trade-graph intelligence reads (demand signals, container opportunities, risk exposure)',
    mode: ENFORCEMENT_MODES.NOT_ENFORCED,
    site: null,
    reason: 'The trade-graph services take a node-postgres pgClient, not a supabase client, and their '
      + 'shared context guard is synchronous. Enforcing correctly means making that guard async across '
      + 'ten call sites, which is a refactor of another subsystem rather than billing work. The '
      + 'backend capability flag DIASPORA_TRADE_GRAPH is OFF, so the entire surface 404s today.',
  },
  {
    featureKey: FEATURE_KEYS.API_ACCESS,
    operation: 'Programmatic API access',
    mode: ENFORCEMENT_MODES.NOT_ENFORCED,
    site: null,
    reason: 'No diaspora public/partner API surface exists to gate. The only partner API in the '
      + 'codebase serves vehicle identity/trust and has no diaspora routes. The key remains a plan '
      + 'differentiator (enterprise vs trade_pro) with nothing to enforce it against yet.',
  },
]);

/**
 * Integrity check, run at import time.
 *
 * Refuses a registry that would silently deny everyone. Also refuses an unwired entry with no reason,
 * because "not enforced" without a reason is how a gap becomes permanent.
 */
export function assertRegistryIntegrity() {
  const known = new Set(Object.values(FEATURE_KEYS));
  const seen = new Set();

  for (const entry of GATED_OPERATIONS) {
    if (!known.has(entry.featureKey)) {
      throw new Error(`Gated-operations registry references an unknown feature key: ${entry.featureKey}`);
    }
    if (seen.has(entry.featureKey)) {
      throw new Error(`Gated-operations registry lists ${entry.featureKey} twice`);
    }
    seen.add(entry.featureKey);

    // THE zero-limit trap: a key no plan grants denies every tenant on every plan while looking correct.
    const grantedByAPlan = PLAN_KEYS.some((planKey) => {
      const value = PLAN_CATALOG[planKey].entitlements[entry.featureKey];
      return value === true || (typeof value === 'number' && value > 0);
    });
    if (!grantedByAPlan) {
      throw new Error(
        `Feature key ${entry.featureKey} is granted by NO plan in PLAN_CATALOG. Enforcing it would deny `
        + 'every tenant on every plan while looking like correct enforcement.',
      );
    }

    if (entry.mode === ENFORCEMENT_MODES.NOT_ENFORCED && !entry.reason) {
      throw new Error(`Gated operation ${entry.featureKey} is unenforced with no recorded reason`);
    }
    if (entry.mode !== ENFORCEMENT_MODES.NOT_ENFORCED && !entry.site) {
      throw new Error(`Gated operation ${entry.featureKey} claims enforcement but names no site`);
    }
  }

  // Every canonical feature key must appear. A key that exists but is not in the registry is exactly
  // the "documented gated operation" nobody remembered to consider.
  for (const key of known) {
    if (!seen.has(key)) {
      throw new Error(`Feature key ${key} is missing from the gated-operations registry`);
    }
  }
  return true;
}

assertRegistryIntegrity();

/** Entries that are actually wired. */
export function enforcedOperations() {
  return GATED_OPERATIONS.filter((e) => e.mode !== ENFORCEMENT_MODES.NOT_ENFORCED);
}

/** Entries deliberately left unwired, with their reasons. */
export function unenforcedOperations() {
  return GATED_OPERATIONS.filter((e) => e.mode === ENFORCEMENT_MODES.NOT_ENFORCED);
}

export function gatedOperationFor(featureKey) {
  return GATED_OPERATIONS.find((e) => e.featureKey === featureKey) || null;
}

/** Coverage summary for an operator/health surface. */
export function entitlementCoverage() {
  const enforced = enforcedOperations();
  const unenforced = unenforcedOperations();
  return {
    total: GATED_OPERATIONS.length,
    enforced: enforced.length,
    unenforced: unenforced.length,
    meteredKeys: [...METERED_FEATURE_KEYS],
    gaps: unenforced.map((e) => ({ featureKey: e.featureKey, operation: e.operation, reason: e.reason })),
    lowestPlanGranting: Object.fromEntries(
      GATED_OPERATIONS.map((e) => [e.featureKey, lowestPlanGranting(e.featureKey)]),
    ),
  };
}

// Re-exported so a call site has ONE import for enforcement and cannot reach for the raw usage service
// by accident. reserveUsage is deliberately not re-exported.
export { requireFeature, reserveQuotaForFeature, withEntitlement };
