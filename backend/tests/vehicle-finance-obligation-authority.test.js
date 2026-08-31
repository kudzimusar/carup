/**
 * Vehicle Finance Obligation / Encumbrance authority (Track 1: M16, M17, M18, R22–R26, R28).
 *
 * This is the GOVERNED counterpart to the Seller's own `seller_finance_disclosure` statement.
 * The invariants under test:
 *   - closed vocabularies fail closed (no coercion of an out-of-vocabulary value);
 *   - private banking terms cannot survive the write path OR the read path, even if one gate fails;
 *   - the block-level envelope is THREE-STATE HONEST: an unwired/failed read, or a vehicle with no
 *     finance attestation channel configured at all, must report 'unavailable' — never a governed
 *     zero manufactured from a read that never happened;
 *   - `arrears` (a private repayment-delinquency fact) never reaches the public projection;
 *   - the Seller's own statement and this governed authority never merge (no `seller_asserted`
 *     source here at all — that statement lives only in `history_disclosures`);
 *   - M18: a governed obligation never enters Trust — proved as a source-scan negative, since that
 *     is the actual and correct M18 deliverable (the guarantee that nothing was wired in), not a
 *     score-comparison fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import {
  OBLIGATION_SOURCE_AUTHORITIES,
  GOVERNED_SOURCE_AUTHORITIES,
  OBLIGATION_STATES,
  BLOCKING_OBLIGATION_STATES,
  VALUATION_SOURCES,
  normalizeObligationInput,
} from '../services/finance/vehicleFinanceObligationService.js';
import { PRIVATE_FINANCE_KEYS } from '../services/seller/vehicleHistoryDisclosures.js';
import {
  FINANCE_OBLIGATION_PUBLIC_FIELDS,
  toVehicleFinanceObligation,
  toVehicleFinanceObligationBlock,
} from '../utils/publicVehicleProjection.js';
import { classifyConflict } from '../services/intelligence/disclosureConflict.js';

const MIGRATION = fs.readFileSync(
  new URL('../../database/migrations/20260901120000_vehicle_finance_obligation_authority.sql', import.meta.url),
  'utf8',
);

// ── Closed vocabularies fail closed ──────────────────────────────────────────────────────────

test('an out-of-vocabulary source_authority is refused, never coerced', () => {
  const result = normalizeObligationInput({ source_authority: 'seller_asserted', obligation_kind: 'bank_loan', recorded_reason: 'x' });
  assert.equal(result.ok, false);
});

test('there is no seller_asserted member — the Seller statement never enters this table', () => {
  assert.ok(!OBLIGATION_SOURCE_AUTHORITIES.includes('seller_asserted'));
  assert.deepEqual([...OBLIGATION_SOURCE_AUTHORITIES].sort(),
    ['admin_recorded', 'document_extracted', 'lender_attested', 'provider_attested'].sort());
});

test('document_extracted is recorded but never GOVERNED — excluded from the blocking/comparison authority', () => {
  assert.ok(!GOVERNED_SOURCE_AUTHORITIES.includes('document_extracted'));
  assert.deepEqual([...GOVERNED_SOURCE_AUTHORITIES].sort(),
    ['admin_recorded', 'lender_attested', 'provider_attested'].sort());
});

test('disputed is recorded but never blocks ownership transfer', () => {
  assert.ok(OBLIGATION_STATES.includes('disputed'));
  assert.ok(!BLOCKING_OBLIGATION_STATES.includes('disputed'));
});

test('an out-of-vocabulary obligation_kind, state, or valuation source is refused', () => {
  const base = { source_authority: 'admin_recorded', recorded_by: 'u1', recorded_reason: 'x' };
  assert.equal(normalizeObligationInput({ ...base, obligation_kind: 'payday_loan' }).ok, false);
  assert.equal(normalizeObligationInput({ ...base, obligation_kind: 'bank_loan', state: 'paid_off' }).ok, false);
  assert.equal(normalizeObligationInput({
    ...base, obligation_kind: 'bank_loan', origination_valuation_source: 'guessed',
  }).ok, false);
});

test('the vocabulary and the migration CHECK constraints cannot silently drift', () => {
  for (const value of OBLIGATION_SOURCE_AUTHORITIES) assert.match(MIGRATION, new RegExp(`'${value}'`));
  for (const value of OBLIGATION_STATES) assert.match(MIGRATION, new RegExp(`'${value}'`));
  for (const value of VALUATION_SOURCES) assert.match(MIGRATION, new RegExp(`'${value}'`));
  // The renamed governed stage — the whole point of NOT calling it 'cleared' (that token means
  // "finished" in the Seller's own vocabulary, vehicles_seller_finance_disclosure_state_chk).
  assert.match(MIGRATION, /settled_pending_release/);
  assert.doesNotMatch(MIGRATION, /state IN \([^)]*'cleared'/);
});

// ── Provenance requires proof ────────────────────────────────────────────────────────────────

test('each source authority requires its own proof, closed vocabulary discipline', () => {
  assert.equal(normalizeObligationInput({ source_authority: 'lender_attested', obligation_kind: 'bank_loan' }).ok, false);
  assert.equal(normalizeObligationInput({
    source_authority: 'lender_attested', obligation_kind: 'bank_loan',
    lender_profile_id: 'l1', attestation_reference: 'REF-1',
  }).ok, true);
  assert.equal(normalizeObligationInput({ source_authority: 'document_extracted', obligation_kind: 'bank_loan' }).ok, false);
  assert.equal(normalizeObligationInput({
    source_authority: 'document_extracted', obligation_kind: 'bank_loan', evidence_id: 'ev1',
  }).ok, true);
  assert.equal(normalizeObligationInput({ source_authority: 'admin_recorded', obligation_kind: 'bank_loan' }).ok, false);
});

// ── Privacy: private banking terms cannot survive the write path ────────────────────────────

test('normalizeObligationInput refuses each of the 11 private-finance keys at the top level', () => {
  for (const key of PRIVATE_FINANCE_KEYS) {
    const result = normalizeObligationInput({
      source_authority: 'admin_recorded', recorded_by: 'u1', recorded_reason: 'x',
      obligation_kind: 'bank_loan', [key]: 'x',
    });
    assert.equal(result.ok, false, `${key} should have been refused at the top level`);
  }
});

test('normalizeObligationInput refuses each of the 11 private-finance keys nested inside settlement_context', () => {
  for (const key of PRIVATE_FINANCE_KEYS) {
    const result = normalizeObligationInput({
      source_authority: 'admin_recorded', recorded_by: 'u1', recorded_reason: 'x',
      obligation_kind: 'bank_loan', settlement_context: { notes_internal_ref: 'ok', [key]: 'x' },
    });
    assert.equal(result.ok, false, `${key} nested in settlement_context should have been refused`);
  }
});

test('settlement_context is a CLOSED SHAPE: an unlisted key is refused even if it is not a banned key', () => {
  const result = normalizeObligationInput({
    source_authority: 'admin_recorded', recorded_by: 'u1', recorded_reason: 'x',
    obligation_kind: 'bank_loan', settlement_context: { some_unlisted_field: 'benign-looking value' },
  });
  assert.equal(result.ok, false);
});

test('settlement_context.notes_internal_ref must be a plain string — nesting cannot smuggle a private object one level down', () => {
  const result = normalizeObligationInput({
    source_authority: 'admin_recorded', recorded_by: 'u1', recorded_reason: 'x',
    obligation_kind: 'bank_loan', settlement_context: { notes_internal_ref: { apr: 21.5 } },
  });
  assert.equal(result.ok, false);
});

test('the migration bans the same shape: settlement_context and event payload are closed to an explicit key allow-list', () => {
  assert.match(MIGRATION, /vfo_settlement_context_shape_chk/);
  assert.match(MIGRATION, /settlement_deadline_date.*payee_reference_type.*notes_internal_ref/s);
});

// ── Read-side privacy: defense in depth even if both upstream bans failed ───────────────────

test('toVehicleFinanceObligation never emits a private field, even when handed a row that carries one', () => {
  const row = {
    id: 'o1', state: 'active', obligation_kind: 'bank_loan',
    attestation_reference: 'SECRET-REF', release_reference: 'SECRET-RELEASE',
    settlement_context: { notes_internal_ref: 'internal only' },
    lender_display_name: 'Old Mutual', lender_disclosure_permitted: false,
    recorded_by: 'u1', tenant_id: 't1',
  };
  const projected = toVehicleFinanceObligation(row);
  const serialized = JSON.stringify(projected);
  for (const banned of ['SECRET-REF', 'SECRET-RELEASE', 'internal only', 'u1', 't1']) {
    assert.ok(!serialized.includes(banned), `${banned} leaked through toVehicleFinanceObligation`);
  }
  // lender_disclosure_permitted is false -> the name must not appear either, strict ===.
  assert.ok(!serialized.includes('Old Mutual'));
});

test('lender_name is withheld unless lender_disclosure_permitted is STRICTLY true', () => {
  for (const permitted of [false, undefined, null, 'true', 1]) {
    const projected = toVehicleFinanceObligation({
      id: 'o1', state: 'active', obligation_kind: 'bank_loan',
      lender_display_name: 'Old Mutual', lender_disclosure_permitted: permitted,
    });
    assert.equal(projected.lender_name, undefined, `permitted=${permitted} must withhold the name`);
  }
  const shown = toVehicleFinanceObligation({
    id: 'o1', state: 'active', obligation_kind: 'bank_loan',
    lender_display_name: 'Old Mutual', lender_disclosure_permitted: true,
  });
  assert.equal(shown.lender_name, 'Old Mutual');
});

test('the emitted public field set is exactly FINANCE_OBLIGATION_PUBLIC_FIELDS — nothing unlisted can slip in', () => {
  const projected = toVehicleFinanceObligation({
    id: 'o1', state: 'settled_pending_release', obligation_kind: 'hire_purchase',
    lender_display_name: 'CABS', lender_disclosure_permitted: true,
    origination_valuation_amount: 12000, origination_valuation_currency: 'USD',
    origination_valuation_date: '2022-01-01', origination_valuation_source: 'lender_valuation',
    cleared_at: '2026-01-01T00:00:00Z', released_at: null, recorded_at: '2021-01-01T00:00:00Z',
  }, { supersededIds: new Set() });
  for (const key of Object.keys(projected)) {
    assert.ok(FINANCE_OBLIGATION_PUBLIC_FIELDS.includes(key), `unlisted public field: ${key}`);
  }
});

test('arrears — a private repayment-delinquency fact — collapses to "active" in the public projection', () => {
  const projected = toVehicleFinanceObligation({ id: 'o1', state: 'arrears', obligation_kind: 'bank_loan' });
  assert.equal(projected.state, 'active');
});

test('a superseded obligation is marked as such, so a correction cannot silently keep the old row acting as live truth', () => {
  const projected = toVehicleFinanceObligation(
    { id: 'o1', state: 'active', obligation_kind: 'bank_loan' },
    { supersededIds: new Set(['o1']) },
  );
  assert.equal(projected.superseded, true);
});

test('the valuation-at-origination group is all-or-nothing and carries its OWN date, never the vehicle price', () => {
  const partial = toVehicleFinanceObligation({
    id: 'o1', state: 'active', obligation_kind: 'bank_loan', origination_valuation_amount: 12000,
  });
  assert.equal(partial.valuation_at_origination, undefined);
  const complete = toVehicleFinanceObligation({
    id: 'o1', state: 'active', obligation_kind: 'bank_loan',
    origination_valuation_amount: 12000, origination_valuation_currency: 'USD',
    origination_valuation_date: '2022-01-01', origination_valuation_source: 'lender_valuation',
  });
  assert.deepEqual(complete.valuation_at_origination, {
    amount: 12000, currency: 'USD', date: '2022-01-01', source: 'lender_valuation',
  });
});

// ── The three-state honesty contract (M17/L27's own rule, applied to the governed side) ─────

test('an UNWIRED read (rows undefined) reports unavailable — never a governed zero', () => {
  const block = toVehicleFinanceObligationBlock(undefined, { channelAvailable: true });
  assert.equal(block.source_state, 'unavailable');
  assert.deepEqual(block.obligations, []);
});

test('with NO finance attestation channel configured, every vehicle reports unavailable even if rows is []', () => {
  const block = toVehicleFinanceObligationBlock([], { channelAvailable: false });
  assert.equal(block.source_state, 'unavailable');
});

test('a real channel plus a successful empty read is a genuine, publishable zero', () => {
  const block = toVehicleFinanceObligationBlock([], { channelAvailable: true });
  assert.equal(block.source_state, 'available');
  assert.deepEqual(block.obligations, []);
});

test('the block is always authority: "governed" — never confusable with the seller-stated block', () => {
  assert.equal(toVehicleFinanceObligationBlock(undefined).authority, 'governed');
  assert.equal(toVehicleFinanceObligationBlock([], { channelAvailable: true }).authority, 'governed');
});

// ── M16: routed through the ONE existing disclosure-conflict engine, never a second classifier ──

test('M16: the finance case is a real arm of classifyConflict, never escalates past possible_conflict, and stays neutral', () => {
  const conflict = classifyConflict(
    { vin: 'V1', claim_type: 'no_finance_outstanding' },
    { hasGovernedFinanceObligation: true },
  );
  assert.ok(conflict);
  assert.equal(conflict.classification, 'possible_conflict');
  assert.equal(conflict.reviewer_state, 'pending_review');
  assert.equal(conflict.confidence, null, 'a record-vs-record comparison has no fabricated confidence score');
  assert.deepEqual(conflict.evidence_ids, [], 'no obligation id may ride in evidence_ids — it is counted as evidence_count downstream');
  assert.doesNotMatch(conflict.public_summary, /fraud|lied|lying|dishonest|false|falsified|misrepresent|conceal/i);
});

test('M16: agreement (no governed obligation) raises nothing', () => {
  const conflict = classifyConflict(
    { vin: 'V1', claim_type: 'no_finance_outstanding' },
    { hasGovernedFinanceObligation: false },
  );
  assert.equal(conflict, null);
});

test('M16 ANTI-VACUITY: adding the optional confidence argument left every pre-existing arm untouched', () => {
  // The five legacy free-text arms must still carry 0.75. If the default-argument change had
  // altered them, the null-confidence assertion above would be passing for the wrong reason.
  const legacy = classifyConflict(
    { vin: 'V1', claim_type: 'no_accident_history' },
    { hasAccidentEvidence: true, accidentEvidenceIds: ['ev1'] },
  );
  assert.equal(legacy.confidence, 0.75);
  assert.equal(legacy.classification, 'strong_conflict');
  assert.deepEqual(legacy.evidence_ids, ['ev1']);
});

// ── M18: the negative proof — the ONLY correct deliverable for "may affect Trust" left undone ──

test('M18: Trust never references this authority — source-scanned, so a future silent import fails here', () => {
  const trustFiles = [
    '../services/trustDecision/trustDecisionService.js',
    '../services/trustDecision/canonicalTrustService.js',
  ];
  for (const rel of trustFiles) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /vehicle_finance_obligation/);
    assert.doesNotMatch(src, /vehicleFinanceObligationService/);
  }
});

test('R23: the finance obligation requirement is wired as advisory, never blocking', () => {
  const src = fs.readFileSync(new URL('../services/evidence/completenessEvaluator.js', import.meta.url), 'utf8');
  assert.match(src, /key: 'finance_obligation_disclosure'/);
  // Read to the END of that requirement object literal rather than a fixed character window, so a
  // longer label can never make this assertion silently stop looking at the property it guards.
  const start = src.indexOf("key: 'finance_obligation_disclosure'");
  const block = src.slice(start, src.indexOf('});', start));
  assert.match(block, /blocking:\s*false/);
  assert.doesNotMatch(block, /blocking:\s*true/);

  // R22: the SELLER-VISIBLE label must never assert "clear"/"no finance" — absence is not a claim.
  // Comments are stripped first: prose explaining why we never say "no finance" is not the product
  // saying "no finance", and scanning it would make this guard fire on its own documentation.
  const shipped = block.replace(/\/\/[^\n]*/g, '');
  const CLEAN_CLAIM = /no finance|not financed|finance clear|unencumbered|no obligation/i;
  assert.doesNotMatch(shipped, CLEAN_CLAIM);
  // ANTI-VACUITY: the scanner must actually fire on the string it exists to catch.
  assert.match("label: 'No finance recorded on this vehicle'", CLEAN_CLAIM);
});

