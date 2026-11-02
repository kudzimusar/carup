/**
 * OC-5R-REL-01 — a real outbound kill switch, and the last synthesised provider ids.
 *
 *   K1  `COMMUNICATION_OUTBOUND_DISABLED` parses fail-closed.
 *   K2  The transport refuses every provider send while it is on — all twelve adapter transports,
 *       governed or not — and contacts no provider; with it off the same sends reach the transport.
 *   K3  The delivery worker HOLDS an external-channel notification (claimed attempt restored, audited,
 *       never attempted, never dead-lettered into a fallback); internal channels still flow.
 *   K4  The admin provider smoke refuses before a single row is created.
 *   K5  The admin credential-check `send_probe` no longer sends through a raw adapter: it goes through
 *       the governed smoke path, so the switch stops it and, when off, it leaves an audited queue row.
 *   G6+ SendGrid, Brevo, Expo, Cloudflare (REST and worker) and the governed WhatsApp template no longer
 *       turn an id-less 2xx into "sent".
 * No test here touches the network.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const KS = await import('../services/communication/outboundKillSwitch.js');
const adapters = await import('../services/communication/adapters/providerAdapters.js');
const { CommunicationMetaWhatsAppGovernedAdapter } = await import('../services/communication/communicationMetaWhatsAppGovernedAdapter.js');
const { MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const { CommunicationDeliveryWorker } = await import('../services/communication/communicationDeliveryWorker.js');
const { CommunicationIdentityService } = await import('../services/communication/communicationIdentityService.js');
const { CommunicationThreadService } = await import('../services/communication/communicationThreadService.js');
const { CommunicationNotificationService } = await import('../services/communication/communicationNotificationService.js');
const { sendProviderSmokeTest, createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');
const { renderEmailForNotification } = await import('../services/communication/emailExperience/renderEmail.js');

const SWITCH = KS.OUTBOUND_KILL_SWITCH_ENV;
afterEach(() => { delete process.env[SWITCH]; });

/** A fetch spy that answers 2xx with `body` and records every call. */
function spy(body = {}, headers = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, text: async () => JSON.stringify(body), json: async () => body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function renderedEmail(classification = 'transactional') {
  const rendered = renderEmailForNotification({ title: 'CarUp update', message: 'Body copy.', payload: { classification } }, { env: {} });
  assert.equal(rendered.ok, true, `renderer refused the fixture: ${rendered.errorCode}`);
  return {
    notificationId: 'n-1', messageId: 'm-1', idempotencyKey: 'dedupe-1',
    recipient: { email: 'user@example.test' },
    content: {
      subject: rendered.subject, body: rendered.text, text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
      data: {
        classification, email: 'user@example.test',
        email_render_provenance: {
          renderer_version: rendered.renderer_version, classification: rendered.classification,
          classification_source: rendered.classification_source, template_key: rendered.template_key,
          template_version: rendered.template_version, footer_family: rendered.footer_family,
          sender_persona: rendered.sender_persona, html_part_rendered: rendered.html_part_rendered,
          text_part_rendered: rendered.text_part_rendered, cta_href_canonical: rendered.cta_href_canonical,
          cta_route: rendered.cta_route, leadership_identity_rendered: rendered.leadership_identity_rendered,
          render_fallback_used: rendered.render_fallback_used,
        },
      },
    },
  };
}

function marketingEmail() {
  const unsub = 'https://api-staging.carup.dev/api/communications/unsubscribe?token=abc';
  const rendered = renderEmailForNotification(
    { title: 'CarUp Weekly', message: 'hello', payload: { classification: 'marketing', unsubscribe_url: unsub } },
    { env: {} },
  );
  assert.equal(rendered.ok, true);
  return {
    content: {
      data: {
        classification: 'marketing', email: 'buyer@example.test', campaign_id: 'camp-1', campaign_delivery_id: 'del-1',
        unsubscribe_url: unsub, unsubscribe_mailto: 'unsubscribe+abc@mail.carup.dev', unsubscribe_presentation: rendered.unsubscribe_presentation,
      },
      subject: 'News', body: rendered.text, html: rendered.html,
    },
  };
}

const RESEND_ENV = { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev', RESEND_AUTH_FROM_EMAIL: 'CarUp Security <auth@mail.carup.dev>' };
const BREVO_ENV = { BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'CarUp <news@marketing.carup.dev>' };
const META_ENV = { CARUP_META_ACCESS_TOKEN: 't', CARUP_META_PHONE_NUMBER_ID: 'phone-1', CARUP_META_PAGE_ID: 'page-1' };
const TEMPLATE_INPUT = { recipient: { phoneNumber: '263771234567' }, content: { body: 'x', data: { whatsapp_delivery_mode: 'template', provider_template_reference: 'carup_conversation_reply|en_US', provider_template_parameters: ['x'] } } };

/** Every adapter transport, with a send that reaches its transport when the switch is off. */
const TRANSPORTS = [
  ['Resend', (env, f) => new adapters.ResendEmailAdapter({ env: { ...RESEND_ENV, ...env }, fetchImpl: f }), () => renderedEmail()],
  ['Brevo', (env, f) => new adapters.BrevoMarketingAdapter({ env: { ...BREVO_ENV, ...env }, fetchImpl: f }), () => marketingEmail()],
  ['SendGrid', (env, f) => new adapters.SendGridEmailAdapter({ env: { SENDGRID_API_KEY: 'k', SENDGRID_FROM_EMAIL: 'a@b.test', ...env }, fetchImpl: f }), () => ({ recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } })],
  ['Cloudflare REST', (env, f) => new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_EMAIL_API_TOKEN: 't', ...env }, fetchImpl: f }), () => ({ recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } })],
  ['Cloudflare worker', (env, f) => new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_EMAIL_WORKER_URL: 'https://edge.invalid', CLOUDFLARE_EMAIL_WORKER_SECRET: 's', ...env }, fetchImpl: f }), () => ({ recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } })],
  ['Twilio', (env, f) => new adapters.TwilioSmsAdapter({ env: { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1', ...env }, fetchImpl: f }), () => ({ recipient: { phoneNumber: '+263771234567' }, content: { body: 'b' } })],
  ['Meta WhatsApp', (env, f) => new adapters.MetaWhatsAppAdapter({ env: { ...META_ENV, ...env }, fetchImpl: f }), () => ({ recipient: { phoneNumber: '+263771234567' }, content: { text: 'hi' } })],
  ['Meta WhatsApp (governed template)', (env, f) => new CommunicationMetaWhatsAppGovernedAdapter({ env: { ...META_ENV, ...env }, fetchImpl: f }), () => TEMPLATE_INPUT],
  ['Meta Messenger', (env, f) => new adapters.FacebookMessengerAdapter({ env: { ...META_ENV, ...env }, fetchImpl: f }), () => ({ recipient: { externalId: 'psid-1' }, content: { text: 'hi' } })],
  ['Instagram', (env, f) => new adapters.InstagramMessagingAdapter({ env: { ...META_ENV, ...env }, fetchImpl: f }), () => ({ recipient: { externalId: 'igsid-1' }, content: { text: 'hi' } })],
  ['Telegram', (env, f) => new adapters.TelegramBotAdapter({ env: { CARUP_TELEGRAM_BOT_TOKEN: '1:tok', ...env }, fetchImpl: f }), () => ({ recipient: { telegramChatId: '42' }, content: { text: 'hi' } })],
  ['Expo', (env, f) => new adapters.ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 't', ...env }, fetchImpl: f }), () => ({ recipient: { expoPushToken: 'ExponentPushToken[x]' }, content: { subject: 's', body: 'b' } })],
];

