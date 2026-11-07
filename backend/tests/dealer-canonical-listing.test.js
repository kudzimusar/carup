// CARUP-DEALER-ONB-001-LR01-R4 P0-2: dealer stock → canonical listing candidate, canonical readiness,
// storefront association. Fictional values only; injected collaborators, plus one wiring check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDealerListingPreparation,
  mapListingSqlError,
  prepareMyDealerListing,
  projectCanonicalReadiness,
  getMyDealerListingReadiness,
  getPublicDealerStorefrontInventory,
} from '../services/dealer/dealerCanonicalListingService.js';

const VIN = 'SYNTHR4P02DLR0001';
const BRANCH = '11111111-2222-4333-8444-555555555555';
const TENANT = '99999999-8888-4777-8666-555555555555';
const owner = { actor_id: 'fictional-owner', tenant_id: TENANT };
const actor = { userId: 'fictional-owner' };
const valid = {
  branch_id: BRANCH, price: 18500, currency: 'usd', chassis_number: 'fict-chassis-1',
  engine_number: 'FICT-ENGINE-1', registration_status: 'customs_cleared_cvr_pending',
  listing_city: 'Harare', listing_province: 'Harare Metropolitan', location_visibility: 'public',
  public_seller_display: true,
};

test('preparation parse is an explicit allow-list: forged authority fields are never forwarded', () => {
  const clean = parseDealerListingPreparation({ ...valid, publication_status: 'published', owner_id: 'x',
    trust_score: 99, verified: true, current_seller_id: 'attacker' });
  assert.deepEqual(Object.keys(clean).sort(), ['branch_id', 'chassis_number', 'currency', 'engine_number',
    'listing_city', 'listing_province', 'location_visibility', 'plate_number', 'price',
    'public_seller_display', 'registration_status'].sort());
  assert.equal(clean.currency, 'USD');
  assert.equal(clean.chassis_number, 'FICT-CHASSIS-1');
  assert.equal(clean.plate_number, null);
});

test('preparation refuses missing or invented facts instead of substituting them', () => {
  const bad = [
    [{ ...valid, branch_id: 'not-a-uuid' }, 'LISTING_BRANCH_REQUIRED'],
    [{ ...valid, price: 0 }, 'DEALER_DECLARED_PRICE_REQUIRED'],
    [{ ...valid, price: '18500' }, 'DEALER_DECLARED_PRICE_REQUIRED'],
    [{ ...valid, currency: 'dollars' }, 'DEALER_DECLARED_CURRENCY_REQUIRED'],
    [{ ...valid, engine_number: '' }, 'DEALER_DECLARED_IDENTITY_NUMBERS_REQUIRED'],
    [{ ...valid, registration_status: 'registered_somewhere' }, 'DEALER_DECLARED_REGISTRATION_STAGE_REQUIRED'],
    [{ ...valid, plate_number: '<script>' }, 'INVALID_DECLARED_PLATE'],
    [{ ...valid, listing_city: '' }, 'DEALER_DECLARED_LISTING_CITY_REQUIRED'],
    [{ ...valid, location_visibility: 'everywhere' }, 'DEALER_LISTING_LOCATION_VISIBILITY_REQUIRED'],
  ];
  for (const [payload, code] of bad) {
    assert.throws(() => parseDealerListingPreparation(payload), (e) => e.message === code && e.statusCode === 400, code);
  }
});

test('SQL refusals map to precise HTTP classes; unknown database failure is a 503, never a success', () => {
  assert.equal(mapListingSqlError({ message: 'ERROR: DEALER_LISTING_AUTHORITY_NOT_CURRENT' }).statusCode, 403);
  assert.equal(mapListingSqlError({ message: 'TENANT_VEHICLE_NOT_FOUND' }).statusCode, 404);
  assert.equal(mapListingSqlError({ message: 'CURRENCY_ALREADY_STATED' }).statusCode, 409);
  assert.equal(mapListingSqlError({ message: 'BRANCH_NOT_OWNED_BY_APPROVED_DEALER' }).statusCode, 403);
  const unknown = mapListingSqlError({ message: 'connection reset' });
  assert.equal(unknown.statusCode, 503);
  assert.equal(unknown.message, 'DEALER_LISTING_PREPARATION_UNAVAILABLE');
});

test('prepare calls only the guarded SQL function, as the approved owner, and verifies the readback', async () => {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push([name, args]);
    return { data: { vin: VIN, published: false, governed_seller_is_approved_owner: true }, error: null }; } };
  const receipt = await prepareMyDealerListing(actor, VIN, valid, { db, resolveOwner: async () => owner });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'dealer_prepare_canonical_listing');
  assert.equal(calls[0][1].p_actor_id, 'fictional-owner');
  assert.equal(calls[0][1].p_vin, VIN);
  assert.equal(receipt.published, false);
  assert.ok(receipt.next_steps.includes('INDEPENDENT_CARUP_VEHICLE_REVIEW'));
});

test('prepare refuses a staff/other session even if a workspace lookup resolved, and a lying readback', async () => {
  const db = { rpc: async () => ({ data: { vin: VIN, published: true, governed_seller_is_approved_owner: true }, error: null }) };
  await assert.rejects(prepareMyDealerListing({ userId: 'staff-member' }, VIN, valid,
    { db, resolveOwner: async () => owner }), (e) => e.statusCode === 403);
  await assert.rejects(prepareMyDealerListing(actor, VIN, valid, { db, resolveOwner: async () => owner }),
    /DEALER_LISTING_PREPARATION_READBACK_FAILED/);
  await assert.rejects(prepareMyDealerListing(actor, 'TOO-SHORT', valid, { db, resolveOwner: async () => owner }),
    /INVALID_PRIVATE_DRAFT_VIN/);
});

