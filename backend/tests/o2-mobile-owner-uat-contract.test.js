import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../services/identity/verificationSessionService.js', import.meta.url), 'utf8');
const reg = fs.readFileSync(new URL('../../web/src/pages/onboarding/RegistrationJourney.tsx', import.meta.url), 'utf8');
const dealer = fs.readFileSync(new URL('../../web/src/pages/dealer/DealerOnboarding.tsx', import.meta.url), 'utf8');
const workbook = fs.readFileSync(new URL('../../web/src/components/workbook/WorkbookWorkspace.tsx', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../../web/src/pages/Landing.tsx', import.meta.url), 'utf8');

test('PDF branch is manual-review only and precedes image pipeline', () => {
  const branch = service.indexOf("const hasPdfDocumentEvidence")
  const classifier = service.indexOf('DocumentClassifier.classify(', branch)
  assert.ok(branch > 0 && classifier > branch)
  const pdfBlock = service.slice(branch, classifier)
  assert.match(pdfBlock, /pending_manual_review/)
  assert.match(pdfBlock, /PDF_MANUAL_REVIEW_REQUIRED/)
  assert.match(pdfBlock, /evidence_classification: EVIDENCE_CLASSIFICATION.NOT_RUN/)
  assert.match(pdfBlock, /ocr_execution_status: 'not_run'/)
  assert.match(pdfBlock, /confidence_score: null/)
  assert.doesNotMatch(pdfBlock, /extractDocumentData/)
});

test('UI advertises exactly the server-supported identity formats and separates selfie', () => {
  assert.match(reg, /DOCUMENT_ACCEPT = 'image\/jpeg,image\/png,image\/webp,application\/pdf'/)
  assert.match(reg, /SELFIE_ACCEPT = 'image\/jpeg,image\/png,image\/webp'/)
  assert.match(reg, /Accepted: JPG, PNG, WebP or PDF · Maximum 15 MB/)
  assert.match(reg, /Accepted: JPG, PNG or WebP · Maximum 15 MB/)
  assert.match(reg, /CarUp has not automatically proven both sides are present/)
  assert.match(reg, /HEIC\/HEIF are not currently supported end-to-end/)
});

test('phone compositions own width instead of desktop wrapping', () => {
  assert.match(reg, /overflow-x-clip/)
  assert.match(dealer, /overflow-x-clip/)
  assert.match(workbook, /grid w-full grid-cols-4/)
  assert.match(workbook, /wb-file-control/)
  assert.match(workbook, /min-w-\[620px\]/)
  assert.match(home, /aspect-\[4\/3\]/)
  assert.match(home, /text-\[2\.55rem\]/)
  assert.match(home, /grid-cols-2 gap-2 py-3/)
});
