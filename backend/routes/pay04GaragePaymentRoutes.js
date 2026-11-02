/**
 * CARUP-PAY-04-LR01 — garage invoice payment routes.
 *
 * Authority invariants:
 *  - Identity always comes from the proven session (authorizeSessionRole), never the body. A customer acts only on
 *    invoices of cases they follow (requester or registered owner) and only on their OWN collections; an invoice or
 *    collection they may not see is a 404, never a 403 that confirms it exists.
 *  - Garage routes act on the garage proven by the auth middleware (x-tenant-id membership, garage admin role); the
 *    service and the database re-check the tenant and the admin role.
 *  - Operator routes require the platform admin role; the database re-checks it and separation of duties.
 *  - No browser-supplied merchant, gateway, currency or status is ever trusted: money state is a fresh provider read
 *    applied by the canonical database writer.
 *  - Provider, operator and simulator routes 404 unless CARUP_PAY04_ENABLED=true outside production; simulator routes
 *    additionally need CARUP_PAY04_PROVIDER_MODE=local_simulator. Payment instructions (Mode 1) are always available.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import { Pay04Error, isPay04Enabled, pay04Failure } from '../services/payment/pay04Contract.js';
import {
  cancelCustomerCollection, cancelGarageCollection, getCustomerInvoicePayment, getGarageFinancialOverview,
  getGarageInvoicePayments, getGaragePaymentInstructions, listGarageMerchantAccounts, listGaragePaymentExceptions,
  processGarageProviderEvent, reconcileGarageCollection, refundGarageCollection, registerGarageMerchantAccount,
  resolveGaragePaymentDiscrepancy, setGaragePaymentInstructions, startGarageInvoicePayment, suspendGarageMerchantAccount,
  verifyCustomerCollection,
} from '../services/payment/pay04GaragePaymentService.js';
import { Pay04GarageSimulatorProvider } from '../services/payment/pay04GarageSimulator.js';

const router = express.Router();
const memberSession = authorizeSessionRole([]);
const adminSession = authorizeSessionRole(['admin']);
const GARAGE_ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];
// Provider-calling routes are rate-limited in server.js (shared sensitive tier, 60 s window, mounted before this router).

const local = (req, key) => (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, key) ? req.app.locals[key] : undefined);
const dbFor = (req) => local(req, 'pay04Db') ?? supabase;
const envFor = (req) => local(req, 'pay04Env') ?? process.env;
const providerFor = (req) => local(req, 'pay04Provider') ?? null;
const header = (req, name) => { const v = req.headers?.[name]; return Array.isArray(v) ? v[0] : v || null; };
const idempotencyKey = (req) => header(req, 'idempotency-key') || req.body?.idempotency_key || null;
const actor = (req) => ({ id: req.userContext?.id || req.userContext?.userId || null, tenantId: req.userContext?.tenantId || null,
  platformRole: req.userContext?.platformRole || req.userContext?.baseRole || null });

function respondError(res, err) {
  const e = err instanceof Pay04Error ? err : pay04Failure(err);
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

function requirePay04(req, res, next) {
  if (!isPay04Enabled(envFor(req))) return res.status(404).json({ error: 'PAY04_DISABLED', code: 'PAY04_DISABLED' });
  return next();
}
const args = (req) => ({ db: dbFor(req), env: envFor(req), provider: providerFor(req), actor: actor(req) });

// ------------------------------------------------------------------------------------------ customer
router.get('/api/pay04/garage-invoices/:invoiceId/payment', memberSession, handle((req) => getCustomerInvoicePayment({
  ...args(req), invoiceId: req.params.invoiceId })));
router.post('/api/pay04/garage-invoices/:invoiceId/payments', requirePay04, memberSession, handle((req) => startGarageInvoicePayment({
  ...args(req), invoiceId: req.params.invoiceId, body: req.body || {}, idempotencyKey: idempotencyKey(req) }), 201));
router.post('/api/pay04/garage-payments/:collectionId/verify', requirePay04, memberSession, handle((req) =>
  verifyCustomerCollection({ ...args(req), collectionId: req.params.collectionId })));
router.post('/api/pay04/garage-payments/:collectionId/cancel', requirePay04, memberSession, handle((req) =>
  cancelCustomerCollection({ ...args(req), collectionId: req.params.collectionId, body: req.body || {} })));

// ------------------------------------------------------------------------------------------ garage administrator
router.get('/api/pay04/garage/payment-instructions', GARAGE_ADMIN, handle((req) => getGaragePaymentInstructions(args(req))));
router.put('/api/pay04/garage/payment-instructions', GARAGE_ADMIN, handle((req) => setGaragePaymentInstructions({
  ...args(req), body: req.body || {} })));
router.get('/api/pay04/garage/financial-overview', GARAGE_ADMIN, handle((req) => getGarageFinancialOverview(args(req))));
router.get('/api/pay04/garage/invoices/:invoiceId/payments', GARAGE_ADMIN, handle((req) => getGarageInvoicePayments({
  ...args(req), invoiceId: req.params.invoiceId })));
router.post('/api/pay04/garage/payments/:collectionId/refund', requirePay04, GARAGE_ADMIN, handle((req) =>
  refundGarageCollection({ ...args(req), collectionId: req.params.collectionId, body: req.body || {} })));
router.post('/api/pay04/garage/payments/:collectionId/reconcile', requirePay04, GARAGE_ADMIN, handle((req) =>
  reconcileGarageCollection({ ...args(req), collectionId: req.params.collectionId })));
router.post('/api/pay04/garage/payments/:collectionId/cancel', requirePay04, GARAGE_ADMIN, handle((req) =>
  cancelGarageCollection({ ...args(req), collectionId: req.params.collectionId, body: req.body || {} })));

// ------------------------------------------------------------------------------------------ platform operator
router.get('/api/pay04/admin/exceptions', requirePay04, adminSession, handle((req) => listGaragePaymentExceptions(args(req))));
router.post('/api/pay04/admin/discrepancies/:discrepancyId/resolve', requirePay04, adminSession, handle((req) =>
  resolveGaragePaymentDiscrepancy({ ...args(req), discrepancyId: req.params.discrepancyId, body: req.body || {} })));
router.get('/api/pay04/admin/merchant-accounts', requirePay04, adminSession, handle((req) => listGarageMerchantAccounts(args(req))));
router.post('/api/pay04/admin/merchant-accounts', requirePay04, adminSession, handle((req) => registerGarageMerchantAccount({
  ...args(req), body: req.body || {} }), 201));
router.post('/api/pay04/admin/merchant-accounts/:accountId/suspend', requirePay04, adminSession, handle((req) =>
  suspendGarageMerchantAccount({ ...args(req), accountId: req.params.accountId, body: req.body || {} })));

// ------------------------------------------------------------------------------------------ local simulator (UAT)
function simulatorFor(req) {
  const env = envFor(req);
  if (!isPay04Enabled(env) || env.CARUP_PAY04_PROVIDER_MODE !== 'local_simulator') throw new Pay04Error('PAY04_SIMULATOR_REFUSED', 404);
  const injected = providerFor(req);
  return injected?.isSimulator ? injected : new Pay04GarageSimulatorProvider({ env });
}

/** Deliver simulator events over the real HTTP webhook path (signature, raw body, verification, dispatch). */
async function deliverSimulatorEvents(simulator, events) {
  const results = [];
  for (const event of events) {
    const { rawBody, signature } = simulator.signEvent(event);
    const response = await fetch(`${simulator.config.publicOrigin}/api/pay04/simulator/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pay04-simulator-signature': signature }, body: rawBody,
    });
    results.push({ type: event.type, status: response.status });
  }
  return results;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatMinor = (amountMinor, currency) => {
  const scale = ['JPY', 'KRW', 'VND', 'UGX', 'RWF', 'XAF', 'XOF'].includes(currency) ? 0 : 2;
  return `${currency} ${(Number(amountMinor) / 10 ** scale).toFixed(scale)}`;
};

function simulatorPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — SIMULATED GARAGE PAYMENT PROVIDER</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem;color:#0f172a}
.banner{background:#7c2d12;color:#fff;padding:.75rem 1rem;border-radius:.5rem;font-weight:700}
.card{border:1px solid #cbd5e1;border-radius:.75rem;padding:1rem;margin-top:1rem}
button{font-size:1rem;min-height:44px;padding:.6rem 1rem;margin:.25rem .5rem .25rem 0;border-radius:.5rem;border:1px solid #334155;cursor:pointer;background:#fff;color:#0f172a}
.pay{background:#166534;color:#fff;border-color:#166534}</style></head>
<body><div class="banner" data-testid="pay04-simulator-banner">SIMULATED GARAGE PAYMENT PROVIDER — not a real provider. No money moves. Local test only.</div>${body}</body></html>`;
}

router.post('/api/pay04/simulator/webhook', async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const rawBody = req.rawBodyBytes || (typeof req.rawBody === 'string' ? Buffer.from(req.rawBody) : null);
    const event = simulator.verifyWebhook({ rawBody, signature: header(req, 'x-pay04-simulator-signature') });
    return res.status(200).json(await processGarageProviderEvent({ db: dbFor(req), env: envFor(req), provider: simulator, event }));
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay04/simulator/checkout/:checkoutId', (req, res) => {
  try {
    const model = simulatorFor(req).checkoutPageModel(req.params.checkoutId);
    const open = model.status === 'open';
    return res.status(200).type('html').send(simulatorPage('Pay the garage', `
<div class="card"><h1>Pay the garage</h1>
<p>Merchant: <strong data-testid="pay04-simulator-merchant">${escapeHtml(model.merchantReference)}</strong> (the garage’s own simulated account, not CarUp)</p>
<p data-testid="pay04-simulator-amount">${escapeHtml(formatMinor(model.amountMinor, model.currency))}</p>
<p>Status: <strong data-testid="pay04-simulator-checkout-status">${escapeHtml(model.status)}</strong></p>
${open ? `<form method="post" action="/api/pay04/simulator/checkout/${escapeHtml(model.id)}/complete">
<button class="pay" name="outcome" value="success" data-testid="pay04-simulator-pay">Pay (simulated)</button>
<button name="outcome" value="decline" data-testid="pay04-simulator-decline">Decline card (simulated)</button>
<button name="outcome" value="expire" data-testid="pay04-simulator-expire">Abandon checkout</button></form>` : ''}
<p><a href="${escapeHtml(model.cancelUrl)}" data-testid="pay04-simulator-back">Back to CarUp</a></p></div>`));
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay04/simulator/checkout/:checkoutId/complete', async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const model = simulator.checkoutPageModel(req.params.checkoutId);
    const outcome = ['success', 'decline', 'expire'].includes(req.body?.outcome) ? req.body.outcome : 'success';
    const result = await simulator.completeCheckout(req.params.checkoutId, { outcome });
    await deliverSimulatorEvents(simulator, result.events);
    if (result.declined) {
      return res.status(402).type('html').send(simulatorPage('Card declined', `<div class="card"><h1>Card declined (simulated)</h1>
<p data-testid="pay04-simulator-declined">Nothing was charged. The garage has not been paid.</p>
<p><a href="/api/pay04/simulator/checkout/${escapeHtml(model.id)}">Try again</a> · <a href="${escapeHtml(model.cancelUrl)}">Back to CarUp</a></p></div>`));
    }
    return res.redirect(303, outcome === 'success' ? model.successUrl : model.cancelUrl);
  } catch (err) {
    return respondError(res, err);
  }
});

// UAT fault injection (platform administrator only): a refund made directly at the provider, or a provider report that
// does not match — the evidence the reconciliation and discrepancy paths exist for.
router.post('/api/pay04/simulator/payments/:paymentId/external-refund', adminSession, async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const result = await simulator.createExternalRefund({ paymentId: req.params.paymentId, amountMinor: Number(req.body?.amountMinor),
      pending: req.body?.pending === true });
    return res.status(200).json({ simulated: true, refundId: result.refundId, delivered: await deliverSimulatorEvents(simulator, result.events) });
  } catch (err) {
    return respondError(res, err);
  }
});
router.post('/api/pay04/simulator/payments/:paymentId/misreport', adminSession, async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const result = await simulator.misreport({ paymentId: req.params.paymentId, amountMinor: req.body?.amountMinor ?? null,
      currency: req.body?.currency ?? null, merchantReference: req.body?.merchantReference ?? null, unavailable: req.body?.unavailable === true });
    return res.status(200).json({ simulated: true, fault: result.fault, delivered: await deliverSimulatorEvents(simulator, result.events) });
  } catch (err) {
    return respondError(res, err);
  }
});

export default router;
