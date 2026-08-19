import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { cancelMarketplacePayment } = await import('../services/transaction/marketplacePaymentCancellationService.js');

function fakeClient(seed) {
  const state = { session: { ...seed }, reconciliations: [] };
  return {
    state,
    from(table) {
      if (table === 'escrow_trust_sessions') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { ...state.session }, error: null }; },
        };
      }
      if (table === 'escrow_trust_events') {
        return {
          select() { return this; },
          eq() { return this; },
          async order() { return { data: [], error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      if (name !== 'issue164_record_payment_state_atomic') {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      state.reconciliations.push({ ...args });
      state.session = {
        ...state.session,
        status: args.p_normalized_status === 'cancelled' ? 'cancelled' : state.session.status,
        payment_state: args.p_normalized_status,
      };
      return { data: { ...state.session }, error: null };
    },
  };
}

function fakeProvider() {
  let status = 'authorized';
  const calls = [];
  return {
    name: 'sandbox',
    calls,
    async cancel(input) {
      calls.push({ op: 'cancel', ...input });
      status = 'cancelled';
      return { provider: 'sandbox', intentId: input.intentId, status, live: false };
    },
    async retrieveStatus(input) {
      calls.push({ op: 'retrieveStatus', ...input });
      return { provider: 'sandbox', intentId: input.intentId, status, live: false };
    },
  };
}

test('Phase 6: provider-linked cancellation asks provider first then records provider-confirmed cancelled state', async () => {
  const client = fakeClient({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    vin: 'VIN-CANCEL-001',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    status: 'initiated',
    payment_provider: 'sandbox',
    payment_intent_id: 'sbx_pi_cancel_1',
    payment_idempotency_key: 'payment-idempotency',
  });
  const provider = fakeProvider();

  const result = await cancelMarketplacePayment(client.state.session.id, {
    actor: { id: 'buyer-1', role: 'buyer' },
    client,
    paymentProvider: provider,
  });

  assert.deepEqual(provider.calls.map((call) => call.op), ['cancel', 'retrieveStatus']);
  assert.equal(provider.calls[0].intentId, 'sbx_pi_cancel_1');
  assert.equal(provider.calls[0].idempotencyKey, 'payment-idempotency:cancel');
  assert.equal(client.state.reconciliations.length, 1);
  assert.equal(client.state.reconciliations[0].p_normalized_status, 'cancelled');
  assert.equal(client.state.reconciliations[0].p_provider, 'sandbox');
  assert.equal(client.state.reconciliations[0].p_intent_id, 'sbx_pi_cancel_1');
  assert.equal(result.paymentState, 'cancelled');
  assert.equal(result.live, false);
});

test('Phase 6: cancellation service refuses a provider-less or post-capture transaction', async () => {
  const provider = fakeProvider();
  const noProvider = fakeClient({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    status: 'eligible',
    payment_provider: null,
    payment_intent_id: null,
    payment_idempotency_key: null,
  });
  await assert.rejects(
    () => cancelMarketplacePayment(noProvider.state.session.id, {
      actor: { id: 'buyer-1', role: 'buyer' }, client: noProvider, paymentProvider: provider,
    }),
    /no linked provider intent/i,
  );

  const captured = fakeClient({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    status: 'funds_held',
    payment_provider: 'sandbox',
    payment_intent_id: 'sbx_pi_held',
    payment_idempotency_key: 'held-key',
  });
  await assert.rejects(
    () => cancelMarketplacePayment(captured.state.session.id, {
      actor: { id: 'buyer-1', role: 'buyer' }, client: captured, paymentProvider: provider,
    }),
    /cannot be cancelled from funds_held/i,
  );
});

test('Phase 6: cancel route branches on server-read payment intent and accepts no client state/provider truth', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.post('/api/escrow/:id/cancel'");
  const b = source.indexOf("router.post('/api/escrow/:id/dispute'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(block, /loadAuthorizedSession/);
  assert.match(block, /current\.payment_intent_id/);
  assert.match(block, /cancelMarketplacePayment/);
  assert.match(block, /performParticipantAction\(req, res, next, 'cancelled'\)/);
  assert.equal(/req\.body\?.*(to_status|provider|payment_intent|intentId)/.test(block), false);
});
