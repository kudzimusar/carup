/**
 * CA-OWNER-02 — the Corporate management read model: one consistent staging snapshot, cut into the areas the Corporate
 * destinations read.
 *
 * The snapshot reads every area once (one shared source context, one conversation truth), so all Corporate pages opened
 * within its short life describe the same moment. Governance is NOT part of the shared snapshot: it is scoped to the actor
 * by the People & Access projection and is read per request.
 */
import { createSourceContext } from './sourceContext.js';
import { readMarketplaceDemandFacts } from './marketplaceDemandFacts.js';
import { readCommunicationsFacts, conversationTruthSource } from './communicationsFacts.js';
import { readQueueFacts } from './queueFacts.js';
import { readFinanceFacts } from './financeFacts.js';
import { readPlatformFacts, defaultRuntime } from './platformFacts.js';
import { composeAttention, projectRegistry, composeManagementSummary, BLOCKED_MEASURES } from './managementComposer.js';
import { statementFact } from './managementFact.js';

/** The ONE capability each area requires — the destination capability web/src/config/corporate/navigation.ts names. */
export const AREA_CAPABILITY = Object.freeze({
  overview: 'corporate.overview.read',
  operations: 'corporate.operations.summary.read',
  trust: 'corporate.risk.aggregate.read',
  finance: 'corporate.finance.summary.read',
  growth: 'corporate.growth.aggregate.read',
  platform: 'platform.health.read',
  'data-sources': 'corporate.metric.registry.read',
  report: 'corporate.report.read',
});

export const AREAS_NEEDING_GOVERNANCE = Object.freeze(['overview', 'data-sources', 'report']);

export async function computeSnapshot(client, { now = new Date(), host = null, runtime = defaultRuntime(client) } = {}) {
  const ctx = createSourceContext(client, { now });
  const conversations = conversationTruthSource(client, { now });
  const [marketplace, communications, queues, finance, platform] = await Promise.all([
    readMarketplaceDemandFacts(client, { now, ctx }),
    readCommunicationsFacts(client, { now, ctx, conversations }),
    readQueueFacts(client, { now, ctx, communications: conversations }),
    readFinanceFacts(client, { now, ctx }),
    readPlatformFacts({ now, host, runtime }),
  ]);
  return {
    now,
    marketplace: marketplace.facts,
    communications: communications.facts,
    queues: queues.queues,
    finance: finance.facts,
    accountingStatement: finance.accountingStatement,
    platform: platform.facts,
    providers: platform.providers,
  };
}

const pick = (facts, ids) => ids.map((id) => facts.find((f) => f.id === id)).filter(Boolean);
const DEAD_LETTER = 'communications.notification.dead_letter';

const PLATFORM_OVERVIEW_IDS = [
  'platform.build.commit', 'platform.environment', 'platform.database.consistency', 'platform.session_authority',
  'platform.communications.kill_switch', 'platform.communications.scheduler', 'platform.providers.ready',
];
const BUSINESS_IDS = [
  'marketplace.listing.public', 'marketplace.inquiry.open', 'marketplace.reservation.active', 'growth.account.operational',
  'trade.order.open', 'trade.logistics.open_for_quotes', 'service.case.open',
];
const RECENT_IDS = ['marketplace.inquiry.recent', 'trade.order.recent', 'service.case.recent', 'growth.search.recorded', 'growth.search.zero_result'];
const GROWTH_IDS = [
  'growth.account.operational', 'marketplace.inquiry.open', 'marketplace.inquiry.recent', 'growth.search.recorded', 'growth.search.zero_result',
  'trade.order.open', 'trade.order.recent', 'trade.logistics.open_for_quotes', 'service.case.open', 'service.case.recent', 'growth.navigation.route_render',
];

const platformForbidden = () => statementFact({
  id: 'platform.forbidden', label: 'Platform health', state: 'FORBIDDEN',
  reason: 'Platform facts require the platform.health.read capability.',
});

/** Cut the snapshot into one area's payload. Pure. */
export function areaPayload(area, snapshot, { governance = [], grantCapabilities = [], now = snapshot.now } = {}) {
  const platformAllowed = grantCapabilities.includes('platform.health.read');
  const allFacts = [
    ...governance, ...snapshot.marketplace, ...snapshot.communications, ...snapshot.queues.map((q) => q.fact), ...snapshot.finance,
    ...(platformAllowed ? snapshot.platform : []),
  ];
  const areas = {
    governance, marketplace: snapshot.marketplace, communications: snapshot.communications, queues: snapshot.queues,
    finance: snapshot.finance, platform: platformAllowed ? snapshot.platform : [],
  };
  switch (area) {
    case 'overview': {
      const registry = projectRegistry(allFacts);
      return {
        attention: composeAttention(areas, { grantCapabilities }),
        sections: {
          governance,
          business: pick(snapshot.marketplace, BUSINESS_IDS),
          communications: snapshot.communications.filter((f) => f.id !== DEAD_LETTER || platformAllowed),
          queues: snapshot.queues.map(({ id, plane, label, owner, operate, fact, attention }) => ({ id, plane, label, owner, operate, fact, attention })),
          platform: platformAllowed ? [...pick(snapshot.platform, PLATFORM_OVERVIEW_IDS), ...pick(snapshot.communications, [DEAD_LETTER])] : [platformForbidden()],
          recent: pick(snapshot.marketplace, RECENT_IDS),
          data: {
            usable: registry.filter((r) => r.usable && r.source).length,
            degraded: registry.filter((r) => r.state === 'DEGRADED').length,
            unavailable: registry.filter((r) => !r.usable && r.state !== 'DEGRADED').length,
          },
        },
        unavailable: [
          { id: 'finance.accounting', label: 'Corporate accounting (revenue, profit, cash, receivables, payables, GMV)', reason: snapshot.accountingStatement },
          ...BLOCKED_MEASURES.map(({ id, label, reason }) => ({ id, label, reason })),
        ],
      };
    }
    case 'operations':
      return { queues: snapshot.queues.filter((q) => q.plane === 'operations'), communications: snapshot.communications.filter((f) => f.id !== DEAD_LETTER) };
    case 'trust':
      return { queues: snapshot.queues.filter((q) => q.plane === 'trust') };
    case 'finance':
      return { facts: snapshot.finance, accounting_statement: snapshot.accountingStatement };
    case 'growth':
      return { facts: pick(snapshot.marketplace, GROWTH_IDS) };
    case 'platform':
      return { facts: [...snapshot.platform, ...pick(snapshot.communications, [DEAD_LETTER])], providers: snapshot.providers };
    case 'data-sources':
      return { registry: projectRegistry(allFacts) };
    case 'report':
      return { report: composeManagementSummary(areas, { now }) };
    default:
      throw new Error(`unknown area ${area}`);
  }
}
