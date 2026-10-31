/**
 * CARUP-PAY-02 — Unified Commercial Service Payments, Governance, Orchestration & Reporting Service (R1)
 * Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
 *
 * Key R1 invariants:
 * - Reconciles the 66 source catalogue definitions with persisted PostgreSQL `pay02_commercial_products`
 *   and `pay02_commercial_product_versions`.
 * - Separates non-authoritative quote preview (`previewPay02Quote`) from durable persisted quote
 *   issuance (`createAndPersistPay02Quote`), failing closed when persistence or source-object
 *   verification is unavailable.
 * - Eliminates all fabricated governance proposal fallbacks; proposals and reviews persist atomically
 *   in PostgreSQL and advance product version history upon approval.
 * - Separates simulated financial reporting (`SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING`)
 *   from authoritative database reconciliation (`reconcilePay02OperationalFinancialTruth`).
 * - Enforces full bidirectional database cross-reference verification and vehicle/provenance validation
 *   for the first real product candidate (`intel.report.vehicle_history_single`).
 */
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { assembleReport, generateReportVersion } from '../report/reportService.js';
import {
  PAY02_CATALOGUE,
  PAY02_CATEGORIES,
  PAY02_FAMILIES,
  PAY02_ACTIVATION_STATES,
  PAY02_CURRENCY_SCALES,
  PAY02_REPORT_ISSUANCE_POLICY,
  getPay02CatalogueItem,
} from './pay02CatalogueDefinitions.js';
import {
  Pay02Error,
  PAY02_PROVIDER_PROFILES,
  PAY02_PLATFORM_FEE_PRODUCTS,
  PAY02_ELIGIBLE_QUOTE_STATES,
  PAY02_STRUCTURED_APPROVAL_EVIDENCE_PATTERN,
  requirePay02NonProduction,
  assertMinorUnitAmount,
  validateCatalogueEntry,
  evaluatePay02ProviderRoute,
  buildServerAuthorizedQuote,
  decomposeImportOrderObligations,
} from './pay02Contract.js';

export function requirePay02Enabled(env = process.env) {
  requirePay02NonProduction(env);
  if (env.CARUP_PAY02_ENABLED === 'false') {
    throw new Pay02Error('PAY02_FOUNDATION_DISABLED', 404);
  }
  return true;
}

/**
 * Maps a persisted `public.pay02_commercial_products` row to the canonical PAY-02 product contract.
 */
export function mapDbProductRowToCatalogueContract(dbRow, fallbackSourceItem = null) {
  if (!dbRow) return fallbackSourceItem;
  const base = fallbackSourceItem || getPay02CatalogueItem(dbRow.product_code) || {};
  return Object.freeze({
    ...base,
    productCode: dbRow.product_code,
    version: Number(dbRow.current_version ?? base.version ?? 1),
    family: dbRow.family ?? base.family,
    title: dbRow.title ?? base.title,
    commercialEvent: dbRow.commercial_event ?? base.commercialEvent,
    commercialCategory: dbRow.commercial_category ?? base.commercialCategory,
    owningSubsystem: dbRow.owning_subsystem ?? base.owningSubsystem,
    sourceObjectType: dbRow.source_object_type ?? base.sourceObjectType,
    payerRole: dbRow.payer_role ?? base.payerRole,
    contractualSeller: dbRow.contractual_seller ?? base.contractualSeller ?? null,
    legalBeneficiary: dbRow.legal_beneficiary ?? base.legalBeneficiary ?? null,
    merchantOfRecord: dbRow.merchant_of_record ?? base.merchantOfRecord ?? null,
    fundsOwner: dbRow.funds_owner ?? base.fundsOwner ?? null,
    revenueBeneficiary: dbRow.revenue_beneficiary ?? base.revenueBeneficiary ?? null,
    jurisdiction: dbRow.jurisdiction ?? base.jurisdiction,
    permittedCurrencies: Array.isArray(dbRow.permitted_currencies)
      ? dbRow.permitted_currencies
      : base.permittedCurrencies || [],
    priceAuthorityType: dbRow.price_authority_type ?? base.priceAuthorityType,
    approvedAmountMinor:
      dbRow.approved_amount_minor !== null && dbRow.approved_amount_minor !== undefined
        ? Number(dbRow.approved_amount_minor)
        : null,
    approvedCurrency: dbRow.approved_currency ?? null,
    currencyScale:
      dbRow.currency_scale !== null && dbRow.currency_scale !== undefined
        ? Number(dbRow.currency_scale)
        : base.currencyScale ?? null,
    taxPolicyRef: dbRow.tax_policy_ref ?? base.taxPolicyRef ?? null,
    commissionPolicyRef: dbRow.commission_policy_ref ?? base.commissionPolicyRef ?? null,
    refundPolicy: dbRow.refund_policy ?? base.refundPolicy,
    eligibleProviders: Array.isArray(dbRow.eligible_providers)
      ? dbRow.eligible_providers
      : base.eligibleProviders || [],
    prohibitedProviders: Array.isArray(dbRow.prohibited_providers)
      ? dbRow.prohibited_providers
      : base.prohibitedProviders || [],
    requiredCapabilities: Array.isArray(dbRow.required_capabilities)
      ? dbRow.required_capabilities
      : base.requiredCapabilities || [],
    fulfillmentContract: dbRow.fulfillment_contract ?? base.fulfillmentContract,
    mobileChannelPolicy: dbRow.mobile_channel_policy ?? base.mobileChannelPolicy,
    checkoutProhibited: Boolean(dbRow.checkout_prohibited ?? base.checkoutProhibited),
    activationState: dbRow.activation_state ?? base.activationState,
    certificationState: dbRow.certification_state ?? base.certificationState,
    blockerClass: dbRow.blocker_class ?? base.blockerClass ?? null,
    blockerReason: dbRow.blocker_reason ?? base.blockerReason ?? null,
    approvalEvidenceRef: dbRow.approval_evidence_ref ?? base.approvalEvidenceRef ?? null,
    approvedBy: dbRow.approved_by ?? base.approvedBy ?? null,
    approvedAt: dbRow.approved_at ?? null,
  });
}

/**
 * Projects catalogue summary and rows with optional filtering and optional PostgreSQL persistence reconciliation (R1-A).
 */
