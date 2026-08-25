/**
 * PRODUCTION runner for Issue #164 canonical-trust schema activation.
 *
 * Applies exactly ONE migration:
 *
 *   20260817140000_issue164_trust_cache_provenance.sql
 *
 * ## Why exactly one, when sixteen are missing
 *
 * All sixteen authorized Issue #164 migrations are absent from production's ledger. This cutover
 * deliberately does NOT apply them. Only this one is required for canonical trust, and the rest are
 * not safe to apply blind: three of the six Phase 6 transaction tables (escrow_trust_sessions,
 * escrow_trust_events, escrow_trust_webhook_events) ALREADY EXIST on production, unledgered and
 * carrying live rows. A CREATE that finds them present either fails or silently no-ops onto a shape
 * nobody verified. That is a separate, reviewable cutover.
 *
 * This migration is independent of all of them — measured, its text references no other Issue #164
 * table.
 *
 * ## What it does, and what it must never do
 *
 * Additive only: six NULLABLE columns on public.vehicles, no defaults, no backfill.
 *
 * Production holds 352 LEGACY trust_score values with no provenance. They must remain byte-identical
 * and must not be stamped by THIS migration — an unversioned score is precisely what
 * canonicalTrustService refuses to publish, so leaving them unstamped is what demotes them. Stamping
 * the current version onto them would launder unattributable historical values into canonical truth.
 *
 * ## The invariant, stated correctly
 *
 *   THE MIGRATION MUST NOT CREATE TRUST STAMPS.
 *
 * NOT "production must remain forever unstamped". After activation, refreshCanonicalTrust() is
 * SUPPOSED to stamp governed vehicles. An earlier revision of this runner asserted a global
 * `count(trust_calculation_version IS NOT NULL) = 0` after every invocation, which would have called
 * a legitimate canonical refresh a cutover failure on the next verify-only run. It is enforced
 * instead where it is actually true and actually provable:
 *
 *   · FIRST APPLY  — the count is taken INSIDE the migration transaction, BEFORE COMMIT. The ALTER
 *                    holds ACCESS EXCLUSIVE on public.vehicles until commit, so no concurrent
 *                    refresh can stamp a row between the migration and the assertion. The check is
 *                    therefore race-free, and it measures exactly one thing: what the migration did.
 *   · VERIFY-ONLY  — stamped rows are REPORTED, never required to be zero. What is required is the
 *                    ledger row, the six-column shape, and that this invocation wrote nothing.
 *
 * ## Modes
 *
 *   preflight — READ ONLY. `BEGIN TRANSACTION READ ONLY`, posture reported, ROLLBACK. Writes nothing.
 *   apply     — requires confirm_apply AND the protected `production` environment approval. Dispatches
 *               to first-apply or verify-only based on the LEDGER, decided before anything is written.
 *
 * ## Order of operations
 *
 * Every file, checksum and SQL-shape assertion runs BEFORE the connection is constructed. A drifted
 * candidate can therefore never receive a green read-only receipt either — preflight validates the
 * same prepared migration that apply would execute.
 */
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL
export const CONFIRM_TOKEN = 'YES_I_AUTHORIZE_THE_TRUST_SCHEMA_ACTIVATION';

export const MIGRATION = Object.freeze({
  version: '20260817140000',
  name: '20260817140000_issue164_trust_cache_provenance.sql',
  sha12: 'cf0cc7f2c4f5',
});

/** The six nullable stamp columns this migration adds. */
export const TRUST_STAMP_COLUMNS = Object.freeze([
  'trust_calculation_version', 'trust_evaluated_at', 'trust_band',
  'trust_confidence', 'trust_known_limitations', 'trust_evidence_basis',
]);

/** A refusal is a deliberate fail-closed outcome, distinguishable from an unexpected crash. */
export class CutoverRefusal extends Error {
  constructor(message) { super(message); this.name = 'CutoverRefusal'; }
}
const refuse = (m) => { throw new CutoverRefusal(m); };

