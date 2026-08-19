import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { canActorTransition } = await import('../services/escrow/escrowTrustService.js');

const session = { buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'initiated' };

for (const state of ['funded_sandbox', 'released_sandbox', 'refunded_sandbox']) {
  test(`Phase 6: ${state} is provider/system truth even against privileged human roles`, () => {
    assert.equal(canActorTransition(session, state, { id: 'admin-1', role: 'admin' }), false);
    assert.equal(canActorTransition(session, state, { id: 'reviewer-1', role: 'reviewer' }), false);
    assert.equal(canActorTransition(session, state, { id: 'buyer-1', role: 'buyer' }), false);
    assert.equal(canActorTransition(session, state, { id: 'webhook', role: 'webhook' }), true);
  });
}

test('Phase 6: release approval is human governance, not provider settlement proof', () => {
  assert.equal(canActorTransition(session, 'release_approved', { id: 'reviewer-1', role: 'reviewer' }), true);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'webhook', role: 'webhook' }), false);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'buyer-1', role: 'buyer' }), false);
});
