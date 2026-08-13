import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';

const { createAdminCommunicationRouter } = await import('../routes/adminCommunicationRoutes.js');

const routeSource = readFileSync(new URL('../routes/adminCommunicationRoutes.js', import.meta.url), 'utf8');

/**
 * The provider-template-status diagnostic reads Meta's approval state with the server's own access
 * token, because nothing else can: the token is not retrievable from the Vercel CLI and the operator
 * browser has no Meta session. A diagnostic holding a provider token has to be pinned as read-only
 * and non-leaking, not merely intended to be.
 */

const TOKEN = 'meta-access-token-value-must-never-appear';
// A real WhatsApp Business Account ID is a numeric Graph object ID.
const WABA = '1234567890123456';

function repositoryWith(rows) {
  return {
    async list(table) {
      return rows[table] ? rows[table].map((r) => ({ ...r })) : [];
    },
  };
}

function invokeRouter(router, req) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      send(body) { resolve({ statusCode: this.statusCode, body }); },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    router.handle(req, response, (error) => (error ? reject(error) : resolve({ statusCode: 404, body: null })));
  });
}

const GOVERNED_ROWS = {
  communication_templates: [
    { id: 't1', template_key: 'conversation_reply_whatsapp_v1', classification: 'service', status: 'active' },
    { id: 't2', template_key: 'carup_reengagement_v1', classification: 'marketing', status: 'active' },
  ],
  communication_template_versions: [
    { id: 'v1', template_id: 't1', version: 1, channel: 'whatsapp', language: 'en', approval_status: 'approved', provider_template_reference: 'carup_conversation_reply|en_US' },
    { id: 'v2', template_id: 't2', version: 1, channel: 'whatsapp', language: 'en', approval_status: 'approved', provider_template_reference: 'carup_reengagement_v1|en_US' },
    // An unbound version must not be reported as a binding.
    { id: 'v3', template_id: 't2', version: 1, channel: 'email', language: 'en', approval_status: 'approved', provider_template_reference: null },
  ],
};

