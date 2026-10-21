import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CARUP-MVP-STAB-01 F-015 / F-016 — bounded, truthful native start-up.
 *
 * Start-up read the saved session and asked /api/auth/me (and /api/features/effective) with no time
 * limit; Android's default HTTP client never times out, so a stalled network held the app on a
 * blank screen. Restoration is now a small state machine: confirmed → ready; refused (401/403) →
 * the session is cleared and the person is sent to Sign In; no answer → a recovery screen that keeps
 * the saved session and never shows a signed-in Home it could not confirm.
 */

const secureStore = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => void secureStore.set(key, value)),
  deleteItemAsync: vi.fn(async (key: string) => void secureStore.delete(key)),
}));

const USER = JSON.stringify({ id: 'u-restore-1', name: 'Restore Tester', role: 'owner' });

function respond(status: number, body: unknown = {}): Promise<Response> {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolvePromise = res;
  });
  return { promise, resolve: resolvePromise };
}

async function fresh() {
  vi.resetModules();
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test';
  const auth = await import('../store/authStore');
  const perf = await import('../utils/nativePerformance');
  return { auth, perf };
}

function storeSession(token = 'saved-token') {
  secureStore.set('carup_secure_user', USER);
  secureStore.set('carup_secure_token', token);
}

beforeEach(() => {
  secureStore.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bounded waits', () => {
  it('withTimeout settles with the promise and clears its timer', async () => {
    vi.useFakeTimers();
    const { perf } = await fresh();
    await expect(perf.withTimeout(Promise.resolve('ok'), 8000)).resolves.toBe('ok');
    await expect(perf.withTimeout(Promise.reject(new Error('boom')), 8000)).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('withTimeout rejects with a timeout error at the limit and runs the abort hook first', async () => {
    vi.useFakeTimers();
    const { perf } = await fresh();
    const onTimeout = vi.fn();
    const outcome = perf.withTimeout(new Promise(() => {}), 8000, onTimeout).catch((error) => error);
    await vi.advanceTimersByTimeAsync(7999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(perf.isNativeTimeoutError(error)).toBe(true);
    expect((error as { timeoutMs: number }).timeoutMs).toBe(8000);
  });

  it('fetchWithTimeout aborts the request and gives up even when fetch ignores the signal', async () => {
    vi.useFakeTimers();
    const { perf } = await fresh();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const outcome = perf.fetchWithTimeout(fetchImpl, 'https://staging.example.test/api/auth/me', { headers: { a: 'b' } }, 8000)
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect(perf.isNativeTimeoutError(await outcome)).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ headers: { a: 'b' } });
  });
});

describe('restoration state machine', () => {
  it('maps every restore result to exactly one next state', async () => {
    const { auth } = await fresh();
    expect(auth.restorationPhaseFor({ storedSession: false })).toBe('ready');
    expect(auth.restorationPhaseFor({ storedSession: true, validity: 'valid' })).toBe('ready');
    expect(auth.restorationPhaseFor({ storedSession: true, validity: 'invalid' })).toBe('session_ended');
    expect(auth.restorationPhaseFor({ storedSession: true, validity: 'unknown' })).toBe('recovery');
  });

  it('decides what the start-up screen shows', async () => {
    const { auth } = await fresh();
    expect(auth.startupScreenFor('restoring', false)).toBe('restoring');
    expect(auth.startupScreenFor('restoring', true)).toBe('restoring_slow');
    expect(auth.startupScreenFor('recovery', false)).toBe('recovery');
    expect(auth.startupScreenFor('recovery', true)).toBe('recovery');
    expect(auth.startupScreenFor('ready', true)).toBeNull();
    expect(auth.startupScreenFor('session_ended', false)).toBeNull();
    expect(auth.SESSION_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(7000);
    expect(auth.SESSION_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(9000);
    expect(auth.STARTUP_SLOW_NOTICE_MS).toBeLessThan(auth.SESSION_CHECK_TIMEOUT_MS);
  });
});

describe('initialize() — bounded session restoration', () => {
  it('a confirmed session is ready', async () => {
    storeSession('good-token');
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: { id: 'u-restore-1', role: 'owner' } })));
    const { auth } = await fresh();
    await auth.useAuthStore.getState().initialize();
    const state = auth.useAuthStore.getState();
    expect(state).toMatchObject({ restoration: 'ready', loading: false, isAuthenticated: true, token: 'good-token' });
  });

  it.each([401, 403])('a refused session (%s) is cleared and routed to Sign In once', async (status) => {
    storeSession('stale-token');
    vi.stubGlobal('fetch', vi.fn(() => respond(status)));
    const { auth } = await fresh();
    await auth.useAuthStore.getState().initialize();
    expect(auth.useAuthStore.getState()).toMatchObject({ restoration: 'session_ended', loading: false, isAuthenticated: false, token: null });
    expect(secureStore.has('carup_secure_token')).toBe(false);
    expect(secureStore.has('carup_secure_user')).toBe(false);
    auth.useAuthStore.getState().acknowledgeSessionEnded();
    expect(auth.useAuthStore.getState().restoration).toBe('ready');
  });

  it('no answer within the limit shows recovery, keeps the saved session and never opens a signed-in app', async () => {
    vi.useFakeTimers();
    storeSession('maybe-token');
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const { auth, perf } = await fresh();
    const restoring = auth.useAuthStore.getState().initialize();
    await vi.advanceTimersByTimeAsync(auth.SESSION_CHECK_TIMEOUT_MS - 1);
    expect(auth.useAuthStore.getState().restoration).toBe('restoring');
    await vi.advanceTimersByTimeAsync(1);
    await restoring;

    const state = auth.useAuthStore.getState();
    expect(state.restoration).toBe('recovery');
    // Unknown is not invalid: the saved session stays…
    expect(secureStore.get('carup_secure_token')).toBe('maybe-token');
    expect(state.token).toBe('maybe-token');
    expect(state.isAuthenticated).toBe(true);
    // …but the app is still restoring, so no signed-in screen or request proceeds on it.
    expect(state.loading).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(perf.getNativeStartupSummary('recovery_shown').auth_me).toEqual({ status: null, outcome: 'timeout' });

    // "Try again" re-runs the same bounded check.
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: { id: 'u-restore-1', role: 'owner' } })));
    await auth.useAuthStore.getState().initialize();
    expect(auth.useAuthStore.getState()).toMatchObject({ restoration: 'ready', loading: false, isAuthenticated: true });
  });

  it('a network failure or a server error is recovery too, not sign-out', async () => {
    for (const reply of [() => Promise.reject(new TypeError('Network request failed')), () => respond(503)]) {
      storeSession('maybe-token');
      vi.stubGlobal('fetch', vi.fn(reply));
      const { auth } = await fresh();
      await auth.useAuthStore.getState().initialize();
      expect(auth.useAuthStore.getState()).toMatchObject({ restoration: 'recovery', loading: true });
      expect(secureStore.get('carup_secure_token')).toBe('maybe-token');
    }
  });

  it('no saved session is ready at once, without asking the server', async () => {
    const fetchMock = vi.fn(() => respond(200));
    vi.stubGlobal('fetch', fetchMock);
    const { auth } = await fresh();
    await auth.useAuthStore.getState().initialize();
    expect(auth.useAuthStore.getState()).toMatchObject({ restoration: 'ready', loading: false, isAuthenticated: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a second tap on Try again while a check runs asks the server once', async () => {
    storeSession('good-token');
    const reply = deferred<Response>();
    const fetchMock = vi.fn(() => reply.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { auth } = await fresh();
    const first = auth.useAuthStore.getState().initialize();
    const second = auth.useAuthStore.getState().initialize();
    reply.resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a refusal while recovery is showing ends the session instead of leaving recovery up', async () => {
    storeSession('maybe-token');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Network request failed'))));
    const { auth } = await fresh();
    await auth.useAuthStore.getState().initialize();
    expect(auth.useAuthStore.getState().restoration).toBe('recovery');
    vi.stubGlobal('fetch', vi.fn(() => respond(200, {})));
    await auth.useAuthStore.getState().logout();
    expect(auth.useAuthStore.getState()).toMatchObject({ restoration: 'session_ended', loading: false, isAuthenticated: false });
  });

  it('records the restoration phases in order, with the server status', async () => {
    storeSession('stale-token');
    vi.stubGlobal('fetch', vi.fn(() => respond(401)));
    const { auth, perf } = await fresh();
    await auth.useAuthStore.getState().initialize();
    const phases = perf.getNativeStartupSummary('home_rendered').phases_ms;
    const order = ['process_start', 'securestore_read_start', 'securestore_read_end', 'auth_me_start', 'auth_me_end'] as const;
    for (const phase of order) expect(phases[phase], phase).toEqual(expect.any(Number));
    for (let index = 1; index < order.length; index += 1) {
      expect(phases[order[index]]!).toBeGreaterThanOrEqual(phases[order[index - 1]]!);
    }
    expect(perf.getNativeStartupSummary('home_rendered').auth_me).toEqual({ status: 401, outcome: 'invalid' });
  });
});

describe('feature access check — bounded and race-free', () => {
  async function freshGovernance() {
    vi.resetModules();
    process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test';
    const auth = await import('../store/authStore');
    const gov = await import('../store/featureGovernanceStore');
    const api = await import('../utils/featureGovernanceApi');
    return { auth, gov, api };
  }

  it('gives up after the limit as an ordinary (retryable) failure, not a sign-out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { api } = await freshGovernance();
    const outcome = api.fetchEffectiveStates();
    await vi.advanceTimersByTimeAsync(api.GOVERNANCE_FETCH_TIMEOUT_MS);
    const result = await outcome;
    expect(result.ok).toBe(false);
    expect((result as { unauthorized?: boolean }).unauthorized).toBeFalsy();
    expect((result as { timedOut?: boolean }).timedOut).toBe(true);
  });

  it('a slow answer for the previous identity never clears the newer request’s loading state', async () => {
    const replies: Array<ReturnType<typeof deferred<Response>>> = [];
    const fetchMock = vi.fn(() => {
      const reply = deferred<Response>();
      replies.push(reply);
      return reply.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { auth, gov } = await freshGovernance();
    auth.useAuthStore.setState({ user: null, token: null, isAuthenticated: false, loading: true });

    const anonymous = gov.useFeatureGovernanceStore.getState().refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    auth.useAuthStore.setState({ user: { id: 'u-1', role: 'owner' } as never, token: 'tok-1', isAuthenticated: true, loading: false });
    const signedIn = gov.useFeatureGovernanceStore.getState().refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    replies[0].resolve({ ok: true, status: 200, json: async () => ({ features: [] }) } as unknown as Response);
    await anonymous;
    expect(gov.useFeatureGovernanceStore.getState()).toMatchObject({ loading: true, loadedForKey: null });

    replies[1].resolve({
      ok: true,
      status: 200,
      json: async () => ({ features: [{ featureId: 'product.marketplace', state: 'active', enabled: true, visible: true, accessible: true, beta: false }] }),
    } as unknown as Response);
    await signedIn;
    expect(gov.useFeatureGovernanceStore.getState()).toMatchObject({ loading: false, error: false, loadedForKey: 'u-1|tok-1' });
    expect(Object.keys(gov.useFeatureGovernanceStore.getState().effectiveStates)).toEqual(['product.marketplace']);
  });
});

describe('the one start-up line', () => {
  it('records each phase once and writes exactly one structured line', async () => {
    const { perf } = await fresh();
    perf.resetNativeStartupMarks();
    const lines: Array<[string, string]> = [];
    const emit = (prefix: string, line: string) => lines.push([prefix, line]);
    perf.markStartupPhase('js_mounted', {}, emit);
    perf.markStartupPhase('securestore_read_start', {}, emit);
    perf.markStartupPhase('securestore_read_end', {}, emit);
    perf.markStartupPhase('auth_me_start', {}, emit);
    perf.markStartupPhase('auth_me_end', { status: 200, outcome: 'valid' }, emit);
    perf.markStartupPhase('auth_me_end', { status: 500, outcome: 'unknown' }, emit);
    perf.markStartupPhase('governance_start', {}, emit);
    perf.markStartupPhase('governance_end', { ok: true }, emit);
    perf.markStartupPhase('router_ready', {}, emit);
    expect(lines).toEqual([]);
    perf.markStartupPhase('home_rendered', {}, emit);
    perf.markStartupPhase('recovery_shown', {}, emit);
    expect(perf.emitStartupSummaryOnce('home_rendered', emit)).toBe(false);

    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toBe('[carup-startup]');
    const summary = JSON.parse(lines[0][1]);
    expect(summary).toMatchObject({ v: 1, trigger: 'home_rendered', auth_me: { status: 200, outcome: 'valid' }, governance_ok: true });
    expect(typeof summary.epoch_ms).toBe('number');
    expect(Object.keys(summary.phases_ms)).toEqual([
      'process_start', 'js_mounted', 'securestore_read_start', 'securestore_read_end', 'auth_me_start', 'auth_me_end',
      'governance_start', 'governance_end', 'router_ready', 'home_rendered',
    ]);
    expect(Object.keys(summary).sort()).toEqual(['auth_me', 'epoch_ms', 'governance_ok', 'phases_ms', 'trigger', 'v']);
  });

  it('writes through console.info by default and carries no identifying detail', async () => {
    const { perf } = await fresh();
    perf.resetNativeStartupMarks();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    perf.markStartupPhase('auth_me_end', { status: 401, outcome: 'User owner@example.com VIN-1' } as never);
    perf.markStartupPhase('recovery_shown');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe('[carup-startup]');
    const line = String(info.mock.calls[0][1]);
    expect(JSON.parse(line)).toMatchObject({ trigger: 'recovery_shown', auth_me: { status: 401, outcome: null } });
    expect(line).not.toMatch(/@|VIN|token/i);
  });
});

describe('source integration — what the person sees while CarUp starts', () => {
  const read = (file: string) => readFileSync(resolve(file), 'utf8');

  it('the root layout shows a branded start-up view, a slow notice and a recovery screen', () => {
    const root = read('app/_layout.tsx');
    expect(root).toContain('<CarUpWordmark tone="light" />');
    expect(root).toContain('Restoring your CarUp session');
    expect(root).toContain('Still connecting…');
    expect(root).toContain('Still connecting to CarUp');
    expect(root).toContain('label="Try again"');
    expect(root).toContain('backgroundColor: STARTUP_BACKGROUND');
    expect(root).toMatch(/const STARTUP_BACKGROUND = palette\.navy980;/);
    expect(root).toContain('startupScreenFor(restoration, slowRestore)');
    expect(root).toContain("markStartupPhase('js_mounted')");
    expect(root).toContain("markStartupPhase('router_ready')");
    expect(root).toContain("markStartupPhase('recovery_shown')");
    expect(root).toContain("signInHref({ reason: 'session_ended' })");
    // The light overlay with only a spinner is gone.
    expect(root).not.toMatch(/backgroundColor: theme\.background\.canvas,\s*justifyContent: 'center',\s*alignItems: 'center',\s*zIndex: 9999/);
  });

  it('Home marks itself rendered only once restoration has finished', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toMatch(/useEffect\(\(\) => \{\s*if \(!authLoading\) markStartupPhase\('home_rendered'\);\s*\}, \[authLoading\]\);/);
  });

  it('the screen boundary waits on the app canvas, not plain white', () => {
    const boundary = read('components/navigation/NativeFeatureBoundary.tsx');
    const loading = boundary.slice(boundary.indexOf('function LoadingView('), boundary.indexOf('function LoadingView(') + 600);
    expect(boundary.indexOf('function LoadingView(')).toBeGreaterThan(-1);
    expect(loading).toContain('backgroundColor: theme.background.canvas');
    expect(loading).toContain('color={theme.brand.primary}');
    expect(boundary.match(/<LoadingView \/>/g)).toHaveLength(2);
    expect(boundary).not.toMatch(/<View style=\{styles\.center\}>\s*<ActivityIndicator size="large" \/>/);
  });

  it('the native window before the app draws is CarUp navy, with no new image or dependency', () => {
    const app = JSON.parse(read('app.json')).expo;
    expect(app.splash).toEqual({ backgroundColor: '#050D16', resizeMode: 'contain' });
    expect(app.backgroundColor).toBe('#050D16');
    expect(app.android.adaptiveIcon.backgroundColor).toBe('#050D16');
    expect(JSON.stringify(app)).not.toMatch(/\.png|\.jpg|\.webp/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['expo-splash-screen']).toBeUndefined();
  });

  it('sign-in returns to a validated app path, and explains an ended session', () => {
    const login = read('app/(auth)/login.tsx');
    expect(login).toContain('signInReturnPathFromParam(params.returnTo)');
    expect(login).toContain('router.dismissTo(returnTo as never)');
    expect(login).toContain("router.replace('/(tabs)')");
    expect(login).toContain('Your session ended. Sign in again.');
  });
});
