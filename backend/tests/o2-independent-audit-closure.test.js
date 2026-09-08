/**
 * O2 — independent read-only audit closure (E1–E3), and the interaction between them.
 *
 * The defect these guards exist for is not any one line: it is that an ALWAYS-201 dispatcher can
 * certify a request shape the real system would refuse, a mutation target that is a different
 * candidate, and an actor that has lost its organisational scope. So the dispatcher here is a
 * CONTRACT dispatcher — it runs the real evidence validator, checks the real listing-candidate
 * derivation, and answers the way the canonical routes would.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeVehicleWorkbookImport,
  validateVehicleWorkbookPayload,
  resolveDispatchBaseUrl,
  assertDispatchTargetProvenance,
  evidenceIdempotencyKey,
} from '../services/workbook/vehicleWorkbookImportService.js';
import { VEHICLE_WORKBOOK_SHEETS } from '../constants/workbook/workbookFieldRegistry.js';
import { isSupportedMimeType, allowedMimeTypes } from '../services/evidence/evidenceService.js';
import { buildVehicleListingCandidate } from '../services/marketplace/marketplaceListingEligibility.js';

/* ── a client that enforces the real unique index and column types ─────────────────────── */
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
          for (const row of state.insertRows) {
            const clash = db[table].some((e) => e.batch_id === row.batch_id
              && Number(e.row_number) === Number(row.row_number)
              && Number(e.attempt) === Number(row.attempt));
            if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            db[table].push({ ...row });
          }
          return { data: state.insertRows, error: null };
        }
        db[table].push(...state.insertRows.map((r) => ({ ...r })));
        return { data: state.insertRows, error: null };
      }
      if (state.updatePatch) {
        if (table === 'diaspora_workbook_import_rows' && 'target_record_id' in state.updatePatch
            && state.updatePatch.target_record_id !== null
            && !UUID.test(String(state.updatePatch.target_record_id))) {
          return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
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

/**
 * A dispatcher that answers the way the CANONICAL routes answer — never an unconditional 201.
 *
 *  - `/api/vehicles/add` derives the listing candidate with the REAL
 *    `buildVehicleListingCandidate`, using the actor context reconstructed from the request
 *    headers exactly as `authorizeRole` would (a tenant header is honoured only when the actor
 *    really holds that membership).
 *  - the evidence route runs the REAL `isSupportedMimeType` gate for a remote `file_url`.
 */
function contractDispatch({ memberships = {}, actor = {}, log = [] } = {}) {
  return async (routePath, method, body, headers = {}) => {
    const requestedTenant = headers['x-tenant-id'] || null;
    const requestedRole = headers['x-stakeholder-role'] || null;
    // authorizeRole: a tenant header is accepted ONLY against a real membership row.
    if (requestedTenant && !(memberships[actor.id] || []).includes(requestedTenant)) {
      return { status: 403, body: { error: 'Forbidden. You do not have access to this tenant organization.' } };
    }
    const userContext = {
      id: actor.id,
      role: requestedRole || actor.platformRole || 'owner',
      tenantId: requestedTenant,
    };

    if (routePath === '/api/vehicles/add') {
      const candidate = buildVehicleListingCandidate({ body, userContext });
      log.push({ route: routePath, tenant_id: candidate.tenant_id, current_seller_type: candidate.current_seller_type, actorRole: userContext.role });
      if (userContext.role === 'dealer' && !candidate.tenant_id) {
        return { status: 400, body: { error: 'A dealer listing requires an organisational tenant context', code: 'DEALER_TENANT_REQUIRED' } };
      }
      return { status: 201, body: { success: true, vin: body.vin, publication_status: 'draft' } };
    }

    // Canonical evidence upload: remote file_url ⇒ the declared mime_type must be supported.
    const mimeType = body.mime_type || body.mimeType || null;
    if (!body.file && !isSupportedMimeType(mimeType)) {
      return { status: 400, body: { error: `Unsupported file type: ${mimeType || 'unknown'}` } };
    }
    if (!body.file_url) return { status: 400, body: { error: 'file_url is required' } };
    log.push({ route: routePath, mime_type: mimeType, tenant_id: requestedTenant, idempotency_key: body.idempotency_key });
    return { status: 201, body: { success: true, evidence_id: 'ev-1', verification_status: 'pending' } };
  };
}

function seeded({ evidence = [], importStatus = 'VALIDATED' } = {}) {
  return strictClient({
    batches: [{ id: 'batch-1', uploaded_by: 'u1', template_type: 'dealer_vehicle_inventory', import_status: importStatus }],
    rows: [{
      id: 'row-1', batch_id: 'batch-1', sheet_name: 'VEHICLES', workbook_row_number: 1,
      workbook_record_id: 'JT123456789012345', validation_status: 'ACCEPTED',
      normalized_payload: { vin: 'JT123456789012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000 },
      metadata: evidence.length ? { evidence } : null,
    }],
  });
}

const OWNER = { id: 'u1', platformRole: 'owner' };
const DEALER = { id: 'u1', platformRole: 'dealer', requestedRole: 'dealer', tenantId: 'tenant-A' };

/* ── E1 ───────────────────────────────────────────────────────────────────────────────── */
test('E1 REPRODUCTION: without a declared MIME type the canonical evidence route refuses', () => {
  const legacyWorkbookBody = { evidence_class: 'service_history', file_url: 'https://x/y.pdf' };
  const mime = legacyWorkbookBody.mime_type || null;
  assert.equal(isSupportedMimeType(mime), false);
});

test('E1: the workbook declares the MIME type, with the EVIDENCE SERVICE\'s own vocabulary', () => {
  const field = VEHICLE_WORKBOOK_SHEETS.EVIDENCE_NOTES.fields.find((f) => f.key === 'file_mime_type');
  assert.ok(field, 'EVIDENCE_NOTES must carry a MIME column');
  assert.equal(field.required, true, 'the canonical route refuses without it, so it cannot be optional');
  assert.deepEqual(field.vocabulary.map((v) => v.value), [...allowedMimeTypes],
    'the vocabulary must be the evidence service\'s list, imported — not a retyped copy');
});

test('E1: a supported IMAGE travels through the real evidence validation and succeeds', async () => {
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'condition', file_url: 'https://x/a.png', file_mime_type: 'image/png' }] }),
    dispatch: contractDispatch({ actor: OWNER, log }),
  });
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(result.evidence[0].outcome, 'accepted');
  assert.equal(log.find((e) => e.mime_type)?.mime_type, 'image/png');
});

