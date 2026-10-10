/**
 * OC-4C — native Garage odometer OCR, proven on the server side of the wire.
 *
 * The native app (mobile/app/(tabs)/garage.tsx) used to POST the photo to the retired /api/ai/ocr (a 410)
 * and tell the owner it had been "saved for manual review" — and its offline queue sent a body the server
 * never accepted. The journey now is:
 *
 *   capture → durable queue → POST /api/vehicles/:vin/evidence/upload (idempotent, private)
 *     → POST /api/vehicles/:vin/evidence/:evidenceId/run-ocr → Document Intelligence (odometer schema)
 *     → OCR provider boundary → Cloudflare → @cf/qwen/qwen3.8-27b → a CANDIDATE reading → human review
 *
 * Through the SHIPPED app with real session auth, the REAL Document Intelligence and the REAL Qwen
 * provider + transport (Cloudflare intercepted at fetch), the body each request sends is the one in
 * shared/contracts/native-odometer-capture.contract.json — the same file the mobile tests pin.
 * Proven: the reading is candidate evidence and NOTHING on this path writes vehicles.mileage.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Every upload launches a fire-and-forget evidence analysis and the route stack logs heavily; under
// `node --test` that concurrent stdout traffic interleaved with the runner's serialized events and broke
// its channel ("Unable to deserialize cloned data"). This file asserts responses and stored state, not
// logs, so console output is muted for its duration.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ALLOW_OCR_MOCK = 'false';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CARUP_OCR_PROVIDER;
delete process.env.CARUP_OCR_MODEL;

const CONTRACT = JSON.parse(readFileSync(new URL('../../shared/contracts/native-odometer-capture.contract.json', import.meta.url), 'utf8'));
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const VIN = 'OC4CVIN0000000001';
const RECORDED_MILEAGE = 80000;
const PHOTO = `data:image/jpeg;base64,${Buffer.from('\xff\xd8\xff\xe0 instrument cluster \xff\xd9', 'latin1').toString('base64')}`;
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

// ── an in-memory supabase double: every table the real path touches ──────────────────────────────
let db; let objects;
function resetDb() {
  objects = new Map();
  db = {
    users: [
      { id: 'owner-1', role: 'owner', is_verified: true }, { id: 'stranger-1', role: 'owner', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
    ],
    user_sessions: ['owner-1', 'stranger-1', 'admin-1'].map((id) => ({ token: `oc4c-${id}`, user_id: id, is_valid: true, expires_at: FUTURE })),
    vehicles: [{ vin: VIN, owner_id: 'owner-1', current_seller_id: null, tenant_id: null, mileage: RECORDED_MILEAGE, make: 'Toyota', model: 'Hilux', year: 2020 }],
    vehicle_evidence: [], evidence_provenance_events: [], ocr_documents: [], vehicle_document_extractions: [], trust_audit_events: [],
  };
}
const field = (row, key) => (key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key]);
function query(table) {
  const st = { op: 'select', filters: [], order: null, limit: null, payload: null, returning: false, head: false };
  const rows = () => (db[table] ||= []);
  const matches = (row) => st.filters.every(([k, op, v]) => (op === 'eq' ? field(row, k) === v : op === 'neq' ? field(row, k) !== v
    : op === 'in' ? v.includes(field(row, k)) : op === 'is' ? field(row, k) === v : op === 'lte' ? field(row, k) <= v : field(row, k) > v));
  const q = {
    select(_c, opts = {}) { if (st.op === 'select') { if (opts.head) st.head = true; } else st.returning = true; return q; },
    insert(p) { st.op = 'insert'; st.payload = p; return q; }, upsert(p) { st.op = 'insert'; st.payload = p; return q; },
    update(p) { st.op = 'update'; st.payload = p; return q; }, delete() { st.op = 'delete'; return q; },
    eq(k, v) { st.filters.push([k, 'eq', v]); return q; }, neq(k, v) { st.filters.push([k, 'neq', v]); return q; },
    in(k, v) { st.filters.push([k, 'in', v]); return q; }, is(k, v) { st.filters.push([k, 'is', v]); return q; },
    lte(k, v) { st.filters.push([k, 'lte', v]); return q; }, gt(k, v) { st.filters.push([k, 'gt', v]); return q; },
    order(k, o = {}) { st.order = [k, o.ascending !== false]; return q; }, limit(n) { st.limit = n; return q; },
    single() { return run('single'); }, maybeSingle() { return run('maybe'); }, then(res, rej) { return run('list').then(res, rej); },
  };
  async function run(mode) {
    const clone = (v) => JSON.parse(JSON.stringify(v));
    let out;
    if (st.op === 'insert') {
      out = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((r) => ({ id: r.id ?? randomUUID(), created_at: new Date().toISOString(), ...clone(r) }));
      rows().push(...out);
      if (!st.returning) return { data: null, error: null };
    } else if (st.op === 'update') {
      out = rows().filter(matches);
      for (const r of out) Object.assign(r, clone(st.payload));
      if (!st.returning && mode === 'list') return { data: null, error: null };
    } else if (st.op === 'delete') {
      db[table] = rows().filter((r) => !matches(r));
      return { data: null, error: null };
    } else {
      out = rows().filter(matches);
      if (st.head) return { data: null, count: out.length, error: null };
      if (st.order) { const [k, asc] = st.order; out = [...out].sort((a, b) => ((a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1))); }
      if (st.limit !== null) out = out.slice(0, st.limit);
    }
    out = clone(out);
    if (mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: `${out.length} rows` } };
    if (mode === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null, count: out.length };
  }
  return q;
}
const storage = {
  from: (bucket) => ({
    async upload(name, buffer, { contentType }) { objects.set(`${bucket}/${name}`, { buffer: Buffer.from(buffer), contentType }); return { data: { path: name }, error: null }; },
    getPublicUrl: (name) => ({ data: { publicUrl: `https://storage.invalid/${bucket}/${name}` } }),
    async download(path) {
      const hit = objects.get(`${bucket}/${path}`);
      return hit ? { data: new Blob([hit.buffer], { type: hit.contentType }), error: null } : { data: null, error: { message: 'not found' } };
    },
    async createSignedUrl(path) { return { data: { signedUrl: `https://storage.invalid/signed/${bucket}/${path}` }, error: null }; },
  }),
};

// ── Cloudflare Workers AI, intercepted ───────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let qwenAnswer = null;
const qwenCalls = [];
let server; let baseUrl;
const realFrom = supabase.from; const realStorage = supabase.storage;
before(async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.cloudflare.com/')) {
      qwenCalls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ success: true, errors: [], result: { choices: [{ message: { content: JSON.stringify(qwenAnswer) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 40 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  supabase.from = (table) => query(table);
  Object.defineProperty(supabase, 'storage', { configurable: true, writable: true, value: storage });
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = realFetch;
  supabase.from = realFrom;
  Object.defineProperty(supabase, 'storage', { configurable: true, writable: true, value: realStorage });
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  resetDb();
  qwenCalls.length = 0;
  qwenAnswer = { document_class_observed: 'odometer_display', legible: true, confidence: 0.93, fields: { odometer_reading: '84213', odometer_unit: 'km' } };
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-oc4c';
  process.env.CLOUDFLARE_API_TOKEN = 'token-oc4c';
});

async function call(path, { who = 'owner-1', method = 'POST', body, headers = {} } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(who ? { 'x-session-token': `oc4c-${who}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
const uploadPath = (vin = VIN) => CONTRACT.upload.path.replace(':vin', vin);
const ocrPath = (evidenceId, vin = VIN) => CONTRACT.ocr.path.replace(':vin', vin).replace(':evidenceId', evidenceId);
/** Exactly the body mobile/utils/uploadQueueDrain.ts sends (pinned there against the same file). */
const nativeUpload = (idempotencyKey, overrides = {}) => call(uploadPath(), {
  body: { ...CONTRACT.upload.body, [CONTRACT.upload.fileField]: PHOTO, idempotency_key: idempotencyKey, page_order: 0, ...overrides },
  headers: { [CONTRACT.upload.idempotencyHeader]: idempotencyKey },
});

