/**
 * Feature Governance Service (Milestone 6).
 *
 * Overlays backend-persisted runtime rollout overrides on the framework-neutral
 * static manifest and computes the EFFECTIVE state of each feature. Pure
 * evaluation/validation is separated from DB access so it is unit-testable
 * without a live database, and so a storage failure can fall back safely to
 * static defaults (a disabled feature never becomes enabled because a read
 * failed). The Feature Registry governs frontend discovery only — this service
 * never replaces Express authorization, RLS, or service ownership checks.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../shared/navigation/feature-manifest.json');
const TABLE = 'feature_rollout_overrides';
const VALID_ENVIRONMENTS = ['development', 'staging', 'production'];
const VALID_LIFECYCLE = ['active', 'beta', 'planned', 'hidden', 'disabled', 'deprecated'];
const CACHE_TTL_MS = 30_000;

// ── Static manifest ─────────────────────────────────────────────────────────
let _manifestCache = null;
export function loadStaticManifest() {
  if (_manifestCache) return _manifestCache;
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  _manifestCache = JSON.parse(raw);
  return _manifestCache;
}
export function getManifestEntry(featureId) {
  return loadStaticManifest().find((e) => e.id === featureId);
}

// ── Lifecycle helpers (mirror of the frontend, intentionally duplicated so the
//    backend has no web dependency) ─────────────────────────────────────────
function isLifecycleVisible(state) {
  return state === 'active' || state === 'beta';
}
function isLifecycleAccessible(state) {
  return state === 'active' || state === 'beta' || state === 'hidden' || state === 'deprecated';
}

// ── Pure validation ─────────────────────────────────────────────────────────
/**
 * Validate an override patch against the immutable static policy. Returns
 * { ok, errors }. An override may NEVER grant roles beyond `immutableRoles`.
 */
export function validateOverridePatch(entry, patch, environment) {
  const errors = [];
  if (!entry) errors.push('unknown_feature');
  if (!VALID_ENVIRONMENTS.includes(environment)) errors.push('invalid_environment');

  if (patch.lifecycle_state != null && !VALID_LIFECYCLE.includes(patch.lifecycle_state)) {
    errors.push('invalid_lifecycle_state');
  }
  if (patch.allowed_roles != null) {
    if (!Array.isArray(patch.allowed_roles)) {
      errors.push('invalid_allowed_roles');
    } else if (entry) {
      const immutable = new Set(entry.immutableRoles || []);
      const broadened = patch.allowed_roles.filter((r) => !immutable.has(r));
      if (broadened.length > 0) errors.push('role_expansion_beyond_immutable_policy');
    }
  }
  for (const key of ['allowed_tenant_ids', 'denied_tenant_ids']) {
    if (patch[key] != null && (!Array.isArray(patch[key]) || patch[key].some((t) => typeof t !== 'string'))) {
      errors.push(`invalid_${key}`);
    }
  }
  if (patch.enabled != null && typeof patch.enabled !== 'boolean') errors.push('invalid_enabled');
  if (patch.starts_at && Number.isNaN(Date.parse(patch.starts_at))) errors.push('invalid_starts_at');
  if (patch.ends_at && Number.isNaN(Date.parse(patch.ends_at))) errors.push('invalid_ends_at');
  if (patch.starts_at && patch.ends_at && Date.parse(patch.ends_at) < Date.parse(patch.starts_at)) {
    errors.push('invalid_time_window');
  }
  return { ok: errors.length === 0, errors };
}

// ── Pure effective-state evaluator ──────────────────────────────────────────
function overrideApplies(override, ctx) {
  if (!override) return false;
  if (override.environment !== ctx.environment) return false;
  const now = ctx.now ?? Date.now();
  if (override.starts_at && Date.parse(override.starts_at) > now) return false;
  if (override.ends_at && Date.parse(override.ends_at) < now) return false;
  return true;
}

function tenantAllowed(override, tenantId) {
  if (!override) return true;
  if (tenantId && Array.isArray(override.denied_tenant_ids) && override.denied_tenant_ids.includes(tenantId)) return false;
  if (Array.isArray(override.allowed_tenant_ids) && override.allowed_tenant_ids.length > 0) {
    return tenantId ? override.allowed_tenant_ids.includes(tenantId) : false;
  }
  return true;
}

/**
 * Compute the effective state of a feature. Returns the FULL (admin) shape;
 * use {@link sanitizeEffective} before returning to non-admin callers.
 */
