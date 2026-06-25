import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { buildInboundPayload, forwardInboundEmail, handleFetch, runScheduled, sendEmail } from '../src/index.js';

function textStream(value) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

test('authenticated fetch email send uses send_email binding', async () => {
  const sent = [];
  const response = await handleFetch(new Request('https://edge.test/email/send', {
    method: 'POST',
    headers: { authorization: 'Bearer edge-secret' },
    body: JSON.stringify({
      to: 'buyer@example.test',
      from: { address: 'noreply@example.test', name: 'CarUp' },
      subject: 'CarUp update',
      text: 'Hello',
    }),
  }), {
    CARUP_EDGE_WORKER_SECRET: 'edge-secret',
    EMAIL: { async send(payload) { sent.push(payload); return { messageId: 'cf-msg-1' }; } },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.providerMessageId, 'cf-msg-1');
  assert.equal(sent[0].to, 'buyer@example.test');
});

test('unauthenticated send request is rejected', async () => {
  const response = await handleFetch(new Request('https://edge.test/email/send', { method: 'POST', body: '{}' }), {
    CARUP_EDGE_WORKER_SECRET: 'edge-secret',
  });
  assert.equal(response.status, 401);
});

test('email handler payload routes by recipient and preserves threading metadata', async () => {
  const headers = new Headers({
    subject: 'Re: Listing',
    'message-id': '<message-1@example.test>',
    'in-reply-to': '<root@example.test>',
    references: '<root@example.test>',
  });
  const payload = await buildInboundPayload({
    from: 'buyer@example.test',
    to: 'support@example.test',
    headers,
    rawSize: 80,
    raw: textStream('Subject: Re: Listing\r\n\r\nCan I inspect this car?'),
  }, {
    ALLOWED_INBOUND_RECIPIENTS: 'support@example.test',
  });
  assert.equal(payload.sender, 'buyer@example.test');
  assert.equal(payload.recipient, 'support@example.test');
  assert.equal(payload.message_id, '<message-1@example.test>');
  assert.deepEqual(payload.references, ['<root@example.test>']);
  assert.match(payload.text, /inspect/);
});

test('inbound forward signs exact raw body for CarUp backend verification', async () => {
  const calls = [];
  await forwardInboundEmail({ event: 'inbound_email', message_id: 'm1', sender: 'a@example.test', recipient: 'support@example.test', nonce: 'nonce-1' }, {
    CARUP_API_BASE_URL: 'https://api.example.test',
    CARUP_CLOUDFLARE_WEBHOOK_SECRET: 'secret',
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response('{}', { status: 200 });
  });
  assert.equal(calls[0].url, 'https://api.example.test/api/communications/webhooks/cloudflare/email');
  assert.equal(calls[0].options.headers['x-carup-cloudflare-nonce'], 'nonce-1');
  assert.match(calls[0].options.headers['x-carup-cloudflare-signature'], /^v1=/);
});

test('scheduled handler calls protected CarUp processor', async () => {
  const calls = [];
  await runScheduled({
    CARUP_API_BASE_URL: 'https://api.example.test',
    COMMUNICATION_WORKER_SECRET: 'worker-secret',
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response('{}', { status: 200 });
  });
  assert.equal(calls[0].url, 'https://api.example.test/api/internal/communications/process');
  assert.equal(calls[0].options.headers['x-communication-worker-secret'], 'worker-secret');
});

test('sendEmail queues when send_email binding is unavailable', async () => {
  const queued = [];
  const result = await sendEmail({
    to: 'buyer@example.test',
    from: 'noreply@example.test',
    subject: 'Queued',
    text: 'Queued body',
  }, {
    OUTBOUND_QUEUE: { async send(payload) { queued.push(payload); } },
  });
  assert.equal(result.providerStatus, 'queued');
  assert.equal(queued[0].type, 'outbound_email');
});
