/**
 * Vehicle Operations reviewer read model — Operations Control Plane M4.
 *
 * ONE VIN-centered aggregate that lets an authorized reviewer understand a
 * vehicle's complete operational state without opening five consoles. It is a
 * READ MODEL, not a new source of truth (G8/G13): every group is assembled from
 * the owning canonical service/table, and every mutation goes back through the
 * owning service — there is no combined "approve everything" write path.
 *
 * PRIVACY (manual §20 security):
 *  - no storage locators: file_path / file_url / storage_bucket never appear in
 *    the DTO — signed access stays behind the existing private-evidence route;
 *  - seller summary carries no email address, phone or address (unrelated PII);
 *  - audit entries expose decision facts (event, actor role, reason, timestamps)
 *    — never ip_address / user_agent / tokens;
 *  - allowed_actions are SERVER-derived from the Operations capability policy.
 */
import { evaluateCompleteness } from '../evidence/completenessEvaluator.js';
import { evaluateZimbabweRegistrationReadiness } from '../registration/zimbabweRegistrationLifecycle.js';
import {
  getSellerAuthorityState,
  toPublicSellerAuthorityStatement,
} from '../seller/sellerAuthorityService.js';
import {
  resolveSemanticClassification,
  semanticClassificationLabel,
} from '../evidence/evidenceTaxonomy.js';
import { allowedVehicleOperationsActions } from './operationsAuthorizationService.js';

const AUDIT_EVENT_LIMIT = 40;