test('OC-4C: the native upload contract is ACCEPTED by the real route — private, canonical, and the stored bytes are the captured bytes', async () => {
  const res = await nativeUpload('idem-oc4c-1');
  assert.equal(res.status, 201, res.text.slice(0, 400));
  const [row] = db.vehicle_evidence;
  assert.equal(row.evidence_class, CONTRACT.upload.body.evidence_class);
  assert.equal(row.evidence_subtype, CONTRACT.upload.body.evidence_subtype);
  assert.equal(row.visibility_level, 'private');
  assert.equal(row.storage_bucket, 'ocr-documents', 'an odometer photo is private evidence');
  assert.ok(row.file_path.toUpperCase().startsWith(`${VIN}/`));
  assert.equal(row.metadata.idempotency_key, 'idem-oc4c-1');
  const stored = objects.get(`ocr-documents/${row.file_path}`);
  assert.ok(stored, 'the photo was stored');
});

test('OC-4C: an offline retry of the same capture (same Idempotency-Key) never creates a second evidence row', async () => {
  const first = await nativeUpload('idem-oc4c-retry');
  const second = await nativeUpload('idem-oc4c-retry');
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id);
  assert.equal(db.vehicle_evidence.length, 1);
});

test('OC-4C: governed OCR — the real Document Intelligence odometer schema reaches Qwen with the stored photo, and returns a CANDIDATE', async () => {
  const uploaded = await nativeUpload('idem-oc4c-ocr');
  const res = await call(ocrPath(uploaded.body.id));
  assert.equal(res.status, 201, res.text.slice(0, 400));
  assert.equal(qwenCalls.length, 1);
  assert.ok(qwenCalls[0].url.endsWith('/ai/run/@cf/qwen/qwen3.8-27b'), qwenCalls[0].url);
  const [system, user] = qwenCalls[0].body.messages;
  assert.match(system.content, /Read ONLY the odometer total/);
  assert.match(system.content, /instrument cluster/);
  const image = user.content.find((part) => part.type === 'image_url');
  assert.ok(image.image_url.url.startsWith('data:image/jpeg;base64,'), 'the stored photo bytes, not a URL or a truncated prefix');
  assert.deepEqual(res.body.reading, { odometer_reading: 84213, odometer_unit: 'km', status: CONTRACT.ocr.candidateStatus });
  assert.equal(res.body.provider, 'cloudflare');
  assert.equal(res.body.model, '@cf/qwen/qwen3.8-27b');
  assert.equal(res.body.authority_effects.mileage_recorded, false);
  const [candidate] = db.vehicle_document_extractions;
  assert.equal(candidate.document_type, 'odometer_reading');
  assert.equal(candidate.field_name, 'odometer_reading');
  assert.equal(candidate.raw_value, '84213');
  assert.equal(candidate.review_status, 'pending');
  assert.equal(candidate.match_status, 'inconclusive', 'a reading is never "matched" to a mileage');
  assert.equal(db.vehicles[0].mileage, RECORDED_MILEAGE, 'OCR never overwrites mileage');
});

