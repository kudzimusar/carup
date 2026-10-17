/**
 * CarUp staging migration runner (OC-5R) — plan-driven, canonical-parser-only, ledger-honest.
 *
 * Replaces the earlier hard-coded 25-file runner, which never wrote the canonical ledger, truncated an Up
 * section at the first "-- +migrate Down" substring, and reported a rolled-back "already exists" failure
 * as ALREADY_APPLIED. The behaviour lives in ./lib/stagingMigrationRunner.mjs (unit- and mutation-tested by
 * backend/tests/oc5r-staging-migration-runner.test.js); this file only wires the target and the plan.
 *
 * Usage:
 *   node database/scripts/apply_migrations_staging.mjs --plan <plan.json> [--apply] [--receipt <file>]
 *   node database/scripts/apply_migrations_staging.mjs --plan <plan.json> --rehearsal [--apply]
 *
 * Without --apply it is a DRY RUN: preconditions and claimed effects are probed read-only, nothing is written.
 * Live target: SUPABASE_DB_URL from .env.staging (or STAGING_DATABASE_URL); it must positively be the
 * staging project and never production. --rehearsal targets REHEARSAL_DATABASE_URL, which must be a
 * loopback database named oc5r_rehearsal*.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertNotSqliteDialect } from '../../backend/db/migrationParser.js';
import { assertStagingTarget, runPlan, RunnerRefusal } from './lib/stagingMigrationRunner.mjs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
const pg = require('pg');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG_DIR = join(ROOT, 'database', 'migrations');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const planPath = value('--plan');
  if (!planPath) throw new RunnerRefusal('NO_PLAN', 'pass --plan <plan.json>; there is no built-in migration list');
  const rehearsal = flag('--rehearsal');
  const apply = flag('--apply');
  if (!rehearsal) dotenv.config({ path: join(ROOT, '.env.staging'), override: true, quiet: true });
  const url = rehearsal ? process.env.REHEARSAL_DATABASE_URL : (process.env.STAGING_DATABASE_URL || process.env.SUPABASE_DB_URL);
  const target = assertStagingTarget(url, { rehearsal });

  const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
  for (const op of plan.operations || []) assertNotSqliteDialect(op.file); // OC-4A: never execute SQLite-era SQL

  const client = new pg.Client({
    connectionString: url,
    ssl: target.kind === 'rehearsal' ? false : { rejectUnauthorized: false },
    application_name: 'oc5r-staging-runner',
  });
  await client.connect();
  try {
    // A dry run cannot write even by accident: the whole session is read-only.
    if (!apply) await client.query('set default_transaction_read_only = on');
    const ledger = await client.query("select to_regclass('supabase_migrations.schema_migrations') as t");
    if (!ledger.rows[0].t) throw new RunnerRefusal('NO_LEDGER', 'supabase_migrations.schema_migrations is absent on the target');
    const db = { exec: (sql) => client.query(sql), query: async (sql, params) => (await client.query(sql, params)).rows };
    const receipt = await runPlan(db, plan, { migrationsDir: MIG_DIR, apply });
    receipt.target = target;
    const out = JSON.stringify(receipt, null, 2);
    const receiptPath = value('--receipt');
    if (receiptPath) writeFileSync(resolve(receiptPath), `${out}\n`);
    console.log(out);
    const failed = receipt.result === 'STOPPED' || receipt.operations.some((o) => ['BLOCKED', 'FAILED_ROLLED_BACK', 'DRIFT', 'REFUSED'].includes(o.status));
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof RunnerRefusal ? `REFUSED ${err.code}: ${err.message}` : `FATAL: ${err.message}`);
  process.exitCode = 2;
});
