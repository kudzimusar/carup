/**
 * OC-EXPO-02 — the real push path, end to end inside the backend:
 *
 *   authenticated session → POST /api/communications/push/devices → CommunicationIdentityService
 *   → channel_identities (push / expo_push / verified, owned by req.userContext.id)
 *   → canonical recipient resolution → ephemeral expo_push_token → ExpoPushAdapter.
 *
 * Nothing here calls Expo. The adapter is the REAL ExpoPushAdapter with a recording fetch and a
 * throwaway in-test env object; no EXPO_ACCESS_TOKEN is provisioned anywhere. Every token is an
 * obvious test literal, never a device token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { CommunicationPushDeviceService, isExpoPushToken } from '../services/communication/communicationPushDeviceService.js';
import { ExpoPushAdapter } from '../services/communication/adapters/providerAdapters.js';
import { RECIPIENT_RESOLUTION_REASONS, resolveNotificationRecipient } from '../services/communication/emailExperience/recipientResolution.js';

const { createCommunicationRouter } = await import('../routes/communicationRoutes.js');

const TOKEN_A = 'ExponentPushToken[oc-expo-02-test-device-a]';
const TOKEN_B = 'ExponentPushToken[oc-expo-02-test-device-b]';

function harness() {
  const repository = new MemoryCommunicationRepository();
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const pushDeviceService = new CommunicationPushDeviceService({ repository, identityService });
  return { repository, identityService, threadService, notificationService, pushDeviceService };
}

function routeHandlers(router, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.post);
  assert.ok(layer, `POST ${path} must exist`);
  return layer.route.stack.map((entry) => entry.handle);
}

/** Runs one handler with a fake request/response, resolving with the response or `next`. */
function run(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
      send(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    Promise.resolve(handler({ headers: {}, query: {}, params: {}, body: {}, ...req }, res, (error) => {
      if (error) reject(error);
      else resolve({ next: true });
    })).catch(reject);
  });
}

/** The route's own handler (after authorizeRole and requireProvenIdentity). */
async function post(services, path, { userContext, body }) {
  const handlers = routeHandlers(createCommunicationRouter({ services }), path);
  return run(handlers[handlers.length - 1], { userContext, body });
}

const sessionOf = (id, tenantId = null) => ({ id, tenantId, authenticationMethod: 'session' });

// ── A. the WHOLE route chain, real authorizeRole against a session store ──────────────────────

