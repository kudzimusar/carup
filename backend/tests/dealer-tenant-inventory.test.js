import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-inventory-key';
const inventory=await import('../services/dealer/dealerTenantInventoryReadService.js');

test('C17 canonical dealer inventory projection is limited and never a VIN seller grant',()=>{
 const row={
  vin:'JH4DA1234LS000001',make:'Honda',model:'Example',year:2020,
  status:'available',publication_status:'draft',
  tenant_id:'OTHER_TENANT_SECRET',owner_id:'PRIVATE_OWNER',
  registration_number:'PRIVATE_VRM',payment_total:'PRIVATE_PAYMENT',
  tax_identity:'SECRET_TAX',personal_phone:'PRIVATE_CONTACT',
 };
 const projection=inventory.projectTenantDealerVehicle(row);
 assert.equal(projection.vin,row.vin);
 assert.equal(projection.recorded_marketplace_publication_state,'draft');
 assert.equal(projection.seller_authority,'NOT_DETERMINED_BY_TENANT_INVENTORY_READ');
 assert.equal(projection.public_listing_approved_by_this_read,false);
 assert.equal(projection.legal_title_certified,false);
 assert.equal(projection.import_duty_verified,false);
 assert.equal(projection.branch_attribution,'NOT_VERIFIED_IN_CANONICAL_STOCK');
 assert.equal(projection.listing_structural_precheck.seller_authority_check,'NOT_EVALUATED');
 assert.equal(projection.listing_structural_precheck.human_publication_authorized,false);
 assert.equal(projection.listing_structural_precheck.merchant_payment_authorized,false);
 assert.ok(projection.listing_structural_precheck.blocking_reason_codes.includes('invalid_price'),
   'incomplete actual Marketplace fields must give real correction reasons, not fictitious readiness');
 assert.ok(projection.listing_structural_precheck.blocking_reason_codes.includes('unknown_seller_type'));
 for(const field of ['OTHER_TENANT_SECRET','PRIVATE_OWNER','PRIVATE_VRM',
  'PRIVATE_PAYMENT','SECRET_TAX','PRIVATE_CONTACT'])assert.ok(
    !JSON.stringify(projection).includes(field));
});
test('C17 a fully populated data-precheck still does NOT grant authority to sell, verify VIN evidence or charge',()=>{
 const row={
  vin:'JH4DA1234LS000001',make:'Honda',model:'Fit',year:2020,
  price:12500,status:'Available',publication_status:'public',
  tenant_id:'8e574511-32b0-4c2c-97fa-e123495863ac',
  owner_id:null,current_seller_type:'Dealer',import_source:'Local',
 };
 const projection=inventory.projectTenantDealerVehicle(row);
 assert.deepEqual(projection.listing_structural_precheck.blocking_reason_codes,[]);
 assert.equal(projection.listing_structural_precheck.result,'DATA_PRECHECK_ONLY');
 assert.equal(projection.listing_structural_precheck.seller_authority_check,'NOT_EVALUATED');
 assert.equal(projection.listing_structural_precheck.vehicle_passport_review,'NOT_EVALUATED');
 assert.equal(projection.listing_structural_precheck.human_publication_authorized,false);
 assert.equal(projection.listing_structural_precheck.merchant_payment_authorized,false);
 assert.equal(projection.public_listing_approved_by_this_read,false);
 for(const field of ['8e574511-32b0-4c2c-97fa-e123495863ac']){
  assert.equal(JSON.stringify(projection).includes(field),false);
 }
});

test('C17 no recorded VIN is not a synthetic vehicle',()=>{
 assert.equal(inventory.projectTenantDealerVehicle(null),null);
 assert.equal(inventory.projectTenantDealerVehicle({vin:0}),null);
 assert.equal(inventory.projectTenantDealerVehicle({vin:'VALID123456789ABC',make:null}).make,null);
});
test('C17 unapproved actor cannot enumerate arbitrary tenant stock through the owner read',async()=>{
 for(const actor of [null,{},{
  userId:'fake-dealer',authenticationMethod:'x-user-id-fallback',
  isVerified:true,platformRole:'super_admin',tenant_id:'ATTACKER_SUPPLIED',
 }]){
  await assert.rejects(inventory.getMyCanonicalDealerInventory(actor));
 }
});

