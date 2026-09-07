/**
 * O2 — post-Ready automated review closure (backend halves of C4–C8).
 *
 * The X5A suite's in-memory client enforces no unique index and no column type, which is the
 * only reason C4, C5 and C7 survived a green suite: the real database refuses all three
 * (proven separately against PostgreSQL in
 * `database/test/o2_workbook_receipt_identity_check.mjs`). The client here enforces exactly
 * the two constraints the migrations declare, so these guards fail the moment the fix is
 * reverted rather than agreeing with whatever the code happens to do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeVehicleWorkbookImport,
  validateVehicleWorkbookPayload,
} from '../services/workbook/vehicleWorkbookImportService.js';
import { buildPersonComplianceReview } from '../services/operations/peopleComplianceReadModel.js';

/* ── a client that enforces what the migrations actually declare ───────────────────────
 *   uq_diaspora_workbook_receipt_row  UNIQUE (batch_id, row_number, attempt)
 *   diaspora_workbook_import_rows.target_record_id  uuid
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function strictClient(seed = {}) {
  const db = {
    diaspora_workbook_import_batches: seed.batches || [],
    diaspora_workbook_import_rows: seed.rows || [],
    diaspora_workbook_import_receipts: seed.receipts || [],
  };
  const matches = (row, filters) => filters.every(({ column, value }) => row[column] === value);

  function builder(table) {
    const state = { filters: [], insertRows: null, updatePatch: null };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push({ column, value }); return api; },
      in(column, values) { state.filters.push({ column, value: values[0] }); return api; },
      order() { return api; },
      limit() { return api; },
      insert(rows) { state.insertRows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { state.updatePatch = patch; return api; },
      single() { return api.then((r) => ({ data: (r.data || [])[0] ?? null, error: r.error })); },
      maybeSingle() { return api.single(); },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    async function run() {
      if (state.insertRows) {
        if (table === 'diaspora_workbook_import_receipts') {
          for (const row of state.insertRows) {
            const clash = db[table].some((existing) =>
              existing.batch_id === row.batch_id
              && Number(existing.row_number) === Number(row.row_number)
              && Number(existing.attempt) === Number(row.attempt));
            if (clash) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_diaspora_workbook_receipt_row"' } };
            }
            db[table].push({ ...row });
          }
          return { data: state.insertRows, error: null };
        }
        db[table].push(...state.insertRows.map((r) => ({ ...r })));
        return { data: state.insertRows, error: null };
      }
      if (state.updatePatch) {
        if (table === 'diaspora_workbook_import_rows'
            && 'target_record_id' in state.updatePatch
            && state.updatePatch.target_record_id !== null
            && !UUID.test(String(state.updatePatch.target_record_id))) {
          return { data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${state.updatePatch.target_record_id}"` } };
        }
        for (const row of db[table]) if (matches(row, state.filters)) Object.assign(row, state.updatePatch);
        return { data: null, error: null };
      }
      return { data: db[table].filter((row) => matches(row, state.filters)), error: null };
    }
    return api;
  }
  return { from: (table) => builder(table), _db: db };
}

function seededBatch({ receipts = [], importStatus = 'VALIDATED', evidence = null } = {}) {
  const batchId = 'batch-1';
  return strictClient({
    batches: [{ id: batchId, uploaded_by: 'u1', template_type: 'seller_vehicles', import_status: importStatus }],
    rows: [{
      id: 'row-1', batch_id: batchId, sheet_name: 'VEHICLES', workbook_row_number: 1,
      workbook_record_id: 'JT123456789012345', validation_status: 'ACCEPTED',
      normalized_payload: { vin: 'JT123456789012345' },
      metadata: evidence ? { evidence } : null,
    }],
    receipts,
  });
}

/** The REAL POST /api/vehicles/add answer: a top-level vin, and no `vehicle` object at all. */
const realVehiclesAddDispatch = async (routePath, _method, body) => (
  routePath === '/api/vehicles/add'
    ? { status: 201, body: { success: true, vin: body.vin, publication_status: 'draft' } }
    : { status: 201, body: { success: true } }
);

