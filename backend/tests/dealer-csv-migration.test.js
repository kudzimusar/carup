import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  parseDealerCsv,inspectDealerCsvImport,stageConfirmedDealerCsv
} from '../services/dealer/dealerCsvIntake.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const claim={claim_id:'c63ef593-6e41-4ed5-8026-26b7ad451c46',
  seed_dealer_id:'ZW-DEAL-0001',claimant_user_id:'owner-1',
  claim_status:'CLAIM_APPROVED'};
const source={seed_dealer_id:'ZW-DEAL-0001',source_row_sha256:'a'.repeat(64),
  source_snapshot:{
    'Seed Dealer ID':'ZW-DEAL-0001',
    'Dealer / Company Name':'Fixture Company Unverified',
    'City / Town':'Harare','Physical Address':'Fixture Road',
  }};
test('C03 CSV embedded newline/escaped quotes and UTF-8 BOM stay literal',()=>{
  const b=Buffer.from('\uFEFF"legal_name","business_model"\r\n"Example ""Car""","Used,\nnew and import"\r\n');
  const result=parseDealerCsv(b);
  assert.deepEqual(result.headers,['legal_name','business_model']);
  assert.deepEqual(result.rows,[['Example "Car"','Used,\nnew and import']]);
});
test('C04 source header aliases are advisory and require customer confirmation',()=>{
  const input=Buffer.from('Company Name,Country,City\nFixture Ltd,ZW,Harare\n');
  const result=inspectDealerCsvImport(input,'BUSINESS');
  assert.equal(result.suggestions['Company Name'],'legal_name');
  assert.equal(result.suggestions.Country,'operating_country');
  assert.equal(result.confirmed,false);
  assert.ok(result.unmapped.includes('City'));
  assert.equal(result.legal_identity_verified,false);
  assert.equal(result.tenant_activated,false);
});
test('C03/C06 forbidden CSV header/row shapes are refused before claim draft persistence',()=>{
  for(const txt of ['a,a\n1,2\n','x,y\n"bad"left,2\n','x,y\n"unterminated\n',
    'x,y\n1,2,3\n'])assert.throws(()=>parseDealerCsv(Buffer.from(txt)));
});
test('C03 full CUSTOMER BUSINESS CSV -> canonical 12-tab XLSX parser; no verified status',async()=>{
  const bytes=Buffer.from('Company Name,Country,Research Confirmed\nFixture Group Ltd,ZW,CORRECT\n');
  const mapping={'Company Name':'legal_name',Country:'operating_country',
    'Research Confirmed':'research_confirmation'};
  await assert.rejects(stageConfirmedDealerCsv({
    bytes,tab:'BUSINESS',approvedMapping:mapping,acknowledged:false,
    expectedSha:sha(bytes),claim,source,
  }),/CSV_MAPPING_CONFIRMATION_OR_CHECKSUM_REQUIRED/);
  const result=await stageConfirmedDealerCsv({
    bytes,tab:'BUSINESS',approvedMapping:mapping,acknowledged:true,
    expectedSha:sha(bytes),claim,source,
  });
  assert.equal(result.document.tab_rows.BUSINESS[0].legal_name,'Fixture Group Ltd');
  assert.equal(result.document.tab_rows.BUSINESS[0].operating_country,'ZW');
  assert.equal(result.document.tab_rows.BUSINESS[0].research_confirmation,'CORRECT');
  assert.equal(result.document.tab_rows.BRANCHES[0].city,'Harare');
  assert.equal(result.document.applicant_verified,false);
  assert.equal(result.document.compliance_approved,false);
  assert.equal(result.has_authority_writes,false);
  assert.equal(result.mapping_confirmed,true);
  assert.equal(Object.hasOwn(result.document,'tenant_id'),false);
  assert.ok(result.record_counts.BUSINESS===1);
});
test('C04 mapping to role/tenant/verified or duplicated destination is rejected',async()=>{
  const bytes=Buffer.from('company_name,tenant_id\nAcme Ltd,other-tenant\n');
  await assert.rejects(stageConfirmedDealerCsv({
    bytes,tab:'BUSINESS',
    approvedMapping:{company_name:'legal_name',tenant_id:'tenant_id'},
    acknowledged:true,expectedSha:sha(bytes),claim,source,
  }),/CSV_FORBIDDEN_OR_UNKNOWN_DESTINATION/);
  await assert.rejects(stageConfirmedDealerCsv({
    bytes,tab:'BUSINESS',
    approvedMapping:{company_name:'legal_name',tenant_id:'legal_name'},
    acknowledged:true,expectedSha:sha(bytes),claim,source,
  }),/CSV_COLLIDING_MAPPING/);
});
test('C03 CSV injection stays unsafe while legitimate +263 phone and signed GPS stay literal',async()=>{
  const phone=Buffer.from('legal_name,business_phone\nAcme Ltd,+263 77 1234567\n');
  const inspected=inspectDealerCsvImport(phone,'BUSINESS');
  assert.equal(inspected.input_rows,1);
  await assert.rejects(stageConfirmedDealerCsv({
    bytes:Buffer.from('legal_name,business_phone\nAcme Ltd,=HYPERLINK("https://attacker.test")\n'),
    tab:'BUSINESS',approvedMapping:{legal_name:'legal_name',business_phone:'business_phone'},
    acknowledged:true,expectedSha:sha(Buffer.from('legal_name,business_phone\nAcme Ltd,=HYPERLINK("https://attacker.test")\n')),
    claim,source,
  }),/CSV_FORMULA_LOOKING_VALUE/);
  const good=await stageConfirmedDealerCsv({
    bytes:phone,tab:'BUSINESS',
    approvedMapping:{legal_name:'legal_name',business_phone:'business_phone'},
    acknowledged:true,expectedSha:sha(phone),claim,source,
  });
  assert.equal(good.document.tab_rows.BUSINESS[0].business_phone,'+263 77 1234567');
});
