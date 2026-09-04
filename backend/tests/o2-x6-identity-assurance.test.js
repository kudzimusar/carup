/**
 * O2-X6 — the canonical identity-assurance projection (identity_assurance.v1).
 *
 * Pinned laws: ONE projection; history ≠ present; honest freshness (unknown
 * stays unknown); fail-closed levels; canonical who_must_act; no raw identity
 * artifacts; the EMAIL flag (users.is_verified) is never read; assurance
 * grants no domain authority (source-pinned against the owning services).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../db/supabase.js';
import {
  getIdentityAssurance,
  ASSURANCE_LEVELS,
  FRESHNESS_STATES,
  IDENTITY_ASSURANCE_POLICY_VERSION,
} from '../services/identity/identityAssuranceService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');

/* Chainable mock over the two tables the projection may touch. */
const db = { identity_lifecycle_events: [], verification_sessions: [] };
const queriedTables = [];
function builder(table) {
  queriedTables.push(table);
  const filters = [];
  const api = {
    select() { return api; },
    eq(column, value) { filters.push([column, value]); return api; },
    order() { return api; },
    limit() { return api; },
    maybeSingle() {
      const row = (db[table] || []).find((candidate) => filters.every(([c, v]) => candidate[c] === v)) || null;
      return Promise.resolve({ data: row, error: null });
    },
    then(resolve) {
      const rows = (db[table] || []).filter((candidate) => filters.every(([c, v]) => candidate[c] === v));
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}
const mockClient = { from: (table) => builder(table) };
function reset() { db.identity_lifecycle_events = []; db.verification_sessions = []; queriedTables.length = 0; }

const APPROVED = (over = {}) => ({
  id: 'vs-1', user_id: 'u1', status: 'verified', reviewed_at: '2026-06-01T10:00:00.000Z',
  updated_at: '2026-06-01T10:00:00.000Z', created_at: '2026-05-30T10:00:00.000Z',
  ocr_result: { additional_fields: {} }, ...over,
});

test('established: a historically approved identity with no ledger and no recorded expiry', async () => {
  reset();
  db.verification_sessions = [APPROVED()];
  const a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.policy_version, IDENTITY_ASSURANCE_POLICY_VERSION);
  assert.equal(a.assurance_level, ASSURANCE_LEVELS.ESTABLISHED);
  assert.equal(a.identity_state, 'verified');
  assert.equal(a.historically_verified, true);
  assert.equal(a.verified_at, '2026-06-01T10:00:00.000Z');
  assert.equal(a.freshness_state, FRESHNESS_STATES.NO_EXPIRY_RECORDED, 'unknown stays unknown — no fabricated freshness');
  assert.equal(a.usable_for_identity_gated_actions, true);
  assert.equal(a.who_must_act, 'none');
});

test('history ≠ present: a reviewer reverification_required coexists with the historical approval', async () => {
  reset();
  db.verification_sessions = [APPROVED()];
  db.identity_lifecycle_events = [{ id: 'e1', seq: 1, user_id: 'u1', next_state: 'reverification_required', reason_code: 'DOCUMENT_EXPIRED', created_at: '2026-08-01T00:00:00Z' }];
  const a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.assurance_level, ASSURANCE_LEVELS.REVERIFICATION_REQUIRED);
  assert.equal(a.reverification_required, true);
  assert.equal(a.usable_for_identity_gated_actions, false, 'fails closed for identity-gated capability');
  assert.equal(a.historically_verified, true, 'the past approval is preserved as history');
  assert.ok(a.verified_at, 'verified_at survives the current requirement');
  assert.equal(a.who_must_act, 'subject_action');
});

test('freshness from real facts: recorded future expiry → within_recorded_validity; recorded past expiry → expired + derived reverification', async () => {
  reset();
  const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
  db.verification_sessions = [APPROVED({ ocr_result: { additional_fields: { expiry: future } } })];
  let a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.freshness_state, FRESHNESS_STATES.WITHIN_RECORDED_VALIDITY);
  assert.equal(a.document_expiry.recorded, true);
  assert.ok(a.document_expiry.expires_at);

  reset();
  db.verification_sessions = [APPROVED({ ocr_result: { additional_fields: { expiry: '2020-01-01' } } })];
  a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.freshness_state, FRESHNESS_STATES.EXPIRED);
  assert.equal(a.assurance_level, ASSURANCE_LEVELS.REVERIFICATION_REQUIRED);
  assert.equal(a.usable_for_identity_gated_actions, false);
});