export function listPay02Catalogue({
  family = null,
  commercialCategory = null,
  activationState = null,
  certificationState = null,
  persistedRows = null,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);

  const persistedByCode = new Map();
  if (Array.isArray(persistedRows)) {
    for (const row of persistedRows) {
      if (row?.product_code) persistedByCode.set(row.product_code, row);
    }
  }

  let rows = PAY02_CATALOGUE.map((sourceItem) => {
    const dbRow = persistedByCode.get(sourceItem.productCode);
    const effective = dbRow
      ? mapDbProductRowToCatalogueContract(dbRow, sourceItem)
      : sourceItem;
    let persistenceStatus = 'source_manifest_only';
    if (dbRow) {
      persistenceStatus =
        Number(dbRow.current_version) > Number(sourceItem.version)
          ? 'version_advanced_in_db'
          : 'persisted_in_sync';
    }
    return {
      ...effective,
      sourceVersion: sourceItem.version,
      persistenceStatus,
      persistenceOrigin: dbRow ? 'database_reconciled' : 'source_manifest',
      persistedInDatabase: Boolean(dbRow),
    };
  });

  if (family) {
    if (!PAY02_FAMILIES.includes(family)) {
      throw new Pay02Error('PAY02_INVALID_FAMILY_FILTER', 400, { family });
    }
    rows = rows.filter((r) => r.family === family);
  }
  if (commercialCategory) {
    if (!Object.values(PAY02_CATEGORIES).includes(commercialCategory)) {
      throw new Pay02Error('PAY02_INVALID_CATEGORY_FILTER', 400, { commercialCategory });
    }
    rows = rows.filter((r) => r.commercialCategory === commercialCategory);
  }
  if (activationState) {
    if (!PAY02_ACTIVATION_STATES.includes(activationState)) {
      throw new Pay02Error('PAY02_INVALID_ACTIVATION_STATE_FILTER', 400, { activationState });
    }
    rows = rows.filter((r) => r.activationState === activationState);
  }
  if (certificationState) {
    rows = rows.filter((r) => r.certificationState === certificationState);
  }

  const enriched = rows.map((item) => {
    const validation = validateCatalogueEntry(item);
    return {
      ...item,
      validation,
    };
  });

  const summary = {
    totalProducts: PAY02_CATALOGUE.length,
    filteredCount: enriched.length,
    persistedDatabaseCount: Array.isArray(persistedRows) ? persistedByCode.size : 0,
    persistenceStatus: Array.isArray(persistedRows) ? 'database_reconciled' : 'source_manifest_projection',
    catalogueSynchronized: Array.isArray(persistedRows)
      ? persistedByCode.size === PAY02_CATALOGUE.length
      : null,
    authorityModel: Array.isArray(persistedRows)
      ? 'database_and_source_reconciled'
      : 'source_manifest_projection',
    byCategory: {
      [PAY02_CATEGORIES.FIRST_PARTY]: PAY02_CATALOGUE.filter(
        (r) => r.commercialCategory === PAY02_CATEGORIES.FIRST_PARTY,
      ).length,
      [PAY02_CATEGORIES.THIRD_PARTY]: PAY02_CATALOGUE.filter(
        (r) => r.commercialCategory === PAY02_CATEGORIES.THIRD_PARTY,
      ).length,
      [PAY02_CATEGORIES.CORPORATE_TREASURY]: PAY02_CATALOGUE.filter(
        (r) => r.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY,
      ).length,
    },
    byActivationState: Object.fromEntries(
      PAY02_ACTIVATION_STATES.map((state) => [
        state,
        PAY02_CATALOGUE.filter((r) => r.activationState === state).length,
      ]),
    ),
    liveActiveCount: PAY02_CATALOGUE.filter((r) =>
      ['release_approved', 'active'].includes(r.activationState),
    ).length,
    pilotCandidateCode: 'intel.report.vehicle_history_single',
  };

  return {
    summary,
    products: enriched,
    providers: Object.values(PAY02_PROVIDER_PROFILES),
    reportIssuancePolicy: PAY02_REPORT_ISSUANCE_POLICY,
  };
}

/**
 * Loads catalogue with optional persisted DB rows, version history, and pending proposals when a DB client is available.
 */
export async function loadPay02CatalogueWithPersistence({
  family = null,
  commercialCategory = null,
  activationState = null,
  certificationState = null,
  db = null,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  let persistedRows = null;
  let proposals = [];
  if (db && typeof db.from === 'function') {
    const { data: prodRows, error: prodErr } = await db
      .from('pay02_commercial_products')
      .select('*');
    if (!prodErr && Array.isArray(prodRows)) {
      persistedRows = prodRows;
    }
    const { data: propRows, error: propErr } = await db
      .from('pay02_activation_proposals')
      .select('*');
    if (!propErr && Array.isArray(propRows)) {
      proposals = propRows;
    }
  }
  const base = listPay02Catalogue({
    family,
    commercialCategory,
    activationState,
    certificationState,
    persistedRows,
    env,
  });
  return {
    ...base,
    proposals,
  };
}

/**
 * Loads a single product's effective definition, persisted database row, and append-only version history (R1-A & R1-F).
 */
export async function getPay02ProductDetailWithHistory({
  productCode,
  db = null,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  const sourceItem = getPay02CatalogueItem(productCode);
  if (!sourceItem) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
  }

  let dbProductRow = null;
  let versionHistory = [];
  let proposals = [];

  if (db && typeof db.from === 'function') {
    const { data: pRow, error: pErr } = await db
      .from('pay02_commercial_products')
      .select('*')
      .eq('product_code', productCode)
      .maybeSingle();
    if (pErr) {
      throw new Pay02Error('PAY02_CATALOGUE_PERSISTENCE_READ_FAILED', 503);
    }
    dbProductRow = pRow || null;

    const { data: vRows, error: vErr } = await db
      .from('pay02_commercial_product_versions')
      .select('*')
      .eq('product_code', productCode);
    if (vErr) {
      throw new Pay02Error('PAY02_VERSION_HISTORY_READ_FAILED', 503);
    }
    versionHistory = Array.isArray(vRows) ? vRows : [];

    const { data: propRows, error: propErr } = await db
      .from('pay02_activation_proposals')
      .select('*')
      .eq('product_code', productCode);
    if (!propErr && Array.isArray(propRows)) {
      proposals = propRows;
    }
  }

  const effective = dbProductRow
    ? mapDbProductRowToCatalogueContract(dbProductRow, sourceItem)
    : sourceItem;

  return {
    product: {
      ...effective,
      sourceVersion: sourceItem.version,
      persistedInDatabase: Boolean(dbProductRow),
      persistenceStatus: dbProductRow
        ? Number(dbProductRow.current_version) > Number(sourceItem.version)
          ? 'version_advanced_in_db'
          : 'persisted_in_sync'
        : 'source_manifest_only',
      validation: validateCatalogueEntry(effective),
    },
    persistenceStatus: dbProductRow ? 'database_reconciled' : 'source_manifest_only',
    versions: versionHistory,
    versionHistory,
    proposals,
  };
}

/**
 * Submits a governed commercial pricing or activation state proposal (Phase 2, Section 9 & R1-C).
 * Fails closed when database persistence is unavailable — never fabricates a proposal ID!
 */
export async function createPay02GovernanceProposal({
  actorId,
  actorRole,
  productCode,
  proposedState,
  proposedAmountMinor = null,
  proposedCurrency = null,
  approvalEvidenceRef = null,
  rationale,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
    throw new Pay02Error('PAY02_GOVERNANCE_AUTH_REQUIRED', 401);
  }
  if (!['admin', 'owner', 'finance_admin'].includes(String(actorRole || '').toLowerCase())) {
    throw new Pay02Error('PAY02_GOVERNANCE_ROLE_FORBIDDEN', 403);
  }
  if (!db || typeof db.from !== 'function') {
    throw new Pay02Error('PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE', 503);
  }

  const sourceProduct = getPay02CatalogueItem(productCode);
  if (!sourceProduct) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
  }

  // Read operational product row if present in DB so proposal binds to current effective version
  let effectiveProduct = sourceProduct;
  const { data: persistedProd, error: prodReadErr } = await db
    .from('pay02_commercial_products')
    .select('*')
    .eq('product_code', productCode)
    .maybeSingle();
  if (prodReadErr) {
    throw new Pay02Error('PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE', 503);
  }
  if (persistedProd) {
    effectiveProduct = mapDbProductRowToCatalogueContract(persistedProd, sourceProduct);
  }

  if (!PAY02_ACTIVATION_STATES.includes(proposedState)) {
    throw new Pay02Error('PAY02_INVALID_PROPOSED_STATE', 400, { proposedState });
  }
  if (['release_approved', 'active'].includes(proposedState)) {
    throw new Pay02Error('PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY', 403, {
      productCode,
      proposedState,
      message: 'PAY-02 does not authorize live commercial release or production activation.',
    });
  }
  if (
    effectiveProduct.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY
    && !['blocked', 'draft'].includes(proposedState)
  ) {
    throw new Pay02Error('PAY02_CATEGORY_C_ACTIVATION_FORBIDDEN', 403, { productCode });
  }
  if (typeof rationale !== 'string' || rationale.trim().length < 10) {
    throw new Pay02Error('PAY02_PROPOSAL_RATIONALE_REQUIRED', 400);
  }

  const resolvedEvidenceRef = approvalEvidenceRef
    ? String(approvalEvidenceRef).trim()
    : effectiveProduct.approvalEvidenceRef;

  if (PAY02_ELIGIBLE_QUOTE_STATES.has(proposedState)) {
    if (
      !resolvedEvidenceRef
      || !PAY02_STRUCTURED_APPROVAL_EVIDENCE_PATTERN.test(String(resolvedEvidenceRef))
    ) {
      throw new Pay02Error('PAY02_STRUCTURED_APPROVAL_EVIDENCE_REQUIRED', 400, {
        productCode,
        proposedState,
        expectedPattern: String(PAY02_STRUCTURED_APPROVAL_EVIDENCE_PATTERN),
      });
    }
  }

  let validatedPrice = null;
  if (proposedAmountMinor !== null && proposedAmountMinor !== undefined) {
    validatedPrice = assertMinorUnitAmount(
      proposedAmountMinor,
      proposedCurrency || effectiveProduct.approvedCurrency || 'JPY',
    );
  }

  const candidateAfterProposal = {
    ...effectiveProduct,
    activationState: proposedState,
    approvedAmountMinor: validatedPrice ? validatedPrice.amountMinor : effectiveProduct.approvedAmountMinor,
    approvedCurrency: validatedPrice ? validatedPrice.currency : effectiveProduct.approvedCurrency,
    approvalEvidenceRef: resolvedEvidenceRef,
    approvedBy: actorId.trim(),
    priceAuthorityType:
      validatedPrice && effectiveProduct.priceAuthorityType === 'unapproved_missing'
        ? 'fixed_catalogue'
        : effectiveProduct.priceAuthorityType,
  };
  const completeness = validateCatalogueEntry(candidateAfterProposal);
  if (!completeness.valid) {
    throw new Pay02Error('PAY02_PROPOSAL_FAILS_COMPLETENESS_GATE', 409, {
      productCode,
      proposedState,
      missingFields: completeness.errors,
    });
  }

  const payload = {
    product_code: effectiveProduct.productCode,
    product_version: effectiveProduct.version,
    from_state: effectiveProduct.activationState,
    proposed_state: proposedState,
    proposed_amount_minor: validatedPrice ? validatedPrice.amountMinor : null,
    proposed_currency: validatedPrice ? validatedPrice.currency : null,
    approval_evidence_ref: resolvedEvidenceRef,
    rationale: rationale.trim(),
    proposer_id: actorId.trim(),
    proposer_role: String(actorRole).toLowerCase(),
    status: 'pending_review',
    effect_status: 'pending_review',
  };

  const { data, error } = await db
    .from('pay02_activation_proposals')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error || !data || !data.id) {
    throw new Pay02Error('PAY02_PROPOSAL_PERSISTENCE_FAILED', 503, {
      code: error?.code || 'NO_PERSISTED_ROW',
    });
  }

  return {
    proposal: data,
    effectiveCatalogueChanged: false,
    liveCommercialActive: false,
  };
}

