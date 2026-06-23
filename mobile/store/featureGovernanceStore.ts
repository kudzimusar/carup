/**
 * Feature governance store (Milestone A).
 *
 * Holds the backend-derived effective feature states that native navigation
 * selectors and route boundaries consume. Mirrors web's identity-keyed loader:
 * a result is only applied if the auth identity it was fetched FOR still
 * matches, so a just-switched/just-logged-in identity is never gated by stale
 * state. An empty map (initial, or after a failed fetch) means "use static
 * manifest defaults".
 */
import { create } from 'zustand';
import type { NativeEffectiveStateMap } from '../navigation/types';
import { fetchEffectiveStates } from '../utils/featureGovernanceApi';

interface FeatureGovernanceState {
  effectiveStates: NativeEffectiveStateMap;
  loading: boolean;
  /** The auth identity key the current `effectiveStates` were fetched for. */
  loadedForKey: string | null;
  refresh: () => Promise<void>;
}

/** Identity key from the auth store: distinct user+token ⇒ distinct gating. */
function currentIdentityKey(
  user: { id?: string | null } | null,
  token: string | null,
): string {
  return `${user?.id ?? 'anon'}|${token ?? ''}`;
}

export const useFeatureGovernanceStore = create<FeatureGovernanceState>((set) => ({
  effectiveStates: {},
  loading: false,
  loadedForKey: null,

  refresh: async () => {
    // Lazy import to avoid a static cycle (authStore → governance → authStore).
    const { useAuthStore } = await import('./authStore');
    const { user, token } = useAuthStore.getState();
    const requestedKey = currentIdentityKey(user, token);

    set({ loading: true });
    const map = await fetchEffectiveStates();

    // Identity guard: only apply if the identity hasn't changed mid-flight.
    const after = useAuthStore.getState();
    const currentKey = currentIdentityKey(after.user, after.token);
    if (currentKey !== requestedKey) {
      // A switch/login/logout happened while in flight — drop the stale result.
      set({ loading: false });
      return;
    }

    set({ effectiveStates: map, loadedForKey: requestedKey, loading: false });
  },
}));

/** Selector: the current effective states map (empty ⇒ static defaults). */
export function selectEffectiveStates(): NativeEffectiveStateMap {
  return useFeatureGovernanceStore.getState().effectiveStates;
}
