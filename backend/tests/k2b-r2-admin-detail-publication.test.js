/**
 * PC01-K2B-R2 — the Admin listing DETAIL states publication truth through the same projection as the
 * moderation queue and analytics (deriveListingVisibility). Before R2 it derived public_status from
 * vehicle.status alone, so staging's Serena (Available + publishable) read `public` in Admin detail
 * while the public Marketplace showed nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMockSupabase } from './fixtures/marketplaceListings.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import { deriveListingVisibility, readListingProvenanceBase } from '../services/marketplace/marketplaceModerationService.js';
import { moderationSummary } from '../services/marketplace/marketplaceAiAssistantService.js';
import { isPubliclyVisiblePublication } from '../utils/vehicleStatus.js';

const NOW = new Date().toISOString();
const OWNER = { id: 'u_66cace85aa11bb22', email: 'seller.person@mail.co.zw', name: 'Kingston M' };
const VIN = 'JN1SERENA0R200001';

const car = (status, publication_status, vin = VIN) => ({
  vin, make: 'Nissan', model: 'Serena', year: 2018, mileage: 60000, price: 9000, currency: 'USD',
  status, publication_status, owner_id: OWNER.id, current_seller_id: OWNER.id, tenant_id: null,
  registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner', created_at: NOW,
});
const adminDetail = (status, publication) =>
  getMarketplaceListingDetail(buildMockSupabase({ users: [OWNER], vehicles: [car(status, publication)] }), VIN, { audience: 'admin' });

test('1 · Admin detail: Available + publishable → not_public (the staging Serena shape)', async () => {
  const d = await adminDetail('Available', 'publishable');
  assert.equal(d.public_status, 'not_public');
  assert.equal(d.publication_status, 'publishable');
});

test('2 · Admin detail: Available + published → public', async () => {
  assert.equal((await adminDetail('Available', 'published')).public_status, 'public');
});

test('3 · Admin detail: Reserved + published → public', async () => {
  assert.equal((await adminDetail('Reserved', 'published')).public_status, 'public');
});

test('4 · Admin detail: Sold → archived, Suspended → suppressed, Banned → rejected, draft → not_public', async () => {
  assert.equal((await adminDetail('Sold', 'published')).public_status, 'archived');
  assert.equal((await adminDetail('Suspended', 'published')).public_status, 'suppressed');
  assert.equal((await adminDetail('Banned', 'published')).public_status, 'rejected');
  assert.equal((await adminDetail('Available', 'draft')).public_status, 'not_public');
});

test('5 · Admin detail can never say public when the publication is not canonically visible', async () => {
  for (const status of ['Available', 'Reserved', 'Sold', 'Suspended', 'Flagged', 'Banned', 'Pending', 'Archived']) {
    for (const publication of ['published', 'publishable', 'draft', 'unpublished', 'archived']) {
      const d = await adminDetail(status, publication);
      // The detail and the moderation queue read the SAME projection.
      assert.equal(d.public_status, deriveListingVisibility({ status, publication_status: publication }).public_status, `${status}+${publication}`);
      if (d.public_status === 'public') assert.ok(isPubliclyVisiblePublication(d.publication_status), `${status}+${publication} claimed public`);
    }
  }
});

test('6 · the PUBLIC detail stays gated by the public visibility authority', async () => {
  const store = (s, p) => buildMockSupabase({ users: [OWNER], vehicles: [car(s, p)] });
  await assert.rejects(() => getMarketplaceListingDetail(store('Available', 'publishable'), VIN, { audience: 'public' }), /not found/i);
  await assert.rejects(() => getMarketplaceListingDetail(store('Available', 'draft'), VIN, { audience: 'public' }), /not found/i);
  await assert.rejects(() => getMarketplaceListingDetail(store('Suspended', 'published'), VIN, { audience: 'public' }), /not found/i);
  const live = await getMarketplaceListingDetail(store('Available', 'published'), VIN, { audience: 'public' });
  assert.equal(live.public_status, 'public');
  assert.equal('publication_status' in live, false, 'the public payload shape is unchanged');
});

test('7 · the AI moderation summary consuming Admin detail does not regress', async () => {
  const d = await adminDetail('Available', 'publishable');
  const prompts = [];
  const aiCall = async (...args) => { prompts.push(JSON.stringify(args)); return null; };
  const out = await moderationSummary({ listingSummary: d, trustSummary: d.trust_summary }, { aiCall });
  assert.equal(out.ai_status, 'ai_unavailable');
  assert.match(out.summary, new RegExp(VIN));
  // The summary is decided by vin + trust state only: the publication fields change nothing.
  const asIfPublic = await moderationSummary({ listingSummary: { ...d, public_status: 'public', publication_status: 'published' }, trustSummary: d.trust_summary }, { aiCall: async () => null });
  assert.deepEqual({ summary: asIfPublic.summary, suggested_action: asIfPublic.suggested_action }, { summary: out.summary, suggested_action: out.suggested_action });
  assert.ok(prompts.every((p) => !p.includes('public_status')), 'publication fields are not sent to the provider');
});

test('8 · reading Admin detail changes no provenance and writes nothing', async () => {
  const data = { users: [OWNER], vehicles: [car('Available', 'publishable'), car('Available', 'published', 'JN1SERENA0R200002')] };
  const snapshot = JSON.stringify({ users: data.users, vehicles: data.vehicles });
  const before = await readListingProvenanceBase(buildMockSupabase(data));
  for (const v of data.vehicles) await getMarketplaceListingDetail(buildMockSupabase(data), v.vin, { audience: 'admin' });
  const after = await readListingProvenanceBase(buildMockSupabase(data));
  assert.deepEqual(after.summary, before.summary);
  assert.equal(JSON.stringify({ users: data.users, vehicles: data.vehicles }), snapshot, 'no business row was written');
  // The mock materialises every table it is asked to READ; none of them gained a row.
  for (const [table, rows] of Object.entries(data)) if (!['users', 'vehicles'].includes(table)) assert.equal(rows.length, 0, `${table} written`);
});
