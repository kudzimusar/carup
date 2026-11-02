/**
 * O2 · U2 — THE PASSPORT MUST FETCH IN WAVES, AND MUST STILL SAY THE SAME THING.
 * (Re-authored by OC-5C from PR #208 bbfce741 / 7974d0c4.)
 *
 * Owner UAT rejected #208's candidate 1f26282a because `GET /api/vehicles/passport/lookup/...` — the
 * Product Owner's own car — answered 503. The cause was not a slow query: measured on staging, one
 * vehicle row read is ~0.28s; the passport made THIRTEEN round trips one after another, and one of them
 * (`computeVehicleTrustScore`) was itself eleven more. Warm 9.0s, cold 15.6s.
 *
 * A wall-clock assertion would be a flaky retelling of that story, so this guard asserts the
 * ARCHITECTURE that produces the latency, deterministically and with no timer:
 *
 *   1. CONCURRENCY IS OBSERVED, NOT ASSUMED. The shipped source runs over a Supabase double whose reads
 *      never settle; only the vehicle row answers. A SERIAL builder issues one more read and blocks; a
 *      WAVE issues all of them. The distinction is a count taken while every read is still pending.
 *   2. THE ANSWER DID NOT MOVE. The trust arithmetic is asserted on its exact score and metrics — with
 *      GENUINE registry rows (T12.1: a row's existence is not an authority's act) and a forged one.
 *   3. GUARDED READS STAY GUARDED. Each guard is proven by its absence.
 *   4. FAILURE STILL FAILS — never swallowed, never an unhandled rejection.
 *   5. ONE LEDGER VERDICT PER RENDER (OC-5C): verifyChain runs once and the trust signals receive that
 *      same verdict, so `blockchain_audit_valid` cannot disagree with `chainVerification`.
 *
 * ANTI-VACUITY. Section 1 re-runs its measurement against a DELIBERATELY SERIALIZED copy of the shipped
 * source and requires that copy to fail — a concurrency test that cannot detect serial code proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { isGenuineRegistryRecord } = await import('../services/evidence/vehicleFactResolver.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
const trustSrc = fs.readFileSync(path.join(here, '..', 'services', 'trustGraph', 'trustGraphService.js'), 'utf8');

/** Slice a balanced `{...}` block starting at `start`, ignoring braces inside strings/comments. */
function sliceBalanced(src, start) {
  let depth = 0; let i = start;
  let inLine = false; let inBlock = false; let quote = null; let escaped = false;
  for (; i < src.length; i += 1) {
    const c = src[i]; const next = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced delimiters');
}

/** A function's source from its declaration to its balanced body (skipping a destructured default). */
function extractFunction(src, declaration) {
  const declIdx = src.indexOf(declaration);
  assert.ok(declIdx > -1, `${declaration} must still exist — retarget this guard rather than deleting it`);
  // The parameter list may contain `{ ... } = {}`: the body is the first `{` after the closing `)`
  // of the parameter list, found by balancing parentheses.
  let i = src.indexOf('(', declIdx); let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
  }
  const braceIdx = src.indexOf('{', i);
  return src.slice(declIdx, braceIdx) + sliceBalanced(src, braceIdx);
}

const passportSource = () => extractFunction(serverSrc, 'async function buildVehiclePassport');
const trustContextSource = () => extractFunction(trustSrc, 'async function computeVehicleTrustScoreContext');

/** Drain the event loop a bounded number of turns — yields control, never waits for a duration. */
async function settle(turns = 50) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

/**
 * A Supabase double that RECORDS every table it is asked for and, by default, never answers.
 * `resolved` names the tables that do answer; everything else stays pending forever.
 */
function pendingSupabase(resolved = {}) {
  const issued = [];
  const never = new Promise(() => {});
  const from = (table) => {
    issued.push(table);
    const answer = Object.prototype.hasOwnProperty.call(resolved, table) ? Promise.resolve(resolved[table]) : never;
    const builder = {
      select: () => builder, eq: () => builder, neq: () => builder, in: () => builder,
      order: () => builder, limit: () => builder,
      single: () => answer,
      then: (onOk, onErr) => answer.then(onOk, onErr),
    };
    return builder;
  };
  return { issued, client: { from } };
}

