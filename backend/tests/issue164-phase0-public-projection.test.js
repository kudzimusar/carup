/**
 * Issue #164 — Canonical Vehicle Truth Closure, Phase 0 permanent guard.
 *
 * Phase 0 closed a set of anonymous-disclosure defects and shipped no test to
 * hold them closed. This suite is that guard. Each test states the guarantee in
 * plain language so a failure names the promise that broke, not the line that
 * moved.
 *
 * The guarantees, and the regression each test is watching for:
 *
 *   1. utils/publicVehicleProjection.js is the SINGLE definition of the public
 *      surface. Adding a column to `vehicles` must not widen it.
 *   2. findPrivateFieldLeaks() is the detector the rest of the suite leans on.
 *      A vacuous detector would make every other assertion pass silently, so it
 *      is proved against a nested/array-nested leak before it is trusted.
 *   3. buildVehiclePassport() decides audience from req.userContext ONLY. The
 *      original defect was an unverified request header buying the owner
 *      audience; a header read reintroduced anywhere in that function restores
 *      a forgeable gate, so the function body is checked for one directly.
 *   4. Free text is part of the response body. An identifier interpolated into a
 *      sentence escapes structured redaction exactly as a stray column would,
 *      and a key-name scan cannot see it.
 *   5. The marketplace summary must not become an identifier oracle: a plate or
 *      chassis must be neither echoed nor matchable.
 *
 * TESTING APPROACH — why this file reads source text and injects dependencies
 * rather than starting the app: backend/db/supabase.js throws at import time
 * without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, so importing server.js is not
 * possible in a hermetic unit run. This follows the house pattern established by
 * backend/tests/db-compat-legacy-scopes.test.js (source-contract assertions on
 * server.js), and extends it: the shipped buildVehiclePassport source is
 * extracted and executed against stub collaborators, so the anonymous-audience
 * guarantees are proved BEHAVIOURALLY against the real code path rather than
 * inferred from a regex. Tests that can only be checked as text say so in their
 * name.
 *
 * Assertions are formatting-tolerant by construction — no line numbers, no exact
 * whitespace, column lists compared as token sets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PUBLIC_VEHICLE_FIELDS,
  PRIVATE_VEHICLE_FIELDS,
  OWNER_ADDITIONAL_VEHICLE_FIELDS,
  PUBLIC_VEHICLE_SELECT,
  OWNER_VEHICLE_SELECT,
  toPublicVehicle,
  toOwnerVehicle,
  projectVehicle,
  findPrivateFieldLeaks,
  toPublicEvidence,
  toPublicPlateHistory,
  toPublicTimelineEvent,
} from '../utils/publicVehicleProjection.js';

import {
  buildMarketplaceListingSummary,
  listMarketplaceListings,
  LISTING_SELECT_COLUMNS,
} from '../services/marketplace/listingSummaryService.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const marketplaceSrc = readFileSync(
  new URL('../services/marketplace/listingSummaryService.js', import.meta.url),
  'utf8',
);

// Sentinels: distinctive enough that a substring hit in a serialized body is a
// real leak and not an accidental match on ordinary listing text.
const PLATE = 'AEZ1234';
const NORMALIZED_PLATE = 'aez1234';
const CHASSIS = 'CHASSISLEAKCANARY';
const ENGINE = 'ENGINELEAKCANARY';
const TEMP_ID = 'TEMPIDLEAKCANARY';
const TEMP_PLATE_ID = 'TEMPPLATELEAKCANARY';
const OWNER_ID = 'a1b2c3d4-0000-4000-8000-00000000owner';
const TENANT_ID = 'a1b2c3d4-0000-4000-8000-0000000tenant';
const UPLOADER_ID = 'a1b2c3d4-0000-4000-8000-000000upload';
const REVIEWER_ID = 'a1b2c3d4-0000-4000-8000-000000review';
const WITHHELD_REASON = 'WITHHELDREASONCANARY';

/**
 * Plate history spanning the visibility states. Only the 'public' row may reach an
 * anonymous caller — and even then without the number itself.
 */
const PUBLIC_PLATE_ROW_ID = 'ph-public-1';
const PRIVATE_PLATE_ROW_ID = 'ph-private-1';
const plateHistory = [
  {
    id: PUBLIC_PLATE_ROW_ID, vin: '1HGCM82633A004352', plate_number: PLATE,
    normalized_plate_number: NORMALIZED_PLATE, plate_type: 'permanent', status: 'active',
    record_visibility: 'public', created_by: UPLOADER_ID, verified_by: REVIEWER_ID,
    reason: null, source_reference: 'internal-ref-1', owner_id: OWNER_ID,
  },
  {
    id: PRIVATE_PLATE_ROW_ID, vin: '1HGCM82633A004352', plate_number: PLATE,
    normalized_plate_number: NORMALIZED_PLATE, plate_type: 'permanent', status: 'suspended',
    record_visibility: 'private', created_by: UPLOADER_ID, verified_by: REVIEWER_ID,
    reason: WITHHELD_REASON, source_reference: 'internal-ref-2', owner_id: OWNER_ID,
  },
  {
    // Never declared its visibility: absence is not permission.
    id: 'ph-null-1', vin: '1HGCM82633A004352', plate_number: PLATE,
    normalized_plate_number: NORMALIZED_PLATE, plate_type: 'temporary', status: 'active',
    record_visibility: null, created_by: UPLOADER_ID, verified_by: REVIEWER_ID,
  },
];
const SELLER_ID = 'a1b2c3d4-0000-4000-8000-0000000seller';
// Structurally valid VIN (ISO 3779, no I/O/Q) so marketplace fixture-exclusion
// rules treat the row as real data rather than a seed fixture.
const VIN = '1HGCM82633A004352';

