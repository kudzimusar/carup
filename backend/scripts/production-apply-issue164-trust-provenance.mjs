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
 * and must stay UNVERSIONED — an unversioned score is precisely what canonicalTrustService refuses
 * to publish, so leaving them unstamped is what demotes them. Stamping the current version onto them
 * would launder unattributable historical values into canonical truth.
 *
 * The migration proves this itself: it takes an md5 over (vin=trust_score) before and after and
 * RAISES rather than commits if the checksum or the scored-row count moves. This runner re-asserts
 * it from OUTSIDE the transaction, because a guarantee made only by the thing being changed is not
 * an independent guarantee.
 *
 * ## Modes
 *
 *   preflight — READ ONLY. `BEGIN TRANSACTION READ ONLY`, posture reported, ROLLBACK. Writes nothing.
 *   apply     — writes. Requires confirm_apply AND the protected `production` environment approval.
 *
 * ## Guards
 *
 *   · the migration is pinned by SHA256 and verified BEFORE any connection is opened;
 *   · a file with no ADD COLUMN, or containing UPDATE/DELETE against vehicles, or DROP TABLE, is
 *     refused — this cutover is additive-only;
 *   · PRODUCTION_PROJECT_REF must be 20 chars, must not be staging, and must appear in the URL;
 *   · the connection string is never printed;
 *   · post-apply verification is fail-closed on the columns AND on the legacy-score invariant.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL
const CONFIRM_TOKEN = 'YES_I_AUTHORIZE_THE_TRUST_SCHEMA_ACTIVATION';

const MIGRATIONS = [
  {
    version: '20260817140000',
    name: '20260817140000_issue164_trust_cache_provenance.sql',
    sha12: 'cf0cc7f2c4f5',
  },
];

/** The six nullable stamp columns this migration adds. */
const TRUST_STAMP_COLUMNS = Object.freeze([
  'trust_calculation_version', 'trust_evaluated_at', 'trust_band',
  'trust_confidence', 'trust_known_limitations', 'trust_evidence_basis',
]);

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

