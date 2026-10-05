/**
 * OC-EXPO-02 — the ONE way this app registers a device for push notifications.
 *
 *   authenticated session → notification permission → getExpoPushTokenAsync({ projectId })
 *   → POST /api/communications/push/devices (communicationApi: session + CSRF) → channel_identities
 *
 * Rules this file keeps:
 *   - a real physical device only. A simulator, an emulator or web says so and registers nothing;
 *     a token is never invented;
 *   - nothing happens without an authenticated session, and the server — not this file — decides
 *     which account the device belongs to;
 *   - permission denied is reported as denied, never retried behind the person's back;
 *   - the raw token is never logged and never persisted here. It lives in memory only, for as long
 *     as this session needs it to release the device at sign-out;
 *   - nothing here can block or break app start-up: every entry point resolves, never rejects.
 *
 * The Expo, device and session modules are injected (see `PushRegistrationDeps`), and the real
 * ones are loaded lazily by `loadDefaultDeps`, so the logic is testable without a native runtime.
 */
import type { PushDeviceRegistrationPayload, PushDeviceRevocationPayload } from './communicationApi';

/** The EAS project this app is built under (@kudzimusar/carup-mobile). */
export const CARUP_EAS_PROJECT_ID = 'f595b890-2227-4fcd-a718-d04093661654';

const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[^\s[\]]{1,230}\]$/;

export type PushRegistrationResult =
  | { state: 'registered'; created: boolean }
  | { state: 'unauthenticated' }
  | { state: 'unsupported_device' }
  | { state: 'permission_denied' }
  | { state: 'project_misconfigured' }
  | { state: 'token_unavailable' }
  | { state: 'session_changed' }
  | { state: 'registration_failed'; statusCode: number | null };

export type PushReleaseResult =
  | { state: 'released' }
  | { state: 'nothing_to_release' }
  | { state: 'release_failed'; statusCode: number | null };

export interface PushSession {
  sessionToken: string | null;
  userId: string | null;
}

export interface PushRegistrationDeps {
  isPhysicalDevice: () => boolean;
  platform: string;
  /** The project id the build itself was configured with (expo-constants), if it reports one. */
  configuredProjectId: () => string | null | undefined;
  getPermission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermission: () => Promise<{ granted: boolean }>;
  /** Android needs a notification channel before a token is requested. */
  prepareChannel?: () => Promise<void>;
  getExpoPushToken: (projectId: string) => Promise<string>;
  currentSession: () => PushSession;
  register: (payload: PushDeviceRegistrationPayload) => Promise<{ created?: boolean }>;
  revoke: (payload: PushDeviceRevocationPayload) => Promise<{ revoked?: number }>;
}

/** What this session registered. Memory only — never written to storage. */
let registeredForSession: { sessionToken: string; userId: string; expoPushToken: string } | null = null;

function statusCodeOf(error: unknown): number | null {
  const code = (error as { statusCode?: unknown })?.statusCode;
  return typeof code === 'number' ? code : null;
}

function sameSession(a: PushSession, b: PushSession): boolean {
  return Boolean(a.sessionToken) && a.sessionToken === b.sessionToken && a.userId === b.userId;
}

export async function registerDeviceForPush(deps: PushRegistrationDeps): Promise<PushRegistrationResult> {
  const session = deps.currentSession();
  if (!session.sessionToken || !session.userId) return { state: 'unauthenticated' };

  if (registeredForSession
    && registeredForSession.sessionToken === session.sessionToken
    && registeredForSession.userId === session.userId) {
    return { state: 'registered', created: false };
  }

  if (!deps.isPhysicalDevice()) return { state: 'unsupported_device' };

  const configured = deps.configuredProjectId();
  if (configured && configured !== CARUP_EAS_PROJECT_ID) return { state: 'project_misconfigured' };

  try {
    if (deps.prepareChannel) await deps.prepareChannel();
    let permission = await deps.getPermission();
    if (!permission.granted && permission.canAskAgain) {
      permission = { ...permission, granted: (await deps.requestPermission()).granted };
    }
    if (!permission.granted) return { state: 'permission_denied' };
  } catch {
    return { state: 'permission_denied' };
  }

  let expoPushToken: string;
  try {
    expoPushToken = await deps.getExpoPushToken(CARUP_EAS_PROJECT_ID);
  } catch {
    return { state: 'token_unavailable' };
  }
  if (typeof expoPushToken !== 'string' || !EXPO_PUSH_TOKEN.test(expoPushToken)) return { state: 'token_unavailable' };

  // The person may have signed out, or another account signed in, while the token was fetched. A
  // device is only ever registered for the session that asked.
  if (!sameSession(session, deps.currentSession())) return { state: 'session_changed' };

  try {
    const result = await deps.register({ expo_push_token: expoPushToken, platform: deps.platform });
    if (!sameSession(session, deps.currentSession())) return { state: 'session_changed' };
    registeredForSession = { sessionToken: session.sessionToken, userId: session.userId, expoPushToken };
    return { state: 'registered', created: Boolean(result?.created) };
  } catch (error) {
    return { state: 'registration_failed', statusCode: statusCodeOf(error) };
  }
}

