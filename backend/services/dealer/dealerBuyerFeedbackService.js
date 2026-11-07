/**
 * CARUP-DEALER-ONB-001 C23 — private, canonical transaction-linked buyer
 * complaints and review CANDIDATES. Never a public star rating, payment or
 * escrow action. The existing escrow_trust_sessions row owns transaction
 * identity; dealer_approved_seed_links owns the canonical dealer relationship.
 */
import {supabase} from '../../db/supabase.js';
import {throwIfDealerSecurityRefusal} from './dealerSqlRefusalMapper.js';
import {
  requireClaimantSession,requireIndependentReviewer,requireReviewerPassword
} from './dealerClaimApplicationService.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEED=/^ZW-DEAL-[0-9]{4}$/;
const TYPES=new Set(['BUYER_COMPLAINT','REVIEW_CANDIDATE']);
const FINDINGS=new Set(['NEEDS_BUYER_EVIDENCE','REFERRED_TO_CANONICAL_DISPUTE',
  'NOT_ELIGIBLE_FOR_PUBLIC_REVIEW']);
const fail=(code,status=403)=>Object.assign(new Error(code),{code,statusCode:status});
const validId=(id,code='INVALID_CANONICAL_TRANSACTION_ID')=>{
  if(typeof id!=='string'||!UUID.test(id))throw fail(code,400);
  return id;
};
const safeStatement=(s,min,max,code)=>{
  if(typeof s!=='string'||s.trim().length<min||s.trim().length>max)
    throw fail(code,400);
  return s.trim();
};
const receiptIsPrivate=r=>Boolean(r&&typeof r.case_id==='string'&&
  UUID.test(r.case_id)&&r.verified_purchase===false&&
  r.public_review_eligible===false&&r.payment_changed===false);

