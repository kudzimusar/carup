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

const tenantId='11111111-1111-4111-8111-111111111111';
const subId='22222222-2222-4222-8222-222222222222';
const invoiceId='33333333-3333-4333-8333-333333333333';
function readOnlyFake({subscriptions=[],invoices=[],payments=[],missing=null}={}){
  const calls=[];
  const tableData={
    pay03b_business_subscriptions:subscriptions,
    pay03b_subscription_invoices:invoices,
    payment_transactions:payments,
  };
  const db={from(table){
    calls.push({table,filters:[]});
    if(!Object.hasOwn(tableData,table))throw Error('Unapproved billing source read '+table);
    const c=calls.at(-1);
    return {select(){return this},
      eq(k,v){c.filters.push([k,v]);return this},
      in(k,v){c.filters.push([k,v]);return this},
      order(){return this},
      limit:async()=>({data:tableData[table],error:missing===table?new Error('No canonical table'):null}),
    };
  }};
  return {db,calls};
}
test('C24 without PAY03B migration records are unavailable, not falsely zero or eligible',async()=>{
  const {db,calls}=readOnlyFake({missing:'pay03b_business_subscriptions'});
  const snapshot=await api.loadReadOnlyDealerPay03bSnapshot(db,tenantId);
  assert.equal(snapshot.state,'PAY03B_SCHEMA_OR_CANONICAL_READ_UNAVAILABLE');
  assert.equal(snapshot.subscriptions,null);
  assert.equal(snapshot.invoices,null);
  assert.equal(snapshot.payment_initiation_allowed,false);
  assert.deepEqual(calls.map(x=>x.table),['pay03b_business_subscriptions']);
  assert.deepEqual(calls[0].filters,[
    ['owner_tenant_id',tenantId],['subscription_scope','dealer_storefront'],
  ]);
});
test('C24 existing canonical subscription returns actual scoped read-only rows, no paid entitlement',async()=>{
  const fixture={
    subscriptions:[{id:subId,owner_tenant_id:tenantId,
      subscription_scope:'dealer_storefront',status:'active',
      paid_through:'2026-12-01T00:00:00Z',
      current_period_end:'2026-12-01T00:00:00Z'}],
    invoices:[{id:invoiceId,subscription_id:subId,provider_status:'paid',
      currency:'USD',amount_due_minor:5000,anomaly:null,
      payment_reference:'simulated-payment-reference'}],
    payments:[{reference:'simulated-payment-reference',status:'reconciliation_hold'}],
  };
  const {db,calls}=readOnlyFake(fixture);
  const r=await api.loadReadOnlyDealerPay03bSnapshot(db,tenantId);
  assert.equal(r.state,'PAY03B_CANONICAL_SNAPSHOT_READ_ONLY');
  assert.equal(r.subscriptions.length,1);
  assert.equal(r.subscriptions[0].provider_status_is_entitlement_proof,false);
  assert.equal(r.subscriptions[0].tenant_billable_entitlement_approved_by_this_read,false);
  assert.equal(r.invoices.length,1);
  assert.equal(r.invoices[0].payment_status,'reconciliation_hold');
  assert.equal(r.invoices[0].reconciliation_attested_by_this_read,false);
  assert.equal(r.storefront_entitlement_granted_by_this_read,false);
  assert.equal(r.payment_initiation_allowed,false);
  assert.equal(r.provider_account_activated_by_this_read,false);
  assert.deepEqual(calls.map(x=>x.table),[
    'pay03b_business_subscriptions','pay03b_subscription_invoices','payment_transactions',
  ]);
  assert.deepEqual(calls[1].filters,[['subscription_id',[subId]]]);
  assert.deepEqual(calls[2].filters,[['reference',['simulated-payment-reference']]]);
  assert.ok(!JSON.stringify(r).includes('simulated-payment-reference'));
});
test('C24 tenant-scope mismatch and foreign invoice refuse any financial projection',async()=>{
  const wrong=readOnlyFake({subscriptions:[{id:subId,
    owner_tenant_id:'99999999-9999-4999-8999-999999999999',
    subscription_scope:'dealer_storefront'}]});
  const r=await api.loadReadOnlyDealerPay03bSnapshot(wrong.db,tenantId);
  assert.equal(r.state,'PAY03B_TENANT_SCOPE_MISMATCH');
  assert.equal(r.subscriptions,null);
  const foreign=readOnlyFake({subscriptions:[{id:subId,owner_tenant_id:tenantId,
    subscription_scope:'dealer_storefront'}],
    invoices:[{id:invoiceId,subscription_id:'99999999-9999-4999-8999-999999999999'}]});
  const fail=await api.loadReadOnlyDealerPay03bSnapshot(foreign.db,tenantId);
  assert.equal(fail.state,'PAY03B_CROSS_TENANT_INVOICE_REFUSED');
  assert.equal(fail.invoices,null);
});
test('C24 valid canonical dealer sees only scoped read, no provider request or initiation',async()=>{
  const {db,calls}=readOnlyFake();
  const info=await api.getDealerCommercialReadiness({
    userId:'owner',authenticationMethod:'session',
  },{
    db,resolveOwner:async()=>({organization_id:'org',
      tenant_id:tenantId,dealer_profile_id:'profile',actor_id:'owner'}),
  });
  assert.equal(info.tenant_id,tenantId);
  assert.equal(info.canonical_pay03b_billing_readback.state,
    'PAY03B_CANONICAL_SNAPSHOT_READ_ONLY');
  assert.equal(info.canonical_pay03b_billing_readback.subscriptions.length,0);
  assert.equal(info.payment_initiation_allowed,false);
  assert.equal(info.has_approved_subscription_entitlement,false);
  assert.equal(info.live_payment_enabled,false);
  assert.equal(calls.length,1);
});
test('C24 malformed tenant identity refuses PAY03B table read',async()=>{
  const {db,calls}=readOnlyFake();
  const r=await api.loadReadOnlyDealerPay03bSnapshot(db,'wrong-tenant');
  assert.equal(r.state,'CANONICAL_TENANT_ID_REQUIRED');
  assert.equal(calls.length,0);
});
