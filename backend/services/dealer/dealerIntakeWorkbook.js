/**
 * CARUP-DEALER-ONB-001 D3 — dealer-facing canonical XLSX schema foundation.
 *
 * This is NOT the 20-sheet internal source workbook. The one editable customer schema
 * is used for both blank/new-business and (later, only after proven claim approval)
 * prefilled material. Unknown fields are blank and legal review never comes from Excel.
 * Runtime intake upload, permission-bound export and data persistence are NOT implemented here.
 */
import ExcelJS from 'exceljs';

export const DEALER_INTAKE_VERSION = 'CARUP_DEALER_INTAKE_1_0';
const field = (key, label, opts = {}) => Object.freeze({
  key, label, required: false, privacy: 'private_applicant', data_type: 'text',
  applicant_editable: true, ...opts,
});
const ref = (key,label) => field(key,label,{privacy:'reference_only',applicant_editable:false});

export const CUSTOMER_TABS = Object.freeze([
  {
    name: 'README - Instructions',
    fields: [field('topic','Topic'),field('instructions','Instructions')],
  },
  {
    name: 'BUSINESS',
    fields: [
      ref('claim_reference','Claim reference — server-validated'),
      ref('source_seed_id','Source research ID — not company ID'),
      field('research_display_name','Researched display name (candidate)',{privacy:'research_candidate'}),
      field('legal_name','Registered legal name',{required:true}),
      field('trading_name','Confirmed trading name'),
      field('operating_country','Country code (ISO alpha-2)',{required:true}),
      field('registration_authority','Company registration issuer'),
      field('registration_number','Company registration number'),
      field('registration_evidence_reference','Registration document reference'),
      field('tax_clearance_number','Tax registration/clearance number'),
      field('tax_clearance_expiry','Tax certificate expiry (YYYY-MM-DD)',{data_type:'date'}),
      field('year_established','Year established',{data_type:'integer'}),
      field('business_model','Operating business model'),
      field('responsible_signer_name','Accountable authorized signatory'),
      field('business_email','Official business email'),
      field('business_phone','Official business phone'),
      field('head_office_address','Legal head office address'),
      field('research_confirmation','Confirm researched facts: YES / CORRECT / UNKNOWN',{privacy:'research_candidate'}),
    ],
  },
  {
    name: 'BRANCHES',
    fields: [
      ref('branch_ref','Branch reference — stable key'),
      ref('source_seed_id','Source research ID'),
      field('branch_name','Branch/trading location name'),
      field('branch_type','Branch type'),
      field('physical_address','Branch physical address'),
      field('suburb','Suburb/area'),field('city','City/town'),field('province','Province/state'),
      field('country','Country code (ISO alpha-2)'),
      field('gps_latitude','Latitude -90 to 90',{data_type:'decimal'}),
      field('gps_longitude','Longitude -180 to 180',{data_type:'decimal'}),
      field('maps_url','Reviewed maps reference'),
      field('visiting_hours','Visitor opening hours'),
      field('site_capacity','Yard capacity / vehicles',{data_type:'integer'}),
      field('business_contact_phone','Public business phone proposed'),
      field('source_confirmation','Confirm researched branch: YES / CORRECT / UNKNOWN',{privacy:'research_candidate'}),
    ],
  },
  {
    name: 'LICENCES_AUTHORIZATIONS',
    fields: [
      ref('authorization_ref','Authorization reference'),
      ref('branch_ref','Branch reference'),
      field('authorization_type','Licence / authorization type'),
      field('issuer','Issuer / regulator'),
      field('jurisdiction','Country / jurisdiction'),
      field('scope','Legal entity / branch / facility scope'),
      field('reference_number','Licence number'),
      field('issued_at','Issued YYYY-MM-DD',{data_type:'date'}),
      field('expires_at','Expires YYYY-MM-DD',{data_type:'date'}),
      field('evidence_ref','Private evidence document reference'),
      field('conditional_applicability','Applicable: YES / NO / NEEDS_REVIEW'),
    ],
  },
  {
    name: 'BRANDS_FRANCHISES',
    fields: [
      ref('brand_claim_ref','Brand declaration reference'),
      ref('branch_ref','Branch reference'),
      field('brand','Brand claimed'),
      field('relationship','Dealer relationship (self-declared only)'),
      field('authorizing_issuer','Issuer of written authorization'),
      field('effective_at','Effective YYYY-MM-DD',{data_type:'date'}),
      field('expires_at','Expires YYYY-MM-DD',{data_type:'date'}),
      field('evidence_ref','Private written authorization evidence reference'),
    ],
  },
  {
    name: 'OPERATIONS_SOURCING',
    fields: [
      ref('operation_ref','Operating model reference'),
      ref('branch_ref','Branch reference'),
      field('sourcing_countries','Countries sourced from'),
      field('sourcing_channels','Import/source channels'),
      field('stock_model','Owned / consignment / mixed'),
      field('vehicle_class','New / used / commercial'),
      field('import_duty_policy','Company import/duty explanation (not VIN proof)'),
      field('lot_capacity','Yard capacity estimate',{data_type:'integer'}),
      field('capacity_period','Capacity measurement period'),
      field('sales_estimate','Estimated monthly units (not verified sales)',{data_type:'integer'}),
    ],
  },
  {
    name: 'FINANCE_PAYMENTS',
    fields: [
      ref('policy_ref','Policy or provider reference'),
      ref('branch_ref','Branch reference'),
      field('payment_methods','Customer payment methods (declaration)'),
      field('currencies','Customer payment currencies (declaration)'),
      field('finance_partner','Finance partner name (unverified)'),
      field('written_terms','Written finance / lay-by / deposit terms'),
      field('fee_disclosures','Fees, taxes and additional charges'),
      field('refund_conditions','Deposit return conditions'),
      field('evidence_ref','Partner/terms private reference'),
    ],
  },
  {
    name: 'WORKSHOP_WARRANTY',
    fields: [
      ref('policy_ref','Warranty/workshop reference'),
      ref('branch_ref','Branch reference'),
      field('workshop_services','Workshop / inspection services'),
      field('service_facility','Workshop location/facility'),
      field('parts_support','Parts availability declaration'),
      field('warranty_coverage','Warranty covered items'),
      field('warranty_exclusions','Warranty exclusions'),
      field('warranty_term','Warranty duration/limit'),
      field('claims_process','Claim, repair, after-sales process'),
      field('partner_reference','Service partner name/reference'),
    ],
  },
  {
    name: 'BUYER_PROTECTION',
    fields: [
      ref('buyer_policy_ref','Buyer policy version reference'),
      field('sale_contract_url','Written sale contract reference'),
      field('quote_includes_duty','Duty/tax disclosure policy'),
      field('extra_fees_disclosed','Additional fee disclosure'),
      field('deposit_policy','Deposits/lay-by policy'),
      field('independent_inspection','Buyer inspection rights'),
      field('vin_before_deposit','VIN disclosure policy'),
      field('condition_report','Vehicle condition disclosure policy'),
      field('transfer_process','Vehicle transfer/title procedure'),
      field('cancellation_policy','Cancellation/refund policy'),
      field('complaint_process','Buyer complaint/dispute contact'),
      field('policy_effective_at','Policy effective YYYY-MM-DD',{data_type:'date'}),
    ],
  },
  {
    name: 'DIGITAL_MEDIA',
    fields: [
      ref('media_ref','Media/link reference'),
      ref('branch_ref','Branch reference'),
      field('media_kind','Logo / branch photo / catalogue / website'),
      field('uri','URL / media reference (not upload authorization)'),
      field('alt_text','Accessible image text'),
      field('rights_owner','Rights owner/consent'),
      field('license_reference','Licence / written permission reference'),
      field('public_visibility_request','Request public display: YES / NO'),
    ],
  },
  {
    name: 'VEHICLE_INVENTORY_REFERENCE',
    fields: [
      ref('branch_ref','Branch reference'),
      field('inventory_batch_reference','Existing canonical VIN inventory batch reference'),
      field('mapping_notes','Inventory mapping notes (no self-approval)'),
    ],
  },
  {
    name: 'CONSENTS_DECLARATIONS',
    fields: [
      ref('agreement_version','Legal agreement version — server issued'),
      ref('agreement_hash','Terms hash — server issued'),
      field('signer_name','Authorized signatory name'),
      field('signer_role','Signatory legal role'),
      field('declaration_draft','Declaration draft — not a legal signature'),
      field('privacy_acknowledgment','Privacy notice read YES / NO'),
    ],
  },
]);

