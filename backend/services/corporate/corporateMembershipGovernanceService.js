/**
 * CA-K3-AUTH-03 (Phase B core) — the Corporate membership MUTATION core. Internal, non-routed, no public endpoint.
 *
 *   PENDING ──(maker request + independent checker approval + execute)──▶ ACTIVE ──(one admin)──▶ SUSPENDED
 *      │                                                                     ▲                       │
 *      │                                                                     └──(maker/checker)──────┘
 *      └────────────(one admin, continuity-protected)────▶ ENDED ◀───────────────────────────────────┘
 *
 * What this module is — and is not:
 *  - It is the ONLY code path that writes Corporate membership state, and it writes nothing itself: every mutation is one of five
 *    narrow SECURITY DEFINER database entry points (service_role has SELECT and EXECUTE, never INSERT/UPDATE/DELETE on any Corporate
 *    table, and no EXECUTE at all on the Phase-B snapshot-taking procedures any more). The entry points re-prove every control below
 *    inside the transaction; the checks here only refuse EARLIER — before an I/O round trip and, crucially, before the one side effect
 *    that happens outside the database (session revocation).
 *  - It never decides who may govern, and it never accepts anyone's word for it. There is NO decision input: authority is derived by the
 *    database from persistent Corporate permission assignments (corporateGovernanceDecision.js asks the database's evaluator; each entry
 *    point evaluates again, itself, inside the transaction). A `governanceDecision`, `capabilities`, `role`, `grant` or `scope` in an input
 *    is REFUSED, not ignored. `admin` / `platform_admin` / `super_admin`, the legacy bridge, organization_users and tenant_users are not
 *    inputs here and cannot become one.
 *  - Assurance is proven from the actor's own user_sessions row (corporateGovernanceAssurance.js) and is only ever A1_RECENT_REAUTH.
 *    Any attempt to pass an assurance, header or request object is REFUSED, not ignored.
 *  - It never touches users.role, tenant_users, tenants, organizations or organization_users, and an ACTIVE membership grants
 *    zero capability. Its one cross-domain effect is session revocation for a suspension explicitly classified SECURITY_COMPROMISE.
 *
 * Every function takes the service-role client as its FIRST argument and has no default: nothing here can silently run against the
 * process-wide singleton.
 */
import { revokeSessionsForUser } from '../auth/sessionSecurityService.js';
import { executeCorporateAuthorityRpc } from '../auth/sessionAuthority.js';
import {
  CorporateGovernanceError, GOVERNANCE_CAPABILITIES, assertNoClientAssertedAuthority, evaluateCorporateGovernanceAuthorization, parseAuthorityDenials,
} from './corporateGovernanceDecision.js';
import { assertNoClientAssertedAssurance, proveActorAssuranceA1 } from './corporateGovernanceAssurance.js';
import { buildInvalidationEvent, invalidateCorporateAuthorization } from './corporateAuthorizationInvalidation.js';

export const MUTATION_CONTRACT = 'carup.corporate_membership_mutation.v1';
export const SESSION_REVOCATION_CONTRACT = 'carup.corporate_session_revocation.v1';
export const CLASSIFICATIONS = Object.freeze({ ROUTINE: 'ROUTINE', SECURITY_COMPROMISE: 'SECURITY_COMPROMISE' });

/** Same ceilings as the database CHECKs (a longer value could never be stored, so refuse it before the round trip). */
const REASON_MAX = 2000;
const REFERENCE_MAX = 300;
const ID_MAX = 128;
/** A suspension for compromise retries only when an account logged in again in the instant between revocation and suspension. */
const COMPROMISE_ATTEMPTS = 3;

const NODE_ID = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const DB_CODE = /CORPORATE_GOVERNANCE\/([A-Z0-9_]+)/;
/** The table guards (Phase B ledgers, Phase-A membership / event / truncate guards) raise `CORPORATE_<AREA>_<RULE>` — never with a slash. */
const GUARD_CODE = /(CORPORATE_(?:GOVERNANCE|MEMBERSHIP|CUSTODY)_[A-Z0-9_]+)/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code, message, details) => new CorporateGovernanceError(code, message, details);

