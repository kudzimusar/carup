process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getManifestEntry,
  validateOverridePatch,
  evaluateEffectiveState,
  sanitizeEffective,
  getEffectiveStates,
  upsertOverride,
  deleteOverride,
  invalidateOverrideCache,
  setOverrideCacheTtl,
  rolloutBucket,
  passesPercentage,
  resolveSubject,
} from '../services/featureGovernance/featureGovernanceService.js';

// ── In-memory fake Supabase client (mirrors feature-governance.test.js) ──────
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

const ADMIN = { id: 'admin-1', role: 'admin', effectiveRole: 'admin', platformRole: 'admin' };
// product.insurance is PUBLIC (requiresAuth=false) → role/tenant never gate it,
// so the percentage gate is isolated. owner.garage is owner-only for the
// role/tenant precedence tests.
const PUBLIC_FEATURE = 'product.insurance';

function overrideRow(extra = {}) {
  return {
    id: 'o1', feature_id: PUBLIC_FEATURE, environment: 'staging',
    lifecycle_state: null, enabled: true,
    allowed_roles: null, allowed_tenant_ids: [], denied_tenant_ids: [],
    rollout_percentage: 100, rollout_seed: null, version: 1, ...extra,
  };
}

// ── Pure bucket determinism ─────────────────────────────────────────────────
test('rolloutBucket: deterministic 0–99 and stable across calls', () => {
  for (const subject of ['u1', 'u2', 'cohort:abc', 'u9:orgX']) {
    const b1 = rolloutBucket(PUBLIC_FEATURE, 'staging', null, subject);
    const b2 = rolloutBucket(PUBLIC_FEATURE, 'staging', null, subject);
    assert.equal(b1, b2);
    assert.ok(Number.isInteger(b1) && b1 >= 0 && b1 <= 99);
  }
});

test('rolloutBucket: same subject differs by feature / environment / seed', () => {
  const base = rolloutBucket(PUBLIC_FEATURE, 'staging', null, 'u1');
  // At least one of these axes should move the bucket for this subject.
  const byFeature = rolloutBucket('owner.garage', 'staging', null, 'u1');
  const byEnv = rolloutBucket(PUBLIC_FEATURE, 'production', null, 'u1');
  const bySeed = rolloutBucket(PUBLIC_FEATURE, 'staging', 'rotate-1', 'u1');
  assert.ok(byFeature !== base || byEnv !== base || bySeed !== base);
});

// ── resolveSubject priority ─────────────────────────────────────────────────
test('resolveSubject priority: user > user:tenant > cohort > null', () => {
  assert.equal(resolveSubject({ userId: 'u1' }), 'u1');
  assert.equal(resolveSubject({ userId: 'u1', tenantId: 'orgX' }), 'u1:orgX');
  assert.equal(resolveSubject({ cohortId: 'abc' }), 'cohort:abc');
  assert.equal(resolveSubject({ role: 'owner' }), null); // role alone is not a subject
  assert.equal(resolveSubject({}), null);
});

// ── 0% / 100% boundaries ────────────────────────────────────────────────────
test('0% → bucketed out (visible/accessible false) for a real subject', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  const eff = evaluateEffectiveState(entry, overrideRow({ rollout_percentage: 0 }), { environment: 'staging', role: null, userId: 'u1' });
  assert.equal(eff.state, 'active'); // lifecycle stays truthful
  assert.equal(eff.enabled, true);   // enabled stays truthful
  assert.equal(eff.visible, false);  // only exposure flips off
  assert.equal(eff.accessible, false);
  assert.equal(eff.inRollout, false);
});

test('100% → always in for any subject (and the absent-percentage default is 100)', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  for (const subject of [{ userId: 'u1' }, { cohortId: 'c1' }, {}]) {
    const eff = evaluateEffectiveState(entry, overrideRow({ rollout_percentage: 100 }), { environment: 'staging', role: null, ...subject });
    assert.equal(eff.visible, true);
    assert.equal(eff.accessible, true);
    assert.equal(eff.inRollout, true);
  }
  // No rollout_percentage column at all (legacy row) → treated as 100.
  const legacy = evaluateEffectiveState(entry, overrideRow({ rollout_percentage: undefined }), { environment: 'staging', role: null, userId: 'u1' });
  assert.equal(legacy.visible, true);
});

// ── Stability across repeated evaluations & fresh "instances" ───────────────
test('same subject is STABLE across repeated evaluations', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  const o = overrideRow({ rollout_percentage: 50 });
  const first = evaluateEffectiveState(entry, o, { environment: 'staging', role: null, userId: 'stable-user' }).inRollout;
  for (let i = 0; i < 25; i++) {
    assert.equal(evaluateEffectiveState(entry, o, { environment: 'staging', role: null, userId: 'stable-user' }).inRollout, first);
  }
});