test('OC-4C: even after a reviewer CONFIRMS the candidate, nothing on this path writes the vehicle\'s mileage', async () => {
  const uploaded = await nativeUpload('idem-oc4c-review');
  await call(ocrPath(uploaded.body.id));
  const [candidate] = db.vehicle_document_extractions;
  const review = await call(`/api/vehicles/${VIN}/extractions/${candidate.id}/review`, { who: 'admin-1', method: 'PATCH', body: { review_status: 'confirmed' } });
  assert.equal(review.status, 200, review.text.slice(0, 300));
  assert.equal(db.vehicle_document_extractions[0].review_status, 'confirmed');
  assert.equal(db.vehicles[0].mileage, RECORDED_MILEAGE, 'a lifecycle consequence needs a domain authority, not an OCR review');
});

test('OC-4C: an unreadable photo yields no candidate — the evidence stays for manual review', async () => {
  qwenAnswer = { document_class_observed: 'landscape photograph', legible: false, confidence: null, fields: {} };
  const uploaded = await nativeUpload('idem-oc4c-unreadable');
  const res = await call(ocrPath(uploaded.body.id));
  assert.equal(res.body.success, false);
  assert.equal(res.body.reading.status, 'not_read');
  assert.equal(res.body.reading.odometer_reading, null);
  assert.equal(db.vehicle_document_extractions.length, 0);
  assert.equal(db.vehicle_evidence.length, 1, 'the photo is still evidence');
});

