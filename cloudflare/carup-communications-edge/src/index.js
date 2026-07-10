const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_INBOUND_EMAIL_BYTES = 25 * 1024 * 1024;
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['exe', 'js', 'mjs', 'cjs', 'bat', 'cmd', 'scr', 'ps1', 'vbs', 'jar']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function unauthorized() {
  return json({ success: false, error: 'unauthorized' }, 401);
}

function safePath(url) {
  return new URL(url).pathname.replace(/\/+$/, '') || '/';
}

function textEncoder() {
  return new TextEncoder();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder().encode(String(value)));
  return bytesToHex(digest);
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', textEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder().encode(value));
  return bytesToHex(signature);
}

function bearerToken(request) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-carup-worker-secret') || '';
}

function timingSafeStringEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function isAuthorized(request, env) {
  return timingSafeStringEqual(bearerToken(request), env.CARUP_EDGE_WORKER_SECRET || '');
}

function normalizeAddress(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return String(value.email || value.address || '').trim().toLowerCase();
}

function allowedRecipients(env) {
  return String(env.ALLOWED_INBOUND_RECIPIENTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function assertSafeOutboundPayload(payload) {
  const to = normalizeAddress(payload.to);
  const from = normalizeAddress(payload.from);
  if (!to || !from || !payload.subject) throw new Error('missing_email_fields');
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const totalBytes = attachments.reduce((sum, attachment) => sum + Number(attachment.size || attachment.size_bytes || 0), 0);
  if (totalBytes > MAX_BODY_BYTES) throw new Error('email_content_too_large');
  return { ...payload, to };
}

async function sendEmail(payload, env) {
  const emailPayload = assertSafeOutboundPayload(payload);
  if (env.EMAIL?.send) {
    const result = await env.EMAIL.send({
      to: emailPayload.to,
      from: emailPayload.from,
      subject: emailPayload.subject,
      text: emailPayload.text || '',
      html: emailPayload.html || undefined,
      replyTo: emailPayload.reply_to || emailPayload.replyTo || undefined,
      headers: emailPayload.headers || {},
      attachments: emailPayload.attachments || undefined,
    });
    return { accepted: true, providerStatus: 'accepted', providerMessageId: result?.messageId || null };
  }
  throw new Error('cloudflare_email_binding_missing');
}

function headerObject(headers) {
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
}

async function streamToText(stream, maxBytes) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error('email_too_large');
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function firstHeader(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || '';
}

function extractSimpleTextFromMime(raw) {
  const split = raw.split(/\r?\n\r?\n/);
  return split.slice(1).join('\n\n').replace(/--[^\n]+/g, '').trim().slice(0, 20000);
}

function extractAttachmentMetadataFromRaw(raw) {
  const attachments = [];
  const dispositionPattern = /Content-Disposition:\s*attachment;[^\n]*filename="?([^"\r\n;]+)"?[\s\S]*?Content-Type:\s*([^\r\n;]+)/gi;
  let match = dispositionPattern.exec(raw);
  while (match && attachments.length < 32) {
    const filename = match[1];
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) throw new Error('unsafe_attachment_type');
    attachments.push({ filename, content_type: match[2].trim(), size: 0, sha256: null, r2_key: null });
    match = dispositionPattern.exec(raw);
  }
  return attachments;
}

async function signCarUpPayload(rawBody, env, nonce = crypto.randomUUID()) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256Hex(rawBody);
  const signature = await hmacHex(env.CARUP_CLOUDFLARE_WEBHOOK_SECRET, `${timestamp}.${nonce}.${bodyHash}.${rawBody}`);
  return { timestamp, nonce, bodyHash, signature: `v1=${signature}` };
}

async function forwardInboundEmail(payload, env, fetchImpl = fetch) {
  if (!env.CARUP_API_BASE_URL || !env.CARUP_CLOUDFLARE_WEBHOOK_SECRET) throw new Error('carup_inbound_not_configured');
  const rawBody = JSON.stringify(payload);
  const signed = await signCarUpPayload(rawBody, env, payload.nonce || crypto.randomUUID());
  const response = await fetchImpl(`${env.CARUP_API_BASE_URL.replace(/\/+$/, '')}/api/communications/webhooks/cloudflare/email`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      'x-carup-cloudflare-timestamp': signed.timestamp,
      'x-carup-cloudflare-nonce': signed.nonce,
      'x-carup-body-sha256': signed.bodyHash,
      'x-carup-cloudflare-signature': signed.signature,
      ...(env.CLOUDFLARE_ACCESS_CLIENT_ID ? { 'cf-access-client-id': env.CLOUDFLARE_ACCESS_CLIENT_ID } : {}),
      ...(env.CLOUDFLARE_ACCESS_CLIENT_SECRET ? { 'cf-access-client-secret': env.CLOUDFLARE_ACCESS_CLIENT_SECRET } : {}),
    },
    body: rawBody,
  });
  if (!response.ok) throw new Error(`carup_inbound_rejected_${response.status}`);
  return response;
}

