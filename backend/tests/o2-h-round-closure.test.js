/**
 * O2 — H-round closure of the G-round findings.
 *
 * The permanent rule these guards encode: DRY RUN MAY EXPLAIN. EXECUTE MUST AUTHORIZE.
 *
 * A persisted batch is a DATA SNAPSHOT, never a capability token. Every test here drives
 * `executeVehicleWorkbookImport` — the real production entry point — and derives the actor the
 * way a route does, so nothing is proven through a harness the product never runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeVehicleWorkbookImport,
  trustedActorHeaders,
} from '../services/workbook/vehicleWorkbookImportService.js';
import { resolveWorkbookCatalogue, UNAVAILABLE_REASONS } from '../services/workbook/workbookCatalogueService.js';
import { buildVehicleListingCandidate, getListingEligibility } from '../services/marketplace/marketplaceListingEligibility.js';
import { withUploadIdempotency, isIdempotencyUniqueViolation } from '../services/evidence/uploadIdempotency.js';
import { VEHICLE_WORKBOOK_SHEETS } from '../constants/workbook/workbookFieldRegistry.js';
import { CLASS_SUBTYPES } from '../services/evidence/evidenceTaxonomy.js';
import {
  validateEvidenceUploadPayload,
  canUploadEvidenceRecord,
  isSupportedMimeType,
} from '../services/evidence/evidenceService.js';

const OWNER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DEALER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const TENANT_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TENANT_B = '22222222-3333-4444-8555-666666666666';
const VIN = 'JTMHY7AJ2K4012345';

const OWNER = { id: OWNER_ID, role: 'owner', platformRole: 'owner' };
const DEALER = { id: DEALER_ID, role: 'dealer', platformRole: 'dealer', requestedRole: 'dealer', tenantId: TENANT_A };
const REG = { evidence_class: 'registration', evidence_subtype: 'registration_book', file_url: 'https://f/a.pdf', file_mime_type: 'application/pdf' };
const AUCTION = { evidence_class: 'auction', evidence_subtype: 'auction_sheet', file_url: 'https://f/b.pdf', file_mime_type: 'application/pdf' };

const vehiclePayload = (vin) => ({
  vin, make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD',
  mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.',
});

/* ── a client that behaves like the real store for the tables execute touches ──────────── */
function client({ rows = [], template = 'seller_vehicles', uploadedBy = OWNER_ID, importStatus = 'VALIDATED', extraTables = {} } = {}) {
  const db = {
    diaspora_workbook_import_batches: [{ id: 'batch-1', uploaded_by: uploadedBy, template_type: template, import_status: importStatus }],
    diaspora_workbook_import_rows: rows,
    diaspora_workbook_import_receipts: [],
    ...extraTables,
  };
  const tableOf = (n) => { if (!db[n]) db[n] = []; return db[n]; };
  const matches = (row, f) => f.every(({ column, value }) => row[column] === value);
  function builder(table) {
    const state = { filters: [], insertRows: null, updatePatch: null };
    const api = {
      select() { return api; },
      eq(c, v) { state.filters.push({ column: c, value: v }); return api; },
      in(c, v) { state.filters.push({ column: c, value: v[0] }); return api; },
      order() { return api; }, limit() { return api; },
      insert(r) { state.insertRows = Array.isArray(r) ? r : [r]; return api; },
      update(p) { state.updatePatch = p; return api; },
      single() { return api.then((r) => ({ data: (r.data || [])[0] ?? null, error: r.error })); },
      maybeSingle() { return api.single(); },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      if (state.insertRows) { tableOf(table).push(...state.insertRows.map((r) => ({ ...r }))); return { data: state.insertRows, error: null }; }
      if (state.updatePatch) { for (const r of tableOf(table)) if (matches(r, state.filters)) Object.assign(r, state.updatePatch); return { data: null, error: null }; }
      return { data: tableOf(table).filter((r) => matches(r, state.filters)), error: null };
    }
    return api;
  }
  return { from: (t) => builder(t), _db: db };
}

