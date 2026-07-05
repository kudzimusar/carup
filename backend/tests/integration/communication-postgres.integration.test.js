// Real-Postgres integration gate for the Command Center (P1.12 / item 5).
//
// Runs against a DISPOSABLE Postgres pointed at by COMMUNICATION_TEST_DATABASE_URL (or DATABASE_URL in
// CI). Everything is applied into the database's OWN `public` schema — NOT a temp schema — because the
// SECURITY DEFINER RPCs declare `SET search_path = public` and would not see tables created elsewhere
// (that mismatch is what the previous temp-schema harness got wrong). A Supabase-compat bootstrap
// (roles anon/authenticated/service_role, auth.jwt()/auth.uid(), pgcrypto, users) is applied first, so
// the real migrations + RLS policies run UNCHANGED.
//
// Verifies: migrations apply; audit numeric-id (TEXT); search/count RPCs + tenant scoping; registered-
// user name/email search (#3); per-agent unread two-agent semantics (#7); SLA columns + policy
// round-trip (#4); RLS tenant isolation negative tests (#6); and clean rollback of the three CC
// migrations. It NEVER targets production — the CI job provisions a throwaway service container.
//
// Run locally:  COMMUNICATION_TEST_DATABASE_URL=postgres://… node --test tests/integration/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);

const BOOTSTRAP = '../integration/support/bootstrap.sql';
const BASE_MIGRATION = '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql';
// The three Command Center migrations (rolled back at the end to prove reversibility).
const CC_MIGRATIONS = [
  '../../../database/migrations/20260705150000_communication_inbox_projection.sql',
  '../../../database/migrations/20260705170000_communication_audit_events.sql',
  '../../../database/migrations/20260705180000_communication_sla.sql',
];

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const upSection = (sql) => sql.split('-- +migrate Down')[0];
const downSection = (sql) => (sql.includes('-- +migrate Down') ? sql.split('-- +migrate Down')[1] : '');

const CLAIMS = {
  tenantASupport: '{"app_metadata":{"role":"support","tenant_id":"tenantA"}}',
  tenantBSupport: '{"app_metadata":{"role":"support","tenant_id":"tenantB"}}',
  tenantlessSupport: '{"app_metadata":{"role":"support"}}',
  platformAdmin: '{"app_metadata":{"role":"platform_admin"}}',
};

