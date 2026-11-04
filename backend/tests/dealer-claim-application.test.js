import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
const {hashPassword}=await import('../utils/passwordAuth.js');
const app=await import('../services/dealer/dealerClaimApplicationService.js');

const CLAIM_ID='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const EVIDENCE_ID='253d3ee5-ef31-45e0-b105-0b152f69a7dd';
const claimant={userId:'owner-1',authenticationMethod:'session',isVerified:true,platformRole:'member'};
const reviewer={userId:'reviewer-1',authenticationMethod:'session',isVerified:true,platformRole:'admin'};
const claim={claim_id:CLAIM_ID,seed_dealer_id:'ZW-DEAL-0001',claimant_user_id:'owner-1',
  claimed_scope:'BRANCH',claim_status:'AWAITING_DOCUMENTARY_EVIDENCE'};
function query(data){
  return {
    select(){return this},eq(){return this},
    maybeSingle:async()=>({data,error:null}),single:async()=>({data,error:null}),
  };
}
test('claimant identity rejects spoofed x-user-id development fallback',()=>{
  assert.throws(()=>app.requireClaimantSession({userId:'owner-1',authenticationMethod:'x-user-id-fallback'}),
    /REAL_SESSION_REQUIRED/);
  assert.equal(app.requireClaimantSession(claimant),'owner-1');
  assert.throws(()=>app.requireIndependentReviewer({...reviewer,userId:'owner-1'},'owner-1'),
    /INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
});
test('private company evidence rejects wrong MIME, bad magic and oversized document',()=>{
  assert.throws(()=>app.decodeClaimDocument('SGVsbG8=','application/pdf'),/INVALID_DOCUMENT_ENVELOPE/);
  const fake=Buffer.alloc(80);
  const data='data:application/pdf;base64,'+fake.toString('base64');
  assert.throws(()=>app.decodeClaimDocument(data,'application/pdf'),/DOCUMENT_MAGIC_MISMATCH/);
  assert.throws(()=>app.decodeClaimDocument('data:text/html;base64,'+fake.toString('base64'),'text/html'),
    /INVALID_CLAIM_DOCUMENT/);
});
test('independent claim reviewer requires real reauthentication, not KYC or role alone',async()=>{
  const old=supabase.from;
  const passwordHash=await hashPassword('CorrectHorseBatterySample1!');
  try{
    supabase.from=(table)=>{
      if(table!=='users')throw Error('Unexpected table '+table);
      return query({id:'reviewer-1',password_hash:passwordHash,is_verified:true,role:'admin'});
    };
    await assert.rejects(app.requireReviewerPassword(reviewer,claim,'wrong-password'),/REAUTHENTICATION_FAILED/);
    await assert.rejects(app.requireReviewerPassword(reviewer,claim,''),/REAUTHENTICATION_REQUIRED/);
    await assert.doesNotReject(app.requireReviewerPassword(reviewer,claim,'CorrectHorseBatterySample1!'));
    await assert.rejects(app.requireReviewerPassword({...reviewer,userId:'owner-1'},claim,'CorrectHorseBatterySample1!'),
      /INDEPENDENT_VERIFIED_REVIEWER_REQUIRED/);
  } finally{supabase.from=old}
});
test('review cannot auto grant tenant or claim status without independent proof',async()=>{
  const old=supabase.from;
  const oldRpc=supabase.rpc;
  const pw='CorrectHorseBatterySample1!';
  const passwordHash=await hashPassword(pw);
  let calls=0;
  try{
    supabase.from=(table)=>{
      if(table==='dealer_research_claim_requests')return query(claim);
      if(table==='users')return query({id:'reviewer-1',password_hash:passwordHash,is_verified:true,role:'admin'});
      throw Error('Unexpected table '+table);
    };
    supabase.rpc=async(name,payload)=>{
      assert.equal(name,'dealer_record_independent_claim_review');
      assert.equal(payload.p_reviewer_id,'reviewer-1');
      assert.equal(payload.p_evidence_id,EVIDENCE_ID);
      assert.equal(payload.p_scope,'BRANCH');
      calls++;
      return {data:{claim_id:CLAIM_ID,status:'CLAIM_APPROVED',
        dealer_operational:false,tenant_activated:false},error:null};
    };
    await assert.rejects(app.reviewDealerClaim(CLAIM_ID,reviewer,{
      reviewer_password:pw,verdict:'CLAIM_APPROVED',
      reason:'A human has checked the original and the issuing authority independently.',
      evidence_id:'made-up',reviewed_issuer:'Company Registry',verified_scope:'BRANCH',
    }),/REVIEWED_AUTHORITY_PROOF_REQUIRED/);
    assert.equal(calls,0);
    const outcome=await app.reviewDealerClaim(CLAIM_ID,reviewer,{
      reviewer_password:pw,verdict:'CLAIM_APPROVED',
      reason:'A human has checked the original and the issuing authority independently.',
      evidence_id:EVIDENCE_ID,reviewed_issuer:'Company Registry',verified_scope:'BRANCH',
    });
    assert.equal(calls,1);
    assert.equal(outcome.tenant_activated,false);
    assert.equal(outcome.dealer_operational,false);
  } finally{supabase.from=old;supabase.rpc=oldRpc}
});
test('approved workbook export refuses a different claimant and a pending claim',async()=>{
  const old=supabase.from;
  try {
    supabase.from=table=>{
      if(table==='dealer_research_claim_requests')return query(claim);
      throw Error('Unexpected table '+table);
    };
    await assert.rejects(app.exportClaimPrefilledWorkbook(CLAIM_ID,{...claimant,userId:'attacker'}),
      /CLAIM_NOT_FOUND/);
    await assert.rejects(app.exportClaimPrefilledWorkbook(CLAIM_ID,claimant),
      /CLAIM_APPROVAL_REQUIRED/);
  }finally{supabase.from=old}
});
test('raw evidence cannot be accepted without clean independent malware scanner',async()=>{
  const old=supabase.from;
  const fake=Buffer.alloc(72);fake[0]=0xff;fake[1]=0xd8;fake[70]=0xff;fake[71]=0xd9;
  const b64='data:image/jpeg;base64,'+fake.toString('base64');
  try{
    supabase.from=table=>{
      if(table==='dealer_research_claim_requests')return query(claim);
      if(table==='dealer_claim_private_evidence')return query(null);
      throw Error('Unexpected table '+table);
    };
    await assert.rejects(app.uploadPrivateClaimEvidence(CLAIM_ID,claimant,{
      document_class:'COMPANY_REGISTRATION',mime_type:'image/jpeg',document:b64,
    },{scan:async()=>false}),/MALWARE_SCANNER_UNAVAILABLE/);
  }finally{supabase.from=old}
});

test('approved claimant can supply later private legal originals, but revoked or rejected claims cannot',async()=>{
  const old=supabase.from;
  const fake=Buffer.alloc(72);
  fake[0]=0xff;fake[1]=0xd8;fake[70]=0xff;fake[71]=0xd9;
  const input={document_class:'SIGNATORY_MANDATE',mime_type:'image/jpeg',
    document:'data:image/jpeg;base64,'+fake.toString('base64')};
  let status='CLAIM_APPROVED',scanCalls=0;
  try{
    supabase.from=table=>{
      if(table==='dealer_research_claim_requests')
        return query({...claim,claim_status:status});
      if(table==='dealer_claim_private_evidence')return query(null);
      throw Error('Unexpected private table '+table);
    };
    // An APPROVED claim is not legal approval. The original is still
    // ClamAV scanned and must not silently become verified.
    await assert.rejects(app.uploadPrivateClaimEvidence(CLAIM_ID,claimant,input,{
      scan:async()=>{scanCalls++;return false},
    }),/MALWARE_SCANNER_UNAVAILABLE/);
    assert.equal(scanCalls,1);
    for(const closed of ['CLAIM_REJECTED','CLAIM_REVOKED']){
      status=closed;
      await assert.rejects(app.uploadPrivateClaimEvidence(CLAIM_ID,claimant,input,{
        scan:async()=>{scanCalls++;return true},
      }),/CLAIM_EVIDENCE_INTAKE_CLOSED/);
    }
    assert.equal(scanCalls,1,'no document scan/storage for terminated claims');
    status='CLAIM_APPROVED';
    await assert.rejects(app.uploadPrivateClaimEvidence(CLAIM_ID,{
      ...claimant,userId:'another-actor',
    },input,{scan:async()=>{scanCalls++;return true}}),/CLAIM_NOT_FOUND/);
    assert.equal(scanCalls,1,'approved claimant remains owner-scoped');
  }finally{supabase.from=old}
});
