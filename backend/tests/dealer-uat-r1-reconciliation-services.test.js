// CARUP-DEALER-1.0-VISUAL-UAT-R1 — service-layer contract for the Owner UAT fixes (the SQL behaviour
// itself is proved on PostgreSQL by database/test/dealer_1_0_pglite_check.mjs DEALER_UAT_R1_*):
//   * reconciliation preview/confirm: independent reviewer, legal reviewer refused, conflicted reviewer
//     refused BEFORE any step-up attempt, password step-up, reason + confirmed target, named refusals;
//   * activation surfaces PREEXISTING_DEALER_REQUIRES_INDEPENDENT_RECONCILIATION by name;
//   * evidence withdrawal (claimant) and quarantine (independent reviewer + step-up);
//   * registration number never accepts an e-mail; attached-claim authority state;
//   * performance cards: exact counts or null, DEFERRED for capabilities CarUp does not have.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStepUpGuardModel} from './helpers/dealerStepUpGuardModel.js';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
installStepUpGuardModel(supabase);
const {hashPassword}=await import('../utils/passwordAuth.js');
const legal=await import('../services/dealer/dealerLegalActivationService.js');
const claims=await import('../services/dealer/dealerClaimApplicationService.js');
const perf=await import('../services/dealer/dealerPerformanceSummaryService.js');

const CLAIM='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const REVIEW='ed39acc8-a234-40c9-bf3b-490d9ba66329';
const SUB='247c7f12-a0c0-4d30-b9f4-a68dbe50ab61';
const EVIDENCE='26221b44-773c-4c26-89aa-1ce255e35e55';
const approver={userId:'reviewer-activation',authenticationMethod:'session',isVerified:true,platformRole:'admin'};
const legalReviewer={...approver,userId:'reviewer-legal'};
const claimant={userId:'customer-1',authenticationMethod:'session',platformRole:'owner'};
const password='StrongActivationReviewerPassword!123';
const reason='Independent reconciliation: both legal reviews name the same registration number and legal name; branch scope.';
const hash=await hashPassword(password);

function rows(data){
  const b={select(){return b},eq(){return b},in(){return b},order(){return b},not(){return b},
    gte(){return b},lt(){return b},
    limit:()=>Promise.resolve({data:Array.isArray(data)?data:data?[data]:[],error:null}),
    maybeSingle:async()=>({data:Array.isArray(data)?data[0]??null:data,error:null}),
    then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};
  return b;
}
function install({tables={},rpc={}}={}){
  const originalFrom=supabase.from,originalRpc=supabase.rpc;
  const calls=[];
  const base={
    dealer_legal_application_reviews:{legal_review_id:REVIEW,submission_id:SUB,claimant_user_id:'customer-1',
      reviewer_user_id:'reviewer-legal',policy_version:'APPROVED_TEST_1',legal_expires_at:new Date(Date.now()+86400000).toISOString()},
    dealer_claim_compliance_submissions:{submission_id:SUB,claim_id:CLAIM},
    dealer_research_claim_requests:{claim_id:CLAIM,seed_dealer_id:'ZW-DEAL-0003',claimant_user_id:'customer-1',claim_status:'CLAIM_APPROVED'},
    users:{id:'reviewer-activation',password_hash:hash,is_verified:true,role:'admin'},
    tenant_users:[],dealer_approved_seed_links:[],dealer_branch_claim_attachments:[],
    ...tables,
  };
  supabase.from=table=>{
    // the reviewer's own claims (conflict lookup) are empty unless a test says otherwise
    if(table==='dealer_research_claim_requests'){
      let own=false;
      const b={select(){return b},in(){return b},order(){return b},
        eq(k){if(k==='claimant_user_id')own=true;return b},
        limit:()=>Promise.resolve({data:own?(tables.reviewerClaims||[]):[base[table]],error:null}),
        maybeSingle:async()=>({data:base[table],error:null})};
      return b;
    }
    return rows(base[table]??null);
  };
  const guard=supabase.rpc;
  supabase.rpc=async(name,args)=>{
    if(name.startsWith('dealer_begin_reviewer_step_up')||name.startsWith('dealer_complete_reviewer_step_up'))
      return guard(name,args);
    calls.push({name,args});
    return rpc[name]?rpc[name](args):{data:null,error:{message:'UNEXPECTED_RPC'}};
  };
  return {calls,restore(){supabase.from=originalFrom;supabase.rpc=originalRpc}};
}

