#!/usr/bin/env node
/**
 * CARUP-DEALER-ONB-001-LR01-R6 (DBA review 2 #9): minimal apply/rollback runner for the dealership
 * migrations (database/migrations/20261103*.sql), for a disposable database or a STAGING-CLONE
 * rehearsal. It is deliberately NOT a deploy tool:
 *
 *  - ONE transaction per migration (BEGIN; <section>; COMMIT — ROLLBACK on any error), so every
 *    `SET LOCAL lock_timeout = '3s'` ends with its migration and a refused or lock-timed-out
 *    migration leaves nothing behind. Down runs newest → oldest.
 *  - A DIRECT session connection only: a transaction-pooler endpoint (port 6543 or a `pooler.`
 *    host) is refused.
 *  - The target URL comes ONLY from --url or DEALER_MIGRATION_DATABASE_URL — never from
 *    DATABASE_URL / SUPABASE_* — and must be loopback (127.0.0.1, localhost, ::1). Anything else is
 *    refused unless BOTH --allow-non-loopback AND --confirm-target=<host>:<port>/<database> are given
 *    and the confirmation equals the parsed URL exactly. Production project refs are never
 *    special-cased as safe: the confirmation is the operator's explicit, typed decision.
 *  - DBA review 3 N1: the target is computed with node-pg's OWN parser (pg/lib/connection-parameters,
 *    i.e. pg-connection-string), not only the WHATWG URL parser — node-pg honours ?host= / ?port= /
 *    ?options= query parameters, which once let a "loopback" URL connect elsewhere. Every query
 *    parameter except sslmode is refused, the port and database must be explicit (no PGPORT /
 *    PGDATABASE fallback), and the two parsers must agree. After connecting, before any migration
 *    statement, the server itself must match: current_database(), inet_server_port() and — for a
 *    loopback target — a loopback inet_server_addr(). Anything else disconnects and refuses.
 *  - --dry-run prints the plan (target identity + migration names) and touches nothing.
 *
 * Usage:
 *   node backend/scripts/dealership/applyDealerMigrations.mjs --url postgresql://postgres@127.0.0.1:55482/db [--direction up|down] [--only <file>] [--dry-run]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ConnectionParameters from 'pg/lib/connection-parameters.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'database', 'migrations');
const DEALER_MIGRATION = /^20261103\d{6}_dealer_[a-z0-9_]+\.sql$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const ALLOWED_QUERY_PARAMETERS = new Set(['sslmode']);
const LOOPBACK_SERVER_ADDR = /^(127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3})$/;
export const SERVER_IDENTITY_SQL = `SELECT host(inet_server_addr()) AS addr, inet_server_port() AS port,
  current_database() AS db, current_user AS usr, current_setting('server_version') AS v`;

const refuse = (code, detail = '') => Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });

export function parseRunnerArgs(argv, env = {}) {
  const opts = { direction: 'up', only: null, dryRun: false, allowNonLoopback: false, confirmTarget: null, url: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      i += 1;
      if (i >= argv.length) throw refuse('MISSING_ARGUMENT_VALUE', a);
      return argv[i];
    };
    const key = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (key === '--url') opts.url = value();
    else if (key === '--direction') opts.direction = value();
    else if (key === '--only') opts.only = value();
    else if (key === '--confirm-target') opts.confirmTarget = value();
    else if (key === '--dry-run') opts.dryRun = true;
    else if (key === '--allow-non-loopback') opts.allowNonLoopback = true;
    else throw refuse('UNKNOWN_ARGUMENT', a);
  }
  if (!opts.url) opts.url = env.DEALER_MIGRATION_DATABASE_URL || null;
  if (!opts.url) throw refuse('TARGET_URL_REQUIRED', 'pass --url or DEALER_MIGRATION_DATABASE_URL (DATABASE_URL is never read)');
  if (!['up', 'down'].includes(opts.direction)) throw refuse('INVALID_DIRECTION', opts.direction);
  if (opts.only !== null && !DEALER_MIGRATION.test(opts.only)) throw refuse('INVALID_MIGRATION_NAME', opts.only);
  return opts;
}

/** Returns the parsed target; throws unless it is a safe, explicitly confirmed, direct-session target. */
export function assertSafeTarget(url, { allowNonLoopback = false, confirmTarget = null } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw refuse('INVALID_TARGET_URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw refuse('POSTGRES_URL_REQUIRED');
  // N1: node-pg lets query parameters override the host, port, database, user and server options.
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) throw refuse('CONNECTION_QUERY_PARAMETER_REFUSED', `?${key}= is not allowed (only sslmode)`);
  }
  // What node-pg itself will connect to (same parser and defaults the Client uses).
  let effective;
  try { effective = new ConnectionParameters({ connectionString: url }); } catch { throw refuse('INVALID_TARGET_URL'); }
  const host = String(effective.host || '');
  const port = String(effective.port || '');
  const database = String(effective.database || '');
  if (port === '6543' || /(^|\.)pooler\./i.test(host) || /pgbouncer/i.test(parsed.search)) {
    throw refuse('DIRECT_SESSION_CONNECTION_REQUIRED', 'a transaction pooler cannot run one transaction per migration');
  }
  const target = `${host}:${port}/${database}`;
  if (!LOOPBACK.has(host)) {
    if (!allowNonLoopback) throw refuse('NON_LOOPBACK_TARGET_REFUSED', `${target} needs --allow-non-loopback and --confirm-target`);
    if (confirmTarget !== target) throw refuse('TARGET_CONFIRMATION_MISMATCH', `expected --confirm-target=${target}`);
  }
  // Explicit everything: no PGHOST / PGPORT / PGDATABASE fallback may choose the target.
  if (!parsed.port) throw refuse('EXPLICIT_PORT_REQUIRED', 'write the port in the URL');
  const urlDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!urlDatabase || !database) throw refuse('DATABASE_NAME_REQUIRED');
  // The WHATWG view and node-pg's view must be the same target.
  if (parsed.hostname !== host || parsed.port !== port || urlDatabase !== database) {
    throw refuse('TARGET_PARSE_MISMATCH', `URL says ${parsed.hostname}:${parsed.port}/${urlDatabase}, node-pg would use ${target}`);
  }
  return { host, port, database, target, loopback: LOOPBACK.has(host) };
}

