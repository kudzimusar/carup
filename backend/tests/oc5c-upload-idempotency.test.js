/**
 * O2-X5A (bounded port by OC-5C from PR #208 rounds G–M) — evidence upload idempotency, proven on real
 * PostgreSQL (PGlite) and through the shipped upload route.
 *
 *   J-2  the key is scoped to the ACTOR: another user's identical key is an independent namespace and
 *        never hands back the first user's row (RC1 did, for any vehicle);
 *   K    the key is bound to its VEHICLE and its OPERATION: a reuse for something else is a 409, never
 *        a silent dedupe that discards the second upload;
 *   L/M  content outranks location only when CarUp computed the checksum IN THIS REQUEST; a checksum a
 *        caller asserts beside a remote URL is a claim; nothing stored on the earlier row is consulted
 *        (#208's provenance-in-metadata and its HMAC are not ported);
 *   K1   without the candidate column (42703, only that) the metadata mirror still dedupes durably;
 *   I    with the candidate index applied, concurrent first uploads by one actor make ONE row — the
 *        loser's native 23505 on THAT index is recognised and the winner read back;
 *        any other unique violation propagates;
 *   —    no filter syntax is built from a client key (#208's `.or(...)`);
 *   —    the candidate migration: Up, re-run, Down, Up.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const idem = await import('../services/evidence/uploadIdempotency.js');
const { withUploadIdempotency, toDatabaseError, deriveRemoteReference, CHECKSUM_SOURCES, __clearUploadIdempotencyStore } = idem;
const { createEvidenceHistoryDatabase, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE = path.resolve(here, '../../database/migration-candidates/oc5c/20261004174000_o2_vehicle_evidence_upload_idempotency.sql');
const [CANDIDATE_UP, CANDIDATE_DOWN] = readFileSync(CANDIDATE, 'utf8').split(/^-- \+migrate Down/m);

const VIN_A = 'OC5CIDEMVIN000001';
const VIN_B = 'OC5CIDEMVIN000002';

async function evidenceDb({ withCandidate = false } = {}) {
  const db = await createEvidenceHistoryDatabase();
  for (const vin of [VIN_A, VIN_B]) {
    await db.query('INSERT INTO vehicles (vin, make, model, year, mileage, price) VALUES ($1, $2, $3, $4, $5, $6)', [vin, 'Toyota', 'Hilux', 2020, 42000, 21000]);
  }
  await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES
    ('user-1', 'One', 'one@example.invalid', 'owner', '2026-01-01'),
    ('user-2', 'Two', 'two@example.invalid', 'owner', '2026-01-01')`);
  if (withCandidate) await db.exec(CANDIDATE_UP.replace('-- +migrate Up', ''));
  return db;
}

/** The route's OWN writer (the shipped `insertEvidenceWithKey`), not a copy. */
function insertRow(supabase, row, key) {
  return () => idem.insertEvidenceWithKey(supabase, row, key);
}

function evidenceRow({ vin = VIN_A, actor = 'user-1', key = null, type = 'inspection_photo', checksum = null, fileUrl = 'https://files.example.invalid/doc.pdf', filePath = null, metadata = {} } = {}) {
  return {
    vehicle_id: vin, vin, event_type: 'inspection', evidence_type: type, evidence_class: 'current_condition',
    file_url: fileUrl, storage_bucket: 'vehicle-images', file_path: filePath || fileUrl, mime_type: 'image/jpeg', file_size: 10,
    checksum, uploaded_by: actor, uploader_role: 'owner', metadata: { ...metadata, ...(key ? { idempotency_key: key } : {}) },
  };
}

function operationOf(row, { inline = false } = {}) {
  return {
    evidence_class: row.evidence_class, evidence_subtype: row.evidence_subtype ?? null, evidence_type: row.evidence_type,
    checksum: row.checksum, checksum_source: inline ? CHECKSUM_SOURCES.SERVER_INLINE : CHECKSUM_SOURCES.CLIENT_ASSERTED,
    remote_ref: deriveRemoteReference(row),
  };
}

