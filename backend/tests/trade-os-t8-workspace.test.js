/**
 * Trade OS T8.3/T8.5 — the Documents & Evidence workspace: what it may say, and who may open it.
 *
 * The workspace is a PROJECTION. Its job is to report the truth each layer owns without collapsing
 * seven distinct facts into one green tick.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const ws = await import('../services/diaspora/tradeDocumentWorkspaceService.js');

const BUYER = 'u_buyer', SUPPLIER = 'u_supplier', RIVAL = 'u_rival', STRANGER = 'u_stranger';
const ORG = 'u_organiser', CO_A = 'u_coloader_a', CO_B = 'u_coloader_b';
const ORDER = 'order-1', SAIL = 'sail-1';
const ctx = (id) => ({ id, userId: id, role: 'owner', platformRole: 'owner', tenantId: null });

const TYPES = [
  { id: 't1', code: 'commercial_invoice', display_name: 'Commercial Invoice', verification_required: true, deleted_at: null },
  { id: 't2', code: 'packing_list', display_name: 'Packing List', verification_required: false, deleted_at: null },
  { id: 't3', code: 'bill_of_lading', display_name: 'Bill of Lading', verification_required: true, deleted_at: null },
];

const db = (over = {}) => createMockSupabase({
  trade_document_types: TYPES,
  diaspora_trade_documents: [],
  diaspora_trade_document_readiness: [],
  diaspora_import_orders: [{ id: ORDER, buyer_id: BUYER, created_by: BUYER, deleted_at: null }],
  diaspora_import_quotes: [{ id: 'q1', import_order_id: ORDER, seller_id: SUPPLIER, deleted_at: null }],
  diaspora_container_shipments: [{ id: SAIL, coordinator_id: ORG, created_by: ORG, tenant_id: null, deleted_at: null }],
  diaspora_cargo_reservations: [
    { id: 'r-a', container_id: SAIL, buyer_id: CO_A, created_by: CO_A, reservation_status: 'APPROVED', deleted_at: null },
    { id: 'r-b', container_id: SAIL, buyer_id: CO_B, created_by: CO_B, reservation_status: 'APPROVED', deleted_at: null },
  ],
  users: [{ id: BUYER }, { id: SUPPLIER }, { id: RIVAL }, { id: STRANGER }, { id: ORG }, { id: CO_A }, { id: CO_B }],
  ...over,
});
const build = (t, i, who, client) => ws.buildDocumentWorkspace(t, i, ctx(who), { supabaseClient: client });
const rowFor = (r, code) => r.items.find((x) => x.document_type === code);

// ── what the workspace may SAY ───────────────────────────────────────────────────────────────

test('nothing supplied reads MISSING — never "required", which nothing here establishes', async () => {
  const r = await build('import_order', ORDER, BUYER, db());
  assert.equal(rowFor(r, 'commercial_invoice').state, 'MISSING');
  assert.equal(r.summary.supplied, 0);
  // "requested_outstanding", not "required": T12 owns legal requirement.
  assert.ok('requested_outstanding' in r.summary);
  assert.ok(!JSON.stringify(r).match(/legally required/i));
});

test('a supplied document AWAITS REVIEW when its type requires one — it is not verified by arriving', async () => {
  const r = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [{ id: 'd1', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'UPLOADED', uploaded_by: BUYER, version: 1, deleted_at: null, superseded_at: null }],
  }));
  const row = rowFor(r, 'commercial_invoice');
  assert.equal(row.state, 'AWAITING_REVIEW');
  assert.match(row.note, /Nobody has checked it yet/);
  assert.equal(row.document.supplied_by, BUYER);
});

test('a type that needs no verdict reads PRESENT, and says CarUp does not check it', async () => {
  const r = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [{ id: 'd2', import_order_id: ORDER, document_type: 'packing_list', verification_status: 'UPLOADED', version: 1, deleted_at: null, superseded_at: null }],
  }));
  const row = rowFor(r, 'packing_list');
  assert.equal(row.state, 'PRESENT');
  assert.match(row.note, /not checked by CarUp/);
});

test('an EXTRACTION never advances the state — OCR is an observation, not a verdict', async () => {
  const r = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [{ id: 'd3', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'UPLOADED', ocr_document_id: 'ocr-1', version: 1, deleted_at: null, superseded_at: null }],
  }));
  const row = rowFor(r, 'commercial_invoice');
  assert.equal(row.state, 'AWAITING_REVIEW', 'extraction must not verify');
  assert.equal(row.document.has_extraction, true, 'but it is reported, so a reader knows it ran');
});

test('only an actual verdict reads VERIFIED or REJECTED', async () => {
  const verified = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [{ id: 'd4', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'VERIFIED', reviewed_by: 'rev-1', version: 1, deleted_at: null, superseded_at: null }],
  }));
  assert.equal(rowFor(verified, 'commercial_invoice').state, 'VERIFIED');
  const rejected = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [{ id: 'd5', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'REJECTED', reviewed_by: 'rev-1', version: 1, deleted_at: null, superseded_at: null }],
  }));
  const row = rowFor(rejected, 'commercial_invoice');
  assert.equal(row.state, 'REJECTED');
  assert.match(row.note, /corrected version can be supplied/);
});

test('a participant may say a document does not apply, and that is an ANSWER not a gap', async () => {
  const r = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_document_readiness: [{ id: 'k1', subject_type: 'import_order', subject_id: ORDER, document_type: 'bill_of_lading', readiness: 'not_applicable', deleted_at: null }],
  }));
  assert.equal(rowFor(r, 'bill_of_lading').state, 'NOT_APPLICABLE');
});

test('superseded versions never appear as current, and the row says an earlier one exists', async () => {
  const r = await build('import_order', ORDER, BUYER, db({
    diaspora_trade_documents: [
      { id: 'v1', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'VERIFIED', version: 1, deleted_at: null, superseded_at: '2026-09-01T00:00:00Z' },
      { id: 'v2', import_order_id: ORDER, document_type: 'commercial_invoice', verification_status: 'UPLOADED', version: 2, deleted_at: null, superseded_at: null },
    ],
  }));
  const row = rowFor(r, 'commercial_invoice');
  assert.equal(row.document.id, 'v2');
  assert.equal(row.state, 'AWAITING_REVIEW', 'the replacement did not inherit V1\'s verdict');
  assert.equal(row.document.has_earlier_versions, true);
});

test('the payload states the truth model in its own words', async () => {
  const r = await build('import_order', ORDER, BUYER, db());
  assert.match(r.disclaimer, /does not mean it has been checked/);
  assert.match(r.disclaimer, /does not make what it describes true/);
});

// ── §I · who may OPEN it ─────────────────────────────────────────────────────────────────────

test('POSITIVE CONTROL: real participants can open their own transaction', async () => {
  assert.equal((await build('import_order', ORDER, BUYER, db())).viewer_role, 'buyer');
  assert.equal((await build('import_order', ORDER, SUPPLIER, db())).viewer_role, 'supplier');
  assert.equal((await build('container_booking', SAIL, ORG, db())).viewer_role, 'operator');
  assert.equal((await build('container_booking', SAIL, CO_A, db())).viewer_role, 'participant');
});

test('a competing supplier who never offered cannot open the transaction', async () => {
  await assert.rejects(() => build('import_order', ORDER, RIVAL, db()), /not a participant/i);
});

test('a stranger cannot open anything', async () => {
  await assert.rejects(() => build('import_order', ORDER, STRANGER, db()), /not a participant/i);
  await assert.rejects(() => build('container_booking', SAIL, STRANGER, db()), /no booking on this sailing/i);
});

test('a forged subject kind is refused rather than guessed at', async () => {
  await assert.rejects(() => build('warehouse_receipt', 'w-1', BUYER, db()), /Unknown document workspace subject/i);
});

test('a forged subject id is a refusal, not an empty workspace', async () => {
  await assert.rejects(() => build('import_order', 'does-not-exist', BUYER, db()), /not found/i);
});

/**
 * §13-style bound. The workspace must not issue a query per document type or per document; the
 * per-row work is done in memory. Sixteen governed types would otherwise be sixteen round trips.
 */
test('the workspace is bounded — a constant number of reads', async () => {
  const client = db({
    diaspora_trade_documents: Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, import_order_id: ORDER, document_type: 'commercial_invoice',
      verification_status: 'UPLOADED', version: 1, deleted_at: null, superseded_at: null,
    })),
  });
  let reads = 0;
  const counting = new Proxy(client, { get: (t, k) => (k === 'from' ? (...a) => { reads += 1; return t.from(...a); } : t[k]) });
  await build('import_order', ORDER, BUYER, counting);
  assert.ok(reads <= 6, `expected a handful of reads, took ${reads}`);
});
