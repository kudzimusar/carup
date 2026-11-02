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

/** Same contract as the web client: a CSRF token fetched with the same identity headers accompanies every write. */
export async function csrf(identity = {}) {
  const res = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  const body = await res.json();
  if (!body?.csrfToken) throw new Error(`csrf token unavailable (${res.status})`);
  return body.csrfToken;
}

export async function call(method, path, body, identity = {}, extra = {}, { withCsrf = true } = {}) {
  const headers = { ...identity, 'content-type': 'application/json', ...extra };
  if (method !== 'GET' && withCsrf) headers['x-csrf-token'] = await csrf(identity);
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
