/**
 * CA-K3-AUTH-03 + CA-K3-AUTH-04 — the Corporate membership mutation SERVICE, exercised against the real governed SQL.
 *
 * Nothing here injects a collaborator that could hide a dead path: the service talks to PGlite 17 through a supabase-js-shaped client
 * that executes every statement as `service_role` (corporateGovernanceDb + pgliteSupabaseClient), on the database that carries Phase A,
 * Phase B AND Phase C, and the compromise flow runs the REAL revokeSessionsForUser / logAuditEvent and the REAL Phase-A resolver.
 * The database-only proofs live in ca-k3-auth-03-membership-governance-pglite.test.js (Phase B) and
 * ca-k3-auth-04-permission-authority-pglite.test.js (Phase C); this file proves the layer above them and that the layers agree.
 *
 * Authority in this file is never typed into a test: the governors below exist because this DISPOSABLE database's owner ran a fixture
 * ceremony (an ACTIVE membership plus ACTIVE assignments). Phase C ships no way to create either, so nothing here exists in any real environment.
 *
 * Section map (receipt evidence): S1 boundary/non-routed · S2 the trusted evaluator (fail-closed; client-asserted authority refused) ·
 * S3 A1 server-proven, client assurance refused · S4 wiring: full lifecycle + provenance from persistent grants · S5 maker/checker,
 * no-self-action and COMPUTED continuity at BOTH layers · S6 replay, double execution, stale, binding · S7 SECURITY_COMPROMISE session
 * propagation · S8 invalidation seam · S9 zero capability, identity tables untouched, immediate denial · S10 legacy roles / tenants /
 * ACTIVE membership / fabricated authority are not authority · S11 outage, concurrency on one connection · S12 live authority: revocation is
 * observed on the next call, even between the service's preflight and the database entry point.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openDatabase, closeAll, addSession, decisionFor, snapshot, IDENTITY_TABLES, MINUTE, HOUR, OWNER, iso,
  MANAGE, REVOKE_SESSIONS, ROOT_NODE, seedGovernor, seedMembership, seedAssignment, moveAssignment, backdate, asRole,
} from './helpers/corporateGovernanceDb.js';
import { createServiceClient, installAuditTables } from './helpers/pgliteSupabaseClient.js';
import * as svc from '../services/corporate/corporateMembershipGovernanceService.js';
import * as decisionModule from '../services/corporate/corporateGovernanceDecision.js';
import {
  AUTHORITY_DENIAL_REASONS, AUTHORITY_EVALUATOR_NAME, AUTHORITY_EVALUATOR_RPC, CorporateGovernanceError, GOVERNANCE_ASSURANCE_CLASS, GOVERNANCE_CAPABILITIES,
  GOVERNANCE_DECISION_CONTRACT, GOVERNANCE_DECISION_SOURCE, MIN_INDEPENDENT_GOVERNORS, evaluateCorporateGovernanceAuthorization, parseAuthorityDenials,
} from '../services/corporate/corporateGovernanceDecision.js';
import { CORPORATE_ASSURANCE_CLASS, proveActorAssuranceA1 } from '../services/corporate/corporateGovernanceAssurance.js';
import {
  AUTHORIZATION_INVALIDATION_CONTRACT, clearCorporateAuthorizationListeners, onCorporateAuthorizationInvalidated,
} from '../services/corporate/corporateAuthorizationInvalidation.js';
import { resolveCorporateMembership } from '../services/corporate/corporateMembershipService.js';
import { STEP_UP_TTL_MS, ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const CORE = ['corporateGovernanceDecision', 'corporateGovernanceAssurance', 'corporateAuthorizationInvalidation', 'corporateMembershipGovernanceService']
  .map((name) => `backend/services/corporate/${name}.js`);
/** The five database entry points service_role may execute: none of them takes a decision from the caller. */
const ENTRY_POINTS = ['corporate_authority_apply_direct', 'corporate_authority_request_submit', 'corporate_authority_request_decide',
  'corporate_authority_request_execute', 'corporate_authority_request_cancel'];
/** The Phase-B snapshot-taking procedures: owner-only since Phase C. */
const SNAPSHOT_PROCEDURES = ['corporate_membership_apply_direct', 'corporate_membership_request_submit', 'corporate_membership_request_decide',
  'corporate_membership_request_execute', 'corporate_membership_request_cancel'];
const PHASE_C_MIGRATION = 'database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql';

const NODE = 'BU_MARKETPLACE';
let db;
let client;
let seq = 0;
/** The fixture governors' ids (membership + the assignments they rest on), keyed by user id. */
const governors = {};

before(async () => {
  db = await openDatabase({ migrate: 'all' });
  await installAuditTables(db);
  client = createServiceClient(db);
  for (const id of ['g-alice', 'g-bob', 'g-carol', 'g-dave']) governors[id] = await seedGovernor(db, id);
  governors['g-erin'] = await seedGovernor(db, 'g-erin', { withRevoke: false }); // may manage memberships, may NOT revoke sessions
});
after(async () => { await closeAll(); });
afterEach(() => { clearCorporateAuthorizationListeners(); client.faults.clear(); client.beforeRpc = null; });

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function newUser(prefix = 'x') {
  const id = `${prefix}-${(seq += 1)}`;
  await db.query(`INSERT INTO users (id, email, role) VALUES ($1, $2, 'owner')`, [id, `${id}@x.invalid`]);
  return id;
}
/** An actor whose session has (by default) a fresh password re-authentication — i.e. genuinely A1. Authority is a separate question. */
async function actorOf(userId, options) {
  const sid = await addSession(db, userId, options);
  return { userId, sessionToken: `tok-${sid}` };
}
async function code(promise) {
  try { await promise; return null; } catch (error) { return error instanceof CorporateGovernanceError ? error.code : `OTHER:${error?.stack ?? error}`; }
}
/** The error a call throws (or null) — to read its details as well as its code. */
const thrown = (promise) => promise.then(() => null, (error) => error);
const dbCode = (response) => String(response?.error?.message ?? '').match(/CORPORATE_GOVERNANCE\/([A-Z0-9_]+)/)?.[1] ?? null;
const owner = async (sql, params = []) => (await db.query(sql, params)).rows;
/** One statement as service_role — to prove what that role cannot do. */
const asServiceRole = (sql) => asRole(db, 'service_role', () => db.query(sql));
/** Calls that reached a database MUTATION entry point. The read-only evaluator preflight is counted separately. */
const rpcCount = () => client.calls.rpc.filter((c) => c.name !== AUTHORITY_EVALUATOR_RPC).length;
const evaluatorCount = () => client.calls.rpc.filter((c) => c.name === AUTHORITY_EVALUATOR_RPC).length;
/** The user_sessions.id behind an actor's token (the harness mints tokens as `tok-<id>`). */
const sessionIdOf = (actor) => actor.sessionToken.slice(4);
const denialsOf = (error) => error?.details?.denials ?? null;
const denial = (capability, reason, assignmentId = null) => ({ capability, reason, assignment_id: assignmentId });

async function createMembership(subject, node = NODE, maker) {
  const m = maker ?? await actorOf('g-alice');
  return svc.createPendingMembership(client, { actor: m, subjectUserId: subject, orgNodeId: node, reason: 'Joins the unit', reference: `HR-${(seq += 1)}` });
}
const expectedOf = (req) => ({ subjectUserId: req.subject_user_id, membershipId: req.membership_id, orgNodeId: req.org_node_id, operation: req.operation, bindingDigest: req.binding_digest });
async function submit(kind, membershipId, subject, node, maker) {
  const fn = kind === 'ACTIVATE' ? svc.requestMembershipActivation : svc.requestMembershipRestoration;
  return fn(client, { actor: maker, membershipId, subjectUserId: subject, orgNodeId: node, reason: `${kind} please`, reference: `REQ-${(seq += 1)}` });
}
async function approve(req, checker, outcome = 'APPROVE') {
  return svc.decideMembershipRequest(client, { actor: checker, requestId: req.request_id, decision: outcome, reason: 'reviewed', expected: expectedOf(req) });
}
async function execute(req, executor) {
  return svc.executeMembershipRequest(client, { actor: executor, requestId: req.request_id, expectedBindingDigest: req.binding_digest });
}
/** PENDING → ACTIVE through the whole maker/checker path. */
async function makeActive(subject, node = NODE) {
  const maker = await actorOf('g-alice');
  const checker = await actorOf('g-bob');
  const created = await createMembership(subject, node, maker);
  const req = await submit('ACTIVATE', created.membership_id, subject, node, maker);
  await approve(req, checker);
  const done = await execute(req, maker);
  return { membershipId: created.membership_id, created, req, done, maker, checker };
}
async function suspend(membershipId, subject, node, admin, extra = {}) {
  return svc.suspendMembership(client, { actor: admin, membershipId, subjectUserId: subject, orgNodeId: node, reason: 'Pause access', reference: `SUS-${(seq += 1)}`, ...extra.input });
}
async function end(membershipId, subject, node, admin) {
  return svc.endMembership(client, { actor: admin, membershipId, subjectUserId: subject, orgNodeId: node, reason: 'Leaves the unit', reference: `END-${(seq += 1)}` });
}
const membershipRow = async (id) => (await owner('SELECT * FROM corporate_memberships WHERE membership_id = $1', [id]))[0];
const eventCount = async (id) => Number((await owner('SELECT COUNT(*) AS n FROM corporate_membership_events WHERE membership_id = $1', [id]))[0].n);
/** A governor created for ONE test, so that revoking or suspending its authority cannot disturb the shared fixtures. */
async function freshGovernor(prefix, options) {
  const id = `${prefix}-${(seq += 1)}`;
  governors[id] = await seedGovernor(db, id, options);
  return id;
}
/** A call straight to a database entry point as service_role, bypassing the service entirely. */
const direct = (name, args) => client.rpc(name, args);
const directCreate = (over) => ({ p_operation: 'CREATE', p_actor_user_id: 'g-alice', p_actor_session_id: null, p_subject_user_id: null, p_org_node_id: NODE, p_membership_id: null,
  p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, ...over });

// ── S1 — boundary: internal, non-routed, writes only through the five database entry points ──────────────────────────────

test('S1 the four core modules exist and import only the sanctioned collaborators', () => {
  const allowed = new Set(['../auth/sessionSecurityService.js', '../auth/sessionAuthority.js', './corporateGovernanceDecision.js', './corporateGovernanceAssurance.js',
    './corporateAuthorizationInvalidation.js', '../auth/authenticationAssuranceService.js']);
  for (const file of CORE) {
    const imports = [...stripComments(read(file)).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(allowed.has(spec), `${file} imports ${spec}`);
  }
  // the service in particular does not import the singleton supabase client: every function takes the client it is given
  assert.doesNotMatch(stripComments(read(CORE[3])), /db\/supabase\.js/);
});

test('S1 the service writes nothing itself: no DML, only the five authority entry points, only three read tables — and never a snapshot procedure', () => {
  for (const file of CORE) assert.doesNotMatch(stripComments(read(file)), /\)\s*\.(insert|update|delete|upsert)\(/, `${file} must not perform DML`);
  const src = stripComments(read(CORE[3]));
  const called = [...src.matchAll(/callProcedure\(client,\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(called)].sort(), [...ENTRY_POINTS].sort(), 'exactly the five authority entry points');
  for (const file of CORE) {
    assert.doesNotMatch(stripComments(read(file)), /p_governance_decision|corporate_membership_(apply_direct|request_(submit|decide|execute|cancel))\b/, `${file} cannot even name a snapshot-taking procedure`);
    assert.doesNotMatch(stripComments(read(file)), /corporate_permission_assignment|corporate_org_nodes/, `${file} never touches the assignment tables — it only asks the evaluator`);
  }
  // the one place the database's authority is read is the evaluator RPC, through the one constant
  assert.deepEqual([...new Set([...stripComments(read(CORE[0])).matchAll(/client\.rpc\(\s*([A-Za-z_]+)/g)].map((m) => m[1]))], ['AUTHORITY_EVALUATOR_RPC']);
  assert.equal(AUTHORITY_EVALUATOR_RPC, 'corporate_authority_evaluate');
  const tables = [...src.matchAll(/(?:readOne\(client,|\.from\()\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['corporate_membership_request_status', 'corporate_membership_requests', 'corporate_memberships']);
  assert.match(stripComments(read(CORE[1])), /resolveSessionAssuranceByToken/, 'A1 is resolved from the actor\'s exact presented session token through the AUTH-05 read boundary');
  assert.doesNotMatch(stripComments(read(CORE[1])), /\.from\('user_sessions'\)/, 'the Phase-C preflight no longer requires direct service_role table access after AUTH-05');
});

test('S1 no legacy platform role, tenant relationship, header or bridge is an input to any core module', () => {
  const forbidden = /\b(users\.role|platform_admin|super_admin|tenant_users|organization_users|organizations|tenants)\b|req\.headers|x-user-id|x-tenant-id|legacy_admin_compatibility_bridge|authorizeRole|userContext|platformRole/;
  for (const file of CORE) assert.doesNotMatch(stripComments(read(file)), forbidden, `${file} reads a forbidden authority source`);
});

test('S1 the core is NOT routed: nothing outside it (and its tests) imports it or calls a governed entry point', () => {
  const needle = /corporateMembershipGovernanceService|corporateGovernanceDecision|corporateGovernanceAssurance|corporateAuthorizationInvalidation|corporate_(membership_(apply_direct|request_submit|request_decide|request_execute|request_cancel)|authority_(evaluate|apply_direct|request_submit|request_decide|request_execute|request_cancel))/;
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|ts|tsx)$/.test(name) && !full.includes(`${path.sep}services${path.sep}corporate${path.sep}`) && needle.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(ROOT, full));
    }
  };
  for (const dir of ['backend', 'web/src', 'mobile']) { try { walk(path.join(ROOT, dir)); } catch { /* a surface that does not exist has nothing to leak */ } }
  assert.deepEqual(offenders, ['backend/services/auth/sessionAuthority.js'], 'the only non-Corporate production bridge to mutation RPC names is the AUTH-05 dedicated database authority boundary');
  const bridgeUsers = [];
  const findBridgeCallers = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) findBridgeCallers(full);
      else if (/\.(js|mjs|cjs|ts|tsx)$/.test(name) && /executeCorporateAuthorityRpc/.test(readFileSync(full, 'utf8'))) bridgeUsers.push(path.relative(ROOT, full));
    }
  };
  findBridgeCallers(path.join(ROOT, 'backend'));
  assert.deepEqual(bridgeUsers.sort(), ['backend/services/auth/sessionAuthority.js', 'backend/services/corporate/corporateMembershipGovernanceService.js'], 'only the Corporate core may consume the dedicated Phase-C RPC bridge');
  // The Corporate routers are the frozen read-only access bridge and (CA-OWNER-02) the read-only management read models. NEITHER
  // may reach the governed mutation core: each router's whole import closure is walked and must contain no mutation-core module,
  // and no Corporate or route file in it may name a governed write RPC or call the Phase-C bridge. (The read-only evaluator
  // client, corporateGovernanceDecision.js, is reached by both through the frozen admission decision — that is reading, not
  // mutating. The AUTH-05 session boundary is reached through the auth middleware by every route and is certified there.)
  const server = read('backend/server.js');
  assert.deepEqual([...server.matchAll(/corporate\w*Router/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i), ['corporateAccessRouter', 'corporateManagementRouter']);
  const MUTATION_CORE = CORE.filter((f) => !f.endsWith('/corporateGovernanceDecision.js'));
  for (const route of ['backend/routes/corporateAccessRoutes.js', 'backend/routes/corporateManagementRoutes.js']) {
    const closure = importClosure(route);
    assert.ok(closure.includes('backend/services/corporate/corporateAccessService.js'), `${route} admits through the frozen decision`);
    for (const core of MUTATION_CORE) assert.equal(closure.includes(core), false, `${route} reaches the mutation core module ${core}`);
    for (const file of closure.filter((f) => f.startsWith('backend/services/corporate/') || f.startsWith('backend/routes/corporate'))) {
      const text = stripComments(read(file));
      assert.doesNotMatch(text, /corporate_(membership|authority)_(apply_direct|request_(submit|decide|execute|cancel))/, `${file} (reached from ${route}) names a governed write RPC`);
      assert.doesNotMatch(text, /executeCorporateAuthorityRpc/, `${file} (reached from ${route}) calls the Phase-C bridge`);
    }
  }
});

