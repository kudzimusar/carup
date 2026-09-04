/**
 * CarUp Intelligence 1.0 — I10 insurance intelligence.
 *
 * Two things must hold, and both are things a reader could be badly misled by:
 *
 *  1. The COMMERCIAL domain and the RISK domain stay separate. A demand figure
 *     must never be reusable as an underwriting signal.
 *  2. Sandbox activity is never presented as market demand. Every insurance
 *     eligibility request CarUp has ever recorded is simulated, so summing it into
 *     a "demand" number would describe an empty market as an active one.
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
  getInsuranceDemandIntelligence,
  requireInsurerScope,
  splitByMode,
  NOT_MEASURABLE,
  INSURANCE_INTELLIGENCE_VERSION,
} from '../services/intelligence/insuranceIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const RISK_PAGE = fs.readFileSync(path.join(REPO, 'web/src/pages/dashboard/insurance/RiskAnalysis.tsx'), 'utf8');

const INSURER = { id: 'ins-1', role: 'insurance', tenantId: 'insurer-tenant-a' };
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const req = (o = {}) => ({
  id: o.id || 'r1', capability: 'insurance', mode: o.mode || 'sandbox',
  status: o.status || 'not_eligible', provider_id: o.provider_id || 'insurance_sandbox',
  tenant_id: o.tenant_id || 'insurer-tenant-a', created_at: o.created_at || today,
});

function createClient({ requests = [], insurers = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const filters = {};
    const api = {
      select() { return api },
      eq(col, val) { filters[col] = val; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        const out = rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
    };
    return api;
  };
  return { from: (t) => build(t, { eligibility_requests: requests, insurer_profiles: insurers }[t] ?? []) };
}

// ── Domain boundary ────────────────────────────────────────────────────────

test('the commercial projection carries NO risk, underwriting, claims or fraud FIELDS', async () => {
  const client = createClient({ requests: [req({ mode: 'live', status: 'eligible' })] });
  const result = await getInsuranceDemandIntelligence(client, INSURER);

  // Assert on the DATA, not on prose: the boundary note legitimately names the
  // domains it excludes, so a word-search would flag the very sentence that keeps
  // the two apart.
  const dataKeys = [
    ...Object.keys(result.live_demand),
    ...Object.keys(result.sandbox_activity),
    ...Object.keys(result.provider_state),
  ].join(' ').toLowerCase();
  for (const forbidden of ['risk', 'premium', 'underwrit', 'claim', 'fraud', 'score']) {
    assert.ok(!dataKeys.includes(forbidden), `no commercial field may be named "${forbidden}"`);
  }
  // And no risk-domain block exists at all.
  assert.equal(result.risk, undefined);
  assert.equal(result.claims, undefined);
  assert.equal(result.fraud, undefined);
});

test('the projection states its own boundary, so a demand figure cannot be reused as risk', async () => {
  const client = createClient({ requests: [] });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.match(result.domain_boundary, /separate governed domain/i);
  assert.equal(result.scope, 'insurance_commercial');
});

// ── Sandbox is never demand ────────────────────────────────────────────────

test('sandbox and live activity are split, never summed', () => {
  const { live, sandbox } = splitByMode([
    req({ mode: 'live' }), req({ mode: 'sandbox' }), req({ mode: 'sandbox' }), req({ mode: 'fake' }),
  ]);
  assert.equal(live.length, 1);
  assert.equal(sandbox.length, 3, 'anything not explicitly live is not live');
});

test('simulated requests do not appear as market demand', async () => {
  // This is staging's actual shape: insurance eligibility requests exist, and
  // every one of them is a sandbox simulation.
  const client = createClient({
    requests: [req({ id: '1' }), req({ id: '2' }), req({ id: '3' })],
  });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.live_demand.eligibility_requests.value, 0,
    'an empty live market must read as empty');
  assert.equal(result.sandbox_activity.eligibility_requests.value, 3);
  assert.match(result.sandbox_activity.note, /not market demand/i);
});

test('an empty live market is described, not rendered as poor performance', async () => {
  const client = createClient({ requests: [req()], insurers: [] });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.provider_state.live_market, false);
  assert.equal(result.provider_state.active_insurers.value, 0);
  assert.match(result.provider_state.note, /No insurer is onboarded/i);
});

test('a live market reports live figures', async () => {
  const client = createClient({
    requests: [
      req({ id: '1', mode: 'live', status: 'eligible' }),
      req({ id: '2', mode: 'live', status: 'not_eligible' }),
    ],
    insurers: [{ id: 'i1', active: true, contract_status: 'active' }],
  });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.provider_state.live_market, true);
  assert.equal(result.live_demand.eligibility_requests.value, 2);
  assert.equal(result.live_demand.eligible.value, 1);
});

test('an eligibility rate is withheld on a handful of requests', async () => {
  const client = createClient({
    requests: [req({ id: '1', mode: 'live', status: 'eligible' })],
    insurers: [{ id: 'i1', active: true }],
  });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.live_demand.eligibility_rate.availability, AVAILABILITY.INSUFFICIENT_DATA);
});

// ── Scope ──────────────────────────────────────────────────────────────────

test('an insurer sees only their own tenant\'s requests', async () => {
  const client = createClient({
    requests: [
      req({ id: 'ours', mode: 'live', tenant_id: 'insurer-tenant-a' }),
      req({ id: 'theirs', mode: 'live', tenant_id: 'insurer-tenant-b' }),
    ],
    insurers: [{ id: 'i1', active: true }],
  });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.live_demand.eligibility_requests.value, 1);
});

test('an insurer with no verified tenant is refused, not shown everyone\'s demand', async () => {
  const client = createClient({ requests: [req({ mode: 'live' })] });
  await assert.rejects(
    () => getInsuranceDemandIntelligence(client, { id: 'x', role: 'insurance', tenantId: null }),
    (e) => e instanceof AuthorizationError,
  );
});

test('a platform admin gets the platform view', async () => {
  const client = createClient({
    requests: [req({ id: 'a', mode: 'live', tenant_id: 't1' }), req({ id: 'b', mode: 'live', tenant_id: 't2' })],
    insurers: [{ id: 'i1', active: true }],
  });
  const result = await getInsuranceDemandIntelligence(client, ADMIN);
  assert.equal(result.live_demand.eligibility_requests.value, 2);
});

test('a non-insurer role is refused', () => {
  assert.throws(() => requireInsurerScope({ role: 'owner' }), (e) => e instanceof AuthorizationError);
  assert.throws(() => requireInsurerScope({ role: 'dealer' }), (e) => e instanceof AuthorizationError);
  assert.equal(requireInsurerScope(INSURER), 'insurance');
});

// ── Unmeasurable, declared ─────────────────────────────────────────────────

test('quote submissions, offers, policies and renewals are declared unmeasurable with reasons', async () => {
  const client = createClient({ requests: [] });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  const keys = result.not_measurable.map((n) => n.key).sort();
  assert.deepEqual(keys, [
    'offers', 'policies_bound', 'product_views', 'quote_submissions', 'renewals', 'source_attribution',
  ]);
  for (const entry of NOT_MEASURABLE) {
    assert.ok(entry.reason && entry.detail.length > 20, `${entry.key} must explain itself`);
  }
});

test('a policy bound through CarUp is not inferred from an existing policy record', () => {
  const policies = NOT_MEASURABLE.find((n) => n.key === 'policies_bound');
  assert.match(policies.detail, /inferred rather than observed/i);
});

// ── Failure posture ────────────────────────────────────────────────────────

test('an unreadable read reports unavailable, never zero demand', async () => {
  const client = createClient({ failTable: 'eligibility_requests' });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.match(result.message, /NOT zero/);
  assert.ok(!result.live_demand);
});

test('the calculation version travels with the projection', async () => {
  const client = createClient({ requests: [] });
  const result = await getInsuranceDemandIntelligence(client, INSURER);
  assert.equal(result.calculation_version, INSURANCE_INTELLIGENCE_VERSION);
});

// ── The risk surface's fabrications must not return ────────────────────────

test('the risk page no longer draws a static category-risk chart', () => {
  assert.ok(!RISK_PAGE.includes('riskByCategory'));
  assert.ok(!RISK_PAGE.includes('recharts'), 'no chart is drawn from data that does not exist');
});

test('the risk page has no hardcoded score, premium or mitigating factors', () => {
  assert.ok(!RISK_PAGE.includes('riskScore: 24.5'));
  assert.ok(!RISK_PAGE.includes('recommendedPremium: 145'));
  assert.ok(!RISK_PAGE.includes('Odometer progressive validation passed'));
  assert.ok(!RISK_PAGE.includes('ZIMRA duty cleared'));
});

test('the risk page no longer claims a live-ledger or Trust basis it never had', () => {
  assert.ok(!RISK_PAGE.includes('based on live ledger Trust Scores'));
  assert.ok(!RISK_PAGE.includes('Live Risk Assessment'));
  assert.ok(!RISK_PAGE.includes('Monthly Underwritten Premium'));
  assert.ok(!RISK_PAGE.includes('CarUp Trust Risk Score'));
});

test('Trust is not offered as an underwriting discount', () => {
  assert.ok(!RISK_PAGE.includes('25% Trust Score discount'));
  assert.ok(!RISK_PAGE.includes('Insurance Trust Engine Parameters'));
  assert.ok(!RISK_PAGE.includes('premium reduction'));
  // And the page says why, rather than silently dropping it.
  assert.match(RISK_PAGE, /pricing decision CarUp does not make/i);
});

test('the ungrounded LLM premium calculator is gone', () => {
  assert.ok(!RISK_PAGE.includes('runRiskAssessment'));
  assert.ok(!RISK_PAGE.includes('Recalculate Premium'));
  // The page explains what the calculator actually did.
  assert.match(RISK_PAGE, /language model/i);
  assert.match(RISK_PAGE, /consulted no ledger/i);
});

test('the risk page states the domain boundary it belongs to', () => {
  assert.match(RISK_PAGE, /separate governed domain/i);
});
