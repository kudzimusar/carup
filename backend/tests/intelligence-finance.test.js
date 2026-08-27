/**
 * CarUp Intelligence 1.0 — I11 finance intelligence.
 *
 * Finance is the domain where a fabricated number does the most damage, because
 * every figure here reads as money. Four things must hold:
 *
 *  1. Commercial demand and the credit/underwriting domain stay separate, exactly
 *     as I10 separated insurance demand from risk.
 *  2. A requested amount is never treated as money lent. This is the single
 *     easiest way to manufacture a loan book and it is the one the previous
 *     surfaces actually did.
 *  3. An application counts as decided only where a lender decision was recorded.
 *     A bare status string is not a lender outcome.
 *  4. Sandbox prequalification is never summed into live demand.
 *
 * And the CarUp Trust score is never rendered as a borrower credit verdict: Trust
 * states confidence in evidence about a VEHICLE, not a person's ability to repay.
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
  getFinanceDemandIntelligence,
  requireLenderScope,
  splitByMode,
  isAuthoritativelyDecided,
  NOT_MEASURABLE,
  FINANCE_INTELLIGENCE_VERSION,
} from '../services/intelligence/financeIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/**
 * Strip comments before asserting a literal is gone. Each rewritten page
 * documents what it removed and why, so a whole-file search would flag the
 * explanation as if it were the fabrication.
 */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BANK = codeOnly(read('web/src/pages/dashboard/bank/BankDashboard.tsx'));
const CREDIT = codeOnly(read('web/src/pages/dashboard/bank/CreditRiskAnalysis.tsx'));
const COLLATERAL = codeOnly(read('web/src/pages/dashboard/bank/CollateralMap.tsx'));

const LENDER = { id: 'b1', role: 'bank', tenantId: 'lender-tenant-a' };
const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const req = (o = {}) => ({
  id: o.id || 'e1', capability: 'finance', mode: o.mode || 'sandbox',
  status: o.status || 'eligible', provider_id: o.provider_id || 'finance_sandbox',
  tenant_id: o.tenant_id || 'lender-tenant-a', created_at: o.created_at || today,
});

const app = (o = {}) => ({
  id: o.id || 'app-1', vin: o.vin || 'VIN1', status: o.status || 'Pending',
  bank_id: o.bank_id === undefined ? 'b1' : o.bank_id,
  requested_amount: o.requested_amount ?? 25000, apr: o.apr ?? null,
  tenant_id: o.tenant_id || 'lender-tenant-a', created_at: o.created_at || today,
  decision_source: o.decision_source ?? null,
  decision_recorded_at: o.decision_recorded_at ?? null,
});

const lender = (o = {}) => ({
  id: o.id || 'lp1', provider_id: o.provider_id || 'finance_sandbox',
  active: o.active ?? true, contract_status: o.contract_status || 'signed',
  tenant_id: o.tenant_id || 'lender-tenant-a',
});

function createClient({ requests = [], applications = [], lenders = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const filters = {};
    const inFilters = {};
    const api = {
      select() { return api },
      eq(col, val) { filters[col] = val; return api },
      in(col, vals) { inFilters[col] = vals; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        const out = rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v)
          && Object.entries(inFilters).every(([k, v]) => v.includes(row[k])));
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
    };
    return api;
  };
  return {
    from: (t) => build(t, {
      eligibility_requests: requests,
      finance_applications: applications,
      lender_profiles: lenders,
    }[t] ?? []),
  };
}

// ── Domain boundary: commercial demand is not credit risk ──────────────────

