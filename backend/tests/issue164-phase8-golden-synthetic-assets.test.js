/**
 * Issue #164 Phase 8, Cluster C — synthetic Golden fixture assets.
 *
 * These fail on the physically-tested baseline `993c1179`, where the Golden fixture stored URLs on
 * `media.carup-staging.test` / `evidence.carup-staging.test`. `.test` is reserved by RFC 2606, so the
 * rows referenced artifacts that could not exist: the physical UAT saw ERR_NAME_NOT_RESOLVED on all
 * five Golden A photos, and the evidence files were unopenable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  syntheticListingImagePng,
  syntheticEvidenceDocumentPdf,
  listingImageStoragePath,
  evidenceStoragePath,
  LISTING_IMAGE_MIME,
  EVIDENCE_DOCUMENT_MIME,
} from '../services/golden/goldenSyntheticAssets.js';
import {
  GOLDEN_A, GOLDEN_B, GOLDEN_VEHICLES, SYNTHETIC_DOCUMENT_MARKER,
  listingImageFacets, legacyListingImageUrls, legacyEvidenceFileUrl,
} from '../services/golden/goldenVehicleSpecs.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Walk PNG chunks so the tests assert on real structure rather than byte guesses. */
function readPngChunks(buf) {
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + length) });
    off += 12 + length;
  }
  return chunks;
}

function decodePixels(buf) {
  const chunks = readPngChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = width * 3 + 1;
  return {
    width,
    height,
    bitDepth: ihdr[8],
    colourType: ihdr[9],
    pixel: (x, y) => {
      const p = y * stride + 1 + x * 3;
      return [raw[p], raw[p + 1], raw[p + 2]];
    },
  };
}

test('listing images are structurally valid PNGs', () => {
  const png = syntheticListingImagePng(GOLDEN_A.vin, 'exterior-front');
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature');
  const types = readPngChunks(png).map((c) => c.type);
  assert.equal(types[0], 'IHDR');
  assert.equal(types[types.length - 1], 'IEND');
  assert.ok(types.includes('IDAT'));

  const img = decodePixels(png);
  assert.equal(img.bitDepth, 8);
  assert.equal(img.colourType, 2, 'truecolour RGB');
  assert.ok(img.width > 0 && img.height > 0);
});

test('listing images are byte-identical for the same input (idempotent re-bootstrap)', () => {
  const a = syntheticListingImagePng(GOLDEN_A.vin, 'interior');
  const b = syntheticListingImagePng(GOLDEN_A.vin, 'interior');
  assert.ok(a.equals(b), 'same (vin, facet) must produce identical bytes');
});

test('each facet is visibly distinct from the others', () => {
  const seen = new Map();
  for (const facet of listingImageFacets(GOLDEN_A)) {
    const first = decodePixels(syntheticListingImagePng(GOLDEN_A.vin, facet)).pixel(0, 0).join(',');
    assert.ok(!seen.has(first), `facet ${facet} duplicates ${seen.get(first)}`);
    seen.set(first, facet);
  }
});

/**
 * REGRESSION. The palette derived its stripe tone with `h >> 8`. A SIGNED shift on a hash above 2^31
 * yields a negative number, and `negative % 60` is negative in JS, so the stripe collapsed onto the
 * background: `exterior-front` rendered as a near-uniform panel of [74,78,86] against [75,81,89].
 * The image was still a valid PNG, which is exactly why only a pixel-level assertion catches it.
 */
test('stripes have real contrast against the background for every facet and vehicle', () => {
  for (const spec of GOLDEN_VEHICLES) {
    for (const facet of listingImageFacets(spec)) {
      const img = decodePixels(syntheticListingImagePng(spec.vin, facet));
      const tones = new Set();
      for (let x = 0; x < 200; x += 1) tones.add(img.pixel(x, 0).join(','));
      assert.equal(tones.size, 2, `${spec.vin}/${facet} must show exactly two tones`);
      const [t1, t2] = [...tones].map((t) => t.split(',').map(Number));
      const delta = Math.abs(t1[0] - t2[0]);
      assert.ok(delta >= 32, `${spec.vin}/${facet} stripe contrast ${delta} is too low to be visible`);
    }
  }
});