const importRow = ({ n = 1, vin = VIN, evidence = [] } = {}) => ({
  id: `row-${n}`, batch_id: 'batch-1', sheet_name: 'VEHICLES', workbook_row_number: n,
  workbook_record_id: vin, validation_status: 'ACCEPTED',
  normalized_payload: vehiclePayload(vin),
  metadata: evidence.length ? { evidence } : null,
});

/** A dispatcher that answers as the canonical routes do, and RECORDS every mutation attempt. */
/**
 * J-3 — the governed dealership register. `/api/vehicles/add` resolves the dealer's tenant from
 * `dealer_profiles`, so a dispatcher that models that route must resolve it the same way; a
 * dispatcher that granted Dealer authority from the header alone would model a route that no
 * longer exists.
 */
const GOVERNED_DEALERSHIPS = new Map([[DEALER_ID, TENANT_A], ['d1', TENANT_A]]);
const dealershipSubject = (userId, tenantId) => (
  Boolean(tenantId) && GOVERNED_DEALERSHIPS.get(userId) === tenantId
    ? { granted: true, tenantId, dealerProfileId: 'dp-1', reason: null }
    : { granted: false, tenantId: null, dealerProfileId: null, reason: 'no_governed_dealer_binding' });

function canonicalDispatch({ actor, memberships = {}, log = [], evidenceRows = [], idempotencyStore = new Map() } = {}) {
  return async (routePath, method, body, headers = {}) => {
    const tenant = headers['x-tenant-id'] || null;
    if (tenant && !(memberships[actor.id] || []).includes(tenant)) {
      return { status: 403, body: { error: 'Forbidden. You do not have access to this tenant organization.' } };
    }
    const userContext = { id: actor.id, role: headers['x-stakeholder-role'] || actor.role, tenantId: tenant };
    if (routePath === '/api/vehicles/add') {
      const candidate = buildVehicleListingCandidate({
        body, userContext, dealerListingSubject: dealershipSubject(userContext.id, userContext.tenantId),
      });
      const eligibility = getListingEligibility(candidate);
      log.push({ route: routePath, vin: body.vin, tenant_id: candidate.tenant_id, seller_type: candidate.current_seller_type });
      if (!eligibility.eligible) return { status: 400, body: { error: eligibility.reasons.join(', '), code: 'MARKETPLACE_INELIGIBLE' } };
      return { status: 201, body: { success: true, vin: body.vin } };
    }
    let normalized;
    try { normalized = validateEvidenceUploadPayload(body, { requireVehicleId: false }); }
    catch (e) { return { status: 400, body: { error: String(e.message) } }; }
    if (!canUploadEvidenceRecord(normalized, userContext.role)) return { status: 403, body: { error: 'Forbidden' } };
    if (!body.file && !isSupportedMimeType(body.mime_type)) return { status: 400, body: { error: 'Unsupported file type' } };
    const out = await withUploadIdempotency(body.idempotency_key, body.vehicle_id || null, async () => {
      const id = `ev-${evidenceRows.length + 1}`;
      // The receiving authority's server-authored initial state (H14).
      evidenceRows.push({ id, verification_status: 'pending', trust_score_impact: 0, trust_impact: 0, class: normalized.evidenceClass });
      return { id };
      // J-2: the collision domain is (actor, key), exactly as the route now supplies it.
    }, { store: idempotencyStore, actorId: actor.id });
    log.push({ route: routePath, body, deduped: out.deduped });
    return { status: 201, body: { success: true, evidence_id: out.evidenceId } };
  };
}

/* ── H1/H2/H4 — execute authorizes ─────────────────────────────────────────────────────── */
test('H1: a role-forbidden evidence row creates NO vehicle and NO evidence', async () => {
  const c = client({ rows: [importRow({ evidence: [AUCTION] })] });
  const log = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: c, dispatch: canonicalDispatch({ actor: OWNER, log }) });
  assert.equal(log.length, 0, 'the refusal precedes the vehicle create — the G-round proved it did not');
  assert.equal(result.created, 0);
  assert.equal(c._db.diaspora_workbook_import_receipts[0].error_code, 'EVIDENCE_ROLE_FORBIDDEN');
});

