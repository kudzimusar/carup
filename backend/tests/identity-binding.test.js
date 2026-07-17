/**
 * Phase 7C Workstream F — account-holder vs document-holder binding.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  compareAccountToDocument,
  documentHolderName,
} from '../services/identity/identityBinding.js';

test('normalizeName lowercases, strips diacritics and punctuation, collapses spaces', () => {
  assert.equal(normalizeName('  Tafadzwa   Moyo '), 'tafadzwa moyo');
  assert.equal(normalizeName('Tafádzwa-Moyo'), 'tafadzwa moyo');
  assert.equal(normalizeName('JOHN  O\'BRIEN'), 'john o brien');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(42), '');
});

test('exact normalized match is a match', () => {
  const r = compareAccountToDocument({ accountName: 'Tafadzwa Moyo', documentName: 'tafadzwa  moyo' });
  assert.equal(r.status, 'match');
  assert.equal(r.reason, null);
});

test('same tokens in different order is a match', () => {
  const r = compareAccountToDocument({ accountName: 'Moyo Tafadzwa', documentName: 'Tafadzwa Moyo' });
  assert.equal(r.status, 'match');
});

test('surname + first-initial agreement (middle name) is a match', () => {
  const r = compareAccountToDocument({ accountName: 'Tafadzwa Moyo', documentName: 'Tafadzwa Brian Moyo' });
  assert.equal(r.status, 'match');
});

test('different person is a material mismatch', () => {
  const r = compareAccountToDocument({ accountName: 'Phase7B Tester', documentName: 'Tafadzwa Moyo' });
  assert.equal(r.status, 'mismatch');
  assert.match(r.reason, /does not match the document holder/);
  assert.match(r.reason, /Phase7B Tester/);
  assert.match(r.reason, /Tafadzwa Moyo/);
});

test('missing account or document name is indeterminate (never a false mismatch)', () => {
  assert.equal(compareAccountToDocument({ accountName: '', documentName: 'Tafadzwa Moyo' }).status, 'indeterminate');
  assert.equal(compareAccountToDocument({ accountName: 'Tafadzwa Moyo', documentName: '' }).status, 'indeterminate');
  assert.equal(compareAccountToDocument({}).status, 'indeterminate');
});

test('documentHolderName joins OCR first/last name and tolerates gaps', () => {
  assert.equal(documentHolderName({ first_name: 'Tafadzwa', last_name: 'Moyo' }), 'Tafadzwa Moyo');
  assert.equal(documentHolderName({ first_name: 'Tafadzwa' }), 'Tafadzwa');
  assert.equal(documentHolderName({}), '');
  assert.equal(documentHolderName(), '');
});
