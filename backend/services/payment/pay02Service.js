/**
 * CARUP-PAY-02 — Unified Commercial Service Payments, Governance, Orchestration & Reporting Service
 * Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
 *
 * Key invariants:
 * - Reuses canonical `public.payment_transactions` as the sole money-state ledger.
 * - Preserves `garage_recorded_external` as off-platform declarations, never gateway-confirmed collections.
 * - Separates GMV / invoiced obligations from provider-confirmed collections, third-party liabilities,
 *   CarUp first-party earned revenue, refunds, and actual settlement.
 * - Never sums multi-currency obligations into a single number without approved FX authority.
 * - Enforces distinct proposer vs reviewer governance and blocks live activation (`release_approved`/`active`).
 */
import { supabase } from '../../db/supabase.js';
import { assembleReport, generateReportVersion } from '../report/reportService.js';
import {
  PAY02_CATALOGUE,
  PAY02_CATEGORIES,
  PAY02_FAMILIES,
  PAY02_ACTIVATION_STATES,
  getPay02CatalogueItem,
} from './pay02CatalogueDefinitions.js';
import {
  Pay02Error,
  PAY02_PROVIDER_PROFILES,
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
 * Projects catalogue summary and rows with optional filtering by family, category, or activationState.
 */
export function listPay02Catalogue({
  family = null,
  commercialCategory = null,
  activationState = null,
  certificationState = null,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);

  let rows = [...PAY02_CATALOGUE];
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
  };
}

/**
 * Submits a governed commercial pricing or activation state proposal (Phase 2, Section 9).
 * An engineer or admin creating a proposal never auto-activates a product.
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
  if (!actorId || typeof actorId !== 'string') {
    throw new Pay02Error('PAY02_GOVERNANCE_AUTH_REQUIRED', 401);
  }
  if (!['admin', 'owner', 'finance_admin'].includes(String(actorRole || '').toLowerCase())) {
    throw new Pay02Error('PAY02_GOVERNANCE_ROLE_FORBIDDEN', 403);
  }

  const product = getPay02CatalogueItem(productCode);
  if (!product) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
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
    product.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY
    && !['blocked', 'draft'].includes(proposedState)
  ) {
    throw new Pay02Error('PAY02_CATEGORY_C_ACTIVATION_FORBIDDEN', 403, { productCode });
  }
  if (typeof rationale !== 'string' || rationale.trim().length < 10) {
    throw new Pay02Error('PAY02_PROPOSAL_RATIONALE_REQUIRED', 400);
  }

  let validatedPrice = null;
  if (proposedAmountMinor !== null && proposedAmountMinor !== undefined) {
    validatedPrice = assertMinorUnitAmount(
      proposedAmountMinor,
      proposedCurrency || product.approvedCurrency || 'JPY',
    );
  }

  const candidateAfterProposal = {
    ...product,
    activationState: proposedState,
    approvedAmountMinor: validatedPrice ? validatedPrice.amountMinor : product.approvedAmountMinor,
    approvedCurrency: validatedPrice ? validatedPrice.currency : product.approvedCurrency,
    approvalEvidenceRef: approvalEvidenceRef || product.approvalEvidenceRef,
    approvedBy: actorId,
    priceAuthorityType:
      validatedPrice && product.priceAuthorityType === 'unapproved_missing'
        ? 'fixed_catalogue'
        : product.priceAuthorityType,
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
    product_code: product.productCode,
    product_version: product.version,
    from_state: product.activationState,
    proposed_state: proposedState,
    proposed_amount_minor: validatedPrice ? validatedPrice.amountMinor : null,
    proposed_currency: validatedPrice ? validatedPrice.currency : null,
    approval_evidence_ref: approvalEvidenceRef || product.approvalEvidenceRef,
    rationale: rationale.trim(),
    proposer_id: actorId,
    proposer_role: String(actorRole).toLowerCase(),
    status: 'pending_review',
  };

  if (db && typeof db.from === 'function') {
    const { data, error } = await db
      .from('pay02_activation_proposals')
      .insert(payload)
      .select('*')
      .maybeSingle();
    if (error && error.code !== '42P01') {
      throw new Pay02Error('PAY02_PROPOSAL_PERSISTENCE_FAILED', 503);
    }
    if (data) return { proposal: data };
  }

  return {
    proposal: {
      id: `prop_${Date.now()}`,
      ...payload,
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * Reviews a governance proposal. Enforces separation of duties: the reviewer cannot be the proposer.
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
  if (!reviewerId || typeof reviewerId !== 'string') {
    throw new Pay02Error('PAY02_GOVERNANCE_AUTH_REQUIRED', 401);
  }
  if (!['admin', 'owner'].includes(String(reviewerRole || '').toLowerCase())) {
    throw new Pay02Error('PAY02_GOVERNANCE_REVIEW_ROLE_FORBIDDEN', 403);
  }
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Pay02Error('PAY02_INVALID_REVIEW_DECISION', 400);
  }

  const { data: existing, error: readErr } = await db
    .from('pay02_activation_proposals')
    .select('*')
    .eq('id', proposalId)
    .maybeSingle();
  if (readErr) throw new Pay02Error('PAY02_PROPOSAL_READ_UNAVAILABLE', 503);
  if (!existing) throw new Pay02Error('PAY02_PROPOSAL_NOT_FOUND', 404);
  if (existing.status !== 'pending_review') {
    throw new Pay02Error('PAY02_PROPOSAL_ALREADY_DECIDED', 409);
  }
  if (existing.proposer_id === reviewerId) {
    throw new Pay02Error('PAY02_SELF_APPROVAL_FORBIDDEN', 403, {
      proposalId,
      message: 'Proposer and approving authority must be distinct.',
    });
  }
  if (['release_approved', 'active'].includes(existing.proposed_state)) {
    throw new Pay02Error('PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY', 403);
  }

  const { data: updated, error: updateErr } = await db
    .from('pay02_activation_proposals')
    .update({
      status: decision,
      reviewer_id: reviewerId,
      reviewer_role: String(reviewerRole).toLowerCase(),
      review_notes: reviewNotes ? String(reviewNotes).trim() : null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', proposalId)
    .select('*')
    .single();
  if (updateErr) throw new Pay02Error('PAY02_PROPOSAL_REVIEW_FAILED', 503);

  return { proposal: updated };
}

/**
 * Issues and persists an immutable server-authorized commercial quote.
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
  const quote = buildServerAuthorizedQuote({
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
    env,
  });

  if (db && typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('pay02_issue_commercial_quote', {
      p_quote_number: quote.quoteNumber,
      p_product_code: quote.productCode,
      p_product_version: quote.productVersion,
      p_payer_id: quote.payerId,
      p_payer_role: quote.payerRole,
      p_source_object_type: quote.sourceObjectType,
      p_source_object_id: quote.sourceObjectId,
      p_currency: quote.currency,
      p_currency_scale: quote.currencyScale,
      p_total_minor: quote.totalMinor,
      p_selected_provider: quote.selectedProvider,
      p_idempotency_key: quote.idempotencyKey,
    });
    if (error) {
      throw new Pay02Error('PAY02_QUOTE_RPC_REJECTED', 409, { message: error.message });
    }
    return {
      ...quote,
      id: data?.id || null,
      status: data?.status || quote.status,
      paymentReference: data?.payment_reference || null,
    };
  }

  return quote;
}

/**
 * Evaluates financial reporting truth and reconciliation across canonical `payment_transactions`,
 * commercial quotes, multi-party obligations, and off-platform garage external payment declarations
 * (Phase 8, Sections 32-33 & Issue #247 Deliverable G).
 *
 * Strictly separates:
 * - Gross quoted / invoiced obligations (never treated as collected money)
 * - Provider-confirmed CarUp direct-merchant collections (`category_a_first_party` with status='paid')
 * - Third-party obligations (`category_b_third_party` — never treated as CarUp revenue)
 * - Off-platform external declarations (`garage_recorded_external` — never treated as gateway-confirmed)
 * - Refunds & reversals (`status='refunded'` or `'refund_pending'`)
 * - Settlement state (`unsettled` vs `settled`)
 * - Never sums different currencies together without an approved FX rate!
 */
