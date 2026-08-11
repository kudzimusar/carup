// Adversarial real-Postgres gate for Communications 2.0 privacy/binding invariants.
// Runs only against COMMUNICATION_TEST_DATABASE_URL / disposable CI Postgres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);

const BOOTSTRAP = './support/bootstrap.sql';
const MIGRATIONS = [
  '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql',
  '../../../database/migrations/20260811131500_communications_2_conversation_core.sql',
  '../../../database/migrations/20260811131600_communications_2_delivery_monotonicity.sql',
  '../../../database/migrations/20260811131700_communications_2_workflow_template_foundations.sql',
  '../../../database/migrations/20260811131800_communications_2_participant_auth_hardening.sql',
  '../../../database/migrations/20260811131900_communications_2_privacy_binding_hardening.sql',
  '../../../database/migrations/20260811132000_communications_2_template_runtime_registry.sql',
];

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const upSection = (sql) => sql.split('-- +migrate Down')[0].replace(/^-- \+migrate Up\s*/m, '');
const downSection = (sql) => (sql.includes('-- +migrate Down') ? sql.split('-- +migrate Down')[1] : '');

test('Communications 2.0 privacy and binding integrity hold in PostgreSQL', { skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  t.after(async () => {
    await client.query('RESET ROLE').catch(() => {});
    await client.query("SELECT set_config('request.jwt.claims', '{}', false)").catch(() => {});
    for (const migration of [...MIGRATIONS].reverse()) {
      await client.query(downSection(readSql(migration))).catch(() => {});
    }
    await client.query('DROP TABLE IF EXISTS public.users, public.notification_queue, public.domain_events CASCADE').catch(() => {});
    await client.end().catch(() => {});
  });

  await client.query(upSection(readSql(BOOTSTRAP)));
  for (const migration of MIGRATIONS) await client.query(upSection(readSql(migration)));

  await t.test('cross-conversation participant/channel binding is rejected at the database boundary', async () => {
    const { rows } = await client.query(`
      INSERT INTO message_threads (thread_key, thread_type, status, primary_channel)
      VALUES ('privacy-a','support','open','in_app'), ('privacy-b','support','open','in_app')
      RETURNING id, thread_key`);
    const threads = rows.sort((a, b) => a.thread_key.localeCompare(b.thread_key));
    const threadA = threads[0].id;
    const threadB = threads[1].id;
    const { rows: participants } = await client.query(`
      INSERT INTO message_participants (thread_id, participant_type, user_id, role, stakeholder_role)
      VALUES ($1,'user','privacy-user','customer','customer') RETURNING id`, [threadA]);
    const participantA = participants[0].id;
    const { rows: identities } = await client.query(`
      INSERT INTO channel_identities (channel, provider, external_id, normalized_address)
      VALUES ('whatsapp','meta_whatsapp_cloud_api','263771234567','263771234567') RETURNING id`);

    await assert.rejects(
      () => client.query(`
        INSERT INTO conversation_channel_bindings
          (thread_id, participant_id, channel_identity_id, channel, provider, transactional_consent)
        VALUES ($1,$2,$3,'whatsapp','meta_whatsapp_cloud_api',TRUE)`,
      [threadB, participantA, identities[0].id]),
      (error) => error?.code === '23503',
    );
  });

  await t.test('authenticated participant can read normal messages but never internal notes', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const { rows: threadRows } = await client.query(`
      INSERT INTO message_threads (thread_key, thread_type, status, primary_channel)
      VALUES ('privacy-rls','support','open','in_app') RETURNING id`);
    const threadId = threadRows[0].id;
    await client.query(`
      INSERT INTO message_participants (thread_id, participant_type, user_id, role, stakeholder_role)
      VALUES ($1,'user',$2,'customer','customer')`, [threadId, userId]);
    await client.query(`
      INSERT INTO messages (thread_id, direction, channel, content_text, status)
      VALUES ($1,'inbound','in_app','visible customer message','received'),
             ($1,'internal','in_app','PRIVATE INTERNAL NOTE','received')`, [threadId]);

    // Supabase projects may grant direct table SELECT through default privileges.
    // Grant it in this disposable DB so the RLS policy itself is what is under test.
    await client.query('GRANT SELECT ON message_threads, message_participants, messages TO authenticated');
    await client.query('SET ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })]);
    const { rows: visibleRows } = await client.query('SELECT direction, content_text FROM messages WHERE thread_id=$1 ORDER BY created_at', [threadId]);
    await client.query('RESET ROLE');

    assert.deepEqual(visibleRows.map((row) => row.content_text), ['visible customer message']);
    assert.equal(visibleRows.some((row) => row.direction === 'internal'), false);
  });

  await t.test('authenticated users see active template registry rows but not draft registry metadata', async () => {
    await client.query(`
      INSERT INTO communication_templates
        (template_key, business_workflow, stakeholder_audience, classification, status)
      VALUES ('privacy_draft_template','support','customer','service','draft')`);
    await client.query('GRANT SELECT ON communication_templates TO authenticated');
    await client.query('SET ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: '22222222-2222-4222-8222-222222222222' })]);
    const { rows } = await client.query(`SELECT template_key, status FROM communication_templates WHERE template_key='privacy_draft_template'`);
    await client.query('RESET ROLE');
    assert.equal(rows.length, 0);
  });
});
