/**
 * O2 · U2 — THE PASSPORT MUST FETCH IN WAVES, AND MUST STILL SAY THE SAME THING.
 *
 * Owner UAT rejected candidate 1f26282a because `GET /api/vehicles/passport/lookup/GFC27-027051`
 * — the Product Owner's own car — answered 503. The cause was not a slow query. Measured against
 * deployed staging, a single vehicle row read is ~0.28s; the passport made THIRTEEN round trips
 * one after another, and one of them (`computeVehicleTrustScore`) was itself eleven more. Warm:
 * 9.0s. Cold: 15.6s. The edge gave up before the origin did.
 *
 * A wall-clock assertion would be a flaky retelling of that story, so this guard asserts the
 * ARCHITECTURE that produces the latency, deterministically and with no timer:
 *
 *   1. CONCURRENCY IS OBSERVED, NOT ASSUMED. The shipped source is instantiated over a Supabase
 *      double whose reads never settle. Only the vehicle row resolves. A SERIAL builder can then
 *      issue exactly one more read before it blocks; a WAVE issues all of them. The distinction is
 *      a count, taken while every read is still pending — no timing, no ordering luck.
 *   2. THE ANSWER DID NOT MOVE. Same fixture, same numbers: the trust arithmetic is asserted on its
 *      exact score and its exact metrics, because "faster" is worthless if the score changed.
 *   3. GUARDED READS STAY GUARDED. A hoisted read that is issued unconditionally would be a NEW
 *      query against tables the request never needed. Each guard is proven by its absence.
 *   4. FAILURE STILL FAILS. Starting a read earlier must not convert a thrown error into a
 *      swallowed one, an empty array, or an unhandled rejection.
 *
 * ANTI-VACUITY. Section 1 re-runs its own measurement against a DELIBERATELY SERIALIZED copy of the
 * shipped source and requires that copy to fail the same assertion — a concurrency test that cannot
 * detect serial code is a green tick over nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
const trustSrc = fs.readFileSync(
  path.join(here, '..', 'services', 'trustGraph', 'trustGraphService.js'), 'utf8',
);

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

function extractFunction(src, declaration) {
  const declIdx = src.indexOf(declaration);
  assert.ok(declIdx > -1, `${declaration} must still exist — retarget this guard rather than deleting it`);
  const braceIdx = src.indexOf('{', src.indexOf(')', declIdx));
  return src.slice(declIdx, braceIdx) + sliceBalanced(src, braceIdx);
}

const passportSource = () => extractFunction(serverSrc, 'async function buildVehiclePassport');
const trustContextSource = () => extractFunction(trustSrc, 'async function computeVehicleTrustScoreContext');

/**
 * Drain the event loop a bounded number of turns. Deterministic: it yields control rather than
 * waiting for a duration, so it cannot be made flaky by a slow or loaded machine.
 */
async function settle(turns = 50) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

/**
 * A Supabase double that RECORDS every table it is asked for and, by default, never answers.
 * `resolved` names the tables that do answer; everything else stays pending forever, which is what
 * makes "how many reads were in flight at once" observable without a clock.
 */
function pendingSupabase(resolved = {}) {
  const issued = [];
  const never = new Promise(() => {});
  const from = (table) => {
    issued.push(table);
    const answer = Object.prototype.hasOwnProperty.call(resolved, table)
      ? Promise.resolve(resolved[table])
      : never;
    const builder = {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => answer,
      then: (onOk, onErr) => answer.then(onOk, onErr),
    };
    return builder;
  };
  return { issued, client: { from } };
}

const VIN = 'GFC27U2TESTVIN0001';

const VEHICLE_ROW = {
  vin: VIN,
  owner_id: 'u_owner',
  current_seller_id: 'u_seller',
  normalized_plate_number: 'GFC27027051',
  plate_number: 'GFC 27-027051',
  plate_verified_at: '2026-01-01T00:00:00Z',
  plate_status: 'Active',
  publication_status: 'published',
  duty_paid: false,
  police_verified: false,
};

const PASSPORT_DEPENDENCY_NAMES = [
  'supabase', 'getVehicleTimeline', 'normalizeEvidenceRecord', 'mergeEventsWithEvidence',
  'computeVehicleTrustScore', 'verifyChain', 'projectVehicle', 'toPublicEvidence',
  'toPublicPlateHistory', 'toPublicTimelineEvent', 'PASSPORT_PRIVILEGED_ROLES',
];

