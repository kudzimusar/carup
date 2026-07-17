/**
 * Feature governance API client (Milestone A).
 *
 * Fetches backend-derived effective feature states so native navigation
 * consumes the SAME governed truth as web. The result is DISCRIMINATED so the
 * store can distinguish a genuine "no governed features" success from a fetch
 * FAILURE (config, network, non-OK, bad shape): success-empty must not look the
 * same as a failure, otherwise a failed identity-B load would be mistaken for a
 * loaded-empty state and protected routes would un-gate. Callers decide the
 * fail-CLOSED policy (see the store); this client never throws.
 *
 * Either way the `map` is conservative (empty on failure), so a disabled
 * feature never becomes enabled because a fetch failed.
 *
 * The backend derives role/tenant SERVER-SIDE from the trusted session; client
 * role headers are ignored. We send x-session-token, x-user-id, x-tenant-id.
 *
 * URL note: resolveApiBaseUrl returns the ORIGIN (no `/api`), matching how
 * marketplaceApi builds URLs — so the path is `/api/features/effective`.
 */
import { apiUrl } from './apiBase';
import type { NativeEffectiveState, NativeEffectiveStateMap } from '../navigation/types';

const LIFECYCLES = new Set([
  'active',
  'beta',
  'planned',
  'hidden',
  'disabled',
  'deprecated',
]);

function isEffectiveState(value: unknown): value is NativeEffectiveState {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.featureId === 'string' &&
    typeof f.state === 'string' &&
    LIFECYCLES.has(f.state) &&
    typeof f.enabled === 'boolean' &&
    typeof f.visible === 'boolean' &&
    typeof f.accessible === 'boolean' &&
    typeof f.beta === 'boolean'
  );
}

async function governanceHeaders(): Promise<Record<string, string>> {
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers['x-session-token'] = token;
  if (user?.id) headers['x-user-id'] = user.id;
  if (user?.active_tenant_id) headers['x-tenant-id'] = user.active_tenant_id;
  // Opaque, non-PII installation cohort id — buckets this install into a
  // deterministic percentage rollout. Authenticated identity still wins
  // server-side. Lazy import avoids a static store↔api cycle.
  try {
    const { getNavCohortId } = await import('../store/featureGovernanceStore');
    const cohortId = await getNavCohortId();
    if (cohortId) headers['x-nav-cohort'] = cohortId;
  } catch {
    /* no cohort → treated as out of partial rollouts (conservative) */
  }
  return headers;
}

/**
 * Discriminated fetch result: `ok:true` carries a (possibly empty) success map;
 * `ok:false` signals a transport/config/parse failure. The empty `map` on
 * failure stays conservative for any caller that ignores `ok`, but the store
 * uses `ok` to fail CLOSED on an identity-change failure (never treat a failed
 * load as "loaded").
 */
export type FetchEffectiveStatesResult =
  | { ok: true; map: NativeEffectiveStateMap }
  | { ok: false; map: NativeEffectiveStateMap; unauthorized?: boolean };

/**
 * Fetch the effective feature states for the current session. NEVER throws.
 * Returns `{ ok:false }` on ANY failure (misconfig, network, non-OK, bad shape)
 * and `{ ok:true, map }` on a successful response (the map may be empty when the
 * backend reports no governed features).
 */
export async function fetchEffectiveStates(): Promise<FetchEffectiveStatesResult> {
  let url: string;
  try {
    url = apiUrl('/api/features/effective');
  } catch {
    // Misconfigured base (e.g. EXPO_PUBLIC_API_URL unset / localhost on device).
    return { ok: false, map: {} };
  }

  try {
    const headers = await governanceHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      // 401/403 means the SESSION is invalid (stale/expired token), which is a
      // different failure class from network/5xx: the caller must clear the
      // invalid auth and route to login instead of showing a dead-end retry.
      return {
        ok: false,
        map: {},
        unauthorized: response.status === 401 || response.status === 403,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, map: {} };
    }

    const features = (body as { features?: unknown })?.features;
    if (!Array.isArray(features)) return { ok: false, map: {} };

    const map: NativeEffectiveStateMap = {};
    for (const f of features) {
      if (isEffectiveState(f)) map[f.featureId] = f;
    }
    return { ok: true, map };
  } catch {
    return { ok: false, map: {} };
  }
}
