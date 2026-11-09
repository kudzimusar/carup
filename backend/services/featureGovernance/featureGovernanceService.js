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
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { isUserIdFallbackAllowed } from '../../middleware/authMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../shared/navigation/feature-manifest.json');
const TABLE = 'feature_rollout_overrides';
const VALID_ENVIRONMENTS = ['development', 'staging', 'production'];
const VALID_LIFECYCLE = ['active', 'beta', 'planned', 'hidden', 'disabled', 'deprecated'];
const CACHE_TTL_MS = 30_000;
const MAX_SEED_LENGTH = 64; // mirrors the DB CHECK (rollout_seed length bound)

function normalizeRole(role) {
  return role ? String(role).toLowerCase() : null;
}

/** Verify a user's membership of an organization; returns the tenant_users row or null. */
async function verifyTenantMembership(client, userId, organizationId) {
  if (!organizationId) return null;
  const { data } = await client.from('tenant_users').select('role').eq('tenant_id', organizationId).eq('user_id', userId);
  return (data || [])[0] || null;
}

/**
 * The role this user holds in their own tenant, read from `tenant_users`.
 *
 * Round 2 owner UAT: a real garage tenant-member reached `/garage` and was shown "Feature
 * unavailable". Static lifecycle was `active` and `enabled` was true; the feature was reported
 * `accessible: false`, because eligibility was computed from the PLATFORM role alone and public
 * registration makes every self-registered garage employee an `owner`.
 *
 * This is read server-side from the membership record — never from a client header — and it is used
 * ONLY to answer "may this subject use this feature", exactly as `resolveEffectiveRole` answers "may
 * this subject act in this role". It deliberately does NOT set `tenantId`: tenant-scoped overrides
 * still apply only to a genuinely switched context, so no override starts applying to anyone who
 * was not already in its scope.
 *
 * `admin` is excluded for the same reason the switch-role path excludes it: a tenant must never be
 * able to mint platform administration.
 */
async function resolveOwnTenantRole(client, userId) {
  if (!userId) return null;
  const { data } = await client
    .from('tenant_users').select('role').eq('user_id', userId).limit(1);
  const role = normalizeRole((data || [])[0]?.role);
  return role && role !== 'admin' ? role : null;
}

/**
 * Resolve a TRUSTED, server-derived request context for the public effective
 * endpoint, following the SAME contract as /api/auth/switch-role + authorizeRole:
 *
 *  - The current role/tenant come from the SESSION (`user_sessions.active_role`,
 *    `active_organization_id`) — these are server-issued at switch time. Client
 *    role/tenant headers (x-stakeholder-role / x-tenant-id) are NEVER trusted as
 *    authority.
 *  - The switched context is RE-VERIFIED here (defends against a stale session
 *    whose membership/role was revoked after the switch):
 *      • no active_role            → base platform role (`users.role`), no tenant;
 *      • active_role == base role  → base role; tenant only if active_org membership verifies;
 *      • active_role != base role  → requires active_organization_id AND a
 *        `tenant_users` membership whose role matches active_role (and is not
 *        admin); otherwise fall back to LEAST PRIVILEGE (base role, no tenant).
 *  - Anonymous requests are fully supported. Never throws; any failure degrades
 *    to anonymous / least privilege.
 */
export async function resolveRequestContext(req, { client = defaultClient } = {}) {
  const headers = (req && req.headers) || {};
  const token = headers['x-session-token'] || (headers['authorization'] ? String(headers['authorization']).replace('Bearer ', '') : null);
  const fallbackUserId = headers['x-user-id'];
  // Opaque, NON-AUTH cohort id (web localStorage / native install id). Used ONLY
  // to bucket anonymous (or otherwise identity-less) subjects into a percentage
  // rollout — it confers no role or tenant. Bounded so it can't bloat the hash.
  const cohortId = sanitizeCohortId(headers['x-nav-cohort']);

  try {
    let session = null;
    let userId = null;
    if (token) {
      const { data } = await client
        .from('user_sessions')
        .select('user_id, active_role, active_organization_id, is_valid, expires_at')
        .eq('token', token);
      const row = (data || [])[0];
      if (row && row.is_valid && new Date(row.expires_at) >= new Date()) {
        session = row;
        userId = row.user_id;
      }
    }
    if (!userId && fallbackUserId && isUserIdFallbackAllowed()) {
      userId = fallbackUserId; // dev/test fallback: no session row → base role only
    }
    if (!userId) return { role: null, tenantId: null, tenantRole: null, userId: null, cohortId }; // anonymous

    // Trusted base platform role.
    const { data: users } = await client.from('users').select('role').eq('id', userId);
    const baseRole = normalizeRole((users || [])[0]?.role);

    const activeRole = normalizeRole(session?.active_role);
    const activeOrg = session?.active_organization_id || null;
    // Carried alongside the platform role, never in place of it.
    const tenantRole = await resolveOwnTenantRole(client, userId);

    // No switched context recorded → base role.
    if (!activeRole) return { role: baseRole, tenantId: null, tenantRole, userId, cohortId };

    // Acting as the base role: tenant applies only if the org membership verifies.
    if (activeRole === baseRole) {
      const membership = await verifyTenantMembership(client, userId, activeOrg);
      return { role: baseRole, tenantId: membership ? activeOrg : null, tenantRole, userId, cohortId };
    }

    // Switched (tenant) role: must be backed by a verified, matching, non-admin
    // tenant_users membership — mirrors switch-role's canAssumeRequestedRole.
    const membership = await verifyTenantMembership(client, userId, activeOrg);
    if (activeOrg && membership && normalizeRole(membership.role) === activeRole && activeRole !== 'admin') {
      return { role: activeRole, tenantId: activeOrg, tenantRole, userId, cohortId };
    }
    // Stale / unverifiable switched context → least privilege.
    return { role: baseRole, tenantId: null, tenantRole, userId, cohortId };
  } catch {
    return { role: null, tenantId: null, tenantRole: null, userId: null, cohortId: null }; // fail closed
  }
}

