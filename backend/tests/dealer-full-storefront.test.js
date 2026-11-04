import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dealer-local-fake';
const {supabase}=await import('../db/supabase.js');
const full=await import('../services/dealer/dealerFullStorefrontService.js');
const research=await import('../services/dealer/dealerResearchService.js');
const valid='ZW-DEAL-0001';
const reviewer={userId:'reviewer-full',authenticationMethod:'session',
  isVerified:true,platformRole:'admin'};
const pendingSource={
  seed_dealer_id:valid,public_slug:'zw-deal-0001',public_name:'Fixture Dealer',
  public_city:'Harare',public_research_category:'Vehicle sales (research category)',
  source_attribution:'Owner research (not verified)',publication_status:'PRELISTED_UNCLAIMED',
  reviewed_at:'2026-11-04T00:00:00Z',revision:1,reviewer_id:'SECRET',
  source_snapshot:{'Email':'PRIVATE_CONTACT','Phone / WhatsApp':'PRIVATE_PHONE'},
};
const fullRow={
  seed_dealer_id:valid,public_slug:'zw-deal-0001',public_name:'Fixture Approved Dealer',
  public_city:'Harare',
  approved_branch_snapshot:[{branch_id:'11111111-1111-4111-8111-111111111111',
    name:'Fixture Branch',address:'Fictional Street, Harare'}],
  dealer_declared_sections:{BUYER_ASSURANCE:{
    inspection_rights:'Independent inspection available by prior arrangement'}},
  publication_reviewed_at:'2026-11-04T00:00:00Z',
  internal_tax:'PRIVATE_TAX',reviewer_private_notes:'SECRET_REVIEW',
};
function qb(data){
 return {select(){return this},eq(){return this},in(){return this},
   limit:async()=>({data:data==null?[]:[data],error:null}),
   maybeSingle:async()=>({data,error:null}),
   order(){return this},range:async()=>({data:data==null?[]:[data],error:null,count:data?1:0})};
}
test('C19 full publication does not leak candidate corporate/private data',()=>{
 const item=full.fullApprovedPublicProjection(fullRow);
 assert.equal(item.tier,'FULL_DEALER_APPROVED');
 assert.equal(item.business_verified,true);
 assert.equal(item.claimed,true);
 assert.equal(item.logo_rights_approved,false);
 assert.equal(item.vin_listings_verified_by_this_projection,false);
 assert.equal(item.complaint_count,null);
 assert.equal(item.review_count,null);
 const text=JSON.stringify(item);
 for(const blocked of ['PRIVATE_TAX','SECRET_REVIEW','internal_tax','reviewer_private_notes'])
   assert.equal(text.includes(blocked),false);
});
test('C18 correct same stable slug before and after full legal business review',()=>{
 const before=research.publicResearchProjection(pendingSource);
 const after=research.publicResearchProjection(pendingSource,
   full.fullApprovedPublicProjection(fullRow));
 assert.equal(before.slug,after.slug);
 assert.equal(before.business_verified,false);
 assert.equal(before.tier,'PRELISTED_UNCLAIMED');
 assert.equal(after.business_verified,true);
 assert.equal(after.tier,'FULL_DEALER_APPROVED');
 assert.equal(after.source_attribution,'Owner research (not verified)');
 assert.equal(research.publicResearchProjection({...pendingSource,
   publication_status:'UNDER_DISPUTE'},full.fullApprovedPublicProjection(fullRow)),null);
});
test('C18 full view null means no legal verification; claim-state stays independently authoritative',async()=>{
 const original=supabase.from;
 let existingApprovedClaim=false;
 try{
  supabase.from=table=>{
    if(table==='dealer_research_public_profiles')return qb(pendingSource);
    if(table==='dealer_full_storefront_current')return qb(null);
    if(table==='dealer_research_claim_requests')return {
      select(cols){assert.equal(cols,'seed_dealer_id');return this},
      in(k,ids){assert.equal(k,'seed_dealer_id');assert.deepEqual(ids,[valid]);return this},
      async eq(k,v){
        assert.equal(k,'claim_status');assert.equal(v,'CLAIM_APPROVED');
        return {data:existingApprovedClaim?[{seed_dealer_id:valid}]:[],error:null};
      },
    };
    throw Error('Unexpected source '+table);
  };
  const unclaimed=await research.getPublicResearch(valid);
  assert.equal(unclaimed.business_verified,false);
  assert.equal(unclaimed.tier,'PRELISTED_UNCLAIMED');
  assert.equal(unclaimed.claimed,false);
  // After independent legal approval, withdrawing PUBLIC DISPLAY does not
  // erase an approved claimant or open a new unreviewed takeover.
  existingApprovedClaim=true;
  const claimed=await research.getPublicResearch(valid);
  assert.equal(claimed.business_verified,false);
  assert.equal(claimed.tier,'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED');
  assert.equal(claimed.claimed,true);
  assert.equal(claimed.slug,unclaimed.slug);
  assert.doesNotMatch(claimed.label,/Unclaimed/);
  assert.ok(!JSON.stringify(claimed).includes('PRIVATE_CONTACT'));
 }finally{supabase.from=original}
});
test('C19 full review refuses forged reviewer, unauthorized scope and applicant self-publish shape',async()=>{
 const inputs=[
  {actor:{...reviewer,authenticationMethod:'x-user-id-fallback'},
    payload:{disposition:'PUBLISHED_FULL',reason:'a'.repeat(100),
      approved_branch_ids:['11111111-1111-4111-8111-111111111111'],approved_sections:[],
      reviewer_password:'pw'}},
  {actor:reviewer,payload:{disposition:'PUBLISHED_FULL',reason:'a'.repeat(100),
      approved_branch_ids:[],approved_sections:[],reviewer_password:'pw'}},
  {actor:reviewer,payload:{disposition:'PUBLISHED_FULL',reason:'a'.repeat(100),
      approved_branch_ids:['11111111-1111-4111-8111-111111111111'],
      approved_sections:['OEM_AUTHORIZATION'],reviewer_password:'pw'}},
  {actor:reviewer,payload:{disposition:'RETRACTED',reason:'a'.repeat(100),
      approved_branch_ids:['11111111-1111-4111-8111-111111111111'],
      approved_sections:[],reviewer_password:'pw'}},
 ];
 for(const v of inputs){
   await assert.rejects(full.recordFullStorefrontPublication(valid,v.actor,v.payload));
 }
});

test('C19 approved storefront queue uses canonical activated_at, not missing created_at',async()=>{
  const old=supabase.from;
  const calls=[];
  try{
    supabase.from=table=>{
      assert.equal(table,'dealer_approved_seed_links');
      return {
        select(fields){
          calls.push(['select',fields]);
          return this;
        },
        order(key,opts){
          calls.push(['order',key,opts?.ascending]);
          return this;
        },
        limit:async n=>{
          assert.equal(n,100);
          return {data:[{seed_dealer_id:'ZW-DEAL-0001',
            link_id:'00000000-0000-4000-8000-000000000001',
            operating_status:'ACTIVE',claimant_user_id:'claimant1',
            activated_at:'2026-11-04T00:00:00Z'}],error:null};
        },
      };
    };
    const queue=await full.listFullStorefrontReviewQueue(reviewer);
    assert.equal(queue.length,1);
    assert.equal(queue[0].seed_dealer_id,'ZW-DEAL-0001');
    assert.equal(queue[0].independent_reviewer_required,true);
    assert.deepEqual(calls,[
      ['select','seed_dealer_id,link_id,operating_status,activated_at,claimant_user_id'],
      ['order','activated_at',false],
    ]);
  }finally{supabase.from=old}
});
