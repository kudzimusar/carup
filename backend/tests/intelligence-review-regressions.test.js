/**
 * CarUp Intelligence 1.0 — regressions found by the I2–I5 adversarial review.
 *
 * Each test here pins a defect that WAS live in this lane. They are grouped in one
 * file deliberately: these are not hypotheses, they are things that were genuinely broken
 * and would otherwise have shipped silently producing confident wrong numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { ROLLUP_EXCLUDED_FLAGS } from '../services/intelligence/activityEventTypes.js';
import { projectMetadata, syntheticAuthorized, deriveActorContext } from '../services/intelligence/activityLedgerService.js';
import { rate, AVAILABILITY } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// ── Web client: the flush was pointed at production and at a 404 ────────────

test('the activity client resolves its base URL with BOTH arguments', () => {
  // Called bare, resolveApiBaseUrl falls through every environment branch and
  // returns the PRODUCTION base — which would have sent a staging tester's session
  // token to production and written staging behaviour into production rollups.
  const src = read('web/src/lib/intelligenceActivity.ts');
  assert.ok(!/resolveApiBaseUrl\(\s*\)/.test(src),
    'resolveApiBaseUrl() with no arguments resolves to the production backend');
  assert.match(src, /resolveApiBaseUrl\(configured, hostname\)/);
});

test('the ingestion path does not double the /api prefix', () => {
  // The resolved base already ends in /api, so `${base}/api/...` 404s and every
  // client event is lost — invisibly, because the request never reaches the route
  // that would have counted the loss.
  const src = read('web/src/lib/intelligenceActivity.ts');
  assert.ok(!src.includes('/api/intelligence/activity'));
  assert.match(src, /\$\{baseUrl\}\/intelligence\/activity/);
});

test('a failed flush returns the batch to the queue instead of dropping it', () => {
  const src = read('web/src/lib/intelligenceActivity.ts');
  assert.match(src, /queue = \[\.\.\.batch, \.\.\.queue\]/,
    'the batch is removed before the attempt, so a total failure must requeue it');
});

test('an anonymous visitor does not have their session reset on every page load', () => {
  // isAuthenticated is false for every GUEST, not only after a logout. Resetting on
  // the bare value minted a new session key per page load, breaking anonymous
  // unique counts and severing the view->inquiry stage link.
  const src = read('web/src/components/intelligence/ActivityInstrumentation.tsx');
  assert.match(src, /wasAuthenticated/, 'only a true->false transition is a logout');
});

// ── Ingestion route: the endpoint never answered ────────────────────────────

test('optionalAuth is INVOKED, not passed as a factory', () => {
  // Passed uncalled, Express treats the factory as the middleware; it ignores
  // (req,res,next) and never calls next(), so every POST hung until timeout.
  const src = read('backend/routes/intelligenceActivityRoutes.js');
  assert.match(src, /optionalAuth\(\),/);
  assert.ok(!/\n\s*optionalAuth,\n/.test(src));
});

// ── Exclusion machinery was inert for every headline metric ─────────────────

test('server-emitted events compute their own exclusion flags', () => {
  // recordServerEvent wrote exclusion_flags: [] and no emitter ever passed any, so
  // a dealer refreshing their own listing inflated their own demand, fixture VINs
  // counted as real shoppers, and self_traffic_views was a permanent zero.
  const src = read('backend/services/intelligence/activityLedgerService.js');
  assert.match(src, /const derivedFlags = computeExclusionFlags\(/);
  assert.match(src, /exclusion_flags: Array\.from\(new Set\(\[\.\.\.derivedFlags/);
});

test('emitters carry the user agent so a crawler can be recognised', () => {
  const src = read('backend/services/intelligence/marketplaceActivityEmitters.js');
  assert.match(src, /userAgent: typeof req\?\.headers\?\.\['user-agent'\]/);
});

test('synthetic certification traffic is excluded from business rollups', () => {
  assert.ok(ROLLUP_EXCLUDED_FLAGS.includes('synthetic'),
    'a UAT run must never be counted into a seller\'s real numbers');
});

// ── Trust inference from NODE_ENV ──────────────────────────────────────────

test('declaring events synthetic requires an explicit opt-in, not NODE_ENV', () => {
  // CarUp has already run NODE_ENV=test inside a staging PRODUCTION environment,
  // which turned exactly this kind of check into an open door.
  const previous = process.env.CARUP_ALLOW_SYNTHETIC_ACTIVITY;
  delete process.env.CARUP_ALLOW_SYNTHETIC_ACTIVITY;
  const previousSecret = process.env.INTELLIGENCE_WORKER_SECRET;
  delete process.env.INTELLIGENCE_WORKER_SECRET;
  try {
    assert.equal(syntheticAuthorized({ headers: {} }), false,
      'NODE_ENV=test must not authorize synthetic declarations');
    process.env.CARUP_ALLOW_SYNTHETIC_ACTIVITY = 'true';
    assert.equal(syntheticAuthorized({ headers: {} }), true);
  } finally {
    if (previous === undefined) delete process.env.CARUP_ALLOW_SYNTHETIC_ACTIVITY;
    else process.env.CARUP_ALLOW_SYNTHETIC_ACTIVITY = previous;
    if (previousSecret !== undefined) process.env.INTELLIGENCE_WORKER_SECRET = previousSecret;
  }
});

test('the communications worker secret does not authorize Intelligence', () => {
  const src = read('backend/services/intelligence/activityLedgerService.js');
  assert.ok(!src.includes('COMMUNICATION_WORKER_SECRET'),
    'a secret issued for one trust domain must not authorize another');
});

test('a header-asserted identity is never written as an authenticated actor', () => {
  const asserted = deriveActorContext({
    headers: {},
    userContext: { id: 'victim-user', identityAsserted: true },
  });
  assert.equal(asserted.userId, null);
  assert.equal(asserted.actorScope, 'anonymous',
    'the spoofable x-user-id fallback must not fabricate behavioural history about a named person');

  const proven = deriveActorContext({ headers: {}, userContext: { id: 'real-user' } });
  assert.equal(proven.userId, 'real-user');
  assert.equal(proven.actorScope, 'authenticated');
});

// ── Free-text PII smuggling ────────────────────────────────────────────────

test('an allowlisted string key only stores values matching a declared format', () => {
  // Previously any 128-character string passed, making `affordance`, `country`,
  // `step` and friends a free-text channel into a store retained for 24 months.
  const smuggled = projectMetadata('marketplace_contact_clicked', {
    affordance: 'alice@example.com +263771234567',
  });
  assert.deepEqual(smuggled, {}, 'an email must never reach the ledger');

  const legitimate = projectMetadata('marketplace_contact_clicked', { affordance: 'whatsapp' });
  assert.deepEqual(legitimate, { affordance: 'whatsapp' });
});

test('country and region accept codes, not sentences', () => {
  assert.deepEqual(projectMetadata('marketplace_listing_impression', { country: 'ZW' }), { country: 'ZW' });
  assert.deepEqual(projectMetadata('marketplace_listing_impression', { country: 'my home address is 12 Smith St' }), {});
});

// ── Numbers that could exceed 100% ─────────────────────────────────────────

test('a conversion rate above 100% is capped and says so', () => {
  // A lead arriving by WhatsApp never passed through a listing view, so the later
  // stage can genuinely exceed the earlier one. "136% of viewers enquired" is
  // nonsense; the cap is stated rather than hidden.
  const impossible = rate(30, 22);
  assert.equal(impossible.availability, AVAILABILITY.VALUE);
  assert.equal(impossible.value, 100);
  assert.equal(impossible.capped, true);
  assert.match(impossible.note, /skips it/);

  const normal = rate(5, 50);
  assert.equal(normal.value, 10);
  assert.ok(!normal.capped);
});

// ── Reads that silently truncated or silently zeroed ───────────────────────

test('rollup reads are paginated and refuse to publish a truncated day', () => {
  const src = read('backend/services/intelligence/rollupService.js');
  assert.match(src, /export async function readAllPages/);
  assert.match(src, /refusing to publish a truncated day/);
  // Every authority read goes through it.
  assert.match(src, /readAllPages\(\(\) => client\s*\n?\s*\.from\(LEDGER\)/);
});

test('an authority read failure fails the day instead of writing zeros', () => {
  const src = read('backend/services/intelligence/rollupService.js');
  assert.ok(!/if \(error\) return \[\];/.test(src),
    'swallowing a reservation read error wrote reservations: 0 into a completed run');
  assert.ok(!/if \(error\) return new Map\(\);/.test(src));
});

test('reservations count only ACTIVE reservations, per the contract', () => {
  const src = read('backend/services/intelligence/rollupService.js');
  assert.match(src, /String\(row\.status \|\| ''\) === 'active'/);
});

test('only vehicle-listing inquiries enter the marketplace rollup', () => {
  const src = read('backend/services/intelligence/rollupService.js');
  assert.match(src, /type === 'vehicle'/,
    'part/garage/import inquiries carry non-VIN listing ids and inflated platform leads');
});

// ── Seller identity ────────────────────────────────────────────────────────

test('the seller grain keys on the SELLER relationship, not the owner', () => {
  // marketplace_inquiries.seller_id is written from vehicles.current_seller_id, and
  // 32 of 38 staging vehicles have owner_id != current_seller_id — so keying on
  // owner_id zeroed the lead count for ~84% of listings.
  const src = read('backend/services/intelligence/rollupService.js');
  assert.match(src, /sellerUserId: sellerUserId \|\| ownerUserId/);
  assert.match(src, /current_seller_id/);
});

test('ownership proof accepts the seller as well as the owner', () => {
  const src = read('backend/services/intelligence/intelligenceProjectionService.js');
  assert.match(src, /sellsDirectly/,
    'the governed seller of a listing must be able to read its analytics');
});

test('the or-filter guards against an id that could rewrite the predicate', () => {
  const src = read('backend/services/intelligence/intelligenceProjectionService.js');
  assert.match(src, /SAFE_OR_VALUE/);
});

// ── Seller rows must exist for a lead-only day ─────────────────────────────

test('seller and tenant buckets cover every listing in play, not only those with events', () => {
  const src = read('backend/services/intelligence/rollupService.js');
  assert.match(src, /for \(const vin of listingIds\) \{/,
    'a lead arriving with no browsing produced no seller row, so the pulse showed all zeros');
});

// ── The rollup had no caller at all ────────────────────────────────────────

test('rollupDay is reachable from a mounted route', () => {
  const routes = read('backend/routes/intelligenceRollupRoutes.js');
  assert.match(routes, /rollupDay/);
  assert.match(routes, /'\/api\/internal\/intelligence\/rollup'/);
  const server = read('backend/server.js');
  assert.match(server, /app\.use\(intelligenceRollupRouter\)/,
    'without a caller every rollup table stays empty and every projection reports unavailable forever');
});

test('the rollup runner is privileged and its backfill is bounded', () => {
  const src = read('backend/routes/intelligenceRollupRoutes.js');
  assert.match(src, /workerAuthorized\(req\) && !adminAuthorized\(req\)/);
  assert.match(src, /timingSafeEqual/);
  assert.match(src, /MAX_BACKFILL_DAYS/);
});

// ── Freshness could never be satisfied ─────────────────────────────────────

test('freshness is judged on a day that could actually be complete', () => {
  // Gating on today meant a nightly job that correctly rolled up yesterday still
  // left every projection reporting unavailable, every day, forever.
  const src = read('backend/services/intelligence/intelligenceProjectionService.js');
  assert.match(src, /completable/);
});

// ── Erasure must not rewrite certified history ─────────────────────────────

test('erasure tombstones the identity but keeps the pseudonymous session key', () => {
  // Nulling the session key too meant recomputing an already-certified day AFTER an
  // erasure silently lowered its unique counts while total views stayed the same.
  const sql = read('database/migrations/20260827140000_intelligence_post_review_hardening.sql');
  const fn = sql.split('intelligence_erase_actor')[2] || sql;
  assert.match(sql, /SET authenticated_user_id = NULL,\s*\n\s*identity_erased_at = now\(\)/);
  assert.ok(!/identity_erased_at = now\(\),\s*\n\s*pseudonymous_session_key = NULL/.test(sql),
    'aggregates must be unaffected by erasure, as both the contract and the migration promise');
});

test('ingestion counters increment atomically', () => {
  const sql = read('database/migrations/20260827140000_intelligence_post_review_hardening.sql');
  assert.match(sql, /ON CONFLICT \(window_start\) DO UPDATE SET/);
  const src = read('backend/services/intelligence/activityLedgerService.js');
  assert.match(src, /rpc\('intelligence_bump_ingestion_stats'/,
    'a read-modify-write lost counts in the very module meant to make loss visible');
});

// ── Search demand could be understated without bound ───────────────────────

test('the search idempotency key includes the day', () => {
  // The unique index is global, so without a date the same device searching
  // "Toyota" tomorrow deduped against today and demand shrank silently.
  const src = read('backend/services/intelligence/marketplaceActivityEmitters.js');
  assert.match(src, /const utcDay = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