/** Every backend file a module reaches through relative static or dynamic imports. */
function importClosure(entry) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      let target = path.join(path.dirname(rel), m[1]);
      if (!/\.(js|mjs|cjs)$/.test(target)) target += '.js';
      try { statSync(path.join(ROOT, target)); } catch { continue; }
      visit(target);
    }
  };
  visit(entry);
  return [...seen];
}

test('S1 nothing in production code can mint, accept or forward a caller-supplied governance decision any more', () => {
  const removed = ['mintTargetGovernanceDecision', 'assertGovernanceDecision', 'isMintedGovernanceDecision', 'governanceDecisionToWire', 'DECISION_MAX_AGE_MS'];
  const grep = spawnSync('git', ['grep', '-l', '--untracked', ...removed.flatMap((name) => ['-e', name]), '--', 'backend', 'web/src', ':!backend/tests'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(grep.status === 0 || grep.status === 1, `git grep failed: ${grep.stderr}`);
  assert.deepEqual(grep.stdout.split('\n').filter(Boolean), [], 'the symbols that took a decision from a caller are gone');
  for (const name of removed) assert.equal(name in decisionModule, false, `${name} is no longer exported`);
  assert.doesNotMatch(stripComments(read(CORE[3])), /governanceDecision|governance_decision/, 'the service has no decision input at all');
  // the module surface IS the surface: nothing creates, approves, activates, suspends or revokes an assignment
  assert.deepEqual(Object.keys(decisionModule).sort(), ['AUTHORITY_DENIAL_REASONS', 'AUTHORITY_EVALUATOR_NAME', 'AUTHORITY_EVALUATOR_RPC', 'CLIENT_AUTHORITY_KEY', 'CorporateGovernanceError',
    'GOVERNANCE_ASSURANCE_CLASS', 'GOVERNANCE_CAPABILITIES', 'GOVERNANCE_DECISION_CONTRACT', 'GOVERNANCE_DECISION_SOURCE', 'MIN_INDEPENDENT_GOVERNORS', 'assertNoClientAssertedAuthority',
    'default', 'evaluateCorporateGovernanceAuthorization', 'parseAuthorityDenials']);
  assert.deepEqual(Object.keys(svc).sort(), ['CLASSIFICATIONS', 'MUTATION_CONTRACT', 'SESSION_REVOCATION_CONTRACT', 'cancelMembershipRequest', 'createPendingMembership', 'decideMembershipRequest',
    'endMembership', 'executeMembershipRequest', 'readMembershipRequestStatus', 'requestMembershipActivation', 'requestMembershipRestoration', 'suspendMembership']);
});

// ── S2 — the trusted evaluator: the only source of authority; asked of the database, validated, and fail-closed ────────────

const manageOf = (actor, subject, node = NODE, extra = {}) => ({ actorUserId: actor, subjectUserId: subject, orgNodeId: node, capabilities: [GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE], ...extra });
const evaluating = (c, input) => evaluateCorporateGovernanceAuthorization(c, input);
/** A client that asks the REAL database and then hands the evaluator's answer to `transform`; every other call is untouched. */
const answering = (transform) => ({
  from: client.from.bind(client),
  rpc: async (name, params) => { const real = await client.rpc(name, params); return name === AUTHORITY_EVALUATOR_RPC ? transform(real) : real; },
});
const tampered = (mutate) => answering((real) => { const data = structuredClone(real.data); mutate(data); return { data, error: null }; });
const serving = (rpc) => ({ from: client.from.bind(client), rpc });

test('S2 a governor is granted — each capability by its own persistent assignment — and the answer is frozen all the way down', async () => {
  const granted = await evaluating(client, manageOf('g-alice', 'm-eve', NODE, { capabilities: [GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE, GOVERNANCE_CAPABILITIES.SESSION_REVOKE] }));
  assert.equal(granted.granted, true);
  assert.equal(granted.decision.provenance.derivation, 'persistent_assignments');
  assert.equal(granted.decision.evaluator.name, AUTHORITY_EVALUATOR_NAME);
  assert.equal(granted.decision.assurance.class, 'A1_RECENT_REAUTH');
  assert.equal(granted.decision.assurance.server_proven, true);
  assert.deepEqual([...granted.decision.scope.org_node_ids], [NODE]);
  assert.equal(granted.assignments.length, 2);
  assert.notEqual(granted.assignments[0].assignment_id, granted.assignments[1].assignment_id, 'one assignment per capability — never one grant standing in for two');
  const rows = await owner('SELECT subject_user_id, capability, state FROM corporate_permission_assignments WHERE assignment_id = ANY($1::uuid[]) ORDER BY capability', [granted.assignments.map((a) => a.assignment_id)]);
  assert.deepEqual(rows.map((r) => [r.subject_user_id, r.capability, r.state]), [['g-alice', MANAGE, 'ACTIVE'], ['g-alice', REVOKE_SESSIONS, 'ACTIVE']], 'the provenance points at real, ACTIVE assignments of the actor');
  assert.ok(Object.isFrozen(granted) && Object.isFrozen(granted.decision) && Object.isFrozen(granted.decision.scope.org_node_ids) && Object.isFrozen(granted.assignments[0]));
  assert.throws(() => { granted.decision.capabilities.push('corporate.finance.read'); }, TypeError);
  assert.throws(() => { granted.decision.scope.org_node_ids.push('GLOBAL'); }, TypeError);
  assert.throws(() => { granted.decision.assurance.class = 'A2_STRONG'; }, TypeError);
  assert.throws(() => { granted.assignments[0].assignment_id = 'x'; }, TypeError);
  // an evaluation grants a PREVIEW; the manager's own authority did not change by being asked
  assert.equal(Number((await owner(`SELECT count(*) AS n FROM corporate_permission_assignments WHERE subject_user_id = 'g-alice'`))[0].n), 2);
});

test('S2 every kind of missing authority is a denial that names the capability, the reason, and the assignment that got furthest', async () => {
  const cases = [
    ['requested only', 'STATE_REQUESTED', { finalState: 'REQUESTED' }], ['approved but never activated', 'STATE_APPROVED', { finalState: 'APPROVED' }],
    ['suspended', 'STATE_SUSPENDED', { finalState: 'SUSPENDED' }], ['revoked', 'STATE_REVOKED', { finalState: 'REVOKED' }], ['expired', 'STATE_EXPIRED', { finalState: 'EXPIRED' }],
    ['not yet in force', 'OUT_OF_WINDOW', { fromOffsetMs: HOUR, untilOffsetMs: 2 * HOUR }], ['another unit only', 'OUT_OF_SCOPE', { nodes: ['BU_SERVICE_NETWORK'] }],
    ['the root alone, without descendants, asked about a unit under it', 'OUT_OF_SCOPE', { nodes: [ROOT_NODE], includeDescendants: false }],
  ];
  for (const [label, reason, options] of cases) {
    const user = `f-s2-${(seq += 1)}`;
    const membershipId = await seedMembership(db, user);
    const id = await seedAssignment(db, { subject: user, membershipId, ...options });
    const error = await thrown(evaluating(client, manageOf(user, 'm-eve')));
    assert.equal(error?.code, 'AUTHORITY_DENIED', label);
    assert.deepEqual(denialsOf(error), [denial(MANAGE, reason, id)], label);
  }
  // an ACTIVE membership and nothing else; and no membership at all
  const member = `f-s2-${(seq += 1)}`;
  await seedMembership(db, member);
  assert.deepEqual(denialsOf(await thrown(evaluating(client, manageOf(member, 'm-eve')))), [denial(MANAGE, 'NO_ASSIGNMENT')], 'an ACTIVE membership authorizes nothing');
  assert.deepEqual(denialsOf(await thrown(evaluating(client, manageOf('m-ivan', 'm-eve')))), [denial(MANAGE, 'NO_ASSIGNMENT')], 'no membership, no assignment');
  // two assignments for one capability: the denial names the one that got furthest (out of scope beats revoked), never a coin flip
  const two = `f-s2-${(seq += 1)}`;
  const membershipId = await seedMembership(db, two);
  await seedAssignment(db, { subject: two, membershipId, finalState: 'REVOKED' });
  const scoped = await seedAssignment(db, { subject: two, membershipId, nodes: ['BU_SERVICE_NETWORK'] });
  assert.deepEqual(denialsOf(await thrown(evaluating(client, manageOf(two, 'm-eve')))), [denial(MANAGE, 'OUT_OF_SCOPE', scoped)]);
  // one capability of two: the missing one is named and the held one is not
  assert.deepEqual(denialsOf(await thrown(evaluating(client, manageOf('g-erin', 'm-eve', NODE, { capabilities: [MANAGE, REVOKE_SESSIONS] })))), [denial(REVOKE_SESSIONS, 'NO_ASSIGNMENT')]);
  // …and each capability must be covered on its OWN: manage here, revoke there is not both here
  const split = `f-s2-${(seq += 1)}`;
  const splitMembership = await seedMembership(db, split);
  await seedAssignment(db, { subject: split, membershipId: splitMembership, capability: MANAGE });
  const elsewhere = await seedAssignment(db, { subject: split, membershipId: splitMembership, capability: REVOKE_SESSIONS, nodes: ['BU_SERVICE_NETWORK'] });
  assert.deepEqual(denialsOf(await thrown(evaluating(client, manageOf(split, 'm-eve', NODE, { capabilities: [MANAGE, REVOKE_SESSIONS] })))), [denial(REVOKE_SESSIONS, 'OUT_OF_SCOPE', elsewhere)]);
});

test('S2 only the two governance capabilities are evaluable, for one well-formed node — refused before any round trip', async () => {
  const before = client.calls.rpc.length;
  const reasons = async (input) => denialsOf(await thrown(evaluating(client, input))).map((d) => d.reason);
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { capabilities: ['corporate.finance.read'] })), ['CAPABILITY_NOT_EVALUABLE']);
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { capabilities: ['platform_admin'] })), ['CAPABILITY_NOT_EVALUABLE'], 'a legacy role name is not a capability');
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { capabilities: [MANAGE, 'corporate.finance.read'] })), ['CAPABILITY_NOT_EVALUABLE'], 'one evaluable capability does not launder another');
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { capabilities: [] })), ['CAPABILITY_NOT_EVALUABLE']);
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { capabilities: undefined })), ['CAPABILITY_NOT_EVALUABLE']);
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { needContinuity: true })), ['CONTINUITY_TARGET_REQUIRED']);
  assert.deepEqual(await reasons(manageOf('g-alice', 'm-eve', NODE, { needContinuity: true, targetMembershipId: 'not-a-uuid' })), ['CONTINUITY_TARGET_REQUIRED']);
  assert.equal(await code(evaluating(client, manageOf('g-alice', 'm-eve', 'bu_marketplace'))), 'NODE_UNKNOWN');
  assert.equal(await code(evaluating(client, manageOf('g-alice', 'm-eve', undefined, { orgNodeId: '' }))), 'NODE_UNKNOWN');
  assert.equal(await code(evaluating(client, manageOf('', 'm-eve'))), 'ACTOR_REQUIRED');
  assert.equal(await code(evaluating(client, manageOf('g-alice', '  '))), 'SUBJECT_REQUIRED');
  assert.equal(await code(evaluating(client, undefined)), 'ACTOR_REQUIRED');
  assert.equal(client.calls.rpc.length, before, 'none of it reached the database');
});

test('S2 the evaluator fails closed: an error, a throw, a non-answer, or an answer that is not exactly what was asked is UNAVAILABLE — never a grant', async () => {
  const ask = (c, extra = {}) => code(evaluating(c, manageOf('g-alice', 'm-eve', NODE, extra)));
  assert.equal(await ask(client), null, 'positive control: the real answer is accepted');
  assert.equal(await ask(answering((real) => real)), null, 'and so is the same answer relayed unchanged — the harness could pass');

  const variants = {
    'another actor': (d) => { d.actor_user_id = 'g-bob'; },
    'another subject': (d) => { d.subject_user_id = 'm-frank'; },
    'another node': (d) => { d.scope.org_node_ids = ['BU_SERVICE_NETWORK']; },
    'two nodes': (d) => { d.scope.org_node_ids = [NODE, 'BU_SERVICE_NETWORK']; },
    'a GLOBAL scope': (d) => { d.scope = { kind: 'GLOBAL' }; },
    'an extra capability': (d) => { d.capabilities = [MANAGE, REVOKE_SESSIONS]; },
    'another capability': (d) => { d.capabilities = [REVOKE_SESSIONS]; },
    'no provenance': (d) => { delete d.provenance; },
    'a caller-supplied derivation': (d) => { d.provenance.derivation = 'caller_supplied'; },
    'no assignment behind the capability': (d) => { d.provenance.assignments = []; },
    'a malformed assignment id': (d) => { d.provenance.assignments[0].assignment_id = 'not-a-uuid'; },
    'a duplicated assignment': (d) => { d.provenance.assignments.push({ ...d.provenance.assignments[0] }); },
    'another capability on the assignment': (d) => { d.provenance.assignments[0].capability = REVOKE_SESSIONS; },
    'another evaluator': (d) => { d.evaluator.name = 'test-evaluator'; },
    'a legacy source': (d) => { d.source = 'legacy_admin_compatibility_bridge'; },
    'the bridge contract': (d) => { d.contract = 'carup.corporate_access.v1'; },
    'A2': (d) => { d.assurance.class = 'A2_STRONG'; },
    'unproven assurance': (d) => { d.assurance.server_proven = false; },
    'an unknown verdict': (d) => { d.decision = 'maybe'; },
  };
  for (const [name, mutate] of Object.entries(variants)) assert.equal(await ask(tampered(mutate)), 'GOVERNANCE_UNAVAILABLE', name);

  assert.equal(await ask(serving(async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }))), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask(serving(async () => { throw new Error('socket hang up'); })), 'GOVERNANCE_UNAVAILABLE');
  for (const data of [null, undefined, 'granted', 7, [], {}, { decision: 'granted' }, { decision: 'granted', denials: [] }]) {
    assert.equal(await ask(serving(async () => ({ data, error: null }))), 'GOVERNANCE_UNAVAILABLE', JSON.stringify(data));
  }
  assert.equal(await ask(null), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask({ rpc() {} }), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask({}), 'GOVERNANCE_UNAVAILABLE');

  // a denial is a denial, and a reason this client does not know is still a denial (reported as UNKNOWN, never trusted, never dropped)
  const unknownReason = await thrown(evaluating(serving(async () => ({ data: { decision: 'denied', denials: [{ capability: MANAGE, reason: 'SOMETHING_NEW', assignment_id: null }] }, error: null })), manageOf('g-alice', 'm-eve')));
  assert.deepEqual([unknownReason.code, denialsOf(unknownReason)], ['AUTHORITY_DENIED', [denial(MANAGE, 'UNKNOWN')]]);
  const noDetail = await thrown(evaluating(serving(async () => ({ data: { decision: 'denied' }, error: null })), manageOf('g-alice', 'm-eve')));
  assert.deepEqual([noDetail.code, denialsOf(noDetail)], ['AUTHORITY_DENIED', []]);
});