test('H1: a wrong-class subtype creates NO vehicle', async () => {
  const c = client({ rows: [importRow({ evidence: [{ ...REG, evidence_subtype: 'export_yard_photo' }] })] });
  const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: c, dispatch: canonicalDispatch({ actor: OWNER, log }) });
  assert.equal(log.length, 0);
  assert.equal(c._db.diaspora_workbook_import_receipts[0].error_code, 'EVIDENCE_CLASSIFICATION_INVALID');
});

test('H2: execute requires CURRENT import capability for the batch\'s own template', async () => {
  // A dealer-inventory batch executed by an account with no dealer business.
  const c = client({ rows: [importRow()], template: 'dealer_vehicle_inventory' });
  await assert.rejects(
    () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, { supabaseClient: c, dispatch: canonicalDispatch({ actor: OWNER }) }),
    (e) => { assert.match(e.message, /WORKBOOK_TEMPLATE_NOT_AVAILABLE/); return true; },
  );
  assert.equal(c._db.diaspora_workbook_import_receipts.length, 0, 'refused before any receipt or write');
});

test('H3: ROLE DRIFT — a batch valid at dry run is refused once the role no longer permits it', async () => {
  const c = client({ rows: [importRow({ evidence: [AUCTION] })], uploadedBy: DEALER_ID, template: 'dealer_vehicle_inventory' });
  const log = [];
  // T0: a dealer could file auction evidence. T1: the account is now an owner. T2: execute.
  const demoted = { id: DEALER_ID, role: 'owner', platformRole: 'owner' };
  await assert.rejects(
    () => executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, demoted, { supabaseClient: c, dispatch: canonicalDispatch({ actor: demoted, log }) }),
    /WORKBOOK_TEMPLATE_NOT_AVAILABLE/,
  );
  assert.equal(log.length, 0, 'a dry-run result is not a capability token');
});

test('H3: TENANT DRIFT — a dealer whose tenant context is gone cannot list under it', async () => {
  const c = client({ rows: [importRow()], uploadedBy: DEALER_ID, template: 'dealer_vehicle_inventory' });
  const log = [];
  const withoutTenant = { ...DEALER, tenantId: null };
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, withoutTenant,
    { supabaseClient: c, dispatch: canonicalDispatch({ actor: withoutTenant, log }) });
  assert.equal(result.created, 0);
  assert.equal(log.length, 0, 'listing eligibility is re-derived before the write, not read from the snapshot');
  assert.equal(c._db.diaspora_workbook_import_receipts[0].error_code, 'LISTING_NOT_ELIGIBLE');
});

/* ── H5 — mixed batch: partial batch success, never partial mutation within a failed row ── */
test('H5: a mixed batch commits only its valid rows, and a failed row leaves NOTHING behind', async () => {
  const rows = [
    importRow({ n: 1, vin: 'JTMHY7AJ2K4012345', evidence: [REG] }),
    importRow({ n: 2, vin: 'WVWZZZ1JZXW000010', evidence: [{ ...REG, evidence_subtype: 'export_yard_photo' }] }),
    importRow({ n: 3, vin: 'WVWZZZ1JZXW000011', evidence: [AUCTION] }),
    importRow({ n: 4, vin: 'WVWZZZ1JZXW000012', evidence: [REG] }),
  ];
  const c = client({ rows });
  const log = []; const evidenceRows = [];
  const result = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: c, dispatch: canonicalDispatch({ actor: OWNER, log, evidenceRows }) });

  assert.equal(result.created, 2, 'rows 1 and 4 commit');
  assert.equal(result.failed, 2, 'rows 2 and 3 do not');
  const createdVins = log.filter((e) => e.route === '/api/vehicles/add').map((e) => e.vin);
  assert.deepEqual(createdVins, ['JTMHY7AJ2K4012345', 'WVWZZZ1JZXW000012'],
    'no vehicle exists for either failed row — partial BATCH success is not partial MUTATION');
  const byRow = Object.fromEntries(c._db.diaspora_workbook_import_receipts.map((r) => [r.row_number, r.error_code || r.outcome]));
  assert.deepEqual(byRow, { 1: 'accepted', 2: 'EVIDENCE_CLASSIFICATION_INVALID', 3: 'EVIDENCE_ROLE_FORBIDDEN', 4: 'accepted' });
  assert.equal(result.importStatus, 'PARTIALLY_IMPORTED');
});

