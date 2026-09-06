/**
 * Issue #164 — passport lookup policy, permanent guard.
 *
 * Product-owner decision of 2026-08-17: exact VIN lookup stays public and anonymous; plate,
 * temporary-identifier and chassis lookup require verified CarUp authentication; an
 * unauthenticated restricted lookup must not reveal whether the identifier exists.
 *
 * The regressions these tests watch for:
 *   1. A restricted identifier kind quietly becoming publicly resolvable.
 *   2. The non-enumerable response varying with the identifier, which would restore the oracle.
 *   3. The route querying the database BEFORE the policy decision, which would restore the oracle
 *      through response timing even if the body stayed constant.
 *   4. A VIN lookup being allowed to search plate/chassis columns, which would let a public
 *      caller supply a plate and discover the vehicle behind it.
 *   5. The seller opt-in extension point defaulting open.
 *   6. Either passport route losing its rate limit.
 *
 * The policy module imports nothing (no supabase), so it is exercised directly. Route wiring is
 * asserted against server.js source text, which is the house pattern for code that cannot be
 * imported without database env vars.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LOOKUP_KINDS,
  LOOKUP_DECISIONS,
  PUBLIC_LOOKUP_KINDS,
  NON_ENUMERABLE_LOOKUP_RESPONSE,
  classifyLookupIdentifier,
  resolveLookupAccess,
  resolveSellerLookupOptIn,
  lookupColumnsForKind,
  isVerifiedActor,
  normalizeLookupPlate,
} from '../utils/passportLookupPolicy.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

const A_REAL_VIN = '1HGCM82633A004352';
const A_PLATE = 'AEZ 1234';
const A_TEMP_ID = 'TEMP-1234-ZW';
const A_CHASSIS = 'CHASSIS12345';
const VERIFIED_ACTOR = { id: 'u_someone', role: 'buyer' };

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('a 17-character ISO 3779 VIN is classified as the public lookup kind', () => {
  const classified = classifyLookupIdentifier(A_REAL_VIN);
  assert.equal(classified.kind, LOOKUP_KINDS.VIN);
  assert.ok(PUBLIC_LOOKUP_KINDS.includes(classified.kind), 'VIN is the kind a buyer reads off the windscreen');
});

test('a plate, a temporary identifier and a chassis number are all restricted kinds', () => {
  for (const identifier of [A_PLATE, A_TEMP_ID, A_CHASSIS]) {
    const classified = classifyLookupIdentifier(identifier);
    assert.equal(classified.kind, LOOKUP_KINDS.RESTRICTED, `${identifier} must not be publicly resolvable`);
    assert.ok(!PUBLIC_LOOKUP_KINDS.includes(classified.kind));
  }
});

test('a VIN-shaped string containing I, O or Q is not treated as a VIN', () => {
  // ISO 3779 excludes them, so such a string is some other identifier and must stay restricted.
  const classified = classifyLookupIdentifier('1HGCM82633A0043I2');
  assert.equal(classified.kind, LOOKUP_KINDS.RESTRICTED);
});

test('a malformed identifier is rejected before any policy decision is reached', () => {
  for (const bad of ['', 'x', '   ', 'drop;table', '../../etc/passwd', 'a'.repeat(65)]) {
    assert.equal(classifyLookupIdentifier(bad), null, `${JSON.stringify(bad)} must not classify`);
  }
});

test('plate normalization ignores spacing and punctuation', () => {
  assert.equal(normalizeLookupPlate('AEZ 1234'), 'AEZ1234');
  assert.equal(normalizeLookupPlate('aez-1234'), 'AEZ1234');
});

// ---------------------------------------------------------------------------
// Access decisions
// ---------------------------------------------------------------------------

test('an anonymous caller may resolve an exact VIN', () => {
  const access = resolveLookupAccess({ kind: LOOKUP_KINDS.VIN, actor: null });
  assert.equal(access.decision, LOOKUP_DECISIONS.ALLOW);
});

test('an anonymous caller may not resolve a plate, temporary identifier or chassis number', () => {
  const access = resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: null });
  assert.equal(access.decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);
});

test('a verified CarUp account may resolve a restricted identifier', () => {
  const access = resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: VERIFIED_ACTOR });
  assert.equal(access.decision, LOOKUP_DECISIONS.ALLOW, 'authentication is what the decision requires');
  assert.equal(access.reason, 'verified_actor');
});

test('an actor without an id is not a verified actor', () => {
  // optionalAuth() leaves userContext unset when no valid session matched; a forged header
  // therefore yields no id, and must not buy a restricted lookup.
  for (const actor of [null, undefined, {}, { role: 'admin' }, { id: '' }]) {
    assert.equal(isVerifiedActor(actor), false, `${JSON.stringify(actor)} must not count as verified`);
    assert.equal(
      resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor }).decision,
      LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION,
    );
  }
});

test('role is not what gates the lookup — any verified account resolves, and the body stays governed', () => {
  // The decision separates two questions: authentication decides whether the lookup RESOLVES;
  // the existing owner/admin/government rules still decide what the passport BODY contains.
  for (const role of ['buyer', 'owner', 'dealer', 'admin', 'government']) {
    const access = resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: { id: 'u1', role } });
    assert.equal(access.decision, LOOKUP_DECISIONS.ALLOW, `${role} holds a verified account`);
  }
});

// ---------------------------------------------------------------------------
// Non-enumerability
// ---------------------------------------------------------------------------

test('every unauthenticated restricted lookup yields the identical response', () => {
  const decisions = [A_PLATE, A_TEMP_ID, A_CHASSIS, 'NOSUCHPLATE', 'ZZZ 9999'].map(identifier => {
    const classified = classifyLookupIdentifier(identifier);
    return resolveLookupAccess({ kind: classified.kind, actor: null });
  });

  const rendered = new Set(decisions.map(d => JSON.stringify(d)));
  assert.equal(rendered.size, 1, 'a real plate and a fabricated one must be indistinguishable');
});

test('the non-enumerable response carries no per-vehicle detail', () => {
  const body = JSON.stringify(NON_ENUMERABLE_LOOKUP_RESPONSE.body);
  assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.status, 401);
  for (const identifier of [A_PLATE, A_TEMP_ID, A_CHASSIS, A_REAL_VIN]) {
    assert.ok(!body.includes(identifier), 'the response must not echo the identifier that was probed');
  }
  assert.ok(!/found|exist|match/i.test(body), 'the wording must not hint at existence either way');
});

// ---------------------------------------------------------------------------
// Column scoping — why exact-VIN lookup is safe to leave public
// ---------------------------------------------------------------------------

test('a public VIN lookup searches the vin column alone', () => {
  const columns = lookupColumnsForKind(LOOKUP_KINDS.VIN);
  assert.deepEqual(columns.vehicles, ['vin']);
  assert.deepEqual(columns.plateHistory, []);
  for (const column of ['plate_number', 'normalized_plate_number', 'chassis_number', 'temporary_identification_number']) {
    assert.ok(!columns.vehicles.includes(column), `a public lookup must not search ${column}`);
  }
});

test('a restricted lookup searches the identifier columns it is gated on', () => {
  const columns = lookupColumnsForKind(LOOKUP_KINDS.RESTRICTED);
  for (const column of ['plate_number', 'normalized_plate_number', 'chassis_number', 'temporary_identification_number']) {
    assert.ok(columns.vehicles.includes(column), `${column} is the point of a restricted lookup`);
  }
  assert.ok(columns.plateHistory.includes('plate_number'), 'a retired plate still resolves for a verified caller');
});

// ---------------------------------------------------------------------------
// Seller opt-in extension point — must default closed
// ---------------------------------------------------------------------------

test('the seller opt-in resolver is closed by default', async () => {
  for (const identifier of [A_PLATE, A_TEMP_ID, A_CHASSIS]) {
    const optedIn = await resolveSellerLookupOptIn(classifyLookupIdentifier(identifier));
    assert.equal(optedIn, false, 'no vehicle opts into public plate lookup until the feature ships');
  }
});

test('an explicit seller opt-in would allow the lookup without widening the default', () => {
  // Proves the extension point is real: opt-in is honoured when true...
  assert.equal(
    resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: null, sellerOptIn: true }).decision,
    LOOKUP_DECISIONS.ALLOW,
  );
  // ...and every other value leaves the default closed, so a truthy-ish bug cannot open it.
  for (const notOptedIn of [false, undefined, null, 0, '', 'true', 1, {}]) {
    assert.equal(
      resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: null, sellerOptIn: notOptedIn }).decision,
      LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION,
      `sellerOptIn=${JSON.stringify(notOptedIn)} must not open the lookup`,
    );
  }
});

test('the public kind list is a deliberate, minimal registry', () => {
  // This pinned a list of exactly one. Service Network obligation O6 added the second entry, in the
  // open, which is precisely the discipline the list exists to enforce: `GET /api/service-links/
  // :publicToken` was ALREADY anonymously resolvable and simply never consulted this policy, so the
  // registry was not the whole answer to "what can a stranger resolve?". Registering it widened
  // nothing; it made an existing surface visible and load-bearing — `resolveServiceLink` now asks
  // this module for permission, so removing the entry genuinely closes the route.
  //
  // The pin is kept, not deleted: a THIRD entry must still arrive as a deliberate change here.
  assert.deepEqual([...PUBLIC_LOOKUP_KINDS], [LOOKUP_KINDS.VIN, LOOKUP_KINDS.SERVICE_LINK]);

  // The properties that make each entry safe to be public, stated rather than assumed:
  //   - a VIN is read off a windscreen and confirms only the identifier the caller already holds;
  //   - a service-link token is an opaque secret CarUp issued, so it correlates with nothing.
  // Neither is an attribute an attacker can enumerate toward.
  assert.equal(PUBLIC_LOOKUP_KINDS.includes(LOOKUP_KINDS.RESTRICTED), false,
    'plate / chassis / temporary-id must never become publicly resolvable');
});

// ---------------------------------------------------------------------------
// Route wiring (source-text assertions — server.js cannot be imported without db env)
// ---------------------------------------------------------------------------

/** Body of the lookup route handler. */
function lookupRouteSource() {
  const start = serverSrc.indexOf("app.get('/api/vehicles/passport/lookup/:identifier'");
  assert.ok(start > -1, 'the lookup route must still exist — retarget this guard if it moved');
  const end = serverSrc.indexOf('app.get(', start + 10);
  return serverSrc.slice(start, end === -1 ? serverSrc.length : end);
}

