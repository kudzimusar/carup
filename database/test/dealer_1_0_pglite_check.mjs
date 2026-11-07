/**
 * CARUP-DEALER-ONB-001: behavioural PostgreSQL 17 / PGlite proof.
 * No staging/production secrets, URLs, payments or database daemon.
 * Applies all 20 dealership migrations (D1–D8, R4, R5), tests maker-checker / isolation /
 * disputes / claim-prefill / atomic idempotent workbook receipts / T22 storefront media /
 * T42 correction takedowns / S09 duplicate redirects / two-session publish-vs-suspend concurrency,
 * then rolls back and reapplies.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import {PUBLIC_VEHICLE_FIELDS} from '../../backend/utils/publicVehicleProjection.js';
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
  '20261103141000_dealer_canonical_listing_authority.sql',
  '20261103142000_dealer_operating_lifecycle.sql',
  '20261103143000_dealer_r5_directory_media_corrections_redirects.sql',
  '20261103144000_dealer_activation_workbook_carryover.sql',
  '20261103145000_dealer_r6_security_hardening.sql',
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
      -- R4: the canonical CHECK vocabularies of 20260626150000 (an unchecked stub let a wrong
      -- investigation value pass every test — independent review finding #3).
      identity_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (identity_status IN ('unverified','pending','verified','rejected')),
      business_evidence_status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (business_evidence_status IN ('incomplete','complete')),
      listing_limit INTEGER NOT NULL DEFAULT 0,
      compliance_review_state TEXT NOT NULL DEFAULT 'not_started'
        CHECK (compliance_review_state IN ('not_started','in_review','passed','failed')),
      investigation_state TEXT NOT NULL DEFAULT 'none'
        CHECK (investigation_state IN ('none','under_investigation')),
      restriction_state TEXT NOT NULL DEFAULT 'none' CHECK (restriction_state IN ('none','restricted')),
      suspension_state TEXT NOT NULL DEFAULT 'none' CHECK (suspension_state IN ('none','suspended')),
      active_state TEXT NOT NULL DEFAULT 'inactive' CHECK (active_state IN ('active','inactive')),
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
       generation TEXT,trim TEXT,drivetrain TEXT,
      mileage INTEGER NOT NULL DEFAULT 0,price NUMERIC NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'Available',
      publication_status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      owner_id TEXT,
      color TEXT,
      fuel_type TEXT,
      transmission TEXT,
      body_style TEXT,
      seller_stated_condition TEXT,
      seller_description TEXT,
      seller_features TEXT[],
      make_taxon_id TEXT,
      model_taxon_id TEXT,
      color_taxon_id TEXT,
      fuel_taxon_id TEXT,
      transmission_taxon_id TEXT,
      drivetrain_taxon_id TEXT,
      body_style_taxon_id TEXT,
      taxonomy_version TEXT,
      seller_accident_disclosure JSONB,
      seller_insurance_disclosure JSONB,
      seller_finance_disclosure JSONB,
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
      inspection_ready BOOLEAN,
      listing_city TEXT,
      listing_province TEXT,
      listing_country TEXT,
      listing_location_source TEXT,
      listing_location_visibility TEXT,
      listing_location_recorded_at TIMESTAMPTZ,
      registration_country_source TEXT,
      registration_authority_source TEXT,
      registration_status_source TEXT,
      plate_status_source TEXT,
      current_seller_type_source TEXT,
      currency_source TEXT,
      current_seller_id TEXT,
      chassis_number TEXT,
      engine_number TEXT,
      plate_number TEXT,
      temp_plate_id TEXT,
      normalized_plate_number TEXT,
      trust_score NUMERIC
    );
    ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON vehicles FROM PUBLIC,anon,authenticated;
    GRANT SELECT ON vehicles TO service_role;
    CREATE TABLE vehicle_evidence(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_id TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
      vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
      plate_number TEXT,normalized_plate_number TEXT,chassis_number TEXT,engine_number TEXT,
      linked_registry_event_id TEXT,timeline_event_id TEXT,event_source TEXT,event_type TEXT,
      evidence_type TEXT NOT NULL,file_url TEXT NOT NULL,storage_bucket TEXT NOT NULL,
      file_path TEXT NOT NULL,mime_type TEXT NOT NULL,file_size INTEGER NOT NULL,
      checksum TEXT,image_hash TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploader_role TEXT NOT NULL,tenant_id TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_name TEXT,source_reference TEXT,
      verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending','verified','rejected','disputed','superseded')),
      verification_notes TEXT,
      visibility_level TEXT NOT NULL DEFAULT 'public_safe'
        CHECK (visibility_level IN ('public_safe','restricted','private','government_only')),
      verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,verified_at TIMESTAMPTZ,
      trust_impact NUMERIC DEFAULT 0,trust_score_impact NUMERIC DEFAULT 0,confidence_impact NUMERIC DEFAULT 0,
      evidence_class TEXT,evidence_subtype TEXT,event_date TIMESTAMPTZ,event_date_precision TEXT,
      capture_country TEXT,odometer_value NUMERIC,odometer_unit TEXT,component_tags JSONB,
      declared_condition TEXT,source_id UUID,source_record_id TEXT,received_at TIMESTAMPTZ,
      perceptual_hash TEXT,checksum_algorithm TEXT,evidence_set_id UUID,retention_class TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE vehicle_document_extractions(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),evidence_id UUID,vin TEXT NOT NULL,
      document_type TEXT,field_name TEXT,raw_value TEXT,normalized_value TEXT,expected_value TEXT,
      compared_vehicle_field TEXT,match_status TEXT,review_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE fraud_cases(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vin TEXT,status TEXT NOT NULL DEFAULT 'open',
      blocks_publication BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE vehicle_seller_authority(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vin TEXT NOT NULL,seller_user_id TEXT NOT NULL,
      claim_type TEXT NOT NULL DEFAULT 'owner' CHECK (claim_type IN ('owner','authorised_seller','dealer')),
      status TEXT NOT NULL DEFAULT 'evidence_submitted' CHECK (status IN (
        'evidence_submitted','under_review','confirmed','insufficient','disputed','revoked')),
      basis TEXT,evidence_ids UUID[] NOT NULL DEFAULT '{}',reason TEXT,
      policy_version TEXT NOT NULL DEFAULT 'seller_authority.v1',
      decided_by TEXT,decided_by_role TEXT,decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(vin,seller_user_id),
      CHECK (status IN ('evidence_submitted','under_review') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
    );
    CREATE TABLE vehicle_ownership_transfers(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vin TEXT NOT NULL,state TEXT NOT NULL,
      previous_owner_id TEXT,new_owner_id TEXT,completed_at TIMESTAMPTZ
    );
    REVOKE ALL ON vehicle_evidence,vehicle_document_extractions,fraud_cases,
      vehicle_seller_authority,vehicle_ownership_transfers FROM PUBLIC,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE ON vehicle_evidence,vehicle_document_extractions,fraud_cases,
      vehicle_seller_authority,vehicle_ownership_transfers TO service_role;
    CREATE TABLE marketplace_inquiries(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id TEXT,listing_type TEXT NOT NULL DEFAULT 'vehicle',
      buyer_id TEXT,guest_name TEXT,guest_email TEXT,guest_phone TEXT,
      seller_id TEXT,seller_tenant_id TEXT,
      inquiry_type TEXT NOT NULL DEFAULT 'vehicle_purchase_interest',
      message TEXT,source_channel TEXT NOT NULL DEFAULT 'web',
      status TEXT NOT NULL DEFAULT 'new',
      risk_status TEXT NOT NULL DEFAULT 'clear',
      referral_code TEXT,campaign_code TEXT,assigned_operator TEXT,country TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK(status IN ('new','assigned','contacted','qualified','closed','spam','rejected')),
      CHECK(risk_status IN ('clear','watch','flagged','blocked')),
      CHECK(source_channel IN ('web','mobile','whatsapp','telegram','facebook','qr','operator')),
      CHECK(inquiry_type IN ('vehicle_purchase_interest','vehicle_inspection_request','part_quote_request',
        'garage_service_request','import_quote_request','container_space_interest',
        'dealer_stock_request','sell_my_car_request','trade_in_request',
        'diaspora_vehicle_request','diaspora_parts_request','family_purchase_support'))
    );
    CREATE TABLE domain_events(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_type TEXT NOT NULL,payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,error_log TEXT,
      tenant_id TEXT,dedupe_key TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_domain_events_dedupe ON domain_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
    REVOKE ALL ON domain_events FROM PUBLIC,anon,authenticated;
    GRANT SELECT,INSERT ON domain_events TO service_role;
    ALTER TABLE marketplace_inquiries ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON marketplace_inquiries FROM PUBLIC,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE ON marketplace_inquiries TO service_role;
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
  // The true public vehicle allowlist must be selectable against the isolated
  // PostgreSQL baseline, without publishing, seeding or revealing any VIN.
  assert.ok(PUBLIC_VEHICLE_FIELDS.every(x=>/^[a-z][a-z_]*$/.test(x)),
    'Canonical projection fields must remain safe SQL identifiers');
  await query('SELECT '+PUBLIC_VEHICLE_FIELDS.map(x=>'"'+x+'"').join(',')+
    ' FROM vehicles LIMIT 0');
  console.log('DEALER_CANONICAL_PUBLIC_VEHICLE_SCHEMA_CONTRACT PASS: '+
    PUBLIC_VEHICLE_FIELDS.length+' fields, zero public data');
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
    console.log('DEALER_NATIVE_FRESH_BROWSER_SCHEMA PASS: 20 exact dealership migrations applied to empty disposable PostgreSQL; 0 business/tenant/claim authorities, protected users preseeded');
  } else {
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
  // R5: 35 + 6 (correction review events, duplicate redirects, media items, media review events, public media view, shared media review tickets) = 41.
  // R6 C02: + activation branch crosswalk + activation carry-over provenance = 43.
  // R6 security: + research publication policy authority + reviewer step-up guard = 45.
  assert.equal((await query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'dealer_%'")).rows[0].n,45);
  await exec(`INSERT INTO dealer_research_seed_records(
    seed_dealer_id,source_workbook_sha256,original_source_row,source_row_sha256,
    source_snapshot,proposed_source_category)
   VALUES ('ZW-DEAL-0001','${sha}',8,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0001","Dealer / Company Name":"SYNTHETIC FICTIONAL Fixture Dealer 1","City / Town":"Harare"}',
     'Independent dealer claim'),
     ('ZW-DEAL-0002','${sha}',9,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0002","Dealer / Company Name":"SYNTHETIC FICTIONAL Fixture Dealer 2","City / Town":"Bulawayo"}',
     'Official dealer / franchise label — UNVERIFIED'),
     ('ZW-DEAL-0003','${sha}',10,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0003","Dealer / Company Name":"SYNTHETIC FICTIONAL Fixture Dealer 3","City / Town":"Mutare"}',
     'Importer / auction agent — UNVERIFIED'),
     ('ZW-DEAL-0004','${sha}',11,'${sha}',
     '{"Seed Dealer ID":"ZW-DEAL-0004","Dealer / Company Name":"SYNTHETIC FICTIONAL Fixture Dealer 2 Duplicate Branch","City / Town":"Bulawayo"}',
     'Independent dealer claim');`);
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_research_public_profiles')).rows[0].n,0);
  const publish=await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4) AS result',[
    'ZW-DEAL-0001',reviewer,'PRELISTED_UNCLAIMED','Public business research eligibility reviewed; no licence badge.']);
  assert.equal(publish.rows[0].result.public,true);
  const publicRow=(await query("SELECT public_research_category,public_slug,publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0];
  assert.equal(publicRow.public_slug,'zw-deal-0001');
  assert.match(publicRow.public_research_category,/research category/);
  await fails(`UPDATE dealer_research_publication_events SET decision='WITHHELD'`,'APPEND_ONLY_LEDGER');

  // ── R5 T42: Source correction & takedown reviewer disposition ──
  await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4)',[
    'ZW-DEAL-0003',reviewer,'PRELISTED_UNCLAIMED','Published third fictional research record to verify T42 takedown workflow.']);
  const corrReqId=uuid(4201);
  await query(`INSERT INTO dealer_research_correction_requests(
    request_id,seed_dealer_id,request_type,request_summary,contact_email)
    VALUES ($1,'ZW-DEAL-0003','REMOVAL',
    'Fictional business owner requests immediate takedown of this unverified research listing.',
    'owner@fictional.invalid')`,[corrReqId]);
  // Submitting a request NEVER auto-suppresses the public profile.
  assert.equal((await query(`SELECT publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id='ZW-DEAL-0003'`)).rows[0].publication_status,'PRELISTED_UNCLAIMED');
  await fails(`SELECT dealer_review_research_correction_request(
    '${corrReqId}','${claimant}','RESOLVED_SUPPRESSED',
    'Unauthorized non-reviewer attempted to suppress a competitor listing via correction queue.')`,
    'INDEPENDENT_CORRECTION_REVIEWER_REQUIRED');
  const corrResolved=(await query(
    'SELECT dealer_review_research_correction_request($1,$2,$3,$4) AS r',
    [corrReqId,reviewer,'RESOLVED_SUPPRESSED',
      'Independent reviewer verified the takedown request and suppressed the research listing from public directory reads.'])).rows[0].r;
  assert.equal(corrResolved.resulting_publication_status,'SUPPRESSED');
  assert.equal(corrResolved.public_profile_withdrawn,true);
  assert.equal((await query(`SELECT publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id='ZW-DEAL-0003'`)).rows[0].publication_status,'SUPPRESSED');
  assert.equal((await query(`SELECT status FROM dealer_research_correction_requests WHERE request_id=$1`,[corrReqId])).rows[0].status,'RESOLVED_SUPPRESSED');
  await fails(`SELECT dealer_review_research_correction_request(
    '${corrReqId}','${reviewer}','REJECTED_NO_CHANGE',
    'Attempted to re-adjudicate an already resolved correction request.')`,
    'CORRECTION_REQUEST_ALREADY_RESOLVED');
  await fails(`UPDATE dealer_research_correction_review_events SET decision='REJECTED_NO_CHANGE'`,'APPEND_ONLY_LEDGER');
  // Security review #1: the reviewer who took a listing down cannot single-handedly put it back.
  await fails(`SELECT dealer_record_research_publication_review('ZW-DEAL-0003','${reviewer}','PRELISTED_UNCLAIMED',
    'Same reviewer attempts to reverse their own takedown without a second reviewer.')`,
    'REPRELISTING_AFTER_TAKEDOWN_REQUIRES_DIFFERENT_REVIEWER');
  console.log('DEALER_R5_T42_CORRECTION_TAKEDOWN PASS: complaint queued without auto-suppression, unauthorized removal denied, independent reviewer suppression atomically withdraws public profile');

  // ── R5 S09: Governed duplicate reconciliation & canonical URL redirect ──
  await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4)',[
    'ZW-DEAL-0002',reviewer,'PRELISTED_UNCLAIMED','Published second fictional research record to serve as canonical target for S09.']);
  await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4)',[
    'ZW-DEAL-0004',reviewer,'PRELISTED_UNCLAIMED','Published fourth fictional research record prior to duplicate reconciliation.']);
  await fails(`SELECT dealer_reconcile_duplicate_research_seed(
    'ZW-DEAL-0004','ZW-DEAL-0004','${reviewer}',
    'Self-redirect must be refused so a seed never points to itself in the redirect table.')`,
    'SELF_DUPLICATE_REDIRECT_REFUSED');
  await fails(`SELECT dealer_reconcile_duplicate_research_seed(
    'ZW-DEAL-0004','ZW-DEAL-0003','${reviewer}',
    'Redirecting to a suppressed or unpublished seed must be refused so canonical targets stay public.')`,
    'CANONICAL_TARGET_MUST_BE_PUBLISHED');
  const dupResult=(await query(
    'SELECT dealer_reconcile_duplicate_research_seed($1,$2,$3,$4) AS r',
    ['ZW-DEAL-0004','ZW-DEAL-0002',reviewer,
      'Independent reviewer confirmed ZW-DEAL-0004 is a duplicate research observation of ZW-DEAL-0002; redirecting while preserving source custody.'])).rows[0].r;
  assert.equal(dupResult.duplicate_seed_dealer_id,'ZW-DEAL-0004');
  assert.equal(dupResult.canonical_seed_dealer_id,'ZW-DEAL-0002');
  assert.equal(dupResult.canonical_slug,'zw-deal-0002');
  assert.equal(dupResult.canonical_path,'/dealers/zw-deal-0002');
  assert.equal(dupResult.source_custody_preserved,true);
  assert.equal(dupResult.legal_entity_merged,false);
  assert.equal((await query(`SELECT publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id='ZW-DEAL-0004'`)).rows[0].publication_status,'DUPLICATE');
  await fails(`SELECT dealer_reconcile_duplicate_research_seed(
    'ZW-DEAL-0002','ZW-DEAL-0001','${reviewer}',
    'Redirect chains where a canonical target is itself redirected must be refused.')`,
    'DUPLICATE_REDIRECT_CHAIN_REFUSED');
  await fails(`UPDATE dealer_research_duplicate_redirects SET canonical_seed_dealer_id='ZW-DEAL-0001'`,'APPEND_ONLY_LEDGER');
  console.log('DEALER_R5_S09_DUPLICATE_REDIRECT PASS: duplicate reconciled to canonical slug, chains/self-redirects refused, source custody preserved');

  // Source contact rights are separate from publication.
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
  // S09 hostile-takeover guard: a seed with an existing claim cannot be folded into another seed as a duplicate!
  await fails(`SELECT dealer_reconcile_duplicate_research_seed(
    'ZW-DEAL-0001','ZW-DEAL-0002','${reviewer}',
    'Attempting to fold a claimed seed into another seed must be refused to prevent hostile takeover.')`,
    'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED');
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
  await fails(`SELECT dealer_record_independent_claim_review(
    '${uuid(2)}','${outsider}','CLAIM_APPROVED',
    'Claimant falsely declares they approved their own appeal with their own original document',
    '${uuid(100)}','Company Registry','BRANCH')`,'INDEPENDENT_REVIEWER_REQUIRED');
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
        operating_country:'ZW',trading_name:'Fixture Trading',
        business_model:'Independent fictional used-vehicle retailer',
        business_email:'fixture-dealer@example.invalid',tax_clearance_number:'FIXTURE-TAX-1',
        research_confirmation:'CORRECT',
      }],
      // R6 C02: several branches incl. a duplicate reference, markup, invalid GPS and
      // a multi-line schedule; dealer-level policy rows incl. a branch-level conflict.
      BRANCHES:[{branch_ref:'BR-1',source_seed_id:'ZW-DEAL-0001',
        branch_name:'Fixture showroom',city:'Harare',physical_address:'123 Fictional Fixture Rd',
        suburb:'Fixture Suburb',gps_latitude:'-17.8292',gps_longitude:'31.0522',
        visiting_hours:'Mon-Fri 08:00-17:00\nSat 08:00-12:00',business_contact_phone:'+263 000 000'},
       {branch_ref:'BR-2',branch_name:'Fixture second yard',city:'Bulawayo',
        gps_latitude:'91',gps_longitude:'31',visiting_hours:'Daily 09:00-15:00'},
       {branch_ref:'BR-2',branch_name:'Fixture duplicate reference'},
       {branch_ref:'BR-4',branch_name:'<script>alert(1)</script>'},
       {branch_ref:'BR-5',branch_name:'Fixture third site',physical_address:'<b>bold</b> street',
        city:'Gweru',gps_latitude:'-19.45',gps_longitude:'29.82'}],
      FINANCE_PAYMENTS:[{policy_ref:'F1',payment_methods:'Bank transfer (fixture)',
        currencies:'USD',finance_partner:'Fixture Bank (unverified)'},
       {policy_ref:'F2',branch_ref:'BR-2',payment_methods:'Cash only (fixture)'}],
      OPERATIONS_SOURCING:[{operation_ref:'O1',sourcing_channels:'Fictional auction imports',
        import_duty_policy:'Duty quoted per VIN, never as a blanket badge',lot_capacity:40}],
      WORKSHOP_WARRANTY:[{policy_ref:'W1',workshop_services:'Inspection and minor repairs',
        warranty_coverage:'x'.repeat(800),parts_support:'Parts on request'}],
      BRANDS_FRANCHISES:[{brand_claim_ref:'B1',branch_ref:'BR-1',brand:'Fixture OEM',
        relationship:'official franchise'}],
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
  const activeProfileId=activated.rows[0].receipt.dealer_profile_id;
  // R6 C02: the approved application is carried, privately and unverified, in the
  // SAME activation transaction; the dealer does not retype it.
  const carriedBranches=(await query(`SELECT x.branch_ref,x.source_row,b.id,b.name,b.address,
    b.latitude::float AS lat,b.longitude::float AS lng,b.opening_hours_text AS hours
    FROM dealer_activation_branch_crosswalk x JOIN dealer_branches b ON b.id=x.branch_id
    ORDER BY x.source_row`)).rows;
  assert.deepEqual(carriedBranches.map(b=>[b.branch_ref,b.source_row,b.name]),
    [['BR-1',1,'Fixture showroom'],['BR-2',2,'Fixture second yard'],['BR-5',5,'Fixture third site']]);
  assert.equal(carriedBranches[0].id,activated.rows[0].receipt.initial_branch_id,
    'the activation branch is enriched, not duplicated');
  assert.equal(carriedBranches[0].address,'123 Fictional Fixture Rd, Fixture Suburb, Harare');
  assert.deepEqual([carriedBranches[0].lat,carriedBranches[0].lng],[-17.8292,31.0522]);
  assert.equal(carriedBranches[0].hours,'Mon-Fri 08:00-17:00 Sat 08:00-12:00');
  assert.deepEqual([carriedBranches[1].lat,carriedBranches[1].lng],[null,null],'latitude 91 is never carried');
  assert.equal(carriedBranches[1].hours,'Daily 09:00-15:00');
  assert.equal(carriedBranches[2].address,'Gweru','markup address part dropped, safe parts kept');
  assert.deepEqual([carriedBranches[2].lat,carriedBranches[2].lng],[-19.45,29.82]);
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_branches WHERE dealer_id=$1',
    [activeProfileId])).rows[0].n,3,'duplicate and markup branches are not created');
  const carriedSections=Object.fromEntries((await query(`SELECT section,section_version,
    declared_values,actor_user_id,publication_approved,independent_legal_verification
    FROM dealer_operational_declaration_events WHERE dealer_profile_id=$1`,[activeProfileId]))
    .rows.map(r=>[r.section,r]));
  assert.deepEqual(Object.keys(carriedSections).sort(),
    ['BUSINESS_OVERVIEW','FINANCE_TERMS','SERVICE_CAPABILITIES','SOURCING','WARRANTY_AFTERSALES']);
  assert.deepEqual(carriedSections.FINANCE_TERMS.declared_values,{
    accepted_payment_methods:'Bank transfer (fixture)',currency_disclosure:'USD',
    finance_partner_disclosure:'Fixture Bank (unverified)'});
  assert.deepEqual(carriedSections.BUSINESS_OVERVIEW.declared_values,{
    public_description:'Independent fictional used-vehicle retailer',
    declared_contact_email:'fixture-dealer@example.invalid'});
  assert.deepEqual(carriedSections.WARRANTY_AFTERSALES.declared_values,{spare_parts_support:'Parts on request'});
  for(const r of Object.values(carriedSections)){
    assert.equal(r.section_version,1);assert.equal(r.actor_user_id,claimant);
    assert.equal(r.publication_approved,false);assert.equal(r.independent_legal_verification,false);
  }
  const prov=Object.fromEntries((await query(`SELECT source_tab||':'||source_row||':'||source_field AS k,
    disposition,target,value_sha256,research_value_differs FROM dealer_activation_carryover_events`))
    .rows.map(r=>[r.k,r]));
  assert.equal(prov['BRANCHES:3:branch_name'].disposition,'NOT_CARRIED_DUPLICATE');
  assert.equal(prov['BRANCHES:4:branch_name'].disposition,'NOT_CARRIED_INVALID');
  assert.equal(prov['BRANCHES:2:gps_latitude'].disposition,'NOT_CARRIED_INVALID');
  assert.equal(prov['BRANCHES:5:physical_address'].disposition,'NOT_CARRIED_INVALID');
  assert.equal(prov['BRANCHES:1:gps_latitude'].disposition,'CARRIED_UNVERIFIED');
  assert.equal(prov['BRANCHES:1:city'].research_value_differs,false,'city equals the researched value');
  assert.equal(prov['FINANCE_PAYMENTS:2:payment_methods'].disposition,'NOT_CARRIED_CONFLICT');
  assert.equal(prov['WORKSHOP_WARRANTY:1:warranty_coverage'].disposition,'NOT_CARRIED_INVALID');
  assert.equal(prov['BRANDS_FRANCHISES:1:relationship'].disposition,'RETAINED_PRIVATE_NOT_CANONICAL',
    'an OEM claim is never carried into a canonical or public record');
  assert.equal(prov['BUSINESS:1:tax_clearance_number'].disposition,'RETAINED_PRIVATE_NOT_CANONICAL');
  assert.equal(prov['OPERATIONS_SOURCING:1:lot_capacity'].disposition,'RETAINED_PRIVATE_NOT_CANONICAL');
  assert.equal(prov['BUSINESS:1:registration_number'].disposition,'CARRIED_UNVERIFIED');
  assert.match(prov['BUSINESS:1:legal_name'].value_sha256,/^[0-9a-f]{64}$/);
  assert.equal(Object.values(prov).some(r=>JSON.stringify(r).includes('Fixture Bank')),false,
    'provenance stores digests, never a second copy of submitted values');
  const carryRead=(await query('SELECT dealer_read_activation_carryover($1,$2) AS r',
    [activeProfileId,tenant])).rows[0].r;
  assert.equal(carryRead.branches.length,3);
  assert.equal(carryRead.independently_verified,false);
  assert.ok(carryRead.needs_attention.some(n=>n.tab==='BRANCHES'&&n.row===4));
  assert.equal(carryRead.needs_attention.some(n=>n.disposition==='RETAINED_PRIVATE_NOT_CANONICAL'),false);
  await fails("UPDATE dealer_activation_carryover_events SET disposition='CARRIED_UNVERIFIED'",'APPEND_ONLY_LEDGER');
  await fails('DELETE FROM dealer_activation_branch_crosswalk','APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_activation_carryover_events','permission denied');
  await fails(`SELECT dealer_read_activation_carryover('${activeProfileId}','${tenant}')`,'permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103144000_dealer_activation_workbook_carryover.sql').down,
    'CANNOT_ROLLBACK_WITH_ACTIVATION_CARRYOVER_CUSTODY');
  console.log('DEALER_R6_C02_CARRYOVER PASS: 3/5 branches carried with GPS/hours (duplicate, markup and invalid GPS refused), 5 private v1 sections, conflicts and retained fields recorded by digest, no verification or publication');
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

  // ── R5 T22: Tenant-scoped dealership media gallery & independent review ──
  await fails(`SELECT dealer_record_storefront_media_upload(
    '${outsider}','${tenant}'::uuid,'${branchId}'::uuid,
    'dealership-media/${tenant}/unowned.png','${'7'.repeat(64)}','image/png',512,
    'SHOWROOM_EXTERIOR','Unowned upload attempt','Unowned alt text',
    'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',false)`,
    'DEALER_MEDIA_UPLOAD_AUTHORITY_NOT_CURRENT');
  await fails(`SELECT dealer_record_storefront_media_upload(
    '${claimant}','${tenant}'::uuid,'${branchId}'::uuid,
    'dealership-media/${tenant}/oem-logo.png','${'7'.repeat(64)}','image/png',512,
    'SHOWROOM_EXTERIOR','Official OEM Logo Claim','Official OEM Logo Alt Text',
    'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',true)`,
    'OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED');
  const mediaUpload=(await query(
    'SELECT dealer_record_storefront_media_upload($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS r',
    [claimant,tenant,branchId,`dealership-media/${tenant}/showroom-1.png`,'7'.repeat(64),
      'image/png',1024,'SHOWROOM_EXTERIOR',
      'Fictional Harare showroom forecourt and customer reception',
      'Exterior view of fictional Harare dealership showroom forecourt',
      'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',false])).rows[0].r;
  assert.equal(mediaUpload.review_status,'PENDING_INDEPENDENT_REVIEW');
  assert.equal(mediaUpload.logo_rights_approved,false);
  assert.equal(mediaUpload.public_display_approved,false);
  assert.equal((await query("SELECT count(*)::int AS n FROM dealer_public_storefront_media_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n,0);
  // Shared multi-instance & restart-safe single-use ticket custody in PostgreSQL
  const previewJti='a'.repeat(32);
  const previewHash='b'.repeat(64);
  const ticketExp=new Date(Date.now()+600_000).toISOString();
  await fails(`SELECT dealer_issue_storefront_media_review_ticket(
    '${previewJti}','${previewHash}','${claimant}','ZW-DEAL-0001',
    '${mediaUpload.media_id}'::uuid,'STOREFRONT_MEDIA_PREVIEW','${ticketExp}'::timestamptz)`,
    'INDEPENDENT_MEDIA_REVIEWER_REQUIRED');
  const issuedTicket=(await query(
    'SELECT dealer_issue_storefront_media_review_ticket($1,$2,$3,$4,$5::uuid,$6,$7::timestamptz) AS r',
    [previewJti,previewHash,reviewer,'ZW-DEAL-0001',mediaUpload.media_id,'STOREFRONT_MEDIA_PREVIEW',ticketExp])).rows[0].r;
  assert.equal(issuedTicket.ticket_jti,previewJti);
  // Cross-dealership, cross-reviewer, cross-operation, and expired consumption must all fail closed
  await fails(`SELECT dealer_consume_storefront_media_review_ticket(
    '${previewJti}','${previewHash}','${reviewer}','ZW-DEAL-0002','STOREFRONT_MEDIA_PREVIEW')`,
    'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
  await fails(`SELECT dealer_consume_storefront_media_review_ticket(
    '${previewJti}','${previewHash}','${claimant}','ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW')`,
    'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
  await fails(`SELECT dealer_consume_storefront_media_review_ticket(
    '${previewJti}','${previewHash}','${reviewer}','ZW-DEAL-0001','STOREFRONT_MEDIA_DECISION')`,
    'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
  // R6 #8c: the app-supplied p_now is IGNORED (server clock only), so a far-future p_now neither
  // expires a live ticket nor (see the R6 block) revives an expired one.
  // Valid single-use consumption succeeds once and refuses replay
  const consumedTicket=(await query(
    "SELECT dealer_consume_storefront_media_review_ticket($1,$2,$3,$4,$5,now() + interval '1 hour') AS r",
    [previewJti,previewHash,reviewer,'ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW'])).rows[0].r;
  assert.equal(consumedTicket.target_row_id,mediaUpload.media_id);
  await fails(`SELECT dealer_consume_storefront_media_review_ticket(
    '${previewJti}','${previewHash}','${reviewer}','ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW')`,
    'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
  if(native){
    // Two-independent-session concurrent ticket consumption race across two PostgreSQL connections:
    // Session A and Session B race dealer_consume_storefront_media_review_ticket on the same ticket.
    const raceJti='c'.repeat(32);
    const raceHash='d'.repeat(64);
    await query(
      'SELECT dealer_issue_storefront_media_review_ticket($1,$2,$3,$4,$5::uuid,$6,$7::timestamptz)',
      [raceJti,raceHash,reviewer,'ZW-DEAL-0001',mediaUpload.media_id,'STOREFRONT_MEDIA_PREVIEW',ticketExp]);
    const tConnA=new pg.Client({connectionString:nativeUrl,ssl:false});
    const tConnB=new pg.Client({connectionString:nativeUrl,ssl:false});
    await tConnA.connect();
    await tConnB.connect();
    try{
      await tConnA.query('BEGIN');
      await tConnB.query('BEGIN');
      await tConnA.query(
        'SELECT dealer_consume_storefront_media_review_ticket($1,$2,$3,$4,$5)',
        [raceJti,raceHash,reviewer,'ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW']);
      const pendingB=tConnB.query(
        'SELECT dealer_consume_storefront_media_review_ticket($1,$2,$3,$4,$5)',
        [raceJti,raceHash,reviewer,'ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW']);
      await new Promise(resolve=>setTimeout(resolve,120));
      await tConnA.query('COMMIT');
      await assert.rejects(pendingB,/STOREFRONT_MEDIA_REVIEW_TICKET_INVALID/);
      await tConnB.query('ROLLBACK');
    }finally{
      await tConnA.end();
      await tConnB.end();
    }
  }
  await fails(`SELECT dealer_review_storefront_media_item(
    '${mediaUpload.media_id}','${claimant}','APPROVED_PUBLIC_DISPLAY',
    'Claimant attempted to self-approve their own dealership showroom photograph.')`,
    'INDEPENDENT_MEDIA_REVIEWER_REQUIRED');
  const mediaApproved=(await query(
    'SELECT dealer_review_storefront_media_item($1::uuid,$2,$3,$4) AS r',
    [mediaUpload.media_id,reviewer,'APPROVED_PUBLIC_DISPLAY',
      'Independent reviewer verified the showroom photograph, alt text, caption and absence of OEM logos.'])).rows[0].r;
  assert.equal(mediaApproved.public_display_approved,true);
  assert.equal(mediaApproved.logo_rights_approved,false);
  const publicMedia=(await query("SELECT media_id,alt_text,caption,logo_rights_approved FROM dealer_public_storefront_media_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows;
  assert.equal(publicMedia.length,1);
  assert.equal(publicMedia[0].logo_rights_approved,false);
  await fails("UPDATE dealer_storefront_media_review_events SET decision='REJECTED'",'APPEND_ONLY_LEDGER');
  console.log('DEALER_R5_T22_MEDIA_GALLERY PASS: owner-only upload, OEM/logo claim refused, shared single-use ticket custody verified, independent reviewer approval, public view active');

  // Prove immediate public FULL + media withdrawal when policy expires or tenant is suspended.
  await exec('BEGIN');
  try{
    await exec(`UPDATE dealer_country_legal_policy_authority
      SET expires_at=now()-interval '1 day'
      WHERE country_code='ZW' AND policy_state='APPROVED'`);
    const withoutPolicy=await query(
      "SELECT seed_dealer_id FROM dealer_full_storefront_current WHERE seed_dealer_id='ZW-DEAL-0001'");
    assert.equal(withoutPolicy.rows.length,0,'expired policy must instantly suppress full public display');
    assert.equal((await query("SELECT count(*)::int AS n FROM dealer_public_storefront_media_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n,0);
  }finally{await exec('ROLLBACK')}
  assert.equal((await query(
    "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,1,
    'rollback of disposable policy expiry simulation restores valid original approval');

  await exec('BEGIN');
  try{
    await exec(`UPDATE tenants SET status='suspended' WHERE id='${tenant}'`);
    assert.equal((await query(
      "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,0,
      'suspended actual canonical dealer tenant must never retain full public projection');
    assert.equal((await query("SELECT count(*)::int AS n FROM dealer_public_storefront_media_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n,0);
  }finally{await exec('ROLLBACK')}
  assert.equal((await query(
    "SELECT count(*)::int AS n FROM dealer_full_storefront_current")).rows[0].n,1);
  console.log('DEALER_NATIVE_PUBLIC_LIVE_REVOCATION PASS: synthetic policy expiry and canonical tenant suspension suppress full public display and media immediately; both isolated simulations rolled back');
  await fails('UPDATE dealer_full_storefront_review_events SET disposition=\'RETRACTED\'',
    'APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_full_storefront_current','permission denied');
  await fails('SELECT * FROM dealer_public_storefront_media_current','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103135000_dealer_full_storefront_publication.sql').down,
    'CANNOT_ROLLBACK_WITH_PUBLIC_STORE_FRONT_CUSTODY');
  // D7 C16: staff invitation does NOT create a shadow user or membership.
  await exec("UPDATE users SET is_verified=true WHERE id='claimant1'");
  // C15 real canonical seller follow-up: atomic status and append-only audit.
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
  // ── R4 P0-2: canonical dealer VIN listing authority (fictional VIN, disposable DB only) ──
  const listingVin='SYNTHR4P02DLR0001';
  await query(`INSERT INTO vehicles(vin,tenant_id,make,model,year,mileage,price,status,publication_status)
    VALUES ($1,$2,'Fictional','Listing Proof',2022,48211,0,'Pending','draft')`,[listingVin,tenant]);
  const prepareArgs=(actor,branch,price,currency='USD')=>[actor,listingVin,branch,price,currency,
    'FICT-CHASSIS-R4-0001','FICT-ENGINE-R4-0001','customs_cleared_cvr_pending',null,
    'Harare','Harare Metropolitan','public',true];
  const prepareSql='SELECT dealer_prepare_canonical_listing($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS receipt';
  const refusesPrepare=async(args,phrase)=>{
    let error=null;try{await query(prepareSql,args)}catch(e){error=e}
    assert.ok(error,'prepare must refuse: '+phrase);assert.match(String(error.message),new RegExp(phrase));
  };
  await refusesPrepare(prepareArgs(outsider,branchId,18500),'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP');
  await refusesPrepare(prepareArgs(claimant,uuid(9999),18500),'BRANCH_NOT_OWNED_BY_APPROVED_DEALER');
  await refusesPrepare(prepareArgs(claimant,branchId,0),'DEALER_DECLARED_PRICE_REQUIRED');
  await refusesPrepare(prepareArgs(claimant,branchId,18500,'us'),'DEALER_DECLARED_CURRENCY_REQUIRED');
  const listingPrepared=(await query(prepareSql,prepareArgs(claimant,branchId,18500))).rows[0].receipt;
  assert.equal(listingPrepared.published,false);
  assert.equal(listingPrepared.governed_seller_is_approved_owner,true);
  assert.equal(listingPrepared.canonical_publication_gate_required,true);
  assert.equal(listingPrepared.independent_vehicle_review_required,true);
  const listingCandidate=(await query(`SELECT current_seller_id,current_seller_type,status,publication_status,
    price::int AS price,currency,currency_source,registration_status_source,listing_location_source,
    listing_country,owner_id FROM vehicles WHERE vin=$1`,[listingVin])).rows[0];
  assert.deepEqual(listingCandidate,{current_seller_id:claimant,current_seller_type:'Dealer',status:'Available',
    publication_status:'draft',price:18500,currency:'USD',currency_source:'dealer_declared',
    registration_status_source:'dealer_declared',listing_location_source:'dealer_declared',
    listing_country:'ZW',owner_id:null});
  assert.equal((await query('SELECT branch_id::text AS b FROM dealer_vehicle_branch_assignments WHERE vin=$1',
    [listingVin])).rows[0].b,branchId);
  await refusesPrepare(prepareArgs(claimant,branchId,18500,'ZAR'),'CURRENCY_ALREADY_STATED');
  await fails(`UPDATE vehicles SET current_seller_id='${outsider}' WHERE vin='${listingVin}'`,
    'DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER');
  await fails(`UPDATE vehicles SET tenant_id='${uuid(8861)}' WHERE vin='${listingVin}'`,
    'DEALER_TENANT_INVENTORY_REASSIGNMENT_REFUSED');
  await query(`INSERT INTO vehicles(vin,tenant_id,make,model,year,mileage,price,status,publication_status)
    VALUES ('SYNTHR4P02DLR0009',$1,'Fictional','Transfer Proof',2021,1,0,'Pending','draft')`,[tenant]);
  await query(`UPDATE vehicles SET tenant_id=NULL WHERE vin='SYNTHR4P02DLR0009'`);
  await query(`DELETE FROM vehicles WHERE vin='SYNTHR4P02DLR0009'`);
  await fails(`INSERT INTO vehicle_seller_authority(vin,seller_user_id,claim_type,status,decided_by,decided_at)
    VALUES ('${listingVin}','${claimant}','dealer','confirmed','${claimant}',now())`,
    'DEALER_SELLER_AUTHORITY_REQUIRES_INDEPENDENT_REVIEWER');
  await fails(`INSERT INTO vehicle_seller_authority(vin,seller_user_id,claim_type,status,decided_by,decided_at)
    VALUES ('${listingVin}','${claimant}','dealer','confirmed',NULL,NULL)`,
    'DEALER_SELLER_AUTHORITY_REQUIRES_INDEPENDENT_REVIEWER|vehicle_seller_authority');
  const evidenceId=uuid(8890);
  await query(`INSERT INTO vehicle_evidence(id,vehicle_id,vin,evidence_type,evidence_class,evidence_subtype,
      file_url,storage_bucket,file_path,mime_type,file_size,uploaded_by,uploader_role,tenant_id,visibility_level)
    VALUES ($1,$2,$2,'registration_document','registration','registration_book',
      $3,'ocr-documents',$3,'application/pdf',1024,$4,'dealer',$5,'restricted')`,
    [evidenceId,listingVin,listingVin+'/registration_document_fixture.pdf',claimant,tenant]);
  await fails(`UPDATE vehicle_evidence SET verification_status='verified',verified_by='${claimant}' WHERE id='${evidenceId}'`,
    'DEALER_VEHICLE_EVIDENCE_REQUIRES_INDEPENDENT_REVIEWER');
  await fails(`UPDATE vehicle_evidence SET verification_status='verified',verified_by=NULL WHERE id='${evidenceId}'`,
    'DEALER_VEHICLE_EVIDENCE_REQUIRES_INDEPENDENT_REVIEWER');
  const selfUploadedId=uuid(8891);
  await query(`INSERT INTO vehicle_evidence(id,vehicle_id,vin,evidence_type,evidence_class,evidence_subtype,
      file_url,storage_bucket,file_path,mime_type,file_size,uploaded_by,uploader_role,tenant_id,visibility_level)
    VALUES ($1,$2,$2,'registration_document','registration','registration_book',
      $3,'ocr-documents',$3,'application/pdf',1024,'reviewer1','admin',$4,'restricted')`,
    [selfUploadedId,listingVin,listingVin+'/registration_document_admin_fixture.pdf',tenant]);
  await fails(`UPDATE vehicle_evidence SET verification_status='verified',verified_by='reviewer1' WHERE id='${selfUploadedId}'`,
    'DEALER_VEHICLE_EVIDENCE_REQUIRES_INDEPENDENT_REVIEWER');
  await query('DELETE FROM vehicle_evidence WHERE id=$1',[selfUploadedId]);
  await query(`UPDATE vehicle_evidence SET verification_status='verified',verified_by='reviewer1',verified_at=now()
    WHERE id=$1`,[evidenceId]);
  for(const quarantine of ['Suspended','Banned','Flagged','Reserved','Sold']){
    await query(`UPDATE vehicles SET status=$2 WHERE vin=$1`,[listingVin,quarantine]);
    await refusesPrepare(prepareArgs(claimant,branchId,18500),'VEHICLE_STATUS_NOT_LISTABLE');
  }
  await query(`UPDATE vehicles SET status='Available' WHERE vin=$1`,[listingVin]);
  await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`,[listingVin]);
  assert.equal((await query('SELECT dealer_tenant_listing_authority_current($1::uuid) AS ok',[tenant])).rows[0].ok,true);
  assert.deepEqual((await query('SELECT dealer_withdraw_lapsed_listing_authority($1) AS r',['reviewer1'])).rows[0].r,
    {tenants_withdrawn:0,listings_withdrawn:0});
  await refusesPrepare(prepareArgs(claimant,branchId,18500),'LISTING_ALREADY_PUBLIC_UNPUBLISH_FIRST');
  await fails('UPDATE dealer_listing_authority_events SET reason_code=\'FORGED_REASON\'','APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_listing_authority_events','permission denied');
  await fails('SELECT * FROM dealer_vehicle_branch_assignments','permission denied');
  await exec('RESET ROLE');
  await exec('SET ROLE authenticated');
  await fails(`SELECT dealer_prepare_canonical_listing('${claimant}','${listingVin}','${branchId}',1,'USD',
    'AAAA','BBBB','unknown',NULL,'Harare',NULL,'public',false)`,'permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103141000_dealer_canonical_listing_authority.sql').down,
    'CANNOT_ROLLBACK_WITH_DEALER_LISTING_CUSTODY');
  console.log('DEALER_R4_LISTING_AUTHORITY_ACTIVE PASS: owner-only preparation, owned branch, dealer_declared provenance, no foreign seller/reassignment/self-verification');
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
  // ── R4 P0-3 (C12): governed operating lifecycle on the active fictional dealer ──
  const lifecycleSql='SELECT dealer_record_operating_lifecycle_decision($1,$2,$3,$4,$5) AS receipt';
  const lifecycle=async(by,action,newLegal=null)=>(await query(lifecycleSql,
    ['ZW-DEAL-0001',by,action,lifecycleWhy,newLegal])).rows[0].receipt;
  const lifecycleWhy='Fictional CI lifecycle decision by an independent synthetic reviewer, for contract verification only.';
  const refusesLifecycle=async(args,phrase)=>{
    let error=null;try{await query(lifecycleSql,args)}catch(e){error=e}
    assert.ok(error,'lifecycle must refuse: '+phrase);assert.match(String(error.message),new RegExp(phrase));
  };
  const listingState=async()=>(await query('SELECT publication_status FROM vehicles WHERE vin=$1',[listingVin])).rows[0].publication_status;
  await refusesLifecycle(['ZW-DEAL-0001',claimant,'SUSPEND',lifecycleWhy,null],'INDEPENDENT_LIFECYCLE_REVIEWER_REQUIRED');
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'SUSPEND','too short to explain anything',null],'OPERATING_LIFECYCLE_REASON_REQUIRED');
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'APPROVE_EVERYTHING',lifecycleWhy,null],'INVALID_OPERATING_LIFECYCLE_ACTION');
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'REINSTATE',lifecycleWhy,null],'ONLY_SUSPENDED_DEALER_CAN_BE_REINSTATED');
  assert.equal(await listingState(),'published');
  const investigation=await lifecycle(reviewer,'OPEN_INVESTIGATION');
  assert.equal(investigation.operating_authority_current,false);
  assert.equal(investigation.public_listings_withdrawn,1);
  assert.equal(await listingState(),'publishable');
  const closedInvestigation=await lifecycle(reviewer,'CLOSE_INVESTIGATION');
  assert.equal(closedInvestigation.operating_authority_current,true);
  assert.equal(closedInvestigation.listings_republished,false);
  assert.equal(await listingState(),'publishable','closing an investigation never silently republishes');
  await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`,[listingVin]);
  const lifecycleSuspended=await lifecycle(reviewer,'SUSPEND');
  assert.deepEqual([lifecycleSuspended.operating_status,lifecycleSuspended.public_listings_withdrawn,
    lifecycleSuspended.operating_authority_current],['SUSPENDED',1,false]);
  assert.equal((await query('SELECT status FROM tenants WHERE id=$1',[tenant])).rows[0].status,'suspended');
  assert.equal((await query("SELECT count(*)::int AS n FROM dealer_public_storefront_media_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n,0,
    'suspension must also withdraw approved storefront media from public view');
  await fails(`UPDATE vehicles SET publication_status='published' WHERE vin='${listingVin}'`,'DEALER_LISTING_AUTHORITY_NOT_CURRENT');
  await fails(`UPDATE dealer_profiles SET suspension_state='none',active_state='active' WHERE id='${activeProfileId}'`,
    'DEALER_PROFILE_REINSTATEMENT_REQUIRES_LIFECYCLE_DECISION');
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'REINSTATE',lifecycleWhy,null],'REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER');
  const reinstatedDealer=await lifecycle('activationreviewer','REINSTATE');
  assert.deepEqual([reinstatedDealer.operating_status,reinstatedDealer.operating_authority_current,
    reinstatedDealer.listings_republished],['ACTIVE',true,false]);
  assert.equal(await listingState(),'publishable','reinstatement never silently republishes stock');

  // ── R5: Two-independent-session concurrent publish-vs-suspend race on native PostgreSQL 17 ──
  if (native) {
    const dbSessionB = new pg.Client({
      connectionString: nativeUrl,
      ssl: false,
      application_name: 'carup-dealer-isolated-concurrency-session-b',
    });
    await dbSessionB.connect();
    try {
      // Interleaving 1: Session B begins SUSPEND and holds FOR UPDATE on dealer_approved_seed_links
      // while Session A concurrently attempts UPDATE vehicles SET publication_status='published'.
      await query(`UPDATE vehicles SET publication_status='publishable' WHERE vin=$1`, [listingVin]);
      await dbSessionB.query('BEGIN');
      const suspendInTx = dbSessionB.query(lifecycleSql, [
        'ZW-DEAL-0001', reviewer, 'SUSPEND',
        'Concurrent race Interleaving 1: reviewer suspends dealer while owner attempts VIN publish.',
        null,
      ]);
      await suspendInTx;
      let publishBlockedError = null;
      const publishPromise = query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin])
        .catch((err) => { publishBlockedError = err; });
      await new Promise((r) => setTimeout(r, 40));
      await dbSessionB.query('COMMIT');
      await publishPromise;
      assert.ok(publishBlockedError, 'Interleaving 1: concurrent publish must fail closed after suspend commits');
      assert.match(String(publishBlockedError?.message || ''), /DEALER_LISTING_AUTHORITY_NOT_CURRENT/);
      assert.equal(await listingState(), 'publishable');
      assert.equal((await query('SELECT dealer_tenant_listing_authority_current($1::uuid) AS ok', [tenant])).rows[0].ok, false);
      assert.equal((await query("SELECT count(*)::int AS n FROM dealer_storefront_public_listing_vins('ZW-DEAL-0001', 12)")).rows[0].n, 0);
      assert.equal((await query("SELECT count(*)::int AS n FROM dealer_full_storefront_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n, 0);
      await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
        VALUES ('${uuid(8897)}','${listingVin}','${tenant}','new','clear')`, 'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');

      // Reinstate via dual control ('activationreviewer' != 'reviewer1') to test Interleaving 2.
      await lifecycle('activationreviewer', 'REINSTATE');
      assert.equal(await listingState(), 'publishable');

      // Interleaving 2: Session A begins transaction and executes UPDATE vehicles SET publication_status='published'
      // (acquiring FOR SHARE on dealer_approved_seed_links), while Session B concurrently invokes SUSPEND
      // (which blocks on FOR UPDATE of dealer_approved_seed_links until Session A commits, then immediately
      // withdraws the newly published listing inside the same atomic SUSPEND transaction).
      await query('BEGIN');
      await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin]);
      const suspendWaiting = dbSessionB.query(lifecycleSql, [
        'ZW-DEAL-0001', reviewer, 'SUSPEND',
        'Concurrent race Interleaving 2: reviewer suspends dealer while owner publish transaction commits.',
        null,
      ]);
      await new Promise((r) => setTimeout(r, 40));
      await query('COMMIT');
      const suspendReceipt = (await suspendWaiting).rows[0].receipt;
      assert.equal(suspendReceipt.operating_status, 'SUSPENDED');
      assert.equal(suspendReceipt.public_listings_withdrawn, 1);
      assert.equal(await listingState(), 'publishable', 'Interleaving 2: listing must end withdrawn after both transactions settle');
      assert.equal((await query('SELECT dealer_tenant_listing_authority_current($1::uuid) AS ok', [tenant])).rows[0].ok, false);
      assert.equal((await query("SELECT count(*)::int AS n FROM dealer_storefront_public_listing_vins('ZW-DEAL-0001', 12)")).rows[0].n, 0);
      assert.equal((await query("SELECT count(*)::int AS n FROM dealer_full_storefront_current WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0].n, 0);
      await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
        VALUES ('${uuid(8898)}','${listingVin}','${tenant}','new','clear')`, 'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');

      // Restore active state via dual control so the remaining RENEW / revocation tests proceed cleanly.
      await lifecycle('activationreviewer', 'REINSTATE');
      console.log('DEALER_R5_CONCURRENT_PUBLISH_VS_SUSPEND_RACE PASS: two independent PostgreSQL 17 sessions proved zero public VINs, zero storefront rows, and inquiry refusal across both transaction interleavings');
    } finally {
      await dbSessionB.end();
    }
  }

  // ── R6 DBA #4: ONE lock order (docs/dealership/R6_DBA_OPERATIONS_AND_LOCK_ORDER.md) ──
  // tenants → dealer_profiles → programme vehicles (ascending VIN) → dealer_approved_seed_links.
  // Each interleaving below deadlocked (SQLSTATE 40P01) before the order was established; the
  // waiter is now always queued BEHIND the first lock holder and never holds a lock the holder needs.
  if (native) {
    const session = async (name) => {
      const c = new pg.Client({ connectionString: nativeUrl, ssl: false, application_name: 'carup-dealer-r6-lock-order-' + name });
      await c.connect();
      c.pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      return c;
    };
    // Wait until a session is really blocked on a lock (never a fixed sleep). Bounded: 10 s.
    const blockedBy = async (pid) => {
      for (let i = 0; i < 500; i += 1) {
        const r = await query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid]);
        if (r.rows[0].n > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('R6_LOCK_ORDER_SESSION_NEVER_BLOCKED pid=' + pid);
    };
    const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
    const noDeadlock = (label, ...outcomes) => {
      for (const o of outcomes) {
        assert.ok(o.ok || o.e?.code !== '40P01', `${label}: deadlock detected (40P01): ${o.e?.message}`);
      }
    };
    const owner = (await query('SELECT current_seller_id FROM vehicles WHERE vin=$1', [listingVin])).rows[0].current_seller_id;
    assert.equal(owner, claimant, 'lock-order fixture: the approved owner is the governed seller');
    const suspendWhy = (n) => `Fictional CI R6 lock-order interleaving ${n}: independent reviewer suspends the synthetic dealer.`;
    const sA = await session('a'); const sB = await session('b'); const sX = await session('x');
    try {
      const interleave = async (label, { holdSql, holderSql, expectHolder }) => {
        await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin]);
        await sA.query('BEGIN');
        await sA.query(holdSql, [listingVin]);
        await sB.query('BEGIN');
        const suspend = settle(sB.query(lifecycleSql, ['ZW-DEAL-0001', reviewer, 'SUSPEND', suspendWhy(label), null]));
        await blockedBy(sB.pid);
        const holder = await settle(sA.query(holderSql, [listingVin]));
        const commitA = await settle(sA.query(holder.ok ? 'COMMIT' : 'ROLLBACK'));
        const suspended = await suspend;
        await settle(sB.query(suspended.ok ? 'COMMIT' : 'ROLLBACK'));
        noDeadlock(label, holder, suspended, commitA);
        assert.ok(holder.ok, `${label}: dealer-side write must succeed: ${holder.e?.message}`);
        assert.ok(suspended.ok, `${label}: suspension must succeed: ${suspended.e?.message}`);
        assert.equal(suspended.r.rows[0].receipt.operating_status, 'SUSPENDED');
        assert.equal(await listingState(), expectHolder, `${label}: final publication state`);
        assert.equal((await query(`SELECT count(*)::int AS n FROM vehicles WHERE tenant_id=$1 AND publication_status='published'`, [tenant])).rows[0].n, 0,
          `${label}: a suspended dealer keeps zero public listings`);
        await lifecycle('activationreviewer', 'REINSTATE');
      };
      // Review T5: the dealer locked a published VIN, then unpublishes it while a suspension runs.
      await interleave('T5', { holdSql: 'SELECT vin FROM vehicles WHERE vin=$1 FOR UPDATE',
        holderSql: `UPDATE vehicles SET publication_status='publishable' WHERE vin=$1`, expectHolder: 'publishable' });
      // Review T6: a price edit (no guard) then a governed-seller restatement (guard) in one transaction.
      await interleave('T6', { holdSql: 'UPDATE vehicles SET price=price+1 WHERE vin=$1',
        holderSql: 'UPDATE vehicles SET current_seller_id=current_seller_id WHERE vin=$1', expectHolder: 'publishable' });

      // Preparation vs suspension: preparation must take the VIN before the operating link.
      await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin]);
      await sX.query('BEGIN');
      await sX.query('SELECT vin FROM vehicles WHERE vin=$1 FOR UPDATE', [listingVin]);
      await sB.query('BEGIN');
      const suspendP = settle(sB.query(lifecycleSql, ['ZW-DEAL-0001', reviewer, 'SUSPEND', suspendWhy('PREPARE'), null]));
      await blockedBy(sB.pid);
      const prepareP = settle(sA.query(prepareSql, prepareArgs(claimant, branchId, 18500)));
      await blockedBy(sA.pid);
      await sX.query('COMMIT');
      const suspendedP = await suspendP;
      await settle(sB.query(suspendedP.ok ? 'COMMIT' : 'ROLLBACK'));
      const prepared = await prepareP;
      noDeadlock('PREPARE', prepared, suspendedP);
      assert.ok(suspendedP.ok, 'PREPARE: suspension must succeed: ' + suspendedP.e?.message);
      assert.equal(prepared.ok, false, 'PREPARE: preparation behind a suspension must be refused');
      assert.match(String(prepared.e?.message), /NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP/);
      assert.equal(await listingState(), 'publishable');
      await lifecycle('activationreviewer', 'REINSTATE');

      // Direct profile write (e.g. the 20261103124000 compliance decision) vs a lifecycle decision:
      // the profile row is taken before the operating link on both paths.
      await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin]);
      await sA.query('BEGIN');
      await sA.query('SELECT id FROM dealer_profiles WHERE id=$1 FOR UPDATE', [activeProfileId]);
      await sB.query('BEGIN');
      const suspendD = settle(sB.query(lifecycleSql, ['ZW-DEAL-0001', reviewer, 'SUSPEND', suspendWhy('PROFILE'), null]));
      await blockedBy(sB.pid);
      const profileWrite = await settle(sA.query(`UPDATE dealer_profiles SET investigation_state=investigation_state WHERE id=$1`, [activeProfileId]));
      await settle(sA.query(profileWrite.ok ? 'COMMIT' : 'ROLLBACK'));
      const suspendedD = await suspendD;
      await settle(sB.query(suspendedD.ok ? 'COMMIT' : 'ROLLBACK'));
      noDeadlock('PROFILE', profileWrite, suspendedD);
      assert.ok(profileWrite.ok && suspendedD.ok, 'PROFILE: both transactions must commit');
      assert.equal(await listingState(), 'publishable');
      await lifecycle('activationreviewer', 'REINSTATE');
      // Every other authority-loss path (claim dispute trigger, direct tenant / owner-membership /
      // country-policy writes) against the same T5 dealer unpublish. The authority-loss transaction is
      // inspected and then ROLLED BACK, so the fictional dealer stays ACTIVE for the tests that follow.
      const withdrawalPaths = [
        ['CLAIM_DISPUTE', `UPDATE dealer_research_claim_requests SET claim_status='CLAIM_DISPUTED' WHERE claim_id='${uuid(1)}'`],
        ['TENANT_STATUS', `UPDATE tenants SET status='suspended' WHERE id='${tenant}'`],
        ['OWNER_MEMBERSHIP', `UPDATE tenant_users SET role='member' WHERE tenant_id='${tenant}' AND user_id='${claimant}'`],
        ['COUNTRY_POLICY', `UPDATE dealer_country_legal_policy_authority SET policy_state='SUSPENDED'
          WHERE (country_code,policy_version)=(SELECT r.country_code,r.policy_version FROM dealer_legal_application_reviews r
            JOIN dealer_approved_seed_links l ON l.legal_review_id=r.legal_review_id WHERE l.tenant_id='${tenant}')`],
      ];
      for (const [label, lossSql] of withdrawalPaths) {
        await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`, [listingVin]);
        await sA.query('BEGIN');
        await sA.query('SELECT vin FROM vehicles WHERE vin=$1 FOR UPDATE', [listingVin]);
        await sB.query('BEGIN');
        const loss = settle(sB.query(lossSql));
        await blockedBy(sB.pid);
        const unpublish = await settle(sA.query(`UPDATE vehicles SET publication_status='publishable' WHERE vin=$1`, [listingVin]));
        await settle(sA.query(unpublish.ok ? 'COMMIT' : 'ROLLBACK'));
        const lost = await loss;
        let insideLoss = null;
        if (lost.ok) {
          insideLoss = (await sB.query(`SELECT dealer_tenant_listing_authority_current($1::uuid) AS current,
            (SELECT count(*)::int FROM vehicles WHERE tenant_id=$1::uuid AND publication_status='published') AS published,
            (SELECT count(*)::int FROM dealer_approved_seed_links WHERE tenant_id=$1::uuid) AS linked`, [tenant])).rows[0];
        }
        await settle(sB.query('ROLLBACK'));
        noDeadlock(label, unpublish, lost);
        assert.ok(unpublish.ok && lost.ok, `${label}: both transactions must complete: ${unpublish.e?.message || lost.e?.message}`);
        assert.deepEqual(insideLoss, { current: false, published: 0, linked: 1 }, `${label}: authority lost with zero public listings`);
        assert.equal((await query('SELECT dealer_tenant_listing_authority_current($1::uuid) AS ok', [tenant])).rows[0].ok, true,
          `${label}: the inspected authority-loss transaction was rolled back`);
      }
      assert.equal(await listingState(), 'publishable');
      console.log('DEALER_R6_LOCK_ORDER PASS: T5 unpublish, T6 seller restatement, preparation, direct profile write, claim dispute, tenant status, owner membership and country policy each queue behind/ahead of a concurrent withdrawal with zero 40P01 and zero public listings');
    } finally {
      for (const c of [sA, sB, sX]) await c.end();
    }
  }

  // RENEW: only onto a NEWER independent legal review of the same claim with a later expiry.
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'RENEW',lifecycleWhy,null],'NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED');
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'RENEW',lifecycleWhy,legalId],'NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED');
  const draftVersion=(await query('SELECT submission_version FROM dealer_claim_intake_drafts WHERE claim_id=$1',
    [uuid(1)])).rows[0].submission_version;
  const renewalDraft=(await query(
    'SELECT dealer_save_claim_intake_draft($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS receipt',
    [uuid(1),claimant,'CARUP_DEALER_INTAKE_1_0',sha,'9'.repeat(64),JSON.stringify(completeApplication),
      JSON.stringify({BUSINESS:1,BRANCHES:1,CONSENTS_DECLARATIONS:1}),draftVersion])).rows[0].receipt;
  const renewalSubmission=(await query('SELECT dealer_submit_compliance_application($1,$2,$3,$4,$5) AS receipt',
    [uuid(1),claimant,renewalDraft.version,'CARUP_DEALER_APPLICANT_DECLARATION_1',true])).rows[0].receipt.submission_id;
  await query('SELECT dealer_review_compliance_submission($1,$2,$3,$4)',[renewalSubmission,reviewer,
    'READY_FOR_REGULATORY_REVIEW','Synthetic independent preliminary escalation for the renewal of a fictional fixture only.']);
  const renewalExpiry=new Date(Date.now()+20*86400000).toISOString();
  const renewedLegalId=(await query(
    'SELECT dealer_record_legal_application_approval($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS receipt',
    [renewalSubmission,'legalreviewer','CARUP_DEALER_ZW_DRAFT_2026_11_03',sourceRegEvidence,signerEvidence,
      'Fixture Synthetic Registry','FIXTURE-REG-001','BRANCH',renewalExpiry,testPolicyReview])).rows[0].receipt.legal_review_id;
  await refusesLifecycle(['ZW-DEAL-0001','legalreviewer','RENEW',lifecycleWhy,renewedLegalId],'RENEWAL_REQUIRES_SEPARATE_REVIEWER');
  await refusesLifecycle(['ZW-DEAL-0001','policyreviewer','RENEW',lifecycleWhy,renewedLegalId],'RENEWAL_REQUIRES_SEPARATE_REVIEWER');
  const renewed=await lifecycle(reviewer,'RENEW',renewedLegalId);
  assert.equal(renewed.legal_review_id,renewedLegalId);
  assert.equal(renewed.operating_authority_current,true);
  const renewedLink=(await query(`SELECT l.legal_review_id::text AS legal,l.submission_id::text AS submission,
    d.expiry_date FROM dealer_approved_seed_links l JOIN dealer_profiles d ON d.id=l.dealer_profile_id
    WHERE l.seed_dealer_id='ZW-DEAL-0001'`)).rows[0];
  assert.deepEqual([renewedLink.legal,renewedLink.submission],[renewedLegalId,renewalSubmission]);
  assert.equal(new Date(renewedLink.expiry_date).toISOString(),renewalExpiry);
  await refusesLifecycle(['ZW-DEAL-0001',reviewer,'RENEW',lifecycleWhy,legalId],'NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED');
  assert.ok((await query('SELECT count(*)::int AS n FROM dealer_operating_lifecycle_events')).rows[0].n>=5);
  await fails("UPDATE dealer_operating_lifecycle_events SET action='WITHDRAW'",'APPEND_ONLY_LEDGER');
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_operating_lifecycle_events','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103142000_dealer_operating_lifecycle.sql').down,'CANNOT_ROLLBACK_WITH_DEALER_LIFECYCLE_CUSTODY');
  await fails(read('20261103143000_dealer_r5_directory_media_corrections_redirects.sql').down,'CANNOT_ROLLBACK_WITH_DEALER_R5_CUSTODY');
  // Write-driven lapses outside the dealer records also withdraw stock (finding #2).
  await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`,[listingVin]);
  await query(`UPDATE dealer_country_legal_policy_authority SET policy_state='SUSPENDED'
    WHERE country_code='ZW' AND policy_version='CARUP_DEALER_ZW_DRAFT_2026_11_03'`);
  assert.equal(await listingState(),'publishable','a suspended country policy withdraws the stock');
  await query(`UPDATE dealer_country_legal_policy_authority SET policy_state='APPROVED'
    WHERE country_code='ZW' AND policy_version='CARUP_DEALER_ZW_DRAFT_2026_11_03'`);
  await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`,[listingVin]);
  await query(`UPDATE tenant_users SET role='member' WHERE tenant_id=$1 AND user_id=$2`,[tenant,claimant]);
  assert.equal(await listingState(),'publishable','the owner losing the dealer role withdraws the stock');
  await query(`UPDATE tenant_users SET role='dealer' WHERE tenant_id=$1 AND user_id=$2`,[tenant,claimant]);
  const lapseReasons=(await query(`SELECT reason_code FROM dealer_listing_authority_events
    WHERE tenant_id=$1 AND event_type='PUBLIC_LISTINGS_WITHDRAWN' ORDER BY created_at`,[tenant])).rows.map(r=>r.reason_code);
  assert.deepEqual(lapseReasons.slice(-2),['COUNTRY_POLICY_NOT_CURRENT','OWNER_MEMBERSHIP_CHANGED']);
  await query(`UPDATE vehicles SET publication_status='published' WHERE vin=$1`,[listingVin]);
  console.log('DEALER_R4_OPERATING_LIFECYCLE PASS: investigate/close, suspend (stock withdrawn), dual-control reinstate, renew onto a newer independent legal review; nothing silently republished');
  await exec(`UPDATE dealer_research_claim_requests
    SET claim_status='CLAIM_REVOKED' WHERE claim_id='${uuid(1)}'`);
  assert.equal((await query('SELECT operating_status FROM dealer_approved_seed_links')).rows[0].operating_status,'SUSPENDED');
  assert.equal((await query('SELECT active_state FROM dealer_profiles WHERE user_id=$1',[claimant])).rows[0].active_state,'inactive');
  assert.equal((await query('SELECT status FROM tenants WHERE id=$1',[tenant])).rows[0].status,'suspended');
  assert.equal((await query('SELECT publication_status FROM vehicles WHERE vin=$1',[listingVin])).rows[0].publication_status,'publishable');
  const withdrawal=(await query(`SELECT reason_code,affected_listings FROM dealer_listing_authority_events
    WHERE tenant_id=$1 AND event_type='PUBLIC_LISTINGS_WITHDRAWN'`,[tenant])).rows;
  assert.deepEqual(withdrawal.at(-1),{reason_code:'OPERATING_LINK_SUSPENDED',affected_listings:1});
  assert.equal((await query('SELECT dealer_tenant_listing_authority_current($1::uuid) AS ok',[tenant])).rows[0].ok,false);
  await fails(`UPDATE vehicles SET publication_status='published' WHERE vin='${listingVin}'`,
    'DEALER_LISTING_AUTHORITY_NOT_CURRENT');
  await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
    VALUES ('${uuid(8899)}','${listingVin}','${tenant}','new','clear')`,'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
  // R6: neither an upper-case seller_tenant_id nor an omitted one can skip the enquiry guard.
  await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
    VALUES ('${uuid(8900)}','${listingVin}','${String(tenant).toUpperCase()}','new','clear')`,'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
  await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
    VALUES ('${uuid(8901)}','${listingVin}',NULL,'new','clear')`,'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
  await fails(`INSERT INTO marketplace_inquiries(id,listing_id,seller_tenant_id,status,risk_status)
    VALUES ('${uuid(8902)}','${listingVin}','not-a-uuid','new','clear')`,'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT');
  await fails(`SELECT dealer_prepare_canonical_listing('${claimant}','${listingVin}','${branchId}',18500,'USD',
    'FICT-CHASSIS-R4-0001','FICT-ENGINE-R4-0001','customs_cleared_cvr_pending',NULL,'Harare',NULL,'public',true)`,
    'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP');
  console.log('DEALER_R4_LISTING_AUTHORITY_REVOKED PASS: suspension withdrew 1 public listing (OPERATING_LINK_SUSPENDED); republish, inquiry and re-preparation refused');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_full_storefront_current')).rows[0].n,0);
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
  await exec('SET ROLE anon');
  await fails('SELECT * FROM dealer_research_seed_records','permission denied');
  await fails('SELECT * FROM dealer_claim_private_evidence','permission denied');
  await exec('RESET ROLE');
  await fails(read('20261103123000_dealer_claim_review_and_intake_drafts.sql').down,
    'CANNOT_ROLLBACK_WITH_REVIEWED_CLAIMS');
  await fails(read('20261103133000_dealer_research_grouping_and_public_contact.sql').down,
    'CANNOT_ROLLBACK_WITH_SOURCE_PUBLICATION_CUSTODY');
  await fails(read('20261103138000_dealer_branch_operating_details.sql').down,
    'CANNOT_ROLLBACK_WITH_BRANCH_OPERATING_DETAILS');
  await query(`UPDATE dealer_branches
    SET latitude=NULL,longitude=NULL,opening_hours_text=NULL,
        operating_details_updated_at=NULL
    WHERE dealer_id=(SELECT dealer_id FROM dealer_branches WHERE id=$1)`,[branchId]);
  const cleared=(await query(`SELECT latitude,longitude,opening_hours_text,
    operating_details_updated_at FROM dealer_branches WHERE id=$1`,
    [branchId])).rows[0];
  assert.deepEqual(cleared,{latitude:null,longitude:null,
    opening_hours_text:null,operating_details_updated_at:null},
    'fictional branch teardown must not hide real retained operating data');

  // ── R6 work package C (20261103145000): security hardening ──
  {
    const r6='20261103145000_dealer_r6_security_hardening.sql';
    const r6Tenant=(await query("SELECT tenant_id::text AS t,link_id::text AS l,legal_review_id::text AS lr FROM dealer_approved_seed_links WHERE seed_dealer_id='ZW-DEAL-0001'")).rows[0];
    await exec(`INSERT INTO users(id,role,is_verified) VALUES
      ('coireviewer','admin',true),('staffreviewer','reviewer',true),('lateconflict','admin',true)`);
    // #8c: every ticket SECURITY DEFINER function pins search_path=public,pg_temp.
    const cfg=(await query(`SELECT proname,array_to_string(proconfig,',') AS cfg,prosecdef FROM pg_proc
      WHERE proname IN ('dealer_issue_storefront_media_review_ticket','dealer_consume_storefront_media_review_ticket',
        'dealer_begin_reviewer_step_up','dealer_complete_reviewer_step_up','dealer_reviewer_conflict_of_interest',
        'dealer_guard_reviewer_conflict_of_interest','dealer_research_seed_is_fictional_fixture',
        'dealer_real_research_publication_policy_current','dealer_guard_real_research_publication')
      ORDER BY proname`)).rows;
    assert.equal(cfg.length,9);
    for(const row of cfg){
      assert.equal(row.prosecdef,true,row.proname+' must be SECURITY DEFINER');
      assert.match(row.cfg,/search_path=public, ?pg_temp/,row.proname+' search_path');
    }
    for(const fn of ['dealer_begin_reviewer_step_up(text)','dealer_complete_reviewer_step_up(text,boolean)',
      'dealer_issue_storefront_media_review_ticket(text,text,text,text,uuid,text,timestamptz)',
      'dealer_research_seed_is_fictional_fixture(text)']){
      const g=(await query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
        has_function_privilege('authenticated',$1,'EXECUTE') AS auth,
        has_function_privilege('service_role',$1,'EXECUTE') AS svc`,[fn])).rows[0];
      assert.deepEqual(g,{anon:false,auth:false,svc:true},fn);
    }

    // ── #2 real research publication stays fail-closed without an Owner (O12) policy ──
    const seedRow=(id,row,wb,snap)=>`('${id}','${wb}',${row},'${'e'.repeat(64)}','${JSON.stringify(snap).replace(/'/g,"''")}','Independent dealer claim')`;
    const fictionalSnap=(n)=>({'Dealer / Company Name':'SYNTHETIC FICTIONAL CAR DEALER '+n,'City / Town':'Harare',
      'Physical Address':'Test Lot '+n+' (not a real address)','Phone / WhatsApp':'NO REAL PHONE',
      'Email':'not-a-dealer@example.invalid','Ownership / Parent Company / Key Principal':'FICTIONAL COMPANY — NO LEGAL PARENT',
      'Website / Source URL':'https://example.invalid/fictional-dealer-'+n});
    await exec(`INSERT INTO dealer_research_seed_records(seed_dealer_id,source_workbook_sha256,original_source_row,
      source_row_sha256,source_snapshot,proposed_source_category) VALUES
      ${seedRow('ZW-DEAL-0090',90,'f'.repeat(64),{'Dealer / Company Name':'Harare Real Motors','City / Town':'Harare','Phone / WhatsApp':'+263 77 123 4567'})},
      ${seedRow('ZW-DEAL-0091',91,'f'.repeat(64),{...fictionalSnap(91),'Phone / WhatsApp':'+263 77 123 4567'})},
      ${seedRow('ZW-DEAL-0092',92,'a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137',fictionalSnap(92))},
      ${seedRow('ZW-DEAL-0093',93,'f'.repeat(64),{...fictionalSnap(93),'Email':'sales@realdealer.co.zw'})},
      ${seedRow('ZW-DEAL-0094',94,'f'.repeat(64),{...fictionalSnap(94),'Website / Source URL':'https://realdealer.co.zw/?x=.invalid'})},
      ${seedRow('ZW-DEAL-0095',95,'f'.repeat(64),{...fictionalSnap(95),'Physical Address':'12 Samora Machel Ave, Harare'})},
      ${seedRow('ZW-DEAL-0096',96,'f'.repeat(64),{...fictionalSnap(96),'Ownership / Parent Company / Key Principal':'Mr T. Real Person'})},
      ${seedRow('ZW-DEAL-0097',97,'f'.repeat(64),{...fictionalSnap(97),'Dealer / Company Name':'Synthetic Fictional lookalike Ltd'})},
      ${seedRow('ZW-DEAL-0098',98,'f'.repeat(64),fictionalSnap(98))}`);
    const fictional=(await query(`SELECT seed_dealer_id,dealer_research_seed_is_fictional_fixture(seed_dealer_id) AS f
      FROM dealer_research_seed_records WHERE seed_dealer_id BETWEEN 'ZW-DEAL-0090' AND 'ZW-DEAL-0098' ORDER BY 1`)).rows;
    assert.deepEqual(fictional.map(r=>r.f),[false,false,false,false,false,false,false,false,true],
      'only a self-declared fictional name with no real-looking contact channel and a non-Owner workbook is fictional');
    assert.equal((await query("SELECT dealer_research_seed_is_fictional_fixture('ZW-DEAL-0001') AS f")).rows[0].f,true);
    assert.equal((await query("SELECT dealer_research_seed_is_fictional_fixture('ZW-DEAL-9999') AS f")).rows[0].f,false);
    const pubWhy='Independent research publication review for a seed in the isolated contract suite only.';
    for(const id of ['ZW-DEAL-0090','ZW-DEAL-0091','ZW-DEAL-0092','ZW-DEAL-0093','ZW-DEAL-0094','ZW-DEAL-0095','ZW-DEAL-0096','ZW-DEAL-0097']){
      await fails(`SELECT dealer_record_research_publication_review('${id}','${reviewer}','PRELISTED_UNCLAIMED','${pubWhy}')`,
        'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY');
    }
    assert.equal((await query("SELECT count(*)::int AS n FROM dealer_research_public_profiles WHERE seed_dealer_id BETWEEN 'ZW-DEAL-0090' AND 'ZW-DEAL-0097'")).rows[0].n,0);
    // Takedown / non-public decisions on a real record are never blocked.
    const withheld=(await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4) AS r',
      ['ZW-DEAL-0090',reviewer,'WITHHELD',pubWhy])).rows[0].r;
    assert.equal(withheld.public,false);
    // The fictional CI fixture path keeps publishing.
    assert.equal((await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4) AS r',
      ['ZW-DEAL-0098',reviewer,'PRELISTED_UNCLAIMED',pubWhy])).rows[0].r.public,true);
    // No API role can create or alter the Owner policy, even if a grant were mistakenly added.
    await exec('SET ROLE service_role');
    await fails(`INSERT INTO dealer_research_publication_policy_authority(policy_version,country_code,owner_decision_reference)
      VALUES ('ZW_REAL_PUBLICATION_V1','ZW','O12')`,'permission denied');
    await exec('RESET ROLE');
    await exec('GRANT INSERT,UPDATE,DELETE ON dealer_research_publication_policy_authority TO service_role');
    await exec('SET ROLE service_role');
    await fails(`INSERT INTO dealer_research_publication_policy_authority(policy_version,country_code,owner_decision_reference)
      VALUES ('ZW_REAL_PUBLICATION_V1','ZW','O12')`,'PUBLICATION_POLICY_NOT_WRITABLE_FROM_API');
    await exec('RESET ROLE');
    await exec('REVOKE INSERT,UPDATE,DELETE ON dealer_research_publication_policy_authority FROM service_role');
    assert.equal((await query(`SELECT count(*)::int AS n FROM pg_proc
      WHERE prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+dealer_research_publication_policy_authority'`)).rows[0].n,0,
      'no database function may write the Owner publication policy');
    assert.equal((await query('SELECT count(*)::int AS n FROM dealer_research_publication_policy_authority')).rows[0].n,0,
      'migration must not pre-approve real publication');
    // Operator-recorded Owner policy (outside the API): approver can never also publish; then it publishes.
    await exec(`INSERT INTO dealer_research_publication_policy_authority(policy_version,country_code,policy_state,
      owner_decision_reference,approval_evidence_sha256,approved_by,effective_at,expires_at)
      VALUES ('ZW_REAL_PUBLICATION_V1','ZW','APPROVED','O12','${'9'.repeat(64)}','policyreviewer',
        now()-interval '1 minute',now()+interval '1 day')`);
    await fails(`SELECT dealer_record_research_publication_review('ZW-DEAL-0097','policyreviewer','PRELISTED_UNCLAIMED','${pubWhy}')`,
      'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY');
    assert.equal((await query('SELECT dealer_record_research_publication_review($1,$2,$3,$4) AS r',
      ['ZW-DEAL-0097',reviewer,'PRELISTED_UNCLAIMED',pubWhy])).rows[0].r.public,true);
    await exec(`UPDATE dealer_research_publication_policy_authority SET policy_state='SUSPENDED'`);
    const contactWhy='Independent review of the research-source address for public display in the isolated contract suite only; no business verification.';
    await fails(`SELECT dealer_record_research_contact_review('ZW-DEAL-0097','${reviewer}','${contactWhy}',true,false,false,false)`,
      'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY');
    assert.equal((await query(`SELECT dealer_record_research_contact_review($1,$2,$3,false,false,false,true) AS r`,
      ['ZW-DEAL-0097',reviewer,contactWhy])).rows[0].r.public_contact_state,'RETRACTED','retraction always allowed');
    await fails(`SELECT dealer_record_research_publication_review('ZW-DEAL-0095','${reviewer}','PRELISTED_UNCLAIMED','${pubWhy}')`,
      'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY');
    console.log('DEALER_R6_REAL_PUBLICATION_GATE PASS: 8 real/spoofed seeds refused, takedown allowed, fictional fixture published, API roles cannot write the O12 policy, approver≠publisher, suspended policy closes again');

    // ── #7 reviewer conflict of interest (data layer) ──
    await exec(`INSERT INTO dealer_research_claim_requests(claim_id,seed_dealer_id,claimant_user_id,claimed_scope,
      representative_relationship,asserted_legal_business_name,claim_statement)
      VALUES ('${uuid(7701)}','ZW-DEAL-0001','coireviewer','BRANCH','LEGAL_OWNER','Rival Reviewer Co',
        'A reviewer holding their own competing claim on this seed must never review it.')`);
    await exec(`INSERT INTO tenant_users(tenant_id,user_id,role) VALUES ('${r6Tenant.t}','staffreviewer','member')`);
    const coi=(await query(`SELECT u AS reviewer,dealer_reviewer_conflict_of_interest(u,'ZW-DEAL-0001') AS c
      FROM unnest(ARRAY['coireviewer','staffreviewer','${claimant}','activationreviewer','${reviewer}']) u`)).rows;
    assert.deepEqual(coi.map(r=>r.c),[true,true,true,false,false]);
    const anySubmission=(await query("SELECT s.submission_id::text AS s FROM dealer_claim_compliance_submissions s JOIN dealer_research_claim_requests c ON c.claim_id=s.claim_id WHERE c.seed_dealer_id='ZW-DEAL-0001' LIMIT 1")).rows[0].s;
    const mediaRow=(await query("SELECT media_id::text AS m FROM dealer_storefront_media_items WHERE seed_dealer_id='ZW-DEAL-0001' LIMIT 1")).rows[0].m;
    const longWhy='Conflict-of-interest probe: this reviewer has a personal stake in the dealer under review and must be refused by the data layer itself.';
    for(const conflicted of ['coireviewer','staffreviewer']){
      const ledgerWrites=[
        `INSERT INTO dealer_claim_review_events(claim_id,reviewer_user_id,verdict,review_reason)
          VALUES ('${uuid(1)}','${conflicted}','CLAIM_REJECTED','${longWhy}')`,
        `INSERT INTO dealer_claim_compliance_review_events(submission_id,reviewer_user_id,verdict,decision_reason)
          VALUES ('${anySubmission}','${conflicted}','NEEDS_CORRECTIONS','${longWhy}')`,
        `INSERT INTO dealer_legal_application_reviews(submission_id,claimant_user_id,reviewer_user_id,country_code,policy_version,
          company_registration_evidence_id,signatory_evidence_id,verified_issuer,reviewed_registration_number,approved_scope,
          legal_expires_at,legal_review_reason,verdict)
          VALUES ('${anySubmission}','${claimant}','${conflicted}','ZW','CARUP_DEALER_ZW_DRAFT_2026_11_03',
          '${uuid(7702)}','${uuid(7703)}','Probe Registry','PROBE-1','BRANCH',now()+interval '1 day','${longWhy}','COMPLIANCE_APPROVED')`,
        `INSERT INTO dealer_approved_seed_links(seed_dealer_id,claim_id,submission_id,legal_review_id,organization_id,tenant_id,
          dealer_profile_id,claimant_user_id,activated_by)
          VALUES ('ZW-DEAL-0001','${uuid(7701)}','${anySubmission}','${r6Tenant.lr}','probe-org','${r6Tenant.t}',
          '${uuid(7704)}','coireviewer','${conflicted}')`,
        `INSERT INTO dealer_full_storefront_review_events(seed_dealer_id,link_id,reviewer_user_id,disposition,public_name,
          public_city,approved_branch_snapshot,dealer_declared_sections,reviewer_reason)
          VALUES ('ZW-DEAL-0001','${r6Tenant.l}','${conflicted}','RETRACTED','Probe','Harare','[]','{}','${longWhy}')`,
        `INSERT INTO dealer_storefront_media_review_events(media_id,seed_dealer_id,tenant_id,reviewer_user_id,decision,rationale)
          VALUES ('${mediaRow}','ZW-DEAL-0001','${r6Tenant.t}','${conflicted}','REJECTED','${longWhy}')`,
        `INSERT INTO dealer_operating_lifecycle_events(link_id,seed_dealer_id,action,reviewer_user_id,reason,
          previous_operating_status,next_operating_status,previous_legal_review_id,next_legal_review_id)
          VALUES ('${r6Tenant.l}','ZW-DEAL-0001','WITHDRAW','${conflicted}','${longWhy}','SUSPENDED','WITHDRAWN',
          '${r6Tenant.lr}','${r6Tenant.lr}')`,
        `INSERT INTO dealer_research_publication_events(seed_dealer_id,revision,decision,reviewer_id,review_reason)
          VALUES ('ZW-DEAL-0001',999,'SUPPRESSED','${conflicted}','${longWhy}')`,
      ];
      for(const sql of ledgerWrites)await fails(sql,'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
      // Through the real RPCs as well (whole decision rolled back; nothing recorded).
      await fails(`SELECT dealer_record_research_publication_review('ZW-DEAL-0001','${conflicted}','WITHHELD','${pubWhy}')`,
        'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
      await fails(`SELECT dealer_review_full_storefront_publication('ZW-DEAL-0001','${conflicted}','RETRACTED',
        ARRAY[]::uuid[],ARRAY[]::text[],'${longWhy}')`,'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
      await fails(`SELECT dealer_issue_storefront_media_review_ticket('${'1'.repeat(32)}','${'2'.repeat(64)}','${conflicted}',
        'ZW-DEAL-0001','${mediaRow}'::uuid,'STOREFRONT_MEDIA_PREVIEW',(now()+interval '5 minutes'))`,
        conflicted==='coireviewer'?'DEALER_REVIEWER_CONFLICT_OF_INTEREST':'INDEPENDENT_MEDIA_REVIEWER_REQUIRED');
    }
    // A rival claimant-reviewer cannot dispose of the competing claim either.
    await fails(`SELECT dealer_record_independent_claim_review('${uuid(2)}','coireviewer','CLAIM_DISPUTED',
      '${longWhy}',NULL,NULL,NULL)`,'DEALER_REVIEWER_CONFLICT_OF_INTEREST');
    assert.equal((await query(`SELECT count(*)::int AS n FROM dealer_claim_review_events WHERE reviewer_user_id IN ('coireviewer','staffreviewer')`)).rows[0].n,0);
    assert.equal((await query(`SELECT count(*)::int AS n FROM dealer_research_publication_events WHERE reviewer_id IN ('coireviewer','staffreviewer')`)).rows[0].n,0);
    console.log('DEALER_R6_REVIEWER_CONFLICT_OF_INTEREST PASS: own-claim and tenant-member reviewers refused on 8 decision ledgers + RPCs; unconflicted reviewers unaffected');

    // ── #8c hardened ticket custody: server clock, bounded TTL, supersede, outstanding cap ──
    const issue=(jti,hash,who,media,op,exp)=>query(
      'SELECT dealer_issue_storefront_media_review_ticket($1,$2,$3,$4,$5::uuid,$6,$7::timestamptz) AS r',
      [jti,hash,who,'ZW-DEAL-0001',media,op,exp]);
    const consume=(jti,hash,who,op,pnow=null)=>query(
      'SELECT dealer_consume_storefront_media_review_ticket($1,$2,$3,$4,$5,$6::timestamptz) AS r',
      [jti,hash,who,'ZW-DEAL-0001',op,pnow]);
    const hex=(i,len)=>i.toString(16).padStart(len,'0');
    await exec('DELETE FROM dealer_storefront_media_review_tickets');
    const far=(await issue(hex(1,32),hex(1,64),reviewer,mediaRow,'STOREFRONT_MEDIA_PREVIEW',
      new Date(Date.now()+86400000).toISOString())).rows[0].r;
    assert.ok(new Date(far.expires_at).getTime()<=Date.now()+10*60000+5000,'TTL bounded to 10 minutes by the DB clock');
    await fails(`SELECT dealer_issue_storefront_media_review_ticket('${hex(2,32)}','${hex(2,64)}','${reviewer}','ZW-DEAL-0001',
      '${mediaRow}'::uuid,'STOREFRONT_MEDIA_PREVIEW',(now()-interval '1 second'))`,'INVALID_MEDIA_REVIEW_TICKET_GRANT');
    // Supersede: the newer grant for the same (reviewer,item,op) is the only live one.
    await issue(hex(3,32),hex(3,64),reviewer,mediaRow,'STOREFRONT_MEDIA_PREVIEW',new Date(Date.now()+300000).toISOString());
    await fails(`SELECT dealer_consume_storefront_media_review_ticket('${hex(1,32)}','${hex(1,64)}','${reviewer}','ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW')`,
      'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
    assert.equal((await consume(hex(3,32),hex(3,64),reviewer,'STOREFRONT_MEDIA_PREVIEW')).rows[0].r.target_row_id,mediaRow);
    // Server clock only: a short ticket expires on the DB clock even when the app claims an old p_now.
    await issue(hex(4,32),hex(4,64),reviewer,mediaRow,'STOREFRONT_MEDIA_DECISION',new Date(Date.now()+1200).toISOString());
    await new Promise(r=>setTimeout(r,1600));
    await fails(`SELECT dealer_consume_storefront_media_review_ticket('${hex(4,32)}','${hex(4,64)}','${reviewer}','ZW-DEAL-0001',
      'STOREFRONT_MEDIA_DECISION','2000-01-01T00:00:00Z'::timestamptz)`,'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
    // Conflict of interest re-checked at use time: a claim made after the grant voids the ticket.
    await issue(hex(5,32),hex(5,64),'lateconflict',mediaRow,'STOREFRONT_MEDIA_PREVIEW',new Date(Date.now()+300000).toISOString());
    await exec(`INSERT INTO dealer_research_claim_requests(claim_id,seed_dealer_id,claimant_user_id,claimed_scope,
      representative_relationship,asserted_legal_business_name,claim_statement)
      VALUES ('${uuid(7705)}','ZW-DEAL-0001','lateconflict','BRANCH','LEGAL_OWNER','Late Rival Co',
        'A reviewer who files a claim after receiving a ticket must not be able to use it.')`);
    await fails(`SELECT dealer_consume_storefront_media_review_ticket('${hex(5,32)}','${hex(5,64)}','lateconflict','ZW-DEAL-0001','STOREFRONT_MEDIA_PREVIEW')`,
      'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID');
    // Outstanding cap: 48 media items × 2 operations = 96 live tickets; the 97th is refused.
    await exec('DELETE FROM dealer_storefront_media_review_tickets');
    await exec(`INSERT INTO dealer_storefront_media_items(seed_dealer_id,link_id,tenant_id,dealer_profile_id,branch_id,uploaded_by,
      storage_bucket,storage_path,content_sha256,mime_type,file_bytes,scan_state,media_category,caption,alt_text,rights_attestation)
      SELECT seed_dealer_id,link_id,tenant_id,dealer_profile_id,branch_id,uploaded_by,storage_bucket,
        'dealership-media/r6-cap-'||g||'.png',lpad(to_hex(g),64,'0'),mime_type,file_bytes,scan_state,media_category,caption,alt_text,rights_attestation
      FROM dealer_storefront_media_items, generate_series(1,49) g WHERE media_id='${mediaRow}'`);
    const capItems=(await query("SELECT media_id::text AS m FROM dealer_storefront_media_items WHERE storage_path LIKE 'dealership-media/r6-cap-%' ORDER BY storage_path")).rows.map(r=>r.m);
    assert.equal(capItems.length,49);
    let n=100;
    const exp5=new Date(Date.now()+300000).toISOString();
    for(const m of capItems.slice(0,48)){
      for(const op of ['STOREFRONT_MEDIA_PREVIEW','STOREFRONT_MEDIA_DECISION']){n+=1;await issue(hex(n,32),hex(n,64),reviewer,m,op,exp5);}
    }
    // Re-issuing for an already-held item supersedes rather than accumulates (queue reloads stay bounded).
    n+=1;await issue(hex(n,32),hex(n,64),reviewer,capItems[0],'STOREFRONT_MEDIA_PREVIEW',exp5);
    assert.equal((await query(`SELECT count(*)::int AS n FROM dealer_storefront_media_review_tickets
      WHERE reviewer_id=$1 AND consumed_at IS NULL`,[reviewer])).rows[0].n,96);
    n+=1;
    await fails(`SELECT dealer_issue_storefront_media_review_ticket('${hex(n,32)}','${hex(n,64)}','${reviewer}','ZW-DEAL-0001',
      '${capItems[48]}'::uuid,'STOREFRONT_MEDIA_PREVIEW','${exp5}'::timestamptz)`,'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT');
    // Another reviewer's budget is independent.
    n+=1;await issue(hex(n,32),hex(n,64),'activationreviewer',capItems[48],'STOREFRONT_MEDIA_PREVIEW',exp5);
    await exec('DELETE FROM dealer_storefront_media_review_tickets');
    await exec("DELETE FROM dealer_storefront_media_items WHERE storage_path LIKE 'dealership-media/r6-cap-%'");
    console.log('DEALER_R6_TICKET_HARDENING PASS: search_path pinned, TTL≤10min on DB clock, p_now ignored, supersede on re-issue, use-time conflict re-check, 96 outstanding/reviewer cap');

    // ── #5 per-reviewer step-up lockout ──
    const begin=async(who)=>(await query('SELECT dealer_begin_reviewer_step_up($1) AS r',[who])).rows[0].r;
    const complete=async(who,ok)=>(await query('SELECT dealer_complete_reviewer_step_up($1,$2) AS r',[who,ok])).rows[0].r;
    await fails(`SELECT dealer_begin_reviewer_step_up('nobody-r6')`,'REVIEWER_STEP_UP_SUBJECT_REQUIRED');
    await fails(`SELECT dealer_complete_reviewer_step_up('legalreviewer',false)`,'REVIEWER_STEP_UP_NOT_STARTED');
    for(let i=1;i<=5;i+=1){
      const g=await begin('legalreviewer');
      assert.equal(g.allowed,true);assert.equal(g.attempt,i);
      const done=await complete('legalreviewer',false);
      assert.equal(done.locked,i===5,'the fifth failure locks the account');
    }
    const locked=await begin('legalreviewer');
    assert.equal(locked.allowed,false);
    assert.ok(locked.retry_after_seconds>800&&locked.retry_after_seconds<=900);
    assert.equal((await begin('policyreviewer')).allowed,true,'lockout is per account, not global');
    await complete('policyreviewer',true);
    // Lock expiry (simulated on the stored clock) restores a fresh window.
    await exec(`UPDATE dealer_reviewer_step_up_guard SET locked_until=clock_timestamp()-interval '1 second' WHERE reviewer_user_id='legalreviewer'`);
    const after=await begin('legalreviewer');
    assert.equal(after.allowed,true);assert.equal(after.attempt,1);
    await complete('legalreviewer',true);
    // Success paths never lock: 4 failures, success resets, then 25 successes.
    for(let i=0;i<4;i+=1){await begin('activationreviewer');await complete('activationreviewer',false);}
    await begin('activationreviewer');await complete('activationreviewer',true);
    for(let i=0;i<25;i+=1){assert.equal((await begin('activationreviewer')).allowed,true);await complete('activationreviewer',true);}
    assert.equal((await query(`SELECT attempts_in_window,locked_until FROM dealer_reviewer_step_up_guard WHERE reviewer_user_id='activationreviewer'`)).rows[0].attempts_in_window,0);
    // Reservations are taken BEFORE verification: 5 unfinished attempts block a 6th (parallel guessing bound).
    for(let i=0;i<5;i+=1)assert.equal((await begin('coireviewer')).allowed,true);
    assert.equal((await begin('coireviewer')).allowed,false);
    // The API role can execute the RPCs but never read or rewrite the counters.
    await exec('SET ROLE service_role');
    await fails('SELECT * FROM dealer_reviewer_step_up_guard','permission denied');
    await fails("UPDATE dealer_reviewer_step_up_guard SET locked_until=NULL","permission denied");
    await exec('RESET ROLE');
    if(native){
      const clients=await Promise.all(Array.from({length:10},async()=>{
        const c=new pg.Client({connectionString:nativeUrl,ssl:false});await c.connect();return c;}));
      try{
        const results=await Promise.all(clients.map(c=>c.query("SELECT dealer_begin_reviewer_step_up('staffreviewer') AS r")));
        const allowed=results.filter(r=>r.rows[0].r.allowed===true).length;
        assert.equal(allowed,5,'10 parallel step-up attempts on separate sessions: exactly 5 reserved, 5 refused');
      }finally{await Promise.all(clients.map(c=>c.end()))}
      console.log('DEALER_R6_NATIVE_PARALLEL_STEP_UP PASS: 10 concurrent sessions → exactly 5 attempts reserved');
    }
    console.log('DEALER_R6_STEP_UP_LOCKOUT PASS: 5 failures/15 min per reviewer → 15 min lock; per-account; success resets; reservations bound parallel guesses; counters unreadable by API role');

    // Down refuses while R6 custody exists; then clean up the R6 probes for the rollback test.
    await fails(read(r6).down,'CANNOT_ROLLBACK_WITH_DEALER_R6_SECURITY_CUSTODY');
    await exec('DELETE FROM dealer_research_publication_policy_authority');
    await fails(read(r6).down,'CANNOT_ROLLBACK_WITH_DEALER_R6_SECURITY_CUSTODY');
    await exec('TRUNCATE dealer_reviewer_step_up_guard');
    await exec(`DELETE FROM tenant_users WHERE user_id='staffreviewer'`);
    await exec(`DELETE FROM dealer_research_claim_requests WHERE claim_id IN ('${uuid(7701)}','${uuid(7705)}')`);
  }

  // Dispose R5 custody tables before rollback test (after proving CANNOT_ROLLBACK_WITH_DEALER_R5_CUSTODY above).
  await exec('TRUNCATE dealer_storefront_media_review_tickets, dealer_storefront_media_review_events, dealer_storefront_media_items, dealer_research_duplicate_redirects, dealer_research_correction_review_events');
  await exec('TRUNCATE dealer_research_duplicate_redirects, dealer_research_grouping_review_events, dealer_research_public_contact_events');
  await exec('TRUNCATE dealer_staff_branch_scope_events, dealer_staff_branch_scopes, dealer_staff_invitation_events, dealer_staff_invitation_records');
  await exec('TRUNCATE dealer_canonical_inquiry_progress_events');
  await exec('TRUNCATE dealer_full_storefront_review_events');
  await exec('TRUNCATE dealer_operational_declaration_events');
  await exec('TRUNCATE dealer_transaction_feedback_review_events, dealer_transaction_feedback_cases');
  const withdrawnDealer=(await query('SELECT dealer_record_operating_lifecycle_decision($1,$2,$3,$4,NULL) AS r',
    ['ZW-DEAL-0001',reviewer,'WITHDRAW','Fictional CI permanent withdrawal of the synthetic dealer after its claim was revoked.'])).rows[0].r;
  assert.equal(withdrawnDealer.operating_status,'WITHDRAWN');
  await exec(`UPDATE dealer_research_claim_requests SET claim_status='CLAIM_DISPUTED' WHERE claim_id='${uuid(1)}'`);
  assert.equal((await query('SELECT operating_status FROM dealer_approved_seed_links')).rows[0].operating_status,'WITHDRAWN');
  await fails(`SELECT dealer_record_operating_lifecycle_decision('ZW-DEAL-0001','activationreviewer','REINSTATE',
    'Fictional CI attempt to reinstate a permanently withdrawn synthetic dealer must fail.',NULL)`,
    'ONLY_SUSPENDED_DEALER_CAN_BE_REINSTATED');
  console.log('DEALER_R4_REVIEW_FIXES PASS: withdrawn stays terminal, legacy reinstatement refused, renewal separation, quarantine kept, seller-authority independence, transfer-out allowed, policy/membership lapses withdraw');
  await exec('TRUNCATE dealer_listing_authority_events, dealer_vehicle_branch_assignments, dealer_operating_lifecycle_events');
  // ── R6 DBA #6: the three earliest Downs refuse while their custody rows exist (before any DDL) ──
  const custodyRows=(await query(`SELECT
    (SELECT count(*)::int FROM dealer_research_seed_records) AS seeds,
    (SELECT count(*)::int FROM dealer_research_publication_events) AS publication_events,
    (SELECT count(*)::int FROM dealer_research_claim_requests) AS claims,
    (SELECT count(*)::int FROM dealer_research_correction_requests) AS corrections`)).rows[0];
  for(const [k,n] of Object.entries(custodyRows))assert.ok(n>0,'R6 custody fixture must hold '+k+' rows (no vacuous refusal)');
  await fails(read('20261103122000_dealer_research_correction_requests.sql').down,
    'CANNOT_ROLLBACK_WITH_RESEARCH_CORRECTION_REQUESTS');
  await fails(read('20261103121000_dealer_research_review_and_claim_intake.sql').down,
    'CANNOT_ROLLBACK_WITH_DEALER_CLAIM_REQUESTS');
  await fails(read('20261103120000_dealer_research_seed_candidates.sql').down,
    'CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY');
  assert.equal((await query('SELECT count(*)::int AS n FROM dealer_research_correction_requests')).rows[0].n,
    custodyRows.corrections,'a refused Down changed nothing');
  await exec('TRUNCATE dealer_research_claim_requests CASCADE');
  await fails(read('20261103121000_dealer_research_review_and_claim_intake.sql').down,
    'CANNOT_ROLLBACK_WITH_RESEARCH_PUBLICATION_LEDGER');
  // The append-only ledger alone (no current public profile row) still holds custody.
  await exec('TRUNCATE dealer_research_public_profiles CASCADE');
  await fails(read('20261103121000_dealer_research_review_and_claim_intake.sql').down,
    'CANNOT_ROLLBACK_WITH_RESEARCH_PUBLICATION_LEDGER');
  await exec('TRUNCATE dealer_research_correction_requests CASCADE');
  await exec('TRUNCATE dealer_research_publication_events CASCADE');
  await fails(read('20261103120000_dealer_research_seed_candidates.sql').down,
    'CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY');
  await exec('TRUNCATE dealer_research_seed_records CASCADE');
  console.log('DEALER_R6_ROLLBACK_CUSTODY PASS: 120000/121000/122000 Downs refuse with seed, claim, publication-ledger and correction custody ('+
    JSON.stringify(custodyRows)+')');
  for(const name of [...names].reverse()){await exec(read(name).down);console.log('ROLLED_BACK',name)}
  // R6 DBA #6: rolling back 20261103125000 must NOT restore the legacy table-wide self-grant.
  assert.equal((await query("SELECT has_table_privilege('authenticated','dealer_profiles','UPDATE') AS allowed")).rows[0].allowed,false,
    'rollback must not re-open table-wide UPDATE on dealer_profiles');
  assert.equal((await query("SELECT has_table_privilege('authenticated','dealer_profiles','INSERT') AS allowed")).rows[0].allowed,false,
    'rollback must not re-open table-wide INSERT on dealer_profiles');
  for(const column of ['tenant_id','identity_status','compliance_review_state','active_state','suspension_state']){
    assert.equal((await query("SELECT has_column_privilege('authenticated','dealer_profiles',$1,'UPDATE') AS allowed",[column])).rows[0].allowed,false,
      'rollback must not re-open authenticated UPDATE of '+column);
  }
  console.log('DEALER_R6_ROLLBACK_PRIVILEGES PASS: full rollback retained the dealer_profiles self-grant barrier (0 table-wide grants, 0 authority-column grants)');
  // R6 DBA #7 (native only): with a concurrent writer holding ROW EXCLUSIVE on the canonical table,
  // the migration's own lock_timeout fails it with 55P03 in ~3 s and leaves nothing behind. The
  // session starts at lock_timeout=0; statement_timeout=15s only bounds a mutant that waits forever.
  // Every dealership migration that locks a canonical table bounds its lock wait (the three exempt
  // ones create only new dealer_* objects and functions, with no canonical FK, trigger or policy).
  const noCanonicalLocks=['20261103120000','20261103122000','20261103124000'];
  for(const name of names){
    const bounded=/^\s*SET lock_timeout = '3s';/m.test(read(name).up);
    assert.equal(bounded,!noCanonicalLocks.includes(name.slice(0,14)),`${name}: lock_timeout presence`);
  }
  const lockTimeoutProbes=native?{
    '20261103125000_dealer_profile_self_grant_hardening.sql':'dealer_profiles',
    '20261103138000_dealer_branch_operating_details.sql':'dealer_branches',
    '20261103141000_dealer_canonical_listing_authority.sql':'vehicles',
  }:{};
  for(const name of names){
    const table=lockTimeoutProbes[name];
    if(table){
      const writer=new pg.Client({connectionString:nativeUrl,ssl:false,application_name:'carup-dealer-r6-lock-timeout-writer'});
      await writer.connect();
      try{
        await writer.query('BEGIN');
        await writer.query(`LOCK TABLE ${table} IN ROW EXCLUSIVE MODE`);
        const catalog=async()=>(await query(`SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS rels,
          (SELECT count(*)::int FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped) AS cols,
          (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS procs,
          (SELECT count(*)::int FROM pg_policy) AS policies`)).rows[0];
        const before=await catalog();
        await exec("SET lock_timeout = 0; SET statement_timeout = '15s'");
        const started=Date.now();let error=null;
        try{await exec(read(name).up)}catch(e){error=e}
        const elapsed=Date.now()-started;
        await exec('RESET statement_timeout');
        assert.equal(error?.code,'55P03',`${name}: expected lock_timeout (55P03), got ${error?.code} ${error?.message}`);
        assert.ok(elapsed>=2500&&elapsed<10000,`${name}: lock_timeout fired after ${elapsed} ms`);
        assert.deepEqual(await catalog(),before,`${name}: a lock-timed-out migration leaves no partial schema`);
        console.log('DEALER_R6_LOCK_TIMEOUT PASS:',name,'refused with 55P03 after',elapsed,'ms behind a writer on',table);
      }finally{await writer.query('ROLLBACK');await writer.end()}
    }
    await exec(read(name).up);console.log('REAPPLIED',name);
  }
  console.log((native?'DEALER_NATIVE_POSTGRES_RESULT PASS: ':'DEALER_PGLITE_RESULT PASS: ')+
    '22 migration apply/rollback/reapply, canonical dealer listing authority, C12 lifecycle, R5 media/corrections/redirects/concurrency, scoped staff grants, no anon private read, independent review, dispute, appeal and versioned intake');
  } // End full destructive synthetic contract suite; fresh schema mode stays empty.
}catch(error){
  console.error(native?'DEALER_NATIVE_POSTGRES_RESULT FAIL':'DEALER_PGLITE_RESULT FAIL',error);
  fatalError=error;
}finally{if(native)await db.end();else await db.close()}
// A caught migration error MUST terminate GitHub CI as a failing step.
if(fatalError)throw fatalError;
