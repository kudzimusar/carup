import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, UserRole } from '@shared/types';
import { withServerTenantContext } from '@shared/auth/sessionTenant';
import { apiUrl, resolveApiBaseUrl } from '../utils/apiBase';
import { fetchCsrfToken } from '../utils/verificationApi';

/**
 * Refresh governed feature states after an identity change (login/logout/role
 * switch). Lazy-imported to avoid a static import cycle between the auth store
 * and the governance store. Best-effort: failures are swallowed (the governance
 * store itself fails safe to static defaults).
 */
async function refreshFeatureGovernance(): Promise<void> {
  try {
    const { useFeatureGovernanceStore } = await import('./featureGovernanceStore');
    await useFeatureGovernanceStore.getState().refresh();
  } catch {
    /* fail-safe: static manifest defaults govern */
  }
}

export interface RoleSwitchResult {
  ok: boolean;
  error?: string;
}

/**
 * Classify a SAVED session token against the backend before trusting it.
 *  - 'valid'   → /api/auth/me accepted the token.
 *  - 'invalid' → 401/403: the token is stale/expired and MUST be purged
 *                (a restored dead session previously stranded the whole
 *                governed dashboard on "Temporarily unavailable").
 *  - 'unknown' → network/config/5xx: cannot judge; keep the session so the
 *                app still opens offline.
 */
export async function validateSessionToken(
  token: string,
  userId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<'valid' | 'invalid' | 'unknown'> {
  return (await readSessionUser(token, userId, fetchImpl)).validity;
}

/**
 * The same classification, plus the server's view of the user when the session is valid — so a
 * restored session adopts the server's answer about which organisation it acts for (OC-5D) instead of
 * whatever an older build stored. An unreadable body still counts as 'valid'; the user is then null.
 */
export async function readSessionUser(
  token: string,
  userId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ validity: 'valid' | 'invalid' | 'unknown'; user: Partial<AuthUser> | null }> {
  let url: string;
  try {
    url = apiUrl('/api/auth/me');
  } catch {
    return { validity: 'unknown', user: null };
  }
  try {
    const res = await fetchImpl(url, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'x-session-token': token,
        ...(userId ? { 'x-user-id': userId } : {}),
      },
    });
    if (res.ok) {
      let user: Partial<AuthUser> | null = null;
      try {
        const body = await res.json();
        user = body && typeof body.user === 'object' ? body.user : null;
      } catch {
        user = null;
      }
      return { validity: 'valid', user };
    }
    if (res.status === 401 || res.status === 403) return { validity: 'invalid', user: null };
    return { validity: 'unknown', user: null };
  } catch {
    return { validity: 'unknown', user: null };
  }
}

export interface TenantSelectionResult {
  ok: boolean;
  error?: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  initialize: () => Promise<void>;
  login: (user: AuthUser, token: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: UserRole, tenantId?: string) => Promise<RoleSwitchResult>;
  /**
   * OC-5D — choose the organisation this session acts for (null = yourself). The server verifies the
   * choice and records it on the session; nothing is ever chosen for the person.
   */
  selectActiveTenant: (tenantId: string | null) => Promise<TenantSelectionResult>;
}