/**
 * Read the pinned migration, verify its checksum, extract `Up`, and assert its SQL shape.
 *
 * This is the whole safety case for "the runner cannot execute something unreviewed", so it runs
 * before any connection exists. `readFile` is injectable purely so the guards can be tested against
 * tampered content without writing a tampered file into the repository.
 */
export function prepareMigration(readFile = (p) => readFileSync(p, 'utf8')) {
  const sql = readFile(fileURLToPath(new URL(`../../database/migrations/${MIGRATION.name}`, import.meta.url)));
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== MIGRATION.sha12) refuse(`${MIGRATION.name} checksum ${sum} != frozen ${MIGRATION.sha12} — file drifted, refusing.`);

  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');

  // ADDITIVE-ONLY. The safety case is that no historical value is rewritten, so a file that COULD
  // rewrite one is refused before a connection is ever opened.
  if (!/\bADD\s+COLUMN\b/i.test(up)) refuse(`${MIGRATION.name} contains no ADD COLUMN — refusing an unrecognised file.`);
  if (/\bUPDATE\s+(public\.)?vehicles\b/i.test(up)) refuse(`${MIGRATION.name} contains an UPDATE against vehicles; this cutover must not rewrite legacy scores. Refusing.`);
  if (/\bDELETE\s+FROM\s+(public\.)?vehicles\b/i.test(up)) refuse(`${MIGRATION.name} contains a DELETE against vehicles. Refusing.`);
  if (/\bDROP\s+TABLE\b/i.test(up)) refuse(`${MIGRATION.name} contains DROP TABLE. Refusing.`);

  return { ...MIGRATION, up, sum };
}

/** Validate the dispatch environment. Returns the resolved mode; never returns a credential. */
export function resolveMode(env) {
  const url = env.PRODUCTION_DATABASE_URL;
  const prodRef = env.PRODUCTION_PROJECT_REF;
  if (!url) refuse('PRODUCTION_DATABASE_URL is not set.');
  if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) refuse('PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.');
  if (prodRef === STAGING_REF) refuse('PRODUCTION_PROJECT_REF is the staging ref; refusing.');
  if (!url.includes(prodRef)) refuse('connection string does not reference PRODUCTION_PROJECT_REF; refusing.');
  if (url.includes(STAGING_REF)) refuse('connection string references the STAGING project; refusing.');

  const mode = env.MODE === 'apply' ? 'apply' : 'preflight';
  if (mode === 'apply') {
    const supplied = String(env.CONFIRM_APPLY || '').replace(/[   ]/g, ' ').trim();
    if (supplied !== CONFIRM_TOKEN) {
      refuse(`apply mode requires confirm_apply=${CONFIRM_TOKEN}; received a different selection `
           + `(length ${supplied.length}). Re-dispatch with that option selected.`);
    }
  }
  return { mode, url };
}

// ── measurement ───────────────────────────────────────────────────────────────────────────────────

export async function isLedgered(client) {
  const { rows } = await client.query(
    'SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1', [MIGRATION.version]);
  return rows.length > 0;
}

/**
 * The stamp count is queried separately and only when the column exists — before first apply it does
 * not, and a runner that crashed on its own precondition would fail OPEN by looking like an error
 * rather than a measurement.
 */
export async function stampedCount(client) {
  const { rows } = await client.query(
    `select count(*)::int c from information_schema.columns
      where table_schema='public' and table_name='vehicles' and column_name='trust_calculation_version'`);
  if (rows[0].c === 0) return null;
  const { rows: s } = await client.query(
    'select count(*)::int c from public.vehicles where trust_calculation_version is not null');
  return s[0].c;
}

export async function trustPosture(client) {
  const { rows } = await client.query(`
    select
      (select count(*)::int from information_schema.columns
         where table_schema='public' and table_name='vehicles'
           and column_name = any($1::text[]))                              as stamp_columns_present,
      (select count(*)::int from public.vehicles)                          as total_vehicles,
      (select count(*)::int from public.vehicles where trust_score is not null) as legacy_scored_rows,
      (select md5(coalesce(string_agg(vin || '=' || coalesce(trust_score::text,'NULL'), ',' order by vin), ''))
         from public.vehicles)                                             as legacy_score_checksum`,
    [TRUST_STAMP_COLUMNS]);
  const p = rows[0];
  p.stamped_rows = await stampedCount(client);
  return p;
}

