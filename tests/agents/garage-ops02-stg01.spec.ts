import { expect, stagingTest as test, ensureActingForOrganisation } from './staging-helpers'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import type { Page } from '@playwright/test'

const SHA='7cbad41cac7776f13e6a0d766bfb995eb2f35d1e'
const OWNER='uat_ops01_owner_20261022a'
const EMAIL='ops01.owner.20261022a@carup-staging.test'
const OWNER_NAME='SYNTHETIC / UAT OPS01 Garage Owner'
const GARAGE='442c82c1-fc69-46ff-a138-712a6504ac98'
const GARAGE_NAME='SYNTHETIC / UAT OPS01 GARAGE 20261022A'
const VIN='UATOPS01202600001'
const CASE='e1000000-0000-4000-8000-000000000001'
const WO='e2000000-0000-4000-8000-000000000001'
const SITE='b1000000-0000-4000-8000-000000000001'
const ADVISOR='uat_ops01_mech01_20261022a'
const STAGE='eoyenigwevnxwwhyhaer'
const PROD='vhmnajoeicasaigiophh'
const WEB=(process.env.STAGING_WEB_URL||'https://staging.carup.dev').replace(/\/$/,'')
const API=(process.env.STAGING_API_URL||'https://api-staging.carup.dev/api').replace(/\/$/,'')
const OUT=path.resolve(process.env.GARAGE_OPS02_RESULTS_DIR||'test-results/garage-ops02-stg01')
const PASSWORD_FILE=process.env.GARAGE_OPS02_PASSWORD_FILE||''
const SUFFIX=String(process.env.GARAGE_OPS02_RUN_ID||process.env.GITHUB_RUN_ID||Date.now()).replace(/[^A-Za-z0-9]/g,'').slice(-12).toUpperCase()
const WALK='SYNTHETIC / UAT OPS02 WALK-IN '+SUFFIX
const NOTE='SYNTHETIC / UAT OPS02 CRM PROOF'
const WALK_NOTE='SYNTHETIC / UAT OPS02 WALK-IN PROOF'
const STARTED=new Date()

function dbUrl(){
  const v=process.env.DIASPORA_STAGING_DATABASE_URL||''
  if(!v||v.includes(PROD)||!v.includes(STAGE)) throw new Error('REFUSING OPS02 CERTIFICATION OUTSIDE APPROVED STAGING')
  return v.replace(/([?&])sslmode=[^&]*&?/i,'$1').replace(/[?&]$/,'')
}
async function db(){const c=new pg.Client({connectionString:dbUrl(),ssl:{rejectUnauthorized:false}});await c.connect();return c}
async function one(c:pg.Client,q:string,p:unknown[]=[]){const r=await c.query(q,p);if(r.rowCount!==1)throw new Error('Expected one row, got '+r.rowCount);return r.rows[0]}
function json(name:string,v:unknown){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(v,null,2)+'\n')}
function password(){
  if(!PASSWORD_FILE)throw new Error('GARAGE_OPS02_PASSWORD_FILE missing')
  const s=fs.lstatSync(PASSWORD_FILE);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)throw new Error('unsafe password file')
  return fs.readFileSync(PASSWORD_FILE,'utf8').trim()
}
async function login(page:Page){
  await page.goto('/login',{waitUntil:'networkidle'})
  await page.getByTestId('email-input').fill(EMAIL)
  await page.getByTestId('password-input').fill(password())
  const rp=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/auth\/login(?:\?|$)/.test(r.url()))
  await page.getByTestId('login-button').click()
  expect((await rp).status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/,{timeout:20000})
}
async function save(page:Page){
  const rp=page.waitForResponse(r=>r.request().method()==='PATCH'&&/\/api\/garage\/customers\/.+\/relationship(?:\?|$)/.test(r.url()))
  await page.getByRole('button',{name:'Save relationship'}).click()
  expect((await rp).status()).toBeLessThan(300)
  await expect(page.getByText('Garage relationship updated.')).toBeVisible({timeout:20000})
}
async function rel(c:pg.Client){return one(c,"select id::text,party_kind,origin,registered_user_id,relationship_status,customer_reference_code,customer_category,preferred_branch_id::text,assigned_staff_user_id,internal_notes,tags,first_relationship_at,follow_up_at,follow_up_status from public.garage_customer_relationships where tenant_id=$1::uuid and registered_user_id=$2",[GARAGE,OWNER])}
async function advisor(c:pg.Client){const r=await one(c,"select jsonb_build_object('user_id',p.user_id,'staff_code',p.staff_code,'employment_status',p.employment_status,'classification',p.employment_classification,'tenant_role',tu.role,'assignments',coalesce((select jsonb_agg(jsonb_build_object('branch_id',a.branch_id::text,'is_primary',a.is_primary,'ended_at',a.ended_at) order by a.ended_at nulls first,a.is_primary desc,a.branch_id::text) from public.garage_workforce_branch_assignments a where a.tenant_id=p.tenant_id and a.workforce_profile_id=p.id),'[]'::jsonb)) state from public.garage_workforce_profiles p join public.tenant_users tu on tu.tenant_id=p.tenant_id and tu.user_id=p.user_id where p.tenant_id=$1::uuid and p.user_id=$2",[GARAGE,ADVISOR]);return r.state}
async function audit(c:pg.Client,t:string){
  const r=await one(c,"select id::text,event_type,actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,created_at,previous_value,new_value from public.trust_audit_events where actor_tenant_id=$1 and actor_user_id=$2 and event_type=$3 and created_at >= $4::timestamptz order by created_at desc,id desc limit 1",[GARAGE,OWNER,t,STARTED.toISOString()])
  expect(r.actor_user_id).toBe(OWNER);expect(r.actor_role).toBe('owner');expect(r.actor_tenant_id).toBe(GARAGE);expect(r.actor_type).toBe('user');expect(r.source_route).toMatch(/^\/api\/garage\/customers/);return r
}

