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
