import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, UserRole } from '@shared/types';
import { withServerTenantContext } from '@shared/auth/sessionTenant';
import { apiUrl, resolveApiBaseUrl } from '../utils/apiBase';
import { fetchCsrfToken } from '../utils/verificationApi';
import { clearIdentityQueryCache } from '../utils/queryClient';
import { revokeCurrentServerSession } from '../utils/sessionLogout';
import { fetchWithTimeout, isNativeTimeoutError, markStartupPhase } from '../utils/nativePerformance';

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

export type SessionValidity = 'valid' | 'invalid' | 'unknown';

/**
 * CARUP-MVP-STAB-01 F-015: how long start-up waits for /api/auth/me before treating the answer as
 * unknown. Android's default HTTP client never times out on its own.
 */
export const SESSION_CHECK_TIMEOUT_MS = 8000;
/** After this long the start-up screen says it is still connecting (before the hard limit). */
export const STARTUP_SLOW_NOTICE_MS = 6000;

/**
 * Where session restoration stands:
 *  - 'restoring'     reading the saved session and asking CarUp about it;
 *  - 'ready'         confirmed, or nothing saved — the app proceeds;
 *  - 'session_ended' CarUp refused the saved session: it is cleared and Sign In opens once;
 *  - 'recovery'      CarUp did not answer: the saved session is kept (unknown is not invalid) and
 *                    a recovery screen offers Try again — never a signed-in Home it could not confirm.
 */
export type SessionRestoration = 'restoring' | 'ready' | 'session_ended' | 'recovery';

export function restorationPhaseFor(result: { storedSession: boolean; validity?: SessionValidity }): Exclude<SessionRestoration, 'restoring'> {
  if (!result.storedSession) return 'ready';
  if (result.validity === 'valid') return 'ready';
  if (result.validity === 'invalid') return 'session_ended';
  return 'recovery';
}

export type StartupScreen = 'restoring' | 'restoring_slow' | 'recovery';

/** What the root start-up view shows; null once the app itself can show. */
export function startupScreenFor(restoration: SessionRestoration, slow: boolean): StartupScreen | null {
  if (restoration === 'restoring') return slow ? 'restoring_slow' : 'restoring';
  if (restoration === 'recovery') return 'recovery';
  return null;
}

/**
 * Classify a SAVED session token against the backend before trusting it.
 *  - 'valid'   → /api/auth/me accepted the token.
 *  - 'invalid' → 401/403: the token is stale/expired and MUST be purged
 *                (a restored dead session previously stranded the whole
 *                governed dashboard on "Temporarily unavailable").
 *  - 'unknown' → network/config/5xx/timeout: cannot judge; keep the saved session.
 */
