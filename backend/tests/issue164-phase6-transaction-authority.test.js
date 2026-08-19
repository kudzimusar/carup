import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const tx = await import('../services/transaction/marketplaceTransactionAuthority.js');
const escrow = await import('../services/escrow/escrowTrustService.js');

const LISTING = {
  vin: 'PHASE6VIN0000001',
  owner_id: 'historical-owner-not-seller',
  current_seller_id: 'seller-current',
  current_seller_type: 'private',
  current_seller_type_source: 'seller',
  publication_status: 'published',
  status: 'Available',
  price: 12500,
  currency: 'USD',
  currency_source: 'seller',
  updated_at: '2026-08-19T00:00:00.000Z',
};
const INQUIRY = {
  id: '11111111-1111-4111-8111-111111111111',
  listing_id: LISTING.vin,
  buyer_id: 'buyer-1',
  seller_id: 'seller-current',
  inquiry_type: 'vehicle_purchase_interest',
  status: 'new',
  risk_status: 'clear',
};

test('Phase 6: current_seller_id is the only Marketplace counterparty authority', () => {
  assert.equal(tx.resolveMarketplaceSellerId(LISTING), 'seller-current');
  assert.equal(tx.resolveMarketplaceSellerId({ ...LISTING, current_seller_id: null }), null);
  assert.equal(
    tx.resolveMarketplaceSellerId({ current_seller_id: null, owner_id: 'owner-must-not-fallback' }),
    null,
  );
});

test('Phase 6: transaction amount/currency require recorded server terms plus provenance', () => {
  assert.deepEqual(tx.resolveMarketplaceListingTerms(LISTING), {
    amount: 12500,
    currency: 'USD',
    currencySource: 'seller',
  });
  assert.throws(
    () => tx.resolveMarketplaceListingTerms({ ...LISTING, price: 0 }),
    /server-authoritative transaction amount/,
  );
  assert.throws(
    () => tx.resolveMarketplaceListingTerms({ ...LISTING, currency_source: null }),
    /provenance-backed transaction currency/,
  );
});

test('Phase 6: only the current clear purchase inquiry binds buyer seller listing', () => {
  assert.equal(
    tx.isCurrentPurchaseInquiry(INQUIRY, {
      vin: LISTING.vin,
      buyerId: 'buyer-1',
      sellerId: 'seller-current',
    }),
    true,
  );
  assert.equal(
    tx.isCurrentPurchaseInquiry({ ...INQUIRY, risk_status: 'watch' }, {
      vin: LISTING.vin,
      buyerId: 'buyer-1',
      sellerId: 'seller-current',
    }),
    false,
  );
  assert.equal(
    tx.isCurrentPurchaseInquiry({ ...INQUIRY, seller_id: 'old-seller' }, {
      vin: LISTING.vin,
      buyerId: 'buyer-1',
      sellerId: 'seller-current',
    }),
    false,
  );
});

test('Phase 6: listing snapshot changes when mutable transaction truth changes', () => {
  const terms = tx.resolveMarketplaceListingTerms(LISTING);
  const a = tx.buildMarketplaceListingSnapshot(LISTING, 'seller-current', terms);
  assert.notEqual(
    a,
    tx.buildMarketplaceListingSnapshot(
      { ...LISTING, price: 13000 },
      'seller-current',
      { ...terms, amount: 13000 },
    ),
  );
  assert.notEqual(a, tx.buildMarketplaceListingSnapshot(LISTING, 'other-seller', terms));
  assert.notEqual(
    a,
    tx.buildMarketplaceListingSnapshot(
      { ...LISTING, publication_status: 'draft' },
      'seller-current',
      terms,
    ),
  );
});

test('Phase 6: transaction idempotency is stable across gate re-evaluation but truth-sensitive', () => {
  const base = {
    vin: LISTING.vin,
    buyerId: 'buyer-1',
    sellerId: 'seller-current',
    inquiryId: INQUIRY.id,
    listingSnapshotHash: 'snap-1',
  };
  const a = tx.buildCanonicalTransactionKey(base);
  assert.equal(a, tx.buildCanonicalTransactionKey({ ...base, gateContext: { identity_status: 'complete' } }));
  assert.notEqual(a, tx.buildCanonicalTransactionKey({
    ...base,
    inquiryId: '22222222-2222-4222-8222-222222222222',
  }));
  assert.notEqual(a, tx.buildCanonicalTransactionKey({ ...base, listingSnapshotHash: 'snap-2' }));
});

test('Phase 6: missing gate facts stay unknown and fail closed', () => {
  const unknown = tx.buildMarketplaceEscrowGateContext({
    dimensions: {
      identity: { status: 'complete' },
      publication_eligibility: { status: 'publishable' },
      fraud_risk: { status: 'clear' },
      evidence_completeness: { status: 'complete' },
    },
  });
  assert.equal(unknown.seller_suspended, null);
  assert.equal(unknown.participant_authorized, null);
  assert.equal(unknown.listing_snapshot_changed, null);
  const verdict = escrow.evaluateEscrowGates(unknown);
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reasons.includes('seller_status_unknown'));
  assert.ok(verdict.reasons.includes('unauthorized_participant'));
  assert.ok(verdict.reasons.includes('listing_snapshot_status_unknown'));
});

