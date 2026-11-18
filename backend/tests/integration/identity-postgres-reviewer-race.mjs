/** Real PostgreSQL reviewer-service integration test; disposable loopback DB only. */
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
const url = process.env.CARUP_IDV_TEST_DATABASE_URL;
if (process.env.CARUP_IDV_TEST_DISPOSABLE !== 'yes' || !url) throw new Error('Explicit disposable local database required.');
const u = new URL(url);
if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || !u.pathname.slice(1).startsWith('carup_idv_test_') || u.search || u.hash) throw new Error('Refusing nonlocal or non-disposable database URL.');
const { Client } = await import('pg');
const { reviewVerificationSession } = await import('../../services/identity/verificationSessionService.js');
const db = new Client({ connectionString:url });
const competitor = new Client({ connectionString:url });
await db.connect(); await competitor.connect();
function identifier(v) { if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw new Error('Unsafe identifier'); return '"'+v+'"'; }
class Query {
  constructor(table, hook) { this.table=table; this.hook=hook; this.filters=[]; this.mode='select'; this.payload=null; this.limitN=null; }
  select() { return this; } eq(k,v) { this.filters.push([k,v]); return this; } limit(n) { this.limitN=n; return this; }
  update(p) { this.mode='update'; this.payload=p; return this; } insert(p) { this.mode='insert'; this.payload=p; return this; }
  async execute() {
    try {
      const table=identifier(this.table); let sql,params=[];
      if (this.mode==='insert') { const keys=Object.keys(this.payload);params=keys.map(k=>this.payload[k]);sql=`INSERT INTO ${table} (${keys.map(identifier).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`; }
      else {
        const where=()=>this.filters.map(([k,v])=>{params.push(v);return `${identifier(k)} = $${params.length}`}).join(' AND ') || 'TRUE';
        if(this.mode==='update') { const keys=Object.keys(this.payload);params=keys.map(k=>this.payload[k]);const sets=keys.map((k,i)=>`${identifier(k)}=$${i+1}`).join(',');sql=`UPDATE ${table} SET ${sets} WHERE ${where()} RETURNING *`; }
        else sql=`SELECT * FROM ${table} WHERE ${where()}${this.limitN ? ` LIMIT ${Number(this.limitN)}` : ''}`;
      }
      const result=await db.query(sql,params);
      if(this.mode==='insert' && this.table==='verification_decisions' && this.hook) await this.hook();
      return { data:result.rows, error:null };
    } catch(e) { return { data:null,error:{ message:e.message,code:e.code } }; }
  }
  async maybeSingle(){const r=await this.execute();return {...r,data:r.data?.[0]||null};}
  async single(){return this.maybeSingle();}
  then(resolve,reject){return this.execute().then(resolve,reject);}
}
const client = hook => ({
  from: table => new Query(table,hook),
  async rpc(name, args) {
    try {
      if (name === 'record_verification_decision_with_event_atomic') {
        if (hook) await hook();
        const p = [args.p_session_id,args.p_expected_version,JSON.stringify(args.p_decision),JSON.stringify(args.p_update),args.p_event_type,args.p_request_id,args.p_ip_address,args.p_user_agent];
        const result = await db.query('SELECT record_verification_decision_with_event_atomic($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) AS result', p);
        return { data: result.rows[0].result, error: null };
      }
      if (name !== 'claim_verification_ocr_submission') throw new Error('Unexpected RPC');
      const p = [args.p_session_id,args.p_user_id,args.p_expected_version,args.p_expected_status,args.p_actor_role,args.p_actor_tenant_id,args.p_request_id,args.p_ip_address,args.p_user_agent];
      const result = await db.query('SELECT claim_verification_ocr_submission($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result', p);
      return { data: result.rows[0].result, error: null };
    } catch(e) { return { data: null, error: { message: e.message, code: e.code } }; }
  },
});
const session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
try {
  if (!(await db.query("SELECT to_regclass('public.verification_applicant_confirmations') AS table_name")).rows[0].table_name) throw new Error('Run the disposable migration harness first.');
  await db.query("INSERT INTO users(id,name,email,role,join_date) VALUES ('test-reviewer','Synthetic Reviewer','reviewer@example.invalid','admin','2026-01-01') ON CONFLICT (id) DO NOTHING");
  await db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,ocr_started_at,ocr_result,ocr_execution_status,workflow_phase,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','pending_manual_review',1,now(),'{\"first_name\":\"Synthetic\"}','provider_succeeded','reviewer_action_required','fixture/front','fixture/selfie')",[session]);
  let confirmation;
  const interleave=async()=>{confirmation=(await competitor.query("SELECT confirm_verification_ocr_fields($1,'test-owner',1,$2,'{\"first_name\":\"Synthetic\"}'::jsonb) AS result",[session,token])).rows[0].result};
  await assert.rejects(()=>reviewVerificationSession(client(interleave),{id:'test-reviewer',role:'admin'},session,{action:'reject',reasonCode:'NON_DOCUMENT',applicantMessage:'Synthetic message'}),/changed|cannot be applied/i);
  assert.equal(confirmation.code,'OK');
  const after=await db.query('SELECT status,version FROM verification_sessions WHERE id=$1',[session]);
  assert.equal(after.rows[0].status,'pending_manual_review'); assert.equal(after.rows[0].version,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[session])).rows[0].n,0);
  const req={headers:{'x-idempotency-key':'lr06-review-key'}};
  const body={action:'add_internal_note',internalNote:'Synthetic reviewer note'};
  const decision=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},session,body,{req});
  assert.equal(decision.session.review_notes,'Synthetic reviewer note');
  assert.equal(Object.hasOwn(decision.session,'front_storage_path'),false);
  const replay=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},session,body,{req});
  assert.equal(replay.idempotent_replay,true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[session])).rows[0].n,1);
  const eventCase='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,ocr_started_at,ocr_result,ocr_execution_status,workflow_phase,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','pending_manual_review',1,now(),'{}','provider_succeeded','reviewer_action_required','fixture/front','fixture/selfie')",[eventCase]);
  const eventReq={headers:{'x-idempotency-key':'lr08-event-key'}};
  const eventBody={action:'reject',reasonCode:'NON_DOCUMENT',applicantMessage:'Synthetic message'};
  await db.query("CREATE FUNCTION lr08_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture outbox failure'; END $$; CREATE TRIGGER lr08_fail_event BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION lr08_fail_event()");
  try {
    await assert.rejects(()=>reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,eventBody,{req:eventReq}),/audit or update failed/i);
    assert.equal((await competitor.query('SELECT version FROM verification_sessions WHERE id=$1',[eventCase])).rows[0].version,1);
    assert.equal((await competitor.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[eventCase])).rows[0].n,0);
  } finally { await db.query('DROP TRIGGER lr08_fail_event ON domain_events; DROP FUNCTION lr08_fail_event()'); }
  await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,eventBody,{req:eventReq});
  await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,eventBody,{req:eventReq});
  assert.equal((await competitor.query("SELECT count(*)::int AS n FROM domain_events WHERE payload->>'sessionId'=$1",[eventCase])).rows[0].n,1);
  console.log('PASS failed event insertion rollback and exactly one event after retry and replay');
  console.log('PASS actual reviewer service, competing confirmation on a second connection, safe replay and private projection');
} finally { await competitor.end(); await db.end(); }
