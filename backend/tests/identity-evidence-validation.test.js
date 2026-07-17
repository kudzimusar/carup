/**
 * Phase 7C Workstream C — deterministic evidence validation (fail closed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidenceImages, detectImageType, MIN_IMAGE_BYTES } from '../services/identity/evidenceValidation.js';

// Build a buffer of `size` bytes that starts with the given magic prefix.
function imageBuffer(magic, size = MIN_IMAGE_BYTES + 100, fill = 0x20) {
  const buf = Buffer.alloc(size, fill);
  Buffer.from(magic).copy(buf, 0);
  return buf;
}
const JPEG = () => imageBuffer([0xff, 0xd8, 0xff]);
const PNG = () => imageBuffer([0x89, 0x50, 0x4e, 0x47]);

test('detectImageType recognizes jpeg/png and rejects non-images', () => {
  assert.equal(detectImageType(JPEG()), 'image/jpeg');
  assert.equal(detectImageType(PNG()), 'image/png');
  assert.equal(detectImageType(Buffer.from('this is plain text, not an image')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test('blank / tiny image is invalid (cannot be a document)', () => {
  const r = validateEvidenceImages({ front: Buffer.alloc(10, 0xff) });
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(' '), /too small/);
});

test('non-image payload is invalid', () => {
  const r = validateEvidenceImages({ front: Buffer.alloc(MIN_IMAGE_BYTES + 50, 0x41) }); // 'AAAA...' no magic
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(' '), /not a supported\/decodable image/);
});

test('distinct valid images pass and produce hashes', () => {
  const front = JPEG();
  const back = imageBuffer([0xff, 0xd8, 0xff], MIN_IMAGE_BYTES + 100, 0x21); // different fill -> different hash
  const selfie = PNG();
  const r = validateEvidenceImages({ front, back, selfie });
  assert.equal(r.valid, true);
  assert.equal(r.reasons.length, 0);
  assert.ok(r.hashes.front && r.hashes.back && r.hashes.selfie);
  assert.notEqual(r.hashes.front, r.hashes.back);
});

test('identical front and back is invalid', () => {
  const buf = JPEG();
  const r = validateEvidenceImages({ front: buf, back: Buffer.from(buf) });
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(' '), /Front and back images are identical/);
});

test('selfie identical to the document is invalid', () => {
  const doc = JPEG();
  const r = validateEvidenceImages({ front: doc, selfie: Buffer.from(doc) });
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(' '), /Selfie is identical to the front document/);
});

test('a single valid front image (passport flow) is valid', () => {
  const r = validateEvidenceImages({ front: JPEG() });
  assert.equal(r.valid, true);
});