export function evaluateEffectiveState(entry, override, ctx = {}) {
  const defaultLifecycle = entry.defaultLifecycle;
  let state = defaultLifecycle;
  let enabled = defaultLifecycle !== 'disabled';
  let allowedRoles = entry.defaultRoles || [];
  let betaMessage;
  let reasonCode;
  const deprecatedTo = entry.deprecatedTo;

  const applies = overrideApplies(override, ctx);
  if (applies) {
    if (override.lifecycle_state) state = override.lifecycle_state;
    enabled = override.enabled !== false;
    if (Array.isArray(override.allowed_roles)) {
      const immutable = new Set(entry.immutableRoles || []);
      // Intersect with immutable bounds — an override can NEVER broaden access.
      allowedRoles = override.allowed_roles.filter((r) => immutable.has(r));
    }
    if (override.beta_message) betaMessage = override.beta_message;
    if (override.reason) reasonCode = override.reason;
  }

  const requiresAuth = entry.requiresAuth;
  const roleEligible = !requiresAuth ? true : (ctx.role ? allowedRoles.includes(ctx.role) : false);
  const tenantOk = applies ? tenantAllowed(override, ctx.tenantId) : true;

  const visible = isLifecycleVisible(state) && roleEligible && enabled && tenantOk;
  const accessible = isLifecycleAccessible(state) && roleEligible && enabled && tenantOk;

  return {
    featureId: entry.id,
    state,
    enabled,
    visible,
    accessible,
    beta: state === 'beta',
    deprecatedTo,
    betaMessage,
    // internal-only fields (stripped by sanitizeEffective):
    reasonCode,
    overridden: applies,
    allowedRoles,
  };
}

/** Strip internal governance data for non-admin consumers. */
export function sanitizeEffective(state) {
  return {
    featureId: state.featureId,
    state: state.state,
    enabled: state.enabled,
    visible: state.visible,
    accessible: state.accessible,
    beta: state.beta,
    deprecatedTo: state.deprecatedTo,
    betaMessage: state.betaMessage,
  };
}

// ── Override cache (short, bounded; invalidated on mutation) ─────────────────
const _overrideCache = new Map(); // environment -> { at, rows }
let _cacheTtlMs = CACHE_TTL_MS;
export function invalidateOverrideCache(environment) {
  if (environment) _overrideCache.delete(environment);
  else _overrideCache.clear();
}
/** Adjust the override cache TTL (ms). Primarily for tests / tuning. */
export function setOverrideCacheTtl(ms) {
  _cacheTtlMs = typeof ms === 'number' && ms >= 0 ? ms : CACHE_TTL_MS;
}

async function readOverrides(client, environment) {
  const cached = _overrideCache.get(environment);
  if (cached && Date.now() - cached.at < _cacheTtlMs) return cached.rows;
  const { data, error } = await client.from(TABLE).select('*').eq('environment', environment);
  if (error) {
    const correlationId = `featgov-${environment}-read`;
    // Fail SAFE, not fail OPEN. If we have last-good overrides, serve them
    // (stale-while-error) so a runtime DISABLE / kill-switch survives a transient
    // read outage and a disabled feature is NEVER silently re-enabled. Only with
    // no cached state at all (cold start) do we fall back to static defaults —
    // there is nothing to preserve, and statically-disabled features stay disabled.
    if (cached) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'feature override read failed; serving last-good cache (fail-safe)', correlationId, error: error.message }));
      return cached.rows;
    }
    console.warn(JSON.stringify({ level: 'warn', msg: 'feature override read failed; no cache, using static defaults', correlationId, error: error.message }));
    return [];
  }
  _overrideCache.set(environment, { at: Date.now(), rows: data || [] });
  return data || [];
}

// ── DB-backed operations (client injectable for tests) ──────────────────────

/** Effective states for every feature, for a context. Non-admin → sanitized. */
export async function getEffectiveStates(ctx, { client = defaultClient, sanitize = true } = {}) {
  const manifest = loadStaticManifest();
  const overrides = await readOverrides(client, ctx.environment);
  const byId = new Map(overrides.map((o) => [o.feature_id, o]));
  return manifest.map((entry) => {
    const full = evaluateEffectiveState(entry, byId.get(entry.id), ctx);
    return sanitize ? sanitizeEffective(full) : full;
  });
}

/** Admin: every feature with its static metadata + current override + effective state. */
export async function listFeaturesForAdmin(ctx, { client = defaultClient } = {}) {
  const manifest = loadStaticManifest();
  const overrides = await readOverrides(client, ctx.environment);
  const byId = new Map(overrides.map((o) => [o.feature_id, o]));
  return manifest.map((entry) => {
    const override = byId.get(entry.id) || null;
    return {
      ...entry,
      override,
      effective: evaluateEffectiveState(entry, override, ctx),
    };
  });
}

export async function getFeatureDetail(featureId, ctx, { client = defaultClient } = {}) {
  const entry = getManifestEntry(featureId);
  if (!entry) return null;
  const { data } = await client.from(TABLE).select('*').eq('feature_id', featureId).eq('environment', ctx.environment);
  const override = (data || [])[0] || null;
  return { ...entry, override, effective: evaluateEffectiveState(entry, override, ctx) };
}

/**
 * Create or update a rollout override with optimistic concurrency. `actor` is
 * the server-derived admin context (never client-supplied). Emits an audit
 * event. Returns { ok, status, override?, errors? }.
 */
