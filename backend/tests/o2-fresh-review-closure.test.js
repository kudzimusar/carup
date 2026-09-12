/**
 * O2 — fresh automated re-review closure (backend halves of D3–D6).
 *
 * The findings this file guards all share one shape: the import chain reported SUCCESS for work
 * that had not happened. `IMPORTED` is terminal — `alreadyImported` short-circuits every later
 * execution — so any status written while part of the request is outstanding makes the shortfall
 * permanent AND invisible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeVehicleWorkbookImport,
  resolveDispatchBaseUrl,
  evidenceIdempotencyKey,
} from '../services/workbook/vehicleWorkbookImportService.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A reachable identity: the listing-eligibility contract refuses fixture VINs and seed owner ids.
const OWNER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OWNER = { id: OWNER_ID, role: 'owner', platformRole: 'owner' };

function strictClient(seed = {}) {
  const db = {
    diaspora_workbook_import_batches: seed.batches || [],
    diaspora_workbook_import_rows: seed.rows || [],
    diaspora_workbook_import_receipts: seed.receipts || [],
  };
  const matches = (row, filters) => filters.every(({ column, value }) => row[column] === value);
  // H18 — an unknown table answers like real Postgres for a user with no rows: an EMPTY SET,
  // not an exception. The workbook catalogue (which execute now consults for current import
  // capability) reads dealer-onboarding and trade-profile tables; a client that threw on them
  // was a fixture that could not reach the branch under test.
  const tableOf = (name) => { if (!db[name]) db[name] = []; return db[name]; };
  function builder(table) {
    const state = { filters: [], insertRows: null, updatePatch: null };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push({ column, value }); return api; },
      in(column, values) { state.filters.push({ column, value: values[0] }); return api; },
      order() { return api; }, limit() { return api; },
      insert(rows) { state.insertRows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { state.updatePatch = patch; return api; },
      single() { return api.then((r) => ({ data: (r.data || [])[0] ?? null, error: r.error })); },
      maybeSingle() { return api.single(); },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    async function run() {
      if (state.insertRows) {
        if (table === 'diaspora_workbook_import_receipts') {
          if (seed.failReceiptInsert) {
            return { data: null, error: { code: '08006', message: 'connection terminated' } };
          }
          for (const row of state.insertRows) {
            const clash = db[table].some((e) => e.batch_id === row.batch_id
              && Number(e.row_number) === Number(row.row_number)
              && Number(e.attempt) === Number(row.attempt));
            if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            tableOf(table).push({ ...row });
          }
          return { data: state.insertRows, error: null };
        }
        tableOf(table).push(...state.insertRows.map((r) => ({ ...r })));
        return { data: state.insertRows, error: null };
      }
      if (state.updatePatch) {
        if (table === 'diaspora_workbook_import_rows' && 'target_record_id' in state.updatePatch
            && state.updatePatch.target_record_id !== null
            && !UUID.test(String(state.updatePatch.target_record_id))) {
          return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
        }
        for (const row of tableOf(table)) if (matches(row, state.filters)) Object.assign(row, state.updatePatch);
        return { data: null, error: null };
      }
      return { data: tableOf(table).filter((row) => matches(row, state.filters)), error: null };
    }
    return api;
  }
  return { from: (table) => builder(table), _db: db };
}

function seeded({ evidence = null, importStatus = 'VALIDATED', failReceiptInsert = false, templateType = 'seller_vehicles' } = {}) {
  // The batch's template must be one the executing actor is entitled to — execute re-checks it.
  const template = templateType;
  return strictClient({
    failReceiptInsert,
    batches: [{ id: 'batch-1', uploaded_by: OWNER_ID, template_type: template, import_status: importStatus }],
    rows: [{
      id: 'row-1', batch_id: 'batch-1', sheet_name: 'VEHICLES', workbook_row_number: 1,
      workbook_record_id: 'JTMHY7AJ2K4012345', validation_status: 'ACCEPTED',
      normalized_payload: { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.' },
      metadata: evidence ? { evidence } : null,
    }],
  });
}

const vehicleOk = async (routePath, _m, body) => (
  routePath === '/api/vehicles/add'
    ? { status: 201, body: { success: true, vin: body.vin } }
    : { status: 201, body: { success: true } });

/* ── D3 ───────────────────────────────────────────────────────────────────────────────── */
test('D3: on Vercel there is no loopback listener, so no base URL is claimed', () => {
  assert.equal(resolveDispatchBaseUrl({ VERCEL: '1', PORT: '3001' }), null);
});

test('D3: an explicitly configured INTERNAL base URL is used, and wins over any guess', () => {
  assert.equal(resolveDispatchBaseUrl({ VERCEL: '1', CARUP_INTERNAL_API_BASE_URL: 'https://api.example/' }),
    'https://api.example');
});

// Superseded by E2: CARUP_PUBLIC_API_URL is the STABLE public origin (documented on staging as
// api-staging.carup.dev). It proves nothing about which deployment or Git SHA answers it, so it is
// no longer accepted as a mutation target at all.
test('E2: CARUP_PUBLIC_API_URL is NOT a mutation target — a stable alias is not a candidate', () => {
  assert.equal(resolveDispatchBaseUrl({ VERCEL: '1', CARUP_PUBLIC_API_URL: 'https://api-staging.carup.dev' }), null);
  assert.equal(
    resolveDispatchBaseUrl({ VERCEL: '1', VERCEL_URL: 'carup-backend-abc123.vercel.app', CARUP_PUBLIC_API_URL: 'https://api-staging.carup.dev' }),
    'https://carup-backend-abc123.vercel.app',
    'the per-deployment host is chosen over the stable alias',
  );
});

