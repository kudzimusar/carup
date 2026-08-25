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
 *   · FIRST APPLY  — the count is taken INSIDE the migration transaction, BEFORE COMMIT. The
 *                    transaction takes ACCESS EXCLUSIVE on public.vehicles up front, so no
 *                    concurrent refresh can stamp a row between the migration and the assertion.
 *                    The check is race-free, and measures exactly one thing: what the migration did.
 *   · VERIFY-ONLY  — stamped rows are REPORTED, never required to be zero. What is required is the
 *                    ledger row, the column SHAPE, and that this invocation wrote nothing.
 *
 * ## Two corollaries, both learned from review
 *
 * SHAPE, NOT NAMES. Six columns with the right names but a drifted type, a NOT NULL, or a DEFAULT
 * satisfy a name count and break the contract — a DEFAULT would fabricate provenance on every
 * future insert. Both apply paths assert type, nullability and default per column.
 *
 * MEASURE UNDER THE LOCK. Application writes are not migration changes. Every legacy-score reading
 * is taken inside the migration transaction while it holds the table, so a legitimate
 * refreshCanonicalTrust() landing straight after COMMIT can never be misreported as the migration
 * having rewritten history. Post-commit, only stable DDL facts are asserted.
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

/**
 * The six stamp columns and their REQUIRED shape — the migration's `c_names`/`c_types` pairing,
 * verified against staging where the migration has actually run.
 *
 * Counting names is not enough. A column that exists but drifted to the wrong type, or picked up a
 * NOT NULL, or — worst — acquired a DEFAULT, satisfies a name count while breaking the contract:
 * canonical cache writes or reads fail on a type mismatch, and a DEFAULT would fabricate provenance
 * on every future insert, which is precisely the laundering this cutover exists to prevent.
 */
export const EXPECTED_COLUMN_SHAPE = Object.freeze({
  trust_calculation_version: 'text',
  trust_evaluated_at: 'timestamptz',
  trust_band: 'text',
  trust_confidence: 'text',
  trust_known_limitations: 'jsonb',
  trust_evidence_basis: 'jsonb',
});

export const TRUST_STAMP_COLUMNS = Object.freeze(Object.keys(EXPECTED_COLUMN_SHAPE));

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

/** The live definition of each stamp column: type, nullability and default. */
export async function columnShape(client) {
  const { rows } = await client.query(
    `select column_name, udt_name, is_nullable, column_default
       from information_schema.columns
      where table_schema='public' and table_name='vehicles' and column_name = any($1::text[])
      order by column_name`, [TRUST_STAMP_COLUMNS]);
  return rows;
}

/** Every way the live schema can fail the contract, named individually rather than as a count. */
export function shapeFailures(rows) {
  const byName = new Map(rows.map((r) => [r.column_name, r]));
  const out = [];
  for (const [name, type] of Object.entries(EXPECTED_COLUMN_SHAPE)) {
    const r = byName.get(name);
    if (!r) { out.push(`${name} is missing`); continue; }
    if (r.udt_name !== type) out.push(`${name} is ${r.udt_name}, expected ${type}`);
    if (String(r.is_nullable).toUpperCase() !== 'YES') out.push(`${name} is NOT NULL; the contract requires nullable`);
    if (r.column_default !== null && r.column_default !== undefined) {
      out.push(`${name} carries a DEFAULT (${r.column_default}) — a default fabricates provenance on every insert`);
    }
  }
  return out;
}

export async function assertColumnShape(client, context) {
  const failures = shapeFailures(await columnShape(client));
  if (failures.length) refuse(`${context} — schema shape is wrong: ${failures.join('; ')}.`);
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
    if (ledgered) {
      log('\n  apply would take the VERIFY-ONLY path: ledger and column SHAPE are re-proved, nothing is written.');
      const failures = shapeFailures(await columnShape(client));
      log(failures.length
        ? `  WARNING — the live shape already violates the contract: ${failures.join('; ')}`
        : '  the live column shape already matches the contract.');
    } else {
      log(`\n  apply would take the FIRST-APPLY path: ${TRUST_STAMP_COLUMNS.length - p.stamp_columns_present} of `
        + `${TRUST_STAMP_COLUMNS.length} stamp columns are missing.`);
    }
    log(`  legacy scores that must survive byte-identical: ${p.legacy_scored_rows} rows, checksum ${p.legacy_score_checksum}.`);
  } finally {
    await client.query('ROLLBACK');
  }
  log('\nPREFLIGHT COMPLETE — nothing was written.');
}

/**
 * FIRST APPLY. The migration has never been recorded, so the schema must be untouched: anything else
 * is an unexpected partial state and is refused rather than reconciled by a script.
 *
 * EVERY DATA MEASUREMENT HAPPENS UNDER THE LOCK. The transaction takes ACCESS EXCLUSIVE on
 * public.vehicles up front — the same lock the ALTER would take anyway, just acquired a moment
 * earlier — so the before and after readings are separated by nothing except the migration itself.
 * Measuring after COMMIT instead would let a legitimate refreshCanonicalTrust() write land between
 * the commit and the reading and be misreported as "the migration changed legacy scores", which
 * would announce a failed cutover after a successful one. Application writes are not migration
 * changes, and the runner must not confuse the two in either direction.
 */
