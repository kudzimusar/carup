/**
 * CA-K3-AUTH-03 — the Corporate membership mutation SERVICE, exercised against the real governed SQL.
 *
 * Nothing here injects a collaborator that could hide a dead path: the service talks to PGlite 17 through a supabase-js-shaped client
 * that executes every statement as `service_role` (corporateGovernanceDb + pgliteSupabaseClient), and the compromise flow runs the REAL
 * revokeSessionsForUser / logAuditEvent and the REAL Phase-A resolver. The database-only proofs live in
 * ca-k3-auth-03-membership-governance-pglite.test.js; this file proves the layer above it and that the two layers agree.
 *
 * Section map (receipt evidence): S1 boundary/non-routed · S2 decision contract · S3 A1 server-proven, client assurance refused ·
 * S4 wiring: full lifecycle · S5 maker/checker + no-self-action at BOTH layers · S6 replay, double execution, stale, binding ·
 * S7 SECURITY_COMPROMISE session propagation · S8 invalidation seam · S9 zero capability, identity tables untouched, immediate denial ·
 * S10 legacy-derived authority refused · S11 concurrency on one connection.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, closeAll, addSession, decisionFor, snapshot, IDENTITY_TABLES, MINUTE, HOUR, OWNER, iso } from './helpers/corporateGovernanceDb.js';
import { createServiceClient, installAuditTables } from './helpers/pgliteSupabaseClient.js';
import * as svc from '../services/corporate/corporateMembershipGovernanceService.js';
import {
  CorporateGovernanceError, DECISION_MAX_AGE_MS, assertGovernanceDecision, evaluateCorporateGovernanceAuthorization,
  isMintedGovernanceDecision, mintTargetGovernanceDecision,
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
const PROCEDURES = ['corporate_membership_apply_direct', 'corporate_membership_request_submit', 'corporate_membership_request_decide',
  'corporate_membership_request_execute', 'corporate_membership_request_cancel'];

const NODE = 'BU_MARKETPLACE';
let db;
let client;
let seq = 0;

before(async () => {
  db = await openDatabase();
  await installAuditTables(db);
  client = createServiceClient(db);
});
after(async () => { await closeAll(); });
afterEach(() => { clearCorporateAuthorizationListeners(); client.faults.clear(); client.beforeRpc = null; });

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function newUser(prefix = 'x') {
  const id = `${prefix}-${(seq += 1)}`;
  await db.query(`INSERT INTO users (id, email, role) VALUES ($1, $2, 'owner')`, [id, `${id}@x.invalid`]);
  return id;
}
/** An actor whose session has (by default) a fresh password re-authentication — i.e. genuinely A1. */
async function actorOf(userId, options) {
  const sid = await addSession(db, userId, options);
  return { userId, sessionToken: `tok-${sid}` };
}
const decision = (actor, subject, node = NODE, overrides = {}) => mintTargetGovernanceDecision(decisionFor({ actor: actor.userId, subject, node, ...overrides }));
const BOTH = ['corporate.people.membership.manage', 'corporate.people.session.revoke'];
async function code(promise) {
  try { await promise; return null; } catch (error) { return error instanceof CorporateGovernanceError ? error.code : `OTHER:${error?.stack ?? error}`; }
}
const dbCode = (response) => String(response?.error?.message ?? '').match(/CORPORATE_GOVERNANCE\/([A-Z0-9_]+)/)?.[1] ?? null;
const owner = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpcCount = () => client.calls.rpc.length;
/** The user_sessions.id behind an actor's token (the harness mints tokens as `tok-<id>`). */
const sessionIdOf = (actor) => actor.sessionToken.slice(4);

async function createMembership(subject, node = NODE, maker) {
  const m = maker ?? await actorOf('g-alice');
  return svc.createPendingMembership(client, { actor: m, subjectUserId: subject, orgNodeId: node, reason: 'Joins the unit', reference: `HR-${(seq += 1)}`, governanceDecision: decision(m, subject, node) });
}
const expectedOf = (req) => ({ subjectUserId: req.subject_user_id, membershipId: req.membership_id, orgNodeId: req.org_node_id, operation: req.operation, bindingDigest: req.binding_digest });
async function submit(kind, membershipId, subject, node, maker) {
  const fn = kind === 'ACTIVATE' ? svc.requestMembershipActivation : svc.requestMembershipRestoration;
  return fn(client, { actor: maker, membershipId, subjectUserId: subject, orgNodeId: node, reason: `${kind} please`, reference: `REQ-${(seq += 1)}`, governanceDecision: decision(maker, subject, node) });
}
async function approve(req, checker, outcome = 'APPROVE') {
  return svc.decideMembershipRequest(client, { actor: checker, requestId: req.request_id, decision: outcome, reason: 'reviewed', expected: expectedOf(req), governanceDecision: decision(checker, req.subject_user_id, req.org_node_id) });
}
async function execute(req, executor) {
  return svc.executeMembershipRequest(client, { actor: executor, requestId: req.request_id, expectedBindingDigest: req.binding_digest, governanceDecision: decision(executor, req.subject_user_id, req.org_node_id) });
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
  return svc.suspendMembership(client, { actor: admin, membershipId, subjectUserId: subject, orgNodeId: node, reason: 'Pause access', reference: `SUS-${(seq += 1)}`, governanceDecision: decision(admin, subject, node, extra.decision), ...extra.input });
}
async function end(membershipId, subject, node, admin, decisionOverrides = {}) {
  return svc.endMembership(client, { actor: admin, membershipId, subjectUserId: subject, orgNodeId: node, reason: 'Leaves the unit', reference: `END-${(seq += 1)}`, governanceDecision: decision(admin, subject, node, decisionOverrides) });
}
const membershipRow = async (id) => (await owner('SELECT * FROM corporate_memberships WHERE membership_id = $1', [id]))[0];
const eventCount = async (id) => Number((await owner('SELECT COUNT(*) AS n FROM corporate_membership_events WHERE membership_id = $1', [id]))[0].n);

// ── S1 — boundary: internal, non-routed, writes only through the five procedures ──────────────────────────────────────────

