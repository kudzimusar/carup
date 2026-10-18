/**
 * CA-OWNER-02 (A, F, G, L) — composes Corporate management facts into what the Owner reads first.
 *
 * composeAttention — "What requires my attention today?" Only rule-backed items (CA-UX-01 §21.2): platform incidents,
 *   unreadable sources, operational conversations awaiting a reply, named queues with work waiting, populations K2B cannot
 *   place, delivery failures. They are ordered by a documented CATEGORY order, then oldest first — there is no severity
 *   score, no AI ranking and no invented target. Platform and delivery items need platform.health.read.
 *
 * projectRegistry — the metric / source registry projection: one row per served fact (usable or not, with its reason)
 *   plus the blocked measures with their governing reason.
 *
 * composeManagementSummary — the Corporate Staging Management Summary as a governed CURRENT LIVE VIEW. It is not a
 *   generated, reviewed, approved or published report instance: no generation authority exists (OD-CAREPORT-005).
 */
import { createHash } from 'node:crypto';
import { liveFact, statementFact, CURRENT_WINDOW } from './managementFact.js';

export const ATTENTION_CATEGORY_ORDER = Object.freeze(['platform', 'data_source', 'communications', 'queue', 'provenance_review', 'delivery']);

const LIVE_STATES = new Set(['GOVERNED_ACTUAL', 'TECHNICAL_OPERATIONAL']);
const isPlatformFact = (f) => String(f?.id || '').startsWith('platform.');

function item(category, fact, { id, title, count = null, ageSince = null, ruleSource, reason = null, operate = null }) {
  return {
    id,
    category,
    title,
    count,
    age_since: ageSince,
    rule_source: ruleSource,
    reason,
    source: fact?.source?.authority ?? null,
    as_of: fact?.as_of ?? null,
    scope: fact?.scope ?? null,
    truth_state: fact?.state ?? null,
    fact_id: fact?.id ?? null,
    operate,
  };
}

const factById = (facts, id) => (facts || []).find((f) => f.id === id) || null;

