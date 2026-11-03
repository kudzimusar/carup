import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
const declaration=await import('../services/dealer/dealerOperationalDeclarationsService.js');
const owner={userId:'fixture-legal-owner',authenticationMethod:'session',
  platformRole:'member',isVerified:true};
const profileId='ad79adce-66de-473e-a749-7f5d936097ca';
const tenantId='e261bd14-201a-43ae-a108-731e1d62d7ae';
const claimId='d0ef8bc9-07c1-425d-a3f5-8e2bba52e761';
const link={claim_id:claimId,seed_dealer_id:'ZW-DEAL-0001',
  claimant_user_id:owner.userId,tenant_id:tenantId,
  dealer_profile_id:profileId,organization_id:'fixture-canonical-org',
  legal_review_id:'ae9b0801-83a3-4b3a-91f3-c52a520bf17d',operating_status:'ACTIVE'};
const future=new Date(Date.now()+5*86400000).toISOString();
const past=new Date(Date.now()-5*86400000).toISOString();
const profile={id:profileId,user_id:owner.userId,tenant_id:tenantId,
  active_state:'active',identity_status:'verified',compliance_review_state:'passed',
  restriction_state:'none',suspension_state:'none',investigation_state:'none',
  expiry_date:future};
function qb(data,{list=false}={}){
  return {
    select(){return this},eq(){return this},order(){return this},
    in(){return this},
    maybeSingle:async()=>({data,error:null}),
    limit:async()=>({data:list?data:[data],error:null}),
  };
}
function install({blocked=false,policyExpired=false,events=[]}={}){
  const oldFrom=supabase.from,oldRpc=supabase.rpc;
  const calls=[];
  supabase.from=(table)=>{
    switch(table){
      case 'dealer_approved_seed_links':return qb(blocked?null:link,{
        list:true,
      }).select=function(){return this};
      case 'dealer_research_claim_requests':
        return qb({claim_id:claimId,claimant_user_id:owner.userId,
          claim_status:'CLAIM_APPROVED'});
      case 'dealer_profiles':return qb(profile);
      case 'tenant_users':return qb({role:'dealer',user_id:owner.userId});
      case 'tenants':return qb({type:'dealership',status:'active'});
      case 'dealer_legal_application_reviews':
        return qb({legal_expires_at:future,country_code:'ZW',policy_version:'fixture'});
      case 'dealer_country_legal_policy_authority':
        return qb({policy_state:'APPROVED',effective_at:past,
          expires_at:policyExpired?past:future});
      case 'dealer_operational_declaration_events':return qb(events,{list:true});
      default:throw new Error('Unexpected table '+table);
    }
  };
  // The approved link is used once as a list and once as a single. See
  // list() implementation below for the different return shape.
  const base=supabase.from;
  supabase.from=(table)=>{
    if(table!=='dealer_approved_seed_links')return base(table);
    return {select(){return this},eq(){return this},
      limit:async()=>({data:blocked?[]:[link],error:null}),
      maybeSingle:async()=>({data:blocked?null:link,error:null})};
  };
  supabase.rpc=async(name,params)=>{
    calls.push([name,params]);
    return {data:{version:1,private_declaration_only:true,
      public_approved:false},error:null};
  };
  return {calls,restore(){supabase.from=oldFrom;supabase.rpc=oldRpc}};
}
test('C13 supported operating sections are canonical and refuse self-verified badges',()=>{
  assert.deepEqual(declaration.dealerOperationSections,[
    'BUSINESS_OVERVIEW','BUYER_ASSURANCE','FINANCE_TERMS','SOURCING',
    'WARRANTY_AFTERSALES','SERVICE_CAPABILITIES',
  ]);
  assert.throws(()=>declaration.normalizeDealerOperationDeclaration(
    'FINANCE_TERMS',{merchant_approved:true}),/UNAPPROVED_OPERATION_FIELD/);
  assert.throws(()=>declaration.normalizeDealerOperationDeclaration(
    'BUYER_ASSURANCE',{complaints_count:'0'}),/UNAPPROVED_OPERATION_FIELD/);
  assert.throws(()=>declaration.normalizeDealerOperationDeclaration(
    'WARRANTY_AFTERSALES',{warranty_scope:'<script>claim</script>'}),
    /UNSAFE_OPERATION_DECLARATION/);
  assert.throws(()=>declaration.normalizeDealerOperationDeclaration(
    'UNKNOWN',{foo:'bar'}),/UNSUPPORTED_DEALER_OPERATING_SECTION/);
  assert.deepEqual(declaration.normalizeDealerOperationDeclaration(
    'SERVICE_CAPABILITIES',{inspection_services:'  Onsite by appointment  ',buyer_support_hours:''}),
    {inspection_services:'Onsite by appointment'});
});
test('C13 unapproved claim cannot write owner-supplied policy into dealer tenant',async()=>{
  const ctx=install({blocked:true});
  try{
    await assert.rejects(declaration.recordMyOperationalDeclaration(owner,'BUYER_ASSURANCE',{
      expected_version:0,values:{refund_policy:'Unverified policy'},
    }),/NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP/);
    assert.equal(ctx.calls.length,0);
  }finally{ctx.restore()}
});
test('C13 expired country policy blocks every private operation and cannot silently reauthorize',async()=>{
  const ctx=install({policyExpired:true});
  try{
    await assert.rejects(declaration.recordMyOperationalDeclaration(owner,'SOURCING',{
      expected_version:0,values:{sourcing_channels:'Self-declared local sources'},
    }),/CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE/);
    assert.equal(ctx.calls.length,0);
  }finally{ctx.restore()}
});
test('C20 only real claim-linked ordinary-member tenant owner can record private buyer terms',async()=>{
  const ctx=install();
  try{
    const result=await declaration.recordMyOperationalDeclaration(owner,'BUYER_ASSURANCE',{
      expected_version:0,tenant_id:'spoofed',is_admin:true,
      values:{refund_policy:'Dealer-declared refund terms, subject to independent review',
        identity_status:'verified'},
    }).catch(error=>error);
    assert.match(result.message,/UNAPPROVED_OPERATION_FIELD/);
    assert.equal(ctx.calls.length,0);
    const allowed=await declaration.recordMyOperationalDeclaration(owner,'BUYER_ASSURANCE',{
      expected_version:0,tenant_id:'spoofed',
      values:{refund_policy:'Dealer-declared refund terms, subject to independent review'},
    });
    assert.equal(allowed.public_approved,false);
    assert.equal(ctx.calls.length,1);
    assert.equal(ctx.calls[0][0],'dealer_record_operational_declaration');
    assert.equal(ctx.calls[0][1].p_tenant_id,tenantId);
    assert.equal(ctx.calls[0][1].p_actor_id,owner.userId);
    assert.ok(!Object.hasOwn(ctx.calls[0][1],'is_admin'));
  }finally{ctx.restore()}
});
test('C21/C22 source only reflects private declaration and not measured financial statistics',async()=>{
  const ctx=install({events:[{section:'FINANCE_TERMS',section_version:2,
    declared_values:{deposit_terms:'Written contract required'},
    created_at:'2026-11-04T00:00:00Z'},
    {section:'FINANCE_TERMS',section_version:1,declared_values:{deposit_terms:'Superseded'},
    created_at:'2026-11-03T00:00:00Z'}]});
  try{
    const result=await declaration.listMyOperationalDeclarations(owner);
    assert.equal(result.latest.FINANCE_TERMS.version,2);
    assert.equal(result.latest.FINANCE_TERMS.public_approved,false);
    assert.equal(result.verified_complaint_count,null);
    assert.equal(result.measured_sales_revenue,null);
  }finally{ctx.restore()}
});