// ── input discipline ───────────────────────────────────────────────────────────────────────────────────────────────────

function exactKeys(object, allowed, where) {
  if (!isPlainObject(object)) throw fail('INPUT_INVALID', `${where} must be an object.`);
  assertNoClientAssertedAssurance(object, where);
  assertNoClientAssertedAuthority(object, where);
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw fail('INPUT_UNKNOWN_KEY', `${where}.${key} is not an accepted field.`);
  }
}

function textField(value, code, max) {
  if (typeof value !== 'string' || value.trim() === '') throw fail(code);
  const trimmed = value.trim();
  if (trimmed.length > max) throw fail(code === 'REASON_REQUIRED' ? 'REASON_TOO_LONG' : 'REFERENCE_TOO_LONG');
  return trimmed;
}

function identifier(value, code) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > ID_MAX || /[\u0000-\u001f]/.test(value)) throw fail(code);
  return value;
}

function uuid(value, code) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail(code);
  return value.toLowerCase();
}

function nodeId(value) {
  if (typeof value !== 'string' || !NODE_ID.test(value)) throw fail('NODE_UNKNOWN');
  return value;
}

function instant(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw fail('INPUT_INVALID', `${name} must be an ISO timestamp.`);
  return new Date(value).toISOString();
}

function parseActor(actor) {
  exactKeys(actor, ['userId', 'sessionToken'], 'actor');
  return { userId: identifier(actor.userId, 'ACTOR_REQUIRED'), sessionToken: actor.sessionToken };
}

function parseCommon(input, ownKeys, where) {
  exactKeys(input, ['actor', ...ownKeys], where);
  return { actor: parseActor(input.actor) };
}

/** The injected clock is for tests; a value that is not a finite epoch-millisecond number is refused, never coerced. */
function resolveNow(options) {
  const now = options?.now ?? Date.now();
  if (typeof now !== 'number' || !Number.isFinite(now)) throw fail('INPUT_INVALID', 'options.now must be epoch milliseconds.');
  return now;
}

// ── database boundary ──────────────────────────────────────────────────────────────────────────────────────────────────

function clientOrThrow(client) {
  if (!client || typeof client.rpc !== 'function' || typeof client.from !== 'function') throw fail('GOVERNANCE_UNAVAILABLE', 'A service-role client is required.');
  return client;
}

/** A database refusal keeps its code; anything else (transport, permission, missing function) is "unavailable" — a denial. */
function mapDatabaseError(error) {
  const message = String(error?.message ?? '');
  const match = message.match(DB_CODE);
  if (match) {
    // AUTHORITY_DENIED carries WHICH capability failed and why (the entry point puts it in DETAIL); nothing else about the refusal is added.
    const denials = match[1] === 'AUTHORITY_DENIED' ? parseAuthorityDenials(error?.details ?? error?.detail) : undefined;
    return fail(match[1], match[1], denials ? { source: 'database', denials } : { source: 'database' });
  }
  // A table guard — the second line of defence — refused a write the procedure should already have refused: a hard denial, never a retry.
  const guard = message.match(GUARD_CODE);
  if (guard) return fail('GOVERNANCE_GUARD_REFUSED', 'A governance table guard refused the write.', { source: 'database', guard: guard[1] });
  return fail('GOVERNANCE_UNAVAILABLE', 'The governance store could not complete the request.', { source: 'database', cause_code: error?.code ?? null });
}

async function callProcedure(client, name, params) {
  let data;
  try {
    data = await executeCorporateAuthorityRpc(name, params, { legacyTestClient: client });
  } catch (error) {
    throw mapDatabaseError(error);
  }
  if (!isPlainObject(data) || typeof data.outcome !== 'string') throw fail('GOVERNANCE_UNAVAILABLE', 'The governance store returned an unreadable result.');
  return data;
}