// ═══ K1 ══════════════════════════════════════════════════════════════════════════════════════════
test('K1: the switch parses fail-closed — only an explicit "off" spelling leaves sending on', () => {
  for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' true ', 'disabled', 'banana']) assert.equal(KS.isOutboundDisabled({ [SWITCH]: v }), true, v);
  for (const v of [undefined, null, '', 'false', '0', 'no', 'off', ' OFF ']) assert.equal(KS.isOutboundDisabled({ [SWITCH]: v }), false, String(v));
  assert.deepEqual(KS.outboundHealth({ [SWITCH]: 'true' }), { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled', control: SWITCH });
  assert.equal(KS.outboundHealth({}).kill_switch, 'inactive');
  assert.deepEqual([...KS.INTERNAL_CHANNELS].sort(), ['in_app', 'mobile_chat', 'web_chat']);
});

// ═══ K2 ══════════════════════════════════════════════════════════════════════════════════════════
for (const [name, make, input] of TRANSPORTS) {
  test(`K2 ${name}: no provider is contacted while the switch is on — and the same send reaches the transport when it is off`, async () => {
    const off = spy({});
    await make({}, off).send(input());
    assert.ok(off.calls.length >= 1, `${name}: anti-vacuity — the fixture reaches the transport with the switch off`);

    const on = spy({});
    const out = await make({ [SWITCH]: 'true' }, on).send(input());
    assert.equal(on.calls.length, 0, `${name} contacted the provider with the switch on`);
    assert.equal(out.accepted, false);
    assert.equal(out.errorCode, KS.OUTBOUND_DISABLED_CODE, `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.retryable, true, 'a held send is not lost');
  });
}

// ═══ K3 ══════════════════════════════════════════════════════════════════════════════════════════
function workerHarness() {
  const repository = new MemoryCommunicationRepository({ communication_audit_events: [] });
  const sends = [];
  const recording = (channel) => ({ channel, provider: `${channel}-spy`, validateConfiguration: () => ({ available: true, mode: 'real' }), async send(input) { sends.push({ channel, input }); return { accepted: true, providerRequestId: 'pm-1', providerMessageId: 'pm-1', providerStatus: 'accepted' }; } });
  const registry = { get: (channel) => recording(channel), health: () => [] };
  const fallbacks = [];
  const worker = new CommunicationDeliveryWorker({ repository, adapterRegistry: registry, notificationService: { queueNextFallback: async (n) => { fallbacks.push(n.id); return { queued: true }; } } });
  return { repository, worker, sends, fallbacks };
}

test('K3: a CLAIMED external notification is held — attempt restored, audited, never attempted or dead-lettered', async () => {
  process.env[SWITCH] = 'true';
  const { repository, worker, sends, fallbacks } = workerHarness();
  await repository.insert('notification_queue', { id: 'q-email', channel: 'email', status: 'processing', attempt_count: 3, max_attempts: 3, payload: { email: 'u@example.test' } });
  const row = await repository.findOne('notification_queue', { id: 'q-email' });
  const out = await worker.deliverNotification(row, { alreadyClaimed: true });
  assert.equal(out.status, 'held');
  assert.equal(sends.length, 0, 'the adapter was called');
  const after = await repository.findOne('notification_queue', { id: 'q-email' });
  assert.equal(after.status, 'retry_scheduled');
  assert.equal(after.attempt_count, 2, 'the claim\'s attempt was given back — a hold is not an attempt');
  assert.equal(after.last_error_code, KS.OUTBOUND_DISABLED_CODE);
  assert.ok(new Date(after.next_attempt_at).getTime() - Date.now() > 50 * 60 * 1000, 'held for about an hour');
  assert.equal(fallbacks.length, 0, 'no fallback channel was queued');
  assert.equal((await repository.list('message_delivery_attempts')).length, 0, 'no delivery attempt was recorded');
  const audit = await repository.list('communication_audit_events');
  assert.ok(audit.some((e) => e.event_type === 'outbound_held' && e.notification_id === 'q-email'), 'the hold is audited');
});

test('K3: a DIRECT dispatch (auth Email path) is held without touching its attempt count', async () => {
  process.env[SWITCH] = '1';
  const { repository, worker, sends } = workerHarness();
  await repository.insert('notification_queue', { id: 'q-auth', channel: 'email', status: 'queued', attempt_count: 0, max_attempts: 5, payload: { email: 'u@example.test' } });
  const out = await worker.deliverNotification(await repository.findOne('notification_queue', { id: 'q-auth' }));
  assert.equal(out.status, 'held');
  assert.equal(sends.length, 0);
  assert.equal((await repository.findOne('notification_queue', { id: 'q-auth' })).attempt_count, 0);
});

test('K3: internal channels are not held — an in-app notification still reaches its adapter', async () => {
  process.env[SWITCH] = 'true';
  const { repository, worker, sends } = workerHarness();
  await repository.insert('notification_queue', { id: 'q-inapp', channel: 'in_app', status: 'queued', attempt_count: 0, max_attempts: 5, payload: {} });
  const out = await worker.deliverNotification(await repository.findOne('notification_queue', { id: 'q-inapp' }));
  assert.notEqual(out.status, 'held');
  assert.deepEqual(sends.map((s) => s.channel), ['in_app']);
});

test('K3: with the switch off, the external send is attempted (anti-vacuity)', async () => {
  const { repository, worker, sends } = workerHarness();
  await repository.insert('notification_queue', { id: 'q-on', channel: 'telegram', status: 'queued', attempt_count: 0, max_attempts: 5, payload: { telegram_chat_id: '42' } });
  await worker.deliverNotification(await repository.findOne('notification_queue', { id: 'q-on' }));
  assert.deepEqual(sends.map((s) => s.channel), ['telegram']);
});

// ═══ K4 ══════════════════════════════════════════════════════════════════════════════════════════
function servicesHarness(adapter) {
  const repository = new MemoryCommunicationRepository({ communication_audit_events: [] });
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const deliveryWorker = new CommunicationDeliveryWorker({ repository, adapterRegistry: { get: () => adapter, health: () => [] } });
  return { repository, identityService, threadService, notificationService, deliveryWorker };
}

test('K4: the admin provider smoke refuses with 503 before creating a single row', async () => {
  process.env[SWITCH] = 'true';
  const metaFetch = spy({ messages: [{ id: 'wamid.X' }] });
  const services = servicesHarness(new adapters.MetaWhatsAppAdapter({ env: META_ENV, fetchImpl: metaFetch }));
  await assert.rejects(
    () => sendProviderSmokeTest({ services, channel: 'whatsapp', to: '263771234567', message: 'x' }),
    (error) => error.statusCode === 503 && error.code === KS.OUTBOUND_DISABLED_CODE,
  );
  for (const table of ['channel_identities', 'message_threads', 'messages', 'notification_queue', 'message_delivery_attempts']) {
    assert.equal((await services.repository.list(table)).length, 0, `${table} row created`);
  }
  assert.equal(metaFetch.calls.length, 0);
});

// ═══ K5 ══════════════════════════════════════════════════════════════════════════════════════════
async function credentialCheck(services) {
  const app = express();
  app.use(express.json());
  app.use(createAdminCommunicationRouter({ services }));
  const server = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const realFetch = globalThis.fetch;
  const graphCalls = [];
  // The route's read-only lookup uses the global fetch; any POST to Graph from it would be the raw send.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      graphCalls.push({ url: String(url), method: init.method || 'GET' });
      return new Response(JSON.stringify({ id: 'phone-1', verified_name: 'CarUp' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/admin/communications/test/provider-credential-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-communication-worker-secret': 'rel01-worker-secret' },
      body: JSON.stringify({ channel: 'whatsapp', send_probe: true, to: '263771234567' }),
    });
    return { status: res.status, body: await res.json(), graphCalls };
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('K5: send_probe goes through the governed path — the switch stops it and nothing is posted to Meta', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { COMMUNICATION_WORKER_SECRET: 'rel01-worker-secret', CARUP_META_ACCESS_TOKEN: 't', CARUP_META_PHONE_NUMBER_ID: 'phone-1', [SWITCH]: 'true' });
  try {
    const metaFetch = spy({ messages: [{ id: 'wamid.PROBE' }] });
    const services = servicesHarness(new adapters.MetaWhatsAppAdapter({ env: META_ENV, fetchImpl: metaFetch }));
    const { status, body, graphCalls } = await credentialCheck(services);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.post_probe.governed, true);
    assert.equal(body.post_probe.accepted, false);
    assert.equal(body.post_probe.error_code, KS.OUTBOUND_DISABLED_CODE);
    assert.ok(graphCalls.every((c) => c.method === 'GET'), 'only the read-only lookup reached Graph');
    assert.equal(metaFetch.calls.length, 0, 'no send');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('K5: with the switch off, send_probe is a GOVERNED send — a queue row, a delivery attempt and a SMOKE_TEST audit', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { COMMUNICATION_WORKER_SECRET: 'rel01-worker-secret', CARUP_META_ACCESS_TOKEN: 't', CARUP_META_PHONE_NUMBER_ID: 'phone-1' });
  delete process.env[SWITCH];
  try {
    const metaFetch = spy({ messages: [{ id: 'wamid.PROBE' }] });
    const services = servicesHarness(new adapters.MetaWhatsAppAdapter({ env: META_ENV, fetchImpl: metaFetch }));
    const { body } = await credentialCheck(services);
    assert.equal(body.post_probe.governed, true);
    assert.equal(body.post_probe.accepted, true, JSON.stringify(body.post_probe));
    assert.equal(body.post_probe.provider_message_id, 'wamid.PROBE');
    assert.equal((await services.repository.list('notification_queue')).length, 1);
    assert.equal((await services.repository.list('message_delivery_attempts')).length, 1);
    assert.ok((await services.repository.list('communication_audit_events')).some((e) => e.event_type === 'smoke_test'));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('K5: the route source no longer constructs a raw adapter to send', () => {
  const src = readFileSync(new URL('../routes/adminCommunicationRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /new MetaWhatsAppAdapter\(/);
  assert.match(src, /send_probe === true && to\) \{[\s\S]{0,200}sendProviderSmokeTest\(/);
});

// ═══ G6+ ═════════════════════════════════════════════════════════════════════════════════════════
test('G6+: an id-less 2xx is unproven for SendGrid, Brevo, Expo, Cloudflare REST/worker and the governed template', async () => {
  const cases = [
    ['SendGrid', new adapters.SendGridEmailAdapter({ env: { SENDGRID_API_KEY: 'k', SENDGRID_FROM_EMAIL: 'a@b.test' }, fetchImpl: spy({}) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }],
    ['Brevo', new adapters.BrevoMarketingAdapter({ env: BREVO_ENV, fetchImpl: spy({}) }), marketingEmail()],
    ['Expo', new adapters.ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 't' }, fetchImpl: spy({ data: [{ status: 'ok' }] }) }), { recipient: { expoPushToken: 'ExponentPushToken[x]' }, content: { body: 'b' } }],
    ['Expo (no ticket)', new adapters.ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 't' }, fetchImpl: spy({}) }), { recipient: { expoPushToken: 'ExponentPushToken[x]' }, content: { body: 'b' } }],
    ['Cloudflare REST', new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_EMAIL_API_TOKEN: 't' }, fetchImpl: spy({ success: true, result: { delivered: ['u@example.test'] } }, { 'cf-ray': 'ray-1' }) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }],
    ['Cloudflare worker', new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_EMAIL_WORKER_URL: 'https://edge.invalid', CLOUDFLARE_EMAIL_WORKER_SECRET: 's' }, fetchImpl: spy({ accepted: true }) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }],
    ['Meta WhatsApp (governed template)', new CommunicationMetaWhatsAppGovernedAdapter({ env: META_ENV, fetchImpl: spy({ messages: [] }) }), TEMPLATE_INPUT],
  ];
  for (const [name, adapter, input] of cases) {
    const out = await adapter.send(input);
    assert.equal(out.accepted, false, `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.errorCode, 'provider_acceptance_unproven', name);
    assert.equal(out.retryable, false, name);
    assert.equal(out.providerRequestId, undefined, `${name}: an id was fabricated`);
  }
});

