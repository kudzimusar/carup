/**
 * Dealer Compliance & Trust routes — Workstream B.
 *
 * Dealer self-service (dealer/admin):
 *   POST /api/dealer/profile        create or update own dealer profile
 *   GET  /api/dealer/profile        read own dealer profile
 *   POST /api/dealer/branches       add a branch to own profile
 *   GET  /api/dealer/requirements   list own compliance requirements
 *   POST /api/dealer/documents      record a compliance document (metadata only)
 *
 * Admin oversight (admin/government/reviewer):
 *   GET   /api/admin/dealers              list dealer profiles (tenant-scoped)
 *   GET   /api/admin/dealers/:id          read one dealer (full privileged view)
 *   PATCH /api/admin/dealers/:id/decision record a governance decision + apply its effect
 *
 * Buyer-safe (any authenticated user):
 *   GET  /api/dealers/:id/summary   coarse status + evidence band only (NO private data)
 *
 * A dealer may only ever act on THEIR OWN profile: self-service routes resolve the dealer
 * by the caller's userId, so a dealer can never read or mutate another dealer's full profile.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import {
  createOrUpdateProfile,
  getProfile,
  listProfiles,
  addBranch,
  listRequirements,
  uploadDocument,
  recordDecision,
  evaluateCompliance,
  getBuyerSafeSummary,
} from '../services/dealer/dealerComplianceService.js';

const router = express.Router();

const DEALER_ROLES = ['dealer', 'admin'];
const ADMIN_ROLES = ['admin', 'government', 'reviewer'];

/** Resolve the caller's own dealer profile, or 404 if none exists yet. */
async function ownProfileOr404(req, res) {
  const profile = await getProfile(req.userContext?.userId);
  if (!profile) {
    res.status(404).json({ error: 'No dealer profile for this user. Create one first.' });
    return null;
  }
  return profile;
}

// ── dealer self-service ────────────────────────────────────────────────────────────

router.post('/api/dealer/profile', authorizeRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await createOrUpdateProfile(req.userContext?.userId, req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/profile', authorizeRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

router.post('/api/dealer/branches', authorizeRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branch = await addBranch(profile.id, req.body || {});
    res.status(201).json({ branch });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/requirements', authorizeRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const requirements = await listRequirements(profile.id);
    res.json({ requirements });
  } catch (err) {
    next(err);
  }
});

router.post('/api/dealer/documents', authorizeRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const document = await uploadDocument(profile.id, req.body || {});
    res.status(201).json({ document });
  } catch (err) {
    if (/requires a doc_type/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── admin oversight ─────────────────────────────────────────────────────────────────

router.get('/api/admin/dealers', authorizeRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    // Tenant scoping: a tenant-scoped admin only sees dealers in their tenant.
    const dealers = await listProfiles({ tenantId: req.userContext?.tenantId || undefined });
    res.json({ dealers });
  } catch (err) {
    next(err);
  }
});

router.get('/api/admin/dealers/:id', authorizeRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const compliance = await evaluateCompliance(profile.id);
    res.json({ profile, compliance });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/admin/dealers/:id/decision', authorizeRole(ADMIN_ROLES), requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE), async (req, res, next) => {
  try {
    const result = await recordDecision(
      req.params.id,
      {
        decision: req.body?.decision,
        requirement_key: req.body?.requirement_key,
        reason: req.body?.reason,
        payload: req.body?.payload,
      },
      { id: req.userContext?.userId, role: req.userContext?.role },
    );
    res.status(201).json(result);
  } catch (err) {
    if (/Dealer not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/decision must be|requires a requirement_key|authenticated actor/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── buyer-safe ──────────────────────────────────────────────────────────────────────

router.get('/api/dealers/:id/summary', authorizeRole(), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const summary = await getBuyerSafeSummary(profile.id);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

export default router;
