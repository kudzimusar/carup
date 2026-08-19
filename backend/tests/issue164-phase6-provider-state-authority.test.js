import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { canActorTransition } = await import('../services/escrow/escrowTrustService.js');

const session = { buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'initiated' };

for (const state of ['funds_held', 'settled', 'refunded', 'funded_sandbox', 'released_sandbox', 'refunded_sandbox']) {
  test(`Phase 6: ${state} is provider truth even against privileged/internal actors`, () => {
    assert.equal(canActorTransition(session, state, { id: 'admin-1', role: 'admin' }), false);
    assert.equal(canActorTransition(session, state, { id: 'reviewer-1', role: 'reviewer' }), false);
    assert.equal(canActorTransition(session, state, { id: 'buyer-1', role: 'buyer' }), false);
    assert.equal(canActorTransition(session, state, { id: 'system', role: 'system' }), false);
    assert.equal(canActorTransition(session, state, { id: 'provider', role: 'provider' }), true);
    assert.equal(canActorTransition(session, state, { id: 'webhook', role: 'webhook' }), true);
  });
}

test('Phase 6: release approval is CarUp governance and cannot be asserted by provider/webhook/system', () => {
  assert.equal(canActorTransition(session, 'release_approved', { id: 'reviewer-1', role: 'reviewer' }), true);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'admin-1', role: 'admin' }), true);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'webhook', role: 'webhook' }), false);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'provider', role: 'provider' }), false);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'system', role: 'system' }), false);
  assert.equal(canActorTransition(session, 'release_approved', { id: 'buyer-1', role: 'buyer' }), false);
});

test('Phase 6: provider/webhook cannot impersonate CarUp inspection/failure orchestration', () => {
  assert.equal(canActorTransition(session, 'inspection_pending', { id: 'provider', role: 'provider' }), false);
  assert.equal(canActorTransition(session, 'inspection_pending', { id: 'webhook', role: 'webhook' }), false);
  assert.equal(canActorTransition(session, 'inspection_pending', { id: 'system', role: 'system' }), true);
  assert.equal(canActorTransition(session, 'inspection_pending', { id: 'reviewer-1', role: 'reviewer' }), true);
  assert.equal(canActorTransition(session, 'failed', { id: 'provider', role: 'provider' }), false);
  assert.equal(canActorTransition(session, 'failed', { id: 'system', role: 'system' }), true);
});