/** Runs every handler of the route in order, exactly as Express would, with a fresh request. */
function runChain(handlers, req) {
  return new Promise((resolve, reject) => {
    const request = { headers: {}, query: {}, params: {}, body: {}, ...req };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
      send(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    const step = (index) => {
      if (index >= handlers.length) return resolve({ statusCode: null, fellThrough: true });
      Promise.resolve(handlers[index](request, res, (error) => (error ? reject(error) : step(index + 1)))).catch(reject);
    };
    step(0);
  });
}

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

async function withSessionWorld(fn) {
  const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
  const { supabase } = await import('../db/supabase.js');
  const world = createSupabaseWorld({
    users: [
      { id: 'user-a', role: 'owner', is_verified: true },
      { id: 'user-b', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      { token: 'session-user-a', user_id: 'user-a', is_valid: true, expires_at: FUTURE },
    ],
  });
  const restore = installSupabaseWorld(supabase, world);
  try {
    return await fn();
  } finally {
    restore();
  }
}

const REGISTER = '/api/communications/push/devices';
const REVOKE = '/api/communications/push/devices/revoke';

for (const fallbackFlag of [undefined, 'true']) {
  const label = fallbackFlag ? 'even with CARUP_ALLOW_X_USER_ID_FALLBACK=true' : 'with the fallback flag unset';
  test(`A: a real session registers and revokes; x-user-id alone is refused on both routes — ${label}`, async () => {
    const previous = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    if (fallbackFlag) process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = fallbackFlag;
    else delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    try {
      await withSessionWorld(async () => {
        const services = harness();
        const router = createCommunicationRouter({ services });

        for (const path of [REGISTER, REVOKE]) {
          const asserted = await runChain(routeHandlers(router, path), {
            headers: { 'x-user-id': 'user-a' },
            body: { expo_push_token: TOKEN_A, user_id: 'user-a' },
          });
          assert.equal(asserted.statusCode, 401, `${path}: an x-user-id assertion must not authenticate`);
          assert.equal(asserted.body.error, 'Unauthorized. This action requires an authenticated session.');
        }
        assert.equal((await services.repository.list('channel_identities')).length, 0, 'nothing was written');

        const registered = await runChain(routeHandlers(router, REGISTER), {
          headers: { 'x-session-token': 'session-user-a' },
          body: { expo_push_token: TOKEN_A },
        });
        assert.equal(registered.statusCode, 201);
        assert.equal((await services.repository.list('channel_identities'))[0].user_id, 'user-a');

        const assertedRevoke = await runChain(routeHandlers(router, REVOKE), {
          headers: { 'x-user-id': 'user-a' },
          body: { expo_push_token: TOKEN_A },
        });
        assert.equal(assertedRevoke.statusCode, 401);
        assert.equal((await services.repository.list('channel_identities'))[0].consent_status, 'opted_in');

        const revoked = await runChain(routeHandlers(router, REVOKE), {
          headers: { 'x-session-token': 'session-user-a' },
          body: { expo_push_token: TOKEN_A },
        });
        assert.equal(revoked.statusCode, 200);
        assert.equal(revoked.body.revoked, 1);
        assert.equal((await services.repository.list('channel_identities'))[0].consent_status, 'revoked');

        const expired = await runChain(routeHandlers(router, REGISTER), {
          headers: { 'x-session-token': 'not-a-session' },
          body: { expo_push_token: TOKEN_B },
        });
        assert.equal(expired.statusCode, 401, 'an unknown session token is refused');
      });
    } finally {
      if (previous === undefined) delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
      else process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = previous;
    }
  });
}

test('A: both routes keep requireProvenIdentity as a second, independent refusal', async () => {
  for (const path of [REGISTER, REVOKE]) {
    const handlers = routeHandlers(createCommunicationRouter({ services: harness() }), path);
    assert.equal(handlers.length, 3, `${path}: session-only authorizeRole, requireProvenIdentity, handler`);
    const previous = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    try {
      const refused = await run(handlers[1], { userContext: { id: 'user-a', authenticationMethod: 'x-user-id-fallback' } });
      assert.equal(refused.statusCode, 401);
    } finally {
      if (previous !== undefined) process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = previous;
    }
  }
});

test('registration binds the token to req.userContext.id as a verified expo_push identity, and never echoes it', async () => {
  const services = harness();
  const response = await post(services, '/api/communications/push/devices', {
    userContext: sessionOf('user-a', 'tenant-1'),
    body: { expo_push_token: TOKEN_A, platform: 'ios', device_name: 'Test iPhone' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.registered, true);
  assert.equal(response.body.created, true);
  assert.ok(!JSON.stringify(response.body).includes(TOKEN_A), 'the response must not carry the token');

  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.user_id, 'user-a');
  // OC-EXPO-02R: the device identity is platform-scoped; the active tenant is audit metadata only.
  assert.equal(row.tenant_id, null);
  assert.equal(row.metadata.active_tenant_at_registration, 'tenant-1');
  assert.equal(row.channel, 'push');
  assert.equal(row.provider, 'expo_push');
  assert.equal(row.external_id, TOKEN_A);
  assert.equal(row.normalized_address, TOKEN_A);
  assert.equal(row.verified, true);
  assert.equal(row.consent_status, 'opted_in');
  assert.equal(row.metadata.platform, 'ios');
  assert.equal(response.body.identity.id, row.id);

  const audit = await services.repository.list('communication_audit_events');
  assert.ok(audit.length >= 1, 'registration is audited');
  assert.ok(!JSON.stringify(audit).includes(TOKEN_A), 'the audit trail must not carry the token');
});

test('a client-supplied user_id, tenant, channel, provider or verified flag cannot set ownership', async () => {
  const services = harness();
  const response = await post(services, '/api/communications/push/devices', {
    userContext: sessionOf('user-a'),
    body: {
      expo_push_token: TOKEN_A,
      user_id: 'user-attacker',
      recipient_user_id: 'user-attacker',
      tenant_id: 'tenant-attacker',
      channel: 'email',
      provider: 'sendgrid',
      verified: false,
      metadata: { user_id: 'user-attacker' },
    },
  });
  assert.equal(response.statusCode, 201);
  const [row] = await services.repository.list('channel_identities');
  assert.equal(row.user_id, 'user-a');
  assert.equal(row.tenant_id, null);
  assert.equal(row.channel, 'push');
  assert.equal(row.provider, 'expo_push');
  assert.equal(row.verified, true);
  assert.notEqual(row.metadata.user_id, 'user-attacker');
});

test('malformed or non-Expo tokens are rejected and nothing is written', async () => {
  const services = harness();
  const malformed = [
    undefined, null, 42, '', '   ', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]',
    'ExponentPushToken[abc', 'ExponentPushToken[[abc]]', 'xExponentPushToken[abc]',
    'FcmToken[abc]', '00000000-0000-0000-0000-000000000000', `ExponentPushToken[${'a'.repeat(400)}]`,
  ];
  for (const token of malformed) {
    const response = await post(services, '/api/communications/push/devices', {
      userContext: sessionOf('user-a'),
      body: { expo_push_token: token },
    });
    assert.equal(response.statusCode, 400, `${JSON.stringify(token)} must be rejected`);
    assert.equal(response.body.code, 'invalid_expo_push_token');
  }
  assert.equal((await services.repository.list('channel_identities')).length, 0);
  assert.equal(isExpoPushToken(TOKEN_A), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abc-123_X]'), true);
});

test('re-registering the same token for the same account is idempotent', async () => {
  const services = harness();
  const first = await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });
  const second = await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.identity.id, first.body.identity.id);
  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'user-a');
  assert.equal(rows[0].verified, true);
});