test('Phase 6: fully resolved Trust + transaction facts can pass the escrow gate', () => {
  const gate = tx.buildMarketplaceEscrowGateContext({
    dimensions: {
      identity: { status: 'complete' },
      publication_eligibility: { status: 'publishable' },
      fraud_risk: { status: 'clear' },
      evidence_completeness: { status: 'complete' },
    },
  }, {
    sellerSuspended: false,
    participantAuthorized: true,
    listingSnapshotChanged: false,
  });
  assert.deepEqual(gate, {
    identity_status: 'complete',
    publication_status: 'publishable',
    fraud_block: false,
    seller_suspended: false,
    participant_authorized: true,
    required_documents_present: true,
    listing_snapshot_changed: false,
  });
  assert.deepEqual(escrow.evaluateEscrowGates(gate), { allowed: true, reasons: [] });
});

test('Phase 6: public transaction projection omits participant/provider internals', () => {
  const projected = tx.toPublicMarketplaceEscrowSession({
    id: 'tx-1',
    vin: LISTING.vin,
    status: 'eligible',
    buyer_id: 'private-buyer',
    seller_id: 'private-seller',
    listing_amount: 12500,
    listing_currency: 'USD',
    payment_state: 'not_started',
    payment_provider: 'private-provider-id',
    payment_intent_id: 'private-provider-intent',
    gate_reasons: [],
    created_at: 'now',
    updated_at: 'now',
  });
  assert.equal(projected.transaction_intent_id, 'tx-1');
  assert.equal(projected.payment_state, 'not_started');
  for (const key of ['buyer_id', 'seller_id', 'payment_provider', 'payment_intent_id']) {
    assert.equal(key in projected, false, `public transaction projection leaked ${key}`);
  }
});

test('Phase 6: escrow-create route accepts no client transaction truth or idempotency authority', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.post('/api/vehicles/:vin/escrow'");
  const b = source.indexOf("router.get('/api/vehicles/:vin/escrow'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  for (const forbidden of [
    'req.body?.buyer',
    'req.body?.seller',
    'req.body?.participant_authorized',
    'req.body?.required_documents_present',
    'req.body?.listing_snapshot_hash',
    "req.headers['idempotency-key']",
  ]) assert.equal(block.includes(forbidden), false, `request route must not accept ${forbidden}`);
  assert.match(block, /requestMarketplaceEscrow/);
});

test('Phase 6: legacy reserve URL terminates in canonical router without reading duration/body', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.post('/api/vehicles/:vin/reserve'");
  const b = source.indexOf("router.post('/api/vehicles/:vin/escrow'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(block, /reserveVehicle\(req\.params\.vin, actorFrom\(req\)\.id\)/);
  assert.equal(/req\.body/.test(block), false);
  assert.equal(/duration/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

test('Phase 6: direct generic status transition is disabled; named actions own state requests', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.patch('/api/escrow/:id/transition'");
  const b = source.indexOf("router.post('/api/escrow/webhook'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(block, /DIRECT_TRANSACTION_STATE_WRITE_DISABLED/);
  assert.equal(block.includes('req.body?.to_status'), false);
  for (const route of ['/cancel', '/dispute', '/inspection/start', '/release/approve']) {
    assert.ok(source.includes(route), `missing governed action route ${route}`);
  }
});

test('Phase 6: SafePay compatibility adapter ignores browser seller/amount/currency authority', () => {
  const source = fs.readFileSync(new URL('../routes/escrowTrustRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.post('/api/safepay/create'");
  const b = source.indexOf("router.post('/api/safepay/:id/update'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(block, /requestMarketplaceEscrow\(req\.body\?\.vin/);
  assert.equal(/req\.body\?\.(sellerId|seller_id|amount|currency)/.test(block), false);
  assert.match(block, /createMarketplacePaymentIntent/);
});

test('Phase 6: canonical routers are mounted before historical inline compatibility handlers', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const escrowMount = server.indexOf('app.use(escrowTrustRouter)');
  const oldReserve = server.indexOf("app.post('/api/vehicles/:vin/reserve'");
  const oldSafePay = server.indexOf("app.post('/api/safepay/create'");
  const financeMount = server.indexOf('app.use(financeRouter)');
  const oldFinance = server.indexOf("app.post('/api/finance/pre-approve'");
  assert.ok(escrowMount >= 0 && oldReserve > escrowMount && oldSafePay > escrowMount);
  assert.ok(financeMount >= 0 && oldFinance > financeMount);
});

test('Phase 6: finance compatibility router derives applicant from authenticated context, never customerId', () => {
  const source = fs.readFileSync(new URL('../routes/financeRoutes.js', import.meta.url), 'utf8');
  const a = source.indexOf("router.post('/api/finance/pre-approve'");
  const b = source.indexOf("router.get('/api/finance/applications'", a);
  const block = source.slice(a, b);
  assert.ok(a >= 0 && b > a);
  assert.match(block, /req\.userContext\?\.id/);
  assert.equal(/req\.body\?\.customerId/.test(block), false);
  assert.match(block, /submitFinancingApplication/);
});