export function computePay02FinancialTruthReport({
  canonicalPayments = [],
  quotes = [],
  externalGarageDeclarations = [],
  pilotEntitlements = [],
  AttemptCrossCurrencySum = false,
} = {}) {
  if (AttemptCrossCurrencySum === true) {
    throw new Pay02Error('PAY02_UNAPPROVED_CROSS_CURRENCY_SUM_REFUSED', 409, {
      message: 'Financial reporting must remain bucketed by canonical currency unless an approved FX conversion contract is supplied.',
    });
  }

  const byCurrency = {};
  const exceptions = [];

  function ensureBucket(currency) {
    const code = String(currency || 'UNKNOWN').toUpperCase();
    if (!byCurrency[code]) {
      byCurrency[code] = {
        currency: code,
        quotedObligationsMinor: 0,
        providerInitiatedPendingMinor: 0,
        providerConfirmedGrossMinor: 0,
        carUpEarnedRevenueMinor: 0,
        thirdPartyCustodialOrPassThroughMinor: 0,
        refundPendingMinor: 0,
        refundedMinor: 0,
        settledMinor: 0,
        unsettledProviderConfirmedMinor: 0,
        externalOffPlatformDeclaredMinor: 0, // Tracked separately; NEVER added to providerConfirmedGrossMinor or carUpEarnedRevenueMinor
      };
    }
    return byCurrency[code];
  }

  for (const quote of quotes) {
    const bucket = ensureBucket(quote.currency);
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
    bucket.externalOffPlatformDeclaredMinor += Number(ext.amountMinor ?? 0);
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

    const bucket = ensureBucket(payment.currency);
    const amount = Number(payment.amount_minor ?? payment.amount ?? 0);
    const category = payment.pay02_commercial_category || PAY02_CATEGORIES.FIRST_PARTY;
    const settlement = payment.pay02_settlement_status || 'unsettled';

    if (payment.status === 'pending') {
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
        bucket.providerConfirmedGrossMinor += amount;
        if (category === PAY02_CATEGORIES.FIRST_PARTY) {
          bucket.carUpEarnedRevenueMinor += amount;
        } else if (category === PAY02_CATEGORIES.THIRD_PARTY) {
          bucket.thirdPartyCustodialOrPassThroughMinor += amount;
        }
        if (settlement === 'settled') {
          bucket.settledMinor += amount;
        } else {
          bucket.unsettledProviderConfirmedMinor += amount;
        }
      }
    } else if (payment.status === 'refund_pending') {
      bucket.refundPendingMinor += amount;
    } else if (payment.status === 'refunded') {
      bucket.refundedMinor += amount;
    }
  }

  // Cross-check fulfillment entitlements against canonical payment state
  for (const ent of pilotEntitlements) {
    const linkedPayment = paymentByRef.get(ent.payment_reference || ent.paymentReference);
    const isActive = Boolean(ent.granted_at || ent.grantedAt) && !Boolean(ent.revoked_at || ent.revokedAt);

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
    ) {
      exceptions.push({
        type: 'provider_paid_but_carup_fulfillment_pending',
        reference: linkedPayment.reference,
        severity: 'high',
        detail: `Canonical payment ${linkedPayment.reference} is paid, but product fulfillment has not been granted.`,
      });
    }
  }

  return Object.freeze({
    byCurrency: Object.freeze(byCurrency),
    exceptions: Object.freeze(exceptions),
    healthy: exceptions.length === 0,
  });
}

