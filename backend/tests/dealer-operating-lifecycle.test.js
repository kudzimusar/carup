// CARUP-DEALER-ONB-001-LR01-R4 P0-3 (C12): governed lifecycle service. Fictional values; injected
// collaborators plus a wiring check of the real routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OPERATING_LIFECYCLE_ACTIONS,
  parseLifecycleDecision,
  mapLifecycleSqlError,
  recordOperatingLifecycleDecision,
  readOperatingLifecycle,
} from '../services/dealer/dealerOperatingLifecycleService.js';

const reason = 'Fictional CI lifecycle decision with a reason long enough to be recorded permanently.';
const link = { link_id: 'link-1', seed_dealer_id: 'ZW-DEAL-0001', claimant_user_id: 'fictional-owner',
  operating_status: 'ACTIVE', legal_review_id: 'legal-1' };
function fakeDb({ rpcResult, rpcError = null, events = [] } = {}) {
  const calls = { rpc: [] };
  return {
    calls,
    from(table) {
      const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; },
        async limit() { return { data: events, error: null }; },
        async maybeSingle() { return { data: table === 'dealer_approved_seed_links' ? link : null, error: null }; } };
      return chain;
    },
    async rpc(name, args) { calls.rpc.push([name, args]); return { data: rpcResult, error: rpcError }; },
  };
}
const reviewer = { userId: 'fictional-reviewer', role: 'reviewer' };
const independent = (actor, claimant) => { if (actor.userId === claimant) throw Object.assign(new Error('INDEPENDENT_REVIEWER_REQUIRED'), { statusCode: 403 }); };

test('the action vocabulary is exactly the C12 decisions (no approve/publish/pay)', () => {
  assert.deepEqual([...OPERATING_LIFECYCLE_ACTIONS].sort(),
    ['CLOSE_INVESTIGATION', 'OPEN_INVESTIGATION', 'REINSTATE', 'RENEW', 'SUSPEND', 'WITHDRAW']);
});

test('decision parse refuses unknown actions, short reasons and a renewal without a legal review id', () => {
  assert.throws(() => parseLifecycleDecision({ action: 'PUBLISH', reason }), /INVALID_OPERATING_LIFECYCLE_ACTION/);
  assert.throws(() => parseLifecycleDecision({ action: 'SUSPEND', reason: 'too short' }), /OPERATING_LIFECYCLE_REASON_REQUIRED/);
  assert.throws(() => parseLifecycleDecision({ action: 'RENEW', reason }), /NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED/);
  assert.equal(parseLifecycleDecision({ action: 'suspend', reason }).action, 'SUSPEND');
  assert.equal(parseLifecycleDecision({ action: 'SUSPEND', reason, new_legal_review_id: 'x' }).new_legal_review_id, null);
});

test('SQL refusals map to 403/404/409; unknown failures are 503', () => {
  assert.equal(mapLifecycleSqlError({ message: 'REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER' }).statusCode, 403);
  assert.equal(mapLifecycleSqlError({ message: 'INDEPENDENT_LIFECYCLE_REVIEWER_REQUIRED' }).statusCode, 403);
  assert.equal(mapLifecycleSqlError({ message: 'APPROVED_DEALER_LINK_REQUIRED' }).statusCode, 404);
  assert.equal(mapLifecycleSqlError({ message: 'ONLY_SUSPENDED_DEALER_CAN_BE_REINSTATED' }).statusCode, 409);
  assert.equal(mapLifecycleSqlError({ message: 'socket hang up' }).statusCode, 503);
});

test('a decision requires an independent reviewer and password step-up BEFORE the SQL function runs', async () => {
  const db = fakeDb({ rpcResult: { seed_dealer_id: 'ZW-DEAL-0001', action: 'SUSPEND', listings_republished: false,
    payment_entitlement_changed: false, operating_status: 'SUSPENDED' } });
  const order = [];
  const receipt = await recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer, { action: 'SUSPEND', reason, reviewer_password: 'pw' }, {
    db, independent: (a, c) => { order.push('independent:' + c); independent(a, c); },
    stepUp: async (_a, claim, password) => { order.push('stepUp:' + password); assert.equal(claim.claimant_user_id, 'fictional-owner'); },
  });
  assert.deepEqual(order, ['independent:', 'independent:fictional-owner', 'stepUp:pw']);
  assert.equal(db.calls.rpc[0][0], 'dealer_record_operating_lifecycle_decision');
  assert.equal(db.calls.rpc[0][1].p_reviewer_id, 'fictional-reviewer');
  assert.equal(receipt.operating_status, 'SUSPENDED');
});

