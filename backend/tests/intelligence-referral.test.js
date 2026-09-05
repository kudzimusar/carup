/**
 * CarUp Intelligence 1.0 — I14 referral and marketing intelligence.
 *
 * Three things must hold, and each guards against a different way of overstating
 * a referral programme:
 *
 *  1. The referral event table is SHARED with the trust, agent, AI-marketing and
 *     marketplace domains. Counting it whole would inflate referral activity
 *     roughly fivefold.
 *  2. ROI is refused, not deferred. No campaign, code or promotion table records a
 *     cost, so there is no investment to divide a return by.
 *  3. Accrued reward value is never presented as reward paid. Every wallet
 *     transaction is pending or held; nothing has been paid out.
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
  getReferralIntelligence,
  resolveReferralScope,
  referralActivity,
  channelDistribution,
  rewardLedger,
  attributedOutcomes,
  amountsByCurrency,
  REFERRAL_DOMAIN_EVENTS,
  NOT_MEASURABLE,
  REFERRAL_INTELLIGENCE_VERSION,
} from '../services/intelligence/referralIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ADMIN = { id: 'a1', role: 'admin', platformRole: 'admin' };
const today = new Date().toISOString();

const ev = (o = {}) => ({
  id: o.id || 'e1', tenant_id: o.tenant_id || 't1',
  event_type: o.event_type || REFERRAL_DOMAIN_EVENTS.code_validated,
  channel: o.channel === undefined ? 'web' : o.channel,
  source: o.source ?? null,
  actor_type: o.actor_type || 'user',
  session_id: o.session_id ?? null,
  occurred_at: o.occurred_at || today, created_at: o.created_at || today,
});

const wtx = (o = {}) => ({
  id: o.id || 'w1', status: o.status || 'pending',
  transaction_type: o.transaction_type || 'local_marketplace_referral_credit',
  amount: o.amount === undefined ? 10 : o.amount,
  currency: o.currency === undefined ? 'USD' : o.currency,
  created_at: o.created_at || today,
});

const inq = (o = {}) => ({
  id: o.id || 'i1', referral_code: o.referral_code ?? null, campaign_code: o.campaign_code ?? null,
  status: o.status || 'new', created_at: o.created_at || today,
});

function createClient({ events = [], transactions = [], inquiries = [], codes = [], campaigns = [], failTable = null } = {}) {
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
  return {
    from: (t) => build(t, {
      referral_events: events,
      referral_wallet_transactions: transactions,
      marketplace_inquiries: inquiries,
      referral_codes: codes,
      referral_campaigns: campaigns,
    }[t] ?? []),
  };
}

// ── The shared event log is not a referral log ─────────────────────────────

test('only referral-domain events are counted, and the exclusion is reported', () => {
  const activity = referralActivity([
    ev({ id: '1', event_type: REFERRAL_DOMAIN_EVENTS.code_validated }),
    ev({ id: '2', event_type: REFERRAL_DOMAIN_EVENTS.code_created }),
    ev({ id: '3', event_type: 'trust.dispute_created' }),
    ev({ id: '4', event_type: 'agent.tool_executed' }),
    ev({ id: '5', event_type: 'ai_marketing.asset_drafted' }),
    ev({ id: '6', event_type: 'marketplace_listing_viewed' }),
  ]);
  assert.equal(activity.referral_events.value, 2,
    'counting the whole shared table would inflate referral activity');
  assert.equal(activity.excluded_from_this_count.other_domain_events, 4);
  assert.ok(/shared/i.test(activity.excluded_from_this_count.note));
});

test('a trust or agent event never appears as a referral channel', async () => {
  const client = createClient({
    events: [
      ev({ id: '1', event_type: 'trust.dispute_created', channel: 'admin' }),
      ev({ id: '2', event_type: REFERRAL_DOMAIN_EVENTS.code_validated, channel: 'whatsapp' }),
    ],
  });
  const result = await getReferralIntelligence(client, ADMIN);
  assert.equal(result.channels.by_channel.whatsapp, 1);
  assert.equal(result.channels.by_channel.admin, undefined,
    'another domain traffic must not be reported as a referral channel');
});

test('validation success is measured against validations, not against every event', () => {
  const activity = referralActivity([
    ev({ id: '1', event_type: REFERRAL_DOMAIN_EVENTS.code_validated }),
    ev({ id: '2', event_type: REFERRAL_DOMAIN_EVENTS.code_validated }),
    ev({ id: '3', event_type: REFERRAL_DOMAIN_EVENTS.code_failed }),
    ev({ id: '4', event_type: 'trust.risk_check_run' }),
  ]);
  assert.equal(activity.validations.value, 2);
  assert.equal(activity.failed_validations.value, 1);
});

// ── ROI is refused, not deferred ───────────────────────────────────────────

test('campaign, channel and promotion ROI are refused for want of a cost side', () => {
  const byKey = Object.fromEntries(NOT_MEASURABLE.map((e) => [e.key, e]));
  for (const key of ['campaign_roi', 'channel_roi', 'promotion_performance']) {
    assert.ok(byKey[key], `${key} must be declared unmeasurable`);
  }
  assert.equal(byKey.campaign_roi.reason, 'no_cost_recorded');
  assert.equal(byKey.channel_roi.reason, 'no_cost_recorded');
  assert.ok(/investment/i.test(byKey.campaign_roi.detail));
});

test('no payload field is named as a return, ROI, cost or spend', async () => {
  const client = createClient({ events: [ev()], transactions: [wtx()], inquiries: [inq()] });
  const result = await getReferralIntelligence(client, ADMIN);
  const keys = [
    ...Object.keys(result.activity),
    ...Object.keys(result.channels),
    ...Object.keys(result.rewards),
    ...Object.keys(result.inventory),
    ...Object.keys(result.attributed_outcomes),
  ].join(' ').toLowerCase();
  for (const forbidden of ['roi', 'return_on', 'cost', 'spend', 'budget', 'profit']) {
    assert.ok(!keys.includes(forbidden), `no referral field may be named "${forbidden}"`);
  }
  assert.equal(result.calculation_version, REFERRAL_INTELLIGENCE_VERSION);
});

// ── Accrued is not paid ────────────────────────────────────────────────────

test('a pending reward is never reported as paid', () => {
  const ledger = rewardLedger([
    wtx({ id: '1', status: 'pending', amount: 10 }),
    wtx({ id: '2', status: 'held', amount: 15 }),
  ]);
  assert.equal(ledger.transactions_recorded.value, 2);
  assert.equal(ledger.paid_out.value, 0);
  assert.equal(ledger.awaiting_settlement.value, 2);
  assert.equal(ledger.accrued_amounts.by_currency.USD.total, 25);
  // The paid block exists and is explicitly empty, so a reader cannot mistake the
  // accrued figure for money delivered.
  assert.deepEqual(ledger.paid_amounts.by_currency, {});
  assert.ok(/value promised, not value delivered/i.test(ledger.note));
});

test('a settled reward is counted as paid', () => {
  const ledger = rewardLedger([
    wtx({ id: '1', status: 'paid', amount: 10 }),
    wtx({ id: '2', status: 'pending', amount: 5 }),
  ]);
  assert.equal(ledger.paid_out.value, 1);
  assert.equal(ledger.paid_amounts.by_currency.USD.total, 10);
  assert.equal(ledger.accrued_amounts.by_currency.USD.total, 15);
  assert.equal(ledger.note, null);
});

test('reward amounts are never summed across currencies', () => {
  const grouped = amountsByCurrency([
    { amount: 100, currency: 'USD' },
    { amount: 4000, currency: 'ZAR' },
  ]);
  assert.equal(grouped.currencies, 2);
  assert.ok(!JSON.stringify(grouped).includes('4100'));
  assert.ok(/no exchange rate/i.test(grouped.note));
});

// ── Attribution coverage travels with the number ───────────────────────────

test('the source breakdown carries its coverage, because most events record none', () => {
  const dist = channelDistribution([
    ev({ id: '1', source: 'marketplace' }),
    ev({ id: '2', source: null }),
    ev({ id: '3', source: null }),
    ev({ id: '4', source: null }),
  ]);
  assert.equal(dist.by_source.marketplace, 1);
  assert.equal(dist.source_coverage.recorded, 1);
  assert.equal(dist.source_coverage.total, 4);
  assert.ok(/not a picture of the whole/i.test(dist.source_coverage.note));
});

test('full source coverage carries no shortfall note', () => {
  const dist = channelDistribution([ev({ id: '1', source: 'web' })]);
  assert.equal(dist.source_coverage.note, null);
});

test('an event with no channel is counted as unrecorded, not assigned to one', () => {
  const dist = channelDistribution([ev({ id: '1', channel: null })]);
  assert.equal(dist.by_channel.unrecorded, 1);
  assert.equal(dist.by_channel.web, undefined);
});

test('an attributed inquiry is not called a conversion to a sale', () => {
  const outcomes = attributedOutcomes([
    inq({ id: '1', referral_code: 'ABC' }),
    inq({ id: '2' }),
  ]);
  assert.equal(outcomes.inquiries_with_a_referral_code.value, 1);
  assert.ok(/records no sale/i.test(outcomes.note));
  assert.equal(outcomes.sales, undefined);
  assert.equal(outcomes.revenue, undefined);
});

// ── Scope and failure ──────────────────────────────────────────────────────

test('referral intelligence requires a platform administrator', () => {
  assert.throws(() => resolveReferralScope({ id: 'u1', role: 'owner' }), AuthorizationError);
  assert.throws(() => resolveReferralScope({ id: 'd1', role: 'dealer' }), AuthorizationError);
  assert.throws(() => resolveReferralScope({ role: 'admin' }), AuthorizationError);
});

test('a failed read reports unavailable and publishes no counts', async () => {
  const result = await getReferralIntelligence(createClient({ failTable: 'referral_events' }), ADMIN);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.equal(result.activity, undefined);
  assert.equal(result.rewards, undefined);
  assert.ok(/NOT zero/i.test(result.message));
});

test('the referral route is admin-only and takes no caller scope', () => {
  const routes = codeOnly(read('backend/routes/intelligenceProjectionRoutes.js'));
  const block = routes.split("'/api/admin/referrals/intelligence'")[1].split('router.get')[0];
  assert.match(block, /authorizeRole\(\['admin'\]\)/);
  assert.ok(!block.includes('government'), 'gap G5 must not be repeated on a referral surface');
  assert.ok(block.includes('req.userContext'));
});

test('the organic-versus-operator limit is declared rather than guessed', () => {
  const byKey = Object.fromEntries(NOT_MEASURABLE.map((e) => [e.key, e]));
  assert.equal(byKey.organic_vs_operator.reason, 'actor_type_not_discriminating');
  assert.ok(/agent by construction/i.test(byKey.organic_vs_operator.detail));
});
