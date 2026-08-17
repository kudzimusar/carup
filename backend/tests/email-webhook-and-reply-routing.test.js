import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RESEND_EVENT_STATUS,
  RESEND_SUPPRESSION_REASON,
  ResendInboundResolver,
  extractRfcReferences,
  verifyResendSignature,
} from '../services/communication/resendWebhookService.js';
import {
  EmailReplyTokenService,
  buildReplyToAddress,
  extractReplyTokens,
  hashReplyToken,
  parseReplyToAddress,
} from '../services/communication/emailReplyTokenService.js';
import { BrevoMarketingAdapter, EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';

/**
 * E3/E4/E5 — source-level proofs for Resend lifecycle + inbound routing and Brevo marketing
 * isolation. No provider is contacted and no Email is sent.
 */

// ---------- E3: Svix signature verification ----------

const SECRET = `whsec_${Buffer.from('carup-test-signing-secret-0123456789').toString('base64')}`;

function signResend(rawBody, { id = 'msg_test_1', timestamp = Math.floor(Date.now() / 1000), secret = SECRET } = {}) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}

test('a correctly signed Resend webhook verifies', () => {
  const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });
  const result = verifyResendSignature({ rawBody: raw, headers: signResend(raw), secret: SECRET });
  assert.equal(result.valid, true);
});

test('a tampered body fails verification', () => {
  const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });
  const headers = signResend(raw);
  const tampered = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e1' } });
  assert.equal(verifyResendSignature({ rawBody: tampered, headers, secret: SECRET }).valid, false);
});

test('a wrong secret fails verification', () => {
  const raw = JSON.stringify({ type: 'email.delivered' });
  const other = `whsec_${Buffer.from('a-different-secret-value-999999').toString('base64')}`;
  assert.equal(verifyResendSignature({ rawBody: raw, headers: signResend(raw), secret: other }).valid, false);
});

test('a missing secret or missing headers fails closed — never open', () => {
  const raw = '{}';
  assert.equal(verifyResendSignature({ rawBody: raw, headers: signResend(raw), secret: '' }).valid, false);
  assert.equal(verifyResendSignature({ rawBody: raw, headers: {}, secret: SECRET }).valid, false);
});

