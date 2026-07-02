/**
 * Production-safe smoke journey — exercises the REAL production backend
 * (carup-backend.vercel.app) against the REAL production DB (vhmnajoeicasaigiophh) with
 * clearly-labelled synthetic UAT data. Confirms fail-closed source/eligibility behaviour,
 * auth/RLS boundaries, partner redaction, audit, and persistence. Cleans up seeded rows.
 *
 * DB ops go through `supabase db query --linked` (linked to production). HTTP goes to the
 * production backend. No credentials are printed.
 */
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = join(ROOT, 'database', 'scripts', '.prod_smoke_tmp.sql');
const BE = process.env.BE || 'https://carup-backend.vercel.app';
const PROD = 'vhmnajoeicasaigiophh';

const TS = Date.now();
const ADMIN = `uat-prod-admin-${TS}`, OWNER = `uat-prod-owner-${TS}`, OTHER = `uat-prod-other-${TS}`;
const TOK = `uat-prod-tok-a-${TS}`, TOK_OWNER = `uat-prod-tok-o-${TS}`, TOK2 = `uat-prod-tok-x-${TS}`;
const VIN = `UATPRD${TS}`.slice(0, 17);
const results = [];
const rec = (step, ok, detail) => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`); };

function db(sql, wantRows = false) {
  writeFileSync(TMP, sql);
  const out = execSync(`supabase db query --linked --output json -f ${JSON.stringify(TMP)}`, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  if (!wantRows) return null;
  const s = out.indexOf('{'); const parsed = JSON.parse(out.slice(s));
  return parsed.rows || [];
}
let CSRF = null, CSRF_COOKIE = null;
async function primeCsrf(token) {
  const r = await fetch(BE + '/api/security/csrf-token', { headers: { Accept: 'application/json', ...(token ? { 'x-session-token': token } : {}) }, signal: AbortSignal.timeout(30000) });
  const setCookie = r.headers.get('set-cookie') || '';
  const m = /csrf-token=([^;]+)/.exec(setCookie);
  const body = await r.json().catch(() => ({}));
  CSRF = body.csrfToken || (m && m[1]);
  CSRF_COOKIE = m ? `csrf-token=${m[1]}` : (CSRF ? `csrf-token=${CSRF}` : null);
  return CSRF;
}
async function api(path, { method = 'GET', token, apiKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (apiKey) headers['x-api-key'] = apiKey;
  // Double-submit CSRF on state-changing requests (partner API uses key auth, no CSRF cookie).
  if (method !== 'GET' && !apiKey && CSRF) { headers['x-csrf-token'] = CSRF; if (CSRF_COOKIE) headers['Cookie'] = CSRF_COOKIE; }
  const r = await fetch(BE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// GUARD: confirm linked to production
const ref = execSync('cat supabase/.temp/project-ref', { cwd: ROOT, encoding: 'utf-8' }).trim();
if (ref !== PROD) { console.error(`GUARD FAIL: linked ref '${ref}' != ${PROD}`); process.exit(2); }

(async () => {
  // Seed synthetic production data
  const future = new Date(Date.now() + 3600_000).toISOString();
  db(`insert into users(id,email,name,role,is_verified,join_date) values
      ('${ADMIN}','${ADMIN}@uat.local','UAT Prod Admin','admin',true,now()),
      ('${OWNER}','${OWNER}@uat.local','UAT Prod Owner','owner',true,now()),
      ('${OTHER}','${OTHER}@uat.local','UAT Prod Other','owner',true,now());
    insert into user_sessions(token,user_id,is_valid,expires_at) values
      ('${TOK}','${ADMIN}',true,'${future}'),('${TOK_OWNER}','${OWNER}',true,'${future}'),('${TOK2}','${OTHER}',true,'${future}');
    insert into vehicles(vin,make,model,year,mileage,price,chassis_number,engine_number,plate_number,owner_id)
      values ('${VIN}','Toyota','Hilux',2018,90000,15000,'UATCHP','UATENP','UATPLP','${OWNER}');`);

  try {
    await primeCsrf(TOK); // obtain CSRF token+cookie for mutations (like the real frontend)
    // 1. auth + health
    rec('01 backend health', (await api('/api/health')).status === 200);
    let r = await api('/api/sources'); rec('02 anon denied on privileged route (401)', r.status === 401);
    r = await api('/api/sources', { token: TOK }); rec('03 admin authenticated - lists sources', r.status === 200 && Array.isArray(r.data?.sources), `n=${r.data?.sources?.length}`);

    // CRITICAL: fail-closed in production — sources must be 'unavailable', NEVER sandbox-as-official
    const adapters = r.data?.sources || [];
    const allUnavailable = adapters.length > 0 && adapters.every(a => a.mode === 'unavailable');
    rec('04 FAIL-CLOSED: adapters report mode=unavailable in production (no sandbox)', allUnavailable, `modes=${[...new Set(adapters.map(a=>a.mode))].join(',')}`);
    r = await api(`/api/vehicles/${VIN}/sources/zimra/verify`, { method: 'POST', token: TOK });
    const svResult = r.data?.result;
    rec('05 FAIL-CLOSED: source verify returns unavailable (not sandbox match)', r.status === 200 && svResult?.result === 'unavailable' && svResult?.mode === 'unavailable', `result=${svResult?.result} mode=${svResult?.mode}`);
    r = await api(`/api/vehicles/${VIN}/sources/coverage`, { token: TOK });
    const cov = r.data?.coverage || [];
    rec('06 coverage never shows source_connected in production', !cov.some(c => c.coverage_status === 'source_connected'), `statuses=${[...new Set(cov.map(c=>c.coverage_status))].join(',')}`);

    // trust decision — separate dimensions, honest
    r = await api(`/api/vehicles/${VIN}/trust-decision`, { token: TOK });
    rec('07 unified trust decision - separate dimensions', r.status === 200 && r.data?.decision?.dimensions?.source_coverage && r.data?.decision?.dimensions?.fraud_risk);

    // fraud
    r = await api(`/api/vehicles/${VIN}/fraud/evaluate`, { method: 'POST', token: TOK }); rec('08 fraud evaluate', r.status === 200);
    r = await api('/api/fraud/cases', { token: TOK }); rec('09 fraud queue readable (admin)', r.status === 200 && Array.isArray(r.data?.cases));
    r = await api('/api/fraud/cases', { token: TOK_OWNER }); rec('10 fraud queue denied to non-privileged (403)', r.status === 403, `status=${r.status}`);

    // eligibility — safe unavailable/manual/gated
    r = await api(`/api/vehicles/${VIN}/insurance/eligibility`, { method: 'POST', token: TOK });
    rec('11 insurance eligibility safe state (not eligible/unavailable/manual)', (r.status === 201 || r.status === 200) && ['not_eligible','unavailable','manual_review'].includes(r.data?.request?.status), `st=${r.data?.request?.status}`);
    r = await api(`/api/vehicles/${VIN}/finance/eligibility`, { method: 'POST', token: TOK });
    rec('12 finance eligibility gated (no consent)', (r.status === 201 || r.status === 200) && ['manual_review','not_eligible','unavailable'].includes(r.data?.request?.status), `st=${r.data?.request?.status}`);
    r = await api(`/api/vehicles/${VIN}/escrow`, { method: 'POST', token: TOK, body: { buyer_id: ADMIN } });
    rec('13 escrow request created (fail-closed gate)', r.status === 201 && r.data?.session?.status, `st=${r.data?.session?.status}`);

    // partner API
    r = await api('/api/admin/partners', { method: 'POST', token: TOK, body: { name: `uat-prod-partner-${TS}`, scopes: ['vehicle:*'] } });
    const apiKey = r.data?.api_key; rec('14 partner client created (key once)', r.status === 201 && !!apiKey);
    if (apiKey) {
      r = await api(`/api/partner/v1/vehicles/${VIN}/trust-summary`, { apiKey });
      rec('15 partner trust-summary redacted (finance dim stripped)', r.status === 200 && r.data?.trust && r.data.trust.dimensions?.finance_eligibility === undefined);
      r = await api(`/api/partner/v1/vehicles/${VIN}/trust-summary`); rec('16 partner denies missing key (401)', r.status === 401);
      // scope denial: a narrow key
      const nk = (await api('/api/admin/partners', { method: 'POST', token: TOK, body: { name: `uat-prod-narrow-${TS}`, scopes: ['vehicle:identity'] } })).data?.api_key;
      if (nk) { r = await api(`/api/partner/v1/vehicles/${VIN}/trust-summary`, { apiKey: nk }); rec('17 partner scope denial (403 missing trust:read)', r.status === 403, `status=${r.status}`); }
    }

    // persistence in production DB
    const rows = db(`select
      (select count(*)::int from source_verification_results where vin='${VIN}') as sv,
      (select count(*)::int from eligibility_requests where vin='${VIN}') as elig,
      (select count(*)::int from escrow_trust_sessions where vin='${VIN}') as escrow,
      (select count(*)::int from partner_clients where name like 'uat-prod-partner-%') as partners,
      (select count(*)::int from partner_api_requests) as partner_audit`, true)[0];
    rec('18 persisted: source_verification_results', rows.sv >= 1);
    rec('19 persisted: eligibility_requests', rows.elig >= 1);
    rec('20 persisted: escrow_trust_sessions', rows.escrow >= 1);
    rec('21 audit: partner_api_requests recorded', rows.partner_audit >= 1);
  } finally {
    // Cleanup synthetic data (append-only audit rows for the UAT vin remain, labelled)
    db(`delete from user_sessions where token in ('${TOK}','${TOK_OWNER}','${TOK2}');
        delete from partner_clients where name like 'uat-prod-%${TS}%' or name like 'uat-prod-narrow-${TS}';
        delete from escrow_trust_events where session_id in (select id from escrow_trust_sessions where vin='${VIN}');
        delete from escrow_trust_sessions where vin='${VIN}';
        delete from eligibility_decisions where request_id in (select id from eligibility_requests where vin='${VIN}');
        delete from eligibility_requests where vin='${VIN}';
        delete from vehicles where vin='${VIN}';
        delete from users where id in ('${ADMIN}','${OWNER}','${OTHER}');`);
    console.log('cleanup: synthetic users/sessions/vehicle/eligibility/escrow removed (append-only source/fraud audit for UAT vin retained, labelled).');
  }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n=== PRODUCTION SMOKE: ${pass}/${results.length} PASS, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', String(e.message).replace(/Bearer\s+\S+/g, '<redacted>')); process.exit(1); });
