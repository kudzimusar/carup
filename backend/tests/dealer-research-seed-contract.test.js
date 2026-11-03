/**
 * CARUP-DEALER-ONB-001 — S01/S02/S05/S06/S10 contract tests.
 * Synthetic fixture testing is NOT independent verification of real dealers.
 * For a physical 104-row workbook read, provide CARUP_DEALER_RESEARCH_XLSX privately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  parseResearchWorkbook, assertLocalDatabase, SOURCE_TABS,
  DEV_TABS, ORIGINAL_HEADERS, commitCandidatesLocal, analyzeResearchIdentitySignals,
} from '../scripts/dealership/importResearchSeed.mjs';

function stubRow(number, values = []) {
  return { number, getCell(index) { return { value: values[index - 1] ?? null }; } };
}
function mockWorkbook() {
  const maps = new Map([...SOURCE_TABS, ...DEV_TABS].map(name => [name, new Map()]));
  const cat = 'Independent dealer claim';
  maps.get('Car Dealers Database').set(7, ORIGINAL_HEADERS);
  maps.get('Dealer Profile Intake').set(1, [
    ...Array(39).fill('field'), 'Last Updated',
  ]);
  maps.get('Field Dictionary').set(129, ['', '', '', 'Buyer Visibility']);
  for (let n = 1; n <= 104; n += 1) {
    const id = 'ZW-DEAL-' + String(n).padStart(4, '0');
    const original = ['TEST FIXTURE ' + n, 'Independent Used Car Dealership',
      'Test vehicles', 'Synthetic address', 'Synthetic area', 'Harare',
      '+263 TEST (RESTRICTED)', 'synthetic@example.invalid',
      'NOT LEGAL PARENT', 'https://example.invalid/' + n, id];
    maps.get('Car Dealers Database').set(n + 7, original);
    maps.get('DEV 8 - Seed Catalogue').set(n + 1, [
      id, ...original.slice(0, 10), cat, 'UNREVIEWED_PARENT_BRANCH_MATCH',
      'PENDING_HUMAN_SOURCE_ELIGIBILITY', 'UNCLAIMED_NO_APPROVED_CLAIM',
      'PLACEHOLDER_UNTIL_RIGHTS_REVIEW', 'NOT_PUBLISHED',
      'Review before use', String(n + 7), 'RESEARCH_ONLY_NOT_LEGAL_ENTITY',
      'Fixture is never public',
    ]);
  }
  return {
    worksheets: [...SOURCE_TABS, ...DEV_TABS].map(name => ({ name })),
    getWorksheet(name) {
      const rows = maps.get(name);
      return rows ? { getRow(n) { return stubRow(n, rows.get(n)); } } : undefined;
    },
    setCell(name, row, col, value) {
      const existing = maps.get(name).get(row) || [];
      existing[col - 1] = value;
      maps.get(name).set(row, existing);
    },
  };
}

test('S01 synthetic: exactly 104 source-qualified rows never create legal/public authority', () => {
  const { records, summary } = parseResearchWorkbook(mockWorkbook(), 'a'.repeat(64));
  assert.equal(records.length, 104);
  assert.equal(summary.research_discoveries, 104);
  assert.equal(summary.verified_legal_companies, 0);
  assert.equal(summary.published_prelistings, 0);
  assert.equal(records[0].seed_dealer_id, 'ZW-DEAL-0001');
  assert.equal(records.at(-1).seed_dealer_id, 'ZW-DEAL-0104');
  assert.equal(records.every(r => r.public_profile_state === 'NOT_PUBLISHED'), true);
  assert.equal(records.every(r => r.publication_eligibility === 'PENDING_HUMAN_SOURCE_ELIGIBILITY'), true);
});

test('S03/04 exact name/address conflicts and parent hints are review signals, never legal merges',()=>{
  const fixture = (id,name,address,parent) => ({
    seed_dealer_id:id,
    source_snapshot:{
      'Dealer / Company Name':name,'Physical Address':address,
      'City / Town':'Harare',
      'Ownership / Parent Company / Key Principal':parent,
      'Phone / WhatsApp':'RESTRICTED',
      'Email':'staff@example.invalid',
    },
  });
  const rows=[
    fixture('ZW-DEAL-0001','Synthetic Alpha Dealer','Test Street 10','Private Parent A'),
    fixture('ZW-DEAL-0002',' synthetic alpha  dealer ','TEST STREET 10','Private Parent A'),
    fixture('ZW-DEAL-0003','Synthetic Subsidiary','Other Street','Private Parent A'),
    fixture('ZW-DEAL-0004','Unrelated Dealer','Third Street','Private'),
  ];
  const review=analyzeResearchIdentitySignals(rows);
  assert.equal(review.potential_duplicate_pairs,1);
  assert.deepEqual(review.duplicate_signals[0].signals,
    ['EXACT_ADDRESS_CITY','EXACT_NAME_CITY']);
  assert.deepEqual(review.duplicate_signals[0].seed_ids,['ZW-DEAL-0001','ZW-DEAL-0002']);
  assert.equal(review.repeated_parent_branch_hint_groups,1);
  assert.equal(review.largest_unverified_hint_group,3);
  assert.equal(review.auto_merged_legal_entities,0);
  assert.equal(review.automatic_publication_decisions,0);
  assert.equal(review.source_parent_personal_details_returned,false);
  assert.equal(JSON.stringify(review).includes('Private Parent A'),false);
  assert.equal(JSON.stringify(review).includes('staff@example.invalid'),false);
});
test('S03 source row parser preserves all 104 pending and emits only non-authoritative grouping observations',()=>{
  const {records,summary}=parseResearchWorkbook(mockWorkbook(),'a'.repeat(64));
  assert.equal(records.length,104);
  assert.equal(summary.identity_review_signals.requires_independent_review,true);
  assert.equal(summary.identity_review_signals.auto_merged_legal_entities,0);
  assert.equal(summary.identity_review_signals.automatic_publication_decisions,0);
  assert.equal(summary.public_eligibility_reviewed,0);
});

test('S05 counterfeit source-category cannot be silently promoted to OEM badge', () => {
  const wb = mockWorkbook();
  wb.setCell('DEV 8 - Seed Catalogue', 2, 12, 'CARUP_VERIFIED_FRANCHISE');
  assert.throws(() => parseResearchWorkbook(wb, 'a'.repeat(64)), /unapproved source category/);
});

test('S02 source crosswalk corruption or fabricated extra record refuses import', () => {
  const wb = mockWorkbook();
  wb.setCell('DEV 8 - Seed Catalogue', 2, 2, 'fake additional legal entity');
  assert.throws(() => parseResearchWorkbook(wb, 'a'.repeat(64)), /diverges from original/);
  const w2 = mockWorkbook();
  w2.setCell('Car Dealers Database', 112, 11, 'ZW-DEAL-0105');
  assert.throws(() => parseResearchWorkbook(w2, 'a'.repeat(64)), /unexpected 105th source/);
});

test('S06 publication review is mandatory, no automatic publishing of source rows', () => {
  const wb = mockWorkbook();
  wb.setCell('DEV 8 - Seed Catalogue', 2, 14, 'PRELISTED_UNCLAIMED');
  assert.throws(() => parseResearchWorkbook(wb, 'a'.repeat(64)), /human-reviewed\/claim\/public status unexpected/);
});

test('never authorize a shared or remote database as seed target', () => {
  assert.throws(() => assertLocalDatabase('postgresql://x:y@db.example.com:5432/app'), /loopback/);
  assert.throws(() => assertLocalDatabase('postgresql://x:y@10.0.0.4:5432/app'), /loopback/);
  assert.throws(() => assertLocalDatabase('postgresql://x:y@localhost:5432/app?sslmode=require'), /SSL/);
  assert.equal(assertLocalDatabase('postgresql://x:y@localhost:5432/app'), 'postgresql://x:y@localhost:5432/app');
});

test('S02 identical local reimport uses immutable same-row receipts', async () => {
  const record = parseResearchWorkbook(mockWorkbook(), 'a'.repeat(64)).records[0];
  const calls = [];
  const fake = { async query(sql, vals) {
    calls.push(sql);
    if (sql.includes('SELECT source_row_sha256,')) {
      return { rows: [{ source_row_sha256: record.source_row_sha256, source_workbook_sha256: record.source_workbook_sha256 }] };
    }
    if (sql.includes('SELECT count(*)::integer')) return { rows: [{ cnt: 104 }] };
    return { rows: [] };
  }};
  const records = Array(104).fill(record);
  const receipt = await commitCandidatesLocal(fake, records);
  assert.deepEqual(receipt, { inserted: 0, identical: 104, read_back: 104, public_profiles_created: 0 });
  assert.equal(calls.some(statement => statement.startsWith('INSERT')), false);
});

test('physical attached source: validate exact 104 rows when source available', {
  skip: !process.env.CARUP_DEALER_RESEARCH_XLSX,
}, async () => {
  const bytes = await readFile(process.env.CARUP_DEALER_RESEARCH_XLSX);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const receipt = parseResearchWorkbook(workbook, digest);
  assert.equal(receipt.records.length, 104);
  assert.equal(receipt.summary.published_prelistings, 0);
});
