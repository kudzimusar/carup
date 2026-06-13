import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthUser, UserRole } from '@shared/types';
import { fetchCsrfToken, getVerificationApiBaseUrl } from '../utils/verificationApi';

export interface RoleSwitchResult {
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
      // Use the configured backend (EXPO_PUBLIC_API_URL / ngrok), NOT a
      // hardcoded localhost — localhost is unreachable from a physical device.
      const baseUrl = getVerificationApiBaseUrl();
      const csrfToken = await fetchCsrfToken(baseUrl, current.token);
      const res = await fetch(`${baseUrl}/api/auth/switch-role`, {
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
      const updatedUser: AuthUser = {
        ...current.user,
        ...data.user,
        role,
        active_tenant_id: data.user?.active_tenant_id || tenantId || null,
      };

      await SecureStore.setItemAsync(SECURE_USER_KEY, JSON.stringify(updatedUser));
      if (data.token) {
        await SecureStore.setItemAsync(SECURE_TOKEN_KEY, data.token);
        set({ token: data.token });
      }
      set({ user: updatedUser });
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
}));