test.describe.configure({mode:'serial'})
test('GARAGE-1.0 OPS02 STG01 physical CRM certification',async({page,request})=>{
  test.setTimeout(10*60_000);fs.mkdirSync(OUT,{recursive:true});const c=await db()
  const evidence:any={product_sha:SHA,garage_id:GARAGE,walk_in_label:WALK,started_at:STARTED.toISOString()}
  try{
    const pr=await request.get(WEB+'/carup-provenance.json?ops02='+SUFFIX),hr=await request.get(API+'/health?ops02='+SUFFIX)
    expect(pr.ok()).toBeTruthy();expect(hr.ok()).toBeTruthy()
    const prov=await pr.json(),health=await hr.json()
    expect(prov.commit_sha).toBe(SHA);expect(prov.unpaired).toBe(false);expect(health.status).toBe('UP');expect(health.build.commit_sha).toBe(SHA);expect(health.build.source).toBe('vercel_git');expect(health.build.provenance_available).toBe(true);expect(health.database.supabase_project_ref).toBe(STAGE);expect(health.database.consistent).toBe(true);expect(health.communications.outbound.kill_switch).toBe('active')
    evidence.runtime={frontend_sha:prov.commit_sha,backend_sha:health.build.commit_sha,backend_deployment_id:health.build.deployment_id,database:health.database.supabase_project_ref}

    const before=await rel(c),ref=before.customer_reference_code
    expect(before.party_kind).toBe('registered');expect(before.origin).toBe('service_case');expect(before.relationship_status).toBe('active');expect(ref).toMatch(/^CUS-/)
    for(const k of ['customer_category','preferred_branch_id','assigned_staff_user_id','internal_notes','follow_up_at','follow_up_status'])expect(before[k]).toBeNull()
    expect(before.tags).toEqual([])

    const case0=await one(c,"select id::text,garage_tenant_id::text,requester_user_id,vin,status,branch_id::text,requested_at,service_category,conversation_thread_id from public.service_cases where id=$1::uuid",[CASE])
    const wo0=await one(c,"select id::text,service_case_id::text,tenant_id::text,vin,status,created_at from public.mechanic_work_orders where id=$1::uuid",[WO])
    const veh0=await one(c,"select vin,owner_id,status,publication_status,trust_score from public.vehicles where vin=$1",[VIN])
    expect(case0.garage_tenant_id).toBe(GARAGE);expect(case0.requester_user_id).toBe(OWNER);expect(case0.vin).toBe(VIN);expect(wo0.service_case_id).toBe(CASE);expect(wo0.status).toBe('pending');expect(veh0.owner_id).toBe(OWNER)
    const sr=await one(c,"select count(*)::int count from public.service_records where service_case_id=$1::uuid",[CASE]);expect(Number(sr.count)).toBe(0)
    const site=await one(c,"select tenant_id::text,is_active from public.garage_branches where id=$1::uuid",[SITE]);expect(site.tenant_id).toBe(GARAGE);expect(site.is_active).toBe(true)
    const adv0=await advisor(c);expect(adv0.employment_status).toBe('active');expect(adv0.tenant_role).toBe('mechanic')

    await login(page)
    const sel=await ensureActingForOrganisation(page,/SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/)
    expect(sel.badge).toContain(GARAGE_NAME);if(sel.outcome==='selected')expect(sel.tenantId).toBe(GARAGE)
    const sess=await one(c,"select id::text,user_id,active_role,active_organization_id::text,is_valid from public.user_sessions where user_id=$1 and is_valid=true and expires_at::timestamptz>now() order by created_at desc limit 1",[OWNER])
    expect(sess.active_role).toBe('owner');expect(sess.active_organization_id).toBe(GARAGE);expect(sess.is_valid).toBe(true)
    evidence.organisation_selection={outcome:sel.outcome,tenant_id:sel.tenantId||GARAGE,badge:sel.badge,active_role:sess.active_role,active_organization_id:sess.active_organization_id}

    await page.goto('/garage/customers',{waitUntil:'networkidle'});await expect(page).toHaveURL(/\/garage\/customers$/);await expect(page.getByTestId('customers-error')).toHaveCount(0)
    let row=page.getByTestId('customer-row').filter({hasText:OWNER_NAME});await expect(row).toHaveCount(1);await expect(row).toContainText('CarUp account · service requester');await expect(row).toContainText(ref);await expect(row).toContainText('1 related vehicle');await expect(row).toContainText('1 service case');await expect(row.getByTestId('customer-spend')).toHaveText('No cost recorded')
    await page.screenshot({path:path.join(OUT,'desktop-customer-list.png'),fullPage:true})
    await row.getByTestId('customer-name').click()
    await expect(page.getByRole('heading',{name:OWNER_NAME})).toBeVisible();await expect(page.getByText('CarUp account · '+ref)).toBeVisible();await expect(page.getByText('VIN '+VIN)).toBeVisible();await expect(page.getByText('Relationship: service requester for this VIN')).toBeVisible();await expect(page.getByText('Canonical owner: This CarUp customer')).toBeVisible();await expect(page.getByText('Recorded service costs: No cost recorded')).toBeVisible();await expect(page.getByText('1 service cases · 1 work orders · 0 service records')).toBeVisible();await expect(page.getByText(/Work order e2000000 · pending/)).toBeVisible();await expect(page.getByText('Conversation: Not recorded')).toBeVisible()
    await page.screenshot({path:path.join(OUT,'desktop-registered-detail.png'),fullPage:true})

    for(const l of ['Category: Not recorded','Preferred site: Not recorded','Service advisor: Not recorded','Follow-up: Not recorded','Tags: Not recorded','Internal notes: Not recorded'])await expect(page.getByText(l,{exact:false})).toBeVisible()
    for(const l of ['Customer category','Preferred site','Assigned service advisor','Follow-up date','Follow-up status','Garage tags (comma separated)','Private Garage notes'])await expect(page.getByLabel(l)).toHaveValue('')
    await page.screenshot({path:path.join(OUT,'desktop-blank-metadata.png'),fullPage:true})

    await page.getByLabel('Customer category').selectOption('individual');await page.getByLabel('Garage tags (comma separated)').fill('uat-ops02');await page.getByLabel('Private Garage notes').fill(NOTE);await save(page)
    let a=await audit(c,'GARAGE_CUSTOMER_RELATIONSHIP_UPDATED');expect(a.new_value.notes_changed).toBe(true);expect(JSON.stringify([a.previous_value,a.new_value])).not.toContain(NOTE)
    await page.getByLabel('Preferred site').selectOption(SITE);await save(page);a=await audit(c,'GARAGE_CUSTOMER_SITE_CHANGED');expect(a.new_value.preferred_branch_id).toBe(SITE)
    await page.getByLabel('Assigned service advisor').selectOption(ADVISOR);await save(page);a=await audit(c,'GARAGE_CUSTOMER_STAFF_CHANGED');expect(a.new_value.assigned_staff_user_id).toBe(ADVISOR)
    const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);await page.getByLabel('Follow-up date').fill(future);await page.getByLabel('Follow-up status').selectOption('pending');await save(page);a=await audit(c,'GARAGE_CUSTOMER_FOLLOW_UP_CHANGED');expect(a.new_value.follow_up_status).toBe('pending')
    expect(await advisor(c)).toEqual(adv0);await page.screenshot({path:path.join(OUT,'desktop-edited-metadata.png'),fullPage:true})

    await page.getByRole('link',{name:'← Back to customers'}).click()
    await page.getByLabel('Search by name or reference').fill(ref);await expect(page.getByTestId('customer-row').filter({hasText:OWNER_NAME})).toHaveCount(1);await page.getByLabel('Search by name or reference').fill('')
    await page.getByLabel('Relationship status').selectOption('active');await expect(page.getByTestId('customer-row').filter({hasText:OWNER_NAME})).toHaveCount(1);await page.getByLabel('Relationship status').selectOption('all')
    await page.getByLabel('Preferred site').selectOption(SITE);await expect(page.getByTestId('customer-row').filter({hasText:OWNER_NAME})).toHaveCount(1);await page.getByLabel('Preferred site').selectOption('all')
    await page.getByLabel('Follow-up due').check();await expect(page.getByText('No relationships match these filters.')).toBeVisible();await expect(page.getByTestId('customers-empty')).toHaveCount(0);await page.getByLabel('Follow-up due').uncheck()
    await page.getByLabel('Last service').selectOption('oldest');await page.getByLabel('Search by name or reference').fill('NO-SUCH-OPS02-CUSTOMER');await expect(page.getByText('No relationships match these filters.')).toBeVisible();await expect(page.getByTestId('customers-empty')).toHaveCount(0);await page.getByLabel('Search by name or reference').fill('')
    await page.screenshot({path:path.join(OUT,'desktop-search-filters.png'),fullPage:true})

    await page.getByTestId('customer-row').filter({hasText:OWNER_NAME}).getByTestId('customer-name').click()
    await page.getByLabel('Customer category').selectOption('');await page.getByLabel('Preferred site').selectOption('');await page.getByLabel('Assigned service advisor').selectOption('');await page.getByLabel('Follow-up date').fill('');await page.getByLabel('Follow-up status').selectOption('');await page.getByLabel('Garage tags (comma separated)').fill('');await page.getByLabel('Private Garage notes').fill('');await save(page)
    const restored=await rel(c);expect(restored.customer_reference_code).toBe(ref);for(const k of ['customer_category','preferred_branch_id','assigned_staff_user_id','internal_notes','follow_up_at','follow_up_status'])expect(restored[k]).toBeNull();expect(restored.tags).toEqual([]);expect(await advisor(c)).toEqual(adv0)

    await page.goto('/garage/customers',{waitUntil:'networkidle'});await page.getByLabel('Prospect label').fill(WALK);await page.getByLabel('I confirm this was a real walk-in interaction.').check()
    const cp=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/garage\/customer-prospects(?:\?|$)/.test(r.url()));await page.getByRole('button',{name:'Record prospect'}).click();expect((await cp).status()).toBe(201)
    row=page.getByTestId('customer-row').filter({hasText:WALK});await expect(row).toHaveCount(1);await expect(row).toContainText('Garage prospect · identity unverified');await expect(row).toContainText('0 related vehicles');await expect(row).toContainText('0 service cases');await expect(row.getByTestId('customer-spend')).toHaveText('No cost recorded')
    await page.screenshot({path:path.join(OUT,'desktop-walk-in-list.png'),fullPage:true})
    const walk=await one(c,"select id::text,party_kind,origin,relationship_status,registered_user_id,external_identity_id,prospect_name,customer_reference_code from public.garage_customer_relationships where tenant_id=$1::uuid and prospect_name=$2 order by created_at desc limit 1",[GARAGE,WALK])
    expect(walk.party_kind).toBe('walk_in');expect(walk.origin).toBe('walk_in');expect(walk.relationship_status).toBe('prospect');expect(walk.registered_user_id).toBeNull();expect(walk.external_identity_id).toBeNull()
    const fake=await one(c,"select count(*)::int count from public.users where name=$1",[WALK]);expect(Number(fake.count)).toBe(0)
    a=await audit(c,'GARAGE_CUSTOMER_RELATIONSHIP_CREATED');expect(a.new_value.relationship_id).toBe(walk.id)

    await row.getByTestId('customer-name').click();await expect(page.getByRole('heading',{name:WALK})).toBeVisible();await expect(page.getByText(/Garage prospect; CarUp identity not verified/)).toBeVisible();await expect(page.getByText('No related vehicles recorded.')).toBeVisible();await expect(page.getByText('No service history recorded for this prospect.')).toBeVisible();await expect(page.getByText('Recorded service costs: No cost recorded')).toBeVisible();await expect(page.getByLabel('Relationship status').locator('option[value="active"]')).toHaveAttribute('disabled')
    await page.screenshot({path:path.join(OUT,'desktop-walk-in-detail.png'),fullPage:true})
    await page.getByLabel('Garage tags (comma separated)').fill('uat-ops02');await page.getByLabel('Private Garage notes').fill(WALK_NOTE);await save(page);a=await audit(c,'GARAGE_CUSTOMER_RELATIONSHIP_UPDATED');expect(a.new_value.notes_changed).toBe(true);expect(JSON.stringify([a.previous_value,a.new_value])).not.toContain(WALK_NOTE)
    await page.getByLabel('Garage tags (comma separated)').fill('');await page.getByLabel('Private Garage notes').fill('');await save(page)
    await page.getByLabel('Relationship status').selectOption('inactive');await save(page);a=await audit(c,'GARAGE_CUSTOMER_STATUS_CHANGED');expect(a.new_value.relationship_status).toBe('inactive')

    await page.setViewportSize({width:390,height:844});await page.goto('/garage/customers',{waitUntil:'networkidle'});await expect(page.getByTestId('organisation-badge')).toHaveAttribute('aria-label',/SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/);await expect(page.getByLabel('Search by name or reference')).toBeVisible();await expect(page.getByLabel('Relationship status')).toBeVisible();await expect(page.getByTestId('customer-row').filter({hasText:OWNER_NAME})).toBeVisible();await page.screenshot({path:path.join(OUT,'mobile-customers.png'),fullPage:true})
    await page.goto('/garage/customers/'+encodeURIComponent('registered:'+OWNER),{waitUntil:'networkidle'});await expect(page.getByRole('heading',{name:OWNER_NAME})).toBeVisible();await expect(page.getByLabel('Customer category')).toBeVisible();await expect(page.getByLabel('Follow-up date')).toBeVisible();await expect(page.getByRole('button',{name:'Save relationship'})).toBeVisible();await expect(page.getByTestId('organisation-badge')).toHaveAttribute('aria-label',/SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/);await page.screenshot({path:path.join(OUT,'mobile-customer-detail.png'),fullPage:true})

    const veh1=await one(c,"select vin,owner_id,status,publication_status,trust_score from public.vehicles where vin=$1",[VIN]);expect(veh1).toEqual(veh0)
    const case1=await one(c,"select id::text,garage_tenant_id::text,requester_user_id,vin,status,branch_id::text,requested_at,service_category,conversation_thread_id from public.service_cases where id=$1::uuid",[CASE]);expect(case1).toEqual(case0)
    const wo1=await one(c,"select id::text,service_case_id::text,tenant_id::text,vin,status,created_at from public.mechanic_work_orders where id=$1::uuid",[WO]);expect(wo1).toEqual(wo0)

    const fs0=await one(c,"select jsonb_build_object('registered_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and party_kind='registered'),'external_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and party_kind='external'),'walk_in_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and party_kind='walk_in'),'active_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and relationship_status='active'),'inactive_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and relationship_status='inactive'),'prospect_relationships',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and relationship_status='prospect'),'pending_followups',(select count(*) from public.garage_customer_relationships where tenant_id=$1::uuid and follow_up_status='pending'),'active_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=true),'primary_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_primary=true),'mechanics',(select count(*) from public.tenant_users where tenant_id=$1::uuid and role='mechanic'),'active_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active'),'pending_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending'),'inactive_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive'),'live_primary',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary=true),'active_departments',(select count(*) from public.garage_departments where tenant_id=$1::uuid and is_active=true),'owner_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2)) state",[GARAGE,OWNER])
    expect(Number(fs0.state.active_sites)).toBe(3);expect(Number(fs0.state.primary_sites)).toBe(1);expect(Number(fs0.state.mechanics)).toBe(10);expect(Number(fs0.state.active_workforce)).toBe(10);expect(Number(fs0.state.pending_workforce)).toBe(0);expect(Number(fs0.state.inactive_workforce)).toBe(0);expect(Number(fs0.state.live_primary)).toBe(10);expect(Number(fs0.state.active_departments)).toBe(4);expect(Number(fs0.state.owner_workforce)).toBe(0);expect(Number(fs0.state.external_relationships)).toBe(0);expect(Number(fs0.state.pending_followups)).toBe(0)

    const ar=await c.query("select id::text,event_type,actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,created_at,previous_value is not null before_present,new_value is not null after_present,previous_value,new_value from public.trust_audit_events where actor_tenant_id=$1 and actor_user_id=$2 and created_at >= $3::timestamptz and event_type like 'GARAGE_CUSTOMER_%' order by created_at,id",[GARAGE,OWNER,STARTED.toISOString()])
    const types=new Set(ar.rows.map(r=>r.event_type));for(const t of ['GARAGE_CUSTOMER_RELATIONSHIP_CREATED','GARAGE_CUSTOMER_RELATIONSHIP_UPDATED','GARAGE_CUSTOMER_SITE_CHANGED','GARAGE_CUSTOMER_STAFF_CHANGED','GARAGE_CUSTOMER_FOLLOW_UP_CHANGED','GARAGE_CUSTOMER_STATUS_CHANGED'])expect(types.has(t),'missing '+t).toBe(true)
    expect(JSON.stringify(ar.rows)).not.toContain(NOTE);expect(JSON.stringify(ar.rows)).not.toContain(WALK_NOTE)
    const safe=ar.rows.map(r=>({id:r.id,event_type:r.event_type,actor_user_id:r.actor_user_id,actor_role:r.actor_role,actor_tenant_id:r.actor_tenant_id,actor_type:r.actor_type,source_route:r.source_route,created_at:r.created_at,relationship_id:r.new_value?.relationship_id||r.previous_value?.relationship_id||null,before_present:r.before_present,after_present:r.after_present,notes_changed:r.new_value?.notes_changed===true}))
    evidence.registered_reference=ref;evidence.walk_in={id:walk.id,reference:walk.customer_reference_code,label:WALK,final_status:'inactive',fake_user_count:Number(fake.count)};evidence.final_state=fs0.state;evidence.canonical_vehicle_ownership_unchanged=true;evidence.service_case_unchanged=true;evidence.work_order_unchanged=true;evidence.active_organisation_persisted_mobile=true;evidence.mechanic_redaction={source_certified:true,physical_owner_run_only:true,mechanic_credentials_provisioned:false};evidence.cross_garage={source_certified:true,second_garage_customer_not_fabricated:true}
    json('garage-ops02-browser-summary.json',evidence);json('garage-ops02-audit-events.json',safe);json('garage-ops02-final-state.json',{...fs0.state,registered_reference:ref,walk_in_reference:walk.customer_reference_code,walk_in_label:WALK})
  }finally{await c.end().catch(()=>{})}
})
