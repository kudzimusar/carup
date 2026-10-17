/**
 * OC-5R-PROV-01 — the communications transport boundary, after the defects this run proved.
 *
 *   G1  The CHANNEL decides which provider may speak for it; the caller's `:provider` URL segment
 *       never selects the verification scheme.
 *   G2  A Meta POST must carry Meta's signature; the GET verify token never authenticates a POST.
 *   G3  The generic shared secret is a local/CI convenience — refused in every declared deployment,
 *       where no real provider ever presents it. Comparisons are timing-safe.
 *   G4  A delivery receipt changes CarUp state only through the delivery attempt it resolves to;
 *       request-carried notification/message ids never stand in for one.
 *   G5  A Telegram timeout stays a retryable timeout, not a permanent HTTP-400 rejection.
 *   G6  A provider 2xx without the provider's own message id is not "sent".
 *   G7  The inbound Resend content fetch bounds the body read, not only the headers.
 * plus the gaps the boundary map found: the fake-Telegram assertion, Resend's missing-secret
 * reason, and refusal of a wrong Telegram/Brevo secret. No test here touches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { CommunicationWebhookService, INBOUND_PROVIDERS_BY_CHANNEL } = await import('../services/communication/communicationWebhookService.js');
const { CommunicationCanonicalWebhookService } = await import('../services/communication/communicationCanonicalWebhookService.js');
const { MemoryCommunicationRepository } = await import('../services/communication/communicationRepository.js');
const adapters = await import('../services/communication/adapters/providerAdapters.js');
const { verifyResendSignature } = await import('../services/communication/resendWebhookService.js');
const { ResendInboundContentService } = await import('../services/communication/resendInboundContentService.js');
const { renderEmailForNotification } = await import('../services/communication/emailExperience/renderEmail.js');

/** A transactional notification exactly as the worker would hand it to Resend (rendered + provenance). */
function renderedEmail() {
  const rendered = renderEmailForNotification({ title: 'CarUp update', message: 'Body copy.', payload: { classification: 'transactional' } }, { env: {} });
  assert.equal(rendered.ok, true, `renderer refused the fixture: ${rendered.errorCode}`);
  return {
    notificationId: 'n-1', messageId: 'm-1', idempotencyKey: 'dedupe-1',
    recipient: { email: 'user@example.test' },
    content: {
      subject: rendered.subject, body: rendered.text, text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
      data: {
        classification: 'transactional', email: 'user@example.test',
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

const LOCAL = { NODE_ENV: 'test' };
const RESEND_ENV = {
  RESEND_API_KEY: 'k',
  RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_AUTH_FROM_EMAIL: 'CarUp Security <auth@mail.carup.dev>',
};
const DEPLOYED = [{ NODE_ENV: 'test', VERCEL_ENV: 'preview' }, { NODE_ENV: 'test', CARUP_ENV: 'staging' }, { NODE_ENV: 'production', VERCEL_ENV: 'production' }];
const svc = (env) => new CommunicationWebhookService({ env });
const metaSig = (secret, raw) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

// ═══ G1 ══════════════════════════════════════════════════════════════════════════════════════════

test('G1: the channel decides the provider — another provider\'s valid secret cannot speak for it', () => {
  const env = { ...LOCAL, BREVO_WEBHOOK_SECRET: 'brevo-secret-value', CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'tg-secret-value', EXPO_ACCESS_TOKEN: 'expo-token-value' };
  const s = svc(env);
  // Each provider's own credential is valid for its own channel…
  assert.equal(s.verify('brevo', 'email', { query: { token: 'brevo-secret-value' } }), true);
  assert.equal(s.verify('telegram', 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'tg-secret-value' } }), true);
  assert.equal(s.verify('expo', 'push', { headers: { authorization: 'Bearer expo-token-value' } }), true);
  // …and for no other channel.
  for (const channel of ['whatsapp', 'facebook', 'instagram', 'telegram', 'sms']) {
    assert.equal(s.verify('brevo', channel, { query: { token: 'brevo-secret-value' } }), false, `brevo → ${channel}`);
  }
  assert.equal(s.verify('telegram', 'whatsapp', { headers: { 'x-telegram-bot-api-secret-token': 'tg-secret-value' } }), false);
  assert.equal(s.verify('expo', 'telegram', { headers: { authorization: 'Bearer expo-token-value' } }), false);
  assert.equal(s.verify('generic', 'web_chat', { body: { test: true } }), false, 'no provider speaks for web chat');
});

test('G1: the allow-list names every legitimate inbound pair and nothing else', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(INBOUND_PROVIDERS_BY_CHANNEL).map(([k, v]) => [k, [...v]])), {
    whatsapp: ['meta'], facebook: ['meta'], instagram: ['meta'], telegram: ['telegram'],
    email: ['resend', 'brevo', 'sendgrid', 'cloudflare'], sms: ['twilio'], push: ['expo'],
  });
});