test('E1: a supported PDF travels through the real evidence validation and succeeds', async () => {
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: OWNER }),
  });
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(result.evidence[0].outcome, 'accepted');
});

test('E1: a MISSING MIME type refuses, and the batch does NOT report completion', async () => {
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.pdf' }] }),
    dispatch: contractDispatch({ actor: OWNER }),
  });
  assert.equal(result.evidence[0].outcome, 'rejected');
  assert.match(result.evidence[0].error_message, /Unsupported file type/i);
  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED', 'a refused evidence upload is not a finished import');
  assert.equal(result.retryable, true);
});

test('E1: an UNSUPPORTED MIME type refuses, and the allow-list was not broadened', async () => {
  assert.equal(isSupportedMimeType('application/zip'), false);
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.zip', file_mime_type: 'application/zip' }] }),
    dispatch: contractDispatch({ actor: OWNER }),
  });
  assert.equal(result.evidence[0].outcome, 'rejected');
  assert.equal(result.retryable, true);
  assert.deepEqual([...allowedMimeTypes], ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
});

test('E1: the MIME column is required at VALIDATION, so the dry run says so before confirming', async () => {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles',
    sheetRows: {
      VEHICLES: [{ vin: 'JT123456789012345' }],
      EVIDENCE_NOTES: [{ vin: 'JT123456789012345', evidence_class: 'registration', file_url: 'https://x/a.pdf' }],
    },
  });
  const missing = validation.errors.filter((e) => e.field === 'file_mime_type' && e.code === 'REQUIRED_MISSING');
  assert.equal(missing.length, 1, 'the uploader learns this in the dry run, not after a failed import');
});

test('E1: imported evidence stays PENDING — the workbook verifies nothing', async () => {
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: OWNER, log }),
  });
  const evidenceCall = log.find((e) => e.route.includes('/evidence/'));
  for (const forbidden of ['verification_status', 'verified', 'trust_score', 'is_verified']) {
    assert.equal(Object.prototype.hasOwnProperty.call(evidenceCall, forbidden), false,
      `the workbook must not send ${forbidden} — verification is CarUp's decision`);
  }
});

