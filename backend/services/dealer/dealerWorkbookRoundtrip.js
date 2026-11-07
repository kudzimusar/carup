/**
 * CARUP-DEALER-ONB-001 D3/D4 — dealer-specific, claim-authorized workbook round-trip.
 * Generated from dealerIntakeWorkbook's single customer field registry, never the 20-tab
 * internal research workbook. No spreadsheet cell grants legal verification or tenancy.
 */
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  CUSTOMER_TABS, DEALER_INTAKE_VERSION, TEMPLATE_FIELD_REGISTRY,
  buildBlankDealerIntakeWorkbook,
} from './dealerIntakeWorkbook.js';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const MAX_FILE = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED = 24 * 1024 * 1024;
const MAX_ZIP_PARTS = 180;
const MAX_ROWS_PER_TAB = 250;
const ALLOWED_COUNTRIES = /^[A-Z]{2}$/;
const SOURCE = Object.freeze({
  name: 'Dealer / Company Name',
  address: 'Physical Address',
  suburb: 'Suburb / Area',
  city: 'City / Town',
  phone: 'Phone / WhatsApp',
  website: 'Website / Source URL',
  sourceId: 'Seed Dealer ID',
});
export const PREFILL_CONTRACT_VERSION = 'CARUP_DEALER_CLAIM_PREFILL_V1';
// `location` says WHERE in the applicant's own workbook a value was refused (e.g. "BRANCHES!2");
// sendDealerRouteError echoes only this explicit field, never a database error's `details` (UAT D2).
const error = (code, details = '') => Object.assign(new Error(code), {code, details, location: details || undefined, statusCode:400});
function requiredIdentity(claim, source) {
  if (!claim || claim.claim_status !== 'CLAIM_APPROVED' || !claim.claim_id ||
    !claim.claimant_user_id || !claim.seed_dealer_id) throw error('CLAIM_NOT_APPROVED');
  if (!source || source.seed_dealer_id !== claim.seed_dealer_id ||
    source.source_snapshot?.[SOURCE.sourceId] !== claim.seed_dealer_id ||
    !/^[0-9a-f]{64}$/.test(source.source_row_sha256 || '')) {
    throw error('SOURCE_CUSTODY_MISMATCH');
  }
}
function sheetFill(sheet, rowIndex, pairs) {
  for (const [name,value] of Object.entries(pairs)) {
    const col = TEMPLATE_FIELD_REGISTRY.find(t=>t.name===sheet.name)?.fields.findIndex(f=>f.key===name) ?? -1;
    if (col<0) throw error('FIELD_REGISTRY_DRIFT', sheet.name+'.'+name);
    // XLSX cell assignment of a JavaScript string is a typed literal, not a formula.
    // Never prepend an apostrophe to the real +263 phone/source values: round-trip
    // must be byte-for-byte the researched candidate until applicant corrects it.
    const cell=sheet.getRow(rowIndex).getCell(col+1);
    cell.numFmt='@';
    cell.value=value==null?'':String(value);
  }
}
/**
 * Source information is always marked as research requiring confirmation, even after
 * claim authorization. Claim approval is NOT legal entity, business licence or stock approval.
 */
/**
 * The research candidate values a claim-specific prefilled workbook carries — and nothing else.
 * Shared by the workbook builder and the applicant's draft review (Owner UAT D4) so the "changed
 * from research" preview can never show a research field the applicant was not already given.
 */
export function researchPrefillCandidates(source) {
  const facts=source?.source_snapshot||{};
  return Object.freeze({
    BUSINESS:Object.freeze({research_display_name:facts[SOURCE.name] || ''}),
    BRANCHES:Object.freeze({
      branch_name:facts[SOURCE.name] || '', physical_address:facts[SOURCE.address] || '',
      suburb:facts[SOURCE.suburb] || '',city:facts[SOURCE.city] || '',
      business_contact_phone:facts[SOURCE.phone] || '',
    }),
  });
}
export async function buildPrefilledDealerWorkbook(claim, source, {issuedAt = new Date()} = {}) {
  requiredIdentity(claim,source);
  const w=await buildBlankDealerIntakeWorkbook();
  const candidates=researchPrefillCandidates(source);
  const b=w.getWorksheet('BUSINESS');
  sheetFill(b,2,{
    claim_reference:claim.claim_id,source_seed_id:source.seed_dealer_id,
    ...candidates.BUSINESS,
    operating_country:'ZW', research_confirmation:'UNKNOWN',
  });
  const branch=w.getWorksheet('BRANCHES');
  sheetFill(branch,2,{
    branch_ref:'BR-'+source.seed_dealer_id,
    source_seed_id:source.seed_dealer_id,
    ...candidates.BRANCHES,
    country:'ZW',
    source_confirmation:'UNKNOWN',
  });
  const instructions=w.getWorksheet('README - Instructions');
  for(const [label,value] of [
    ['CLAIM REFERENCE',claim.claim_id],
    ['SEED SOURCE',source.seed_dealer_id],
    ['RESEARCH ROW HASH',source.source_row_sha256],
    ['WORKBOOK CONTRACT',PREFILL_CONTRACT_VERSION],
    ['ISSUED AT',issuedAt.toISOString()],
    ['SOURCE CLASSIFICATION','Research/UNVERIFIED. Contact and branch data require confirmation; never trust research categories as licences.'],
    ['REUPLOAD','Complete all missing required legal fields and return ONE workbook. This does not verify compliance.'],
  ]) instructions.addRow([label,value==null?'':String(value)]);
  w.company='CarUp — unverified research candidate';
  return w;
}
export async function exportPrefilledDealerWorkbook(claim,source,opts) {
  const w=await buildPrefilledDealerWorkbook(claim,source,opts);
  return Buffer.from(await w.xlsx.writeBuffer());
}

