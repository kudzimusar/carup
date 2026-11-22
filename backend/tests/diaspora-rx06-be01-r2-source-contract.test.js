/** R2 security contract. Run inside patched CarUp backend against in-memory fixtures.
 * Not a substitute for A1-A14/B1-B18 PostgreSQL and HTTP certification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { isOrderOwner, canReadImportOrder, isAssignedParticipant, canTransitionImportOrderForContext } = await import('../services/diaspora/diasporaAuthorization.js');
const { projectDiasporaAudit } = await import('../services/diaspora/diasporaAuditService.js');
const mkOrder = (extra={}) => ({id:'order-1',tenant_id:'tenant-1',buyer_id:'buyer-1',created_by:'buyer-1',updated_by:'stranger',status:'SELLER_ASSIGNED',...extra});
const buyer={id:'buyer-1',role:'owner',platformRole:'owner',tenantId:null};
const stranger={id:'stranger',role:'owner',platformRole:'owner',tenantId:null};
const assignedSeller={id:'seller-1',platformRole:'dealer',role:'dealer',tenantId:null};
const reviewer={id:'reviewer-1',platformRole:'reviewer',role:'reviewer',tenantId:null};
const p=(status='PENDING_REVIEW',extra={})=>({user_id:'seller-1',tenant_id:'tenant-1',verification_status:status,deleted_at:null,...extra});

test('F16: last writer/updated_by is never order owner; buyer remains owner',()=>{
  assert.equal(isOrderOwner(mkOrder(),stranger),false);
  assert.equal(isOrderOwner(mkOrder(),buyer),true);
  assert.equal(canReadImportOrder(mkOrder(),[],stranger),false);
  assert.equal(canTransitionImportOrderForContext(mkOrder(),[],'CANCELLED',stranger),false);
});
test('F15: active, explicitly assigned same-tenant seller retains legitimate access',()=>{
  assert.equal(isAssignedParticipant([p()],assignedSeller,mkOrder()),true);
  assert.equal(canReadImportOrder(mkOrder(),[p()],assignedSeller),true);
  assert.equal(canTransitionImportOrderForContext(mkOrder(),[p()],'QUOTE_ISSUED',assignedSeller),true);
  assert.equal(canTransitionImportOrderForContext(mkOrder(),[p()],'CANCELLED',assignedSeller),false);
});
for(const status of ['REVOKED','DELETED','SUSPENDED','INACTIVE','REMOVED','CANCELLED','REJECTED']) {
  test(`F15: ${status} participant denied`,()=>assert.equal(canReadImportOrder(mkOrder(),[p(status)],assignedSeller),false));
}
test('F15: soft-deleted and wrong-tenant participant denied',()=>{
  assert.equal(canReadImportOrder(mkOrder(),[p('VERIFIED',{deleted_at:'2026-01-01'})],assignedSeller),false);
  assert.equal(canReadImportOrder(mkOrder(),[p('VERIFIED',{tenant_id:'tenant-2'})],assignedSeller),false);
});
const auditRow={id:'audit-1',import_order_id:'order-1',tenant_id:'tenant-1',actor_id:'buyer-1',action:'QUOTE_ISSUED',resource_type:'diaspora_import_quote',resource_id:'quote-1',previous_state:{secret:'previous'},new_state:{budget_amount:60000},metadata:{token:'fictional'},cryptographic_seal:'abc123',ip_address:'198.51.100.1',user_agent:'test',verification_status:'VERIFIED',created_at:'2026-11-22T00:00:00Z'};
test('C01 (R2C): the patched import-order service module itself loads and exports addQuote',async()=>{
  // R2 as delivered never imported this module, so a generated syntax error and the missing
  // addQuote export both passed this suite. Loading it here makes either failure fatal.
  const svc=await import('../services/diaspora/diasporaImportOrderService.js');
  assert.equal(typeof svc.addQuote,'function');
  assert.equal(typeof svc.assignSeller,'function');
});
test('B16 (R2C contract): safe audit projection = four redacted keys plus derived non-sensitive fields; reviewer sees forensic fields',()=>{
  const sanitized=projectDiasporaAudit(auditRow,buyer);
  assert.deepEqual(Object.keys(sanitized).sort(),['id','action','resource_type','created_at','actor_relation','sealed'].sort());
  for(const k of ['previous_state','new_state','metadata','actor_id','ip_address','user_agent','cryptographic_seal','tenant_id','resource_id']) assert.equal(k in sanitized,false,k);
  assert.equal(JSON.stringify(sanitized).includes('budget_amount'),false);
  assert.equal(JSON.stringify(sanitized).includes('198.51.100'),false);
  assert.equal(projectDiasporaAudit(auditRow,reviewer).new_state.budget_amount,60000);
  assert.equal(projectDiasporaAudit(auditRow,stranger).new_state,undefined);
});
test('F1/F17/B17: routes enforce order before protected footprint and audit reads',()=>{
  const src=readFileSync(new URL('../routes/diasporaRoutes.js',import.meta.url),'utf8');
  const handlers=['/import-orders/:id/government-footprint','/import-orders/:id/audit','/import-orders/:id/stages'];
  for(const route of handlers){
    const at=src.indexOf(`router.get('${route}'`);
    assert.ok(at>=0,route+' exists');
    const body=src.slice(at,src.indexOf('}));',at)+4);
    assert.ok(body.includes('await getImportOrder(req.params.id, req.userContext)'),route+' canonical order read');
    if(route.endsWith('audit')||route.endsWith('stages')) assert.ok(body.includes('authorizedOrder: order'));
  }
});
test('F13/F15: no direct quote or participant writes in corrected entrypoint service',()=>{
  const s=readFileSync(new URL('../services/diaspora/diasporaImportOrderService.js',import.meta.url),'utf8');
  const assign=s.slice(s.indexOf('export async function assignSeller('),s.indexOf('export async function addQuote('));
  const quote=s.slice(s.indexOf('export async function addQuote('),s.indexOf('/** Milestone statuses'));
  assert.match(assign,/diaspora_assign_import_seller_atomic/);
  assert.match(quote,/diaspora_issue_import_quote_atomic/);
  assert.doesNotMatch(assign,/\.insert\(/);
  assert.doesNotMatch(quote,/\.insert\(/);
});