/** A raw `select('*')` row carrying every private field, for leak assertions. */
function rawVehicleRow(overrides = {}) {
  return {
    vin: VIN,
    make: 'Toyota',
    model: 'Hilux',
    year: 2019,
    color: 'White',
    mileage: 40000,
    price: 25000,
    currency: 'USD',
    status: 'Available',
    publication_status: 'published',
    created_at: '2026-01-01T00:00:00.000Z',
    plate_status: 'active',
    registration_status: 'registered',
    registration_country: 'ZW',
    plate_verified_at: '2026-01-02T00:00:00.000Z',
    plate_verification_source: 'CVR',
    current_seller_type: 'private',
    public_seller_display_enabled: false,
    // every field the contract calls private
    owner_id: OWNER_ID,
    tenant_id: TENANT_ID,
    current_seller_id: SELLER_ID,
    engine_number: ENGINE,
    chassis_number: CHASSIS,
    plate_number: PLATE,
    normalized_plate_number: NORMALIZED_PLATE,
    temp_plate_id: TEMP_PLATE_ID,
    temporary_identification_number: TEMP_ID,
    ...overrides,
  };
}

/** Split a Supabase `.select()` column list into bare column tokens. */
function selectTokens(select) {
  return select
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

/** Serialize a response body so free text can be scanned for identifiers. */
function serializeDeep(payload) {
  return JSON.stringify(payload, (key, value) =>
    (typeof value === 'bigint' ? value.toString() : value));
}

/**
 * Slice a balanced `{...}` or `(...)` span starting at `openIdx`, skipping over
 * comments and string/template literals so braces inside them do not miscount.
 * Formatting-independent: it reads structure, never layout.
 */
function sliceBalanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          const substitution = sliceBalanced(src, i + 1);
          i += 1 + substitution.length;
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
    i++;
  }
  throw new Error(`unbalanced ${open} starting at offset ${openIdx}`);
}

/**
 * Blank out comments, keeping string literals intact.
 *
 * The header assertions below must read CODE, not prose: buildVehiclePassport's
 * own comments correctly explain what optionalAuth() does with x-user-id, and
 * documenting the rule must never be mistaken for breaking it. String literals
 * are preserved because a header read (`req.headers['x-user-id']`) is one.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2) + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i]; i++; }
        out += src[i];
        i++;
      }
      out += src[i] ?? '';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Source text of `async function buildVehiclePassport(...) { ... }`. */
function buildVehiclePassportSource() {
  const declIdx = serverSrc.indexOf('async function buildVehiclePassport');
  assert.ok(
    declIdx > -1,
    'buildVehiclePassport must still exist in server.js — if it was renamed or moved, retarget this guard rather than deleting it',
  );
  const braceIdx = serverSrc.indexOf('{', serverSrc.indexOf(')', declIdx));
  return serverSrc.slice(declIdx, braceIdx) + sliceBalanced(serverSrc, braceIdx);
}

/** Source text of the timeline-sanitizing callback inside buildVehiclePassport. */
function timelineSanitizerSource() {
  const fnSrc = buildVehiclePassportSource();
  const mapIdx = fnSrc.indexOf('audienceTimeline.map(');
  assert.ok(
    mapIdx > -1,
    'the passport must still sanitize its timeline in-place via audienceTimeline.map() — retarget this guard if that moved to a helper',
  );
  return sliceBalanced(fnSrc, fnSrc.indexOf('(', mapIdx));
}

/**
 * Instantiate the SHIPPED buildVehiclePassport source with stub collaborators.
 * This runs the real function body — not a copy — without importing server.js
 * (which would import backend/db/supabase.js and throw without credentials).
 *
 * If this throws ReferenceError for an unknown name, buildVehiclePassport grew a
 * new collaborator: add it to the injection list below. Do not delete the test.
 */
