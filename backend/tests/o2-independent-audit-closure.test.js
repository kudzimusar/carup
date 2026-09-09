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
import {
  isSupportedMimeType,
  allowedMimeTypes,
  validateEvidenceUploadPayload,
  canUploadEvidenceRecord,
} from '../services/evidence/evidenceService.js';
import { withUploadIdempotency } from '../services/evidence/uploadIdempotency.js';
import { buildVehicleListingCandidate, getListingEligibility } from '../services/marketplace/marketplaceListingEligibility.js';

/**
 * J-3 — the governed dealership register for this suite. `E3_DEALER` IS the dealer for
 * `E3_TENANT`; every other (user, tenant) pair resolves to no dealership, so a membership-only
 * actor still gets no listing subject.
 */
const E3_DEALER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const E3_TENANT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const dealershipFor = (userId, tenantId) => (
  Boolean(tenantId) && userId === E3_DEALER && tenantId === E3_TENANT
    ? { granted: true, tenantId, dealerProfileId: 'dp-e3', reason: null }
    : { granted: false, tenantId: null, dealerProfileId: null, reason: 'no_governed_dealer_binding' });

/* ── a client that enforces the real unique index and column types ─────────────────────── */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function strictClient(seed = {}) {
  const db = {
    diaspora_workbook_import_batches: seed.batches || [],
    diaspora_workbook_import_rows: seed.rows || [],
    diaspora_workbook_import_receipts: seed.receipts || [],
    // K-3 — execute resolves the dealer's tenant from the governed ORGANISATION before it
    // revalidates any row: an active dealership-typed tenant plus a membership that acts for the
    // business. `dealer_profiles.tenant_id` stays NULL exactly as it is in real data. `matches`
    // applies every filter, so any other (user, tenant) pair still resolves to no dealership.
    dealer_profiles: seed.dealerProfiles || [],
    tenants: seed.tenants || [{ id: E3_TENANT, type: 'dealership', status: 'active' }],
    tenant_users: seed.tenantUsers || [{ tenant_id: E3_TENANT, user_id: E3_DEALER, role: 'admin' }],
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

/**
 * A dispatcher that answers by CALLING the canonical contracts — never an unconditional 201, and
 * never a paraphrase of them.
 *
 * F4a correction: an earlier version of this file called only `isSupportedMimeType` for evidence
 * and described that as "the real evidence validation". It was not: the route runs the full
 * `validateEvidenceUploadPayload` (classification, canonical-first pair, file presence) and then
 * `canUploadEvidenceRecord` against the actor's role. Claiming the narrower check as the wider one
 * is exactly the overstatement that let F1 and F2 through, so the boundary now invokes:
 *
 *   - `validateEvidenceUploadPayload`  — classification + payload contract
 *   - `canUploadEvidenceRecord`        — evidence upload authority for the actor's role
 *   - `isSupportedMimeType`            — the remote-file content-type gate
 *   - `buildVehicleListingCandidate` + `getListingEligibility` — the listing subject and its
 *     eligibility
 *   - the tenant-membership rule `authorizeRole` applies before any of them
 *   - `withUploadIdempotency` — with SHARED state, so deduplication is observed, not assumed
 *
 * Nothing above is reimplemented here.
 */
function contractDispatch({ memberships = {}, actor = {}, log = [], idempotencyStore = new Map(), evidenceRows = [] } = {}) {
  return async (routePath, method, body, headers = {}) => {
    const requestedTenant = headers['x-tenant-id'] || null;
    const requestedRole = headers['x-stakeholder-role'] || null;
    // authorizeRole: a tenant header is accepted ONLY against a real membership row.
    if (requestedTenant && !(memberships[actor.id] || []).includes(requestedTenant)) {
      return { status: 403, body: { error: 'Forbidden. You do not have access to this tenant organization.' } };
    }
    const userContext = { id: actor.id, role: requestedRole || actor.platformRole || 'owner', tenantId: requestedTenant };

    if (routePath === '/api/vehicles/add') {
      // J-3 — the route resolves the dealer's tenant from the governed `dealer_profiles` binding,
      // so a dispatcher modelling that route must too. Membership (`memberships` above) gets you
      // past the tenant gate; only a dealership makes you the seller.
      const candidate = buildVehicleListingCandidate({
        body, userContext, dealerListingSubject: dealershipFor(userContext.id, userContext.tenantId),
      });
      const eligibility = getListingEligibility(candidate);
      log.push({ route: routePath, body, tenant_id: candidate.tenant_id, current_seller_type: candidate.current_seller_type, actorRole: userContext.role, eligible: eligibility.eligible });
      if (!eligibility.eligible) {
        return { status: 400, body: { error: `Vehicle is not marketplace-eligible: ${eligibility.reasons.join(', ')}`, code: 'MARKETPLACE_INELIGIBLE' } };
      }
      return { status: 201, body: { success: true, vin: body.vin, publication_status: 'draft' } };
    }

    // ── the canonical evidence contract, invoked ────────────────────────────────────────
    let normalized;
    try {
      normalized = validateEvidenceUploadPayload(body, { requireVehicleId: false });
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
    if (!canUploadEvidenceRecord(normalized, userContext.role)) {
      const label = normalized.explicitCanonical ? `${normalized.evidenceClass}/${normalized.evidenceSubtype}` : normalized.evidenceType;
      return { status: 403, body: { error: `Forbidden. Role '${userContext.role}' is not authorized to upload '${label}'` } };
    }
    const mimeType = body.mime_type || body.mimeType || null;
    if (!body.file && !isSupportedMimeType(mimeType)) {
      return { status: 400, body: { error: `Unsupported file type: ${mimeType || 'unknown'}` } };
    }
    // F4d — real deduplication, over state shared across passes, so a retry is OBSERVED not assumed.
    const outcome = await withUploadIdempotency(body.idempotency_key, body.vehicle_id || null, async () => {
      const id = `ev-${evidenceRows.length + 1}`;
      evidenceRows.push({ id, class: normalized.evidenceClass, subtype: normalized.evidenceSubtype, tenant_id: requestedTenant });
      return { id };
      // J-2: the collision domain is (actor, key), exactly as the route now supplies it.
    }, { store: idempotencyStore, actorId: actor.id });
    // F4c — the ACTUAL outgoing body is recorded, not a hand-picked subset of its keys.
    log.push({ route: routePath, body, mime_type: mimeType, tenant_id: requestedTenant, deduped: outcome.deduped });
    return { status: 201, body: { success: true, evidence_id: outcome.evidenceId, deduped: outcome.deduped } };
  };
}

function seeded({ evidence = [], importStatus = 'VALIDATED', seedActorId = OWNER_ID, templateType = null } = {}) {
  // H18 — the batch's template must be one the EXECUTING actor is entitled to; execute now
  // re-checks that, so a fixture pairing an owner with the dealer template was never realistic.
  const template = templateType || (seedActorId === OWNER_ID ? 'seller_vehicles' : 'dealer_vehicle_inventory');
  return strictClient({
    batches: [{ id: 'batch-1', uploaded_by: seedActorId, template_type: template, import_status: importStatus }],
    rows: [{
      id: 'row-1', batch_id: 'batch-1', sheet_name: 'VEHICLES', workbook_row_number: 1,
      workbook_record_id: 'JTMHY7AJ2K4012345', validation_status: 'ACCEPTED',
      normalized_payload: { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.' },
      metadata: evidence.length ? { evidence } : null,
    }],
  });
}

const OWNER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DEALER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const TENANT_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OWNER = { id: OWNER_ID, role: 'owner', platformRole: 'owner' };
const DEALER = { id: DEALER_ID, role: 'dealer', platformRole: 'dealer', requestedRole: 'dealer', tenantId: TENANT_A };

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
    supabaseClient: seeded({ evidence: [{ evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', file_url: 'https://x/a.png', file_mime_type: 'image/png' }] }),
    dispatch: contractDispatch({ actor: OWNER, log }),
  });
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(result.evidence[0].outcome, 'accepted');
  assert.equal(log.find((e) => e.mime_type)?.mime_type, 'image/png');
});

test('E1: a supported PDF travels through the real evidence validation and succeeds', async () => {
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: OWNER }),
  });
  assert.equal(result.importStatus, 'IMPORTED');
  assert.equal(result.evidence[0].outcome, 'accepted');
});

