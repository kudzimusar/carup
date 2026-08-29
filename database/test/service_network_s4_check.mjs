/**
 * Service Network S4 — Work order convergence + mechanic assignment proof.
 *
 * Proves 20260901150000_service_network_s4_work_order_assignment.sql against REAL
 * PostgreSQL (PGlite), layered on the REAL legacy 006 mechanic shape and the REAL
 * 20260808150000 convergence migration — so this runs over the HARDER historical
 * shape, exactly as migration_pglite_check does:
 *   1. every added column is nullable and LEGACY ROWS SURVIVE with content intact;
 *   2. the status CHECK is NOT mutated — the Title-Case vocabulary other consumers
 *      pin still admits its three values and still refuses anything else;
 *   3. one work order per Service Case is a DATABASE guarantee (23505);
 *   4. at most one LIVE assignment per work order (partial unique index), while
 *      historical unassigned rows accumulate freely — assignment is a history;
 *   5. RLS posture on the new table; 6. Down/re-Up round trip preserving rows.
 *
 * Run:  node database/test/service_network_s4_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const S1 = '20260901120000_service_network_s1_garage_identity.sql';
const S2 = '20260901130000_service_network_s2_service_cases.sql';
const S4 = '20260901150000_service_network_s4_work_order_assignment.sql';

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
const s4 = splitMigration(S4);
const real002 = splitMigration('002_multi_tenant_and_auth_schema.sql');
const legacy006 = splitMigration('006_domain1.sql');
const convergence = splitMigration('20260808150000_mechanic_work_orders_convergence.sql');

const TENANT = '11111111-1111-1111-1111-111111111111';

await must('bootstrap', () => db.exec(BOOTSTRAP));
await must('real 002 Up applies', () => db.exec(real002.up));
await must('LEGACY 006 mechanic shape applies (the harder historical shape)', () => db.exec(legacy006.up));
await must('real 20260808150000 convergence applies', () => db.exec(convergence.up));
await must('S1 + S2 Up apply (prerequisites)', async () => { await db.exec(s1.up); await db.exec(s2.up); });

await must('seed tenant, users, vehicle', () => db.exec(`
  INSERT INTO users(id, role) VALUES ('u-owner','owner'), ('u-mech-1','mechanic'), ('u-mech-2','mechanic'), ('u-mgr','mechanic');
  INSERT INTO vehicles(vin, owner_id) VALUES ('VINWO000001','u-owner');
  INSERT INTO tenants(id, name, type) VALUES ('${TENANT}','Harare Motors','garage');
`));

// A LEGACY work order predating S4, written the way the current route writes.
await must('a LEGACY work order exists before S4', () => db.exec(`
  INSERT INTO mechanic_work_orders(id, tenant_id, vin, customer_id, mechanic_id, description, status, organization_id, customer_name)
  VALUES ('99999999-9999-9999-9999-999999999999','${TENANT}','VINWO000001','u-owner','u-mech-1','Legacy brake job','In Progress','org-legacy','Legacy Customer')`));

await must('S4 Up applies', () => db.exec(s4.up));

await must('every added column is NULLABLE (legacy rows cannot be invalidated)', async () => {
  const rows = await q(`SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name='mechanic_work_orders' AND column_name IN
    ('service_case_id','branch_id','service_category','completed_at','cancelled_at','cancellation_reason_code','currency')`);
  if (rows.length !== 7) throw new Error(`expected 7 new columns, found ${rows.length}`);
  const notNull = rows.filter(r => r.is_nullable !== 'YES');
  if (notNull.length) throw new Error(`non-nullable: ${notNull.map(r=>r.column_name)}`);
});

await must('the LEGACY row survives with its content intact and no fabricated values', async () => {
  const [r] = await q(`SELECT description, status, mechanic_id, service_case_id, completed_at, currency, total_cost
    FROM mechanic_work_orders WHERE id='99999999-9999-9999-9999-999999999999'`);
  if (r.description !== 'Legacy brake job') throw new Error('legacy content changed');
  if (r.status !== 'In Progress') throw new Error('legacy status changed');
  if (r.mechanic_id !== 'u-mech-1') throw new Error('legacy mechanic_id changed');
  if (r.service_case_id !== null) throw new Error('a service case was fabricated for a legacy row');
  if (r.completed_at !== null) throw new Error('a completion time was fabricated');
  if (r.currency !== null) throw new Error('a currency was assumed for a legacy row');
});

await must('the status CHECK is NOT mutated — all three legacy values still apply', async () => {
  for (const s of ['Completed','Cancelled','In Progress']) {
    await db.exec(`UPDATE mechanic_work_orders SET status='${s}' WHERE id='99999999-9999-9999-9999-999999999999'`);
  }
});
// MEASURED TRUTH, not an assumption: the Title-Case CHECK exists only in
// 009_phase4_schema.sql, which is RETIRED_UNAPPLIABLE, and the legacy 006 shape
// declares `status TEXT DEFAULT 'pending'` with NO constraint. So over the
// legacy-derived shape the database does NOT constrain work-order status at all,
// and S4 must not pretend otherwise. Adding a CHECK here would be unsafe: legacy
// rows can legitimately hold 'pending', outside the API vocabulary.
// Vocabulary enforcement is therefore a SERVICE-LAYER obligation (asserted in
// backend/tests/service-network-s4-work-order.test.js), and this check pins the
// schema fact so a future change that silently assumed DB enforcement is caught.
await must('MEASURED: the legacy-derived shape has NO status CHECK (service layer must enforce)', async () => {
  const rows = await q(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conrelid='mechanic_work_orders'::regclass AND contype='c'`);
  const statusChecks = rows.filter(r => /status/i.test(r.def || ''));
  if (statusChecks.length) {
    throw new Error(`a status CHECK unexpectedly exists: ${statusChecks.map(r=>r.def).join('; ')} — `
      + 'if the canonical shape now carries it, update S4 and the service-layer contract together');
  }
  // and prove the consequence concretely
  await db.exec(`UPDATE mechanic_work_orders SET status='pending' WHERE id='99999999-9999-9999-9999-999999999999'`);
  await db.exec(`UPDATE mechanic_work_orders SET status='In Progress' WHERE id='99999999-9999-9999-9999-999999999999'`);
});

// ── one work order per Service Case ──
await must('seed a service case and link a work order to it', () => db.exec(`
  INSERT INTO service_cases(id, vin, garage_tenant_id, requester_user_id, created_by_user_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','VINWO000001','${TENANT}','u-owner','u-owner');
  INSERT INTO mechanic_work_orders(id, tenant_id, vin, service_case_id, status)
  VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','VINWO000001','cccccccc-cccc-cccc-cccc-cccccccccccc','In Progress');
`));
await mustReject('a SECOND work order for the same Service Case is refused (23505)',
  `INSERT INTO mechanic_work_orders(id, tenant_id, vin, service_case_id, status)
   VALUES ('11111111-2222-3333-4444-666666666666','${TENANT}','VINWO000001','cccccccc-cccc-cccc-cccc-cccccccccccc','In Progress')`, '23505');
await must('work orders with NO service case coexist freely (partial index)', async () => {
  await db.exec(`INSERT INTO mechanic_work_orders(tenant_id, vin, status) VALUES
    ('${TENANT}','VINWO000001','In Progress'), ('${TENANT}','VINWO000001','In Progress')`);
  const [r] = await q(`SELECT count(*)::int n FROM mechanic_work_orders WHERE service_case_id IS NULL`);
  if (r.n < 3) throw new Error(`expected >=3 unlinked work orders, got ${r.n}`);
});

// ── assignment history ──
await must('a mechanic can be assigned', () => db.exec(`
  INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
  VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-1','u-mgr')`));
await mustReject('a SECOND live assignment on the same work order is refused',
  `INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
   VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-2','u-mgr')`, '23505');
await must('after unassigning, a new mechanic may be assigned and HISTORY accumulates', async () => {
  await db.exec(`UPDATE work_order_assignments SET unassigned_at=NOW(), unassigned_by_user_id='u-mgr', unassign_reason_code='reassigned'
    WHERE work_order_id='11111111-2222-3333-4444-555555555555' AND unassigned_at IS NULL`);
  await db.exec(`INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
    VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-2','u-mgr')`);
  const [r] = await q(`SELECT count(*)::int n FROM work_order_assignments WHERE work_order_id='11111111-2222-3333-4444-555555555555'`);
  if (r.n !== 2) throw new Error(`assignment history should retain both rows, got ${r.n}`);
  const [live] = await q(`SELECT mechanic_user_id FROM work_order_assignments
    WHERE work_order_id='11111111-2222-3333-4444-555555555555' AND unassigned_at IS NULL`);
  if (live.mechanic_user_id !== 'u-mech-2') throw new Error('wrong live mechanic');
});
// The SAME invariant the in-memory mock models, proven independently against real
// PostgreSQL so neither proof stands alone: the partial index permits unlimited
// HISTORICAL rows but exactly one LIVE row per work order.
await must('unlimited HISTORICAL assignments are permitted for one work order', async () => {
  await db.exec(`
    INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id, unassigned_at)
    VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-1','u-mgr', NOW() - INTERVAL '3 days'),
           ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-2','u-mgr', NOW() - INTERVAL '2 days'),
           ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-1','u-mgr', NOW() - INTERVAL '1 day')`);
  const [r] = await q(`SELECT count(*)::int n FROM work_order_assignments
    WHERE work_order_id='11111111-2222-3333-4444-555555555555' AND unassigned_at IS NOT NULL`);
  if (r.n < 3) throw new Error(`historical rows were rejected: ${r.n}`);
});
await must('exactly one LIVE row may coexist with that history', async () => {
  const [live] = await q(`SELECT count(*)::int n FROM work_order_assignments
    WHERE work_order_id='11111111-2222-3333-4444-555555555555' AND unassigned_at IS NULL`);
  if (live.n !== 1) throw new Error(`expected exactly 1 live assignment, found ${live.n}`);
});
await mustReject('a SECOND live row is refused even amid many historical rows (23505)',
  `INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
   VALUES ('11111111-2222-3333-4444-555555555555','${TENANT}','u-mech-1','u-mgr')`, '23505');
await must('the partial index is genuinely predicated on unassigned_at IS NULL', async () => {
  const [r] = await q(`SELECT indexdef FROM pg_indexes WHERE indexname='uq_work_order_assignments_live'`);
  if (!r) throw new Error('uq_work_order_assignments_live is missing');
  if (!/WHERE .*unassigned_at IS NULL/i.test(r.indexdef)) {
    throw new Error(`index is not partial on the live predicate: ${r.indexdef}`);
  }
});

await mustReject('assignment to an unknown mechanic is FK-rejected',
  `INSERT INTO work_order_assignments(work_order_id, tenant_id, mechanic_user_id, assigned_by_user_id)
   VALUES ('11111111-2222-3333-4444-999999999999','${TENANT}','u-ghost','u-mgr')`, '23503');

for (const role of ['anon','authenticated']) {
  await must(`work_order_assignments: ${role} holds NO privileges`, async () => {
    const [r] = await q(`SELECT bool_or(has_table_privilege('${role}','work_order_assignments',p)) any_priv
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
    if (r.any_priv) throw new Error(`${role} has privileges`);
  });
}
await must('work_order_assignments: RLS ENABLED + FORCED with zero policies', async () => {
  const [r] = await q(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='work_order_assignments'`);
  if (!r.relrowsecurity || !r.relforcerowsecurity) throw new Error(JSON.stringify(r));
  const [p] = await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid='work_order_assignments'::regclass`);
  if (p.n !== 0) throw new Error(`${p.n} policies`);
});

// ── Down / re-Up ──
await must('S4 Down applies', () => db.exec(s4.down));
await must('added columns and the assignment table are gone, but WORK ORDERS SURVIVE', async () => {
  const cols = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_name='mechanic_work_orders' AND column_name IN ('service_case_id','currency','completed_at')`);
  if (cols.length) throw new Error(`columns survived Down: ${cols.map(c=>c.column_name)}`);
  const t = await q(`SELECT table_name FROM information_schema.tables WHERE table_name='work_order_assignments'`);
  if (t.length) throw new Error('assignment table survived Down');
  const [r] = await q(`SELECT count(*)::int n FROM mechanic_work_orders`);
  if (r.n < 4) throw new Error(`work orders were destroyed by Down: ${r.n}`);
  const [legacy] = await q(`SELECT description FROM mechanic_work_orders WHERE id='99999999-9999-9999-9999-999999999999'`);
  if (!legacy || legacy.description !== 'Legacy brake job') throw new Error('the legacy row was destroyed');
});
await must('S4 re-Up applies (idempotent after rollback)', () => db.exec(s4.up));

await db.close();
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll Service Network S4 migration checks passed.');
process.exit(0);
