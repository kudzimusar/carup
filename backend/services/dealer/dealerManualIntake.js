/**
 * CARUP-DEALER-ONB-001 — accessible manual-entry alternative.
 * Uses the SAME 12-tab field registry, XLSX parser and atomic draft storage as
 * imported dealer workbooks. Edits remain applicant candidates, never approval.
 */
import { TEMPLATE_FIELD_REGISTRY } from './dealerIntakeWorkbook.js';
import { buildPrefilledDealerWorkbook } from './dealerWorkbookRoundtrip.js';

const MANUAL_KEYS=Object.freeze({
  BUSINESS:[
    'legal_name','trading_name','operating_country','registration_authority',
    'registration_number','tax_clearance_number','tax_clearance_expiry',
    'year_established','business_model','responsible_signer_name','business_email',
    'business_phone','head_office_address','research_confirmation',
  ],
  BRANCHES:[
    'branch_name','branch_type','physical_address','suburb','city','province',
    'country','gps_latitude','gps_longitude','maps_url','visiting_hours',
    'site_capacity','business_contact_phone','source_confirmation',
  ],
  CONSENTS_DECLARATIONS:['signer_name','signer_role','privacy_acknowledgment'],
});
function reject(message){
  const error=new Error(message);error.statusCode=400;return error;
}
function rowFields(sheetName){
  const tab=TEMPLATE_FIELD_REGISTRY.find(t=>t.name===sheetName);
  if(!tab)throw reject('UNKNOWN_INTAKE_DOMAIN');
  return tab.fields;
}
function patchRow(sheet,rowNumber,values){
  const fields=rowFields(sheet.name);
  for(const [key,value] of Object.entries(values)){
    const index=fields.findIndex(f=>f.key===key);
    if(index<0||!fields[index].applicant_editable)
      throw reject('UNRECOGNIZED_OR_PRIVILEGED_FIELD:'+sheet.name+'.'+key);
    if(value!==null && typeof value!=='string' && typeof value!=='number')
      throw reject('INVALID_MANUAL_FIELD_TYPE:'+sheet.name+'.'+key);
    const cell=sheet.getRow(rowNumber).getCell(index+1);
    cell.numFmt='@';
    cell.value=value==null?'':String(value).trim();
  }
}
function loadExisting(workbook,priorDocument){
  if(!priorDocument)return;
  if(priorDocument.schema!=='CARUP_DEALER_INTAKE_1_0'||
     typeof priorDocument.tab_rows!=='object')
    throw reject('INCOMPATIBLE_EXISTING_DRAFT');
  for(const [tabName,rows] of Object.entries(priorDocument.tab_rows)){
    const tab=TEMPLATE_FIELD_REGISTRY.find(t=>t.name===tabName);
    if(!tab||!Array.isArray(rows)||rows.length>100)
      throw reject('INVALID_EXISTING_DRAFT');
    if(tabName==='README - Instructions')continue;
    const sheet=workbook.getWorksheet(tabName);
    for(const [index,row] of rows.entries()){
      if(!row||typeof row!=='object'||Array.isArray(row))
        throw reject('INVALID_EXISTING_DRAFT_ROW');
      const allowed=new Set(tab.fields.map(f=>f.key));
      for(const [key,value] of Object.entries(row)){
        if(!allowed.has(key))throw reject('PRIOR_DRAFT_FIELD_DRIFT');
        const column=tab.fields.findIndex(f=>f.key===key)+1;
        const cell=sheet.getRow(index+2).getCell(column);
        cell.numFmt='@';cell.value=value==null?'':String(value);
      }
    }
  }
}
export async function buildManualDealerWorkbook(claim,source,patch,priorDocument=null){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||
    Object.keys(patch).some(k=>!['BUSINESS','BRANCHES','CONSENTS_DECLARATIONS'].includes(k)))
    throw reject('MANUAL_PATCH_UNKNOWN_DOMAIN');
  const workbook=await buildPrefilledDealerWorkbook(claim,source);
  if(priorDocument)loadExisting(workbook,priorDocument);
  for(const [tab,values] of Object.entries(patch)){
    if(!values||typeof values!=='object'||Array.isArray(values))
      throw reject('MANUAL_PATCH_INVALID_ROW');
    if(Object.keys(values).some(k=>!MANUAL_KEYS[tab].includes(k)))
      throw reject('MANUAL_PATCH_DENIED_FIELD');
    patchRow(workbook.getWorksheet(tab),2,values);
  }
  return workbook;
}