async function upload(supabase, { key, actor = 'user-1', vin = VIN_A, inline = false, ...rest } = {}) {
  const row = evidenceRow({ vin, actor, key, ...rest });
  return withUploadIdempotency(key, vin, insertRow(supabase, row, key), { supabase, actorId: actor, operation: operationOf(row, { inline }) });
}

const count = async (db) => Number((await db.query('SELECT count(*)::int AS n FROM vehicle_evidence')).rows[0].n);

beforeEach(() => __clearUploadIdempotencyStore());

test('J-2: another actor\'s identical key is an independent namespace — never the first actor\'s row', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    const first = await upload(supabase, { key: 'SHARED', actor: 'user-1', vin: VIN_A });
    const second = await upload(supabase, { key: 'SHARED', actor: 'user-2', vin: VIN_B });
    assert.equal(second.deduped, false, 'a different actor is never "deduplicated" against someone else');
    assert.notEqual(second.evidenceId, first.evidenceId, 'and is never handed the first actor\'s evidence id');
    assert.equal(await count(db), 2);
    const { rows } = await db.query('SELECT uploaded_by, vin FROM vehicle_evidence WHERE id = $1', [second.evidenceId]);
    assert.deepEqual([rows[0].uploaded_by, rows[0].vin], ['user-2', VIN_B]);
  } finally { await db.close(); }
});

test('the same actor retrying the same upload is deduplicated — and durably, after the process forgets', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    const first = await upload(supabase, { key: 'k-retry' });
    const retry = await upload(supabase, { key: 'k-retry' });
    __clearUploadIdempotencyStore(); // a cold start
    const afterRestart = await upload(supabase, { key: 'k-retry' });
    assert.deepEqual([retry.deduped, afterRestart.deduped], [true, true]);
    assert.equal(retry.evidenceId, first.evidenceId);
    assert.equal(afterRestart.evidenceId, first.evidenceId);
    assert.equal(await count(db), 1);
  } finally { await db.close(); }
});

test('K: a key reused for another VEHICLE or another OPERATION is a 409 — the second upload is never silently discarded', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    await upload(supabase, { key: 'k-bound' });
    await assert.rejects(() => upload(supabase, { key: 'k-bound', vin: VIN_B }),
      (e) => e.statusCode === 409 && e.details?.reason === 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_RESOURCE');
    await assert.rejects(() => upload(supabase, { key: 'k-bound', type: 'registration_book' }),
      (e) => e.statusCode === 409 && e.details?.reason === 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_OPERATION' && e.details.field === 'evidence_type');
    await assert.rejects(() => upload(supabase, { key: 'k-bound', fileUrl: 'https://files.example.invalid/other.pdf' }),
      (e) => e.statusCode === 409 && e.details.field === 'remote_ref', 'another remote object is another upload');
    assert.equal(await count(db), 1, 'no conflicting row was created');
  } finally { await db.close(); }
});

test('L/M: content outranks location ONLY when CarUp computed the checksum in THIS request', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    // An inline retry: same bytes (same server checksum) land at a NEW random storage path.
    const first = await upload(supabase, { key: 'k-inline', inline: true, checksum: 'sha256:aaa', fileUrl: `${VIN_A}/photo_1.jpg` });
    const retry = await upload(supabase, { key: 'k-inline', inline: true, checksum: 'sha256:aaa', fileUrl: `${VIN_A}/photo_2.jpg` });
    assert.equal(retry.deduped, true);
    assert.equal(retry.evidenceId, first.evidenceId);
    // Different bytes under the same key: a different upload.
    await assert.rejects(() => upload(supabase, { key: 'k-inline', inline: true, checksum: 'sha256:bbb', fileUrl: `${VIN_A}/photo_3.jpg` }),
      (e) => e.statusCode === 409 && e.details.field === 'checksum');

    // A REMOTE submission that merely ASSERTS the same checksum beside a different object is a claim.
    await upload(supabase, { key: 'k-remote', checksum: 'sha256:ccc', fileUrl: 'https://files.example.invalid/a.pdf' });
    await assert.rejects(() => upload(supabase, { key: 'k-remote', checksum: 'sha256:ccc', fileUrl: 'https://files.example.invalid/b.pdf' }),
      (e) => e.statusCode === 409 && e.details.field === 'remote_ref');
  } finally { await db.close(); }
});