test('H5: retrying that mixed batch converges — no duplicate evidence for the rows that worked', async () => {
  const rows = () => [importRow({ n: 1, evidence: [REG] }), importRow({ n: 2, vin: 'WVWZZZ1JZXW000010', evidence: [AUCTION] })];
  const evidenceRows = []; const idempotencyStore = new Map();
  const first = client({ rows: rows() });
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: first, dispatch: canonicalDispatch({ actor: OWNER, evidenceRows, idempotencyStore }) });
  const second = client({ rows: rows(), importStatus: 'PARTIALLY_IMPORTED' });
  const retry = await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER,
    { supabaseClient: second, dispatch: canonicalDispatch({ actor: OWNER, evidenceRows, idempotencyStore }) });
  assert.equal(evidenceRows.length, 1, 'the successful row is not re-created on retry');
  assert.equal(retry.importStatus, 'PARTIALLY_IMPORTED', 'and the still-forbidden row still fails');
});

/* ── H6 — data snapshot frozen, authority fresh ─────────────────────────────────────────── */
test('H6: execute reads the PERSISTED batch payload — a client cannot substitute rows or template', async () => {
  const c = client({ rows: [importRow({ evidence: [REG] })] });
  const log = [];
  await executeVehicleWorkbookImport(
    // Extra keys a hostile caller might try; the signature accepts only batchId + confirm.
    { batchId: 'batch-1', confirm: true, rows: [importRow({ vin: 'WVWZZZ1JZXW000099' })], template_key: 'dealer_vehicle_inventory' },
    OWNER, { supabaseClient: c, dispatch: canonicalDispatch({ actor: OWNER, log }) });
  const created = log.filter((e) => e.route === '/api/vehicles/add').map((e) => e.vin);
  assert.deepEqual(created, [VIN], 'the persisted snapshot decided the data, not the request');
});

/* ── H7/H8/H9 — no client field may mint a listing subject ──────────────────────────────── */
const subjectFor = (body, userContext, dealerListingSubject = dealershipSubject(userContext.id, userContext.tenantId)) => {
  const c = buildVehicleListingCandidate({ body: { ...vehiclePayload(VIN), ...body }, userContext, dealerListingSubject });
  return { owner: c.owner_id, tenant: c.tenant_id, type: c.current_seller_type, eligible: getListingEligibility(c).eligible };
};

test('H8: an ordinary Admin cannot mint a subject from the request body', () => {
  const admin = { id: 'a1', role: 'admin', tenantId: null };
  assert.deepEqual(subjectFor({ tenant_id: TENANT_A }, admin), { owner: null, tenant: null, type: null, eligible: false });
  assert.deepEqual(subjectFor({ owner_id: OWNER_ID }, admin), { owner: null, tenant: null, type: null, eligible: false });
  assert.deepEqual(subjectFor({ current_seller_type: 'Dealer' }, admin), { owner: null, tenant: null, type: null, eligible: false });
});

test('H8: Government cannot either', () => {
  const gov = { id: 'g1', role: 'government', tenantId: null };
  assert.equal(subjectFor({ tenant_id: TENANT_A }, gov).eligible, false);
  assert.equal(subjectFor({ owner_id: OWNER_ID }, gov).eligible, false);
});