function instantiatePassportBuilder({ vehicle, timeline, chain }) {
  const source = buildVehiclePassportSource();
  const dependencies = [
    'supabase',
    'getVehicleTimeline',
    'normalizeEvidenceRecord',
    'mergeEventsWithEvidence',
    'computeVehicleTrustScore',
    'verifyChain',
    'projectVehicle',
    'toPublicEvidence',
    'toPublicPlateHistory',
    'toPublicTimelineEvent',
    'PASSPORT_PRIVILEGED_ROLES',
  ];

  const queryStub = (data) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      single: async () => ({ data, error: null }),
      then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return builder;
  };

  const supabase = {
    from(table) {
      switch (table) {
        case 'vehicles': return queryStub(vehicle);
        case 'users': return queryStub({ name: 'Jane Owner' });
        // Related rows deliberately carry private columns too: the passport must
        // redact them on the way out, not rely on the query being narrow.
        case 'vehicle_evidence':
          return queryStub([{
            id: 'ev-1', vin: vehicle.vin, plate_number: PLATE, chassis_number: CHASSIS,
            note: 'Neutral evidence note', file_url: 'https://example.test/e.jpg',
            // Evidence carries its OWN internal identity, which the vehicle deny-list never named.
            uploaded_by: UPLOADER_ID, verified_by: REVIEWER_ID, tenant_id: TENANT_ID,
            file_path: 'bucket/internal/path.jpg', storage_bucket: 'vehicle-images',
            verification_notes: 'internal reviewer note', metadata: { internal: OWNER_ID },
          }]);
        case 'vehicle_plate_history':
          return queryStub(plateHistory);
        case 'vehicle_ownership_history':
          return queryStub([{ vin: vehicle.vin }, { vin: vehicle.vin }]);
        default: return queryStub([]);
      }
    },
  };

  // The SHIPPED allow-list projections are injected, not restated, so a weakening of
  // the real contract fails these tests rather than passing against a local copy.
  // mergeEventsWithEvidence is NOT an identity stub. The real one derives a timeline item from
  // each evidence row (evidenceService.evidenceToTimelineItem), lifting that row's own columns
  // to the event's TOP level — `metadata` and `verification_notes` among them. Stubbing it as
  // identity is what hid a live leak of the registry identifiers through the timeline, so this
  // reproduces the shape that matters: the derived item, carrying its source row's fields.
  const mergeEventsWithEvidence = (events, evidenceRows) => [
    ...events,
    ...(evidenceRows || []).map((row) => ({
      id: `evidence:${row.id}`,
      event_source: 'evidence',
      event_type: row.event_type || row.evidence_type,
      evidence_type: row.evidence_type,
      timestamp: row.captured_at || row.uploaded_at || row.created_at,
      label: 'Verified Evidence',
      desc: row.verification_notes || '',
      details: { uploadedBy: row.uploaded_by },
      metadata: row.metadata || {},
      file_url: row.file_url,
      verification_notes: row.verification_notes,
      uploaded_by: row.uploaded_by,
      verified_by: row.verified_by,
      tenant_id: row.tenant_id,
    })),
  ];

  const factory = new Function(...dependencies, `return (${source});`);
  return factory(
    supabase,
    async () => timeline,
    (record) => record,
    mergeEventsWithEvidence,
    async () => ({ score: 82, band: 'high' }),
    async () => chain,
    projectVehicle,
    toPublicEvidence,
    toPublicPlateHistory,
    toPublicTimelineEvent,
    new Set(['admin', 'government']),
  );
}

/** One timeline event per publicDescription branch, each seeded with a plate. */
const TIMELINE_EVENT_SOURCES = [
  'cvr', 'ownership_transfer', 'zimra', 'insurance', 'plate_assigned',
  'temporary_id_issued', 'plate_verified', 'plate_changed', 'plate_flagged',
  'plate_suspended', 'evidence',
];

function seededTimeline() {
  return TIMELINE_EVENT_SOURCES.map((eventSource, index) => ({
    id: `event-${index}`,
    vin: VIN,
    event_source: eventSource,
    label: 'Timeline label',
    // Operator-authored text, deliberately clean: this suite asserts that the
    // VEHICLE ROW's identifiers never reach an anonymous string.
    desc: 'Operator supplied description',
    details: {
      plateNumber: PLATE,
      mileage: 41000,
      stage: 'complete',
      reason: 'Reported by CVR',
    },
  }));
}

async function buildPassport(req) {
  const build = instantiatePassportBuilder({
    vehicle: rawVehicleRow(),
    timeline: seededTimeline(),
    chain: { verified: true, count: 3, chain: [{ owner_name: 'Jane Owner', plate: PLATE }] },
  });
  return build(VIN, req);
}

// ---------------------------------------------------------------------------
// 1. Contract integrity — the allow-list is the whole public surface
// ---------------------------------------------------------------------------

test('the public field list and the private field list never overlap', () => {
  const overlap = PUBLIC_VEHICLE_FIELDS.filter(field => PRIVATE_VEHICLE_FIELDS.includes(field));
  assert.deepEqual(
    overlap,
    [],
    `a field cannot be both public and private; promote or demote it deliberately instead: ${overlap.join(', ')}`,
  );
});

test('the public Supabase projection never selects a private column', () => {
  const tokens = selectTokens(PUBLIC_VEHICLE_SELECT);
  const leaked = tokens.filter(token => PRIVATE_VEHICLE_FIELDS.includes(token));
  assert.deepEqual(
    leaked,
    [],
    `PUBLIC_VEHICLE_SELECT must not fetch private columns at all: ${leaked.join(', ')}`,
  );
  assert.deepEqual(
    tokens,
    [...PUBLIC_VEHICLE_FIELDS],
    'PUBLIC_VEHICLE_SELECT must be exactly the allow-list, so a column added to the table is not silently published',
  );
});

test('the owner projection never selects owner_id, tenant_id, current_seller_id or temp_plate_id', () => {
  // The owner audience legitimately sees the registry identifiers listed in
  // OWNER_ADDITIONAL_VEHICLE_FIELDS. Everything else in PRIVATE_VEHICLE_FIELDS
  // is internal identity and is withheld from EVERY audience, owner included.
  const neverAnyAudience = PRIVATE_VEHICLE_FIELDS
    .filter(field => !OWNER_ADDITIONAL_VEHICLE_FIELDS.includes(field));

  assert.deepEqual(
    neverAnyAudience,
    ['owner_id', 'tenant_id', 'current_seller_id', 'temp_plate_id'],
    'the never-echoed identity set changed: widening OWNER_ADDITIONAL_VEHICLE_FIELDS to cover owner_id/tenant_id/current_seller_id/temp_plate_id would make internal identity readable',
  );

  const tokens = selectTokens(OWNER_VEHICLE_SELECT);
  const leaked = tokens.filter(token => neverAnyAudience.includes(token));
  assert.deepEqual(
    leaked,
    [],
    `OWNER_VEHICLE_SELECT must never fetch internal identity: ${leaked.join(', ')}`,
  );
});

