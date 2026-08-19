import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const tx = await import('../services/transaction/marketplaceTransactionAuthority.js');

const LISTING = {
  vin: 'PHASE6VIN0000001',
  owner_id: 'seller-owner',
  current_seller_id: null,
  publication_status: 'published',
  price: 12500,
  currency: 'USD',
  currency_source: 'seller',
  updated_at: '2026-08-19T00:00:00.000Z',
};

test('Phase 6: seller resolution is server-side and deterministic', () => {
  assert.equal(tx.resolveMarketplaceSellerId(LISTING), 'seller-owner');
  assert.equal(tx.resolveMarketplaceSellerId({ ...LISTING, current_seller_id: 'current-seller' }), 'current-seller');
  assert.equal(tx.resolveMarketplaceSellerId({}), null);
});

test('Phase 6: transaction amount and currency require recorded server terms plus provenance', () => {
  assert.deepEqual(tx.resolveMarketplaceListingTerms(LISTING), {
    amount: 12500,
    currency: 'USD',
    currencySource: 'seller',
  });
  assert.throws(() => tx.resolveMarketplaceListingTerms({ ...LISTING, price: 0 }), /server-authoritative transaction amount/);
  assert.throws(() => tx.resolveMarketplaceListingTerms({ ...LISTING, currency_source: null }), /provenance-backed transaction currency/);
});

test('Phase 6: snapshot changes when a money/counterparty fact changes', () => {
  const terms = tx.resolveMarketplaceListingTerms(LISTING);
  const a = tx.buildMarketplaceListingSnapshot(LISTING, 'seller-owner', terms);
  const b = tx.buildMarketplaceListingSnapshot({ ...LISTING, price: 13000 }, 'seller-owner', { ...terms, amount: 13000 });
  const c = tx.buildMarketplaceListingSnapshot(LISTING, 'other-seller', terms);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('Phase 6: Trust dimensions become explicit escrow gates, not browser booleans', () => {
  const gate = tx.buildMarketplaceEscrowGateContext({ dimensions: {
    identity: { status: 'complete' },
    publication_eligibility: { status: 'publishable' },
    fraud_risk: { status: 'clear' },
    dealer_compliance: { status: 'compliant' },
    evidence_completeness: { status: 'complete' },
  } });
  assert.deepEqual(gate, {
    identity_status: 'complete',
    publication_status: 'publishable',
    fraud_block: false,
    seller_suspended: false,
    participant_authorized: true,
    required_documents_present: true,
    listing_snapshot_changed: false,
  });
});

test('Phase 6: public transaction projection never publishes participant/provider internals', () => {
  const publicSession = tx.toPublicMarketplaceEscrowSession({
    id: 'tx-1', vin: LISTING.vin, status: 'eligible', buyer_id: 'private-buyer', seller_id: 'private-seller',
    listing_amount: 12500, listing_currency: 'USD', escrow_id: null, payment_provider: 'private-provider-id',
    gate_reasons: [], created_at: 'now', updated_at: 'now',
  });
  assert.equal(publicSession.transaction_intent_id, 'tx-1');
  assert.equal(publicSession.payment_state, 'not_started');
  assert.equal('buyer_id' in publicSession, false);
  assert.equal('seller_id' in publicSession, false);
  assert.equal('payment_provider' in publicSession, false);
});

test('Phase 6: escrow HTTP route cannot accept buyer/seller/amount/gate truth from req.body', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const postStart = source.indexOf("router.post('/api/vehicles/:vin/escrow'");
  const postEnd = source.indexOf("router.get('/api/vehicles/:vin/escrow'", postStart);
  const postBlock = source.slice(postStart, postEnd);
  assert.ok(postStart >= 0 && postEnd > postStart);
  for (const forbidden of ['buyer_id', 'seller_id', 'participant_authorized', 'required_documents_present', 'listing_snapshot_hash']) {
    assert.equal(postBlock.includes(forbidden), false, `request route must not read ${forbidden} from the client`);
  }
  assert.match(postBlock, /requestMarketplaceEscrow/);
  assert.match(postBlock, /idempotency-key/);
});

test('Phase 6: transition route does not pass client gate_context into the state machine', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const patchStart = source.indexOf("router.patch('/api/escrow/:id/transition'");
  const patchEnd = source.indexOf("router.post('/api/escrow/webhook'", patchStart);
  const patchBlock = source.slice(patchStart, patchEnd);
  assert.ok(patchStart >= 0 && patchEnd > patchStart);
  assert.equal(patchBlock.includes('req.body?.gate_context'), false);
  assert.match(patchBlock, /serverGateContextFor/);
});
