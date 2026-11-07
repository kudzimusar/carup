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
const service=await import('../services/dealer/dealerComplianceApplicationService.js');

const claimId='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const submissionId='ed39acc8-a234-40c9-bf3b-490d9ba66329';
const claimant={userId:'claimant-1',authenticationMethod:'session',platformRole:'member'};
const reviewer={userId:'reviewer-1',authenticationMethod:'session',
  platformRole:'admin',isVerified:true};
const password='StrongReviewerCompliancePassword2026!';
const approved={claim_id:claimId,claimant_user_id:'claimant-1',claim_status:'CLAIM_APPROVED'};
const submission={submission_id:submissionId,claim_id:claimId,claimant_user_id:'claimant-1',
  intake_version:3,submitted_at:'2026-11-03T00:00:00.000Z'};
function query(data) {
  return {
    select(){return this},eq(){return this},in(){return this},
    order(){return this},limit(){return Promise.resolve({data,error:null})},
    maybeSingle:async()=>({data,error:null}),
  };
}
function fakeFrom({claim=approved,user,sub=submission,submissions=[submission],reviews=[]}={}){
  const old=supabase.from;
  supabase.from=(table)=>{
    if(table==='dealer_research_claim_requests')return query(claim);
    if(table==='users')return query(user||null);
    if(table==='dealer_claim_compliance_submissions'){
      return { ...query(sub),limit:async()=>({data:submissions,error:null})};
    }
    if(table==='dealer_claim_compliance_review_events')
      return query(reviews);
    throw Error('Unexpected private table '+table);
  };
  return()=>{supabase.from=old};
}
test('D6 a header-asserted actor and foreign claimant cannot submit someone else’s application',async()=>{
  const reset=fakeFrom();
  const args={expected_version:3,attestation_version:'CARUP_DEALER_APPLICANT_DECLARATION_1',
    acknowledge_applicant_declaration:true};
  try{
    await assert.rejects(service.submitDealerApplication(claimId,
      {...claimant,authenticationMethod:'x-user-id-fallback'},args),
      /REAL_SESSION_REQUIRED/);
    await assert.rejects(service.submitDealerApplication(claimId,
      {...claimant,userId:'another-user'},args),/CLAIM_NOT_FOUND/);
    await assert.rejects(service.submitDealerApplication(claimId,claimant,
      {...args,acknowledge_applicant_declaration:false}),
      /EXPLICIT_APPLICANT_ATTESTATION_REQUIRED/);
    await assert.rejects(service.submitDealerApplication(claimId,claimant,
      {...args,expected_version:-1}),/EXPECTED_DRAFT_VERSION_REQUIRED/);
  }finally{reset()}
});
test('D6 only approved ownership can submit and backend never derives authorization from request fields',async()=>{
  const oldRpc=supabase.rpc;
  const payload={expected_version:3,attestation_version:'CARUP_DEALER_APPLICANT_DECLARATION_1',
    acknowledge_applicant_declaration:true,role:'admin',tenant_id:'injected'};
  let reset=fakeFrom({claim:{...approved,claim_status:'CLAIM_DISPUTED'}});
  try{
    await assert.rejects(service.submitDealerApplication(claimId,claimant,payload),
      /CLAIM_APPROVAL_REQUIRED/);
  }finally{reset()}
  reset=fakeFrom();
  try{
    supabase.rpc=async(name,args)=>{
      assert.equal(name,'dealer_submit_compliance_application');
      assert.equal(args.p_claimant_id,'claimant-1');
      assert.equal(args.p_expected_version,3);
      assert.equal(args.p_attestation_acknowledged,true);
      assert.equal(Object.hasOwn(args,'tenant_id'),false);
      assert.equal(Object.hasOwn(args,'role'),false);
      return {data:{submission_id:submissionId,compliance_approved:false,
        tenant_activated:false},error:null};
    };
    const result=await service.submitDealerApplication(claimId,claimant,payload);
    assert.equal(result.tenant_activated,false);
  }finally{reset();supabase.rpc=oldRpc}
});
test('D6 applicant sees only own frozen receipt plus correction reason, no reviewer identity',async()=>{
  const reset=fakeFrom({reviews:[{
    submission_id:submissionId,verdict:'EVIDENCE_REQUIRED',
    decision_reason:'Please upload independent original registration evidence and confirm authority.',
    created_at:'2026-11-03T00:00:00.000Z',reviewer_user_id:'PRIVATE_REVIEWER',
  }]});
  try{
    const found=await service.listMyDealerApplicationSubmissions(claimId,claimant);
    assert.equal(found.length,1);
    assert.equal(found[0].preliminary_status,'EVIDENCE_REQUIRED');
    assert.equal(found[0].tenant_activated,false);
    assert.ok(found[0].correction_reason.includes('independent original'));
    assert.ok(!JSON.stringify(found).includes('PRIVATE_REVIEWER'));
  }finally{reset()}
});
test('D6 reviewer queue never exposes applicant workbook, contact data or attachments',async()=>{
  const reset=fakeFrom({submissions:[{
    ...submission,application_snapshot:{contact:'PRIVATE_PHONE',tax:'SECRET'},
  }]});
  try{
    const entries=await service.listDealerComplianceReviewQueue(reviewer);
    assert.equal(entries.length,1);
    assert.equal(entries[0].independent_review_required,true);
    assert.equal(entries[0].submission_id,submissionId);
    assert.ok(!JSON.stringify(entries).includes('PRIVATE_PHONE'));
    assert.ok(!JSON.stringify(entries).includes('SECRET'));
    await assert.rejects(service.listDealerComplianceReviewQueue({
      ...reviewer,authenticationMethod:'x-user-id-fallback'}),/REAL_SESSION_REQUIRED/);
  }finally{reset()}
});
test('D6 private full case preview requires actual independent reviewer password reauthentication',async()=>{
  const user={id:'reviewer-1',is_verified:true,role:'admin',
    password_hash:await hashPassword(password)};
  const reset=fakeFrom({user,sub:{...submission,
    application_snapshot:{private_business:'CONFIDENTIAL_123'}}});
  try{
    await assert.rejects(service.previewDealerComplianceCase(submissionId,claimant,password),
      /INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
    await assert.rejects(service.previewDealerComplianceCase(submissionId,reviewer,'wrong'),
      /REAUTHENTICATION_REQUIRED|REAUTHENTICATION_FAILED/);
    const item=await service.previewDealerComplianceCase(submissionId,reviewer,password);
    assert.equal(item.verified,false);assert.equal(item.can_activate,false);
    assert.equal(item.legal_compliance_approved,false);
    assert.equal(item.application_snapshot.private_business,'CONFIDENTIAL_123');
    await assert.rejects(service.previewDealerComplianceCase(submissionId,
      {...reviewer,userId:'claimant-1'},password),
      /INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
  }finally{reset()}
});
test('D6 qualified independent reviewer can only record nonapproving verdicts',async()=>{
  const user={id:'reviewer-1',is_verified:true,role:'admin',
    password_hash:await hashPassword(password)};
  const reset=fakeFrom({user});
  const oldRpc=supabase.rpc;
  let invoked=0;
  try{
    supabase.rpc=async(name,args)=>{
      assert.equal(name,'dealer_review_compliance_submission');invoked++;
      assert.equal(args.p_reviewer_id,'reviewer-1');
      assert.equal(args.p_verdict,'READY_FOR_REGULATORY_REVIEW');
      assert.ok(!Object.hasOwn(args,'tenant_id'));
      return {data:{preliminary_review_only:true,compliance_approved:false,
        tenant_activated:false,verdict:args.p_verdict},error:null};
    };
    for(const outcome of ['APPROVE_COMPLIANCE','ACTIVATE_TENANT','CLAIM_APPROVED']){
      await assert.rejects(service.recordDealerPreliminaryReview(submissionId,reviewer,{
        reviewer_password:password,verdict:outcome,
        reason:'A detailed but unauthorized compliance authorization was attempted by the reviewer.',
      }),/UNSUPPORTED_PRELIMINARY_REVIEW_OUTCOME/);
    }
    assert.equal(invoked,0);
    const result=await service.recordDealerPreliminaryReview(submissionId,reviewer,{
      reviewer_password:password,verdict:'READY_FOR_REGULATORY_REVIEW',
      reason:'Independently inspected frozen applicant declarations; legal country-policy review remains required.',
    });
    assert.equal(result.tenant_activated,false);
    assert.equal(result.compliance_approved,false);
    assert.equal(invoked,1);
  }finally{reset();supabase.rpc=oldRpc}
});
