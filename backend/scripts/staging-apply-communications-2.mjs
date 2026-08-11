/**
 * CarUp Communications 2.0 staging-only migration runner.
 *
 * Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
 * sections 0, 8, 11, 12, 25, 26, 28, 29, 31, 32 and 35.
 *
 * MODE=verify (default): read-only identity/prerequisite/contract inspection.
 * MODE=apply: applies the frozen Communications 2.0 migrations to canonical staging
 * only, one transaction per migration together with its official migration-history row,
 * then verifies the resulting contract.
 *
 * Safety invariants:
 *  - URL must positively contain the approved CarUp staging project ref;
 *  - no production project ref is accepted or embedded as a target;
 *  - reviewed migration bytes are checked by frozen Git blob SHA before DB connect;
 *  - no connection string or secret is printed;
 *  - TLS verification remains enabled;
 *  - already-recorded migrations are never re-applied;
 *  - missing base Communications/Marketplace tables fail closed;
 *  - production application is outside this runner's design contract.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const MODE = process.env.MODE === 'apply' ? 'apply' : 'verify';
const url = process.env.COMMUNICATION_STAGING_DATABASE_URL || process.env.DIASPORA_STAGING_DATABASE_URL;

const MIGRATIONS = [
  {
    version: '20260811131500',
    name: '20260811131500_communications_2_conversation_core.sql',
    gitBlobSha: '5a70a2ca08840856ec66406cc84bcf91f43955ed',
  },
  {
    version: '20260811131600',
    name: '20260811131600_communications_2_delivery_monotonicity.sql',
    gitBlobSha: '3b3f8c195de37491d181897909523be5e66ebea4',
  },
  {
    version: '20260811131700',
    name: '20260811131700_communications_2_workflow_template_foundations.sql',
    gitBlobSha: 'b5f28fd2fcbbb80fdf46b801e547d7a0ce395ec8',
  },
  {
    version: '20260811131800',
    name: '20260811131800_communications_2_participant_auth_hardening.sql',
    gitBlobSha: '745c0697ac799e87665d042457cf3e32ea5b1b3f',
  },
  {
    version: '20260811131900',
    name: '20260811131900_communications_2_privacy_binding_hardening.sql',
    gitBlobSha: '58a7cd1f4673355dd4b9fff32ad42f567720b57d',
  },
  {
    version: '20260811132000',
    name: '20260811132000_communications_2_template_runtime_registry.sql',
    gitBlobSha: '2177549f496b5255de8d0948fa22dd2531a4d5c1',
  },
  {
    version: '20260811132100',
    name: '20260811132100_communications_2_reliability_closure.sql',
    gitBlobSha: 'c85f301269a27fe29caa7ad8faec47cd27d95c67',
  },
];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!url) fail('COMMUNICATION_STAGING_DATABASE_URL (or the existing DIASPORA_STAGING_DATABASE_URL staging operator secret) is not set.');
if (!url.includes(STAGING_REF)) fail(`database URL does not positively reference approved CarUp staging project ${STAGING_REF}; refusing.`);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function readFrozenMigration(migration) {
  const path = fileURLToPath(new URL(`../../database/migrations/${migration.name}`, import.meta.url));
  const sql = readFileSync(path, 'utf8');
  const actual = gitBlobSha(sql);
  if (actual !== migration.gitBlobSha) {
    fail(`${migration.name} Git blob SHA ${actual} != frozen ${migration.gitBlobSha}; reviewed migration bytes drifted.`);
  }
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  return { up, actual };
}

const frozenMigrations = MIGRATIONS.map((migration) => ({
  ...migration,
  ...readFrozenMigration(migration),
}));

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT || process.env.COMMUNICATION_STAGING_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying with configured staging CA trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying with bundled Supabase Root 2021 CA.');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* use system roots */ }
  console.log('TLS: verifying with system trust roots.');
  return { rejectUnauthorized: true };
}

