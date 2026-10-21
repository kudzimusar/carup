/**
 * CARUP-MVP-STAB-01 F-012 — THE ODOMETER AUDIT SAYS WHAT ITS READINGS CAN SUPPORT.
 *
 * `runOdometerAudit` answered `verified: true` for a vehicle with zero or one odometer reading, for a
 * VIN that does not exist and for a database read that failed — and the passport published that as
 * `trustSignals.odometer_consistent: true` (staging Serena GFC27-027051: `maintenance_logs_count: 0`),
 * which the web rendered as a green "Verified". docs/hardening/AUTHORITY_AUDIT_REGISTER.md carries the
 * same open finding: replace the boolean with an explicit coverage state so "no checkpoints" and
 * "unknown VIN" report not_evaluated.
 *
 * The audit now also returns `evidence_state` + `observation_count`:
 *
 *   unavailable                — a read failed (nothing is known in either direction; count null)
 *   not_evaluated              — unknown VIN, or no readings
 *   insufficient_evidence      — exactly one reading (consistency is a relation between two readings)
 *   inconsistency_detected     — two or more readings, at least one goes backwards
 *   no_inconsistency_detected  — two or more readings, none goes backwards
 *
 * `verified` / `odometer_consistent` keep their legacy values for legacy clients — each case below
 * pins the old value next to the new state, so a "fix" that quietly changes the boolean also fails.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { supabase } = await import('../db/supabase.js');
const { runOdometerAudit, computeVehicleTrustScore } = await import('../services/trustGraph/trustGraphService.js');

const VIN = 'MVPSTAB01ODO000001';
const realFrom = supabase.from;
afterEach(() => { supabase.from = realFrom; });

/**
 * A Supabase double. `world[table]` is the `{ data, error, count }` that table answers with; a table
 * the world does not name answers an empty, successful read. Every filter is chainable.
 */
function installWorld(world) {
  const issued = [];
  supabase.from = (table) => {
    issued.push(table);
    const answer = Object.prototype.hasOwnProperty.call(world, table)
      ? world[table]
      : { data: null, error: null, count: 0 };
    const builder = {
      select: () => builder, eq: () => builder, neq: () => builder, in: () => builder,
      lte: () => builder, order: () => builder, limit: () => builder, single: () => builder,
      then: (onOk, onErr) => Promise.resolve(answer).then(onOk, onErr),
    };
    return builder;
  };
  return issued;
}

const VEHICLE = { data: { mileage: 61000 }, error: null };
// PostgREST's zero-row answer to `.single()` — an ordinary "no such vehicle", not a failure.
const NO_VEHICLE = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
const reading = (id, mileage, timestamp) => ({ id, mileage, timestamp });
const logs = (...rows) => ({ data: rows, error: null, count: rows.length });

