import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManualDealerWorkbook} from '../services/dealer/dealerManualIntake.js';
import {parseCompletedDealerWorkbook} from '../services/dealer/dealerWorkbookRoundtrip.js';
const claim={
  claim_id:'c63ef593-6e41-4ed5-8026-26b7ad451c46',
  claimant_user_id:'fixture-applicant',
  seed_dealer_id:'ZW-DEAL-0001',claim_status:'CLAIM_APPROVED',claimed_scope:'BRANCH',
};
const source={
  seed_dealer_id:'ZW-DEAL-0001',source_row_sha256:'a'.repeat(64),
  source_snapshot:{
    'Seed Dealer ID':'ZW-DEAL-0001',
    'Dealer / Company Name':'Fixture Dealership Unverified',
    'Physical Address':'Research test address', 'Suburb / Area':'Test Suburb',
    'City / Town':'Harare','Phone / WhatsApp':'+263 TEST'
  },
};
async function parse(w){return parseCompletedDealerWorkbook(Buffer.from(await w.xlsx.writeBuffer()),claim,source)}
test('manual application uses SAME 12-sheet schema, retains researched candidate values without retyping',async()=>{
  const workbook=await buildManualDealerWorkbook(claim,source,{
    BUSINESS:{legal_name:'Fixture Incorporated Ltd',operating_country:'ZW',trading_name:'Fixture Trading'},
    BRANCHES:{branch_name:'Fixture Central',source_confirmation:'UNKNOWN'},
  });
  const parsed=await parse(workbook);
  assert.equal(parsed.document.tab_rows.BUSINESS[0].legal_name,'Fixture Incorporated Ltd');
  assert.equal(parsed.document.tab_rows.BRANCHES[0].city,'Harare');
  assert.equal(parsed.document.tab_rows.BRANCHES[0].business_contact_phone,'+263 TEST');
  assert.equal(parsed.review_state,'CANDIDATE_AWAITING_COMPLIANCE');
  assert.equal(parsed.has_authority_writes,false);
});
test('manual entry rejects client-supplied tenant, paid, reviewer and licence approval fields',async()=>{
  for(const field of ['tenant_id','user_role','verified','payment_status','can_publish','reviewer_decision']){
    await assert.rejects(buildManualDealerWorkbook(claim,source,{
      BUSINESS:{legal_name:'Fixture Incorporated Ltd',[field]:'approved'},
    }),/MANUAL_PATCH_DENIED_FIELD/);
  }
  await assert.rejects(buildManualDealerWorkbook(claim,source,{INTERNAL_RESEARCH:{email:'private@wrong.invalid'}}),
    /MANUAL_PATCH_UNKNOWN_DOMAIN/);
});
test('manual changes preserve versioned prior draft child rows and user branch corrections',async()=>{
  const prior=await buildManualDealerWorkbook(claim,source,{
    BUSINESS:{legal_name:'Old Fixture Incorporated Ltd',operating_country:'ZW'},
    BRANCHES:{city:'Bulawayo'},
  });
  const parsed=await parse(prior);
  const workbook=await buildManualDealerWorkbook(claim,source,{
    BUSINESS:{legal_name:'Corrected Fixture Incorporated Ltd'},
  },parsed.document);
  const updated=await parse(workbook);
  assert.equal(updated.document.tab_rows.BUSINESS[0].legal_name,'Corrected Fixture Incorporated Ltd');
  assert.equal(updated.document.tab_rows.BRANCHES[0].city,'Bulawayo');
});
