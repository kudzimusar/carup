/**
 * Fraud + Duplicate Detection Engine — Workstream A.
 *
 * Runs a battery of detectors over a vehicle, its evidence, and its external source
 * verification results, producing append-only `fraud_signals`, rolling them up into a
 * single mutable `fraud_case`, and recording the evaluation in the append-only
 * `fraud_case_events` trail.
 *
 * Guarantees:
 *   - Detection is read-only over canonical data; it never mutates the vehicle, evidence,
 *     or source results.
 *   - Every signal is honestly severity/confidence-labelled and carries machine-readable
 *     reason_codes + evidence_refs so a reviewer can reconstruct why it fired.
 *   - Detectors fail SOFT: a detector that errors (e.g. a missing optional table) is
 *     swallowed (logged-shaped, never thrown into the request path) so one broken signal
 *     never suppresses the others.
 *   - assessPublicationBlock() is a PURE function over a signal array — no I/O — so the
 *     publication gate is deterministic and unit-testable.
 *   - The engine NEVER auto-merges passports. It only raises signals + opens a case.
 */
import { supabase } from '../../db/supabase.js';

export const RULE_VERSION = 'fraud-rules-1.0.0';

// Default near-match threshold: a normalized edit distance at/below this (i.e. >= 1 - this
// similarity) between two VINs of equal length flags a probable typo/clone. Configurable
// per-call via opts.nearMatchThreshold.
const DEFAULT_NEAR_MATCH_DISTANCE = 0.12; // ~2 chars on a 17-char VIN

const SIGNALS_TABLE = 'fraud_signals';
const CASES_TABLE = 'fraud_cases';
const CASE_EVENTS_TABLE = 'fraud_case_events';

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// ── small pure helpers ──────────────────────────────────────────────────────────

/** Levenshtein edit distance between two strings (iterative, O(m*n) space-optimized). */
export function levenshtein(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Normalized distance in [0,1]: editDistance / max(len). 0 = identical, 1 = totally
 * different. A small normalized distance between two distinct VINs => near match.
 */
export function normalizedDistance(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return levenshtein(a, b) / max;
}

function normStr(v) {
  return v == null ? '' : String(v).trim().toLowerCase();
}

function makeSignal(signal_code, severity, fields = {}) {
  return {
    signal_code,
    severity,
    confidence: fields.confidence ?? null,
    reason_codes: fields.reason_codes || [],
    evidence_refs: fields.evidence_refs || [],
    related_identities: fields.related_identities || [],
    recommended_action: fields.recommended_action || null,
    blocks_publication: fields.blocks_publication ?? false,
    requires_review: fields.requires_review ?? false,
    rule_version: RULE_VERSION,
  };
}

// ── data loaders (read-only) ─────────────────────────────────────────────────────

async function loadVehicle(vin) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('vin, make, model, year, plate_number, normalized_plate_number, chassis_number, engine_number, temp_plate_id, owner_id, tenant_id, status')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(`vehicle lookup failed: ${error.message}`);
  return data || null;
}

async function loadAllVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('vin, make, model, year, plate_number, normalized_plate_number, chassis_number, engine_number, temp_plate_id, owner_id, tenant_id, status');
  if (error) throw new Error(`vehicles scan failed: ${error.message}`);
  return data || [];
}