export async function runFirstApply(client, prepared, log = console.log) {
  const advisory = await trustPosture(client);
  reportPosture('pre-apply (advisory, outside the lock)', advisory, log);

  if (advisory.stamp_columns_present !== 0) {
    refuse(`unexpected partial state: ${prepared.version} is not ledgered, yet ${advisory.stamp_columns_present} of `
         + `${TRUST_STAMP_COLUMNS.length} stamp columns already exist. Someone applied this out of band. `
         + 'Reconciling that needs human review, not a script. Refusing.');
  }

  log(`\nApplying #${prepared.version} (${prepared.name}, sha256:12 ${prepared.sum}) in one transaction…`);
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE public.vehicles IN ACCESS EXCLUSIVE MODE');
    const before = await trustPosture(client);

    await client.query(prepared.up);

    // THE INVARIANT, MEASURED WHERE IT IS TRUE. Nothing else can hold the table, so a non-zero count
    // here means the MIGRATION created stamps — a default, a backfill — and that is the one thing
    // this cutover exists to prevent.
    const introduced = await stampedCount(client);
    if (introduced === null) {
      refuse('post-migration, trust_calculation_version still does not exist — the migration did not take effect.');
    }
    if (introduced !== 0) {
      refuse(`the migration itself introduced ${introduced} trust_calculation_version value(s). `
           + 'An additive migration must stamp nothing. Rolling back.');
    }

    // Legacy data, re-read under the same lock: any difference is attributable to the migration.
    const after = await trustPosture(client);
    if (after.legacy_score_checksum !== before.legacy_score_checksum) {
      refuse(`the migration changed legacy trust_score data (${before.legacy_score_checksum} -> ${after.legacy_score_checksum}). Rolling back.`);
    }
    if (after.legacy_scored_rows !== before.legacy_scored_rows) {
      refuse(`the migration moved the scored row count ${before.legacy_scored_rows} -> ${after.legacy_scored_rows}. Rolling back.`);
    }

    await assertColumnShape(client, 'post-migration, before commit');

    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
      [prepared.version, [prepared.up], prepared.name]);
    await client.query('COMMIT');

    log(`  ok  the migration introduced 0 trust stamps`);
    log(`  ok  legacy scores byte-identical under the lock (${after.legacy_score_checksum}, ${after.legacy_scored_rows} rows)`);
    log(`  ok  all six columns match the declared shape`);
    log(`#${prepared.version} applied and recorded.`);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof CutoverRefusal) throw e;
    refuse(`#${prepared.version} failed and rolled back: ${e.message}`);
  }

  // POST-COMMIT: DDL facts only. These are stable — no application write can change them — so
  // asserting on them cannot produce the spurious failure that a post-commit data reading would.
  const failures = [];
  if (!(await isLedgered(client))) failures.push(`#${prepared.version} was not recorded`);
  failures.push(...shapeFailures(await columnShape(client)));
  if (failures.length) refuse(`POST-APPLY VERIFICATION FAILED — ${failures.join('; ')}.`);

  reportPosture('post-apply (informational — application writes here are not migration changes)',
    await trustPosture(client), log);

  log('\nok  ledger recorded; six columns match the declared shape; the migration stamped nothing');
  log('    and left every legacy score byte-identical.');
  log('APPLY COMPLETE. refreshCanonicalTrust() can now write canonical trust for governed vehicles.');
  log('    Legacy unversioned scores remain unpublishable by design.');
}

/**
 * VERIFY-ONLY. The migration is already recorded, so a legitimate canonical refresh may since have
 * stamped governed vehicles. That is the system working, not a cutover failure: the count is
 * reported, never required to be zero.
 *
 * This path exists to RE-PROVE THE SCHEMA, so it checks the actual definition of each column — type,
 * nullability, default — not merely that six names exist. A `trust_evidence_basis` silently
 * recreated as `text` instead of `jsonb` passes a name count and breaks every canonical cache read.
 *
 * The whole pass runs in a server-asserted READ ONLY transaction, which is what proves this
 * invocation wrote nothing.
 */
export async function runVerifyOnly(client, prepared, log = console.log) {
  await assertServerReadOnly(client);
  try {
    const p = await trustPosture(client);
    reportPosture('verify-only (read-only) — already ledgered', p, log);

    if (!(await isLedgered(client))) refuse(`VERIFY-ONLY FAILED — #${prepared.version} is not recorded.`);
    await assertColumnShape(client, 'VERIFY-ONLY FAILED');

    log('\n  column shape, as required:');
    for (const r of await columnShape(client)) {
      log(`    ${r.column_name.padEnd(26)} ${r.udt_name.padEnd(12)} nullable=${r.is_nullable} default=${r.column_default ?? 'none'}`);
    }
    log(`\n  ${p.stamped_rows} of ${p.total_vehicles} vehicles carry a canonical trust version.`);
    log('  That count is REPORTED, not constrained: after activation, refreshCanonicalTrust() is');
    log('  supposed to stamp governed vehicles. Requiring zero here would call a working system broken.');
    log('\nok  ledger present; all six columns match the declared shape; this invocation wrote nothing');
    log('    (server-asserted READ ONLY).');
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
