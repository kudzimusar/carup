/**
 * R6 closure — final independent security verification of a31697ff reproduced three more private
 * READS a conflicted reviewer (a rival claimant, or staff of the dealership) could still reach:
 * buyer complaint cases (buyer identity + private statement), source correction requests (contact
 * e-mail + private summary, incl. takedowns about the reviewer's own dealership) and full-storefront
 * candidates (private branch addresses + declared terms). Each is now refused (403, before any
 * step-up attempt) or filtered out of its queue; an unconflicted reviewer is unaffected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { supabase } = await import('../db/supabase.js');
const feedback = await import('../services/dealer/dealerBuyerFeedbackService.js');
const research = await import('../services/dealer/dealerResearchService.js');
const storefront = await import('../services/dealer/dealerFullStorefrontService.js');

const reviewer = { userId: 'conflicted-reviewer', authenticationMethod: 'session', isVerified: true, platformRole: 'reviewer' };
const CASE = '9b81dc5f-fc2f-4a18-9365-2c3770cff501';
const rows = (data) => {
  const b = { select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; },
    limit: async () => ({ data, error: null }), maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }) };
  return b;
};
// The reviewer's conflicts: a claim on ZW-DEAL-0001, or staff of tenant t-1 linked to ZW-DEAL-0001.
const conflictTables = (mode) => ({
  dealer_research_claim_requests: mode === 'claim' ? [{ seed_dealer_id: 'ZW-DEAL-0001' }] : [],
  tenant_users: mode === 'staff' ? [{ tenant_id: 't-1' }] : [],
  links_for_tenants: mode === 'staff' ? [{ seed_dealer_id: 'ZW-DEAL-0001' }] : [],
});

for (const mode of ['claim', 'staff']) {
  test(`R6 closure (${mode}): a conflicted reviewer never opens the buyer complaint and never sees it queued`, async () => {
    const c = conflictTables(mode);
    const rpc = [];
    const db = {
      from(table) {
        if (table === 'dealer_transaction_feedback_cases') {
          const one = { case_id: CASE, seed_dealer_id: 'ZW-DEAL-0001', buyer_user_id: 'buyer-1', statement: 'PRIVATE BUYER STATEMENT' };
          const b = rows([{ case_id: CASE, seed_dealer_id: 'ZW-DEAL-0001', case_type: 'BUYER_COMPLAINT', submitted_at: 't' },
            { case_id: 'other', seed_dealer_id: 'ZW-DEAL-0002', case_type: 'BUYER_COMPLAINT', submitted_at: 't' }]);
          b.maybeSingle = async () => ({ data: one, error: null });
          return b;
        }
        if (table === 'dealer_transaction_feedback_review_events') return rows([]);
        if (table === 'dealer_approved_seed_links') {
          const b = rows(c.links_for_tenants);
          b.maybeSingle = async () => ({ data: { claimant_user_id: 'owner-1' }, error: null });
          return b;
        }
        if (table === 'dealer_research_claim_requests') return rows(c.dealer_research_claim_requests);
        if (table === 'tenant_users') return rows(c.tenant_users);
        throw Error('UNEXPECTED_TABLE ' + table);
      },
      async rpc(name) { rpc.push(name); return { data: { allowed: true }, error: null }; },
    };
    await assert.rejects(feedback.previewPrivateBuyerCase(reviewer, CASE, 'correct-horse-battery', { db }),
      (e) => e.statusCode === 403 && e.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
    assert.deepEqual(rpc, [], 'refused before any step-up attempt is spent');
    const queue = await feedback.listPrivateBuyerCaseReviewQueue(reviewer, { db });
    assert.deepEqual(queue.map((q) => q.seed_dealer_id), ['ZW-DEAL-0002'], 'the conflicted dealership is not queued');
  });
}

test('R6 closure: correction requests about a business the reviewer claims or works for are never listed', async () => {
  const old = supabase.from;
  try {
    for (const mode of ['claim', 'staff', 'none']) {
      const c = conflictTables(mode);
      supabase.from = (table) => {
        if (table === 'dealer_research_correction_requests') return rows([
          { request_id: 'r1', seed_dealer_id: 'ZW-DEAL-0001', contact_email: 'private@example.invalid', request_summary: 'takedown' },
          { request_id: 'r2', seed_dealer_id: 'ZW-DEAL-0002', contact_email: 'other@example.invalid', request_summary: 'fix' }]);
        if (table === 'dealer_research_claim_requests') return rows(c.dealer_research_claim_requests);
        if (table === 'tenant_users') return rows(c.tenant_users);
        if (table === 'dealer_approved_seed_links') return rows(c.links_for_tenants);
        throw Error('UNEXPECTED_TABLE ' + table);
      };
      const list = await research.listResearchCorrectionsForReviewer(reviewer);
      assert.deepEqual(list.map((r) => r.request_id), mode === 'none' ? ['r1', 'r2'] : ['r2'], mode);
      if (mode !== 'none') assert.equal(JSON.stringify(list).includes('private@example.invalid'), false);
    }
  } finally { supabase.from = old; }
});

test('R6 closure: a conflicted reviewer never previews a storefront candidate and never sees it queued', async () => {
  const old = supabase.from; const oldRpc = supabase.rpc; const rpc = [];
  supabase.rpc = async (name) => { rpc.push(name); return { data: { allowed: true }, error: null }; };
  try {
    for (const mode of ['claim', 'staff']) {
      const c = conflictTables(mode);
      supabase.from = (table) => {
        if (table === 'dealer_approved_seed_links') {
          const b = rows(mode === 'staff' && true ? c.links_for_tenants : []);
          // queue read (order+limit) vs candidate read (maybeSingle) vs tenant-link lookup (in+limit)
          let isQueue = false, isTenantLookup = false;
          b.order = () => { isQueue = true; return b; };
          b.in = () => { isTenantLookup = true; return b; };
          b.limit = async () => ({ data: isQueue ? [{ seed_dealer_id: 'ZW-DEAL-0001', link_id: 'l1', operating_status: 'ACTIVE',
            claimant_user_id: 'owner-1', activated_at: 't' }, { seed_dealer_id: 'ZW-DEAL-0002', link_id: 'l2', operating_status: 'ACTIVE',
            claimant_user_id: 'owner-2', activated_at: 't' }] : isTenantLookup ? c.links_for_tenants : [], error: null });
          b.maybeSingle = async () => ({ data: { link_id: 'l1', claimant_user_id: 'owner-1', dealer_profile_id: 'p1',
            tenant_id: 't-1', operating_status: 'ACTIVE' }, error: null });
          return b;
        }
        if (table === 'dealer_research_claim_requests') return rows(c.dealer_research_claim_requests);
        if (table === 'tenant_users') return rows(c.tenant_users);
        throw Error('UNEXPECTED_TABLE ' + table);
      };
      await assert.rejects(storefront.previewFullStorefrontCandidate('ZW-DEAL-0001', reviewer, 'correct-horse-battery'),
        (e) => e.statusCode === 403 && e.code === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST', mode);
      const queue = await storefront.listFullStorefrontReviewQueue(reviewer);
      assert.deepEqual(queue.map((q) => q.seed_dealer_id), ['ZW-DEAL-0002'], mode);
    }
    assert.deepEqual(rpc, [], 'refused before any step-up attempt is spent');
  } finally { supabase.from = old; supabase.rpc = oldRpc; }
});