/**
 * Reviews a governance proposal (R1-C).
 * Enforces separation of duties (`proposer_id <> reviewer_id`), prevents double review or approving
 * a rejected proposal, prevents stale version overwrites, and atomically advances `pay02_commercial_products`
 * + `pay02_commercial_product_versions` when approved.
 */
export async function reviewPay02GovernanceProposal({
  proposalId,
  reviewerId,
  reviewerRole,
  decision,
  reviewNotes,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  if (!reviewerId || typeof reviewerId !== 'string' || !reviewerId.trim()) {
    throw new Pay02Error('PAY02_GOVERNANCE_AUTH_REQUIRED', 401);
  }
  if (!['admin', 'owner'].includes(String(reviewerRole || '').toLowerCase())) {
    throw new Pay02Error('PAY02_GOVERNANCE_REVIEW_ROLE_FORBIDDEN', 403);
  }
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Pay02Error('PAY02_INVALID_REVIEW_DECISION', 400);
  }
  if (!db) {
    throw new Pay02Error('PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE', 503);
  }

  // Operational governance review requires atomic PostgreSQL SECURITY DEFINER RPC (Section 7.1).
  if (typeof db.rpc !== 'function') {
    throw new Pay02Error('PAY02_ATOMIC_GOVERNANCE_RPC_REQUIRED', 503, {
      message: 'Operational governance review requires atomic PostgreSQL RPC pay02_review_activation_proposal.',
    });
  }

  const { data, error } = await db.rpc('pay02_review_activation_proposal', {
    p_proposal_id: proposalId,
    p_reviewer_id: reviewerId.trim(),
    p_reviewer_role: String(reviewerRole).toLowerCase(),
    p_decision: decision,
    p_review_notes: reviewNotes ? String(reviewNotes).trim() : null,
  });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('PAY02_SELF_APPROVAL_FORBIDDEN')) {
      throw new Pay02Error('PAY02_SELF_APPROVAL_FORBIDDEN', 403);
    }
    if (msg.includes('PAY02_PROPOSAL_ALREADY_DECIDED')) {
      throw new Pay02Error('PAY02_PROPOSAL_ALREADY_DECIDED', 409);
    }
    if (msg.includes('PAY02_STALE_PROPOSAL_VERSION_CONFLICT')) {
      throw new Pay02Error('PAY02_STALE_PROPOSAL_VERSION_CONFLICT', 409);
    }
    if (msg.includes('PAY02_PROPOSAL_NOT_FOUND')) {
      throw new Pay02Error('PAY02_PROPOSAL_NOT_FOUND', 404);
    }
    if (msg.includes('PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY')) {
      throw new Pay02Error('PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY', 403);
    }
    if (msg.includes('PAY02_STRUCTURED_APPROVAL_EVIDENCE_REQUIRED')) {
      throw new Pay02Error('PAY02_STRUCTURED_APPROVAL_EVIDENCE_REQUIRED', 400);
    }
    throw new Pay02Error('PAY02_PROPOSAL_REVIEW_FAILED', 503, { message: msg });
  }
  if (!data || !data.id) {
    throw new Pay02Error('PAY02_PROPOSAL_REVIEW_FAILED', 503);
  }
  return {
    proposal: data,
    effectiveCatalogueChanged: decision === 'approved',
    liveCommercialActive: false,
  };
}

/**
 * Verifies that the requested source business object exists in the authoritative database table
 * and belongs to the appropriate business authority before a commercial quote can be issued (R1-B Section 5.3).
 */
export async function verifyPay02SourceObjectAuthority({
  db,
  product,
  sourceObjectType,
  sourceObjectId,
  payerId,
} = {}) {
  if (!db || typeof db.from !== 'function') {
    throw new Pay02Error('PAY02_SOURCE_AUTHORITY_DB_REQUIRED', 503);
  }
  if (!product || sourceObjectType !== product.sourceObjectType) {
    throw new Pay02Error('PAY02_SOURCE_OBJECT_TYPE_MISMATCH', 400, {
      expectedSourceObjectType: product?.sourceObjectType,
      receivedSourceObjectType: sourceObjectType,
    });
  }
  const cleanId = typeof sourceObjectId === 'string' ? sourceObjectId.trim() : '';
  if (!cleanId || !/^[A-Za-z0-9_-]{3,64}$/.test(cleanId)) {
    throw new Pay02Error('PAY02_SOURCE_OBJECT_INVALID', 400, { sourceObjectId });
  }

  // First real product (`intel.report.vehicle_history_single`): source object is a real vehicle in `public.vehicles`
  if (product.productCode === 'intel.report.vehicle_history_single') {
    if (cleanId.startsWith('rep_ver_') || sourceObjectType === 'vehicle_report_versions') {
      throw new Pay02Error('PAY02_OUTPUT_REPORT_VERSION_CANNOT_BE_PRE_PURCHASE_SOURCE', 400, {
        message: 'Pre-purchase quote must reference the canonical vehicle/VIN in public.vehicles, not a post-payment report version.',
      });
    }
    const { data: byVin, error: vinErr } = await db
      .from('vehicles')
      .select('*')
      .eq('vin', cleanId)
      .maybeSingle();
    if (vinErr) {
      throw new Pay02Error('PAY02_SOURCE_VEHICLE_LOOKUP_FAILED', 503);
    }
    let vehicleRow = byVin;
    if (!vehicleRow) {
      const { data: byId, error: idErr } = await db
        .from('vehicles')
        .select('*')
        .eq('id', cleanId)
        .maybeSingle();
      if (idErr) {
        throw new Pay02Error('PAY02_SOURCE_VEHICLE_LOOKUP_FAILED', 503);
      }
      vehicleRow = byId;
    }
    if (!vehicleRow || !vehicleRow.vin) {
      throw new Pay02Error('PAY02_SOURCE_VEHICLE_NOT_FOUND', 404, {
        sourceObjectId: cleanId,
        message: 'No eligible vehicle record exists in public.vehicles for the requested identifier.',
      });
    }
    return {
      verified: true,
      canonicalSourceId: String(vehicleRow.vin),
      vehicleId: String(vehicleRow.id ?? vehicleRow.vin),
      vin: String(vehicleRow.vin),
      vehicle: vehicleRow,
    };
  }

  // Demo sandbox report (`intel.report.demo_sandbox`) uses pay01c_demo_orders
  if (product.productCode === 'intel.report.demo_sandbox') {
    const { data: demoOrder, error: demoErr } = await db
      .from('pay01c_demo_orders')
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();
    if (demoErr) throw new Pay02Error('PAY02_SOURCE_OBJECT_LOOKUP_FAILED', 503);
    if (!demoOrder || demoOrder.buyer_id !== payerId) {
      throw new Pay02Error('PAY02_SOURCE_OBJECT_NOT_FOUND_OR_FORBIDDEN', 404);
    }
    return {
      verified: true,
      canonicalSourceId: String(demoOrder.id),
    };
  }

  return {
    verified: true,
    canonicalSourceId: cleanId,
  };
}

