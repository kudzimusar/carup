// CA-K3-AUTH-05 — executable service_role impersonation closure proof.
//
// Runs only against a disposable PostgreSQL service/embedded instance. It first installs the frozen
// Phase A/B/C authority stack and proves the PRE-AUTH-05 compromise: ordinary service_role directly
// manufactures a live A1 governor session and successfully executes a governed Corporate CREATE.
// It then applies AUTH-05 and proves I1–I6 plus the exact privilege split.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DATA_DIR = fileURLToPath(new URL('./.pgdata-ca-k3-auth-05', import.meta.url));
const PORT = 54465;
const DB_URL = process.env.CA_AUTH05_DATABASE_URL || '';
const PHASE_A = fileURLToPath(new URL('../../../database/migrations/20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql', import.meta.url));
const PHASE_B = fileURLToPath(new URL('../../../database/migrations/20261014020000_ca_k3_auth_03_corporate_membership_governance.sql', import.meta.url));
const PHASE_C = fileURLToPath(new URL('../../../database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql', import.meta.url));
const AUTH05 = fileURLToPath(new URL('../../../database/migrations/20261016010000_ca_k3_auth_05_session_identity_authority.sql', import.meta.url));

const ROOT='CARUP_CORPORATE';
const NODE='BU_MARKETPLACE';
const MANAGE='corporate.people.membership.manage';
const results=[];