test('S1 the four core modules exist and import only the sanctioned collaborators', () => {
  const allowed = new Set(['../auth/sessionSecurityService.js', './corporateGovernanceDecision.js', './corporateGovernanceAssurance.js',
    './corporateAuthorizationInvalidation.js', '../auth/authenticationAssuranceService.js']);
  for (const file of CORE) {
    const imports = [...stripComments(read(file)).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(allowed.has(spec), `${file} imports ${spec}`);
  }
  // the service in particular does not import the singleton supabase client: every function takes the client it is given
  assert.doesNotMatch(stripComments(read(CORE[3])), /db\/supabase\.js/);
});

test('S1 the service writes nothing itself: no DML, only the five procedures, only three read tables', () => {
  for (const file of CORE) assert.doesNotMatch(stripComments(read(file)), /\)\s*\.(insert|update|delete|upsert)\(/, `${file} must not perform DML`);
  const src = stripComments(read(CORE[3]));
  const called = [...src.matchAll(/callProcedure\(client,\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(called)].sort(), [...PROCEDURES].sort(), 'exactly the five governed procedures');
  const tables = [...src.matchAll(/(?:readOne\(client,|\.from\()\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['corporate_membership_request_status', 'corporate_membership_requests', 'corporate_memberships']);
  assert.match(stripComments(read(CORE[1])), /\.from\('user_sessions'\)/, 'A1 is read from the actor\'s own session row');
});

test('S1 no legacy platform role, tenant relationship, header or bridge is an input to any core module', () => {
  const forbidden = /\b(users\.role|platform_admin|super_admin|tenant_users|organization_users|organizations|tenants)\b|req\.headers|x-user-id|x-tenant-id|legacy_admin_compatibility_bridge|authorizeRole|userContext|platformRole/;
  for (const file of CORE) assert.doesNotMatch(stripComments(read(file)), forbidden, `${file} reads a forbidden authority source`);
});

test('S1 the core is NOT routed: nothing outside it (and its tests) imports it or calls a governed procedure', () => {
  const needle = /corporateMembershipGovernanceService|corporateGovernanceDecision|corporateGovernanceAssurance|corporateAuthorizationInvalidation|corporate_membership_(apply_direct|request_submit|request_decide|request_execute|request_cancel)/;
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
  assert.deepEqual(offenders, [], 'no route, middleware, server, web or mobile file may reach the mutation core');
  // and the only corporate route is still the frozen read-only access bridge
  const server = read('backend/server.js');
  assert.deepEqual([...server.matchAll(/corporate\w*Router/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i), ['corporateAccessRouter']);
});

test('S1 minting a governance decision is a single, greppable act: no production module imports mintTargetGovernanceDecision', () => {
  const importers = execFileSync('git', ['grep', '-l', '--untracked', '-e', 'mintTargetGovernanceDecision', '--', 'backend', 'web/src', ':!backend/tests'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(importers, ['backend/services/corporate/corporateGovernanceDecision.js']);
});

// ── S2 — the target-governance decision contract ──────────────────────────────────────────────────────────────────────────

const ctx = { actorUserId: 'g-alice', subjectUserId: 'm-eve', orgNodeId: NODE };
const raw = (overrides = {}) => decisionFor({ actor: 'g-alice', subject: 'm-eve', node: NODE, ...overrides });
const mintCode = (fields) => { try { mintTargetGovernanceDecision(fields); return null; } catch (e) { return e.code; } };
const assertCode = (d, extra = {}) => { try { assertGovernanceDecision(d, { ...ctx, ...extra }); return null; } catch (e) { return e instanceof CorporateGovernanceError ? e.code : `OTHER:${e}`; } };

test('S2 a well-formed minted decision is accepted and travels as plain JSON, never as the branded object', () => {
  const d = mintTargetGovernanceDecision(raw());
  assert.equal(isMintedGovernanceDecision(d), true);
  assert.ok(Object.isFrozen(d));
  const wire = assertGovernanceDecision(d, ctx);
  assert.equal(isMintedGovernanceDecision(wire), false);
  assert.deepEqual(wire, JSON.parse(JSON.stringify(d)));
});

test('S2 a minted decision is deeply immutable and keeps no reference to its source: nothing nested can change between minting and use', () => {
  const d = mintTargetGovernanceDecision(raw());
  const tampers = {
    assurance: () => { d.assurance.class = 'A2_STRONG'; }, proven: () => { d.assurance.server_proven = false; }, capability: () => { d.capabilities.push('corporate.finance.read'); },
    scope: () => { d.scope.org_node_ids.push('GLOBAL'); }, kind: () => { d.scope.kind = 'GLOBAL'; }, evaluator: () => { d.evaluator.name = 'someone-else'; },
    verdict: () => { d.decision = 'denied'; }, continuity: () => { d.governance_continuity.remaining_independent_governors = 0; }, subject: () => { d.subject_user_id = 'x'; },
  };
  for (const [name, tamper] of Object.entries(tampers)) assert.throws(tamper, TypeError, name);
  const fields = raw();
  const minted = mintTargetGovernanceDecision(fields);
  fields.capabilities.push('x.y.z'); fields.scope.org_node_ids.push('GLOBAL'); fields.assurance.class = 'A2_STRONG';
  fields.governance_continuity.remaining_independent_governors = 0; fields.evaluator.name = 'changed-after-the-fact'; // the caller's own objects stay the caller's
  assert.equal(minted.governance_continuity.remaining_independent_governors, 5);
  assert.equal(minted.evaluator.name, 'test-evaluator');
  assert.deepEqual([...minted.capabilities], ['corporate.people.membership.manage']);
  assert.deepEqual([...minted.scope.org_node_ids], [NODE]);
  assert.equal(minted.assurance.class, 'A1_RECENT_REAUTH');
  assert.equal(assertCode(minted), null, 'and it is still good for its own call');
});

test('S2 missing, unavailable, unminted and legacy-shaped decisions are all denials', () => {
  assert.equal(assertCode(undefined), 'DECISION_MISSING');
  assert.equal(assertCode(null), 'DECISION_MISSING');
  assert.equal(assertCode(evaluateCorporateGovernanceAuthorization()), 'DECISION_UNAVAILABLE', 'the evaluator that does not exist yet denies');
  assert.equal(assertCode(raw()), 'DECISION_NOT_MINTED', 'a hand-written object with perfect content is still refused');
  assert.equal(assertCode(JSON.parse(JSON.stringify(mintTargetGovernanceDecision(raw())))), 'DECISION_NOT_MINTED', 'a copy of a minted decision is not minted');
  assert.equal(assertCode({ role: 'platform_admin', capabilities: ['corporate.people.membership.manage'] }), 'DECISION_NOT_MINTED');
  assert.equal(assertCode('granted'), 'DECISION_NOT_MINTED');
  // the legacy bridge's own contract and source can never be minted into a governance decision
  assert.equal(mintCode(raw({ contract: 'carup.corporate_access.v1' })), 'DECISION_CONTRACT');
  assert.equal(mintCode(raw({ source: 'legacy_admin_compatibility_bridge' })), 'DECISION_SOURCE');
  assert.equal(mintCode(raw({ source: 'platform_admin' })), 'DECISION_SOURCE');
  assert.equal(mintCode(raw({ decision: 'denied' })), 'DECISION_NOT_GRANTED');
  assert.equal(mintCode(raw({ decision: 'allow' })), 'DECISION_NOT_GRANTED');
});

test('S2 the evaluator does not exist yet and never returns a granted decision', () => {
  const result = evaluateCorporateGovernanceAuthorization({ userId: 'u-sadmin', role: 'super_admin' });
  assert.deepEqual(result, { available: false, reason: 'NO_PERSISTENT_GRANT_AUTHORITY' });
  assert.ok(Object.isFrozen(result));
});

test('S2 freshness, binding, capability, scope and assurance matrix', () => {
  const m = (o) => mintTargetGovernanceDecision(raw(o));
  assert.equal(assertCode(m({ ageMs: DECISION_MAX_AGE_MS + 1000 })), 'DECISION_STALE');
  assert.equal(assertCode(m({ ageMs: -2 * MINUTE })), 'DECISION_STALE', 'a decision from the future is refused too');
  assert.equal(assertCode(m({ ageMs: DECISION_MAX_AGE_MS - 5000 })), null);
  assert.equal(assertCode(m({ actor: 'g-bob' })), 'DECISION_BINDING', 'issued to someone else');
  assert.equal(assertCode(m({ subject: 'm-frank' })), 'DECISION_BINDING', 'issued for another subject');
  assert.equal(assertCode(m({ capabilities: ['corporate.people.view'] })), 'DECISION_CAPABILITY');
  assert.equal(assertCode(m({}), { needSessionRevoke: true }), 'DECISION_CAPABILITY', 'compromise needs session.revoke as well');
  assert.equal(assertCode(m({ capabilities: BOTH }), { needSessionRevoke: true }), null);
  assert.equal(mintCode(raw({ capabilities: ['platform_admin'] })), 'DECISION_CAPABILITY', 'a legacy role name is not a capability');
  assert.equal(mintCode(raw({ capabilities: [] })), 'DECISION_CAPABILITY');
  assert.equal(assertCode(m({ node: 'BU_SERVICE_NETWORK' })), 'DECISION_SCOPE', 'a different unit than the target');
  assert.equal(assertCode(m({ scope: { kind: 'ORG_NODES', org_node_ids: [NODE, 'GLOBAL'] } })), 'DECISION_SCOPE', 'no GLOBAL, even next to the target');
  assert.equal(mintCode(raw({ scope: { kind: 'ORG_NODES', org_node_ids: ['*'] } })), 'DECISION_SCOPE');
  assert.equal(mintCode(raw({ scope: { kind: 'GLOBAL' } })), 'DECISION_SCOPE');
  assert.equal(mintCode(raw({ scope: { kind: 'GLOBAL', org_node_ids: [NODE] } })), 'DECISION_SCOPE', 'the kind matters even when the units are listed');
  assert.equal(mintCode(raw({ scope: { kind: 'ORG_NODES', org_node_ids: [NODE, '*'] } })), 'DECISION_SCOPE');
  assert.equal(mintCode(raw({ scope: { kind: 'ORG_NODES', org_node_ids: [] } })), 'DECISION_SCOPE');
  assert.equal(mintCode(raw({ assurance: { class: 'A2_STRONG', server_proven: true } })), 'DECISION_ASSURANCE', 'A2 is never accepted, let alone emulated');
  assert.equal(mintCode(raw({ assurance: { class: 'A1_RECENT_REAUTH', server_proven: false } })), 'DECISION_ASSURANCE');
  assert.equal(mintCode(raw({ evaluator: { name: '', version: '1' } })), 'DECISION_EVALUATOR');
  assert.equal(mintCode(raw({ decided_at: 'yesterday-ish' })), 'DECISION_MALFORMED');
});

test('S2 governance-loss protection: a governor may only be ended while at least two independent governors remain', () => {
  const k = (o) => mintTargetGovernanceDecision(raw({ governance_continuity: o }));
  const need = { needContinuity: true };
  assert.equal(assertCode(mintTargetGovernanceDecision(raw({ governance_continuity: undefined })), need), 'DECISION_CONTINUITY', 'missing attestation denies');
  assert.equal(assertCode(k({ subject_holds_governance_authority: 'yes', remaining_independent_governors: 5 }), need), 'DECISION_CONTINUITY');
  assert.equal(assertCode(k({ subject_holds_governance_authority: true, remaining_independent_governors: -1 }), need), 'DECISION_CONTINUITY');
  assert.equal(assertCode(k({ subject_holds_governance_authority: true, remaining_independent_governors: 1.5 }), need), 'DECISION_CONTINUITY');
  assert.equal(assertCode(k({ subject_holds_governance_authority: true, remaining_independent_governors: 1 }), need), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(assertCode(k({ subject_holds_governance_authority: true, remaining_independent_governors: 0 }), need), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(assertCode(k({ subject_holds_governance_authority: true, remaining_independent_governors: 2 }), need), null);
  assert.equal(assertCode(k({ subject_holds_governance_authority: false, remaining_independent_governors: 0 }), need), null, 'an ordinary member is not a governance loss');
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
  assert.deepEqual(seen, [['from', 'user_sessions'], ['token', 'tok-x'], ['user_id', 'g-alice'], ['is_valid', true]], 'the lookup is scoped to the token, the actor and live sessions — the store is asked for the right row, not trusted to return it');
  assert.equal(await proveActorAssuranceA1(returning(live), { userId: 'g-alice', sessionToken: 'tok-x' }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID', 'someone else\'s row');
  assert.equal(await proveActorAssuranceA1(returning({ ...live, user_id: 'g-alice', is_valid: false }), { userId: 'g-alice', sessionToken: 'tok-x' }).catch((e) => e.code), 'ASSURANCE_SESSION_INVALID', 'a revoked row');
});

test('S3 the injected clock is for tests only: a value that is not epoch milliseconds is refused, never coerced', async () => {
  const sub = await newUser('s3n');
  const alice = await actorOf('g-alice');
  const input = () => ({ actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x', governanceDecision: decision(alice, sub) });
  for (const now of [Number.NaN, Infinity, '2026-10-14', {}]) assert.equal(await code(svc.createPendingMembership(client, input(), { now })), 'INPUT_INVALID', String(now));
});

const SERVICE_ENTRYPOINTS = ['createPendingMembership', 'suspendMembership', 'endMembership', 'requestMembershipActivation', 'requestMembershipRestoration',
  'decideMembershipRequest', 'executeMembershipRequest', 'cancelMembershipRequest'];

test('S3 a client can never assert A1: every entry point refuses an assurance, header or request object — before any I/O', async () => {
  const smuggled = [
    ['assurance', { class: 'A1_RECENT_REAUTH' }], ['authenticationAssurance', { satisfied: true }], ['step_up_at', new Date().toISOString()],
    ['stepUpAt', 'now'], ['headers', { 'x-step-up': 'A1' }], ['x-assurance', 'A1'], ['req', { headers: {} }], ['a1', true], ['a2', true], ['mfa', true],
  ];
  const rpcBefore = rpcCount();
  const fromBefore = client.calls.from.length;
  for (const name of SERVICE_ENTRYPOINTS) {
    for (const [key, value] of smuggled) {
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, governanceDecision: undefined, [key]: value })), 'ASSURANCE_CLIENT_ASSERTED', `${name} input.${key}`);
      assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x', [key]: value }, governanceDecision: undefined })), 'ASSURANCE_CLIENT_ASSERTED', `${name} actor.${key}`);
    }
    assert.equal(await code(svc[name](client, { actor: { userId: 'g-alice', sessionToken: 'tok-x' }, governanceDecision: undefined, somethingElse: 1 })), 'INPUT_UNKNOWN_KEY', `${name} unknown key`);
    assert.equal(await code(svc[name](client, null)), 'INPUT_INVALID');
  }
  assert.equal(rpcCount(), rpcBefore, 'no procedure was called');
  assert.equal(client.calls.from.length, fromBefore, 'no table was read');
});

test('S3 a fresh A1 session is required by every mutation: a stale one is refused and nothing is written', async () => {
  const subject = await newUser('s3');
  const stale = await actorOf('g-alice', { stepUp: { ageMs: 16 * MINUTE, method: 'password_reauth' } });
  const before = await owner('SELECT COUNT(*)::int AS n FROM corporate_membership_requests');
  const rpcBefore = rpcCount();
  assert.equal(await code(svc.createPendingMembership(client, { actor: stale, subjectUserId: subject, orgNodeId: NODE, reason: 'r', reference: 'ref', governanceDecision: decision(stale, subject) })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(rpcCount(), rpcBefore, 'refused before the procedure');
  assert.deepEqual(await owner('SELECT COUNT(*)::int AS n FROM corporate_membership_requests'), before);
  // and the database refuses the same thing if the service is bypassed (the A1 proof is repeated inside the transaction)
  const bypass = await client.rpc('corporate_membership_apply_direct', {
    p_operation: 'CREATE', p_actor_user_id: stale.userId, p_actor_session_id: sessionIdOf(stale), p_subject_user_id: subject, p_org_node_id: NODE, p_membership_id: null,
    p_reason: 'r', p_reference: 'ref', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null,
    p_governance_decision: JSON.parse(JSON.stringify(decision(stale, subject))),
  });
  assert.equal(dbCode(bypass), 'ASSURANCE_A1_REQUIRED');
});

// ── S4 — wiring: the full lifecycle through real SQL ──────────────────────────────────────────────────────────────────────

test('S4 PENDING → ACTIVE → SUSPENDED → ACTIVE → ENDED: independent custody at each gate, exactly one lifecycle event per accepted mutation', async () => {
  const subject = await newUser('s4b');
  const alice = await actorOf('g-alice');
  const bob = await actorOf('g-bob');
  const created = await createMembership(subject, NODE, alice);
  const id = created.membership_id;

  const act = await submit('ACTIVATE', id, subject, NODE, alice);
  await approve(act, bob);
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

  // ENDED is terminal — nothing moves it, and a later relationship is a NEW membership
  const beforeIllegal = rpcCount();
  assert.equal(await code(suspend(id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(end(id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(submit('ACTIVATE', id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(await code(submit('RESTORE', id, subject, NODE, alice)), 'ILLEGAL_TRANSITION');
  assert.equal(rpcCount(), beforeIllegal, 'every illegal transition is refused before a procedure is called');
  const again = await createMembership(subject, NODE, alice);
  assert.notEqual(again.membership_id, id);
  assert.equal(again.state, 'PENDING');
});

test('S4 every request and approval is preserved with the facts the directive lists', async () => {
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
  const steps = await owner('SELECT step_seq, step_type, actor_user_id, assurance_class, outcome_classification, occurred_at, result_event_seq FROM corporate_membership_request_steps WHERE request_id = $1 ORDER BY step_seq', [act.request_id]);
  assert.deepEqual(steps.map((s) => [s.step_type, s.actor_user_id, s.assurance_class]), [['APPROVED', 'g-bob', 'A1_RECENT_REAUTH'], ['EXECUTED', 'g-alice', 'A1_RECENT_REAUTH']]);
  assert.ok(steps.every((s) => s.occurred_at), 'every step is timestamped');
  assert.equal(steps[1].result_event_seq, 2);
  assert.notEqual(steps[0].actor_user_id, r.requester_user_id, 'maker ≠ checker is a stored fact');
  // directly-executed operations are recorded the same way, as an already-executed request
  const sus = await suspend(id, subject, NODE, alice);
  const [direct] = await owner('SELECT operation, approval_required, requester_user_id FROM corporate_membership_requests WHERE request_id = $1', [sus.request_id]);
  assert.deepEqual([direct.operation, direct.approval_required, direct.requester_user_id], ['SUSPEND', false, 'g-alice']);
});

// ── S5 — maker/checker and no-self-action, at the service AND the database ────────────────────────────────────────────────

test('S5 the subject never acts on their own membership: refused by the service before any procedure is called', async () => {
  const node = 'BU_FINANCIAL_SERVICES';
  const carol = await actorOf('g-carol'); // a governor, so the decision and A1 are genuinely fine — only the self-action is wrong
  const alice = await actorOf('g-alice');
  const mine = await createMembership('g-carol', node, alice); // a membership whose subject is carol, created by someone else
  const req = await submit('ACTIVATE', mine.membership_id, 'g-carol', node, alice);

  const probes = {
    create: () => svc.createPendingMembership(client, { actor: carol, subjectUserId: 'g-carol', orgNodeId: NODE, reason: 'r', reference: 'ref', governanceDecision: decision(carol, 'g-carol') }),
    activate: () => submit('ACTIVATE', mine.membership_id, 'g-carol', node, carol),
    restore: () => submit('RESTORE', mine.membership_id, 'g-carol', node, carol),
    suspend: () => suspend(mine.membership_id, 'g-carol', node, carol),
    end: () => end(mine.membership_id, 'g-carol', node, carol),
    approve: () => approve(req, carol),
    execute: () => execute(req, carol),
    cancel: () => svc.cancelMembershipRequest(client, { actor: carol, requestId: req.request_id, reason: 'no', governanceDecision: decision(carol, 'g-carol', node) }),
  };
  const before = rpcCount();
  for (const [name, run] of Object.entries(probes)) assert.equal(await code(run()), 'ACTOR_IS_SUBJECT', name);
  assert.equal(rpcCount(), before, 'none of the refused self-actions reached a procedure');
  assert.equal((await membershipRow(mine.membership_id)).state, 'PENDING');

  // … and the database refuses the very same acts if the service is bypassed
  const direct = (name, args) => client.rpc(name, args).then(dbCode);
  const carolSession = sessionIdOf(carol);
  const snap = () => JSON.parse(JSON.stringify(decision(carol, 'g-carol', node)));
  assert.equal(await direct('corporate_membership_request_submit', { p_operation: 'ACTIVATE', p_membership_id: mine.membership_id, p_requester_user_id: 'g-carol', p_requester_session_id: carolSession, p_reason: 'r', p_reference: 'x', p_governance_decision: snap() }), 'ACTOR_IS_SUBJECT');
  assert.equal(await direct('corporate_membership_request_decide', { p_request_id: req.request_id, p_checker_user_id: 'g-carol', p_checker_session_id: carolSession, p_decision: 'APPROVE', p_reason: 'r', p_expected_subject_user_id: 'g-carol', p_expected_membership_id: mine.membership_id, p_expected_org_node_id: 'BU_FINANCIAL_SERVICES', p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest, p_governance_decision: snap() }), 'ACTOR_IS_SUBJECT');
  assert.equal(await direct('corporate_membership_apply_direct', { p_operation: 'SUSPEND', p_actor_user_id: 'g-carol', p_actor_session_id: carolSession, p_subject_user_id: 'g-carol', p_org_node_id: 'BU_FINANCIAL_SERVICES', p_membership_id: mine.membership_id, p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: snap() }), 'ACTOR_IS_SUBJECT');
});

test('S5 maker ≠ checker: a requester can never approve their own authority-increasing request (service and database)', async () => {
  const subject = await newUser('s5mc');
  const alice = await actorOf('g-alice');
  const bob = await actorOf('g-bob');
  const { membership_id: id } = await createMembership(subject, NODE, alice);
  const req = await submit('ACTIVATE', id, subject, NODE, alice);

  const before = rpcCount();
  assert.equal(await code(approve(req, alice)), 'MAKER_CHECKER_SAME_ACTOR');
  assert.equal(await code(approve(req, await actorOf('g-alice'))), 'MAKER_CHECKER_SAME_ACTOR', 'a second session of the same person is the same person');
  assert.equal(rpcCount(), before, 'refused before any procedure');

  const aliceSession = sessionIdOf(await actorOf('g-alice'));
  const bypass = await client.rpc('corporate_membership_request_decide', {
    p_request_id: req.request_id, p_checker_user_id: 'g-alice', p_checker_session_id: aliceSession, p_decision: 'APPROVE', p_reason: 'self',
    p_expected_subject_user_id: subject, p_expected_membership_id: id, p_expected_org_node_id: NODE, p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest,
    p_governance_decision: JSON.parse(JSON.stringify(decision(alice, subject))),
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
  // there is no direct ACTIVATE/RESTORE: the direct procedure refuses both operations outright
  for (const op of ['ACTIVATE', 'RESTORE']) {
    const r = await client.rpc('corporate_membership_apply_direct', { p_operation: op, p_actor_user_id: 'g-alice', p_actor_session_id: sessionIdOf(alice), p_subject_user_id: subject, p_org_node_id: NODE, p_membership_id: id, p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: JSON.parse(JSON.stringify(decision(alice, subject))) });
    assert.equal(dbCode(r), 'OPERATION_NOT_DIRECT', op);
  }
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: id, subjectUserId: subject, orgNodeId: NODE, classification: 'ROUTINE', reason: 'r', reference: 'x', governanceDecision: decision(alice, subject) })), 'ILLEGAL_TRANSITION', 'PENDING cannot be suspended');

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
  const dave = await actorOf('g-dave'); // never part of this membership
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
  assert.equal(await code(execute(req, dave)), 'EXECUTOR_NOT_PARTY');
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING');
  assert.equal((await execute(req, bob)).state, 'ACTIVE');
});

test('S5 ending a governor needs a continuity attestation and at least two independent governors remaining — refused by the service before any procedure, and again by the database', async () => {
  const sub = await newUser('s5ct');
  const { membershipId } = await makeActive(sub, NODE);
  const alice = await actorOf('g-alice');
  const holds = (n) => ({ subject_holds_governance_authority: true, remaining_independent_governors: n });
  const before = rpcCount();
  assert.equal(await code(end(membershipId, sub, NODE, alice, { governance_continuity: undefined })), 'DECISION_CONTINUITY', 'no attestation');
  assert.equal(await code(end(membershipId, sub, NODE, alice, { governance_continuity: { subject_holds_governance_authority: 'yes', remaining_independent_governors: 5 } })), 'DECISION_CONTINUITY', 'a malformed attestation');
  assert.equal(await code(end(membershipId, sub, NODE, alice, { governance_continuity: holds(1) })), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await code(end(membershipId, sub, NODE, alice, { governance_continuity: holds(0) })), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(rpcCount(), before, 'refused before any procedure');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
  // the database repeats the same refusals if the service is bypassed
  const viaDatabase = async (continuity) => dbCode(await client.rpc('corporate_membership_apply_direct', {
    p_operation: 'END', p_actor_user_id: alice.userId, p_actor_session_id: sessionIdOf(alice), p_subject_user_id: sub, p_org_node_id: NODE, p_membership_id: membershipId,
    p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null,
    p_governance_decision: JSON.parse(JSON.stringify(decision(alice, sub, NODE, { governance_continuity: continuity }))),
  }));
  assert.equal(await viaDatabase(undefined), 'DECISION_CONTINUITY');
  assert.equal(await viaDatabase(holds(1)), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal((await end(membershipId, sub, NODE, alice, { governance_continuity: holds(2) })).state, 'ENDED', 'two independent governors remain: allowed');
});

test('S5 only the requester may cancel; a cancelled request can never be approved or executed', async () => {
  const sub = await newUser('s5ca');
  const alice = await actorOf('g-alice'); const bob = await actorOf('g-bob');
  const c = await createMembership(sub, NODE, alice);
  const req = await submit('ACTIVATE', c.membership_id, sub, NODE, alice);
  const beforeCancel = rpcCount();
  assert.equal(await code(svc.cancelMembershipRequest(client, { actor: bob, requestId: req.request_id, reason: 'nope', governanceDecision: decision(bob, sub) })), 'ONLY_REQUESTER_MAY_CANCEL');
  assert.equal(rpcCount(), beforeCancel, 'refused before any procedure');
  const cancelled = await svc.cancelMembershipRequest(client, { actor: alice, requestId: req.request_id, reason: 'changed my mind', governanceDecision: decision(alice, sub) });
  assert.equal(cancelled.outcome, 'CANCELLED');
  assert.equal(await code(approve(req, bob)), 'REQUEST_NOT_OPEN');
  assert.equal(await code(execute(req, alice)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal((await svc.readMembershipRequestStatus(client, req.request_id)).status, 'CANCELLED');
  assert.equal((await membershipRow(c.membership_id)).state, 'PENDING');

  // a request that is already spent can no longer be withdrawn: not twice, not after a refusal, not after execution
  const cancelAgain = (r, who = alice, forSubject = sub) => svc.cancelMembershipRequest(client, { actor: who, requestId: r.request_id, reason: 'too late', governanceDecision: decision(who, forSubject) });
  assert.equal(await code(cancelAgain(req)), 'REQUEST_NOT_OPEN', 'cancelled twice');
  const sub2 = await newUser('s5cb');
  const c2 = await createMembership(sub2, NODE, alice);
  const refusedReq = await submit('ACTIVATE', c2.membership_id, sub2, NODE, alice);
  await approve(refusedReq, bob, 'REFUSE');
  assert.equal(await code(cancelAgain(refusedReq, alice, sub2)), 'REQUEST_NOT_OPEN', 'after a refusal');
  const doneReq = await submit('ACTIVATE', c2.membership_id, sub2, NODE, alice);
  await approve(doneReq, bob);
  await execute(doneReq, alice);
  assert.equal(await code(cancelAgain(doneReq, alice, sub2)), 'REQUEST_NOT_OPEN', 'after execution');
  assert.equal((await membershipRow(c2.membership_id)).state, 'ACTIVE', 'and the executed change stands');
});

test('S5 creation is PENDING-only and mandatory-provenance: reason and reference are required, bounded, and recorded', async () => {
  const sub = await newUser('s5cr');
  const alice = await actorOf('g-alice');
  const base = { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'Joins', reference: 'HR-9', governanceDecision: decision(alice, sub) };
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: '   ' })), 'REASON_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: undefined })), 'REASON_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reference: '' })), 'REFERENCE_REQUIRED');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reason: 'x'.repeat(2001) })), 'REASON_TOO_LONG');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, reference: 'x'.repeat(301) })), 'REFERENCE_TOO_LONG');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, orgNodeId: 'NOT_A_NODE' })), 'DECISION_SCOPE', 'a decision for another unit does not cover this one');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, orgNodeId: 'NOT_A_NODE', governanceDecision: decision(alice, sub, 'NOT_A_NODE') })), 'NODE_UNKNOWN', 'and a unit that does not exist cannot be joined');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, orgNodeId: 'bu_marketplace' })), 'NODE_UNKNOWN', 'identifier shape is validated before anything else');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, state: 'ACTIVE' })), 'INPUT_UNKNOWN_KEY', 'there is no way to ask for any state but PENDING');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, effectiveFrom: '2030-01-02T00:00:00Z', effectiveUntil: '2030-01-01T00:00:00Z' })), 'INPUT_INVALID');
  assert.equal(await code(svc.createPendingMembership(client, { ...base, subjectUserId: 'nobody-by-that-name' })), 'DECISION_BINDING');
  const nobody = await code(svc.createPendingMembership(client, { ...base, subjectUserId: 'nobody-by-that-name', governanceDecision: decision(alice, 'nobody-by-that-name') }));
  assert.equal(nobody, 'SUBJECT_UNKNOWN');
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
  const decide = (expected, who = bob, d = decision(who, sub)) => svc.decideMembershipRequest(client, { actor: who, requestId: req.request_id, decision: 'APPROVE', reason: 'ok', expected, governanceDecision: d });
  const before = rpcCount();
  assert.equal(await code(decide({ ...good, subjectUserId: other })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, membershipId: o.membership_id })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, orgNodeId: 'BU_SERVICE_NETWORK' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, operation: 'RESTORE' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, bindingDigest: '0'.repeat(64) })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, bindingDigest: 'abc' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide({ ...good, operation: 'SUSPEND' })), 'BINDING_MISMATCH');
  assert.equal(await code(decide(good, bob, decision(bob, other))), 'DECISION_BINDING', 'a decision issued for another subject');
  assert.equal(rpcCount(), before, 'every mismatch was refused before a procedure was called');
  // the database repeats the check if the service is bypassed
  const bypass = await client.rpc('corporate_membership_request_decide', {
    p_request_id: req.request_id, p_checker_user_id: 'g-bob', p_checker_session_id: sessionIdOf(bob), p_decision: 'APPROVE', p_reason: 'ok',
    p_expected_subject_user_id: other, p_expected_membership_id: c.membership_id, p_expected_org_node_id: NODE, p_expected_operation: 'ACTIVATE', p_expected_binding_digest: req.binding_digest,
    p_governance_decision: JSON.parse(JSON.stringify(decision(bob, sub))),
  });
  assert.equal(dbCode(bypass), 'BINDING_MISMATCH');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: req.request_id, expectedBindingDigest: '1'.repeat(64), governanceDecision: decision(alice, sub) })), 'BINDING_MISMATCH');
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
  let thrown;
  try { await execute(req, alice); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof CorporateGovernanceError);
  assert.equal(thrown.code, 'STALE_PRECONDITION');
  assert.equal(thrown.recorded, true, 'the refusal is itself in the ledger');
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

  const result = await suspend(membershipId, sub, NODE, alice, { decision: { capabilities: BOTH }, input: { classification: 'SECURITY_COMPROMISE', reference: 'SEC-77' } });
  assert.equal(result.state, 'SUSPENDED');
  assert.equal(result.session_revocation.scope, 'all');
  assert.equal(result.session_revocation.revoked_count, 2);
  assert.equal(await liveSessions(sub), 0, 'nothing left usable');
  const [ledger] = await owner('SELECT classification, session_revocation FROM corporate_membership_requests WHERE request_id = $1', [result.request_id]);
  assert.equal(ledger.classification, 'SECURITY_COMPROMISE');
  assert.equal(ledger.session_revocation.primitive, 'sessionSecurityService.revokeSessionsForUser');
  assert.equal(ledger.session_revocation.revoked_count, 2);
  assert.doesNotMatch(JSON.stringify(ledger.session_revocation), /tok-/, 'session ids only, never a token');
  const audit = await owner(`SELECT actor_user_id, new_value FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED' ORDER BY id DESC LIMIT 1`);
  assert.equal(Number((await owner(`SELECT COUNT(*) AS n FROM trust_audit_events WHERE event_type = 'USER_SESSIONS_REVOKED'`))[0].n), auditBefore + 1, 'the repository\'s own session audit was written');
  assert.equal(audit[0].actor_user_id, 'g-alice');
  assert.equal(audit[0].new_value.revoked_count, 2);
});

