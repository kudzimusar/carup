#!/usr/bin/env node

import dotenv from 'dotenv';
import { existsSync } from 'fs';

for (const f of ['backend/.env', '.env.staging', '.env']) {
  if (existsSync(f)) dotenv.config({ path: f });
}

const PRODUCTION_REF = 'vhmnajoeicasaigiophh';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';

const PHASE7C_TABLES = [
  'verification_sessions', 'verification_ocr_provenance',
  'verification_assessments', 'verification_decisions',
];

const PHASE7C_IDENTITY_TABLES = [
  'user_sessions', 'login_attempts', 'ocr_documents',
];

const APP5_TABLES = [
  'users', 'trust_audit_events',
];

const EXPECTED_FOREIGN_KEYS = [
  { fk: 'verification_sessions.user_id', ref: 'users(id)' },
  { fk: 'verification_sessions.ocr_document_id', ref: 'ocr_documents(id)' },
  { fk: 'verification_sessions.reviewed_by', ref: 'users(id)' },
  { fk: 'verification_ocr_provenance.session_id', ref: 'verification_sessions(id)' },
  { fk: 'verification_ocr_provenance.user_id', ref: 'users(id)' },
  { fk: 'verification_ocr_provenance.ocr_document_id', ref: 'ocr_documents(id)' },
  { fk: 'verification_assessments.session_id', ref: 'verification_sessions(id)' },
  { fk: 'verification_decisions.session_id', ref: 'verification_sessions(id)' },
  { fk: 'user_sessions.user_id', ref: 'users(id)' },
  { fk: 'login_attempts.user_id', ref: 'users(id)' },
  { fk: 'ocr_documents.user_id', ref: 'users(id)' },
];

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
    process.exit(1);
  }
  if (ref === PRODUCTION_REF) {
    console.error('FATAL: Refused production target.');
    process.exit(1);
  }
  if (ref !== STAGING_REF) {
    console.error(`FATAL: Unknown project ref: ${ref}`);
    process.exit(1);
  }
  return ref;
}

function bullet(status, label, detail = '') {
  const sym = { PRESENT: '✓', MISSING: '✗', 'TYPE MISMATCH': '~', 'CONSTRAINT MISMATCH': '~' };
  const s = sym[status] || ' ';
  return `  ${s} [${status}] ${label}${detail ? ' — ' + detail : ''}`;
}