test('preview: independent reviewer only; legal reviewer and conflicted staff never see the case',async()=>{
  const preview={state:'READY_TO_ATTACH',blocker:null,target:{organization_id:'dealer_org_zw_deal_0001'},checks:[]};
  let env=install({rpc:{dealer_preview_branch_claim_reconciliation:()=>({data:preview,error:null})}});
  try{
    assert.deepEqual(await legal.previewBranchClaimReconciliation(REVIEW,approver),preview);
    assert.deepEqual(env.calls.map(c=>c.name),['dealer_preview_branch_claim_reconciliation']);
    assert.equal(env.calls[0].args.p_reviewer_id,'reviewer-activation');
    await assert.rejects(legal.previewBranchClaimReconciliation(REVIEW,legalReviewer),/LEGAL_REVIEWER_CANNOT_ACTIVATE_OWN_CASE/);
    await assert.rejects(legal.previewBranchClaimReconciliation(REVIEW,claimant),/INDEPENDENT_VERIFIED_REVIEWER_REQUIRED|REVIEWER/);
  }finally{env.restore()}
  // staff of a dealership the case's business is ATTACHED to (or linked to) are conflicted
  env=install({tables:{tenant_users:[{tenant_id:'t-1'}],dealer_branch_claim_attachments:[{seed_dealer_id:'ZW-DEAL-0003'}]},
    rpc:{dealer_preview_branch_claim_reconciliation:()=>({data:preview,error:null})}});
  try{
    await assert.rejects(legal.previewBranchClaimReconciliation(REVIEW,approver),
      e=>e.code==='DEALER_REVIEWER_CONFLICT_OF_INTEREST'&&e.statusCode===403);
    assert.deepEqual(env.calls,[],'nothing private is read for a conflicted reviewer');
  }finally{env.restore()}
});

test('reconcile: step-up, reason and confirmed target are required; named refusals reach the reviewer',async()=>{
  let result={data:{idempotent:false,organization_id:'dealer_org_zw_deal_0001',organization_created:false},error:null};
  const env=install({rpc:{dealer_reconcile_approved_branch_claim:()=>result}});
  try{
    await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reconciliation_reason:reason,
      expected_organization_id:'dealer_org_zw_deal_0001'}),/REAUTHENTICATION_REQUIRED/);
    await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:'wrong-password-123',
      reconciliation_reason:reason,expected_organization_id:'dealer_org_zw_deal_0001'}),/REAUTHENTICATION_FAILED/);
    await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:password,
      reconciliation_reason:'too short',expected_organization_id:'dealer_org_zw_deal_0001'}),/RECONCILIATION_REASON_REQUIRED/);
    await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:password,
      reconciliation_reason:reason}),/RECONCILIATION_TARGET_CONFIRMATION_REQUIRED/);
    assert.equal(env.calls.length,0,'no reconciliation is attempted before every precondition holds');
    const done=await legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:password,
      reconciliation_reason:reason,expected_organization_id:'dealer_org_zw_deal_0001'});
    assert.equal(done.organization_created,false);
    assert.deepEqual(env.calls[0].args,{p_legal_review_id:REVIEW,p_approver_id:'reviewer-activation',
      p_reason:reason,p_expected_organization_id:'dealer_org_zw_deal_0001'});
    for(const [code,status] of [['SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING',409],
      ['LEGAL_IDENTITY_CONFLICT_REQUIRES_INDEPENDENT_REVIEW',409],['RECONCILIATION_TARGET_CHANGED',409],
      ['SEPARATE_RECONCILIATION_APPROVER_REQUIRED',403]]){
      result={data:null,error:{message:code}};
      await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:password,
        reconciliation_reason:reason,expected_organization_id:'dealer_org_zw_deal_0001'}),
        e=>e.code===code&&e.statusCode===status);
    }
    result={data:null,error:{message:'some internal relation detail'}};
    await assert.rejects(legal.reconcileApprovedBranchClaim(REVIEW,approver,{reviewer_password:password,
      reconciliation_reason:reason,expected_organization_id:'dealer_org_zw_deal_0001'}),
      e=>e.code==='RECONCILIATION_GATES_NOT_MET'&&!String(e.message).includes('relation'));
  }finally{env.restore()}
});

