/**
 * PAY-01A — isolated direct merchant test Checkout, NOT SafeTrade or vehicle transaction routes.
 * No client amount, currency, merchant, provider status or payment intent may be submitted.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  createPay01aCheckout, reconcilePay01aPayment,
  processPay01aWebhook, refundPay01aPayment, listPay01aPayments,
} from '../services/payment/pay01aService.js';
import { Pay01aError } from '../services/payment/pay01aContract.js';

const router = express.Router();
const admin = authorizeSessionRole(['admin']);

function actor(req) {
  return req.userContext?.id || req.userContext?.userId || null;
}
function failure(err, res) {
  if (err instanceof Pay01aError) {
    return res.status(err.status).json({ error: err.code, code: err.code });
  }
  // Avoid returning Stripe, session, private input or DB error contents.
  return res.status(503).json({ error: 'PAY01A_OPERATION_UNAVAILABLE', code: 'PAY01A_OPERATION_UNAVAILABLE' });
}

router.post('/api/pay01a/checkout', admin, async (req, res) => {
  try {
    const result = await createPay01aCheckout({
      actorId: actor(req), requestKey: req.headers['idempotency-key'],
    });
    return res.status(201).json(result);
  } catch (err) { return failure(err, res); }
});

router.get('/api/pay01a', admin, async (_req, res) => {
  try {
    return res.json(await listPay01aPayments());
  } catch (err) { return failure(err, res); }
});

router.get('/api/pay01a/:reference', admin, async (req, res) => {
  try {
    return res.json(await reconcilePay01aPayment({ reference: req.params.reference, actorId: actor(req) }));
  } catch (err) { return failure(err, res); }
});

router.post('/api/pay01a/:reference/reconcile', admin, async (req, res) => {
  try {
    return res.json(await reconcilePay01aPayment({ reference: req.params.reference, actorId: actor(req) }));
  } catch (err) { return failure(err, res); }
});

router.post('/api/pay01a/:reference/refund', admin, async (req, res) => {
  try {
    return res.json(await refundPay01aPayment({ reference: req.params.reference, actorId: actor(req) }));
  } catch (err) { return failure(err, res); }
});

// Stripe signs the exact body bytes, not JSON.stringify(req.body).
// The server-wide parser attaches rawBodyBytes for this ONE exact URL before JSON decoding.
router.post('/api/pay01a/stripe/webhook', async (req, res) => {
  try {
    const result = await processPay01aWebhook({
      rawBody: req.rawBodyBytes, signature: req.headers['stripe-signature'],
    });
    return res.status(200).json({ received: true, ...result });
  } catch (err) { return failure(err, res); }
});

export default router;
