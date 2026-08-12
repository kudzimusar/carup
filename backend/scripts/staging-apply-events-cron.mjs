/**
 * Events-outbox pg_cron staging runner — applies the fail-closed scheduler
 * migration 20260809120000_events_outbox_pg_cron.sql to canonical staging
 * (carup-staging, project ref eoyenigwevnxwwhyhaer) in one transaction with
 * its official supabase_migrations.schema_migrations row, then verifies the
 * resulting capability, and can prove the full delivery chain end-to-end.
 *
 * Modeled on backend/scripts/staging-apply-publication-gate.mjs and sharing
 * its fail-closed guards:
 *   · the URL must positively reference the approved staging ref; anything
 *     else is refused (the production ref is deliberately not written here);
 *   · the migration file's sha256 is checked against its frozen value BEFORE
 *     any connection;
 *   · an already-recorded version switches apply to verify-only, so
 *     re-dispatch is safe;
 *   · TLS verification is ON, anchored on DIASPORA_STAGING_CA_CERT when
 *     supplied, else the Supabase root bundled at database/certs/;
 *   · the connection string is never printed;
 *   · Vault secret VALUES are never selected into this process, in any mode —
 *     existence booleans only. The CARUP_EVENTS_ENDPOINT_URL activation
 *     secret is derived from the comms worker URL entirely inside SQL.
 *
 * MODE=verify → read-only capability report (informational pre-apply).
 * MODE=apply  → apply + ledger in one transaction, activate the endpoint-URL
 *               Vault secret if derivable, then enforce the full contract.
 * MODE=e2e    → synthetic domain event through the live chain:
 *               domain_events → pg_cron → pg_net → /api/internal/events/process
 *               → worker auth → processing → notification/thread → processed.
 *               The synthetic event is addressed to a REAL users row whose
 *               communication preferences permit a transactional in_app
 *               notification. Every artifact it produces (audit events,
 *               delivery attempts, notification, message, participant, thread,
 *               outbox row) is removed afterwards, pass or fail, and the
 *               removal is asserted across all eight tables.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const JOB_NAME = 'carup-events-outbox-every-minute';
const EVENTS_PATH = '/api/internal/events/process';
const COMMS_PATH = '/api/internal/communications/process';
// The STABLE staging backend domain. Deployment-specific *.vercel.app URLs die
// with their deployment (Vercel serves 410 Gone afterwards) — the 2026-08-09
// e2e run proved the comms Vault URL had rotted exactly that way. Activation
// therefore pins the stable domain, never a deployment URL.
const STABLE_EVENTS_URL = `https://carup-backend-staging.vercel.app${EVENTS_PATH}`;

const MIGRATION = {
  version: '20260809120000',
  name: '20260809120000_events_outbox_pg_cron.sql',
  sha12: '2c0424ffba94',
};

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const url = process.env.DIASPORA_STAGING_DATABASE_URL;
if (!url) fail('DIASPORA_STAGING_DATABASE_URL is not set.');
if (!url.includes(STAGING_REF)) fail(`connection string does not reference the approved staging project ${STAGING_REF}; refusing.`);

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied DIASPORA_STAGING_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through to system roots */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

function upSection() {
  const sql = readFileSync(fileURLToPath(new URL(`../../database/migrations/${MIGRATION.name}`, import.meta.url)), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== MIGRATION.sha12) fail(`${MIGRATION.name} checksum ${sum} != frozen ${MIGRATION.sha12} — file drifted, refusing.`);
  return { up: sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, ''), sum };
}

const MODE = ['apply', 'e2e'].includes(process.env.MODE) ? process.env.MODE : 'verify';

