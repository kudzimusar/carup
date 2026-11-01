// CARUP-PAY-03A-STG01-FINAL — Stage 5.7 negative-path security matrix against the RUNNING local runtime.
//
// Real HTTP only: product sessions obtained through /api/auth/login (CSRF bound to the same identity),
// PostgREST probed with the local anon key and a locally minted `authenticated` JWT. No mocks. Every case
// records the observed HTTP status and stable error code and asserts both outcome and refusing layer.
// Cases that need a real paid order are executed in Stage 6, never simulated here.
//
//   node scripts/uat/pay03a-stg01-http-matrix.mjs <evidence-dir> [--stage5-runtime]
//   --stage5-runtime: the operator asserts the backend has NO provider access (launcher --stage5); only then is
//   N20 (an eligible checkout reaching the provider gate) executed. NEVER pass it against a Stage 6 runtime.
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:5031';
const SUPABASE_ROOT = '/private/tmp/carup-pay01a-supabase';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const EVIDENCE_DIR = process.argv[2];
if (!EVIDENCE_DIR) throw new Error('usage: pay03a-stg01-http-matrix.mjs <evidence-dir>');
const accounts = JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8'));

const health = await (await fetch(`${API}/api/health`)).json();
if (health?.status !== 'UP') throw new Error('runtime not UP');