test('activation tells the reviewer to reconcile instead of returning an opaque 409',async()=>{
  const env=install({rpc:{dealer_activate_approved_legal_claim:()=>({data:null,
    error:{message:'PREEXISTING_DEALER_REQUIRES_INDEPENDENT_RECONCILIATION'}})}});
  try{
    await assert.rejects(legal.activateLegallyApprovedDealer(REVIEW,approver,{reviewer_password:password,
      activation_reason:reason}),e=>e.code==='PREEXISTING_DEALER_REQUIRES_INDEPENDENT_RECONCILIATION'&&e.statusCode===409);
  }finally{env.restore()}
});

test('the reviewed registration number never accepts an e-mail address (browser autofill)',async()=>{
  assert.equal(legal.REGISTRATION_NUMBER_FORMAT.test('activator@example.invalid'),false);
  assert.equal(legal.REGISTRATION_NUMBER_FORMAT.test('UAT-FICT-REG-0001'),true);
  assert.equal(legal.REGISTRATION_NUMBER_FORMAT.test('1234/2010 (Pvt)'),true);
  const env=install({tables:{users:{id:'reviewer-legal',password_hash:hash,is_verified:true,role:'admin'},
    dealer_claim_compliance_submissions:{submission_id:SUB,claim_id:CLAIM,claimant_user_id:'customer-1',intake_version:3}},
    rpc:{dealer_record_legal_application_approval:()=>({data:{legal_review_recorded:true},error:null})}});
  try{
    await assert.rejects(legal.certifyLegalDealerCase(SUB,legalReviewer,{reviewer_password:password,
      company_registration_evidence_id:EVIDENCE,signatory_evidence_id:REVIEW,approved_scope:'BRANCH',
      country_policy_version:'APPROVED_TEST_1',verified_issuer:'Fixture Registry',
      reviewed_registration_number:'activator@example.invalid',reason:reason+reason,
      legal_expires_at:new Date(Date.now()+5*86400000).toISOString()}),/REGISTRATION_NUMBER_FORMAT_INVALID/);
    assert.equal(env.calls.length,0,'the legal decision is never recorded with an e-mail as registration number');
  }finally{env.restore()}
});

test('an attached second branch claim reports where it is operated, never as a separate tenant',async()=>{
  const env=install({tables:{dealer_branch_claim_attachments:{attach_status:'ACTIVE',organization_id:'dealer_org_zw_deal_0001',
    primary_link_id:'l-1',attached_at:'2026-11-08T00:00:00Z'},dealer_approved_seed_links:null}});
  try{
    const state=await legal.readMyOperationalDealerAuthority(CLAIM,claimant);
    assert.equal(state.state,'ATTACHED_TO_EXISTING_DEALERSHIP');
    assert.equal(state.operational,false);assert.equal(state.tenant_id,null);
    assert.equal(state.organization_id,'dealer_org_zw_deal_0001');
  }finally{env.restore()}
});

