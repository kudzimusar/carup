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

test('a restated registration stage carries its provenance on the Seller reuse path (source contract)', async () => {
  // A stage WITHOUT a source evaluates as not_recorded and blocks publication,
  // so the reuse-update must write registration_status_source alongside the
  // restated registration_status — dropping the source left a Seller's own
  // truthful restatement permanently blocking.
  const { readFileSync } = await import('node:fs');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(
    server,
    /registration_status: submittedRegistrationStatus, registration_status_source: claimSource/,
    'the reuse-update spread must stamp the stage source with the stage'
  );
});

test('the advisory inspection requirement recognizes the canonical roadworthiness certificate', async () => {
  const result = await evaluateCompleteness(VIN, {
    client: clientWith({ evidence: serenaImportDocs('verified') }),
  });
  // Serena's CBCA/Cotecna is inspection/roadworthiness under a wrong legacy
  // type; the canonical matcher still finds it.
  assert.equal(req(result, 'inspection_photo').status, 'verified');
});

// ---------------------------------------------------------------------------
// Public registration disclosure (closure hardening)
// ---------------------------------------------------------------------------

test('a seller-stated pending registration stage is DISCLOSED to buyers with its provenance', async () => {
  // The Serena's whole point: a permanent import may be listed while local
  // registration is pending, PROVIDED the pending stage is truthfully disclosed.
  // `toRegistrationClaim` always read registration_status, but the marketplace
  // select did not fetch it, so buyers were shown `not_recorded` for a stage the
  // row genuinely held. Both halves are pinned here: the column is selected, and
  // the claim block publishes the value with its seller provenance.
  const listing = await import('../services/marketplace/listingSummaryService.js');
  const projection = await import('../utils/publicVehicleProjection.js');

  const narrow = listing.LISTING_SELECT_COLUMNS.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  assert.ok(narrow.includes('registration_status'), 'the listing select must fetch registration_status');
  assert.ok(narrow.includes('registration_authority'), 'the listing select must fetch registration_authority');

  const claim = projection.toRegistrationClaim({
    registration_status: 'arrived_customs_pending',
    registration_status_source: 'seller_declared',
  });
  assert.equal(claim.status.state, 'recorded');
  assert.equal(claim.status.value, 'arrived_customs_pending');
  assert.equal(claim.status.source, 'seller_declared', 'the stage publishes as a SELLER statement');

  // And a stage with no provenance still publishes nothing (no unattributed claim).
  const unsourced = projection.toRegistrationClaim({ registration_status: 'locally_registered' });
  assert.equal(unsourced.status.state, 'not_recorded');
  assert.equal(unsourced.status.value, null);
});

test('a stated registration stage re-materializes canonical Trust (stale-limitation closure)', async () => {
  // The canonical Trust engine publishes "Zimbabwe registration stage has not been established
  // from a recorded claim" to BUYERS as a known limitation. The Serena's real run left that
  // sentence public and false: trust was refreshed by evidence verification at 19:17:26, the
  // seller stated the stage at ~19:18, and nothing re-evaluated. The seller save path must
  // refresh the canonical position when it records a stage, best-effort, never failing the save.
  const { readFileSync } = await import('node:fs');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const guarded = /if \(submittedRegistrationStatus !== null\) \{\s*try \{\s*await refreshCanonicalTrust\(vin\);/;
  assert.match(server, guarded, 'a recorded registration stage must refresh canonical Trust');
  const refreshBlock = server.slice(server.search(guarded), server.search(guarded) + 600);
  assert.match(refreshBlock, /catch/, 'the refresh must be best-effort and never fail the save');
});
