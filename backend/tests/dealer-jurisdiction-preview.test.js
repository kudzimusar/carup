import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
const policy=await import('../services/dealer/dealerJurisdictionPreview.js');
const cid='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const actor={userId:'owner-1',authenticationMethod:'session'};
const doc=(business,rest={})=>({tab_rows:{
  BUSINESS:[business],BRANCHES:[{branch_name:'Harare Yard',city:'Harare'}],
  ...rest,
}});
function query(data){
  return {select(){return this},eq(){return this},
    maybeSingle:async()=>({data,error:null})};
}
test('D10 Zimbabwe policy remains legally unapproved and never activates dealer',()=>{
  const p=policy.buildJurisdictionCompliancePreview(doc({
    legal_name:'Test Dealer',operating_country:'ZW'
  }));
  assert.equal(p.country,'ZW');
  assert.equal(p.state,'DRAFT_POLICY_REVIEW_ONLY');
  assert.equal(p.can_activate,false);assert.equal(p.can_publish,false);
  assert.equal(p.legal_review_complete,false);
  assert.equal(p.policy_status,'DRAFT_REQUIRES_ZW_LEGAL_SIGNOFF');
  assert.ok(p.requirements.some(r=>r.requirement_key==='AUTHORIZED_SIGNATORY'));
  assert.ok(p.requirements.every(r=>r.evidence_status==='NOT_INDEPENDENTLY_VERIFIED'));
  assert.ok(!p.requirements.some(r=>r.requirement_key==='PUBLIC_PROCUREMENT_REGISTRATION'));
  assert.ok(!p.requirements.some(r=>r.requirement_key==='BONDED_FACILITY_AUTHORIZATION'));
  assert.ok(!p.requirements.some(r=>r.requirement_key==='OEM_WRITTEN_AUTHORIZATION'));
});
test('D10 source-franchise research category never independently proves OEM rights',()=>{
  const candidate=doc({legal_name:'Claimed Group',operating_country:'ZW'});
  candidate.source_research_category='Official dealer / franchise label — UNVERIFIED';
  const p=policy.buildJurisdictionCompliancePreview(candidate);
  assert.ok(!p.requirements.some(r=>r.requirement_key==='OEM_WRITTEN_AUTHORIZATION'));
});
test('D10 only the applicant declared activity triggers conditional requirements',()=>{
  const p=policy.buildJurisdictionCompliancePreview(doc({
    legal_name:'Claimed Group',operating_country:'ZW',
    business_model:'Bonded facility, government procurement'
  },{
    BRANDS_FRANCHISES:[{brand:'Toyota',relationship:'official franchise'}],
    OPERATIONS_SOURCING:[{sourcing_channels:'bonded facility'}],
    FINANCE_PAYMENTS:[{finance_partner:'Example Unverified Bank'}],
    WORKSHOP_WARRANTY:[{workshop_services:'inspection and repairs'}],
  }));
  for(const name of ['OEM_WRITTEN_AUTHORIZATION','BONDED_FACILITY_AUTHORIZATION',
    'PUBLIC_PROCUREMENT_REGISTRATION','FINANCE_PARTNER_AUTHORIZATION',
    'WORKSHOP_FACILITY_POLICY']){
    const match=p.requirements.find(r=>r.requirement_key===name);
    assert.ok(match,name);
    assert.equal(match.applicability,'REQUIRES_HUMAN_DETERMINATION');
    assert.equal(match.legal_source_verified,false);
  }
  assert.equal(p.can_activate,false);
});
test('D10 foreign and missing country fail closed with no Zimbabwe requirements',()=>{
  for(const code of ['ZA','JP','US']){
    const p=policy.buildJurisdictionCompliancePreview(doc({
      legal_name:'International Entity',operating_country:code,
      business_model:'Bonded warehouse, official franchise'
    }));
    assert.equal(p.state,'COUNTRY_POLICY_NOT_CONFIGURED');
    assert.equal(p.country,code);assert.equal(p.requirements.length,0);
    assert.equal(p.can_publish,false);
    assert.ok(p.unresolved.some(s=>s.includes('Zimbabwe requirements must not')));
  }
  const m=policy.buildJurisdictionCompliancePreview(doc({
    legal_name:'Without Country'
  }));
  assert.equal(m.state,'COUNTRY_REQUIRED');
});
test('D10 strict claim owner and independent claim approval gate',async()=>{
  const old=supabase.from;
  try{
    supabase.from=(table)=>{
      assert.equal(table,'dealer_research_claim_requests');
      return query({claimant_user_id:'owner-1',claim_status:'AWAITING_DOCUMENTARY_EVIDENCE'});
    };
    await assert.rejects(policy.readMyClaimJurisdictionPreview(cid,{...actor,userId:'other'}),
      /CLAIM_NOT_FOUND/);
    await assert.rejects(policy.readMyClaimJurisdictionPreview(cid,actor),
      /CLAIM_APPROVAL_REQUIRED/);
    await assert.rejects(policy.readMyClaimJurisdictionPreview(cid,
      {...actor,authenticationMethod:'x-user-id-fallback'}),/REAL_SESSION_REQUIRED/);
  }finally{supabase.from=old}
});
test('D10 private draft readback projects no raw document or tenant authority',async()=>{
  const old=supabase.from;
  try{
    supabase.from=(table)=>{
      if(table==='dealer_research_claim_requests')
        return query({claimant_user_id:'owner-1',claim_status:'CLAIM_APPROVED'});
      if(table==='dealer_claim_intake_drafts')
        return query({submission_version:4,content:doc({
          legal_name:'Approved Claimant Draft (NOT verified)',
          operating_country:'ZW',tax_clearance_number:'PRIVATE-TAX-123'
        })});
      throw new Error('unexpected table '+table);
    };
    const p=await policy.readMyClaimJurisdictionPreview(cid,actor);
    assert.equal(p.submission_version,4);
    assert.equal(p.can_activate,false);
    assert.ok(!JSON.stringify(p).includes('PRIVATE-TAX-123'));
    assert.ok(!JSON.stringify(p).includes('tenant_id'));
  }finally{supabase.from=old}
});
