/**
 * CarUp Intelligence 1.0 — I14 referral and marketing intelligence.
 *
 * Three facts from the live table decide what this can honestly say.
 *
 * FIRST: `referral_events` is a SHARED EVENT LOG, not a referral log. Of 1163 rows
 * on staging, only about 235 are `referral.*`. The rest are trust disputes, agent
 * tool executions, AI marketing drafts, marketplace inquiries, import-campaign
 * milestones and wallet movements — all writing to the same table. Counting the
 * table as "referral activity" would inflate it roughly fivefold, so this module
 * counts an explicit referral-domain event set and says what it excluded.
 *
 * SECOND: there is NO COST SIDE ANYWHERE. No campaign, code or promotion table has
 * a budget, spend or cost column. ROI is return divided by investment, and CarUp
 * records no investment — so campaign ROI, channel ROI and promotion ROI are not
 * "not yet computed", they are structurally underivable. They are refused.
 *
 * THIRD: no referral reward has ever been paid. All 62 wallet transactions are
 * `pending` or `held`; not one is settled. Reward VALUE ACCRUED and reward VALUE
 * PAID are different figures and only the first exists, so the second is never
 * implied.
 *
 * On fraud-safe attribution: `actor_type` cannot separate organic activity from
 * operator activity, because the public local-marketplace intent route records
 * every caller as `agent` by construction. That limitation is reported rather than
 * papered over with a confident "organic" number.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  rate,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';

export const REFERRAL_INTELLIGENCE_VERSION = 'referral_performance@1';

const PLATFORM_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

/**
 * The events that are actually about referral. Everything else in the table
 * belongs to another domain that happens to share the log.
 */
export const REFERRAL_DOMAIN_EVENTS = Object.freeze({
  code_created: 'referral.code_created',
  code_validated: 'referral.code_validated',
  code_failed: 'referral.code_failed',
  link_opened: 'referral.link_opened',
  qr_scanned: 'referral.qr_scanned',
  barcode_scanned: 'referral.barcode_scanned',
  coupon_applied: 'coupon.applied',
  coupon_redeemed: 'coupon.redeemed',
});

const REFERRAL_EVENT_SET = new Set(Object.values(REFERRAL_DOMAIN_EVENTS));

/** A wallet transaction state that means value actually left CarUp. */
const PAID_STATUSES = new Set(['paid', 'settled', 'released', 'completed']);