/**
 * Explicitly non-authoritative quote calculation preview (R1-B Section 5.2).
 * Never initiates payment and is visibly labelled non-authoritative.
 */
export function previewPay02Quote({
  productCode,
  payerId,
  payerRole = 'buyer',
  sourceObjectType,
  sourceObjectId,
  currency = null,
  providerKey = null,
  idempotencyKey = 'pay02_preview_only_non_authoritative',
  clientSubmittedAmount = undefined,
  clientSubmittedCurrency = undefined,
  clientSubmittedMerchant = undefined,
  clientSubmittedBeneficiary = undefined,
  fxTargetCurrency = undefined,
  now = new Date(),
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  const preview = buildServerAuthorizedQuote({
    productCode,
    payerId,
    payerRole,
    sourceObjectType,
    sourceObjectId,
    currency,
    providerKey,
    idempotencyKey,
    clientSubmittedAmount,
    clientSubmittedCurrency,
    clientSubmittedMerchant,
    clientSubmittedBeneficiary,
    fxTargetCurrency,
    now,
    env,
  });

  return Object.freeze({
    ...preview,
    id: null,
    status: 'preview_only',
    mode: 'preview_only',
    authoritative: false,
    persisted: false,
    checkoutEligible: false,
    authorityWarning: 'PREVIEW ONLY — NO FINANCIAL COMMITMENT OR CHECKOUT AUTHORITY',
  });
}

/**
 * Issues and atomically persists an immutable server-authorized commercial quote (R1-B Sections 5.1-5.4).
 * Fails closed if database persistence or source-object verification is unavailable!
 * Never falls back from issued mode to preview mode.
 */
export async function createAndPersistPay02Quote({
  productCode,
  payerId,
  payerRole = 'buyer',
  sourceObjectType,
  sourceObjectId,
  currency = null,
  providerKey = null,
  idempotencyKey,
  clientSubmittedAmount = undefined,
  clientSubmittedCurrency = undefined,
  clientSubmittedMerchant = undefined,
  clientSubmittedBeneficiary = undefined,
  fxTargetCurrency = undefined,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);

  if (!db || typeof db.rpc !== 'function' || typeof db.from !== 'function') {
    throw new Pay02Error('PAY02_QUOTE_PERSISTENCE_REQUIRED', 503, {
      message: 'Every customer-issued commercial quote requires authoritative database persistence.',
    });
  }

  const baseProduct = getPay02CatalogueItem(productCode);
  if (!baseProduct) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
  }

  // Load operational product authority from DB if present so version/state changes are enforced
  let effectiveProductOverride = null;
  const { data: dbProductRow, error: prodErr } = await db
    .from('pay02_commercial_products')
    .select('*')
    .eq('product_code', productCode)
    .maybeSingle();
  if (prodErr) {
    throw new Pay02Error('PAY02_CATALOGUE_PERSISTENCE_READ_FAILED', 503);
  }
  if (dbProductRow) {
    effectiveProductOverride = mapDbProductRowToCatalogueContract(dbProductRow, baseProduct);
  }
  const effectiveProduct = effectiveProductOverride || baseProduct;

  // Validate client inputs & pricing rules before hitting source lookup if client tampered with prices/parties
  const quoteDraft = buildServerAuthorizedQuote({
    productCode,
    payerId,
    payerRole,
    sourceObjectType,
    sourceObjectId,
    currency,
    providerKey,
    idempotencyKey,
    effectiveProductOverride,
    clientSubmittedAmount,
    clientSubmittedCurrency,
    clientSubmittedMerchant,
    clientSubmittedBeneficiary,
    fxTargetCurrency,
    env,
  });

  // Verify that the source business object exists in the authoritative database table
  const verifiedSource = await verifyPay02SourceObjectAuthority({
    db,
    product: effectiveProduct,
    sourceObjectType: quoteDraft.sourceObjectType,
    sourceObjectId: quoteDraft.sourceObjectId,
    payerId: quoteDraft.payerId,
  });

  const finalQuote = buildServerAuthorizedQuote({
    productCode,
    payerId,
    payerRole,
    sourceObjectType,
    sourceObjectId: verifiedSource.canonicalSourceId,
    currency,
    providerKey,
    idempotencyKey,
    effectiveProductOverride,
    env,
  });

  const { data, error } = await db.rpc('pay02_issue_commercial_quote', {
    p_quote_number: finalQuote.quoteNumber,
    p_product_code: finalQuote.productCode,
    p_product_version: finalQuote.productVersion,
    p_payer_id: finalQuote.payerId,
    p_payer_role: finalQuote.payerRole,
    p_source_object_type: finalQuote.sourceObjectType,
    p_source_object_id: finalQuote.sourceObjectId,
    p_currency: finalQuote.currency,
    p_currency_scale: finalQuote.currencyScale,
    p_total_minor: finalQuote.totalMinor,
    p_selected_provider: finalQuote.selectedProvider,
    p_idempotency_key: finalQuote.idempotencyKey,
  });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('PAY02_QUOTE_IDEMPOTENCY_CONFLICT')) {
      throw new Pay02Error('PAY02_QUOTE_IDEMPOTENCY_CONFLICT', 409, { message: msg });
    }
    if (msg.includes('PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE')) {
      throw new Pay02Error('PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE', 409, { message: msg });
    }
    if (msg.includes('PAY02_QUOTE_AUTHORITY_MISMATCH')) {
      throw new Pay02Error('PAY02_QUOTE_AUTHORITY_MISMATCH', 409, { message: msg });
    }
    throw new Pay02Error('PAY02_QUOTE_RPC_REJECTED', 409, { message: msg });
  }

  if (!data || !data.id) {
    throw new Pay02Error('PAY02_QUOTE_PERSISTENCE_FAILED', 503, {
      message: 'Database did not return a persisted commercial quote identifier.',
    });
  }

  return Object.freeze({
    ...finalQuote,
    id: data.id,
    quoteId: data.id,
    quoteNumber: data.quote_number || finalQuote.quoteNumber,
    productVersion: Number(data.product_version ?? finalQuote.productVersion),
    status: data.status || finalQuote.status,
    expiresAt: data.expires_at || finalQuote.expiresAt,
    paymentReference: data.payment_reference || null,
    idempotentReplay: Boolean(data.idempotent_replay),
    mode: 'issued_authoritative',
    authoritative: true,
    persisted: true,
    checkoutEligible: (data.status || finalQuote.status) === 'issued',
    verifiedSourceObject: {
      sourceObjectType: finalQuote.sourceObjectType,
      sourceObjectId: finalQuote.sourceObjectId,
      ...(verifiedSource.vin ? { vin: verifiedSource.vin, vehicleId: verifiedSource.vehicleId } : {}),
    },
  });
}

/**
 * Evaluates financial reporting truth and reconciliation across canonical `payment_transactions`,
 * commercial quotes, multi-party obligations, and off-platform garage external payment declarations
 * (Phase 8, Sections 32-33 & R1-D Section 7).
 */
