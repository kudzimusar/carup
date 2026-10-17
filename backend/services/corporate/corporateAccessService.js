/**
 * CA-K3-AUTH-01 → CA-CLOSE-01 (F2) — the server-side Corporate Admin access decision.
 *
 * The ONE place that decides whether a request may open the Corporate Admin workspace. The browser presents this
 * decision; it can never manufacture it.
 *
 * ADMISSION IS PERSISTENT CORPORATE AUTHORITY (CA-RBAC-01 §18 Phase 2: Corporate Admin routes consume the new Corporate
 * authority). A request is admitted only when ALL hold:
 *
 *   1. a validated SESSION proves the account (an identity asserted by the x-user-id header is never evaluated);
 *   2. the account holds an ACTIVE, effective internal Corporate membership (corporate_memberships, the Phase-A resolver);
 *   3. the trusted database evaluator (corporate_authority_evaluate, Phase C) confirms at least one persistent permission
 *      assignment of that account — read from corporate_permission_assignment_effective and confirmed capability by
 *      capability, each on its own.
 *
 * `users.role` alone confers NOTHING here: a platform administrator without a membership and a confirmed assignment is
 * refused like any other account, and a platform `owner` who holds both is admitted.
 *
 * BOUNDED LEGACY COMPATIBILITY: the ten destinations' `.read` capabilities are not yet grantable as persistent assignments
 * (corporate_authority_grantable_capabilities() holds only the two governance capabilities). So that the certified read-only
 * navigation keeps working for an ADMITTED member who is also a legacy platform administrator, the old bridge may ADD that
 * fixed read-only navigation set to an admission that persistent authority has already made. It never admits, never runs
 * before admission, never adds a governance capability, and is labelled separately in every grant (`grant.compatibility`).
 *
 * What can never produce a grant: authentication alone; an asserted identity; a tenant role or a selected / asserted
 * organisation; the x-stakeholder-role header; a job title; a membership without a confirmed assignment; a platform role.
 */
import { supabase as defaultSupabase } from '../../db/supabase.js';
import { MEMBERSHIP_STATE, resolveCorporateMembership } from './corporateMembershipService.js';
import { GOVERNANCE_CAPABILITIES, evaluateCorporateGovernanceAuthorization } from './corporateGovernanceDecision.js';

/** The legacy platform-administrator roles the bounded compatibility recognises. Nothing else. */
export const CORPORATE_COMPATIBILITY_PLATFORM_ROLES = Object.freeze(['admin', 'platform_admin', 'super_admin']);

export const CORPORATE_GRANT_SOURCE = 'persistent_corporate_authority';
export const CORPORATE_COMPATIBILITY_SOURCE = 'legacy_admin_compatibility_bridge';

export const CORPORATE_ACCESS_CONTRACT = 'carup.corporate_access.v2';

/** The persistent (governance) capabilities admission can confirm — exactly the grantable set of Phase C. */
export const CORPORATE_GOVERNANCE_CAPABILITIES = Object.freeze([
  GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE,
  GOVERNANCE_CAPABILITIES.SESSION_REVOKE,
]);

/**
 * The read-only capabilities of the ten Corporate destinations (CA-RBAC-01 §6 `<plane>.<domain>.<resource>.<action>`).
 * Kept in step with web/src/config/corporate/navigation.ts by a parity test; every one ends in `.read`.
 */
export const CORPORATE_COMPATIBILITY_READ_CAPABILITIES = Object.freeze([
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
]);

export const CORPORATE_GRANT_EXPLANATION =
  'Admitted by your active Corporate membership and your persistent Corporate permission assignments, confirmed by the '
  + 'server for this session. Governance actions still require their own recent re-authentication and approval.';
export const CORPORATE_COMPATIBILITY_EXPLANATION =
  ' Because this account is also a legacy platform administrator, the read-only Corporate navigation is added as a bounded '
  + 'compatibility measure until those read capabilities can be assigned; it never grants governance authority.';

/** Refuse to reason about an unbounded set: a truncated read could hide the one row that matters. */
const MAX_ASSIGNMENT_ROWS = 64;
const MAX_EVALUATIONS = 16;
const NODE_ID = /^[A-Z][A-Z0-9_]{1,63}$/;

const DENIAL = Object.freeze({
  unauthenticated: { status: 401, code: 'CORPORATE_SESSION_REQUIRED', error: 'Unauthorized. Corporate Admin requires an authenticated session.' },
  not_admitted: {
    status: 403,
    code: 'CORPORATE_ACCESS_DENIED',
    error: 'Forbidden. Corporate Admin requires an active Corporate membership and a persistent Corporate permission assignment.',
  },
  unavailable: { status: 503, code: 'CORPORATE_AUTHORITY_UNAVAILABLE', error: 'Corporate authority could not be confirmed right now. Nothing was granted.' },
});

function deny(kind) {
  const d = DENIAL[kind];
  return {
    allowed: false,
    status: d.status,
    body: { decision: kind === 'unavailable' ? 'unavailable' : 'denied', code: d.code, error: d.error, contract: CORPORATE_ACCESS_CONTRACT },
  };
}

/**
 * The bounded compatibility test, ALONE. It is consulted only after persistent authority has admitted the session, and
 * only to decide whether the fixed read-only navigation set is added. Reads ONLY the session method and the platform role
 * taken from `users.role` — never `effectiveRole` (which a verified tenant can lend), `tenantRole`, `activeTenant`,
 * `requestedRole` or any header.
 */
