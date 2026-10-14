/**
 * CA-K3-AUTH-03 (Phase B core) — the TARGET Corporate governance decision contract.
 *
 * The membership-mutation core must never infer authority. Today no persistent Corporate permission-assignment authority
 * exists (it is a later slice), so the core takes an EXPLICIT decision from a target-governance evaluator and refuses everything
 * else: a missing, malformed, stale, mis-bound, legacy-derived or unavailable decision is a denial.
 *
 *   legacy `admin` / `platform_admin` / `super_admin`            → NEVER a source (no code here reads a role)
 *   the `carup.corporate_access.v1` decision of the bridge        → NEVER a governance decision (different contract)
 *   a plain object someone typed                                  → refused: only a decision MINTED below is accepted
 *
 * The brand is a module-private WeakSet, not a security boundary: it stops a route, a test double or a copy-paste from
 * accidentally passing a hand-written object, and makes the intended producer — a future target-governance evaluator —
 * a single, greppable import (a test pins that nothing else imports `mintTargetGovernanceDecision`).
 *
 * IMPORTANT: the database re-validates the snapshot's shape, binding, freshness, scope and A1 evidence, but Phase B does not
 * yet give the database a persistent grant authority with which to authenticate who produced that snapshot. Therefore a caller
 * already holding service_role procedure access could still hand-craft a structurally valid snapshot. This Phase-B service is
 * deliberately non-routed and its evaluator returns unavailable; persistent Corporate grant authority is a required later
 * slice before any membership-mutation route may be activated.
 *
 * An ACTIVE membership grants zero capability. A governance decision is where capability comes from, and nothing else is.
 */

export const GOVERNANCE_DECISION_CONTRACT = 'carup.corporate_governance_decision.v1';
export const GOVERNANCE_DECISION_SOURCE = 'target_corporate_governance';
export const GOVERNANCE_ASSURANCE_CLASS = 'A1_RECENT_REAUTH';
export const GOVERNANCE_CAPABILITIES = Object.freeze({
  MEMBERSHIP_MANAGE: 'corporate.people.membership.manage',
  SESSION_REVOKE: 'corporate.people.session.revoke',
});
/** Must equal corporate_governance_policy() in the migration (a test pins both directions). */
export const DECISION_MAX_AGE_MS = 5 * 60 * 1000;
export const DECISION_CLOCK_SKEW_MS = 60 * 1000;
export const MIN_INDEPENDENT_GOVERNORS = 2;

export class CorporateGovernanceError extends Error {
  /**
   * @param code same vocabulary as the database (`CORPORATE_GOVERNANCE/<CODE>`), plus the service-level codes below
   * @param details.recorded true when the refusal was itself written to the request ledger (EXPIRED / STALE_PRECONDITION)
   */
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'CorporateGovernanceError';
    this.code = code;
    this.details = details;
    this.recorded = details.recorded === true;
  }
}

const MINTED = new WeakSet();

/** Frozen all the way down: a minted decision cannot be altered between the evaluator's call and the moment it is used. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonBlank = (v) => typeof v === 'string' && v.trim() !== '';
const CAPABILITY_SHAPE = /^[a-z]+(\.[a-z_]+){2,3}$/;

function parseInstant(value) {
  if (!nonBlank(value)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * The ONE producer of an acceptable decision. A target-governance evaluator calls this with what it decided; nothing else may.
 * Validates the contract-level shape only — per-call binding (actor / subject / node / freshness) is checked at use.
 */
export function mintTargetGovernanceDecision(fields) {
  if (!isPlainObject(fields)) throw new CorporateGovernanceError('DECISION_MISSING', 'A governance decision is an object.');
  if (fields.contract !== GOVERNANCE_DECISION_CONTRACT) throw new CorporateGovernanceError('DECISION_CONTRACT');
  if (fields.decision !== 'granted') throw new CorporateGovernanceError('DECISION_NOT_GRANTED');
  if (fields.source !== GOVERNANCE_DECISION_SOURCE) throw new CorporateGovernanceError('DECISION_SOURCE');
  if (!isPlainObject(fields.evaluator) || !nonBlank(fields.evaluator.name) || !nonBlank(fields.evaluator.version)) throw new CorporateGovernanceError('DECISION_EVALUATOR');
  if (parseInstant(fields.decided_at) === null) throw new CorporateGovernanceError('DECISION_MALFORMED');
  if (!nonBlank(fields.actor_user_id) || !nonBlank(fields.subject_user_id)) throw new CorporateGovernanceError('DECISION_BINDING');
  if (!Array.isArray(fields.capabilities) || fields.capabilities.length === 0 || !fields.capabilities.every((c) => typeof c === 'string' && CAPABILITY_SHAPE.test(c))) {
    throw new CorporateGovernanceError('DECISION_CAPABILITY');
  }
  const scope = fields.scope;
  if (!isPlainObject(scope) || scope.kind !== 'ORG_NODES' || !Array.isArray(scope.org_node_ids) || scope.org_node_ids.length === 0
      || !scope.org_node_ids.every((n) => nonBlank(n) && /^[A-Z][A-Z0-9_]{1,63}$/.test(n))) {
    throw new CorporateGovernanceError('DECISION_SCOPE');
  }
  if (!isPlainObject(fields.assurance) || fields.assurance.class !== GOVERNANCE_ASSURANCE_CLASS || fields.assurance.server_proven !== true) {
    throw new CorporateGovernanceError('DECISION_ASSURANCE');
  }
  const frozen = deepFreeze(JSON.parse(JSON.stringify({
    contract: fields.contract, decision: fields.decision, source: fields.source,
    evaluator: { name: fields.evaluator.name, version: fields.evaluator.version },
    decided_at: new Date(parseInstant(fields.decided_at)).toISOString(),
    actor_user_id: fields.actor_user_id, subject_user_id: fields.subject_user_id,
    capabilities: [...fields.capabilities],
    scope: { kind: 'ORG_NODES', org_node_ids: [...scope.org_node_ids] },
    assurance: { class: fields.assurance.class, server_proven: true },
    ...(fields.governance_continuity === undefined ? {} : { governance_continuity: fields.governance_continuity }),
  })));
  MINTED.add(frozen);
  return frozen;
}

