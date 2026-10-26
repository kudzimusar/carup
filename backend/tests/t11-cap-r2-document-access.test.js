/**
 * T11-CAP-LR01-R2 step H — open one of MY documents.
 *
 *   GET /api/diaspora/documents/:id/access
 *   GET /api/diaspora/trade-documents/:id/access        (?disposition=view|download)
 *
 * These are RUNTIME tests: they mount the real Diaspora router behind the real `authorizeRole()` / `requireProvenIdentity()` and the real error
 * middleware and drive it over HTTP. Only the external boundaries are mocked — the Supabase client and Supabase Storage.
 *
 * What is held:
 *   1. WHO. The order's owner (buyer or creator), the person who uploaded the file, and the platform roles may open it. A participant, a
 *      supplier, a tenant administrator and an unrelated user may NOT — even though T8's record-read rule admits some of them — and every
 *      refusal is the same 404 as a document that does not exist.
 *   2. PROVEN IDENTITY. The route mints a capability for a private object, so a header-asserted identity is refused before anything is signed.
 *   3. NOTHING ABOUT WHERE THE FILE LIVES. The response carries a link and its expiry — never the path, the bucket, the uploader or the reviewer.
 *   4. SHORT-LIVED, UNCACHED, AUDITED. Five minutes; `Cache-Control: private, no-store`; one audit entry naming the person and the document but
 *      never the link; and an access that cannot be audited does not return a link.
 *   5. HONEST ABOUT REVIEW. Opening a file is never presented as CarUp having checked it.
 *   6. FAILURES ARE FAILURES. A signing fault is a 503 and records no access.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
// This harness authenticates through the `x-user-id` fallback, which `requireProvenIdentity()` refuses unless a harness opts in EXPLICITLY.
// The opt-in is the flag below; the refusal test turns it off again for its own duration.
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';

const SIGNED_URL_PREFIX = 'https://signed.example.test/';
const STORAGE_PATH = 'order-1/bill_of_lading_5f3a9c.pdf';

let state;
function reset() {
  state = {
    users: {
      'buyer-1': { role: 'owner' },
      'creator-1': { role: 'member' },
      'uploader-2': { role: 'member' },
      'participant-1': { role: 'member' },
      'supplier-1': { role: 'member' },
      'tenantadmin-1': { role: 'member' },
      'unrelated-1': { role: 'member' },
      'gov-1': { role: 'government_reviewer' },
      'admin-9': { role: 'platform_admin' },
      // `admin` is a tenant-scoped word in T8: it reads a tenant's documents only WITH a tenant context. It is not a reviewer role.
      'plainadmin-1': { role: 'admin' },
    },
    tenantUsers: { 'tenant-1|tenantadmin-1': { role: 'admin' } },
    documents: {
      'doc-bl': { id: 'doc-bl', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'bill_of_lading', storage_path: STORAGE_PATH, verification_status: 'VERIFIED', uploaded_by: 'buyer-1', reviewed_by: 'reviewer-secret', version: 2, created_at: '2026-10-25T05:14:43Z', metadata: {} },
      'doc-inv': { id: 'doc-inv', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'commercial_invoice', storage_path: 'order-1/commercial_invoice_77.png', verification_status: 'UPLOADED', uploaded_by: 'buyer-1', version: 1, created_at: '2026-10-25T05:15:00Z', metadata: {} },
      'doc-rej': { id: 'doc-rej', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'export_certificate', storage_path: 'order-1/export_certificate_9.pdf', verification_status: 'REJECTED', uploaded_by: 'buyer-1', version: 1, created_at: '2026-10-25T05:16:00Z', metadata: {} },
      // A document the buyer did NOT upload: a supplier uploaded it to the buyer's order. The buyer opens it as the OWNER, not as the uploader.
      'doc-bysupplier': { id: 'doc-bysupplier', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'export_certificate', storage_path: 'order-1/export_certificate_by_supplier.pdf', verification_status: 'UPLOADED', uploaded_by: 'supplier-1', version: 1, metadata: {} },
      // A file whose name ends in an upper-case extension.
      'doc-upper': { id: 'doc-upper', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'bill_of_lading', storage_path: 'order-1/bill_of_lading_SCAN.PDF', verification_status: 'UPLOADED', uploaded_by: 'buyer-1', version: 1, metadata: {} },
      'doc-nofile': { id: 'doc-nofile', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'packing_list', storage_path: null, verification_status: 'UPLOADED', uploaded_by: 'buyer-1', version: 1, metadata: {} },
      'doc-gone': { id: 'doc-gone', tenant_id: 'tenant-1', import_order_id: 'order-1', document_type: 'bill_of_lading', storage_path: STORAGE_PATH, verification_status: 'UPLOADED', uploaded_by: 'buyer-1', deleted_at: '2026-10-26T00:00:00Z', metadata: {} },
      // Somebody else's upload to somebody else's order, where uploader-2 is the uploader but not the owner.
      'doc-theirs': { id: 'doc-theirs', tenant_id: 'tenant-1', import_order_id: 'order-2', document_type: 'bill_of_lading', storage_path: 'order-2/bill_of_lading_1.pdf', verification_status: 'UPLOADED', uploaded_by: 'uploader-2', version: 1, metadata: {} },
      // An upload tied to no order at all, by its uploader.
      'doc-loose': { id: 'doc-loose', tenant_id: 'tenant-1', import_order_id: null, document_type: 'packing_list', storage_path: 'loose/packing_list_2.pdf', verification_status: 'UPLOADED', uploaded_by: 'uploader-2', version: 1, metadata: {} },
    },
    orders: {
      'order-1': { id: 'order-1', tenant_id: 'tenant-1', buyer_id: 'buyer-1', created_by: 'creator-1', status: 'DOCUMENTS_PENDING' },
      'order-2': { id: 'order-2', tenant_id: 'tenant-1', buyer_id: 'someone-else', created_by: 'someone-else', status: 'DOCUMENTS_PENDING' },
    },
    participants: { 'order-1': [{ id: 'pp1', import_order_id: 'order-1', user_id: 'participant-1', verification_status: 'active', deleted_at: null }] },
    quotes: { 'order-1': ['supplier-1'] },
    signArgs: [],
    createSignedUrl: async (path, ttl, options) => ({ data: { signedUrl: `${SIGNED_URL_PREFIX}${encodeURIComponent(path)}?token=t0k3n${options ? `&download=${encodeURIComponent(options.download)}` : ''}` }, error: null }),
    auditError: null,
    calls: [],
  };
}

function builder(table) {
  const q = { table, op: 'select', payload: undefined, filters: {}, single: false };
  const chain = {
    select() { return chain; },
    insert(p) { q.op = 'insert'; q.payload = p; return chain; },
    update(p) { q.op = 'update'; q.payload = p; return chain; },
    delete() { q.op = 'delete'; return chain; },
    eq(k, v) { q.filters[k] = v; return chain; },
    neq() { return chain; },
    is() { return chain; },
    order() { return chain; },
    range() { return chain; },
    limit() { return chain; },
    single() { q.single = true; return chain; },
    maybeSingle() { q.single = true; return chain; },
    then(resolve, reject) {
      let result;
      try { result = resolve_(q); } catch (e) { return reject ? reject(e) : Promise.reject(e); }
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}

function resolve_(q) {
  state.calls.push({ table: q.table, op: q.op, payload: q.payload, filters: { ...q.filters } });
  const { table, op, filters } = q;
  switch (table) {
    case 'user_sessions': return { data: null, error: { message: 'no session (the harness uses the x-user-id fallback)' } };
    case 'users': { const row = state.users[filters.id]; return row ? { data: row, error: null } : { data: null, error: { message: 'user not found' } }; }
    case 'tenant_users': { const row = state.tenantUsers[`${filters.tenant_id}|${filters.user_id}`]; return row ? { data: row, error: null } : { data: null, error: { message: 'no membership' } }; }
    case 'diaspora_trade_documents': {
      const doc = state.documents[filters.id];
      return doc && !doc.deleted_at ? { data: doc, error: null } : { data: null, error: { message: 'document not found' } };
    }
    case 'diaspora_import_orders': { const o = state.orders[filters.id]; return o ? { data: o, error: null } : { data: null, error: { message: 'order not found' } }; }
    case 'diaspora_import_order_participants': return { data: state.participants[filters.import_order_id] || [], error: null };
    case 'diaspora_import_quotes': {
      const mine = (state.quotes[filters.import_order_id] || []).includes(filters.seller_id);
      return { data: mine ? { id: 'q1' } : null, error: null };
    }
    case 'diaspora_import_audit_log':
      if (op === 'insert' && state.auditError) return { data: null, error: { message: state.auditError } };
      return q.single ? { data: { id: 'audit-1', ...(q.payload || {}) }, error: null } : { data: [], error: null };
    default:
      if (q.single) return { data: {}, error: null };
      return { data: [], error: null };
  }
}

let server;
let baseUrl;
before(async () => {
  reset();
  const { supabase } = await import('../db/supabase.js');
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (table) => builder(table) });
  Object.defineProperty(supabase, 'storage', {
    configurable: true,
    writable: true,
    value: { from: (bucket) => ({ createSignedUrl: (...args) => { state.signArgs.push({ bucket, args }); return state.createSignedUrl(...args); } }) },
  });
  const express = (await import('express')).default;
  const diasporaRoutes = (await import('../routes/diasporaRoutes.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRoutes);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(() => reset());

async function open(docId, { userId, tenantId, query = '', path = 'documents' } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}/api/diaspora/${path}/${docId}/access${query}`, { headers });
  const raw = await res.text();
  let body; try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: res.status, body, raw, headers: res.headers };
}

// The real error middleware wraps every error as { success:false, error:{ code, message, requestId, timestamp } }.
const refusal = (r) => ({ status: r.status, code: r.body?.error?.code, message: r.body?.error?.message });
const NOT_FOUND = { status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Document not found' };
const signed = () => state.signArgs;
const audits = () => state.calls.filter((c) => c.table === 'diaspora_import_audit_log' && c.op === 'insert');

function assertNothingAboutStorage(raw) {
  for (const leaked of [STORAGE_PATH, 'storage_path', 'ocr-documents', 'uploaded_by', 'reviewed_by', 'reviewer-secret', 'signedUrl', 'tenant_id', 'private_storage']) {
    assert.ok(!raw.includes(leaked), `the response named where or by whom the file is held: ${leaked}`);
  }
}

// ═══════════════════════════ 1. WHO ═══════════════════════════

test('H1: the order\'s buyer opens their document — a link, its expiry, the review state, and nothing about where it lives', async () => {
  const r = await open('doc-bl', { userId: 'buyer-1' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const { document, view, note } = r.body.data;
  assert.ok(view.href.startsWith(SIGNED_URL_PREFIX), 'no link');
  assert.equal(view.disposition, 'view');
  assert.ok(!Number.isNaN(Date.parse(view.expires_at)) && Date.parse(view.expires_at) > Date.now(), 'the link has no future expiry');
  assert.deepEqual(Object.keys(view).sort(), ['disposition', 'expires_at', 'href']);
  assert.deepEqual(Object.keys(document).sort(), ['document_type', 'id', 'review_note', 'review_state', 'supplied_at', 'version']);
  assert.deepEqual([document.id, document.document_type, document.version, document.review_state], ['doc-bl', 'bill_of_lading', 2, 'verified']);
  assert.match(note, /does not mean CarUp has checked it/i);
  // The link itself necessarily contains the object's name; no FIELD does.
  const { href, ...withoutLink } = view;
  assert.ok(href);
  assertNothingAboutStorage(JSON.stringify({ ...r.body, data: { ...r.body.data, view: withoutLink } }));
});

test('H2: both route spellings exist, and the order\'s creator, the uploader, a government reviewer and a platform admin are admitted too', async () => {
  for (const [who, path, doc] of [
    ['buyer-1', 'trade-documents', 'doc-bl'], ['creator-1', 'documents', 'doc-bl'], ['uploader-2', 'documents', 'doc-theirs'],
    ['gov-1', 'documents', 'doc-bl'], ['admin-9', 'trade-documents', 'doc-theirs'], ['uploader-2', 'documents', 'doc-loose'],
  ]) {
    const r = await open(doc, { userId: who, path });
    assert.equal(r.status, 200, `${who} could not open ${doc} via ${path}: ${r.raw.slice(0, 160)}`);
  }
});

test('H2b: the buyer and the creator open a document THEY did not upload — ownership of the order is enough, uploading is not required', async () => {
  for (const who of ['buyer-1', 'creator-1']) {
    const r = await open('doc-bysupplier', { userId: who });
    assert.equal(r.status, 200, `${who} (an owner, not the uploader) was refused: ${r.raw.slice(0, 160)}`);
  }
  // …and the supplier who uploaded it can open their own upload, but not the buyer's other documents.
  assert.equal((await open('doc-bysupplier', { userId: 'supplier-1' })).status, 200);
  assert.deepEqual(refusal(await open('doc-bl', { userId: 'supplier-1' })), NOT_FOUND);
});

test('H3: a participant, a supplier, a tenant administrator and an unrelated user are NOT admitted — the same 404 as a document that does not exist', async () => {
  const missing = await open('does-not-exist', { userId: 'unrelated-1' });
  assert.deepEqual(refusal(missing), NOT_FOUND);
  for (const [who, tenantId] of [['participant-1'], ['supplier-1'], ['tenantadmin-1', 'tenant-1'], ['unrelated-1'], ['uploader-2'], ['plainadmin-1']]) {
    const r = await open('doc-bl', { userId: who, tenantId });
    assert.deepEqual(refusal(r), NOT_FOUND, `${who} was admitted or got a distinguishable refusal (${r.status})`);
  }
  assert.equal(signed().length, 0, 'a link was minted for a refused caller');
  assert.equal(audits().length, 0, 'a refused caller left an access record');
});

test('H4: owning ONE order opens no other — a buyer is refused another buyer\'s document, and an uploader of another order\'s file gets only their own', async () => {
  assert.deepEqual(refusal(await open('doc-theirs', { userId: 'buyer-1' })), NOT_FOUND);
  assert.deepEqual(refusal(await open('doc-bl', { userId: 'uploader-2' })), NOT_FOUND);
  assert.equal((await open('doc-theirs', { userId: 'uploader-2' })).status, 200);
});

test('H5: a deleted document and one with no file are not openable — and "no file" is said only to someone who may have opened it', async () => {
  assert.deepEqual(refusal(await open('doc-gone', { userId: 'buyer-1' })), NOT_FOUND);
  const owner = await open('doc-nofile', { userId: 'buyer-1' });
  assert.equal(owner.status, 404);
  assert.match(owner.body.error.message, /no file to open/i);
  const stranger = await open('doc-nofile', { userId: 'unrelated-1' });
  assert.deepEqual(refusal(stranger), NOT_FOUND, 'a stranger learned that the document exists but has no file');
  // A participant passes T8's record rule (so reaches the second gate) but is not an owner: they must not learn it either.
  const participant = await open('doc-nofile', { userId: 'participant-1' });
  assert.deepEqual(refusal(participant), NOT_FOUND, 'a participant learned that the document exists but has no file');
});

// ═══════════════════════════ 2. PROVEN IDENTITY ═══════════════════════════

test('H6: no identity is 401; a header-ASSERTED identity is 401 and nothing is signed', async () => {
  assert.equal((await open('doc-bl', {})).status, 401);
  const before = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'false';
  try {
    const asserted = await open('doc-bl', { userId: 'buyer-1' });
    assert.equal(asserted.status, 401);
    assert.match(asserted.raw, /real session/i);
    assertNothingAboutStorage(asserted.raw);
  } finally { process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = before; }
  assert.equal(signed().length, 0, 'a link was minted for an asserted identity');
  assert.equal(audits().length, 0);
});

// ═══════════════════════════ 3. SHORT-LIVED, DOWNLOAD, AUDITED ═══════════════════════════

test('H7: a link lasts five minutes; "view" asks the signer for nothing special and "download" asks for a named attachment', async () => {
  await open('doc-bl', { userId: 'buyer-1' });
  assert.deepEqual(signed()[0], { bucket: 'ocr-documents', args: [STORAGE_PATH, 300] }, 'a view must be signed exactly as before, for five minutes');
  reset();
  const d = await open('doc-bl', { userId: 'buyer-1', query: '?disposition=download' });
  assert.equal(d.status, 200);
  assert.equal(d.body.data.view.disposition, 'download');
  assert.deepEqual(signed()[0], { bucket: 'ocr-documents', args: [STORAGE_PATH, 300, { download: 'Bill of lading.pdf' }] });
  reset();
  await open('doc-inv', { userId: 'buyer-1', query: '?disposition=download' });
  assert.deepEqual(signed()[0].args[2], { download: 'Commercial invoice.png' }, 'the attachment is not named after the extension of the file');
  reset();
  await open('doc-loose', { userId: 'uploader-2', query: '?disposition=download' });
  assert.deepEqual(signed()[0].args[2], { download: 'Packing list.pdf' });
  reset();
  await open('doc-upper', { userId: 'buyer-1', query: '?disposition=download' });
  assert.deepEqual(signed()[0].args[2], { download: 'Bill of lading.pdf' }, 'the attachment keeps the file\'s upper-case extension');
});

test('H8: an unknown disposition is refused before anything is signed', async () => {
  for (const bad of ['?disposition=inline', '?disposition=', '?disposition=DOWNLOAD', '?disposition=view;rm']) {
    const r = await open('doc-bl', { userId: 'buyer-1', query: bad });
    assert.equal(r.status, 400, `${bad} was accepted`);
  }
  assert.equal(signed().length, 0);
});

test('H9: every access is audited — the person, the document, the kind of access — and the audit never holds the link', async () => {
  await open('doc-bl', { userId: 'buyer-1' });
  await open('doc-bl', { userId: 'admin-9', query: '?disposition=download' });
  const [a, b] = audits();
  assert.equal(audits().length, 2);
  assert.deepEqual([a.payload.action, a.payload.actor_id, a.payload.resource_type, a.payload.resource_id, a.payload.import_order_id], ['TRADE_DOCUMENT_ACCESSED', 'buyer-1', 'diaspora_trade_document', 'doc-bl', 'order-1']);
  assert.deepEqual(a.payload.metadata, { document_type: 'bill_of_lading', version: 2, disposition: 'view', ttl_seconds: 300 });
  assert.equal(b.payload.actor_id, 'admin-9');
  assert.equal(b.payload.metadata.disposition, 'download');
  for (const entry of [a, b]) {
    const text = JSON.stringify(entry.payload);
    assert.ok(!text.includes(SIGNED_URL_PREFIX) && !text.includes('t0k3n') && !text.includes(STORAGE_PATH), 'the audit entry holds the link or the path');
  }
});

test('H10: an access that cannot be audited does not return a link', async () => {
  state.auditError = 'audit table unavailable';
  const r = await open('doc-bl', { userId: 'buyer-1' });
  assert.ok(r.status >= 500, `status ${r.status}`);
  assert.ok(!r.raw.includes(SIGNED_URL_PREFIX) && !r.raw.includes('t0k3n'), 'the link leaked although the access could not be recorded');
  assertNothingAboutStorage(r.raw);
});

test('H11: a signing fault is a 503, records no access, and says nothing about the storage', async () => {
  state.createSignedUrl = async () => ({ data: null, error: { message: 'bucket ocr-documents unreachable at s3.internal' } });
  const r = await open('doc-bl', { userId: 'buyer-1' });
  assert.equal(r.status, 503);
  assert.match(r.body.error.message, /could not be opened right now/i);
  assert.equal(r.body.error.code, 'DOCUMENT_UNAVAILABLE');
  assert.ok(!/s3\.internal|ocr-documents|unreachable/.test(r.raw), 'the storage fault leaked');
  assert.equal(audits().length, 0, 'an access that did not happen was recorded');
  state.createSignedUrl = async () => ({ data: { signedUrl: '' }, error: null });
  assert.equal((await open('doc-bl', { userId: 'buyer-1' })).status, 503, 'an empty link was returned as success');
});

// ═══════════════════════════ 4. HONEST ABOUT REVIEW ═══════════════════════════

test('H12: opening a file is never "verified" unless it was — the review state is the document\'s own', async () => {
  const states = {};
  for (const id of ['doc-bl', 'doc-inv', 'doc-rej']) {
    const r = await open(id, { userId: 'buyer-1' });
    states[id] = [r.body.data.document.review_state, r.body.data.document.review_note];
  }
  assert.equal(states['doc-bl'][0], 'verified');
  assert.equal(states['doc-inv'][0], 'not_verified');
  assert.match(states['doc-inv'][1], /CarUp has not verified/i);
  assert.equal(states['doc-rej'][0], 'rejected');
  for (const flagged of ['FLAGGED', 'OCR_EXTRACTED', 'PENDING_REVIEW', undefined]) {
    state.documents['doc-inv'].verification_status = flagged;
    const r = await open('doc-inv', { userId: 'buyer-1' });
    assert.notEqual(r.body.data.document.review_state, 'verified', `${flagged} was shown as verified`);
  }
});

// ═══════════════════════════ 5. THE ENUMERATION RULE STILL HOLDS ═══════════════════════════

test('H13: the route composes a PROVEN identity, and the T8 read route is unchanged', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'diasporaRoutes.js'), 'utf8');
  assert.match(text, /router\.get\('\/documents\/:id\/access', auth, requireProvenIdentity\(\)/);
  assert.match(text, /router\.get\('\/trade-documents\/:id\/access', auth, requireProvenIdentity\(\)/);
  assert.match(text, /router\.get\('\/documents\/:id', auth, asyncHandler\(async \(req, res\) => res\.json\(await getTradeDocument\(/);
  // the record route still redacts: it never carried a path and still does not
  const record = await fetch(`${baseUrl}/api/diaspora/documents/doc-bl`, { headers: { 'x-user-id': 'buyer-1' } });
  const raw = await record.text();
  assert.equal(record.status, 200);
  assert.ok(!raw.includes(STORAGE_PATH) && !raw.includes('storage_path'), 'the record route began to carry the storage path');
});