test('the claimant can never decide its own lifecycle, and a failed step-up never reaches SQL', async () => {
  const db = fakeDb({ rpcResult: {} });
  await assert.rejects(recordOperatingLifecycleDecision('ZW-DEAL-0001', { userId: 'fictional-owner' },
    { action: 'SUSPEND', reason, reviewer_password: 'pw' }, { db, independent, stepUp: async () => {} }), /INDEPENDENT_REVIEWER_REQUIRED/);
  await assert.rejects(recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer,
    { action: 'SUSPEND', reason, reviewer_password: 'wrong' }, { db, independent,
      stepUp: async () => { throw Object.assign(new Error('REVIEWER_PASSWORD_REQUIRED'), { statusCode: 401 }); } }), /REVIEWER_PASSWORD_REQUIRED/);
  assert.equal(db.calls.rpc.length, 0);
});

test('a readback claiming republication or a payment change is refused', async () => {
  for (const lie of [{ listings_republished: true, payment_entitlement_changed: false },
    { listings_republished: false, payment_entitlement_changed: true }]) {
    const db = fakeDb({ rpcResult: { seed_dealer_id: 'ZW-DEAL-0001', action: 'REINSTATE', ...lie } });
    await assert.rejects(recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer,
      { action: 'REINSTATE', reason, reviewer_password: 'pw' }, { db, independent, stepUp: async () => {} }),
    /DEALER_OPERATING_LIFECYCLE_READBACK_FAILED/);
  }
});

test('history never discloses other reviewers’ identities', async () => {
  const db = fakeDb({ events: [{ event_id: 'e1', action: 'SUSPEND', previous_operating_status: 'ACTIVE',
    next_operating_status: 'SUSPENDED', public_listings_withdrawn: 1, created_at: '2026-11-06T00:00:00Z',
    reviewer_user_id: 'someone-else' }] });
  const history = await readOperatingLifecycle('ZW-DEAL-0001', reviewer, { db, independent });
  assert.equal(history.events[0].recorded_by_this_reviewer, false);
  assert.ok(!JSON.stringify(history).includes('someone-else'));
});

