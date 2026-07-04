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

// ---------------------------------------------------------------------------------------------
// Forbidden final/non-initial states — clients must never mint payment history. Only trusted
// platform admins/reviewers (server-derived platformRole) may record a non-PENDING status.
// ---------------------------------------------------------------------------------------------

const platformAdmin = { id: 'admin-1', userId: 'admin-1', role: 'admin', platformRole: 'platform_admin', tenantId: null };

function acceptedQuoteRow(overrides = {}) {
  return {
    id: 'quote-1',
    import_order_id: 'order-1',
    tenant_id: 'tenant-1',
    quote_amount: 1000,
    quote_currency: 'USD',
    status: 'ACCEPTED',
    ...overrides,
  };
}

function milestoneRow(overrides = {}) {
  return {
    id: `m-seed-${Math.random().toString(36).slice(2, 8)}`,
    import_order_id: 'order-1',
    tenant_id: 'tenant-1',
    milestone_type: 'DEPOSIT',
    amount: 600,
    currency: 'USD',
    status: 'PENDING',
    ...overrides,
  };
}

test('a non-privileged caller cannot create a CONFIRMED milestone (403 MILESTONE_STATUS_FORBIDDEN)', async () => {
  const client = useClient();
  await assert.rejects(
    () => svc.addPaymentMilestone('order-1', { ...PAYLOAD, status: 'CONFIRMED' }, buyer),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'MILESTONE_STATUS_FORBIDDEN');
      assert.equal(err.details.requestedStatus, 'CONFIRMED');
      return true;
    },
  );
  assert.equal(client._rows('diaspora_payment_milestones').length, 0, 'nothing was inserted');
});

test('a non-privileged caller may still pass the explicit initial PENDING status', async () => {
  useClient();
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, status: 'PENDING' }, buyer);
  assert.equal(milestone.status, 'PENDING');
});

test('privileged callers (reviewer / platform admin) may create a CONFIRMED milestone, e.g. importing history', async () => {
  useClient();
  const byReviewer = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, status: 'CONFIRMED' }, reviewer);
  assert.equal(byReviewer.status, 'CONFIRMED');
  const byAdmin = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, status: 'CONFIRMED' }, platformAdmin);
  assert.equal(byAdmin.status, 'CONFIRMED');
});

// ---------------------------------------------------------------------------------------------
// Cumulative-amount / over-allocation guard — active (PENDING/CONFIRMED) milestones plus the new
// amount must not exceed the accepted quote (preferred) or the order budget. Applies to everyone.
// ---------------------------------------------------------------------------------------------

test('over-allocation against the ACCEPTED quote cap is rejected with cap/cumulative/existing details', async () => {
  const client = useClient({
    diaspora_import_quotes: [acceptedQuoteRow()],
    diaspora_payment_milestones: [milestoneRow({ amount: 600, status: 'PENDING' })],
  });
  await assert.rejects(
    () => svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 500 }, buyer),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'MILESTONE_OVER_ALLOCATION');
      assert.deepEqual(err.details, { cap: 1000, cumulative: 1100, existing: 600 });
      return true;
    },
  );
  assert.equal(client._rows('diaspora_payment_milestones').length, 1, 'only the seeded milestone remains');
});

test('a non-ACCEPTED quote does not set the cap (ISSUED quote alone means fall back to budget/no cap)', async () => {
  useClient({ diaspora_import_quotes: [acceptedQuoteRow({ status: 'ISSUED', quote_amount: 100 })] });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 5000 }, buyer);
  assert.equal(milestone.amount, 5000);
});

test('over-allocation against budget_amount when no accepted quote exists is rejected', async () => {
  useClient({
    diaspora_import_orders: [orderRow({ budget_amount: 1000, budget_currency: 'USD' })],
    diaspora_payment_milestones: [milestoneRow({ amount: 600, status: 'CONFIRMED' })],
  });
  await assert.rejects(
    () => svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 500 }, buyer),
    (err) => {
      assert.equal(err.code, 'MILESTONE_OVER_ALLOCATION');
      assert.deepEqual(err.details, { cap: 1000, cumulative: 1100, existing: 600 });
      return true;
    },
  );
});

test('an under-cap milestone is accepted', async () => {
  useClient({
    diaspora_import_quotes: [acceptedQuoteRow()],
    diaspora_payment_milestones: [milestoneRow({ amount: 400 })],
  });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 500 }, buyer);
  assert.equal(milestone.amount, 500);
});

test('a milestone exactly meeting the cap is accepted (cap is inclusive)', async () => {
  useClient({
    diaspora_import_quotes: [acceptedQuoteRow()],
    diaspora_payment_milestones: [milestoneRow({ amount: 400 })],
  });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 600 }, buyer);
  assert.equal(milestone.amount, 600);
});

test('with no accepted quote and no budget_amount there is no cap — any positive amount is accepted', async () => {
  useClient({ diaspora_payment_milestones: [milestoneRow({ amount: 123456 })] });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 999999 }, buyer);
  assert.equal(milestone.amount, 999999);
});

test('CANCELLED and WAIVED milestones do not count toward the cumulative total', async () => {
  useClient({
    diaspora_import_quotes: [acceptedQuoteRow()],
    diaspora_payment_milestones: [
      milestoneRow({ amount: 800, status: 'CANCELLED' }),
      milestoneRow({ amount: 900, status: 'WAIVED' }),
    ],
  });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 950 }, buyer);
  assert.equal(milestone.amount, 950);
});

test('a mixed-currency active milestone skips the cap check and records an allocation note (no conversion attempted)', async () => {
  useClient({
    diaspora_import_quotes: [acceptedQuoteRow()],
    diaspora_payment_milestones: [milestoneRow({ amount: 900, currency: 'EUR' })],
  });
  const milestone = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 900 }, buyer);
  assert.equal(milestone.amount, 900);
  assert.match(milestone.metadata.allocation_note, /MIXED_MILESTONE_CURRENCIES/);
});

test('idempotent replay returns the original milestone without re-running the cap check against itself', async () => {
  const client = useClient({ diaspora_import_quotes: [acceptedQuoteRow()] });
  const first = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 800, idempotency_key: 'cap-replay-1' }, buyer);
  // A re-run of the cap check would now see the first insert (existing 800 + 800 = 1600 > 1000)
  // and throw MILESTONE_OVER_ALLOCATION — the replay must short-circuit before that instead.
  const second = await svc.addPaymentMilestone('order-1', { ...PAYLOAD, amount: 800, idempotency_key: 'cap-replay-1' }, buyer);
  assert.equal(second.id, first.id);
  assert.equal(client._rows('diaspora_payment_milestones').length, 1);
});
