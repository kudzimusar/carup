#!/usr/bin/env node

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

for (const f of ['backend/.env', '.env.staging', '.env']) {
  if (existsSync(f)) dotenv.config({ path: f });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRODUCTION_REF = 'vhmnajoeicasaigiophh';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';

const APPROVED_MIGRATIONS = [
  '20260613000000_phase7b_supabase_auth_and_identity.sql',
  '20260613020000_verification_admin_review.sql',
  '20260618030000_verification_ocr_provenance.sql',
  '20260618040000_verification_case_management.sql',
  '20260618050000_verification_evidence_trust_columns.sql',
];

const MIGRATIONS_DIR = resolve(__dirname, '..', 'database', 'migrations');

function getProjectRef() {
  const ref = process.env.SUPABASE_PROJECT_REF || '';
  if (ref) return ref;
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_DB_URL || '';
  const m = url.match(/https?:\/\/([^.]+)\./);
  return m ? m[1] : '';
}

function validateRef() {
  const ref = getProjectRef();
  if (!ref) {
    console.error('FATAL: Could not determine project ref.');
    console.error('  Set SUPABASE_PROJECT_REF, or SUPABASE_URL / SUPABASE_DB_URL containing the ref.');
    process.exit(1);
  }
  if (ref === PRODUCTION_REF) {
    console.error('FATAL: Refused target: vhmnajoeicasaigiophh (PRODUCTION).');
    console.error('  This script must never be used against production.');
    process.exit(1);
  }
  if (ref !== STAGING_REF) {
    console.error(`FATAL: Unknown or unauthorized project ref: ${ref}`);
    console.error(`  Allowed: ${STAGING_REF}`);
    process.exit(1);
  }
  return ref;
}

function usage() {
  console.log(`
Usage:
  SUPABASE_PROJECT_REF=eoyenigwevnxwwhyhaer SUPABASE_DB_URL=postgresql://... \\
    node scripts/apply-phase7c-staging-migrations.mjs [OPTION]

Options:
  --verify-only   Run preflight checks only (no migrations applied)
  --dry-run       Print SQL statements without executing (default)
  --apply         Execute migrations against staging

Safety:
  - This script REFUSES to run against production (vhmnajoeicasaigiophh)
  - Only the five approved Phase 7B/7C migration files may be applied
  - Files are applied in the approved order only
  - ON_ERROR_STOP — stops on first failure
  - No unrelated migrations are accepted
`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) usage();

  const mode = args.includes('--apply') ? 'apply' :
    args.includes('--dry-run') ? 'dry-run' :
    'verify-only';

  const ref = validateRef();
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('FATAL: SUPABASE_DB_URL is required.');
    process.exit(1);
  }

  if (mode === 'verify-only') {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║  Phase 7C — Migration Preflight             ║`);
    console.log(`╚══════════════════════════════════════════════╝`);
    console.log(`  Mode:          VERIFY ONLY`);
    console.log(`  Target:        ${ref}`);
    console.log();

    const pg = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();

    try {
      for (const file of APPROVED_MIGRATIONS) {
        const path = resolve(MIGRATIONS_DIR, file);
        if (!existsSync(path)) {
          console.log(`  ✗ MISSING: ${file}`);
          process.exit(1);
        }
        const sql = readFileSync(path, 'utf8').trim();

        const [,,,, filename] = file.split('_');
        const description = (filename || file).replace(/\.sql$/, '').replace(/-/g, ' ');
        console.log(`  ✓ Loaded: ${file} — ${description}`);
        console.log(`    ${sql.split('\n').length} lines, ${Buffer.byteLength(sql)} bytes`);
        console.log();
      }

      console.log('  All 5 approved migration files verified.');
      console.log('  Run with --dry-run to print SQL, or --apply to execute.');
    } finally {
      await client.end();
    }
    return;
  }

  if (mode === 'dry-run') {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║  Phase 7C — Dry Run                         ║`);
    console.log(`╚══════════════════════════════════════════════╝`);
    console.log(`  Mode:          DRY RUN (no SQL executed)`);
    console.log(`  Target:        ${ref}`);
    console.log();

    for (const file of APPROVED_MIGRATIONS) {
      const path = resolve(MIGRATIONS_DIR, file);
      if (!existsSync(path)) {
        console.error(`  ✗ MISSING: ${file}`);
        process.exit(1);
      }
      const sql = readFileSync(path, 'utf8').trim();
      const header = `── ${file} ──`;
      console.log(header);
      console.log();
      console.log(sql);
      console.log();
    }

    console.log('── End of dry-run output ──');
    console.log(`  ${APPROVED_MIGRATIONS.length} files, no SQL executed.`);
    return;
  }

  // -------------------------------------------------------
  // APPLY mode
  // -------------------------------------------------------
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Phase 7C — Applying Staging Migrations     ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  Mode:          APPLY`);
  console.log(`  Target:        ${ref}`);
  console.log(`  Timestamp:     ${new Date().toISOString()}`);
  console.log();

  // Final confirmation
  console.log('  WARNING: This will execute DDL against staging.');
  console.log(`  Project: ${ref}`);
  console.log('  Type YES to confirm:');

  const confirm = await new Promise(resolve => {
    process.stdin.once('data', data => {
      resolve(data.toString().trim());
    });
  });

  if (confirm !== 'YES') {
    console.log('  Aborted.');
    process.exit(0);
  }

  const pg = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  let completed = [];
  let failed = [];

  try {
    for (const file of APPROVED_MIGRATIONS) {
      const path = resolve(MIGRATIONS_DIR, file);
      if (!existsSync(path)) {
        console.error(`  ✗ MISSING: ${file} — aborting`);
        failed.push(file);
        break;
      }

      const sql = readFileSync(path, 'utf8');
      console.log(`  ▶ Starting: ${file}`);

      try {
        await client.query(sql);
        console.log(`  ✓ Completed: ${file}`);
        completed.push(file);
      } catch (err) {
        console.error(`  ✗ FAILED: ${file}`);
        console.error(`    ${err.message}`);
        failed.push(file);
        break;
      }
    }
  } finally {
    await client.end();
  }

  console.log();
  console.log('── Migration Results ──');
  if (failed.length === 0) {
    console.log(`  All ${completed.length} migrations completed successfully.`);
  } else {
    console.log(`  Completed: ${completed.length}`);
    console.log(`  Failed:    ${failed.length}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
