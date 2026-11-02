// CARUP-PAY-04-LR01 — shared helpers for the PAY-04 local UAT scripts (dedicated stack only).
//   API 127.0.0.1:5051 · PostgreSQL 127.0.0.1:56322 · evidence ~/carup-launch-evidence/pay04 (0700/0600, outside the repo).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export const API = 'http://127.0.0.1:5051';
export const WEB = 'http://127.0.0.1:5203';
export const PGURL = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';
export const EVIDENCE_DIR = `${homedir()}/carup-launch-evidence/pay04`;
export const ACCOUNTS_FILE = `${EVIDENCE_DIR}/uat-accounts.json`;
export const AUTHORITY = 'MODERATOR-CARUP-PAY-04-LR01-LEVEL1-LOCAL-SIMULATOR';

export function sql(statement) {
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
export const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** The database must be the one scripts/uat/pay04-local-db-build.sh built (ledger-proven), never another stack. */
export function requirePay04UatDatabase() {
  if (sql("select count(*) from carup_uat.migration_ledger where version = 'local-alignment:pay04-002-enable-garage-provider-simulator'") !== '1') {
    throw new Error('refusing: target is not the PAY-04 local UAT database built by pay04-local-db-build.sh');
  }
}

// Pacing (as the PAY-03B matrix): the global limiter allows 100 requests per IP per minute, and EVERY sensitive route
// shares ONE per-IP counter whose smallest cap is 5 per minute. The harness stays under both, so a 429 is never mistaken
// for a product refusal. Requests the backend makes to itself (simulator webhook delivery) share the IP: hence the margin.
const SENSITIVE = [/^\/api\/auth\/login/, /^\/api\/pay04\/garage-invoices\/[^/]+\/payments$/, /^\/api\/pay04\/garage-payments\//,
  /^\/api\/pay04\/garage\/payments\//, /^\/api\/pay03b\/admin\/reconciliation-exceptions/];
const GLOBAL_BUDGET = 80;
const SENSITIVE_SPACING_MS = 13_000;
const recent = [];
let lastSensitive = 0;
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function paceGlobal() {
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    if (recent.length < GLOBAL_BUDGET) { recent.push(now); return; }
    await pause(recent[0] + 60_000 - now + 50);
  }
}
export const isSensitive = (method, path) => method !== 'GET' && SENSITIVE.some((re) => re.test(path));
export async function paceSensitive() {
  const wait = lastSensitive + SENSITIVE_SPACING_MS - Date.now();
  if (wait > 0) await pause(wait);
  lastSensitive = Date.now();
}
/** Let the shared sensitive window expire, for a step that fires sensitive requests at once on purpose. */
export async function quietSensitiveWindow() {
  const wait = lastSensitive + 61_000 - Date.now();
  if (wait > 0) await pause(wait);
  lastSensitive = Date.now();
}

/** The refusal text of an API error ({ error: { code, message } }, or a flat { code, message }). */
export const msg = (r) => r?.json?.error?.message || r?.json?.message || (typeof r?.json?.error === 'string' ? r.json.error : '') || r?.json?.code || '';
export const code = (r) => r?.json?.error?.code || r?.json?.code || '';

/** Same contract as the web client: a CSRF token fetched with the same identity headers accompanies every write. */
export async function csrf(identity = {}) {
  await paceGlobal();
  const res = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  const body = await res.json();
  if (!body?.csrfToken) throw new Error(`csrf token unavailable (${res.status})`);
  return body.csrfToken;
}

export async function call(method, path, body, identity = {}, extra = {}, { withCsrf = true, pace = true } = {}) {
  if (pace && isSensitive(method, path)) await paceSensitive();
  const headers = { ...identity, 'content-type': 'application/json', ...extra };
  if (method !== 'GET' && withCsrf) headers['x-csrf-token'] = await csrf(identity);
  await paceGlobal();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, headers: res.headers };
}

export async function login(acct) {
  const r = await call('POST', '/api/auth/login', { email: acct.email, password: acct.password });
  if (r.status !== 200 || !r.json?.token) throw new Error(`login ${acct.email} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  return r.json.token;
}

export const identity = (acct, token, tenant = null) => ({
  'x-session-token': token, 'x-user-id': acct.userId, 'x-stakeholder-role': acct.role, ...(tenant ? { 'x-tenant-id': tenant } : {}),
});
