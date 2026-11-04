/**
 * CARUP-DEALER-ONB-001 D0/D4 research-source importer.
 * Reads the ATTACHED authoritative 20-sheet XLSX; never guesses 7 extra businesses.
 * Default: no database changes. Explicit commit-local mode is local-loopback only.
 * This does not certify sources, group legal entities, publish profiles or activate dealers.
 *
 * Usage:
 *   node backend/scripts/dealership/importResearchSeed.mjs '/secure/path/dealers.xlsx'
 *   DEALER_SEED_DATABASE_URL=postgresql://...@localhost:5432/carup_dealer_owner_original_isolated \
 *     node backend/scripts/dealership/importResearchSeed.mjs '/secure/path/dealers.xlsx' \
 *     --commit-local --expect-sha256=<literal 64-hex file checksum>
 *
 * Apply the additive migration to an ISOLATED LOCAL DB independently before commit-local.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import pg from 'pg';

export const SOURCE_TABS = Object.freeze([
  'Car Dealers Database', 'Database Schema & Expansion', 'START HERE',
  'Dealer Profile Intake', 'Verification Tracker', 'Evidence Register',
  'Buyer Assurance', 'Buyer Feedback Log', 'Field Dictionary', 'Data Quality',
]);
export const DEV_TABS = Object.freeze([
  'DEV 1 - Read Me', 'DEV 2 - Field Map', 'DEV 3 - Intake Tabs',
  'DEV 4 - Capabilities', 'DEV 5 - Gap Closure', 'DEV 6 - Money Flows',
  'DEV 7 - Test Matrix', 'DEV 8 - Seed Catalogue', 'DEV 9 - Claim Workflow',
  'DEV 10 - Seed Tests',
]);
export const ORIGINAL_HEADERS = Object.freeze([
  'Dealer / Company Name', 'Category / Dealer Type', 'Brands / Specialization',
  'Physical Address', 'Suburb / Area', 'City / Town', 'Phone / WhatsApp',
  'Email', 'Ownership / Parent Company / Key Principal',
  'Website / Source URL', 'Seed Dealer ID',
]);
const REQUIRED_SEED_CATEGORIES = new Set([
  'Official dealer / franchise label — UNVERIFIED',
  'Independent dealer claim', 'Importer / sourcing claim',
  'Importer / bonded / clearing claim', 'Premium / luxury dealer claim',
  'Dealer / seller claim — categorize in D0', 'Assembler / manufacturing claim',
  'Marketplace / brokerage claim', 'Dealer and service centre claim',
  'Commercial / heavy vehicle claim',
]);
// The connected native Google re-export is a different binary and may not
// silently replace the Owner's explicitly authorized original source bytes.
export const ORIGINAL_OWNER_SOURCE_SHA256 =
  'a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137';
export const ORIGINAL_OWNER_DISPOSABLE_DATABASE =
  'carup_dealer_owner_original_isolated';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const fail = (message) => { throw new Error('DEALER_SEED_REJECTED: ' + message); };

export function textCell(row, index) {
  let value = row.getCell(index).value;
  if (value == null) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (typeof value.result === 'string' || typeof value.result === 'number') value = value.result;
    else if (typeof value.text === 'string') value = value.text;
    else fail('unsupported cell type at ' + row.number + ':' + index);
  }
  if (value instanceof Date) value = value.toISOString();
  if (!['string', 'number', 'boolean'].includes(typeof value)) fail('invalid cell value');
  return String(value).trim();
}

/**
 * D0/D4: collision signals from private source candidates, not legal matching.
 * Never use these hints to auto-merge organizations, publish a profile, prove
 * parent/branch authority or expose raw private owner/contact fields.
 */
