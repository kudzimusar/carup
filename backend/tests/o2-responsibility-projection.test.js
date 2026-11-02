/**
 * O2/P2 — the "who must act next" responsibility projections (M8 ADR §10.1).
 *
 * Four domains, one vocabulary, zero persistence. Each mapping is TOTAL over its domain's own
 * state vocabulary, and totality is asserted here BY NAME: adding a domain state without deciding
 * its responsibility fails these tests naming the new state, so a state can never silently
 * project as "nobody needs to act".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { RESPONSIBILITY, RESPONSIBILITY_VALUES, isResponsibility } = await import('../services/operations/responsibilityVocabulary.js');
const identity = await import('../services/identity/caseWorkflow.js');
const sellerAuthority = await import('../services/seller/sellerAuthorityService.js');
const dealer = await import('../services/dealer/dealerComplianceService.js');
const transfer = await import('../services/passport/passportOwnershipTransferService.js');

// ─── The vocabulary itself ──────────────────────────────────────────────────

test('the vocabulary is exactly the six ADR §10.1 values, and nothing else', () => {
  assert.deepEqual(
    [...RESPONSIBILITY_VALUES].sort(),
    ['carup_review', 'escalated', 'external_authority', 'none', 'platform_processing', 'subject_action'],
  );
  assert.equal(isResponsibility('carup_review'), true);
  assert.equal(isResponsibility('awaiting_human'), false, 'domain-internal names are not the contract');
  assert.equal(isResponsibility('who_must_act'), false);
});

test('the vocabulary module owns strings only — it must never import a domain service', () => {
  const src = readFileSync(new URL('../services/operations/responsibilityVocabulary.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'six strings need no imports; an import here is drift toward a platform');
  assert.doesNotMatch(src, /from\(|supabase|client/i, 'no persistence: a responsibility is derived, never stored');
});

// ─── Identity Verification ──────────────────────────────────────────────────

test('identity: every WORKFLOW_PHASE maps, to the ADR vocabulary, matching the O2 matrix', () => {
  const expected = {
    [identity.WORKFLOW_PHASE.SYSTEM_PROCESSING]: RESPONSIBILITY.PLATFORM_PROCESSING,
    [identity.WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED]: RESPONSIBILITY.CARUP_REVIEW,
    [identity.WORKFLOW_PHASE.APPLICANT_ACTION_REQUIRED]: RESPONSIBILITY.SUBJECT_ACTION,
    [identity.WORKFLOW_PHASE.ESCALATED]: RESPONSIBILITY.ESCALATED,
    [identity.WORKFLOW_PHASE.RESOLVED_APPROVED]: RESPONSIBILITY.NONE,
    [identity.WORKFLOW_PHASE.RESOLVED_REJECTED]: RESPONSIBILITY.NONE,
    [identity.WORKFLOW_PHASE.CANCELLED]: RESPONSIBILITY.NONE,
  };
  for (const phase of Object.values(identity.WORKFLOW_PHASE)) {
    const projected = identity.toResponsibilityProjection(phase);
    assert.equal(projected, expected[phase], `phase '${phase}'`);
    assert.equal(isResponsibility(projected), true, `phase '${phase}' projects outside the vocabulary`);
  }
});

test('identity: an unmapped phase fails by name instead of projecting silently', () => {
  assert.throws(() => identity.toResponsibilityProjection('brand_new_phase'), /brand_new_phase.*no responsibility mapping/);
});

// ─── Seller Authority ───────────────────────────────────────────────────────

test('seller authority: every status maps, matching the O2 matrix', () => {
  const expected = {
    evidence_submitted: RESPONSIBILITY.CARUP_REVIEW,
    under_review: RESPONSIBILITY.CARUP_REVIEW,
    confirmed: RESPONSIBILITY.NONE,
    insufficient: RESPONSIBILITY.SUBJECT_ACTION,
    disputed: RESPONSIBILITY.ESCALATED,
    revoked: RESPONSIBILITY.NONE,
  };
  for (const status of sellerAuthority.SELLER_AUTHORITY_STATUSES) {
    const projected = sellerAuthority.toResponsibilityProjection(status);
    assert.equal(projected, expected[status], `status '${status}'`);
    assert.equal(isResponsibility(projected), true, `status '${status}' projects outside the vocabulary`);
  }
});

test('seller authority: absence of authority asks the seller to act ONLY in a listing context', () => {
  for (const derived of ['not_assessed', 'recognized']) {
    assert.equal(sellerAuthority.toResponsibilityProjection(derived), RESPONSIBILITY.NONE, `${derived}, no context`);
    assert.equal(
      sellerAuthority.toResponsibilityProjection(derived, { listingContext: true }),
      RESPONSIBILITY.SUBJECT_ACTION,
      `${derived}, listing context`,
    );
  }
  assert.throws(() => sellerAuthority.toResponsibilityProjection('made_up_status'), /made_up_status/);
});

// ─── Dealer Compliance ──────────────────────────────────────────────────────

const HEALTHY_PROFILE = {
  suspension_state: 'active',
  restriction_state: 'none',
  compliance_review_state: 'passed',
  identity_status: 'verified',
  expiry_date: null,
};

test('dealer compliance: the O2 matrix rows, over the same inputs deriveCanPublish reads', () => {
  const cases = [
    ['healthy dealer', { profile: HEALTHY_PROFILE }, RESPONSIBILITY.NONE],
    ['open investigation', { profile: { ...HEALTHY_PROFILE, compliance_review_state: 'investigation' } }, RESPONSIBILITY.ESCALATED],
    ['suspended', { profile: { ...HEALTHY_PROFILE, suspension_state: 'suspended' } }, RESPONSIBILITY.SUBJECT_ACTION],
    ['restricted', { profile: { ...HEALTHY_PROFILE, restriction_state: 'restricted' } }, RESPONSIBILITY.SUBJECT_ACTION],
    ['expired document', { profile: { ...HEALTHY_PROFILE, expiry_date: '2020-01-01' } }, RESPONSIBILITY.SUBJECT_ACTION],
    ['blocking requirement, nothing submitted', {
      profile: HEALTHY_PROFILE,
      blockingRequirements: [{ is_blocking: true, status: 'missing' }],
    }, RESPONSIBILITY.SUBJECT_ACTION],
    ['blocking requirement, submitted and awaiting decision', {
      profile: HEALTHY_PROFILE,
      blockingRequirements: [{ is_blocking: true, status: 'submitted' }],
    }, RESPONSIBILITY.CARUP_REVIEW],
    ['verified blocking requirement no longer blocks', {
      profile: HEALTHY_PROFILE,
      blockingRequirements: [{ is_blocking: true, status: 'verified' }],
    }, RESPONSIBILITY.NONE],
    ['identity not verified', { profile: { ...HEALTHY_PROFILE, identity_status: 'pending' } }, RESPONSIBILITY.SUBJECT_ACTION],
    ['review not yet passed', { profile: { ...HEALTHY_PROFILE, compliance_review_state: 'pending' } }, RESPONSIBILITY.CARUP_REVIEW],
  ];
  for (const [label, input, expected] of cases) {
    const projected = dealer.toResponsibilityProjection(input);
    assert.equal(projected, expected, label);
    assert.equal(isResponsibility(projected), true, `${label} projects outside the vocabulary`);
  }
});

test('dealer compliance: the domain statuses are not replaced — suspended still refuses publish while projecting subject_action', () => {
  const profile = { ...HEALTHY_PROFILE, suspension_state: 'suspended' };
  assert.equal(dealer.deriveCanPublish(profile, []), false, 'the domain gate keeps its own answer');
  assert.equal(dealer.toResponsibilityProjection({ profile }), RESPONSIBILITY.SUBJECT_ACTION);
});

// ─── Ownership transfer ─────────────────────────────────────────────────────

test('ownership transfer: every migration state maps, matching the O2 matrix', () => {
  // The state list from 20260828203000's CHECK constraint — read from the migration so a state
  // added there without a mapping decision fails HERE by name.
  const ddl = readFileSync(new URL('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql', import.meta.url), 'utf8');
  const checkBlock = /CHECK \(state IN \(([^)]+)\)\)/.exec(ddl);
  assert.ok(checkBlock, 'the transfer state CHECK must remain statically locatable');
  const states = [...checkBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(states.length >= 9, `expected the full transfer state vocabulary, found ${states.length}`);

  const expected = {
    initiated: RESPONSIBILITY.SUBJECT_ACTION,
    awaiting_parties: RESPONSIBILITY.SUBJECT_ACTION,
    evidence_required: RESPONSIBILITY.SUBJECT_ACTION,
    under_review: RESPONSIBILITY.CARUP_REVIEW,
    transaction_complete: RESPONSIBILITY.EXTERNAL_AUTHORITY,
    registry_pending: RESPONSIBILITY.EXTERNAL_AUTHORITY,
    complete: RESPONSIBILITY.NONE,
    disputed: RESPONSIBILITY.ESCALATED,
    cancelled: RESPONSIBILITY.NONE,
  };
  for (const state of states) {
    const projected = transfer.toResponsibilityProjection(state);
    assert.equal(projected, expected[state], `state '${state}'`);
    assert.equal(isResponsibility(projected), true, `state '${state}' projects outside the vocabulary`);
  }
});

test('ownership transfer: completion waits on a registry, never on an SLA-bearing CarUp queue', () => {
  // The states between the parties finishing and legal completion are EXTERNAL waits: completion
  // requires a real registry authority + completion reference, so CarUp review alone cannot finish
  // it, and (ADR §6) no SLA clock may ever run against them.
  assert.equal(transfer.toResponsibilityProjection('transaction_complete'), RESPONSIBILITY.EXTERNAL_AUTHORITY);
  assert.equal(transfer.toResponsibilityProjection('registry_pending'), RESPONSIBILITY.EXTERNAL_AUTHORITY);
});
