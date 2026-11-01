/**
 * Operations Control Plane M1 — canonical evidence semantics tests.
 *
 * THE RULE under test: semantic meaning = evidence_class + evidence_subtype;
 * the legacy evidence_type is compatibility/artifact-form metadata only and
 * must never override canonical semantics.
 *
 * Serena reality being pinned: her import documents are stored with legacy
 * evidence_type 'registration_document' / 'ownership_transfer_document' while
 * canonically classified import/*. Those rows must NEVER count as Zimbabwe
 * registration or ownership evidence, a Tanzania T1 transit declaration must
 * never read as a Temporary Import Permit, and a Japanese Export Certificate
 * must never read as Zimbabwe registration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const taxonomy = await import('../services/evidence/evidenceTaxonomy.js');
const evidenceService = await import('../services/evidence/evidenceService.js');
const provenanceService = await import('../services/evidence/provenanceService.js');
const correction = await import('../services/evidence/evidenceClassificationCorrectionService.js');
const projection = await import('../utils/publicVehicleProjection.js');

const {
  resolveSemanticClassification,
  isRegistrationEvidenceRow,
  isImportEvidenceRow,
  isInspectionEvidenceRow,
  isTemporaryImportPermitRow,
  satisfiesOwnershipRegistrationRequirementRow,
  isSellerAuthorityCandidateRow,
  isDocumentArtifactRow,
  deriveLegacyCompatibilityType,
  semanticClassificationLabel,
  GENERIC_COMPAT_DOCUMENT_TYPE,
  GENERIC_COMPAT_PHOTO_TYPE,
} = taxonomy;

// ---------------------------------------------------------------------------
// The Serena evidence matrix — the exact rows observed in staging (M0.19).
// ---------------------------------------------------------------------------
const SERENA_ROWS = {
  billOfLading: { evidence_type: 'ownership_transfer_document', evidence_class: 'import', evidence_subtype: 'bill_of_lading' },
  exportCertificate: { evidence_type: 'registration_document', evidence_class: 'import', evidence_subtype: 'export_certificate' },
  roadworthiness: { evidence_type: 'registration_document', evidence_class: 'inspection', evidence_subtype: 'roadworthiness' },
  transitDeclaration: { evidence_type: 'registration_document', evidence_class: 'import', evidence_subtype: 'transit_declaration' },
  commercialInvoice: { evidence_type: 'registration_document', evidence_class: 'import', evidence_subtype: 'commercial_invoice' },
  // Not yet uploaded, but part of the pack contract:
  paymentReceipt: { evidence_type: GENERIC_COMPAT_DOCUMENT_TYPE, evidence_class: 'import', evidence_subtype: 'payment_receipt' },
};

test('canonical class always wins over a contradictory legacy evidence_type', () => {
  for (const [name, row] of Object.entries(SERENA_ROWS)) {
    const resolved = resolveSemanticClassification(row);
    assert.equal(resolved.semantic_source, 'canonical', `${name} must resolve canonically`);
    assert.equal(resolved.evidence_class, row.evidence_class, name);
  }
});

test('Serena import documents can never satisfy the ownership/registration requirement', () => {
  for (const name of ['billOfLading', 'exportCertificate', 'transitDeclaration', 'commercialInvoice', 'paymentReceipt']) {
    const row = SERENA_ROWS[name];
    assert.equal(isRegistrationEvidenceRow(row), false, `${name} is not registration evidence`);
    assert.equal(satisfiesOwnershipRegistrationRequirementRow(row), false, `${name} must not satisfy ownership/registration`);
    assert.equal(isImportEvidenceRow(row), true, `${name} is import evidence`);
  }
  assert.equal(isInspectionEvidenceRow(SERENA_ROWS.roadworthiness), true);
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(SERENA_ROWS.roadworthiness), false);
});

test('a Tanzania T1 transit declaration is never a Temporary Import Permit', () => {
  assert.equal(isTemporaryImportPermitRow(SERENA_ROWS.transitDeclaration), false);
  assert.equal(isTemporaryImportPermitRow({ evidence_class: 'registration', evidence_subtype: 'temporary_import_permit' }), true);
  // Even a mislabeled legacy field cannot make a transit declaration a TIP.
  assert.equal(isTemporaryImportPermitRow({ ...SERENA_ROWS.transitDeclaration, evidence_type: 'registration_document' }), false);
});

test('a Japanese Export Certificate is never Zimbabwe registration', () => {
  assert.equal(isRegistrationEvidenceRow(SERENA_ROWS.exportCertificate), false);
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(SERENA_ROWS.exportCertificate), false);
});

test('true registration documents DO satisfy the requirement', () => {
  const registrationBook = { evidence_type: 'registration_document', evidence_class: 'registration', evidence_subtype: 'registration_book' };
  assert.equal(isRegistrationEvidenceRow(registrationBook), true);
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(registrationBook), true);
  const transferRecord = { evidence_type: 'ownership_transfer_document', evidence_class: 'ownership_transfer', evidence_subtype: 'transfer_record' };
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(transferRecord), true);
});

test('legacy-only historical rows keep working through the fallback mapping', () => {
  const legacyOnly = { evidence_type: 'registration_document', evidence_class: null, evidence_subtype: null };
  const resolved = resolveSemanticClassification(legacyOnly);
  assert.equal(resolved.semantic_source, 'legacy_fallback');
  assert.equal(resolved.evidence_class, 'registration');
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(legacyOnly), true);
  // A legacy-only photo row falls back too and never satisfies ownership.
  const legacyPhoto = { evidence_type: 'import_photo' };
  assert.equal(resolveSemanticClassification(legacyPhoto).evidence_class, 'import');
  assert.equal(satisfiesOwnershipRegistrationRequirementRow(legacyPhoto), false);
});

test('import purchase-chain documents are Seller Authority CANDIDATES without being registration', () => {
  for (const name of ['billOfLading', 'exportCertificate', 'commercialInvoice', 'paymentReceipt']) {
    assert.equal(isSellerAuthorityCandidateRow(SERENA_ROWS[name]), true, name);
    assert.equal(isRegistrationEvidenceRow(SERENA_ROWS[name]), false, name);
  }
  // Transit and inspection evidence are not authority candidates.
  assert.equal(isSellerAuthorityCandidateRow(SERENA_ROWS.transitDeclaration), false);
  assert.equal(isSellerAuthorityCandidateRow(SERENA_ROWS.roadworthiness), false);
});

test('canonical label never renders an import invoice as a Registration Document', () => {
  const label = semanticClassificationLabel(SERENA_ROWS.commercialInvoice);
  assert.match(label, /Import/);
  assert.match(label, /Commercial invoice/);
  assert.doesNotMatch(label, /Registration Document/i);
});

// ---------------------------------------------------------------------------
// Compatibility derivation for canonical-first uploads
// ---------------------------------------------------------------------------

test('deriveLegacyCompatibilityType maps exact counterparts and generic forms deterministically', () => {
  assert.equal(deriveLegacyCompatibilityType('registration', 'registration_book'), 'registration_document');
  assert.equal(deriveLegacyCompatibilityType('registration', 'police_clearance_first_registration'), 'police_clearance_document');
  assert.equal(deriveLegacyCompatibilityType('ownership_transfer', 'sale_agreement'), 'ownership_transfer_document');
  assert.equal(deriveLegacyCompatibilityType('accident', 'insurer_assessment'), 'insurance_document');
  // No honest legacy value exists for import documents → generic document form.
  assert.equal(deriveLegacyCompatibilityType('import', 'commercial_invoice'), GENERIC_COMPAT_DOCUMENT_TYPE);
  assert.equal(deriveLegacyCompatibilityType('import', 'transit_declaration'), GENERIC_COMPAT_DOCUMENT_TYPE);
  assert.equal(deriveLegacyCompatibilityType('inspection', 'roadworthiness'), GENERIC_COMPAT_DOCUMENT_TYPE);
  // Photos map to their class photo type.
  assert.equal(deriveLegacyCompatibilityType('import', 'port_photo'), 'import_photo');
  assert.equal(deriveLegacyCompatibilityType('inspection', 'odometer_reading'), 'odometer_photo');
  assert.equal(deriveLegacyCompatibilityType('current_condition', 'interior'), GENERIC_COMPAT_PHOTO_TYPE);
  // Invalid input never derives.
  assert.equal(deriveLegacyCompatibilityType('import', 'not_a_subtype'), null);
});

test('canonical-first upload payload validates WITHOUT a legacy evidence_type and derives the compat value', () => {
  const normalized = evidenceService.validateEvidenceUploadPayload({
    vin: 'GFC27-027051',
    evidence_class: 'import',
    evidence_subtype: 'payment_receipt',
    file_url: 'GFC27-027051/receipt.pdf',
    mime_type: 'application/pdf',
  });
  assert.equal(normalized.evidenceType, GENERIC_COMPAT_DOCUMENT_TYPE);
  assert.equal(normalized.explicitCanonical, true);
  assert.equal(normalized.evidenceClass, 'import');
  assert.equal(normalized.evidenceSubtype, 'payment_receipt');
});

test('a generic compat evidence_type is refused without a canonical classification', () => {
  assert.throws(() => evidenceService.validateEvidenceUploadPayload({
    vin: 'GFC27-027051',
    evidence_type: GENERIC_COMPAT_DOCUMENT_TYPE,
    file_url: 'GFC27-027051/x.pdf',
    mime_type: 'application/pdf',
  }), /requires evidence_class and evidence_subtype/);
});

test('legacy-only upload payloads keep their historical behavior', () => {
  const normalized = evidenceService.validateEvidenceUploadPayload({
    vin: 'GFC27-027051',
    evidence_type: 'registration_document',
    file_url: 'GFC27-027051/book.pdf',
    mime_type: 'application/pdf',
  });
  assert.equal(normalized.evidenceType, 'registration_document');
  assert.equal(normalized.explicitCanonical, false);
  assert.equal(normalized.evidenceClass, 'registration');
});

test('canonical-first uploads are authorized by life-stage class, not by the derived compat value', () => {
  const importInvoice = { evidenceType: GENERIC_COMPAT_DOCUMENT_TYPE, evidenceClass: 'import', evidenceSubtype: 'commercial_invoice', explicitCanonical: true };
  assert.equal(evidenceService.canUploadEvidenceRecord(importInvoice, 'owner'), true, 'the seller files their own import documents');
  assert.equal(evidenceService.canUploadEvidenceRecord(importInvoice, 'mechanic'), false);
  // Subtype override stays tighter than its class.
  const policeClearance = { evidenceType: 'police_clearance_document', evidenceClass: 'registration', evidenceSubtype: 'police_clearance_first_registration', explicitCanonical: true };
  assert.equal(evidenceService.canUploadEvidenceRecord(policeClearance, 'owner'), false);
  assert.equal(evidenceService.canUploadEvidenceRecord(policeClearance, 'government'), true);
  // Legacy path is untouched.
  assert.equal(evidenceService.canUploadEvidence('registration_document', 'owner'), true);
  assert.equal(evidenceService.canUploadEvidence('police_clearance_document', 'owner'), false);
});

test('document artifact form is decided canonically (bucket/visibility inputs)', () => {
  assert.equal(evidenceService.isDocumentUpload({ evidenceClass: 'import', evidenceSubtype: 'commercial_invoice', evidenceType: GENERIC_COMPAT_DOCUMENT_TYPE }), true);
  assert.equal(evidenceService.isDocumentUpload({ evidenceClass: 'import', evidenceSubtype: 'port_photo', evidenceType: 'import_photo' }), false);
  assert.equal(isDocumentArtifactRow({ evidence_type: 'registration_document' }), true);
  assert.equal(isDocumentArtifactRow({ evidence_type: GENERIC_COMPAT_PHOTO_TYPE }), false);
});

// ---------------------------------------------------------------------------
// Privacy projection stays intact with canonical fields present (M1.12/M1.23)
// ---------------------------------------------------------------------------

test('a private-bucket canonical import document still withholds its file URL publicly', () => {
  const row = {
    id: 'e1', vin: 'GFC27-027051',
    evidence_type: 'registration_document',
    evidence_class: 'import', evidence_subtype: 'commercial_invoice',
    storage_bucket: 'ocr-documents',
    file_url: 'https://private.example/signed', file_path: 'GFC27-027051/x.pdf',
    visibility_level: 'public_safe', verification_status: 'verified',
    uploaded_by: 'u_seller', verification_notes: 'internal note',
  };
  const projected = projection.toPublicEvidence(row);
  assert.equal(projected.file_url, null, 'private artifact URL must be withheld');
  assert.equal(projected.file_availability, 'withheld_private');
  assert.equal(projected.evidence_class, 'import');
  assert.equal(projected.evidence_subtype, 'commercial_invoice');
  assert.equal(projected.uploaded_by, undefined, 'uploader identity never projects publicly');
  assert.equal(projected.verification_notes, undefined);
});

// ---------------------------------------------------------------------------
// Governed classification correction (M1.13) & mock client helper
// ---------------------------------------------------------------------------

function makeMockClient({
  failAuditInsert = false,
  failEvidenceUpdate = false,
  failProvenanceInsert = false,
} = {}) {
  const tables = {
    vehicle_evidence: [{
      id: 'ev-1',
      vehicle_id: 'GFC27-027051',
      vin: 'GFC27-027051',
      evidence_type: 'registration_document',
      evidence_class: 'registration',
      evidence_subtype: 'registration_book',
      uploaded_by: 'u_seller',
      verification_status: 'pending',
      trust_score_impact: 0,
      confidence_impact: 2,
      visibility_level: 'public_safe',
      metadata: { existing: true },
    }],
    trust_audit_events: [],
    evidence_provenance_events: [],
    organization_users: [],
  };
  function builder(name) {
    const state = { op: 'select', filters: [], payload: null, single: false, maybe: false };
    const rowsFor = () => (tables[name] || []).filter((r) => state.filters.every(([k, v]) => r[k] === v));
    const finish = () => {
      if (state.op === 'insert') {
        if (name === 'trust_audit_events' && failAuditInsert) {
          return { data: null, error: { message: 'audit insert refused (test)' } };
        }
        if (name === 'evidence_provenance_events' && failProvenanceInsert) {
          return { data: null, error: { message: 'provenance insert refused (test)' } };
        }
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        tables[name] = [...(tables[name] || []), ...payloads];
        return { data: state.single ? payloads[0] : payloads, error: null };
      }
      if (state.op === 'update') {
        if (name === 'vehicle_evidence' && failEvidenceUpdate) {
          return { data: null, error: { message: 'evidence update refused (test)' } };
        }
        const matched = rowsFor();
        matched.forEach((r) => Object.assign(r, state.payload));
        const data = state.single ? (matched[0] ?? null) : matched;
        return { data, error: state.single && !matched[0] ? { message: 'no row' } : null };
      }
      const matched = rowsFor();
      if (state.single || state.maybe) return { data: matched[0] ?? null, error: (state.single && !state.maybe && !matched[0]) ? { message: 'no row' } : null };
      return { data: matched, error: null };
    };
    const chain = {
      select() { return chain; },
      insert(p) { state.op = 'insert'; state.payload = p; return chain; },
      update(p) { state.op = 'update'; state.payload = p; return chain; },
      eq(k, v) { state.filters.push([k, v]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      single() { state.single = true; return Promise.resolve(finish()); },
      maybeSingle() { state.maybe = true; return Promise.resolve(finish()); },
      then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
    };
    return chain;
  }

  async function rpc(fnName, params) {
    if (fnName !== 'carup_review_vehicle_evidence') {
      return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
    }
    const row = tables.vehicle_evidence.find(
      (r) => r.id === params.p_evidence_id && r.vin === params.p_vin,
    );
    if (!row) {
      return { data: null, error: { message: 'EVIDENCE_REVIEW_NOT_FOUND' } };
    }
    if (
      row.uploaded_by &&
      String(row.uploaded_by).trim().toLowerCase() === String(params.p_actor_user_id).trim().toLowerCase()
    ) {
      return { data: null, error: { message: 'EVIDENCE_REVIEW_SELF_FORBIDDEN' } };
    }

    const curStatus = row.verification_status || 'pending';
    const reqNotes = params.p_notes ? String(params.p_notes).trim() || null : null;
    const reqTrust = Number(params.p_trust_score_impact ?? 0);
    const reqConf =
      params.p_decision === 'verified'
        ? Number(params.p_confidence_impact ?? row.confidence_impact ?? 0)
        : Number(row.confidence_impact ?? 0);

    if (curStatus !== 'pending') {
      const existingNotes = row.verification_notes ? String(row.verification_notes).trim() || null : null;
      const existingTrust = Number(row.trust_score_impact ?? 0);
      const existingConf = Number(row.confidence_impact ?? 0);
      if (
        curStatus === params.p_decision &&
        String(row.verified_by || '').toLowerCase() === String(params.p_actor_user_id).toLowerCase() &&
        existingNotes === reqNotes &&
        existingTrust === reqTrust &&
        existingConf === reqConf
      ) {
        const lastAudit = tables.trust_audit_events.at(-1);
        const lastProv = tables.evidence_provenance_events.at(-1);
        return {
          data: {
            evidence: { ...row },
            previous_evidence: { ...row },
            audit_event_id: lastAudit?.id || 'audit-replay-1',
            provenance_event_id: lastProv?.id || 'prov-replay-1',
            provenance_event: lastProv || null,
            idempotent_replay: true,
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'EVIDENCE_REVIEW_CONFLICT' } };
    }

    if (failAuditInsert) {
      return { data: null, error: { message: 'EVIDENCE_REVIEW_AUDIT_FAILED: simulated audit failure' } };
    }
    if (failEvidenceUpdate) {
      return { data: null, error: { message: 'EVIDENCE_REVIEW_WRITE_FAILED: simulated update failure' } };
    }
    if (failProvenanceInsert) {
      return { data: null, error: { message: 'EVIDENCE_REVIEW_PROVENANCE_FAILED: simulated provenance failure' } };
    }

    const previousEvidence = { ...row };
    const eventType = params.p_decision === 'verified' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED';
    const provEventType = params.p_decision === 'verified' ? 'approved' : 'rejected';

    const auditRow = {
      id: `audit-${tables.trust_audit_events.length + 1}`,
      event_type: eventType,
      vin: params.p_vin,
      vehicle_id: row.vehicle_id || params.p_vin,
      trust_fact: 'evidence_verification',
      previous_value: params.p_previous_value,
      new_value: params.p_new_value,
      actor_user_id: params.p_actor_user_id,
      actor_role: params.p_actor_role,
      actor_tenant_id: params.p_actor_tenant_id,
      actor_type: 'user',
      source_dashboard: 'operations',
      source_route: params.p_source_route,
      evidence_ids: [params.p_evidence_id],
      reason: reqNotes,
      decision_notes: reqNotes,
      request_id: params.p_request_id,
      ip_address: params.p_ip_address,
      user_agent: params.p_user_agent,
    };

    const provRow = {
      id: `prov-${tables.evidence_provenance_events.length + 1}`,
      evidence_id: params.p_evidence_id,
      vin: params.p_vin,
      sequence: params.p_expected_sequence,
      event_type: provEventType,
      actor_user_id: params.p_actor_user_id,
      actor_role: params.p_actor_role,
      actor_type: 'user',
      source_route: params.p_source_route,
      request_id: params.p_request_id,
      ip_address: params.p_ip_address,
      details: params.p_provenance_details,
      prev_hash: params.p_expected_prev_hash,
      content_hash: params.p_content_hash,
    };

    Object.assign(row, {
      verification_status: params.p_decision,
      verification_notes: reqNotes,
      verified_by: params.p_actor_user_id,
      verified_at: params.p_reviewed_at || new Date().toISOString(),
      trust_impact: reqTrust,
      trust_score_impact: reqTrust,
      confidence_impact: reqConf,
      updated_at: params.p_reviewed_at || new Date().toISOString(),
    });
    tables.trust_audit_events.push(auditRow);
    tables.evidence_provenance_events.push(provRow);

    return {
      data: {
        evidence: { ...row },
        previous_evidence: previousEvidence,
        audit_event_id: auditRow.id,
        provenance_event_id: provRow.id,
        provenance_event: provRow,
        idempotent_replay: false,
      },
      error: null,
    };
  }

  return { from: builder, rpc, _tables: tables };
}

const REVIEWER = { id: 'u_reviewer', role: 'government', tenantId: null };

test('classification correction updates only the canonical fields and preserves history', async () => {
  const client = makeMockClient();
  const result = await correction.correctEvidenceClassification(client, {
    vin: 'GFC27-027051', evidenceId: 'ev-1',
    evidenceClass: 'import', evidenceSubtype: 'commercial_invoice',
    reason: 'Artifact is a BE FORWARD commercial invoice, not a registration book',
    actor: REVIEWER,
  });
  assert.equal(result.changed, true);
  const row = client._tables.vehicle_evidence[0];
  assert.equal(row.evidence_class, 'import');
  assert.equal(row.evidence_subtype, 'commercial_invoice');
  assert.equal(row.evidence_type, 'registration_document', 'the historical legacy value is preserved');
  const history = row.metadata.classification_history;
  assert.equal(history.length, 1);
  assert.equal(history[0].previous_evidence_class, 'registration');
  assert.equal(history[0].previous_evidence_subtype, 'registration_book');
  assert.equal(history[0].corrected_by, 'u_reviewer');
  assert.match(history[0].reason, /commercial invoice/);
  const audits = client._tables.trust_audit_events;
  assert.equal(audits.length, 1);
  assert.equal(audits[0].event_type, correction.EVIDENCE_CLASSIFICATION_CORRECTED_EVENT);
});

test('classification correction fails closed when the audit cannot be written', async () => {
  const client = makeMockClient({ failAuditInsert: true });
  await assert.rejects(
    correction.correctEvidenceClassification(client, {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'commercial_invoice',
      reason: 'test', actor: REVIEWER,
    }),
    (err) => err.code === 'CLASSIFICATION_CORRECTION_AUDIT_FAILED'
  );
  const row = client._tables.vehicle_evidence[0];
  assert.equal(row.evidence_class, 'registration', 'no mutation without an audit record');
});

test('the uploader cannot correct their own evidence classification', async () => {
  const client = makeMockClient();
  await assert.rejects(
    correction.correctEvidenceClassification(client, {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'commercial_invoice',
      reason: 'self serve', actor: { id: 'u_seller', role: 'government' },
    }),
    (err) => err.code === 'CLASSIFICATION_CORRECTION_SELF'
  );
});

test('a reason and a valid taxonomy pair are mandatory', async () => {
  const client = makeMockClient();
  await assert.rejects(
    correction.correctEvidenceClassification(client, {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'commercial_invoice',
      reason: '   ', actor: REVIEWER,
    }),
    /reason is required/
  );
  await assert.rejects(
    correction.correctEvidenceClassification(client, {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'temporary_import_permit',
      reason: 'wrong pair', actor: REVIEWER,
    }),
    /not valid for class/
  );
});

test('an identical classification is a no-op, not a new decision', async () => {
  const client = makeMockClient();
  const result = await correction.correctEvidenceClassification(client, {
    vin: 'GFC27-027051', evidenceId: 'ev-1',
    evidenceClass: 'registration', evidenceSubtype: 'registration_book',
    reason: 'same', actor: REVIEWER,
  });
  assert.equal(result.changed, false);
  assert.equal(client._tables.trust_audit_events.length, 0);
});

// ---------------------------------------------------------------------------
// Timeline label (M1.11)
// ---------------------------------------------------------------------------

test('timeline items label canonically-classified rows by their life-stage meaning', () => {
  const item = evidenceService.evidenceToTimelineItem({
    id: 'ev-9', vin: 'GFC27-027051',
    evidence_type: 'registration_document',
    evidence_class: 'import', evidence_subtype: 'transit_declaration',
    uploaded_at: '2026-09-02T11:28:00Z', verification_status: 'pending',
  });
  assert.match(item.label, /Import/);
  assert.match(item.label, /Transit declaration/);
  assert.doesNotMatch(item.label, /Registration Document/i);
  // Legacy-only rows keep their historical label.
  const legacyItem = evidenceService.evidenceToTimelineItem({
    id: 'ev-10', vin: 'X', evidence_type: 'registration_document',
    uploaded_at: '2026-01-01T00:00:00Z', verification_status: 'pending',
  });
  assert.equal(legacyItem.label, 'Registration Document');
});

// ===========================================================================================
// M7 — PUBLISHING A SOURCE DOCUMENT IS A GOVERNED DECISION
// ===========================================================================================
test('an uploader cannot publish a source document by asking for it', () => {
  const asSeller = evidenceService.resolveEvidenceVisibility({
    requested: 'public_safe',
    isDocument: true,
    mayPublish: false,
  });
  assert.equal(asSeller.visibility, 'restricted', 'a seller may not widen a document to public');
  assert.equal(asSeller.refused, true, 'the refusal must be reported so it can be recorded');
  assert.equal(asSeller.requested, 'public_safe');
});

test('narrowing is always the uploader\'s to choose', () => {
  for (const level of ['private', 'government_only']) {
    const result = evidenceService.resolveEvidenceVisibility({ requested: level, isDocument: true, mayPublish: false });
    assert.equal(result.visibility, level, `an uploader may narrow a document to ${level}`);
    assert.equal(result.refused, false);
  }
});

test('a reviewer holding the evidence review capability may publish a document', () => {
  const asReviewer = evidenceService.resolveEvidenceVisibility({
    requested: 'public_safe',
    isDocument: true,
    mayPublish: true,
  });
  assert.equal(asReviewer.visibility, 'public_safe');
  assert.equal(asReviewer.refused, false);
});

test('photos are unaffected — they are public by default and stay that way', () => {
  const photo = evidenceService.resolveEvidenceVisibility({ requested: 'public_safe', isDocument: false, mayPublish: false });
  assert.equal(photo.visibility, 'public_safe');
  assert.equal(photo.refused, false);
  const narrowed = evidenceService.resolveEvidenceVisibility({ requested: 'restricted', isDocument: false, mayPublish: false });
  assert.equal(narrowed.visibility, 'restricted', 'a seller may still withhold their own photo');
});

test('the upload route decides visibility on the server, not from the body', () => {
  const routes = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    routes,
    /visibility_level\s*\|\|\s*req\.body\.visibilityLevel\s*\|\|\s*\(/,
    'visibility must not be taken from the request body with a mere fallback default',
  );
  assert.match(routes, /resolveEvidenceVisibility\(\{/, 'the route must use the governed resolver');
  assert.match(routes, /visibility_request_refused/, 'a clamped request must be recorded on the row');
});

test('a governed correction can withdraw a document the uploader was never entitled to publish', async () => {
  const client = makeMockClient();
  const result = await correction.correctEvidenceClassification(client, {
    vin: 'GFC27-027051', evidenceId: 'ev-1',
    evidenceClass: 'import', evidenceSubtype: 'transit_declaration',
    visibilityLevel: 'restricted',
    reason: 'Tanzania T1 is a transit document; §13 lists it Restricted and no reviewer approved publication',
    actor: REVIEWER,
  });
  assert.equal(result.changed, true);

  const row = client._tables.vehicle_evidence[0];
  assert.equal(row.visibility_level, 'restricted', 'the document must be withdrawn from public view');

  const history = row.metadata.classification_history.at(-1);
  assert.equal(history.previous_visibility_level, 'public_safe');
  assert.equal(history.corrected_visibility_level, 'restricted');
  assert.equal(history.corrected_by, 'u_reviewer');

  const audit = client._tables.trust_audit_events.at(-1);
  assert.equal(audit.previous_value.visibility_level, 'public_safe');
  assert.equal(audit.new_value.visibility_level, 'restricted');
});

test('a visibility correction is refused without a reason, and an unknown level is rejected', async () => {
  await assert.rejects(
    correction.correctEvidenceClassification(makeMockClient(), {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'transit_declaration',
      visibilityLevel: 'restricted',
      reason: '   ',
      actor: REVIEWER,
    }),
    /reason is required/i,
  );
  await assert.rejects(
    correction.correctEvidenceClassification(makeMockClient(), {
      vin: 'GFC27-027051', evidenceId: 'ev-1',
      evidenceClass: 'import', evidenceSubtype: 'transit_declaration',
      visibilityLevel: 'world_readable',
      reason: 'a real reason',
      actor: REVIEWER,
    }),
    /Unknown visibility_level/,
  );
});

test('omitting visibility corrects only the classification and leaves publication untouched', async () => {
  const client = makeMockClient();
  await correction.correctEvidenceClassification(client, {
    vin: 'GFC27-027051', evidenceId: 'ev-1',
    evidenceClass: 'import', evidenceSubtype: 'commercial_invoice',
    reason: 'classification only',
    actor: REVIEWER,
  });
  assert.equal(client._tables.vehicle_evidence[0].visibility_level, 'public_safe',
    'a classification-only correction must not silently change who can see the document');
});

// ---------------------------------------------------------------------------
// CARUP-PAY-03A-STG01-R3 Work Unit 2: Fail-closed evidence review governance
// ---------------------------------------------------------------------------

test('Work Unit 2: reviewEvidenceRecord enforces proven session, capability, independent reviewer (no self-review), and fail-closed audit persistence', async () => {
  const { reviewEvidenceRecord } = evidenceService;
  const routes = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');

  // 1. Route-level contract: both /verify and /reject require allowUserIdFallback: false and VEHICLE_EVIDENCE_REVIEW capability
  assert.match(
    routes,
    /router\.patch\(\s*'\/api\/vehicles\/:vin\/evidence\/:evidenceId\/verify',\s*authorizeRole\(\['admin',\s*'government'\],\s*\{\s*allowUserIdFallback:\s*false\s*\}\),\s*requireOperationsCapability\(OPERATIONS_CAPABILITIES\.VEHICLE_EVIDENCE_REVIEW\)/,
    '/verify route must require proven session (allowUserIdFallback: false) and VEHICLE_EVIDENCE_REVIEW capability',
  );
  assert.match(
    routes,
    /router\.patch\(\s*'\/api\/vehicles\/:vin\/evidence\/:evidenceId\/reject',\s*authorizeRole\(\['admin',\s*'government'\],\s*\{\s*allowUserIdFallback:\s*false\s*\}\),\s*requireOperationsCapability\(OPERATIONS_CAPABILITIES\.VEHICLE_EVIDENCE_REVIEW\)/,
    '/reject route must require proven session (allowUserIdFallback: false) and VEHICLE_EVIDENCE_REVIEW capability',
  );

  // 2. Fallback identity (`x-user-id-fallback`) is refused with 403 OPERATIONS_PROVEN_SESSION_REQUIRED
  const client1 = makeMockClient();
  await assert.rejects(
    reviewEvidenceRecord(client1, {
      vin: 'GFC27-027051',
      evidenceId: 'ev-1',
      decision: 'verified',
      notes: 'Attempt via x-user-id fallback',
      actor: {
        id: 'u_reviewer',
        role: 'admin',
        baseRole: 'admin',
        platformRole: 'admin',
        authenticationMethod: 'x-user-id-fallback',
      },
    }),
    (err) => err.code === 'OPERATIONS_PROVEN_SESSION_REQUIRED' && err.status === 403,
  );
  assert.equal(client1._tables.vehicle_evidence[0].verification_status, 'pending');

  // 3. Self-review (`uploaded_by === actor.id`) is refused with 403 EVIDENCE_REVIEW_SELF_FORBIDDEN even for an admin
  const client2 = makeMockClient();
  client2._tables.vehicle_evidence[0].uploaded_by = 'u_admin_uploader';
  await assert.rejects(
    reviewEvidenceRecord(client2, {
      vin: 'GFC27-027051',
      evidenceId: 'ev-1',
      decision: 'verified',
      notes: 'Self-approval attempt',
      actor: {
        id: 'u_admin_uploader',
        role: 'admin',
        baseRole: 'admin',
        platformRole: 'admin',
        authenticationMethod: 'session',
      },
    }),
    (err) => err.code === 'EVIDENCE_REVIEW_SELF_FORBIDDEN' && err.status === 403,
  );
  assert.equal(client2._tables.vehicle_evidence[0].verification_status, 'pending');
  assert.equal(client2._tables.trust_audit_events.length, 0);

  // 4. Audit persistence failure refuses verification and leaves vehicle_evidence unmutated (fail-closed)
  const clientFailAudit = makeMockClient({ failAuditInsert: true });
  await assert.rejects(
    reviewEvidenceRecord(clientFailAudit, {
      vin: 'GFC27-027051',
      evidenceId: 'ev-1',
      decision: 'verified',
      notes: 'Should fail closed when trust_audit_events fails',
      actor: {
        id: 'u_independent_reviewer',
        role: 'admin',
        baseRole: 'admin',
        platformRole: 'admin',
        authenticationMethod: 'session',
      },
    }),
    (err) => err.code === 'EVIDENCE_REVIEW_AUDIT_FAILED' && err.status === 500,
  );
  assert.equal(
    clientFailAudit._tables.vehicle_evidence[0].verification_status,
    'pending',
    'vehicle_evidence must remain pending when audit insert fails',
  );

  // 5. Positive control: independent proven reviewer with working atomic RPC persists EVIDENCE_VERIFIED, updates row, and appends provenance
  const clientOk = makeMockClient();
  const okResult = await reviewEvidenceRecord(clientOk, {
    vin: 'GFC27-027051',
    evidenceId: 'ev-1',
    decision: 'verified',
    notes: 'Independently verified by operations reviewer',
    requestedTrustImpact: 3,
    actor: {
      id: 'u_independent_reviewer',
      role: 'admin',
      baseRole: 'admin',
      platformRole: 'admin',
      authenticationMethod: 'session',
    },
  });
  assert.equal(okResult.evidence.verification_status, 'verified');
  assert.equal(okResult.evidence.verified_by, 'u_independent_reviewer');
  assert.ok(okResult.auditEventId);
  assert.ok(okResult.provenanceEventId);
  assert.equal(clientOk._tables.trust_audit_events.length, 1);
  assert.equal(clientOk._tables.evidence_provenance_events.length, 1);
});

// ---------------------------------------------------------------------------
// CARUP-PAY-03A-STG01-R3-R1: Adversarial Real PostgreSQL (PGlite) Tests
// Verifies atomic transaction boundary on `public.carup_review_vehicle_evidence`
// ---------------------------------------------------------------------------

function stripMigrateDown(sqlText) {
  return sqlText
    .replace(/^-- \+migrate Down[\s\S]*$/m, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS\s+"?(?:uuid-ossp|pgcrypto)"?\s*;/gi, '');
}

/**
 * Minimal Supabase-compatible client adapter over a real disposable PGlite instance
 * so `reviewEvidenceRecord`, `recordProvenanceEvent`, and `verifyProvenanceChain`
 * execute against genuine PostgreSQL tables, triggers, constraints, and PL/pgSQL RPCs.
 */
