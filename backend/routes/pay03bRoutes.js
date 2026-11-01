/**
 * CARUP-PAY-03B-LR01 — Dealer & Business subscription routes, F5 reconciliation operator routes and the local
 * provider simulator (disposable UAT only).
 *
 * Authority invariants:
 *  - Identity always comes from the proven session (authorizeSessionRole: no x-user-id fallback), never the body.
 *  - Dealer routes act on the tenant proven by the auth middleware (x-tenant-id membership); the service and the
 *    database re-check membership, the legal organization binding and billing authority.
 *  - Administrator routes require the platform admin role; audits record the PLATFORM role.
 *  - No browser-supplied price, currency, provider or merchant is ever used; the acknowledged terms are only
 *    compared with the governed plan version.
 *  - Simulator routes 404 unless CARUP_PAY03B_PROVIDER_MODE=local_simulator in a non-production runtime.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { Pay01aError } from '../services/payment/pay01aContract.js';
import { Pay03bError, isPay03bProductionRuntime } from '../services/payment/pay03bContract.js';
import {
  getPay03bPublicCatalogue, getPay03bAdminCatalogue, getPay03bDealerOverview, createPay03bDealerCheckout,
  verifyPay03bDealerSubscription, previewPay03bDealerPlanChange, changePay03bDealerPlan, cancelPay03bDealerSubscription,
  createPay03bPaymentMethodUpdate, getPay03bInvoicePaymentLink, listPay03bAdminSubscriptions, readPay03bAdminSubscription,
  reconcilePay03bAdminSubscription, setPay03bAdminSuspension, refundPay03bAdminInvoice, processPay03bProviderEvent,
} from '../services/payment/pay03bSubscriptionService.js';
import {
  listPay03bReconciliationExceptions, readPay03bReconciliationException, acknowledgePay03bReconciliationException,
  resolvePay03bReconciliationException,
} from '../services/payment/pay03bReconciliationService.js';
import { Pay03bLocalSimulatorProvider } from '../services/payment/pay03bLocalSimulator.js';

const router = express.Router();
const memberSession = authorizeSessionRole([]);
const adminSession = authorizeSessionRole(['admin']);

const actorId = (req) => req.userContext?.id || req.userContext?.userId || null;
const adminPlatformRole = (req) => req.userContext?.platformRole || req.userContext?.baseRole || 'admin';
const tenantId = (req) => req.userContext?.tenantId || null;
const local = (req, key) => (req.app?.locals && Object.prototype.hasOwnProperty.call(req.app.locals, key) ? req.app.locals[key] : undefined);
const dbFor = (req) => local(req, 'pay03bDb') ?? supabase;
const providerFor = (req) => local(req, 'pay03bProvider') ?? null;
const stripeFor = (req) => local(req, 'pay03bStripe') ?? null;
const envFor = (req) => local(req, 'pay03bEnv') ?? process.env;
const header = (req, name) => { const v = req.headers?.[name]; return Array.isArray(v) ? v[0] : v || null; };
const requestContext = (req) => ({
  requestId: req.requestId || req.correlationId || header(req, 'x-request-id') || header(req, 'x-correlation-id'),
  ipAddress: req.ip || null,
  userAgent: header(req, 'user-agent'),
});
const idempotencyKey = (req) => header(req, 'idempotency-key') || req.body?.idempotencyKey || null;

function respondError(res, err) {
  if (err instanceof Pay03bError || err instanceof Pay01aError) {
    const status = err.status || 409;
    return res.status(status).json({ error: err.code, code: err.code, ...(err.details && status < 500 ? { details: err.details } : {}) });
  }
  return res.status(503).json({ error: 'PAY03B_OPERATION_UNAVAILABLE', code: 'PAY03B_OPERATION_UNAVAILABLE' });
}

const handle = (fn, status = 200) => async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.status(status).json(await fn(req));
  } catch (err) {
    return respondError(res, err);
  }
};

function requireTenant(req) {
  const id = tenantId(req);
  if (!id) throw new Pay03bError('PAY03B_TENANT_CONTEXT_REQUIRED', 400);
  return id;
}

// Explicit opt-in (same rule PAY-03A adopted after its independent review): every dealer and administrator
// subscription route is dark unless CARUP_PAY03B_ENABLED is 'true' in a non-production runtime. The public
// catalogue stays readable everywhere (governance status only; it never shows a price as an offer).
function requirePay03bEnabled(req, res, next) {
  const env = envFor(req);
  if (env.CARUP_PAY03B_ENABLED !== 'true' || isPay03bProductionRuntime(env)) {
    return res.status(404).json({ error: 'PAY03B_DISABLED', code: 'PAY03B_DISABLED' });
  }
  return next();
}
router.use('/api/pay03b/dealer', requirePay03bEnabled);
router.use('/api/pay03b/admin/subscriptions', requirePay03bEnabled);
router.use('/api/pay03b/admin/catalogue', requirePay03bEnabled);

// ------------------------------------------------------------------------------------------ public catalogue
router.get('/api/pay03b/catalogue', handle((req) => getPay03bPublicCatalogue({ db: dbFor(req) })));

// ------------------------------------------------------------------------------------------ dealer
const dealerArgs = (req) => ({ db: dbFor(req), env: envFor(req), provider: providerFor(req), stripe: stripeFor(req),
  actorId: actorId(req), tenantId: requireTenant(req) });

router.get('/api/pay03b/dealer/subscription', memberSession, handle((req) => getPay03bDealerOverview(dealerArgs(req))));
router.post('/api/pay03b/dealer/subscription/checkout', memberSession, handle((req) => createPay03bDealerCheckout({
  ...dealerArgs(req), planId: req.body?.planId, acknowledgedTerms: req.body?.acknowledgedTerms, requestKey: idempotencyKey(req),
  requestContext: requestContext(req) }), 201));
router.post('/api/pay03b/dealer/subscription/verify', memberSession, handle((req) => verifyPay03bDealerSubscription(dealerArgs(req))));
router.get('/api/pay03b/dealer/subscription/change-preview', memberSession, handle((req) => previewPay03bDealerPlanChange({
  ...dealerArgs(req), targetPlanId: req.query?.targetPlanId, mode: req.query?.mode })));
router.post('/api/pay03b/dealer/subscription/change', memberSession, handle((req) => changePay03bDealerPlan({
  ...dealerArgs(req), targetPlanId: req.body?.targetPlanId, mode: req.body?.mode, requestKey: idempotencyKey(req) })));
router.post('/api/pay03b/dealer/subscription/cancel', memberSession, handle((req) => cancelPay03bDealerSubscription({
  ...dealerArgs(req), mode: req.body?.mode, reason: req.body?.reason, requestKey: idempotencyKey(req) })));
router.post('/api/pay03b/dealer/subscription/payment-method', memberSession, handle((req) => createPay03bPaymentMethodUpdate(dealerArgs(req))));
router.post('/api/pay03b/dealer/subscription/invoices/:invoiceId/pay', memberSession, handle((req) => getPay03bInvoicePaymentLink({
  ...dealerArgs(req), invoiceId: req.params.invoiceId })));

// ------------------------------------------------------------------------------------------ administrator
const adminArgs = (req) => ({ db: dbFor(req), env: envFor(req), provider: providerFor(req), stripe: stripeFor(req),
  adminActorId: actorId(req), adminActorRole: adminPlatformRole(req), requestContext: requestContext(req) });

router.get('/api/pay03b/admin/catalogue', adminSession, handle((req) => getPay03bAdminCatalogue({ db: dbFor(req), env: envFor(req) })));
router.get('/api/pay03b/admin/subscriptions', adminSession, handle((req) => listPay03bAdminSubscriptions({ db: dbFor(req) })));
router.get('/api/pay03b/admin/subscriptions/:subscriptionId', adminSession, handle((req) => readPay03bAdminSubscription({
  db: dbFor(req), subscriptionId: req.params.subscriptionId })));
router.post('/api/pay03b/admin/subscriptions/:subscriptionId/reconcile', adminSession, handle((req) => reconcilePay03bAdminSubscription({
  ...adminArgs(req), subscriptionId: req.params.subscriptionId })));
router.post('/api/pay03b/admin/subscriptions/:subscriptionId/suspension', adminSession, handle((req) => setPay03bAdminSuspension({
  ...adminArgs(req), subscriptionId: req.params.subscriptionId, action: req.body?.action, reason: req.body?.reason,
  requestKey: idempotencyKey(req) })));
router.post('/api/pay03b/admin/subscriptions/:subscriptionId/invoices/:invoiceId/refund', adminSession, handle((req) => refundPay03bAdminInvoice({
  ...adminArgs(req), subscriptionId: req.params.subscriptionId, invoiceId: req.params.invoiceId, reason: req.body?.reason })));

router.get('/api/pay03b/admin/reconciliation-exceptions', adminSession, handle((req) => listPay03bReconciliationExceptions({
  db: dbFor(req), env: envFor(req), status: req.query?.status || 'open' })));
router.get('/api/pay03b/admin/reconciliation-exceptions/:exceptionId', adminSession, handle((req) => readPay03bReconciliationException({
  db: dbFor(req), env: envFor(req), provider: providerFor(req), stripe: stripeFor(req), exceptionId: req.params.exceptionId,
  verify: req.query?.verify === '1' })));
router.post('/api/pay03b/admin/reconciliation-exceptions/:exceptionId/acknowledge', adminSession, handle((req) =>
  acknowledgePay03bReconciliationException({ ...adminArgs(req), exceptionId: req.params.exceptionId,
    sourceRoute: '/api/pay03b/admin/reconciliation-exceptions/acknowledge' })));
router.post('/api/pay03b/admin/reconciliation-exceptions/:exceptionId/resolve', adminSession, handle((req) =>
  resolvePay03bReconciliationException({ ...adminArgs(req), exceptionId: req.params.exceptionId, resolution: req.body?.resolution,
    note: req.body?.note, sourceRoute: '/api/pay03b/admin/reconciliation-exceptions/resolve' })));

// ------------------------------------------------------------------------------------------ local simulator (UAT)
function simulatorFor(req) {
  const env = envFor(req);
  if (env.CARUP_PAY03B_PROVIDER_MODE !== 'local_simulator') throw new Pay03bError('PAY03B_SIMULATOR_REFUSED', 404);
  const injected = providerFor(req);
  return injected?.isSimulator ? injected : new Pay03bLocalSimulatorProvider({ env });
}

/** Deliver simulator events over the real HTTP webhook path (signature, raw body, verification, dispatch). */
async function deliverSimulatorEvents(req, simulator, events) {
  const results = [];
  for (const event of events) {
    const { rawBody, signature } = simulator.signEvent(event);
    const response = await fetch(`${simulator.config.publicOrigin}/api/pay03b/simulator/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pay03b-simulator-signature': signature }, body: rawBody,
    });
    results.push({ type: event.type, status: response.status });
  }
  return results;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function simulatorPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — SIMULATED PROVIDER</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem;color:#0f172a}
.banner{background:#7c2d12;color:#fff;padding:.75rem 1rem;border-radius:.5rem;font-weight:700}
.card{border:1px solid #cbd5e1;border-radius:.75rem;padding:1rem;margin-top:1rem}
button{font-size:1rem;padding:.6rem 1rem;margin:.25rem .5rem .25rem 0;border-radius:.5rem;border:1px solid #334155;cursor:pointer}
.pay{background:#166534;color:#fff;border-color:#166534}</style></head>
<body><div class="banner" data-testid="pay03b-simulator-banner">SIMULATED PROVIDER — NOT STRIPE. No money moves. Local UAT only.</div>${body}</body></html>`;
}

const formatMinor = (amountMinor, currency) => `${currency} ${Number(amountMinor).toLocaleString('en-US')}`;

router.post('/api/pay03b/simulator/webhook', async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const rawBody = req.rawBodyBytes || (typeof req.rawBody === 'string' ? Buffer.from(req.rawBody) : null);
    const event = simulator.verifyWebhook({ rawBody, signature: header(req, 'x-pay03b-simulator-signature') });
    return res.status(200).json(await processPay03bProviderEvent({ db: dbFor(req), provider: simulator, event }));
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03b/simulator/checkout/:checkoutId', (req, res) => {
  try {
    const model = simulatorFor(req).checkoutPageModel(req.params.checkoutId);
    const open = model.status === 'open';
    return res.status(200).type('html').send(simulatorPage('Subscription checkout', `
<div class="card"><h1>Subscription checkout</h1>
<p data-testid="pay03b-simulator-amount">${escapeHtml(formatMinor(model.amountMinor, model.currency))} per period (sandbox test plan)</p>
<p>Status: <strong data-testid="pay03b-simulator-checkout-status">${escapeHtml(model.status)}</strong></p>
${open ? `<form method="post" action="/api/pay03b/simulator/checkout/${escapeHtml(model.id)}/complete">
<button class="pay" name="outcome" value="success" data-testid="pay03b-simulator-pay">Pay (simulated)</button>
<button name="outcome" value="decline" data-testid="pay03b-simulator-decline">Decline card (simulated)</button>
<button name="outcome" value="expire" data-testid="pay03b-simulator-expire">Abandon checkout</button></form>` : ''}
<p><a href="${escapeHtml(model.cancelUrl)}" data-testid="pay03b-simulator-back">Back to CarUp</a></p></div>`));
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03b/simulator/checkout/:checkoutId/complete', async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const model = simulator.checkoutPageModel(req.params.checkoutId);
    const outcome = req.body?.outcome || 'success';
    const result = await simulator.completeCheckout(req.params.checkoutId, { outcome });
    await deliverSimulatorEvents(req, simulator, result.events);
    if (result.declined) {
      return res.status(402).type('html').send(simulatorPage('Card declined', `<div class="card"><h1>Card declined (simulated)</h1>
<p data-testid="pay03b-simulator-declined">No subscription was created. Nothing was charged.</p>
<p><a href="/api/pay03b/simulator/checkout/${escapeHtml(model.id)}">Try again</a></p></div>`));
    }
    return res.redirect(303, outcome === 'success' ? model.successUrl : model.cancelUrl);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03b/simulator/invoice/:invoiceId', async (req, res) => {
  try {
    const invoice = await simulatorFor(req).getInvoice(req.params.invoiceId);
    return res.status(200).type('html').send(simulatorPage('Outstanding invoice', `
<div class="card"><h1>Outstanding invoice</h1>
<p data-testid="pay03b-simulator-invoice-amount">${escapeHtml(formatMinor(invoice.amountDueMinor, invoice.currency))}</p>
<p>Status: <strong>${escapeHtml(invoice.status)}</strong></p>
${invoice.status === 'open' ? `<form method="post" action="/api/pay03b/simulator/invoice/${escapeHtml(invoice.id)}/pay">
<button class="pay" data-testid="pay03b-simulator-pay-invoice">Pay invoice (simulated)</button></form>` : ''}</div>`));
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03b/simulator/invoice/:invoiceId/pay', async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const result = await simulator.payOpenInvoice(req.params.invoiceId);
    await deliverSimulatorEvents(req, simulator, result.events);
    const origin = String(envFor(req).CARUP_PAY01A_RETURN_ORIGIN || '').replace(/\/$/, '');
    return res.redirect(303, `${origin}/dealer/subscription?pay03b=returned`);
  } catch (err) {
    return respondError(res, err);
  }
});

router.get('/api/pay03b/simulator/payment-method/:customerId', (req, res) => {
  try {
    simulatorFor(req);
    const origin = String(envFor(req).CARUP_PAY01A_RETURN_ORIGIN || '').replace(/\/$/, '');
    return res.status(200).type('html').send(simulatorPage('Payment method', `<div class="card"><h1>Update payment method</h1>
<p data-testid="pay03b-simulator-payment-method">A simulated card is on file. No card data is collected here.</p>
<p><a href="${escapeHtml(origin)}/dealer/subscription?pay03b=returned">Back to CarUp</a></p></div>`));
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03b/simulator/subscriptions/:providerSubscriptionId/advance', adminSession, async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const result = await simulator.advanceToNextPeriod(req.params.providerSubscriptionId, { outcome: req.body?.outcome || 'success' });
    return res.status(200).json({ simulated: true, delivered: await deliverSimulatorEvents(req, simulator, result.events) });
  } catch (err) {
    return respondError(res, err);
  }
});

router.post('/api/pay03b/simulator/refunds', adminSession, async (req, res) => {
  try {
    const simulator = simulatorFor(req);
    const result = await simulator.createExternalRefund({ paymentIntentId: req.body?.paymentIntentId,
      amountMinor: Number(req.body?.amountMinor) });
    return res.status(200).json({ simulated: true, refundId: result.refundId,
      delivered: await deliverSimulatorEvents(req, simulator, result.events) });
  } catch (err) {
    return respondError(res, err);
  }
});

export default router;
