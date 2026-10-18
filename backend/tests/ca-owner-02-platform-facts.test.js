/**
 * CA-OWNER-02 (E) — Platform / Security runtime facts for an authenticated Corporate principal, from the runtime's own
 * authorities, with no secret, no raw metrics map and no free-text provider error.
 *
 * Proven here (every runtime helper injected):
 *   · build identity, environment (from the API host — the staging project's Vercel target says "production"), database
 *     consistency, session authority + TLS posture, scheduler state, outbound kill switch, provider readiness and the
 *     event-outbox / ledger-intent backlogs are each their own Technical fact — never one health score;
 *   · a conflicting build identity, a failed probe or a failed backlog read is DEGRADED, never "healthy" or 0;
 *   · active certification sessions are UNAVAILABLE with the exact reason (AUTH-05 closed user_sessions to the service role);
 *   · nothing secret or free-text leaves: no cron return_message, no webhook URL, no explanations, no metrics map.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { readPlatformFacts, environmentFromHost } = await import('../services/corporate/management/platformFacts.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const SECRET_TEXT = 'https://hooks.invalid/secret-path-0123';

const runtime = (overrides = {}) => ({
  build: () => ({ commit_sha: '166025842bc2bae024c13162c2f3623617f88277', commit_sha_short: '16602584', branch: 'fix/x', deployment_id: 'dpl_abc', source: 'explicit_build_input', provenance_available: true }),
  databaseTarget: () => ({ supabase_project_ref: 'eoyenigwevnxwwhyhaer', postgres_project_refs: ['eoyenigwevnxwwhyhaer'], unrecognised_endpoints: 0, unrecognised_endpoint_names: [], consistent: true }),
  communicationConfiguration: () => ({
    status: 'BLOCKED', ready: false, explanations: [`missing ${SECRET_TEXT}`], scheduler: { status: 'READY' }, fakeAdapters: { enabled: false, status: 'READY' },
    providers: [
      { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true, explanations: [] },
      { channel: 'sms', provider: 'twilio', status: 'BLOCKED', available: false, explanations: ['sms provider credentials are missing'] },
    ],
    marketingEmail: { webhookUrl: SECRET_TEXT },
  }),
  outbound: () => ({ kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled', control: 'COMMUNICATION_OUTBOUND_DISABLED' }),
  probeSessionAuthority: async () => ({ connected: true, client_tls: true, client_tls_authorized: true, postgres_backend_tls: true, runtime_role: 'carup_session_runtime', verification: 'verify-full', trust_anchor: 'Supabase Root 2021 CA' }),
  ledgerIntentBacklog: async () => 0,
  outboxBacklog: async () => 3,
  schedulerHealth: async () => ({
    pg_cron_available: true, pg_net_available: true,
    job_config: { jobname: 'carup-communication-worker-every-minute', schedule: '* * * * *', active: true },
    latest_run: { status: 'succeeded', start_time: '2026-10-17T23:59:00Z', return_message: SECRET_TEXT },
    latest_success: { start_time: '2026-10-17T23:59:00Z' },
    latest_http_call: { status_code: 200 },
    stale_lock_count: 0,
  }),
  ...overrides,
});

const factsOf = async (rt, host = 'api-staging.carup.dev') => {
  const out = await readPlatformFacts({ now: NOW, host, runtime: rt });
  return { out, f: Object.fromEntries(out.facts.map((x) => [x.id, x])) };
};

test('each runtime authority is its own Technical fact — no health score', async () => {
  const { out, f } = await factsOf(runtime());
  assert.equal(f['platform.build.commit'].value, '16602584');
  assert.match(f['platform.build.commit'].detail, /dpl_abc/);
  assert.equal(f['platform.environment'].value, 'staging');
  assert.equal(f['platform.database.consistency'].value, 'consistent');
  assert.match(f['platform.database.consistency'].detail, /eoyenigwevnxwwhyhaer/);
  assert.equal(f['platform.session_authority'].value, 'healthy');
  assert.match(f['platform.session_authority'].detail, /verify-full/);
  assert.equal(f['platform.communications.kill_switch'].value, 'active — external sends disabled');
  assert.equal(f['platform.communications.scheduler'].value, 'worker job active');
  assert.equal(f['platform.outbox.backlog'].value, 3);
  assert.equal(f['platform.ledger_intent.backlog'].value, 0);
  assert.equal(f['platform.providers.ready'].value, 1);
  assert.deepEqual(out.providers, [
    { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
    { channel: 'sms', provider: 'twilio', status: 'BLOCKED', available: false },
  ]);
  for (const x of out.facts) assert.equal(x.kind === 'technical' || x.value === null, true, x.id);
  assert.equal(out.facts.some((x) => /health score/i.test(x.label)), false);
});

test('nothing secret or free-text leaves the platform read model', async () => {
  const { out } = await factsOf(runtime());
  const text = JSON.stringify(out);
  assert.equal(text.includes(SECRET_TEXT), false);
  assert.equal(text.includes('carup_session_runtime'), false, 'the database role name is not needed and is not exposed');
  assert.equal(/explanations|webhookUrl|endpointsLatency|failuresByUrl/.test(text), false);
});

test('active certification sessions are unavailable with the exact reason', async () => {
  const { f } = await factsOf(runtime());
  const s = f['platform.certification_sessions'];
  assert.equal(s.state, 'UNAVAILABLE_NO_SOURCE');
  assert.equal(s.value, null);
  assert.match(s.reason, /AUTH-05/);
});

test('a conflicting build identity, a failed probe and a failed backlog read are degraded — never healthy or 0', async () => {
  const { f } = await factsOf(runtime({
    build: () => ({ commit_sha: null, commit_sha_short: null, source: 'conflict', provenance_available: false }),
    probeSessionAuthority: async () => { throw new Error('ECONNREFUSED'); },
    outboxBacklog: async () => { throw new Error('down'); },
    ledgerIntentBacklog: async () => null,
    schedulerHealth: async () => { throw new Error('rpc down'); },
  }));
  assert.equal(f['platform.build.commit'].state, 'DEGRADED');
  assert.equal(f['platform.session_authority'].state, 'DEGRADED');
  assert.equal(f['platform.outbox.backlog'].state, 'DEGRADED');
  assert.equal(f['platform.ledger_intent.backlog'].state, 'DEGRADED');
  assert.equal(f['platform.communications.scheduler'].state, 'DEGRADED');
});

test('an unhealthy TLS posture is reported as such, and an inconsistent database target says so', async () => {
  const { f } = await factsOf(runtime({
    probeSessionAuthority: async () => ({ connected: true, client_tls: true, client_tls_authorized: false, postgres_backend_tls: true, verification: 'verify-full', trust_anchor: 'Supabase Root 2021 CA' }),
    databaseTarget: () => ({ supabase_project_ref: 'a', postgres_project_refs: ['a', 'b'], unrecognised_endpoints: 1, unrecognised_endpoint_names: ['X_URL'], consistent: false }),
  }));
  assert.equal(f['platform.session_authority'].value, 'unhealthy');
  assert.equal(f['platform.database.consistency'].value, 'inconsistent');
});

test('the environment comes from the API host, never from the Vercel target label', () => {
  assert.equal(environmentFromHost('api-staging.carup.dev'), 'staging');
  assert.equal(environmentFromHost('carup-backend-staging-r0iu53cfv-11-11.vercel.app'), 'staging');
  assert.equal(environmentFromHost('carup-backend-staging.vercel.app'), 'staging');
  assert.equal(environmentFromHost('localhost'), 'local');
  assert.equal(environmentFromHost('api.example.org'), 'unrecognised');
});

// ── CA-OWNER-02-R3 (D3) — the scheduler-health read is bounded by the application ─────────────────────────────────────
const { createSchedulerHealthRead } = await import('../services/corporate/management/platformFacts.js');
const SCHEDULER_DATA = {
  pg_cron_available: true, job_config: { jobname: 'carup-communication-worker-every-minute', schedule: '* * * * *', active: true },
  latest_run: { status: 'succeeded', start_time: '2026-10-17T23:59:00Z' }, latest_success: { start_time: '2026-10-17T23:59:00Z' }, stale_lock_count: 0,
};

test('R3 D3: a slow scheduler-health RPC never holds the read — the figure says it is still being read, and why', async () => {
  let calls = 0;
  let release;
  const slowRpc = new Promise((resolve) => { release = resolve; });
  const client = { rpc: (name) => { calls += 1; assert.equal(name, 'get_communication_scheduler_health'); return slowRpc; } };
  const read = createSchedulerHealthRead(client, { budgetMs: 20, now: () => NOW.getTime() });
  const started = Date.now();
  const { f } = await factsOf(runtime({ schedulerHealthRead: read }));
  assert.ok(Date.now() - started < 2_000, 'the read did not wait for the slow RPC');
  const s = f['platform.communications.scheduler'];
  assert.equal(s.state, 'DEGRADED');
  assert.equal(s.value, null);
  assert.match(s.reason, /still running/);
  assert.match(s.reason, /scans the full cron run history/);
  release({ data: SCHEDULER_DATA, error: null });
  await new Promise((r) => setImmediate(r));
  const second = (await factsOf(runtime({ schedulerHealthRead: read }))).f['platform.communications.scheduler'];
  assert.equal(second.state, 'TECHNICAL_OPERATIONAL');
  assert.equal(second.value, 'worker job active');
  assert.match(second.detail, /Read at most every 5 minutes/);
  assert.equal(calls, 1, 'the slow RPC was started once and its answer reused');
});

test('R3 D3: a cached scheduler reading states the time it was really read, and the RPC is not repeated inside 5 minutes', async () => {
  let t = NOW.getTime() - 120_000;
  let calls = 0;
  const client = { rpc: async () => { calls += 1; return { data: SCHEDULER_DATA, error: null }; } };
  const read = createSchedulerHealthRead(client, { budgetMs: 50, now: () => t });
  await factsOf(runtime({ schedulerHealthRead: read }));
  t = NOW.getTime();
  const s = (await factsOf(runtime({ schedulerHealthRead: read }))).f['platform.communications.scheduler'];
  assert.equal(s.as_of, new Date(NOW.getTime() - 120_000).toISOString(), 'the figure keeps the time of the real read');
  assert.equal(calls, 1);
});

test('R3 D3: a failed scheduler-health RPC is DEGRADED and never cached as a value', async () => {
  const client = { rpc: async () => ({ data: null, error: { message: 'permission denied' } }) };
  const read = createSchedulerHealthRead(client, { budgetMs: 50, now: () => NOW.getTime() });
  const s = (await factsOf(runtime({ schedulerHealthRead: read }))).f['platform.communications.scheduler'];
  assert.equal(s.state, 'DEGRADED');
  assert.equal(s.value, null);
  assert.doesNotMatch(JSON.stringify(s), /permission denied/, 'the provider error text never leaves');
});
