/**
 * CarUp Intelligence 1.0 — I16 command centre.
 *
 * A single admin surface is where fabrications do the most damage, because it is
 * the one page read as "the state of the platform". Three properties matter:
 *
 *  1. It COMPOSES rather than recomputes. Each vertical is linked to its own
 *     governed projection, never restated — two surfaces quoting the same domain
 *     from different code eventually disagree.
 *  2. Every section declares its source, or declares that it has none. Revenue,
 *     customer health and platform health have no source and say so.
 *  3. A section that could not be READ is distinct from a section with no SOURCE,
 *     and both are distinct from a genuine zero.
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
  getCommandCentre,
  requirePlatformScope,
  demandSection,
  SECTIONS_WITHOUT_A_SOURCE,
  VERTICAL_SOURCES,
  COMMAND_CENTRE_VERSION,
} from '../services/intelligence/commandCentreService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ADMIN_PAGE = codeOnly(read('web/src/pages/dashboard/admin/AdminDashboard.tsx'));
const ADMIN_ROUTES = codeOnly(read('backend/routes/adminRoutes.js'));

const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();
const row = (o = {}) => ({ id: o.id || 'r1', created_at: o.created_at || today, ...o });

function createClient(tables = {}, failTable = null) {
  const build = (table, rows) => {
    const api = {
      select() { return api },
      eq() { return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        return Promise.resolve({ data: from === 0 ? rows : [], error: null });
      },
    };
    return api;
  };
  return { from: (t) => build(t, tables[t] ?? []) };
}

const fullTables = {
  users: [row({ id: 'u1' }), row({ id: 'u2' })],
  organizations: [row({ id: 'o1' })],
  vehicles: [row({ id: 'v1', publication_status: 'published' }), row({ id: 'v2', publication_status: 'draft' })],
  marketplace_inquiries: [row({ id: 'i1' })],
  marketplace_activity_events: [],
  saved_vehicles: [row({ id: 's1' })],
  vehicle_evidence: [row({ id: 'e1', verification_status: 'verified' })],
  message_threads: [row({ id: 't1' })],
  messages: [row({ id: 'm1' })],
  escrow_trust_sessions: [row({ id: 'x1', status: 'settled', payment_provider_mode: 'sandbox' })],
  insurance_claims: [row({ id: 'c1' })],
};

// ── It composes; it does not restate ───────────────────────────────────────

test('each vertical is linked to its own projection, not recomputed here', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  const keys = VERTICAL_SOURCES.map((v) => v.key);
  for (const key of ['dealer', 'service', 'insurance', 'finance', 'parts', 'trade', 'marketing', 'institutional']) {
    assert.ok(keys.includes(key), `${key} must be linked`);
  }
  for (const vertical of result.verticals) {
    assert.ok(vertical.endpoint.startsWith('/api/'), 'a vertical must name the endpoint that answers it');
    assert.ok(vertical.phase, 'a vertical must name the phase that owns it');
  }
  // No vertical's own figures are copied into the centre.
  assert.equal(result.sections.insurance, undefined);
  assert.equal(result.sections.finance, undefined);
  assert.equal(result.sections.marketing, undefined);
});

test('no Trust distribution is aggregated on this surface', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  const keys = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['trust_distribution', 'trust_score', 'average_trust', 'trust_band']) {
    assert.ok(!keys.includes(forbidden), `Issue #164: no second trust source may appear (${forbidden})`);
  }
  assert.ok(/canonical trust service/i.test(result.sections.trust_evidence.trust_authority));
});

test('communications remains the conversation authority', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  assert.ok(/authority on conversation state/i.test(result.sections.communications.authority));
  assert.ok(/volume counts only/i.test(result.sections.communications.authority));
});

// ── No source, unreadable, and zero are three different things ─────────────

test('revenue, customer health and platform health are declared sourceless', () => {
  const byKey = Object.fromEntries(SECTIONS_WITHOUT_A_SOURCE.map((e) => [e.key, e]));
  for (const key of ['revenue', 'customer_health', 'platform_health', 'fraud_interception_rate']) {
    assert.ok(byKey[key], `${key} must be declared rather than omitted`);
    assert.ok(byKey[key].reason && byKey[key].detail);
  }
  assert.equal(byKey.revenue.reason, 'no_revenue_record');
  assert.equal(byKey.customer_health.reason, 'no_retention_model');
  assert.ok(/literal string "Optimal"/i.test(byKey.platform_health.detail));
  assert.ok(/98\.5%/.test(byKey.fraud_interception_rate.detail));
});

test('an unreadable section is marked unreadable, not zero, and does not sink the page', async () => {
  const result = await getCommandCentre(createClient(fullTables, 'vehicles'), ADMIN);
  assert.equal(result.sections.supply.unreadable, true);
  assert.equal(result.sections.supply.metrics, undefined);
  assert.ok(/NOT zero/i.test(result.sections.supply.note));
  // Every other section still answered.
  assert.equal(result.sections.overview.available, true);
  assert.equal(result.sections.overview.metrics.users_total.value, 2);
});

test('an instrumented but empty ledger is not reported as no interest', () => {
  const section = demandSection([{ id: 'i1' }], [], [{ id: 's1' }]);
  assert.equal(section.metrics.behavioural_events.availability, AVAILABILITY.INSUFFICIENT_DATA);
  assert.equal(section.metrics.behavioural_events.value, null);
  assert.ok(/absence of recorded events/i.test(section.note));
  // The inquiry count is real and is still reported.
  assert.equal(section.metrics.inquiries.value, 1);
});

test('a populated ledger reports a real count and drops the note', () => {
  const section = demandSection([], [{ id: 'e1' }, { id: 'e2' }], []);
  assert.equal(section.metrics.behavioural_events.value, 2);
  assert.equal(section.note, null);
});

// ── Boundaries ─────────────────────────────────────────────────────────────

test('a sandbox settlement is never counted as a live one', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  assert.equal(result.sections.transactions.metrics.sandbox_settlements.value, 1);
  assert.equal(result.sections.transactions.metrics.live_settlements.value, 0);
  assert.ok(/no settlement here represents money that moved/i.test(result.sections.transactions.note));
});

test('the risk section issues no verdict', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  assert.ok(/no risk verdict is issued here/i.test(result.sections.risk.boundary));
  const keys = Object.keys(result.sections.risk.metrics).join(' ');
  for (const forbidden of ['fraud_rate', 'risk_score', 'intercepted']) {
    assert.ok(!keys.includes(forbidden));
  }
});

test('the command centre requires a platform administrator, not an institutional role', () => {
  assert.throws(() => requirePlatformScope({ role: 'government' }), AuthorizationError);
  assert.throws(() => requirePlatformScope({ role: 'dealer' }), AuthorizationError);
  assert.equal(requirePlatformScope(ADMIN), 'admin');
});

test('every available section names the table it was read from', async () => {
  const result = await getCommandCentre(createClient(fullTables), ADMIN);
  for (const [key, section] of Object.entries(result.sections)) {
    assert.ok(section.source, `section ${key} must name its source`);
  }
  assert.equal(result.calculation_version, COMMAND_CENTRE_VERSION);
});

// ── The admin surfaces no longer assert what CarUp cannot measure ──────────

test('the admin API returns no fabricated health or confidence literal', () => {
  assert.ok(!/systemHealth:\s*'Optimal'/.test(ADMIN_ROUTES),
    'a health status with no check behind it must not be returned');
  assert.ok(!/aiConfidence:\s*'98\.5%'/.test(ADMIN_ROUTES),
    'a fraud-interception rate CarUp does not compute must not be returned');
});

test('AdminDashboard publishes no seeded stats, literal deltas or invented escrow volume', () => {
  for (const literal of ['9200', "'$145,000'", "'+18%'", "'+20%'", "'+32%'", "'+0.4%'", 'userGrowth', 'LineChart', 'recharts']) {
    assert.ok(!ADMIN_PAGE.includes(literal), `AdminDashboard must not contain ${literal}`);
  }
  // The `|| prev` fallback replaced a genuine server zero with the invented seed.
  assert.ok(!/\|\|\s*prev\./.test(ADMIN_PAGE));
});

test('AdminDashboard claims no running integration with a named company', () => {
  for (const name of ['Simbisa', 'Old Mutual', 'CBZ', 'Croco']) {
    assert.ok(!ADMIN_PAGE.includes(name), `AdminDashboard must not present ${name} as a live integration`);
  }
  assert.ok(!/Active AI Copilots/.test(ADMIN_PAGE));
});

test('the command centre route is admin-only', () => {
  const routes = codeOnly(read('backend/routes/intelligenceProjectionRoutes.js'));
  const block = routes.split("'/api/admin/intelligence/command-centre'")[1].split('router.get')[0];
  assert.match(block, /authorizeRole\(\['admin'\]\)/);
  assert.ok(!block.includes('government'), 'gap G5 must not be repeated on the command centre');
});