/**
 * Release this device from the signed-in account, so the next person to sign in on it is not
 * refused — and is never routed the previous person's notifications. Called BEFORE the session is
 * cleared, because releasing needs that session.
 */
export async function releaseDeviceForPush(deps: PushRegistrationDeps): Promise<PushReleaseResult> {
  const session = deps.currentSession();
  const remembered = registeredForSession;
  registeredForSession = null;
  if (!session.sessionToken || !session.userId) return { state: 'nothing_to_release' };

  let expoPushToken = remembered && remembered.sessionToken === session.sessionToken && remembered.userId === session.userId
    ? remembered.expoPushToken
    : null;
  if (!expoPushToken) {
    // Registered in an earlier run of the app. Ask for the token again, but never ask for permission
    // at sign-out: a device that cannot receive pushes has nothing to release.
    try {
      if (!deps.isPhysicalDevice()) return { state: 'nothing_to_release' };
      if (!(await deps.getPermission()).granted) return { state: 'nothing_to_release' };
      const token = await deps.getExpoPushToken(CARUP_EAS_PROJECT_ID);
      expoPushToken = typeof token === 'string' && EXPO_PUSH_TOKEN.test(token) ? token : null;
    } catch {
      expoPushToken = null;
    }
    if (!expoPushToken) return { state: 'nothing_to_release' };
  }

  try {
    await deps.revoke({ expo_push_token: expoPushToken, reason: 'logout' });
    return { state: 'released' };
  } catch (error) {
    const statusCode = statusCodeOf(error);
    // 404: this account holds no registration for the device. Nothing is left to release.
    return statusCode === 404 ? { state: 'nothing_to_release' } : { state: 'release_failed', statusCode };
  }
}

export async function loadDefaultDeps(): Promise<PushRegistrationDeps> {
  const Notifications = await import('expo-notifications');
  const Device = await import('expo-device');
  const Constants = (await import('expo-constants')).default;
  const { Platform } = await import('react-native');
  const { useAuthStore } = await import('../store/authStore');
  const api = await import('./communicationApi');

  return {
    isPhysicalDevice: () => Device.isDevice === true && (Platform.OS === 'ios' || Platform.OS === 'android'),
    platform: Platform.OS,
    configuredProjectId: () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null,
    getPermission: async () => {
      const status = await Notifications.getPermissionsAsync();
      return { granted: status.granted, canAskAgain: status.canAskAgain };
    },
    requestPermission: async () => ({ granted: (await Notifications.requestPermissionsAsync()).granted }),
    prepareChannel: Platform.OS === 'android'
      ? async () => {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'CarUp',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      : undefined,
    getExpoPushToken: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
    currentSession: () => {
      const { token, user } = useAuthStore.getState();
      return { sessionToken: token ?? null, userId: user?.id ?? null };
    },
    register: (payload) => api.registerPushDevice(payload),
    revoke: (payload) => api.revokePushDevice(payload),
  };
}

const RELEASE_TIMEOUT_MS = 4000;

/** App start-up entry point. Never rejects; a failure leaves the app exactly as it was. */
export async function ensurePushRegistration(
  loadDeps: () => Promise<PushRegistrationDeps> = loadDefaultDeps,
): Promise<PushRegistrationResult> {
  try {
    return await registerDeviceForPush(await loadDeps());
  } catch {
    return { state: 'registration_failed', statusCode: null };
  }
}

/** Sign-out entry point. Never rejects, and never holds sign-out up for longer than a few seconds. */
export async function releasePushRegistration(
  loadDeps: () => Promise<PushRegistrationDeps> = loadDefaultDeps,
  timeoutMs = RELEASE_TIMEOUT_MS,
): Promise<PushReleaseResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PushReleaseResult>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'release_failed', statusCode: null }), timeoutMs);
  });
  try {
    const release = (async () => releaseDeviceForPush(await loadDeps()))()
      .catch((): PushReleaseResult => ({ state: 'release_failed', statusCode: null }));
    return await Promise.race([release, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    registeredForSession = null;
  }
}

/** Test seam: forget what this process registered. */
export function __resetPushRegistrationForTest(): void {
  registeredForSession = null;
}
