/**
 * Source Verification routes — Workstream 2.
 *
 *   GET  /api/sources                                     list registered adapters + honest modes
 *   POST /api/vehicles/:vin/sources/:provider/verify      run one registry source (privileged)
 *   POST /api/vehicles/:vin/sources/verify-all            run all registry sources (privileged)
 *   POST /api/vehicles/:vin/sources/:provider/manual      record authorized manual verification
 *   GET  /api/vehicles/:vin/sources                        privileged result history
 *   GET  /api/vehicles/:vin/sources/coverage               buyer/partner-safe coverage (status only)
 *
 * Privileged triggers are admin/government/reviewer. Coverage is readable by any
 * authenticated user (it carries no identity PII and no raw payloads). Raw payloads are
 * returned only to admin/government.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { buildFlagGates } from '../services/sourceVerification/sourceVerificationFlags.js';
import {
  initSourceVerification,
  verifySource,
  verifyAllSources,
  recordManualVerification,
  getCoverage,
  getResults,
} from '../services/sourceVerification/sourceVerificationService.js';
import { listAdapters } from '../services/sourceVerification/verificationContract.js';

const router = express.Router();

// Register adapters at load with fail-closed flag gates (sandbox in staging/tests;
// disabled in production unless explicitly authorized).
initSourceVerification(buildFlagGates());

const TRIGGER_ROLES = ['admin', 'government', 'reviewer'];
const RAW_ROLES = ['admin', 'government'];

router.get('/api/sources', authorizeRole(), (req, res) => {
  res.json({ sources: listAdapters() });
});

router.post('/api/vehicles/:vin/sources/:provider/verify', authorizeRole(TRIGGER_ROLES), async (req, res, next) => {
  try {
    const result = await verifySource(req.params.vin, req.params.provider, {
      requestedBy: req.userContext?.userId,
      queryType: req.body?.query_type,
      queryValue: req.body?.query_value,
    });
    res.json({ result });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/unknown provider|not registered/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/api/vehicles/:vin/sources/verify-all', authorizeRole(TRIGGER_ROLES), async (req, res, next) => {
  try {
    const results = await verifyAllSources(req.params.vin, { requestedBy: req.userContext?.userId });
    res.json({ results });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.post('/api/vehicles/:vin/sources/:provider/manual', authorizeRole(TRIGGER_ROLES), async (req, res, next) => {
  try {
    const result = await recordManualVerification(
      req.params.vin,
      req.params.provider,
      req.body || {},
      { id: req.userContext?.userId, role: req.userContext?.role },
    );
    res.status(201).json({ result });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/result must be|unknown provider|authenticated actor/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/api/vehicles/:vin/sources', authorizeRole(['admin', 'government', 'reviewer', 'owner', 'dealer']), async (req, res, next) => {
  try {
    const includeRaw = RAW_ROLES.includes(req.userContext?.role);
    const results = await getResults(req.params.vin, { includeRaw });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.get('/api/vehicles/:vin/sources/coverage', authorizeRole(), async (req, res, next) => {
  try {
    const coverage = await getCoverage(req.params.vin);
    res.json({ coverage });
  } catch (err) {
    next(err);
  }
});

export default router;