const rec=(name,ok,detail='')=>{
  results.push({name,ok});
  console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?' — '+detail:''}`);
};
const errText=(e)=>String(e?.message??e);
const upBlock=(path)=>{
  const raw=readFileSync(path,'utf8');
  const i=raw.indexOf('-- +migrate Down');
  return (i>=0?raw.slice(0,i):raw).replace('-- +migrate Up','');
};
const sha256=(s)=>createHash('sha256').update(s).digest('hex');

let epg=null;
const clients=[];
async function connect({role=null,url=DB_URL,user='postgres',password='postgres'}={}){
  const cfg=url?{connectionString:url}:{host:'127.0.0.1',port:PORT,user,password,database:'postgres'};
  const c=new pg.Client(cfg);
  await c.connect();
  if(role) await c.query(`SET ROLE ${role}`);
  clients.push(c);
  return c;
}
async function ensureUsers(owner,ids){
  for(const id of ids) await owner.query(
    `INSERT INTO users(id,email,role) VALUES ($1,$2,'owner') ON CONFLICT (id) DO NOTHING`,
    [id,`${id}@x.invalid`]);
}
async function seedMembership(owner,userId,node=ROOT){
  await ensureUsers(owner,[userId]);
  const {rows}=await owner.query(
    `INSERT INTO corporate_memberships
      (user_id,org_node_id,state,effective_from,effective_until,created_by_kind,created_reason,created_reference,
       updated_by_kind,updated_reason,updated_reference)
     VALUES ($1,$2,'ACTIVE',clock_timestamp()-interval '1 minute',NULL,'SYSTEM','auth05 fixture','AUTH05',
             'SYSTEM','auth05 fixture','AUTH05')
     RETURNING membership_id`,[userId,node]);
  return rows[0].membership_id;
}
async function moveAssignment(owner,id,to,by){
  await owner.query(
    `UPDATE corporate_permission_assignments
        SET state=$2,updated_by_kind='USER',updated_by_user_id=$3,
            updated_reason='auth05 lifecycle',updated_reference='AUTH05'
      WHERE assignment_id=$1`,[id,to,by]);
}
async function seedGovernor(owner,userId){
  await ensureUsers(owner,[userId,'f-requester','f-approver','f-activator','f-suspender']);
  const membershipId=await seedMembership(owner,userId,ROOT);
  const {rows}=await owner.query(
    `INSERT INTO corporate_permission_assignments
      (subject_user_id,membership_id,capability,scope_node_ids,include_descendants,effective_from,effective_until,
       assurance_floor,requested_by_user_id,request_reason,request_reference,state,updated_by_kind,updated_by_user_id,
       updated_reason,updated_reference)
     VALUES ($1,$2,$3,ARRAY[$4]::text[],true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '8 hours',
       'A1_RECENT_REAUTH','f-requester','auth05 request','AUTH05','REQUESTED','USER','f-requester','auth05 request','AUTH05')
     RETURNING assignment_id`,[userId,membershipId,MANAGE,ROOT]);
  const assignmentId=rows[0].assignment_id;
  await moveAssignment(owner,assignmentId,'APPROVED','f-approver');
  await moveAssignment(owner,assignmentId,'ACTIVE','f-activator');
  return {userId,membershipId,assignmentId};
}
async function direct(client,{actor,session,subject}){
  const {rows}=await client.query(
    `SELECT public.corporate_authority_apply_direct(
      'CREATE',$1::text,$2::text,$3::text,$4::text,NULL::uuid,
      'auth05 proof','AUTH05-PROOF',NULL::timestamptz,NULL::timestamptz,'ROUTINE',NULL::jsonb) AS r`,
    [actor,session,subject,NODE]);
  return rows[0].r;
}
async function denied(label,fn,pattern=/permission denied|not permitted|has no privilege/i){
  try{await fn();rec(label,false,'unexpectedly allowed');return false;}
  catch(e){const ok=pattern.test(errText(e));rec(label,ok,errText(e).split('\n')[0]);return ok;}
}
async function tablePriv(admin,role,priv){
  return (await admin.query('SELECT has_table_privilege($1,$2,$3) ok',[role,'public.user_sessions',priv])).rows[0].ok;
}
async function fnPriv(admin,role,sig){
  return (await admin.query('SELECT has_function_privilege($1,$2,$3) ok',[role,sig,'EXECUTE'])).rows[0].ok;
}

async function main(){
  if(!DB_URL){
    const {default:EmbeddedPostgres}=await import('embedded-postgres');
    epg=new EmbeddedPostgres({databaseDir:DATA_DIR,user:'postgres',password:'postgres',port:PORT,persistent:false});
    await epg.initialise(); await epg.start(); await epg.createDatabase('postgres').catch(()=>{});
  }

  const admin=await connect();
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`
    CREATE ROLE mig_owner NOSUPERUSER BYPASSRLS CREATEROLE;
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    ALTER SCHEMA public OWNER TO mig_owner;
    GRANT USAGE ON SCHEMA public TO mig_owner,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON TABLES TO mig_owner,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO mig_owner,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO mig_owner,anon,authenticated,service_role;
  `);
  await admin.query('SET ROLE mig_owner');
  await admin.query(`
    CREATE TABLE users(id text PRIMARY KEY,email text UNIQUE,role text NOT NULL,password_hash text);
    CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,type text);
    CREATE TABLE tenant_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),user_id text NOT NULL REFERENCES users(id),role text NOT NULL);
    CREATE TABLE user_sessions(
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      active_role text,
      active_organization_id text,
      token text UNIQUE,
      is_valid boolean DEFAULT true,
      ip_address text,
      user_agent text,
      created_at text NOT NULL DEFAULT now()::text,
      expires_at text NOT NULL,
      auth_method text,
      step_up_at text,
      step_up_method text
    );
    CREATE TABLE auth_action_tokens(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      requested_ip text,
      user_agent text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text,
      source text NOT NULL DEFAULT 'api'
    );
    CREATE TABLE organizations(id text PRIMARY KEY,name text);
    CREATE TABLE organization_users(organization_id text REFERENCES organizations(id),user_id text REFERENCES users(id),role text);
    INSERT INTO users VALUES
      ('u-admin','admin@x.invalid','admin'),
      ('f-requester','f-requester@x.invalid','owner'),
      ('f-approver','f-approver@x.invalid','owner'),
      ('f-activator','f-activator@x.invalid','owner'),
      ('f-suspender','f-suspender@x.invalid','owner');
  `);
  await admin.query(upBlock(PHASE_A));
  await admin.query(upBlock(PHASE_B));
  await admin.query(upBlock(PHASE_C));
  await admin.query('RESET ROLE');

  const version=(await admin.query('SHOW server_version')).rows[0].server_version;
  rec('disposable real PostgreSQL booted',Boolean(version),`server_version=${version}`);

  const owner=await connect({role:'mig_owner'});
  const service=await connect({role:'service_role'});
  const governor=await seedGovernor(owner,'governor-auth05');
  await owner.query(`UPDATE users SET password_hash='scrypt:aaaa:bbbb' WHERE id=$1`,[governor.userId]);

  // PRE-REMEDIATION THREAT REPRODUCTION.
  const craftedId='svc-crafted-a1';
  const craftedToken='svc-crafted-token';
  await service.query(
    `INSERT INTO user_sessions
      (id,user_id,active_role,token,is_valid,created_at,expires_at,auth_method,step_up_at,step_up_method)
     VALUES ($1,$2,'owner',$3,true,clock_timestamp()::text,(clock_timestamp()+interval '8 hours')::text,
             'password',clock_timestamp()::text,'password_reauth')`,
    [craftedId,governor.userId,craftedToken]);
  const crafted=(await admin.query('SELECT user_id,is_valid,expires_at,step_up_at,step_up_method FROM user_sessions WHERE id=$1',[craftedId])).rows[0];
  rec('PRE: ordinary service_role creates another user session',crafted?.user_id===governor.userId);
  rec('PRE: ordinary service_role marks it valid with future expiry',crafted?.is_valid===true && Date.parse(crafted.expires_at)>Date.now());
  rec('PRE: ordinary service_role fabricates password-re-auth A1',crafted?.step_up_method==='password_reauth' && Boolean(crafted.step_up_at));

  await service.query(`UPDATE users SET password_hash='scrypt:deadbeef:cafebabe' WHERE id=$1`,[governor.userId]);
  const prePassword=(await admin.query('SELECT password_hash FROM users WHERE id=$1',[governor.userId])).rows[0]?.password_hash;
  rec('PRE: ordinary service_role can replace governor password credential',prePassword==='scrypt:deadbeef:cafebabe');

  const forgedResetHash='a'.repeat(64);
  await service.query(
    `INSERT INTO auth_action_tokens(user_id,purpose,token_hash,expires_at,source)
      VALUES ($1,'password_reset',$2,clock_timestamp()+interval '1 hour','service-role-forgery')`,
    [governor.userId,forgedResetHash]);
  const forgedReset=(await admin.query('SELECT id FROM auth_action_tokens WHERE token_hash=$1',[forgedResetHash])).rowCount;
  rec('PRE: ordinary service_role can fabricate password-reset proof state',forgedReset===1);

  await ensureUsers(owner,['pre-impersonated-target']);
  const preResult=await direct(service,{actor:governor.userId,session:craftedId,subject:'pre-impersonated-target'});
  rec('PRE: manufactured A1 session executes governed Corporate operation',
    preResult?.outcome==='EXECUTED' && preResult?.subject_user_id==='pre-impersonated-target',
    JSON.stringify({outcome:preResult?.outcome,subject:preResult?.subject_user_id}));

  const before={
    select:await tablePriv(admin,'service_role','SELECT'),
    insert:await tablePriv(admin,'service_role','INSERT'),
    update:await tablePriv(admin,'service_role','UPDATE'),
    delete:await tablePriv(admin,'service_role','DELETE'),
    users_update_password: (await admin.query("SELECT has_column_privilege('service_role','public.users','password_hash','UPDATE') ok")).rows[0].ok,
    users_update_email: (await admin.query("SELECT has_column_privilege('service_role','public.users','email','UPDATE') ok")).rows[0].ok,
    users_delete: (await admin.query("SELECT has_table_privilege('service_role','public.users','DELETE') ok")).rows[0].ok,
    auth_token_insert: (await admin.query("SELECT has_table_privilege('service_role','public.auth_action_tokens','INSERT') ok")).rows[0].ok,
    auth_token_update: (await admin.query("SELECT has_table_privilege('service_role','public.auth_action_tokens','UPDATE') ok")).rows[0].ok,
    phase_c_write:await fnPriv(admin,'service_role','public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)'),
  };
  console.log('PRIVILEGE_BEFORE '+JSON.stringify(before));

  // APPLY AUTH-05 in the same disposable database.
  await owner.query(upBlock(AUTH05));
  await admin.query(`
    CREATE ROLE session_runtime LOGIN PASSWORD 'auth05-test-only';
    GRANT carup_session_authority TO session_runtime;
  `);

  const after={
    service_role:{
      select:await tablePriv(admin,'service_role','SELECT'),
      insert:await tablePriv(admin,'service_role','INSERT'),
      update:await tablePriv(admin,'service_role','UPDATE'),
      delete:await tablePriv(admin,'service_role','DELETE'),
      resolve:await fnPriv(admin,'service_role','public.session_authority_resolve_token(text)'),
      issue:await fnPriv(admin,'service_role','public.session_authority_issue(text,text,text,text,text,text)'),
      phase_c_write:await fnPriv(admin,'service_role','public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)'),
      users_update_password:(await admin.query("SELECT has_column_privilege('service_role','public.users','password_hash','UPDATE') ok")).rows[0].ok,
      users_update_email:(await admin.query("SELECT has_column_privilege('service_role','public.users','email','UPDATE') ok")).rows[0].ok,
      users_delete:(await admin.query("SELECT has_table_privilege('service_role','public.users','DELETE') ok")).rows[0].ok,
      auth_token_insert:(await admin.query("SELECT has_table_privilege('service_role','public.auth_action_tokens','INSERT') ok")).rows[0].ok,
      auth_token_update:(await admin.query("SELECT has_table_privilege('service_role','public.auth_action_tokens','UPDATE') ok")).rows[0].ok,
      auth_token_writer:await fnPriv(admin,'service_role','public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text)'),
      password_writer:await fnPriv(admin,'service_role','public.session_authority_set_password_hash(text,text)'),
    },
    session_runtime:{
      select:await tablePriv(admin,'session_runtime','SELECT'),
      insert:await tablePriv(admin,'session_runtime','INSERT'),
      update:await tablePriv(admin,'session_runtime','UPDATE'),
      delete:await tablePriv(admin,'session_runtime','DELETE'),
      issue:await fnPriv(admin,'session_runtime','public.session_authority_issue(text,text,text,text,text,text)'),
      reauth:await fnPriv(admin,'session_runtime','public.session_authority_record_password_reauth(text,text)'),
      revoke:await fnPriv(admin,'session_runtime','public.session_authority_revoke_scope(text,text,text,text)'),
      phase_c_write:await fnPriv(admin,'session_runtime','public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)'),
      auth_token_writer:await fnPriv(admin,'session_runtime','public.session_authority_auth_token_insert(text,text,text,timestamptz,text,text,jsonb,text,text)'),
      password_writer:await fnPriv(admin,'session_runtime','public.session_authority_set_password_hash(text,text)'),
    }
  };
  console.log('PRIVILEGE_AFTER '+JSON.stringify(after));
  rec('ACL: ordinary service_role has zero direct user_sessions privilege',
    !after.service_role.select&&!after.service_role.insert&&!after.service_role.update&&!after.service_role.delete);
  rec('ACL: ordinary service_role can resolve exact presented token but cannot issue',after.service_role.resolve&&!after.service_role.issue);
  rec('ACL: ordinary service_role cannot execute Phase-C write wrapper',!after.service_role.phase_c_write);
  rec('ACL: ordinary service_role cannot rewrite login identity or credential',
    !after.service_role.users_update_password&&!after.service_role.users_update_email&&!after.service_role.users_delete&&!after.service_role.password_writer);
  rec('ACL: ordinary service_role cannot fabricate/consume auth-action proof state',
    !after.service_role.auth_token_insert&&!after.service_role.auth_token_update&&!after.service_role.auth_token_writer);
  rec('ACL: dedicated session runtime has function authority but zero direct table DML',
    after.session_runtime.issue&&after.session_runtime.reauth&&after.session_runtime.revoke&&after.session_runtime.phase_c_write
      &&!after.session_runtime.select&&!after.session_runtime.insert&&!after.session_runtime.update&&!after.session_runtime.delete
      &&after.session_runtime.auth_token_writer&&after.session_runtime.password_writer);

  const postCrafted=(await admin.query('SELECT is_valid,step_up_at,step_up_method FROM user_sessions WHERE id=$1',[craftedId])).rows[0];
  rec('CUTOVER: all pre-boundary session/A1 state invalidated',
    postCrafted?.is_valid===false && postCrafted?.step_up_at===null && postCrafted?.step_up_method===null);

  // I1 — arbitrary session creation.
  await denied('I1 arbitrary session creation by ordinary service_role = DENIED',()=>service.query(
    `INSERT INTO user_sessions(id,user_id,token,is_valid,expires_at) VALUES ('i1','${governor.userId}','i1-token',true,(clock_timestamp()+interval '1 day')::text)`));
  await denied('I1 ordinary service_role cannot call dedicated session issuer',()=>service.query(
    `SELECT public.session_authority_issue($1,'owner',NULL,NULL,NULL,'password')`,[governor.userId]));

  // I2 — arbitrary expiry extension.
  await denied('I2 arbitrary session extension by ordinary service_role = DENIED',()=>service.query(
    `UPDATE user_sessions SET expires_at=(clock_timestamp()+interval '30 days')::text WHERE id=$1`,[craftedId]));

  // I3 — A1 fabrication.
  await denied('I3 A1 fabrication by ordinary service_role = DENIED',()=>service.query(
    `UPDATE user_sessions SET step_up_at=clock_timestamp()::text,step_up_method='password_reauth' WHERE id=$1`,[craftedId]));
  await denied('I3 ordinary service_role cannot call password-reauth writer',()=>service.query(
    `SELECT public.session_authority_record_password_reauth($1,$2)`,[craftedToken,governor.userId]));

  // I4 — revoked-session revival.
  await denied('I4 revoked-session revival by ordinary service_role = DENIED',()=>service.query(
    `UPDATE user_sessions SET is_valid=true WHERE id=$1`,[craftedId]));

  await denied('I4b governor password replacement by ordinary service_role = DENIED',()=>service.query(
    `UPDATE users SET password_hash='scrypt:ffff:eeee' WHERE id=$1`,[governor.userId]));
  await denied('I4c governor email replacement by ordinary service_role = DENIED',()=>service.query(
    `UPDATE users SET email='attacker@x.invalid' WHERE id=$1`,[governor.userId]));
  await denied('I4d auth reset-token fabrication by ordinary service_role = DENIED',()=>service.query(
    `INSERT INTO auth_action_tokens(user_id,purpose,token_hash,expires_at) VALUES ($1,'password_reset',$2,clock_timestamp()+interval '1 hour')`,
    [governor.userId,'b'.repeat(64)]));
  await denied('I4e ordinary service_role cannot call dedicated password writer',()=>service.query(
    `SELECT public.session_authority_set_password_hash($1,'scrypt:ffff:eeee')`,[governor.userId]));

  // I5 — Corporate impersonation with only ordinary service_role.
  await denied('I5 ordinary service_role cannot enumerate bearer-token table',()=>service.query(
    `SELECT token FROM user_sessions WHERE user_id=$1`,[governor.userId]));
  await ensureUsers(owner,['post-denied-target']);
  await denied('I5 Corporate impersonation through Phase-C write wrapper = DENIED',()=>direct(service,{
    actor:governor.userId,session:craftedId,subject:'post-denied-target'
  }));

  // I6 — legitimate dedicated authority lifecycle.
  const localUrl=DB_URL || `postgres://session_runtime:auth05-test-only@127.0.0.1:${PORT}/postgres`;
  let sessionUrl=localUrl;
  if(DB_URL){
    const u=new URL(DB_URL);
    u.username='session_runtime'; u.password='auth05-test-only';
    sessionUrl=u.toString();
  }
  const sessionRuntime=await connect({url:sessionUrl});
  const resetTokenHash='c'.repeat(64);
  const resetRecord=(await sessionRuntime.query(
    `SELECT public.session_authority_auth_token_insert(
      $1,'password_reset',$2,clock_timestamp()+interval '1 hour',NULL,NULL,'{}'::jsonb,NULL,'auth05-proof') data`,
    [governor.userId,resetTokenHash])).rows[0].data;
  rec('I6 legitimate dedicated recovery-token issuance = PASS',resetRecord?.user_id===governor.userId);

  const passwordWrite=(await sessionRuntime.query(
    `SELECT public.session_authority_set_password_hash($1,'scrypt:1234abcd:5678efab') data`,
    [governor.userId])).rows[0].data;
  const passwordAfter=(await admin.query('SELECT password_hash FROM users WHERE id=$1',[governor.userId])).rows[0]?.password_hash;
  rec('I6 legitimate dedicated password credential update = PASS',
    passwordWrite?.updated===true&&passwordAfter==='scrypt:1234abcd:5678efab');

  const issued=(await sessionRuntime.query(
    `SELECT public.session_authority_issue($1,'owner',NULL,'127.0.0.1','auth05-test','password') data`,
    [governor.userId])).rows[0].data;
  rec('I6 legitimate login/session creation = PASS',Boolean(issued?.id&&issued?.token));

  const resolved=(await service.query(
    `SELECT public.session_authority_resolve_token($1) data`,[issued.token])).rows[0].data;
  rec('I6 ordinary runtime exact-token resolution returns no bearer material',
    resolved?.id===issued.id && resolved?.user_id===governor.userId && !Object.prototype.hasOwnProperty.call(resolved,'token'));

  const stepped=(await sessionRuntime.query(
    `SELECT public.session_authority_record_password_reauth($1,$2) data`,[issued.token,governor.userId])).rows[0].data;
  rec('I6 legitimate password reauthentication/A1 update = PASS',stepped?.id===issued.id&&stepped?.method==='password_reauth');

  const active=(await sessionRuntime.query(
    `SELECT public.session_authority_set_active_organization($1,$2,'tenant-auth05') data`,[issued.token,governor.userId])).rows[0].data;
  const cleared=(await sessionRuntime.query(
    `SELECT public.session_authority_set_active_organization($1,$2,NULL) data`,[issued.token,governor.userId])).rows[0].data;
  rec('I6 active-tenant set/restore lifecycle = PASS',active?.active_organization_id==='tenant-auth05'&&cleared?.active_organization_id===null);

  const second=(await sessionRuntime.query(
    `SELECT public.session_authority_issue($1,'owner',NULL,NULL,NULL,'password') data`,[governor.userId])).rows[0].data;
  const revokedOthers=(await sessionRuntime.query(
    `SELECT public.session_authority_revoke_scope($1,'others',NULL,$2) data`,[governor.userId,issued.token])).rows[0].data;
  const states=(await admin.query('SELECT id,is_valid FROM user_sessions WHERE id=ANY($1::text[]) ORDER BY id',[[issued.id,second.id]])).rows;
  const stateMap=Object.fromEntries(states.map(r=>[r.id,r.is_valid]));
  rec('I6 revoke-other-sessions preserves current and revokes peer = PASS',
    revokedOthers?.revoked_count===1&&stateMap[issued.id]===true&&stateMap[second.id]===false);

  await ensureUsers(owner,['legitimate-corporate-target']);
  const corp=await direct(sessionRuntime,{actor:governor.userId,session:issued.id,subject:'legitimate-corporate-target'});
  rec('I6 dedicated session authority can execute legitimate Phase-C operation = PASS',
    corp?.outcome==='EXECUTED'&&corp?.subject_user_id==='legitimate-corporate-target');

  const currentRevoked=(await sessionRuntime.query(
    `SELECT public.session_authority_revoke_current($1,$2) data`,[issued.token,governor.userId])).rows[0].data;
  const finalRow=(await admin.query('SELECT is_valid FROM user_sessions WHERE id=$1',[issued.id])).rows[0];
  rec('I6 current-session logout/revocation = PASS',currentRevoked?.revoked_count===1&&finalRow?.is_valid===false);

  console.log('INSTALLATION_PROOF '+JSON.stringify({
    postgresql:version,
    phase_c_git_blob_expected:'747404734641952ca7f80ccaddb2ee2eafa0a677',
    auth05_sha256:sha256(readFileSync(AUTH05,'utf8')),
    disposable:true,
    staging:false,
    production:false,
  }));

  const passed=results.filter(r=>r.ok).length;
  console.log(`\n════ CA-K3-AUTH-05 REAL-POSTGRES PROOF: ${passed}/${results.length} passed ════`);
  if(passed!==results.length) process.exitCode=1;
}

main().catch((e)=>{
  console.error('HARNESS ERROR:',e?.stack||e);
  process.exitCode=2;
}).finally(async()=>{
  for(const c of clients.reverse()) await c.end().catch(()=>{});
  if(epg) await epg.stop().catch(()=>{});
});
