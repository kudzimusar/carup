/**
 * GMO-8 Acts 3–6 — governed review, activation, context handoff, invitation, revocation.
 *
 * The acceptance sentence this closes:
 *
 *   "A person who has never been manually provisioned can register, apply to operate a legitimate
 *    Garage, pass governed review, receive a governed Garage context, invite a Mechanic, and use
 *    that newly-created relationship to complete a real Service Network job — with no SQL fixture
 *    standing in for onboarding authority."
 *
 * HOW EACH STEP IS DRIVEN, stated per step in the report rather than blurred:
 *   [browser] a person clicking the real product
 *   [api]     a real governed endpoint, with a real session and real step-up
 *   [db]      a READBACK only — never a write that stands in for a product action
 *
 * THE ONE PROVISIONED THING: the synthetic Operations reviewer's `users.role`. CarUp's staff are
 * provisioned by CarUp; there is no self-service path to becoming a compliance reviewer. Its account
 * was registered through the product like anyone else's.
 *
 * NOTHING constituting onboarding authority is provisioned. No SQL in this file creates a tenant, a
 * membership, an application, evidence, or a decision.
 *
 * Run: node scripts/uat/gmo-8-acts-3-to-6.mjs --reviewer=<email> [--viewport=desktop]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const FE = process.env.GMO_FE || 'https://carup-staging-git-feat-garage-mechanic-onboarding-1-0-11-11.vercel.app';
const BE = process.env.GMO_BE || 'https://carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app';
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const VIEW = arg('viewport', 'desktop');
const REVIEWER_EMAIL = arg('reviewer', '');
const PASSWORD = 'GoldenJourney!2026';
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 834, height: 1112 }, mobile: { width: 390, height: 844 } };
const OUT = `/tmp/gmo8-acts36-${Date.now().toString(36)}`;
mkdirSync(OUT, { recursive: true });

const results = [];
let n = 0;
const rec = (status, how, name, detail = '') => {
  n += 1;
  results.push({ n, status, how, name, detail });
  const m = { PASS: '✅', FAIL: '❌', SKIP: '⏭️ ', PROV: '🔧' }[status];
  console.log(`${m} ${String(n).padStart(2)}. [${how}] ${name}${detail ? ` — ${detail}` : ''}`);
};
async function step(how, name, fn) {
  try { rec('PASS', how, name, (await fn()) || ''); return true; }
  catch (e) { rec('FAIL', how, name, String(e.message).split('\n')[0].slice(0, 200)); return false; }
}

const stamp = Date.now().toString(36);
const OWNER = { first: 'Rutendo', last: 'Chikafu', email: `gmo8.owner.${stamp}@carup-uat.invalid`, password: PASSWORD, garage: `Mbare Motors ${stamp.slice(-4).toUpperCase()}` };
const MECH = { first: 'Thabo', last: 'Ncube', email: `gmo8.mech.${stamp}@carup-uat.invalid`, password: PASSWORD };
// Act 6b needs a fourth real person: someone who owns a car and wants it serviced. Without them the
// act can only prove the mechanic is *assignable*, which is not what the acceptance sentence says.
const CUSTOMER = { first: 'Nyasha', last: 'Mutasa', email: `gmo8.cust.${stamp}@carup-uat.invalid`, password: PASSWORD };
// 12-17 chars, and no I/O/Q at 17 - the seller identifier rule refuses those by name.
const CUSTOMER_VIN = `GMO8UAT${stamp.toUpperCase()}`.slice(0, 17).replace(/[IOQ]/g, 'X');

/* ── a thin governed-API client, carrying a REAL session AND a real CSRF token ────────────────
   The backend uses double-submit CSRF: a token from /api/security/csrf-token, echoed back as
   x-csrf-token alongside the cookie it set. Skipping it does not "bypass security" — it makes every
   mutation fail with a 403 that looks exactly like an authorization refusal, which is how a harness
   ends up reporting "the invitation is spent" when it never sent a valid request at all. */
