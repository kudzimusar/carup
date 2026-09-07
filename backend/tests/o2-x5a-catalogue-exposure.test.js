/**
 * O2-X5A — stakeholder exposure pins (plan B14; catalogue manual §2/§5).
 *
 * THE EXPOSURE LAW: availability is SERVER-derived — role + registration
 * profile + verified trade profiles; request-body/header role-like strings
 * change nothing; deferred stakeholders STAY deferred with honest reasons.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkbookCatalogue,
  requireTemplateAction,
  UNAVAILABLE_REASONS,
} from '../services/workbook/workbookCatalogueService.js';

/* Chainable mock client over per-test tables. */
const db = { user_registration_profiles: [], diaspora_trade_profiles: [] };
function builder(table) {
  const filters = [];
  const api = {
    select() { return api; },
    eq(column, value) { filters.push([column, value]); return api; },
    maybeSingle() {
      const row = (db[table] || []).find((candidate) => filters.every(([c, v]) => candidate[c] === v)) || null;
      return Promise.resolve({ data: row, error: null });
    },
    single() {
      const row = (db[table] || []).find((candidate) => filters.every(([c, v]) => candidate[c] === v)) || null;
      return Promise.resolve({ data: row, error: row ? null : { message: 'not found' } });
    },
    then(resolve) {
      const rows = (db[table] || []).filter((candidate) => filters.every(([c, v]) => candidate[c] === v));
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}
const mockClient = { from: (table) => builder(table) };
function resetDb() { db.user_registration_profiles = []; db.diaspora_trade_profiles = []; }

const keysOf = (list) => list.map((entry) => entry.template_key);

test('a plain owner (private seller) sees seller_vehicles and NOT the dealer/diaspora templates', async () => {
  resetDb();
  const catalogue = await resolveWorkbookCatalogue({ id: 'u-owner', role: 'owner' }, { supabaseClient: mockClient });
  assert.ok(keysOf(catalogue.available).includes('seller_vehicles'));
  assert.ok(!keysOf(catalogue.available).includes('dealer_vehicle_inventory'));
  const dealerDenied = catalogue.unavailable.find((entry) => entry.template_key === 'dealer_vehicle_inventory');
  assert.equal(dealerDenied.reason, UNAVAILABLE_REASONS.BUSINESS_CONTEXT_REQUIRED);
  const buyerDenied = catalogue.unavailable.find((entry) => entry.template_key === 'buyer');
  assert.equal(buyerDenied.reason, UNAVAILABLE_REASONS.TRADE_PROFILE_REQUIRED);
});

test('a dealer APPLICANT (business+dealer registration, still role owner) gains the dealer inventory template', async () => {
  resetDb();
  db.user_registration_profiles = [{ user_id: 'u-app', account_kind: 'business', business_type: 'dealer', organization_name: 'Moyo Motors' }];
  const catalogue = await resolveWorkbookCatalogue({ id: 'u-app', role: 'owner' }, { supabaseClient: mockClient });
  const entry = catalogue.available.find((item) => item.template_key === 'dealer_vehicle_inventory');
  assert.ok(entry, 'applicant sees the dealer inventory template');
  assert.match(entry.note, /Applicant mode/);
  assert.match(entry.note, /Dealer activation stays a separate governed decision/);
});

test('an ACTIVE dealer (governed role) gets the dealer template without applicant framing', async () => {
  resetDb();
  const catalogue = await resolveWorkbookCatalogue({ id: 'u-dealer', role: 'dealer' }, { supabaseClient: mockClient });
  const entry = catalogue.available.find((item) => item.template_key === 'dealer_vehicle_inventory');
  assert.ok(entry);
  assert.ok(!/Applicant mode/.test(entry.note));
});

test('diaspora exposure follows VERIFIED trade-profile roles: buyer sees buyer/container; seller sees seller/supplier; unverified sees none', async () => {
  resetDb();
  db.diaspora_trade_profiles = [{ user_id: 'u-b', role_type: 'buyer', verification_status: 'VERIFIED' }];
  const buyerCat = await resolveWorkbookCatalogue({ id: 'u-b', role: 'owner' }, { supabaseClient: mockClient });
  assert.ok(keysOf(buyerCat.available).includes('buyer'));
  assert.ok(keysOf(buyerCat.available).includes('container_reservation'));
  assert.ok(!keysOf(buyerCat.available).includes('seller'));
  const sellerDenied = buyerCat.unavailable.find((entry) => entry.template_key === 'seller');
  assert.equal(sellerDenied.reason, UNAVAILABLE_REASONS.TRADE_PROFILE_ROLE_MISMATCH);

  db.diaspora_trade_profiles = [{ user_id: 'u-s', role_type: 'exporter', verification_status: 'VERIFIED' }];
  const exporterCat = await resolveWorkbookCatalogue({ id: 'u-s', role: 'owner' }, { supabaseClient: mockClient });
  assert.ok(keysOf(exporterCat.available).includes('seller'));
  assert.ok(keysOf(exporterCat.available).includes('supplier'));
  assert.ok(!keysOf(exporterCat.available).includes('buyer'));

  db.diaspora_trade_profiles = [{ user_id: 'u-p', role_type: 'buyer', verification_status: 'PENDING_REVIEW' }];
  const pendingCat = await resolveWorkbookCatalogue({ id: 'u-p', role: 'owner' }, { supabaseClient: mockClient });
  assert.ok(!keysOf(pendingCat.available).includes('buyer'), 'an unverified trade profile unlocks nothing');
});

test('FORGERY PIN: nothing in a request body or header changes the catalogue — only server truth does', async () => {
  resetDb();
  // The service signature admits no body: passing forged hints on the actor object
  // that the server does not set must change nothing.
  const forged = await resolveWorkbookCatalogue({
    id: 'u-forge', role: 'owner',
    business_type: 'dealer', // forged — real context lives in user_registration_profiles
    template_key: 'dealer_vehicle_inventory',
    trade_role: 'buyer',
  }, { supabaseClient: mockClient });
  assert.ok(!keysOf(forged.available).includes('dealer_vehicle_inventory'));
  assert.ok(!keysOf(forged.available).includes('buyer'));

  await assert.rejects(
    requireTemplateAction({ id: 'u-forge', role: 'owner' }, 'dealer_vehicle_inventory', 'import', { supabaseClient: mockClient }),
    (error) => /WORKBOOK_TEMPLATE_NOT_AVAILABLE/.test(error.message) && /business_context_required/.test(error.message),
  );
});

test('deferred and refused stakeholders STAY that way, with honest reasons — never silently hidden', async () => {
  resetDb();
  const catalogue = await resolveWorkbookCatalogue({ id: 'u-any', role: 'owner' }, { supabaseClient: mockClient });
  const reasonOf = (key) => catalogue.unavailable.find((entry) => entry.template_key === key)?.reason;
  assert.equal(reasonOf('garage_service_workbook'), UNAVAILABLE_REASONS.SERVICE_NETWORK_RECONCILIATION_REQUIRED);
  assert.equal(reasonOf('mechanic_service_workbook'), UNAVAILABLE_REASONS.SERVICE_NETWORK_RECONCILIATION_REQUIRED);
  assert.equal(reasonOf('insurer_decision_workbook'), UNAVAILABLE_REASONS.PROVIDER_PLATFORM_IS_THE_INTEGRATION_SURFACE);
  assert.equal(reasonOf('lender_decision_workbook'), UNAVAILABLE_REASONS.PROVIDER_PLATFORM_IS_THE_INTEGRATION_SURFACE);
  assert.equal(reasonOf('government_registry_workbook'), UNAVAILABLE_REASONS.GOVERNED_ACTIVATION_LANE_EXISTS);
  assert.equal(reasonOf('fleet_workbook'), UNAVAILABLE_REASONS.NO_CANONICAL_BULK_WORKFLOW);
});

test('regulated/machine roles get no vehicle templates: mechanic, insurance, bank, government', async () => {
  resetDb();
  for (const role of ['mechanic', 'insurance', 'bank', 'government']) {
    const catalogue = await resolveWorkbookCatalogue({ id: `u-${role}`, role }, { supabaseClient: mockClient });
    assert.ok(!keysOf(catalogue.available).includes('seller_vehicles'), `${role} does not list vehicles`);
    await assert.rejects(
      requireTemplateAction({ id: `u-${role}`, role }, 'seller_vehicles', 'template', { supabaseClient: mockClient }),
      /WORKBOOK_TEMPLATE_NOT_AVAILABLE/,
    );
  }
});
