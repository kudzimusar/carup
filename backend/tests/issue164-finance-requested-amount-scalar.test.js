/**
 * Issue #164 — Codex P2 (head 6dfe3c88): reject non-scalar requested amounts.
 *
 * `submitFinancingApplication` previously ran `Number(requestedAmount)`, which coerces `true`→1 and a
 * one-element array `[500]`→500. Both then passed the positivity and listing-price checks and were
 * persisted as genuine financing requests. The scalar guard now accepts ONLY a primitive number or a
 * nonblank numeric string, mirroring the approval-term validators.
 *
 * Deterministic: the applicant-amount guard runs BEFORE any Supabase read, so the rejection matrix
 * needs no live DB. To prove the guard also PRESERVES valid scalars without mocking the full
 * blockchain/event happy path, the vehicle read is stubbed to return null: a valid amount passes the
 * guard and then fails downstream with 'Vehicle record not found.', while a non-scalar is rejected up
 * front with 'Requested amount must be positive.'. This message split is exactly what makes the test
 * REQUIRE the fix — against the pre-fix `Number()` path, `true`/`[500]` slip the guard and surface the
 * downstream message instead, failing the rejection assertions.  Run:
 *   node --test backend/tests/issue164-finance-requested-amount-scalar.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const { submitFinancingApplication } = await import('../services/finance/financeService.js');
const { ValidationError } = await import('../utils/errors.js');

// Minimal read-only mock: every table read resolves to no row, so any input that PASSES the scalar
// guard fails downstream at the vehicle lookup with a distinct, assertable message.
function installNullReadMock() {
  supabase.from = () => {
    const chain = {
      select() { return chain; },
      insert() { return chain; },
      update() { return chain; },
      upsert() { return chain; },
      eq() { return chain; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
    };
    return chain;
  };
}

const VALID_VIN = '1HGCM82633A004352';
const VALID_LENDER = 'bank-1';

// Non-scalar / non-numeric JSON values that a `Number()` coercion would wrongly admit or that must
// stay rejected. `true`→1 and `[500]`→500 are the concrete exploit values from the Codex finding.
const REJECTED = [
  ['boolean true', true],
  ['boolean false', false],
  ['empty array', []],
  ['one-element array [500]', [500]],
  ['object {}', {}],
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
  ['whitespace string', '   '],
  ['non-numeric string', 'abc'],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['negative number', -100],
  ['zero', 0],
];

// Valid scalars that MUST survive the guard (they then fail only at the stubbed vehicle lookup).
const PRESERVED = [
  ['positive integer', 5000],
  ['positive float', 12500.5],
  ['numeric string', '5000'],
  ['numeric string with decimal', '12500.50'],
  ['one', 1],
];

test('non-scalar / non-positive requested amounts are rejected before any persistence', async () => {
  installNullReadMock();
  for (const [label, value] of REJECTED) {
    await assert.rejects(
      () => submitFinancingApplication(VALID_VIN, 'user-1', VALID_LENDER, value),
      (err) => {
        assert.ok(err instanceof ValidationError, `${label}: expected ValidationError, got ${err?.constructor?.name}`);
        assert.match(err.message, /Requested amount must be positive/, `${label}: wrong rejection message`);
        return true;
      },
      `${label} should be rejected by the scalar guard`,
    );
  }
});

test('valid numeric scalars pass the guard (then fail only downstream, proving preservation)', async () => {
  installNullReadMock();
  for (const [label, value] of PRESERVED) {
    await assert.rejects(
      () => submitFinancingApplication(VALID_VIN, 'user-1', VALID_LENDER, value),
      (err) => {
        assert.ok(err instanceof ValidationError, `${label}: expected ValidationError, got ${err?.constructor?.name}`);
        // Passing the guard means the NEXT failure is the stubbed vehicle lookup, NOT the amount guard.
        assert.match(err.message, /Vehicle record not found/, `${label}: valid scalar was wrongly rejected by the amount guard`);
        return true;
      },
      `${label} should pass the scalar guard and fail only at the vehicle lookup`,
    );
  }
});