/** Normalize an inbound x-nav-cohort header → trimmed string ≤128 chars, or null. */
function sanitizeCohortId(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 128);
}

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
  if (patch.rollout_percentage != null) {
    const p = patch.rollout_percentage;
    if (typeof p !== 'number' || !Number.isInteger(p) || Number.isNaN(p) || p < 0 || p > 100) {
      errors.push('invalid_rollout_percentage');
    }
  }
  if (patch.rollout_seed != null) {
    if (typeof patch.rollout_seed !== 'string' || patch.rollout_seed.length > MAX_SEED_LENGTH) {
      errors.push('invalid_rollout_seed');
    }
  }
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

// ── Deterministic percentage rollout ────────────────────────────────────────
/**
 * Resolve the STABLE subject id used for percentage bucketing from a trusted
 * context, in priority order. The cohort id is NOT auth — it only buckets an
 * identity-less subject. Returns `null` when no stable subject is available.
 *
 *   1. authenticated user_id
 *   2. user_id + ':' + tenantId  (verified tenant context — keeps the same user
 *      in a consistent bucket per tenant)
 *   3. anonymous cohort id (web localStorage / native install id, x-nav-cohort)
 */
export function resolveSubject(ctx = {}) {
  if (ctx.userId && ctx.tenantId) return `${ctx.userId}:${ctx.tenantId}`;
  if (ctx.userId) return String(ctx.userId);
  if (ctx.cohortId) return `cohort:${ctx.cohortId}`;
  return null;
}

/**
 * Deterministic bucket 0–99 for (feature, environment, seed, subject). ONE
 * stable server-side hash (SHA-256 over a pipe-joined key, first 4 bytes → mod
 * 100) so the SAME inputs map to the SAME bucket across every instance, process
 * and restart. No per-request randomness. Pure.
 */
export function rolloutBucket(featureId, environment, seed, subject) {
  const key = `${featureId}|${environment}|${seed || ''}|${subject}`;
  const digest = crypto.createHash('sha256').update(key).digest();
  // First 4 bytes as an unsigned 32-bit int, then mod 100.
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/**
 * Whether a subject is INSIDE the percentage rollout for an override.
 *  - percentage >= 100 → always in (full rollout; the default for every row).
 *  - percentage <= 0   → never in.
 *  - 0 < percentage < 100 with a stable subject → bucket < percentage.
 *  - 0 < percentage < 100 with NO stable subject (anonymous, no cohort) → NOT
 *    in (conservative — a partially-rolled feature stays gated for callers we
 *    cannot deterministically bucket; it is never broadened by chance).
 */
export function passesPercentage(override, ctx = {}) {
  const pct = normalizePercentage(override?.rollout_percentage);
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  const subject = resolveSubject(ctx);
  if (!subject) return false; // conservative: no stable subject → gated out
  return rolloutBucket(override.feature_id, ctx.environment, override.rollout_seed, subject) < pct;
}

/** Coerce a stored percentage to an integer 0–100 (default 100 when absent/invalid). */
function normalizePercentage(value) {
  if (value === null || value === undefined) return 100;
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.trunc(n)));
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
  // Either the platform role or the VERIFIED tenant role may satisfy the allow-list. A garage
  // employee is an `owner` platform-wide and a `mechanic` in their garage; both are true, and
  // judging on the platform role alone showed them "Feature unavailable" on their own workspace.
  // The allow-list itself is unchanged, so an override still cannot broaden anything.
  const roleEligible = !requiresAuth
    ? true
    : Boolean((ctx.role && allowedRoles.includes(ctx.role))
      || (ctx.tenantRole && allowedRoles.includes(ctx.tenantRole)));
  const tenantOk = applies ? tenantAllowed(override, ctx.tenantId) : true;

  // Percentage gate — inserted AFTER role + tenant allow/deny, BEFORE the final
  // visible/accessible computation. It may ONLY NARROW: a subject bucketed out
  // gets visible=false/accessible=false, but role/tenant denial already wins
  // (roleEligible/tenantOk are false → visible/accessible false regardless of
  // percentage). Percentage NEVER broadens role/tenant. `state`/`enabled` stay
  // truthful (lifecycle is unchanged); only exposure flips off when bucketed out.
  const inRollout = applies ? passesPercentage(override, ctx) : true;

  const visible = isLifecycleVisible(state) && roleEligible && enabled && tenantOk && inRollout;
  const accessible = isLifecycleAccessible(state) && roleEligible && enabled && tenantOk && inRollout;

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
    rolloutPercentage: applies ? normalizePercentage(override.rollout_percentage) : 100,
    inRollout,
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
    rollout_percentage: patch.rollout_percentage ?? 100,
    rollout_seed: patch.rollout_seed ?? null,
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
    // Rollout config knobs (NOT subjects/buckets — safe to audit).
    rollout_percentage: normalizePercentage(row.rollout_percentage),
    rollout_seed: row.rollout_seed ?? null,
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
