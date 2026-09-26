/**
 * O2 — final predictive closure: F1 and F2.
 *
 * F1  a version number is not proof of authorship. `validateEvidenceUploadPayload` accepts arbitrary
 *     object metadata and `buildAiReadyMetadata` spreads it, so a pre-contract row could simply
 *     CONTAIN `{v:1, checksum_source:'server_inline'}`. Measured end-to-end: a genuine inline upload
 *     of a different object was handed the forged row.
 * F2  the route accepts `file_url` and `file_path` independently, stores
 *     `file_path: filePath || fileUrl`, and identity read `file_path || file_url` — so holding the
 *     path constant while changing the URL silently discarded the second document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const {
  withUploadIdempotency, deriveRemoteReference, assertLocatorConsistency, storageKeyFromTrustedUrl,
  buildProvenance, readStoredChecksumSource, PROVENANCE_KEY, PROVENANCE_VERSION,
  CHECKSUM_SOURCES, IDEMPOTENCY_OPERATION_CONFLICT,
} = await import('../services/evidence/uploadIdempotency.js');

const ROW = { checksum: 'SUM-X', vin: 'VIN-A', uploaded_by: 'u1' };
const signedBlock = (over = {}) => buildProvenance({
  hasInlineBuffer: true, hasChecksum: true, checksum: ROW.checksum, vin: ROW.vin, uploadedBy: ROW.uploaded_by, ...over,
});

/* ══ F1 — provenance must be independently server-verifiable ══════════════════════════ */

test('F1 (1): genuine current server-authored provenance IS trusted', () => {
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: signedBlock() }, ROW), CHECKSUM_SOURCES.SERVER_INLINE);
});

test('F1 (2,3,4,5): every unprovable shape is untrusted', () => {
  const cases = [
    ['legacy flat flag', { checksum_source: 'server_inline' }],
    ['unversioned block', { [PROVENANCE_KEY]: { checksum_source: 'server_inline' } }],
    ['wrong version', { [PROVENANCE_KEY]: { v: PROVENANCE_VERSION + 1, checksum_source: 'server_inline', sig: 'x' } }],
    ['EXACT v1 block, no signature', { [PROVENANCE_KEY]: { v: PROVENANCE_VERSION, checksum_source: 'server_inline' } }],
  ];
  for (const [label, metadata] of cases) {
    assert.equal(readStoredChecksumSource(metadata, ROW), null, `${label} must not raise trust`);
  }
});

test('F1 (6): a TAMPERED signature, and a block LIFTED from another row, are untrusted', () => {
  const good = signedBlock();
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: { ...good, sig: '0'.repeat(64) } }, ROW), null, 'tampered');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: { ...good, sig: 'short' } }, ROW), null, 'malformed');
  // The assertion is bound to the row it describes, so it cannot be copied onto another.
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: good }, { ...ROW, vin: 'VIN-B' }), null, 'other vin');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: good }, { ...ROW, uploaded_by: 'u2' }), null, 'other uploader');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: good }, { ...ROW, checksum: 'OTHER' }), null, 'other checksum');
  // …and the source it vouches for is part of the binding.
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: { ...good, checksum_source: 'client_asserted' } }, ROW), null,
    'the claimed source cannot be edited after signing');
});

test('F1: with NO key material the block is untrusted — conservative, never fail-open', () => {
  const prev = process.env.JWT_SECRET;
  const good = signedBlock();
  try {
    delete process.env.JWT_SECRET;
    assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: good }, ROW), null,
      'unverifiable must read as untrusted, not as trusted');
    const unsigned = buildProvenance({ hasInlineBuffer: true, hasChecksum: true, checksum: 'X', vin: 'V', uploadedBy: 'u' });
    assert.equal(Object.prototype.hasOwnProperty.call(unsigned, 'sig'), false,
      'and a block written without key material carries no signature to be believed later');
  } finally { process.env.JWT_SECRET = prev; }
});

/* the end-to-end substitution the allegation described */

const COLS = 'id, vin, uploaded_by, evidence_class, evidence_subtype, evidence_type, checksum, '
  + 'storage_bucket, file_path, file_url, metadata, idempotency_key';