test('same subject is STABLE across two fresh service module instances (re-import + cache clear)', async () => {
  invalidateOverrideCache();
  const a = await import('../services/featureGovernance/featureGovernanceService.js');
  const b1 = a.rolloutBucket(PUBLIC_FEATURE, 'staging', 'seedX', 'cohort:zzz');
  // Re-import (cache-busted) to simulate a separate process/instance.
  const b = await import(`../services/featureGovernance/featureGovernanceService.js?fresh=${Date.now()}`);
  const b2 = b.rolloutBucket(PUBLIC_FEATURE, 'staging', 'seedX', 'cohort:zzz');
  assert.equal(b1, b2); // pure hash → identical across instances
});

// ── Seed rotation reshuffles ────────────────────────────────────────────────
test('seed change RESHUFFLES the cohort (distribution differs)', () => {
  const subjects = Array.from({ length: 500 }, (_, i) => `subj-${i}`);
  const inA = new Set(subjects.filter((s) => rolloutBucket(PUBLIC_FEATURE, 'staging', 'seed-A', s) < 50));
  const inB = new Set(subjects.filter((s) => rolloutBucket(PUBLIC_FEATURE, 'staging', 'seed-B', s) < 50));
  // Many subjects should change membership between seeds (reshuffle).
  const moved = subjects.filter((s) => inA.has(s) !== inB.has(s)).length;
  assert.ok(moved > 50, `expected a meaningful reshuffle, only ${moved} moved`);
});

// ── Role/tenant denial WINS before percentage ───────────────────────────────
test('role denial wins BEFORE percentage: wrong-role user is out even at 100%', () => {
  const entry = getManifestEntry('owner.garage'); // owner-only
  // 100% rollout but caller is a dealer → role gate denies regardless of %.
  const eff = evaluateEffectiveState(entry, { ...overrideRow({ feature_id: 'owner.garage', rollout_percentage: 100 }) }, { environment: 'staging', role: 'dealer', userId: 'd1' });
  assert.equal(eff.accessible, false);
  assert.equal(eff.visible, false);
});

test('tenant denial wins BEFORE percentage: denied tenant is out even at 100%', () => {
  const entry = getManifestEntry('owner.garage');
  const o = overrideRow({ feature_id: 'owner.garage', rollout_percentage: 100, denied_tenant_ids: ['t-bad'] });
  const eff = evaluateEffectiveState(entry, o, { environment: 'staging', role: 'owner', userId: 'o1', tenantId: 't-bad' });
  assert.equal(eff.accessible, false);
});

test('percentage NEVER broadens: 0% does not grant an ineligible role', () => {
  const entry = getManifestEntry('owner.garage');
  // dealer is ineligible; percentage is irrelevant — still denied.
  const eff = evaluateEffectiveState(entry, overrideRow({ feature_id: 'owner.garage', rollout_percentage: 0 }), { environment: 'staging', role: 'dealer', userId: 'd1' });
  assert.equal(eff.accessible, false);
});

// ── Anonymous-no-cohort conservative behavior ───────────────────────────────
test('anonymous with NO cohort + <100% → OUT (conservative)', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  const eff = evaluateEffectiveState(entry, overrideRow({ rollout_percentage: 50 }), { environment: 'staging', role: null });
  assert.equal(eff.inRollout, false);
  assert.equal(eff.visible, false);
  assert.equal(eff.accessible, false);
  // passesPercentage agrees directly.
  assert.equal(passesPercentage(overrideRow({ rollout_percentage: 50 }), { environment: 'staging' }), false);
  // But at 100% even an anonymous-no-cohort subject is in.
  assert.equal(evaluateEffectiveState(entry, overrideRow({ rollout_percentage: 100 }), { environment: 'staging', role: null }).inRollout, true);
});

test('cohort-provided anonymous subject is STABLE (in or out, but consistent)', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  const o = overrideRow({ rollout_percentage: 50 });
  const a = evaluateEffectiveState(entry, o, { environment: 'staging', role: null, cohortId: 'anon-cohort-1' }).inRollout;
  for (let i = 0; i < 10; i++) {
    assert.equal(evaluateEffectiveState(entry, o, { environment: 'staging', role: null, cohortId: 'anon-cohort-1' }).inRollout, a);
  }
});

// ── Validation ──────────────────────────────────────────────────────────────
test('validateOverridePatch rejects invalid percentage (<0, >100, NaN, non-int)', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  for (const bad of [-1, 101, Number.NaN, 50.5, '50']) {
    const r = validateOverridePatch(entry, { rollout_percentage: bad }, 'staging');
    assert.equal(r.ok, false, `expected ${String(bad)} to be rejected`);
    assert.ok(r.errors.includes('invalid_rollout_percentage'));
  }
  // Valid ints pass.
  assert.equal(validateOverridePatch(entry, { rollout_percentage: 0 }, 'staging').ok, true);
  assert.equal(validateOverridePatch(entry, { rollout_percentage: 100 }, 'staging').ok, true);
});

test('validateOverridePatch rejects an over-long seed', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  assert.equal(validateOverridePatch(entry, { rollout_seed: 'x'.repeat(65) }, 'staging').errors.includes('invalid_rollout_seed'), true);
  assert.equal(validateOverridePatch(entry, { rollout_seed: 'x'.repeat(64) }, 'staging').ok, true);
  assert.equal(validateOverridePatch(entry, { rollout_seed: null }, 'staging').ok, true);
});