export const isMintedGovernanceDecision = (value) => MINTED.has(value);

/** The wire form sent to the database: plain JSON, never the branded object itself. */
export const governanceDecisionToWire = (decision) => JSON.parse(JSON.stringify(decision));

/**
 * Is THIS decision good for THIS call? Throws CorporateGovernanceError (same codes as the database) or returns the wire snapshot.
 * Every condition is written so that anything missing or unreadable is a denial.
 */
export function assertGovernanceDecision(decision, { actorUserId, subjectUserId, orgNodeId, needSessionRevoke = false, needContinuity = false, now = Date.now() } = {}) {
  if (decision === undefined || decision === null) throw new CorporateGovernanceError('DECISION_MISSING');
  // The evaluator's own "I cannot decide" marker (see evaluateCorporateGovernanceAuthorization) is a denial of its own kind.
  if (typeof decision === 'object' && decision.available === false) throw new CorporateGovernanceError('DECISION_UNAVAILABLE');
  if (!isMintedGovernanceDecision(decision)) throw new CorporateGovernanceError('DECISION_NOT_MINTED', 'Only a decision minted by the target governance evaluator is accepted.');
  if (decision.contract !== GOVERNANCE_DECISION_CONTRACT) throw new CorporateGovernanceError('DECISION_CONTRACT');
  if (decision.decision !== 'granted') throw new CorporateGovernanceError('DECISION_NOT_GRANTED');
  if (decision.source !== GOVERNANCE_DECISION_SOURCE) throw new CorporateGovernanceError('DECISION_SOURCE');
  const decidedAt = parseInstant(decision.decided_at);
  if (decidedAt === null || decidedAt < now - DECISION_MAX_AGE_MS || decidedAt > now + DECISION_CLOCK_SKEW_MS) throw new CorporateGovernanceError('DECISION_STALE');
  if (decision.actor_user_id !== actorUserId || decision.subject_user_id !== subjectUserId) throw new CorporateGovernanceError('DECISION_BINDING');
  if (!decision.capabilities.includes(GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE)) throw new CorporateGovernanceError('DECISION_CAPABILITY');
  if (needSessionRevoke && !decision.capabilities.includes(GOVERNANCE_CAPABILITIES.SESSION_REVOKE)) throw new CorporateGovernanceError('DECISION_CAPABILITY');
  const nodes = decision.scope.org_node_ids;
  if (!nonBlank(orgNodeId) || !nodes.includes(orgNodeId) || nodes.includes('*') || nodes.includes('GLOBAL')) throw new CorporateGovernanceError('DECISION_SCOPE');
  if (decision.assurance.class !== GOVERNANCE_ASSURANCE_CLASS || decision.assurance.server_proven !== true) throw new CorporateGovernanceError('DECISION_ASSURANCE');
  if (needContinuity) {
    const k = decision.governance_continuity;
    if (!isPlainObject(k) || typeof k.subject_holds_governance_authority !== 'boolean' || !Number.isInteger(k.remaining_independent_governors) || k.remaining_independent_governors < 0) {
      throw new CorporateGovernanceError('DECISION_CONTINUITY');
    }
    if (k.subject_holds_governance_authority && k.remaining_independent_governors < MIN_INDEPENDENT_GOVERNORS) {
      throw new CorporateGovernanceError('GOVERNANCE_CONTINUITY_PROTECTION');
    }
  }
  return governanceDecisionToWire(decision);
}

/**
 * The target-governance evaluator. IT DOES NOT EXIST YET: persistent Corporate permission assignment is a later slice, and
 * deriving this decision from `users.role`, `tenant_users`, an organisation role or the legacy bridge is exactly what this contract
 * forbids. Until a real evaluator replaces this function — and is the only importer of mintTargetGovernanceDecision — every
 * governed mutation that is not handed an explicit minted decision is DENIED.
 */
export function evaluateCorporateGovernanceAuthorization() {
  return Object.freeze({ available: false, reason: 'NO_PERSISTENT_GRANT_AUTHORITY' });
}

export default {
  GOVERNANCE_DECISION_CONTRACT, GOVERNANCE_DECISION_SOURCE, GOVERNANCE_ASSURANCE_CLASS, GOVERNANCE_CAPABILITIES,
  mintTargetGovernanceDecision, isMintedGovernanceDecision, assertGovernanceDecision, evaluateCorporateGovernanceAuthorization,
};
