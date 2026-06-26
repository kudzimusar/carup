/**
 * Marker-aware migration runner for CarUp staging.
 *
 * Reads each migration file, extracts ONLY the -- +migrate Up section,
 * and applies it to the staging Supabase project via a direct pg connection.
 *
 * NEVER applies Down sections.
 * NEVER touches the production project (enforced by URL check).
 * All migrations use IF NOT EXISTS / OR REPLACE — naturally idempotent.
 *
 * Usage:
 *   node database/scripts/apply_migrations_staging.mjs [--dry-run]
 *
 * Requires .env.staging to contain SUPABASE_DB_URL and SUPABASE_URL.
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
const pg = require('pg');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG_DIR = join(ROOT, 'database', 'migrations');

dotenv.config({ path: join(ROOT, '.env.staging'), override: true });

const STAGING_PROJECT = 'eoyenigwevnxwwhyhaer';
const SUPABASE_URL    = process.env.SUPABASE_URL || '';
const DB_URL          = process.env.SUPABASE_DB_URL || '';

if (!SUPABASE_URL.includes(STAGING_PROJECT)) {
  throw new Error(
    `FATAL: SUPABASE_URL does not point to staging project ${STAGING_PROJECT}.\n` +
    `URL: ${SUPABASE_URL}\nRefusing to run against wrong project.`
  );
}
if (!DB_URL) throw new Error('FATAL: SUPABASE_DB_URL is not set in .env.staging');

const isDryRun = process.argv.includes('--dry-run');

// Ordered migration files in dependency order
const MIGRATIONS = [
  // M1–M6 (Vehicle Life Evidence / Intelligence milestones)
  '20260621120000_vehicle_life_evidence_taxonomy_provenance.sql',
  '20260621130000_external_source_ingestion.sql',
  '20260621140000_ai_temporal_disclosure_intelligence.sql',
  '20260621150000_report_versions.sql',
  '20260621160000_governance_disputes_corrections.sql',
  '20260621170000_outbox_dead_letter.sql',
  // Phase 2 — security hardening (after M1–M6 tables exist)
  '20260624120000_vehicle_trust_security_hardening.sql',
  // Phase 3 — OCR field-level extractions
  '20260624130000_vehicle_document_extractions.sql',
  // Phase 4 — publication lifecycle
  '20260624140000_listing_publication_lifecycle.sql',
  // Phase 6 — trust_change_log immutability
  '20260624150000_trust_change_log_immutability.sql',
  // WS2 — external source verification network
  '20260626120000_source_verification_network.sql',
  // WS9 — controlled partner API
  '20260626130000_partner_api.sql',
];

function extractUpSection(filepath) {
  const raw = readFileSync(filepath, 'utf-8');
  const downIdx = raw.indexOf('-- +migrate Down');
  const up = (downIdx >= 0 ? raw.slice(0, downIdx) : raw)
    .replace('-- +migrate Up', '')
    .trim();
  if (!up) throw new Error(`No Up section found in ${filepath}`);
  return up;
}

async function run() {
  console.log('\n🚀 CarUp Staging Migration Runner');
  console.log(`   Project: ${STAGING_PROJECT}`);
  console.log(`   URL:     ${SUPABASE_URL}`);
  console.log(`   Mode:    ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE APPLY'}`);
  console.log(`   Migrations: ${MIGRATIONS.length}\n`);

  if (isDryRun) {
    for (const name of MIGRATIONS) {
      const filepath = join(MIG_DIR, name);
      const exists = existsSync(filepath);
      const size = exists ? extractUpSection(filepath).length : 0;
      console.log(`  [DRY RUN] ${exists ? '✓' : '✗ MISSING'} ${name}${exists ? ` (${size} chars Up)` : ''}`);
    }
    console.log('\n✅ Dry run complete — no changes made.\n');
    return;
  }

  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  const results = [];
  let aborted = null; // set to the failing migration name to STOP on first SQL error

  for (const name of MIGRATIONS) {
    const filepath = join(MIG_DIR, name);
    if (!existsSync(filepath)) {
      console.error(`  ✗ FILE MISSING: ${name}`);
      results.push({ name, status: 'FILE_MISSING' });
      aborted = name; // a missing migration is also a hard stop
      break;
    }

    const sql = extractUpSection(filepath);
    console.log(`  → Applying: ${name} ...`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ OK: ${name}`);
      results.push({ name, status: 'OK' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const msg = err.message || String(err);
      // Log idempotent "already exists" results without failing
      if (msg.includes('already exists') || msg.includes('duplicate_object')) {
        console.log(`  ⚠  ${name}: already applied (idempotent)`);
        results.push({ name, status: 'ALREADY_APPLIED' });
      } else {
        console.error(`  ✗ FAIL: ${name}\n    ${msg}`);
        results.push({ name, status: 'FAIL', error: msg });
        aborted = name; // STOP on first real SQL error
      }
    } finally {
      client.release();
    }

    if (aborted) {
      console.error(`\n⛔ Stopping on first error at ${aborted}. No further migrations attempted.`);
      break;
    }
  }

  await pool.end();

  const ok = results.filter(r => r.status === 'OK' || r.status === 'ALREADY_APPLIED').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const missing = results.filter(r => r.status === 'FILE_MISSING').length;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${ok} OK | ${failed} failed | ${missing} missing\n`);

  if (failed > 0 || missing > 0) {
    results.filter(r => r.status !== 'OK' && r.status !== 'ALREADY_APPLIED').forEach(r => {
      console.error(`  ✗ ${r.name}: ${r.error || r.status}`);
    });
    process.exit(1);
  }
  console.log('✅ All migrations applied to staging successfully.\n');
}

run().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
