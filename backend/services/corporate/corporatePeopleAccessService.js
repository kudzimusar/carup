/**
 * CA-CLOSE-01 (F1) — the READ-ONLY Corporate People & Access projection.
 *
 * Answers "who holds Corporate membership and which persistent permission assignments, where, and until when" from the
 * AUTHORITATIVE Corporate tables only (corporate_memberships, corporate_org_nodes, corporate_permission_assignments and the
 * effective view), for an actor already admitted by evaluateCorporateAccess.
 *
 * Who may see which rows is decided by the TRUSTED database evaluator: a membership (and the assignments that rest on it) is
 * visible only when corporate_authority_evaluate confirms that the actor holds `corporate.people.membership.manage` over that
 * membership's organisation node. Nothing else widens it — not a platform role, not the legacy compatibility navigation, not
 * a tenant role, not a header. An actor who holds no such authority anywhere is refused (403); anything unreadable is a 503
 * that shows nothing.
 *
 * It writes nothing, creates no role editor and invents nothing: every value shown is a stored fact (no title, no synthetic
 * permission). It carries no secret: no password hash, no session, no token, no request body.
 */
import { CORPORATE_ORG_NODE_TYPES, MEMBERSHIP_STATE, classifyMembershipRow } from './corporateMembershipService.js';
import { GOVERNANCE_CAPABILITIES, evaluateCorporateGovernanceAuthorization } from './corporateGovernanceDecision.js';

export const PEOPLE_ACCESS_CONTRACT = 'carup.corporate_people_access.v1';
export const PEOPLE_ACCESS_SOURCE = 'persistent_corporate_authority';
export const PEOPLE_ACCESS_BASIS_CAPABILITY = GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE;

const MAX_ROWS = 500;
const MAX_NODES = 200;
const MAX_NODE_EVALUATIONS = 32;

const DENIAL = Object.freeze({
  not_authorized: {
    status: 403,
    code: 'CORPORATE_PEOPLE_ACCESS_DENIED',
    error: 'Forbidden. Viewing Corporate memberships requires a persistent corporate.people.membership.manage assignment.',
  },
  unavailable: { status: 503, code: 'CORPORATE_PEOPLE_ACCESS_UNAVAILABLE', error: 'The Corporate access record could not be read right now. Nothing is shown.' },
});

function refuse(kind) {
  const d = DENIAL[kind];
  return { status: d.status, body: { contract: PEOPLE_ACCESS_CONTRACT, decision: kind === 'unavailable' ? 'unavailable' : 'denied', code: d.code, error: d.error } };
}

async function read(query, signal) {
  const q = signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query;
  const { data, error } = await q;
  if (error) throw new Error('read failed');
  return Array.isArray(data) ? data : [];
}