export const TEMPLATE_FIELD_REGISTRY = Object.freeze(
  CUSTOMER_TABS.map(tab => Object.freeze({
    name:tab.name,
    fields:Object.freeze(tab.fields),
  }))
);
const REQUIRED_NAMES = [
  'README - Instructions','BUSINESS','BRANCHES','LICENCES_AUTHORIZATIONS',
  'BRANDS_FRANCHISES','OPERATIONS_SOURCING','FINANCE_PAYMENTS',
  'WORKSHOP_WARRANTY','BUYER_PROTECTION','DIGITAL_MEDIA',
  'VEHICLE_INVENTORY_REFERENCE','CONSENTS_DECLARATIONS',
];
if (JSON.stringify(CUSTOMER_TABS.map(t=>t.name)) !== JSON.stringify(REQUIRED_NAMES)) {
  throw new Error('Dealer workbook schema drift versus DEV 3');
}

/**
 * Official source field mapping (all 40 research intake columns). REVIEWER_ONLY fields are never
 * customer-editable, and references never confer an organization, tenant or permission.
 */
export const SOURCE_40_FIELD_DISPOSITIONS = Object.freeze([
  ['Seed Dealer ID','BUSINESS.source_seed_id','REFERENCE_ONLY'],
  ['Dealer Name (linked)','BUSINESS.research_display_name','RESEARCH_CONFIRM'],
  ['City / Town (linked)','BRANCHES.city','RESEARCH_CONFIRM'],
  ['Parent Organization / Legal Entity ID',null,'REVIEWER_ONLY'],
  ['Branch Type','BRANCHES.branch_type','CANDIDATE'],
  ['Registered Legal Name','BUSINESS.legal_name','CANDIDATE'],
  ['Trading Name Confirmed','BUSINESS.trading_name','CANDIDATE'],
  ['Registration Authority','BUSINESS.registration_authority','CANDIDATE'],
  ['Company Registration Number','BUSINESS.registration_number','PRIVATE'],
  ['Registration Evidence Link','BUSINESS.registration_evidence_reference','PRIVATE'],
  ['Tax Clearance Number','BUSINESS.tax_clearance_number','PRIVATE'],
  ['Tax Clearance Expiry','BUSINESS.tax_clearance_expiry','PRIVATE'],
  ['Bonded Warehouse Licence Number','LICENCES_AUTHORIZATIONS.reference_number','CONDITIONAL_PRIVATE'],
  ['Bonded Licence Expiry','LICENCES_AUTHORIZATIONS.expires_at','CONDITIONAL_PRIVATE'],
  ['PRAZ Registration / Category','LICENCES_AUTHORIZATIONS.authorization_type','CONDITIONAL_PRIVATE'],
  ['OEM / Franchise Authorization','BRANDS_FRANCHISES.relationship','UNVERIFIED_DECLARATION'],
  ['OEM Evidence Link','BRANDS_FRANCHISES.evidence_ref','PRIVATE'],
  ['OEM Valid Until','BRANDS_FRANCHISES.expires_at','PRIVATE'],
  ['Year Established','BUSINESS.year_established','CANDIDATE'],
  ['Physical Site Address Confirmed','BRANCHES.physical_address','CANDIDATE'],
  ['GPS Latitude','BRANCHES.gps_latitude','CANDIDATE'],
  ['GPS Longitude','BRANCHES.gps_longitude','CANDIDATE'],
  ['Maps Place Link','BRANCHES.maps_url','CANDIDATE'],
  ['Visiting Hours','BRANCHES.visiting_hours','CANDIDATE'],
  ['Showroom / Yard Image Links','DIGITAL_MEDIA.uri','RIGHTS_REVIEW'],
  ['Contact Phone Verified','BRANCHES.business_contact_phone','CONTACT_REVIEW'],
  ['Business Model','BUSINESS.business_model','CANDIDATE'],
  ['Stock Ownership / Consignment Model','OPERATIONS_SOURCING.stock_model','CANDIDATE'],
  ['Vehicle Sourcing Countries & Channels','OPERATIONS_SOURCING.sourcing_countries','CANDIDATE'],
  ['Typical Duty / Import Disclosure','OPERATIONS_SOURCING.import_duty_policy','CANDIDATE'],
  ['Lot Capacity (vehicles)','OPERATIONS_SOURCING.lot_capacity','CANDIDATE'],
  ['Estimated Monthly Units Sold','OPERATIONS_SOURCING.sales_estimate','CANDIDATE_NOT_SALES'],
  ['Live Inventory Link','VEHICLE_INVENTORY_REFERENCE.inventory_batch_reference','REFERENCE_ONLY'],
  ['Financing Providers & Payment Terms','FINANCE_PAYMENTS.written_terms','UNVERIFIED_DECLARATION'],
  ['Services / Workshop Summary','WORKSHOP_WARRANTY.workshop_services','UNVERIFIED_DECLARATION'],
  ['Profile Submitted By','BUSINESS.responsible_signer_name','PRIVATE'],
  ['Submission Date',null,'SERVER_OWNED'],
  ['Profile Intake Status',null,'REVIEWER_ONLY'],
  ['Correction Notes',null,'REVIEWER_ONLY'],
  ['Last Updated',null,'SERVER_OWNED'],
]);
if (SOURCE_40_FIELD_DISPOSITIONS.length !== 40 ||
  new Set(SOURCE_40_FIELD_DISPOSITIONS.map(x=>x[0])).size !== 40) {
  throw new Error('Research source 40-field mapping is incomplete');
}
const knownKeys = new Set(TEMPLATE_FIELD_REGISTRY.flatMap(t=>t.fields.map(f=>t.name+'.'+f.key)));
for (const [, key] of SOURCE_40_FIELD_DISPOSITIONS) {
  if (key && !knownKeys.has(key)) throw new Error('Unknown workbook registry destination '+key);
}

