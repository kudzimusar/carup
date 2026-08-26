import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ANNOUNCED_FINGERPRINT_COLUMN,
  TRUST_PRESENTATION_CHANGED_EVENT,
  emitTrustPresentationChange,
  reconcileTrustPresentation,
  trustPresentationFingerprint,
} from '../services/trustDecision/trustPresentationChangeProducer.js';

/**
 * R5-D1 — a customer-visible Trust change must not be permanently lost because the outbox insert
 * failed after the canonical cache write.
 *
 * THE DEFECT this closes, precisely:
 *
 *   cache write succeeds -> emit fails -> error swallowed -> next refresh compares the new cache
 *   against the new cache, finds no material change, and the event is never reconstructed.
 *
 * The fix compares against what was ANNOUNCED, not against what was last written. An announcement
 * that never happened is still outstanding.
 */

const VIN = 'FIXTUREVIN0000001';

function record(overrides = {}) {
  return {
    vin: VIN, evaluation_state: 'evaluated', score: 78, band: 'moderate', confidence: 'medium',
    evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
    calculation_version: 'trust-decision-1.0.0', evaluated_at: '2026-08-26T00:00:00.000Z',
    known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
    source: 'cache', ...overrides,
  };
}

/** A store where the vehicles row is mutable, so the durable marker behaves like a real column. */
function world({ owner = 'owner-1' } = {}) {
  const vehicles = [{ vin: VIN, owner_id: owner, [ANNOUNCED_FINGERPRINT_COLUMN]: null }];
  const users = [{ id: 'owner-1', status: 'active', deleted_at: null }];
  const emitted = [];
  let failNextEmit = false;

  const client = {
    from: (table) => {
      const rows = table === 'vehicles' ? vehicles : table === 'users' ? users : [];
      const filters = [];
      let patch = null;
      const api = {
        select: () => api,
        eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
        update: (p) => { patch = p; return api; },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) || null, error: null }),
        then: (res, rej) => {
          if (patch) rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
  const pgClient = {
    query: async (_sql, params) => {
      if (failNextEmit) { failNextEmit = false; throw new Error('outbox insert failed'); }
      emitted.push({ event_type: params[0], payload: JSON.parse(params[1]) });
      return { rows: [{ id: `e${emitted.length}` }] };
    },
  };
  return { vehicles, emitted, client, pgClient, failNext: () => { failNextEmit = true; } };
}

// ============================================================================
// THE MANDATORY FAILURE TEST
// ============================================================================

test('R5-D1 a lost announcement is RECOVERED — the exact defect', async () => {
  const w = world();

  // State A is announced normally.
  const stateA = record({ evaluation_state: 'not_evaluated', score: null, band: null });
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: stateA, client: w.client, pgClient: w.pgClient });
  assert.equal(w.emitted.length, 1, 'state A announced');
  const announcedA = w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN];
  assert.equal(announcedA, trustPresentationFingerprint(stateA));

  // Refresh produces material state B. The canonical write succeeds; the outbox insert FAILS.
  const stateB = record();
  w.failNext();
  await assert.rejects(
    () => emitTrustPresentationChange({ vin: VIN, previousRecord: stateA, nextRecord: stateB, client: w.client, pgClient: w.pgClient }),
    /outbox insert failed/,
  );
  assert.equal(w.emitted.length, 1, 'no event for state B');
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], announcedA,
    'the marker is written only AFTER a durable emit, so it still points at state A');

  // THE NEXT REFRESH is where the old implementation loses the event forever. The canonical cache
  // now HOLDS state B, so the refresh compares B against B, finds nothing material, and returns.
  // The customer is never told, and no later refresh will ever reconstruct it.
  //
  // The durable marker still points at state A, so the announcement is outstanding and is emitted.
  const nextRefresh = await emitTrustPresentationChange({
    vin: VIN, previousRecord: stateB, nextRecord: stateB, client: w.client, pgClient: w.pgClient,
  });
  assert.equal(nextRefresh.emitted, true,
    'THE DEFECT: comparing the cache against itself finds no change, and the announcement is lost');
  assert.equal(w.emitted.length, 2, 'state B reaches the outbox on the next refresh');

  // And the standalone recovery path reaches the same conclusion without waiting for a refresh.
  const recovery = await reconcileTrustPresentation(VIN, {
    client: w.client, pgClient: w.pgClient, getRecord: async () => stateB,
  });

  assert.equal(recovery.emitted, false, 'and it is idempotent — state B was already announced');
  assert.equal(recovery.reason, 'already_announced');
  assert.equal(w.emitted.length, 2, 'exactly one event for state B, not two');
  assert.equal(w.emitted[1].event_type, TRUST_PRESENTATION_CHANGED_EVENT);
  assert.equal(w.emitted[1].payload.trust.evaluation_state, 'evaluated');
  assert.equal(w.emitted[1].payload.recipientUserId, 'owner-1');
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], trustPresentationFingerprint(stateB));
});

