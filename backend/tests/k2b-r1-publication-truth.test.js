/**
 * PC01-K2B-R1 — Admin "public" means public-Marketplace-visible.
 *
 * The public Marketplace requires BOTH isPublicVehicleStatus(status) AND
 * isPubliclyVisiblePublication(publication_status). Admin moderation and analytics used to derive
 * public_status from status alone, so a `publishable` (ready, not live) vehicle — staging's one
 * operational car, Serena — read as `public` in Admin while the Marketplace showed zero listings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMockSupabase } from './fixtures/marketplaceListings.js';
import { listMarketplaceListings } from '../services/marketplace/listingSummaryService.js';
import {
  deriveListingPublicStatus,
  deriveListingVisibility,
  listListingsForAdmin,
  moderateListing,
  readListingProvenanceBase,
} from '../services/marketplace/marketplaceModerationService.js';
import { getMarketplaceAnalytics } from '../services/marketplace/marketplaceAnalyticsService.js';
import { isPubliclyVisiblePublication } from '../utils/vehicleStatus.js';

const NOW = new Date().toISOString();
const ADMIN = { id: 'admin-1', role: 'admin', platformRole: 'admin' };
const OWNER = { id: 'u_66cace85aa11bb22', email: 'seller.person@mail.co.zw', name: 'Kingston M' };
const UAT_OWNER = { id: 'u_tradeos_r1_seller', email: 'seller@carup-staging.test', name: 'Trade OS UAT seller' };

const car = (vin, status, publication_status, owner = OWNER) => ({
  vin, make: 'Nissan', model: 'Serena', year: 2018, mileage: 60000, price: 9000, currency: 'USD',
  status, publication_status, owner_id: owner.id, current_seller_id: owner.id, tenant_id: null,
  registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner', created_at: NOW,
});

const PUBLICATION_STATES = ['published', 'publishable', 'draft', 'unpublished', 'archived'];
const STATUSES = ['Available', 'Reserved', 'Sold', 'Archived', 'Suspended', 'Flagged', 'Banned', 'Pending'];

test('A · Available + published → public', () => {
  assert.equal(deriveListingPublicStatus('Available', 'published'), 'public');
});
test('B · Reserved + published → public', () => {
  assert.equal(deriveListingPublicStatus('Reserved', 'published'), 'public');
});
test('C · Available + publishable → not public (ready, not live) — not pending_review', () => {
  assert.equal(deriveListingPublicStatus('Available', 'publishable'), 'not_public');
});
test('D · Available + draft → not public', () => {
  assert.equal(deriveListingPublicStatus('Available', 'draft'), 'not_public');
  assert.equal(deriveListingPublicStatus('Available', 'unpublished'), 'not_public');
});
test('E · Sold + published → archived', () => {
  assert.equal(deriveListingPublicStatus('Sold', 'published'), 'archived');
});
test('F · Suspended / Flagged + published → suppressed', () => {
  assert.equal(deriveListingPublicStatus('Suspended', 'published'), 'suppressed');
  assert.equal(deriveListingPublicStatus('Flagged', 'published'), 'suppressed');
});
test('G · Banned + published → rejected; Pending → pending_review', () => {
  assert.equal(deriveListingPublicStatus('Banned', 'published'), 'rejected');
  assert.equal(deriveListingPublicStatus('Pending', 'published'), 'pending_review');
});

test('I · no public_status=public can fail the canonical publication check (every combination)', () => {
  for (const status of STATUSES) {
    for (const publication of PUBLICATION_STATES) {
      const { public_status, publication_status } = deriveListingVisibility({ status, publication_status: publication });
      assert.equal(publication_status, publication, 'the lifecycle value is exposed unchanged');
      if (public_status === 'public') {
        assert.ok(isPubliclyVisiblePublication(publication), `${status}+${publication} claimed public`);
      }
    }
  }
});

function store() {
  return {
    users: [OWNER, UAT_OWNER],
    vehicles: [
      car('JN1SERENA00000001', 'Available', 'publishable'), // the staging shape of Serena
      car('JN1SERENA00000002', 'Available', 'published'),
      car('JN1SERENA00000003', 'Reserved', 'published'),
      car('JN1SERENA00000004', 'Available', 'draft'),
      car('JN1SERENA00000005', 'Suspended', 'published'),
      car('JN1SERENA00000006', 'Available', 'published', UAT_OWNER), // non-operational
    ],
    trust_audit_events: [],
  };
}

test('H · moderation and analytics use the SAME publication projection', async () => {
  const s = store();
  const admin = await listListingsForAdmin(buildMockSupabase(s), { actor: ADMIN });
  const analytics = await getMarketplaceAnalytics(buildMockSupabase(s), ADMIN);
  const count = (v) => admin.listings.filter((l) => l.public_status === v).length;
  assert.equal(admin.listings.length, 5, 'operational population');
  assert.equal(analytics.listings.total, admin.listings.length);
  assert.equal(analytics.listings.public, count('public'));
  assert.equal(analytics.listings.not_public, count('not_public'));
  assert.equal(analytics.listings.suppressed, count('suppressed'));
  assert.equal(count('public'), 2, 'Available+published and Reserved+published only');
  assert.equal(count('not_public'), 2, 'publishable and draft');
  for (const row of admin.listings) {
    assert.ok('publication_status' in row, 'each Admin row exposes its lifecycle');
    if (row.public_status === 'public') assert.ok(isPubliclyVisiblePublication(row.publication_status));
  }
  const serena = admin.listings.find((l) => l.vin === 'JN1SERENA00000001');
  assert.deepEqual({ public_status: serena.public_status, publication_status: serena.publication_status }, { public_status: 'not_public', publication_status: 'publishable' });
});

test('J · the public Marketplace still enforces status AND publication', async () => {
  const res = await listMarketplaceListings(buildMockSupabase(store()), {});
  const vins = res.listings.map((l) => l.vin).sort();
  assert.ok(!vins.includes('JN1SERENA00000001'), 'publishable is not visible');
  assert.ok(!vins.includes('JN1SERENA00000004'), 'draft is not visible');
  assert.ok(!vins.includes('JN1SERENA00000005'), 'suspended is not visible');
  // Every Admin-public operational row is in the public Marketplace, and nothing Admin calls
  // not_public is.
  const admin = await listListingsForAdmin(buildMockSupabase(store()), { actor: ADMIN });
  for (const row of admin.listings) {
    assert.equal(vins.includes(row.vin), row.public_status === 'public', `${row.vin} Admin=${row.public_status}`);
  }
});

test('K · publication truth does not change any provenance classification', async () => {
  const before = await readListingProvenanceBase(buildMockSupabase(store()));
  const flipped = store();
  flipped.vehicles = flipped.vehicles.map((v) => ({ ...v, publication_status: v.publication_status === 'published' ? 'publishable' : 'published' }));
  const after = await readListingProvenanceBase(buildMockSupabase(flipped));
  assert.deepEqual(after.summary, before.summary);
  assert.deepEqual(after.classified.map((c) => c.provenance.class), before.classified.map((c) => c.provenance.class));
});

test('moderation approve reports visibility from the row and never publishes', async () => {
  const s = { ...store(), vehicles: [car('JN1SERENA00000007', 'Suspended', 'publishable')] };
  const res = await moderateListing(buildMockSupabase(s), 'JN1SERENA00000007', 'approve', {}, ADMIN);
  assert.equal(res.status, 'Available');
  assert.equal(res.public_status, 'not_public', 'approve restores status; it does not make a publishable car public');
  assert.equal(res.publication_status, 'publishable');
  assert.equal(s.vehicles[0].publication_status, 'publishable', 'publication_status is never written by moderation');

  const live = { ...store(), vehicles: [car('JN1SERENA00000008', 'Suspended', 'published')] };
  const restored = await moderateListing(buildMockSupabase(live), 'JN1SERENA00000008', 'approve', {}, ADMIN);
  assert.equal(restored.public_status, 'public');
});
