/**
 * CARUP-DEALER-ONB-001: behavioural PostgreSQL 17 / PGlite proof.
 * No staging/production secrets, URLs, payments or database daemon.
 * Applies D1+D2+D3+D6 migrations, tests maker-checker / isolation / disputes /
 * claim-prefill and atomic idempotent workbook receipts, then rolls back and reapplies.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','migrations');
const names=[
  '20261103120000_dealer_research_seed_candidates.sql',
  '20261103121000_dealer_research_review_and_claim_intake.sql',
  '20261103122000_dealer_research_correction_requests.sql',
  '20261103123000_dealer_claim_review_and_intake_drafts.sql',
  '20261103124000_dealer_atomic_compliance_governance.sql',
  '20261103125000_dealer_profile_self_grant_hardening.sql',
  '20261103130000_dealer_document_candidate_ocr_events.sql',
  '20261103131000_dealer_compliance_submission_review.sql',
  '20261103132000_dealer_canonical_activation_and_legal_gate.sql',
  '20261103133000_dealer_research_grouping_and_public_contact.sql',
  '20261103134000_dealer_operational_declaration_versions.sql',
  '20261103135000_dealer_full_storefront_publication.sql',
  '20261103136000_dealer_staff_canonical_invitations.sql',
  '20261103137000_dealer_transaction_feedback_candidate_cases.sql',
  '20261103138000_dealer_branch_operating_details.sql',
  '20261103139000_dealer_canonical_inquiry_progress.sql',
  '20261103140000_dealer_staff_branch_scope.sql',
];
const read=(name)=>{
  const all=readFileSync(join(ROOT,name),'utf8');
  const down=all.indexOf('-- +migrate Down');
  return {
    up:all.slice(0,down).replace('-- +migrate Up',''),
    down:all.slice(down).replace('-- +migrate Down',''),
  };
};
// Native PostgreSQL is permitted ONLY in a newly created disposable localhost
// database. An arbitrary shared, staging or production connection is refused.
const nativeUrl=process.env.DEALER_ISOLATED_POSTGRES_URL||'';
const native=Boolean(nativeUrl);
if(native){
  const parsed=new URL(nativeUrl);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||
     !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||
     parsed.pathname!=='/carup_dealer_isolated_ci'||
     parsed.search||parsed.hash){
    throw new Error('ISOLATED_LOOPBACK_POSTGRES_CI_DATABASE_REQUIRED');
  }
  if(process.env.DEALER_SEED_DATABASE_URL || process.env.CARUP_DEALER_RESEARCH_XLSX)
    throw new Error('NATIVE_SYNTHETIC_PROOF_MUST_NOT_USE_REAL_SOURCE_IMPORT_CONFIG');
}
const db=native?new pg.Client({
  connectionString:nativeUrl,ssl:false,application_name:'carup-dealer-isolated-synthetic'
}):new PGlite();
if(native)await db.connect();
let fatalError=null;
async function exec(sql){return native?db.query(sql):db.exec(sql)}
async function query(sql,args=[]){return db.query(sql,args)}
async function fails(sql,phrase){
  let error=null;
  try{await exec(sql)}catch(e){error=e}
  assert.ok(error,`SQL was expected to refuse: ${phrase}`);
  assert.match(String(error?.message||''),new RegExp(phrase,'i'));
}
function uuid(i){return `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;}
const reviewer='reviewer1',claimant='claimant1',outsider='claimant2';
const sha='a'.repeat(64),workbook='b'.repeat(64),workbook2='c'.repeat(64);
try{
  if(native){
    const v=await query('SHOW server_version_num');
    const code=Number(v.rows[0].server_version_num);
    assert.ok(code>=170000&&code<180000,'Native PostgreSQL 17 required, observed '+code);
    console.log('DEALER_NATIVE_POSTGRES_VERSION',code);
  }
  await exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT NULL::UUID $$;
    CREATE TABLE users(
      id TEXT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'member',
      is_verified BOOLEAN NOT NULL DEFAULT false
    );
    CREATE OR REPLACE FUNCTION governance_block_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp
    AS $$ BEGIN RAISE EXCEPTION 'APPEND_ONLY_LEDGER'; END; $$;
    CREATE TABLE dealer_profiles(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL REFERENCES users(id),
      tenant_id TEXT, legal_name TEXT, trading_name TEXT,
      registration_number TEXT,tax_id TEXT,physical_address TEXT,
      responsible_person TEXT,operating_country TEXT,
      identity_status TEXT NOT NULL DEFAULT 'unverified',
      business_evidence_status TEXT NOT NULL DEFAULT 'incomplete',
      listing_limit INTEGER NOT NULL DEFAULT 0,
      compliance_review_state TEXT NOT NULL DEFAULT 'not_started',
      investigation_state TEXT NOT NULL DEFAULT 'none',
      restriction_state TEXT NOT NULL DEFAULT 'none',
      suspension_state TEXT NOT NULL DEFAULT 'none',
      active_state TEXT NOT NULL DEFAULT 'inactive',
      expiry_date TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE dealer_profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE ON dealer_profiles TO authenticated;
    CREATE TABLE tenants(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,type TEXT NOT NULL,status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE organizations(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,
      created_at TEXT NOT NULL,status TEXT DEFAULT 'active',
      tenant_id UUID REFERENCES tenants(id)
    );
    CREATE TABLE organization_roles(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,level INTEGER NOT NULL,description TEXT
    );
    CREATE TABLE organization_users(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),role_id TEXT NOT NULL REFERENCES organization_roles(id),
      status TEXT,joined_at TEXT NOT NULL
    );
    CREATE TABLE tenant_users(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,user_id)
    );
    CREATE TABLE dealer_branches(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dealer_id UUID REFERENCES dealer_profiles(id),name TEXT,address TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE dealer_compliance_requirements(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dealer_id UUID NOT NULL REFERENCES dealer_profiles(id),
      requirement_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      is_blocking BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now()
    );
    -- Isolated native test baseline mirrors the existing canonical VIN read
    -- columns (NOT a newly invented dealership inventory table). Every test
    -- vehicle must be explicitly fictional and starts unpublished/no sale.
    CREATE TABLE vehicles(
      vin TEXT PRIMARY KEY,
      tenant_id UUID REFERENCES tenants(id),
      make TEXT NOT NULL,model TEXT NOT NULL,year INTEGER NOT NULL,
      mileage INTEGER NOT NULL DEFAULT 0,price NUMERIC NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'Available',
      publication_status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Genuine canonical Marketplace public search needs these EXISTING
      -- vehicle read columns. Earlier four-field dealer-only fixture caused
      -- HTTP 500 on /api/marketplace/nav-coverage even though there were
      -- no publicly eligible vehicles. No source here publishes anything.
      owner_id TEXT,
      color TEXT,
      fuel_type TEXT,
      transmission TEXT,
      import_source TEXT,
      duty_paid BOOLEAN,
      police_verified BOOLEAN,
      currency TEXT,
      plate_status TEXT,
      registration_country TEXT,
      registration_status TEXT,
      registration_authority TEXT,
      plate_verified_at TIMESTAMPTZ,
      current_seller_type TEXT,
      public_seller_display_enabled BOOLEAN,
      vehicle_condition_category TEXT,
      passport_verified BOOLEAN,
      zimra_verified BOOLEAN,
      safe_pay_ready BOOLEAN,
      inspection_ready BOOLEAN
    );
    ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON vehicles FROM PUBLIC,anon,authenticated;
    GRANT SELECT ON vehicles TO service_role;
    -- The isolated fixture matches canonical Marketplace inquiry read/write
    -- columns from 20260616120000; original marketplace_inquiries remains
    -- the ONLY lead status authority, never a dealer parallel lead table.
    CREATE TABLE marketplace_inquiries(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id TEXT,listing_type TEXT NOT NULL DEFAULT 'vehicle',
      buyer_id TEXT,guest_name TEXT,guest_email TEXT,guest_phone TEXT,
      seller_id TEXT,seller_tenant_id TEXT,
      inquiry_type TEXT NOT NULL DEFAULT 'vehicle_purchase_interest',
      message TEXT,source_channel TEXT NOT NULL DEFAULT 'web',
      status TEXT NOT NULL DEFAULT 'new',
      risk_status TEXT NOT NULL DEFAULT 'clear',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK(status IN ('new','assigned','contacted','qualified','closed','spam','rejected')),
      CHECK(risk_status IN ('clear','watch','flagged','blocked'))
    );
    ALTER TABLE marketplace_inquiries ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON marketplace_inquiries FROM PUBLIC,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE ON marketplace_inquiries TO service_role;
    -- Throwaway canonical transaction row-type, never a real payment.
    CREATE TABLE escrow_trust_sessions(
      id UUID PRIMARY KEY,buyer_id TEXT REFERENCES users(id),
      tenant_id TEXT,status TEXT NOT NULL
    );
    CREATE TABLE dealer_compliance_decisions(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dealer_id UUID NOT NULL REFERENCES dealer_profiles(id),
      decision TEXT NOT NULL,requirement_key TEXT,actor_id TEXT REFERENCES users(id),
      actor_role TEXT, reason TEXT,payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TRIGGER dealer_compliance_decisions_no_update BEFORE UPDATE ON dealer_compliance_decisions
      FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
    INSERT INTO users(id,role,is_verified)
      VALUES ('reviewer1','admin',true),('claimant1','member',false),
        ('claimant2','member',false),('notreviewer','member',true),
        ('policyreviewer','admin',true),('legalreviewer','admin',true),
        ('activationreviewer','admin',true);
  `);
  for(const name of names){await exec(read(name).up);console.log('APPLIED',name)}
  if(process.env.DEALER_NATIVE_SCHEMA_ONLY==='1'){
    if(!native)throw Error('SCHEMA_ONLY_REQUIRES_GUARDED_NATIVE_LOOPBACK');
    const fresh=await query(`SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM dealer_profiles) AS profiles,
      (SELECT count(*)::int FROM dealer_research_seed_records) AS seeds,
      (SELECT count(*)::int FROM dealer_research_claim_requests) AS claims`);
    assert.deepEqual(fresh.rows[0],{
      tenants:0,organizations:0,profiles:0,seeds:0,claims:0,
    },'browser schema must not inherit contract-test business/tenant authority');
    console.log('DEALER_NATIVE_FRESH_BROWSER_SCHEMA PASS: 17 exact dealership migrations applied to empty disposable PostgreSQL; 0 business/tenant/claim authorities, protected users preseeded');
  } else {
  // Direct authenticated/PostgREST clients cannot mint their own tenant, identity,
  // compliance, activation or listing authority even if they own a dealer row.
  const authorityColumns=['tenant_id','identity_status','compliance_review_state',
    'active_state','restriction_state','suspension_state','investigation_state'];
  for(const column of authorityColumns) {
    const result=await query('SELECT has_column_privilege($1,$2,$3,$4) AS allowed',[
      'authenticated','dealer_profiles',column,'UPDATE']);
    assert.equal(result.rows[0].allowed,false,'unsafe direct UPDATE for '+column);
    const inserted=await query('SELECT has_column_privilege($1,$2,$3,$4) AS allowed',[
      'authenticated','dealer_profiles',column,'INSERT']);
    assert.equal(inserted.rows[0].allowed,false,'unsafe direct INSERT for '+column);
  }
  assert.equal((await query(
    "SELECT has_column_privilege('authenticated','dealer_profiles','legal_name','UPDATE') AS allowed"
  )).rows[0].allowed,true);
  assert.equal((await query(
    "SELECT has_table_privilege('authenticated','dealer_profiles','UPDATE') AS allowed"
  )).rows[0].allowed,false);

  // Seventeen additive dealer migrations create 32 dealer_ tables in the
  // isolated fixture (including legacy dealer_profiles and compliance tables).
  // This is a source-schema count, NOT 27 verified businesses or publications.
  // Real schema-level private branch GPS/hour persistence + negative controls.
  await exec("INSERT INTO dealer_profiles(id,user_id,legal_name) VALUES ('"+uuid(9870)+"','claimant1','Fictional Branch Fixture')");
  await exec("INSERT INTO dealer_branches(id,dealer_id,name,address,latitude,longitude,opening_hours_text) VALUES ('"+
    uuid(9871)+"','"+uuid(9870)+"','Fictional Location','Synthetic address',-17.825500,31.050000,'Mon–Fri 08:00–17:00')");
  const storedBranch=await query(
    'SELECT latitude::float AS latitude,longitude::float AS longitude,opening_hours_text FROM dealer_branches WHERE id=$1',
    [uuid(9871)]);
  assert.equal(storedBranch.rows[0].latitude,-17.8255);
  assert.equal(storedBranch.rows[0].longitude,31.05);
  assert.match(storedBranch.rows[0].opening_hours_text,/Mon/);
  await fails("UPDATE dealer_branches SET longitude=NULL WHERE id='"+uuid(9871)+"'",
    'dealer_branch_gps_pair_valid');
  await fails("UPDATE dealer_branches SET latitude=91 WHERE id='"+uuid(9871)+"'",
    'dealer_branch_gps_pair_valid');
  await fails("UPDATE dealer_branches SET opening_hours_text='' WHERE id='"+uuid(9871)+"'",
    'dealer_branch_hours_text_valid');
  await fails(read('20261103138000_dealer_branch_operating_details.sql').down,
    'CANNOT_ROLLBACK_WITH_BRANCH_OPERATING_DETAILS');
  await exec("DELETE FROM dealer_branches WHERE id='"+uuid(9871)+"'");
  await exec("DELETE FROM dealer_profiles WHERE id='"+uuid(9870)+"'");
  assert.equal((await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'dealer_%'")).rows[0].n,32);
  await exec(`INSERT INTO dealer_research_seed_records(
    seed_dealer_id,source_workbook_sha256,original_source_row,source_row_sha256,
    source_snapshot,proposed_source_category)
   VALUES ('ZW-DEAL-0001','${sha}',8,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0001","Dealer / Company Name":"Fixture Dealer 1","City / Town":"Harare"}',
     'Independent dealer claim'),
     ('ZW-DEAL-0002','${sha}',9,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0002","Dealer / Company Name":"Fixture Dealer 2","City / Town":"Bulawayo"}',
     'Official dealer / franchise label — UNVERIFIED');`);
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_research_public_profiles')).rows[0].n,0);
  const publish=await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4) AS result',[
    'ZW-DEAL-0001',reviewer,'PRELISTED_UNCLAIMED','Public business research eligibility reviewed; no licence badge.']);
  assert.equal(publish.rows[0].result.public,true);
  const publicRow=(await query("SELECT public_research_category,public_slug,publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0];
  assert.equal(publicRow.public_slug,'zw-deal-0001');
  assert.match(publicRow.public_research_category,/research category/);
  await fails(`UPDATE dealer_research_publication_events SET decision='WITHHELD'`,'APPEND_ONLY_LEDGER');

  // Source contact rights are separate from publication. A human reviewer
  // chooses explicit fields, original website must be safe HTTPS, and prior
  // version approval cannot survive a later withhold/republish decision.
  await fails(`SELECT dealer_record_research_contact_review(
    'ZW-DEAL-0001','${claimant}',
    'Unverified claimant attempted to display private contacts without any independent source review approval.',
    true,true,true,false)`,
    'INDEPENDENT_PUBLIC_CONTACT_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_record_research_contact_review(
    'ZW-DEAL-0001','${reviewer}',
    'Independent reviewer requests source fields before actual business contact evidence exists in source records.',
    true,true,true,false)`,
    'SOURCE_ADDRESS_UNAVAILABLE_FOR_PUBLIC_REVIEW');
  const firstContact=await query(
    'SELECT dealer_record_research_contact_review($1,$2,$3,$4,$5,$6,$7) AS result',
    ['ZW-DEAL-0001',reviewer,
    'Independent reviewer checked source provenance and deliberately permits none of the source contacts for public use.',
    false,false,false,false]);
  assert.equal(firstContact.rows[0].result.business_verified,false);
  const group=await query(
    'SELECT dealer_record_research_grouping_review($1,$2,$3,$4,$5) AS result',
    ['ZW-DEAL-0001','ZW-DEAL-0002',reviewer,'POTENTIAL_SAME_PARENT',
    'Two research observations may be affiliated by source wording; legal parents and entity rights remain unverified.']);
  assert.equal(group.rows[0].result.legal_parent_verified,false);
  await fails(`SELECT dealer_record_research_grouping_review(
    'ZW-DEAL-0001','ZW-DEAL-0001','${reviewer}',
    'POTENTIAL_SAME_PARENT',
    'Self-referencing a researched dealership would corrupt identity relationships and must be rejected.')`,
    'SELF_GROUPING_REFUSED');
  await fails('DELETE FROM dealer_research_grouping_review_events','APPEND_ONLY_LEDGER');
  await fails('UPDATE dealer_research_public_contact_events SET public_contact_state=\'RETRACTED\'',
    'APPEND_ONLY_LEDGER');
  const noContact=await query('SELECT public_address,public_business_phone,public_website FROM dealer_research_public_contact_events');
  assert.equal(noContact.rows[0].public_address,null);
  assert.equal(noContact.rows[0].public_business_phone,null);

  // Research review does not change company compliance or create roles.
  assert.equal((await query("SELECT count(*)::int AS n FROM dealer_research_claim_requests")).rows[0].n,0);
  await exec(`
    INSERT INTO dealer_research_claim_requests(
      claim_id,seed_dealer_id,claimant_user_id,claimed_scope,
      representative_relationship,asserted_legal_business_name,claim_statement)
    VALUES ('${uuid(1)}','ZW-DEAL-0001','${claimant}','BRANCH',
      'AUTHORIZED_REPRESENTATIVE','Fixture Legal Co',
      'Claim applicant; original written mandate required for independent review'),
      ('${uuid(2)}','ZW-DEAL-0001','${outsider}','BRANCH',
      'LEGAL_OWNER','Competing Fixture Co',
      'Another claimant competing for this business; independent dispute mandatory');`);
  await fails(`SELECT dealer_record_independent_claim_review(
   '${uuid(1)}','${claimant}','CLAIM_APPROVED',
   'Claimant attempted to certify own unverified document without an independent reviewer',
   '${uuid(100)}','Company Registry','BRANCH')`,'INDEPENDENT_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_record_independent_claim_review(
   '${uuid(1)}','${reviewer}','CLAIM_APPROVED',
   'Reviewer attempted approval without original registered evidence record',
   '${uuid(100)}','Company Registry','BRANCH')`,'VALID_ORIGINAL_DOCUMENT_REQUIRED');
  await exec(`INSERT INTO dealer_claim_private_evidence(
    evidence_id,claim_id,uploader_user_id,document_class,storage_path,content_sha256,
    mime_type,file_bytes,scan_state)
    VALUES ('${uuid(100)}','${uuid(1)}','${claimant}','SIGNATORY_MANDATE',
     'dealership-claims/${uuid(1)}/${uuid(103)}.pdf','${sha}',
     'application/pdf',1024,'CLEAN_CLAMAV_AT_UPLOAD');`);
  await fails(`SELECT dealer_record_independent_claim_review(
   '${uuid(1)}','${reviewer}','CLAIM_APPROVED',
   'Reviewer has independent original evidence and issuer, but a second claimant exists',
   '${uuid(100)}','Company Registry','BRANCH')`,'COMPETING_CLAIMS_REQUIRE_RESOLUTION');
  await exec(`SELECT dealer_record_independent_claim_review(
   '${uuid(2)}','${reviewer}','CLAIM_REJECTED',
   'Independent reviewer rejected the unsupported competing claim with documented findings',
   NULL,NULL,NULL);`);
  const approve=await query('SELECT dealer_record_independent_claim_review($1,$2,$3,$4,$5,$6,$7) AS result',[
    uuid(1),reviewer,'CLAIM_APPROVED',
    'Independently inspected original signed authority evidence and confirmed applicable branch issuer.',
    uuid(100),'Company Registry','BRANCH']);
  assert.equal(approve.rows[0].result.dealer_operational,false);
  assert.equal(approve.rows[0].result.tenant_activated,false);
  const receipt=await query('SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS result',[
    uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,workbook,
    JSON.stringify({tab_rows:{BUSINESS:[{legal_name:'Fixture Legal Co'}],BRANCHES:[{city:'Harare'}]}}),
    JSON.stringify({BUSINESS:1,BRANCHES:1}),0]);
  assert.equal(receipt.rows[0].result.version,1);
  assert.equal(receipt.rows[0].result.applied_to_legal_entities,false);
  const duplicate=await query('SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS result',[
    uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,workbook,
    JSON.stringify({tab_rows:{}}),JSON.stringify({BUSINESS:1}),0]);
  assert.equal(duplicate.rows[0].result.duplicate,true);
  await fails(`SELECT dealer_save_claim_intake_draft(
    '${uuid(1)}','${outsider}','CARUP_DEALER_INTAKE_1_0',
    '${sha}','${workbook2}','{}'::jsonb,'{}'::jsonb,1)`,'CLAIM_APPROVAL_AND_OWNERSHIP_REQUIRED');
  await fails(`SELECT dealer_save_claim_intake_draft(
    '${uuid(1)}','${claimant}','CARUP_DEALER_INTAKE_1_0',
    '${sha}','${workbook2}','{}'::jsonb,'{}'::jsonb,0)`,'STALE_INTAKE_VERSION');
  const replacement=await query('SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS result',[
    uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,workbook2,
    JSON.stringify({tab_rows:{BUSINESS:[{legal_name:'Corrected Fixture Co'}]}}),
    JSON.stringify({BUSINESS:1}),1]);
  assert.equal(replacement.rows[0].result.version,2);
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_claim_intake_receipts')).rows[0].n,2);
  await fails('DELETE FROM dealer_claim_intake_receipts','APPEND_ONLY_LEDGER');
  const appeal=await query('SELECT dealer_request_claim_appeal($1,$2,$3) AS result',[
    uuid(2),outsider,'Independently review this rejected claim; I can provide new documentary proof.']);
  assert.equal(appeal.rows[0].result.authority_granted,false);
  assert.equal((await query(`SELECT claim_status FROM dealer_research_claim_requests WHERE claim_id='${uuid(2)}'`)).rows[0].claim_status,'CLAIM_APPEALED');
  // Affected claimants can no longer self-upgrade via applicant proof alone.
  await fails(`SELECT dealer_record_independent_claim_review(
    '${uuid(2)}','${outsider}','CLAIM_APPROVED',
    'Claimant falsely declares they approved their own appeal with their own original document',
    '${uuid(100)}','Company Registry','BRANCH')`,'INDEPENDENT_REVIEWER_REQUIRED');
  // D6: Freeze actual applicant-drafted fields; explicit signatory/privacy
  // acknowledgment and independently scoped reviewer findings are distinct from
  // claim approval and do NOT create a canonical tenant or verified licence.
  await fails(`SELECT dealer_submit_compliance_application(
    '${uuid(1)}','${claimant}',2,
    'CARUP_DEALER_APPLICANT_DECLARATION_1',true)`,
    'CANONICAL_INTAKE_CONTRACT_REQUIRED');
  const completeApplication={
    schema:'CARUP_DEALER_INTAKE_1_0',
    claim_id:uuid(1),seed_id:'ZW-DEAL-0001',
    source_row_sha256:sha,
    tab_rows:{
      BUSINESS:[{
        claim_reference:uuid(1),source_seed_id:'ZW-DEAL-0001',
        legal_name:'Fixture Legal Co',registration_number:'FIXTURE-REG-001',
        operating_country:'ZW',
        research_confirmation:'CORRECT',
      }],
      BRANCHES:[{branch_ref:'BR-1',source_seed_id:'ZW-DEAL-0001',
        branch_name:'Fixture showroom',city:'Harare',physical_address:'123 Fictional Fixture Rd'}],
      CONSENTS_DECLARATIONS:[{
        signer_name:'Fixture Director',signer_role:'Director',
        privacy_acknowledgment:'YES',
      }],
    },
  };
  const prepared=await query(
    'SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS receipt',
    [uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,'d'.repeat(64),
      JSON.stringify(completeApplication),JSON.stringify({BUSINESS:1,BRANCHES:1,
        CONSENTS_DECLARATIONS:1}),2]);
  assert.equal(prepared.rows[0].receipt.version,3);
  await fails(`SELECT dealer_submit_compliance_application(
    '${uuid(1)}','${claimant}',3,
    'CARUP_DEALER_APPLICANT_DECLARATION_1',false)`,
    'EXPLICIT_APPLICANT_DECLARATION_REQUIRED');
  await fails(`SELECT dealer_submit_compliance_application(
    '${uuid(1)}','${outsider}',3,
    'CARUP_DEALER_APPLICANT_DECLARATION_1',true)`,
    'CLAIM_NOT_APPROVED_FOR_APPLICATION_SUBMISSION');
  await fails(`SELECT dealer_submit_compliance_application(
    '${uuid(1)}','${claimant}',2,
    'CARUP_DEALER_APPLICANT_DECLARATION_1',true)`,
    'STALE_APPLICATION_VERSION');
  const applied=await query(
    'SELECT dealer_submit_compliance_application($1,$2,$3,$4,$5) AS receipt',
    [uuid(1),claimant,3,'CARUP_DEALER_APPLICANT_DECLARATION_1',true]);
  const subId=applied.rows[0].receipt.submission_id;
  assert.equal(applied.rows[0].receipt.tenant_activated,false);
  assert.equal(applied.rows[0].receipt.compliance_approved,false);
  const repeat=await query(
    'SELECT dealer_submit_compliance_application($1,$2,$3,$4,$5) AS receipt',
    [uuid(1),claimant,3,'CARUP_DEALER_APPLICANT_DECLARATION_1',true]);
  assert.equal(repeat.rows[0].receipt.submission_id,subId);
  assert.equal((await query(
    'SELECT count(*)::int AS n FROM dealer_claim_compliance_submissions')).rows[0].n,1);
  await fails("UPDATE dealer_claim_compliance_submissions SET applicant_attested=false",
    'APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_claim_compliance_submissions','permission denied');
  await exec('RESET ROLE');
  await fails(`SELECT dealer_review_compliance_submission(
    '${subId}','${claimant}','READY_FOR_REGULATORY_REVIEW',
    'Claimant cannot self-review this frozen applicant declaration.')`,
    'INDEPENDENT_APPLICATION_REVIEWER_REQUIRED');
  const preliminary=await query(
    'SELECT dealer_review_compliance_submission($1,$2,$3,$4) AS receipt',
    [subId,reviewer,'EVIDENCE_REQUIRED',
      'Reviewer inspected the frozen declaration: supplemental regulator evidence is still required.']);
  assert.equal(preliminary.rows[0].receipt.preliminary_review_only,true);
  assert.equal(preliminary.rows[0].receipt.compliance_approved,false);
  assert.equal(preliminary.rows[0].receipt.tenant_activated,false);
  await fails("UPDATE dealer_claim_compliance_review_events SET verdict='READY_FOR_REGULATORY_REVIEW'",
    'APPEND_ONLY_LEDGER');
  await fails(`SELECT dealer_review_compliance_submission(
    '${subId}','${reviewer}','READY_FOR_REGULATORY_REVIEW',
    'Attempted to overwrite the prior independent case with a second opinion.')`,
    'duplicate key value');
  await fails(read('20261103131000_dealer_compliance_submission_review.sql').down,
    'CANNOT_ROLLBACK_WITH_SUBMITTED_COMPLIANCE_CUSTODY');
  // D6/C11 — only TEST-ONLY fictional policy approval can qualify this local
  // tenant path. The actual migration creates DRAFT policy, never approval.
  const testPolicyReview='Detailed independent test review of fictitious documents, correct local registration and branch legal authority.';
  const secondDraft=await query(
    'SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS receipt',
    [uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,'e'.repeat(64),
      JSON.stringify(completeApplication),JSON.stringify({BUSINESS:1,BRANCHES:1,
        CONSENTS_DECLARATIONS:1}),3]);
  assert.equal(secondDraft.rows[0].receipt.version,4);
  const legalSubmitted=await query(
    'SELECT dealer_submit_compliance_application($1,$2,$3,$4,$5) AS receipt',
    [uuid(1),claimant,4,'CARUP_DEALER_APPLICANT_DECLARATION_1',true]);
  const legalSubmissionId=legalSubmitted.rows[0].receipt.submission_id;
  await query('SELECT dealer_review_compliance_submission($1,$2,$3,$4)',[
    legalSubmissionId,reviewer,'READY_FOR_REGULATORY_REVIEW',
    'Synthetic independent preliminary escalation for an unlicensed fixture only; actual legal policy not approved.']);
  const legalExpiry=new Date(Date.now()+10*86400000).toISOString();
  const sourceRegEvidence=uuid(101),signerEvidence=uuid(100);
  await exec(`INSERT INTO dealer_claim_private_evidence(
    evidence_id,claim_id,uploader_user_id,document_class,storage_path,content_sha256,
    mime_type,file_bytes,scan_state)
    VALUES ('${sourceRegEvidence}','${uuid(1)}','${claimant}','COMPANY_REGISTRATION',
    'dealership-claims/${uuid(1)}/${uuid(102)}.pdf','${'f'.repeat(64)}',
    'application/pdf',1024,'CLEAN_CLAMAV_AT_UPLOAD')`);
  await fails(`SELECT dealer_record_legal_application_approval(
   '${legalSubmissionId}','legalreviewer','CARUP_DEALER_ZW_DRAFT_2026_11_03',
   '${sourceRegEvidence}','${signerEvidence}',
   'Fixture Synthetic Registry','FIXTURE-REG-001','BRANCH',
   '${legalExpiry}', '${testPolicyReview}')`,
   'APPROVED_CURRENT_COUNTRY_POLICY_REQUIRED');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_legal_application_reviews')).rows[0].n,0);
  // PGlite local ONLY: injection of a labelled synthetic policy simulates a
  // legal owner's external approval for contract verification; never deployed.
  await exec(`UPDATE dealer_country_legal_policy_authority
    SET policy_state='APPROVED',approval_evidence_sha256='${'d'.repeat(64)}',
    approved_by='policyreviewer',
    effective_at=now()-interval '1 day',expires_at=now()+interval '30 days'
    WHERE country_code='ZW' AND policy_version='CARUP_DEALER_ZW_DRAFT_2026_11_03'`);
  await fails(`SELECT dealer_record_legal_application_approval(
   '${legalSubmissionId}','${claimant}','CARUP_DEALER_ZW_DRAFT_2026_11_03',
   '${sourceRegEvidence}','${signerEvidence}',
   'Fixture Synthetic Registry','FIXTURE-REG-001','BRANCH',
   '${legalExpiry}', '${testPolicyReview}')`,
   'INDEPENDENT_LEGAL_REVIEWER_REQUIRED');
  // Negative branch: a live appealed competing claim must prevent even a
  // synthetically approved-country legal certification. The authorized reviewer
  // must independently resolve that contested claimant, never auto-merge names.
  await fails(`SELECT dealer_record_legal_application_approval(
   '${legalSubmissionId}','legalreviewer','CARUP_DEALER_ZW_DRAFT_2026_11_03',
   '${sourceRegEvidence}','${signerEvidence}',
   'Fixture Synthetic Registry','FIXTURE-REG-001','BRANCH',
   '${legalExpiry}', '${testPolicyReview}')`,
   'COMPETING_LIVE_CLAIMS_REQUIRE_RESOLUTION');
  await query('SELECT dealer_record_independent_claim_review($1,$2,$3,$4)',[
    uuid(2),reviewer,'CLAIM_REJECTED',
    'Independent reviewer assessed the appealed competing claimant and found no supporting ownership mandate.'
  ]);
  const qualified=await query(
    'SELECT dealer_record_legal_application_approval($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS receipt',
    [legalSubmissionId,'legalreviewer','CARUP_DEALER_ZW_DRAFT_2026_11_03',
     sourceRegEvidence,signerEvidence,'Fixture Synthetic Registry',
     'FIXTURE-REG-001','BRANCH',legalExpiry,testPolicyReview]);
  const legalId=qualified.rows[0].receipt.legal_review_id;
  assert.equal(qualified.rows[0].receipt.public_verified,false);
  await fails(`SELECT dealer_activate_approved_legal_claim(
    '${legalId}','legalreviewer',
    'The legal reviewer attempted to self-grant operational tenant role to a submitted company, prohibited by maker checker.')`,
    'SEPARATE_ACTIVATION_APPROVER_REQUIRED');
  const activated=await query(
    'SELECT dealer_activate_approved_legal_claim($1,$2,$3) AS receipt',
    [legalId,'activationreviewer',
      'Independent synthetic final fixture activation follows an approved test policy and different original and legal reviewers.']);
  const tenant=activated.rows[0].receipt.tenant_id;
  assert.equal(activated.rows[0].receipt.idempotent,false);
  assert.equal(activated.rows[0].receipt.public_verified_badge_granted,false);
  assert.equal(activated.rows[0].receipt.vehicle_listing_authority_granted,false);
  assert.equal(activated.rows[0].receipt.payment_entitlement_granted,false);
  // C13/C20/C21/C22: SQL enforces actual owner, tenant, LIVE legal country policy,
  // immutable versioned declarations and explicit private-only treatment.
  const activeProfileId=activated.rows[0].receipt.dealer_profile_id;
  await fails(`SELECT dealer_record_operational_declaration(
    '${activeProfileId}','${tenant}','${outsider}',
    'BUYER_ASSURANCE',0,'{"refund_policy":"A forged promise"}'::jsonb)`,
    'ACTIVE_CANONICAL_DEALER_OWNER_AND_POLICY_REQUIRED');
  await fails(`SELECT dealer_record_operational_declaration(
    '${activeProfileId}','${tenant}','${claimant}',
    'BUYER_ASSURANCE',0,'{"business_verified":"true"}'::jsonb)`,
    'UNAPPROVED_OPERATION_FIELD_OR_UNSAFE_TEXT');
  const recordedPolicy=await query(
    'SELECT dealer_record_operational_declaration($1,$2,$3,$4,$5,$6::jsonb) AS receipt',
    [activeProfileId,tenant,claimant,'BUYER_ASSURANCE',0,
      JSON.stringify({inspection_rights:'Buyer may request a pre-purchase inspection'})]);
  assert.equal(recordedPolicy.rows[0].receipt.public_approved,false);
  assert.equal(recordedPolicy.rows[0].receipt.version,1);
  const idemPolicy=await query(
    'SELECT dealer_record_operational_declaration($1,$2,$3,$4,$5,$6::jsonb) AS receipt',
    [activeProfileId,tenant,claimant,'BUYER_ASSURANCE',0,
      JSON.stringify({inspection_rights:'Buyer may request a pre-purchase inspection'})]);
  assert.equal(idemPolicy.rows[0].receipt.idempotent,true);
  await fails(`SELECT dealer_record_operational_declaration(
    '${activeProfileId}','${tenant}','${claimant}',
    'BUYER_ASSURANCE',0,'{"refund_policy":"Written policy is private"}'::jsonb)`,
    'STALE_OPERATION_SECTION_VERSION');
  const amended=await query(
    'SELECT dealer_record_operational_declaration($1,$2,$3,$4,$5,$6::jsonb) AS receipt',
    [activeProfileId,tenant,claimant,'BUYER_ASSURANCE',1,
      JSON.stringify({refund_policy:'Written refund terms require further buyer review'})]);
  assert.equal(amended.rows[0].receipt.version,2);
  await fails("UPDATE dealer_operational_declaration_events SET section='SOURCING'",
    'APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_operational_declaration_events','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103134000_dealer_operational_declaration_versions.sql').down,
    'CANNOT_ROLLBACK_WITH_DEALER_DECLARATION_CUSTODY');
  // D8: independently reviewed full public storefront, same research slug,
  // actual canonical branch, explicitly selected owner-declared terms only.
  const fixturePublicReason='A separate qualified reviewer checked the current legal tenant, branch record, source identity and precise buyer display policy for a synthetic dealer.';
  const branchId=activated.rows[0].receipt.initial_branch_id;
  await fails(`SELECT dealer_review_full_storefront_publication(
    'ZW-DEAL-0001','${claimant}','PUBLISHED_FULL',
    ARRAY['${branchId}']::uuid[],ARRAY['BUYER_ASSURANCE']::text[],
    '${fixturePublicReason}')`,
    'INDEPENDENT_PUBLIC_STOREFRONT_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_review_full_storefront_publication(
    'ZW-DEAL-0001','legalreviewer','PUBLISHED_FULL',
    ARRAY['${branchId}']::uuid[],ARRAY['BUYER_ASSURANCE']::text[],
    '${fixturePublicReason}')`,
    'SEPARATE_PUBLIC_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_review_full_storefront_publication(
    'ZW-DEAL-0001','${reviewer}','PUBLISHED_FULL',
    ARRAY[]::uuid[],ARRAY[]::text[],
    '${fixturePublicReason}')`,
    'REVIEWED_PUBLIC_BRANCH_IDS_REQUIRED');
  const full=await query(
    'SELECT dealer_review_full_storefront_publication($1,$2,$3,$4::uuid[],$5::text[],$6) AS result',
    ['ZW-DEAL-0001',reviewer,'PUBLISHED_FULL',[branchId],['BUYER_ASSURANCE'],
      fixturePublicReason]);
  assert.equal(full.rows[0].result.public_full_approved,true);
  assert.equal(full.rows[0].result.logo_rights_approved,false);
  assert.equal(full.rows[0].result.stock_verified,false);
  const current=await query(
    "SELECT seed_dealer_id,public_slug,approved_branch_snapshot,dealer_declared_sections FROM dealer_full_storefront_current");
  assert.equal(current.rows.length,1);
  assert.equal(current.rows[0].public_slug,'zw-deal-0001');
  assert.equal(current.rows[0].approved_branch_snapshot.length,1);
  assert.equal(current.rows[0].dealer_declared_sections.BUYER_ASSURANCE.refund_policy,
    'Written refund terms require further buyer review');

  // Current government/jurisdiction policy is an independently maintained
  // external authority, not a cached public dealer badge. Prove immediate
  // public FULL withdrawal when the previously approved TEST policy expires.
  // Do not permanently modify even the synthetic data: this transaction is
  // explicitly rolled back before running the following canonical operations.
  await exec('BEGIN');
  try{
    await exec(`UPDATE dealer_country_legal_policy_authority
      SET expires_at=now()-interval '1 day'
      WHERE country_code='ZW' AND policy_state='APPROVED'`);
    const withoutPolicy=await query(
      "SELECT seed_dealer_id FROM dealer_full_storefront_current WHERE seed_dealer_id='ZW-DEAL-0001'");
    assert.equal(withoutPolicy.rows.length,0,'expired policy must instantly suppress full public display');
  }finally{await exec('ROLLBACK')}
  assert.equal((await query(
    "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,1,
    'rollback of disposable policy expiry simulation restores valid original approval');

  // A suspended business tenant is also immediately nonpublishable, without
  // relying on browser caches, manufactured flags, or changing old audit rows.
  await exec('BEGIN');
  try{
    await exec(`UPDATE tenants SET status='suspended' WHERE id='${tenant}'`);
    assert.equal((await query(
      "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,0,
      'suspended actual canonical dealer tenant must never retain full public projection');
  }finally{await exec('ROLLBACK')}
  assert.equal((await query(
    "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,1);
  console.log('DEALER_NATIVE_PUBLIC_LIVE_REVOCATION PASS: synthetic policy expiry and canonical tenant suspension suppress full public display immediately; both isolated simulations rolled back');
  await fails('UPDATE dealer_full_storefront_review_events SET disposition=\'RETRACTED\'',
    'APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_full_storefront_current','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103135000_dealer_full_storefront_publication.sql').down,
    'CANNOT_ROLLBACK_WITH_PUBLIC_STORE_FRONT_CUSTODY');
  // D7 C16: staff invitation does NOT create a shadow user or membership.
  // The invited EXISTING verified platform user must independently accept.
  await exec("UPDATE users SET is_verified=true WHERE id='claimant1'");
  // C15 real canonical seller follow-up: atomic status and append-only audit.
  // These are explicitly synthetic rows, not a real buyer/pilot.
  await exec("INSERT INTO marketplace_inquiries(id,seller_tenant_id,status,risk_status) VALUES ('"+
    uuid(8851)+"','"+tenant+"','new','clear'),('"+
    uuid(8852)+"','"+uuid(8850)+"','new','clear'),('"+
    uuid(8853)+"','"+tenant+"','new','watch')");
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${outsider}','${uuid(8851)}','contacted')`,
    'VERIFIED_CANONICAL_LEGAL_OWNER_REQUIRED_FOR_STAFF');
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${claimant}','${uuid(8852)}','contacted')`,
    'INQUIRY_NOT_OWNED_OR_NOT_ELIGIBLE');
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${claimant}','${uuid(8853)}','contacted')`,
    'INQUIRY_NOT_OWNED_OR_NOT_ELIGIBLE');
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${claimant}','${uuid(8851)}','qualified')`,
    'DEALER_INQUIRY_TRANSITION_REFUSED');
  const contacted=(await query('SELECT dealer_advance_marketplace_inquiry($1,$2,$3,$4) AS receipt',[
    activeProfileId,claimant,uuid(8851),'contacted'])).rows[0].receipt;
  assert.equal(contacted.previous_status,'new');
  assert.equal(contacted.status,'contacted');
  assert.equal(contacted.buyer_contact_delivery_verified,false);
  assert.equal(contacted.payment_or_transaction_status_modified,false);
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${claimant}','${uuid(8851)}','contacted')`,
    'DEALER_INQUIRY_TRANSITION_REFUSED');
  const qualifiedInquiry=(await query(
    'SELECT dealer_advance_marketplace_inquiry($1,$2,$3,$4) AS receipt',[
    activeProfileId,claimant,uuid(8851),'qualified'])).rows[0].receipt;
  assert.equal(qualifiedInquiry.previous_status,'contacted');
  assert.equal(qualifiedInquiry.status,'qualified');
  assert.equal((await query('SELECT status FROM marketplace_inquiries WHERE id=$1',[uuid(8851)])).rows[0].status,'qualified');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_canonical_inquiry_progress_events')).rows[0].n,2);
  await fails('UPDATE dealer_canonical_inquiry_progress_events SET next_status=\'contacted\'',
    'APPEND_ONLY_LEDGER');
  await fails(read('20261103139000_dealer_canonical_inquiry_progress.sql').down,
    'CANNOT_ROLLBACK_WITH_DEALER_INQUIRY_AUDIT');
  await exec('SET ROLE authenticated');
  await fails(`SELECT dealer_advance_marketplace_inquiry(
    '${activeProfileId}','${claimant}','${uuid(8851)}','contacted')`,
    'permission denied');
  await exec('RESET ROLE');
  await fails(`SELECT dealer_invite_existing_staff_account(
    '${activeProfileId}','${claimant}','${claimant}')`,
    'VERIFIED_EXISTING_STAFF_ACCOUNT_REQUIRED');
  await fails(`SELECT dealer_invite_existing_staff_account(
    '${activeProfileId}','${claimant}','${outsider}')`,
    'VERIFIED_EXISTING_STAFF_ACCOUNT_REQUIRED');
  const invited=await query(
    'SELECT dealer_invite_existing_staff_account($1,$2,$3) AS receipt',
    [activeProfileId,claimant,'notreviewer']);
  const staffInvite=invited.rows[0].receipt.invite_id;
  assert.equal(invited.rows[0].receipt.permissions_granted,false);
  const duplicateInvite=await query(
    'SELECT dealer_invite_existing_staff_account($1,$2,$3) AS receipt',
    [activeProfileId,claimant,'notreviewer']);
  assert.equal(duplicateInvite.rows[0].receipt.idempotent,true);
  assert.equal((await query('SELECT count(*)::int AS n FROM tenant_users')).rows[0].n,1);
  await fails(`SELECT dealer_accept_staff_invitation(
    '${staffInvite}','${outsider}')`,
    'OWN_STAFF_INVITATION_REQUIRED');
  await fails(`SELECT dealer_grant_staff_branch_scope(
    '${staffInvite}','${branchId}','EDIT_BRANCH_DETAILS','${claimant}',
    'Owner scope only after independent acceptance')`,
    'ACCEPTED_ORIGINAL_OWNER_STAFF_INVITATION_REQUIRED');
  assert.deepEqual((await query(
    "SELECT dealer_list_my_staff_branches('notreviewer') AS scopes")).rows[0].scopes,[]);
  const joined=await query('SELECT dealer_accept_staff_invitation($1,$2) AS receipt',
    [staffInvite,'notreviewer']);
  assert.equal(joined.rows[0].receipt.canonical_member_created,true);
  assert.equal(joined.rows[0].receipt.owner_role_granted,false);
  assert.equal(joined.rows[0].receipt.role,'member');
  const joinedRepeat=await query('SELECT dealer_accept_staff_invitation($1,$2) AS receipt',
    [staffInvite,'notreviewer']);
  assert.equal(joinedRepeat.rows[0].receipt.idempotent,true);
  assert.equal((await query('SELECT count(*)::int AS n FROM tenant_users')).rows[0].n,2);
  assert.equal((await query('SELECT count(*)::int AS n FROM organization_users')).rows[0].n,2);
  const staffMembership=await query('SELECT role FROM tenant_users WHERE tenant_id=$1 AND user_id=$2',
    [tenant,'notreviewer']);
  assert.equal(staffMembership.rows[0].role,'member');
  await fails(`SELECT dealer_grant_staff_branch_scope(
    '${staffInvite}','${branchId}','SELL_VIN','${claimant}',
    'Unapproved seller privilege was requested by owner')`,
    'UNRECOGNIZED_STAFF_BRANCH_PERMISSION');
  await fails(`SELECT dealer_grant_staff_branch_scope(
    '${staffInvite}','${branchId}','EDIT_BRANCH_DETAILS','${outsider}',
    'Different actor must never grant a staff branch')`,
    'ACCEPTED_ORIGINAL_OWNER_STAFF_INVITATION_REQUIRED');
  await fails(`SELECT dealer_grant_staff_branch_scope(
    '${staffInvite}','${uuid(9840)}','EDIT_BRANCH_DETAILS','${claimant}',
    'Different or nonexistent branch must not be granted')`,
    'CANONICAL_STAFF_BRANCH_LINKAGE_REQUIRED');
  const grant=await query('SELECT dealer_grant_staff_branch_scope($1,$2,$3,$4,$5) AS result',
    [staffInvite,branchId,'EDIT_BRANCH_DETAILS',claimant,
      'Synthetic owner explicitly granted private editing of own approved branch']);
  const scopeId=grant.rows[0].result.scope_id;
  assert.equal(grant.rows[0].result.seller_rights_granted,false);
  assert.equal(grant.rows[0].result.finance_rights_granted,false);
  const repeatGrant=await query('SELECT dealer_grant_staff_branch_scope($1,$2,$3,$4,$5) AS result',
    [staffInvite,branchId,'EDIT_BRANCH_DETAILS',claimant,
      'Synthetic owner explicitly granted private editing of own approved branch']);
  assert.equal(repeatGrant.rows[0].result.idempotent,true);
  const scoped=(await query("SELECT dealer_list_my_staff_branches('notreviewer') AS scopes")).rows[0].scopes;
  assert.equal(scoped.length,1);
  assert.equal(scoped[0].branch_id,branchId);
  assert.equal(scoped[0].permission,'EDIT_BRANCH_DETAILS');
  assert.equal(scoped[0].listing_rights,false);
  assert.deepEqual((await query("SELECT dealer_list_my_staff_branches('claimant2') AS scopes")).rows[0].scopes,[]);
  await fails(`SELECT dealer_edit_my_staff_branch(
    '${outsider}','${scopeId}','Fake Branch','Wrong Company',-17.8,31.0,'Mon 01-02')`,
    'CANONICAL_ACTIVE_STAFF_MEMBERSHIP_REQUIRED');
  await fails(`SELECT dealer_edit_my_staff_branch(
    'notreviewer','${scopeId}','Invalid Branch','Wrong GPS',91.1,31.0,'Mon 01-02')`,
    'STAFF_BRANCH_DETAILS_INVALID');
  const beforePublic=JSON.stringify((await query(
    'SELECT approved_branch_snapshot FROM dealer_full_storefront_current')).rows[0].approved_branch_snapshot);
  const saved=await query('SELECT dealer_edit_my_staff_branch($1,$2,$3,$4,$5,$6,$7) AS receipt',
    ['notreviewer',scopeId,'Fictional Staff Managed Branch',
      'Fictional Local Branch Address',-17.812345,31.034567,
      'Mon-Fri 07:30-18:00 private statement']);
  assert.equal(saved.rows[0].receipt.private_declaration_only,true);
  assert.equal(saved.rows[0].receipt.public_snapshot_unchanged,true);
  assert.equal((await query('SELECT name FROM dealer_branches WHERE id=$1',[branchId])).rows[0].name,
    'Fictional Staff Managed Branch');
  const afterPublic=JSON.stringify((await query(
    'SELECT approved_branch_snapshot FROM dealer_full_storefront_current')).rows[0].approved_branch_snapshot);
  assert.equal(afterPublic,beforePublic,'private staff edits must not silently republish');
  await fails("UPDATE dealer_staff_branch_scope_events SET event_type='GRANTED'",
    'APPEND_ONLY_LEDGER');
  await exec('SET ROLE authenticated');
  await fails("SELECT dealer_list_my_staff_branches('notreviewer')",'permission denied');
  await exec('RESET ROLE');
  console.log('DEALER_NATIVE_STAFF_BRANCH_SCOPE PASS: verified owner grant + limited edit, cross-branch and seller denied, public snapshot unchanged');
  await fails("UPDATE dealer_staff_invitation_events SET action='REVOKED'",
    'APPEND_ONLY_LEDGER');
  await fails(`SELECT dealer_revoke_staff_invitation(
    '${staffInvite}','${outsider}')`,
    'VERIFIED_CANONICAL_LEGAL_OWNER_REQUIRED_FOR_STAFF');
  const revokedStaff=await query('SELECT dealer_revoke_staff_invitation($1,$2) AS receipt',
    [staffInvite,claimant]);
  assert.equal(revokedStaff.rows[0].receipt.member_access_revoked,true);
  assert.equal((await query("SELECT count(*)::int AS n FROM dealer_staff_branch_scopes WHERE status='ACTIVE'")).rows[0].n,0);
  assert.deepEqual((await query("SELECT dealer_list_my_staff_branches('notreviewer') AS scopes")).rows[0].scopes,[]);
  await fails(`SELECT dealer_edit_my_staff_branch(
    'notreviewer','${scopeId}','Revoked Staff','Wrong Site',-17.8,31.0,'Mon 08-17')`,
    'STAFF_BRANCH_EDIT_SCOPE_REQUIRED');
  await fails(read('20261103140000_dealer_staff_branch_scope.sql').down,
    'CANNOT_ROLLBACK_WITH_BRANCH_PERMISSION_CUSTODY');
  assert.equal((await query('SELECT count(*)::int AS n FROM tenant_users')).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int AS n FROM organization_users')).rows[0].n,1);
  await fails(read('20261103136000_dealer_staff_canonical_invitations.sql').down,
    'CANNOT_ROLLBACK_WITH_STAFF_INVITATION_CUSTODY');
  const reactivated=await query(
    'SELECT dealer_activate_approved_legal_claim($1,$2,$3) AS receipt',
    [legalId,'activationreviewer',
      'Independent synthetic final fixture activation follows an approved test policy and different original and legal reviewers.']);
  assert.equal(reactivated.rows[0].receipt.idempotent,true);
  assert.equal((await query('SELECT count(*)::int AS n FROM tenants')).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int AS n FROM tenant_users')).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int AS n FROM organization_users')).rows[0].n,1);
  const linked=await query('SELECT role FROM tenant_users WHERE tenant_id=$1 AND user_id=$2',
    [tenant,claimant]);
  assert.equal(linked.rows[0].role,'dealer');
  assert.equal((await query("SELECT count(*)::int AS n FROM dealer_profiles WHERE user_id='claimant1'")).rows[0].n,1);

  // C23 private feedback is linked to a canonical transaction (here a clearly
  // labelled SANDBOX escrow fixture), never to a self-asserted completed sale.
  await exec(`INSERT INTO escrow_trust_sessions(id,buyer_id,tenant_id,status)
    VALUES ('${uuid(520)}','${outsider}','${tenant}','released_sandbox'),
           ('${uuid(521)}','${outsider}','${tenant}','eligible')`);
  await fails(`SELECT dealer_record_transaction_feedback_case(
    'ZW-DEAL-0001','${uuid(520)}','${claimant}','REVIEW_CANDIDATE',
    'The dealer tries to write a false review as a buyer instead of using actual buyer authority.',5)`,
    'EXACT_CANONICAL_TRANSACTION_BUYER_REQUIRED');
  await fails(`SELECT dealer_record_transaction_feedback_case(
    'ZW-DEAL-0002','${uuid(520)}','${outsider}','BUYER_COMPLAINT',
    'This private buyer is linked to another research dealer identity and cannot cross tenants.',NULL)`,
    'EXACT_TRANSACTION_DEALER_TENANT_REQUIRED');
  await fails(`SELECT dealer_record_transaction_feedback_case(
    'ZW-DEAL-0001','${uuid(521)}','${outsider}','REVIEW_CANDIDATE',
    'The buyer cannot rate a vehicle without an eligible canonical transaction release.',5)`,
    'REVIEW_CANDIDATE_REQUIRES_CANONICAL_RELEASE_EVIDENCE');
  const reviewText='This synthetic buyer review is linked to a sandbox-release intent, not a verified real completed vehicle purchase.';
  const result=await query(
    'SELECT dealer_record_transaction_feedback_case($1,$2,$3,$4,$5,$6) AS receipt',
    ['ZW-DEAL-0001',uuid(520),outsider,'REVIEW_CANDIDATE',reviewText,4]);
  const feedbackId=result.rows[0].receipt.case_id;
  assert.equal(result.rows[0].receipt.public_review_eligible,false);
  assert.equal(result.rows[0].receipt.verified_purchase,false);
  assert.equal(result.rows[0].receipt.payment_changed,false);
  const replay=await query(
    'SELECT dealer_record_transaction_feedback_case($1,$2,$3,$4,$5,$6) AS receipt',
    ['ZW-DEAL-0001',uuid(520),outsider,'REVIEW_CANDIDATE',reviewText,4]);
  assert.equal(replay.rows[0].receipt.case_id,feedbackId);
  await fails(`SELECT dealer_record_transaction_feedback_case(
    'ZW-DEAL-0001','${uuid(520)}','${outsider}','REVIEW_CANDIDATE',
    'A buyer cannot overwrite the immutable previously submitted feedback wording.',4)`,
    'FEEDBACK_CASE_ALREADY_SUBMITTED_WITH_DIFFERENT_CONTENT');
  await fails(`SELECT dealer_record_transaction_feedback_finding(
    '${feedbackId}','${outsider}','REFERRED_TO_CANONICAL_DISPUTE',
    'The buyer is not an independent reviewer for their own original transaction feedback case.')`,
    'INDEPENDENT_BUYER_CASE_REVIEWER_REQUIRED');
  // A dealership legal owner cannot review their own buyer complaints even
  // when an administrator accidentally grants that owner a platform review
  // role. Transaction buyer identity and dealer owner separation both matter.
  const ownerPrior=(await query("SELECT role,is_verified FROM users WHERE id='claimant1'")).rows[0];
  await exec("UPDATE users SET role='reviewer',is_verified=true WHERE id='claimant1'");
  await fails(`SELECT dealer_record_transaction_feedback_finding(
    '${feedbackId}','${claimant}','NOT_ELIGIBLE_FOR_PUBLIC_REVIEW',
    'The legal dealership owner cannot independently moderate a complaint about their own seller business.')`,
    'DEALER_CANNOT_REVIEW_OWN_BUYER_CASE');
  await query("UPDATE users SET role=$1,is_verified=$2 WHERE id='claimant1'",
    [ownerPrior.role,ownerPrior.is_verified]);
  const finding=await query(
    'SELECT dealer_record_transaction_feedback_finding($1,$2,$3,$4) AS receipt',
    [feedbackId,reviewer,'REFERRED_TO_CANONICAL_DISPUTE',
      'Independent human-review fixture flagged that the buyer case requires a separate canonical dispute process, not fake paid status.']);
  assert.equal(finding.rows[0].receipt.public_verified_review,false);
  assert.equal(finding.rows[0].receipt.canonical_dispute_case_modified,false);
  assert.equal(finding.rows[0].receipt.provider_payment_status_modified,false);
  await fails('UPDATE dealer_transaction_feedback_cases SET public_review_eligible=true','APPEND_ONLY_LEDGER');
  await fails('UPDATE dealer_transaction_feedback_review_events SET public_review_published=true','APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_transaction_feedback_cases','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103137000_dealer_transaction_feedback_candidate_cases.sql').down,
    'CANNOT_ROLLBACK_WITH_BUYER_FEEDBACK_CUSTODY');
  await fails('UPDATE dealer_legal_application_reviews SET verdict=\'REJECTED\'','APPEND_ONLY_LEDGER');
  await fails(read('20261103132000_dealer_canonical_activation_and_legal_gate.sql').down,
    'CANNOT_ROLLBACK_WITH_LEGAL_ACTIVATION_CUSTODY');
  // D5: OCR is candidate-only and immutable; original-custody mismatch refuses.
  await fails(`SELECT dealer_record_candidate_document_extraction(
    '${uuid(1)}','${uuid(100)}','${outsider}','${sha}',
    'CANDIDATE_REVIEW','{}'::jsonb,1,'{}'::text[],'LOCAL_TESSERACT_V1')`,
    'CANDIDATE_CLAIM_OWNERSHIP_REQUIRED');
  const observed=await query(
    'SELECT dealer_record_candidate_document_extraction($1,$2,$3,$4,$5,$6::jsonb,$7,$8::text[],$9) AS receipt',
    [uuid(1),uuid(100),claimant,sha,'CANDIDATE_REVIEW',
      JSON.stringify({legal_name:{value:'Observed Fixture Legal Co',
        page:1,confidence:null,source:'OBSERVED_LOCAL_OCR'}}),
      1,[], 'LOCAL_TESSERACT_V1']);
  assert.equal(observed.rows[0].receipt.candidate_only,true);
  assert.equal(observed.rows[0].receipt.verified,false);
  assert.equal(observed.rows[0].receipt.legal_approval,false);
  assert.equal(observed.rows[0].receipt.tenant_activated,false);
  await fails("UPDATE dealer_claim_document_ocr_events SET extraction_state='UNREADABLE'",
    'APPEND_ONLY_LEDGER');
  await fails(`SELECT dealer_record_candidate_document_extraction(
    '${uuid(1)}','${uuid(100)}','${claimant}','${sha}',
    'PROVIDER_UNAVAILABLE',
    '{"registration_number":{"value":"FAKE","page":1,"confidence":null,"source":"OBSERVED_LOCAL_OCR"}}'::jsonb,
     1,'{}'::text[],'LOCAL_TESSERACT_V1')`,
    'UNAVAILABLE_OCR_CANNOT_HAVE_FIELDS');
  await fails(`SELECT dealer_record_candidate_document_extraction(
    '${uuid(1)}','${uuid(100)}','${claimant}','${sha}',
    'CANDIDATE_REVIEW',
    '{"legal_name":{"value":"UNQUALIFIED","page":1,"source":"OBSERVED_LOCAL_OCR"}}'::jsonb,
    1,'{}'::text[],'LOCAL_TESSERACT_V1')`,
    'UNQUALIFIED_OCR_FIELD');
  await fails(`SELECT dealer_record_candidate_document_extraction(
    '${uuid(1)}','${uuid(100)}','${claimant}','${sha}',
    'CANDIDATE_REVIEW','{}'::jsonb,1,'{}'::text[],'LOCAL_TESSERACT_V1')`,
    'CANDIDATE_REQUIRES_OBSERVED_PAGE_FIELDS');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_claim_document_ocr_events','permission denied');
  await exec('RESET ROLE');
  // Revocation AFTER processing the original document candidate must disable
  // further access and suspend canonical operations immediately.
  await exec(`UPDATE dealer_research_claim_requests
    SET claim_status='CLAIM_REVOKED' WHERE claim_id='${uuid(1)}'`);
  assert.equal((await query('SELECT operating_status FROM dealer_approved_seed_links')).rows[0].operating_status,'SUSPENDED');
  assert.equal((await query('SELECT active_state FROM dealer_profiles WHERE user_id=$1',[claimant])).rows[0].active_state,'inactive');
  assert.equal((await query('SELECT status FROM tenants WHERE id=$1',[tenant])).rows[0].status,'suspended');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_full_storefront_current')).rows[0].n,0);
  // An independent reviewer can retract publication while the business is
  // suspended; never silently republish upon a later claim reinstatement.
  const withdrawn=await query(
    'SELECT dealer_review_full_storefront_publication($1,$2,$3,$4::uuid[],$5::text[],$6) AS result',
    ['ZW-DEAL-0001',reviewer,'RETRACTED',[],[],
      'The fictional dealer claim was revoked, and all previously approved business display is retracted until another independent human review.']);
  assert.equal(withdrawn.rows[0].result.public_full_approved,false);

  await fails(`SELECT dealer_record_operational_declaration(
    '${activeProfileId}','${tenant}','${claimant}',
    'SOURCING',0,'{"sourcing_channels":"Unreviewed importer statement"}'::jsonb)`,
    'ACTIVE_CANONICAL_DEALER_OWNER_AND_POLICY_REQUIRED');

  await fails(`SELECT dealer_record_candidate_document_extraction(
    '${uuid(1)}','${uuid(100)}','${claimant}','${sha}',
    'CANDIDATE_REVIEW','{}'::jsonb,1,'{}'::text[],'LOCAL_TESSERACT_V1')`,
    'CANDIDATE_CLAIM_OWNERSHIP_REQUIRED');
  // D2/C10: existing dealer compliance decisions commit ledger and effect
  // atomically, with independent verified reviewer and no applicant self-review.
  const dealerId=uuid(301);
  await exec(`INSERT INTO dealer_profiles(id,user_id,identity_status,
   compliance_review_state,investigation_state,active_state)
   VALUES ('${dealerId}','${claimant}','verified','passed','none','inactive')`);
  await fails(`SELECT dealer_record_atomic_compliance_decision(
    '${dealerId}','${claimant}','suspend',NULL,
    'An applicant tried to certify their own legal compliance status','{}'::jsonb)`,
    'INDEPENDENT_COMPLIANCE_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_record_atomic_compliance_decision(
    '${dealerId}','${reviewer}','approve_requirement','company_registration',
    'Reviewer attempted verification before a requirement existed','{}'::jsonb)`,
    'REQUIREMENT_NOT_REGISTERED');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_compliance_decisions')).rows[0].n,0);
  await exec(`INSERT INTO dealer_compliance_requirements(dealer_id,requirement_key,status,is_blocking)
    VALUES ('${dealerId}','company_registration','pending',true)`);
  await fails(`SELECT dealer_record_atomic_compliance_decision(
    '${dealerId}','notreviewer','approve_requirement','company_registration',
    'An unrelated user attempted an unverified compliance approval','{}'::jsonb)`,
    'INDEPENDENT_COMPLIANCE_REVIEWER_REQUIRED');
  await fails(`SELECT dealer_record_atomic_compliance_decision(
    '${dealerId}','${reviewer}','reinstate',NULL,
    'Reviewer attempted activation before satisfying a blocking compliance requirement','{}'::jsonb)`,
    'REINSTATEMENT_COMPLIANCE_GATE_FAILED');
  const reviewed=await query(
    'SELECT dealer_record_atomic_compliance_decision($1,$2,$3,$4,$5,$6::jsonb) AS receipt',
    [dealerId,reviewer,'approve_requirement','company_registration',
     'Independent review of original company registration evidence with all requirements inspected.',
     '{}']);
  assert.equal(reviewed.rows[0].receipt.audit_atomic,true);
  assert.equal((await query(`SELECT status FROM dealer_compliance_requirements
    WHERE dealer_id='${dealerId}'`)).rows[0].status,'verified');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_compliance_decisions')).rows[0].n,1);
  const reinstated=await query(
    'SELECT dealer_record_atomic_compliance_decision($1,$2,$3,$4,$5,$6::jsonb) AS receipt',
    [dealerId,reviewer,'reinstate',null,
     'Independent reviewer confirmed full legal business compliance before reactivation.','{}']);
  assert.equal(reinstated.rows[0].receipt.profile.active_state,'active');
  await fails('UPDATE dealer_compliance_decisions SET reason=\'tampered\'','APPEND_ONLY_LEDGER');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_compliance_decisions')).rows[0].n,2);
  // Direct anonymous read must not bypass service-role projection.
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_research_seed_records','permission denied');
  await fails('SELECT * FROM dealer_claim_private_evidence','permission denied');
  await exec('RESET ROLE');
  // The real claim rollback must refuse if approved/appealed business authority
  // records still exist. This throwaway PGlite fixture can be explicitly wiped
  // AFTER certifying that safety condition, so migration up/down/reapply is tested.
  await fails(read('20261103123000_dealer_claim_review_and_intake_drafts.sql').down,
    'CANNOT_ROLLBACK_WITH_REVIEWED_CLAIMS');
  await fails(read('20261103133000_dealer_research_grouping_and_public_contact.sql').down,
    'CANNOT_ROLLBACK_WITH_SOURCE_PUBLICATION_CUSTODY');
  // The new scoped staff edit is real canonical branch data, so an ordinary
  // rollback of 20261103138000 MUST refuse while it exists. Demonstrate the
  // refusal first; then clear ONLY the known fictional branch we modified,
  // strictly in the disposable local test DB before explicit down/reapply.
  await fails(read('20261103138000_dealer_branch_operating_details.sql').down,
    'CANNOT_ROLLBACK_WITH_BRANCH_OPERATING_DETAILS');
  await query(`UPDATE dealer_branches
    SET latitude=NULL,longitude=NULL,opening_hours_text=NULL,
        operating_details_updated_at=NULL WHERE id=$1`,[branchId]);
  const cleared=(await query(`SELECT latitude,longitude,opening_hours_text,
    operating_details_updated_at FROM dealer_branches WHERE id=$1`,
    [branchId])).rows[0];
  assert.deepEqual(cleared,{latitude:null,longitude:null,
    opening_hours_text:null,operating_details_updated_at:null},
    'fictional branch teardown must not hide real retained operating data');

  // Only the deliberately disposable isolated PGlite fixture is wiped here.
  // Real source contact and grouping review receipts are append-only and their
  // rollback must refuse to destroy them.
  await exec('TRUNCATE dealer_research_grouping_review_events, dealer_research_public_contact_events');
  // PostgreSQL TRUNCATE requires EVERY FK-linked table in the SAME statement,
  // even when the child table has already been emptied. List exactly the four
  // fictional fixture custody tables; never use CASCADE or target shared data.
  await exec('TRUNCATE dealer_staff_branch_scope_events, dealer_staff_branch_scopes, dealer_staff_invitation_events, dealer_staff_invitation_records');
  await exec('TRUNCATE dealer_canonical_inquiry_progress_events');
  await exec('TRUNCATE dealer_full_storefront_review_events');
  await exec('TRUNCATE dealer_operational_declaration_events');
  // Dispose synthetic private feedback before isolated rollback, never on a live DB.
  await exec('TRUNCATE dealer_transaction_feedback_review_events, dealer_transaction_feedback_cases');
  await exec('TRUNCATE dealer_research_claim_requests CASCADE');
  for(const name of [...names].reverse()){await exec(read(name).down);console.log('ROLLED_BACK',name)}
  for(const name of names){await exec(read(name).up);console.log('REAPPLIED',name)}
  console.log((native?'DEALER_NATIVE_POSTGRES_RESULT PASS: ':'DEALER_PGLITE_RESULT PASS: ')+
    '17 migration apply/rollback/reapply, scoped staff grants, no anon private read, independent review, dispute, appeal and versioned intake');
  } // End full destructive synthetic contract suite; fresh schema mode stays empty.
}catch(error){
  console.error(native?'DEALER_NATIVE_POSTGRES_RESULT FAIL':'DEALER_PGLITE_RESULT FAIL',error);
  fatalError=error;
}finally{if(native)await db.end();else await db.close()}
// A caught migration error MUST terminate GitHub CI as a failing step.
if(fatalError)throw fatalError;
