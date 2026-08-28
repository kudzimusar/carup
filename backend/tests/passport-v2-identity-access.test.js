import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LOOKUP_DECISIONS,
} from '../utils/passportLookupPolicy.js';
import {
  PASSPORT_AUDIENCES,
} from '../services/passport/passportContract.js';
import {
  assertRequestedAudienceAllowed,
  resolvePassportAudienceFromCapabilities,
  resolvePassportLookupRequest,
} from '../services/passport/passportAccessPolicy.js';
import {
  PASSPORT_CLAIM_STATES,
  canTransitionPassportClaim,
  transitionPassportClaim,
} from '../services/passport/passportClaimStateMachine.js';

test('V2: Passport lookup delegates to the canonical Issue #164 lookup policy', () => {
  const vin = resolvePassportLookupRequest({
    identifier: '1HGCM82633A004352',
    actor: null,
  });
  assert.equal(vin.query_allowed, true);
  assert.equal(vin.access.decision, LOOKUP_DECISIONS.ALLOW);

  const plate = resolvePassportLookupRequest({
    identifier: 'AEZ 1234',
    actor: null,
  });
  assert.equal(plate.query_allowed, false);
  assert.equal(plate.access.decision, LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);

  const authenticatedPlate = resolvePassportLookupRequest({
    identifier: 'AEZ 1234',
    actor: { id: 'buyer-1' },
  });
  assert.equal(authenticatedPlate.query_allowed, true);
});

test('V2: malformed identifiers never become queries', () => {
  const result = resolvePassportLookupRequest({ identifier: '../../etc/passwd' });
  assert.equal(result.query_allowed, false);
  assert.equal(result.access.decision, LOOKUP_DECISIONS.INVALID);
});

test('V2: audience resolution uses established capabilities, not role-name inference', () => {
  assert.equal(resolvePassportAudienceFromCapabilities({}), PASSPORT_AUDIENCES.PUBLIC);
  assert.equal(
    resolvePassportAudienceFromCapabilities({ transactionAccess: true }),
    PASSPORT_AUDIENCES.BUYER,
  );
  assert.equal(
    resolvePassportAudienceFromCapabilities({ ownerRelationship: true, transactionAccess: true }),
    PASSPORT_AUDIENCES.OWNER,
  );
  assert.equal(
    resolvePassportAudienceFromCapabilities({ governanceAccess: true, ownerRelationship: true }),
    PASSPORT_AUDIENCES.GOVERNANCE,
  );
});

test('V2: callers cannot self-request a privileged Passport audience', () => {
  assert.throws(
    () => assertRequestedAudienceAllowed(PASSPORT_AUDIENCES.OWNER, { transactionAccess: true }),
    /not authorized/i,
  );
  assert.equal(
    assertRequestedAudienceAllowed(PASSPORT_AUDIENCES.BUYER, { ownerRelationship: true }),
    PASSPORT_AUDIENCES.BUYER,
  );
});

test('V2: claim workflow cannot jump directly from unclaimed to verified', () => {
  assert.equal(
    canTransitionPassportClaim(PASSPORT_CLAIM_STATES.NOT_CLAIMED, PASSPORT_CLAIM_STATES.VERIFIED),
    false,
  );
  assert.throws(
    () => transitionPassportClaim(
      PASSPORT_CLAIM_STATES.NOT_CLAIMED,
      PASSPORT_CLAIM_STATES.VERIFIED,
      { actorId: 'owner-1', reviewAuthority: true },
    ),
    /illegal/i,
  );
});

test('V2: verified/rejected/revoked claim decisions require review authority', () => {
  assert.throws(
    () => transitionPassportClaim(
      PASSPORT_CLAIM_STATES.UNDER_REVIEW,
      PASSPORT_CLAIM_STATES.VERIFIED,
      { actorId: 'owner-1', reviewAuthority: false },
    ),
    /review authority/i,
  );

  const decision = transitionPassportClaim(
    PASSPORT_CLAIM_STATES.UNDER_REVIEW,
    PASSPORT_CLAIM_STATES.VERIFIED,
    {
      actorId: 'reviewer-1',
      reviewAuthority: true,
      occurredAt: '2026-08-28T10:00:00Z',
    },
  );
  assert.equal(decision.to, PASSPORT_CLAIM_STATES.VERIFIED);
  assert.equal(decision.review_authority, true);
});

test('V2: a dispute is explicit and requires a reason', () => {
  assert.throws(
    () => transitionPassportClaim(
      PASSPORT_CLAIM_STATES.VERIFIED,
      PASSPORT_CLAIM_STATES.DISPUTED,
      { actorId: 'owner-1' },
    ),
    /reason/i,
  );

  const disputed = transitionPassportClaim(
    PASSPORT_CLAIM_STATES.VERIFIED,
    PASSPORT_CLAIM_STATES.DISPUTED,
    { actorId: 'owner-1', reason: 'Vehicle was transferred without my consent.' },
  );
  assert.equal(disputed.to, PASSPORT_CLAIM_STATES.DISPUTED);
});

test('V2 anti-fork: access policy imports canonical lookup policy and owns no auth/session/database implementation', () => {
  const src = readFileSync('backend/services/passport/passportAccessPolicy.js', 'utf8');
  assert.match(src, /passportLookupPolicy\.js/);
  assert.doesNotMatch(src, /x-user-id|x-session-token|authorization/i);
  assert.doesNotMatch(src, /\.from\s*\(|supabase/i);
  assert.doesNotMatch(src, /new Set\(\['admin'|'government'/);
});
