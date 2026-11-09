/**
 * Service Network S1 — Governed Garage Identity & Publication migration proof.
 *
 * Proves 20260904120000_service_network_s1_garage_identity.sql against REAL
 * PostgreSQL (PGlite, PG17 WASM) on top of the REAL 002 tenants shape:
 *   1. bootstrap roles/auth + users, shim uuid_generate_v4, apply real 002 Up;
 *   2. apply S1 Up — tables exist with frozen columns;
 *   3. RLS posture: ENABLE + FORCE, ZERO policies, anon/authenticated hold no
 *      privilege, service_role holds all four;
 *   4. behaviour: tenant FK enforced, publication_status CHECK enforced,
 *      slug uniqueness raises 23505, branch (tenant_id, name) uniqueness,
 *      draft default;
 *   5. Down drops cleanly, re-Up applies (idempotent after rollback).
 *
 * Run:  node database/test/service_network_s1_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260904120000_service_network_s1_garage_identity.sql';

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
const real002 = splitMigration('002_multi_tenant_and_auth_schema.sql');

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real 002 Up applies (tenants authority shape, not a hand-made stub)', () => db.exec(real002.up));
await must('S1 Up applies', () => db.exec(s1.up));

// --- catalog: tables + frozen columns ---
await must('garage_public_profiles has the frozen S0 columns', async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='garage_public_profiles'`)).map(r => r.column_name);
  for (const c of ['tenant_id','display_name','slug','publication_status','description','location_city','location_province','contact_policy','public_phone','service_categories','verification_dimensions','public_media','published_at','created_by_user_id','created_at','updated_at'])
    if (!cols.includes(c)) throw new Error(`missing column ${c}`);
});
await must('garage_branches has the frozen S0 columns', async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='garage_branches'`)).map(r => r.column_name);
  for (const c of ['id','tenant_id','name','location_city','location_province','address_public','is_active','created_at','updated_at'])
    if (!cols.includes(c)) throw new Error(`missing column ${c}`);
});

// --- RLS posture (S0 template: service-role-only, zero client policies) ---
for (const t of ['garage_public_profiles','garage_branches']) {
  await must(`${t}: RLS ENABLED + FORCED`, async () => {
    const [r] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${t}'`);
    if (!r.relrowsecurity || !r.relforcerowsecurity) throw new Error(JSON.stringify(r));
  });
  await must(`${t}: ZERO policies (default-deny for clients)`, async () => {
    const [r] = await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid='${t}'::regclass`);
    if (r.n !== 0) throw new Error(`${r.n} policies found`);
  });
  for (const role of ['anon','authenticated']) {
    await must(`${t}: ${role} holds NO privileges`, async () => {
      const [r] = await q(`SELECT bool_or(has_table_privilege('${role}','${t}',p)) any_priv
        FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
      if (r.any_priv) throw new Error(`${role} has privileges`);
    });
  }
  await must(`${t}: service_role holds SELECT/INSERT/UPDATE but NOT DELETE`, async () => {
    const [r] = await q(`SELECT bool_and(has_table_privilege('service_role','${t}',p)) all_priv
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) p`);
    if (!r.all_priv) throw new Error('service_role missing a required privilege');
    const [del] = await q(`SELECT has_table_privilege('service_role','${t}','DELETE') can_delete`);
    if (del.can_delete) throw new Error('DELETE is granted — history could be destroyed');
  });
}

// --- behaviour ---
await must('seed tenant + user', () => db.exec(`
  INSERT INTO users(id, role) VALUES ('u-garage-admin','mechanic');
  INSERT INTO tenants(id, name, type) VALUES ('11111111-1111-1111-1111-111111111111','Harare Motors','garage');
`));
await mustReject('profile insert with unknown tenant is FK-rejected',
  `INSERT INTO garage_public_profiles(tenant_id, display_name, slug, created_by_user_id)
   VALUES ('99999999-9999-9999-9999-999999999999','Ghost Garage','ghost-garage','u-garage-admin')`, '23503');
await must('profile insert for real tenant succeeds, defaults to draft', async () => {
  await db.exec(`INSERT INTO garage_public_profiles(tenant_id, display_name, slug, created_by_user_id)
    VALUES ('11111111-1111-1111-1111-111111111111','Harare Motors','harare-motors','u-garage-admin')`);
  const [r] = await q(`SELECT publication_status, contact_policy, published_at FROM garage_public_profiles WHERE slug='harare-motors'`);
  if (r.publication_status !== 'draft') throw new Error(`default status ${r.publication_status}`);
  if (r.contact_policy !== 'in_app_only') throw new Error(`default contact ${r.contact_policy}`);
  if (r.published_at !== null) throw new Error('published_at should be NULL on draft');
});
await mustReject('publication_status CHECK rejects invented states',
  `UPDATE garage_public_profiles SET publication_status='live' WHERE slug='harare-motors'`, '23514');
await mustReject('contact_policy CHECK rejects invented policies',
  `UPDATE garage_public_profiles SET contact_policy='whatsapp_public' WHERE slug='harare-motors'`, '23514');
await mustReject('slug uniqueness is a DATABASE guarantee (23505)',
  `INSERT INTO garage_public_profiles(tenant_id, display_name, slug, created_by_user_id)
   SELECT id, 'Dup', 'harare-motors', 'u-garage-admin' FROM tenants LIMIT 1`, '23505');
await mustReject('one profile per tenant is a DATABASE guarantee',
  `INSERT INTO garage_public_profiles(tenant_id, display_name, slug, created_by_user_id)
   VALUES ('11111111-1111-1111-1111-111111111111','Second Profile','harare-motors-2','u-garage-admin')`, '23505');
await must('branch insert scoped to tenant succeeds', () => db.exec(`
  INSERT INTO garage_branches(tenant_id, name, location_city)
  VALUES ('11111111-1111-1111-1111-111111111111','Main Workshop','Harare')`));
await mustReject('branch (tenant_id, name) uniqueness enforced',
  `INSERT INTO garage_branches(tenant_id, name)
   VALUES ('11111111-1111-1111-1111-111111111111','Main Workshop')`, '23505');

// --- Down / re-Up ---
await must('S1 Down drops cleanly', () => db.exec(s1.down));
await must('tables gone after Down', async () => {
  const rows = await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('garage_public_profiles','garage_branches')`);
  if (rows.length) throw new Error(`still present: ${rows.map(r=>r.table_name)}`);
});
await must('S1 re-Up applies (idempotent after rollback)', () => db.exec(s1.up));

// Close PGlite and exit explicitly: the WASM runtime otherwise settles on its own
// teardown status (observed: 100) even after every check passed, which would make this
// harness's CI verdict depend on interpreter teardown rather than on the checks.
await db.close();

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S1 migration checks passed.');
process.exit(0);