test('listing images carry machine-readable synthetic markers', () => {
  const png = syntheticListingImagePng(GOLDEN_A.vin, 'dashboard');
  const text = readPngChunks(png).filter((c) => c.type === 'tEXt').map((c) => c.data.toString('latin1')).join('\n');
  assert.match(text, new RegExp(SYNTHETIC_DOCUMENT_MARKER.split(/\s+/)[0]));
  assert.match(text, /Not a photograph/);
  assert.match(text, new RegExp(GOLDEN_A.vin));
});

test('evidence documents are structurally valid PDFs carrying the synthetic marker', () => {
  const pdf = syntheticEvidenceDocumentPdf(GOLDEN_B.vin, 'registration_document');
  const asText = pdf.toString('latin1');
  assert.ok(asText.startsWith('%PDF-1.4'), 'PDF header');
  assert.ok(asText.trimEnd().endsWith('%%EOF'), 'PDF trailer');
  assert.match(asText, /\/Type \/Catalog/);
  assert.match(asText, /startxref/);
  assert.ok(asText.includes(SYNTHETIC_DOCUMENT_MARKER.split(/\s+/)[0]));
  assert.ok(asText.includes(GOLDEN_B.vin));
  // It must say on its face that it is not a registry document.
  assert.match(asText, /NOT a registry document/);
});

test('evidence documents are byte-identical for the same input', () => {
  assert.ok(
    syntheticEvidenceDocumentPdf(GOLDEN_A.vin, 'police_clearance')
      .equals(syntheticEvidenceDocumentPdf(GOLDEN_A.vin, 'police_clearance')),
  );
});

test('storage paths are deterministic, VIN-scoped, and free of the reserved .test host', () => {
  for (const spec of GOLDEN_VEHICLES) {
    for (const facet of listingImageFacets(spec)) {
      const p = listingImageStoragePath(spec.vin, facet);
      assert.equal(p, listingImageStoragePath(spec.vin, facet));
      assert.ok(p.startsWith(`${spec.vin.toUpperCase()}/`), 'object path is VIN-scoped');
      assert.doesNotMatch(p, /carup-staging\.test/);
      assert.doesNotMatch(p, /^https?:/, 'a storage path is not a URL');
    }
    for (const ev of spec.evidence) {
      const p = evidenceStoragePath(spec.vin, ev.type);
      assert.ok(p.startsWith(`${spec.vin.toUpperCase()}/`));
      assert.doesNotMatch(p, /carup-staging\.test/);
    }
  }
});

test('mime types match the buckets the canonical contract routes to', () => {
  // vehicle-images allows image/*; ocr-documents allows application/pdf. Both are enforced by the
  // bucket's allowed_mime_types on staging, so a mismatch here fails the upload at runtime.
  assert.equal(LISTING_IMAGE_MIME, 'image/png');
  assert.equal(EVIDENCE_DOCUMENT_MIME, 'application/pdf');
});

/**
 * The legacy helpers still exist so bootstrap can RECOGNISE Phase 7 rows and repair them in place.
 * They must never be mistaken for the current contract, so pin what they are.
 */
test('legacy locators are retained only as unresolvable Phase 7 markers', () => {
  for (const url of legacyListingImageUrls(GOLDEN_A)) {
    assert.match(url, /^https:\/\/media\.carup-staging\.test\//);
  }
  assert.match(legacyEvidenceFileUrl(GOLDEN_A, 'registration_document'),
    /^https:\/\/evidence\.carup-staging\.test\//);
  assert.equal(legacyListingImageUrls(GOLDEN_A).length, GOLDEN_A.listingImageCount);
});
