// Real-Postgres gate for the additive CarUp Communications 2.0 conversation core.
// Runs only against COMMUNICATION_TEST_DATABASE_URL / disposable CI Postgres.
// No Supabase staging or production database is addressed by this test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);

const BOOTSTRAP = './support/bootstrap.sql';
const BASE = '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql';
const CORE = '../../../database/migrations/20260811131500_communications_2_conversation_core.sql';
const MONOTONIC = '../../../database/migrations/20260811131600_communications_2_delivery_monotonicity.sql';
const WORKFLOW = '../../../database/migrations/20260811131700_communications_2_workflow_template_foundations.sql';

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const upSection = (sql) => sql.split('-- +migrate Down')[0];
const downSection = (sql) => (sql.includes('-- +migrate Down') ? sql.split('-- +migrate Down')[1] : '');

test('Communications 2.0 Postgres migration and invariant gate', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  async function downCommunications2() {
    await client.query(downSection(readSql(WORKFLOW)));
    await client.query(downSection(readSql(MONOTONIC)));
    await client.query(downSection(readSql(CORE)));
  }

  async function upCommunications2() {
    await client.query(upSection(readSql(CORE)));
    await client.query(upSection(readSql(MONOTONIC)));
    await client.query(upSection(readSql(WORKFLOW)));
  }

  t.after(async () => {
    await downCommunications2().catch(() => {});
    await client.query(downSection(readSql(BASE))).catch(() => {});
    await client.query('DROP TABLE IF EXISTS public.users, public.notification_queue, public.domain_events CASCADE').catch(() => {});
    await client.end().catch(() => {});
  });

  await t.test('base + Communications 2.0 migrations apply unchanged', async () => {
    await client.query(upSection(readSql(BOOTSTRAP)));
    await client.query(upSection(readSql(BASE)));
    await upCommunications2();

    const { rows } = await client.query(`SELECT
      to_regclass('public.conversation_channel_bindings') AS bindings,
      to_regclass('public.message_parts') AS parts,
      to_regclass('public.communication_templates') AS templates,
      to_regclass('public.conversation_events') AS events,
      to_regclass('public.message_derivations') AS derivations`);
    assert.ok(rows[0].bindings && rows[0].parts && rows[0].templates && rows[0].events && rows[0].derivations);

    const conversationType = await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='message_threads' AND column_name='conversation_type'`);
    assert.equal(conversationType.rows.length, 1);
    const templates = await client.query(`SELECT template_key FROM public.communication_templates`);
    assert.ok(templates.rows.length >= 10, 'stakeholder template registry is seeded');
  });

  await t.test('legacy primary user is backfilled and participant authorization helper works', async () => {
    // Backfill is migration-time, so create a legacy thread then re-apply only the
    // additive Communications 2.0 layer around it.
    await downCommunications2();
    const { rows: inserted } = await client.query(`
      INSERT INTO public.message_threads
        (tenant_id, thread_key, thread_type, status, primary_channel, primary_user_id)
      VALUES ('tenantA','legacy-c2','support','open','in_app','legacy-user') RETURNING id`);
    await upCommunications2();

    const threadId = inserted[0].id;
    const { rows: participant } = await client.query(`
      SELECT user_id, stakeholder_role, permissions
      FROM public.message_participants
      WHERE thread_id=$1 AND user_id='legacy-user'`, [threadId]);
    assert.equal(participant.length, 1);
    assert.equal(participant[0].stakeholder_role, 'legacy_primary');
    assert.equal(participant[0].permissions.read, true);

    const { rows: authorized } = await client.query(`SELECT public.communication_is_thread_participant($1,$2) AS allowed`, [threadId, 'legacy-user']);
    const { rows: denied } = await client.query(`SELECT public.communication_is_thread_participant($1,$2) AS allowed`, [threadId, 'not-a-participant']);
    assert.equal(authorized[0].allowed, true);
    assert.equal(denied[0].allowed, false);
  });

  await t.test('conversation bindings keep transactional and marketing consent separate', async () => {
    const { rows: threadRows } = await client.query(`
      INSERT INTO public.message_threads
        (tenant_id, thread_key, thread_type, status, primary_channel, business_workflow, conversation_type)
      VALUES ('tenantA','market-c2','marketplace_inquiry','open','in_app','marketplace','marketplace') RETURNING id`);
    const threadId = threadRows[0].id;
    const { rows: participantRows } = await client.query(`
      INSERT INTO public.message_participants
        (thread_id, participant_type, role, stakeholder_role, display_name, permissions)
      VALUES ($1,'external_contact','buyer','buyer','Physical Buyer','{"read":true,"send":true}'::jsonb)
      RETURNING id`, [threadId]);
    const participantId = participantRows[0].id;
    const { rows: identityRows } = await client.query(`
      INSERT INTO public.channel_identities
        (tenant_id, channel, provider, external_id, normalized_address, consent_status)
      VALUES ('tenantA','whatsapp','meta_whatsapp_cloud_api','+263 77 123 4567','263771234567','implied_transactional')
      RETURNING id`);
    const identityId = identityRows[0].id;
    const { rows: bindingRows } = await client.query(`
      INSERT INTO public.conversation_channel_bindings
        (thread_id, participant_id, channel_identity_id, channel, provider, transactional_consent, marketing_consent, is_primary)
      VALUES ($1,$2,$3,'whatsapp','meta_whatsapp_cloud_api',TRUE,FALSE,TRUE)
      RETURNING transactional_consent, marketing_consent`, [threadId, participantId, identityId]);
    assert.equal(bindingRows[0].transactional_consent, true);
    assert.equal(bindingRows[0].marketing_consent, false);
  });

  await t.test('delivery state is monotonic across out-of-order callbacks', async () => {
    const { rows: threadRows } = await client.query(`
      INSERT INTO public.message_threads
        (tenant_id, thread_key, thread_type, status, primary_channel)
      VALUES ('tenantA','receipt-c2','support','open','whatsapp') RETURNING id`);
    const threadId = threadRows[0].id;
    const { rows: messageRows } = await client.query(`
      INSERT INTO public.messages
        (thread_id, tenant_id, direction, channel, provider, content_text, status)
      VALUES ($1,'tenantA','outbound','whatsapp','meta_whatsapp_cloud_api','exact seller reply','delivered')
      RETURNING id`, [threadId]);
    const messageId = messageRows[0].id;

    await client.query(`UPDATE public.messages SET status='sent' WHERE id=$1`, [messageId]);
    let back = await client.query(`SELECT status FROM public.messages WHERE id=$1`, [messageId]);
    assert.equal(back.rows[0].status, 'delivered', 'late sent callback cannot regress delivered');

    await client.query(`UPDATE public.messages SET status='failed' WHERE id=$1`, [messageId]);
    back = await client.query(`SELECT status FROM public.messages WHERE id=$1`, [messageId]);
    assert.equal(back.rows[0].status, 'delivered', 'late failure cannot erase physical delivery');
  });

  await t.test('new migrations roll back without dropping the proven base engine', async () => {
    await downCommunications2();
    const { rows } = await client.query(`SELECT
      to_regclass('public.conversation_channel_bindings') AS bindings,
      to_regclass('public.message_threads') AS base_threads`);
    assert.equal(rows[0].bindings, null);
    assert.ok(rows[0].base_threads, 'base communication engine survives Communications 2.0 rollback');
    await upCommunications2();
  });
});
