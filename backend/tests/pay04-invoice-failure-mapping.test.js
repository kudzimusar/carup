/**
 * CARUP-PAY-04-LR01 — PAY-04's database refusals that surface through Garage OPS07 calls (issue, void, record a
 * payment) reach the garage as plain, specific messages with the right HTTP class, never as a generic 500.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { invoiceFailure } = await import('../services/garageOperations/garageInvoiceService.js');
const { ConflictError, ValidationError } = await import('../utils/errors.js');

test('money in flight blocks a declared payment and a void with a conflict that says why', () => {
  const pay = invoiceFailure({ message: 'PAY04_PAYMENT_EXCEEDS_UNCOMMITTED_BALANCE', details: 'uncommitted=20.00 reserved=100.00' });
  assert.ok(pay instanceof ConflictError);
  assert.match(pay.message, /payment provider/);
  assert.match(pay.message, /20\.00/);
  const inFlight = invoiceFailure({ message: 'PAY04_INVOICE_HAS_PAYMENT_IN_PROGRESS' });
  assert.ok(inFlight instanceof ConflictError);
  assert.match(inFlight.message, /in progress/);
  const confirmed = invoiceFailure({ message: 'PAY04_INVOICE_HAS_PROVIDER_PAYMENTS' });
  assert.ok(confirmed instanceof ConflictError);
  assert.match(confirmed.message, /refund/i);
});

test('an invoice line that is untrue about its source is a validation error naming the rule', () => {
  const cases = {
    PAY04_PART_LINE_REQUIRES_RECORDED_USAGE: /recorded as used/,
    PAY04_LINE_SOURCE_NOT_ON_THIS_JOB: /this job/,
    PAY04_LINE_SOURCE_REVERSED: /reversed/,
    PAY04_LINE_QUANTITY_EXCEEDS_RECORDED_USAGE: /more than was used/,
    PAY04_LINE_SOURCE_CATEGORY_MISMATCH: /category/,
  };
  for (const [token, words] of Object.entries(cases)) {
    const error = invoiceFailure({ message: `ERROR: ${token}` });
    assert.ok(error instanceof ValidationError, token);
    assert.match(error.message, words, token);
  }
});

test('OPS07 tokens keep their existing meaning', () => {
  assert.ok(invoiceFailure({ message: 'GARAGE_OPS07_INVOICE_HAS_PAYMENTS' }) instanceof ConflictError);
  assert.ok(invoiceFailure({ message: 'GARAGE_OPS07_LINE_NOT_PRICED' }) instanceof ValidationError);
});

test('a part billed on an issued invoice cannot be reversed: the garage is told to void the invoice first', async () => {
  const { stockFailure } = await import('../services/garageOperations/garageStockService.js');
  const refused = stockFailure({ message: 'PAY04_PART_USAGE_INVOICED' }, 'Could not reverse the usage');
  assert.ok(refused instanceof ConflictError, `got ${refused?.constructor?.name}`);
  assert.match(refused.message, /issued invoice/);
  assert.match(refused.message, /[Vv]oid the invoice/);
});
