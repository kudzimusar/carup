// Real-Postgres integration tests for the Command Center (P1.12).
//
// CREDENTIAL-GATED: runs only when COMMUNICATION_TEST_DATABASE_URL (or DATABASE_URL) points at a
// DISPOSABLE Postgres. Without it, the whole suite is skipped (so CI without a DB stays green). It
// applies the real base + Command Center migrations into a throwaway schema, then verifies:
//   - the three additive migrations apply cleanly (no rollback);
//   - communication_audit_events.notification_id is TEXT and accepts a numeric (BIGSERIAL) queue id;
//   - search_communication_threads() / communication_thread_counts() RPCs exist and run;
//   - tenant scoping returns only the caller's tenant;
//   - the SLA columns + communication_sla_policies table exist.
//
// Run:  COMMUNICATION_TEST_DATABASE_URL=postgres://… node --test tests/integration/
//
// It NEVER touches production: it creates and drops a uniquely-named schema.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);

const MIGRATIONS = [
  '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql',
  '../../../database/migrations/20260705150000_communication_inbox_projection.sql',
  '../../../database/migrations/20260705170000_communication_audit_events.sql',
  '../../../database/migrations/20260705180000_communication_sla.sql',
];

function upSection(sql) {
  // Apply only the "+migrate Up" portion (strip the Down section if present).
  return sql.split('-- +migrate Down')[0];
}

test('communication Postgres integration', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  const schema = `cc_it_${Date.now().toString(36)}`;

  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  });

  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  // pgcrypto for gen_random_uuid in the search_path's public; ensure available.
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => {});

  await t.test('applies all Command Center migrations cleanly', async () => {
    for (const rel of MIGRATIONS) {
      const sql = readFileSync(new URL(rel, import.meta.url), 'utf8');
      // Run each migration's Up section inside the disposable schema.
      await client.query(`SET search_path TO ${schema}, public`);
      await client.query(upSection(sql));
    }
  });

  await t.test('audit notification_id is TEXT and accepts a numeric (BIGSERIAL) queue id', async () => {
    const { rows } = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'communication_audit_events' AND column_name = 'notification_id'`,
      [schema],
    );
    assert.equal(rows[0]?.data_type, 'text');
    // Insert with a legacy numeric id normalised to text — must not raise a type error.
    await client.query(
      `INSERT INTO ${schema}.communication_audit_events (event_type, actor_type, notification_id) VALUES ('smoke_test','worker', $1)`,
      [String(8)],
    );
    const { rows: back } = await client.query(`SELECT notification_id FROM ${schema}.communication_audit_events LIMIT 1`);
    assert.equal(back[0].notification_id, '8');
  });

  await t.test('search + count RPCs exist and run; tenant scoping is enforced', async () => {
    // Seed two tenants' threads.
    await client.query(`INSERT INTO ${schema}.message_threads (tenant_id, thread_key, thread_type, status, primary_channel, last_message_at)
      VALUES ('tenantA','k1','support','awaiting_human','whatsapp', now()), ('tenantB','k2','support','awaiting_human','sms', now())`);

    const a = await client.query(`SELECT * FROM ${schema}.search_communication_threads($1,$2)`, ['tenantA', false]);
    assert.ok(a.rows.every((r) => r.tenant_id === 'tenantA'), 'tenantA caller sees only tenantA');
    const platform = await client.query(`SELECT * FROM ${schema}.search_communication_threads($1,$2)`, [null, true]);
    assert.ok(platform.rows.length >= 2, 'platform sees all tenants');

    const counts = await client.query(`SELECT ${schema}.communication_thread_counts($1,$2,$3) AS c`, ['tenantA', false, null]);
    assert.ok(counts.rows[0].c.all_active >= 1);
  });

  await t.test('SLA columns + policy table exist', async () => {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='message_threads'
        AND column_name IN ('first_response_due_at','resolution_due_at','sla_paused_at','sla_business_timezone')`,
      [schema],
    );
    assert.equal(cols.rows.length, 4);
    const tbl = await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.communication_sla_policies`]);
    assert.ok(tbl.rows[0].t, 'communication_sla_policies exists');
  });
});
