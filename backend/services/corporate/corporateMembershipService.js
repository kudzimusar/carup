/**
 * CA-K3-AUTH-02 (Phase A) — the READ-ONLY internal Corporate membership resolver.
 *
 * Answers one question about a server-proven `users.id`: "does this account hold a valid internal Corporate
 * membership right now, and of which internal organisational node?" It does NOT answer what the person may
 * do. An ACTIVE membership grants ZERO Corporate capability by itself — it is only a prerequisite for a
 * future, separate permission assignment — so every result carries an empty, frozen capability list and
 * nothing in this module can produce a navigation destination, route admission or action.
 *
 * Authority is read ONLY from corporate_memberships ⨝ corporate_org_nodes. It never looks at users.role,
 * user_sessions, tenants, tenant_users, the legacy organizations / organization_users, any request header,
 * any job title, any client-selected context, or the legacy_admin_compatibility_bridge. The caller supplies
 * the subject; the shadow wrapper only ever supplies a session-proven one.
 *
 * Fail closed: any doubt resolves to "not an active member". A failed read is UNAVAILABLE — never reported
 * as NO_MEMBERSHIP, because "we could not look" is not "you do not belong".
 */

/** Stored lifecycle states (the database CHECK is the same list). */
export const CORPORATE_MEMBERSHIP_STORED_STATES = Object.freeze(['PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED']);

/** Accepted internal node taxonomy (CA-ORG-01). The type being listed asserts no such node exists. */
export const CORPORATE_ORG_NODE_TYPES = Object.freeze([
  'CORPORATE_PARENT', 'LEGAL_ENTITY', 'SUBSIDIARY', 'BUSINESS_UNIT', 'CORPORATE_FUNCTION', 'DEPARTMENT', 'TEAM',
]);

/** What a membership resolves to NOW. Only ACTIVE is an active membership. */
export const MEMBERSHIP_STATE = Object.freeze({
  NO_MEMBERSHIP: 'NO_MEMBERSHIP',
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ENDED: 'ENDED',
  NOT_YET_EFFECTIVE: 'NOT_YET_EFFECTIVE',
  EXPIRED: 'EXPIRED',
  ORG_NODE_UNRESOLVED: 'ORG_NODE_UNRESOLVED',
  /** The subject or the clock could not be evaluated, so nothing was looked up. */
  NOT_EVALUATED: 'NOT_EVALUATED',
  /** A read failed. Never "not a member". */
  UNAVAILABLE: 'UNAVAILABLE',
});

export const CORPORATE_MEMBERSHIP_STATE_CONTRACT = 'carup.corporate_membership_state.v1';

/** Descriptive order used only to NAME the overall state when no row is ACTIVE. Never an authority order. */
const INACTIVE_PRECEDENCE = Object.freeze([
  MEMBERSHIP_STATE.NOT_YET_EFFECTIVE,
  MEMBERSHIP_STATE.PENDING,
  MEMBERSHIP_STATE.SUSPENDED,
  MEMBERSHIP_STATE.EXPIRED,
  MEMBERSHIP_STATE.ENDED,
  MEMBERSHIP_STATE.ORG_NODE_UNRESOLVED,
]);

/** A membership grants no capability. Frozen so it cannot become a place to add one. */
const NO_CAPABILITIES = Object.freeze([]);

/** Refuse to reason about an unbounded set of rows: a truncated read could hide the one that matters. */
const MAX_ROWS = 500;
const MAX_SUBJECT_LENGTH = 128;

function toDate(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date; // undefined = present but unreadable
}

function result(state, extra = {}) {
  return {
    contract: CORPORATE_MEMBERSHIP_STATE_CONTRACT,
    state,
    is_active_member: state === MEMBERSHIP_STATE.ACTIVE,
    active_memberships: [],
    considered: [],
    // ACTIVE membership alone grants ZERO Corporate capability. This is a fact of the contract, not a default.
    capabilities: NO_CAPABILITIES,
    grants_capability: false,
    ...extra,
  };
}

/**
 * Resolve ONE stored membership row against `now`. Pure and deterministic.
 * The stored state wins: a PENDING / SUSPENDED / ENDED row is never rescued by its dates. Only a stored
 * ACTIVE row is then checked against its window — starting inclusive, ending exclusive.
 */
