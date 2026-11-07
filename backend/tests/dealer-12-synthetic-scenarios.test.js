/**
 * CARUP-DEALER-ONB-001 D11 — 12 SYNTHETIC negative-path dealership scenarios.
 * These are not 12 real businesses and NOT a substitute for the 12-dealer pilot,
 * actual private research review, real documents or physical browser UAT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {buildJurisdictionCompliancePreview}=await import(
  '../services/dealer/dealerJurisdictionPreview.js');
const {publicResearchProjection}=await import(
  '../services/dealer/dealerResearchService.js');
const {deriveCanPublish}=await import(
  '../services/dealer/dealerComplianceService.js');
const {extractObservedCandidates}=await import(
  '../services/dealer/dealerDocumentCandidateService.js');
const company=(businessModel='',more={})=>({tab_rows:{
  BUSINESS:[{legal_name:'Synthetic Legal Company',operating_country:'ZW',
    business_model:businessModel,...more}],
  BRANCHES:[{branch_ref:'SB-1',branch_name:'Synthetic Branch',city:'Synthetic City'}],
}});
const reviewed=(status)=>({
  seed_dealer_id:'SYNTHETIC-001',public_slug:'synthetic-001',
  public_name:'Synthetic Dealer — Never Publish',public_city:'Synthetic City',
  public_research_category:'Vehicle sales (research category)',
  source_attribution:'Synthetic test fixture',publication_status:status,
  reviewed_at:'2026-11-03T00:00:00Z',revision:1,
});
const legalProfile={identity_status:'verified',compliance_review_state:'passed',
  active_state:'active',suspension_state:'none',restriction_state:'none',
  investigation_state:'none'};
const has=(p,key)=>p.requirements.some(r=>r.requirement_key===key);
const scenarios=[
  {
    name:'01 unpublished source record remains nonpublic',
    run:()=>assert.equal(publicResearchProjection(reviewed('NOT_PUBLISHED')),null),
  },
  {
    name:'02 separately reviewed prelisting has no company verification or stock authority',
    run:()=>{
      const p=publicResearchProjection(reviewed('PRELISTED_UNCLAIMED'));
      assert.equal(p.claimed,false);assert.equal(p.business_verified,false);
      assert.ok(!JSON.stringify(p).includes('tenant_id'));
      assert.match(p.label,/Not independently business-verified/);
    },
  },
  {
    name:'03 withheld source never creates a visible dealer profile',
    run:()=>assert.equal(publicResearchProjection(reviewed('WITHHELD')),null),
  },
  {
    name:'04 disputed source remains unavailable to new public claimants',
    run:()=>assert.equal(publicResearchProjection(reviewed('UNDER_DISPUTE')),null),
  },
  {
    name:'05 multi-branch parent intake retains branch count without granting group ownership',
    run:()=>{
      const d=company();d.tab_rows.BRANCHES.push({
        branch_ref:'SB-2',branch_name:'Second Synthetic Branch',city:'Other Synthetic Town'});
      const p=buildJurisdictionCompliancePreview(d);
      assert.equal(p.declared_branch_count,2);assert.equal(p.can_activate,false);
      assert.equal(p.legal_review_complete,false);
    },
  },
  {
    name:'06 official dealership declaration triggers written OEM authority review, never an automatic badge',
    run:()=>{
      const d=company();d.tab_rows.BRANDS_FRANCHISES=[
        {brand:'Synthetic Brand',relationship:'official franchise'}];
      const p=buildJurisdictionCompliancePreview(d);
      assert.equal(has(p,'OEM_WRITTEN_AUTHORIZATION'),true);
      assert.equal(p.requirements.find(x=>x.requirement_key==='OEM_WRITTEN_AUTHORIZATION')
        .legal_source_verified,false);
    },
  },
  {
    name:'07 importer claiming bonded handling gets a conditional bonded facility review',
    run:()=>assert.equal(has(buildJurisdictionCompliancePreview(company('bonded importer')),
      'BONDED_FACILITY_AUTHORIZATION'),true),
  },
  {
    name:'08 independent nonbonded importer not falsely classified as bonded or government supplier',
    run:()=>{
      const p=buildJurisdictionCompliancePreview(company('independent importer'));
      assert.equal(has(p,'BONDED_FACILITY_AUTHORIZATION'),false);
      assert.equal(has(p,'PUBLIC_PROCUREMENT_REGISTRATION'),false);
    },
  },
  {
    name:'09 suspension defeats otherwise verified, active compliance',
    run:()=>assert.equal(deriveCanPublish({...legalProfile,suspension_state:'suspended'},[]),false),
  },
  {
    name:'10 unresolved blocking registration prevents publication even if base statuses pass',
    run:()=>assert.equal(deriveCanPublish(legalProfile,['company_registration']),false),
  },
  {
    name:'11 South African applicant not subjected to guessed Zimbabwe PRAZ/ZIMRA rules',
    run:()=>{
      const p=buildJurisdictionCompliancePreview(company('government procurement',
        {operating_country:'ZA'}));
      assert.equal(p.state,'COUNTRY_POLICY_NOT_CONFIGURED');
      assert.equal(p.requirements.length,0);assert.equal(p.can_activate,false);
    },
  },
  {
    name:'12 contradictory multi-page company name is manual review, never implicit verification',
    run:()=>{
      const p=extractObservedCandidates([
        'Legal Name: Synthetic Alpha Company\nRegistration Number: X123',
        'Legal Name: Synthetic Beta Company\nExpires On: 31/02/2026',
      ]);
      assert.equal(p.fields.legal_name.value,'Synthetic Alpha Company');
      assert.ok(p.review_flags.includes('LEGAL_NAME_CONFLICTING_PAGES'));
      assert.ok(p.review_flags.includes('EXPIRES_AT_AMBIGUOUS_DATE'));
      assert.equal(p.fields.legal_name.confidence,null);
    },
  },
];
assert.equal(scenarios.length,12);
for(const s of scenarios)test('D11 SYNTHETIC scenario '+s.name,s.run);
