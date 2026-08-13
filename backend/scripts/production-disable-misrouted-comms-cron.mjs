/**
 * Disable the ONE misrouted production communications scheduler.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stable staging showed two callers per minute on
 * POST /api/internal/communications/process: one authenticated 200 from the
 * canonical staging pg_cron, and one 401 rejected in 1-2ms. The governed
 * read-only production preflight (run 31664918986, job 94337279670, MODE=preflight,
 * zero writes) proved the second caller:
 *
 *   job count                     1
 *   jobname                       carup-communication-worker-every-minute
 *   jobid                         1
 *   schedule                      * * * * *
 *   active                        true
 *   Vault names present           CARUP_WORKER_ENDPOINT_URL, CARUP_WORKER_SECRET
 *   CARUP_WORKER_ENDPOINT_URL     host = carup-backend-staging.vercel.app
 *   decision                      CONFIRMED
 *
 * An every-minute PRODUCTION scheduler is pointed at the STAGING backend, so it
 * authenticates with the production worker secret against a staging deployment
 * and is rejected before it can reach the queue.
 *
 * WHAT THIS DOES — AND DELIBERATELY DOES NOT DO
 * ---------------------------------------------
 * It unschedules that one job. It does NOT repoint it at the production backend.
 *
 * Repointing would silently ACTIVATE production Communications, and production is
 * not ready for that: the same preflight showed seven publication-gate migrations
 * still unrecorded, partsentry_review_requests missing, trust-side convergence
 * outstanding, 82 pending domain_events, and no production events scheduler.
 * Draining that backlog through a newly-live worker would replay side effects.
 * Whether production Communications should run at all is a separate, unmade
 * decision — this script only stops the misrouted traffic.
 *
 * This mirrors the canonical scheduler migration's own Down action, which is
 * exactly cron.unschedule('carup-communication-worker-every-minute') while
 * leaving pg_cron and pg_net installed.
 *
 * SAFETY SHAPE
 * ------------
 * One transaction. Every precondition is re-asserted INSIDE it against live
 * state — the preflight evidence is a reason to run, never a substitute for
 * checking. Any mismatch rolls back with a non-zero exit and no write. The only
 * mutation reachable from this file is a single cron.unschedule of one pinned
 * job name; the post-state is verified before COMMIT.
 *
 * Secrets: the endpoint is reduced to a hostname INSIDE PostgreSQL via
 * substring(decrypted_secret from '^https?://([^/]+)'), which returns the
 * capture or NULL. A malformed value becomes NON_URL and can never fall through
 * as the original secret. decrypted_secret is never selected bare or logged.
 *
 * Usage (protected workflow only):
 *   PRODUCTION_DATABASE_URL=… PRODUCTION_PROJECT_REF=… [PRODUCTION_CA_CERT=…] \
 *   AUTHORIZATION_PHRASE='DISABLE MISROUTED PRODUCTION COMMUNICATIONS SCHEDULER' \
 *   node backend/scripts/production-disable-misrouted-comms-cron.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL
const AUTH_PHRASE = 'DISABLE MISROUTED PRODUCTION COMMUNICATIONS SCHEDULER';

// The single job this script is allowed to touch, and the exact state it must be
// in. Anything else is someone else's job and this script refuses it.
const TARGET_JOB = 'carup-communication-worker-every-minute';
const EXPECTED_SCHEDULE = '* * * * *';
const MISROUTED_HOST = 'carup-backend-staging.vercel.app';

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const url = process.env.PRODUCTION_DATABASE_URL;
const prodRef = process.env.PRODUCTION_PROJECT_REF;
if (!url) fail('PRODUCTION_DATABASE_URL is not set.');
if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) fail('PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.');
if (prodRef === STAGING_REF) fail('PRODUCTION_PROJECT_REF is the staging ref; refusing.');
if (!url.includes(prodRef)) fail('connection string does not reference PRODUCTION_PROJECT_REF; refusing.');
if (url.includes(STAGING_REF)) fail('connection string references the STAGING project; refusing.');
if (process.env.AUTHORIZATION_PHRASE !== AUTH_PHRASE) {
  fail(`this script requires the exact owner authorization phrase. Expected: "${AUTH_PHRASE}"`);
}

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 60000 });
let opened = false;
try {
  await client.connect();
  const ident = await client.query('select current_database() db');
  console.log(`Connected (db=${ident.rows[0].db}, project ref ${prodRef} verified in URL).`);

  await client.query('BEGIN');
  opened = true;

  // ── Preconditions, re-asserted against LIVE state inside the transaction ──
  const { rows: jobs } = await client.query(
    'select jobid, jobname, schedule, active from cron.job where jobname = $1 order by jobid', [TARGET_JOB]);
  console.log(`precondition: jobs named '${TARGET_JOB}' = ${jobs.length}`);
  for (const j of jobs) {
    console.log(`precondition: jobid=${j.jobid} schedule='${j.schedule}' active=${j.active}`);
  }
  if (jobs.length !== 1) {
    fail(`expected exactly 1 job named '${TARGET_JOB}', found ${jobs.length}; refusing to guess which to remove.`);
  }
  const job = jobs[0];
  if (job.schedule !== EXPECTED_SCHEDULE) {
    fail(`job schedule is '${job.schedule}', expected '${EXPECTED_SCHEDULE}'; state changed since the preflight — refusing.`);
  }
  if (job.active !== true) {
    fail('job is not active; nothing to disable — refusing to write.');
  }

  const { rows: vaultRows } = await client.query(
    "select name from vault.secrets where name = 'CARUP_WORKER_ENDPOINT_URL'");
  if (!vaultRows.length) {
    fail('CARUP_WORKER_ENDPOINT_URL is absent from production Vault; cannot confirm misrouting — refusing.');
  }
  console.log('precondition: CARUP_WORKER_ENDPOINT_URL present (name only).');

  // Hostname derived in-database; the capture group is the only thing returned.
  const { rows: hostRows } = await client.query(`
    select coalesce(substring(decrypted_secret from '^https?://([^/]+)'), 'NON_URL') as endpoint_host
    from vault.decrypted_secrets where name = 'CARUP_WORKER_ENDPOINT_URL' limit 1`);
  const host = hostRows.length ? hostRows[0].endpoint_host : 'UNSET';
  console.log(`precondition: endpoint_host (hostname only) = ${host}`);
  if (host !== MISROUTED_HOST) {
    fail(`endpoint host is ${host}, not the misrouted ${MISROUTED_HOST}; this is not the confirmed defect — refusing.`);
  }

  // ── The single authorized mutation ──
  console.log(`unscheduling '${TARGET_JOB}' (jobid=${job.jobid}) …`);
  const { rows: un } = await client.query('select cron.unschedule($1) as unscheduled', [TARGET_JOB]);
  console.log(`cron.unschedule result: ${un[0].unscheduled}`);

  // ── Post-state verified before COMMIT ──
  const { rows: after } = await client.query(
    'select count(*)::int c from cron.job where jobname = $1', [TARGET_JOB]);
  console.log(`post-state: jobs named '${TARGET_JOB}' = ${after[0].c}`);
  if (after[0].c !== 0) {
    fail(`job still present after unschedule (count=${after[0].c}); rolling back.`);
  }

  // Extensions are shared infrastructure and are deliberately left installed,
  // exactly as the canonical migration's Down action does.
  const { rows: ext } = await client.query(`
    select
      exists (select 1 from pg_extension where extname='pg_cron') as has_cron,
      exists (select 1 from pg_extension where extname='pg_net')  as has_net`);
  console.log(`post-state: pg_cron installed=${ext[0].has_cron} pg_net installed=${ext[0].has_net} (both intentionally left in place)`);

  await client.query('COMMIT');
  opened = false;
  console.log('COMMITTED — the misrouted production communications scheduler is disabled.');
  console.log('Production Communications remains INACTIVE: nothing was repointed, no queue was processed, Vault was not modified.');
} catch (error) {
  if (opened) { try { await client.query('ROLLBACK'); console.error('ROLLED BACK — no write was made.'); } catch { /* connection already gone */ } }
  fail(error.message);
} finally {
  await client.end().catch(() => {});
}