test('G6+: with the provider\'s own id, each of those adapters accepts under THAT id (anti-vacuity)', async () => {
  const cases = [
    ['SendGrid', new adapters.SendGridEmailAdapter({ env: { SENDGRID_API_KEY: 'k', SENDGRID_FROM_EMAIL: 'a@b.test' }, fetchImpl: spy({}, { 'x-message-id': 'sg-1' }) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }, 'sg-1'],
    ['Brevo', new adapters.BrevoMarketingAdapter({ env: BREVO_ENV, fetchImpl: spy({ messageId: '<b-1@x>' }) }), marketingEmail(), '<b-1@x>'],
    ['Expo', new adapters.ExpoPushAdapter({ env: { EXPO_ACCESS_TOKEN: 't' }, fetchImpl: spy({ data: [{ status: 'ok', id: 'ticket-1' }] }) }), { recipient: { expoPushToken: 'ExponentPushToken[x]' }, content: { body: 'b' } }, 'ticket-1'],
    ['Cloudflare REST', new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_EMAIL_API_TOKEN: 't' }, fetchImpl: spy({ success: true, result: { id: 'cf-1', delivered: [] } }, { 'cf-ray': 'ray-1' }) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }, 'cf-1'],
    ['Cloudflare worker', new adapters.CloudflareEmailAdapter({ env: { CLOUDFLARE_EMAIL_FROM: 'a@b.test', CLOUDFLARE_EMAIL_WORKER_URL: 'https://edge.invalid', CLOUDFLARE_EMAIL_WORKER_SECRET: 's' }, fetchImpl: spy({ accepted: true, providerMessageId: 'cfw-1' }) }), { recipient: { email: 'u@example.test' }, content: { subject: 's', body: 'b' } }, 'cfw-1'],
    ['Meta WhatsApp (governed template)', new CommunicationMetaWhatsAppGovernedAdapter({ env: META_ENV, fetchImpl: spy({ messages: [{ id: 'wamid.T' }] }) }), TEMPLATE_INPUT, 'wamid.T'],
  ];
  for (const [name, adapter, input, id] of cases) {
    const out = await adapter.send(input);
    assert.equal(out.accepted, true, `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.providerMessageId, id, name);
    assert.equal(out.providerRequestId, id, `${name}: request id is the provider's own, never a trace header or a hash`);
  }
});

test('G6+: no adapter can synthesise an id any more — the helper that minted them is gone', () => {
  const src = readFileSync(new URL('../services/communication/adapters/providerAdapters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /function stableRequestId/);
  assert.doesNotMatch(src, /get\?\.\('cf-ray'\)/);
});
