// Real-Postgres proof harness for the Diaspora Trade OS atomicity/idempotency claims.
// Boots a REAL embedded Postgres, applies the ACTUAL migration SQL (H3 atomic reservation-approval
// RPC + migration #16 payment-milestone idempotency), and proves against real row-locking:
//   1. Two OVERLAPPING transactions approving reservations that together overfill: FOR UPDATE
//      serializes them, the second is rejected with OVERFILL (the plan's "real concurrency" proof).
//   2. Migration #16's partial unique index actually de-dupes (import_order_id, idempotency_key)
//      and allows multiple NULL keys — real 23505 enforcement, not a JS mock.
//   3. RLS/grant introspection queries (pg_policies / information_schema) run against real PG.
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// fileURLToPath (not URL.pathname) so a repo path containing spaces — e.g. "Project AI" — is decoded
// correctly rather than left as %20, which would break readFileSync/initdb.
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const H3_SQL = readFileSync(`${REPO}database/migrations/20260621092000_diaspora_h3_container_approval_rpc.sql`, 'utf8')
  // take only the Up block (before the migrate Down marker); strip the migrate markers
  .split('-- +migrate Down')[0].replace(/^-- \+migrate Up/m, '');
const MIG16_SQL = readFileSync(`${REPO}database/migrations/20260704090000_diaspora_payment_milestone_idempotency.sql`, 'utf8')
  .split('-- +migrate Down')[0].replace(/^-- \+migrate Up/m, '');

const DATA_DIR = fileURLToPath(new URL('./.pgdata-proof', import.meta.url));
const PORT = 54399;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

