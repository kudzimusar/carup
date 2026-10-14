/**
 * CA-K3-AUTH-04 (Phase C) — the TRUSTED target-governance evaluator.
 *
 * Phase B took an explicit decision from a caller and refused everything else; it could validate that decision's SHAPE but could not
 * authenticate who produced it, so a holder of service_role could hand-craft a valid one (CERT-03 proved and bounded this). Phase C
 * removes the thing that could be forged: there is no decision a caller can supply any more — not here, and not at the database.
 *
 * Authority is DERIVED, by the database, from persistent Corporate permission assignments (corporate_permission_assignments):
 *
 *   an ACTIVE assignment · inside its effective period · whose scope covers the exact organisation node · resting on an ACTIVE, effective
 *   membership of the SAME account · whose assurance floor this platform can satisfy · for EACH required capability, on its own.
 *
 * Nothing else is an input: not `admin` / `platform_admin` / `super_admin`, not a tenant or organisation role, not a title, not the
 * `carup.corporate_access.v1` bridge decision, not navigation, not an object someone typed. An ACTIVE membership alone authorizes nothing.
 * Grants are never combined: a broad scope on one grant and a broad capability on another do not make a broader authority than any single
 * approved grant intended.
 *
 * This module is a CLIENT of that evaluator, not a second one:
 *  - `evaluateCorporateGovernanceAuthorization` calls the read-only database evaluator (`corporate_authority_evaluate`), validates that what
 *    came back is exactly what was asked for, and returns a frozen result — or throws. It is used to refuse EARLY (before the one side
 *    effect that happens outside the database: session revocation). It is never an input to a mutation.
 *  - every mutation goes through a database entry point that evaluates the same authority AGAIN, itself, inside the transaction, with the
 *    rows locked, and hands the result to the Phase-B procedures. The Phase-B ledgers therefore record a decision (with the assignment ids
 *    relied on) that the database generated from verified authority — never one a caller carried in.
 *
 * Residual trust, stated plainly: the database proves the NAMED account holds the authority and a live A1 session row. Which human is behind
 * that account is established by the backend's session authentication. A holder of service_role can act as an account that holds authority
 * and has a live A1 session — it can no longer manufacture authority.
 *
 * An ACTIVE membership grants zero capability. A persistent assignment is where Corporate capability comes from, and nothing else is.
 */

export const GOVERNANCE_DECISION_CONTRACT = 'carup.corporate_governance_decision.v1';
export const GOVERNANCE_DECISION_SOURCE = 'target_corporate_governance';
export const GOVERNANCE_ASSURANCE_CLASS = 'A1_RECENT_REAUTH';
export const GOVERNANCE_CAPABILITIES = Object.freeze({
  MEMBERSHIP_MANAGE: 'corporate.people.membership.manage',
  SESSION_REVOKE: 'corporate.people.session.revoke',
});
export const AUTHORITY_EVALUATOR_RPC = 'corporate_authority_evaluate';
export const AUTHORITY_EVALUATOR_NAME = 'corporate_authority_evaluate';
/** Must equal corporate_governance_policy() in the Phase-B migration (a test pins both directions). */
export const MIN_INDEPENDENT_GOVERNORS = 2;

/** Every reason the database evaluator can give for a denial; anything else is treated as an unreadable answer. */
export const AUTHORITY_DENIAL_REASONS = Object.freeze([
  'INPUT_INVALID', 'CAPABILITY_NOT_EVALUABLE', 'NO_ASSIGNMENT',
  'STATE_REQUESTED', 'STATE_APPROVED', 'STATE_SUSPENDED', 'STATE_REVOKED', 'STATE_EXPIRED',
  'OUT_OF_WINDOW', 'OUT_OF_SCOPE', 'MEMBERSHIP_NOT_EFFECTIVE', 'ASSURANCE_FLOOR_UNMET',
  'CONTINUITY_TARGET_REQUIRED', 'CONTINUITY_UNREADABLE',
]);

export class CorporateGovernanceError extends Error {
  /**
   * @param code same vocabulary as the database (`CORPORATE_GOVERNANCE/<CODE>`), plus the service-level codes
   * @param details.recorded true when the refusal was itself written to the request ledger (EXPIRED / STALE_PRECONDITION)
   * @param details.denials  for AUTHORITY_DENIED: [{ capability, reason, assignment_id }] — which capability failed and why
   */
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'CorporateGovernanceError';
    this.code = code;
    this.details = details;
    this.recorded = details.recorded === true;
  }
}