test('E1/H4: a MISSING MIME type refuses the ROW before any write — no vehicle, no evidence', async () => {
  const client = seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf' }] });
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: client, dispatch: contractDispatch({ actor: OWNER, log }),
  });
  assert.equal(result.created, 0);
  assert.equal(result.failed, 1);
  assert.equal(log.length, 0, 'nothing was dispatched: the refusal precedes every mutation');
  const receipt = client._db.diaspora_workbook_import_receipts[0];
  assert.equal(receipt.outcome, 'rejected');
  assert.equal(receipt.error_code, 'EVIDENCE_MIME_UNSUPPORTED');
  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED');
  assert.equal(result.retryable, true);
});

test('E1/H4: an UNSUPPORTED MIME type refuses the row, and the allow-list was not broadened', async () => {
  assert.equal(isSupportedMimeType('application/zip'), false);
  const client = seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.zip', file_mime_type: 'application/zip' }] });
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: client, dispatch: contractDispatch({ actor: OWNER, log }),
  });
  assert.equal(result.created, 0);
  assert.equal(log.length, 0, 'no vehicle is created for a row whose evidence cannot be filed');
  assert.equal(client._db.diaspora_workbook_import_receipts[0].error_code, 'EVIDENCE_MIME_UNSUPPORTED');
  assert.deepEqual([...allowedMimeTypes], ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
});

