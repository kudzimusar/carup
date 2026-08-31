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