export function analyzeResearchIdentitySignals(records) {
  if (!Array.isArray(records)) throw new Error('Research candidates required');
  const comparisonSets = new Map();
  const parentHints = new Map();
  const norm = value => String(value ?? '')
    .normalize('NFKC').trim().toLocaleLowerCase('en')
    .replace(/\s+/g,' ');
  const add = (key,id) => {
    const group=comparisonSets.get(key)||[];
    group.push(id);comparisonSets.set(key,group);
  };
  for (const record of records) {
    if (!/^ZW-DEAL-\d{4}$/.test(record?.seed_dealer_id))
      throw new Error('Invalid seed identity in source grouping analysis');
    const source=record.source_snapshot||{};
    const city=norm(source['City / Town']);
    const name=norm(source['Dealer / Company Name']);
    const address=norm(source['Physical Address']);
    const parent=norm(source['Ownership / Parent Company / Key Principal']);
    if (name&&city)add('EXACT_NAME_CITY|'+name+'|'+city,record.seed_dealer_id);
    if (address&&city)add('EXACT_ADDRESS_CITY|'+address+'|'+city,record.seed_dealer_id);
    // "Private" alone is not a group and a self-declared parent is never a
    // legally confirmed entity. Keep hints as counts, not raw principal PII.
    if (parent&&parent!=='private'){
      const members=parentHints.get(parent)||new Set();
      members.add(record.seed_dealer_id);
      parentHints.set(parent,members);
    }
  }
  const evidence=new Map();
  for (const [key,ids] of comparisonSets) {
    if (ids.length<2)continue;
    const signal=key.startsWith('EXACT_NAME_CITY|')?
      'EXACT_NAME_CITY':'EXACT_ADDRESS_CITY';
    for (let i=0;i<ids.length;i++){
      for (let j=i+1;j<ids.length;j++){
        const pair=[ids[i],ids[j]].sort();
        const token=pair.join(':');
        const signals=evidence.get(token)||new Set();
        signals.add(signal);
        evidence.set(token,signals);
      }
    }
  }
  const duplicateSignals=[...evidence.entries()].map(([pair,signals])=>({
    seed_ids:pair.split(':'),signals:[...signals].sort(),
    review_state:'NEEDS_INDEPENDENT_IDENTITY_REVIEW',
    legal_duplicate_verified:false,
  })).sort((a,b)=>a.seed_ids.join(':').localeCompare(b.seed_ids.join(':')));
  const multiMemberHints=[...parentHints.values()]
    .filter(members=>members.size>1).map(members=>members.size);
  return Object.freeze({
    potential_duplicate_pairs:duplicateSignals.length,
    duplicate_signals:duplicateSignals,
    repeated_parent_branch_hint_groups:multiMemberHints.length,
    largest_unverified_hint_group:Math.max(0,...multiMemberHints),
    auto_merged_legal_entities:0,
    automatic_publication_decisions:0,
    requires_independent_review:true,
    source_parent_personal_details_returned:false,
  });
}

