/**
 * Service Network S1 — Governed Garage Identity & Publication authority contracts.
 *
 * Drives the REAL garageDirectoryService over a mocked Supabase, proving the S0-frozen
 * authority rules the migration alone cannot express:
 *
 *   - the public directory publishes ONLY published profiles, and never leaks the
 *     internal tenant UUID (public identity is the slug — plan §6.5);
 *   - a draft profile is invisible to every public surface;
 *   - publication is truthful: nothing publishes without a real name, a structured
 *     capability and a location, and there are no ratings/hours/verified fabrications;
 *   - verification_dimensions and publication_status have NO client writer;
 *   - contact policy governs phone exposure (in_app_only never leaks a number);
 *   - tenant scoping is app-level and cross-tenant access reads as not-found;
 *   - garage identity is limited to garage-type tenants of the ACTIVE tenants universe;
 *   - PartSentry participation is DERIVED, never stored (no duplicate authority);
 *   - unknown is not zero (Invariant 10): an unavailable count is null, not 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  GARAGE_SERVICE_CATEGORIES,
  createMyGarageBranch,
  deactivateMyGarageBranch,
  getMyGarageProfile,
  getPublicGarageDetail,
  getPublicGarageDirectory,
  publishMyGarageProfile,
  unpublishMyGarageProfile,
  upsertMyGarageProfile,
} from '../services/serviceNetwork/garageDirectoryService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const NON_GARAGE = '33333333-3333-3333-3333-333333333333';

const garageAdminA = { id: 'u-a', role: 'mechanic', effectiveRole: 'mechanic', tenantId: TENANT_A };
const garageAdminB = { id: 'u-b', role: 'mechanic', effectiveRole: 'mechanic', tenantId: TENANT_B };

function seedClient(extra = {}) {
  return createMockSupabase({
    tenants: [
      { id: TENANT_A, name: 'Harare Motors', type: 'garage', status: 'active' },
      { id: TENANT_B, name: 'Bulawayo Auto', type: 'garage', status: 'active' },
      { id: NON_GARAGE, name: 'Croco Dealer', type: 'dealership', status: 'active' },
    ],
    garage_public_profiles: [],
    garage_branches: [],
    partsentry_logs: [],
    ...extra,
  });
}

async function createPublishedProfileA(client) {
  await upsertMyGarageProfile(client, garageAdminA, {
    display_name: 'Harare Motors',
    location_city: 'Harare',
    location_province: 'Harare',
    service_categories: ['engine', 'brakes'],
  });
  await publishMyGarageProfile(client, garageAdminA);
}

test('a draft profile is invisible to the public directory and to public detail', async () => {
  const client = seedClient();
  await upsertMyGarageProfile(client, garageAdminA, {
    display_name: 'Harare Motors',
    location_city: 'Harare',
    service_categories: ['engine'],
  });

  const directory = await getPublicGarageDirectory(client, {});
  assert.deepEqual(directory.garages, [], 'a draft garage must never appear publicly');
  assert.equal(directory.total, 0);

  await assert.rejects(() => getPublicGarageDetail(client, 'harare-motors'), /not found/i);
});

test('the public projection never exposes the internal tenant UUID', async () => {
  const client = seedClient();
  await createPublishedProfileA(client);

  const { garages } = await getPublicGarageDirectory(client, {});
  assert.equal(garages.length, 1);
  const serialized = JSON.stringify(garages[0]);
  assert.equal(Object.hasOwn(garages[0], 'tenant_id'), false, 'tenant_id must not be in the public projection');
  assert.equal(serialized.includes(TENANT_A), false, 'internal tenant UUID must not leak in any field');
  assert.equal(garages[0].slug, 'harare-motors', 'the slug is the public identity');

  const detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.equal(JSON.stringify(detail.garage).includes(TENANT_A), false);
});

test('publication is refused until the profile is truthful and useful', async () => {
  const client = seedClient();
  // name only: no capability, no location
  await upsertMyGarageProfile(client, garageAdminA, { display_name: 'Harare Motors' });
  await assert.rejects(() => publishMyGarageProfile(client, garageAdminA), (e) => {
    assert.match(e.message, /service_categories/);
    assert.match(e.message, /location_city/);
    return true;
  });

  // still not publishable with a capability but no location
  await upsertMyGarageProfile(client, garageAdminA, { service_categories: ['engine'] });
  await assert.rejects(() => publishMyGarageProfile(client, garageAdminA), /location_city/);

  await upsertMyGarageProfile(client, garageAdminA, { location_city: 'Harare' });
  const published = await publishMyGarageProfile(client, garageAdminA);
  assert.equal(published.profile.publication_status, 'published');
  assert.ok(published.profile.published_at, 'published_at is stamped on publication');
});

test('publication_status and verification_dimensions have no client writer', async () => {
  const client = seedClient();
  await assert.rejects(
    () => upsertMyGarageProfile(client, garageAdminA, { display_name: 'X Garage', publication_status: 'published' }),
    /publication_status cannot be set directly/,
  );
  await assert.rejects(
    () => upsertMyGarageProfile(client, garageAdminA, {
      display_name: 'X Garage',
      verification_dimensions: { identity_verified: true },
    }),
    /governed verification workflows/,
  );
});

test('nothing is verified by default — the public projection ships an empty verification set', async () => {
  const client = seedClient();
  await createPublishedProfileA(client);
  const detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.deepEqual(detail.garage.verification_dimensions, {}, 'no fabricated verified status');
  assert.equal(Object.hasOwn(detail.garage, 'rating'), false, 'no invented ratings');
  assert.equal(Object.hasOwn(detail.garage, 'opening_hours'), false, 'no invented opening hours');
});

test('contact policy governs phone exposure — in_app_only never leaks a number', async () => {
  const client = seedClient();
  await upsertMyGarageProfile(client, garageAdminA, {
    display_name: 'Harare Motors',
    location_city: 'Harare',
    service_categories: ['engine'],
    public_phone: '+263 77 000 0000',
  });
  await publishMyGarageProfile(client, garageAdminA);

  let detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.equal(detail.garage.public_phone, null, 'default in_app_only must suppress the stored number');

  await upsertMyGarageProfile(client, garageAdminA, { contact_policy: 'phone_public' });
  detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.equal(detail.garage.public_phone, '+263 77 000 0000');
});

test('unpublishing removes the garage from public surfaces without deleting it', async () => {
  const client = seedClient();
  await createPublishedProfileA(client);
  await unpublishMyGarageProfile(client, garageAdminA);

  const directory = await getPublicGarageDirectory(client, {});
  assert.equal(directory.total, 0);
  const mine = await getMyGarageProfile(client, garageAdminA);
  assert.equal(mine.profile.publication_status, 'unpublished', 'the record survives — history is not destroyed');
});

test('service categories are a closed vocabulary', async () => {
  const client = seedClient();
  await assert.rejects(
    () => upsertMyGarageProfile(client, garageAdminA, {
      display_name: 'X Garage',
      service_categories: ['engine', 'time_travel'],
    }),
    /Unknown service category: time_travel/,
  );
  assert.ok(GARAGE_SERVICE_CATEGORIES.includes('general_service'));
  await assert.rejects(() => getPublicGarageDirectory(client, { category: 'nope' }), /Unknown service category/);
});

test('garage identity is limited to garage-type tenants and requires a verified tenant context', async () => {
  const client = seedClient();
  await assert.rejects(
    () => upsertMyGarageProfile(client, { id: 'u-c', tenantId: NON_GARAGE }, { display_name: 'Croco' }),
    /garage-type tenants/,
  );
  await assert.rejects(
    () => upsertMyGarageProfile(client, { id: 'u-d', tenantId: null }, { display_name: 'Nobody' }),
    /membership-verified garage tenant context/,
  );
});

test('branches are tenant-scoped: another tenant cannot deactivate them', async () => {
  const client = seedClient();
  const { branch } = await createMyGarageBranch(client, garageAdminA, { name: 'Main Workshop', location_city: 'Harare' });
  await assert.rejects(() => deactivateMyGarageBranch(client, garageAdminB, branch.id), /not found/i);

  const still = await getMyGarageProfile(client, garageAdminA);
  assert.equal(still.branches.length, 1);
  assert.equal(still.branches[0].is_active, true, 'the cross-tenant attempt changed nothing');

  const ok = await deactivateMyGarageBranch(client, garageAdminA, branch.id);
  assert.equal(ok.branch.is_active, false);
});

test('duplicate branch names within one garage lose the database race', async () => {
  const client = seedClient();
  await createMyGarageBranch(client, garageAdminA, { name: 'Main Workshop' });
  await assert.rejects(
    () => createMyGarageBranch(client, garageAdminA, { name: 'Main Workshop' }),
    /already exists/,
  );
  // the same branch name under a DIFFERENT garage is legitimate
  const other = await createMyGarageBranch(client, garageAdminB, { name: 'Main Workshop' });
  assert.ok(other.branch.id);
});

test('public detail lists only active branches, in a public-safe shape', async () => {
  const client = seedClient();
  await createPublishedProfileA(client);
  const { branch } = await createMyGarageBranch(client, garageAdminA, { name: 'North Branch', location_city: 'Harare' });
  await createMyGarageBranch(client, garageAdminA, { name: 'South Branch', location_city: 'Chitungwiza' });
  await deactivateMyGarageBranch(client, garageAdminA, branch.id);

  const detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.deepEqual(detail.branches.map((b) => b.name), ['South Branch']);
  assert.equal(Object.hasOwn(detail.branches[0], 'id'), false, 'internal branch ids are not public');
  assert.equal(Object.hasOwn(detail.branches[0], 'tenant_id'), false);
});

test('PartSentry participation is derived from the real ledger, and unknown is not zero', async () => {
  const client = seedClient({
    partsentry_logs: [
      { id: 1, vin: 'VIN1', tenant_id: TENANT_A },
      { id: 2, vin: 'VIN2', tenant_id: TENANT_A },
      { id: 3, vin: 'VIN3', tenant_id: TENANT_B },
    ],
  });
  await createPublishedProfileA(client);
  const detail = await getPublicGarageDetail(client, 'harare-motors');
  assert.equal(detail.partsentry_participation.available, true);
  assert.equal(detail.partsentry_participation.recorded_repairs, 2, 'counts only this garage tenant');

  // Invariant 10: when the ledger cannot be read, the answer is unknown — never 0.
  const broken = seedClient();
  await createPublishedProfileA(broken);
  const originalFrom = broken.from.bind(broken);
  broken.from = (table) => (table === 'partsentry_logs'
    ? { select: () => ({ eq: async () => ({ data: null, count: null, error: { message: 'unavailable' } }) }) }
    : originalFrom(table));
  const degraded = await getPublicGarageDetail(broken, 'harare-motors');
  assert.equal(degraded.partsentry_participation.available, false);
  assert.equal(degraded.partsentry_participation.recorded_repairs, null, 'unknown must not render as zero');
});

test('directory filters by city and category without inventing matches', async () => {
  const client = seedClient();
  await createPublishedProfileA(client); // Harare, engine+brakes
  await upsertMyGarageProfile(client, garageAdminB, {
    display_name: 'Bulawayo Auto',
    location_city: 'Bulawayo',
    service_categories: ['tyres'],
  });
  await publishMyGarageProfile(client, garageAdminB);

  assert.equal((await getPublicGarageDirectory(client, {})).total, 2);
  assert.equal((await getPublicGarageDirectory(client, { city: 'Harare' })).total, 1);
  assert.equal((await getPublicGarageDirectory(client, { category: 'tyres' })).garages[0].slug, 'bulawayo-auto');
  assert.equal((await getPublicGarageDirectory(client, { category: 'bodywork' })).total, 0);
});
