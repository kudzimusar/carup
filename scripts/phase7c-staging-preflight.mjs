#!/usr/bin/env node

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';

for (const f of ['backend/.env', '.env.staging', '.env']) {
  if (existsSync(f)) dotenv.config({ path: f });
}

const PRODUCTION_REF = 'vhmnajoeicasaigiophh';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';

const REQUIRED_TABLES = [
  'users', 'user_sessions', 'login_attempts', 'ocr_documents',
  'verification_sessions', 'trust_audit_events',
  'verification_ocr_provenance', 'verification_assessments', 'verification_decisions',
];

const REQUIRED_SESSION_COLUMNS = [
  'review_decision', 'retry_reason', 'liveness_status',
  'workflow_phase', 'final_disposition', 'primary_reason_code',
  'next_actor', 'required_action', 'notification_status', 'notification_attempted_at',
  'version',
  'evidence_classification', 'ocr_execution_status', 'extraction_trust_status',
  'identity_binding_status', 'selfie_check_status',
];

function getProjectRef() {
  const ref = process.env.SUPABASE_PROJECT_REF || '';
  if (!ref) {
    const url = process.env.SUPABASE_URL || process.env.SUPABASE_DB_URL || '';
    const m = url.match(/https?:\/\/([^.]+)\./);
    return m ? m[1] : '';
  }
  return ref;
}

function validateRef() {
  const ref = getProjectRef();
  if (!ref) {
    console.error('FATAL: Could not determine project ref.');
    console.error('  Set SUPABASE_PROJECT_REF, or SUPABASE_URL / SUPABASE_DB_URL containing the ref.');
    process.exit(1);
  }
  if (ref === PRODUCTION_REF) {
    console.error(`FATAL: Refused target: ${PRODUCTION_REF} (PRODUCTION).`);
    console.error('  This script must never inspect or mutate production.');
    process.exit(1);
  }
  return ref;
}

function bullet(status, label, detail = '') {
  const sym = { PRESENT: '✓', MISSING: '✗', 'TYPE MISMATCH': '~', 'CONSTRAINT MISMATCH': '~' };
  const s = sym[status] || ' ';
  return `  ${s} [${status}] ${label}${detail ? ' — ' + detail : ''}`;
}

function maskUrl(url) {
  if (!url) return '(not set)';
  return url.replace(/:\/\/[^@]+@/, '://****:****@');
}