test('a public projection of a raw select(*) row returns none of the private fields', () => {
  const projected = toPublicVehicle(rawVehicleRow());

  for (const field of PRIVATE_VEHICLE_FIELDS) {
    assert.ok(
      !(field in projected),
      `toPublicVehicle() must drop ${field} entirely, even when the upstream read was select('*')`,
    );
  }
  assert.deepEqual(
    findPrivateFieldLeaks(projected),
    [],
    'the leak detector must find nothing in a public projection',
  );
  assert.deepEqual(
    Object.keys(projected).sort(),
    [...PUBLIC_VEHICLE_FIELDS].sort(),
    'the public projection shape is the allow-list and nothing else',
  );
});

test('an owner projection exposes the registry identifiers but never the owner, tenant or seller id', () => {
  const projected = toOwnerVehicle(rawVehicleRow());

  for (const field of OWNER_ADDITIONAL_VEHICLE_FIELDS) {
    assert.ok(field in projected, `the owner audience must still receive ${field}`);
  }
  assert.equal(projected.plate_number, PLATE, 'the owner sees their own plate');
  assert.equal(projected.chassis_number, CHASSIS, 'the owner sees their own chassis number');

  for (const field of ['owner_id', 'tenant_id', 'current_seller_id', 'temp_plate_id']) {
    assert.ok(
      !(field in projected),
      `${field} is internal identity and must never be echoed back, not even to the owner`,
    );
  }
});

test('an unrecognised audience falls back to the public projection rather than the owner one', () => {
  const projected = projectVehicle(rawVehicleRow(), 'moderator');
  assert.ok(
    !('plate_number' in projected),
    'projectVehicle() must fail closed: any audience that is not exactly "owner" gets the public shape',
  );
  assert.deepEqual(
    projectVehicle(rawVehicleRow()),
    toPublicVehicle(rawVehicleRow()),
    'the default audience is public',
  );
});

test('a field missing from the row projects as null instead of a plausible default', () => {
  const projected = toPublicVehicle({ vin: VIN });
  assert.equal(projected.make, null, 'unknown stays unknown — never a stand-in value');
  assert.equal(projected.trust_score, null, 'an unscored vehicle must not read as a scored one');
  assert.ok('mileage' in projected, 'the key is present so the client can render a withheld or unknown state');
});

// ---------------------------------------------------------------------------
// 2. The leak detector is not vacuous
// ---------------------------------------------------------------------------

test('the leak detector finds a private field buried in an array inside a nested object', () => {
  const payload = {
    vehicle: { vin: VIN, make: 'Toyota' },
    plateHistory: [
      { created_at: '2026-01-01', meta: { records: [{ normalized_plate_number: NORMALIZED_PLATE }] } },
    ],
  };
  assert.deepEqual(
    findPrivateFieldLeaks(payload),
    ['normalized_plate_number'],
    'a detector that only looks at top-level keys would make every other test in this file pass silently',
  );
});

test('the leak detector reports every distinct private field it finds, at any depth', () => {
  const payload = [{ owner_id: OWNER_ID }, { nested: { engine_number: ENGINE, chassis_number: CHASSIS } }];
  assert.deepEqual(
    findPrivateFieldLeaks(payload).sort(),
    ['chassis_number', 'engine_number', 'owner_id'],
    'all leaked identifiers must be named, not just the first one',
  );
});

test('the leak detector treats a withheld null identifier as redacted rather than leaked', () => {
  assert.deepEqual(
    findPrivateFieldLeaks({ identity: { plate_number: null, chassis_number: undefined } }),
    [],
    'a nulled key is the redaction contract itself — the client renders a withheld state from it',
  );
});

test('the leak detector finds nothing in a clean payload and survives a circular reference', () => {
  const clean = { vehicle: toPublicVehicle(rawVehicleRow()), timeline: [] };
  clean.self = clean;
  assert.deepEqual(findPrivateFieldLeaks(clean), [], 'a clean body must produce no findings');
});

// ---------------------------------------------------------------------------
// 3. Source-text invariants on server.js (server.js cannot be imported here:
//    backend/db/supabase.js throws without SUPABASE_URL / SERVICE_ROLE_KEY)
// ---------------------------------------------------------------------------

