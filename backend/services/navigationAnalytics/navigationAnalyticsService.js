/**
 * Navigation Analytics Service (Milestone F) — privacy-minimized navigation
 * telemetry.
 *
 * Hard privacy invariant: this service stores ONLY a versioned, enum-bounded
 * taxonomy. Every inbound event is allowlist-PROJECTED to the permitted columns
 * and everything else is DROPPED — names, email, phone, VIN, tokens, free text,
 * raw tenant ids, device ids, raw URLs and IP are never persisted. Route values
 * are mapped to a REGISTERED feature route / manifest node id, or the constant
 * 'unregistered'; a raw URL is never stored. `role_category` is a COARSE bucket
 * derived from a TRUSTED server session (a client-sent role is ignored — it can
 * only default to 'anonymous'). Storage failures NEVER throw to the caller, so
 * navigation is never blocked by analytics.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase as defaultClient } from '../../db/supabase.js';
import { resolveRequestContext } from '../featureGovernance/featureGovernanceService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../shared/navigation/feature-manifest.json');
// Backend-authoritative allowlist of navigation NODE ids (e.g. 'buy.shop-all').
// Generated from web/src/config/navigationManifest.ts by
// scripts/generate-feature-manifest.mjs and kept in sync by the CI drift gate.
const NAV_NODES_PATH = path.resolve(__dirname, '../../../shared/navigation/navigation-nodes.json');
const TABLE = 'navigation_analytics_events';

// ── Bounds ───────────────────────────────────────────────────────────────────
export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_BODY_BYTES = 32 * 1024; // 32 KB hard cap on the ingestion body.
const DEDUPE_WINDOW = 2000; // recent dedupe_key bound (count, in-process best-effort).
const UNREGISTERED = 'unregistered';

// ── Versioned taxonomy (must mirror the DB CHECK constraints) ────────────────
export const EVENT_TYPES = new Set([
  'navigation_surface_opened',
  'navigation_item_impression',
  'navigation_item_selected',
  'navigation_destination_rendered',
  'navigation_destination_blocked',
  'navigation_role_switched',
  'navigation_drawer_opened',
  'navigation_tab_selected',
  'navigation_error',
]);
export const SURFACES = new Set([
  'mega_menu', 'mobile_drawer', 'bottom_tabs', 'sidebar',
  'footer', 'command_palette', 'route_guard', 'unknown',
]);
export const PLATFORMS = new Set(['web', 'ios', 'android']);
export const ROLE_CATEGORIES = new Set([
  'anonymous', 'owner', 'dealer', 'mechanic', 'insurance',
  'government', 'admin', 'bank',
]);

// Bounded textual lengths (mirror the DB CHECKs).
const LIMITS = {
  feature_id: 128,
  node_id: 128,
  source_route_pattern: 256,
  destination_route_pattern: 256,
  lifecycle_or_reason_code: 64,
  build_version: 64,
};

// ── Route/feature/node allowlist built from the shared manifest ──────────────
let _allowlist = null;
function buildAllowlist() {
  if (_allowlist) return _allowlist;
  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    manifest = [];
  }
  // The navigation NODE ids (e.g. 'buy.shop-all') are a SEPARATE allowlist from
  // the FEATURE ids — they live in NAVIGATION_MANIFEST, not the feature manifest.
  let navNodes = [];
  try {
    navNodes = JSON.parse(fs.readFileSync(NAV_NODES_PATH, 'utf8'));
  } catch {
    navNodes = [];
  }
  const routes = new Set();
  const featureRouteNodeIds = new Set();
  const featureIds = new Set();
  for (const entry of Array.isArray(manifest) ? manifest : []) {
    if (entry?.route) routes.add(entry.route);
    if (entry?.id) {
      featureRouteNodeIds.add(entry.id);
      featureIds.add(entry.id);
    }
  }
  const navNodeIds = new Set(Array.isArray(navNodes) ? navNodes : []);
  // `nodeIds` keeps its existing role inside route sanitization (a feature id can
  // legitimately appear as a route pattern); `navNodeIds` is the strict
  // allowlist for the persisted `node_id` column.
  _allowlist = { routes, nodeIds: featureRouteNodeIds, featureIds, navNodeIds };
  return _allowlist;
}
/** Test/maintenance hook to force a manifest re-read. */
export function _resetAllowlist() { _allowlist = null; }

/**
 * Sanitize an inbound route value to a stored route PATTERN. Only a value that
 * maps to a REGISTERED feature route or a known manifest node id is preserved;
 * everything else (and any raw arbitrary URL) collapses to 'unregistered'. We
 * never store the raw input. Returns null when the input is absent.
 */