test('a token another account holds is refused, never moved — in any tenant scope', async () => {
  const services = harness();
  await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });

  const sameScope = await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-b'), body: { expo_push_token: TOKEN_A } });
  assert.equal(sameScope.statusCode, 409);
  assert.equal(sameScope.body.code, 'push_token_owned_by_another_account');

  const otherScope = await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-b', 'tenant-9'), body: { expo_push_token: TOKEN_A } });
  assert.equal(otherScope.statusCode, 409, 'a second tenant scope must not become a side door');

  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'user-a');
});

test('the identity service itself refuses an ownership move when asked to', async () => {
  const { identityService, repository } = harness();
  await identityService.resolveOrCreateIdentity({ channel: 'push', provider: 'expo_push', external_id: TOKEN_A, user_id: 'user-a', authenticated: true });
  await assert.rejects(
    identityService.resolveOrCreateIdentity({ channel: 'push', provider: 'expo_push', external_id: TOKEN_A, user_id: 'user-b', authenticated: true, refuse_owner_transfer: true }),
    (error) => error.code === 'IDENTITY_OWNER_CONFLICT',
  );
  assert.equal((await repository.list('channel_identities'))[0].user_id, 'user-a');
});

test('revocation marks the registration revoked and keeps the row; only then may another account claim the device', async () => {
  const services = harness();
  await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });

  const stranger = await post(services, '/api/communications/push/devices/revoke', { userContext: sessionOf('user-b'), body: { expo_push_token: TOKEN_A } });
  assert.equal(stranger.statusCode, 404, 'another account cannot revoke, and cannot learn the device is registered');
  assert.equal((await services.repository.list('channel_identities'))[0].consent_status, 'opted_in');

  const revoked = await post(services, '/api/communications/push/devices/revoke', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A, reason: 'logout' } });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.body.revoked, 1);
  let [row] = await services.repository.list('channel_identities');
  assert.equal(row.consent_status, 'revoked');
  assert.equal(row.user_id, 'user-a', 'revocation keeps provenance');
  assert.equal(row.metadata.revoked_reason, 'logout');

  const resolvedForA = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_user_id: 'user-a' }, repository: services.repository });
  assert.equal(resolvedForA.ok, false, 'a revoked registration routes nothing');

  const claimed = await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-b'), body: { expo_push_token: TOKEN_A } });
  assert.equal(claimed.statusCode, 200);
  [row] = await services.repository.list('channel_identities');
  assert.equal(row.user_id, 'user-b');
  assert.equal(row.consent_status, 'opted_in');
  const audit = await services.repository.list('communication_audit_events');
  assert.ok(audit.some((event) => event.metadata?.reassigned_from_released_owner === true), 'the hand-over is audited');
  assert.ok(!JSON.stringify(audit).includes(TOKEN_A));
});

// ── canonical recipient resolution ────────────────────────────────────────────────────────────

async function seedIdentity(repository, overrides = {}) {
  return repository.insert('channel_identities', {
    tenant_id: null,
    user_id: 'user-a',
    channel: 'push',
    provider: 'expo_push',
    external_id: TOKEN_A,
    normalized_address: TOKEN_A,
    verified: true,
    consent_status: 'opted_in',
    last_seen_at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  });
}

