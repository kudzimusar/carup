#!/usr/bin/env node
import crypto from 'node:crypto';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith('--')) continue;
    const key = entry.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error('Usage: node scripts/uat/post-meta-whatsapp-inbound-sample.js --url <webhook-url> [--text <message>] [--app-secret <secret>] [--shared-secret <secret>]');
}

function buildPayload({ text, from, messageId }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'uat-waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '263771000000',
            phone_number_id: 'uat-phone-number-id',
          },
          contacts: [{
            profile: { name: 'CarUp UAT Sender' },
            wa_id: from,
          }],
          messages: [{
            from,
            id: messageId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url;
  if (!url) {
    usage();
    process.exitCode = 1;
    return;
  }

  const text = String(args.text || 'CarUp inbound UAT simulator 001');
  const from = String(args.from || '263771234567');
  const messageId = String(args['message-id'] || `wamid.uat.${crypto.randomUUID()}`);
  const payload = buildPayload({ text, from, messageId });
  const body = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'carup-whatsapp-uat-simulator/1.0',
    'x-correlation-id': `uat-${crypto.randomUUID()}`,
  };

  const appSecret = args['app-secret'] || process.env.CARUP_META_APP_SECRET;
  if (appSecret) {
    headers['x-hub-signature-256'] = `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
  }
  const sharedSecret = args['shared-secret'] || process.env.CARUP_CHANNEL_WEBHOOK_SECRET;
  if (sharedSecret) {
    headers['x-channel-webhook-secret'] = sharedSecret;
  }

  const response = await fetch(url, { method: 'POST', headers, body });
  const responseText = await response.text();
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(`x-request-id: ${response.headers.get('x-request-id') || response.headers.get('x-correlation-id') || '(none)'}`);
  console.log(responseText || '(empty response body)');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
