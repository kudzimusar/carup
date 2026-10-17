/**
 * OC-5J — a governed ownership-transfer refusal is not a server error (ported from PR #208 4002dbea,
 * an owner-UAT defect OC-5C's port dropped; its tests O2-UAT-3..5 were not carried either).
 *
 * The transfer functions refuse in a deliberate vocabulary: 42501 "only current owner or governance
 * may initiate transfer", 23505 "an active ownership transfer already exists", P0002, 23514, 22023.
 * Every one reached the caller as HTTP 500 DATABASE_ERROR "Failed to … ownership transfer" — telling
 * the operator CarUp broke when CarUp refused, and throwing the reason away. Proven on all three paths
 * (begin, transition, read), behaviourally: a refusal keeps its own words and its own status; an
 * unexpected fault is still a DatabaseError.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { ForbiddenError, NotFoundError, ConflictError, ValidationError, DatabaseError } = await import('../utils/errors.js');
const svc = await import('../services/passport/passportOwnershipTransferService.js');

const ACTOR = { id: 'u-gov', role: 'admin' };
const rpcClient = (error) => ({ rpc: async () => ({ data: null, error }) });
const readClient = (error) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error }) };
  return { from: () => q };
};

const REFUSALS = [
  ['42501', 'only current owner or governance may initiate transfer', ForbiddenError, 403],
  ['P0002', 'ownership transfer not found', NotFoundError, 404],
  ['23505', 'an active ownership transfer already exists for this vehicle', ConflictError, 409],
  ['23514', 'governed current owner is required before transfer', ConflictError, 409],
  ['22023', 'transfer id, target state and actor are required', ValidationError, 400],
];

const isRefusal = (Expected, status, words) => (error) => {
  assert.ok(error instanceof Expected, `expected ${Expected.name}, got ${error?.constructor?.name}: ${error?.message}`);
  assert.ok(!(error instanceof DatabaseError), 'a governed refusal is not a DatabaseError');
  assert.equal(error.statusCode, status);
  assert.equal(error.message, words, 'the refusal keeps its own words');
  return true;
};
const isFault = (error) => {
  assert.ok(error instanceof DatabaseError, `an unexpected fault stays a DatabaseError, got ${error?.constructor?.name}`);
  assert.equal(error.statusCode, 500);
  return true;
};

for (const [code, words, Expected, status] of REFUSALS) {
  test(`begin: ${code} "${words.slice(0, 40)}…" is a ${status}, not a 500`, async () => {
    await assert.rejects(() => svc.beginOwnershipTransfer(rpcClient({ code, message: words }), { vin: 'V1', incomingOwnerId: 'u-new' }, ACTOR),
      isRefusal(Expected, status, words));
  });
}

test('transition translates too: a governance refusal is a 403, and a refused state change a 409', async () => {
  await assert.rejects(() => svc.transitionOwnershipTransfer(rpcClient({ code: '42501', message: 'only governance may approve this transfer' }),
    { transferId: 't-1', toState: 'cancelled' }, ACTOR), isRefusal(ForbiddenError, 403, 'only governance may approve this transfer'));
  await assert.rejects(() => svc.transitionOwnershipTransfer(rpcClient({ code: '23514', message: 'transfer is not in a state that allows this' }),
    { transferId: 't-1', toState: 'cancelled' }, ACTOR), isRefusal(ConflictError, 409, 'transfer is not in a state that allows this'));
});

test('read translates too: a row-security refusal is a 403', async () => {
  await assert.rejects(() => svc.getOwnershipTransfer(readClient({ code: '42501', message: 'permission denied for table vehicle_ownership_transfers' }), 't-1', ACTOR),
    isRefusal(ForbiddenError, 403, 'permission denied for table vehicle_ownership_transfers'));
});

test('an unexpected fault is still a DatabaseError — on every path — and is never dressed up as a refusal', async () => {
  const fault = { code: '08006', message: 'connection failure' };
  await assert.rejects(() => svc.beginOwnershipTransfer(rpcClient(fault), { vin: 'V1', incomingOwnerId: 'u-new' }, ACTOR), isFault);
  await assert.rejects(() => svc.transitionOwnershipTransfer(rpcClient(fault), { transferId: 't-1', toState: 'cancelled' }, ACTOR), isFault);
  await assert.rejects(() => svc.getOwnershipTransfer(readClient(fault), 't-1', ACTOR), isFault);
});