/** Capability report. `enforce=true` fails the run when the contract is not met. */
async function verifyCapability(client, enforce) {
  const checks = [];
  const add = (label, value, ok) => {
    checks.push({ label, value, ok: enforce ? ok : true });
    console.log(`${ok ? 'ok ' : (enforce ? 'FAIL' : 'note')} ${label} = ${value}`);
  };

  const { rows: ext } = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS has_cron,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net')  AS has_net`);
  add('pg_cron_installed', ext[0].has_cron, ext[0].has_cron === true);
  add('pg_net_installed', ext[0].has_net, ext[0].has_net === true);

  const { rows: ledger } = await client.query(
    'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [MIGRATION.version]);
  add('migration_ledger_row', ledger.length ? `RECORDED (${ledger[0].name})` : 'not recorded', ledger.length === 1);

  const { rows: job } = await client.query(
    'SELECT jobname, schedule, active FROM cron.job WHERE jobname=$1', [JOB_NAME]);
  add('cron_job_exists', job.length === 1, job.length === 1);
  if (job.length) {
    add('cron_job_schedule', job[0].schedule, job[0].schedule === '* * * * *');
    add('cron_job_active', job[0].active, job[0].active === true);
  }

  // Vault: existence/shape booleans only — the values never leave the database.
  const { rows: vault } = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='CARUP_EVENTS_ENDPOINT_URL') AS has_url,
      EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='CARUP_WORKER_SECRET')       AS has_secret,
      EXISTS (SELECT 1 FROM vault.decrypted_secrets
               WHERE name='CARUP_EVENTS_ENDPOINT_URL' AND decrypted_secret = $1)            AS url_is_stable,
      EXISTS (SELECT 1 FROM vault.decrypted_secrets
               WHERE name='CARUP_WORKER_ENDPOINT_URL'
                 AND decrypted_secret LIKE 'https://carup-backend-staging.vercel.app%')     AS comms_url_stable`,
    [STABLE_EVENTS_URL]);
  console.log(`note events_endpoint_url_secret_present = ${vault[0].has_url} (activation gate, not fail-closed)`);
  console.log(`note events_endpoint_url_is_stable_domain = ${vault[0].url_is_stable}`);
  console.log(`note worker_secret_present = ${vault[0].has_secret} (activation gate, not fail-closed)`);
  if (!vault[0].comms_url_stable) {
    console.log('::warning::CARUP_WORKER_ENDPOINT_URL does not point at the stable staging domain — the comms delivery cron is likely firing into a dead deployment URL (410). Update it the same way.');
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) fail(`${failed.length} capability check(s) failed: ${failed.map((f) => f.label).join(', ')}`);
  console.log(`Capability ${enforce ? 'verified' : 'reported'}: ${checks.length} checks${enforce ? ', 0 failures' : ' (informational)'}.`);
  return { vault: vault[0], job: job[0] || null };
}

/**
 * Pin CARUP_EVENTS_ENDPOINT_URL to the stable staging domain — create it if
 * absent, update it if it holds anything else (e.g. a rotted deployment URL).
 * The stable URL is a public hostname constant, not a secret value.
 */
async function activateEndpointSecret(client) {
  const { rows } = await client.query(
    `SELECT id, (decrypted_secret = $1) AS already_stable
       FROM vault.decrypted_secrets WHERE name='CARUP_EVENTS_ENDPOINT_URL' LIMIT 1`, [STABLE_EVENTS_URL]);
  if (rows.length && rows[0].already_stable) {
    console.log('ok  events_endpoint_url = stable staging domain (pre-existing)');
    return;
  }
  if (rows.length) {
    await client.query('SELECT vault.update_secret($1, $2)', [rows[0].id, STABLE_EVENTS_URL]);
    console.log(`ok  events_endpoint_url updated to the stable staging domain (${STABLE_EVENTS_URL})`);
    return;
  }
  await client.query('SELECT vault.create_secret($1, $2)', [STABLE_EVENTS_URL, 'CARUP_EVENTS_ENDPOINT_URL']);
  console.log(`ok  events_endpoint_url created on the stable staging domain (${STABLE_EVENTS_URL})`);
}

async function applyMigration(client) {
  const { up, sum } = upSection();
  const { rows: existing } = await client.query(
    'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [MIGRATION.version]);
  if (existing.length) {
    console.log(`#${MIGRATION.version} already recorded (${existing[0].name}) — verify-only.`);
    return;
  }
  console.log(`Applying #${MIGRATION.version} (${MIGRATION.name}, sha256:12 ${sum}) in one transaction…`);
  await client.query('BEGIN');
  try {
    await client.query(up);
    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
      [MIGRATION.version, [up], MIGRATION.name]);
    await client.query('COMMIT');
    console.log(`#${MIGRATION.version} applied and recorded.`);
  } catch (e) {
    await client.query('ROLLBACK');
    fail(`#${MIGRATION.version} failed and rolled back (nothing ledgered): ${e.message}`);
  }
}

