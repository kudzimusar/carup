/**
 * The column names the Intelligence services actually query.
 *
 * The I19 live certification run caught a defect no unit test could: both the
 * next-best-action service and the AI context service selected
 * `marketplace_inquiries.current_seller_id`, a column that does not exist. That is
 * the VEHICLES column which the inquiry's `seller_id` is written FROM — the two
 * are related, similarly named, and easy to confuse.
 *
 * Every unit test passed because the test doubles compare JavaScript object keys
 * and never enforce a schema. Against the real database both endpoints failed on
 * every request. They failed CLOSED — returning `unavailable` with the Postgres
 * error as the reason rather than a false zero — which is the programme's
 * discipline working, but it meant two features were dead in production while
 * looking healthy in CI.
 *
 * This test pins the specific confusion so it cannot recur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const DIR = path.join(REPO, 'backend/services/intelligence');

/** Comments are stripped: the fix for this very defect is documented in a comment
 *  that names the wrong column, and a raw search would flag the explanation. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const sources = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, codeOnly(fs.readFileSync(path.join(DIR, f), 'utf8'))]);

/**
 * Extract each `.from('table')` and the `.select(...)` / `.eq('col', …)` that
 * follow it, so a column can be attributed to the table it was asked of.
 */
function queriesAgainst(source, table) {
  const blocks = [];
  const re = new RegExp(`\\.from\\('${table}'\\)`, 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    const rest = source.slice(m.index + m[0].length, m.index + m[0].length + 600);
    // Stop at the next `.from(` so one query's window cannot bleed into the next.
    const next = rest.indexOf('.from(');
    blocks.push(next === -1 ? rest : rest.slice(0, next));
  }
  return blocks;
}

test('no Intelligence service asks marketplace_inquiries for current_seller_id', () => {
  // The inquiry table keys its seller as `seller_id`. `current_seller_id` belongs
  // to `vehicles`, and asking for it here fails every read.
  for (const [name, source] of sources) {
    for (const block of queriesAgainst(source, 'marketplace_inquiries')) {
      assert.ok(
        !/current_seller_id/.test(block),
        `${name} queries marketplace_inquiries for current_seller_id, which does not exist`,
      );
    }
  }
});

test('the seller-scoped services key inquiries on seller_id', () => {
  for (const name of ['recommendationService.js', 'aiIntelligenceContextService.js']) {
    const source = codeOnly(fs.readFileSync(path.join(DIR, name), 'utf8'));
    const blocks = queriesAgainst(source, 'marketplace_inquiries');
    assert.ok(blocks.length > 0, `${name} should read marketplace_inquiries`);
    for (const block of blocks) {
      assert.ok(/\.eq\('seller_id'/.test(block), `${name} must scope inquiries by seller_id`);
    }
  }
});

test('vehicles is still queried by its own key, which IS current_seller_id', () => {
  // The inverse mistake would be just as wrong: `vehicles` has no `seller_id`.
  for (const [name, source] of sources) {
    for (const block of queriesAgainst(source, 'vehicles')) {
      assert.ok(
        !/\.eq\('seller_id'/.test(block),
        `${name} queries vehicles by seller_id; that table uses current_seller_id`,
      );
    }
  }
});

test('every table an Intelligence service reads is one that exists', () => {
  // A misspelt table fails the same way a misspelt column does, and just as
  // invisibly under test doubles.
  // Every entry verified to exist in the live staging schema on 2026-08-28.
  const known = new Set([
    'diaspora_import_orders', 'diaspora_import_quotes', 'diaspora_payment_milestones',
    'eligibility_requests', 'escrow_trust_sessions', 'finance_applications',
    'insurance_claims', 'insurer_profiles', 'lender_profiles', 'listing_daily_metrics',
    'listing_images', 'marketplace_activity_events', 'marketplace_inquiries',
    'mechanic_parts', 'mechanic_work_orders', 'message_threads', 'messages',
    'organization_audit_logs', 'organizations', 'partsentry_logs',
    'platform_daily_metrics', 'provider_registry', 'referral_campaigns',
    'referral_codes', 'referral_events', 'referral_wallet_transactions',
    'saved_vehicles', 'seller_daily_metrics', 'source_verification_results',
    'tenant_daily_metrics', 'trust_audit_events', 'users', 'vehicle_evidence',
    'vehicle_reservations', 'vehicles', 'verification_decisions',
    'intelligence_recommendation_state', 'intelligence_ingestion_stats',
    'intelligence_rollup_runs',
    // Service Network obligation O3. Created by
    // database/migrations/20260904130000_service_network_s2_service_cases.sql, whose Up/Down/re-Up
    // is executed against real PostgreSQL by database/test/service_network_s2_check.mjs in CI — so
    // this entry is verified by an applied migration, not by assertion.
    'service_cases',
  ]);;
  const unknown = new Set();
  for (const [, source] of sources) {
    for (const m of source.matchAll(/\.from\('([a-z_]+)'\)/g)) {
      if (!known.has(m[1])) unknown.add(m[1]);
    }
  }
  assert.deepEqual([...unknown], [],
    'an Intelligence service reads a table not in the known set — verify it exists before adding it here');
});