test('S7 compromise needs the session-revoke capability — and is denied BEFORE any session is touched', async () => {
  const sub = await newUser('s7c');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub);
  const alice = await actorOf('g-alice');
  const before = rpcCount();
  const refused = await code(suspend(membershipId, sub, NODE, alice, { input: { classification: 'SECURITY_COMPROMISE' } })); // manage only
  assert.equal(refused, 'DECISION_CAPABILITY');
  assert.equal(await liveSessions(sub), 1, 'no session was revoked');
  assert.equal(rpcCount(), before);
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
  // classification is never available outside SUSPEND
  assert.equal(await code(svc.endMembership(client, { actor: alice, membershipId, subjectUserId: sub, orgNodeId: NODE, classification: 'SECURITY_COMPROMISE', reason: 'r', reference: 'x', governanceDecision: decision(alice, sub, NODE, { capabilities: BOTH }) })), 'CLASSIFICATION_NOT_ALLOWED');
  assert.equal(await code(suspend(membershipId, sub, NODE, alice, { input: { classification: 'SOMETHING_ELSE' } })), 'CLASSIFICATION_INVALID');
  // the procedure itself also refuses a compromise suspension without a revocation record, or while a session is live
  const sid = sessionIdOf(alice);
  const args = (revocation) => ({ p_operation: 'SUSPEND', p_actor_user_id: 'g-alice', p_actor_session_id: sid, p_subject_user_id: sub, p_org_node_id: NODE, p_membership_id: membershipId, p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'SECURITY_COMPROMISE', p_session_revocation: revocation, p_governance_decision: JSON.parse(JSON.stringify(decision(alice, sub, NODE, { capabilities: BOTH }))) });
  assert.equal(dbCode(await client.rpc('corporate_membership_apply_direct', args(null))), 'SESSION_REVOCATION_REQUIRED');
  assert.equal(dbCode(await client.rpc('corporate_membership_apply_direct', args({ claimed: 'revoked' }))), 'SESSIONS_STILL_VALID', 'a claim is not a revocation');
  assert.equal((await membershipRow(membershipId)).state, 'ACTIVE');
});