test('S2 the continuity answer is validated strictly, and the two-governor minimum is enforced on what the database COUNTED', async () => {
  const target = '00000000-0000-4000-8000-0000000000aa';
  const ask = (c) => code(evaluating(c, manageOf('g-alice', 'm-eve', NODE, { needContinuity: true, targetMembershipId: target })));
  const continuity = (k) => tampered((d) => { if (k === undefined) delete d.governance_continuity; else d.governance_continuity = k; });
  const holds = (n) => ({ subject_holds_governance_authority: true, remaining_independent_governors: n });
  assert.equal(await ask(client), null, 'positive control: an ordinary subject is no governance loss, and the database counted the governors itself');
  const real = await evaluating(client, manageOf('g-alice', 'm-eve', NODE, { needContinuity: true, targetMembershipId: target }));
  assert.equal(real.governance_continuity.subject_holds_governance_authority, false);
  assert.ok(real.governance_continuity.remaining_independent_governors >= 2);
  assert.equal(await ask(continuity(undefined)), 'GOVERNANCE_UNAVAILABLE', 'missing');
  assert.equal(await ask(continuity({ subject_holds_governance_authority: 'yes', remaining_independent_governors: 5 })), 'GOVERNANCE_UNAVAILABLE', 'a malformed holder flag');
  assert.equal(await ask(continuity({ subject_holds_governance_authority: true, remaining_independent_governors: -1 })), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask(continuity({ subject_holds_governance_authority: true, remaining_independent_governors: 1.5 })), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask(continuity({ subject_holds_governance_authority: true, remaining_independent_governors: '5' })), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await ask(continuity(holds(1))), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await ask(continuity(holds(0))), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await ask(continuity(holds(MIN_INDEPENDENT_GOVERNORS))), null, 'two independent governors remain');
  assert.equal(await ask(continuity({ subject_holds_governance_authority: false, remaining_independent_governors: 0 })), null, 'an ordinary member is not a governance loss');
  // a continuity block is never returned when it was not asked for
  assert.equal((await evaluating(client, manageOf('g-alice', 'm-eve'))).governance_continuity, null);
});

const SERVICE_ENTRYPOINTS = ['createPendingMembership', 'suspendMembership', 'endMembership', 'requestMembershipActivation', 'requestMembershipRestoration',
  'decideMembershipRequest', 'executeMembershipRequest', 'cancelMembershipRequest'];

test('S2 authority cannot be supplied: a decision, snapshot, capability, grant, role or scope in ANY input is refused before any I/O — even a perfectly formed legacy decision', async () => {
  const legacyDecision = decisionFor({ actor: 'g-alice', subject: 'm-eve' }); // exactly what Phase B accepted from a caller
  const smuggled = [
    ['governanceDecision', legacyDecision], ['governance_decision', legacyDecision], ['decisionSnapshot', legacyDecision], ['snapshot', {}],
    ['capabilities', [MANAGE]], ['capability', MANAGE], ['permissions', ['*']], ['permission', 'all'], ['grant', true], ['grants', []], ['roles', ['super_admin']],
    ['scope', { kind: 'GLOBAL' }], ['entitlements', []], ['assignment', {}], ['assignmentId', 'x'], ['authority', {}], ['provenance', {}], ['evaluator', {}], ['source', 'target_corporate_governance'],
    // near-miss spellings are authority assertions too: any key that CONTAINS one of the words is refused, never silently ignored
    ['scopeNode', 'BU_MARKETPLACE'], ['myRoles', ['super_admin']], ['grantedBy', 'g-alice'], ['evaluatorName', 'corporate_authority_evaluate'], ['resourceScope', 'GLOBAL'], ['capabilityList', [MANAGE]],
  ];
  const before = { rpc: client.calls.rpc.length, from: client.calls.from.length };
  for (const name of SERVICE_ENTRYPOINTS) {
    for (const [key, value] of smuggled) {
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, [key]: value })), 'AUTHORITY_CLIENT_ASSERTED', `${name} input.${key}`);
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x', [key]: value } })), 'AUTHORITY_CLIENT_ASSERTED', `${name} actor.${key}`);
    }
    // `role` is already an assurance-asserting key, refused by that rule first; either way it is refused, never ignored
    assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, role: 'platform_admin' })), 'ASSURANCE_CLIENT_ASSERTED', `${name} input.role`);
    // an attestation of continuity is not a field either: the database counts governors itself
    assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, governanceContinuity: { remaining_independent_governors: 9 } })), 'INPUT_UNKNOWN_KEY', `${name} governanceContinuity`);
  }
  assert.equal(await code(svc.decideMembershipRequest(client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, requestId: '00000000-0000-4000-8000-000000000000', decision: 'APPROVE', reason: 'r', expected: { scope: 'GLOBAL' } })), 'AUTHORITY_CLIENT_ASSERTED', 'nor inside `expected`');
  assert.deepEqual({ rpc: client.calls.rpc.length, from: client.calls.from.length }, before, 'not one round trip');
});

test('S2 the contract constants and the denial vocabulary equal the database — pinned in both directions', async () => {
  const [{ p: policy }] = await owner('SELECT public.corporate_governance_policy() AS p');
  assert.equal(policy.decision_contract, GOVERNANCE_DECISION_CONTRACT);
  assert.equal(policy.decision_source, GOVERNANCE_DECISION_SOURCE);
  assert.equal(policy.assurance_class, GOVERNANCE_ASSURANCE_CLASS);
  assert.equal(policy.capability_membership_manage, GOVERNANCE_CAPABILITIES.MEMBERSHIP_MANAGE);
  assert.equal(policy.capability_session_revoke, GOVERNANCE_CAPABILITIES.SESSION_REVOKE);
  assert.equal(policy.min_independent_governors, MIN_INDEPENDENT_GOVERNORS);
  const grantable = (await owner('SELECT unnest(public.corporate_authority_grantable_capabilities()) AS c ORDER BY 1')).map((r) => r.c);
  assert.deepEqual(grantable, Object.values(GOVERNANCE_CAPABILITIES).sort(), 'the database grants exactly the capabilities the service evaluates — and nothing else exists to grant');
  assert.equal(AUTHORITY_EVALUATOR_NAME, 'corporate_authority_evaluate');

  const migration = read(PHASE_C_MIGRATION);
  const body = migration.slice(migration.indexOf('FUNCTION public.corporate_authority_evaluate('), migration.indexOf('FUNCTION public.corporate_authority_require('));
  assert.ok(body.length > 1000, 'the evaluator body was found');
  const emitted = new Set([...body.matchAll(/(?:'reason',\s*|v_reason\s*:=\s*|v_best_reason\s*:=\s*)'([A-Z_]+)'/g)].map((m) => m[1]).filter((r) => !r.endsWith('_')));
  assert.deepEqual([...emitted].filter((r) => !AUTHORITY_DENIAL_REASONS.includes(r)), [], 'the database never gives a reason this client would call UNKNOWN');
  assert.deepEqual(AUTHORITY_DENIAL_REASONS.filter((r) => !r.startsWith('STATE_') && !emitted.has(r)), [], 'and the client lists no reason the database cannot give');
  assert.deepEqual(AUTHORITY_DENIAL_REASONS.filter((r) => r.startsWith('STATE_')).sort(), ['STATE_APPROVED', 'STATE_EXPIRED', 'STATE_REQUESTED', 'STATE_REVOKED', 'STATE_SUSPENDED'], 'every non-ACTIVE assignment state has its own reason');
  assert.deepEqual(parseAuthorityDenials('[{"capability":"x","reason":"NO_ASSIGNMENT","assignment_id":null}]'), [denial('x', 'NO_ASSIGNMENT')]);
  assert.deepEqual(parseAuthorityDenials('not json'), []);
  assert.deepEqual(parseAuthorityDenials(undefined), []);
});

// ── S3 — A1 is proven server-side; a client can only be refused ───────────────────────────────────────────────────────────

test('S3 A1 is derived from the actor\'s own session row and is only ever A1_RECENT_REAUTH', async () => {
  const alice = await actorOf('g-alice');
  const proof = await proveActorAssuranceA1(client, alice);
  assert.equal(proof.assurance_class, 'A1_RECENT_REAUTH');
  assert.equal(CORPORATE_ASSURANCE_CLASS, 'A1_RECENT_REAUTH');
  assert.equal(proof.server_proven, true);
  assert.match(proof.session_id, /^s-g-alice-/);
  assert.doesNotMatch(JSON.stringify(proof), /A2|strong/i, 'A2 is never claimed');
  assert.equal(STEP_UP_TTL_MS[ACTION_CLASSES.SENSITIVE], 15 * MINUTE, 'the window is the repository\'s sensitive_action window');
});

test('S3 refusals: no/foreign/expired/invalid session, stale or missing step-up, unsupported method, unreadable row', async () => {
  const a = (o) => actorOf('g-alice', o).then((x) => proveActorAssuranceA1(client, x).then(() => null, (e) => e.code));
  assert.equal(await a({ stepUp: { ageMs: 14 * MINUTE, method: 'password_reauth' } }), null, 'inside the 15 minute window');
  assert.equal(await a({ stepUp: { ageMs: 16 * MINUTE, method: 'password_reauth' } }), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await a({ stepUp: null }), 'ASSURANCE_A1_REQUIRED', 'authenticated but never re-authenticated');
  assert.equal(await a({ stepUp: { ageMs: 0, method: 'webauthn' } }), 'ASSURANCE_A1_REQUIRED', 'a method the platform cannot verify confers nothing');
  assert.equal(await a({ stepUp: { ageMs: 0, method: 'totp' } }), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await a({ stepUp: { ageMs: -5 * MINUTE, method: 'password_reauth' } }), 'ASSURANCE_A1_REQUIRED', 'a step-up in the future proves nothing');
  assert.equal(await a({ valid: false }), 'ASSURANCE_SESSION_INVALID');
  assert.equal(await a({ expiresInMs: -1000 }), 'ASSURANCE_SESSION_INVALID');

  const alice = await actorOf('g-alice');
  const bobSession = await actorOf('g-bob');
  assert.equal(await proveActorAssuranceA1(client, { userId: 'g-alice', sessionToken: bobSession.sessionToken }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID', 'another account\'s session is not mine');
  assert.equal(await proveActorAssuranceA1(client, { userId: 'g-alice', sessionToken: 'tok-does-not-exist' }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID');
  assert.equal(await proveActorAssuranceA1(client, { userId: 'g-alice' }).catch((e) => e.code), 'ASSURANCE_SESSION_REQUIRED', 'an asserted identity has no session');
  assert.equal(await proveActorAssuranceA1(client, { userId: 'g-alice', sessionToken: '   ' }).catch((e) => e.code), 'ASSURANCE_SESSION_REQUIRED');
  assert.equal(await proveActorAssuranceA1(client, { sessionToken: alice.sessionToken }).catch((e) => e.code), 'ACTOR_REQUIRED');
  assert.equal(await proveActorAssuranceA1(client, null).catch((e) => e.code), 'ACTOR_REQUIRED');

  client.faults.add('select:user_sessions');
  assert.equal(await proveActorAssuranceA1(client, alice).catch((e) => e.code), 'ASSURANCE_UNREADABLE', 'a read that failed is never an allow');
  client.faults.clear();
  const garbled = await actorOf('g-alice');
  await db.query(`UPDATE user_sessions SET expires_at = 'not-a-date' WHERE token = $1`, [garbled.sessionToken]);
  assert.equal(await proveActorAssuranceA1(client, garbled).catch((e) => e.code), 'ASSURANCE_UNREADABLE');
});

test('S3 defence in depth: a session row that is another account\'s, or no longer valid, is refused even if the store returned it', async () => {
  const seen = [];
  const returning = (row) => ({ from: (table) => { seen.push(['from', table]); const q = { select: () => q, eq: (column, value) => { seen.push([column, value]); return q; }, single: async () => ({ data: row, error: null }) }; return q; } });
  const live = { id: 's-evil', user_id: 'g-bob', is_valid: true, created_at: iso(-HOUR), expires_at: iso(HOUR), auth_method: 'password', step_up_at: iso(0), step_up_method: 'password_reauth' };
  assert.equal((await proveActorAssuranceA1(returning({ ...live, user_id: 'g-alice' }), { userId: 'g-alice', sessionToken: 'tok-x' })).assurance_class, 'A1_RECENT_REAUTH', 'positive control: the same row for the right account is accepted');
  assert.deepEqual(seen, [['from', 'user_sessions'], ['token', 'tok-x']], 'AUTH-05 resolves by the exact high-entropy token; the returned identity and validity are still independently re-checked below rather than trusted');
  assert.equal(await proveActorAssuranceA1(returning(live), { userId: 'g-alice', sessionToken: 'tok-x' }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID', 'someone else\'s row');
  assert.equal(await proveActorAssuranceA1(returning({ ...live, user_id: 'g-alice', is_valid: false }), { userId: 'g-alice', sessionToken: 'tok-x' }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID', 'a revoked row');
});

test('S3 the injected clock is for tests only: a value that is not epoch milliseconds is refused, never coerced', async () => {
  const sub = await newUser('s3n');
  const alice = await actorOf('g-alice');
  const input = () => ({ actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x' });
  for (const now of [Number.NaN, Infinity, '2026-10-14', {}]) assert.equal(await code(svc.createPendingMembership(client, input(), { now })), 'INPUT_INVALID', String(now));
});

test('S3 a client can never assert A1: every entry point refuses an assurance, header or request object — before any I/O', async () => {
  const smuggled = [
    ['assurance', { class: 'A1_RECENT_REAUTH' }], ['authenticationAssurance', { satisfied: true }], ['step_up_at', new Date().toISOString()],
    ['stepUpAt', 'now'], ['headers', { 'x-step-up': 'A1' }], ['x-assurance', 'A1'], ['req', { headers: {} }], ['a1', true], ['a2', true], ['mfa', true],
  ];
  const rpcBefore = client.calls.rpc.length;
  const fromBefore = client.calls.from.length;
  for (const name of SERVICE_ENTRYPOINTS) {
    for (const [key, value] of smuggled) {
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, [key]: value })), 'ASSURANCE_CLIENT_ASSERTED', `${name} input.${key}`);
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x', [key]: value } })), 'ASSURANCE_CLIENT_ASSERTED', `${name} actor.${key}`);
    }
    assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, somethingElse: 1 })), 'INPUT_UNKNOWN_KEY', `${name} unknown key`);
    assert.equal(await code(svc[name](client, null)), 'INPUT_INVALID');
  }
  assert.equal(client.calls.rpc.length, rpcBefore, 'no database call was made — not even the evaluator');
  assert.equal(client.calls.from.length, fromBefore, 'no table was read');
});