/** Frozen all the way down: an evaluation result cannot be altered between the evaluator's answer and the moment it is used. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonBlank = (v) => typeof v === 'string' && v.trim() !== '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_ID = /^[A-Z][A-Z0-9_]{1,63}$/;

const unavailable = (cause) => new CorporateGovernanceError('GOVERNANCE_UNAVAILABLE', 'The governance authority could not be read.', { source: 'database', cause });

const normaliseDenials = (list) => (Array.isArray(list) ? list.filter(isPlainObject).map((d) => ({
  capability: d.capability ?? null, reason: AUTHORITY_DENIAL_REASONS.includes(d.reason) ? d.reason : 'UNKNOWN', assignment_id: d.assignment_id ?? null })) : []);

/** Parse the DETAIL of an AUTHORITY_DENIED raised by a database entry point (`[{capability, reason, assignment_id}]`). */
export function parseAuthorityDenials(detail) {
  if (typeof detail !== 'string' || detail.trim() === '') return [];
  try { return normaliseDenials(JSON.parse(detail)); } catch { return []; }
}

/**
 * Ask the database who holds the authority, now. Throws CorporateGovernanceError unless every requested capability is covered, each on its
 * own, for exactly this actor and node:
 *   AUTHORITY_DENIED                  — a capability is not covered (details.denials says which, and why)
 *   GOVERNANCE_CONTINUITY_PROTECTION  — (END) the subject carries governance and fewer than two independent governors would remain
 *   GOVERNANCE_UNAVAILABLE            — the store could not be read, or answered with anything other than what was asked: a denial, never an allow
 *
 * @param client the service-role client
 * @returns a frozen { granted: true, decision, assignments, governance_continuity } — informational: no mutation accepts it as an input
 */