// ── Wiring: an injected collaborator that no route hands in must not go quietly dead ─────────

test('the passport and the marketplace detail payload both publish through the ONE composed contract', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /financeObligationContract = null,/);
  assert.match(server, /typeof financeObligationContract === 'function'/);
  assert.match(server, /\.\.\.\(financeObligation \? \{ finance_obligation: financeObligation \} : \{\}\)/);
  const callSites = [...server.matchAll(/await buildVehiclePassport\(([^;]*?)\);/gs)];
  assert.equal(callSites.length, 2);
  for (const [whole, args] of callSites) {
    assert.ok(args.includes('projectFinanceObligationForVehicle'),
      `a buildVehiclePassport call site does not pass the finance-obligation contract:\n${whole}`);
  }

  const detail = fs.readFileSync(
    new URL('../services/marketplace/marketplaceListingDetailService.js', import.meta.url), 'utf8',
  );
  assert.match(detail, /finance_obligation: financeObligation/);
  assert.match(detail, /projectFinanceObligationForVehicle\(supabaseClient, vin\)/);
});

test('buildVehiclePassport never references the projection function as a free module-scope name — only the injected parameter is called', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const declIdx = server.indexOf('async function buildVehiclePassport');
  const braceIdx = server.indexOf('{', server.indexOf(')', declIdx));
  let depth = 0, endIdx = braceIdx;
  for (let i = braceIdx; i < server.length; i++) {
    if (server[i] === '{') depth += 1;
    else if (server[i] === '}') { depth -= 1; if (depth === 0) { endIdx = i; break; } }
  }
  const body = server.slice(braceIdx, endIdx);
  assert.doesNotMatch(body, /toVehicleFinanceObligationBlock/,
    'the projection must never be called as a free name inside the source-executed passport body');
});