test('S3 a fresh A1 session is required by every mutation: a stale one is refused first, and nothing is written', async () => {
  const subject = await newUser('s3');
  const stale = await actorOf('g-alice', { stepUp: { ageMs: 16 * MINUTE, method: 'password_reauth' } });
  const before = await owner('SELECT COUNT(*)::int AS n FROM corporate_membership_requests');
  const callsBefore = client.calls.rpc.length;
  assert.equal(await code(svc.createPendingMembership(client, { actor: stale, subjectUserId: subject, orgNodeId: NODE, reason: 'r', reference: 'ref' })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(client.calls.rpc.length, callsBefore, 'refused before the evaluator and before any entry point: A1 comes first');
  assert.deepEqual(await owner('SELECT COUNT(*)::int AS n FROM corporate_membership_requests'), before);
  // the database refuses the same thing if the service is bypassed — for an actor who DOES hold authority (the A1 proof is repeated inside the transaction)
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: stale.userId, p_actor_session_id: sessionIdOf(stale), p_subject_user_id: subject }))), 'ASSURANCE_A1_REQUIRED');
  // authority is not assurance and assurance is not authority: a fresh A1 session of an actor WITHOUT authority is refused for the other reason
  const legacy = await actorOf('u-admin');
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: 'u-admin', p_actor_session_id: sessionIdOf(legacy), p_subject_user_id: subject }))), 'AUTHORITY_DENIED');
  // and the control that proves the harness could pass: the same call with a fresh A1 session of a governor succeeds
  const fresh = await actorOf('g-alice');
  assert.equal((await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: 'g-alice', p_actor_session_id: sessionIdOf(fresh), p_subject_user_id: subject }))).error, null);
});

// ── S4 — wiring: the full lifecycle through real SQL, authority from persistent grants ─────────────────────────────────────

test('S4 PENDING → ACTIVE → SUSPENDED → ACTIVE → ENDED: independent custody at each gate, exactly one lifecycle event per accepted mutation', async () => {
  const mark = client.calls.rpc.length;
  const subject = await newUser('s4b');
  const alice = await actorOf('g-alice');
  const bob = await actorOf('g-bob');
  const created = await createMembership(subject, NODE, alice);
  const id = created.membership_id;

  const act = await submit('ACTIVATE', id, subject, NODE, alice);
  const approved = await approve(act, bob);
  const activated = await execute(act, alice);
  assert.deepEqual([activated.from_state, activated.state, activated.event_seq], ['PENDING', 'ACTIVE', 2]);
  assert.equal((await svc.readMembershipRequestStatus(client, act.request_id)).status, 'EXECUTED');

  const suspended = await suspend(id, subject, NODE, alice);
  assert.deepEqual([suspended.from_state, suspended.state, suspended.event_seq], ['ACTIVE', 'SUSPENDED', 3]);

  const restore = await submit('RESTORE', id, subject, NODE, alice);
  await approve(restore, bob);
  const restored = await execute(restore, bob); // the approving checker may execute it too
  assert.deepEqual([restored.from_state, restored.state, restored.event_seq], ['SUSPENDED', 'ACTIVE', 4]);

  const ended = await end(id, subject, NODE, alice);
  assert.deepEqual([ended.from_state, ended.state, ended.event_seq], ['ACTIVE', 'ENDED', 5]);

  const events = await owner('SELECT event_seq, event_type, from_state, to_state, reference FROM corporate_membership_events WHERE membership_id = $1 ORDER BY event_seq', [id]);
  assert.deepEqual(events.map((e) => `${e.from_state ?? '-'}>${e.to_state}`), ['->PENDING', 'PENDING>ACTIVE', 'ACTIVE>SUSPENDED', 'SUSPENDED>ACTIVE', 'ACTIVE>ENDED']);
  for (const e of events) assert.match(e.reference, /^CMR:[0-9a-f-]{36};/, 'every event traces to its request');
  assert.equal(await eventCount(id), 5, 'exactly one lifecycle event per accepted mutation');

  // every result names the persistent assignment the DATABASE relied on — the acting governor's own, and only that
  const relied = (result) => result.authority.assignments.map((a) => [a.capability, a.assignment_id, a.membership_id]);
  const aliceGrant = [[MANAGE, governors['g-alice'].manageId, governors['g-alice'].membershipId]];
  const bobGrant = [[MANAGE, governors['g-bob'].manageId, governors['g-bob'].membershipId]];
  assert.equal(created.authority.derivation, 'persistent_assignments');
  for (const [name, result, expected] of [['create', created, aliceGrant], ['request', act, aliceGrant], ['approve', approved, bobGrant], ['execute', activated, aliceGrant], ['suspend', suspended, aliceGrant], ['restore (executed by the checker)', restored, bobGrant], ['end', ended, aliceGrant]]) {
    assert.deepEqual(relied(result), expected, name);
  }

  // no call this service made ever carried a decision: authority is not a parameter any more
  for (const call of client.calls.rpc.slice(mark)) assert.equal('p_governance_decision' in call.params, false, `${call.name} carries no decision`);
  assert.deepEqual([...new Set(client.calls.rpc.slice(mark).map((c) => c.name))].sort(), [...ENTRY_POINTS.filter((n) => n !== 'corporate_authority_request_cancel'), AUTHORITY_EVALUATOR_RPC].sort());

  // ENDED is terminal — nothing moves it, and a later relationship is a NEW membership
  const beforeIllegal = rpcCount();
  assert.equal(await code(suspend(id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(end(id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(submit('ACTIVATE', id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(submit('RESTORE', id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(rpcCount(), beforeIllegal, 'every illegal transition is refused before an entry point is called');
  const again = await createMembership(subject, NODE, alice);
  assert.notEqual(again.membership_id, id);
  assert.equal(again.state, 'PENDING');
});

test('S4 every request and approval is preserved with the facts the directive lists — and the decision on record is the database\'s, naming the assignment it rested on', async () => {
  const subject = await newUser('s4c');
  const alice = await actorOf('g-alice');
  const bob = await actorOf('g-bob');
  const { membership_id: id } = await createMembership(subject, NODE, alice);
  const act = await submit('ACTIVATE', id, subject, NODE, alice);
  await approve(act, bob);
  await execute(act, alice);

  const [r] = await owner('SELECT * FROM corporate_membership_requests WHERE request_id = $1', [act.request_id]);
  assert.equal(r.operation, 'ACTIVATE');
  assert.equal(r.membership_id, id);
  assert.equal(r.subject_user_id, subject);
  assert.equal(r.org_node_id, NODE);
  assert.equal(r.from_state, 'PENDING');
  assert.equal(r.to_state, 'ACTIVE');
  assert.equal(r.requester_user_id, 'g-alice');
  assert.equal(r.request_reason, 'ACTIVATE please');
  assert.match(r.request_reference, /^REQ-\d+$/);
  assert.ok(r.requested_at);
  assert.equal(r.requester_assurance_class, 'A1_RECENT_REAUTH');
  assert.ok(r.requester_assurance_proven_at, 'the moment the re-authentication actually happened');
  assert.equal(r.governance_decision.source, 'target_corporate_governance');
  assert.equal(r.governance_decision.evaluator.name, AUTHORITY_EVALUATOR_NAME, 'generated by the database evaluator, not carried in by a caller');
  assert.equal(r.governance_decision.provenance.derivation, 'persistent_assignments');
  assert.deepEqual(r.governance_decision.provenance.assignments.map((a) => [a.capability, a.assignment_id]), [[MANAGE, governors['g-alice'].manageId]], 'the ledger names the exact assignment relied on');
  const steps = await owner('SELECT step_seq, step_type, actor_user_id, assurance_class, outcome_classification, occurred_at, result_event_seq, governance_decision FROM corporate_membership_request_steps WHERE request_id = $1 ORDER BY step_seq', [act.request_id]);
  assert.deepEqual(steps.map((s) => [s.step_type, s.actor_user_id, s.assurance_class]), [['APPROVED', 'g-bob', 'A1_RECENT_REAUTH'], ['EXECUTED', 'g-alice', 'A1_RECENT_REAUTH']]);
  assert.deepEqual(steps.map((s) => s.governance_decision.provenance.assignments[0].assignment_id), [governors['g-bob'].manageId, governors['g-alice'].manageId], 'each step rests on ITS actor\'s assignment');
  assert.ok(steps.every((s) => s.occurred_at), 'every step is timestamped');
  assert.equal(steps[1].result_event_seq, 2);
  assert.notEqual(steps[0].actor_user_id, r.requester_user_id, 'maker ≠ checker is a stored fact');
  // directly-executed operations are recorded the same way, as an already-executed request
  const sus = await suspend(id, subject, NODE, alice);
  const [direct1] = await owner('SELECT operation, approval_required, requester_user_id FROM corporate_membership_requests WHERE request_id = $1', [sus.request_id]);
  assert.deepEqual([direct1.operation, direct1.approval_required, direct1.requester_user_id], ['SUSPEND', false, 'g-alice']);
});

// ── S5 — maker/checker and no-self-action, at the service AND the database ────────────────────────────────────────────────

test('S5 the subject never acts on their own membership: refused by the service before the evaluator or any entry point is called', async () => {
  const node = 'BU_FINANCIAL_SERVICES';
  const carol = await actorOf('g-carol'); // a governor, so authority and A1 are genuinely fine — only the self-action is wrong
  const alice = await actorOf('g-alice');
  const mine = await createMembership('g-carol', node, alice); // a membership whose subject is carol, created by someone else
  const req = await submit('ACTIVATE', mine.membership_id, 'g-carol', node, alice);

  const probes = {
    create: () => svc.createPendingMembership(client, { actor: carol, subjectUserId: 'g-carol', orgNodeId: NODE, reason: 'r', reference: 'ref' }),
    activate: () => submit('ACTIVATE', mine.membership_id, 'g-carol', node, carol),
    restore: () => submit('RESTORE', mine.membership_id, 'g-carol', node, carol),
    suspend: () => suspend(mine.membership_id, 'g-carol', node, carol),
    end: () => end(mine.membership_id, 'g-carol', node, carol),
    approve: () => approve(req, carol),
    execute: () => execute(req, carol),
    cancel: () => svc.cancelMembershipRequest(client, { actor: carol, requestId: req.request_id, reason: 'no' }),
  };
  const before = rpcCount();
  const evaluations = evaluatorCount();
  for (const [name, run] of Object.entries(probes)) assert.equal(await code(run()), 'ACTOR_IS_SUBJECT', name);
  assert.equal(rpcCount(), before, 'none of the refused self-actions reached an entry point');
  assert.equal(evaluatorCount(), evaluations, 'nor even the evaluator');
  assert.equal((await membershipRow(mine.membership_id)).state, 'PENDING');

  // … and the database refuses the very same acts if the service is bypassed — although carol genuinely holds the authority
  const via = (name, args) => direct(name, args).then(dbCode);
  const carolSession = sessionIdOf(carol);
  assert.equal(await via('corporate_authority_request_submit', { p_operation: 'ACTIVATE', p_membership_id: mine.membership_id, p_requester_user_id: 'g-carol', p_requester_session_id: carolSession, p_reason: 'r', p_reference: 'x' }), 'ACTOR_IS_SUBJECT');
  assert.equal(await via('corporate_authority_request_decide', { p_request_id: req.request_id, p_checker_user_id: 'g-carol', p_checker_session_id: carolSession, p_decision: 'APPROVE', p_reason: 'r', p_expected_subject_user_id: 'g-carol', p_expected_membership_id: mine.membership_id, p_expected_org_node_id: 'BU_FINANCIAL_SERVICES', p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest }), 'ACTOR_IS_SUBJECT');
  assert.equal(await via('corporate_authority_apply_direct', directCreate({ p_operation: 'SUSPEND', p_actor_user_id: 'g-carol', p_actor_session_id: carolSession, p_subject_user_id: 'g-carol', p_org_node_id: 'BU_FINANCIAL_SERVICES', p_membership_id: mine.membership_id })), 'ACTOR_IS_SUBJECT');
});

test('S5 maker ≠ checker: a requester can never approve their own authority-increasing request (service and database)', async () => {
  const subject = await newUser('s5mc');
  const alice = await actorOf('g-alice');
  const { membership_id: id } = await createMembership(subject, NODE, alice);
  const req = await submit('ACTIVATE', id, subject, NODE, alice);

  const before = rpcCount();
  assert.equal(await code(approve(req, alice)), 'MAKER_CHECKER_SAME_ACTOR');
  assert.equal(await code(approve(req, await actorOf('g-alice'))), 'MAKER_CHECKER_SAME_ACTOR', 'a second session of the same person is the same person');
  assert.equal(rpcCount(), before, 'refused before any entry point');

  const aliceSession = sessionIdOf(await actorOf('g-alice'));
  const bypass = await direct('corporate_authority_request_decide', {
    p_request_id: req.request_id, p_checker_user_id: 'g-alice', p_checker_session_id: aliceSession, p_decision: 'APPROVE', p_reason: 'self',
    p_expected_subject_user_id: subject, p_expected_membership_id: id, p_expected_org_node_id: NODE, p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest,
  });
  assert.equal(dbCode(bypass), 'MAKER_CHECKER_SAME_ACTOR', 'the database refuses it independently');
  assert.deepEqual(await owner(`SELECT step_type FROM corporate_membership_request_steps WHERE request_id = $1`, [req.request_id]), [], 'no approval exists');
  assert.equal(await code(execute(req, alice)), 'APPROVAL_REQUIRED', 'ACTIVE without an independent checker is impossible');
  assert.equal((await membershipRow(id)).state, 'PENDING');
});

test('S5 PENDING → ACTIVE and SUSPENDED → ACTIVE fail without independent checker custody; no direct path exists', async () => {
  const subject = await newUser('s5nc');
  const alice = await actorOf('g-alice');
  const bob = await actorOf('g-bob');
  const { membership_id: id } = await createMembership(subject, NODE, alice);
  // there is no direct ACTIVATE/RESTORE: the direct entry point refuses both operations outright
  for (const op of ['ACTIVATE', 'RESTORE']) {
    const r = await direct('corporate_authority_apply_direct', directCreate({ p_operation: op, p_actor_session_id: sessionIdOf(alice), p_subject_user_id: subject, p_membership_id: id }));
    assert.equal(dbCode(r), 'OPERATION_NOT_DIRECT', op);
  }
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: id, subjectUserId: subject, orgNodeId: NODE, classification: 'ROUTINE', reason: 'r', reference: 'x' })), 'ILLEGAL_TRANSITION', 'PENDING cannot be suspended');

  const req = await submit('ACTIVATE', id, subject, NODE, alice);
  assert.equal(await code(execute(req, alice)), 'APPROVAL_REQUIRED', 'a request alone executes nothing');
  assert.equal(await code(execute(req, bob)), 'APPROVAL_REQUIRED');
  await approve(req, bob, 'REFUSE');
  assert.equal(await code(execute(req, alice)), 'REQUEST_NOT_EXECUTABLE', 'a REFUSED request is dead');
  assert.equal((await membershipRow(id)).state, 'PENDING');

  // restoration: same rule
  const { membershipId, created: made } = await makeActive(await newUser('s5nc2'), 'BU_DIASPORA_TRADE');
  await suspend(membershipId, made.subject_user_id, 'BU_DIASPORA_TRADE', alice);
  const restore = await submit('RESTORE', membershipId, made.subject_user_id, 'BU_DIASPORA_TRADE', alice);
  assert.equal(await code(execute(restore, alice)), 'APPROVAL_REQUIRED');
  assert.equal((await membershipRow(membershipId)).state, 'SUSPENDED');
});

test('S5 suspension and ending work under the single-authorised-actor rule; the executor of an approval is a party to it', async () => {
  const { membershipId, created } = await makeActive(await newUser('s5sa'), 'BU_FINANCIAL_SERVICES');
  const subject = created.subject_user_id;
  const dave = await actorOf('g-dave'); // a governor who was never part of this membership
  const s = await suspend(membershipId, subject, 'BU_FINANCIAL_SERVICES', dave);
  assert.equal(s.state, 'SUSPENDED');
  assert.equal(await eventCount(membershipId), 3);
  assert.equal((await end(membershipId, subject, 'BU_FINANCIAL_SERVICES', dave)).state, 'ENDED', 'a SUSPENDED membership may be ended by one administrator');

  // a stranger cannot execute someone else's approved request (only the requester or the approving checker may)
  const sub2 = await newUser('s5ex');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub2, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub2, NODE, alice);
  await approve(req, bob);
  assert.equal(await code(execute(req, dave)), 'EXECUTOR_NOT_PARTY', 'dave holds the authority — authority is not a party to the request');
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING');
  assert.equal((await execute(req, bob)).state, 'ACTIVE');
});

test('S5 ending a governor is refused unless two independent governors would remain — COUNTED by the database from persistent grants, never attested', async () => {
  const world = await openDatabase({ migrate: 'all' }); // its own world: the count must be exact, so nobody else may be a governor in it
  await installAuditTables(world);
  const wc = createServiceClient(world);
  await seedGovernor(world, 'w-alice');
  const wbob = await seedGovernor(world, 'w-bob');
  const wcarol = await seedGovernor(world, 'w-carol'); // the subject: governs the whole tree through THIS membership
  const sessionFor = async (id) => ({ userId: id, sessionToken: `tok-${await addSession(world, id)}` });
  const entryCalls = () => wc.calls.rpc.filter((c) => c.name !== AUTHORITY_EVALUATOR_RPC).length;
  const input = async (who) => ({ actor: await sessionFor(who), membershipId: wcarol.membershipId, subjectUserId: 'w-carol', orgNodeId: ROOT_NODE, reason: 'Leaves', reference: `END-${(seq += 1)}` });
  const stateOf = async () => (await world.query('SELECT state FROM corporate_memberships WHERE membership_id = $1', [wcarol.membershipId])).rows[0].state;

  // alice and bob remain besides carol: two independent governors. Take bob's authority away, and only one would remain.
  await moveAssignment(world, wbob.manageId, 'SUSPENDED');
  const before = entryCalls();
  const refused = await thrown(svc.endMembership(wc, await input('w-alice')));
  assert.deepEqual([refused?.code, refused?.details?.remaining_independent_governors], ['GOVERNANCE_CONTINUITY_PROTECTION', 1]);
  assert.equal(entryCalls(), before, 'refused by the service before any entry point');
  assert.equal(await stateOf(), 'ACTIVE');
  // the database repeats the refusal if the service is bypassed: it counts the governors itself, from the same rows
  const alice = await sessionFor('w-alice');
  const bypass = await wc.rpc('corporate_authority_apply_direct', directCreate({
    p_operation: 'END', p_actor_user_id: 'w-alice', p_actor_session_id: alice.sessionToken.slice(4), p_subject_user_id: 'w-carol', p_org_node_id: ROOT_NODE, p_membership_id: wcarol.membershipId }));
  assert.equal(dbCode(bypass), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await stateOf(), 'ACTIVE');
  // a caller cannot attest its way out: there is no such field, and an authority-shaped one is refused
  assert.equal(await code(svc.endMembership(wc, { ...(await input('w-alice')), governanceContinuity: { subject_holds_governance_authority: true, remaining_independent_governors: 9 } })), 'INPUT_UNKNOWN_KEY');
  assert.equal(await code(svc.endMembership(wc, { ...(await input('w-alice')), governanceDecision: decisionFor({ actor: 'w-alice', subject: 'w-carol', node: ROOT_NODE }) })), 'AUTHORITY_CLIENT_ASSERTED');
  // bob's authority returns: two independent governors remain, and the very same call is allowed
  await moveAssignment(world, wbob.manageId, 'ACTIVE');
  const ended = await svc.endMembership(wc, await input('w-alice'));
  assert.equal(ended.state, 'ENDED');
  assert.equal(await stateOf(), 'ENDED');
  assert.deepEqual(ended.authority.assignments.map((a) => a.capability), [MANAGE]);
});

test('S5 only the requester may cancel; a cancelled request can never be approved or executed', async () => {
  const sub = await newUser('s5ca');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  const beforeCancel = rpcCount();
  assert.equal(await code(svc.cancelMembershipRequest(client, { actor: bob, requestId: req.request_id, reason: 'nope' })), 'ONLY_REQUESTER_MAY_CANCEL');
  assert.equal(rpcCount(), beforeCancel, 'refused before any entry point');
  const cancelled = await svc.cancelMembershipRequest(client, { actor: alice, requestId: req.request_id, reason: 'changed my mind' });
  assert.equal(cancelled.outcome, 'CANCELLED');
  assert.deepEqual(cancelled.authority.assignments.map((a) => a.assignment_id), [governors['g-alice'].manageId]);
  assert.equal(await code(approve(req, bob)), 'REQUEST_NOT_OPEN');
  assert.equal(await code(execute(req, alice)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal((await svc.readMembershipRequestStatus(client, req.request_id)).status, 'CANCELLED');
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING');

  // a request that is already spent can no longer be withdrawn: not twice, not after a refusal, not after execution
  const cancelAgain = (r, who = alice) => svc.cancelMembershipRequest(client, { actor: who, requestId: r.request_id, reason: 'too late' });
  assert.equal(await code(cancelAgain(req)), 'REQUEST_NOT_OPEN', 'cancelled twice');
  const sub2 = await newUser('s5cb');
  const c2 = await createMembership(sub2, NODE, alice);
  const refusedReq = await submit('ACTIVATE', c2.membership_id, sub2, NODE, alice);
  await approve(refusedReq, bob, 'REFUSE');
  assert.equal(await code(cancelAgain(refusedReq)), 'REQUEST_NOT_OPEN', 'after a refusal');
  const doneReq = await submit('ACTIVATE', c2.membership_id, sub2, NODE, alice);
  await approve(doneReq, bob);
  await execute(doneReq, alice);
  assert.equal(await code(cancelAgain(doneReq)), 'REQUEST_NOT_OPEN', 'after execution');
  assert.equal((await membershipRow(c2.membership_id)).state, 'ACTIVE', 'and the executed change stands');
});

test('S5 creation is PENDING-only and mandatory-provenance: reason and reference are required, bounded, and recorded', async () => {
  const sub = await newUser('s5cr');
  const alice = await actorOf('g-alice');
  const base = { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'Joins', reference: 'HR-9' };
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: '   ' })), 'REASON_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: undefined })), 'REASON_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reference: '' })), 'REFERENCE_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: 'x'.repeat(2001) })), 'REASON_TOO_LONG');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reference: 'x'.repeat(301) })), 'REFERENCE_TOO_LONG');
  const unknownUnit = await thrown(svc.createPendingMembership(client, { ...base, orgNodeId: 'NOT_A_NODE' }));
  assert.deepEqual([unknownUnit?.code, denialsOf(unknownUnit)], ['AUTHORITY_DENIED', [denial(MANAGE, 'OUT_OF_SCOPE', governors['g-alice'].manageId)]], 'a unit that does not exist is outside every grant — never "close enough" to a scope');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, orgNodeId: 'bu_marketplace' })), 'NODE_UNKNOWN', 'identifier shape is validated before anything else');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, state: 'ACTIVE' })), 'INPUT_UNKNOWN_KEY', 'there is no way to ask for any state but PENDING');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, effectiveFrom: '2030-01-02T00:00:00Z', effectiveUntil: '2030-01-01T00:00:00Z' })), 'INPUT_INVALID');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, subjectUserId: 'nobody-by-that-name' })), 'SUBJECT_UNKNOWN', 'authority covers the unit; the person must exist');
  const ok = await svc.createPendingMembership(client, { ...base, effectiveFrom: '2031-01-01T00:00:00Z', effectiveUntil: '2032-01-01T00:00:00Z' });
  const row = await membershipRow(ok.membership_id);
  assert.equal(row.state, 'PENDING');
  assert.equal(row.created_by_user_id, 'g-alice');
  assert.equal(row.created_reason, 'Joins');
  assert.match(row.created_reference, /^CMR:[0-9a-f-]{36};HR-9$/);
  assert.equal(await code(svc.createPendingMembership(client, base)), 'MEMBERSHIP_ALREADY_LIVE', 'one live membership per account and unit');
});