test('S7 if revocation fails or cannot be audited, nothing is suspended', async () => {
  const sub = await newUser('s7f');
  const { membershipId } = await makeActive(sub, NODE);
  await addSession(db, sub);
  const alice = await actorOf('g-alice');
  const compromise = () => suspend(membershipId, sub, NODE, alice, { decision: { capabilities: BOTH }, input: { classification: 'SECURITY_COMPROMISE' } });

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
  client.beforeRpc = async (name) => { if (name === 'corporate_membership_apply_direct' && injected < 1) { injected += 1; await addSession(db, sub); } };
  const result = await suspend(membershipId, sub, NODE, alice, { decision: { capabilities: BOTH }, input: { classification: 'SECURITY_COMPROMISE' } });
  assert.equal(result.session_revocation.attempts, 2);
  assert.equal(result.session_revocation.revoked_count, 1, 'the login that raced in was revoked too');
  assert.equal(await liveSessions(sub), 0);

  const sub2 = await newUser('s7p');
  const { membershipId: id2 } = await makeActive(sub2, NODE);
  client.beforeRpc = async (name) => { if (name === 'corporate_membership_apply_direct') await addSession(db, sub2); };
  assert.equal(await code(suspend(id2, sub2, NODE, alice, { decision: { capabilities: BOTH }, input: { classification: 'SECURITY_COMPROMISE' } })), 'SESSIONS_STILL_VALID');
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
    assert.doesNotMatch(JSON.stringify(e), /reason|token|decision|reference/i, 'identity of the change only');
  }
  const [epoch] = await owner('SELECT authorization_epoch FROM corporate_membership_authorization_epoch WHERE user_id = $1', [sub]);
  assert.equal(Number(epoch.authorization_epoch), 4);

  // refused and recorded-but-not-executed calls fire nothing
  const before = seen.length;
  await code(suspend(c.membership_id, sub, NODE, alice)); // ENDED → illegal
  await code(svc.createPendingMembership(client, { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: '', reference: 'x', governanceDecision: decision(alice, sub) }));
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
  assert.deepEqual(Object.keys(await membershipRow(membershipId)).filter((c) => /capab|permission|grant|role/i.test(c)), [], 'no capability column exists to be written');

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
  const sub = await newUser('s9b');
  const { membershipId } = await makeActive(sub, 'BU_DIASPORA_TRADE');
  await end(membershipId, sub, 'BU_DIASPORA_TRADE', await actorOf('g-alice'));
  const after = await owner('SELECT id, role FROM users ORDER BY id');
  assert.deepEqual(after.filter((u) => u.id !== sub), roles, 'no other account\'s role changed');
  assert.equal(after.find((u) => u.id === sub).role, 'owner', 'and the subject\'s own platform role is exactly what it was');
});

