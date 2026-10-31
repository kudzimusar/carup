/**
 * CARUP-PAY-02 — Commercial Catalogue, Quote Authority, Provider Routing & Governance Routes
 * Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
 *
 * Security invariants:
 * - Uses `authorizeSessionRole` (proven session authority; never trusts asserted headers in production).
 * - Admin governance endpoints require verified `admin` session role.
 * - Customer quote initiation rejects any client-supplied amount, currency override, merchant override, or beneficiary override.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { getPay02CatalogueItem } from '../services/payment/pay02CatalogueDefinitions.js';
import { Pay02Error, validateCatalogueEntry } from '../services/payment/pay02Contract.js';
import {
  listPay02Catalogue,
  createPay02GovernanceProposal,
  reviewPay02GovernanceProposal,
  createAndPersistPay02Quote,
  evaluatePay02ProviderRoute,
  decomposeImportOrderObligations,
  computePay02FinancialTruthReport,
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
    const result = listPay02Catalogue({
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
    const item = getPay02CatalogueItem(req.params.productCode);
    if (!item) {
      throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode: req.params.productCode });
    }
    return res.status(200).json({
      product: {
        ...item,
        validation: validateCatalogueEntry(item),
      },
    });
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
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

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
      // Only call DB RPC if explicitly requested or in live DB mode; buildServerAuthorizedQuote is deterministic
      db: req.app?.locals?.pay02Db || null,
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

router.post('/api/pay02/admin/reporting/reconcile', adminSession, async (req, res) => {
  try {
    const body = req.body || {};
    const report = computePay02FinancialTruthReport({
      canonicalPayments: body.canonicalPayments || [],
      quotes: body.quotes || [],
      externalGarageDeclarations: body.externalGarageDeclarations || [],
      pilotEntitlements: body.pilotEntitlements || [],
      AttemptCrossCurrencySum: Boolean(body.attemptCrossCurrencySum),
    });
    return res.status(200).json({ report });
  } catch (err) {
    return respondError(res, err);
  }
});

export default router;