test('the commercial projection carries NO credit, risk, collateral or underwriting FIELDS', async () => {
  const client = createClient({ applications: [app()], requests: [req({ mode: 'live' })], lenders: [lender()] });
  const result = await getFinanceDemandIntelligence(client, LENDER);

  // Assert on DATA KEYS, not prose: the boundary note names the domains it
  // excludes, so a word-search over the payload would flag the very sentence
  // that keeps the two apart.
  const dataKeys = [
    ...Object.keys(result.application_demand),
    ...Object.keys(result.live_eligibility),
    ...Object.keys(result.sandbox_activity),
    ...Object.keys(result.provider_state),
    ...Object.keys(result.attribution),
  ].join(' ').toLowerCase();
  for (const forbidden of ['risk', 'credit', 'grade', 'collateral', 'underwrit', 'default', 'delinquen', 'trust', 'score']) {
    assert.ok(!dataKeys.includes(forbidden), `no commercial field may be named "${forbidden}"`);
  }
  assert.equal(result.credit_risk, undefined);
  assert.equal(result.portfolio, undefined);
  assert.ok(result.domain_boundary.length > 0);
  assert.equal(result.calculation_version, FINANCE_INTELLIGENCE_VERSION);
});

// ── A requested amount is not money lent ───────────────────────────────────

test('no field anywhere in the payload equals the sum of requested amounts', async () => {
  const applications = [app({ id: 'a', requested_amount: 25000 }), app({ id: 'b', requested_amount: 17500 })];
  const client = createClient({ applications });
  const result = await getFinanceDemandIntelligence(client, LENDER);

  const total = 42500;
  const seen = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') { seen.push(node); return }
    Object.values(node).forEach(walk);
  };
  walk(result);
  assert.ok(!seen.includes(total), 'summing requested amounts would report applications as a loan book');
  assert.ok(!seen.includes(25000) && !seen.includes(17500), 'no individual requested amount is surfaced as a value');
});

test('disbursements, portfolio value and APR are declared not measurable, with reasons', () => {
  const keys = NOT_MEASURABLE.map((entry) => entry.key);
  for (const key of ['approvals', 'offers', 'disbursements', 'portfolio_value', 'portfolio_apr', 'default_risk', 'collateral_binding']) {
    assert.ok(keys.includes(key), `${key} must be declared unmeasurable rather than estimated`);
  }
  for (const entry of NOT_MEASURABLE) {
    assert.ok(entry.reason && entry.detail, `${entry.key} must carry a reason and a detail`);
  }
});

// ── Only a recorded lender decision counts as a decision ───────────────────

test('a bare status string is not a lender decision', () => {
  assert.equal(isAuthoritativelyDecided(app({ status: 'approved' })), false);
  assert.equal(isAuthoritativelyDecided(app({ status: 'disbursed' })), false);
  assert.equal(isAuthoritativelyDecided(app({ decision_recorded_at: today })), true);
  assert.equal(isAuthoritativelyDecided(app({ decision_source: 'provider' })), true);
});

test('applications without a recorded decision count as awaiting, never as decided', async () => {
  const client = createClient({
    applications: [
      app({ id: 'a', status: 'approved' }),
      app({ id: 'b', status: 'Pending' }),
      app({ id: 'c', decision_recorded_at: today, decision_source: 'provider' }),
    ],
  });
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.application_demand.applications_received.value, 3);
  assert.equal(result.application_demand.decisions_recorded.value, 1);
  assert.equal(result.application_demand.awaiting_decision.value, 2);
});

// ── Sandbox is never live demand ───────────────────────────────────────────

test('sandbox prequalification is reported separately and never summed into live demand', async () => {
  const client = createClient({
    requests: [
      req({ id: '1', mode: 'sandbox' }),
      req({ id: '2', mode: 'sandbox' }),
      req({ id: '3', mode: 'sandbox' }),
      req({ id: '4', mode: 'live', status: 'eligible' }),
    ],
  });
  const result = await getFinanceDemandIntelligence(client, ADMIN);
  assert.equal(result.live_eligibility.requests.value, 1);
  assert.equal(result.sandbox_activity.requests.value, 3);
  assert.ok(result.sandbox_activity.note.length > 0);
});

test('splitByMode treats anything that is not explicitly live as sandbox', () => {
  const { live, sandbox } = splitByMode([req({ mode: 'live' }), req({ mode: 'sandbox' }), req({ mode: null })]);
  assert.equal(live.length, 1);
  assert.equal(sandbox.length, 2, 'an unknown mode must never be counted as live demand');
});

