#!/usr/bin/env node
/**
 * CarUp Referral Engine — EXECUTABLE UAT journey runner.
 *
 * Drives the real, deployed staging API over HTTP (Node 20+ global fetch, ESM, zero deps)
 * and walks 10 end-to-end journeys covering auth boundaries, the local-marketplace and
 * import referral chains, the correct-wallet attribution proof, the marketing state machine,
 * trust holds/disputes/audit, channel inbound attribution, and the safe AI agent gateway.
 *
 * It is environment-driven. NOTHING in this file contains a secret, password, URL, or key —
 * every credential and the API base URL come from process.env (sourced from an ignored
 * backend/.env.uat.local). See backend/scripts/uat/README.md.
 *
 * SAFETY: this refuses to run against anything other than the approved STAGING target.
 * It hard-fails (exit 1) if the API base URL host carries the production Supabase ref or is
 * otherwise not recognisable as staging.
 *
 * Run (after sourcing backend/.env.uat.local — see README):
 *   node backend/scripts/uat/referral-uat-journeys.mjs
 *
 * Exit code is non-zero if any journey step FAILED (a SKIPPED step never fails the run).
 */

// ---------------------------------------------------------------------------
// Known Supabase project refs (mirror scripts/provision-staging-qa-accounts.mjs).
// These are NOT secrets — they are public project identifiers used only to fail closed.
// ---------------------------------------------------------------------------
const STAGING_SUPABASE_REF = 'eoyenigwevnxwwhyhaer';
const PRODUCTION_SUPABASE_REF = 'vhmnajoeicasaigiophh';

// ---------------------------------------------------------------------------
// Config loading — fail loudly, naming the missing var, before any network call.
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'STAGING_API_BASE_URL',
  'UAT_ADMIN_EMAIL',
  'UAT_ADMIN_PASSWORD',
  'UAT_OWNER_EMAIL',
  'UAT_OWNER_PASSWORD',
];

function loadConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => env[key] == null || String(env[key]).trim() === '');
  if (missing.length) {
    console.error(`\nABORT: missing required environment variable(s): ${missing.join(', ')}`);
    console.error('Create backend/.env.uat.local (git-ignored) and source it first. See backend/scripts/uat/README.md.');
    process.exit(1);
  }
  return {
    baseUrl: String(env.STAGING_API_BASE_URL).replace(/\/+$/, ''),
    adminEmail: env.UAT_ADMIN_EMAIL,
    adminPassword: env.UAT_ADMIN_PASSWORD,
    ownerEmail: env.UAT_OWNER_EMAIL,
    ownerPassword: env.UAT_OWNER_PASSWORD,
    // Optional: the operator may also expose the staging Supabase ref/url for an extra guard.
    stagingSupabaseUrl: env.STAGING_SUPABASE_URL || env.SUPABASE_URL || '',
  };
}

// ---------------------------------------------------------------------------
// HARD SAFETY GUARD — staging only. Refuse the production ref or any non-staging host.
// ---------------------------------------------------------------------------
function extractSupabaseRef(source) {
  if (!source || typeof source !== 'string') return null;
  const host = source.match(/(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|com)/i);
  if (host) return host[1].toLowerCase();
  const pooler = source.match(/postgres\.([a-z0-9]{20})/i);
  if (pooler) return pooler[1].toLowerCase();
  return null;
}

function assertStagingTarget(config) {
  const haystack = `${config.baseUrl} ${config.stagingSupabaseUrl}`.toLowerCase();

  // 1. Never touch production. Refuse if the production ref shows up anywhere we look.
  if (haystack.includes(PRODUCTION_SUPABASE_REF)) {
    console.error('ABORT: not staging');
    console.error(`Refusing: target references the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF}).`);
    process.exit(1);
  }

  // 2. Parse the API host and require it to look like staging.
  let host;
  try {
    host = new URL(config.baseUrl).host.toLowerCase();
  } catch {
    console.error('ABORT: not staging');
    console.error(`STAGING_API_BASE_URL is not a valid URL: ${config.baseUrl}`);
    process.exit(1);
  }

  // 3. If a Supabase URL was provided, it must resolve to exactly the staging ref.
  if (config.stagingSupabaseUrl) {
    const ref = extractSupabaseRef(config.stagingSupabaseUrl);
    if (ref !== STAGING_SUPABASE_REF) {
      console.error('ABORT: not staging');
      console.error(`Provided Supabase URL ref "${ref}" is not the approved staging ref (${STAGING_SUPABASE_REF}).`);
      process.exit(1);
    }
  }

  // 4. The API host itself must be recognisably staging (and never bare production-looking hosts).
  const looksStaging =
    host.includes('staging') ||
    host.includes('stg') ||
    host.includes('uat') ||
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    haystack.includes(STAGING_SUPABASE_REF);
  if (!looksStaging) {
    console.error('ABORT: not staging');
    console.error(
      `Refusing: API host "${host}" is not recognisable as the staging environment. ` +
        'Point STAGING_API_BASE_URL at staging, or set STAGING_SUPABASE_URL to the staging project to prove the target.',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Result recording — PASS / FAIL / SKIPPED. Never throws raw secrets.
// ---------------------------------------------------------------------------
const RESULTS = []; // { journey, step, status: 'PASS'|'FAIL'|'SKIP', message }
let CURRENT_JOURNEY = '(setup)';

function redact(value) {
  // Defensive: never let a known secret leak into a printed message.
  let s = typeof value === 'string' ? value : String(value);
  for (const key of ['UAT_ADMIN_PASSWORD', 'UAT_OWNER_PASSWORD']) {
    const secret = process.env[key];
    if (secret && s.includes(secret)) s = s.split(secret).join('***REDACTED***');
  }
  // Never echo session tokens.
  s = s.replace(/sk_live_[A-Za-z0-9]+/g, 'sk_live_***');
  return s;
}

function record(status, step, message = '') {
  RESULTS.push({ journey: CURRENT_JOURNEY, step, status, message: redact(message) });
  const icon = status === 'PASS' ? '  ✓' : status === 'SKIP' ? '  ~' : '  ✗';
  const tail = message ? ` — ${redact(message)}` : '';
  console.log(`${icon} [${status}] ${step}${tail}`);
}

const pass = (step, message) => record('PASS', step, message);
const skip = (step, message) => record('SKIP', step, message);
const fail = (step, message) => record('FAIL', step, message);

/** Assert a condition; record PASS or FAIL. Returns the boolean so callers can branch. */
function check(condition, step, failMessage = '') {
  if (condition) {
    pass(step);
    return true;
  }
  fail(step, failMessage || 'condition was not met');
  return false;
}

/** Run a journey body, converting an unexpected throw into a single FAIL rather than crashing the run. */
async function journey(name, fn) {
  CURRENT_JOURNEY = name;
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err) {
    fail('journey threw unexpectedly', err?.message || String(err));
  } finally {
    CURRENT_JOURNEY = '(setup)';
  }
}

// ---------------------------------------------------------------------------
// HTTP client with a per-session cookie jar + CSRF, mirroring web/Login.tsx:
//   GET /api/security/csrf-token  (with x-session-token + x-user-id so the token binds
//   to the authenticated user), reuse the csrf-token cookie, and send x-csrf-token on
//   every mutating request with credentials included.
// ---------------------------------------------------------------------------
function createSession(baseUrl, label) {
  return {
    baseUrl,
    label,
    cookies: new Map(), // name -> value
    sessionToken: null,
    userId: null,
    csrfToken: null,
  };
}

function captureSetCookie(session, res) {
  // Node's fetch exposes getSetCookie() (Node 20.x+). Fall back to the combined header.
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) session.cookies.set(name, value);
  }
}