const csrfCache = new Map();
async function csrfFor(token) {
  const key = token || 'anon';
  if (csrfCache.has(key)) return csrfCache.get(key);
  const headers = {};
  if (token) headers['x-session-token'] = token;
  const r = await fetch(`${BE}/api/security/csrf-token`, { headers });
  if (!r.ok) throw new Error(`CSRF token request failed (${r.status})`);
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await r.json();
  const pair = { csrfToken, cookie };
  csrfCache.set(key, pair);
  return pair;
}
async function api(path, { token, method = 'GET', body, tenantId } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (method !== 'GET' && method !== 'HEAD') {
    const { csrfToken, cookie } = await csrfFor(token);
    headers['x-csrf-token'] = csrfToken;
    if (cookie) headers.cookie = cookie;
  }
  const r = await fetch(`${BE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (r.status === 403 && /CSRF/i.test(text)) {
    throw new Error(`CSRF rejected ${method} ${path} — the harness is misconfigured, not the product`);
  }
  return { status: r.status, body: parsed };
}
async function login(email, password) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  const token = r.body?.token || r.body?.session?.token;
  if (!token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return { token, user: r.body.user };
}
async function stepUp(token) {
  const r = await api('/api/auth/step-up', { method: 'POST', token, body: { password: PASSWORD } });
  if (r.status !== 200) throw new Error(`step-up failed: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}

/* ── the browser, for the human journeys ─────────────────────────────────────────────────────── */
const errors = { console: [], http5xx: [] };
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.http5xx.push(`${r.status()} ${r.url().slice(0, 100)}`); });
}
const shot = async (p, l) => { try { await p.screenshot({ path: `${OUT}/${l}.png` }); } catch { /* not fatal */ } };

async function register(page, who, business) {
  const ph = (t) => page.locator(`input[placeholder="${t}"]`);
  await page.goto(`${FE}/register`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Tendai"]', { timeout: 30000 });
  await ph('Tendai').fill(who.first); await ph('Moyo').fill(who.last);
  await page.locator('input[type=email]').fill(who.email);
  await ph('+263 7XX XXX XXX').fill('+263771234567');
  await page.getByRole('button', { name: /^continue$/i }).click(); await page.waitForTimeout(1200);
  if (business) {
    await page.getByRole('button', { name: /Business \/ professional/i }).first().click();
    await page.waitForSelector('input[placeholder="Example Motors (Pvt) Ltd"]', { timeout: 15000 });
    await page.waitForTimeout(500);
  }
  await page.locator('select:visible').nth(0).selectOption({ label: 'Zimbabwe-based / local' });
  await page.waitForTimeout(300);
  await page.locator('select:visible').nth(1).selectOption({ label: business ? 'Operate an automotive business / professional service' : 'Buy vehicles' });
  await ph('Zimbabwe, Japan, UK…').fill('Zimbabwe');
  await ph('Harare, Tokyo…').fill('Harare');
  if (business) {
    await ph('Example Motors (Pvt) Ltd').fill(business.name);
    await page.locator('select:visible').last().selectOption({ label: business.type });
  }
  await page.getByRole('button', { name: /^continue$/i }).click(); await page.waitForTimeout(1200);
  await page.locator('input[placeholder="At least 8 characters"]').fill(who.password);
  await page.locator('input[placeholder="Repeat password"]').fill(who.password);
  const boxes = page.locator('input[type=checkbox]');
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForTimeout(4000);
}
async function signIn(page, who) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid=email-input]', { timeout: 30000 });
  await page.getByTestId('email-input').fill(who.email);
  await page.getByTestId('password-input').fill(who.password);
  await page.getByTestId('login-button').click();
  await page.waitForTimeout(3500);
}

/**
 * Synthetic document images, generated per side.
 *
 * The product's quality gate refused two earlier attempts, correctly both times: a 1x1 pixel was
 * DOCUMENT_TOO_SMALL, and the same image sent three times was FRONT_BACK_DUPLICATE. A synthetic
 * fixture has to be plausible enough to pass the checks the product really applies — dodging them
 * would certify a path no real document takes.
 */