async function loadEvidence(vin) {
  try {
    const { data, error } = await supabase
      .from('vehicle_evidence')
      .select('id, vin, evidence_type, checksum, image_hash, verification_status, metadata, captured_at, created_at')
      .eq('vin', vin);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

async function loadSourceResults(vin) {
  try {
    const { data, error } = await supabase
      .from('source_verification_results')
      .select('vin, provider, mode, result, confidence, identity_fields, mismatch_flags, created_at')
      .eq('vin', vin);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ── individual detectors (pure-ish: take loaded data, return signals[]) ──────────
// Each detector is wrapped in try/catch by the caller; here they assume well-formed
// inputs and stay defensive against missing optional fields.

/** Exact duplicate of an identity field (vin/chassis/engine/registration) on ANOTHER vehicle. */
function detectExactDuplicates(vehicle, others) {
  const signals = [];
  const checks = [
    { field: 'chassis_number', code: 'duplicate_chassis', label: 'chassis' },
    { field: 'engine_number', code: 'duplicate_engine', label: 'engine' },
  ];

  // duplicate_vin: another vehicle row carrying THIS vin as a chassis/engine/plate value,
  // i.e. the same physical identifier surfacing under a different primary key. (Two rows
  // can't share the vehicles PK, so a VIN collision manifests as the VIN reused in another
  // identity slot.)
  for (const other of others) {
    if (other.vin === vehicle.vin) continue;
    const vinNorm = normStr(vehicle.vin);
    if (
      (normStr(other.chassis_number) && normStr(other.chassis_number) === vinNorm) ||
      (normStr(other.engine_number) && normStr(other.engine_number) === vinNorm) ||
      (normStr(other.vin) === vinNorm)
    ) {
      signals.push(makeSignal('duplicate_vin', 'critical', {
        confidence: 0.99,
        reason_codes: ['vin_exact_match', `conflicting_vin:${other.vin}`],
        evidence_refs: [{ type: 'vehicle', vin: other.vin }],
        related_identities: other.owner_id ? [{ type: 'owner', id: other.owner_id }] : [],
        recommended_action: 'block_and_investigate',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }

  for (const { field, code, label } of checks) {
    const mine = normStr(vehicle[field]);
    if (!mine) continue;
    for (const other of others) {
      if (other.vin === vehicle.vin) continue;
      if (normStr(other[field]) === mine) {
        signals.push(makeSignal(code, 'critical', {
          confidence: 0.97,
          reason_codes: [`${label}_exact_match`, `other_vin:${other.vin}`],
          evidence_refs: [{ type: 'vehicle', vin: other.vin, field }],
          related_identities: other.owner_id ? [{ type: 'owner', id: other.owner_id }] : [],
          recommended_action: 'block_and_investigate',
          blocks_publication: true,
          requires_review: true,
        }));
      }
    }
  }
  return signals;
}

/** Duplicate registration / plate on another vehicle (normalized plate preferred). */
function detectDuplicateRegistration(vehicle, others) {
  const signals = [];
  const minePlate = normStr(vehicle.normalized_plate_number) || normStr(vehicle.plate_number);
  if (!minePlate) return signals;
  for (const other of others) {
    if (other.vin === vehicle.vin) continue;
    const otherPlate = normStr(other.normalized_plate_number) || normStr(other.plate_number);
    if (otherPlate && otherPlate === minePlate) {
      signals.push(makeSignal('duplicate_registration', 'high', {
        confidence: 0.92,
        reason_codes: ['registration_plate_match', `other_vin:${other.vin}`, `plate:${minePlate}`],
        evidence_refs: [{ type: 'vehicle', vin: other.vin, field: 'plate_number' }],
        related_identities: other.owner_id ? [{ type: 'owner', id: other.owner_id }] : [],
        recommended_action: 'review_registration_conflict',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** Near-match VIN (probable typo / cloned plate) via normalized edit distance. */
function detectNearMatchVin(vehicle, others, threshold) {
  const signals = [];
  const mine = normStr(vehicle.vin);
  if (!mine) return signals;
  for (const other of others) {
    if (other.vin === vehicle.vin) continue;
    const otherVin = normStr(other.vin);
    if (!otherVin || otherVin === mine) continue;
    const dist = normalizedDistance(mine, otherVin);
    if (dist > 0 && dist <= threshold) {
      const similarity = Number((1 - dist).toFixed(4));
      signals.push(makeSignal('near_match_vin', 'medium', {
        confidence: similarity,
        reason_codes: ['vin_near_match', `other_vin:${other.vin}`, `normalized_distance:${dist.toFixed(4)}`],
        evidence_refs: [{ type: 'vehicle', vin: other.vin }],
        related_identities: other.owner_id ? [{ type: 'owner', id: other.owner_id }] : [],
        recommended_action: 'review_possible_clone_or_typo',
        blocks_publication: false,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** Two vehicles sharing the same temp_plate_id (temp-plate reuse / churn). */
function detectTempPlateReuse(vehicle, others) {
  const signals = [];
  const mine = normStr(vehicle.temp_plate_id);
  if (!mine) return signals;
  const sharers = others.filter((o) => o.vin !== vehicle.vin && normStr(o.temp_plate_id) === mine);
  if (sharers.length > 0) {
    signals.push(makeSignal('temp_plate_reuse', 'high', {
      confidence: 0.9,
      reason_codes: ['temp_plate_shared', `temp_plate_id:${vehicle.temp_plate_id}`, ...sharers.map((s) => `other_vin:${s.vin}`)],
      evidence_refs: sharers.map((s) => ({ type: 'vehicle', vin: s.vin, field: 'temp_plate_id' })),
      related_identities: sharers.filter((s) => s.owner_id).map((s) => ({ type: 'owner', id: s.owner_id })),
      recommended_action: 'review_temp_plate_reuse',
      blocks_publication: true,
      requires_review: true,
    }));
  }
  return signals;
}

/** Source-declared identity disagrees with the canonical make/model/year. */
function detectConflictingMakeModelYear(vehicle, sourceResults) {
  const signals = [];
  for (const sr of sourceResults) {
    const idf = sr.identity_fields || {};
    const declaredMake = normStr(idf.declared_make || idf.registered_make);
    const declaredModel = normStr(idf.declared_model || idf.registered_model);
    const declaredYear = idf.declared_year || idf.registered_year;
    const conflicts = [];
    if (declaredMake && normStr(vehicle.make) && declaredMake !== normStr(vehicle.make)) {
      conflicts.push(`make:${declaredMake}!=${normStr(vehicle.make)}`);
    }
    if (declaredModel && normStr(vehicle.model) && declaredModel !== normStr(vehicle.model)) {
      conflicts.push(`model:${declaredModel}!=${normStr(vehicle.model)}`);
    }
    if (declaredYear && vehicle.year && Number(declaredYear) !== Number(vehicle.year)) {
      conflicts.push(`year:${declaredYear}!=${vehicle.year}`);
    }
    if (conflicts.length > 0) {
      signals.push(makeSignal('conflicting_make_model_year', 'high', {
        confidence: 0.85,
        reason_codes: ['source_identity_conflict', `provider:${sr.provider}`, ...conflicts],
        evidence_refs: [{ type: 'source_verification', provider: sr.provider }],
        related_identities: [{ type: 'source', id: sr.provider }],
        recommended_action: 'review_identity_conflict',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** A source result that is itself a mismatch / high_risk verdict. */
function detectSourceIdentityConflict(sourceResults) {
  const signals = [];
  for (const sr of sourceResults) {
    if (sr.result === 'mismatch' || sr.result === 'high_risk') {
      const critical = sr.result === 'high_risk';
      signals.push(makeSignal('source_identity_conflict', critical ? 'critical' : 'high', {
        confidence: sr.confidence ?? (critical ? 0.9 : 0.8),
        reason_codes: [`source_result:${sr.result}`, `provider:${sr.provider}`, ...(Array.isArray(sr.mismatch_flags) ? sr.mismatch_flags : [])],
        evidence_refs: [{ type: 'source_verification', provider: sr.provider, result: sr.result }],
        related_identities: [{ type: 'source', id: sr.provider }],
        recommended_action: critical ? 'block_and_investigate' : 'review_source_conflict',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** CID (criminal/stolen registry) returned high_risk — a hard stop. */
function detectCidHighRisk(sourceResults) {
  const signals = [];
  for (const sr of sourceResults) {
    if (sr.provider === 'cid' && sr.result === 'high_risk') {
      const idf = sr.identity_fields || {};
      signals.push(makeSignal('cid_high_risk', 'critical', {
        confidence: sr.confidence ?? 0.95,
        reason_codes: ['cid_high_risk', `stolen_check_status:${idf.stolen_check_status || 'flagged'}`],
        evidence_refs: [{ type: 'source_verification', provider: 'cid', result: 'high_risk' }],
        related_identities: [{ type: 'source', id: 'cid' }],
        recommended_action: 'block_and_escalate',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** Reused evidence file checksum across vehicles (recycled photos/docs). */
function detectEvidenceChecksumReuse(vehicle, myEvidence, foreignChecksumIndex) {
  const signals = [];
  for (const ev of myEvidence) {
    const sum = normStr(ev.checksum || ev.image_hash);
    if (!sum) continue;
    const owners = foreignChecksumIndex.get(sum);
    if (owners && owners.some((o) => o.vin !== vehicle.vin)) {
      const foreign = owners.filter((o) => o.vin !== vehicle.vin);
      signals.push(makeSignal('evidence_checksum_reuse', 'high', {
        confidence: 0.9,
        reason_codes: ['evidence_checksum_reused', `checksum:${sum}`, ...foreign.map((f) => `other_vin:${f.vin}`)],
        evidence_refs: foreign.map((f) => ({ type: 'evidence', vin: f.vin, evidence_id: f.id })),
        related_identities: [],
        recommended_action: 'review_recycled_evidence',
        blocks_publication: true,
        requires_review: true,
      }));
    }
  }
  return signals;
}

/** Repeated rejected evidence on this vehicle (pattern of bad submissions). */
function detectRepeatedRejectedEvidence(myEvidence, opts) {
  const signals = [];
  const threshold = opts.rejectedEvidenceThreshold ?? 3;
  const rejected = myEvidence.filter((e) => e.verification_status === 'rejected');
  if (rejected.length >= threshold) {
    signals.push(makeSignal('repeated_rejected_evidence', 'medium', {
      confidence: 0.7,
      reason_codes: ['repeated_rejected_evidence', `rejected_count:${rejected.length}`],
      evidence_refs: rejected.map((e) => ({ type: 'evidence', evidence_id: e.id })),
      related_identities: [],
      recommended_action: 'review_submission_pattern',
      blocks_publication: false,
      requires_review: true,
    }));
  }
  return signals;
}

/**
 * Odometer reversal / impossible mileage from evidence metadata. Mileage readings are
 * read from vehicle_evidence.metadata.{odometer_km|mileage_km|odometer|mileage} on odometer
 * evidence, ordered by captured_at. A later reading lower than an earlier one is a reversal;
 * an implausibly large jump is impossible mileage. Fully defensive against missing metadata.
 */
function detectMileageAnomalies(myEvidence, opts) {
  const signals = [];
  const maxKmPerDay = opts.maxKmPerDay ?? 2000; // physically implausible daily distance

  const readings = [];
  for (const ev of myEvidence) {
    const meta = ev.metadata || {};
    const raw = meta.odometer_km ?? meta.mileage_km ?? meta.odometer ?? meta.mileage;
    if (raw == null) continue;
    const km = Number(raw);
    if (!Number.isFinite(km)) continue;
    const when = ev.captured_at || ev.created_at || null;
    readings.push({ km, when, evidence_id: ev.id });
  }
  if (readings.length < 2) return signals;

  readings.sort((a, b) => {
    const ta = a.when ? Date.parse(a.when) : 0;
    const tb = b.when ? Date.parse(b.when) : 0;
    return ta - tb;
  });

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    if (cur.km < prev.km) {
      signals.push(makeSignal('odometer_reversal', 'high', {
        confidence: 0.95,
        reason_codes: ['odometer_reversal', `prev_km:${prev.km}`, `later_km:${cur.km}`],
        evidence_refs: [
          { type: 'evidence', evidence_id: prev.evidence_id, odometer_km: prev.km },
          { type: 'evidence', evidence_id: cur.evidence_id, odometer_km: cur.km },
        ],
        related_identities: [],
        recommended_action: 'review_odometer_rollback',
        blocks_publication: true,
        requires_review: true,
      }));
      continue;
    }
    const dKm = cur.km - prev.km;
    const ta = prev.when ? Date.parse(prev.when) : NaN;
    const tb = cur.when ? Date.parse(cur.when) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb) && tb > ta) {
      const days = Math.max((tb - ta) / 86400000, 1 / 24); // floor at 1 hour
      if (dKm / days > maxKmPerDay) {
        signals.push(makeSignal('impossible_mileage', 'medium', {
          confidence: 0.8,
          reason_codes: ['impossible_mileage', `delta_km:${dKm}`, `days:${days.toFixed(2)}`, `km_per_day:${(dKm / days).toFixed(0)}`],
          evidence_refs: [
            { type: 'evidence', evidence_id: prev.evidence_id, odometer_km: prev.km },
            { type: 'evidence', evidence_id: cur.evidence_id, odometer_km: cur.km },
          ],
          related_identities: [],
          recommended_action: 'review_mileage_plausibility',
          blocks_publication: false,
          requires_review: true,
        }));
      }
    }
  }
  return signals;
}

// ── orchestration ────────────────────────────────────────────────────────────────

/**
 * Evaluate a vehicle and return an array of signal objects. Read-only — performs no writes.
 * Each detector is isolated by try/catch so a single failure never suppresses the rest.
 *
 * @param {string} vin
 * @param {object} opts  { nearMatchThreshold, maxKmPerDay, rejectedEvidenceThreshold, others, evidence, sourceResults }
 */
export async function evaluateVehicle(vin, opts = {}) {
  const vehicle = opts.vehicle || (await loadVehicle(vin));
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const threshold = opts.nearMatchThreshold ?? DEFAULT_NEAR_MATCH_DISTANCE;

  // Load context (allow injection for tests / batch reuse).
  const allVehicles = opts.others || (await loadAllVehicles());
  const others = allVehicles.filter((v) => v.vin !== vin);
  const myEvidence = opts.evidence || (await loadEvidence(vin));
  const sourceResults = opts.sourceResults || (await loadSourceResults(vin));

  // Build a checksum -> [{vin, id}] index across OTHER vehicles' evidence for reuse detection.
  // Only computed when not injected, and only if we have foreignEvidence supplied or can scan.
  let foreignChecksumIndex = opts.foreignChecksumIndex || new Map();
  if (!opts.foreignChecksumIndex && opts.foreignEvidence) {
    for (const ev of opts.foreignEvidence) {
      const sum = normStr(ev.checksum || ev.image_hash);
      if (!sum) continue;
      const arr = foreignChecksumIndex.get(sum) || [];
      arr.push({ vin: ev.vin, id: ev.id });
      foreignChecksumIndex.set(sum, arr);
    }
  }

  const detectors = [
    () => detectExactDuplicates(vehicle, others),
    () => detectDuplicateRegistration(vehicle, others),
    () => detectNearMatchVin(vehicle, others, threshold),
    () => detectTempPlateReuse(vehicle, others),
    () => detectConflictingMakeModelYear(vehicle, sourceResults),
    () => detectSourceIdentityConflict(sourceResults),
    () => detectCidHighRisk(sourceResults),
    () => detectEvidenceChecksumReuse(vehicle, myEvidence, foreignChecksumIndex),
    () => detectRepeatedRejectedEvidence(myEvidence, opts),
    () => detectMileageAnomalies(myEvidence, opts),
  ];

  const signals = [];
  for (const run of detectors) {
    try {
      const out = run();
      if (Array.isArray(out)) signals.push(...out);
    } catch (err) {
      // Fail-soft: a broken detector must never throw into the request path or suppress
      // the others. Surface a low-severity diagnostic instead of crashing.
      // eslint-disable-next-line no-console
      console.error(`[fraudEngine] detector failed for ${vin}: ${err && err.message ? err.message : err}`);
    }
  }
  return signals;
}

/**
 * PURE: decide whether a set of signals should block listing publication.
 * Blocked if ANY signal has blocks_publication=true OR severity 'critical'.
 * No I/O — deterministic and heavily unit-tested.
 *
 * @returns {{ blocked: boolean, reasons: Array<{signal_code, severity, reason}> }}
 */
export function assessPublicationBlock(signals) {
  const reasons = [];
  for (const s of signals || []) {
    if (!s) continue;
    if (s.blocks_publication === true) {
      reasons.push({ signal_code: s.signal_code, severity: s.severity, reason: 'signal_blocks_publication' });
    } else if (s.severity === 'critical') {
      reasons.push({ signal_code: s.signal_code, severity: s.severity, reason: 'critical_severity' });
    }
  }
  return { blocked: reasons.length > 0, reasons };
}

/** Highest severity present in a signal array, or null. */
function highestSeverity(signals) {
  let best = null;
  let bestRank = 0;
  for (const s of signals || []) {
    const rank = SEVERITY_RANK[s.severity] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = s.severity;
    }
  }
  return best;
}

/**
 * Persist an evaluation: insert fraud_signals rows, upsert the vehicle's fraud_case, and
 * append a 'evaluated' fraud_case_events row. A case is opened/kept-open when any signal is
 * critical/high or requires_review.
 *
 * @returns {{ case: object|null, signals: object[] }}
 */
export async function persistEvaluation(vin, signals, opts = {}) {
  const tenantId = opts.tenantId ?? null;
  const actorId = opts.actorId ?? null;
  const actorRole = opts.actorRole ?? null;

  // 1) Insert append-only signal rows.
  let insertedSignals = [];
  if (signals.length > 0) {
    const rows = signals.map((s) => ({
      vin,
      tenant_id: tenantId,
      signal_code: s.signal_code,
      severity: s.severity,
      confidence: s.confidence ?? null,
      reason_codes: s.reason_codes || [],
      evidence_refs: s.evidence_refs || [],
      related_identities: s.related_identities || [],
      recommended_action: s.recommended_action || null,
      blocks_publication: s.blocks_publication ?? false,
      requires_review: s.requires_review ?? false,
      rule_version: s.rule_version || RULE_VERSION,
    }));
    const { data, error } = await supabase.from(SIGNALS_TABLE).insert(rows).select();
    if (error) throw new Error(`failed to persist fraud signals: ${error.message}`);
    insertedSignals = data || [];
  }

  // 2) Decide case posture.
  const block = assessPublicationBlock(signals);
  const topSeverity = highestSeverity(signals);
  const requiresReview = signals.some((s) => s.requires_review);
  const shouldBeOpen =
    signals.some((s) => s.severity === 'critical' || s.severity === 'high') || requiresReview;

  // 3) Upsert the case (one open case per vehicle). Reopen a previously closed case if new
  //    serious signals arrive; otherwise leave a closed case closed when nothing fired.
  const { data: existing, error: findErr } = await supabase
    .from(CASES_TABLE)
    .select('id, vin, tenant_id, highest_severity, open_signal_count, status, blocks_publication, created_at, updated_at')
    .eq('vin', vin)
    .maybeSingle();
  if (findErr) throw new Error(`failed to load fraud case: ${findErr.message}`);

  let theCase = existing || null;

  if (!existing && shouldBeOpen) {
    const { data, error } = await supabase
      .from(CASES_TABLE)
      .insert({
        vin,
        tenant_id: tenantId,
        highest_severity: topSeverity,
        open_signal_count: signals.length,
        status: 'open',
        blocks_publication: block.blocked,
      })
      .select()
      .single();
    if (error) throw new Error(`failed to open fraud case: ${error.message}`);
    theCase = data;
  } else if (existing) {
    // Only move counters/severity/block flag. Reopen if closed and new serious signals arrive.
    const reopen = ['resolved', 'dismissed'].includes(existing.status) && shouldBeOpen;
    const updates = {
      highest_severity: topSeverity || existing.highest_severity,
      open_signal_count: signals.length,
      blocks_publication: block.blocked || existing.blocks_publication,
    };
    if (reopen) updates.status = 'open';
    const { data, error } = await supabase
      .from(CASES_TABLE)
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new Error(`failed to update fraud case: ${error.message}`);
    theCase = data;
  }

  // 4) Append the evaluation event (only when a case exists).
  if (theCase) {
    const { error } = await supabase.from(CASE_EVENTS_TABLE).insert({
      case_id: theCase.id,
      tenant_id: tenantId,
      event_type: 'evaluated',
      actor_id: actorId,
      actor_role: actorRole,
      reason: opts.reason || null,
      payload: {
        rule_version: RULE_VERSION,
        signal_count: signals.length,
        highest_severity: topSeverity,
        blocks_publication: block.blocked,
        block_reasons: block.reasons,
        signal_codes: signals.map((s) => s.signal_code),
      },
    });
    if (error) throw new Error(`failed to write fraud case event: ${error.message}`);
  }

  return { case: theCase, signals: insertedSignals };
}

/**
 * Convenience: evaluate + persist in one call.
 * @returns {{ case, signals, evaluated, block }}
 */
export async function evaluateAndPersist(vin, opts = {}) {
  const vehicle = opts.vehicle || (await loadVehicle(vin));
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);
  const evaluated = await evaluateVehicle(vin, { ...opts, vehicle });
  const persisted = await persistEvaluation(vin, evaluated, {
    tenantId: opts.tenantId ?? vehicle.tenant_id ?? null,
    actorId: opts.actorId ?? null,
    actorRole: opts.actorRole ?? null,
    reason: opts.reason,
  });
  return { ...persisted, evaluated, block: assessPublicationBlock(evaluated) };
}

export default {
  RULE_VERSION,
  levenshtein,
  normalizedDistance,
  evaluateVehicle,
  persistEvaluation,
  evaluateAndPersist,
  assessPublicationBlock,
};