export function composeAttention(areas = {}, { grantCapabilities = [] } = {}) {
  const platformAllowed = grantCapabilities.includes('platform.health.read');
  const items = [];
  const all = [
    ...(areas.governance || []), ...(areas.marketplace || []), ...(areas.communications || []),
    ...(areas.queues || []).map((q) => q.fact), ...(areas.finance || []), ...(platformAllowed ? (areas.platform || []) : []),
  ];

  // 1 · platform incidents (technical authority states that are not healthy)
  if (platformAllowed) {
    for (const f of areas.platform || []) {
      const unhealthy = (f.id === 'platform.session_authority' && f.value === 'unhealthy')
        || (f.id === 'platform.database.consistency' && f.value === 'inconsistent');
      if (unhealthy) {
        items.push(item('platform', f, { id: `attention:platform:${f.id}`, title: `${f.label}: ${f.value}`, ruleSource: 'Runtime authority state (technical)', reason: f.detail }));
      }
    }
  }
  // 2 · sources that could not be read (completely)
  for (const f of all) {
    if (f.state === 'DEGRADED') {
      items.push(item('data_source', f, { id: `attention:data_source:${f.id}`, title: `Source could not be read: ${f.label}`, ruleSource: 'Source read failed or was incomplete', reason: f.reason }));
    }
  }
  // 3 · operational conversations awaiting a reply (with how many are past their recorded reply target)
  const awaiting = factById(areas.communications, 'communications.conversation.awaiting_reply');
  const overdue = factById(areas.communications, 'communications.conversation.overdue');
  if (awaiting && LIVE_STATES.has(awaiting.state) && awaiting.value > 0) {
    const late = overdue && LIVE_STATES.has(overdue.state) ? overdue.value : null;
    items.push(item('communications', awaiting, {
      id: 'attention:communications:awaiting_reply',
      title: `${awaiting.value} operational conversation${awaiting.value === 1 ? '' : 's'} awaiting a reply${late ? ` (${late} past the reply target)` : ''}`,
      count: awaiting.value,
      ageSince: awaiting.extent?.oldest_at ?? null,
      ruleSource: overdue?.detail || 'The customer spoke last and no reply has been sent since.',
      operate: { route: '/admin/communications', label: 'Open communications inbox' },
    }));
  }
  // 4 · named queues with work waiting (communications is item 3)
  for (const q of areas.queues || []) {
    if (q.id === 'ops.communications_awaiting_reply' || q.attention?.state !== 'work_waiting') continue;
    items.push(item('queue', q.fact, {
      id: `attention:queue:${q.id}`, title: `${q.fact.value} · ${q.label}`, count: q.fact.value, ageSince: q.fact.extent?.oldest_at ?? null,
      ruleSource: q.attention.rule, operate: q.operate,
    }));
  }
  // 5 · populations K2B cannot place (needs review — never counted as operational)
  const needsReview = factById(areas.communications, 'communications.conversation.needs_review');
  if (needsReview && LIVE_STATES.has(needsReview.state) && needsReview.value > 0) {
    items.push(item('provenance_review', needsReview, {
      id: 'attention:provenance_review:conversations', title: `${needsReview.value} conversation${needsReview.value === 1 ? '' : 's'} need provenance review`,
      count: needsReview.value, ageSince: needsReview.extent?.oldest_at ?? null, ruleSource: 'K2B could not place the customer (unknown_requires_review)',
      operate: { route: '/admin/communications', label: 'Open communications inbox' },
    }));
  }
  for (const f of all) {
    const unknown = f.provenance?.unknown_requires_review;
    if (f.id === 'communications.conversation.needs_review' || f.id.startsWith('communications.conversation.') || !LIVE_STATES.has(f.state) || !(unknown > 0)) continue;
    items.push(item('provenance_review', f, {
      id: `attention:provenance_review:${f.id}`, title: `${unknown} record${unknown === 1 ? '' : 's'} behind "${f.label}" need provenance review`,
      count: unknown, ruleSource: 'K2B could not place the record (unknown_requires_review); it is not counted as operational',
    }));
  }
  // 6 · delivery failures (technical, Platform-owned)
  if (platformAllowed) {
    const dead = factById(areas.communications, 'communications.notification.dead_letter');
    if (dead && LIVE_STATES.has(dead.state) && dead.value > 0) {
      items.push(item('delivery', dead, {
        id: 'attention:delivery:dead_letter', title: `${dead.value} notification${dead.value === 1 ? '' : 's'} in dead-letter`, count: dead.value,
        ageSince: dead.extent?.oldest_at ?? null, ruleSource: 'Delivery failures recorded (technical, Platform-owned)',
        reason: dead.extent?.newest_at ? `Newest ${dead.extent.newest_at}.` : null,
      }));
    }
  }

  const rank = (c) => ATTENTION_CATEGORY_ORDER.indexOf(c);
  return items.sort((a, b) => rank(a.category) - rank(b.category)
    || (a.age_since ? 0 : 1) - (b.age_since ? 0 : 1)
    || String(a.age_since || '').localeCompare(String(b.age_since || ''))
    || a.id.localeCompare(b.id));
}

// ── registry ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Accepted registry identities (CA-METRIC-01 §20 / CA-GROWTH-01 §45) that a served fact is a wrapped or current-subset form of. */
const REGISTRY_REFS = Object.freeze({
  'marketplace.listing.public': 'marketplace.listing.public.count',
  'marketplace.inquiry.open': 'marketplace.inquiry.qualifying.count — current subset',
  'marketplace.inquiry.recent': 'marketplace.inquiry.qualifying.count — rolling window',
  'marketplace.reservation.active': 'marketplace.reservation.established.count — current subset',
  'growth.account.operational': 'corporate.account.registered.count — K2B-operational subset',
  'growth.search.recorded': 'marketplace.search.performed.count',
  'growth.search.zero_result': 'marketplace.search.zero_result.count',
  'growth.navigation.route_render': 'growth.navigation.route_render.count',
  'trade.order.open': 'trade.order.created.count — open subset',
  'trade.order.recent': 'trade.order.created.count',
  'service.case.open': 'service.case.request.count — open subset',
  'service.case.recent': 'service.case.request.count',
  'communications.conversation.open': 'communications.thread.open.count',
  'communications.notification.dead_letter': 'communications.queue.dead_letter.count',
  'trust.identity_verification': 'risk.identity.pending_review.count',
  'trust.evidence': 'risk.evidence.pending_review.count',
  'trust.fraud': 'risk.fraud.open_case.count',
});