export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'campaign_roi',
    label: 'Campaign ROI',
    reason: 'no_cost_recorded',
    detail: 'No campaign, code or promotion table records a budget, spend or cost. A return needs an investment to divide by, and CarUp holds none — so an ROI figure would be invented, not computed.',
  },
  {
    key: 'channel_roi',
    label: 'Channel ROI',
    reason: 'no_cost_recorded',
    detail: 'Channel volume is recorded; channel cost is not. Volume alone cannot say which channel was worth using.',
  },
  {
    key: 'promotion_performance',
    label: 'Promotion performance',
    reason: 'no_promotions_recorded',
    detail: 'The dealer promotions table is empty, so no promotion has run and none can be scored.',
  },
  {
    key: 'reward_payout',
    label: 'Rewards paid',
    reason: 'no_settled_wallet_transaction',
    detail: 'Every referral wallet transaction is pending or held. No reward has been paid, so accrued value must never be presented as money delivered to a referrer.',
  },
  {
    key: 'organic_vs_operator',
    label: 'Organic versus operator activity',
    reason: 'actor_type_not_discriminating',
    detail: 'The public local-marketplace route records every caller as an agent by construction, so the actor type cannot separate a visitor acting on their own from an operator acting for them.',
  },
  {
    key: 'partner_performance',
    label: 'External partner performance',
    reason: 'no_live_partner',
    detail: 'The partner client rows on staging are acceptance-test artifacts and the production keys were revoked. There is no live partner whose referral performance could be reported.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function recorded(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Amounts grouped by their own currency. CarUp applies no exchange rate. */
export function amountsByCurrency(rows, amountField = 'amount', currencyField = 'currency') {
  const buckets = {};
  let unpriced = 0;
  for (const row of rows) {
    const amount = recorded(row[amountField]);
    const currency = row[currencyField];
    if (amount === null || !currency) { unpriced += 1; continue }
    const key = String(currency).toUpperCase();
    buckets[key] = buckets[key] || { total: 0, count: 0 };
    buckets[key].total += amount;
    buckets[key].count += 1;
  }
  return {
    by_currency: buckets,
    currencies: Object.keys(buckets).length,
    unpriced_records: unpriced,
    note: 'Amounts are grouped by their own currency and never combined. CarUp applies no exchange rate.',
  };
}

/**
 * Referral activity, and an explicit account of what was left out.
 *
 * The exclusion is the point: the same table carries trust, agent and marketplace
 * events, and a reader who sees only the referral total has no way to know the
 * table held five times as much.
 */
export function referralActivity(allEvents) {
  const referral = allEvents.filter((row) => REFERRAL_EVENT_SET.has(String(row.event_type)));
  const byType = {};
  for (const row of referral) {
    const type = String(row.event_type);
    byType[type] = (byType[type] || 0) + 1;
  }
  const validated = byType[REFERRAL_DOMAIN_EVENTS.code_validated] || 0;
  const failed = byType[REFERRAL_DOMAIN_EVENTS.code_failed] || 0;

  return {
    referral_events: metric(referral.length),
    codes_created: metric(byType[REFERRAL_DOMAIN_EVENTS.code_created] || 0),
    validations: metric(validated),
    failed_validations: metric(failed),
    validation_success_rate: rate(validated, validated + failed, { min: 10 }),
    coupons_applied: metric(byType[REFERRAL_DOMAIN_EVENTS.coupon_applied] || 0),
    coupons_redeemed: metric(byType[REFERRAL_DOMAIN_EVENTS.coupon_redeemed] || 0),
    by_type: byType,
    excluded_from_this_count: {
      other_domain_events: allEvents.length - referral.length,
      note: 'The referral event table is shared with the trust, agent, AI-marketing and marketplace domains. Only referral-domain events are counted above.',
    },
  };
}

/**
 * Channel distribution, with attribution coverage stated.
 *
 * `channel` is recorded on effectively every event; `source` is not — it is null
 * on roughly nine events in ten. A source breakdown drawn from the tenth would
 * describe a sliver as though it were the whole, so the coverage travels with it.
 */
export function channelDistribution(events) {
  const byChannel = {};
  const bySource = {};
  let sourceRecorded = 0;
  for (const row of events) {
    const channel = row.channel ? String(row.channel) : 'unrecorded';
    byChannel[channel] = (byChannel[channel] || 0) + 1;
    if (row.source) {
      sourceRecorded += 1;
      const source = String(row.source);
      bySource[source] = (bySource[source] || 0) + 1;
    }
  }
  return {
    by_channel: byChannel,
    by_source: bySource,
    source_coverage: {
      recorded: sourceRecorded,
      total: events.length,
      note: events.length > 0 && sourceRecorded < events.length
        ? 'Most events record no source. The source breakdown describes only the events that carry one and is not a picture of the whole.'
        : null,
    },
  };
}

/**
 * The reward ledger.
 *
 * Accrued and paid are kept apart. A pending credit is a promise CarUp has made,
 * not money a referrer has received, and presenting the two as one figure is how a
 * referral programme starts overstating what it has delivered.
 */
export function rewardLedger(transactions) {
  const byStatus = {};
  for (const row of transactions) {
    const status = String(row.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const paid = transactions.filter((row) => PAID_STATUSES.has(String(row.status)));

  return {
    transactions_recorded: metric(transactions.length),
    paid_out: metric(paid.length),
    awaiting_settlement: metric(transactions.length - paid.length),
    by_status: byStatus,
    accrued_amounts: amountsByCurrency(transactions),
    paid_amounts: paid.length === 0
      ? { by_currency: {}, currencies: 0, unpriced_records: 0, note: 'No reward has been paid.' }
      : amountsByCurrency(paid),
    note: paid.length === 0 && transactions.length > 0
      ? 'No referral reward has been paid. The accrued figures are value promised, not value delivered.'
      : null,
  };
}

/**
 * Attribution onto a real business outcome.
 *
 * An inquiry carrying a referral or campaign code is the only place CarUp can see
 * a referral reaching something commercial. Coverage is low and is reported, so a
 * count is never mistaken for the whole funnel.
 */
export function attributedOutcomes(inquiries) {
  const withReferral = inquiries.filter((row) => row.referral_code);
  const withCampaign = inquiries.filter((row) => row.campaign_code);
  return {
    inquiries_total: metric(inquiries.length),
    inquiries_with_a_referral_code: metric(withReferral.length),
    inquiries_with_a_campaign_code: metric(withCampaign.length),
    referral_attribution_rate: rate(withReferral.length, inquiries.length, { min: 10 }),
    note: 'An inquiry is the furthest a referral can be followed. CarUp records no sale against a referral code, so nothing here is a conversion to a completed transaction.',
  };
}

export function resolveReferralScope(actor) {
  const actorId = actor?.id ? String(actor.id) : null;
  if (!actorId) throw new AuthorizationError('Authentication required.');
  const role = String(actor?.platformRole || actor?.role || '');
  if (!PLATFORM_ROLES.has(role)) {
    throw new AuthorizationError('Referral intelligence requires a platform administrator.');
  }
  return { actorId, platformScope: true };
}

export async function getReferralIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  resolveReferralScope(actor);
  const { start, end } = windowBounds(windowDays);

  let events;
  let transactions;
  let inquiries;
  let codes;
  let campaigns;
  try {
    events = await readAllPages(() => client
      .from('referral_events')
      .select('id, tenant_id, event_type, channel, source, actor_type, session_id, occurred_at, created_at'));
    transactions = await readAllPages(() => client
      .from('referral_wallet_transactions')
      .select('id, status, transaction_type, amount, currency, created_at'));
    inquiries = await readAllPages(() => client
      .from('marketplace_inquiries')
      .select('id, referral_code, campaign_code, status, created_at'));
    codes = await readAllPages(() => client
      .from('referral_codes')
      .select('id, status, channel, created_at'));
    campaigns = await readAllPages(() => client
      .from('referral_campaigns')
      .select('id, status, campaign_type, created_at'));
  } catch (error) {
    return {
      scope: 'platform',
      window_days: windowDays,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'referral_read_failed'),
      calculation_version: REFERRAL_INTELLIGENCE_VERSION,
      message: 'Referral intelligence could not be read. These figures are NOT zero.',
      not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),
    };
  }

  const inWindow = (rows, field = 'created_at') => rows.filter((row) => row[field] && row[field] >= start && row[field] < end);

  const windowEvents = inWindow(events);
  const referralOnly = windowEvents.filter((row) => REFERRAL_EVENT_SET.has(String(row.event_type)));

  return {
    scope: 'platform',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: REFERRAL_INTELLIGENCE_VERSION,

    inventory: {
      active_codes: metric(codes.filter((row) => String(row.status) === 'ACTIVE').length),
      active_campaigns: metric(campaigns.filter((row) => String(row.status) === 'ACTIVE').length),
      draft_campaigns: metric(campaigns.filter((row) => String(row.status) === 'DRAFT').length),
    },

    activity: referralActivity(windowEvents),
    // Channel and source are read from the referral events only, never the whole
    // shared log, so another domain's traffic cannot appear as a referral channel.
    channels: channelDistribution(referralOnly),
    rewards: rewardLedger(inWindow(transactions)),
    attributed_outcomes: attributedOutcomes(inWindow(inquiries)),

    not_measurable: NOT_MEASURABLE.map((entry) => ({ ...entry })),

    domain_boundary: 'Referral activity and accrued reward value only. No figure here is a return on spend: CarUp records no campaign cost, and no reward has been paid.',
  };
}
