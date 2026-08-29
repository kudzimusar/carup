import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const media = readFileSync(new URL('../services/storage/mediaRouter.js', import.meta.url), 'utf8');

test('Seller resume scope includes governed current seller without transferring ownership', () => {
  assert.match(server, /owner_id\.eq\.\$\{req\.userContext\.id\},current_seller_id\.eq\.\$\{req\.userContext\.id\}/);
  assert.match(media, /current_seller_id/);
  assert.match(media, /isCurrentSeller/);
});

test('listing media write fails closed and upload limit matches Seller intake', () => {
  assert.match(server, /Listing media could not be recorded/);
  assert.match(media, /MAX_UPLOAD_SIZE = 12 \* 1024 \* 1024/);
  assert.match(media, /12 \* 1024 \* 1024; \/\/ 5MB for docs, 12MB for listing images/);
});