function safeCount(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

export async function buildVehicleOperationsReview(client, { vin, userContext }) {
  const normalizedVin = String(vin || '').trim().toUpperCase();

  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    .select('vin, make, model, year, status, publication_status, chassis_number, engine_number, plate_number, temp_plate_id, registration_status, registration_status_source, registration_country, registration_authority, owner_id, current_seller_id, current_seller_type, tenant_id, import_source, duty_paid, zimra_verified, passport_verified, trust_score, trust_band, trust_confidence, trust_calculation_version, trust_evaluated_at, price, currency, listing_city, listing_province, created_at')
    .eq('vin', normalizedVin)
    .maybeSingle();
  if (vErr) throw new Error(`Vehicle read failed: ${vErr.message}`);
  if (!vehicle) return null;

  const sellerUserId = vehicle.current_seller_id || vehicle.owner_id || null;

  // ── Seller account summary (no unrelated PII) ─────────────────────────────
  let sellerAccount = null;
  if (sellerUserId) {
    const { data: user, error: uErr } = await client
      .from('users')
      .select('id, name, role, is_verified, email_verified_at, created_at')
      .eq('id', sellerUserId)
      .maybeSingle();
    if (uErr) throw new Error(`Seller account read failed: ${uErr.message}`);
    if (user) {
      sellerAccount = {
        id: user.id,
        name: user.name || null,
        role: user.role || null,
        account_verified: user.is_verified === true,
        email_verified: Boolean(user.email_verified_at),
        member_since: user.created_at || null,
      };
    }
  }

  // ── Seller Authority (canonical M2 service) ───────────────────────────────
  let sellerAuthority = null;
  if (sellerUserId) {
    const state = await getSellerAuthorityState(client, { vin: normalizedVin, sellerUserId, vehicle });
    sellerAuthority = {
      seller_user_id: sellerUserId,
      status: state.status,
      basis: state.basis,
      claim_type: state.claim_type,
      evidence_ids: state.evidence_ids,
      reason: state.reason,
      policy_version: state.policy_version,
      decided_by: state.decided_by,
      decided_at: state.decided_at,
      existing_relationship: state.existing_relationship,
      public_statement: toPublicSellerAuthorityStatement(state),
    };
  }

  // ── Zimbabwe registration lifecycle + provenance ──────────────────────────
  const registrationReadiness = evaluateZimbabweRegistrationReadiness({
    status: vehicle.registration_status,
    statusSource: vehicle.registration_status_source,
    plateNumber: vehicle.plate_number,
    tempPlateId: vehicle.temp_plate_id,
  });
  const registration = {
    recorded_stage: vehicle.registration_status || null,
    stage_source: vehicle.registration_status_source || null,
    // Truth-level honesty: a seller_stated source is a Seller statement, not a
    // CarUp review and not an authoritative registry fact.
    stage_provenance: vehicle.registration_status_source
      ? (vehicle.registration_status_source === 'seller_stated' ? 'seller_statement' : vehicle.registration_status_source)
      : 'not_recorded',
    lifecycle: registrationReadiness,
    plate_number_recorded: Boolean(vehicle.plate_number),
    temporary_permit_recorded: Boolean(vehicle.temp_plate_id),
    registration_country: vehicle.registration_country || null,
    registration_authority: vehicle.registration_authority || null,
  };

  // ── Evidence set, grouped by canonical class (no storage locators) ────────
  const { data: evidenceRows, error: eErr } = await client
    .from('vehicle_evidence')
    .select('id, evidence_type, evidence_class, evidence_subtype, verification_status, visibility_level, uploaded_by, uploader_role, source_id, source_name, checksum, event_date, event_date_precision, capture_country, uploaded_at, verified_by, verified_at, mime_type, metadata')
    .eq('vin', normalizedVin)
    .order('uploaded_at', { ascending: true });
  if (eErr) throw new Error(`Evidence read failed: ${eErr.message}`);

  const evidenceGroups = {};
  for (const row of evidenceRows || []) {
    const semantic = resolveSemanticClassification(row);
    const groupKey = semantic.evidence_class || 'unclassified';
    if (!evidenceGroups[groupKey]) evidenceGroups[groupKey] = [];
    const classificationHistory = Array.isArray(row.metadata?.classification_history)
      ? row.metadata.classification_history.map((h) => ({
          previous_evidence_class: h.previous_evidence_class ?? null,
          previous_evidence_subtype: h.previous_evidence_subtype ?? null,
          corrected_by_role: h.corrected_by_role ?? null,
          corrected_at: h.corrected_at ?? null,
          reason: h.reason ?? null,
        }))
      : [];
    evidenceGroups[groupKey].push({
      id: row.id,
      semantic_label: semanticClassificationLabel(row),
      evidence_class: row.evidence_class || null,
      evidence_subtype: row.evidence_subtype || null,
      semantic_source: semantic.semantic_source,
      legacy_evidence_type: row.evidence_type || null,
      legacy_contradicts_canonical: Boolean(
        row.evidence_class
        && row.evidence_type
        && !['vehicle_life_document', 'vehicle_life_photo'].includes(row.evidence_type)
        && resolveSemanticClassification({ evidence_type: row.evidence_type }).evidence_class !== row.evidence_class
      ),
      verification_status: row.verification_status,
      visibility_level: row.visibility_level,
      uploader_role: row.uploader_role || null,
      uploaded_by_seller: Boolean(sellerUserId && row.uploaded_by === sellerUserId),
      source_name: row.source_name || null,
      has_checksum: Boolean(row.checksum),
      event_date: row.event_date || null,
      event_date_precision: row.event_date_precision || null,
      capture_country: row.capture_country || null,
      uploaded_at: row.uploaded_at || null,
      verified_at: row.verified_at || null,
      mime_type: row.mime_type || null,
      ai_advisory_status: row.metadata?.ai_analysis?.ai_status || null,
      classification_history: classificationHistory,
    });
  }

  // ── Publication readiness (the real gate, verbatim) ───────────────────────
  const completeness = await evaluateCompleteness(normalizedVin, { client });

  // ── Document intelligence / reconciliation ────────────────────────────────
  const reconciliation = completeness.reconciliation || null;

  // ── Trust summary (canonical trust state + governed fact requests) ────────
  const { data: trustRequests, error: tErr } = await client
    .from('trust_fact_requests')
    .select('id, trust_fact, status, requested_by, created_at')
    .eq('vin', normalizedVin);
  if (tErr) throw new Error(`Trust fact read failed: ${tErr.message}`);
  const trustSummary = {
    trust_score: vehicle.trust_score ?? null,
    trust_band: vehicle.trust_band ?? null,
    trust_confidence: vehicle.trust_confidence ?? null,
    trust_calculation_version: vehicle.trust_calculation_version ?? null,
    trust_evaluated_at: vehicle.trust_evaluated_at ?? null,
    evaluated: Boolean(vehicle.trust_evaluated_at),
    pending_fact_requests: (trustRequests || []).filter((r) => r.status === 'pending').length,
    fact_requests: (trustRequests || []).map((r) => ({
      id: r.id, trust_fact: r.trust_fact, status: r.status, created_at: r.created_at,
    })),
  };

  // ── Governance summary ────────────────────────────────────────────────────
  const { data: reviewTasks, error: rtErr } = await client
    .from('review_tasks')
    .select('id, task_type, status, created_at')
    .eq('vin', normalizedVin);
  if (rtErr) throw new Error(`Governance read failed: ${rtErr.message}`);
  const { data: disputes, error: dErr } = await client
    .from('disputes')
    .select('id, status, created_at')
    .eq('vin', normalizedVin);
  if (dErr) throw new Error(`Dispute read failed: ${dErr.message}`);
  const governanceSummary = {
    open_review_tasks: (reviewTasks || []).filter((t) => ['open', 'in_review', 'escalated'].includes(t.status)).length,
    review_tasks: (reviewTasks || []).map((t) => ({ id: t.id, task_type: t.task_type, status: t.status, created_at: t.created_at })),
    open_disputes: (disputes || []).filter((d) => ['open', 'responded', 'independent_review', 'appealed'].includes(d.status)).length,
  };

  // ── Risk summary (canonical fraud service data; actions stay in that domain) ──
  const { data: fraudCases, error: fErr } = await client
    .from('fraud_cases')
    .select('id, status, severity, blocks_publication, created_at')
    .eq('vin', normalizedVin);
  if (fErr) throw new Error(`Risk read failed: ${fErr.message}`);
  const riskSummary = {
    open_cases: (fraudCases || []).filter((c) => ['open', 'investigating'].includes(c.status)).length,
    blocking_cases: (fraudCases || []).filter((c) => c.blocks_publication === true && ['open', 'investigating'].includes(c.status)).length,
    cases: (fraudCases || []).map((c) => ({
      id: c.id, status: c.status, severity: c.severity ?? null,
      blocks_publication: c.blocks_publication === true, created_at: c.created_at,
    })),
  };

  // ── Safe audit trail (decision facts only) ────────────────────────────────
  const { data: auditRows, error: aErr } = await client
    .from('trust_audit_events')
    .select('id, event_type, actor_role, actor_type, trust_fact, reason, evidence_ids, previous_value, new_value, created_at')
    .eq('vin', normalizedVin)
    .order('created_at', { ascending: false })
    .limit(AUDIT_EVENT_LIMIT);
  if (aErr) throw new Error(`Audit read failed: ${aErr.message}`);

  return {
    vin: normalizedVin,
    generated_at: new Date().toISOString(),
    vehicle: {
      vin: vehicle.vin,
      make: vehicle.make, model: vehicle.model, year: vehicle.year,
      status: vehicle.status,
      publication_status: vehicle.publication_status,
      chassis_number: vehicle.chassis_number || null,
      engine_number: vehicle.engine_number || null,
      import_source: vehicle.import_source || null,
      price: vehicle.price ?? null,
      currency: vehicle.currency || null,
      listing_city: vehicle.listing_city || null,
      listing_province: vehicle.listing_province || null,
      created_at: vehicle.created_at || null,
      passport_verified: vehicle.passport_verified === true,
      zimra_verified: vehicle.zimra_verified === true,
      duty_paid: vehicle.duty_paid === true,
    },
    seller: {
      account: sellerAccount,
      seller_type: vehicle.current_seller_type || null,
      owner_id: vehicle.owner_id || null,
      current_seller_id: vehicle.current_seller_id || null,
      tenant_id: vehicle.tenant_id || null,
    },
    seller_authority: sellerAuthority,
    registration,
    evidence: {
      total: safeCount(evidenceRows),
      groups: evidenceGroups,
    },
    document_intelligence: {
      reconciliation,
      unresolved_material_fields: reconciliation?.unresolved_material_fields ?? [],
    },
    trust_summary: trustSummary,
    governance_summary: governanceSummary,
    risk_summary: riskSummary,
    publication_readiness: {
      is_publishable: completeness.is_publishable,
      completeness_percent: completeness.completeness_percent,
      publication_status: completeness.publication_status,
      requirements: completeness.requirements,
      blocking_gaps: completeness.blocking_gaps,
      pending_gaps: completeness.pending_gaps,
    },
    audit: (auditRows || []).map((row) => ({
      id: row.id,
      event_type: row.event_type,
      actor_role: row.actor_role || null,
      actor_type: row.actor_type || null,
      trust_fact: row.trust_fact || null,
      reason: row.reason || null,
      evidence_ids: row.evidence_ids || [],
      previous_value: row.previous_value ?? null,
      new_value: row.new_value ?? null,
      created_at: row.created_at,
    })),
    allowed_actions: allowedVehicleOperationsActions(userContext),
  };
}

export default { buildVehicleOperationsReview };
