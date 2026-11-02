/**
 * PC01-K2B — the operational-provenance authority and the Admin read paths converged onto it.
 *
 * Fixtures mirror the cohorts K2A found on staging (ids and domains only — no real address): the
 * genuine Serena owner, the governed UAT buyer whose automation vehicles carry realistic VINs, proof
 * and certification identities, and the ambiguous gmail cohorts that must stay UNKNOWN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  classifyIdentity, classifyVehicle, classifyInquiry, summarizeProvenance,
  NON_OPERATIONAL_IDENTITY_FAMILIES, RESERVED_TEST_EMAIL_DOMAINS, PROVENANCE_CLASSES, OPERATIONAL_CLASSES,
} = await import('../services/provenance/recordProvenance.js');
const { getFixtureExclusion } = await import('../services/marketplace/marketplaceClassificationRules.js');
const { getMarketplaceAnalytics } = await import('../services/marketplace/marketplaceAnalyticsService.js');
const { listListingsForAdmin, readListingProvenanceBase } = await import('../services/marketplace/marketplaceModerationService.js');
const { getCommandCentre } = await import('../services/intelligence/commandCentreService.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const now = new Date().toISOString();
const longAgo = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();

// ── Staging-shaped identities ──────────────────────────────────────────────────────────────────
const SERENA_OWNER = { id: 'u_66cace85aa11bb22', email: 'seller.person@gmail.com', name: 'Kingston M' };
const OWNER_ADMIN = { id: 'u_dec3e5f9aa11bb22', email: 'owner.admin@gmail.com', name: 'CarUp Owner' };
const UAT_BUYER = { id: 'u_e57adbc08131aa22', email: 'uat.buyer@carup-staging.test', name: 'UAT buyer [uat-20260718]' };
const PROOF_USER = { id: 'u_oc5rproof_37000000001_1', email: 'oc5r.proof.1@carup-staging.test', name: 'OC-5R deployed provider proof (staging automation)' };
const GOLDEN_SELLER = { id: 'u_golden_38195290534_1_chromium', email: 'golden.seller.1@carup-staging.test', name: 'Golden Dynamic Seller' };
const HILUX_OWNER = { id: 'u_129c2d5faa11bb22', email: 'someone@gmail.com', name: 'UAT Hilux seller' };
const CERT_GMAIL = { id: 'u_cert_email_1', email: 'cert.person@gmail.com', name: 'Email certification recipient' };

const SERENA = { vin: 'GFC27-027051', owner_id: SERENA_OWNER.id, make: 'Nissan', seller_description: 'This 2016 Nissan Serena Highway Star was recently imported.', status: 'Available', publication_status: 'publishable', created_at: now };
const AUTOMATION = { vin: 'JTDKARFP0H3000731', owner_id: UAT_BUYER.id, make: 'Toyota', seller_description: 'Golden Dynamic Seller seller-38195290534-1: server autosave survived', status: 'Sold', publication_status: 'published', created_at: now };
const MEDIA = { vin: 'JTMLCCA38195290534', owner_id: UAT_BUYER.id, make: 'Toyota', seller_description: 'Media lifecycle candidate media-38195290534-1. Three distinguishable photos', status: 'Sold', publication_status: 'published', created_at: now };
const UAT_OWNED_REALISTIC = { vin: 'JTDKARFP0H3000999', owner_id: UAT_BUYER.id, make: 'Toyota', seller_description: '', status: 'Available', publication_status: 'publishable', created_at: now };
const PROOF_VEHICLE = { vin: 'JTREL370000000011', owner_id: PROOF_USER.id, make: 'Toyota', seller_description: '', status: 'Available', publication_status: 'draft', created_at: now };
const HILUX = { vin: 'UAT2HILUX00000001', owner_id: HILUX_OWNER.id, make: 'Toyota', seller_description: 'It is a great asset, bought it clean', status: 'Available', publication_status: 'draft', created_at: now };
const SUBARU = { vin: 'JF1GPAL60J9UAT303', owner_id: null, make: 'Subaru', seller_description: '', status: 'Available', publication_status: 'publishable', created_at: now };

// ── Registry rules ─────────────────────────────────────────────────────────────────────────────
test('every class is governed; only real classes are operational and UNKNOWN never is', () => {
  assert.equal(PROVENANCE_CLASSES.length, 10);
  assert.deepEqual([...OPERATIONAL_CLASSES].sort(), ['historical_real', 'real_business_operational', 'real_owner_created']);
  assert.equal(OPERATIONAL_CLASSES.has('unknown_requires_review'), false);
});

test('each reserved test domain rule matches its domain and never a normal customer domain', () => {
  const sample = { 'reserved_domain:.test': 'carup-staging.test', 'reserved_domain:.invalid': 'carup-uat.invalid', 'reserved_domain:.local': 'staging.carup.local', 'reserved_domain:example.*': 'example.com' };
  for (const rule of RESERVED_TEST_EMAIL_DOMAINS) {
    assert.equal(classifyIdentity({ id: 'u_0123456789abcdef', email: `a@${sample[rule.rule]}`, name: 'A' }).rule, rule.rule);
  }
  for (const domain of ['gmail.com', 'yahoo.com', 'outlook.com', 'carup.dev', 'econet.co.zw', 'mytest.com', 'testing.co.zw', 'example.co.zw', 'invalid-motors.com']) {
    const r = classifyIdentity({ id: 'u_0123456789abcdef', email: `person@${domain}`, name: 'Tendai Moyo' });
    assert.equal(r.operational, true, `${domain} must not be treated as a test domain`);
  }
});

test('each registered identity family classifies its own convention, and only that', () => {
  const samples = {
    oc5r_provider_proof: 'u_oc5rproof_37000_1', phase7_golden_reference: 'golden-a-owner-stg', seller_golden_gate: 'u_golden_38195_1_mobile',
    o2_ocr_stage4: 'u_s4own_362964', deployed_staging_journey: 'uat-admin-1788', production_smoke: 'uat-prod-owner-1788',
    diaspora_staging_integration: 'stgtest_1788_ab12cd34_stock_actor', qa_staging_accounts: 'qa-staging-seller-73', trade_os_uat: 'u_tradeos_rfq_buyer',
    trade_os_t9_t10_uat: 't9uat-operator', operations_serena_uat: 'u_ops_uat_reviewer', issue164_uat: 'ISSUE164-UAT-OWNER', issue164_phase6_uat: 'P6F-SELLER',
    referral_v1_uat: 'refv1-staging-owner', trade_os_a12_uat: 'a12uat-agent', mobile_uat: 'u_mobile_owner_1788', operations_p7_uat: 'u_p7_applicant_1788', legacy_seed: 'u3',
  };
  for (const family of NON_OPERATIONAL_IDENTITY_FAMILIES) {
    const id = samples[family.family];
    assert.ok(id, `a regression sample exists for ${family.family}`);
    const r = classifyIdentity({ id, email: 'x@gmail.com', name: 'Person' });
    assert.equal(r.class, family.class, family.family);
    assert.equal(r.rule, `identity_family:${family.family}`);
    assert.equal(r.operational, false);
  }
  // A product-issued id never matches a family.
  assert.equal(classifyIdentity({ id: 'u_0123456789abcdef', email: 'p@gmail.com', name: 'Person' }).class, 'real_business_operational');
});

// ── Required behaviours ────────────────────────────────────────────────────────────────────────
test('1 · the genuine Serena owner and vehicle are operational', () => {
  const owner = classifyIdentity(SERENA_OWNER);
  assert.equal(owner.operational, true);
  assert.equal(owner.confidence, 'presumed');
  const v = classifyVehicle(SERENA, { owner: SERENA_OWNER });
  assert.equal(v.operational, true);
  assert.equal(getFixtureExclusion(SERENA), null, 'the frame number stays a valid identifier');
});

test('2/3 · certification / proof identities and their vehicles are not operational', () => {
  assert.equal(classifyIdentity(PROOF_USER).class, 'proof_certification');
  assert.equal(classifyVehicle(PROOF_VEHICLE, { owner: PROOF_USER }).class, 'proof_certification');
  assert.equal(classifyVehicle(PROOF_VEHICLE).operational, false, 'the owner id alone is enough');
  assert.equal(classifyIdentity(GOLDEN_SELLER).class, 'ci_automation');
});

test('4 · a realistic VIN owned by a known UAT identity stays non-operational', () => {
  assert.equal(getFixtureExclusion(UAT_OWNED_REALISTIC), null, 'its VIN is structurally valid');
  const r = classifyVehicle(UAT_OWNED_REALISTIC, { owner: UAT_BUYER });
  assert.equal(r.class, 'uat');
  assert.match(r.rule, /^creator:reserved_domain/);
  assert.equal(classifyVehicle(AUTOMATION, { owner: UAT_BUYER }).operational, false);
  assert.equal(classifyVehicle(MEDIA, { owner: UAT_BUYER }).class, 'uat', 'creator evidence outranks the run marker');
  assert.equal(classifyVehicle(MEDIA, { owner: SERENA_OWNER }).class, 'ci_automation', 'the run marker still decides for a presumed owner');
});

test('5 · a gmail address alone makes an identity neither real nor test; contradictions stay UNKNOWN', () => {
  assert.equal(classifyIdentity(HILUX_OWNER).class, 'unknown_requires_review');
  assert.equal(classifyIdentity(CERT_GMAIL).class, 'unknown_requires_review', 'non-product id, no registered family');
  assert.equal(classifyIdentity({ id: 'u_0123456789abcdef' }).class, 'unknown_requires_review', 'an id alone is not evidence');
  // The Hilux: a human-looking owner of a UAT-marked VIN stays UNKNOWN with the marker recorded.
  const hilux = classifyVehicle(HILUX, { owner: HILUX_OWNER });
  assert.equal(hilux.class, 'unknown_requires_review');
  assert.ok(hilux.signals.includes('vin_prefix_UAT'));
  assert.equal(classifyVehicle(SUBARU).class, 'unknown_requires_review', 'ownerless reference-media candidate');
  assert.equal(classifyVehicle({ vin: 'UATPHASE6SEDAN20A', make: 'UAT', owner_id: null }).class, 'uat');
});

test('inquiries: test askers are test; real-looking askers on test or missing listings need review', () => {
  const op = classifyVehicle(SERENA, { owner: SERENA_OWNER });
  const test1 = classifyInquiry({ guest_email: 'golden-1@example.test', listing_id: SERENA.vin, listing_type: 'vehicle' }, { listing: op });
  assert.equal(test1.class, 'uat', 'all 35 Serena inquiries came from test guests');
  const onTest = classifyInquiry({ guest_email: 'real@gmail.com', guest_name: 'Rudo', listing_id: AUTOMATION.vin, listing_type: 'vehicle' }, { listing: classifyVehicle(AUTOMATION, { owner: UAT_BUYER }) });
  assert.equal(onTest.class, 'unknown_requires_review');
  const missing = classifyInquiry({ guest_email: 'real@gmail.com', guest_name: 'Rudo', listing_id: 'VIN-GONE-1234567', listing_type: 'vehicle' }, { listing: null });
  assert.equal(missing.class, 'unknown_requires_review');
  // A guest has no account to evidence: a deliverable-looking guest is needs-review, never presumed
  // real (the staging gmail-guest cohort, 2026-06-17, is exactly this).
  const guest = classifyInquiry({ guest_email: 'buyer@gmail.com', guest_name: 'Rudo', listing_id: SERENA.vin, listing_type: 'vehicle' }, { listing: op });
  assert.equal(guest.class, 'unknown_requires_review');
  assert.equal(guest.rule, 'asker:guest_asker_unverified');
  const guestDiaspora = classifyInquiry({ guest_email: 'family@gmail.com', guest_name: 'Tariro', listing_type: 'diaspora_request' });
  assert.equal(guestDiaspora.class, 'unknown_requires_review', 'no listing does not make a guest real');
  // An inquiry from an evidenced ACCOUNT on an operational listing is operational.
  const account = classifyInquiry({ buyer_id: OWNER_ADMIN.id, listing_id: SERENA.vin, listing_type: 'vehicle' }, { buyer: OWNER_ADMIN, listing: op });
  assert.equal(account.operational, true);
});

test('summaries keep UNKNOWN separate from both operational and test', () => {
  const s = summarizeProvenance([classifyVehicle(SERENA, { owner: SERENA_OWNER }), classifyVehicle(AUTOMATION, { owner: UAT_BUYER }), classifyVehicle(SUBARU)]);
  assert.deepEqual({ raw: s.raw, operational: s.operational, excluded: s.excluded_non_operational, unknown: s.unknown_requires_review }, { raw: 3, operational: 1, excluded: 1, unknown: 1 });
});

// ── A generic read-only fake client (select / eq / in / order / range / limit) ─────────────────
function fakeClient(tables, { failTable = null } = {}) {
  const writes = [];
  const from = (table) => {
    let rows = [...(tables[table] || [])];
    const builder = {
      select() { return builder; },
      eq(k, v) { rows = rows.filter((r) => r[k] === v); return builder; },
      in(k, vals) { const set = new Set(vals.map(String)); rows = rows.filter((r) => set.has(String(r[k]))); return builder; },
      is() { return builder; }, order() { return builder; }, gte() { return builder; }, lte() { return builder; }, not() { return builder; },
      limit(n) { rows = rows.slice(0, n); return builder; },
      range(a, b) { rows = rows.slice(a, b + 1); return builder; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      update(p) { writes.push({ table, p }); return builder; }, insert(p) { writes.push({ table, p }); return builder; }, delete() { writes.push({ table, del: true }); return builder; },
      then(resolve, reject) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } }).then(resolve, reject);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: [], error: null }), writes };
}

const USERS = [SERENA_OWNER, OWNER_ADMIN, UAT_BUYER, PROOF_USER, GOLDEN_SELLER, HILUX_OWNER, CERT_GMAIL].map((u) => ({ ...u, created_at: now }));
const VEHICLES = [SERENA, AUTOMATION, MEDIA, UAT_OWNED_REALISTIC, PROOF_VEHICLE, HILUX, SUBARU];

test('6 · moderation and analytics read the same operational base population', async () => {
  const client = fakeClient({ users: USERS, vehicles: VEHICLES, marketplace_inquiries: [] });
  const base = await readListingProvenanceBase(client);
  const listings = await listListingsForAdmin(client, { actor: ADMIN });
  const analytics = await getMarketplaceAnalytics(client, ADMIN);
  const baseVins = base.operational.map((c) => c.vehicle.vin).sort();
  assert.deepEqual(listings.listings.map((l) => l.vin).sort(), baseVins);
  assert.equal(analytics.listings.total, baseVins.length);
  assert.deepEqual(baseVins, [SERENA.vin]);
  assert.deepEqual(listings.provenance.by_class, analytics.provenance.listings.by_class, 'the same set-aside, by class');
  assert.equal(listings.provenance.unknown_requires_review, 2, 'Hilux and Subaru are reported for review, not counted');
  assert.equal(client.writes.length, 0, 'classification never writes');
});

test('analytics reports unreadable inquiries as unavailable, never as zero', async () => {
  const analytics = await getMarketplaceAnalytics(fakeClient({ users: USERS, vehicles: VEHICLES }, { failTable: 'marketplace_inquiries' }), ADMIN);
  assert.equal(analytics.inquiries.available, false);
  assert.equal(analytics.inquiries.total, null);
  assert.match(analytics.inquiries.note, /NOT zero/);
});

// ── Command Centre ─────────────────────────────────────────────────────────────────────────────
const CC_TABLES = {
  users: USERS,
  organizations: [],
  vehicles: VEHICLES,
  marketplace_inquiries: [
    { id: 'i1', guest_email: 'golden-1@example.test', listing_id: SERENA.vin, listing_type: 'vehicle', created_at: now },
    { id: 'i2', guest_email: 'buyer@gmail.com', guest_name: 'Rudo', listing_id: SERENA.vin, listing_type: 'vehicle', created_at: now },
    { id: 'i3', buyer_id: OWNER_ADMIN.id, listing_id: SERENA.vin, listing_type: 'vehicle', created_at: now },
  ],
  marketplace_activity_events: [
    { id: 'e1', authenticated_user_id: null, listing_id: SERENA.vin, exclusion_flags: [], created_at: now },
    { id: 'e2', authenticated_user_id: null, listing_id: SERENA.vin, exclusion_flags: ['bot_suspect'], created_at: now },
    { id: 'e3', authenticated_user_id: UAT_BUYER.id, listing_id: SERENA.vin, exclusion_flags: ['self_traffic'], created_at: now },
    { id: 'e4', authenticated_user_id: null, listing_id: AUTOMATION.vin, exclusion_flags: [], created_at: now },
    { id: 'e5', authenticated_user_id: OWNER_ADMIN.id, listing_id: SERENA.vin, exclusion_flags: [], created_at: now },
  ],
  saved_vehicles: [
    { id: 's1', user_id: OWNER_ADMIN.id, vin: SERENA.vin, created_at: now },
    { id: 's2', user_id: OWNER_ADMIN.id, vin: SERENA.vin, created_at: longAgo },
    { id: 's3', user_id: UAT_BUYER.id, vin: SERENA.vin, created_at: now },
  ],
  vehicle_evidence: [
    { id: 'ev1', vin: SERENA.vin, verification_status: 'verified', created_at: now },
    { id: 'ev2', vin: AUTOMATION.vin, verification_status: 'pending', created_at: now },
  ],
  message_threads: [{ id: 't1', primary_user_id: SERENA_OWNER.id, created_at: now }, { id: 't2', primary_user_id: UAT_BUYER.id, created_at: now }],
  messages: [{ id: 'm1', thread_id: 't1', created_at: now }, { id: 'm2', thread_id: 't2', created_at: now }],
  escrow_trust_sessions: [{ id: 'x1', vin: SERENA.vin, status: 'settled', payment_provider_mode: 'sandbox', created_at: now }],
  insurance_claims: [],
};

test('7 · Command Centre Supply reads vehicles by vin and loads (vehicles have no id column)', async () => {
  const selected = [];
  const base = fakeClient(CC_TABLES);
  const client = { ...base, from: (t) => { const b = base.from(t); const sel = b.select; b.select = (cols) => { if (t === 'vehicles') selected.push(String(cols)); return sel(cols); }; return b; } };
  const result = await getCommandCentre(client, ADMIN);
  assert.equal(result.sections.supply.available, true, 'Supply is readable');
  assert.ok(selected.length > 0);
  for (const cols of selected) {
    const names = cols.split(',').map((c) => c.trim());
    assert.ok(names.includes('vin'));
    assert.ok(!names.includes('id'), `the vehicles projection must not ask for a nonexistent id column: ${cols}`);
  }
  const schema = fs.readFileSync(path.join(REPO, 'database/migrations/supabase_schema.sql'), 'utf8');
  const vehiclesTable = schema.match(/CREATE TABLE[^;]*?\bvehicles\s*\(([\s\S]*?)\);/i)?.[1] || '';
  assert.match(vehiclesTable, /\bvin\b[^,\n]*PRIMARY KEY/i, 'vin is the canonical vehicle identifier');
  assert.doesNotMatch(vehiclesTable, /^\s*id\s/im, 'the canonical vehicles table has no id column');
});

test('8 · Command Centre counts operational records only and states what it set aside', async () => {
  const { sections } = await getCommandCentre(fakeClient(CC_TABLES), ADMIN);
  assert.equal(sections.overview.metrics.users_total.value, 2, 'Serena owner + owner admin');
  assert.equal(sections.overview.provenance.unknown_requires_review, 2, 'Hilux owner + cert gmail');
  assert.equal(sections.supply.metrics.vehicles_total.value, 1);
  assert.equal(sections.supply.provenance.excluded_non_operational, 4);
  assert.equal(sections.demand.metrics.inquiries.value, 1, 'only the evidenced account on the genuine car');
  assert.equal(sections.demand.provenance.inquiries.unknown_requires_review, 1, 'the gmail guest needs review — counted on neither side');
  assert.equal(sections.trust_evidence.metrics.evidence_reviewed.value, 1);
  assert.equal(sections.trust_evidence.metrics.evidence_awaiting_review.value, 0, 'automation evidence is not a review backlog');
  assert.equal(sections.communications.metrics.threads.value, 1);
  assert.equal(sections.communications.metrics.messages.value, 1);
  assert.equal(sections.transactions.metrics.sessions_opened.value, 0, 'a sandbox session is not business');
  assert.equal(sections.overview.metrics.organizations_total.value, 0);
});

test('9 · self / bot / test-actor / test-object activity is not business engagement; anonymous activity is not separable', async () => {
  const { sections } = await getCommandCentre(fakeClient(CC_TABLES), ADMIN);
  const p = sections.demand.provenance.behavioural_events;
  assert.deepEqual(
    { read: p.records_read, operational: p.operational, excluded: p.excluded_non_operational, review: p.unknown_requires_review },
    { read: 5, operational: 1, excluded: 3, review: 1 },
    'bot, self-traffic and the view of an automation car are excluded; the anonymous view of Serena needs review',
  );
  // With unseparable anonymous activity in the period, no business figure is stated.
  assert.equal(sections.demand.metrics.behavioural_events.availability, 'unavailable');
  assert.equal(sections.demand.metrics.behavioural_events.value, null);
  assert.equal(sections.demand.metrics.behavioural_events.reason, 'anonymous_activity_not_separable');

  // When every event is evidenced, the figure is the measured operational engagement.
  const evidenced = { ...CC_TABLES, marketplace_activity_events: CC_TABLES.marketplace_activity_events.filter((e) => e.id !== 'e1' && e.id !== 'e4') };
  const clean = await getCommandCentre(fakeClient(evidenced), ADMIN);
  assert.equal(clean.sections.demand.metrics.behavioural_events.value, 1, 'only the owner-admin view of the genuine car');
});

test('10 · the windowed Saved metric is actually windowed', async () => {
  const { sections } = await getCommandCentre(fakeClient(CC_TABLES), ADMIN);
  assert.equal(sections.demand.metrics.saved_vehicles.value, 1, 'the out-of-window save and the UAT save are not counted');
  assert.equal(sections.demand.provenance.saved_vehicles.records_read, 2, 'read within the window only');
});

test('a non-empty organisation count that cannot be separated is unavailable, not a business number', async () => {
  const { sections } = await getCommandCentre(fakeClient({ ...CC_TABLES, organizations: [{ id: 'o1', created_at: now }] }), ADMIN);
  assert.equal(sections.overview.metrics.organizations_total.availability, 'unavailable');
  assert.equal(sections.overview.metrics.organizations_total.value, null);
});

test('11 · a read failure is an unreadable section, never a zero — and only where it matters', async () => {
  const { sections } = await getCommandCentre(fakeClient(CC_TABLES, { failTable: 'vehicles' }), ADMIN);
  for (const key of ['supply', 'demand', 'trust_evidence', 'transactions', 'risk']) {
    assert.equal(sections[key].unreadable, true, `${key} classifies through vehicles and must not report zeros`);
    assert.match(sections[key].note, /NOT zero/);
  }
  assert.equal(sections.overview.available, true, 'users-only sections still answer');
  assert.equal(sections.communications.available, true);
  const usersDown = await getCommandCentre(fakeClient(CC_TABLES, { failTable: 'users' }), ADMIN);
  assert.equal(usersDown.sections.overview.unreadable, true);
  assert.equal(usersDown.sections.supply.unreadable, true, 'vehicle provenance needs the creators');
});

test('12 · Suspend User is retired: both endpoints answer the product gap and write nothing', () => {
  const routes = fs.readFileSync(path.join(REPO, 'backend/routes/adminRoutes.js'), 'utf8');
  for (const anchor of ["router.post('/api/users/:id/suspend'", "router.patch('/api/admin/users/:id/suspend'"]) {
    const start = routes.indexOf(anchor);
    assert.ok(start >= 0, anchor);
    const block = routes.slice(start, routes.indexOf('});', start) + 3);
    assert.match(block, /status\(501\)/);
    assert.doesNotMatch(block, /\.update\(/, 'no suspension write');
    assert.doesNotMatch(block, /role:\s*'suspended'/, 'role is never repurposed');
  }
  assert.match(routes, /ACCOUNT SUSPENSION — PRODUCT \/ AUTHORITY GAP/);
});
