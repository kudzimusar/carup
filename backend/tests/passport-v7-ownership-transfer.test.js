import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PASSPORT_AUDIENCES } from '../services/passport/passportContract.js';
import {
  PASSPORT_TRANSFER_STATES,
  canTransitionPassportTransfer,
  transferAccessState,
  transitionPassportTransfer,
} from '../services/passport/passportTransferStateMachine.js';
import {
  buildOwnershipHistory,
} from '../services/passport/passportOwnershipProjection.js';

test('V7: sold/transaction complete is not ownership transfer complete', () => {
  assert.equal(
    canTransitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.TRANSACTION_COMPLETE,
      PASSPORT_TRANSFER_STATES.COMPLETE,
    ),
    true,
  );

  assert.throws(
    () => transitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.TRANSACTION_COMPLETE,
      PASSPORT_TRANSFER_STATES.COMPLETE,
      { actorId: 'reviewer-1', registryAuthorityConfirmed: false },
    ),
    /requires governed ownership\/registry confirmation/i,
  );
});

test('V7: transfer cannot jump from not-started to complete', () => {
  assert.equal(
    canTransitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.NOT_STARTED,
      PASSPORT_TRANSFER_STATES.COMPLETE,
    ),
    false,
  );
});

test('V7: previously completed transfer cannot be ordinary-cancelled after dispute', () => {
  assert.equal(
    canTransitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.DISPUTED,
      PASSPORT_TRANSFER_STATES.CANCELLED,
      { previouslyCompleted: true },
    ),
    false,
  );

  assert.throws(
    () => transitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.DISPUTED,
      PASSPORT_TRANSFER_STATES.CANCELLED,
      { actorId: 'owner-1', previouslyCompleted: true },
    ),
    /Illegal Passport transfer transition/,
  );
});

test('V7: dispute requires an explicit reason', () => {
  assert.throws(
    () => transitionPassportTransfer(
      PASSPORT_TRANSFER_STATES.UNDER_REVIEW,
      PASSPORT_TRANSFER_STATES.DISPUTED,
      { actorId: 'owner-1' },
    ),
    /requires a reason/i,
  );
});

test('V7: completion changes owner-level access relationship', () => {
  assert.deepEqual(
    transferAccessState({
      transferState: PASSPORT_TRANSFER_STATES.COMPLETE,
      relationship: 'previous_owner',
    }),
    { passport_owner_access: false, transfer_action_access: false },
  );

  assert.deepEqual(
    transferAccessState({
      transferState: PASSPORT_TRANSFER_STATES.COMPLETE,
      relationship: 'new_owner',
    }),
    { passport_owner_access: true, transfer_action_access: true },
  );
});

test('V7: public and owner history never exposes prior owner IDs', () => {
  const rows = [
    {
      id: 'own-2',
      state: 'current',
      started_at: '2026-08-20T00:00:00Z',
      source_type: 'ownership_record',
      source_ref: 'record-2',
      authority: 'CarUp governed record',
      verification_state: 'verified',
      owner_id: 'new-owner-private',
      owner_type: 'individual',
      display_label: 'Current owner',
    },
    {
      id: 'own-1',
      state: 'historical',
      started_at: '2025-01-01T00:00:00Z',
      ended_at: '2026-08-20T00:00:00Z',
      source_type: 'ownership_record',
      source_ref: 'record-1',
      authority: 'CarUp governed record',
      verification_state: 'verified',
      owner_id: 'prior-owner-private',
      owner_type: 'individual',
      display_label: 'Previous owner',
    },
  ];

  for (const audience of [PASSPORT_AUDIENCES.PUBLIC, PASSPORT_AUDIENCES.OWNER]) {
    const result = buildOwnershipHistory(rows, { audience });
    const rendered = JSON.stringify(result);
    assert.equal(rendered.includes('new-owner-private'), false);
    assert.equal(rendered.includes('prior-owner-private'), false);
  }

  const governance = buildOwnershipHistory(rows, { audience: PASSPORT_AUDIENCES.GOVERNANCE });
  assert.equal(governance.current_relationship.owner_id, 'new-owner-private');
});

test('V7: multiple current owners fail closed instead of choosing one', () => {
  assert.throws(
    () => buildOwnershipHistory([
      {
        id: 'a',
        state: 'current',
        source_type: 'ownership_record',
        source_ref: 'a',
      },
      {
        id: 'b',
        state: 'current',
        source_type: 'ownership_record',
        source_ref: 'b',
      },
    ]),
    /multiple current owners/i,
  );
});

test('V7: unknown ownership coverage stays unknown', () => {
  const result = buildOwnershipHistory([], {
    coverageState: 'unknown',
    limitations: ['Historical registry coverage is unavailable.'],
  });
  assert.equal(result.state, 'unknown');
  assert.equal(result.current_relationship, null);
  assert.equal(result.history.length, 0);
});

test('V7 anti-fork: ownership/transfer foundation owns no database or sale mutation', () => {
  const src = [
    readFileSync('backend/services/passport/passportTransferStateMachine.js', 'utf8'),
    readFileSync('backend/services/passport/passportOwnershipProjection.js', 'utf8'),
  ].join('\n');

  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /markSold|listing_status|publication_status|escrow/i);
});