test('evidence: claimant withdrawal and reviewer quarantine (step-up, reason codes, named refusals)',async()=>{
  let answer={data:{quarantined:true,can_satisfy_legal_gate:false},error:null};
  const env=install({tables:{dealer_claim_private_evidence:{evidence_id:EVIDENCE,claim_id:CLAIM}},
    rpc:{dealer_quarantine_claim_evidence:()=>answer}});
  try{
    const w=await claims.withdrawMyClaimEvidence(CLAIM,EVIDENCE,claimant);
    assert.equal(w.can_satisfy_legal_gate,false);
    assert.deepEqual(env.calls[0].args,{p_evidence_id:EVIDENCE,p_actor_id:'customer-1',
      p_actor_kind:'CLAIMANT_WITHDRAWAL',p_reason_code:'UPLOADED_IN_ERROR',p_note:null});
    await assert.rejects(claims.withdrawMyClaimEvidence(CLAIM,EVIDENCE,{...claimant,userId:'someone-else'}),/CLAIM_NOT_FOUND/);
    answer={data:null,error:{message:'EVIDENCE_ALREADY_RELIED_ON_BY_A_REVIEW'}};
    await assert.rejects(claims.withdrawMyClaimEvidence(CLAIM,EVIDENCE,claimant),
      e=>e.code==='EVIDENCE_ALREADY_RELIED_ON_BY_A_REVIEW'&&e.statusCode===409);
    answer={data:{quarantined:true},error:null};
    const before=env.calls.length;
    await assert.rejects(claims.quarantineReviewClaimEvidence(CLAIM,EVIDENCE,approver,{reviewer_password:password,
      reason_code:'UPLOADED_IN_ERROR'}),/INVALID_EVIDENCE_QUARANTINE_REQUEST/,'UPLOADED_IN_ERROR is the claimant’s reason only');
    await assert.rejects(claims.quarantineReviewClaimEvidence(CLAIM,EVIDENCE,approver,{
      reason_code:'NOT_THE_DECLARED_DOCUMENT_TYPE'}),/REAUTHENTICATION_REQUIRED/);
    assert.equal(env.calls.length,before);
    await claims.quarantineReviewClaimEvidence(CLAIM,EVIDENCE,approver,{reviewer_password:password,
      reason_code:'NOT_THE_DECLARED_DOCUMENT_TYPE',note:'A showroom measurement photograph, not a certificate'});
    assert.equal(env.calls.at(-1).args.p_actor_kind,'INDEPENDENT_REVIEWER');
    await assert.rejects(claims.quarantineReviewClaimEvidence(CLAIM,EVIDENCE,claimant,{reviewer_password:password,
      reason_code:'NOT_THE_DECLARED_DOCUMENT_TYPE'}),/REVIEWER/);
  }finally{env.restore()}
});

test('performance cards: exact counts or null, never invented; unsupported capabilities are DEFERRED',async()=>{
  const counts={vehicles:7,published:3,inq:5,qualified:2,last30:4,prev30:1,saves:6};
  const asked=[];
  const db={from(table){
    const f={};const b={select(_c,opts){f.head=opts?.head;return b},eq(k,v){f[k]=v;return b},not(){f.not=true;return b},
      gte(){f.gte=true;return b},lt(){f.lt=true;return b},in(k,v){f.in=v;return b},
      limit:async()=>({data:[{vin:'V1'},{vin:'V2'}],error:null}),
      then(resolve){
        asked.push(table);
        let count=null;
        if(table==='vehicles')count=f.publication_status?counts.published:counts.vehicles;
        if(table==='marketplace_inquiries')count=f.status==='qualified'?counts.qualified:f.lt?counts.prev30:f.gte?counts.last30:counts.inq;
        if(table==='saved_vehicles')count=counts.saves;
        return Promise.resolve({count,error:null}).then(resolve);
      }};
    return b;
  }};
  const s=await perf.getMyDealerPerformanceSummary(claimant,{db,resolveOwner:async()=>({tenant_id:'t-1'}),now:()=>Date.parse('2026-11-08T00:00:00Z')});
  assert.equal(s.metrics.published_vehicles.value,3);
  assert.equal(s.metrics.recorded_vehicles.value,7);
  assert.equal(s.metrics.buyer_enquiries.value,5);
  assert.equal(s.metrics.buyer_enquiries.last_30_days,4);
  assert.equal(s.metrics.buyer_enquiries.previous_30_days,1);
  assert.equal(s.metrics.qualified_enquiries.value,2);
  assert.equal(s.metrics.vehicle_saves.value,6);
  for(const k of ['customer_rating','customer_reviews','dealership_saves','likes']){
    assert.equal(s.metrics[k].value,null);assert.equal(s.metrics[k].status,'DEFERRED_NEW_PRODUCT_CAPABILITY_REQUIRED');
  }
  // an unreadable source is "not available" (null), never zero
  const broken={from(){const b={select(){return b},eq(){return b},not(){return b},gte(){return b},lt(){return b},in(){return b},
    limit:async()=>({data:null,error:{message:'down'}}),then(r){return Promise.resolve({count:null,error:{message:'down'}}).then(r)}};return b}};
  const s2=await perf.getMyDealerPerformanceSummary(claimant,{db:broken,resolveOwner:async()=>({tenant_id:'t-1'})});
  for(const k of ['published_vehicles','recorded_vehicles','buyer_enquiries','qualified_enquiries','vehicle_saves'])
    assert.equal(s2.metrics[k].value,null,k+' is null when its source cannot be read');
});