/** Exposes only the signed-in buyer's canonical transaction eligibility. */
export async function listMyCanonicalDealerFeedbackContext(actor,{db=supabase}={}){
  const userId=requireClaimantSession(actor);
  const [tx,cases]=await Promise.all([
    db.from('escrow_trust_sessions')
      .select('id,buyer_id,tenant_id,status').eq('buyer_id',userId)
      .order('id',{ascending:false}).limit(50),
    db.from('dealer_transaction_feedback_cases')
      .select('case_id,buyer_user_id,seed_dealer_id,transaction_intent_id,case_type,submitted_rating,submitted_at')
      .eq('buyer_user_id',userId).order('submitted_at',{ascending:false}).limit(50),
  ]);
  if(tx.error||cases.error||!Array.isArray(tx.data)||!Array.isArray(cases.data))
    throw fail('CANONICAL_BUYER_FEEDBACK_READ_UNAVAILABLE',503);
  if(tx.data.some(x=>x.buyer_id!==userId))
    throw fail('CROSS_BUYER_TRANSACTION_READ_REFUSED');
  if(cases.data.some(x=>x.buyer_user_id!==userId))
    throw fail('CROSS_BUYER_CASE_READ_REFUSED');
  const tenants=[...new Set(tx.data.map(x=>x.tenant_id).filter(x=>typeof x==='string'&&x))];
  let links=[];
  if(tenants.length){
    const result=await db.from('dealer_approved_seed_links')
      .select('seed_dealer_id,tenant_id,operating_status').in('tenant_id',tenants).limit(100);
    if(result.error||!Array.isArray(result.data))throw fail('TRANSACTION_DEALER_LINK_UNAVAILABLE',503);
    links=result.data;
  }
  const lookup=new Map(links.map(x=>[String(x.tenant_id),x]));
  const entries=tx.data.filter(x=>lookup.has(String(x.tenant_id)))
    .map(x=>Object.freeze({
      transaction_id:x.id,seed_dealer_id:lookup.get(String(x.tenant_id)).seed_dealer_id,
      canonical_status:x.status,
      can_submit_complaint:true,
      can_submit_review_candidate:x.status==='released_sandbox',
      verified_real_purchase:false,public_review_enabled:false,
      payment_or_dispute_mutation_enabled:false,
    }));
  if(cases.data.some(x=>!UUID.test(x.case_id)||!UUID.test(x.transaction_intent_id)))
    throw fail('CANONICAL_FEEDBACK_IDENTITY_INVALID',503);
  return Object.freeze({
    entries,cases:cases.data.map(({buyer_user_id,...row})=>row),
    source:'escrow_trust_sessions',private_cases_only:true,
    public_ratings_activated:false,independent_moderation_required:true,
  });
}
/** The SQL function validates the buyer ID, tenant and immutable transaction. */
export async function submitMyPrivateDealerFeedback(actor,payload={}, {db=supabase}={}){
  const buyerId=requireClaimantSession(actor);
  const seed=payload.seed_dealer_id;
  if(typeof seed!=='string'||!SEED.test(seed))throw fail('INVALID_DEALER_SEED_REFERENCE',400);
  const txId=validId(payload.transaction_id);
  if(!TYPES.has(payload.case_type))throw fail('INVALID_BUYER_CASE_TYPE',400);
  const statement=safeStatement(payload.statement,40,2000,'INVALID_BUYER_CASE_STATEMENT');
  const rating=payload.case_type==='REVIEW_CANDIDATE'?Number(payload.rating):null;
  if(payload.case_type==='REVIEW_CANDIDATE'&&
    (!Number.isInteger(rating)||rating<1||rating>5))
    throw fail('INVALID_UNVERIFIED_REVIEW_RATING',400);
  if(payload.case_type==='BUYER_COMPLAINT'&&payload.rating!=null)
    throw fail('COMPLAINT_CANNOT_CARRY_STAR_RATING',400);
  const {data,error}=await db.rpc('dealer_record_transaction_feedback_case',{
    p_seed_dealer_id:seed,p_transaction_id:txId,p_buyer_id:buyerId,
    p_type:payload.case_type,p_statement:statement,p_rating:rating,
  });
  if(error)throw fail('PRIVATE_BUYER_CASE_REJECTED_BY_CANONICAL_AUTHORITY',409);
  if(!receiptIsPrivate(data))throw fail('PRIVATE_BUYER_CASE_RECEIPT_INVALID',503);
  return Object.freeze({...data,real_transaction_verified:false,
    public_star_rating_created:false,canonical_dispute_status_changed:false});
}
export async function listPrivateBuyerCaseReviewQueue(actor,{db=supabase}={}){
  requireIndependentReviewer(actor,'');
  // No buyer statement, email, transaction ID or evidence in the queue.
  const [cases,reviews]=await Promise.all([
    db.from('dealer_transaction_feedback_cases')
      .select('case_id,seed_dealer_id,case_type,submitted_at')
      .order('submitted_at',{ascending:true}).limit(100),
    db.from('dealer_transaction_feedback_review_events')
      .select('case_id').limit(100),
  ]);
  if(cases.error||reviews.error||!Array.isArray(cases.data)||!Array.isArray(reviews.data))
    throw fail('PRIVATE_BUYER_CASE_QUEUE_UNAVAILABLE',503);
  const already=new Set(reviews.data.map(x=>x.case_id));
  return cases.data.filter(x=>!already.has(x.case_id));
}
async function getReviewerCase(id,actor,{db=supabase}={}){
  validId(id,'INVALID_PRIVATE_FEEDBACK_CASE_ID');
  requireIndependentReviewer(actor,'');
  const {data,error}=await db.from('dealer_transaction_feedback_cases')
    .select('case_id,seed_dealer_id,transaction_intent_id,buyer_user_id,case_type,statement,submitted_rating,canonical_transaction_state_at_submission,submitted_at')
    .eq('case_id',id).maybeSingle();
  if(error)throw fail('PRIVATE_BUYER_CASE_READ_UNAVAILABLE',503);
  if(!data)throw fail('PRIVATE_BUYER_CASE_NOT_FOUND',404);
  requireIndependentReviewer(actor,data.buyer_user_id);
  const link=await db.from('dealer_approved_seed_links')
    .select('claimant_user_id').eq('seed_dealer_id',data.seed_dealer_id).maybeSingle();
  if(link.error||!link.data)throw fail('CANONICAL_DEALER_LINK_UNAVAILABLE',503);
  if(link.data.claimant_user_id===actor.userId)
    throw fail('DEALER_CANNOT_REVIEW_OWN_BUYER_FEEDBACK');
  return data;
}
export async function previewPrivateBuyerCase(actor,caseId,password,{db=supabase}={}){
  const row=await getReviewerCase(caseId,actor,{db});
  await requireReviewerPassword(actor,{claimant_user_id:row.buyer_user_id},password);
  return Object.freeze({...row,verified_real_purchase:false,public_review_eligible:false,
    private_buyer_statement_only:true});
}
export async function recordPrivateBuyerCaseFinding(actor,caseId,payload={}, {db=supabase}={}){
  const row=await getReviewerCase(caseId,actor,{db});
  await requireReviewerPassword(actor,{claimant_user_id:row.buyer_user_id},
    payload.reviewer_password);
  if(!FINDINGS.has(payload.finding))throw fail('INVALID_BUYER_CASE_FINDING',400);
  const reason=safeStatement(payload.reason,80,3000,'INVALID_BUYER_CASE_RATIONALE');
  const {data,error}=await db.rpc('dealer_record_transaction_feedback_finding',{
    p_case_id:row.case_id,p_reviewer_id:actor.userId,
    p_finding:payload.finding,p_reason:reason,
  });
  if(error){throwIfDealerSecurityRefusal(error);throw fail('INDEPENDENT_BUYER_CASE_FINDING_REFUSED',409);}
  if(!data||!UUID.test(data.event_id)||data.public_verified_review!==false||
    data.canonical_dispute_case_modified!==false||
    data.provider_payment_status_modified!==false)
    throw fail('PRIVATE_BUYER_CASE_REVIEW_RECEIPT_INVALID',503);
  return Object.freeze({...data,public_reviews_changed:false,
    verified_transaction_granted:false});
}
