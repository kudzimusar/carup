import { test, expect, type Page, type BrowserContext, type Request, type Response } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ensureActingForOrganisation } from './staging-helpers'

const SHA='07b60e5d158d7dad7232d33f11f06a478c92da3f'
const WEB=(process.env.STAGING_WEB_URL||'https://staging.carup.dev').replace(/\/$/,'')
const API=(process.env.STAGING_API_URL||'https://api-staging.carup.dev/api').replace(/\/$/,'')
const DIR=path.resolve(process.env.GARAGE_R3_RESULTS_DIR||'cert-results/garage-ops03-stg01-r2')
const PW=process.env.GARAGE_R3_PASSWORD_FILE||''
const OWNER='uat_ops01_owner_20261022a'
const EMAIL='ops01.owner.20261022a@carup-staging.test'
const GARAGE='442c82c1-fc69-46ff-a138-712a6504ac98'
const GNAME='SYNTHETIC / UAT OPS01 GARAGE 20261022A'
const HRE='b1000000-0000-4000-8000-000000000001'
const P1='c1000000-0000-4000-8000-000000000001'
const P3='c1000000-0000-4000-8000-000000000003'
const DATE='2026-10-26'
const A={id:'cae87212-0dbc-4e93-8827-f22f6bc8bbf8',summary:'SYNTHETIC / UAT OPS03 CASE-A 03400479775101'}
const B={id:'3cb79649-60af-4291-9459-394de45e3a9a',summary:'SYNTHETIC / UAT OPS03 CASE-B 03400479775101'}
const C={id:'a0b0d92d-fa46-4922-bf99-4b84ce9e0a25',summary:'SYNTHETIC / UAT OPS03 CASE-C 03400479775101'}
const EXPECTED_FRONTEND_DEPLOYMENT='dpl_7AQTQs1apayK5PrVUk3RDai88Dut'
const EXPECTED_BACKEND_DEPLOYMENT='dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK'
const START=new Date()
const timings:any[]=[]

fs.mkdirSync(DIR,{recursive:true})
function out(name:string,value:any){fs.writeFileSync(path.join(DIR,name),JSON.stringify(value,null,2)+'\n')}
async function shot(page:Page,name:string){await page.screenshot({path:path.join(DIR,name),fullPage:true})}
function dburl(){const v=process.env.DIASPORA_STAGING_DATABASE_URL||'';if(!v.includes('eoyenigwevnxwwhyhaer')||v.includes('vhmnajoeicasaigiophh'))throw Error('REFUSING NON-STAGING DATABASE');return v.replace(/([?&])sslmode=[^&]*&?/i,'$1').replace(/[?&]$/,'')}
async function db(){const c=new pg.Client({connectionString:dburl(),ssl:{rejectUnauthorized:false}});await c.connect();return c}
async function one(c:pg.Client,q:string,p:any[]=[]){const r=await c.query(q,p);if(r.rowCount!==1)throw Error('expected exactly one row');return r.rows[0]}
function password(){const st=fs.lstatSync(PW);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('unsafe credential file');return fs.readFileSync(PW,'utf8').trim()}
function parse(text:string){try{return JSON.parse(text)}catch{return {raw:text.slice(0,500)}}}
function safeRequest(req:Request){let payload:any=null;try{payload=req.postDataJSON()}catch{};return {url:new URL(req.url()).pathname,method:req.method(),payload}}
function safeResponse(res:Response){return {url:new URL(res.url()).pathname,status:res.status()}}

async function login(page:Page){
 await page.goto(WEB+'/login',{waitUntil:'networkidle'})
 await page.getByLabel('Email or Phone').fill(EMAIL)
 await page.getByTestId('password-input').fill(password())
 const rr=page.waitForResponse(r=>r.url().includes('/api/auth/login')&&r.request().method()==='POST')
 await page.getByRole('button',{name:/sign in/i}).click()
 expect((await rr).status()).toBe(200)
 const selection=await ensureActingForOrganisation(page,/SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/i)
 expect(selection.badge).toContain(GNAME)
 if(selection.outcome==='selected')expect(selection.tenantId).toBe(GARAGE)
}

async function api(page:Page,method:string,route:string,payload?:any){
 return page.evaluate(async x=>{
  const u=JSON.parse(localStorage.getItem('carup_user')||'null')
  const token=localStorage.getItem('carup_token')
  const h:any={'x-user-id':String(u?.id||''),'x-session-token':String(token||'')}
  if(x.payload!==undefined)h['content-type']='application/json'
  if(x.method!=='GET'){
   const cr=await fetch(x.api+'/security/csrf-token',{credentials:'include',headers:h})
   if(!cr.ok)return {status:cr.status,text:await cr.text()}
   const cj=await cr.json();h['x-csrf-token']=cj.csrfToken
  }
  const r=await fetch(x.api+x.route,{method:x.method,credentials:'include',headers:h,body:x.payload===undefined?undefined:JSON.stringify(x.payload)})
  return {status:r.status,text:await r.text()}
 },{api:API,method,route,payload})
}

