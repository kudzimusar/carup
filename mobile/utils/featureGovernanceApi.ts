/**
 * Feature governance API client (Milestone A).
 *
 * Fetches backend-derived effective feature states so native navigation
 * consumes the SAME governed truth as web. Fail-safe by design: ANY error
 * (config, network, non-OK, bad shape) returns an EMPTY map, which the
 * selectors/evaluator treat as "use static manifest defaults" — a disabled
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
  return headers;
}

/**
 * Fetch the effective feature states for the current session. Returns `{}` on
 * any failure (fail-safe → static defaults).
 */
export async function fetchEffectiveStates(): Promise<NativeEffectiveStateMap> {
  let url: string;
  try {
    url = apiUrl('/api/features/effective');
  } catch {
    // Misconfigured base (e.g. EXPO_PUBLIC_API_URL unset / localhost on device).
    return {};
  }

  try {
    const headers = await governanceHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) return {};

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {};
    }

    const features = (body as { features?: unknown })?.features;
    if (!Array.isArray(features)) return {};

    const map: NativeEffectiveStateMap = {};
    for (const f of features) {
      if (isEffectiveState(f)) map[f.featureId] = f;
    }
    return map;
  } catch {
    return {};
  }
}