// ── S6 — replay, double execution, stale and mis-bound approvals ──────────────────────────────────────────────────────────

test('S6 a consumed approval can never execute again; a second execution changes nothing and adds no event', async () => {
  const sub = await newUser('s6c');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  await approve(req, bob);
  await execute(req, alice);
  const events = await eventCount(c.membership_id);
  assert.equal(await code(execute(req, alice)), 'REQUEST_ALREADY_CONSUMED');
  assert.equal(await code(execute(req, bob)), 'REQUEST_ALREADY_CONSUMED');
  // the state moved on; a replay of the old approval cannot drag it back
  await suspend(c.membership_id, sub, NODE, alice);
  assert.equal(await code(execute(req, alice)), 'REQUEST_ALREADY_CONSUMED');
  assert.equal((await membershipRow(c.membership_id)).state, 'SUSPENDED');
  assert.equal(await eventCount(c.membership_id), events + 1, 'only the legitimate suspension added an event');
  assert.equal(await code(approve(req, bob)), 'REQUEST_NOT_OPEN', 'a spent request cannot be approved again either');
});

test('S6 an approval is bound to the exact subject, membership, unit, operation and digest the checker reviewed', async () => {
  const sub = await newUser('s6b'); const other = await newUser('s6o');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const o = await createMembership(other, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  const good = expectedOf(req);
  const decide = (expected, who = bob) => svc.decideMembershipRequest(client, { actor: who, requestId: req.request_id, decision: 'APPROVE', reason: 'ok', expected });
  const before = rpcCount();
  assert.equal(await code(decide({ ...good, subjectUserId: other })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, membershipId: o.membership_id })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, orgNodeId: 'BU_SERVICE_NETWORK' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, operation: 'RESTORE' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, bindingDigest: '0'.repeat(64) })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, bindingDigest: 'abc' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, operation: 'SUSPEND' })), 'BINDING_MISMATCH');
  assert.equal(rpcCount(), before, 'every mismatch was refused before an entry point was called');
  // the database repeats the check if the service is bypassed
  const bypass = await direct('corporate_authority_request_decide', {
    p_request_id: req.request_id, p_checker_user_id: 'g-bob', p_checker_session_id: sessionIdOf(bob), p_decision: 'APPROVE', p_reason: 'ok',
    p_expected_subject_user_id: other, p_expected_membership_id: c.membership_id, p_expected_org_node_id: NODE, p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest,
  });
  assert.equal(dbCode(bypass), 'BINDING_MISMATCH');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: req.request_id, expectedBindingDigest: '1'.repeat(64) })), 'BINDING_MISMATCH');
  assert.equal((await decide(good)).outcome, 'APPROVED');
});

test('S6 an approval cannot be used on a changed membership: the stale precondition is recorded, nothing is executed, the request is spent', async () => {
  const sub = await newUser('s6s');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  await approve(req, bob);
  await end(c.membership_id, sub, NODE, alice); // the world moves on after approval
  const events = await eventCount(c.membership_id);
  let refusal;
  try { await execute(req, alice); } catch (e) { refusal = e; }
  assert.ok(refusal instanceof CorporateGovernanceError);
  assert.equal(refusal.code, 'STALE_PRECONDITION');
  assert.equal(refusal.recorded, true, 'the refusal is itself in the ledger');
  assert.equal((await membershipRow(c.membership_id)).state, 'ENDED');
  assert.equal(await eventCount(c.membership_id), events, 'no event');
  const status = await svc.readMembershipRequestStatus(client, req.request_id);
  assert.deepEqual([status.status, status.outcome_classification], ['EXECUTION_REFUSED', 'STALE_PRECONDITION']);
  assert.equal(await code(execute(req, alice)), 'REQUEST_NOT_EXECUTABLE', 'and it stays refused — the approval is spent');
});