const VIN = 'GFC27U2TESTVIN0001';
const VEHICLE_ROW = {
  vin: VIN, owner_id: 'u_owner', current_seller_id: 'u_seller',
  normalized_plate_number: 'GFC27027051', plate_number: 'GFC 27-027051', plate_verified_at: '2026-01-01T00:00:00Z',
  plate_status: 'Active', publication_status: 'published', duty_paid: false, police_verified: false,
};

const PASSPORT_DEPENDENCY_NAMES = [
  'supabase', 'getVehicleTimeline', 'normalizeEvidenceRecord', 'mergeEventsWithEvidence',
  'computeVehicleTrustScore', 'verifyChain', 'projectVehicle', 'toPublicEvidence',
  'toPublicPlateHistory', 'toPublicTimelineEvent', 'PASSPORT_PRIVILEGED_ROLES',
];

/** Instantiate the SHIPPED passport source over injected collaborators, recording collaborator calls. */
function instantiatePassport(source, supabase, collaborators = {}) {
  const calls = [];
  const record = (name, value) => (...args) => { calls.push({ name, args }); return value(...args); };
  const never = () => new Promise(() => {});
  const factory = new Function(...PASSPORT_DEPENDENCY_NAMES, `return (${source});`);
  const fn = factory(
    supabase,
    record('getVehicleTimeline', collaborators.getVehicleTimeline || (async () => [])),
    (r) => r,
    (events) => events,
    record('computeVehicleTrustScore', collaborators.computeVehicleTrustScore || never),
    record('verifyChain', collaborators.verifyChain || never),
    (v) => v, (e) => e, (p) => p, (t) => t,
    new Set(['admin', 'government']),
  );
  return { fn, calls };
}