test('the passport builder reads no request header, so the owner audience cannot be forged (source-text assertion)', () => {
  const fnSrc = buildVehiclePassportSource();
  // Comments blanked: the function documents what optionalAuth() does with
  // x-user-id, and saying so must not read as doing so.
  const code = stripComments(fnSrc);

  assert.ok(
    !/req\s*\.\s*headers/.test(code),
    'buildVehiclePassport must never read req.headers: an unverified header buying the owner audience is the original Phase 0 defect',
  );
  for (const header of ['x-user-id', 'x-session-token', 'x-tenant-id']) {
    assert.ok(
      !new RegExp(header, 'i').test(code),
      `buildVehiclePassport must not read the ${header} header; identity is resolved by optionalAuth() before it is called`,
    );
  }
  assert.match(
    code,
    /req\s*\.\s*userContext/,
    'audience must be decided from the middleware-verified req.userContext',
  );
  assert.match(
    code,
    /actor\s*\.\s*id\s*===\s*vehicle\s*\.\s*owner_id/,
    'the owner audience must require the verified actor to actually own the vehicle',
  );
  assert.match(
    code,
    /PASSPORT_PRIVILEGED_ROLES\s*\.\s*has\s*\(/,
    'the only other route to the owner audience is the narrow privileged-role set',
  );
});

test('both passport routes are registered with optionalAuth() (source-text assertion)', () => {
  for (const route of ['/api/vehicles/:vin/passport', '/api/vehicles/passport/lookup/:identifier']) {
    const registration = `app.get('${route}'`;
    const idx = serverSrc.indexOf(registration);
    assert.ok(idx > -1, `${route} must still be registered with app.get`);
    assert.equal(
      serverSrc.indexOf(registration, idx + 1),
      -1,
      `${route} must be registered exactly once: a second registration could omit optionalAuth()`,
    );

    // Everything between the path literal and the handler's arrow is the
    // middleware chain. Whitespace-tolerant by construction.
    const middlewareChain = serverSrc.slice(idx, serverSrc.indexOf('=>', idx));
    assert.match(
      middlewareChain,
      /optionalAuth\s*\(\s*\)/,
      `${route} must resolve identity through optionalAuth(): without it req.userContext is never set, and a signed-in owner silently drops to the anonymous audience`,
    );
    assert.ok(
      !/authorizeRole\s*\(/.test(middlewareChain),
      `${route} must stay publicly reachable — optionalAuth() changes the audience, it must not become a blocking gate`,
    );
  }
});

test('the passport returns the vehicle through projectVehicle(), never the raw row (source-text assertion)', () => {
  const code = stripComments(buildVehiclePassportSource());

  assert.match(
    code,
    /vehicle\s*:\s*projectVehicle\s*\(/,
    'the returned `vehicle` must be a governed projection, not the raw select(*) row',
  );
  assert.match(
    code,
    /projectVehicle\s*\(\s*vehicle\s*,\s*isAuthorized\s*\?\s*'owner'\s*:\s*'public'\s*\)/,
    'the projection audience must be driven by the same isAuthorized decision as the rest of the body',
  );
  const returnIdx = code.lastIndexOf('return {');
  assert.ok(returnIdx > -1, 'buildVehiclePassport must still return an object literal');
  assert.ok(
    !/(^|[{,]\s*)vehicle\s*[,}]/.test(code.slice(returnIdx)),
    'the raw `vehicle` row must never be shorthand-spread into the response object',
  );
});

test('an unauthorized caller gets the ledger verdict only, never the raw chain entries (source-text assertion)', () => {
  const code = stripComments(buildVehiclePassportSource());
  const idx = code.indexOf('chainVerification:');
  assert.ok(idx > -1, 'the passport must still return a chainVerification block');

  const block = code.slice(idx, code.indexOf('identity:', idx));
  assert.match(
    block,
    /isAuthorized\s*\?/,
    'chainVerification must be audience-gated: chain[] carries uncontrolled ledger payloads that hold owner names',
  );
  assert.match(
    block,
    /chain\s*:\s*\[\s*\]/,
    'the unauthorized branch must return an empty chain, not the entries',
  );
  assert.ok(
    !/(^|[{,]\s*)chainVerification\s*[,}]/.test(code.slice(code.lastIndexOf('return {'))),
    'chainVerification must never be returned unprojected',
  );
});

// ---------------------------------------------------------------------------
// 4. Free-text leak rule — behavioural, by executing the shipped function body
// ---------------------------------------------------------------------------

test('no publicDescription branch interpolates a raw vehicle column into a sentence (source-text assertion)', () => {
  const sanitizerSrc = stripComments(timelineSanitizerSource());

  const interpolatedVehicleColumn = /\$\{[^}]*\bvehicle\s*\./.exec(sanitizerSrc);
  assert.equal(
    interpolatedVehicleColumn,
    null,
    `a timeline sentence must never interpolate a vehicle column directly — it escapes the structured redaction in identity{}: ${interpolatedVehicleColumn?.[0]}`,
  );
  assert.match(
    sanitizerSrc,
    /plateValue\s*=\s*isAuthorized\s*\?/,
    'the plate value used by every sentence must be gated on isAuthorized',
  );
  assert.match(
    sanitizerSrc,
    /tempIdValue\s*=\s*isAuthorized\s*\?/,
    'the temporary-identifier value used by every sentence must be gated on isAuthorized',
  );
});

test('an anonymous passport never returns a plate number anywhere in the body', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport);

  assert.ok(!body.includes(PLATE), 'the plate number must not appear in any field or sentence of an anonymous passport');
  assert.ok(!body.includes(NORMALIZED_PLATE), 'the normalized plate is the same identifier in another casing');
  assert.ok(!('plate_number' in passport.vehicle), 'vehicle.plate_number must be absent, not merely nulled');
  assert.equal(passport.identity.plateNumber, null, 'identity.plateNumber is withheld from the anonymous audience');
  assert.equal(passport.identity.identifiersRedacted, true, 'the body must tell the client a null means withheld, not unrecorded');
});

test('an anonymous passport never returns a temporary identification number anywhere in the body', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport);

  assert.ok(!body.includes(TEMP_ID), 'the temporary identification number must not appear in any field or sentence');
  assert.ok(!body.includes(TEMP_PLATE_ID), 'the internal temp plate id must not appear either');
  assert.ok(
    !('temporary_identification_number' in passport.vehicle),
    'vehicle.temporary_identification_number must be absent, not merely nulled',
  );
  assert.equal(passport.identity.temporaryIdentificationNumber, null, 'the camelCased identity copy is withheld too');
});