async function main() {
  const ref = validateRef();
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('FATAL: SUPABASE_DB_URL is required.');
    process.exit(1);
  }

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Phase 7C — Post-Migration Schema Verify    ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  Target:    ${ref}`);
  console.log();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  let exitCode = 0;

  try {
    // -------------------------------------------------------
    // 1. Tables exist
    // -------------------------------------------------------
    console.log('── Required Tables ──');
    const allTables = [...PHASE7C_TABLES, ...PHASE7C_IDENTITY_TABLES, ...APP5_TABLES];
    const { rows: existingTables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [allTables]);
    const existingSet = new Set(existingTables.map(r => r.table_name));

    for (const table of allTables) {
      if (existingSet.has(table)) {
        console.log(bullet('PRESENT', table));
      } else {
        console.log(bullet('MISSING', table));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 2. Foreign keys
    // -------------------------------------------------------
    console.log('── Foreign Keys ──');
    for (const { fk, ref } of EXPECTED_FOREIGN_KEYS) {
      const [table, column] = fk.split('.');
      if (!existingSet.has(table)) {
        console.log(`  ? [TABLE MISSING] ${fk} → ${ref}`);
        continue;
      }
      const { rows: fkRows } = await client.query(`
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
          AND kcu.column_name = $2
      `, [table, column]);

      if (fkRows.length > 0) {
        console.log(bullet('PRESENT', `${fk} → ${ref}`));
      } else {
        console.log(bullet('MISSING', `${fk} → ${ref}`));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 3. Indexes
    // -------------------------------------------------------
    console.log('── Indexes ──');
    const { rows: idxRows } = await client.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1)
    `, [allTables]);
    const idxMap = new Map();
    for (const row of idxRows) {
      const key = `${row.tablename}.${row.indexname}`;
      idxMap.set(key, row.indexdef);
    }

    const expectedIndexPatterns = [
      { table: 'verification_sessions', pattern: 'workflow_phase' },
      { table: 'verification_sessions', pattern: 'next_actor' },
      { table: 'verification_sessions', pattern: 'primary_reason_code' },
      { table: 'verification_sessions', pattern: 'user_id' },
      { table: 'verification_sessions', pattern: 'status' },
      { table: 'verification_sessions', pattern: 'created_at' },
      { table: 'verification_assessments', pattern: 'session_id' },
      { table: 'verification_assessments', pattern: 'evidence_classification' },
      { table: 'verification_assessments', pattern: 'extraction_trust' },
      { table: 'verification_assessments', pattern: 'created_at' },
      { table: 'verification_decisions', pattern: 'idempotency' },
      { table: 'verification_decisions', pattern: 'session_id' },
      { table: 'verification_decisions', pattern: 'decision' },
      { table: 'verification_decisions', pattern: 'created_at' },
      { table: 'verification_ocr_provenance', pattern: 'session_id' },
      { table: 'verification_ocr_provenance', pattern: 'user_id' },
      { table: 'verification_ocr_provenance', pattern: 'is_mock' },
      { table: 'verification_ocr_provenance', pattern: 'created_at' },
      { table: 'user_sessions', pattern: 'user_id' },
      { table: 'ocr_documents', pattern: 'user' },
      { table: 'trust_audit_events', pattern: 'event_type' },
      { table: 'trust_audit_events', pattern: 'vin' },
      { table: 'trust_audit_events', pattern: 'created_at' },
    ];

    for (const { table, pattern } of expectedIndexPatterns) {
      const found = [...idxMap.keys()].some(k => k.startsWith(table + '.') && k.includes(pattern));
      if (found) {
        console.log(bullet('PRESENT', `${table} idx on ${pattern}`));
      } else if (existingSet.has(table)) {
        console.log(bullet('MISSING', `${table} index on ${pattern}`));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 4. RLS enabled on identity/verification tables
    // -------------------------------------------------------
    console.log('── RLS Status ──');
    const rlsTables = [...PHASE7C_TABLES, ...PHASE7C_IDENTITY_TABLES];
    const { rows: rlsRows } = await client.query(`
      SELECT relname AS table_name, relrowsecurity AS rls_enabled
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
        AND relname = ANY($1)
    `, [rlsTables]);

    for (const row of rlsRows) {
      if (row.rls_enabled) {
        console.log(bullet('PRESENT', `${row.table_name} RLS enabled`));
      } else {
        console.log(bullet('CONSTRAINT MISMATCH', `${row.table_name} RLS disabled`));
        exitCode = 1;
      }
    }
    console.log();

    // -------------------------------------------------------
    // 5. Privilege checks
    // -------------------------------------------------------
    console.log('── Privilege Checks ──');
    const privTables = ['verification_sessions', 'verification_assessments', 'verification_decisions',
      'verification_ocr_provenance', 'user_sessions', 'login_attempts', 'ocr_documents', 'trust_audit_events'];

    for (const table of privTables) {
      if (!existingSet.has(table)) continue;
      const { rows: grants } = await client.query(`
        SELECT grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = $1
          AND grantee IN ('anon', 'authenticated', 'service_role')
      `, [table]);

      const anonGrants = grants.filter(g => g.grantee === 'anon');
      const authGrants = grants.filter(g => g.grantee === 'authenticated');
      const svcGrants = grants.filter(g => g.grantee === 'service_role');

      if (anonGrants.length === 0) {
        console.log(bullet('PRESENT', `${table}: anon has no access`));
      } else {
        console.log(bullet('CONSTRAINT MISMATCH', `${table}: anon has ${anonGrants.map(g => g.privilege_type).join(', ')}`));
        exitCode = 1;
      }

      if (authGrants.length === 0) {
        console.log(bullet('PRESENT', `${table}: authenticated has no direct access`));
      } else {
        console.log(bullet('CONSTRAINT MISMATCH', `${table}: authenticated has ${authGrants.map(g => g.privilege_type).join(', ')}`));
        exitCode = 1;
      }

      if (svcGrants.length > 0) {
        console.log(bullet('PRESENT', `${table}: service_role has access`));
      }
    }
    console.log();

    // -------------------------------------------------------
    // 6. Row preservation
    // -------------------------------------------------------
    console.log('── Row Preservation ──');
    const countTables = ['users', 'user_sessions', 'trust_audit_events'];
    for (const table of countTables) {
      if (!existingSet.has(table)) continue;
      const { rows: [{ cnt }] } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
      console.log(`  ${table}: ${cnt} rows`);
      if (cnt === 0) {
        console.log(`  ! WARNING: ${table} is empty — verify this is expected`);
      }
    }
    console.log();

    // -------------------------------------------------------
    // 7. ocr-documents bucket is private
    // -------------------------------------------------------
    console.log('── Storage Bucket ──');
    try {
      const { rows: buckets } = await client.query(
        `SELECT id, public FROM storage.buckets WHERE name = 'ocr-documents'`
      );
      if (buckets.length > 0) {
        const b = buckets[0];
        if (b.public) {
          console.log(bullet('CONSTRAINT MISMATCH', 'ocr-documents bucket is PUBLIC'));
          exitCode = 1;
        } else {
          console.log(bullet('PRESENT', 'ocr-documents bucket is PRIVATE'));
        }
      }
    } catch (err) {
      if (err.message?.includes('relation') || err.code === '42P01') {
        console.log('  ! storage.buckets not accessible');
      } else {
        console.log(`  ! ${err.message}`);
      }
    }
    console.log();

    // -------------------------------------------------------
    // Summary
    // -------------------------------------------------------
    console.log('── Summary ──');
    if (exitCode === 0) {
      console.log('  ✓ Schema verification passed. All Phase 7C objects are correctly deployed.');
    } else {
      console.log(`  ✗ Verification failed — review MISSING/CONSTRAINT MISMATCH items above.`);
    }

  } finally {
    await client.end();
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Verification fatal error:', err.message);
  process.exit(1);
});