test('E1: the MIME column is required at VALIDATION, so the dry run says so before confirming', async () => {
  const validation = await validateVehicleWorkbookPayload({
    templateKey: 'seller_vehicles',
    sheetRows: {
      VEHICLES: [{ vin: 'JTMHY7AJ2K4012345' }],
      EVIDENCE_NOTES: [{ vin: 'JTMHY7AJ2K4012345', evidence_class: 'registration', file_url: 'https://x/a.pdf' }],
    },
  });
  const missing = validation.errors.filter((e) => e.field === 'file_mime_type' && e.code === 'REQUIRED_MISSING');
  assert.equal(missing.length, 1, 'the uploader learns this in the dry run, not after a failed import');
});

test('E1/F4c: imported evidence stays PENDING — asserted on the ACTUAL outgoing body', async () => {
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: seeded({ evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: OWNER, log }),
  });
  const evidenceCall = log.find((e) => e.route.includes('/evidence/'));
  // The earlier version of this test read a REDUCED log object and asserted that keys the logger
  // never copied were absent — which is true of any key, and therefore proved nothing. The whole
  // request body is inspected here, recursively.
  const serialized = JSON.stringify(evidenceCall.body);
  for (const forbidden of ['verification_status', 'verified', 'is_verified', 'trust_score', 'trust', 'review_outcome', 'reviewed_by', 'decision']) {
    assert.equal(serialized.includes(forbidden), false,
      `the workbook must not send '${forbidden}' — verification and Trust are CarUp's decisions, not an uploader's`);
  }
  // and positively: the body carries only reference facts.
  const definedKeys = Object.entries(evidenceCall.body)
    .filter(([, value]) => value !== undefined).map(([key]) => key).sort();
  assert.deepEqual(definedKeys, ['evidence_class', 'evidence_subtype', 'file_url', 'idempotency_key', 'mime_type'],
    'the body carries reference facts only — no verdict of any kind');
});

test('E1/F4d: a retry reuses the key AND is genuinely deduplicated by withUploadIdempotency', async () => {
  const evidence = [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }];
  // ONE shared idempotency store and ONE evidence table across both passes — otherwise a "no
  // duplicate" claim is only a claim about a key, never about a record.
  const idempotencyStore = new Map();
  const evidenceRows = [];
  const first = []; const second = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence }), dispatch: contractDispatch({ actor: OWNER, log: first, idempotencyStore, evidenceRows }) });
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: seeded({ evidence, importStatus: 'PARTIALLY_IMPORTED' }), dispatch: contractDispatch({ actor: OWNER, log: second, idempotencyStore, evidenceRows }) });

  const k1 = first.find((e) => e.route.includes('/evidence/')).body.idempotency_key;
  const k2 = second.find((e) => e.route.includes('/evidence/')).body.idempotency_key;
  assert.equal(k1, evidenceIdempotencyKey('batch-1', 1, 0), 'the key is deterministic');
  assert.equal(k2, k1, 'and stable across the retry');
  assert.equal(first.find((e) => e.route.includes('/evidence/')).deduped, false, 'the first pass really creates');
  assert.equal(second.find((e) => e.route.includes('/evidence/')).deduped, true, 'the retry is deduplicated by the real helper');
  assert.equal(evidenceRows.length, 1, 'ONE evidence record exists after two passes');
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
    supabaseClient: seeded({ seedActorId: DEALER_ID }),
    req: { headers: {} },
    dispatch: contractDispatch({ actor: DEALER, memberships: { [DEALER_ID]: [TENANT_A] }, log }),
  });
  assert.equal(result.created, 1, 'the dealer replay must not lose its organisational scope');
  const create = log.find((e) => e.route === '/api/vehicles/add');
  assert.equal(create.tenant_id, TENANT_A);
  assert.equal(create.current_seller_type, 'Dealer');
});