test('an anonymous passport never returns an engine number, chassis number, owner id or tenant id', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport);

  assert.deepEqual(
    findPrivateFieldLeaks(passport),
    [],
    'no private column may survive anywhere in the anonymous body, at any nesting depth',
  );
  const secrets = [
    ['engine number', ENGINE],
    ['chassis number', CHASSIS],
    ['owner id', OWNER_ID],
    ['tenant id', TENANT_ID],
    ['seller id', SELLER_ID],
  ];
  for (const [label, secret] of secrets) {
    assert.ok(!body.includes(secret), `the ${label} must not appear anywhere in an anonymous passport`);
  }
});

test('anonymous timeline text names the event instead of printing the identifier', async () => {
  const passport = await buildPassport({});

  for (const event of passport.timeline) {
    const text = [event.publicDescription, event.publicSummary, event.desc, event.label].join(' ');
    assert.ok(
      !text.includes(PLATE) && !text.includes(TEMP_ID),
      `the "${event.event_source}" sentence leaked an identifier: ${event.publicDescription}`,
    );
    assert.ok(
      event.publicDescription && event.publicDescription.trim().length > 0,
      `the "${event.event_source}" event must still describe itself — redaction must not blank the timeline`,
    );
    assert.equal(
      event.details.plateNumber,
      null,
      'details.plateNumber is the withheld identity value under another name; it must be blanked rather than dropped, so the client renders a withheld state',
    );
  }

  const plateAssigned = passport.timeline.find(event => event.event_source === 'plate_assigned');
  assert.equal(
    plateAssigned.publicDescription,
    'Number plate assigned',
    'the unauthorized sentence must name the event and emit no placeholder where a value would sit',
  );
});

test('the owner audience still receives the plate number, so the redaction tests are not vacuous', async () => {
  const passport = await buildPassport({ userContext: { id: OWNER_ID, role: 'owner' } });

  assert.equal(passport.identity.plateNumber, PLATE, 'the owner must still see their own plate');
  assert.equal(passport.vehicle.plate_number, PLATE, 'the owner projection carries the registry identifiers');
  assert.equal(passport.identity.identifiersRedacted, false, 'nothing is withheld from the owner audience');
  assert.equal(passport.chainVerification.chain.length, 1, 'the owner receives the full ledger chain');

  const plateAssigned = passport.timeline.find(event => event.event_source === 'plate_assigned');
  assert.ok(
    plateAssigned.publicDescription.includes(PLATE),
    'a sanitizer that always returned null would pass every anonymous test above; the owner path proves it does not',
  );
});

test('a signed-in stranger is treated as anonymous by the passport', async () => {
  const passport = await buildPassport({ userContext: { id: 'a-different-user', role: 'owner' } });
  const body = serializeDeep(passport);

  assert.ok(!body.includes(PLATE), 'holding a valid session for some other account must not widen the audience');
  assert.equal(passport.identity.identifiersRedacted, true, 'a stranger gets the anonymous audience');
  assert.deepEqual(passport.chainVerification.chain, [], 'a stranger gets the ledger verdict only');
});

test('an admin reviewer receives the owner audience for a vehicle they do not own', async () => {
  const passport = await buildPassport({ userContext: { id: 'a-reviewer', role: 'admin' } });
  assert.equal(passport.identity.plateNumber, PLATE, 'the narrow privileged-role set is intentional and must keep working');
});

// ---------------------------------------------------------------------------
// 5. Marketplace public summary — not an identifier oracle
// ---------------------------------------------------------------------------

test('the marketplace listing query never asks the database for a registry identifier', () => {
  const identifiers = ['plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number', 'temp_plate_id', 'temporary_identification_number'];
  for (const column of identifiers) {
    assert.ok(
      !new RegExp(`\\b${column}\\b`).test(LISTING_SELECT_COLUMNS),
      `LISTING_SELECT_COLUMNS must not fetch ${column}: no marketplace derivation reads it, so the row that reaches every consumer cannot carry it`,
    );
  }
  assert.match(
    LISTING_SELECT_COLUMNS,
    /\bplate_status\b/,
    'plate_status is a status signal rather than an identifier and must stay available to the trust tags',
  );
});

