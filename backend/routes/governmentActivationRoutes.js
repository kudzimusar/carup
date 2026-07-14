/**
 * Government Source Activation routes — Full Activation (admin/government operators).
 *
 *   POST  /api/gov/sources/:sourceKey/check           run a governed registry check for a VIN
 *   POST  /api/gov/sources/:sourceKey/batch-import    record a secure batch import (file_ref only)
 *   GET   /api/gov/sources/imports                     list batch import events
 *   GET   /api/gov/sources/health                      provider health snapshot (no secrets)
 *   GET   /api/gov/sources/errors                      recent error/unavailable attempts
 *   PATCH /api/gov/sources/:sourceKey/suspend          kill switch on (non-destructive)
 *   PATCH /api/gov/sources/:sourceKey/emergency-disable kill switch on + mode -> suspended
 *
 * ALL routes require admin/government. Buyer/partner surfaces never touch this router — they
 * read the safe coverage projection via the source-verification routes. Check results are
 * returned in the privileged (admin) projection here; the raw payload is stripped by the
 * service before it leaves persistence.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  runGovernmentCheck,
  recordBatchImport,
  listBatchImports,
  getGovernmentHealth,
  listGovernmentErrors,
  suspendSource,
  emergencyDisableSource,
} from '../services/sourceVerification/governmentActivation.js';

const router = express.Router();

const OPERATOR_ROLES = ['admin', 'government'];

function actorOf(req) {
  return { id: req.userContext?.userId || req.userContext?.id, role: req.userContext?.role };
}

router.post('/api/gov/sources/:sourceKey/check', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    const out = await runGovernmentCheck(req.params.sourceKey, req.body?.vin, {
      requestedBy: req.userContext?.userId,
      actorRole: req.userContext?.role,
      queryType: req.body?.query_type,
      queryValue: req.body?.query_value,
      idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotency_key || null,
    });
    res.json(out);
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/unknown government source|vin is required/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/api/gov/sources/:sourceKey/batch-import', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    const record = await recordBatchImport({
      sourceKey: req.params.sourceKey,
      fileRef: req.body?.file_ref,
      checksum: req.body?.checksum,
      rowCount: req.body?.row_count,
      status: req.body?.status,
      detail: req.body?.detail,
    }, actorOf(req));
    res.status(201).json({ import: record });
  } catch (err) {
    if (/unknown government source|file_ref|invalid status|not registered/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/api/gov/sources/imports', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    res.json({ imports: await listBatchImports({ sourceKey: req.query.source_key }) });
  } catch (err) { next(err); }
});

router.get('/api/gov/sources/health', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    res.json({ providers: await getGovernmentHealth() });
  } catch (err) { next(err); }
});

router.get('/api/gov/sources/errors', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    res.json({ errors: await listGovernmentErrors({ limit: Number(req.query.limit) || 50 }) });
  } catch (err) { next(err); }
});

router.patch('/api/gov/sources/:sourceKey/suspend', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    const provider = await suspendSource(req.params.sourceKey, { reason: req.body?.reason, actor: actorOf(req) });
    res.json({ provider: { source_key: provider.provider_key, kill_switch_enabled: provider.kill_switch_enabled, activation_mode: provider.activation_mode } });
  } catch (err) {
    if (/unknown government source|not registered/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/api/gov/sources/:sourceKey/emergency-disable', authorizeRole(OPERATOR_ROLES), async (req, res, next) => {
  try {
    const provider = await emergencyDisableSource(req.params.sourceKey, { reason: req.body?.reason, actor: actorOf(req) });
    res.json({ provider: { source_key: provider.provider_key, kill_switch_enabled: provider.kill_switch_enabled, activation_mode: provider.activation_mode } });
  } catch (err) {
    if (/unknown government source|not registered/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