export function reportPosture(label, p, log = console.log) {
  log(`\n── ${label} ──`);
  log(`  stamp columns present : ${p.stamp_columns_present} / ${TRUST_STAMP_COLUMNS.length}`);
  log(`  vehicles              : ${p.total_vehicles}`);
  log(`  legacy scored rows    : ${p.legacy_scored_rows}`);
  log(`  legacy score checksum : ${p.legacy_score_checksum}`);
  log(`  rows with a version   : ${p.stamped_rows === null ? 'n/a (column absent)' : p.stamped_rows}`);
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────────

/** READ ONLY, asserted by the server rather than assumed by the client. */
async function assertServerReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  const { rows } = await client.query('SHOW transaction_read_only');
  const v = rows[0].transaction_read_only ?? Object.values(rows[0])[0];
  if (String(v) !== 'on') refuse(`expected a server-asserted READ ONLY transaction, got ${v}. Refusing.`);
}

export async function runPreflight(client, prepared, log = console.log) {
  await assertServerReadOnly(client);
  try {
    const ledgered = await isLedgered(client);
    const p = await trustPosture(client);
    reportPosture('PRODUCTION PREFLIGHT (read-only) — current trust posture', p, log);
    log(`\n  migration ${prepared.version} ledgered : ${ledgered ? 'yes' : 'no'}`);
    log(`  candidate checksum verified pre-connection : sha256:12 ${prepared.sum}`);
    log(ledgered
      ? '\n  apply would take the VERIFY-ONLY path: schema shape and ledger are re-proved, nothing is written.'
      : `\n  apply would take the FIRST-APPLY path: ${TRUST_STAMP_COLUMNS.length - p.stamp_columns_present} of `
        + `${TRUST_STAMP_COLUMNS.length} stamp columns are missing.`);
    log(`  legacy scores that must survive byte-identical: ${p.legacy_scored_rows} rows, checksum ${p.legacy_score_checksum}.`);
  } finally {
    await client.query('ROLLBACK');
  }
  log('\nPREFLIGHT COMPLETE — nothing was written.');
}

/**
 * FIRST APPLY. The migration has never been recorded, so the schema must be untouched: anything else
 * is an unexpected partial state and is refused rather than reconciled by a script.
 */
export async function runFirstApply(client, prepared, log = console.log) {
  const before = await trustPosture(client);
  reportPosture('pre-apply', before, log);

  if (before.stamp_columns_present !== 0) {
    refuse(`unexpected partial state: ${prepared.version} is not ledgered, yet ${before.stamp_columns_present} of `
         + `${TRUST_STAMP_COLUMNS.length} stamp columns already exist. Someone applied this out of band. `
         + 'Reconciling that needs human review, not a script. Refusing.');
  }

  log(`\nApplying #${prepared.version} (${prepared.name}, sha256:12 ${prepared.sum}) in one transaction…`);
  await client.query('BEGIN');
  try {
    await client.query(prepared.up);

    // THE INVARIANT, MEASURED WHERE IT IS TRUE. The ALTER holds ACCESS EXCLUSIVE on public.vehicles
    // until this transaction commits, so nothing else can have stamped a row in between. A non-zero
    // count here means the MIGRATION created stamps — a default, a backfill — and that is the one
    // thing this cutover exists to prevent.
    const introduced = await stampedCount(client);
    if (introduced === null) {
      refuse('post-migration, trust_calculation_version still does not exist — the migration did not take effect.');
    }
    if (introduced !== 0) {
      refuse(`the migration itself introduced ${introduced} trust_calculation_version value(s). `
           + 'An additive migration must stamp nothing. Rolling back.');
    }

    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
      [prepared.version, [prepared.up], prepared.name]);
    await client.query('COMMIT');
    log(`  ok  the migration introduced 0 trust stamps (measured before commit, under the ALTER's lock)`);
    log(`#${prepared.version} applied and recorded.`);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof CutoverRefusal) throw e;
    refuse(`#${prepared.version} failed and rolled back: ${e.message}`);
  }

  const after = await trustPosture(client);
  reportPosture('post-apply', after, log);

  const failures = [];
  if (!(await isLedgered(client))) failures.push(`#${prepared.version} was not recorded`);
  if (after.stamp_columns_present !== TRUST_STAMP_COLUMNS.length) {
    failures.push(`only ${after.stamp_columns_present}/${TRUST_STAMP_COLUMNS.length} stamp columns present`);
  }
  if (after.legacy_score_checksum !== before.legacy_score_checksum) {
    failures.push(`legacy trust_score data CHANGED (${before.legacy_score_checksum} -> ${after.legacy_score_checksum})`);
  }
  if (after.legacy_scored_rows !== before.legacy_scored_rows) {
    failures.push(`scored row count moved ${before.legacy_scored_rows} -> ${after.legacy_scored_rows}`);
  }
  if (failures.length) refuse(`POST-APPLY VERIFICATION FAILED — ${failures.join('; ')}.`);

  log('\nok  six stamp columns present; legacy scores byte-identical; the migration stamped nothing.');
  log('APPLY COMPLETE. refreshCanonicalTrust() can now write canonical trust for governed vehicles.');
  log('    Legacy unversioned scores remain unpublishable by design.');
}

