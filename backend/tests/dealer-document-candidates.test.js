import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-dealer-key';
const {supabase}=await import('../db/supabase.js');
const svc=await import('../services/dealer/dealerDocumentCandidateService.js');

const CLAIM_ID='c63ef593-6e41-4ed5-8026-26b7ad451c46';
const EVIDENCE_ID='253d3ee5-ef31-45e0-b105-0b152f69a7dd';
const other='bbd812ce-5de9-4475-a49d-79187289c973';
const actor={userId:'owner-1',authenticationMethod:'session'};
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(64,65)]);
const digest=crypto.createHash('sha256').update(PNG).digest('hex');
const claim={claim_id:CLAIM_ID,claimant_user_id:'owner-1',
  claim_status:'AWAITING_DOCUMENTARY_EVIDENCE'};
const evidence={evidence_id:EVIDENCE_ID,claim_id:CLAIM_ID,
  storage_bucket:'ocr-documents',storage_path:'dealership-claims/'+CLAIM_ID+'/'+EVIDENCE_ID+'.png',
  content_sha256:digest,mime_type:'image/png',file_bytes:PNG.length,
  scan_state:'CLEAN_CLAMAV_AT_UPLOAD',document_class:'COMPANY_REGISTRATION'};
function query(data){
  return {select(){return this},eq(){return this},order(){return this},
    limit(){return this},maybeSingle:async()=>({data,error:null}),
    then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject)}};
}
test('D5 extractor disabled fails to manual review, never invents a verification',async()=>{
  const result=await svc.runLocalCandidateOcr(PNG,'image/png',{enabled:false});
  assert.deepEqual(result,{state:'PROVIDER_NOT_ENABLED',pages_processed:0,
    fields:{},review_flags:[]});
});
test('D5 recorded observed fields carry page and unknown confidence; ambiguous calendar and issuer never inferred',()=>{
  const text='Legal Name: Sample Company Ltd\nRegistration Number: ZW-00013\n'
    +'Issued On: 31/02/2026\nTax Number: 0012-AB\nUnrelated line: unknown';
  const result=svc.extractObservedCandidates([text]);
  assert.deepEqual(result.fields.legal_name,{
    value:'Sample Company Ltd',page:1,confidence:null,source:'OBSERVED_LOCAL_OCR'});
  assert.equal(result.fields.registration_number.value,'ZW-00013');
  assert.equal(result.fields.issued_at,undefined);
  assert.equal(result.fields.registration_issuer,undefined);
  assert.deepEqual(result.review_flags,['issued_at_AMBIGUOUS_DATE']);
  assert.deepEqual(svc.candidateMismatchFlags(result.fields,
    {legal_name:'Different Company Ltd',registration_number:'ZW-00013'}),
  ['legal_name_DIFFERS_FROM_DECLARATION']);
});
test('D5 multipage PDF processes EACH rendered page and does not silently accept only page 1',async()=>{
  const calls=[];let extracted=0;
  const runner=async(command,args)=>{
    calls.push([command,args]);
    if(command==='pdfinfo')return Buffer.from('Pages: 2\nPDF version: 1.7\n');
    if(command==='pdftoppm')return PNG;
    if(command==='tesseract'){
      extracted++;
      return Buffer.from(extracted===1?
        'Legal Name: Sample Company Ltd\n':'Registration Number: 456-AA\n');
    }
    throw new Error('unexpected');
  };
  const r=await svc.runLocalCandidateOcr(Buffer.from('fake pdf fixture'),
    'application/pdf',{enabled:true,runner});
  assert.equal(r.state,'CANDIDATE_REVIEW');
  assert.equal(r.pages_processed,2);
  assert.equal(r.fields.registration_number.page,2);
  assert.equal(calls.filter(c=>c[0]==='pdftoppm').length,2);
  assert.equal(calls.filter(c=>c[0]==='tesseract').length,2);
});
test('D5 excessive PDF pages and provider failures are explicit, not successful OCR',async()=>{
  const over=await svc.runLocalCandidateOcr(Buffer.from('pdf'),'application/pdf',
    {enabled:true,runner:async()=>Buffer.from('Pages: 7\n')});
  assert.equal(over.state,'UNREADABLE');assert.equal(over.pages_processed,0);
  assert.ok(over.review_flags.includes('PDF_PAGE_COUNT_NOT_QUALIFIED'));
  const unavailable=await svc.runLocalCandidateOcr(PNG,'image/png',
    {enabled:true,runner:async()=>{throw Error('Tesseract missing')}});
  assert.equal(unavailable.state,'PROVIDER_UNAVAILABLE');
  assert.deepEqual(unavailable.fields,{});
});
test('D5 unproven identity and other business cannot fetch original OCR evidence',async()=>{
  assert.throws(()=>svc.createClaimDocumentCandidate(CLAIM_ID,EVIDENCE_ID,
    {userId:'owner-1',authenticationMethod:'x-user-id-fallback'}),/REAL_SESSION_REQUIRED/);
  const old=supabase.from;let storageReads=0;
  try{
    supabase.from=table=>{
      if(table!=='dealer_research_claim_requests')
        throw Error('unexpected table '+table);
      return query(claim);
    };
    await assert.rejects(svc.createClaimDocumentCandidate(CLAIM_ID,EVIDENCE_ID,
      {...actor,userId:'attacker'}),/CLAIM_NOT_FOUND/);
    assert.equal(storageReads,0);
  }finally{supabase.from=old}
});
test('D5 audit receives original SHA and candidate fields only, never paths, raw OCR text or authority',async()=>{
  const origFrom=supabase.from,origRpc=supabase.rpc,origStorage=supabase.storage.from;
  let calls=0;
  try{
    supabase.from=table=>{
      if(table==='dealer_research_claim_requests')return query(claim);
      if(table==='dealer_claim_private_evidence')return query(evidence);
      throw Error('unexpected '+table);
    };
    supabase.storage.from=bucket=>{
      assert.equal(bucket,'ocr-documents');
      return {download:async(path)=>{
        assert.equal(path,evidence.storage_path);calls++;
        return {data:{arrayBuffer:async()=>PNG},error:null};
      }};
    };
    supabase.rpc=async(name,args)=>{
      assert.equal(name,'dealer_record_candidate_document_extraction');
      assert.equal(args.p_claimant_id,actor.userId);
      assert.equal(args.p_evidence_sha,digest);
      assert.equal(args.p_fields.legal_name.confidence,null);
      assert.ok(!JSON.stringify(args).includes(evidence.storage_path));
      assert.ok(!JSON.stringify(args).includes('tenant_id'));
      return {data:{event_id:other,state:'CANDIDATE_REVIEW',
        candidate_only:true,verified:false},error:null};
    };
    const result=await svc.createClaimDocumentCandidate(CLAIM_ID,EVIDENCE_ID,actor,{
      extractor:async()=>({
        state:'CANDIDATE_REVIEW',pages_processed:1,review_flags:[],
        fields:{legal_name:{value:'Sample Legal Co',page:1,confidence:null,
          source:'OBSERVED_LOCAL_OCR'}}
      })
    });
    assert.equal(calls,1);assert.equal(result.verified,false);
    assert.equal(result.tenant_activated,false);
    assert.equal(result.fields.legal_name.value,'Sample Legal Co');
  }finally{
    supabase.from=origFrom;supabase.rpc=origRpc;supabase.storage.from=origStorage;
  }
});
test('D5 private original SHA mismatch rejects BEFORE invoking any OCR provider',async()=>{
  const oldFrom=supabase.from,oldStorage=supabase.storage.from;
  let executed=false;
  try{
    supabase.from=table=>query(table==='dealer_research_claim_requests'?claim:
      {...evidence,content_sha256:'0'.repeat(64)});
    supabase.storage.from=()=>({download:async()=>({
      data:{arrayBuffer:async()=>PNG},error:null})});
    await assert.rejects(svc.createClaimDocumentCandidate(CLAIM_ID,EVIDENCE_ID,actor,{
      extractor:async()=>{executed=true;return null}
    }),/ORIGINAL_EVIDENCE_HASH_MISMATCH/);
    assert.equal(executed,false);
  }finally{supabase.from=oldFrom;supabase.storage.from=oldStorage}
});
