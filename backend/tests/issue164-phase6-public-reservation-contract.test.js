import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sharedIndex = fs.readFileSync(new URL('../../shared/types/index.ts', import.meta.url), 'utf8');
const sharedMarketplace = fs.readFileSync(new URL('../../shared/types/marketplace.ts', import.meta.url), 'utf8');
const mobileMarketplace = fs.readFileSync(new URL('../../mobile/utils/marketplaceApi.ts', import.meta.url), 'utf8');

const EXPECTED_STATES = ['active', 'expired', 'none', 'unavailable', 'inconsistent'];

function unionMembers(source, typeName) {
  const start = source.indexOf(`export type ${typeName} =`);
  assert.ok(start >= 0, `missing ${typeName}`);
  const end = source.indexOf(';', start);
  assert.ok(end > start, `unterminated ${typeName}`);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function interfaceBody(source, name) {
  const start = source.indexOf(`export interface ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${name}`);
}

test('Phase 6 public reservation state vocabulary is identical in shared and mobile contracts', () => {
  assert.deepEqual(unionMembers(sharedIndex, 'MarketplaceReservationState'), EXPECTED_STATES);
  assert.deepEqual(unionMembers(mobileMarketplace, 'MobileReservationState'), EXPECTED_STATES);
});

test('Phase 6 public reservation envelope is identity/provider free by declaration', () => {
  const shared = interfaceBody(sharedIndex, 'MarketplaceReservationSummary');
  const mobile = interfaceBody(mobileMarketplace, 'MobileReservationSummary');
  for (const body of [shared, mobile]) {
    for (const required of ['state:', 'reserved:', 'reserved_at:', 'expires_at:', 'reason:']) {
      assert.ok(body.includes(required), `missing reservation field ${required}`);
    }
    for (const forbidden of [
      'reservation_id', 'transaction_intent_id', 'buyer_id', 'seller_id',
      'payment_provider', 'payment_intent_id', 'idempotency_key',
    ]) {
      assert.equal(body.includes(forbidden), false, `public reservation contract leaked ${forbidden}`);
    }
  }
});

test('Phase 6 detail requires reservation envelope and transaction readiness declares reservation state', () => {
  const detail = interfaceBody(sharedMarketplace, 'MarketplaceListingDetail');
  const intent = interfaceBody(sharedMarketplace, 'MarketplaceTransactionIntent');
  assert.match(detail, /reservation_summary:\s*MarketplaceReservationSummary/);
  assert.match(intent, /reservation_state:\s*MarketplaceReservationState/);
  assert.match(intent, /reservation_expires_at:\s*string\s*\|\s*null/);
  for (const forbidden of ['buyer_id', 'seller_id', 'payment_provider', 'payment_intent_id']) {
    assert.equal(intent.includes(forbidden), false, `transaction readiness leaked ${forbidden}`);
  }
});

test('Phase 6 base summary keeps reservation overlay optional because pure summary builder does not load it', () => {
  const summary = interfaceBody(sharedIndex, 'MarketplaceListingSummary');
  assert.match(summary, /reservation_summary\?:\s*MarketplaceReservationSummary/);
  assert.match(summary, /status:\s*string\s*\|\s*null/);
});

test('Phase 6 mobile summary also permits unknown lifecycle when reservation authority is unresolved', () => {
  const summary = interfaceBody(mobileMarketplace, 'MobileListingSummary');
  assert.match(summary, /status:\s*string\s*\|\s*null/);
});