test('S6 an approval is bound to the membership\'s exact lifecycle POSITION, not merely its state: the same state at a later position is stale', async () => {
  const sub = await newUser('s6p');
  const node = 'BU_SERVICE_NETWORK';
  const { membershipId } = await makeActive(sub, node);
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  await suspend(membershipId, sub, node, alice); // position 3
  const first = await submit('RESTORE', membershipId, sub, node, alice); // bound to position 3
  await approve(first, bob);
  const second = await submit('RESTORE', membershipId, sub, node, alice);
  await approve(second, bob);
  await execute(second, alice); // ACTIVE, position 4
  await suspend(membershipId, sub, node, alice); // SUSPENDED again, position 5 — the SAME state `first` was approved against
  assert.equal((await membershipRow(membershipId)).state, 'SUSPENDED');
  const refused = await execute(first, alice).catch((e) => e);
  assert.ok(refused instanceof CorporateGovernanceError);
  assert.deepEqual([refused.code, refused.recorded], ['STALE_PRECONDITION', true]);
  assert.equal((await membershipRow(membershipId)).state, 'SUSPENDED', 'the old approval did not restore anything');
  assert.equal(await eventCount(membershipId), 5);
});

test('S6 expired requests and approvals are recorded refusals, never executed', async () => {
  const sub = await newUser('s6e'); const sub2 = await newUser('s6f');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const travel = async (sql, params) => { await db.exec('RESET ROLE; SET session_replication_role = replica'); try { await db.query(sql, params); } finally { await db.exec(`SET session_replication_role = origin; SET ROLE ${OWNER}`); } };

  const a = await createMembership(sub, NODE, alice);
  const old = await submit('ACTIVATE', a.membership_id, sub, NODE, alice);
  await approve(old, bob);
  await travel("UPDATE corporate_membership_request_steps SET occurred_at = now() - interval '31 minutes' WHERE request_id = $1 AND step_type = 'APPROVED'", [old.request_id]);
  const staleApproval = await execute(old, alice).catch((e) => e);
  assert.ok(staleApproval instanceof CorporateGovernanceError);
  assert.deepEqual([staleApproval.code, staleApproval.recorded], ['APPROVAL_EXPIRED', true]);
  assert.equal((await membershipRow(a.membership_id)).state, 'PENDING');

  const b = await createMembership(sub2, NODE, alice);
  const lapsed = await submit('ACTIVATE', b.membership_id, sub2, NODE, alice);
  await travel("UPDATE corporate_membership_requests SET requested_at = now() - interval '4 days', expires_at = now() - interval '1 day' WHERE request_id = $1", [lapsed.request_id]);
  const expired = await approve(lapsed, bob).catch((e) => e);
  assert.ok(expired instanceof CorporateGovernanceError);
  assert.deepEqual([expired.code, expired.recorded], ['REQUEST_EXPIRED', true]);
  assert.equal((await membershipRow(b.membership_id)).state, 'PENDING');

  // the request's own lifetime can end INSIDE the approval's window: approved five minutes ago, but the request itself expired a minute ago
  const sub3 = await newUser('s6g');
  const c3 = await createMembership(sub3, NODE, alice);
  const r3 = await submit('ACTIVATE', c3.membership_id, sub3, NODE, alice);
  await approve(r3, bob);
  await travel("UPDATE corporate_membership_requests SET requested_at = now() - interval '72 hours 1 minute', expires_at = now() - interval '1 minute' WHERE request_id = $1", [r3.request_id]);
  await travel("UPDATE corporate_membership_request_steps SET occurred_at = now() - interval '5 minutes' WHERE request_id = $1 AND step_type = 'APPROVED'", [r3.request_id]);
  const lapsed2 = await execute(r3, alice).catch((e) => e);
  assert.ok(lapsed2 instanceof CorporateGovernanceError);
  assert.deepEqual([lapsed2.code, lapsed2.recorded], ['REQUEST_EXPIRED', true], 'a fresh approval does not outlive its request');
  assert.equal((await membershipRow(c3.membership_id)).state, 'PENDING');
});

// ── S7 — SECURITY_COMPROMISE: selective session propagation (OD-CARBAC-020) ───────────────────────────────────────────────

const liveSessions = async (userId) => Number((await owner('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = $1 AND is_valid IS TRUE', [userId]))[0].n);
const COMPROMISE = { input: { classification: 'SECURITY_COMPROMISE' } };

test('S7 a ROUTINE suspension revokes no session; a SECURITY_COMPROMISE suspension revokes every live session first, through the existing primitive', async () => {
  const sub = await newUser('s7');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub); await addSession(db, sub, { stepUp: null });
  assert.equal(await liveSessions(sub), 2);

  const routine = await suspend(membershipId, sub, NODE, await actorOf('g-dave'));
  assert.equal(routine.session_revocation, undefined, 'routine suspension carries no revocation');
  assert.equal(await liveSessions(sub), 2, 'the account stays signed in everywhere else');

  // restore, then suspend for compromise
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const restore = await submit('RESTORE', membershipId, sub, NODE, alice);
  await approve(restore, bob); await execute(restore, alice);
  const auditBefore = Number((await owner(`SELECT COUNT(*) AS n FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED'`))[0].n);

  const result = await suspend(membershipId, sub, NODE, alice, { input: { classification: 'SECURITY_COMPROMISE', reference: 'SEC-77' } });
  assert.equal(result.state, 'SUSPENDED');
  assert.equal(result.session_revocation.scope, 'all');
  assert.equal(result.session_revocation.revoked_count, 2);
  assert.equal(await liveSessions(sub), 0, 'nothing left usable');
  assert.deepEqual(result.authority.assignments.map((a) => a.capability).sort(), [MANAGE, REVOKE_SESSIONS], 'both capabilities were relied on — each by its own assignment');
  const [ledger] = await owner('SELECT classification, session_revocation, governance_decision FROM corporate_membership_requests WHERE request_id = $1', [result.request_id]);
  assert.equal(ledger.classification, 'SECURITY_COMPROMISE');
  assert.equal(ledger.session_revocation.primitive, 'sessionSecurityService.revokeSessionsForUser');
  assert.equal(ledger.session_revocation.revoked_count, 2);
  assert.deepEqual([...ledger.governance_decision.capabilities].sort(), [MANAGE, REVOKE_SESSIONS]);
  assert.doesNotMatch(JSON.stringify(ledger.session_revocation), /tok-/, 'session ids only, never a token');
  const audit = await owner(`SELECT actor_user_id, new_value FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED' ORDER BY id DESC LIMIT 1`);
  assert.equal(Number((await owner(`SELECT COUNT(*) AS n FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED'`))[0].n), auditBefore + 1, 'the repository\'s own session audit was written');
  assert.equal(audit[0].actor_user_id, 'g-alice');
  assert.equal(audit[0].new_value.revoked_count, 2);
});

test('S7 compromise needs the session-revoke capability — and is denied BEFORE any session is touched, at the service and at the database', async () => {
  const sub = await newUser('s7c');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub);
  const alice = await actorOf('g-alice');
  const erin = await actorOf('g-erin'); // holds membership.manage, holds NO session.revoke
  const before = rpcCount();
  const refused = await thrown(suspend(membershipId, sub, NODE, erin, COMPROMISE));
  assert.deepEqual([refused?.code, denialsOf(refused)], ['AUTHORITY_DENIED', [denial(REVOKE_SESSIONS, 'NO_ASSIGNMENT')]], 'the held capability is fine; the missing one is named');
  assert.equal(await liveSessions(sub), 1, 'no session was revoked');
  assert.equal(rpcCount(), before, 'no entry point was called');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
  // classification is never available outside SUSPEND
  assert.equal(await code(svc.endMembership(client, { actor: alice, membershipId, subjectUserId: sub, orgNodeId: NODE, classification: 'SECURITY_COMPROMISE', reason: 'r', reference: 'x' })), 'CLASSIFICATION_NOT_ALLOWED');
  assert.equal(await code(suspend(membershipId, sub, NODE, alice, { input: { classification: 'SOMETHING_ELSE' } })), 'CLASSIFICATION_INVALID');
  // the entry point itself: a compromise suspension without a revocation record, or while a session is live, is refused; and it needs BOTH capabilities
  const args = (actor, revocation) => directCreate({ p_operation: 'SUSPEND', p_actor_user_id: actor.userId, p_actor_session_id: sessionIdOf(actor), p_subject_user_id: sub, p_membership_id: membershipId,
    p_classification: 'SECURITY_COMPROMISE', p_session_revocation: revocation });
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', args(alice, null))), 'SESSION_REVOCATION_REQUIRED');
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', args(alice, { claimed: 'revoked' }))), 'SESSIONS_STILL_VALID', 'a claim is not a revocation');
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', args(erin, { claimed: 'revoked' }))), 'AUTHORITY_DENIED', 'the database requires the revoke grant itself — the service is not the only place that checks');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
  // the same actor may still do the ROUTINE act: manage is enough for that
  assert.equal((await suspend(membershipId, sub, NODE, erin)).state, 'SUSPENDED');
});

test('S7 if revocation fails or cannot be audited, nothing is suspended', async () => {
  const sub = await newUser('s7f');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub);
  const alice = await actorOf('g-alice');
  const compromise = () => suspend(membershipId, sub, NODE, alice, COMPROMISE);

  client.faults.add('update:user_sessions');
  assert.equal(await code(compromise()), 'SESSION_REVOCATION_FAILED');
  assert.equal(await liveSessions(sub), 1, 'the failed revocation changed nothing');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
  client.faults.clear();

  client.faults.add('insert:trust_audit_events');
  assert.equal(await code(compromise()), 'SESSION_REVOCATION_FAILED', 'an unauditable revocation is a failure');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE', 'fail closed: no suspension without its audit');
  assert.equal(await liveSessions(sub), 0, 'the sessions that WERE revoked stay revoked — the protective side of the failure');
  client.faults.clear();
  assert.equal(Number((await owner(`SELECT COUNT(*) AS n FROM corporate_membership_requests WHERE membership_id = $1 AND operation = 'SUSPEND'`, [membershipId]))[0].n), 0, 'no request was recorded');
});

test('S7 an account that signs in again between revocation and suspension is revoked again (bounded), and a persistent race fails closed', async () => {
  const sub = await newUser('s7r');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub);
  const alice = await actorOf('g-alice');
  let injected = 0;
  client.beforeRpc = async (name) => { if (name === 'corporate_authority_apply_direct' && injected < 1) { injected += 1; await addSession(db, sub); } };
  const result = await suspend(membershipId, sub, NODE, alice, COMPROMISE);
  assert.equal(result.session_revocation.attempts, 2);
  assert.equal(result.session_revocation.revoked_count, 1, 'the login that raced in was revoked too');
  assert.equal(await liveSessions(sub), 0);

  const sub2 = await newUser('s7p');
  const { membershipId: id2 } = await makeActive(sub2, NODE);
  client.beforeRpc = async (name) => { if (name === 'corporate_authority_apply_direct') await addSession(db, sub2); };
  assert.equal(await code(suspend(id2, sub2, NODE, alice, COMPROMISE)), 'SESSIONS_STILL_VALID');
  assert.equal((await membershipRow(id2)).state, 'ACTIVE', 'never suspended while the identity is usable');
});

test('S7 creation, activation, restoration and ending do not touch the subject\'s sessions or unrelated relationships', async () => {
  const sub = await newUser('s7n');
  await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', $1, 'member')`, [sub]);
  await db.query(`INSERT INTO organization_users (organization_id, user_id, role) VALUES ('O-1', $1, 'member')`, [sub]);
  await addSession(db, sub); await addSession(db, sub);
  const identityBefore = await snapshot(db, IDENTITY_TABLES);
  const { membershipId } = await makeActive(sub, NODE);
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  await suspend(membershipId, sub, NODE, alice);
  const restore = await submit('RESTORE', membershipId, sub, NODE, alice);
  await approve(restore, bob); await execute(restore, alice);
  await end(membershipId, sub, NODE, alice);
  assert.equal(await liveSessions(sub), 2, 'no lifecycle step other than a compromise suspension revokes anything');
  assert.equal(await snapshot(db, IDENTITY_TABLES), identityBefore, 'users, tenants, tenant_users, organizations and organization_users are byte-identical');
  assert.equal(Number((await owner('SELECT COUNT(*) AS n FROM tenant_users WHERE user_id = $1', [sub]))[0].n), 1);
  assert.equal(Number((await owner('SELECT COUNT(*) AS n FROM organization_users WHERE user_id = $1', [sub]))[0].n), 1);
});

// ── S8 — invalidation seam ───────────────────────────────────────────────────────────────────────────────────────────────

test('S8 every accepted lifecycle mutation fires one invalidation with the right identity and effect; nothing else does', async () => {
  const sub = await newUser('s8');
  const seen = [];
  onCorporateAuthorizationInvalidated((event) => { seen.push(event); });
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');

  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  await approve(req, bob);
  assert.equal(seen.length, 1, 'creation fired; a request and an approval did not');
  await execute(req, alice);
  await suspend(c.membership_id, sub, NODE, alice);
  await end(c.membership_id, sub, NODE, alice);
  assert.deepEqual(seen.map((e) => `${e.operation}:${e.from_state ?? '-'}>${e.to_state}:${e.authority_effect}`), [
    'CREATE:->PENDING:NO_CAPABILITY_GRANTED', 'ACTIVATE:PENDING>ACTIVE:NO_CAPABILITY_GRANTED', 'SUSPEND:ACTIVE>SUSPENDED:DENY_IMMEDIATELY', 'END:SUSPENDED>ENDED:DENY_IMMEDIATELY']);
  assert.deepEqual(seen.map((e) => e.authorization_epoch), [1, 2, 3, 4], 'the epoch rises by exactly one per accepted mutation');
  for (const e of seen) {
    assert.equal(e.contract, AUTHORIZATION_INVALIDATION_CONTRACT);
    assert.equal(e.subject_user_id, sub);
    assert.equal(e.membership_id, c.membership_id);
    assert.equal(e.org_node_id, NODE);
    assert.ok(Object.isFrozen(e));
    assert.doesNotMatch(JSON.stringify(e), /reason|token|decision|reference|assignment|provenance/i, 'identity of the change only');
  }
  const [epoch] = await owner('SELECT authorization_epoch FROM corporate_membership_authorization_epoch WHERE user_id = $1', [sub]);
  assert.equal(Number(epoch.authorization_epoch), 4);

  // refused and recorded-but-not-executed calls fire nothing
  const before = seen.length;
  await code(suspend(c.membership_id, sub, NODE, alice)); // ENDED → illegal
  await code(svc.createPendingMembership(client, { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: '', reference: 'x' }));
  assert.equal(seen.length, before);
});

