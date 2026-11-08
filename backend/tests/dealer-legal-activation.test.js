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
      reason,documents_confirmed:true};
    await assert.rejects(legal.certifyLegalDealerCase(approved,reviewer,
      {...base,signatory_evidence_id:evidence1}),/TWO_DISTINCT_ORIGINAL_DOCUMENTS_REQUIRED/);
    // UAT-R1: both originals must be confirmed as opened and correctly classified by THIS reviewer.
    await assert.rejects(legal.certifyLegalDealerCase(approved,reviewer,
      {...base,documents_confirmed:undefined}),/REVIEWER_DOCUMENT_CONFIRMATION_REQUIRED/);
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
// R6 functional — the activated dealer SEES suspension, withdrawal and expiry and the
// governed way back; reasons are categories, never a reviewer's free text.
const activeLink={organization_id:'org-1',tenant_id:'t-1',dealer_profile_id:'p-1',
  operating_status:'ACTIVE',legal_review_id:approved};
test('R6 a suspended dealer is told it is suspended and who can reinstate it',async()=>{
  const done=install({link:{...activeLink,operating_status:'SUSPENDED'}});
  try{
    const r=await legal.readMyOperationalDealerAuthority(submitted,claimant);
    assert.equal(r.state,'DEALER_OPERATIONS_SUSPENDED');
    assert.deepEqual(r.blocking_reasons,['SUSPENDED_BY_INDEPENDENT_REVIEW']);
    assert.equal(r.next_step,'REINSTATEMENT_BY_A_DIFFERENT_INDEPENDENT_REVIEWER');
    assert.equal(r.operational,false);assert.equal(r.tenant_id,null);
    assert.equal(JSON.stringify(r).includes('reason":"'),false,'no reviewer free text');
  }finally{done()}
});
test('R6 a withdrawn dealer is told a new claim is required',async()=>{
  const done=install({link:{...activeLink,operating_status:'WITHDRAWN'}});
  try{
    const r=await legal.readMyOperationalDealerAuthority(submitted,claimant);
    assert.equal(r.state,'DEALER_OPERATIONS_WITHDRAWN');
    assert.equal(r.next_step,'INDEPENDENT_TRANSFER_OR_DISPUTE_REVIEW_REQUIRED');
  }finally{done()}
});
test('R6 an expired legal review explains itself and points to renewal',async()=>{
  const done=install({link:activeLink,
    legalReview:{legal_review_id:approved,claimant_user_id:'customer-1',reviewer_user_id:'reviewer-legal',
      legal_expires_at:new Date(Date.now()-86400000).toISOString(),country_code:'ZW',policy_version:'APPROVED_TEST_1'},
    country:{policy_state:'APPROVED',effective_at:new Date(Date.now()-864e5).toISOString(),
      expires_at:new Date(Date.now()+864e5).toISOString()},
    member:{role:'dealer'},tenant:{type:'dealership',status:'active'},
    profile:{identity_status:'verified',compliance_review_state:'passed',active_state:'active',
      restriction_state:'none',suspension_state:'none',investigation_state:'open',
      expiry_date:new Date(Date.now()+864e5).toISOString()}});
  try{
    const r=await legal.readMyOperationalDealerAuthority(submitted,claimant);
    assert.equal(r.state,'DEALER_AUTHORITY_BLOCKED');
    assert.deepEqual(r.blocking_reasons,['LEGAL_REVIEW_EXPIRED','UNDER_INDEPENDENT_REVIEW']);
    assert.equal(r.next_step,'SUBMIT_UPDATED_APPLICATION_FOR_RENEWAL');
    assert.equal(r.operational,false);
  }finally{done()}
});