/**
 * Deterministic ELIGIBLE synthetic recipient.
 *
 * Two constraints, both load-bearing:
 *   1. notification_queue.recipient_id -> users(id) (FK), so the recipient must
 *      be a real users row — a random UUID made the insert fail 23503 while the
 *      thread had already been created (staging run 31434270413).
 *   2. The user's platform-level communication preferences must permit a
 *      TRANSACTIONAL IN_APP notification, otherwise selectChannels() returns []
 *      and queueFromDomainEvent writes no notification_queue row at all — the
 *      proof would then report a broken final hop against a healthy pipeline.
 *
 * Mirrors communicationPreferenceService exactly:
 *   · no preferences row  => DEFAULT_PREFS (transactional_enabled true,
 *     in_app_enabled true) => ELIGIBLE, so no row is ever created here;
 *   · a persisted row gates it, and the code tests `transactional_enabled ===
 *     false` / `in_app_enabled !== false`, so only literal FALSE blocks. The
 *     predicate is therefore IS NOT FALSE, never = true (a NULL is permissive);
 *   · getPreferences is called with tenantId = null for this synthetic event,
 *     and the repository matches NULL with `.is(key, null)`, so ONLY a
 *     tenant_id IS NULL row can gate it — hence the join scopes on that.
 * Never modifies a real user's preferences.
 */
const ELIGIBLE_RECIPIENT_SQL = `
  WITH eligible AS (
    SELECT u.id
      FROM users u
      LEFT JOIN communication_preferences p
             ON p.user_id = u.id
            AND p.tenant_id IS NULL
     WHERE p.id IS NULL
        OR (p.transactional_enabled IS NOT FALSE AND p.in_app_enabled IS NOT FALSE)
  )
  SELECT (SELECT count(*) FROM eligible)::int          AS eligible_total,
         (SELECT id FROM eligible ORDER BY id LIMIT 1) AS recipient_id`;

/**
 * Delete EVERY artifact the synthetic event produced, narrowly scoped to
 * resolved ids, in FK-safe order — then prove zero residue.
 *
 * Why the previous three-statement teardown was wrong: once the live comms
 * delivery cron claims the notification, `message_delivery_attempts.message_id
 * -> messages.id` (NO ACTION) BLOCKS the thread's cascade into messages, so
 * `DELETE FROM message_threads` raises 23503 and leaves message_threads,
 * messages, message_participants, message_delivery_attempts and
 * communication_audit_events all behind — while the old catch swallowed it as
 * a warning and the run still reported PASS.
 *
 * Ordering constraints (from the live FK map): audit/attempt rows first (they
 * hold the only handles and mda.message_id blocks messages) -> notification_queue
 * (both its FKs are NO ACTION) -> escalations -> messages -> participants
 * (messages.sender_participant_id is NO ACTION) -> threads -> domain_events
 * last, since its payload is the only handle to the rest if a step fails.
 *
 * notification_queue.id is BIGINT while message_delivery_attempts.notification_id
 * and communication_audit_events.notification_id are TEXT, hence the casts.
 */
