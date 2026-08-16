// Real PostgreSQL closure gate for Communications 2.0 Phase 7 schema + private-storage-safe migration behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);
const BOOTSTRAP = './support/bootstrap.sql';
const BASE = '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql';
const MIGRATIONS = [
  '../../../database/migrations/20260811131500_communications_2_conversation_core.sql',
  '../../../database/migrations/20260811131600_communications_2_delivery_monotonicity.sql',
  '../../../database/migrations/20260811131700_communications_2_workflow_template_foundations.sql',
  '../../../database/migrations/20260811131800_communications_2_participant_auth_hardening.sql',
  '../../../database/migrations/20260811131900_communications_2_privacy_binding_hardening.sql',
  '../../../database/migrations/20260811132000_communications_2_template_runtime_registry.sql',
  '../../../database/migrations/20260811132100_communications_2_reliability_closure.sql',
  '../../../database/migrations/20260811132200_communications_2_product_capabilities.sql',
  '../../../database/migrations/20260811132300_communications_2_completion.sql',
];

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const up = (rel) => readSql(rel).split('-- +migrate Down')[0].replace(/^-- \+migrate Up\s*/m, '');
const down = (rel) => readSql(rel).includes('-- +migrate Down') ? readSql(rel).split('-- +migrate Down')[1] : '';

test('Communications 2.0 Phase 7 completion migration gate', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  t.after(async () => {
    for (const rel of [...MIGRATIONS].reverse()) await client.query(down(rel)).catch(() => {});
    await client.query(down(BASE)).catch(() => {});
    await client.query('DROP TABLE IF EXISTS public.users, public.notification_queue, public.domain_events, public.marketplace_inquiries CASCADE').catch(() => {});
    await client.end().catch(() => {});
  });

  await client.query(up(BOOTSTRAP));
  await client.query(up(BASE));
  for (const rel of MIGRATIONS) await client.query(up(rel));

  await t.test('campaign ledger and recipient frequency/idempotency evidence are database-enforced', async () => {
    const result = await client.query(`SELECT
      to_regclass('public.communication_campaigns')::text campaigns,
      to_regclass('public.communication_campaign_deliveries')::text deliveries,
      to_regclass('public.idx_communication_campaign_deliveries_user_frequency')::text frequency_idx`);
    assert.ok(result.rows[0].campaigns);
    assert.ok(result.rows[0].deliveries);
    assert.ok(result.rows[0].frequency_idx);
    const rls = await client.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('communication_campaigns','communication_campaign_deliveries')`);
    assert.equal(rls.rows.length, 2);
    assert.equal(rls.rows.every((row) => row.relrowsecurity), true);
    const trigger = await client.query(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_notification_queue_campaign_delivery_status' AND NOT tgisinternal`);
    assert.equal(trigger.rows[0].c, 1);
  });

  await t.test('Phase 7 governed re-engagement template is marketing-only and provider approval is not fabricated', async () => {
    const rows = await client.query(`
      SELECT t.classification, t.status, v.channel, v.approval_status, v.provider_template_reference
      FROM communication_templates t
      JOIN communication_template_versions v ON v.template_id=t.id
      WHERE t.template_key='carup_reengagement_v1'
      ORDER BY v.channel`);
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows.every((row) => row.classification === 'marketing' && row.status === 'active' && row.approval_status === 'approved'), true);
    assert.deepEqual(rows.rows.map((row) => row.channel).sort(), ['email', 'in_app']);
    assert.equal(rows.rows.every((row) => row.provider_template_reference === null), true);
  });

  await t.test('completion migration is portable when disposable PostgreSQL has no Supabase storage schema', async () => {
    const storage = await client.query("SELECT to_regnamespace('storage')::text AS storage_schema");
    assert.equal(storage.rows[0].storage_schema, null);
  });

  await t.test('campaign recipient idempotency rejects duplicate delivery evidence', async () => {
    const campaign = await client.query(`
      INSERT INTO communication_campaigns (campaign_code, name, template_key, channel, segment_definition)
      VALUES ('pg-campaign','PG Campaign','carup_reengagement_v1','in_app','{"user_ids":["u1"]}'::jsonb)
      RETURNING id`);
    const campaignId = campaign.rows[0].id;
    await client.query(`INSERT INTO communication_campaign_deliveries (campaign_id,user_id,channel,idempotency_key,status) VALUES ($1,'u1','in_app','campaign:pg:u1','queued')`, [campaignId]);
    await assert.rejects(
      client.query(`INSERT INTO communication_campaign_deliveries (campaign_id,user_id,channel,idempotency_key,status) VALUES ($1,'u1','in_app','campaign:pg:u1','queued')`, [campaignId]),
      (error) => error.code === '23505',
    );
  });

  await t.test('completion down removes only Phase 7 schema and keeps prior Communications 2 core', async () => {
    const completion = MIGRATIONS.at(-1);
    await client.query(down(completion));
    const after = await client.query(`SELECT
      to_regclass('public.communication_campaigns')::text campaigns,
      to_regclass('public.message_parts')::text parts,
      to_regclass('public.message_threads')::text threads`);
    assert.equal(after.rows[0].campaigns, null);
    assert.ok(after.rows[0].parts);
    assert.ok(after.rows[0].threads);
    await client.query(up(completion));
  });
});