async function main() {
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('proofdb');
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/proofdb`;

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const serverVer = (await admin.query('show server_version')).rows[0].server_version;
  rec('real Postgres booted (embedded, not a mock)', true, `server_version=${serverVer}`);

  // ── Minimal real schema the H3 RPC operates on (columns it reads/writes) ──
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`
    CREATE TABLE public.diaspora_container_shipments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid,
      total_capacity_volume numeric, used_capacity_volume numeric DEFAULT 0,
      available_capacity_volume numeric, metadata jsonb DEFAULT '{}'::jsonb,
      updated_by text, updated_at timestamptz, deleted_at timestamptz );
    CREATE TABLE public.diaspora_cargo_reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid,
      container_id uuid, import_order_id uuid, estimated_volume numeric, estimated_weight numeric,
      reservation_status text DEFAULT 'REQUESTED', reviewed_by text, reviewed_at timestamptz,
      updated_by text, updated_at timestamptz, deleted_at timestamptz );
    CREATE TABLE public.diaspora_import_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid, tenant_id uuid,
      actor_id text, action text, resource_type text, resource_id text,
      new_state jsonb, metadata jsonb, cryptographic_seal text, created_at timestamptz DEFAULT now() );
    CREATE TABLE public.diaspora_payment_milestones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid NOT NULL,
      milestone_type text, amount numeric, status text DEFAULT 'PENDING' );
  `);

  // Apply the ACTUAL H3 RPC migration SQL verbatim (proves it parses/loads on real PG).
  await admin.query(H3_SQL);
  const fn = (await admin.query(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname='diaspora_approve_cargo_reservation_atomic'`)).rows[0];
  rec('H3 atomic RPC loads on real Postgres (plpgsql + pinned search_path)', !!fn && Array.isArray(fn.proconfig) && fn.proconfig.some(c => c.startsWith('search_path=')), `proconfig=${JSON.stringify(fn?.proconfig)}`);

  // Apply migration #16 verbatim.
  await admin.query(MIG16_SQL);
  const idx = (await admin.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_diaspora_payment_milestones_idempotency'`)).rows[0];
  rec('migration #16 applies on real Postgres (partial unique index created)', !!idx, idx?.indexdef?.includes('WHERE (idempotency_key IS NOT NULL)') ? 'partial predicate present' : idx?.indexdef);

  // ── Seed: container total=50; two REQUESTED reservations of 30 each (each fits, together overfill) ──
  const cont = (await admin.query(`INSERT INTO diaspora_container_shipments (tenant_id, total_capacity_volume, metadata) VALUES (NULL, 50, '{}'::jsonb) RETURNING id`)).rows[0].id;
  const rA = (await admin.query(`INSERT INTO diaspora_cargo_reservations (container_id, estimated_volume, reservation_status) VALUES ($1, 30, 'REQUESTED') RETURNING id`, [cont])).rows[0].id;
  const rB = (await admin.query(`INSERT INTO diaspora_cargo_reservations (container_id, estimated_volume, reservation_status) VALUES ($1, 30, 'REQUESTED') RETURNING id`, [cont])).rows[0].id;

  // ── REAL concurrency: two OVERLAPPING transactions. A locks the container (FOR UPDATE) and
  //    approves; B calls the RPC while A holds the lock → B blocks; A commits → B recomputes
  //    used=30, projected 60>50 → OVERFILL. This is genuine serialization, not sequential calls. ──
  const cA = new pg.Client({ connectionString: url }); await cA.connect();
  const cB = new pg.Client({ connectionString: url }); await cB.connect();
  await cA.query('BEGIN'); await cB.query('BEGIN');

  const aRes = await cA.query(`SELECT diaspora_approve_cargo_reservation_atomic($1,'admin',true,NULL,NULL) AS r`, [rA]);
  const aUsed = aRes.rows[0].r.capacity.usedVolume;

  // Fire B's approval while A's txn is still open (holds the container FOR UPDATE lock).
  const bPromise = cB.query(`SELECT diaspora_approve_cargo_reservation_atomic($1,'admin',true,NULL,NULL) AS r`, [rB])
    .then(() => ({ ok: true })).catch((e) => ({ ok: false, msg: e.message }));
  // B must NOT resolve within the window — it is blocked on the container FOR UPDATE lock A holds.
  const winner = await Promise.race([
    bPromise.then(() => 'b-resolved'),
    new Promise((r) => setTimeout(() => r('still-blocked'), 500)),
  ]);
  rec('concurrent approval B BLOCKS on the container row lock while A is open (FOR UPDATE serializes)', winner === 'still-blocked', `B pending 500ms after A approved used=${aUsed}`);

  await cA.query('COMMIT');            // release the lock → B proceeds and recomputes
  const bOutcome = await bPromise;     // B should now fail OVERFILL
  await cB.query('ROLLBACK').catch(() => {});
  rec('second concurrent approval REJECTED with OVERFILL (cannot both pass an old snapshot)', bOutcome.ok === false && /OVERFILL/.test(bOutcome.msg || ''), bOutcome.msg || 'B unexpectedly succeeded');

  // Final authoritative state: exactly ONE approved, container used=30, not overfilled.
  const approvedCount = Number((await admin.query(`SELECT count(*) c FROM diaspora_cargo_reservations WHERE reservation_status='APPROVED'`)).rows[0].c);
  const contUsed = Number((await admin.query(`SELECT used_capacity_volume u FROM diaspora_container_shipments WHERE id=$1`, [cont])).rows[0].u);
  rec('end state: exactly 1 approved, container used=30 ≤ 50 (no overfill committed)', approvedCount === 1 && contUsed === 30, `approved=${approvedCount} used=${contUsed}`);

  const auditCount = Number((await admin.query(`SELECT count(*) c FROM diaspora_import_audit_log WHERE action='CARGO_RESERVATION_APPROVED'`)).rows[0].c);
  rec('exactly 1 in-transaction audit row (rolled-back approval left no audit)', auditCount === 1, `audit rows=${auditCount}`);
  await cA.end(); await cB.end();

  // ── Migration #16 idempotency: real 23505 on duplicate (order,key); NULL keys coexist ──
  const oid = '00000000-0000-0000-0000-0000000000aa';
  await admin.query(`INSERT INTO diaspora_payment_milestones (import_order_id, milestone_type, amount, idempotency_key) VALUES ($1,'DEPOSIT',100,'k1')`, [oid]);
  let dup = null;
  try { await admin.query(`INSERT INTO diaspora_payment_milestones (import_order_id, milestone_type, amount, idempotency_key) VALUES ($1,'DEPOSIT',100,'k1')`, [oid]); }
  catch (e) { dup = e.code; }
  rec('duplicate (import_order_id, idempotency_key) rejected by real unique index (23505)', dup === '23505', `pg code=${dup}`);
  await admin.query(`INSERT INTO diaspora_payment_milestones (import_order_id, milestone_type, amount, idempotency_key) VALUES ($1,'BALANCE_DUE',50,NULL)`, [oid]);
  await admin.query(`INSERT INTO diaspora_payment_milestones (import_order_id, milestone_type, amount, idempotency_key) VALUES ($1,'SHIPPING_FEE',25,NULL)`, [oid]);
  const nullKeys = Number((await admin.query(`SELECT count(*) c FROM diaspora_payment_milestones WHERE import_order_id=$1 AND idempotency_key IS NULL`, [oid])).rows[0].c);
  rec('multiple NULL idempotency_key rows coexist (partial index does not constrain NULLs)', nullKeys === 2, `null-key rows=${nullKeys}`);

  // ── Real RLS/grant introspection (the same queries the rollback verify-scripts use) ──
  const grantRows = (await admin.query(`SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name='diaspora_approve_cargo_reservation_atomic'`)).rows;
  const publicHasExec = grantRows.some(r => (r.grantee === 'PUBLIC' || r.grantee === 'public'));
  rec('grant introspection runs on real PG; PUBLIC has no EXECUTE on the atomic RPC (REVOKE applied)', !publicHasExec, `grantees=${grantRows.map(r=>r.grantee).join(',') || 'none'}`);

  await admin.end();
  await epg.stop();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n════ REAL-POSTGRES PROOF: ${passed}/${results.length} passed ════`);
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error('HARNESS ERROR:', e.message); try { await epg.stop(); } catch {} process.exit(2); });
