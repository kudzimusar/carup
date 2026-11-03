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
import dealerResearchRouter from './dealerResearchRoutes.js';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  createOrUpdateProfile,
  getProfile,
  listProfiles,
  addBranch,
  listBranches,
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

router.post('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await createOrUpdateProfile(req.userContext?.userId, req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branches = await listBranches(profile.id);
    res.set('Cache-Control', 'no-store').json({ branches });
  } catch (error) { next(error); }
});

router.post('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branch = await addBranch(profile.id, req.body || {});
    res.status(201).json({ branch });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/requirements', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const requirements = await listRequirements(profile.id);
    res.json({ requirements });
  } catch (err) {
    next(err);
  }
});

router.post('/api/dealer/documents', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
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

router.get('/api/admin/dealers', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    // Tenant scoping: a tenant-scoped admin only sees dealers in their tenant.
    const dealers = await listProfiles({ tenantId: req.userContext?.tenantId || undefined });
    res.json({ dealers });
  } catch (err) {
    next(err);
  }
});

router.get('/api/admin/dealers/:id', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const compliance = await evaluateCompliance(profile.id);
    res.json({ profile, compliance });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/admin/dealers/:id/decision', authorizeSessionRole(['admin','reviewer']), async (req, res, next) => {
  try {
    if (!req.userContext?.isVerified) {
      return res.status(403).json({ error: 'Independent verified reviewer session is required' });
    }
    const result = await recordDecision(
      req.params.id,
      {
        decision: req.body?.decision,
        requirement_key: req.body?.requirement_key,
        reason: req.body?.reason,
        payload: req.body?.payload,
      },
      { id: req.userContext?.userId, role: req.userContext?.platformRole || req.userContext?.role,
        authenticationMethod: req.userContext?.authenticationMethod,
        isVerified: req.userContext?.isVerified,
        reviewer_password: req.body?.reviewer_password },
    );
    res.status(201).json(result);
  } catch (err) {
    if (/Dealer not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/decision must be|requires a requirement_key|authenticated actor/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ error:err.message });
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

// Canonical dealership research, claim and public routes share this existing dealer router.
// No new standalone server mount or parallel dealer auth authority is introduced.
router.use(dealerResearchRouter);

export default router;