// ── S10 — legacy platform roles are not target governance authority ───────────────────────────────────────────────────────

test('S10 admin / platform_admin / super_admin / tenant admin / legacy org admin cannot mutate: no decision, no mint, no evaluator, no capability', async () => {
  const legacy = ['u-admin', 'u-padmin', 'u-sadmin', 'u-tadmin', 'u-lorg'];
  const target = await newUser('s10');
  const rpcBefore = rpcCount();
  const rowsBefore = await owner('SELECT COUNT(*)::int AS n FROM corporate_memberships');
  for (const userId of legacy) {
    const a = await actorOf(userId); // real session, genuinely A1 — authentication is not the missing piece
    const input = { actor: a, subjectUserId: target, orgNodeId: NODE, reason: 'I am an administrator', reference: 'LEGACY-1' };
    assert.equal(await code(svc.createPendingMembership(client, { ...input, governanceDecision: undefined })), 'DECISION_MISSING', `${userId} without a decision`);
    assert.equal(await code(svc.createPendingMembership(client, { ...input, governanceDecision: decisionFor({ actor: userId, subject: target }) })), 'DECISION_NOT_MINTED', `${userId} with a hand-written decision`);
    assert.equal(await code(svc.createPendingMembership(client, { ...input, governanceDecision: evaluateCorporateGovernanceAuthorization({ userId }) })), 'DECISION_UNAVAILABLE', `${userId} via the (absent) evaluator`);
    assert.equal(await code(svc.createPendingMembership(client, { ...input, governanceDecision: { role: 'super_admin', platformRole: 'super_admin', capabilities: ['corporate.people.membership.manage'] } })), 'DECISION_NOT_MINTED');
    assert.equal(mintCode(decisionFor({ actor: userId, subject: target, source: 'legacy_admin_compatibility_bridge' })), 'DECISION_SOURCE');
    assert.equal(mintCode({ ...decisionFor({ actor: userId, subject: target }), capabilities: ['admin', 'platform_admin', 'super_admin'] }), 'DECISION_CAPABILITY');
  }
  assert.equal(rpcCount(), rpcBefore, 'not one of them reached the database');
  assert.deepEqual(await owner('SELECT COUNT(*)::int AS n FROM corporate_memberships'), rowsBefore);
});

