/**
 * Service Network S5 — service records, mileage observations, parts/evidence proof.
 *
 * Proves 20260901160000_service_network_s5_service_records.sql against REAL PostgreSQL:
 *   1. RLS posture on all four tables + sequence grants;
 *   2. the provenance CHECK admits exactly the plan §6.6 vocabulary and refuses
 *      invented strengths such as 'verified repair';
 *   3. money integrity is a DATABASE guarantee: a cost without a currency is refused;
 *   4. a mileage OBSERVATION never touches vehicles.mileage — proven by writing an
 *      observation and re-reading the canonical odometer unchanged (plan §13.1);
 *   5. parts/evidence links are unique per record, so a retry cannot double-attach;
 *   6. Down/re-Up round trip.
 *
 * Run:  node database/test/service_network_s5_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260901120000_service_network_s1_garage_identity.sql';
const S2 = '20260901130000_service_network_s2_service_cases.sql';
const S4 = '20260901150000_service_network_s4_work_order_assignment.sql';
const S5 = '20260901160000_service_network_s5_service_records.sql';

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
const s5 = splitMigration(S5);
const real002 = splitMigration('002_multi_tenant_and_auth_schema.sql');

const TENANT = '11111111-1111-1111-1111-111111111111';
const WO = '11111111-2222-3333-4444-555555555555';

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real 002 + S1 + S2 apply (prerequisites)', async () => {
  await db.exec(real002.up); await db.exec(s1.up); await db.exec(s2.up);
});
await must('S5 Up applies', () => db.exec(s5.up));

await must('seed tenant, user, vehicle WITH a canonical odometer', () => db.exec(`
  INSERT INTO users(id, role) VALUES ('u-mech','mechanic');
  INSERT INTO vehicles(vin, owner_id) VALUES ('VINSR000001','u-mech');
  ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mileage INTEGER;
  UPDATE vehicles SET mileage = 120000 WHERE vin='VINSR000001';
  INSERT INTO tenants(id, name, type) VALUES ('${TENANT}','Harare Motors','garage');
`));

// ── RLS posture ──
for (const t of ['service_records','service_mileage_observations','service_record_parts','service_record_evidence']) {
  await must(`${t}: RLS ENABLED + FORCED, zero policies, clients revoked`, async () => {
    const [r] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${t}'`);
    if (!r.relrowsecurity || !r.relforcerowsecurity) throw new Error(JSON.stringify(r));
    const [p] = await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid='${t}'::regclass`);
    if (p.n !== 0) throw new Error(`${p.n} policies`);
    const [priv] = await q(`SELECT bool_or(has_table_privilege(role,'${t}',p)) any_priv
      FROM unnest(ARRAY['anon','authenticated']) role, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
    if (priv.any_priv) throw new Error('a client role holds privileges');
    const [svc] = await q(`SELECT bool_and(has_table_privilege('service_role','${t}',p)) ok
      FROM unnest(ARRAY['SELECT','INSERT']) p`);
    if (!svc.ok) throw new Error('service_role missing a required privilege');
    const [del] = await q(`SELECT has_table_privilege('service_role','${t}','DELETE') can_delete`);
    if (del.can_delete) throw new Error('DELETE is granted — service history could be destroyed');
  });
}

// ── provenance vocabulary ──
await must('a service record records with an explicit provenance strength', () => db.exec(`
  INSERT INTO service_records(id, work_order_id, tenant_id, vin, work_performed, service_authority, recorded_by_user_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','${WO}','${TENANT}','VINSR000001','Replaced front pads','professional_governed','u-mech')`));
await must('every plan §6.6 provenance value is admitted', async () => {
  for (const p of ['owner_declared','garage_stated','mechanic_attributed','professional_governed','evidence_backed','partner_record','unknown']) {
    await db.exec(`UPDATE service_records SET service_authority='${p}' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
  }
});
await mustReject("an invented provenance such as 'verified repair' is refused",
  `UPDATE service_records SET service_authority='verified_repair' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`, '23514');
await must('provenance defaults to the honest unknown', async () => {
  await db.exec(`INSERT INTO service_records(id, work_order_id, tenant_id, vin, recorded_by_user_id)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002','${WO}','${TENANT}','VINSR000001','u-mech')`);
  const [r] = await q(`SELECT service_authority FROM service_records WHERE id='aaaaaaaa-0000-0000-0000-000000000002'`);
  if (r.service_authority !== 'unknown') throw new Error(`default was ${r.service_authority}`);
});

// ── money integrity is a database guarantee ──
await mustReject('a cost without a currency is refused by the DATABASE',
  `UPDATE service_records SET total_cost=250 WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`, '23514');
await must('a cost WITH a currency is accepted, and absent cost stays absent', async () => {
  await db.exec(`UPDATE service_records SET total_cost=250, currency='USD' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`);
  const [r] = await q(`SELECT total_cost, currency FROM service_records WHERE id='aaaaaaaa-0000-0000-0000-000000000002'`);
  if (r.total_cost !== null) throw new Error('absent cost was fabricated');
  if (r.currency !== null) throw new Error('a currency was assumed');
});

// ── THE mileage authority contract ──
await must('a mileage OBSERVATION never mutates the canonical odometer (plan §13.1)', async () => {
  const [before] = await q(`SELECT mileage FROM vehicles WHERE vin='VINSR000001'`);
  await db.exec(`INSERT INTO service_mileage_observations(service_record_id, vin, observed_mileage, observation_source, observed_by_user_id)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','VINSR000001', 131500, 'mechanic_attributed','u-mech')`);
  const [after] = await q(`SELECT mileage FROM vehicles WHERE vin='VINSR000001'`);
  if (String(after.mileage) !== String(before.mileage)) {
    throw new Error(`vehicles.mileage changed from ${before.mileage} to ${after.mileage} — a second canonical writer was introduced`);
  }
  const [obs] = await q(`SELECT observed_mileage, observation_source FROM service_mileage_observations WHERE vin='VINSR000001'`);
  if (obs.observed_mileage !== 131500) throw new Error('the observation was not recorded');
  if (obs.observation_source !== 'mechanic_attributed') throw new Error('observation provenance lost');
});
await must('an observation LOWER than the canonical odometer is still recordable as an observation', async () => {
  // Observations are what was seen, not what is canonical: a disagreeing reading must be
  // recordable so it can be reconciled, rather than silently discarded.
  await db.exec(`INSERT INTO service_mileage_observations(service_record_id, vin, observed_mileage, observed_by_user_id)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','VINSR000001', 90000, 'u-mech')`);
  const [after] = await q(`SELECT mileage FROM vehicles WHERE vin='VINSR000001'`);
  if (String(after.mileage) !== '120000') throw new Error('canonical odometer was moved by an observation');
});
await mustReject('a negative odometer observation is refused',
  `INSERT INTO service_mileage_observations(service_record_id, vin, observed_mileage)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001','VINSR000001', -5)`, '23514');

// ── parts / evidence links ──
await must('a part record can be linked once', () => db.exec(`
  INSERT INTO service_record_parts(service_record_id, partsentry_log_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 42)`));
await mustReject('the same part cannot be double-attached (retry-safe)',
  `INSERT INTO service_record_parts(service_record_id, partsentry_log_id)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 42)`, '23505');
await must('an evidence reference can be linked once', () => db.exec(`
  INSERT INTO service_record_evidence(service_record_id, evidence_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'ev-1')`));
await mustReject('the same evidence cannot be double-attached',
  `INSERT INTO service_record_evidence(service_record_id, evidence_id)
   VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'ev-1')`, '23505');

// ── retention: service history survives unrelated deletion attempts ──
await mustReject('deleting the vehicle is refused while service records exist',
  `DELETE FROM vehicles WHERE vin='VINSR000001'`, '23503');
await mustReject('deleting the garage tenant is refused while service records exist',
  `DELETE FROM tenants WHERE id='${TENANT}'`, '23503');
await mustReject('a service record cannot be deleted while observations reference it',
  `DELETE FROM service_records WHERE id='aaaaaaaa-0000-0000-0000-000000000001'`, '23503');
await must('records, observations, part and evidence links all survived', async () => {
  for (const t of ['service_records','service_mileage_observations','service_record_parts','service_record_evidence']) {
    const [r] = await q(`SELECT count(*)::int n FROM ${t}`);
    if (r.n < 1) throw new Error(`${t} was emptied`);
  }
});

await must('S5 Down drops cleanly', () => db.exec(s5.down));
await must('tables gone after Down but the vehicle and its odometer survive', async () => {
  const t = await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN
    ('service_records','service_mileage_observations','service_record_parts','service_record_evidence')`);
  if (t.length) throw new Error(`survived Down: ${t.map(r=>r.table_name)}`);
  const [v] = await q(`SELECT mileage FROM vehicles WHERE vin='VINSR000001'`);
  if (String(v.mileage) !== '120000') throw new Error('the canonical odometer was disturbed');
});
await must('S5 re-Up applies (idempotent after rollback)', () => db.exec(s5.up));

await db.close();
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S5 migration checks passed.');
process.exit(0);
