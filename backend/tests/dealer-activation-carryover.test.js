/**
 * R6 C02 — owner read of what the governed activation carried from the frozen,
 * approved application. Service-level contract; SQL behaviour is proven in
 * database/test/dealer_1_0_pglite_check.mjs (PGlite + native PostgreSQL 17).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const {readMyActivationCarryover}=await import('../services/dealer/dealerOperationalDeclarationsService.js');

const owner=Object.freeze({actor_id:'owner-1',tenant_id:'11111111-1111-4111-8111-111111111111',
  dealer_profile_id:'22222222-2222-4222-8222-222222222222'});
const resolveOwner=async()=>owner;
function db(result,calls=[]){
  return {rpc:async(name,args)=>{calls.push([name,args]);return result}};
}

test('C02 read is scoped to the resolved owner profile and tenant only',async()=>{
  const calls=[];
  await readMyActivationCarryover({userId:'owner-1'},{resolveOwner,
    db:db({data:{application_version:1,branches:[],sections:[],counts:{},needs_attention:[]},error:null},calls)});
  assert.deepEqual(calls,[['dealer_read_activation_carryover',{
    p_profile_id:owner.dealer_profile_id,p_tenant_id:owner.tenant_id}]]);
});

test('C02 non-owner, staff and suspended workspaces are refused before any read',async()=>{
  const calls=[];
  const denied=Object.assign(new Error('APPROVED_DEALER_OWNER_REQUIRED'),{statusCode:403});
  await assert.rejects(readMyActivationCarryover({userId:'staff-1'},{
    resolveOwner:async()=>{throw denied},db:db({data:{},error:null},calls)}),
    e=>e.statusCode===403);
  assert.equal(calls.length,0);
});

test('C02 database failure is a 503, missing provenance a 404 — never an empty success',async()=>{
  await assert.rejects(readMyActivationCarryover({},{resolveOwner,db:db({data:null,error:{message:'x'}})}),
    e=>e.statusCode===503&&e.code==='ACTIVATION_CARRYOVER_READ_UNAVAILABLE');
  await assert.rejects(readMyActivationCarryover({},{resolveOwner,db:db({data:null,error:null})}),
    e=>e.statusCode===404);
});

test('C02 a forged verified/public flag or unknown section from storage is never echoed',async()=>{
  const out=await readMyActivationCarryover({},{resolveOwner,db:db({error:null,data:{
    application_version:2,independently_verified:true,publicly_approved:true,
    sections:['FINANCE_TERMS','PAYMENT_APPROVED'],
    branches:[{branch_ref:'BR-1',source_row:1,branch_id:'b',name:'Yard',has_gps:'yes',has_hours:true,extra:'x'}],
    counts:{CARRIED_UNVERIFIED:4},needs_attention:Array.from({length:500},(_,i)=>({row:i}))}})});
  assert.equal(out.independently_verified,false);
  assert.equal(out.publicly_approved,false);
  assert.deepEqual(out.sections,['FINANCE_TERMS']);
  assert.deepEqual(out.branches,[{branch_ref:'BR-1',source_row:1,branch_id:'b',name:'Yard',has_gps:false,has_hours:true}]);
  assert.equal(out.needs_attention.length,200,'bounded response');
  assert.equal(Object.isFrozen(out),true);
});