export async function upsertOverride(featureId, patch, actor, { client = defaultClient, req, expectedVersion } = {}) {
  const entry = getManifestEntry(featureId);
  const environment = patch.environment;
  const validation = validateOverridePatch(entry, patch, environment);
  if (!validation.ok) return { ok: false, status: 400, errors: validation.errors };

  // Load existing for version check + previous-state audit.
  const { data: existingRows } = await client.from(TABLE).select('*').eq('feature_id', featureId).eq('environment', environment);
  const existing = (existingRows || [])[0] || null;

  if (existing && expectedVersion != null && existing.version !== expectedVersion) {
    return { ok: false, status: 409, errors: ['version_conflict'], current: existing };
  }

  const row = {
    feature_id: featureId,
    environment,
    lifecycle_state: patch.lifecycle_state ?? null,
    enabled: patch.enabled ?? true,
    allowed_roles: patch.allowed_roles ?? null,
    allowed_tenant_ids: patch.allowed_tenant_ids ?? [],
    denied_tenant_ids: patch.denied_tenant_ids ?? [],
    starts_at: patch.starts_at ?? null,
    ends_at: patch.ends_at ?? null,
    beta_message: patch.beta_message ?? null,
    reason: patch.reason ?? null,
    updated_by: actor?.id ?? actor?.userId ?? null,
    version: existing ? existing.version + 1 : 1,
  };
  if (!existing) row.created_by = actor?.id ?? actor?.userId ?? null;

  let saved;
  if (existing) {
    const { data, error } = await client.from(TABLE).update(row).eq('id', existing.id).eq('version', existing.version).select();
    if (error) return { ok: false, status: 500, errors: ['storage_error'] };
    if (!data || data.length === 0) return { ok: false, status: 409, errors: ['version_conflict'], current: existing };
    saved = data[0];
  } else {
    const { data, error } = await client.from(TABLE).insert(row).select();
    if (error) return { ok: false, status: 500, errors: ['storage_error'] };
    saved = (data || [])[0];
  }

  invalidateOverrideCache(environment);
  await emitAudit(client, {
    req,
    actor,
    event_type: existing ? 'FEATURE_ROLLOUT_UPDATED' : 'FEATURE_ROLLOUT_CREATED',
    feature_id: featureId,
    environment,
    previous: existing ? overrideSummary(entry, existing) : null,
    next: overrideSummary(entry, saved),
    reason: patch.reason,
    version: saved.version,
  });
  return { ok: true, status: 200, override: saved };
}

/** Reset (delete) an override → feature reverts to static default. Audited. */
export async function deleteOverride(featureId, environment, actor, { client = defaultClient, req } = {}) {
  const entry = getManifestEntry(featureId);
  if (!entry) return { ok: false, status: 404, errors: ['unknown_feature'] };
  if (!VALID_ENVIRONMENTS.includes(environment)) return { ok: false, status: 400, errors: ['invalid_environment'] };

  const { data: existingRows } = await client.from(TABLE).select('*').eq('feature_id', featureId).eq('environment', environment);
  const existing = (existingRows || [])[0] || null;
  if (!existing) return { ok: true, status: 200, reset: true, alreadyDefault: true };

  const { error } = await client.from(TABLE).delete().eq('id', existing.id);
  if (error) return { ok: false, status: 500, errors: ['storage_error'] };

  invalidateOverrideCache(environment);
  await emitAudit(client, {
    req,
    actor,
    event_type: 'FEATURE_ROLLOUT_RESET',
    feature_id: featureId,
    environment,
    previous: overrideSummary(entry, existing),
    next: { state: entry.defaultLifecycle, reset: true },
    version: existing.version,
  });
  return { ok: true, status: 200, reset: true };
}

export async function getFeatureAudit(featureId, { client = defaultClient, limit = 50 } = {}) {
  const { data, error } = await client
    .from('trust_audit_events')
    .select('*')
    .eq('trust_fact', featureId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []).filter((e) => typeof e.event_type === 'string' && e.event_type.startsWith('FEATURE_ROLLOUT_'));
}

// ── Internal helpers ────────────────────────────────────────────────────────
function overrideSummary(entry, row) {
  return {
    state: row.lifecycle_state ?? entry.defaultLifecycle,
    enabled: row.enabled,
    allowed_roles: row.allowed_roles ?? entry.defaultRoles,
    allowed_tenant_ids: row.allowed_tenant_ids ?? [],
    denied_tenant_ids: row.denied_tenant_ids ?? [],
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    version: row.version,
  };
}

async function emitAudit(client, ev) {
  try {
    await logAuditEvent(client, {
      req: ev.req,
      event_type: ev.event_type,
      trust_fact: ev.feature_id,
      previous_value: ev.previous,
      new_value: ev.next,
      actor_user_id: ev.actor?.id ?? ev.actor?.userId ?? null,
      actor_role: ev.actor?.effectiveRole ?? ev.actor?.role ?? null,
      actor_tenant_id: ev.actor?.tenantId ?? null,
      reason: ev.reason ?? null,
      source_dashboard: 'admin.feature-governance',
      metadata: { environment: ev.environment, version: ev.version },
    });
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'feature governance audit emit failed', error: err?.message }));
  }
}