async function callDiagnostic({ graph, rows = GOVERNED_ROWS, env = {} } = {}) {
  const router = createAdminCommunicationRouter({ services: { repository: repositoryWith(rows) } });
  const previous = {
    token: process.env.CARUP_META_ACCESS_TOKEN,
    waba: process.env.CARUP_META_WABA_ID,
    worker: process.env.COMMUNICATION_WORKER_SECRET,
    fetch: globalThis.fetch,
  };
  const requests = [];
  process.env.COMMUNICATION_WORKER_SECRET = 'worker-secret';
  if ('token' in env) { if (env.token === null) delete process.env.CARUP_META_ACCESS_TOKEN; else process.env.CARUP_META_ACCESS_TOKEN = env.token; }
  else process.env.CARUP_META_ACCESS_TOKEN = TOKEN;
  if ('waba' in env) { if (env.waba === null) delete process.env.CARUP_META_WABA_ID; else process.env.CARUP_META_WABA_ID = env.waba; }
  else process.env.CARUP_META_WABA_ID = WABA;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method || 'GET', body: init?.body ?? null });
    return graph();
  };
  try {
    const response = await invokeRouter(router, {
      method: 'GET',
      url: '/api/admin/communications/provider-template-status',
      originalUrl: '/api/admin/communications/provider-template-status',
      headers: { authorization: 'Bearer worker-secret' },
      query: {},
      body: {},
    });
    return { response, requests };
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['CARUP_META_ACCESS_TOKEN', previous.token], ['CARUP_META_WABA_ID', previous.waba], ['COMMUNICATION_WORKER_SECRET', previous.worker]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function graphOk(data) {
  return () => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('the diagnostic issues exactly one read-only Graph GET and sends no body', async () => {
  const { response, requests } = await callDiagnostic({
    graph: graphOk([{ name: 'carup_conversation_reply', language: 'en_US', status: 'APPROVED', category: 'UTILITY' }]),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 1, 'exactly one provider call');
  assert.equal(requests[0].method, 'GET', 'must never POST — a POST to Meta could send a message');
  assert.equal(requests[0].body, null, 'a read-only diagnostic must carry no request body');
  assert.match(requests[0].url, /\/message_templates\?/, 'must read the message_templates edge');
  assert.ok(!requests[0].url.includes('/messages'), 'must never touch the messages edge');
});

test('the response never contains the access token', async () => {
  const { response } = await callDiagnostic({
    graph: graphOk([{ name: 'carup_conversation_reply', language: 'en_US', status: 'APPROVED', category: 'UTILITY' }]),
  });
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes(TOKEN), 'the token must never reach the response');
  assert.ok(!/authorization/i.test(serialized), 'the auth header must never be echoed');
  assert.equal(response.body.present.access_token, true, 'presence is reported as a boolean, never the value');
  assert.equal(response.body.present.waba_id, true);
});

test('provider status is joined to the governed binding it is supposed to back', async () => {
  const { response } = await callDiagnostic({
    graph: graphOk([
      { name: 'carup_conversation_reply', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
      { name: 'carup_reengagement_v1', language: 'en_US', status: 'PENDING', category: 'MARKETING' },
    ]),
  });

  assert.equal(response.body.ok, true);
  const bindings = response.body.governed_bindings;
  assert.equal(bindings.length, 2, 'only versions carrying a provider reference are bindings');

  const utility = bindings.find((b) => b.template_key === 'conversation_reply_whatsapp_v1');
  assert.equal(utility.provider_template_reference, 'carup_conversation_reply|en_US');
  assert.equal(utility.provider_reference_found, true);
  assert.equal(utility.provider_status, 'APPROVED');
  assert.equal(utility.classification, 'service');

  const marketing = bindings.find((b) => b.template_key === 'carup_reengagement_v1');
  assert.equal(marketing.classification, 'marketing');
  assert.equal(marketing.provider_status, 'PENDING', 'a pending provider template must not read as approved');
});

test('a binding Meta does not report is surfaced as not found, not silently approved', async () => {
  const { response } = await callDiagnostic({
    graph: graphOk([{ name: 'some_other_template', language: 'en_US', status: 'APPROVED', category: 'UTILITY' }]),
  });
  for (const binding of response.body.governed_bindings) {
    assert.equal(binding.provider_reference_found, false, `${binding.template_key} must not claim a provider template that does not exist`);
    assert.equal(binding.provider_status, null);
  }
});

test('template shape is reported as counts, never as copy', async () => {
  const marketingBody = 'Hi {{1}}, there is something new in CarUp for you — {{2}}.';
  const { response } = await callDiagnostic({
    graph: graphOk([
      {
        name: 'carup_reengagement_v1',
        language: 'en_US',
        status: 'APPROVED',
        category: 'MARKETING',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'CarUp' },
          { type: 'BODY', text: marketingBody },
          { type: 'FOOTER', text: 'Reply STOP to opt out' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Open CarUp' }] },
        ],
      },
      {
        name: 'carup_conversation_reply',
        language: 'en_US',
        status: 'APPROVED',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: '{{1}}' }],
      },
    ]),
  });

  const marketing = response.body.provider_templates.find((t) => t.name === 'carup_reengagement_v1');
  assert.equal(marketing.body_parameter_count, 2, 'two distinct positional parameters');
  assert.deepEqual(marketing.component_types, ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);

  const utility = response.body.provider_templates.find((t) => t.name === 'carup_conversation_reply');
  assert.equal(utility.body_parameter_count, 1, 'the utility template takes exactly one BODY parameter');

  const serialized = JSON.stringify(response.body);
  for (const copy of [marketingBody, 'Reply STOP to opt out', 'Open CarUp']) {
    assert.ok(!serialized.includes(copy), `template copy must not be returned: ${copy}`);
  }
});

test('a template with no parameters reports a count of zero', async () => {
  const { response } = await callDiagnostic({
    graph: graphOk([{ name: 'carup_reengagement_v1', language: 'en_US', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'A CarUp update for you.' }] }]),
  });
  assert.equal(response.body.provider_templates[0].body_parameter_count, 0);
});

test('a provider rejection reason is surfaced verbatim', async () => {
  const { response } = await callDiagnostic({
    graph: graphOk([{ name: 'carup_reengagement_v1', language: 'en_US', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'INVALID_FORMAT' }]),
  });
  const rejected = response.body.provider_templates.find((t) => t.name === 'carup_reengagement_v1');
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.rejected_reason, 'INVALID_FORMAT');
});

test('a provider failure degrades to ok:false and still reports the governed side', async () => {
  const { response } = await callDiagnostic({
    graph: () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token', type: 'OAuthException' } }), { status: 401 }),
  });
  assert.equal(response.statusCode, 200, 'a diagnostic reports a provider failure, it does not become one');
  assert.equal(response.body.ok, false);
  assert.equal(response.body.provider_templates, null);
  assert.equal(response.body.governed_bindings.length, 2, 'the governed registry is still readable when Meta is not');
  for (const binding of response.body.governed_bindings) {
    assert.equal(binding.provider_reference_found, null, 'unknown must not collapse to false when Meta could not be read');
  }
  assert.ok(!JSON.stringify(response.body).includes(TOKEN));
});

