/**
 * Seller account-profile staging migration gate.
 *
 * Applies exactly 20260829123000 to the canonical CarUp staging project. The workflow that invokes
 * this file checks out one immutable reviewed candidate and verifies the migration's Git blob hash
 * before this process receives a database credential.
 *
 * Receipt is schema-only: no user/profile values leave the database.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const VERSION = '20260829123000';
const NAME = '20260829123000_user_registration_profiles.sql';
const RECEIPT_PATH = 'seller-registration-profile-staging-receipt.json';

function fail(message) {
  throw new Error(message);
}

function upSql() {
  const source = readFileSync(
    fileURLToPath(new URL(`../../database/migrations/${NAME}`, import.meta.url)),
    'utf8',
  );
  return source.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
}

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied?.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: supplied };
  try {
    const bundled = readFileSync(
      fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)),
      'utf8',
    );
    if (bundled.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: bundled };
  } catch {}
  return { rejectUnauthorized: true };
}

async function ledger(client) {
  const { rows } = await client.query(
    'select version,name from supabase_migrations.schema_migrations where version=$1',
    [VERSION],
  );
  return rows;
}

async function verifyContract(client) {
  const { rows: relation } = await client.query(`
    select c.relrowsecurity rls, c.relforcerowsecurity force_rls
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='user_registration_profiles'`);
  if (!relation.length) return { ok: false, table_present: false };

  const expectedColumns = [
    'user_id', 'account_kind', 'market_relationship', 'country_of_residence', 'city', 'province',
    'intended_use', 'organization_name', 'business_type', 'onboarding_status', 'marketing_consent',
    'terms_acknowledged_at', 'privacy_acknowledged_at', 'created_at', 'updated_at',
  ];
  const { rows: columnRows } = await client.query(`
    select column_name from information_schema.columns
     where table_schema='public' and table_name='user_registration_profiles'`);
  const actualColumns = new Set(columnRows.map(row => row.column_name));
  const missingColumns = expectedColumns.filter(column => !actualColumns.has(column));

  const { rows: constraints } = await client.query(`
    select conname, pg_get_constraintdef(oid) definition
      from pg_constraint
     where conrelid='public.user_registration_profiles'::regclass
     order by conname`);
  const definitions = constraints.map(row => row.definition).join('\n');
  const vocabulary = [
    'individual', 'business',
    'zimbabwe_local', 'diaspora', 'international',
    'buy', 'sell', 'buy_sell', 'professional_services',
    'dealer', 'exporter', 'importer', 'garage', 'mechanic', 'parts_seller', 'insurer', 'lender', 'other',
    'not_required', 'requested', 'in_review', 'approved', 'rejected',
  ];
  const missingVocabulary = vocabulary.filter(value => !definitions.includes(value));

  const privileges = {};
  for (const role of ['anon', 'authenticated']) {
    privileges[role] = {};
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await client.query(
        "select has_table_privilege($1,'public.user_registration_profiles',$2) allowed",
        [role, privilege],
      );
      privileges[role][privilege.toLowerCase()] = Boolean(rows[0]?.allowed);
    }
  }
  const { rows: serviceRows } = await client.query(
    "select has_table_privilege('service_role','public.user_registration_profiles','INSERT') ins, has_table_privilege('service_role','public.user_registration_profiles','SELECT') sel",
  );

  const clientPrivilegesClosed = Object.values(privileges)
    .every(record => Object.values(record).every(Boolean) === false);

  return {
    ok:
      missingColumns.length === 0
      && missingVocabulary.length === 0
      && relation[0].rls === true
      && relation[0].force_rls === true
      && clientPrivilegesClosed
      && serviceRows[0]?.ins === true
      && serviceRows[0]?.sel === true,
    table_present: true,
    rls_enabled: relation[0].rls,
    force_rls: relation[0].force_rls,
    missing_columns: missingColumns,
    missing_vocabulary: missingVocabulary,
    public_client_privileges: privileges,
    service_role_insert: Boolean(serviceRows[0]?.ins),
    service_role_select: Boolean(serviceRows[0]?.sel),
  };
}

const url = process.env.DIASPORA_STAGING_DATABASE_URL;
if (!url) fail('DIASPORA_STAGING_DATABASE_URL is not configured');
if (!url.includes(STAGING_REF)) fail(`database URL does not reference approved CarUp staging project ${STAGING_REF}`);

const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg?.split('=')[1] || 'verify';
if (!['preflight', 'apply', 'verify'].includes(mode)) fail(`unsupported mode ${mode}`);

const receipt = {
  programme: 'Seller UAT account handoff remediation',
  operation: 'registration_profile_schema',
  mode,
  staging_ref: STAGING_REF,
  candidate_sha: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
  migration_version: VERSION,
  generated_at: new Date().toISOString(),
};

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const prereq = await client.query(
    "select current_database() db, to_regclass('public.users')::text users",
  );
  if (!prereq.rows[0]?.users) fail('users table absent; refusing because this is not the expected CarUp database');
  receipt.database = prereq.rows[0].db;

  if (mode === 'preflight') {
    const already = await ledger(client);
    if (already.length) {
      const contract = await verifyContract(client);
      if (!contract.ok) fail(`recorded migration does not satisfy contract: ${JSON.stringify(contract)}`);
      receipt.already_applied = true;
      receipt.contract = contract;
    } else {
      await client.query('BEGIN');
      try {
        await client.query(upSql());
        const contract = await verifyContract(client);
        if (!contract.ok) fail(`preflight contract failed: ${JSON.stringify(contract)}`);
        receipt.contract = contract;
      } finally {
        await client.query('ROLLBACK');
      }
    }
  }

  if (mode === 'apply') {
    const already = await ledger(client);
    if (!already.length) {
      const up = upSql();
      await client.query('BEGIN');
      try {
        await client.query(up);
        await client.query(
          'insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)',
          [VERSION, [up], NAME],
        );
        await client.query('COMMIT');
        receipt.action = 'applied';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } else {
      receipt.action = 'already_applied';
    }
    receipt.contract = await verifyContract(client);
    if (!receipt.contract.ok) fail(`post-apply contract failed: ${JSON.stringify(receipt.contract)}`);
  }

  if (mode === 'verify') {
    receipt.ledger = await ledger(client);
    receipt.contract = await verifyContract(client);
    if (!receipt.ledger.length) fail('migration is not recorded in the Supabase migration ledger');
    if (!receipt.contract.ok) fail(`verification failed: ${JSON.stringify(receipt.contract)}`);
  }

  receipt.status = 'PASS';
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({
    status: receipt.status,
    mode,
    migration_version: VERSION,
    action: receipt.action || null,
    table_present: receipt.contract?.table_present ?? null,
    rls_enabled: receipt.contract?.rls_enabled ?? null,
    force_rls: receipt.contract?.force_rls ?? null,
    public_client_privileges: receipt.contract?.public_client_privileges ?? null,
    service_role_insert: receipt.contract?.service_role_insert ?? null,
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
