/**
 * CARUP-DEALER-ONB-001 D0/D4: REAL PostgreSQL import proof with 104 *fictional*
 * source rows. Never substitutes for the exact original Owner-uploaded XLSX.
 *
 * Running in a disposable local PostgreSQL 17 DB after the 16 migration harness:
 * 1. Generates a physical 20-tab .xlsx buffer using ONLY public-safe ID/category/city
 *    distribution and explicitly fictional names, addresses and contacts.
 * 2. Parses it using the ACTUAL importer (not mocked workbook rows).
 * 3. Invokes commitCandidatesLocal on native PostgreSQL and physically reads all
 *    rows/categories/crosswalk back. Re-import must be an idempotent no-op.
 * 4. A one-row immutable conflict must ROLLBACK without changing any row.
 * 5. No legal entity, tenant, independent review or public profile is created.
 *
 * The original Owner SHA is intentionally *not* accepted for this synthetic XLSX.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import ExcelJS from 'exceljs';
import pg from 'pg';
import {
  SOURCE_TABS,DEV_TABS,ORIGINAL_HEADERS,
  parseResearchWorkbook,commitCandidatesLocal,assertLocalDatabase,
} from './importResearchSeed.mjs';

const fail=message=>{throw new Error('DEALER_SYNTHETIC_104_NATIVE_FAIL '+message)};
const dbUrl=process.env.DEALER_ISOLATED_POSTGRES_URL||'';
const parsed=new URL(assertLocalDatabase(dbUrl));
if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) ||
   parsed.pathname!=='/carup_dealer_isolated_ci'||parsed.search||parsed.hash){
  fail('unexpected database target, refusing any shared or non-disposable environment');
}
if(process.env.CARUP_DEALER_RESEARCH_XLSX||
   process.env.DEALER_SEED_DATABASE_URL||
   process.env.SUPABASE_URL||
   process.env.SUPABASE_SERVICE_ROLE_KEY){
  fail('owner-source/shared-runtime variables must be ABSENT');
}
const root=join(dirname(fileURLToPath(import.meta.url)),'..','..','tests','fixtures');
const manifest=JSON.parse(readFileSync(join(root,'dealer_source_104_safe_manifest.json'),'utf8'));
assert.equal(manifest.schema,'CARUP_DEALER_SOURCE_104_SAFE_MANIFEST_1');
assert.equal(manifest.not_publication_authority,true);
assert.equal(manifest.rows.length,104);

const workbook=new ExcelJS.Workbook();
for(const name of [...SOURCE_TABS,...DEV_TABS])workbook.addWorksheet(name);
const source=workbook.getWorksheet('Car Dealers Database');
const dev8=workbook.getWorksheet('DEV 8 - Seed Catalogue');
source.getRow(7).values=[...ORIGINAL_HEADERS];
workbook.getWorksheet('Dealer Profile Intake').getRow(1).getCell(40).value='Last Updated';
workbook.getWorksheet('Field Dictionary').getRow(129).getCell(4).value='Buyer Visibility';
for(const [idx,row] of manifest.rows.entries()){
  const n=idx+1,id='ZW-DEAL-'+String(n).padStart(4,'0');
  assert.equal(row.seed_id,id);
  assert.equal(row.row,n+7);
  // Absolutely no actual company name, phone, email, parent or trademark
  // from the 104 researched dealer businesses crosses this fixture boundary.
  const original=[
    'SYNTHETIC FICTIONAL CAR DEALER '+n,
    'Synthetic independent vehicle outlet',
    'Synthetic cars and services', 'Test Lot '+n+' (not a real address)',
    'Fictional Test Zone',row.city,
    'NO REAL PHONE','not-a-dealer@example.invalid',
    'FICTIONAL COMPANY — NO LEGAL PARENT',
    'https://example.invalid/fictional-dealer-'+n,id
  ];
  source.getRow(n+7).values=[...original];
  dev8.getRow(n+1).values=[
    id,...original.slice(0,10),row.category,
    'UNREVIEWED_PARENT_BRANCH_MATCH',
    'PENDING_HUMAN_SOURCE_ELIGIBILITY',
    'UNCLAIMED_NO_APPROVED_CLAIM',
    'PLACEHOLDER_UNTIL_RIGHTS_REVIEW',
    'NOT_PUBLISHED',
    'Fictional fixture; never a real claim',
    String(n+7),
    'RESEARCH_ONLY_NOT_LEGAL_ENTITY',
    'Synthetic CI only; no review'
  ];
}
// Serialize an actual 20-sheet .xlsx ZIP and reload it; mockWorkbook() is not used.
const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
const hash=createHash('sha256').update(bytes).digest('hex');
assert.notEqual(hash,manifest.original_source_sha256,
  'synthetic workbook must never masquerade as original Owner XLSX');
const reopened=new ExcelJS.Workbook();
await reopened.xlsx.load(bytes);
const {records,summary}=parseResearchWorkbook(reopened,hash);
assert.equal(records.length,104);
assert.equal(summary.verified_legal_companies,0);
assert.equal(summary.published_prelistings,0);
assert.equal(summary.groupings_verified,false);
assert.equal(summary.contacts_publicly_authorized,false);
assert.ok(records.every(x=>x.source_snapshot['Dealer / Company Name'].startsWith('SYNTHETIC FICTIONAL')));
assert.equal(records[0].seed_dealer_id,'ZW-DEAL-0001');
assert.equal(records.at(-1).seed_dealer_id,'ZW-DEAL-0104');

const db=new pg.Client({connectionString:dbUrl,ssl:false,application_name:'carup-dealer-synthetic-104-import-proof'});
await db.connect();
try{
  const version=Number((await db.query('SHOW server_version_num')).rows[0].server_version_num);
  assert.ok(version>=170000&&version<180000,'native PostgreSQL 17 is required');
  const prior=(await db.query(`SELECT
    (SELECT count(*)::int FROM dealer_research_seed_records) AS seeds,
    (SELECT count(*)::int FROM dealer_research_public_profiles) AS visible,
    (SELECT count(*)::int FROM dealer_profiles) AS legal,
    (SELECT count(*)::int FROM tenants) AS tenants
  `)).rows[0];
  assert.equal(prior.seeds,0,'only a clean disposable database may be used');
  const first=await commitCandidatesLocal(db,records);
  assert.deepEqual(first,{inserted:104,identical:0,read_back:104,public_profiles_created:0});
  const readback=(await db.query(`SELECT seed_dealer_id,original_source_row,
    proposed_source_category,grouping_review,publication_eligibility,
    claim_lifecycle,logo_rights_status,public_profile_state,candidate_record_state,
    source_workbook_sha256,source_row_sha256,source_snapshot
    FROM dealer_research_seed_records ORDER BY original_source_row`)).rows;
  assert.equal(readback.length,104);
  for(const [idx,row] of readback.entries()){
    const sourceRecord=records[idx];
    assert.equal(row.seed_dealer_id,sourceRecord.seed_dealer_id);
    assert.equal(row.original_source_row,sourceRecord.original_source_row);
    assert.equal(row.proposed_source_category,manifest.rows[idx].category);
    assert.equal(row.source_workbook_sha256,hash);
    assert.equal(row.source_row_sha256,sourceRecord.source_row_sha256);
    assert.equal(row.grouping_review,'UNREVIEWED_PARENT_BRANCH_MATCH');
    assert.equal(row.publication_eligibility,'PENDING_HUMAN_SOURCE_ELIGIBILITY');
    assert.equal(row.claim_lifecycle,'UNCLAIMED_NO_APPROVED_CLAIM');
    assert.equal(row.logo_rights_status,'PLACEHOLDER_UNTIL_RIGHTS_REVIEW');
    assert.equal(row.public_profile_state,'NOT_PUBLISHED');
    assert.equal(row.candidate_record_state,'RESEARCH_ONLY_NOT_LEGAL_ENTITY');
    assert.deepEqual(row.source_snapshot,sourceRecord.source_snapshot);
  }
  const groups=new Map();
  for(const row of readback)groups.set(row.proposed_source_category,(groups.get(row.proposed_source_category)||0)+1);
  assert.deepEqual(Object.fromEntries(groups),
    Object.fromEntries(
      Object.entries(summary.category_counts).sort(([a],[b])=>a.localeCompare(b))
    ));
  const second=await commitCandidatesLocal(db,records);
  assert.deepEqual(second,{inserted:0,identical:104,read_back:104,public_profiles_created:0});
  const changed=[{...records[0],source_row_sha256:'f'.repeat(64)},...records.slice(1)];
  await assert.rejects(commitCandidatesLocal(db,changed),/immutable source conflict/);
  const unchanged=await db.query(`SELECT count(*)::int AS count,
    count(*) FILTER(WHERE public_profile_state='NOT_PUBLISHED')::int AS private_count
    FROM dealer_research_seed_records`);
  assert.equal(unchanged.rows[0].count,104);
  assert.equal(unchanged.rows[0].private_count,104);
  const after=(await db.query(`SELECT
    (SELECT count(*)::int FROM dealer_research_public_profiles) AS visible,
    (SELECT count(*)::int FROM dealer_profiles) AS legal,
    (SELECT count(*)::int FROM tenants) AS tenants`)).rows[0];
  assert.deepEqual(after,{visible:prior.visible,legal:prior.legal,tenants:prior.tenants});
  console.log('DEALER_SYNTHETIC_104_NATIVE_RESULT PASS: PostgreSQL 17 · 20-tab physical XLSX · 104/104 source IDs/categories/crosswalk readback · 0 public/legal/tenant creation · identical reimport 104/104 · conflict rollback');
  console.log('DEALER_SYNTHETIC_104_SOURCE_STATUS: FICTIONAL_CI_FIXTURE; ORIGINAL_OWNER_XLSX_NOT_USED; ORIGINAL_SHA_NOT_CLAIMED');
}finally{
  await db.end();
}
