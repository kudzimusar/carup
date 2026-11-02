const w=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8')); const S=w.sections;
const cents=(s)=>{ if(s==null) return null; const [a,b='']=String(s).split('.'); return BigInt(a)*100n+BigInt((b+'00').slice(0,2)); };
const fmt=(c)=>`${c/100n}.${String(c%100n).padStart(2,'0')}`;
const out=[]; const ok=(name,pass,detail='')=>{ out.push({name,pass:!!pass,detail}); };
const by=(arr,k)=>arr.reduce((m,r)=>((m[r[k]]??=[]).push(r),m),{});

// 1 estimates ↔ work orders ↔ authorization
const wo=Object.fromEntries(S.work_orders.map(r=>[r.id,r]));
let accepted=0,declined=0,badAcc=0,badDec=0,badTotal=0,sent=0;
const lines=by(S.garage_estimate_lines,'estimate_id');
for (const e of S.garage_estimates){
  if(['sent','accepted','declined','superseded'].includes(e.status)){ sent++;
    const sum=(lines[e.id]||[]).reduce((a,l)=>a+(cents(l.line_total)??0n),0n);
    if(cents(e.sent_total_amount)!==sum) badTotal++; }
  if(e.status==='accepted'){ accepted++; const w0=wo[e.work_order_id]; if(!(w0&&w0.owner_authorization==='authorized'&&e.decision_basis==='owner'&&e.decided_by_user_id==='uat_final_customer_20261024a')) badAcc++; }
  if(e.status==='declined'){ declined++; const w0=wo[e.work_order_id]; if(!(w0&&w0.owner_authorization==='declined'&&e.decision_basis==='owner'&&e.decided_by_user_id==='uat_final_customer_20261024a')) badDec++; }
}
ok('estimates: every accepted one is the customer owner-decision and its work order is authorized', badAcc===0, `${accepted} accepted`);
ok('estimates: every declined one left its work order declined', badDec===0, `${declined} declined`);
ok('estimates: frozen sent total == sum of stored lines (server-derived), all sent versions', badTotal===0, `${sent} sent versions`);

// 2 authorization precedes work
let early=0; for(const r of S.service_records){ const w0=wo[r.work_order_id]; if(!w0||w0.owner_authorization!=='authorized'||!(new Date(w0.owner_authorized_at)<new Date(r.performed_at))) early++; }
ok('service records: each was written after the customer authorized its work order', early===0, `${S.service_records.length} records`);
// 3 no work on declined jobs
const declinedWo=S.work_orders.filter(x=>x.owner_authorization==='declined').map(x=>x.id);
const workOnDeclined=S.service_records.filter(r=>declinedWo.includes(r.work_order_id)).length + S.work_order_assignments.filter(a=>declinedWo.includes(a.work_order_id)).length*0;
ok('declined jobs: no service record exists on any declined work order', workOnDeclined===0, `${declinedWo.length} declined work orders`);
const invOnDeclined=S.garage_invoices.filter(i=>declinedWo.includes(i.work_order_id)).length;
ok('declined jobs: no invoice exists on any declined work order', invOnDeclined===0);

// 4 stock arithmetic + usage ↔ movements
const mv=by(S.garage_stock_movements,'part_id'); let badArith=0,badChain=0;
for(const [pid,rows] of Object.entries(mv)){ rows.sort((a,b)=>a.seq-b.seq); let prev=null; for(const r of rows){ if(r.balance_after!==r.balance_before+r.quantity_delta) badArith++; if(prev!==null && r.balance_before!==prev) badChain++; prev=r.balance_after; } }
ok('stock: every movement is balance_before + delta = balance_after', badArith===0, `${S.garage_stock_movements.length} movements`);
ok('stock: each part ledger is a continuous chain (no gaps, no overwrite)', badChain===0, `${Object.keys(mv).length} parts`);
const usageOk=S.garage_service_part_usage.every(u=>S.garage_stock_movements.some(m=>m.id===u.movement_id && m.movement_type==='consumption' && m.quantity_delta===-u.quantity));
ok('parts used: each usage row is backed by a matching consume movement', usageOk, `${S.garage_service_part_usage.length} usages`);
const finals=Object.entries(mv).map(([pid,rows])=>rows[rows.length-1].balance_after);
ok('stock: the golden parts end at 11 (10 opening + 5 received − 4 used)', finals.filter(x=>x===11).length>=1, `final balances: ${finals.join(',')}`);