test('the lookup route decides access before it queries the database (source-text assertion)', () => {
  const route = lookupRouteSource();
  const decisionIdx = route.indexOf('resolveLookupAccess');
  const queryIdx = route.indexOf('collectPassportLookupMatches');

  assert.ok(decisionIdx > -1, 'the route must consult the lookup policy');
  assert.ok(queryIdx > -1, 'the route must still resolve matches for permitted lookups');
  assert.ok(
    decisionIdx < queryIdx,
    'querying before deciding would restore the oracle through response timing, even with a constant body',
  );
});

test('the lookup route returns the shared non-enumerable response on refusal (source-text assertion)', () => {
  const route = lookupRouteSource();
  assert.match(route, /NON_ENUMERABLE_LOOKUP_RESPONSE\.status/, 'refusal must use the shared status');
  assert.match(route, /NON_ENUMERABLE_LOOKUP_RESPONSE\.body/, 'refusal must use the shared body');
});

test('the lookup passes the identifier kind into the match query (source-text assertion)', () => {
  const route = lookupRouteSource();
  assert.match(
    route,
    /collectPassportLookupMatches\(\s*identifier\s*,\s*classified\.kind\s*\)/,
    'without the kind the query would fall back to searching every identifier column',
  );
});

test('both passport routes are rate limited (source-text assertion)', () => {
  assert.match(
    serverSrc,
    /app\.get\('\/api\/vehicles\/:vin\/passport',\s*passportLimiter/,
    'the VIN passport route must be bounded against bulk sweeps',
  );
  assert.match(
    serverSrc,
    /app\.get\('\/api\/vehicles\/passport\/lookup\/:identifier',\s*passportLookupLimiter/,
    'the identifier route must be bounded against repeated probing',
  );
  assert.match(serverSrc, /const passportLookupLimiter = rateLimiter\(\{[^}]*isSensitive: true/, 'probing is sensitive');
});

test('the lookup limit is tighter than the VIN passport limit (source-text assertion)', () => {
  const vinMax = Number(/const passportLimiter = rateLimiter\(\{\s*max:\s*(\d+)/.exec(serverSrc)?.[1]);
  const lookupMax = Number(/const passportLookupLimiter = rateLimiter\(\{\s*max:\s*(\d+)/.exec(serverSrc)?.[1]);

  assert.ok(Number.isFinite(vinMax) && Number.isFinite(lookupMax), 'both limits must be declared');
  assert.ok(lookupMax < vinMax, 'identifier probing warrants a tighter budget than VIN reads');
});

test('the refusal message cannot be mistaken for an expired session', () => {
  // web/src/lib/apiClient.ts treats a 401 as a session failure when the message is absent or
  // starts with "Unauthorized", and then CLEARS the caller's stored auth. A plate lookup refusal
  // is not a session problem, so wording it that way would sign a browsing user out.
  const message = NON_ENUMERABLE_LOOKUP_RESPONSE.body.error;
  assert.ok(message, 'the refusal must carry a message, since an empty one is also read as a session failure');
  assert.ok(
    !message.startsWith('Unauthorized'),
    'a refusal starting with "Unauthorized" would trigger the client session-expiry path',
  );
  assert.equal(NON_ENUMERABLE_LOOKUP_RESPONSE.body.code, 'LOOKUP_REQUIRES_AUTHENTICATION',
    'the client branches on this code to offer sign-in instead of claiming the vehicle does not exist');
});