/** Prefix spreadsheet formula introducers (including CSV/Excel injections) for source candidates. */
export function safeXlsxText(value) {
  if (value == null) return '';
  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').slice(0,10000);
  return /^[\s]*[=+\-@]/.test(text) ? '\'' + text : text;
}

export async function buildBlankDealerIntakeWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator='CarUp Dealership 1.0 — Customer Intake';
  workbook.created = new Date();
  workbook.company='CarUp';
  for (const tab of TEMPLATE_FIELD_REGISTRY) {
    const sheet = workbook.addWorksheet(tab.name);
    sheet.views=[{state:'frozen',ySplit:1}];
    sheet.columns=tab.fields.map(f=>({
      header:f.label, key:f.key,
      width:Math.max(20, Math.min(50, f.label.length + 4)),
    }));
    sheet.getRow(1).font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(1).height=35;
    sheet.getRow(1).alignment={vertical:'middle',wrapText:true};
    sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF132D47'}};
    sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:tab.fields.length}};
    sheet.addRow(Object.fromEntries(tab.fields.map(f=>[f.key,''])));
    sheet.getRow(2).height=24;
    for (const [i,f] of tab.fields.entries()) {
      if (!f.applicant_editable) sheet.getCell(2,i+1).fill={
        type:'pattern',pattern:'solid',fgColor:{argb:'FFE2E8F0'},
      };
    }
  }
  const readme = workbook.getWorksheet('README - Instructions');
  readme.getRow(2).values=['SCHEMA VERSION', DEALER_INTAKE_VERSION];
  [
    ['PURPOSE','Complete missing legal, business, branch and buyer-protection fields. The research workbook is NOT the customer template.'],
    ['AUTHORITY','No cell confirms ownership, compliance, licence, trusted merchant, payment, approval or vehicle sales.'],
    ['RESEARCH CANDIDATES','Prefilled source facts (in later approved-claim exports) require explicit applicant confirmation.'],
    ['PRIVATE DATA','Tax, incorporation and evidence references are private application facts, never public website material.'],
    ['REQUIRED REVIEW','Business claim requires original legal documentary proof, independent reviewer and separate full compliance.'],
    ['INVENTORY','Use separately governed canonical VIN vehicle upload, not a business workbook claim.'],
    ['DATE FORMAT','Use YYYY-MM-DD; do not guess dates. Unknown/not applicable and zero are different.'],
    ['SPREADSHEET SECURITY','Never use formulas/macros or client-edited reviewer fields, tenant roles, paid flags or badges.'],
    ['UPLOAD STATUS','Manual forms and governed upload/roundtrip are NOT implemented in this isolated engineering slice.'],
  ].forEach(row=>readme.addRow(row));
  return workbook;
}

export async function exportBlankDealerIntakeXlsx() {
  const workbook = await buildBlankDealerIntakeWorkbook();
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