test('R5-D1 recovery is EXACTLY ONCE — reconciling the same transition again emits nothing', async () => {
  const w = world();
  const stateB = record();
  w.failNext();
  await assert.rejects(() => emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: stateB, client: w.client, pgClient: w.pgClient }));

  const first = await reconcileTrustPresentation(VIN, { client: w.client, pgClient: w.pgClient, getRecord: async () => stateB });
  const second = await reconcileTrustPresentation(VIN, { client: w.client, pgClient: w.pgClient, getRecord: async () => stateB });
  const third = await reconcileTrustPresentation(VIN, { client: w.client, pgClient: w.pgClient, getRecord: async () => stateB });

  assert.equal(first.emitted, true);
  assert.equal(second.emitted, false);
  assert.equal(second.reason, 'already_announced');
  assert.equal(third.emitted, false);
  assert.equal(w.emitted.length, 1, 'one customer Email, not three');
});

test('R5-D1 a NEW materially different position after recovery still emits', async () => {
  const w = world();
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: record(), client: w.client, pgClient: w.pgClient });
  const moved = record({ score: 85, band: 'high' });
  const verdict = await emitTrustPresentationChange({ vin: VIN, previousRecord: record(), nextRecord: moved, client: w.client, pgClient: w.pgClient });

  assert.equal(verdict.emitted, true);
  assert.equal(w.emitted.length, 2);
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], trustPresentationFingerprint(moved));
});

test('R5-D1 timestamp-only recomputation still emits NOTHING', async () => {
  const w = world();
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: record(), client: w.client, pgClient: w.pgClient });
  const verdict = await emitTrustPresentationChange({
    vin: VIN, previousRecord: record(), nextRecord: record({ evaluated_at: '2027-01-01T00:00:00.000Z' }),
    client: w.client, pgClient: w.pgClient,
  });
  assert.equal(verdict.emitted, false);
  assert.equal(verdict.reason, 'already_announced', 'the fingerprint is identical, so there is nothing outstanding');
  assert.equal(w.emitted.length, 1);
});

test('R5-D1 recovery still refuses when no owner resolves', async () => {
  const w = world({ owner: null });
  const verdict = await reconcileTrustPresentation(VIN, { client: w.client, pgClient: w.pgClient, getRecord: async () => record() });
  assert.equal(verdict.emitted, false);
  assert.equal(verdict.reason, 'no_resolvable_owner');
  assert.equal(w.emitted.length, 0);
  assert.equal(w.vehicles[0][ANNOUNCED_FINGERPRINT_COLUMN], null, 'and nothing is marked announced');
});

test('R5-D1 the fingerprint is deterministic and material-field driven', () => {
  const base = record();
  assert.equal(trustPresentationFingerprint(base), trustPresentationFingerprint(record()), 'deterministic');
  assert.equal(trustPresentationFingerprint(base), trustPresentationFingerprint(record({ evaluated_at: '2030-01-01' })), 'evaluated_at is not material');
  for (const [field, value] of [['score', 85], ['band', 'high'], ['evaluation_state', 'stale'], ['confidence', 'high'], ['known_limitations', ['x']]]) {
    assert.notEqual(trustPresentationFingerprint(base), trustPresentationFingerprint(record({ [field]: value })), `${field} must change the fingerprint`);
  }
});

