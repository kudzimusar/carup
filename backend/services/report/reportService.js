/**
 * Vehicle History Report service — Milestone 4 (master plan §10).
 *
 * Assembles a CarVertical-class buyer report from the M1-M3 data, applying a strict
 * public-safe allowlist. Key principles:
 *   - Evidence-first: every alert links to supporting evidence (master plan §2.1).
 *   - No single unexplained score; risks are itemized with severity/confidence/evidence/
 *     reviewed status (§10.3).
 *   - Transparent completeness; missing data is shown explicitly and NEVER presented as a
 *     clean history (§10.4).
 *   - Only reviewer-confirmed, public-safe AI/temporal/disclosure findings reach buyers (§10.8).
 */
import crypto from 'crypto';

const EVIDENCE_CLASSES = ['import', 'auction', 'accident', 'repair', 'inspection', 'ownership_transfer', 'dealer_listing', 'current_condition'];

function isPrivileged(audience) {
  return ['admin', 'government', 'reviewer'].includes(audience);
}

async function sel(supabase, table, filters = {}, { order } = {}) {
  let q = supabase.from(table).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  if (order) q = q.order(order.col, { ascending: order.asc });
  const { data, error } = await q;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

function bestDate(e) {
  return e.event_date || e.captured_at || e.uploaded_at || e.created_at || null;
}

/** Mileage observations from evidence odometer readings + listing advertised mileage. */
function buildMileageHistory(evidence, listings) {
  const obs = [];
  for (const e of evidence) {
    if (e.odometer_value != null) obs.push({ date: bestDate(e), value: Number(e.odometer_value), unit: e.odometer_unit || 'km', source: 'evidence', evidence_id: e.id });
  }
  for (const l of listings) {
    if (l.advertised_mileage != null) obs.push({ date: l.captured_at || null, value: Number(l.advertised_mileage), unit: l.mileage_unit || 'km', source: 'listing', listing_id: l.id });
  }
  obs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  // Regression: a later-dated reading lower than an earlier one.
  let regression = false; let prev = null;
  for (const o of obs) {
    if (prev && o.value < prev.value) regression = true;
    prev = o;
  }
  return { observations: obs, anomaly: regression };
}

function computeCompleteness(sections) {
  const classesPresent = new Set(sections.evidence.map((e) => e.evidence_class).filter(Boolean));
  const sources = new Set(sections.evidence.map((e) => e.source_id).filter(Boolean));
  const latestInspection = sections.evidence
    .filter((e) => e.evidence_class === 'inspection')
    .map(bestDate).filter(Boolean).sort().pop() || null;

  return {
    identity_coverage: sections.identity.vin ? 1 : 0,
    timeline_coverage: +(classesPresent.size / EVIDENCE_CLASSES.length).toFixed(2),
    classes_present: [...classesPresent],
    classes_missing: EVIDENCE_CLASSES.filter((c) => !classesPresent.has(c)),
    mileage_coverage: sections.mileage.observations.length ? 1 : 0,
    source_diversity: sources.size,
    inspection_recency: latestInspection,
    current_condition_coverage: classesPresent.has('current_condition') ? 1 : 0,
    unresolved_conflict_count: sections.disclosure_conflicts.length,
  };
}

function computeLimitations(sections, completeness) {
  const lim = [];
  if (completeness.classes_missing.length) lim.push(`No evidence for: ${completeness.classes_missing.join(', ')}. Absence of records is NOT proof of a clean history.`);
  if (!sections.mileage.observations.length) lim.push('No mileage readings available — odometer history cannot be verified.');
  if (!completeness.inspection_recency) lim.push('No inspection records available.');
  if (!sections.listings.length) lim.push('No listing snapshots captured for this vehicle.');
  if (sections.source_count <= 1) lim.push('Evidence comes from a single source; cross-source corroboration is limited.');
  lim.push('This report reflects only evidence held by CarUp at generation time and may be incomplete.');
  return lim;
}

function buildAlerts(sections) {
  const alerts = [];
  for (const f of sections.temporal_findings) {
    alerts.push({ category: 'visual_change', type: f.finding_type, component: f.component, severity: f.severity, summary: f.public_summary, reviewed: f.reviewer_state === 'confirmed', evidence_count: (f.supporting_asset_ids || []).length, recommended_action: 'Review supporting images and consider an independent inspection.' });
  }
  for (const c of sections.disclosure_conflicts) {
    alerts.push({ category: 'disclosure', type: c.conflict_type, severity: c.severity, summary: c.public_summary, reviewed: c.reviewer_state === 'confirmed', evidence_count: (c.evidence_ids || []).length, recommended_action: 'Ask the seller to clarify; consider an independent inspection.' });
  }
  if (sections.mileage.anomaly) {
    alerts.push({ category: 'mileage', type: 'possible_mileage_inconsistency', severity: 'high', summary: 'Recorded mileage readings appear inconsistent over time; verify the odometer.', reviewed: false, evidence_count: sections.mileage.observations.length, recommended_action: 'Verify odometer against service/inspection records.' });
  }
  return alerts;
}

export async function assembleReport(supabase, vin, { audience = 'public' } = {}) {
  const privileged = isPrivileged(audience);
  const vehicleRows = await sel(supabase, 'vehicles', { vin });
  const identity = vehicleRows[0] || { vin };

  let evidence = await sel(supabase, 'vehicle_evidence', { vin });
  if (!privileged) evidence = evidence.filter((e) => e.verification_status === 'verified' && e.visibility_level === 'public_safe');

  const listings = await sel(supabase, 'listing_snapshots', { vin }, { order: { col: 'captured_at', asc: false } });

  let temporal = await sel(supabase, 'temporal_findings', { vin });
  if (!privileged) temporal = temporal.filter((f) => f.reviewer_state === 'confirmed' && f.public_summary);

  let conflicts = await sel(supabase, 'disclosure_conflicts', { vin });
  if (!privileged) conflicts = conflicts.filter((c) => c.reviewer_state === 'confirmed' && c.public_summary);

  const mileage = buildMileageHistory(evidence, listings);

  // Group evidence by life-stage class for the timeline sections.
  const byClass = {};
  for (const c of EVIDENCE_CLASSES) byClass[c] = [];
  for (const e of evidence) (byClass[e.evidence_class] = byClass[e.evidence_class] || []).push(e);

  const timeline = evidence
    .map((e) => ({ evidence_id: e.id, evidence_class: e.evidence_class, evidence_subtype: e.evidence_subtype, date: bestDate(e), source_id: e.source_id, verification_status: e.verification_status }))
    .filter((t) => t.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const sections = {
    identity: { vin: identity.vin, make: identity.make, model: identity.model, year: identity.year },
    evidence,
    listings,
    temporal_findings: temporal,
    disclosure_conflicts: conflicts,
    mileage,
    source_count: new Set(evidence.map((e) => e.source_id).filter(Boolean)).size,
  };

  const completeness = computeCompleteness(sections);
  const limitations = computeLimitations(sections, completeness);
  const alerts = buildAlerts(sections);

  // Evidence/source index (public-safe — ids + class + date + source, no raw model output).
  const evidenceIndex = evidence.map((e) => ({ evidence_id: e.id, evidence_class: e.evidence_class, evidence_subtype: e.evidence_subtype, date: bestDate(e), source_id: e.source_id, verification_status: e.verification_status }));

  return {
    schema: 'vehicle_history_report.v1',
    vin,
    audience,
    identity: sections.identity,
    key_alerts: alerts,
    timeline,
    sections: {
      auction_import: { auction: byClass.auction.length, import: byClass.import.length },
      accident_repair: { accident: byClass.accident.length, repair: byClass.repair.length },
      inspection: byClass.inspection.length,
      ownership_transfer: byClass.ownership_transfer.length,
      current_condition: byClass.current_condition.length,
    },
    mileage_history: mileage,
    listing_history: listings.map((l) => ({ version: l.version, captured_at: l.captured_at, title: l.title, price: l.price, currency: l.currency, advertised_mileage: l.advertised_mileage, claimed_condition: l.claimed_condition })),
    visual_comparisons: temporal.map((f) => ({ finding_type: f.finding_type, component: f.component, earlier_date: f.earlier_date, later_date: f.later_date, severity: f.severity, public_summary: f.public_summary, reviewer_state: f.reviewer_state })),
    disclosure: conflicts.map((c) => ({ conflict_type: c.conflict_type, classification: c.classification, severity: c.severity, public_summary: c.public_summary, reviewer_state: c.reviewer_state, seller_response: c.seller_response || null })),
    completeness,
    limitations,
    evidence_index: evidenceIndex,
    generated_at_note: 'Report freshness is set at generation time by the version snapshot.',
  };
}

export function hashReport(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Snapshot the assembled report into an immutable version (master plan §10.5, §10.8). */
export async function generateReportVersion(supabase, vin, { actorId = null, audience = 'public' } = {}) {
  const payload = await assembleReport(supabase, vin, { audience });
  const existing = await sel(supabase, 'report_versions', { vin }, { order: { col: 'version', asc: false } });
  const version = existing.length ? Number(existing[0].version) + 1 : 1;
  const row = {
    vin, version, generated_by: actorId, payload, content_hash: hashReport(payload),
    completeness: payload.completeness, supersedes_version: existing.length ? Number(existing[0].version) : null,
    generated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('report_versions').insert(row).select();
  if (error) throw new Error(`report version write failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

/** Create an expiring share link for a report version (master plan §10.5). */
export async function createShareLink(supabase, versionId, { ttlSeconds = 7 * 24 * 3600 } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { data, error } = await supabase.from('report_versions').update({ share_token: token, share_expires_at: expires }).eq('id', versionId).select();
  if (error) throw new Error(`share link write failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { share_token: token, share_expires_at: expires, version: row?.version };
}

/** Resolve a shared report by token, enforcing expiry + revocation (master plan §10.5, §10.8). */
export async function getReportByShareToken(supabase, token, { now = Date.now() } = {}) {
  const rows = await sel(supabase, 'report_versions', { share_token: token });
  const v = rows[0];
  if (!v) return { ok: false, reason: 'not_found' };
  if (v.revoked) return { ok: false, reason: 'revoked' };
  if (v.share_expires_at && new Date(v.share_expires_at).getTime() < now) return { ok: false, reason: 'expired' };
  return { ok: true, version: v.version, generated_at: v.generated_at, report: v.payload, correction_notice: v.correction_notice || null };
}

export async function revokeShare(supabase, versionId, { correctionNotice = null } = {}) {
  const { data, error } = await supabase.from('report_versions').update({ revoked: true, correction_notice: correctionNotice }).eq('id', versionId).select();
  if (error) throw new Error(`revoke failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

export default { assembleReport, hashReport, generateReportVersion, createShareLink, getReportByShareToken, revokeShare };
