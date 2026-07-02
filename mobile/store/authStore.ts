import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, UserRole } from '@shared/types';
import { apiUrl } from '../utils/apiBase';

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

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  initialize: () => Promise<void>;
  login: (user: AuthUser, token: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: UserRole, tenantId?: string) => Promise<void>;
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
        set({
          user: savedUser,
          token: savedToken,
          isAuthenticated: true,
        });
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

  switchRole: async (role: UserRole, tenantId?: string) => {
    const current = get();
    if (!current.user || !current.token) return;

    try {
      // Trigger backend call (matching web switch-role endpoint). Routed through
      // the canonical resolver so it can never reach a hardcoded localhost.
      const res = await fetch(apiUrl('/api/auth/switch-role'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': current.token,
        },
        body: JSON.stringify({
          userId: current.user.id,
          role,
          tenantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const updatedUser: AuthUser = {
          ...current.user,
          ...data.user,
          role,
          active_tenant_id: data.user.active_tenant_id || tenantId || null,
        };

        await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(updatedUser));
        if (data.token) {
          await SecureStore.setItemAsync(SECURE_TOKEN_KEY, data.token);
          set({ token: data.token });
        }
        set({ user: updatedUser });
        // Re-fetch governed feature truth for the newly active role/tenant.
        await refreshFeatureGovernance();
      } else {
        console.error('Failed backend role switch status:', res.status);
      }
    } catch (error) {
      console.error('Dynamic role switch failed:', error);
    }
  },
}));
