import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { execFileSync } from 'node:child_process'
import { ensureActingForOrganisation } from './staging-helpers'

const SHA='07b60e5d158d7dad7232d33f11f06a478c92da3f'
const WEB=(process.env.STAGING_WEB_URL||'https://staging.carup.dev').replace(/\/$/,'')
const API=(process.env.STAGING_API_URL||'https://api-staging.carup.dev/api').replace(/\/$/,'')
const DIR=path.resolve(process.env.GARAGE_R3_RESULTS_DIR||'cert-results/garage-ops03-stg01')
const PW=process.env.GARAGE_R3_PASSWORD_FILE||''
const OWNER='uat_ops01_owner_20261022a'
const EMAIL='ops01.owner.20261022a@carup-staging.test'
const GARAGE='442c82c1-fc69-46ff-a138-712a6504ac98'
const GNAME='SYNTHETIC / UAT OPS01 GARAGE 20261022A'
const HRE='b1000000-0000-4000-8000-000000000001'
const P1='c1000000-0000-4000-8000-000000000001'
const P3='c1000000-0000-4000-8000-000000000003'
const U1='uat_ops01_mech01_20261022a'
const U3='uat_ops01_mech03_20261022a'
const VIN='UATOPS01202600001'
const DATE='2026-10-26'
const RUN=String(process.env.GARAGE_OPS03_RUN_ID||process.env.GITHUB_RUN_ID||Date.now()).replace(/[^A-Za-z0-9]/g,'').slice(-14)
const START=new Date()

fs.mkdirSync(DIR,{recursive:true})
function out(name:string,value:any){fs.writeFileSync(path.join(DIR,name),JSON.stringify(value,null,2)+'\n')}
async function shot(page:Page,name:string){await page.screenshot({path:path.join(DIR,name),fullPage:true})}
function dburl(){const v=process.env.DIASPORA_STAGING_DATABASE_URL||'';if(!v.includes('eoyenigwevnxwwhyhaer')||v.includes('vhmnajoeicasaigiophh'))throw Error('REFUSING NON-STAGING DATABASE');return v.replace(/([?&])sslmode=[^&]*&?/i,'$1').replace(/[?&]$/,'')}
async function db(){const c=new pg.Client({connectionString:dburl(),ssl:{rejectUnauthorized:false}});await c.connect();return c}
async function one(c:pg.Client,q:string,p:any[]=[]){const r=await c.query(q,p);if(r.rowCount!==1)throw Error('expected exactly one row');return r.rows[0]}
function password(){const st=fs.lstatSync(PW);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('unsafe credential file');return fs.readFileSync(PW,'utf8').trim()}
function json(r:{status:number,text:string}){try{return JSON.parse(r.text)}catch{return {raw:r.text}}}

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

