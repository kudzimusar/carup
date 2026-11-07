import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'explicitly-fake-buyer-case-test';
const service=await import('../services/dealer/dealerBuyerFeedbackService.js');

const TX='2a31b69b-8716-47af-a78b-f8c8a4b38651';
const CASE='2ae40ec2-4c0b-4f08-91c4-a354657a9ea9';
const buyer={userId:'fictional-buyer',authenticationMethod:'session',
  platformRole:'member',isVerified:true};
const reviewer={userId:'fictional-reviewer',authenticationMethod:'session',
  platformRole:'reviewer',isVerified:true};
const bad=Object.freeze({transaction_id:TX,seed_dealer_id:'ZW-DEAL-0001',
  case_type:'BUYER_COMPLAINT',
  statement:'FICTIONAL buyer reports a private complaint, with no real purchase or payment claim.'});
const receipt=Object.freeze({case_id:CASE,verified_purchase:false,
  public_review_eligible:false,payment_changed:false,
  state:'PRIVATE_CASE_AWAITING_INDEPENDENT_REVIEW'});

function qb(data,{single=false}={}){
 return {
  select(){return this},eq(){return this},in(){return this},
  order(){return this},
  limit:async()=>({data,error:null}),
  maybeSingle:async()=>({data:single?data:data?.[0]??null,error:null}),
 };
}

test('C23 rejects unauthenticated and noncanonical buyer case IDs before any write',async()=>{
 const db={rpc:()=>{throw Error('MUST_NOT_EXECUTE_RPC')}};
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   {...buyer,authenticationMethod:'header'},bad,{db}),/REAL_SESSION_REQUIRED/);
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   buyer,{...bad,transaction_id:'not-uuid'},{db}),/INVALID_CANONICAL_TRANSACTION_ID/);
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   buyer,{...bad,seed_dealer_id:'ZW-DEAL-UNKNOWN'},{db}),/INVALID_DEALER_SEED_REFERENCE/);
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   buyer,{...bad,statement:'too short'},{db}),/INVALID_BUYER_CASE_STATEMENT/);
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   buyer,{...bad,rating:5},{db}),/COMPLAINT_CANNOT_CARRY_STAR_RATING/);
 await assert.rejects(service.submitMyPrivateDealerFeedback(
   buyer,{...bad,case_type:'REVIEW_CANDIDATE',rating:0},{db}),
   /INVALID_UNVERIFIED_REVIEW_RATING/);
});

test('C23 only canonical buyer-scoped SQL RPC may record immutable private complaint',async()=>{
 const called=[];
 const db={rpc:async(name,args)=>{called.push({name,args});return {data:receipt,error:null}}};
 const res=await service.submitMyPrivateDealerFeedback(buyer,bad,{db});
 assert.equal(res.case_id,CASE);
 assert.equal(res.public_review_eligible,false);
 assert.equal(res.verified_purchase,false);
 assert.equal(res.payment_changed,false);
 assert.equal(res.public_star_rating_created,false);
 assert.deepEqual(called,[{name:'dealer_record_transaction_feedback_case',
  args:{p_seed_dealer_id:'ZW-DEAL-0001',p_transaction_id:TX,
   p_buyer_id:buyer.userId,p_type:'BUYER_COMPLAINT',
   p_statement:bad.statement,p_rating:null}}]);
});

test('C23 refuses a server receipt that tries to grant published stars or payment rights',async()=>{
 for(const change of [
  {public_review_eligible:true},{verified_purchase:true},{payment_changed:true},
  {case_id:'invalid-id'},
 ]){
  const db={rpc:async()=>({data:{...receipt,...change},error:null})};
  await assert.rejects(service.submitMyPrivateDealerFeedback(buyer,bad,{db}),
   /PRIVATE_BUYER_CASE_RECEIPT_INVALID/);
 }
});