test('L/M: stored metadata is NEVER consulted — a planted "server_inline" provenance block on the earlier row changes nothing', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    await upload(supabase, {
      key: 'k-planted', checksum: 'sha256:ddd', fileUrl: 'https://files.example.invalid/a.pdf',
      metadata: { carup_provenance: { v: 1, checksum_source: 'server_inline', sig: 'forged' }, checksum_source: 'server_inline' },
    });
    __clearUploadIdempotencyStore();
    // A remote retry asserting the same checksum for a different object: still a different upload.
    await assert.rejects(() => upload(supabase, { key: 'k-planted', checksum: 'sha256:ddd', fileUrl: 'https://files.example.invalid/b.pdf' }),
      (e) => e.statusCode === 409 && e.details.field === 'remote_ref');
  } finally { await db.close(); }
});

test('a re-signed URL on CarUp\'s own storage origin is the same object — the signature and expiry are not identity', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    const origin = new URL(process.env.SUPABASE_URL).origin;
    const signed = (token) => `${origin}/storage/v1/object/sign/vehicle-images/${VIN_A}/doc.pdf?token=${token}&expires=1`;
    const first = await upload(supabase, { key: 'k-signed', fileUrl: signed('t1') });
    const again = await upload(supabase, { key: 'k-signed', fileUrl: signed('t2') });
    assert.deepEqual([again.deduped, again.evidenceId], [true, first.evidenceId]);
    // An OPAQUE URL's query can be the only thing naming the document.
    await upload(supabase, { key: 'k-opaque', fileUrl: 'https://files.example.invalid/document?id=A' });
    await assert.rejects(() => upload(supabase, { key: 'k-opaque', fileUrl: 'https://files.example.invalid/document?id=B' }), (e) => e.statusCode === 409);
  } finally { await db.close(); }
});

test('K1: WITHOUT the candidate column (42703, and only that) the metadata mirror still dedupes durably', async () => {
  const db = await evidenceDb({ withCandidate: false });
  try {
    const supabase = supabaseOver(db);
    const first = await upload(supabase, { key: 'k-premigration' });
    __clearUploadIdempotencyStore(); // a cold start
    const retry = await upload(supabase, { key: 'k-premigration' });
    assert.deepEqual([retry.deduped, retry.evidenceId], [true, first.evidenceId]);
    assert.equal(await count(db), 1, 'one row — the pre-migration writer stored the key in the mirror');
    const other = await upload(supabase, { key: 'k-premigration', actor: 'user-2', vin: VIN_B });
    assert.equal(other.deduped, false, 'actor scope holds on the mirror too');
  } finally { await db.close(); }
});

test('I: with the candidate index, concurrent first uploads by one actor make ONE row — the loser reads the winner back', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    // Separate stores: two workers, neither of which has seen the other.
    const row = evidenceRow({ key: 'k-race' });
    const run = (store) => withUploadIdempotency('k-race', VIN_A, insertRow(supabase, row, 'k-race'), { supabase, actorId: 'user-1', operation: operationOf(row), store });
    const [a, b] = await Promise.all([run(new Map()), run(new Map())]);
    assert.equal(a.evidenceId, b.evidenceId, 'both workers report the ONE row');
    assert.equal(a.deduped !== b.deduped, true, 'exactly one of them created it');
    assert.equal(await count(db), 1);
  } finally { await db.close(); }
});