/** Instantiate the SHIPPED passport source over injected collaborators. */
function instantiatePassport(source, supabase, collaborators = {}) {
  const calls = [];
  const record = (name, value) => (...args) => { calls.push(name); return value(...args); };
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

  /** Run the builder with only the vehicle row answering, and report what got issued anyway. */
  async function issuedWhileAllPending(source) {
    const { issued, client } = pendingSupabase({ vehicles: { data: VEHICLE_ROW, error: null } });
    const { fn, calls } = instantiatePassport(source, client);
    // Deliberately NOT awaited: the builder can never finish, because its reads never answer.
    // What it managed to START before blocking is the measurement.
    fn(VIN, {}, null, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT)
      .catch(() => {});
    await settle();
    return { issued, calls };
  }

  it('starts every independent read before any of them answers', async () => {
    const { issued, calls } = await issuedWhileAllPending(passportSource());
    const tables = new Set(issued);

    assert.ok(tables.has('vehicles'), 'the vehicle row is the one true prerequisite and must be read first');
    for (const table of [
      'vehicle_evidence', 'vehicle_plate_history', 'vehicle_ownership_history',
      'listing_images', 'users',
    ]) {
      assert.ok(tables.has(table),
        `${table} was never issued while every read was still pending — the builder is still `
        + 'waiting for one read before starting the next, which is exactly the 13-round-trip '
        + 'latency the Product Owner saw as a 503.');
    }

    assert.ok(calls.includes('computeVehicleTrustScore'),
      'the trust signals must be started in the same wave, not after the reads have finished');
    assert.ok(calls.includes('verifyChain'),
      'the ledger verification must be started in the same wave');
  });

  it('ANTI-VACUITY — the same measurement FAILS against a deliberately serialized builder', async () => {
    // Re-serialize the wave by awaiting each wrapper the moment it is created. This is the exact
    // shape the code had at 1f26282a, produced mechanically from the shipped source so the control
    // cannot drift away from what it is controlling for.
    //
    // `await wrap(...)` and NOT `wrap(await ...)`: `wrap` takes (name, promise), so injecting the
    // await INSIDE the call would await the NAME — a string — and leave the promise unawaited. The
    // control would then quietly stop serializing anything, which is exactly what it did when the
    // stage-timing rename landed. Awaiting the wrapper itself is unambiguous under any signature.
    const source = passportSource();
    const serialized = source.replace(/= wrap\(/g, '= await wrap(');
    const rewrites = (source.match(/= wrap\(/g) || []).length;
    assert.ok(rewrites >= 6,
      `the serialization control rewrote ${rewrites} call sites — too few to serialize the wave, `
      + 'so it is no longer a control. Retarget it rather than lowering this number.');

    const { issued } = await issuedWhileAllPending(serialized);
    const tables = new Set(issued);
    assert.ok(
      !tables.has('vehicle_ownership_history') || !tables.has('users'),
      'a SERIAL builder must block after its first pending read. This control issued the whole '
      + 'wave anyway, which means the concurrency assertion above proves nothing.',
    );
  });

  it('a read that is guarded stays guarded — no hoist turns a skipped query into a performed one', async () => {
    // No media contract, and no recorded seller: neither the gallery nor the user lookup may run.
    const { issued, client } = pendingSupabase({ vehicles: { data: { ...VEHICLE_ROW, current_seller_id: null }, error: null } });
    const { fn } = instantiatePassport(passportSource(), client);
    fn(VIN, {}, null, CONTRACT, CONTRACT, /* mediaContract */ null, CONTRACT, CONTRACT, CONTRACT)
      .catch(() => {});
    await settle();

    assert.ok(!issued.includes('listing_images'),
      'no media contract was injected, so the gallery read must not be issued at all');
    assert.ok(!issued.includes('users'),
      'the vehicle records no current seller, so the seller-name read must not be issued at all');
    assert.ok(issued.includes('vehicle_plate_history'),
      'the UNguarded reads must still run — otherwise this test would pass on a builder that '
      + 'reads nothing, which proves nothing');
  });

  it('a failing source still fails the request — earlier does not mean swallowed', async () => {
    const boom = Object.assign(new Error('evidence read exploded'), { code: 'PGRST500' });
    const { client } = pendingSupabase({
      vehicles: { data: VEHICLE_ROW, error: null },
      vehicle_evidence: { data: null, error: boom },
    });
    const { fn } = instantiatePassport(passportSource(), client, {
      computeVehicleTrustScore: async () => ({ metrics: null }),
      verifyChain: async () => ({ verified: false, count: 0, chain: [] }),
    });

    let unhandled = null;
    const onUnhandled = (reason) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);
    try {
      await assert.rejects(
        () => fn(VIN, {}, null, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT, CONTRACT),
        /evidence read exploded/,
        'a failed evidence read must still fail the passport, exactly as it did when the read was '
        + 'made inline — never an empty vault presented as "no evidence"',
      );
      await settle();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.equal(unhandled, null,
      'starting reads earlier must never produce an unhandled rejection for a source whose '
      + 'result the failed request never reached');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 2 — THE TRUST SIGNALS FETCH IN ONE WAVE AND SCORE IDENTICALLY
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('U2 — the trust score context fetches concurrently and scores identically', () => {

  function instantiateTrust(source, supabase, { odo, ledger } = {}) {
    const factory = new Function(
      'supabase', 'runOdometerAudit', 'verifyChain',
      `return (${source});`,
    );
    return factory(
      supabase,
      odo || (() => new Promise(() => {})),
      ledger || (() => new Promise(() => {})),
    );
  }

  it('starts every signal read before any of them answers', async () => {
    const { issued, client } = pendingSupabase({ vehicles: { data: VEHICLE_ROW, error: null } });
    const fn = instantiateTrust(trustContextSource(), client);
    fn(VIN).catch(() => {});
    await settle();

    const tables = new Set(issued);
    for (const table of [
      'zimra_declarations', 'cid_clearance_records', 'cvr_ownership_records', 'vid_inspections',
      'partsentry_logs', 'vehicle_evidence', 'stolen_vehicles',
    ]) {
      assert.ok(tables.has(table),
        `${table} was never issued while every read was still pending — the trust context is `
        + 'still serial, and it is the single largest contributor to passport latency.');
    }
  });

  it('the duplicate-plate probe keeps its guard', async () => {
    const { issued, client } = pendingSupabase({
      vehicles: { data: { ...VEHICLE_ROW, normalized_plate_number: null }, error: null },
    });
    const fn = instantiateTrust(trustContextSource(), client);
    fn(VIN).catch(() => {});
    await settle();

    // `vehicles` is read once — for the row itself. A second `vehicles` read would be the
    // duplicate-plate probe running against a vehicle that has no normalized plate to compare.
    assert.equal(issued.filter((t) => t === 'vehicles').length, 1,
      'with no normalized_plate_number there is nothing to compare, so the duplicate-plate '
      + 'count must not be issued');
  });

  it('THE ANSWER DID NOT MOVE — the same fixture still scores exactly the same', async () => {
    // A fully-signalled vehicle: 70 baseline +10 duty +10 police +5 cvr +5 VID pass +5 service
    // history, with a clean odometer, an intact ledger, no stolen alert, a verified plate and no
    // duplicate. 105, clamped to 100.
    const rows = {
      vehicles: { data: VEHICLE_ROW, error: null },
      zimra_declarations: { data: { id: 'z1' }, error: null },
      cid_clearance_records: { data: { stolen_check_status: 'Cleared' }, error: null },
      cvr_ownership_records: { data: { id: 'c1' }, error: null },
      vid_inspections: { data: [{ inspection_status: 'Passed' }], error: null },
      partsentry_logs: { count: 4, data: null, error: null },
      vehicle_evidence: {
        data: [
          { verification_status: 'verified', trust_score_impact: 0 },
          { verification_status: 'verified', trust_score_impact: 0 },
          { verification_status: 'rejected', trust_score_impact: 0 },
        ],
        error: null,
      },
      stolen_vehicles: { data: null, error: null },
    };
    // `vehicles` answers both the row read and the duplicate-plate probe; the probe reads `count`,
    // which is absent here, so it contributes no penalty — the same as finding no duplicate.
    const { client } = pendingSupabase(rows);
    const fn = instantiateTrust(trustContextSource(), client, {
      odo: async () => ({ verified: true }),
      ledger: async () => ({ verified: true }),
    });

    const { report, triggerEvents } = await fn(VIN);
    assert.equal(report.trustScore, 100, 'the clamped score must be unchanged by the wave');
    assert.deepEqual(report.metrics, {
      cvr_synced: true,
      zimra_duty: true,
      zrp_police_cleared: true,
      blockchain_audit_valid: true,
      odometer_consistent: true,
      maintenance_logs_count: 4,
      stolen_alert_active: false,
      evidence_trust_impact: 0,
      verified_evidence_count: 2,
      rejected_evidence_count: 1,
    }, 'these nine metrics are what the passport publishes as `trust_signals`. This is why '
      + '`computeVehicleTrustScore` was NOT removed as legacy: its score is discarded, but its '
      + 'metrics are the passport\'s only source for these facts.');
    assert.deepEqual(triggerEvents, ['ROUTINE_RECALCULATION']);
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
    const fn = instantiateTrust(trustContextSource(), client, {
      odo: async () => ({ verified: false }),
      ledger: async () => ({ verified: false }),
    });

    const { report, triggerEvents } = await fn(VIN);
    // 70 -20 VID -40 odometer -50 ledger -80 stolen -10 missing plate -50 flagged = -180 → 0.
    assert.equal(report.trustScore, 0, 'the floor clamp must be unchanged by the wave');
    assert.deepEqual(triggerEvents.sort(), [
      'ACTIVE_POLICE_ALERT', 'BLOCKCHAIN_TAMPERING_DETECTED',
      'ODOMETER_ROLLBACK_DETECTED', 'PLATE_SUSPENDED_OR_FLAGGED',
    ]);
  });
});