/** Measures the Owner may expect that remain blocked, with their governing reason. */
export const BLOCKED_MEASURES = Object.freeze([
  { id: 'growth.customers', label: 'Customers', state: 'UNKNOWN_AUTHORITY', reason: 'No accepted customer definition (OD-CAMETRIC-001). Accounts are not customers.' },
  { id: 'growth.retention_churn', label: 'Active / retained / churned customers', state: 'UNAVAILABLE_NO_SOURCE', reason: 'No customer definition or retention source (OD-CAMETRIC-016).' },
  { id: 'growth.conversion', label: 'Conversion', state: 'UNAVAILABLE_NOT_SEPARABLE', reason: 'There is no metric named conversion; navigation and commercial records share no link key (OD-CAMETRIC-010).' },
  { id: 'growth.cac_ltv_roas', label: 'CAC, LTV and ROAS', state: 'PENDING_CA_FIN', reason: 'Need accounting cost and revenue authority and a customer definition.' },
  { id: 'growth.unique_visitors', label: 'Unique visitors', state: 'UNAVAILABLE_NO_SOURCE', reason: 'Navigation events carry no user or session; route renders are not users.' },
  { id: 'growth.search.top_terms', label: 'Top search terms', state: 'UNAVAILABLE_NOT_SEPARABLE', reason: 'Queries are stored only as hashes and are never reversed (OD-CAMETRIC-027).' },
  { id: 'platform.uptime', label: 'Platform uptime / availability', state: 'UNAVAILABLE_NO_SOURCE', reason: 'No governed availability source exists; seeded server-health rows are not uptime.' },
  { id: 'risk.score', label: 'Combined trust or risk score', state: 'UNKNOWN_AUTHORITY', reason: 'No combined score is defined; queues are shown separately (OD-CAMETRIC-031).' },
]);

const AREA_BY_PREFIX = Object.freeze({
  corporate: 'governance', marketplace: 'marketplace', growth: 'growth', trade: 'growth', service: 'growth', communications: 'communications',
  ops: 'operations', trust: 'trust', risk: 'trust', finance: 'finance', platform: 'platform', data: 'data',
});
const areaOf = (id) => AREA_BY_PREFIX[String(id).split('.')[0]] || 'other';

function provenanceMode(f) {
  if (f.provenance?.authority) return 'K2B applied';
  if (f.kind === 'governance') return 'governance record';
  if (f.kind === 'technical') return 'not applicable (technical)';
  if (f.state && !LIVE_STATES.has(f.state) && f.value === null && !f.source) return 'not applicable';
  return 'not provenance-filtered';
}

export function projectRegistry(facts = []) {
  const rows = [];
  const seen = new Set();
  for (const f of facts) {
    if (!f?.id || seen.has(f.id)) continue;
    seen.add(f.id);
    const usable = LIVE_STATES.has(f.state);
    rows.push({
      id: f.id,
      label: f.label,
      kind: f.kind ?? null,
      area: areaOf(f.id),
      source: f.source?.authority ?? null,
      state: f.state,
      as_of: f.as_of,
      window: f.window,
      scope: f.scope,
      provenance: provenanceMode(f),
      certification: f.certification,
      usable,
      reason: usable ? null : (f.reason || 'Not available.'),
      registry_ref: REGISTRY_REFS[f.id] ?? null,
    });
  }
  for (const b of BLOCKED_MEASURES) {
    if (seen.has(b.id)) continue;
    rows.push({
      id: b.id, label: b.label, kind: null, area: areaOf(b.id), source: null, state: b.state, as_of: null, window: null, scope: null,
      provenance: 'not applicable', certification: 'blocked', usable: false, reason: b.reason, registry_ref: null,
    });
  }
  return rows;
}

