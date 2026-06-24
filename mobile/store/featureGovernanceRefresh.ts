/**
 * Pure, node-safe refresh helpers for the feature governance store.
 *
 * Extracted from featureGovernanceStore.ts so the clear-on-identity-change
 * decision can be unit-tested with `npx tsx` WITHOUT pulling in the Expo /
 * react-native runtime that the store's `expo-secure-store` import requires.
 * These functions hold no state and import nothing native.
 */
import type { NativeEffectiveStateMap } from '../navigation/types';

/** Identity key from the auth store: distinct user+token ⇒ distinct gating. */
export function currentIdentityKey(
  user: { id?: string | null } | null,
  token: string | null,
): string {
  return `${user?.id ?? 'anon'}|${token ?? ''}`;
}

export interface RefreshStartPatch {
  loading: true;
  effectiveStates?: NativeEffectiveStateMap;
  loadedForKey?: string | null;
}

/**
 * Decide what to publish at the START of a refresh, given the identity the
 * current map was loaded for and the identity now being requested.
 *
 * On an IDENTITY CHANGE (loadedForKey !== requestedKey) the published map is
 * stale for the new identity, so we clear it immediately — an empty map means
 * "use conservative static manifest defaults" — and null `loadedForKey` until
 * the new identity's states resolve. This prevents a just-switched identity
 * (e.g. into a denied tenant) from briefly reading the previous accessible:true
 * map. On a SAME-identity refresh we keep the current map to avoid flicker.
 */
export function computeRefreshStart(
  loadedForKey: string | null,
  requestedKey: string,
): RefreshStartPatch {
  if (loadedForKey !== requestedKey) {
    return { loading: true, effectiveStates: {}, loadedForKey: null };
  }
  return { loading: true };
}

/** Why the governed states are (not) ready for the CURRENT identity. */
export type GovernanceReadinessReason = 'ready' | 'loading' | 'error' | 'cold-start';

export interface GovernanceReadiness {
  ready: boolean;
  reason: GovernanceReadinessReason;
}

/**
 * Pure, node-safe readiness contract for a GOVERNED route under the current
 * auth identity. Decides whether the boundary may evaluate access yet, or must
 * block (loading / error) so a just-switched identity is never gated by the
 * previous identity's map. Fail-CLOSED on an identity-change failure.
 *
 * Ordering (the first match wins):
 *   1. `loadedForKey === currentKey`  → ready (states loaded FOR this identity).
 *   2. `loading`                      → not ready, 'loading' (covers an A→B
 *      transition: computeRefreshStart cleared loadedForKey→null + loading→true,
 *      so we block until B resolves — A's map is already gone).
 *   3. `error`                        → not ready, 'error' (a failed identity-B
 *      load: loadedForKey is still null, so we stay blocked + retryable rather
 *      than mistake a failure for "loaded").
 *   4. `loadedForKey === null`        → not ready in spirit, but COLD-START
 *      policy returns ready:'cold-start' — the never-loaded boot state may use
 *      the documented static-manifest fallback so public boot routes aren't
 *      blocked. The boundary still kicks a one-shot refresh, and PROTECTED
 *      routes remain gated by auth inside evaluateNativeRouteAccess (a static
 *      requiresAuth feature with no auth → redirect-auth). Distinguished from
 *      case 3 because `error` is false here.
 *   5. else (stale non-null key, not loading, no error) → not ready, 'error'
 *      (defensive: a key loaded for a DIFFERENT identity that wasn't cleared —
 *      stay blocked rather than evaluate against the wrong identity's map).
 */
export function isGovernanceReadyForIdentity(
  currentKey: string,
  loadedForKey: string | null,
  loading: boolean,
  error: boolean,
): GovernanceReadiness {
  if (loadedForKey === currentKey) return { ready: true, reason: 'ready' };
  if (loading) return { ready: false, reason: 'loading' };
  if (error) return { ready: false, reason: 'error' };
  if (loadedForKey === null) return { ready: true, reason: 'cold-start' };
  return { ready: false, reason: 'error' };
}