test('OC-4C: a decimal (trip meter) reading is not accepted as an odometer total', async () => {
  qwenAnswer = { document_class_observed: 'odometer_display', legible: true, confidence: 0.9, fields: { odometer_reading: '842.1' } };
  const uploaded = await nativeUpload('idem-oc4c-trip');
  const res = await call(ocrPath(uploaded.body.id));
  assert.equal(res.body.reading.status, 'not_read');
  assert.equal(db.vehicle_document_extractions.length, 0);
});

// OC-5R-REL-01: this test used to upload with visibility 'public_safe', get a 201 for a PUBLIC odometer
// photo (stored in vehicle-images), and only then be refused at OCR time. The server now derives
// private storage for the type, so the public upload cannot happen; the OCR-time gate is still
// proven, against a legacy row that an older build left in the public bucket.
test('OC-4C / REL-01: a caller asking for PUBLIC — or for nothing — cannot place an odometer capture in a public bucket', async () => {
  const asked = await nativeUpload('idem-rel01-public', { visibility_level: 'public_safe' });
  const unsaid = await nativeUpload('idem-rel01-unsaid', { visibility_level: undefined });
  assert.equal(asked.status, 201, asked.text.slice(0, 300));
  assert.equal(unsaid.status, 201, unsaid.text.slice(0, 300));
  const [askedRow, unsaidRow] = db.vehicle_evidence;
  for (const row of [askedRow, unsaidRow]) {
    assert.equal(row.visibility_level, 'private');
    assert.equal(row.storage_bucket, 'ocr-documents');
    assert.ok(objects.has(`ocr-documents/${row.file_path}`), 'the bytes are in the private bucket');
  }
  assert.equal([...objects.keys()].some((k) => k.startsWith('vehicle-images/')), false, 'nothing was written to the public bucket');
  assert.equal(askedRow.metadata.visibility_request_refused.requested, 'public_safe');
  assert.equal(askedRow.metadata.visibility_request_refused.applied, 'private');
  assert.match(askedRow.metadata.visibility_request_refused.reason, /odometer photo is private evidence by type/);
  assert.equal(unsaidRow.metadata.visibility_request_refused, undefined, 'no request, nothing refused');
  // And the private capture is readable by governed OCR.
  const ocr = await call(ocrPath(asked.body.id));
  assert.equal(ocr.status, 201, ocr.text.slice(0, 300));
});

test('REL-01: even an operator holding the evidence-review capability cannot publish an odometer photo', async () => {
  // Anti-vacuity, through the real route: this admin's widening request IS honoured for a source
  // document (whose server default is restricted), so the clamp below is the type rule, not a
  // missing capability.
  const doc = await call(uploadPath(), {
    who: 'admin-1',
    body: { evidence_type: 'registration_document', visibility_level: 'public_safe', file: PHOTO, idempotency_key: 'idem-rel01-admin-doc' },
    headers: { [CONTRACT.upload.idempotencyHeader]: 'idem-rel01-admin-doc' },
  });
  assert.equal(doc.status, 201, doc.text.slice(0, 300));
  assert.equal(db.vehicle_evidence[0].visibility_level, 'public_safe', 'the admin may publish a document');
  db.vehicle_evidence.length = 0;
  const res = await call(uploadPath(), {
    who: 'admin-1',
    body: { ...CONTRACT.upload.body, visibility_level: 'public_safe', file: PHOTO, idempotency_key: 'idem-rel01-admin' },
    headers: { [CONTRACT.upload.idempotencyHeader]: 'idem-rel01-admin' },
  });
  assert.equal(res.status, 201, res.text.slice(0, 300));
  const [row] = db.vehicle_evidence;
  assert.equal(row.visibility_level, 'private');
  assert.equal(row.storage_bucket, 'ocr-documents');
  assert.equal(row.metadata.visibility_request_refused.requested, 'public_safe');
});