export function computePay02FinancialTruthReport({
  canonicalPayments = [],
  quotes = [],
  externalGarageDeclarations = [],
  pilotEntitlements = [],
  AttemptCrossCurrencySum = false,
  reportingMode = 'SIMULATED_INPUT',
} = {}) {
  if (AttemptCrossCurrencySum === true) {
    throw new Pay02Error('PAY02_UNAPPROVED_CROSS_CURRENCY_SUM_REFUSED', 409, {
      message: 'Financial reporting must remain bucketed by canonical currency unless an approved FX conversion contract is supplied.',
    });
  }

  const isSimulated = reportingMode !== 'AUTHORITATIVE_DATABASE_RECONCILIATION';
  const byCurrency = {};
  const exceptions = [];

  function ensureBucket(currency) {
    const code = String(currency || 'UNKNOWN').toUpperCase();
    const expectedScale = Object.prototype.hasOwnProperty.call(PAY02_CURRENCY_SCALES, code)
      ? PAY02_CURRENCY_SCALES[code]
      : null;
    if (!byCurrency[code]) {
      byCurrency[code] = {
        currency: code,
        currencyScale: expectedScale,
        quotedObligationsMinor: 0,
        grossChargedPendingMinor: 0,
        providerInitiatedPendingMinor: 0,
        providerConfirmedCollectionMinor: 0,
        providerConfirmedGrossMinor: 0,
        taxIncludedMinor: 0,
        taxSeparatelyChargedMinor: 0,
        unverifiedTaxTreatmentCount: 0,
        carUpRecognizedRevenueMinor: 0,
        carUpEarnedRevenueMinor: 0,
        carUpDeferredCustomerLiabilityMinor: 0,
        platformServiceFeeMinor: 0,
        thirdPartyPayableMinor: 0,
        thirdPartyCustodialOrPassThroughMinor: 0,
        refundPendingMinor: 0,
        refundedMinor: 0,
        disputedMinor: 0,
        providerSettledMinor: 0,
        bankSettledMinor: 0,
        settledMinor: 0,
        unsettledProviderConfirmedMinor: 0,
        externalOffPlatformDeclaredMinor: 0,
      };
    }
    return byCurrency[code];
  }

  const quotesById = new Map();
  const quotesByPaymentRef = new Map();
  for (const quote of quotes) {
    const qId = quote.id || quote.quoteId || quote.quote_number || quote.quoteNumber;
    if (qId) quotesById.set(qId, quote);
    const payRef = quote.payment_reference || quote.paymentReference;
    if (payRef) quotesByPaymentRef.set(payRef, quote);

    const code = String(quote.currency || 'UNKNOWN').toUpperCase();
    const expectedScale = PAY02_CURRENCY_SCALES[code];
    const providedScale = quote.currency_scale ?? quote.currencyScale;
    if (
      expectedScale !== undefined
      && providedScale !== undefined
      && providedScale !== null
      && Number(providedScale) !== expectedScale
    ) {
      exceptions.push({
        type: 'invalid_currency_scale_for_currency',
        reference: qId || 'unknown_quote',
        severity: 'high',
        detail: `Quote ${qId} specifies currency_scale=${providedScale} for ${code} (expected ${expectedScale}).`,
      });
    }

    const bucket = ensureBucket(code);
    const amount = Number(quote.total_minor ?? quote.totalMinor ?? 0);
    bucket.quotedObligationsMinor += amount;
  }

  for (const ext of externalGarageDeclarations) {
    if (ext.claimProviderVerified === true || ext.gateway === 'stripe_carup_japan_sandbox') {
      exceptions.push({
        type: 'external_garage_receipt_misclassified_as_provider_verified',
        reference: ext.id || ext.receiptNumber || 'unknown',
        severity: 'critical',
        detail: 'garage_recorded_external declarations are off-platform garage statements and cannot be marked provider-verified.',
      });
      continue;
    }
    const bucket = ensureBucket(ext.currency || 'USD');
    bucket.externalOffPlatformDeclaredMinor += Number(ext.amountMinor ?? ext.amount_minor ?? 0);
  }

  // Index entitlements by payment reference so we can distinguish recognized revenue vs deferred customer liability
  const activeEntitlementByPaymentRef = new Map();
  for (const ent of pilotEntitlements) {
    const ref = ent.payment_reference || ent.paymentReference;
    const isActive =
      (ent.entitlement_status === 'entitled' || Boolean(ent.granted_at || ent.grantedAt))
      && ent.entitlement_status !== 'revoked_refunded'
      && ent.entitlement_status !== 'refund_suspended'
      && !Boolean(ent.revoked_at || ent.revokedAt);
    if (ref && isActive) {
      activeEntitlementByPaymentRef.set(ref, ent);
    }
  }

  const paymentByRef = new Map();
  for (const payment of canonicalPayments) {
    if (paymentByRef.has(payment.reference)) {
      exceptions.push({
        type: 'duplicate_canonical_payment_reference',
        reference: payment.reference,
        severity: 'critical',
        detail: 'Duplicate reference detected in payment_transactions projection.',
      });
      continue;
    }
    paymentByRef.set(payment.reference, payment);

    const code = String(payment.currency || 'UNKNOWN').toUpperCase();
    const bucket = ensureBucket(code);
    const amount = Number(payment.amount_minor ?? payment.amount ?? 0);
    const category = payment.pay02_commercial_category || PAY02_CATEGORIES.FIRST_PARTY;
    const productCode = payment.pay02_product_code || null;
    const settlement = payment.pay02_settlement_status || 'unsettled';
    const providerSettlementRef = payment.pay02_provider_settlement_ref || payment.providerSettlementRef || null;
    const bankSettlementRef = payment.pay02_bank_settlement_ref || payment.bankSettlementRef || null;

    const linkedQuote =
      (payment.pay02_quote_id && quotesById.get(payment.pay02_quote_id))
      || quotesByPaymentRef.get(payment.reference)
      || null;

    if (payment.requireQuoteCorrelation === true && !linkedQuote && !payment.pay02_quote_id) {
      exceptions.push({
        type: 'orphaned_payment_missing_quote_or_order',
        reference: payment.reference,
        severity: 'high',
        detail: 'Canonical payment has no correlated commercial quote or order reference.',
      });
    }

    if (linkedQuote) {
      const quoteTotal = Number(linkedQuote.total_minor ?? linkedQuote.totalMinor ?? 0);
      const quoteCurrency = String(linkedQuote.currency || '').toUpperCase();
      if (quoteTotal !== amount || quoteCurrency !== code) {
        exceptions.push({
          type: 'payment_and_quote_amount_or_currency_mismatch',
          reference: payment.reference,
          severity: 'critical',
          detail: `Canonical payment (${code} ${amount}) does not match correlated quote (${quoteCurrency} ${quoteTotal}).`,
        });
      }
    }

    if (
      category === PAY02_CATEGORIES.THIRD_PARTY
      && (payment.claimAsCarUpRevenue === true || payment.pay02_funds_owner === 'carup_japan')
    ) {
      exceptions.push({
        type: 'third_party_principal_misclassified_as_carup_revenue',
        reference: payment.reference,
        severity: 'critical',
        detail: 'Third-party obligation cannot be classified as CarUp revenue or owned by CarUp Japan.',
      });
    }

    if (payment.status === 'pending') {
      bucket.grossChargedPendingMinor += amount;
      bucket.providerInitiatedPendingMinor += amount;
    } else if (payment.status === 'paid') {
      if (!payment.pay01a_intent_id || !payment.pay01a_checkout_id) {
        exceptions.push({
          type: 'paid_status_missing_provider_intent_evidence',
          reference: payment.reference,
          severity: 'critical',
          detail: 'Canonical payment is marked paid without both Checkout and PaymentIntent provider identifiers.',
        });
      } else {
        bucket.providerConfirmedCollectionMinor += amount;
        bucket.providerConfirmedGrossMinor += amount;

        // Tax treatment check: never claim verified zero-tax if taxPolicyRef is pending or unapproved
        const productDef = productCode ? getPay02CatalogueItem(productCode) : null;
        const taxPolicy = payment.tax_policy_ref || productDef?.taxPolicyRef || 'unverified';
        if (String(taxPolicy).includes('pending') || String(taxPolicy).includes('no_tax_claim') || taxPolicy === 'unverified') {
          bucket.unverifiedTaxTreatmentCount += 1;
        }

        if (category === PAY02_CATEGORIES.FIRST_PARTY) {
          const isPlatformFee = productCode && PAY02_PLATFORM_FEE_PRODUCTS.has(productCode);
          if (isPlatformFee) {
            bucket.platformServiceFeeMinor += amount;
          }
          // If pilot/order entitlements are tracked and this payment has an unfulfilled entitlement, hold in customer liability
          const hasFulfilledEntitlement =
            pilotEntitlements.length === 0 || activeEntitlementByPaymentRef.has(payment.reference);
          if (hasFulfilledEntitlement) {
            bucket.carUpRecognizedRevenueMinor += amount;
            bucket.carUpEarnedRevenueMinor += amount;
          } else {
            bucket.carUpDeferredCustomerLiabilityMinor += amount;
          }
        } else if (category === PAY02_CATEGORIES.THIRD_PARTY) {
          bucket.thirdPartyPayableMinor += amount;
          bucket.thirdPartyCustodialOrPassThroughMinor += amount;
        }

        if (settlement === 'settled') {
          if (!providerSettlementRef && !bankSettlementRef && isSimulated === false) {
            exceptions.push({
              type: 'settlement_claimed_without_provider_or_bank_evidence',
              reference: payment.reference,
              severity: 'high',
              detail: 'Payment is marked settled without an authoritative provider payout or bank settlement reference.',
            });
            bucket.unsettledProviderConfirmedMinor += amount;
          } else {
            bucket.settledMinor += amount;
            if (providerSettlementRef) bucket.providerSettledMinor += amount;
            if (bankSettlementRef) bucket.bankSettledMinor += amount;
          }
        } else {
          bucket.unsettledProviderConfirmedMinor += amount;
        }
      }
    } else if (payment.status === 'refund_pending') {
      bucket.refundPendingMinor += amount;
    } else if (payment.status === 'refunded') {
      bucket.refundedMinor += amount;
    } else if (payment.status === 'disputed') {
      bucket.disputedMinor += amount;
    }
  }

  // Cross-check fulfillment entitlements against canonical payment state
  for (const ent of pilotEntitlements) {
    const linkedPayment = paymentByRef.get(ent.payment_reference || ent.paymentReference);
    const isActive =
      (ent.entitlement_status === 'entitled' || Boolean(ent.granted_at || ent.grantedAt))
      && ent.entitlement_status !== 'revoked_refunded'
      && ent.entitlement_status !== 'refund_suspended'
      && !Boolean(ent.revoked_at || ent.revokedAt);

    if (!linkedPayment) {
      exceptions.push({
        type: 'orphaned_entitlement_missing_canonical_payment',
        reference: ent.id || ent.orderId,
        severity: 'critical',
        detail: 'Fulfillment record has no corresponding canonical payment_transactions row.',
      });
      continue;
    }
    if (isActive && linkedPayment.status !== 'paid') {
      exceptions.push({
        type:
          linkedPayment.status === 'refunded'
            ? 'refund_succeeded_but_entitlement_still_active'
            : 'carup_fulfilled_but_provider_unverified',
        reference: linkedPayment.reference,
        severity: 'critical',
        detail: `Entitlement ${ent.id || ent.orderId} is active while canonical payment status is '${linkedPayment.status}'.`,
      });
    }
    if (
      !isActive
      && linkedPayment.status === 'paid'
      && !(ent.revoked_at || ent.revokedAt)
      && ent.entitlement_status !== 'revoked_refunded'
    ) {
      exceptions.push({
        type: 'provider_paid_but_carup_fulfillment_pending',
        reference: linkedPayment.reference,
        severity: 'high',
        detail: `Canonical payment ${linkedPayment.reference} is paid, but product fulfillment has not been granted.`,
      });
    }
  }

  const defaultBucket = byCurrency.JPY || Object.values(byCurrency)[0] || {
    currency: 'JPY',
    quotedObligationsMinor: 0,
    providerConfirmedGrossMinor: 0,
    providerSettledMinor: 0,
    bankSettledMinor: 0,
    refundedMinor: 0,
    disputedMinor: 0,
    carUpRecognizedRevenueMinor: 0,
    carUpDeferredCustomerLiabilityMinor: 0,
    thirdPartyPayableMinor: 0,
    platformServiceFeeMinor: 0,
    unverifiedTaxTreatmentCount: 0,
  };

  return Object.freeze({
    reportingMode: isSimulated ? 'SIMULATED_INPUT' : 'AUTHORITATIVE_DATABASE_RECONCILIATION',
    authorityMode: isSimulated ? 'simulation' : 'authoritative_database_reconciliation',
    simulated: isSimulated,
    authorityBanner: isSimulated
      ? 'SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING'
      : 'AUTHORITATIVE PERSISTED DATABASE RECONCILIATION',
    currency: defaultBucket.currency,
    grossAuthorizedMinor: defaultBucket.quotedObligationsMinor,
    providerCapturedMinor: defaultBucket.providerConfirmedGrossMinor,
    providerSettledMinor: defaultBucket.providerSettledMinor,
    bankSettledMinor: defaultBucket.bankSettledMinor,
    refundedMinor: defaultBucket.refundedMinor,
    disputedMinor: defaultBucket.disputedMinor,
    carUpRecognizedRevenueMinor: defaultBucket.carUpRecognizedRevenueMinor,
    carUpDeferredCustomerLiabilityMinor: defaultBucket.carUpDeferredCustomerLiabilityMinor,
    thirdPartyBeneficiaryPayableMinor: defaultBucket.thirdPartyPayableMinor,
    platformServiceFeeMinor: defaultBucket.platformServiceFeeMinor,
    unverifiedTaxTreatmentCount: defaultBucket.unverifiedTaxTreatmentCount,
    exceptionsCount: exceptions.length,
    reconciledClean: exceptions.length === 0,
    byCurrency: Object.freeze(byCurrency),
    exceptions: Object.freeze(exceptions),
    healthy: exceptions.length === 0,
  });
}