const MODE = process.env.MODE === 'apply' ? 'apply' : 'preflight';
if (MODE === 'apply') {
  const supplied = String(process.env.CONFIRM_APPLY || '')
    .replace(/[   ]/g, ' ')
    .trim();
  if (supplied !== CONFIRM_TOKEN) {
    fail(`apply mode requires confirm_apply=${CONFIRM_TOKEN}; received a different selection `
       + `(length ${supplied.length}). Re-dispatch with that option selected.`);
  }
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

/** Read the pinned migration, verify its checksum, and return only its `Up` section. */
function upSectionOf(m) {
  const sql = readFileSync(fileURLToPath(new URL(`../../database/migrations/${m.name}`, import.meta.url)), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== m.sha12) fail(`${m.name} checksum ${sum} != frozen ${m.sha12} — file drifted, refusing.`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');

  // ADDITIVE-ONLY. The safety case is that no historical value is rewritten, so a file that could
  // rewrite one is refused before any connection is opened.
  if (!/\bADD\s+COLUMN\b/i.test(up)) fail(`${m.name} contains no ADD COLUMN — refusing an unrecognised file.`);
  if (/\bUPDATE\s+(public\.)?vehicles\b/i.test(up)) fail(`${m.name} contains an UPDATE against vehicles; this cutover must not rewrite legacy scores. Refusing.`);
  if (/\bDELETE\s+FROM\s+(public\.)?vehicles\b/i.test(up)) fail(`${m.name} contains a DELETE against vehicles. Refusing.`);
  if (/\bDROP\s+TABLE\b/i.test(up)) fail(`${m.name} contains DROP TABLE. Refusing.`);
  return { up, sum };
}

async function trustPosture(client) {
  const { rows } = await client.query(`
    select
      (select count(*) from information_schema.columns
         where table_schema='public' and table_name='vehicles'
           and column_name = any($1::text[]))                              as stamp_columns_present,
      (select count(*) from public.vehicles)                               as total_vehicles,
      (select count(*) from public.vehicles where trust_score is not null) as legacy_scored_rows,
      (select md5(coalesce(string_agg(vin || '=' || coalesce(trust_score::text,'NULL'), ',' order by vin), ''))
         from public.vehicles)                                             as legacy_score_checksum`,
    [TRUST_STAMP_COLUMNS]);
  return rows[0];
}

function reportPosture(label, p) {
  console.log(`\n── ${label} ──`);
  console.log(`  stamp columns present : ${p.stamp_columns_present} / ${TRUST_STAMP_COLUMNS.length}`);
  console.log(`  vehicles              : ${p.total_vehicles}`);
  console.log(`  legacy scored rows    : ${p.legacy_scored_rows}`);
  console.log(`  legacy score checksum : ${p.legacy_score_checksum}`);
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const { rows: ident } = await client.query('select current_database() db');
  console.log(`Connected (db=${ident[0].db}, mode=${MODE}).`);

  const { rows: present } = await client.query("select coalesce(to_regclass('public.vehicles')::text,'ABSENT') t");
  if (present[0].t === 'ABSENT') fail('public.vehicles is absent — wrong database. Refusing.');

  if (MODE === 'preflight') {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const before = await trustPosture(client);
    reportPosture('PRODUCTION PREFLIGHT (read-only) — current trust posture', before);
    const missing = TRUST_STAMP_COLUMNS.length - Number(before.stamp_columns_present);
    console.log(missing === 0
      ? '\nAll six stamp columns already exist; apply would be verify-only.'
      : `\n${missing} of ${TRUST_STAMP_COLUMNS.length} stamp columns are missing. That is what apply adds.`);
    console.log(`Legacy scores that must survive byte-identical: ${before.legacy_scored_rows} rows, checksum ${before.legacy_score_checksum}.`);
    await client.query('ROLLBACK');
    console.log('\nPREFLIGHT COMPLETE — nothing was written.');
  } else {
    const before = await trustPosture(client);
    reportPosture('pre-apply', before);

    for (const m of MIGRATIONS) {
      const { up, sum } = upSectionOf(m);
      const { rows: existing } = await client.query(
        'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
      if (existing.length) { console.log(`#${m.version} already recorded — verify-only.`); continue; }

      console.log(`Applying #${m.version} (${m.name}, sha256:12 ${sum}) in one transaction…`);
      await client.query('BEGIN');
      try {
        await client.query(up);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
          [m.version, [up], m.name]);
        await client.query('COMMIT');
        console.log(`#${m.version} applied and recorded.`);
      } catch (e) {
        await client.query('ROLLBACK');
        fail(`#${m.version} failed and rolled back: ${e.message}`);
      }
    }

    const after = await trustPosture(client);
    reportPosture('post-apply', after);

    const failures = [];
    const { rows: ledger } = await client.query(
      'SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1', [MIGRATIONS[0].version]);
    if (!ledger.length) failures.push(`#${MIGRATIONS[0].version} was not recorded`);

    if (Number(after.stamp_columns_present) !== TRUST_STAMP_COLUMNS.length) {
      failures.push(`only ${after.stamp_columns_present}/${TRUST_STAMP_COLUMNS.length} stamp columns present`);
    }
    if (after.legacy_score_checksum !== before.legacy_score_checksum) {
      failures.push(`legacy trust_score data CHANGED (${before.legacy_score_checksum} -> ${after.legacy_score_checksum})`);
    }
    if (Number(after.legacy_scored_rows) !== Number(before.legacy_scored_rows)) {
      failures.push(`scored row count moved ${before.legacy_scored_rows} -> ${after.legacy_scored_rows}`);
    }

    // NO STAMP WAS INVENTED. Every legacy score must remain UNVERSIONED — that is what keeps an
    // unattributable historical number out of the canonical contract.
    const { rows: stamped } = await client.query(
      'select count(*)::int c from public.vehicles where trust_calculation_version is not null');
    if (stamped[0].c !== 0) {
      failures.push(`${stamped[0].c} row(s) gained a calculation version during an additive migration`);
    }

    if (failures.length) fail(`POST-APPLY VERIFICATION FAILED — ${failures.join('; ')}.`);

    console.log('\nok  six stamp columns present; legacy scores byte-identical; zero rows stamped.');
    console.log('APPLY COMPLETE. refreshCanonicalTrust() can now write canonical trust for governed');
    console.log('    vehicles. Legacy unversioned scores remain unpublishable by design.');
  }
} catch (e) {
  fail(`runner error: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}