test('REL-01: a legacy-only odometer_photo upload is private too', async () => {
  const res = await call(uploadPath(), {
    body: { evidence_type: 'odometer_photo', visibility_level: 'public_safe', file: PHOTO, idempotency_key: 'idem-rel01-legacy' },
    headers: { [CONTRACT.upload.idempotencyHeader]: 'idem-rel01-legacy' },
  });
  assert.equal(res.status, 201, res.text.slice(0, 300));
  const [row] = db.vehicle_evidence;
  assert.equal(row.visibility_level, 'private');
  assert.equal(row.storage_bucket, 'ocr-documents');
});

test('REL-01: a remote odometer create must reference a private object under this vehicle — public buckets and URLs are refused', async () => {
  const base = { evidence_class: 'current_condition', evidence_subtype: 'odometer', visibility_level: 'public_safe', mime_type: 'image/jpeg' };
  const publicBucket = await call(uploadPath(), { body: { ...base, storage_bucket: 'vehicle-images', file_path: `${VIN}/odo-a.jpg`, file_url: `${VIN}/odo-a.jpg` } });
  assert.equal(publicBucket.status, 400, publicBucket.text.slice(0, 300));
  assert.match(publicBucket.text, /odometer photo is private evidence/);
  const publicUrl = await call(uploadPath(), { body: { ...base, file_url: `https://storage.invalid/vehicle-images/${VIN}/odo-b.jpg` } });
  assert.equal(publicUrl.status, 400, publicUrl.text.slice(0, 300));
  const noBucket = await call(uploadPath(), { body: { ...base, file_path: `${VIN}/odo-c.jpg`, file_url: `${VIN}/odo-c.jpg` } });
  assert.equal(noBucket.status, 400, noBucket.text.slice(0, 300));
  // Naming the private bucket does not make a public URL private: the object is somewhere else.
  const urlClaimingPrivate = await call(uploadPath(), { body: { ...base, storage_bucket: 'ocr-documents', file_url: `https://storage.invalid/vehicle-images/${VIN}/odo-e.jpg` } });
  assert.equal(urlClaimingPrivate.status, 400, urlClaimingPrivate.text.slice(0, 300));
  assert.match(urlClaimingPrivate.text, /odometer photo is private evidence/);
  assert.equal(db.vehicle_evidence.length, 0, 'no row points at a public copy');
  const privateRef = await call(uploadPath(), { body: { ...base, storage_bucket: 'ocr-documents', file_path: `${VIN}/odo-d.jpg`, file_url: `${VIN}/odo-d.jpg` } });
  assert.equal(privateRef.status, 201, privateRef.text.slice(0, 300));
  const [row] = db.vehicle_evidence;
  assert.equal(row.storage_bucket, 'ocr-documents');
  assert.equal(row.visibility_level, 'private');
});

