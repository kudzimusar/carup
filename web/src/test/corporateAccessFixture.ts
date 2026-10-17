/**
 * CA-K3-AUTH-01 → CA-CLOSE-01 — the exact bodies GET /api/corporate/access (contract v2) and GET /api/corporate/people-access
 * return (backend/services/corporate/corporateAccessService.js, corporatePeopleAccessService.js). The backend suite pins the
 * server side of these shapes against the real Corporate SQL; web tests consume them as the server's answers.
 */
const READS = Object.freeze([
  'corporate.overview.read',
  'corporate.business_unit.read',
  'corporate.finance.summary.read',
  'corporate.growth.aggregate.read',
  'corporate.customer.aggregate.read',
  'corporate.operations.queue.read',
  'corporate.operations.summary.read',
  'corporate.risk.aggregate.read',
  'corporate.metric.registry.read',
  'corporate.data.quality.read',
  'corporate.intelligence.aggregate.read',
  'corporate.people.aggregate.read',
  'corporate.people.access.read',
  'corporate.report.read',
  'platform.health.read',
  'platform.feature.read',
]) as readonly string[]
const GOVERNANCE = Object.freeze(['corporate.people.membership.manage', 'corporate.people.session.revoke']) as readonly string[]
const EXPLANATION = 'Admitted by your active Corporate membership and your persistent Corporate permission assignments, confirmed by the '
  + 'server for this session. Governance actions still require their own recent re-authentication and approval.'

/** Governor A: an ACTIVE governor who is also a legacy platform administrator — persistent grant + the bounded compatibility. */
export const SERVER_GRANT = Object.freeze({
  contract: 'carup.corporate_access.v2',
  decision: 'granted',
  grant: Object.freeze({
    source: 'persistent_corporate_authority',
    read_only: true,
    capabilities: READS,
    governance_capabilities: GOVERNANCE,
    memberships: Object.freeze([{ membership_id: '4fe98efd-df6a-40bb-81f6-9869b2764271', org_node_id: 'CARUP_CORPORATE', org_node_type: 'CORPORATE_PARENT', effective_from: '2026-10-17T08:20:02.766Z', effective_until: null }]),
    assignments: Object.freeze([]),
    compatibility: Object.freeze({ source: 'legacy_admin_compatibility_bridge', read_only: true, bounded_by: 'admitted_corporate_member', capabilities: READS }),
    explanation: `${EXPLANATION} Because this account is also a legacy platform administrator, the read-only Corporate navigation is added as a `
      + 'bounded compatibility measure until those read capabilities can be assigned; it never grants governance authority.',
  }),
})

/** Governor B: an ACTIVE governor whose platform role is `owner` — persistent grant alone, no navigation reads. */
export const OWNER_GOVERNOR_GRANT = Object.freeze({
  contract: 'carup.corporate_access.v2',
  decision: 'granted',
  grant: Object.freeze({
    source: 'persistent_corporate_authority',
    read_only: true,
    capabilities: Object.freeze([]) as readonly string[],
    governance_capabilities: GOVERNANCE,
    memberships: Object.freeze([{ membership_id: '82726780-cf3b-4502-beb1-91f604e84453', org_node_id: 'CARUP_CORPORATE', org_node_type: 'CORPORATE_PARENT', effective_from: '2026-10-17T08:20:02.766Z', effective_until: null }]),
    assignments: Object.freeze([]),
    compatibility: null,
    explanation: EXPLANATION,
  }),
})

export const SERVER_DENIAL = Object.freeze({
  decision: 'denied',
  code: 'CORPORATE_ACCESS_DENIED',
  error: 'Forbidden. Corporate Admin requires an active Corporate membership and a persistent Corporate permission assignment.',
  contract: 'carup.corporate_access.v2',
})

const ROOT = Object.freeze({ node_id: 'CARUP_CORPORATE', display_name: 'CarUp Corporate', entity_type: 'CORPORATE_PARENT' })
const govA = Object.freeze({ user_id: 'u_dec3e5f914f34c53', name: 'Governor A', email: 'governor-a@example.invalid' })
const govB = Object.freeze({ user_id: 'u_66cace85fad949e4', name: 'Governor B', email: 'governor-b@example.invalid' })
const assignment = (id: string, subject: typeof govA, other: typeof govA, capability: string, membership: string) => ({
  assignment_id: id, membership_id: membership, subject, capability, scope: [ROOT], include_descendants: true, assurance_floor: 'A1_RECENT_REAUTH',
  state: 'ACTIVE', effective_now: true, effective_from: '2026-10-17T08:20:02.766Z', effective_until: '2027-10-17T08:20:02.766Z',
  requested_by: subject, approved_by: other, activated_by: other, reference: 'CA-BOOTSTRAP-01',
})

/** The People & Access projection for a governor over the whole tree: the two governors, two capabilities each. */
export const PEOPLE_ACCESS_PROJECTION = Object.freeze({
  contract: 'carup.corporate_people_access.v1',
  decision: 'granted',
  source: 'persistent_corporate_authority',
  read_only: true,
  generated_at: '2026-10-17T10:00:00.000Z',
  basis: { capability: 'corporate.people.membership.manage', governed_nodes: [ROOT] },
  counts: { memberships: 2, assignments: 4 },
  memberships: [
    { membership_id: '4fe98efd-df6a-40bb-81f6-9869b2764271', subject: govA, org_node: ROOT, state: 'ACTIVE', effective_from: '2026-10-17T08:20:02.766Z', effective_until: null, created_by: govB, created_reason: 'OD-CARBAC-002 Owner-authorized initial Corporate governance bootstrap', created_reference: 'CA-BOOTSTRAP-01' },
    { membership_id: '82726780-cf3b-4502-beb1-91f604e84453', subject: govB, org_node: ROOT, state: 'ACTIVE', effective_from: '2026-10-17T08:20:02.766Z', effective_until: null, created_by: govA, created_reason: 'OD-CARBAC-002 Owner-authorized initial Corporate governance bootstrap', created_reference: 'CA-BOOTSTRAP-01' },
  ],
  assignments: [
    assignment('5445781b-684c-4e68-9e6a-0b79d5970243', govA, govB, 'corporate.people.membership.manage', '4fe98efd-df6a-40bb-81f6-9869b2764271'),
    assignment('414d25c0-8459-4def-99bd-08b6ef625e33', govA, govB, 'corporate.people.session.revoke', '4fe98efd-df6a-40bb-81f6-9869b2764271'),
    assignment('cf8ca31c-f175-43b8-a221-2dc4b1d41ed3', govB, govA, 'corporate.people.membership.manage', '82726780-cf3b-4502-beb1-91f604e84453'),
    assignment('71f220a2-8be4-4eb3-8adc-c9b477dce242', govB, govA, 'corporate.people.session.revoke', '82726780-cf3b-4502-beb1-91f604e84453'),
  ],
})