test('H9/I-2: an Admin cannot list as ANY tenant — neither the body\'s nor its own context\'s', () => {
  const admin = { id: 'a1', role: 'admin', tenantId: TENANT_A };
  // The H-round asserted `tenant === TENANT_A, type === 'Dealer'` here. I-2 disproved that:
  // `authorizeRole` sets tenantId from ANY tenant_users row, and generic membership is not a
  // governed selling capability. Both the body tenant and the context tenant now yield nothing.
  assert.deepEqual(subjectFor({ tenant_id: TENANT_B }, admin), { owner: null, tenant: null, type: null, eligible: false });
  assert.deepEqual(subjectFor({}, admin), { owner: null, tenant: null, type: null, eligible: false });
});

test('H8 POSITIVE CONTROLS: legitimate subjects still work', () => {
  assert.deepEqual(subjectFor({}, { id: OWNER_ID, role: 'owner', tenantId: null }), { owner: OWNER_ID, tenant: null, type: 'Private Owner', eligible: true });
  assert.deepEqual(subjectFor({}, { id: DEALER_ID, role: 'dealer', tenantId: TENANT_A }), { owner: null, tenant: TENANT_A, type: 'Dealer', eligible: true });
  // NOT a positive control any more: see H9/I-2. An admin with a tenant context is refused,
  // because membership in an organisation is not authority to sell on its behalf.
  assert.equal(subjectFor({}, { id: 'a1', role: 'admin', tenantId: TENANT_A }).eligible, false);
});

test('H8: a dealer cannot borrow another tenant through the body either', () => {
  assert.equal(subjectFor({ tenant_id: TENANT_B }, { id: DEALER_ID, role: 'dealer', tenantId: TENANT_A }).tenant, TENANT_A);
});

test('H22: the workbook forwards no x-user-id, and only the validated scope', () => {
  const headers = trustedActorHeaders({ ...DEALER, tenantId: TENANT_A });
  assert.deepEqual(Object.keys(headers).sort(), ['x-stakeholder-role', 'x-tenant-id']);
  assert.equal(headers['x-tenant-id'], TENANT_A);
  assert.equal(Object.prototype.hasOwnProperty.call(trustedActorHeaders({ id: 'x' }), 'x-user-id'), false);
});

/* ── H10 — the subtype vocabulary carries real codes ────────────────────────────────────── */
test('H10: the advisory subtype vocabulary is real canonical codes, not array indices', () => {
  const values = VEHICLE_WORKBOOK_SHEETS.EVIDENCE_NOTES.fields.find((f) => f.key === 'evidence_subtype').vocabulary.map((v) => v.value);
  assert.ok(values.includes('registration_book'));
  assert.ok(values.includes('export_yard_photo'));
  assert.equal(values.some((v) => /^[0-9]+$/.test(v)), false, 'the bug produced "0","1","2"…');
  assert.equal(values.length, new Set(values).size, 'no duplicates');
  const canonicalCodes = new Set(Object.values(CLASS_SUBTYPES).flatMap((list) => list.map((e) => (typeof e === 'string' ? e : e.code))));
  for (const value of values) assert.ok(canonicalCodes.has(value), `${value} is not a canonical subtype code`);
});

test('H11: the vocabulary is advisory — the class/subtype decision stays canonical', () => {
  const field = VEHICLE_WORKBOOK_SHEETS.EVIDENCE_NOTES.fields.find((f) => f.key === 'evidence_subtype');
  assert.equal(field.vocabularyMode, 'advisory');
  assert.doesNotMatch(field.help, /dropdown (enforces|guarantees)/i);
  assert.match(field.help, /CarUp checks/i, 'the help must say where the real check happens');
});

