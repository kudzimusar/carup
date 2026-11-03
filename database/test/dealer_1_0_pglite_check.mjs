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
];
const read=(name)=>{
  const all=readFileSync(join(ROOT,name),'utf8');
  const down=all.indexOf('-- +migrate Down');
  return {
    up:all.slice(0,down).replace('-- +migrate Up',''),
    down:all.slice(down).replace('-- +migrate Down',''),
  };
};
const db=new PGlite();
let fatalError=null;
async function exec(sql){return db.exec(sql)}
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
      role TEXT NOT NULL,UNIQUE(tenant_id,user_id)
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

  assert.equal((await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'dealer_%'")).rows[0].n,20);
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
        branch_name:'Fixture showroom',city:'Harare'}],
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
  await exec('TRUNCATE dealer_research_claim_requests CASCADE');
  for(const name of [...names].reverse()){await exec(read(name).down);console.log('ROLLED_BACK',name)}
  for(const name of names){await exec(read(name).up);console.log('REAPPLIED',name)}
  console.log('DEALER_PGLITE_RESULT PASS: 9 migration apply/rollback/reapply, no anon private read, independent review, dispute, appeal and versioned intake');
}catch(error){
  console.error('DEALER_PGLITE_RESULT FAIL',error);
  fatalError=error;
}finally{await db.close()}
// A caught migration error MUST terminate GitHub CI as a failing step.
if(fatalError)throw fatalError;
