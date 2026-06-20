/**
 * H7/H9 — gated staging integration suite (SKIPPED BY DEFAULT).
 *
 * Proves the Phase 3-7 hardening RPCs against a REAL PostgreSQL/Supabase staging database: atomic
 * stock movements (concurrent over-reserve prevention), atomic quote acceptance (one winner), and
 * serialized container approval (no overfill). Never runs against production.
 *
 * Enable:
 *   RUN_DIASPORA_STAGING_INTEGRATION=true \
 *   DATABASE_URL=postgresql://…@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres \
 *   node --test backend/tests/staging/diaspora-staging-integration.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const runLive = process.env.RUN_DIASPORA_STAGING_INTEGRATION === 'true';
const FORBIDDEN_PRODUCTION_REF = 'vhmnajoeicasaigiophh';

let skipReason = false;
if (!runLive || !databaseUrl) {
  skipReason = 'Set RUN_DIASPORA_STAGING_INTEGRATION=true and DATABASE_URL (authorized staging) to run.';
} else if (databaseUrl.includes(FORBIDDEN_PRODUCTION_REF)) {
  skipReason = 'Refusing to run against the forbidden production project.';
}

const RUN_PREFIX = `stgtest_${Date.now()}`;

test('staging: hardening RPCs and oauth-state table exist', { skip: skipReason }, async () => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const fns = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])`,
      [['diaspora_append_stock_movement_atomic', 'diaspora_accept_quote_atomic', 'diaspora_approve_cargo_reservation_atomic']],
    );
    const names = fns.rows.map((r) => r.proname).sort();
    assert.deepEqual(names, ['diaspora_accept_quote_atomic', 'diaspora_append_stock_movement_atomic', 'diaspora_approve_cargo_reservation_atomic']);
    const tbl = await client.query(`SELECT to_regclass('public.diaspora_oauth_states') AS t`);
    assert.ok(tbl.rows[0].t, 'diaspora_oauth_states must exist');
  } finally {
    await client.end();
  }
});

test('staging: concurrent stock reservations cannot over-reserve', { skip: skipReason }, async () => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const itemId = randomUUID();
  try {
    await client.query(
      `INSERT INTO public.diaspora_stock_items (id, sku, part_name, quantity_on_hand, quantity_reserved, created_by, updated_by)
       VALUES ($1, $2, $3, 10, 0, $4, $4)`,
      [itemId, `${RUN_PREFIX}_sku`, `${RUN_PREFIX} part`, RUN_PREFIX],
    );
    const reserve = (qty) => client.query(
      `SELECT public.diaspora_append_stock_movement_atomic($1,$2,NULL,true,'RESERVE',$3,$4) AS r`,
      [itemId, RUN_PREFIX, qty, `${RUN_PREFIX}_${qty}`],
    ).then(() => 'ok').catch((e) => e.message);
    // Two concurrent reserves of 7 against available 10: exactly one succeeds.
    const results = await Promise.all([reserve(7), reserve(7)]);
    const okCount = results.filter((r) => r === 'ok').length;
    assert.equal(okCount, 1, `exactly one reservation should succeed, got ${JSON.stringify(results)}`);
    const after = await client.query(`SELECT quantity_reserved FROM public.diaspora_stock_items WHERE id=$1`, [itemId]);
    assert.equal(Number(after.rows[0].quantity_reserved), 7);
  } finally {
    await client.query(`DELETE FROM public.diaspora_stock_ledger WHERE stock_item_id=$1`, [itemId]).catch(() => {});
    await client.query(`DELETE FROM public.diaspora_import_audit_log WHERE resource_id=$1`, [itemId]).catch(() => {});
    await client.query(`DELETE FROM public.diaspora_stock_items WHERE id=$1`, [itemId]).catch(() => {});
    await client.end();
  }
});

// Additional concurrency scenarios (quote acceptance, container approval) follow the same shape and
// are documented in docs/DIASPORA_PHASES_3_TO_7_STAGING_PLAN.md. They are intentionally omitted here
// until staging is authorized so this file stays a focused, safe, cleanup-correct harness.