export function parseResearchWorkbook(workbook, workbookSha256) {
  const expectedTabs = [...SOURCE_TABS, ...DEV_TABS];
  const names = workbook.worksheets.map(sheet => sheet.name);
  if (names.length !== 20 || expectedTabs.some((name, i) => names[i] !== name)) {
    fail('expected exactly 20 research/DEV worksheets in canonical order');
  }
  const source = workbook.getWorksheet('Car Dealers Database');
  const dev8 = workbook.getWorksheet('DEV 8 - Seed Catalogue');
  const intake = workbook.getWorksheet('Dealer Profile Intake');
  const dictionary = workbook.getWorksheet('Field Dictionary');
  const headers = ORIGINAL_HEADERS.map((_, i) => textCell(source.getRow(7), i + 1));
  if (JSON.stringify(headers) !== JSON.stringify(ORIGINAL_HEADERS)) {
    fail('Car Dealers Database A7:K7 header drift');
  }
  if (textCell(intake.getRow(1), 40) !== 'Last Updated') fail('40-column dealer intake contract mismatch');
  if (textCell(dictionary.getRow(129), 4) !== 'Buyer Visibility') fail('128-row dictionary contract mismatch');
  const records = [];
  const categoryCounts = new Map();
  const cities = new Map();
  for (let n = 1; n <= 104; n += 1) {
    const originalRow = n + 7;
    const candidate = source.getRow(originalRow);
    const catalogue = dev8.getRow(n + 1);
    const fields = ORIGINAL_HEADERS.map((_, col) => textCell(candidate, col + 1));
    const id = 'ZW-DEAL-' + String(n).padStart(4, '0');
    if (fields[10] !== id || textCell(catalogue, 1) !== id) fail('seed ID drift at source row ' + originalRow);
    const expectedCrosswalk = [fields[10], ...fields.slice(0, 10)];
    for (let col = 1; col <= 11; col += 1) {
      if (textCell(catalogue, col) !== expectedCrosswalk[col - 1]) {
        fail('DEV 8 diverges from original ' + id + ' in field ' + col);
      }
    }
    if (textCell(catalogue, 19) !== String(originalRow)) fail('source row crosswalk mismatch for ' + id);
    const sourceCategory = textCell(catalogue, 12);
    if (!REQUIRED_SEED_CATEGORIES.has(sourceCategory)) fail('unapproved source category for ' + id);
    const grouping = textCell(catalogue, 13);
    const eligibility = textCell(catalogue, 14);
    const claim = textCell(catalogue, 15);
    const logo = textCell(catalogue, 16);
    const publicState = textCell(catalogue, 17);
    const candidateState = textCell(catalogue, 20);
    if (grouping !== 'UNREVIEWED_PARENT_BRANCH_MATCH' ||
        eligibility !== 'PENDING_HUMAN_SOURCE_ELIGIBILITY' ||
        claim !== 'UNCLAIMED_NO_APPROVED_CLAIM' ||
        logo !== 'PLACEHOLDER_UNTIL_RIGHTS_REVIEW' ||
        publicState !== 'NOT_PUBLISHED' ||
        candidateState !== 'RESEARCH_ONLY_NOT_LEGAL_ENTITY') {
      fail('human-reviewed/claim/public status unexpected: ' + id);
    }
    if (!fields[0] || !fields[5] || !fields[9]) fail('mandatory raw source fact missing: ' + id);
    const sourceSnapshot = Object.fromEntries(ORIGINAL_HEADERS.map((label, i) => [label, fields[i]]));
    const rowSha256 = sha256(JSON.stringify(sourceSnapshot));
    records.push({
      seed_dealer_id: id,
      source_workbook_sha256: workbookSha256,
      original_source_row: originalRow,
      source_row_sha256: rowSha256,
      source_snapshot: sourceSnapshot,
      proposed_source_category: sourceCategory,
      grouping_review: grouping,
      publication_eligibility: eligibility,
      claim_lifecycle: claim,
      logo_rights_status: logo,
      public_profile_state: publicState,
      candidate_record_state: candidateState,
    });
    categoryCounts.set(sourceCategory, (categoryCounts.get(sourceCategory) || 0) + 1);
    cities.set(fields[5], (cities.get(fields[5]) || 0) + 1);
  }
  if (records.length !== 104 || new Set(records.map(record => record.seed_dealer_id)).size !== 104) {
    fail('not 104 unique seed IDs');
  }
  if (textCell(source.getRow(112), 11)) fail('unexpected 105th source ID after row 111');
  if (textCell(dev8.getRow(106), 1)) fail('unexpected 105th DEV 8 seed ID');
  const groupingSignals=analyzeResearchIdentitySignals(records);
  return { records, summary: {
    workbook_sha256: workbookSha256, source_range: 'Car Dealers Database!A8:K111',
    seed_catalogue_range: 'DEV 8 - Seed Catalogue!A2:U105',
    research_discoveries: 104, verified_legal_companies: 0,
    public_eligibility_reviewed: 0, published_prelistings: 0,
    category_counts: Object.fromEntries(categoryCounts), cities: Object.fromEntries(cities),
    contacts_publicly_authorized: false, groupings_verified: false,
    identity_review_signals: groupingSignals,
  }};
}