/**
 * Operational Financial Reconciliation Mode (R1-D Section 7.1).
 * Retrieves records strictly from trusted database tables (`payment_transactions`, `pay02_commercial_quotes`,
 * `pay02_report_orders`, `pay01c_demo_orders`) and rejects any caller-supplied arrays!
 */
export async function reconcilePay02OperationalFinancialTruth({
  callerSuppliedPayload = null,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);

  if (
    callerSuppliedPayload
    && (
      callerSuppliedPayload.canonicalPayments !== undefined
      || callerSuppliedPayload.quotes !== undefined
      || callerSuppliedPayload.externalGarageDeclarations !== undefined
      || callerSuppliedPayload.pilotEntitlements !== undefined
    )
  ) {
    throw new Pay02Error('PAY02_CALLER_SUPPLIED_EVIDENCE_FORBIDDEN', 400, {
      message: 'Operational financial reconciliation reads exclusively from persisted database authorities; use /api/pay02/admin/reporting/simulate for test simulations.',
    });
  }

  if (!db || typeof db.from !== 'function') {
    throw new Pay02Error('PAY02_REPORTING_DB_UNAVAILABLE', 503);
  }

  const { data: payments, error: payErr } = await db
    .from('payment_transactions')
    .select('*');
  if (payErr) throw new Pay02Error('PAY02_REPORTING_DB_READ_FAILED', 503);

  const { data: quotes, error: quoteErr } = await db
    .from('pay02_commercial_quotes')
    .select('*');
  if (quoteErr) throw new Pay02Error('PAY02_REPORTING_DB_READ_FAILED', 503);

  const { data: reportOrders, error: orderErr } = await db
    .from('pay02_report_orders')
    .select('*');
  if (orderErr) throw new Pay02Error('PAY02_REPORTING_DB_READ_FAILED', 503);

  return computePay02FinancialTruthReport({
    canonicalPayments: Array.isArray(payments) ? payments : [],
    quotes: Array.isArray(quotes) ? quotes : [],
    externalGarageDeclarations: [],
    pilotEntitlements: Array.isArray(reportOrders) ? reportOrders : [],
    reportingMode: 'AUTHORITATIVE_DATABASE_RECONCILIATION',
  });
}

/**
 * Verifies that an assembled vehicle history report preserves vehicle identity, data-source attribution,
 * explicit missing-source disclosures, and buyer-safe filtering (R1-E Section 8.3).
 */
