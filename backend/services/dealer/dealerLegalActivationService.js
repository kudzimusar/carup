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
  const [{data:allCases,error:caseError},{data:decided,error:decidedError}]=await Promise.all([
    supabase.from('dealer_claim_compliance_submissions')
      .select('submission_id,claim_id,claimant_user_id,intake_version,submitted_at,application_snapshot')
      .in('submission_id',ids).limit(100),
    supabase.from('dealer_legal_application_reviews').select('submission_id').in('submission_id',ids).limit(100),
  ]);
  if(caseError||decidedError)throw deny('LEGAL_APPLICATION_LOOKUP_UNAVAILABLE',503);
  // A case that already has an independent legal review is no longer pending.
  const finished=new Set((Array.isArray(decided)?decided:[]).map(x=>x.submission_id));
  const cases=(allCases||[]).filter(c=>!finished.has(c.submission_id));
  const preliminary=new Map(events.map(x=>[x.submission_id,x]));
  // R6 functional: a real legal reviewer must be able to PICK the evidence records and
  // recognise the dealership — never type a UUID shown nowhere. Reviewer-only route;
  // no storage path, signed link or file content is returned here.
  const claimIds=[...new Set((cases||[]).map(c=>c.claim_id))];
  const [{data:claims,error:claimError},{data:evidence,error:evidenceError}]=claimIds.length?await Promise.all([
    supabase.from('dealer_research_claim_requests').select('claim_id,seed_dealer_id').in('claim_id',claimIds),
    supabase.from('dealer_claim_private_evidence')
      .select('evidence_id,claim_id,document_class,mime_type,file_bytes,created_at')
      .in('claim_id',claimIds).order('created_at',{ascending:false}).limit(500),
  ]):[{data:[]},{data:[]}];
  if(claimError||evidenceError)throw deny('LEGAL_APPLICATION_LOOKUP_UNAVAILABLE',503);
  const seedByClaim=new Map((claims||[]).map(c=>[c.claim_id,c.seed_dealer_id]));
  // A reviewer who holds a claim on the same business never sees its case or evidence metadata.
  const {data:ownClaims,error:ownClaimError}=await supabase.from('dealer_research_claim_requests')
    .select('seed_dealer_id').eq('claimant_user_id',actor.userId).limit(500);
  if(ownClaimError)throw deny('LEGAL_APPLICATION_LOOKUP_UNAVAILABLE',503);
  const conflictedSeeds=new Set((Array.isArray(ownClaims)?ownClaims:[]).map(c=>c?.seed_dealer_id).filter(Boolean));
  const declaredName=(snapshot)=>{
    const v=snapshot?.tab_rows?.BUSINESS?.[0]?.legal_name;
    return typeof v==='string'&&v.trim()?v.trim().slice(0,180):null;
  };
  return cases.filter(row=>row.claimant_user_id!==actor.userId&&
      !conflictedSeeds.has(seedByClaim.get(row.claim_id))).map(row=>({
    submission_id:row.submission_id,claim_id:row.claim_id,
    seed_dealer_id:seedByClaim.get(row.claim_id)||null,
    declared_legal_name:declaredName(row.application_snapshot),
    evidence:(evidence||[]).filter(e=>e.claim_id===row.claim_id).map(e=>({
      evidence_id:e.evidence_id,document_class:e.document_class,mime_type:e.mime_type,
      file_bytes:e.file_bytes,uploaded_at:e.created_at,
    })),
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
  if(!link)return {
    state:'NOT_YET_ACTIVATED',tenant_id:null,operational:false,
    claim_status:claim.claim_status};
  // R6 functional: an activated dealer must SEE suspension/withdrawal and what happens next.
  // Categories only — an independent reviewer's free-text reason is never shown to the dealer.
  if(link.operating_status==='SUSPENDED')return {
    state:'DEALER_OPERATIONS_SUSPENDED',tenant_id:null,operational:false,
    claim_status:claim.claim_status,operating_status:'SUSPENDED',
    blocking_reasons:['SUSPENDED_BY_INDEPENDENT_REVIEW'],
    next_step:'REINSTATEMENT_BY_A_DIFFERENT_INDEPENDENT_REVIEWER'};
  if(link.operating_status==='WITHDRAWN')return {
    state:'DEALER_OPERATIONS_WITHDRAWN',tenant_id:null,operational:false,
    claim_status:claim.claim_status,operating_status:'WITHDRAWN',
    blocking_reasons:['PERMANENTLY_WITHDRAWN'],
    next_step:'INDEPENDENT_TRANSFER_OR_DISPUTE_REVIEW_REQUIRED'};
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
  }:blockedAuthority({d,m,t,l,policyValid});
}
// Which canonical gate is not current, and the governed path back (renewal = a newer
// application → preliminary review → separate legal review → lifecycle RENEW).
function blockedAuthority({d,m,t,l,policyValid}){
  const now=Date.now(),reasons=[];
  const legalExpired=!l||new Date(l.legal_expires_at).getTime()<=now;
  if(legalExpired)reasons.push('LEGAL_REVIEW_EXPIRED');
  else if(!policyValid)reasons.push('COUNTRY_POLICY_NOT_CURRENT');
  // An open investigation is NOT named to the dealer (no tip-off); explicit disclosure is Owner decision O14.
  if(d?.investigation_state&&d.investigation_state!=='none')reasons.push('UNDER_INDEPENDENT_REVIEW');
  if(d?.restriction_state&&d.restriction_state!=='none')reasons.push('RESTRICTED_BY_INDEPENDENT_REVIEW');
  if(d?.suspension_state&&d.suspension_state!=='none')reasons.push('SUSPENDED_BY_INDEPENDENT_REVIEW');
  if(!d?.expiry_date||new Date(d.expiry_date).getTime()<=now)reasons.push('DEALER_AUTHORITY_EXPIRED');
  if(!['dealer','admin'].includes(m?.role))reasons.push('OWNER_MEMBERSHIP_NOT_CURRENT');
  if(t?.type!=='dealership'||t?.status!=='active')reasons.push('TENANT_NOT_ACTIVE');
  const renewal=reasons.some(r=>r==='LEGAL_REVIEW_EXPIRED'||r==='DEALER_AUTHORITY_EXPIRED');
  return {state:'DEALER_AUTHORITY_BLOCKED',tenant_id:null,operational:false,
    blocking_reasons:reasons.length?reasons:['CANONICAL_AUTHORITY_NOT_CURRENT'],
    legal_expires_at:l?.legal_expires_at??null,
    next_step:renewal?'SUBMIT_UPDATED_APPLICATION_FOR_RENEWAL':'WAIT_FOR_INDEPENDENT_REVIEW_OUTCOME'};
}
/**
 * Claimant-facing status = the PURE authority read (also used to gate the owner workspace, so it
 * stays free of extra lookups) + a truthful listing state for a dealer that cannot operate: the data
 * layer withdraws synchronously on suspension/withdrawal, but a pure time lapse is withdrawn by the
 * scheduled sweep — never claim "withdrawn" while a listing is still public.
 */
export async function readMyOperationalDealerStatus(claimId,actor){
  const authority=await readMyOperationalDealerAuthority(claimId,actor);
  if(authority.operational||!Array.isArray(authority.blocking_reasons))return authority;
  const {data:link,error}=await supabase.from('dealer_approved_seed_links').select('tenant_id')
    .eq('claim_id',claimId).eq('claimant_user_id',actor.userId).maybeSingle();
  if(error||!link?.tenant_id)return {...authority,public_listings_withdrawn:null,public_listings_withdrawal_pending:null};
  return {...authority,...(await publicListingState(link.tenant_id))};
}
async function publicListingState(tenantId){
  const {data,error}=await supabase.from('vehicles').select('vin')
    .eq('tenant_id',tenantId).eq('publication_status','published').limit(1);
  if(error||!Array.isArray(data))return {public_listings_withdrawn:null,public_listings_withdrawal_pending:null};
  return {public_listings_withdrawn:data.length===0,public_listings_withdrawal_pending:data.length>0};
}
