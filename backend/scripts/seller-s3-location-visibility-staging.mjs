/**
 * Seller Journey 1.0 / S3 — staging-only application of the location-visibility vocabulary widening.
 *
 * This is a SIBLING of the S0 taxonomy gate, not an extension of it. S0 is certified against an
 * immutable candidate; mutating that gate to carry S3's migration would invalidate a certification
 * that has already been signed off. The two gates therefore run independently against the same
 * approved staging project.
 *
 * Modes:
 *   preflight — apply inside one rollback-only transaction and prove the widened constraint holds
 *               and that no existing seller consent value would be disturbed.
 *   apply     — apply transactionally with the official Supabase migration ledger, then verify.
 *   verify    — read-only proof that the constraint in force accepts exactly the declared vocabulary.
 *
 * The receipt records counts and vocabulary only. No VIN, user, seller, city, phone or email value
 * is written to it: a privacy migration must not produce a privacy leak in its own evidence.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { parseCheckVocabulary } from '../utils/checkConstraintVocabulary.js';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const RECEIPT_PATH = 'seller-s3-location-visibility-receipt.json';
const CONSTRAINT = 'vehicles_listing_location_visibility_vocabulary';
const MIGRATIONS = [
  { version: '20260828160000', name: '20260828160000_seller_s3_location_visibility_province_only.sql' },
];

/** The vocabulary the projection understands. The database must accept exactly this set. */
const EXPECTED_VOCABULARY = ['province_only', 'public', 'withheld'];

function fail(message) {
  throw new Error(message);
}

function upSql(name) {
  const source = readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), 'utf8');
  // The Down section is commented documentation in this migration, so only the Up block executes.
  return source.split(/^-- Down$/m)[0].replace(/^-- Up\s*/m, '');
}

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied?.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: supplied };
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: bundled };
  } catch {}
  return { rejectUnauthorized: true };
}

/**
 * What sellers have actually chosen, as counts per value. This is the number the migration must not
 * move: a widening that reinterprets an existing consent decision is not a widening.
 */
async function consentDistribution(client) {
  const { rows } = await client.query(`
    select coalesce(listing_location_visibility, '(null)') value, count(*)::int count
      from public.vehicles
     group by 1
     order by 1`);
  return rows;
}

/** The vocabulary the constraint IN FORCE accepts, read back out of the database itself. */
async function vocabularyInForce(client) {
  const { rows } = await client.query(
    'select pg_get_constraintdef(oid) def from pg_constraint where conrelid=$1::regclass and conname=$2',
    ['public.vehicles', CONSTRAINT],
  );
  if (!rows.length) return { present: false, values: [] };
  const values = parseCheckVocabulary(rows[0].def);
  return { present: true, values: [...new Set(values)].sort(), definition_length: rows[0].def.length };
}

async function ledger(client) {
  const { rows } = await client.query(
    'select version,name from supabase_migrations.schema_migrations where version=any($1::text[]) order by version',
    [MIGRATIONS.map(m => m.version)],
  );
  return rows;
}

async function verifyContract(client) {
  const vocabulary = await vocabularyInForce(client);
  const provenanceGuard = await client.query(
    'select 1 from pg_constraint where conrelid=$1::regclass and conname=$2',
    ['public.vehicles', 'vehicles_listing_location_requires_source'],
  );
  const missing = EXPECTED_VOCABULARY.filter(value => !vocabulary.values.includes(value));
  const unexpected = vocabulary.values.filter(value => !EXPECTED_VOCABULARY.includes(value));
  return {
    constraint_present: vocabulary.present,
    vocabulary_in_force: vocabulary.values,
    missing_values: missing,
    unexpected_values: unexpected,
    // The widening must not have taken the provenance guard with it.
    provenance_guard_present: provenanceGuard.rowCount === 1,
    ok: vocabulary.present
      && missing.length === 0
      && unexpected.length === 0
      && provenanceGuard.rowCount === 1,
  };
}

async function preflight(client) {
  const before = await consentDistribution(client);
  await client.query('BEGIN');
  try {
    for (const migration of MIGRATIONS) await client.query(upSql(migration.name));
    const contract = await verifyContract(client);
    if (!contract.ok) fail(`preflight contract verification failed: ${JSON.stringify(contract)}`);
    const during = await consentDistribution(client);
    if (JSON.stringify(during) !== JSON.stringify(before)) {
      fail('preflight detected a change to recorded seller consent values; refusing');
    }
  } finally {
    await client.query('ROLLBACK');
  }
  return { before, preflight_ok: true, ledger_before: await ledger(client) };
}

async function apply(client) {
  const before = await consentDistribution(client);
  const applied = [];
  for (const migration of MIGRATIONS) {
    const existing = await client.query(
      'select 1 from supabase_migrations.schema_migrations where version=$1',
      [migration.version],
    );
    if (existing.rowCount) {
      applied.push({ ...migration, action: 'already_applied' });
      continue;
    }
    const up = upSql(migration.name);
    await client.query('BEGIN');
    try {
      await client.query(up);
      await client.query(
        'insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)',
        [migration.version, [up], migration.name],
      );
      await client.query('COMMIT');
      applied.push({ ...migration, action: 'applied' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const contract = await verifyContract(client);
  if (!contract.ok) fail(`post-apply contract verification failed: ${JSON.stringify(contract)}`);
  const after = await consentDistribution(client);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    fail(`the migration changed recorded seller consent: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
  return { before, applied, contract, after, ledger_after: await ledger(client) };
}

const url = process.env.DIASPORA_STAGING_DATABASE_URL;
if (!url) fail('DIASPORA_STAGING_DATABASE_URL is not configured');
if (!url.includes(STAGING_REF)) fail(`database URL does not reference approved CarUp staging project ${STAGING_REF}`);

const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg?.split('=')[1] || 'verify';
if (!['preflight', 'apply', 'verify'].includes(mode)) fail(`unsupported mode ${mode}`);

const receipt = {
  programme: 'Seller Journey 1.0',
  phase: 'S3',
  operation: 'location_visibility_vocabulary_widening',
  mode,
  staging_ref: STAGING_REF,
  candidate_sha: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
  expected_vocabulary: EXPECTED_VOCABULARY,
  generated_at: new Date().toISOString(),
};

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const prereq = await client.query("select current_database() db, to_regclass('public.vehicles')::text vehicles");
  if (!prereq.rows[0]?.vehicles) fail('vehicles table absent; refusing because this is not the expected CarUp database');
  receipt.database = prereq.rows[0].db;

  if (mode === 'preflight') Object.assign(receipt, await preflight(client));
  if (mode === 'apply') Object.assign(receipt, await apply(client));
  if (mode === 'verify') {
    receipt.contract = await verifyContract(client);
    receipt.ledger = await ledger(client);
    receipt.distribution = await consentDistribution(client);
    if (!receipt.contract.ok) fail(`verification failed: ${JSON.stringify(receipt.contract)}`);
  }

  receipt.status = 'PASS';
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({
    status: receipt.status,
    mode,
    vocabulary_in_force: receipt.contract?.vocabulary_in_force ?? null,
    provenance_guard_present: receipt.contract?.provenance_guard_present ?? null,
    ledger: receipt.ledger_after ?? receipt.ledger ?? receipt.ledger_before ?? [],
  }));
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = error.message;
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
