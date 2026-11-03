/**
 * CARUP-DEALER-ONB-001 D7: read-only, canonical tenant membership statistics.
 * No parallel staff registry, no role writes, no people/contact enumeration and
 * no derived sales/revenue fiction. The authoritative tenant and membership
 * are resolved server-side from the already provisioned dealer profile.
 */
import {supabase} from '../../db/supabase.js';
import {requireClaimantSession} from './dealerClaimApplicationService.js';

const deny=(code,status=403)=>Object.assign(new Error(code),{statusCode:status});
export async function getMyDealerMembershipSummary(actor){
  requireClaimantSession(actor);
  if(!['dealer','admin','platform_admin','super_admin'].includes(actor.platformRole))
    throw deny('OPERATIONAL_DEALER_ROLE_REQUIRED');
  const {data:profile,error:profileError}=await supabase.from('dealer_profiles')
    .select('id,user_id,tenant_id,identity_status,compliance_review_state,active_state,restriction_state,suspension_state,investigation_state,expiry_date')
    .eq('user_id',actor.userId).maybeSingle();
  if(profileError)throw deny('DEALER_PROFILE_LOOKUP_UNAVAILABLE',503);
  if(!profile)throw deny('NO_CANONICAL_DEALER_PROFILE',404);
  if(!profile.tenant_id||profile.identity_status!=='verified'||
    profile.compliance_review_state!=='passed'||
    profile.active_state!=='active'||
    profile.restriction_state!=='none'||
    profile.suspension_state!=='none'||
    profile.investigation_state!=='none'||
    (profile.expiry_date&&(!Number.isFinite(new Date(profile.expiry_date).getTime())||
      new Date(profile.expiry_date).getTime()<=Date.now())))
    throw deny('NO_APPROVED_OPERATIONAL_TENANT',403);

  // An existing tenant_id on a dealer profile alone does not prove that the
  // authenticated account currently belongs to that canonical tenant.
  const {data:member,error:membershipError}=await supabase.from('tenant_users')
    .select('role').eq('tenant_id',profile.tenant_id)
    .eq('user_id',actor.userId).maybeSingle();
  if(membershipError||!member)throw deny('CANONICAL_TENANT_MEMBERSHIP_REQUIRED',403);
  const {count,error}=await supabase.from('tenant_users')
    .select('user_id',{head:true,count:'exact'})
    .eq('tenant_id',profile.tenant_id);
  if(error||!Number.isInteger(count)||count<1)
    throw deny('CANONICAL_MEMBERSHIP_COUNT_UNAVAILABLE',503);

  return Object.freeze({
    state:'CANONICAL_MEMBERSHIP_OBSERVED',
    dealer_id:profile.id,
    recorded_tenant_member_count:count,
    counted_from:'tenant_users',
    live_staff_count:null,
    sales_count:null,
    completed_sales_value:null,
    tenant_activated_by_this_read:false,
    role_changes_performed:false,
  });
}