test('S8 a listener that throws or rejects never undoes the committed change and is reported, not hidden', async () => {
  const sub = await newUser('s8l');
  const calls = [];
  onCorporateAuthorizationInvalidated(() => { throw new Error('cache down'); });
  onCorporateAuthorizationInvalidated(async () => { throw new Error('cache rejects'); });
  onCorporateAuthorizationInvalidated((event) => { calls.push(event.to_state); });
  const alice = await actorOf('g-alice');
  const c = await createMembership(sub, NODE, alice);
  assert.deepEqual(c.invalidation, { notified: 1, failed: 2 });
  assert.deepEqual(calls, ['PENDING'], 'a failing listener does not stop the others');
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING', 'and the mutation stands');
  assert.throws(() => onCorporateAuthorizationInvalidated('nope'), TypeError);
});

// ── S9 — zero capability, immediate denial, identity tables untouched ────────────────────────────────────────────────────

test('S9 an ACTIVE membership grants zero capability; suspension and end deny at once; nothing outside Corporate tables changes', async () => {
  const sub = await newUser('s9');
  const identityBefore = await snapshot(db, IDENTITY_TABLES);
  const { membershipId, done } = await makeActive(sub, NODE);
  assert.equal(done.grants_capability, false);
  const active = await resolveCorporateMembership(client, sub);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.grants_capability, false);
  assert.deepEqual([...active.capabilities], []);
  assert.deepEqual(Object.keys(await membershipRow(membershipId)).filter((c) => /capab|permission|grant|role/i.test(c)), [], 'no capability column exists on a membership to be written');

  const alice = await actorOf('g-alice');
  await suspend(membershipId, sub, NODE, alice);
  const denied = await resolveCorporateMembership(client, sub);
  assert.equal(denied.is_active_member, false, 'the very next resolution already denies');
  assert.equal(denied.state, 'SUSPENDED');
  await end(membershipId, sub, NODE, alice);
  assert.equal((await resolveCorporateMembership(client, sub)).state, 'ENDED');
  assert.equal(await snapshot(db, IDENTITY_TABLES), identityBefore, 'users.role, tenant_users, external tenant memberships and organization_users never change');
});

test('S9 the governed lifecycle is a no-op for every other authority table a Corporate change could be confused with', async () => {
  const roles = await owner('SELECT id, role FROM users ORDER BY id');
  const assignmentsBefore = await owner('SELECT assignment_id, state, subject_user_id, capability FROM corporate_permission_assignments ORDER BY assignment_id');
  const sub = await newUser('s9b');
  const { membershipId } = await makeActive(sub, 'BU_DIASPORA_TRADE');
  await end(membershipId, sub, 'BU_DIASPORA_TRADE', await actorOf('g-alice'));
  const after = await owner('SELECT id, role FROM users ORDER BY id');
  assert.deepEqual(after.filter((u) => u.id !== sub), roles, 'no other account\'s role changed');
  assert.equal(after.find((u) => u.id === sub).role, 'owner', 'and the subject\'s own platform role is exactly what it was');
  assert.deepEqual(await owner('SELECT assignment_id, state, subject_user_id, capability FROM corporate_permission_assignments ORDER BY assignment_id'), assignmentsBefore, 'a membership lifecycle never creates, changes or removes a permission assignment');
});

// ── S10 — legacy platform roles, tenants, ACTIVE memberships and fabricated authority are not authority ─────────────────

const LEGACY = ['u-admin', 'u-padmin', 'u-sadmin', 'u-tadmin', 'u-lorg'];
const NO_ASSIGNMENT = [denial(MANAGE, 'NO_ASSIGNMENT')];

test('S10 admin / platform_admin / super_admin / tenant admin / legacy org admin cannot mutate: they hold no assignment — even with a genuine A1 session', async () => {
  const target = await newUser('s10');
  const living = await makeActive(await newUser('s10l'), NODE); // something real to suspend and end
  const alice = await actorOf('g-alice');
  const pending = await createMembership(await newUser('s10p'), NODE, alice);
  const open = await submit('ACTIVATE', pending.membership_id, pending.subject_user_id, NODE, alice); // an open request to approve or execute
  const livingSubject = living.created.subject_user_id;
  const identityBefore = await snapshot(db, IDENTITY_TABLES);
  const counts = async () => JSON.stringify(await owner(`SELECT (SELECT count(*) FROM corporate_memberships) AS m, (SELECT count(*) FROM corporate_membership_requests) AS r,
    (SELECT count(*) FROM corporate_membership_request_steps) AS s, (SELECT count(*) FROM corporate_membership_events) AS e, (SELECT count(*) FROM corporate_permission_assignments) AS a`));
  const before = await counts();
  const entryBefore = rpcCount();
  for (const userId of LEGACY) {
    const a = await actorOf(userId); // genuinely A1 — authentication is not the missing piece
    const attempts = {
      create: () => svc.createPendingMembership(client, { actor: a, subjectUserId: target, orgNodeId: NODE, reason: 'I am an administrator', reference: 'LEGACY-1' }),
      suspend: () => suspend(living.membershipId, livingSubject, NODE, a),
      compromise: () => suspend(living.membershipId, livingSubject, NODE, a, COMPROMISE),
      end: () => end(living.membershipId, livingSubject, NODE, a),
      request: () => submit('ACTIVATE', pending.membership_id, pending.subject_user_id, NODE, a),
      approve: () => approve(open, a),
      execute: () => execute(open, a),
    };
    for (const [name, run] of Object.entries(attempts)) {
      const refused = await thrown(run());
      assert.equal(refused?.code, 'AUTHORITY_DENIED', `${userId} ${name}`);
      // a compromise suspension needs BOTH capabilities, and each missing one is named on its own
      assert.deepEqual(denialsOf(refused), name === 'compromise' ? [...NO_ASSIGNMENT, denial(REVOKE_SESSIONS, 'NO_ASSIGNMENT')] : NO_ASSIGNMENT, `${userId} ${name}`);
    }
  }
  assert.equal(rpcCount(), entryBefore, 'not one of them reached a mutation entry point');
  assert.equal(await counts(), before, 'no membership, request, step, event or assignment was written');
  assert.equal(await snapshot(db, IDENTITY_TABLES), identityBefore);
  assert.equal((await membershipRow(living.membershipId)).state, 'ACTIVE');
});

test('S10 an ACTIVE membership authorizes nothing: an account activated through the governed path, and a super_admin who is also a Corporate member, are both denied', async () => {
  const sub = await newUser('s10a');
  await makeActive(sub, NODE); // ACTIVE through the whole maker/checker path
  const member = await actorOf(sub);
  const victim = await newUser('s10v');
  const attempt = (actor) => thrown(svc.createPendingMembership(client, { actor, subjectUserId: victim, orgNodeId: NODE, reason: 'r', reference: 'x' }));
  const refused = await attempt(member);
  assert.deepEqual([refused?.code, denialsOf(refused)], ['AUTHORITY_DENIED', NO_ASSIGNMENT]);
  await seedMembership(db, 'u-sadmin', ROOT_NODE); // the legacy super_admin is ALSO an ACTIVE member of the Corporate root
  const sadmin = await actorOf('u-sadmin');
  assert.deepEqual(denialsOf(await attempt(sadmin)), NO_ASSIGNMENT);
  // the entry point says the same if the service is bypassed
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: sub, p_actor_session_id: sessionIdOf(member), p_subject_user_id: victim }))), 'AUTHORITY_DENIED');
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: 'u-sadmin', p_actor_session_id: sessionIdOf(sadmin), p_subject_user_id: victim }))), 'AUTHORITY_DENIED');
  assert.equal(Number((await owner('SELECT count(*) AS n FROM corporate_memberships WHERE user_id = $1', [victim]))[0].n), 0);
  // …while the control proves the harness could pass: a governor creates the same membership
  assert.equal((await svc.createPendingMembership(client, { actor: await actorOf('g-alice'), subjectUserId: victim, orgNodeId: NODE, reason: 'r', reference: 'x' })).state, 'PENDING');
});

test('S10 fabricated authority is not authority: a hand-built decision cannot be carried in, the snapshot-taking procedures are closed to service_role, and the control passes', async () => {
  const target = await newUser('s10d');
  const sadmin = await actorOf('u-sadmin');
  const sid = sessionIdOf(sadmin);
  const forged = decisionFor({ actor: 'u-sadmin', subject: target }); // exactly what Phase B would have accepted: contract, source, capability, scope, A1
  const created = async (user) => Number((await owner('SELECT count(*) AS n FROM corporate_memberships WHERE user_id = $1', [user]))[0].n);
  // 1. the Phase-B entry point: closed to service_role, even for a perfectly formed snapshot
  const old = await direct('corporate_membership_apply_direct', { ...directCreate({ p_actor_user_id: 'u-sadmin', p_actor_session_id: sid, p_subject_user_id: target }), p_governance_decision: forged });
  assert.match(String(old.error?.message), /permission denied for function corporate_membership_apply_direct/);
  // 2. the Phase-C entry point has no decision parameter: a named argument that does not exist finds no function at all
  const smuggled = await direct('corporate_authority_apply_direct', { ...directCreate({ p_actor_user_id: 'u-sadmin', p_actor_session_id: sid, p_subject_user_id: target }), p_governance_decision: forged });
  assert.match(String(smuggled.error?.message), /function public\.corporate_authority_apply_direct\(.*does not exist/s);
  // 3. without it, the forger simply holds no assignment
  assert.equal(dbCode(await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: 'u-sadmin', p_actor_session_id: sid, p_subject_user_id: target }))), 'AUTHORITY_DENIED');
  // 4. the service cannot be handed it either
  assert.equal(await code(svc.createPendingMembership(client, { actor: sadmin, subjectUserId: target, orgNodeId: NODE, reason: 'forged', reference: 'x', governanceDecision: forged })), 'AUTHORITY_CLIENT_ASSERTED');
  assert.equal(await created(target), 0, 'nothing was created by any of it');
  // 5. positive control: the same snapshot-shaped call is not what stands between a caller and a mutation — assignments are
  const alice = await actorOf('g-alice');
  const control = await direct('corporate_authority_apply_direct', directCreate({ p_actor_user_id: 'g-alice', p_actor_session_id: sessionIdOf(alice), p_subject_user_id: target }));
  assert.equal(control.error, null, 'a governor passes — the platform role was never the obstacle or the key');
  assert.equal(await created(target), 1);
  // 6. and a decision the DATABASE generated for someone else is no good to the forger: it is not an input anywhere
  const real = await evaluateCorporateGovernanceAuthorization(client, manageOf('g-alice', target));
  assert.equal(await code(svc.createPendingMembership(client, { actor: sadmin, subjectUserId: await newUser('s10e'), orgNodeId: NODE, reason: 'replayed', reference: 'x', governanceDecision: real.decision })), 'AUTHORITY_CLIENT_ASSERTED');
});

test('S10 nothing in the service layer or at service_role can create, change or remove an assignment — a legacy role, a tenant role or the bridge cannot mint one', async () => {
  const before = JSON.stringify(await owner('SELECT assignment_id, state, subject_user_id, capability, scope_node_ids FROM corporate_permission_assignments ORDER BY assignment_id'));
  const eventsBefore = Number((await owner('SELECT count(*) AS n FROM corporate_permission_assignment_events'))[0].n);
  const row = { assignment_id: '00000000-0000-4000-8000-0000000000f1', subject_user_id: 'u-sadmin', membership_id: governors['g-alice'].membershipId, capability: MANAGE,
    scope_node_ids: [ROOT_NODE], include_descendants: true, effective_from: iso(-MINUTE), effective_until: iso(HOUR), assurance_floor: 'A1_RECENT_REAUTH', requested_by_user_id: 'u-sadmin',
    request_reason: 'self', request_reference: 'x', state: 'ACTIVE', updated_by_kind: 'USER', updated_by_user_id: 'u-sadmin', updated_reason: 'self', updated_reference: 'x' };
  const insert = await client.from('corporate_permission_assignments').insert(row);
  assert.match(String(insert.error?.message), /permission denied for table corporate_permission_assignments/);
  const update = await client.from('corporate_permission_assignments').update({ state: 'ACTIVE' }).eq('state', 'REQUESTED');
  assert.match(String(update.error?.message), /permission denied for table corporate_permission_assignments/);
  const revive = await client.from('corporate_permission_assignments').update({ state: 'ACTIVE' }).eq('assignment_id', governors['g-erin'].manageId);
  assert.match(String(revive.error?.message), /permission denied/);
  const ledger = await client.from('corporate_permission_assignment_events').insert({ assignment_id: governors['g-alice'].manageId, event_seq: 99, subject_user_id: 'g-alice', capability: MANAGE, event_type: 'TRANSITIONED' });
  assert.match(String(ledger.error?.message), /permission denied for table corporate_permission_assignment_events/);
  for (const sql of ['DELETE FROM corporate_permission_assignments', 'TRUNCATE corporate_permission_assignments', 'DELETE FROM corporate_permission_assignment_events', 'TRUNCATE corporate_permission_assignment_events']) {
    await assert.rejects(asServiceRole(sql), /permission denied/, sql);
  }
  // reading is allowed (the evaluator's own facts are visible to the backend) — and shows no secret, only the grant's terms
  const read = await client.from('corporate_permission_assignments').select('assignment_id, state, capability').limit(3);
  assert.equal(read.error, null);
  assert.ok(read.data.length > 0);
  assert.equal(JSON.stringify(await owner('SELECT assignment_id, state, subject_user_id, capability, scope_node_ids FROM corporate_permission_assignments ORDER BY assignment_id')), before, 'not one assignment changed');
  assert.equal(Number((await owner('SELECT count(*) AS n FROM corporate_permission_assignment_events'))[0].n), eventsBefore);
  // a legacy-role holder with a real session gains no way in either: tenant/legacy roles are not an input to any entry point
  assert.equal(await owner(`SELECT count(*)::int AS n FROM corporate_permission_assignments WHERE subject_user_id = ANY($1::text[])`, [LEGACY]).then((r) => r[0].n), 0, 'no legacy administrator was ever granted anything');
});

// ── S11 — outage, malformed answers and concurrency on one connection (real multi-session proof is a separate evidence script) ───

/** A client that asks the REAL evaluator but answers every mutation entry point with `entry`. */
const mutatingWith = (entry) => ({ from: client.from.bind(client), rpc: async (name, params) => (name === AUTHORITY_EVALUATOR_RPC ? client.rpc(name, params) : entry(name, params)) });

