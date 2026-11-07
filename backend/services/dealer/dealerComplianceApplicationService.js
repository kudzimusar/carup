/**
 * CARUP-DEALER-ONB-001 D6 — private applicant submission and separate, non-
 * approving preliminary compliance review. Never provisions a tenant, staff
 * membership, licence, payment entitlement, dealer profile or public badge.
 */
import {supabase} from '../../db/supabase.js';
import {throwIfDealerSecurityRefusal} from './dealerSqlRefusalMapper.js';
import {assertReviewerNotConflicted,loadReviewerConflicts} from './dealerReviewerConflicts.js';
import {requireClaimantSession,requireIndependentReviewer,
  requireReviewerPassword} from './dealerClaimApplicationService.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTESTATION_VERSION='CARUP_DEALER_APPLICANT_DECLARATION_1';
const OUTCOMES=new Set(['NEEDS_CORRECTIONS','EVIDENCE_REQUIRED','READY_FOR_REGULATORY_REVIEW']);
function fail(code,status=400){return Object.assign(new Error(code),{statusCode:status,code});}
function assertId(id){if(typeof id!=='string'||!UUID.test(id))throw fail('INVALID_APPLICATION_REFERENCE');return id;}
async function ownerClaim(claimId,actor){
  requireClaimantSession(actor);assertId(claimId);
  const {data,error}=await supabase.from('dealer_research_claim_requests')
    .select('claim_id,claimant_user_id,claim_status')
    .eq('claim_id',claimId).maybeSingle();
  if(error)throw fail('CLAIM_LOOKUP_UNAVAILABLE',503);
  if(!data||data.claimant_user_id!==actor.userId)throw fail('CLAIM_NOT_FOUND',404);
  if(data.claim_status!=='CLAIM_APPROVED')throw fail('CLAIM_APPROVAL_REQUIRED',403);
  return data;
}
async function reviewerSubmission(submissionId,actor){
  assertId(submissionId);
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,claim_id,claimant_user_id,intake_version,submitted_at')
    .eq('submission_id',submissionId).maybeSingle();
  if(error)throw fail('PRELIMINARY_CASE_LOOKUP_UNAVAILABLE',503);
  if(!data)throw fail('COMPLIANCE_CASE_NOT_FOUND',404);
  requireIndependentReviewer(actor,data.claimant_user_id);
  return data;
}
export async function submitDealerApplication(claimId,actor,payload={}){
  const claim=await ownerClaim(claimId,actor);
  const version=payload.expected_version;
  if(!Number.isInteger(version)||version<1)throw fail('EXPECTED_DRAFT_VERSION_REQUIRED');
  if(payload.attestation_version!==ATTESTATION_VERSION||
    payload.acknowledge_applicant_declaration!==true)throw fail('EXPLICIT_APPLICANT_ATTESTATION_REQUIRED');
  const {data,error}=await supabase.rpc('dealer_submit_compliance_application',{
    p_claim_id:claim.claim_id,p_claimant_id:actor.userId,
    p_expected_version:version,
    p_attestation_version:ATTESTATION_VERSION,p_attestation_acknowledged:true,
  });
  if(error)throw fail('APPLICATION_SUBMISSION_REQUIREMENTS_NOT_MET',409);
  return data;
}
export async function listMyDealerApplicationSubmissions(claimId,actor){
  const claim=await ownerClaim(claimId,actor);
  const {data,error}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,intake_version,schema_version,submitted_at,snapshot_sha256')
    .eq('claim_id',claim.claim_id).eq('claimant_user_id',actor.userId)
    .order('submitted_at',{ascending:false}).limit(50);
  if(error)throw fail('APPLICATION_RECEIPTS_UNAVAILABLE',503);
  const submissions=data||[];
  if(!submissions.length)return [];
  const ids=submissions.map(s=>s.submission_id);
  const {data:reviews,error:reviewsError}=await supabase.from('dealer_claim_compliance_review_events')
    .select('submission_id,verdict,decision_reason,created_at')
    .in('submission_id',ids).limit(50);
  if(reviewsError)throw fail('PRIVATE_PRELIMINARY_FINDINGS_UNAVAILABLE',503);
  const byId=new Map((reviews||[]).map(x=>[x.submission_id,x]));
  return submissions.map(s=>{
    const review=byId.get(s.submission_id);
    return {...s,preliminary_status:review?.verdict||'AWAITING_PRELIMINARY_REVIEW',
      correction_reason:review?.verdict==='NEEDS_CORRECTIONS'||review?.verdict==='EVIDENCE_REQUIRED'
        ?review.decision_reason:null,
      reviewed_at:review?.created_at||null,
      company_verified:false,legal_compliance_approved:false,tenant_activated:false};
  });
}
export async function listDealerComplianceReviewQueue(actor){
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,claim_id,intake_version,submitted_at,claimant_user_id')
    .order('submitted_at',{ascending:false}).limit(100);
  if(error)throw fail('COMPLIANCE_REVIEW_QUEUE_UNAVAILABLE',503);
  // R6 closure: cases on a business the reviewer claims or works for are not listed.
  const claimIds=[...new Set((data||[]).map(s=>s.claim_id))];
  const {data:claims,error:claimError}=claimIds.length?await supabase.from('dealer_research_claim_requests')
    .select('claim_id,seed_dealer_id').in('claim_id',claimIds).limit(200):{data:[]};
  if(claimError)throw fail('COMPLIANCE_REVIEW_QUEUE_UNAVAILABLE',503);
  const seedByClaim=new Map((Array.isArray(claims)?claims:[]).map(c=>[c.claim_id,c.seed_dealer_id]));
  const conflicts=await loadReviewerConflicts(actor);
  // Queue contains no private workbook/legal snapshot, and no secure document links.
  return (data||[]).filter(s=>!conflicts.conflicted(seedByClaim.get(s.claim_id))).map(s=>({
    submission_id:s.submission_id,claim_id:s.claim_id,
    intake_version:s.intake_version,submitted_at:s.submitted_at,
    independent_review_required:s.claimant_user_id!==actor.userId,
  }));
}
export async function previewDealerComplianceCase(submissionId,actor,password){
  const meta=await reviewerSubmission(submissionId,actor);
  // R6 closure: no frozen application snapshot for a reviewer who claims the business or
  // works for its dealership — refused before any step-up attempt is spent.
  const {data:claim,error:claimError}=await supabase.from('dealer_research_claim_requests')
    .select('seed_dealer_id').eq('claim_id',meta.claim_id).maybeSingle();
  if(claimError||!claim)throw fail('PRELIMINARY_CASE_LOOKUP_UNAVAILABLE',503);
  await assertReviewerNotConflicted(actor,claim.seed_dealer_id);
  await requireReviewerPassword(actor,{claimant_user_id:meta.claimant_user_id},password);
  const {data,error}=await supabase.from('dealer_claim_compliance_submissions')
    .select('submission_id,claim_id,intake_version,submitted_at,schema_version,application_snapshot,snapshot_sha256')
    .eq('submission_id',meta.submission_id).maybeSingle();
  if(error||!data)throw fail('PRIVATE_COMPLIANCE_APPLICATION_UNAVAILABLE',503);
  // No private evidence object paths or signed links are returned.
  return {...data,verified:false,can_activate:false,legal_compliance_approved:false};
}
export async function recordDealerPreliminaryReview(submissionId,actor,payload={}){
  const meta=await reviewerSubmission(submissionId,actor);
  await requireReviewerPassword(actor,{claimant_user_id:meta.claimant_user_id},
    payload.reviewer_password);
  if(!OUTCOMES.has(payload.verdict))throw fail('UNSUPPORTED_PRELIMINARY_REVIEW_OUTCOME');
  if(typeof payload.reason!=='string'||payload.reason.trim().length<40||
    payload.reason.length>3000)throw fail('PRELIMINARY_REVIEW_REASON_REQUIRED');
  const {data,error}=await supabase.rpc('dealer_review_compliance_submission',{
    p_submission_id:meta.submission_id,p_reviewer_id:actor.userId,
    p_verdict:payload.verdict,p_reason:payload.reason.trim(),
  });
  if(error){throwIfDealerSecurityRefusal(error);throw fail('INDEPENDENT_PRELIMINARY_REVIEW_REFUSED',409);}
  return data;
}
