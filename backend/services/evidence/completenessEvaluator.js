/**
 * Vehicle Completeness Evaluator — Phase 4
 *
 * Deterministically evaluates whether a vehicle's identity fields and evidence
 * satisfy CarUp publication requirements. Returns a requirement matrix plus a
 * publishability verdict.
 *
 * Publication gate (all blocking requirements must be 'present' or 'verified'):
 *   1. VIN          — always present if the vehicle row exists
 *   2. chassis_number   — must be non-empty on the vehicles row
 *   3. engine_number    — must be non-empty on the vehicles row
 *   4. plate_number OR temp_plate_id — at least one must be non-empty
 *   5. Ownership document — at least one vehicle_evidence row with evidence_type
 *      IN (registration_document, ownership_transfer_document) that has been verified
 *
 * Advisory requirements (non-blocking — shown in the UI but do not gate publication):
 *   customs_photo, inspection_photo, insurance_document, police_clearance_document
 *
 * AI confidence is NEVER consulted here: this evaluator is purely deterministic
 * and based on human-verified state.
 */
async function getDefaultClient() {
  const { supabase } = await import('../../db/supabase.js');
  return supabase;
}

// Every value below MUST be legal under the DB CHECK constraint
// vehicle_evidence_evidence_type_check — an illegal value can never match a row,
// silently turning the requirement into a permanent 'missing'. The previous
// constants (ownership_transfer, customs_entry, duty_clearance_document,
// vid_inspection) were not in the CHECK and could never be satisfied.
const BLOCKING_DOC_TYPES = ['registration_document', 'ownership_transfer_document'];
const ADVISORY_DOC_TYPES = ['customs_photo', 'inspection_photo', 'insurance_document', 'police_clearance_document'];
const VERIFIED_STATUSES = new Set(['verified', 'confirmed', 'approved']);
const PENDING_STATUSES  = new Set(['pending', 'submitted', 'under_review']);

function docStatus(docs, type) {
  const matching = (docs || []).filter((d) => d.evidence_type === type);
  if (matching.some((d) => VERIFIED_STATUSES.has(d.verification_status))) return 'verified';
  if (matching.some((d) => PENDING_STATUSES.has(d.verification_status) || !d.verification_status)) return 'pending_review';
  return 'missing';
}

/**
 * Evaluate publication completeness for a VIN.
 *
 * @param {string} vin
 * @returns {Promise<{
 *   vin: string,
 *   requirements: Array<{key, label, category, blocking, status}>,
 *   completeness_percent: number,
 *   is_publishable: boolean,
 *   blocking_gaps: Array<{key, label}>,
 *   pending_gaps: Array<{key, label}>,
 *   publication_status: string,
 * }>}
 */
export async function evaluateCompleteness(vin, opts = {}) {
  const client = opts.client ?? (await getDefaultClient());
  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    .select('vin, chassis_number, engine_number, plate_number, temp_plate_id, trust_score, publication_status')
    .eq('vin', vin)
    .single();

  if (vErr || !vehicle) throw new Error(`Vehicle not found: ${vin}`);

  // Fetch all evidence rows for this VIN in one query to avoid N+1
  const { data: evidenceRows } = await client
    .from('vehicle_evidence')
    .select('id, evidence_type, verification_status')
    .eq('vin', vin)
    .in('evidence_type', [...BLOCKING_DOC_TYPES, ...ADVISORY_DOC_TYPES]);

  const requirements = [];

  // ── Identity requirements (blocking) ──────────────────────────────────────

  requirements.push({
    key: 'vin',
    label: 'Vehicle Identification Number (VIN)',
    category: 'identity',
    blocking: true,
    status: 'present',
  });

  requirements.push({
    key: 'chassis_number',
    label: 'Chassis Number',
    category: 'identity',
    blocking: true,
    status: vehicle.chassis_number ? 'present' : 'missing',
  });

  requirements.push({
    key: 'engine_number',
    label: 'Engine Number',
    category: 'identity',
    blocking: true,
    status: vehicle.engine_number ? 'present' : 'missing',
  });

  const hasPlate = !!(vehicle.plate_number || vehicle.temp_plate_id);
  requirements.push({
    key: 'plate_or_temp',
    label: 'Number Plate or Temporary Import Permit Number',
    category: 'identity',
    blocking: true,
    status: hasPlate ? 'present' : 'missing',
  });

  // ── Ownership document (blocking) ─────────────────────────────────────────

  const ownershipEvidence = (evidenceRows || []).filter((d) =>
    BLOCKING_DOC_TYPES.includes(d.evidence_type)
  );
  const ownershipVerified = ownershipEvidence.some((d) => VERIFIED_STATUSES.has(d.verification_status));
  const ownershipPending  = ownershipEvidence.some((d) => PENDING_STATUSES.has(d.verification_status) || !d.verification_status);

  requirements.push({
    key: 'ownership_document',
    label: 'Ownership / Registration Document',
    category: 'documents',
    blocking: true,
    status: ownershipVerified ? 'verified' : ownershipPending ? 'pending_review' : 'missing',
  });

  // ── Advisory documents (non-blocking) ────────────────────────────────────

  for (const type of ADVISORY_DOC_TYPES) {
    requirements.push({
      key: type,
      label: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      category: 'documents',
      blocking: false,
      status: docStatus(evidenceRows, type),
    });
  }

  // ── Compute publication readiness ─────────────────────────────────────────

  const blockingReqs = requirements.filter((r) => r.blocking);
  const missingBlocking = blockingReqs.filter((r) => r.status === 'missing');
  const pendingBlocking  = blockingReqs.filter((r) => r.status === 'pending_review');
  const metBlocking      = blockingReqs.filter((r) => r.status === 'present' || r.status === 'verified');

  const completeness_percent = Math.round((metBlocking.length / blockingReqs.length) * 100);
  const is_publishable = missingBlocking.length === 0 && pendingBlocking.length === 0;

  return {
    vin,
    requirements,
    completeness_percent,
    is_publishable,
    blocking_gaps: missingBlocking.map((r) => ({ key: r.key, label: r.label })),
    pending_gaps:  pendingBlocking.map((r) => ({ key: r.key, label: r.label })),
    publication_status: vehicle.publication_status ?? 'draft',
  };
}
