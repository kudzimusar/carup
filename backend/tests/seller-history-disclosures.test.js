/**
 * Vehicle History & Obligations — F18–F20 / M17 seller-disclosure contract.
 *
 * Three rules this file exists to keep true forever:
 *   1. Absence never becomes "No". An unanswered disclosure normalizes to null and the columns
 *      carry no default — nothing in the pipeline may manufacture a clean-history answer.
 *   2. Closed vocabularies fail closed: out-of-vocabulary states/types are refusals, not coercions.
 *   3. Private banking terms are refused at the API and banned again by the migration CHECK, and the
 *      two ban lists cannot drift apart silently (they are compared verbatim here).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import {
  ACCIDENT_DISCLOSURE_STATES,
  INSURANCE_DISCLOSURE_STATES,
  FINANCE_DISCLOSURE_STATES,
  FINANCE_TYPES,
  PRIVATE_FINANCE_KEYS,
  normalizeAccidentDisclosure,
  normalizeInsuranceDisclosure,
  normalizeFinanceDisclosure,
} from '../services/seller/vehicleHistoryDisclosures.js';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../../database/migrations/20260831150000_seller_vehicle_history_disclosures.sql', import.meta.url),
  'utf8',
);

// ── 1. Absence never becomes "No" ────────────────────────────────────────────────────────────────

test('an unanswered disclosure normalizes to null for all three topics', () => {
  for (const normalize of [normalizeAccidentDisclosure, normalizeInsuranceDisclosure, normalizeFinanceDisclosure]) {
    assert.deepEqual(normalize(null), { ok: true, value: null });
    assert.deepEqual(normalize(undefined), { ok: true, value: null });
  }
});

test('no normalizer contains a default that manufactures a negative answer', () => {
  // The closed vocabularies deliberately include an explicit negative ("no_known_accident_history",
  // "not_insured", "none_known") so the ONLY way to reach one is the Seller choosing it.
  const module = fs.readFileSync(new URL('../services/seller/vehicleHistoryDisclosures.js', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /state\s*(?:\?\?|\|\|)\s*'(?:no_known_accident_history|not_insured|none_known)'/);
});

// ── 2. Closed vocabularies fail closed ───────────────────────────────────────────────────────────

test('every declared state round-trips and everything else is refused', () => {
  for (const state of ACCIDENT_DISCLOSURE_STATES) {
    assert.deepEqual(normalizeAccidentDisclosure({ state }), { ok: true, value: { state } });
  }
  for (const state of INSURANCE_DISCLOSURE_STATES) {
    assert.deepEqual(normalizeInsuranceDisclosure({ state }), { ok: true, value: { state } });
  }
  for (const state of FINANCE_DISCLOSURE_STATES) {
    assert.deepEqual(normalizeFinanceDisclosure({ state }), { ok: true, value: { state } });
  }
  for (const normalize of [normalizeAccidentDisclosure, normalizeInsuranceDisclosure, normalizeFinanceDisclosure]) {
    assert.equal(normalize({ state: 'no' }).ok, false, 'a bare "no" is not in any vocabulary');
    assert.equal(normalize({ state: 'clean' }).ok, false);
    assert.equal(normalize({}).ok, false, 'an object with no state is not an answer');
    assert.equal(normalize('yes').ok, false, 'a bare string is not a structured disclosure');
    assert.equal(normalize([]).ok, false);
  }
});

test('finance_type is validated against its own closed vocabulary', () => {
  for (const financeType of FINANCE_TYPES) {
    const result = normalizeFinanceDisclosure({ state: 'active', finance_type: financeType });
    assert.deepEqual(result, { ok: true, value: { state: 'active', finance_type: financeType } });
  }
  assert.equal(normalizeFinanceDisclosure({ state: 'active', finance_type: 'payday_loan' }).ok, false);
});

// ── 3. Structured details are allow-list projected ───────────────────────────────────────────────

test('accident events keep only the declared fields, cap length and count, and require state=yes', () => {
  const yes = normalizeAccidentDisclosure({
    state: 'yes',
    events: [{
      approx_date: '2024-03', mileage: '45000', damage_area: 'front-left', severity: 'moderate',
      insurer_involved: 'yes', police_report_state: 'filed', repair_state: 'repaired', repairer: 'Harare Panel Beaters',
      smuggled: 'nope', outstanding_balance: '9999',
    }],
  });
  assert.equal(yes.ok, true);
  assert.deepEqual(Object.keys(yes.value.events[0]).sort(), [
    'approx_date', 'damage_area', 'insurer_involved', 'mileage',
    'police_report_state', 'repair_state', 'repairer', 'severity',
  ]);

  const oversized = normalizeAccidentDisclosure({
    state: 'yes',
    events: [{ damage_area: 'x'.repeat(500) }],
  });
  assert.equal(oversized.value.events[0].damage_area.length, 200);

  const tooMany = normalizeAccidentDisclosure({
    state: 'yes',
    events: Array.from({ length: 25 }, (_, i) => ({ damage_area: `area-${i}` })),
  });
  assert.equal(tooMany.value.events.length, 10);

  // A "no known history" answer cannot smuggle event details along.
  const contradiction = normalizeAccidentDisclosure({
    state: 'no_known_accident_history',
    events: [{ damage_area: 'front' }],
  });
  assert.deepEqual(contradiction.value, { state: 'no_known_accident_history' });
});

test('insurer_name is kept only for an "insured" answer and unknown keys are dropped', () => {
  const insured = normalizeInsuranceDisclosure({ state: 'insured', insurer_name: ' Old Mutual ', policy_number: 'POL-1' });
  assert.deepEqual(insured.value, { state: 'insured', insurer_name: 'Old Mutual' });
  const notInsured = normalizeInsuranceDisclosure({ state: 'not_insured', insurer_name: 'Old Mutual' });
  assert.deepEqual(notInsured.value, { state: 'not_insured' });
});

// ── 4. Private banking terms are refused, including nested, and the two ban lists agree ─────────

test('a finance disclosure carrying any private banking key is refused outright', () => {
  for (const key of PRIVATE_FINANCE_KEYS) {
    const flat = normalizeFinanceDisclosure({ state: 'active', [key]: 'x' });
    assert.equal(flat.ok, false, `flat private key ${key} must be refused`);
    assert.match(flat.error, /private banking terms/);
  }
  const nested = normalizeFinanceDisclosure({ state: 'active', details: { inner: { apr: 21.5 } } });
  assert.equal(nested.ok, false, 'nesting must not smuggle a private key past the ban');
});

test('the migration CHECK bans exactly the keys the module bans', () => {
  const checkBlock = /vehicles_seller_finance_disclosure_privacy_chk CHECK \(([\s\S]*?)\);/.exec(migration);
  assert.ok(checkBlock, 'the privacy CHECK constraint must exist in the migration');
  for (const key of PRIVATE_FINANCE_KEYS) {
    assert.ok(checkBlock[1].includes(`'${key}'`), `migration privacy CHECK is missing '${key}'`);
  }
});

test('the migration declares the same closed state vocabularies as the module', () => {
  for (const state of ACCIDENT_DISCLOSURE_STATES) assert.ok(migration.includes(`'${state}'`));
  for (const state of INSURANCE_DISCLOSURE_STATES) assert.ok(migration.includes(`'${state}'`));
  for (const state of FINANCE_DISCLOSURE_STATES) assert.ok(migration.includes(`'${state}'`));
  for (const financeType of FINANCE_TYPES) assert.ok(migration.includes(`'${financeType}'`));
  assert.doesNotMatch(migration, /seller_(accident|insurance|finance)_disclosure JSONB (NOT NULL|DEFAULT)/i,
    'disclosure columns must stay nullable with no default — NULL is the honest unanswered state');
});

// ── 5. The handlers wire the disclosures without silent loss ─────────────────────────────────────

function handlerSlice(startMarker) {
  const start = server.indexOf(startMarker);
  assert.ok(start > -1, `${startMarker} must remain statically locatable`);
  const rest = server.slice(start + 10);
  const next = /\napp\.(get|post|put|patch|delete)\(/.exec(rest);
  return server.slice(start, start + 10 + next.index);
}

test('POST /api/vehicles/add validates, persists and fail-closes the disclosures', () => {
  const handler = handlerSlice("app.post('/api/vehicles/add'");
  assert.match(handler, /normalizeAccidentDisclosure\(accident_disclosure\)/);
  assert.match(handler, /normalizeInsuranceDisclosure\(insurance_disclosure\)/);
  assert.match(handler, /normalizeFinanceDisclosure\(finance_disclosure\)/);
  assert.match(handler, /SELLER_DISCLOSURE_INVALID/);
  assert.match(handler, /SELLER_DISCLOSURE_SCHEMA_REQUIRED/, 'an answered disclosure must fail closed on an old schema');
  assert.match(handler, /history_disclosures_recorded/);
  // Both the fresh-listing row and the re-listing row must carry the disclosure columns.
  const spreads = handler.match(/\.\.\.sellerHistoryDisclosureColumns/g) || [];
  assert.ok(spreads.length >= 2, 'both listingRow and reusableListingRow must spread the disclosure columns');
});

test('PATCH /api/vehicles/:vin/seller-draft round-trips the disclosures with an exact receipt', () => {
  const handler = handlerSlice("app.patch('/api/vehicles/:vin/seller-draft'");
  for (const key of ['accident_disclosure', 'insurance_disclosure', 'finance_disclosure']) {
    assert.ok(handler.includes(`has('${key}')`), `PATCH must be hasOwnProperty-gated on ${key}`);
  }
  assert.match(handler, /SELLER_DISCLOSURE_INVALID/);
  assert.match(handler, /SELLER_DISCLOSURE_SCHEMA_REQUIRED/);
  // The receipt echoes what the DATABASE stored (updated.*), never the request payload.
  assert.match(handler, /accident_disclosure: updated\.seller_accident_disclosure \?\? null/);
  assert.match(handler, /insurance_disclosure: updated\.seller_insurance_disclosure \?\? null/);
  assert.match(handler, /finance_disclosure: updated\.seller_finance_disclosure \?\? null/);
});
