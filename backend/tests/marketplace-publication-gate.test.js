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

test('publication visibility helper: only published is publicly visible (unpublish must not be a no-op)', () => {
  assert.deepEqual(publiclyVisiblePublicationStatuses(), ['published']);
  assert.equal(isPubliclyVisiblePublication('published'), true);
  for (const hidden of ['draft', 'identity_complete', 'documents_submitted', 'review_pending', 'publishable']) {
    assert.equal(isPubliclyVisiblePublication(hidden), false, `${hidden} must be hidden`);
  }
  // Missing value = legacy fixture / column not selected: stays visible (real
  // rows are NOT NULL and the listing select always includes the column).
  assert.equal(isPubliclyVisiblePublication(undefined), true);
});

test('draft and publishable vehicles are absent from the public marketplace list; only published appears', async () => {
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
  assert.ok(!vins.includes('1HGBH41JXMN109999'), 'publishable (ready but not pushed live / unpublished) must NOT be listed');
});

test('unpublish is not a visibility no-op: the state it returns to is hidden', () => {
  // POST /unpublish transitions published -> publishable; if publishable were
  // visible, sellers would be told "no longer publicly visible" while staying listed.
  assert.equal(isPubliclyVisiblePublication('publishable'), false);
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

test('completeness evaluator doc types are legal under vehicle_evidence_evidence_type_check (DB contract)', () => {
  const source = readFileSync(new URL('../services/evidence/completenessEvaluator.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /BLOCKING_DOC_TYPES = \['registration_document', 'ownership_transfer_document'\]/,
    'blocking doc types must be exactly the CHECK-legal ownership documents',
  );
  assert.match(
    source,
    /ADVISORY_DOC_TYPES = \['customs_photo', 'inspection_photo', 'insurance_document', 'police_clearance_document'\]/,
    'advisory doc types must all be CHECK-legal',
  );
  // The illegal legacy values could never match a DB row (the CHECK rejects
  // them on write), silently locking the ownership requirement at 'missing'.
  for (const illegal of ["'ownership_transfer'", "'customs_entry'", "'duty_clearance_document'", "'vid_inspection'"]) {
    assert.ok(!source.includes(illegal), `illegal evidence type ${illegal} must not reappear`);
  }
});

test('a verified ownership_transfer_document satisfies the blocking ownership requirement (behavioral)', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
  const { supabase } = await import('../db/supabase.js');
  const { evaluateCompleteness } = await import('../services/evidence/completenessEvaluator.js');

  const store = {
    vehicles: [vehicle({
      vin: PUBLISHED_VIN,
      chassis_number: 'CH-0001',
      engine_number: 'EN-0001',
      plate_number: 'ABZ1234',
      temp_plate_id: null,
      publication_status: 'draft',
      // ZR registration readiness (69925e21) made an unrecorded stage blocking;
      // this fixture's contract is "everything else satisfied", so it records a
      // truthful sourced stage instead of silently failing that new gate.
      registration_status: 'locally_registered',
      registration_status_source: 'seller_stated',
    })],
    vehicle_evidence: [
      { id: 'ev-1', vin: PUBLISHED_VIN, evidence_type: 'ownership_transfer_document', verification_status: 'verified' },
      { id: 'ev-2', vin: PUBLISHED_VIN, evidence_type: 'customs_photo', verification_status: 'pending' },
    ],
  };
  const originalFrom = supabase.from;
  supabase.from = buildMockSupabase(store).from;
  try {
    const result = await evaluateCompleteness(PUBLISHED_VIN);
    assert.equal(result.is_publishable, true, 'verified ownership_transfer_document must satisfy the ownership gate');
    const ownership = result.requirements.find((r) => r.key === 'ownership_document');
    assert.equal(ownership.status, 'verified');
    // Advisory DOCUMENT matrix carries only CHECK-legal keys, with key-derived labels.
    //
    // RE-AIMED DELIBERATELY, and narrowed to what this assertion actually protects. It used to read
    // `requirements.filter((r) => !r.blocking)` and pin the result to these four. The guarantee was
    // never "there are exactly four advisory requirements" — it is that every advisory requirement
    // DERIVED FROM AN evidence_type carries a CHECK-legal value, because an illegal one can never
    // match a DB row and would silently lock that requirement at 'missing' (see the file-contract
    // test above, which pins ADVISORY_DOC_TYPES itself and forbids the illegal legacy values).
    //
    // R22/R23 add a non-document advisory requirement — the governed finance obligation — which is
    // not an evidence_type, queries no vehicle_evidence row, and therefore cannot express that
    // defect. Filtering by category keeps the original guarantee exact instead of letting an
    // unrelated key either break it or, worse, be waved through by loosening it to a subset check.
    const advisoryDocs = result.requirements.filter((r) => !r.blocking && r.category === 'documents');
    assert.deepEqual(
      advisoryDocs.map((r) => r.key),
      ['customs_photo', 'inspection_photo', 'insurance_document', 'police_clearance_document'],
    );
    assert.equal(advisoryDocs.find((r) => r.key === 'customs_photo').status, 'pending_review');
    assert.equal(advisoryDocs.find((r) => r.key === 'customs_photo').label, 'Customs Photo');

    // AND THE STRENGTHENING that keeps the original protection whole: no advisory requirement
    // outside the documents category may borrow an evidence_type key, which is the only way the
    // silently-locked-at-'missing' defect could re-enter through a different category.
    const CHECK_LEGAL_EVIDENCE_TYPES = new Set([
      'customs_photo', 'inspection_photo', 'insurance_document', 'police_clearance_document',
      'registration_document', 'ownership_transfer_document', 'damage_photo', 'repair_photo',
      'odometer_photo', 'import_photo', 'auction_photo', 'dealer_listing_photo', 'owner_handover_photo',
    ]);
    for (const req of result.requirements.filter((r) => !r.blocking && r.category !== 'documents')) {
      assert.ok(
        !CHECK_LEGAL_EVIDENCE_TYPES.has(req.key),
        `advisory requirement '${req.key}' is keyed on an evidence_type but sits outside the documents `
        + 'category, so it is not derived from ADVISORY_DOC_TYPES and its status can never be satisfied by a document',
      );
      // R22: a non-document advisory requirement must never assert the vehicle is "clear".
      assert.doesNotMatch(String(req.label), /no finance|not financed|finance clear|unencumbered/i);
    }
  } finally {
    supabase.from = originalFrom;
  }
});

test('backfill migration preserves currently-visible inventory (file contract)', () => {
  const migration = readFileSync(new URL('../../database/migrations/20260808140000_publication_gate_backfill.sql', import.meta.url), 'utf8');
  assert.ok(migration.includes("SET publication_status = 'published'"), 'backfill must promote to published');
  assert.ok(migration.includes("'draft', 'identity_complete', 'documents_submitted', 'review_pending', 'publishable'"), 'backfill must cover every currently-visible non-published state');
  assert.ok(migration.includes('lower(btrim(status))'), 'backfill status predicate must mirror the runtime normalization (case/alias/null tolerant)');
  assert.ok(migration.includes('-- +migrate Up'), 'runner markers required');
});
