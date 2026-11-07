/**
 * CARUP-DEALER-ONB-001 C08–C12: independent legal certification and canonical
 * dealership activation. NEVER an applicant self-service approval.
 *
 * The SQL bridge is disabled until an approved country-policy authority exists.
 * A draft policy is not approvable by this API and no paid plan confers rights.
 */
import {supabase} from '../../db/supabase.js';
import {throwIfDealerSecurityRefusal} from './dealerSqlRefusalMapper.js';
import {requireClaimantSession,requireIndependentReviewer,
  requireReviewerPassword} from './dealerClaimApplicationService.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(code,status=403)=>Object.assign(new Error(code),{code,statusCode:status});
const requireUuid=id=>{
  if(typeof id!=='string'||!UUID.test(id))throw deny('INVALID_LEGAL_CASE_REFERENCE',400);
  return id;
};
async function readLegalCase(submissionId,actor){
  requireUuid(submissionId);
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,claim_id,claimant_user_id,intake_version,submitted_at')
    .eq('submission_id',submissionId).maybeSingle();
  if(error)throw deny('LEGAL_APPLICATION_LOOKUP_UNAVAILABLE',503);
  if(!data)throw deny('LEGAL_APPLICATION_NOT_FOUND',404);
  requireIndependentReviewer(actor,data.claimant_user_id);
  return data;
}
async function readLegalDecision(reviewId,actor){
  requireUuid(reviewId);
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_legal_application_reviews')
    .select('legal_review_id,submission_id,claimant_user_id,reviewer_user_id,policy_version,legal_expires_at')
    .eq('legal_review_id',reviewId).maybeSingle();
  if(error)throw deny('LEGAL_DECISION_LOOKUP_UNAVAILABLE',503);
  if(!data)throw deny('LEGAL_DECISION_NOT_FOUND',404);
  requireIndependentReviewer(actor,data.claimant_user_id);
  if(data.reviewer_user_id===actor.userId)
    throw deny('LEGAL_REVIEWER_CANNOT_ACTIVATE_OWN_CASE');
  return data;
}
export async function listLegalCountryPolicyReadiness(actor){
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_country_legal_policy_authority')
    .select('country_code,policy_version,policy_state,effective_at,expires_at')
    .order('country_code',{ascending:true}).limit(50);
  if(error)throw deny('COUNTRY_POLICY_LOOKUP_UNAVAILABLE',503);
  return (data||[]).map(p=>({
    ...p,eligibility:p.policy_state==='APPROVED'&&
      p.effective_at&&p.expires_at&&
      new Date(p.effective_at).getTime()<=Date.now()&&
      new Date(p.expires_at).getTime()>Date.now()?
        'REQUIRES_INDEPENDENT_CASE_REVIEW':'ACTIVATION_DISABLED',
    activated_entities_by_this_read:0,
  }));
}
export async function listPendingLegalDealershipCases(actor){
  requireIndependentReviewer(actor,'');
  const {data:events,error:eventError}=await supabase.from('dealer_claim_compliance_review_events')
    .select('submission_id,reviewer_user_id,verdict,created_at')
    .eq('verdict','READY_FOR_REGULATORY_REVIEW').order('created_at',{ascending:false})
    .limit(100);
  if(eventError)throw deny('LEGAL_REVIEW_QUEUE_UNAVAILABLE',503);
  if(!(events||[]).length)return [];
  const ids=events.map(x=>x.submission_id);
  const {data:cases,error:caseError}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,claim_id,claimant_user_id,intake_version,submitted_at')
    .in('submission_id',ids).limit(100);
  if(caseError)throw deny('LEGAL_APPLICATION_LOOKUP_UNAVAILABLE',503);
  const preliminary=new Map(events.map(x=>[x.submission_id,x]));
  return (cases||[]).map(row=>({
    submission_id:row.submission_id,claim_id:row.claim_id,
    intake_version:row.intake_version,submitted_at:row.submitted_at,
    separate_legal_reviewer_required:preliminary.get(row.submission_id)?.reviewer_user_id!==actor.userId,
    independent_legal_and_policy_evidence_required:true,
    compliance_approved:false,tenant_activated:false,
  }));
}
/**
 * Separate activation approver queue; no original documents, claimant tax,
 * bank data or private source snapshot are exposed here.
 */