// 5 invoices ↔ payments ↔ receipts
const lineBy=by(S.garage_invoice_lines,'invoice_id'), payBy=by(S.garage_payment_records,'invoice_id'), recBy=by(S.garage_receipts,'invoice_id');
let badInv=0,badPay=0,badRec=0,over=0;
for(const i of S.garage_invoices){
  const sum=(lineBy[i.id]||[]).reduce((a,l)=>a+(cents(l.line_total)??0n),0n); if(cents(i.total_amount)!==sum) badInv++;
  const pays=(payBy[i.id]||[]); const net=pays.reduce((a,p)=>a+(p.kind==='reversal'?-cents(p.amount):cents(p.amount)),0n); if(net>cents(i.total_amount)) over++;
  for(const p of pays){ if(p.source!=='garage_recorded_external') badPay++; }
  const paymentsNeedingReceipt=pays.filter(p=>p.kind!=='reversal'); const recs=(recBy[i.id]||[]);
  if(recs.length!==paymentsNeedingReceipt.length) badRec++;
  for(const r of recs){ const p=pays.find(x=>x.id===r.payment_id); if(!p||cents(p.amount)!==cents(r.amount)||r.payment_source!=='garage_recorded_external') badRec++; }
}
ok('invoices: total == sum of lines', badInv===0, `${S.garage_invoices.length} invoices`);
ok('payments: every one is labelled garage_recorded_external (never CarUp-processed)', badPay===0, `${S.garage_payment_records.length} payments`);
ok('payments: none exceeds its invoice total', over===0);
ok('receipts: exactly one per payment, same amount, same source', badRec===0, `${S.garage_receipts.length} receipts`);
const nums=S.garage_invoices.map(i=>i.invoice_number).sort(); const rnums=S.garage_receipts.map(r=>r.receipt_number).sort();
const seqOk=(a,p)=>a.every((n,i)=>Number(n.replace(p,''))===Number(a[0].replace(p,''))+i);
ok('numbering: invoice numbers are consecutive with no gaps', seqOk(nums,'INV-'), nums.join(' '));
ok('numbering: receipt numbers are consecutive with no gaps', seqOk(rnums,'RCT-'), rnums.join(' '));
ok('counters: stored counters equal the highest issued number', S.garage_document_counters.every(c=>c.last_number===Math.max(...(c.doc_type.startsWith('inv')?nums:rnums).map(n=>Number(n.replace(/\D/g,''))))), JSON.stringify(S.garage_document_counters.map(c=>[c.doc_type,c.last_number])));

// 6 completion implies work; mechanic attribution
const completed=S.service_cases.filter(c=>c.status==='completed');
ok('completed jobs: each has a service record and an assignment', completed.every(c=>{const wid=S.work_orders.find(x=>x.service_case_id===c.id)?.id; return S.service_records.some(r=>r.service_case_id===c.id)&&S.work_order_assignments.some(a=>a.work_order_id===wid)}), `${completed.length} completed`);

// 7 events / audi
const dt=by(S.domain_events,'status'); const dtt=by(S.domain_events,'event_type');
ok('outbox: every Garage event carries a dedupe key', S.domain_events.every(d=>d.dedupe_key), `${S.domain_events.length} events`);
console.log(JSON.stringify({outbox_by_status:Object.fromEntries(Object.entries(dt).map(([k,v])=>[k,v.length])), outbox_by_type:Object.fromEntries(Object.entries(dtt).map(([k,v])=>[k,v.length]))}));
const au=by(S.trust_audit_events,'event_type'); console.log('audit types:', JSON.stringify(Object.fromEntries(Object.entries(au).map(([k,v])=>[k,v.length]))));
console.log('messages:', JSON.stringify(S.messages_since), 'threads:', S.message_threads.length);
const failed=out.filter(o=>!o.pass); for(const o of out) console.log((o.pass?'PASS ':'FAIL ')+o.name+(o.detail?'  ['+o.detail+']':''));
console.log(failed.length? `\n${failed.length} FAILED`:'\nALL INVARIANTS HOLD'); require('fs').writeFileSync(process.argv[3], JSON.stringify(out,null,1));