async function main() {
  const ref = validateRef();
  const mode = process.argv.includes('--apply') ? 'MUTATE' : 'READ-ONLY';

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Phase 7C — Staging Schema Preflight        ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  Target:     ${ref}`);
  console.log(`  Mode:       ${mode}`);
  console.log(`  Timestamp:  ${new Date().toISOString()}`);
  console.log();

  if (mode === 'MUTATE') {
    console.error('FATAL: --apply mode is not supported by the preflight script.');
    console.error('  Use scripts/apply-phase7c-staging-migrations.mjs for DDL.');
    process.exit(1);
  }

  const pg = await import('pg');
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('FATAL: SUPABASE_DB_URL is required.');
    process.exit(1);
  }

  const client = new pg.default.Client({ connectionString: dbUrl });
  await client.connect();

  let exitCode = 0;

  try {
    // -------------------------------------------------------
    // 1. Required base tables
    // -------------------------------------------------------
    console.log('── Required Base Tables ──');
    const { rows: existingTables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `, [REQUIRED_TABLES]);
    const existingSet = new Set(existingTables.map(r => r.table_name));

    for (const table of REQUIRED_TABLES) {
      if (existingSet.has(table)) {
        console.log(bullet('PRESENT', table));
      } else {
        console.log(bullet('MISSING', table));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 2. Storage bucket
    // -------------------------------------------------------
    console.log('── Storage Buckets ──');
    try {
      const { rows: buckets } = await client.query(`
        SELECT id, name, public FROM storage.buckets WHERE name = 'ocr-documents'
      `);
      if (buckets.length === 0) {
        console.log(bullet('MISSING', 'ocr-documents bucket'));
        exitCode = 1;
      } else {
        const b = buckets[0];
        console.log(bullet('PRESENT', `ocr-documents (public=${b.public})`));
        if (b.public) {
          console.log(bullet('CONSTRAINT MISMATCH', 'ocr-documents', 'bucket is public, should be private'));
          exitCode = 1;
        }
      }
    } catch (err) {
      if (err.message?.includes('relation') || err.code === '42P01') {
        console.log('  ! storage.buckets table not accessible (expected pre-migration)');
      } else {
        console.log(`  ! Bucket query error: ${err.message}`);
      }
    }
    console.log();

    // -------------------------------------------------------
    // 3. verification_sessions columns
    // -------------------------------------------------------
    console.log('── verification_sessions Columns ──');
    if (!existingSet.has('verification_sessions')) {
      console.log('  Table does not exist (expected pre-migration)');
    } else {
      const { rows: sessionCols } = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'verification_sessions'
        ORDER BY ordinal_position
      `);
      const colMap = new Map(sessionCols.map(c => [c.column_name, c]));

      for (const col of REQUIRED_SESSION_COLUMNS) {
        const found = colMap.get(col);
        if (!found) {
          console.log(bullet('MISSING', col));
          exitCode = 1;
        } else {
          const nullable = found.is_nullable === 'YES';
          // Types per 20260618040000_verification_case_management.sql:
          // version INTEGER, notification_attempted_at TIMESTAMPTZ, rest TEXT.
          const expectedType = col === 'version'
            ? 'integer'
            : col === 'notification_attempted_at'
              ? 'timestamp with time zone'
              : 'text';
          const typeOk = found.data_type === expectedType
            || found.data_type === 'character varying'
            || (expectedType === 'integer' && found.data_type === 'bigint');
          if (!typeOk) {
            console.log(bullet('TYPE MISMATCH', `${col} (expected ${expectedType}, got ${found.data_type})`));
            exitCode = 1;
          } else {
            console.log(bullet('PRESENT', `${col} (${found.data_type}, ${nullable ? 'nullable' : 'NOT NULL'})`));
          }
        }
      }
    }
    console.log();

    // -------------------------------------------------------
    // 4. RLS status
    // -------------------------------------------------------
    console.log('── RLS Status ──');
    const { rows: rlsRows } = await client.query(`
      SELECT relname AS table_name, relrowsecurity AS rls_enabled
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
        AND relname = ANY($1)
    `, [REQUIRED_TABLES]);

    const rlsMap = new Map(rlsRows.map(r => [r.table_name, r.rls_enabled]));
    for (const table of REQUIRED_TABLES) {
      if (!rlsMap.has(table)) continue;
      const enabled = rlsMap.get(table);
      if (enabled) {
        console.log(bullet('PRESENT', `${table} RLS enabled`));
      } else {
        console.log(bullet('CONSTRAINT MISMATCH', `${table} RLS disabled`));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 5. trust_audit_events compatibility check
    // -------------------------------------------------------
    if (existingSet.has('trust_audit_events')) {
      console.log('── trust_audit_events Compatibility ──');
      const { rows: taeCols } = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'trust_audit_events'
        ORDER BY ordinal_position
      `);

      const repoColumns = [
        'id', 'event_type', 'vin', 'vehicle_id', 'trust_fact',
        'previous_value', 'new_value', 'actor_user_id', 'actor_role', 'actor_tenant_id',
        'actor_type', 'source_dashboard', 'source_route',
        'evidence_ids', 'partsentry_log_ids', 'registry_verification_id',
        'safepay_transaction_id', 'reason', 'decision_notes',
        'request_id', 'ip_address', 'user_agent', 'created_at',
      ];

      const liveColSet = new Set(taeCols.map(c => c.column_name));
      const allPresent = repoColumns.every(c => liveColSet.has(c));

      if (allPresent) {
        console.log(bullet('PRESENT', 'All expected columns exist'));
        console.log('  i No migration needed — trust_audit_events is structurally compatible.');
      } else {
        const missing = repoColumns.filter(c => !liveColSet.has(c));
        for (const col of missing) {
          console.log(bullet('MISSING', `trust_audit_events.${col}`));
        }
        console.log('  i Run additive alignment migration for missing columns.');
        exitCode = 1;
      }

      const { rows: [{ cnt }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM trust_audit_events');
      console.log(`  i Row count: ${cnt}`);
      console.log();
    }

    // -------------------------------------------------------
    // 6: Row counts (pre-migration baseline)
    // -------------------------------------------------------
    console.log('── Pre-Migration Row Counts ──');
    if (existingSet.has('users')) {
      const { rows: [{ cnt: u }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM users');
      console.log(`  users:                  ${u}`);
    }
    if (existingSet.has('user_sessions')) {
      const { rows: [{ cnt: s }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM user_sessions');
      console.log(`  user_sessions:          ${s}`);
    }
    if (existingSet.has('trust_audit_events')) {
      const { rows: [{ cnt: t }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM trust_audit_events');
      console.log(`  trust_audit_events:     ${t}`);
    }
    console.log();

    // -------------------------------------------------------
    // 7. PostgreSQL extensions
    // -------------------------------------------------------
    console.log('── PostgreSQL Extensions ──');
    const { rows: extRows } = await client.query(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`
    );
    if (extRows.length > 0) {
      console.log(bullet('PRESENT', 'pgcrypto extension'));
    } else {
      console.log(bullet('MISSING', 'pgcrypto extension'));
    }
    console.log();

    // -------------------------------------------------------
    // Summary
    // -------------------------------------------------------
    console.log('── Summary ──');
    if (exitCode === 0) {
      console.log('  ✓ All checks passed. Staging is ready for Phase 7C migrations.');
    } else {
      console.log(`  ✗ Some checks failed. Review items flagged MISSING / TYPE MISMATCH / CONSTRAINT MISMATCH.`);
    }
    console.log(`  Project Ref: ${ref}`);
    console.log(`  Connection:  ${maskUrl(dbUrl)}`);
    console.log();

  } finally {
    await client.end();
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Preflight fatal error:', err.message);
  process.exit(1);
});
