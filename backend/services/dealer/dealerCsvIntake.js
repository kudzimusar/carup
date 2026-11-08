/**
 * CARUP-DEALER-ONB-001 C03/C04/C06: CSV legacy-intake mapper.
 * Deterministic, advisory header suggestions only. The customer must confirm
 * every mapped column; no AI output or input CSV can elevate authority.
 * CSV is one tab at a time and is converted through the SAME 12-tab XLSX
 * parser/claim-bound atomic draft contract as the official workbook.
 */
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {TEMPLATE_FIELD_REGISTRY} from './dealerIntakeWorkbook.js';
import {buildManualDealerWorkbook} from './dealerManualIntake.js';
import {parseCompletedDealerWorkbook} from './dealerWorkbookRoundtrip.js';

const MAX_BYTES=2*1024*1024,MAX_ROWS=100,MAX_COLS=75,MAX_CELL=4000;
// `location`: where in the applicant's own CSV a value was refused (see sendDealerRouteError).
const reject=(code,details='')=>Object.assign(new Error(code),{code,statusCode:400,details,location:details||undefined});
const sha=b=>createHash('sha256').update(b).digest('hex');
const normal=x=>String(x).toLowerCase().normalize('NFKC')
  .trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const ALIASES=Object.freeze({
  business_name:'legal_name',company_name:'legal_name',registered_name:'legal_name',
  registered_company_name:'legal_name',registered_legal_name:'legal_name',
  dealer_name:'trading_name',trading_as:'trading_name',
  registration_no:'registration_number',company_number:'registration_number',
  country:'operating_country',country_code:'operating_country',
  postal_address:'head_office_address',telephone:'business_phone',
  mobile_number:'business_phone',email_address:'business_email',
  branch:'branch_name',showroom:'branch_name',
  street_address:'physical_address',town:'city',
  city_town:'city',phone_number:'business_contact_phone',
  phone:'business_contact_phone',opening_hours:'visiting_hours',
  branch_id:'branch_ref',branch_code:'branch_ref',
  vehicle_source:'sourcing_channels',source_countries:'sourcing_countries',
  licence_no:'reference_number',license_no:'reference_number',
  issuer_name:'issuer',
  finance_provider:'finance_partner',payment_terms:'written_terms',
  refund_policy:'refund_conditions',
  policy_terms:'written_terms',warranty_terms:'warranty_term',
});
const DOMAINS=new Map(TEMPLATE_FIELD_REGISTRY.filter(t=>t.name!=='README - Instructions')
  .map(t=>[t.name,t]));