test('an empty lender roster is described, not rendered as poor performance', async () => {
  const result = await getFinanceDemandIntelligence(createClient({ lenders: [] }), LENDER);
  assert.equal(result.provider_state.live_market, false);
  assert.ok(/no active lender registration is on file/i.test(result.provider_state.note));
});

// ── Scope is derived server-side ───────────────────────────────────────────

test('a non-lender role is refused', () => {
  assert.throws(() => requireLenderScope({ role: 'owner' }), AuthorizationError);
  assert.throws(() => requireLenderScope({ role: 'dealer' }), AuthorizationError);
  assert.throws(() => requireLenderScope({}), AuthorizationError);
});

test('a lender with no verified identity is refused rather than shown the platform', async () => {
  const client = createClient({ applications: [app({ bank_id: 'someone-else' })] });
  await assert.rejects(
    () => getFinanceDemandIntelligence(client, { id: null, role: 'bank', tenantId: 'lender-tenant-a' }),
    AuthorizationError,
  );
});

test('a lender never sees another lender applications, and cannot widen scope', async () => {
  const client = createClient({
    applications: [app({ id: 'mine', bank_id: 'b1' }), app({ id: 'theirs', bank_id: 'b2' })],
    lenders: [lender({ id: 'lp1', tenant_id: 'lender-tenant-a' }), lender({ id: 'lp2', provider_id: 'other', tenant_id: 'lender-tenant-b' })],
  });
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.application_demand.applications_received.value, 1);

  // Scope comes from the actor only; there is no caller-supplied scope input, so
  // a forged one cannot reach the query.
  const admin = await getFinanceDemandIntelligence(client, ADMIN);
  assert.equal(admin.application_demand.applications_received.value, 2);
});

test('a lender is not told how many lenders the platform has', async () => {
  const client = createClient({
    lenders: [lender({ id: 'lp1', tenant_id: 'lender-tenant-a' }), lender({ id: 'lp2', tenant_id: 'lender-tenant-b' }), lender({ id: 'lp3', tenant_id: 'lender-tenant-c' })],
  });
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.provider_state.active_lenders.value, 1, 'a lender counts only its own registrations');
  const admin = await getFinanceDemandIntelligence(client, ADMIN);
  assert.equal(admin.provider_state.active_lenders.value, 3);
});

test('a lender with no registered provider sees no eligibility traffic, and is told why', async () => {
  const client = createClient({
    requests: [req({ id: 'r1', mode: 'live', status: 'eligible', provider_id: 'someone-elses-provider' })],
    lenders: [],
  });
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.live_eligibility.requests.value, 0);
  assert.equal(result.provider_state.live_market, false);
  assert.ok(result.provider_state.note.length > 0, 'a zero must never stand without its reason');
});

test('an application attached to no lender is disclosed, never silently dropped', async () => {
  const client = createClient({
    applications: [app({ id: 'orphan', bank_id: null }), app({ id: 'mine', bank_id: 'b1' })],
    lenders: [lender()],
  });
  const admin = await getFinanceDemandIntelligence(client, ADMIN);
  assert.equal(admin.attribution.unattributed_applications.value, 1);

  // The lender does not get the platform figure, but is told the gap exists so a
  // count of 1 cannot be read as total market demand.
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.application_demand.applications_received.value, 1);
  assert.equal(result.attribution.unattributed_applications, null);
  assert.ok(/not a measure of total market demand/i.test(result.attribution.note));
});

// ── A failed read is never a zero ──────────────────────────────────────────

test('a failed read reports unavailable and publishes no zeros', async () => {
  const client = createClient({ failTable: 'finance_applications' });
  const result = await getFinanceDemandIntelligence(client, LENDER);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.application_demand, undefined);
  assert.equal(result.live_eligibility, undefined);
  assert.ok(/NOT zero/i.test(result.message));
});

// ── The bank surfaces no longer assert what CarUp cannot know ──────────────

test('BankDashboard publishes no fabricated portfolio, APR, application count or default risk', () => {
  for (const literal of ['$1,245,000', "'4'", '7.5%', '1.2%', 'loanTrend', 'AreaChart', '98.4%']) {
    assert.ok(!BANK.includes(literal), `BankDashboard must not contain ${literal}`);
  }
});