const SECURE_USER_KEY = 'carup_secure_user';
const SECURE_TOKEN_KEY = 'carup_secure_token';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,

  initialize: async () => {
    try {
      const savedUserStr = await SecureStore.getItemAsync(SECURE_USER_KEY);
      const savedToken = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);

      if (savedUserStr && savedToken) {
        const savedUser = JSON.parse(savedUserStr) as AuthUser;
        // Session validation contract: never trust a restored token blindly.
        // A stale token used to restore a dead "signed-in" identity whose
        // every governed fetch 401'd — rendering the dashboard permanently
        // "Temporarily unavailable". Validate first; purge on 401/403; keep
        // only on confirmed-valid or unreachable-backend (offline tolerance).
        const { validity, user: serverUser } = await readSessionUser(savedToken, savedUser?.id);
        if (validity === 'invalid') {
          await SecureStore.deleteItemAsync(SECURE_USER_KEY);
          await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
          set({ user: null, token: null, isAuthenticated: false });
        } else {
          // OC-5D: the server's answer about the session's organisation replaces the stored one.
          const user = serverUser ? withServerTenantContext(savedUser, serverUser) : savedUser;
          if (user !== savedUser) await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(user));
          set({
            user,
            token: savedToken,
            isAuthenticated: true,
          });
        }
      }
    } catch (error) {
      console.error('Failed to initialize secure auth store:', error);
      // Clean up potentially corrupted records
      await SecureStore.deleteItemAsync(SECURE_USER_KEY);
      await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
    } finally {
      set({ loading: false });
    }
  },

  login: async (user: AuthUser, token: string) => {
    try {
      await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(user));
      await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
      set({
        user,
        token,
        isAuthenticated: true,
      });
      // Hydrate governed feature truth for the new identity.
      await refreshFeatureGovernance();
    } catch (error) {
      console.error('Failed to save secure login credentials:', error);
      throw error;
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(SECURE_USER_KEY);
      await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
      });
      // Clear sensitive in-memory verification state (captured ID document images + OCR PII)
      // so it cannot persist across a session change. Lazy-imported to avoid an import cycle.
      try {
        const { useVerificationStore } = await import('./verificationStore');
        useVerificationStore.getState().clear();
      } catch {
        // best-effort; never block logout on sensitive-state cleanup
      }
      // Drop any identity-specific governed state back to anonymous defaults.
      await refreshFeatureGovernance();
    } catch (error) {
      console.error('Failed to clear secure session credentials:', error);
    }
  },

  switchRole: async (role: UserRole, tenantId?: string): Promise<RoleSwitchResult> => {
    const current = get();
    if (!current.user || !current.token) {
      return { ok: false, error: 'Not signed in.' };
    }

    // Role switching is OPTIONAL convenience. It must never crash the app or
    // disable authenticated actions (e.g. Start Verification Flow). Failures are
    // returned to the caller as a non-blocking result, not thrown.
    try {
      // Routed through the canonical resolver so it can never reach a hardcoded
      // localhost, with the CSRF token the backend's global csrfMiddleware
      // requires on mutating routes.
      const csrfToken = await fetchCsrfToken(resolveApiBaseUrl(), current.token);
      const res = await fetch(apiUrl('/api/auth/switch-role'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'x-session-token': current.token,
          'x-user-id': current.user.id,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          userId: current.user.id,
          role,
          tenantId,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        return { ok: false, error: body.error || `Role switch failed (HTTP ${res.status}).` };
      }

      const data = await res.json();
      // The organisation is the one the SERVER verified for the new session — never the one the
      // client asked for (OC-5D: that fallback re-asserted an unverified tenant as x-tenant-id).
      const updatedUser: AuthUser = {
        ...withServerTenantContext(current.user, data.user ?? null),
        ...data.user,
        role,
        active_tenant_id: data.user?.active_tenant_id ?? null,
      };

      await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(updatedUser));
      if (data.token) {
        await SecureStore.setItemAsync(SECURE_TOKEN_KEY, data.token);
        set({ token: data.token });
      }
      set({ user: updatedUser });
      // Re-fetch governed feature truth for the newly active role/tenant.
      await refreshFeatureGovernance();
      return { ok: true };
    } catch (error: any) {
      // Non-blocking: warn (not error) so it doesn't surface as a red crash,
      // and surface the reason to the caller for a clear inline notice.
      const message = error?.message?.includes('EXPO_PUBLIC_API_URL')
        ? 'Role switch unavailable: backend URL is not configured for this device.'
        : 'Role switch unavailable: backend unreachable.';
      console.warn('Role switch failed:', error?.message || error);
      return { ok: false, error: message };
    }
  },

  selectActiveTenant: async (tenantId: string | null): Promise<TenantSelectionResult> => {
    const current = get();
    if (!current.user || !current.token) {
      return { ok: false, error: 'Not signed in.' };
    }
    try {
      const csrfToken = await fetchCsrfToken(resolveApiBaseUrl(), current.token);
      const res = await fetch(apiUrl('/api/auth/active-tenant'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'x-session-token': current.token,
          'x-user-id': current.user.id,
          'x-csrf-token': csrfToken,
          // Deliberately no x-tenant-id: this call CHANGES the organisation, it does not act for one.
        },
        body: JSON.stringify({ tenantId }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; user?: Partial<AuthUser> }));
      if (!res.ok) {
        return { ok: false, error: body?.error || `Could not change organisation (HTTP ${res.status}).` };
      }
      const latest = get();
      if (latest.token !== current.token || !latest.user) return { ok: false, error: 'Your session changed. Please try again.' };
      const updatedUser = withServerTenantContext(latest.user, body?.user ?? { active_tenant_id: null });
      await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(updatedUser));
      set({ user: updatedUser });
      await refreshFeatureGovernance();
      return { ok: true };
    } catch (error: any) {
      console.warn('Organisation selection failed:', error?.message || error);
      return { ok: false, error: 'Could not change organisation: backend unreachable.' };
    }
  },
}));
