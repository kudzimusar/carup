// CARUP-PAY-03A-STG01-FINAL — Stage 6 verification of the ONE authorized sandbox purchase (no money moves here).
//
//   node scripts/uat/pay03a-stg01-stage6-checks.mjs <evidence-dir> --phase paid      # after the purchase
//   node scripts/uat/pay03a-stg01-stage6-checks.mjs <evidence-dir> --phase refunded  # after the refund
//
// Reads the canonical ledger directly (read-only SQL) and exercises the product over real HTTP with real
// sessions. It never creates a Checkout session or a refund; those happen only in the Owner-authorized
// browser steps. Every assertion records observed values into stage6-<phase>.json.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:5031';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_ROOT = '/private/tmp/carup-pay01a-supabase';
const EVIDENCE_DIR = process.argv[2];
const PHASE = process.argv[process.argv.indexOf('--phase') + 1];
if (!EVIDENCE_DIR || !['paid', 'refunded'].includes(PHASE)) throw new Error('usage: <evidence-dir> --phase paid|refunded');
const accounts = JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8'));
const purchase = JSON.parse(readFileSync(`${EVIDENCE_DIR}/stage6-checkout.json`, 'utf8'));
const ORDER = purchase.orderId;
if (!/^[0-9a-f-]{36}$/.test(ORDER)) throw new Error('no recorded Stage 6 order');

const sqlJson = (statement) => JSON.parse(execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
  `select coalesce(json_agg(t), '[]') from (${statement}) t`], { encoding: 'utf8' }).trim());

async function csrf(identity = {}) { return (await (await fetch(`${API}/api/security/csrf-token`, { headers: identity })).json()).csrfToken; }
const sessions = {};
async function session(who) {
  if (who === 'anonymous') return {};
  if (sessions[who]) return sessions[who];
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
    body: JSON.stringify({ email: accounts[who].email, password: accounts[who].password }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login ${who} failed ${r.status}`);
  sessions[who] = { 'x-session-token': j.token, 'x-user-id': j.user.id };
  return sessions[who];
}
async function api(who, method, path, body) {
  const identity = await session(who);
  const headers = { ...identity };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await csrf(identity);
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, code: json?.code || json?.error || null, json, cacheControl: r.headers.get('cache-control') };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
function check(id, description, pass, observed) {
  checks.push({ id, description, pass: Boolean(pass), observed });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(5)} ${description} ${observed !== undefined ? `→ ${JSON.stringify(observed).slice(0, 220)}` : ''}`);
}

function ledger() {
  const [payment] = sqlJson(`select reference, gateway, amount::text, currency, status, pay01a_account_id, pay01a_actor_id,
      pay01a_checkout_id, pay01a_intent_id, pay01a_refund_id, pay02_quote_id, pay02_product_code from public.payment_transactions
      where reference = '${purchase.paymentReference}'`);
  const [order] = sqlJson(`select id, buyer_id, vin, quote_id, payment_reference, entitlement_status, report_version_id,
      report_version_number, report_content_hash, granted_at is not null as granted, revoked_at is not null as revoked
      from public.pay02_report_orders where id = '${ORDER}'`);
  const [quote] = sqlJson(`select id, status, total_minor::text, currency, payer_id, source_object_id, payment_reference
      from public.pay02_commercial_quotes where id = '${purchase.quoteId}'`);
  const versions = sqlJson(`select id, vin, version, report_tier, pay03a_order_id, content_hash, revoked, share_token is not null as has_share,
      share_expires_at from public.report_versions where pay03a_order_id = '${ORDER}'`);
  const receipts = sqlJson(`select event_id, event_type from public.pay01a_stripe_event_receipts where reference = '${purchase.paymentReference}' order by 1`);
  const orders = sqlJson('select count(*)::int as n from public.pay02_report_orders')[0].n;
  return { payment, order, quote, versions, receipts, orders };
}