// ── management summary (current live view) ─────────────────────────────────────────────────────────────────────────

export const MANAGEMENT_SUMMARY_DEFINITION = Object.freeze({
  id: 'REPORT_CORPORATE_STAGING_MANAGEMENT_SUMMARY',
  version: 1,
  family: 'Ad-hoc governed report (staging)',
  title: 'Corporate Staging Management Summary',
  timezone: 'UTC',
  period: 'Point in time — each figure carries its own as-of time',
  scope: 'Staging only — never Corporate business Actual',
  content_model: 'Monthly Executive content model (CA-REPORT-01 §13.2), adapted as an ad-hoc staging summary',
});

export const MANAGEMENT_SUMMARY_STATEMENT = 'Current live view — not a generated report instance. Nothing here has been generated, reviewed, approved or published: '
  + 'no report generation authority (corporate.report.generate) exists yet (Owner decision OD-CAREPORT-005), and a stored, immutable '
  + 'instance needs an accepted report definition. Every figure states its own source, as-of time, scope and truth state.';

const digestOf = (facts) => createHash('sha256').update(JSON.stringify(
  [...facts].sort((a, b) => a.id.localeCompare(b.id)).map((f) => [f.id, f.state, f.value, f.unit, (f.breakdown || []).map((e) => [e.key, e.value, e.currency])]),
)).digest('hex');

export function composeManagementSummary(areas = {}, { now = new Date() } = {}) {
  const queues = areas.queues || [];
  const allFacts = [
    ...(areas.governance || []), ...queues.map((q) => q.fact), ...(areas.communications || []), ...(areas.platform || []),
    ...(areas.marketplace || []), ...(areas.finance || []),
  ];
  const registry = projectRegistry(allFacts);
  const usable = registry.filter((r) => r.usable && r.source).length;
  const degraded = registry.filter((r) => r.state === 'DEGRADED').length;
  const blocked = registry.length - usable - degraded;
  const technical = (id, label, value) => liveFact({ id, label, kind: 'technical', value, source: { authority: 'Corporate metric / source registry projection' }, asOf: now, scope: 'Corporate Admin read models', window: CURRENT_WINDOW });
  const sections = [
    { id: 'governance', title: 'Corporate governance', facts: areas.governance || [] },
    { id: 'operations', title: 'Operations — named queues', facts: queues.filter((q) => q.plane === 'operations').map((q) => q.fact) },
    { id: 'communications', title: 'Communications', facts: areas.communications || [] },
    { id: 'platform', title: 'Platform (technical)', facts: areas.platform || [] },
    { id: 'trust', title: 'Trust / Risk / Compliance — named queues', facts: queues.filter((q) => q.plane === 'trust').map((q) => q.fact) },
    { id: 'marketplace_demand', title: 'Marketplace & demand', facts: areas.marketplace || [] },
    {
      id: 'data_sources',
      title: 'Data-source health',
      facts: [
        technical('data.sources.usable', 'Management facts read live from their source', usable),
        technical('data.sources.degraded', 'Management facts whose source could not be read', degraded),
        technical('data.sources.blocked', 'Management facts blocked or unavailable by rule', Math.max(0, blocked)),
      ],
    },
  ];
  return {
    definition: MANAGEMENT_SUMMARY_DEFINITION,
    state: 'current_live_view',
    statement: MANAGEMENT_SUMMARY_STATEMENT,
    generated_at: now.toISOString(),
    sections,
    digest: digestOf(allFacts),
  };
}

export { statementFact };