export async function evaluateCorporateGovernanceAuthorization(client, { actorUserId, subjectUserId, orgNodeId, capabilities, needContinuity = false, targetMembershipId = null } = {}) {
  if (!client || typeof client.rpc !== 'function') throw unavailable('no client');
  if (!nonBlank(actorUserId)) throw new CorporateGovernanceError('ACTOR_REQUIRED');
  if (!nonBlank(subjectUserId)) throw new CorporateGovernanceError('SUBJECT_REQUIRED');
  if (!nonBlank(orgNodeId) || !NODE_ID.test(orgNodeId)) throw new CorporateGovernanceError('NODE_UNKNOWN');
  const wanted = Array.isArray(capabilities) ? [...new Set(capabilities)] : [];
  if (wanted.length === 0 || !wanted.every((c) => Object.values(GOVERNANCE_CAPABILITIES).includes(c))) {
    throw new CorporateGovernanceError('AUTHORITY_DENIED', 'Only the governance capabilities are evaluable.', { denials: [{ capability: null, reason: 'CAPABILITY_NOT_EVALUABLE', assignment_id: null }] });
  }
  if (needContinuity && !(typeof targetMembershipId === 'string' && UUID.test(targetMembershipId))) {
    throw new CorporateGovernanceError('AUTHORITY_DENIED', 'A continuity check needs the target membership.', { denials: [{ capability: GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE, reason: 'CONTINUITY_TARGET_REQUIRED', assignment_id: null }] });
  }

  let response;
  try {
    response = await client.rpc(AUTHORITY_EVALUATOR_RPC, {
      p_actor_user_id: actorUserId, p_subject_user_id: subjectUserId, p_org_node_id: orgNodeId, p_capabilities: wanted,
      p_need_continuity: needContinuity === true, p_target_membership_id: needContinuity === true ? targetMembershipId.toLowerCase() : null,
    });
  } catch (error) {
    throw unavailable(String(error?.message ?? error).slice(0, 200));
  }
  if (response?.error) throw unavailable(String(response.error?.message ?? 'rpc error').slice(0, 200));
  const answer = response?.data;
  if (!isPlainObject(answer) || (answer.decision !== 'granted' && answer.decision !== 'denied')) throw unavailable('unreadable evaluator answer');

  if (answer.decision === 'denied') {
    throw new CorporateGovernanceError('AUTHORITY_DENIED', 'No persistent assignment authorizes this.', { denials: normaliseDenials(answer.denials), source: 'database' });
  }

  // A grant is accepted only if it is EXACTLY the answer to the question that was asked. Any divergence is an unreadable answer.
  const assignments = answer.provenance?.assignments;
  const sound = answer.contract === GOVERNANCE_DECISION_CONTRACT && answer.source === GOVERNANCE_DECISION_SOURCE
    && isPlainObject(answer.evaluator) && answer.evaluator.name === AUTHORITY_EVALUATOR_NAME
    && answer.actor_user_id === actorUserId && answer.subject_user_id === subjectUserId
    && Array.isArray(answer.capabilities) && answer.capabilities.length === wanted.length && wanted.every((c) => answer.capabilities.includes(c))
    && isPlainObject(answer.scope) && answer.scope.kind === 'ORG_NODES' && Array.isArray(answer.scope.org_node_ids)
    && answer.scope.org_node_ids.length === 1 && answer.scope.org_node_ids[0] === orgNodeId
    && isPlainObject(answer.assurance) && answer.assurance.class === GOVERNANCE_ASSURANCE_CLASS && answer.assurance.server_proven === true
    && isPlainObject(answer.provenance) && answer.provenance.derivation === 'persistent_assignments'
    && Array.isArray(assignments) && assignments.length === wanted.length
    && wanted.every((c) => assignments.filter((a) => isPlainObject(a) && a.capability === c && typeof a.assignment_id === 'string' && UUID.test(a.assignment_id)).length === 1);
  if (!sound) throw unavailable('the evaluator answered something other than what was asked');

  let continuity = null;
  if (needContinuity) {
    const k = answer.governance_continuity;
    if (!isPlainObject(k) || typeof k.subject_holds_governance_authority !== 'boolean' || !Number.isInteger(k.remaining_independent_governors) || k.remaining_independent_governors < 0) {
      throw unavailable('unreadable continuity');
    }
    if (k.subject_holds_governance_authority && k.remaining_independent_governors < MIN_INDEPENDENT_GOVERNORS) {
      throw new CorporateGovernanceError('GOVERNANCE_CONTINUITY_PROTECTION', 'Fewer than two independent governors would remain.', { source: 'database', remaining_independent_governors: k.remaining_independent_governors });
    }
    continuity = { subject_holds_governance_authority: k.subject_holds_governance_authority, remaining_independent_governors: k.remaining_independent_governors };
  }
  return deepFreeze(JSON.parse(JSON.stringify({ granted: true, decision: answer, assignments, governance_continuity: continuity })));
}

/**
 * Names that would mean a caller is trying to hand this layer an AUTHORITY instead of earning one from persistent assignments: a governance
 * decision, a snapshot, capabilities, a grant, a permission, a scope, a role, an assignment. Refused, never ignored — the same discipline the
 * service applies to a client-asserted assurance. (`governanceDecision` / `governance_decision` is exactly the field Phase B accepted, and is gone;
 * the checker's `decision: 'APPROVE' | 'REFUSE'` is a different thing and is parsed explicitly by the service.)
 */
export const CLIENT_AUTHORITY_KEY = /^governance_?decision$|snapshot|^authority$|capabilit|^grants?$|permission|^scope$|^roles?$|entitle|assignment|provenance|^evaluator$|^source$/i;
export function assertNoClientAssertedAuthority(object, where = 'input') {
  if (object === null || typeof object !== 'object') return;
  for (const key of Object.keys(object)) {
    if (CLIENT_AUTHORITY_KEY.test(key)) {
      throw new CorporateGovernanceError('AUTHORITY_CLIENT_ASSERTED', `${where}.${key} may not carry authority; authority is derived by the database from persistent assignments.`);
    }
  }
}

export default {
  GOVERNANCE_DECISION_CONTRACT, GOVERNANCE_DECISION_SOURCE, GOVERNANCE_ASSURANCE_CLASS, GOVERNANCE_CAPABILITIES, MIN_INDEPENDENT_GOVERNORS,
  AUTHORITY_DENIAL_REASONS, evaluateCorporateGovernanceAuthorization, assertNoClientAssertedAuthority, parseAuthorityDenials,
};
