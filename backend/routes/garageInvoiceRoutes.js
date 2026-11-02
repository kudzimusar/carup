import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import {
  getCloseout,
  getInvoice,
  issueInvoice,
  listInvoices,
  listMyInvoices,
  recordPayment,
  reversePayment,
  voidInvoice,
} from '../services/garageOperations/garageInvoiceService.js';

/**
 * GARAGE-1.0 OPS07 — commercial closeout. Money is a garage-ADMIN matter end to end; a customer can
 * only read their own invoices. Payment records are what the garage declares it received off-platform.
 */
const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ADMIN = [authorizeSessionRole(), requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES })];
const CUSTOMER_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];
const withKey = (req) => ({ ...(req.body || {}), idempotency_key: req.body?.idempotency_key ?? req.get('Idempotency-Key') });

router.get('/api/garage/cases/:caseId/closeout', ADMIN, asyncHandler(async (req, res) => {
  res.json(await getCloseout(supabase, req.userContext, req.params.caseId));
}));
router.post('/api/garage/cases/:caseId/invoice', ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json({ invoice: await issueInvoice(supabase, req.userContext, req.params.caseId, req.body || {}) });
}));
router.get('/api/garage/invoices', ADMIN, asyncHandler(async (req, res) => {
  res.json(await listInvoices(supabase, req.userContext, { status: req.query.status }));
}));
router.get('/api/garage/invoices/:invoiceId', ADMIN, asyncHandler(async (req, res) => {
  res.json({ invoice: await getInvoice(supabase, req.userContext, req.params.invoiceId) });
}));
router.post('/api/garage/invoices/:invoiceId/void', ADMIN, asyncHandler(async (req, res) => {
  res.json({ invoice: await voidInvoice(supabase, req.userContext, req.params.invoiceId, req.body || {}) });
}));
router.post('/api/garage/invoices/:invoiceId/payments', ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await recordPayment(supabase, req.userContext, req.params.invoiceId, withKey(req)));
}));
router.post('/api/garage/payments/:paymentId/reverse', ADMIN, asyncHandler(async (req, res) => {
  res.json(await reversePayment(supabase, req.userContext, req.params.paymentId, withKey(req)));
}));

// Customer side: their own invoices, nothing internal.
router.get('/api/service-invoices/mine', authorizeSessionRole(CUSTOMER_ROLES), asyncHandler(async (req, res) => {
  res.json(await listMyInvoices(supabase, req.userContext));
}));

export default router;
