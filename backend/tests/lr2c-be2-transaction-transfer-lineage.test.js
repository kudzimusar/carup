import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  beginOwnershipTransferFromTransaction,
  getOwnershipTransferByTransaction,
} from '../services/passport/passportOwnershipTransferService.js';
import { createMockSupabase } from './helpers/mockSupabase.js';

const TX = '11111111-1111-1111-1111-111111111111';
const VIN = 'VIN-BE2-001';
const SELLER = 'seller-a';
const BUYER = 'buyer-a';

function transfer(overrides = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    transaction_intent_id: TX,
    vin: VIN,
    previous_owner_id: SELLER,
    incoming_owner_id: BUYER,
    tenant_id: null,
    state: 'initiated',
    registry_authority: null,
    completed_at: null,
    version: 1,
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
    ...overrides,
  };
}

test('BE2 creation sends only exact transaction identity plus authenticated actor to canonical RPC', async () => {
  let call = null;
  const client = {
    async rpc(name, args) {
      call = { name, args };
      return { data: transfer(), error: null };
    },
  };

  const result = await beginOwnershipTransferFromTransaction(client, {
    transactionIntentId: TX,
    idempotencyKey: 'be2-idem-1',
    vin: 'CLIENT-MUST-NOT-AUTHOR',
    incomingOwnerId: 'CLIENT-MUST-NOT-AUTHOR',
  }, {
    id: SELLER,
    role: 'owner',
  });

  assert.equal(call.name, 'passport_begin_ownership_transfer_from_transaction_atomic');
  assert.deepEqual(call.args, {
    p_transaction_intent_id: TX,
    p_actor_id: SELLER,
    p_actor_role: 'owner',
    p_idempotency_key: 'be2-idem-1',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(call.args, 'p_vin'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(call.args, 'p_incoming_owner_id'), false);
  assert.equal(result.transaction_intent_id, TX);
  assert.equal(result.transfer.vin, VIN);
  assert.equal(result.transfer.relationship, 'previous_owner');
  assert.equal(Object.prototype.hasOwnProperty.call(result.transfer, 'previous_owner_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.transfer, 'incoming_owner_id'), false);
});

test('BE2 exact transaction read returns the existing participant projection only', async () => {
  const client = createMockSupabase({
    escrow_trust_sessions: [{ id: TX, vin: VIN, buyer_id: BUYER, seller_id: SELLER }],
    vehicle_ownership_transfers: [transfer()],
  });

  const result = await getOwnershipTransferByTransaction(client, TX, { id: BUYER, role: 'buyer' });
  assert.equal(result.id, transfer().id);
  assert.equal(result.vin, VIN);
  assert.equal(result.relationship, 'incoming_owner');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'previous_owner_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'incoming_owner_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'transaction_intent_id'), false);
});

test('BE2 cross-account transaction read is denied before transfer disclosure', async () => {
  const client = createMockSupabase({
    escrow_trust_sessions: [{ id: TX, vin: VIN, buyer_id: BUYER, seller_id: SELLER }],
    vehicle_ownership_transfers: [transfer()],
  });

  await assert.rejects(
    () => getOwnershipTransferByTransaction(client, TX, { id: 'account-c', role: 'buyer' }),
    /not a participant in this transaction/i,
  );
});

test('BE2 zero transaction-transfer links return truthful unavailable/null', async () => {
  const client = createMockSupabase({
    escrow_trust_sessions: [{ id: TX, vin: VIN, buyer_id: BUYER, seller_id: SELLER }],
    vehicle_ownership_transfers: [],
  });
  assert.equal(await getOwnershipTransferByTransaction(client, TX, { id: BUYER, role: 'buyer' }), null);
});

test('BE2 ambiguous duplicate lineage fails closed even though the database constraint should prevent it', async () => {
  const client = createMockSupabase({
    escrow_trust_sessions: [{ id: TX, vin: VIN, buyer_id: BUYER, seller_id: SELLER }],
    vehicle_ownership_transfers: [
      transfer({ id: 'transfer-1' }),
      transfer({ id: 'transfer-2' }),
    ],
  });

  await assert.rejects(
    () => getOwnershipTransferByTransaction(client, TX, { id: BUYER, role: 'buyer' }),
    /ambiguous; refusing to choose/i,
  );
});

test('BE2 linked transfer must reconcile exact VIN and transaction participants', async () => {
  const client = createMockSupabase({
    escrow_trust_sessions: [{ id: TX, vin: VIN, buyer_id: BUYER, seller_id: SELLER }],
    vehicle_ownership_transfers: [transfer({ vin: 'VIN-WRONG' })],
  });

  await assert.rejects(
    () => getOwnershipTransferByTransaction(client, TX, { id: BUYER, role: 'buyer' }),
    /conflicts with canonical transaction truth/i,
  );
});

test('BE2 routes require a real session and accept no client VIN/incoming-owner authority', () => {
  const routeSource = readFileSync(new URL('../routes/passportOwnershipTransferRoutes.js', import.meta.url), 'utf8');
  const postStart = routeSource.indexOf("'/api/transactions/:transactionIntentId/ownership-transfer'");
  const getStart = routeSource.indexOf("'/api/transactions/:transactionIntentId/ownership-transfer'", postStart + 1);
  const legacyRead = routeSource.indexOf("'/api/ownership-transfers/:transferId'", getStart);
  assert.ok(postStart >= 0 && getStart > postStart && legacyRead > getStart);

  const postBlock = routeSource.slice(postStart, getStart);
  const getBlock = routeSource.slice(getStart, legacyRead);
  assert.match(postBlock, /authorizeSessionRole\(\[\]\)/);
  assert.match(getBlock, /authorizeSessionRole\(\[\]\)/);
  assert.doesNotMatch(postBlock, /req\.body\?\.vin|req\.body\.vin/i);
  assert.doesNotMatch(postBlock, /incoming_owner_id/);
  assert.match(postBlock, /req\.params\.transactionIntentId/);
  assert.match(getBlock, /req\.params\.transactionIntentId/);
});

test('BE2 migration declares nullable FK + unique non-null transaction lineage and no heuristic backfill', () => {
  const sql = readFileSync(
    new URL('../../database/migrations/20261016182000_lr2c_be2_transaction_ownership_transfer_lineage.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS transaction_intent_id UUID/i);
  assert.match(sql, /FOREIGN KEY \(transaction_intent_id\)[\s\S]*REFERENCES public\.escrow_trust_sessions\(id\)[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownership_transfer_transaction_intent[\s\S]*WHERE transaction_intent_id IS NOT NULL/i);
  assert.match(sql, /v_tx\.vin/);
  assert.match(sql, /v_tx\.buyer_id/);
  assert.match(sql, /v_tx\.seller_id/);
  assert.match(sql, /v_vehicle\.owner_id IS DISTINCT FROM v_tx\.seller_id/);
  assert.match(sql, /passport_begin_ownership_transfer_atomic\([\s\S]*v_tx\.vin,[\s\S]*v_tx\.buyer_id/i);
  assert.doesNotMatch(sql, /ORDER BY[\s\S]{0,120}(created_at|updated_at)/i);
  assert.doesNotMatch(sql, /(created_at|updated_at)[\s\S]{0,120}ORDER BY/i);
  assert.doesNotMatch(sql, /latest[^\n]*transfer/i);
  assert.doesNotMatch(sql, /SET transaction_intent_id[\s\S]{0,200}WHERE[^;]*(vin|buyer_id|seller_id|created_at|updated_at)/i);
});

test('BE2 legacy null lineage is explicitly preserved and no historical backfill is authored', () => {
  const sql = readFileSync(
    new URL('../../database/migrations/20261016182000_lr2c_be2_transaction_ownership_transfer_lineage.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /is_nullable[\s\S]*'YES'/i);
  assert.match(sql, /Historical transfers are deliberately NOT backfilled/i);
  assert.doesNotMatch(sql, /transaction_intent_id UUID NOT NULL/i);
});

test('BE2 preserves completion governance, registry authority, encumbrance and seller supersession', () => {
  const service = readFileSync(new URL('../services/passport/passportOwnershipTransferService.js', import.meta.url), 'utf8');
  assert.match(service, /toState === 'complete' && !GOVERNANCE_ROLES\.has\(identity\.role\)/);
  assert.match(service, /Completion requires registryAuthority and completionReference/);
  assert.match(service, /getGovernedEncumbrance\(client, transferRow\.vin\)/);
  assert.match(service, /supersedeSellerAuthorityOnOwnershipTransfer/);

  const ownershipMigration = readFileSync(
    new URL('../../database/migrations/20260903120000_ownership_transfer_retires_tenant_relationship.sql', import.meta.url),
    'utf8',
  );
  assert.match(ownershipMigration, /ownership transfer completion requires governance authority/i);
  assert.match(ownershipMigration, /ownership transfer completion requires governed authority and completion reference/i);
});