export async function listPendingLegalDealerActivations(actor){
  requireIndependentReviewer(actor,'');
  const {data:rows,error}=await supabase.from('dealer_legal_application_reviews')
    .select('legal_review_id,submission_id,claimant_user_id,reviewer_user_id,country_code,policy_version,legal_expires_at,created_at')
    .eq('verdict','COMPLIANCE_APPROVED')
    .order('created_at',{ascending:false}).limit(100);
  if(error)throw deny('LEGAL_ACTIVATION_QUEUE_UNAVAILABLE',503);
  return (rows||[]).map(row=>({
    legal_review_id:row.legal_review_id,
    submission_id:row.submission_id,
    country_code:row.country_code,policy_version:row.policy_version,
    legal_expires_at:row.legal_expires_at,created_at:row.created_at,
    independent_activator_required:actor.userId!==row.claimant_user_id&&
      actor.userId!==row.reviewer_user_id,
  }));
}
export async function certifyLegalDealerCase(submissionId,actor,payload={}){
  const meta=await readLegalCase(submissionId,actor);
  await requireReviewerPassword(actor,{claimant_user_id:meta.claimant_user_id},
    payload.reviewer_password);
  const evidence=[payload.company_registration_evidence_id,payload.signatory_evidence_id];
  if(evidence.some(id=>typeof id!=='string'||!UUID.test(id))||evidence[0]===evidence[1])
    throw deny('TWO_DISTINCT_ORIGINAL_DOCUMENTS_REQUIRED',400);
  if(payload.approved_scope!=='BRANCH'&&payload.approved_scope!=='PARENT_ORGANIZATION')
    throw deny('LEGAL_SCOPE_REQUIRED',400);
  if(typeof payload.country_policy_version!=='string'||payload.country_policy_version.length>90||
     typeof payload.verified_issuer!=='string'||payload.verified_issuer.trim().length<3||
     typeof payload.reviewed_registration_number!=='string'||
       payload.reviewed_registration_number.trim().length<2||
     typeof payload.reason!=='string'||payload.reason.trim().length<80||
       payload.reason.length>3000||
     typeof payload.legal_expires_at!=='string'||
       !Number.isFinite(new Date(payload.legal_expires_at).getTime())||
       new Date(payload.legal_expires_at).getTime()<=Date.now())
    throw deny('INCOMPLETE_LEGAL_CASE_EVIDENCE',400);
  // SQL checks approved-current policy, frozen original evidence, two independent
  // reviewers, issuer/number/scope, exact source and claim, and concurrent claims.
  const {data,error}=await supabase.rpc('dealer_record_legal_application_approval',{
    p_submission_id:meta.submission_id,p_reviewer_id:actor.userId,
    p_policy_version:payload.country_policy_version,
    p_company_evidence_id:evidence[0],p_signatory_evidence_id:evidence[1],
    p_issuer:payload.verified_issuer.trim(),
    p_registration_number:payload.reviewed_registration_number.trim(),
    p_scope:payload.approved_scope,p_expires_at:payload.legal_expires_at,
    p_reason:payload.reason.trim(),
  });
  if(error){throwIfDealerSecurityRefusal(error);throw deny('LEGAL_COUNTRY_POLICY_OR_CASE_AUTHORITY_BLOCKED',409);}
  return data;
}
export async function activateLegallyApprovedDealer(reviewId,actor,payload={}){
  const decision=await readLegalDecision(reviewId,actor);
  await requireReviewerPassword(actor,{claimant_user_id:decision.claimant_user_id},
    payload.reviewer_password);
  if(typeof payload.activation_reason!=='string'||
      payload.activation_reason.trim().length<80||payload.activation_reason.length>3000)
    throw deny('INDEPENDENT_ACTIVATION_REASON_REQUIRED',400);
  const {data,error}=await supabase.rpc('dealer_activate_approved_legal_claim',{
    p_legal_review_id:decision.legal_review_id,
    p_approver_id:actor.userId,
    p_activation_reason:payload.activation_reason.trim(),
  });
  if(error){throwIfDealerSecurityRefusal(error);throw deny('CANONICAL_ACTIVATION_GATES_NOT_MET',409);}
  return data;
}
export async function readMyOperationalDealerAuthority(claimId,actor){
  requireClaimantSession(actor);
  requireUuid(claimId);
  const {data:claim,error:claimError}=await supabase.from('dealer_research_claim_requests')
    .select('claim_id,claimant_user_id,claim_status')
    .eq('claim_id',claimId).maybeSingle();
  if(claimError)throw deny('CLAIM_LOOKUP_UNAVAILABLE',503);
  if(!claim||claim.claimant_user_id!==actor.userId)
    throw deny('CLAIM_NOT_FOUND',404);
  if(claim.claim_status!=='CLAIM_APPROVED')return {
    state:'NOT_AUTHORIZED',tenant_id:null,operational:false,
    claim_status:claim.claim_status};
  const {data:link,error:linkError}=await supabase.from('dealer_approved_seed_links')
    .select('organization_id,tenant_id,dealer_profile_id,operating_status,legal_review_id')
    .eq('claim_id',claimId).eq('claimant_user_id',actor.userId).maybeSingle();
  if(linkError)throw deny('DEALER_LINK_LOOKUP_UNAVAILABLE',503);
  if(!link||link.operating_status!=='ACTIVE')return {
    state:'NOT_YET_ACTIVATED',tenant_id:null,operational:false,
    claim_status:claim.claim_status};
  const [profileResult,memberResult,tenantResult,legalResult]=await Promise.all([
    supabase.from('dealer_profiles').select('identity_status,compliance_review_state,active_state,restriction_state,suspension_state,investigation_state,expiry_date')
      .eq('id',link.dealer_profile_id).eq('user_id',actor.userId).maybeSingle(),
    supabase.from('tenant_users').select('role')
      .eq('tenant_id',link.tenant_id).eq('user_id',actor.userId).maybeSingle(),
    supabase.from('tenants').select('type,status')
      .eq('id',link.tenant_id).maybeSingle(),
    supabase.from('dealer_legal_application_reviews')
      .select('legal_expires_at,country_code,policy_version')
      .eq('legal_review_id',link.legal_review_id).maybeSingle(),
  ]);
  if([profileResult,memberResult,tenantResult,legalResult].some(x=>x.error))
    throw deny('DEALER_CANONICAL_AUTHORITY_UNAVAILABLE',503);
  const d=profileResult.data,m=memberResult.data,t=tenantResult.data,l=legalResult.data;
  let policyValid=false;
  if(l){
    const {data:p,error}=await supabase.from('dealer_country_legal_policy_authority')
      .select('policy_state,effective_at,expires_at')
      .eq('country_code',l.country_code).eq('policy_version',l.policy_version).maybeSingle();
    if(error)throw deny('COUNTRY_POLICY_UNAVAILABLE',503);
    policyValid=p?.policy_state==='APPROVED'&&
      new Date(p.effective_at).getTime()<=Date.now()&&
      new Date(p.expires_at).getTime()>Date.now()&&
      new Date(l.legal_expires_at).getTime()>Date.now();
  }
  const authorized=Boolean(policyValid&&t?.type==='dealership'&&t.status==='active'&&
    ['dealer','admin'].includes(m?.role)&&d?.identity_status==='verified'&&
    d?.compliance_review_state==='passed'&&d?.active_state==='active'&&
    d?.restriction_state==='none'&&d?.suspension_state==='none'&&
    d?.investigation_state==='none'&&
    new Date(d.expiry_date).getTime()>Date.now());
  return authorized?{
    state:'CANONICAL_DEALER_ACTIVE',organization_id:link.organization_id,
    tenant_id:link.tenant_id,dealer_profile_id:link.dealer_profile_id,
    tenant_member_role:m.role,operational:true,company_claim_verified:true,
    public_storefront_approved:false,vehicle_listing_authority_granted:false,
  }:{state:'DEALER_AUTHORITY_BLOCKED',tenant_id:null,operational:false};
}