/* ── C4 ───────────────────────────────────────────────────────────────────────────────── */
test('C4: a vehicle with evidence writes ONE receipt for its row — evidence no longer collides with it', async () => {
  const client = seededBatch({ evidence: [{ evidence_class: 'service', file_url: 'https://x/y.pdf' }] });
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, { id: 'u1' },
    { supabaseClient: client, dispatch: realVehiclesAddDispatch });

  assert.equal(result.importStatus, 'IMPORTED', 'the batch must reach a terminal status, not die on its receipts');
  const written = client._db.diaspora_workbook_import_receipts;
  const keys = written.map((r) => `${r.batch_id}|${r.row_number}|${r.attempt}`);
  assert.equal(new Set(keys).size, keys.length, 'two receipts shared (batch_id, row_number, attempt)');
  assert.equal(written.filter((r) => Number(r.row_number) === 1).length, 1);
  assert.equal(result.receipts_recorded, true);
});

test('C4: the evidence outcome is still reported per item — it is recorded, not discarded', async () => {
  const client = seededBatch({ evidence: [{ evidence_class: 'service', file_url: 'https://x/y.pdf' }] });
  const dispatch = async (routePath, _m, body) => (
    routePath === '/api/vehicles/add'
      ? { status: 201, body: { success: true, vin: body.vin } }
      : { status: 502, body: { error: 'evidence store unavailable' } }
  );
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, { id: 'u1' }, { supabaseClient: client, dispatch });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].outcome, 'rejected');
  assert.match(result.evidence[0].error_code, /502/);
  const receipt = client._db.diaspora_workbook_import_receipts.find((r) => Number(r.row_number) === 1);
  assert.equal(receipt.outcome, 'accepted', 'the created draft still stands');
  assert.equal(receipt.error_code, 'EVIDENCE_PARTIAL', 'and the partial evidence is stated on the receipt');
});

/* ── C5 ───────────────────────────────────────────────────────────────────────────────── */
test('C5: retrying a PARTIALLY_IMPORTED batch allocates the NEXT attempt and completes', async () => {
  const client = seededBatch({
    importStatus: 'PARTIALLY_IMPORTED',
    receipts: [{ batch_id: 'batch-1', row_number: 1, attempt: 1, outcome: 'rejected', sheet_name: 'VEHICLES' }],
  });
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, { id: 'u1' },
    { supabaseClient: client, dispatch: realVehiclesAddDispatch });

  assert.equal(result.importStatus, 'IMPORTED', 'the retry must be able to leave the partial state');
  assert.equal(result.receipts_recorded, true);
  const attempts = client._db.diaspora_workbook_import_receipts
    .filter((r) => Number(r.row_number) === 1).map((r) => Number(r.attempt)).sort();
  assert.deepEqual(attempts, [1, 2], 'the first pass is retained and the retry is a new attempt');
});

test('C5: a third pass keeps counting — attempt is the pass number, and history is additive', async () => {
  const client = seededBatch({
    importStatus: 'PARTIALLY_IMPORTED',
    receipts: [
      { batch_id: 'batch-1', row_number: 1, attempt: 1, outcome: 'rejected', sheet_name: 'VEHICLES' },
      { batch_id: 'batch-1', row_number: 1, attempt: 2, outcome: 'rejected', sheet_name: 'VEHICLES' },
    ],
  });
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, { id: 'u1' },
    { supabaseClient: client, dispatch: realVehiclesAddDispatch });
  const attempts = client._db.diaspora_workbook_import_receipts
    .filter((r) => Number(r.row_number) === 1).map((r) => Number(r.attempt)).sort();
  assert.deepEqual(attempts, [1, 2, 3]);
});

/* ── C7 ───────────────────────────────────────────────────────────────────────────────── */
test('C7: the real create response carries no vehicle uuid, so no VIN is written to a uuid column', async () => {
  const client = seededBatch();
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, { id: 'u1' },
    { supabaseClient: client, dispatch: realVehiclesAddDispatch });

  assert.equal(result.created, 1);
  const row = client._db.diaspora_workbook_import_rows[0];
  assert.equal(row.target_record_id ?? null, null, 'a VIN must never be written into a uuid column');
  assert.equal(row.workbook_record_id, 'JT123456789012345', 'the row stays linked by its VIN');
  const receipt = client._db.diaspora_workbook_import_receipts[0];
  assert.equal(receipt.entity_ref, 'JT123456789012345', 'and the receipt still names the vehicle');
  assert.notEqual(receipt.error_code, 'TARGET_LINK_FAILED');
});

