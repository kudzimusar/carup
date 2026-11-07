import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
const {getMyDealerMembershipSummary}=await import(
  '../services/dealer/dealerOperationsReadService.js');

const actor={userId:'dealer-1',authenticationMethod:'session',
  platformRole:'dealer',tenantId:'forged-tenant-id'};
const profile={id:'dealer-profile-1',user_id:'dealer-1',tenant_id:'canonical-tenant-7',
  identity_status:'verified',compliance_review_state:'passed',active_state:'active',
  restriction_state:'none',suspension_state:'none',investigation_state:'none',
  expiry_date:null};
const oldFrom=supabase.from;
function installMock({p=profile,member={role:'admin'},count=3,onQuery}={}){
  supabase.from=(table)=>{
    const state={filters:{},countOnly:false};
    const builder={
      select(_cols,opts){state.countOnly=Boolean(opts?.head);return this},
      eq(k,v){state.filters[k]=v;return this},
      maybeSingle:async()=>{
        onQuery?.(table,state);
        return {data:table==='dealer_profiles'?p:member,error:null};
      },
      then(onResolve,onReject){
        onQuery?.(table,state);
        return Promise.resolve({data:null,count,error:null}).then(onResolve,onReject);
      }
    };
    return builder;
  };
}
test('D7 unproven dev user header cannot view any canonical membership',async()=>{
  try{
    installMock();
    await assert.rejects(getMyDealerMembershipSummary({
      ...actor,authenticationMethod:'x-user-id-fallback'}),/REAL_SESSION_REQUIRED/);
  }finally{supabase.from=oldFrom}
});
test('D7 existing dealer profile without verified legal operating states cannot list tenant users',async()=>{
  const variations=[
    {...profile,tenant_id:null},
    {...profile,identity_status:'unverified'},
    {...profile,compliance_review_state:'in_review'},
    {...profile,active_state:'inactive'},
    {...profile,restriction_state:'restricted'},
    {...profile,suspension_state:'suspended'},
    {...profile,investigation_state:'under_investigation'},
    {...profile,expiry_date:'2020-01-01T00:00:00Z'},
  ];
  try{
    for(const p of variations){
      let queries=0;
      installMock({p,onQuery:()=>queries++});
      await assert.rejects(getMyDealerMembershipSummary(actor),
        /NO_APPROVED_OPERATIONAL_TENANT/);
      assert.equal(queries,1,'must stop before any tenant_users query');
    }
  }finally{supabase.from=oldFrom}
});
test('D7 a forged tenant header never selects the staff roster of another tenant',async()=>{
  const seen=[];
  try{
    installMock({onQuery:(table,state)=>seen.push({table,filters:{...state.filters},
      countOnly:state.countOnly})});
    const output=await getMyDealerMembershipSummary(actor);
    assert.equal(output.state,'CANONICAL_MEMBERSHIP_OBSERVED');
    assert.equal(output.recorded_tenant_member_count,3);
    assert.equal(output.live_staff_count,null);
    assert.equal(output.sales_count,null);
    assert.equal(output.completed_sales_value,null);
    assert.equal(output.tenant_activated_by_this_read,false);
    assert.equal(output.role_changes_performed,false);
    assert.equal(seen.length,3);
    assert.equal(seen[0].filters.user_id,'dealer-1');
    for(const x of seen.slice(1)){
      assert.equal(x.filters.tenant_id,'canonical-tenant-7');
      assert.notEqual(x.filters.tenant_id,actor.tenantId);
    }
    assert.equal(seen[1].filters.user_id,'dealer-1');
    assert.equal(seen[2].countOnly,true);
  }finally{supabase.from=oldFrom}
});
test('D7 missing account membership refuses even an apparently verified dealer profile',async()=>{
  try{
    installMock({member:null});
    await assert.rejects(getMyDealerMembershipSummary(actor),
      /CANONICAL_TENANT_MEMBERSHIP_REQUIRED/);
  }finally{supabase.from=oldFrom}
});
test('D7 no authoritative exact membership count is not misleadingly shown as zero',async()=>{
  try{
    installMock({count:null});
    await assert.rejects(getMyDealerMembershipSummary(actor),
      /CANONICAL_MEMBERSHIP_COUNT_UNAVAILABLE/);
  }finally{supabase.from=oldFrom}
});
test('D7 unknown/cross-account dealer and nondealer platform role fail closed',async()=>{
  try{
    installMock({p:null});
    await assert.rejects(getMyDealerMembershipSummary(actor),
      /NO_CANONICAL_DEALER_PROFILE/);
    await assert.rejects(getMyDealerMembershipSummary({...actor,platformRole:'buyer'}),
      /OPERATIONAL_DEALER_ROLE_REQUIRED/);
  }finally{supabase.from=oldFrom}
});