test('I: ANY OTHER unique violation propagates — it is never mistaken for "someone else uploaded this"', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    await db.exec('CREATE UNIQUE INDEX uq_test_unrelated ON vehicle_evidence (file_url)');
    await upload(supabase, { key: 'k-one', fileUrl: 'https://files.example.invalid/same.pdf' });
    await assert.rejects(() => upload(supabase, { key: 'k-two', fileUrl: 'https://files.example.invalid/same.pdf' }),
      (e) => e.code === 'DATABASE_ERROR' && e.cause?.code === '23505', 'the native identity rides as the cause; nothing is swallowed');
    const loser = toDatabaseError({ message: 'duplicate key value violates unique constraint "uq_test_unrelated"', code: '23505', constraint: 'uq_test_unrelated' });
    assert.equal(idem.isIdempotencyUniqueViolation(loser), false);
    const winner = toDatabaseError({ message: 'duplicate key value violates unique constraint "uq_vehicle_evidence_idempotency_key"', code: '23505', constraint: 'uq_vehicle_evidence_idempotency_key' });
    assert.equal(idem.isIdempotencyUniqueViolation(winner), true);
    assert.equal(idem.isIdempotencyUniqueViolation(new Error('uq_vehicle_evidence_idempotency_key mentioned without a native code')), false);
  } finally { await db.close(); }
});