const CONTRACT = () => ({});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 1 — THE PASSPORT ISSUES ONE WAVE, NOT THIRTEEN ROUND TRIPS
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('U2 — the passport fetches concurrently', () => {
  async function issuedWhileAllPending(source) {
    const { issued, client } = pendingSupabase({ vehicles: { data: VEHICLE_ROW, error: null } });
    const { fn, calls } = instantiatePassport(source, client);
    // Deliberately NOT awaited: the builder can never finish. What it managed to START is the measurement.
    fn(VIN, {}, null, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT).catch(() => {});
    await settle();
    return { issued, calls: calls.map((c) => c.name) };
  }

  it('starts every independent read before any of them answers', async () => {
    const { issued, calls } = await issuedWhileAllPending(passportSource());
    const tables = new Set(issued);
    assert.ok(tables.has('vehicles'), 'the vehicle row is the one true prerequisite and is read first');
    for (const table of ['vehicle_evidence', 'vehicle_plate_history', 'vehicle_ownership_history', 'listing_images', 'users']) {
      assert.ok(tables.has(table), `${table} was never issued while every read was still pending — the builder is still serial`);
    }
    assert.ok(calls.includes('computeVehicleTrustScore'), 'the trust signals start in the same wave');
    assert.ok(calls.includes('verifyChain'), 'the ledger verification starts in the same wave');
  });

  it('ANTI-VACUITY — the same measurement FAILS against a deliberately serialized builder', async () => {
    // Re-serialize the wave by awaiting each started read the moment it is created — produced
    // mechanically from the shipped source so the control cannot drift from what it controls for.
    const source = passportSource();
    const serialized = source.replace(/([=?]) start\(/g, '$1 await start(');
    const rewrites = (source.match(/[=?] start\(/g) || []).length;
    assert.ok(rewrites >= 8, `the serialization control rewrote ${rewrites} call sites — too few to serialize the wave`);

    const { issued } = await issuedWhileAllPending(serialized);
    const tables = new Set(issued);
    assert.ok(!tables.has('vehicle_ownership_history') || !tables.has('users'),
      'a SERIAL builder must block after its first pending read; this control issued the whole wave, so the assertion above proves nothing');
  });

  it('a read that is guarded stays guarded — no hoist turns a skipped query into a performed one', async () => {
    const { issued, client } = pendingSupabase({ vehicles: { data: { ...VEHICLE_ROW, current_seller_id: null }, error: null } });
    const { fn } = instantiatePassport(passportSource(), client);
    fn(VIN, {}, null, CONTRACT, CONTRACT, /* mediaContract */ null, /* lifecycleBuilder */ null, CONTRACT, /* financeObligationContract */ null)
      .catch(() => {});
    await settle();
    assert.ok(!issued.includes('listing_images'), 'no media contract was injected, so the gallery read is not issued at all');
    assert.ok(!issued.includes('users'), 'no current seller is recorded, so the seller-name read is not issued at all');
    assert.ok(issued.includes('vehicle_plate_history'), 'the UNguarded reads still run — otherwise this proves nothing');
  });

  it('a failing source still fails the request — earlier does not mean swallowed, and nothing is left unhandled', async () => {
    const boom = Object.assign(new Error('evidence read exploded'), { code: 'PGRST500' });
    const { client } = pendingSupabase({
      vehicles: { data: VEHICLE_ROW, error: null },
      vehicle_evidence: { data: null, error: boom },
    });
    const { fn } = instantiatePassport(passportSource(), client, {
      // These sources also FAIL — by REJECTING — and the failed request never reaches them: neither may
      // surface as an unhandled rejection.
      computeVehicleTrustScore: async () => { throw new Error('trust signals unreachable'); },
      verifyChain: async () => { throw new Error('ledger unreachable'); },
    });

    let unhandled = null;
    const onUnhandled = (reason) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);
    try {
      await assert.rejects(
        () => fn(VIN, {}, null, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT),
        /evidence read exploded/,
        'a failed evidence read must still fail the passport, exactly as when the read was inline',
      );
      await settle();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.equal(unhandled, null, 'starting reads earlier never produces an unhandled rejection');
  });

  it('a source that THROWS still fails the passport at its original position — never read as an empty answer', async () => {
    const { client } = pendingSupabase({
      vehicles: { data: VEHICLE_ROW, error: null },
      vehicle_evidence: { data: [], error: null },
      vehicle_plate_history: { data: [], error: null },
      vehicle_ownership_history: { data: [], error: null },
      users: { data: { name: 'Seller' }, error: null },
    });
    const { fn } = instantiatePassport(passportSource(), client, {
      getVehicleTimeline: async () => { throw new Error('timeline exploded'); },
      computeVehicleTrustScore: async () => ({ metrics: null }),
      verifyChain: async () => ({ verified: true, count: 0, chain: [] }),
    });
    await assert.rejects(() => fn(VIN, {}, null, null, null, null, null, null, null), /timeline exploded/);
  });

  it('OC-5C: ONE ledger verdict per render — verifyChain runs once and the trust signals receive that same verdict', async () => {
    const verdict = { verified: true, count: 3, chain: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const { client } = pendingSupabase({
      vehicles: { data: { ...VEHICLE_ROW, current_seller_id: null }, error: null },
      vehicle_evidence: { data: [], error: null },
      vehicle_plate_history: { data: [], error: null },
      vehicle_ownership_history: { data: [], error: null },
    });
    let ledgerSeenByTrust = null;
    const { fn, calls } = instantiatePassport(passportSource(), client, {
      verifyChain: async () => verdict,
      computeVehicleTrustScore: async (vin, options) => {
        ledgerSeenByTrust = await options.ledgerVerdict;
        assert.equal(options.vehicleRow.vin, VIN, 'the trust signals are handed the row the passport already read');
        return { metrics: { blockchain_audit_valid: ledgerSeenByTrust.verified } };
      },
    });
    // The caller is the vehicle's owner (a proven identity), so the full chain is published.
    const body = await fn(VIN, { userContext: { id: 'u_owner', role: 'owner' } }, null, null, null, null, null, null, null);
    assert.equal(calls.filter((c) => c.name === 'verifyChain').length, 1, 'verifyChain ran exactly once for the render');
    assert.equal(ledgerSeenByTrust, verdict, 'the trust signals scored the passport\'s own verdict object');
    assert.equal(body.chainVerification, verdict);
    assert.equal(body.trust_signals?.blockchain_audit_valid ?? body.trustSignals?.blockchain_audit_valid, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 2 — THE TRUST SIGNALS FETCH IN ONE WAVE AND SCORE IDENTICALLY
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('U2 — the trust score context fetches concurrently and scores identically', () => {
  function instantiateTrust(source, supabase, { odo, ledger } = {}) {
    const calls = { odo: 0, ledger: 0 };
    const factory = new Function('supabase', 'runOdometerAudit', 'verifyChain', 'isGenuineRegistryRecord', `return (${source});`);
    const fn = factory(
      supabase,
      (...a) => { calls.odo += 1; return (odo || (() => new Promise(() => {})))(...a); },
      (...a) => { calls.ledger += 1; return (ledger || (() => new Promise(() => {})))(...a); },
      isGenuineRegistryRecord,
    );
    return { fn, calls };
  }

  // GENUINE registry rows (the T12 positive controls) — a row's mere existence scores nothing.
  const GENUINE_ZIMRA = { customs_ref_number: 'BE/2026/004471' };
  const GENUINE_CVR = { registration_number: 'AEV 4471', logbook_serial_number: '0043118' };

  it('starts every signal read before any of them answers', async () => {
    const { issued, client } = pendingSupabase({ vehicles: { data: VEHICLE_ROW, error: null } });
    const { fn } = instantiateTrust(trustContextSource(), client);
    fn(VIN).catch(() => {});
    await settle();
    const tables = new Set(issued);
    for (const table of ['zimra_declarations', 'cid_clearance_records', 'cvr_ownership_records', 'vid_inspections', 'partsentry_logs', 'vehicle_evidence', 'stolen_vehicles']) {
      assert.ok(tables.has(table), `${table} was never issued while every read was still pending — the trust context is still serial`);
    }
  });

  it('the duplicate-plate probe keeps its guard', async () => {
    const { issued, client } = pendingSupabase({ vehicles: { data: { ...VEHICLE_ROW, normalized_plate_number: null }, error: null } });
    const { fn } = instantiateTrust(trustContextSource(), client);
    fn(VIN).catch(() => {});
    await settle();
    assert.equal(issued.filter((t) => t === 'vehicles').length, 1,
      'with no normalized_plate_number there is nothing to compare, so the duplicate-plate count is not issued');
  });

  it('OC-5C: the passport\'s row and ledger verdict are USED — no second vehicle read, no second verifyChain', async () => {
    const { issued, client } = pendingSupabase({});
    const { fn, calls } = instantiateTrust(trustContextSource(), client);
    fn(VIN, { vehicleRow: { ...VEHICLE_ROW, normalized_plate_number: null }, ledgerVerdict: Promise.resolve({ verified: true }) }).catch(() => {});
    await settle();
    assert.equal(issued.filter((t) => t === 'vehicles').length, 0, 'the supplied row is not re-read');
    assert.equal(calls.ledger, 0, 'the supplied verdict is not re-verified');
  });

  const SIGNALLED = {
    vehicles: { data: VEHICLE_ROW, error: null },
    zimra_declarations: { data: GENUINE_ZIMRA, error: null },
    cid_clearance_records: { data: { stolen_check_status: 'Cleared' }, error: null },
    cvr_ownership_records: { data: GENUINE_CVR, error: null },
    vid_inspections: { data: [{ inspection_status: 'Passed' }], error: null },
    partsentry_logs: { count: 4, data: null, error: null },
    vehicle_evidence: { data: [
      { verification_status: 'verified', trust_score_impact: 0 },
      { verification_status: 'verified', trust_score_impact: 0 },
      { verification_status: 'rejected', trust_score_impact: 0 },
    ], error: null },
    stolen_vehicles: { data: null, error: null },
  };

  it('THE ANSWER DID NOT MOVE — a fully-signalled vehicle (genuine registry rows) still scores exactly the same', async () => {
    // 70 baseline +10 duty +10 police +5 cvr +5 VID pass +5 service history = 105, clamped to 100.
    const { client } = pendingSupabase(SIGNALLED);
    const { fn } = instantiateTrust(trustContextSource(), client, { odo: async () => ({ verified: true }), ledger: async () => ({ verified: true }) });
    const { report, triggerEvents } = await fn(VIN);
    assert.equal(report.trustScore, 100);
    assert.deepEqual(report.metrics, {
      cvr_synced: true, zimra_duty: true, zrp_police_cleared: true, blockchain_audit_valid: true,
      odometer_consistent: true, maintenance_logs_count: 4, stolen_alert_active: false,
      evidence_trust_impact: 0, verified_evidence_count: 2, rejected_evidence_count: 1,
    });
    assert.deepEqual(triggerEvents, ['ROUTINE_RECALCULATION']);
  });

  it('T12.1 still holds in the wave — a FORGED registry row (a CUS_ reference) is worth nothing', async () => {
    const { client } = pendingSupabase({ ...SIGNALLED, zimra_declarations: { data: { customs_ref_number: 'CUS_A1B2C3' }, error: null }, cvr_ownership_records: { data: { logbook_serial_number: 'LB_A1B2C3D4E5' }, error: null } });
    const { fn } = instantiateTrust(trustContextSource(), client, { odo: async () => ({ verified: true }), ledger: async () => ({ verified: true }) });
    const { report } = await fn(VIN);
    // 70 +10 police +5 VID +5 service = 90 — no duty, no CVR.
    assert.equal(report.trustScore, 90);
    assert.deepEqual([report.metrics.zimra_duty, report.metrics.cvr_synced], [false, false]);
  });

  it('a penalised fixture also scores exactly as before — the arithmetic order is untouched', async () => {
    const { client } = pendingSupabase({
      vehicles: { data: { ...VEHICLE_ROW, plate_status: 'Flagged', plate_number: null }, error: null },
      zimra_declarations: { data: null, error: null },
      cid_clearance_records: { data: null, error: null },
      cvr_ownership_records: { data: null, error: null },
      vid_inspections: { data: [{ inspection_status: 'Failed_Unroadworthy' }], error: null },
      partsentry_logs: { count: 0, data: null, error: null },
      vehicle_evidence: { data: [], error: null },
      stolen_vehicles: { data: { vin: VIN }, error: null },
    });
    const { fn } = instantiateTrust(trustContextSource(), client, { odo: async () => ({ verified: false }), ledger: async () => ({ verified: false }) });
    const { report, triggerEvents } = await fn(VIN);
    // 70 -20 VID -40 odometer -50 ledger -80 stolen -10 missing plate -50 flagged = -180 → 0.
    assert.equal(report.trustScore, 0);
    assert.deepEqual(triggerEvents.sort(), ['ACTIVE_POLICE_ALERT', 'BLOCKCHAIN_TAMPERING_DETECTED', 'ODOMETER_ROLLBACK_DETECTED', 'PLATE_SUSPENDED_OR_FLAGGED']);
  });

  it('a duplicate plate is still penalised when the guard holds', async () => {
    const { client } = pendingSupabase({ ...SIGNALLED });
    // `vehicles` answers both the row read and the probe; give the probe a duplicate count.
    const probeAnswer = { data: VEHICLE_ROW, error: null, count: 2 };
    const { fn } = instantiateTrust(trustContextSource(), { from: (t) => (t === 'vehicles' ? pendingSupabase({ vehicles: probeAnswer }).client.from(t) : client.from(t)) },
      { odo: async () => ({ verified: true }), ledger: async () => ({ verified: true }) });
    const { report } = await fn(VIN);
    assert.equal(report.trustScore, 55, '105 - 50 duplicate plate = 55');
  });
});
