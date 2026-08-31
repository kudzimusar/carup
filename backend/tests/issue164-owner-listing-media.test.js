import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { toListingMediaBlock, MEDIA_BLOCK_STATES } from '../utils/vehicleMediaProjection.js';

/**
 * Issue #164 Phase 8, Run 4 — **D5**: the owner may not know less true media than an anonymous buyer.
 *
 * `/api/vehicles/me` is `select('*')` on `vehicles`, and `vehicles` HAS NO MEDIA COLUMN — the photos
 * live in `listing_images`. Every owner list surface read `vehicle.image_url`, got `undefined`, and
 * rendered the branded "Image unavailable" placeholder. Measured physically on Golden A: the PUBLIC
 * listing endpoint published `listing_media.state = "published"` with five canonical images at the
 * same moment the OWNER of those photographs was told the image was unavailable.
 *
 * These tests hold the two properties that fix depends on: the owner endpoint must ATTACH the block,
 * and a failed read must never be published as "you have no photos".
 */

const SERVER_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../server.js'),
  'utf8',
);

/** Comments quote the identifiers under test, so they are removed before the source is scanned. */
const SERVER_CODE = SERVER_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

test('the owner endpoint attaches the canonical listing-media block', () => {
  const handler = SERVER_CODE.slice(SERVER_CODE.indexOf("app.get('/api/vehicles/me'"));
  const body = handler.slice(0, handler.indexOf('app.get(', 10));

  assert.match(
    body,
    /listing_media:\s*media\.get\(vehicle\.vin\)/,
    'GET /api/vehicles/me must publish a listing_media block per vehicle — without it every owner '
    + 'card falls back to the "Image unavailable" placeholder over real published photographs.',
  );
  assert.match(body, /await ownerListingMedia\(/, 'the block must come from ownerListingMedia');
});

test('the owner projection reuses the public builder rather than restating media semantics', () => {
  assert.match(
    SERVER_CODE,
    /import\s*\{[^}]*toListingMediaBlock[^}]*\}\s*from\s*'\.\/utils\/vehicleMediaProjection\.js'/,
    'the owner path must import the SAME builder the public listing uses; a second implementation '
    + 'is how two surfaces drift into disagreeing about what "published" means.',
  );

  const fn = SERVER_CODE.slice(SERVER_CODE.indexOf('async function ownerListingMedia'));
  const bodyText = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(bodyText, /toListingMediaBlock\(/, 'ownerListingMedia must build through the canonical projection');
  assert.doesNotMatch(
    bodyText,
    /is_primary\s*===\s*true|\.sort\(/,
    'ownerListingMedia must not re-derive primacy or ordering — that belongs to toListingMediaBlock.',
  );
});

test('a FAILED read publishes "not looked", never "none" — the whole point of the null', () => {
  const fn = SERVER_CODE.slice(SERVER_CODE.indexOf('async function ownerListingMedia'));
  const bodyText = fn.slice(0, fn.indexOf('\n}\n') + 2);

  // `rows` must start null and only become an array on a successful read.
  assert.match(bodyText, /let rows = null/, 'rows must default to null (not read)');
  // The read itself moved into `readListingImagesCompat` — the photo_label schema-compat wrapper —
  // so "an array only when the read succeeded" is now that helper's property. Assert it where it
  // actually lives rather than deleting the guard, and pin that the helper is the ONLY thing `rows`
  // is ever assigned from, so the compat path cannot be bypassed by a future inline read.
  assert.match(bodyText, /rows = await readListingImagesCompat\(/,
    'rows must be assigned only from the canonical compat reader');
  const compatFn = SERVER_CODE.slice(SERVER_CODE.indexOf('async function readListingImagesCompat'));
  const compatBody = compatFn.slice(0, compatFn.indexOf('\n}\n') + 2);
  assert.match(compatBody, /if \(!wide\.error\) return wide\.data \|\| \[\]/,
    'rows becomes an array only when the read succeeded');
  assert.match(compatBody, /if \(legacy\.error\) return null/,
    'a failed fallback read answers null, never an empty gallery');
  assert.match(
    bodyText,
    /rows === null \? null : rows\.filter/,
    'a failed read must pass null into toListingMediaBlock so the block is not_loaded, not none',
  );
  assert.doesNotMatch(
    bodyText,
    /catch\s*\{\s*rows = \[\]/,
    'swallowing the error into an empty array would publish "you have no photos" after a failure.',
  );
});

test('the projection itself distinguishes not_loaded from none', () => {
  assert.equal(toListingMediaBlock(null).state, MEDIA_BLOCK_STATES.NOT_LOADED);
  assert.equal(toListingMediaBlock(undefined).state, MEDIA_BLOCK_STATES.NOT_LOADED);
  assert.equal(toListingMediaBlock([]).state, MEDIA_BLOCK_STATES.NONE);
});

test('a real Golden-A shaped gallery survives the owner projection intact', () => {
  const rows = [
    { id: '92980640-0e7f-4326-adb7-2c02faf1e865', vin: 'CARUPGLDNA0000001', image_url: 'https://x.supabase.co/storage/v1/object/public/vehicle-images/CARUPGLDNA0000001/a.png', is_primary: false, display_order: 0 },
    { id: 'e72bb881-2de8-45c5-8c1c-536a953304ab', vin: 'CARUPGLDNA0000001', image_url: 'https://x.supabase.co/storage/v1/object/public/vehicle-images/CARUPGLDNA0000001/b.png', is_primary: true, display_order: 1 },
  ];
  const block = toListingMediaBlock(rows);

  assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED);
  assert.equal(block.items.length, 2);
  assert.equal(block.unpublishable_count, 0);
  // The seller's primary claim is honoured and sorts first, so the owner's card and the public
  // listing choose the SAME photograph.
  assert.equal(block.items[0].is_primary, true);
  assert.match(block.items[0].url, /\/b\.png$/);
});

test('Golden B: a genuinely empty gallery is "none", and states so rather than going silent', () => {
  const block = toListingMediaBlock([]);
  assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
  assert.equal(block.items.length, 0);
  assert.ok(block.empty_statement, 'an empty gallery must carry its own statement');
});