test('a replayed request outside the timestamp tolerance is rejected', () => {
  const raw = JSON.stringify({ type: 'email.delivered' });
  const stale = Math.floor(Date.now() / 1000) - 3600;
  const result = verifyResendSignature({ rawBody: raw, headers: signResend(raw, { timestamp: stale }), secret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'timestamp_outside_tolerance');
});

test('signature verification tolerates rotation (multiple candidate signatures)', () => {
  const raw = JSON.stringify({ type: 'email.sent' });
  const good = signResend(raw);
  good['svix-signature'] = `v1,AAAAinvalidsignature== ${good['svix-signature']}`;
  assert.equal(verifyResendSignature({ rawBody: raw, headers: good, secret: SECRET }).valid, true);
});

test('every required lifecycle event maps to a canonical status', () => {
  for (const type of ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed']) {
    assert.ok(RESEND_EVENT_STATUS[type], `${type} must map to a canonical status`);
  }
  assert.equal(RESEND_SUPPRESSION_REASON['email.bounced'], 'hard_bounce');
  assert.equal(RESEND_SUPPRESSION_REASON['email.complained'], 'complaint');
});

// ---------- E4: reply address + token ----------

test('the reply address is opaque and exposes no raw thread id', () => {
  const address = buildReplyToAddress('AbCd1234EfGh5678IjKl', { RESEND_INBOUND_DOMAIN: 'mail.carup.dev' });
  assert.match(address, /^conversation\+[A-Za-z0-9_-]+@mail\.carup\.dev$/);
  const local = address.split('@')[0];
  assert.ok(local.length <= 64, 'local part must fit RFC 5321 (64 octets)');
  assert.doesNotMatch(address, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'must not embed a UUID');
});

test('reply tokens are recovered from realistic recipient headers', () => {
  assert.equal(parseReplyToAddress('CarUp <conversation+ABCDEFGHIJKLMNOP@mail.carup.dev>'), 'ABCDEFGHIJKLMNOP');
  const many = extractReplyTokens(['a@b.com, conversation+TOKENTOKENTOKEN1@mail.carup.dev']);
  assert.deepEqual(many, ['TOKENTOKENTOKEN1']);
  assert.equal(parseReplyToAddress('someone@example.com'), null);
});

test('only a hash of the reply token is stored', () => {
  const raw = 'ABCDEFGHIJKLMNOPQRSTUV';
  const h = hashReplyToken(raw);
  assert.equal(h.length, 64);
  assert.notEqual(h, raw);
});

// A minimal stand-in for the PostgREST surface used by the resolver.
function fakeDb(tables) {
  const build = (rows) => {
    const filters = [];
    const api = {
      select: () => api,
      eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return api; },
      is: (c) => { filters.push((r) => r[c] === null || r[c] === undefined); return api; },
      gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
      maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] || null, error: null }),
      single: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej),
      update: () => api,
    };
    return api;
  };
  return { from: (t) => build(tables[t] || []) };
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function scenario(overrides = {}) {
  const tables = {
    email_reply_tokens: [{
      id: 'tok-1', token_hash: hashReplyToken('RAWTOKENRAWTOKEN01'), thread_id: 'thread-1',
      participant_id: 'part-1', binding_id: 'bind-1', tenant_id: 'platform',
      expires_at: FUTURE, revoked_at: null, use_count: 0,
    }],
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'platform' }],
    conversation_channel_bindings: [{ id: 'bind-1', can_receive: true, expires_at: null, thread_id: 'thread-1', participant_id: 'part-1', channel_identity_id: 'ident-1', channel: 'email' }],
    message_delivery_attempts: [{ message_id: 'msg-1', provider: 'resend', provider_message_id: '<out-1@mail.carup.dev>' }],
    messages: [{ id: 'msg-1', thread_id: 'thread-1', tenant_id: 'platform' }],
    channel_identities: [{ id: 'ident-1', channel: 'email', normalized_address: 'buyer@example.com', user_id: 'u1' }],
    ...overrides,
  };
  const db = fakeDb(tables);
  return { db, resolver: new ResendInboundResolver({ supabase: db, replyTokenService: new EmailReplyTokenService({ supabase: db }) }) };
}

test('token-only resolution succeeds', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'], from: 'buyer@example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.threadId, 'thread-1');
  assert.equal(r.participantId, 'part-1');
  assert.equal(r.resolution, 'authenticated_reply_token');
});

