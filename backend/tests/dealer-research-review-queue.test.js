import test from 'node:test';
import assert from 'node:assert/strict';
import {installStepUpGuardModel} from './helpers/dealerStepUpGuardModel.js';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
// R6: the reviewer step-up lockout RPCs are answered by a faithful in-memory model.
installStepUpGuardModel(supabase);
const {hashPassword}=await import('../utils/passwordAuth.js');
const service=await import('../services/dealer/dealerResearchService.js');
const actor={userId:'reviewer-01',authenticationMethod:'session',
  isVerified:true,platformRole:'reviewer'};
const password='CorrectResearchReviewerPassword2026!';
const reason='Independently checked the current business location, source permission, official reference and no personal contact disclosure before publication.';
const row={seed_dealer_id:'ZW-DEAL-0001',original_source_row:8,
  proposed_source_category:'Official dealer / franchise label — UNVERIFIED',
  grouping_review:'UNREVIEWED_PARENT_BRANCH_MATCH',
  source_row_sha256:'a'.repeat(64),
  source_snapshot:{
    'Dealer / Company Name':'Synthetic Dealership For Test',
    'City / Town':'Synthetic City',
    'Phone / WhatsApp':'+263PRIVATEPHONE',
    Email:'PRIVATE_EMAIL',
    'Ownership / Parent Company / Key Principal':'PRIVATE_DIRECTOR',
    'Website / Source URL':'https://private-source.invalid',
  }
};
test('D4 review queue requires real verified platform reviewer, not spoofable fallback',async()=>{
  for(const who of [null,{...actor,authenticationMethod:'x-user-id-fallback'},
    {...actor,isVerified:false},{...actor,platformRole:'dealer'}]){
    await assert.rejects(service.listResearchReviewQueue(who),
      /Independent session-verified reviewer required/);
  }
});
test('D4 private research queue projects name, city and revision but no source contacts/owner',async()=>{
  const old=supabase.from;
  const sequence=[];
  try{
    supabase.from=table=>{
      const q={
        select(){return this},order(){return this},
        range(start,end){
          sequence.push({table,start,end});
          return Promise.resolve({data:[row],count:104,error:null});
        },
        in(col,ids){
          assert.equal(col,'seed_dealer_id');
          assert.deepEqual(ids,['ZW-DEAL-0001']);
          return Promise.resolve({data:[{
            seed_dealer_id:'ZW-DEAL-0001',publication_status:'WITHHELD',revision:2
          }],error:null});
        },
      };
      return q;
    };
    const result=await service.listResearchReviewQueue(actor,{page:1,limit:20});
    assert.equal(result.total,104);
    assert.equal(result.bulk_publication_available,false);
    assert.equal(result.entries[0].source_city,'Synthetic City');
    assert.equal(result.entries[0].publication_state,'WITHHELD');
    assert.equal(result.entries[0].review_revision,2);
    assert.equal(result.entries[0].verified_franchise,false);
    const json=JSON.stringify(result);
    for(const secret of ['PRIVATEPHONE','PRIVATE_EMAIL','PRIVATE_DIRECTOR',
      'private-source.invalid','source_snapshot'])
      assert.ok(!json.includes(secret),'leak: '+secret);
    assert.deepEqual(sequence,[{table:'dealer_research_seed_records',start:0,end:19}]);
  }finally{supabase.from=old}
});
test('D4 publication cannot proceed without independent password and 80-character reason',async()=>{
  const oldFrom=supabase.from,oldRpc=supabase.rpc;
  let rpc=0;
  try{
    const passwordHash=await hashPassword(password);
    supabase.from=table=>{
      if(table!=='users')throw Error('unexpected '+table);
      return {select(){return this},eq(){return this},
        maybeSingle:async()=>({data:{
          id:actor.userId,role:'reviewer',is_verified:true,password_hash:passwordHash
        },error:null})};
    };
    supabase.rpc=async(name,args)=>{
      rpc++;
      assert.equal(name,'dealer_record_research_publication_review');
      assert.equal(args.p_reviewer_id,'reviewer-01');
      assert.ok(args.p_reason.length>=80);
      return {data:{decision:'PRELISTED_UNCLAIMED',
        revision:1,public:true},error:null};
    };
    await assert.rejects(service.reviewResearchSeed('ZW-DEAL-0001',actor,{
      decision:'PRELISTED_UNCLAIMED',reason,reviewer_password:'wrong-pw',
    }),/REAUTHENTICATION_FAILED/);
    assert.equal(rpc,0);
    await assert.rejects(service.reviewResearchSeed('ZW-DEAL-0001',actor,{
      decision:'PRELISTED_UNCLAIMED',
      reason:'Shorter than eighty characters but longer than twenty-five.',
      reviewer_password:password,
    }),/documented source/);
    assert.equal(rpc,0);
    const result=await service.reviewResearchSeed('ZW-DEAL-0001',actor,{
      decision:'PRELISTED_UNCLAIMED',reason,reviewer_password:password,
    });
    assert.equal(rpc,1);
    assert.equal(result.public,true);
  }finally{supabase.from=oldFrom;supabase.rpc=oldRpc}
});
