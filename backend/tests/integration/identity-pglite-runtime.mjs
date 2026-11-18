/**
 * LR06: embedded PostgreSQL diagnostic. PGlite is one PostgreSQL session;
 * deterministic interleavings here do not prove separate-connection races.
 * PGLITE_DIST_DIR must point to a local @electric-sql/pglite/dist directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
const dist = process.env.PGLITE_DIST_DIR;
if (!dist) throw new Error('PGLITE_DIST_DIR must identify an existing local PGlite dist directory');
const load = suffix => import(pathToFileURL(path.join(dist, suffix)).href);
const { PGlite } = await load('index.js');
const { pgcrypto } = await load('contrib/pgcrypto.js');
const { uuid_ossp } = await load('contrib/uuid_ossp.js');
const { reviewVerificationSession, submitVerificationSession, uploadVerificationSessionImage } = await import('../../services/identity/verificationSessionService.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const db = new PGlite({ extensions: { pgcrypto, 'uuid-ossp': uuid_ossp } });
let failed = false;
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed = true; console.error(`FAIL ${name}: ${e.message}`); } }
const sqlFiles = ['supabase_schema.sql','011_phase6_schema.sql','20260621170000_outbox_dead_letter.sql','20260613000000_phase7b_supabase_auth_and_identity.sql','20260605042424_verification_sessions_phase7b.sql','20260613020000_verification_admin_review.sql','20260618030000_verification_ocr_provenance.sql','20260618040000_verification_case_management.sql','20260618050000_verification_evidence_trust_columns.sql','20260603233640_governance_foundation_trust_audit_events.sql','20261117210000_identity_applicant_ocr_confirmation.sql','20261117220000_identity_atomic_submission_claim.sql','20261117230000_identity_decision_outbox_atomic.sql','20261118010000_identity_reviewer_independence.sql'];
const session='11111111-1111-4111-8111-111111111111', second='33333333-3333-4333-8333-333333333333', third='44444444-4444-4444-8444-444444444444';
const token='22222222-2222-4222-8222-222222222222';
const fields={first_name:'Synthetic',last_name:'Example',national_id_number:'TEST'};
const confirm = (id,user,version,key,value=fields) => db.query('SELECT confirm_verification_ocr_fields($1,$2,$3,$4,$5::jsonb) AS result',[id,user,version,key,JSON.stringify(value)]).then(r=>r.rows[0].result);
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
try {
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean);');
 await check('selected actual CarUp migration chain',async()=>{for(const file of sqlFiles){let sql=fs.readFileSync(path.join(root,'database/migrations',file),'utf8');if(file==='supabase_schema.sql')sql=sql.split('-- SEED DATA')[0];if(file==='011_phase6_schema.sql' || file==='20260621170000_outbox_dead_letter.sql')sql=sql.split('-- +migrate Down')[0];await db.exec(sql)}});
 await check('candidate migration repeatability',async()=>{for(const file of sqlFiles.slice(-4))await db.exec(fs.readFileSync(path.join(root,'database/migrations',file),'utf8'))});
 await db.exec("INSERT INTO users(id,name,email,role,join_date) VALUES ('test-owner','Synthetic','owner@example.invalid','owner','2026-01-01'),('test-reviewer','Synthetic Reviewer','reviewer@example.invalid','admin','2026-01-01');");
 await check('RPC grants and RLS',async()=>{const r=await db.query("SELECT has_function_privilege('anon','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') AS anon,has_function_privilege('authenticated','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') AS authenticated,has_function_privilege('service_role','public.confirm_verification_ocr_fields(uuid,text,integer,uuid,jsonb)','EXECUTE') AS service,relrowsecurity AS rls FROM pg_class WHERE oid='public.verification_applicant_confirmations'::regclass");assert.deepEqual(r.rows[0],{anon:false,authenticated:false,service:true,rls:true})});
 await check('only service role can call event-producing decision RPC; legacy entry point fails closed',async()=>{
   const r=await db.query("SELECT has_function_privilege('service_role','public.record_verification_decision_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') AS legacy,has_function_privilege('anon','public.record_verification_decision_with_event_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') AS anon,has_function_privilege('authenticated','public.record_verification_decision_with_event_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') AS authenticated,has_function_privilege('service_role','public.record_verification_decision_with_event_atomic(uuid,integer,jsonb,jsonb,text,text,text,text)','EXECUTE') AS service");
   assert.deepEqual(r.rows[0],{legacy:false,anon:false,authenticated:false,service:true});
 });
 await check('anonymous cannot execute claim or read confirmation table',async()=>{
   await db.exec('SET ROLE anon');
   try {
     await assert.rejects(()=>db.query("SELECT claim_verification_ocr_submission('11111111-1111-4111-8111-111111111111','other',1,'uploaded',NULL,NULL,NULL,NULL,NULL)"), /permission denied/i);
     await assert.rejects(()=>db.query('SELECT * FROM verification_applicant_confirmations'), /permission denied/i);
   } finally { await db.exec('RESET ROLE'); }
 });
 const makeSession = id => db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,ocr_started_at,ocr_result,ocr_execution_status,workflow_phase,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','pending_manual_review',1,now(),'{\"first_name\":\"Synthetic\"}','provider_succeeded','reviewer_action_required','private/front','private/selfie')",[id]);
 await makeSession(session);
 await check('own-case review is refused by service and database',async()=>{
   await assert.rejects(()=>reviewVerificationSession(client(),{id:'test-owner',role:'admin'},session,{action:'reject',reasonCode:'NON_DOCUMENT'}),/cannot decide their own/i);
   await assert.rejects(()=>db.query("INSERT INTO verification_decisions(id,session_id,decision,reviewer_id) VALUES ('self-decision',$1,'reject','test-owner')",[session]),/Independent reviewer required/i);
   await db.exec('SET ROLE service_role');
   try {
     await assert.rejects(()=>db.query("SELECT record_verification_decision_with_event_atomic($1,1,$2::jsonb,'{}'::jsonb,'TEST',NULL,NULL,NULL)",[session,JSON.stringify({id:'self-rpc',session_id:session,decision:'reject',reviewer_id:'test-owner'})]),/Independent reviewer required/i);
   } finally { await db.exec('RESET ROLE'); }
   assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[session])).rows[0].n,0);
   assert.equal((await db.query('SELECT version FROM verification_sessions WHERE id=$1',[session])).rows[0].version,1);
 });
 await check('service-role confirmation, replay, changed payload and ownership',async()=>{
   await db.exec('SET ROLE service_role');
   try {
     const first=await confirm(session,'test-owner',1,token); assert.equal(first.code,'OK');
     assert.equal((await confirm(session,'test-owner',1,token)).replayed,true);
     assert.equal((await confirm(session,'test-owner',1,token,{...fields,first_name:'Changed'})).code,'IDEMPOTENCY_CONFLICT');
     assert.equal((await confirm(session,'other',1,token)).code,'NOT_FOUND');
     const r=await db.query('SELECT original_observations,applicant_fields FROM verification_applicant_confirmations WHERE session_id=$1',[session]);
     assert.equal(r.rows[0].original_observations.first_name,'Synthetic'); assert.equal(r.rows[0].applicant_fields.last_name,'Example');
   } finally { await db.exec('RESET ROLE'); }
 });
 await makeSession(second);
 await check('confirmation rolls back on failed audit',async()=>{await db.exec("CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit blocked'; END $$; CREATE TRIGGER test_audit_fail BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_audit();");await assert.rejects(()=>confirm(second,'test-owner',1,token));const r=await db.query('SELECT version,ocr_confirmed_at FROM verification_sessions WHERE id=$1',[second]);assert.equal(r.rows[0].version,1);assert.equal(r.rows[0].ocr_confirmed_at,null);assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_applicant_confirmations WHERE session_id=$1',[second])).rows[0].n,0);await db.exec('DROP TRIGGER test_audit_fail ON trust_audit_events; DROP FUNCTION test_fail_audit()')});
 await makeSession(third);
 await check('actual reviewer operation rejects stale session after confirmation',async()=>{let confirmed;const c=client(async()=>{confirmed=await confirm(third,'test-owner',1,token)});await assert.rejects(()=>reviewVerificationSession(c,{id:'test-reviewer',role:'admin'},third,{action:'reject',reasonCode:'NON_DOCUMENT',applicantMessage:'Please contact support.'}),/changed|cannot be applied/i);assert.equal(confirmed.code,'OK');const r=await db.query('SELECT status,version FROM verification_sessions WHERE id=$1',[third]);assert.equal(r.rows[0].status,'pending_manual_review');assert.equal(r.rows[0].version,2);const rows=await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[third]);assert.equal(rows.rows[0].n,0)});
 const reviewSuccess='66666666-6666-4666-8666-666666666666';
 await makeSession(reviewSuccess);
 await check('reviewer decision, audit and idempotent replay',async()=>{
   const req={headers:{'x-idempotency-key':'review-fixture-key'}};
   const payload={action:'add_internal_note',internalNote:'Synthetic review note'};
   const first=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},reviewSuccess,payload,{req});
   assert.equal(first.session.review_notes,'Synthetic review note');
   assert.equal(first.session.revision,2);
   assert.equal(Object.hasOwn(first.session,'front_storage_path'),false);
   const replay=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},reviewSuccess,payload,{req});
   assert.equal(replay.idempotent_replay,true);
   await assert.rejects(()=>reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},reviewSuccess,{...payload,internalNote:'Changed'},{req}),/idempotency/i);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[reviewSuccess])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM trust_audit_events WHERE new_value->>'session_id'=$1",[reviewSuccess])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM domain_events WHERE payload->>'sessionId'=$1",[reviewSuccess])).rows[0].n,0);
 });
 const reviewFailure='77777777-7777-4777-8777-777777777777';
 await makeSession(reviewFailure);
 await check('reviewer audit failure rolls back decision and case',async()=>{
   await db.exec("CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit blocked'; END $$; CREATE TRIGGER test_audit_fail BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_audit();");
   await assert.rejects(()=>reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},reviewFailure,{action:'add_internal_note',internalNote:'Not persisted'}),/audit or update failed/i);
   const c=(await db.query('SELECT status,version,review_notes FROM verification_sessions WHERE id=$1',[reviewFailure])).rows[0];
   assert.equal(c.version,1);assert.equal(c.review_notes,null);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[reviewFailure])).rows[0].n,0);
   await db.exec('DROP TRIGGER test_audit_fail ON trust_audit_events; DROP FUNCTION test_fail_audit()');
 });
 const eventCase='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await makeSession(eventCase);
 await check('event insertion failure rolls back decision, case and audit; retry and replay produce one event',async()=>{
   const req={headers:{'x-idempotency-key':'event-retry-key'}};
   const body={action:'reject',reasonCode:'NON_DOCUMENT',applicantMessage:'Synthetic retry message'};
   await db.exec("CREATE FUNCTION test_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END $$; CREATE TRIGGER test_outbox_fail BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION test_fail_event();");
   await assert.rejects(()=>reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,body,{req}),/audit or update failed/i);
   assert.equal((await db.query('SELECT version FROM verification_sessions WHERE id=$1',[eventCase])).rows[0].version,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM verification_decisions WHERE session_id=$1',[eventCase])).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM trust_audit_events WHERE new_value->>'session_id'=$1",[eventCase])).rows[0].n,0);
   await db.exec('DROP TRIGGER test_outbox_fail ON domain_events; DROP FUNCTION test_fail_event()');
   const first=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,body,{req});
   const replay=await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},eventCase,body,{req});
   assert.equal(replay.idempotent_replay,true);
   const rows=(await db.query("SELECT * FROM domain_events WHERE payload->>'sessionId'=$1",[eventCase])).rows;
   assert.equal(rows.length,1); assert.equal(rows[0].status,'pending');
   assert.equal(rows[0].payload.decisionId,first.decision.id);
   assert.equal(rows[0].payload.recipientUserId,'test-owner');
   await assert.rejects(()=>db.query('INSERT INTO domain_events(event_type,payload) VALUES ($1,$2::jsonb)',[rows[0].event_type,JSON.stringify(rows[0].payload)]),/duplicate key/i);
 });
 const secondEventCase='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await makeSession(secondEventCase);
 await check('service role records distinct decisions for the same applicant',async()=>{
   await db.exec('SET ROLE service_role');
   try {
     await reviewVerificationSession(client(),{id:'test-reviewer',role:'admin'},secondEventCase,{action:'reject',reasonCode:'NON_DOCUMENT',applicantMessage:'Synthetic second case'});
   } finally { await db.exec('RESET ROLE'); }
   const rows=(await db.query("SELECT payload->>'decisionId' AS decision_id FROM domain_events WHERE payload->>'recipientUserId'='test-owner' ORDER BY created_at")).rows;
   assert.equal(rows.length,2); assert.notEqual(rows[0].decision_id,rows[1].decision_id);
 });
 await check('existing outbox worker retries and delivers decision event',async()=>{
   const {eventWorker}=await import('../../services/eventBus/eventWorker.js');
   let calls=0;
   eventWorker.subscribe('identity.verification.decided',async(payload,_client,_tenant,event)=>{
     assert.equal(event.payload.decisionId,payload.decisionId);
     if (++calls===1) throw new Error('synthetic delivery failure');
   });
   let event=(await db.query("SELECT * FROM domain_events WHERE payload->>'sessionId'=$1",[eventCase])).rows[0];
   await eventWorker.processEvent(db,event);
   event=(await db.query('SELECT * FROM domain_events WHERE id=$1',[event.id])).rows[0];
   assert.equal(event.status,'pending'); assert.equal(event.attempts,1);
   await eventWorker.processEvent(db,event);
   event=(await db.query('SELECT * FROM domain_events WHERE id=$1',[event.id])).rows[0];
   assert.equal(event.status,'processed'); assert.equal(event.attempts,2); assert.equal(calls,2);
 });
 const submissionSuccess='88888888-8888-4888-8888-888888888888';
 await db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','uploaded',1,'private/front','private/selfie')",[submissionSuccess]);
 await check('atomic submission and audit succeed without provider',async()=>{
   const result=await submitVerificationSession(client(),{id:'test-owner',role:'owner'},submissionSuccess);
   assert.equal(result.status,'ocr_failed');
   assert.equal(Object.hasOwn(result,'front_storage_path'),false);
   const a=await db.query("SELECT count(*)::int AS n FROM trust_audit_events WHERE event_type='VERIFICATION_SUBMITTED' AND new_value->>'session_id'=$1",[submissionSuccess]);
   assert.equal(a.rows[0].n,1);
 });
 const uploadCase='99999999-9999-4999-8999-999999999999';
 await db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','uploaded',1,'private/old','private/selfie')",[uploadCase]);
 await check('conflicting upload removes unattached private object',async()=>{
   let cleaned=0;
   const storage={ uploadToStorage:async()=>{await db.query("UPDATE verification_sessions SET status='ocr_pending', version=version+1 WHERE id=$1",[uploadCase])}, removeFromStorage:async()=>{cleaned++} };
   await assert.rejects(()=>uploadVerificationSessionImage(client(),{id:'test-owner',role:'owner'},uploadCase,'front',{image:'data:image/jpeg;base64,YWJj'},{storage}),/changed while/i);
   assert.equal(cleaned,1);
   assert.equal((await db.query('SELECT front_storage_path FROM verification_sessions WHERE id=$1',[uploadCase])).rows[0].front_storage_path,'private/old');
 });
 const submission='55555555-5555-4555-8555-555555555555';
 await db.query("INSERT INTO verification_sessions(id,user_id,document_type,status,version,front_storage_path,selfie_storage_path) VALUES ($1,'test-owner','passport','uploaded',1,'private/front','private/selfie')",[submission]);
 await check('submission audit failure is observable',async()=>{await db.exec("CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit blocked'; END $$; CREATE TRIGGER test_audit_fail BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_audit();");await assert.rejects(()=>submitVerificationSession(client(),{id:'test-owner',role:'owner'},submission,{ocr:{}}),/audit or claim failed/i);const r=await db.query('SELECT status,version FROM verification_sessions WHERE id=$1',[submission]);assert.equal(r.rows[0].status,'uploaded');assert.equal(r.rows[0].version,1);assert.equal((await db.query("SELECT count(*)::int AS n FROM trust_audit_events WHERE event_type='VERIFICATION_SUBMITTED' AND new_value->>'session_id'=$1",[submission])).rows[0].n,0);await db.exec('DROP TRIGGER test_audit_fail ON trust_audit_events; DROP FUNCTION test_fail_audit()')});
} catch(e) {failed=true;console.error('FATAL',e.message);} finally {await db.close();}
console.log(failed?'VERDICT REMEDIATION_REQUIRED':'VERDICT EMBEDDED_CHECKS_PASS');
if(failed)process.exitCode=1;