test('G1: a cross-provider delivery is refused at the webhook handler and nothing is ingested', async () => {
  const repository = new MemoryCommunicationRepository();
  let ingested = 0;
  const s = new CommunicationWebhookService({
    repository, inboundService: { async ingest() { ingested += 1; return {}; } },
    env: { ...LOCAL, BREVO_WEBHOOK_SECRET: 'brevo-secret-value' },
  });
  const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ id: 'wamid.forged', from: '263771234567', text: { body: 'hi' } }] } }] }] };
  await assert.rejects(() => s.handleWebhook('brevo', 'whatsapp', body, { query: { token: 'brevo-secret-value' }, rawBody: JSON.stringify(body) }),
    (e) => e.statusCode === 403);
  assert.equal(ingested, 0);
});

// ═══ G2 ══════════════════════════════════════════════════════════════════════════════════════════

test('G2: a Meta POST carrying the GET verify token is NOT authenticated — only Meta\'s HMAC is', () => {
  const env = { ...LOCAL, CARUP_META_APP_SECRET: 'meta-app-secret', CARUP_META_WEBHOOK_VERIFY_TOKEN: 'verify-token-value' };
  const raw = JSON.stringify({ object: 'whatsapp_business_account' });
  const s = svc(env);
  assert.equal(s.verify('meta', 'whatsapp', { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-value' }, rawBody: raw }), false);
  assert.equal(s.verify('meta', 'whatsapp', { headers: { 'x-hub-signature-256': metaSig('meta-app-secret', raw) }, rawBody: raw }), true);
  assert.equal(s.verify('meta', 'whatsapp', { headers: { 'x-hub-signature-256': metaSig('wrong-secret', raw) }, rawBody: raw }), false);
  // The GET handshake keeps working through its own path.
  assert.equal(s.verifyMetaCallback('whatsapp', { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-value', 'hub.challenge': '42' }), '42');
  assert.throws(() => s.verifyMetaCallback('whatsapp', { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }), /verification failed/);
});

// ═══ G3 ══════════════════════════════════════════════════════════════════════════════════════════

test('G3: in every deployment the generic shared secret authenticates nothing', () => {
  for (const marker of DEPLOYED) {
    const s = svc({ ...marker, CARUP_CHANNEL_WEBHOOK_SECRET: 'shared-secret-value' });
    const label = JSON.stringify(marker);
    const shared = { 'x-channel-webhook-secret': 'shared-secret-value' };
    assert.equal(s.verify('meta', 'whatsapp', { headers: shared, rawBody: '{}' }), false, `${label} meta`);
    assert.equal(s.verify('meta', 'whatsapp', { headers: { 'x-carup-channel-secret': 'shared-secret-value' }, rawBody: '{}' }), false, `${label} meta alt header`);
    assert.equal(s.verify('telegram', 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'shared-secret-value' } }), false, `${label} telegram`);
    assert.equal(s.verify('twilio', 'sms', { headers: shared }), false, `${label} twilio`);
    assert.equal(s.verify('sendgrid', 'email', { headers: shared }), false, `${label} sendgrid`);
    assert.equal(s.verify('expo', 'push', { headers: { authorization: 'Bearer shared-secret-value' } }), false, `${label} expo`);
    assert.throws(() => s.verifyMetaCallback('whatsapp', { 'hub.mode': 'subscribe', 'hub.verify_token': 'shared-secret-value', 'hub.challenge': '1' }), /verification failed/, `${label} meta GET`);
  }
});

test('G3: provider-native verification is unaffected in a deployment, and the local fallback still exists', () => {
  const raw = '{"object":"page"}';
  const deployed = svc({ NODE_ENV: 'test', VERCEL_ENV: 'preview', CARUP_META_APP_SECRET: 'meta-app-secret', CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'tg-secret-value' });
  assert.equal(deployed.verify('meta', 'whatsapp', { headers: { 'x-hub-signature-256': metaSig('meta-app-secret', raw) }, rawBody: raw }), true);
  assert.equal(deployed.verify('telegram', 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'tg-secret-value' } }), true);
  const local = svc({ ...LOCAL, CARUP_CHANNEL_WEBHOOK_SECRET: 'shared-secret-value' });
  assert.equal(local.verify('meta', 'whatsapp', { headers: { 'x-channel-webhook-secret': 'shared-secret-value' }, rawBody: raw }), true);
  assert.equal(local.verify('telegram', 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'shared-secret-value' } }), true);
});

