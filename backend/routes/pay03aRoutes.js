/**
 * CARUP-PAY-03A — Real Vehicle History Report Sandbox Commerce Routes
 * Authority: GitHub Issue #247 & Moderator CARUP-PAY-03A Directive
 *
 * Security & Authority Invariants:
 * - Uses `authorizeSessionRole` (proven session authority; never trusts asserted headers).
 * - Buyer endpoints enforce authenticated session ownership (`buyerId === actorId(req)`).
 * - Admin endpoints require verified `admin` session role.
 * - Report retrieval sets `Cache-Control: private, no-store` and verifies fresh provider/canonical
 *   payment status before serving the buyer-safe report snapshot.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { Pay01aError } from '../services/payment/pay01aContract.js';
import { Pay02Error } from '../services/payment/pay02Contract.js';
import {
  listEligibleReportVehicles,
  inspectVehicleReportReadiness,
  createPay03aReportCheckout,
  listPay03aBuyerOrders,
  verifyPay03aBuyerOrder,
  readPay03aBuyerReport,
  createPay03aBuyerShareLink,
  listPay03aAdminOrders,
  readPay03aAdminOrder,
  reconcileAndFulfillPay03aAdminOrder,
  refundPay03aAdminOrder,
} from '../services/payment/pay03aReportCommerceService.js';

const router = express.Router();
const buyerSession = authorizeSessionRole([]);
const adminSession = authorizeSessionRole(['admin']);

function actorId(req) {
  return req.userContext?.id || req.userContext?.userId || null;
}

function actorRole(req) {
  return req.userContext?.effectiveRole || req.userContext?.role || 'buyer';
}

// STG01-FINAL F11: administrator audits record the PLATFORM role. The effective role can be shaped by
// tenant headers (x-tenant-id / x-stakeholder-role); the platform role cannot.
function adminPlatformRole(req) {
  return req.userContext?.platformRole || req.userContext?.baseRole || 'admin';
}

// Request provenance for the canonical audit record. Identity itself always comes from the proven
// session (`req.userContext`), never from the request body.
function auditRequestContext(req) {
  const header = (name) => {
    const value = req.headers?.[name];
    return Array.isArray(value) ? value[0] : value || null;
  };
  return {
    requestId: req.requestId || req.correlationId || header('x-request-id') || header('x-correlation-id'),
    ipAddress: req.ip || null,
    userAgent: header('user-agent'),
  };
}

function resolvePay03aDb(req) {
  if (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, 'pay03aDb')) {
    return req.app.locals.pay03aDb;
  }
  if (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, 'pay02Db')) {
    return req.app.locals.pay02Db;
  }
  return supabase;
}

function resolvePay03aStripe(req) {
  if (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, 'pay03aStripe')) {
    return req.app.locals.pay03aStripe;
  }
  return null;
}

function respondError(res, err) {
  if (err instanceof Pay02Error || err instanceof Pay01aError) {
    const status = err.status || 409;
    return res.status(status).json({
      error: err.code,
      code: err.code,
      // STG01-FINAL F10: curated details only on 4xx; 5xx details can carry raw database/RPC messages.
      ...(err.details && status < 500 ? { details: err.details } : {}),
    });
  }
  return res.status(503).json({
    error: 'PAY03A_OPERATION_UNAVAILABLE',
    code: 'PAY03A_OPERATION_UNAVAILABLE',
  });
}

// 1. Pre-purchase vehicle discovery & report readiness (Sections 6 & 12)
router.get('/api/pay03a/vehicles', buyerSession, async (req, res) => {
  try {
    const result = await listEligibleReportVehicles({
      search: req.query.search || '',
      limit: req.query.limit || 20,
      db: resolvePay03aDb(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03a/vehicles/:vin/readiness', buyerSession, async (req, res) => {
  try {
    const result = await inspectVehicleReportReadiness({
      vin: req.params.vin,
      buyerId: actorId(req),
      db: resolvePay03aDb(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

// 2. Customer purchase initiation & Stripe sandbox Checkout creation (Sections 8, 9 & 10)
router.post('/api/pay03a/orders/checkout', buyerSession, async (req, res) => {
  try {
    const body = req.body || {};
    const requestKey = req.headers['idempotency-key'] || body.idempotencyKey;
    const result = await createPay03aReportCheckout({
      buyerId: actorId(req),
      buyerRole: actorRole(req),
      vin: body.vin,
      requestKey,
      clientSubmittedAmount: body.amount ?? body.amountMinor,
      clientSubmittedCurrency: body.currency ?? body.overrideCurrency,
      clientSubmittedMerchant: body.merchantOfRecord ?? body.merchant,
      clientSubmittedBeneficiary: body.legalBeneficiary ?? body.beneficiary,
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(201).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

// 3. Customer order history, verification, report access & share links (Sections 11, 13 & 14)
router.get('/api/pay03a/orders', buyerSession, async (req, res) => {
  try {
    const result = await listPay03aBuyerOrders({
      buyerId: actorId(req),
      db: resolvePay03aDb(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03a/orders/:orderId', buyerSession, async (req, res) => {
  try {
    const result = await verifyPay03aBuyerOrder({
      buyerId: actorId(req),
      orderId: req.params.orderId,
      refresh: false,
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03a/orders/:orderId/verify', buyerSession, async (req, res) => {
  try {
    const result = await verifyPay03aBuyerOrder({
      buyerId: actorId(req),
      orderId: req.params.orderId,
      refresh: true,
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03a/orders/:orderId/report', buyerSession, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    const result = await readPay03aBuyerReport({
      buyerId: actorId(req),
      orderId: req.params.orderId,
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03a/orders/:orderId/share', buyerSession, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await createPay03aBuyerShareLink({
      buyerId: actorId(req),
      orderId: req.params.orderId,
      ttlSeconds: body.ttlSeconds,
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(201).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

// 4. Admin operational visibility & governed refunds (Sections 14 & 16)
router.get('/api/pay03a/admin/orders', adminSession, async (req, res) => {
  try {
    const result = await listPay03aAdminOrders({
      db: resolvePay03aDb(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03a/admin/orders/:orderId', adminSession, async (req, res) => {
  try {
    const result = await readPay03aAdminOrder({
      orderId: req.params.orderId,
      db: resolvePay03aDb(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03a/admin/orders/:orderId/reconcile', adminSession, async (req, res) => {
  try {
    const result = await reconcileAndFulfillPay03aAdminOrder({
      orderId: req.params.orderId,
      adminActorId: actorId(req),
      adminActorRole: adminPlatformRole(req),
      sourceRoute: '/api/pay03a/admin/orders/:orderId/reconcile',
      requestContext: auditRequestContext(req),
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03a/admin/orders/:orderId/refund', adminSession, async (req, res) => {
  try {
    const result = await refundPay03aAdminOrder({
      orderId: req.params.orderId,
      adminActorId: actorId(req),
      adminActorRole: adminPlatformRole(req),
      sourceRoute: '/api/pay03a/admin/orders/:orderId/refund',
      requestContext: auditRequestContext(req),
      db: resolvePay03aDb(req),
      stripe: resolvePay03aStripe(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
});

export default router;