test('pending only while the PLATFORM owes an answer; subject-side phases stay not_established', async () => {
  reset();
  db.verification_sessions = [{ id: 'vs-2', user_id: 'u1', status: 'pending_manual_review', created_at: '2026-09-01T00:00:00Z' }];
  let a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.assurance_level, ASSURANCE_LEVELS.PENDING);
  assert.equal(a.pending_review, true);

  reset();
  db.verification_sessions = [{ id: 'vs-3', user_id: 'u1', status: 'draft', created_at: '2026-09-01T00:00:00Z' }];
  a = await getIdentityAssurance(mockClient, 'u1');
  assert.equal(a.assurance_level, ASSURANCE_LEVELS.NOT_ESTABLISHED);
  assert.equal(a.pending_review, false);
});

test('unusable: suspended/compromised/disputed/revoked all fail closed', async () => {
  for (const state of ['suspended', 'compromised', 'disputed', 'revoked']) {
    reset();
    db.verification_sessions = [APPROVED()];
    db.identity_lifecycle_events = [{ id: 'e1', seq: 2, user_id: 'u1', next_state: state, reason_code: null, created_at: '2026-08-01T00:00:00Z' }];
    const a = await getIdentityAssurance(mockClient, 'u1');
    assert.equal(a.assurance_level, ASSURANCE_LEVELS.UNUSABLE, state);
    assert.equal(a.usable_for_identity_gated_actions, false, state);
    assert.ok(['carup_review', 'escalated', 'none'].includes(a.who_must_act), state);
  }
});

test('who_must_act is canonical and total across every level', async () => {
  const CANONICAL = ['none', 'platform_processing', 'carup_review', 'subject_action', 'external_authority', 'escalated'];
  const cases = [
    () => { db.verification_sessions = [APPROVED()]; },
    () => { db.verification_sessions = [{ id: 'v', user_id: 'u1', status: 'ocr_pending', created_at: 'x' }]; },
    () => { db.verification_sessions = []; },
    () => { db.verification_sessions = [APPROVED()]; db.identity_lifecycle_events = [{ id: 'e', seq: 1, user_id: 'u1', next_state: 'disputed', created_at: 'x' }]; },
    () => { db.verification_sessions = [APPROVED()]; db.identity_lifecycle_events = [{ id: 'e', seq: 1, user_id: 'u1', next_state: 'reverification_required', created_at: 'x' }]; },
  ];
  for (const seed of cases) {
    reset(); seed();
    const a = await getIdentityAssurance(mockClient, 'u1');
    assert.ok(CANONICAL.includes(a.who_must_act), `${a.assurance_level} → ${a.who_must_act}`);
  }
});

test('NO raw identity artifacts: the serialized projection carries no OCR payload, document numbers, paths, scores or notes', async () => {
  reset();
  db.verification_sessions = [APPROVED({
    ocr_result: { additional_fields: { expiry: '2030-01-01', id_number: '63-123456A70', name: 'T Moyo' }, raw: 'FULL OCR DUMP' },
  })];
  const a = await getIdentityAssurance(mockClient, 'u1');
  const json = JSON.stringify(a);
  for (const banned of ['ocr', 'id_number', '63-123456A70', 'FULL OCR DUMP', 'selfie', 'storage', 'file_ref', 'score', 'note', 'session_id']) {
    assert.ok(!json.toLowerCase().includes(banned.toLowerCase()), `projection must not carry '${banned}'`);
  }
});

test('the EMAIL flag is never read: the projection touches only lifecycle + session tables', async () => {
  reset();
  db.verification_sessions = [APPROVED()];
  await getIdentityAssurance(mockClient, 'u1');
  assert.ok(!queriedTables.includes('users'), 'users.is_verified (email flag) must never inform assurance');
  assert.deepEqual([...new Set(queriedTables)].sort(), ['identity_lifecycle_events', 'verification_sessions']);
});

test('SOURCE PINS — assurance grants nothing: the authority services never import the projection', () => {
  for (const file of [
    'backend/services/seller/sellerAuthorityService.js',
    'backend/services/dealer/dealerComplianceService.js',
    'backend/services/trustDecision/canonicalTrustService.js',
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.ok(!source.includes('identityAssuranceService'),
      `${file} must not consume assurance — its authority is decided by its own governed rules`);
    assert.ok(!source.includes('assurance_level'), `${file} must not branch on assurance levels`);
  }
});

test('the registration journey and dealer onboarding consume the CANONICAL projection (no duplicated derivation)', () => {
  const registration = fs.readFileSync(path.join(repoRoot, 'backend/services/registration/registrationJourneyService.js'), 'utf8');
  assert.ok(registration.includes("identityAssuranceService.js"), 'registration imports the projection');
  assert.ok(!registration.includes('getCurrentIdentityLifecycle'), 'registration no longer interprets the lifecycle itself');
  const dealer = fs.readFileSync(path.join(repoRoot, 'backend/services/dealer/dealerOnboardingService.js'), 'utf8');
  assert.ok(dealer.includes("identityAssuranceService.js"), 'dealer onboarding imports the projection');
  assert.ok(!dealer.includes('getCurrentIdentityLifecycle'), 'dealer onboarding no longer hand-picks lifecycle fields');
});