test('push resolves from the recipient\'s verified expo_push identity', async () => {
  const { repository } = harness();
  const identity = await seedIdentity(repository);
  const resolved = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_user_id: 'user-a' }, repository });
  assert.deepEqual(resolved, { ok: true, address: TOKEN_A, identityId: identity.id, userId: 'user-a', verified: true });
});

test('an unverified, revoked, opted-out, foreign-provider or other-user push identity is refused', async () => {
  for (const overrides of [
    { verified: false },
    { consent_status: 'revoked' },
    { consent_status: 'opted_out' },
    { provider: 'fcm' },
    { user_id: 'user-b' },
    { normalized_address: 'not-a-token' },
  ]) {
    const { repository } = harness();
    await seedIdentity(repository, overrides);
    const resolved = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_user_id: 'user-a' }, repository });
    assert.equal(resolved.ok, false, `${JSON.stringify(overrides)} must not resolve`);
    assert.equal(resolved.reason, RECIPIENT_RESOLUTION_REASONS.NO_VERIFIED_ADDRESS);
    assert.equal(resolved.address, undefined, 'a failure never carries an address');
  }
});

test('push with no registration fails closed, and a token on the payload is not accepted in its place', async () => {
  const { repository } = harness();
  const resolved = await resolveNotificationRecipient({
    notification: { channel: 'push', recipient_user_id: 'user-a', payload: { expo_push_token: TOKEN_B, push_token: TOKEN_B, address: TOKEN_B } },
    repository,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, RECIPIENT_RESOLUTION_REASONS.NO_VERIFIED_ADDRESS);

  const noRecipient = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_identity_id: 'x' }, repository });
  assert.equal(noRecipient.reason, RECIPIENT_RESOLUTION_REASONS.NO_RECIPIENT_REFERENCE);

  const failing = { list: async () => { throw new Error('db down'); } };
  const lookup = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_user_id: 'user-a' }, repository: failing });
  assert.equal(lookup.reason, RECIPIENT_RESOLUTION_REASONS.LOOKUP_FAILED);
});

test('of several devices, the most recently seen registration is used', async () => {
  const { repository } = harness();
  await seedIdentity(repository, { external_id: TOKEN_A, normalized_address: TOKEN_A, last_seen_at: '2026-10-01T00:00:00.000Z' });
  await seedIdentity(repository, { external_id: TOKEN_B, normalized_address: TOKEN_B, last_seen_at: '2026-10-05T00:00:00.000Z' });
  const resolved = await resolveNotificationRecipient({ notification: { channel: 'push', recipient_user_id: 'user-a' }, repository });
  assert.equal(resolved.address, TOKEN_B);
});

// ── delivery worker → ExpoPushAdapter ─────────────────────────────────────────────────────────

function expoRecorder({ ok = true, ticket = { status: 'ok', id: 'expo-ticket-1' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return {
      ok,
      status: ok ? 200 : 500,
      headers: { get: () => null },
      text: async () => JSON.stringify(ok ? { data: [ticket] } : { errors: [{ message: 'boom' }] }),
    };
  };
  return { calls, fetchImpl };
}

async function queuePush(services, { payload = {} } = {}) {
  const thread = (await services.threadService.resolveOrCreateThread({ primary_user_id: 'user-a', thread_type: 'support' })).thread;
  const { notification } = await services.notificationService.queueNotification({
    recipientUserId: 'user-a',
    thread,
    notificationType: 'message_acknowledgement',
    channel: 'push',
    templateKey: 'message_acknowledgement_v1',
    variables: { topic: 'push' },
    payload,
  });
  return notification;
}

function workerWith(services, adapter, notificationService = null) {
  return new CommunicationDeliveryWorker({
    repository: services.repository,
    adapterRegistry: { get: () => adapter, health: () => [] },
    notificationService,
  });
}

test('the worker hands the registered token to the real ExpoPushAdapter; the queued payload never needed one', async () => {
  const services = harness();
  await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });
  const notification = await queuePush(services);
  assert.equal(notification.payload?.expo_push_token, undefined, 'nothing pre-populated');

  const { calls, fetchImpl } = expoRecorder();
  const adapter = new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl });
  const result = await workerWith(services, adapter).deliverNotification(notification);

  assert.equal(result.status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(calls[0].body[0].to, TOKEN_A);
  assert.ok(!JSON.stringify(calls[0].body[0].data).includes(TOKEN_A), 'the device-bound data must not carry the token');

  const stored = await services.repository.findOne('notification_queue', { id: notification.id });
  assert.equal(stored.status, 'sent');
  assert.ok(!JSON.stringify(stored).includes(TOKEN_A), 'resolution must not write the token into notification_queue');
  assert.ok(!JSON.stringify(await services.repository.list('message_delivery_attempts')).includes(TOKEN_A));
  assert.ok(!JSON.stringify(await services.repository.list('communication_audit_events')).includes(TOKEN_A));
});

