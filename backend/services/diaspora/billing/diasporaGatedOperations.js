/**
 * The gated-operations registry (Issue #127, Deliverable D).
 *
 * "Complete entitlement enforcement across the documented gated operations" is only checkable if the
 * documented set is written down somewhere a test can read. This module is that place: one entry per
 * feature key, naming the operation it guards and where the guard lives.
 *
 * THE RULE, since Issue #127 phase 2C. For every key in PLAN_CATALOG exactly one of these is true:
 *
 *   (1) a reachable operation enforces it through the entitlement GUARD, or
 *   (2) the capability is explicitly UNAVAILABLE and no plan grants it.
 *
 * There is no third option any more. A key that a plan SELLS and no route guards used to be
 * permitted here as long as it carried a written reason — but a reason is not a control, and the
 * customer is still being charged for something nothing protects. assertRegistryIntegrity() now
 * refuses to load such a registry, so the gap cannot be reintroduced by adding a comment.
 *
 * TWO OPPOSITE TRAPS, which look identical in the data and are caught separately:
 *
 *   THE ZERO-LIMIT TRAP — a key no plan grants, enforced anyway. It resolves to `undefined`, which
 *   the resolver reads as 0/false, which denies EVERY tenant on EVERY plan. From outside it is
 *   indistinguishable from correct enforcement: the guard runs, the denial is explainable, the tests
 *   pass, and every paying customer is locked out.
 *
 *   THE HOLLOW CLAIM — a key a plan grants with nothing behind it. The tenant is told they have the
 *   capability, and no route implements it.
 *
 * UNAVAILABLE is how a not-yet-built capability is declared without becoming either one.
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
  isUnavailableFeature,
} from '../../../constants/diaspora/diasporaEntitlements.js';
import { requireFeature, reserveQuotaForFeature, withEntitlement } from '../diasporaEntitlementGuard.js';

/** How a feature key is enforced. */
export const ENFORCEMENT_MODES = Object.freeze({
  BOOLEAN: 'boolean',            // requireFeature only
  BOOLEAN_PLUS_QUOTA: 'boolean+quota', // requireFeature + reserveQuotaForFeature (or withEntitlement)
  QUOTA_ONLY: 'quota',           // the key IS the quota (a cap, not a capability)
  /**
   * The capability does not exist yet, so there is nothing to guard AND nothing may sell it.
   *
   * This is not a softer NOT_ENFORCED. It carries the opposite data invariant: an UNAVAILABLE key
   * must be granted by NO plan, where every other key must be granted by at least one. That pairing
   * is what stops "we haven't built it" from decaying into "a plan promises it and no route checks",
   * which is the failure this registry exists to make impossible.
   */
  UNAVAILABLE: 'unavailable',
});

