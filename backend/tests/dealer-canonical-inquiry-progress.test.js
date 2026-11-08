import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-dealer-only';
const {advanceMyCanonicalDealerInquiry,projectCanonicalDealerInquiry}
  =await import('../services/dealer/dealerTenantLeadReadService.js');
const tenant='11111111-1111-4111-8111-111111111111';
const actor={userId:'owner1',authenticationMethod:'session'};
const profile='22222222-2222-4222-8222-222222222222';
const inquiry='33333333-3333-4333-8333-333333333333';
const resolveOwner=async()=>({tenant_id:tenant,dealer_profile_id:profile});
const result={inquiry_id:inquiry,previous_status:'new',status:'contacted',
 followup_event_id:'44444444-4444-4444-8444-444444444444',
 seller_reported_only:true,buyer_contact_delivery_verified:false,
 payment_or_transaction_status_modified:false};
test('C15 authorized dealer followup writes only through atomic canonical Marketplace RPC',async()=>{
 const calls=[];
 const db={rpc:async(name,params)=>{calls.push([name,params]);return{data:result,error:null};}};
 const received=await advanceMyCanonicalDealerInquiry(actor,inquiry,'contacted',{db,resolveOwner});
 assert.equal(received.inquiry_id,inquiry);
 assert.equal(received.status,'contacted');
 assert.equal(received.buyer_contact_delivery_verified,false);
 assert.equal(received.payment_or_transaction_status_modified,false);
 assert.equal(calls[0][0],'dealer_advance_marketplace_inquiry');
 assert.deepEqual(calls[0][1],{
  p_profile_id:profile,p_owner_id:'owner1',p_inquiry_id:inquiry,
  p_requested_status:'contacted'
 });
});
test('C15 refuses unsupported status, invalid inquiry ID, missing canonical owner before DB write',async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return{data:result,error:null}}};
 for(const [id,status,owner] of [
  ['not-a-uuid','contacted',resolveOwner],[inquiry,'closed',resolveOwner],
  [inquiry,'assigned',resolveOwner],[inquiry,'qualified',async()=>({tenant_id:tenant})],
  [inquiry,'qualified',async()=>({tenant_id:null,dealer_profile_id:profile})]
 ]){
  await assert.rejects(advanceMyCanonicalDealerInquiry(actor,id,status,{db,resolveOwner:owner}));
 }
 assert.equal(calls,0);
});
test('C15 fail-closed on Marketplace RPC refusal or inconsistent receipt',async()=>{
 await assert.rejects(advanceMyCanonicalDealerInquiry(actor,inquiry,'qualified',{
  resolveOwner,db:{rpc:async()=>({data:null,error:new Error('INQUIRY_NOT_OWNED_OR_NOT_ELIGIBLE')})}
 }),/DEALER_INQUIRY_FOLLOWUP_REFUSED/);
 await assert.rejects(advanceMyCanonicalDealerInquiry(actor,inquiry,'qualified',{
  resolveOwner,db:{rpc:async()=>({data:{...result,status:'closed'},error:null})}
 }),/CANONICAL_DEALER_INQUIRY_RECEIPT_INVALID/);
});
test('C15 only clear-risk, non-closed inquiries expose seller followup action',()=>{
 const base={id:inquiry,status:'new',risk_status:'clear',
  guest_name:'Synthetic Buyer',guest_email:'buyer@example.invalid'};
 assert.equal(projectCanonicalDealerInquiry(base).allowed_followup_status,'contacted');
 assert.equal(projectCanonicalDealerInquiry({...base,status:'contacted'}).allowed_followup_status,'qualified');
 assert.equal(projectCanonicalDealerInquiry({...base,status:'closed'}).allowed_followup_status,null);
 assert.equal(projectCanonicalDealerInquiry({...base,risk_status:'flagged'}).allowed_followup_status,null);
 assert.equal(projectCanonicalDealerInquiry({...base,risk_status:'watch'}),null);
});