function getTab(tab){
  const t=DOMAINS.get(tab);
  if(!t)throw reject('UNKNOWN_IMPORT_TAB');
  return t;
}
/** Parse RFC 4180 CSV including escaped double quotes and embedded newlines. */
export function parseDealerCsv(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<6||bytes.length>MAX_BYTES)
    throw reject('CSV_SIZE_INVALID');
  let raw;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{
    throw reject('CSV_UTF8_REQUIRED');
  }
  raw=raw.replace(/^\uFEFF/,'');
  if(raw.includes('\0'))throw reject('CSV_BINARY_REFUSED');
  const rows=[];let cells=[],cell='',quoted=false,afterQuote=false;
  const pushCell=()=>{
    if(cell.length>MAX_CELL)throw reject('CSV_CELL_TOO_LONG');
    cells.push(cell);
    if(cells.length>MAX_COLS)throw reject('CSV_COLUMN_LIMIT');
    cell='';afterQuote=false;
  };
  const pushRow=()=>{
    pushCell();
    rows.push(cells);
    cells=[];
    if(rows.length>MAX_ROWS+1)throw reject('CSV_ROW_LIMIT');
  };
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(quoted){
      if(c==='"'){
        if(raw[i+1]==='"'){cell+='"';i++}else{quoted=false;afterQuote=true}
      }else cell+=c;
    }else if(c===','&&(!afterQuote||afterQuote)){pushCell()}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&raw[i+1]==='\n')i++;
      pushRow();
    }else if(c==='"'&&!afterQuote&&cell===''){quoted=true}
    else if(afterQuote && c===' '){ /* permitted padding */ }
    else if(afterQuote)throw reject('CSV_TRAILING_CHARS_AFTER_QUOTE');
    else if(c==='"')throw reject('CSV_UNEXPECTED_QUOTE');
    else cell+=c;
  }
  if(quoted)throw reject('CSV_UNTERMINATED_QUOTE');
  if(cell||cells.length||afterQuote)pushRow();
  if(rows.length<2||rows[0].length<1||rows[0].every(v=>!v.trim()))
    throw reject('CSV_HEADER_AND_DATA_REQUIRED');
  const headers=rows.shift().map(x=>x.trim());
  if(headers.some(x=>!x||x.length>160)||new Set(headers.map(normal)).size!==headers.length)
    throw reject('CSV_HEADER_DUPLICATE_OR_INVALID');
  for(const row of rows)if(row.length!==headers.length)throw reject('CSV_RAGGED_ROW');
  return {headers,rows,sha256:sha(bytes)};
}
function proposed(tab,headers){
  const fields=getTab(tab).fields.filter(f=>f.applicant_editable);
  const keys=new Set(fields.map(f=>f.key));
  const labels=new Map(fields.map(f=>[normal(f.label),f.key]));
  const suggestions={};
  const conflicts=[];
  for(const header of headers){
    const n=normal(header), guessed=keys.has(n)?n:labels.get(n)||ALIASES[n];
    if(guessed&&keys.has(guessed)){
      if(Object.values(suggestions).includes(guessed))conflicts.push('DUPLICATE_DESTINATION:'+guessed);
      else suggestions[header]=guessed;
    }
  }
  return {suggestions,unmapped:headers.filter(x=>!Object.hasOwn(suggestions,x)),
    conflicts};
}
export function inspectDealerCsvImport(bytes,tab){
  const csv=parseDealerCsv(bytes);
  const map=proposed(tab,csv.headers);
  return {schema:'CARUP_DEALER_CSV_PREVIEW_1',target_tab:tab,
    csv_sha256:csv.sha256,input_rows:csv.rows.length,input_headers:csv.headers,
    ...map,
    allowed_targets:getTab(tab).fields.filter(f=>f.applicant_editable)
      .map(f=>({key:f.key,label:f.label,data_type:f.data_type,required:f.required})),
    confirmed:false,legal_identity_verified:false,tenant_activated:false};
}
export async function stageConfirmedDealerCsv({bytes,tab,approvedMapping,
  acknowledged,expectedSha,claim,source,previousDocument=null}){
  const csv=parseDealerCsv(bytes);
  const sheet=getTab(tab);
  if(!acknowledged||typeof expectedSha!=='string'||csv.sha256!==expectedSha)
    throw reject('CSV_MAPPING_CONFIRMATION_OR_CHECKSUM_REQUIRED');
  if(!approvedMapping||typeof approvedMapping!=='object'||Array.isArray(approvedMapping)||
    Object.keys(approvedMapping).length!==csv.headers.length)
    throw reject('CSV_EXPLICIT_COMPLETE_MAPPING_REQUIRED');
  const allowed=new Set(sheet.fields.filter(f=>f.applicant_editable).map(f=>f.key));
  const used=new Set();
  for(const header of csv.headers){
    const dest=approvedMapping[header];
    if(dest!==null&&!allowed.has(dest))throw reject('CSV_FORBIDDEN_OR_UNKNOWN_DESTINATION',header);
    if(dest!==null){if(used.has(dest))throw reject('CSV_COLLIDING_MAPPING',dest);used.add(dest)}
  }
  if(![...used].length)throw reject('CSV_NO_MAPPED_FIELDS');
  // Literal text only; ExcelJS may not use formula-looking strings for CSV
  // values. Reject rather than silently turn them into formulas.
  for(const [i,record] of csv.rows.entries())for(const [j,value] of record.entries()){
    const dest=approvedMapping[csv.headers[j]];
    // Typed literal +263 Zimbabwe phone and signed GPS coordinates are valid
    // even though spreadsheet formula injection often starts with '+'/'-'.
    const safePhone=typeof dest==='string'&&/phone/.test(dest)&&
      /^\+[0-9 ()-]{6,30}$/.test(value.trim());
    const safeCoordinate=['gps_latitude','gps_longitude'].includes(dest)&&
      /^-\d{1,3}(?:\.\d+)?$/.test(value.trim());
    if(/^[\s]*[=+\-@]/.test(value)&&!safePhone&&!safeCoordinate)
      throw reject('CSV_FORMULA_LOOKING_VALUE',tab+':'+(i+2)+':'+(j+1));
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))
      throw reject('CSV_CONTROL_CHARACTER');
  }
  if(tab==='BUSINESS'&&csv.rows.length!==1)throw reject('CSV_SINGLE_BUSINESS_ROW_REQUIRED');
  if(tab==='BRANCHES'&&csv.rows.length>100)throw reject('CSV_TOO_MANY_BRANCHES');
  const wb=await buildManualDealerWorkbook(claim,source,{},previousDocument);
  const target=wb.getWorksheet(tab);
  for(const [rowIdx,data] of csv.rows.entries()){
    const rowNumber=rowIdx+2;
    for(const [colIdx,header] of csv.headers.entries()){
      const key=approvedMapping[header];
      if(key===null)continue;
      const index=sheet.fields.findIndex(f=>f.key===key);
      if(index<0||!sheet.fields[index].applicant_editable)
        throw reject('CSV_PRIVILEGED_FIELD_REFUSED');
      target.getRow(rowNumber).getCell(index+1).numFmt='@';
      target.getRow(rowNumber).getCell(index+1).value=data[colIdx].trim();
    }
  }
  const output=Buffer.from(await wb.xlsx.writeBuffer());
  const result=await parseCompletedDealerWorkbook(output,claim,source);
  return {...result,csv_sha256:csv.sha256,csv_target_tab:tab,
    source_header_mapping:Object.fromEntries(Object.entries(approvedMapping)),
    mapping_confirmed:true,has_authority_writes:false};
}