export function sanitizeRoutePattern(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return UNREGISTERED;
  const value = raw.trim();
  if (!value) return null;
  const { routes, nodeIds } = buildAllowlist();
  if (routes.has(value) || nodeIds.has(value)) return value;
  // Tolerate a route carrying a query/hash by matching its path prefix.
  const pathOnly = value.split(/[?#]/)[0];
  if (routes.has(pathOnly)) return pathOnly;
  return UNREGISTERED;
}

function allowlistedFeatureId(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const { featureIds } = buildAllowlist();
  return featureIds.has(value) ? value : null;
}

/**
 * Allowlist a navigation NODE id against the backend-authoritative set generated
 * from NAVIGATION_MANIFEST (shared/navigation/navigation-nodes.json).
 *
 * Policy: trim and bound the length, then return the value IFF it is a REGISTERED
 * navigation node id (e.g. 'buy.shop-all'). Anything else — an unknown id, a
 * malformed/oversized string, or a PII-looking value a caller tried to smuggle in
 * (email / VIN / phone / free text) — is replaced with **null**. The event still
 * persists for route-level signal; only the node_id is dropped. A genuinely
 * absent node_id is also null and acceptable. This guarantees the stored node_id
 * is always a member of the allowlist or null — never arbitrary caller input.
 */
function allowlistedNodeId(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  // Bound length BEFORE allowlist lookup so an oversized value can never match.
  const value = raw.trim().slice(0, LIMITS.node_id);
  if (!value) return null;
  const { navNodeIds } = buildAllowlist();
  return navNodeIds.has(value) ? value : null;
}

function boundedString(raw, max) {
  if (raw == null || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  return value.slice(0, max);
}

/**
 * Allowlist-PROJECT one inbound event to the permitted stored columns, dropping
 * every unknown field. Returns a row object or null when the event is invalid
 * (unknown event_type / surface). `role_category` is supplied by the caller from
 * the TRUSTED session — never from the event body.
 */
export function projectEvent(raw, { roleCategory = 'anonymous', schemaVersion = SUPPORTED_SCHEMA_VERSION } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const eventType = typeof raw.event_type === 'string' ? raw.event_type.trim() : null;
  if (!eventType || !EVENT_TYPES.has(eventType)) return null;

  const surface = typeof raw.surface === 'string' && SURFACES.has(raw.surface.trim())
    ? raw.surface.trim()
    : 'unknown';

  const platform = typeof raw.platform === 'string' && PLATFORMS.has(raw.platform.trim())
    ? raw.platform.trim()
    : null;
  if (!platform) return null; // platform is required and enum-bounded.

  const role = ROLE_CATEGORIES.has(roleCategory) ? roleCategory : 'anonymous';

  // Only these columns are ever persisted — everything else on `raw` is dropped.
  return {
    schema_version: schemaVersion,
    event_type: eventType,
    feature_id: allowlistedFeatureId(raw.feature_id),
    node_id: allowlistedNodeId(raw.node_id),
    surface,
    source_route_pattern: sanitizeRoutePattern(raw.source_route_pattern),
    destination_route_pattern: sanitizeRoutePattern(raw.destination_route_pattern),
    platform,
    role_category: role,
    lifecycle_or_reason_code: boundedString(raw.lifecycle_or_reason_code, LIMITS.lifecycle_or_reason_code),
    build_version: boundedString(raw.build_version, LIMITS.build_version),
    occurred_at: parseOccurredAt(raw.occurred_at),
  };
}

function parseOccurredAt(raw) {
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
    const t = Date.parse(raw);
    // Never trust a client clock too far in the future; clamp to now.
    return t > Date.now() ? new Date().toISOString() : new Date(t).toISOString();
  }
  return new Date().toISOString();
}

// ── In-process recent dedupe (best-effort; bounded) ──────────────────────────
const _recentDedupe = new Set();
function rememberDedupe(key) {
  if (!key) return false;
  if (_recentDedupe.has(key)) return true;
  _recentDedupe.add(key);
  if (_recentDedupe.size > DEDUPE_WINDOW) {
    // Drop the oldest by clearing — bounded memory over absolute precision.
    const overflow = _recentDedupe.size - DEDUPE_WINDOW;
    let i = 0;
    for (const k of _recentDedupe) {
      _recentDedupe.delete(k);
      if (++i >= overflow) break;
    }
  }
  return false;
}
/** Test hook: clear the recent-dedupe memory. */
export function _resetDedupe() { _recentDedupe.clear(); }

/**
 * Ingest a batch. Returns a summary `{ accepted, dropped, duplicates, stored }`.
 * NEVER throws — storage failure resolves to `{ stored: false }` so navigation
 * is never blocked. `req` supplies the TRUSTED session for the role bucket.
 */
export async function ingestBatch(body, { client = defaultClient, req } = {}) {
  const summary = { accepted: 0, dropped: 0, duplicates: 0, stored: false, schemaVersionRejected: false, tooLarge: false };

  if (!body || typeof body !== 'object') { summary.dropped = 1; return summary; }

  const schemaVersion = Number(body.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    summary.schemaVersionRejected = true;
    return summary;
  }

  let events = Array.isArray(body.events) ? body.events : [];
  if (events.length > MAX_EVENTS_PER_BATCH) {
    // Truncate rather than reject the whole batch — keep the first N, flag it.
    summary.tooLarge = true;
    events = events.slice(0, MAX_EVENTS_PER_BATCH);
  }

  // Derive the COARSE role bucket from a TRUSTED session (client role ignored).
  const roleCategory = await deriveRoleCategory(req, client);

  const seenInBatch = new Set();
  const rows = [];
  for (const ev of events) {
    const dedupeKey = typeof ev?.dedupe_key === 'string' ? ev.dedupe_key.slice(0, 128) : null;
    if (dedupeKey) {
      if (seenInBatch.has(dedupeKey) || rememberDedupe(dedupeKey)) { summary.duplicates++; continue; }
      seenInBatch.add(dedupeKey);
    }
    const projected = projectEvent(ev, { roleCategory, schemaVersion });
    if (!projected) { summary.dropped++; continue; }
    rows.push(projected);
  }
  summary.accepted = rows.length;

  if (rows.length === 0) { summary.stored = true; return summary; }

  try {
    const { error } = await client.from(TABLE).insert(rows);
    summary.stored = !error;
  } catch {
    summary.stored = false; // swallow — analytics never blocks navigation.
  }
  return summary;
}

/**
 * Map a TRUSTED, server-derived role to a COARSE category. A client-sent role is
 * NEVER consulted here — `resolveRequestContext` reads the session only. Unknown
 * / anonymous → 'anonymous'.
 */
async function deriveRoleCategory(req, client) {
  try {
    if (!req) return 'anonymous';
    const ctx = await resolveRequestContext(req, { client });
    return coarseRole(ctx?.role);
  } catch {
    return 'anonymous';
  }
}

export function coarseRole(role) {
  const r = role ? String(role).toLowerCase() : null;
  if (!r) return 'anonymous';
  if (['admin', 'platform_admin', 'super_admin'].includes(r)) return 'admin';
  return ROLE_CATEGORIES.has(r) ? r : 'anonymous';
}

// ── Admin aggregates (bounded; grouped — never a raw event dump) ─────────────
/**
 * Aggregate navigation analytics over a date range, optionally filtered by
 * feature. Returns discovery / funnel metrics. Uses a single bounded read of the
 * window (capped) then aggregates in memory so it works against the in-memory
 * test client too; the index on occurred_at keeps the window scan cheap.
 */
export async function getNavigationAggregates({ client = defaultClient, from, to, featureId, limit = 50000 } = {}) {
  const fromIso = from && !Number.isNaN(Date.parse(from)) ? new Date(from).toISOString() : isoDaysAgo(7);
  const toIso = to && !Number.isNaN(Date.parse(to)) ? new Date(to).toISOString() : new Date().toISOString();

  let rows = [];
  try {
    let q = client.from(TABLE).select('*');
    if (typeof q.gte === 'function') q = q.gte('occurred_at', fromIso);
    if (typeof q.lte === 'function') q = q.lte('occurred_at', toIso);
    if (featureId && typeof q.eq === 'function') q = q.eq('feature_id', featureId);
    if (typeof q.limit === 'function') q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows = Array.isArray(data) ? data : [];
  } catch (err) {
    return { ok: false, error: 'aggregation_failed', range: { from: fromIso, to: toIso }, featureId: featureId || null };
  }

  // Defensive in-memory window/feature filter (covers clients without gte/lte).
  rows = rows.filter((r) => {
    const t = r.occurred_at ? Date.parse(r.occurred_at) : NaN;
    if (Number.isNaN(t)) return true;
    if (t < Date.parse(fromIso) || t > Date.parse(toIso)) return false;
    if (featureId && r.feature_id !== featureId) return false;
    return true;
  });

  const counts = countBy(rows, 'event_type');
  const impressions = counts.navigation_item_impression || 0;
  const selections = counts.navigation_item_selected || 0;
  const destinationRenders = counts.navigation_destination_rendered || 0;
  const blocked = counts.navigation_destination_blocked || 0;
  const errors = counts.navigation_error || 0;

  // Zero-selection discovery: items impressed but never selected (in window).
  const impressedKeys = new Set();
  const selectedKeys = new Set();
  for (const r of rows) {
    const key = r.feature_id || r.node_id;
    if (!key) continue;
    if (r.event_type === 'navigation_item_impression') impressedKeys.add(key);
    if (r.event_type === 'navigation_item_selected') selectedKeys.add(key);
  }
  const zeroSelectionItems = [...impressedKeys].filter((k) => !selectedKeys.has(k)).sort();

  return {
    ok: true,
    range: { from: fromIso, to: toIso },
    featureId: featureId || null,
    totals: {
      events: rows.length,
      impressions,
      selections,
      destinationRenders,
      blocked,
      errors,
    },
    selectionThroughRate: impressions > 0 ? Number((selections / impressions).toFixed(4)) : 0,
    platformSplit: countBy(rows, 'platform'),
    roleCategorySplit: countBy(rows, 'role_category'),
    eventTypeSplit: counts,
    topSurfaces: topN(countBy(rows, 'surface'), 10),
    zeroSelectionItems,
  };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const v = r?.[key];
    if (v == null) continue;
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}
function topN(countMap, n) {
  return Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}