test('a token a producer stored on the payload is ignored: the registration decides, and it is not forwarded', async () => {
  const services = harness();
  await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });
  const notification = await queuePush(services, { payload: { expo_push_token: TOKEN_B, push_token: TOKEN_B } });
  const { calls, fetchImpl } = expoRecorder();
  await workerWith(services, new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl })).deliverNotification(notification);
  assert.equal(calls[0].body[0].to, TOKEN_A);
  assert.ok(!JSON.stringify(calls[0].body[0].data).includes(TOKEN_B));
});

test('push with no verified registration fails closed before any provider call', async () => {
  const services = harness();
  await seedIdentity(services.repository, { verified: false });
  const notification = await queuePush(services);
  const { calls, fetchImpl } = expoRecorder();
  const result = await workerWith(services, new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl })).deliverNotification(notification);
  assert.equal(result.status, 'dead_letter');
  assert.equal(calls.length, 0, 'the provider is never called');
  const stored = await services.repository.findOne('notification_queue', { id: notification.id });
  assert.equal(stored.last_error_code, `recipient_unresolved:${RECIPIENT_RESOLUTION_REASONS.NO_VERIFIED_ADDRESS}`);
});

test('a provider refusal hands the fallback orchestrator the stored notification, never the resolved token', async () => {
  const services = harness();
  await post(services, '/api/communications/push/devices', { userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } });
  const notification = await queuePush(services);
  const handedOver = [];
  const fallback = { queueNextFallback: async (row) => { handedOver.push(row); return { queued: false }; } };
  const { fetchImpl } = expoRecorder({ ticket: { status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } } });
  const result = await workerWith(services, new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl }), fallback).deliverNotification(notification);
  assert.equal(result.status, 'dead_letter');
  assert.equal(handedOver.length, 1);
  assert.ok(!JSON.stringify(handedOver[0]).includes(TOKEN_A), 'a fallback row copied from this one must not inherit the token');
  assert.ok(!JSON.stringify(await services.repository.findOne('notification_queue', { id: notification.id })).includes(TOKEN_A));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OC-EXPO-02R — B. platform-scope device identity
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('B: the same device and account under different active tenants is ONE platform-scoped identity', async () => {
  const services = harness();
  for (const tenantId of ['tenant-1', 'tenant-2', null, 'tenant-1']) {
    const response = await post(services, REGISTER, { userContext: sessionOf('user-a', tenantId), body: { expo_push_token: TOKEN_A } });
    assert.ok([200, 201].includes(response.statusCode));
  }
  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1, 'no per-tenant duplicates');
  assert.equal(rows[0].tenant_id, null);
  assert.equal(rows[0].user_id, 'user-a');
  assert.equal(rows[0].metadata.active_tenant_at_registration, 'tenant-1', 'the last active tenant, recorded for audit only');
});

test('B: an active token cannot move to another account, whatever tenant either session has selected', async () => {
  const services = harness();
  await post(services, REGISTER, { userContext: sessionOf('user-a', 'tenant-1'), body: { expo_push_token: TOKEN_A } });
  for (const tenantId of [null, 'tenant-1', 'tenant-2']) {
    const refused = await post(services, REGISTER, { userContext: sessionOf('user-b', tenantId), body: { expo_push_token: TOKEN_A } });
    assert.equal(refused.statusCode, 409);
  }
  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'user-a');
});

test('B: a legacy tenant-scoped registration still counts — it cannot be bypassed through the platform scope', async () => {
  const services = harness();
  // A row written before OC-EXPO-02R scoped device identities to the platform.
  await seedIdentity(services.repository, { tenant_id: 'tenant-legacy', user_id: 'user-a' });
  const refused = await post(services, REGISTER, { userContext: sessionOf('user-b'), body: { expo_push_token: TOKEN_A } });
  assert.equal(refused.statusCode, 409);
  const rows = await services.repository.list('channel_identities');
  assert.equal(rows.length, 1, 'no platform-scope twin was created for another account');
  assert.equal(rows[0].user_id, 'user-a');
});

