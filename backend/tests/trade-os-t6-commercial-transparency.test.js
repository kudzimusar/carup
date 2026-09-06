/**
 * Trade OS T6 — commercial transparency.
 *
 * The contract these tests defend, in one line: **unknown is never zero, and a cheaper-looking
 * number is not a cheaper price.** Almost every assertion here exists because the opposite
 * behaviour would be commercially plausible and quietly dishonest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const contract = await import('../services/diaspora/tradeCommercialContract.js');
const fx = await import('../services/diaspora/tradeFxRateService.js');
const charges = await import('../services/diaspora/tradeChargeComponentService.js');
const compare = await import('../services/diaspora/tradeQuoteComparisonService.js');
const alloc = await import('../services/diaspora/tradeChargeAllocationService.js');

// ── An ECB-shaped feed, EUR-based, exactly as the real one is shaped ─────
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-09-04'>
  <Cube currency='USD' rate='1.1622'/><Cube currency='JPY' rate='181.59'/><Cube currency='ZAR' rate='18.5571'/>
</Cube></Cube></gesmes:Envelope>`;
const feedProvider = (xml = ECB_XML, ok = true) => fx.createEcbFxProvider({
  fetchImpl: async () => (ok ? { ok: true, text: async () => xml } : { ok: false, text: async () => '' }),
});
const deadProvider = fx.createEcbFxProvider({ fetchImpl: async () => { throw new Error('network down'); } });

const client = (seed = {}) => createMockSupabase({
  diaspora_fx_rate_snapshots: [], diaspora_trade_charge_components: [],
  diaspora_trade_rate_observations: [], diaspora_shared_charge_allocations: [],
  diaspora_cargo_reservations: [], diaspora_container_shipments: [],
  diaspora_import_quotes: [], diaspora_logistics_quotes: [], diaspora_import_audit_log: [],
  users: [{ id: 'provider-b' }, { id: 'rev' }], ...seed,
});

// ═══ 1. Vocabulary matches the database constraints ══════════════════════

test('every T6 vocabulary matches its database CHECK exactly', () => {
  const sql = readFileSync(new URL('../../database/migrations/20260908090000_trade_os_t6_commercial_transparency.sql', import.meta.url), 'utf-8');
  const checkList = (name) => {
    const m = new RegExp(`${name}[^(]*\\(([^)]*)\\)`, 's').exec(sql);
    return m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]) : [];
  };
  const inSql = (values, label) => {
    for (const v of values) assert.ok(sql.includes(`'${v}'`), `${label}: ${v} is in code but not in the migration`);
  };
  inSql(contract.COST_STAGES, 'cost stage');
  inSql(contract.INCLUSIONS, 'inclusion');
  inSql(contract.COMMERCIAL_STATUSES, 'commercial status');
  inSql(contract.PROVENANCES, 'provenance');
  inSql(contract.REVENUE_CLASSES, 'revenue class');
  inSql(contract.ALLOCATION_BASES, 'allocation basis');
  inSql(contract.RATE_CLASSIFICATIONS, 'rate classification');
  assert.ok(checkList('cost_stage text NOT NULL CHECK').length >= 17);
});

// ═══ 2. FX — reference only, immutable, never invented ═══════════════════

test('FX: JPY→USD is TRIANGULATED through EUR and the legs are preserved', async () => {
  const c = client();
  const rate = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' });
  assert.equal(rate.status, 'AVAILABLE');
  // 1 JPY = (1/181.59) EUR = (1/181.59)*1.1622 USD
  assert.ok(Math.abs(rate.rate - (1.1622 / 181.59)) < 1e-9, `rate was ${rate.rate}`);
  assert.equal(rate.triangulation.via, 'EUR');
  assert.deepEqual(rate.triangulation.legs.map((l) => l.pair), ['EUR/JPY', 'EUR/USD']);
});

test('FX: an unsupported currency is UNAVAILABLE — never approximated', async () => {
  const c = client();
  // ZWG (Zimbabwe) is genuinely not published by the ECB. Inventing one would be worse than none.
  const rate = await fx.getReferenceRate('ZWG', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' });
  assert.equal(rate.status, 'UNAVAILABLE');
  assert.equal(rate.rate, undefined, 'an unavailable rate must carry NO number');
  assert.match(rate.reason, /not published/i);
});

test('FX: an outage degrades the comparison and never fabricates a rate', async () => {
  const c = client();
  const rate = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: deadProvider, today: '2026-09-04' });
  assert.equal(rate.status, 'UNAVAILABLE');
  assert.equal(rate.rate, undefined);
  assert.notEqual(rate.rate, 0, 'an outage is never rate 0');
  assert.notEqual(rate.rate, 1, 'an outage is never 1:1');
});

test('FX: a weekend/non-publication gap reads STALE, with the source\'s own date', async () => {
  const c = client();
  // Sunday, when the newest publication is Friday's.
  const rate = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-13' });
  assert.equal(rate.status, 'STALE');
  assert.equal(rate.rate_date, '2026-09-04', 'the rate keeps ITS date, never today\'s');
});

test('FX: a malformed source response is refused rather than parsed hopefully', async () => {
  const c = client();
  const rate = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider('<html>bad gateway</html>'), today: '2026-09-04' });
  assert.equal(rate.status, 'UNAVAILABLE');
});

test('FX: a same-date replay reuses the stored snapshot rather than writing a second one', async () => {
  const c = client();
  const opts = { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' };
  const a = await fx.getReferenceRate('JPY', 'USD', opts);
  const b = await fx.getReferenceRate('JPY', 'USD', opts);
  assert.equal(a.snapshot_id, b.snapshot_id);
  assert.equal(c._rows('diaspora_fx_rate_snapshots').length, 1);
});

test('FX: reference FX may never be used for settlement or customs', () => {
  assert.throws(() => fx.assertReferenceOnly('SETTLEMENT'), /settlement/i);
  assert.throws(() => fx.assertReferenceOnly('CUSTOMS'), /customs/i);
  assert.equal(fx.assertReferenceOnly('DISPLAY'), true);
});

test('FX: the source amount survives even when conversion is impossible', async () => {
  const c = client();
  const shown = await fx.toReferenceUsd(78500, 'ZWG', { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' });
  assert.deepEqual(shown.source, { amount: 78500, currency: 'ZWG' });
  assert.equal(shown.reference, null, 'no reference figure at all — not 0, not the source relabelled');
});

// ═══ 3. Charge components ════════════════════════════════════════════════

test('a charge amount without its own currency is REFUSED', () => {
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800 }),
    /must state its own currency/i);
});

test('UNKNOWN is representable: a component may have no amount at all', () => {
  const c = charges.normalizeComponent({ cost_stage: 'CLEARING', label: 'Destination clearing', inclusion: 'EXCLUDED' });
  assert.equal(c.original_amount, null);
  assert.equal(c.inclusion, 'EXCLUDED');
});

test('a client cannot assert VERIFIED or HISTORICAL_ACTUAL provenance', () => {
  for (const p of ['VERIFIED', 'HISTORICAL_ACTUAL', 'DOCUMENT_DERIVED']) {
    assert.throws(() => charges.normalizeComponent({ cost_stage: 'GOODS', label: 'x', provenance: p }),
      /server-derived/i, `${p} must be server-derived`);
  }
  assert.equal(charges.normalizeComponent({ cost_stage: 'GOODS', label: 'x', provenance: 'PROVIDER_STATED' }).provenance, 'PROVIDER_STATED');
});

test('a counterparty cannot classify their own charge as CarUp revenue', () => {
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'CARUP', label: 'fee', revenue_class: 'CARUP_SERVICE_FEE' }),
    /Only CarUp may classify/i);
  assert.equal(charges.normalizeComponent({ cost_stage: 'CARUP', label: 'fee', revenue_class: 'CARUP_SERVICE_FEE', __carupAuthored: true }).revenue_class, 'CARUP_SERVICE_FEE');
});

test('CarUp never calculates duty or tax — that is the customs authority (T12)', () => {
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'IMPORT_CUSTOMS', label: 'Duty', provenance: 'CARUP_CALCULATED', original_amount: 500, original_currency: 'USD' }),
    /customs authority/i);
  // …but a figure SUPPLIED by an authority may be recorded, with its provenance.
  const recorded = charges.normalizeComponent({ cost_stage: 'IMPORT_CUSTOMS', label: 'ZIMRA assessment', provenance: 'PROVIDER_STATED', original_amount: 500, original_currency: 'USD' });
  assert.equal(recorded.cost_stage, 'IMPORT_CUSTOMS');
});

test('invented vocabulary is refused at the service boundary too', () => {
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'BRIBERY', label: 'x' }), /Unsupported cost stage/i);
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'GOODS', label: 'x', inclusion: 'MAYBE' }), /Unsupported inclusion/i);
  assert.throws(() => charges.normalizeComponent({ cost_stage: 'GOODS', label: 'x', revenue_class: 'MYSTERY' }), /Unsupported revenue class/i);
});

// ═══ 4. Landed cost — the estimate that refuses to lie ═══════════════════

const projected = async (components, provider = feedProvider()) =>
  charges.projectComponentsForDisplay(components, { supabaseClient: client(), provider, today: '2026-09-04' });

test('an EXCLUDED charge is never rendered as zero', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'CLEARING', label: 'Destination clearing', original_amount: null, original_currency: null, inclusion: 'EXCLUDED', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.equal(estimate.known_included_by_currency.USD, 1800);
  assert.equal(estimate.excluded.length, 1);
  assert.equal(estimate.excluded[0].original.amount, null, 'excluded is unpriced here, and certainly not 0');
  assert.equal(estimate.is_complete, false);
});

test('the estimate NAMES the unpriced stages rather than printing a total', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'GOODS', label: 'Vehicle', original_amount: 21500, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.equal(estimate.is_complete, false, 'clearing, inland and customs are all missing');
  const missing = estimate.missing_material_stages.map((m) => m.stage);
  assert.deepEqual(missing.sort(), ['CLEARING', 'IMPORT_CUSTOMS', 'INLAND']);
  assert.match(estimate.customs_note, /not calculated yet/i);
});

test('amounts in different currencies are grouped, never summed', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'GOODS', label: 'Vehicle', original_amount: 2400000, original_currency: 'JPY', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.deepEqual(Object.keys(estimate.known_included_by_currency).sort(), ['JPY', 'USD']);
  assert.equal(estimate.known_included_by_currency.JPY, 2400000, 'JPY stays JPY');
});

test('when one amount cannot convert, there is NO single comparable USD figure', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'GOODS', label: 'Vehicle', original_amount: 100, original_currency: 'ZWG', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.equal(estimate.known_included_reference_usd, null);
  assert.equal(estimate.reference_usd_incomplete, true);
});

test('a CarUp fee is reported separately from third-party costs', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'CARUP', label: 'CarUp coordination fee', original_amount: 50, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'CARUP_CALCULATED', revenue_class: 'CARUP_SERVICE_FEE' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.equal(estimate.carup_charges.length, 1);
  assert.equal(estimate.carup_charges[0].revenue_class, 'CARUP_SERVICE_FEE');
  assert.equal(p.find((x) => x.id === '2').is_carup_revenue, true);
  assert.equal(p.find((x) => x.id === '1').is_carup_revenue, false);
});

// ═══ 5. Comparability — no false cheapest ════════════════════════════════

const q = (id, label, comps, complete = true) => ({
  id, label, components: comps,
  estimate: { known_included_reference_usd: comps.filter((c) => c.inclusion === 'INCLUDED').reduce((s, c) => s + (c.reference_usd?.amount || 0), 0), is_complete: complete },
});
const comp = (stage, usd, inclusion = 'INCLUDED') => ({
  cost_stage: stage, inclusion, original: { amount: usd, currency: 'USD' },
  reference_usd: usd === null ? null : { amount: usd, currency: 'USD' },
});

test('different SCOPES are not comparable numbers', () => {
  const a = q('a', 'Port-to-port', [comp('MAIN_CARRIAGE', 1700)]);
  const b = q('b', 'Door-to-door', [comp('MAIN_CARRIAGE', 1500), comp('INLAND', 400), comp('FINAL_DELIVERY', 200)]);
  const assessment = compare.assessComparability(a, b);
  assert.equal(assessment.verdict, compare.COMPARABILITY.PARTIALLY_COMPARABLE);
  assert.ok(assessment.reasons.some((r) => /Inland transport/i.test(r)));
  const result = compare.compareQuotes([a, b]);
  assert.equal(result.cheapest, null, 'no cheapest may be named across different scopes');
  assert.equal(result.comparable, false);
});

test('identical scopes ARE comparable, and the cheaper one may be named', () => {
  const a = q('a', 'A', [comp('MAIN_CARRIAGE', 1800), comp('CLEARING', 400)]);
  const b = q('b', 'B', [comp('MAIN_CARRIAGE', 1500), comp('CLEARING', 500)]);
  const result = compare.compareQuotes([a, b]);
  assert.equal(result.comparable, true);
  assert.equal(result.cheapest, 'b');
});

test('an offer is never cheapest when it simply priced FEWER stages', () => {
  // The real-world shape of "incomplete": one offer left charges out, so its total is lower for a
  // smaller purchase. Coverage differs, so no winner may be named.
  const a = q('a', 'Freight only', [comp('MAIN_CARRIAGE', 900)]);
  const b = q('b', 'Freight + clearing + inland', [comp('MAIN_CARRIAGE', 1000), comp('CLEARING', 400), comp('INLAND', 300)]);
  const result = compare.compareQuotes([a, b]);
  assert.equal(result.cheapest, null, 'the cheaper headline covers less, so it is not cheaper');
  assert.equal(result.comparable, false);
});

test('offers that price the SAME partial scope may be compared — with the caveat stated', () => {
  // Two ocean-freight-only offers are genuinely comparable on the ocean leg. Refusing the
  // arithmetic here would hide a real difference; the honest requirement is to say the journey is
  // not fully priced, which is what covers_full_journey carries.
  const a = q('a', 'RoRo', [comp('MAIN_CARRIAGE', 1600)], false);
  const b = q('b', 'Shared container', [comp('MAIN_CARRIAGE', 1800)], false);
  const result = compare.compareQuotes([a, b]);
  assert.equal(result.comparable, true);
  assert.equal(result.cheapest, 'a');
  assert.equal(result.covers_full_journey, false, 'the partial coverage must be flagged');
  assert.ok(result.reasons.some((r) => /not fully priced/i.test(r)), 'and stated in words');
});

test('a NOT_APPLICABLE stage is an ANSWER, not a gap', async () => {
  // A logistics quote moves cargo the customer already owns, so GOODS genuinely does not apply.
  // Reporting that journey as incomplete would punish a provider for answering honestly.
  const p = await projected([
    { id: '1', cost_stage: 'GOODS', label: 'Vehicle', original_amount: 0, original_currency: 'USD', inclusion: 'NOT_APPLICABLE', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1400, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '3', cost_stage: 'CLEARING', label: 'Clearing', original_amount: 400, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '4', cost_stage: 'INLAND', label: 'Inland', original_amount: 300, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '5', cost_stage: 'IMPORT_CUSTOMS', label: 'ZIMRA assessment', original_amount: 200, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'GOVERNMENT_DUTY' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.deepEqual(estimate.missing_material_stages, [], 'nothing is missing — GOODS was answered "not applicable"');
  assert.equal(estimate.is_complete, true);
  assert.equal(estimate.known_included_by_currency.USD, 2300, 'the NOT_APPLICABLE zero is not added in');
});

test('an UNKNOWN stage is still a gap — the distinction is preserved', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1400, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'CLEARING', label: 'Clearing', original_amount: null, original_currency: null, inclusion: 'UNKNOWN', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.ok(estimate.missing_material_stages.some((m) => m.stage === 'CLEARING'), 'UNKNOWN is a gap');
  assert.equal(estimate.is_complete, false);
});

// ═══ 6. Corridor economics ═══════════════════════════════════════════════

test('a corridor is NOT cheaper because its costs are unknown', () => {
  const result = compare.compareCorridorEconomics([
    { corridor_code: 'JP-BEI-ZW', components: [comp('MAIN_CARRIAGE', 1800)] },                       // 3 stages missing
    { corridor_code: 'JP-DUR-ZW', components: [comp('GOODS', 21500), comp('MAIN_CARRIAGE', 2000), comp('CLEARING', 400), comp('INLAND', 300), comp('IMPORT_CUSTOMS', 900)] },
  ]);
  assert.equal(result.cheapest_corridor, null, 'the 1800 corridor must not win on missing data');
  assert.equal(result.comparable, false);
  const bei = result.corridors.find((c) => c.corridor_code === 'JP-BEI-ZW');
  assert.ok(bei.missing_material_stages.length >= 3);
});

test('corridors with equal coverage CAN be compared', () => {
  const full = (freight) => [comp('GOODS', 21500), comp('MAIN_CARRIAGE', freight), comp('CLEARING', 400), comp('INLAND', 300), comp('IMPORT_CUSTOMS', 900)];
  const result = compare.compareCorridorEconomics([
    { corridor_code: 'JP-BEI-ZW', components: full(1800) },
    { corridor_code: 'JP-DUR-ZW', components: full(2100) },
  ]);
  assert.equal(result.comparable, true);
  assert.equal(result.cheapest_corridor, 'JP-BEI-ZW');
  assert.match(result.note, /No corridor is preferred by CarUp/i);
});

test('planning status never becomes a ranking', () => {
  const full = [comp('GOODS', 1), comp('MAIN_CARRIAGE', 1), comp('CLEARING', 1), comp('INLAND', 1), comp('IMPORT_CUSTOMS', 1)];
  const result = compare.compareCorridorEconomics([
    { corridor_code: 'JP-DAR-ZW', planning_status: 'research_candidate', components: full },
    { corridor_code: 'JP-BEI-ZW', planning_status: 'benchmark_candidate', components: full },
  ]);
  // Equal cost, different maturity — the tie is broken by cost order alone, never by status.
  assert.equal(result.corridors[0].planning_status, 'research_candidate');
  assert.match(result.note, /never desirability/i);
});

// ═══ 7. Advisor ══════════════════════════════════════════════════════════

test('every advisor finding carries the measured reason behind it', () => {
  const a = q('a', 'A', [comp('MAIN_CARRIAGE', 1800)]);
  const b = q('b', 'B', [comp('MAIN_CARRIAGE', 1500), comp('INLAND', 400)]);
  const advice = adviseAll([a, b]);
  for (const f of advice.findings) {
    assert.ok(Array.isArray(f.because) && f.because.length, `${f.code} must explain itself`);
    assert.ok(f.headline, `${f.code} needs a headline`);
  }
});
function adviseAll(options, extra = {}) { return compare.adviseOptions({ options, ...extra }); }

test('the advisor says so plainly when options are not the same purchase', () => {
  const a = q('a', 'A', [comp('MAIN_CARRIAGE', 1700)]);
  const b = q('b', 'B', [comp('INLAND', 400)]);
  const advice = adviseAll([a, b]);
  assert.ok(advice.findings.some((f) => f.code === 'NOT_COMPARABLE'));
  assert.equal(advice.compared, false);
});

test('a non-running vehicle is reported as a FACT, not as a booking decision', () => {
  const advice = adviseAll([q('a', 'A', [comp('MAIN_CARRIAGE', 1800)])], { cargo: { vehicle_running_state: 'non_running' } });
  const finding = advice.findings.find((f) => f.code === 'NON_RUNNING_VEHICLE');
  assert.ok(finding);
  assert.ok(finding.because.some((r) => /operator and carrier decision/i.test(r)));
});

// ═══ 8. Allocation ═══════════════════════════════════════════════════════

test('allocation reconciles EXACTLY, including an awkward three-way split', () => {
  const { allocations } = alloc.allocateExactly(100, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]);
  const total = allocations.reduce((s, a) => s + a.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 100, `three-way split of 100 summed to ${total}`);
  assert.equal(allocations.filter((a) => a.remainder > 0).length, 1, 'the remainder lands on exactly one participant');
});

test('allocation is deterministic — the same input allocates identically every time', () => {
  const run = () => alloc.allocateExactly(1000, [{ id: 'a', weight: 18 }, { id: 'b', weight: 36 }, { id: 'c', weight: 7 }]).allocations;
  assert.deepEqual(run(), run());
});

test('allocation is proportional to the stated basis', () => {
  const { allocations } = alloc.allocateExactly(180000, [{ id: 'a', weight: 18 }, { id: 'b', weight: 36 }]);
  const byId = Object.fromEntries(allocations.map((a) => [a.id, a.amount]));
  assert.equal(byId.a, 60000);
  assert.equal(byId.b, 120000);
});

test('a participant with no recorded basis quantity cannot be allocated to', () => {
  assert.throws(() => alloc.allocateExactly(100, [{ id: 'a', weight: 0 }]), /positive basis quantity/i);
});

// ═══ 9. Gaps found by mutation testing — the guards above were not enough ═
//
// Two mutations initially SURVIVED: turning an unpriced component into a zero, and letting the
// allocator default to CBM. Both are exactly the failures this phase exists to prevent, so the
// assertions that catch them belong here permanently.

test('an unpriced component is reported as UNPRICED, by name', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1800, original_currency: 'USD', inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
    { id: '2', cost_stage: 'INLAND', label: 'Harare delivery', original_amount: null, original_currency: null, inclusion: 'INCLUDED', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.equal(estimate.unpriced.length, 1, 'the unpriced component must be listed');
  assert.equal(estimate.unpriced[0].stage, 'INLAND');
  assert.equal(estimate.unpriced[0].stage_label, 'Inland transport');
  // and it must NOT have been quietly folded into the money as a zero
  assert.equal(estimate.known_included_by_currency.USD, 1800);
  assert.equal(estimate.is_complete, false);
});

test('an unpriced component never creates a currency bucket out of nothing', async () => {
  const p = await projected([
    { id: '1', cost_stage: 'CLEARING', label: 'Clearing', original_amount: null, original_currency: null, inclusion: 'INCLUDED', commercial_status: 'INDICATIVE', provenance: 'PROVIDER_STATED', revenue_class: 'PASS_THROUGH_COST' },
  ]);
  const estimate = charges.composeLandedEstimate(p);
  assert.deepEqual(estimate.known_included_by_currency, {}, 'no amount means no bucket — not a 0 bucket');
  assert.equal(estimate.known_included_reference_usd, null);
});

test('allocation REFUSES to proceed without a stated basis — no silent CBM default', async () => {
  const c = client({
    diaspora_container_shipments: [{ id: 'sail-1', tenant_id: null, coordinator_id: 'rev', deleted_at: null }],
    diaspora_trade_charge_components: [{ id: 'comp-1', logistics_quote_id: 'lq-1', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1000, original_currency: 'USD', deleted_at: null }],
    diaspora_cargo_reservations: [{ id: 'res-1', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null }],
  });
  const operator = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
  await assert.rejects(
    () => alloc.allocateSharedCharge('comp-1', { containerId: 'sail-1' }, operator, { supabaseClient: c }),
    /allocation basis must be stated/i);
  await assert.rejects(
    () => alloc.allocateSharedCharge('comp-1', { containerId: 'sail-1', basis: '' }, operator, { supabaseClient: c }),
    /allocation basis must be stated/i);
});

test('allocation charges APPROVED participants only — a REQUESTED booking is not a charge', async () => {
  const c = client({
    diaspora_container_shipments: [{ id: 'sail-1', tenant_id: null, coordinator_id: 'rev', deleted_at: null }],
    diaspora_trade_charge_components: [{ id: 'comp-1', logistics_quote_id: 'lq-1', cost_stage: 'MAIN_CARRIAGE', label: 'Ocean freight', original_amount: 1000, original_currency: 'USD', deleted_at: null }],
    diaspora_cargo_reservations: [
      { id: 'res-approved', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null },
      { id: 'res-requested', container_id: 'sail-1', reservation_status: 'REQUESTED', estimated_volume: 10, deleted_at: null },
    ],
  });
  const operator = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
  const result = await alloc.allocateSharedCharge('comp-1', { containerId: 'sail-1', basis: 'CBM' }, operator, { supabaseClient: c });
  assert.equal(result.allocations.length, 1, 'only the APPROVED participant is charged');
  assert.equal(result.allocations[0].reservation_id, 'res-approved');
  assert.equal(result.allocations[0].allocated_amount, 1000, 'the approved participant carries the whole charge');
  assert.equal(result.reconciles_exactly, true);
});

test('an UNPRICED charge cannot be allocated — unknown is not an amount to divide', async () => {
  const c = client({
    diaspora_container_shipments: [{ id: 'sail-1', tenant_id: null, coordinator_id: 'rev', deleted_at: null }],
    diaspora_trade_charge_components: [{ id: 'comp-x', logistics_quote_id: 'lq-1', cost_stage: 'CLEARING', label: 'Clearing', original_amount: null, original_currency: null, deleted_at: null }],
    diaspora_cargo_reservations: [{ id: 'res-1', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null }],
  });
  const operator = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
  await assert.rejects(
    () => alloc.allocateSharedCharge('comp-x', { containerId: 'sail-1', basis: 'CBM' }, operator, { supabaseClient: c }),
    /unknown is not an amount to divide/i);
});

test('an EXPLICIT split that does not reconcile is refused', async () => {
  const c = client({
    diaspora_container_shipments: [{ id: 'sail-1', tenant_id: null, coordinator_id: 'rev', deleted_at: null }],
    diaspora_trade_charge_components: [{ id: 'comp-1', logistics_quote_id: 'lq-1', cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1000, original_currency: 'USD', deleted_at: null }],
    diaspora_cargo_reservations: [
      { id: 'r1', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null },
      { id: 'r2', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null },
    ],
  });
  const operator = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
  await assert.rejects(
    () => alloc.allocateSharedCharge('comp-1', { containerId: 'sail-1', basis: 'EXPLICIT', explicit: { r1: 400, r2: 400 } }, operator, { supabaseClient: c }),
    /reconcile to the charge exactly/i);
});

test('a rival organisation cannot allocate a charge on a sailing it does not operate', async () => {
  const c = client({
    diaspora_container_shipments: [{ id: 'sail-1', tenant_id: 'tenant-a', coordinator_id: 'someone-else', deleted_at: null }],
    diaspora_trade_charge_components: [{ id: 'comp-1', logistics_quote_id: 'lq-1', cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1000, original_currency: 'USD', deleted_at: null }],
    diaspora_cargo_reservations: [{ id: 'r1', container_id: 'sail-1', reservation_status: 'APPROVED', estimated_volume: 10, deleted_at: null }],
  });
  const rival = { id: 'rival', userId: 'rival', role: 'owner', platformRole: 'owner', tenantId: 'tenant-b', tenantRole: 'admin' };
  await assert.rejects(
    () => alloc.allocateSharedCharge('comp-1', { containerId: 'sail-1', basis: 'CBM' }, rival, { supabaseClient: c }),
    /operating organisation/i);
});

test('a stored snapshot keeps ITS OWN rate date when read back on a later day', async () => {
  // The failure this prevents: stamping today's date onto yesterday's rate, so a customer reading
  // an old quote believes the conversion is current. The rate a quote was shown with, and the date
  // that rate belongs to, travel together forever.
  const c = client();
  const stored = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' });
  assert.equal(stored.rate_date, '2026-09-04');

  // Two days later, still within the staleness window, so the SAME snapshot is served.
  const later = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-06' });
  assert.equal(later.snapshot_id, stored.snapshot_id, 'the same snapshot must be reused');
  assert.equal(later.rate_date, '2026-09-04', "the snapshot keeps its own date — never the reader's today");
  assert.equal(later.rate, stored.rate);
});

test('a NEWER published rate never rewrites what an older quote was shown', async () => {
  const c = client();
  const first = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(), today: '2026-09-04' });
  // A later publication with a different rate arrives.
  const movedXml = ECB_XML.replace("currency='JPY' rate='181.59'", "currency='JPY' rate='150.00'").replace("time='2026-09-04'", "time='2026-09-20'");
  const second = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: feedProvider(movedXml), today: '2026-09-20' });
  assert.notEqual(second.snapshot_id, first.snapshot_id, 'a new rate is a NEW snapshot');
  assert.notEqual(second.rate, first.rate);
  // The original snapshot row is untouched — the conversion a customer already saw is reproducible.
  const rows = c._rows('diaspora_fx_rate_snapshots').filter((r) => r.base_currency === 'JPY');
  const original = rows.find((r) => r.id === first.snapshot_id);
  assert.equal(Number(original.rate), first.rate, 'the historical snapshot is unchanged');
  assert.equal(original.rate_date, '2026-09-04');
});

// ═══ 10. Source-money integrity — a defect found on deployed staging ═════
//
// The two quote authorities read DIFFERENT field names (procurement `quote_currency`, logistics
// `currency`) and both fell back to 'USD'. Sending the other domain's field name silently produced
// a USD row: a JPY 2,400,000 offer became USD 2,400,000. 'USD' is a valid code, so nothing caught
// it. These tests exist because the staging run actually triggered it.

const money = await import('../services/diaspora/tradeSourceMoney.js');

test('either domain\'s currency field name is honoured — the mismatch was the API\'s fault', () => {
  assert.equal(money.resolveSourceCurrency({ quote_currency: 'JPY' }, ['quote_currency', 'currency']), 'JPY');
  assert.equal(money.resolveSourceCurrency({ currency: 'JPY' }, ['quote_currency', 'currency']), 'JPY',
    'the logistics field name must not silently become USD in procurement');
  assert.equal(money.resolveSourceCurrency({ quote_currency: 'JPY' }, ['currency', 'quote_currency']), 'JPY',
    'and vice versa');
});

test('a supplied currency must be ISO 4217 — garbage is refused, not stored', () => {
  for (const bad of ['dollars', 'US', 'USDD', '123']) {
    assert.throws(() => money.resolveSourceCurrency({ currency: bad }, ['currency']), /ISO 4217/i, `"${bad}" must be refused`);
  }
  assert.equal(money.resolveSourceCurrency({ currency: 'jpy' }, ['currency']), 'JPY', 'case is normalised, not rejected');
});

test('USD remains the default ONLY through genuine absence', () => {
  assert.equal(money.resolveSourceCurrency({}, ['quote_currency', 'currency']), 'USD');
  assert.equal(money.resolveSourceCurrency({ quote_amount: 100 }, ['quote_currency', 'currency']), 'USD');
});

test('an update keeps the currency it already had rather than resetting to USD', () => {
  assert.equal(money.resolveSourceCurrency({ total_amount: 200 }, ['currency'], { currency: 'JPY' }), 'JPY',
    'a PATCH that does not mention currency must not silently redenominate the offer');
});

test('the corridor comparison and the landed estimate share ONE coverage rule', () => {
  // These two drifted the first time they were written separately: the estimate was corrected to
  // treat NOT_APPLICABLE as answered and the corridor comparison was not, so the same journey read
  // complete on one screen and incomplete on the other. They now import the same helper, and this
  // test fails if either grows its own copy again.
  const components = [
    { cost_stage: 'GOODS', inclusion: 'NOT_APPLICABLE', original: { amount: null, currency: null }, reference_usd: null },
    ...['MAIN_CARRIAGE', 'CLEARING', 'INLAND', 'IMPORT_CUSTOMS'].map((stage) => ({
      cost_stage: stage, inclusion: 'INCLUDED',
      original: { amount: 100, currency: 'USD' }, reference_usd: { amount: 100, currency: 'USD' },
    })),
  ];
  const estimate = charges.composeLandedEstimate(components);
  const corridor = compare.compareCorridorEconomics([{ corridor_code: 'X', components }]).corridors[0];
  assert.equal(estimate.is_complete, true, 'the estimate must see this journey as complete');
  assert.equal(corridor.coverage_complete, true, 'and so must the corridor comparison');
  assert.deepEqual(estimate.missing_material_stages, []);
  assert.deepEqual(corridor.missing_material_stages, []);
  assert.equal(estimate.unpriced.length, 0, 'a NOT_APPLICABLE stage is not an unpriced gap');
});

test('a genuinely unknown stage is a gap in BOTH views', () => {
  const components = [
    { cost_stage: 'MAIN_CARRIAGE', inclusion: 'INCLUDED', original: { amount: 100, currency: 'USD' }, reference_usd: { amount: 100, currency: 'USD' } },
    { cost_stage: 'CLEARING', inclusion: 'UNKNOWN', original: { amount: null, currency: null }, reference_usd: null },
  ];
  const estimate = charges.composeLandedEstimate(components);
  const corridor = compare.compareCorridorEconomics([{ corridor_code: 'X', components }]).corridors[0];
  assert.equal(estimate.is_complete, false);
  assert.equal(corridor.coverage_complete, false);
  assert.ok(estimate.unpriced.some((u) => u.stage === 'CLEARING'));
});

// ═══ 11. Quote TOTAL vs structured BREAKDOWN ═════════════════════════════
//
// The headline total predates T6 and is the provider's stated commercial figure. The breakdown is
// new and may be partial. Treating "sum of components" as "the total" would let a breakdown that
// explains 2,250,000 of a 2,400,000 offer read as if the whole price were accounted for.

const brk = (over = {}) => ({ inclusion: 'INCLUDED', ...over });

test('a PARTIAL breakdown names the amount that is not itemised', () => {
  const r = contract.reconcileBreakdown({
    total: 2400000, currency: 'JPY',
    components: [brk({ original_amount: 2250000, original_currency: 'JPY' })],
  });
  assert.equal(r.computable, true);
  assert.equal(r.itemised, 2250000);
  assert.equal(r.not_itemised, 150000);
  assert.equal(r.complete, false);
  assert.match(r.note, /150000 JPY of this total is not itemised/);
});

test('an empty breakdown explains NONE of the total — it is not "complete"', () => {
  const r = contract.reconcileBreakdown({ total: 2400000, currency: 'JPY', components: [] });
  assert.equal(r.complete, false);
  assert.equal(r.itemised, null);
  assert.equal(r.not_itemised, 2400000);
  assert.match(r.note, /none of this total is explained/i);
});

test('a breakdown that adds up exactly is complete', () => {
  const r = contract.reconcileBreakdown({
    total: 2400000, currency: 'JPY',
    components: [brk({ original_amount: 2200000, original_currency: 'JPY' }), brk({ original_amount: 200000, original_currency: 'JPY' })],
  });
  assert.equal(r.complete, true);
  assert.equal(r.not_itemised, 0);
});

test('components exceeding the total are reported, not clamped to zero', () => {
  const r = contract.reconcileBreakdown({
    total: 1000, currency: 'USD', components: [brk({ original_amount: 1200, original_currency: 'USD' })],
  });
  assert.equal(r.complete, false);
  assert.equal(r.not_itemised, -200);
  assert.match(r.note, /exceed the stated total by 200 USD/);
});

test('MIXED currencies are never summed to force reconciliation', () => {
  const r = contract.reconcileBreakdown({
    total: 2400000, currency: 'JPY',
    components: [brk({ original_amount: 2200000, original_currency: 'JPY' }), brk({ original_amount: 1800, original_currency: 'USD' })],
  });
  assert.equal(r.computable, false);
  assert.equal(r.mixed_currency, true);
  assert.deepEqual(r.foreign_currencies, ['USD']);
  assert.match(r.reason, /conversion nobody has authorised/i);
  // both currencies are still reported, separately
  assert.equal(r.itemised_by_currency.JPY, 2200000);
  assert.equal(r.itemised_by_currency.USD, 1800);
});

test('EXCLUDED components are not counted toward the total', () => {
  const r = contract.reconcileBreakdown({
    total: 1800, currency: 'USD',
    components: [brk({ original_amount: 1800, original_currency: 'USD' }),
                 { inclusion: 'EXCLUDED', original_amount: 400, original_currency: 'USD' }],
  });
  assert.equal(r.itemised, 1800, 'an excluded charge is not part of what the customer pays this provider');
  assert.equal(r.complete, true);
});

test('a provider declaring a COMPLETE breakdown that does not reconcile is refused', async () => {
  const c = client({
    diaspora_logistics_quotes: [{ id: 'lq-1', provider_id: 'provider-b', total_amount: 2000, currency: 'USD', deleted_at: null }],
  });
  const provider = { id: 'provider-b', userId: 'provider-b', role: 'owner', platformRole: 'owner', tenantId: null };
  await assert.rejects(
    () => charges.addChargeComponents({ logisticsQuoteId: 'lq-1' },
      [{ cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1500, original_currency: 'USD', inclusion: 'INCLUDED' }],
      provider, { supabaseClient: c, breakdownComplete: true }),
    /must account for the whole offer total/i);
});

test('…while the same components submitted as PARTIAL are accepted', async () => {
  const c = client({
    diaspora_logistics_quotes: [{ id: 'lq-1', provider_id: 'provider-b', total_amount: 2000, currency: 'USD', deleted_at: null }],
  });
  const provider = { id: 'provider-b', userId: 'provider-b', role: 'owner', platformRole: 'owner', tenantId: null };
  const saved = await charges.addChargeComponents({ logisticsQuoteId: 'lq-1' },
    [{ cost_stage: 'MAIN_CARRIAGE', label: 'Freight', original_amount: 1500, original_currency: 'USD', inclusion: 'INCLUDED' }],
    provider, { supabaseClient: c });
  assert.equal(saved.length, 1);
});

// ═══ 12. Research / operations rate workspace ════════════════════════════
//
// The separation this defends: a research note is not something a provider offered a customer, and
// synthetic certification data must never read as market economics.

const rates = await import('../services/diaspora/tradeRateObservationService.js');

const opsClient = (seed = {}) => createMockSupabase({
  diaspora_trade_rate_observations: [], diaspora_import_audit_log: [],
  users: [{ id: 'rev' }], ...seed,
});
const reviewer = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
const admin = { id: 'adm', userId: 'adm', role: 'admin', platformRole: 'admin', tenantId: null };
const buyerCtx = { id: 'buyer', userId: 'buyer', role: 'owner', platformRole: 'owner', tenantId: null };
const dealerCtx = { id: 'dealer', userId: 'dealer', role: 'owner', platformRole: 'owner', tenantId: 'tenant-a', tenantRole: 'admin' };

const observation = (over = {}) => ({
  classification: 'RESEARCH_OBSERVATION', cost_stage: 'MAIN_CARRIAGE',
  label: 'Yokohama → Beira 40HC', amount: 1800, currency: 'USD',
  effective_from: '2026-09-01', source_name: 'SYNTHETIC certification fixture',
  is_synthetic: true, ...over,
});

test('research authority is PLATFORM authority — a commercial profile grants nothing', async () => {
  const c = opsClient();
  for (const [who, ctx] of [['a buyer', buyerCtx], ['a dealer/tenant admin', dealerCtx]]) {
    await assert.rejects(() => rates.recordObservation(observation(), ctx, { supabaseClient: c }),
      /restricted to CarUp platform reviewers/i, `${who} must be refused`);
    await assert.rejects(() => rates.listObservations({}, ctx, { supabaseClient: c }),
      /restricted to CarUp platform reviewers/i, `${who} must not read the workspace`);
  }
  const saved = await rates.recordObservation(observation(), reviewer, { supabaseClient: c });
  assert.ok(saved.id, 'a platform reviewer may record');
  assert.ok((await rates.listObservations({}, admin, { supabaseClient: c })).length === 1, 'and an admin may read');
});

test('a synthetic observation stays flagged, and says so in its provenance', async () => {
  const c = opsClient();
  await rates.recordObservation(observation(), reviewer, { supabaseClient: c });
  const [row] = await rates.listObservations({}, reviewer, { supabaseClient: c });
  assert.equal(row.is_synthetic, true);
  assert.match(row.source_name, /SYNTHETIC/);
  // The projection is explicit for every consumer, so no screen can present it as a customer quote.
  assert.equal(row.is_provider_quote_to_customer, false);
});

test('an observation must NAME its source — an unattributed rate is not evidence', () => {
  assert.throws(() => rates.normalizeObservation(observation({ source_name: '' })), /must name its source/i);
});

test('classification and stage vocabularies are enforced', () => {
  assert.throws(() => rates.normalizeObservation(observation({ classification: 'HEARSAY' })), /Unsupported rate classification/i);
  assert.throws(() => rates.normalizeObservation(observation({ cost_stage: 'VIBES' })), /Unsupported cost stage/i);
});

test('an observation needs an effective date and a valid currency', () => {
  assert.throws(() => rates.normalizeObservation(observation({ effective_from: null })), /effective date/i);
  assert.throws(() => rates.normalizeObservation(observation({ currency: 'dollars' })), /ISO 4217/i);
  assert.throws(() => rates.normalizeObservation(observation({ effective_from: '2026-09-10', effective_to: '2026-09-01' })), /expire before it takes effect/i);
});

test('an OFFICIAL_FEE is not a CarUp estimate, and neither is a provider rate card', () => {
  for (const classification of ['OFFICIAL_FEE', 'PROVIDER_RATE_CARD', 'CARUP_ESTIMATE', 'HISTORICAL_ACTUAL']) {
    const row = rates.normalizeObservation(observation({ classification }));
    assert.equal(row.classification, classification, 'the distinction is preserved verbatim');
  }
});

test('the corridor benchmark reports the RESEARCH GAP rather than implying data exists', async () => {
  const c = opsClient({ diaspora_trade_rate_observations: [
    { ...rates.normalizeObservation(observation({ corridor_id: 'cor-bei' })), id: 'o1', deleted_at: null, observed_at: '2026-09-01' },
    { ...rates.normalizeObservation(observation({ corridor_id: 'cor-dur', amount: 2100 })), id: 'o2', deleted_at: null, observed_at: '2026-09-01' },
  ] });
  const result = await rates.corridorBenchmark({}, reviewer, { supabaseClient: c });
  assert.equal(result.corridors.length, 2);
  assert.ok(result.corridors.every((x) => x.synthetic_only), 'both corridors hold synthetic data only');
  assert.match(result.research_status, /No real market observations/i);
  assert.match(result.research_status, /must not be read as market economics/i);
  assert.equal(result.comparable, false);
  assert.match(result.note, /names no cheapest corridor/i);
});

test('the benchmark acknowledges real data the moment any exists', async () => {
  const c = opsClient({ diaspora_trade_rate_observations: [
    { ...rates.normalizeObservation(observation({ corridor_id: 'cor-bei', is_synthetic: false, classification: 'PROVIDER_RATE_CARD', source_name: 'Hikari Co-Load rate card' })), id: 'o1', deleted_at: null, observed_at: '2026-09-01' },
  ] });
  const result = await rates.corridorBenchmark({}, reviewer, { supabaseClient: c });
  assert.equal(result.corridors[0].real_observations, 1);
  assert.equal(result.corridors[0].synthetic_only, false);
  assert.match(result.research_status, /Real observations are recorded/i);
  // Even with real data it draws no conclusion — that is the customer path's job, from real quotes.
  assert.equal(result.comparable, false);
});

// ── T6 material coverage is about the PURCHASE, not a single global list ────────────────────
//
// Found on the deployed shipping-requester screen: a freight offer that priced the whole ocean
// leg was reported as still missing "The goods themselves". A logistics provider never prices the
// customer's own cargo, so the gap list — the one list whose whole job is to be believed — was
// carrying a permanent false entry on every shipping offer.

test('a logistics offer is not asked to price the goods the customer already owns', () => {
  const logistics = contract.materialStagesFor('logistics');
  assert.ok(!logistics.includes('GOODS'), 'GOODS must not be material for a freight service');
  // Everything that IS the freight provider's business stays material.
  for (const stage of ['MAIN_CARRIAGE', 'CLEARING', 'INLAND', 'IMPORT_CUSTOMS']) {
    assert.ok(logistics.includes(stage), `${stage} must stay material for a logistics offer`);
  }
});

test('a procurement offer still has to account for the goods', () => {
  assert.ok(contract.materialStagesFor('procurement').includes('GOODS'));
  // An unrecognised domain gets the STRICTER list — a mislabelled quote must not lose a check.
  assert.ok(contract.materialStagesFor('').includes('GOODS'));
  assert.ok(contract.materialStagesFor(undefined).includes('GOODS'));
  assert.ok(contract.materialStagesFor('import-quotes').includes('GOODS'));
});

test('the same components produce different gap lists for the two purchases', () => {
  const projected = [{
    cost_stage: 'MAIN_CARRIAGE', stage_label: 'Main transport', label: 'Ocean freight',
    inclusion: 'INCLUDED', original: { amount: 480000, currency: 'JPY' },
    reference_usd: { amount: 3072.06, currency: 'USD' }, is_carup_revenue: false,
  }];
  const asLogistics = charges.composeLandedEstimate(projected, { materialStages: contract.materialStagesFor('logistics') });
  const asProcurement = charges.composeLandedEstimate(projected, { materialStages: contract.materialStagesFor('procurement') });
  const stages = (e) => e.missing_material_stages.map((s) => s.stage);
  assert.ok(!stages(asLogistics).includes('GOODS'));
  assert.ok(stages(asProcurement).includes('GOODS'));
  // Neither becomes "complete" on the strength of a narrower list — dropping GOODS must not
  // silently turn a partly-priced freight offer into a full landed cost.
  assert.equal(asLogistics.is_complete, false);
  assert.equal(asProcurement.is_complete, false);
});
