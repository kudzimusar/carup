#!/usr/bin/env node
/**
 * `lastRebuild()` against the REAL trade_graph_rebuilds schema (Issue #127).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `lastRebuild()` selected and ordered by `requested_at`. That column has never existed: ledger #15
 * (20260621140000) creates the table with started_at / completed_at / created_at / updated_at, and no
 * later migration adds it. Every tenant-scoped call therefore raised
 * `column "requested_at" does not exist`, and /diaspora/trade-graph/summary answered HTTP 500.
 * Observed on deployed staging as request id req-3b48d3ce-92ac-4945-b87f-fc9693ab3f69.
 *
 * It passed all nine CI checks. Two reasons, and the second is the one that matters:
 *
 *   1. the endpoint is unreachable wherever the suite runs — `DIASPORA_TRADE_GRAPH` 404s the router
 *      when off, and tenant scoping 403s a tenantless caller, both BEFORE the query executes;
 *   2. the unit tests drive a RECORDING FAKE. A fake returns whatever it is told to, so it can only
 *      ever prove the SQL's shape. Nothing in the suite disagreed with a column name, because nothing
 *      in the suite had a schema.
 *
 * So this harness runs the real function against real PostgreSQL with the real DDL. It is the only
 * kind of test that could have caught this, which is why it exists rather than another fake.
 *
 * It opens with a NEGATIVE CONTROL: the pre-fix query is executed first and MUST fail with the exact
 * production error. If that ever stops failing, this harness is no longer proving anything and says
 * so instead of passing quietly.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: Boolean(cond) });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
};

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

/** The exact DDL from ledger #15, so the contract under test is the shipped one. */
function rebuildsDDL() {
  const sql = readFileSync(
    fileURLToPath(new URL('../migrations/20260621140000_diaspora_phase10_trade_graph.sql', import.meta.url)), 'utf8');
  const m = /CREATE TABLE IF NOT EXISTS public\.trade_graph_rebuilds \(([\s\S]*?)\n\);/.exec(sql);
  if (!m) throw new Error('could not extract trade_graph_rebuilds DDL from ledger #15');
  return `CREATE TABLE public.trade_graph_rebuilds (${m[1]}\n);`;
}

async function main() {
  const db = new PGlite();
  try {
    const ddl = rebuildsDDL();
    await db.query(ddl);
    await db.query('CREATE SCHEMA IF NOT EXISTS extensions');

    console.log('\n── 0. the schema really is the shipped one ──');
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_graph_rebuilds'`)).rows.map((r) => r.column_name);
    ok('trade_graph_rebuilds HAS started_at', cols.includes('started_at'), cols.join(','));
    ok('trade_graph_rebuilds HAS created_at', cols.includes('created_at'), cols.join(','));
    ok('trade_graph_rebuilds has NO requested_at column', !cols.includes('requested_at'), cols.join(','));

    console.log('\n── 1. NEGATIVE CONTROL: the pre-fix query must still fail ──');
    let preFixError = '';
    try {
      await db.query(
        `SELECT id, status, requested_at, completed_at FROM public.trade_graph_rebuilds
          WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT 1`, [TENANT]);
    } catch (e) { preFixError = e.message; }
    ok('the ORIGINAL query raises "requested_at does not exist"',
      /requested_at/.test(preFixError) && /does not exist/i.test(preFixError),
      `got: ${preFixError || '(it SUCCEEDED — this harness now proves nothing)'}`);

    console.log('\n── 2. the real lastRebuild() against the real schema ──');
    const { lastRebuild } = await import(
      fileURLToPath(new URL('../../backend/services/diaspora/tradegraph/diasporaTradeGraphHealthService.js', import.meta.url)));

    // PGlite's client shape matches what the service expects: { query(text, params) -> { rows } }.
    const client = { query: (text, params) => db.query(text, params) };

    const empty = await lastRebuild(client, TENANT);
    ok('a tenant with no rebuilds returns null, not an error', empty === null, JSON.stringify(empty));

    await db.query(
      `INSERT INTO public.trade_graph_rebuilds
         (tenant_id, initiated_by, reason, status, started_at, completed_at,
          nodes_rebuilt, edges_rebuilt, events_processed, events_failed, created_at)
       VALUES ($1,'operator-1','uat rebuild','COMPLETED', now() - interval '5 minutes', now(),
               3, 4, 7, 0, now() - interval '5 minutes')`, [TENANT]);

    const one = await lastRebuild(client, TENANT);
    ok('lastRebuild SUCCEEDS against the real schema', one !== null, 'returned null with a row present');
    ok('the result carries requested_at (the public contract field)', one && one.requested_at != null,
      JSON.stringify(one));
    ok('requested_at is populated from started_at', one && one.requested_at instanceof Date,
      `typeof=${one && typeof one.requested_at}`);
    ok('status/reason/counters survive the alias', one && one.status === 'COMPLETED' && one.reason === 'uat rebuild'
      && Number(one.events_processed) === 7 && Number(one.nodes_rebuilt) === 3, JSON.stringify(one));

    console.log('\n── 3. ordering is deterministic and tenant-scoped ──');
    await db.query(
      `INSERT INTO public.trade_graph_rebuilds (tenant_id, reason, status, started_at, created_at)
       VALUES ($1,'newer','RUNNING', now(), now())`, [TENANT]);
    const newest = await lastRebuild(client, TENANT);
    ok('the NEWEST rebuild is returned (created_at DESC)', newest && newest.reason === 'newer',
      JSON.stringify(newest));

    // Two rows sharing created_at exactly — the id tiebreak must still produce one deterministic answer.
    const ts = (await db.query('SELECT now() t')).rows[0].t;
    for (const r of ['tie-a', 'tie-b']) {
      await db.query(
        `INSERT INTO public.trade_graph_rebuilds (tenant_id, reason, status, started_at, created_at)
         VALUES ($1,$2,'RUNNING',$3,$3)`, [TENANT, r, ts]);
    }
    const a = await lastRebuild(client, TENANT);
    const b = await lastRebuild(client, TENANT);
    ok('identical timestamps still yield ONE deterministic row', a && b && a.id === b.id,
      `${a && a.id} vs ${b && b.id}`);

    await db.query(
      `INSERT INTO public.trade_graph_rebuilds (tenant_id, reason, status, started_at, created_at)
       VALUES ($1,'other-tenant','RUNNING', now(), now())`, [OTHER]);
    const mine = await lastRebuild(client, TENANT);
    ok("another tenant's newer rebuild is NOT returned", mine && mine.reason !== 'other-tenant',
      JSON.stringify(mine));
    const theirs = await lastRebuild(client, OTHER);
    ok('the other tenant sees only its own', theirs && theirs.reason === 'other-tenant', JSON.stringify(theirs));

    console.log('\n── 4. the tenant guard still refuses ──');
    let refused = false;
    try { await lastRebuild(client, null); } catch { refused = true; }
    ok('a missing tenant is refused before any query', refused);
  } finally {
    await db.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${JSON.stringify({ total: results.length, failed: failed.length, ok: failed.length === 0 }, null, 2)}`);
  if (failed.length) { for (const f of failed) console.error(`FAILED: ${f.name}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
