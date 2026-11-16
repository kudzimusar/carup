/**
 * Service Network S8 — Service Link and capability grant migration proof.
 *
 * Proves 20260904170000_service_network_s8_service_links.sql against REAL PostgreSQL:
 *   1. RLS posture on both tables (service-role-only, FORCE, zero policies);
 *   2. a resource has exactly ONE stable link (23505 on a duplicate);
 *   3. resource_type CHECKs refuse anything outside the governed vocabularies —
 *      notably that a capability cannot be minted over an insurance/finance resource;
 *   4. the capability purpose CHECK is closed;
 *   5. token_hash uniqueness (only hashes are ever stored);
 *   6. Down/re-Up round trip.
 *
 * Run:  node database/test/service_network_s8_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260904120000_service_network_s1_garage_identity.sql';
const S2 = '20260904130000_service_network_s2_service_cases.sql';
const S4 = '20260904150000_service_network_s4_work_order_assignment.sql';
const S5 = '20260904160000_service_network_s5_service_records.sql';
const S8 = '20260904170000_service_network_s8_service_links.sql';

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  if (!raw.includes('-- +migrate Up')) throw new Error(`${file}: missing "-- +migrate Up" marker`);
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down };
}

const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  -- pglite (PG17) has gen_random_uuid() in core; shim the uuid-ossp name 002 uses.
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, role TEXT, is_verified BOOLEAN DEFAULT false
  );
  -- 002's own seed maps user 'u3' into the seed tenant; that user pre-existed in production.
  INSERT INTO users(id, name, role) VALUES ('u3','Croco Dealer','dealer') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS vehicles (
    vin TEXT PRIMARY KEY, owner_id TEXT, trust_score NUMERIC, status TEXT
  );
  -- Pre-002 legacy tables 002 ALTERs (represent pre-existing production schema):
  CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT, type TEXT);
  CREATE TABLE IF NOT EXISTS safepay_escrows (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS partsentry_logs (id BIGSERIAL PRIMARY KEY, vin TEXT);
  CREATE TABLE IF NOT EXISTS blockchain_events (id BIGSERIAL PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS finance_applications (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS insurance_records (id TEXT PRIMARY KEY);
`;

let failures = 0;
const db = new PGlite();
async function must(label, fn) {
  try { await fn(); console.log(`OK   ${label}`); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
async function mustReject(label, sql, codeOrMsg) {
  try { await db.exec(sql); failures++; console.error(`FAIL ${label}: statement unexpectedly succeeded`); }
  catch (e) {
    const s = `${e.code || ''} ${e.message}`;
    if (codeOrMsg && !s.includes(codeOrMsg)) { failures++; console.error(`FAIL ${label}: rejected but wrong error (${s})`); }
    else console.log(`OK   ${label}`);
  }
}
const q = async (sql) => (await db.query(sql)).rows;





const s1 = splitMigration(S1);
const s2 = splitMigration(S2);
const s8 = splitMigration(S8);
const real002 = splitMigration('002_multi_tenant_and_auth_schema.sql');
const TENANT = '11111111-1111-1111-1111-111111111111';

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real 002 + S1 + S2 apply (prerequisites)', async () => {
  await db.exec(real002.up); await db.exec(s1.up); await db.exec(s2.up);
});
await must('S8 Up applies', () => db.exec(s8.up));
await must('seed tenant and user', () => db.exec(`
  INSERT INTO users(id, role) VALUES ('u-owner','owner');
  INSERT INTO tenants(id, name, type) VALUES ('${TENANT}','Harare Motors','garage');
`));

for (const t of ['service_links','service_capability_grants']) {
  await must(`${t}: service-role-only, FORCE RLS, zero policies`, async () => {
    const [r] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${t}'`);
    if (!r.relrowsecurity || !r.relforcerowsecurity) throw new Error(JSON.stringify(r));
    const [p] = await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid='${t}'::regclass`);
    if (p.n !== 0) throw new Error(`${p.n} policies`);
    const [priv] = await q(`SELECT bool_or(has_table_privilege(role,'${t}',p)) any_priv
      FROM unnest(ARRAY['anon','authenticated']) role, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
    if (priv.any_priv) throw new Error('a client role holds privileges');
  });
}

await must('a resource gets a link', () => db.exec(`
  INSERT INTO service_links(public_token, resource_type, resource_id, created_by_user_id)
  VALUES ('tok-1','vehicle','VINLINK00001','u-owner')`));
await mustReject('a resource cannot have TWO links (one stable address)',
  `INSERT INTO service_links(public_token, resource_type, resource_id, created_by_user_id)
   VALUES ('tok-2','vehicle','VINLINK00001','u-owner')`, '23505');
await mustReject('two resources cannot share a public token',
  `INSERT INTO service_links(public_token, resource_type, resource_id, created_by_user_id)
   VALUES ('tok-1','vehicle','OTHERVIN','u-owner')`, '23505');
await mustReject('an ungoverned resource type is refused',
  `INSERT INTO service_links(public_token, resource_type, resource_id, created_by_user_id)
   VALUES ('tok-3','insurance_policy','POL-1','u-owner')`, '23514');
await must('all three governed resource types are admitted', () => db.exec(`
  INSERT INTO service_links(public_token, resource_type, resource_id, created_by_user_id) VALUES
    ('tok-4','service_case','cccccccc-cccc-cccc-cccc-cccccccccccc','u-owner'),
    ('tok-5','practitioner','u-mech-1','u-owner')`));

await must('a capability grant stores only a hash and always expires', () => db.exec(`
  INSERT INTO service_capability_grants(token_hash, purpose, resource_type, resource_id, granted_by_user_id, expires_at)
  VALUES ('hash-1','service_context_read','vehicle','VINLINK00001','u-owner', NOW() + INTERVAL '4 hours')`));
await mustReject('two grants cannot share a token hash',
  `INSERT INTO service_capability_grants(token_hash, purpose, resource_type, resource_id, granted_by_user_id, expires_at)
   VALUES ('hash-1','service_context_read','vehicle','VINLINK00001','u-owner', NOW() + INTERVAL '1 hour')`, '23505');
await mustReject('a capability cannot be minted for an ungoverned purpose',
  `INSERT INTO service_capability_grants(token_hash, purpose, resource_type, resource_id, granted_by_user_id, expires_at)
   VALUES ('hash-2','do_anything','vehicle','VINLINK00001','u-owner', NOW() + INTERVAL '1 hour')`, '23514');
await mustReject('a capability cannot be minted over a finance/insurance resource',
  `INSERT INTO service_capability_grants(token_hash, purpose, resource_type, resource_id, granted_by_user_id, expires_at)
   VALUES ('hash-3','service_context_read','finance_application','FA-1','u-owner', NOW() + INTERVAL '1 hour')`, '23514');
await mustReject('expires_at is mandatory — no standing access',
  `INSERT INTO service_capability_grants(token_hash, purpose, resource_type, resource_id, granted_by_user_id)
   VALUES ('hash-4','service_context_read','vehicle','VINLINK00001','u-owner')`, '23502');

await must('S8 Down drops cleanly', () => db.exec(s8.down));
await must('tables gone after Down', async () => {
  const t = await q(`SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('service_links','service_capability_grants')`);
  if (t.length) throw new Error(`survived: ${t.map(r=>r.table_name)}`);
});
await must('S8 re-Up applies (idempotent after rollback)', () => db.exec(s8.up));

await db.close();
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S8 migration checks passed.');
process.exit(0);
