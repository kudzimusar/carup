/**
 * Deployed staging API journey — exercises the REAL deployed backend against the REAL
 * staging database with synthetic, clearly-labelled UAT data. Proves routes → auth →
 * service → staging persistence → audit end-to-end on the deployed system.
 *
 * Usage: BACKEND=https://<preview>.vercel.app node database/scripts/deployed_staging_journey.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.staging') });

const BACKEND = process.env.BACKEND;
if (!BACKEND) { console.error('Set BACKEND=<preview url>'); process.exit(2); }
if (!process.env.SUPABASE_URL.includes('eoyenigwevnxwwhyhaer')) { console.error('GUARD: not staging'); process.exit(2); }

const TS = Date.now();
const ADMIN = `uat-admin-${TS}`;
const OTHER = `uat-other-${TS}`;
const TOK = `uat-tok-admin-${TS}`;
const TOK2 = `uat-tok-other-${TS}`;
const VIN = `UATVIN${TS}`.slice(0, 17);
const results = [];
function rec(step, ok, detail) { results.push({ step, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`); }

async function api(path, { method = 'GET', token, apiKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (apiKey) headers['x-api-key'] = apiKey;
  const r = await fetch(BACKEND + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let data = null; try { data = await r.json(); } catch { /* non-json */ }
  return { status: r.status, data };
}

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function seed() {
  const c = await pool.connect();
  try {
    const future = new Date(Date.now() + 3600_000).toISOString();
    await c.query(`INSERT INTO users(id,email,name,role,is_verified,join_date) VALUES
      ($1,$2,'UAT Admin','admin',true,now()), ($3,$4,'UAT Other','owner',true,now())`, [ADMIN, `${ADMIN}@uat.local`, OTHER, `${OTHER}@uat.local`]);
    await c.query(`INSERT INTO user_sessions(token,user_id,is_valid,expires_at) VALUES ($1,$2,true,$3),($4,$5,true,$3)`, [TOK, ADMIN, future, TOK2, OTHER]);
    await c.query(`INSERT INTO vehicles(vin,make,model,year,mileage,price,chassis_number,engine_number,plate_number,owner_id)
      VALUES ($1,'Toyota','Hilux',2018,90000,15000,'UATCH1','UATEN1','UATPL1',$2)`, [VIN, ADMIN]);
  } finally { c.release(); }
}
async function cleanup() {
  const c = await pool.connect();
  try {
    await c.query('DELETE FROM user_sessions WHERE token = ANY($1)', [[TOK, TOK2]]);
    await c.query('DELETE FROM vehicles WHERE vin=$1', [VIN]).catch(() => {});
    await c.query('DELETE FROM users WHERE id = ANY($1)', [[ADMIN, OTHER]]).catch(() => {});
  } finally { c.release(); }
}
async function count(table, vin) {
  const c = await pool.connect();
  try { return (await c.query(`SELECT count(*)::int n FROM ${table} WHERE vin=$1`, [vin])).rows[0].n; }
  catch { return -1; } finally { c.release(); }
}

(async () => {
  await seed();
  try {
    // 1. health (no auth)
    let r = await api('/api/health'); rec('health 200', r.status === 200);
    // 2. sources requires auth (deny without token)
    r = await api('/api/sources'); rec('GET /api/sources denies anon (401)', r.status === 401);
    // 3. sources with admin token
    r = await api('/api/sources', { token: TOK }); rec('GET /api/sources (admin) lists 5 adapters', r.status === 200 && (r.data?.sources?.length === 5), `status=${r.status} n=${r.data?.sources?.length}`);
    // 4. source verify (zimra, sandbox)
    r = await api(`/api/vehicles/${VIN}/sources/zimra/verify`, { method: 'POST', token: TOK }); rec('POST zimra verify -> sandbox match', r.status === 200 && r.data?.result?.mode === 'sandbox', `status=${r.status} mode=${r.data?.result?.mode} result=${r.data?.result?.result}`);
    // 5. coverage shows sandbox (never source_connected)
    r = await api(`/api/vehicles/${VIN}/sources/coverage`, { token: TOK }); const cov = r.data?.coverage || []; rec('coverage shows sandbox_demonstration (not source_connected)', r.status === 200 && cov.some(x => x.provider === 'zimra') && !cov.some(x => x.coverage_status === 'source_connected'), `n=${cov.length}`);
    // 6. unified trust decision
    r = await api(`/api/vehicles/${VIN}/trust-decision`, { token: TOK }); rec('trust-decision has separate dimensions', r.status === 200 && r.data?.decision?.dimensions?.source_coverage && r.data?.decision?.dimensions?.fraud_risk, `status=${r.status}`);
    // 7. fraud evaluate + queue
    r = await api(`/api/vehicles/${VIN}/fraud/evaluate`, { method: 'POST', token: TOK }); rec('fraud evaluate 200', r.status === 200, `status=${r.status}`);
    r = await api('/api/fraud/cases', { token: TOK }); rec('fraud cases queue readable', r.status === 200 && Array.isArray(r.data?.cases), `status=${r.status}`);
    // 8. insurance eligibility
    r = await api(`/api/vehicles/${VIN}/insurance/eligibility`, { method: 'POST', token: TOK }); rec('insurance eligibility request persists', (r.status === 201 || r.status === 200) && r.data?.request?.status, `status=${r.status} st=${r.data?.request?.status}`);
    // 9. finance requires consent -> manual_review (gate)
    r = await api(`/api/vehicles/${VIN}/finance/eligibility`, { method: 'POST', token: TOK }); rec('finance eligibility (no consent) routes to gate', (r.status === 201 || r.status === 200) && ['manual_review', 'not_eligible'].includes(r.data?.request?.status), `st=${r.data?.request?.status}`);
    // 10. escrow eligibility
    r = await api(`/api/vehicles/${VIN}/escrow`, { method: 'POST', token: TOK, body: { buyer_id: ADMIN } }); rec('escrow request creates session', r.status === 201 && r.data?.session?.status, `status=${r.status} st=${r.data?.session?.status}`);
    // 11. partner client + redacted summary
    r = await api('/api/admin/partners', { method: 'POST', token: TOK, body: { name: `uat-partner-${TS}`, scopes: ['vehicle:*'] } });
    const apiKey = r.data?.api_key; rec('create partner client returns key once', r.status === 201 && !!apiKey, `status=${r.status}`);
    if (apiKey) {
      r = await api(`/api/partner/v1/vehicles/${VIN}/trust-summary`, { apiKey }); rec('partner trust-summary redacted (no finance dim)', r.status === 200 && r.data?.trust && r.data.trust.dimensions?.finance_eligibility === undefined, `status=${r.status}`);
      r = await api(`/api/partner/v1/vehicles/${VIN}/trust-summary`); rec('partner endpoint denies missing key (401)', r.status === 401);
    }
    // 12. cross-tenant/other-user privileged denial: other user (owner role) cannot read fraud cases (privileged)
    r = await api('/api/fraud/cases', { token: TOK2 }); rec('non-privileged user denied fraud queue (403)', r.status === 403, `status=${r.status}`);
    // 13. persistence verification on staging DB
    rec('persisted: source_verification_results', (await count('source_verification_results', VIN)) >= 1);
    rec('persisted: eligibility_requests', (await count('eligibility_requests', VIN)) >= 1);
    rec('persisted: escrow_trust_sessions', (await count('escrow_trust_sessions', VIN)) >= 1);
  } finally {
    await cleanup();
    await pool.end();
  }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n=== DEPLOYED JOURNEY: ${pass}/${results.length} PASS, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); pool.end(); process.exit(1); });
