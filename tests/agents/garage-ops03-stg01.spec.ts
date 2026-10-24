import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { execFileSync } from 'node:child_process'
import { ensureActingForOrganisation } from './staging-helpers'

const SHA='2d4397304886ff049788a6085af96d56e45f1770'
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
 const selection=await ensureActingForOrganisation(page,new RegExp(GNAME.replace(/[.*+?^$(){}|[\]\\]/g,'\\ expect(await ensureActingForOrganisation(page,new RegExp(GNAME.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&'),'i'))).toBe(GARAGE)'),'i'))
 expect(selection.badge).toMatch(new RegExp(GNAME.replace(/[.*+?^$(){}|[\]\\]/g,'\\ expect(await ensureActingForOrganisation(page,new RegExp(GNAME.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&'),'i'))).toBe(GARAGE)'),'i'))
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

async function migrate(c:pg.Client){
 const tables=['garage_branch_scheduling_settings','garage_workforce_schedules','garage_workforce_unavailability','garage_appointments','garage_appointment_events']
 const preL=await c.query("select version,name from supabase_migrations.schema_migrations where version='20261023140000' or name='garage_ops03_appointments_scheduling_capacity'")
 const preT=await c.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname=any($1::text[])",[tables])
 out('migration-prestate.json',{ledger:preL.rows,tables:preT.rows})
 if(preL.rowCount||preT.rowCount)throw Error('BLOCK — OPS03 STAGING CUSTODY CHANGED')
 const src=fs.readFileSync('database/migrations/20261023140000_garage_ops03_appointments_scheduling_capacity.sql','utf8')
 const up=src.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m,'').trim()
 await c.query('begin')
 try{
  await c.query(up)
  await c.query("insert into supabase_migrations.schema_migrations(version,statements,name) values('20261023140000',$1,'garage_ops03_appointments_scheduling_capacity')",[[up]])
  await c.query('commit')
 }catch(e){await c.query('rollback');out('migration-failure.json',{error:String(e)});throw e}
 const ledger=await c.query("select version,name from supabase_migrations.schema_migrations where version='20261023140000'")
 expect(ledger.rowCount).toBe(1)
 const proof=await c.query("select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced,has_table_privilege('anon',c.oid,'select') anon_s,has_table_privilege('anon',c.oid,'insert') anon_i,has_table_privilege('anon',c.oid,'update') anon_u,has_table_privilege('anon',c.oid,'delete') anon_d,has_table_privilege('authenticated',c.oid,'select') auth_s,has_table_privilege('authenticated',c.oid,'insert') auth_i,has_table_privilege('authenticated',c.oid,'update') auth_u,has_table_privilege('authenticated',c.oid,'delete') auth_d,has_table_privilege('service_role',c.oid,'select') svc_s,has_table_privilege('service_role',c.oid,'insert') svc_i,has_table_privilege('service_role',c.oid,'update') svc_u,has_table_privilege('service_role',c.oid,'delete') svc_d from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname",[tables])
 expect(proof.rowCount).toBe(5)
 const grants:any={garage_branch_scheduling_settings:[true,true,true,false],garage_workforce_schedules:[true,true,true,false],garage_workforce_unavailability:[true,true,true,false],garage_appointments:[true,true,true,false],garage_appointment_events:[true,true,false,false]}
 for(const r of proof.rows){expect(r.rls).toBe(true);expect(r.forced).toBe(true);for(const k of ['anon_s','anon_i','anon_u','anon_d','auth_s','auth_i','auth_u','auth_d'])expect(r[k]).toBe(false);expect([r.svc_s,r.svc_i,r.svc_u,r.svc_d]).toEqual(grants[r.relname])}
 const sigs=['garage_ops03_upsert_branch_scheduling_settings(uuid,uuid,boolean,integer,integer,text)','garage_ops03_add_workforce_schedule(uuid,uuid,uuid,integer,time without time zone,time without time zone,date,date,text)','garage_ops03_add_workforce_unavailability(uuid,uuid,timestamptz,timestamptz,text,text)','garage_ops03_request_appointment(uuid,uuid,timestamptz,timestamptz,text)','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_reschedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','garage_ops03_transition_appointment(uuid,text,text,text,uuid)']
 const rpc=[]
 for(const sig of sigs){const r=await one(c,"select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('service_role',$1,'execute') svc,exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') pub",[sig]);expect(r).toEqual({anon:false,auth:false,svc:true,pub:false});rpc.push({signature:sig,...r})}
 const triggerNames=['trg_garage_ops03_settings_touch','trg_garage_ops03_work_schedule_touch','trg_garage_ops03_unavailability_touch','trg_garage_ops03_validate_workforce_schedule','trg_garage_ops03_validate_unavailability','trg_garage_ops03_validate_appointment','trg_garage_ops03_events_append_only','trg_garage_ops03_guard_branch_deactivation','trg_garage_ops03_guard_workforce_deactivation']
 const tr=await c.query("select tgname from pg_trigger where not tgisinternal and tgname=any($1::text[]) order by tgname",[triggerNames])
 expect(tr.rows.map(r=>r.tgname).sort()).toEqual([...triggerNames].sort())
 out('schema-privileges.json',{ledger:ledger.rows,duplicate_count:0,tables:proof.rows,rpcs:rpc,triggers:tr.rows,applied_at:new Date().toISOString()})
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
async function appointmentCard(page:Page,caseId:string){await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});const x=page.getByTestId('appointment-card').filter({hasText:'Service Case '+caseId});await expect(x).toHaveCount(1);return x}
async function confirm(page:Page,caseId:string,profile:string){
 const x=await appointmentCard(page,caseId);await x.getByRole('button',{name:'Review and confirm'}).click()
 const id=(await x.getByLabel(/Appointment planned mechanic/).getAttribute('aria-label'))!.replace('Appointment planned mechanic ','')
 await x.getByLabel('Appointment site '+id).selectOption(HRE);await x.getByLabel('Appointment planned mechanic '+id).selectOption(profile)
 const rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/'+id+'/confirm')&&r.request().method()==='POST')
 await x.getByRole('button',{name:'Confirm appointment'}).click();return {id,response:await rr}
}
async function cancelGarage(page:Page,caseId:string){const x=await appointmentCard(page,caseId);const rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/appointments/')&&r.url().endsWith('/status')&&r.request().method()==='POST');await x.getByRole('button',{name:'Cancel'}).click();expect((await rr).status()).toBeLessThan(300)}

test('GARAGE-1.0 OPS03 STG01 controlled physical certification',async({page})=>{
 test.setTimeout(20*60_000)
 const c=await db()
 try{
  await migrate(c);await deploy();await login(page)
  const session=await one(c,"select active_role,active_organization_id::text from user_sessions where user_id=$1 and is_valid=true order by created_at desc limit 1",[OWNER]);expect(session.active_role).toBe('owner');expect(session.active_organization_id).toBe(GARAGE)
  const crmBefore=await c.query("select id::text,customer_reference_code,relationship_status,customer_category,preferred_branch_id::text,assigned_staff_user_id,internal_notes from garage_customer_relationships where tenant_id=$1::uuid and registered_user_id=$2 order by id",[GARAGE,OWNER])
  const walkBefore=await c.query("select id::text,relationship_status,party_kind from garage_customer_relationships where tenant_id=$1::uuid and party_kind='walk_in' order by id",[GARAGE])
  const ownerBefore=await one(c,"select owner_id from vehicles where vin=$1",[VIN])

  await page.setViewportSize({width:1440,height:1000});await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await expect(page.getByText('Capacity not configured').first()).toBeVisible();await shot(page,'desktop-01-unconfigured.png')
  await page.getByLabel('Scheduling settings site').selectOption(HRE);await page.getByLabel('Scheduling enabled').selectOption('true');await page.getByLabel('Maximum concurrent appointments').fill('1');await page.getByLabel('Slot interval minutes').fill('30')
  let rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/sites/')&&r.url().endsWith('/settings')&&r.request().method()==='PUT');await page.getByRole('button',{name:'Save scheduling settings'}).click();expect((await rr).status()).toBeLessThan(300)
  expect(Number((await one(c,"select count(*)::int n from trust_audit_events where actor_tenant_id=$1 and event_type='GARAGE_BRANCH_SCHEDULING_UPDATED' and created_at>=$2",[GARAGE,START.toISOString()])).n)).toBe(1)

  for(const u of [U1,U3]){await page.getByLabel('Recurring schedule workforce').selectOption(u);await page.getByLabel('Recurring schedule site').selectOption(HRE);await page.getByLabel('Recurring schedule day').selectOption('1');await page.getByLabel('Recurring schedule effective from').fill('2026-10-01');await page.getByLabel('Recurring schedule starts').fill('08:00');await page.getByLabel('Recurring schedule ends').fill('17:00');rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/workforce/')&&r.url().endsWith('/recurring')&&r.request().method()==='POST');await page.getByRole('button',{name:'Add recurring schedule'}).click();expect((await rr).status()).toBeLessThan(300)}
  await page.getByLabel('Unavailability workforce').selectOption(U1);await page.getByLabel('Unavailability starts').fill(DATE+'T12:00');await page.getByLabel('Unavailability ends').fill(DATE+'T13:00');await page.getByLabel('Unavailability reason').selectOption('training');rr=page.waitForResponse(r=>r.url().includes('/api/garage/schedule/workforce/')&&r.url().endsWith('/unavailability')&&r.request().method()==='POST');await page.getByRole('button',{name:'Record unavailability'}).click();expect((await rr).status()).toBeLessThan(300);await shot(page,'desktop-02-config-workforce.png')

  const slug=await prepProfile(page,c);const A=await createCase(page,slug,'CASE-A'),B=await createCase(page,slug,'CASE-B'),C=await createCase(page,slug,'CASE-C');out('service-cases-created.json',{A,B,C})
  const work0=await c.query("select id::text,service_case_id::text,status from mechanic_work_orders where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
  await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await page.getByLabel('Capacity Service Case').selectOption(A.id);await page.getByLabel('Capacity site').selectOption(HRE);await page.getByLabel('Capacity date').fill(DATE);await page.getByLabel('Capacity duration minutes').fill('60');await page.getByRole('button',{name:'Calculate capacity'}).click();await expect(page.getByTestId('capacity-results')).toContainText('Site capacity: 1');await shot(page,'desktop-02b-capacity-inspector.png')
  const av:any=json(await api(page,'GET','/garage/schedule/availability?service_case_id='+A.id+'&branch_id='+HRE+'&date='+DATE+'&duration_minutes=60'));expect(av.configured).toBe(true);expect(av.capacity).toBe(1);const noon=av.slots.find((x:any)=>new Date(x.starts_at).getUTCHours()===10);expect(noon.available_workforce_profile_ids).not.toContain(P1);out('availability-proof.json',{capacity:av.capacity,slots:av.slots})

  await requestUI(page,A);await shot(page,'desktop-03-requested.png')
  const ar=await one(c,"select status,starts_at::text,ends_at::text from garage_appointments where service_case_id=$1::uuid",[A.id]);expect(ar.status).toBe('requested')
  const av2:any=json(await api(page,'GET','/garage/schedule/availability?service_case_id='+A.id+'&branch_id='+HRE+'&date='+DATE+'&duration_minutes=60'));const same=av2.slots.find((x:any)=>new Date(x.starts_at).toISOString()===new Date(ar.starts_at).toISOString());expect(same.booked_count).toBe(0)
  let r=await api(page,'POST','/service-cases/'+B.id+'/appointments',{branch_id:HRE,starts_at:new Date(ar.starts_at).toISOString(),ends_at:new Date(ar.ends_at).toISOString()});expect([200,201]).toContain(r.status)

  let ca=await confirm(page,A.id,P3);expect(ca.response.status()).toBeLessThan(300);await shot(page,'desktop-04-confirmed.png')
  let cb=await confirm(page,B.id,P1);expect(cb.response.status()).toBeGreaterThanOrEqual(400);expect((await one(c,"select status from garage_appointments where service_case_id=$1::uuid",[B.id])).status).toBe('requested');expect(Number((await one(c,"select count(*)::int n from garage_appointment_events e join garage_appointments a on a.id=e.appointment_id where a.service_case_id=$1::uuid and e.event_type='confirmed'",[B.id])).n)).toBe(0);await shot(page,'desktop-05-capacity-conflict.png')
  await cancelGarage(page,A.id);cb=await confirm(page,B.id,P1);expect(cb.response.status()).toBeLessThan(300)

  let bc=await appointmentCard(page,B.id);await bc.getByRole('button',{name:'Reschedule'}).click();const bid=(await bc.getByLabel(/Appointment start/).getAttribute('aria-label'))!.replace('Appointment start ','');await bc.getByLabel('Appointment start '+bid).fill(DATE+'T10:00');await bc.getByLabel('Appointment end '+bid).fill(DATE+'T11:00');rr=page.waitForResponse(x=>x.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&x.request().method()==='POST');await bc.getByRole('button',{name:'Save reschedule'}).click();expect((await rr).status()).toBeLessThan(300);await shot(page,'desktop-06-rescheduled.png')
  const stable=await one(c,"select starts_at::text,ends_at::text,branch_id::text,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[bid])
  bc=await appointmentCard(page,B.id);await bc.getByRole('button',{name:'Reschedule'}).click();await bc.getByLabel('Appointment start '+bid).fill(DATE+'T06:00');await bc.getByLabel('Appointment end '+bid).fill(DATE+'T07:00');rr=page.waitForResponse(x=>x.url().includes('/api/garage/schedule/appointments/'+bid+'/reschedule')&&x.request().method()==='POST');await bc.getByRole('button',{name:'Save reschedule'}).click();expect((await rr).status()).toBeGreaterThanOrEqual(400);expect(await one(c,"select starts_at::text,ends_at::text,branch_id::text,planned_workforce_profile_id::text from garage_appointments where id=$1::uuid",[bid])).toEqual(stable)

  await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await page.getByLabel('Scheduling settings site').selectOption(HRE);await page.getByLabel('Scheduling enabled').selectOption('true');await page.getByLabel('Maximum concurrent appointments').fill('2');await page.getByLabel('Slot interval minutes').fill('30');await page.getByRole('button',{name:'Save scheduling settings'}).click()
  r=await api(page,'POST','/service-cases/'+C.id+'/appointments',{branch_id:HRE,starts_at:new Date(stable.starts_at).toISOString(),ends_at:new Date(stable.ends_at).toISOString()});expect([200,201]).toContain(r.status)
  const cc=await confirm(page,C.id,P1);expect(cc.response.status()).toBeGreaterThanOrEqual(400);expect((await one(c,"select status from garage_appointments where service_case_id=$1::uuid",[C.id])).status).toBe('requested')

  await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'});const ccard=page.getByTestId('service-request-card').filter({hasText:C.summary});await ccard.getByRole('button',{name:'Cancel appointment'}).click();await expect(ccard.getByTestId('appointment-status')).toContainText('Cancelled')
  const outside=await api(page,'POST','/service-cases/'+C.id+'/appointments',{branch_id:HRE,starts_at:'2026-10-26T04:00:00.000Z',ends_at:'2026-10-26T05:00:00.000Z'});expect(outside.status).toBeGreaterThanOrEqual(400)
  await cancelGarage(page,B.id)

  await page.setViewportSize({width:390,height:844});await page.goto(WEB+'/garage/schedule',{waitUntil:'networkidle'});await expect(page.getByRole('heading',{name:/Workshop schedule/i})).toBeVisible();await expect(page.getByLabel('Scheduling settings site')).toBeVisible();await shot(page,'mobile-01-garage-schedule.png');await page.goto(WEB+'/dashboard/service-requests',{waitUntil:'networkidle'});await expect(page.getByTestId('service-request-card').filter({hasText:A.summary})).toHaveCount(1);await shot(page,'mobile-02-requester.png')

  const events=await c.query("select appointment_id::text,event_type,actor_user_id,actor_scope,created_at from garage_appointment_events where tenant_id=$1::uuid and created_at>=$2 order by created_at,id",[GARAGE,START.toISOString()])
  const audits=await c.query("select id::text,event_type,actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,previous_value is not null previous_present,new_value is not null new_present,created_at from trust_audit_events where actor_tenant_id=$1 and created_at>=$2 and (event_type like 'GARAGE_APPOINTMENT_%' or event_type like 'GARAGE_%SCHEDUL%' or event_type like 'GARAGE_WORKFORCE_%') order by created_at,id",[GARAGE,START.toISOString()])
  for(const t of ['GARAGE_BRANCH_SCHEDULING_UPDATED','GARAGE_WORKFORCE_SCHEDULE_UPDATED','GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED','GARAGE_APPOINTMENT_REQUESTED','GARAGE_APPOINTMENT_CONFIRMED','GARAGE_APPOINTMENT_RESCHEDULED','GARAGE_APPOINTMENT_CANCELLED'])expect(audits.rows.some(x=>x.event_type===t),'missing '+t).toBe(true)
  expect(audits.rows.filter(x=>x.event_type==='GARAGE_BRANCH_SCHEDULING_UPDATED')).toHaveLength(2);expect(audits.rows.filter(x=>x.event_type==='GARAGE_WORKFORCE_SCHEDULE_UPDATED')).toHaveLength(2);expect(audits.rows.filter(x=>x.event_type==='GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED')).toHaveLength(1)
  expect(audits.rows.some(x=>x.event_type==='GARAGE_APPOINTMENT_REQUESTED'&&x.source_route==='/api/service-cases/:caseId/appointments'&&x.actor_user_id===OWNER)).toBe(true)
  expect(audits.rows.some(x=>x.event_type==='GARAGE_APPOINTMENT_CONFIRMED'&&x.source_route==='/api/garage/schedule'&&x.actor_user_id===OWNER)).toBe(true)
  expect(JSON.stringify(audits.rows)).not.toMatch(/password|token|cookie|postgres(?:ql)?:\/\//i)

  const work1=await c.query("select id::text,service_case_id::text,status from mechanic_work_orders where service_case_id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]]);expect(work1.rows).toEqual(work0.rows)
  const ownerAfter=await one(c,"select owner_id from vehicles where vin=$1",[VIN]);expect(ownerAfter.owner_id).toBe(ownerBefore.owner_id)
  const crmAfter=await c.query("select id::text,customer_reference_code,relationship_status,customer_category,preferred_branch_id::text,assigned_staff_user_id,internal_notes from garage_customer_relationships where tenant_id=$1::uuid and registered_user_id=$2 order by id",[GARAGE,OWNER]);expect(crmAfter.rows).toEqual(crmBefore.rows)
  const walkAfter=await c.query("select id::text,relationship_status,party_kind from garage_customer_relationships where tenant_id=$1::uuid and party_kind='walk_in' order by id",[GARAGE]);expect(walkAfter.rows).toEqual(walkBefore.rows)

  const fixture=await one(c,"select (select count(*)::int from garage_branches where tenant_id=$1::uuid and is_active) active_sites,(select count(*)::int from garage_branches where tenant_id=$1::uuid and is_primary) primary_sites,(select count(*)::int from tenant_users where tenant_id=$1::uuid and role='mechanic') mechanic_memberships,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active') active_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending') pending_workforce,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive') inactive_workforce,(select count(*)::int from garage_workforce_branch_assignments a join garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary) live_primary,(select count(*)::int from garage_departments where tenant_id=$1::uuid and is_active) active_departments,(select count(*)::int from garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2) owner_workforce",[GARAGE,OWNER])
  expect(fixture).toEqual({active_sites:3,primary_sites:1,mechanic_memberships:10,active_workforce:10,pending_workforce:0,inactive_workforce:0,live_primary:10,active_departments:4,owner_workforce:0})
  const counts=await c.query("select status,count(*)::int count from garage_appointments where tenant_id=$1::uuid group by status order by status",[GARAGE])
  const live=await c.query("select id::text,service_case_id::text,status from garage_appointments where tenant_id=$1::uuid and status in ('requested','confirmed')",[GARAGE]);expect(live.rows.filter(x=>[A.id,B.id,C.id].includes(x.service_case_id))).toHaveLength(0)
  const cases=await c.query("select id::text,requester_user_id,garage_tenant_id::text,branch_id::text,vin,status,request_summary from service_cases where id=any($1::uuid[]) order by id",[[A.id,B.id,C.id]])
  const rls=await c.query("select relname,relrowsecurity rls_enabled,relforcerowsecurity rls_forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('blockchain_custody_rollout','blockchain_signing_watermarks') order by relname")
  out('appointment-events.json',events.rows);out('trust-audits.json',audits.rows);out('final-service-cases.json',cases.rows);out('work-order-boundary.json',{before:work0.rows,after:work1.rows});out('ops02-boundary.json',{registered_before:crmBefore.rows,registered_after:crmAfter.rows,walkin_before:walkBefore.rows,walkin_after:walkAfter.rows})
  out('final-staging-state.json',{appointment_counts:counts.rows,live_uat:live.rows.filter(x=>[A.id,B.id,C.id].includes(x.service_case_id)),ops01_fixture:fixture,vehicle_owner:ownerAfter.owner_id,mechanic_auth:'SOURCE-CERTIFIED / NOT PHYSICALLY RE-AUTHENTICATED',retained_configuration:'Harare scheduling enabled at capacity 2; UAT-001/UAT-003 Monday schedules retained; UAT-001 training unavailability retained as bounded historical UAT evidence because product exposes no governed delete control.'})
  out('preexisting-rls.json',{classification:'PRE-EXISTING STAGING SECURITY ISSUE — OUTSIDE OPS03',tables:rls.rows});out('browser-summary.json',{product_sha:SHA,run:RUN,started_at:START.toISOString(),completed_at:new Date().toISOString(),complete:true})
 }catch(e){out('failure-receipt.json',{at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)});throw e}finally{await c.end().catch(()=>{})}
})
