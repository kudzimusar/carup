/**
 * CA-OWNER-02 (A, F, G, L) — the Corporate composer: Overview attention, the metric/source registry projection and the
 * Corporate Staging Management Summary (current live view).
 *
 * Proven here (pure, with facts built by the fact core):
 *   · attention lists only rule-backed items — platform incidents, unreadable sources, operational conversations past their
 *     reply target, queues with work waiting, needs-review populations, delivery failures — in that documented category
 *     order, oldest first; clear queues never appear; no severity score exists; platform items need platform.health.read;
 *   · the registry has one row per served fact (usable or not, with the reason) plus the blocked measures with their
 *     governing reason, and no duplicates;
 *   · the summary is a governed CURRENT LIVE VIEW — never a generated/approved/published instance — with sections for
 *     governance, operations, communications, platform, trust, marketplace & demand and data-source health, and a digest that
 *     depends on values and states, not on the read time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { liveFact, statementFact, degradedFact, CURRENT_WINDOW } = await import('../services/corporate/management/managementFact.js');
const { composeAttention, projectRegistry, composeManagementSummary, BLOCKED_MEASURES, ATTENTION_CATEGORY_ORDER } = await import('../services/corporate/management/managementComposer.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const op = (id, label, value, extra = {}) => liveFact({ id, label, kind: 'operational', value, source: { authority: `src:${id}` }, asOf: NOW, scope: 'Staging', window: CURRENT_WINDOW, ...extra });
const tech = (id, label, value, extra = {}) => liveFact({ id, label, kind: 'technical', value, source: { authority: `src:${id}` }, asOf: NOW, scope: 'Staging', window: CURRENT_WINDOW, ...extra });
const queue = (id, value, oldest, plane = 'trust') => ({
  id, plane, label: `Queue ${id}`, owner: 'Owner', operate: { route: `/admin/${id}`, label: `Open ${id}` },
  fact: op(id, `Queue ${id}`, value, { extent: { oldestAt: oldest, newestAt: oldest } }),
  attention: value > 0 ? { state: 'work_waiting', rule: 'Items are waiting for CarUp action. No governed target exists for this queue, so nothing is called late.' } : { state: 'clear', rule: 'Nothing is waiting (complete read).' },
});

function world({ sessionHealthy = true } = {}) {
  return {
    communications: [
      op('communications.conversation.overdue', 'Operational conversations past their reply target', 2, { detail: 'default targets' }),
      op('communications.conversation.awaiting_reply', 'Operational conversations awaiting a reply', 3, { extent: { oldestAt: ago(4), newestAt: null } }),
      op('communications.conversation.needs_review', 'Conversations needing provenance review', 5),
      tech('communications.notification.dead_letter', 'Dead-letter notifications (delivery failures)', 49, { extent: { oldestAt: ago(90), newestAt: ago(60) } }),
    ],
    queues: [queue('trust.evidence', 7, ago(10)), queue('trust.fraud', 0, null), queue('ops.garage_applications', 1, ago(20), 'operations')],
    marketplace: [op('marketplace.listing.public', 'Published Marketplace listings', 1), degradedFact({ id: 'trade.order.open', label: 'Open trade (import) orders', kind: 'operational', source: { authority: 'x' }, asOf: NOW, window: CURRENT_WINDOW }, 'The source could not be read.')],
    platform: [tech('platform.session_authority', 'Session authority and TLS', sessionHealthy ? 'healthy' : 'unhealthy'), tech('platform.database.consistency', 'Database target consistency', 'consistent')],
    governance: [liveFact({ id: 'corporate.governance.membership.active', label: 'Active Corporate memberships', kind: 'governance', value: 2, source: { authority: 'g' }, asOf: NOW, scope: 'nodes', window: CURRENT_WINDOW })],
    finance: [statementFact({ id: 'finance.accounting.gmv', label: 'GMV', state: 'PENDING_CA_FIN', reason: 'No accounting system of record.' })],
  };
}

test('attention lists rule-backed items in the documented category order, oldest first, with no severity score', () => {
  const items = composeAttention(world({ sessionHealthy: false }), { grantCapabilities: ['platform.health.read'] });
  const categories = items.map((i) => i.category);
  assert.deepEqual([...new Set(categories)], ['platform', 'data_source', 'communications', 'queue', 'provenance_review', 'delivery'].filter((c) => categories.includes(c)));
  assert.deepEqual(ATTENTION_CATEGORY_ORDER, ['platform', 'data_source', 'communications', 'queue', 'provenance_review', 'delivery']);
  const queues = items.filter((i) => i.category === 'queue');
  assert.deepEqual(queues.map((q) => q.id), ['attention:queue:ops.garage_applications', 'attention:queue:trust.evidence'], 'oldest first');
  assert.equal(items.some((i) => i.id.includes('trust.fraud')), false, 'a clear queue never appears');
  for (const i of items) {
    assert.ok(i.rule_source && i.source && i.as_of && i.truth_state, i.id);
    assert.equal('severity' in i || 'score' in i, false, i.id);
  }
  assert.ok(items.find((i) => i.id === 'attention:platform:platform.session_authority'));
  assert.ok(items.find((i) => i.id === 'attention:data_source:trade.order.open'));
});

test('platform and delivery items need platform.health.read', () => {
  const items = composeAttention(world({ sessionHealthy: false }), { grantCapabilities: [] });
  assert.equal(items.some((i) => i.category === 'platform' || i.category === 'delivery'), false);
});

test('the registry has one row per served fact, plus the blocked measures — never a duplicate', () => {
  const w = world();
  const facts = [...w.communications, ...w.queues.map((q) => q.fact), ...w.marketplace, ...w.platform, ...w.governance, ...w.finance];
  const rows = projectRegistry(facts);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of facts) assert.ok(ids.includes(f.id), f.id);
  for (const b of BLOCKED_MEASURES) assert.ok(ids.includes(b.id), b.id);
  const trade = rows.find((r) => r.id === 'trade.order.open');
  assert.equal(trade.usable, false);
  assert.match(trade.reason, /could not be read/);
  const listings = rows.find((r) => r.id === 'marketplace.listing.public');
  assert.equal(listings.usable, true);
  assert.equal(listings.certification, 'not_certified');
  // The registry names what kind of fact each row is, so a live operational measure never reads as "Technical".
  assert.equal(listings.kind, 'operational');
  assert.equal(rows.find((r) => r.id === 'platform.session_authority').kind, 'technical');
  assert.equal(rows.find((r) => r.id === 'corporate.governance.membership.active').kind, 'governance');
  assert.equal(rows.find((r) => r.id === 'growth.customers').kind, null);
  const customers = rows.find((r) => r.id === 'growth.customers');
  assert.equal(customers.usable, false);
  assert.match(customers.reason, /OD-CAMETRIC-001/);
});

test('the management summary is a governed current live view with a value-based digest', () => {
  const w = world();
  const s1 = composeManagementSummary(w, { now: NOW });
  assert.equal(s1.definition.id, 'REPORT_CORPORATE_STAGING_MANAGEMENT_SUMMARY');
  assert.equal(s1.state, 'current_live_view');
  assert.match(s1.statement, /not a generated report/i);
  assert.match(s1.statement, /OD-CAREPORT-005/);
  assert.deepEqual(s1.sections.map((s) => s.id), ['governance', 'operations', 'communications', 'platform', 'trust', 'marketplace_demand', 'data_sources']);
  const later = composeManagementSummary(world(), { now: new Date(NOW.getTime() + 60_000) });
  assert.equal(later.digest, s1.digest, 'the digest depends on values and states, not on the read time');
  const changed = world();
  changed.marketplace[0] = op('marketplace.listing.public', 'Published Marketplace listings', 2);
  assert.notEqual(composeManagementSummary(changed, { now: NOW }).digest, s1.digest);
  assert.match(s1.digest, /^[0-9a-f]{64}$/);
});
