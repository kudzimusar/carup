import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMyVehiclesScope } from '../services/ownership/ownedVehicleAccessService.js';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('../services/storage/mediaRouter.js', import.meta.url), 'utf8');

test('Seller resume scope includes governed current seller without transferring ownership', () => {
  assert.match(server, /applyMyVehiclesScope\(vehicleQuery,\s*req\.userContext\)/);

  const sellerCalls = [];
  const sellerQuery = {
    or(value) { sellerCalls.push(['or', value]); return this; },
    eq(key, value) { sellerCalls.push(['eq', key, value]); return this; },
  };
  applyMyVehiclesScope(sellerQuery, {
    id: 'seller-1',
    authenticationMethod: 'session',
    role: 'owner',
    effectiveRole: 'owner',
    platformRole: 'owner',
  });
  assert.deepEqual(
    sellerCalls,
    [['or', 'owner_id.eq.seller-1,current_seller_id.eq.seller-1']],
    'the Seller workspace may resume through governed current_seller_id without changing legal owner_id',
  );

  const buyerCalls = [];
  const buyerQuery = {
    or(value) { buyerCalls.push(['or', value]); return this; },
    eq(key, value) { buyerCalls.push(['eq', key, value]); return this; },
  };
  applyMyVehiclesScope(buyerQuery, {
    id: 'buyer-1',
    authenticationMethod: 'session',
    role: 'buyer',
    effectiveRole: 'buyer',
    platformRole: 'buyer',
  });
  assert.deepEqual(
    buyerCalls,
    [['eq', 'owner_id', 'buyer-1']],
    'a buyer receives only canonical legal ownership; current_seller_id never becomes buyer ownership',
  );

  assert.match(media, /current_seller_id/);
  assert.match(media, /isCurrentSeller/);
});

test('listing media partial-write truth is explicit and upload limit matches Seller intake', () => {
  assert.match(server, /images_recorded: imagesRecorded/);
  assert.match(server, /images_recorded_count: imagesRecordedCount/);
  assert.match(server, /images_unpublishable_count: imagesUnpublishableCount/);
  assert.match(server, /images_replacement_complete: imagesReplacementComplete/);
  assert.doesNotMatch(server, /throw new Error\('Listing media could not be recorded/);
  assert.match(media, /MAX_UPLOAD_SIZE = 12 \* 1024 \* 1024/);
  assert.match(media, /12 \* 1024 \* 1024; \/\/ 5MB for docs, 12MB for listing images/);
});
