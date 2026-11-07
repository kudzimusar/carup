import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-dealer-staff-key';
const {supabase}=await import('../db/supabase.js');
const staff=await import('../services/dealer/dealerStaffMembershipService.js');
const owner={userId:'fixture-owner',authenticationMethod:'session',
 platformRole:'member',isVerified:true};
const id='ee5a925c-e570-4c58-9d3d-4e08c3452a9f';
const claimId='5a5b9e7c-e24d-4c1e-8436-c5b6020a0a2d';
const profileId='c1863485-0f1c-4e30-9aae-f568c84dcbb8';
const tenantId='15ef3285-e907-4fa9-a92f-0a62455b3b9c';
const future=new Date(Date.now()+7*86400000).toISOString();
const past=new Date(Date.now()-86400000).toISOString();
const link={claim_id:claimId,seed_dealer_id:'ZW-DEAL-0001',
 dealer_profile_id:profileId,tenant_id:tenantId,
 organization_id:'fixture-org',operating_status:'ACTIVE',
 claimant_user_id:owner.userId,legal_review_id:'6d645cdf-a484-43b5-866f-49e48243b49a'};
const profile={active_state:'active',identity_status:'verified',
 compliance_review_state:'passed',restriction_state:'none',
 suspension_state:'none',investigation_state:'none',expiry_date:future};
function query(data,listed){
 return {select(){return this},eq(){return this},order(){return this},in(){return this},
  limit:async()=>({data:listed??[data],error:null}),
  maybeSingle:async()=>({data,error:null})};
}
function fake({policyExpired=false}={}){
 const originalFrom=supabase.from,originalRpc=supabase.rpc;
 const calls=[];
 supabase.from=table=>{
  switch(table){
   case 'dealer_approved_seed_links':
    return query(link,[link]);
   case 'dealer_research_claim_requests':
    return query({claim_id:claimId,claimant_user_id:owner.userId,
      claim_status:'CLAIM_APPROVED'});
   case 'dealer_profiles':return query(profile);
   case 'tenant_users':return query({role:'dealer',user_id:owner.userId},[
     {user_id:owner.userId,role:'dealer',joined_at:past},
   ]);
   case 'tenants':return query({type:'dealership',status:'active'});
   case 'dealer_legal_application_reviews':
    return query({legal_expires_at:future,country_code:'ZW',policy_version:'fixture'});
   case 'dealer_country_legal_policy_authority':
    return query({policy_state:'APPROVED',effective_at:past,
      expires_at:policyExpired?past:future});
   case 'dealer_staff_invitation_records':
    return query({invite_id:id,invited_user_id:'fixture-staff',
      status:'PENDING',requested_role:'member',created_at:past,expires_at:future},[
      {invite_id:id,invited_user_id:'fixture-staff',
       status:'PENDING',requested_role:'member',created_at:past,expires_at:future},
    ]);
   default:throw Error('Unexpected table '+table);
  }
 };
 supabase.rpc=async(name,params)=>{
  calls.push({name,params});
  return {data:{invite_id:id,status:'PENDING',permissions_granted:false},error:null};
 };
 return {calls,restore(){
  supabase.from=originalFrom;supabase.rpc=originalRpc;
 }};
}
test('C16 unsigned headers and fabricated admin role never create dealer staff grants',async()=>{
 const ctx=fake();
 try{
  await assert.rejects(staff.inviteDealerStaff({
    ...owner,authenticationMethod:'x-user-id-fallback',platformRole:'admin',
  },{invited_user_id:'fixture-staff'}),/REAL_SESSION_REQUIRED/);
  await assert.rejects(staff.inviteDealerStaff(owner,{
    invited_user_id:'fixture-staff',role:'admin',
  }),/ONLY_LIMITED_MEMBER_INVITATIONS_ALLOWED/);
  await assert.rejects(staff.inviteDealerStaff(owner,{
    invited_user_id:'fixture-staff',tenant_id:'spoofed',
  }),/CLIENT_AUTHORITY_IDENTIFIERS_NOT_ACCEPTED/);
  await assert.rejects(staff.inviteDealerStaff(owner,{
    invited_user_id:owner.userId,role:'member',
  }),/EXISTING_DISTINCT_STAFF_USER_ID_REQUIRED/);
  assert.equal(ctx.calls.length,0);
  const receipt=await staff.inviteDealerStaff(owner,{
    invited_user_id:'fixture-staff',role:'member',
  });
  assert.equal(receipt.permissions_granted,false);
  assert.equal(ctx.calls[0].name,'dealer_invite_existing_staff_account');
  assert.equal(ctx.calls[0].params.p_profile_id,profileId);
  assert.equal(ctx.calls[0].params.p_owner_id,owner.userId);
  assert.equal(ctx.calls[0].params.p_invited_user_id,'fixture-staff');
  assert.equal(Object.hasOwn(ctx.calls[0].params,'p_tenant_id'),false);
 }finally{ctx.restore()}
});
test('C16 expired country policy blocks staff invitation regardless of global actor role',async()=>{
 const ctx=fake({policyExpired:true});
 try{
  await assert.rejects(staff.inviteDealerStaff({
    ...owner,platformRole:'super_admin',
  },{invited_user_id:'fixture-staff'}),/CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE/);
  assert.equal(ctx.calls.length,0);
 }finally{ctx.restore()}
});
test('C16 invitation recipient acceptance is bound to own signed session and immutable invite ID',async()=>{
 const ctx=fake();
 try{
  await assert.rejects(staff.acceptDealerStaffInvitation(
    {...owner,authenticationMethod:'x-user-id-fallback'},id),
    /REAL_SESSION_REQUIRED/);
  await assert.rejects(staff.acceptDealerStaffInvitation(owner,'cross-tenant-bad-id'),
    /INVALID_STAFF_INVITATION_ID/);
  const result=await staff.acceptDealerStaffInvitation({
    userId:'fixture-staff',authenticationMethod:'session',platformRole:'member',
  },id);
  assert.equal(result.permissions_granted,false);
  assert.equal(ctx.calls[0].name,'dealer_accept_staff_invitation');
  assert.equal(ctx.calls[0].params.p_invited_actor_id,'fixture-staff');
 }finally{ctx.restore()}
});
test('C16 owner reads canonical real tenant_users and cannot revoke an unrelated invitation',async()=>{
 const ctx=fake();
 try{
  const result=await staff.listCanonicalDealerStaff(owner);
  assert.equal(result.members.length,1);
  assert.equal(result.members[0].role,'dealer');
  assert.equal(result.staff_listing_authority,false);
  assert.equal(result.branch_role_scope_not_configured,true);
  await staff.revokeDealerStaffInvitation(owner,id);
  assert.equal(ctx.calls[0].name,'dealer_revoke_staff_invitation');
  assert.equal(ctx.calls[0].params.p_owner_id,owner.userId);
  assert.equal(ctx.calls[0].params.p_invite_id,id);
 }finally{ctx.restore()}
});
