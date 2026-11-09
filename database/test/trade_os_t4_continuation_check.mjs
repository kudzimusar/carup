/**
 * Trade OS T4 — the procurement→logistics continuation edge, verified by EXECUTING its migration
 * on real PostgreSQL (PGlite).
 *
 * Two things need real Postgres and cannot be shown any other way:
 *
 *   1. The partial unique index actually rejects a second LIVE continuation for one order. The
 *      in-memory mock has no predicate support, so it enforces a stricter, plain-column version;
 *      only the database can demonstrate the real predicate.
 *
 *   2. The predicate FREES the slot once a continuation is CANCELLED or CLOSED. This is the half
 *      the mock gets wrong, and getting it wrong in production would mean a buyer whose shipping
 *      request was cancelled could never arrange shipping for that purchase again — a permanent,
 *      silent dead end.
 *
 * ci.yml warns that migration_pglite_check.mjs's NEW_MIGRATIONS list ends at 20260810120000, so a
 * migration added after that date is executed by NO gate in this repo. This file is that gate for
 * 20260906090000, and it is wired into CI as its own step.
 *
 * Run:  node database/test/trade_os_t4_continuation_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const T4 = '20260906090000_trade_os_t4_transaction_continuation_link.sql';

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};
const sectionOf = (file, section) => {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const down = raw.indexOf('-- +migrate Down');
  return section === 'up'
    ? (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '')
    : (down >= 0 ? raw.slice(down) : '').replace('-- +migrate Down', '');
};

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';

const db = new PGlite();
// No CREATE EXTENSION: gen_random_uuid() is core since PostgreSQL 13, and PGlite ships neither
// uuid-ossp nor pgcrypto. Nothing here depends on either.

// Minimal stand-ins for the two authorities the edge connects. Only the columns the migration and
// its predicate actually touch — this gate is about the constraint, not about either table's shape.
await db.exec(`
  CREATE TABLE public.diaspora_import_orders (
    id uuid PRIMARY KEY,
    buyer_id text,
    deleted_at timestamptz
  );
  CREATE TABLE public.diaspora_logistics_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id text,
    status text NOT NULL DEFAULT 'DRAFT'
      CHECK (status IN ('DRAFT','OPEN_FOR_QUOTES','AWARDED','CLOSED','CANCELLED')),
    deleted_at timestamptz
  );
  INSERT INTO public.diaspora_import_orders (id, buyer_id) VALUES ('${ORDER_A}','buyer-a'), ('${ORDER_B}','buyer-b');
`);

// ── Apply the migration under test ──────────────────────────────────────
try { await db.exec(sectionOf(T4, 'up')); record('migration Up applies', true); }
catch (e) { record('migration Up applies', false, String(e.message || e)); }

const insert = async (order, status = 'DRAFT') =>
  db.exec(`INSERT INTO public.diaspora_logistics_requests (requester_id, status, import_order_id)
           VALUES ('buyer-a', '${status}', ${order ? `'${order}'` : 'NULL'});`);

// 1. One live continuation per order is allowed.
try { await insert(ORDER_A); record('first live continuation is accepted', true); }
catch (e) { record('first live continuation is accepted', false, String(e.message || e)); }

// 2. A SECOND live continuation for the same order is rejected — the idempotency guarantee.
try { await insert(ORDER_A); record('second live continuation is REJECTED', false, 'no unique violation raised'); }
catch (e) { record('second live continuation is REJECTED', /unique|duplicate/i.test(String(e.message)), String(e.message).slice(0, 120)); }

// 3. A different order is unaffected.
try { await insert(ORDER_B); record('a different order may have its own continuation', true); }
catch (e) { record('a different order may have its own continuation', false, String(e.message || e)); }

// 4. NULL import_order_id never collides — logistics-origin is the common case and must never be
//    constrained by an edge it does not have.
try {
  await insert(null); await insert(null); await insert(null);
  record('logistics-origin requests (NULL edge) never collide', true);
} catch (e) { record('logistics-origin requests (NULL edge) never collide', false, String(e.message || e)); }

// 5. THE HALF THE MOCK GETS WRONG: cancelling frees the slot.
await db.exec(`UPDATE public.diaspora_logistics_requests SET status='CANCELLED' WHERE import_order_id='${ORDER_A}';`);
try { await insert(ORDER_A); record('a CANCELLED continuation frees the slot', true); }
catch (e) { record('a CANCELLED continuation frees the slot', false, String(e.message || e)); }

// 6. …and so does closing.
await db.exec(`UPDATE public.diaspora_logistics_requests SET status='CLOSED' WHERE import_order_id='${ORDER_A}';`);
try { await insert(ORDER_A); record('a CLOSED continuation frees the slot', true); }
catch (e) { record('a CLOSED continuation frees the slot', false, String(e.message || e)); }

// 7. Soft-deleted rows also free the slot.
await db.exec(`UPDATE public.diaspora_logistics_requests SET deleted_at=now() WHERE import_order_id='${ORDER_A}';`);
try { await insert(ORDER_A); record('a soft-deleted continuation frees the slot', true); }
catch (e) { record('a soft-deleted continuation frees the slot', false, String(e.message || e)); }

// 8. The edge really is a foreign key, not a loose uuid.
try {
  await insert('99999999-9999-4999-8999-999999999999');
  record('the edge is enforced as a foreign key', false, 'a non-existent order was accepted');
} catch (e) { record('the edge is enforced as a foreign key', /foreign key/i.test(String(e.message)), String(e.message).slice(0, 120)); }

// 9. Down reverses cleanly.
try { await db.exec(sectionOf(T4, 'down')); record('migration Down reverses cleanly', true); }
catch (e) { record('migration Down reverses cleanly', false, String(e.message || e)); }
const { rows: cols } = await db.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name='diaspora_logistics_requests' AND column_name='import_order_id';`);
record('Down removes the column', cols.length === 0);

console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