async function readOne(client, table, columns, filterColumn, filterValue) {
  let response;
  try {
    response = await client.from(table).select(columns).eq(filterColumn, filterValue).maybeSingle();
  } catch {
    throw fail('GOVERNANCE_UNAVAILABLE');
  }
  if (response?.error) throw fail('GOVERNANCE_UNAVAILABLE');
  return response?.data ?? null;
}

async function readMembership(client, membershipId) {
  const row = await readOne(client, 'corporate_memberships', 'membership_id, user_id, org_node_id, state', 'membership_id', membershipId);
  if (!row) throw fail('MEMBERSHIP_NOT_FOUND');
  return row;
}

const REQUEST_COLUMNS = 'request_id, operation, approval_required, membership_id, subject_user_id, org_node_id, from_state, to_state, requester_user_id, binding_digest, expected_event_seq, classification';
async function readRequest(client, requestId) {
  const row = await readOne(client, 'corporate_membership_requests', REQUEST_COLUMNS, 'request_id', requestId);
  if (!row) throw fail('REQUEST_NOT_FOUND');
  return row;
}

/** The target membership must be exactly the one the caller says it is — a wrong id never "close enough" binds. */
function assertBinding(membership, { membershipId, subjectUserId, orgNodeId }) {
  if (membership.membership_id !== membershipId || membership.user_id !== subjectUserId || membership.org_node_id !== orgNodeId) throw fail('BINDING_MISMATCH');
}

function assertNotSubject(actorUserId, subjectUserId) {
  if (actorUserId === subjectUserId) throw fail('ACTOR_IS_SUBJECT');
}

/**
 * The shared pre-flight, before any side effect: A1 from the actor's own session, then the database's evaluation of the persistent authority
 * for THIS actor, subject and node (each capability on its own; for END, the governance-continuity count). The result is informational — it is
 * never passed to a mutation: the entry point evaluates again, inside the transaction, with the rows locked.
 */
async function authorise(client, actor, binding, { needSessionRevoke = false, needContinuity = false, targetMembershipId = null, now }) {
  const assurance = await proveActorAssuranceA1(client, actor, { now });
  const authority = await evaluateCorporateGovernanceAuthorization(client, {
    actorUserId: actor.userId, subjectUserId: binding.subjectUserId, orgNodeId: binding.orgNodeId,
    capabilities: needSessionRevoke ? [GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE, GOVERNANCE_CAPABILITIES.SESSION_REVOKE] : [GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE],
    needContinuity, targetMembershipId,
  });
  return { authority, sessionId: assurance.session_id };
}

/** The assignments the DATABASE says it relied on (generated from persistent authority; echoed, never trusted as input). */
const authorityReceipt = (data) => (isPlainObject(data?.authority) && Array.isArray(data.authority.assignments)
  ? Object.freeze({ derivation: String(data.authority.derivation ?? ''), assignments: Object.freeze(data.authority.assignments.map((a) => Object.freeze({ capability: a.capability, assignment_id: a.assignment_id, membership_id: a.membership_id }))) })
  : null);

/** Fires the invalidation seam and folds its outcome into the result. A listener failure never undoes the committed mutation. */
async function finishMutation(result, { fromState }) {
  const event = buildInvalidationEvent({
    subjectUserId: result.subject_user_id, membershipId: result.membership_id, orgNodeId: result.org_node_id,
    operation: result.operation, fromState, toState: result.state, requestId: result.request_id,
    eventSeq: result.event_seq, authorizationEpoch: result.authorization_epoch,
  });
  const invalidation = await invalidateCorporateAuthorization(event);
  return Object.freeze({
    contract: MUTATION_CONTRACT,
    outcome: 'EXECUTED',
    request_id: result.request_id,
    operation: result.operation,
    membership_id: result.membership_id,
    subject_user_id: result.subject_user_id,
    org_node_id: result.org_node_id,
    from_state: fromState ?? null,
    state: result.state,
    event_seq: result.event_seq,
    authorization_epoch: Number(result.authorization_epoch),
    grants_capability: false,
    authority: authorityReceipt(result),
    invalidation,
  });
}

