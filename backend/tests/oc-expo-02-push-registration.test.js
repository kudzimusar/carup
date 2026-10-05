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

test('the push device routes require a proven session: an asserted x-user-id identity is refused', async () => {
  const services = harness();
  const previous = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  try {
    for (const path of ['/api/communications/push/devices', '/api/communications/push/devices/revoke']) {
      const handlers = routeHandlers(createCommunicationRouter({ services }), path);
      assert.equal(handlers.length, 3, `${path}: authorizeRole, requireProvenIdentity, handler`);
      const refused = await run(handlers[1], { userContext: { id: 'user-a', authenticationMethod: 'x-user-id-fallback' } });
      assert.equal(refused.statusCode, 401, `${path} must refuse an asserted identity`);
      const allowed = await run(handlers[1], { userContext: sessionOf('user-a') });
      assert.equal(allowed.next, true, `${path} must admit a real session`);
    }
  } finally {
    if (previous === undefined) delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    else process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = previous;
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
  assert.equal(row.tenant_id, 'tenant-1');
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