export function assertLocalDatabase(urlText) {
  if (!urlText) fail('DEALER_SEED_DATABASE_URL required only for explicit --commit-local');
  let url;
  try { url = new URL(urlText); } catch { fail('invalid local database URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    fail('refusing any database host other than loopback');
  }
  if (url.searchParams.get('sslmode') === 'require') fail('remote-style SSL database mode refused');
  return urlText;
}

/**
 * The generic localhost guard is also used by isolated fictional CI. Actual
 * owner-source data must NEVER be imported into that synthetic test database
 * or an arbitrary localhost database that could be a staging/production tunnel.
 */
export function assertOriginalImportTarget(urlText){
  const accepted=assertLocalDatabase(urlText);
  const url=new URL(accepted);
  if(url.pathname!=='/'+ORIGINAL_OWNER_DISPOSABLE_DATABASE ||
     url.search || url.hash)
    fail('original import requires the dedicated disposable localhost PostgreSQL database');
  return accepted;
}
export function assertOriginalOwnerSourceSha(actual,expected){
  if(actual!==ORIGINAL_OWNER_SOURCE_SHA256 || expected!==ORIGINAL_OWNER_SOURCE_SHA256)
    fail('source SHA does not match explicitly approved Owner-original workbook');
}
export async function assertEmptyOriginalImportTarget(client){
  const proof=await client.query(`SELECT
    current_database() AS database_name,
    (SELECT COUNT(*)::int FROM tenants) AS tenants,
    (SELECT COUNT(*)::int FROM organizations) AS organizations,
    (SELECT COUNT(*)::int FROM dealer_profiles) AS dealer_profiles,
    (SELECT COUNT(*)::int FROM dealer_research_claim_requests) AS claims,
    (SELECT COUNT(*)::int FROM dealer_research_public_profiles) AS public_profiles`);
  const state=proof.rows?.[0];
  if(proof.rows?.length!==1 ||
     state?.database_name!==ORIGINAL_OWNER_DISPOSABLE_DATABASE ||
     ['tenants','organizations','dealer_profiles','claims','public_profiles']
       .some(key=>state?.[key]!==0))
    fail('original-source target has existing real or fictional business authority');
  return true;
}

export async function commitCandidatesLocal(client, records) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('CARUP-DEALER-ONB-001-source-seed'))");
    let inserted = 0, identical = 0;
    for (const record of records) {
      const prior = await client.query(
        'SELECT source_row_sha256, source_workbook_sha256 FROM dealer_research_seed_records WHERE seed_dealer_id = $1 FOR UPDATE',
        [record.seed_dealer_id]
      );
      if (prior.rows.length) {
        if (prior.rows[0].source_row_sha256 !== record.source_row_sha256 ||
            prior.rows[0].source_workbook_sha256 !== record.source_workbook_sha256) {
          fail('immutable source conflict for ' + record.seed_dealer_id + '; manual version review required');
        }
        identical += 1;
        continue;
      }
      await client.query(`INSERT INTO dealer_research_seed_records (
        seed_dealer_id, source_workbook_sha256, original_source_row, source_row_sha256,
        source_snapshot, proposed_source_category, grouping_review, publication_eligibility,
        claim_lifecycle, logo_rights_status, public_profile_state, candidate_record_state
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`, [
        record.seed_dealer_id, record.source_workbook_sha256, record.original_source_row,
        record.source_row_sha256, JSON.stringify(record.source_snapshot),
        record.proposed_source_category, record.grouping_review, record.publication_eligibility,
        record.claim_lifecycle, record.logo_rights_status, record.public_profile_state,
        record.candidate_record_state,
      ]);
      inserted += 1;
    }
    const receipt = await client.query(
      'SELECT count(*)::integer AS cnt FROM dealer_research_seed_records WHERE source_workbook_sha256=$1',
      [records[0].source_workbook_sha256]
    );
    if (receipt.rows[0].cnt !== 104 || inserted + identical !== 104) fail('post-import readback mismatch');
    await client.query('COMMIT');
    return { inserted, identical, read_back: receipt.rows[0].cnt, public_profiles_created: 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find(arg => !arg.startsWith('--'));
  if (!filePath) fail('provide path to canonical XLSX (never fetched automatically)');
  const bytes = await readFile(path.resolve(filePath));
  const hash = sha256(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const { records, summary } = parseResearchWorkbook(workbook, hash);
  const commit = args.includes('--commit-local');
  const expected = args.find(arg => arg.startsWith('--expect-sha256='))?.split('=')[1];
  if (!commit) {
    console.log(JSON.stringify({ mode: 'READ_ONLY', ...summary }, null, 2));
    return;
  }
  assertOriginalOwnerSourceSha(hash,expected);
  const client = new pg.Client({
    connectionString:assertOriginalImportTarget(process.env.DEALER_SEED_DATABASE_URL),
    ssl:false,application_name:'carup-owner-research-disposable-import',
  });
  await client.connect();
  try {
    await assertEmptyOriginalImportTarget(client);
    console.log(JSON.stringify({ mode: 'LOCAL_DATABASE_ONLY', ...summary,
      receipt: await commitCandidatesLocal(client, records) }, null, 2));
  }
  finally { await client.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