test('readiness projection publishes labels and statuses only', () => {
  const gate = projectCanonicalReadiness({
    is_publishable: false, completeness_percent: 71,
    requirements: [{ key: 'seller_authority', label: 'Seller authority to list this vehicle', status: 'pending_review',
      blocking: true, who_must_act: 'carup_review', reviewer_id: 'secret-reviewer', file_path: 'VIN/doc.pdf' }],
    reconciliation: { raw: 'private OCR reading' },
  });
  assert.equal(gate.is_publishable, false);
  assert.deepEqual(Object.keys(gate.requirements[0]).sort(), ['blocking', 'key', 'label', 'status', 'who_must_act']);
  assert.ok(!JSON.stringify(gate).includes('secret-reviewer'));
  assert.ok(!JSON.stringify(gate).includes('private OCR reading'));
});

function readinessDb({ vehicle, authority = true }) {
  return {
    from(table) {
      const chain = { _t: table, select() { return chain; }, eq() { return chain; },
        async maybeSingle() {
          if (table === 'vehicles') return { data: vehicle, error: null };
          if (table === 'dealer_vehicle_branch_assignments') return { data: { branch_id: BRANCH }, error: null };
          return { data: null, error: null };
        } };
      return chain;
    },
    async rpc(name) { assert.equal(name, 'dealer_tenant_listing_authority_current'); return { data: authority, error: null }; },
  };
}

test('readiness returns the canonical gate verdict and never claims the dealer domain can publish', async () => {
  const vehicle = { vin: VIN, tenant_id: TENANT, status: 'Available', publication_status: 'draft', current_seller_id: 'fictional-owner' };
  const readiness = await getMyDealerListingReadiness(actor, VIN, {
    db: readinessDb({ vehicle }), resolveOwner: async () => owner,
    evaluate: async (vin) => { assert.equal(vin, VIN); return { is_publishable: true, completeness_percent: 100, requirements: [] }; },
  });
  assert.equal(readiness.canonical_gate.is_publishable, true);
  assert.equal(readiness.dealer_domain_can_publish, false);
  assert.equal(readiness.publish_route, `/api/vehicles/${VIN}/publish`);
  assert.equal(readiness.listing_candidate_prepared, true);
  assert.equal(readiness.branch_id, BRANCH);
});

test('readiness: foreign-tenant VIN is a 404, and a gate outage is a 503 — never "publishable"', async () => {
  await assert.rejects(getMyDealerListingReadiness(actor, VIN, {
    db: readinessDb({ vehicle: null }), resolveOwner: async () => owner, evaluate: async () => ({ is_publishable: true }),
  }), (e) => e.statusCode === 404);
  const vehicle = { vin: VIN, tenant_id: TENANT, status: 'Available', publication_status: 'draft', current_seller_id: 'fictional-owner' };
  await assert.rejects(getMyDealerListingReadiness(actor, VIN, {
    db: readinessDb({ vehicle }), resolveOwner: async () => owner,
    evaluate: async () => { throw new Error('Evidence query error'); },
  }), /CANONICAL_PUBLICATION_GATE_UNAVAILABLE/);
});

test('storefront inventory renders only canonical public details; a hidden VIN is skipped, an outage is a 503', async () => {
  const db = { rpc: async (name, args) => {
    assert.equal(name, 'dealer_storefront_public_listing_vins');
    assert.equal(args.p_seed_dealer_id, 'ZW-DEAL-0001');
    return { data: [{ vin: VIN }, { vin: 'SYNTHR4P02DLR0002' }], error: null };
  } };
  const notFound = Object.assign(new Error('Listing not found'), { statusCode: 404 });
  const inventory = await getPublicDealerStorefrontInventory('ZW-DEAL-0001', { db,
    detail: async (_db, vin, opts) => { assert.equal(opts.audience, 'public'); if (vin !== VIN) throw notFound; return { vin, title: 'Fictional' }; } });
  assert.equal(inventory.count, 1);
  assert.equal(inventory.projection, 'CANONICAL_MARKETPLACE_PUBLIC_DETAIL');
  await assert.rejects(getPublicDealerStorefrontInventory('ZW-DEAL-0001', { db,
    detail: async () => { throw new Error('upstream down'); } }), /DEALER_STOREFRONT_INVENTORY_UNAVAILABLE/);
  await assert.rejects(getPublicDealerStorefrontInventory('../etc', { db }), (e) => e.statusCode === 400);
});

test('wiring: routes construct the real service and the public route sits behind the read limiter', () => {
  const dealer = readFileSync(new URL('../routes/dealerRoutes.js', import.meta.url), 'utf8');
  const research = readFileSync(new URL('../routes/dealerResearchRoutes.js', import.meta.url), 'utf8');
  assert.match(dealer, /router\.post\('\/api\/dealer\/operational-inventory\/:vin\/listing-preparation',\s*authorizeSessionRole\(\[\]\)/);
  assert.match(dealer, /prepareMyDealerListing\(req\.userContext,req\.params\.vin,req\.body\)/);
  assert.match(dealer, /router\.get\('\/api\/dealer\/operational-inventory\/:vin\/listing-readiness',\s*authorizeSessionRole\(\[\]\)/);
  assert.match(research, /router\.get\('\/api\/dealership\/research\/:seedId\/inventory', publicReadLimit,/);
  // The dealership domain never writes publication_status itself.
  const service = readFileSync(new URL('../services/dealer/dealerCanonicalListingService.js', import.meta.url), 'utf8');
  assert.ok(!/publication_status\s*:\s*'published'/.test(service));
  assert.ok(!/\.update\(/.test(service));
});
