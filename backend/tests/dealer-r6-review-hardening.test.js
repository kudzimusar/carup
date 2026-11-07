/**
 * CARUP-DEALER-ONB-001-LR01-R6 round 2 — service-layer regressions for the independent security review of
 * b2da0a74 (reproductions turned into permanent tests; each failed before the fix):
 *   #5  legacy PATCH /api/admin/dealers/:id/decision bypassed the per-reviewer step-up lockout
 *       (revsec legacy_stepup_probe.mjs: 20 wrong passwords then the right one was accepted);
 *   #7c legacy governance decisions / #6 legacy branch + document writes on ACTIVATED profiles;
 *   #7  buyer-case finding and lifecycle CLOSE_INVESTIGATION refusals surface as clear 403s;
 *   #2  every public research read goes through the read-time gated view, never the raw table.
 * The SQL halves are proven in database/test/dealer_1_0_pglite_check.mjs (PGlite + native PG17).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { installStepUpGuardModel } from './helpers/dealerStepUpGuardModel.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dealer-local-fake';

const { supabase } = await import('../db/supabase.js');
installStepUpGuardModel(supabase);
const { hashPassword } = await import('../utils/passwordAuth.js');
const compliance = await import('../services/dealer/dealerComplianceService.js');
const feedback = await import('../services/dealer/dealerBuyerFeedbackService.js');
const lifecycle = await import('../services/dealer/dealerOperatingLifecycleService.js');
const research = await import('../services/dealer/dealerResearchService.js');
const mapper = await import('../services/dealer/dealerSqlRefusalMapper.js');

const PASSWORD = 'R6-Round2-Fictional-Reviewer-Password!';
const HASH = await hashPassword(PASSWORD);
const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

function fakeDb({ linked = false, reviewerId = 'rev-legacy', rpc = null } = {}) {
  const calls = { from: [], rpc: [], inserts: [] };
  const rows = {
    dealer_profiles: { id: PROFILE_ID, user_id: 'claimant-1', identity_status: 'verified' },
    users: { id: reviewerId, role: 'reviewer', is_verified: true, password_hash: HASH },
    dealer_approved_seed_links: linked ? { link_id: 'link-1' } : null,
  };
  return {
    calls,
    from(table) {
      calls.from.push(table);
      const q = {
        select() { return q; }, eq() { return q; },
        insert(row) { calls.inserts.push([table, row]); return q; },
        async single() { return { data: { id: crypto.randomUUID(), ...(calls.inserts.at(-1)?.[1] || {}) }, error: null }; },
        async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
      };
      return q;
    },
    async rpc(name, args) {
      calls.rpc.push(name);
      if (rpc) return rpc(name, args);
      return { data: { audit_atomic: true, decision: { id: 'd1', decision: args.p_decision }, profile: rows.dealer_profiles }, error: null };
    },
  };
}
function install(db) {
  const old = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = db.from.bind(db);
  supabase.rpc = db.rpc.bind(db);
  return () => { supabase.from = old.from; supabase.rpc = old.rpc; };
}
const legacyActor = (pw) => ({ id: 'rev-legacy', role: 'reviewer', authenticationMethod: 'session', isVerified: true, reviewer_password: pw });
const decision = { decision: 'request_more_info', requirement_key: 'company_registration', reason: 'x'.repeat(45) };

test('#5 legacy governance decision route enforces the per-reviewer step-up lockout (revsec legacy_stepup_probe)', async () => {
  const db = fakeDb();
  const restore = install(db);
  try {
    const out = [];
    for (let i = 0; i < 20; i += 1) {
      try { await compliance.recordDecision(PROFILE_ID, decision, legacyActor('guess-' + i + '-wrong')); out.push('accepted'); }
      catch (e) { out.push(e.statusCode + ':' + (e.code || e.message)); }
    }
    assert.deepEqual(out.slice(0, 5), Array(5).fill('403:Independent reviewer reauthentication failed'));
    assert.ok(out.slice(5).every((x) => x === '429:REVIEWER_STEP_UP_LOCKED'), out.slice(5).join(','));
    await assert.rejects(compliance.recordDecision(PROFILE_ID, decision, legacyActor(PASSWORD)),
      (e) => e.statusCode === 429 && e.code === 'REVIEWER_STEP_UP_LOCKED' && e.retryAfterSeconds === 900,
      'the correct password after the lock is still refused until the lock expires');
    assert.equal(db.calls.rpc.filter((n) => n === 'dealer_record_atomic_compliance_decision').length, 0,
      'no governance decision reached the database');
  } finally { restore(); }
});

test('#5 legacy decision route: a correct step-up still records the decision and resets the counter', async () => {
  const db = fakeDb();
  const restore = install(db);
  try {
    for (let i = 0; i < 4; i += 1) {
      await assert.rejects(compliance.recordDecision(PROFILE_ID, decision, legacyActor('wrong-password-' + i)), (e) => e.statusCode === 403);
    }
    const ok = await compliance.recordDecision(PROFILE_ID, decision, legacyActor(PASSWORD));
    assert.equal(ok.decision.decision, 'request_more_info');
    for (let i = 0; i < 10; i += 1) await compliance.recordDecision(PROFILE_ID, decision, legacyActor(PASSWORD));
    assert.equal(db.calls.rpc.filter((n) => n === 'dealer_record_atomic_compliance_decision').length, 11);
  } finally { restore(); }
});

test('#7c legacy decisions on an ACTIVATED dealership are refused (409) before step-up and by the database', async () => {
  const db = fakeDb({ linked: true });
  const restore = install(db);
  try {
    for (const d of ['set_expiry', 'suspend', 'reinstate', 'restrict']) {
      await assert.rejects(compliance.recordDecision(PROFILE_ID,
        { decision: d, reason: 'x'.repeat(45), payload: { expiry_date: '2099-01-01T00:00:00Z' } }, legacyActor(PASSWORD)),
        (e) => e.statusCode === 409 && e.code === 'ACTIVATED_DEALER_PROFILE_LEGACY_ROUTE_REFUSED');
    }
    assert.deepEqual(db.calls.rpc, [], 'neither a step-up attempt nor a decision RPC is consumed');
  } finally { restore(); }
  // Data-layer refusal (e.g. a link created concurrently) maps to the same clear 409.
  const raced = fakeDb({ rpc: (name) => (name === 'dealer_record_atomic_compliance_decision'
    ? { data: null, error: { message: 'ACTIVATED_DEALER_GOVERNED_BY_OPERATING_LIFECYCLE' } } : null) });
  const restore2 = install(raced);
  try {
    await assert.rejects(compliance.recordDecision(PROFILE_ID, decision, legacyActor(PASSWORD)),
      (e) => e.statusCode === 409 && e.code === 'ACTIVATED_DEALER_GOVERNED_BY_OPERATING_LIFECYCLE');
  } finally { restore2(); }
  assert.equal(mapper.mapDealerSqlRefusal({ message: 'ACTIVATED_DEALER_GOVERNED_BY_OPERATING_LIFECYCLE' }).statusCode, 409);
});

test('#6 legacy branch and document writes on an ACTIVATED profile are refused with the profile-route 409', async () => {
  const db = fakeDb({ linked: true });
  const restore = install(db);
  try {
    await assert.rejects(compliance.addBranch(PROFILE_ID, { name: 'Unreviewed branch', address: 'Anywhere' }),
      (e) => e.statusCode === 409 && e.message === 'Activated dealership profiles are edited through the dealership workspace');
    await assert.rejects(compliance.uploadDocument(PROFILE_ID, { doc_type: 'company_registration' }),
      (e) => e.statusCode === 409 && e.message === 'Activated dealership profiles are edited through the dealership workspace');
    await assert.rejects(compliance.createOrUpdateProfile('claimant-1', { trading_name: 'Renamed' }), (e) => e.statusCode === 409);
    assert.deepEqual(db.calls.inserts, [], 'nothing was written');
  } finally { restore(); }
  // A non-activated legacy profile keeps working.
  const plain = fakeDb();
  const restore2 = install(plain);
  try {
    await compliance.addBranch(PROFILE_ID, { name: 'Legacy branch', address: 'Harare' });
    await compliance.uploadDocument(PROFILE_ID, { doc_type: 'company_registration' });
    assert.deepEqual(plain.calls.inserts.map(([t]) => t), ['dealer_branches', 'dealer_compliance_documents']);
  } finally { restore2(); }
});

test('#7 a conflicted buyer-case finding and a same-reviewer CLOSE_INVESTIGATION surface as 403', async () => {
  const caseId = crypto.randomUUID();
  const reviewer = { userId: 'rev-legacy', authenticationMethod: 'session', isVerified: true, platformRole: 'reviewer' };
  const db = {
    from(table) {
      const data = table === 'dealer_transaction_feedback_cases'
        ? { case_id: caseId, seed_dealer_id: 'ZW-DEAL-0001', buyer_user_id: 'buyer-1' }
        : { claimant_user_id: 'owner-1' };
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data, error: null }; } };
    },
    async rpc() { return { data: null, error: { message: 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' } }; },
  };
  const restore = install(fakeDb());
  try {
    await assert.rejects(feedback.recordPrivateBuyerCaseFinding(reviewer, caseId, {
      reviewer_password: PASSWORD, finding: 'NOT_ELIGIBLE_FOR_PUBLIC_REVIEW',
      reason: 'R6 round 2 probe: a reviewer employed by the dealership under complaint must not dispose of the buyer case.',
    }, { db }), (e) => e.statusCode === 403 && e.message === 'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
  } finally { restore(); }
  assert.equal(lifecycle.mapLifecycleSqlError({ message: 'CLOSE_INVESTIGATION_REQUIRES_DIFFERENT_REVIEWER' }).statusCode, 403);
  assert.equal(lifecycle.mapLifecycleSqlError({ message: 'CLOSE_INVESTIGATION_REQUIRES_DIFFERENT_REVIEWER' }).code,
    'CLOSE_INVESTIGATION_REQUIRES_DIFFERENT_REVIEWER');
});

test('#2 every public research read uses the read-time gated view, never the raw publication table', async () => {
  const tables = [];
  const old = supabase.from;
  try {
    supabase.from = (table) => {
      tables.push(table);
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, ilike() { return q; }, order() { return q; },
        async range() { return { data: [], error: null, count: 0 }; },
        async maybeSingle() { return { data: null, error: null }; },
        then(f, r) { return Promise.resolve({ data: [], error: null }).then(f, r); },
      };
      return q;
    };
    assert.equal(await research.getPublicResearch('ZW-DEAL-0042'), null);
    await research.listPublicResearch({});
    assert.equal(await research.getReviewedPublicResearchContacts('ZW-DEAL-0042'), null);
  } finally { supabase.from = old; }
  assert.equal(research.PUBLIC_PROFILE_SOURCE, 'dealer_research_public_profiles_current');
  assert.ok(tables.includes('dealer_research_public_profiles_current'));
  assert.ok(!tables.includes('dealer_research_public_profiles'), 'raw table read on a public path: ' + tables.join(','));
});
