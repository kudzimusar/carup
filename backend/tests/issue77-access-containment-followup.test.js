import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static SQL-review tests for the Issue #77 access-control containment follow-up.
// These run without any database connection: they assert the migration's
// invariants (least privilege, preserved required paths, idempotency, and the
// absence of destructive / schema-redesign statements).

const followupSql = readFileSync(
  new URL('../../database/migrations/20260620232827_issue77_access_containment_followup.sql', import.meta.url),
  'utf8',
);
const originalSql = readFileSync(
  new URL('../../database/migrations/20260619201406_production_access_containment.sql', import.meta.url),
  'utf8',
);

// Executable SQL with -- comments stripped, so assertions about code never
// match prose in the migration header/comments.
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}
const followupCode = stripSqlComments(followupSql);

test('original reconciled containment migration is left unchanged and canonical', () => {
  // Key markers of the canonical original migration must still be present.
  for (const marker of [
    "'payment_transactions'",
    "'financial_ledger'",
    "'identity_documents'",
    'ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE public.%I FROM anon, authenticated',
    'GRANT ALL ON TABLE public.%I TO service_role',
    'public.diaspora_can_access_order(uuid, text)',
  ]) {
    assert.equal(originalSql.includes(marker), true, `original migration must still contain: ${marker}`);
  }
  // The follow-up must be a separate file that does not re-declare the table sweep.
  assert.equal(followupSql.includes('REVOKE ALL ON TABLE'), false, 'follow-up must not touch the table sweep');
});

test('follow-up pins search_path on both authorization-helper functions', () => {
  for (const fn of ['public.current_tenant_id()', 'public.is_diaspora_platform_admin()']) {
    assert.equal(
      followupSql.includes(`CREATE OR REPLACE FUNCTION ${fn}`),
      true,
      `${fn} should be redefined`,
    );
  }
  // Exactly two pinned search_path declarations (one per function).
  const pinned = followupSql.match(/SET search_path = public, pg_temp/g) || [];
  assert.equal(pinned.length, 2, 'both functions must pin search_path = public, pg_temp');
});

test('follow-up keeps both helpers SECURITY INVOKER (no SECURITY DEFINER)', () => {
  // These helpers read the caller session; turning them into DEFINER would break
  // tenant isolation and the admin check.
  assert.equal(followupCode.includes('SECURITY DEFINER'), false, 'follow-up must not introduce SECURITY DEFINER');
});

test('least privilege: is_diaspora_platform_admin revoked from anon/PUBLIC, granted to authenticated + service_role', () => {
  assert.equal(
    followupSql.includes('REVOKE ALL ON FUNCTION public.is_diaspora_platform_admin() FROM PUBLIC, anon;'),
    true,
    'anon/PUBLIC EXECUTE must be revoked from is_diaspora_platform_admin',
  );
  assert.equal(
    followupSql.includes('GRANT EXECUTE ON FUNCTION public.is_diaspora_platform_admin() TO authenticated, service_role;'),
    true,
    'authenticated (RLS dependency) and service_role EXECUTE must be preserved',
  );
});

test('required public-read path preserved: current_tenant_id EXECUTE is NOT revoked from anon', () => {
  // anon browses public vehicles directly; the vehicles RLS policy calls
  // current_tenant_id(), so anon must retain EXECUTE on it.
  assert.equal(
    /REVOKE[^;]*current_tenant_id/i.test(followupSql),
    false,
    'follow-up must not revoke EXECUTE on current_tenant_id (would break public vehicle browsing)',
  );
});

test('service-role paths preserved: no statement revokes service_role', () => {
  assert.equal(/REVOKE[^;]*service_role/i.test(followupSql), false, 'service_role access must never be revoked');
});

test('idempotent and guarded: to_regprocedure guards + CREATE OR REPLACE', () => {
  assert.equal(followupSql.includes("to_regprocedure('public.current_tenant_id()')"), true);
  assert.equal(followupSql.includes("to_regprocedure('public.is_diaspora_platform_admin()')"), true);
  const guards = followupCode.match(/IS NOT NULL THEN/g) || [];
  assert.equal(guards.length, 2, 'each function change must be guarded for idempotency');
  const replaces = followupCode.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(replaces.length, 2, 'both functions must use CREATE OR REPLACE');
});

test('no data deletion, no schema redesign, no blanket RLS', () => {
  for (const forbidden of [
    /DROP\s+TABLE/i,
    /DROP\s+FUNCTION/i,
    /DROP\s+COLUMN/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\b/i,
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
  ]) {
    assert.equal(forbidden.test(followupCode), false, `follow-up must not contain ${forbidden}`);
  }
});

test('privileged RPC roles are minimal: only authenticated + service_role receive EXECUTE', () => {
  const grants = followupSql.match(/GRANT EXECUTE ON FUNCTION[^;]*;/g) || [];
  assert.equal(grants.length >= 1, true, 'at least one explicit EXECUTE grant expected');
  for (const grant of grants) {
    assert.equal(/\banon\b/.test(grant), false, 'no EXECUTE grant may include anon');
    assert.equal(/\bPUBLIC\b/.test(grant), false, 'no EXECUTE grant may include PUBLIC');
    assert.equal(
      /TO authenticated, service_role;/.test(grant),
      true,
      'EXECUTE grants must target exactly authenticated + service_role',
    );
  }
});