async function buildInboundPayload(message, env) {
  const maxBytes = Number(env.MAX_INBOUND_EMAIL_BYTES || MAX_INBOUND_EMAIL_BYTES);
  if (message.rawSize > maxBytes) {
    message.setReject?.('Message too large');
    throw new Error('email_too_large');
  }
  const recipient = normalizeAddress(message.to);
  const allowed = allowedRecipients(env);
  if (allowed.length > 0 && !allowed.includes(recipient)) {
    message.setReject?.('Recipient not supported');
    throw new Error('unsupported_recipient');
  }
  const raw = await streamToText(message.raw, maxBytes);
  const headers = headerObject(message.headers || new Headers());
  return {
    event: 'inbound_email',
    message_id: firstHeader(message.headers, 'message-id') || crypto.randomUUID(),
    idempotency_key: await sha256Hex(`${message.from}:${message.to}:${firstHeader(message.headers, 'message-id')}:${raw.slice(0, 4096)}`),
    sender: normalizeAddress(message.from),
    recipient,
    subject: firstHeader(message.headers, 'subject'),
    text: extractSimpleTextFromMime(raw),
    html: null,
    raw_size: Number(message.rawSize || raw.length),
    headers,
    in_reply_to: firstHeader(message.headers, 'in-reply-to') || null,
    references: String(firstHeader(message.headers, 'references') || '').split(/\s+/).filter(Boolean),
    attachments: extractAttachmentMetadataFromRaw(raw),
    received_at: new Date().toISOString(),
  };
}

async function handleFetch(request, env) {
  const path = safePath(request.url);
  if (path === '/health') {
    return json({
      success: true,
      service: 'carup-communications-edge',
      email_binding: Boolean(env.EMAIL?.send),
      inbound_queue: Boolean(env.INBOUND_QUEUE?.send),
      outbound_queue: Boolean(env.OUTBOUND_QUEUE?.send),
      dlq: Boolean(env.DLQ?.send),
      carup_api_configured: Boolean(env.CARUP_API_BASE_URL),
    });
  }
  if (path === '/diagnostics') {
    if (!isAuthorized(request, env)) return unauthorized();
    return json({ success: true, bindings: ['fetch', 'email', 'queue', 'scheduled'] });
  }
  if (path === '/email/send' && request.method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    const payload = await request.json();
    const result = await sendEmail(payload, env);
    return json({ success: true, accepted: true, ...result });
  }
  if (path === '/callback' && request.method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    return json({ success: true, accepted: true });
  }
  return json({ success: false, error: 'not_found' }, 404);
}

async function processQueueMessage(message, env) {
  const body = message.body || {};
  if (body.type === 'inbound_email') {
    await forwardInboundEmail(body.payload, env);
    message.ack?.();
    return;
  }
  if (body.type === 'outbound_email') {
    await sendEmail(body.payload, env);
    message.ack?.();
    return;
  }
  await env.DLQ?.send?.({ type: 'unsupported_message', body, failedAt: new Date().toISOString() });
  message.ack?.();
}

async function runScheduled(env, fetchImpl = fetch) {
  if (!env.CARUP_API_BASE_URL || !env.COMMUNICATION_WORKER_SECRET) throw new Error('carup_scheduler_not_configured');
  const response = await fetchImpl(`${env.CARUP_API_BASE_URL.replace(/\/+$/, '')}/api/internal/communications/process`, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      'x-communication-worker-secret': env.COMMUNICATION_WORKER_SECRET,
    },
    body: JSON.stringify({ limit: Number(env.COMMUNICATION_WORKER_BATCH_SIZE || 25), source: 'cloudflare_cron' }),
  });
  if (!response.ok) throw new Error(`carup_processor_failed_${response.status}`);
  return response;
}

const handler = {
  fetch: handleFetch,
  async email(message, env, ctx) {
    const payload = await buildInboundPayload(message, env);
    if (env.INBOUND_QUEUE?.send) {
      await env.INBOUND_QUEUE.send({ type: 'inbound_email', payload, enqueuedAt: new Date().toISOString() });
      return;
    }
    ctx.waitUntil(forwardInboundEmail(payload, env));
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(message, env);
      } catch (error) {
        if (message.attempts >= 5) {
          await env.DLQ?.send?.({ type: 'dead_letter', body: message.body, error: error.message, failedAt: new Date().toISOString() });
          message.ack?.();
        } else {
          message.retry?.({ delaySeconds: Math.min(900, 2 ** Number(message.attempts || 1) * 30) });
        }
      }
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};

export { buildInboundPayload, forwardInboundEmail, handleFetch, runScheduled, sendEmail, signCarUpPayload };
export default handler;