test('wiring: reviewer routes call the real service behind the write limiter', () => {
  const routes = readFileSync(new URL('../routes/dealerResearchRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /router\.post\('\/api\/admin\/dealership\/operating-lifecycle\/:seedId',\s*reviewWriteLimit,reviewer,/);
  assert.match(routes, /recordOperatingLifecycleDecision\(req\.params\.seedId,req\.userContext,req\.body\|\|\{\}\)/);
  assert.match(routes, /router\.get\('\/api\/admin\/dealership\/operating-lifecycle\/:seedId',\s*reviewer,/);
});

// R6 E — the workbench has its OWN queue of activated dealerships and offers RENEW
// targets from recorded newer legal reviews instead of a pasted raw identifier.
const { listOperatingLifecycleCases } = await import('../services/dealer/dealerOperatingLifecycleService.js');
function richDb({ links = [], legal = {}, newer = [] } = {}) {
  return {
    from(table) {
      const chain = { _filters: [],
        select() { return chain; }, eq(k, v) { chain._filters.push([k, v]); return chain; },
        gt() { return chain; }, order() { return chain; },
        async limit() {
          if (table === 'dealer_approved_seed_links') return { data: links, error: null };
          if (table === 'dealer_legal_application_reviews') return { data: newer, error: null };
          return { data: [], error: null };
        },
        async maybeSingle() {
          if (table === 'dealer_approved_seed_links') return { data: link, error: null };
          if (table === 'dealer_legal_application_reviews') return { data: legal, error: null };
          return { data: null, error: null };
        } };
      return chain;
    },
  };
}

test('R6 E queue lists every activated dealership with status, never the reviewer\'s own claim', async () => {
  const cases = await listOperatingLifecycleCases(reviewer, { independent, db: richDb({ links: [
    { seed_dealer_id: 'ZW-DEAL-0001', operating_status: 'ACTIVE', activated_at: 't1', claimant_user_id: 'fictional-owner' },
    { seed_dealer_id: 'ZW-DEAL-0002', operating_status: 'SUSPENDED', activated_at: 't2', claimant_user_id: 'fictional-reviewer' },
    { seed_dealer_id: 'not-a-seed', operating_status: 'ACTIVE', activated_at: 't3', claimant_user_id: 'x' },
  ] }) });
  assert.deepEqual(cases.map((c) => [c.seed_dealer_id, c.operating_status]), [['ZW-DEAL-0001', 'ACTIVE']]);
  assert.equal('claimant_user_id' in cases[0], false, 'no claimant identity leaks into the queue');
});

test('R6 E the dealership\'s own claimant cannot read its lifecycle as a reviewer', async () => {
  await assert.rejects(readOperatingLifecycle('ZW-DEAL-0001', { userId: 'fictional-owner' },
    { independent, db: richDb() }), /INDEPENDENT_REVIEWER_REQUIRED/);
});

test('R6 E renewal candidates are newer unexpired reviews of the same claimant only', async () => {
  const id = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
  const lifecycle = await readOperatingLifecycle('ZW-DEAL-0001', reviewer, { independent, db: richDb({
    legal: { created_at: '2026-11-01T00:00:00Z' },
    newer: [
      { legal_review_id: id, created_at: '2026-11-05T00:00:00Z', legal_expires_at: '2027-11-05T00:00:00Z',
        approved_scope: 'BRANCH', claimant_user_id: 'fictional-owner' },
      { legal_review_id: 'not-a-uuid', created_at: '2026-11-06T00:00:00Z', legal_expires_at: '2027-11-06T00:00:00Z',
        approved_scope: 'BRANCH', claimant_user_id: 'fictional-owner' },
      { legal_review_id: id.replace('3f', '4f'), created_at: '2026-11-06T00:00:00Z', legal_expires_at: '2027-11-06T00:00:00Z',
        approved_scope: 'BRANCH', claimant_user_id: 'someone-else' },
    ] }) });
  assert.deepEqual(lifecycle.renewal_candidates.map((c) => c.legal_review_id), [id]);
  assert.equal('claimant_user_id' in lifecycle.renewal_candidates[0], false);
});

test('R6 E the workbench reads its own queue and offers RENEW as a choice, not a pasted id', () => {
  const page = readFileSync(new URL('../../web/src/pages/DealerOperatingLifecycleReview.tsx', import.meta.url), 'utf8');
  assert.match(page, /path:'\/admin\/dealership\/operating-lifecycle',/);
  assert.doesNotMatch(page, /full-storefronts\/queue/);
  assert.match(page, /<select id="lifecycle-legal-review"/);
  const routes = readFileSync(new URL('../routes/dealerResearchRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /router\.get\('\/api\/admin\/dealership\/operating-lifecycle',\s*\n\s*reviewer,/);
});

// R6 closure (security): a reviewer who is a member of, or holds a claim on, the dealership can
// neither read its lifecycle (incl. recorded reasons) nor see it in the queue.
function conflictDb({ memberships = [], claims = [] } = {}) {
  return {
    from(table) {
      const chain = { select() { return chain; }, eq() { return chain; }, gt() { return chain; }, order() { return chain; },
        async limit() {
          if (table === 'tenant_users') return { data: memberships, error: null };
          if (table === 'dealer_research_claim_requests') return { data: claims, error: null };
          if (table === 'dealer_approved_seed_links') return { data: [
            { seed_dealer_id: 'ZW-DEAL-0001', tenant_id: 'tenant-1', operating_status: 'SUSPENDED', activated_at: 't1', claimant_user_id: 'fictional-owner' },
            { seed_dealer_id: 'ZW-DEAL-0002', tenant_id: 'tenant-2', operating_status: 'ACTIVE', activated_at: 't2', claimant_user_id: 'other-owner' },
          ], error: null };
          return { data: [{ event_id: 'e1', action: 'SUSPEND', previous_operating_status: 'ACTIVE',
            next_operating_status: 'SUSPENDED', public_listings_withdrawn: 1, created_at: 't', reviewer_user_id: 'x',
            reason: 'Confidential investigation reason' }], error: null };
        },
        async maybeSingle() {
          if (table === 'dealer_approved_seed_links') return { data: { ...link, tenant_id: 'tenant-1' }, error: null };
          return { data: null, error: null };
        } };
      return chain;
    },
  };
}
test('R6 a reviewer who is staff of the dealership cannot read its lifecycle reasons', async () => {
  await assert.rejects(readOperatingLifecycle('ZW-DEAL-0001', reviewer, { independent,
    db: conflictDb({ memberships: [{ tenant_id: 'tenant-1' }] }) }), (e) => e.statusCode === 403 && e.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
  await assert.rejects(readOperatingLifecycle('ZW-DEAL-0001', reviewer, { independent,
    db: conflictDb({ claims: [{ seed_dealer_id: 'ZW-DEAL-0001' }] }) }), /DEALER_REVIEWER_CONFLICT_OF_INTEREST/);
  const clean = await readOperatingLifecycle('ZW-DEAL-0001', reviewer, { independent, db: conflictDb() });
  assert.equal(clean.events[0].reason, 'Confidential investigation reason', 'an unconflicted reviewer sees the reason');
});
test('R6 a conflicted reviewer\'s queue omits the dealerships they belong to or claim', async () => {
  const cases = await listOperatingLifecycleCases(reviewer, { independent,
    db: conflictDb({ memberships: [{ tenant_id: 'tenant-1' }], claims: [{ seed_dealer_id: 'ZW-DEAL-0002' }] }) });
  assert.deepEqual(cases, []);
  const all = await listOperatingLifecycleCases(reviewer, { independent, db: conflictDb() });
  assert.deepEqual(all.map((c) => c.seed_dealer_id), ['ZW-DEAL-0001', 'ZW-DEAL-0002']);
});