async function verifyMigration(c:pg.Client){
 const tables=['garage_branch_scheduling_settings','garage_workforce_schedules','garage_workforce_unavailability','garage_appointments','garage_appointment_events']
 const ledger=await c.query("select version,name from supabase_migrations.schema_migrations where version='20261023140000' or name='garage_ops03_appointments_scheduling_capacity'")
 const present=await c.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname=any($1::text[]) order by relname",[tables])
 const expected=[...tables].sort()
 const actual=present.rows.map((r:any)=>r.relname).sort()
 if(ledger.rowCount!==1||ledger.rows[0].version!=='20261023140000'||ledger.rows[0].name!=='garage_ops03_appointments_scheduling_capacity'||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('BLOCK — OPS03 applied migration/schema custody changed')
 const proof=await c.query("select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced,has_table_privilege('anon',c.oid,'select') anon_s,has_table_privilege('authenticated',c.oid,'select') auth_s,has_table_privilege('service_role',c.oid,'select') svc_s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname",[tables])
 expect(proof.rowCount).toBe(5)
 for(const r of proof.rows){expect(r.rls).toBe(true);expect(r.forced).toBe(true);expect(r.anon_s).toBe(false);expect(r.auth_s).toBe(false);expect(r.svc_s).toBe(true)}
 const sigs=['garage_ops03_upsert_branch_scheduling_settings(uuid,uuid,boolean,integer,integer,text)','garage_ops03_add_workforce_schedule(uuid,uuid,uuid,integer,time without time zone,time without time zone,date,date,text)','garage_ops03_add_workforce_unavailability(uuid,uuid,timestamptz,timestamptz,text,text)','garage_ops03_request_appointment(uuid,uuid,timestamptz,timestamptz,text)','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_reschedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_transition_appointment(uuid,text,text,text,uuid)']
 const rpc=[]
 for(const sig of sigs){const r=await one(c,"select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('service_role',$1,'execute') svc",[sig]);expect(r).toEqual({anon:false,auth:false,svc:true});rpc.push({signature:sig,...r})}
 out('migration-immutability.json',{ledger:ledger.rows,tables:actual,table_security:proof.rows,rpcs:rpc,mode:'verify-only-r2-continuation'})
}

async function deploy(){
 const token=process.env.VERCEL_TOKEN||'';if(!token)throw Error('Vercel token missing')
 const team='team_InL2Jmsg4dbG0rFY8nxriTha'
 async function create(name:string,project:string){
  const r=await fetch('https://api.vercel.com/v13/deployments?teamId='+team,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({name,project,target:'production',gitSource:{type:'github',org:'kudzimusar',repo:'carup',ref:'feat/garage-1.0-ops03-appointments-scheduling-capacity',sha:SHA}})})
  const j:any=await r.json();if(!r.ok)throw Error('Vercel create '+name+' '+r.status+' '+JSON.stringify(j).slice(0,500))
  for(let i=0;i<90;i++){const x=await fetch('https://api.vercel.com/v13/deployments/'+j.id+'?teamId='+team,{headers:{authorization:'Bearer '+token}});const d:any=await x.json();if(d.readyState==='READY')return d;if(['ERROR','CANCELED','BLOCKED'].includes(d.readyState))throw Error(name+' '+d.readyState);await new Promise(r=>setTimeout(r,5000))}
  throw Error(name+' deployment timeout')
 }
 const be=await create('carup-backend-staging','prj_ddsVeXDxxHxyMAaZxX4v5ORya27W')
 const fe=await create('carup-staging','prj_auYmL5hA2ppWA15jdTK4GAdy3AYm')
 const [pr,hr]=await Promise.all([fetch('https://'+fe.url+'/carup-provenance.json?ops03='+RUN),fetch('https://'+be.url+'/api/health?ops03='+RUN)])
 expect(pr.ok).toBe(true);expect(hr.ok).toBe(true)
 const p:any=await pr.json(),h:any=await hr.json()
 expect(p.commit_sha).toBe(SHA);expect(p.provenance_source).toBe('vercel_git');expect(p.unpaired).toBe(false)
 expect(h.status).toBe('UP');expect(h.build.commit_sha).toBe(SHA);expect(h.build.source).toBe('vercel_git');expect(h.build.provenance_available).toBe(true);expect(h.build.deployment_id).toBe(be.id);expect(h.database.supabase_project_ref).toBe('eoyenigwevnxwwhyhaer');expect(h.database.consistent).toBe(true);expect(JSON.stringify(h)).toMatch(/COMMUNICATION_OUTBOUND_DISABLED|external_sends_disabled|outbound.*disabled/i)
 out('runtime-custody.json',{frontend:{id:fe.id,url:fe.url,provenance:p},backend:{id:be.id,url:be.url,health:{status:h.status,build:h.build,database:h.database}},note:'Git-source target=production deployments are on staging-only Vercel projects. Existing Vercel project configuration may auto-converge canonical staging aliases at READY before immutable verification; this deviation is recorded, not hidden.'})
 let ok=false
 for(let i=0;i<30;i++){const [a,b]=await Promise.all([fetch(WEB+'/carup-provenance.json?c='+Date.now()),fetch(API+'/health?c='+Date.now())]);if(a.ok&&b.ok){const x:any=await a.json(),y:any=await b.json();if(x.commit_sha===SHA&&x.provenance_source==='vercel_git'&&y.build?.commit_sha===SHA&&y.build?.source==='vercel_git'&&y.build?.deployment_id===be.id){ok=true;break}}await new Promise(r=>setTimeout(r,4000))}
 if(!ok)throw Error('canonical staging runtime did not converge')
 const parity=execFileSync(process.execPath,['scripts/assert-staging-runtime-parity.mjs',SHA],{encoding:'utf8'})
 expect(parity).toContain('STAGING_RUNTIME_REVISION_PARITY=PASS')
 out('runtime-parity.json',{output:parity.trim()})
}

