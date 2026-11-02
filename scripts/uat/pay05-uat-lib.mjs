// CARUP-PAY-05-LR01 — shared helpers for the PAY-05 local UAT scripts (the dedicated carup-pay04-supabase stack, reused).
//   API 127.0.0.1:5051 · Paynow protocol simulator 127.0.0.1:5071 · PostgreSQL 127.0.0.1:56322
//   evidence ~/carup-launch-evidence/pay05 (0700/0600, outside the repository)
//
// The PAY-04 helpers (login, CSRF, identity headers, SQL, pacing) are reused as they are; their pacing state is shared,
// so a PAY-04 call and a PAY-05 call made by the same script are paced against each other.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as base from './pay04-uat-lib.mjs';

export { API, WEB, PGURL, sql, lit, msg, code, csrf, login, identity, pause, paceGlobal, paceSensitive, quietSensitiveWindow } from './pay04-uat-lib.mjs';

export const SIM = 'http://127.0.0.1:5071'; // never a WHATWG fetch "bad port" (5060/5061 = SIP)
export const EVIDENCE_DIR = `${homedir()}/carup-launch-evidence/pay05`;
export const ACCOUNTS_FILE = `${EVIDENCE_DIR}/uat-accounts.json`;
export const CONTROL_TOKEN_FILE = `${EVIDENCE_DIR}/runtime/simulator-control-token`;
export const AUTHORITY = 'MODERATOR-CARUP-PAY-05-LR01-LEVEL1-LOCAL-PAYNOW-PROTOCOL-SIMULATOR';

/** The database must be the one scripts/uat/pay05-local-db-build.sh built (ledger-proven), never another stack. */
export function requirePay05UatDatabase() {
  base.requirePay04UatDatabase();
  if (base.sql("select count(*) from carup_uat.migration_ledger where version = 'local-alignment:pay05-001-enable-paynow-protocol-simulator'") !== '1') {
    throw new Error('refusing: target is not the PAY-05 local UAT database built by pay05-local-db-build.sh');
  }
  if (base.sql('select paynow_real_enabled::text from public.pay05_runtime_guard where singleton') !== 'false') {
    throw new Error('refusing: real Paynow is not off in this database');
  }
}

// Every route under /api/pay05/ is behind the shared SENSITIVE per-IP limiter (server.js), whatever the method — and so
// is Paynow's resulturl, which the simulator posts to from the same 127.0.0.1. Pace PAY-05 calls like PAY-04's
// sensitive writes, and reserve one sensitive slot for every status update the simulator will deliver (`expectCallback`).
const PAY05_SENSITIVE = /^\/api\/pay05\//;
export async function call(method, path, body, ident = {}, extra = {}, opts = {}) {
  if (opts.pace !== false && PAY05_SENSITIVE.test(path)) await base.paceSensitive();
  return base.call(method, path, body, ident, extra, opts);
}
export async function expectCallback() { await base.paceSensitive(); }

// ── the local Paynow protocol simulator's TEST controls (never part of Paynow's merchant API) ──
let controlToken = null;
function token() {
  controlToken ||= readFileSync(CONTROL_TOKEN_FILE, 'utf8').trim();
  return controlToken;
}
export async function simControl(method, route, body) {
  const res = await fetch(`${SIM}/__control${route}`, {
    method, headers: { 'x-simulator-control-token': token(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`simulator control ${method} ${route} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
export const simTransactions = () => simControl('GET', '/transactions');
/** The simulator's transaction for a CarUp payment reference (one Paynow request per collection: exactly one). */
export async function simTransactionsFor(reference) {
  return (await simTransactions()).filter((t) => t.reference === reference);
}
/** Change a transaction's Paynow status; with notify, the simulator POSTs the signed status update to CarUp's resulturl. */
export async function simSetStatus(guid, status, { notify = true } = {}) {
  if (notify) await expectCallback();
  return simControl('POST', `/transactions/${guid}/status`, { status, notify });
}
export async function simResend(guid) { await expectCallback(); return simControl('POST', `/transactions/${guid}/resend`, {}); }
export const simForged = (guid, { status = 'Paid', tamper = false } = {}) => simControl('POST', `/transactions/${guid}/forged`, { status, tamper });
export const simFault = (kind, fault) => simControl('POST', '/faults', { kind, fault });
export const simOtpOutbox = () => simControl('GET', '/otp');

/** The hosted (simulated) Paynow page: what the customer's browser would do there. Returns the 302 back to CarUp. */
export async function simHostedPay(checkoutUrl, outcome = 'pay') {
  const url = new URL(checkoutUrl);
  if (url.origin !== SIM) throw new Error(`refusing: checkout URL ${url.origin} is not the local simulator`);
  await expectCallback();
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ outcome }), redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return { status: res.status, location: res.headers.get('location') };
}

/** POST a raw form body to a collection's resulturl, as Paynow (or an attacker) would. */
export async function postResult(collectionId, body) {
  await base.paceSensitive();
  await base.paceGlobal();
  const res = await fetch(`${base.API}/api/pay05/paynow/webhook/${collectionId}`, { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return { status: res.status, json: await res.json().catch(() => null) };
}
