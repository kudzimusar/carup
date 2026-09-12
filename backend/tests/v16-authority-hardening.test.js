/**
 * V16 convergence hardening — regression guards for the authority gaps closed while joining the
 * frozen Seller lane to the hardened platform.
 *
 * Each test corresponds to a finding in docs/hardening/AUTHORITY_AUDIT_REGISTER.md that survived
 * adversarial verification. They are written so that REINTRODUCING the defect fails them, not so
 * that they restate the fix: where the fact is a runtime decision it is exercised, and where the
 * fact is route wiring the wiring itself is asserted.
 *
 * Nothing here contacts a real database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const { resolveVehicleObjectAuthority, hasPlatformWideVehicleAuthority, requireVehicleObjectAuthority } =
  await import('../middleware/vehicleObjectAuthority.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SERVER = read('../server.js');

/** Stub `supabase.from('vehicles').select(...).eq(...).maybeSingle()` with one answer. */
function stubVehicleRead(answer) {
  const original = supabase.from;
  supabase.from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => answer,
      then: (res, rej) => Promise.resolve(answer).then(res, rej),
    };
    return chain;
  };
  return () => { supabase.from = original; };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 1. Vehicle object authority — the scope rule itself
// ═══════════════════════════════════════════════════════════════════════════════════

test('object authority: owner, current seller and tenant each carry scope; a stranger does not', async () => {
  const row = { owner_id: 'user-owner', current_seller_id: 'user-seller', tenant_id: 'tenant-1' };
  const restore = stubVehicleRead({ data: row, error: null });
  try {
    for (const ctx of [
      { id: 'user-owner', role: 'owner' },
      { id: 'user-seller', role: 'dealer' },
      { id: 'user-other', role: 'dealer', tenantId: 'tenant-1' },
    ]) {
      const { allowed } = await resolveVehicleObjectAuthority('VIN1', ctx);
      assert.equal(allowed, true, `${ctx.id} must hold scope`);
    }
    // A registered account with NO relationship. This is the whole finding: public registration
    // creates every account as 'owner', so the role alone admitted exactly this caller.
    const stranger = await resolveVehicleObjectAuthority('VIN1', { id: 'user-stranger', role: 'owner' });
    assert.equal(stranger.allowed, false);
    assert.equal(stranger.reason, 'not_scoped');
    // A forged tenant header that matches nothing must not confer scope either.
    const forged = await resolveVehicleObjectAuthority('VIN1', { id: 'user-stranger', role: 'owner', tenantId: 'tenant-9' });
    assert.equal(forged.allowed, false);
  } finally { restore(); }
});

test('object authority: FAILS CLOSED — a read error is never an absent restriction', async () => {
  // Returning "allowed" on a failed lookup would turn a transient database fault into a
  // platform-wide authorization bypass, which is strictly worse than the gap being closed.
  const restore = stubVehicleRead({ data: null, error: { message: 'connection reset' } });
  try {
    const { allowed, reason } = await resolveVehicleObjectAuthority('VIN1', { id: 'u', role: 'owner' });
    assert.equal(allowed, false);
    assert.equal(reason, 'lookup_failed');
  } finally { restore(); }
});

test('object authority: an unknown vin is refused, and refused the SAME way as a stranger', async () => {
  const restore = stubVehicleRead({ data: null, error: null });
  try {
    const { allowed, reason } = await resolveVehicleObjectAuthority('NOPE', { id: 'u', role: 'owner' });
    assert.equal(allowed, false);
    assert.equal(reason, 'not_found');
  } finally { restore(); }
  // The middleware answers both with 403 so a caller cannot use the status code to learn whether a
  // vin exists — an enumeration oracle would be a second finding.
  const src = read('../middleware/vehicleObjectAuthority.js');
  assert.match(src, /res\.status\(403\)/);
  assert.doesNotMatch(src, /res\.status\(404\)/,
    'a 404 here would let a stranger enumerate which VINs exist');
});

