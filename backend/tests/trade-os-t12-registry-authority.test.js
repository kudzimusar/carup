/**
 * Trade OS T12.1 — CarUp is not ZIMRA.
 *
 * The audit that opens T12 found the provider minting the authority it is supposed to be relying on.
 * Approving an OCR document INSERTed a row into `zimra_declarations` — a table that models an act by
 * the Zimbabwe Revenue Authority — where almost every field was manufactured:
 *
 *   customs_ref_number      'CUS_' + a random uuid        a reference nobody issued
 *   port_of_entry           defaulted to 'Beitbridge'     a port nobody recorded
 *   duty_calculated_zig     defaulted to 50000            an amount nobody assessed
 *   duty_paid_zig           the same 50000                asserting duty was PAID
 *   exchange_rate_used      hardcoded 13.5                a rate with no date and no source
 *   customs_stamp_date      today                         a stamp date nobody stamped
 *   officer_signature_hash  sha256(our own document id)   a ZIMRA OFFICER'S SIGNATURE
 *
 * …and `cvr_ownership_records` the same, down to one real-looking national ID number defaulted onto
 * every registration book.
 *
 * A photograph read by OCR and approved by a CarUp administrator is evidence that a document exists
 * and what it appeared to say. It is not a customs declaration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isGenuineRegistryRecord, NON_SUBSTANTIATING_MODES } from '../services/evidence/vehicleFactResolver.js';

const DOC_INTEL = 'backend/services/document-intelligence/documentIntelligenceService.js';
const TRUST_GRAPH = 'backend/services/trustGraph/trustGraphService.js';

test('T12: the OCR approval path writes NO government registry record', async () => {
  const source = await readFile(DOC_INTEL, 'utf8');
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  for (const registry of ['zimra_declarations', 'cvr_ownership_records', 'cid_clearance_records', 'vid_inspections', 'zinara_licensing_records']) {
    assert.ok(!new RegExp(`from\\('${registry}'\\)[\\s\\S]{0,200}\\.insert`).test(code),
      `the OCR approval path still inserts into ${registry}`);
    assert.ok(!new RegExp(`from\\('${registry}'\\)[\\s\\S]{0,200}\\.(update|upsert)`).test(code),
      `the OCR approval path still writes ${registry}`);
  }
});

test('T12: none of the fabricated values survive on the approval path', async () => {
  const source = await readFile(DOC_INTEL, 'utf8');
  // Scoped to the APPROVAL path, which ends where the sample-document parser begins. The mock
  // parser also contains a Zimbabwean national ID, and it is a different thing: it is gated behind
  // `NODE_ENV === 'test' && ALLOW_OCR_MOCK === 'true'`, it is labelled as a sample, and it produces
  // a document body rather than a registry record. Banning the string everywhere would fail on the
  // one place it is honest.
  const approvalPath = source.slice(0, source.indexOf('static getMockZimbabweDocument'));
  assert.ok(approvalPath.length > 1000, 'the approval path could not be located');
  const code = approvalPath.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  // Each of these was a claim about the world that nobody had made.
  assert.ok(!/exchange_rate_used/.test(code), 'an exchange rate is still being written');
  assert.ok(!/duty_paid_zig|duty_calculated_zig/.test(code), 'a duty amount is still being written');
  assert.ok(!/officer_signature_hash/.test(code), 'an officer signature is still being minted');
  assert.ok(!/13\.5/.test(code), 'the hardcoded exchange rate survives');
  assert.ok(!/50000/.test(code), 'the defaulted duty survives');
  assert.ok(!/29-198427-G-45/.test(code), 'the defaulted national ID survives');
  assert.ok(!/'CUS_'|'REG_'|'LB_'/.test(code), 'a synthesised registry identifier is still being minted');
});

test('T12: what CarUp DID observe is still recorded — the positive control', async () => {
  // Removing the forgery must not remove the truth. A test that only checks for absence would pass
  // just as well if the whole OCR path had been deleted.
  const source = await readFile(DOC_INTEL, 'utf8');
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  assert.match(code, /from\('ocr_customs_declarations'\)[\s\S]{0,200}\.insert/, 'what the document SAID is no longer recorded');
  assert.match(code, /from\('administrative_overrides'\)[\s\S]{0,200}\.insert/, 'who approved it is no longer recorded');
  assert.match(code, /raw_verification_confidence/, 'the confidence of the reading is no longer recorded');
});

test('T12: a synthesised registry row cannot substantiate anything', () => {
  assert.equal(isGenuineRegistryRecord('zimra_declarations', { customs_ref_number: 'CUS_A1B2C3D4' }), false);
  assert.equal(isGenuineRegistryRecord('cvr_ownership_records', { registration_number: 'REG_A1B2C3D4' }), false);
  assert.equal(isGenuineRegistryRecord('cvr_ownership_records', { logbook_serial_number: 'LB_A1B2C3D4E5' }), false);
  assert.ok(NON_SUBSTANTIATING_MODES.includes('document_intelligence'));
});

test('T12: a real registry row still does — the positive control', () => {
  // The rule must refuse the forgeries without refusing everything, or every reader would simply
  // stop working and the check would prove nothing.
  assert.equal(isGenuineRegistryRecord('zimra_declarations', { customs_ref_number: 'BE/2026/004471' }), true);
  assert.equal(isGenuineRegistryRecord('cvr_ownership_records', { registration_number: 'AEV 4471', logbook_serial_number: '0043118' }), true);
});

test('T12: the sample-document parser stays gated to the test suite', async () => {
  // It is the reason the ban above is scoped, so its gate is part of this phase's evidence.
  const source = await readFile(DOC_INTEL, 'utf8');
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  assert.match(code, /NODE_ENV === 'test' && process\.env\.ALLOW_OCR_MOCK === 'true'/);
  assert.match(code, /if \(DocumentIntelligenceService\.isOcrMockAllowed\(\)\) \{\n\s*const mockResult/,
    'the sample parser is reachable without the gate');
});

test('T12: an absent row is not a genuine one', () => {
  assert.equal(isGenuineRegistryRecord('zimra_declarations', null), false);
  assert.equal(isGenuineRegistryRecord('zimra_declarations', undefined), false);
});

test('T12: the trust graph asks the same question the fact resolver asks', async () => {
  const source = await readFile(TRUST_GRAPH, 'utf8');
  const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  // It used to score the EXISTENCE of a row — `!!zimra` — so a declaration this codebase had
  // synthesised itself was worth +10 here while being refused by the resolver.
  assert.ok(!/const dutyPaidReal = !!zimra/.test(code), 'the trust graph still scores the mere existence of a row');
  assert.ok(!/const cvrSyncedReal = !!cvr;/.test(code), 'the trust graph still scores the mere existence of a CVR row');
  assert.match(code, /isGenuineRegistryRecord\('zimra_declarations', zimra\)/);
  assert.match(code, /isGenuineRegistryRecord\('cvr_ownership_records', cvr\)/);
});