test('S10 the database repeats the refusal: a legacy-sourced, role-shaped or capability-less snapshot is refused even if the service is bypassed', async () => {
  const target = await newUser('s10d');
  const sadmin = await actorOf('u-sadmin');
  const sid = sessionIdOf(sadmin);
  const call = (snapshotValue) => client.rpc('corporate_membership_apply_direct', {
    p_operation: 'CREATE', p_actor_user_id: 'u-sadmin', p_actor_session_id: sid, p_subject_user_id: target, p_org_node_id: NODE, p_membership_id: null,
    p_reason: 'bypass', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: snapshotValue,
  }).then(dbCode);
  const good = decisionFor({ actor: 'u-sadmin', subject: target });
  assert.equal(await call(null), 'DECISION_MISSING');
  assert.equal(await call({ role: 'super_admin' }), 'DECISION_CONTRACT');
  assert.equal(await call({ ...good, source: 'legacy_admin_compatibility_bridge' }), 'DECISION_SOURCE');
  assert.equal(await call({ ...good, contract: 'carup.corporate_access.v1' }), 'DECISION_CONTRACT');
  assert.equal(await call({ ...good, capabilities: ['super_admin'] }), 'DECISION_CAPABILITY');
  assert.equal(await call({ ...good, scope: { kind: 'GLOBAL' } }), 'DECISION_SCOPE');
  assert.equal(await call({ ...good, assurance: { class: 'A2_STRONG', server_proven: true } }), 'DECISION_ASSURANCE');
  assert.equal(await call({ ...good, decision: 'granted', source: 'target_corporate_governance', actor_user_id: 'u-admin' }), 'DECISION_BINDING');
  assert.equal((await owner('SELECT COUNT(*)::int AS n FROM corporate_memberships WHERE user_id = $1', [target]))[0].n, 0);
  // and the one thing that DOES pass proves the harness could have failed: the same call with a genuine snapshot succeeds
  assert.equal((await client.rpc('corporate_membership_apply_direct', { p_operation: 'CREATE', p_actor_user_id: 'u-sadmin', p_actor_session_id: sid, p_subject_user_id: target, p_org_node_id: NODE, p_membership_id: null, p_reason: 'control', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: good })).error, null,
    'positive control: an explicit, well-formed target decision is what authority is made of — the platform role was never the obstacle or the key');
});