/* ── H14 — the receiving authority hard-sets the initial state ──────────────────────────── */
test('H14: workbook-imported evidence starts pending with zero trust impact, whatever is sent', async () => {
  const evidenceRows = []; const log = [];
  await executeVehicleWorkbookImport({ batchId: 'batch-1', confirm: true }, OWNER, {
    supabaseClient: client({ rows: [importRow({ evidence: [REG] })] }),
    dispatch: canonicalDispatch({ actor: OWNER, log, evidenceRows }),
  });
  const sent = log.find((e) => e.route.includes('/evidence/')).body;
  const serialized = JSON.stringify(sent);
  for (const forbidden of ['verification_status', 'verified', 'is_verified', 'trust_score', 'trust_impact', 'review_outcome', 'reviewed_by', 'decision']) {
    assert.equal(serialized.includes(forbidden), false, `the workbook must not send '${forbidden}'`);
  }
  // And the receiving side's own authored state, which no request field can influence.
  assert.deepEqual(evidenceRows[0].verification_status, 'pending');
  assert.equal(evidenceRows[0].trust_score_impact, 0);
  assert.equal(evidenceRows[0].trust_impact, 0);
});

/* ── H15/H16 — concurrency-safe idempotency ─────────────────────────────────────────────── */
// HANDLER-LEVEL ONLY. This drives a SIMULATED constraint (the createFn throws 23505 itself), so it
// proves the recovery branch reacts correctly — never that the database would raise. The real
// database-backed concurrency proof lives in o2-i-round-closure.test.js (I-4).
test('H15 (handler-level): a simulated unique violation converges on one evidence effect', async () => {
  const rows = [];
  const store = new Map();
  // A store that behaves like the partial unique index: the second concurrent insert violates it.
  const supabase = {
    from: () => ({
      select: () => {
        let actorId;
        const chain = {
          eq(col, v) { if (col === 'uploaded_by') actorId = v; return chain; },
          or() { return chain; },
          async limit() {
            if (actorId === undefined) return { data: null, error: { message: 'lookup was not actor-scoped' } };
            return { data: rows.filter((r) => r.idempotency_key === 'k1' && r.uploaded_by === actorId), error: null };
          },
        };
        return chain;
      },
    }),
  };
  const create = async () => {
    if (rows.some((r) => r.idempotency_key === 'k1')) {
      const err = new Error('duplicate key value violates unique constraint "uq_vehicle_evidence_idempotency_key"');
      err.code = '23505';
      err.constraint = 'uq_vehicle_evidence_idempotency_key';
      throw err;
    }
    const row = { id: `ev-${rows.length + 1}`, vin: VIN, uploaded_by: 'u-h15', idempotency_key: 'k1', metadata: { idempotency_key: 'k1' } };
    rows.push(row);
    return row;
  };
  const [a, b] = await Promise.all([
    withUploadIdempotency('k1', VIN, create, { store, supabase, actorId: 'u-h15' }),
    withUploadIdempotency('k1', VIN, create, { store, supabase, actorId: 'u-h15' }),
  ]);
  assert.equal(rows.length, 1, 'exactly one evidence row exists after a genuine race');
  assert.equal([a.deduped, b.deduped].filter(Boolean).length, 1, 'exactly one caller is told it deduped');
  assert.equal(a.evidenceId, b.evidenceId, 'and both are given the same evidence');
});

test('H15/I-1: ONLY the idempotency index counts as dedupe — other 23505s propagate', () => {
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', constraint: 'uq_vehicle_evidence_idempotency_key' }), true);
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "uq_vehicle_evidence_idempotency_key"' }), true);
  // An unrelated unique failure must NOT become a silent success handing back another row's id.
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', constraint: 'vehicle_evidence_pkey' }), false);
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "some_other_idx"' }), false);
  assert.equal(isIdempotencyUniqueViolation({ code: '23502', message: 'null value' }), false);
});

