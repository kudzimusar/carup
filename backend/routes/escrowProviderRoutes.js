/**
 * Regulated REAL-MONEY escrow PROVIDER routes — Full Activation (canonical doc §115–130).
 *
 *   POST  /api/escrow/:id/provider/initiate          initiate provider escrow (buyer/owner/dealer/admin)
 *   PATCH /api/escrow/:id/provider/transition        advance the provider escrow lifecycle
 *   POST  /api/escrow/:id/provider/dual-control      sensitive manual release/refund (admin, TWO approvers)
 *   POST  /api/escrow/provider/webhook               signed provider webhook (signature-gated, no role)
 *   GET   /api/escrow/provider/:providerId/reconciliation      reconciliation jobs + open mismatches (admin)
 *   POST  /api/escrow/provider/:providerId/reconciliation/run  run a reconciliation window (admin)
 *   PATCH /api/escrow/provider/config/:configId/kill-switch    provider escrow kill switch (admin)
 *
 * Every money-affecting action is fail-closed and recorded append-only. No real funds move until
 * an approved provider + contracts + KYC/AML + settlement + credentials exist.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import {
  initiateProviderEscrow, transitionProviderEscrow, requireDualControl,
  ingestEscrowProviderWebhook, runEscrowReconciliation, setEscrowKillSwitch, getProviderState,
} from '../services/escrow/escrowProviderService.js';
import { getSession } from '../services/escrow/escrowTrustService.js';
import { ForbiddenError } from '../utils/errors.js';

const router = express.Router();

/**
 * OC-5R-PROV-01 B4 — participant authority. The role gate on these routes admits EVERY buyer,
 * owner and dealer account, so on its own it let an authenticated user who is party to nothing
 * move someone else's provider escrow. Authority over THIS escrow is the canonical rule the rest
 * of the escrow surface already uses (escrowTrustService.getSession -> assertReadable): the
 * session's buyer or seller, or a privileged reviewer/admin. Anyone else is refused before the
 * service is reached; an unknown session is a 404. The escrow engine itself is unchanged.
 */
async function escrowParticipantOrRefuse(req, res) {
  const actor = {
    id: req.userContext?.id || req.userContext?.userId || null,
    role: req.userContext?.effectiveRole || req.userContext?.role || null,
  };
  try {
    const session = await getSession(req.params.id, actor);
    if (!session) {
      res.status(404).json({ error: 'escrow session not found' });
      return null;
    }
    return session;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({
        error: 'Only a participant of this escrow, or a reviewer/admin, may act on it.',
        code: 'ESCROW_PARTICIPANT_REQUIRED',
      });
      return null;
    }
    throw err;
  }
}

// POST initiate — buyer/owner/dealer/admin.
router.post('/api/escrow/:id/provider/initiate', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    if (!(await escrowParticipantOrRefuse(req, res))) return undefined;
    const result = await initiateProviderEscrow(req.params.id, {
      providerKey: req.body?.provider_key,
      amountCents: Number(req.body?.amount_cents),
      currency: req.body?.currency,
      gateContext: req.body?.gate_context || {},
      subjects: req.body?.subjects,
      actor: { id: req.userContext?.userId, role: req.userContext?.role },
    });
    if (!result.ok && !result.deduped) return res.status(409).json(result);
    res.status(201).json(result);
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// PATCH transition — participants + reviewer/admin.
router.patch('/api/escrow/:id/provider/transition', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    if (!(await escrowParticipantOrRefuse(req, res))) return undefined;
    const result = await transitionProviderEscrow(req.params.id, req.body?.to_state, {
      actor: { id: req.userContext?.userId, role: req.userContext?.role },
      reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) {
    if (/not initiated/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/invalid provider escrow/.test(err.message)) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// POST dual-control release/refund — admin, TWO DISTINCT approvers.
router.post('/api/escrow/:id/provider/dual-control', authorizeRole(['admin']), async (req, res, next) => {
  try {
    const result = await requireDualControl(
      req.params.id, req.body?.action,
      req.body?.approver_1_id, req.body?.approver_2_id,
      { reason: req.body?.reason },
    );
    res.status(201).json(result);
  } catch (err) {
    if (/DISTINCT|two approvers|invalid dual-control/.test(err.message)) return res.status(422).json({ error: err.message });
    if (/not initiated|invalid provider escrow/.test(err.message)) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// POST webhook — signed; signature-gated, no role.
router.post('/api/escrow/provider/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), async (req, res, next) => {
  try {
    const result = await ingestEscrowProviderWebhook({
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'], timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'], body: req.body,
    });
    res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  } catch (err) { next(err); }
});

// GET reconciliation — admin/government/reviewer read.
router.get('/api/escrow/provider/:providerId/reconciliation', authorizeRole(['admin', 'government', 'reviewer']), async (req, res, next) => {
  try {
    const { data: jobs } = await supabase.from('reconciliation_jobs').select('*')
      .eq('provider_id', req.params.providerId).eq('capability_type', 'escrow')
      .order('created_at', { ascending: false }).limit(50);
    const { data: mismatches } = await supabase.from('reconciliation_mismatches').select('*')
      .eq('provider_id', req.params.providerId).eq('resolution', 'open')
      .order('created_at', { ascending: false }).limit(200);
    const { data: ledger } = await supabase.from('escrow_reconciliation_ledger').select('*')
      .eq('provider_id', req.params.providerId).order('created_at', { ascending: false }).limit(200);
    res.json({ jobs: jobs || [], open_mismatches: mismatches || [], ledger: ledger || [] });
  } catch (err) { next(err); }
});

// POST reconciliation run — admin.
router.post('/api/escrow/provider/:providerId/reconciliation/run', authorizeRole(['admin']), async (req, res, next) => {
  try {
    const result = await runEscrowReconciliation(req.params.providerId, {
      windowStart: req.body?.window_start || null,
      windowEnd: req.body?.window_end || null,
      external: req.body?.external || [],
      internal: req.body?.internal || [],
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PATCH kill-switch — admin.
router.patch('/api/escrow/provider/config/:configId/kill-switch', authorizeRole(['admin']), async (req, res, next) => {
  try {
    const config = await setEscrowKillSwitch(req.params.configId, req.body?.enabled === true, {
      actor: { id: req.userContext?.userId, role: req.userContext?.role }, reason: req.body?.reason,
    });
    res.json({ config });
  } catch (err) { next(err); }
});

export default router;
