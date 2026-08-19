import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';
import { getCanonicalTrustBatch, toPublicTrust } from '../services/trustDecision/canonicalTrustService.js';
import { DatabaseError, ValidationError, ForbiddenError, NotFoundError, ConflictError } from '../utils/errors.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const FINANCE_APPLICATION_STATUSES = ['Pending', 'Under Review', 'Approved', 'Rejected', 'Disbursed'];
const FINANCE_TRANSITIONS = Object.freeze({
  Pending: new Set(['Under Review', 'Approved', 'Rejected']),
  'Under Review': new Set(['Approved', 'Rejected']),
  Approved: new Set(['Disbursed']),
  Rejected: new Set(),
  Disbursed: new Set(),
});

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const isPlatformAdmin = (ctx = {}) =>
  PLATFORM_ADMIN_ROLES.has(String(ctx.platformRole || ctx.baseRole || ctx.role || '').toLowerCase());

function decisionSource(ctx = {}) {
  const id = String(ctx.id || ctx.userId || '').trim();
  return isPlatformAdmin(ctx) ? `platform:${id}` : `lender:${id}`;
}

router.get('/api/finance/applications', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  let query = supabase
    .from('finance_applications')
    .select(`
      *,
      users!finance_applications_user_id_fkey(name),
      vehicles!inner(vin, make, model, year, price)
    `);

  const platformRole = String(
    req.userContext?.platformRole || req.userContext?.baseRole || req.userContext?.role || '',
  ).toLowerCase();
  if (platformRole === 'bank') query = query.eq('bank_id', req.userContext.id);

  const { data: list, error } = await query.order('created_at', { ascending: false });
  if (error) throw new DatabaseError(error.message);

  // Phase 3 invariant still applies on a lender surface: never attach the raw/unversioned
  // vehicles.trust_score cache. Batch-read the canonical cache contract and publish its lifecycle
  // alongside the number so `not_evaluated` can never become a fabricated 0/50.
  const vins = [...new Set((list || []).map((app) => app.vin).filter(Boolean))];
  const trustByVin = await getCanonicalTrustBatch(vins, { client: supabase });

  const flattened = (list || []).map((app) => {
    const trust = toPublicTrust(trustByVin.get(String(app.vin || '').toUpperCase()) || null);
    return {
      ...app,
      user_name: app.users?.name || 'Applicant',
      make: app.vehicles?.make || 'Vehicle',
      model: app.vehicles?.model || '',
      year: app.vehicles?.year || '',
      trust_score: trust.score,
      trust_evaluation_state: trust.evaluation_state,
      trust_calculation_version: trust.calculation_version,
      trust_confidence: trust.confidence,
    };
  });

  res.json(flattened);
}));

router.post('/api/finance/applications/:id/update', authorizeRole(['admin', 'finance', 'bank']), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, apr, monthlyPayment, reason } = req.body || {};
  if (!FINANCE_APPLICATION_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${FINANCE_APPLICATION_STATUSES.join(', ')}`);
  }

  const { data: application, error: readError } = await supabase
    .from('finance_applications')
    .select('id, user_id, bank_id, vin, status, apr, monthly_payment')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new DatabaseError(readError.message);
  if (!application) throw new NotFoundError('Finance application not found.');
  if (!isPlatformAdmin(req.userContext) && application.bank_id !== req.userContext.id) {
    throw new ForbiddenError('Only platform admins or the assigned lender can update this application.');
  }

  const allowed = FINANCE_TRANSITIONS[application.status] || new Set();
  if (status === application.status) return res.json({ success: true, status, idempotentReplay: true });
  if (!allowed.has(status)) {
    throw new ConflictError(`Invalid finance transition: ${application.status} -> ${status}.`);
  }

  const now = new Date().toISOString();
  const patch = { status };
  if (status === 'Approved') {
    const quotedApr = Number(apr);
    const quotedMonthly = Number(monthlyPayment);
    if (!Number.isFinite(quotedApr) || quotedApr < 0 || !Number.isFinite(quotedMonthly) || quotedMonthly <= 0) {
      throw new ValidationError('Approval requires explicit lender APR and positive monthly payment terms.');
    }
    patch.apr = quotedApr;
    patch.monthly_payment = quotedMonthly;
    patch.decision_source = decisionSource(req.userContext);
    patch.decision_recorded_at = now;
    patch.decision_reason = typeof reason === 'string' ? reason.slice(0, 1000) : null;
  } else if (status === 'Rejected') {
    patch.apr = null;
    patch.monthly_payment = null;
    patch.decision_source = decisionSource(req.userContext);
    patch.decision_recorded_at = now;
    patch.decision_reason = typeof reason === 'string' ? reason.slice(0, 1000) : null;
  } else if (status === 'Disbursed') {
    if (!Number.isFinite(Number(application.apr)) || Number(application.apr) < 0
        || !Number.isFinite(Number(application.monthly_payment)) || Number(application.monthly_payment) <= 0) {
      throw new ConflictError('An application cannot be disbursed without recorded approved terms.');
    }
    patch.decision_source = decisionSource(req.userContext);
    patch.decision_recorded_at = now;
    patch.decision_reason = typeof reason === 'string' ? reason.slice(0, 1000) : null;
  }

  const { error } = await supabase.from('finance_applications').update(patch).eq('id', id);
  if (error) throw new DatabaseError(error.message);

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
