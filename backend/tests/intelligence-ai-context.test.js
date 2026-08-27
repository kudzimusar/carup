/**
 * CarUp Intelligence 1.0 — I18 governed AI context.
 *
 * The plan names four tests for this phase, and they are the four here: the
 * assistant cannot invent, cannot cross tenant or user scope, cannot override
 * Trust, and cannot promote an unknown government state to verified.
 *
 * The surface these replace was not an AI at all. It was a keyword lookup that
 * returned fixed strings asserting facts about the reader's OWN property: a
 * market valuation and a monthly trend for a named vehicle, a service history
 * with dates and mileages, an insurance policy with a number, an expiry and a
 * premium, three garages with ratings and distances, and a fraud-detection rate.
 * A conversational register invites exactly the trust none of that could bear.
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
  buildAuthorizedContext,
  validateAnswer,
  validateTrustStatement,
  validateAuthorityStatement,
  validateAssistantAnswer,
  NON_PUBLISHING_TRUST_STATES,
  AI_CONTEXT_VERSION,
} from '../services/intelligence/aiIntelligenceContextService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DASHBOARD = codeOnly(read('web/src/pages/dashboard/owner/AIDashboard.tsx'));

const OWNER = { id: 'u1', role: 'owner' };
const today = new Date().toISOString();

const veh = (o = {}) => ({
  vin: o.vin || 'VIN1', owner_id: o.owner_id === undefined ? 'u1' : o.owner_id,
  current_seller_id: o.current_seller_id ?? null,
  publication_status: o.publication_status || 'published',
  make: 'Toyota', model: 'Corolla', year: 2019,
});

const inq = (o = {}) => ({
  id: o.id || 'i1', current_seller_id: o.current_seller_id === undefined ? 'u1' : o.current_seller_id,
  status: o.status || 'new', created_at: o.created_at || today,
});

function createClient({ vehicles = [], inquiries = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const eqs = {};
    let orExpr = null;
    const api = {
      select() { return api },
      eq(col, val) { eqs[col] = val; return api },
      or(expr) { orExpr = expr; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        let out = rows.filter((row) => Object.entries(eqs).every(([k, v]) => row[k] === v));
        if (orExpr) {
          const clauses = orExpr.split(',').map((c) => { const [col, , val] = c.split('.'); return [col, val] });
          out = out.filter((row) => clauses.some(([col, val]) => String(row[col]) === val));
        }
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
    };
    return api;
  };
  return { from: (t) => build(t, { vehicles, marketplace_inquiries: inquiries }[t] ?? []) };
}

// ── 1. Cannot invent ───────────────────────────────────────────────────────

test('an unmeasured fact is present in the context AS unmeasured, not absent', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  const byKey = Object.fromEntries(ctx.facts.map((f) => [f.key, f]));
  // Every one of these was answered with an invented figure by the old surface.
  for (const key of ['market_valuation', 'valuation_trend', 'service_due', 'insurance_policy', 'nearby_mechanics', 'fraud_detection_rate']) {
    assert.ok(byKey[key], `${key} must be present so there is no gap to fill`);
    assert.equal(byKey[key].available, false);
    assert.equal(byKey[key].value, null);
    assert.ok(byKey[key].reason, `${key} must say why it is unavailable`);
  }
  assert.equal(ctx.calculation_version, AI_CONTEXT_VERSION);
});

test('an answer asserting a figure the context never held is rejected', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  const invented = 'Your Toyota Corolla is worth about $11,800, down 3.2% from last month.';
  const result = validateAnswer(invented, ctx);
  assert.equal(result.valid, false);
  const kinds = result.problems.map((p) => p.kind);
  assert.ok(kinds.includes('invented_figure'));
});

test('an answer using only figures from the context is accepted', async () => {
  const ctx = await buildAuthorizedContext(createClient({
    vehicles: [veh({ vin: 'V1' }), veh({ vin: 'V2' })],
    inquiries: [inq({ id: 'a' }), inq({ id: 'b' }), inq({ id: 'c' })],
  }), OWNER);
  const grounded = 'You have 2 vehicles on your account and 3 enquiries, all 3 awaiting your reply.';
  assert.equal(validateAnswer(grounded, ctx).valid, true);
});

test('answering an explicitly unavailable fact with a value is rejected', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  const result = validateAnswer('Your insurance policy, premium and expiry: the premium is $680 per year.', ctx);
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((p) => p.kind === 'answered_an_unavailable_fact' || p.kind === 'invented_figure'));
});

test('the context tells the assistant to report an unavailable fact as unavailable', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  assert.ok(ctx.boundaries.some((b) => /never estimated/i.test(b)));
});

// ── 2. Cannot cross tenant or user scope ───────────────────────────────────

test('the context is built from the session, with no subject parameter', async () => {
  const client = createClient({
    vehicles: [veh({ vin: 'mine', owner_id: 'u1' }), veh({ vin: 'theirs', owner_id: 'u2' })],
    inquiries: [inq({ id: 'mine', current_seller_id: 'u1' }), inq({ id: 'theirs', current_seller_id: 'u2' })],
  });
  const ctx = await buildAuthorizedContext(client, OWNER);
  const byKey = Object.fromEntries(ctx.facts.map((f) => [f.key, f]));
  assert.equal(byKey.vehicles_owned.value, 1);
  assert.equal(byKey.enquiries_received.value, 1);
  assert.equal(ctx.scope.actor_id, 'u1');
});

test('an unauthenticated caller gets no context at all', async () => {
  await assert.rejects(() => buildAuthorizedContext(createClient({}), { role: 'owner' }), AuthorizationError);
  await assert.rejects(() => buildAuthorizedContext(createClient({}), null), AuthorizationError);
});

test('the boundaries forbid answering about anybody else', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  assert.ok(ctx.boundaries.some((b) => /never answer about another user, seller or organization/i.test(b)));
});

test('a failed read yields no facts, so nothing can be grounded in them', async () => {
  const ctx = await buildAuthorizedContext(createClient({ failTable: 'vehicles' }), OWNER);
  assert.equal(ctx.availability, AVAILABILITY.UNAVAILABLE);
  assert.deepEqual(ctx.facts, []);
  const result = validateAnswer('You have 4 vehicles.', ctx);
  assert.equal(result.valid, true, 'no figure shape here');
  // But a currency claim is still caught, because no fact backs it.
  assert.equal(validateAnswer('Your vehicle is worth $9,000.', ctx).valid, false);
});

// ── 3. Cannot override Trust ───────────────────────────────────────────────

test('a withheld Trust state may not be published as a score', () => {
  for (const state of NON_PUBLISHING_TRUST_STATES) {
    const result = validateTrustStatement('The Trust Score is 82 for this vehicle.', { evaluation_state: state });
    assert.equal(result.valid, false, `${state} must not publish a score`);
    assert.ok(result.problems.some((p) => p.kind === 'published_a_withheld_trust_score'));
  }
});

test('a withheld Trust state may not be softened into a band or a reassurance', () => {
  for (const phrase of ['This is a high trust vehicle.', 'No issues found on this vehicle.', 'It is fully verified.']) {
    const result = validateTrustStatement(phrase, { evaluation_state: 'not_evaluated' });
    assert.equal(result.valid, false, `"${phrase}" must be rejected for an unevaluated vehicle`);
  }
});

test('an evaluated vehicle may state its score normally', () => {
  const result = validateTrustStatement('The Trust Score is 82 for this vehicle.', { evaluation_state: 'evaluated' });
  assert.equal(result.valid, true);
});

test('not_evaluated is never treated as zero or as failure', () => {
  // The programme's rule: not_evaluated must never become 0, failed or poor.
  const result = validateTrustStatement('Trust score of 0 — this vehicle failed its checks.', { evaluation_state: 'not_evaluated' });
  assert.equal(result.valid, false);
});

// ── 4. Cannot promote unknown government state to verified ─────────────────

test('CarUp\'s own review may not be described as a government or registry verification', () => {
  for (const phrase of [
    'This vehicle is government verified.',
    'The details are registry confirmed.',
    'It has been officially verified.',
    'The record is ZIMRA verified.',
  ]) {
    const result = validateAuthorityStatement(phrase, { registryConfirmed: false });
    assert.equal(result.valid, false, `"${phrase}" must be rejected while no registry has confirmed anything`);
    assert.ok(result.problems.some((p) => p.kind === 'promoted_unconfirmed_state_to_verified'));
  }
});

test('the same phrasing is allowed once a registry genuinely confirms', () => {
  const result = validateAuthorityStatement('This vehicle is registry confirmed.', { registryConfirmed: true });
  assert.equal(result.valid, true);
});

test('describing CarUp\'s own review honestly passes', () => {
  const result = validateAuthorityStatement('CarUp has reviewed the documents supplied for this vehicle.', { registryConfirmed: false });
  assert.equal(result.valid, true);
});

// ── All guards together ────────────────────────────────────────────────────

test('the combined guard catches invention, trust promotion and authority promotion at once', async () => {
  const ctx = await buildAuthorizedContext(createClient({ vehicles: [veh()] }), OWNER);
  const bad = 'Your vehicle is worth $11,800, has a high trust rating, and is government verified.';
  const result = validateAssistantAnswer(bad, ctx, { trust: { evaluation_state: 'not_evaluated' }, registryConfirmed: false });
  assert.equal(result.valid, false);
  const kinds = new Set(result.problems.map((p) => p.kind));
  assert.ok(kinds.has('invented_figure'));
  assert.ok(kinds.has('stated_a_band_for_an_unevaluated_vehicle'));
  assert.ok(kinds.has('promoted_unconfirmed_state_to_verified'));
});

// ── The surface no longer fabricates ───────────────────────────────────────

test('AIDashboard holds no invented valuation, policy, service history or garage list', () => {
  for (const literal of ['11,800', '3.2%', '67,800', '67,000', 'NDI-MOT-2026-45678', '$680', 'AutoTech Pro', 'Elite Auto Care', 'QuickFix Motors', '98.7%', 'NicozDiamond']) {
    assert.ok(!DASHBOARD.includes(literal), `AIDashboard must not contain ${literal}`);
  }
});

test('AIDashboard no longer answers from a keyword lookup table', () => {
  assert.ok(!/aiResponses/.test(DASHBOARD), 'a fixed response table is not an assistant');
  assert.ok(!/getAIResponse/.test(DASHBOARD));
  assert.ok(!/setTimeout\(\s*\(\)\s*=>/.test(DASHBOARD), 'a simulated thinking delay implies a computation that never happened');
});
