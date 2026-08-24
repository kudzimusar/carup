/**
 * Issue #164 — D2: a verified evidence record whose FILE is private must publish as a FACT,
 * never as absence.
 *
 * Physically observed on the paired preview before the fix, VIN CARUPGLDNA0000001, anonymous:
 *
 *   verified_evidence: { state: "none", items: [], unpublishable_count: 4,
 *                        empty_statement: "No verified evidence has been published for this vehicle." }
 *
 * while the database held four rows, every one `verification_status: 'verified'` with a non-null
 * `verified_by`, stored in the private `ocr-documents` bucket with a bucket-relative `file_path` —
 * the correct canonical contract for a private PII artifact.
 *
 * The block judged those rows on the SHAPE OF A URL and dropped them. `state` is a machine-readable
 * enum: in this contract `none` means "we looked and found nothing", as against `not_loaded` which
 * means "we did not look". "We looked, found four governed facts, and refused them on string shape"
 * had no representation, so it was filed as absence — and the page told an anonymous visitor that no
 * verified evidence existed while, two sentences later, admitting four reviewed items did.
 *
 * The fix publishes the fact and withholds the file. It does NOT mint a signed URL: production's
 * `evidenceDefaultVisibility()` returns 'restricted' for every document type, so these artifacts
 * were never cleared for public display, and a signed URL is a shareable bearer capability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  toVerifiedEvidenceBlock,
  hasStorageLocator,
  MEDIA_BLOCK_STATES,
  EVIDENCE_MEDIA_ITEM_FIELDS,
} = await import('../utils/vehicleMediaProjection.js');

/** A Golden A row as it actually exists in canonical staging: verified, private bucket, relative url. */
const privateVerifiedRow = (over = {}) => ({
  id: '065f2815-c23a-405c-acb1-b9e4dd90d92f',
  vin: 'CARUPGLDNA0000001',
  evidence_type: 'registration_document',
  verification_status: 'verified',
  visibility_level: 'public_safe',
  verified_at: '2026-08-24T02:35:26.000Z',
  captured_at: '2026-08-24T02:30:00.000Z',
  mime_type: 'application/pdf',
  file_size: 1121,
  storage_bucket: 'ocr-documents',
  file_path: 'CARUPGLDNA0000001/golden-registration_document.pdf',
  file_url: 'CARUPGLDNA0000001/golden-registration_document.pdf',
  ...over,
});

// ── The defect, stated directly ──────────────────────────────────────────────────────────────────

test('four verified private-bucket documents publish as four facts, not as "none"', () => {
  const rows = [
    privateVerifiedRow(),
    privateVerifiedRow({ id: 'e6c96f6d', evidence_type: 'insurance_document', file_path: 'v/i.pdf', file_url: 'v/i.pdf' }),
    privateVerifiedRow({ id: 'ce828980', evidence_type: 'police_clearance_document', file_path: 'v/p.pdf', file_url: 'v/p.pdf' }),
    privateVerifiedRow({ id: 'f61c6a15', evidence_type: 'inspection_photo', file_path: 'v/x.pdf', file_url: 'v/x.pdf' }),
  ];
  const block = toVerifiedEvidenceBlock(rows);

  assert.equal(block.state, MEDIA_BLOCK_STATES.PUBLISHED, 'four verified records are not absence');
  assert.equal(block.items.length, 4);
  assert.equal(block.unpublishable_count, 0, 'nothing failed to publish — the file is withheld by design');
  assert.equal(block.empty_statement, null, 'a published block makes no empty statement');
});

test('the published fact carries the review decision, and the file is named as withheld', () => {
  const [item] = toVerifiedEvidenceBlock([privateVerifiedRow()]).items;

  assert.equal(item.evidence_type, 'registration_document');
  assert.equal(item.verification_status, 'verified');
  assert.equal(item.verified_at, '2026-08-24T02:35:26.000Z');
  assert.equal(item.mime_type, 'application/pdf');
  assert.equal(item.file_size, 1121);

  assert.equal(item.file_availability, 'withheld_private', 'withholding must be stated, not implied');
  assert.equal(item.file_url, null, 'the private locator must not travel');
  assert.equal(item.file_url_form, null);
});