async function prepProfile(page:Page,c:pg.Client){
 const before=await c.query("select slug,publication_status,display_name from garage_public_profiles where tenant_id=$1::uuid",[GARAGE])
 if(before.rowCount===0){
  let r=await api(page,'PUT','/garage/profile',{display_name:GNAME,slug:'synthetic-uat-ops01-garage-20261022a',location_city:'Harare',location_province:'Harare',service_categories:['general_service'],contact_policy:'in_app_only'})
  expect([200,201]).toContain(r.status)
  r=await api(page,'POST','/garage/profile/publish',{});expect(r.status).toBe(200)
 }
 const after=await one(c,"select slug,publication_status,display_name from garage_public_profiles where tenant_id=$1::uuid",[GARAGE]);expect(after.publication_status).toBe('published')
 out('garage-profile-fixture.json',{before:before.rows,after,reason:'Retained Garage had no public S1 profile. Created/published through authenticated existing Garage profile authority so canonical Service Case request flow could be exercised.'})
 return after.slug
}
async function createCase(page:Page,slug:string,label:string){
 const summary='SYNTHETIC / UAT OPS03 '+label+' '+RUN
 let r=await api(page,'POST','/service-cases',{vin:VIN,garage_slug:slug,branch_id:HRE,service_category:'general_service',source_channel:'operator',request_summary:summary})
 expect([200,201]).toContain(r.status);const j:any=json(r),id=j.case?.id||j.id;expect(id).toBeTruthy()
 r=await api(page,'POST','/service-cases/'+id+'/accept',{branch_id:HRE});expect(r.status).toBe(200)
 return {id,summary}
}
async function requestUI(page:Page,cs:any){
 await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'})
 const card=page.getByTestId('service-request-card').filter({hasText:cs.summary});await expect(card).toHaveCount(1)
 await card.getByRole('button',{name:'Find appointment times'}).click()
 await card.getByLabel('Appointment date '+cs.id).fill(DATE);await card.getByLabel('Appointment duration '+cs.id).fill('60')
 await card.getByRole('button',{name:'Check available times'}).click();await expect(card.getByTestId('appointment-slots')).toBeVisible()
 const rr=page.waitForResponse(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments')&&r.request().method()==='POST')
 await card.getByRole('button',{name:'Request this time'}).first().click();expect((await rr).status()).toBeLessThan(300);await expect(card.getByTestId('appointment-status')).toContainText('Requested')
}
async function appointmentCard(page:Page,caseId:string,status:'requested'|'confirmed'){
 await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
 const x=page.getByTestId('appointment-card').filter({hasText:'Service Case '+caseId}).filter({hasText:status})
 await expect(x).toHaveCount(1)
 return x
}
async function confirmWithProof(page:Page,caseId:string,profile:string,expectedStart:string,expectedEnd:string){
 const x=await appointmentCard(page,caseId,'requested')
 await x.getByRole('button',{name:'Review and confirm'}).click()
 const id=(await x.getByLabel(/Appointment planned mechanic/).getAttribute('aria-label'))!.replace('Appointment planned mechanic ','')
 const startInput=x.getByLabel('Appointment start '+id)
 const endInput=x.getByLabel('Appointment end '+id)
 await expect(startInput).toHaveValue(expectedStart)
 await expect(endInput).toHaveValue(expectedEnd)
 await expect(x.getByTestId('appointment-timezone-'+id)).toContainText('Africa/Harare')
 await x.getByLabel('Appointment site '+id).selectOption(HRE)
 await x.getByLabel('Appointment planned mechanic '+id).selectOption(profile)
 const displayed={starts_at:await startInput.inputValue(),ends_at:await endInput.inputValue()}
 const browser_timezone=await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone)
 const requestPromise=page.waitForRequest(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/confirm')&&r.method()==='POST')
 const responsePromise=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/confirm')&&r.request().method()==='POST')
 await x.getByRole('button',{name:'Confirm appointment'}).click()
 const request=await requestPromise
 const response=await responsePromise
 return {id,response,payload:request.postDataJSON(),displayed,browser_timezone}
}
async function rescheduleWithProof(page:Page,caseId:string,startLocal:string,endLocal:string){
 const x=await appointmentCard(page,caseId,'confirmed')
 await x.getByRole('button',{name:'Reschedule'}).click()
 const id=(await x.getByLabel(/Appointment start/).getAttribute('aria-label'))!.replace('Appointment start ','')
 await x.getByLabel('Appointment start '+id).fill(startLocal)
 await x.getByLabel('Appointment end '+id).fill(endLocal)
 const requestPromise=page.waitForRequest(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/reschedule')&&r.method()==='POST')
 const responsePromise=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/reschedule')&&r.request().method()==='POST')
 await x.getByRole('button',{name:'Save reschedule'}).click()
 const request=await requestPromise
 const response=await responsePromise
 return {id,response,payload:request.postDataJSON(),browser_timezone:await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone)}
}
async function cancelGarage(page:Page,caseId:string){
 const x=await appointmentCard(page,caseId,'confirmed')
 const rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/')&&r.url().endsWith('/status')&&r.request().method()==='POST')
 await x.getByRole('button',{name:'Cancel'}).click()
 expect((await rr).status()).toBeLessThan(300)
}
async function cancelRequesterUI(page:Page,cs:any){
 await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'})
 const card=page.getByTestId('service-request-card').filter({hasText:cs.summary})
 await expect(card).toHaveCount(1)
 const rr=page.waitForResponse(r=>r.url().includes('/api/service-cases/'+cs.id+'/appointments/')&&r.url().endsWith('/cancel')&&r.request().method()==='POST')
 await card.getByRole('button',{name:'Cancel appointment'}).click()
 expect((await rr).status()).toBeLessThan(300)
 await expect(card.getByTestId('appointment-status')).toContainText('Cancelled')
}
async function setCapacity(page:Page,value:number){
 await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
 await page.getByLabel('Scheduling settings site').selectOption(HRE)
 await page.getByLabel('Scheduling enabled').selectOption('true')
 await page.getByLabel('Maximum concurrent appointments').fill(String(value))
 await page.getByLabel('Slot interval minutes').fill('30')
 const rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/sites/'+HRE+'/settings')&&r.request().method()==='PUT')
 await page.getByRole('button',{name:'Save scheduling settings'}).click()
 expect((await rr).status()).toBeLessThan(300)
}
async function retainedCase(c:pg.Client,label:'A'|'B'|'C'){
 const r=await one(c,"select id::text,status,request_summary,garage_tenant_id::text,branch_id::text,vin from service_cases where requester_user_id=$1 and request_summary like $2 order by created_at desc limit 1",[OWNER,'SYNTHETIC / UAT OPS03 CASE-'+label+' %'])
 expect(r.status).toBe('accepted');expect(r.garage_tenant_id).toBe(GARAGE);expect(r.branch_id).toBe(HRE);expect(r.vin).toBe(VIN)
 return {id:r.id,summary:r.request_summary}
}
async function cleanupSyntheticLiveAppointments(page:Page,c:pg.Client){
 const live=await c.query("select a.id::text appointment_id,sc.id::text case_id,a.status from garage_appointments a join service_cases sc on sc.id=a.service_case_id where sc.requester_user_id=$1 and sc.request_summary like 'SYNTHETIC / UAT OPS03 CASE-%' and a.status in ('requested','confirmed') order by a.created_at",[OWNER])
 const cancelled=[]
 for(const row of live.rows){
  const r=await api(page,'POST','/service-cases/'+row.case_id+'/appointments/'+row.appointment_id+'/cancel')
  expect(r.status).toBeLessThan(300)
  cancelled.push({appointment_id:row.appointment_id,case_id:row.case_id,previous_status:row.status})
 }
 const residual=await c.query("select a.id::text from garage_appointments a join service_cases sc on sc.id=a.service_case_id where sc.requester_user_id=$1 and sc.request_summary like 'SYNTHETIC / UAT OPS03 CASE-%' and a.status in ('requested','confirmed')",[OWNER])
 expect(residual.rowCount).toBe(0)
 out('continuation-cleanup.json',{cancelled,residual_live_count:0,completed_at:new Date().toISOString()})
}

async function verifyRetainedConfiguration(c:pg.Client){
 const settings=await one(c,"select scheduling_enabled,max_concurrent_appointments,slot_interval_minutes from garage_branch_scheduling_settings where tenant_id=$1::uuid and branch_id=$2::uuid",[GARAGE,HRE])
 expect(settings).toEqual({scheduling_enabled:true,max_concurrent_appointments:1,slot_interval_minutes:30})
 const schedules=await c.query("select workforce_profile_id::text,day_of_week,starts_at::text,ends_at::text,effective_from::text,effective_until::text from garage_workforce_schedules where tenant_id=$1::uuid and branch_id=$2::uuid order by workforce_profile_id",[GARAGE,HRE])
 expect(schedules.rowCount).toBe(2)
 expect(schedules.rows.map((r:any)=>r.workforce_profile_id).sort()).toEqual([P1,P3].sort())
 for(const r of schedules.rows){expect(r.day_of_week).toBe(1);expect(r.starts_at).toBe('08:00:00');expect(r.ends_at).toBe('17:00:00')}
 const unavailability=await c.query("select workforce_profile_id::text,starts_at,ends_at,reason_code from garage_workforce_unavailability where tenant_id=$1::uuid order by starts_at",[GARAGE])
 expect(unavailability.rowCount).toBe(1);expect(unavailability.rows[0].workforce_profile_id).toBe(P1);expect(unavailability.rows[0].reason_code).toBe('training')
 const live=await c.query("select id from garage_appointments where tenant_id=$1::uuid and status in ('requested','confirmed')",[GARAGE]);expect(live.rowCount).toBe(0)
 out('retained-configuration-preflight.json',{settings,schedules:schedules.rows,unavailability:unavailability.rows,live_appointment_count:0})
}

test('GARAGE-1.0 OPS03 R2 STG01 timezone remediation and resumed physical certification',async({browser})=>{
 test.setTimeout(20*60_000)
 const c=await db()
 const harareContext=await browser.newContext({timezoneId:'Africa/Harare',viewport:{width:1440,height:1000}})
 const tokyoContext=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:1440,height:1000}})
 const harare=await harareContext.newPage()
 const tokyo=await tokyoContext.newPage()
 try{
  await verifyMigration(c)
  await deploy()
  await login(harare)
  await login(tokyo)
  await cleanupSyntheticLiveAppointments(harare,c)
  await verifyRetainedConfiguration(c)
  const flowStart=new Date()

  const A=await retainedCase(c,'A'),B=await retainedCase(c,'B'),C=await retainedCase(c,'C')
  const crmBefore=await c.query("select id::text,customer_reference_code,relationship_status,customer_category,preferred_branch_id::text,assigned_staff_user_id,internal_notes from garage_customer_relationships where tenant_id=$1::uuid and registered_user_id=$2 order by id",[GARAGE,OWNER])
  const walkBefore=await c.query("select id::text,relationship_status,party_kind from garage_customer_relationships where tenant_id=$1::uuid and party_kind='walk_in' order by id",[GARAGE])
  const ownerBefore=await one(c,"select owner_id from vehicles where vin=$1",[VIN])
  const work0=await c.query("select id::text,service_case_id::text,status from mechanic_work_orders where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])

  await requestUI(harare,A)
  const aRequested=await one(c,"select id::text,status,starts_at,ends_at,appointment_timezone from garage_appointments where service_case_id=$1::uuid and status='requested'",[A.id])
  expect(aRequested.status).toBe('requested')
  expect(new Date(aRequested.starts_at).toISOString()).toBe('2026-10-26T06:00:00.000Z')
  expect(new Date(aRequested.ends_at).toISOString()).toBe('2026-10-26T07:00:00.000Z')
  expect(aRequested.appointment_timezone).toBe('Africa/Harare')
  let r=await api(harare,'POST','/service-cases/'+B.id+'/appointments',{branch_id:HRE,starts_at:'2026-10-26T06:00:00.000Z',ends_at:'2026-10-26T07:00:00.000Z'})
  expect([200,201]).toContain(r.status)

  const harareConfirm=await confirmWithProof(harare,A.id,P3,'2026-10-26T08:00','2026-10-26T09:00')
  expect(harareConfirm.response.status()).toBeLessThan(300)
  expect(harareConfirm.browser_timezone).toBe('Africa/Harare')
  expect(harareConfirm.payload).toEqual({branch_id:HRE,starts_at:'2026-10-26T06:00:00.000Z',ends_at:'2026-10-26T07:00:00.000Z',planned_workforce_profile_id:P3})
  await shot(harare,'r2-desktop-01-harare-confirmed.png')

  const tokyoConflict=await confirmWithProof(tokyo,B.id,P1,'2026-10-26T08:00','2026-10-26T09:00')
  expect(tokyoConflict.browser_timezone).toBe('Asia/Tokyo')
  expect(tokyoConflict.payload).toEqual({branch_id:HRE,starts_at:'2026-10-26T06:00:00.000Z',ends_at:'2026-10-26T07:00:00.000Z',planned_workforce_profile_id:P1})
  expect(tokyoConflict.response.status()).toBeGreaterThanOrEqual(400)
  const tokyoConflictBody=await tokyoConflict.response.text()
  expect(tokyoConflictBody).toMatch(/CAPACITY|capacity/i)
  expect((await one(c,"select status from garage_appointments where service_case_id=$1::uuid and status='requested'",[B.id])).status).toBe('requested')
  await shot(tokyo,'r2-desktop-02-tokyo-capacity-conflict.png')

  await cancelGarage(harare,A.id)
  const tokyoConfirm=await confirmWithProof(tokyo,B.id,P1,'2026-10-26T08:00','2026-10-26T09:00')
  expect(tokyoConfirm.response.status()).toBeLessThan(300)
  expect(tokyoConfirm.browser_timezone).toBe('Asia/Tokyo')
  expect(tokyoConfirm.payload).toEqual({branch_id:HRE,starts_at:'2026-10-26T06:00:00.000Z',ends_at:'2026-10-26T07:00:00.000Z',planned_workforce_profile_id:P1})
  out('cross-timezone-confirmation.json',{harare:{browser_timezone:harareConfirm.browser_timezone,displayed:harareConfirm.displayed,payload:harareConfirm.payload,status:harareConfirm.response.status()},tokyo:{browser_timezone:tokyoConfirm.browser_timezone,displayed:tokyoConfirm.displayed,payload:tokyoConfirm.payload,status:tokyoConfirm.response.status()},invariant:'Both browser timezones displayed 08:00-09:00 Africa/Harare and submitted 06:00-07:00Z.'})
  await shot(tokyo,'r2-desktop-03-tokyo-confirmed.png')

  const good=await rescheduleWithProof(tokyo,B.id,'2026-10-26T09:00','2026-10-26T10:00')
  expect(good.response.status()).toBeLessThan(300)
  expect(good.payload).toEqual({branch_id:HRE,starts_at:'2026-10-26T07:00:00.000Z',ends_at:'2026-10-26T08:00:00.000Z',planned_workforce_profile_id:P1})
  const stable=await one(c,"select starts_at,ends_at,branch_id::text,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[good.id])
  const rescheduledBefore=Number((await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='rescheduled'",[good.id])).n)
  const bad=await rescheduleWithProof(tokyo,B.id,'2026-10-26T06:00','2026-10-26T07:00')
  expect(bad.payload).toEqual({branch_id:HRE,starts_at:'2026-10-26T04:00:00.000Z',ends_at:'2026-10-26T05:00:00.000Z',planned_workforce_profile_id:P1})
  expect(bad.response.status()).toBeGreaterThanOrEqual(400)
  const stableAfter=await one(c,"select starts_at,ends_at,branch_id::text,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[good.id])
  expect(new Date(stableAfter.starts_at).toISOString()).toBe(new Date(stable.starts_at).toISOString())
  expect(new Date(stableAfter.ends_at).toISOString()).toBe(new Date(stable.ends_at).toISOString())
  expect(stableAfter.branch_id).toBe(stable.branch_id);expect(stableAfter.planned_workforce_profile_id).toBe(stable.planned_workforce_profile_id)
  expect(Number((await one(c,"select count(*)::int n from garage_appointment_events where appointment_id=$1::uuid and event_type='rescheduled'",[good.id])).n)).toBe(rescheduledBefore)
  out('reschedule-proof.json',{valid_payload:good.payload,invalid_payload:bad.payload,invalid_status:bad.response.status(),old_slot_preserved:true})

  await setCapacity(harare,2)
  r=await api(harare,'POST','/service-cases/'+C.id+'/appointments',{branch_id:HRE,starts_at:'2026-10-26T07:00:00.000Z',ends_at:'2026-10-26T08:00:00.000Z'})
  expect([200,201]).toContain(r.status)
  const overlap=await confirmWithProof(harare,C.id,P1,'2026-10-26T09:00','2026-10-26T10:00')
  expect(overlap.response.status()).toBeGreaterThanOrEqual(400)
  expect(await overlap.response.text()).toMatch(/WORKFORCE|workforce|mechanic/i)
  expect((await one(c,"select status from garage_appointments where service_case_id=$1::uuid and status='requested'",[C.id])).status).toBe('requested')
  const cConfirm=await confirmWithProof(harare,C.id,P3,'2026-10-26T09:00','2026-10-26T10:00')
  expect(cConfirm.response.status()).toBeLessThan(300)
  await cancelRequesterUI(harare,C)
  await cancelGarage(harare,B.id)
  await setCapacity(harare,1)

  await harare.setViewportSize({width:390,height:844})
  await harare.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'})
  await expect(harare.getByRole('heading',{name:/Workshop schedule/i})).toBeVisible()
  await shot(harare,'r2-mobile-01-garage-schedule.png')
  await harare.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'})
  await expect(harare.getByTestId('service-request-card').filter({hasText:A.summary})).toHaveCount(1)
  await shot(harare,'r2-mobile-02-requester.png')

  const live=await c.query("select a.id::text,a.service_case_id::text,a.status from garage_appointments a where a.service_case_id=any($1::uuid[]) and a.status in ('requested','confirmed')",[[A.id,B.id,C.id]])
  expect(live.rowCount).toBe(0)
  const terminal=await c.query("select a.id::text,a.service_case_id::text,a.status,a.starts_at,a.ends_at,a.appointment_timezone from garage_appointments a where a.service_case_id=any($1::uuid[]) order by a.created_at",[[A.id,B.id,C.id]])
  const events=await c.query("select appointment_id::text,event_type,actor_user_id,actor_scope,created_at from garage_appointment_events where tenant_id=$1::uuid and created_at>=$2 order by created_at,id",[GARAGE,flowStart.toISOString()])
  const audits=await c.query("select id::text,event_type,actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,created_at from trust_audit_events where actor_tenant_id=$1 and created_at>=$2 and (event_type like 'GARAGE_APPOINTMENT_%' or event_type='GARAGE_BRANCH_SCHEDULING_UPDATED') order by created_at,id",[GARAGE,START.toISOString()])
  for(const t of ['GARAGE_APPOINTMENT_REQUESTED','GARAGE_APPOINTMENT_CONFIRMED','GARAGE_APPOINTMENT_RESCHEDULED','GARAGE_APPOINTMENT_CANCELLED','GARAGE_BRANCH_SCHEDULING_UPDATED'])expect(audits.rows.some((x:any)=>x.event_type===t),'missing '+t).toBe(true)
  expect(JSON.stringify(audits.rows)).not.toMatch(/password|token|cookie|postgres(?:ql)?:\/\//i)

  const work1=await c.query("select id::text,service_case_id::text,status from mechanic_work_orders where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
  expect(work1.rows).toEqual(work0.rows)
  const ownerAfter=await one(c,"select owner_id from vehicles where vin=$1",[VIN]);expect(ownerAfter.owner_id).toBe(ownerBefore.owner_id)
  const crmAfter=await c.query("select id::text,customer_reference_code,relationship_status,customer_category,preferred_branch_id::text,assigned_staff_user_id,internal_notes from garage_customer_relationships where tenant_id=$1::uuid and registered_user_id=$2 order by id",[GARAGE,OWNER]);expect(crmAfter.rows).toEqual(crmBefore.rows)
  const walkAfter=await c.query("select id::text,relationship_status,party_kind from garage_customer_relationships where tenant_id=$1::uuid and party_kind='walk_in' order by id",[GARAGE]);expect(walkAfter.rows).toEqual(walkBefore.rows)
  const fixture=await one(c,"select (select count(*)::int from garage_branches where tenant_id=$1::uuid and is_active) active_sites,(select count(*)::int from garage_branches where tenant_id=$1::uuid and is_primary) primary_sites,(select count(*)::int from tenant_users where tenant_id=$1::uuid and role='mechanic') mechanic_memberships,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active') active_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending') pending_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive') inactive_workforce,(select count(*)::int from garage_workforce_branch_assignments a join garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary) live_primary,(select count(*)::int from garage_departments where tenant_id=$1::uuid and is_active) active_departments,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2) owner_workforce",[GARAGE,OWNER])
  expect(fixture).toEqual({active_sites:3,primary_sites:1,mechanic_memberships:10,active_workforce:10,pending_workforce:0,inactive_workforce:0,live_primary:10,active_departments:4,owner_workforce:0})
  const finalSettings=await one(c,"select scheduling_enabled,max_concurrent_appointments,slot_interval_minutes from garage_branch_scheduling_settings where tenant_id=$1::uuid and branch_id=$2::uuid",[GARAGE,HRE])
  expect(finalSettings).toEqual({scheduling_enabled:true,max_concurrent_appointments:1,slot_interval_minutes:30})
  const rls=await c.query("select relname,relrowsecurity rls_enabled,relforcerowsecurity rls_forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('blockchain_custody_rollout','blockchain_signing_watermarks') order by relname")
  out('appointment-events.json',events.rows)
  out('trust-audits.json',audits.rows)
  out('appointment-terminal-history.json',terminal.rows)
  out('work-order-boundary.json',{before:work0.rows,after:work1.rows})
  out('ops02-boundary.json',{registered_before:crmBefore.rows,registered_after:crmAfter.rows,walkin_before:walkBefore.rows,walkin_after:walkAfter.rows})
  out('final-staging-state.json',{live_uat:live.rows,ops01_fixture:fixture,vehicle_owner:ownerAfter.owner_id,settings:finalSettings,retained_schedules:2,retained_unavailability:1})
  out('preexisting-rls.json',{classification:'PRE-EXISTING STAGING SECURITY ISSUE — OUTSIDE OPS03',tables:rls.rows})
  out('browser-summary.json',{product_sha:SHA,started_at:flowStart.toISOString(),completed_at:new Date().toISOString(),complete:true})
 }catch(e){
  out('failure-receipt.json',{at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)})
  throw e
 }finally{
  await harareContext.close().catch(()=>{})
  await tokyoContext.close().catch(()=>{})
  await c.end().catch(()=>{})
 }
})
