/**
 * OC-5G — `policyChannelsOnly` is enforced by the notification path that actually runs.
 *
 * Every in-app-only policy declares `channels: ['in_app'], fallbackChannels: [], policyChannelsOnly:
 * true`, and four suites pin those DECLARATIONS ("a user preference cannot widen it into an external
 * send"). None proved the live path enforced them, and it did not: the factory wires
 * CommunicationProductNotificationService → CommunicationCanonicalNotificationService, whose
 * reimplemented queueFromDomainEvent took the preference route as given. Only the unused base class
 * applied the cap. So an in-app-only notice went out on email to anyone who preferred email, and the
 * DEFAULT preferences queued email and push as its fallbacks.
 *
 * Proven through createCommunicationServices — the wiring, not the class — over every capped policy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');

const CAPPED = Object.entries(NOTIFICATION_POLICIES).filter(([, policy]) => policy.policyChannelsOnly);
const EVERY_EXTERNAL = {
  email_enabled: true, push_enabled: true, sms_enabled: true, whatsapp_enabled: true, telegram_enabled: true,
};

/** The live services over a governed registry that approves every policy key on every channel, so
 *  only ROUTING decides where a notice goes. */
function liveServices(preferences = []) {
  const keys = [...new Set(Object.values(NOTIFICATION_POLICIES).map((policy) => policy.templateKey))];
  const repository = new MemoryCommunicationRepository({
    communication_templates: keys.map((key) => ({
      id: `tpl-${key}`, template_key: key, business_workflow: 'oc5g', stakeholder_audience: 'recipient',
      classification: 'transactional', status: 'active',
    })),
    communication_template_versions: keys.map((key) => ({
      id: `ver-${key}`, template_id: `tpl-${key}`, version: 1, channel: 'default', language: 'en',
      subject_template: `Subject ${key}`, body_template: `Body ${key}`,
      required_variables: [], optional_variables: [], approval_status: 'approved', provider_template_reference: null,
    })),
    communication_preferences: preferences,
  });
  return { repository, services: createCommunicationServices({ repository }) };
}

const prefs = (userId, overrides) => ({ id: `pref-${userId}`, user_id: userId, tenant_id: null, ...overrides });
const event = (type, userId, n = 1) => ({
  id: `evt-${type}-${userId}-${n}`, event_type: type,
  payload: { recipientUserId: userId, vin: 'OC5GVIN0000000001', listingId: 'OC5GVIN0000000001', decision: 'approve', sessionId: 'sess-1' },
});
const routingOf = (queued) => queued.map(({ notification }) => ({
  channel: notification.channel,
  fallback: notification.payload?.communication_routing?.fallback_channels || [],
}));

test('the factory runs the class this test exercises (wiring, not a sibling class)', () => {
  const { services } = liveServices();
  assert.equal(services.notificationService.constructor.name, 'CommunicationProductNotificationService');
  assert.ok(CAPPED.length >= 10, `expected the in-app-only policies to be found; got ${CAPPED.length}`);
});

test('the DEFAULT preferences no longer queue email and push behind an in-app-only notice', async () => {
  const { services } = liveServices();
  const queued = await services.notificationService.queueFromDomainEvent(event('identity.verification.decided', 'user-default'));
  assert.deepEqual(routingOf(queued), [{ channel: 'in_app', fallback: [] }]);
});

test('a person who prefers email still receives an in-app-only notice in app, and nowhere else', async () => {
  const { services } = liveServices([prefs('user-email', { preferred_channel: 'email', ...EVERY_EXTERNAL, fallback_channels: ['email', 'push', 'sms'] })]);
  const queued = await services.notificationService.queueFromDomainEvent(event('seller.authority.decided', 'user-email'));
  assert.deepEqual(routingOf(queued), [{ channel: 'in_app', fallback: [] }]);
});

test('every capped policy stays inside its own channels, whatever the person prefers', async () => {
  for (const preferred of ['email', 'whatsapp', 'sms', 'push', 'telegram']) {
    const userId = `user-${preferred}`;
    const { services } = liveServices([prefs(userId, { preferred_channel: preferred, ...EVERY_EXTERNAL, fallback_channels: ['email', 'push', 'sms', 'whatsapp'] })]);
    for (const [eventType, policy] of CAPPED) {
      const queued = await services.notificationService.queueFromDomainEvent(event(eventType, userId));
      for (const { channel, fallback } of routingOf(queued)) {
        assert.ok(policy.channels.includes(channel), `${eventType} routed to ${channel} for a person preferring ${preferred}`);
        for (const next of fallback) assert.ok(policy.channels.includes(next), `${eventType} queued ${next} as a fallback`);
      }
    }
  }
});

test('a person who turned in-app off gets no in-app-only notice — never an off-policy one instead', async () => {
  const { services, repository } = liveServices([prefs('user-no-app', { preferred_channel: 'email', in_app_enabled: false, ...EVERY_EXTERNAL })]);
  const queued = await services.notificationService.queueFromDomainEvent(event('evidence.review.decided', 'user-no-app'));
  assert.deepEqual(queued, []);
  assert.equal(repository.rows('notification_queue').length, 0);
});

test('an uncapped policy is not narrowed: SafeTrade still follows the person\'s preference, even beyond its own list', async () => {
  const policy = NOTIFICATION_POLICIES.MARKETPLACE_FUNDS_HELD;
  assert.notEqual(policy.policyChannelsOnly, true, 'premise: SafeTrade is not capped');
  assert.ok(!policy.channels.includes('push'), 'premise: push is outside SafeTrade\'s own channels');
  const { services } = liveServices([
    prefs('user-st-email', { preferred_channel: 'email', email_enabled: true }),
    prefs('user-st-push', { preferred_channel: 'push', push_enabled: true }),
  ]);
  const [byEmail] = routingOf(await services.notificationService.queueFromDomainEvent(event('MARKETPLACE_FUNDS_HELD', 'user-st-email')));
  assert.equal(byEmail.channel, 'email');
  assert.ok(byEmail.fallback.includes('in_app'));
  // The cap belongs to the policies that declare it. Widening is this policy's (unchanged) choice.
  const [byPush] = routingOf(await services.notificationService.queueFromDomainEvent(event('MARKETPLACE_FUNDS_HELD', 'user-st-push')));
  assert.equal(byPush.channel, 'push');
});