/**
 * The registry. `site` names the function that carries the guard; `note` records a decision worth
 * explaining (why a gate sits where it does); `reason` is required on an UNAVAILABLE entry.
 *
 * NOT_ENFORCED is deliberately left in ENFORCEMENT_MODES but is no longer usable: a key with no
 * enforcement is either sold (which assertRegistryIntegrity refuses) or granted by no plan (which the
 * zero-limit trap check refuses first). It survives so the failure message can name the mistake, and
 * so the coverage test can construct the mistake and prove the gate fires.
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
    operation: 'Connect a Google Drive account (start authorization / complete the OAuth callback)',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaDriveSyncService.getAuthorizationUrl + diasporaDriveSyncService.handleOAuthCallback',
    note: 'Both halves carry the gate. They are separately reachable routes, so gating only the '
      + 'authorize call would let a caller holding a state string finish the connection anyway.',
  },
  {
    featureKey: FEATURE_KEYS.DRIVE_EXPORT,
    operation: 'Write platform content to Google Drive (upload and export)',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaDriveSyncService.uploadDriveFile (the funnel exportToDrive also calls)',
    note: 'Gated at the funnel, not at exportToDrive. exportToDrive only formats a payload and calls '
      + 'uploadDriveFile, so POST /drive/upload reaches the identical provider write — a gate on the '
      + 'export route alone would be bypassable by choosing the other route.',
  },
  {
    featureKey: FEATURE_KEYS.GRAPH_ADVANCED,
    operation: 'Trade-graph reads: traversal, order path/blockers, demand signals, container opportunities, risk exposure',
    mode: ENFORCEMENT_MODES.BOOLEAN,
    site: 'diasporaTradeGraphRoutes router-level entitlement middleware',
    note: 'One router-level gate rather than nine per-route calls, so a read route added later '
      + 'inherits it. POST /rebuild and GET /dead-letters are exempt: they are platform-admin '
      + 'operational repair/triage, and gating them on the target tenant\'s plan would let a billing '
      + 'decision block fixing a broken projection.',
  },
  {
    featureKey: FEATURE_KEYS.API_ACCESS,
    operation: 'Programmatic API access',
    mode: ENFORCEMENT_MODES.UNAVAILABLE,
    site: null,
    reason: 'No diaspora public/partner API surface exists to gate. The only partner API in the '
      + 'codebase serves vehicle identity/trust and has no diaspora routes. It was previously true on '
      + 'the enterprise plan, which meant the plan sold a capability no route implements — an '
      + 'enterprise tenant reading their own entitlements was told they had an API that does not '
      + 'exist. The claim is withdrawn (false on every plan) rather than enforced against nothing. '
      + 'Restoring it requires building the surface AND wiring the guard, together.',
  },
]);

/** The plans that actually grant a key. Empty means nobody is being sold it. */
export function planGrants(featureKey) {
  return PLAN_KEYS.filter((planKey) => {
    const value = PLAN_CATALOG[planKey].entitlements[featureKey];
    return value === true || (typeof value === 'number' && value > 0);
  });
}

const UNGUARDED_MODES = new Set([ENFORCEMENT_MODES.NOT_ENFORCED, ENFORCEMENT_MODES.UNAVAILABLE]);

/**
 * Integrity check, run at import time.
 *
 * Refuses, in one place, every way the registry could lie:
 *   · a key no plan grants but something enforces (the zero-limit trap — denies everyone);
 *   · a key a plan grants but nothing enforces (the hollow claim — sold and unprotected);
 *   · an UNAVAILABLE declaration that disagrees with UNAVAILABLE_FEATURE_KEYS;
 *   · a canonical feature key that never made it into the registry at all.
 *
 * Takes the operations array so a test can hand it a deliberately broken registry and see it throw —
 * a guard rail nobody has watched fire is a guard rail nobody knows is connected.
 */
