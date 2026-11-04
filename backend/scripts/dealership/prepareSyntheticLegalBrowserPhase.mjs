/**
 * CARUP-DEALER-ONB-001 LR01-R2 — CI-only synthetic legal policy simulation.
 * This file is NEVER run by the CarUp server, migrations, production, staging,
 * or a shared database. It provides fictional officer credentials and a
 * deliberately named fictional country policy in an ephemeral localhost DB
 * ONLY AFTER browser-proven evidence/claim/XLSX/compliance submission.
 *
 * A physically demonstrated CI policy decision must NEVER be represented as
 * Zimbabwean legal/regulator policy authorization or a real dealer approval.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import {hashPassword} from '../../utils/passwordAuth.js';
import {assertLocalDatabase} from './importResearchSeed.mjs';

const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const parsed=new URL(url);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));
assert.equal(parsed.pathname,'/carup_dealer_isolated_ci');
assert.equal(parsed.search,'');
assert.equal(parsed.hash,'');
assert.ok((process.env.DEALER_BROWSER_LOCAL_JWT_SECRET||'')
 .startsWith('EXPLICITLY_FAKE_EPHEMERAL_CARUP_DEALER_BROWSER_CI_KEY_'));
for(const key of ['DEALER_SEED_DATABASE_URL','CARUP_DEALER_RESEARCH_XLSX',
 'SUPABASE_URL']){
 assert.equal(process.env[key],undefined,'refuse shared or Owner input: '+key);
}
assert.ok(process.env.DEALER_BROWSER_FIXTURE_JSON);
const p=process.env.DEALER_BROWSER_FIXTURE_JSON;
const fixture=JSON.parse(readFileSync(p,'utf8'));
assert.equal(fixture.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(fixture.source_population,104);

const policyVersion='CARUP_SYNTHETIC_CI_ZW_POLICY_NOT_LEGAL_AUTHORITY_2026_11_04';
const legalPassword='FICTIONAL_CI_LEGAL_REVIEW_PASSWORD_NOT_REAL_2026_11_04';
const activatorPassword='FICTIONAL_CI_ACTIVATION_PASSWORD_NOT_REAL_2026_11_04';
const db=new pg.Client({connectionString:url,ssl:false,
 application_name:'carup-synthetic-policy-and-officers-ephemeral'});
await db.connect();
try{
 const observed=await db.query(`SELECT
 (SELECT count(*)::int FROM dealer_research_seed_records) AS seeds,
 (SELECT count(*)::int FROM dealer_research_public_profiles) AS public_profiles,
 (SELECT count(*)::int FROM dealer_claim_compliance_submissions) AS submissions,
 (SELECT count(*)::int FROM dealer_legal_application_reviews) AS legal_approvals,
 (SELECT count(*)::int FROM dealer_approved_seed_links) AS activated`);
 assert.deepEqual(observed.rows[0],{
  seeds:104,public_profiles:1,submissions:1,legal_approvals:0,activated:0,
 },'synthetic country policy must follow the actual applicant browser flow');
 const existing=await db.query(`SELECT count(*)::int AS n FROM dealer_country_legal_policy_authority
 WHERE policy_state='APPROVED'`);
 assert.equal(existing.rows[0].n,0,
  'no country policy may be preapproved by an untrusted shared source');
 const officers=[
  {id:'legalreviewer',name:'Fictional Separate Legal Reviewer',
    password:legalPassword,email:'fictional-legal@example.invalid'},
  {id:'activationreviewer',name:'Fictional Independent Activator',
    password:activatorPassword,email:'fictional-activation@example.invalid'},
 ];
 for(const officer of officers){
  const password_hash=await hashPassword(officer.password);
  const changed=await db.query(`UPDATE users
    SET name=$2,email=$3,password_hash=$4
    WHERE id=$1 AND role='admin' AND is_verified=true`,
    [officer.id,officer.name,officer.email,password_hash]);
  assert.equal(changed.rowCount,1,'preseeded independent officer missing: '+officer.id);
  const token='fictional-legal-phase-session-'+randomUUID();
  await db.query(`INSERT INTO user_sessions(token,user_id,is_valid,expires_at)
  VALUES($1,$2,true,now()+interval '2 hours')`,[token,officer.id]);
  const label=officer.id==='legalreviewer'?'legalReviewer':'activator';
  fixture.actors[label]={id:officer.id,name:officer.name,email:officer.email,
    role:'admin',token};
 }
 const authority=await db.query(`SELECT id,is_verified,role FROM users WHERE id='policyreviewer'`);
 assert.deepEqual(authority.rows,[{id:'policyreviewer',is_verified:true,role:'admin'}]);
 const digest=createHash('sha256').update(
  'EXPLICITLY FICTIONAL CI COUNTRY POLICY. NO REGULATORY SIGNOFF.').digest('hex');
 const policy=await db.query(`INSERT INTO dealer_country_legal_policy_authority(
   country_code,policy_version,policy_state,approval_evidence_sha256,
   effective_at,expires_at,approved_by)
   VALUES('ZW',$1,'APPROVED',$2,now()-interval '1 day',
     now()+interval '30 days','policyreviewer')
   RETURNING policy_version,policy_state,approved_by`,[policyVersion,digest]);
 assert.deepEqual(policy.rows[0],{policy_version:policyVersion,
  policy_state:'APPROVED',approved_by:'policyreviewer'});
 fixture.synthetic_legal_policy_version=policyVersion;
 fixture.synthetic_legal_policy_provenance='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY';
 fixture.legal_reviewer_password=legalPassword;
 fixture.activator_password=activatorPassword;
 writeFileSync(p,JSON.stringify(fixture),{mode:0o600});
 console.log('DEALER_SYNTHETIC_POLICY_ONLY PASS: two independently signed-in fictional officers and isolated fictional policy; NO real legal/regulatory authority, production activation or payment');
}finally{await db.end()}
