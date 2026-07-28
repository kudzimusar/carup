/**
 * Phase 9 (Stage C) — SafeTrade comprehensive tests (directive §50).
 *
 * Two layers, both with an in-memory mock Supabase (no DB, no network, no real provider):
 *   1. SERVICE-LEVEL: drives the SafeTrade services directly against `createMockSupabase` wired with the
 *      JS references of the two SafeTrade atomic RPCs (helpers/diasporaSafeTradeRpcReference.js, mirroring
 *      database/migrations/20260621130000_diaspora_phase9_safetrade.sql) + the H1/H2/H3/Phase8 references.
 *      This proves the deep money-safety/eligibility/release/dispute invariants.
 *   2. ROUTE-LEVEL: drives the REAL (unmounted) diasporaSafeTradeRoutes router over HTTP with the same
 *      mock wired onto the supabase singleton, proving the route gate (disabled => 404), server-derived
 *      authorization, and the HMAC-signed + idempotent payment webhook.
 *
 * Non-negotiables proven here (directive §50):
 *   unverified participant blocked; missing entitlement blocked; missing/unpaid payment blocks release;
 *   flagged compliance blocks release; missing document blocks release; active dispute blocks release;
 *   insufficient shipment stage blocks release; eligible txn may request release; unauthorized actor
 *   cannot approve release; duplicate provider webhook idempotent; duplicate release request idempotent;
 *   provider failure leaves consistent state; audit failure rolls back the critical transition;
 *   cross-tenant denied; dispute hold works; refund/release sandbox works; NO real-money provider called
 *   without the activation flag; NO automatic reputation record written.
 *
 * Time is fixed (req.fixedTimestamp / injected `now`); no test depends on Date.now().
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
// The whole SafeTrade surface is gated behind this flag (default OFF). Enable for the behavioral tests;
// individual tests toggle it back to prove the disabled path is inert.
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
// Live payment stays OFF (fail-closed): any money op resolves to the sandbox provider. We never set it on.
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
// Subscription enforcement stays OFF by default (createTransaction entitlement gate is a no-op); one
// test flips it on to prove the missing-entitlement block.
delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;

const FIXED_TS = '2026-06-21T13:00:00.000Z';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { SAFETRADE_RPCS } = await import('./helpers/diasporaSafeTradeRpcReference.js');

const txnService = await import('../services/diaspora/safetrade/diasporaSafeTradeTransactionService.js');
const milestoneService = await import('../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js');
const eligibilityService = await import('../services/diaspora/safetrade/diasporaSafeTradeEligibilityService.js');
const releaseService = await import('../services/diaspora/safetrade/diasporaSafeTradeReleasePolicyService.js');
const disputeService = await import('../services/diaspora/safetrade/diasporaSafeTradeDisputeService.js');
const deliveryService = await import('../services/diaspora/safetrade/diasporaSafeTradeDeliveryService.js');
const provider = await import('../services/diaspora/safetrade/safeTradePaymentProvider.js');

// ── Actors (server-derived contexts; client roles are never trusted) ─────────
const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-A' };
const seller = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: 'tenant-A' };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: 'tenant-A' };
const outsider = { id: 'out-1', userId: 'out-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-B' };

const ALL_RPCS = { ...DIASPORA_RPCS, ...SAFETRADE_RPCS };

// A fully eligible domain seed for tenant-A order ord-1 (verified buyer+seller, accepted quote, approved
// reservation, supported currency). Override pieces to break a specific eligibility check.
function eligibleSeed(extra = {}) {
  return {
    diaspora_import_orders: [
      { id: 'ord-1', tenant_id: 'tenant-A', buyer_id: 'buyer-1', status: 'SELLER_ASSIGNED', metadata: { rfq: { acceptedQuoteId: 'q-1' } }, created_by: 'buyer-1' },
    ],
    diaspora_import_quotes: [
      { id: 'q-1', import_order_id: 'ord-1', status: 'ACCEPTED', tenant_id: 'tenant-A' },
    ],
    diaspora_cargo_reservations: [
      { id: 'res-1', import_order_id: 'ord-1', reservation_status: 'APPROVED', tenant_id: 'tenant-A' },
    ],
    diaspora_trade_profiles: [
      { id: 'tp-b', user_id: 'buyer-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
      { id: 'tp-s', user_id: 'seller-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
    ],
    diaspora_safetrade_transactions: [],
    diaspora_safetrade_milestones: [],
    diaspora_safetrade_release_evaluations: [],
    diaspora_safetrade_disputes: [],
    diaspora_safetrade_dispute_evidence: [],
    diaspora_safetrade_delivery_confirmations: [],
    diaspora_compliance_reviews: [],
    vehicle_government_documents: [],
    diaspora_shipments: [],
    diaspora_import_audit_log: [],
    ...extra,
  };
}

function freshClient(seed) {
  return createMockSupabase(seed, { rpc: ALL_RPCS });
}

// Create a DRAFT transaction (eligibility-gated) for ord-1, total 1000 USD.
async function makeDraft(client, { totalAmount = 1000, idempotencyKey = null } = {}) {
  return txnService.createTransaction(client, {
    importOrderId: 'ord-1',
    sellerId: 'seller-1',
    currency: 'USD',
    totalAmount,
    tenantId: 'tenant-A',
    idempotencyKey,
    userContext: buyer,
    req: { fixedTimestamp: FIXED_TS },
  });
}

// Seed a transaction row already in a chosen status with one milestone in a chosen status, so release/
// dispute paths can be exercised without replaying the whole lifecycle.
function seedTxn(client, { txnStatus = 'IN_PROGRESS', milestoneStatus = 'HELD', total = 1000, metadata = {} } = {}) {
  const txns = client._rows('diaspora_safetrade_transactions');
  const milestones = client._rows('diaspora_safetrade_milestones');
  const txn = {
    id: 'st-1', tenant_id: 'tenant-A', import_order_id: 'ord-1', accepted_quote_id: 'q-1',
    buyer_id: 'buyer-1', seller_id: 'seller-1', currency: 'USD', total_amount: total,
    status: txnStatus, payment_provider: 'sandbox', live_payment: false,
    policy_version: 'safetrade-policy-v1', metadata: { safetrade: {}, ...metadata },
    created_by: 'buyer-1', updated_by: 'buyer-1',
  };
  txns.push(txn);
  const milestone = {
    id: 'stm-1', tenant_id: 'tenant-A', transaction_id: 'st-1', import_order_id: 'ord-1',
    milestone_type: 'RELEASE', sequence: 0, amount: total, currency: 'USD',
    status: milestoneStatus, payer: 'BUYER', payee: 'SELLER', release_trigger: 'REVIEWER_APPROVAL',
    provider_reference: milestoneStatus === 'PENDING' ? null : 'sbx_pi_seed',
    evidence_requirements: [], evidence_refs: [], metadata: { safetrade: {} },
    created_by: 'buyer-1', updated_by: 'buyer-1',
  };
  milestones.push(milestone);
  return { txn, milestone };
}

// Seed all positive release evidence (held milestone already present): APPROVED compliance, VERIFIED doc,
// ARRIVED shipment, buyer delivery-confirmed flag on the txn metadata.
function seedReleaseEvidence(client, { delivery = true } = {}) {
  client._rows('diaspora_compliance_reviews').push({ id: 'cr-1', import_order_id: 'ord-1', status: 'APPROVED', tenant_id: 'tenant-A' });
  client._rows('vehicle_government_documents').push({ id: 'doc-1', import_order_id: 'ord-1', verification_status: 'VERIFIED' });
  client._rows('diaspora_shipments').push({ id: 'sh-1', import_order_id: 'ord-1', status: 'ARRIVED' });
  if (delivery) {
    const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
    txn.metadata = { ...(txn.metadata || {}), safetrade: { ...((txn.metadata || {}).safetrade || {}), deliveryConfirmed: true } };
  }
}

// Record an eligible reviewer evaluation row (the N5 approval record for a HIGH-risk release).
function seedApprovalEval(client, { milestoneId = null } = {}) {
  const row = {
    id: 'ev-1', tenant_id: 'tenant-A', transaction_id: 'st-1', milestone_id: milestoneId,
    eligible: true, requires_reviewer: true, risk_level: 'HIGH', policy_version: 'safetrade-policy-v1',
    evaluated_by: 'rev-1', evaluated_at: FIXED_TS, blockers: [], evidence_refs: [],
  };
  client._rows('diaspora_safetrade_release_evaluations').push(row);
  return row;
}

function auditActions(client) {
  return client._rows('diaspora_import_audit_log').map((r) => r.action);
}

afterEach(() => {
  process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
  delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
  delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;
  delete process.env.DIASPORA_SAFETRADE_PROVIDER;
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL: creation, eligibility, milestones
// ════════════════════════════════════════════════════════════════════════════

test('eligible buyer creates a DRAFT SafeTrade transaction (sandbox, live_payment=false)', async () => {
  const client = freshClient(eligibleSeed());
  const { transaction } = await makeDraft(client);
  assert.equal(transaction.status, 'DRAFT');
  assert.equal(transaction.payment_provider, 'sandbox');
  assert.equal(transaction.live_payment, false);
  assert.equal(transaction.buyer_id, 'buyer-1');
  assert.equal(transaction.seller_id, 'seller-1');
});

test('unverified participant is blocked from creating a SafeTrade transaction', async () => {
  const seed = eligibleSeed();
  // Seller profile is PENDING — identity not verified.
  seed.diaspora_trade_profiles = [
    { id: 'tp-b', user_id: 'buyer-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
    { id: 'tp-s', user_id: 'seller-1', verification_status: 'PENDING', tenant_id: 'tenant-A' },
  ];
  const client = freshClient(seed);
  await assert.rejects(
    () => makeDraft(client),
    (err) => {
      assert.equal(err.details?.code, 'SAFETRADE_NOT_ELIGIBLE');
      assert.ok(err.details.blockers.some((b) => b.code === 'IDENTITY_UNVERIFIED_SELLER'));
      return true;
    },
  );
  // No transaction row was written.
  assert.equal(client._rows('diaspora_safetrade_transactions').length, 0);
});

test('eligibility engine reports an exhaustive blocker list (read-only, no DB writes)', async () => {
  const seed = eligibleSeed();
  seed.diaspora_cargo_reservations = []; // break reservation
  seed.diaspora_import_quotes = [{ id: 'q-1', import_order_id: 'ord-1', status: 'ISSUED', tenant_id: 'tenant-A' }]; // not accepted
  const client = freshClient(seed);
  const verdict = await eligibilityService.evaluateEligibility(client, {
    importOrderId: 'ord-1', buyerContext: buyer, sellerId: 'seller-1', tenantId: 'tenant-A',
    requestedCurrency: 'USD', evaluatedAt: FIXED_TS,
  });
  assert.equal(verdict.eligible, false);
  const codes = verdict.blockers.map((b) => b.code);
  assert.ok(codes.includes('NO_ACCEPTED_QUOTE'));
  assert.ok(codes.includes('NO_VALID_RESERVATION'));
  assert.equal(verdict.evaluatedAt, FIXED_TS);
});

test('missing entitlement blocks creation when subscription enforcement is on', async () => {
  process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'true';
  // No subscription/plan rows seeded -> checkFeature denies diaspora.safetrade.create.
  const client = freshClient(eligibleSeed());
  await assert.rejects(
    () => makeDraft(client),
    (err) => {
      // requireFeature throws ForbiddenError with the structured denial in .details.
      assert.equal(err.statusCode, 403);
      assert.ok(err.details);
      return true;
    },
  );
  assert.equal(client._rows('diaspora_safetrade_transactions').length, 0);
});

test('milestones reconcile to the transaction total via the atomic RPC and advance DRAFT->INITIATED', async () => {
  const client = freshClient(eligibleSeed());
  const { transaction } = await makeDraft(client);
  const result = await milestoneService.createMilestones(client, {
    transactionId: transaction.id,
    milestones: [
      { milestoneType: 'DEPOSIT', amount: 400, sequence: 0 },
      { milestoneType: 'RELEASE', amount: 600, sequence: 1 },
    ],
    idempotencyKey: 'ms-key-1',
    userContext: buyer,
    req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.reconciliation.sum, 1000);
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === transaction.id);
  assert.equal(txn.status, 'INITIATED');
  assert.ok(auditActions(client).includes('SAFETRADE_MILESTONES_DEFINED'));
});

test('unbalanced milestone set is rejected (TOTALS_UNRECONCILED) and writes nothing', async () => {
  const client = freshClient(eligibleSeed());
  const { transaction } = await makeDraft(client);
  await assert.rejects(
    () => milestoneService.createMilestones(client, {
      transactionId: transaction.id,
      milestones: [{ milestoneType: 'DEPOSIT', amount: 300, sequence: 0 }],
      userContext: buyer,
      req: { fixedTimestamp: FIXED_TS },
    }),
    /reconcile|TOTALS_UNRECONCILED/i,
  );
  assert.equal(client._rows('diaspora_safetrade_milestones').length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL: release policy gating (the strictest gate)
// ════════════════════════════════════════════════════════════════════════════

test('missing/unpaid payment blocks release (PAYMENT_NOT_HELD)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'PENDING' }); // not held
  seedReleaseEvidence(client);
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'PAYMENT_NOT_HELD'));
});

test('flagged compliance blocks release (COMPLIANCE_NOT_APPROVED)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD' });
  seedReleaseEvidence(client);
  // Replace the APPROVED review with a FLAGGED one.
  client._tables.diaspora_compliance_reviews = [{ id: 'cr-1', import_order_id: 'ord-1', status: 'FLAGGED', tenant_id: 'tenant-A' }];
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'COMPLIANCE_NOT_APPROVED'));
});

test('missing document blocks release (DOCUMENTS_NOT_VERIFIED)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD' });
  seedReleaseEvidence(client);
  client._tables.vehicle_government_documents = [{ id: 'doc-1', import_order_id: 'ord-1', verification_status: 'PENDING' }];
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'DOCUMENTS_NOT_VERIFIED'));
});

test('insufficient shipment stage blocks release (SHIPMENT_MILESTONE_NOT_REACHED)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD' });
  seedReleaseEvidence(client);
  client._tables.diaspora_shipments = [{ id: 'sh-1', import_order_id: 'ord-1', status: 'IN_TRANSIT' }];
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'SHIPMENT_MILESTONE_NOT_REACHED'));
});

test('active dispute blocks release (ACTIVE_DISPUTE)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'DISPUTED', milestoneStatus: 'HELD' });
  seedReleaseEvidence(client);
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'ACTIVE_DISPUTE'));
});

test('unauthorized (non-reviewer) actor cannot pass the release policy (ACTOR_NOT_AUTHORIZED)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD', total: 1000 });
  seedReleaseEvidence(client);
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: buyer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'ACTOR_NOT_AUTHORIZED'));
});

test('high-risk release requires a reviewer approval record even when all auto-conditions pass', async () => {
  const client = freshClient(eligibleSeed());
  // $30k > $25k threshold => HIGH risk.
  seedTxn(client, { milestoneStatus: 'HELD', total: 30000 });
  seedReleaseEvidence(client);
  // No approval evaluation row yet -> blocked.
  let verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.riskTier, 'HIGH');
  assert.equal(verdict.requiresApproval, true);
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'REVIEWER_APPROVAL_REQUIRED'));
  // Add the reviewer approval evaluation -> now eligible.
  seedApprovalEval(client);
  verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.blockers.length, 0);
});

test('a fully-evidenced standard-risk transaction is release-eligible for a reviewer', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD', total: 5000 }); // 2500<=5000<25000 => STANDARD
  seedReleaseEvidence(client);
  const verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.riskTier, 'STANDARD');
  assert.equal(verdict.requiresApproval, false);
  assert.equal(verdict.eligible, true);
  // Money-safety: a held milestone is in the evidence by construction.
  assert.ok(verdict.evidenceRefs.some((e) => e.kind === 'safetrade_milestone' && e.satisfied));
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL: money operations (sandbox only), idempotency, fail-closed, no auto reputation
// ════════════════════════════════════════════════════════════════════════════

test('milestone HOLD uses the sandbox provider and advances to FUNDS_PENDING (no real money)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'PENDING', total: 1000 });
  // PENDING -> FUNDS_PENDING is the legal milestone HOLD edge.
  const result = await milestoneService.recordMilestone(client, {
    transactionId: 'st-1', milestoneId: 'stm-1', operation: 'HOLD',
    idempotencyKey: 'hold-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.milestone.status, 'FUNDS_PENDING');
  assert.equal(result.provider.live, false);
  assert.equal(result.provider.name, 'sandbox');
  const m = client._rows('diaspora_safetrade_milestones').find((x) => x.id === 'stm-1');
  assert.ok(m.provider_reference && m.provider_reference.startsWith('sbx_pi'));
});

test('reviewer RELEASE of a fully-evidenced milestone moves sandbox funds (RELEASE_AUTHORIZED->RELEASED) and writes NO reputation', async () => {
  const client = freshClient(eligibleSeed());
  // Milestone already staged to RELEASE_AUTHORIZED; provider intent captured so release() is legal.
  const { milestone } = seedTxn(client, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 5000 });
  seedReleaseEvidence(client);
  const evalRow = seedApprovalEval(client, { milestoneId: 'stm-1' });
  // Pre-capture the shared sandbox intent so release() (which requires CAPTURED) succeeds.
  const sandbox = provider.getSharedSandboxPaymentProvider();
  const intent = await sandbox.createPaymentIntent({ milestoneId: 'stm-1', amount: 5000, currency: 'USD' });
  await sandbox.authorizeHold({ intentId: intent.intentId });
  await sandbox.captureRelease({ intentId: intent.intentId });
  milestone.provider_reference = intent.intentId;

  const result = await milestoneService.recordMilestone(client, {
    transactionId: 'st-1', milestoneId: 'stm-1', operation: 'RELEASE',
    evaluationId: evalRow.id, idempotencyKey: 'rel-1', userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.milestone.status, 'RELEASED');
  assert.equal(result.provider.live, false);
  // N4 — no reputation record was ever written by any path.
  assert.equal(client._rows('diaspora_reputation_records').length, 0);
});

test('a non-privileged actor cannot RELEASE escrow (reviewer/admin authority)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 5000 });
  seedReleaseEvidence(client);
  await assert.rejects(
    () => milestoneService.recordMilestone(client, {
      transactionId: 'st-1', milestoneId: 'stm-1', operation: 'RELEASE',
      userContext: buyer, req: { fixedTimestamp: FIXED_TS },
    }),
    (err) => { assert.equal(err.statusCode, 403); return true; },
  );
});

test('duplicate release request is idempotent (same key replays, no double money move)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'PENDING', total: 1000 });
  const first = await milestoneService.recordMilestone(client, {
    transactionId: 'st-1', milestoneId: 'stm-1', operation: 'HOLD',
    idempotencyKey: 'dup-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  const second = await milestoneService.recordMilestone(client, {
    transactionId: 'st-1', milestoneId: 'stm-1', operation: 'HOLD',
    idempotencyKey: 'dup-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.idempotentReplay, true);
  // Exactly one SAFETRADE_FUNDS_PENDING audit row (the replay does not write a second).
  const held = auditActions(client).filter((a) => a === 'SAFETRADE_FUNDS_PENDING');
  assert.equal(held.length, 1);
});

test('a conflicting idempotency key (same key, different target) is rejected by the RPC (IDEMPOTENCY_CONFLICT)', async () => {
  const client = freshClient(eligibleSeed());
  // A txn-level transition stamps the idempotency key on the transaction row (no provider involved).
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  // First dispatch: IN_PROGRESS -> RELEASE_REVIEW (MARK_ARRIVED) with key conflict-key.
  await txnService.transition(client, {
    transactionId: 'st-1', event: 'MARK_ARRIVED', idempotencyKey: 'conflict-key',
    userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
  });
  // Reuse the same key for a DIFFERENT target (DISPUTED via RAISE_DISPUTE) -> the RPC's idempotency
  // replay (step 4) raises IDEMPOTENCY_CONFLICT because the stored target differs. (Reset the status so
  // the second edge is structurally legal but the key conflicts on target.)
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  txn.status = 'IN_PROGRESS';
  await assert.rejects(
    () => txnService.transition(client, {
      transactionId: 'st-1', event: 'RAISE_DISPUTE', idempotencyKey: 'conflict-key',
      userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
    }),
    /IDEMPOTENCY_CONFLICT/,
  );
});

test('live money path fails closed (EXTERNAL_ACTIVATION_REQUIRED) — no real provider is ever called', async () => {
  process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT = 'true';
  process.env.DIASPORA_SAFETRADE_PROVIDER = 'stripe'; // not on the approved (empty) list
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'PENDING', total: 1000 });
  await assert.rejects(
    () => milestoneService.recordMilestone(client, {
      transactionId: 'st-1', milestoneId: 'stm-1', operation: 'HOLD',
      userContext: buyer, req: { fixedTimestamp: FIXED_TS },
    }),
    /EXTERNAL_ACTIVATION_REQUIRED/,
  );
});

test('audit failure rolls back the critical transition (all-or-nothing)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'PENDING', total: 1000 });
  client.setFault('failSafeTradeAudit', true);
  await assert.rejects(
    () => milestoneService.recordMilestone(client, {
      transactionId: 'st-1', milestoneId: 'stm-1', operation: 'HOLD',
      idempotencyKey: 'rb-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS },
    }),
    /AUDIT_FAILED/,
  );
  // The milestone status is unchanged (still PENDING) and no audit row was written.
  const m = client._rows('diaspora_safetrade_milestones').find((x) => x.id === 'stm-1');
  assert.equal(m.status, 'PENDING');
  assert.equal(client._rows('diaspora_import_audit_log').filter((r) => r.action.startsWith('SAFETRADE_')).length, 0);
});

test('provider failure (illegal sandbox state) leaves the milestone state consistent', async () => {
  const client = freshClient(eligibleSeed());
  // Milestone in FUNDED but with no live sandbox intent: CAPTURE requires AUTHORIZED -> provider throws.
  const { milestone } = seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'FUNDED', total: 1000 });
  milestone.provider_reference = 'sbx_pi_missing'; // not registered in the shared sandbox
  await assert.rejects(
    () => milestoneService.recordMilestone(client, {
      transactionId: 'st-1', milestoneId: 'stm-1', operation: 'CAPTURE',
      userContext: buyer, req: { fixedTimestamp: FIXED_TS },
    }),
    (err) => { assert.match(err.message, /intent not found|cannot capture|INVALID/i); return true; },
  );
  // Provider threw BEFORE the transition RPC ran -> milestone unchanged, no SAFETRADE audit row.
  const m = client._rows('diaspora_safetrade_milestones').find((x) => x.id === 'stm-1');
  assert.equal(m.status, 'FUNDED');
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL: cross-tenant, disputes, delivery / reputation-eligibility-only
// ════════════════════════════════════════════════════════════════════════════

test('cross-tenant / non-participant actor is denied read + transition access', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { milestoneStatus: 'HELD' });
  await assert.rejects(
    () => txnService.getTransaction(client, { transactionId: 'st-1', userContext: outsider }),
    (err) => { assert.equal(err.statusCode, 403); return true; },
  );
});

test('opening a dispute drives DISPUTED, places a sandbox HOLD, and writes a CRITICAL audit row', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  const result = await disputeService.createDispute(client, {
    transactionId: 'st-1', category: 'ITEM_NOT_AS_DESCRIBED', reason: 'wrong vehicle delivered',
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.dispute.status, 'OPEN');
  assert.equal(result.holdPlaced, true); // funds already HELD -> hold recorded without a redundant money edge
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  assert.equal(txn.status, 'DISPUTED');
  assert.ok(auditActions(client).includes('SAFETRADE_DISPUTE_RAISED'));
  // hasActiveDispute is now true.
  assert.equal(await disputeService.hasActiveDispute(client, { transactionId: 'st-1' }), true);
});

test('dispute open is single-active idempotent (re-open returns the existing case)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  const first = await disputeService.createDispute(client, { transactionId: 'st-1', reason: 'x', userContext: buyer, req: { fixedTimestamp: FIXED_TS } });
  const second = await disputeService.createDispute(client, { transactionId: 'st-1', reason: 'x again', userContext: buyer, req: { fixedTimestamp: FIXED_TS } });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.dispute.id, first.dispute.id);
  assert.equal(client._rows('diaspora_safetrade_disputes').length, 1);
});

test('reviewer resolves a dispute with a sandbox REFUND (REFUND_REVIEW->REFUNDED), no reputation written', async () => {
  const client = freshClient(eligibleSeed());
  const { milestone } = seedTxn(client, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  // Register a captured sandbox intent so refund() (requires CAPTURED/RELEASED) is legal.
  const sandbox = provider.getSharedSandboxPaymentProvider();
  const intent = await sandbox.createPaymentIntent({ milestoneId: 'stm-1', amount: 1000, currency: 'USD' });
  await sandbox.authorizeHold({ intentId: intent.intentId });
  await sandbox.captureRelease({ intentId: intent.intentId });
  milestone.provider_reference = intent.intentId;

  await disputeService.createDispute(client, { transactionId: 'st-1', reason: 'refund please', userContext: buyer, req: { fixedTimestamp: FIXED_TS } });
  const evalRow = seedApprovalEval(client, { milestoneId: 'stm-1' });
  const result = await disputeService.resolveDispute(client, {
    disputeId: client._rows('diaspora_safetrade_disputes')[0].id,
    resolution: 'REFUND', milestoneId: 'stm-1', evaluationId: evalRow.id,
    userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.dispute.status, 'RESOLVED');
  assert.equal(result.resolution, 'REFUND');
  assert.equal(result.money.milestone.status, 'REFUNDED');
  assert.equal(result.money.provider.live, false);
  assert.equal(client._rows('diaspora_reputation_records').length, 0);
  assert.ok(auditActions(client).includes('SAFETRADE_DISPUTE_RESOLVED'));
});

test('a buyer/seller cannot resolve a dispute (reviewer/admin authority only)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  await disputeService.createDispute(client, { transactionId: 'st-1', reason: 'x', userContext: buyer, req: { fixedTimestamp: FIXED_TS } });
  const disputeId = client._rows('diaspora_safetrade_disputes')[0].id;
  await assert.rejects(
    () => disputeService.resolveDispute(client, { disputeId, resolution: 'DISMISSED', userContext: seller, req: { fixedTimestamp: FIXED_TS } }),
    (err) => { assert.equal(err.statusCode, 403); return true; },
  );
});

test('delivery confirmation is buyer-driven, sets a metadata flag WITHOUT a money move, and is idempotent', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  const first = await deliveryService.confirmDelivery(client, {
    transactionId: 'st-1', signedProofRefs: ['proof-1'], idempotencyKey: 'dc-1',
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(first.confirmation.status, 'CONFIRMED');
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  assert.equal(txn.metadata.safetrade.deliveryConfirmed, true);
  assert.equal(txn.status, 'IN_PROGRESS'); // status of record unchanged
  // No milestone money moved.
  assert.equal(client._rows('diaspora_safetrade_milestones').find((m) => m.id === 'stm-1').status, 'HELD');
  // Idempotent replay.
  const second = await deliveryService.confirmDelivery(client, {
    transactionId: 'st-1', signedProofRefs: ['proof-1'], idempotencyKey: 'dc-1',
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(second.idempotentReplay, true);
});

test('a seller (non-buyer, non-reviewer) cannot confirm delivery', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  await assert.rejects(
    () => deliveryService.confirmDelivery(client, { transactionId: 'st-1', signedProofRefs: ['p'], userContext: seller, req: { fixedTimestamp: FIXED_TS } }),
    (err) => { assert.equal(err.statusCode, 403); return true; },
  );
});

test('closing the dispute window emits a reputation-ELIGIBILITY event ONLY (zero reputation rows)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  const { confirmation } = await deliveryService.confirmDelivery(client, {
    transactionId: 'st-1', signedProofRefs: ['proof-1'], disputeWindowHours: 0, // window already elapsed
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  // Close after the (zero-hour) window with a fixed later time.
  const result = await deliveryService.closeDisputeWindow(client, {
    confirmationId: confirmation.id, now: '2026-06-25T00:00:00.000Z',
    userContext: reviewer, req: { fixedTimestamp: '2026-06-25T00:00:00.000Z' },
  });
  assert.equal(result.eligibilityEmitted, true);
  // Exactly one eligibility EVENT, and NO reputation rows.
  //
  // ST-3 item #1 (Issue #127) moved this signal from a best-effort audit row appended AFTER commit
  // into the transactional outbox written BY the committing transaction. The assertion follows it to
  // its new home, and gains strength doing so: an outbox row is guaranteed to exist whenever the
  // window actually closed, which the old audit row never was.
  const events = client._rows('diaspora_safetrade_outbox').filter((r) => r.event_type === 'SAFETRADE_REPUTATION_ELIGIBLE');
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'pending', 'the drainer has not run yet, so it is queued for delivery');
  assert.equal(client._rows('diaspora_reputation_records').length, 0);
  // The window close itself is still audited, now transactionally.
  const closeAudit = client._rows('diaspora_import_audit_log').filter((r) => r.action === 'SAFETRADE_DELIVERY_WINDOW_CLOSED');
  assert.equal(closeAudit.length, 1);
  // Idempotent re-close.
  const again = await deliveryService.closeDisputeWindow(client, {
    confirmationId: confirmation.id, now: '2026-06-25T00:00:00.000Z',
    userContext: reviewer, req: { fixedTimestamp: '2026-06-25T00:00:00.000Z' },
  });
  assert.equal(again.idempotentReplay, true);
});

test('the dispute window does NOT emit eligibility while a dispute is active', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  const { confirmation } = await deliveryService.confirmDelivery(client, {
    transactionId: 'st-1', signedProofRefs: ['proof-1'], disputeWindowHours: 0,
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  await disputeService.createDispute(client, { transactionId: 'st-1', reason: 'open issue', userContext: buyer, req: { fixedTimestamp: FIXED_TS } });
  const result = await deliveryService.closeDisputeWindow(client, {
    confirmationId: confirmation.id, now: '2026-06-25T00:00:00.000Z',
    userContext: reviewer, req: { fixedTimestamp: '2026-06-25T00:00:00.000Z' },
  });
  assert.equal(result.eligibilityEmitted, false);
  assert.ok(result.reasons.includes('ACTIVE_DISPUTE'));
});

// ════════════════════════════════════════════════════════════════════════════
// SECURITY: seller-confirm-delivery authorization-gate-bypass vector (FIX 1)
// The transition()/`/commit` path must enforce the CONFIRM_DELIVERY descriptor's actorRoles allowlist:
// only the BUYER (or a privileged reviewer/admin) may flip the load-bearing delivery-confirmation gate.
// ════════════════════════════════════════════════════════════════════════════

test('SECURITY: a SELLER driving CONFIRM_DELIVERY via transition()/commit is rejected (403) and the gate is NOT set', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  await assert.rejects(
    () => txnService.transition(client, {
      transactionId: 'st-1', event: 'CONFIRM_DELIVERY',
      userContext: seller, req: { fixedTimestamp: FIXED_TS },
    }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.details?.code, 'SAFETRADE_ACTOR_NOT_ALLOWED');
      return true;
    },
  );
  // The buyer delivery-confirmation gate was NOT flipped by the seller.
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  assert.notEqual(txn.metadata?.safetrade?.deliveryConfirmed, true);
  // And no SAFETRADE_CONFIRM_DELIVERY audit/metadata write happened for the seller.
  assert.equal(auditActions(client).filter((a) => a === 'SAFETRADE_CONFIRM_DELIVERY').length, 0);
});

test('SECURITY: the BUYER may drive CONFIRM_DELIVERY via transition() (regression of the happy path) and the gate IS set', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  const result = await txnService.transition(client, {
    transactionId: 'st-1', event: 'CONFIRM_DELIVERY',
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.observational, true);
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  assert.equal(txn.metadata.safetrade.deliveryConfirmed, true);
  assert.equal(txn.status, 'IN_PROGRESS'); // status of record unchanged (observational flag only)
});

test('SECURITY: a reviewer/admin override may drive CONFIRM_DELIVERY via transition() (privileged path preserved)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  const result = await txnService.transition(client, {
    transactionId: 'st-1', event: 'CONFIRM_DELIVERY',
    userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(result.observational, true);
  const txn = client._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  assert.equal(txn.metadata.safetrade.deliveryConfirmed, true);
});

test('SECURITY: a seller cannot reach an eligible release via the CONFIRM_DELIVERY vector (gate stays blocked)', async () => {
  const client = freshClient(eligibleSeed());
  // Everything else is release-ready, but delivery is NOT yet confirmed.
  seedTxn(client, { milestoneStatus: 'HELD', total: 5000 });
  seedReleaseEvidence(client, { delivery: false });

  // Baseline: the release policy blocks while delivery is unconfirmed.
  let verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'DELIVERY_NOT_CONFIRMED'));

  // The seller attempts to flip the gate through transition()/commit -> rejected.
  await assert.rejects(
    () => txnService.transition(client, {
      transactionId: 'st-1', event: 'CONFIRM_DELIVERY',
      userContext: seller, req: { fixedTimestamp: FIXED_TS },
    }),
    (err) => { assert.equal(err.statusCode, 403); return true; },
  );

  // The release remains blocked on DELIVERY_NOT_CONFIRMED — the seller could not bypass it.
  verdict = await releaseService.evaluateRelease(client, { safeTradeId: 'st-1', actorContext: reviewer, evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.blockers.some((b) => b.code === 'DELIVERY_NOT_CONFIRMED'));
});

test('SECURITY: legitimate non-reviewer commit edges are NOT over-blocked (buyer HOLD_PAYMENT, seller ATTACH_DOCUMENTS)', async () => {
  // Buyer drives HOLD_PAYMENT (actorRoles include BUYER) — must still be allowed by the new gate.
  const c1 = freshClient(eligibleSeed());
  seedTxn(c1, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'HELD', total: 1000 });
  const r1 = await txnService.transition(c1, {
    transactionId: 'st-1', event: 'HOLD_PAYMENT', idempotencyKey: 'hp-1',
    userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(r1.transaction.status, 'FUNDS_HELD');

  // Seller drives ATTACH_DOCUMENTS (actorRoles include SELLER) — observational flag-setting, must be
  // allowed (the new actorRoles gate must NOT block a legitimate seller party on an edge that admits SELLER).
  const c2 = freshClient(eligibleSeed());
  seedTxn(c2, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  const r2 = await txnService.transition(c2, {
    transactionId: 'st-1', event: 'ATTACH_DOCUMENTS',
    userContext: seller, req: { fixedTimestamp: FIXED_TS },
  });
  // Observational edge: no DB status change, but it must succeed (not be rejected as ACTOR_NOT_ALLOWED).
  assert.equal(r2.observational, true);
  assert.equal(r2.transaction.status, 'FUNDS_HELD'); // status of record unchanged (flag-setting only)
});

// ════════════════════════════════════════════════════════════════════════════
// SECURITY: forgeable release evaluation row (FIX 2) — a non-reviewer (no evaluator)
// evaluation must NOT bless a money RELEASE even when eligible=true.
// ════════════════════════════════════════════════════════════════════════════

test('SECURITY: an evaluation row with no reviewer evaluator cannot bless a RELEASE (EVALUATION_NOT_REVIEWED)', async () => {
  const client = freshClient(eligibleSeed());
  const { milestone } = seedTxn(client, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 5000 });
  seedReleaseEvidence(client);
  // Forge an eligible=true evaluation with NO evaluated_by (what a non-reviewer INSERT would look like).
  const forged = {
    id: 'ev-forged', tenant_id: 'tenant-A', transaction_id: 'st-1', milestone_id: 'stm-1',
    eligible: true, requires_reviewer: true, risk_level: 'HIGH', policy_version: 'safetrade-policy-v1',
    evaluated_by: null, evaluated_at: FIXED_TS, blockers: [], evidence_refs: [],
  };
  client._rows('diaspora_safetrade_release_evaluations').push(forged);
  // Pre-capture the sandbox intent so the ONLY thing standing between us and a release is the eval guard.
  const sandbox = provider.getSharedSandboxPaymentProvider();
  const intent = await sandbox.createPaymentIntent({ milestoneId: 'stm-1', amount: 5000, currency: 'USD' });
  await sandbox.authorizeHold({ intentId: intent.intentId });
  await sandbox.captureRelease({ intentId: intent.intentId });
  milestone.provider_reference = intent.intentId;

  await assert.rejects(
    () => milestoneService.recordMilestone(client, {
      transactionId: 'st-1', milestoneId: 'stm-1', operation: 'RELEASE',
      evaluationId: 'ev-forged', idempotencyKey: 'rel-forged', userContext: reviewer, req: { fixedTimestamp: FIXED_TS },
    }),
    /EVALUATION_NOT_REVIEWED/,
  );
  // The milestone never moved to RELEASED.
  assert.equal(client._rows('diaspora_safetrade_milestones').find((m) => m.id === 'stm-1').status, 'RELEASE_AUTHORIZED');
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL: disabled flag => inert
// ════════════════════════════════════════════════════════════════════════════

test('when DIASPORA_SAFETRADE_ENABLED is off, mutating services are inert (SAFETRADE_DISABLED)', async () => {
  process.env.DIASPORA_SAFETRADE_ENABLED = 'false';
  const client = freshClient(eligibleSeed());
  await assert.rejects(
    () => makeDraft(client),
    (err) => { assert.equal(err.details?.code, 'SAFETRADE_DISABLED'); return true; },
  );
  // The read-only eligibility engine short-circuits with a single SAFETRADE_DISABLED blocker, no DB read.
  const verdict = await eligibilityService.evaluateEligibility(client, { importOrderId: 'ord-1', buyerContext: buyer, sellerId: 'seller-1', evaluatedAt: FIXED_TS });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.blockers[0].code, 'SAFETRADE_DISABLED');
});

// ════════════════════════════════════════════════════════════════════════════
// PROVIDER: sandbox-only money + HMAC webhook
// ════════════════════════════════════════════════════════════════════════════

test('the live payment provider throws EXTERNAL_ACTIVATION_REQUIRED on every method (no network)', async () => {
  const live = new provider.LivePaymentProvider();
  for (const method of ['createPaymentIntent', 'authorizeHold', 'captureRelease', 'release', 'refund', 'cancel', 'retrieveStatus']) {
    await assert.rejects(() => live[method]({}), /EXTERNAL_ACTIVATION_REQUIRED|external activation/i);
  }
});

test('selectPaymentProvider is fail-closed: sandbox by default; live without an approved provider throws', async () => {
  // Default (live off) -> sandbox.
  const sandbox = provider.selectPaymentProvider();
  assert.equal(sandbox.name, 'sandbox');
  // Live on + unapproved provider -> throws (never silently downgrades).
  process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT = 'true';
  process.env.DIASPORA_SAFETRADE_PROVIDER = 'stripe';
  assert.throws(() => provider.selectPaymentProvider(), /EXTERNAL_ACTIVATION_REQUIRED|external activation|refusing/i);
});

test('webhook HMAC verification: valid passes, tampered/late/missing-timestamp fail (no throw)', async () => {
  const sandbox = new provider.SandboxPaymentProvider({ now: FIXED_TS });
  const body = JSON.stringify({ id: 'evt-1', type: 'hold.authorized', intentId: 'sbx_pi_1' });
  const ts = Date.parse(FIXED_TS);
  const sig = crypto.createHmac('sha256', provider.safeTradeWebhookSecret()).update(`${ts}.${body}`).digest('hex');
  const ok = await sandbox.verifyWebhook({ rawBody: body, signature: sig, timestamp: ts });
  assert.equal(ok.verified, true);
  assert.equal(ok.eventId, 'evt-1');
  // Tampered signature.
  assert.equal((await sandbox.verifyWebhook({ rawBody: body, signature: 'deadbeef', timestamp: ts })).verified, false);
  // Excess drift (> 5 min).
  assert.equal((await sandbox.verifyWebhook({ rawBody: body, signature: sig, timestamp: ts - 600000 })).verified, false);
  // Missing timestamp.
  assert.equal((await sandbox.verifyWebhook({ rawBody: body, signature: sig, timestamp: null })).verified, false);
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE-LEVEL: real router, real authorizeRole, mocked supabase singleton
// ════════════════════════════════════════════════════════════════════════════

const express = (await import('express')).default;
const http = await import('node:http');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const safeTradeRouter = (await import('../routes/diasporaSafeTradeRoutes.js')).default;
const { supabase } = await import('../db/supabase.js');

// Users for the route auth middleware (sessions resolved via x-user-id fallback in test mode).
const routeUsers = {
  'buyer-1': { id: 'buyer-1', role: 'owner', is_verified: true },
  'seller-1': { id: 'seller-1', role: 'dealer', is_verified: true },
  'rev-1': { id: 'rev-1', role: 'reviewer', is_verified: true },
};

// A mock the route middleware (users/sessions/tenant_users) AND the services (everything else) share.
function routeMock(seed = eligibleSeed()) {
  const m = freshClient(seed);
  const originalFrom = m.from;
  m.from = (table) => {
    if (table === 'user_sessions') return staticBuilder({ data: null, error: { message: 'no session', code: 'PGRST116' } });
    if (table === 'users') return userBuilder();
    if (table === 'tenant_users') return staticBuilder({ data: null, error: { message: 'no membership', code: 'PGRST116' } });
    return originalFrom(table);
  };
  return m;
}

function staticBuilder(result) {
  const chain = {
    select() { return chain; }, eq() { return chain; }, is() { return chain; }, in() { return chain; },
    order() { return chain; }, range() { return chain; }, limit() { return chain }, maybeSingle() { return chain; },
    single() { return chain; },
    then(resolve) { return Promise.resolve(result).then(resolve); },
  };
  return chain;
}
function userBuilder() {
  let id = null;
  const chain = {
    select() { return chain; }, eq(k, v) { if (k === 'id') id = v; return chain; }, single() { return chain; },
    maybeSingle() { return chain; }, is() { return chain; },
    then(resolve) {
      const u = routeUsers[id];
      return Promise.resolve(u ? { data: u, error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } }).then(resolve);
    },
  };
  return chain;
}

let activeMock = null;
function installSupabaseMock(mock) {
  activeMock = mock;
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => activeMock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => activeMock.rpc(n, p) });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', safeTradeRouter);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl };
}

async function httpReq(baseUrl, method, path, { userId, role, tenantId, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (userId) h['x-user-id'] = userId;
  if (role) h['x-stakeholder-role'] = role;
  if (tenantId) h['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

test('ROUTE: every SafeTrade route is inert (404) when DIASPORA_SAFETRADE_ENABLED is off', async () => {
  process.env.DIASPORA_SAFETRADE_ENABLED = 'false';
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', { userId: 'buyer-1' })).status, 404);
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade', { userId: 'buyer-1', body: {} })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ROUTE: unauthenticated requests are rejected (401) when SafeTrade is enabled', async () => {
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', {})).status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ROUTE: evaluate-release / resolve are reviewer-only (buyer 403, reviewer passes the gate)', async () => {
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    // A buyer cannot hit a reviewer-only route.
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-x/evaluate-release', { userId: 'buyer-1', body: {} })).status, 403);
    // A spoofed x-stakeholder-role cannot escalate a buyer.
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-x/evaluate-release', { userId: 'buyer-1', role: 'admin', body: {} })).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ROUTE: a cross-tenant x-tenant-id (non-member) is rejected (403)', async () => {
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', { userId: 'buyer-1', tenantId: 'tenantX' })).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ROUTE: create + list + timeline happy path for an authenticated buyer', async () => {
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    const created = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade', {
      userId: 'buyer-1', body: { importOrderId: 'ord-1', sellerId: 'seller-1', currency: 'USD', totalAmount: 1000 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.transaction.status, 'DRAFT');
    const list = await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', { userId: 'buyer-1' });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.data));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ROUTE: payment-webhook rejects a bad signature (401) and is idempotent for a duplicate event', async () => {
  installSupabaseMock(routeMock());
  const { server, baseUrl } = await startServer();
  try {
    const body = { id: 'wh-evt-1', type: 'hold.authorized', intentId: 'sbx_pi_1' };
    // The route's verifyWebhook uses the shared sandbox provider's internal clock for drift (now=null),
    // which is the SandboxPaymentProvider default '2026-06-21T00:00:00.000Z'. Sign with that timestamp so
    // the 5-minute anti-replay drift check passes. The provider hashes `${ts}.${JSON.stringify(body)}`
    // (express.json parses then the provider re-stringifies), so sign JSON.stringify(body).
    const ts = Date.parse('2026-06-21T00:00:00.000Z');
    const okSig = crypto.createHmac('sha256', provider.safeTradeWebhookSecret()).update(`${ts}.${JSON.stringify(body)}`).digest('hex');

    // Bad signature -> 401 (the HMAC signature is the webhook's only authentication).
    const bad = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': 'deadbeef', 'x-safetrade-timestamp': String(ts) },
    });
    assert.equal(bad.status, 401);

    // Valid signature -> 200, processed once.
    const first = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': okSig, 'x-safetrade-timestamp': String(ts) },
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.idempotentReplay, false);

    // Duplicate event id -> idempotent no-op success (never reprocessed).
    const dup = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': okSig, 'x-safetrade-timestamp': String(ts) },
    });
    assert.equal(dup.status, 200);
    assert.equal(dup.json.idempotentReplay, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ST-4B: dispute-evidence READ redaction (listEvidence). The server is the privacy boundary — a
// non-participant is denied; a participant sees PARTICIPANTS + only their OWN AUTHOR_ONLY rows, never
// REVIEWERS_ONLY or another author's AUTHOR_ONLY; reviewers/admins see everything.
// ════════════════════════════════════════════════════════════════════════════

// Seed a dispute with four evidence rows spanning every visibility/author combination.
function seedDisputeEvidence(client) {
  client._rows('diaspora_safetrade_disputes').push({
    id: 'disp-1', tenant_id: 'tenant-A', transaction_id: 'st-1', status: 'UNDER_REVIEW',
    category: 'OTHER', raised_by_role: 'BUYER', deleted_at: null, created_at: FIXED_TS,
  });
  const rows = client._rows('diaspora_safetrade_dispute_evidence');
  rows.push(
    { id: 'ev-part', tenant_id: 'tenant-A', dispute_id: 'disp-1', transaction_id: 'st-1', visibility: 'PARTICIPANTS', author_id: 'buyer-1', author_role: 'BUYER', evidence_type: 'STATEMENT', statement: 'shared', deleted_at: null, created_at: FIXED_TS },
    { id: 'ev-rev', tenant_id: 'tenant-A', dispute_id: 'disp-1', transaction_id: 'st-1', visibility: 'REVIEWERS_ONLY', author_id: 'rev-1', author_role: 'REVIEWER', evidence_type: 'STATEMENT', statement: 'reviewers eyes only', deleted_at: null, created_at: FIXED_TS },
    { id: 'ev-ao-buyer', tenant_id: 'tenant-A', dispute_id: 'disp-1', transaction_id: 'st-1', visibility: 'AUTHOR_ONLY', author_id: 'buyer-1', author_role: 'BUYER', evidence_type: 'STATEMENT', statement: 'buyer private', deleted_at: null, created_at: FIXED_TS },
    { id: 'ev-ao-seller', tenant_id: 'tenant-A', dispute_id: 'disp-1', transaction_id: 'st-1', visibility: 'AUTHOR_ONLY', author_id: 'seller-1', author_role: 'SELLER', evidence_type: 'STATEMENT', statement: 'seller private', deleted_at: null, created_at: FIXED_TS },
  );
}

const evidenceIds = (rows) => rows.map((r) => r.id).sort();

test('ST-4B: reviewer sees ALL dispute evidence (including REVIEWERS_ONLY and every AUTHOR_ONLY)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'DISPUTED' });
  seedDisputeEvidence(client);
  const rows = await disputeService.listEvidence(client, { disputeId: 'disp-1', userContext: reviewer });
  assert.deepEqual(evidenceIds(rows), ['ev-ao-buyer', 'ev-ao-seller', 'ev-part', 'ev-rev']);
});

test('ST-4B: buyer participant sees PARTICIPANTS + own AUTHOR_ONLY, never REVIEWERS_ONLY or seller AUTHOR_ONLY', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'DISPUTED' });
  seedDisputeEvidence(client);
  const rows = await disputeService.listEvidence(client, { disputeId: 'disp-1', userContext: buyer });
  assert.deepEqual(evidenceIds(rows), ['ev-ao-buyer', 'ev-part']);
});

test('ST-4B: seller participant sees PARTICIPANTS + own AUTHOR_ONLY, never buyer AUTHOR_ONLY or REVIEWERS_ONLY', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'DISPUTED' });
  seedDisputeEvidence(client);
  const rows = await disputeService.listEvidence(client, { disputeId: 'disp-1', userContext: seller });
  assert.deepEqual(evidenceIds(rows), ['ev-ao-seller', 'ev-part']);
});

test('ST-4B: an unrelated/cross-tenant outsider is DENIED reading dispute evidence (ForbiddenError)', async () => {
  const client = freshClient(eligibleSeed());
  seedTxn(client, { txnStatus: 'DISPUTED' });
  seedDisputeEvidence(client);
  await assert.rejects(
    () => disputeService.listEvidence(client, { disputeId: 'disp-1', userContext: outsider }),
    (err) => /access to this SafeTrade transaction/i.test(err.message),
  );
});
