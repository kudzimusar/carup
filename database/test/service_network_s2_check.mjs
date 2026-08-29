/**
 * Service Network S2 — Canonical Service Case migration proof.
 *
 * Proves 20260901130000_service_network_s2_service_cases.sql against REAL
 * PostgreSQL (PGlite, PG17 WASM), layered on the real 002 tenants shape and
 * the real S1 garage identity migration:
 *   1. RLS posture: ENABLE + FORCE, ZERO policies, anon/authenticated hold
 *      nothing, service_role holds all four (plus the events sequence);
 *   2. the status CHECK admits exactly the six frozen Service Case states;
 *   3. the idempotent marketplace bridge is a DATABASE guarantee: a second
 *      case for the same source_inquiry_id raises 23505, while many cases
 *      with NO inquiry origin coexist (partial index, NULLs distinct);
 *   4. cross-authority FKs hold (vin, garage tenant, branch);
 *   5. service_case_events is genuinely append-only — UPDATE and DELETE are
 *      refused by a trigger, not merely by convention;
 *   6. Down drops cleanly and re-Up applies.
 *
 * Run:  node database/test/service_network_s2_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260901120000_service_network_s1_garage_identity.sql';
const S2 = '20260901130000_service_network_s2_service_cases.sql';

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
const real002 = splitMigration('002_multi_tenant_and_auth_schema.sql');

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real 002 Up applies', () => db.exec(real002.up));
await must('S1 Up applies (garage identity is a prerequisite)', () => db.exec(s1.up));
await must('S2 Up applies', () => db.exec(s2.up));

await must('service_cases carries the frozen S0 semantic fields', async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='service_cases'`)).map(r => r.column_name);
  for (const c of ['id','vin','garage_tenant_id','branch_id','requester_user_id','source_inquiry_id',
    'source_channel','conversation_thread_id','status','service_category','request_summary',
    'decline_reason_code','cancellation_reason_code','requested_at','accepted_at','declined_at',
    'started_at','completed_at','cancelled_at','accepted_by_user_id','created_by_user_id','created_at','updated_at']) {
    if (!cols.includes(c)) throw new Error(`missing column ${c}`);
  }
});

// ── RLS posture ──
for (const t of ['service_cases','service_case_events']) {
  await must(`${t}: RLS ENABLED + FORCED`, async () => {
    const [r] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${t}'`);
    if (!r.relrowsecurity || !r.relforcerowsecurity) throw new Error(JSON.stringify(r));
  });
  await must(`${t}: ZERO policies`, async () => {
    const [r] = await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid='${t}'::regclass`);
    if (r.n !== 0) throw new Error(`${r.n} policies`);
  });
  for (const role of ['anon','authenticated']) {
    await must(`${t}: ${role} holds NO privileges`, async () => {
      const [r] = await q(`SELECT bool_or(has_table_privilege('${role}','${t}',p)) any_priv
        FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
      if (r.any_priv) throw new Error(`${role} has privileges`);
    });
  }
  await must(`${t}: service_role cannot DELETE (history is retained)`, async () => {
    const [r] = await q(`SELECT bool_and(has_table_privilege('service_role','${t}',p)) all_priv
      FROM unnest(ARRAY['SELECT','INSERT']) p`);
    if (!r.all_priv) throw new Error('service_role missing a required privilege');
    const [del] = await q(`SELECT has_table_privilege('service_role','${t}','DELETE') can_delete`);
    if (del.can_delete) throw new Error('DELETE is granted — history could be destroyed');
  });
}
await must('service_case_events sequence: service_role usable, clients revoked', async () => {
  const [r] = await q(`SELECT
    has_sequence_privilege('service_role','service_case_events_id_seq','USAGE') svc,
    has_sequence_privilege('anon','service_case_events_id_seq','USAGE') anon_usage,
    has_sequence_privilege('authenticated','service_case_events_id_seq','USAGE') auth_usage`);
  if (!r.svc) throw new Error('service_role cannot use the sequence');
  if (r.anon_usage || r.auth_usage) throw new Error('a client role can use the sequence');
});

// ── seed ──
await must('seed vehicle, users, tenants, branch', () => db.exec(`
  INSERT INTO users(id, role) VALUES ('u-owner','owner'), ('u-garage','mechanic');
  INSERT INTO vehicles(vin, owner_id) VALUES ('VINCASE0001','u-owner');
  INSERT INTO tenants(id, name, type) VALUES
    ('${TENANT}','Harare Motors','garage'),
    ('${OTHER_TENANT}','Bulawayo Auto','garage');
  INSERT INTO garage_branches(id, tenant_id, name)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','${TENANT}','Main Workshop');
`));

// ── cross-authority FKs ──
await mustReject('a case for an unknown VIN is FK-rejected (vehicle stays canonical)',
  `INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id)
   VALUES ('NOSUCHVIN','${TENANT}','u-owner')`, '23503');
await mustReject('a case for an unknown garage tenant is FK-rejected',
  `INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id)
   VALUES ('VINCASE0001','99999999-9999-9999-9999-999999999999','u-owner')`, '23503');

await must('a valid case inserts and defaults to requested', async () => {
  await db.exec(`INSERT INTO service_cases(id, vin, garage_tenant_id, branch_id, requester_user_id, created_by_user_id, source_channel)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','VINCASE0001','${TENANT}','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','u-owner','u-owner','directory')`);
  const [r] = await q(`SELECT status, requested_at, accepted_at FROM service_cases WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'`);
  if (r.status !== 'requested') throw new Error(`default status ${r.status}`);
  if (!r.requested_at) throw new Error('requested_at not stamped');
  if (r.accepted_at !== null) throw new Error('accepted_at must start NULL');
});

await mustReject('the status CHECK refuses states outside the frozen six',
  `UPDATE service_cases SET status='in_progress' WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'`, '23514');
await must('all six frozen states are admitted', async () => {
  for (const s of ['accepted','active','completed','declined','cancelled','requested']) {
    await db.exec(`UPDATE service_cases SET status='${s}' WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'`);
  }
});

// ── the idempotent marketplace bridge ──
await must('a case may originate from a marketplace inquiry', () => db.exec(`
  INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id, source_inquiry_id, source_channel)
  VALUES ('VINCASE0001','${TENANT}','u-owner','inq-1','marketplace')`));
await mustReject('a RETRY on the same inquiry cannot create a second case (23505)',
  `INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id, source_inquiry_id, source_channel)
   VALUES ('VINCASE0001','${TENANT}','u-owner','inq-1','marketplace')`, '23505');
await mustReject('not even a DIFFERENT garage may re-consume the same inquiry',
  `INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id, source_inquiry_id, source_channel)
   VALUES ('VINCASE0001','${OTHER_TENANT}','u-owner','inq-1','marketplace')`, '23505');
await must('many cases with NO inquiry origin coexist (partial index, NULLs distinct)', async () => {
  await db.exec(`INSERT INTO service_cases(vin, garage_tenant_id, created_by_user_id) VALUES
    ('VINCASE0001','${TENANT}','u-owner'), ('VINCASE0001','${TENANT}','u-owner')`);
  const [r] = await q(`SELECT count(*)::int n FROM service_cases WHERE source_inquiry_id IS NULL`);
  if (r.n < 3) throw new Error(`expected >=3 inquiry-less cases, got ${r.n}`);
});

// ── branch integrity is a DATABASE guarantee ──
await must('give the second garage its own branch', () => db.exec(`
  INSERT INTO garage_branches(id, tenant_id, name)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','${OTHER_TENANT}','Their Workshop');
`));
await mustReject("garage B's branch cannot be attached to garage A's case",
  `INSERT INTO service_cases(vin, garage_tenant_id, branch_id, created_by_user_id)
   VALUES ('VINCASE0001','${TENANT}','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','u-owner')`, '23503');
await must("garage A's own branch attaches fine", () => db.exec(`
  INSERT INTO service_cases(vin, garage_tenant_id, branch_id, created_by_user_id)
  VALUES ('VINCASE0001','${TENANT}','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','u-owner')`));

// ── retention: unrelated deletes cannot erase service history ──
await mustReject('deleting the VEHICLE is refused while service history exists',
  `DELETE FROM vehicles WHERE vin='VINCASE0001'`, '23503');
await mustReject('deleting the GARAGE TENANT is refused while service history exists',
  `DELETE FROM tenants WHERE id='${TENANT}'`, '23503');
await must('every service case survived the deletion attempts', async () => {
  const [r] = await q(`SELECT count(*)::int n FROM service_cases`);
  if (r.n < 5) throw new Error(`service cases were destroyed: ${r.n}`);
});

// ── append-only history ──
await must('a transition event can be appended', () => db.exec(`
  INSERT INTO service_case_events(service_case_id, event_type, from_status, to_status, actor_user_id, actor_tenant_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','service.case.accepted','requested','accepted','u-garage','${TENANT}')`));
await mustReject('history cannot be UPDATED (append-only trigger, not convention)',
  `UPDATE service_case_events SET to_status='cancelled' WHERE service_case_id='cccccccc-cccc-cccc-cccc-cccccccccccc'`,
  'append-only');
await mustReject('history cannot be DELETED',
  `DELETE FROM service_case_events WHERE service_case_id='cccccccc-cccc-cccc-cccc-cccccccccccc'`,
  'append-only');

await mustReject('a case cannot be deleted while it carries recorded history',
  `DELETE FROM service_cases WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'`, '23503');

// ── Down / re-Up ──
await must('S2 Down drops cleanly', () => db.exec(s2.down));
await must('tables and trigger function gone after Down', async () => {
  const t = await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('service_cases','service_case_events')`);
  if (t.length) throw new Error(`still present: ${t.map(r=>r.table_name)}`);
  const f = await q(`SELECT proname FROM pg_proc WHERE proname='service_case_events_append_only'`);
  if (f.length) throw new Error('trigger function survived Down');
});
await must('S2 re-Up applies (idempotent after rollback)', () => db.exec(s2.up));

await db.close();
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S2 migration checks passed.');
process.exit(0);