/** A recorded non-execution (EXPIRED / STALE_PRECONDITION) is thrown, never returned: "no throw" always means the change happened. */
function recordedRefusal(data) {
  return fail(String(data.classification ?? data.outcome), String(data.classification ?? data.outcome), { recorded: true, outcome: data.outcome, request_id: data.request_id });
}

// ── direct operations: CREATE / SUSPEND / END (one authorised administrator) ───────────────────────────────────────────────

/** CREATE — the only way a membership comes to exist, and it always begins PENDING. */
export async function createPendingMembership(client, input, options = {}) {
  clientOrThrow(client);
  const now = resolveNow(options);
  const { actor } = parseCommon(input, ['subjectUserId', 'orgNodeId', 'reason', 'reference', 'effectiveFrom', 'effectiveUntil'], 'input');
  const subjectUserId = identifier(input.subjectUserId, 'SUBJECT_REQUIRED');
  const orgNodeId = nodeId(input.orgNodeId);
  const reason = textField(input.reason, 'REASON_REQUIRED', REASON_MAX);
  const reference = textField(input.reference, 'REFERENCE_REQUIRED', REFERENCE_MAX);
  const effectiveFrom = instant(input.effectiveFrom, 'effectiveFrom');
  const effectiveUntil = instant(input.effectiveUntil, 'effectiveUntil');
  if (effectiveFrom && effectiveUntil && Date.parse(effectiveUntil) <= Date.parse(effectiveFrom)) throw fail('INPUT_INVALID', 'effectiveUntil must be after effectiveFrom.');
  assertNotSubject(actor.userId, subjectUserId);

  const { sessionId } = await authorise(client, actor, { subjectUserId, orgNodeId }, { now });
  const data = await callProcedure(client, 'corporate_authority_apply_direct', {
    p_operation: 'CREATE', p_actor_user_id: actor.userId, p_actor_session_id: sessionId,
    p_subject_user_id: subjectUserId, p_org_node_id: orgNodeId, p_membership_id: null,
    p_reason: reason, p_reference: reference, p_effective_from: effectiveFrom, p_effective_until: effectiveUntil,
    p_classification: CLASSIFICATIONS.ROUTINE, p_session_revocation: null,
  });
  return finishMutation(data, { fromState: null });
}

