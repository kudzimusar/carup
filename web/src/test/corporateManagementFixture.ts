/**
 * CA-OWNER-02 — fixtures in the exact wire shape of GET /api/corporate/management/:area (contract carup.corporate_management.v1).
 * Values are illustrative test data only; the shape mirrors backend/services/corporate/management/managementFact.js.
 */
export const AS_OF = '2026-10-18T00:00:00.000Z'

type Wire = Record<string, unknown>

export function liveFactFixture({
  id, label, value, kind = 'operational', state, unit = null, detail = null, provenance = null, extent = null, breakdown = null, window = { kind: 'current' },
  scope = 'Staging · all CarUp organisations · K2B-operational records only', source = `source of ${id}`,
}: {
  id: string; label: string; value: number | string; kind?: 'operational' | 'technical' | 'governance'; state?: string; unit?: string | null; detail?: string | null
  provenance?: Wire | null; extent?: Wire | null; breakdown?: Wire[] | null; window?: Wire; scope?: string; source?: string
}): Wire {
  return {
    id, label, kind, state: state ?? (kind === 'governance' ? 'GOVERNED_ACTUAL' : 'TECHNICAL_OPERATIONAL'), value, unit,
    source: { authority: source, path: null }, as_of: AS_OF, window, scope, provenance, extent, breakdown,
    certification: kind === 'governance' ? 'governance_record' : 'not_certified', reason: null, detail,
  }
}

export function statementFactFixture({ id, label = id, state, reason = `reason for ${id}` }: { id: string; label?: string; state: string; reason?: string }): Wire {
  return {
    id, label, kind: null, state, value: null, unit: null, source: null, as_of: null, window: null, scope: null,
    provenance: null, extent: null, breakdown: null, certification: 'not_applicable', reason, detail: null,
  }
}

export function degradedFactFixture({ id, label = id }: { id: string; label?: string }): Wire {
  return { ...liveFactFixture({ id, label, value: 0 }), state: 'DEGRADED', value: null, reason: 'The source could not be read at 2026-10-18T00:00:00.000Z, so no value is shown.' }
}

export function managementEnvelope(area: string, payload: Wire): Wire {
  return { contract: 'carup.corporate_management.v1', decision: 'granted', read_only: true, area, generated_at: AS_OF, environment: 'staging', ...payload }
}

export const K2B = (raw: number, operational: number, excluded: number, unknown: number) => ({
  authority: 'PC01-K2B operational-provenance authority', raw, operational, excluded_non_operational: excluded, unknown_requires_review: unknown,
  by_class: { real_business_operational: operational, uat: excluded, unknown_requires_review: unknown },
})

const queue = (id: string, plane: 'operations' | 'trust', label: string, value: number, oldest: string | null, route: string | null) => ({
  id, plane, label, owner: plane === 'trust' ? 'Trust & Safety' : 'Marketplace Operations', operate: route ? { route, label: `Open ${label}` } : null,
  fact: liveFactFixture({ id, label, value, extent: { oldest_at: oldest, newest_at: oldest } }),
  attention: value > 0
    ? { state: 'work_waiting', rule: 'Items are waiting for CarUp action. No governed target exists for this queue, so nothing is called late.' }
    : { state: 'clear', rule: 'Nothing is waiting (complete read).' },
})

const degradedQueue = (id: string, plane: 'operations' | 'trust', label: string) => ({
  id, plane, label, owner: 'Trust & Safety', operate: null, fact: degradedFactFixture({ id, label }),
  attention: { state: 'unknown', rule: 'The queue could not be read, so whether work is waiting is unknown.' },
})

export const QUEUES_FIXTURE = [
  queue('ops.marketplace_moderation', 'operations', 'Listings awaiting moderation review', 2, '2026-10-01T00:00:00.000Z', '/admin/moderation'),
  queue('ops.garage_applications', 'operations', 'Garage applications awaiting CarUp review', 0, null, '/admin/garage-applications'),
  queue('trust.identity_verification', 'trust', 'Identity verification cases awaiting a reviewer', 3, '2026-09-20T00:00:00.000Z', '/admin/verification'),
  queue('trust.fraud', 'trust', 'Fraud cases open or investigating', 0, null, '/admin/fraud-queue'),
  degradedQueue('trust.partsentry', 'trust', 'PartSentry reviews awaiting a decision'),
]