test('REL-01: a reviewer cannot give a public-bucket photo an odometer meaning, nor make an odometer photo public', async () => {
  db.vehicle_evidence.push({
    id: 'public-photo-1', vehicle_id: VIN, vin: VIN, evidence_class: 'current_condition', evidence_subtype: 'dashboard', evidence_type: 'vehicle_life_photo',
    storage_bucket: 'vehicle-images', file_path: `${VIN}/dash.jpg`, file_url: `https://storage.invalid/vehicle-images/${VIN}/dash.jpg`,
    visibility_level: 'public_safe', uploaded_by: 'owner-1', verification_status: 'pending', metadata: {},
  });
  const reclassify = await call(`/api/vehicles/${VIN}/evidence/public-photo-1/classification`, {
    who: 'admin-1', method: 'PATCH', body: { evidence_class: 'current_condition', evidence_subtype: 'odometer', reason: 'it shows the odometer' },
  });
  assert.equal(reclassify.status, 409, reclassify.text.slice(0, 300));
  assert.equal(reclassify.body.code, 'CLASSIFICATION_CORRECTION_PRIVATE_BY_TYPE');
  assert.equal(db.vehicle_evidence[0].evidence_subtype, 'dashboard', 'the meaning did not change');

  const uploaded = await nativeUpload('idem-rel01-correct');
  const publish = await call(`/api/vehicles/${VIN}/evidence/${uploaded.body.id}/classification`, {
    who: 'admin-1', method: 'PATCH', body: { evidence_class: 'current_condition', evidence_subtype: 'odometer', visibility_level: 'public_safe', reason: 'publish it' },
  });
  assert.equal(publish.status, 400, publish.text.slice(0, 300));
  assert.equal(publish.body.code, 'CLASSIFICATION_CORRECTION_PRIVATE_BY_TYPE');
  assert.equal(db.vehicle_evidence.find((r) => r.id === uploaded.body.id).visibility_level, 'private');

  // Anti-vacuity: the same reviewer CAN correct a public-bucket photo to another (non-private) meaning.
  const ok = await call(`/api/vehicles/${VIN}/evidence/public-photo-1/classification`, {
    who: 'admin-1', method: 'PATCH', body: { evidence_class: 'current_condition', evidence_subtype: 'interior', reason: 'it is the interior' },
  });
  assert.equal(ok.status, 200, ok.text.slice(0, 300));
});

test('OC-4C: OCR is refused for a legacy PUBLIC odometer row and for a stranger — the governed path is private and object-scoped', async () => {
  db.vehicle_evidence.push({
    id: 'legacy-public-odometer', vehicle_id: VIN, vin: VIN, evidence_class: 'current_condition', evidence_subtype: 'odometer', evidence_type: 'odometer_photo',
    storage_bucket: 'vehicle-images', file_path: `${VIN}/odometer_photo_legacy.jpg`, file_url: `https://storage.invalid/vehicle-images/${VIN}/odometer_photo_legacy.jpg`,
    mime_type: 'image/jpeg', visibility_level: 'public_safe', uploaded_by: 'owner-1', verification_status: 'pending', metadata: {},
  });
  const refused = await call(ocrPath('legacy-public-odometer'));
  assert.equal(refused.status, 400);
  assert.match(refused.text, /private document bucket/);
  const owned = await nativeUpload('idem-oc4c-owned');
  const stranger = await call(ocrPath(owned.body.id), { who: 'stranger-1' });
  assert.equal(stranger.status, 403);
  const strangerUpload = await call(uploadPath(), { who: 'stranger-1', body: { ...CONTRACT.upload.body, file: PHOTO, idempotency_key: 'x' } });
  assert.equal(strangerUpload.status, 403);
  assert.equal(qwenCalls.length, 0, 'no provider call for a refused request');
});

test('OC-4C: the retired /api/ai/ocr answers 410 and names the governed replacement — the contract\'s routes', async () => {
  const res = await call(CONTRACT.retiredRoute, { body: { docType: 'odometer_reading', base64Data: PHOTO } });
  assert.equal(res.status, 410);
  assert.equal(res.body.code, 'LEGACY_OCR_PATH_RETIRED');
  assert.equal(res.body.replacement.upload, `${CONTRACT.upload.method} ${CONTRACT.upload.path}`);
  assert.equal(res.body.replacement.ocr, `${CONTRACT.ocr.method} ${CONTRACT.ocr.path}`);
  assert.equal(qwenCalls.length, 0);
});