async function assertBaseContract(client) {
  const required = [
    'message_threads', 'message_participants', 'messages', 'channel_identities',
    'notification_queue', 'message_delivery_attempts', 'domain_events',
    'marketplace_inquiries',
  ];
  const { rows } = await client.query('select unnest($1::text[]) as name', [required]);
  for (const row of rows) {
    const found = await client.query('select to_regclass($1)::text as v', [`public.${row.name}`]);
    if (!found.rows[0]?.v) fail(`required base table ${row.name} is absent; wrong/incomplete staging database.`);
  }
  const history = await client.query("select to_regclass('supabase_migrations.schema_migrations')::text as v");
  if (!history.rows[0]?.v) fail('supabase_migrations.schema_migrations is absent; refusing untracked migration application.');
  console.log(`Base prerequisites: ${required.length} tables + migration history present.`);
}

async function verifyContract(client) {
  const checks = [];
  const expectOne = async (label, sql, params = []) => {
    const { rows } = await client.query(sql, params);
    const ok = Number(rows[0]?.c || 0) === 1;
    checks.push({ label, ok, value: rows[0]?.c ?? 0 });
    console.log(`${ok ? 'ok ' : (MODE === 'verify' ? 'note' : 'FAIL')} ${label}=${rows[0]?.c ?? 0}`);
    return ok;
  };

  for (const table of [
    'conversation_channel_bindings', 'message_parts', 'communication_templates',
    'communication_template_versions', 'communication_brand_assets',
    'conversation_events', 'message_derivations',
  ]) {
    await expectOne(`table.${table}`, 'select case when to_regclass($1) is null then 0 else 1 end c', [`public.${table}`]);
  }
  for (const [table, column] of [
    ['message_threads', 'business_workflow'], ['message_threads', 'conversation_type'],
    ['message_threads', 'funnel_stage'], ['message_threads', 'conversion_status'],
    ['message_participants', 'permissions'], ['message_participants', 'stakeholder_role'],
  ]) {
    await expectOne(`${table}.${column}`, `select count(*)::int c from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [table, column]);
  }

  await expectOne(
    'function.communication_is_thread_participant_current_user_only',
    `select count(*)::int c
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='communication_is_thread_participant'
        and pg_get_function_identity_arguments(p.oid)='p_thread_id uuid'`,
  );
  const legacyHelper = await client.query(`
    select count(*)::int c
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='communication_is_thread_participant'
       and pg_get_function_identity_arguments(p.oid)='p_thread_id uuid, p_user_id text'`);
  const legacyHelperRemoved = legacyHelper.rows[0].c === 0;
  checks.push({ label: 'function.legacy_arbitrary_user_helper_removed', ok: legacyHelperRemoved, value: legacyHelper.rows[0].c });
  console.log(`${legacyHelperRemoved ? 'ok ' : (MODE === 'verify' ? 'note' : 'FAIL')} function.legacy_arbitrary_user_helper_count=${legacyHelper.rows[0].c}`);

  await expectOne('constraint.binding_participant_same_thread', `
    select count(*)::int c
      from pg_constraint
     where conname='conversation_channel_bindings_participant_thread_fkey'
       and conrelid='public.conversation_channel_bindings'::regclass`);
  await expectOne('policy.messages_hide_internal_notes', `
    select count(*)::int c
      from pg_policies
     where schemaname='public' and tablename='messages' and policyname='messages_participant_read'
       and qual ilike '%direction%internal%'
       and qual ilike '%communication_is_thread_participant%'`);
  await expectOne('policy.templates_active_only', `
    select count(*)::int c
      from pg_policies
     where schemaname='public' and tablename='communication_templates'
       and policyname='communication_templates_authenticated_read'
       and qual ilike '%status%active%'`);

  await expectOne('trigger.messages_monotonic', `select count(*)::int c from pg_trigger where tgname='trg_messages_monotonic_delivery_status' and not tgisinternal`);
  await expectOne('trigger.notification_queue_monotonic', `select count(*)::int c from pg_trigger where tgname='trg_notification_queue_monotonic_delivery_status' and not tgisinternal`);
  await expectOne('trigger.delivery_attempts_monotonic', `select count(*)::int c from pg_trigger where tgname='trg_message_delivery_attempts_monotonic_delivery_status' and not tgisinternal`);
  await expectOne('domain_events.dedupe_key', `select count(*)::int c from information_schema.columns where table_schema='public' and table_name='domain_events' and column_name='dedupe_key'`);
  await expectOne('trigger.domain_event_exactly_once_key', `select count(*)::int c from pg_trigger where tgname='trg_domain_events_communication_dedupe' and not tgisinternal`);
  await expectOne('trigger.marketplace_atomic_communication_outbox', `select count(*)::int c from pg_trigger where tgname='trg_marketplace_inquiry_communication_outbox' and not tgisinternal`);
  await expectOne('index.domain_event_exactly_once', `
    select count(*)::int c
      from pg_indexes
     where schemaname='public'
       and indexname='idx_domain_events_dedupe_key'
       and indexdef ilike '%unique index%'
       and indexdef ilike '%(dedupe_key)%'`);

  const templatesTable = await client.query("select to_regclass('public.communication_templates')::text as v");
  if (templatesTable.rows[0]?.v) {
    const { rows } = await client.query("select count(*)::int c from communication_templates where status='active'");
    const ok = rows[0].c >= 18;
    checks.push({ label: 'active_governed_templates>=18', ok, value: rows[0].c });
    console.log(`${ok ? 'ok ' : (MODE === 'verify' ? 'note' : 'FAIL')} active_governed_templates=${rows[0].c}`);

    await expectOne('runtime_template.marketplace_inquiry_received_v1', `
      select count(*)::int c
        from communication_template_versions v
        join communication_templates t on t.id=v.template_id
       where t.template_key='marketplace_inquiry_received_v1'
         and t.status='active'
         and v.version=1
         and v.channel='default'
         and v.language='en'
         and v.approval_status='approved'`);
  }

  const participantColumn = await client.query(`select count(*)::int c from information_schema.columns where table_schema='public' and table_name='message_participants' and column_name='stakeholder_role'`);
  if (participantColumn.rows[0].c === 1) {
    const { rows } = await client.query(`
      select count(*)::int c
      from message_threads mt
      where mt.primary_user_id is not null
        and not exists (
          select 1 from message_participants mp
          where mp.thread_id=mt.id and mp.user_id=mt.primary_user_id and mp.left_at is null
        )`);
    const ok = rows[0].c === 0;
    checks.push({ label: 'legacy_primary_without_participant', ok, value: rows[0].c });
    console.log(`${ok ? 'ok ' : (MODE === 'verify' ? 'note' : 'FAIL')} legacy_primary_without_participant=${rows[0].c}`);
  }

  const failures = checks.filter((check) => !check.ok);
  if (MODE === 'apply' && failures.length) {
    fail(`${failures.length} post-apply Communications 2.0 contract check(s) failed: ${failures.map((f) => f.label).join(', ')}`);
  }
  console.log(`Communications 2.0 contract inspection: ${checks.length} checks; ${failures.length} missing${MODE === 'verify' ? ' (expected before apply if not yet migrated)' : ''}.`);
}

const client = new pg.Client({
  connectionString: url,
  ssl: tlsConfig(),
  statement_timeout: 120000,
  application_name: 'carup-communications-2-staging-migration',
});

try {
  await client.connect();
  const identity = await client.query("select current_database() db, current_user usr, current_setting('server_version') version");
  console.log(`Connected to approved staging database (db=${identity.rows[0].db}, mode=${MODE}, postgres=${identity.rows[0].version}).`);
  await assertBaseContract(client);

  for (const migration of frozenMigrations) {
    const existing = await client.query('select name from supabase_migrations.schema_migrations where version=$1', [migration.version]);
    if (existing.rows.length) {
      console.log(`#${migration.version} already recorded (${existing.rows[0].name}); verify-only for this version.`);
      continue;
    }
    if (MODE !== 'apply') {
      console.log(`#${migration.version} pending (${migration.name}, frozen blob ${migration.gitBlobSha.slice(0, 12)}); would apply in apply mode.`);
      continue;
    }

    console.log(`Applying #${migration.version} (${migration.name}) to approved staging in one transaction…`);
    await client.query('begin');
    try {
      await client.query(migration.up);
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1,$2,$3)',
        [migration.version, [migration.up], migration.name],
      );
      await client.query('commit');
      console.log(`#${migration.version} applied + recorded.`);
    } catch (error) {
      await client.query('rollback');
      fail(`#${migration.version} failed and rolled back: ${error.message}`);
    }
  }

  await verifyContract(client);
  console.log(`Communications 2.0 staging runner complete (mode=${MODE}, approved_ref=${STAGING_REF}).`);
} catch (error) {
  fail(`staging runner failed: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}
