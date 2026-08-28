/**
 * Seller Journey 1.0 / S0 — staging-only global taxonomy migration + M0 inventory gate.
 *
 * Modes:
 *   preflight — read current taxonomy distributions, execute both migrations inside one rollback-only
 *               transaction, and prove they can apply without changing staging.
 *   apply     — capture M0 inventory, apply each reviewed migration transactionally with the official
 *               Supabase migration ledger, then verify the additive schema and capture post-state.
 *   verify    — read-only schema + inventory proof.
 *
 * No VIN, user, seller, phone, email or other identifying value is written to the receipt.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const RECEIPT_PATH = 'seller-s0-taxonomy-staging-receipt.json';
const MIGRATIONS = [
  { version: '20260828133000', name: '20260828133000_global_vehicle_taxonomy_s0.sql' },
  { version: '20260828140000', name: '20260828140000_global_vehicle_taxonomy_imports_s0.sql' },
  { version: '20260828143000', name: '20260828143000_global_vehicle_taxonomy_color_s0.sql' },
];

function fail(message) {
  throw new Error(message);
}

function upSql(name) {
  const source = readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), 'utf8');
  const marker = source.split(/^-- \+migrate Down/m)[0];
  return marker.replace(/^-- \+migrate Up\s*/m, '');
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

async function distribution(client, table, expression, label, where = '') {
  const exists = await client.query('select to_regclass($1)::text v', [`public.${table}`]);
  if (!exists.rows[0]?.v) return { label, state: 'table_absent', values: [] };
  const sql = `
    select ${expression} value, count(*)::int count
      from ${table}
      ${where}
     group by 1
     order by count(*) desc, 1
     limit 250`;
  const { rows } = await client.query(sql);
  return { label, state: 'recorded', values: rows };
}

async function m0Inventory(client) {
  const vehicleCount = await client.query("select count(*)::int v from vehicles");
  const columns = await client.query(`
    select column_name
      from information_schema.columns
     where table_schema='public' and table_name='vehicles'
     order by ordinal_position`);
  const vehicleColumns = new Set(columns.rows.map(row => row.column_name));
  const out = {
    vehicles_total: vehicleCount.rows[0]?.v ?? null,
    vehicle_columns: [...vehicleColumns],
    distributions: [],
  };
  const safeText = column => `coalesce(nullif(btrim(${column}::text),''),'__MISSING__')`;
  for (const [column, label] of [
    ['make','make'],['model','model'],['year','year'],['fuel_type','fuel_type'],
    ['transmission','transmission'],['drivetrain','drivetrain'],['color','color'],['import_source','import_source'],
  ]) {
    if (vehicleColumns.has(column)) out.distributions.push(await distribution(client, 'vehicles', safeText(column), label));
  }
  if (vehicleColumns.has('make') && vehicleColumns.has('model')) {
    out.distributions.push(await distribution(
      client,
      'vehicles',
      `coalesce(nullif(btrim(make::text),''),'__MISSING__') || ' / ' || coalesce(nullif(btrim(model::text),''),'__MISSING__')`,
      'make_model',
    ));
  }

  const orderExists = await client.query("select to_regclass('public.diaspora_import_orders')::text v");
  if (orderExists.rows[0]?.v) {
    out.imports = {};
    const orderCols = await client.query(`
      select column_name from information_schema.columns
       where table_schema='public' and table_name='diaspora_import_orders'`);
    const set = new Set(orderCols.rows.map(row => row.column_name));
    for (const [column,label] of [['requested_make','requested_make'],['requested_model','requested_model'],['requested_year_min','requested_year_min']]) {
      if (set.has(column)) out.imports[label] = await distribution(client,'diaspora_import_orders',safeText(column),label);
    }
  }
  return out;
}

async function verifySchema(client) {
  const requiredVehicleColumns = [
    'seller_description','seller_features','body_style','seller_stated_condition',
    'make_taxon_id','model_taxon_id','fuel_taxon_id','transmission_taxon_id','drivetrain_taxon_id',
    'body_style_taxon_id','color_taxon_id','taxonomy_version','taxonomy_resolution','taxonomy_source_values','taxonomized_at',
  ];
  const requiredImportColumns = [
    'requested_make_taxon_id','requested_model_taxon_id','taxonomy_version',
    'taxonomy_resolution','taxonomy_source_values','taxonomized_at',
  ];
  async function missing(table, columns) {
    const { rows } = await client.query(`
      select column_name from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=any($2::text[])`, [table, columns]);
    const found = new Set(rows.map(row => row.column_name));
    return columns.filter(column => !found.has(column));
  }
  const observations = await client.query("select to_regclass('public.vehicle_taxonomy_observations')::text v");
  const result = {
    missing_vehicle_columns: await missing('vehicles', requiredVehicleColumns),
    missing_import_columns: await missing('diaspora_import_orders', requiredImportColumns),
    observations_table_present: Boolean(observations.rows[0]?.v),
  };
  result.ok = result.missing_vehicle_columns.length === 0
    && result.missing_import_columns.length === 0
    && result.observations_table_present;
  return result;
}

async function ledger(client) {
  const { rows } = await client.query(
    'select version,name from supabase_migrations.schema_migrations where version=any($1::text[]) order by version',
    [MIGRATIONS.map(m => m.version)],
  );
  return rows;
}

async function preflight(client) {
  const before = await m0Inventory(client);
  await client.query('BEGIN');
  try {
    for (const migration of MIGRATIONS) await client.query(upSql(migration.name));
    const schema = await verifySchema(client);
    if (!schema.ok) fail(`preflight schema verification failed: ${JSON.stringify(schema)}`);
  } finally {
    await client.query('ROLLBACK');
  }
  return { before, preflight_ok: true, ledger_before: await ledger(client) };
}

async function apply(client) {
  const before = await m0Inventory(client);
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
  const schema = await verifySchema(client);
  if (!schema.ok) fail(`post-apply schema verification failed: ${JSON.stringify(schema)}`);
  return { before, applied, schema, ledger_after: await ledger(client), after: await m0Inventory(client) };
}

const url = process.env.DIASPORA_STAGING_DATABASE_URL;
if (!url) fail('DIASPORA_STAGING_DATABASE_URL is not configured');
if (!url.includes(STAGING_REF)) fail(`database URL does not reference approved CarUp staging project ${STAGING_REF}`);

const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg?.split('=')[1] || 'verify';
if (!['preflight','apply','verify'].includes(mode)) fail(`unsupported mode ${mode}`);

const receipt = {
  programme: 'Seller Journey 1.0',
  phase: 'S0',
  operation: 'global_vehicle_taxonomy_staging',
  mode,
  staging_ref: STAGING_REF,
  candidate_sha: process.env.CANDIDATE_SHA || process.env.GITHUB_SHA || null,
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
    receipt.schema = await verifySchema(client);
    receipt.ledger = await ledger(client);
    receipt.inventory = await m0Inventory(client);
    if (!receipt.schema.ok) fail(`verification failed: ${JSON.stringify(receipt.schema)}`);
  }

  receipt.status = 'PASS';
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({
    status: receipt.status,
    mode,
    vehicles_total: receipt.before?.vehicles_total ?? receipt.inventory?.vehicles_total ?? receipt.after?.vehicles_total ?? null,
    schema_ok: receipt.schema?.ok ?? true,
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