/**
 * PAY-02-PILOT — First Real CarUp Product Integration Readiness Contract:
 * Single-VIN Canonical Vehicle History & Provenance Report (`intel.report.vehicle_history_single`).
 *
 * Connects a verified canonical payment (`payment_transactions.status = 'paid'`) and an immutable
 * `pay02_commercial_quotes` record for `intel.report.vehicle_history_single` to the genuine
 * `assembleReport` / `generateReportVersion` engine in `backend/services/report/reportService.js`.
 *
 * Fails closed if:
 * - The quote is not for `intel.report.vehicle_history_single`
 * - The buyer does not own the quote/order
 * - The canonical payment row is not verified `paid` with provider Checkout + PaymentIntent evidence
 * - The payment has been refunded or is `refund_pending`
 */
export async function deliverVerifiedVehicleHistoryReport({
  buyerId,
  vin,
  quote,
  canonicalPayment,
  entitlementOrder,
  db = supabase,
  reportAssembler = assembleReport,
  versionGenerator = generateReportVersion,
  env = process.env,
} = {}) {
  requirePay02Enabled(env);
  if (!buyerId || typeof buyerId !== 'string') {
    throw new Pay02Error('PAY02_PILOT_AUTH_REQUIRED', 401);
  }
  if (!vin || typeof vin !== 'string' || !vin.trim()) {
    throw new Pay02Error('PAY02_PILOT_VIN_REQUIRED', 400);
  }
  if (
    !quote
    || quote.productCode !== 'intel.report.vehicle_history_single'
    || quote.payerId !== buyerId
    || quote.sourceObjectId !== vin.trim()
  ) {
    throw new Pay02Error('PAY02_PILOT_QUOTE_AUTHORITY_MISMATCH', 403);
  }
  if (
    !canonicalPayment
    || canonicalPayment.gateway !== 'stripe_carup_japan_sandbox'
    || canonicalPayment.pay01a_actor_id !== buyerId
    || Number(canonicalPayment.amount) !== quote.totalMinor
    || String(canonicalPayment.currency).toUpperCase() !== quote.currency
  ) {
    throw new Pay02Error('PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH', 409);
  }
  if (
    canonicalPayment.status !== 'paid'
    || !canonicalPayment.pay01a_checkout_id
    || !canonicalPayment.pay01a_intent_id
  ) {
    throw new Pay02Error('PAY02_PILOT_PAYMENT_NOT_VERIFIED_PAID', 403, {
      paymentStatus: canonicalPayment.status,
    });
  }
  if (
    !entitlementOrder
    || entitlementOrder.buyerId !== buyerId
    || !entitlementOrder.grantedAt
    || entitlementOrder.revokedAt
  ) {
    throw new Pay02Error('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE', 403);
  }

  const report = await reportAssembler(db, vin.trim(), { audience: 'buyer' });
  const snapshot = await versionGenerator(db, vin.trim(), {
    actorId: buyerId,
    audience: 'buyer',
  });

  return {
    productCode: 'intel.report.vehicle_history_single',
    vin: vin.trim(),
    quoteNumber: quote.quoteNumber,
    paymentReference: canonicalPayment.reference,
    reportVersionId: snapshot.id,
    reportVersion: snapshot.version,
    contentHash: snapshot.content_hash,
    completeness: snapshot.completeness,
    report,
  };
}

export {
  decomposeImportOrderObligations,
  evaluatePay02ProviderRoute,
  buildServerAuthorizedQuote,
};
