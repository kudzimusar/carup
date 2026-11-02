/**
 * CARUP-PAY-04-LR01 — the product inventory (directive §4) is derived from the accepted PAY-02 catalogue and invents
 * nothing: no price, no provider access, no CarUp beneficiary for garage money, CarUp Japan Stripe never eligible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pay04ProductInventory, PAY04_PRODUCT_CODES } from '../services/payment/pay04ProductInventory.js';
import { PAY02_CATALOGUE_BY_CODE, PAY02_CATEGORIES } from '../services/payment/pay02CatalogueDefinitions.js';

test('the six PAY-04 products, each answering every §4 question', () => {
  assert.deepEqual(PAY04_PRODUCT_CODES, [
    'gar.invoice.customer_payment', 'gar.appointment.booking_deposit', 'gar.work_order.diagnostic_fee',
    'gar.parts.retail_sale', 'gar.fleet.scheduled_maintenance', 'gar.towing.breakdown_dispatch',
  ]);
  for (const row of pay04ProductInventory()) {
    for (const field of ['owningSubsystem', 'sourceAuthority', 'legalSeller', 'legalBeneficiary', 'payer', 'currencies', 'tariff',
      'providerAuthority', 'refundRules', 'fulfillment', 'pay04Status', 'blocker', 'resolver']) {
      assert.ok(row[field] !== undefined && row[field] !== null && row[field] !== '', `${row.productCode}.${field}`);
    }
  }
});

test('nothing is invented: no price, never CarUp Japan Stripe, garage money is never CarUp money', () => {
  for (const row of pay04ProductInventory()) {
    const source = PAY02_CATALOGUE_BY_CODE[row.productCode];
    assert.equal(source.commercialCategory, PAY02_CATEGORIES.THIRD_PARTY, row.productCode);
    assert.equal(source.approvedAmountMinor, null, `${row.productCode} has no approved price`);
    assert.match(row.tariff, /^none approved/, row.productCode);
    assert.ok(row.providerAuthority.prohibited.includes('stripe_carup_japan_sandbox'), row.productCode);
    assert.ok(!row.providerAuthority.eligible.includes('stripe_carup_japan_sandbox'), row.productCode);
    assert.ok(!/carup/i.test(row.legalBeneficiary) && !/carup/i.test(row.fundsOwner), `${row.productCode} beneficiary is not CarUp`);
    assert.ok(!/paynow/i.test(JSON.stringify(row.providerAuthority.eligible)), `${row.productCode}: no invented Zimbabwe provider access`);
  }
});

test('the statuses say exactly what PAY-04 did and did not do', () => {
  const by = Object.fromEntries(pay04ProductInventory().map((r) => [r.productCode, r]));
  assert.equal(by['gar.invoice.customer_payment'].pay04Status, 'IMPLEMENTED_LEVEL1');
  assert.equal(by['gar.appointment.booking_deposit'].pay04Status, 'BLOCKED_NO_APPROVED_BOOKING_POLICY');
  assert.equal(by['gar.fleet.scheduled_maintenance'].implemented.length, 0);
  assert.equal(by['gar.towing.breakdown_dispatch'].implemented.length, 0);
  assert.match(by['gar.invoice.customer_payment'].blocker, /Level 2/);
  assert.match(by['gar.invoice.customer_payment'].blocker, /Level 3/);
});