/**
 * VERIFY-ONLY. The migration is already recorded, so a legitimate canonical refresh may since have
 * stamped governed vehicles. That is the system working, not a cutover failure: the count is
 * reported, never required to be zero. The whole pass runs in a server-asserted READ ONLY
 * transaction, which is what proves this invocation wrote nothing.
 */
export async function runVerifyOnly(client, prepared, log = console.log) {
  await assertServerReadOnly(client);
  try {
    const p = await trustPosture(client);
    reportPosture('verify-only (read-only) — already ledgered', p, log);

    const failures = [];
    if (!(await isLedgered(client))) failures.push(`#${prepared.version} is not recorded`);
    if (p.stamp_columns_present !== TRUST_STAMP_COLUMNS.length) {
      failures.push(`only ${p.stamp_columns_present}/${TRUST_STAMP_COLUMNS.length} stamp columns present`);
    }
    if (failures.length) refuse(`VERIFY-ONLY FAILED — ${failures.join('; ')}.`);

    log(`\n  ${p.stamped_rows} of ${p.total_vehicles} vehicles carry a canonical trust version.`);
    log('  That count is REPORTED, not constrained: after activation, refreshCanonicalTrust() is');
    log('  supposed to stamp governed vehicles. Requiring zero here would call a working system broken.');
    log('\nok  ledger present; six stamp columns present; this invocation wrote nothing (server-asserted READ ONLY).');
  } finally {
    await client.query('ROLLBACK');
  }
}

// ── entry point ───────────────────────────────────────────────────────────────────────────────────

export function tlsConfig(env = process.env, log = console.log) {
  const supplied = env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

async function main() {
  // EVERY file, checksum and SQL-shape assertion happens here — before a connection exists.
  const prepared = prepareMigration();
  const { mode, url } = resolveMode(process.env);
  console.log(`Candidate verified before connecting: ${prepared.name} sha256:12 ${prepared.sum}.`);

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
  await client.connect();
  try {
    const { rows: ident } = await client.query('select current_database() db');
    console.log(`Connected (db=${ident[0].db}, mode=${mode}).`);

    const { rows: present } = await client.query("select coalesce(to_regclass('public.vehicles')::text,'ABSENT') t");
    if (present[0].t === 'ABSENT') refuse('public.vehicles is absent — wrong database. Refusing.');

    if (mode === 'preflight') {
      await runPreflight(client, prepared);
    } else if (await isLedgered(client)) {
      console.log(`#${prepared.version} is already recorded — taking the VERIFY-ONLY path.`);
      await runVerifyOnly(client, prepared);
    } else {
      await runFirstApply(client, prepared);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::${e instanceof CutoverRefusal ? e.message : `runner error: ${e.message}`}`);
    process.exit(1);
  });
}
