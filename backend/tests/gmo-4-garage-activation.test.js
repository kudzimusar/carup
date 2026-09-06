/**
 * GMO-4 — canonical business activation.
 *
 * The highest-risk phase: this is where authority comes into existence. The guarantee that matters
 * most is not "the code validates its input" but "there is no input to validate" — the database
 * function takes an application id, and derives the tenant, the founder and the role from the row a
 * reviewer approved. A browser cannot choose any of them because no parameter exists for them.
 *
 * The transactional guarantees (atomicity, the row lock, the guarded claim) are proven against real
 * PostgreSQL and recorded in the GMO-4 receipt. What is proven here is the seam above them: that
 * this service adds no way around any of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { activateApprovedApplication, activateAfterApproval } =
  await import('../services/garageOnboarding/garageActivationService.js');

const APP = 'app-1';
const APPLICANT = 'u_applicant';
const REVIEWER = 'u_reviewer';
const TENANT = '11111111-1111-1111-1111-111111111111';

const reviewer = { id: REVIEWER, role: 'admin' };

/** Records every RPC call and every table write so the test can assert what was NOT done. */
const UNSET = Symbol('unset');
function client({ rpcResult = UNSET, rpcError } = {}, log = []) {
  return {
    rpc: async (name, args) => {
      log.push({ rpc: name, args });
      if (rpcError) return { data: null, error: { message: rpcError } };
      const fallback = [{ tenant_id: TENANT, membership_id: 'm-1', founder_user_id: APPLICANT, founding_role: 'admin', created: true }];
      return { data: rpcResult === UNSET ? fallback : rpcResult, error: null };
    },
    from: (table) => {
      const chain = {
        select() { return chain; },
        insert(p) { log.push({ table, op: 'insert', payload: p }); return chain; },
        update(p) { log.push({ table, op: 'update', payload: p }); return chain; },
        eq() { return chain; }, is() { return chain; }, in() { return chain; },
        order() { return chain; }, limit() { return chain; },
        maybeSingle: async () => ({ data: { id: 'a1' }, error: null }),
        single: async () => ({ data: { id: 'a1' }, error: null }),
        then(res) { return Promise.resolve({ data: { id: 'a1' }, error: null }).then(res); },
      };
      return chain;
    },
  };
}

const src = (rel) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

// ── the browser cannot choose anything ───────────────────────────────────────────────────────────

test('GMO-4: activation accepts an application id and NOTHING else', async () => {
  const log = [];
  await activateApprovedApplication(client({}, log), reviewer, APP, {});
  const call = log.find((l) => l.rpc);
  assert.equal(call.rpc, 'activate_garage_application');
  // If a tenant id, a user id or a role could be passed, a caller could choose them.
  assert.deepEqual(Object.keys(call.args).sort(), ['p_actor_user_id', 'p_application_id']);
  assert.equal(call.args.p_application_id, APP);
});

test('GMO-4: no caller-supplied tenant, founder or role can reach the database', async () => {
  const log = [];
  // A hostile caller passing every field an attacker would want.
  await activateApprovedApplication(client({}, log), {
    id: REVIEWER, role: 'admin',
    tenantId: 'attacker-tenant', tenant_id: 'attacker-tenant',
    founderUserId: 'attacker', user_id: 'attacker', foundingRole: 'super_admin',
  }, APP, {
    tenantId: 'attacker-tenant', role: 'super_admin', founder: 'attacker',
  });
  const call = log.find((l) => l.rpc);
  const serialized = JSON.stringify(call.args);
  assert.ok(!serialized.includes('attacker'), 'nothing from the caller reaches the function');
  assert.ok(!serialized.includes('super_admin'));
});

test('GMO-4: the actor is recorded but is NOT the founder', async () => {
  const log = [];
  const out = await activateApprovedApplication(client({}, log), reviewer, APP, {});
  const call = log.find((l) => l.rpc);
  assert.equal(call.args.p_actor_user_id, REVIEWER, 'who ran it is recorded');
  // The founder comes back from the database, derived from the application — not from the actor.
  assert.equal(out.founderUserId, APPLICANT);
  assert.notEqual(out.founderUserId, REVIEWER);
});

