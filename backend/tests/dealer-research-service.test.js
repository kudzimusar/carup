/**
 * CARUP-DEALER-ONB-001 S04–S13 — exact-safe research projection/claim contracts.
 * Unit tests here do not assert real source eligibility, full claim review, or DB custody.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { supabase } = await import('../db/supabase.js');
const service = await import('../services/dealer/dealerResearchService.js');

const rawPrivate = {
  seed_dealer_id: 'ZW-DEAL-0001',
  public_slug: 'zw-deal-0001',
  public_name: 'Test Dealer (research, not certified)',
  public_city: 'Harare',
  public_research_category: 'Vehicle sales (research category)',
  source_attribution: 'Research source',
  reviewed_at: '2026-11-03T00:00:00Z',
  revision: 1,
  publication_status: 'PRELISTED_UNCLAIMED',
  source_snapshot: {
    'Phone / WhatsApp': '+263 000 000 000',
    'Email': 'private@example.invalid',
    'Ownership / Parent Company / Key Principal': 'PRIVATE_OWNER',
    'Website / Source URL': 'https://private.example.invalid',
    tax_id: 'ZIMRA-SECRET',
  },
  reviewer_id: 'SECRET_PERSON',
  review_reason: 'Private source review',
};

test('S04 public projection excludes private source and reviewer data and cannot invent verification', () => {
  const publicValue = service.publicResearchProjection(rawPrivate);
  assert.equal(publicValue.business_verified, false);
  assert.equal(publicValue.claimed, false);
  assert.equal(publicValue.slug, 'zw-deal-0001');
  const data = JSON.stringify(publicValue);
  for (const sensitive of ['source_snapshot', 'private@example.invalid', 'PRIVATE_OWNER',
    '+263 000', 'ZIMRA-SECRET', 'SECRET_PERSON', 'review_reason', 'reviewer_id']) {
    assert.ok(!data.includes(sensitive), sensitive);
  }
  assert.match(publicValue.label, /Not independently business-verified/);
});

test('S06 withheld, disputed and suppressed source rows never project', () => {
  for (const publication_status of ['WITHHELD','SUPPRESSED','DUPLICATE','UNDER_DISPUTE','NOT_PUBLISHED']) {
    assert.equal(service.publicResearchProjection({ ...rawPrivate, publication_status }), null);
  }
  assert.equal(service.publicResearchProjection(null), null);
});

test('S01 invalid or fabricated seed identifiers refused', () => {
  for (const bad of ['', 'ZW-DEAL-0105.extra', 'ZW-DEAL-104', 'ZW-DEAL-0001; DROP TABLE']) {
    assert.throws(() => service.normalizeSeedId(bad), /Invalid research seed reference/);
  }
  assert.equal(service.normalizeSeedId('ZW-DEAL-0001'), 'ZW-DEAL-0001');
});

test('S10 unauthenticated, fallback asserted or unverified reviewer cannot publish', async () => {
  for (const actor of [
    null,
    { userId:'a', authenticationMethod:'x-user-id-fallback', isVerified:true, platformRole:'admin' },
    { userId:'a', authenticationMethod:'session', isVerified:false, platformRole:'admin' },
    { userId:'a', authenticationMethod:'session', isVerified:true, platformRole:'dealer' },
  ]) {
    await assert.rejects(
      service.reviewResearchSeed('ZW-DEAL-0001', actor, {
        decision: 'PRELISTED_UNCLAIMED',
        reason:'Verified public-information eligibility with independent sources.',
      }),
      /Independent session-verified reviewer required/,
    );
  }
});

test('S10 publication requires recorded documented reason and approved disposition', async () => {
  const actor = { userId:'reviewer-1', authenticationMethod:'session', isVerified:true, platformRole:'reviewer' };
  await assert.rejects(service.reviewResearchSeed('ZW-DEAL-0001',actor,{
    decision:'VERIFIED_OEM', reason:'Appropriate public business and source checks documented',
  }),/Unsupported research-publication/);
  await assert.rejects(service.reviewResearchSeed('ZW-DEAL-0001',actor,{
    decision:'PRELISTED_UNCLAIMED', reason:'ok',
  }),/documented source/);
});

test('S11 unverified claimant, forged roles or incomplete ownership proof cannot gain access', async () => {
  const actor = { userId:'claimant',authenticationMethod:'session',platformRole:'member' };
  for (const payload of [
    {claimed_scope:'BUSINESS_ADMIN', representative_relationship:'LEGAL_OWNER', asserted_legal_business_name:'Acme Test',claim_statement:'I declare I represent this business as named'},
    {claimed_scope:'BRANCH', representative_relationship:'PAID_SUBSCRIBER', asserted_legal_business_name:'Acme Test',claim_statement:'I declare I represent this business as named'},
    {claimed_scope:'BRANCH', representative_relationship:'LEGAL_OWNER', asserted_legal_business_name:'A',claim_statement:'I declare I represent this business as named'},
    {claimed_scope:'BRANCH', representative_relationship:'LEGAL_OWNER', asserted_legal_business_name:'Acme Test',claim_statement:'short'},
  ]) {
    await assert.rejects(service.submitResearchClaim('ZW-DEAL-0001',actor,payload),/Claim requires/);
  }
  await assert.rejects(service.submitResearchClaim('ZW-DEAL-0001',{
    userId:'claimant', authenticationMethod:'x-user-id-fallback',
  },{}),/validated account session/);
});

test('S11 valid claim is accepted as pending evidence only, never grants a tenant or role', async () => {
  const fromOriginal = supabase.from;
  try {
    supabase.from = (table) => {
      if (table === 'dealer_research_public_profiles') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({data:rawPrivate,error:null}),
        };
      }
      if (table === 'dealer_full_storefront_current') { return {
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({data:null,error:null}),
      }; }
      if (table === 'dealer_research_claim_requests') {
        return {
          insert(payload) {
            assert.equal(payload.claimant_user_id,'claimant');
            assert.equal(payload.seed_dealer_id,'ZW-DEAL-0001');
            assert.equal(Object.hasOwn(payload,'tenant_id'),false);
            assert.equal(Object.hasOwn(payload,'role'),false);
            return this;
          },
          select() { return this; },
          single: async () => ({ data:{
            claim_id:'test-claim',seed_dealer_id:'ZW-DEAL-0001',
            claimed_scope:'BRANCH',claim_status:'AWAITING_DOCUMENTARY_EVIDENCE',
          },error:null }),
        };
      }
      throw Error('Unexpected table read ' + table);
    };
    const result = await service.submitResearchClaim('ZW-DEAL-0001',{
      userId:'claimant', authenticationMethod:'session',
    },{
      claimed_scope:'BRANCH', representative_relationship:'AUTHORIZED_REPRESENTATIVE',
      asserted_legal_business_name:'Acme Test Entity',
      claim_statement:'I am a purported authorized representative requiring independent review.',
    });
    assert.equal(result.authorization_granted,false);
    assert.equal(result.evidence_required,true);
    assert.equal(result.claim_status,'AWAITING_DOCUMENTARY_EVIDENCE');
  } finally {
    supabase.from=fromOriginal;
  }
});