test('object authority: platform-wide roles bypass, ordinary roles do not', () => {
  for (const role of ['admin', 'platform_admin', 'super_admin', 'government']) {
    assert.equal(hasPlatformWideVehicleAuthority({ role }), true, `${role} is platform-wide`);
  }
  for (const role of ['owner', 'dealer', 'mechanic', 'reviewer', 'member']) {
    assert.equal(hasPlatformWideVehicleAuthority({ role }), false, `${role} must not bypass`);
  }
  // The platform role is honoured even when an effective role has been requested down.
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'owner', platformRole: 'admin' }), true);
});

test('object authority: a caller with no resolved identity is refused before any query', async () => {
  let queried = false;
  const original = supabase.from;
  supabase.from = () => { queried = true; return original('vehicles'); };
  try {
    const { allowed, reason } = await resolveVehicleObjectAuthority('VIN1', null);
    assert.equal(allowed, false);
    assert.equal(reason, 'no_identity');
    assert.equal(queried, false, 'an unidentified caller must be refused without a database read');
  } finally { supabase.from = original; }
});

test('object authority: the middleware refuses rather than calling next()', async () => {
  const restore = stubVehicleRead({ data: { owner_id: 'someone-else' }, error: null });
  try {
    const mw = requireVehicleObjectAuthority();
    let nexted = false; let status = null;
    const res = { status(s) { status = s; return { json: () => {} }; } };
    await mw({ params: { vin: 'VIN1' }, userContext: { id: 'stranger', role: 'owner' } }, res, () => { nexted = true; });
    assert.equal(nexted, false, 'a refused caller must not reach the handler');
    assert.equal(status, 403);
  } finally { restore(); }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 2. P0 — the stolen-alert takedown
// ═══════════════════════════════════════════════════════════════════════════════════

/** Source of one `app.<verb>('<path>'` registration, up to the next top-level registration. */
function routeSource(path) {
  const start = SERVER.indexOf(`app.post('${path}'`);
  assert.ok(start > -1, `${path} must exist`);
  const rest = SERVER.slice(start + 10);
  const next = /\napp\.(get|post|put|patch|delete)\(/.exec(rest);
  return SERVER.slice(start, next ? start + 10 + next.index : SERVER.length);
}

test('P0: reporting a vehicle stolen requires a PROVEN session and object scope', () => {
  const src = routeSource('/api/security/report-stolen');
  // `authorizeRole` would keep the x-user-id fallback available — a header-asserted identity must
  // never be able to flag a vehicle, and that fallback has been live in a deployed environment once.
  assert.match(src, /authorizeSessionRole\(\[/);
  assert.doesNotMatch(src, /\bauthorizeRole\(/);
  assert.match(src, /requireVehicleObjectAuthority\(\)/,
    'role alone admits every registered account; the vin relationship is the real gate');
});

test('P0: the reporter is the authenticated caller, never the request body', () => {
  const src = routeSource('/api/security/report-stolen');
  assert.match(src, /reportVehicleStolen\(vin, policeReportNumber, req\.userContext\.id\)/);
  // `ownerId` must not be destructured back out of the body: it is what let a report be attributed
  // to an account that did not make it.
  assert.doesNotMatch(src, /req\.body\.ownerId|\bownerId\b/,
    'the body must not supply the reporting identity');
});

test('P0: the flag is reversible — a governed clear route exists and is narrower than reporting', () => {
  // `clearStolenStatus` was implemented and exported but NO route mounted it, so a flag raised by
  // the defect above could never be lowered through any product path.
  const src = routeSource('/api/security/clear-stolen');
  assert.match(src, /clearStolenStatus\(vin, req\.userContext\.id\)/);
  assert.match(src, /authorizeSessionRole\(\['government'\]\)/,
    'clearing a police alert is a registry decision, not a seller one');
  assert.match(SERVER, /import \{ reportVehicleStolen, checkStolenStatus, clearStolenStatus \}/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 3. P1 — the vehicle-capability routes that authorized by role alone
// ═══════════════════════════════════════════════════════════════════════════════════

test('P1: every /api/vehicles/:vin capability route carries object authority', () => {
  const files = {
    '../routes/lenderRoutes.js': [
      "router.post('/api/vehicles/:vin/finance/consent'",
      "router.post('/api/vehicles/:vin/finance/lender/eligibility'",
    ],
    '../routes/insurerRoutes.js': [
      "router.post('/api/vehicles/:vin/insurer/consent'",
      "router.post('/api/vehicles/:vin/insurer/eligibility'",
      "router.get('/api/vehicles/:vin/insurer/eligibility'",
    ],
    '../routes/eligibilityRoutes.js': [
      "router.post('/api/vehicles/:vin/insurance/eligibility'",
      "router.get('/api/vehicles/:vin/insurance/eligibility'",
      "router.post('/api/vehicles/:vin/finance/eligibility'",
      "router.get('/api/vehicles/:vin/finance/eligibility'",
    ],
  };
  let checked = 0;
  for (const [file, registrations] of Object.entries(files)) {
    const src = read(file);
    for (const reg of registrations) {
      const at = src.indexOf(reg);
      assert.ok(at > -1, `${file}: ${reg} must exist`);
      // The gate must appear within this registration, before the handler body runs.
      const window = src.slice(at, at + 400);
      assert.match(window, /requireVehicleObjectAuthority\(\)/,
        `${file}: ${reg} authorizes by ROLE ONLY — any registered account could act on any vin`);
      checked += 1;
    }
  }
  assert.equal(checked, 9, `anti-vacuity: expected the nine shipped capability routes, checked ${checked}`);
});

test('P1: the coarse PUBLIC availability route is deliberately NOT object-scoped', () => {
  // Over-gating is its own defect. This endpoint is documented as the only public one and carries
  // no applicant or credit data, so scoping it would break buyer-facing finance availability.
  const src = read('../routes/lenderRoutes.js');
  const at = src.indexOf("router.get('/api/vehicles/:vin/finance/availability'");
  assert.ok(at > -1);
  assert.doesNotMatch(src.slice(at, at + 400), /requireVehicleObjectAuthority/);
});

test('P1: a lender consent only satisfies the gate when it is bound to THIS vin and applicant', () => {
  const src = read('../services/finance/lenderWorkflow.js');
  // `loadConsent` resolves by id alone, so without this binding any consent reference satisfied the
  // mandatory-consent gate for any vehicle, and the lender decision came back in the response.
  assert.match(src, /function consentBindsRequest\(consent, vin, requestedBy\)/);
  assert.match(src, /if \(consent\.vin !== vin\) return false;/);
  assert.match(src, /consent\.applicant_user_id === requestedBy/);
  // Fail closed: a consent with no recorded applicant cannot be shown to be the caller's.
  assert.match(src, /if \(!requestedBy \|\| !consent\.applicant_user_id\) return false;/);
  // And the eligibility path must actually USE it rather than the old activity-only check.
  assert.match(src, /const consentOk = consentBindsRequest\(consent, vin, opts\.requestedBy\);/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 4. P1 — a GET that persisted a trust score
// ═══════════════════════════════════════════════════════════════════════════════════

test('P1: reading a dealer reputation performs no write, and does not invent a score', async () => {
  const { readDealerReputation } = await import('../services/reputation/reputationService.js');
  const src = read('../services/reputation/reputationService.js');

  const readFn = src.slice(src.indexOf('export async function readDealerReputation'));
  const readBody = readFn.slice(0, readFn.indexOf('\n}\n') + 2);
  assert.doesNotMatch(readBody, /\.update\(|\.insert\(|\.upsert\(/,
    'a GET that writes means any crawler re-scores every dealer it visits');

  // An unscored dealer is NOT a 75 and NOT a zero. The old code published 75 / 'Standard Verified'
  // for a dealer with no escrows at all.
  const restore = stubVehicleRead({ data: { user_id: 'd1', trust_score: null }, error: null });
  try {
    const out = await readDealerReputation('d1');
    assert.equal(out.reputation_state, 'unmeasured');
    assert.equal(out.reputationScore, null);
    assert.equal(out.verificationTier, null, 'a tier is a claim about a measured score');
  } finally { restore(); }
});

test('P1: the recompute is the single writer and is behind a proven session', () => {
  const src = read('../services/reputation/reputationService.js');
  const writers = [...src.matchAll(/\.update\(\{ trust_score/g)];
  assert.equal(writers.length, 1, 'exactly one writer of stakeholder_profiles.trust_score');
  assert.match(src, /export async function recalculateDealerReputation/);

  const route = routeSource('/api/reputation/:dealerId/recalculate');
  assert.match(route, /authorizeSessionRole\(\['admin', 'government'\]\)/);
  // The GET must no longer CALL the old read-and-write function. Matched as a call site rather
  // than a mention: `recalculate...` legitimately contains `calculate...`, and the comment above
  // the route names the removed function deliberately, to record what was changed and why.
  assert.doesNotMatch(SERVER, /(?<![A-Za-z])calculateDealerReputation\s*\(/);
  assert.match(SERVER, /readDealerReputation, recalculateDealerReputation/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 5. P1 — the odometer-reversal detector that was dead by construction
// ═══════════════════════════════════════════════════════════════════════════════════

test('P1: the fraud engine reads the odometer COLUMNS the canonical writer populates', async () => {
  const src = read('../services/fraud/fraudEngine.js');
  // The canonical evidence writer stores the reading in columns; `metadata` is only whatever the
  // client happened to send. Without these in the select, the only mileage signal carrying
  // blocks_publication could never fire on CarUp-written evidence.
  assert.match(src, /\.select\('id, vin, evidence_type, checksum, image_hash, verification_status, metadata, odometer_value, odometer_unit, captured_at, created_at'\)/);
  assert.match(src, /const raw = ev\.odometer_value/,
    'the column must be read FIRST; the metadata keys are a legacy fallback only');
});

test('P1: the reversal detector actually fires on column-form evidence', async () => {
  const { evaluateVehicle } = await import('../services/fraud/fraudEngine.js');
  const evidence = [
    { id: 'e1', vin: 'V1', odometer_value: 90000, odometer_unit: 'km', captured_at: '2026-01-01T00:00:00Z', metadata: {} },
    { id: 'e2', vin: 'V1', odometer_value: 40000, odometer_unit: 'km', captured_at: '2026-06-01T00:00:00Z', metadata: {} },
  ];
  const signals = await evaluateVehicle('V1', {
    vehicle: { vin: 'V1' }, others: [], evidence, sourceResults: [], foreignChecksumIndex: new Map(),
  });
  const reversal = signals.find((s) => s.signal_code === 'odometer_reversal');
  assert.ok(reversal, 'a 90,000km reading followed by 40,000km is the reversal this detector exists for');
  assert.equal(reversal.blocks_publication, true);
});

test('P1: a unit change is not a reversal', () => {
  // 60,000 mi is 96,560 km — an INCREASE over 90,000 km. Comparing the raw numbers would
  // manufacture a rollback accusation out of a unit change.
  const km = 60000 * 1.609344;
  assert.ok(km > 90000);
  const src = read('../services/fraud/fraudEngine.js');
  assert.match(src, /1\.609344/, 'miles must be normalised before comparison');
});

test('P1: "could not read evidence" is distinguishable from "no evidence"', () => {
  const src = read('../services/fraud/fraudEngine.js');
  const loader = src.slice(src.indexOf('async function loadEvidence'));
  const body = loader.slice(0, loader.indexOf('\n}\n') + 2);
  assert.match(body, /if \(error\) return null;/,
    'returning [] for a failed read makes an unreadable evidence table look like a clean vehicle');
  assert.doesNotMatch(body, /if \(error\) return \[\];/);
  assert.match(src, /evidence_not_readable/, 'the distinction must be surfaced, not merely made');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 6. P1 — a second trust-score authority with effectively no authority check
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Serve the four tables `createReputationRecord` touches. Each entry is the answer for that table;
 * `diaspora_reputation_records` records the attempted insert so a test can assert nothing was
 * written when the review was refused.
 */
function stubDiaspora({ profile, order, participants }) {
  const original = supabase.from;
  const inserted = [];
  supabase.from = (table) => {
    const chain = {
      _payload: null,
      select() { return chain; },
      insert(payload) { chain._payload = payload; inserted.push(payload); return chain; },
      // The success path continues into recalculateTradeProfileReputation, which updates the
      // profile's derived columns. Not the subject here, so it is accepted and discarded.
      update() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      order() { return chain; },
      maybeSingle: async () => {
        if (table === 'diaspora_trade_profiles') return { data: profile ?? null, error: null };
        if (table === 'diaspora_import_orders') return { data: order ?? null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: { id: 'rep-1', ...(chain._payload || {}) }, error: null }),
      then(res, rej) {
        const answer = table === 'diaspora_import_order_participants'
          ? { data: participants ?? [], error: null }
          : { data: [], error: null };
        return Promise.resolve(answer).then(res, rej);
      },
    };
    return chain;
  };
  return { inserted, restore: () => { supabase.from = original; } };
}

const REVIEWER = 'user-buyer';
const PROFILE = { id: 'profile-seller', user_id: 'user-seller' };
const COMPLETED_ORDER = { id: 'order-1', status: 'COMPLETED' };
const BOTH_PARTICIPANTS = [
  { user_id: REVIEWER, trade_profile_id: 'profile-buyer' },
  { user_id: 'user-seller', trade_profile_id: 'profile-seller' },
];
const validReview = { trade_profile_id: 'profile-seller', import_order_id: 'order-1', rating: 5 };

test('P1: a rating outside 1..5 is refused, so the derived score cannot be clamped to either end', async () => {
  const { createReputationRecord } = await import('../services/diaspora/diasporaReputationService.js');
  const stub = stubDiaspora({ profile: PROFILE, order: COMPLETED_ORDER, participants: BOTH_PARTICIPANTS });
  try {
    // trustScore = 50 + ratingAverage*10 - disputes*5, so rating:1000 clamped to 100 and
    // rating:-1000 clamped to 0. One POST could set any profile to either end of the scale.
    for (const rating of [1000, -1000, 0, 5.5, Number.NaN, 'five']) {
      await assert.rejects(
        () => createReputationRecord({ ...validReview, rating }, { id: REVIEWER }),
        /rating must be a number between 1 and 5|trade_profile_id and rating are required/,
        `rating ${String(rating)} must be refused`,
      );
    }
    assert.deepEqual(stub.inserted, [], 'a refused review must write nothing');
    // ANTI-VACUITY: the in-range case really does proceed, so the test above measures the range
    // check and not a guard that refuses everything.
    const ok = await createReputationRecord({ ...validReview, rating: 4 }, { id: REVIEWER });
    assert.equal(ok.rating, 4);
  } finally { stub.restore(); }
});

test('P1: a profile cannot review itself', async () => {
  const { createReputationRecord } = await import('../services/diaspora/diasporaReputationService.js');
  const stub = stubDiaspora({ profile: PROFILE, order: COMPLETED_ORDER, participants: BOTH_PARTICIPANTS });
  try {
    await assert.rejects(
      () => createReputationRecord(validReview, { id: 'user-seller' }),
      /cannot review itself/,
    );
    assert.deepEqual(stub.inserted, []);
  } finally { stub.restore(); }
});

test('P1: a review must cite a COMPLETED order both parties participated in', async () => {
  const { createReputationRecord } = await import('../services/diaspora/diasporaReputationService.js');
  const cases = [
    ['an order still in flight', { profile: PROFILE, order: { id: 'order-1', status: 'SHIPPED' }, participants: BOTH_PARTICIPANTS }],
    ['an order that does not exist', { profile: PROFILE, order: null, participants: BOTH_PARTICIPANTS }],
    ['an order the reviewer was not on', { profile: PROFILE, order: COMPLETED_ORDER, participants: [{ user_id: 'someone-else', trade_profile_id: 'profile-seller' }] }],
    ['an order the reviewed profile was not on', { profile: PROFILE, order: COMPLETED_ORDER, participants: [{ user_id: REVIEWER, trade_profile_id: 'profile-buyer' }] }],
  ];
  for (const [label, fixture] of cases) {
    const stub = stubDiaspora(fixture);
    try {
      await assert.rejects(
        () => createReputationRecord(validReview, { id: REVIEWER }),
        /COMPLETED import order/,
        `${label} must not admit a review`,
      );
      assert.deepEqual(stub.inserted, [], `${label}: nothing may be written`);
    } finally { stub.restore(); }
  }
  // And with no cited order at all.
  const stub = stubDiaspora({ profile: PROFILE, order: COMPLETED_ORDER, participants: BOTH_PARTICIPANTS });
  try {
    await assert.rejects(
      () => createReputationRecord({ ...validReview, import_order_id: null }, { id: REVIEWER }),
      /COMPLETED import order/,
    );
  } finally { stub.restore(); }
});

test('P1: the reviewer and the publication state are server-decided, never body-supplied', async () => {
  const { createReputationRecord } = await import('../services/diaspora/diasporaReputationService.js');
  const stub = stubDiaspora({ profile: PROFILE, order: COMPLETED_ORDER, participants: BOTH_PARTICIPANTS });
  try {
    const written = await createReputationRecord(
      { ...validReview, reviewer_id: 'user-impersonated', verification_status: 'PUBLISHED' },
      { id: REVIEWER },
    );
    assert.equal(written.reviewer_id, REVIEWER, 'the body must not be able to file a review as someone else');
    assert.equal(written.verification_status, 'PENDING_REVIEW',
      'a caller must not publish their own review straight into the reputation average');
  } finally { stub.restore(); }
});

test('P1: a moderated-away review stops moving the average', () => {
  const src = read('../services/diaspora/diasporaReputationService.js');
  assert.match(src, /verification_status !== 'REMOVED' && row\.verification_status !== 'FLAGGED'/);
  assert.match(src, /\.select\('rating, dispute_flag, verification_status'\)/,
    'the state must be selected, or the filter above is reading undefined on every row');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 7. P1 — any effective-mechanic could raise the canonical odometer of every VIN
// ═══════════════════════════════════════════════════════════════════════════════════

test('P1: a mechanic must hold a relationship to the vehicle before writing its repair ledger', () => {
  const src = routeSource('/api/partsentry/add');

  // THE DEFECT. The ownership check was skipped for the role outright:
  //   if (req.userContext.role !== 'mechanic' && req.userContext.role !== 'admin') { ...check... }
  // `role` is the EFFECTIVE role, and authMiddleware grants a requested role that matches the
  // caller's tenant_users role — so membership as 'mechanic' in ANY single tenant conferred write
  // authority over every vin on the platform. The write lands on vehicles.mileage, is guarded only
  // monotonically, and has no correction path, so one inflated reading is permanent.
  assert.doesNotMatch(src, /role !== 'mechanic'/,
    'the mechanic role must not be exempted from the vehicle relationship check');

  // Only platform-wide roles bypass, and that decision comes from the ONE definition of it.
  assert.match(src, /if \(!hasPlatformWideVehicleAuthority\(req\.userContext\)\)/);
  // A mechanic is admitted by a real relationship, not by their role.
  assert.match(src, /req\.userContext\.role === 'mechanic'\s*\n?\s*\?\s*await mechanicIsAssignedToVehicle\(/);
});

test('P1: the mechanic relationship is a tenant link or an assigned work order, and fails closed', () => {
  const fn = SERVER.slice(SERVER.indexOf('async function mechanicIsAssignedToVehicle'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);

  assert.match(body, /vehicleRow\.tenant_id === userContext\.tenantId/,
    'the vehicle must belong to the mechanic’s organisation');
  assert.match(body, /\.from\('mechanic_work_orders'\)/);
  assert.match(body, /\.eq\('vin', vin\)/, 'the work order must be for THIS vin');
  assert.match(body, /\.eq\('mechanic_id', userContext\.id\)/, 'and assigned to THIS mechanic');
  // A failed lookup must refuse, not admit.
  assert.match(body, /if \(error\) return false;/);
  assert.doesNotMatch(body, /if \(error\) return true;/);
});

// ═══════════════════════════════════════════════════════════════════════════════════
// 8. B7 — ONE vehicle trust authority (Seller Join Battery)
// ═══════════════════════════════════════════════════════════════════════════════════

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Every non-test backend .js file, as repo-relative paths. */
function backendSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) backendSources(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Resolve which TABLE each `.update({ trust_score ... })` writes, by walking back to the nearest
 * preceding `.from('<table>')`.
 *
 * A single-line grep for `from('vehicles') ... trust_score` is VACUOUS here: the two writes in
 * trustEnforcementEngine are multi-line chains
 *   `await supabase\n  .from('vehicles')\n  .update({ trust_score: newScore, ... })`
 * and would not be seen at all. A gate that cannot see the writers it exists to count is worse
 * than no gate, so the table is resolved structurally.
 */
function vehicleTrustWriters() {
  const BACKEND = fileURLToPath(new URL('../', import.meta.url));
  const writers = new Set();
  for (const file of backendSources(BACKEND)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\.update\(\s*\{\s*trust_score/g)) {
      const before = src.slice(0, m.index);
      const from = [...before.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g)].pop();
      if (from && from[1] === 'vehicles') writers.add(relative(BACKEND, file));
    }
  }
  return [...writers].sort();
}

test('B7: the canonical vehicle trust column has exactly the known governed writers', () => {
  // `vehicles.trust_score` is the CANONICAL vehicle trust cache. `stakeholder_profiles.trust_score`
  // and `diaspora_trade_profiles.trust_score` are different columns with their own authorities and
  // their own register entries; they are deliberately not counted here.
  //
  // Both writers below are governed: each clears UNSTAMPED_TRUST_CACHE or is the deprecated
  // graph writer, and neither may STAMP a canonical score — only refreshCanonicalTrust does that.
  // Pinning the SET is what makes this discriminating: a new writer anywhere fails, which is the
  // "one trust authority" invariant the Seller Join Battery's B7 exists to hold.
  //
  // TWO writers, and the set is pinned rather than asserted to be one. Both are governed by the
  // same discipline — each owns the NUMBER and none of the provenance behind it, so each clears
  // UNSTAMPED_TRUST_CACHE in the SAME update. Only refreshCanonicalTrust may STAMP a canonical
  // score, and neither of these does. A write that kept a previous refresh's calculation_version
  // would be published as canonical with a band and confidence describing the score it replaced.
  //
  //   trustGraphService              the deprecated graph writer
  //   trustEnforcementEngine         stakeholder-risk penalties (two multi-line chains)
  //
  // documentIntelligenceService's OCR-approval write — the `(trust_score || 80) + 20` residual
  // this pin used to carry — was RETIRED OUTRIGHT by O2-X1 (the whole approval chain is gone,
  // not rerouted). o2-x1-document-intelligence-authority.test.js and the retirement test in
  // issue164-phase3-trust-authority.test.js hold that; this SET pin makes any comeback, or any
  // brand-new writer anywhere in backend/, fail by name.
  assert.deepEqual(vehicleTrustWriters(), [
    'services/trust-service/trustEnforcementEngine.js',
    'services/trustGraph/trustGraphService.js',
  ]);
});

test('B7: the Seller lane introduces no trust-score writer of any kind', () => {
  // The join obligation itself. Scoped to the SELLER LANE's own increment — diffing to HEAD would
  // flag this convergence's dealer-reputation split and diaspora reputation guard, which are not
  // Seller and are the opposite of a new authority.
  const sellerTouched = execSync(
    'git diff --name-only 43204beeec40123b0cce0c457aded6d0f733c4bc 16d0070ae817320764f56b10c881688daa1686c8 -- backend/',
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' },
  )
    .split('\n')
    .filter((f) => f.endsWith('.js') && !f.includes('/tests/'));

  assert.ok(sellerTouched.length > 0, 'anti-vacuity: the Seller lane must have touched backend files');

  const offenders = [];
  for (const rel of sellerTouched) {
    let src;
    try { src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/trust_score/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      const text = src.split('\n')[line - 1];
      if (/\.(update|insert|upsert)\s*\(/.test(text)) offenders.push(`${rel}:${line}`);
    }
  }
  assert.deepEqual(offenders, [],
    `a Seller path must never write a trust score; found: ${offenders.join(', ')}`);
});