export const COMMUNICATIONS_FIXTURE = [
  liveFactFixture({ id: 'communications.conversation.open', label: 'Open operational conversations', value: 4, provenance: K2B(654, 4, 610, 40) }),
  liveFactFixture({ id: 'communications.conversation.awaiting_reply', label: 'Operational conversations awaiting a reply', value: 2, extent: { oldest_at: '2026-10-12T00:00:00.000Z', newest_at: null } }),
  liveFactFixture({ id: 'communications.conversation.overdue', label: 'Operational conversations past their reply target', value: 1, detail: 'Measured against the default priority response targets stamped at creation — no governed SLA policy is configured.' }),
  liveFactFixture({ id: 'communications.conversation.no_individual_assignee', label: 'Open operational conversations with no individual assignee', value: 4 }),
  liveFactFixture({ id: 'communications.conversation.needs_review', label: 'Conversations needing provenance review', value: 40 }),
  liveFactFixture({ id: 'communications.conversation.non_operational', label: 'Certification, UAT, automation and historical conversations', value: 610 }),
]

const TECH_SCOPE = 'Staging runtime · this API deployment'
export const PLATFORM_FIXTURE = [
  liveFactFixture({ id: 'platform.build.commit', label: 'Build identity (commit)', value: '16602584', kind: 'technical', scope: TECH_SCOPE }),
  liveFactFixture({ id: 'platform.environment', label: 'Environment', value: 'staging', kind: 'technical', scope: TECH_SCOPE }),
  liveFactFixture({ id: 'platform.session_authority', label: 'Session authority and TLS', value: 'healthy', kind: 'technical', scope: TECH_SCOPE }),
  liveFactFixture({ id: 'platform.communications.kill_switch', label: 'Outbound kill switch', value: 'active — external sends disabled', kind: 'technical', scope: TECH_SCOPE }),
  liveFactFixture({ id: 'communications.notification.dead_letter', label: 'Dead-letter notifications (delivery failures)', value: 49, kind: 'technical', scope: 'Staging · all notification deliveries' }),
  statementFactFixture({ id: 'platform.certification_sessions', label: 'Active certification sessions', state: 'UNAVAILABLE_NO_SOURCE', reason: 'No aggregate session read exists. AUTH-05 closed user_sessions to the service role.' }),
]

export const OVERVIEW_FIXTURE = managementEnvelope('overview', {
  attention: [
    {
      id: 'attention:communications:awaiting_reply', category: 'communications', title: '2 operational conversations awaiting a reply (1 past the reply target)', count: 2,
      age_since: '2026-10-12T00:00:00.000Z', rule_source: 'Measured against the default priority response targets stamped at creation — no governed SLA policy is configured.',
      reason: null, source: 'message_threads + messages', as_of: AS_OF, scope: 'Staging', truth_state: 'TECHNICAL_OPERATIONAL', fact_id: 'communications.conversation.awaiting_reply',
      operate: { route: '/admin/communications', label: 'Open communications inbox' },
    },
    {
      id: 'attention:queue:trust.identity_verification', category: 'queue', title: '3 · Identity verification cases awaiting a reviewer', count: 3,
      age_since: '2026-09-20T00:00:00.000Z', rule_source: 'Items are waiting for CarUp action. No governed target exists for this queue, so nothing is called late.',
      reason: null, source: 'verification_sessions', as_of: AS_OF, scope: 'Staging', truth_state: 'TECHNICAL_OPERATIONAL', fact_id: 'trust.identity_verification',
      operate: { route: '/admin/verification', label: 'Open identity verification cases' },
    },
  ],
  sections: {
    governance: [
      liveFactFixture({ id: 'corporate.governance.membership.active', label: 'Active Corporate memberships', value: 2, kind: 'governance', scope: 'Organisation nodes you govern: CARUP_CORPORATE' }),
      liveFactFixture({ id: 'corporate.governance.assignment.active', label: 'Active persistent permission assignments', value: 4, kind: 'governance', scope: 'Organisation nodes you govern: CARUP_CORPORATE' }),
    ],
    business: [
      liveFactFixture({ id: 'marketplace.listing.public', label: 'Published Marketplace listings', value: 1, provenance: K2B(150, 1, 148, 1) }),
      liveFactFixture({ id: 'marketplace.inquiry.open', label: 'Open Marketplace inquiries (not sales)', value: 0, provenance: K2B(200, 0, 190, 10) }),
      degradedFactFixture({ id: 'trade.order.open', label: 'Open trade (import) orders' }),
    ],
    communications: COMMUNICATIONS_FIXTURE,
    queues: QUEUES_FIXTURE,
    platform: PLATFORM_FIXTURE,
    recent: [liveFactFixture({ id: 'marketplace.inquiry.recent', label: 'Marketplace inquiries received — 7 days (not sales)', value: 0, window: { kind: 'rolling', days: 7, from: '2026-10-11T00:00:00.000Z', to: AS_OF } })],
    data: { usable: 40, degraded: 1, unavailable: 22 },
  },
  unavailable: [
    { id: 'finance.accounting', label: 'Corporate accounting (revenue, profit, cash, receivables, payables, GMV)', reason: 'Corporate accounting system of record not yet established.' },
    { id: 'growth.customers', label: 'Customers', reason: 'No accepted customer definition (OD-CAMETRIC-001). Accounts are not customers.' },
  ],
})