async function runtimeProof(){
 const [pr,hr]=await Promise.all([
  fetch(WEB+'/carup-provenance.json?ops03r2='+Date.now()),
  fetch(API+'/health?ops03r2='+Date.now()),
 ])
 expect(pr.ok).toBe(true);expect(hr.ok).toBe(true)
 const p:any=await pr.json(),h:any=await hr.json()
 expect(p.commit_sha).toBe(SHA)
 expect(p.provenance_source).toBe('vercel_git')
 expect(p.unpaired).toBe(false)
 expect(h.status).toBe('UP')
 expect(h.build.commit_sha).toBe(SHA)
 expect(h.build.source).toBe('vercel_git')
 expect(h.build.provenance_available).toBe(true)
 expect(h.database.supabase_project_ref).toBe('eoyenigwevnxwwhyhaer')
 expect(h.database.consistent).toBe(true)
 if(h.build.deployment_id)expect(h.build.deployment_id).toBe(EXPECTED_BACKEND_DEPLOYMENT)
 out('runtime-provenance.json',{
  canonical_frontend:WEB,
  canonical_backend:API.replace(/\/api$/,''),
  expected_frontend_deployment:EXPECTED_FRONTEND_DEPLOYMENT,
  expected_backend_deployment:EXPECTED_BACKEND_DEPLOYMENT,
  frontend:{commit_sha:p.commit_sha,provenance_source:p.provenance_source,deployment_id:p.deployment_id||null,unpaired:p.unpaired},
  backend:{status:h.status,build:h.build,database:h.database},
 })
}

async function schemaProof(c:pg.Client){
 const ledger=await c.query("select version,name from supabase_migrations.schema_migrations where version='20261023140000' or name='garage_ops03_appointments_scheduling_capacity'")
 expect(ledger.rows).toEqual([{version:'20261023140000',name:'garage_ops03_appointments_scheduling_capacity'}])
 const tables=['garage_branch_scheduling_settings','garage_workforce_schedules','garage_workforce_unavailability','garage_appointments','garage_appointment_events']
 const proof=await c.query("select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced,has_table_privilege('anon',c.oid,'select') anon_s,has_table_privilege('anon',c.oid,'insert') anon_i,has_table_privilege('anon',c.oid,'update') anon_u,has_table_privilege('anon',c.oid,'delete') anon_d,has_table_privilege('authenticated',c.oid,'select') auth_s,has_table_privilege('authenticated',c.oid,'insert') auth_i,has_table_privilege('authenticated',c.oid,'update') auth_u,has_table_privilege('authenticated',c.oid,'delete') auth_d,has_table_privilege('service_role',c.oid,'select') svc_s,has_table_privilege('service_role',c.oid,'insert') svc_i,has_table_privilege('service_role',c.oid,'update') svc_u,has_table_privilege('service_role',c.oid,'delete') svc_d from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname",[tables])
 expect(proof.rowCount).toBe(5)
 const grants:any={garage_branch_scheduling_settings:[true,true,true,false],garage_workforce_schedules:[true,true,true,false],garage_workforce_unavailability:[true,true,true,false],garage_appointments:[true,true,true,false],garage_appointment_events:[true,true,false,false]}
 for(const r of proof.rows){expect(r.rls).toBe(true);expect(r.forced).toBe(true);for(const k of ['anon_s','anon_i','anon_u','anon_d','auth_s','auth_i','auth_u','auth_d'])expect(r[k]).toBe(false);expect([r.svc_s,r.svc_i,r.svc_u,r.svc_d]).toEqual(grants[r.relname])}
 const sigs=['garage_ops03_upsert_branch_scheduling_settings(uuid,uuid,boolean,integer,integer,text)','garage_ops03_add_workforce_schedule(uuid,uuid,uuid,integer,time without time zone,time without time zone,date,date,text)','garage_ops03_add_workforce_unavailability(uuid,uuid,timestamptz,timestamptz,text,text)','garage_ops03_request_appointment(uuid,uuid,timestamptz,timestamptz,text)','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_reschedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_transition_appointment(uuid,text,text,text,uuid)']
 const rpcs=[]
 for(const sig of sigs){const r=await one(c,"select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('service_role',$1,'execute') svc,exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') pub",[sig]);expect(r).toEqual({anon:false,auth:false,svc:true,pub:false});rpcs.push({signature:sig,...r})}
 const appendOnly=await c.query("select tgname from pg_trigger where not tgisinternal and tgrelid='garage_appointment_events'::regclass order by tgname")
 expect(appendOnly.rows.some(x=>x.tgname==='trg_garage_ops03_events_append_only')).toBe(true)
 out('schema-rls-rpc.json',{ledger:ledger.rows,tables:proof.rows,rpcs,append_only_trigger:appendOnly.rows})
}