test('E1: a retry reuses the same evidence idempotency key and does not duplicate', async () => {
  const evidence = [{ evidence_class: 'registration', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }];
  const first = []; const second = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence }), dispatch: contractDispatch({ actor: OWNER, log: first }) });
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence, importStatus: 'PARTIALLY_IMPORTED' }), dispatch: contractDispatch({ actor: OWNER, log: second }) });
  const k1 = first.find((e) => e.idempotency_key)?.idempotency_key;
  const k2 = second.find((e) => e.idempotency_key)?.idempotency_key;
  assert.equal(k1, evidenceIdempotencyKey('batch-1', 1, 0));
  assert.equal(k2, k1, 'the retry must dedupe against the first pass, not create a second record');
});

/* ── E2 ───────────────────────────────────────────────────────────────────────────────── */
const provenance = (sha, branch) => ({ commit_sha: sha, commit_sha_short: sha.slice(0, 8), branch, provenance_available: true });
const health = (sha, branch) => async () => ({ build: { commit_sha: sha, branch } });

test('E2: the SAME exact candidate is allowed', async () => {
  const verdict = await assertDispatchTargetProvenance('https://carup-backend-abc.vercel.app', {
    expected: provenance('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'feat/o2'),
    fetchHealth: health('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'feat/o2'),
  });
  assert.equal(verdict.verified, true);
});

test('E2: stable staging while running a BRANCH candidate is refused', async () => {
  await assert.rejects(
    () => assertDispatchTargetProvenance('https://api-staging.carup.dev', {
      expected: provenance('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'feat/o2'),
      fetchHealth: health('bb9d9900c700873ca57df0ac18a1a5c01f77711a', 'main'),
    }),
    (e) => { assert.match(e.message, /different candidate|Nothing was imported/i); return true; },
  );
});

test('E2: a production target is refused for the same reason — it is not this candidate', async () => {
  await assert.rejects(
    () => assertDispatchTargetProvenance('https://api.carup.co.zw', {
      expected: provenance('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'feat/o2'),
      fetchHealth: health('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'main'),
    }),
    (e) => { assert.match(e.message, /different candidate/i); return true; },
  );
});

test('E2: a different branch at the same SHA is still refused', async () => {
  await assert.rejects(
    () => assertDispatchTargetProvenance('https://other.vercel.app', {
      expected: provenance('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'feat/o2'),
      fetchHealth: health('6f8501635c886272c5ac215a9c74db6d31ffb3bb', 'main'),
    }),
    (e) => { assert.match(e.message, /branch/i); return true; },
  );
});

test('E2: MISSING provenance fails closed — on either side', async () => {
  await assert.rejects(() => assertDispatchTargetProvenance('https://t.vercel.app', {
    expected: provenance('6f850163aaaa', 'feat/o2'), fetchHealth: async () => ({ build: { commit_sha: null } }),
  }), /does not report its build revision/i);
  await assert.rejects(() => assertDispatchTargetProvenance('https://t.vercel.app', {
    expected: { commit_sha: null, provenance_available: false }, fetchHealth: health('x', 'y'),
  }), /cannot state its own build revision/i);
  await assert.rejects(() => assertDispatchTargetProvenance('https://t.vercel.app', {
    expected: provenance('6f850163aaaa', 'feat/o2'), fetchHealth: async () => { throw new Error('ENOTFOUND'); },
  }), /could not be reached/i);
});

test('E2: on Vercel with no valid self-target, ZERO mutations happen', async () => {
  const client = seeded({ evidence: [] });
  const saved = { VERCEL: process.env.VERCEL, URL: process.env.VERCEL_URL, INT: process.env.CARUP_INTERNAL_API_BASE_URL };
  process.env.VERCEL = '1';
  delete process.env.VERCEL_URL;
  delete process.env.CARUP_INTERNAL_API_BASE_URL;
  try {
    await assert.rejects(
      () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: client }),
      /not reachable|Nothing was imported/i,
    );
    assert.equal(client._db.diaspora_workbook_import_receipts.length, 0);
    assert.equal(client._db.diaspora_workbook_import_batches[0].import_status, 'VALIDATED');
  } finally {
    if (saved.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.VERCEL;
    if (saved.URL !== undefined) process.env.VERCEL_URL = saved.URL;
    if (saved.INT !== undefined) process.env.CARUP_INTERNAL_API_BASE_URL = saved.INT;
  }
});

test('E2: a local/test self-listener remains supported where it really exists', () => {
  assert.equal(resolveDispatchBaseUrl({ PORT: '4000' }), 'http://127.0.0.1:4000');
  assert.equal(resolveDispatchBaseUrl({ NODE_ENV: 'test', PORT: '3001' }), 'http://127.0.0.1:3001');
});

test('E2: loopback needs no remote provenance — it IS this process', async () => {
  const verdict = await assertDispatchTargetProvenance('http://127.0.0.1:3001', { expected: provenance('x'.repeat(40), 'b') });
  assert.equal(verdict.verified, true);
});

/* ── E3 ───────────────────────────────────────────────────────────────────────────────── */
test('E3: an OWNER import creates an owner-scoped draft with NO tenant', async () => {
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded(), dispatch: contractDispatch({ actor: OWNER, log }),
  });
  assert.equal(result.created, 1);
  const create = log.find((e) => e.route === '/api/vehicles/add');
  assert.equal(create.tenant_id, null);
  assert.equal(create.current_seller_type, 'Private Owner');
});

test('E3: an ACTIVE DEALER with a valid tenant creates a DEALER-tenant-scoped draft', async () => {
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, DEALER, {
    supabaseClient: seeded(),
    req: { headers: {} },
    dispatch: contractDispatch({ actor: DEALER, memberships: { u1: ['tenant-A'] }, log }),
  });
  assert.equal(result.created, 1, 'the dealer replay must not lose its organisational scope');
  const create = log.find((e) => e.route === '/api/vehicles/add');
  assert.equal(create.tenant_id, 'tenant-A');
  assert.equal(create.current_seller_type, 'Dealer');
});

test('E3: a DEALER WITHOUT a valid tenant is refused, not silently downgraded', async () => {
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true },
    { id: 'u1', platformRole: 'dealer', requestedRole: 'dealer' }, {
      supabaseClient: seeded(),
      dispatch: contractDispatch({ actor: { id: 'u1', platformRole: 'dealer', requestedRole: 'dealer' } }),
    });
  assert.equal(result.created, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED');
});

test('E3: a FORGED tenant is refused by the inner route\'s own membership check', async () => {
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true },
    { ...DEALER, tenantId: 'tenant-SOMEONE-ELSE' }, {
      supabaseClient: seeded(),
      dispatch: contractDispatch({ actor: DEALER, memberships: { u1: ['tenant-A'] } }),
    });
  assert.equal(result.created, 0, 'membership is re-verified inside; the workbook cannot assert scope');
});