function cookieHeader(session) {
  if (session.cookies.size === 0) return undefined;
  return [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Perform an HTTP request on a session. Adds auth + CSRF headers automatically.
 * Returns { status, json } (json is null if the body was not JSON).
 */
async function request(session, method, path, { body, headers = {}, auth = true, csrf = true } = {}) {
  const url = `${session.baseUrl}${path}`;
  const finalHeaders = { accept: 'application/json', ...headers };

  if (body !== undefined) finalHeaders['content-type'] = 'application/json';

  if (auth && session.sessionToken) {
    finalHeaders['x-session-token'] = session.sessionToken;
    if (session.userId) finalHeaders['x-user-id'] = session.userId;
  }

  if (csrf && MUTATING.has(method)) {
    if (!session.csrfToken) await refreshCsrf(session);
    finalHeaders['x-csrf-token'] = session.csrfToken;
  }

  const cookie = cookieHeader(session);
  if (cookie) finalHeaders.cookie = cookie;

  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  captureSetCookie(session, res);

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * Fetch a CSRF token bound to this session's user + session token, exactly as the SPA does:
 * the token's userId/sessionToken binding must match what the mutating request will send.
 */
async function refreshCsrf(session) {
  const headers = { accept: 'application/json' };
  if (session.sessionToken) headers['x-session-token'] = session.sessionToken;
  if (session.userId) headers['x-user-id'] = session.userId;
  const cookie = cookieHeader(session);
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${session.baseUrl}/api/security/csrf-token`, { method: 'GET', headers, redirect: 'manual' });
  captureSetCookie(session, res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  session.csrfToken = json?.csrfToken || session.cookies.get('csrf-token') || null;
  return session.csrfToken;
}

/** Log in via POST /api/auth/login and populate the session (token + userId). */
async function login(session, email, password) {
  // Pre-seed a guest CSRF token so the mutating login POST passes the double-submit check.
  await refreshCsrf(session);
  const res = await request(session, 'POST', '/api/auth/login', {
    body: { email, password },
    auth: false,
  });
  if (res.status === 200 && res.json?.token) {
    session.sessionToken = res.json.token;
    session.userId = res.json.user?.id || null;
    // Re-bind CSRF to the now-authenticated user/session.
    session.csrfToken = null;
    await refreshCsrf(session);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Shared constants for payloads (mirror backend/constants/referral/referralConstants.js
// and the service contracts). String literals here MUST match the API.
// ---------------------------------------------------------------------------
const RUN_TAG = `uat-${Date.now()}`;
const REF = (suffix) => `UAT${RUN_TAG.replace(/[^a-z0-9]/gi, '').toUpperCase()}${suffix}`;

// Holds IDs created across journeys so later journeys can chain off earlier ones.
const STATE = {
  admin: null,
  owner: null,
  campaignId: null,
  codeId: null,
  ownerUserId: null,
  localWalletTxnId: null,
  importWalletTxnId: null,
  marketingAssetId: null,
  disputeEventId: null,
};

// ===========================================================================
// JOURNEY 1 — Auth + boundaries
// ===========================================================================
async function journey1Auth(config) {
  const admin = createSession(config.baseUrl, 'admin');
  const owner = createSession(config.baseUrl, 'owner');

  const adminLogin = await login(admin, config.adminEmail, config.adminPassword);
  check(adminLogin.status === 200 && Boolean(admin.sessionToken), 'admin login returns 200 with token', `status=${adminLogin.status}`);

  const ownerLogin = await login(owner, config.ownerEmail, config.ownerPassword);
  check(ownerLogin.status === 200 && Boolean(owner.sessionToken), 'owner login returns 200 with token', `status=${ownerLogin.status}`);

  STATE.admin = admin;
  STATE.owner = owner;
  STATE.ownerUserId = owner.userId;

  const adminMe = await request(admin, 'GET', '/api/auth/me');
  check(adminMe.status === 200 && adminMe.json?.user?.id === admin.userId, 'GET /api/auth/me (admin) returns the admin user', `status=${adminMe.status}`);

  const ownerMe = await request(owner, 'GET', '/api/auth/me');
  check(ownerMe.status === 200 && ownerMe.json?.user?.id === owner.userId, 'GET /api/auth/me (owner) returns the owner user', `status=${ownerMe.status}`);

  // Owner calling an admin-only referral API => 403.
  const ownerAdminApi = await request(owner, 'GET', '/api/referrals/admin/events');
  check(ownerAdminApi.status === 403, 'owner calling admin referral API (GET /api/referrals/admin/events) => 403', `status=${ownerAdminApi.status}`);

  // Owner -> admin escalation via switch-role => 403 (admin can never be assumed via tenant path).
  const escalate = await request(owner, 'POST', '/api/auth/switch-role', { body: { role: 'admin' } });
  check(escalate.status === 403, 'owner -> admin escalation (switch-role) => 403', `status=${escalate.status}`);

  // Invalid credentials => 401.
  const bad = createSession(config.baseUrl, 'bad');
  const badLogin = await login(bad, config.ownerEmail, `${config.ownerPassword}-wrong-${RUN_TAG}`);
  check(badLogin.status === 401, 'invalid credentials => 401', `status=${badLogin.status}`);
}

// ===========================================================================
// JOURNEY 2 — Campaign -> code -> coupon -> share assets
// ===========================================================================
async function journey2CampaignCodeCouponShare() {
  const admin = STATE.admin;
  if (!admin?.sessionToken) {
    skip('journey 2 prerequisites', 'admin session unavailable (journey 1 must pass first)');
    return;
  }

  // Create campaign (LOCAL_MARKETPLACE / priority LOCAL).
  const campaignName = `UAT Local Campaign ${RUN_TAG}`;
  const created = await request(admin, 'POST', '/api/referrals/campaigns', {
    body: { name: campaignName, campaign_type: 'LOCAL_MARKETPLACE', priority_scope: 'LOCAL', status: 'DRAFT' },
  });
  const ok2 = check(created.status === 201 && Boolean(created.json?.campaign?.id), 'create LOCAL_MARKETPLACE campaign => 201', `status=${created.status}`);
  if (ok2) STATE.campaignId = created.json.campaign.id;

  // Activate it.
  if (STATE.campaignId) {
    const activated = await request(admin, 'PATCH', `/api/referrals/campaigns/${STATE.campaignId}`, { body: { status: 'ACTIVE' } });
    check(activated.status === 200 && activated.json?.campaign?.status === 'ACTIVE', 'activate campaign (status=ACTIVE)', `status=${activated.status}`);
  }

  // Blank-name campaign fails (ValidationError -> non-2xx).
  const blank = await request(admin, 'POST', '/api/referrals/campaigns', { body: { name: '', campaign_type: 'LOCAL_MARKETPLACE' } });
  check(blank.status >= 400 && blank.status < 500, 'blank-name campaign is rejected (4xx)', `status=${blank.status}`);

  // Create code TESTLOCAL2026.
  const codeValue = REF('TL'); // unique per run to stay idempotent on re-runs
  const code = await request(admin, 'POST', '/api/referrals/codes', {
    body: { campaign_id: STATE.campaignId, owner_user_id: STATE.ownerUserId, code: codeValue, code_type: 'MEMBER', channel: 'web' },
  });
  const okCode = check(code.status === 201 && Boolean(code.json?.code?.id), 'create referral code => 201', `status=${code.status}`);
  if (okCode) STATE.codeId = code.json.code.id;
  const normalizedCode = code.json?.code?.code || codeValue.toUpperCase();

  // Validate ok (public endpoint).
  const valid = await request(admin, 'POST', '/api/referrals/validate', { body: { code: normalizedCode, channel: 'web' }, csrf: false });
  check(valid.status === 200 && valid.json?.valid === true && valid.json?.attribution?.owner_user_id === STATE.ownerUserId, 'validate created code => valid + attribution', `status=${valid.status}`);

  // NONEXISTENT fails.
  const invalid = await request(admin, 'POST', '/api/referrals/validate', { body: { code: `NONEXISTENT-${RUN_TAG}`, channel: 'web' }, csrf: false });
  check(invalid.status === 422 && invalid.json?.valid === false, 'validate NONEXISTENT code => not valid (422)', `status=${invalid.status}`);

  // Create coupon WELCOME10 (10% = PERCENT/10).
  const couponCode = REF('W10');
  const coupon = await request(admin, 'POST', '/api/referrals/coupons', {
    body: { code: couponCode, campaign_id: STATE.campaignId, discount_type: 'PERCENT', discount_value: 10, status: 'ACTIVE' },
  });
  check(coupon.status === 201 && coupon.json?.coupon?.discount_value == 10, 'create 10% coupon (PERCENT/10) => 201', `status=${coupon.status}`);
  const normalizedCoupon = coupon.json?.coupon?.code || couponCode.toUpperCase();

  // Apply to order_amount 100 => discount 10.
  const apply = await request(admin, 'POST', '/api/referrals/coupons/apply', { body: { code: normalizedCoupon, order_amount: 100 }, csrf: false });
  check(apply.status === 200 && Number(apply.json?.discount_amount) === 10, 'apply coupon to 100 => discount_amount 10', `status=${apply.status} discount=${apply.json?.discount_amount}`);

  // Redeem once (admin redeems for self).
  const redeem = await request(admin, 'POST', '/api/referrals/coupons/redeem', {
    body: { code: normalizedCoupon, order_amount: 100, redeemer_user_id: admin.userId, order_reference: `uat-order-${RUN_TAG}` },
  });
  check(redeem.status === 201 && redeem.json?.redeemed === true, 'redeem coupon once => 201 redeemed', `status=${redeem.status}`);

  // Duplicate redeem handled (rejected, not a second redemption).
  const dup = await request(admin, 'POST', '/api/referrals/coupons/redeem', {
    body: { code: normalizedCoupon, order_amount: 100, redeemer_user_id: admin.userId, order_reference: `uat-order-${RUN_TAG}` },
  });
  check(dup.status >= 400 && dup.json?.redeemed !== true, 'duplicate coupon redeem is rejected (not redeemed again)', `status=${dup.status}`);

  // Invalid coupon redeem handled.
  const invalidRedeem = await request(admin, 'POST', '/api/referrals/coupons/redeem', {
    body: { code: `NOPE-${RUN_TAG}`, order_amount: 100, redeemer_user_id: admin.userId },
  });
  check(invalidRedeem.status >= 400 && invalidRedeem.json?.redeemed !== true, 'invalid coupon redeem is rejected', `status=${invalidRedeem.status}`);

  // Generate share assets; assert attribution-preserving short/social link + QR + barcode.
  const share = await request(admin, 'POST', '/api/referrals/share-assets', { body: { code: normalizedCode, channel: 'web' } });
  const payload = share.json?.shareAsset?.payload || {};
  const hasShortOrSocial = Boolean(payload.short_referral_url || payload.social_campaign_url);
  const hasQr = Boolean(payload.qr_payload);
  const hasBarcode = Boolean(payload.barcode_payload || payload.barcode_svg);
  const attributionPreserved =
    typeof payload.social_campaign_url === 'string' && payload.social_campaign_url.includes('utm_campaign=');
  check(
    share.status === 201 && hasShortOrSocial && hasQr && hasBarcode && attributionPreserved,
    'share assets carry attribution-preserving short/social link + QR payload + barcode',
    `status=${share.status} short/social=${hasShortOrSocial} qr=${hasQr} barcode=${hasBarcode} utm=${attributionPreserved}`,
  );
}

// ===========================================================================
// JOURNEY 3 — Owner bundle -> local lead -> reward -> CORRECT wallet (attribution proof)
// ===========================================================================
async function journey3LocalAttribution() {
  const admin = STATE.admin;
  if (!admin?.sessionToken || !STATE.ownerUserId) {
    skip('journey 3 prerequisites', 'admin session / owner id unavailable');
    return;
  }

  // Blank owner id fails.
  const blankOwner = await request(admin, 'POST', '/api/referrals/local-marketplace/referral-bundles', {
    body: { flow_type: 'buy_vehicle', participant_type: 'buyer', owner_user_id: '' },
  });
  check(blankOwner.status >= 400 && blankOwner.status < 500, 'bundle with blank owner_user_id is rejected (4xx)', `status=${blankOwner.status}`);

  // Create bundle owned by the staging owner id. flow_type buy_vehicle => order_paid reward 5.
  const bundleCode = REF('BV');
  const bundle = await request(admin, 'POST', '/api/referrals/local-marketplace/referral-bundles', {
    body: { flow_type: 'buy_vehicle', participant_type: 'buyer', owner_user_id: STATE.ownerUserId, code: bundleCode, channel: 'web', campaign_name: `UAT Owner Bundle ${RUN_TAG}` },
  });
  const okBundle = check(bundle.status === 201 && bundle.json?.success === true && Boolean(bundle.json?.code?.code), 'create owner referral bundle => 201', `status=${bundle.status}`);
  if (!okBundle) return;
  const bundleOwner = bundle.json.code.owner_user_id;
  const normBundleCode = bundle.json.code.code;
  check(bundleOwner === STATE.ownerUserId, 'bundle code owner === staging owner id', `owner=${bundleOwner}`);

  // Create Toyota Aqua lead via bundle code.
  const lead = await request(admin, 'POST', '/api/referrals/local-marketplace/leads', {
    body: {
      flow_type: 'buy_vehicle', referral_code: normBundleCode, estimated_order_amount: 1000,
      make: 'Toyota', model: 'Aqua', channel: 'web', session_id: `uat-lead-${RUN_TAG}`,
      contact: { user_id: `uat-buyer-${RUN_TAG}` }, consent: { opted_in: true },
    },
  });
  const okLead = check(
    lead.status === 201 && lead.json?.lead?.status === 'attributed' && lead.json?.attribution?.owner_user_id === STATE.ownerUserId,
    'create local lead via bundle code => attributed to owner',
    `status=${lead.status} leadStatus=${lead.json?.lead?.status}`,
  );
  const leadEventId = lead.json?.event_id;
  if (!okLead || !leadEventId) {
    skip('journey 3 reward steps', 'lead creation failed; cannot qualify');
    return;
  }

  // Qualify with milestone order_paid (rewardable) => reward 5.
  const qualify = await request(admin, 'POST', `/api/referrals/local-marketplace/leads/${encodeURIComponent(leadEventId)}/qualify`, {
    body: { milestone: 'order_paid', order_amount: 1000, referred_user_id: `uat-buyer-${RUN_TAG}` },
  });
  const okReward = check(
    qualify.status === 200 && qualify.json?.reward_created === true && Number(qualify.json?.reward?.amount) === 5,
    'qualify order_paid => reward created (amount 5)',
    `status=${qualify.status} created=${qualify.json?.reward_created} amount=${qualify.json?.reward?.amount}`,
  );
  const reward = qualify.json?.reward;
  if (reward?.id) STATE.localWalletTxnId = reward.id;

  // *** CRITICAL ATTRIBUTION PROOF ***
  // A wallet transaction was created AND its owner === the bundle code owner id.
  const rewardOwner = reward?.user_id ?? reward?.owner_user_id;
  check(
    okReward && Boolean(reward?.id) && rewardOwner === STATE.ownerUserId,
    'CRITICAL: wallet transaction owner === bundle code owner (correct attribution)',
    `rewardOwner=${rewardOwner} expected=${STATE.ownerUserId}`,
  );

  // Cross-check the owner's wallet reflects the pending credit (defense in depth).
  const wallet = await request(admin, 'GET', `/api/referrals/wallets/${encodeURIComponent(STATE.ownerUserId)}`);
  check(
    wallet.status === 200 && Number(wallet.json?.wallet?.pending_balance) >= 5,
    "owner wallet shows the pending credit (>= 5)",
    `status=${wallet.status} pending=${wallet.json?.wallet?.pending_balance}`,
  );

  // Non-rewardable milestone creates no reward.
  const lead2 = await request(admin, 'POST', '/api/referrals/local-marketplace/leads', {
    body: { flow_type: 'buy_vehicle', referral_code: normBundleCode, channel: 'web', session_id: `uat-lead2-${RUN_TAG}`, contact: { user_id: `uat-buyer2-${RUN_TAG}` }, consent: { opted_in: true } },
  });
  const lead2EventId = lead2.json?.event_id;
  if (lead2EventId) {
    const nonReward = await request(admin, 'POST', `/api/referrals/local-marketplace/leads/${encodeURIComponent(lead2EventId)}/qualify`, {
      body: { milestone: 'browsed_listing', referred_user_id: `uat-buyer2-${RUN_TAG}` },
    });
    check(
      nonReward.status === 200 && nonReward.json?.reward_created === false,
      'non-rewardable milestone (browsed_listing) creates no reward',
      `status=${nonReward.status} created=${nonReward.json?.reward_created}`,
    );
  } else {
    skip('non-rewardable milestone check', 'second lead could not be created');
  }

  // Duplicate qualification does NOT create a duplicate reward.
  const dupQualify = await request(admin, 'POST', `/api/referrals/local-marketplace/leads/${encodeURIComponent(leadEventId)}/qualify`, {
    body: { milestone: 'order_paid', order_amount: 1000, referred_user_id: `uat-buyer-${RUN_TAG}` },
  });
  check(
    dupQualify.status >= 400 && dupQualify.json?.reward_created !== true,
    'duplicate order_paid qualification does not create a duplicate reward',
    `status=${dupQualify.status}`,
  );
}

// ===========================================================================
// JOURNEY 4 — Seller / parts flow
// The import campaign service supports a 'parts_import' flow_type (and the local
// service a 'find_parts'/'sell_vehicle' flow). We exercise the real parts-import
// referral path end-to-end.
// ===========================================================================
async function journey4PartsFlow() {
  const admin = STATE.admin;
  if (!admin?.sessionToken || !STATE.ownerUserId) {
    skip('journey 4 prerequisites', 'admin session / owner id unavailable');
    return;
  }

  // Parts-import referral bundle (seller/parts path).
  const partsCode = REF('PT');
  const bundle = await request(admin, 'POST', '/api/referrals/import-campaigns/referral-bundles', {
    body: { flow_type: 'parts_import', route_origin: 'Japan', route_destination: 'Zimbabwe', owner_user_id: STATE.ownerUserId, code: partsCode, campaign_name: `UAT Parts Import ${RUN_TAG}` },
  });
  const okBundle = check(bundle.status === 201 && bundle.json?.success === true && Boolean(bundle.json?.code?.code), 'create parts-import referral bundle => 201', `status=${bundle.status}`);
  if (!okBundle) {
    skip('journey 4 parts lead/qualify', 'parts-import bundle could not be created');
    return;
  }
  const partsBundleCode = bundle.json.code.code;

  // Parts lead.
  const lead = await request(admin, 'POST', '/api/referrals/import-campaigns/leads', {
    body: {
      flow_type: 'parts_import', route_origin: 'Japan', route_destination: 'Zimbabwe', referral_code: partsBundleCode,
      part_request: { make: 'Toyota', model: 'Aqua', part: 'front bumper' }, session_id: `uat-parts-lead-${RUN_TAG}`, contact: { user_id: `uat-parts-buyer-${RUN_TAG}` },
    },
  });
  const okLead = check(lead.status === 201 && lead.json?.success === true, 'create parts-import lead => 201', `status=${lead.status}`);
  const leadEventId = lead.json?.event_id;
  if (!okLead || !leadEventId) {
    skip('journey 4 parts qualify', 'parts-import lead could not be created');
    return;
  }

  // Qualify a parts milestone (parts_order_paid is rewardable; parts_import reward = 5).
  const qualify = await request(admin, 'POST', `/api/referrals/import-campaigns/leads/${encodeURIComponent(leadEventId)}/qualify`, {
    body: { milestone: 'parts_order_paid', referred_user_id: `uat-parts-buyer-${RUN_TAG}` },
  });
  const rewardOwner = qualify.json?.reward?.user_id ?? qualify.json?.reward?.owner_user_id;
  check(
    qualify.status === 200 && qualify.json?.reward_created === true && rewardOwner === STATE.ownerUserId,
    'qualify parts_order_paid => reward created and attributed to owner',
    `status=${qualify.status} created=${qualify.json?.reward_created} owner=${rewardOwner}`,
  );
}

// ===========================================================================
// JOURNEY 5 — Import / container capacity + waitlist
// ===========================================================================
async function journey5ImportCapacity() {
  const admin = STATE.admin;
  if (!admin?.sessionToken || !STATE.ownerUserId) {
    skip('journey 5 prerequisites', 'admin session / owner id unavailable');
    return;
  }

  // --- Vehicle route capacity 8: verify 0/8 then 8/8 persists. ---
  const vehRouteKey = `uat-japan-zimbabwe-vehicle-${RUN_TAG}`.toLowerCase();
  const vehRoute = await request(admin, 'POST', '/api/referrals/import-campaigns/routes', {
    body: { flow_type: 'vehicle_import', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', total_slots: 8, booked_slots: 0, route_key: vehRouteKey, title: `UAT Vehicle Route ${RUN_TAG}` },
  });
  const okVeh = check(vehRoute.status === 201 && Boolean(vehRoute.json?.route), 'create vehicle import route (capacity 8) => 201', `status=${vehRoute.status}`);
  const vehKey = vehRoute.json?.route?.route_key || vehRoute.json?.route_key || vehRouteKey;

  if (okVeh) {
    const status0 = await request(admin, 'GET', `/api/referrals/import-campaigns/routes/${encodeURIComponent(vehKey)}/status`, { csrf: false });
    const cap0 = status0.json?.capacity || {};
    check(
      status0.status === 200 && Number(cap0.total_capacity_units) === 8 && Number(cap0.booked_capacity_units) === 0,
      'vehicle route reports 0/8 capacity',
      `total=${cap0.total_capacity_units} booked=${cap0.booked_capacity_units}`,
    );

    // Book to full: 8/8.
    await request(admin, 'POST', `/api/referrals/import-campaigns/routes/${encodeURIComponent(vehKey)}/capacity`, {
      body: { flow_type: 'vehicle_import', total_slots: 8, booked_slots: 8 },
    });
    const status8 = await request(admin, 'GET', `/api/referrals/import-campaigns/routes/${encodeURIComponent(vehKey)}/status`, { csrf: false });
    const cap8 = status8.json?.capacity || {};
    check(
      status8.status === 200 && Number(cap8.total_capacity_units) === 8 && Number(cap8.booked_capacity_units) === 8,
      'vehicle route 8/8 persists',
      `total=${cap8.total_capacity_units} booked=${cap8.booked_capacity_units}`,
    );
  }

  // --- Container route capacity 30 CBM. ---
  const contRouteKey = `uat-japan-zimbabwe-container-${RUN_TAG}`.toLowerCase();
  const contRoute = await request(admin, 'POST', '/api/referrals/import-campaigns/routes', {
    body: { flow_type: 'container_space', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', total_cbm: 30, booked_cbm: 25, route_key: contRouteKey, title: `UAT Container Route ${RUN_TAG}` },
  });
  const okCont = check(contRoute.status === 201 && Boolean(contRoute.json?.route), 'create container route (capacity 30 CBM, 25 booked => 5 available) => 201', `status=${contRoute.status}`);
  const contKey = contRoute.json?.route?.route_key || contRoute.json?.route_key || contRouteKey;

  // Container referral bundle for leads.
  const contBundleCode = REF('CT');
  const contBundle = await request(admin, 'POST', '/api/referrals/import-campaigns/referral-bundles', {
    body: { flow_type: 'container_space', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', owner_user_id: STATE.ownerUserId, code: contBundleCode, route_key: contKey },
  });
  const contCode = contBundle.json?.code?.code;
  if (!okCont || !contCode) {
    skip('journey 5 container lead steps', 'container route/bundle could not be created');
    return;
  }

  // 5 CBM lead ok (5 available).
  const leadOk = await request(admin, 'POST', '/api/referrals/import-campaigns/leads', {
    body: { flow_type: 'container_space', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', referral_code: contCode, requested_cbm: 5, session_id: `uat-cont-ok-${RUN_TAG}`, contact: { user_id: `uat-cont-buyer-${RUN_TAG}` } },
  });
  const okLead = check(leadOk.status === 201 && leadOk.json?.success === true, '5 CBM container lead within capacity => 201', `status=${leadOk.status}`);
  const leadEventId = leadOk.json?.event_id;

  // Over-capacity without waitlist fails (request 50 > available).
  const over = await request(admin, 'POST', '/api/referrals/import-campaigns/leads', {
    body: { flow_type: 'container_space', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', referral_code: contCode, requested_cbm: 50, session_id: `uat-cont-over-${RUN_TAG}` },
  });
  check(over.status >= 400 && over.status < 500, 'over-capacity lead without waitlist => rejected (4xx)', `status=${over.status}`);

  // Over-capacity WITH waitlist => waitlisted.
  const waitlisted = await request(admin, 'POST', '/api/referrals/import-campaigns/leads', {
    body: { flow_type: 'container_space', route_origin: `Japan ${RUN_TAG}`, route_destination: 'Zimbabwe', referral_code: contCode, requested_cbm: 50, allow_waitlist: true, session_id: `uat-cont-wl-${RUN_TAG}`, contact: { user_id: `uat-cont-wl-${RUN_TAG}` } },
  });
  check(
    waitlisted.status === 201 && waitlisted.json?.success === true && waitlisted.json?.lead?.waitlisted === true,
    'over-capacity lead WITH allow_waitlist => waitlisted',
    `status=${waitlisted.status} waitlisted=${waitlisted.json?.lead?.waitlisted}`,
  );

  // Qualify import lead deposit_paid reward 10 and assert attribution.
  if (okLead && leadEventId) {
    const qualify = await request(admin, 'POST', `/api/referrals/import-campaigns/leads/${encodeURIComponent(leadEventId)}/qualify`, {
      body: { milestone: 'deposit_paid', referred_user_id: `uat-cont-buyer-${RUN_TAG}` },
    });
    const rewardOwner = qualify.json?.reward?.user_id ?? qualify.json?.reward?.owner_user_id;
    const okQ = check(
      qualify.status === 200 && qualify.json?.reward_created === true && Number(qualify.json?.reward?.amount) === 10 && rewardOwner === STATE.ownerUserId,
      'qualify container deposit_paid => reward 10 attributed to owner',
      `status=${qualify.status} amount=${qualify.json?.reward?.amount} owner=${rewardOwner}`,
    );
    if (okQ && qualify.json?.reward?.id) STATE.importWalletTxnId = qualify.json.reward.id;
  } else {
    skip('import deposit_paid qualification', 'in-capacity container lead unavailable');
  }
}

// ===========================================================================
// JOURNEY 6 — Marketing state machine
// ===========================================================================
async function journey6Marketing() {
  const admin = STATE.admin;
  if (!admin?.sessionToken || !STATE.campaignId) {
    skip('journey 6 prerequisites', 'admin session / campaign id unavailable');
    return;
  }

  // Create kit (also produces SEO page + channel copy + disclosure-bearing assets).
  const kit = await request(admin, 'POST', '/api/referrals/marketing/campaign-kits', {
    body: { campaign_id: STATE.campaignId, base_url: 'https://staging.carup.app' },
  });
  const landing = (kit.json?.assets || []).find((a) => a?.seo?.canonical_url) || (kit.json?.assets || [])[0];
  check(
    kit.status === 201 && Array.isArray(kit.json?.assets) && kit.json.assets.length > 0,
    'create campaign kit => assets generated',
    `status=${kit.status} count=${kit.json?.assets?.length}`,
  );
  // Disclosure / canonical / UTM / internal links intact on the landing asset.
  if (landing) {
    const seo = landing.seo || {};
    const okSeo =
      typeof seo.canonical_url === 'string' &&
      typeof seo.tracked_url === 'string' && seo.tracked_url.includes('utm_campaign=') &&
      Array.isArray(seo.internal_links) && seo.internal_links.length > 0 &&
      typeof landing.disclosure === 'string' && landing.disclosure.length > 0;
    check(okSeo, 'kit asset preserves canonical + UTM + internal links + disclosure', `canonical=${Boolean(seo.canonical_url)} utm=${seo.tracked_url?.includes?.('utm_campaign=')} links=${seo.internal_links?.length} disclosure=${Boolean(landing.disclosure)}`);
  }

  // Explicit SEO page / channel message / proof story / FAQ drafts.
  const seoPage = await request(admin, 'POST', '/api/referrals/marketing/seo-pages', { body: { campaign_id: STATE.campaignId, asset_type: 'corridor_landing_page', base_url: 'https://staging.carup.app' } });
  const okSeoPage = check(seoPage.status === 201 && seoPage.json?.asset?.metadata?.status === 'draft', 'draft SEO page => status draft', `status=${seoPage.status} assetStatus=${seoPage.json?.asset?.metadata?.status}`);
  const assetId = seoPage.json?.asset?.id;
  if (assetId) STATE.marketingAssetId = assetId;

  const channelMsg = await request(admin, 'POST', '/api/referrals/marketing/channel-messages', { body: { campaign_id: STATE.campaignId, channels: ['whatsapp', 'telegram'], call_to_action: 'Reserve your space today.' } });
  check(channelMsg.status === 201 && Array.isArray(channelMsg.json?.assets) && channelMsg.json.assets.length > 0, 'draft channel messages => assets', `status=${channelMsg.status}`);

  const proof = await request(admin, 'POST', '/api/referrals/marketing/proof-stories', { body: { campaign_id: STATE.campaignId } });
  check(proof.status === 201 && Boolean(proof.json?.asset), 'draft proof story => asset', `status=${proof.status}`);

  const faq = await request(admin, 'POST', '/api/referrals/marketing/faqs', { body: { campaign_id: STATE.campaignId } });
  check(faq.status === 201 && Boolean(faq.json?.asset), 'draft FAQ => asset', `status=${faq.status}`);

  if (!okSeoPage || !assetId) {
    skip('journey 6 state-machine transitions', 'draft SEO asset unavailable');
    return;
  }

  // Legal chain: draft -> review -> approved -> scheduled -> published.
  const toReview = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { body: { status: 'review' } });
  check(toReview.status === 200 && toReview.json?.asset?.metadata?.status === 'review', 'transition draft -> review', `status=${toReview.status}`);

  const toApproved = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { body: { status: 'approved', reason: 'copy verified' } });
  check(toApproved.status === 200 && toApproved.json?.asset?.metadata?.status === 'approved', 'transition review -> approved', `status=${toApproved.status}`);

  // Scheduling requires a time: missing scheduled_at fails.
  const schedNoTime = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { body: { status: 'scheduled' } });
  check(schedNoTime.status >= 400 && schedNoTime.status < 500, 'scheduling without scheduled_at is rejected (4xx)', `status=${schedNoTime.status}`);

  const toScheduled = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { body: { status: 'scheduled', scheduled_at: '2026-12-01T09:00:00.000Z' } });
  check(toScheduled.status === 200 && toScheduled.json?.asset?.metadata?.status === 'scheduled', 'transition approved -> scheduled (with time)', `status=${toScheduled.status}`);

  const toPublished = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(assetId)}/status`, { body: { status: 'published' } });
  const publishedUrl = toPublished.json?.asset?.metadata?.public_url || '';
  check(
    toPublished.status === 200 && toPublished.json?.asset?.metadata?.status === 'published' && publishedUrl.includes('utm_campaign='),
    'transition scheduled -> published via backend workflow (UTM-preserving public_url)',
    `status=${toPublished.status} url=${publishedUrl ? 'present' : 'missing'}`,
  );

  // Illegal jump fails: a fresh draft cannot go straight to published.
  const draft2 = await request(admin, 'POST', '/api/referrals/marketing/seo-pages', { body: { campaign_id: STATE.campaignId, asset_type: 'corridor_landing_page', base_url: 'https://staging.carup.app' } });
  const draft2Id = draft2.json?.asset?.id;
  if (draft2Id) {
    const illegal = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(draft2Id)}/status`, { body: { status: 'published' } });
    check(illegal.status >= 400 && illegal.status < 500, 'illegal jump draft -> published is rejected (4xx)', `status=${illegal.status}`);

    // Rejection requires a reason.
    const rejectNoReason = await request(admin, 'PATCH', `/api/referrals/marketing/assets/${encodeURIComponent(draft2Id)}/status`, { body: { status: 'rejected' } });
    check(rejectNoReason.status >= 400 && rejectNoReason.status < 500, 'rejection without reason is rejected (4xx)', `status=${rejectNoReason.status}`);
  } else {
    skip('illegal-jump / rejection checks', 'second draft asset unavailable');
  }
}

// ===========================================================================
// JOURNEY 7 — Fraud hold -> human override
// ===========================================================================
async function journey7FraudHold() {
  const admin = STATE.admin;
  const txnId = STATE.importWalletTxnId || STATE.localWalletTxnId;
  if (!admin?.sessionToken || !txnId) {
    skip('journey 7 prerequisites', 'admin session / a wallet transaction id from journeys 3 or 5 unavailable');
    return;
  }

  // Trigger a risk signal.
  const risk = await request(admin, 'POST', '/api/referrals/trust/risk-checks', {
    body: { wallet_transaction_id: txnId, duplicate_account: true },
  });
  const okRisk = check(risk.status === 201 && Boolean(risk.json?.risk_check?.id), 'run risk check => risk_check created', `status=${risk.status}`);
  const riskEventId = risk.json?.risk_check?.id;

  // Open a human review case.
  let caseEventId = null;
  if (okRisk && riskEventId) {
    const reviewCase = await request(admin, 'POST', '/api/referrals/trust/review-cases', {
      body: { risk_check_event_id: riskEventId, wallet_transaction_id: txnId, reason: 'Duplicate-account signal needs human review.' },
    });
    check(reviewCase.status === 201 && Boolean(reviewCase.json?.review_case?.id), 'open human review case => 201', `status=${reviewCase.status}`);
    caseEventId = reviewCase.json?.review_case?.id;
  }

  // Hold requires a reason: missing reason fails.
  const holdNoReason = await request(admin, 'POST', `/api/referrals/trust/wallet-transactions/${encodeURIComponent(txnId)}/hold`, { body: {} });
  check(holdNoReason.status >= 400 && holdNoReason.status < 500, 'wallet hold without reason is rejected (4xx)', `status=${holdNoReason.status}`);

  // Apply the hold with a reason => held.
  const hold = await request(admin, 'POST', `/api/referrals/trust/wallet-transactions/${encodeURIComponent(txnId)}/hold`, {
    body: { reason: 'Hold pending duplicate-account review.', review_case_event_id: caseEventId || undefined },
  });
  check(hold.status === 201 && hold.json?.transaction?.status === 'held', 'apply wallet hold (with reason) => status held', `status=${hold.status} txnStatus=${hold.json?.transaction?.status}`);

  // Human override: a trust decision can release/override the hold.
  if (caseEventId) {
    const decide = await request(admin, 'PATCH', `/api/referrals/trust/review-cases/${encodeURIComponent(caseEventId)}/decision`, {
      body: { decision: 'allow', reason: 'Manual review cleared the account; releasing the hold.' },
    });
    check(decide.status === 200 && Boolean(decide.json?.review_case), 'human review override (decision=allow with reason) => 200', `status=${decide.status}`);
  } else {
    skip('human override decision', 'review case id unavailable');
  }

  // Audit events recorded — the admin timeline / audit export should contain trust events.
  const audit = await request(admin, 'GET', '/api/referrals/trust/audit-export?limit=200', { csrf: false });
  const events = audit.json?.export?.events || [];
  const hasHold = events.some((e) => String(e?.event_type || '').includes('wallet_hold'));
  check(audit.status === 200 && events.length > 0 && hasHold, 'audit trail records the hold event', `status=${audit.status} count=${events.length} hold=${hasHold}`);
}

// ===========================================================================
// JOURNEY 8 — Dispute -> resolution -> audit checksum
// ===========================================================================
async function journey8Dispute() {
  const admin = STATE.admin;
  const owner = STATE.owner;
  const txnId = STATE.localWalletTxnId || STATE.importWalletTxnId;
  if (!admin?.sessionToken || !owner?.sessionToken || !txnId) {
    skip('journey 8 prerequisites', 'admin/owner sessions or a wallet transaction id unavailable');
    return;
  }

  // Owner files a dispute (reason required).
  const noReason = await request(owner, 'POST', '/api/referrals/trust/disputes', { body: { wallet_transaction_id: txnId } });
  check(noReason.status >= 400 && noReason.status < 500, 'dispute without reason is rejected (4xx)', `status=${noReason.status}`);

  const dispute = await request(owner, 'POST', '/api/referrals/trust/disputes', {
    body: { wallet_transaction_id: txnId, reason: 'I completed a genuine purchase; please review.' },
  });
  const okDispute = check(dispute.status === 201 && Boolean(dispute.json?.dispute?.id) && dispute.json?.dispute?.status === 'open', 'owner files dispute => 201 open', `status=${dispute.status}`);
  const disputeEventId = dispute.json?.dispute?.id;
  if (okDispute && disputeEventId) STATE.disputeEventId = disputeEventId;

  if (!okDispute || !disputeEventId) {
    skip('journey 8 resolution + audit', 'dispute could not be created');
    return;
  }

  // Resolution requires a reason.
  const resolveNoReason = await request(admin, 'PATCH', `/api/referrals/trust/disputes/${encodeURIComponent(disputeEventId)}/resolve`, { body: { status: 'resolved_upheld' } });
  check(resolveNoReason.status >= 400 && resolveNoReason.status < 500, 'dispute resolution without reason is rejected (4xx)', `status=${resolveNoReason.status}`);

  // Admin resolves with an allowed outcome + required reason.
  const resolve = await request(admin, 'PATCH', `/api/referrals/trust/disputes/${encodeURIComponent(disputeEventId)}/resolve`, {
    body: { status: 'resolved_upheld', reason: 'Booking evidence confirmed; upheld.' },
  });
  const finalStatus = resolve.json?.dispute?.metadata?.status || resolve.json?.dispute?.status;
  check(resolve.status === 200 && finalStatus === 'resolved_upheld', 'admin resolves dispute (resolved_upheld + reason) => final status', `status=${resolve.status} final=${finalStatus}`);

  // Audit export: event count + checksum, and the create + resolve dispute events are present.
  const audit = await request(admin, 'GET', '/api/referrals/trust/audit-export?limit=500', { csrf: false });
  const exp = audit.json?.export || {};
  const events = exp.events || [];
  const hasCreate = events.some((e) => String(e?.event_type || '').includes('dispute_created'));
  const hasResolve = events.some((e) => String(e?.event_type || '').includes('dispute_resolved'));
  check(
    audit.status === 200 && typeof exp.checksum === 'string' && exp.checksum.length > 0 && Number(exp.count) >= 2 && hasCreate && hasResolve,
    'audit export returns count + checksum and contains dispute create + resolve events',
    `status=${audit.status} count=${exp.count} checksum=${exp.checksum ? 'present' : 'missing'} create=${hasCreate} resolve=${hasResolve}`,
  );
}

// ===========================================================================
// JOURNEY 9 — WhatsApp/Telegram inbound attribution
// Uses the generic POST /channels/:channel/inbound path with an authenticated user
// (so no webhook secret is needed) carrying a referral code in the message.
// ===========================================================================
async function journey9ChannelInbound() {
  const admin = STATE.admin;
  if (!admin?.sessionToken) {
    skip('journey 9 prerequisites', 'admin session unavailable');
    return;
  }

  // Need a real, valid code carrying attribution. Reuse the journey-2 code if present, else mint one.
  let code = null;
  let expectedOwner = STATE.ownerUserId;
  if (STATE.codeId && STATE.campaignId) {
    // Re-mint a fresh channel code to keep this journey independent of journey 2 ordering.
    const minted = await request(admin, 'POST', '/api/referrals/codes', {
      body: { campaign_id: STATE.campaignId, owner_user_id: STATE.ownerUserId, code: REF('CH'), code_type: 'MEMBER', channel: 'whatsapp' },
    });
    code = minted.json?.code?.code || null;
  }
  if (!code) {
    skip('journey 9 inbound attribution', 'no valid referral code available to embed in the inbound message');
    return;
  }

  for (const channel of ['whatsapp', 'telegram']) {
    const inbound = await request(admin, 'POST', `/api/referrals/channels/${channel}/inbound`, {
      body: { message: `Hi! Please use code ${code} to help me buy a Toyota Aqua.`, sender_id: `uat-${channel}-sender-${RUN_TAG}`, session_id: `uat-${channel}-thread-${RUN_TAG}` },
      csrf: false, // not a mutating-form CSRF surface; authenticated context is the gate
    });
    const extracted = inbound.json?.extracted_referral_code;
    const attributedOwner = inbound.json?.attribution?.owner_user_id;
    check(
      inbound.status === 200 && extracted === code && attributedOwner === expectedOwner,
      `${channel} inbound message parses referral code and records attribution`,
      `status=${inbound.status} extracted=${extracted} owner=${attributedOwner}`,
    );
  }
}

// ===========================================================================
// JOURNEY 10 — AI triage + safe handoff (audited)
// ===========================================================================
async function journey10AgentTriage() {
  const admin = STATE.admin;
  if (!admin?.sessionToken) {
    skip('journey 10 prerequisites', 'admin session unavailable');
    return;
  }

  const triage = await request(admin, 'POST', '/api/referrals/agent/triage', {
    body: { message: 'I need a container campaign and share kit for Japan to Zimbabwe.', channel: 'whatsapp', session_id: `uat-triage-${RUN_TAG}` },
    csrf: false, // agent gateway gated by authenticated user / gateway key, not the SPA CSRF form
  });

  const result = triage.json?.result || {};
  const suggested = Array.isArray(result.suggested_tools) ? result.suggested_tools : [];
  const safeResult = typeof result.intent === 'string' && typeof result.safe_response === 'string';
  check(
    triage.status === 200 && triage.json?.success === true && safeResult && suggested.length > 0,
    'agent triage returns a safe handoff/triage result (intent + safe_response + suggested tools)',
    `status=${triage.status} intent=${result.intent} tools=${suggested.length}`,
  );

  // The tool call is audited: executeTool returns an audit_event_id.
  check(
    Boolean(triage.json?.audit_event_id),
    'agent triage tool call is audited (audit_event_id returned)',
    `audit_event_id=${triage.json?.audit_event_id ? 'present' : 'missing'}`,
  );
}

// ---------------------------------------------------------------------------
// Summary table + exit code.
// ---------------------------------------------------------------------------
function printSummary() {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of RESULTS) counts[r.status] += 1;

  console.log('\n========================= UAT SUMMARY =========================');
  const byJourney = new Map();
  for (const r of RESULTS) {
    if (!byJourney.has(r.journey)) byJourney.set(r.journey, { PASS: 0, FAIL: 0, SKIP: 0, fails: [] });
    const g = byJourney.get(r.journey);
    g[r.status] += 1;
    if (r.status === 'FAIL') g.fails.push(`${r.step}${r.message ? ` (${r.message})` : ''}`);
  }
  for (const [name, g] of byJourney.entries()) {
    const verdict = g.FAIL > 0 ? 'FAIL' : 'PASS';
    console.log(`  [${verdict}] ${name}  pass=${g.PASS} fail=${g.FAIL} skip=${g.SKIP}`);
    for (const f of g.fails) console.log(`        ✗ ${f}`);
  }
  console.log('---------------------------------------------------------------');
  console.log(`  TOTAL: pass=${counts.PASS} fail=${counts.FAIL} skip=${counts.SKIP}`);
  console.log('===============================================================\n');

  return counts.FAIL === 0;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const config = loadConfig();
  assertStagingTarget(config);

  console.log(`CarUp Referral Engine — UAT journeys`);
  console.log(`Target: ${config.baseUrl}`);
  console.log(`Run tag: ${RUN_TAG}\n`);

  await journey('Journey 1 — Auth + boundaries', () => journey1Auth(config));
  await journey('Journey 2 — Campaign -> code -> coupon -> share assets', () => journey2CampaignCodeCouponShare());
  await journey('Journey 3 — Owner bundle -> local lead -> reward -> CORRECT wallet', () => journey3LocalAttribution());
  await journey('Journey 4 — Seller / parts flow', () => journey4PartsFlow());
  await journey('Journey 5 — Import / container capacity + waitlist', () => journey5ImportCapacity());
  await journey('Journey 6 — Marketing state machine', () => journey6Marketing());
  await journey('Journey 7 — Fraud hold -> human override', () => journey7FraudHold());
  await journey('Journey 8 — Dispute -> resolution -> audit checksum', () => journey8Dispute());
  await journey('Journey 9 — WhatsApp/Telegram inbound attribution', () => journey9ChannelInbound());
  await journey('Journey 10 — AI triage + safe handoff', () => journey10AgentTriage());

  const allPassed = printSummary();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL: the UAT runner crashed:', redact(err?.message || String(err)));
  process.exit(1);
});
