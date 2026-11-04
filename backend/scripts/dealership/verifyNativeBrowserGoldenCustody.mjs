/**
 * CARUP-DEALER-ONB-001 LR01-R2 — exact-head physical browser SQL custody
 * verifier, run AFTER the real Chromium/Express/PostgREST/Storage journey.
 *
 * Only a disposable, guarded localhost PostgreSQL database and explicitly
 * fictional actor fixture are accepted. This intentionally does not assert
 * business licensing, dealer activation, real 104-source publication, PAYNOW,
 * seller rights, or legal certification.
 */
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import pg from 'pg';
import {assertLocalDatabase} from './importResearchSeed.mjs';

const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const parsed=new URL(url);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));
assert.equal(parsed.pathname,'/carup_dealer_isolated_ci');
assert.equal(parsed.search,'');
assert.equal(parsed.hash,'');
assert.ok(process.env.DEALER_BROWSER_FIXTURE_JSON);
for(const name of ['CARUP_DEALER_RESEARCH_XLSX','DEALER_SEED_DATABASE_URL',
  'SUPABASE_URL']){
  assert.equal(process.env[name],undefined,'shared input is not permitted: '+name);
}
// The disposable HTTP bridge uses the locally signed Storage service JWT.
// Reject arbitrary/shared/production credentials rather than requiring its
// absence: the browser step must legitimately carry this ephemeral token.
const token=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const secret=process.env.DEALER_BROWSER_LOCAL_JWT_SECRET||'';
assert.ok(secret.startsWith('EXPLICITLY_FAKE_EPHEMERAL_CARUP_DEALER_BROWSER_CI_KEY_'),
  'only the synthetic test secret is accepted');
const parts=token.split('.');
assert.equal(parts.length,3,'ephemeral service token is required');
const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
assert.equal(header.alg,'HS256');
assert.equal(claims.iss,'carup-dealer-ephemeral-ci');
assert.equal(claims.role,'service_role');
assert.ok(Number(claims.exp)>Math.floor(Date.now()/1000));
const actual=Buffer.from(parts[2],'base64url');
const expected=createHmac('sha256',secret).update(parts[0]+'.'+parts[1]).digest();
assert.ok(actual.length===expected.length&&timingSafeEqual(actual,expected),
  'invalid or non-ephemeral Storage service credential');