test('D3: a local deployment still resolves its own listener', () => {
  assert.equal(resolveDispatchBaseUrl({ PORT: '4000' }), 'http://127.0.0.1:4000');
});

test('D3: an unreachable deployment REFUSES before mutating anything', async () => {
  const client = seeded();
  const previousVercel = process.env.VERCEL;
  const previousBase = process.env.CARUP_INTERNAL_API_BASE_URL;
  const previousPublic = process.env.CARUP_PUBLIC_API_URL;
  process.env.VERCEL = '1';
  delete process.env.CARUP_INTERNAL_API_BASE_URL;
  delete process.env.CARUP_PUBLIC_API_URL;
  try {
    await assert.rejects(
      () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: client }),
      (error) => {
        assert.match(error.message, /not reachable|Nothing was imported/i);
        return true;
      },
      'an unreachable deployment must refuse, not reject every row as DISPATCH_FAILED',
    );
    // and nothing was written on the way to that refusal
    assert.equal(client._db.diaspora_workbook_import_receipts.length, 0);
    assert.equal(client._db.diaspora_workbook_import_batches[0].import_status, 'VALIDATED');
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousBase !== undefined) process.env.CARUP_INTERNAL_API_BASE_URL = previousBase;
    if (previousPublic !== undefined) process.env.CARUP_PUBLIC_API_URL = previousPublic;
  }
});

/* ── D4 ───────────────────────────────────────────────────────────────────────────────── */
test('D4: an evidence failure leaves the batch PARTIALLY_IMPORTED, so it can be retried', async () => {
  const client = seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/y.pdf', file_mime_type: 'application/pdf' }] });
  const dispatch = async (routePath, _m, body) => (
    routePath === '/api/vehicles/add'
      ? { status: 201, body: { success: true, vin: body.vin } }
      : { status: 502, body: { error: 'evidence store unavailable' } });
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: client, dispatch });

  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED', 'IMPORTED is terminal and would block the retry');
  assert.equal(client._db.diaspora_workbook_import_batches[0].import_status, 'PARTIALLY_IMPORTED');
  assert.equal(result.retryable, true);
  assert.equal(result.evidence_failed, 1);
  assert.match(result.incomplete_reason, /evidence reference/i);
});

test('D4: a fully successful import is still IMPORTED — the rule is not "never finish"', async () => {
  const client = seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/y.pdf', file_mime_type: 'application/pdf' }] });
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: client, dispatch: vehicleOk });
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(result.retryable, false);
  assert.equal(result.incomplete_reason, null);
});

/* ── D5 ───────────────────────────────────────────────────────────────────────────────── */
test('D5: receipts that never reached the store keep the batch retryable, so the audit can be repaired', async () => {
  const client = seeded({ failReceiptInsert: true });
  const result = await executeVehicleWorkbookImport(
    { batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: client, dispatch: vehicleOk });

  assert.equal(result.receipts_recorded, false);
  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED', 'a terminal status would make the missing audit permanent');
  assert.equal(client._db.diaspora_workbook_import_batches[0].import_status, 'PARTIALLY_IMPORTED');
  assert.equal(result.retryable, true);
  assert.match(result.incomplete_reason, /receipts/i);
});

/* ── D6 ───────────────────────────────────────────────────────────────────────────────── */
test('D6: every replayed evidence upload carries a key that is stable across retries', async () => {
  const evidence = [
    { evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/1.pdf', file_mime_type: 'application/pdf' },
    { evidence_class: 'registration', evidence_subtype: 'reregistration_record', file_url: 'https://x/2.pdf', file_mime_type: 'application/pdf' },
  ];
  const seen = [];
  const dispatch = async (routePath, _m, body) => {
    if (routePath !== '/api/vehicles/add') seen.push(body.idempotency_key);
    return { status: 201, body: { success: true, vin: body.vin } };
  };
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence }), dispatch });
  const firstPass = [...seen];
  seen.length = 0;
  // A retry of the SAME batch replays the same rows.
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence, importStatus: 'PARTIALLY_IMPORTED' }), dispatch });

  assert.equal(firstPass.length, 2);
  assert.ok(firstPass.every(Boolean), 'withUploadIdempotency fails OPEN without a key — one must always be sent');
  assert.deepEqual(seen, firstPass, 'a retry must reuse the key so the already-recorded evidence dedupes');
  assert.equal(new Set(firstPass).size, 2, 'two references on one row must not collapse into one key');
});

test('D6: the key is derived from batch, row and position, so it cannot collide across rows', () => {
  assert.equal(evidenceIdempotencyKey('b', 1, 0), 'workbook-evidence:b:1:0');
  assert.notEqual(evidenceIdempotencyKey('b', 1, 0), evidenceIdempotencyKey('b', 2, 0));
  assert.notEqual(evidenceIdempotencyKey('b', 1, 0), evidenceIdempotencyKey('b', 1, 1));
  assert.notEqual(evidenceIdempotencyKey('a', 1, 0), evidenceIdempotencyKey('b', 1, 0));
});