const iso = (v) => {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * @param client the service-role client (the Corporate tables are closed to every client role)
 * @param opts.actorUserId a SERVER-PROVEN users.id of an admitted actor — never a header, never client input
 * @returns {Promise<{ status: number, body: object }>} — never throws
 */
export async function projectCorporatePeopleAccess(client, { actorUserId, now = new Date(), signal } = {}) {
  if (typeof actorUserId !== 'string' || !actorUserId.trim()) return refuse('not_authorized');
  try {
    // ── The stored facts ────────────────────────────────────────────────────────────────────────────────────────
    const stored = await read(client
      .from('corporate_memberships')
      .select('membership_id, user_id, org_node_id, state, effective_from, effective_until, created_by_kind, created_by_user_id, created_reason, created_reference')
      .eq('state', 'ACTIVE')
      .limit(MAX_ROWS + 1), signal);
    if (stored.length > MAX_ROWS) return refuse('unavailable');
    const nodeRows = await read(client.from('corporate_org_nodes').select('node_id, display_name, entity_type, parent_node_id').limit(MAX_NODES + 1), signal);
    if (nodeRows.length > MAX_NODES) return refuse('unavailable');
    const nodes = new Map(nodeRows.filter((n) => CORPORATE_ORG_NODE_TYPES.includes(n.entity_type)).map((n) => [n.node_id, n]));

    // ACTIVE in state AND inside the effective window, on an accepted node.
    const active = stored.filter((m) => classifyMembershipRow(m, now) === MEMBERSHIP_STATE.ACTIVE && nodes.has(m.org_node_id));

    // ── Which nodes the actor governs: the trusted evaluator, one node at a time ───────────────────────────────────
    const distinctNodes = [...new Set(active.map((m) => m.org_node_id))].sort();
    if (distinctNodes.length > MAX_NODE_EVALUATIONS) return refuse('unavailable');
    const covered = new Map();
    for (const node of distinctNodes) {
      try {
        const result = await evaluateCorporateGovernanceAuthorization(client, {
          actorUserId, subjectUserId: actorUserId, orgNodeId: node, capabilities: [PEOPLE_ACCESS_BASIS_CAPABILITY],
        });
        covered.set(node, result.assignments.find((a) => a.capability === PEOPLE_ACCESS_BASIS_CAPABILITY)?.assignment_id ?? null);
      } catch (error) {
        if (error?.code === 'AUTHORITY_DENIED') continue;
        return refuse('unavailable');
      }
    }
    if (covered.size === 0) return refuse('not_authorized');

    const memberships = active.filter((m) => covered.has(m.org_node_id));
    const membershipIds = memberships.map((m) => m.membership_id);

    // ── The ACTIVE assignments resting on those memberships, and which of them are effective right now ──────────────
    const assignmentRows = membershipIds.length === 0 ? [] : await read(client
      .from('corporate_permission_assignments')
      .select('assignment_id, subject_user_id, membership_id, capability, scope_node_ids, include_descendants, effective_from, effective_until, assurance_floor, state, requested_by_user_id, approved_by_user_id, activated_by_user_id, request_reference')
      .eq('state', 'ACTIVE')
      .in('membership_id', membershipIds)
      .limit(MAX_ROWS + 1), signal);
    if (assignmentRows.length > MAX_ROWS) return refuse('unavailable');
    const effectiveIds = new Set(assignmentRows.length === 0 ? [] : (await read(client
      .from('corporate_permission_assignment_effective')
      .select('assignment_id')
      .in('assignment_id', assignmentRows.map((a) => a.assignment_id))
      .limit(MAX_ROWS + 1), signal)).map((r) => r.assignment_id));

    // ── Identities: display name and e-mail of the subjects and of the people named in the lineage ─────────────────
    const people = new Set();
    for (const m of memberships) { people.add(m.user_id); if (m.created_by_user_id) people.add(m.created_by_user_id); }
    for (const a of assignmentRows) for (const id of [a.subject_user_id, a.requested_by_user_id, a.approved_by_user_id, a.activated_by_user_id]) if (id) people.add(id);
    const userRows = people.size === 0 ? [] : await read(client.from('users').select('id, name, email').in('id', [...people]).limit(MAX_ROWS + 1), signal);
    const users = new Map(userRows.map((u) => [u.id, u]));
    const person = (id) => (id ? { user_id: id, name: users.get(id)?.name ?? null, email: users.get(id)?.email ?? null } : null);
    const node = (id) => { const n = nodes.get(id); return n ? { node_id: n.node_id, display_name: n.display_name, entity_type: n.entity_type } : { node_id: id, display_name: null, entity_type: null }; };

    const membershipOut = memberships
      .map((m) => ({
        membership_id: m.membership_id,
        subject: person(m.user_id),
        org_node: node(m.org_node_id),
        state: m.state,
        effective_from: iso(m.effective_from),
        effective_until: iso(m.effective_until),
        created_by: m.created_by_kind === 'USER' ? person(m.created_by_user_id) : { user_id: null, name: 'SYSTEM', email: null },
        created_reason: m.created_reason,
        created_reference: m.created_reference ?? null,
      }))
      .sort((a, b) => a.org_node.node_id.localeCompare(b.org_node.node_id) || String(a.subject.email ?? a.subject.user_id).localeCompare(String(b.subject.email ?? b.subject.user_id)));

    const assignmentOut = assignmentRows
      .map((a) => ({
        assignment_id: a.assignment_id,
        membership_id: a.membership_id,
        subject: person(a.subject_user_id),
        capability: a.capability,
        scope: (Array.isArray(a.scope_node_ids) ? a.scope_node_ids : []).map(node),
        include_descendants: a.include_descendants === true,
        assurance_floor: a.assurance_floor,
        state: a.state,
        effective_now: effectiveIds.has(a.assignment_id),
        effective_from: iso(a.effective_from),
        effective_until: iso(a.effective_until),
        requested_by: person(a.requested_by_user_id),
        approved_by: person(a.approved_by_user_id),
        activated_by: person(a.activated_by_user_id),
        reference: a.request_reference ?? null,
      }))
      .sort((a, b) => String(a.subject.email ?? a.subject.user_id).localeCompare(String(b.subject.email ?? b.subject.user_id)) || a.capability.localeCompare(b.capability));

    return {
      status: 200,
      body: {
        contract: PEOPLE_ACCESS_CONTRACT,
        decision: 'granted',
        source: PEOPLE_ACCESS_SOURCE,
        read_only: true,
        generated_at: iso(now),
        basis: { capability: PEOPLE_ACCESS_BASIS_CAPABILITY, governed_nodes: [...covered.keys()].map(node) },
        counts: { memberships: membershipOut.length, assignments: assignmentOut.length },
        memberships: membershipOut,
        assignments: assignmentOut,
      },
    };
  } catch {
    return refuse('unavailable');
  }
}