test('S11 two simultaneous executions of one approval: exactly one wins, the other is refused as consumed', async () => {
  const sub = await newUser('s11');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  await approve(req, bob);
  const settled = await Promise.allSettled([execute(req, alice), execute(req, bob), execute(req, alice)]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.deepEqual(settled.filter((s) => s.status === 'rejected').map((s) => s.reason.code), ['REQUEST_ALREADY_CONSUMED', 'REQUEST_ALREADY_CONSUMED']);
  assert.equal(await eventCount(c.membership_id), 2, 'one creation + exactly one activation');
});

test('S11 two simultaneous creations of one membership: exactly one wins', async () => {
  const sub = await newUser('s11b');
  const [a, b] = [await actorOf('g-alice'), await actorOf('g-bob')];
  const settled = await Promise.allSettled([createMembership(sub, NODE, a), createMembership(sub, NODE, b)]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.equal(settled.find((s) => s.status === 'rejected').reason.code, 'MEMBERSHIP_ALREADY_LIVE');
});

test('S11 a database outage or a malformed answer is a denial, never a silent success — at the evaluator and at the entry point', async () => {
  const sub = await newUser('s11c');
  const alice = await actorOf('g-alice');
  const input = { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x' };
  const unreachable = { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }), from: client.from.bind(client) };
  assert.equal(await code(svc.createPendingMembership(unreachable, input)), 'GOVERNANCE_UNAVAILABLE', 'the evaluator could not be asked: no authority, no mutation');
  assert.equal(await code(svc.createPendingMembership(mutatingWith(async () => ({ data: null, error: { code: '08006', message: 'connection failure' } })), input)), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await code(svc.createPendingMembership(mutatingWith(async () => ({ data: 'ok', error: null })), input)), 'GOVERNANCE_UNAVAILABLE', 'a malformed result is not a success');
  assert.equal(await code(svc.createPendingMembership(mutatingWith(async () => { throw new Error('socket hang up'); }), input)), 'GOVERNANCE_UNAVAILABLE');
  // a table guard (the second line of defence) refusing a write is a hard denial of its own kind — never "unavailable", never a retry
  for (const message of ['CORPORATE_GOVERNANCE_STEP_MAKER_IS_CHECKER', 'CORPORATE_MEMBERSHIP_EVENT_CHAIN_BROKEN', 'CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN']) {
    const refused = await thrown(svc.createPendingMembership(mutatingWith(async () => ({ data: null, error: { code: '23514', message } })), input));
    assert.ok(refused instanceof CorporateGovernanceError);
    assert.deepEqual([refused.code, refused.details.guard], ['GOVERNANCE_GUARD_REFUSED', message]);
  }
  // the database's own denial keeps its code and its reasons; a mangled DETAIL never turns a denial into anything else
  const grantId = governors['g-alice'].manageId;
  const detail = JSON.stringify([denial(MANAGE, 'STATE_REVOKED', grantId)]);
  const staleTx = await thrown(svc.createPendingMembership(mutatingWith(async () => ({ data: null, error: { code: 'P0001', message: 'CORPORATE_GOVERNANCE/TRANSACTION_STALE', details: 'a governed call must run in a fresh transaction' } })), input));
  assert.deepEqual([staleTx.code, staleTx.details.source], ['TRANSACTION_STALE', 'database'], 'a stale transaction keeps its own code: the caller retries in a fresh one');
  const denied = await thrown(svc.createPendingMembership(mutatingWith(async () => ({ data: null, error: { code: 'P0001', message: 'CORPORATE_GOVERNANCE/AUTHORITY_DENIED', details: detail } })), input));
  assert.deepEqual([denied.code, denialsOf(denied)], ['AUTHORITY_DENIED', [denial(MANAGE, 'STATE_REVOKED', grantId)]]);
  for (const details of ['{not json', '', null, '{"capability":"x"}', '[1,2]']) {
    const mangled = await thrown(svc.createPendingMembership(mutatingWith(async () => ({ data: null, error: { code: 'P0001', message: 'CORPORATE_GOVERNANCE/AUTHORITY_DENIED', details } })), input));
    assert.deepEqual([mangled.code, denialsOf(mangled)], ['AUTHORITY_DENIED', []], String(details));
  }
  assert.equal(await code(svc.createPendingMembership(null, input)), 'GOVERNANCE_UNAVAILABLE');
  assert.equal(await code(svc.createPendingMembership({ rpc() {} }, input)), 'GOVERNANCE_UNAVAILABLE');
  assert.equal((await owner('SELECT COUNT(*)::int AS n FROM corporate_memberships WHERE user_id = $1', [sub]))[0].n, 0);

  // a read that fails is "unavailable", not "not found" and never an allow — and nothing is attempted afterwards
  const made = await createMembership(sub, NODE, alice);
  const before = rpcCount();
  client.faults.add('select:corporate_memberships');
  assert.equal(await code(suspend(made.membership_id, sub, NODE, alice)), 'GOVERNANCE_UNAVAILABLE');
  client.faults.clear();
  client.faults.add('select:corporate_membership_requests');
  assert.equal(await code(svc.cancelMembershipRequest(client, { actor: alice, requestId: made.request_id, reason: 'r' })), 'GOVERNANCE_UNAVAILABLE');
  client.faults.clear();
  assert.equal(rpcCount(), before);
});

test('S11 malformed or unknown identifiers are refused with their own codes before any write', async () => {
  const sub = await newUser('s11d');
  const alice = await actorOf('g-alice');
  const before = rpcCount();
  const ghost = '00000000-0000-4000-8000-000000000000';
  const m = { subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x' };
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: 'not-a-uuid', ...m })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: ghost, ...m })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.requestMembershipActivation(client, { actor: alice, membershipId: ghost, ...m })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: ghost, expectedBindingDigest: '0'.repeat(64) })), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: 'nope', expectedBindingDigest: '0'.repeat(64) })), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.readMembershipRequestStatus(client, ghost)), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.decideMembershipRequest(client, { actor: alice, requestId: ghost, decision: 'MAYBE', reason: 'r', expected: {} })), 'DECISION_VALUE_INVALID');
  assert.equal(rpcCount(), before, 'none of them reached an entry point');
  // a membership id that exists but belongs to someone else binds to nothing
  const other = await newUser('s11e');
  const theirs = await createMembership(other, NODE, alice);
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: theirs.membership_id, ...m })), 'BINDING_MISMATCH');
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: theirs.membership_id, ...m, subjectUserId: other, orgNodeId: 'BU_SERVICE_NETWORK' })), 'BINDING_MISMATCH', 'right person, wrong unit');
});

// ── S12 — live authority: revocation is observed on the very next call, even between the preflight and the entry point ──────

test('S12 suspending, revoking, expiring or ending the grant is observed on the very next decision — and restoring a suspended one restores the authority', async () => {
  const gid = await freshGovernor('g-live');
  const grant = governors[gid];
  const reasonsOf = async (promise) => denialsOf(await thrown(promise))?.map((d) => d.reason);
  const create = async () => svc.createPendingMembership(client, { actor: await actorOf(gid), subjectUserId: await newUser('s12'), orgNodeId: NODE, reason: 'r', reference: `L-${(seq += 1)}` });
  assert.equal((await create()).state, 'PENDING', 'control: the governor works');

  const entryBefore = rpcCount();
  await moveAssignment(db, grant.manageId, 'SUSPENDED');
  assert.deepEqual(await reasonsOf(create()), ['STATE_SUSPENDED'], 'suspended: the very next call is denied');
  assert.equal(rpcCount(), entryBefore, 'and nothing was sent to a mutation entry point');
  await moveAssignment(db, grant.manageId, 'ACTIVE');
  assert.equal((await create()).state, 'PENDING', 'restored: the assignment itself — not a cache — decides');

  // the membership under the assignment: suspending or ending it silences the grant without touching the grant
  const membershipUpdate = (state) => owner(`UPDATE corporate_memberships SET state = '${state}', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'fixture', updated_reference = 'x' WHERE membership_id = $1`, [grant.membershipId]);
  await membershipUpdate('SUSPENDED');
  assert.deepEqual(await reasonsOf(create()), ['MEMBERSHIP_NOT_EFFECTIVE'], 'the membership is suspended: an ACTIVE assignment on it authorizes nothing');
  assert.equal((await owner('SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [grant.manageId]))[0].state, 'ACTIVE', 'the assignment was not touched');
  await membershipUpdate('ACTIVE');
  assert.equal((await create()).state, 'PENDING', 'membership restored: authority restored');

  // revoked: terminal
  await moveAssignment(db, grant.manageId, 'REVOKED');
  assert.deepEqual(await reasonsOf(create()), ['STATE_REVOKED']);
  await assert.rejects(moveAssignment(db, grant.manageId, 'ACTIVE'), /CORPORATE_ASSIGNMENT_(TRANSITION_NOT_ALLOWED|TERMINAL)/, 'REVOKED is terminal: a new authority is a new approval, never a revival');
  assert.deepEqual(await reasonsOf(create()), ['STATE_REVOKED']);

  // the period passing, with the row still ACTIVE: out of window
  const timed = await freshGovernor('g-timed');
  const timedActor = () => actorOf(timed);
  assert.equal((await svc.createPendingMembership(client, { actor: await timedActor(), subjectUserId: await newUser('s12t'), orgNodeId: NODE, reason: 'r', reference: 'T-1' })).state, 'PENDING');
  await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [governors[timed].manageId]);
  assert.deepEqual(await reasonsOf(svc.createPendingMembership(client, { actor: await timedActor(), subjectUserId: await newUser('s12u'), orgNodeId: NODE, reason: 'r', reference: 'T-2' })), ['OUT_OF_WINDOW']);

  // the ledgers keep what was relied on at the time: the earlier requests still name the assignment, whatever became of it
  const [row] = await owner(`SELECT count(*)::int AS n FROM corporate_membership_requests WHERE governance_decision->'provenance'->'assignments' @> $1::jsonb`, [JSON.stringify([{ assignment_id: grant.manageId }])]);
  assert.ok(row.n >= 3, 'history is not rewritten by revocation');
});

test('S12 authority is evaluated again INSIDE the entry point: revoking between the service\'s preflight and the call still refuses, and nothing changes', async () => {
  const gid = await freshGovernor('g-race');
  const grant = governors[gid];
  const subject = await newUser('s12r');
  const actor = await actorOf(gid);
  let fired = 0;
  client.beforeRpc = async (name) => { if (name === 'corporate_authority_apply_direct' && fired === 0) { fired += 1; await moveAssignment(db, grant.manageId, 'REVOKED'); } };
  const evaluationsBefore = evaluatorCount();
  const entryBefore = rpcCount();
  const refused = await thrown(svc.createPendingMembership(client, { actor, subjectUserId: subject, orgNodeId: NODE, reason: 'r', reference: 'RACE-1' }));
  assert.equal(fired, 1, 'the revocation landed after the preflight and before the entry point');
  assert.equal(evaluatorCount(), evaluationsBefore + 1, 'the preflight had been GRANTED');
  assert.equal(rpcCount(), entryBefore + 1, 'the entry point was reached');
  assert.deepEqual([refused?.code, denialsOf(refused)], ['AUTHORITY_DENIED', [denial(MANAGE, 'STATE_REVOKED', grant.manageId)]], 'and refused it: the stale preflight authorized nothing');
  assert.equal(Number((await owner('SELECT count(*) AS n FROM corporate_memberships WHERE user_id = $1', [subject]))[0].n), 0);

  // the same for each step of a maker/checker request: execution by an actor whose authority is suspended in the gap is refused, consumes nothing, and works once restored
  const racer = await freshGovernor('g-race');
  const sub2 = await newUser('s12x');
  const bob = await actorOf('g-bob');
  const maker = await actorOf(racer);
  const c = await svc.createPendingMembership(client, { actor: maker, subjectUserId: sub2, orgNodeId: NODE, reason: 'r', reference: 'RACE-2' });
  const req = await submit('ACTIVATE', c.membership_id, sub2, NODE, maker);
  await approve(req, bob);
  fired = 0;
  client.beforeRpc = async (name) => { if (name === 'corporate_authority_request_execute' && fired === 0) { fired += 1; await moveAssignment(db, governors[racer].manageId, 'SUSPENDED'); } };
  const blocked = await thrown(execute(req, await actorOf(racer)));
  assert.deepEqual([blocked?.code, denialsOf(blocked)], ['AUTHORITY_DENIED', [denial(MANAGE, 'STATE_SUSPENDED', governors[racer].manageId)]]);
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING');
  assert.equal(await code(execute(req, bob)), null, 'the approval was not consumed by the refused attempt: the approving checker, who still holds authority, executes it');
  assert.equal((await membershipRow(c.membership_id)).state, 'ACTIVE');
});

test('S12 a compromise suspension whose session-revoke grant disappears in the gap leaves the sessions revoked and the membership untouched — the one residual window, stated', async () => {
  const gid = await freshGovernor('g-gap');
  const sub = await newUser('s12g');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub); await addSession(db, sub);
  const actor = await actorOf(gid);
  let fired = 0;
  client.beforeRpc = async (name) => { if (name === 'corporate_authority_apply_direct' && fired === 0) { fired += 1; await moveAssignment(db, governors[gid].revokeId, 'REVOKED'); } };
  const refused = await thrown(suspend(membershipId, sub, NODE, actor, COMPROMISE));
  assert.deepEqual([refused?.code, denialsOf(refused)], ['AUTHORITY_DENIED', [denial(REVOKE_SESSIONS, 'STATE_REVOKED', governors[gid].revokeId)]]);
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE', 'the membership was NOT suspended');
  assert.equal(await liveSessions(sub), 0, 'the sessions revoked after the (granted) preflight stay revoked — the protective side of the failure');
  const [audit] = await owner(`SELECT actor_user_id FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED' ORDER BY id DESC LIMIT 1`);
  assert.equal(audit.actor_user_id, gid, 'and it is audited against the actor who was authorised at the time of the preflight');
});

test('S12 an actor who loses authority cannot continue what they started — not even to cancel — and a fresh grant is a fresh approval, not a revival', async () => {
  const gid = await freshGovernor('g-quit');
  const sub = await newUser('s12q');
  const actor = () => actorOf(gid);
  const c = await svc.createPendingMembership(client, { actor: await actor(), subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'Q-1' });
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, await actor());
  await moveAssignment(db, governors[gid].manageId, 'REVOKED');
  const cancel = await thrown(svc.cancelMembershipRequest(client, { actor: await actor(), requestId: req.request_id, reason: 'withdrawing' }));
  assert.deepEqual([cancel?.code, denialsOf(cancel)], ['AUTHORITY_DENIED', [denial(MANAGE, 'STATE_REVOKED', governors[gid].manageId)]]);
  assert.equal((await svc.readMembershipRequestStatus(client, req.request_id)).status, 'REQUESTED', 'the request is untouched');
  // a NEW assignment (owner ceremony, new approval lineage) restores the ability: it is a different grant with its own id
  const fresh = await seedAssignment(db, { subject: gid, membershipId: governors[gid].membershipId, capability: MANAGE });
  assert.notEqual(fresh, governors[gid].manageId);
  const cancelled = await svc.cancelMembershipRequest(client, { actor: await actor(), requestId: req.request_id, reason: 'withdrawing' });
  assert.equal(cancelled.outcome, 'CANCELLED');
  assert.deepEqual(cancelled.authority.assignments.map((a) => a.assignment_id), [fresh], 'the receipt names the NEW assignment');
});