test('BankDashboard claims no institutional partnership', () => {
  assert.ok(!/CBZ/i.test(BANK), 'a named bank must not be presented as a live partner without provider evidence');
});

test('BankDashboard distinguishes a failed application read from an empty queue', () => {
  assert.ok(BANK.includes('bank-applications-failed'));
  assert.ok(BANK.includes('bank-applications-empty'));
  assert.ok(BANK.includes('setLoadFailed(true)'), 'a rejected fetch must set the failed state');
});

test('BankDashboard never renders a Trust score as a borrower credit verdict', () => {
  for (const literal of ['Low Risk', 'Medium Risk', 'trust_score', 'Trust Index']) {
    assert.ok(!BANK.includes(literal), `BankDashboard must not contain ${literal}`);
  }
});

test('CreditRiskAnalysis converts no Trust score into a credit grade and publishes no model weights', () => {
  for (const literal of ['Super Trust', 'High Trust', 'Medium Trust', 'Low Trust', '35% weight', '25% weight', '20% weight', '0.00%', 'recharts']) {
    assert.ok(!CREDIT.includes(literal), `CreditRiskAnalysis must not contain ${literal}`);
  }
  assert.ok(CREDIT.includes('credit-risk-unavailable'));
});

test('CollateralMap invents no vehicles on either an empty or a failed read', () => {
  // A VIN-shaped literal, not the word "VIN" — the page legitimately explains
  // that telemetry carries a VIN and nothing that ties it to a loan.
  assert.ok(!/\b[A-HJ-NPR-Z0-9]{11,17}\b/.test(COLLATERAL), 'no VIN-shaped literal may remain');
  assert.ok(!/1HGCM82633A|JTDKB20U43/i.test(COLLATERAL), 'no seeded demo VIN may remain');
  // No coordinate pair either: a fabricated position is a fabricated asset.
  assert.ok(!/lat:|lng:|-17\.8|31\.0/.test(COLLATERAL), 'no invented position may remain');
  for (const literal of ['fallback', 'demo', 'Geofence Breach', 'Telemetry Core Active']) {
    assert.ok(!COLLATERAL.includes(literal), `CollateralMap must not contain ${literal}`);
  }
  assert.ok(COLLATERAL.includes('collateral-not-configured'));
  // And it does not fetch telemetry at all, so there is nothing to fall back from.
  assert.ok(!COLLATERAL.includes('vehicle_telemetry') && !COLLATERAL.includes('fetchTelemetry'));
});

// ── The route exists, is protected, and derives its own scope ───────────────

test('the finance demand route is mounted, role-gated and takes no caller scope', () => {
  const routes = read('backend/routes/intelligenceProjectionRoutes.js');
  const server = read('backend/server.js');
  assert.ok(server.includes('app.use(intelligenceProjectionRouter)'));

  const block = routes.split("'/api/finance/demand-intelligence'")[1].split('export default')[0];
  assert.match(block, /authorizeRole\(\['admin', 'finance', 'bank'\]\)/);
  // Scope is read from the verified session, never from the request.
  assert.ok(block.includes('req.userContext'));
  assert.ok(!/req\.(query|params|body)\.(bank_id|bankId|tenant_id|tenantId|lender)/.test(block));
  // Only the window is caller-supplied, and it goes through the shared resolver.
  assert.ok(block.includes('resolveWindowDays(req.query.window)'));
});

test('the finance route serves the commercial service, and no credit-domain service exists to serve', () => {
  const routes = read('backend/routes/intelligenceProjectionRoutes.js');
  const handler = routes.split("'/api/finance/demand-intelligence'")[1].split('export default')[0];
  assert.ok(handler.includes('getFinanceDemandIntelligence'));

  // The commercial service is the only finance projection there is: nothing in
  // the intelligence layer computes a credit, underwriting or collateral figure
  // that a route could accidentally reach for.
  const services = fs.readdirSync(path.join(REPO, 'backend/services/intelligence'));
  assert.ok(!services.some((file) => /credit|underwrit|collateral|portfolio/i.test(file)),
    'a credit-domain projection would have to be governed separately, not added here');
});