// ── S11 — concurrency on one connection (real multi-session proof is a separate evidence script) ─────────────────────────

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

test('S11 a database outage or a malformed procedure result is a denial, never a silent success', async () => {
  const sub = await newUser('s11c');
  const alice = await actorOf('g-alice');
  const input = { actor: alice, subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x', governanceDecision: decision(alice, sub) };
  const broken = { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }), from: client.from.bind(client) };
  assert.equal(await code(svc.createPendingMembership(broken, input)), 'GOVERNANCE_UNAVAILABLE');
  const garbage = { rpc: async () => ({ data: 'ok', error: null }), from: client.from.bind(client) };
  assert.equal(await code(svc.createPendingMembership(garbage, { ...input, governanceDecision: decision(alice, sub) })), 'GOVERNANCE_UNAVAILABLE');
  const thrower = { rpc: async () => { throw new Error('socket hang up'); }, from: client.from.bind(client) };
  assert.equal(await code(svc.createPendingMembership(thrower, { ...input, governanceDecision: decision(alice, sub) })), 'GOVERNANCE_UNAVAILABLE');
  // a table guard (the second line of defence) refusing a write is a hard denial of its own kind — never "unavailable", never a retry
  for (const message of ['CORPORATE_GOVERNANCE_STEP_MAKER_IS_CHECKER', 'CORPORATE_MEMBERSHIP_EVENT_CHAIN_BROKEN', 'CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN']) {
    const guarded = { rpc: async () => ({ data: null, error: { code: '23514', message } }), from: client.from.bind(client) };
    const refused = await svc.createPendingMembership(guarded, { ...input, governanceDecision: decision(alice, sub) }).catch((e) => e);
    assert.ok(refused instanceof CorporateGovernanceError);
    assert.deepEqual([refused.code, refused.details.guard], ['GOVERNANCE_GUARD_REFUSED', message]);
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
  assert.equal(await code(svc.cancelMembershipRequest(client, { actor: alice, requestId: made.request_id, reason: 'r', governanceDecision: decision(alice, sub) })), 'GOVERNANCE_UNAVAILABLE');
  client.faults.clear();
  assert.equal(rpcCount(), before);
});

