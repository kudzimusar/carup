/** PAY-01C isolated sandbox demo-product routes. No public money mutation paths. */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { Pay01aError } from '../services/payment/pay01aContract.js';
import {
  PAY01C_PRODUCT, requirePay01cDemo, createBuyerDemoCheckout,
  listBuyerDemoOrders, readBuyerDemoOrder, readBuyerDemoReport,
  readAdminDemoOrder, refundAdminDemoOrder, listAdminDemoOrders,
} from '../services/payment/pay01cDemoService.js';

const router = express.Router();
const buyerSession = authorizeSessionRole([]); // Any verified CarUp session; asserted identity is not accepted.
const adminSession = authorizeSessionRole(['admin']);

function respondError(res, err) {
  if (err instanceof Pay01aError) return res.status(err.status).json({ code: err.code, error: err.code });
  return res.status(503).json({ code: 'PAY01C_OPERATION_UNAVAILABLE', error: 'PAY01C_OPERATION_UNAVAILABLE' });
}
const actor = req => req.userContext?.id || null;
const handler = fn => async (req, res) => {
  try { const result = await fn(req); const { httpStatus, ...data } = result; return res.status(httpStatus || 200).json(data); }
  catch (err) { return respondError(res, err); }
};

router.get('/api/pay01c/product', handler(async () => {
  requirePay01cDemo();
  return { product: PAY01C_PRODUCT, disclaimer: 'Synthetic vehicle data only; no real history or vehicle ownership evidence.' };
}));

router.post('/api/pay01c/orders/checkout', buyerSession, handler(async req => ({
  httpStatus: 201,
  ...await createBuyerDemoCheckout({ buyerId: actor(req), requestKey: req.headers['idempotency-key'] }),
})));

router.get('/api/pay01c/orders', buyerSession,
  handler(req => listBuyerDemoOrders({ buyerId: actor(req) })));

router.get('/api/pay01c/orders/:orderId', buyerSession,
  handler(req => readBuyerDemoOrder({ buyerId: actor(req), orderId: req.params.orderId })));

router.post('/api/pay01c/orders/:orderId/verify', buyerSession,
  handler(req => readBuyerDemoOrder({ buyerId: actor(req), orderId: req.params.orderId, refresh: true })));

router.get('/api/pay01c/orders/:orderId/report', buyerSession,
  handler(req => readBuyerDemoReport({ buyerId: actor(req), orderId: req.params.orderId })));

router.get('/api/pay01c/admin/orders', adminSession, handler(() => listAdminDemoOrders()));

router.get('/api/pay01c/admin/orders/:orderId', adminSession,
  handler(req => readAdminDemoOrder({ orderId: req.params.orderId })));
router.post('/api/pay01c/admin/orders/:orderId/refund', adminSession,
  handler(req => refundAdminDemoOrder({ orderId: req.params.orderId })));

export default router;