async function evidenceDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (id text PRIMARY KEY, vin text, uploaded_by text,
    evidence_class text, evidence_subtype text, evidence_type text, checksum text,
    storage_bucket text, file_path text, file_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text);`);
  return db;
}
const clientOver = (db) => ({
  from: () => ({
    select: () => {
      const f = {};
      const chain = {
        eq(k, v) { f[k] = v; return chain; },
        or(x) { f.key = String(x).match(/idempotency_key\.eq\.([^,]+)/)?.[1] ?? null; return chain; },
        async limit() {
          const { rows } = await db.query(
            `SELECT ${COLS} FROM vehicle_evidence WHERE uploaded_by = $2
              AND (idempotency_key = $1 OR metadata->>'idempotency_key' = $1) LIMIT 1;`, [f.key, f.uploaded_by]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  }),
});
const seedRow = (db, id, filePath, fileUrl, checksum, metadata) => db.query(
  `INSERT INTO vehicle_evidence VALUES ($1,'VIN-A','u1','registration','registration_book',
    'registration_book',$2,'vehicle-images',$3,$4,$5::jsonb,'K');`,
  [id, checksum, filePath, fileUrl, JSON.stringify(metadata)]);

const OP = ({ path = null, url = null, checksum = null, source = null }) => ({
  evidence_class: 'registration', evidence_subtype: 'registration_book',
  evidence_type: 'registration_book', checksum, checksum_source: source,
  storage_bucket: 'vehicle-images', file_path: path, file_url: url,
});
function attempt(db, op) {
  let created = 0;
  const run = withUploadIdempotency('K', 'VIN-A', async () => { created += 1; return { id: 'ev-mine', vin: 'VIN-A' }; },
    { store: new Map(), supabase: clientOver(db), actorId: 'u1',
      operation: { ...op, remote_ref: deriveRemoteReference(op) } });
  return { run, created: () => created };
}

test('F1: the end-to-end SUBSTITUTION is closed — a forged row cannot capture a genuine upload', async () => {
  const db = await evidenceDb();
  await seedRow(db, 'attacker-row', 'evidence/ATTACKER.pdf', 'evidence/ATTACKER.pdf', 'SUM-X',
    { idempotency_key: 'K', [PROVENANCE_KEY]: { v: PROVENANCE_VERSION, checksum_source: 'server_inline' } });
  const a = attempt(db, OP({ path: 'evidence/MINE.pdf', checksum: 'SUM-X', source: CHECKSUM_SOURCES.SERVER_INLINE }));
  await assert.rejects(() => a.run,
    (e) => { assert.equal(e.details.field, 'remote_ref'); return true; },
    'the caller must never be handed the forged row');
  await db.close();
});

test('F1 (7,8): a legitimate CURRENT cold-cache retry still works, warm and cold', async () => {
  for (const cold of [false, true]) {
    const db = await evidenceDb();
    const signed = buildProvenance({ hasInlineBuffer: true, hasChecksum: true, checksum: 'SUM-X', vin: 'VIN-A', uploadedBy: 'u1' });
    await seedRow(db, 'cur-1', 'evidence/A.pdf', 'evidence/A.pdf', 'SUM-X', { idempotency_key: 'K', [PROVENANCE_KEY]: signed });
    const op = OP({ path: 'evidence/MOVED.pdf', checksum: 'SUM-X', source: CHECKSUM_SOURCES.SERVER_INLINE });
    const store = new Map();
    const out = await withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'should-not-run' }),
      { store: cold ? new Map() : store, supabase: clientOver(db), actorId: 'u1',
        operation: { ...op, remote_ref: deriveRemoteReference(op) } });
    assert.equal(out.deduped, true, `cold=${cold}: genuine signed provenance still outranks a moved object`);
    assert.equal(out.evidenceId, 'cur-1');
    await db.close();
  }
});

/* ══ F2 — one truthful locator contract ═══════════════════════════════════════════════ */

const TRUSTED = 'https://myproj.supabase.co';
const withTrustedOrigin = (fn) => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = TRUSTED;
  try { return fn(); } finally { process.env.SUPABASE_URL = prev; }
};

test('F2 (1): the SAME external URL with the same path retries cleanly', async () => {
  const db = await evidenceDb();
  const op = OP({ path: 'https://ext.test/A.pdf', url: 'https://ext.test/A.pdf' });
  const store = new Map();
  const first = await withUploadIdempotency('K', 'VIN-A',
    () => seedRow(db, 'ev-1', op.file_path, op.file_url, null, { idempotency_key: 'K' }).then(() => ({ id: 'ev-1', vin: 'VIN-A' })),
    { store, supabase: clientOver(db), actorId: 'u1', operation: { ...op, remote_ref: deriveRemoteReference(op) } });
  const again = await withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'should-not-run' }),
    { store, supabase: clientOver(db), actorId: 'u1', operation: { ...op, remote_ref: deriveRemoteReference(op) } });
  assert.equal(again.deduped, true);
  assert.equal(again.evidenceId, first.evidenceId);
  await db.close();
});

test('F2 (2): the same path with a DIFFERENT external URL is NOT one identity', async () => {
  const a = deriveRemoteReference({ storage_bucket: 'b', file_path: 'VIN/document.pdf', file_url: 'https://ext.test/A.pdf' });
  const b = deriveRemoteReference({ storage_bucket: 'b', file_path: 'VIN/document.pdf', file_url: 'https://ext.test/B.pdf' });
  assert.notEqual(a, b, 'a caller-supplied path must not mask a changed URL');

  const db = await evidenceDb();
  const store = new Map();
  const opA = OP({ path: 'VIN/document.pdf', url: 'https://ext.test/A.pdf' });
  const opB = OP({ path: 'VIN/document.pdf', url: 'https://ext.test/B.pdf' });
  await withUploadIdempotency('K', 'VIN-A',
    () => seedRow(db, 'ev-1', 'VIN/document.pdf', 'https://ext.test/A.pdf', null, { idempotency_key: 'K' })
      .then(() => ({ id: 'ev-1', vin: 'VIN-A' })),
    { store, supabase: clientOver(db), actorId: 'u1', operation: { ...opA, remote_ref: deriveRemoteReference(opA) } });
  await assert.rejects(
    () => withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'ev-2' }),
      { store, supabase: clientOver(db), actorId: 'u1', operation: { ...opB, remote_ref: deriveRemoteReference(opB) } }),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT,
    'the second document must be refused, never discarded');
  await db.close();
});

test('F2 (3,4): a trusted storage URL must agree with any path supplied beside it', () => withTrustedOrigin(() => {
  const url = `${TRUSTED}/storage/v1/object/sign/vehicle-images/VIN/d.pdf?token=x`;
  assert.equal(storageKeyFromTrustedUrl(url), 'VIN/d.pdf');
  assert.doesNotThrow(() => assertLocatorConsistency({ file_url: url, file_path: 'VIN/d.pdf' }), 'matching path is fine');
  assert.throws(() => assertLocatorConsistency({ file_url: url, file_path: 'OTHER/x.pdf' }),
    /different objects/, 'a contradictory path is refused');
  assert.throws(() => assertLocatorConsistency({ file_url: 'https://ext.test/A.pdf', file_path: 'VIN/d.pdf' }),
    /different objects/, 'an external URL cannot be corroborated by a storage path');
  assert.doesNotThrow(() => assertLocatorConsistency({ file_url: 'https://ext.test/A.pdf' }), 'one locator is fine');
  assert.doesNotThrow(() => assertLocatorConsistency({ file_path: 'VIN/d.pdf' }), 'one locator is fine');
}));

test('F2 (5): a signed reissue for the SAME trusted object still dedupes', () => withTrustedOrigin(() => {
  const one = deriveRemoteReference({ file_url: `${TRUSTED}/storage/v1/object/sign/vehicle-images/VIN/d.pdf?token=aaa` });
  const two = deriveRemoteReference({ file_url: `${TRUSTED}/storage/v1/object/sign/vehicle-images/VIN/d.pdf?token=bbb` });
  assert.equal(one, two);
  assert.equal(one, 'vehicle-images/VIN/d.pdf');
}));

test('F2 (6): an INLINE upload — server owns both locators — is unaffected', () => {
  // The route sets file_path and file_url itself for an inline upload; they agree by construction.
  assert.doesNotThrow(() => assertLocatorConsistency({ file_url: 'evidence/x.pdf', file_path: 'evidence/x.pdf' }));
  assert.equal(deriveRemoteReference({ storage_bucket: 'vehicle-images', file_path: 'evidence/x.pdf', file_url: 'evidence/x.pdf' }),
    'vehicle-images/evidence/x.pdf');
});

test('F2 (7): warm and cold identity are the same value', async () => {
  const op = OP({ path: 'VIN/document.pdf', url: 'https://ext.test/A.pdf' });
  const first = deriveRemoteReference(op);
  const fromStoredRow = deriveRemoteReference({ storage_bucket: 'vehicle-images', file_path: 'VIN/document.pdf', file_url: 'https://ext.test/A.pdf' });
  assert.equal(first, fromStoredRow, 'the request and the stored row must resolve identically');
});

test('F2: the route refuses contradictory locators BEFORE any write', () => {
  const route = readFileSync(fileURLToPath(new URL('../routes/vehiclesRoutes.js', import.meta.url)), 'utf8');
  const guardAt = route.indexOf('assertLocatorConsistency({ file_url: fileUrl, file_path: filePath })');
  const insertAt = route.indexOf('const insertData = {');
  assert.ok(guardAt > 0 && insertAt > guardAt, 'the contradiction is refused before the insert is built');
});