/**
 * N1, after connecting: the server we reached must be the approved one. `row` is the result of
 * SERVER_IDENTITY_SQL. A loopback target must be served from a loopback address (a tunnel or a
 * query-parameter redirect to a remote server is refused); every target must report the approved
 * port (a pooler or forwarder reports its backend's port) and database. Unix-socket sessions are
 * refused (inet_server_addr() is NULL).
 */
export function verifyConnectedServer(target, row) {
  const addr = row?.addr ?? null;
  const port = row?.port === null || row?.port === undefined ? null : String(row.port);
  const problems = [];
  if (!addr) problems.push('not a TCP session');
  if (target.loopback && addr && !LOOPBACK_SERVER_ADDR.test(addr)) problems.push(`server address ${addr} is not loopback`);
  if (port !== target.port) problems.push(`server port ${port} is not ${target.port}`);
  if ((row?.db ?? null) !== target.database) problems.push(`database ${row?.db} is not ${target.database}`);
  if (problems.length) throw refuse('CONNECTED_SERVER_MISMATCH', problems.join('; '));
  return true;
}

/** Split one migration file into its Up and Down sections; both markers are mandatory. */
export function splitMigration(sql, name = 'migration') {
  const up = sql.indexOf('-- +migrate Up');
  const down = sql.indexOf('-- +migrate Down');
  if (up !== 0 || down < 0 || down < up) throw refuse('MIGRATION_MARKERS_REQUIRED', name);
  return { up: sql.slice(0, down), down: sql.slice(down) };
}

export function listDealerMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((n) => DEALER_MIGRATION.test(n)).sort();
}

export function planMigrations({ direction = 'up', only = null } = {}, dir = MIGRATIONS_DIR) {
  const all = listDealerMigrations(dir);
  if (only && !all.includes(only)) throw refuse('UNKNOWN_MIGRATION', only);
  const names = only ? [only] : all;
  return direction === 'down' ? [...names].reverse() : names;
}

export async function runDealerMigrations(client, plan, direction, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const results = [];
  for (const name of plan) {
    const section = splitMigration(readFileSync(path.join(dir, name), 'utf8'), name)[direction];
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(section);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      log(`FAILED ${direction.toUpperCase()} ${name} after ${Date.now() - started} ms: ${error.code || ''} ${error.message}`);
      throw Object.assign(error, { migration: name, direction });
    }
    results.push({ name, ms: Date.now() - started });
    log(`${direction === 'up' ? 'APPLIED' : 'ROLLED_BACK'} ${name} (${Date.now() - started} ms, one transaction)`);
  }
  return results;
}

async function defaultCreateClient(config) {
  const { default: pg } = await import('pg');
  return new pg.Client(config);
}

/** Parse, approve, connect, verify the server, then run — the whole CLI as one testable function. */
export async function runFromArgs(argv, env, { createClient = defaultCreateClient, dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const opts = parseRunnerArgs(argv, env);
  const target = assertSafeTarget(opts.url, opts);
  const plan = planMigrations(opts, dir);
  log(`TARGET ${target.target}${target.loopback ? ' (loopback)' : ' (NON-LOOPBACK, explicitly confirmed)'}; ${opts.direction} ${plan.length} migration(s)`);
  if (opts.dryRun) { for (const n of plan) log('PLAN', n); return { target, plan, applied: [] }; }
  const client = await createClient({ connectionString: opts.url, application_name: 'carup-dealer-migration-runner' });
  await client.connect();
  try {
    const who = (await client.query(SERVER_IDENTITY_SQL)).rows[0];
    verifyConnectedServer(target, who);
    log(`CONNECTED database=${who.db} server=${who.addr}:${who.port} user=${who.usr} version=${who.v}`);
    const applied = await runDealerMigrations(client, plan, opts.direction, { dir, log });
    return { target, plan, applied };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runFromArgs(process.argv.slice(2), process.env)
    .catch((error) => { console.error(error.code || 'DEALER_MIGRATION_RUNNER_FAILED', error.message); process.exitCode = 1; });
}
