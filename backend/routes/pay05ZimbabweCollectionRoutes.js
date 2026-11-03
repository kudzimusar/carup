/**
 * CARUP-PAY-05-LR01 — Zimbabwe collections through the garage's own Paynow merchant.
 *
 * Paying an invoice, checking it, stopping it and the garage's reconcile/refund actions stay on the PAY-04 routes (they
 * dispatch a Paynow collection to the PAY-05 service). This router adds only what Paynow needs:
 *  - POST /api/pay05/paynow/webhook/:collectionId   Paynow's resulturl. No session and no CSRF token can exist on a
 *    provider's POST: it is authenticated by the SHA-512 hash with THIS collection's own integration key, bound to the
 *    collection's reference and poll URL, and its money effect is a fresh poll. Rate-limited in server.js. Every refusal
 *    gets one identical answer (400 PAY05_STATUS_UPDATE_REFUSED). 503 PAY05_STATUS_UPDATE_RETRY asks Paynow to resend: a
 *    transient failure, a confirming poll that was not evaluated or does not yet agree, or a spent read budget.
 *  - O'mari one-time password (the customer, own collection only).
 *  - The garage administrator's Paynow connection (connect / view / disconnect). Identity and tenant come from the session;
 *    the integration key is sealed before storage and never returned.
 *  - The CarUp operator: verification (server-side credential probes), rejection, suspension, Paynow availability,
 *    provider errors, hold release, reconcile. The database re-checks the platform role and separation of duties.
 * Everything 404s unless CARUP_PAY05_ENABLED=true (with PAY-04) outside production.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import { Pay04Error } from '../services/payment/pay04Contract.js';
import { Pay05Error, PAY05_GATEWAY, isPay05Enabled, pay05Failure } from '../services/payment/pay05Contract.js';
import {
  connectGaragePaynow, disconnectGaragePaynow, getGaragePaynowConnection, getPaynowAvailability, listPaynowMerchants,
  listPaynowProviderErrors, rejectPaynowMerchant, setPaynowAvailability, suspendPaynowMerchant, verifyPaynowMerchant,
} from '../services/payment/pay05MerchantService.js';
import {
  listHeldPaynowCollections, processPaynowStatusUpdate, reconcilePaynowCollection, releasePaynowHold, submitPaynowOtp,
} from '../services/payment/pay05PaynowCollectionService.js';
import { loadCollection } from '../services/payment/pay04GaragePaymentService.js';

const router = express.Router();
const memberSession = authorizeSessionRole([]);
const adminSession = authorizeSessionRole(['admin']);
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];

const local = (req, key) => (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, key) ? req.app.locals[key] : undefined);
const dbFor = (req) => local(req, 'pay05Db') ?? local(req, 'pay04Db') ?? supabase;
const envFor = (req) => local(req, 'pay05Env') ?? local(req, 'pay04Env') ?? process.env;
const transportFor = (req) => local(req, 'pay05Transport') ?? null;
const actor = (req) => ({ id: req.userContext?.id || req.userContext?.userId || null, tenantId: req.userContext?.tenantId || null,
  platformRole: req.userContext?.platformRole || req.userContext?.baseRole || null });
const args = (req) => ({ db: dbFor(req), env: envFor(req), transport: transportFor(req), actor: actor(req) });

function respondError(res, err) {
  const e = err instanceof Pay04Error ? err : pay05Failure(err);
  const status = e.status || 409;
  return res.status(status).json({ error: e.code, code: e.code, ...(e.details && status < 500 ? { details: e.details } : {}) });
}

const handle = (fn, status = 200) => async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(status).json(await fn(req));
  } catch (err) {
    return respondError(res, err);
  }
};

function requirePay05(req, res, next) {
  if (!isPay05Enabled(envFor(req))) return res.status(404).json({ error: 'PAY05_DISABLED', code: 'PAY05_DISABLED' });
  return next();
}

async function paynowCollection(req) {
  const collection = await loadCollection(dbFor(req), req.params.collectionId);
  if (collection.gateway !== PAY05_GATEWAY) throw new Pay05Error('PAY05_COLLECTION_NOT_FOUND', 404);
  return collection;
}

// ------------------------------------------------------------------------------------------ Paynow -> CarUp
router.post('/api/pay05/paynow/webhook/:collectionId', requirePay05, async (req, res) => {
  try {
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
    const out = await processPaynowStatusUpdate({ db: dbFor(req), env: envFor(req), transport: transportFor(req),
      collectionId: req.params.collectionId, rawBody });
    return res.status(200).json({ ok: true, duplicate: Boolean(out.duplicate_event), applied: Boolean(out.applied) });
  } catch (err) {
    const e = err instanceof Pay04Error ? err : pay05Failure(err);
    // Paynow resends on any HTTP error. A caller without the integration key learns nothing here: every refusal (no such
    // collection, malformed, unsigned, forged, foreign) gets the same answer, and only a transient failure on CarUp's side
    // (Paynow unreachable for the confirming poll, its answer not yet confirming) asks for the retry (independent review S5).
    // The specific reason is recorded for the operator (pay05_provider_errors), not returned.
    if ((e.status || 409) >= 500) return res.status(503).json({ error: 'PAY05_STATUS_UPDATE_RETRY' });
    return res.status(400).json({ error: 'PAY05_STATUS_UPDATE_REFUSED' });
  }
});

// ------------------------------------------------------------------------------------------ customer
router.post('/api/pay05/garage-payments/:collectionId/otp', requirePay05, memberSession, handle((req) => submitPaynowOtp({
  ...args(req), collectionId: req.params.collectionId, body: req.body || {} })));

// ------------------------------------------------------------------------------------------ garage administrator
router.get('/api/pay05/garage/paynow', requirePay05, GARAGE_ADMIN, handle((req) => getGaragePaynowConnection(args(req))));
router.post('/api/pay05/garage/paynow/connect', requirePay05, GARAGE_ADMIN, handle((req) => connectGaragePaynow({
  ...args(req), body: req.body || {} }), 201));
router.post('/api/pay05/garage/paynow/disconnect', requirePay05, GARAGE_ADMIN, handle((req) => disconnectGaragePaynow({
  ...args(req), body: req.body || {} })));

// ------------------------------------------------------------------------------------------ CarUp operator
router.get('/api/pay05/admin/merchants', requirePay05, adminSession, handle((req) => listPaynowMerchants(args(req))));
router.post('/api/pay05/admin/merchants/:merchantAccountId/verify', requirePay05, adminSession, handle((req) => verifyPaynowMerchant({
  ...args(req), merchantAccountId: req.params.merchantAccountId, body: req.body || {} })));
router.post('/api/pay05/admin/merchants/:merchantAccountId/reject', requirePay05, adminSession, handle((req) => rejectPaynowMerchant({
  ...args(req), merchantAccountId: req.params.merchantAccountId, body: req.body || {} })));
router.post('/api/pay05/admin/merchants/:merchantAccountId/suspend', requirePay05, adminSession, handle((req) => suspendPaynowMerchant({
  ...args(req), merchantAccountId: req.params.merchantAccountId, body: req.body || {} })));
router.get('/api/pay05/admin/availability', requirePay05, adminSession, handle((req) => getPaynowAvailability(args(req))));
router.put('/api/pay05/admin/availability', requirePay05, adminSession, handle((req) => setPaynowAvailability({
  ...args(req), body: req.body || {} })));
router.get('/api/pay05/admin/provider-errors', requirePay05, adminSession, handle((req) => listPaynowProviderErrors(args(req))));
router.get('/api/pay05/admin/held-collections', requirePay05, adminSession, handle((req) => listHeldPaynowCollections(args(req))));
router.post('/api/pay05/admin/collections/:collectionId/release-hold', requirePay05, adminSession, handle((req) => releasePaynowHold({
  ...args(req), collectionId: req.params.collectionId, body: req.body || {} })));
router.post('/api/pay05/admin/collections/:collectionId/reconcile', requirePay05, adminSession, handle(async (req) =>
  reconcilePaynowCollection({ ...args(req), collection: await paynowCollection(req) })));

export default router;
