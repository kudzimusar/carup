import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-dealer-key';
const api=await import('../services/dealer/dealerCommercialReadinessService.js');

test('T26/T27 PAY-03B dealer first-party and PAY-05 garage beneficiary are never conflated',()=>{
  const flows=api.FLOW_DISTINCTIONS;
  assert.equal(flows.length,3);
  const firstParty=flows.find(x=>x.code==='DEALER_PAYS_CARUP');
  const ownMerchant=flows.find(x=>x.code==='BUYER_PAYS_DEALER');
  const garage=flows.find(x=>x.code==='GARAGE_CUSTOMER_PAYS_GARAGE');
  assert.equal(firstParty.beneficiary,'INDEPENDENTLY_APPROVED_CARUP_MERCHANT');
  assert.equal(ownMerchant.beneficiary,'THIS_DEALERSHIP_OWN_VERIFIED_MERCHANT');
  assert.equal(garage.beneficiary,'GARAGE_OWN_MERCHANT_NOT_CARUP_AND_NOT_DEALERSHIP');
  assert.equal(new Set(flows.map(f=>f.beneficiary)).size,3);
  assert.ok(flows.every(x=>x.paid===false));
  assert.ok(flows.every(x=>!x.status.includes('SUCCESS')));
});

test('T26/T30 no unapproved actor can get commerce entitlements, initiate money or self authorize checkout',async()=>{
  for(const identity of [undefined,null,{},{
    userId:'false-owner',authenticationMethod:'x-user-id-fallback',
    platformRole:'admin',isVerified:true,
  }]){
    await assert.rejects(api.getDealerCommercialReadiness(identity));
  }
});
