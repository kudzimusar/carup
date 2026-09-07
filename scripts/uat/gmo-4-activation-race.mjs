/**
 * GMO-4 — the concurrency test recorded as NOT EXECUTED.
 *
 * This is a concurrency test of the ACTIVATION FUNCTION, not a Golden Journey step. The approved
 * application it races against is created directly, and labelled as such: what is under test is
 * whether `activate_garage_application` is serialized, not whether onboarding produced the row.
 * The Golden Journey covers that separately, and does not use this.
 *
 * Each POST to /activate is its own serverless invocation and therefore its own database session,
 * so firing N together is a real race rather than a simulation of one.
 */
const BE = 'https://carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app';
const REVIEWER = process.argv.find((a) => a.startsWith('--reviewer='))?.split('=')[1];
const APP_ID = process.argv.find((a) => a.startsWith('--app='))?.split('=')[1];
const PASSWORD = 'GoldenJourney!2026';
const RACERS = 8;

const csrf = new Map();
async function csrfFor(token) {
  if (csrf.has(token)) return csrf.get(token);
  const r = await fetch(`${BE}/api/security/csrf-token`, { headers: token ? { 'x-session-token': token } : {} });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await r.json();
  const pair = { csrfToken, cookie }; csrf.set(token, pair); return pair;
}
async function api(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (method !== 'GET') { const { csrfToken, cookie } = await csrfFor(token); headers['x-csrf-token'] = csrfToken; if (cookie) headers.cookie = cookie; }
  const r = await fetch(`${BE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

const out = [];
const rec = (ok, name, detail) => { out.push({ ok, name, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

const login = await api('/api/auth/login', { method: 'POST', body: { email: REVIEWER, password: PASSWORD } });
const token = login.body?.token;
if (!token) throw new Error(`reviewer login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
await api('/api/auth/step-up', { method: 'POST', token, body: { password: PASSWORD } });

console.log(`\nfiring ${RACERS} concurrent activations at application ${APP_ID}\n`);
const t0 = Date.now();
const settled = await Promise.all(Array.from({ length: RACERS }, () => api(`/api/admin/garage-applications/${APP_ID}/activate`, { token, method: 'POST' })));
const ms = Date.now() - t0;

const ok = settled.filter((s) => [200, 201].includes(s.status) && s.body?.tenantId);
const createdTrue = ok.filter((s) => s.body.created === true);
const createdFalse = ok.filter((s) => s.body.created === false);
const tenants = new Set(ok.map((s) => s.body.tenantId));
const other = settled.filter((s) => ![200, 201].includes(s.status));

console.log(`  ${RACERS} calls in ${ms}ms · ok ${ok.length} · created=true ${createdTrue.length} · created=false ${createdFalse.length} · other ${other.length}`);
if (other.length) console.log(`  non-2xx sample: ${other[0].status} ${JSON.stringify(other[0].body).slice(0, 160)}`);

rec(tenants.size === 1, 'all winners report exactly ONE tenant', `distinct tenant_ids = ${tenants.size}`);
rec(createdTrue.length === 1, 'exactly ONE caller created it', `created=true = ${createdTrue.length}`);
rec(ok.length + other.length === RACERS, 'every call was answered', `${ok.length + other.length}/${RACERS}`);
// A losing racer must roll back completely: no second tenant, no orphan.
rec(other.every((s) => !s.body?.tenantId), 'no non-2xx call reported a tenant', `${other.length} non-2xx`);

const pass = out.filter((r) => r.ok).length;
console.log(`\nGMO-4 CONCURRENCY: ${pass}/${out.length} PASS · tenant ${[...tenants][0]}`);
process.exit(pass === out.length ? 0 : 1);