export const OPERATIONS_FIXTURE = managementEnvelope('operations', {
  queues: QUEUES_FIXTURE.filter((q) => q.plane === 'operations'),
  communications: COMMUNICATIONS_FIXTURE,
})

export const TRUST_FIXTURE = managementEnvelope('trust', { queues: QUEUES_FIXTURE.filter((q) => q.plane === 'trust') })

export const FINANCE_FIXTURE = managementEnvelope('finance', {
  facts: [
    liveFactFixture({
      id: 'finance.escrow.sessions', label: 'Escrow sessions by provider mode and status', value: 3, provenance: K2B(40, 3, 37, 0),
      breakdown: [{ key: 'sandbox:created', label: 'Sandbox · created', value: 3, currency: null }],
      detail: 'Sandbox escrow is never a settlement, cash or revenue.',
    }),
    liveFactFixture({
      id: 'finance.application.status', label: 'Finance applications by status', value: 2,
      breakdown: [{ key: 'status:submitted', label: 'Submitted', value: 2, currency: null }, { key: 'requested:USD', label: 'Requested amount (USD)', value: 18500, currency: 'USD' }],
      detail: 'A requested amount is not a disbursement; an approval is not cash.',
    }),
    statementFactFixture({ id: 'finance.billing.subscriptions', label: 'Subscription billing (live)', state: 'UNAVAILABLE_NO_SOURCE', reason: 'No live billing provider is connected.' }),
    liveFactFixture({ id: 'finance.exceptions.escrow', label: 'Escrow sessions stuck in a failed or disputed state', value: 0 }),
    statementFactFixture({ id: 'finance.accounting.gmv', label: 'GMV', state: 'PENDING_CA_FIN', reason: 'Corporate accounting system of record not yet established.' }),
  ],
  accounting_statement: 'Corporate accounting system of record not yet established.',
})

export const GROWTH_FIXTURE = managementEnvelope('growth', {
  facts: [
    liveFactFixture({ id: 'growth.account.operational', label: 'Operational accounts (not customers)', value: 12, provenance: K2B(400, 12, 380, 8) }),
    liveFactFixture({ id: 'marketplace.inquiry.open', label: 'Open Marketplace inquiries (not sales)', value: 0, provenance: K2B(200, 0, 190, 10) }),
    liveFactFixture({ id: 'growth.search.recorded', label: 'Recorded searches (7 days)', value: 31, window: { kind: 'rolling', days: 7, from: '2026-10-11T00:00:00.000Z', to: AS_OF } }),
    liveFactFixture({ id: 'growth.navigation.route_render', label: 'Recorded route renders (7 days)', value: 940, kind: 'technical', window: { kind: 'rolling', days: 7, from: '2026-10-11T00:00:00.000Z', to: AS_OF } }),
  ],
})