// ── API: persistence, version conflict, audit, reset ────────────────────────
test('upsertOverride persists percentage+seed, audits the change with NO raw subject', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient();
  const res = await upsertOverride(PUBLIC_FEATURE, { environment: 'staging', rollout_percentage: 25, rollout_seed: 'wave-1', reason: 'gradual' }, ADMIN, { client });
  assert.equal(res.ok, true);
  assert.equal(res.override.rollout_percentage, 25);
  assert.equal(res.override.rollout_seed, 'wave-1');

  const audit = client._tables.trust_audit_events.filter((e) => String(e.event_type).startsWith('FEATURE_ROLLOUT_'));
  assert.equal(audit.length, 1);
  // before/after carry the config knob...
  assert.equal(audit[0].new_value.rollout_percentage, 25);
  assert.equal(audit[0].new_value.rollout_seed, 'wave-1');
  // ...and NO raw subject / bucket / cohort leaks into the audit row.
  const serialized = JSON.stringify(audit[0]);
  assert.ok(!/subject|cohort|bucket/i.test(serialized), 'audit must not contain subject/cohort/bucket');
});

test('upsertOverride with invalid percentage → 400, no write', async () => {
  const client = makeFakeClient();
  const res = await upsertOverride(PUBLIC_FEATURE, { environment: 'staging', rollout_percentage: 150 }, ADMIN, { client });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.ok(res.errors.includes('invalid_rollout_percentage'));
  assert.equal(client._tables.feature_rollout_overrides.length, 0);
});

test('version conflict on a percentage change still returns 409', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient();
  const create = await upsertOverride(PUBLIC_FEATURE, { environment: 'staging', rollout_percentage: 50 }, ADMIN, { client });
  assert.equal(create.override.version, 1);
  const stale = await upsertOverride(PUBLIC_FEATURE, { environment: 'staging', rollout_percentage: 75 }, ADMIN, { client, expectedVersion: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.errors, ['version_conflict']);
});

test('reset (delete) → back to static default (100% effectively, no override)', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [overrideRow({ rollout_percentage: 10, version: 4 })] });
  const res = await deleteOverride(PUBLIC_FEATURE, 'staging', ADMIN, { client });
  assert.equal(res.ok, true);
  assert.equal(res.reset, true);
  assert.equal(client._tables.feature_rollout_overrides.length, 0);
  // With no override row, the feature evaluates at the static default → full exposure.
  invalidateOverrideCache();
  const states = await getEffectiveStates({ environment: 'staging', role: null }, { client });
  const ins = states.find((s) => s.featureId === PUBLIC_FEATURE);
  assert.equal(ins.visible, true);
  assert.equal(ins.accessible, true);
});

// ── Sanitized payload stays subject-free ────────────────────────────────────
test('sanitizeEffective never leaks rolloutPercentage / inRollout / subject', () => {
  const entry = getManifestEntry(PUBLIC_FEATURE);
  const full = evaluateEffectiveState(entry, overrideRow({ rollout_percentage: 50 }), { environment: 'staging', role: null, userId: 'u1' });
  const clean = sanitizeEffective(full);
  assert.equal(clean.rolloutPercentage, undefined);
  assert.equal(clean.inRollout, undefined);
  assert.equal('visible' in clean, true); // exposure still reflected
});

// ── End-to-end through getEffectiveStates with a subject in ctx ─────────────
test('getEffectiveStates honours the percentage gate for a user subject', async () => {
  invalidateOverrideCache();
  const client = makeFakeClient({ feature_rollout_overrides: [overrideRow({ rollout_percentage: 0 })] });
  const states = await getEffectiveStates({ environment: 'staging', role: null, userId: 'u-zero' }, { client, sanitize: true });
  const ins = states.find((s) => s.featureId === PUBLIC_FEATURE);
  assert.equal(ins.visible, false); // 0% → gated out
  assert.equal(ins.accessible, false);
  assert.equal(ins.state, 'active'); // lifecycle still truthful
});

// ── NON-FLAKY distribution check (deterministic synthetic subjects) ─────────
test('distribution: observed in-rollout fraction within ±5% of target (deterministic)', () => {
  const N = 2000;
  const subjects = Array.from({ length: N }, (_, i) => `dist-subject-${i}`);
  const results = {};
  for (const pct of [10, 25, 50, 75]) {
    const inCount = subjects.filter((s) => rolloutBucket(PUBLIC_FEATURE, 'staging', null, s) < pct).length;
    const fraction = inCount / N;
    results[pct] = Number((fraction * 100).toFixed(2));
    const target = pct / 100;
    assert.ok(
      Math.abs(fraction - target) <= 0.05,
      `pct=${pct}: observed ${(fraction * 100).toFixed(2)}% not within ±5% of ${pct}%`,
    );
  }
  // Surface the numbers for the report (deterministic, so reproducible).
  console.log('DISTRIBUTION_CHECK', JSON.stringify(results));
});

// keep TTL pristine for any other suite run after this one
setOverrideCacheTtl();
invalidateOverrideCache();