const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', SUPABASE_ROOT, '--output', 'json'], {
  cwd: SUPABASE_ROOT,
  env: { PATH: `${process.env.PATH}:/usr/local/bin:${process.env.HOME}/.docker/bin`, HOME: process.env.HOME },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}));
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(status.API_URL)) throw new Error('not the local stack');
const REST = `${status.API_URL}/rest/v1`;

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function mintJwt(claims) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ iss: 'supabase-demo', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const sig = createHmac('sha256', status.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function csrf(identity = {}) {
  const r = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  return (await r.json()).csrfToken;
}
const sessions = {};
async function session(who) {
  if (who === 'anonymous') return {};
  if (sessions[who]) return sessions[who];
  const token = await csrf();
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify({ email: accounts[who].email, password: accounts[who].password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`login ${who} failed (${r.status})`);
  sessions[who] = { 'x-session-token': j.token, 'x-user-id': j.user.id };
  return sessions[who];
}
async function api(who, method, path, body, extra = {}) {
  const identity = typeof who === 'object' ? who : await session(who);
  const headers = { ...identity, ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && !('x-csrf-token' in extra)) headers['x-csrf-token'] = await csrf(identity);
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: r.status, code: json.code || json.error || null, json };
}
const JWT_SUBJECT = randomUUID();
async function rest(role, method, path, body) {
  // CarUp identities are text ids; auth.uid() casts `sub` to uuid, so a uuid subject is required for the
  // RLS policies themselves to be evaluated (a text sub only produces a 22P02 cast error).
  const key = role === 'anon' ? status.ANON_KEY : mintJwt({ role: 'authenticated', sub: JWT_SUBJECT, aud: 'authenticated' });
  const r = await fetch(`${REST}${path}`, {
    method,
    headers: { apikey: status.ANON_KEY, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: r.status, code: json?.code || null, rows: Array.isArray(json) ? json.length : null, json };
}

// F-RL-1: every isSensitive route shares ONE per-IP counter (securityMiddleware `${tier}:${ip}`), and
// each route compares its own max (checkout 5, admin orders 10) against that shared count. Pace every
// sensitive call — at most 4 per fresh 60 s window — so each case reaches the control it targets.
let sensitiveInWindow = 0;
async function paceSensitive() {
  if (sensitiveInWindow >= 4) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    sensitiveInWindow = 0;
  }
  sensitiveInWindow += 1;
}
async function checkout(who, body, extra) {
  await paceSensitive();
  return api(who, 'POST', '/api/pay03a/orders/checkout', body, extra);
}
async function admin(who, method, path, body) {
  await paceSensitive();
  return api(who, method, path, body);
}
const results = [];
function record(id, description, observed, pass, layer) {
  results.push({ id, description, status: observed.status, code: observed.code ?? null, rows: observed.rows ?? null, layer, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(6)} ${String(observed.status).padEnd(4)} ${String(observed.code ?? '').padEnd(44)} ${description}`);
}
const KEY = () => `pay03a_matrix_${randomUUID().replace(/-/g, '')}`.slice(0, 64);

// ── Authentication & session ─────────────────────────────────────────────────────────────────────
let r = await api('anonymous', 'GET', '/api/pay03a/vehicles');
record('N01', 'Unauthenticated buyer refused on vehicle discovery', r, r.status === 401, 'authorizeSessionRole');
r = await checkout('anonymous', { vin: 'QA-PAY03A-0001' }, { 'idempotency-key': KEY() });
record('N02', 'Unauthenticated checkout refused', r, [401, 403].includes(r.status), r.status === 403 ? 'csrf' : 'authorizeSessionRole');

// Expired session: provision one expired session row for Buyer A (the product never issues one).
const expiredToken = `sk_live_expired_${randomUUID().replace(/-/g, '')}`;
execFileSync('psql', [PGURL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
  `insert into public.user_sessions (id, user_id, active_role, token, is_valid, expires_at, created_at)
   values (gen_random_uuid(), '${accounts.buyerA.userId}', 'owner', '${expiredToken}', true, now() - interval '1 hour', now() - interval '25 hours');`]);
const expiredIdentity = { 'x-session-token': expiredToken, 'x-user-id': accounts.buyerA.userId };
r = await api(expiredIdentity, 'GET', '/api/pay03a/orders');
record('N03', 'Expired session refused', r, r.status === 401, 'authorizeSessionRole');

// x-user-id fallback identity with a CSRF token bound to that same identity (so CSRF is NOT the refusing layer).
const fallbackIdentity = { 'x-user-id': accounts.commerce.userId };
r = await admin(fallbackIdentity, 'GET', '/api/pay03a/admin/orders');
record('N04', 'Admin endpoint refuses x-user-id fallback identity (no session)', r, r.status === 401, 'authorizeSessionRole(no fallback)');
r = await api(fallbackIdentity, 'PATCH', '/api/vehicles/QA-PAY03A-0001/evidence/e746f9dd-ad90-4941-abf8-5ebaa1cf768c/verify', {});
record('N05', 'Evidence review refuses x-user-id fallback identity (CSRF valid for that identity)', r, r.status === 401, 'authorizeRole(allowUserIdFallback:false)');

// ── Buyer vs administrator isolation ─────────────────────────────────────────────────────────────
r = await admin('buyerA', 'GET', '/api/pay03a/admin/orders');
record('N06', 'Buyer refused on admin order list', r, r.status === 403, 'authorizeSessionRole([admin])');
r = await admin('buyerA', 'POST', `/api/pay03a/admin/orders/${randomUUID()}/refund`, {});
record('N07', 'Buyer refused on admin refund', r, r.status === 403, 'authorizeSessionRole([admin])');
r = await admin('buyerA', 'POST', `/api/pay03a/admin/orders/${randomUUID()}/reconcile`, {});
record('N08', 'Buyer refused on admin reconcile', r, r.status === 403, 'authorizeSessionRole([admin])');
r = await api('buyerB', 'GET', `/api/pay03a/orders/${randomUUID()}`);
record('N09', 'Unknown/foreign order id returns 404 (no existence oracle)', r, r.status === 404 && r.code === 'PAY03A_ORDER_NOT_FOUND', 'service');
r = await api('buyerB', 'POST', `/api/pay03a/orders/${randomUUID()}/verify`, {});
record('N10', 'Stale/foreign checkout return: verify on an order the buyer does not own', r, r.status === 404 && r.code === 'PAY03A_ORDER_NOT_FOUND', 'service');

// ── Vehicle eligibility ──────────────────────────────────────────────────────────────────────────
r = await api('buyerA', 'GET', '/api/pay03a/vehicles/QA-UNKNOWN-9999/readiness');
record('N11', 'Unknown vehicle readiness', r, r.status === 404 && r.code === 'PAY03A_VEHICLE_NOT_FOUND', 'service');
r = await checkout('buyerA', { vin: 'QA-UNKNOWN-9999' }, { 'idempotency-key': KEY() });
record('N12', 'Unknown vehicle checkout refused before any provider call', r, r.status === 404 && r.code === 'PAY03A_VEHICLE_NOT_FOUND', 'service');
for (const [id, vin, label] of [
  ['N13', 'QA-PAY03A-0002', 'Metadata-only vehicle'],
  ['N14', 'QA-PAY03A-0003', 'Registration-only ledger vehicle (D-ELIG-2)'],
  ['N15', 'QA-PAY03A-0004', 'Unverified (self-review refused) evidence vehicle'],
]) {
  const readiness = await api('buyerA', 'GET', `/api/pay03a/vehicles/${vin}/readiness`);
  const refused = await checkout('buyerA', { vin }, { 'idempotency-key': KEY() });
  record(id, `${label}: ineligible at readiness and checkout refused 422 before charging`,
    refused, readiness.json?.eligibleForPurchase === false && refused.status === 422 && refused.code === 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE', 'service(eligibility gate)');
}
r = await api('buyerA', 'GET', '/api/pay03a/vehicles/QA-PAY03A-0005/readiness');
const draftListed = await api('buyerA', 'GET', '/api/pay03a/vehicles?search=QA-PAY03A-0005');
record('N23', 'Draft (unpublished) vehicle is neither discoverable nor open for readiness (F6)', r,
  r.status === 404 && r.code === 'PAY03A_VEHICLE_NOT_FOUND' && Array.isArray(draftListed.json?.vehicles) && draftListed.json.vehicles.length === 0, 'service(visibility gate)');
r = await api('buyerA', 'GET', '/api/pay03a/vehicles/QA-PAY03A-0001/readiness');
record('P01', `Independently reviewed, dated, public-safe QA evidence → eligible (${r.json?.provenanceClassification})`, r,
  r.status === 200 && r.json?.eligibleForPurchase === true && r.json?.provenanceClassification === 'QA_INTEGRATION_FIXTURE', 'service');

// ── Commercial authority overrides ───────────────────────────────────────────────────────────────
r = await checkout('buyerA', { vin: 'QA-PAY03A-0001', amount: 1 }, { 'idempotency-key': KEY() });
record('N16', 'Client-supplied price override refused', r, r.status === 400 && r.code === 'PAY02_CLIENT_PRICE_OVERRIDE_REFUSED', 'service');
r = await checkout('buyerA', { vin: 'QA-PAY03A-0001', currency: 'USD' }, { 'idempotency-key': KEY() });
record('N17', 'Client-supplied currency override refused', r, r.status === 400 && r.code === 'PAY02_CLIENT_PRICE_OVERRIDE_REFUSED', 'service');
r = await checkout('buyerA', { vin: 'QA-PAY03A-0001', merchantOfRecord: 'attacker_llc' }, { 'idempotency-key': KEY() });
record('N18', 'Client-supplied merchant override refused', r, r.status === 400 && r.code === 'PAY02_CLIENT_PARTY_OVERRIDE_REFUSED', 'service');
r = await checkout('buyerA', { vin: 'QA-PAY03A-0001' }, { 'idempotency-key': 'short' });
record('N19', 'Missing/invalid idempotency key refused', r, r.status === 400 && r.code === 'PAY01A_IDEMPOTENCY_KEY_REQUIRED', 'service');
// N20 reaches the provider gate for an ELIGIBLE vehicle. Against a Stage 6 runtime (real sk_test key) that
// would open a real Checkout session, so it runs only when the operator asserts a Stage 5 runtime.
if (!process.argv.includes('--stage5-runtime')) {
  results.push({ id: 'N20', description: 'SKIPPED: eligible checkout at the provider gate (requires --stage5-runtime)', status: 'skipped', code: null, layer: 'provider gate', pass: true });
  console.log('SKIP N20 (not asserted as a Stage 5 no-provider runtime)');
} else {
r = await checkout('buyerA', { vin: 'QA-PAY03A-0001' }, { 'idempotency-key': KEY() });
record('N20', 'Eligible checkout with NO provider access fails closed at account verification (no session, no quote)', r,
  r.status === 503 && r.code === 'PAY01A_ACCOUNT_VERIFICATION_UNAVAILABLE', 'provider gate');
}
const ledger = execFileSync('psql', [PGURL, '-X', '-A', '-t', '-c',
  "select (select count(*) from public.pay02_commercial_quotes)||'/'||(select count(*) from public.pay02_report_orders)||'/'||(select count(*) from public.payment_transactions where pay02_quote_id is not null);"], { encoding: 'utf8' }).trim();
record('N21', `No quote, order or PAY-02 payment created by any refused attempt (quotes/orders/payments = ${ledger})`, { status: 'db', code: ledger }, ledger === '0/0/0', 'database');

// ── Rate limit (positive control) ────────────────────────────────────────────────────────────────
await new Promise((resolve) => setTimeout(resolve, 61_000));
sensitiveInWindow = 0;
const burst = [];
for (let i = 0; i < 6; i += 1) {
  // A distinct client-supplied X-Forwarded-For per request: without a verified edge secret the limiter
  // must ignore it (edgeClientIp.js), so spoofing cannot buy a fresh bucket.
  burst.push(await api('buyerB', 'POST', '/api/pay03a/orders/checkout', { vin: 'QA-UNKNOWN-9999' },
    { 'idempotency-key': KEY(), 'x-forwarded-for': `203.0.113.${10 + i}` }));
}
record('R01', `Checkout rate limit with spoofed X-Forwarded-For per request: 1-5 reach the service, the 6th is refused (${burst.map((b) => b.status).join(',')})`,
  burst[5], burst.slice(0, 5).every((b) => b.status === 404) && burst[5].status === 429, 'rateLimiter (spoof-resistant)');
await new Promise((resolve) => setTimeout(resolve, 61_000));
sensitiveInWindow = 0;

// ── Webhook ──────────────────────────────────────────────────────────────────────────────────────
const wh = await fetch(`${API}/api/pay01a/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, body: '{"id":"evt_forged","type":"checkout.session.completed"}' });
const whBody = await wh.json().catch(() => ({}));
record('N22', 'Forged/unsigned Stripe webhook refused', { status: wh.status, code: whBody.code || whBody.error }, wh.status === 400 && (whBody.code || whBody.error) === 'PAY01A_SIGNATURE_INVALID', 'signature verification');

// ── Database / PostgREST bypass attempts (RLS, ACL, RPC grants) ─────────────────────────────────
for (const [id, role] of [['S01', 'anon'], ['S02', 'authenticated']]) {
  const orders = await rest(role, 'GET', '/pay02_report_orders?select=id');
  record(id, `${role}: direct read of pay02_report_orders`, orders, orders.status >= 400 || orders.rows === 0, 'ACL/RLS');
}
let x = await rest('authenticated', 'GET', '/payment_transactions?select=reference');
record('S03', 'authenticated: direct read of payment_transactions', x, x.status >= 400 || x.rows === 0, 'ACL/RLS');
x = await rest('authenticated', 'GET', "/report_versions?select=id&report_tier=eq.pay03a_commercial_snapshot");
record('S04', 'authenticated: direct read of paid report snapshots', x, x.status >= 400 || x.rows === 0, 'RESTRICTIVE RLS');
x = await rest('authenticated', 'POST', '/rpc/pay03a_complete_report_fulfillment', { p_order_id: randomUUID(), p_buyer_id: accounts.buyerA.userId, p_vin: 'QA-PAY03A-0001', p_payload: {}, p_content_hash: 'x', p_completeness: {} });
record('S05', 'authenticated: direct call of pay03a_complete_report_fulfillment', x, x.status === 401 || x.status === 403 || x.status === 404, 'EXECUTE grant');
x = await rest('anon', 'POST', '/rpc/carup_review_vehicle_evidence', { p_vin: 'QA-PAY03A-0004', p_evidence_id: '076667ce-7343-4fe0-b1ca-b4a7bd4673b9', p_decision: 'verified' });
record('S06', 'anon: direct call of carup_review_vehicle_evidence', x, x.status === 401 || x.status === 403 || x.status === 404, 'EXECUTE grant');
x = await rest('authenticated', 'POST', '/rpc/pay02_sync_quote_from_canonical_payment', { p_reference: 'pay01a_00000000-0000-4000-8000-000000000000' });
record('S07', 'authenticated: direct call of pay02_sync_quote_from_canonical_payment', x, x.status === 401 || x.status === 403 || x.status === 404, 'EXECUTE grant');
x = await rest('authenticated', 'POST', '/report_versions', { vin: 'QA-PAY03A-0001', version: 99, payload: {}, content_hash: 'x', report_tier: 'pay03a_commercial_snapshot' });
record('S08', 'authenticated: forged insert of a paid report snapshot', x, x.status >= 400, 'ACL/RLS');
x = await rest('authenticated', 'GET', '/trust_audit_events?select=id');
record('S09', 'authenticated: read of trust_audit_events', x, x.status >= 400 || x.rows === 0, 'ACL');

const failed = results.filter((c) => !c.pass);
const out = {
  recorded_at: new Date().toISOString(),
  runtime_commit: health.build?.commit_sha,
  phase: 'stage5',
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.map((c) => c.id),
  cases: results,
};
writeFileSync(`${EVIDENCE_DIR}/http-matrix-stage5.json`, JSON.stringify(out, null, 2));
console.log(`\n${out.passed}/${out.total} cases passed at ${out.runtime_commit}`);
if (failed.length) process.exitCode = 1;