export function classifyMembershipRow(row, now) {
  if (!row || typeof row !== 'object') return MEMBERSHIP_STATE.NOT_EVALUATED;
  const nowTime = now instanceof Date ? now.getTime() : NaN;
  if (Number.isNaN(nowTime)) return MEMBERSHIP_STATE.NOT_EVALUATED;

  switch (row.state) {
    case 'PENDING': return MEMBERSHIP_STATE.PENDING;
    case 'SUSPENDED': return MEMBERSHIP_STATE.SUSPENDED;
    case 'ENDED': return MEMBERSHIP_STATE.ENDED;
    case 'ACTIVE': break;
    default: return MEMBERSHIP_STATE.NOT_EVALUATED; // an unrecognised stored state is never active
  }

  const from = toDate(row.effective_from);
  const until = toDate(row.effective_until);
  if (!from || until === undefined) return MEMBERSHIP_STATE.NOT_EVALUATED; // no/unreadable start, unreadable end
  if (nowTime < from.getTime()) return MEMBERSHIP_STATE.NOT_YET_EFFECTIVE;
  if (until && nowTime >= until.getTime()) return MEMBERSHIP_STATE.EXPIRED;
  return MEMBERSHIP_STATE.ACTIVE;
}

/**
 * @param supabaseClient the service-role client (the table is closed to every client role)
 * @param userId a SERVER-PROVEN users.id — never a header, never client input
 * @param opts.now injected clock (defaults to the wall clock)
 */
export async function resolveCorporateMembership(supabaseClient, userId, { now = new Date() } = {}) {
  const evaluatedAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : null;
  const base = { evaluated_at: evaluatedAt, subject_user_id: null };

  if (typeof userId !== 'string' || !userId.trim() || userId.length > MAX_SUBJECT_LENGTH) {
    return result(MEMBERSHIP_STATE.NOT_EVALUATED, { ...base, reason: 'invalid_subject' });
  }
  if (!evaluatedAt) return result(MEMBERSHIP_STATE.NOT_EVALUATED, { ...base, subject_user_id: userId, reason: 'invalid_clock' });
  base.subject_user_id = userId;

  let rows;
  try {
    const { data, error } = await supabaseClient
      .from('corporate_memberships')
      .select('membership_id, org_node_id, state, effective_from, effective_until')
      .eq('user_id', userId);
    if (error) return result(MEMBERSHIP_STATE.UNAVAILABLE, { ...base, reason: 'membership_read_failed' });
    rows = Array.isArray(data) ? data : [];
  } catch {
    return result(MEMBERSHIP_STATE.UNAVAILABLE, { ...base, reason: 'membership_read_failed' });
  }
  if (rows.length >= MAX_ROWS) return result(MEMBERSHIP_STATE.UNAVAILABLE, { ...base, reason: 'membership_set_too_large' });
  if (rows.length === 0) return result(MEMBERSHIP_STATE.NO_MEMBERSHIP, base);

  // The node each membership belongs to. A membership that cannot be tied to an accepted node is not active.
  const nodeIds = [...new Set(rows.map((r) => r.org_node_id).filter((id) => typeof id === 'string'))];
  const nodes = new Map();
  if (nodeIds.length > 0) {
    try {
      const { data, error } = await supabaseClient
        .from('corporate_org_nodes')
        .select('node_id, entity_type')
        .in('node_id', nodeIds);
      if (error) return result(MEMBERSHIP_STATE.UNAVAILABLE, { ...base, reason: 'org_node_read_failed' });
      for (const node of Array.isArray(data) ? data : []) {
        if (CORPORATE_ORG_NODE_TYPES.includes(node.entity_type)) nodes.set(node.node_id, node.entity_type);
      }
    } catch {
      return result(MEMBERSHIP_STATE.UNAVAILABLE, { ...base, reason: 'org_node_read_failed' });
    }
  }

  const considered = [];
  const active = [];
  for (const row of rows) {
    let resolved = classifyMembershipRow(row, now);
    if (resolved === MEMBERSHIP_STATE.ACTIVE && !nodes.has(row.org_node_id)) resolved = MEMBERSHIP_STATE.ORG_NODE_UNRESOLVED;
    considered.push({ membership_id: row.membership_id, org_node_id: row.org_node_id, stored_state: row.state, resolved_state: resolved });
    if (resolved === MEMBERSHIP_STATE.ACTIVE) {
      active.push({
        membership_id: row.membership_id,
        org_node_id: row.org_node_id,
        org_node_type: nodes.get(row.org_node_id),
        effective_from: toDate(row.effective_from).toISOString(),
        effective_until: toDate(row.effective_until)?.toISOString() ?? null,
      });
    }
  }
  considered.sort((a, b) => String(a.membership_id).localeCompare(String(b.membership_id)));
  active.sort((a, b) => a.org_node_id.localeCompare(b.org_node_id) || String(a.membership_id).localeCompare(String(b.membership_id)));

  if (active.length > 0) return result(MEMBERSHIP_STATE.ACTIVE, { ...base, active_memberships: active, considered });
  const named = INACTIVE_PRECEDENCE.find((s) => considered.some((c) => c.resolved_state === s)) ?? MEMBERSHIP_STATE.NOT_EVALUATED;
  return result(named, { ...base, considered });
}
