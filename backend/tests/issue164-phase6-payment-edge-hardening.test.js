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

test('Phase 6: durable sandbox adapter is RPC-backed and contains no process-local intent map', () => {
  const durable = source('services/diaspora/safetrade/durableSandboxPaymentProvider.js');
  assert.match(durable, /issue164_sandbox_payment_action_atomic/);
  assert.match(durable, /class DurableSandboxPaymentProvider extends PaymentProvider/);
  assert.equal(/new Map\(|_intents|_idem/.test(durable), false);

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

test('Phase 6: settlement is claimed before provider release and refund cannot race a claimed payout', () => {
  const service = source('services/transaction/marketplacePaymentService.js');
  const release = blockBetween(
    service,
    'export async function releaseMarketplacePayment',
    '/** Provider-backed refund.',
  );
  const claimIndex = release.indexOf("client.rpc('issue164_begin_settlement_atomic'");
  const releaseIndex = release.indexOf('provider.release({');
  assert.ok(claimIndex >= 0, 'settlement claim RPC missing');
  assert.ok(releaseIndex > claimIndex, 'provider release must happen after durable settlement claim');
  assert.match(release, /settlement_operation_key/);
  assert.match(release, /settlement_payment_intent_id/);

  const refund = blockBetween(
    service,
    'export async function refundMarketplacePayment',
    'export default',
  );
  assert.match(refund, /session\.settlement_operation_key/);
  assert.match(refund, /Settlement is already claimed/);
});

test('Phase 6: migration 1260 keeps synthetic provider ledgers private and serializes settlement', () => {
  const migration = source('../database/migrations/20260819126000_issue164_phase6_payment_operation_hardening.sql');
  for (const name of [
    'safetrade_sandbox_payment_intents',
    'safetrade_sandbox_payment_operations',
    'issue164_sandbox_payment_action_atomic',
    'issue164_begin_settlement_atomic',
    'issue164_settlement_claim_guard',
  ]) assert.match(migration, new RegExp(name));
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.safetrade_sandbox_payment_intents FROM anon,authenticated/);
  assert.match(migration, /settlement operation already claimed; provider reconciliation required/);
  assert.match(migration, /payment release lacks attributable settlement operation claim/);
});

test('Phase 6 mutation M21 — process-local sandbox cannot become persisted Marketplace provider authority again', () => {
  const clean = source('services/transaction/marketplacePaymentProviderSelector.js');
  const safe = (text) => /return new DurableSandboxPaymentProvider\(\{ client \}\)/.test(text)
    && /isMarketplaceSandboxRuntimeAllowed/.test(text);
  assert.equal(safe(clean), true);
  const mutant = clean.replace(
    'return new DurableSandboxPaymentProvider({ client });',
    'return selected;',
  );
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
  const releaseBlock = (text) => blockBetween(
    text,
    'export async function releaseMarketplacePayment',
    '/** Provider-backed refund.',
  );
  const safe = (text) => {
    const block = releaseBlock(text);
    const claim = block.indexOf("client.rpc('issue164_begin_settlement_atomic'");
    const release = block.indexOf('provider.release({');
    return claim >= 0 && release > claim;
  };
  assert.equal(safe(clean), true);
  const mutant = clean.replace(
    "const { data: claimed, error: claimError } = await client.rpc('issue164_begin_settlement_atomic', {",
    "const { data: claimed, error: claimError } = { data: session, error: null };\n  void {",
  );
  assert.notEqual(mutant, clean, 'M23 mutation did not match');
  assert.equal(safe(mutant), false, 'M23 mutant survived: provider release was no longer serialized by DB claim');
});
