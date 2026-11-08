/**
 * R6 B — dealership data-layer refusals on CANONICAL Marketplace writes are documented
 * 4xx decisions, not 500s; genuine server faults stay 5xx. The HTTP proof against real
 * PostgreSQL is browser phase 7 (synthetic-dealer-suspension.pw.ts: 409 republish,
 * 409 replay, 409 enquiry). SQL guard behaviour: database/test/dealer_1_0_pglite_check.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const {dealerCanonicalWriteRefusal,DEALER_CANONICAL_WRITE_REFUSALS}=
  await import('../services/dealer/dealerCanonicalWriteRefusal.js');
const {createInquiry}=await import('../services/marketplace/marketplaceInquiryService.js');

const raised=(message)=>({code:'P0001',message,details:null,hint:null});

test('B every documented guard code maps to its 4xx with a stable code and safe message',()=>{
  for(const [code,[status,message]] of Object.entries(DEALER_CANONICAL_WRITE_REFUSALS)){
    const refusal=dealerCanonicalWriteRefusal(raised(code));
    assert.ok(refusal,code);
    assert.equal(refusal.statusCode,status,code);
    assert.ok(status>=400&&status<500,code);
    assert.equal(refusal.code,code);
    assert.equal(refusal.message,message);
    assert.doesNotMatch(refusal.message,/select|insert|update|tenant_id|uuid|[0-9a-f]{8}-/i,'no SQL/ids leak');
  }
});

test('B suspended, revoked, expired and withdrawn all surface as the same 409 (state, not identity)',()=>{
  // The SQL guard raises one code for every non-current operating state; the API never
  // reveals which state, only that the dealership is not currently authorised.
  const r=dealerCanonicalWriteRefusal(raised('DEALER_LISTING_AUTHORITY_NOT_CURRENT'));
  assert.equal(r.statusCode,409);
  assert.equal(dealerCanonicalWriteRefusal(raised('DEALER_INQUIRY_AUTHORITY_NOT_CURRENT')).statusCode,409);
  assert.equal(dealerCanonicalWriteRefusal(raised('DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER')).statusCode,403);
  assert.equal(dealerCanonicalWriteRefusal(raised('DEALER_DECLARED_PRICE_REQUIRED')).statusCode,422);
});

test('B genuine server faults and look-alikes are NOT reclassified (stay 5xx)',()=>{
  for(const error of [
    null,undefined,'DEALER_LISTING_AUTHORITY_NOT_CURRENT',
    raised('DEALER_LISTING_WRITE_REQUIRES_READ_COMMITTED'), // server misconfiguration → 5xx
    {code:'23505',message:'DEALER_LISTING_AUTHORITY_NOT_CURRENT'},  // wrong SQLSTATE
    {code:'40P01',message:'deadlock detected'},
    {code:'08006',message:'connection failure'},
    raised('DEALER_LISTING_AUTHORITY_NOT_CURRENT extra text'),       // not an exact code
    raised('SOMETHING_ELSE'),
    {message:'DEALER_LISTING_AUTHORITY_NOT_CURRENT'},                 // no SQLSTATE
  ])assert.equal(dealerCanonicalWriteRefusal(error),null,JSON.stringify(error));
});

// Chainable stand-in for the Supabase client: every builder method returns the builder;
// terminal reads resolve per table. Only the INSERT reproduces the trigger's refusal.
function fakeClient({insertError,vehicle={current_seller_id:'dealer-owner-1',tenant_id:'tenant-1'}}){
  const inserted=[];
  return {inserted,from(table){
    const b={_insert:null,
      select(){return b},eq(){return b},neq(){return b},is(){return b},in(){return b},
      order(){return b},limit(){return b},
      insert(row){b._insert=row;return b},
      async maybeSingle(){return {data:table==='vehicles'?vehicle:null,error:null}},
      async single(){
        if(b._insert){
          if(insertError)return {data:null,error:insertError};
          inserted.push(b._insert);return {data:b._insert,error:null};
        }
        return {data:table==='vehicles'?vehicle:null,error:null};
      },
      then(resolve){return Promise.resolve({data:table==='vehicles'?[vehicle]:[],error:null}).then(resolve)},
    };
    return b;
  }};
}
const guest={inquiry_type:'vehicle_purchase_interest',listing_id:'SYNTHR4P02DLR0001',
  guest_email:'buyer@example.invalid',message:'FICTIONAL enquiry'};

test('B a new enquiry to a dealership whose authority is not current is a 409, not a 500',async()=>{
  const client=fakeClient({insertError:raised('DEALER_INQUIRY_AUTHORITY_NOT_CURRENT')});
  await assert.rejects(createInquiry(client,guest,null,{emitDomainEvent:async()=>{},
    referralBridge:{recordInquiryLead:async()=>null}}),
    e=>e.statusCode===409&&e.code==='DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
  assert.equal(client.inserted.length,0);
});

test('B a genuine database failure on the enquiry insert stays a 5xx DatabaseError',async()=>{
  const client=fakeClient({insertError:{code:'08006',message:'connection failure'}});
  await assert.rejects(createInquiry(client,guest,null,{emitDomainEvent:async()=>{},
    referralBridge:{recordInquiryLead:async()=>null}}),
    e=>e.statusCode===500&&e.code!=='DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
});