test('B: two accounts racing for the same new token — exactly one wins, the other fails closed', async () => {
  const repository = new MemoryCommunicationRepository();
  // Hold both ownership pre-checks until BOTH have read "nobody owns this token", so the race is
  // decided where it must be: the platform-scope unique key and the identity service's refusal.
  const list = repository.list.bind(repository);
  let arrived = 0; let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  repository.list = async (table, filters = {}, options = {}) => {
    const rows = await list(table, filters, options);
    if (table === 'channel_identities' && filters.external_id === TOKEN_A && arrived < 2) {
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
    }
    return rows;
  };
  const identityService = new CommunicationIdentityService({ repository });
  const pushDeviceService = new CommunicationPushDeviceService({ repository, identityService });
  const outcomes = await Promise.allSettled([
    pushDeviceService.register({ userContext: sessionOf('user-a'), body: { expo_push_token: TOKEN_A } }),
    pushDeviceService.register({ userContext: sessionOf('user-b', 'tenant-9'), body: { expo_push_token: TOKEN_A } }),
  ]);
  assert.equal(arrived, 2, 'both pre-checks saw an unowned token');
  const won = outcomes.filter((o) => o.status === 'fulfilled');
  const lost = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, 'push_token_owned_by_another_account');
  assert.equal(lost[0].reason.statusCode, 409);
  const rows = await repository.list('channel_identities');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, null);
  assert.equal(rows[0].user_id, outcomes[0].status === 'fulfilled' ? 'user-a' : 'user-b');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OC-EXPO-02R — C. no producer can persist a push token
// ════════════════════════════════════════════════════════════════════════════════════════════════

const TOKEN_KEYS = ['expo_push_token', 'push_token', 'address', 'external_id', 'to'];
function assertNoToken(value, token, message) {
  assert.ok(!JSON.stringify(value ?? null).includes(token), message);
}

test('C: notification_queue\'s one insert door strips every push routing key from a push row, and only a push row', async () => {
  const services = harness();
  const thread = (await services.threadService.resolveOrCreateThread({ primary_user_id: 'user-a', thread_type: 'support' })).thread;
  const planted = { thread_id: thread.id, expo_push_token: TOKEN_A, push_token: TOKEN_A, address: TOKEN_A, external_id: TOKEN_A, to: TOKEN_A };
  const { notification } = await services.notificationService.queueNotification({
    recipientUserId: 'user-a', thread, notificationType: 'message_acknowledgement', channel: 'push',
    templateKey: 'message_acknowledgement_v1', variables: { topic: 'door' }, payload: planted,
  });
  const stored = await services.repository.findOne('notification_queue', { id: notification.id });
  for (const key of TOKEN_KEYS) assert.equal(stored.payload[key], undefined, `push row must not store ${key}`);
  assertNoToken(stored, TOKEN_A, 'the stored push row carries no token');
  assert.equal(stored.payload.thread_id, thread.id, 'non-routing payload survives');

  const { notification: sms } = await services.notificationService.queueNotification({
    recipientUserId: 'user-a', thread, notificationType: 'message_acknowledgement', channel: 'sms',
    templateKey: 'message_acknowledgement_v1', variables: { topic: 'door' }, payload: { phone_number: '+263770000001', address: '+263770000001' },
  });
  const storedSms = await services.repository.findOne('notification_queue', { id: sms.id });
  assert.equal(storedSms.payload.phone_number, '+263770000001', 'non-push routing is untouched');
  assert.equal(storedSms.payload.address, '+263770000001');
});