test('C7: a genuine uuid identifier IS linked, so the fix is not "never link"', async () => {
  const client = seededBatch();
  const uuid = '11111111-2222-4333-8444-555555555555';
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, { id: 'u1' }, {
    supabaseClient: client,
    dispatch: async () => ({ status: 201, body: { success: true, vehicle: { vin: uuid } } }),
  });
  assert.equal(client._db.diaspora_workbook_import_rows[0].target_record_id, uuid);
});

/* ── C6 ───────────────────────────────────────────────────────────────────────────────── */
test('C6: dealer BUSINESS and BRANCHES rows are declared not-imported instead of vanishing', async () => {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'dealer_vehicle_inventory',
    sheetRows: {
      BUSINESS: [{ legal_name: 'Acme Motors' }],
      BRANCHES: [{ branch_name: 'Harare' }, { branch_name: 'Bulawayo' }],
      VEHICLES: [],
    },
  });
  const sheets = validation.notImported.map((entry) => entry.sheet_name).sort();
  assert.deepEqual(sheets, ['BRANCHES', 'BUSINESS']);
  assert.equal(validation.totals.notImportedRows, 3, 'every supplied row is counted, not just the sheet');
  const warned = validation.warnings.filter((w) => w.code === 'SHEET_NOT_IMPORTED');
  assert.equal(warned.length, 3, 'each row says so on its own line');
  assert.match(warned[0].message, /dealer onboarding/i, 'and it names where the data must actually go');
});

test('C6: the seller template has no such sheets, so nothing is invented for it', async () => {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles', sheetRows: { VEHICLES: [] },
  });
  assert.deepEqual(validation.notImported, []);
  assert.equal(validation.totals.notImportedRows, 0);
});

/* ── C8 ───────────────────────────────────────────────────────────────────────────────── */
function reviewClient(failTable) {
  const ok = (data) => ({ data, error: null });
  const fail = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
  return {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
        maybeSingle() { return api.then((r) => r); },
        single() { return api.then((r) => r); },
        then(resolve, reject) {
          if (table === failTable) return Promise.resolve(fail()).then(resolve, reject);
          if (table === 'users') return Promise.resolve({ data: { id: 'u1', name: 'A', email: 'a@b.c', role: 'owner' }, error: null }).then(resolve, reject);
          if (table === 'dealer_profiles') return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          return Promise.resolve(ok([])).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

for (const [table, section] of [
  ['vehicle_seller_authority', 'seller authority'],
  ['verification_sessions', 'identity verification'],
  ['vehicles', 'vehicle ownership'],
  ['vehicle_ownership_transfers', 'ownership transfer'],
  ['tenant_users', 'tenant membership'],
  ['dealer_profiles', 'dealer profile'],
]) {
  test(`C8: a ${table} failure is reported as unavailable, never as "no records"`, async () => {
    await assert.rejects(
      () => buildPersonComplianceReview(reviewClient(table), { userId: 'u1', userContext: { id: 'admin', role: 'admin' } }),
      (error) => {
        assert.equal(error.code, 'PEOPLE_REVIEW_SECTION_UNAVAILABLE', 'the aggregate must not answer 200');
        assert.equal(error.status, 503);
        assert.match(String(error.section), new RegExp(section.split(' ')[0], 'i'));
        return true;
      },
      `${table} failed silently and the section was presented as empty`,
    );
  });
}

test('C8: with every query healthy the review still builds — the guard is not a blanket refusal', async () => {
  const review = await buildPersonComplianceReview(reviewClient(null), {
    userId: 'u1', userContext: { id: 'admin', role: 'admin' },
  });
  assert.equal(review.person.id, 'u1');
  assert.equal(review.seller_authority.total, 0);
  assert.equal(review.dealer_compliance.is_dealer, false);
});
