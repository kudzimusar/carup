/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2 / R5 — physical phase SIX setup (after the accepted retraction phase).
 *
 * Adds exactly two EXPLICITLY FICTIONAL accounts to the disposable loopback database:
 *  - an independent CarUp vehicle-document reviewer (platform admin; NOT a dealership member,
 *    claimant, legal officer or storefront reviewer), because the canonical evidence verify route is
 *    admin/government-only;
 *  - a separate fictional buyer (member) who will send one canonical Marketplace enquiry.
 * It writes NO vehicle, evidence, listing, inquiry or decision: every one of those is created by the
 * real browser through the real application in synthetic-vin-listing.pw.ts.
 * Test-only: never reachable from production routes, never against a shared database.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { assertLocalDatabase } from './importResearchSeed.mjs';

const url = assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const purl = new URL(url);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(purl.hostname));
assert.equal(purl.pathname, '/carup_dealer_isolated_ci');
assert.equal(purl.search, '');
assert.equal(purl.hash, '');
for (const k of ['CARUP_DEALER_RESEARCH_XLSX', 'DEALER_SEED_DATABASE_URL', 'SUPABASE_URL']) {
  assert.equal(process.env[k], undefined, 'unsafe real data/DB environment ' + k);
}
const fpath = process.env.DEALER_BROWSER_FIXTURE_JSON;
assert.ok(fpath, 'fixture JSON required');
const f = JSON.parse(readFileSync(fpath, 'utf8'));
assert.equal(f.source_type, 'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(f.source_population, 104);
assert.equal(f.synthetic_legal_policy_provenance, 'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY');
const LISTING_VIN = 'SYNTHR4P02DLR0001';

const db = new pg.Client({ connectionString: url, ssl: false,
  application_name: 'CARUP_FICTIONAL_ONLY_LISTING_PHASE_ACTORS' });
await db.connect();
try {
  const link = (await db.query(`SELECT l.tenant_id, l.claimant_user_id, l.operating_status
      FROM dealer_approved_seed_links l WHERE l.seed_dealer_id = $1`, [f.seed])).rows;
  assert.equal(link.length, 1, 'one activated fictional dealer');
  assert.equal(link[0].operating_status, 'ACTIVE');
  assert.equal(link[0].claimant_user_id, f.actors.claimant.id);
  const tenant = link[0].tenant_id;
  const pre = (await db.query(`SELECT
      dealer_tenant_listing_authority_current($1::uuid) AS authority_current,
      (SELECT count(*)::int FROM vehicles WHERE tenant_id = $1::uuid AND publication_status = 'published') AS published,
      (SELECT count(*)::int FROM vehicles WHERE vin = $2) AS listing_vin_rows,
      (SELECT count(*)::int FROM dealer_full_storefront_current WHERE seed_dealer_id = $3) AS current_storefronts,
      (SELECT count(*)::int FROM dealer_listing_authority_events) AS listing_events`,
  [tenant, LISTING_VIN, f.seed])).rows[0];
  // The accepted retraction phase must have left: authority current, zero public stock, the
  // storefront retracted, and no listing custody yet.
  assert.deepEqual(pre, { authority_current: true, published: 0, listing_vin_rows: 0,
    current_storefronts: 0, listing_events: 0 }, 'phase-six preconditions');

  // Ensure disposable loopback service_role has explicit table privileges on R5 tables
  await db.query(`GRANT SELECT, INSERT, UPDATE ON
    dealer_storefront_media_items,
    dealer_storefront_media_review_events,
    dealer_research_correction_requests,
    dealer_research_correction_review_events,
    dealer_research_duplicate_redirects
    TO service_role`);
  await db.query(`GRANT SELECT ON dealer_public_storefront_media_current TO anon, authenticated, service_role`);

  const reviewer = { id: 'vehiclereviewer1', name: 'Fictional CarUp Vehicle Document Reviewer',
    email: 'fictional-vehicle-reviewer@example.invalid', role: 'admin' };
  const buyer = { id: 'vehiclebuyer1', name: 'Fictional Marketplace Buyer',
    email: 'fictional-marketplace-buyer@example.invalid', role: 'member' };
  for (const actor of [reviewer, buyer]) {
    await db.query(`INSERT INTO users(id, role, is_verified, name, email)
      VALUES ($1, $2, true, $3, $4)`, [actor.id, actor.role, actor.name, actor.email]);
  }
  // Independence is structural, not asserted by name: neither account holds any dealership role.
  const membership = (await db.query(`SELECT count(*)::int AS n FROM tenant_users
      WHERE user_id IN ($1, $2)`, [reviewer.id, buyer.id])).rows[0].n;
  assert.equal(membership, 0);
  for (const actor of [reviewer, buyer]) {
    const token = 'fictional-listing-phase-' + actor.id + '-' + randomUUID();
    await db.query(`INSERT INTO user_sessions(token, user_id, active_role, is_valid, expires_at)
      VALUES ($1, $2, $3, true, (now() + interval '3 hours')::text)`, [token, actor.id, actor.role]);
    f.actors[actor === reviewer ? 'vehicle_reviewer' : 'vehicle_buyer'] = { ...actor, token };
  }
  f.listing_vin = LISTING_VIN;
  f.listing_phase_provenance = 'CI_ONLY_FICTIONAL_DEALER_STOCK_NOT_A_REAL_VEHICLE';
  writeFileSync(fpath, JSON.stringify(f), { mode: 0o600 });
  console.log('DEALER_SYNTHETIC_LISTING_PHASE_READY PASS: fictional independent vehicle reviewer + separate fictional buyer; 0 public stock, storefront retracted, authority current; no vehicle/evidence/inquiry pre-seeded');
} finally {
  await db.end();
}