test('C: the campaign producer queues push by identity reference only — never the token', async () => {
  const { CommunicationCampaignService } = await import('../services/communication/communicationCampaignService.js');
  const permissive = { getPreferences: async () => ({}), isChannelAllowed: () => true };
  const make = async (rows) => {
    const repository = new MemoryCommunicationRepository();
    for (const row of rows) await repository.insert('channel_identities', row);
    return new CommunicationCampaignService({ repository, preferenceService: permissive });
  };
  const device = { tenant_id: null, user_id: 'user-a', channel: 'push', provider: 'expo_push', external_id: TOKEN_A, normalized_address: TOKEN_A, verified: true, consent_status: 'opted_in', last_seen_at: new Date().toISOString() };

  const service = await make([device]);
  const route = await service.resolveRecipient({ id: 'user-a' }, { id: 'c1', channel: 'push' });
  assert.equal(route.allowed, true);
  assert.equal(route.recipientUserId, 'user-a');
  assert.ok(route.recipientIdentityId);
  assert.equal(route.provider, 'expo_push');
  assert.deepEqual(route.payload, {});
  assertNoToken(route, TOKEN_A, 'the campaign route carries no token');

  for (const override of [{ verified: false }, { consent_status: 'revoked' }, { consent_status: 'opted_out' }, { provider: 'fcm' }]) {
    const refused = await (await make([{ ...device, ...override }])).resolveRecipient({ id: 'user-a' }, { id: 'c1', channel: 'push' });
    assert.equal(refused.allowed, false, `${JSON.stringify(override)} is not a governed push route`);
    assert.equal(refused.reason, 'no_governed_channel_identity');
  }

  const email = await (await make([{ ...device, channel: 'email', provider: 'resend', external_id: 'a@example.test', normalized_address: 'a@example.test' }]))
    .resolveRecipient({ id: 'user-a', email: 'a@example.test' }, { id: 'c1', channel: 'email' });
  assert.equal(email.payload.email, 'a@example.test', 'non-push campaign routing is untouched');
});

test('C: the admin reply producer references a push identity, never its token', async () => {
  const { deliveryPayloadForIdentity } = await import('../routes/adminCommunicationRoutes.js');
  const payload = deliveryPayloadForIdentity({ id: 'identity-1', channel: 'push', provider: 'expo_push', external_id: TOKEN_A, normalized_address: TOKEN_A });
  assert.deepEqual(payload, { external_identity_id: 'identity-1' });
  const whatsapp = deliveryPayloadForIdentity({ id: 'identity-2', channel: 'whatsapp', external_id: '263770000001', normalized_address: '263770000001' });
  assert.equal(whatsapp.phone_number, '263770000001', 'non-push admin routing is untouched');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OC-EXPO-02R — D. canonical push fallback, end to end through the production service graph
// ════════════════════════════════════════════════════════════════════════════════════════════════

async function fallbackWorld({ registerDevice = true } = {}) {
  const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
  const repository = new MemoryCommunicationRepository();
  const smsCalls = [];
  const sms = {
    channel: 'sms', provider: 'twilio',
    validateConfiguration: () => ({ available: true, mode: 'real', provider: 'twilio' }),
    send: async (input) => { smsCalls.push(input); return { accepted: false, retryable: false, errorCode: 'invalid_number', errorMessage: 'refused' }; },
  };
  const expo = expoRecorder();
  const push = new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl: expo.fetchImpl });
  const adapters = new Map([['sms', sms], ['push', push]]);
  const services = createCommunicationServices({ repository, adapterRegistry: { get: (c) => adapters.get(c), set: (c, a) => adapters.set(c, a), health: () => [] } });
  if (registerDevice) {
    await services.pushDeviceService.register({ userContext: sessionOf('user-a', 'tenant-1'), body: { expo_push_token: TOKEN_A } });
  }
  const thread = (await services.threadService.resolveOrCreateThread({ primary_user_id: 'user-a', thread_type: 'support', primary_channel: 'sms' })).thread;
  const message = await services.threadService.recordMessage(thread, {
    direction: 'outbound', channel: 'sms', content_text: 'Your CarUp request was updated.', status: 'queued', human_approved: true,
  });
  const queuePrimary = (payload = { phone_number: '+263770000001' }) => services.notificationService.queueExistingMessage({
    message, thread, recipientUserId: 'user-a', channel: 'sms', provider: 'twilio',
    notificationType: 'conversation_message', title: 'CarUp', transactional: true, classification: 'transactional',
    fallbackChannels: ['push'], humanApproved: true,
    dedupeParts: ['oc-expo-02r', message.id, 'sms'], payload,
  });
  return { services, repository, smsCalls, expo, queuePrimary };
}