test('no filter syntax is built from a client key — a key full of PostgREST punctuation matches only itself', async () => {
  const db = await evidenceDb({ withCandidate: true });
  try {
    const supabase = supabaseOver(db);
    await upload(supabase, { key: 'plain' });
    const tricky = await upload(supabase, { key: 'plain),uploaded_by.neq.(x' });
    assert.equal(tricky.deduped, false);
    assert.equal(await count(db), 2);
  } finally { await db.close(); }
  const source = readFileSync(path.resolve(here, '../services/evidence/uploadIdempotency.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /\.or\(/, 'the lookup is parameterized .eq reads only');
  assert.doesNotMatch(source, /createHmac|JWT_SECRET|carup_provenance/, 'no self-certifying provenance stamp');
});

test('keys are validated, and an upload with no key or no actor fails OPEN (it is never suppressed)', async () => {
  assert.throws(() => idem.normalizeIdempotencyKey('x'.repeat(201)), /at most 200/);
  assert.throws(() => idem.normalizeIdempotencyKey('bad\u0000key'), /printable/);
  assert.equal(idem.normalizeIdempotencyKey('  '), null);
  let creates = 0;
  const createFn = async () => { creates += 1; return { id: `ev-${creates}`, vin: VIN_A }; };
  await withUploadIdempotency('k', VIN_A, createFn, {});
  await withUploadIdempotency('k', VIN_A, createFn, {});
  await withUploadIdempotency(null, VIN_A, createFn, { actorId: 'user-1' });
  assert.equal(creates, 3, 'without an actor (or a key) there is no namespace to dedupe within');
});

test('the candidate migration: Up adds the column and partial unique index; re-run is idempotent; Down removes both; Up again', async () => {
  const db = await createEvidenceHistoryDatabase();
  try {
    const up = CANDIDATE_UP.replace('-- +migrate Up', '');
    await db.exec(up);
    await db.exec(up);
    const index = async () => (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_vehicle_evidence_idempotency_key'")).rows[0]?.indexdef || null;
    assert.match(await index(), /UNIQUE INDEX .* \(uploaded_by, idempotency_key\) WHERE \(\(idempotency_key IS NOT NULL\) AND \(uploaded_by IS NOT NULL\)\)/);
    await db.exec(CANDIDATE_DOWN);
    assert.equal(await index(), null);
    const { rows } = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_evidence' AND column_name = 'idempotency_key'");
    assert.equal(rows.length, 0);
    await db.exec(up);
    assert.ok(await index());
  } finally { await db.close(); }
  assert.match(readFileSync(CANDIDATE, 'utf8'), /NOT APPLIED ANYWHERE/);
});

// ── through the shipped upload route ─────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
let world; let restoreWorld; let server; let baseUrl; let supabaseClient;
before(async () => {
  const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
  ({ supabase: supabaseClient } = await import('../db/supabase.js'));
  const { app } = await import('../server.js');
  world = createSupabaseWorld({
    users: [{ id: 'owner-a', role: 'owner', name: 'A' }, { id: 'owner-b', role: 'owner', name: 'B' }],
    user_sessions: [
      { token: 't-a', user_id: 'owner-a', is_valid: true, expires_at: FUTURE },
      { token: 't-b', user_id: 'owner-b', is_valid: true, expires_at: FUTURE },
    ],
    vehicles: [
      { vin: VIN_A, owner_id: 'owner-a', make: 'Toyota', model: 'Hilux', year: 2020, publication_status: 'published' },
      { vin: VIN_B, owner_id: 'owner-b', make: 'Toyota', model: 'Hilux', year: 2020, publication_status: 'published' },
    ],
    vehicle_evidence: [], evidence_provenance_events: [], trust_audit_events: [],
  });
  restoreWorld = installSupabaseWorld(supabaseClient, world);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function routeUpload(token, vin, body) {
  const res = await fetch(`${baseUrl}/api/vehicles/${vin}/evidence/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', 'x-session-token': token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
const jpeg = (fill) => { const b = Buffer.alloc(3200, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return `data:image/jpeg;base64,${b.toString('base64')}`; };

test('ROUTE: two owners sending the SAME key each get their OWN evidence — the second is never handed the first\'s row', async () => {
  const body = { evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', idempotency_key: 'route-shared' };
  const a = await routeUpload('t-a', VIN_A, { ...body, file: jpeg(41) });
  assert.equal(a.status, 201, a.text.slice(0, 300));
  const b = await routeUpload('t-b', VIN_B, { ...body, file: jpeg(42) });
  assert.equal(b.status, 201, b.text.slice(0, 300));
  assert.notEqual(b.body.id, a.body.id);
  assert.equal(b.body.vin, VIN_B);
  assert.equal(world.rows('vehicle_evidence').length, 2);

  // The same owner retrying the same bytes (a new storage path each time) is one row.
  const retry = await routeUpload('t-a', VIN_A, { ...body, file: jpeg(41) });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, a.body.id);
  assert.equal(world.rows('vehicle_evidence').length, 2);

  // …and the same key with DIFFERENT bytes is a 409, not a silently discarded upload.
  const different = await routeUpload('t-a', VIN_A, { ...body, file: jpeg(43) });
  assert.equal(different.status, 409, different.text.slice(0, 300));
  assert.equal(world.rows('vehicle_evidence').length, 2);
});

test('ROUTE: a REMOTE submission\'s checksum is the caller\'s claim — the same asserted checksum for another object is a 409', async () => {
  const body = { evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', mime_type: 'image/jpeg', checksum: 'sha256:claimed', idempotency_key: 'route-remote' };
  const first = await routeUpload('t-a', VIN_A, { ...body, file_url: 'https://files.example.invalid/one.jpg' });
  assert.equal(first.status, 201, first.text.slice(0, 300));
  const before = world.rows('vehicle_evidence').length;
  const other = await routeUpload('t-a', VIN_A, { ...body, file_url: 'https://files.example.invalid/two.jpg' });
  assert.equal(other.status, 409, other.text.slice(0, 300));
  assert.equal(world.rows('vehicle_evidence').length, before, 'the second object was neither stored nor silently discarded as a duplicate');
  const same = await routeUpload('t-a', VIN_A, { ...body, file_url: 'https://files.example.invalid/one.jpg' });
  assert.equal(same.body.id, first.body.id, 'the same remote object under the same key is one upload');
});

test('ROUTE: the metadata key mirror is server-owned — a client cannot plant a key it did not send', async () => {
  const planted = await routeUpload('t-a', VIN_A, { evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', file: jpeg(44), metadata: { idempotency_key: 'someone-elses-key' } });
  assert.equal(planted.status, 201, planted.text.slice(0, 300));
  const row = world.rows('vehicle_evidence').find((r) => r.id === planted.body.id);
  assert.equal(row.metadata?.idempotency_key, undefined, 'the client-supplied mirror was removed');
});

test('ROUTE: contradictory dual locators are refused before anything is stored', async () => {
  const res = await routeUpload('t-a', VIN_A, {
    evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', mime_type: 'image/jpeg',
    file_url: 'https://files.example.invalid/a.jpg', file_path: `${VIN_A}/b.jpg`,
  });
  assert.equal(res.status, 400, res.text.slice(0, 300));
  assert.match(res.text, /describe different objects/);
});