export async function validateSessionToken(
  token: string,
  userId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionValidity> {
  return (await readSessionUser(token, userId, fetchImpl)).validity;
}

export interface SessionUserRead {
  validity: SessionValidity;
  user: Partial<AuthUser> | null;
  /** The HTTP status CarUp answered, or null when there was no answer. */
  status: number | null;
  /** Why the answer is unknown when there was none. */
  failure: 'timeout' | 'network' | 'config' | null;
}

/**
 * The same classification, plus the server's view of the user when the session is valid — so a
 * restored session adopts the server's answer about which organisation it acts for (OC-5D) instead of
 * whatever an older build stored. An unreadable body still counts as 'valid'; the user is then null.
 * The request is abandoned after `timeoutMs` (CARUP-MVP-STAB-01 F-015).
 */
export async function readSessionUser(
  token: string,
  userId: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SESSION_CHECK_TIMEOUT_MS,
): Promise<SessionUserRead> {
  let url: string;
  try {
    url = apiUrl('/api/auth/me');
  } catch {
    return { validity: 'unknown', user: null, status: null, failure: 'config' };
  }
  try {
    const res = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'x-session-token': token,
        ...(userId ? { 'x-user-id': userId } : {}),
      },
    }, timeoutMs);
    if (res.ok) {
      let user: Partial<AuthUser> | null = null;
      try {
        const body = await res.json();
        user = body && typeof body.user === 'object' ? body.user : null;
      } catch {
        user = null;
      }
      return { validity: 'valid', user, status: res.status, failure: null };
    }
    if (res.status === 401 || res.status === 403) return { validity: 'invalid', user: null, status: res.status, failure: null };
    return { validity: 'unknown', user: null, status: res.status, failure: null };
  } catch (error) {
    return { validity: 'unknown', user: null, status: null, failure: isNativeTimeoutError(error) ? 'timeout' : 'network' };
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
  /** True until restoration reaches 'ready' or 'session_ended' (it stays true during 'recovery'). */
  loading: boolean;
  restoration: SessionRestoration;
  /** Restore the saved session (also "Try again" on the recovery screen); one check at a time. */
  initialize: () => Promise<void>;
  /** The root layout opened Sign In for an ended session; do not open it again. */
  acknowledgeSessionEnded: () => void;
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

let restoreInFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: true,
  restoration: 'restoring',

  initialize: () => {
    if (restoreInFlight) return restoreInFlight;
    restoreInFlight = (async () => {
      set({ loading: true, restoration: 'restoring' });
      try {
        markStartupPhase('securestore_read_start');
        const savedUserStr = await SecureStore.getItemAsync(SECURE_USER_KEY);
        const savedToken = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
        markStartupPhase('securestore_read_end');

        if (!savedUserStr || !savedToken) {
          set({ loading: false, restoration: restorationPhaseFor({ storedSession: false }) });
          return;
        }

        const savedUser = JSON.parse(savedUserStr) as AuthUser;
        // Session validation contract: never trust a restored token blindly.
        // A stale token used to restore a dead "signed-in" identity whose
        // every governed fetch 401'd — rendering the dashboard permanently
        // "Temporarily unavailable". Validate first (bounded); purge on 401/403;
        // keep the saved session when CarUp gives no answer, but do not open the
        // app on it until CarUp confirms it (CARUP-MVP-STAB-01 F-015).
        markStartupPhase('auth_me_start');
        const { validity, user: serverUser, status, failure } = await readSessionUser(savedToken, savedUser?.id);
        markStartupPhase('auth_me_end', { status, outcome: failure ?? validity });
        const restoration = restorationPhaseFor({ storedSession: true, validity });

        if (validity === 'invalid') {
          await Promise.allSettled([
            SecureStore.deleteItemAsync(SECURE_USER_KEY),
            SecureStore.deleteItemAsync(SECURE_TOKEN_KEY),
          ]);
          set({ user: null, token: null, isAuthenticated: false, loading: false, restoration });
        } else if (validity === 'valid') {
          // OC-5D: the server's answer about the session's organisation replaces the stored one.
          const user = serverUser ? withServerTenantContext(savedUser, serverUser) : savedUser;
          if (user !== savedUser) await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(user));
          set({
            user,
            token: savedToken,
            isAuthenticated: true,
            loading: false,
            restoration,
          });
        } else {
          // Unknown is not invalid: keep the saved session, and keep `loading` so no screen acts on
          // it while the recovery screen offers Try again.
          set({
            user: savedUser,
            token: savedToken,
            isAuthenticated: true,
            loading: true,
            restoration,
          });
        }
      } catch (error) {
        console.error('Failed to initialize secure auth store:', error);
        // Clean up potentially corrupted records
        await Promise.allSettled([
          SecureStore.deleteItemAsync(SECURE_USER_KEY),
          SecureStore.deleteItemAsync(SECURE_TOKEN_KEY),
        ]);
        set({ user: null, token: null, isAuthenticated: false, loading: false, restoration: 'ready' });
      }
    })().finally(() => {
      restoreInFlight = null;
    });
    return restoreInFlight;
  },

  acknowledgeSessionEnded: () => {
    if (get().restoration === 'session_ended') set({ restoration: 'ready' });
  },

  login: async (user: AuthUser, token: string) => {
    try {
      await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(user));
      await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
      // A new authenticated authority must never inherit the previous process cache.
      clearIdentityQueryCache();
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
    const currentToken = get().token;

    // Preserve the existing push-registration release while the session is still valid. It is
    // intentionally attempted before server logout because the release endpoint needs this token.
    try {
      const { releasePushRegistration } = await import('../utils/pushRegistration');
      await releasePushRegistration();
    } catch {
      // never block sign-out on push cleanup
    }

    // Terminate only the presenting backend session while its credential still exists locally.
    // This call is bounded and returns diagnostics without credential material. A backend/network
    // failure must never trap the person signed in on this device.
    if (currentToken) {
      try {
        await revokeCurrentServerSession(currentToken);
      } catch {
        // defense in depth: local sign-out remains authoritative for this device
      }
    }

    // SecureStore failures are best-effort cleanup failures, never permission to keep the in-memory
    // identity alive. Attempt both deletions independently, then cross the local identity boundary.
    await Promise.allSettled([
      SecureStore.deleteItemAsync(SECURE_USER_KEY),
      SecureStore.deleteItemAsync(SECURE_TOKEN_KEY),
    ]);

    clearIdentityQueryCache();
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
    // CarUp refused the saved session while the recovery screen was up (the feature check answered
    // 401/403): that is an ended session, so leave recovery and open Sign In.
    if (get().restoration === 'recovery') set({ loading: false, restoration: 'session_ended' });

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
      }
      // Role/tenant authority changed: discard every query from the prior context before exposing
      // the updated identity to subscribers.
      clearIdentityQueryCache();
      set({
        user: updatedUser,
        ...(data.token ? { token: data.token } : {}),
      });
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
      // A verified organisation switch is an identity-authority boundary for cached data.
      clearIdentityQueryCache();
      set({ user: updatedUser });
      await refreshFeatureGovernance();
      return { ok: true };
    } catch (error: any) {
      console.warn('Organisation selection failed:', error?.message || error);
      return { ok: false, error: 'Could not change organisation: backend unreachable.' };
    }
  },
}));
