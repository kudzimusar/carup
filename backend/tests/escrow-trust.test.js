/**
 * Workstream F / Issue #164 Phase 6 — trust-gated escrow authority tests.
 *
 * WHAT THIS SUITE OWNS: the APPLICATION GUARD in services/escrow/escrowTrustService.js — gate
 * evaluation, the mandatory server-resolved transaction lineage, actor authority, the local
 * transition graph, the read partition, and the retirement of the legacy bespoke webhook.
 *
 * WHAT IT DOES NOT OWN: the PostgreSQL functions themselves. Since c55fba0f the service delegates
 * persistence to `issue164_upsert_transaction_intent_atomic` / `issue164_transition_session_atomic`
 * (database/migrations/20260819122000_*.sql and 20260819121000_*.sql). Those are proven against a
 * real PostgreSQL in backend/tests/issue164-phase6-full-postgres-chain.test.js. Here they are
 * replaced by a deliberately declared STAND-IN that mirrors the documented contract, so that this
 * suite can prove (a) exactly what the service forwards to the authoritative store and (b) that the
 * service never derives canonical status, ownership or money truth on its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const esc = await import('../services/escrow/escrowTrustService.js');
const websec = await import('../services/eligibility/webhookSecurity.js');
const { supabase } = await import('../db/supabase.js');

const VIN = 'ESCROWVIN00000001';
const INQUIRY_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = 'snapshot-hash-server-resolved';
const TERMS = { amount: 12500, currency: 'USD', currencySource: 'seller_declared' };

let db;
let rpcCalls;
function reset() {
  db = {
    // Phase 4 contract: current_seller_id is the seller relationship; owner_id is ownership history
    // and is deliberately a DIFFERENT id here so no code path can quietly fall back to it.
    vehicles: [{
      vin: VIN,
      tenant_id: 't1',
      owner_id: 'historical-owner-not-seller',
      current_seller_id: 'seller-1',
      publication_status: 'published',
      price: 12500,
      currency: 'USD',
      currency_source: 'seller_declared',
    }],
    marketplace_inquiries: [{
      id: INQUIRY_ID,
      listing_id: VIN,
      buyer_id: 'b1',
      seller_id: 'seller-1',
      inquiry_type: 'vehicle_purchase_interest',
      status: 'new',
      risk_status: 'clear',
    }],
    escrow_trust_sessions: [],
    escrow_trust_events: [],
    escrow_trust_webhook_events: [],
    domain_events: [],
  };
  rpcCalls = [];
}
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

// ── Stand-in for the two service-role-only PostgreSQL authorities ─────────────────────────────
// Mirrors the documented behaviour of the migrations named in the file header. It is intentionally
// independent of the JS guard: it re-checks lineage, the transition graph and actor authority, so a
// service that skipped one of its own checks would still be caught here.
const INQUIRY_OPEN_STATUSES = new Set(['new','assigned','contacted','qualified']);
const ACTION_TARGETS = new Set(['initiated','inspection_pending','release_approved','disputed','cancelled','failed']);
const ACTION_GRAPH = {
  eligible: ['initiated','cancelled','failed'],
  initiated: ['cancelled','failed'],
  funds_held: ['inspection_pending','disputed'],
  inspection_pending: ['release_approved','disputed'],
  release_approved: ['disputed'],
  disputed: ['cancelled'],
  funded_sandbox: ['inspection_pending','disputed'],
};
const PRIVILEGED_DB_ROLES = new Set(['admin','platform_admin','super_admin','reviewer']);
const err = (message) => ({ data: null, error: { message } });
function appendEvent(sessionId, from, to, actorId, actorRole, reason, payload) {
  db.escrow_trust_events.push({
    id: `evt-${db.escrow_trust_events.length + 1}`,
    session_id: sessionId, from_status: from, to_status: to,
    actor_id: actorId, actor_role: actorRole, reason, payload: payload || null,
    created_at: `2026-08-19T00:${String(db.escrow_trust_events.length).padStart(2,'0')}:00Z`,
  });
}
function upsertIntent(a) {
  if (!a.p_vin || !a.p_buyer_id || !a.p_seller_id || !a.p_inquiry_id || !a.p_listing_snapshot_hash
      || !(Number(a.p_listing_amount) > 0) || !a.p_listing_currency || !a.p_listing_currency_source
      || !a.p_idempotency_key) {
    return err('complete server-resolved transaction lineage is required');
  }
  if (a.p_buyer_id === a.p_seller_id) return err('buyer and seller must be distinct');
  const vehicle = db.vehicles.find((v) => v.vin === a.p_vin);
  if (!vehicle) return err('listing not found');
  if (!vehicle.current_seller_id || vehicle.current_seller_id !== a.p_seller_id) {
    return err('current seller changed or is not governed');
  }
  if (String(vehicle.publication_status).toLowerCase() !== 'published') return err('listing is not published');
  if (Number(vehicle.price) !== Number(a.p_listing_amount)) {
    return err('listing amount changed during transaction intent creation');
  }
  if (String(vehicle.currency).toUpperCase() !== String(a.p_listing_currency).toUpperCase()) {
    return err('listing currency changed during transaction intent creation');
  }
  if (vehicle.currency_source !== a.p_listing_currency_source) {
    return err('listing currency provenance changed during transaction intent creation');
  }
  const inquiry = db.marketplace_inquiries.find((i) => i.id === a.p_inquiry_id
    && i.listing_id === a.p_vin && i.buyer_id === a.p_buyer_id && i.seller_id === a.p_seller_id
    && i.inquiry_type === 'vehicle_purchase_interest' && i.risk_status === 'clear'
    && INQUIRY_OPEN_STATUSES.has(i.status));
  if (!inquiry) return err('current clear purchase inquiry required');

  const nextStatus = a.p_gate_allowed === true ? 'eligible' : 'failed';
  const reasons = a.p_gate_reasons || [];
  const existing = db.escrow_trust_sessions.find((s) => s.idempotency_key === a.p_idempotency_key);
  if (existing) {
    if (existing.vin !== a.p_vin || existing.buyer_id !== a.p_buyer_id
        || existing.seller_id !== a.p_seller_id || existing.inquiry_id !== a.p_inquiry_id
        || existing.listing_snapshot_hash !== a.p_listing_snapshot_hash
        || Number(existing.listing_amount) !== Number(a.p_listing_amount)
        || String(existing.listing_currency).toUpperCase() !== String(a.p_listing_currency).toUpperCase()
        || existing.listing_currency_source !== a.p_listing_currency_source) {
      return err('idempotency key is bound to different transaction truth');
    }
    const changed = existing.status !== nextStatus
      || JSON.stringify(existing.gate_reasons) !== JSON.stringify(reasons);
    if (['eligible','failed'].includes(existing.status) && changed) {
      const from = existing.status;
      existing.status = nextStatus;
      existing.gate_reasons = reasons;
      appendEvent(existing.id, from, nextStatus, a.p_buyer_id, 'buyer', 'eligibility_re_evaluated', { gate_reasons: reasons });
    }
    return { data: existing, error: null };
  }

  const created = {
    id: `sess-${db.escrow_trust_sessions.length + 1}`,
    vin: a.p_vin, tenant_id: vehicle.tenant_id, inquiry_id: a.p_inquiry_id,
    buyer_id: a.p_buyer_id, seller_id: a.p_seller_id, status: nextStatus,
    listing_snapshot_hash: a.p_listing_snapshot_hash, gate_reasons: reasons,
    idempotency_key: a.p_idempotency_key, listing_amount: a.p_listing_amount,
    listing_currency: String(a.p_listing_currency).toUpperCase(),
    listing_currency_source: a.p_listing_currency_source,
    payment_intent_id: null,
    created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  };
  db.escrow_trust_sessions.push(created);
  appendEvent(created.id, 'pending_eligibility', nextStatus, a.p_buyer_id, 'buyer',
    'initial_eligibility_evaluated', { inquiry_id: a.p_inquiry_id, gate_reasons: reasons, listing_snapshot_hash: a.p_listing_snapshot_hash });
  return { data: created, error: null };
}
function transitionSession(a) {
  if (!ACTION_TARGETS.has(a.p_to_status)) return err(`status ${a.p_to_status} is not a human/server action target`);
  if (!a.p_actor_id) return err('authenticated/system actor required');
  const tx = db.escrow_trust_sessions.find((s) => s.id === a.p_session_id);
  if (!tx) return err('transaction intent not found');
  const from = tx.status;
  if (from === a.p_to_status) return { data: tx, error: null };
  if (!(ACTION_GRAPH[from] || []).includes(a.p_to_status)) {
    return err(`invalid transaction action: ${from} -> ${a.p_to_status}`);
  }
  const role = String(a.p_actor_role || 'unknown').toLowerCase();
  const privileged = PRIVILEGED_DB_ROLES.has(role);
  const internal = role === 'system';
  const participant = a.p_actor_id === tx.buyer_id || a.p_actor_id === tx.seller_id;
  if (a.p_to_status === 'initiated') {
    if (a.p_actor_id !== tx.buyer_id) return err('only the transaction buyer may initiate payment');
    if (a.p_gate_allowed !== true) return err('current transaction gates do not permit initiation');
  } else if (a.p_to_status === 'inspection_pending') {
    if (!(privileged || internal)) return err('inspection transition requires internal-system or reviewer/admin action');
  } else if (a.p_to_status === 'release_approved') {
    if (!privileged) return err('release approval requires reviewer/admin action');
    if (a.p_gate_allowed !== true) return err('current transaction gates do not permit release approval');
  } else if (a.p_to_status === 'failed') {
    if (!(privileged || internal)) return err('failure transition requires internal-system or admin action');
  } else if (!(participant || privileged)) {
    return err('actor is not a transaction participant');
  }
  if (a.p_to_status === 'cancelled' && tx.payment_intent_id) {
    return err('provider-linked transaction must be cancelled through the payment provider');
  }
  tx.status = a.p_to_status;
  appendEvent(tx.id, from, a.p_to_status, a.p_actor_id, role, a.p_reason || null, null);
  db.domain_events.push({ to_status: a.p_to_status, session_id: tx.id });
  return { data: tx, error: null };
}
function install() {
  reset();
  supabase.from = (t) => builder(t);
  supabase.rpc = async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (fn === 'issue164_upsert_transaction_intent_atomic') return upsertIntent(args);
    if (fn === 'issue164_transition_session_atomic') return transitionSession(args);
    return err(`unexpected rpc: ${fn}`);
  };
}

const OK={identity_status:'complete',publication_status:'publishable',fraud_block:false,seller_suspended:false,participant_authorized:true,required_documents_present:true,listing_snapshot_changed:false};
// Every field here is SERVER-RESOLVED (marketplaceTransactionAuthority.requestMarketplaceEscrow
// computes them from the vehicle row + inquiry). requestEscrow refuses to run without them, which
// is exactly the Phase 6 rule that a browser may never assert listing terms.
const INPUT=(overrides={})=>({
  buyerId:'b1', sellerId:'seller-1', inquiryId:INQUIRY_ID, gateContext:OK,
  idempotencyKey:'idem-default', listingSnapshotHash:SNAPSHOT, listingTerms:TERMS,
  ...overrides,
});
const intentCalls = () => rpcCalls.filter((c) => c.fn === 'issue164_upsert_transaction_intent_atomic');

test('gates: all measured clear -> allowed',()=>assert.equal(esc.evaluateEscrowGates(OK).allowed,true));
test('gates: missing evidence fails closed instead of becoming a PASS',()=>{const g=esc.evaluateEscrowGates({});assert.equal(g.allowed,false);for(const r of ['identity_unresolved','fraud_status_unknown','seller_status_unknown','unauthorized_participant','required_documents_missing','listing_snapshot_status_unknown'])assert.ok(g.reasons.includes(r));});
test('gates: identity unresolved -> blocked',()=>assert.deepEqual(esc.evaluateEscrowGates({...OK,identity_status:'incomplete'}).reasons,['identity_unresolved']));
test('gates: not published -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,publication_status:'draft'}).reasons.includes('not_governed_published')));
test('gates: critical fraud -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,fraud_block:true}).reasons.includes('critical_fraud_open')));
test('gates: unauthorized participant -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,participant_authorized:false}).reasons.includes('unauthorized_participant')));
test('gates: listing snapshot changed -> blocked',()=>assert.ok(esc.evaluateEscrowGates({...OK,listing_snapshot_changed:true}).reasons.includes('listing_snapshot_changed')));

test('requestEscrow: clear gates -> inquiry-bound eligible session + event',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  assert.equal(s.status,'eligible');
  assert.equal(s.inquiry_id,INQUIRY_ID);
  assert.equal(s.buyer_id,'b1');
  assert.equal(s.seller_id,'seller-1');
  assert.equal(db.escrow_trust_events.length,1);
  // The service must hand the authoritative store the complete server-resolved lineage, and the
  // gate VERDICT only — it never chooses the resulting status itself.
  assert.equal(intentCalls().length,1);
  assert.deepEqual(intentCalls()[0].args,{
    p_vin:VIN,p_buyer_id:'b1',p_seller_id:'seller-1',p_inquiry_id:INQUIRY_ID,
    p_listing_snapshot_hash:SNAPSHOT,p_listing_amount:12500,p_listing_currency:'USD',
    p_listing_currency_source:'seller_declared',p_gate_allowed:true,p_gate_reasons:[],
    p_idempotency_key:'idem-default',
  });
});
test('requestEscrow: inquiry, buyer and seller are mandatory',async()=>{install();await assert.rejects(()=>esc.requestEscrow(VIN,{buyerId:'b1',sellerId:'seller-1',gateContext:OK},{id:'b1',role:'buyer'}),/Resolved inquiry, buyer and seller are required/);assert.equal(intentCalls().length,0);});
test('requestEscrow: browser actor cannot create for another buyer',async()=>{install();await assert.rejects(()=>esc.requestEscrow(VIN,INPUT({buyerId:'victim'}),{id:'attacker',role:'buyer'}),/own authenticated identity/);assert.equal(intentCalls().length,0);});
test('requestEscrow: server-resolved terms, snapshot and idempotency are mandatory',async()=>{
  // Phase 6: listing economics, the immutable snapshot and the canonical transaction key are
  // resolved by marketplaceTransactionAuthority from the vehicle row. A caller that cannot supply
  // them has not been through server resolution, so the request FAILS CLOSED and nothing at all
  // reaches the authoritative store.
  for(const missing of [{listingTerms:null},{listingSnapshotHash:null},{idempotencyKey:null}]){
    install();
    await assert.rejects(()=>esc.requestEscrow(VIN,INPUT(missing),{id:'b1',role:'buyer'}),/Server-resolved listing terms, snapshot and idempotency are required/);
    assert.equal(intentCalls().length,0);
    assert.equal(db.escrow_trust_sessions.length,0);
  }
});
test('requestEscrow: failed gates -> failed session with reasons',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT({gateContext:{...OK,fraud_block:true}}),{id:'b1',role:'buyer'});
  assert.equal(s.status,'failed');
  assert.ok(s.gate_reasons.includes('critical_fraud_open'));
  assert.equal(intentCalls()[0].args.p_gate_allowed,false);
  assert.deepEqual(intentCalls()[0].args.p_gate_reasons,['critical_fraud_open']);
});
test('requestEscrow: idempotency is bound to inquiry + participants + VIN',async()=>{
  install();
  const a=await esc.requestEscrow(VIN,INPUT({idempotencyKey:'e1'}),{id:'b1',role:'buyer'});
  const b=await esc.requestEscrow(VIN,INPUT({idempotencyKey:'e1'}),{id:'b1',role:'buyer'});
  assert.equal(a.id,b.id);
  assert.equal(db.escrow_trust_sessions.length,1);
  db.marketplace_inquiries.push({...db.marketplace_inquiries[0],id:'22222222-2222-4222-8222-222222222222'});
  await assert.rejects(
    ()=>esc.requestEscrow(VIN,INPUT({inquiryId:'22222222-2222-4222-8222-222222222222',idempotencyKey:'e1'}),{id:'b1',role:'buyer'}),
    /idempotency key is bound to different transaction truth/,
  );
  assert.equal(db.escrow_trust_sessions.length,1);
});

test('transition: buyer may initiate but cannot assert provider-funded state',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  const t=await esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:OK});
  assert.equal(t.status,'initiated');
  // funds_held is the canonical provider-confirmed money state; a buyer is never its authority.
  await assert.rejects(()=>esc.transitionEscrow(s.id,'funds_held',{actor:{id:'b1',role:'buyer'},gateContext:OK}),/cannot request transaction action/);
  // The retained historical sandbox state is not a back door out of a live transaction either.
  await assert.rejects(()=>esc.transitionEscrow(s.id,'funded_sandbox',{actor:{id:'b1',role:'buyer'},gateContext:OK}),/invalid escrow transition/);
  assert.equal(db.escrow_trust_sessions[0].status,'initiated');
});
test('transition: internal system role is not provider money authority',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  await esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:OK});
  await assert.rejects(()=>esc.transitionEscrow(s.id,'funds_held',{actor:{id:'worker',role:'system'},gateContext:OK}),/cannot request transaction action/);
  assert.equal(esc.canActorTransition({buyer_id:'b1',seller_id:'seller-1'},'funds_held',{id:'worker',role:'system'}),false);
  assert.equal(esc.canActorTransition({buyer_id:'b1',seller_id:'seller-1'},'settled',{id:'worker',role:'system'}),false);
  assert.equal(db.escrow_trust_sessions[0].status,'initiated');
});
test('transition: release approval requires reviewer authority',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  db.escrow_trust_sessions[0].status='inspection_pending';
  await assert.rejects(()=>esc.transitionEscrow(s.id,'release_approved',{actor:{id:'b1',role:'buyer'},gateContext:OK}),/cannot request transaction action/);
  await assert.rejects(()=>esc.transitionEscrow(s.id,'release_approved',{actor:{id:'worker',role:'system'},gateContext:OK}),/cannot request transaction action/);
  const t=await esc.transitionEscrow(s.id,'release_approved',{actor:{id:'rev-1',role:'reviewer'},gateContext:OK});
  assert.equal(t.status,'release_approved');
});
test('transition: invalid jump is rejected',async()=>{install();const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.transitionEscrow(s.id,'released_sandbox',{actor:{id:'b1',role:'buyer'}}),/invalid escrow transition/);});
test('transition: forward move blocked when server gates fail',async()=>{install();const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:{...OK,fraud_block:true}}),/gate failed/);assert.equal(db.escrow_trust_sessions[0].status,'eligible');});
test('read: unrelated buyer cannot read/list another participant transaction',async()=>{install();const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});await assert.rejects(()=>esc.getSession(s.id,{id:'other',role:'buyer'}),/not visible/);assert.deepEqual(await esc.listSessionsForVin(VIN,{id:'other',role:'buyer'}),[]);});

// ── Legacy bespoke webhook ────────────────────────────────────────────────────────────────────
// Phase 6 RETIRED it (escrowTrustService.ingestEscrowWebhook + POST /api/escrow/webhook now answers
// HTTP 410). The three tests below used to assert that a signed legacy payload could set
// `funded_sandbox` directly — i.e. they encoded the removed defect that an HMAC alone establishes
// money truth. Provider-confirmed money state now arrives only via marketplacePaymentService /
// PaymentProvider reconciliation, so what must be proven is that this path has NO write authority.
test('webhook: retired legacy webhook can never apply provider money truth',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  await esc.transitionEscrow(s.id,'initiated',{actor:{id:'b1',role:'buyer'},gateContext:OK});
  const body={session_id:s.id,to_status:'funded_sandbox',event_type:'payment',gate_context:{fraud_block:true}};
  const payload=JSON.stringify(body);
  const ts=String(Date.now());
  const sig=websec.sign('escrow_trust_sandbox',payload,ts);
  const out=await esc.ingestEscrowWebhook({payloadString:payload,signature:sig,timestamp:ts,idempotencyKey:'w1',body});
  assert.equal(out.applied,false);
  assert.equal(out.reason,'legacy_webhook_disabled_use_payment_provider');
  assert.equal(out.signature_valid,false);
  assert.equal(db.escrow_trust_sessions[0].status,'initiated');
  assert.equal(db.escrow_trust_webhook_events.length,0);
});
test('webhook: signed payload cannot assert a non-provider state',async()=>{
  install();
  const s=await esc.requestEscrow(VIN,INPUT(),{id:'b1',role:'buyer'});
  const body={session_id:s.id,to_status:'release_approved',event_type:'payment'};
  const payload=JSON.stringify(body);
  const ts=String(Date.now());
  const sig=websec.sign('escrow_trust_sandbox',payload,ts);
  const out=await esc.ingestEscrowWebhook({payloadString:payload,signature:sig,timestamp:ts,idempotencyKey:'w-non-provider',body});
  assert.equal(out.applied,false);
  assert.equal(out.reason,'legacy_webhook_disabled_use_payment_provider');
  assert.equal(db.escrow_trust_sessions[0].status,'eligible');
});
test('webhook: bad signature is never applied',async()=>{
  install();
  const out=await esc.ingestEscrowWebhook({payloadString:'{}',signature:'bad',timestamp:String(Date.now()),idempotencyKey:'w2',body:{session_id:'x',to_status:'funded_sandbox'}});
  assert.equal(out.applied,false);
  assert.equal(out.signature_valid,false);
  assert.equal(db.escrow_trust_sessions.length,0);
});