const fixture=JSON.parse(readFileSync(process.env.DEALER_BROWSER_FIXTURE_JSON,'utf8'));
assert.equal(fixture.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(fixture.source_population,104);
const db=new pg.Client({connectionString:url,ssl:false,
  application_name:'carup-synthetic-native-physical-custody-readback'});
await db.connect();
try{
  const claimResult=await db.query(`SELECT claim_id,claim_status,claimant_user_id,
    seed_dealer_id FROM dealer_research_claim_requests
    WHERE seed_dealer_id=$1`,[fixture.seed]);
  assert.equal(claimResult.rowCount,1,'exactly one synthetic claim expected');
  const claim=claimResult.rows[0];
  assert.equal(claim.claimant_user_id,fixture.actors.claimant.id);
  assert.equal(claim.claim_status,'CLAIM_APPROVED');
  const source=await db.query(`SELECT seed_dealer_id FROM dealer_research_seed_records
    ORDER BY original_source_row`);
  assert.equal(source.rowCount,104);
  assert.equal(new Set(source.rows.map(r=>r.seed_dealer_id)).size,104);
  const published=await db.query(`SELECT seed_dealer_id,public_slug,publication_status
    FROM dealer_research_public_profiles`);
  assert.equal(published.rowCount,1);
  assert.equal(published.rows[0].seed_dealer_id,fixture.seed);
  assert.equal(published.rows[0].public_slug,fixture.public_slug);
  assert.equal(published.rows[0].publication_status,'PRELISTED_UNCLAIMED');
  const evidence=await db.query(`SELECT evidence_id,scan_state,content_sha256,storage_path
    FROM dealer_claim_private_evidence WHERE claim_id=$1`,[claim.claim_id]);
  assert.equal(evidence.rowCount,1,'real scanned file must have one DB custody row');
  assert.equal(evidence.rows[0].scan_state,'CLEAN_CLAMAV_AT_UPLOAD');
  assert.match(evidence.rows[0].content_sha256,/^[a-f0-9]{64}$/);
  assert.ok(evidence.rows[0].storage_path.startsWith('dealership-claims/'));
  // The real uploaded object must not be accessible from the public endpoint
  // just by knowing its path; querying a nonexistent object is not sufficient.
  const actualPath=evidence.rows[0].storage_path.split('/').map(encodeURIComponent).join('/');
  const unauthenticated=await fetch('http://127.0.0.1:54321/storage/v1/object/public/ocr-documents/'+actualPath);
  assert.notEqual(unauthenticated.status,200,
    'private uploaded original was readable without an authorization token');
  const reviews=await db.query(`SELECT reviewer_user_id,verdict,evidence_id
    FROM dealer_claim_review_events WHERE claim_id=$1`,[claim.claim_id]);
  assert.equal(reviews.rowCount,1);
  assert.equal(reviews.rows[0].reviewer_user_id,fixture.actors.reviewer.id);
  assert.equal(reviews.rows[0].verdict,'CLAIM_APPROVED');
  assert.equal(reviews.rows[0].evidence_id,evidence.rows[0].evidence_id);
  assert.notEqual(reviews.rows[0].reviewer_user_id,claim.claimant_user_id);
  const drafts=await db.query(`SELECT submission_version,state,content
    FROM dealer_claim_intake_drafts WHERE claim_id=$1`,[claim.claim_id]);
  assert.equal(drafts.rowCount,1);
  assert.equal(drafts.rows[0].submission_version,1);
  assert.equal(drafts.rows[0].content.tab_rows.BUSINESS[0].legal_name,
    'SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY');
  assert.equal(drafts.rows[0].content.tab_rows.BRANCHES[0].city,
    'FICTIONAL HARARE CORRECTED');
  const submissions=await db.query(`SELECT submission_id,intake_version
    FROM dealer_claim_compliance_submissions WHERE claim_id=$1`,[claim.claim_id]);
  assert.equal(submissions.rowCount,1);
  assert.equal(submissions.rows[0].intake_version,1);
  const activated=await db.query(`SELECT COUNT(*)::int AS n
    FROM dealer_approved_seed_links WHERE claim_id=$1`,[claim.claim_id]);
  assert.equal(activated.rows[0].n,0);
  const legal=await db.query(`SELECT COUNT(*)::int AS n
    FROM dealer_legal_application_reviews WHERE submission_id=$1`,
    [submissions.rows[0].submission_id]);
  assert.equal(legal.rows[0].n,0);
  const report={
    authority:'CARUP-DEALER-ONB-001-LR01-R2-SYNTHETIC_NATIVE_BROWSER_SQL_READBACK',
    source_class:'FICTIONAL_NOT_ORIGINAL_OWNER_XLSX',
    source_records:source.rowCount,public_research_profiles:published.rowCount,
    public_slug:published.rows[0].public_slug,
    claim_status:claim.claim_status,claimant_role:'fictional_claimant',
    claim_review_verdict:reviews.rows[0].verdict,
    independent_review_actor:'fictional_reviewer',
    private_scanned_originals:evidence.rowCount,
    private_storage_bytes_read_by_real_browser:true,
    persisted_workbook_version:drafts.rows[0].submission_version,
    corrected_business_name_persisted:true,
    corrected_branch_city_persisted:true,
    frozen_compliance_submissions:submissions.rowCount,
    independently_legal_certified:false,
    legal_approvals:legal.rows[0].n,
    canonical_dealer_activations:activated.rows[0].n,
    real_business_publication:false,payments_enabled:false,
    entire_golden_journey_completed:false,
  };
  const out=join('web','test-results','synthetic-native-golden-custody.json');
  mkdirSync(dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('DEALER_NATIVE_BROWSER_SQL_CUSTODY PASS: 104 fictional seeds; one public prelisting; one scanned private evidence; independent approved claim; prefilled edited workbook persisted; one frozen application; zero legal approval or activation');
}finally{await db.end()}
