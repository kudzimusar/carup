import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const selector = await import('../services/transaction/marketplacePaymentProviderSelector.js');
const { DurableSandboxPaymentProvider } = await import('../services/diaspora/safetrade/durableSandboxPaymentProvider.js');

function source(relative) {
  return fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
}

function blockBetween(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing block ${start}`);
  return text.slice(a, b);
}

test('Phase 6: Marketplace selects a fresh durable sandbox adapter per request and fails closed in production', () => {
  const client = { rpc: async () => ({ data: null, error: null }) };
  const first = selector.selectMarketplacePaymentProvider({ client, env: { NODE_ENV: 'test' } });
  const second = selector.selectMarketplacePaymentProvider({ client, env: { VERCEL_ENV: 'preview' } });
  assert.ok(first instanceof DurableSandboxPaymentProvider);
  assert.ok(second instanceof DurableSandboxPaymentProvider);
  assert.notEqual(first, second, 'Marketplace must not depend on a process-shared sandbox instance');
  assert.equal(first.client, client);
  assert.equal(second.client, client);

  assert.equal(selector.isMarketplaceSandboxRuntimeAllowed({ NODE_ENV: 'development' }), true);
  assert.equal(selector.isMarketplaceSandboxRuntimeAllowed({ VERCEL_ENV: 'preview' }), true);
  assert.equal(selector.isMarketplaceSandboxRuntimeAllowed({ CARUP_ENV: 'staging' }), true);
  assert.equal(selector.isMarketplaceSandboxRuntimeAllowed({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), false);
  assert.throws(
    () => selector.selectMarketplacePaymentProvider({
      client,
      env: { NODE_ENV: 'production', VERCEL_ENV: 'production', CARUP_ENV: 'production' },
    }),
    /sandbox payments are available only in test\/development\/staging runtimes/,
  );
});

test('Phase 6: durable sandbox adapter is RPC-backed and contains no process-local intent/idempotency maps', () => {
  const durable = source('services/diaspora/safetrade/durableSandboxPaymentProvider.js');
  assert.match(durable, /issue164_sandbox_payment_action_atomic/);
  assert.match(durable, /class DurableSandboxPaymentProvider extends PaymentProvider/);
  assert.equal(/new Map\(|this\._intents|this\._idem/.test(durable), false);

  const cancellation = source('services/transaction/marketplacePaymentCancellationService.js');
  assert.match(cancellation, /selectMarketplacePaymentProvider/);
  assert.equal(/\bselectPaymentProvider\b/.test(cancellation), false);
});

test('Phase 6: shipped router exposes a buyer-owned sandbox capture action only behind non-production runtime guard', () => {
  const routes = source('routes/escrowTrustRoutes.js');
  const block = blockBetween(
    routes,
    "router.post('/api/escrow/:id/sandbox/capture'",
    "router.post('/api/escrow/:id/payment/reconcile'",
  );
  assert.match(block, /isMarketplaceSandboxRuntimeAllowed\(process\.env\)/);
  assert.match(block, /SANDBOX_UAT_ACTION_UNAVAILABLE/);
  assert.match(block, /captureMarketplaceSandboxDeposit\(req\.params\.id, \{ actor \}\)/);
  assert.match(block, /current\.buyer_id !== actor\.id/);
  assert.equal(/req\.body/.test(block), false, 'sandbox action must not accept provider state from browser payload');
});

test('Phase 6: sandbox capture rechecks canonical gates and reservation lineage before provider mutation', () => {
  const service = source('services/transaction/marketplacePaymentService.js');
  const capture = blockBetween(
    service,
    'export async function captureMarketplaceSandboxDeposit',
    'export async function releaseMarketplacePayment',
  );
  const helperStart = service.indexOf('async function assertFreshSandboxCaptureAuthority');
  const helperEnd = service.indexOf('export async function captureMarketplaceSandboxDeposit', helperStart);
  const helper = service.slice(helperStart, helperEnd);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.match(helper, /recomputeMarketplaceEscrowGateContext/);
  assert.match(helper, /evaluateEscrowGates/);
  assert.match(helper, /loadActiveReservation/);
  assert.match(helper, /session\.buyer_id !== id/);
  assert.ok(capture.indexOf('assertFreshSandboxCaptureAuthority') < capture.indexOf('provider.authorizeHold({'));
});

test('Phase 6: release and refund are both DB-claimed before provider money operations', () => {
  const service = source('services/transaction/marketplacePaymentService.js');
  const release = blockBetween(
    service,
    'export async function releaseMarketplacePayment',
    '/**\n * Provider-backed refund.',
  );
  const releaseClaim = release.indexOf("client.rpc('issue164_begin_settlement_atomic'");
  const providerRelease = release.indexOf('provider.release({');
  assert.ok(releaseClaim >= 0 && providerRelease > releaseClaim, 'provider release must follow durable settlement claim');

  const refund = blockBetween(service, 'export async function refundMarketplacePayment', 'export default');
  const refundClaim = refund.indexOf("client.rpc('issue164_begin_refund_atomic'");
  const providerRefund = refund.indexOf('provider.refund({');
  assert.ok(refundClaim >= 0 && providerRefund > refundClaim, 'provider refund must follow durable refund claim');
  assert.match(refund, /refund_operation_key/);
  assert.match(refund, /refund_payment_intent_id/);
});

test('Phase 6: migrations 1260/1270 keep provider ledgers private and serialize payment operations', () => {
  const m1260 = source('../database/migrations/20260819126000_issue164_phase6_payment_operation_hardening.sql');
  const m1270 = source('../database/migrations/20260819127000_issue164_phase6_payment_race_recovery.sql');
  for (const name of [
    'safetrade_sandbox_payment_intents',
    'safetrade_sandbox_payment_operations',
    'issue164_sandbox_payment_action_atomic',
    'issue164_begin_settlement_atomic',
    'issue164_settlement_claim_guard',
  ]) assert.match(m1260, new RegExp(name));
  assert.match(m1260, /ENABLE ROW LEVEL SECURITY/);
  assert.match(m1260, /REVOKE ALL ON TABLE public\.safetrade_sandbox_payment_intents FROM anon,authenticated/);
  assert.match(m1260, /payment release lacks attributable settlement operation claim/);

  assert.match(m1270, /LOCK TABLE public\.safetrade_sandbox_payment_operations IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(m1270, /different action/);
  assert.match(m1270, /different intent/);
  assert.match(m1270, /issue164_begin_refund_atomic/);
  assert.match(m1270, /settlement and refund operation claims are mutually exclusive/);
  assert.match(m1270, /settlement operation claim is immutable/);
  assert.match(m1270, /refund operation claim is immutable/);
});

test('Phase 6 mutation M21 — process-local sandbox cannot become persisted Marketplace provider authority again', () => {
  const clean = source('services/transaction/marketplacePaymentProviderSelector.js');
  const safe = (text) => /return new DurableSandboxPaymentProvider\(\{ client \}\)/.test(text)
    && /isMarketplaceSandboxRuntimeAllowed/.test(text);
  assert.equal(safe(clean), true);
  const mutant = clean.replace('return new DurableSandboxPaymentProvider({ client });', 'return selected;');
  assert.notEqual(mutant, clean, 'M21 mutation did not match');
  assert.equal(safe(mutant), false, 'M21 mutant survived: process-local sandbox selection was not detected');
});

test('Phase 6 mutation M22 — sandbox intent must have a governed HTTP advancement path', () => {
  const clean = source('routes/escrowTrustRoutes.js');
  const route = (text) => blockBetween(
    text,
    "router.post('/api/escrow/:id/sandbox/capture'",
    "router.post('/api/escrow/:id/payment/reconcile'",
  );
  const safe = (text) => {
    const block = route(text);
    return /isMarketplaceSandboxRuntimeAllowed\(process\.env\)/.test(block)
      && /captureMarketplaceSandboxDeposit\(req\.params\.id, \{ actor \}\)/.test(block)
      && /current\.buyer_id !== actor\.id/.test(block);
  };
  assert.equal(safe(clean), true);
  const mutant = clean.replace(
    'return res.json(await captureMarketplaceSandboxDeposit(req.params.id, { actor }));',
    'return res.json({ paymentState: current.payment_state });',
  );
  assert.notEqual(mutant, clean, 'M22 mutation did not match');
  assert.equal(safe(mutant), false, 'M22 mutant survived: non-advancing sandbox route was not detected');
});

test('Phase 6 mutation M23 — provider release cannot move ahead of durable settlement serialization', () => {
  const clean = source('services/transaction/marketplacePaymentService.js');
  const block = blockBetween(clean, 'export async function releaseMarketplacePayment', '/**\n * Provider-backed refund.');
  const safe = (text) => {
    const release = blockBetween(text, 'export async function releaseMarketplacePayment', '/**\n * Provider-backed refund.');
    const claim = release.indexOf("client.rpc('issue164_begin_settlement_atomic'");
    const provider = release.indexOf('provider.release({');
    return claim >= 0 && provider > claim;
  };
  assert.ok(block.length > 0);
  assert.equal(safe(clean), true);
  const mutant = clean.replace("client.rpc('issue164_begin_settlement_atomic'", "client.rpc('issue164_missing_settlement_claim'");
  assert.notEqual(mutant, clean, 'M23 mutation did not match');
  assert.equal(safe(mutant), false, 'M23 mutant survived: release serialization was not detected');
});

test('Phase 6 mutation M24 — sandbox capture cannot bypass fresh transaction gates', () => {
  const clean = source('services/transaction/marketplacePaymentService.js');
  const safe = (text) => {
    const helperStart = text.indexOf('async function assertFreshSandboxCaptureAuthority');
    const helperEnd = text.indexOf('export async function captureMarketplaceSandboxDeposit', helperStart);
    const captureStart = helperEnd;
    const captureEnd = text.indexOf('export async function releaseMarketplacePayment', captureStart);
    const helper = text.slice(helperStart, helperEnd);
    const capture = text.slice(captureStart, captureEnd);
    return helperStart >= 0
      && /recomputeMarketplaceEscrowGateContext/.test(helper)
      && /evaluateEscrowGates/.test(helper)
      && /loadActiveReservation/.test(helper)
      && capture.indexOf('assertFreshSandboxCaptureAuthority') >= 0
      && capture.indexOf('assertFreshSandboxCaptureAuthority') < capture.indexOf('provider.authorizeHold({');
  };
  assert.equal(safe(clean), true);
  const mutant = clean.replace('  await assertFreshSandboxCaptureAuthority(session, actor, client);', '  // M24 bypassed fresh capture authority');
  assert.notEqual(mutant, clean, 'M24 mutation did not match');
  assert.equal(safe(mutant), false, 'M24 mutant survived: capture gate bypass was not detected');
});

test('Phase 6 mutation M25 — provider refund cannot move ahead of durable refund serialization', () => {
  const clean = source('services/transaction/marketplacePaymentService.js');
  const safe = (text) => {
    const refund = blockBetween(text, 'export async function refundMarketplacePayment', 'export default');
    const claim = refund.indexOf("client.rpc('issue164_begin_refund_atomic'");
    const provider = refund.indexOf('provider.refund({');
    return claim >= 0 && provider > claim;
  };
  assert.equal(safe(clean), true);
  const mutant = clean.replace("client.rpc('issue164_begin_refund_atomic'", "client.rpc('issue164_missing_refund_claim'");
  assert.notEqual(mutant, clean, 'M25 mutation did not match');
  assert.equal(safe(mutant), false, 'M25 mutant survived: refund serialization was not detected');
});

test('Phase 6 mutation M26 — sandbox idempotency cannot regress to key-only, pre-lock replay', () => {
  const clean = source('../database/migrations/20260819127000_issue164_phase6_payment_race_recovery.sql');
  const safe = (sql) => /LOCK TABLE public\.safetrade_sandbox_payment_operations IN SHARE ROW EXCLUSIVE MODE/.test(sql)
    && /v_existing_action IS DISTINCT FROM p_action/.test(sql)
    && /v_existing_intent_id IS DISTINCT FROM p_intent_id/.test(sql);
  assert.equal(safe(clean), true);
  const mutant = clean
    .replace('    LOCK TABLE public.safetrade_sandbox_payment_operations IN SHARE ROW EXCLUSIVE MODE;\n', '')
    .replace('v_existing_action IS DISTINCT FROM p_action', 'false')
    .replace('v_existing_intent_id IS DISTINCT FROM p_intent_id', 'false');
  assert.notEqual(mutant, clean, 'M26 mutation did not match');
  assert.equal(safe(mutant), false, 'M26 mutant survived: key-only/non-serialized replay was not detected');
});

test('Phase 6 mutation M27 — terminal operation-claim provenance cannot become mutable', () => {
  const clean = source('../database/migrations/20260819127000_issue164_phase6_payment_race_recovery.sql');
  const safe = (sql) => /IF OLD\.settlement_operation_key IS NOT NULL THEN/.test(sql)
    && /settlement operation claim is immutable/.test(sql)
    && /IF OLD\.refund_operation_key IS NOT NULL THEN/.test(sql)
    && /refund operation claim is immutable/.test(sql);
  assert.equal(safe(clean), true);
  const mutant = clean
    .replace('IF OLD.settlement_operation_key IS NOT NULL THEN', "IF OLD.status='release_approved' AND OLD.settlement_operation_key IS NOT NULL THEN")
    .replace('IF OLD.refund_operation_key IS NOT NULL THEN', "IF OLD.status<>'refunded' AND OLD.refund_operation_key IS NOT NULL THEN");
  assert.notEqual(mutant, clean, 'M27 mutation did not match');
  assert.equal(safe(mutant), false, 'M27 mutant survived: terminal claim provenance mutability was not detected');
});
