/**
 * Native feature manifest adapter (Milestone A).
 *
 * Loads the SAME governed feature truth web uses — the shared manifest JSON —
 * and exposes native-safe lookups. Validation is fail-safe: an invalid manifest
 * logs a warning and yields an empty list rather than throwing at import time
 * (the app must still boot; a disabled/empty manifest simply governs nothing).
 */
import type {
  NativeFeatureManifestEntry,
  NativeLifecycleState,
} from './types';
// resolveJsonModule is enabled (expo/tsconfig.base). The raw import is typed
// through a cast so a malformed JSON shape cannot silently widen our types.
import rawManifest from '@shared/navigation/feature-manifest.json';

const LIFECYCLES: NativeLifecycleState[] = [
  'active',
  'beta',
  'planned',
  'hidden',
  'disabled',
  'deprecated',
];

function isValidEntry(value: unknown): value is NativeFeatureManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.domain === 'string' &&
    typeof e.route === 'string' &&
    typeof e.defaultLifecycle === 'string' &&
    LIFECYCLES.includes(e.defaultLifecycle as NativeLifecycleState) &&
    Array.isArray(e.defaultRoles) &&
    Array.isArray(e.immutableRoles) &&
    typeof e.requiresAuth === 'boolean' &&
    typeof e.betaCapable === 'boolean'
  );
}

/**
 * Validate the imported manifest. On any structural problem, warn and return an
 * empty list — NEVER throw at import (the app must boot regardless).
 */
export function validateManifest(value: unknown): NativeFeatureManifestEntry[] {
  if (!Array.isArray(value)) {
    console.warn('[nativeNav] feature manifest is not an array — governing nothing.');
    return [];
  }
  const valid: NativeFeatureManifestEntry[] = [];
  for (const entry of value) {
    if (isValidEntry(entry)) {
      valid.push(entry);
    } else {
      console.warn('[nativeNav] dropping invalid feature manifest entry:', entry);
    }
  }
  return valid;
}

/** The validated, native-safe feature manifest. */
export const FEATURE_MANIFEST: NativeFeatureManifestEntry[] =
  validateManifest(rawManifest as unknown);

const BY_ID = new Map<string, NativeFeatureManifestEntry>(
  FEATURE_MANIFEST.map((e) => [e.id, e]),
);

/** Look up a feature by its stable id. */
export function getFeatureById(id: string): NativeFeatureManifestEntry | undefined {
  return BY_ID.get(id);
}

/** Split a route into clean, leading-slash-free segments. */
function segments(route: string): string[] {
  return route
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean);
}

/**
 * Segment match (mirror of web matchRoutePattern). A `:param` pattern segment is
 * a wildcard matching exactly one concrete segment. Lengths must be equal.
 */
function routeMatches(pattern: string, route: string): boolean {
  const p = segments(pattern);
  const r = segments(route);
  if (p.length !== r.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) continue;
    if (p[i] !== r[i]) return false;
  }
  return true;
}

/** Find the feature owning a concrete route (segment + `:param` matching). */
export function getFeatureByRoute(route: string): NativeFeatureManifestEntry | undefined {
  // Prefer an exact (no-wildcard) match before a parameterised one so
  // `/marketplace` resolves to product.marketplace rather than a `:param` route.
  let wildcardMatch: NativeFeatureManifestEntry | undefined;
  for (const entry of FEATURE_MANIFEST) {
    if (!routeMatches(entry.route, route)) continue;
    if (!entry.route.includes(':')) return entry;
    if (!wildcardMatch) wildcardMatch = entry;
  }
  return wildcardMatch;
}

/** Static (manifest-default) lifecycle for an entry. */
export function getStaticLifecycle(entry: NativeFeatureManifestEntry): NativeLifecycleState {
  return entry.defaultLifecycle;
}