export function evaluateLegacyCompatibilityBridge(userContext) {
  if (!userContext?.id || userContext.authenticationMethod !== 'session') return false;
  const platformRole = typeof userContext.platformRole === 'string' ? userContext.platformRole.toLowerCase() : null;
  return Boolean(platformRole && CORPORATE_COMPATIBILITY_PLATFORM_ROLES.includes(platformRole));
}

/** The actor's own effective persistent assignments: ACTIVE, in window, on an ACTIVE effective membership, A1 floor. */
async function readEffectiveAssignments(client, userId, signal) {
  let query = client
    .from('corporate_permission_assignment_effective')
    .select('assignment_id, capability, scope_node_ids, include_descendants, assurance_floor, effective_from, effective_until, membership_id')
    .eq('subject_user_id', userId)
    .limit(MAX_ASSIGNMENT_ROWS + 1);
  if (signal && typeof query?.abortSignal === 'function') query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('assignment read failed');
  const rows = Array.isArray(data) ? data : [];
  if (rows.length > MAX_ASSIGNMENT_ROWS) throw new Error('assignment set too large');
  return rows;
}

/**
 * Decide from the context authorizeSessionRole established, against the persistent Corporate authority.
 *
 * @returns {Promise<{ allowed: boolean, status: number, body: object }>} — never throws; anything unreadable is a 503 that grants nothing
 */
export async function evaluateCorporateAccess(userContext, { supabaseClient = defaultSupabase, now = new Date(), signal } = {}) {
  // Defence in depth: the route already refuses the header fallback, but the evaluator does not rely on being mounted
  // correctly — an asserted identity is never Corporate authority.
  if (!userContext?.id || userContext.authenticationMethod !== 'session') return deny('unauthenticated');
  const actor = userContext.id;

  // 2 · an ACTIVE, effective Corporate membership — the Phase-A resolver, which never reads users.role.
  let membership;
  try {
    membership = await resolveCorporateMembership(supabaseClient, actor, { now, signal });
  } catch {
    return deny('unavailable');
  }
  if (!membership || membership.state === MEMBERSHIP_STATE.UNAVAILABLE || membership.state === MEMBERSHIP_STATE.NOT_EVALUATED) return deny('unavailable');
  if (membership.is_active_member !== true || !Array.isArray(membership.active_memberships) || membership.active_memberships.length === 0) {
    return deny('not_admitted');
  }

  // 3 · persistent authority: the actor's effective assignments, each (capability, scope node) confirmed by the trusted evaluator.
  let rows;
  try {
    rows = await readEffectiveAssignments(supabaseClient, actor, signal);
  } catch {
    return deny('unavailable');
  }
  const pairs = [];
  for (const row of rows) {
    const node = Array.isArray(row?.scope_node_ids) ? row.scope_node_ids[0] : null;
    if (!CORPORATE_GOVERNANCE_CAPABILITIES.includes(row?.capability) || typeof node !== 'string' || !NODE_ID.test(node)) continue;
    if (!pairs.some((p) => p.capability === row.capability && p.node === node)) pairs.push({ capability: row.capability, node });
  }
  if (pairs.length > MAX_EVALUATIONS) return deny('unavailable');

  const confirmed = [];
  for (const { capability, node } of pairs) {
    try {
      const result = await evaluateCorporateGovernanceAuthorization(supabaseClient, {
        actorUserId: actor, subjectUserId: actor, orgNodeId: node, capabilities: [capability],
      });
      const provenance = result.assignments.find((a) => a.capability === capability);
      confirmed.push({ capability, org_node_id: node, assignment_id: provenance.assignment_id });
    } catch (error) {
      if (error?.code === 'AUTHORITY_DENIED') continue; // this pair is not covered — another may be
      return deny('unavailable'); // unreadable is never an allow and never a quiet "no"
    }
  }
  if (confirmed.length === 0) return deny('not_admitted');

  const governanceCapabilities = [...new Set(confirmed.map((c) => c.capability))].sort();
  const compatibility = evaluateLegacyCompatibilityBridge(userContext);
  const confirmedIds = new Set(confirmed.map((c) => c.assignment_id));
  const assignments = rows
    .filter((r) => confirmedIds.has(r.assignment_id))
    .map((r) => ({
      assignment_id: r.assignment_id,
      capability: r.capability,
      scope_node_ids: [...r.scope_node_ids],
      include_descendants: r.include_descendants === true,
      assurance_floor: r.assurance_floor,
      effective_from: r.effective_from,
      effective_until: r.effective_until,
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability) || String(a.assignment_id).localeCompare(String(b.assignment_id)));

  return {
    allowed: true,
    status: 200,
    body: {
      contract: CORPORATE_ACCESS_CONTRACT,
      decision: 'granted',
      grant: {
        source: CORPORATE_GRANT_SOURCE,
        read_only: true,
        // Navigation (`.read`) capabilities. Persistent authority confers none of them yet; only the bounded compatibility adds them.
        capabilities: compatibility ? [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES] : [],
        governance_capabilities: governanceCapabilities,
        memberships: membership.active_memberships.map((m) => ({
          membership_id: m.membership_id, org_node_id: m.org_node_id, org_node_type: m.org_node_type,
          effective_from: m.effective_from, effective_until: m.effective_until,
        })),
        assignments,
        compatibility: compatibility
          ? { source: CORPORATE_COMPATIBILITY_SOURCE, read_only: true, bounded_by: 'admitted_corporate_member', capabilities: [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES] }
          : null,
        explanation: CORPORATE_GRANT_EXPLANATION + (compatibility ? CORPORATE_COMPATIBILITY_EXPLANATION : ''),
      },
    },
  };
}
