/**
 * D9/D10 ephemeral REAL-APP browser exercise: makes strictly fictional people,
 * real database user_sessions and exactly ONE reviewer-published fictional
 * public research profile from the 104 synthetic XLSX import.
 *
 * NEVER use against a shared database, original Owner workbook or production.
 * This records a SYNTHETIC reviewer decision, not an independent certification
 * or authorization to publish an actual third-party business.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHmac,scryptSync,randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';
import {assertLocalDatabase} from './importResearchSeed.mjs';

const dbUrl=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const parsed=new URL(dbUrl);
if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||
 parsed.pathname!=='/carup_dealer_isolated_ci'||parsed.search||parsed.hash)
 throw new Error('SYNTHETIC_BROWSER_DATABASE_HOST_REFUSED');
for(const key of ['CARUP_DEALER_RESEARCH_XLSX','DEALER_SEED_DATABASE_URL',
 'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){
 if(process.env[key])throw new Error('UNSAFE_BROWSER_ENVIRONMENT_'+key);
}
const runnerTemp=process.env.RUNNER_TEMP;
if(!runnerTemp)throw new Error('MISSING_ISOLATED_RUNNER_TEMP');
const jwtSecret=process.env.DEALER_BROWSER_LOCAL_JWT_SECRET;
if(typeof jwtSecret!=='string'||jwtSecret.length<32)
 throw new Error('MISSING_DISPOSABLE_JWT_SECRET');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt=(header,payload,key)=>{
 const body=encode(header)+'.'+encode(payload);
 const signature=createHmac('sha256',key).update(body).digest('base64url');
 return body+'.'+signature;
};
const serviceKey=jwt({alg:'HS256',typ:'JWT'},{
 role:'service_role',iss:'carup-dealer-ephemeral-ci',aud:'authenticated',
 exp:Math.floor(Date.now()/1000)+3600
},jwtSecret);
const anonKey=jwt({alg:'HS256',typ:'JWT'},{
 role:'anon',iss:'carup-dealer-ephemeral-ci',aud:'authenticated',
 exp:Math.floor(Date.now()/1000)+3600
},jwtSecret);
const reviewerPassword='EXPLICITLY_FAKE_DEALER_CI_REVIEWER_STEPUP_NO_PRODUCTION_USE_2026';
const db=new pg.Client({connectionString:dbUrl,ssl:false,
 application_name:'carup-dealer-authenticated-browser-ephemeral'});
await db.connect();
try{
 const original=(await db.query(`SELECT
  (SELECT count(*)::int FROM dealer_research_seed_records) AS sources,
  (SELECT count(*)::int FROM dealer_research_public_profiles) AS public,
  (SELECT count(*)::int FROM dealer_research_claim_requests) AS claims`)).rows[0];
 assert.deepEqual(original,{sources:104,public:0,claims:0},
  'browser starts from 104 private synthetic records and zero public/claim authority');
 await db.query(`ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT`);
 // Use the existing real CarUp migrations, not a reduced local substitute.
 // The old session stub omitted active_role and active_organization_id and
 // the feature overrides table was absent, creating real 42703/42P01 errors.
 for(const migration of [
  '../../../database/migrations/20260617120000_user_sessions_auth_contract_align.sql',
  '../../../database/migrations/20260621120000_feature_rollout_overrides.sql',
 ]){
  await db.query(readFileSync(new URL(migration,import.meta.url),'utf8'));
 }
 const sessionCols=await db.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_sessions'`);
 const actualFields=new Set(sessionCols.rows.map(r=>r.column_name));
 for(const name of ['id','token','user_id','is_valid','active_role',
  'active_organization_id','created_at','expires_at'])
  assert.equal(actualFields.has(name),true,'MISSING_CANONICAL_SESSION_COLUMN_'+name);
 const featureAccess=await db.query(`SELECT
  to_regclass('public.feature_rollout_overrides') IS NOT NULL AS installed,
  has_table_privilege('anon','feature_rollout_overrides','SELECT') AS anon_read,
  has_table_privilege('authenticated','feature_rollout_overrides','SELECT') AS member_read,
  has_table_privilege('service_role','feature_rollout_overrides','SELECT') AS server_read`);
 assert.deepEqual(featureAccess.rows[0],{
  installed:true,anon_read:false,member_read:false,server_read:true,
 },'existing feature migration must keep client feature-governance access denied');
 console.log('DEALER_NATIVE_CANONICAL_BASELINE PASS: actual session/feature migrations, server-only governance');
 // The isolated SQL migration harness creates service_role without Supabase's
 // production-equivalent BYPASSRLS attribute. Without it PostgREST legitimately
 // returns HTTP 200 with [] for private-policy tables despite its service JWT.
 // This is ONLY a disposable localhost database (guarded above), never shared.
 await db.query('ALTER ROLE service_role BYPASSRLS');
 const roleProof=await db.query(`SELECT rolname,rolbypassrls FROM pg_roles
  WHERE rolname IN('service_role','anon','authenticated') ORDER BY rolname`);
 assert.equal(roleProof.rows.find(row=>row.rolname==='service_role')?.rolbypassrls,true);
 assert.ok(roleProof.rows.filter(row=>row.rolname!=='service_role')
   .every(row=>row.rolbypassrls===false));
 await db.query(`GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role`);
 await db.query(`GRANT SELECT ON users,user_sessions TO service_role`);
 // The canonical production Supabase service_role can read tenant authority;
 // our manually created CI service_role must have equivalent explicit SQL
 // grants. BYPASSRLS alone does not grant table privileges. Never grant these
 // privileges to anon or authenticated in this disposable integration runtime.
 await db.query(`GRANT SELECT ON tenants,organizations,organization_users,
   organization_roles,dealer_profiles,dealer_branches,tenant_users TO service_role`);
 await db.query(`GRANT INSERT,UPDATE ON dealer_branches TO service_role`);
 // C23 live buyer-case candidate reads canonical escrow transactions through
 // the genuine service_role, not a fabricated frontend transaction array.
 // This is only the isolated disposable SQL harness; Supabase's production
 // service_role grants are not modified or broadened to anon/authenticated.
 await db.query(`GRANT SELECT ON escrow_trust_sessions,
   dealer_transaction_feedback_cases,dealer_transaction_feedback_review_events
   TO service_role`);
 await db.query(`UPDATE users SET
  name=CASE WHEN id='claimant1' THEN 'Fictional Claimant One'
       WHEN id='reviewer1' THEN 'Fictional Independent Reviewer'
       ELSE name END,
  email=CASE WHEN id='claimant1' THEN 'claimant1@example.invalid'
        WHEN id='reviewer1' THEN 'reviewer1@example.invalid'
        ELSE email END,
  role=CASE WHEN id='reviewer1' THEN 'reviewer' ELSE role END,
  -- Only the explicitly fictional claimant has completed the simulated
  -- human identity check for browser UAT. The fresh schema mode starts
  -- claimant1 unverified; the prior contract suite had verified it as a
  -- side effect, masking the fixture's missing initial state.
  -- This DOES NOT verify a dealership, grant a tenant role or approve legal
  -- compliance. No real-user record can enter this isolated fixture.
  is_verified=CASE WHEN id='claimant1' THEN true ELSE is_verified END
  WHERE id IN ('claimant1','reviewer1')`);
 // The first migration harness seeds reviewer1 as admin for SQL exercising.
 // In the physical browser fixture it MUST be a genuinely distinct,
 // independently verified "reviewer", not an admin masquerading in UI.
 // Claimant identity verification is independent of legal company approval:
 // is_verified=true must NEVER grant dealer/tenant membership.
 const actorRoleProof=await db.query(`SELECT id,role,is_verified FROM users
   WHERE id IN('claimant1','reviewer1') ORDER BY id`);
 assert.deepEqual(actorRoleProof.rows,[
   {id:'claimant1',role:'member',is_verified:true},
   {id:'reviewer1',role:'reviewer',is_verified:true},
 ]);
 // Password challenge uses the genuine production scrypt verification logic.
 // These bytes belong to an explicitly fictional account in this disposable DB.
 const salt=randomBytes(16).toString('hex');
 const reviewerHash='scrypt:'+salt+':'+
   scryptSync(reviewerPassword,salt,64).toString('hex');
 await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',
   [reviewerHash,'reviewer1']);
 const actors={
  claimant:{id:'claimant1',name:'Fictional Claimant One',
   email:'claimant1@example.invalid',role:'member',
   token:'synthetic-claimant-session-'+randomUUID()},
  reviewer:{id:'reviewer1',name:'Fictional Independent Reviewer',
   email:'reviewer1@example.invalid',role:'reviewer',
   token:'synthetic-reviewer-session-'+randomUUID()},
 };
 for(const actor of Object.values(actors)){
  await db.query(`INSERT INTO user_sessions(token,user_id,active_role,is_valid,expires_at)
    VALUES($1,$2,$3,true,(now()+interval '2 hours')::text)`,
    [actor.token,actor.id,actor.role]);
 }
 // A fictional, already verified platform reviewer independently authorizes a
 // *single fabricated source* for a minimal public unclaimed profile. Never bulk
 // publish all 104 research rows, never silently certify an actual dealership.
 const review=await db.query(`SELECT dealer_record_research_publication_review(
  $1,$2,$3,$4) AS event`,[
  'ZW-DEAL-0001','reviewer1','PRELISTED_UNCLAIMED',
  'Synthetic CI-only publication decision for a fabricated company; research publication is not business ownership or compliance verification.'
 ]);
 assert.equal(review.rows[0].event.public,true);
 const released=await db.query(`SELECT seed_dealer_id,public_slug,
  public_name,publication_status FROM dealer_research_public_profiles`);
 assert.equal(released.rowCount,1);
 assert.equal(released.rows[0].public_slug,'zw-deal-0001');
 assert.equal(released.rows[0].publication_status,'PRELISTED_UNCLAIMED');
 assert.match(released.rows[0].public_name,/^SYNTHETIC FICTIONAL CAR DEALER/);
 const fixturePath=join(runnerTemp,'carup-dealer-browser-fixture.json');
 writeFileSync(fixturePath,JSON.stringify({actors,seed:'ZW-DEAL-0001',
  public_slug:'zw-deal-0001',source_population:104,
  reviewer_password:reviewerPassword,
  source_type:'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'}),{mode:0o600});
 const envPath=join(runnerTemp,'carup-dealer-browser.env');
 writeFileSync(envPath,'SUPABASE_SERVICE_ROLE_KEY='+serviceKey+'\n'
  +'SUPABASE_ANON_KEY='+anonKey+'\n',{mode:0o600});
 console.log('DEALER_BROWSER_SYNTHETIC_FIXTURE PASS: 104 fictional sources, one reviewed unclaimed profile, two distinct real authenticated DB sessions, no legal dealer/tenant grants');
 console.log('DEALER_BROWSER_SOURCE_NOTE: FICTIONAL_ONLY; ORIGINAL_OWNER_XLSX_NOT_USED; LEGAL_PUBLICATION_IS_SIMULATED');
}finally{await db.end()}
