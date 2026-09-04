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

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const taxonomy = await import('../services/evidence/evidenceTaxonomy.js');
const evidenceService = await import('../services/evidence/evidenceService.js');
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
// Governed classification correction (M1.13)
// ---------------------------------------------------------------------------

function makeMockClient({ failAuditInsert = false } = {}) {
  const tables = {
    vehicle_evidence: [{
      id: 'ev-1', vin: 'GFC27-027051',
      evidence_type: 'registration_document',
      evidence_class: 'registration', evidence_subtype: 'registration_book',
      uploaded_by: 'u_seller',
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
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        tables[name] = [...(tables[name] || []), ...payloads];
        return { data: payloads, error: null };
      }
      if (state.op === 'update') {
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
  return { from: builder, _tables: tables };
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
// The upload route defaulted document artifacts to 'restricted', but the default was decorative:
// `req.body.visibility_level || <default>` let the request body win outright, and the web uploader
// initialised that field to 'public_safe' for every artifact. The real Serena's Tanzania T1 is
// published in staging through exactly that path — a provenance chain whose only event is the
// owner's own upload, with no reviewer decision anywhere in it. §3.11/G7 forbid a seller
// self-certifying publication, and the manual's §13 table lists the T1 as Restricted.
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
  // Withholding more is never a privacy risk, so it needs no capability.
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
  // The precise defect shape: the body ORed directly against a default.
  assert.doesNotMatch(
    routes,
    /visibility_level\s*\|\|\s*req\.body\.visibilityLevel\s*\|\|\s*\(/,
    'visibility must not be taken from the request body with a mere fallback default',
  );
  assert.match(routes, /resolveEvidenceVisibility\(\{/, 'the route must use the governed resolver');
  assert.match(routes, /visibility_request_refused/, 'a clamped request must be recorded on the row');
});

test('a governed correction can withdraw a document the uploader was never entitled to publish', async () => {
  // Until now there was NO post-upload writer for visibility_level anywhere in the backend, so a
  // document published by seller self-certification could only be withdrawn by a service-role SQL
  // write — no actor, no reason, no audit. That is the state the real Serena's Tanzania T1 is in.
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

  // The withdrawal is attributable on the same terms as any other governed correction.
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
