/**
 * Ingestion + identity-resolution + listing-snapshot routes — Milestone 2 (master plan §6, §15).
 *
 *   GET  /api/ingestion/providers                         registered adapters (+ honesty mode)
 *   POST /api/ingestion/jobs                              trigger a (sandbox) ingestion run [admin]
 *   GET  /api/ingestion/jobs                              recent jobs [admin/government]
 *   GET  /api/ingestion/jobs/:id                          job status [admin/government]
 *   GET  /api/ingestion/identity-queue                    pending ambiguous matches [admin/government]
 *   POST /api/ingestion/identity-candidates/:id/resolve   confirm/reject a match [admin/government]
 *   GET  /api/vehicles/:vin/listing-snapshots             immutable listing history [authenticated]
 *
 * No source is represented as live; provider `mode` is surfaced so callers can see
 * fixture/sandbox vs live (master plan §2.6).
 */
import express from 'express';
import { supabase } from '../db/supabase.js';
import { ValidationError, NotFoundError, DatabaseError } from '../utils/errors.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getProvider, listProviders } from '../services/ingestion/sourceProvider.js';
import { registerAllAdapters } from '../services/ingestion/registerAdapters.js';
import { runIngestionJob, resolveIdentityCandidate } from '../services/ingestion/ingestionService.js';
import { getSourceByCode } from '../services/evidence/sourceRegistryService.js';
import { listSnapshotsForVin } from '../services/ingestion/listingSnapshotService.js';

registerAllAdapters();

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function vehicleLookups() {
  const one = async (col, v) => {
    const { data } = await supabase.from('vehicles').select('vin').eq(col, v).limit(1);
    return (Array.isArray(data) ? data : data ? [data] : [])[0] || null;
  };
  return {
    findByVin: (v) => one('vin', v),
    findByChassis: (v) => one('chassis_number', v),
    findByPlate: (v) => one('normalized_plate_number', v),
  };
}

router.get('/api/ingestion/providers', asyncHandler(async (_req, res) => {
  res.json({ providers: listProviders() });
}));

router.post('/api/ingestion/jobs', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const adapterId = req.body.adapter_id || req.body.adapterId;
  if (!adapterId) throw new ValidationError('adapter_id is required');
  const provider = getProvider(adapterId);
  if (!provider) throw new NotFoundError(`Unknown adapter '${adapterId}'`);

  let sourceId = null;
  try {
    const source = await getSourceByCode(supabase, provider.sourceCode);
    sourceId = source ? source.id : null;
  } catch (err) {
    // proceed without a linked source row (sandbox) but record the adapter
  }

  const job = await runIngestionJob(supabase, {
    provider,
    sourceId,
    requestedBy: req.userContext?.id || null,
    idempotencyKey: req.body.idempotency_key || null,
    lookups: vehicleLookups(),
  });
  res.status(202).json({ job, provider_mode: provider.mode });
}));

router.get('/api/ingestion/jobs', authorizeRole(['admin', 'government']), asyncHandler(async (_req, res) => {
  const { data, error } = await supabase.from('ingestion_jobs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw new DatabaseError(error.message);
  res.json({ jobs: data || [] });
}));

router.get('/api/ingestion/jobs/:id', authorizeRole(['admin', 'government']), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('ingestion_jobs').select('*').eq('id', req.params.id).single();
  if (error || !data) throw new NotFoundError('Job not found');
  res.json(data);
}));

router.get('/api/ingestion/identity-queue', authorizeRole(['admin', 'government']), asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('vehicle_identity_candidates').select('*').eq('status', 'pending').order('confidence', { ascending: false });
  if (error) throw new DatabaseError(error.message);
  res.json({ candidates: data || [] });
}));

router.post('/api/ingestion/identity-candidates/:id/resolve',
  authorizeRole(['admin', 'government']),
  asyncHandler(async (req, res) => {
    const decision = req.body.decision;
    if (!['confirmed', 'rejected'].includes(decision)) {
      throw new ValidationError('decision must be confirmed or rejected');
    }
    let result;
    try {
      result = await resolveIdentityCandidate(supabase, req.params.id, {
        decision, resolvedBy: req.userContext?.id || null, notes: req.body.notes || null,
      });
    } catch (err) {
      throw new ValidationError(err.message);
    }
    res.json(result);
  }));

router.get('/api/vehicles/:vin/listing-snapshots', authorizeRole(), asyncHandler(async (req, res) => {
  const snapshots = await listSnapshotsForVin(supabase, req.params.vin);
  res.json({ snapshots });
}));

export default router;