test('C17 fail-closed tenant scope revalidates provider rows and rejects unavailable inventory',async()=>{
 const tenant='00000000-0000-4000-8000-000000000001';
 const resolveOwner=async()=>({tenant_id:tenant});
 const fakeDb=(result)=>({from(table){
   assert.equal(table,'vehicles');
   return {select(){return this},eq(k,v){
     assert.deepEqual([k,v],['tenant_id',tenant]);return this;
   },order(){return this},limit(n){
     assert.equal(n,100);return Promise.resolve(result);
   }};
 }});
 await assert.rejects(
   inventory.getMyCanonicalDealerInventory({userId:'owner'},{
     db:fakeDb({data:null,error:null}),resolveOwner,
   }),/CANONICAL_TENANT_INVENTORY_UNAVAILABLE/);
 await assert.rejects(
   inventory.getMyCanonicalDealerInventory({userId:'owner'},{
     db:fakeDb({data:[{tenant_id:'CROSS_TENANT',vin:'TEST0000000000001'}],error:null}),
     resolveOwner,
   }),/CROSS_TENANT_VEHICLE_READ_REFUSED/);
 const own=await inventory.getMyCanonicalDealerInventory({userId:'owner'},{
   db:fakeDb({data:[{tenant_id:tenant,vin:'TEST0000000000001',
     make:'FICTIONAL',model:'TEST',year:2026,publication_status:'draft'}],error:null}),
   resolveOwner,
 });
 assert.equal(own.returned_count,1);
 assert.equal(own.entries[0].public_listing_approved_by_this_read,false);
 assert.equal(own.entries[0].listing_structural_precheck.result,'REQUIRES_DATA_CORRECTION');
 assert.ok(own.entries[0].listing_structural_precheck.blocking_reason_codes.includes('fixture_excluded'));
 assert.equal(own.entries[0].listing_structural_precheck.human_publication_authorized,false);
 assert.equal(own.entries[0].vin,'TEST0000000000001');
 assert.equal(own.owner_tenant_id,tenant);
});

test('C17 a canonical owner can register PRIVATE draft stock only, without any requested seller/finance privileges',async()=>{
 const tenant='00000000-0000-4000-8000-000000000001';
 const actor={userId:'approved-original-owner'};
 const resolveOwner=async()=>({tenant_id:tenant,actor_id:actor.userId});
 let written=null;
 const db={from(table){
  assert.equal(table,'vehicles');
  return {insert(row){
    written=row;
    return {select(cols){
      assert.equal(cols,'vin,tenant_id,mileage,status,publication_status,price,owner_id,current_seller_type');
      return {single:async()=>({data:{
        vin:row.vin,tenant_id:row.tenant_id,mileage:row.mileage,status:row.status,
        publication_status:row.publication_status,
        price:row.price,owner_id:row.owner_id,
        current_seller_type:row.current_seller_type,
      },error:null})};
    }};
  }};
 }};
 const outcome=await inventory.recordMyCanonicalDealerPrivateDraft(actor,{
  vin:'test0000000000002',make:'FICTIONAL',model:'CI DRAFT',year:2026,mileage:120000,
  publication_status:'published',price:1000000,
  duty_paid:true,police_verified:true,merchant_payment_enabled:true,
  owner_id:'ATTACKER',tenant_id:'ATTACKER',current_seller_type:'Dealer',
 },{db,resolveOwner});
 assert.equal(outcome.vin,'TEST0000000000002');
 assert.equal(outcome.private_tenant_draft_only,true);
 assert.equal(outcome.seller_publish_action_enabled,false);
 assert.equal(outcome.merchant_payment_enabled,false);
 assert.equal(outcome.independent_per_vin_seller_review_required,true);
 assert.equal(written.tenant_id,tenant);
 assert.equal(written.status,'Pending');
 assert.equal(written.mileage,120000);
 assert.equal(written.publication_status,'draft');
 assert.equal(written.price,0);
 assert.equal(written.duty_paid,false);
 assert.equal(written.police_verified,false);
 assert.equal(written.current_seller_type,null);
 assert.equal(written.owner_id,null);
 assert.deepEqual(Object.keys(written).sort(),
  ['vin','make','model','year','mileage','price','status','publication_status',
   'owner_id','current_seller_type','import_source','duty_paid',
   'police_verified','tenant_id'].sort());
});

test('C17 private draft VIN validation, duplicate protection and cross-owner refusal',async()=>{
 const tenant='00000000-0000-4000-8000-000000000001';
 for(const vin of ['SHORT','1234567890123456I','TEST000000000000O',''])assert.throws(
  ()=>inventory.parseCanonicalDealerPrivateDraft({
    vin,make:'TEST',model:'PRIVATE',year:2026,mileage:1000}),/INVALID_PRIVATE_DRAFT_VIN/);
 for(const bad of [{vin:'TEST0000000000002',make:'a',model:'TEST',year:2026,mileage:1000},
   {vin:'TEST0000000000002',make:'VALID',model:'TEST',year:2300,mileage:1000},
   {vin:'TEST0000000000002',make:'VALID',model:'TEST',year:'2026',mileage:1000}])
  assert.throws(()=>inventory.parseCanonicalDealerPrivateDraft(bad),
   /INVALID_PRIVATE_DRAFT_SPECIFICATION/);
 const actor={userId:'claimant1'};
 const resolveOwner=async()=>({actor_id:'OTHER_ACTOR',tenant_id:tenant});
 await assert.rejects(inventory.recordMyCanonicalDealerPrivateDraft(
  actor,{vin:'TEST0000000000002',make:'VALID',model:'TEST',year:2026,mileage:1000},
  {resolveOwner}),/CANONICAL_OWNER_TENANT_DRAFT_AUTHORITY_REQUIRED/);
 const db={from:()=>({insert:()=>({select:()=>({
  single:async()=>({data:null,error:{code:'23505'}}),
 })})})};
 await assert.rejects(inventory.recordMyCanonicalDealerPrivateDraft(
  actor,{vin:'TEST0000000000002',make:'VALID',model:'TEST',year:2026,mileage:1000},
  {db,resolveOwner:async()=>({actor_id:actor.userId,tenant_id:tenant})}),
  /CANONICAL_PRIVATE_DRAFT_VIN_ALREADY_EXISTS/);
});

