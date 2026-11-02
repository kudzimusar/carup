/**
 * CARUP-PAY-04-LR01 — the PAY-03B F5 functions PAY-04 re-creates must stay PAY-03B's functions.
 *
 * PAY-04 REUSES F5 (it does not copy its logic): it re-creates four shared functions, each with one bounded garage
 * branch. This static gate fails the moment any re-creation drifts from its PAY-03B source in any other way, or a
 * later migration re-states one of them without the garage branch (the last writer wins in SQL).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
const read = (file) => readFileSync(path.join(MIGRATIONS, file), 'utf8').split('-- +migrate Down')[0];
const F5 = '20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql';
const SUBS = '20261101130000_carup_pay03b_business_subscriptions.sql';
const PAY04 = '20261102110000_carup_pay04_garage_provider_payments.sql';

function fn(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const bodyStart = sql.indexOf('$$', start);
  const end = sql.indexOf('$$;', bodyStart + 2);
  return sql.slice(start, end + 3);
}

test('pay03b_payment_transition_target: byte-identical to F5 except the two identifier-shape CASE conditions', () => {
  const original = fn(read(F5), 'pay03b_payment_transition_target');
  const extended = fn(read(PAY04), 'pay03b_payment_transition_target');
  const from = "p_row.gateway = 'pay03b_local_provider_simulator'";
  const to = "p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator')";
  assert.equal(original.split(from).length - 1, 2);
  assert.equal(extended, original.split(from).join(to), 'any other difference is drift from PAY-03B F5');
  // Stripe rows keep the Stripe shapes: the garage simulator is added to the SIMULATOR branch only.
  assert.match(extended, /ELSE '\^pi_\[A-Za-z0-9_\]\+\$' END;/);
  assert.match(extended, /ELSE '\^\(re\|pyr\)_\[A-Za-z0-9_\]\+\$' END;/);
});

test('the three F5 hooks keep every PAY-03B branch and add exactly one garage branch', () => {
  const subs = read(SUBS);
  const pay04 = read(PAY04);
  for (const name of ['pay03b_payment_owner_lock', 'pay03b_after_payment_resolution', 'pay03b_payment_payer_conflict']) {
    const before = fn(subs, name);
    const after = fn(pay04, name);
    // every statement-bearing line of the PAY-03B version is still there, in order
    const lines = before.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--') && !/^(DECLARE|BEGIN|END|RETURN NULL;)/.test(l));
    let at = 0;
    for (const line of lines) {
      const found = after.indexOf(line.replace(/;$/, ''), at);
      assert.ok(found >= 0, `${name}: PAY-03B line missing or reordered: ${line}`);
      at = found;
    }
    assert.ok(after.includes('pay04_garage_collections'), `${name}: garage branch present`);
    assert.equal((after.match(/-- PAY-04/g) || []).length, 1, `${name}: exactly one labelled PAY-04 branch`);
  }
});

test('no later migration re-states a PAY-04-extended F5 function without its garage branch', () => {
  const later = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f > PAY04).sort();
  for (const file of later) {
    const sql = read(file);
    for (const name of ['pay03b_payment_transition_target', 'pay03b_payment_owner_lock', 'pay03b_after_payment_resolution', 'pay03b_payment_payer_conflict']) {
      if (!sql.includes(`FUNCTION public.${name}(`)) continue;
      const body = fn(sql, name);
      assert.ok(body.includes('pay04_garage'), `${file} re-states ${name} and drops the PAY-04 garage branch`);
    }
  }
});
