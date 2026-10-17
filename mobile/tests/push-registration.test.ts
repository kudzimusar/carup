/**
 * OC-EXPO-02 — native push registration (npx tsx tests/push-registration.test.ts).
 *
 * Behavioural: drives the canonical registration logic with injected Expo/device/session doubles.
 * Static: proves the real wiring (app.json project id, the communicationApi route, start-up and
 * sign-out hooks).
 *
 * HONEST SCOPE: no native runtime runs here. A real permission prompt, a real Expo token and a real
 * delivery need a physical device and are NOT claimed by this file.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARUP_EAS_PROJECT_ID,
  __resetPushRegistrationForTest,
  ensurePushRegistration,
  registerDeviceForPush,
  releaseDeviceForPush,
  releasePushRegistration,
  type PushRegistrationDeps,
  type PushSession,
} from '../utils/pushRegistration';

const TOKEN = 'ExponentPushToken[oc-expo-02-mobile-test]';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

interface Recorder {
  deps: PushRegistrationDeps;
  calls: { requestPermission: number; getToken: string[]; register: unknown[]; revoke: unknown[] };
  session: PushSession;
}

function fakeDeps(over: Partial<PushRegistrationDeps> = {}, session: PushSession = { sessionToken: 'session-1', userId: 'user-a' }): Recorder {
  const calls = { requestPermission: 0, getToken: [] as string[], register: [] as unknown[], revoke: [] as unknown[] };
  const rec: Recorder = { calls, session, deps: undefined as unknown as PushRegistrationDeps };
  rec.deps = {
    isPhysicalDevice: () => true,
    platform: 'ios',
    configuredProjectId: () => CARUP_EAS_PROJECT_ID,
    getPermission: async () => ({ granted: true, canAskAgain: true }),
    requestPermission: async () => { calls.requestPermission += 1; return { granted: true }; },
    getExpoPushToken: async (projectId) => { calls.getToken.push(projectId); return TOKEN; },
    currentSession: () => rec.session,
    register: async (payload) => { calls.register.push(payload); return { created: true }; },
    revoke: async (payload) => { calls.revoke.push(payload); return { revoked: 1 }; },
    ...over,
  };
  return rec;
}

// A run that stops early — a hung promise lets the event loop drain and exit 0 — must not read as a
// pass. Only a run that reaches the end of main() may exit cleanly.
let completed = false;
process.on('exit', (code) => {
  if (!completed && code === 0) {
    console.error('[FAIL] the test run ended before every test completed');
    process.exitCode = 1;
  }
});

async function main() {
  console.log('\n=== OC-EXPO-02 NATIVE PUSH REGISTRATION ===\n');

  await test('a simulator or emulator registers nothing and never fabricates a token', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps({ isPhysicalDevice: () => false });
    assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'unsupported_device' });
    assert.equal(r.calls.getToken.length, 0);
    assert.equal(r.calls.register.length, 0);
  });

  await test('permission denied does not register (and is not re-asked when the OS says no)', async () => {
    __resetPushRegistrationForTest();
    const denied = fakeDeps({ getPermission: async () => ({ granted: false, canAskAgain: false }) });
    assert.deepEqual(await registerDeviceForPush(denied.deps), { state: 'permission_denied' });
    assert.equal(denied.calls.requestPermission, 0);
    assert.equal(denied.calls.getToken.length, 0);
    assert.equal(denied.calls.register.length, 0);

    __resetPushRegistrationForTest();
    const refusedPrompt = fakeDeps({
      getPermission: async () => ({ granted: false, canAskAgain: true }),
      requestPermission: async () => ({ granted: false }),
    });
    assert.deepEqual(await registerDeviceForPush(refusedPrompt.deps), { state: 'permission_denied' });
    assert.equal(refusedPrompt.calls.register.length, 0);
  });

  await test('an unauthenticated session does not register, or even ask for permission', async () => {
    for (const session of [{ sessionToken: null, userId: null }, { sessionToken: null, userId: 'user-a' }, { sessionToken: 'session-1', userId: null }]) {
      __resetPushRegistrationForTest();
      let asked = false;
      const r = fakeDeps({ getPermission: async () => { asked = true; return { granted: true, canAskAgain: true }; } }, session);
      assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'unauthenticated' });
      assert.equal(asked, false);
      assert.equal(r.calls.register.length, 0);
    }
  });

  await test(`the Expo token is requested with projectId ${CARUP_EAS_PROJECT_ID}`, async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps();
    await registerDeviceForPush(r.deps);
    assert.deepEqual(r.calls.getToken, ['f595b890-2227-4fcd-a718-d04093661654']);

    // A build whose constants report no project id still registers under the governed project —
    // never under whatever (or nothing) the runtime happens to expose.
    __resetPushRegistrationForTest();
    const unreported = fakeDeps({ configuredProjectId: () => null });
    await registerDeviceForPush(unreported.deps);
    assert.deepEqual(unreported.calls.getToken, ['f595b890-2227-4fcd-a718-d04093661654']);
  });

  await test('a build configured for a different EAS project refuses rather than registering under it', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps({ configuredProjectId: () => '00000000-0000-0000-0000-000000000000' });
    assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'project_misconfigured' });
    assert.equal(r.calls.getToken.length, 0);
  });

  await test('the returned Expo token is what is sent for registration — and nothing that names an account', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps();
    assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'registered', created: true });
    assert.deepEqual(r.calls.register, [{ expo_push_token: TOKEN, platform: 'ios' }]);
    const sent = JSON.stringify(r.calls.register[0]);
    assert.ok(!/user_id|tenant_id|userId/.test(sent), 'ownership comes from the session, never the payload');
  });

  await test('a malformed or missing token from the platform is not registered', async () => {
    for (const getExpoPushToken of [async () => 'not-a-token', async () => '', async () => { throw new Error('no network'); }]) {
      __resetPushRegistrationForTest();
      const r = fakeDeps({ getExpoPushToken });
      assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'token_unavailable' });
      assert.equal(r.calls.register.length, 0);
    }
  });

  await test('a session that changes while the token is fetched is not registered for the new account', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps();
    r.deps.getExpoPushToken = async () => { r.session = { sessionToken: 'session-2', userId: 'user-b' }; return TOKEN; };
    assert.deepEqual(await registerDeviceForPush(r.deps), { state: 'session_changed' });
    assert.equal(r.calls.register.length, 0);
  });

  await test('a registration failure is reported, never thrown — app start-up continues', async () => {
    __resetPushRegistrationForTest();
    const failing = fakeDeps({ register: async () => { throw Object.assign(new Error('HTTP 409'), { statusCode: 409 }); } });
    assert.deepEqual(await registerDeviceForPush(failing.deps), { state: 'registration_failed', statusCode: 409 });

    __resetPushRegistrationForTest();
    const unloadable = await ensurePushRegistration(async () => { throw new Error('expo-notifications unavailable'); });
    assert.deepEqual(unloadable, { state: 'registration_failed', statusCode: null });

    __resetPushRegistrationForTest();
    const throwingDevice = await ensurePushRegistration(async () => fakeDeps({ isPhysicalDevice: () => { throw new Error('boom'); } }).deps);
    assert.equal(throwingDevice.state, 'registration_failed');
  });

  await test('the same session registers once; a new session registers again', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps();
    await registerDeviceForPush(r.deps);
    await registerDeviceForPush(r.deps);
    assert.equal(r.calls.register.length, 1);
    r.session = { sessionToken: 'session-2', userId: 'user-a' };
    await registerDeviceForPush(r.deps);
    assert.equal(r.calls.register.length, 2);
  });

  await test('sign-out releases the device for the signed-in account, and the next account starts clean', async () => {
    __resetPushRegistrationForTest();
    const r = fakeDeps();
    await registerDeviceForPush(r.deps);
    assert.deepEqual(await releaseDeviceForPush(r.deps), { state: 'released' });
    assert.deepEqual(r.calls.revoke, [{ expo_push_token: TOKEN, reason: 'logout' }]);

    // A different account signs in on the same device: nothing of the previous session is reused.
    r.session = { sessionToken: 'session-b', userId: 'user-b' };
    await registerDeviceForPush(r.deps);
    assert.equal(r.calls.register.length, 2, 'the new account registers through the server, which decides');
  });

  await test('sign-out without a session, or on a device that cannot receive pushes, releases nothing', async () => {
    __resetPushRegistrationForTest();
    const signedOut = fakeDeps({}, { sessionToken: null, userId: null });
    assert.deepEqual(await releaseDeviceForPush(signedOut.deps), { state: 'nothing_to_release' });
    __resetPushRegistrationForTest();
    let asked = 0;
    const denied = fakeDeps({ getPermission: async () => ({ granted: false, canAskAgain: true }), requestPermission: async () => { asked += 1; return { granted: true }; } });
    assert.deepEqual(await releaseDeviceForPush(denied.deps), { state: 'nothing_to_release' });
    assert.equal(asked, 0, 'sign-out never prompts for permission');
    assert.equal(denied.calls.revoke.length, 0);
  });

  await test('sign-out release is bounded and never rejects', async () => {
    __resetPushRegistrationForTest();
    const hanging = fakeDeps({ revoke: () => new Promise(() => {}) });
    await registerDeviceForPush(hanging.deps);
    const started = Date.now();
    const result = await releasePushRegistration(async () => hanging.deps, 50);
    assert.deepEqual(result, { state: 'release_failed', statusCode: null });
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(await releasePushRegistration(async () => { throw new Error('unavailable'); }, 50), { state: 'release_failed', statusCode: null });
  });

  // ── the real wiring ──────────────────────────────────────────────────────────────────────────
  const appJson = JSON.parse(readFileSync(resolve('app.json'), 'utf8'));
  const utilFile = readFileSync(resolve('utils/pushRegistration.ts'), 'utf8');
  const apiFile = readFileSync(resolve('utils/communicationApi.ts'), 'utf8');
  const layoutFile = readFileSync(resolve('app/_layout.tsx'), 'utf8');
  const authFile = readFileSync(resolve('store/authStore.ts'), 'utf8');

  await test('app.json is configured for the governed EAS project and the notifications plugin', async () => {
    assert.equal(appJson.expo.extra.eas.projectId, CARUP_EAS_PROJECT_ID);
    assert.ok(appJson.expo.plugins.includes('expo-notifications'));
  });

  await test('the real token comes from getExpoPushTokenAsync({ projectId }) and goes through the canonical communicationApi', async () => {
    assert.ok(utilFile.includes('Notifications.getExpoPushTokenAsync({ projectId })'));
    assert.ok(utilFile.includes('Device.isDevice'));
    assert.ok(utilFile.includes("register: (payload) => api.registerPushDevice(payload)"));
    assert.ok(utilFile.includes("revoke: (payload) => api.revokePushDevice(payload)"));
    assert.ok(apiFile.includes("requestJson('/api/communications/push/devices', { method: 'POST'"));
    assert.ok(apiFile.includes("requestJson('/api/communications/push/devices/revoke', { method: 'POST'"));
    assert.ok(!/fetch\(/.test(utilFile), 'no second HTTP/auth stack');
  });

  await test('the raw token is never logged or persisted by the mobile client', async () => {
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(utilFile));
    assert.ok(!/SecureStore|AsyncStorage|localStorage/.test(utilFile));
  });

  await test('registration starts only after auth initialization, is not awaited, and sign-out releases first', async () => {
    assert.ok(layoutFile.includes('if (loading || !isAuthenticated || !sessionToken) return;'));
    assert.ok(layoutFile.includes('void ensurePushRegistration();'));
    assert.ok(!/await ensurePushRegistration/.test(layoutFile));
    const logout = authFile.slice(authFile.indexOf('logout: async () => {'));
    assert.ok(logout.indexOf('releasePushRegistration()') > -1);
    assert.ok(logout.indexOf('releasePushRegistration()') < logout.indexOf('SecureStore.deleteItemAsync(SECURE_TOKEN_KEY)'),
      'the device is released while the session still exists');
  });

  console.log('\nALL OC-EXPO-02 PUSH REGISTRATION TESTS PASSED');
  completed = true;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
