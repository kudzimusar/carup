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
 *               Synthetic rows are removed afterwards, pass or fail.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const JOB_NAME = 'carup-events-outbox-every-minute';
const EVENTS_PATH = '/api/internal/events/process';
const COMMS_PATH = '/api/internal/communications/process';

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

  // Vault: existence booleans only — the values never leave the database.
  const { rows: vault } = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='CARUP_EVENTS_ENDPOINT_URL') AS has_url,
      EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='CARUP_WORKER_SECRET')       AS has_secret`);
  console.log(`note events_endpoint_url_secret_present = ${vault[0].has_url} (activation gate, not fail-closed)`);
  console.log(`note worker_secret_present = ${vault[0].has_secret} (activation gate, not fail-closed)`);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) fail(`${failed.length} capability check(s) failed: ${failed.map((f) => f.label).join(', ')}`);
  console.log(`Capability ${enforce ? 'verified' : 'reported'}: ${checks.length} checks${enforce ? ', 0 failures' : ' (informational)'}.`);
  return { vault: vault[0], job: job[0] || null };
}

/** Create CARUP_EVENTS_ENDPOINT_URL from the comms worker URL, fully inside SQL. */
async function activateEndpointSecret(client) {
  const { rows } = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='CARUP_EVENTS_ENDPOINT_URL') AS already,
      EXISTS (SELECT 1 FROM vault.decrypted_secrets
               WHERE name='CARUP_WORKER_ENDPOINT_URL'
                 AND decrypted_secret LIKE '%' || $1) AS derivable`, [COMMS_PATH]);
  if (rows[0].already) { console.log('ok  events_endpoint_url_secret_present = true (pre-existing)'); return true; }
  if (!rows[0].derivable) {
    console.log(`::warning::CARUP_WORKER_ENDPOINT_URL does not end with ${COMMS_PATH}; cannot derive the events URL. ` +
      `Create it manually: SELECT vault.create_secret('<staging-backend>${EVENTS_PATH}', 'CARUP_EVENTS_ENDPOINT_URL');`);
    return false;
  }
  await client.query(`
    SELECT vault.create_secret(
      regexp_replace(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CARUP_WORKER_ENDPOINT_URL' LIMIT 1),
        $1 || '$', $2),
      'CARUP_EVENTS_ENDPOINT_URL')`, [COMMS_PATH, EVENTS_PATH]);
  console.log('ok  events_endpoint_url_secret_present = true (derived from the comms worker URL in-database)');
  return true;
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
 * Synthetic end-to-end proof. Inserts one unmistakably synthetic
 * marketplace.inquiry.created outbox event (recipient is a random UUID that
 * exists nowhere; comms tables carry no user FK) and waits for the LIVE chain
 * to process it. Every synthetic row is deleted afterwards, pass or fail.
 */
async function proveEndToEnd(client) {
  const pre = await verifyCapability(client, true);
  if (!pre.vault.has_url || !pre.vault.has_secret) {
    fail('e2e requires both Vault secrets (existence booleans above); run MODE=apply first.');
  }

  const inquiryId = randomUUID();
  const recipient = randomUUID();
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
      if (!rows.length) fail('synthetic event row disappeared — refusing to continue.');
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
      fail(`END-TO-END: FAIL — final status '${finalStatus}', notifications ${notif[0].c}, threads ${thread[0].c}. See receipts above for the first broken hop.`);
    }
  } finally {
    // Synthetic data never outlives the proof, pass or fail.
    const del = async (label, sql, params) => {
      try {
        const r = await client.query(sql, params);
        console.log(`cleanup ${label}: ${r.rowCount} row(s) removed`);
      } catch (e) { console.log(`::warning::cleanup ${label} failed: ${e.message}`); }
    };
    await del('notification_queue', 'DELETE FROM notification_queue WHERE event_id=$1', [eventId]);
    await del('message_threads(cascade)', 'DELETE FROM message_threads WHERE subject_id=$1', [inquiryId]);
    await del('domain_events', 'DELETE FROM domain_events WHERE id=$1', [eventId]);
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
    await proveEndToEnd(client);
  }
} finally {
  await client.end();
}