test('missing configuration is reported, not guessed', async () => {
  const { response, requests } = await callDiagnostic({ graph: graphOk([]), env: { waba: null }, rows: GOVERNED_ROWS });
  assert.equal(response.body.ok, false);
  assert.equal(response.body.stage, 'config');
  assert.equal(response.body.present.waba_id, false);
  assert.equal(response.body.present.waba_id_configured, false);
  assert.equal(response.body.present.waba_id_source, null);
  assert.equal(requests.length, 0, 'must not call the provider without a WABA id');
});

/**
 * The real failure this guards against: CARUP_META_WABA_ID saved with its quotes arrives as the
 * literal two-character string `""`. Passed straight through it produced a Graph
 * "Object with ID '\"\"' does not exist" error — which blames Meta for a local misconfiguration.
 */
const WEBHOOK_ROWS = {
  ...GOVERNED_ROWS,
  webhook_logs: [
    { channel: 'whatsapp', signature_valid: true, received_at: '2026-08-01T00:00:00Z', payload_redacted: { entry: [{ id: '1111111111111111' }] } },
    { channel: 'whatsapp', signature_valid: true, received_at: '2026-08-12T07:43:07Z', payload_redacted: { entry: [{ id: '2061495501115454' }] } },
    // Unsigned traffic is untrusted and must never define which account we query.
    { channel: 'whatsapp', signature_valid: false, received_at: '2026-08-13T00:00:00Z', payload_redacted: { entry: [{ id: '9999999999999999' }] } },
    // Test fixtures that are not Graph object IDs.
    { channel: 'whatsapp', signature_valid: true, received_at: '2026-08-13T01:00:00Z', payload_redacted: { entry: [{ id: 'uat-waba-1' }] } },
  ],
};

test('a quoted-empty WABA id is rejected and the account is derived from signed webhook receipts', async () => {
  const { response, requests } = await callDiagnostic({
    graph: graphOk([{ name: 'carup_conversation_reply', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: '{{1}}' }] }]),
    rows: WEBHOOK_ROWS,
    env: { waba: '""' },
  });

  assert.equal(response.body.present.waba_id_configured, false, 'a quoted-empty value is not a usable account id');
  assert.equal(response.body.present.waba_id_source, 'webhook_receipt', 'and the misconfiguration stays visible');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v20\.0\/2061495501115454\/message_templates/, 'the most recent SIGNED receipt wins');
  assert.ok(!requests[0].url.includes('9999999999999999'), 'an unsigned receipt must never select the account');
  assert.ok(!requests[0].url.includes('uat-waba-1'), 'a non-numeric fixture must never select the account');
  assert.equal(response.body.ok, true);
});

test('a correctly configured WABA id is used and reported as configured', async () => {
  const { response, requests } = await callDiagnostic({
    graph: graphOk([]),
    rows: WEBHOOK_ROWS,
    env: { waba: '3030303030303030' },
  });
  assert.equal(response.body.present.waba_id_configured, true);
  assert.equal(response.body.present.waba_id_source, 'env', 'a valid env value takes precedence over webhook history');
  assert.match(requests[0].url, /\/3030303030303030\/message_templates/);
});

test('the diagnostic requires admin or worker-secret authentication', async () => {
  const router = createAdminCommunicationRouter({ services: { repository: repositoryWith(GOVERNED_ROWS) } });
  const layer = router.stack.find((item) => item.route?.path === '/api/admin/communications/provider-template-status');
  assert.ok(layer, 'the route must exist');
  assert.ok(layer.route.methods.get, 'a read-only diagnostic must be a GET');
  const guards = layer.route.stack.map((s) => s.handle.name);
  assert.ok(guards.includes('requireAdminOrWorkerSecret'), 'must be gated by requireAdminOrWorkerSecret');
});

test('the handler source contains no write path', () => {
  const start = routeSource.indexOf("router.get('/api/admin/communications/provider-template-status'");
  assert.ok(start > -1, 'route must exist in source');
  const end = routeSource.indexOf("router.get('/api/admin/communications/metrics'", start);
  assert.ok(end > start, 'route boundary must be findable');
  const handler = routeSource.slice(start, end);

  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /\.upsert\(/, /repository\.create/, /method:\s*['"]POST/i]) {
    assert.ok(!forbidden.test(handler), `the diagnostic must contain no write path: ${forbidden}`);
  }
  assert.ok(/services\.repository\.list\(/.test(handler), 'the governed side is read with list()');
  assert.ok(!/CARUP_META_ACCESS_TOKEN[^\n]*console/.test(handler), 'the token must never be logged');
});
