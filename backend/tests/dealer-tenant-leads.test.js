import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-dealer-only';
const leads=await import('../services/dealer/dealerTenantLeadReadService.js');
const tenant='11111111-1111-4111-8111-111111111111';
const other='99999999-9999-4999-8999-999999999999';
const actor={userId:'approved-owner',authenticationMethod:'session'};
const inquiry={id:'fixture-inquiry',seller_tenant_id:tenant,
  listing_id:'TESTVIN00000000001',inquiry_type:'vehicle_purchase_interest',
  status:'new',risk_status:'clear',source_channel:'web',
  guest_name:'Test Buyer',guest_email:'buyer@example.invalid',
  guest_phone:'+263000000',message:'I would like a vehicle inspection',
  created_at:'2026-11-04T00:00:00Z'};
function fakeDb(rows,{error=null}={}){
  const calls=[];
  return {
    calls,
    from(table){
      assert.equal(table,'marketplace_inquiries');
      const call={table,filters:[]};
      calls.push(call);
      return {
        select(fields){call.fields=fields;return this},
        eq(field,value){call.filters.push([field,value]);return this},
        order(){return this},
        limit:async()=>({data:rows,error}),
      };
    },
  };
}
const resolver=async()=>({tenant_id:tenant});
test('C15 owner sees only genuine tenant-scoped buyer enquiry and no transaction/finance inference',async()=>{
  const db=fakeDb([inquiry]);
  const data=await leads.getMyCanonicalDealerInquiries(actor,{db,resolveOwner:resolver});
  assert.equal(data.tenant_id,tenant);
  assert.equal(data.returned_visible_count,1);
  assert.equal(data.total_available,null);
  assert.equal(data.entries[0].contact_name,'Test Buyer');
  assert.equal(data.entries[0].payment_authority_granted,false);
  assert.equal(data.entries[0].buyer_transaction_verified,false);
  assert.equal(data.entries[0].staff_assignment_enabled,false);
  assert.equal(data.moderation_and_assignment_require_marketplace_authority,true);
  assert.equal(data.dealer_followup_uses_canonical_atomic_inquiry_authority,true);
  assert.equal(data.entries[0].allowed_followup_status,'contacted');
  assert.deepEqual(db.calls[0].filters,[['seller_tenant_id',tenant]]);
  assert.ok(!JSON.stringify(data).includes('seller_id'));
});
test('C15 no buyer contact leak for disputed, spam, watch or closed enquiries',()=>{
  for(const status of ['spam','rejected','archived']){
    assert.equal(leads.projectCanonicalDealerInquiry({...inquiry,status}),null);
  }
  for(const risk_status of ['watch','blocked','high','spam','rejected','under_review']){
    assert.equal(leads.projectCanonicalDealerInquiry({...inquiry,risk_status}),null);
  }
  const unverified=leads.projectCanonicalDealerInquiry({...inquiry,risk_status:null});
  assert.equal(unverified.customer_contact_available,false);
  assert.equal(unverified.contact_email,null);
  const closed=leads.projectCanonicalDealerInquiry({...inquiry,status:'closed'});
  assert.equal(closed.customer_contact_available,false);
  assert.equal(closed.message,null);
});
test('C15 mismatched service-role rows fail closed instead of leaking another dealership buyer',async()=>{
  const db=fakeDb([{...inquiry,seller_tenant_id:other}]);
  await assert.rejects(leads.getMyCanonicalDealerInquiries(actor,{
    db,resolveOwner:resolver}),/CROSS_TENANT_BUYER_INQUIRY_REFUSED/);
});
test('C15 database/provider unavailable is not reported as zero enquiries',async()=>{
  const db=fakeDb(null,{error:new Error('unavailable')});
  await assert.rejects(leads.getMyCanonicalDealerInquiries(actor,{
    db,resolveOwner:resolver}),/TENANT_BUYER_INQUIRIES_UNAVAILABLE/);
});
test('C15 no fake owner, tenant or global user role may be trusted as tenant source',async()=>{
  const db=fakeDb([]);
  await assert.rejects(leads.getMyCanonicalDealerInquiries(actor,{
    db,resolveOwner:async()=>({tenant_id:null})}),/CANONICAL_TENANT_CONTEXT_REQUIRED/);
  assert.equal(db.calls.length,0);
});