test('RFC-only resolution reuses the existing bound participant', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({
    to: ['support@mail.carup.dev'], from: 'buyer@example.com',
    headers: { 'In-Reply-To': '<out-1@mail.carup.dev>' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.threadId, 'thread-1');
  assert.equal(r.participantId, 'part-1', 'must reuse the bound participant, never mint one');
  assert.equal(r.resolution, 'rfc_reference');
});

test('token + RFC agreeing resolves and is labelled as agreement', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({
    to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'], from: 'buyer@example.com',
    headers: { 'In-Reply-To': '<out-1@mail.carup.dev>' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.resolution, 'token_and_rfc_agree');
});

test('token + RFC DISAGREEING fails closed', async () => {
  const { resolver } = scenario({
    message_delivery_attempts: [{ message_id: 'msg-other', provider: 'resend', provider_message_id: '<out-1@mail.carup.dev>' }],
    messages: [{ id: 'msg-other', thread_id: 'thread-OTHER', tenant_id: 'platform' }],
  });
  const r = await resolver.resolve({
    to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'], from: 'buyer@example.com',
    headers: { 'In-Reply-To': '<out-1@mail.carup.dev>' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'token_rfc_disagreement');
});

test('an unknown RFC reference with no token fails closed', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({ to: ['support@mail.carup.dev'], from: 'buyer@example.com', headers: { 'In-Reply-To': '<nope@elsewhere>' } });
  assert.equal(r.ok, false);
});

test('a tampered or expired token fails closed', async () => {
  const { resolver } = scenario();
  assert.equal((await resolver.resolve({ to: ['conversation+TAMPEREDTAMPERED01@mail.carup.dev'] })).ok, false);

  const expired = scenario({
    email_reply_tokens: [{
      id: 'tok-1', token_hash: hashReplyToken('RAWTOKENRAWTOKEN01'), thread_id: 'thread-1',
      participant_id: 'part-1', binding_id: null, tenant_id: 'platform',
      expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null,
    }],
  });
  const r = await expired.resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired_token');
});

test('a wrong-tenant token fails closed', async () => {
  const { resolver } = scenario({ message_threads: [{ id: 'thread-1', tenant_id: 'a-different-tenant' }] });
  const r = await resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tenant_invariant_failed');
});

test('an inactive participant or unreceivable binding fails closed', async () => {
  const left = scenario({ message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: new Date().toISOString() }] });
  assert.equal((await left.resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'] })).reason, 'participant_inactive');

  const blocked = scenario({ conversation_channel_bindings: [{ id: 'bind-1', can_receive: false, thread_id: 'thread-1', participant_id: 'part-1', channel_identity_id: 'ident-1' }] });
  assert.equal((await blocked.resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev'] })).reason, 'binding_cannot_receive');
});

test('two reply tokens in one inbound email are ambiguous and fail closed', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({ to: ['conversation+RAWTOKENRAWTOKEN01@mail.carup.dev, conversation+OTHERTOKENOTHER22@mail.carup.dev'] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'multiple_reply_tokens');
});

test('an unknown sender with no token and no RFC never falls back to "most recent conversation"', async () => {
  const { resolver } = scenario();
  const r = await resolver.resolve({ to: ['support@mail.carup.dev'], from: 'stranger@example.com' });
  assert.equal(r.ok, false);
  assert.ok(['no_rfc_reference', 'no_reply_token'].includes(r.reason));
});

test('RFC references are extracted newest-first and de-duplicated', () => {
  const ids = extractRfcReferences({ headers: { 'In-Reply-To': '<a@x>', References: '<a@x> <b@x>' } });
  assert.deepEqual(ids, ['<a@x>', '<b@x>']);
});

// ---------- E5: Brevo marketing isolation ----------

const BREVO_ENV = { BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'CarUp <news@marketing.carup.dev>' };

test('Brevo refuses any non-marketing classification', async () => {
  const brevo = new BrevoMarketingAdapter({ env: BREVO_ENV });
  for (const classification of ['security', 'auth', 'transactional', 'conversational', 'service']) {
    const r = await brevo.send({ content: { data: { classification, email: 'x@example.test' } } });
    assert.equal(r.accepted, false);
    assert.equal(r.errorCode, 'classification_not_permitted');
  }
});

test('Brevo refuses a marketing send with no canonical campaign context', async () => {
  const brevo = new BrevoMarketingAdapter({ env: BREVO_ENV });
  const r = await brevo.send({ content: { data: { classification: 'marketing', email: 'x@example.test' } } });
  assert.equal(r.accepted, false);
  assert.equal(r.errorCode, 'campaign_context_missing');
});

test('Brevo sends from the verified marketing sender and tags canonical ids', async () => {
  let captured = null;
  const brevo = new BrevoMarketingAdapter({
    env: BREVO_ENV,
    fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers };
      return { ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<brevo-1@marketing.carup.dev>' }), headers: new Map() };
    },
  });
  const r = await brevo.send({
    content: {
      data: {
        classification: 'marketing', email: 'buyer@example.test', campaign_id: 'camp-1', campaign_delivery_id: 'del-1',
        unsubscribe_url: 'https://api-staging.carup.dev/api/communications/unsubscribe?token=abc',
        unsubscribe_mailto: 'unsubscribe+abc@mail.carup.dev',
      },
      subject: 'News',
      body: 'hello',
    },
  });
  assert.equal(r.accepted, true);
  assert.equal(r.providerMessageId, '<brevo-1@marketing.carup.dev>');
  assert.match(captured.url, /api\.brevo\.com\/v3\/smtp\/email/);
  assert.equal(captured.body.sender.email, 'news@marketing.carup.dev');
  assert.ok(captured.body.tags.includes('campaign:camp-1'));
  assert.ok(captured.body.tags.includes('delivery:del-1'));
  // The MCP credential must never be used by application code.
  assert.ok(!JSON.stringify(captured.headers).includes('MCP'));
});

// ---------- E7: a marketing Email must carry a real, actionable unsubscribe control ----------

test('Brevo REFUSES a marketing send that carries no governed unsubscribe URL', async () => {
  // Found physically: a governed marketing message reached a human inbox whose body claimed an
  // unsubscribe link existed while containing none. This is the choke point that makes that state
  // unreachable, rather than trusting each template author to remember.
  const brevo = new BrevoMarketingAdapter({
    env: BREVO_ENV,
    fetchImpl: async () => { throw new Error('no provider call must be made'); },
  });
  const r = await brevo.send({
    content: { data: { classification: 'marketing', email: 'b@example.test', campaign_id: 'c', campaign_delivery_id: 'd' }, body: 'hi' },
  });
  assert.equal(r.accepted, false);
  assert.equal(r.errorCode, 'unsubscribe_action_missing');
  assert.equal(r.retryable, false);
});

test('marketing Email carries RFC 8058 headers and a visible unsubscribe action in BOTH parts', async () => {
  let captured = null;
  const brevo = new BrevoMarketingAdapter({
    env: BREVO_ENV,
    fetchImpl: async (url, init) => {
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<m@x>' }), headers: new Map() };
    },
  });
  const url = 'https://api-staging.carup.dev/api/communications/unsubscribe?token=tok123';
  await brevo.send({
    content: {
      data: {
        classification: 'marketing', email: 'b@example.test', campaign_id: 'c', campaign_delivery_id: 'd',
        unsubscribe_url: url, unsubscribe_mailto: 'unsubscribe+tok123@mail.carup.dev',
      },
      subject: 'News', body: 'Body copy.',
    },
  });

  // RFC 8058 one-click.
  assert.equal(captured.headers['List-Unsubscribe'], `<${url}>, <mailto:unsubscribe+tok123@mail.carup.dev>`);
  assert.equal(captured.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // Headers alone are not an actionable control for a human reader, so both rendered parts must
  // carry the link too — and an HTML part must exist even when the template supplies only text.
  assert.ok(captured.textContent.includes(url), 'plain-text part must contain the unsubscribe URL');
  assert.ok(captured.htmlContent, 'marketing Email must always have an HTML part');
  assert.ok(captured.htmlContent.includes(`href="${url}"`), 'HTML part must contain a clickable unsubscribe anchor');
  assert.ok(/unsubscribe/i.test(captured.htmlContent));
  // The original copy must survive footer injection.
  assert.ok(captured.textContent.includes('Body copy.'));
  assert.ok(captured.htmlContent.includes('Body copy.'));
});

test('the router keeps marketing on Brevo and everything else on Resend', () => {
  const router = new EmailTransportRouter({ env: { ...BREVO_ENV, RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev' } });
  assert.equal(router.selectAdapter({ content: { data: { classification: 'marketing' } } }).adapter.provider, 'brevo');
  for (const c of ['security', 'auth', 'conversational', 'transactional', 'service']) {
    assert.equal(router.selectAdapter({ content: { data: { classification: c } } }).adapter.provider, 'resend');
  }
});

test('no application code path reads BREVO_API_MCP_KEY', () => {
  const brevo = new BrevoMarketingAdapter({ env: { ...BREVO_ENV, BREVO_API_MCP_KEY: 'must-not-be-used' } });
  assert.deepEqual(brevo.requiredEnv, ['BREVO_API_KEY', 'BREVO_FROM_EMAIL']);
});

// ---------- E3 regression: lifecycle events must not fall through to the inbound parser ----------

test('Resend/Brevo lifecycle events are treated as receipt-only, not inbound messages', async () => {
  // Regression for a P1 found by REAL provider traffic: genuine email.sent / email.delivered
  // events reached the endpoint with a valid signature but were routed into
  // parseChannelPayload(), which has no 'email' parser and threw "Unsupported referral channel."
  // The canonical delivery transition was therefore never applied.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../services/communication/communicationWebhookService.js', import.meta.url), 'utf8');
  const match = source.match(/receiptResults\.length > 0 && \[([^\]]+)\]/);
  assert.ok(match, 'receipt-only provider allowlist not found');
  for (const provider of ['resend', 'brevo']) {
    assert.ok(match[1].includes(`'${provider}'`), `${provider} must be a receipt-only provider`);
  }
});

test('an inbound email.received produces NO delivery receipt, so it still reaches the inbound path', async () => {
  const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');
  const svc = new CommunicationWebhookService({ env: {}, repository: null });
  const receipts = svc.extractDeliveryReceipts('resend', 'email', {
    type: 'email.received',
    data: { from: 'x@example.test', to: ['conversation+TOKENTOKENTOKEN1@mail.carup.dev'] },
  });
  assert.deepEqual(receipts, [], 'email.received must not be mistaken for a delivery receipt');
});

test('a lifecycle event extracts the RFC Message-ID for reply correlation', async () => {
  const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');
  const svc = new CommunicationWebhookService({ env: {}, repository: null });
  const [receipt] = svc.extractDeliveryReceipts('resend', 'email', {
    type: 'email.delivered',
    data: {
      email_id: '667c199e-164d-4bb0-9214-40b4467c6a2d',
      message_id: '<010601a0@ap-northeast-1.amazonses.com>',
      to: ['someone@example.test'],
    },
  });
  assert.equal(receipt.status, 'delivered');
  assert.equal(receipt.provider, 'resend');
  // The RFC id is preferred, because that is what an inbound reply will reference.
  assert.equal(receipt.providerMessageId, '<010601a0@ap-northeast-1.amazonses.com>');
  assert.equal(receipt.providerRequestId, '667c199e-164d-4bb0-9214-40b4467c6a2d');
});

// ---------- E3 regression: receipt correlation across Resend's two identifiers ----------

function receiptRepo(attempts) {
  const updates = [];
  return {
    updates,
    async list(table, filters) {
      if (table !== 'message_delivery_attempts') return [];
      return attempts.filter((a) => Object.entries(filters).every(([k, v]) => a[k] === v));
    },
    async updateById(table, id, patch) { updates.push({ table, id, patch }); return { id, ...patch }; },
    async insert() { return {}; },
    async findOne() { return null; },
  };
}

test('a Resend receipt correlates via provider_request_id when the RFC id differs', async () => {
  // The live defect: the send response yields only Resend's uuid, while the webhook reports the
  // RFC Message-ID. Matching solely on provider_message_id left the attempt stuck at "sent".
  const { CommunicationCanonicalWebhookService } = await import('../services/communication/communicationCanonicalWebhookService.js');
  const attempts = [{
    id: 'att-1', notification_id: '325', message_id: 'msg-1',
    provider: 'resend', channel: 'email',
    provider_request_id: '16f332c6-6f74-45ee-9805-12a851623f35',
    provider_message_id: '16f332c6-6f74-45ee-9805-12a851623f35',
  }];
  const repo = receiptRepo(attempts);
  const svc = new CommunicationCanonicalWebhookService({ repository: repo });

  const result = await svc.applyDeliveryReceipt({
    provider: 'resend', channel: 'email', status: 'delivered', rawStatus: 'email.delivered',
    providerMessageId: '<0106@ap-northeast-1.amazonses.com>',
    providerRequestId: '16f332c6-6f74-45ee-9805-12a851623f35',
  });

  assert.notEqual(result.status, 'unattributed', 'receipt must attribute to the attempt');
  const attemptUpdate = repo.updates.find((u) => u.table === 'message_delivery_attempts');
  assert.ok(attemptUpdate, 'the delivery attempt must be updated');
  assert.equal(attemptUpdate.patch.status, 'delivered');
  // And the RFC id must be backfilled so an inbound reply can be mapped back to this message.
  assert.equal(attemptUpdate.patch.provider_message_id, '<0106@ap-northeast-1.amazonses.com>');
});

test('receipt backfill never overwrites an already-correct RFC Message-ID', async () => {
  const { CommunicationCanonicalWebhookService } = await import('../services/communication/communicationCanonicalWebhookService.js');
  const rfc = '<already@mail.carup.dev>';
  const repo = receiptRepo([{
    id: 'att-2', notification_id: '400', message_id: 'msg-2', provider: 'resend', channel: 'email',
    provider_request_id: 'req-2', provider_message_id: rfc,
  }]);
  const svc = new CommunicationCanonicalWebhookService({ repository: repo });
  await svc.applyDeliveryReceipt({
    provider: 'resend', channel: 'email', status: 'delivered',
    providerMessageId: rfc, providerRequestId: 'req-2',
  });
  const update = repo.updates.find((u) => u.table === 'message_delivery_attempts');
  assert.equal(update.patch.provider_message_id, undefined, 'no rewrite when the RFC id already matches');
});

// ---------- E4 regression: the inbound path must be WIRED, not merely implemented ----------

test('the production factory wires the inbound resolver and reply token service', async () => {
  // This is the test whose absence let a dead inbound path ship green. Every previous inbound test
  // constructed ResendInboundResolver by hand and injected it, so it proved the resolver worked
  // while the real composition never built one: CommunicationWebhookService's constructor did not
  // accept `inboundResolver` at all, and the factory never passed one. Every genuine, signature-
  // verified `email.received` therefore threw "Resend inbound routing is not configured." before
  // reaching any of the logic under test — physically observed on staging against a real human reply.
  //
  // Asserted structurally (no network, no database): the constructor must ACCEPT and ASSIGN both
  // collaborators, and the factory must pass them.
  const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');
  const { CommunicationCanonicalWebhookService } = await import('../services/communication/communicationCanonicalWebhookService.js');

  const resolver = { resolve: async () => ({ ok: false, reason: 'stub' }) };
  const replyTokens = { recordUse: async () => {} };

  for (const Service of [CommunicationWebhookService, CommunicationCanonicalWebhookService]) {
    const svc = new Service({ repository: {}, inboundService: {}, inboundResolver: resolver, replyTokenService: replyTokens });
    assert.equal(svc.inboundResolver, resolver, `${Service.name} must assign inboundResolver`);
    assert.equal(svc.replyTokenService, replyTokens, `${Service.name} must assign replyTokenService`);
  }

  // And the sole production construction site must actually supply them.
  const { readFileSync } = await import('node:fs');
  const factory = readFileSync(new URL('../services/communication/communicationServiceFactory.js', import.meta.url), 'utf8');
  assert.match(factory, /new ResendInboundResolver\(/, 'factory must construct the inbound resolver');
  assert.match(factory, /createEmailReplyTokenService\(/, 'factory must construct the reply token service');
  assert.match(
    factory,
    /new CommunicationCanonicalWebhookService\(\{[\s\S]*?inboundResolver[\s\S]*?replyTokenService[\s\S]*?\}\)/,
    'factory must inject BOTH into the webhook service',
  );
});

test('a retried webhook delivery that previously FAILED is not masked as a duplicate', async () => {
  // The defect that turned a loud CarUp-side failure into apparent provider silence: the first
  // delivery failed and returned 400, the provider retried, and the retry hit the dedupe branch —
  // which returned HTTP 200 and rewrote processing_status from 'failed' to 'duplicate'. The provider
  // saw a success, stopped retrying, and the failure became invisible.
  const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');

  const updates = [];
  const repository = {
    findOne: async (table) => (table === 'webhook_logs'
      ? { id: 'wl-1', processing_status: 'failed', attempt_count: 1, error_message: 'Resend inbound routing is not configured.' }
      : null),
    updateById: async (table, id, patch) => { updates.push({ table, id, patch }); return { id }; },
    insert: async () => ({ id: 'x' }),
    list: async () => [],
  };
  const service = new CommunicationWebhookService({ repository, inboundService: {}, env: { RESEND_WEBHOOK_SECRET: SECRET } });
  const rawBody = JSON.stringify({ type: 'email.received', data: { email_id: 'e-1' } });
  const signed = signResend(rawBody);

  await assert.rejects(
    () => service.handleWebhook('resend', 'email', JSON.parse(rawBody), { headers: signed, rawBody }),
    (error) => {
      assert.match(error.message, /previously failed/i);
      return true;
    },
    'a retry of a failed delivery must surface an error, never a 200 duplicate',
  );
  // The row must NOT have been rewritten to 'duplicate'.
  const statuses = updates.flatMap((u) => (u.patch.processing_status ? [u.patch.processing_status] : []));
  assert.ok(!statuses.includes('duplicate'), 'a failed row must not be relabelled as a duplicate');
});

test('an authenticated Email lifecycle event with no canonical transition is ignored, not failed', async () => {
  // Brevo's `request` and `unique_opened` authenticate correctly but map to no CarUp delivery state.
  // They previously fell through to the referral parser and were recorded as failures. With failed
  // rows now deliberately retried via a non-2xx, that would make a provider retry an open-tracking
  // ping forever and risk it disabling the webhook.
  const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');
  const updates = [];
  const repository = {
    findOne: async () => null,
    insert: async () => ({ id: 'log-1' }),
    updateById: async (table, id, patch) => { updates.push(patch); return { id }; },
    list: async () => [],
  };
  const service = new CommunicationWebhookService({
    repository, inboundService: {}, env: { BREVO_WEBHOOK_SECRET: 'shared-secret' },
  });

  for (const event of ['request', 'unique_opened']) {
    const body = { event, email: 'x@example.test', 'message-id': '<m@brevo>' };
    const result = await service.handleWebhook('brevo', 'email', body, {
      headers: { 'x-carup-brevo-secret': 'shared-secret' },
      rawBody: JSON.stringify(body),
    });
    assert.equal(result.success, true, `${event} must be acknowledged`);
    assert.equal(result.ignored, true, `${event} must be marked ignored`);
  }
  const finals = updates.filter((p) => p.processing_status);
  assert.ok(finals.length >= 2);
  assert.ok(finals.every((p) => p.processing_status === 'processed'), 'must not be recorded as failed');
  assert.ok(finals.every((p) => p.error_code === 'ignored_no_canonical_transition'));
});

test('a marketing send records provenance proving the unsubscribe action was actually transmitted', async () => {
  // A delivered message once carried no unsubscribe action because an OLDER deployment executed the
  // send while a newer one served the API. The delivered artefact could then only be inferred from
  // the code believed to be running, and that inference was wrong. The adapter now reports what it
  // actually put on the wire, and the worker persists it on the delivery attempt.
  const brevo = new BrevoMarketingAdapter({
    env: BREVO_ENV,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<m@x>' }), headers: new Map() }),
  });
  const url = 'https://api-staging.carup.dev/api/communications/unsubscribe?token=prov1';
  const r = await brevo.send({
    content: {
      data: {
        classification: 'marketing', email: 'b@example.test', campaign_id: 'c', campaign_delivery_id: 'd',
        unsubscribe_url: url, unsubscribe_mailto: 'unsubscribe+prov1@mail.carup.dev',
      },
      subject: 'News', body: 'Copy.',
    },
  });
  assert.equal(r.accepted, true);
  const m = r.providerMetadata;
  assert.ok(m, 'a marketing send must report unsubscribe provenance');
  assert.equal(m.marketing_html_part_sent, true);
  assert.equal(m.marketing_html_anchor_present, true);
  assert.equal(m.marketing_text_link_present, true);
  assert.equal(m.list_unsubscribe_header_sent, true);
  assert.equal(m.list_unsubscribe_post_header_sent, true);
});
