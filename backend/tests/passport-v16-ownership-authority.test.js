import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  beginOwnershipTransfer,
  transitionOwnershipTransfer,
  getOwnershipTransfer,
} from '../services/passport/passportOwnershipTransferService.js';

function rpcClient(handler) {
  return { rpc: handler };
}

test('V16 ownership authority: begin delegates only canonical identity + actor + idempotency', async () => {
  let call;
  const client = rpcClient(async (name, args) => {
    call = { name, args };
    return { data: { id: 'transfer-1', vin: 'VIN-1', state: 'initiated' }, error: null };
  });
  const out = await beginOwnershipTransfer(client, {
    vin: 'VIN-1',
    incomingOwnerId: 'new-owner',
    idempotencyKey: 'idem-1',
  }, { id: 'old-owner', role: 'owner' });

  assert.equal(call.name, 'passport_begin_ownership_transfer_atomic');
  assert.deepEqual(call.args, {
    p_vin: 'VIN-1',
    p_incoming_owner_id: 'new-owner',
    p_actor_id: 'old-owner',
    p_actor_role: 'owner',
    p_idempotency_key: 'idem-1',
  });
  assert.equal(out.legal_ownership_completed, false);
});

test('V16 ownership authority: non-governance caller cannot complete transfer', async () => {
  const client = rpcClient(async () => ({ data: null, error: null }));
  await assert.rejects(
    () => transitionOwnershipTransfer(client, {
      transferId: 'transfer-1',
      toState: 'complete',
      registryAuthority: 'registry',
      completionReference: 'ref-1',
    }, { id: 'old-owner', role: 'owner' }),
    /Governance authority is required/,
  );
});

test('V16 ownership authority: completion requires governed reference', async () => {
  const client = rpcClient(async () => ({ data: null, error: null }));
  await assert.rejects(
    () => transitionOwnershipTransfer(client, {
      transferId: 'transfer-1',
      toState: 'complete',
    }, { id: 'reviewer-1', role: 'government' }),
    /registryAuthority and completionReference/,
  );
});

test('V16 ownership authority: completed result proves same Passport VIN', async () => {
  const client = rpcClient(async (name, args) => ({
    data: {
      id: args.p_transfer_id,
      vin: 'VIN-1',
      previous_owner_id: 'old-owner',
      incoming_owner_id: 'new-owner',
      state: 'complete',
      registry_authority: 'manual_governed_review',
      completed_at: '2026-08-28T12:00:00Z',
    },
    error: null,
  }));

  const out = await transitionOwnershipTransfer(client, {
    transferId: 'transfer-1',
    toState: 'complete',
    registryAuthority: 'manual_governed_review',
    completionReference: 'case-1',
  }, { id: 'reviewer-1', role: 'government' });

  assert.equal(out.legal_ownership_completed, true);
  assert.equal(out.same_passport_vin, 'VIN-1');
});

test('V16 ownership authority: participant read redacts owner identifiers', async () => {
  const row = {
    id: 'transfer-1',
    vin: 'VIN-1',
    previous_owner_id: 'old-owner',
    incoming_owner_id: 'new-owner',
    state: 'under_review',
    registry_authority: null,
    completed_at: null,
    version: 2,
    created_at: 'a',
    updated_at: 'b',
  };
  const client = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: row, error: null }; },
      };
    },
  };

  const out = await getOwnershipTransfer(client, 'transfer-1', { id: 'new-owner', role: 'owner' });
  assert.equal(out.relationship, 'incoming_owner');
  assert.equal(out.previous_owner_id, undefined);
  assert.equal(out.incoming_owner_id, undefined);
});

test('V16 ownership migration is atomic, append-only and rejects sale/payment as ownership proof', () => {
  const sql = readFileSync('database/migrations/20260828203000_passport_ownership_transfer_authority.sql', 'utf8');

  assert.match(sql, /passport_begin_ownership_transfer_atomic/);
  assert.match(sql, /passport_transition_ownership_transfer_atomic/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /UPDATE public\.vehicles\s+SET owner_id=v_transfer\.incoming_owner_id/);
  assert.match(sql, /current_seller_id=NULL/);
  assert.match(sql, /current_seller_type=NULL/);
  assert.match(sql, /current_seller_type_source=NULL/);
  assert.match(sql, /WHEN publication_status='published' THEN 'publishable'/);
  assert.match(sql, /INSERT INTO public\.vehicle_ownership_history/);
  assert.match(sql, /vehicle_ownership_transfer_events/);
  assert.match(sql, /ownership transfer completion requires governed authority and completion reference/i);
  assert.doesNotMatch(sql, /safepay_escrows|payment_status\s*=|escrowed/i);
});

test('V16 ownership migration seals the post-completion dispute state machine', () => {
  const sql = readFileSync('database/migrations/20260828203000_passport_ownership_transfer_authority.sql', 'utf8');
  assert.match(sql, /IF v_transfer\.completed_at IS NOT NULL THEN/);
  assert.match(sql, /WHEN 'complete' THEN p_to_state='disputed'/);
  assert.match(sql, /WHEN 'disputed' THEN p_to_state='complete'/);
  assert.match(sql, /completed ownership transfer cannot return to pre-completion state/i);
  assert.match(sql, /completed ownership transfer cannot be cancelled/i);
  assert.match(sql, /v_transfer\.completed_at IS NOT NULL AND p_to_state='cancelled'/);
});

test('V16 ownership migration prevents duplicate active transfers and duplicate history completion', () => {
  const sql = readFileSync('database/migrations/20260828203000_passport_ownership_transfer_authority.sql', 'utf8');
  assert.match(sql, /uq_vehicle_ownership_transfer_active_vin/);
  assert.match(sql, /uq_vehicle_ownership_history_transfer/);
  assert.match(sql, /ON CONFLICT \(transfer_id\).*DO NOTHING/s);
});

test('V16 ownership service owns no direct vehicle/history mutation', () => {
  const src = readFileSync('backend/services/passport/passportOwnershipTransferService.js', 'utf8');
  assert.doesNotMatch(src, /\.from\(['"]vehicles['"]\).*update/s);
  assert.doesNotMatch(src, /\.from\(['"]vehicle_ownership_history['"]\).*insert/s);
  assert.match(src, /passport_transition_ownership_transfer_atomic/);
});
