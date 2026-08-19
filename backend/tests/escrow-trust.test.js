/**
 * Workstream F / Issue #164 Phase 6 — trust-gated escrow authority tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const esc = await import('../services/escrow/escrowTrustService.js');
const websec = await import('../services/eligibility/webhookSecurity.js');
const { supabase } = await import('../db/supabase.js');
let db;
function reset() { db = { vehicles: [{ vin:'ESCROWVIN00000001', tenant_id:'t1', owner_id:'seller-1' }], escrow_trust_sessions:[], escrow_trust_events:[], escrow_trust_webhook_events:[] }; }
function builder(table) {
  const st={table,op:'select',filters:{},single:false,maybe:false,order:null,payload:null};
  const chain={ select(){return chain;}, insert(p){st.op='insert';st.payload=p;return chain;}, update(p){st.op='update';st.payload=p;return chain;}, eq(k,v){st.filters[k]=v;return chain;}, order(c,o){st.order={col:c,asc:o?.ascending??false};return chain;}, single(){st.single=true;return chain;}, maybeSingle(){st.maybe=true;return chain;}, then(res,rej){try{return Promise.resolve(run(st)).then(res,rej);}catch(e){return rej?rej(e):Promise.reject(e);}} };
  return chain;
}
function run(st) {
  const ok=(data)=>({data,error:null}); const rows=(db[st.table]=db[st.table]||[]);
  if(st.op==='insert'){
    const list=Array.isArray(st.payload)?st.payload:[st.payload];
    for(const p of list){if(st.table==='escrow_trust_webhook_events'&&p.idempotency_key&&rows.some(r=>r.idempotency_key===p.idempotency_key))return{data:null,error:{message:'dup'}};}
    const ins=list.map((p,i)=>({id:p.id||`${st.table}-${rows.length+i+1}`,created_at:`2026-06-26T00:${String(rows.length+i).padStart(2,'0')}:00Z`,...p})); rows.push(...ins); return ok(st.single?ins[0]:ins);
  }
  if(st.op==='update'){let u=null;for(const r of rows){if(Object.entries(st.filters).every(([k,v])=>r[k]===v)){Object.assign(r,st.payload);u=r;}}return ok(st.single?u:(u?[u]:[]));}
  let out=rows.filter(r=>Object.entries(st.filters).every(([k,v])=>r[k]===v)); if(st.order)out=out.slice().sort((a,b)=>(st.order.asc?1:-1)*((a[st.order.col]>b[st.order.col])?1:-1)); if(st.maybe)return ok(out[0]||null); if(st.single)return out[0]?ok(out[0]):{data:null,error:{message:'nf'}}; return ok(out);
}
function install(){reset();supabase.from=(t)=>builder(t);}
const OK={identity_status:'complete',publication_status:'publishable',fraud_block:false,seller_suspended:false,participant_authorized:true,required_documents_present:true,listing_snapshot_changed:false};
const INPUT=(overrides={})=>({buyerId:'b1',sellerId:'seller-1',inquiryId:'inq-1',gateContext:OK,...overrides});

test('gates: all measured clear -> allowed',()=>assert.equal(esc.evaluateEscrowGates(OK).allowed,true));
test('gates: missing evidence fails closed instead of becoming a PASS',()=>{const g=esc.evaluateEscrowGates({});assert.equal(g.allowed,false);for(const r of ['identity_unresolved','fraud_status_unknown','seller_status_unknown','unauthorized_participant','required_documents_missing','listing_snapshot_status_unknown'])assert.ok(g.reasons.includes(r));});
test('gates: identity unresolved -> blocked',()=>assert.deepEqual(esc.evaluateEscrowGates({...OK,identity_status:'incomplete'}).reasons,['identity_unresolved']));
test('gates: not published -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,publication_status:'draft'}).reasons.includes('not_governed_published')));
test('gates: critical fraud -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,fraud_block:true}).reasons.includes('critical_fraud_open')));
test('gates: unauthorized participant -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,participant_authorized:false}).reasons.includes('unauthorized_participant')));
test('gates: listing snapshot changed -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,listing_snapshot_changed:true}).reasons.includes('listing_snapshot_changed')));

test('requestEscrow: clear gates -> inquiry-bound eligible session + event',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});assert.equal(s.status,'eligible');assert.equal(s.inquiry_id,'inq-1');assert.equal(s.buyer_id,'b1');assert.equal(s.seller_id,'seller-1');assert.equal(db.escrow_trust_events.length,1);});
test('requestEscrow: inquiry, buyer and seller are mandatory',async()=>{install();await assert.rejects(()=>esc.requestEscrow('ESCROWVIN00000001',{buyerId:'b1',sellerId:'seller-1',gateContext:OK},{id:'b1',role:'buyer'}),/Resolved inquiry, buyer and seller are required/);});
test('requestEscrow: browser actor cannot create for another buyer',async()=>{install();await assert.rejects(()=>esc.requestEscrow('ESCROWVIN00000001',INPUT({buyerId:'victim'}),{id:'attacker',role:'buyer'}),/own authenticated identity/);});
test('requestEscrow: failed gates -> failed session with reasons',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT({gateContext:{...OK,fraud_block:true}}),{id:'b1',role:'buyer'});assert.equal(s.status,'failed');assert.ok(s.gate_reasons.includes('critical_fraud_open'));});
test('requestEscrow: idempotency is bound to inquiry + participants + VIN',async()=>{install();const a=await esc.requestEscrow('ESCROWVIN00000001',INPUT({idempotencyKey:'e1'}),{id:'b1',role:'buyer'});const b=await esc.requestEscrow('ESCROWVIN00000001',INPUT({idempotencyKey:'e1'}),{id:'b1',role:'buyer'});assert.equal(a.id,b.id);assert.equal(db.escrow_trust_sessions.length,1);await assert.rejects(()=>esc.requestEscrow('ESCROWVIN00000001',INPUT({inquiryId:'inq-other',idempotencyKey:'e1'}),{id:'b1',role:'buyer'}),/different transaction intent/);});

test('transition: buyer may initiate but cannot assert provider-funded state',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});const t=await esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:OK});assert.equal(t.status,'initiated');await assert.rejects(()=>esc.transitionEscrow(s.id,'funded_sandbox',{actor:{id:'b1',role:'buyer'},gateContext:OK}),/cannot assert escrow state/);});
test('transition: invalid jump is rejected',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.transitionEscrow(s.id,'released_sandbox',{actor:{id:'b1',role:'buyer'}}),/invalid escrow transition/);});
test('transition: forward move blocked when server gates fail',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:{...OK,fraud_block:true}}),/gate failed/);});
test('read: unrelated buyer cannot read/list another participant transaction',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.getSession(s.id,{id:'other',role:'buyer'}),/not visible/);assert.deepEqual(await esc.listSessionsForVin('ESCROWVIN00000001',{id:'other',role:'buyer'}),[]);});

test('webhook: valid signed provider transition applies',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});await esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:OK});const body={session_id:s.id,to_status:'funded_sandbox',event_type:'payment',gate_context:{fraud_block:true}};const payload=JSON.stringify(body);const ts=String(Date.now());const sig=websec.sign('escrow_trust_sandbox',payload,ts);const out=await esc.ingestEscrowWebhook({payloadString:payload,signature:sig,timestamp:ts,idempotencyKey:'w1',body});assert.equal(out.applied,true);assert.equal(db.escrow_trust_sessions[0].status,'funded_sandbox');});
test('webhook: signed payload cannot assert a non-provider state',async()=>{install();const s=await esc.requestEscrow('ESCROWVIN00000001',INPUT(),{id:'b1',role:'buyer'});const body={session_id:s.id,to_status:'release_approved',event_type:'payment'};const payload=JSON.stringify(body);const ts=String(Date.now());const sig=websec.sign('escrow_trust_sandbox',payload,ts);const out=await esc.ingestEscrowWebhook({payloadString:payload,signature:sig,timestamp:ts,idempotencyKey:'w-non-provider',body});assert.equal(out.applied,false);assert.equal(out.reason,'unsupported_provider_transition');});
test('webhook: bad signature recorded, not applied',async()=>{install();const out=await esc.ingestEscrowWebhook({payloadString:'{}',signature:'bad',timestamp:String(Date.now()),idempotencyKey:'w2',body:{session_id:'x',to_status:'funded_sandbox'}});assert.equal(out.applied,false);assert.equal(out.signature_valid,false);assert.equal(db.escrow_trust_webhook_events.length,1);});