export const PLATFORM_AREA_FIXTURE = managementEnvelope('platform', {
  facts: PLATFORM_FIXTURE,
  providers: [
    { channel: 'whatsapp', provider: 'meta_cloud', status: 'configured', available: true },
    { channel: 'email', provider: 'resend', status: 'not_configured', available: false },
  ],
})

export const DATA_SOURCES_FIXTURE = managementEnvelope('data-sources', {
  registry: [
    {
      id: 'marketplace.listing.public', label: 'Published Marketplace listings', kind: 'operational', area: 'marketplace', source: 'vehicles · Admin publication projection',
      state: 'TECHNICAL_OPERATIONAL', as_of: AS_OF, window: { kind: 'current' }, scope: 'Staging', provenance: 'K2B applied', certification: 'not_certified', usable: true, reason: null, registry_ref: null,
    },
    {
      id: 'trade.order.open', label: 'Open trade (import) orders', kind: 'operational', area: 'growth', source: 'diaspora_import_orders',
      state: 'DEGRADED', as_of: AS_OF, window: { kind: 'current' }, scope: 'Staging', provenance: 'K2B applied', certification: 'not_certified', usable: false, reason: 'The source could not be read.', registry_ref: null,
    },
    {
      id: 'growth.customers', label: 'Customers', kind: null, area: 'growth', source: null, state: 'UNKNOWN_AUTHORITY', as_of: null, window: null, scope: null,
      provenance: 'not applicable', certification: 'blocked', usable: false, reason: 'No accepted customer definition (OD-CAMETRIC-001).', registry_ref: null,
    },
    {
      id: 'corporate.governance.membership.active', label: 'Active Corporate memberships', kind: 'governance', area: 'governance', source: 'corporate_memberships',
      state: 'GOVERNED_ACTUAL', as_of: AS_OF, window: { kind: 'current' }, scope: 'Organisation nodes you govern: CARUP_CORPORATE', provenance: 'governance record', certification: 'governance_record', usable: true, reason: null, registry_ref: null,
    },
    {
      id: 'platform.session_authority', label: 'Session authority and TLS', kind: 'technical', area: 'platform', source: 'session-authority connection probe',
      state: 'TECHNICAL_OPERATIONAL', as_of: AS_OF, window: { kind: 'current' }, scope: 'Staging runtime', provenance: 'not applicable (technical)', certification: 'not_certified', usable: true, reason: null, registry_ref: null,
    },
  ],
})

export const REPORT_FIXTURE = managementEnvelope('report', {
  report: {
    definition: {
      id: 'REPORT_CORPORATE_STAGING_MANAGEMENT_SUMMARY', version: 1, family: 'Ad-hoc governed report (staging)', title: 'Corporate Staging Management Summary',
      timezone: 'UTC', period: 'Point in time — each figure carries its own as-of time', scope: 'Staging only — never Corporate business Actual',
      content_model: 'Monthly Executive content model (CA-REPORT-01 §13.2), adapted as an ad-hoc staging summary',
    },
    state: 'current_live_view',
    statement: 'Current live view — not a generated report instance. Nothing here has been generated, reviewed, approved or published.',
    generated_at: AS_OF,
    sections: [
      { id: 'governance', title: 'Governance', facts: [liveFactFixture({ id: 'corporate.governance.membership.active', label: 'Active Corporate memberships', value: 2, kind: 'governance' })] },
      { id: 'operations', title: 'Operations', facts: [liveFactFixture({ id: 'ops.marketplace_moderation', label: 'Listings awaiting moderation review', value: 2 })] },
    ],
    digest: 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  },
})

/** Every area's fixture, keyed by the URL segment the client requests. */
export const MANAGEMENT_FIXTURES: Record<string, Wire> = {
  overview: OVERVIEW_FIXTURE, operations: OPERATIONS_FIXTURE, trust: TRUST_FIXTURE, finance: FINANCE_FIXTURE, growth: GROWTH_FIXTURE,
  platform: PLATFORM_AREA_FIXTURE, 'data-sources': DATA_SOURCES_FIXTURE, report: REPORT_FIXTURE,
}