test('wrong Telegram and Brevo secrets are refused (not only missing ones)', () => {
  const s = svc({ ...LOCAL, CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN: 'tg-secret-value', BREVO_WEBHOOK_SECRET: 'brevo-secret-value' });
  assert.equal(s.verify('telegram', 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'tg-secret-valuE' } }), false);
  assert.equal(s.verify('telegram', 'telegram', { headers: {} }), false);
  assert.equal(s.verify('brevo', 'email', { query: { token: 'brevo-secret-valuE' } }), false);
  assert.equal(s.verify('brevo', 'email', { headers: { 'x-carup-brevo-secret': 'nope' } }), false);
});

test('Resend: a missing webhook secret is reported as missing_secret, even with complete signature headers', () => {
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,AAAA' };
  assert.deepEqual(verifyResendSignature({ rawBody: '{}', headers, secret: undefined }), { valid: false, reason: 'missing_secret' });
});

// ═══ G4 ══════════════════════════════════════════════════════════════════════════════════════════

function receiptHarness() {
  const repository = new MemoryCommunicationRepository({
    notification_queue: [
      { id: 'notif-victim', status: 'queued', channel: 'email' },
      { id: 'notif-own', status: 'sent', channel: 'email' },
    ],
    messages: [{ id: 'msg-victim', status: 'queued' }],
    message_delivery_attempts: [
      { id: 'att-own', provider: 'brevo', channel: 'email', provider_message_id: 'brevo-pm-1', notification_id: 'notif-own', message_id: null, status: 'sent' },
    ],
  });
  return { repository, canonical: new CommunicationCanonicalWebhookService({ repository, env: LOCAL }), base: new CommunicationWebhookService({ repository, env: LOCAL }) };
}
const statusOf = async (repository, table, id) => (await repository.findOne(table, { id }))?.status;

test('G4: a receipt naming a notification with no matching delivery attempt changes nothing', async () => {
  const { repository, canonical } = receiptHarness();
  const out = await canonical.applyDeliveryReceipt({
    provider: 'brevo', channel: 'email', providerMessageId: 'not-ours', status: 'delivered',
    notificationId: 'notif-victim', messageId: 'msg-victim',
  });
  assert.equal(out.status, 'unattributed');
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-victim'), 'queued');
  assert.equal(await statusOf(repository, 'messages', 'msg-victim'), 'queued');
});

test('G4: a receipt cannot borrow a matched attempt to reach a different notification', async () => {
  const { repository, canonical } = receiptHarness();
  // The provider id matches OUR attempt, but the request names someone else's notification: the
  // claimed id narrows the match to nothing, so nothing moves.
  const out = await canonical.applyDeliveryReceipt({
    provider: 'brevo', channel: 'email', providerMessageId: 'brevo-pm-1', status: 'delivered', notificationId: 'notif-victim',
  });
  assert.equal(out.status, 'unattributed');
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-victim'), 'queued');
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-own'), 'sent');
});

test('G4: a receipt that matches its own delivery attempt still advances that attempt\'s notification', async () => {
  const { repository, canonical } = receiptHarness();
  const out = await canonical.applyDeliveryReceipt({ provider: 'brevo', channel: 'email', providerMessageId: 'brevo-pm-1', status: 'delivered' });
  assert.equal(out.notificationId, 'notif-own');
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-own'), 'delivered');
});

test('G4: the base receipt path never takes another provider\'s attempt, nor a claimed id', async () => {
  const { repository, base } = receiptHarness();
  await base.applyDeliveryReceipt({ provider: 'sendgrid', providerMessageId: 'brevo-pm-1', status: 'delivered', notificationId: 'notif-victim' });
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-own'), 'sent', 'another provider\'s attempt was used');
  assert.equal(await statusOf(repository, 'notification_queue', 'notif-victim'), 'queued', 'a claimed id was trusted');
});

// ═══ G5 / G6 ═════════════════════════════════════════════════════════════════════════════════════

const okText = (body) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Map(), json: async () => body });