test('C23 true buyer transaction read is scoped to canonical buyer and approved dealer link',async()=>{
 const db={from:name=>{
  if(name==='escrow_trust_sessions')
   return qb([{id:TX,buyer_id:buyer.userId,tenant_id:'canonical-tenant',status:'released_sandbox'},
     {id:'f65be389-d41d-4554-8217-f103b38ee53d',buyer_id:buyer.userId,
      tenant_id:'non-dealer-tenant',status:'eligible'}]);
  if(name==='dealer_transaction_feedback_cases')return qb([
   {case_id:CASE,buyer_user_id:buyer.userId,seed_dealer_id:'ZW-DEAL-0001',
    transaction_intent_id:TX,submitted_at:'2026-11-04T00:00:00Z',
    case_type:'BUYER_COMPLAINT',submitted_rating:null}]);
  if(name==='dealer_approved_seed_links')
   return qb([{seed_dealer_id:'ZW-DEAL-0001',tenant_id:'canonical-tenant',
    operating_status:'ACTIVE'}]);
  throw Error('UNEXPECTED_SQL_TABLE '+name);
 }};
 const result=await service.listMyCanonicalDealerFeedbackContext(buyer,{db});
 assert.equal(result.entries.length,1);
 assert.equal(result.entries[0].transaction_id,TX);
 assert.equal(result.entries[0].can_submit_review_candidate,true);
 assert.equal(result.entries[0].public_review_enabled,false);
 assert.equal(result.cases.length,1);
 assert.equal(result.public_ratings_activated,false);
});

test('C23 provider cross-buyer read is never treated as proof of entitlement',async()=>{
 const db={from:name=>qb(name==='escrow_trust_sessions'?
   [{id:TX,buyer_id:'foreign-buyer',tenant_id:'canonical-tenant',
    status:'released_sandbox'}]:[])};
 await assert.rejects(service.listMyCanonicalDealerFeedbackContext(buyer,{db}),
  /CROSS_BUYER_TRANSACTION_READ_REFUSED/);
});

test('C23 reviewer queue has no private statements and excludes decided cases',async()=>{
 const db={from:name=>{
  if(name==='dealer_transaction_feedback_cases')return qb([
   {case_id:CASE,seed_dealer_id:'ZW-DEAL-0001',
    case_type:'BUYER_COMPLAINT',submitted_at:'2026-11-04T00:00:00Z'},
   {case_id:'9a81dc5f-fc2f-4a18-9365-2c3770cff508',
    seed_dealer_id:'ZW-DEAL-0002',case_type:'REVIEW_CANDIDATE',
    submitted_at:'2026-11-04T00:00:00Z'}]);
  if(name==='dealer_transaction_feedback_review_events')return qb([{case_id:CASE}]);
  // R6 closure: the reviewer-conflict lookup (no conflicts for this reviewer).
  if(name==='dealer_research_claim_requests'||name==='tenant_users')return qb([]);
  throw Error('UNEXPECTED_TABLE');
 }};
 const queue=await service.listPrivateBuyerCaseReviewQueue(reviewer,{db});
 assert.equal(queue.length,1);
 assert.equal(queue[0].case_type,'REVIEW_CANDIDATE');
 assert.equal('statement' in queue[0],false);
 await assert.rejects(service.listPrivateBuyerCaseReviewQueue(
   {...reviewer,platformRole:'member'},{db}),/INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
});

test('C23 independent reviewer refuses dealership owner before reading private buyer statement',async()=>{
 const db={from:name=>{
  if(name==='dealer_transaction_feedback_cases')return qb({
   case_id:CASE,seed_dealer_id:'ZW-DEAL-0001',
   transaction_intent_id:TX,buyer_user_id:buyer.userId,
   case_type:'BUYER_COMPLAINT',statement:bad.statement,
   submitted_rating:null,canonical_transaction_state_at_submission:'released_sandbox',
  },{single:true});
  if(name==='dealer_approved_seed_links')return qb({claimant_user_id:reviewer.userId},
   {single:true});
  throw Error('UNEXPECTED_SQL_TABLE');
 }};
 await assert.rejects(service.previewPrivateBuyerCase(reviewer,CASE,
  'FICTIONAL_NOT_REAL_PASSWORD_123',{db}),/DEALER_CANNOT_REVIEW_OWN_BUYER_FEEDBACK/);
});

test('C23 provider cross-buyer feedback case read is never disclosed',async()=>{
 const db={from:name=>qb(name==='escrow_trust_sessions'?[]:
   name==='dealer_transaction_feedback_cases'?[{
     case_id:CASE,buyer_user_id:'another-real-buyer',
     transaction_intent_id:TX,seed_dealer_id:'ZW-DEAL-0001',
   }]:[])};
 await assert.rejects(service.listMyCanonicalDealerFeedbackContext(buyer,{db}),
   /CROSS_BUYER_CASE_READ_REFUSED/);
});