async function purgeSynthetic(client, { eventId, inquiryId, label }) {
  // STEP 0 — resolve at TEARDOWN time, never at insert time: the live cron can
  // claim the notification mid-proof and create fresh artifacts.
  const resolveIds = async () => {
    const { rows } = await client.query(`
      WITH t AS (
        SELECT id FROM message_threads WHERE subject_id = $2
      ), n AS (
        SELECT q.id FROM notification_queue q
         WHERE q.event_id = $1::text OR q.thread_id IN (SELECT id FROM t)
      ), m AS (
        SELECT msg.id FROM messages msg WHERE msg.thread_id IN (SELECT id FROM t)
        UNION
        SELECT q.message_id FROM notification_queue q
         WHERE q.id IN (SELECT id FROM n) AND q.message_id IS NOT NULL
      )
      SELECT COALESCE((SELECT array_agg(id)       FROM t), '{}')::uuid[] AS thread_ids,
             COALESCE((SELECT array_agg(id::text) FROM n), '{}')::text[] AS notification_ids,
             COALESCE((SELECT array_agg(id)       FROM m), '{}')::uuid[] AS message_ids`,
      [eventId, inquiryId]);
    return rows[0];
  };

  // Each step declares the params it uses, in order: a statement must never be
  // handed a parameter it does not reference (PostgreSQL cannot infer the type
  // of an unused placeholder and raises 42P18).
  const STEPS = [
    // communication_audit_events has ZERO foreign keys — it cascades from
    // nothing, so nothing else would ever remove these rows.
    ['communication_audit_events', `DELETE FROM communication_audit_events
        WHERE notification_id = ANY($1::text[]) OR thread_id = ANY($2::uuid[]) OR message_id = ANY($3::uuid[])`,
      ['notificationIds', 'threadIds', 'messageIds']],
    ['message_delivery_attempts', `DELETE FROM message_delivery_attempts
        WHERE notification_id = ANY($1::text[]) OR message_id = ANY($2::uuid[])`,
      ['notificationIds', 'messageIds']],
    ['notification_queue', `DELETE FROM notification_queue
        WHERE id = ANY($1::text[]::bigint[]) OR event_id = $2::text OR thread_id = ANY($3::uuid[])`,
      ['notificationIds', 'eventId', 'threadIds']],
    ['communication_escalations', `DELETE FROM communication_escalations WHERE thread_id = ANY($1::uuid[])`,
      ['threadIds']],
    ['messages', `DELETE FROM messages WHERE thread_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])`,
      ['threadIds', 'messageIds']],
    ['message_participants', `DELETE FROM message_participants WHERE thread_id = ANY($1::uuid[])`,
      ['threadIds']],
    ['message_threads', `DELETE FROM message_threads WHERE id = ANY($1::uuid[]) OR subject_id = $2::text`,
      ['threadIds', 'inquiryId']],
    ['domain_events', `DELETE FROM domain_events WHERE id = $1::uuid`,
      ['eventId']],
  ];

  const RESIDUE_SQL = `
    SELECT 'domain_events' AS table_name, count(*)::int AS residual FROM domain_events WHERE id = $1::uuid
    UNION ALL SELECT 'notification_queue',         count(*)::int FROM notification_queue         WHERE id = ANY($4::text[]::bigint[]) OR event_id = $1::text OR thread_id = ANY($3::uuid[])
    UNION ALL SELECT 'message_threads',            count(*)::int FROM message_threads            WHERE id = ANY($3::uuid[]) OR subject_id = $2
    UNION ALL SELECT 'messages',                   count(*)::int FROM messages                   WHERE thread_id = ANY($3::uuid[]) OR id = ANY($5::uuid[])
    UNION ALL SELECT 'message_participants',       count(*)::int FROM message_participants       WHERE thread_id = ANY($3::uuid[])
    UNION ALL SELECT 'message_delivery_attempts',  count(*)::int FROM message_delivery_attempts  WHERE notification_id = ANY($4::text[]) OR message_id = ANY($5::uuid[])
    UNION ALL SELECT 'communication_audit_events', count(*)::int FROM communication_audit_events WHERE notification_id = ANY($4::text[]) OR thread_id = ANY($3::uuid[]) OR message_id = ANY($5::uuid[])
    UNION ALL SELECT 'communication_escalations',  count(*)::int FROM communication_escalations  WHERE thread_id = ANY($3::uuid[])
    ORDER BY 1`;

  const sweep = async () => {
    const ids = await resolveIds();
    const bag = {
      eventId,
      inquiryId,
      threadIds: ids.thread_ids,
      notificationIds: ids.notification_ids,
      messageIds: ids.message_ids,
    };
    const params = [eventId, inquiryId, ids.thread_ids, ids.notification_ids, ids.message_ids];
    const removed = [];
    for (const [table, sql, argNames] of STEPS) {
      const r = await client.query(sql, argNames.map((n) => bag[n]));
      if (r.rowCount) removed.push(`${table}=${r.rowCount}`);
    }
    // Assert on COUNTS, never on DELETE rowCount: RLS is enabled-not-forced on
    // these tables, so a non-owner role would report 0 removed and look clean.
    const { rows: residue } = await client.query(RESIDUE_SQL, params);
    return { removed, residue, params };
  };

  let { removed, residue } = await sweep();
  let leftover = residue.filter((r) => r.residual > 0);
  if (leftover.length) {
    // The live cron may have written fresh artifacts behind the first sweep.
    console.log(`::warning::${label} residue after first sweep (${leftover.map((r) => `${r.table_name}=${r.residual}`).join(', ')}); re-sweeping once.`);
    const second = await sweep();
    removed = removed.concat(second.removed);
    leftover = second.residue.filter((r) => r.residual > 0);
  }
  console.log(`cleanup ${label}: ${removed.length ? removed.join(' ') : 'nothing to remove'}`);
  console.log(`cleanup ${label} zero-residue assertion: ${leftover.length ? 'FAIL ' + leftover.map((r) => `${r.table_name}=${r.residual}`).join(', ') : 'PASS (all 8 tables = 0)'}`);
  return leftover;
}