test('R5-D1 the event carries the fingerprint so a consumer can dedupe too', async () => {
  const w = world();
  await emitTrustPresentationChange({ vin: VIN, previousRecord: null, nextRecord: record(), client: w.client, pgClient: w.pgClient });
  assert.equal(w.emitted[0].payload.presentation_fingerprint, trustPresentationFingerprint(record()));
  // Still no private data.
  const serialized = JSON.stringify(w.emitted[0].payload);
  assert.ok(!serialized.includes('owner_id'));
  assert.ok(!serialized.includes('"trust_score"'));
});

test('R5-D1 refreshCanonicalTrust remains the ONE Trust writer', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const producer = fs.readFileSync(path.join(root, 'services/trustDecision/trustPresentationChangeProducer.js'), 'utf8');
  const code = producer.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  // The producer writes exactly one thing: the announcement marker. It never writes a trust column.
  for (const column of ['trust_score', 'trust_band', 'trust_evaluation_state', 'trust_calculation_version', 'trust_confidence']) {
    assert.ok(!code.includes(column), `the producer must never write ${column}`);
  }
  assert.ok(code.includes(ANNOUNCED_FINGERPRINT_COLUMN));
});

// ============================================================================
// G5-D1 / G5-D2 / G5-D3 — the migration package and the reason set
// ============================================================================

const MIGRATION = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  'database/migrations/20260826120000_email_1_0_hardening.sql',
);

test('G5-D1 the migration changes the DEFAULT and rewrites NO existing row', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /ALTER COLUMN version SET DEFAULT 2/);
  // A v1 row is a v1 credential that is still in somebody's inbox.
  assert.ok(!/UPDATE\s+public\.email_reply_tokens/i.test(sql), 'no backfill may rewrite existing token rows');
  assert.ok(!/SET\s+version\s*=/i.test(sql));
});

test('G5-D2 the permanent reason set contains the exact strings the resolver emits', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolver = fs.readFileSync(path.join(root, 'services/communication/resendWebhookService.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(root, 'services/communication/communicationWebhookService.js'), 'utf8');
  const permanentBlock = webhook.slice(webhook.indexOf('const permanentReasons'), webhook.indexOf('const permanent ='));

  // Every reason `resolveBoundParticipant` emits, taken from source rather than invented.
  const bound = [...resolver.matchAll(/reason: '(bound_participant_[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(bound.length >= 3, 'the resolver emits bound_participant_* reasons');
  for (const reason of bound) {
    assert.ok(permanentBlock.includes(`'${reason}'`), `${reason} is structurally permanent and must not be retried`);
  }

  // A genuine database or network fault must STILL retry.
  assert.ok(!permanentBlock.includes("'lookup_failed"), 'a transient lookup fault must remain retryable');
});

test('G5-D3 the duplicate index is dropped, and the UNIQUE constraint that replaces it remains', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /DROP INDEX IF EXISTS public\.idx_email_reply_tokens_hash/);
  // Proof of redundancy, from the original migration: a plain btree on exactly (token_hash), no
  // predicate, default opclass — identical coverage to the UNIQUE constraint on the same column.
  const original = fs.readFileSync(
    path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'database/migrations/20260817160000_email_reply_tokens.sql'),
    'utf8',
  );
  assert.match(original, /token_hash\s+text NOT NULL UNIQUE/, 'the UNIQUE constraint provides the equivalent index');
  assert.match(original, /CREATE INDEX IF NOT EXISTS idx_email_reply_tokens_hash ON public\.email_reply_tokens \(token_hash\);/);
  // Nothing else that serves credential lookup is touched.
  assert.ok(!/DROP INDEX[^;]*token_hash_key/i.test(sql), 'the unique constraint index must never be dropped');
});

test('R5-D1 the migration adds the durable marker without touching trust values', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS trust_presentation_announced_fingerprint text/);
  assert.ok(!/UPDATE\s+public\.vehicles/i.test(sql), 'no vehicle row is rewritten');
  assert.ok(!/trust_score/i.test(sql.replace(/--.*$/gm, '')), 'no trust value is touched');
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});
