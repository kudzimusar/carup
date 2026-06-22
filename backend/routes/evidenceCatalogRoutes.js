/**
 * Evidence catalog + provenance routes — Milestone 1 (master plan §4.5, §5, §15).
 *
 *   GET  /api/evidence/taxonomy                         public catalog for upload forms
 *   GET  /api/evidence/sources                          public-safe source registry
 *   POST /api/vehicles/:vin/evidence-sets               create an evidence set (authz)
 *   GET  /api/vehicles/:vin/evidence-sets               list evidence sets
 *   GET  /api/vehicles/:vin/evidence/:id/provenance     chain-of-custody (role-scoped)
 *
 * Public serialization uses strict allowlists; restricted source credentials and raw
 * provenance internals (IP, actor IDs) never reach non-privileged callers.
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { ValidationError, NotFoundError, DatabaseError } from '../utils/errors.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getTaxonomy } from '../services/evidence/evidenceTaxonomy.js';
import { listPublicSources } from '../services/evidence/sourceRegistryService.js';
import { createEvidenceSet, listEvidenceSetsForVin } from '../services/evidence/evidenceSetService.js';
import {
  listProvenanceEvents,
  verifyProvenanceChain,
  toPublicProvenanceSummary,
} from '../services/evidence/provenanceService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const PRIVILEGED_ROLES = ['admin', 'government', 'reviewer'];

// --- Taxonomy discovery (public) -----------------------------------------------------
router.get('/api/evidence/taxonomy', asyncHandler(async (_req, res) => {
  res.json(getTaxonomy());
}));

// --- Source registry (public-safe) ---------------------------------------------------
router.get('/api/evidence/sources', asyncHandler(async (_req, res) => {
  let sources = [];
  try {
    sources = await listPublicSources(supabase);
  } catch (err) {
    throw new DatabaseError(err.message);
  }
  res.json({ sources });
}));

// --- Evidence sets -------------------------------------------------------------------
router.post('/api/vehicles/:vin/evidence-sets',
  authorizeRole(['owner', 'dealer', 'admin', 'government', 'mechanic']),
  asyncHandler(async (req, res) => {
    const { vin } = req.params;
    const { data: vehicle } = await supabase.from('vehicles').select('vin').eq('vin', vin).single();
    if (!vehicle) throw new NotFoundError('Vehicle not found');

    let created;
    try {
      created = await createEvidenceSet(supabase, { ...req.body, vin }, req.userContext || {});
    } catch (err) {
      if (err.statusCode === 400) throw new ValidationError(err.message);
      throw new DatabaseError(err.message);
    }
    res.status(201).json(created);
  }));

router.get('/api/vehicles/:vin/evidence-sets', asyncHandler(async (req, res) => {
  const { vin } = req.params;
  const setsList = await listEvidenceSetsForVin(supabase, vin);
  res.json({ sets: setsList });
}));

// --- Provenance / chain of custody ---------------------------------------------------
router.get('/api/vehicles/:vin/evidence/:evidenceId/provenance',
  authorizeRole(),
  asyncHandler(async (req, res) => {
    const { evidenceId } = req.params;
    const role = req.userContext?.role;
    const events = await listProvenanceEvents(supabase, evidenceId);
    const chain = await verifyProvenanceChain(supabase, evidenceId);

    if (PRIVILEGED_ROLES.includes(role)) {
      res.json({ chain_valid: chain.valid, events });
    } else {
      // Public-safe: omit IPs / raw actor IDs (master plan §5.6).
      res.json({ chain_valid: chain.valid, events: toPublicProvenanceSummary(events) });
    }
  }));

export default router;