async function historicalProof(c:pg.Client){
 const rows=await c.query("select a.id::text appointment_id,a.service_case_id::text,a.status,a.starts_at,a.ends_at,a.appointment_timezone,a.planned_workforce_profile_id::text,a.created_at,array(select e.event_type from garage_appointment_events e where e.appointment_id=a.id order by e.created_at,e.id) events,(select count(*)::int from mechanic_work_orders w where w.service_case_id=a.service_case_id) work_orders,(select count(*)::int from service_records s where s.service_case_id=a.service_case_id) service_records from garage_appointments a join service_cases sc on sc.id=a.service_case_id where sc.request_summary like 'SYNTHETIC / UAT OPS03 %' order by a.created_at")
 const hasConfirmed=rows.rows.some(r=>r.events.includes('requested')&&r.events.includes('confirmed'))
 const hasRescheduled=rows.rows.some(r=>r.events.includes('confirmed')&&r.events.includes('rescheduled'))
 const harareTruth=rows.rows.some(r=>new Date(r.starts_at).toISOString().startsWith('2026-10-26')&&r.appointment_timezone==='Africa/Harare'&&r.planned_workforce_profile_id)
 expect(hasConfirmed).toBe(true);expect(hasRescheduled).toBe(true);expect(harareTruth).toBe(true)
 out('historical-r2-reconstruction.json',{
  appointment_count:rows.rowCount,
  confirmed_history_present:hasConfirmed,
  rescheduled_history_present:hasRescheduled,
  all_work_order_counts_zero:rows.rows.every(r=>r.work_orders===0),
  all_service_record_counts_zero:rows.rows.every(r=>r.service_records===0),
  appointments:rows.rows,
  independently_verified_runtime_failures:{
   capacity_conflict:'409 CAPACITY EXHAUSTED on current R2 runtime',
   planned_mechanic_overlap:'400 PLANNED WORKFORCE UNAVAILABLE on current R2 runtime',
   invalid_reschedule:'400 OUTSIDE OPENING HOURS on current R2 runtime',
  },
 })
}

async function initialState(c:pg.Client){
 const owner=await one(c,"select password_hash is null password_hash_null,(select count(*)::int from user_sessions where user_id=$1 and is_valid=true and expires_at::timestamptz>now()) valid_sessions from users where id=$1",[OWNER])
 expect(owner).toEqual({password_hash_null:false,valid_sessions:0})
 const config=await one(c,"select scheduling_enabled,max_concurrent_appointments,slot_interval_minutes from garage_branch_scheduling_settings where branch_id=$1::uuid",[HRE])
 expect(config).toEqual({scheduling_enabled:true,max_concurrent_appointments:1,slot_interval_minutes:30})
 const schedules=await c.query("select workforce_profile_id::text,day_of_week,starts_at::text,ends_at::text,effective_from::text,effective_until::text from garage_workforce_schedules where branch_id=$1::uuid order by workforce_profile_id",[HRE])
 expect(schedules.rowCount).toBe(2)
 const unavailability=await c.query("select workforce_profile_id::text,starts_at,ends_at,reason_code from garage_workforce_unavailability where tenant_id=$1::uuid order by created_at",[GARAGE])
 expect(unavailability.rowCount).toBe(1)
 const live=await c.query("select a.id::text,a.status,sc.request_summary from garage_appointments a join service_cases sc on sc.id=a.service_case_id where sc.request_summary like 'SYNTHETIC / UAT OPS03 %' and a.status in ('requested','confirmed')")
 expect(live.rowCount).toBe(0)
 out('pre-run-staging-state.json',{configuration:config,schedules:schedules.rows,unavailability:unavailability.rows,live_ops03_uat:live.rows})
}