/**
 * Inspect ZIP central directory BEFORE ExcelJS inflates it. Prevent many practical
 * ZIP bombs/path traversal or workbook part count attacks, not a substitute for sandboxing.
 */
export function validateXlsxZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length<64 || bytes.length>MAX_FILE)
    throw error('INVALID_WORKBOOK_SIZE');
  if (bytes.readUInt32LE(0)!==0x04034b50) throw error('NOT_XLSX_ZIP');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  }
  if(end<0) throw error('INVALID_ZIP_DIRECTORY');
  const num=bytes.readUInt16LE(end+10),dirSize=bytes.readUInt32LE(end+12),
        start=bytes.readUInt32LE(end+16);
  if(num<5||num>MAX_ZIP_PARTS||start+dirSize>bytes.length)
    throw error('ZIP_LIMITS_EXCEEDED');
  let ptr=start,total=0;
  const names=new Set();
  for(let i=0;i<num;i++){
    if(ptr+46>bytes.length || bytes.readUInt32LE(ptr)!==0x02014b50)
      throw error('INVALID_ZIP_ENTRY');
    const compressed=bytes.readUInt32LE(ptr+20),raw=bytes.readUInt32LE(ptr+24),
      nameLen=bytes.readUInt16LE(ptr+28),extraLen=bytes.readUInt16LE(ptr+30),
      commentLen=bytes.readUInt16LE(ptr+32);
    if(nameLen===0||ptr+46+nameLen+extraLen+commentLen>bytes.length)
      throw error('INVALID_ZIP_ENTRY');
    const name=bytes.subarray(ptr+46,ptr+46+nameLen).toString('utf8');
    if(names.has(name)||name.startsWith('/')||name.includes('..')||name.includes('\\')||
      /\x00/.test(name)||name.toLowerCase().endsWith('.vba'))
      throw error('UNSAFE_XLSX_PART');
    names.add(name);
    if(raw>MAX_UNCOMPRESSED || (compressed===0&&raw>0) ||
      (compressed>0&&raw>compressed*60)) throw error('ZIP_EXPANSION_LIMIT');
    total+=raw;
    if(total>MAX_UNCOMPRESSED) throw error('ZIP_EXPANSION_LIMIT');
    ptr+=46+nameLen+extraLen+commentLen;
  }
  if(ptr!==start+dirSize || !names.has('[Content_Types].xml')||
    !names.has('xl/workbook.xml'))throw error('MISSING_XLSX_PARTS');
  if([...names].some(x=>/vbaProject|externalLinks|embeddings|activeX/i.test(x)))
    throw error('FORBIDDEN_XLSX_CONTENT');
  return {parts:num,uncompressedBytes:total};
}
function cellValue(cell, tab,row,col) {
  if(cell.type===ExcelJS.ValueType.Formula || cell.formula || cell.sharedFormula)
    throw error('WORKBOOK_FORMULA_REFUSED',tab+'!'+row+':'+col);
  const value=cell.value;
  if(value==null||value==='')return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='object'){
    if(value.hyperlink||value.richText||value.formula)throw error('NON_LITERAL_CELL',tab+'!'+row+':'+col);
    if(typeof value.text==='string')return value.text.trim();
    throw error('NON_LITERAL_CELL',tab+'!'+row+':'+col);
  }
  if(!['string','number','boolean'].includes(typeof value))
    throw error('NON_LITERAL_CELL',tab+'!'+row+':'+col);
  const result=String(value).trim();
  if(result.length>4000)throw error('CELL_TOO_LONG',tab+'!'+row+':'+col);
  return result;
}
function checkValue(field,v,tab,row) {
  if(!v) return;
  if(field.data_type==='integer' && (!/^\d+$/.test(v)||Number(v)>100000000))
    throw error('INVALID_INTEGER',tab+'!'+row+'.'+field.key);
  if(field.data_type==='decimal' &&
    (!/^-?\d+(?:\.\d+)?$/.test(v)||!Number.isFinite(Number(v))))
    throw error('INVALID_DECIMAL',tab+'!'+row+'.'+field.key);
  if(field.data_type==='date' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw error('INVALID_DATE',tab+'!'+row+'.'+field.key);
  if(field.data_type==='date' && new Date(v).toISOString().slice(0,10)!==v)
    throw error('INVALID_CALENDAR_DATE',tab+'!'+row+'.'+field.key);
  if(/^(operating_country|country|jurisdiction)$/.test(field.key) &&
      field.key!=='jurisdiction' && !ALLOWED_COUNTRIES.test(v))
    throw error('INVALID_COUNTRY',tab+'!'+row+'.'+field.key);
  if(field.key==='gps_latitude' && Math.abs(Number(v))>90)
    throw error('INVALID_LATITUDE',tab+'!'+row);
  if(field.key==='gps_longitude' && Math.abs(Number(v))>180)
    throw error('INVALID_LONGITUDE',tab+'!'+row);
}

/** Never maps workbook "verified", "role", "tenant", "paid" or "approved" fields. */
export async function parseCompletedDealerWorkbook(bytes, claim,source) {
  requiredIdentity(claim,source);
  validateXlsxZip(bytes);
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(bytes)}catch{throw error('INVALID_XLSX_STRUCTURE')}
  const actual=workbook.worksheets.map(t=>t.name);
  const expected=CUSTOMER_TABS.map(t=>t.name);
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw error('UNEXPECTED_WORKBOOK_TABS');
  const document={schema:DEALER_INTAKE_VERSION,claim_id:claim.claim_id,
    seed_id:source.seed_dealer_id,source_row_sha256:source.source_row_sha256,
    tab_rows:{},applicant_verified:false,compliance_approved:false};
  for(const contract of TEMPLATE_FIELD_REGISTRY){
    const sheet=workbook.getWorksheet(contract.name);
    if(sheet.columnCount>contract.fields.length || sheet.rowCount>MAX_ROWS_PER_TAB)
      throw error('WORKBOOK_ROW_OR_COLUMN_LIMIT',contract.name);
    const names=contract.fields.map((field,i)=>cellValue(sheet.getRow(1).getCell(i+1),contract.name,1,i+1));
    if(JSON.stringify(names)!==JSON.stringify(contract.fields.map(f=>f.label)))
      throw error('WORKBOOK_HEADER_DRIFT',contract.name);
    const rows=[];
    for(let row=2;row<=sheet.rowCount;row++){
      const record={};
      let filled=false;
      for(let i=0;i<contract.fields.length;i++){
        const field=contract.fields[i];
        const value=cellValue(sheet.getRow(row).getCell(i+1),contract.name,row,i+1);
        if(value)filled=true;
        if(field.applicant_editable){
          checkValue(field,value,contract.name,row);
          record[field.key]=value;
        }else{
          record[field.key]=value;
        }
      }
      if(filled)rows.push(record);
    }
    document.tab_rows[contract.name]=rows;
  }
  const business=document.tab_rows.BUSINESS;
  if(business.length!==1)throw error('SINGLE_BUSINESS_REQUIRED');
  if(business[0].claim_reference!==claim.claim_id ||
    business[0].source_seed_id!==claim.seed_dealer_id)
    throw error('WORKBOOK_CLAIM_REFERENCE_MISMATCH');
  if(!business[0].legal_name||!business[0].operating_country)
    throw error('LEGAL_NAME_AND_COUNTRY_REQUIRED');
  const branches=document.tab_rows.BRANCHES;
  if(branches.length>100)throw error('TOO_MANY_BRANCHES');
  const uniqueBranches=new Set();
  for(const b of branches){
    if(!b.branch_ref||uniqueBranches.has(b.branch_ref))
      throw error('DUPLICATE_OR_MISSING_BRANCH_REF');
    uniqueBranches.add(b.branch_ref);
    if(b.source_seed_id && b.source_seed_id!==claim.seed_dealer_id)
      throw error('CROSS_SOURCE_BRANCH_REFERENCE');
    if(b.source_confirmation && !['YES','CORRECT','UNKNOWN'].includes(b.source_confirmation))
      throw error('INVALID_SOURCE_CONFIRMATION');
  }
  const linked=['LICENCES_AUTHORIZATIONS','BRANDS_FRANCHISES','OPERATIONS_SOURCING',
    'FINANCE_PAYMENTS','WORKSHOP_WARRANTY','DIGITAL_MEDIA','VEHICLE_INVENTORY_REFERENCE'];
  for(const tab of linked)for(const record of document.tab_rows[tab]){
    if(record.branch_ref && !uniqueBranches.has(record.branch_ref))
      throw error('ORPHAN_BRANCH_REFERENCE',tab+':'+record.branch_ref);
  }
  if(business[0].research_confirmation &&
     !['YES','CORRECT','UNKNOWN'].includes(business[0].research_confirmation))
    throw error('INVALID_SOURCE_CONFIRMATION');
  return {document,sha256:hash(bytes),
    record_counts:Object.fromEntries(Object.entries(document.tab_rows).map(([k,v])=>[k,v.length])),
    review_state:'CANDIDATE_AWAITING_COMPLIANCE',
    has_authority_writes:false};
}