test('GMO-4: the service never writes tenancy itself', () => {
  const s = src('../services/garageOnboarding/garageActivationService.js');
  for (const table of ['tenants', 'tenant_users', 'users']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)`).test(s),
      `activation must go through the function, never write ${table} directly`);
  }
  // The founding role must never be a literal this layer chooses. It may only be reported back
  // from what the database actually wrote.
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/founding_role\s*:\s*['"]/.test(code),
    'the founding role must be read from the database, never hardcoded here');
  assert.ok(/founding_role:\s*result\.foundingRole/.test(code),
    'the audit records the role the database actually wrote');
});

// ── idempotency ──────────────────────────────────────────────────────────────────────────────────

test('GMO-4: a second activation reports created=false and the SAME tenant', async () => {
  const log = [];
  const c = client({ rpcResult: [{ tenant_id: TENANT, membership_id: 'm-1', founder_user_id: APPLICANT, founding_role: 'admin', created: false }] }, log);
  const out = await activateApprovedApplication(c, reviewer, APP, {});
  assert.equal(out.created, false);
  assert.equal(out.tenantId, TENANT);
  assert.equal(out.membershipId, 'm-1');
});

test('GMO-4: a no-op retry writes no audit line and emits no event', async () => {
  const log = [];
  const emitted = [];
  const c = client({ rpcResult: [{ tenant_id: TENANT, membership_id: 'm-1', founder_user_id: APPLICANT, founding_role: 'admin', created: false }] }, log);
  await activateApprovedApplication(c, reviewer, APP, { emitDomainEvent: async (...a) => { emitted.push(a); } });
  // A log that records the garage being built three times is a log that cannot be read.
  assert.ok(!log.some((l) => l.table === 'trust_audit_events'), 'no audit line for a no-op');
  assert.equal(emitted.length, 0, 'no event for a no-op');
});

test('GMO-4: a real creation IS audited, naming the founder and the founding role', async () => {
  const log = [];
  const emitted = [];
  await activateApprovedApplication(client({}, log), reviewer, APP, {
    emitDomainEvent: async (...a) => { emitted.push(a); },
  });
  const audit = log.find((l) => l.table === 'trust_audit_events' && l.op === 'insert');
  assert.ok(audit, 'a real activation is audited');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][1], 'garage.workspace.activated');
  assert.equal(emitted[0][2].founderUserId, APPLICANT);
});

// ── refusals, in words a reviewer can act on ─────────────────────────────────────────────────────

test('GMO-4: a non-approved application cannot activate, and says which state it is in', async () => {
  const c = client({ rpcError: 'GARAGE_APPLICATION_NOT_APPROVED:submitted' });
  await assert.rejects(
    () => activateApprovedApplication(c, reviewer, APP, {}),
    /submitted.*Only an approved application becomes a garage/s,
  );
});

test('GMO-4: a rejected application cannot activate', async () => {
  const c = client({ rpcError: 'GARAGE_APPLICATION_NOT_APPROVED:rejected' });
  await assert.rejects(() => activateApprovedApplication(c, reviewer, APP, {}), /rejected/);
});

test('GMO-4: a missing application is reported as missing', async () => {
  const c = client({ rpcError: 'GARAGE_APPLICATION_NOT_FOUND' });
  await assert.rejects(() => activateApprovedApplication(c, reviewer, APP, {}), /Application not found/);
});

test('GMO-4: a lost activation race is reported as the winner already having built it', async () => {
  const c = client({ rpcError: 'GARAGE_APPLICATION_ALREADY_ACTIVATED' });
  await assert.rejects(
    () => activateApprovedApplication(c, reviewer, APP, {}),
    /activated by another request a moment ago/,
  );
});

test('GMO-4: an unconfirmable activation is NEVER reported as success', async () => {
  // The single most dangerous outcome: telling someone they have a workspace they cannot open.
  for (const shape of [[], null, [{ tenant_id: null, created: true }]]) {
    const c = client({ rpcResult: shape });
    await assert.rejects(
      () => activateApprovedApplication(c, reviewer, APP, {}),
      /could not be confirmed. Nothing was changed/,
      `a result of ${JSON.stringify(shape)} must not read as success`,
    );
  }
});

test('GMO-4: an application id is required', async () => {
  await assert.rejects(() => activateApprovedApplication(client({}), reviewer, null, {}), /application id is required/);
});

// ── approve-then-activate: a failure must not cost the decision ──────────────────────────────────

test('GMO-4: a failed activation reports activated=false and keeps the decision', async () => {
  const c = client({ rpcError: 'connection reset by peer' });
  const out = await activateAfterApproval(c, reviewer, APP, {});
  assert.equal(out.activated, false);
  assert.equal(out.retryable, true);
  assert.match(out.reason, /connection reset/);
});

test('GMO-4: a failed activation NEVER reports a tenant', async () => {
  const c = client({ rpcError: 'connection reset' });
  const out = await activateAfterApproval(c, reviewer, APP, {});
  // "approved and activated" for something that was not activated is the Part 10 gate.
  assert.equal(out.tenantId, undefined);
  assert.equal(out.created, undefined);
});

test('GMO-4: a successful activation after approval reports the tenant', async () => {
  const out = await activateAfterApproval(client({}), reviewer, APP, {});
  assert.equal(out.activated, true);
  assert.equal(out.tenantId, TENANT);
  assert.equal(out.created, true);
});

// ── the route seam ───────────────────────────────────────────────────────────────────────────────

test('GMO-4: the activate route carries the same governed gates as deciding', () => {
  const s = src('../routes/garageReviewRoutes.js');
  const block = s.slice(s.indexOf("'/api/admin/garage-applications/:applicationId/activate'"));
  assert.match(block.slice(0, 400), /\.\.\.reviewer/, 'role + capability');
  assert.match(block.slice(0, 400), /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/, 'step-up');
});

test('GMO-4: the decision route reports activation SEPARATELY from the decision', () => {
  const s = src('../routes/garageReviewRoutes.js');
  assert.match(s, /result\.activation = await activateAfterApproval/);
  // Activation is attempted only for an approval, never for a rejection.
  assert.match(s, /result\.application\?\.status === 'approved'/);
});

test('GMO-4: the migration is the only place the founding role is written', () => {
  const migration = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations/20260906150000_garage_business_activation.sql'),
    'utf8',
  );
  assert.match(migration, /-- \+migrate Up/, 'migration marker contract');

  // Strip SQL comments BEFORE asserting on the body. This file explains its own guarantees in
  // prose at the top, so a naive /FOR UPDATE/ match reads the comment describing the lock rather
  // than the lock — and stays green when the lock is deleted. A mutation caught exactly that.
  const sql = migration.replace(/--[^\n]*/g, '');

  assert.match(sql, /FROM public\.garage_applications\s+WHERE id = p_application_id\s+FOR UPDATE;/,
    'the application row is locked FOR UPDATE');
  assert.match(sql, /WHERE id = p_application_id\s+AND activated_tenant_id IS NULL;/,
    'the claim is guarded on the row still being unclaimed');
  assert.match(sql, /GARAGE_APPLICATION_ALREADY_ACTIVATED/,
    'a lost claim aborts rather than proceeding');
  assert.match(sql, /VALUES \(v_tenant_id, v_app\.applicant_user_id, 'admin'\)/,
    'the founder is the applicant and the role is a literal admin');
  // PO-1: the person's platform role is never touched.
  assert.ok(!/UPDATE\s+public\.users/i.test(sql), 'activation must never modify the users table');
});