describe('F-012 — runOdometerAudit reports an explicit evidence state', () => {
  it('an unknown VIN is not_evaluated — and keeps the legacy verified:true it always returned', async () => {
    installWorld({ vehicles: NO_VEHICLE, partsentry_logs: logs() });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'not_evaluated');
    assert.equal(audit.observation_count, 0);
    // Legacy shape, unchanged (deprecated: vacuous below two readings).
    assert.equal(audit.verified, true);
    assert.equal(audit.checkpointsCount, 0);
    assert.equal(audit.baseMileage, 0);
    assert.deepEqual(audit.anomalies, []);
  });

  it('an unknown VIN stays not_evaluated even if readings answer for it — no vehicle, no evaluation', async () => {
    // partsentry_logs.vin references vehicles(vin), so this cannot happen on a healthy schema; the rule
    // is stated anyway so an orphaned or mis-keyed read can never make a non-existent vehicle "consistent".
    installWorld({
      vehicles: NO_VEHICLE,
      partsentry_logs: logs(reading(1, 40000, '2025-01-01T00:00:00Z'), reading(2, 52000, '2025-09-01T00:00:00Z')),
    });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'not_evaluated');
  });

  it('a known vehicle with no odometer readings is not_evaluated, never a consistency claim', async () => {
    installWorld({ vehicles: VEHICLE, partsentry_logs: logs() });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'not_evaluated');
    assert.equal(audit.observation_count, 0);
    assert.equal(audit.verified, true, 'legacy value unchanged');
  });

  it('exactly one reading is insufficient_evidence — one reading is consistent with nothing', async () => {
    installWorld({ vehicles: VEHICLE, partsentry_logs: logs(reading(1, 61000, '2026-05-01T00:00:00Z')) });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'insufficient_evidence');
    assert.equal(audit.observation_count, 1);
    assert.equal(audit.verified, true, 'legacy value unchanged');
  });

  it('a repeated reading (same mileage, same moment) counts once, so it is still insufficient_evidence', async () => {
    installWorld({
      vehicles: VEHICLE,
      partsentry_logs: logs(reading(1, 61000, '2026-05-01T00:00:00Z'), reading(2, 61000, '2026-05-01T00:00:00Z')),
    });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.observation_count, 1);
    assert.equal(audit.evidence_state, 'insufficient_evidence');
  });

  it('POSITIVE — two or more rising readings are no_inconsistency_detected, with the count that supports it', async () => {
    installWorld({
      vehicles: VEHICLE,
      partsentry_logs: logs(
        reading(1, 40000, '2025-01-01T00:00:00Z'),
        reading(2, 52000, '2025-09-01T00:00:00Z'),
        reading(3, 61000, '2026-05-01T00:00:00Z'),
      ),
    });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'no_inconsistency_detected');
    assert.equal(audit.observation_count, 3);
    assert.equal(audit.verified, true);
    assert.deepEqual(audit.anomalies, []);
  });

  it('NEGATIVE — a reading that goes backwards is inconsistency_detected (and verified stays false, as before)', async () => {
    installWorld({
      vehicles: VEHICLE,
      partsentry_logs: logs(reading(1, 90000, '2025-01-01T00:00:00Z'), reading(2, 60000, '2026-01-01T00:00:00Z')),
    });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'inconsistency_detected');
    assert.equal(audit.observation_count, 2);
    assert.equal(audit.verified, false);
    assert.equal(audit.anomalies.length, 1);
    assert.equal(audit.anomalies[0].type, 'ODOMETER_ROLLBACK');
  });

  it('a failed readings query is unavailable with no count — never "0 readings", never consistent', async () => {
    installWorld({ vehicles: VEHICLE, partsentry_logs: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'unavailable');
    assert.equal(audit.observation_count, null, 'a read that failed counted nothing — the count is unknown, not zero');
    assert.equal(audit.verified, true, 'legacy value unchanged (it ignored the error before; it is deprecated now)');
  });

  it('a failed vehicle read is unavailable even when the readings were read', async () => {
    installWorld({
      vehicles: { data: null, error: { code: '', message: 'TypeError: fetch failed' } },
      partsentry_logs: logs(reading(1, 40000, '2025-01-01T00:00:00Z'), reading(2, 52000, '2025-09-01T00:00:00Z')),
    });
    const audit = await runOdometerAudit(VIN);
    assert.equal(audit.evidence_state, 'unavailable');
    assert.equal(audit.observation_count, null);
  });
});

describe('F-012 — the trust signals carry the state beside the deprecated boolean', () => {
  async function metricsFor(world) {
    installWorld(world);
    const report = await computeVehicleTrustScore(VIN, {
      vehicleRow: { vin: VIN, normalized_plate_number: null },
      ledgerVerdict: Promise.resolve({ verified: true, count: 0, chain: [] }),
    });
    return report.metrics;
  }

  it('one reading: odometer_consistent keeps its legacy true, the state says insufficient_evidence', async () => {
    const metrics = await metricsFor({ vehicles: VEHICLE, partsentry_logs: logs(reading(1, 61000, '2026-05-01T00:00:00Z')) });
    assert.equal(metrics.odometer_consistent, true);
    assert.equal(metrics.odometer_evidence_state, 'insufficient_evidence');
    assert.equal(metrics.odometer_observation_count, 1);
  });

  it('a rollback: odometer_consistent false and inconsistency_detected agree', async () => {
    const metrics = await metricsFor({
      vehicles: VEHICLE,
      partsentry_logs: logs(reading(1, 90000, '2025-01-01T00:00:00Z'), reading(2, 60000, '2026-01-01T00:00:00Z')),
    });
    assert.equal(metrics.odometer_consistent, false);
    assert.equal(metrics.odometer_evidence_state, 'inconsistency_detected');
    assert.equal(metrics.odometer_observation_count, 2);
  });

  it('a failed readings read: odometer_consistent keeps its legacy true, the state says unavailable with no count', async () => {
    const metrics = await metricsFor({ vehicles: VEHICLE, partsentry_logs: { data: null, error: { message: 'connection reset' } } });
    assert.equal(metrics.odometer_consistent, true);
    assert.equal(metrics.odometer_evidence_state, 'unavailable');
    assert.equal(metrics.odometer_observation_count, null);
  });
});