test('no storage locator is published, under any key', () => {
  const [item] = toVerifiedEvidenceBlock([privateVerifiedRow()]).items;
  const serialized = JSON.stringify(item);
  assert.ok(!('file_path' in item), 'file_path must not be published');
  assert.ok(!('storage_bucket' in item), 'storage_bucket must not be published');
  assert.doesNotMatch(serialized, /ocr-documents/, 'the bucket name must not leak in any value');
  assert.doesNotMatch(
    serialized,
    /golden-registration_document\.pdf/,
    'the object path must not leak — nulling file_url is what prevents this',
  );
});

test('no signed URL is ever minted by this projection', () => {
  const [item] = toVerifiedEvidenceBlock([privateVerifiedRow()]).items;
  assert.doesNotMatch(JSON.stringify(item), /token=/, 'a bearer capability must not be published');
});

// ── The counter keeps its original, narrower meaning ─────────────────────────────────────────────

test('a row naming NO artifact at all is still counted as unpublishable', () => {
  const block = toVerifiedEvidenceBlock([
    privateVerifiedRow({ file_url: '', file_path: '', storage_bucket: '' }),
  ]);
  assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
  assert.equal(block.unpublishable_count, 1, 'our defect is still counted, never silently dropped');
});

test('hasStorageLocator distinguishes "stored privately" from "names nothing"', () => {
  assert.equal(hasStorageLocator(privateVerifiedRow()), true);
  assert.equal(hasStorageLocator({ storage_bucket: 'ocr-documents', file_path: '   ' }), false);
  assert.equal(hasStorageLocator({ storage_bucket: '', file_path: 'a/b.pdf' }), false);
  assert.equal(hasStorageLocator({}), false);
  assert.equal(hasStorageLocator(null), false);
});

test('a publicly renderable artifact is unaffected — it still publishes its URL', () => {
  const [item] = toVerifiedEvidenceBlock([
    privateVerifiedRow({
      storage_bucket: 'vehicle-images',
      file_path: 'CARUPGLDNA0000001/x.png',
      file_url: 'https://eoyenigwevnxwwhyhaer.supabase.co/storage/v1/object/public/vehicle-images/x.png',
      mime_type: 'image/png',
    }),
  ]).items;
  assert.equal(item.file_availability, 'viewable');
  assert.match(item.file_url, /^https:\/\//);
  assert.notEqual(item.file_url_form, null);
});

// ── Golden B must not move ───────────────────────────────────────────────────────────────────────

test('a PENDING document is still withheld entirely — Golden B publishes nothing', () => {
  const block = toVerifiedEvidenceBlock([
    privateVerifiedRow({
      id: '9297c037', vin: 'CARUPGLDNB0000002', verification_status: 'pending', verified_at: null,
    }),
  ]);
  assert.equal(block.state, MEDIA_BLOCK_STATES.NONE, 'pending is not published, ever');
  assert.equal(block.items.length, 0);
  assert.equal(
    block.unpublishable_count, 0,
    'a row this audience may not see is not counted either — counting it would disclose that it exists',
  );
  assert.ok(block.empty_statement, 'the honest empty case still gets its sentence');
});

test('a restricted row is still withheld from the public audience', () => {
  const block = toVerifiedEvidenceBlock([privateVerifiedRow({ visibility_level: 'restricted' })]);
  assert.equal(block.state, MEDIA_BLOCK_STATES.NONE);
  assert.equal(block.items.length, 0);
  assert.equal(block.unpublishable_count, 0);
});

// ── "did not look" must remain distinguishable from "looked and found nothing" ───────────────────

test('not_loaded is untouched by this change', () => {
  assert.equal(toVerifiedEvidenceBlock(undefined).state, MEDIA_BLOCK_STATES.NOT_LOADED);
  assert.equal(toVerifiedEvidenceBlock(null).state, MEDIA_BLOCK_STATES.NOT_LOADED);
  assert.equal(toVerifiedEvidenceBlock([]).state, MEDIA_BLOCK_STATES.NONE, 'an empty array IS a look');
});

test('every published item carries exactly the declared field set', () => {
  const [item] = toVerifiedEvidenceBlock([privateVerifiedRow()]).items;
  assert.deepEqual(Object.keys(item).sort(), [...EVIDENCE_MEDIA_ITEM_FIELDS].sort());
});