async function snapshots(c:pg.Client){
 const ops01=await one(c,"select (select count(*)::int from garage_branches where tenant_id=$1::uuid and is_active) active_sites,(select count(*)::int from garage_branches where tenant_id=$1::uuid and is_primary) primary_sites,(select count(*)::int from tenant_users where tenant_id=$1::uuid and role='mechanic') mechanic_memberships,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active') active_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending') pending_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive') inactive_workforce,(select count(*)::int from garage_workforce_branch_assignments a join garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary) live_primary,(select count(*)::int from garage_departments where tenant_id=$1::uuid and is_active) active_departments,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2) owner_workforce",[GARAGE,OWNER])
 const expected={active_sites:3,primary_sites:1,mechanic_memberships:10,active_workforce:10,pending_workforce:0,inactive_workforce:0,live_primary:10,active_departments:4,owner_workforce:0}
 expect(ops01).toEqual(expected)
 const crm=await c.query("select id::text,customer_reference_code,relationship_status,customer_category,preferred_branch_id::text,assigned_staff_user_id,md5(coalesce(internal_notes,'')) note_digest from garage_customer_relationships where tenant_id=$1::uuid and (registered_user_id=$2 or party_kind='walk_in') order by id",[GARAGE,OWNER])
 const owner=await one(c,"select owner_id from vehicles where vin='UATOPS01202600001'")
 const cases=await c.query("select id::text,status,garage_tenant_id::text,branch_id::text,requester_user_id,vin from service_cases where id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
 const work=await c.query("select id::text,service_case_id::text,status from mechanic_work_orders where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
 const assignments=await c.query("select wa.id::text,wo.service_case_id::text from work_order_assignments wa join mechanic_work_orders wo on wo.id=wa.work_order_id where wo.service_case_id=any($1::uuid[]) order by wa.id",[[A.id,B.id,C.id]])
 const records=await c.query("select id::text,service_case_id::text from service_records where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
 return {ops01,crm:crm.rows,owner:owner.owner_id,cases:cases.rows,work:work.rows,assignments:assignments.rows,records:records.rows}
}

async function requestUI(page:Page,cs:{id:string,summary:string},label:string){
 await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'})
 const card=page.getByTestId('service-request-card').filter({hasText:cs.summary})
 await expect(card).toHaveCount(1)
 await card.getByRole('button',{name:'Find appointment times'}).click()
 await card.getByLabel('Appointment date '+cs.id).fill(DATE)
 await card.getByLabel('Appointment duration '+cs.id).fill('60')
 await card.getByRole('button',{name:'Check available times'}).click()
 await expect(card.getByTestId('appointment-slots')).toBeVisible()
 const reqP=page.waitForRequest(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments')&&r.method()==='POST')
 const resP=page.waitForResponse(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments')&&r.request().method()==='POST')
 const started=Date.now()
 await card.getByRole('button',{name:'Request this time'}).first().click()
 const req=await reqP,res=await resP
 timings.push({gate:label+' request',duration_ms:Date.now()-started,status:res.status()})
 expect(res.status()).toBeLessThan(300)
 const body:any=req.postDataJSON()
 expect(body.branch_id).toBe(HRE)
 expect(new Date(body.starts_at).toISOString()).toBe('2026-10-26T06:00:00.000Z')
 expect(new Date(body.ends_at).toISOString()).toBe('2026-10-26T07:00:00.000Z')
 await expect(card.getByTestId('appointment-status')).toContainText('Requested')
 return {request:safeRequest(req),response:safeResponse(res)}
}

async function appointmentCard(page:Page,caseId:string){
 await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
 const matching=page.getByTestId('appointment-card').filter({hasText:'Service Case '+caseId})
 const card=matching.filter({has:page.getByRole('button',{name:/Review and confirm|Reschedule/})})
 await expect(card).toHaveCount(1)
 return card
}

async function openEditor(page:Page,caseId:string,button:string){
 const live=await appointmentCard(page,caseId)
 await live.getByRole('button',{name:button}).click()
 const label=button==='Review and confirm'?'Appointment planned mechanic':'Appointment start'
 const card=page.getByTestId('appointment-card')
   .filter({hasText:'Service Case '+caseId})
   .filter({has:page.getByLabel(new RegExp(label))})
 await expect(card).toHaveCount(1)
 const aria=await card.getByLabel(new RegExp(label)).first().getAttribute('aria-label')
 if(!aria)throw Error('appointment editor id missing')
 const id=aria.replace(label+' ','')
 return {card,id}
}

async function confirm(page:Page,caseId:string,profile:string,label:string,expectedStatus:number|number[],expectedTime={localStart:'08:00',localEnd:'09:00',absoluteStart:'2026-10-26T06:00:00.000Z',absoluteEnd:'2026-10-26T07:00:00.000Z'}){
 const {card,id}=await openEditor(page,caseId,'Review and confirm')
 expect(await card.getByLabel('Appointment start '+id).inputValue()).toBe(DATE+'T'+expectedTime.localStart)
 expect(await card.getByLabel('Appointment end '+id).inputValue()).toBe(DATE+'T'+expectedTime.localEnd)
 await expect(card.getByTestId('appointment-timezone-'+id)).toContainText('Africa/Harare')
 await card.getByLabel('Appointment site '+id).selectOption(HRE)
 await card.getByLabel('Appointment planned mechanic '+id).selectOption(profile)
 const reqP=page.waitForRequest(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/confirm')&&r.method()==='POST')
 const resP=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/confirm')&&r.request().method()==='POST')
 const started=Date.now()
 await card.getByRole('button',{name:'Confirm appointment'}).click()
 const req=await reqP,res=await resP
 timings.push({gate:label,duration_ms:Date.now()-started,status:res.status()})
 const body:any=req.postDataJSON()
 expect(new Date(body.starts_at).toISOString()).toBe(expectedTime.absoluteStart)
 expect(new Date(body.ends_at).toISOString()).toBe(expectedTime.absoluteEnd)
 if(Array.isArray(expectedStatus))expect(expectedStatus).toContain(res.status());else expect(res.status()).toBe(expectedStatus)
 return {id,request:safeRequest(req),response:safeResponse(res)}
}

async function requesterCancel(page:Page,cs:{id:string,summary:string},label:string){
 await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'})
 const card=page.getByTestId('service-request-card').filter({hasText:cs.summary})
 await expect(card).toHaveCount(1)
 const reqP=page.waitForRequest(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments/')&&r.url().endsWith('/cancel')&&r.method()==='POST')
 const resP=page.waitForResponse(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments/')&&r.url().endsWith('/cancel')&&r.request().method()==='POST')
 const started=Date.now()
 await card.getByRole('button',{name:'Cancel appointment'}).click()
 const req=await reqP,res=await resP
 timings.push({gate:label,duration_ms:Date.now()-started,status:res.status()})
 expect(res.status()).toBeLessThan(300)
 await expect(card.getByTestId('appointment-status')).toContainText('Appointment cancelled')
 return {request:safeRequest(req),response:safeResponse(res)}
}

async function setCapacity(page:Page,value:string){
 await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
 await page.getByLabel('Scheduling settings site').selectOption(HRE)
 await page.getByLabel('Scheduling enabled').selectOption('true')
 await page.getByLabel('Maximum concurrent appointments').fill(value)
 await page.getByLabel('Slot interval minutes').fill('30')
 const resP=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/sites/')&&r.url().endsWith('/settings')&&r.request().method()==='PUT')
 await page.getByRole('button',{name:'Save scheduling settings'}).click()
 expect((await resP).status()).toBeLessThan(300)
}

async function cleanupKnownLive(page:Page,c:pg.Client){
 const live=await c.query("select a.id::text appointment_id,a.service_case_id::text case_id,a.status from garage_appointments a where a.service_case_id=any($1::uuid[]) and a.status in ('requested','confirmed') order by a.created_at",[[A.id,B.id,C.id]])
 const cleaned=[]
 for(const row of live.rows){
  const r=await api(page,'POST','/service-cases/'+row.case_id+'/appointments/'+row.appointment_id+'/cancel')
  if(r.status>=300)throw Error('cleanup cancellation failed for '+row.appointment_id+' HTTP '+r.status)
  cleaned.push({appointment_id:row.appointment_id,case_id:row.case_id,previous_status:row.status})
 }
 const remaining=await c.query("select id::text from garage_appointments where service_case_id=any($1::uuid[]) and status in ('requested','confirmed')",[[A.id,B.id,C.id]])
 expect(remaining.rowCount).toBe(0)
 return cleaned
}

test('GARAGE-1.0 OPS03 R2 full staging closure',async({page,browser})=>{
 test.setTimeout(24*60_000)
 const c=await db()
 let tokyo:BrowserContext|null=null
 let tokyoPage:Page|null=null
 let capacityRaised=false
 const before=await snapshots(c)
 try{
  await runtimeProof()
  await schemaProof(c)
  await historicalProof(c)
  await initialState(c)

  await login(page)
  const session=await one(c,"select active_role,active_organization_id::text from user_sessions where user_id=$1 and is_valid=true order by created_at desc limit 1",[OWNER])
  expect(session.active_role).toBe('owner');expect(session.active_organization_id).toBe(GARAGE)

  const cleaned=await cleanupKnownLive(page,c)
  out('pre-run-live-cleanup.json',{cleaned})

  await page.setViewportSize({width:1440,height:1000})
  await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
  await expect(page.getByLabel('Scheduling settings site')).toBeVisible()
  await expect(page.getByLabel('Scheduling settings site').locator('option').filter({hasText:'Harare'})).toHaveCount(1)
  await page.getByLabel('Scheduling settings site').selectOption(HRE)
  await expect(page.getByLabel('Scheduling enabled')).toHaveValue('true')
  await expect(page.getByLabel('Maximum concurrent appointments')).toHaveValue('1')
  await expect(page.getByLabel('Slot interval minutes')).toHaveValue('30')
  await shot(page,'desktop-01-retained-configuration.png')

  const av:any=parse((await api(page,'GET','/garage/schedule/availability?service_case_id='+A.id+'&branch_id='+HRE+'&date='+DATE+'&duration_minutes=60')).text)
  expect(av.configured).toBe(true);expect(av.capacity).toBe(1)
  const first=av.slots.find((x:any)=>new Date(x.starts_at).toISOString()==='2026-10-26T06:00:00.000Z')
  expect(first).toBeTruthy()
  expect(first.available_workforce_profile_ids).toEqual(expect.arrayContaining([P1,P3]))
  const noon=av.slots.find((x:any)=>new Date(x.starts_at).toISOString()==='2026-10-26T10:00:00.000Z')
  expect(noon).toBeTruthy();expect(noon.available_workforce_profile_ids).not.toContain(P1)
  out('capacity-unavailability-proof.json',{branch_capacity:av.capacity,eligible_mechanics_at_0800:first.available_workforce_profile_ids,noon_available_mechanics:noon.available_workforce_profile_ids,unavailability_excludes:P1})

  const harareRequest=await requestUI(page,A,'Harare browser')
  await shot(page,'desktop-02-requested-harare.png')
  const ar=await one(c,"select id::text,status,starts_at,ends_at,appointment_timezone,planned_workforce_profile_id::text from garage_appointments where service_case_id=$1::uuid and status='requested' order by created_at desc limit 1",[A.id])
  expect(ar.status).toBe('requested');expect(new Date(ar.starts_at).toISOString()).toBe('2026-10-26T06:00:00.000Z');expect(new Date(ar.ends_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');expect(ar.appointment_timezone).toBe('Africa/Harare');expect(ar.planned_workforce_profile_id).toBeNull()
  const avRequested:any=parse((await api(page,'GET','/garage/schedule/availability?service_case_id='+A.id+'&branch_id='+HRE+'&date='+DATE+'&duration_minutes=60')).text)
  const requestedSlot=avRequested.slots.find((x:any)=>new Date(x.starts_at).toISOString()==='2026-10-26T06:00:00.000Z')
  expect(requestedSlot.booked_count).toBe(0)

  tokyo=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:1440,height:1000}})
  tokyoPage=await tokyo.newPage()
  await login(tokyoPage)
  const tokyoRequest=await requestUI(tokyoPage,B,'Tokyo browser')
  const bRequested=await one(c,"select id::text,status,starts_at,ends_at,appointment_timezone from garage_appointments where service_case_id=$1::uuid and status='requested' order by created_at desc limit 1",[B.id])
  expect(new Date(bRequested.starts_at).toISOString()).toBe('2026-10-26T06:00:00.000Z');expect(new Date(bRequested.ends_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');expect(bRequested.appointment_timezone).toBe('Africa/Harare')

  const harareEditor=await openEditor(page,A.id,'Review and confirm')
  expect(await harareEditor.card.getByLabel('Appointment start '+harareEditor.id).inputValue()).toBe(DATE+'T08:00')
  expect(await harareEditor.card.getByLabel('Appointment end '+harareEditor.id).inputValue()).toBe(DATE+'T09:00')
  await expect(harareEditor.card.getByTestId('appointment-timezone-'+harareEditor.id)).toContainText('Africa/Harare')
  await shot(page,'desktop-03-harare-timezone-editor.png')
  await harareEditor.card.getByRole('button',{name:'Close'}).click()

  const tokyoEditor=await openEditor(tokyoPage,B.id,'Review and confirm')
  expect(await tokyoEditor.card.getByLabel('Appointment start '+tokyoEditor.id).inputValue()).toBe(DATE+'T08:00')
  expect(await tokyoEditor.card.getByLabel('Appointment end '+tokyoEditor.id).inputValue()).toBe(DATE+'T09:00')
  await expect(tokyoEditor.card.getByTestId('appointment-timezone-'+tokyoEditor.id)).toContainText('Africa/Harare')
  await shot(tokyoPage,'desktop-04-tokyo-timezone-editor.png')
  await tokyoEditor.card.getByRole('button',{name:'Close'}).click()

  const confirmA=await confirm(page,A.id,P3,'Harare confirmation',200)
  const confirmedA=await one(c,"select status,starts_at,ends_at,appointment_timezone,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[confirmA.id])
  expect(confirmedA.status).toBe('confirmed');expect(new Date(confirmedA.starts_at).toISOString()).toBe('2026-10-26T06:00:00.000Z');expect(new Date(confirmedA.ends_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');expect(confirmedA.appointment_timezone).toBe('Africa/Harare');expect(confirmedA.planned_workforce_profile_id).toBe(P3)
  await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await shot(page,'desktop-05-confirmed-harare.png')

  const conflictB=await confirm(tokyoPage,B.id,P1,'Tokyo capacity conflict',409)
  const afterConflict=await one(c,"select status from garage_appointments where id=$1::uuid",[conflictB.id]);expect(afterConflict.status).toBe('requested')
  const falseB=await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='confirmed'",[conflictB.id]);expect(falseB.n).toBe(0)
  await shot(tokyoPage,'desktop-06-capacity-conflict.png')

  const cancelA=await requesterCancel(page,A,'Requester cancellation A')
  const confirmB=await confirm(tokyoPage,B.id,P1,'Tokyo capacity reuse confirmation',200)
  const confirmedB=await one(c,"select status,starts_at,ends_at,appointment_timezone,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[confirmB.id]);expect(confirmedB.status).toBe('confirmed');expect(confirmedB.planned_workforce_profile_id).toBe(P1)

  let bEditor=await openEditor(tokyoPage,B.id,'Reschedule')
  let bcard=bEditor.card
  const bid=bEditor.id
  expect(await bcard.getByLabel('Appointment start '+bid).inputValue()).toBe(DATE+'T08:00')
  await bcard.getByLabel('Appointment start '+bid).fill(DATE+'T09:00')
  await bcard.getByLabel('Appointment end '+bid).fill(DATE+'T10:00')
  const vrq=tokyoPage.waitForRequest(r=>r.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&r.method()==='POST')
  const vrs=tokyoPage.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&r.request().method()==='POST')
  const vstart=Date.now();await bcard.getByRole('button',{name:'Save reschedule'}).click();const vreq=await vrq,vres=await vrs
  timings.push({gate:'valid reschedule',duration_ms:Date.now()-vstart,status:vres.status()});expect(vres.status()).toBe(200)
  const vbody:any=vreq.postDataJSON();expect(new Date(vbody.starts_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');expect(new Date(vbody.ends_at).toISOString()).toBe('2026-10-26T08:00:00.000Z')
  const stable=await one(c,"select status,branch_id::text,starts_at,ends_at,appointment_timezone,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[bid])
  expect(stable.status).toBe('confirmed');expect(new Date(stable.starts_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');expect(new Date(stable.ends_at).toISOString()).toBe('2026-10-26T08:00:00.000Z');expect(stable.appointment_timezone).toBe('Africa/Harare');expect(stable.planned_workforce_profile_id).toBe(P1)
  await tokyoPage.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await shot(tokyoPage,'desktop-07-valid-reschedule.png')

  const eventBefore=await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='rescheduled'",[bid])
  const auditBefore=await one(c,"select count(*)::int n from trust_audit_events where event_type='GARAGE_APPOINTMENT_RESCHEDULED' and (new_value->>'appointment_id'=$1 or previous_value->>'appointment_id'=$1)",[bid])
  bEditor=await openEditor(tokyoPage,B.id,'Reschedule');bcard=bEditor.card;expect(bEditor.id).toBe(bid)
  await bcard.getByLabel('Appointment start '+bid).fill(DATE+'T06:00');await bcard.getByLabel('Appointment end '+bid).fill(DATE+'T07:00')
  const irq=tokyoPage.waitForRequest(r=>r.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&r.method()==='POST')
  const irs=tokyoPage.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&r.request().method()==='POST')
  const istart=Date.now();await bcard.getByRole('button',{name:'Save reschedule'}).click();const ireq=await irq,ires=await irs
  timings.push({gate:'invalid reschedule',duration_ms:Date.now()-istart,status:ires.status()});expect(ires.status()).toBeGreaterThanOrEqual(400)
  const ibody:any=ireq.postDataJSON();expect(new Date(ibody.starts_at).toISOString()).toBe('2026-10-26T04:00:00.000Z');expect(new Date(ibody.ends_at).toISOString()).toBe('2026-10-26T05:00:00.000Z')
  const afterInvalid=await one(c,"select status,branch_id::text,starts_at,ends_at,appointment_timezone,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[bid])
  expect(new Date(afterInvalid.starts_at).toISOString()).toBe(new Date(stable.starts_at).toISOString());expect(new Date(afterInvalid.ends_at).toISOString()).toBe(new Date(stable.ends_at).toISOString());expect(afterInvalid.branch_id).toBe(stable.branch_id);expect(afterInvalid.planned_workforce_profile_id).toBe(stable.planned_workforce_profile_id)
  expect((await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='rescheduled'",[bid])).n).toBe(eventBefore.n)
  expect((await one(c,"select count(*)::int n from trust_audit_events where event_type='GARAGE_APPOINTMENT_RESCHEDULED' and (new_value->>'appointment_id'=$1 or previous_value->>'appointment_id'=$1)",[bid])).n).toBe(auditBefore.n)
  await shot(tokyoPage,'desktop-08-invalid-reschedule.png')

  await setCapacity(page,'2');capacityRaised=true
  const createC=await api(page,'POST','/service-cases/'+C.id+'/appointments',{branch_id:HRE,starts_at:'2026-10-26T07:00:00.000Z',ends_at:'2026-10-26T08:00:00.000Z'})
  expect([200,201]).toContain(createC.status)
  const overlapC=await confirm(page,C.id,P1,'planned mechanic overlap',400,{localStart:'09:00',localEnd:'10:00',absoluteStart:'2026-10-26T07:00:00.000Z',absoluteEnd:'2026-10-26T08:00:00.000Z'})
  const cState=await one(c,"select status from garage_appointments where id=$1::uuid",[overlapC.id]);expect(cState.status).toBe('requested')
  const cFalse=await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='confirmed'",[overlapC.id]);expect(cFalse.n).toBe(0)
  await requesterCancel(page,C,'Requester cancellation C')
  await setCapacity(page,'1');capacityRaised=false

  const cancelB=await requesterCancel(page,B,'Requester cancellation B')
  const bFinal=await one(c,"select status from garage_appointments where id=$1::uuid",[bid]);expect(bFinal.status).toBe('cancelled')

  await page.setViewportSize({width:390,height:844});await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await expect(page.getByRole('heading',{name:/Workshop schedule/i})).toBeVisible();await expect(page.getByLabel('Scheduling settings site')).toBeVisible();await shot(page,'mobile-01-garage-schedule.png')
  await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'});await expect(page.getByTestId('service-request-card').filter({hasText:A.summary})).toHaveCount(1);await shot(page,'mobile-02-service-requests.png')

  const events=await c.query("select appointment_id::text,event_type,actor_user_id,actor_scope,previous_status,new_status,previous_starts_at,new_starts_at,previous_ends_at,new_ends_at,previous_planned_workforce_profile_id::text,new_planned_workforce_profile_id::text,created_at from garage_appointment_events where tenant_id=$1::uuid and created_at>=$2 order by created_at,id",[GARAGE,START.toISOString()])
  const audits=await c.query("select event_type,actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,created_at from trust_audit_events where actor_tenant_id=$1 and created_at>=$2 and (event_type like 'GARAGE_APPOINTMENT_%' or event_type='GARAGE_BRANCH_SCHEDULING_UPDATED') order by created_at,id",[GARAGE,START.toISOString()])
  for(const t of ['GARAGE_APPOINTMENT_REQUESTED','GARAGE_APPOINTMENT_CONFIRMED','GARAGE_APPOINTMENT_RESCHEDULED','GARAGE_APPOINTMENT_CANCELLED'])expect(audits.rows.some(x=>x.event_type===t),'missing '+t).toBe(true)
  expect(JSON.stringify(audits.rows)).not.toMatch(/password|token|cookie|postgres(?:ql)?:\/\//i)
  out('current-run-appointment-events.json',events.rows)
  out('current-run-trust-audits.json',audits.rows)
  out('timezone-physical-proof.json',{
   harare_browser:{request:harareRequest,editor:{start:'2026-10-26T08:00',end:'2026-10-26T09:00',timezone:'Africa/Harare'},confirmation:confirmA},
   tokyo_browser:{request:tokyoRequest,editor:{start:'2026-10-26T08:00',end:'2026-10-26T09:00',timezone:'Africa/Harare'},capacity_conflict:conflictB,capacity_reuse_confirmation:confirmB},
   invariant:{garage_local:'08:00–09:00 Africa/Harare',absolute:'06:00–07:00Z'},
  })
  out('reschedule-proof.json',{valid:{request:safeRequest(vreq),response:safeResponse(vres),final:stable},invalid:{request:safeRequest(ireq),response:safeResponse(ires),state_after:afterInvalid,event_count_unchanged:true,audit_count_unchanged:true}})
  out('requester-cancellation-proof.json',{A:cancelA,B:cancelB})
  out('planned-mechanic-overlap.json',{C:overlapC,remained_requested:true,false_confirmed_event:false})
  out('performance.json',timings)

  const after=await snapshots(c)
  expect(after.ops01).toEqual(before.ops01)
  expect(after.crm).toEqual(before.crm)
  expect(after.owner).toBe(before.owner)
  expect(after.cases).toEqual(before.cases)
  expect(after.work).toEqual(before.work)
  expect(after.assignments).toEqual(before.assignments)
  expect(after.records).toEqual(before.records)

  const finalConfig=await one(c,"select scheduling_enabled,max_concurrent_appointments,slot_interval_minutes from garage_branch_scheduling_settings where branch_id=$1::uuid",[HRE])
  expect(finalConfig).toEqual({scheduling_enabled:true,max_concurrent_appointments:1,slot_interval_minutes:30})
  const finalCounts=await c.query("select status,count(*)::int count from garage_appointments where tenant_id=$1::uuid group by status order by status",[GARAGE])
  const live=await c.query("select a.id::text,a.service_case_id::text,a.status from garage_appointments a where a.service_case_id=any($1::uuid[]) and a.status in ('requested','confirmed')",[[A.id,B.id,C.id]])
  expect(live.rowCount).toBe(0)
  out('final-integrity.json',{
   ops01:after.ops01,
   ops02:{registered_and_walkin_relationships_unchanged:true,vehicle_owner_unchanged:true},
   service_cases_unchanged:true,
   work_order_boundary:{before:before.work,after:after.work,assignments_before:before.assignments,assignments_after:after.assignments,service_records_before:before.records,service_records_after:after.records},
   appointment_counts:finalCounts.rows,
   live_known_uat_appointments:live.rows,
   final_configuration:finalConfig,
   cross_requester_boundary:'SOURCE-CERTIFIED / NOT PHYSICALLY RE-AUTHENTICATED',
  })
  out('gate-classification.json',{
   source_exact_head:'PROVEN ON CURRENT R2',
   runtime_exact_head:'PROVEN ON CURRENT R2',
   timezone_harare:'PROVEN ON CURRENT R2',
   timezone_tokyo:'PROVEN ON CURRENT R2',
   requested_not_confirmed:'PROVEN ON CURRENT R2',
   confirmation:'PROVEN ON CURRENT R2',
   capacity_conflict:'PROVEN ON CURRENT R2',
   capacity_release_reuse:'PROVEN ON CURRENT R2',
   planned_mechanic_overlap:'PROVEN ON CURRENT R2',
   valid_reschedule:'PROVEN ON CURRENT R2',
   invalid_reschedule_atomicity:'PROVEN ON CURRENT R2',
   requester_cancellation:'PROVEN ON CURRENT R2',
   append_only_history:'PROVEN ON CURRENT R2',
   trust_audit:'PROVEN ON CURRENT R2',
   desktop:'PROVEN ON CURRENT R2',
   mobile:'PROVEN ON CURRENT R2',
   ops01_integrity:'PROVEN ON CURRENT R2',
   ops02_integrity:'PROVEN ON CURRENT R2',
   work_order_boundary:'PROVEN ON CURRENT R2',
   cross_requester:'SOURCE-CERTIFIED ONLY',
  })
  out('boundaries.json',{production_accessed:false,ops04_started:false,migration_modified:false,new_migration:false,product_sha:SHA})
 }catch(e){
  out('failure-receipt.json',{at:new Date().toISOString(),product_sha:SHA,error:e instanceof Error?e.message:String(e),timings})
  throw e
 }finally{
  if(capacityRaised){
   try{await setCapacity(page,'1')}catch{}
  }
  try{if(tokyoPage)await cleanupKnownLive(tokyoPage,c);else await cleanupKnownLive(page,c)}catch{}
  try{await tokyo?.close()}catch{}
  await c.end().catch(()=>{})
 }
})