test('communication Postgres integration', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  // Run a query as a specific Supabase role with a simulated JWT, in a rolled-back transaction so the
  // role/claims never leak into the next check.
  async function asRole(role, claims, sql, params = []) {
    await client.query('BEGIN');
    try {
      if (claims) await client.query(`SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`);
      await client.query(`SET LOCAL ROLE ${role}`);
      const res = await client.query(sql, params);
      await client.query('ROLLBACK');
      return res;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  t.after(async () => {
    // Best-effort clean-up so a persistent disposable DB can be reused (CI throws the container away).
    for (const rel of [...CC_MIGRATIONS].reverse()) {
      await client.query(downSection(readSql(rel))).catch(() => {});
    }
    await client.query(downSection(readSql(BASE_MIGRATION))).catch(() => {});
    await client.query('DROP TABLE IF EXISTS public.users CASCADE').catch(() => {});
    await client.end().catch(() => {});
  });

  await t.test('bootstrap + all migrations apply cleanly into public', async () => {
    await client.query(upSection(readSql(BOOTSTRAP)));
    await client.query(upSection(readSql(BASE_MIGRATION)));
    for (const rel of CC_MIGRATIONS) await client.query(upSection(readSql(rel)));
  });

  await t.test('audit notification_id is TEXT and accepts a numeric (BIGSERIAL) queue id', async () => {
    const { rows } = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='communication_audit_events' AND column_name='notification_id'`,
    );
    assert.equal(rows[0]?.data_type, 'text');
    await client.query(
      `INSERT INTO public.communication_audit_events (event_type, actor_type, notification_id) VALUES ('smoke_test','worker',$1)`,
      [String(8)],
    );
    const { rows: back } = await client.query(`SELECT notification_id FROM public.communication_audit_events WHERE event_type='smoke_test' LIMIT 1`);
    assert.equal(back[0].notification_id, '8');
  });

  await t.test('search + count RPCs run and enforce tenant scoping', async () => {
    await client.query(`INSERT INTO public.message_threads (tenant_id, thread_key, thread_type, status, primary_channel, last_message_at)
      VALUES ('tenantA','k1','support','awaiting_human','whatsapp', now()), ('tenantB','k2','support','awaiting_human','sms', now())`);
    const a = await client.query(`SELECT * FROM public.search_communication_threads($1,$2)`, ['tenantA', false]);
    assert.ok(a.rows.length >= 1 && a.rows.every((r) => r.tenant_id === 'tenantA'), 'tenantA caller sees only tenantA');
    const platform = await client.query(`SELECT * FROM public.search_communication_threads($1,$2)`, [null, true]);
    assert.ok(platform.rows.length >= 2, 'platform sees all tenants');
    const counts = await client.query(`SELECT public.communication_thread_counts($1,$2,$3) AS c`, ['tenantA', false, null]);
    assert.ok(counts.rows[0].c.all_active >= 1);
  });

  await t.test('registered-user thread is found by profile name AND email (#3)', async () => {
    await client.query(`INSERT INTO public.users (id, name, email, phone) VALUES ('user-ru','Rudo Chikafu','rudo@example.com','+263771234567')`);
    // Thread with a registered primary_user_id and NO requester channel identity.
    const { rows } = await client.query(`INSERT INTO public.message_threads (tenant_id, thread_key, thread_type, status, primary_channel, primary_user_id, last_message_at)
      VALUES ('tenantA','ru-key','support','awaiting_human','in_app','user-ru', now()) RETURNING id`);
    const byName = await client.query(`SELECT id FROM public.search_communication_threads($1,$2,$3)`, ['tenantA', false, 'Rudo']);
    assert.ok(byName.rows.some((r) => r.id === rows[0].id), 'found by registered profile name');
    const byEmail = await client.query(`SELECT id FROM public.search_communication_threads($1,$2,$3)`, ['tenantA', false, 'rudo@example.com']);
    assert.ok(byEmail.rows.some((r) => r.id === rows[0].id), 'found by registered profile email');
    // The email/phone are searchable but NOT returned in the projection (kept masked).
    const cols = Object.keys(byName.rows[0] || {});
    assert.ok(!cols.includes('email') && !cols.includes('phone'), 'raw email/phone are not projected');
  });

  await t.test('per-agent unread: one agent reading does not clear the other agent (#7)', async () => {
    const { rows: tr } = await client.query(`INSERT INTO public.message_threads (tenant_id, thread_key, thread_type, status, primary_channel, last_message_at)
      VALUES ('tenantA','unread-key','support','awaiting_human','whatsapp', now()) RETURNING id`);
    const threadId = tr[0].id;
    await client.query(`INSERT INTO public.messages (thread_id, tenant_id, direction, channel, content_text, created_at)
      VALUES ($1,'tenantA','inbound','whatsapp','m1', now() - interval '2 min'), ($1,'tenantA','inbound','whatsapp','m2', now() - interval '1 min')`, [threadId]);
    // Agent A has read everything; Agent B has never opened it.
    await client.query(`INSERT INTO public.message_participants (thread_id, participant_type, admin_id, role, last_read_at)
      VALUES ($1,'admin','agent-A','agent', now()), ($1,'admin','agent-B','agent', NULL)`, [threadId]);
    const aUnread = await client.query(`SELECT unread_count FROM public.communication_thread_agent_unread($1,$2)`, [[threadId], 'agent-A']);
    const bUnread = await client.query(`SELECT unread_count FROM public.communication_thread_agent_unread($1,$2)`, [[threadId], 'agent-B']);
    assert.equal(Number(aUnread.rows[0].unread_count), 0, 'agent A read → 0 unread');
    assert.equal(Number(bUnread.rows[0].unread_count), 2, 'agent B never read → 2 unread');
  });

  await t.test('SLA columns + policy table round-trip (#4)', async () => {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='message_threads'
        AND column_name IN ('first_response_due_at','next_response_due_at','resolution_due_at','first_response_at','sla_paused_at','sla_business_timezone')`,
    );
    assert.ok(cols.rows.length >= 6, 'all SLA lifecycle columns exist');
    await client.query(`INSERT INTO public.communication_sla_policies (tenant_id, name, first_response_minutes, next_response_minutes, resolution_minutes, business_timezone)
      VALUES ('tenantA','Standard',60,30,240,'UTC')`);
    const { rows: tr } = await client.query(`INSERT INTO public.message_threads (tenant_id, thread_key, thread_type, status, primary_channel, last_message_at)
      VALUES ('tenantA','sla-key','support','awaiting_human','email', now()) RETURNING id`);
    // The lifecycle writes these columns (JS-side); prove the schema accepts the round-trip.
    await client.query(`UPDATE public.message_threads SET first_response_due_at = now() + interval '1 hour', next_response_due_at = now() + interval '30 min',
      first_response_at = now(), resolution_due_at = now() + interval '4 hour' WHERE id=$1`, [tr[0].id]);
    const back = await client.query(`SELECT first_response_at, next_response_due_at FROM public.message_threads WHERE id=$1`, [tr[0].id]);
    assert.ok(back.rows[0].first_response_at && back.rows[0].next_response_due_at);
  });

  await t.test('RLS tenant isolation on audit events (#6)', async () => {
    // Seed as the owner (bypasses RLS): tenantA, tenantB, and a platform (tenant-null) row.
    await client.query(`INSERT INTO public.communication_audit_events (tenant_id, event_type, actor_type) VALUES
      ('tenantA','reply_sent','agent'), ('tenantB','reply_sent','agent'), (NULL,'reply_sent','platform')`);

    // tenant A support sees ONLY tenantA rows — never tenantB, never platform-null.
    const aRows = await asRole('authenticated', CLAIMS.tenantASupport, `SELECT tenant_id FROM public.communication_audit_events`);
    assert.ok(aRows.rows.length >= 1 && aRows.rows.every((r) => r.tenant_id === 'tenantA'), 'tenant A reads only tenant A');

    // tenant B support cannot see tenant A.
    const bRows = await asRole('authenticated', CLAIMS.tenantBSupport, `SELECT tenant_id FROM public.communication_audit_events`);
    assert.ok(bRows.rows.every((r) => r.tenant_id === 'tenantB'), 'tenant B never reads tenant A');

    // A tenantless support/finance user sees NOTHING (no tenant claim, and platform-null rows are not theirs).
    const noneRows = await asRole('authenticated', CLAIMS.tenantlessSupport, `SELECT tenant_id FROM public.communication_audit_events`);
    assert.equal(noneRows.rows.length, 0, 'tenantless support reads no rows (incl. platform-null)');

    // A platform admin inspects globally (all tenants + platform-null).
    const adminRows = await asRole('authenticated', CLAIMS.platformAdmin, `SELECT tenant_id FROM public.communication_audit_events`);
    const seen = new Set(adminRows.rows.map((r) => r.tenant_id));
    assert.ok(seen.has('tenantA') && seen.has('tenantB') && seen.has(null), 'platform admin reads all scopes');

    // anon is denied outright (privilege revoked).
    await assert.rejects(asRole('anon', null, `SELECT 1 FROM public.communication_audit_events`), 'anon has no access');
  });

  await t.test('the three Command Center migrations roll back cleanly (#5)', async () => {
    for (const rel of [...CC_MIGRATIONS].reverse()) {
      await client.query(downSection(readSql(rel)));
    }
    // The CC objects are gone; the base engine tables remain.
    const gone = await client.query(`SELECT
      to_regclass('public.communication_inbox_threads') AS view,
      to_regprocedure('public.search_communication_threads(text,boolean,text,text[],text[],text,text,text,boolean,boolean,boolean,boolean,timestamptz,text,integer)') AS search_fn,
      to_regclass('public.communication_audit_events') AS audit_tbl,
      to_regclass('public.communication_sla_policies') AS sla_tbl,
      to_regclass('public.message_threads') AS base_tbl`);
    const r = gone.rows[0];
    assert.equal(r.view, null, 'inbox view dropped');
    assert.equal(r.search_fn, null, 'search RPC dropped');
    assert.equal(r.audit_tbl, null, 'audit table dropped');
    assert.equal(r.sla_tbl, null, 'sla policy table dropped');
    assert.ok(r.base_tbl, 'base engine table survives the CC rollback');
    // Re-apply so t.after teardown (which also rolls back) stays idempotent.
    for (const rel of CC_MIGRATIONS) await client.query(upSection(readSql(rel)));
  });
});