const health = await (await fetch(`${API}/api/health`)).json();
const l = ledger();
check('L00', 'Exactly one PAY-03A order exists in the isolated database (one authorized session)', l.orders === 1, l.orders);
check('L01', 'Canonical payment: Stripe CarUp Japan sandbox account, JPY 100, buyer is the PAY-01A actor', l.payment.gateway === 'stripe_carup_japan_sandbox'
  && l.payment.pay01a_account_id === 'acct_1UVnGaEjgXqvlsJk' && Number(l.payment.amount) === 100 && String(l.payment.currency).toUpperCase() === 'JPY'
  && l.payment.pay01a_actor_id === accounts.buyerA.userId, { status: l.payment.status, amount: l.payment.amount, currency: l.payment.currency });
check('L02', 'Checkout/PaymentIntent references are test-mode and correlated', /^cs_test_/.test(l.payment.pay01a_checkout_id) && /^pi_/.test(l.payment.pay01a_intent_id || '')
  && l.payment.pay01a_checkout_id === purchase.checkoutId, { checkout: l.payment.pay01a_checkout_id, intent: l.payment.pay01a_intent_id });
check('L03', 'Quote ↔ payment ↔ order bidirectional binding', l.payment.pay02_quote_id === purchase.quoteId && l.order.quote_id === purchase.quoteId
  && l.order.payment_reference === purchase.paymentReference && l.quote.payment_reference === purchase.paymentReference && l.quote.payer_id === accounts.buyerA.userId
  && l.quote.source_object_id === 'QA-PAY03A-0001' && l.order.vin === 'QA-PAY03A-0001');
check('L04', 'Exactly one immutable paid report version bound to the order', l.versions.length === 1 && l.versions[0].report_tier === 'pay03a_commercial_snapshot'
  && l.versions[0].id === l.order.report_version_id && l.versions[0].content_hash === l.order.report_content_hash, l.versions.map((v) => ({ id: v.id, version: v.version, revoked: v.revoked })));
check('L05', 'Signed Stripe webhook events were received and recorded (livemode=false verified server-side)', l.receipts.length >= 1, l.receipts.map((r) => r.event_type));