function createPGliteSupabaseAdapter(pg) {
  function from(tableName) {
    const state = {
      op: 'select',
      selectCols: '*',
      filters: [],
      orders: [],
      limitCount: null,
      payload: null,
      single: false,
      maybe: false,
    };

    const runQuery = async () => {
      try {
        if (state.op === 'insert') {
          const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
          const inserted = [];
          for (const row of rows) {
            const keys = Object.keys(row).filter((k) => row[k] !== undefined);
            const colsSql = keys.map((k) => `"${k}"`).join(', ');
            const valsSql = keys
              .map((k, idx) => {
                const v = row[k];
                if (v !== null && typeof v === 'object') return `$${idx + 1}::jsonb`;
                return `$${idx + 1}`;
              })
              .join(', ');
            const params = keys.map((k) => {
              const v = row[k];
              if (v !== null && typeof v === 'object') return JSON.stringify(v);
              return v;
            });
            const res = await pg.query(
              `INSERT INTO public."${tableName}" (${colsSql}) VALUES (${valsSql}) RETURNING *`,
              params,
            );
            if (res.rows[0]) inserted.push(res.rows[0]);
          }
          if (state.single || state.maybe) {
            return { data: inserted[0] ?? null, error: null };
          }
          return { data: inserted, error: null };
        }

        if (state.op === 'update') {
          const keys = Object.keys(state.payload || {}).filter((k) => state.payload[k] !== undefined);
          const params = [];
          const setClauses = keys.map((k) => {
            const v = state.payload[k];
            if (v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v));
              return `"${k}" = $${params.length}::jsonb`;
            }
            params.push(v);
            return `"${k}" = $${params.length}`;
          });
          const whereClauses = state.filters.map(([k, v]) => {
            params.push(v);
            return `"${k}" = $${params.length}`;
          });
          const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
          const res = await pg.query(
            `UPDATE public."${tableName}" SET ${setClauses.join(', ')} ${whereSql} RETURNING *`,
            params,
          );
          if (state.single) {
            if (!res.rows[0]) return { data: null, error: { message: 'Row not found for update' } };
            return { data: res.rows[0], error: null };
          }
          if (state.maybe) return { data: res.rows[0] ?? null, error: null };
          return { data: res.rows, error: null };
        }

        const params = [];
        const whereClauses = state.filters.map(([k, v]) => {
          params.push(v);
          return `"${k}" = $${params.length}`;
        });
        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const orderSql = state.orders.length
          ? `ORDER BY ${state.orders.map(([col, asc]) => `"${col}" ${asc ? 'ASC' : 'DESC'}`).join(', ')}`
          : '';
        const limitSql = state.limitCount !== null ? `LIMIT ${Number(state.limitCount)}` : '';
        const res = await pg.query(
          `SELECT * FROM public."${tableName}" ${whereSql} ${orderSql} ${limitSql}`,
          params,
        );
        if (state.single) {
          if (!res.rows[0]) return { data: null, error: { message: 'No rows returned' } };
          return { data: res.rows[0], error: null };
        }
        if (state.maybe) {
          return { data: res.rows[0] ?? null, error: null };
        }
        return { data: res.rows, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
    };

    const chain = {
      select(cols = '*') { state.selectCols = cols; return chain; },
      insert(p) { state.op = 'insert'; state.payload = p; return chain; },
      update(p) { state.op = 'update'; state.payload = p; return chain; },
      eq(k, v) { state.filters.push([k, v]); return chain; },
      order(col, opts = {}) { state.orders.push([col, opts.ascending !== false]); return chain; },
      limit(n) { state.limitCount = n; return chain; },
      single() { state.single = true; return runQuery(); },
      maybeSingle() { state.maybe = true; return runQuery(); },
      then(resolve, reject) { return runQuery().then(resolve, reject); },
    };
    return chain;
  }

  async function rpc(fnName, params) {
    if (fnName !== 'carup_review_vehicle_evidence') {
      return { data: null, error: { message: `Unsupported RPC in test adapter: ${fnName}` } };
    }
    try {
      const res = await pg.query(
        `SELECT public.carup_review_vehicle_evidence(
          $1::text,
          $2::uuid,
          $3::text,
          $4::text,
          $5::numeric,
          $6::numeric,
          $7::text,
          $8::text,
          $9::text,
          $10::text,
          $11::text,
          $12::text,
          $13::text,
          $14::jsonb,
          $15::jsonb,
          $16::jsonb,
          $17::integer,
          $18::text,
          $19::text,
          $20::timestamptz
        ) AS result`,
        [
          params.p_vin,
          params.p_evidence_id,
          params.p_decision,
          params.p_notes,
          params.p_trust_score_impact,
          params.p_confidence_impact,
          params.p_actor_user_id,
          params.p_actor_role,
          params.p_actor_tenant_id,
          params.p_source_route,
          params.p_request_id,
          params.p_ip_address,
          params.p_user_agent,
          JSON.stringify(params.p_previous_value ?? {}),
          JSON.stringify(params.p_new_value ?? {}),
          JSON.stringify(params.p_provenance_details ?? {}),
          params.p_expected_sequence,
          params.p_expected_prev_hash,
          params.p_content_hash,
          params.p_reviewed_at || new Date().toISOString(),
        ],
      );
      return { data: res.rows[0]?.result ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  return { from, rpc };
}

test('STG01-R3-R1 Adversarial PostgreSQL Suite: atomic transaction boundary, rollbacks, concurrency conflicts, idempotency, session/self-review/capability guards, and provenance hash chain', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
      $$;
      CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$
        SELECT gen_random_uuid();
      $$;
      CREATE OR REPLACE FUNCTION public.digest(data text, type text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
        SELECT sha256(convert_to(data, 'UTF8'));
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    `);

    const migrationsToApply = [
      '../../database/migrations/supabase_schema.sql',
      '../../database/migrations/011_phase6_schema.sql',
      '../../database/migrations/014_passport_evidence_architecture.sql',
      '../../database/migrations/015_vehicle_evidence_timeline.sql',
      '../../database/migrations/20260603233640_governance_foundation_trust_audit_events.sql',
      '../../database/migrations/20260621120000_vehicle_life_evidence_taxonomy_provenance.sql',
      '../../database/migrations/20260621130000_external_source_ingestion.sql',
      '../../database/migrations/20260621140000_ai_temporal_disclosure_intelligence.sql',
      '../../database/migrations/20260621150000_report_versions.sql',
      '../../database/migrations/20260624120000_vehicle_trust_security_hardening.sql',
      '../../database/migrations/20261029181000_carup_pay01a_stripe_sandbox.sql',
      '../../database/migrations/20261030223000_carup_pay01c_demo_product.sql',
      '../../database/migrations/20261031143000_carup_pay02_commercial_foundation.sql',
      '../../database/migrations/20261031160000_carup_pay03a_real_report_commerce.sql',
    ];

    for (const relPath of migrationsToApply) {
      const sql = stripMigrateDown(readFileSync(new URL(relPath, import.meta.url), 'utf8'));
      await pg.exec(sql);
    }

    const pgClient = createPGliteSupabaseAdapter(pg);
    const { reviewEvidenceRecord } = evidenceService;
    const { recordProvenanceEvent, verifyProvenanceChain } = provenanceService;

    // Seed actors & vehicle in real PostgreSQL
    const testVin = 'RU3-ATOMIC-TEST-01';
    const evidenceIdA = '11111111-2222-4333-8444-555555555501';
    const evidenceIdB = '11111111-2222-4333-8444-555555555502';

    await pg.exec(`
      INSERT INTO public.users (id, name, email, role, is_verified, subscription, join_date) VALUES
        ('u_seller_uploader', 'Seller Uploader', 'seller.atomic@carup.test', 'owner', true, 'Free', '2026-10-31'),
        ('u_ops_reviewer_1', 'Ops Reviewer One', 'reviewer1.atomic@carup.test', 'admin', true, 'System', '2026-10-31'),
        ('u_ops_reviewer_2', 'Ops Reviewer Two', 'reviewer2.atomic@carup.test', 'government', true, 'System', '2026-10-31'),
        ('u_unprivileged_buyer', 'Dealer No Cap', 'dealer.atomic@carup.test', 'dealer', true, 'Free', '2026-10-31')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.vehicles (
        vin, make, model, generation, trim, year, color, mileage,
        fuel_type, drivetrain, transmission, import_source, duty_paid, police_verified,
        status, trust_score, price, currency
      ) VALUES (
        '${testVin}', 'Honda', 'Vezel Hybrid', 'RU3', 'Hybrid Z', 2018, 'Pearl White', 54120,
        'Hybrid', '2WD', 'AT', 'Japan', true, true,
        'Available', 90.0, 14500, 'USD'
      );

      INSERT INTO public.vehicle_evidence (
        id, vehicle_id, vin, event_type, evidence_type, evidence_class, evidence_subtype,
        file_url, storage_bucket, file_path, mime_type, file_size,
        uploaded_by, uploader_role, verification_status, trust_score_impact, confidence_impact,
        visibility_level, checksum, metadata
      ) VALUES
        (
          '${evidenceIdA}', '${testVin}', '${testVin}', 'import_photo', 'import_photo', 'import', 'port_photo',
          'https://private.example/secret-signed-url-a.jpg', 'vehicle-images', '${testVin}/export_yard_a.jpg',
          'image/jpeg', 2048,
          'u_seller_uploader', 'owner', 'pending', 0, 2,
          'public_safe', 'deadbeefcafe0001deadbeefcafe0001deadbeefcafe0001deadbeefcafe0001',
          '{"source":"atomic_pg_test"}'::jsonb
        ),
        (
          '${evidenceIdB}', '${testVin}', '${testVin}', 'import_photo', 'import_photo', 'import', 'port_photo',
          'https://private.example/secret-signed-url-b.jpg', 'vehicle-images', '${testVin}/export_yard_b.jpg',
          'image/jpeg', 2048,
          'u_seller_uploader', 'owner', 'pending', 0, 1,
          'public_safe', 'deadbeefcafe0002deadbeefcafe0002deadbeefcafe0002deadbeefcafe0002',
          '{"source":"atomic_pg_test"}'::jsonb
        );
    `);

    // Seed initial `uploaded` provenance event (sequence = 1) for both evidence records
    const initProvA = await recordProvenanceEvent(pgClient, {
      evidenceId: evidenceIdA,
      vin: testVin,
      eventType: 'uploaded',
      actorUserId: 'u_seller_uploader',
      actorRole: 'owner',
      actorType: 'user',
      details: { evidence_class: 'import', evidence_subtype: 'port_photo' },
    });
    assert.equal(Number(initProvA.sequence), 1);

    const initProvB = await recordProvenanceEvent(pgClient, {
      evidenceId: evidenceIdB,
      vin: testVin,
      eventType: 'uploaded',
      actorUserId: 'u_seller_uploader',
      actorRole: 'owner',
      actorType: 'user',
      details: { evidence_class: 'import', evidence_subtype: 'port_photo' },
    });
    assert.equal(Number(initProvB.sequence), 1);

    const reviewer1 = {
      id: 'u_ops_reviewer_1',
      role: 'admin',
      baseRole: 'admin',
      platformRole: 'admin',
      authenticationMethod: 'session',
    };
    const reviewer2 = {
      id: 'u_ops_reviewer_2',
      role: 'government',
      baseRole: 'government',
      platformRole: 'government',
      authenticationMethod: 'jwt',
    };

    // -------------------------------------------------------------------------
    // Case 6: Invalid, expired, or `x-user-id` fallback session
    // -------------------------------------------------------------------------
    for (const badActor of [
      null,
      { id: null, role: 'admin', baseRole: 'admin', platformRole: 'admin', authenticationMethod: 'session' },
      { id: 'u_ops_reviewer_1', role: 'admin', baseRole: 'admin', platformRole: 'admin', authenticationMethod: 'none' },
      { id: 'u_ops_reviewer_1', role: 'admin', baseRole: 'admin', platformRole: 'admin', authenticationMethod: 'expired-jwt' },
    ]) {
      await assert.rejects(
        reviewEvidenceRecord(pgClient, {
          vin: testVin,
          evidenceId: evidenceIdA,
          decision: 'verified',
          notes: 'Unauthenticated or expired session attempt',
          actor: badActor,
        }),
        (err) => err.code === 'OPERATIONS_UNAUTHENTICATED' && err.status === 401,
      );
    }

    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Fallback x-user-id header attempt',
        actor: {
          id: 'u_ops_reviewer_1',
          role: 'admin',
          baseRole: 'admin',
          platformRole: 'admin',
          authenticationMethod: 'x-user-id-fallback',
        },
      }),
      (err) => err.code === 'OPERATIONS_PROVEN_SESSION_REQUIRED' && err.status === 403,
    );

    // -------------------------------------------------------------------------
    // Case 7: Reviewer equals uploader (service pre-check AND direct SQL RPC check)
    // -------------------------------------------------------------------------
    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Uploader attempting self-review',
        actor: {
          id: 'u_seller_uploader',
          role: 'admin',
          baseRole: 'admin',
          platformRole: 'admin',
          authenticationMethod: 'session',
        },
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_SELF_FORBIDDEN' && err.status === 403,
    );

    const directSelfReviewRpc = await pgClient.rpc('carup_review_vehicle_evidence', {
      p_vin: testVin,
      p_evidence_id: evidenceIdA,
      p_decision: 'verified',
      p_notes: 'Direct RPC self-review bypass attempt',
      p_trust_score_impact: 3,
      p_confidence_impact: 2,
      p_actor_user_id: 'u_seller_uploader',
      p_actor_role: 'admin',
      p_actor_tenant_id: null,
      p_source_route: '/api/vehicles/:vin/evidence/:evidenceId/verify',
      p_request_id: 'req-self',
      p_ip_address: '127.0.0.1',
      p_user_agent: 'test',
      p_previous_value: {},
      p_new_value: {},
      p_provenance_details: {},
      p_expected_sequence: 2,
      p_expected_prev_hash: initProvA.content_hash,
      p_content_hash: 'abc123',
      p_reviewed_at: new Date().toISOString(),
    });
    assert.ok(directSelfReviewRpc.error);
    assert.match(directSelfReviewRpc.error.message, /EVIDENCE_REVIEW_SELF_FORBIDDEN/);

    // -------------------------------------------------------------------------
    // Case 8: Missing Operations capability
    // -------------------------------------------------------------------------
    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Buyer without VEHICLE_EVIDENCE_REVIEW capability',
        actor: {
          id: 'u_unprivileged_buyer',
          role: 'buyer',
          baseRole: 'buyer',
          platformRole: 'buyer',
          authenticationMethod: 'session',
        },
      }),
      (err) => err.code === 'OPERATIONS_CAPABILITY_REQUIRED' && err.status === 403,
    );

    // -------------------------------------------------------------------------
    // Case 1: Failed audit insert rolls back the entire transaction
    // -------------------------------------------------------------------------
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.test_fail_trust_audit_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'SIMULATED_TRUST_AUDIT_INSERT_FAILURE';
      END $$;
      CREATE TRIGGER trg_test_fail_trust_audit_insert
        BEFORE INSERT ON public.trust_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.test_fail_trust_audit_insert();
    `);

    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Should fail on audit insert',
        actor: reviewer1,
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_AUDIT_FAILED' && err.status === 500,
    );

    await pg.exec(`
      DROP TRIGGER trg_test_fail_trust_audit_insert ON public.trust_audit_events;
      DROP FUNCTION public.test_fail_trust_audit_insert();
    `);

    const stateAfterCase1 = await pg.query(
      `SELECT verification_status, verified_by,
              (SELECT count(*)::int FROM public.trust_audit_events WHERE $1 = ANY(evidence_ids)) AS audit_count,
              (SELECT count(*)::int FROM public.evidence_provenance_events WHERE evidence_id = $2::uuid) AS prov_count
         FROM public.vehicle_evidence WHERE id = $2::uuid`,
      [evidenceIdA, evidenceIdA],
    );
    assert.deepEqual(stateAfterCase1.rows[0], {
      verification_status: 'pending',
      verified_by: null,
      audit_count: 0,
      prov_count: 1,
    });

    // -------------------------------------------------------------------------
    // Case 2: Failed evidence status update after audit construction rolls back
    //         the Step 1 `trust_audit_events` insert!
    // -------------------------------------------------------------------------
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.test_fail_vehicle_evidence_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'SIMULATED_VEHICLE_EVIDENCE_UPDATE_FAILURE';
      END $$;
      CREATE TRIGGER trg_test_fail_vehicle_evidence_update
        BEFORE UPDATE ON public.vehicle_evidence
        FOR EACH ROW EXECUTE FUNCTION public.test_fail_vehicle_evidence_update();
    `);

    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Should roll back audit row when evidence update fails',
        actor: reviewer1,
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_WRITE_FAILED' && err.status === 500,
    );

    await pg.exec(`
      DROP TRIGGER trg_test_fail_vehicle_evidence_update ON public.vehicle_evidence;
      DROP FUNCTION public.test_fail_vehicle_evidence_update();
    `);

    const stateAfterCase2 = await pg.query(
      `SELECT verification_status, verified_by,
              (SELECT count(*)::int FROM public.trust_audit_events WHERE $1 = ANY(evidence_ids)) AS audit_count,
              (SELECT count(*)::int FROM public.evidence_provenance_events WHERE evidence_id = $2::uuid) AS prov_count
         FROM public.vehicle_evidence WHERE id = $2::uuid`,
      [evidenceIdA, evidenceIdA],
    );
    assert.deepEqual(
      stateAfterCase2.rows[0],
      {
        verification_status: 'pending',
        verified_by: null,
        audit_count: 0,
        prov_count: 1,
      },
      'Failed vehicle_evidence update MUST roll back the trust_audit_events insert',
    );

    // -------------------------------------------------------------------------
    // Case 3: Failed provenance insertion rolls back BOTH the Step 1
    //         `trust_audit_events` insert AND the Step 2 `vehicle_evidence` update!
    // -------------------------------------------------------------------------
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.test_fail_provenance_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'SIMULATED_PROVENANCE_INSERT_FAILURE';
      END $$;
      CREATE TRIGGER trg_test_fail_provenance_insert
        BEFORE INSERT ON public.evidence_provenance_events
        FOR EACH ROW EXECUTE FUNCTION public.test_fail_provenance_insert();
    `);

    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Should roll back audit AND evidence update when provenance insert fails',
        actor: reviewer1,
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_PROVENANCE_FAILED' && err.status === 500,
    );

    await pg.exec(`
      DROP TRIGGER trg_test_fail_provenance_insert ON public.evidence_provenance_events;
      DROP FUNCTION public.test_fail_provenance_insert();
    `);

    const stateAfterCase3 = await pg.query(
      `SELECT verification_status, verified_by, verified_at, verification_notes,
              (SELECT count(*)::int FROM public.trust_audit_events WHERE $1 = ANY(evidence_ids)) AS audit_count,
              (SELECT count(*)::int FROM public.evidence_provenance_events WHERE evidence_id = $2::uuid) AS prov_count
         FROM public.vehicle_evidence WHERE id = $2::uuid`,
      [evidenceIdA, evidenceIdA],
    );
    assert.deepEqual(
      stateAfterCase3.rows[0],
      {
        verification_status: 'pending',
        verified_by: null,
        verified_at: null,
        verification_notes: null,
        audit_count: 0,
        prov_count: 1,
      },
      'Failed provenance append MUST roll back both the audit insert and the approved evidence status',
    );

    // -------------------------------------------------------------------------
    // Case 4: Simultaneous conflicting reviewer decisions (`verified` vs `rejected`)
    //         on Evidence A: exactly one wins, the other fails with 409 EVIDENCE_REVIEW_CONFLICT
    // -------------------------------------------------------------------------
    const [outcome1, outcome2] = await Promise.allSettled([
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Independent verification by Reviewer 1',
        confidenceImpact: 2,
        requestedTrustImpact: 3,
        actor: reviewer1,
      }),
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'rejected',
        notes: 'Conflicting concurrent rejection by Reviewer 2',
        requestedTrustImpact: -5,
        actor: reviewer2,
      }),
    ]);

    const fulfilled = [outcome1, outcome2].filter((o) => o.status === 'fulfilled');
    const rejected = [outcome1, outcome2].filter((o) => o.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Exactly one concurrent conflicting review may succeed');
    assert.equal(rejected.length, 1, 'The second conflicting review must fail');
    assert.equal(rejected[0].reason.code, 'EVIDENCE_REVIEW_CONFLICT');
    assert.equal(rejected[0].reason.status, 409);

    const winnerResult = fulfilled[0].value;
    assert.equal(winnerResult.evidence.verification_status, 'verified');
    assert.equal(winnerResult.evidence.verified_by, 'u_ops_reviewer_1');
    assert.equal(winnerResult.evidence.trust_score_impact, 3);
    assert.equal(winnerResult.idempotentReplay, false);

    // -------------------------------------------------------------------------
    // Case 5: Duplicate and replayed review requests (idempotent replay vs conflict)
    // -------------------------------------------------------------------------
    const replaySame = await reviewEvidenceRecord(pgClient, {
      vin: testVin,
      evidenceId: evidenceIdA,
      decision: 'verified',
      notes: 'Independent verification by Reviewer 1',
      confidenceImpact: 2,
      requestedTrustImpact: 3,
      actor: reviewer1,
    });
    assert.equal(replaySame.idempotentReplay, true);
    assert.equal(replaySame.auditEventId, winnerResult.auditEventId);
    assert.equal(replaySame.provenanceEventId, winnerResult.provenanceEventId);

    // Conflicting replay: same reviewer attempting to change notes or decision on already-verified row
    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'verified',
        notes: 'Attempt to silently overwrite review notes after approval',
        confidenceImpact: 2,
        requestedTrustImpact: 3,
        actor: reviewer1,
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_CONFLICT' && err.status === 409,
    );

    await assert.rejects(
      reviewEvidenceRecord(pgClient, {
        vin: testVin,
        evidenceId: evidenceIdA,
        decision: 'rejected',
        notes: 'Attempt to flip verified evidence to rejected',
        requestedTrustImpact: -5,
        actor: reviewer1,
      }),
      (err) => err.code === 'EVIDENCE_REVIEW_CONFLICT' && err.status === 409,
    );

    const countsForA = await pg.query(
      `SELECT
         (SELECT count(*)::int FROM public.trust_audit_events WHERE $1 = ANY(evidence_ids)) AS audit_count,
         (SELECT count(*)::int FROM public.evidence_provenance_events WHERE evidence_id = $2::uuid) AS prov_count`,
      [evidenceIdA, evidenceIdA],
    );
    assert.deepEqual(countsForA.rows[0], { audit_count: 1, prov_count: 2 });

    // -------------------------------------------------------------------------
    // Case 9: Successful `rejected` transition on Evidence B (and `verified` on Evidence A)
    // -------------------------------------------------------------------------
    const rejectResultB = await reviewEvidenceRecord(pgClient, {
      vin: testVin,
      evidenceId: evidenceIdB,
      decision: 'rejected',
      notes: 'Chassis plate obscured in secondary photo',
      requestedTrustImpact: -5,
      actor: reviewer2,
    });
    assert.equal(rejectResultB.evidence.verification_status, 'rejected');
    assert.equal(rejectResultB.evidence.verified_by, 'u_ops_reviewer_2');
    assert.equal(rejectResultB.evidence.trust_score_impact, -5);
    assert.equal(rejectResultB.idempotentReplay, false);

    // -------------------------------------------------------------------------
    // Case 10: Audit and hash-chained provenance (`verifyProvenanceChain`) consistency
    // -------------------------------------------------------------------------
    const chainCheckA = await verifyProvenanceChain(pgClient, evidenceIdA);
    assert.deepEqual(chainCheckA, {
      valid: true,
      length: 2,
      brokenAt: null,
      reason: null,
    });

    const chainCheckB = await verifyProvenanceChain(pgClient, evidenceIdB);
    assert.deepEqual(chainCheckB, {
      valid: true,
      length: 2,
      brokenAt: null,
      reason: null,
    });

    const auditRows = await pg.query(
      `SELECT event_type, vin, trust_fact, actor_user_id, actor_role, previous_value, new_value, evidence_ids, decision_notes
         FROM public.trust_audit_events
        WHERE vin = $1
        ORDER BY created_at ASC`,
      [testVin],
    );
    assert.equal(auditRows.rows.length, 2);

    const auditA = auditRows.rows[0];
    assert.deepEqual(auditA.evidence_ids, [evidenceIdA]);
    assert.equal(auditA.actor_user_id, 'u_ops_reviewer_1');
    assert.equal(auditA.event_type, 'EVIDENCE_VERIFIED');
    assert.equal(auditA.trust_fact, 'evidence_verification');
    assert.equal(auditA.previous_value.verification_status, 'pending');
    assert.equal(auditA.new_value.verification_status, 'verified');

    const auditB = auditRows.rows[1];
    assert.deepEqual(auditB.evidence_ids, [evidenceIdB]);
    assert.equal(auditB.actor_user_id, 'u_ops_reviewer_2');
    assert.equal(auditB.event_type, 'EVIDENCE_REJECTED');
    assert.equal(auditB.previous_value.verification_status, 'pending');
    assert.equal(auditB.new_value.verification_status, 'rejected');
  } finally {
    await pg.close();
  }
});