async function directTransition(client, input, operation, { now }) {
  clientOrThrow(client);
  const { actor } = parseCommon(input, ['membershipId', 'subjectUserId', 'orgNodeId', 'reason', 'reference', 'classification'], 'input');
  const membershipId = uuid(input.membershipId, 'MEMBERSHIP_NOT_FOUND');
  const subjectUserId = identifier(input.subjectUserId, 'SUBJECT_REQUIRED');
  const orgNodeId = nodeId(input.orgNodeId);
  const reason = textField(input.reason, 'REASON_REQUIRED', REASON_MAX);
  const reference = textField(input.reference, 'REFERENCE_REQUIRED', REFERENCE_MAX);
  const classification = input.classification === undefined ? CLASSIFICATIONS.ROUTINE : input.classification;
  if (!Object.values(CLASSIFICATIONS).includes(classification)) throw fail('CLASSIFICATION_INVALID');
  if (classification === CLASSIFICATIONS.SECURITY_COMPROMISE && operation !== 'SUSPEND') throw fail('CLASSIFICATION_NOT_ALLOWED');
  const compromise = classification === CLASSIFICATIONS.SECURITY_COMPROMISE;
  assertNotSubject(actor.userId, subjectUserId);

  // Authorise BEFORE reading or revoking anything: an unauthorised caller learns nothing and changes nothing.
  const { sessionId } = await authorise(client, actor, { subjectUserId, orgNodeId }, { needSessionRevoke: compromise, needContinuity: operation === 'END', targetMembershipId: operation === 'END' ? membershipId : null, now });

  const membership = await readMembership(client, membershipId);
  assertBinding(membership, { membershipId, subjectUserId, orgNodeId });
  if (operation === 'SUSPEND' && membership.state !== 'ACTIVE') throw fail('ILLEGAL_TRANSITION');
  if (operation === 'END' && !['PENDING', 'ACTIVE', 'SUSPENDED'].includes(membership.state)) throw fail('ILLEGAL_TRANSITION');

  const params = {
    p_operation: operation, p_actor_user_id: actor.userId, p_actor_session_id: sessionId,
    p_subject_user_id: subjectUserId, p_org_node_id: orgNodeId, p_membership_id: membershipId,
    p_reason: reason, p_reference: reference, p_effective_from: null, p_effective_until: null,
    p_classification: classification, p_session_revocation: null,
  };

  if (!compromise) {
    const data = await callProcedure(client, 'corporate_authority_apply_direct', params);
    return finishMutation(data, { fromState: membership.state });
  }

  // SECURITY_COMPROMISE: the existing session-security primitive revokes EVERY live session of the account FIRST (the same order the
  // identity-lifecycle service uses), and the procedure then refuses to suspend while any session is still valid. So the identity is
  // never left usable once the suspension is recorded. A failed revocation, or a failed audit of it, stops here — nothing is suspended.
  let lastError = null;
  for (let attempt = 1; attempt <= COMPROMISE_ATTEMPTS; attempt += 1) {
    let revoked;
    try {
      revoked = await revokeSessionsForUser(client, { id: actor.userId }, {
        userId: subjectUserId, scope: 'all',
        reason: `Corporate membership suspended as SECURITY_COMPROMISE (${reference})`.slice(0, 300),
      });
    } catch (error) {
      throw fail('SESSION_REVOCATION_FAILED', 'Sessions could not be revoked; the membership was not suspended.', { cause: String(error?.message ?? error).slice(0, 200) });
    }
    try {
      const data = await callProcedure(client, 'corporate_authority_apply_direct', {
        ...params,
        p_session_revocation: {
          contract: SESSION_REVOCATION_CONTRACT, scope: 'all', primitive: 'sessionSecurityService.revokeSessionsForUser',
          revoked_count: revoked.revoked_count, revoked_session_ids: revoked.revoked_session_ids, revoked_at: new Date(now).toISOString(), attempt,
        },
      });
      const result = await finishMutation(data, { fromState: membership.state });
      return Object.freeze({ ...result, session_revocation: Object.freeze({ scope: 'all', revoked_count: revoked.revoked_count, revoked_session_ids: Object.freeze([...revoked.revoked_session_ids]), attempts: attempt }) });
    } catch (error) {
      // Only "the account logged in again in the instant between revoking and suspending" is worth another pass; everything else is final.
      if (error instanceof CorporateGovernanceError && error.code === 'SESSIONS_STILL_VALID') { lastError = error; continue; }
      throw error;
    }
  }
  throw lastError ?? fail('SESSIONS_STILL_VALID');
}

/** ACTIVE → SUSPENDED, immediately, by one separately authorised administrator. */
export const suspendMembership = (client, input, options = {}) => directTransition(client, input, 'SUSPEND', { now: resolveNow(options) });

/** PENDING / ACTIVE / SUSPENDED → ENDED, by one administrator, subject to governance-loss protection. ENDED is terminal. */
export const endMembership = (client, input, options = {}) => directTransition(client, input, 'END', { now: resolveNow(options) });

// ── maker / checker operations: ACTIVATE and RESTORE ───────────────────────────────────────────────────────────────────────

