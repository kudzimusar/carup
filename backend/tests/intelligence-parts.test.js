/**
 * CarUp Intelligence 1.0 — I12 parts and supplier intelligence.
 *
 * The defining risk in this domain is not a wrong number, it is a confident one.
 * CarUp holds no parts catalogue, no fitment table and no supplier principal, so a
 * compatibility claim or a supplier scorecard would be invented from nothing — and
 * a wrong compatibility claim puts the wrong component on a car.
 *
 * So the tests assert what is refused as carefully as what is computed, and they
 * hold the I9 scope freeze: a PartSentry record belongs to a PERSON, a stock list
 * belongs to an ORGANIZATION, and neither answers for the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  getMechanicPartsIntelligence,
  getPlatformPartsIntelligence,
  buildRfqDemand,
  buildProvenance,
  buildInventory,
  NOT_MEASURABLE,
  PARTS_INTELLIGENCE_VERSION,
} from '../services/intelligence/partsIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TRACKING = codeOnly(read('web/src/pages/dashboard/mechanic/PartsTracking.tsx'));

const MECHANIC = { id: 'm1', role: 'mechanic', tenantId: 'garage-a' };
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const log = (o = {}) => ({
  id: o.id || 'l1', mechanic_id: o.mechanic_id === undefined ? 'm1' : o.mechanic_id,
  part_verification_status: o.part_verification_status || 'unverified',
  verification_status: o.verification_status || 'unverified',
  suspicion_status: o.suspicion_status || 'none',
  public_card_eligible: o.public_card_eligible ?? false,
  created_at: o.created_at || today,
});

const rfq = (o = {}) => ({
  id: o.id || 'q1', inquiry_type: o.inquiry_type || 'part_quote_request',
  status: o.status || 'new', source_channel: o.source_channel || 'web',
  created_at: o.created_at || today,
});

const part = (o = {}) => ({
  id: o.id || 'p1',
  stock_level: o.stock_level === undefined ? 10 : o.stock_level,
  min_stock: o.min_stock === undefined ? null : o.min_stock,
  unit_price: o.unit_price === undefined ? 25 : o.unit_price,
  tenant_id: o.tenant_id || 'garage-a',
});

function createClient({ logs = [], inquiries = [], parts = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const filters = {};
    const api = {
      select() { return api },
      eq(col, val) { filters[col] = val; return api },
      in(col, vals) { filters[col] = { __in: vals }; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        const out = rows.filter((row) => Object.entries(filters).every(([k, v]) => (
          v && typeof v === 'object' && v.__in ? v.__in.includes(row[k]) : row[k] === v
        )));
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
    };
    return api;
  };
  return {
    from: (t) => build(t, {
      partsentry_logs: logs,
      marketplace_inquiries: inquiries,
      mechanic_parts: parts,
    }[t] ?? []),
  };
}

// ── What is refused, and why ───────────────────────────────────────────────

test('compatibility, supplier performance and parts-catalogue demand are refused with reasons', () => {
  const byKey = Object.fromEntries(NOT_MEASURABLE.map((e) => [e.key, e]));
  for (const key of ['demand_by_part', 'supplier_attribution', 'supplier_performance', 'compatibility', 'zero_result_parts_demand']) {
    assert.ok(byKey[key], `${key} must be declared unmeasurable rather than estimated`);
    assert.ok(byKey[key].reason && byKey[key].detail, `${key} must carry a reason and a detail`);
  }
  // The reason must be structural, not "coming soon".
  assert.equal(byKey.compatibility.reason, 'no_catalogue_or_fitment_data');
  assert.equal(byKey.supplier_performance.reason, 'no_supplier_principal');
});

test('no projection ever emits a compatibility, fitment or supplier-score FIELD', async () => {
  const client = createClient({ logs: [log()], inquiries: [rfq()], parts: [part()] });
  const platform = await getPlatformPartsIntelligence(client, ADMIN);
  const mechanic = await getMechanicPartsIntelligence(client, MECHANIC);

  for (const result of [platform, mechanic]) {
    const keys = [
      ...Object.keys(result.provenance || {}),
      ...Object.keys(result.rfq_demand || {}),
      ...Object.keys(result.inventory || {}),
    ].join(' ').toLowerCase();
    for (const forbidden of ['compat', 'fitment', 'supplier_score', 'supplier_rating', 'win_rate', 'lead_time']) {
      assert.ok(!keys.includes(forbidden), `no parts field may be named "${forbidden}"`);
    }
  }
  assert.equal(platform.calculation_version, PARTS_INTELLIGENCE_VERSION);
});

// ── The I9 scope freeze still holds ────────────────────────────────────────

test('a practitioner sees only their own PartSentry records', async () => {
  const client = createClient({
    logs: [log({ id: 'mine', mechanic_id: 'm1' }), log({ id: 'theirs', mechanic_id: 'm2' }), log({ id: 'orphan', mechanic_id: null })],
  });
  const result = await getMechanicPartsIntelligence(client, MECHANIC);
  assert.equal(result.provenance.logs_recorded.value, 1);
  assert.equal(result.scope, 'mechanic');
});

test('a practitioner with no organization is told stock is an organization question, not shown zero', async () => {
  const client = createClient({ parts: [part({ tenant_id: 'garage-a' })] });
  const result = await getMechanicPartsIntelligence(client, { id: 'm1', role: 'mechanic', tenantId: null });
  assert.equal(result.inventory.unavailable, true);
  assert.ok(/organization/i.test(result.inventory.note));
  assert.equal(result.inventory.part_types_tracked, undefined, 'no count may be published for a scope that does not apply');
});

test('a practitioner never receives platform RFQ demand', async () => {
  const client = createClient({ inquiries: [rfq(), rfq({ id: 'q2' })] });
  const result = await getMechanicPartsIntelligence(client, MECHANIC);
  assert.equal(result.rfq_demand, undefined,
    'RFQ demand is a platform figure; handing it to one party presents everyone\'s demand as theirs');
});

test('platform parts intelligence requires a platform administrator', async () => {
  const client = createClient({});
  await assert.rejects(() => getPlatformPartsIntelligence(client, MECHANIC), AuthorizationError);
  await assert.rejects(() => getPlatformPartsIntelligence(client, { id: 'd1', role: 'dealer' }), AuthorizationError);
});

test('an unauthenticated caller gets no person-scoped parts intelligence', async () => {
  await assert.rejects(() => getMechanicPartsIntelligence(createClient({}), { role: 'mechanic' }), AuthorizationError);
});

// ── RFQ demand ─────────────────────────────────────────────────────────────

test('discarded requests are excluded, and only an advanced status counts as a response', () => {
  const demand = buildRfqDemand([
    rfq({ id: '1', status: 'new' }),
    rfq({ id: '2', status: 'contacted' }),
    rfq({ id: '3', status: 'spam' }),
    rfq({ id: '4', status: 'rejected' }),
  ]);
  assert.equal(demand.requests_received.value, 2);
  assert.equal(demand.responded.value, 1);
  assert.equal(demand.awaiting_response.value, 1);
});

test('only part quote requests are read, never every inquiry', async () => {
  const client = createClient({
    inquiries: [rfq(), rfq({ id: 'v1', inquiry_type: 'vehicle_purchase_interest' })],
  });
  const result = await getPlatformPartsIntelligence(client, ADMIN);
  assert.equal(result.rfq_demand.requests_received.value, 1,
    'a vehicle inquiry counted as parts demand would invent a parts market');
});

// ── Provenance is not a fraud verdict ──────────────────────────────────────

test('a flagged record is reported as awaiting review, not as fraud', () => {
  const provenance = buildProvenance([
    log({ id: '1', part_verification_status: 'verified', suspicion_status: 'flagged', public_card_eligible: true }),
    log({ id: '2' }),
  ]);
  assert.equal(provenance.flagged_for_review.value, 1);
  assert.equal(provenance.parts_verified.value, 1);
  // A flagged record can also be a verified one, so flagging must not subtract
  // from verification.
  const keys = Object.keys(provenance).join(' ');
  assert.ok(!/fraud|fake|counterfeit/i.test(keys));
});

test('public shareability is read from the governed gate, not recomputed', () => {
  const provenance = buildProvenance([
    log({ id: '1', part_verification_status: 'verified', public_card_eligible: false }),
    log({ id: '2', part_verification_status: 'unverified', public_card_eligible: true }),
  ]);
  // Verified does not imply shareable, and shareable does not imply verified.
  assert.equal(provenance.publicly_shareable.value, 1);
  assert.equal(provenance.parts_verified.value, 1);
});

// ── Inventory: a missing number is not zero ────────────────────────────────

test('an unrecorded stock level never lands in an out-of-stock count', () => {
  const inventory = buildInventory([
    part({ id: '1', stock_level: 0 }),
    part({ id: '2', stock_level: null }),
  ]);
  assert.equal(inventory.out_of_stock.value, 1, 'unknown stock is unknown, not zero');
  assert.equal(inventory.stock_recorded.value, 1);
});

test('an unpriced part is excluded from the valuation and the shortfall is stated', () => {
  const inventory = buildInventory([
    part({ id: '1', unit_price: 10, stock_level: 3 }),
    part({ id: '2', unit_price: null, stock_level: 100 }),
  ]);
  assert.equal(inventory.stock_value.value, 30);
  assert.equal(inventory.valuation_coverage.priced_parts, 1);
  assert.equal(inventory.valuation_coverage.total_parts, 2);
  assert.ok(/higher/i.test(inventory.valuation_coverage.note),
    'summing an unpriced part as zero would understate the garage\'s stock');
});

test('no reorder threshold is invented, so no low-stock alert is raised without one', () => {
  const withoutThreshold = buildInventory([part({ id: '1', stock_level: 1, min_stock: null })]);
  assert.equal(withoutThreshold.below_reorder_threshold.availability, AVAILABILITY.INSUFFICIENT_DATA);
  assert.equal(withoutThreshold.below_reorder_threshold.value, null);

  const withThreshold = buildInventory([part({ id: '1', stock_level: 1, min_stock: 5 })]);
  assert.equal(withThreshold.below_reorder_threshold.value, 1);
});

// ── A failed read is never a zero ──────────────────────────────────────────

test('a failed provenance read reports unavailable and publishes no counts', async () => {
  const result = await getMechanicPartsIntelligence(createClient({ failTable: 'partsentry_logs' }), MECHANIC);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.provenance, undefined);
  assert.ok(/NOT zero/i.test(result.message));
});

test('a failed platform read reports unavailable and publishes no counts', async () => {
  const result = await getPlatformPartsIntelligence(createClient({ failTable: 'marketplace_inquiries' }), ADMIN);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.rfq_demand, undefined);
});

// ── The parts surface no longer asserts what nobody recorded ───────────────

test('PartsTracking distinguishes a failed inventory read from an empty shelf', () => {
  assert.ok(TRACKING.includes('parts-load-failed'));
  assert.ok(TRACKING.includes('setLoadFailed(true)'));
  assert.ok(TRACKING.includes('no-parts-state'), 'the genuinely-empty state is still available');
});

test('PartsTracking invents no supplier and no reorder threshold', () => {
  assert.ok(!TRACKING.includes("'Internal'"), 'a missing supplier must not be asserted as internal sourcing');
  assert.ok(!/minStock:\s*5|min_stock\s*\?\?\s*5|minStock\s*\?\?\s*5/.test(TRACKING),
    'a reorder level nobody set must not be invented, because it drives an alert');
});

test('PartsTracking does not coerce an unrecorded number to zero', () => {
  assert.ok(!/stock_level\s*\?\?\s*d\.stock\s*\?\?\s*0/.test(TRACKING));
  assert.ok(!/unit_price\s*\?\?\s*d\.price\s*\?\?\s*0/.test(TRACKING));
  assert.ok(TRACKING.includes('Not recorded'), 'an unknown value must say it is unknown');
});

test('PartsTracking no longer confirms an invoice upload that never happened', () => {
  assert.ok(!/Invoice uploaded/.test(TRACKING),
    'the handler only raised a success toast; no request was made and no file was stored');
  assert.ok(!/invoice-upload-/.test(TRACKING));
});

test('PartsTracking does not mangle the authoritative part id', () => {
  assert.ok(!/substring\(0,\s*8\)/.test(TRACKING));
  assert.ok(!/Math\.random\(\)/.test(TRACKING), 'a random id would make a row untraceable to its record');
});

// ── The routes exist, are gated, and take no caller scope ──────────────────

test('the parts routes are mounted, role-gated and derive their own scope', () => {
  const routes = read('backend/routes/intelligenceProjectionRoutes.js');

  const person = routes.split("'/api/parts/intelligence'")[1].split('router.get')[0];
  assert.match(person, /authorizeRole\(\['mechanic', 'admin'\]\)/);
  assert.ok(person.includes('req.userContext'));

  const platform = routes.split("'/api/admin/parts/intelligence'")[1].split('export default')[0];
  assert.match(platform, /authorizeRole\(\['admin'\]\)/);
  assert.ok(!platform.includes('government'), 'gap G5 must not be repeated on a parts surface');

  assert.ok(!/req\.(query|params|body)\.(supplier|supplier_id|tenant_id|mechanic_id)/.test(routes));
});
