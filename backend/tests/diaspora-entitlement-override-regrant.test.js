/**
 * Ledger #26 — a revoked entitlement override can be granted again (Issue #127).
 *
 * The bug this file exists for is not "an error was thrown". It is that a per-user entitlement
 * override, once revoked, was PERMANENTLY ungrantable: `diaspora_user_entitlement_overrides` carries
 * a soft-delete column and a unique constraint on (tenant_id, user_id, feature_key) that has no
 * deleted_at predicate, so the tombstone keeps the unique slot forever. applyAdminOverride searched
 * only non-deleted rows, could not see it, took the INSERT branch, and got 23505 — surfaced as a
 * DatabaseError 500 whose message named a Postgres constraint. An operator reading that concludes the
 * database is broken, not "this user can never be given this capability again".
 *
 * So the first test here is about the CONSTRAINT, not about the service: if the mock ever stops
 * modelling it, every other test in this file would pass against a system that still cannot re-grant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase, UNIQUE_INDEXES } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const ent = await import('../services/diaspora/diasporaEntitlementService.js');
const { FEATURE_KEYS } = await import('../constants/diaspora/diasporaEntitlements.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER = 'user-x';
const FEATURE = FEATURE_KEYS.AUDIT_EXPORT;

const platformAdmin = { id: 'admin-1', platformRole: 'platform_admin' };
const tenantAdminA = { id: 'admin-a', tenantRole: 'tenant_admin', tenantId: TENANT_A };
const tenantAdminB = { id: 'admin-b', tenantRole: 'tenant_admin', tenantId: TENANT_B };

function client(seed = {}) {
  return createMockSupabase({
    diaspora_subscription_plans: [],
    diaspora_subscriptions: [{
      id: 'sub-a', tenant_id: TENANT_A, plan_key: 'diaspora_buyer', status: 'active',
      deleted_at: null, created_at: '2026-06-01T00:00:00.000Z',
    }],
    diaspora_user_entitlement_overrides: [],
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    diaspora_import_audit_log: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

const auditActions = (c) => c._rows('diaspora_import_audit_log').map((a) => a.action);
const overridesFor = (c) => c._rows('diaspora_user_entitlement_overrides')
  .filter((r) => String(r.tenant_id) === TENANT_A && r.user_id === USER && r.feature_key === FEATURE);

// ── The constraint that causes all of this ──────────────────────────────────────────────────────

test('the unique constraint is modelled, and it does NOT exempt soft-deleted rows', async () => {
  assert.deepEqual(
    UNIQUE_INDEXES.diaspora_user_entitlement_overrides,
    [['tenant_id', 'user_id', 'feature_key']],
    'the mock must model uq_diaspora_user_override or every re-grant test below is vacuous',
  );

  const c = client({
    diaspora_user_entitlement_overrides: [{
      id: 'ov-dead', tenant_id: TENANT_A, user_id: USER, feature_key: FEATURE,
      value: true, deleted_at: '2026-07-01T00:00:00.000Z',
    }],
  });

  // The old code path, reproduced literally: it cannot see the tombstone, so it inserts.
  const { data: visible } = await c.from('diaspora_user_entitlement_overrides').select('*')
    .eq('tenant_id', TENANT_A).eq('user_id', USER).eq('feature_key', FEATURE).is('deleted_at', null);
  assert.equal(visible.length, 0, 'the revoked row is invisible to a deleted_at IS NULL read');

  const { error } = await c.from('diaspora_user_entitlement_overrides')
    .insert({ tenant_id: TENANT_A, user_id: USER, feature_key: FEATURE, value: true }).select().single();
  assert.equal(error?.code, '23505', 'the soft-deleted row still occupies the unique slot');
});

// ── Grant → revoke → re-grant ───────────────────────────────────────────────────────────────────

test('a revoked override can be granted again, restoring the SAME logical row', async () => {
  const c = client();

  const granted = await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true,
    actor: platformAdmin, reason: 'pilot',
  });
  assert.equal(granted.outcome, 'GRANTED');

  const revoked = await ent.revokeAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin, reason: 'pilot ended',
  });
  assert.equal(revoked.outcome, 'REVOKED');
  assert.ok(revoked.deleted_at, 'revoke soft-deletes rather than dropping the row');

  // This is the call that used to be a 500 forever.
  const regranted = await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true,
    actor: platformAdmin, reason: 'pilot resumed',
  });
  assert.equal(regranted.outcome, 'REGRANTED');
  assert.equal(regranted.id, granted.id, 'the existing logical row is restored, not duplicated');
  assert.equal(regranted.deleted_at, null);
  assert.equal(overridesFor(c).length, 1, 'exactly one row per (tenant, user, feature), always');
});

test('a re-grant surfaces no 23505 and no generic 500', async () => {
  const c = client();
  await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
  });
  await ent.revokeAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin,
  });
  await assert.doesNotReject(() => ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
  }));
});

test('the re-granted override takes effect again in resolved entitlements', async () => {
  const c = client();
  // audit.export is false on diaspora_buyer, so every state here is observable through the resolver.
  const before = await ent.checkFeature(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE });
  assert.equal(before.allowed, false);

  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  assert.equal((await ent.checkFeature(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE })).allowed, true);

  await ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin });
  assert.equal((await ent.checkFeature(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE })).allowed, false,
    'a revoked override must stop applying — resolveOverrides filters on deleted_at');

  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  assert.equal((await ent.checkFeature(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE })).allowed, true);
});

// ── Audit ───────────────────────────────────────────────────────────────────────────────────────

test('audit records grant, revoke AND re-grant as three distinguishable events', async () => {
  const c = client();
  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  await ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin });
  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });

  // One shared "APPLIED" action for all three would hide the only event an auditor is looking for:
  // a capability coming back after somebody deliberately took it away.
  assert.deepEqual(auditActions(c), [
    'ENTITLEMENT_OVERRIDE_GRANTED',
    'ENTITLEMENT_OVERRIDE_REVOKED',
    'ENTITLEMENT_OVERRIDE_REGRANTED',
  ]);

  const regrant = c._rows('diaspora_import_audit_log').at(-1);
  assert.equal(regrant.previous_state.revoked, true, 'the re-grant records what it revived');
  assert.equal(regrant.new_state.revoked, false);
  assert.equal(regrant.metadata.featureKey, FEATURE);
  assert.equal(regrant.tenant_id, TENANT_A);
  assert.ok(regrant.cryptographic_seal);
});

test('an update to a live override is audited as an update, not as a re-grant', async () => {
  const c = client();
  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  const updated = await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: false, actor: platformAdmin });
  assert.equal(updated.outcome, 'UPDATED');
  assert.deepEqual(auditActions(c), ['ENTITLEMENT_OVERRIDE_GRANTED', 'ENTITLEMENT_OVERRIDE_UPDATED']);
});

test('the audit row carries the request correlation id', async () => {
  const c = client();
  await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
    req: { headers: { 'x-correlation-id': 'corr-ov-1' } },
  });
  assert.equal(c._rows('diaspora_import_audit_log')[0].metadata.correlationId, 'corr-ov-1');
});

// ── Concurrency ─────────────────────────────────────────────────────────────────────────────────

test('concurrent re-grants are idempotent: one row, one live override, no error', async () => {
  const c = client();
  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  await ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin });

  const results = await Promise.all(Array.from({ length: 8 }, () => ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
  })));

  const rows = overridesFor(c);
  assert.equal(rows.length, 1, 'eight concurrent re-grants must converge on one row');
  assert.equal(rows[0].deleted_at, null);
  assert.equal(new Set(results.map((r) => r.id)).size, 1, 'they all addressed the same logical row');
  assert.ok(results.every((r) => r.value === true));
});

test('concurrent FIRST grants also converge (nothing exists to lock, so ON CONFLICT is what saves it)', async () => {
  const c = client();
  const results = await Promise.all(Array.from({ length: 5 }, () => ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
  })));
  assert.equal(overridesFor(c).length, 1);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
});

// ── Identity is server-derived ──────────────────────────────────────────────────────────────────

test('a tenant admin cannot override entitlements in another tenant', async () => {
  const c = client();
  await assert.rejects(
    () => ent.applyAdminOverride(c, {
      tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: tenantAdminB,
    }),
    (err) => err.statusCode === 403,
  );
  assert.equal(overridesFor(c).length, 0);
});

test('a tenant admin may override inside their OWN tenant', async () => {
  const c = client();
  const saved = await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: tenantAdminA,
  });
  assert.equal(saved.tenant_id, TENANT_A);
  assert.equal(saved.created_by, 'admin-a');
});

test('the persisted row takes its identity from the server arguments, never from caller-supplied fields', async () => {
  const c = client();
  // Everything an attacker would try to smuggle through a request body: a row id to address someone
  // else's override, a different tenant, a different user, a pre-cleared tombstone.
  const saved = await ent.applyAdminOverride(c, {
    tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
    id: 'ov-someone-elses',
    tenant_id: TENANT_B,
    user_id: 'victim',
    feature_key: FEATURE_KEYS.API_ACCESS,
    deleted_at: null,
    created_by: 'not-the-actor',
  });
  assert.equal(saved.tenant_id, TENANT_A);
  assert.equal(saved.user_id, USER);
  assert.equal(saved.feature_key, FEATURE);
  assert.equal(saved.created_by, 'admin-1');
  assert.notEqual(saved.id, 'ov-someone-elses');
  assert.equal(c._rows('diaspora_user_entitlement_overrides').length, 1);
});

test('revoking is scoped to the named triple and cannot reach another tenant\'s override', async () => {
  const c = client({
    diaspora_user_entitlement_overrides: [{
      id: 'ov-b', tenant_id: TENANT_B, user_id: USER, feature_key: FEATURE, value: true, deleted_at: null,
    }],
  });
  await assert.rejects(
    () => ent.revokeAdminOverride(c, {
      tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin,
    }),
    (err) => err.statusCode === 404,
  );
  const b = c._rows('diaspora_user_entitlement_overrides').find((r) => r.id === 'ov-b');
  assert.equal(b.deleted_at, null, "tenant B's override is untouched");
});

// ── Revoke semantics ────────────────────────────────────────────────────────────────────────────

test('revoking twice is an idempotent no-op that does not rewrite when it was revoked', async () => {
  const c = client();
  await ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin });
  const first = await ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin });
  const second = await ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: platformAdmin });

  assert.equal(second.outcome, 'ALREADY_REVOKED');
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.deleted_at, first.deleted_at, 'the withdrawal timestamp is a fact, not a counter');
  assert.equal(auditActions(c).filter((a) => a === 'ENTITLEMENT_OVERRIDE_REVOKED').length, 1);
});

test('revoking an override that never existed is a 404, not a 500', async () => {
  const c = client();
  await assert.rejects(
    () => ent.revokeAdminOverride(c, {
      tenantId: TENANT_A, userId: 'nobody', featureKey: FEATURE, actor: platformAdmin,
    }),
    (err) => err.statusCode === 404,
  );
});

test('a non-admin can neither grant nor revoke', async () => {
  const c = client();
  const rando = { id: 'rando', role: 'member' };
  await assert.rejects(
    () => ent.applyAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: rando }),
    (err) => err.statusCode === 403,
  );
  await assert.rejects(
    () => ent.revokeAdminOverride(c, { tenantId: TENANT_A, userId: USER, featureKey: FEATURE, actor: rando }),
    (err) => err.statusCode === 403,
  );
});

// ── 23505 never becomes a 500 ───────────────────────────────────────────────────────────────────

test('if 23505 ever escapes the RPC it is a retryable 409, never a generic 500', async () => {
  // Defence in depth: the RPC's ON CONFLICT should make this unreachable, but the mapping is what
  // guarantees an operator sees "retry" rather than a message naming a Postgres constraint.
  const colliding = createMockSupabase({
    diaspora_subscriptions: [], diaspora_subscription_plans: [],
    diaspora_user_entitlement_overrides: [], diaspora_import_audit_log: [],
  }, {
    rpc: {
      diaspora_apply_entitlement_override_atomic() {
        const err = new Error('duplicate key value violates unique constraint "uq_diaspora_user_override"');
        err.code = '23505';
        throw err;
      },
    },
  });

  await assert.rejects(
    () => ent.applyAdminOverride(colliding, {
      tenantId: TENANT_A, userId: USER, featureKey: FEATURE, value: true, actor: platformAdmin,
    }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /concurrently|retry/i);
      assert.doesNotMatch(err.message, /uq_diaspora_user_override/,
        'an operator must not be handed a constraint name as the explanation');
      return true;
    },
  );
});

test('an unknown feature key is rejected before any write is attempted', async () => {
  const c = client();
  await assert.rejects(
    () => ent.applyAdminOverride(c, {
      tenantId: TENANT_A, userId: USER, featureKey: 'diaspora.not.a.feature', value: true, actor: platformAdmin,
    }),
    (err) => err.statusCode === 400,
  );
  assert.equal(c._rows('diaspora_user_entitlement_overrides').length, 0);
});
