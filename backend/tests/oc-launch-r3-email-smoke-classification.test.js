// OC-LAUNCH-WEB-LR1-R3 — the governed provider smoke test must be able to prove Resend.
//
// G2 makes every Email producer declare its canonical classification; an unclassified Email is
// refused before any provider call. The provider-smoke producer declared none, so a smoke test on
// the `email` channel dead-lettered with `classification_missing` and could never reach Resend.
// A provider smoke test is an operational SERVICE message: it must route to Resend, and it must
// never be able to ride the marketing transport (Brevo).
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCommunicationRepository } from '../services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';

const { sendProviderSmokeTest } = await import('../routes/adminCommunicationRoutes.js');

function recordingFetch() {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const isResend = String(url).includes('api.resend.com');
    const body = isResend ? { id: 're_SMOKE_EMAIL_123' } : { messageId: '<brevo-should-not-be-called>' };
    return { ok: true, status: 200, headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

function harness(adapter) {
  const repository = new MemoryCommunicationRepository();
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const deliveryWorker = new CommunicationDeliveryWorker({ repository, adapterRegistry: { get: () => adapter, health: () => [] } });
  return { repository, identityService, threadService, notificationService, deliveryWorker };
}

const EMAIL_ENV = {
  RESEND_API_KEY: 'resend-test-key',
  RESEND_FROM_EMAIL: 'CarUp <hello@carup.dev>',
  BREVO_API_KEY: 'brevo-test-key',
  BREVO_FROM_EMAIL: 'CarUp News <news@carup.dev>',
};

test('an email provider smoke test is classified as a service message and is sent through Resend, never Brevo', async () => {
  const fetchImpl = recordingFetch();
  const router = new EmailTransportRouter({ env: EMAIL_ENV, fetchImpl });
  const services = harness(router);

  const result = await sendProviderSmokeTest({ services, channel: 'email', to: 'controlled-inbox@example.test', message: 'CarUp Resend smoke test' });

  assert.equal(result.ok, true, `smoke email must be accepted, got ${JSON.stringify(result.delivery)}`);
  assert.equal(result.delivery.provider_message_id, 're_SMOKE_EMAIL_123');
  assert.equal(fetchImpl.calls.length, 1, 'exactly one provider request');
  assert.match(fetchImpl.calls[0].url, /api\.resend\.com/);
  assert.equal(fetchImpl.calls.some(call => /brevo/i.test(call.url)), false, 'Brevo is never called for a smoke test');

  const [queued] = await services.repository.list('notification_queue');
  assert.equal(queued.payload.classification, 'service');
  assert.equal(queued.status, 'sent');
});

test('the smoke classification is declared only for email, so other channels are unchanged', async () => {
  const captured = [];
  const services = harness({
    channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api',
    validateConfiguration: () => ({ available: true, provider: 'meta_whatsapp_cloud_api', channel: 'whatsapp', mode: 'real' }),
    send: async (input) => { captured.push(input); return { accepted: true, providerMessageId: 'wamid.X', status: 'sent' }; },
  });
  await sendProviderSmokeTest({ services, channel: 'whatsapp', to: '818081201356', message: 'wa smoke' }).catch(() => {});
  const [queued] = await services.repository.list('notification_queue');
  assert.equal(queued?.payload?.classification, undefined);
});
