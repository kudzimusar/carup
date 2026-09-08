/**
 * Trade OS T8 — the truth model, and the binding.
 *
 * The seven truths this phase may never collapse:
 *   FILE EXISTS → DOCUMENT PRESENT → CLASSIFIED → EXTRACTED → REVIEWED → VERIFIED → FACT VERIFIED
 *
 * The one that was actually broken: a client could post `verification_status: 'VERIFIED'` at upload
 * time, skipping the reviewer route entirely.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const docs = await import('../services/diaspora/diasporaDocumentService.js');
const readiness = await import('../services/diaspora/tradeDocumentReadinessService.js');

const SRC = readFileSync(new URL('../services/diaspora/diasporaDocumentService.js', import.meta.url), 'utf-8');
const ROUTES = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf-8');
const MIGRATION = readFileSync(new URL('../../database/migrations/20260909090000_trade_os_t8_document_subject_binding.sql', import.meta.url), 'utf-8');
const VERSIONING = readFileSync(new URL('../../database/migrations/20260910090000_trade_os_t8_document_versioning.sql', import.meta.url), 'utf-8');

// ── the truth model ──────────────────────────────────────────────────────────────────────────

/**
 * PRESENCE IS NOT VERIFICATION.
 *
 * `verification_status: payload.verification_status || UPLOADED` let a customer assert their own
 * document verified at upload time. Nothing else in the stack would have contradicted them: the
 * reviewer endpoints are guarded, but this path never went through them.
 */
test('an uploaded document is UPLOADED — a client cannot assert its own verification', () => {
  assert.ok(!/verification_status:\s*payload\.verification_status/.test(SRC),
    'the client must not be able to choose a verification status at upload');
  assert.ok(/verification_status:\s*DOCUMENT_STATUSES\.UPLOADED/.test(SRC),
    'an uploaded document starts UPLOADED, always');
});

test('only a reviewer route may verify or reject', () => {
  for (const line of ROUTES.split('\n')) {
    if (/verifyTradeDocument|rejectTradeDocument/.test(line) && /router\.(post|patch|put)/.test(line)) {
      assert.ok(/reviewerAuth/.test(line), `an unguarded verification route: ${line.trim().slice(0, 110)}`);
    }
  }
});

