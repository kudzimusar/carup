import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';
import { DatabaseError, ValidationError, ForbiddenError, NotFoundError } from '../utils/errors.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Mirrors the DB CHECK on finance_applications.status — any other value fails the UPDATE.
const FINANCE_APPLICATION_STATUSES = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Disbursed'];

// Global visibility/updates are a PLATFORM capability: gate on the server-derived platform/base
// role, never the header-derived effective role.
const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const isPlatformAdmin = (ctx = {}) =>
  PLATFORM_ADMIN_ROLES.has(String(ctx.platformRole || ctx.baseRole || ctx.role || '').toLowerCase());

// Fetch CBZ Bank / Finance Applications list
router.get('/api/finance/applications', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  let query = supabase
    .from('finance_applications')
    .select(`
      *,
      users!finance_applications_user_id_fkey(name),
      vehicles!inner(make, model, year, price, trust_score)
    `);
  // Lenders only see their own pipeline; platform admins stay global.
  const platformRole = String(req.userContext?.platformRole || req.userContext?.baseRole || req.userContext?.role || '').toLowerCase();
  if (platformRole === 'bank') {
    query = query.eq('bank_id', req.userContext.id);
  }
  const { data: list, error } = await query.order('created_at', { ascending: false });
  if (error) throw new DatabaseError(error.message);

  // Flatten relational joins for frontend mapping compatibility
  const flattened = list.map(app => ({
    ...app,
    user_name: app.users?.name || 'Applicant',
    make: app.vehicles?.make || 'Vehicle',
    model: app.vehicles?.model || '',
    year: app.vehicles?.year || '',
    trust_score: app.vehicles?.trust_score || 50
  }));

  res.json(flattened);
}));

// Update financing application status (Loan States)
router.post('/api/finance/applications/:id/update', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!FINANCE_APPLICATION_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${FINANCE_APPLICATION_STATUSES.join(', ')}`);
  }

  const { data: application, error: readError } = await supabase
    .from('finance_applications')
    .select('id, user_id, bank_id, vin, status')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new DatabaseError(readError.message);
  if (!application) throw new NotFoundError('Finance application not found.');
  if (!isPlatformAdmin(req.userContext) && application.bank_id !== req.userContext.id) {
    throw new ForbiddenError('Only platform admins or the assigned lender can update this application.');
  }

  const { error } = await supabase
    .from('finance_applications')
    .update({ status })
    .eq('id', id);
  if (error) throw new DatabaseError(error.message);

  // Bridge the lender decision into the communication engine, mirroring
  // financeService's one-event-per-transition pattern: terminal decisions emit
  // their specific event, everything else the coarse status_changed. Best-effort:
  // the status update is already durable, so an outbox failure never fails the
  // action. Tenant scope is platform (null) — never bank_id, which is a users.id.
  const decisionPayload = {
    applicationId: id,
    userId: application.user_id,
    recipientUserId: application.user_id,
    bankId: application.bank_id,
    vin: application.vin,
    previousStatus: application.status,
    status,
  };
  if (status === 'Approved') {
    emitDomainEvent(null, 'finance.application.approved', decisionPayload, null).catch(() => {});
  } else if (status === 'Rejected') {
    emitDomainEvent(null, 'finance.application.declined', decisionPayload, null).catch(() => {});
  } else {
    emitDomainEvent(null, 'finance.application.status_changed', decisionPayload, null).catch(() => {});
  }

  res.json({ success: true, status });
}));

export default router;
