// UAT auth-fixture guard tests.
//
// The Referral Engine UAT setup adds a real admin TEST ACCOUNT (seeded via
// backend/scripts/seed-uat-referral-users.mjs) instead of letting an owner switch
// to admin. These tests assert the production authorization restriction is STILL in
// place and was not weakened: /api/auth/switch-role only lets a user assume their
// own verified role, and 'admin' can never be assumed via the tenant-role path.
// (Source-level invariants, mirroring the existing route-marker test style.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const seedSrc = readFileSync(new URL('../scripts/seed-uat-referral-users.mjs', import.meta.url), 'utf8');

test('switch-role restricts switching to your own user context', () => {
  assert.match(serverSrc, /You can only switch your own role/);
});

test('switch-role validates the role against the approved catalog', () => {
  assert.match(serverSrc, /is not in the approved role catalog/);
});

test('switch-role only grants the user\'s current role or a verified tenant role', () => {
  // The core invariant: assume current role, OR a verified tenant role.
  assert.match(serverSrc, /role === user\.role/);
  assert.match(serverSrc, /role === verifiedTenantRole/);
});

test('admin can NEVER be assumed via the tenant-role path (must be the primary role)', () => {
  // The tenant-role branch explicitly excludes admin, so owner->admin is blocked.
  assert.match(serverSrc, /verifiedTenantRole && role === verifiedTenantRole && role !== 'admin'/);
});

test('switch-role preserves the "not verified for this user context" forbidden response', () => {
  assert.match(serverSrc, /is not verified for this user context/);
});

test('the UAT seed is local/staging only and refuses production', () => {
  assert.match(seedSrc, /NODE_ENV === 'production'/);
  assert.match(seedSrc, /UAT_SEED_CONFIRM !== 'yes'/);
  // Seeds an admin and an owner account, and only writes to the users table.
  assert.match(seedSrc, /role: 'admin'/);
  assert.match(seedSrc, /role: 'owner'/);
  assert.match(seedSrc, /from\('users'\)/);
});
