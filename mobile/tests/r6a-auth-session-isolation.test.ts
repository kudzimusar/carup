/**
 * OC-NATIVE-LR1-R6-A-R1 — native session termination + cross-account cache isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secureStore: new Map<string, string>(),
  events: [] as string[],
  flags: { failSecureDeletes: false },
  secureDelete: vi.fn(),
  verificationClear: vi.fn(),
  governanceRefresh: vi.fn(async () => undefined),
  releasePushRegistration: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => mocks.secureStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mocks.secureStore.set(key, value);
  }),
  deleteItemAsync: mocks.secureDelete,
}));

vi.mock('../store/verificationStore', () => ({
  useVerificationStore: {
    getState: () => ({ clear: mocks.verificationClear }),
  },
}));

vi.mock('../store/featureGovernanceStore', () => ({
  useFeatureGovernanceStore: {
    getState: () => ({ refresh: mocks.governanceRefresh }),
  },
}));

vi.mock('../utils/pushRegistration', () => ({
  releasePushRegistration: mocks.releasePushRegistration,
}));

import { queryClient } from '../utils/queryClient';
import { revokeCurrentServerSession } from '../utils/sessionLogout';
import { useAuthStore } from '../store/authStore';

const USER_A = { id: 'user-a', name: 'Account A', email: 'a@example.invalid', role: 'owner' } as any;
const USER_B = { id: 'user-b', name: 'Account B', email: 'b@example.invalid', role: 'owner' } as any;

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type FetchCall = { url: string; init?: RequestInit };

function stubBackend(overrides: {
  logoutStatus?: number;
  switchRoleBody?: unknown;
  tenantBody?: unknown;
  throwOnCsrf?: boolean;
} = {}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });

    if (href.includes('/api/security/csrf-token')) {
      mocks.events.push('csrf');
      if (overrides.throwOnCsrf) throw new Error('network down');
      return response(200, { csrfToken: 'csrf-r6a' });
    }
    if (href.includes('/api/auth/logout')) {
      mocks.events.push('logout-post');
      return response(overrides.logoutStatus ?? 200, { success: overrides.logoutStatus ? overrides.logoutStatus < 400 : true });
    }
    if (href.includes('/api/auth/switch-role')) {
      mocks.events.push('role-switch');
      return response(200, overrides.switchRoleBody ?? {
        token: 'token-a-role',
        user: { id: 'user-a', role: 'dealer', active_tenant_id: null, tenant_role: null },
      });
    }
    if (href.includes('/api/auth/active-tenant')) {
      mocks.events.push('tenant-switch');
      return response(200, overrides.tenantBody ?? {
        user: { active_tenant_id: 'tenant-2', tenant_role: 'dealer', tenant_context: 'selected' },
      });
    }
    return response(200, {});
  }));
  return calls;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test';
  vi.unstubAllGlobals();
  mocks.secureStore.clear();
  mocks.events.length = 0;
  mocks.flags.failSecureDeletes = false;

  mocks.secureDelete.mockReset();
  mocks.secureDelete.mockImplementation(async (key: string) => {
    mocks.events.push(`secure-delete:${key}`);
    if (mocks.flags.failSecureDeletes) throw new Error('secure store unavailable');
    mocks.secureStore.delete(key);
  });

  mocks.releasePushRegistration.mockReset();
  mocks.releasePushRegistration.mockImplementation(async () => {
    mocks.events.push('push-release');
    return { state: 'released' as const };
  });

  mocks.verificationClear.mockClear();
  mocks.governanceRefresh.mockClear();
  mocks.governanceRefresh.mockImplementation(async () => undefined);

  queryClient.clear();
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    loading: false,
  });
});

describe('current-session server logout', () => {
  it('POSTs the current-session endpoint with the presenting token only and never returns token material', async () => {
    const calls = stubBackend();
    const result = await revokeCurrentServerSession('secret-session-token', 100);

    expect(result).toEqual({ state: 'revoked' });
    expect(JSON.stringify(result)).not.toContain('secret-session-token');

    const post = calls.find((call) => call.url.includes('/api/auth/logout'))!;
    expect(post.init?.method).toBe('POST');
    const headers = post.init?.headers as Record<string, string>;
    expect(headers['x-session-token']).toBe('secret-session-token');
    expect(headers['x-user-id']).toBeUndefined();
    expect(post.init?.body).toBeUndefined();
  });

  it('reports bounded failure without exposing the credential', async () => {
    stubBackend({ throwOnCsrf: true });
    const result = await revokeCurrentServerSession('never-expose-me', 100);
    expect(result).toEqual({ state: 'failed', statusCode: null });
    expect(JSON.stringify(result)).not.toContain('never-expose-me');
  });
});

describe('logout identity boundary', () => {
  it('releases push, attempts server revocation while the token exists, then clears local auth + cache + PII state', async () => {
    const calls = stubBackend();
    mocks.secureStore.set('carup_secure_user', JSON.stringify(USER_A));
    mocks.secureStore.set('carup_secure_token', 'token-a');
    useAuthStore.setState({ user: USER_A, token: 'token-a', isAuthenticated: true });
    queryClient.setQueryData(['private', 'account'], { owner: 'A-only' });

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(queryClient.getQueryData(['private', 'account'])).toBeUndefined();
    expect(mocks.secureStore.has('carup_secure_user')).toBe(false);
    expect(mocks.secureStore.has('carup_secure_token')).toBe(false);
    expect(mocks.verificationClear).toHaveBeenCalledOnce();
    expect(mocks.governanceRefresh).toHaveBeenCalled();

    const post = calls.find((call) => call.url.includes('/api/auth/logout'));
    expect(post).toBeTruthy();
    expect(mocks.events.indexOf('push-release')).toBeLessThan(mocks.events.indexOf('logout-post'));
    expect(mocks.events.indexOf('logout-post')).toBeLessThan(mocks.events.findIndex((event) => event.startsWith('secure-delete:')));
  });

  it('always completes local sign-out when backend and SecureStore cleanup fail', async () => {
    stubBackend({ throwOnCsrf: true });
    mocks.flags.failSecureDeletes = true;
    useAuthStore.setState({ user: USER_A, token: 'token-a', isAuthenticated: true });
    queryClient.setQueryData(['private', 'account'], { owner: 'A-only' });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(queryClient.getQueryData(['private', 'account'])).toBeUndefined();
    expect(mocks.secureDelete).toHaveBeenCalledTimes(2);
    expect(mocks.verificationClear).toHaveBeenCalledOnce();
    expect(mocks.governanceRefresh).toHaveBeenCalled();
  });

  it('A logout -> anonymous -> B login cannot reuse A cached data', async () => {
    stubBackend();
    useAuthStore.setState({ user: USER_A, token: 'token-a', isAuthenticated: true });
    queryClient.setQueryData(['private', 'garage'], { owner: 'A-only' });

    await useAuthStore.getState().logout();
    expect(queryClient.getQueryData(['private', 'garage'])).toBeUndefined();

    await useAuthStore.getState().login(USER_B, 'token-b');
    expect(useAuthStore.getState().user?.id).toBe('user-b');
    expect(queryClient.getQueryData(['private', 'garage'])).toBeUndefined();
  });

  it('login itself is an identity boundary even without a preceding logout', async () => {
    queryClient.setQueryData(['private', 'messages'], { owner: 'old-account' });
    await useAuthStore.getState().login(USER_B, 'token-b');
    expect(queryClient.getQueryData(['private', 'messages'])).toBeUndefined();
  });
});

describe('role and tenant identity boundaries', () => {
  it('successful role switch clears incompatible cached data', async () => {
    stubBackend();
    useAuthStore.setState({ user: USER_A, token: 'token-a', isAuthenticated: true });
    queryClient.setQueryData(['private', 'role-dashboard'], { role: 'owner' });

    const result = await useAuthStore.getState().switchRole('dealer' as any);
    expect(result.ok).toBe(true);
    expect(queryClient.getQueryData(['private', 'role-dashboard'])).toBeUndefined();
    expect(useAuthStore.getState().token).toBe('token-a-role');
  });

  it('successful active-tenant switch clears incompatible cached data', async () => {
    stubBackend();
    useAuthStore.setState({ user: USER_A, token: 'token-a', isAuthenticated: true });
    queryClient.setQueryData(['private', 'tenant-ledger'], { tenant: 'tenant-1' });

    const result = await useAuthStore.getState().selectActiveTenant('tenant-2');
    expect(result.ok).toBe(true);
    expect(queryClient.getQueryData(['private', 'tenant-ledger'])).toBeUndefined();
    expect(useAuthStore.getState().user?.active_tenant_id).toBe('tenant-2');
  });
});
