/**
 * Regression tests for the UAT staging-target guard (referral-uat-guard.mjs).
 *
 * These tests prove that a staging Supabase URL cannot launder a production or
 * arbitrary API host as "staging" — the P1 defect fixed in this commit.
 *
 * Critical case that previously passed (MUST FAIL after fix):
 *   STAGING_API_BASE_URL=https://api.carup.app
 *   STAGING_SUPABASE_URL=https://eoyenigwevnxwwhyhaer.supabase.co
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStagingTarget, STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF } from '../scripts/uat/referral-uat-guard.mjs';

const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const PROD_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;

function ok(config) {
  const result = checkStagingTarget(config);
  assert.equal(result.ok, true, `expected PASS but got FAIL: ${result.reason}`);
}

function fail(config, reasonFragment) {
  const result = checkStagingTarget(config);
  assert.equal(result.ok, false, `expected FAIL but got PASS for: ${JSON.stringify(config)}`);
  if (reasonFragment) {
    assert.ok(
      result.reason.toLowerCase().includes(reasonFragment.toLowerCase()),
      `reason "${result.reason}" does not include expected fragment "${reasonFragment}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// PASS cases
// ---------------------------------------------------------------------------

test('guard PASS — localhost staging-connected backend', () => {
  ok({ baseUrl: 'http://localhost:5001', stagingSupabaseUrl: STAGING_SUPABASE_URL });
});

test('guard PASS — localhost without Supabase URL', () => {
  ok({ baseUrl: 'http://localhost:5001', stagingSupabaseUrl: '' });
});

test('guard PASS — 127.0.0.1 staging-connected backend', () => {
  ok({ baseUrl: 'http://127.0.0.1:5001', stagingSupabaseUrl: STAGING_SUPABASE_URL });
});

test('guard PASS — approved CarUp staging API hostname (carup + staging)', () => {
  ok({ baseUrl: 'https://carup-staging.vercel.app', stagingSupabaseUrl: STAGING_SUPABASE_URL });
});

test('guard PASS — approved CarUp UAT hostname (carup + uat)', () => {
  ok({ baseUrl: 'https://api-uat.carup.co', stagingSupabaseUrl: STAGING_SUPABASE_URL });
});

test('guard PASS — API URL itself contains the staging project reference', () => {
  ok({ baseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`, stagingSupabaseUrl: '' });
});

test('guard PASS — no stagingSupabaseUrl provided with localhost', () => {
  ok({ baseUrl: 'http://localhost:3000' });
});

// ---------------------------------------------------------------------------
// FAIL cases
// ---------------------------------------------------------------------------

test('guard FAIL (P1 defect) — production API + staging Supabase must reject', () => {
  // This is the exact unsafe configuration from the review thread.
  // Before the fix this returned ok=true because refProven searched the haystack
  // (baseUrl + stagingSupabaseUrl) and found the staging ref in the Supabase URL.
  fail(
    { baseUrl: 'https://api.carup.app', stagingSupabaseUrl: STAGING_SUPABASE_URL },
    'not recognisable as the staging environment',
  );
});

test('guard FAIL — production API hostname only (no Supabase URL)', () => {
  fail({ baseUrl: 'https://api.carup.app', stagingSupabaseUrl: '' }, 'not recognisable');
});

test('guard FAIL — generic production hostname + staging Supabase URL', () => {
  fail(
    { baseUrl: 'https://api.example.com', stagingSupabaseUrl: STAGING_SUPABASE_URL },
    'not recognisable',
  );
});

test('guard FAIL — production Supabase ref in API URL', () => {
  fail({ baseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`, stagingSupabaseUrl: '' }, 'PRODUCTION');
});

test('guard FAIL — production Supabase ref in stagingSupabaseUrl', () => {
  fail({ baseUrl: 'http://localhost:5001', stagingSupabaseUrl: PROD_SUPABASE_URL }, 'PRODUCTION');
});

test('guard FAIL — attacker-owned host containing "uat"', () => {
  fail(
    { baseUrl: 'https://uat.attacker.example.com', stagingSupabaseUrl: STAGING_SUPABASE_URL },
    'not recognisable',
  );
});

test('guard FAIL — attacker-owned host containing "staging"', () => {
  fail(
    { baseUrl: 'https://staging.evil.io', stagingSupabaseUrl: STAGING_SUPABASE_URL },
    'not recognisable',
  );
});

test('guard FAIL — malformed API URL', () => {
  fail({ baseUrl: 'not-a-url', stagingSupabaseUrl: STAGING_SUPABASE_URL }, 'not a valid URL');
});

test('guard FAIL — empty API URL', () => {
  fail({ baseUrl: '', stagingSupabaseUrl: STAGING_SUPABASE_URL }, 'required');
});

test('guard FAIL — missing baseUrl entirely', () => {
  fail({ stagingSupabaseUrl: STAGING_SUPABASE_URL }, 'required');
});

test('guard FAIL — ambiguous CarUp hostname without a staging marker', () => {
  // api.carup.app has "carup" but no staging/stg/uat — must reject.
  fail(
    { baseUrl: 'https://api.carup.app', stagingSupabaseUrl: STAGING_SUPABASE_URL },
    'not recognisable',
  );
});

test('guard FAIL — stagingSupabaseUrl resolves to an unknown ref', () => {
  fail(
    { baseUrl: 'http://localhost:5001', stagingSupabaseUrl: 'https://unknownref00000000000.supabase.co' },
    'not the approved staging ref',
  );
});
