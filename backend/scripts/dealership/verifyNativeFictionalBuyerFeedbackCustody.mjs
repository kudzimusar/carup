/**
 * R3 C23 exact physical PostgreSQL custody receipt for real Chromium
 * fictional buyer complaint and separate reviewer password step-up.
 * ONLY dedicated disposable localhost PostgreSQL, no real dealerships,
 * real money, publicly verified buyer score or provider dispute action.
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import pg from 'pg';
import {assertLocalDatabase} from './importResearchSeed.mjs';

const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const parsed=new URL(url);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));
assert.equal(parsed.pathname,'/carup_dealer_isolated_ci');
assert.equal(parsed.search,'');
assert.equal(parsed.hash,'');
for(const name of ['CARUP_DEALER_RESEARCH_XLSX','DEALER_SEED_DATABASE_URL','SUPABASE_URL'])
 assert.equal(process.env[name],undefined,'UNSAFE_REAL_OR_SHARED_ENV_'+name);
const fpath=process.env.DEALER_BROWSER_FIXTURE_JSON;
assert.ok(fpath);
const f=JSON.parse(readFileSync(fpath,'utf8'));
assert.equal(f.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(f.synthetic_legal_policy_provenance,'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY');
assert.equal(f.synthetic_operations?.fictional_only,true);
const db=new pg.Client({connectionString:url,ssl:false,
 application_name:'CARUP_CI_PRIVATE_BUYER_CASE_POST_BROWSER_SQL_RECEIPT'});
await db.connect();
try{
 const transaction=await db.query(`SELECT id,buyer_id,tenant_id,status
   FROM escrow_trust_sessions WHERE id=$1`,
  [f.synthetic_operations.feedback_transaction_id]);
 assert.equal(transaction.rowCount,1);
 assert.equal(transaction.rows[0].buyer_id,f.actors.buyer.id);
 assert.equal(transaction.rows[0].tenant_id,f.synthetic_operations.tenant_id);
 assert.equal(transaction.rows[0].status,'released_sandbox');
 const caseRows=await db.query(`SELECT case_id,buyer_user_id,seed_dealer_id,
   transaction_intent_id,case_type,statement_sha256,submitted_rating,
   canonical_transaction_state_at_submission,transaction_verified_for_public_review,
   public_review_eligible,source_class
   FROM dealer_transaction_feedback_cases
   WHERE transaction_intent_id=$1`,[f.synthetic_operations.feedback_transaction_id]);
 assert.equal(caseRows.rowCount,1);
 const c=caseRows.rows[0];
 assert.equal(c.buyer_user_id,f.actors.buyer.id);
 assert.equal(c.seed_dealer_id,f.seed);
 assert.equal(c.transaction_intent_id,f.synthetic_operations.feedback_transaction_id);
 assert.equal(c.case_type,'BUYER_COMPLAINT');
 assert.equal(c.submitted_rating,null);
 assert.equal(c.canonical_transaction_state_at_submission,'released_sandbox');
 assert.match(c.statement_sha256,/^[a-f0-9]{64}$/);
 assert.equal(c.transaction_verified_for_public_review,false);
 assert.equal(c.public_review_eligible,false);
 assert.equal(c.source_class,'UNQUALIFIED_OR_SANDBOX_CANONICAL_INTENT');
 const reviews=await db.query(`SELECT reviewer_user_id,finding,
  verified_transaction_represented,public_review_published,
  payment_or_dispute_status_modified FROM dealer_transaction_feedback_review_events
  WHERE case_id=$1`,[c.case_id]);
 assert.equal(reviews.rowCount,1);
 assert.equal(reviews.rows[0].reviewer_user_id,f.actors.reviewer.id);
 assert.equal(reviews.rows[0].finding,'REFERRED_TO_CANONICAL_DISPUTE');
 assert.equal(reviews.rows[0].verified_transaction_represented,false);
 assert.equal(reviews.rows[0].public_review_published,false);
 assert.equal(reviews.rows[0].payment_or_dispute_status_modified,false);
 const realReviewCount=await db.query(`SELECT COUNT(*)::int AS n
   FROM dealer_transaction_feedback_cases WHERE public_review_eligible=true`);
 assert.equal(realReviewCount.rows[0].n,0);
 assert.equal(new Set([f.actors.claimant.id,f.actors.buyer.id,
   f.actors.reviewer.id]).size,3);
 const out='web/test-results/fictional-native-private-buyer-feedback-custody.json';
 mkdirSync(dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify({
  source:'CARUP_R3_EXPLICITLY_FICTIONAL_LOCAL_SQL_AND_CHROMIUM',
  real_owner_xlsx_import_certified:false,
  fictional_buyer_id:f.actors.buyer.id,
  independent_reviewer_id:f.actors.reviewer.id,
  canonical_escrow_fk_valid:true,
  immutable_private_cases:caseRows.rowCount,
  independent_private_review_events:reviews.rowCount,
  sandbox_state_preserved:'released_sandbox',
  public_stars_created:0,public_verified_reviews_created:0,
  provider_payment_status_modified:false,
  canonical_dispute_status_modified:false,
  real_vehicle_transaction_certified:false,
  production_activation:false,
 },null,2)+'\n',{mode:0o600});
 console.log('DEALER_FICTIONAL_NATIVE_BUYER_CASE_CUSTODY PASS: one private canonical sandbox-intent buyer case, distinct reviewer, no public rating, no payment/dispute mutation');
}finally{await db.end()}
