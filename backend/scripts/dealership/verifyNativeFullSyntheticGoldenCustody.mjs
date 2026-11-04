/**
 * Final PostgreSQL readback for a COMPLETE FICTIONAL / CI-ONLY dealership
 * lifecycle with a clearly labelled synthetic country policy.
 * No real dealer, government approval, public rollout, merchant or VIN sale.
 *
 * Must run only after physical browser UI: claim, real scanned originals,
 * independent preliminary/legal/activation and reviewed same-slug storefront.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import pg from 'pg';
import {assertLocalDatabase} from './importResearchSeed.mjs';

const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const dbHost=new URL(url);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(dbHost.hostname));
assert.equal(dbHost.pathname,'/carup_dealer_isolated_ci');
assert.equal(dbHost.search,'');
assert.equal(dbHost.hash,'');
const fixtureFile=process.env.DEALER_BROWSER_FIXTURE_JSON;
assert.ok(fixtureFile);
const f=JSON.parse(readFileSync(fixtureFile,'utf8'));
assert.equal(f.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(f.source_population,104);
assert.equal(f.synthetic_legal_policy_provenance,'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY');
assert.ok(f.synthetic_legal_policy_version.startsWith('CARUP_SYNTHETIC_CI_'));
for(const key of ['CARUP_DEALER_RESEARCH_XLSX','DEALER_SEED_DATABASE_URL','SUPABASE_URL']){
 assert.equal(process.env[key],undefined,'shared original data/DB forbidden');
}
const db=new pg.Client({connectionString:url,ssl:false,
 application_name:'carup-physical-fictional-full-journey-immutable-custody'});
await db.connect();
try{
 const seed=await db.query(`SELECT COUNT(*)::int AS n FROM dealer_research_seed_records`);
 assert.equal(seed.rows[0].n,104);
 const company=await db.query(`SELECT c.claim_id,c.claimant_user_id,c.claim_status,
    r.public_slug,l.tenant_id,l.dealer_profile_id,l.organization_id,l.activated_by,
    l.operating_status,l.legal_review_id
   FROM dealer_research_claim_requests c
   JOIN dealer_research_public_profiles r USING(seed_dealer_id)
   JOIN dealer_approved_seed_links l ON l.claim_id=c.claim_id
   WHERE c.seed_dealer_id=$1`,[f.seed]);
 assert.equal(company.rowCount,1);
 const row=company.rows[0];
 assert.equal(row.public_slug,f.public_slug);
 assert.equal(row.claimant_user_id,f.actors.claimant.id);
 assert.equal(row.claim_status,'CLAIM_APPROVED');
 assert.equal(row.activated_by,f.actors.activator.id);
 assert.equal(row.operating_status,'ACTIVE');
 const legal=await db.query(`SELECT reviewer_user_id,claimant_user_id,
   policy_version,verdict,submission_id,legal_expires_at
   FROM dealer_legal_application_reviews WHERE legal_review_id=$1`,
   [row.legal_review_id]);
 assert.equal(legal.rowCount,1);
 assert.equal(legal.rows[0].reviewer_user_id,f.actors.legalReviewer.id);
 assert.equal(legal.rows[0].claimant_user_id,f.actors.claimant.id);
 assert.equal(legal.rows[0].policy_version,f.synthetic_legal_policy_version);
 assert.equal(legal.rows[0].verdict,'COMPLIANCE_APPROVED');
 const prelim=await db.query(`SELECT reviewer_user_id,verdict
   FROM dealer_claim_compliance_review_events WHERE submission_id=$1`,
   [legal.rows[0].submission_id]);
 assert.deepEqual(prelim.rows,[{reviewer_user_id:f.actors.reviewer.id,
   verdict:'READY_FOR_REGULATORY_REVIEW'}]);
 assert.equal(new Set([f.actors.claimant.id,f.actors.reviewer.id,
   f.actors.legalReviewer.id,f.actors.activator.id,'policyreviewer']).size,5);
 const policy=await db.query(`SELECT policy_state,approved_by
   FROM dealer_country_legal_policy_authority
   WHERE country_code='ZW' AND policy_version=$1`,
   [f.synthetic_legal_policy_version]);
 assert.deepEqual(policy.rows,[{policy_state:'APPROVED',approved_by:'policyreviewer'}]);
 // This is explicitly fake: the canonical DRAFT policy remains untouched.
 const realDraft=await db.query(`SELECT policy_state
   FROM dealer_country_legal_policy_authority
   WHERE country_code='ZW' AND policy_version='CARUP_DEALER_ZW_DRAFT_2026_11_03'`);
 assert.equal(realDraft.rows[0]?.policy_state,'DRAFT');
 const docs=await db.query(`SELECT document_class,scan_state,storage_path
   FROM dealer_claim_private_evidence WHERE claim_id=$1`,[row.claim_id]);
 assert.equal(docs.rowCount,2);
 assert.deepEqual(new Set(docs.rows.map(x=>x.document_class)),
   new Set(['COMPANY_REGISTRATION','SIGNATORY_MANDATE']));
 assert.ok(docs.rows.every(x=>x.scan_state==='CLEAN_CLAMAV_AT_UPLOAD'&&
   x.storage_path.startsWith('dealership-claims/')));
 const canonical=await db.query(`SELECT
   (SELECT count(*)::int FROM tenants WHERE id=$1) AS tenants,
   (SELECT count(*)::int FROM organizations WHERE id=$2 AND tenant_id=$1) AS organizations,
   (SELECT count(*)::int FROM tenant_users WHERE user_id=$3 AND tenant_id=$1
    AND role='dealer') AS owner_memberships,
   (SELECT role FROM users WHERE id=$3) AS global_role,
   (SELECT count(*)::int FROM dealer_profiles WHERE id=$4 AND tenant_id=$1::text) AS dealer_profiles
  `,[row.tenant_id,row.organization_id,f.actors.claimant.id,row.dealer_profile_id]);
 assert.deepEqual(canonical.rows[0],{
  tenants:1,organizations:1,owner_memberships:1,global_role:'member',dealer_profiles:1,
 });
 const branches=await db.query(`SELECT id,name,address,latitude,longitude,
   opening_hours_text FROM dealer_branches WHERE dealer_id=$1`,
  [row.dealer_profile_id]);
 assert.ok(branches.rowCount>=2);
 const added=branches.rows.find(b=>b.name==='FICTIONAL SECOND YARD - PRIVATE ONLY');
 assert.ok(added,'physical browser must persist the second canonical branch');
 assert.equal(added.address,'TEST STREET 2 - NOT A REAL PUBLIC ADDRESS');
 assert.equal(Number(added.latitude),-17.829);
 assert.equal(Number(added.longitude),31.052);
 const publication=await db.query(`SELECT seed_dealer_id,public_slug,
   approved_branch_snapshot FROM dealer_full_storefront_current
   WHERE seed_dealer_id=$1`,[f.seed]);
 assert.equal(publication.rowCount,1);
 assert.equal(publication.rows[0].public_slug,f.public_slug);
 assert.ok(publication.rows[0].approved_branch_snapshot.length>=1);
 const events=await db.query(`SELECT reviewer_user_id,disposition FROM
   dealer_full_storefront_review_events WHERE seed_dealer_id=$1`,[f.seed]);
 assert.equal(events.rows.at(-1)?.disposition,'PUBLISHED_FULL');
 assert.equal(events.rows.at(-1)?.reviewer_user_id,f.actors.reviewer.id);
 const report={
  authority:'CARUP-DEALER-ONB-001-LR01-R2-FICTIONAL_LOCAL_FULL_PHYSICAL',
  head:process.env.GITHUB_SHA||'LOCAL_UNVERIFIED_HEAD',
  all_source_records:104,source_kind:'EXPLICITLY_FICTIONAL_NOT_OWNER_XLSX',
  source_original_checksum_imported:false,
  real_national_legal_policy_approved:false,
  synthetic_policy:f.synthetic_legal_policy_version,
  synthetic_policy_approved_only_in_ephemeral_CI:true,
  genuine_local_storage_files:docs.rowCount,
  genuine_malware_scanned_files:docs.rowCount,
  independent_authenticated_actors:5,
  canonical_tenants:canonical.rows[0].tenants,
  canonical_organizations:canonical.rows[0].organizations,
  canonical_dealer_memberships:canonical.rows[0].owner_memberships,
  original_global_role:canonical.rows[0].global_role,
  branches_persisted:branches.rowCount,
  public_slug_before_and_after:f.public_slug,
  reviewed_full_public_projection:true,
  actual_authorized_VIN_listings_certified:false,
  actual_payment_collection_certified:false,
  actual_real_dealer_pilot_certified:false,
  independent_real_human_certification:false,
  real_business_publication:false,
 };
 const out='web/test-results/fictional-full-native-golden-custody.json';
 mkdirSync(dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('DEALER_FICTIONAL_FULL_NATIVE_SQL_CUSTODY PASS: exact 104 fictional source IDs, two real scanned originals, independent preliminary/legal/activator, canonical org/tenant/member, two branches and identical upgraded public URL; all approvals CI-only FICTIONAL');
}finally{await db.end()}