test('OCR is an observation — recording an extraction never verifies anything', () => {
  const fn = SRC.slice(SRC.indexOf('export async function recordDocumentExtraction'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.ok(!/DOCUMENT_STATUSES\.VERIFIED/.test(body),
    'extraction must never set VERIFIED — OCR text is not a verified fact');
});

test('verification is its own authority, recorded with who and when', () => {
  const fn = SRC.slice(SRC.indexOf('export async function verifyTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.ok(/diaspora_trade_document_verifications/.test(body), 'a verification is its own row');
  assert.ok(/verified_by/.test(body) && /verified_at/.test(body), 'who verified it, and when');
  assert.ok(/writeDiasporaAudit/.test(body), 'and it is audited');
});

// ── T8.1 the subject binding ─────────────────────────────────────────────────────────────────

test('the governed subject vocabulary is bounded, and matches the database CHECK', () => {
  assert.deepEqual(docs.DOCUMENT_SUBJECT_TYPES,
    ['import_order', 'logistics_request', 'container_booking', 'trade_order']);
  for (const s of docs.DOCUMENT_SUBJECT_TYPES) {
    assert.ok(MIGRATION.includes(`'${s}'`), `${s} is in code but not in the migration CHECK`);
  }
});

test('readiness accepts the same subjects the document binding does', async () => {
  // These drifted: readiness allowed two subjects while a document could only belong to a purchase.
  const src = readFileSync(new URL('../services/diaspora/tradeDocumentReadinessService.js', import.meta.url), 'utf-8');
  for (const s of docs.DOCUMENT_SUBJECT_TYPES) {
    assert.ok(src.includes(`'${s}'`), `readiness does not accept ${s}`);
  }
  assert.equal(typeof readiness.setReadiness, 'function');
});

test('a document must belong to exactly one transaction', async () => {
  // A REAL document type throughout, so every rejection below is about the OWNER and not about a
  // bad enum value — a test that fails for the wrong reason proves nothing about the rule it names.
  const D = 'commercial_invoice';
  const bad = [
    { document_type: D },                                                                  // no owner
    { document_type: D, import_order_id: 'o1', subject_type: 'logistics_request', subject_id: 'r1' }, // two owners
    { document_type: D, subject_type: 'logistics_request' },                               // type, no id
    { document_type: D, subject_id: 'r1' },                                                // id, no type
    { document_type: D, subject_type: 'warehouse_receipt', subject_id: 'w1' },             // invented kind
  ];
  for (const payload of bad) {
    await assert.rejects(() => docs.createTradeDocument(payload, { id: 'u1' }),
      /exactly one transaction|subject needs both|Unknown document subject/i,
      `accepted a document with an invalid owner: ${JSON.stringify(payload)}`);
  }
});

// ── the phase firewall ───────────────────────────────────────────────────────────────────────

test('a document is never allowed to stand for a later-phase fact', () => {
  // The vocabulary of other phases. If T8 ever starts writing one of these, this is what stops it.
  const FOREIGN_FACTS = [
    'customs_cleared', 'shipment_departed', 'cargo_received', 'payment_reconciled',
    'warehouse_receipt', 'measured', 'loaded',
  ];
  for (const fact of FOREIGN_FACTS) {
    assert.ok(!new RegExp(`status\\s*[:=]\\s*['"\`]${fact}`, 'i').test(SRC),
      `T8 must not set the later-phase fact "${fact}"`);
  }
});

test('the migration is additive and reversible, and destroys no history', () => {
  assert.ok(/-- \+migrate Up/.test(MIGRATION) && /-- \+migrate Down/.test(MIGRATION));
  const up = MIGRATION.split('-- +migrate Down')[0];
  assert.ok(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(up), 'the up migration must destroy nothing');
  assert.ok(/ADD COLUMN IF NOT EXISTS subject_type/.test(up) && /ADD COLUMN IF NOT EXISTS subject_id/.test(up));
  assert.ok(/num_nonnulls\(import_order_id, subject_type\) = 1/.test(up), 'exactly one owner');
});

// ── T8.4 · versioning and replacement ────────────────────────────────────────────────────────

test('a replacement is a NEW row, and never edits the one it replaces', () => {
  const fn = SRC.slice(SRC.indexOf('export async function replaceTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.ok(/\.insert\(/.test(body), 'a replacement must INSERT a new version');
  assert.ok(!/\.delete\(/.test(body), 'a replacement must never delete its predecessor');
  // The only write to the predecessor is the supersession marker — never its verdict or reviewer.
  assert.ok(/superseded_at/.test(body) && /superseded_by/.test(body));
  assert.ok(!/verification_status:\s*previous\.verification_status/.test(body),
    'a replacement must not carry the predecessor verdict forward');
  assert.ok(!/reviewed_by:\s*previous/.test(body), 'a replacement must not inherit a reviewer');
});

test('a replacement starts UPLOADED even when it replaces a VERIFIED document', () => {
  const fn = SRC.slice(SRC.indexOf('export async function replaceTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.ok(/verification_status:\s*DOCUMENT_STATUSES\.UPLOADED/.test(body),
    'inheriting a verdict on a file nobody has looked at is the presence-verified collapse again');
});

test('a replacement cannot move a document to a different transaction', () => {
  const fn = SRC.slice(SRC.indexOf('export async function replaceTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  for (const field of ['import_order_id', 'subject_type', 'subject_id']) {
    assert.ok(new RegExp(`${field}:\\s*previous\\.${field}`).test(body),
      `${field} must be INHERITED, not re-supplied — otherwise a replacement smuggles evidence between trades`);
  }
});

test('an already-superseded version cannot be replaced again', () => {
  const fn = SRC.slice(SRC.indexOf('export async function replaceTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  assert.ok(/previous\.superseded_at/.test(body) && /already been replaced/.test(body));
});

test('the predecessor is marked superseded only AFTER the new version exists', () => {
  const fn = SRC.slice(SRC.indexOf('export async function replaceTradeDocument'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  const insertIdx = body.indexOf('.insert(');
  const markIdx = body.indexOf('superseded_at: new Date()');
  assert.ok(insertIdx > -1 && markIdx > insertIdx,
    'marking first would leave the transaction with no current document if the insert failed');
});

test('the versioning migration is additive, reversible and destroys nothing', () => {
  const up = VERSIONING.split('-- +migrate Down')[0];
  assert.ok(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(up));
  assert.ok(/uq_trade_document_single_successor/.test(up), 'concurrent replacement must be refused by the database');
  assert.ok(/no_self_supersede/.test(up));
  assert.ok(/-- \+migrate Down/.test(VERSIONING));
});

test('replacement is an upload-authority action, and can never verify', () => {
  for (const line of ROUTES.split('\n')) {
    if (/replaceTradeDocument/.test(line) && /router\.post/.test(line)) {
      assert.ok(!/reviewerAuth/.test(line), 'replacing is not a review action');
    }
  }
  assert.ok(/getTradeDocumentLineage/.test(ROUTES), 'the lineage must be readable, or history is unauditable');
});