test('G5: a Telegram timeout stays a retryable timeout — not a permanent HTTP-400 rejection', async () => {
  const hung = (_url, init = {}) => new Promise((_r, reject) => {
    init.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
  const tg = new adapters.TelegramBotAdapter({ env: { CARUP_TELEGRAM_BOT_TOKEN: '1:tok' }, fetchImpl: hung, timeoutMs: 30 });
  const out = await tg.send({ recipient: { telegramChatId: '42' }, content: { text: 'hi' } });
  assert.equal(out.accepted, false);
  assert.equal(out.errorCode, 'timeout');
  assert.equal(out.retryable, true);
  assert.equal(out.provider_http_status, undefined, 'no HTTP status was invented');
});

test('G6: a 2xx without the provider\'s message id is unproven — never "sent"', async () => {
  const cases = [
    ['Resend', new adapters.ResendEmailAdapter({ env: RESEND_ENV, fetchImpl: okText({}) }), renderedEmail()],
    ['Meta WhatsApp', new adapters.MetaWhatsAppAdapter({ env: { CARUP_META_ACCESS_TOKEN: 't', CARUP_META_PHONE_NUMBER_ID: '1' }, fetchImpl: okText({ messages: [] }) }), { recipient: { phoneNumber: '+263771234567' }, content: { text: 'hi' } }],
    ['Telegram', new adapters.TelegramBotAdapter({ env: { CARUP_TELEGRAM_BOT_TOKEN: '1:tok' }, fetchImpl: okText({ ok: true, result: {} }) }), { recipient: { telegramChatId: '42' }, content: { text: 'hi' } }],
  ];
  for (const [name, adapter, input] of cases) {
    const out = await adapter.send(input);
    assert.equal(out.accepted, false, `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.errorCode, 'provider_acceptance_unproven', name);
    assert.equal(out.retryable, false, `${name}: retrying could duplicate a send that may have happened`);
  }
  // With the provider's id, the same adapters accept.
  const withId = await new adapters.TelegramBotAdapter({ env: { CARUP_TELEGRAM_BOT_TOKEN: '1:tok' }, fetchImpl: okText({ ok: true, result: { message_id: 77 } }) })
    .send({ recipient: { telegramChatId: '42' }, content: { text: 'hi' } });
  assert.deepEqual([withId.accepted, withId.providerMessageId], [true, '77']);
});

test('G6: an admin provider smoke reports "accepted by provider", never "delivered"', () => {
  const src = readFileSync(new URL('../routes/adminCommunicationRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Provider smoke test → \$\{result\.ok \? 'delivered'/);
  assert.match(src, /Provider smoke test → \$\{result\.ok \? 'accepted by provider' : 'failed'\}/);
});

// ═══ G7 ══════════════════════════════════════════════════════════════════════════════════════════

test('G7: a stalled inbound body read is cut off by the request timer and is retryable', async () => {
  const fetchImpl = async (_url, init = {}) => ({
    ok: true, status: 200,
    json: () => new Promise((_r, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const s = new ResendInboundContentService({ env: { RESEND_API_KEY: 'k' }, fetchImpl, timeoutMs: 30 });
  const deadline = new Promise((resolve) => { setTimeout(() => resolve('DEADLINE_EXCEEDED'), 2000).unref(); });
  const out = await Promise.race([s.fetchReceivedEmail('email-1'), deadline]);
  assert.notEqual(out, 'DEADLINE_EXCEEDED', 'the body read must be bounded');
  assert.deepEqual([out.ok, out.reason, out.retryable], [false, 'provider_body_timeout', true]);
});

// ═══ the fake-Telegram assertion ═════════════════════════════════════════════════════════════════

test('a deployment with a Telegram token refuses a FAKE Telegram adapter by name, whatever provider it claims', () => {
  const fake = { validateConfiguration: () => ({ mode: 'fake', provider: 'telegram_bot_api', available: true }) };
  const registry = new Map([['telegram', fake]]);
  assert.throws(() => adapters.assertRealTelegramAdapter(registry, { VERCEL_ENV: 'preview', CARUP_TELEGRAM_BOT_TOKEN: '1:tok' }), /is a fake adapter \(mode=fake\)/);
  const real = { validateConfiguration: () => ({ mode: 'real', provider: 'telegram_bot_api', available: true }) };
  assert.doesNotThrow(() => adapters.assertRealTelegramAdapter(new Map([['telegram', real]]), { VERCEL_ENV: 'preview', CARUP_TELEGRAM_BOT_TOKEN: '1:tok' }));
});
