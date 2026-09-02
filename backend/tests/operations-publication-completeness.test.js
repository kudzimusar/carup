/**
 * Operations Control Plane M3 — publication completeness reconciliation tests.
 *
 * The gate must ask the right questions (manual §19): vehicle identity, governed
 * Seller Authority, truthful Zimbabwe registration stage, stage-dependent
 * registration evidence, document reconciliation, and risk — and no path may let
 * a Serena import document satisfy a Zimbabwe registration requirement through
 * its legacy compatibility field.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');

const VIN = 'GFC27-027051';
const SELLER = 'u_seller';

function vehicle(overrides = {}) {
  return {
    vin: VIN,
    chassis_number: 'GFC27-027051',
    engine_number: 'MR20961177B',
    plate_number: null,
    temp_plate_id: null,
    trust_score: null,
    publication_status: 'draft',
    make: 'Nissan', model: 'Serena Highway Star', year: 2016,
    normalized_plate_number: null,
    owner_id: SELLER,
    current_seller_id: SELLER,
    tenant_id: null,
    registration_status: 'customs_cleared_cvr_pending',
    registration_status_source: 'seller_stated',
    ...overrides,
  };
}

/** The exact Serena evidence shape: canonical import docs under wrong legacy types. */
function serenaImportDocs(status = 'pending') {
  return [
    { id: 'ev-bl', evidence_type: 'ownership_transfer_document', evidence_class: 'import', evidence_subtype: 'bill_of_lading', verification_status: status, uploaded_by: SELLER },
    { id: 'ev-inv', evidence_type: 'registration_document', evidence_class: 'import', evidence_subtype: 'commercial_invoice', verification_status: status, uploaded_by: SELLER },
    { id: 'ev-t1', evidence_type: 'registration_document', evidence_class: 'import', evidence_subtype: 'transit_declaration', verification_status: status, uploaded_by: SELLER },
    { id: 'ev-rw', evidence_type: 'registration_document', evidence_class: 'inspection', evidence_subtype: 'roadworthiness', verification_status: status, uploaded_by: SELLER },
  ];
}

function clientWith({ veh = vehicle(), evidence = [], extractions = [], authority = null, fraud = [] } = {}) {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        single: async () => (table === 'vehicles'
          ? { data: veh, error: veh ? null : { message: 'not found' } }
          : { data: null, error: null }),
        maybeSingle: async () => {
          if (table === 'vehicle_seller_authority') return { data: authority, error: null };
          if (table === 'vehicles') return { data: veh, error: null };
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === 'vehicle_evidence') return resolve({ data: evidence, error: null });
          if (table === 'vehicle_document_extractions') return resolve({ data: extractions, error: null });
          if (table === 'fraud_cases') return resolve({ data: fraud, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

const req = (result, key) => result.requirements.find((r) => r.key === key);

// ---------------------------------------------------------------------------

test('Serena-like permanent import: authority CONFIRMED + pending registration → publishable', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: {
        vin: VIN, seller_user_id: SELLER, status: 'confirmed',
        basis: 'existing_relationship', evidence_ids: ['ev-inv', 'ev-bl'],
        claim_type: 'owner', policy_version: 'seller_authority.v1',
        decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z',
      },
    }),
  });
  assert.equal(req(result, 'seller_authority').status, 'verified');
  assert.equal(req(result, 'registration_readiness').blocking, false, 'a sourced pending permanent-import stage does not block');
  assert.equal(req(result, 'registration_evidence'), undefined, 'a pending import is never asked for a registration book');
  assert.equal(result.is_publishable, true);
});

test('the same vehicle with an UNRECORDED registration stage blocks correctly', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: null, registration_status_source: null }),
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  const registration = req(result, 'registration_readiness');
  assert.equal(registration.blocking, true);
  assert.ok(registration.reason_codes.includes('registration_stage_not_recorded'));
  assert.equal(result.is_publishable, false);
});

test('a TIP stage remains a special reviewed state and blocks ordinary listing', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: 'temporary_foreign_tip' }),
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  assert.equal(req(result, 'registration_readiness').blocking, true);
  assert.equal(result.is_publishable, false);
});

test('VERIFIED import documents alone never auto-satisfy seller authority (review decides)', async () => {
  // Without a governed confirmation, verified import purchase-chain docs keep
  // the requirement at pending_review — the reviewer decision IS the gate.
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({ evidence: serenaImportDocs('verified') }),
  });
  const authority = req(result, 'seller_authority');
  assert.equal(authority.status, 'pending_review');
  assert.equal(authority.who_must_act, 'carup_review');
  assert.equal(result.is_publishable, false);
});

test('a mislabeled import document cannot satisfy a registration requirement', async () => {
  // locally_registered DEMANDS registration evidence; the Serena docs carry
  // legacy 'registration_document' but are canonically import/inspection —
  // they must not count.
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: 'locally_registered', plate_number: 'ABZ1234' }),
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  const regEvidence = req(result, 'registration_evidence');
  assert.ok(regEvidence, 'locally_registered adds the registration evidence requirement');
  assert.equal(regEvidence.status, 'missing');
  assert.equal(result.is_publishable, false);
});

