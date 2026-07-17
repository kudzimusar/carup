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
import * as SecureStore from 'expo-secure-store';
import type { NativeEffectiveStateMap } from '../navigation/types';
import { fetchEffectiveStates } from '../utils/featureGovernanceApi';
import {
  currentIdentityKey,
  computeRefreshStart,
  isGovernanceReadyForIdentity,
} from './featureGovernanceRefresh';

export { currentIdentityKey, computeRefreshStart, isGovernanceReadyForIdentity };

const NAV_COHORT_KEY = 'carup_nav_cohort';

/** In-process cache so we don't hit SecureStore on every fetch. */
let _cohortCache: string | null = null;

/** Generate a random 128-bit-ish hex id (stability matters, not crypto strength). */
function generateCohortId(): string {
  let id = '';
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return `${Date.now().toString(16)}${id}`.slice(0, 64);
}

/**
 * Return a STABLE, opaque per-INSTALLATION cohort id (generated once, persisted
 * in SecureStore). It is NOT authentication and carries no PII — it exists ONLY
 * so the backend can deterministically bucket this install into a percentage
 * rollout (the same install stays consistently in or out). An authenticated
 * identity always takes priority server-side. Returns '' if SecureStore is
 * unavailable → that install is simply treated as having no cohort (out of
 * partial rollouts; conservative).
 */
export async function getNavCohortId(): Promise<string> {
  if (_cohortCache) return _cohortCache;
  try {
    const existing = await SecureStore.getItemAsync(NAV_COHORT_KEY);
    if (existing) {
      _cohortCache = existing;
      return existing;
    }
    const id = generateCohortId();
    await SecureStore.setItemAsync(NAV_COHORT_KEY, id);
    _cohortCache = id;
    return id;
  } catch {
    return '';
  }
}

interface FeatureGovernanceState {
  effectiveStates: NativeEffectiveStateMap;
  loading: boolean;
  /**
   * The last fetch FAILED for the requested identity. Used to fail CLOSED: a
   * governed route stays blocked (retryable) instead of being treated as
   * "loaded" when `loadedForKey` was never set for the new identity.
   */
  error: boolean;
  /** The auth identity key the current `effectiveStates` were fetched for. */
  loadedForKey: string | null;
  refresh: () => Promise<void>;
}

export const useFeatureGovernanceStore = create<FeatureGovernanceState>((set) => ({
  effectiveStates: {},
  loading: false,
  error: false,
  loadedForKey: null,

  refresh: async () => {
    // Lazy import to avoid a static cycle (authStore → governance → authStore).
    const { useAuthStore } = await import('./authStore');
    const { user, token } = useAuthStore.getState();
    const requestedKey = currentIdentityKey(user, token);

    // Clear a stale map immediately on an identity change so consumers never
    // read the previous identity's gating during/after the fetch (see
    // computeRefreshStart). A same-identity refresh keeps the map (no flicker).
    // Either way clear `error` while a fresh attempt is in flight.
    const { loadedForKey } = useFeatureGovernanceStore.getState();
    set({ ...computeRefreshStart(loadedForKey, requestedKey), error: false });

    const result = await fetchEffectiveStates();

    // Identity guard: only apply if the identity hasn't changed mid-flight.
    const after = useAuthStore.getState();
    const currentKey = currentIdentityKey(after.user, after.token);
    if (currentKey !== requestedKey) {
      // A switch/login/logout happened while in flight — drop the stale result.
      set({ loading: false });
      return;
    }

    if (!result.ok) {
      // INVALID SESSION (401/403 with a token present): the saved token is
      // stale/expired. Showing the generic retryable error here dead-ends the
      // user (retry re-sends the same bad token forever). Instead clear the
      // invalid auth — logout() purges SecureStore and re-runs governance
      // anonymously, and route boundaries then redirect to /login.
      if (result.unauthorized && after.token) {
        await after.logout();
        return;
      }
      // FAIL CLOSED (network/5xx). Do NOT set `loadedForKey`: an
      // identity-change failure (loadedForKey was cleared to null by
      // computeRefreshStart) must never be treated as "loaded" — the boundary
      // keeps the route blocked + retryable. A SAME-identity transient failure
      // retains the prior last-good map (it is still loaded for this
      // identity); we only flag `error:true` so a retry is offered.
      set({ loading: false, error: true });
      return;
    }

    set({
      effectiveStates: result.map,
      loadedForKey: requestedKey,
      loading: false,
      error: false,
    });
  },
}));

/** Selector: the current effective states map (empty ⇒ static defaults). */
export function selectEffectiveStates(): NativeEffectiveStateMap {
  return useFeatureGovernanceStore.getState().effectiveStates;
}