if (PHASE === 'paid') {
  check('P01', 'Payment verified paid by provider read; entitlement granted; quote fulfilled', l.payment.status === 'paid' && l.order.entitlement_status === 'entitled'
    && l.order.granted && !l.order.revoked && l.quote.status === 'fulfilled', { payment: l.payment.status, entitlement: l.order.entitlement_status, quote: l.quote.status });

  const report = await api('buyerA', 'GET', `/api/pay03a/orders/${ORDER}/report`);
  const delivered = report.json?.report;
  const recomputed = delivered ? createHash('sha256').update(JSON.stringify(delivered)).digest('hex') : null;
  check('P02', 'Buyer receives the report with Cache-Control no-store', report.status === 200 && /no-store/.test(report.cacheControl || ''), { status: report.status, cacheControl: report.cacheControl });
  check('P03', 'D-HASH-1 physical: sha256 over the delivered report JSON equals the certified content_hash', recomputed === report.json?.contentHash
    && recomputed === l.order.report_content_hash, { recomputed, contentHash: report.json?.contentHash });
  check('P04', 'Report is the purchased vehicle, with limitations, and carries no buyer/payment/order identifiers (F2)', delivered?.vin === 'QA-PAY03A-0001'
    && !JSON.stringify(delivered || {}).includes(purchase.paymentReference) && !JSON.stringify(delivered || {}).includes(accounts.buyerA.userId)
    && !JSON.stringify(delivered || {}).includes(ORDER)
    && Array.isArray(delivered?.limitations) && delivered.limitations.length > 0 && delivered?.audience === 'buyer',
    { evidence_index: (delivered?.evidence_index || []).length, timeline: (delivered?.timeline || []).length, limitations: (delivered?.limitations || []).length, scheme: delivered?.commercial_snapshot?.content_hash_scheme });
  check('P05', 'Private evidence never appears in the buyer report', !JSON.stringify(delivered || {}).includes('e746f9dd-ad90-4941-abf8-5ebaa1cf768c')
    && !JSON.stringify(delivered || {}).includes('ocr-documents'));
  const replay = await api('buyerA', 'POST', `/api/pay03a/orders/${ORDER}/verify`, {});
  check('P06', 'Buyer re-verify is idempotent (no second report version)', replay.status === 200 && ledger().versions.length === 1, { status: replay.status, versionId: replay.json?.reportVersionId });

  for (const [id, who] of [['X01', 'buyerB'], ['X02', 'anonymous']]) {
    const r1 = await api(who, 'GET', `/api/pay03a/orders/${ORDER}`);
    const r2 = await api(who, 'GET', `/api/pay03a/orders/${ORDER}/report`);
    check(id, `${who} cannot read the order or its report`, [401, 403, 404].includes(r1.status) && [401, 403, 404].includes(r2.status), { order: r1.status, report: r2.status });
  }
  const buyerRefund = await api('buyerA', 'POST', `/api/pay03a/admin/orders/${ORDER}/refund`, {});
  check('X03', 'The buyer cannot refund (admin-only)', buyerRefund.status === 403, buyerRefund.status);

  const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', SUPABASE_ROOT, '--output', 'json'], {
    cwd: SUPABASE_ROOT, env: { PATH: `${process.env.PATH}:/usr/local/bin:${process.env.HOME}/.docker/bin`, HOME: process.env.HOME }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'authenticated', sub: randomUUID(), aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const jwt = `${head}.${body}.${createHmac('sha256', status.JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
  const direct = await fetch(`${status.API_URL}/rest/v1/report_versions?select=id&pay03a_order_id=eq.${ORDER}`, { headers: { apikey: status.ANON_KEY, authorization: `Bearer ${jwt}` } });
  const directRows = await direct.json();
  check('S04', 'NON-VACUOUS: a real paid snapshot exists, yet an authenticated PostgREST read returns nothing', l.versions.length === 1 && Array.isArray(directRows) && directRows.length === 0, { status: direct.status, rows: Array.isArray(directRows) ? directRows.length : directRows });

  // Share links: expiry (minimum TTL 300 s), then a fresh link kept for the refund-revocation check.
  const short = await api('buyerA', 'POST', `/api/pay03a/orders/${ORDER}/share`, { ttlSeconds: 300 });
  const shortToken = short.json?.shareToken;
  const sharedOk = await fetch(`${API}/api/reports/shared/${shortToken}`);
  check('H01', 'Expiring share link opens for an anonymous recipient while the order is entitled', short.status === 201 && sharedOk.status === 200, { create: short.status, open: sharedOk.status, expiresAt: short.json?.shareExpiresAt });
  const crossShare = await api('buyerB', 'POST', `/api/pay03a/orders/${ORDER}/share`, { ttlSeconds: 300 });
  check('H02', 'Another buyer cannot mint a share link for this order', [403, 404].includes(crossShare.status), crossShare.status);
  console.log('… waiting 310 s for the 300 s share link to expire');
  await pause(310_000);
  const sharedExpired = await fetch(`${API}/api/reports/shared/${shortToken}`);
  const expiredBody = await sharedExpired.json().catch(() => ({}));
  check('H03', 'Share link is refused after expiry', [404, 410].includes(sharedExpired.status), { status: sharedExpired.status, body: expiredBody });
  const keep = await api('buyerA', 'POST', `/api/pay03a/orders/${ORDER}/share`, {});
  writeFileSync(`${EVIDENCE_DIR}/stage6-share-token.json`, JSON.stringify({ token: keep.json?.shareToken, expiresAt: keep.json?.shareExpiresAt }, null, 2));
  check('H04', 'Fresh default share link (kept to test refund revocation)', keep.status === 201 && Boolean(keep.json?.shareToken), { expiresAt: keep.json?.shareExpiresAt });

  const reconcile = await api('commerce', 'POST', `/api/pay03a/admin/orders/${ORDER}/reconcile`, {});
  const after = ledger();
  check('R01', 'Admin reconcile/recovery on the fulfilled order: idempotent, no second version, still paid', reconcile.status === 200
    && reconcile.json?.fulfillmentRecovery?.idempotentReplay === true && after.versions.length === 1 && after.payment.status === 'paid'
    && after.payment.pay01a_intent_id === l.payment.pay01a_intent_id, { status: reconcile.status, recovery: reconcile.json?.fulfillmentRecovery });
  const audits = sqlJson(`select event_type, actor_user_id, actor_role from public.trust_audit_events where new_value->>'orderId' = '${ORDER}' order by created_at`);
  check('R02', 'Reconcile is attributed to the proven administrator (D-AUDIT-1)', audits.some((a) => a.event_type === 'PAY03A_ADMIN_RECONCILE' && a.actor_user_id === accounts.commerce.userId), audits);
}

if (PHASE === 'refunded') {
  check('F01', 'Provider refund reconciled: payment refunded with one re_ reference; original references preserved', l.payment.status === 'refunded'
    && /^re_/.test(l.payment.pay01a_refund_id || '') && l.payment.pay01a_checkout_id === purchase.checkoutId, { status: l.payment.status, refund: l.payment.pay01a_refund_id, intent: l.payment.pay01a_intent_id });
  check('F02', 'Quote refunded; entitlement revoked; report version revoked', l.quote.status === 'refunded' && l.order.entitlement_status === 'revoked_refunded'
    && l.order.revoked && l.versions.length === 1 && l.versions[0].revoked === true, { quote: l.quote.status, entitlement: l.order.entitlement_status, versionRevoked: l.versions[0]?.revoked });
  const report = await api('buyerA', 'GET', `/api/pay03a/orders/${ORDER}/report`);
  check('F03', 'Buyer can no longer retrieve the protected report', report.status === 403, { status: report.status, code: report.code });
  const share = JSON.parse(readFileSync(`${EVIDENCE_DIR}/stage6-share-token.json`, 'utf8'));
  const shared = await fetch(`${API}/api/reports/shared/${share.token}`);
  check('F04', 'Existing share link is unusable after the refund', [404, 410].includes(shared.status), { status: shared.status, body: await shared.json().catch(() => null) });
  const reshare = await api('buyerA', 'POST', `/api/pay03a/orders/${ORDER}/share`, {});
  check('F05', 'A new share link cannot be minted after the refund', reshare.status === 403, { status: reshare.status, code: reshare.code });
  const otherBuyer = await api('buyerB', 'GET', `/api/pay03a/orders/${ORDER}`);
  check('F06', 'Other buyers remain unauthorized', otherBuyer.status === 404, otherBuyer.status);
  const replay = await api('commerce', 'POST', `/api/pay03a/admin/orders/${ORDER}/refund`, {});
  const afterReplay = ledger();
  check('F07', 'Replayed admin refund: idempotent, the same single refund, no second provider refund', replay.status === 200 && replay.json?.idempotentReplay === true
    && afterReplay.payment.pay01a_refund_id === l.payment.pay01a_refund_id, { status: replay.status, idempotentReplay: replay.json?.idempotentReplay, refund: afterReplay.payment.pay01a_refund_id });
  const audits = sqlJson(`select event_type, actor_user_id, actor_role, new_value->>'outcome' as outcome, new_value->>'refundId' as refund_id
      from public.trust_audit_events where new_value->>'orderId' = '${ORDER}' order by created_at`);
  const requested = audits.filter((a) => a.event_type === 'PAY03A_ADMIN_REFUND_REQUESTED');
  const results = audits.filter((a) => a.event_type === 'PAY03A_ADMIN_REFUND_RESULT');
  check('F08', 'Refund attributed to the proven administrator, requested before and resulted after the provider call (D-AUDIT-1)',
    requested.length >= 1 && results.some((r) => r.outcome === 'refunded' && r.refund_id === l.payment.pay01a_refund_id)
    && [...requested, ...results].every((a) => a.actor_user_id === accounts.commerce.userId && a.actor_role === 'admin'), audits);
  const adminView = await api('commerce', 'GET', `/api/pay03a/admin/orders/${ORDER}`);
  check('F09', 'Administrator history remains auditable after the refund', adminView.status === 200 && adminView.json?.refundId === l.payment.pay01a_refund_id
    && adminView.json?.paymentReference === purchase.paymentReference, { status: adminView.status, paymentStatus: adminView.json?.paymentStatus, entitlement: adminView.json?.entitlementStatus });
}

const failed = checks.filter((c) => !c.pass).map((c) => c.id);
writeFileSync(`${EVIDENCE_DIR}/stage6-${PHASE}.json`, JSON.stringify({ recorded_at: new Date().toISOString(), runtime_commit: health.build?.commit_sha,
  phase: PHASE, order: ORDER, passed: checks.length - failed.length, total: checks.length, failed, checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} Stage 6 (${PHASE}) checks passed at ${health.build?.commit_sha}`);
if (failed.length) process.exitCode = 1;
