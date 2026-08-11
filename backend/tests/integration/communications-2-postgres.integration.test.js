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
const AUTH_HARDENING = '../../../database/migrations/20260811131800_communications_2_participant_auth_hardening.sql';
const PRIVACY_HARDENING = '../../../database/migrations/20260811131900_communications_2_privacy_binding_hardening.sql';
const TEMPLATE_RUNTIME = '../../../database/migrations/20260811132000_communications_2_template_runtime_registry.sql';
const RELIABILITY = '../../../database/migrations/20260811132100_communications_2_reliability_closure.sql';

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const upSection = (sql) => sql.split('-- +migrate Down')[0];
const downSection = (sql) => (sql.includes('-- +migrate Down') ? sql.split('-- +migrate Down')[1] : '');

test('Communications 2.0 Postgres migration and invariant gate', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  async function downCommunications2() {
    await client.query(downSection(readSql(RELIABILITY)));
    await client.query(downSection(readSql(TEMPLATE_RUNTIME)));
    await client.query(downSection(readSql(PRIVACY_HARDENING)));
    await client.query(downSection(readSql(AUTH_HARDENING)));
    await client.query(downSection(readSql(WORKFLOW)));
    await client.query(downSection(readSql(MONOTONIC)));
    await client.query(downSection(readSql(CORE)));
  }

  async function upCommunications2() {
    await client.query(upSection(readSql(CORE)));
    await client.query(upSection(readSql(MONOTONIC)));
    await client.query(upSection(readSql(WORKFLOW)));
    await client.query(upSection(readSql(AUTH_HARDENING)));
    await client.query(upSection(readSql(PRIVACY_HARDENING)));
    await client.query(upSection(readSql(TEMPLATE_RUNTIME)));
    await client.query(upSection(readSql(RELIABILITY)));
  }

  t.after(async () => {
    await downCommunications2().catch(() => {});
    await client.query(downSection(readSql(BASE))).catch(() => {});
    await client.query('DROP TABLE IF EXISTS public.users, public.notification_queue, public.domain_events, public.marketplace_inquiries CASCADE').catch(() => {});
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
    assert.ok(templates.rows.length >= 18, 'stakeholder + migrated runtime template registry is seeded');
    const legacyRuntime = await client.query(`
      SELECT count(*)::int c
      FROM communication_template_versions v
      JOIN communication_templates t ON t.id=v.template_id
      WHERE t.template_key='marketplace_inquiry_received_v1'
        AND v.channel='default' AND v.language='en' AND v.approval_status='approved'`);
    assert.equal(legacyRuntime.rows[0].c, 1, 'existing Marketplace notification copy is governed in DB');

    const currentUserHelper = await client.query(`
      SELECT count(*)::int c
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='communication_is_thread_participant'
        AND pg_get_function_identity_arguments(p.oid)='p_thread_id uuid'`);
    const arbitraryUserHelper = await client.query(`
      SELECT count(*)::int c
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='communication_is_thread_participant'
        AND pg_get_function_identity_arguments(p.oid)='p_thread_id uuid, p_user_id text'`);
    assert.equal(currentUserHelper.rows[0].c, 1, 'current-user-only participant helper must exist');
    assert.equal(arbitraryUserHelper.rows[0].c, 0, 'arbitrary-user membership probe must not survive hardening');

    const trigger = await client.query(`SELECT count(*)::int c FROM pg_trigger
      WHERE tgname='trg_marketplace_inquiry_communication_outbox' AND NOT tgisinternal`);
    assert.equal(trigger.rows[0].c, 1, 'Marketplace atomic communication outbox trigger must exist');
  });

  await t.test('Marketplace inquiry and canonical communication event commit atomically and exactly once', async () => {
    const inquiryId = '44444444-4444-4444-8444-444444444444';
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO public.marketplace_inquiries
        (id, listing_id, buyer_id, seller_id, seller_tenant_id, inquiry_type, message, source_channel, referral_code, campaign_code)
      VALUES
        ($1, 'VIN-ATOMIC-C2', 'buyer-atomic', 'seller-atomic', 'tenant-atomic',
         'vehicle_purchase_interest', 'Exact atomic inquiry text', 'web', 'REF-ATOMIC', 'CMP-ATOMIC')`,
    [inquiryId]);

    const inside = await client.query(`
      SELECT payload, tenant_id, dedupe_key
      FROM public.domain_events
      WHERE event_type='marketplace.inquiry.created'
        AND payload ->> 'inquiryId' = $1`, [inquiryId]);
    assert.equal(inside.rows.length, 1, 'outbox event exists in the same transaction as the inquiry');
    assert.equal(inside.rows[0].payload.listingId, 'VIN-ATOMIC-C2');
    assert.equal(inside.rows[0].payload.recipientUserId, 'seller-atomic');
    assert.equal(inside.rows[0].tenant_id, 'tenant-atomic');
    assert.equal(inside.rows[0].dedupe_key, `marketplace.inquiry.created:${inquiryId}`);
    await client.query('COMMIT');

    const duplicate = await client.query(`
      INSERT INTO public.domain_events (event_type, payload, status, attempts, tenant_id)
      VALUES ('marketplace.inquiry.created', $1::jsonb, 'pending', 0, 'tenant-atomic')
      ON CONFLICT DO NOTHING
      RETURNING id`,
    [JSON.stringify({ inquiryId, listingId: 'VIN-ATOMIC-C2' })]);
    assert.equal(duplicate.rows.length, 0, 'duplicate explicit emission is idempotently suppressed');

    const count = await client.query(`
      SELECT count(*)::int c
      FROM public.domain_events
      WHERE event_type='marketplace.inquiry.created'
        AND payload ->> 'inquiryId' = $1`, [inquiryId]);
    assert.equal(count.rows[0].c, 1, 'one inquiry has exactly one canonical communication event');

    const rolledBackId = '55555555-5555-4555-8555-555555555555';
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO public.marketplace_inquiries
        (id, listing_id, seller_id, seller_tenant_id, inquiry_type, message, source_channel)
      VALUES ($1, 'VIN-ROLLBACK-C2', 'seller-rollback', 'tenant-rollback',
        'vehicle_purchase_interest', 'Must roll back together', 'web')`, [rolledBackId]);
    await client.query('ROLLBACK');

    const rollbackProof = await client.query(`
      SELECT
        (SELECT count(*) FROM public.marketplace_inquiries WHERE id=$1::uuid) AS inquiries,
        (SELECT count(*) FROM public.domain_events
          WHERE event_type='marketplace.inquiry.created' AND payload ->> 'inquiryId'=$1::text) AS events`, [rolledBackId]);
    assert.equal(Number(rollbackProof.rows[0].inquiries), 0);
    assert.equal(Number(rollbackProof.rows[0].events), 0, 'inquiry rollback also rolls back its outbox event');
  });

  await t.test('legacy primary user is backfilled and participant authorization helper is bound to auth.uid', async () => {
    await downCommunications2();
    const userId = '11111111-1111-4111-8111-111111111111';
    const otherUserId = '22222222-2222-4222-8222-222222222222';
    const { rows: inserted } = await client.query(`
      INSERT INTO public.message_threads
        (tenant_id, thread_key, thread_type, status, primary_channel, primary_user_id)
      VALUES ('tenantA','legacy-c2','support','open','in_app',$1) RETURNING id`, [userId]);
    await upCommunications2();

    const threadId = inserted[0].id;
    const { rows: participant } = await client.query(`
      SELECT user_id, stakeholder_role, permissions
      FROM public.message_participants
      WHERE thread_id=$1 AND user_id=$2`, [threadId, userId]);
    assert.equal(participant.length, 1);
    assert.equal(participant[0].stakeholder_role, 'legacy_primary');
    assert.equal(participant[0].permissions.read, true);

    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: userId })]);
    const { rows: authorized } = await client.query(`SELECT public.communication_is_thread_participant($1) AS allowed`, [threadId]);
    assert.equal(authorized[0].allowed, true);

    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: otherUserId })]);
    const { rows: denied } = await client.query(`SELECT public.communication_is_thread_participant($1) AS allowed`, [threadId]);
    assert.equal(denied[0].allowed, false);
    await client.query("SELECT set_config('request.jwt.claims','{}',false)");
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
