/**
 * CARUP-PAY-02 — Commercial Catalogue, Quote Authority, Provider Routing & Governance Routes (R1)
 * Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
 *
 * Security & R1 Authority Invariants:
 * - Uses `authorizeSessionRole` (proven session authority; never trusts asserted headers in production).
 * - Admin governance endpoints require verified `admin` session role.
 * - Customer quote initiation (`POST /api/pay02/quotes`) requires authoritative database persistence
 *   and verified source-object authority; never falls back to preview mode.
 * - Non-authoritative quote preview (`POST /api/pay02/quotes/preview`) is explicitly segregated and
 *   labelled non-authoritative (`checkoutEligible: false`).
 * - Operational financial reconciliation (`/api/pay02/admin/reporting/reconcile`) reads exclusively
 *   from persisted database records and rejects caller-supplied JSON evidence arrays.
 * - Simulation mode (`POST /api/pay02/admin/reporting/simulate`) is explicitly segregated and stamped
 *   `SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING`.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { Pay02Error } from '../services/payment/pay02Contract.js';
import {
  listPay02Catalogue,
  loadPay02CatalogueWithPersistence,
  getPay02ProductDetailWithHistory,
  createPay02GovernanceProposal,
  reviewPay02GovernanceProposal,
  previewPay02Quote,
  createAndPersistPay02Quote,
  evaluatePay02ProviderRoute,
  decomposeImportOrderObligations,
  computePay02FinancialTruthReport,
  reconcilePay02OperationalFinancialTruth,
} from '../services/payment/pay02Service.js';

const router = express.Router();
const authenticatedSession = authorizeSessionRole([]);
const adminSession = authorizeSessionRole(['admin']);

function actorId(req) {
  return req.userContext?.id || req.userContext?.userId || null;
}
function actorRole(req) {
  return req.userContext?.effectiveRole || req.userContext?.role || null;
}
function resolvePay02Db(req) {
  if (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, 'pay02Db')) {
    return req.app.locals.pay02Db;
  }
  return supabase;
}

function respondError(res, err) {
  if (err instanceof Pay02Error) {
    return res.status(err.status).json({
      error: err.code,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  return res.status(503).json({
    error: 'PAY02_OPERATION_UNAVAILABLE',
    code: 'PAY02_OPERATION_UNAVAILABLE',
  });
}

router.get('/api/pay02/admin/catalogue', adminSession, async (req, res) => {
  try {
    const db = resolvePay02Db(req);
    const result = db
      ? await loadPay02CatalogueWithPersistence({
          family: req.query.family || null,
          commercialCategory: req.query.category || null,
          activationState: req.query.state || null,
          certificationState: req.query.certification || null,
          db,
        })
      : listPay02Catalogue({
          family: req.query.family || null,
          commercialCategory: req.query.category || null,
          activationState: req.query.state || null,
          certificationState: req.query.certification || null,
        });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay02/admin/catalogue/:productCode', adminSession, async (req, res) => {
  try {
    const detail = await getPay02ProductDetailWithHistory({
      productCode: req.params.productCode,
      db: resolvePay02Db(req),
    });
    return res.status(200).json(detail);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay02/admin/proposals', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await createPay02GovernanceProposal({
      actorId: actorId(req),
      actorRole: actorRole(req),
      productCode: body.productCode,
      proposedState: body.proposedState,
      proposedAmountMinor: body.proposedAmountMinor ?? null,
      proposedCurrency: body.proposedCurrency ?? null,
      approvalEvidenceRef: body.approvalEvidenceRef ?? null,
      rationale: body.rationale,
      db: resolvePay02Db(req),
    });
    return res.status(201).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay02/admin/proposals/:proposalId/review', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await reviewPay02GovernanceProposal({
      proposalId: req.params.proposalId,
      reviewerId: actorId(req),
      reviewerRole: actorRole(req),
      decision: body.decision,
      reviewNotes: body.reviewNotes,
      db: resolvePay02Db(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

// Non-authoritative calculation preview — never persists or authorizes Checkout (R1-B Section 5.2)
router.post('/api/pay02/quotes/preview', authenticatedSession, async (req, res) => {
  try {
    const body = req.body || {};
    const preview = previewPay02Quote({
      productCode: body.productCode,
      payerId: actorId(req),
      payerRole: actorRole(req) || 'buyer',
      sourceObjectType: body.sourceObjectType,
      sourceObjectId: body.sourceObjectId,
      currency: body.currency ?? null,
      providerKey: body.providerKey ?? null,
      idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || 'pay02_preview_only_non_authoritative',
      clientSubmittedAmount: body.amount ?? body.amountMinor,
      clientSubmittedCurrency: body.overrideCurrency,
      clientSubmittedMerchant: body.merchantOfRecord ?? body.merchant,
      clientSubmittedBeneficiary: body.legalBeneficiary ?? body.beneficiary,
      fxTargetCurrency: body.fxTargetCurrency,
    });
    return res.status(200).json({ preview });
  } catch (err) {
    return respondError(res, err);
  }
});

// Durable issued commercial quote — requires verified source object and atomic database persistence (R1-B Sections 5.1-5.4)
router.post('/api/pay02/quotes', authenticatedSession, async (req, res) => {
  try {
    const body = req.body || {};
    const quote = await createAndPersistPay02Quote({
      productCode: body.productCode,
      payerId: actorId(req),
      payerRole: actorRole(req) || 'buyer',
      sourceObjectType: body.sourceObjectType,
      sourceObjectId: body.sourceObjectId,
      currency: body.currency ?? null,
      providerKey: body.providerKey ?? null,
      idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey,
      clientSubmittedAmount: body.amount ?? body.amountMinor,
      clientSubmittedCurrency: body.overrideCurrency,
      clientSubmittedMerchant: body.merchantOfRecord ?? body.merchant,
      clientSubmittedBeneficiary: body.legalBeneficiary ?? body.beneficiary,
      fxTargetCurrency: body.fxTargetCurrency,
      db: resolvePay02Db(req),
    });
    return res.status(201).json({ quote });
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay02/admin/routing/evaluate', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const decision = evaluatePay02ProviderRoute({
      productCode: body.productCode,
      providerKey: body.providerKey,
      country: body.country,
      currency: body.currency,
      merchantOfRecord: body.merchantOfRecord ?? null,
      fundsOwner: body.fundsOwner ?? null,
      commercialCategory: body.commercialCategory ?? null,
      requestedCapabilities: body.requestedCapabilities || ['collect_payment'],
      liveRequested: Boolean(body.liveRequested),
    });
    return res.status(200).json({ decision });
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay02/imports/decompose', authenticatedSession, async (req, res) => {
  try {
    const body = req.body || {};
    const result = decomposeImportOrderObligations({
      importOrderId: body.importOrderId,
      payerId: actorId(req),
      lines: body.lines || [],
      attemptCombinedCarUpMerchantCharge: Boolean(body.attemptCombinedCarUpMerchantCharge),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

// Authoritative operational database reconciliation — rejects caller-supplied arrays (R1-D Section 7.1)
router.get('/api/pay02/admin/reporting/reconcile', adminSession, async (req, res) => {
  try {
    const report = await reconcilePay02OperationalFinancialTruth({
      db: resolvePay02Db(req),
    });
    return res.status(200).json({ report });
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay02/admin/reporting/reconcile', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const report = await reconcilePay02OperationalFinancialTruth({
      callerSuppliedPayload: body,
      db: resolvePay02Db(req),
    });
    return res.status(200).json({ report });
  } catch (err) {
    return respondError(res, err);
  }
});

// Explicit test-only simulation endpoint — stamped SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING (R1-D Section 7.1)
router.post('/api/pay02/admin/reporting/simulate', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const report = computePay02FinancialTruthReport({
      canonicalPayments: body.canonicalPayments || [],
      quotes: body.quotes || [],
      externalGarageDeclarations: body.externalGarageDeclarations || [],
      pilotEntitlements: body.pilotEntitlements || [],
      AttemptCrossCurrencySum: Boolean(body.attemptCrossCurrencySum),
      reportingMode: 'SIMULATED_INPUT',
    });
    return res.status(200).json({ report });
  } catch (err) {
    return respondError(res, err);
  }
});

export default router;