export function verifyVehicleReportProvenance(report, vehicleRow) {
  if (!report || typeof report !== 'object') {
    throw new Pay02Error('PAY02_REPORT_PAYLOAD_INVALID', 502);
  }
  if (!vehicleRow || !vehicleRow.vin || report.vin !== vehicleRow.vin) {
    throw new Pay02Error('PAY02_REPORT_VIN_PROVENANCE_MISMATCH', 409);
  }
  if (!report.identity || report.identity.vin !== vehicleRow.vin) {
    throw new Pay02Error('PAY02_REPORT_IDENTITY_MISSING', 409);
  }
  if (!report.completeness || typeof report.completeness !== 'object') {
    throw new Pay02Error('PAY02_REPORT_COMPLETENESS_DISCLOSURE_MISSING', 409);
  }
  if (!Array.isArray(report.limitations) || report.limitations.length === 0) {
    throw new Pay02Error('PAY02_REPORT_LIMITATIONS_DISCLOSURE_MISSING', 409, {
      message: 'Every buyer report must include explicit data-coverage limitation disclosures so missing sources are never presented as a clean history.',
    });
  }
  if (report.audience !== 'buyer') {
    throw new Pay02Error('PAY02_REPORT_BUYER_DISCLOSURE_FILTER_REQUIRED', 409);
  }

  const completenessState =
    report.completeness.lifecycle_source_coverage === 1
    && (!report.completeness.classes_unavailable || report.completeness.classes_unavailable.length === 0)
      ? 'complete_recorded_sources'
      : 'partial_with_explicit_missing_source_disclosures';

  return Object.freeze({
    verified: true,
    vin: vehicleRow.vin,
    vehicleId: String(vehicleRow.id ?? vehicleRow.vin),
    completenessState,
    limitationsCount: report.limitations.length,
    sourceDiversity: report.completeness.source_diversity ?? 0,
  });
}

/**
 * PAY-02-PILOT (R1-E Sections 8.1-8.4) — First Real CarUp Product Integration Readiness Contract:
 * Single-VIN Canonical Vehicle History & Provenance Report (`intel.report.vehicle_history_single`).
 *
 * Establishes the complete identity and cross-reference relationship through authoritative persisted records:
 * 1. Resolves the quote (`pay02_commercial_quotes`), report order (`pay02_report_orders`), canonical payment
 *    (`payment_transactions`), and vehicle (`vehicles`) from `db` when IDs are supplied, or validates
 *    exact bidirectional cross-references across all four records.
 * 2. Verifies:
 *    - `quote.payer_id === buyerId` and `quote.product_code === 'intel.report.vehicle_history_single'`
 *    - `quote.source_object_type === 'vehicles'` and `quote.source_object_id === vin`
 *    - `payment.reference === quote.payment_reference === order.payment_reference`
 *    - `payment.pay02_quote_id === quote.id` and `order.quote_id === quote.id`
 *    - `payment.pay01a_actor_id === buyerId` and `order.buyer_id === buyerId`
 *    - `payment.status === 'paid'` with `pay01a_checkout_id` and `pay01a_intent_id`
 *    - `order.entitlement_status === 'entitled'` and `order.revoked_at === null`
 *    - A real `vehicles` record exists for `vin`
 * 3. Enforces idempotent fulfillment: if `order.report_version_id` already exists, returns that exact
 *    version from `report_versions` rather than generating a duplicate version from the same payment!
 */