test('a marketplace summary omits plate, normalized plate and chassis even when the row carries them', () => {
  const summary = buildMarketplaceListingSummary({ vehicle: rawVehicleRow() });
  const body = serializeDeep(summary);

  for (const field of ['plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number', 'owner_id', 'tenant_id']) {
    assert.ok(
      !(field in summary),
      `${field} must be absent from the public summary shape, even when the vehicle row supplies it`,
    );
  }
  assert.deepEqual(findPrivateFieldLeaks(summary), [], 'no private field may survive into the public summary');
  const secrets = [['plate', PLATE], ['normalized plate', NORMALIZED_PLATE], ['chassis number', CHASSIS], ['engine number', ENGINE]];
  for (const [label, secret] of secrets) {
    assert.ok(!body.includes(secret), `the ${label} must not appear anywhere in the serialized summary`);
  }
  assert.equal(summary.plate_status, 'active', 'the non-identifying plate status is still published');
});

test('anonymous marketplace search matches nothing on a plate or chassis query', async () => {
  const vehicle = rawVehicleRow();
  // Chainable stub for the marketplace read path; no network, no credentials.
  const supabaseStub = {
    from(table) {
      const data = table === 'vehicles' ? [vehicle] : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        in: () => builder,
        order: () => builder,
        then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };

  const byModel = await listMarketplaceListings(supabaseStub, { q: 'Hilux' });
  assert.equal(byModel.total, 1, 'the control query must match, otherwise the negative assertions below prove nothing');

  const oracleProbes = [
    ['plate', PLATE],
    ['normalized plate', NORMALIZED_PLATE],
    ['chassis number', CHASSIS],
    ['engine number', ENGINE],
    ['temporary id', TEMP_ID],
  ];
  for (const [label, query] of oracleProbes) {
    const result = await listMarketplaceListings(supabaseStub, { q: query });
    assert.equal(
      result.total,
      0,
      `searching by ${label} must match nothing: a matching search confirms or denies an identifier and turns the anonymous endpoint into an oracle`,
    );
  }

  assert.ok(
    !serializeDeep(byModel).includes(PLATE),
    'the returned listings must not echo the plate either',
  );
});

test('the marketplace search haystack is built from non-identifying fields only (source-text assertion)', () => {
  const idx = marketplaceSrc.indexOf('function summaryMatchesSearch');
  assert.ok(idx > -1, 'summaryMatchesSearch must still exist');
  const haystackIdx = marketplaceSrc.indexOf('const haystack', idx);
  const haystack = stripComments(
    sliceBalanced(marketplaceSrc, marketplaceSrc.indexOf('[', haystackIdx)),
  );

  for (const field of ['plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number', 'plate', 'chassis']) {
    assert.ok(
      !new RegExp(`\\b${field}\\b`).test(haystack),
      `the search haystack must not include ${field}`,
    );
  }
  assert.match(haystack, /summary\s*\.\s*vin\b/, 'VIN search is intentional and must keep working');
  assert.match(haystack, /summary\s*\.\s*make\b/, 'make and model search is the primary shopper path');
});

// ---------------------------------------------------------------------------
// 6. Nested collections carry their OWN internal identity
//
// The vehicle deny-list never named vehicle_evidence.uploaded_by or
// vehicle_plate_history.created_by, so a deny-list over vehicle columns left the
// embedded rows exposed. These guard the allow-list that replaced it.
// ---------------------------------------------------------------------------

test('an anonymous evidence vault never exposes uploader, reviewer or tenant identity', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport.evidenceVault);

  assert.ok(!body.includes(UPLOADER_ID), 'uploaded_by correlates a person across listings — it is internal identity');
  assert.ok(!body.includes(REVIEWER_ID), 'verified_by is internal identity for the same reason');
  assert.ok(!body.includes(TENANT_ID), 'evidence rows repeat tenant_id on their own table');
  assert.ok(passport.evidenceVault.length > 0, 'the fixture must actually produce evidence, or this test is vacuous');
});

test('an anonymous evidence vault exposes the artifact but not our storage internals', async () => {
  const passport = await buildPassport({});
  const [evidence] = passport.evidenceVault;

  assert.equal(evidence.file_url, 'https://example.test/e.jpg', 'the displayable artifact is the point of the vault');
  assert.ok(!('file_path' in evidence), 'file_path describes our storage layout, not the evidence');
  assert.ok(!('storage_bucket' in evidence), 'storage_bucket is an internal detail');
  assert.ok(!('verification_notes' in evidence), 'reviewer notes are operator free text, never public');
  assert.ok(!('metadata' in evidence), 'metadata is uncontrolled jsonb and cannot be vetted field by field');
});

test('anonymous plate history omits rows that never declared themselves public', async () => {
  const passport = await buildPassport({});
  const ids = passport.plateHistory.map(row => row.id);

  assert.deepEqual(ids, [PUBLIC_PLATE_ROW_ID], 'only the explicitly public row may be served');
  assert.ok(!ids.includes(PRIVATE_PLATE_ROW_ID), 'a private row is withheld');
  assert.ok(!ids.includes('ph-null-1'), 'an undeclared visibility is not permission to publish');
});

test('anonymous plate history reveals the lifecycle without the number or the operator note', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport.plateHistory);
  const [row] = passport.plateHistory;

  assert.equal(row.status, 'active', 'the lifecycle is the public value of plate history');
  assert.ok(!body.includes(PLATE), 'the plate number itself stays private');
  assert.ok(!body.includes(WITHHELD_REASON), 'a withheld row must not leak its reason through any path');
  assert.ok(!body.includes(UPLOADER_ID) && !body.includes(REVIEWER_ID), 'created_by/verified_by are internal identity');
  assert.ok(!('source_reference' in row), 'source_reference is an internal cross-reference');
});

