import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  LOOKUP_DECISIONS,
  LOOKUP_KINDS,
  PUBLIC_LOOKUP_KINDS,
  NON_ENUMERABLE_LOOKUP_RESPONSE,
  resolvePassportKeyAccess,
} from '../utils/passportLookupPolicy.js';

/**
 * PC01-J-R1 — the per-key passport route answers the lookup policy's question.
 *
 * Measured on the staging pair on 2026-10-10, anonymously, for the real UAT vehicle GFC27-027051
 * (a documented Japanese frame number stored as `vehicles.vin`, listing UNPUBLISHED):
 *
 *   GET /api/vehicles/passport/lookup/GFC27-027051   401 LOOKUP_REQUIRES_AUTHENTICATION
 *   GET /api/vehicles/GFC27-027051/passport          200 — the full passport: claims, evidence
 *                                                     timeline, ownership summary, finance block
 *   GET /api/vehicles/GFC27-027051/details           404
 *
 * The decision of 2026-08-17 ("plate / chassis / temporary-id must never become publicly
 * resolvable") was enforced on one route and bypassed on the other.
 */

const SERENA = 'GFC27-027051';
const ISO_VIN = 'JTDKARFP0H3000731';
const ANONYMOUS = null;
const SIGNED_IN = { id: 'u_buyer_1', role: 'owner' };

test('an ISO VIN stays public for everyone — the governed decision is unchanged', () => {
  assert.equal(resolvePassportKeyAccess({ key: ISO_VIN, actor: ANONYMOUS }).decision, LOOKUP_DECISIONS.ALLOW);
  assert.equal(resolvePassportKeyAccess({ key: ISO_VIN, actor: ANONYMOUS }).reason, 'public_kind');
});

test('a frame-number key of an UNLISTED vehicle is refused to an anonymous caller', () => {
  const access = resolvePassportKeyAccess({ key: SERENA, actor: ANONYMOUS });
  assert.equal(access.decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);
  assert.equal(access.kind, LOOKUP_KINDS.RESTRICTED);
  const notListed = resolvePassportKeyAccess({ key: SERENA, actor: ANONYMOUS, publiclyListed: false });
  assert.equal(notListed.decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);
});

test('a frame-number key resolves anonymously once its vehicle is publicly listed — the key is the listing URL', () => {
  const access = resolvePassportKeyAccess({ key: SERENA, actor: ANONYMOUS, publiclyListed: true });
  assert.equal(access.decision, LOOKUP_DECISIONS.ALLOW);
  assert.equal(access.reason, 'publicly_listed');
});

test('only a literal true counts as listed — a truthy value is not evidence', () => {
  for (const notEvidence of ['true', 1, {}, 'published']) {
    assert.equal(
      resolvePassportKeyAccess({ key: SERENA, actor: ANONYMOUS, publiclyListed: notEvidence }).decision,
      LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION,
      `publiclyListed=${JSON.stringify(notEvidence)} must not open the route`,
    );
  }
});

test('a signed-in caller resolves a restricted key, exactly as the lookup route allows', () => {
  const access = resolvePassportKeyAccess({ key: SERENA, actor: SIGNED_IN });
  assert.equal(access.decision, LOOKUP_DECISIONS.ALLOW);
  assert.equal(access.reason, 'verified_actor');
});

test('plate-shaped and temporary-id-shaped keys are restricted too', () => {
  for (const key of ['AGE9281', 'TMP-2026-00017', 'ABC 1234']) {
    assert.equal(resolvePassportKeyAccess({ key, actor: ANONYMOUS }).decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION, key);
  }
});

test('the public kinds are still exactly VIN and service link — listing-key access is a route rule, not a new public kind', () => {
  assert.deepEqual([...PUBLIC_LOOKUP_KINDS], [LOOKUP_KINDS.VIN, LOOKUP_KINDS.SERVICE_LINK]);
});

test('the refusal names chassis and frame numbers and still cannot be read as an expired session', () => {
  const message = NON_ENUMERABLE_LOOKUP_RESPONSE.body.error;
  assert.match(message, /chassis or frame number/);
  assert.ok(!message.startsWith('Unauthorized'));
  assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.status, 401);
});

// ── Route wiring (source text — server.js cannot be imported without a database) ──────────────

const SERVER = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../server.js'), 'utf8');
const CODE = SERVER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\S\r\n]*\/\/.*$/gm, '');

function routeBody(signature) {
  const start = CODE.indexOf(signature);
  assert.ok(start > -1, `${signature} must still exist`);
  const end = CODE.indexOf('app.get(', start + 10);
  return CODE.slice(start, end === -1 ? CODE.length : end);
}

test('the per-key passport route decides access before it builds the passport', () => {
  const route = routeBody("app.get('/api/vehicles/:vin/passport'");
  const decision = route.indexOf('passportKeyAllowed(');
  const build = route.indexOf('buildVehiclePassport(');
  assert.ok(decision > -1, 'the route must consult the lookup policy');
  assert.ok(build > -1, 'the route must still build permitted passports');
  assert.ok(decision < build, 'building first would hand the body over before the decision');
  assert.match(route, /NON_ENUMERABLE_LOOKUP_RESPONSE\.status/);
  assert.match(route, /NON_ENUMERABLE_LOOKUP_RESPONSE\.body/);

  const start = CODE.indexOf('async function passportKeyAllowed');
  assert.ok(start > -1, 'the decision lives in one named helper');
  const helper = CODE.slice(start, CODE.indexOf('\n}\n', start) + 2);
  assert.match(helper, /resolvePassportKeyAccess\(\{ key: vin, actor \}\)/);
  assert.match(helper, /isPubliclyListedVehicleKey\(vin\)/);
  // The listing is read ONLY when the policy would otherwise refuse (anonymous + restricted key).
  assert.ok(helper.indexOf('REQUIRE_AUTHENTICATION') < helper.indexOf('isPubliclyListedVehicleKey'));
});

test('"publicly listed" is the public details route\'s own predicate, and a failed read is "not listed"', () => {
  const start = CODE.indexOf('async function isPubliclyListedVehicleKey');
  assert.ok(start > -1);
  const body = CODE.slice(start, CODE.indexOf('\n}\n', start) + 2);
  assert.match(body, /isPublicVehicleStatus\(data\.status\) && isPubliclyVisiblePublication\(data\.publication_status\)/);
  assert.match(body, /if \(error \|\| !data\) return false/);
  assert.match(body, /catch \{\s*return false;\s*\}/);
});