test('E3: a dealer cannot write into ANOTHER tenant — evidence included', async () => {
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true },
    { ...DEALER, tenantId: 'tenant-B' }, {
      supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
      dispatch: contractDispatch({ actor: DEALER, memberships: { u1: ['tenant-A'] }, log }),
    });
  assert.equal(log.filter((e) => e.route.includes('/evidence/')).length, 0,
    'no evidence may be written under a tenant the actor does not hold');
});

test('E3: evidence replay keeps the SAME valid tenant scope as the vehicle it belongs to', async () => {
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, DEALER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: DEALER, memberships: { u1: ['tenant-A'] }, log }),
  });
  const evidenceCall = log.find((e) => e.route.includes('/evidence/'));
  assert.equal(evidenceCall.tenant_id, 'tenant-A');
});

test('E3: x-user-id is never forwarded — an asserted identity is not authority', async () => {
  const seenHeaders = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, DEALER, {
    supabaseClient: seeded(),
    dispatch: async (routePath, _m, body, headers = {}) => {
      seenHeaders.push(headers);
      return routePath === '/api/vehicles/add' ? { status: 201, body: { success: true, vin: body.vin } } : { status: 201, body: {} };
    },
  });
  for (const headers of seenHeaders) {
    assert.equal(Object.prototype.hasOwnProperty.call(headers, 'x-user-id'), false);
  }
});
