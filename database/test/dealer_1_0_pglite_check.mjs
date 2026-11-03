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
    CREATE TABLE users(
      id TEXT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'member',
      is_verified BOOLEAN NOT NULL DEFAULT false
    );
    CREATE OR REPLACE FUNCTION governance_block_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp
    AS $$ BEGIN RAISE EXCEPTION 'APPEND_ONLY_LEDGER'; END; $$;
    CREATE TABLE dealer_profiles(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL REFERENCES users(id),
      identity_status TEXT NOT NULL DEFAULT 'unverified',
      compliance_review_state TEXT NOT NULL DEFAULT 'not_started',
      investigation_state TEXT NOT NULL DEFAULT 'none',
      restriction_state TEXT NOT NULL DEFAULT 'none',
      suspension_state TEXT NOT NULL DEFAULT 'none',
      active_state TEXT NOT NULL DEFAULT 'inactive',
      expiry_date TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now()
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
        ('claimant2','member',false),('notreviewer','member',true);
  `);
  for(const name of names){await exec(read(name).up);console.log('APPLIED',name)}
  assert.equal((await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'dealer_%'")).rows[0].n,13);
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
  for(const name of [...names].reverse()){await exec(read(name).down);console.log('ROLLED_BACK',name)}
  for(const name of names){await exec(read(name).up);console.log('REAPPLIED',name)}
  console.log('DEALER_PGLITE_RESULT PASS: 5 migration apply/rollback/reapply, no anon private read, independent review, dispute, appeal and versioned intake');
}catch(error){
  console.error('DEALER_PGLITE_RESULT FAIL',error.message);
  process.exitCode=1;
}finally{await db.close()}