test('C17 correct an existing canonical private VIN without allowing submitted seller or finance fields',async()=>{
 const tenant='00000000-0000-4000-8000-000000000001';
 const actor={userId:'approved-original-owner'};
 const vin='TEST0000000000002';
 let updated=null;const conditions=[];
 const db={from(table){
  assert.equal(table,'vehicles');
  const chain={update(fields){updated=fields;return this},
   eq(k,v){conditions.push([k,v]);return this},
   is(k,v){conditions.push([k,v]);return this},
   select(columns){
    assert.ok(columns.includes('publication_status,price'));
    return this;
   },
   async maybeSingle(){return {data:{
    vin,tenant_id:tenant,status:'Pending',publication_status:'draft',
    price:0,owner_id:null,current_seller_type:null,import_source:null,...updated,
   },error:null}};
  };
  return chain;
 }};
 const receipt=await inventory.correctMyCanonicalDealerPrivateDraft(actor,vin,{
  make:'Tesla',model:'Y',year:2026,mileage:121000,
  tenant_id:'FOREIGN',publication_status:'published',price:900000,
  status:'Available',owner_id:'ATTACKER',import_source:'Local',
  merchant_payment_enabled:true,
 },{db,resolveOwner:async()=>({actor_id:actor.userId,tenant_id:tenant})});
 assert.deepEqual(updated,{make:'Tesla',model:'Y',year:2026,mileage:121000},
  'private metadata edit must never forward status/finance/owner fields');
 assert.equal(receipt.private_tenant_draft_only,true);
 assert.equal(receipt.seller_publish_action_enabled,false);
 assert.equal(receipt.merchant_payment_enabled,false);
 assert.deepEqual(conditions,[
  ['vin',vin],['tenant_id',tenant],
  ['status','Pending'],['publication_status','draft'],['price',0],
  ['duty_paid',false],['police_verified',false],
  ['owner_id',null],['current_seller_type',null],['import_source',null],
 ]);
});

test('C17 private VIN correction rejects unapproved actor, malformed VIN and a non-editable/published/foreign row',async()=>{
 const vin='TEST0000000000002',tenant='00000000-0000-4000-8000-000000000001';
 const actor={userId:'owner'};
 const fields={make:'FICTIONAL',model:'EDIT',year:2026,mileage:1000};
 await assert.rejects(inventory.correctMyCanonicalDealerPrivateDraft(actor,'SHORT',fields),
  /INVALID_PRIVATE_DRAFT_VIN/);
 await assert.rejects(inventory.correctMyCanonicalDealerPrivateDraft(actor,vin,{
  ...fields,year:1900}),/INVALID_PRIVATE_DRAFT_SPECIFICATION/);
 await assert.rejects(inventory.correctMyCanonicalDealerPrivateDraft(actor,vin,fields,{
  resolveOwner:async()=>({actor_id:'OTHER',tenant_id:tenant}),
 }),/CANONICAL_OWNER_TENANT_DRAFT_AUTHORITY_REQUIRED/);
 const db={from:()=>({update:()=>({eq(){return this},is(){return this},
  select(){return this},async maybeSingle(){return {data:null,error:null}},
 })})};
 await assert.rejects(inventory.correctMyCanonicalDealerPrivateDraft(actor,vin,fields,{
  db,resolveOwner:async()=>({actor_id:actor.userId,tenant_id:tenant}),
 }),/PRIVATE_DRAFT_NOT_FOUND_OR_NOT_EDITABLE/);
});

test('C17 an unverified private VIN must declare an integer odometer and cannot fabricate a zero default',()=>{
 const draft={vin:'TEST0000000000002',make:'FICTIONAL',model:'PRIVATE',year:2026};
 for(const mileage of [undefined,null,-1,'0',1.5,2000001]){
  assert.throws(()=>inventory.parseCanonicalDealerPrivateDraft({...draft,mileage}),
   /PRIVATE_DRAFT_MILEAGE_DECLARATION_REQUIRED/);
  assert.throws(()=>inventory.parseCanonicalDealerDraftCorrections({...draft,mileage}),
   /PRIVATE_DRAFT_MILEAGE_DECLARATION_REQUIRED/);
 }
 const declared=inventory.parseCanonicalDealerPrivateDraft({...draft,mileage:0});
 assert.equal(declared.mileage,0,'explicit declared 0 is allowed for an actual new vehicle');
 assert.equal(declared.status,'Pending');
 assert.equal(declared.publication_status,'draft');
});