test('S11 malformed or unknown identifiers are refused with their own codes before any write', async () => {
  const sub = await newUser('s11d');
  const alice = await actorOf('g-alice');
  const before = rpcCount();
  const ghost = '00000000-0000-4000-8000-000000000000';
  const m = { subjectUserId: sub, orgNodeId: NODE, reason: 'r', reference: 'x' };
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: 'not-a-uuid', ...m, governanceDecision: decision(alice, sub) })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: ghost, ...m, governanceDecision: decision(alice, sub) })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.requestMembershipActivation(client, { actor: alice, membershipId: ghost, ...m, governanceDecision: decision(alice, sub) })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: ghost, expectedBindingDigest: '0'.repeat(64), governanceDecision: decision(alice, sub) })), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.executeMembershipRequest(client, { actor: alice, requestId: 'nope', expectedBindingDigest: '0'.repeat(64), governanceDecision: decision(alice, sub) })), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.readMembershipRequestStatus(client, ghost)), 'REQUEST_NOT_FOUND');
  assert.equal(await code(svc.decideMembershipRequest(client, { actor: alice, requestId: ghost, decision: 'MAYBE', reason: 'r', expected: {}, governanceDecision: decision(alice, sub) })), 'DECISION_VALUE_INVALID');
  assert.equal(rpcCount(), before, 'none of them reached a procedure');
  // a membership id that exists but belongs to someone else binds to nothing
  const other = await newUser('s11e');
  const theirs = await createMembership(other, NODE, alice);
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: theirs.membership_id, ...m, governanceDecision: decision(alice, sub) })), 'BINDING_MISMATCH');
  assert.equal(await code(svc.suspendMembership(client, { actor: alice, membershipId: theirs.membership_id, ...m, subjectUserId: other, orgNodeId: 'BU_SERVICE_NETWORK', governanceDecision: decision(alice, other, 'BU_SERVICE_NETWORK') })), 'BINDING_MISMATCH', 'right person, wrong unit');
});
