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
 for(const field of ['OTHER_TENANT_SECRET','PRIVATE_OWNER','PRIVATE_VRM',
  'PRIVATE_PAYMENT','SECRET_TAX','PRIVATE_CONTACT'])assert.ok(
    !JSON.stringify(projection).includes(field));
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