test('D: primary fails → push fallback is selected → no row stores the token → the worker resolves it at dispatch → Expo receives it', async () => {
  const { services, repository, smsCalls, expo, queuePrimary } = await fallbackWorld();
  const { notification: primary } = await queuePrimary();

  const first = await services.deliveryWorker.deliverNotification(await repository.findOne('notification_queue', { id: primary.id }));
  assert.equal(smsCalls.length, 1, 'the primary really failed at its provider');
  assert.equal(first.status, 'fallback_queued');
  assert.equal(first.fallbackChannel, 'push');

  const fallback = await repository.findOne('notification_queue', { id: first.fallbackNotificationId });
  const identity = (await repository.list('channel_identities'))[0];
  assert.equal(fallback.channel, 'push');
  assert.equal(fallback.recipient_user_id, 'user-a');
  assert.equal(fallback.recipient_identity_id, identity.id, 'the durable reference is the identity, not its token');
  for (const key of TOKEN_KEYS) assert.equal(fallback.payload[key], undefined, `fallback row must not store ${key}`);
  assertNoToken(await repository.list('notification_queue'), TOKEN_A, 'neither the original nor the fallback row contains the token');
  assert.equal(expo.calls.length, 0, 'queueing the fallback calls nobody');

  const second = await services.deliveryWorker.deliverNotification(fallback);
  assert.equal(second.status, 'sent');
  assert.equal(expo.calls.length, 1);
  assert.equal(expo.calls[0].body[0].to, TOKEN_A, 'Expo receives the token resolved at dispatch');
  assertNoToken(expo.calls[0].body[0].data, TOKEN_A, 'the device-bound data carries no token');

  assertNoToken(await repository.list('notification_queue'), TOKEN_A, 'delivery wrote no token back into notification_queue');
  assertNoToken(await repository.list('message_delivery_attempts'), TOKEN_A, 'delivery attempts carry no token');
  assertNoToken(await repository.list('communication_audit_events'), TOKEN_A, 'the audit trail carries no token');
  assertNoToken(await repository.list('messages'), TOKEN_A, 'the canonical message carries no token');
});

test('D: without a governed registration, push fallback is skipped — a legacy token on the parent payload is not a route', async () => {
  const { services, repository, expo, queuePrimary } = await fallbackWorld({ registerDevice: false });
  const { notification: primary } = await queuePrimary({ phone_number: '+263770000001', push_token: TOKEN_B, expo_push_token: TOKEN_B });
  const result = await services.deliveryWorker.deliverNotification(await repository.findOne('notification_queue', { id: primary.id }));
  assert.equal(result.status, 'dead_letter');
  assert.equal((await repository.list('notification_queue', { channel: 'push' })).length, 0, 'no push fallback was queued');
  const skipped = (await repository.list('communication_audit_events')).find((e) => e.event_type === 'fallback_skipped' && e.channel === 'push');
  assert.ok(skipped, 'the skip is audited');
  assert.equal(expo.calls.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OC-EXPO-02R — E. the generic arbitrary-recipient smoke test refuses push
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('E: the generic provider smoke test refuses push by name, writes nothing, and still serves its other channels', async () => {
  const { sendProviderSmokeTest } = await import('../routes/adminCommunicationRoutes.js');
  const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
  const repository = new MemoryCommunicationRepository();
  const expo = expoRecorder();
  const smsSent = [];
  const adapters = new Map([
    ['push', new ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 'in-test-placeholder' }, fetchImpl: expo.fetchImpl })],
    ['sms', {
      channel: 'sms', provider: 'twilio',
      validateConfiguration: () => ({ available: true, mode: 'real', provider: 'twilio' }),
      send: async (input) => { smsSent.push(input); return { accepted: true, providerMessageId: 'SM-test-1', providerRequestId: 'SM-test-1', providerStatus: 'accepted' }; },
    }],
  ]);
  const services = createCommunicationServices({ repository, adapterRegistry: { get: (c) => adapters.get(c), set: (c, a) => adapters.set(c, a), health: () => [] } });

  for (const channel of ['push', 'PUSH', ' push ']) {
    await assert.rejects(
      sendProviderSmokeTest({ services, channel, to: TOKEN_A, actor: { id: 'admin-1' } }),
      (error) => error.code === 'push_smoke_test_refused' && error.statusCode === 400,
      `${JSON.stringify(channel)} must be refused explicitly`,
    );
  }
  assert.equal(expo.calls.length, 0, 'Expo is never called');
  assert.equal((await repository.list('channel_identities')).length, 0, 'no identity is minted from an arbitrary token');
  assert.equal((await repository.list('notification_queue')).length, 0);

  const sms = await sendProviderSmokeTest({ services, channel: 'sms', to: '+263770000001', actor: { id: 'admin-1' } });
  assert.equal(sms.ok, true, 'accepted non-push channels still work');
  assert.equal(smsSent.length, 1);
});
