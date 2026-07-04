/**
 * Payment-milestone hardening tests — service-level, in-memory mock Supabase.
 *
 * A "payment milestone" is a non-custodial reference record (buyer/seller declaring an off-platform
 * payment step happened or is due) — CarUp never moves money here. Covers what this loop hardened:
 * authorization (only someone with access to the import order may add a milestone — previously ANY
 * authenticated user could add one to ANY order), validation (milestone_type/amount), idempotency
 * (retried submit with the same key does not duplicate), and notification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/diaspora/diasporaImportOrderService.js');

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const otherBuyer = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function orderRow(overrides = {}) {
  return {
    id: 'order-1',
    tenant_id: 'tenant-1',
    buyer_id: 'buyer-1',
    created_by: 'buyer-1',
    status: 'DOCUMENTS_VERIFIED',
    ...overrides,
  };
}

function useClient(seed = {}) {
  const client = createMockSupabase({
    diaspora_import_orders: [orderRow()],
    diaspora_import_order_participants: [],
    diaspora_payment_milestones: [],
    diaspora_import_audit_log: [],
    notification_queue: [],
    ...seed,
  });
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: client.from });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: client.rpc });
  return client;
}

const PAYLOAD = { milestone_type: 'DEPOSIT', amount: 500, currency: 'USD' };

test('the order owner can add a payment milestone to their own order', async () => {
  useClient();
  const milestone = await svc.addPaymentMilestone('order-1', PAYLOAD, buyer);
  assert.equal(milestone.milestone_type, 'DEPOSIT');
  assert.equal(milestone.amount, 500);
  assert.equal(milestone.status, 'PENDING');
});

test('a user with no access to the order cannot add a milestone to it (403)', async () => {
  useClient();
  await assert.rejects(() => svc.addPaymentMilestone('order-1', PAYLOAD, otherBuyer), /do not have access/i);
});

test('a reviewer can add a milestone to any order', async () => {
  useClient();
  const milestone = await svc.addPaymentMilestone('order-1', PAYLOAD, reviewer);
  assert.equal(milestone.milestone_type, 'DEPOSIT');
});

test('missing milestone_type/amount is rejected (400)', async () => {
  useClient();
  await assert.rejects(() => svc.addPaymentMilestone('order-1', { amount: 500 }, buyer), /milestone_type/i);
  await assert.rejects(() => svc.addPaymentMilestone('order-1', { milestone_type: 'DEPOSIT' }, buyer), /amount/i);
});

test('a non-positive amount is rejected (400)', async () => {
  useClient();
  await assert.rejects(() => svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 0 }, buyer), /positive/i);
  await assert.rejects(() => svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: -10 }, buyer), /positive/i);
});

test('an invalid milestone_type is rejected (400)', async () => {
  useClient();
  await assert.rejects(() => svc.addPaymentMilestone('order-1', { ...PAYLOAD, milestone_type: 'BITCOIN' }, buyer), /milestone_type/i);
});

test('retried submission with the same idempotency_key returns the original milestone, not a duplicate', async () => {
  const client = useClient();
  const first = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, idempotency_key: 'retry-key-1' }, buyer);
  const second = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, idempotency_key: 'retry-key-1' }, buyer);
  assert.equal(second.id, first.id);
  const rows = client._rows('diaspora_payment_milestones');
  assert.equal(rows.length, 1);
});

test('a different idempotency_key creates a distinct milestone', async () => {
  const client = useClient();
  await svc.addPaymentMilestone('order-1', { ...PAYLOAD, idempotency_key: 'key-a' }, buyer);
  await svc.addPaymentMilestone('order-1', { ...PAYLOAD, idempotency_key: 'key-b' }, buyer);
  const rows = client._rows('diaspora_payment_milestones');
  assert.equal(rows.length, 2);
});

test('a queued notification is created for the buyer on milestone creation', async () => {
  const client = useClient();
  await svc.addPaymentMilestone('order-1', PAYLOAD, buyer);
  const notifications = client._rows('notification_queue');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, 'buyer-1');
  assert.match(notifications[0].message, /reference record only/i);
});

test('missing import order returns 404', async () => {
  useClient();
  await assert.rejects(() => svc.addPaymentMilestone('order-zzz', PAYLOAD, buyer), /not found/i);
});