async function submitRequest(client, input, operation, { now }) {
  clientOrThrow(client);
  const { actor } = parseCommon(input, ['membershipId', 'subjectUserId', 'orgNodeId', 'reason', 'reference'], 'input');
  const membershipId = uuid(input.membershipId, 'MEMBERSHIP_NOT_FOUND');
  const subjectUserId = identifier(input.subjectUserId, 'SUBJECT_REQUIRED');
  const orgNodeId = nodeId(input.orgNodeId);
  const reason = textField(input.reason, 'REASON_REQUIRED', REASON_MAX);
  const reference = textField(input.reference, 'REFERENCE_REQUIRED', REFERENCE_MAX);
  assertNotSubject(actor.userId, subjectUserId);

  const { sessionId } = await authorise(client, actor, { subjectUserId, orgNodeId }, { now });
  const membership = await readMembership(client, membershipId);
  assertBinding(membership, { membershipId, subjectUserId, orgNodeId });
  if (membership.state !== (operation === 'ACTIVATE' ? 'PENDING' : 'SUSPENDED')) throw fail('ILLEGAL_TRANSITION');

  const data = await callProcedure(client, 'corporate_authority_request_submit', {
    p_operation: operation, p_membership_id: membershipId, p_requester_user_id: actor.userId, p_requester_session_id: sessionId,
    p_reason: reason, p_reference: reference,
  });
  return Object.freeze({
    contract: MUTATION_CONTRACT, outcome: 'REQUESTED', request_id: data.request_id, operation: data.operation,
    membership_id: data.membership_id, subject_user_id: data.subject_user_id, org_node_id: data.org_node_id,
    expected_event_seq: data.expected_event_seq, binding_digest: data.binding_digest, expires_at: data.expires_at, grants_capability: false,
    authority: authorityReceipt(data),
  });
}

/** The maker asks for PENDING → ACTIVE. Records the request; changes nothing. */
export const requestMembershipActivation = (client, input, options = {}) => submitRequest(client, input, 'ACTIVATE', { now: resolveNow(options) });

/** The maker asks for SUSPENDED → ACTIVE. Records the request; changes nothing. */
export const requestMembershipRestoration = (client, input, options = {}) => submitRequest(client, input, 'RESTORE', { now: resolveNow(options) });

/**
 * The checker's decision. `expected` is what the checker was SHOWN and is deliberately mandatory input: it is never filled in from the
 * stored request, because an approval that binds to "whatever is stored now" would bind to nothing.
 */
export async function decideMembershipRequest(client, input, options = {}) {
  clientOrThrow(client);
  const now = resolveNow(options);
  const { actor } = parseCommon(input, ['requestId', 'decision', 'reason', 'expected'], 'input');
  const requestId = uuid(input.requestId, 'REQUEST_NOT_FOUND');
  if (input.decision !== 'APPROVE' && input.decision !== 'REFUSE') throw fail('DECISION_VALUE_INVALID');
  const reason = textField(input.reason, 'REASON_REQUIRED', REASON_MAX);
  exactKeys(input.expected, ['subjectUserId', 'membershipId', 'orgNodeId', 'operation', 'bindingDigest'], 'expected');
  const expected = {
    subjectUserId: identifier(input.expected.subjectUserId, 'SUBJECT_REQUIRED'),
    membershipId: uuid(input.expected.membershipId, 'BINDING_MISMATCH'),
    orgNodeId: nodeId(input.expected.orgNodeId),
    operation: input.expected.operation,
    bindingDigest: input.expected.bindingDigest,
  };
  if (expected.operation !== 'ACTIVATE' && expected.operation !== 'RESTORE') throw fail('BINDING_MISMATCH');
  if (typeof expected.bindingDigest !== 'string' || !DIGEST.test(expected.bindingDigest)) throw fail('BINDING_MISMATCH');

  const request = await readRequest(client, requestId);
  // The subject never acts on their own membership, and the maker is never their own checker — refused before A1 or any write.
  assertNotSubject(actor.userId, request.subject_user_id);
  if (actor.userId === request.requester_user_id) throw fail('MAKER_CHECKER_SAME_ACTOR');
  if (request.subject_user_id !== expected.subjectUserId || request.membership_id !== expected.membershipId || request.org_node_id !== expected.orgNodeId
      || request.operation !== expected.operation || request.binding_digest !== expected.bindingDigest) {
    throw fail('BINDING_MISMATCH');
  }

  const { sessionId } = await authorise(client, actor, { subjectUserId: request.subject_user_id, orgNodeId: request.org_node_id }, { now });
  const data = await callProcedure(client, 'corporate_authority_request_decide', {
    p_request_id: requestId, p_checker_user_id: actor.userId, p_checker_session_id: sessionId, p_decision: input.decision, p_reason: reason,
    p_expected_subject_user_id: expected.subjectUserId, p_expected_membership_id: expected.membershipId, p_expected_org_node_id: expected.orgNodeId,
    p_expected_operation: expected.operation, p_expected_binding_digest: expected.bindingDigest,
  });
  if (data.outcome !== 'APPROVED' && data.outcome !== 'REFUSED') throw recordedRefusal(data);
  return Object.freeze({ contract: MUTATION_CONTRACT, outcome: data.outcome, request_id: data.request_id, step_seq: data.step_seq, classification: data.classification, grants_capability: false, authority: authorityReceipt(data) });
}

