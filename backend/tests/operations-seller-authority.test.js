/**
 * Operations Control Plane M2 — governed Seller Authority tests.
 *
 * The two questions CarUp must keep separate:
 *   1. Does this Seller have sufficient reviewed authority to offer this
 *      vehicle on CarUp?               ← THIS service
 *   2. Has Zimbabwe local registration been completed?  ← registration lifecycle
 *
 * Pinned rules: existing relationships stay recognized; the permanent-import
 * purchase-chain can support authority WITHOUT any registration evidence; a
 * commercial invoice alone is insufficient; no self-approval; a conflicting
 * canonical seller blocks confirmation; revocation fails closed even for a
 * relationship holder; decisions are audited fail-closed; vehicles.owner_id /
 * current_seller_id are never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const svc = await import('../services/seller/sellerAuthorityService.js');

const VIN = 'GFC27-027051';
const SELLER = 'u_seller';
const OTHER = 'u_other';
const REVIEWER = { id: 'u_reviewer', role: 'admin', tenantId: null };

function makeMockClient({ vehicles = [], evidence = [], authority = [], failAuditInsert = false } = {}) {
  const tables = {
    vehicles: vehicles.map((v) => ({ ...v })),
    vehicle_evidence: evidence.map((e) => ({ ...e })),
    vehicle_seller_authority: authority.map((a) => ({ ...a })),
    trust_audit_events: [],
    organization_users: [],
  };
  const writes = { vehicles: 0 };
  function builder(name) {
    const state = { op: 'select', filters: [], payload: null, single: false, maybe: false };
    const rowsFor = () => (tables[name] || []).filter((r) => state.filters.every(([k, v]) => r[k] === v));
    const finish = () => {
      if (state.op === 'insert') {
        if (name === 'trust_audit_events' && failAuditInsert) {
          return { data: null, error: { message: 'audit insert refused (test)' } };
        }
        const payloads = (Array.isArray(state.payload) ? state.payload : [state.payload])
          .map((p, i) => ({ id: `${name}-${(tables[name] || []).length + i + 1}`, ...p }));
        tables[name] = [...(tables[name] || []), ...payloads];
        return { data: state.single ? payloads[0] : payloads, error: null };
      }
      if (state.op === 'update') {
        if (name === 'vehicles') writes.vehicles += 1;
        const matched = rowsFor();
        matched.forEach((r) => Object.assign(r, state.payload));
        return { data: state.single ? (matched[0] ?? null) : matched, error: state.single && !matched[0] ? { message: 'no row' } : null };
      }
      const matched = rowsFor();
      if (state.single || state.maybe) {
        return { data: matched[0] ?? null, error: (state.single && !state.maybe && !matched[0]) ? { message: 'no row' } : null };
      }
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
  return { from: builder, _tables: tables, _writes: writes };
}

const baseVehicle = { vin: VIN, owner_id: SELLER, current_seller_id: SELLER, tenant_id: null };

function importDoc(id, subtype, uploadedBy = SELLER, status = 'verified') {
  return {
    id, vin: VIN, uploaded_by: uploadedBy, verification_status: status,
    evidence_type: 'registration_document', // the Serena mislabel, deliberately
    evidence_class: 'import', evidence_subtype: subtype,
  };
}

// ---------------------------------------------------------------------------
// Recognition + claims
// ---------------------------------------------------------------------------

test('an existing relationship is recognized without any authority row', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle] });
  const result = await svc.submitSellerClaim(client, {
    vin: VIN, claimType: 'owner', userContext: { id: SELLER, role: 'owner', tenantId: null },
  });
  assert.equal(result.status, 'recognized');
  assert.equal(result.recognition_basis, 'existing_relationship');
  assert.equal(client._tables.vehicle_seller_authority.length, 0);
});

test('an unrelated claimant gets an idempotent evidence_required claim with ONE audit event', async () => {
  const client = makeMockClient({ vehicles: [{ ...baseVehicle, owner_id: OTHER, current_seller_id: OTHER }] });
  const ctx = { id: SELLER, role: 'owner', tenantId: null };
  const first = await svc.submitSellerClaim(client, { vin: VIN, claimType: 'authorised_seller', userContext: ctx });
  const second = await svc.submitSellerClaim(client, { vin: VIN, claimType: 'authorised_seller', userContext: ctx });
  assert.equal(first.status, 'evidence_required');
  assert.equal(second.status, 'evidence_required');
  assert.equal(client._tables.vehicle_seller_authority.length, 1);
  const claimEvents = client._tables.trust_audit_events.filter((e) => e.event_type === svc.SELLER_AUTHORITY_CLAIM_EVENT);
  assert.equal(claimEvents.length, 1);
});

test('canonical semantics gate the evidence shortcut: a mislabeled import doc grants nothing', async () => {
  const client = makeMockClient({
    vehicles: [{ ...baseVehicle, owner_id: OTHER, current_seller_id: OTHER }],
    evidence: [importDoc('ev-1', 'commercial_invoice')],
  });
  assert.equal(await svc.hasVerifiedOwnershipAuthorityEvidence(client, VIN, SELLER), false);
  // A legacy-only historical registration document still qualifies…
  const legacyClient = makeMockClient({
    evidence: [{ id: 'ev-2', vin: VIN, uploaded_by: SELLER, verification_status: 'verified', evidence_type: 'registration_document', evidence_class: null, evidence_subtype: null }],
  });
  assert.equal(await svc.hasVerifiedOwnershipAuthorityEvidence(legacyClient, VIN, SELLER), true);
  // …and so does a canonical registration book.
  const canonicalClient = makeMockClient({
    evidence: [{ id: 'ev-3', vin: VIN, uploaded_by: SELLER, verification_status: 'verified', evidence_type: 'vehicle_life_document', evidence_class: 'registration', evidence_subtype: 'registration_book' }],
  });
  assert.equal(await svc.hasVerifiedOwnershipAuthorityEvidence(canonicalClient, VIN, SELLER), true);
});

// ---------------------------------------------------------------------------
// Reviewer decisions
// ---------------------------------------------------------------------------

test('the permanent-import purchase chain supports confirmation WITHOUT registration evidence', async () => {
  const client = makeMockClient({
    vehicles: [baseVehicle],
    evidence: [importDoc('ev-1', 'commercial_invoice'), importDoc('ev-2', 'bill_of_lading')],
  });
  const result = await svc.reviewSellerAuthority(client, {
    vin: VIN, sellerUserId: SELLER, decision: 'confirmed',
    reason: 'Import purchase chain reviewed under seller_authority.v1',
    actor: REVIEWER,
  });
  assert.equal(result.changed, true);
  assert.equal(result.record.status, 'confirmed');
  // Relationship holder → basis stays existing_relationship (evidence strengthens it).
  assert.equal(result.record.basis, 'existing_relationship');
  assert.equal(client._writes.vehicles, 0, 'vehicles relationship columns are never mutated');
});

test('a non-relationship seller needs a policy basis; two distinct import documents satisfy it', async () => {
  const client = makeMockClient({
    vehicles: [{ ...baseVehicle, owner_id: null, current_seller_id: null }],
    evidence: [importDoc('ev-1', 'commercial_invoice'), importDoc('ev-2', 'payment_receipt')],
  });
  const result = await svc.reviewSellerAuthority(client, {
    vin: VIN, sellerUserId: SELLER, decision: 'confirmed',
    reason: 'Invoice + payment receipt verified', actor: REVIEWER,
  });
  assert.equal(result.record.basis, 'reviewed_permanent_import_evidence_set');
  assert.deepEqual(result.record.evidence_ids.sort(), ['ev-1', 'ev-2']);
});

test('a commercial invoice alone is insufficient for confirmation', async () => {
  const client = makeMockClient({
    vehicles: [{ ...baseVehicle, owner_id: null, current_seller_id: null }],
    evidence: [importDoc('ev-1', 'commercial_invoice')],
  });
  await assert.rejects(
    svc.reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: SELLER, decision: 'confirmed', reason: 'try', actor: REVIEWER,
    }),
    (err) => err.code === 'SELLER_AUTHORITY_BASIS_INSUFFICIENT'
  );
});

test('a seller cannot review their own authority (admin included)', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle] });
  await assert.rejects(
    svc.reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: SELLER, decision: 'confirmed', reason: 'self',
      actor: { id: SELLER, role: 'admin' },
    }),
    (err) => err.code === 'SELLER_AUTHORITY_SELF_REVIEW'
  );
});

test('a conflicting canonical seller blocks confirmation with 409', async () => {
  const client = makeMockClient({
    vehicles: [{ ...baseVehicle, owner_id: OTHER, current_seller_id: OTHER }],
    evidence: [importDoc('ev-1', 'commercial_invoice'), importDoc('ev-2', 'bill_of_lading')],
  });
  await assert.rejects(
    svc.reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: SELLER, decision: 'confirmed', reason: 'conflict attempt', actor: REVIEWER,
    }),
    (err) => err.code === 'SELLER_AUTHORITY_CONFLICT' && err.status === 409
  );
  // The relationship was not overwritten and no confirmed row appeared.
  const vehicle = client._tables.vehicles[0];
  assert.equal(vehicle.owner_id, OTHER);
  assert.equal(client._tables.vehicle_seller_authority.length, 0);
});

test('a decision without a reason is refused', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle] });
  await assert.rejects(
    svc.reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: SELLER, decision: 'revoked', reason: '  ', actor: REVIEWER,
    }),
    (err) => err.code === 'SELLER_AUTHORITY_REASON_REQUIRED'
  );
});

test('decisions are audited fail-closed: no audit, no state change', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle], failAuditInsert: true });
  await assert.rejects(
    svc.reviewSellerAuthority(client, {
      vin: VIN, sellerUserId: SELLER, decision: 'confirmed', reason: 'x', actor: REVIEWER,
    }),
    (err) => err.code === 'SELLER_AUTHORITY_AUDIT_FAILED'
  );
  assert.equal(client._tables.vehicle_seller_authority.length, 0);
});

test('revocation fails closed even for a relationship holder, and supersession is recorded', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle] });
  await svc.reviewSellerAuthority(client, {
    vin: VIN, sellerUserId: SELLER, decision: 'confirmed', reason: 'ok', actor: REVIEWER,
  });
  const revocation = await svc.reviewSellerAuthority(client, {
    vin: VIN, sellerUserId: SELLER, decision: 'revoked', reason: 'authority withdrawn', actor: REVIEWER,
  });
  assert.equal(revocation.previous_status, 'confirmed');

  const state = await svc.getSellerAuthorityState(client, { vin: VIN, sellerUserId: SELLER });
  assert.equal(state.status, 'revoked');
  assert.equal(state.existing_relationship, true);
  assert.equal(svc.isSellerAuthoritySatisfied(state), false, 'an explicit revocation overrides relationship recognition');

  const reviewEvents = client._tables.trust_audit_events.filter((e) => e.event_type === svc.SELLER_AUTHORITY_REVIEW_EVENT);
  assert.equal(reviewEvents.length, 2, 'every decision lands in the audit ledger');
});

// ---------------------------------------------------------------------------
// State + separation from registration
// ---------------------------------------------------------------------------

test('state precedence: decision row > relationship > not_assessed', async () => {
  const client = makeMockClient({ vehicles: [baseVehicle] });
  const recognized = await svc.getSellerAuthorityState(client, { vin: VIN, sellerUserId: SELLER });
  assert.equal(recognized.status, 'recognized');
  assert.equal(svc.isSellerAuthoritySatisfied(recognized), true);

  const stranger = await svc.getSellerAuthorityState(client, { vin: VIN, sellerUserId: OTHER });
  assert.equal(stranger.status, 'not_assessed');
  assert.equal(svc.isSellerAuthoritySatisfied(stranger), false);
});

test('seller authority never asserts registration facts: public wording is bounded', () => {
  for (const status of ['confirmed', 'recognized', 'under_review', 'revoked', 'disputed', 'insufficient', 'not_assessed']) {
    const statement = svc.toPublicSellerAuthorityStatement({ status });
    assert.doesNotMatch(statement, /title|CVR|ZIMRA|registration|plate/i, `'${status}' wording must not claim registration/title facts`);
  }
  assert.equal(svc.toPublicSellerAuthorityStatement({ status: 'confirmed' }), 'Seller authority reviewed by CarUp');
});

test('cross-tenant scope: a dealer from another tenant has no recognition', async () => {
  const client = makeMockClient({ vehicles: [{ ...baseVehicle, owner_id: null, current_seller_id: null, tenant_id: 'tenant-A' }] });
  const state = await svc.getSellerAuthorityState(client, { vin: VIN, sellerUserId: 'u_dealer', sellerTenantId: 'tenant-B' });
  assert.equal(state.status, 'not_assessed');
  const sameTenant = await svc.getSellerAuthorityState(client, { vin: VIN, sellerUserId: 'u_dealer', sellerTenantId: 'tenant-A' });
  assert.equal(sameTenant.status, 'recognized');
});
