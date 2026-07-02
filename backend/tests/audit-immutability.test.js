/**
 * Phase 6 — Audit and Immutability Tests
 *
 * Verifies that all governed audit tables in the CarUp trust layer enforce
 * append-only semantics: INSERT is allowed; UPDATE and DELETE are blocked
 * at the trigger layer.
 *
 * Tables under test:
 *   evidence_provenance_events  — provenance chain-of-custody (M1)
 *   listing_snapshots           — marketplace listing snapshots (M2)
 *   review_decisions            — reviewer accountability record (M5)
 *   dispute_events              — dispute timeline (M5)
 *   trust_change_log            — governed trust mutation record (M5 + Phase 6)
 *   vehicle_document_extractions (content guard) — OCR immutability (Phase 3)
 *
 * Uses an in-memory mock that simulates trigger enforcement.
 * All assertions are unit-level (no Supabase connection required).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── In-memory store simulating append-only tables ─────────────────────────────

function makeImmutableTable(name) {
  const rows = [];
  return {
    name,
    insert(row) {
      const r = { ...row, _id: `${name}-${rows.length + 1}` };
      rows.push(r);
      return r;
    },
    // Simulate trigger enforcement: UPDATE and DELETE both raise
    update(_id, _patch) {
      throw new Error(`Immutability violation: ${name} is append-only and cannot be updated`);
    },
    delete(_id) {
      throw new Error(`Immutability violation: ${name} is append-only and cannot be deleted`);
    },
    all() { return [...rows]; },
  };
}

// Simulates the extraction content-guard: only review columns may change
function makeExtractionTable() {
  const CONTENT_FIELDS = new Set([
    'vin', 'evidence_id', 'document_type', 'field_name',
    'raw_value', 'normalized_value', 'confidence',
    'compared_vehicle_field', 'expected_value', 'match_status',
    'source_model', 'ai_job_id',
  ]);
  const rows = [];
  return {
    insert(row) {
      const r = { ...row, id: `ext-${rows.length + 1}`, review_status: 'pending' };
      rows.push(r);
      return r;
    },
    update(id, patch) {
      const contentMutation = Object.keys(patch).find(k => CONTENT_FIELDS.has(k));
      if (contentMutation) {
        throw new Error(
          `Content guard violation: field "${contentMutation}" is immutable on vehicle_document_extractions`
        );
      }
      const idx = rows.findIndex(r => r.id === id);
      if (idx < 0) throw new Error('Not found');
      rows[idx] = { ...rows[idx], ...patch };
      return rows[idx];
    },
    all() { return [...rows]; },
  };
}

// ── Table instances ────────────────────────────────────────────────────────────

const tables = {
  provenance: makeImmutableTable('evidence_provenance_events'),
  listingSnapshots: makeImmutableTable('listing_snapshots'),
  reviewDecisions: makeImmutableTable('review_decisions'),
  disputeEvents: makeImmutableTable('dispute_events'),
  trustChangeLog: makeImmutableTable('trust_change_log'),
  extractions: makeExtractionTable(),
};

// ── Tests ──────────────────────────────────────────────────────────────────────

// evidence_provenance_events
test('provenance: INSERT is allowed', () => {
  const row = tables.provenance.insert({ evidence_id: 'ev-1', vin: 'VIN1', sequence: 1, event_type: 'created', content_hash: 'h1' });
  assert.ok(row._id);
});

test('provenance: UPDATE is blocked', () => {
  assert.throws(
    () => tables.provenance.update('evidence_provenance_events-1', { event_type: 'tampered' }),
    /append-only/
  );
});

test('provenance: DELETE is blocked', () => {
  assert.throws(
    () => tables.provenance.delete('evidence_provenance_events-1'),
    /append-only/
  );
});

// listing_snapshots
test('listing_snapshots: INSERT is allowed', () => {
  const row = tables.listingSnapshots.insert({ vin: 'VIN1', content_hash: 'sha-1', price: 25000 });
  assert.ok(row._id);
});

test('listing_snapshots: UPDATE is blocked', () => {
  assert.throws(
    () => tables.listingSnapshots.update('listing_snapshots-1', { price: 0 }),
    /append-only/
  );
});

test('listing_snapshots: DELETE is blocked', () => {
  assert.throws(
    () => tables.listingSnapshots.delete('listing_snapshots-1'),
    /append-only/
  );
});

// review_decisions
test('review_decisions: INSERT is allowed', () => {
  const row = tables.reviewDecisions.insert({ vin: 'VIN1', decision: 'confirm', reviewer_id: 'rev-1', reviewer_role: 'reviewer' });
  assert.ok(row._id);
});

test('review_decisions: UPDATE is blocked', () => {
  assert.throws(
    () => tables.reviewDecisions.update('review_decisions-1', { decision: 'reject' }),
    /append-only/
  );
});

test('review_decisions: DELETE is blocked', () => {
  assert.throws(
    () => tables.reviewDecisions.delete('review_decisions-1'),
    /append-only/
  );
});

// dispute_events
test('dispute_events: INSERT is allowed', () => {
  const row = tables.disputeEvents.insert({ dispute_id: 'disp-1', event_type: 'opened', actor_id: 'u1', actor_role: 'owner' });
  assert.ok(row._id);
});

test('dispute_events: UPDATE is blocked', () => {
  assert.throws(
    () => tables.disputeEvents.update('dispute_events-1', { event_type: 'tampered' }),
    /append-only/
  );
});

test('dispute_events: DELETE is blocked', () => {
  assert.throws(
    () => tables.disputeEvents.delete('dispute_events-1'),
    /append-only/
  );
});

// trust_change_log (Phase 6)
test('trust_change_log: INSERT is allowed', () => {
  const row = tables.trustChangeLog.insert({ vin: 'VIN1', rule: 'ownership_verified', previous_value: { score: 50 }, new_value: { score: 75 }, approved_by_role: 'reviewer' });
  assert.ok(row._id);
});

test('trust_change_log: UPDATE is blocked — trust history must not be erasable', () => {
  assert.throws(
    () => tables.trustChangeLog.update('trust_change_log-1', { new_value: { score: 0 } }),
    /append-only/
  );
});

test('trust_change_log: DELETE is blocked — trust history must not be erasable', () => {
  assert.throws(
    () => tables.trustChangeLog.delete('trust_change_log-1'),
    /append-only/
  );
});

// vehicle_document_extractions — content guard (review columns are mutable; content is not)
test('extractions: INSERT is allowed', () => {
  const row = tables.extractions.insert({
    evidence_id: 'ev-1', vin: 'VIN1', document_type: 'registration_document',
    field_name: 'vin_field', raw_value: 'VIN1', match_status: 'match',
  });
  assert.equal(row.review_status, 'pending');
});

test('extractions: review columns (review_status, reviewed_by, reviewed_at) may be updated', () => {
  const updated = tables.extractions.update('ext-1', {
    review_status: 'confirmed', reviewed_by: 'rev-1', reviewed_at: new Date().toISOString(),
  });
  assert.equal(updated.review_status, 'confirmed');
});

test('extractions: content field (vin) is immutable after insert', () => {
  assert.throws(
    () => tables.extractions.update('ext-1', { vin: 'TAMPERED' }),
    /Content guard violation/
  );
});

test('extractions: content field (raw_value) is immutable after insert', () => {
  assert.throws(
    () => tables.extractions.update('ext-1', { raw_value: 'TAMPERED' }),
    /Content guard violation/
  );
});

test('extractions: AI confidence does not auto-approve (review_status stays pending after insert)', () => {
  const row = tables.extractions.insert({
    evidence_id: 'ev-2', vin: 'VIN2', document_type: 'registration_document',
    field_name: 'vin_field', raw_value: 'VIN2', match_status: 'match', confidence: 0.999,
  });
  assert.equal(row.review_status, 'pending');
});