/** Consume an approval — once. Executes the transition, writes its lifecycle event, and marks the approval spent, atomically. */
export async function executeMembershipRequest(client, input, options = {}) {
  clientOrThrow(client);
  const now = resolveNow(options);
  const { actor } = parseCommon(input, ['requestId', 'expectedBindingDigest'], 'input');
  const requestId = uuid(input.requestId, 'REQUEST_NOT_FOUND');
  if (typeof input.expectedBindingDigest !== 'string' || !DIGEST.test(input.expectedBindingDigest)) throw fail('BINDING_MISMATCH');

  const request = await readRequest(client, requestId);
  assertNotSubject(actor.userId, request.subject_user_id);
  if (request.binding_digest !== input.expectedBindingDigest) throw fail('BINDING_MISMATCH');

  const { sessionId } = await authorise(client, actor, { subjectUserId: request.subject_user_id, orgNodeId: request.org_node_id }, { now });
  const data = await callProcedure(client, 'corporate_authority_request_execute', {
    p_request_id: requestId, p_executor_user_id: actor.userId, p_executor_session_id: sessionId,
    p_expected_binding_digest: input.expectedBindingDigest,
  });
  if (data.outcome !== 'EXECUTED') throw recordedRefusal(data);
  return finishMutation(data, { fromState: request.from_state });
}

/** The maker withdraws an open or approved-but-unexecuted request. Only the requester may. */
export async function cancelMembershipRequest(client, input, options = {}) {
  clientOrThrow(client);
  const now = resolveNow(options);
  const { actor } = parseCommon(input, ['requestId', 'reason'], 'input');
  const requestId = uuid(input.requestId, 'REQUEST_NOT_FOUND');
  const reason = textField(input.reason, 'REASON_REQUIRED', REASON_MAX);

  const request = await readRequest(client, requestId);
  assertNotSubject(actor.userId, request.subject_user_id);
  if (actor.userId !== request.requester_user_id) throw fail('ONLY_REQUESTER_MAY_CANCEL');

  const { sessionId } = await authorise(client, actor, { subjectUserId: request.subject_user_id, orgNodeId: request.org_node_id }, { now });
  const data = await callProcedure(client, 'corporate_authority_request_cancel', {
    p_request_id: requestId, p_actor_user_id: actor.userId, p_actor_session_id: sessionId, p_reason: reason,
  });
  return Object.freeze({ contract: MUTATION_CONTRACT, outcome: data.outcome, request_id: data.request_id, classification: data.classification, grants_capability: false, authority: authorityReceipt(data) });
}

/** Read-only: where a request stands, from the append-only ledgers (status is the latest step, never a stored mutable column). */
export async function readMembershipRequestStatus(client, requestId) {
  clientOrThrow(client);
  const row = await readOne(client, 'corporate_membership_request_status', '*', 'request_id', uuid(requestId, 'REQUEST_NOT_FOUND'));
  if (!row) throw fail('REQUEST_NOT_FOUND');
  return row;
}