test('H15: distinct legitimate operations are NOT suppressed', async () => {
  const rows = []; const store = new Map();
  const supabase = { from: () => ({ select: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
  const mk = (key, vin) => withUploadIdempotency(key, vin, async () => { const r = { id: `ev-${rows.length + 1}`, vin }; rows.push(r); return r; }, { store, supabase });
  await mk('workbook-evidence:b:1:0', 'VIN-A');   // same file, different VIN
  await mk('workbook-evidence:b:2:0', 'VIN-B');
  await mk('workbook-evidence:b:1:1', 'VIN-A');   // second evidence item on the same row
  await mk('workbook-evidence:c:1:0', 'VIN-A');   // a different batch
  assert.equal(rows.length, 4, 'no legitimate distinct upload may be swallowed by dedupe');
});

test('H16: a failure BEFORE the insert leaves no mapping, so the retry still creates once', async () => {
  const rows = []; const store = new Map();
  const supabase = { from: () => ({ select: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
  await assert.rejects(() => withUploadIdempotency('k2', VIN, async () => { throw new Error('storage unavailable'); }, { store, supabase }));
  assert.equal(store.has('k2'), false, 'a failed attempt must not claim the key');
  const after = await withUploadIdempotency('k2', VIN, async () => { const r = { id: 'ev-1', vin: VIN }; rows.push(r); return r; }, { store, supabase });
  assert.equal(after.deduped, false);
  assert.equal(rows.length, 1);
});

/* ── H17/H18 — catalogue truth, with fixtures that reach the branch ─────────────────────── */
function catalogueClient({ dealerProfile = null, tradeProfiles = [] } = {}) {
  const tables = { dealer_profiles: dealerProfile ? [dealerProfile] : [], diaspora_trade_profiles: tradeProfiles };
  return {
    from(table) {
      const rows = tables[table] || [];
      const api = {
        select() { return api; }, eq() { return api; }, limit() { return api; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
      };
      return api;
    },
  };
}

test('H17: a Government account gets an explicit dealer-inventory disposition, not silence', async () => {
  const catalogue = await resolveWorkbookCatalogue({ id: 'g1', role: 'government' }, { supabaseClient: catalogueClient() });
  const keys = [...catalogue.available, ...catalogue.unavailable].map((e) => e.template_key);
  assert.ok(keys.includes('dealer_vehicle_inventory'), 'every role must receive a disposition');
  const entry = catalogue.unavailable.find((e) => e.template_key === 'dealer_vehicle_inventory');
  assert.equal(entry.reason, UNAVAILABLE_REASONS.BUSINESS_CONTEXT_REQUIRED);
  assert.match(entry.note, /government account holds no dealer business/i);
  assert.equal(catalogue.available.find((e) => e.template_key === 'dealer_vehicle_inventory'), undefined,
    'legibility must not become availability');
});

test('H18: the catalogue fixtures reach the dealer and trade-role branches they claim to certify', async () => {
  const withTrade = await resolveWorkbookCatalogue({ id: 'u-trade', role: 'owner' }, {
    supabaseClient: catalogueClient({ tradeProfiles: [{ role_type: 'buyer', verification_status: 'VERIFIED' }] }),
  });
  const diasporaOffered = withTrade.available.filter((e) => e.engine === 'diaspora').map((e) => e.template_key);
  assert.ok(diasporaOffered.includes('buyer'),
    `a VERIFIED buyer trade role must open the buyer template (got: ${diasporaOffered.join(',') || 'none'})`);

  const withoutTrade = await resolveWorkbookCatalogue({ id: 'u-none', role: 'owner' }, { supabaseClient: catalogueClient() });
  assert.equal(withoutTrade.available.filter((e) => e.engine === 'diaspora').length, 0);
  const denied = withoutTrade.unavailable.find((e) => e.template_key === 'buyer');
  assert.ok(denied, 'and the refusal carries a reason');
  assert.ok(denied.reason, denied.reason);
});

test('H18: an unverified trade profile does not open the diaspora templates', async () => {
  const catalogue = await resolveWorkbookCatalogue({ id: 'u-pending', role: 'owner' }, {
    supabaseClient: catalogueClient({ tradeProfiles: [{ role_type: 'buyer', verification_status: 'PENDING' }] }),
  });
  assert.equal(catalogue.available.filter((e) => e.engine === 'diaspora').length, 0);
});