test('a true registration book satisfies the locally_registered evidence requirement', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: 'locally_registered', plate_number: 'ABZ1234' }),
      evidence: [
        ...serenaImportDocs('verified'),
        { id: 'ev-book', evidence_type: 'registration_document', evidence_class: 'registration', evidence_subtype: 'registration_book', verification_status: 'verified', uploaded_by: SELLER },
      ],
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  assert.equal(req(result, 'registration_evidence').status, 'verified');
  assert.equal(result.is_publishable, true);
});

test('locally_registered without a plate stays incomplete through the lifecycle', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: 'locally_registered', plate_number: null }),
      evidence: [{ id: 'ev-book', evidence_type: 'registration_document', evidence_class: 'registration', evidence_subtype: 'registration_book', verification_status: 'verified', uploaded_by: SELLER }],
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  const readiness = req(result, 'registration_readiness');
  assert.equal(readiness.blocking, true);
  assert.ok(readiness.reason_codes.includes('local_plate_not_recorded'));
  assert.equal(result.is_publishable, false);
});

test('an unresolved material extraction conflict blocks with the conflict category', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
      extractions: [{
        id: 'ext-1', evidence_id: 'ev-inv', document_type: 'commercial_invoice',
        field_name: 'year', raw_value: '2015', normalized_value: '2015',
        expected_value: '2016', compared_vehicle_field: 'year',
        match_status: 'mismatch', review_status: 'pending', created_at: '2026-09-02T00:00:00Z',
      }],
    }),
  });
  const reconciliation = req(result, 'fact_reconciliation');
  assert.equal(reconciliation.status, 'pending_review');
  assert.equal(reconciliation.refusal_category, 'conflict');
  assert.equal(result.is_publishable, false);
});

test('an open publication-blocking fraud case blocks; a resolved one does not', async () => {
  const blocked = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
      fraud: [{ id: 'fc-1', status: 'open', blocks_publication: true }],
    }),
  });
  assert.equal(req(blocked, 'risk_governance').status, 'pending_review');
  assert.equal(req(blocked, 'risk_governance').refusal_category, 'policy_blocked');
  assert.equal(blocked.is_publishable, false);

  const cleared = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
      fraud: [{ id: 'fc-1', status: 'resolved', blocks_publication: true }, { id: 'fc-2', status: 'open', blocks_publication: false }],
    }),
  });
  assert.equal(req(cleared, 'risk_governance').status, 'present');
  assert.equal(cleared.is_publishable, true);
});

test('a REVOKED authority decision fails closed even for the relationship holder', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'revoked', basis: null, evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  const authority = req(result, 'seller_authority');
  assert.equal(authority.status, 'missing');
  assert.equal(authority.refusal_category, 'policy_blocked');
  assert.equal(result.is_publishable, false);
});

test('finance disclosure remains advisory and cannot move publishability', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      evidence: serenaImportDocs('verified'),
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  const finance = req(result, 'finance_obligation_disclosure');
  assert.equal(finance.blocking, false);
  assert.equal(result.is_publishable, true, 'a not_available finance read must not block');
});

test('restricted evidence satisfies internal requirements without any public artifact', async () => {
  // Visibility never enters the completeness computation: a private registration
  // book satisfies registration_evidence exactly like a public one would.
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: 'locally_registered', plate_number: 'ABZ1234' }),
      evidence: [{ id: 'ev-book', evidence_type: 'registration_document', evidence_class: 'registration', evidence_subtype: 'registration_book', verification_status: 'verified', uploaded_by: SELLER, visibility_level: 'private' }],
      authority: { vin: VIN, seller_user_id: SELLER, status: 'confirmed', basis: 'existing_relationship', evidence_ids: [], claim_type: 'owner', policy_version: 'seller_authority.v1', decided_by: 'u_reviewer', decided_at: '2026-09-03T00:00:00Z' },
    }),
  });
  assert.equal(req(result, 'registration_evidence').status, 'verified');
  assert.equal(result.is_publishable, true);
});

test("Serena's CURRENT recorded state evaluates truthfully (draft, stage unrecorded, docs pending)", async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({
      veh: vehicle({ registration_status: null, registration_status_source: null }),
      evidence: serenaImportDocs('pending'),
    }),
  });
  assert.equal(result.is_publishable, false);
  const readiness = req(result, 'registration_readiness');
  assert.equal(readiness.blocking, true, 'the unrecorded stage blocks publication');
  assert.ok(readiness.reason_codes.includes('registration_stage_not_recorded'));
  assert.ok(result.pending_gaps.some((g) => g.key === 'registration_readiness'), 'the unrecorded stage travels as a gap the refusal names');
  assert.ok(result.pending_gaps.some((g) => g.key === 'seller_authority'), 'the authority review is pending, not missing');
  // The refusal distinguishes who must act.
  assert.equal(req(result, 'registration_readiness').who_must_act, 'seller');
  assert.equal(req(result, 'seller_authority').who_must_act, 'carup_review');
});

test('the advisory inspection requirement recognizes the canonical roadworthiness certificate', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({ evidence: serenaImportDocs('verified') }),
  });
  // Serena's CBCA/Cotecna is inspection/roadworthiness under a wrong legacy
  // type; the canonical matcher still finds it.
  assert.equal(req(result, 'inspection_photo').status, 'verified');
});
