/**
 * CARUP-PAY-05-R1 — each function the R1 migration replaces is the frozen PAY-05 text plus exactly its marked hunks, and the
 * frozen migrations are untouched. Each is re-derived from 20261103100000 and must equal 20261104100000 byte for byte; a hunk
 * that no longer applies exactly once, any other change, or R1 redefining anything else accepted fails this test. No database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { R1_HUNKS, R1_PAY04_HUNKS } from './helpers/pay05-r1-function-hunks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => readFileSync(path.join(ROOT, 'database/migrations', name), 'utf8');
const PAY04_FILE = '20261102110000_carup_pay04_garage_provider_payments.sql';
const PAY05_FILE = '20261103100000_carup_pay05_zimbabwe_paynow_collections.sql';
const R1_FILE = '20261104100000_carup_pay05_r1_financial_integrity.sql';
const PAY04 = read(PAY04_FILE);
const PAY05 = read(PAY05_FILE);
const R1 = read(R1_FILE);
const UP = R1.split(/^-- \+migrate Down/m)[0];
const sha = (text) => createHash('sha256').update(text).digest('hex');

function extract(text, name) {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const tail = text.slice(start);
  const m = /^(END )?\$\$;[ \t]*$/m.exec(tail);
  return tail.slice(0, m.index + m[0].length) + '\n';
}

test('the frozen PAY-05 migration is the one the ICR certified, byte for byte', () => {
  assert.ok(sha(PAY05).startsWith('75b16ae8097e'), `PAY-05 migration changed: ${sha(PAY05)}`);
});

for (const [source, label, table] of [[PAY05, 'PAY-05', R1_HUNKS], [PAY04, 'PAY-04', R1_PAY04_HUNKS]]) for (const [name, hunks] of Object.entries(table)) {
  test(`${name}: ${label} text + exactly its R1 hunks`, () => {
    let derived = extract(source, name);
    for (const [from, to] of hunks) {
      const count = derived.split(from).length - 1;
      assert.equal(count, 1, `a hunk of ${name} matches ${count} times`);
      derived = derived.replace(from, () => to);
    }
    assert.equal(extract(R1, name).trimEnd(), derived.trimEnd());
  });
}

test('R1 defines each replaced function once and adds only its reviewed helpers, in any spelling', () => {
  const defs = [...UP.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?((?:pay04|pay03b|pay05|garage)_[a-z0-9_]+)"?\s*\(/gi)].map((m) => m[1].toLowerCase());
  const counts = {};
  for (const d of defs) counts[d] = (counts[d] || 0) + 1;
  const helpers = ['pay05_begin_status_update_read', 'pay05_collection_currency_bound', 'pay05_held_collection_ids', 'pay05_open_paynow_review',
    'pay05_paynow_money_rank', 'pay05_settled_off_platform', 'pay05_worked_at_garage'];
  assert.deepEqual(Object.keys(counts).sort(), [...Object.keys(R1_HUNKS), ...Object.keys(R1_PAY04_HUNKS), ...helpers].sort());
  for (const [name, n] of Object.entries(counts)) assert.equal(n, 1, `${name} is defined ${n} times`);
});

test('R1 never drops or re-owns a function, and every statement on a table is a reviewed one', () => {
  assert.doesNotMatch(UP, /\b(ALTER|DROP)\s+FUNCTION\b/i);
  const statements = UP.split('\n').filter((l) => /^(ALTER TABLE|DROP TABLE|DROP INDEX|CREATE (UNIQUE )?INDEX|DROP TRIGGER|CREATE TRIGGER|TRUNCATE|UPDATE|DELETE|INSERT)/i.test(l));
  assert.deepEqual(statements.map((l) => l.trim().replace(/\s+/g, ' ')).sort(), [
    'ALTER TABLE public.pay05_paynow_transactions',
    'ALTER TABLE public.pay05_paynow_observations',
    'ALTER TABLE public.pay05_merchant_integrations',
    'ALTER TABLE public.pay05_merchant_audit_events DROP CONSTRAINT IF EXISTS pay05_merchant_audit_events_event_type_check;',
    'ALTER TABLE public.pay05_merchant_audit_events ADD CONSTRAINT pay05_merchant_audit_events_event_type_check CHECK (event_type IN (',
    'ALTER TABLE public.pay04_garage_payment_discrepancies DROP CONSTRAINT IF EXISTS pay04_garage_payment_discrepancies_detected_via_check;',
    'ALTER TABLE public.pay04_garage_payment_discrepancies ADD CONSTRAINT pay04_garage_payment_discrepancies_detected_via_check CHECK (',
    'ALTER TABLE public.pay05_paynow_observations DROP CONSTRAINT IF EXISTS pay05_paynow_observations_outcome_check;',
    'ALTER TABLE public.pay05_paynow_observations ADD CONSTRAINT pay05_paynow_observations_outcome_check CHECK (',
    'ALTER TABLE public.pay05_merchant_integrations DROP CONSTRAINT IF EXISTS pay05_integration_test_auth_email;',
    'ALTER TABLE public.pay05_merchant_integrations ADD CONSTRAINT pay05_integration_test_auth_email CHECK (',
  ].sort());
});

test('every R1 hunk is marked where it lands; the PAY-04 migration is not touched by R1', () => {
  for (const [name, hunks] of Object.entries({ ...R1_HUNKS, ...R1_PAY04_HUNKS })) {
    const text = extract(R1, name);
    assert.ok(text.includes('PAY-05-R1') || name === 'pay05_verify_paynow_merchant', `${name} carries no R1 marker`);
    for (const [, to] of hunks) assert.ok(text.includes(to), `${name}: hunk text missing`);
  }
  assert.ok(read(PAY04_FILE).length > 0);
  assert.equal(UP.includes(PAY04_FILE), false);
});
