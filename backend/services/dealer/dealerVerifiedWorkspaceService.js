/**
 * CARUP-DEALER-ONB-001 D7 — active claim-linked canonical dealership owner
 * workspace. Global user.role is deliberately NOT an authorization criterion:
 * legal activation preserves ordinary member roles. The actual legal/tenant/
 * organization/member authority is checked on every request.
 */
import {supabase} from '../../db/supabase.js';
import {requireClaimantSession} from './dealerClaimApplicationService.js';
import {readMyOperationalDealerAuthority} from './dealerLegalActivationService.js';
const refuse=(code,status=403)=>Object.assign(new Error(code),{statusCode:status,code});
const clean=(v,max=180)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max
  ?v.trim():null;
export async function requireApprovedOwnerWorkspace(actor){
  requireClaimantSession(actor);
  const {data:links,error:linkError}=await supabase.from('dealer_approved_seed_links')
    .select('claim_id,seed_dealer_id,tenant_id,dealer_profile_id,organization_id')
    .eq('claimant_user_id',actor.userId).eq('operating_status','ACTIVE').limit(2);
  if(linkError)throw refuse('APPROVED_DEALER_LINK_UNAVAILABLE',503);
  if(!links?.length)throw refuse('NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP',404);
  if(links.length!==1)throw refuse('MULTIPLE_DEALERS_REQUIRE_EXPLICIT_TENANT_SELECTION',409);
  const link=links[0];
  const authority=await readMyOperationalDealerAuthority(link.claim_id,actor);
  if(!authority.operational||authority.tenant_id!==link.tenant_id||
    authority.dealer_profile_id!==link.dealer_profile_id)
    throw refuse('CANONICAL_DEALER_AUTHORITY_NOT_ACTIVE');
  return Object.freeze({actor_id:actor.userId,claim_id:link.claim_id,
    seed_dealer_id:link.seed_dealer_id,tenant_id:link.tenant_id,
    organization_id:link.organization_id,dealer_profile_id:link.dealer_profile_id,
    owner_membership_confirmed:true});
}
export async function getMyVerifiedDealerWorkspace(actor){
  const authority=await requireApprovedOwnerWorkspace(actor);
  const [profileResult,branchesResult,memberResult]=await Promise.all([
    supabase.from('dealer_profiles')
      .select('id,legal_name,trading_name,registration_number,operating_country,tenant_id,identity_status,compliance_review_state,active_state,restriction_state,suspension_state,investigation_state,expiry_date,updated_at')
      .eq('id',authority.dealer_profile_id).eq('user_id',actor.userId).maybeSingle(),
    supabase.from('dealer_branches')
      .select('id,dealer_id,name,address,created_at')
      .eq('dealer_id',authority.dealer_profile_id).order('created_at',{ascending:true}).limit(100),
    supabase.from('tenant_users').select('user_id',{head:true,count:'exact'})
      .eq('tenant_id',authority.tenant_id),
  ]);
  if(profileResult.error||!profileResult.data||branchesResult.error||
    memberResult.error||!Number.isInteger(memberResult.count)||memberResult.count<1)
    throw refuse('CANONICAL_DEALER_WORKSPACE_READ_UNAVAILABLE',503);
  return {...authority,operational:true,
    profile:profileResult.data,branches:branchesResult.data||[],
    recorded_tenant_member_count:memberResult.count,
    current_staff_headcount:null,actual_revenue:null,
    public_verified_badge:false,vehicle_listing_authority:false,
    no_unverified_metrics_generated:true};
}
/**
 * An active approved owner may add a PRIVATE declaration of a branch. It does
 * not qualify a new public approved branch or inherit an OEM licence.
 */
export async function addDeclaredDealerBranch(actor,payload={}){
  const authority=await requireApprovedOwnerWorkspace(actor);
  const name=clean(payload.name,180),address=clean(payload.address,400);
  if(!name||!address)throw refuse('BRANCH_NAME_AND_ADDRESS_REQUIRED',400);
  const {data,error}=await supabase.from('dealer_branches')
    .insert({dealer_id:authority.dealer_profile_id,name,address})
    .select('id,dealer_id,name,address,created_at').single();
  if(error)throw refuse('CANONICAL_BRANCH_WRITE_UNAVAILABLE',503);
  return {...data,public_verified:false,private_declaration_only:true};
}
