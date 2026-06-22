process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadStaticManifest,
  getManifestEntry,
  validateOverridePatch,
  evaluateEffectiveState,
  sanitizeEffective,
  getEffectiveStates,
  listFeaturesForAdmin,
  upsertOverride,
  deleteOverride,
  getFeatureAudit,
  invalidateOverrideCache,
  setOverrideCacheTtl,
  resolveRequestContext,
} from '../services/featureGovernance/featureGovernanceService.js';

// ── In-memory fake Supabase client (no live DB) ─────────────────────────────
function makeFakeClient(seed = {}, opts = {}) {
  const tables = { trust_audit_events: [] };
  for (const [k, v] of Object.entries(seed)) tables[k] = [...(v || [])];
  if (!tables.feature_rollout_overrides) tables.feature_rollout_overrides = [];
  let idSeq = 1;
  function from(table) {
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];
    const ctx = { filters: [], op: null, payload: null };
    const match = (r) => ctx.filters.every(([c, v]) => r[c] === v);
    const execute = () => {
      if (opts.failTable === table && opts.failOp === (ctx.op || 'select')) {
        return { data: null, error: { message: 'simulated storage failure' } };
      }
      if (ctx.op === 'insert') {
        const payloads = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
        const inserted = payloads.map((p) => ({ id: `row-${idSeq++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      if (ctx.op === 'update') {
        const matched = rows.filter(match);
        matched.forEach((r) => Object.assign(r, ctx.payload, { updated_at: new Date().toISOString() }));
        return { data: matched, error: null };
      }
      if (ctx.op === 'delete') {
        tables[table] = rows.filter((r) => !match(r));
        return { data: null, error: null };
      }
      let result = rows.filter(match);
      if (ctx.order) result = [...result].sort((a, b) => (a[ctx.order] < b[ctx.order] ? 1 : -1));
      if (ctx.limit != null) result = result.slice(0, ctx.limit);
      return { data: result, error: null };
    };
    const builder = {
      select() { return builder; },
      eq(col, val) { ctx.filters.push([col, val]); return builder; },
      order(col) { ctx.order = col; return builder; },
      limit(n) { ctx.limit = n; return builder; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return builder; },
      update(p) { ctx.op = 'update'; ctx.payload = p; return builder; },
      delete() { ctx.op = 'delete'; return builder; },
      then(resolve) { resolve(execute()); },
    };
    return builder;
  }
  return { from, _tables: tables };
}

const STAGING = { environment: 'staging' };
const ADMIN = { id: 'admin-1', role: 'admin', effectiveRole: 'admin', platformRole: 'admin' };

test('manifest loads and is non-trivial', () => {
  const m = loadStaticManifest();
  assert.ok(Array.isArray(m) && m.length > 50);
  assert.ok(getManifestEntry('product.insurance'));
});

// ── Pure evaluator ──────────────────────────────────────────────────────────
test('static default: public active feature is visible & accessible', () => {
  const entry = getManifestEntry('product.insurance');
  const eff = evaluateEffectiveState(entry, null, { environment: 'staging', role: null });
  assert.equal(eff.state, 'active');
  assert.equal(eff.visible, true);
  assert.equal(eff.accessible, true);
});

test('override can DISABLE a feature (not enabled/visible)', () => {
  const entry = getManifestEntry('product.insurance');
  const eff = evaluateEffectiveState(entry, { environment: 'staging', lifecycle_state: 'disabled', enabled: false }, { environment: 'staging', role: null });
  assert.equal(eff.state, 'disabled');
  assert.equal(eff.enabled, false);
  assert.equal(eff.visible, false);
  assert.equal(eff.accessible, false);
});

test('override beta marks beta and carries a message', () => {
  const entry = getManifestEntry('product.insurance');
  const eff = evaluateEffectiveState(entry, { environment: 'staging', lifecycle_state: 'beta', enabled: true, beta_message: 'pilot' }, { environment: 'staging', role: null });
  assert.equal(eff.beta, true);
  assert.equal(eff.betaMessage, 'pilot');
});

test('override CANNOT broaden roles beyond immutable policy', () => {
  const entry = getManifestEntry('owner.garage'); // immutableRoles ['owner']
  const eff = evaluateEffectiveState(entry, { environment: 'staging', enabled: true, allowed_roles: ['owner', 'dealer', 'admin'] }, { environment: 'staging', role: 'dealer' });
  // dealer was illegally added → intersected out → dealer not eligible
  assert.equal(eff.accessible, false);
});

test('time window: outside [starts,ends] the override does not apply', () => {
  const entry = getManifestEntry('product.insurance');
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const farFuture = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const eff = evaluateEffectiveState(entry, { environment: 'staging', lifecycle_state: 'disabled', enabled: false, starts_at: future, ends_at: farFuture }, { environment: 'staging', role: null });
  // not yet started → static default active
  assert.equal(eff.state, 'active');
});

test('tenant deny list blocks accessibility', () => {
  const entry = getManifestEntry('product.insurance');
  const eff = evaluateEffectiveState(entry, { environment: 'staging', enabled: true, denied_tenant_ids: ['t-bad'] }, { environment: 'staging', role: null, tenantId: 't-bad' });
  assert.equal(eff.accessible, false);
});

test('sanitizeEffective strips internal reason/roles', () => {
  const entry = getManifestEntry('product.insurance');
  const full = evaluateEffectiveState(entry, { environment: 'staging', enabled: true, reason: 'secret note' }, { environment: 'staging', role: null });
  const clean = sanitizeEffective(full);
  assert.equal(clean.reasonCode, undefined);
  assert.equal(clean.allowedRoles, undefined);
  assert.equal(clean.overridden, undefined);
  assert.equal(clean.featureId, 'product.insurance');
});

// ── Validation ──────────────────────────────────────────────────────────────
test('validateOverridePatch rejects unknown feature / invalid env / lifecycle / role expansion', () => {
  assert.equal(validateOverridePatch(undefined, {}, 'staging').ok, false);
  assert.deepEqual(validateOverridePatch(getManifestEntry('product.insurance'), {}, 'nope').errors.includes('invalid_environment'), true);
  assert.equal(validateOverridePatch(getManifestEntry('product.insurance'), { lifecycle_state: 'bogus' }, 'staging').errors.includes('invalid_lifecycle_state'), true);
  const roleErr = validateOverridePatch(getManifestEntry('owner.garage'), { allowed_roles: ['owner', 'admin'] }, 'staging');
  assert.equal(roleErr.errors.includes('role_expansion_beyond_immutable_policy'), true);
});

test('validateOverridePatch rejects invalid tenant arrays and time windows', () => {
  const entry = getManifestEntry('product.insurance');
  assert.equal(validateOverridePatch(entry, { allowed_tenant_ids: 'x' }, 'staging').errors.includes('invalid_allowed_tenant_ids'), true);
  assert.equal(validateOverridePatch(entry, { starts_at: '2026-02-02', ends_at: '2026-01-01' }, 'staging').errors.includes('invalid_time_window'), true);
});

// ── CRUD with fake client ───────────────────────────────────────────────────
test('upsertOverride creates (v1), updates (v2), emits audit, and enforces version conflict', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient();
  const create = await upsertOverride('product.insurance', { environment: 'staging', lifecycle_state: 'beta', enabled: true, reason: 'pilot' }, ADMIN, { client });
  assert.equal(create.ok, true);
  assert.equal(create.override.version, 1);
  // audit row written
  const audit = client._tables.trust_audit_events.filter((e) => e.event_type === 'FEATURE_ROLLOUT_CREATED');
  assert.equal(audit.length, 1);

  const update = await upsertOverride('product.insurance', { environment: 'staging', lifecycle_state: 'active', enabled: true }, ADMIN, { client, expectedVersion: 1 });
  assert.equal(update.ok, true);
  assert.equal(update.override.version, 2);

  // stale expectedVersion → 409
  const conflict = await upsertOverride('product.insurance', { environment: 'staging', enabled: false }, ADMIN, { client, expectedVersion: 1 });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.errors, ['version_conflict']);
});

test('upsertOverride returns 400 on validation failure (no write)', async () => {
  const client = makeFakeClient();
  const res = await upsertOverride('owner.garage', { environment: 'staging', allowed_roles: ['owner', 'admin'] }, ADMIN, { client });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(client._tables.feature_rollout_overrides.length, 0);
});

test('deleteOverride resets to default and audits', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [{ id: 'x1', feature_id: 'product.insurance', environment: 'staging', lifecycle_state: 'disabled', enabled: false, version: 3 }] });
  const res = await deleteOverride('product.insurance', 'staging', ADMIN, { client });
  assert.equal(res.ok, true);
  assert.equal(res.reset, true);
  assert.equal(client._tables.feature_rollout_overrides.length, 0);
  assert.equal(client._tables.trust_audit_events.filter((e) => e.event_type === 'FEATURE_ROLLOUT_RESET').length, 1);
});

test('getEffectiveStates applies an override and sanitizes', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [{ id: 'd1', feature_id: 'product.insurance', environment: 'staging', lifecycle_state: 'disabled', enabled: false, version: 1 }] });
  const states = await getEffectiveStates(STAGING, { client });
  const ins = states.find((s) => s.featureId === 'product.insurance');
  assert.equal(ins.state, 'disabled');
  assert.equal(ins.visible, false);
  assert.equal(ins.reasonCode, undefined); // sanitized
});

test('storage failure on a COLD cache falls back to static defaults (statically-disabled stays disabled)', async () => {
  invalidateOverrideCache();
  // No prior successful read (cold). Read fails → static defaults; nothing to preserve.
  const client = makeFakeClient({}, { failTable: 'feature_rollout_overrides', failOp: 'select' });
  const states = await getEffectiveStates(STAGING, { client });
  const ins = states.find((s) => s.featureId === 'product.insurance'); // static default 'active'
  assert.equal(ins.state, 'active');
  assert.ok(states.every((s) => typeof s.enabled === 'boolean'));
})

test('FAIL-SAFE: a runtime DISABLE (kill-switch) survives a transient read outage, never re-enabled', async () => {
  invalidateOverrideCache();
  setOverrideCacheTtl(0); // force every read to consult the DB (no fresh-cache short-circuit)
  try {
    // 1) Warm the cache with a successful read of a runtime-disable override.
    const good = makeFakeClient({ feature_rollout_overrides: [
      { id: 'kill1', feature_id: 'product.insurance', environment: 'staging', lifecycle_state: 'disabled', enabled: false, version: 1 },
    ] });
    const warm = await getEffectiveStates(STAGING, { client: good });
    assert.equal(warm.find((s) => s.featureId === 'product.insurance').state, 'disabled');

    // 2) Now the DB read FAILS. The kill-switch must persist (fail safe, not open).
    const failing = makeFakeClient({}, { failTable: 'feature_rollout_overrides', failOp: 'select' });
    const states = await getEffectiveStates(STAGING, { client: failing });
    const ins = states.find((s) => s.featureId === 'product.insurance');
    assert.equal(ins.state, 'disabled');
    assert.equal(ins.enabled, false);
    assert.equal(ins.visible, false);
  } finally {
    setOverrideCacheTtl();
    invalidateOverrideCache();
  }
});

test('listFeaturesForAdmin returns static + override + effective', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient();
  const list = await listFeaturesForAdmin(STAGING, { client });
  const ins = list.find((f) => f.id === 'product.insurance');
  assert.ok(ins.defaultLifecycle);
  assert.equal(ins.override, null);
  assert.ok(ins.effective);
});

test('getFeatureAudit returns only FEATURE_ROLLOUT_* events', async () => {
  const client = makeFakeClient();
  client._tables.trust_audit_events.push(
    { event_type: 'FEATURE_ROLLOUT_UPDATED', trust_fact: 'product.insurance', created_at: '2026-06-21T00:00:00Z' },
    { event_type: 'SOMETHING_ELSE', trust_fact: 'product.insurance', created_at: '2026-06-21T00:00:00Z' },
  );
  const audit = await getFeatureAudit('product.insurance', { client });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event_type, 'FEATURE_ROLLOUT_UPDATED');
});

// ── P2: context-aware effective state (server-derived role + tenant) ─────────
const futureIso = () => new Date(Date.now() + 3600_000).toISOString();
const pastIso = () => new Date(Date.now() - 3600_000).toISOString();

// Mirror the switch-role contract: a session row carries server-issued
// active_role / active_organization_id; resolveRequestContext re-verifies them.
function sessionClient({ activeRole = null, activeOrg = null, baseRole = 'owner', valid = true, expires = futureIso(), membership = null } = {}) {
  return makeFakeClient({
    user_sessions: [{ token: 'tok', user_id: 'u1', active_role: activeRole, active_organization_id: activeOrg, is_valid: valid, expires_at: expires }],
    users: [{ id: 'u1', role: baseRole }],
    tenant_users: membership ? [{ tenant_id: membership.org, user_id: 'u1', role: membership.role }] : [],
  });
}
const ctxFor = (client, headers = {}) => resolveRequestContext({ headers: { 'x-session-token': 'tok', ...headers } }, { client });
const findGarage = (states) => states.find((s) => s.featureId === 'owner.garage');

test('resolveRequestContext: anonymous request → null role/tenant', async () => {
  assert.deepEqual(await resolveRequestContext({ headers: {} }, { client: makeFakeClient() }), { role: null, tenantId: null });
});

test('resolveRequestContext: ordinary base-role session (no active_role) → base role, no tenant', async () => {
  assert.deepEqual(await ctxFor(sessionClient({ activeRole: null, baseRole: 'owner' })), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: active_role equal to base role → base role', async () => {
  assert.deepEqual(await ctxFor(sessionClient({ activeRole: 'owner', baseRole: 'owner' })), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: valid switched-role session with verified membership → active role + tenant', async () => {
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', baseRole: 'owner', membership: { org: 'orgX', role: 'dealer' } });
  assert.deepEqual(await ctxFor(client), { role: 'dealer', tenantId: 'orgX' });
});

test('resolveRequestContext: switched role with MISSING membership → least privilege (base role)', async () => {
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', baseRole: 'owner', membership: null });
  assert.deepEqual(await ctxFor(client), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: switched role with MISMATCHED tenant role → least privilege', async () => {
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', baseRole: 'owner', membership: { org: 'orgX', role: 'mechanic' } });
  assert.deepEqual(await ctxFor(client), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: STALE switched context (active_role but no active_organization_id) → least privilege', async () => {
  assert.deepEqual(await ctxFor(sessionClient({ activeRole: 'dealer', activeOrg: null, baseRole: 'owner' })), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: switching INTO admin via a tenant role is refused → least privilege', async () => {
  const client = sessionClient({ activeRole: 'admin', activeOrg: 'orgX', baseRole: 'owner', membership: { org: 'orgX', role: 'admin' } });
  assert.deepEqual(await ctxFor(client), { role: 'owner', tenantId: null });
});

test('resolveRequestContext: a spoofed x-stakeholder-role header does NOT change the result', async () => {
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', baseRole: 'owner', membership: { org: 'orgX', role: 'dealer' } });
  assert.deepEqual(await ctxFor(client, { 'x-stakeholder-role': 'admin', 'x-tenant-id': 'evil' }), { role: 'dealer', tenantId: 'orgX' });
});

test('resolveRequestContext: expired session → anonymous (fail closed)', async () => {
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', valid: true, expires: pastIso(), membership: { org: 'orgX', role: 'dealer' } });
  assert.deepEqual(await ctxFor(client), { role: null, tenantId: null });
});

test('resolveRequestContext: effective navigation reflects the ACTIVE role after switching', async () => {
  invalidateOverrideCache();
  const client = sessionClient({ activeRole: 'dealer', activeOrg: 'orgX', baseRole: 'owner', membership: { org: 'orgX', role: 'dealer' } });
  const ctx = await ctxFor(client); // { role: 'dealer', tenantId: 'orgX' }
  const states = await getEffectiveStates({ environment: 'staging', role: ctx.role, tenantId: ctx.tenantId }, { client, sanitize: false });
  assert.equal(states.find((s) => s.featureId === 'dealer.inventory').visible, true); // dealer feature visible while acting as dealer
  assert.equal(findGarage(states).visible, false); // owner-only feature hidden
});

test('effective: allowed role gets owner.garage visible+accessible; another role does not (anonymous too)', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient();
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner' }, { client, sanitize: false })).accessible, true);
  invalidateOverrideCache();
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: 'dealer' }, { client, sanitize: false })).accessible, false);
  invalidateOverrideCache();
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: null }, { client, sanitize: false })).accessible, false); // anonymous
});

test('effective: an override removing the role yields visible=false and accessible=false', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [
    { id: 'o-rm', feature_id: 'owner.garage', environment: 'staging', enabled: true, allowed_roles: [], version: 1 },
  ] });
  const g = findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner' }, { client, sanitize: false }));
  assert.equal(g.visible, false);
  assert.equal(g.accessible, false);
});

test('effective: tenant allowlist grants the allowed tenant and excludes a different tenant', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [
    { id: 'o-ten', feature_id: 'owner.garage', environment: 'staging', enabled: true, allowed_tenant_ids: ['tenantA'], version: 1 },
  ] });
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner', tenantId: 'tenantA' }, { client, sanitize: false })).accessible, true);
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner', tenantId: 'tenantB' }, { client, sanitize: false })).accessible, false);
});

test('effective: tenant denylist denies the denied tenant', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [
    { id: 'o-deny', feature_id: 'owner.garage', environment: 'staging', enabled: true, denied_tenant_ids: ['tenantBad'], version: 1 },
  ] });
  assert.equal(findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner', tenantId: 'tenantBad' }, { client, sanitize: false })).accessible, false);
});

test('effective: sanitized payload still carries visible/accessible but no role/tenant lists or reason', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [
    { id: 'o-s', feature_id: 'owner.garage', environment: 'staging', enabled: true, allowed_tenant_ids: ['tenantA'], reason: 'secret', version: 1 },
  ] });
  const g = findGarage(await getEffectiveStates({ environment: 'staging', role: 'owner', tenantId: 'tenantA' }, { client, sanitize: true }));
  assert.equal(typeof g.visible, 'boolean');
  assert.equal(typeof g.accessible, 'boolean');
  assert.equal(g.reasonCode, undefined);
  assert.equal(g.allowedRoles, undefined);
  assert.equal(g.allowed_tenant_ids, undefined);
});
