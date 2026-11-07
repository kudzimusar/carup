import test from 'node:test';
import assert from 'node:assert/strict';
import {installStepUpGuardModel} from './helpers/dealerStepUpGuardModel.js';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
// R6: the reviewer step-up lockout RPCs are answered by a faithful in-memory model.
installStepUpGuardModel(supabase);
const {hashPassword}=await import('../utils/passwordAuth.js');
const legal=await import('../services/dealer/dealerLegalActivationService.js');
const submitted='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const approved='ed39acc8-a234-40c9-bf3b-490d9ba66329';
const evidence1='247c7f12-a0c0-4d30-b9f4-a68dbe50ab61';
const evidence2='26221b44-773c-4c26-89aa-1ce255e35e55';
const reviewer={userId:'reviewer-legal',authenticationMethod:'session',
  isVerified:true,platformRole:'admin'};
const approver={...reviewer,userId:'reviewer-activation'};
const claimant={userId:'customer-1',authenticationMethod:'session',platformRole:'owner'};
const password='StrongLegalReviewerPassword!123';
const reason='Independently reviewed synthetic documents and their scope; exact country policy and legal evidence are required.';
function query(data){
  return {select(){return this},eq(){return this},in(){return this},
    order(){return this},limit(){return Promise.resolve({data,error:null})},
    maybeSingle:async()=>({data,error:null})};
}
function install({country=[],claim,link,member,profile,tenant,review,policy,sub,user,legalReview}={}){
  const original=supabase.from;
  supabase.from=table=>{
    const values={
      dealer_country_legal_policy_authority:country,
      dealer_claim_compliance_submissions:sub||{
        submission_id:approved,claim_id:submitted,claimant_user_id:'customer-1',intake_version:1},
      dealer_legal_application_reviews:legalReview||{
        legal_review_id:approved,claimant_user_id:'customer-1',reviewer_user_id:'reviewer-legal',
        legal_expires_at:new Date(Date.now()+86400000).toISOString(),
        country_code:'ZW',policy_version:'APPROVED_TEST_1'},
      dealer_research_claim_requests:claim??{
        claim_id:submitted,claimant_user_id:'customer-1',claim_status:'CLAIM_APPROVED'},
      dealer_approved_seed_links:link??null,
      dealer_profiles:profile??null,
      tenant_users:member??null,
      tenants:tenant??null,
      users:user??null,
    };
    if(table==='dealer_claim_compliance_review_events')
      return query(review||[]);
    return query(values[table]??null);
  };
  return()=>{supabase.from=original};
}
test('C08 forbidden claimant/header session cannot become independent reviewer',async()=>{
  const done=install();
  try{
    await assert.rejects(legal.listPendingLegalDealershipCases({
      ...reviewer,authenticationMethod:'x-user-id-fallback'}),/REAL_SESSION_REQUIRED/);
    await assert.rejects(legal.certifyLegalDealerCase(approved,claimant,{}),
      /INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
    await assert.rejects(legal.activateLegallyApprovedDealer(approved,reviewer,{}),
      /LEGAL_REVIEWER_CANNOT_ACTIVATE_OWN_CASE/);
  }finally{done()}
});
test('C08 draft country policy is disabled and no legal approval can be issued via reviewer policy read',async()=>{
  const done=install({country:[{country_code:'ZW',policy_version:'ZW_DRAFT',
    policy_state:'DRAFT',effective_at:null,expires_at:null}]});
  try{
    const p=await legal.listLegalCountryPolicyReadiness(reviewer);
    assert.equal(p[0].eligibility,'ACTIVATION_DISABLED');
    assert.equal(p[0].activated_entities_by_this_read,0);
  }finally{done()}
});
test('C08 applicant claim may be approved without granting operational tenant access',async()=>{
  const done=install();
  try{
    const result=await legal.readMyOperationalDealerAuthority(submitted,claimant);
    assert.equal(result.operational,false);
    assert.equal(result.state,'NOT_YET_ACTIVATED');
    await assert.rejects(legal.readMyOperationalDealerAuthority(submitted,
      {...claimant,userId:'attacker'}),/CLAIM_NOT_FOUND/);
  }finally{done()}
});
test('C08 legal case cannot approve without exact two separate originals and account password',async()=>{
  const oldRpc=supabase.rpc;
  const user={id:'reviewer-legal',role:'admin',is_verified:true,
    password_hash:await hashPassword(password)};
  const done=install({user});
  let calls=0;
  try{
    supabase.rpc=async(name,args)=>{
      assert.equal(name,'dealer_record_legal_application_approval');calls++;
      assert.equal(args.p_submission_id,approved);
      assert.equal(args.p_reviewer_id,'reviewer-legal');
      assert.equal(Object.hasOwn(args,'tenant_id'),false);
      return {data:{legal_review_recorded:true,tenant_activated:false},error:null};
    };
    const base={reviewer_password:password,country_policy_version:'ZW_DRAFT',
      company_registration_evidence_id:evidence1,
      signatory_evidence_id:evidence2,
      verified_issuer:'Fixture registry',reviewed_registration_number:'FIC-001',
      approved_scope:'BRANCH',legal_expires_at:new Date(Date.now()+86400000).toISOString(),
      reason};
    await assert.rejects(legal.certifyLegalDealerCase(approved,reviewer,
      {...base,signatory_evidence_id:evidence1}),/TWO_DISTINCT_ORIGINAL_DOCUMENTS_REQUIRED/);
    await assert.rejects(legal.certifyLegalDealerCase(approved,reviewer,
      {...base,reviewer_password:'bad'}),/REAUTHENTICATION_REQUIRED|REAUTHENTICATION_FAILED/);
    const output=await legal.certifyLegalDealerCase(approved,reviewer,base);
    assert.equal(output.tenant_activated,false);
    assert.equal(calls,1);
  }finally{done();supabase.rpc=oldRpc}
});
test('C11 separation-of-reviewer final approver and no client-granted tenant id',async()=>{
  const oldRpc=supabase.rpc;
  const user={id:'reviewer-activation',role:'admin',is_verified:true,
    password_hash:await hashPassword(password)};
  const done=install({user});
  try{
    supabase.rpc=async(name,args)=>{
      assert.equal(name,'dealer_activate_approved_legal_claim');
      assert.equal(args.p_legal_review_id,approved);
      assert.equal(args.p_approver_id,'reviewer-activation');
      assert.ok(!Object.hasOwn(args,'tenant_id'));
      return {data:{idempotent:false,owner_membership_recorded:true,
        public_verified_badge_granted:false,
        vehicle_listing_authority_granted:false,
        payment_entitlement_granted:false},error:null};
    };
    const result=await legal.activateLegallyApprovedDealer(approved,approver,
      {reviewer_password:password,activation_reason:reason});
    assert.equal(result.payment_entitlement_granted,false);
    assert.equal(result.public_verified_badge_granted,false);
  }finally{done();supabase.rpc=oldRpc}
});
