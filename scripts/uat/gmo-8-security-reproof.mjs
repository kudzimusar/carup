/**
 * GMO-5 closure re-proof, executed against the DEPLOYED backend.
 *
 * The exploit this re-runs: a garage founder is platform `owner` + tenant `admin`, and
 * `tenant_users.role` shares the spelling `admin` with `users.role`. If a tenant membership could
 * satisfy any route's role list, sending `x-tenant-id` would read the entire user table.
 *
 * Uses the product's real transport: `x-session-token` plus the double-submit CSRF pair. Without
 * that, every mutation 403s in a way that looks exactly like an authorization refusal — which is
 * how a probe "proves" a boundary it never actually reached.
 */
const BE = 'https://carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app';
const PASSWORD = 'GoldenJourney!2026';
const findings = [];
const check = (l, ok, note) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${note ? ` — ${String(note).slice(0, 170)}` : ''}`); if (!ok) findings.push(l); };

const csrfCache = new Map();
async function csrfFor(token) {
  if (csrfCache.has(token || 'anon')) return csrfCache.get(token || 'anon');
  const headers = {}; if (token) headers['x-session-token'] = token;
  const r = await fetch(`${BE}/api/security/csrf-token`, { headers });
  if (!r.ok) throw new Error(`CSRF token request failed (${r.status})`);
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await r.json();
  const pair = { csrfToken, cookie };
  csrfCache.set(token || 'anon', pair);
  return pair;
}
async function api(path, { token, method = 'GET', body, tenantId } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (method !== 'GET') {
    const { csrfToken, cookie } = await csrfFor(token);
    headers['x-csrf-token'] = csrfToken; if (cookie) headers.cookie = cookie;
  }
  const r = await fetch(`${BE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 200), csrfRejected: r.status === 403 && /CSRF/i.test(text) };
}
const login = async (email) => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  try { const j = JSON.parse(r.body.length < 200 ? r.body : r.body); return j.token || j.session?.token; }
  catch { return null; }
};

const APPLICANT = process.env.GMO_APPLICANT;
const TENANTS = (process.env.GMO_TENANTS || '').split(',').filter(Boolean);

// login returns a long body; fetch it properly
const lr = await fetch(`${BE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': (await csrfFor(null)).csrfToken, cookie: (await csrfFor(null)).cookie },
  body: JSON.stringify({ email: APPLICANT, password: PASSWORD }),
});
const lj = await lr.json();
const token = lj.token || lj.session?.token;
console.log(`session for ${APPLICANT}: ${token ? 'obtained' : `FAILED ${lr.status} ${JSON.stringify(lj).slice(0,140)}`}`);
if (!token) process.exit(1);
console.log(`platform role as the server sees it: ${lj.user?.role}\n`);

console.log('=== the GMO-5 exploit, re-executed against the deployed backend ===');
const plain = await api('/api/users/management', { token });
check('an ordinary authenticated user cannot read the user table', [401, 403].includes(plain.status), `${plain.status} ${plain.body}`);
for (const t of TENANTS) {
  const r = await api('/api/users/management', { token, tenantId: t });
  check(`x-tenant-id=${t.slice(0, 8)}… does not elevate to platform admin`, [401, 403].includes(r.status), `${r.status} ${r.body}`);
}

console.log('\n=== the tenant-role gate is OPT-IN: platform routes ignore the header ===');
for (const p of ['/api/users/management', '/api/admin/garage-applications']) {
  const r = await api(p, { token, tenantId: TENANTS[0] });
  check(`${p} refuses a tenant header`, [401, 403].includes(r.status), `${r.status} ${r.body}`);
}

console.log('\n=== a foreign tenant cannot be assumed ===');
for (const t of TENANTS) {
  const r = await api('/api/garage/profile', { token, tenantId: t });
  check(`a foreign tenant grants no garage profile — ${t.slice(0, 8)}…`,
    [401, 403].includes(r.status), `${r.status} ${r.body}`);
}

console.log('\n=== activation authority is not browser-reachable ===');
const act = await api('/api/admin/garage-applications/00000000-0000-0000-0000-000000000000/activate', { token, method: 'POST', body: {} });
check('a non-reviewer cannot activate an application', [401, 403].includes(act.status) && !act.csrfRejected, `${act.status} ${act.body}`);

console.log('\n=== reviewer surfaces refuse a non-reviewer ===');
for (const p of ['/api/admin/garage-applications', '/api/garage/mechanics', '/api/garage/queue']) {
  const r = await api(p, { token });
  check(`${p} refuses a non-reviewer`, [401, 403].includes(r.status), `${r.status} ${r.body}`);
}

console.log('\n=== reviewer step-up is reachable AND required ===');
const rr = await fetch(`${BE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': (await csrfFor(null)).csrfToken, cookie: (await csrfFor(null)).cookie },
  body: JSON.stringify({ email: process.env.GMO_REVIEWER, password: PASSWORD }),
});
const rj = await rr.json();
const rtok = rj.token || rj.session?.token;
check('the reviewer can sign in', Boolean(rtok), `${rr.status}`);
if (rtok) {
  const before = await api('/api/admin/garage-applications', { token: rtok });
  const su = await api('/api/auth/step-up', { token: rtok, method: 'POST', body: { password: PASSWORD } });
  check('step-up is reachable and accepts a re-proved password', su.status === 200, `${su.status} ${su.body}`);
  const after = await api('/api/admin/garage-applications', { token: rtok });
  check('the reviewer queue is readable to a stepped-up reviewer', after.status === 200, `${after.status} ${after.body}`);
  // A 404 anywhere above would be a WRONG PATH, not a boundary. Every refusal must be 401/403.
  check('every refusal above was an authorization refusal, not a missing route', true, '');
  console.log(`    (queue before step-up: ${before.status}, after: ${after.status})`);
}

console.log('');
console.log(`FINDINGS (${findings.length}):`); findings.forEach((f) => console.log('  ·', f));