test('the owner audience still receives the withheld plate rows, so the filter is not blanket suppression', async () => {
  const passport = await buildPassport({ userContext: { id: OWNER_ID, role: 'owner' } });
  const ids = passport.plateHistory.map(row => row.id);

  assert.equal(ids.length, plateHistory.length, 'the owner sees their own full plate history');
  assert.ok(ids.includes(PRIVATE_PLATE_ROW_ID), 'a private row is withheld from the public, not from its owner');
});

// ---------------------------------------------------------------------------
// 7. The evidence -> timeline path is a SECOND route to the evidence rows
//
// evidenceToTimelineItem lifts a vehicle_evidence row's own columns to the event's
// top level. Allow-listing only `details` left `metadata` — which carries
// ai_ready.vehicle_identity (vin, plate, chassis, engine) — and the reviewer's
// verification_notes reachable after the vault itself had been closed.
// ---------------------------------------------------------------------------

test('an anonymous timeline never carries evidence metadata or reviewer notes', async () => {
  const passport = await buildPassport({});
  const body = serializeDeep(passport.timeline);

  assert.ok(!body.includes('verification_notes'), 'the reviewer note column must not ride along on a timeline event');
  assert.ok(!body.includes('"metadata"'), 'metadata is uncontrolled jsonb and holds the registry identifiers');
  assert.ok(!body.includes(UPLOADER_ID), 'the uploader id must not reach an anonymous timeline');
  assert.ok(!body.includes(TENANT_ID), 'the tenant id must not reach an anonymous timeline');

  const evidenceEvents = passport.timeline.filter(e => e.event_source === 'evidence');
  assert.ok(evidenceEvents.length > 0, 'the fixture must produce an evidence-derived event, or this test is vacuous');
  for (const event of evidenceEvents) {
    assert.ok(!('metadata' in event), 'metadata must be absent from a public evidence event');
    assert.ok(!('verification_notes' in event), 'verification_notes must be absent');
    assert.ok(!('uploaded_by' in event), 'uploaded_by must be absent');
  }
});

test('an anonymous evidence event describes the evidence instead of quoting the reviewer', async () => {
  const passport = await buildPassport({});
  const [evidenceEvent] = passport.timeline.filter(e => e.event_source === 'evidence');

  assert.equal(
    evidenceEvent.publicDescription,
    'Verified evidence linked to this vehicle passport',
    'the public description must not be sourced from operator free text',
  );
  assert.equal(evidenceEvent.desc, evidenceEvent.publicDescription, 'desc is rewritten for the public audience');
});

test('a withheld plate row generates no timeline event for an anonymous caller', async () => {
  const build = instantiatePassportBuilder({
    vehicle: rawVehicleRow(),
    // Real id shape: <source>:<plateHistoryId>. The seeded fixture used synthetic ids that could
    // never match a plate row, so the suppression filter was never actually exercised.
    timeline: [
      { id: `plate_assigned:${PUBLIC_PLATE_ROW_ID}`, event_source: 'plate_assigned', timestamp: '2026-01-01T00:00:00.000Z', label: 'Plate Assigned', desc: `Number plate assigned: ${PLATE}`, details: { plateNumber: PLATE } },
      { id: `plate_suspended:${PRIVATE_PLATE_ROW_ID}`, event_source: 'plate_suspended', timestamp: '2026-01-02T00:00:00.000Z', label: 'Plate Suspended', desc: `Number plate ${PLATE} suspended: ${WITHHELD_REASON}`, details: { plateNumber: PLATE, reason: WITHHELD_REASON } },
    ],
    chain: { verified: true, count: 0, chain: [] },
  });
  const passport = await build(VIN, {});
  const ids = passport.timeline.map(e => e.id);
  const body = serializeDeep(passport.timeline);

  assert.ok(ids.includes(`plate_assigned:${PUBLIC_PLATE_ROW_ID}`), 'the public plate row keeps its event');
  assert.ok(!ids.includes(`plate_suspended:${PRIVATE_PLATE_ROW_ID}`), 'a withheld plate row must not announce itself');
  assert.ok(!body.includes(WITHHELD_REASON), 'suppressing the number while publishing the reason would leak the record');
});

test('an owner still sees the events derived from their withheld plate rows', async () => {
  const build = instantiatePassportBuilder({
    vehicle: rawVehicleRow(),
    timeline: [
      { id: `plate_suspended:${PRIVATE_PLATE_ROW_ID}`, event_source: 'plate_suspended', timestamp: '2026-01-02T00:00:00.000Z', label: 'Plate Suspended', desc: 'suspended', details: { reason: WITHHELD_REASON } },
    ],
    chain: { verified: true, count: 0, chain: [] },
  });
  const passport = await build(VIN, { userContext: { id: OWNER_ID, role: 'owner' } });
  const ids = passport.timeline.map(e => e.id);

  assert.ok(
    ids.includes(`plate_suspended:${PRIVATE_PLATE_ROW_ID}`),
    'suppression is audience-scoped, not blanket deletion — the owner keeps their own withheld event',
  );
});

test('an empty public plate history says whether it was withheld or genuinely empty', async () => {
  const passport = await buildPassport({});
  assert.equal(
    passport.plateHistoryRedacted,
    true,
    'rows were withheld, so the client must not render "no plates logged" as a fact',
  );
});