test('R6 the legal reviewer sees the dealer and PICKS evidence; finished cases leave the queue; no storage path',async()=>{
  const original=supabase.from;
  const pending='3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', finished='4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
  const tables={
    dealer_claim_compliance_review_events:[{submission_id:pending,reviewer_user_id:'prelim-1',verdict:'READY_FOR_REGULATORY_REVIEW'},
      {submission_id:finished,reviewer_user_id:'prelim-1',verdict:'READY_FOR_REGULATORY_REVIEW'}],
    dealer_claim_compliance_submissions:[
      {submission_id:pending,claim_id:submitted,claimant_user_id:'customer-1',intake_version:2,submitted_at:'2026-11-07T00:00:00Z',
        application_snapshot:{tab_rows:{BUSINESS:[{legal_name:'Fixture Legal Co'}]}}},
      {submission_id:finished,claim_id:submitted,claimant_user_id:'customer-1',intake_version:1,submitted_at:'2026-11-06T00:00:00Z',
        application_snapshot:{}}],
    dealer_legal_application_reviews:[{submission_id:finished}],
    dealer_research_claim_requests:[{claim_id:submitted,seed_dealer_id:'ZW-DEAL-0001'}],
    dealer_claim_private_evidence:[
      {evidence_id:'e-new',claim_id:submitted,document_class:'COMPANY_REGISTRATION',mime_type:'application/pdf',
        file_bytes:2048,created_at:'2026-11-07T00:00:00Z',storage_path:'dealership-claims/x/y.pdf'},
      {evidence_id:'e-photo',claim_id:submitted,document_class:'COMPANY_REGISTRATION',mime_type:'image/jpeg',
        file_bytes:4096,created_at:'2026-11-06T00:00:00Z',storage_path:'dealership-claims/x/z.jpg'}],
    // UAT-R1: a quarantined (mis-filed) document is listed with why, and is never pickable.
    dealer_claim_evidence_quarantine_events:[{evidence_id:'e-photo',reason_code:'UPLOADED_IN_ERROR'}],
  };
  supabase.from=table=>{
    let ownClaimLookup=false;
    const rows=()=>ownClaimLookup?[]:(tables[table]??[]);
    const b={select(){return b},in(){return b},order(){return b},
      eq(k){if(table==='dealer_research_claim_requests'&&k==='claimant_user_id')ownClaimLookup=true;return b},
      limit(){return Promise.resolve({data:rows(),error:null})},
      then(resolve){return Promise.resolve({data:rows(),error:null}).then(resolve)}};
    return b;
  };
  try{
    const cases=await legal.listPendingLegalDealershipCases(reviewer);
    assert.deepEqual(cases.map(c=>c.submission_id),[pending],'a case with a legal review is no longer pending');
    assert.equal(cases[0].seed_dealer_id,'ZW-DEAL-0001');
    assert.equal(cases[0].declared_legal_name,'Fixture Legal Co');
    assert.deepEqual(cases[0].evidence,[{evidence_id:'e-new',document_class:'COMPANY_REGISTRATION',
      mime_type:'application/pdf',file_bytes:2048,uploaded_at:'2026-11-07T00:00:00Z',quarantined:false,quarantine_reason:null},
      {evidence_id:'e-photo',document_class:'COMPANY_REGISTRATION',mime_type:'image/jpeg',file_bytes:4096,
        uploaded_at:'2026-11-06T00:00:00Z',quarantined:true,quarantine_reason:'UPLOADED_IN_ERROR'}]);
    assert.equal(JSON.stringify(cases).includes('dealership-claims/'),false,'no storage path leaves the service');
  }finally{supabase.from=original}
});
test('R6 claimant status reports listings truthfully; the gating authority read never queries vehicles',async()=>{
  const original=supabase.from;
  const seen=[];
  const make=(published)=>table=>{
    seen.push(table);
    const values={
      dealer_research_claim_requests:{claim_id:submitted,claimant_user_id:'customer-1',claim_status:'CLAIM_APPROVED'},
      dealer_approved_seed_links:{...activeLink,operating_status:'SUSPENDED'},
      vehicles:published,
    };
    const data=values[table]??null;
    const b={select(){return b},eq(){return b},in(){return b},order(){return b},
      limit(){return Promise.resolve({data,error:null})},maybeSingle:async()=>({data,error:null})};
    return b;
  };
  try{
    supabase.from=make([]);
    const pure=await legal.readMyOperationalDealerAuthority(submitted,claimant);
    assert.equal(seen.includes('vehicles'),false,'the gating read stays a pure authority check');
    assert.equal('public_listings_withdrawn' in pure,false);
    const done=await legal.readMyOperationalDealerStatus(submitted,claimant);
    assert.equal(done.public_listings_withdrawn,true);assert.equal(done.public_listings_withdrawal_pending,false);
    supabase.from=make([{vin:'SYNTHVIN0000001'}]);
    const pending=await legal.readMyOperationalDealerStatus(submitted,claimant);
    assert.equal(pending.public_listings_withdrawn,false,'never claims withdrawn while a listing is public');
    assert.equal(pending.public_listings_withdrawal_pending,true);
  }finally{supabase.from=original}
});

test('R6 closure: a reviewer holding a claim on the same business never sees its legal case',async()=>{
  const original=supabase.from;
  const pending='5f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
  const tables={
    dealer_claim_compliance_review_events:[{submission_id:pending,reviewer_user_id:'prelim-1',verdict:'READY_FOR_REGULATORY_REVIEW'}],
    dealer_claim_compliance_submissions:[{submission_id:pending,claim_id:submitted,claimant_user_id:'customer-1',
      intake_version:1,submitted_at:'2026-11-07T00:00:00Z',application_snapshot:{}}],
    dealer_legal_application_reviews:[],
    dealer_research_claim_requests:[{claim_id:submitted,seed_dealer_id:'ZW-DEAL-0001'}],
    dealer_claim_private_evidence:[],
  };
  let ownClaims=[];
  supabase.from=table=>{
    let filters={};
    const rows=()=>table==='dealer_research_claim_requests'&&filters.claimant_user_id?ownClaims:(tables[table]??[]);
    const b={select(){return b},in(){return b},order(){return b},
      eq(k,v){filters[k]=v;return b},
      limit(){return Promise.resolve({data:rows(),error:null})},
      then(resolve){return Promise.resolve({data:rows(),error:null}).then(resolve)}};
    return b;
  };
  try{
    assert.equal((await legal.listPendingLegalDealershipCases(reviewer)).length,1);
    ownClaims=[{seed_dealer_id:'ZW-DEAL-0001'}];
    assert.deepEqual(await legal.listPendingLegalDealershipCases(reviewer),[],'conflicted reviewer sees nothing');
  }finally{supabase.from=original}
});
