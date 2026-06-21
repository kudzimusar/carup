/**
 * Feature Governance API (Milestone 6).
 *
 * Trusted, server-authoritative governance of runtime rollout overrides.
 *  - Writes require platform-admin authority derived server-side by
 *    authorizeRole(['admin']) — client-supplied role headers NEVER grant access.
 *  - Ordinary callers receive only sanitized effective state (no internal
 *    reasons or tenant lists).
 *  - Storage failure degrades to static defaults; it never globally enables a
 *    disabled feature.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  getEffectiveStates,
  listFeaturesForAdmin,
  getFeatureDetail,
  upsertOverride,
  deleteOverride,
  getFeatureAudit,
  resolveRequestContext,
} from '../services/featureGovernance/featureGovernanceService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const VALID_ENVIRONMENTS = ['development', 'staging', 'production'];

/** Resolve the trusted server environment (never client-supplied for writes). */
export function serverEnvironment() {
  const env = process.env.APP_ENV || process.env.NODE_ENV || 'development';
  if (VALID_ENVIRONMENTS.includes(env)) return env;
  return env === 'test' ? 'development' : 'development';
}

/** Environment for READ endpoints: allow an explicit, validated query override. */
function readEnvironment(req) {
  const q = req.query?.environment;
  if (typeof q === 'string' && VALID_ENVIRONMENTS.includes(q)) return q;
  return serverEnvironment();
}

// ── Public (optional-auth): sanitized effective state for nav hydration ─────
// Non-blocking: the SPA renders static defaults first and hydrates from this.
// Anonymous callers get anonymous-context evaluation; an authenticated caller
// gets role/tenant-specific visible/accessible. Role + tenant are derived
// SERVER-SIDE from the session (client role headers are never trusted); only
// sanitized state is returned (no role/tenant lists, reasons or audit data).
router.get('/api/features/effective', asyncHandler(async (req, res) => {
  const { role, tenantId } = await resolveRequestContext(req);
  const states = await getEffectiveStates(
    { environment: serverEnvironment(), role, tenantId },
    { sanitize: true },
  );
  res.json({ environment: serverEnvironment(), features: states });
}));

// ── Admin: list every feature with override + effective state ───────────────
router.get('/api/admin/features', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const environment = readEnvironment(req);
  const features = await listFeaturesForAdmin({ environment, role: req.userContext?.platformRole ?? null, tenantId: null });
  res.json({ environment, features });
}));

// ── Admin: single feature detail ────────────────────────────────────────────
router.get('/api/admin/features/:featureId', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const environment = readEnvironment(req);
  const detail = await getFeatureDetail(req.params.featureId, { environment, role: req.userContext?.platformRole ?? null, tenantId: null });
  if (!detail) return res.status(404).json({ error: 'unknown_feature' });
  res.json(detail);
}));

// ── Admin: audit history for a feature ──────────────────────────────────────
router.get('/api/admin/features/:featureId/audit', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const audit = await getFeatureAudit(req.params.featureId, {});
  res.json({ featureId: req.params.featureId, audit });
}));

// ── Admin: create/update a rollout override (optimistic concurrency) ────────
router.patch('/api/admin/features/:featureId/rollout', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const patch = { ...req.body, environment: req.body?.environment };
  const result = await upsertOverride(req.params.featureId, patch, req.userContext, {
    req,
    expectedVersion: req.body?.expectedVersion,
  });
  if (!result.ok) {
    const status = result.status || 400;
    // Distinguishable top-level error code so the client can detect conflicts.
    const code = status === 409 ? 'version_conflict' : (result.errors?.[0] || 'validation_failed');
    return res.status(status).json({ error: code, errors: result.errors, current: result.current });
  }
  res.json({ ok: true, override: result.override });
}));

// ── Admin: reset (delete) an override → static default ──────────────────────
router.delete('/api/admin/features/:featureId/rollout', authorizeRole(['admin']), asyncHandler(async (req, res) => {
  const environment = req.body?.environment || req.query?.environment;
  if (!VALID_ENVIRONMENTS.includes(environment)) {
    return res.status(400).json({ error: 'invalid_environment' });
  }
  const result = await deleteOverride(req.params.featureId, environment, req.userContext, { req });
  if (!result.ok) return res.status(result.status || 400).json({ error: 'reset_failed', errors: result.errors });
  res.json({ ok: true, reset: true, alreadyDefault: result.alreadyDefault ?? false });
}));

export default router;