export function assertRegistryIntegrity(operations = GATED_OPERATIONS) {
  const known = new Set(Object.values(FEATURE_KEYS));
  const seen = new Set();

  for (const entry of operations) {
    if (!known.has(entry.featureKey)) {
      throw new Error(`Gated-operations registry references an unknown feature key: ${entry.featureKey}`);
    }
    if (seen.has(entry.featureKey)) {
      throw new Error(`Gated-operations registry lists ${entry.featureKey} twice`);
    }
    seen.add(entry.featureKey);

    const granting = planGrants(entry.featureKey);

    if (entry.mode === ENFORCEMENT_MODES.UNAVAILABLE) {
      // The inverse invariant. An unavailable capability that a plan still grants is the hollow claim
      // this mode exists to prevent: the customer is told they have it, and no route implements it.
      if (granting.length > 0) {
        throw new Error(
          `Feature key ${entry.featureKey} is marked UNAVAILABLE but plan(s) ${granting.join(', ')} still `
          + 'grant it. A plan must not advertise a capability that no route implements.',
        );
      }
      // The registry must also agree with the constants module, so the two cannot drift apart.
      if (!isUnavailableFeature(entry.featureKey)) {
        throw new Error(
          `Feature key ${entry.featureKey} is UNAVAILABLE here but absent from UNAVAILABLE_FEATURE_KEYS `
          + 'in diasporaEntitlements.js. The two must be declared together.',
        );
      }
      if (!entry.reason) {
        throw new Error(`Unavailable operation ${entry.featureKey} has no recorded reason`);
      }
      continue;
    }

    if (isUnavailableFeature(entry.featureKey)) {
      throw new Error(
        `Feature key ${entry.featureKey} is listed in UNAVAILABLE_FEATURE_KEYS but the registry gives it `
        + `mode ${entry.mode}. Remove it from one or the other.`,
      );
    }

    // THE zero-limit trap: a key no plan grants denies every tenant on every plan while looking correct.
    if (granting.length === 0) {
      throw new Error(
        `Feature key ${entry.featureKey} is granted by NO plan in PLAN_CATALOG. Enforcing it would deny `
        + 'every tenant on every plan while looking like correct enforcement.',
      );
    }

    if (entry.mode === ENFORCEMENT_MODES.NOT_ENFORCED) {
      if (!entry.reason) {
        throw new Error(`Gated operation ${entry.featureKey} is unenforced with no recorded reason`);
      }
      // A key a plan SELLS and no route guards is the exact defect this program set out to close.
      // Recording a reason for it is no longer sufficient — the reason would be an excuse for
      // charging for something that is not protected.
      throw new Error(
        `Feature key ${entry.featureKey} is sold by plan(s) ${granting.join(', ')} but has no enforcement `
        + 'boundary. Either guard it, or mark it UNAVAILABLE and remove it from every plan.',
      );
    }

    if (!entry.site) {
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
  return GATED_OPERATIONS.filter((e) => !UNGUARDED_MODES.has(e.mode));
}

/** Entries deliberately left unwired, with their reasons. */
export function unenforcedOperations() {
  return GATED_OPERATIONS.filter((e) => e.mode === ENFORCEMENT_MODES.NOT_ENFORCED);
}

/** Entries whose capability does not exist and which therefore no plan may grant. */
export function unavailableOperations() {
  return GATED_OPERATIONS.filter((e) => e.mode === ENFORCEMENT_MODES.UNAVAILABLE);
}

/** Entries at least one plan grants — everything a customer can be charged for. */
export function sellableOperations(operations = GATED_OPERATIONS) {
  return operations.filter((e) => planGrants(e.featureKey).length > 0);
}

/**
 * The one question a coverage report has to answer: is anything SOLD but not GUARDED?
 *
 * Counting enforced-vs-unenforced keys does not answer it. A key can be unenforced and harmless
 * (nothing sells it) or unenforced and serious (four plans sell it). This returns only the second
 * kind, which is the set that must always be empty.
 */
export function sellableWithoutEnforcement(operations = GATED_OPERATIONS) {
  return sellableOperations(operations)
    .filter((e) => UNGUARDED_MODES.has(e.mode))
    .map((e) => ({ featureKey: e.featureKey, operation: e.operation, soldBy: planGrants(e.featureKey) }));
}

export function gatedOperationFor(featureKey) {
  return GATED_OPERATIONS.find((e) => e.featureKey === featureKey) || null;
}

/** Coverage summary for an operator/health surface. */
export function entitlementCoverage() {
  const enforced = enforcedOperations();
  const unenforced = unenforcedOperations();
  const unavailable = unavailableOperations();
  return {
    total: GATED_OPERATIONS.length,
    enforced: enforced.length,
    unenforced: unenforced.length,
    unavailable: unavailable.length,
    sellable: sellableOperations().length,
    meteredKeys: [...METERED_FEATURE_KEYS],
    gaps: unenforced.map((e) => ({ featureKey: e.featureKey, operation: e.operation, reason: e.reason })),
    withdrawn: unavailable.map((e) => ({ featureKey: e.featureKey, operation: e.operation, reason: e.reason })),
    soldWithoutEnforcement: sellableWithoutEnforcement(),
    lowestPlanGranting: Object.fromEntries(
      GATED_OPERATIONS.map((e) => [e.featureKey, lowestPlanGranting(e.featureKey)]),
    ),
  };
}

// Re-exported so a call site has ONE import for enforcement and cannot reach for the raw usage service
// by accident. reserveUsage is deliberately not re-exported.
export { requireFeature, reserveQuotaForFeature, withEntitlement };
