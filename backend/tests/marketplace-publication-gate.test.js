/**
 * Publication gate — hermetic tests for the read-path filter that keeps
 * pre-publication vehicles out of the public marketplace, and for the
 * publish/unpublish route contract.
 *
 * The gate closed a P0: publication_status existed (20260624140000) but the
 * public list/detail path only filtered availability status, so every 'draft'
 * was publicly listed the instant it was created.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { buildMockSupabase } from './fixtures/marketplaceListings.js';
import { listMarketplaceListings, filterVisibleVehicles } from '../services/marketplace/listingSummaryService.js';
import { getMarketplaceListingDetail } from '../services/marketplace/marketplaceListingDetailService.js';
import { isPubliclyVisiblePublication, publiclyVisiblePublicationStatuses } from '../utils/vehicleStatus.js';

const NOW = new Date().toISOString();
const DRAFT_VIN = '1HGBH41JXMN109777';
const PUBLISHED_VIN = '1HGBH41JXMN109888';

function vehicle(overrides = {}) {
  return {
    vin: PUBLISHED_VIN, make: 'Toyota', model: 'Corolla', year: 2018, mileage: 42000,
    price: 9500, currency: 'USD', status: 'Available', trust_score: 78,
    owner_id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: null,
    registration_country: 'ZW', import_source: 'Local', current_seller_type: 'Private Owner',
    duty_paid: true, police_verified: true, passport_verified: false, created_at: NOW,
    publication_status: 'published',
    ...overrides,
  };
}

test('publication visibility helper: draft and intermediate states are not publicly visible', () => {
  assert.deepEqual(publiclyVisiblePublicationStatuses(), ['publishable', 'published']);
  assert.equal(isPubliclyVisiblePublication('published'), true);
  assert.equal(isPubliclyVisiblePublication('publishable'), true);
  for (const hidden of ['draft', 'identity_complete', 'documents_submitted', 'review_pending']) {
    assert.equal(isPubliclyVisiblePublication(hidden), false, `${hidden} must be hidden`);
  }
  // Missing value = legacy fixture / column not selected: stays visible (real
  // rows are NOT NULL and the listing select always includes the column).
  assert.equal(isPubliclyVisiblePublication(undefined), true);
});

test('a draft vehicle is absent from the public marketplace list; published/publishable appear', async () => {
  const supabase = buildMockSupabase({
    vehicles: [
      vehicle({ vin: DRAFT_VIN, publication_status: 'draft' }),
      vehicle({ vin: PUBLISHED_VIN, publication_status: 'published' }),
      vehicle({ vin: '1HGBH41JXMN109999', publication_status: 'publishable' }),
    ],
  });
  const { listings } = await listMarketplaceListings(supabase, {});
  const vins = listings.map((l) => l.vin);
  assert.ok(!vins.includes(DRAFT_VIN), 'draft must not be publicly listed');
  assert.ok(vins.includes(PUBLISHED_VIN), 'published must be listed');
  assert.ok(vins.includes('1HGBH41JXMN109999'), 'publishable must be listed');
});

test('public listing detail 404s for a draft vehicle but resolves for a published one', async () => {
  const supabase = buildMockSupabase({
    vehicles: [
      vehicle({ vin: DRAFT_VIN, publication_status: 'draft' }),
      vehicle({ vin: PUBLISHED_VIN, publication_status: 'published' }),
    ],
  });
  await assert.rejects(
    () => getMarketplaceListingDetail(supabase, DRAFT_VIN, { audience: 'public' }),
    /Listing not found/,
    'a pre-publication vehicle must not resolve for the public audience',
  );
  const detail = await getMarketplaceListingDetail(supabase, PUBLISHED_VIN, { audience: 'public' });
  assert.equal(detail.vin, PUBLISHED_VIN);
});

test('filterVisibleVehicles composes availability and publication filters', () => {
  const rows = [
    vehicle({ vin: 'A11111111111111A1', status: 'Available', publication_status: 'draft' }),
    vehicle({ vin: 'B11111111111111B1', status: 'Sold', publication_status: 'published' }),
    vehicle({ vin: 'C11111111111111C1', status: 'Available', publication_status: 'published' }),
  ];
  const visible = filterVisibleVehicles(rows, { showFixtures: true });
  assert.deepEqual(visible.map((v) => v.vin), ['C11111111111111C1']);
});

test('publish/unpublish route contract (source): auth, scope, completeness gate, audit', () => {
  const source = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /router\.post\('\/api\/vehicles\/:vin\/publish',\s*authorizeRole\(\['owner',\s*'dealer',\s*'admin'\]\)/,
    'publish must be role-guarded',
  );
  assert.match(
    source,
    /router\.post\('\/api\/vehicles\/:vin\/unpublish',\s*authorizeRole\(\['owner',\s*'dealer',\s*'admin'\]\)/,
    'unpublish must be role-guarded',
  );
  assert.ok(source.includes('evaluateCompleteness(vin)'), 'publish must run the deterministic completeness evaluator');
  assert.ok(source.includes('is_publishable'), 'publish must refuse while the listing is not publishable');
  assert.ok(source.includes('blocking_gaps'), 'refusals must return the blocking gaps to the seller');
  assert.ok(source.includes('VEHICLE_LISTING_PUBLISHED'), 'publishing must be audited');
  assert.ok(source.includes('VEHICLE_LISTING_UNPUBLISHED'), 'unpublishing must be audited');
  // Scope check reuses the ownership/tenant rule from the status PATCH.
  assert.ok(source.includes('loadScopedVehicle'), 'publish/unpublish must run the shared ownership/tenant scope check');
});

test('backfill migration preserves currently-visible inventory (file contract)', () => {
  const migration = readFileSync(new URL('../../database/migrations/20260808140000_publication_gate_backfill.sql', import.meta.url), 'utf8');
  assert.ok(migration.includes("SET publication_status = 'published'"), 'backfill must promote to published');
  assert.ok(migration.includes("'draft', 'identity_complete', 'documents_submitted', 'review_pending'"), 'backfill must cover every pre-publication state');
  assert.ok(migration.includes('-- +migrate Up'), 'runner markers required');
});