import zlib from 'zlib';
function docPng(seed) {
  const W = 1024, H = 640;
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  // zlib.crc32 exists on modern Node; keep a fallback so this cannot silently emit a broken PNG.
  function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const raw = Buffer.alloc(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y += 1) {
    raw[o++] = 0;
    for (let x = 0; x < W; x += 1) {
      // Structure that differs per side, so no two uploads are duplicates.
      let v = ((y + seed * 37) / 40 | 0) % 2 === 0 ? 205 : 165;
      if (x > 60 + seed * 90 && x < 420 + seed * 90 && y > 70 && y < 250) v = 240;
      if ((x + y * seed) % 211 === 0) v = 120;
      raw[o++] = v; raw[o++] = v - 12; raw[o++] = v - 24;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
const SIDE_IMAGE = { front: docPng(1), back: docPng(2), selfie: docPng(3) };

async function main() {
  if (!REVIEWER_EMAIL) throw new Error('--reviewer=<email> is required');
  console.log(`\nGMO-8 ACTS 3-6 · ${VIEW}\nFE ${FE}\nBE ${BE}\nartifacts ${OUT}\n`);

  const prov = await (await fetch(`${FE}/carup-provenance.json`)).json();
  const health = await (await fetch(`${BE}/api/health`)).json();
  if (prov.unpaired !== false) throw new Error('preview is UNPAIRED');
  if (prov.commit_sha !== health.build.commit_sha) throw new Error(`sha mismatch FE=${prov.commit_sha.slice(0,8)} BE=${health.build.commit_sha.slice(0,8)}`);
  console.log(`paired at ${prov.commit_sha.slice(0, 8)} · unpaired=false\n`);

  rec('PROV', 'db', 'the synthetic Operations reviewer', `${REVIEWER_EMAIL} — users.role only; no tenancy, no decision`);

  const browser = await chromium.launch({ headless: true });
  const open = async () => { const c = await browser.newContext({ viewport: VIEWPORTS[VIEW] }); const p = await c.newPage(); watch(p); return p; };

  const state = {};

  /* ═══ ACT 3 — the applicant completes and sends ═════════════════════════════════════════════ */
  const owner = await open();
  await step('browser', 'the applicant registers as a Garage', async () => {
    await register(owner, OWNER, { name: OWNER.garage, type: 'Garage / service centre' });
    await signIn(owner, OWNER);
    return OWNER.email;
  });

  await step('api', 'the applicant has a real session', async () => {
    const s = await login(OWNER.email, PASSWORD);
    state.ownerToken = s.token; state.ownerId = s.user?.id;
    return `user ${state.ownerId}`;
  });

  const patchCalls = [];
  owner.on('request', (r) => {
    if (/garage-onboarding\/application/.test(r.url()) && ['PATCH', 'POST'].includes(r.method())) {
      patchCalls.push(`${r.method()} ${(r.postData() || '').slice(0, 60)}`);
    }
  });

  await step('browser', 'they fill in the application', async () => {
    await owner.goto(`${FE}/dashboard/garage-setup`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(2000);
    const start = owner.getByTestId('start-application');
    if (await start.count()) { await start.click(); await owner.waitForTimeout(2500); }
    await owner.waitForSelector('[data-testid=application-form]', { timeout: 30000 });
    const set = async (tid, v) => {
      const el = owner.getByTestId(tid);
      await el.waitFor({ timeout: 15000 });
      await el.fill(v);
    };
    await set('field-trading-name', OWNER.garage);
    await set('field-address', '12 Chaminuka Road, Mbare');
    await set('field-city', 'Harare');
    await set('field-phone', '+263771234567');
    await owner.getByTestId('field-relationship').selectOption('owner');
    // The categories are toggle BUTTONS (aria-pressed), not checkboxes — .check() waited forever on
    // an element that does not exist. Click the first real one.
    const cat = owner.locator('[data-testid^="category-"]').first();
    await cat.waitFor({ timeout: 15000 });
    await cat.click();
    await owner.getByTestId('field-attestation').check();
    // Autosave debounces at 900ms and the patch accumulates; give it room to land.
    await owner.waitForTimeout(2500);
    await shot(owner, '01-application-filled');
    // If autosave never fired or errored, say which — a bare "the server did not record" sends the
    // next reader hunting in the wrong place.
    const errBox = owner.getByTestId('setup-error');
    if (await errBox.count()) console.log(`   [page error] ${(await errBox.innerText()).slice(0, 140)}`);
    const noteEl = owner.locator('[data-testid=autosave-note]');
    console.log(`   [autosave-note] ${(await noteEl.count()) ? await noteEl.innerText() : 'NEVER APPEARED — no save landed'}`);
    console.log(`   [patch requests] ${patchCalls.length} · ${patchCalls.slice(0, 3).join(' | ')}`);
    // Prove the SERVER took them. A filled form that never saved is the failure this catches, and
    // the next step would otherwise report it as a mysterious submission blocker.
    const check = await api('/api/garage-onboarding/application', { token: state.ownerToken });
    const app = check.body?.application;
    const missing = ['trading_name', 'location_city', 'address_line', 'contact_phone', 'applicant_relationship']
      .filter((k) => !app?.[k]);
    if (missing.length) throw new Error(`the server did not record: ${missing.join(', ')}`);
    if (!(app.service_categories || []).length) throw new Error('no service category was recorded');
    if (!app.attestation_accepted_at) throw new Error('the attestation was not recorded');
    return 'details entered by hand and confirmed on the server';
  });

  await step('api', 'their application exists, still granting nothing', async () => {
    const r = await api('/api/garage-onboarding/application', { token: state.ownerToken });
    const app = r.body?.application;
    if (!app) throw new Error(`no application: ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    state.applicationId = app.id;
    if (app.activated_tenant_id) throw new Error('an unapproved application already names a tenant');
    return `${app.id} · status ${app.status}`;
  });

  await step('api', 'they attach business-presence evidence', async () => {
    const r = await api(`/api/garage-onboarding/application/${state.applicationId}/evidence`, {
      token: state.ownerToken, method: 'POST',
      body: { evidence_type: 'signage_photo', mime_type: 'image/png', file_base64: SIDE_IMAGE.front,
        description: 'The sign over the workshop door' },
    });
    if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return 'a photo of the workshop signage — no company papers';
  });

  await step('browser', 'they send it to CarUp', async () => {
    await owner.goto(`${FE}/dashboard/garage-setup`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(2500);
    const submit = owner.getByTestId('submit-application');
    await submit.waitFor({ timeout: 20000 });
    if (await submit.isDisabled()) {
      const b = owner.getByTestId('submission-blockers');
      throw new Error(`still blocked: ${(await b.count()) ? (await b.innerText()).replace(/\s+/g, ' ').slice(0, 140) : 'unknown'}`);
    }
    await submit.click();
    await owner.waitForTimeout(3500);
    await shot(owner, '02-submitted');
    const r = await api('/api/garage-onboarding/application', { token: state.ownerToken });
    if (r.body?.application?.status !== 'submitted') throw new Error(`status is ${r.body?.application?.status}`);
    return 'status submitted';
  });

  /* ═══ ACT 4 — governed review ═══════════════════════════════════════════════════════════════ */
  await step('api', 'the reviewer signs in and steps up', async () => {
    const s = await login(REVIEWER_EMAIL, PASSWORD);
    state.revToken = s.token; state.revId = s.user?.id;
    await stepUp(state.revToken);
    return 'password re-proved on this session';
  });

  await step('api', 'the application is in the reviewer queue', async () => {
    const r = await api('/api/admin/garage-applications', { token: state.revToken });
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    const found = (r.body.applications || []).some((a) => a.id === state.applicationId);
    if (!found) throw new Error('the submitted application is not in the queue');
    return `${r.body.applications.length} waiting`;
  });

  await step('api', 'approval is REFUSED while identity is unapproved (PO-2)', async () => {
    const r = await api(`/api/admin/garage-applications/${state.applicationId}/decision`, {
      token: state.revToken, method: 'POST', body: { decision: 'approve' },
    });
    if (r.status === 201) throw new Error('approved without governed identity — PO-2 violated');
    const msg = JSON.stringify(r.body);
    if (!/identity/i.test(msg)) throw new Error(`refused, but not for identity: ${msg.slice(0, 160)}`);
    return 'the prerequisite is enforced, not assumed';
  });

  await step('api', 'the applicant submits identity verification', async () => {
    const c = await api('/api/identity/verification-sessions', {
      token: state.ownerToken, method: 'POST', body: { document_type: 'national_id' },
    });
    const sess = c.body?.session;
    if (!sess?.id) throw new Error(`create failed: ${c.status} ${JSON.stringify(c.body).slice(0, 160)}`);
    state.sessionId = sess.id;
    // front, back AND selfie: the service names all three, and submitting without one is refused.
    // The payload key is `image` (or dataUri/base64Data) and `mimeType` — NOT image_base64. The
    // first version used the wrong names and never checked the response, so three uploads failed
    // silently and only `submit` complained.
    for (const side of ['front', 'back', 'selfie']) {
      const u = await api(`/api/identity/verification-sessions/${sess.id}/upload/${side}`, {
        token: state.ownerToken, method: 'POST',
        body: { image: `data:image/png;base64,${SIDE_IMAGE[side]}`, mimeType: 'image/png' },
      });
      if (u.status !== 200) throw new Error(`upload ${side} failed: ${u.status} ${JSON.stringify(u.body).slice(0, 160)}`);
    }
    const s = await api(`/api/identity/verification-sessions/${sess.id}/submit`, { token: state.ownerToken, method: 'POST' });
    if (s.status !== 200) throw new Error(`submit failed: ${s.status} ${JSON.stringify(s.body).slice(0, 160)}`);
    return `session ${sess.id}`;
  });

  const identityApproved = await step('api', 'the reviewer approves the identity (O2 governed)', async () => {
    await stepUp(state.revToken);
    const r = await api(`/api/admin/identity/verification-sessions/${state.sessionId}/review`, {
      token: state.revToken, method: 'POST',
      body: { decision: 'approve', reason_code: 'DOCUMENT_VERIFIED', note: 'GMO-8 golden journey' },
    });
    if (r.status !== 200) {
      const msg = JSON.stringify(r.body);
      // A provider-less deployment cannot classify a document, and EVERY document-quality reason
      // code sets approveAllowed:false. That is a hard dependency on a paid vision provider, not a
      // defect in anything GMO owns — and activating one is out of scope.
      if (/DOCUMENT_NOT_VISIBLE|UNCERTAIN|not permitted when the primary reason/.test(msg)) {
        throw new Error(`BLOCKED_ON_VISION_PROVIDER: ${msg.slice(0, 150)}`);
      }
      throw new Error(`${r.status} ${msg.slice(0, 200)}`);
    }
    return 'identity minted by a governed approval, not set directly';
  });

  if (!identityApproved) {
    for (const s of [
      'the garage application can NOW be approved',
      'a real tenant and founding membership now exist',
      'activation is IDEMPOTENT — a retry creates nothing',
      'the founder can open the garage workspace',
      'the applicant sees their garage and can enter it',
      'the founder invites a mechanic',
      'the invited mechanic sees who invited them, before registering',
      'the mechanic registers and accepts',
      'the invitation is SPENT — it cannot seat a second person',
      'the mechanic can work in the garage',
      'revoking ends FUTURE authority',
      'the LAST administrator cannot be removed',
    ]) rec('SKIP', 'n/a', s, 'blocked upstream: governed identity approval needs a vision provider');

    await browser.close();
    const pass = results.filter((r) => r.status === 'PASS').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIP').length;
    console.log(`\n${'─'.repeat(74)}`);
    console.log(`GMO-8 ACTS 3-6: ${pass} PASS · ${fail} FAIL · ${skipped} BLOCKED`);
    console.log('\nBLOCKED ON: a paid vision/OCR provider. documentClassifier returns UNCERTAIN when');
    console.log('GEMINI_API_KEY is absent, every document-quality reason code has approveAllowed:false,');
    console.log('and PO-2 makes governed identity approval a prerequisite for garage approval.');
    writeFileSync(`${OUT}/report.json`, JSON.stringify({ viewport: VIEW, commit_sha: prov.commit_sha, unpaired: prov.unpaired, state, results, errors, pass, fail, skipped, blocked_on: 'vision_provider' }, null, 2));
    console.log(`report ${OUT}/report.json`);
    process.exit(fail > 0 ? 1 : 0);
  }

  await step('api', 'the garage application can NOW be approved', async () => {
    await stepUp(state.revToken);
    const r = await api(`/api/admin/garage-applications/${state.applicationId}/decision`, {
      token: state.revToken, method: 'POST', body: { decision: 'approve' },
    });
    if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 220)}`);
    state.activation = r.body.activation;
    if (r.body.application?.status !== 'approved') throw new Error(`status ${r.body.application?.status}`);
    return `approved · activation ${r.body.activation?.activated ? 'succeeded' : 'reported: ' + r.body.activation?.reason}`;
  });

  /* ═══ ACT 5 — activation and context ════════════════════════════════════════════════════════ */
  await step('api', 'a real tenant and founding membership now exist', async () => {
    const r = await api('/api/auth/my-memberships', { token: state.ownerToken });
    const g = (r.body?.garages || [])[0];
    if (!g) throw new Error(`no garage membership: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    state.tenantId = g.tenantId;
    if (g.role !== 'admin') throw new Error(`founding role is ${g.role}, expected admin`);
    if (!g.canOperate) throw new Error('the founder cannot operate their own garage');
    return `tenant ${g.tenantId} · role ${g.role} · ${g.tenantName}`;
  });

  await step('api', 'activation is IDEMPOTENT — a retry creates nothing', async () => {
    await stepUp(state.revToken);
    const r = await api(`/api/admin/garage-applications/${state.applicationId}/activate`, { token: state.revToken, method: 'POST' });
    if (![200, 201].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    if (r.body.created !== false) throw new Error(`retry reported created=${r.body.created}`);
    if (r.body.tenantId !== state.tenantId) throw new Error('a retry produced a DIFFERENT tenant');
    return 'created=false, same tenant';
  });

  await step('api', 'the founder can open the garage workspace', async () => {
    const r = await api('/api/garage/queue', { token: state.ownerToken, tenantId: state.tenantId });
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
    return 'the tenant-scoped gate admits the founder (platform owner, tenant admin)';
  });

  await step('browser', 'the applicant sees their garage and can enter it', async () => {
    await owner.goto(`${FE}/dashboard/garage-setup`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(3000);
    await shot(owner, '03-activated');
    const panel = owner.getByTestId('activated-panel');
    if (!(await panel.count())) throw new Error('the activated panel did not render');
    await owner.getByTestId('garage-context-switcher').waitFor({ timeout: 20000 });
    const enter = owner.getByTestId('enter-garage');
    if (!(await enter.count())) throw new Error('no way to enter the garage was offered');
    await enter.click();
    await owner.waitForTimeout(4000);
    await shot(owner, '04-workshop');
    return `landed on ${owner.url().replace(FE, '')}`;
  });

  /* ═══ ACT 6 — the mechanic, and revocation ══════════════════════════════════════════════════ */
  await step('api', 'the founder invites a mechanic', async () => {
    const r = await api('/api/garage/invitations', {
      token: state.ownerToken, tenantId: state.tenantId, method: 'POST',
      body: { email: MECH.email, name: `${MECH.first} ${MECH.last}`, role: 'mechanic' },
    });
    if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
    state.inviteToken = r.body.token;
    if (!state.inviteToken) throw new Error('no token returned');
    return 'a single-use, email-bound link';
  });

  const mech = await open();
  await step('browser', 'the invited mechanic sees who invited them, before registering', async () => {
    await mech.goto(`${FE}/join-garage?token=${encodeURIComponent(state.inviteToken)}`, { waitUntil: 'networkidle', timeout: 60000 });
    await mech.waitForTimeout(2500);
    await shot(mech, '05-invitation');
    const card = mech.getByTestId('invitation-card');
    await card.waitFor({ timeout: 20000 });
    const text = await card.innerText();
    if (!text.includes(OWNER.garage)) throw new Error(`the garage is not named: ${text.slice(0, 120)}`);
    if (!text.includes(MECH.email)) throw new Error('the required email address is not shown');
    return 'garage, role and required address — all before an account exists';
  });

  await step('browser', 'the mechanic registers and accepts', async () => {
    await register(mech, MECH, null);
    await signIn(mech, MECH);
    await mech.goto(`${FE}/join-garage?token=${encodeURIComponent(state.inviteToken)}`, { waitUntil: 'networkidle', timeout: 60000 });
    await mech.waitForTimeout(2500);
    const accept = mech.getByTestId('accept-invitation');
    await accept.waitFor({ timeout: 20000 });
    await accept.click();
    await mech.waitForTimeout(4000);
    await shot(mech, '06-joined');
    const s = await login(MECH.email, PASSWORD);
    state.mechToken = s.token; state.mechId = s.user?.id;
    const r = await api('/api/auth/my-memberships', { token: state.mechToken });
    const g = (r.body?.garages || [])[0];
    if (!g || g.tenantId !== state.tenantId) throw new Error('the mechanic did not join THIS garage');
    if (g.role !== 'mechanic') throw new Error(`joined as ${g.role}`);
    return `member of ${g.tenantName} as mechanic`;
  });

  await step('api', 'the invitation is SPENT — it cannot seat a second person', async () => {
    const r = await api('/api/garage/invitations/accept', {
      token: state.ownerToken, method: 'POST', body: { token: state.inviteToken },
    });
    if (r.status === 200 || r.status === 201) throw new Error('a spent invitation was accepted again');
    // The refusal must be the RIGHT one. Any 403 satisfied the first version of this check, and a
    // CSRF 403 duly satisfied it while the request never reached the invitation logic at all.
    const why = JSON.stringify(r.body);
    if (!/already been used|not valid|expired|cancelled/i.test(why)) {
      throw new Error(`refused (${r.status}) but not as a spent invitation: ${why.slice(0, 160)}`);
    }
    return `refused as spent (${r.status})`;
  });

  await step('api', 'the mechanic can work in the garage', async () => {
    const r = await api('/api/garage/queue', { token: state.mechToken, tenantId: state.tenantId });
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    const m = await api('/api/garage/mechanics', { token: state.ownerToken, tenantId: state.tenantId });
    const listed = (m.body?.mechanics || []).some((x) => x.user_id === state.mechId);
    if (!listed) throw new Error('the new mechanic is not assignable');
    return 'queue readable and the mechanic is assignable';
  });

  /* ═══ ACT 6b — the last clause of the acceptance sentence: a REAL Service Network job ════════
     Everything above proves the new mechanic is *assignable* and the garage queue *readable*. That
     is a proxy for the sentence, not the sentence, which says the new relationship is used "to
     complete a real Service Network job". These steps do the job: publish the garage, let a real
     vehicle owner ask it for work, open and assign a work order to the NEW mechanic, and have that
     mechanic — not the founder — move and record it.

     WRITTEN BUT NEVER EXECUTED: they sit behind the identity-approval block with steps 13–24, so no
     run has reached them. They are first-class steps rather than optional ones precisely so a future
     run either proves the sentence or fails loudly, instead of reporting a pass it never earned. */
  await step('api', 'the founder publishes the garage so it can receive work', async () => {
    const put = await api('/api/garage/profile', {
      token: state.ownerToken, tenantId: state.tenantId, method: 'PUT',
      body: {
        display_name: OWNER.garage, location_city: 'Harare', location_province: 'Harare',
        service_categories: ['general_service'], contact_policy: 'in_app_only',
      },
    });
    if (![200, 201].includes(put.status)) throw new Error(`profile ${put.status} ${JSON.stringify(put.body).slice(0, 160)}`);
    const pub = await api('/api/garage/profile/publish', { token: state.ownerToken, tenantId: state.tenantId, method: 'POST' });
    if (pub.status !== 200) throw new Error(`publish ${pub.status} ${JSON.stringify(pub.body).slice(0, 160)}`);
    state.slug = pub.body?.profile?.slug || put.body?.profile?.slug;
    if (!state.slug) throw new Error('published, but the response carried no slug to address the garage by');
    return `published as /${state.slug}`;
  });

  const customer = await open();
  await step('browser', 'a vehicle owner registers — a fourth unprovisioned person', async () => {
    await register(customer, CUSTOMER);
    await signIn(customer, CUSTOMER);
    const { token, user } = await login(CUSTOMER.email, PASSWORD);
    state.custToken = token; state.custId = user?.id;
    if (!state.custId) throw new Error('registered but the session carries no user id');
    await shot(customer, 'customer-dashboard');
    return `${CUSTOMER.email} role=${user?.role || '?'}`;
  });

  await step('api', 'the platform records THEM as the vehicle\'s governed owner', async () => {
    const r = await api('/api/vehicles/add', {
      token: state.custToken, method: 'POST',
      body: {
        vin: CUSTOMER_VIN, make: 'Toyota', model: 'Hilux', year: 2016,
        price: 14500, currency: 'USD', mileage: 128000, location: 'Harare', province: 'Harare',
      },
    });
    if (![200, 201].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    state.vin = CUSTOMER_VIN;
    // Governed vehicle authority is owner_id ALONE: current_seller_id is explicitly not accepted,
    // so a case opened below proves ownership, not merely that they listed something.
    return `${CUSTOMER_VIN} added`;
  });

  await step('api', 'the owner asks the newly-published garage for service', async () => {
    const r = await api('/api/service-cases', {
      token: state.custToken, method: 'POST',
      body: {
        vin: state.vin, garage_slug: state.slug, service_category: 'general_service',
        request_summary: 'Brake noise at low speed and an overdue service.',
      },
    });
    if (![200, 201].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    state.caseId = r.body?.case?.id;
    if (!state.caseId) throw new Error('no case id returned');
    return `case ${String(state.caseId).slice(0, 8)} (${r.body?.case?.status})`;
  });

  await step('api', 'the garage accepts it and opens a work order', async () => {
    const acc = await api(`/api/service-cases/${state.caseId}/accept`, { token: state.ownerToken, tenantId: state.tenantId, method: 'POST' });
    if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`);
    const wo = await api(`/api/service-cases/${state.caseId}/work-order`, {
      token: state.ownerToken, tenantId: state.tenantId, method: 'POST', body: { service_category: 'general_service' },
    });
    if (![200, 201].includes(wo.status)) throw new Error(`work-order ${wo.status} ${JSON.stringify(wo.body).slice(0, 160)}`);
    state.workOrderId = wo.body?.workOrder?.id;
    if (!state.workOrderId) throw new Error('no work order id returned');
    return `work order ${String(state.workOrderId).slice(0, 8)}`;
  });

  await step('api', 'the work is assigned to the MECHANIC THIS JOURNEY CREATED', async () => {
    const r = await api(`/api/service-work-orders/${state.workOrderId}/assign`, {
      token: state.ownerToken, tenantId: state.tenantId, method: 'POST', body: { mechanic_user_id: state.mechId },
    });
    if (![200, 201].includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const check = await api(`/api/service-work-orders/${state.workOrderId}/assignment`, { token: state.ownerToken, tenantId: state.tenantId });
    const assignee = check.body?.assignment?.mechanic_user_id;
    if (assignee !== state.mechId) throw new Error(`assigned, but the durable assignment names ${assignee || 'nobody'}`);
    return 'assignment is durable and names the invited mechanic';
  });

  await step('api', 'the MECHANIC — not the founder — does and records the work', async () => {
    const start = await api(`/api/service-cases/${state.caseId}/start`, { token: state.mechToken, tenantId: state.tenantId, method: 'POST' });
    if (start.status !== 200) throw new Error(`start ${start.status} ${JSON.stringify(start.body).slice(0, 160)}`);
    const prog = await api(`/api/service-work-orders/${state.workOrderId}/status`, {
      token: state.mechToken, tenantId: state.tenantId, method: 'PATCH', body: { status: 'In Progress' },
    });
    if (prog.status !== 200) throw new Error(`in-progress ${prog.status} ${JSON.stringify(prog.body).slice(0, 160)}`);
    const rec = await api(`/api/service-work-orders/${state.workOrderId}/records`, {
      token: state.mechToken, tenantId: state.tenantId, method: 'POST',
      body: { service_category: 'general_service', work_performed: 'Front brake pads replaced; full service completed.' },
    });
    if (rec.status !== 201) throw new Error(`record ${rec.status} ${JSON.stringify(rec.body).slice(0, 200)}`);
    state.recordId = rec.body?.record?.id;
    if (!state.recordId) throw new Error('recorded, but no service record id came back');
    return `service record ${String(state.recordId).slice(0, 8)}`;
  });

  await step('api', 'the job completes — the journey ends in a real Service Record', async () => {
    const done = await api(`/api/service-work-orders/${state.workOrderId}/status`, {
      token: state.mechToken, tenantId: state.tenantId, method: 'PATCH',
      body: { status: 'Completed', total_cost: 180, currency: 'USD' },
    });
    if (done.status !== 200) throw new Error(`complete work order ${done.status} ${JSON.stringify(done.body).slice(0, 160)}`);
    const closed = await api(`/api/service-cases/${state.caseId}/complete`, { token: state.ownerToken, tenantId: state.tenantId, method: 'POST' });
    if (closed.status !== 200) throw new Error(`complete case ${closed.status} ${JSON.stringify(closed.body).slice(0, 160)}`);
    const view = await api(`/api/service-cases/${state.caseId}`, { token: state.custToken });
    if (view.body?.case?.status !== 'completed') throw new Error(`the customer still sees ${view.body?.case?.status}`);
    return 'completed, and the customer can see it';
  });

  await step('api', 'revoking ends FUTURE authority', async () => {
    const r = await api(`/api/garage/members/${encodeURIComponent(state.mechId)}`, {
      token: state.ownerToken, tenantId: state.tenantId, method: 'DELETE',
    });
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    const after = await api('/api/garage/queue', { token: state.mechToken, tenantId: state.tenantId });
    if (after.status === 200) throw new Error('a removed mechanic still reached the garage');
    if (![401, 403].includes(after.status)) throw new Error(`refused with an unexpected ${after.status}`);
    const m = await api('/api/garage/mechanics', { token: state.ownerToken, tenantId: state.tenantId });
    if ((m.body?.mechanics || []).some((x) => x.user_id === state.mechId)) throw new Error('still assignable after removal');
    // GMO-7's other half, and plan negative test 12: ending authority must not erase history. The
    // work they really did stays theirs. Only assertable because Act 6b produced a real record.
    if (state.recordId) {
      const rec = await api(`/api/service-records/${state.recordId}`, { token: state.ownerToken, tenantId: state.tenantId });
      if (rec.status !== 200) throw new Error(`the service record vanished with their membership (${rec.status})`);
      const attributed = JSON.stringify(rec.body).includes(String(state.mechId));
      if (!attributed) throw new Error('the record survived but no longer attributes the work to them');
    }
    return `removed; their next request is refused (${after.status})${state.recordId ? '; their service record survives, still attributed' : ''}`;
  });

  await step('api', 'the LAST administrator cannot be removed', async () => {
    const r = await api(`/api/garage/members/${encodeURIComponent(state.ownerId)}`, {
      token: state.ownerToken, tenantId: state.tenantId, method: 'DELETE',
    });
    if (r.status === 200) throw new Error('the only administrator was removed — the garage is now unmanageable');
    const why = JSON.stringify(r.body);
    if (!/only administrator/i.test(why)) {
      throw new Error(`refused (${r.status}) but not as the last administrator: ${why.slice(0, 160)}`);
    }
    return `refused as the last administrator (${r.status})`;
  });

  await browser.close();

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${'─'.repeat(74)}`);
  console.log(`GMO-8 ACTS 3-6: ${pass} PASS · ${fail} FAIL`);
  console.log(`console errors ${errors.console.length} · 5xx ${errors.http5xx.length}`);
  errors.http5xx.slice(0, 5).forEach((e) => console.log(`  5xx: ${e}`));
  console.log(`\naccounts  owner=${OWNER.email}  mechanic=${MECH.email}`);
  console.log(`tenant    ${state.tenantId}`);
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ viewport: VIEW, commit_sha: prov.commit_sha, unpaired: prov.unpaired, state, results, errors, pass, fail }, null, 2));
  console.log(`report ${OUT}/report.json`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS FAILURE:', e.message); process.exit(2); });