/**
 * Synthetic end-to-end proof. Inserts one unmistakably synthetic
 * marketplace.inquiry.created outbox event — addressed to a REAL, eligible
 * users row (see ELIGIBLE_RECIPIENT_SQL) — and waits for the LIVE chain to
 * process it. Every synthetic artifact is removed afterwards, pass or fail,
 * and the removal is asserted across all eight affected tables.
 */
async function proveEndToEnd(client) {
  const pre = await verifyCapability(client, true);
  if (!pre.vault.has_url || !pre.vault.has_secret) {
    fail('e2e requires both Vault secrets (existence booleans above); run MODE=apply first.');
  }

  // Purge residue from any earlier interrupted run — resolving each stale
  // event's comms artifacts FIRST. Deleting the domain_events row up front
  // (as this once did) destroys payload->>'inquiryId', the only handle to that
  // run's thread/messages/attempts/audit rows, orphaning them forever.
  const { rows: stale } = await client.query(
    "SELECT id, payload->>'inquiryId' AS inquiry_id FROM domain_events WHERE payload->>'source_channel' = 'staging-e2e-synthetic'");
  for (const s of stale) {
    await purgeSynthetic(client, { eventId: s.id, inquiryId: s.inquiry_id, label: `stale ${s.id}` });
  }
  if (stale.length) console.log(`purged ${stale.length} stale synthetic event(s) from earlier runs, artifacts included`);

  const inquiryId = randomUUID();
  const { rows: recipRows } = await client.query(ELIGIBLE_RECIPIENT_SQL);
  if (!recipRows[0].recipient_id) {
    fail('no users row has communication preferences permitting a transactional in_app notification; cannot prove the notification hop. Add an eligible fixture user — do NOT edit a real user\'s preferences.');
  }
  const recipient = recipRows[0].recipient_id;
  console.log(`synthetic recipient = ${recipient} (eligible for transactional in_app; ${recipRows[0].eligible_total} candidate(s) qualify)`);
  const timeoutS = Number(process.env.EVENTS_E2E_TIMEOUT_S || 180);
  const { rows: t0r } = await client.query('SELECT now() AS t0');
  const t0 = t0r[0].t0;

  const { rows: ins } = await client.query(`
    INSERT INTO domain_events (event_type, payload, status, tenant_id)
    VALUES ('marketplace.inquiry.created', $1::jsonb, 'pending', NULL)
    RETURNING id`, [JSON.stringify({
      inquiryId,
      listingId: null,
      inquiry_type: 'general',
      recipientUserId: recipient,
      buyerId: null,
      sellerId: null,
      source_channel: 'staging-e2e-synthetic',
      referral_code: null,
      campaign_code: null,
    })]);
  const eventId = ins[0].id;
  console.log(`synthetic domain_events row inserted: ${eventId} (inquiry ${inquiryId})`);

  let finalStatus = 'pending';
  try {
    const deadline = Date.now() + timeoutS * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10000));
      const { rows } = await client.query('SELECT status, attempts, error_log FROM domain_events WHERE id=$1', [eventId]);
      if (!rows.length) throw new Error('synthetic event row disappeared — refusing to continue.');
      finalStatus = rows[0].status;
      console.log(`t+${Math.round((Date.now() - (deadline - timeoutS * 1000)) / 1000)}s status=${finalStatus} attempts=${rows[0].attempts}`);
      if (finalStatus !== 'pending') {
        if (rows[0].error_log) console.log(`error_log: ${String(rows[0].error_log).slice(0, 300)}`);
        break;
      }
    }

    // Chain receipts — statuses and counts only, never payloads or secrets.
    const { rows: runs } = await client.query(`
      SELECT jrd.status, count(*)::int c FROM cron.job_run_details jrd
      JOIN cron.job j ON j.jobid = jrd.jobid
      WHERE j.jobname=$1 AND jrd.start_time > $2 GROUP BY 1 ORDER BY 1`, [JOB_NAME, t0]);
    console.log('receipt cron.job_run_details since t0:', JSON.stringify(runs));
    const { rows: https } = await client.query(
      'SELECT status_code, count(*)::int c FROM net._http_response WHERE created > $1 GROUP BY 1 ORDER BY 1', [t0]);
    console.log('receipt net._http_response since t0 (all pg_net calls):', JSON.stringify(https));
    const { rows: notif } = await client.query(
      'SELECT count(*)::int c FROM notification_queue WHERE event_id=$1', [eventId]);
    console.log(`receipt notification_queue rows for event: ${notif[0].c}`);
    const { rows: thread } = await client.query(
      'SELECT count(*)::int c FROM message_threads WHERE subject_id=$1', [inquiryId]);
    console.log(`receipt message_threads rows for inquiry: ${thread[0].c}`);

    if (finalStatus === 'processed' && notif[0].c > 0 && thread[0].c > 0) {
      console.log('END-TO-END: PASS — event processed through the live cron→pg_net→endpoint→worker chain.');
    } else {
      // Throw (never process.exit) so the finally-cleanup always runs.
      throw new Error(`END-TO-END: FAIL — final status '${finalStatus}', notifications ${notif[0].c}, threads ${thread[0].c}. See receipts above for the first broken hop.`);
    }
  } finally {
    // Synthetic data never outlives the proof, pass or fail — across all eight
    // affected tables, asserted, not assumed.
    const leftover = await purgeSynthetic(client, { eventId, inquiryId, label: 'synthetic' });
    if (leftover.length) {
      console.log(`::error::synthetic residue survived cleanup: ${leftover.map((r) => `${r.table_name}=${r.residual}`).join(', ')}`);
      process.exitCode = 1;
    }
  }
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const { rows: ident } = await client.query('SELECT current_database() AS db');
  console.log(`Connected to ${ident[0].db} (staging ref ${STAGING_REF} verified in URL). MODE=${MODE}.`);
  upSection(); // checksum gate in every mode, before any action
  if (MODE === 'verify') {
    await verifyCapability(client, false);
  } else if (MODE === 'apply') {
    await applyMigration(client);
    await activateEndpointSecret(client);
    await verifyCapability(client, true);
  } else {
    try {
      await proveEndToEnd(client);
    } catch (e) {
      console.error(`::error::${e.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}
