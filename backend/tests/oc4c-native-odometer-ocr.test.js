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

test('OC-4C: OCR is refused for a PUBLIC odometer photo and for a stranger — the governed path is private and object-scoped', async () => {
  const publicUpload = await nativeUpload('idem-oc4c-public', { visibility_level: 'public_safe' });
  assert.equal(publicUpload.status, 201);
  const refused = await call(ocrPath(publicUpload.body.id));
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
