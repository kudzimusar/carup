/**
 * CarUp Intelligence 1.0 — I3 server-side marketplace instrumentation.
 *
 * The point of these tests is that the observation is anchored to the AUTHORITY:
 * a save event keyed on the saved row's own created_at, an inquiry keyed on the
 * inquiry id, a view keyed on the shopper's page view. Anchoring is what lets a
 * retry be a no-op instead of a second "sale", so it is asserted directly rather
 * than inferred from the fact that some row was written.
 *
 * They also pin the two honesty properties that are easy to lose later: a
 * re-save of an already-saved listing must observe NOTHING (the watchlist did not
 * move), and an open with no client context must be SKIPPED AND COUNTED rather
 * than collapsed into a shared key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  normalizeSearchFilters,
  hashQueryText,
  isPrefetch,
  clientContextFrom,
  emitSearchPerformed,
  emitListingOpened,
  emitListingSaved,
  emitListingUnsaved,
  emitInquiryCreated,
} from '../services/intelligence/marketplaceActivityEmitters.js';
import { saveListing, unsaveListing } from '../services/marketplace/marketplaceSavedService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const VIN = 'JTDKB20U403001234';
const OWNER = 'user-seller-1';
const TENANT = 'tenant-alpha';

function createFakeClient({ vehicles = [{ vin: VIN, owner_id: OWNER, tenant_id: TENANT }], saved = [] } = {}) {
  const inserted = [];
  const stats = [];
  const savedRows = [...saved];
  const client = {
    inserted, stats, savedRows,
    from(table) {
      const api = {
        _table: table, _filters: {}, _deleting: false,
        select() {
          if (api._deleting) {
            const match = savedRows.filter((r) => r.user_id === api._filters.user_id && r.vin === api._filters.vin);
            match.forEach((r) => savedRows.splice(savedRows.indexOf(r), 1));
            return Promise.resolve({ data: match, error: null });
          }
          if (table === 'saved_vehicles') {
            const match = savedRows.filter((r) => (
              (api._filters.user_id === undefined || r.user_id === api._filters.user_id)
              && (api._filters.vin === undefined || r.vin === api._filters.vin)
            ));
            const p = Promise.resolve({ data: match, error: null });
            p.eq = () => p;
            return p;
          }
          return api;
        },
        eq(column, value) { api._filters[column] = value; return api; },
        gte() { return api; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() {
          if (table === 'vehicles') {
            return Promise.resolve({ data: vehicles.find((v) => v.vin === api._filters.vin) || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() { return Promise.resolve({ data: null, error: null }); },
        insert(row) { if (table === 'saved_vehicles') savedRows.push(row); return Promise.resolve({ data: row, error: null }); },
        delete() { api._deleting = true; return api; },
        upsert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (table === 'intelligence_ingestion_stats') {
            stats.push(...list);
            return Promise.resolve({ data: list, error: null });
          }
          inserted.push(...list);
          const result = { data: list.map((r) => ({ id: r.idempotency_key })), error: null };
          return { select: () => Promise.resolve(result), then: (r) => r(result) };
        },
      };
      return api;
    },
  };
  return client;
}

const reqWithContext = (extra = {}) => ({
  headers: {
    'x-carup-session-key': 'session-shopper001',
    'x-carup-page-view': 'pageview-detail01',
    'user-agent': 'Mozilla/5.0',
    ...(extra.headers || {}),
  },
  query: extra.query || {},
  body: extra.body || {},
  userContext: extra.userContext,
});

// ── Search normalization ────────────────────────────────────────────────────

test('search filters keep bounded catalogue VALUES; free text is only ever hashed', () => {
  const filters = normalizeSearchFilters({
    make: 'Toyota', minPrice: '5000', maxPrice: 18000, condition: 'locally_used',
    tag: 'trusted,inspected', sort: 'price_asc', q: 'clean hilux for my family',
  });
  assert.equal(filters.make, 'Toyota');
  assert.equal(filters.minPrice, 5000);
  assert.equal(filters.maxPrice, 18000);
  assert.equal(filters.tag, 'inspected,trusted', 'tags are order-normalized so the same set groups identically');
  // The shopper's words are a person's words: grouped, never stored.
  assert.ok(!JSON.stringify(filters).includes('family'));
  const hash = hashQueryText('clean hilux for my family');
  assert.equal(hash.length, 32);
  assert.equal(hash, hashQueryText('  CLEAN HILUX FOR MY FAMILY '), 'hash is case/whitespace stable');
  assert.equal(hashQueryText('   '), null);
});

test('a bare listing fetch with no query and no filters is browsing, not a search', async () => {
  const client = createFakeClient();
  const result = await emitSearchPerformed(reqWithContext(), { query: {}, resultCount: 12, client });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'not_a_search');
  assert.equal(client.inserted.length, 0);
});

test('a zero-result search emits BOTH the search and the zero-result supply signal', async () => {
  const client = createFakeClient();
  await emitSearchPerformed(reqWithContext(), {
    query: { make: 'Lamborghini' }, resultCount: 0, client,
  });
  const types = client.inserted.map((r) => r.event_type).sort();
  assert.deepEqual(types, ['marketplace_search_performed', 'marketplace_search_zero_results']);
  const keys = new Set(client.inserted.map((r) => r.idempotency_key));
  assert.equal(keys.size, 2, 'the two events must not share a key');
});

test('a search with results emits only the search event', async () => {
  const client = createFakeClient();
  await emitSearchPerformed(reqWithContext(), { query: { make: 'Toyota' }, resultCount: 7, client });
  assert.deepEqual(client.inserted.map((r) => r.event_type), ['marketplace_search_performed']);
  assert.equal(client.inserted[0].metadata.result_count, 7);
});

// ── Listing opened: the gap I0 found ────────────────────────────────────────

test('an ORGANIC view (no referral code) is now recorded — the I0 gap is closed', async () => {
  const client = createFakeClient();
  const result = await emitListingOpened(reqWithContext(), { vin: VIN, client });
  assert.equal(result.recorded, true);
  const row = client.inserted[0];
  assert.equal(row.event_type, 'marketplace_listing_opened');
  assert.equal(row.metadata.attributed, false, 'organic views are recorded AND marked unattributed');
  assert.equal(row.tenant_id, TENANT, 'scope follows the listing');
});

test('an attributed view is recorded once, and marked attributed', async () => {
  const client = createFakeClient();
  await emitListingOpened(
    reqWithContext({ query: { ref: 'REF123', campaign: 'CAMP1' } }),
    { vin: VIN, client },
  );
  const row = client.inserted[0];
  assert.equal(row.metadata.attributed, true);
  assert.equal(row.referral_code, 'REF123');
  assert.equal(row.campaign_code, 'CAMP1');
});

test('a browser prefetch is not a person looking, and is not counted', async () => {
  assert.equal(isPrefetch({ 'sec-purpose': 'prefetch;prerender' }), true);
  assert.equal(isPrefetch({ purpose: 'prefetch' }), true);
  assert.equal(isPrefetch({ 'x-carup-prefetch': '1' }), true);
  assert.equal(isPrefetch({ 'user-agent': 'Mozilla/5.0' }), false);

  const client = createFakeClient();
  const result = await emitListingOpened(
    reqWithContext({ headers: { 'sec-purpose': 'prefetch' } }), { vin: VIN, client },
  );
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'prefetch');
  assert.equal(client.inserted.length, 0);
});

test('an open with no client context is SKIPPED and COUNTED, never collapsed into a shared key', async () => {
  const client = createFakeClient();
  const result = await emitListingOpened({ headers: {}, query: {} }, { vin: VIN, client });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'no_client_context');
  assert.equal(client.inserted.length, 0, 'a contextless open must not become an event');
  // The undercount is measurable rather than invisible.
  assert.equal(client.stats.length, 1);
  assert.equal(client.stats[0].opened_without_context, 1);
});

test('two opens in one page view are one view; a new page view is a new view', async () => {
  const client = createFakeClient();
  await emitListingOpened(reqWithContext(), { vin: VIN, client });
  await emitListingOpened(reqWithContext(), { vin: VIN, client });
  const sameViewKeys = new Set(client.inserted.map((r) => r.idempotency_key));
  assert.equal(sameViewKeys.size, 1, 'a refresh within one page view is not a second view');

  await emitListingOpened(
    reqWithContext({ headers: { 'x-carup-page-view': 'pageview-detail02' } }), { vin: VIN, client },
  );
  assert.equal(new Set(client.inserted.map((r) => r.idempotency_key)).size, 2);
});

// ── Saves: anchored to the authority row ────────────────────────────────────

test('a save observation is keyed on the saved row\'s own created_at', async () => {
  const client = createFakeClient();
  const savedAt = '2026-08-27T10:00:00.000Z';
  await emitListingSaved({ userId: 'buyer-1', vin: VIN, savedAt, client });
  await emitListingSaved({ userId: 'buyer-1', vin: VIN, savedAt, client });
  assert.equal(new Set(client.inserted.map((r) => r.idempotency_key)).size, 1,
    'replaying the same authority row must not create a second save');
});

test('a save with no authority timestamp refuses to write', async () => {
  const client = createFakeClient();
  const result = await emitListingSaved({ userId: 'buyer-1', vin: VIN, savedAt: null, client });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'missing_authority_material');
  assert.equal(client.inserted.length, 0);
});

test('save and unsave of the same listing are distinct observations', async () => {
  const client = createFakeClient();
  const savedAt = '2026-08-27T10:00:00.000Z';
  await emitListingSaved({ userId: 'buyer-1', vin: VIN, savedAt, client });
  await emitListingUnsaved({ userId: 'buyer-1', vin: VIN, savedAt, client });
  assert.equal(new Set(client.inserted.map((r) => r.idempotency_key)).size, 2);
  assert.deepEqual(client.inserted.map((r) => r.event_type),
    ['marketplace_listing_saved', 'marketplace_listing_unsaved']);
});

// ── Save service wiring: the real path, not an injected fake ────────────────

test('saving through the real service emits exactly one save observation', async () => {
  const client = createFakeClient();
  await saveListing(client, VIN, { id: 'buyer-1' });
  await new Promise((r) => setImmediate(r));
  const saveEvents = client.inserted.filter((r) => r.event_type === 'marketplace_listing_saved');
  assert.equal(saveEvents.length, 1);
  assert.equal(saveEvents[0].vehicle_reference, VIN);
});

test('re-saving an already-saved listing observes NOTHING (the watchlist did not move)', async () => {
  const client = createFakeClient({
    saved: [{ user_id: 'buyer-1', vin: VIN, created_at: '2026-08-01T00:00:00.000Z' }],
  });
  await saveListing(client, VIN, { id: 'buyer-1' });
  await new Promise((r) => setImmediate(r));
  assert.equal(client.inserted.filter((r) => r.event_type === 'marketplace_listing_saved').length, 0,
    'a no-op save must not report interest that never happened');
});

test('unsaving through the real service emits an unsave keyed on the DELETED row', async () => {
  const client = createFakeClient({
    saved: [{ user_id: 'buyer-1', vin: VIN, created_at: '2026-08-01T00:00:00.000Z' }],
  });
  await unsaveListing(client, VIN, { id: 'buyer-1' });
  await new Promise((r) => setImmediate(r));
  const events = client.inserted.filter((r) => r.event_type === 'marketplace_listing_unsaved');
  assert.equal(events.length, 1);
  assert.equal(client.savedRows.length, 0, 'the authority row is gone');
});

test('unsaving something that was never saved observes nothing', async () => {
  const client = createFakeClient({ saved: [] });
  await unsaveListing(client, VIN, { id: 'buyer-1' });
  await new Promise((r) => setImmediate(r));
  assert.equal(client.inserted.filter((r) => r.event_type === 'marketplace_listing_unsaved').length, 0);
});

test('unsaveListing uses delete-RETURNING, because a deleted row cannot be swept later', () => {
  const src = fs.readFileSync(path.join(REPO, 'backend/services/marketplace/marketplaceSavedService.js'), 'utf8');
  assert.match(src, /\.delete\(\)[\s\S]{0,120}\.select\('vin, created_at'\)/,
    'the deleted row must be returned or the unsave observation is unrecoverable');
});

// ── Inquiries ───────────────────────────────────────────────────────────────

test('an inquiry observation is keyed on the inquiry id and scoped from the authority row', async () => {
  const client = createFakeClient();
  const inquiry = {
    id: 'inq-100', listing_id: VIN, seller_tenant_id: TENANT, buyer_id: 'buyer-9',
    inquiry_type: 'vehicle_purchase_interest', status: 'new', source_channel: 'web',
  };
  await emitInquiryCreated(inquiry, { client });
  await emitInquiryCreated(inquiry, { client });
  const rows = client.inserted.filter((r) => r.event_type === 'marketplace_inquiry_created');
  assert.equal(new Set(rows.map((r) => r.idempotency_key)).size, 1, 'a replayed inquiry is one lead');
  assert.equal(rows[0].tenant_id, TENANT, 'scope comes from the inquiry row, needing no extra read');
  assert.equal(rows[0].privacy_class, 'P3', 'a declared lead is P3, not P1');
});

test('an inspection-type inquiry also emits the inspection funnel stage', async () => {
  const client = createFakeClient();
  await emitInquiryCreated({
    id: 'inq-200', listing_id: VIN, seller_tenant_id: TENANT,
    inquiry_type: 'vehicle_inspection_request', status: 'new',
  }, { client });
  const types = client.inserted.map((r) => r.event_type).sort();
  assert.deepEqual(types, ['marketplace_inquiry_created', 'marketplace_inspection_requested']);
});

test('a non-inspection inquiry does not manufacture an inspection', async () => {
  const client = createFakeClient();
  await emitInquiryCreated({
    id: 'inq-300', listing_id: VIN, seller_tenant_id: TENANT,
    inquiry_type: 'vehicle_purchase_interest', status: 'new',
  }, { client });
  assert.ok(!client.inserted.some((r) => r.event_type === 'marketplace_inspection_requested'));
});

test('an inquiry with no id refuses to write rather than inventing a key', async () => {
  const client = createFakeClient();
  const result = await emitInquiryCreated({ listing_id: VIN }, { client });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'missing_inquiry_id');
});

// ── Failure posture ─────────────────────────────────────────────────────────

test('every emitter swallows failure: a broken ledger never breaks the marketplace', async () => {
  const exploding = {
    from() { throw new Error('database on fire'); },
  };
  const results = await Promise.all([
    emitSearchPerformed(reqWithContext(), { query: { make: 'Toyota' }, resultCount: 1, client: exploding }),
    emitListingOpened(reqWithContext(), { vin: VIN, client: exploding }),
    emitListingSaved({ userId: 'b', vin: VIN, savedAt: 'x', client: exploding }),
    emitListingUnsaved({ userId: 'b', vin: VIN, savedAt: 'x', client: exploding }),
    emitInquiryCreated({ id: 'i', listing_id: VIN }, { client: exploding }),
  ]);
  for (const result of results) assert.equal(result.recorded, false);
});

test('client context extraction ignores malformed keys rather than storing them', () => {
  const ctx = clientContextFrom({
    headers: {
      'x-carup-session-key': 'buyer@example.com',
      'x-carup-page-view': '../../etc/passwd',
      'x-carup-platform': 'ios',
    },
  });
  assert.equal(ctx.sessionKey, null, 'an email-shaped key must never become a session key');
  assert.equal(ctx.pageViewId, null);
  assert.equal(ctx.platform, 'ios');
});

// ── Wiring: the emitters must actually be called by the product paths ───────

test('the marketplace routes call the view and search emitters', () => {
  const src = fs.readFileSync(path.join(REPO, 'backend/routes/marketplaceRoutes.js'), 'utf8');
  assert.match(src, /emitListingOpened\(req, \{ vin:/);
  assert.match(src, /emitSearchPerformed\(req, \{ query: req\.query/);
  // The save/unsave routes must thread req through, or a save can never be
  // stage-linked to the view that preceded it.
  assert.match(src, /saveListing\(supabase, req\.params\.id, req\.userContext, \{ req \}\)/);
  assert.match(src, /unsaveListing\(supabase, req\.params\.id, req\.userContext, \{ req \}\)/);
  assert.match(src, /createInquiry\(supabase, payload, req\.userContext \|\| null, \{ req \}\)/);
});

test('the inquiry service calls the inquiry emitter on the real creation path', () => {
  const src = fs.readFileSync(path.join(REPO, 'backend/services/marketplace/marketplaceInquiryService.js'), 'utf8');
  assert.match(src, /import \{ emitInquiryCreated \} from '\.\.\/intelligence\/marketplaceActivityEmitters\.js'/);
  assert.match(src, /emitInquiryCreated\(inserted, \{ req: deps\.req \|\| null, client \}\)/);
});

test('the legacy referral-conditional view event is preserved, not replaced', () => {
  const src = fs.readFileSync(path.join(REPO, 'backend/routes/marketplaceRoutes.js'), 'utf8');
  // The referral engine keeps its own workflow record; Intelligence does not
  // repurpose or delete another lane's ledger.
  assert.match(src, /marketplace_listing_viewed/);
  assert.match(src, /marketplaceReferralBridge/);
});
