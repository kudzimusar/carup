/**
 * CARUP-PAY-05-LR01 — every PAY-02 product has an explicit Zimbabwe-collection disposition, derived from who legally owns
 * the money. Only the garage's own invoice money is collectable (at Level 1); CarUp first-party, custody and other parties'
 * money is blocked with a named next owner; nothing about garage money touches CarUp Japan's Stripe. No database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
const { pay05ProductCoverage, PAY05_DISPOSITIONS } = await import('../services/payment/pay05ProductCoverage.js');
const { PAY02_CATALOGUE } = await import('../services/payment/pay02CatalogueDefinitions.js');

const coverage = pay05ProductCoverage();
const by = (d) => coverage.filter((c) => c.disposition === d).map((c) => c.productCode).sort();

test('all 66 PAY-02 products are covered exactly once, each with a known disposition and a next owner', () => {
  assert.equal(coverage.length, PAY02_CATALOGUE.length);
  assert.equal(new Set(coverage.map((c) => c.productCode)).size, PAY02_CATALOGUE.length);
  for (const c of coverage) {
    assert.ok(PAY05_DISPOSITIONS[c.disposition], `${c.productCode}: ${c.disposition}`);
    assert.ok(c.next && c.next.length > 3, `${c.productCode} names its next owner`);
  }
});

test('only the garage’s own invoice money is collectable, and only what legally belongs to the garage', () => {
  assert.deepEqual(by('IMPLEMENTED_LEVEL1'), ['gar.invoice.customer_payment']);
  assert.deepEqual(by('IMPLEMENTED_AS_INVOICE_LINE'), ['gar.work_order.diagnostic_fee']);
  for (const c of coverage.filter((x) => x.disposition.startsWith('IMPLEMENTED'))) {
    assert.equal(c.fundsOwner, 'garage_business_tenant');
    assert.equal(c.jurisdiction, 'ZW');
    assert.ok(c.currencies.every((x) => ['USD', 'ZWG'].includes(x)), 'ISO codes only; never ZIG');
  }
});

test('the products PAY-02 assigned to PAY-05 are all honestly blocked, each for its legal reason', () => {
  const pay05Owned = coverage.filter((c) => c.pay02Owner === 'PAY-05');
  assert.deepEqual(pay05Owned.map((c) => c.productCode).sort(),
    ['mkt.auction.participation_deposit', 'mkt.delivery.local_transport', 'mkt.inspection.verification_service', 'mkt.reservation.deposit', 'mkt.sourcing.concierge_fee']);
  const disposition = Object.fromEntries(pay05Owned.map((c) => [c.productCode, c.disposition]));
  assert.equal(disposition['mkt.sourcing.concierge_fee'], 'BLOCKED_FIRST_PARTY_NO_ZW_MERCHANT');
  assert.equal(disposition['mkt.inspection.verification_service'], 'BLOCKED_FIRST_PARTY_NO_ZW_MERCHANT');
  assert.equal(disposition['mkt.reservation.deposit'], 'BLOCKED_CUSTODY');
  assert.equal(disposition['mkt.auction.participation_deposit'], 'BLOCKED_CUSTODY');
  assert.equal(disposition['mkt.delivery.local_transport'], 'BLOCKED_THIRD_PARTY_LATER_PACKAGE');
});

test('insurers, lenders, government, freight and sellers keep their own money; corporate flows are never checkout', () => {
  for (const c of coverage.filter((x) => ['licensed_bank_or_lender', 'licensed_insurer_provider', 'statutory_customs_authority_zimra',
    'shipping_line_or_freight_forwarder', 'inland_transport_carrier'].includes(x.fundsOwner))) {
    assert.equal(c.disposition, 'BLOCKED_THIRD_PARTY_LATER_PACKAGE', c.productCode);
    assert.match(c.next, /^PAY-0[678]:/, c.productCode);
  }
  assert.ok(by('NOT_CUSTOMER_CHECKOUT').length >= 9);
  assert.ok(coverage.filter((c) => c.commercialCategory === 'category_c_corporate_treasury').every((c) => c.disposition === 'NOT_CUSTOMER_CHECKOUT'));
});

test('no garage money is ever eligible for CarUp Japan’s Stripe account', () => {
  for (const p of PAY02_CATALOGUE.filter((x) => x.fundsOwner === 'garage_business_tenant')) {
    assert.ok(!p.eligibleProviders.includes('stripe_carup_japan_sandbox'), p.productCode);
  }
  const invoice = PAY02_CATALOGUE.find((x) => x.productCode === 'gar.invoice.customer_payment');
  assert.ok(invoice.prohibitedProviders.includes('stripe_carup_japan_sandbox'));
});