// K-4 moved these refusals EARLIER. The catalogue no longer offers `import` for an actor with no
// listing subject, so execute is refused by its own capability gate before any row is considered,
// rather than admitting the batch and failing each row. The guarantee is unchanged and now holds
// sooner: nothing is created and nothing is dispatched.
test('E3: a DEALER WITHOUT a valid tenant is refused, not silently downgraded', async () => {
  const log = [];
  const actor = { id: DEALER_ID, role: 'dealer', platformRole: 'dealer', requestedRole: 'dealer' };
  await assert.rejects(
    () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, actor, {
      supabaseClient: seeded({ seedActorId: DEALER_ID }),
      dispatch: contractDispatch({ actor, log }),
    }),
    (e) => { assert.match(String(e.message), /WORKBOOK_TEMPLATE_NOT_AVAILABLE/); return true; },
    'a dealer with no listing subject must not execute a dealer inventory import');
  assert.equal(log.length, 0, 'and nothing was dispatched');
});

test('E3: a FORGED tenant is refused — the workbook cannot assert its own scope', async () => {
  const log = [];
  await assert.rejects(
    () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true },
      { ...DEALER, tenantId: '11111111-2222-4333-8444-555555555555' }, {
        supabaseClient: seeded({ seedActorId: DEALER_ID }),
        dispatch: contractDispatch({ actor: DEALER, memberships: { [DEALER_ID]: [TENANT_A] }, log }),
      }),
    (e) => { assert.match(String(e.message), /WORKBOOK_TEMPLATE_NOT_AVAILABLE/); return true; });
  assert.equal(log.length, 0, 'membership is re-verified server-side; nothing reached a route');
});

test('E3: a dealer cannot write into ANOTHER tenant — evidence included', async () => {
  const log = [];
  await assert.rejects(
    () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true },
      { ...DEALER, tenantId: '22222222-3333-4444-8555-666666666666' }, {
        supabaseClient: seeded({ seedActorId: DEALER_ID, evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
        dispatch: contractDispatch({ actor: DEALER, memberships: { [DEALER_ID]: [TENANT_A] }, log }),
      }),
    (e) => { assert.match(String(e.message), /WORKBOOK_TEMPLATE_NOT_AVAILABLE/); return true; });
  assert.equal(log.filter((e) => e.route.includes('/evidence/')).length, 0,
    'no evidence may be written under a tenant the actor does not hold');
});

test('E3: evidence replay keeps the SAME valid tenant scope as the vehicle it belongs to', async () => {
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, DEALER, {
    supabaseClient: seeded({ seedActorId: DEALER_ID, evidence: [{ evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://x/a.pdf', file_mime_type: 'application/pdf' }] }),
    dispatch: contractDispatch({ actor: DEALER, memberships: { [DEALER_ID]: [TENANT_A] }, log }),
  });
  const evidenceCall = log.find((e) => e.route.includes('/evidence/'));
  assert.equal(evidenceCall.tenant_id, TENANT_A);
});

test('E3: x-user-id is never forwarded — an asserted identity is not authority', async () => {
  const seenHeaders = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, DEALER, {
    supabaseClient: seeded({ seedActorId: DEALER_ID }),
    dispatch: async (routePath, _m, body, headers = {}) => {
      seenHeaders.push(headers);
      return routePath === '/api/vehicles/add' ? { status: 201, body: { success: true, vin: body.vin } } : { status: 201, body: {} };
    },
  });
  for (const headers of seenHeaders) {
    assert.equal(Object.prototype.hasOwnProperty.call(headers, 'x-user-id'), false);
  }
});