export async function deliverVerifiedVehicleHistoryReport({
  buyerId,
  vin,
  quoteId = null,
  orderId = null,
  quote = null,
  canonicalPayment = null,
  entitlementOrder = null,
  vehicleRecord = null,
  db = supabase,
  reportAssembler = assembleReport,
  versionGenerator = generateReportVersion,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  if (!buyerId || typeof buyerId !== 'string' || !buyerId.trim()) {
    throw new Pay02Error('PAY02_PILOT_AUTH_REQUIRED', 401);
  }
  const cleanBuyer = buyerId.trim();

  // Resolve persisted records from `db` whenever IDs are provided or records are not pre-supplied
  let resolvedQuote = quote;
  let resolvedOrder = entitlementOrder;
  let resolvedPayment = canonicalPayment;
  let resolvedVehicle = vehicleRecord;

  if (db && typeof db.from === 'function') {
    if (!resolvedOrder && (orderId || quoteId)) {
      const q = db.from('pay02_report_orders').select('*');
      const { data: ordRow, error: ordErr } = orderId
        ? await q.eq('id', orderId).maybeSingle()
        : await q.eq('quote_id', quoteId).maybeSingle();
      if (ordErr) throw new Pay02Error('PAY02_PILOT_DB_READ_FAILED', 503);
      resolvedOrder = ordRow;
    }
    if (!resolvedQuote && (quoteId || resolvedOrder?.quote_id)) {
      const { data: qRow, error: qErr } = await db
        .from('pay02_commercial_quotes')
        .select('*')
        .eq('id', quoteId || resolvedOrder.quote_id)
        .maybeSingle();
      if (qErr) throw new Pay02Error('PAY02_PILOT_DB_READ_FAILED', 503);
      resolvedQuote = qRow;
    }
    const paymentRefToLookup =
      resolvedQuote?.payment_reference
      || resolvedQuote?.paymentReference
      || resolvedOrder?.payment_reference
      || resolvedOrder?.paymentReference;
    if (!resolvedPayment && paymentRefToLookup) {
      const { data: pRow, error: pErr } = await db
        .from('payment_transactions')
        .select('*')
        .eq('reference', paymentRefToLookup)
        .maybeSingle();
      if (pErr) throw new Pay02Error('PAY02_PILOT_DB_READ_FAILED', 503);
      resolvedPayment = pRow;
    }
  }

  const effectiveVin = typeof vin === 'string' && vin.trim()
    ? vin.trim()
    : typeof resolvedOrder?.vin === 'string' && resolvedOrder.vin.trim()
      ? resolvedOrder.vin.trim()
      : null;
  if (!effectiveVin) {
    throw new Pay02Error('PAY02_PILOT_VIN_REQUIRED', 400);
  }
  const cleanVin = effectiveVin;

  if (db && typeof db.from === 'function' && !resolvedVehicle) {
    const { data: vRow, error: vErr } = await db
      .from('vehicles')
      .select('*')
      .eq('vin', cleanVin)
      .maybeSingle();
    if (vErr) throw new Pay02Error('PAY02_PILOT_DB_READ_FAILED', 503);
    resolvedVehicle = vRow;
  }

  if (!resolvedQuote) {
    throw new Pay02Error('PAY02_PILOT_QUOTE_NOT_FOUND', 404);
  }
  const qProductCode = resolvedQuote.product_code || resolvedQuote.productCode;
  const qProductVersion = Number(resolvedQuote.product_version ?? resolvedQuote.productVersion ?? 0);
  const qPayerId = resolvedQuote.payer_id || resolvedQuote.payerId;
  const qSourceType = resolvedQuote.source_object_type || resolvedQuote.sourceObjectType;
  const qSourceId = resolvedQuote.source_object_id || resolvedQuote.sourceObjectId;
  const qId = resolvedQuote.id || resolvedQuote.quoteId;
  const qPaymentRef = resolvedQuote.payment_reference || resolvedQuote.paymentReference;
  const qTotalMinor = Number(resolvedQuote.total_minor ?? resolvedQuote.totalMinor ?? 0);
  const qCurrency = String(resolvedQuote.currency || '').toUpperCase();

  if (
    !qId
    || !qPaymentRef
    || !Number.isInteger(qProductVersion)
    || qProductVersion < 1
    || qProductCode !== 'intel.report.vehicle_history_single'
    || qPayerId !== cleanBuyer
    || qSourceType !== 'vehicles'
    || qSourceId !== cleanVin
  ) {
    throw new Pay02Error('PAY02_PILOT_QUOTE_AUTHORITY_MISMATCH', 403);
  }

  if (!resolvedPayment) {
    throw new Pay02Error('PAY02_PILOT_CANONICAL_PAYMENT_MISSING', 409);
  }
  const pQuoteId = resolvedPayment.pay02_quote_id || resolvedPayment.pay02QuoteId;
  const pAccountId = resolvedPayment.pay01a_account_id || resolvedPayment.pay01aAccountId;
  // Mandatory bidirectional correlation check (Section 7.2): all references must be non-null and strictly equal!
  if (
    resolvedPayment.gateway !== 'stripe_carup_japan_sandbox'
    || pAccountId !== 'acct_1UVnGaEjgXqvlsJk'
    || resolvedPayment.pay01a_actor_id !== cleanBuyer
    || Number(resolvedPayment.amount) !== qTotalMinor
    || String(resolvedPayment.currency).toUpperCase() !== qCurrency
    || !resolvedPayment.reference
    || resolvedPayment.reference !== qPaymentRef
    || !pQuoteId
    || pQuoteId !== qId
  ) {
    throw new Pay02Error('PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH', 409);
  }

  if (resolvedPayment.status === 'refund_pending') {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING', 403);
  }
  if (resolvedPayment.status === 'refunded') {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND', 403);
  }
  if (
    resolvedPayment.status !== 'paid'
    || !resolvedPayment.pay01a_checkout_id
    || !resolvedPayment.pay01a_intent_id
  ) {
    throw new Pay02Error('PAY02_PILOT_PAYMENT_NOT_VERIFIED_PAID', 403, {
      paymentStatus: resolvedPayment.status,
    });
  }

  if (!resolvedOrder) {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE', 403);
  }
  const oBuyerId = resolvedOrder.buyer_id || resolvedOrder.buyerId;
  const oQuoteId = resolvedOrder.quote_id || resolvedOrder.quoteId;
  const oPaymentRef = resolvedOrder.payment_reference || resolvedOrder.paymentReference;
  const oProductCode = resolvedOrder.product_code || resolvedOrder.productCode || 'intel.report.vehicle_history_single';
  const oProductVersion = Number(
    resolvedOrder.product_version ?? resolvedOrder.productVersion ?? qProductVersion,
  );
  const oVin = resolvedOrder.vin;
  const oStatus = resolvedOrder.entitlement_status || (resolvedOrder.grantedAt && !resolvedOrder.revokedAt ? 'entitled' : 'inactive');
  const oGranted = resolvedOrder.granted_at || resolvedOrder.grantedAt;
  const oRevoked = resolvedOrder.revoked_at || resolvedOrder.revokedAt;

  if (
    oBuyerId !== cleanBuyer
    || !oVin
    || oVin !== cleanVin
    || !oQuoteId
    || oQuoteId !== qId
    || !oPaymentRef
    || oPaymentRef !== resolvedPayment.reference
    || oProductCode !== 'intel.report.vehicle_history_single'
    || oProductVersion !== qProductVersion
  ) {
    throw new Pay02Error('PAY02_PILOT_ORDER_CORRELATION_MISMATCH', 403);
  }
  if (oStatus === 'refund_suspended') {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING', 403);
  }
  if (oStatus === 'revoked_refunded' || oRevoked) {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE', 403);
  }
  if (oStatus !== 'entitled' || !oGranted) {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE', 403);
  }

  if (!resolvedVehicle || resolvedVehicle.vin !== cleanVin) {
    throw new Pay02Error('PAY02_PILOT_VEHICLE_RECORD_NOT_FOUND', 404, {
      vin: cleanVin,
      message: 'Cannot generate an authoritative vehicle history report for an unknown VIN.',
    });
  }

  // Idempotent fulfillment check: if this paid order already generated a report version, return it without creating a second version
  const existingVersionId = resolvedOrder.report_version_id || resolvedOrder.reportVersionId;
  if (existingVersionId && db && typeof db.from === 'function') {
    const { data: existingVer, error: existingVerErr } = await db
      .from('report_versions')
      .select('*')
      .eq('id', existingVersionId)
      .maybeSingle();
    if (existingVerErr) {
      throw new Pay02Error('PAY02_PILOT_DB_READ_FAILED', 503);
    }
    if (existingVer && existingVer.payload) {
      if (existingVer.revoked) {
        throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND', 403);
      }
      const provenance = verifyVehicleReportProvenance(existingVer.payload, resolvedVehicle);
      return {
        productCode: 'intel.report.vehicle_history_single',
        vin: cleanVin,
        quoteId: qId,
        quoteNumber: resolvedQuote.quote_number || resolvedQuote.quoteNumber,
        orderId: resolvedOrder.id || null,
        paymentReference: resolvedPayment.reference,
        reportVersionId: existingVer.id,
        reportVersion: existingVer.version,
        contentHash: existingVer.content_hash,
        completeness: existingVer.completeness,
        provenance,
        idempotentReplay: true,
        issuanceStage: PAY02_REPORT_ISSUANCE_POLICY.paidAccess.stage,
        report: existingVer.payload,
      };
    }
  }

  const assembledReport = await reportAssembler(db, cleanVin, { audience: 'buyer' });
  const provenance = verifyVehicleReportProvenance(assembledReport, resolvedVehicle);

  // R1-E: Verified report fulfillment strictly requires the transactional PostgreSQL RPC
  // `pay03a_complete_report_fulfillment`. Never fall back to a weaker multi-step JS implementation.
  if (!db || typeof db.rpc !== 'function' || !resolvedOrder.id) {
    throw new Pay02Error('PAY03A_ATOMIC_FULFILLMENT_RPC_REQUIRED', 503, {
      message:
        'Verified vehicle history report fulfillment requires the transactional PostgreSQL RPC pay03a_complete_report_fulfillment.',
    });
  }

  const report = {
    ...assembledReport,
    commercial_snapshot: {
      product_code: 'intel.report.vehicle_history_single',
      product_version: qProductVersion,
      order_id: resolvedOrder.id,
      quote_id: qId,
      quote_number: resolvedQuote.quote_number || resolvedQuote.quoteNumber || null,
      payment_reference: resolvedPayment.reference,
      buyer_id: cleanBuyer,
      deliverable_type: 'immutable_buyer_owned_report_snapshot',
      policy_status: 'CANDIDATE_SANDBOX_DIFFERENTIATION_PENDING_OWNER_APPROVAL',
    },
  };

  const computedHash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const { data: atomicFulfillment, error: rpcErr } = await db.rpc(
    'pay03a_complete_report_fulfillment',
    {
      p_order_id: resolvedOrder.id,
      p_buyer_id: cleanBuyer,
      p_vin: cleanVin,
      p_payload: report,
      p_content_hash: computedHash,
      p_completeness: report.completeness || {},
    },
  );
  if (rpcErr) {
    const msg = String(rpcErr.message || '');
    if (msg.includes('PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING')) {
      throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING', 403);
    }
    if (
      msg.includes('PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND')
      || msg.includes('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE')
    ) {
      throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE', 403);
    }
    if (msg.includes('PAY02_PILOT_ORDER_CORRELATION_MISMATCH')) {
      throw new Pay02Error('PAY02_PILOT_ORDER_CORRELATION_MISMATCH', 403);
    }
    if (msg.includes('PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH')) {
      throw new Pay02Error('PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH', 409);
    }
    throw new Pay02Error('PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED', 503, { message: msg });
  }
  if (!atomicFulfillment || !atomicFulfillment.report_version_id) {
    throw new Pay02Error('PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED', 503);
  }
  const storedReport = atomicFulfillment.payload || report;
  const storedProvenance = verifyVehicleReportProvenance(storedReport, resolvedVehicle);
  return {
    productCode: 'intel.report.vehicle_history_single',
    vin: cleanVin,
    quoteId: qId,
    quoteNumber: resolvedQuote.quote_number || resolvedQuote.quoteNumber,
    orderId: resolvedOrder.id,
    paymentReference: resolvedPayment.reference,
    reportVersionId: atomicFulfillment.report_version_id,
    reportVersion: Number(atomicFulfillment.report_version_number ?? 1),
    contentHash: atomicFulfillment.report_content_hash || computedHash,
    completeness: atomicFulfillment.completeness_summary || report.completeness,
    provenance: storedProvenance,
    idempotentReplay: Boolean(atomicFulfillment.idempotent_replay),
    issuanceStage: atomicFulfillment.idempotent_replay
      ? PAY02_REPORT_ISSUANCE_POLICY.paidAccess.stage
      : PAY02_REPORT_ISSUANCE_POLICY.authoritativeGeneration.stage,
    report: storedReport,
  };
}

export {
  decomposeImportOrderObligations,
  evaluatePay02ProviderRoute,
  buildServerAuthorizedQuote,
};
