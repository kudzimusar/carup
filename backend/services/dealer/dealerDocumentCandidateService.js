/**
 * CARUP-DEALER-ONB-001 D5 — local-only, candidate-only dealer document extraction.
 * Original evidence custody belongs to dealerClaimApplicationService. This module
 * consumes only that already-scanned private object; never grants a legal identity,
 * a licence, a role, a tenant, a public badge or a compliance decision.
 *
 * No remote OCR APIs. Local tools require explicit operator opt-in, sandboxed
 * operating-system execution, installed poppler and Tesseract and runtime review.
 * Unavailable providers and ambiguous documents yield manual review, NOT success.
 */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { supabase } from '../../db/supabase.js';
import { decodeClaimDocument,requireClaimantSession } from './dealerClaimApplicationService.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=6*1024*1024, MAX_PAGES=5, MAX_TOOL_OUTPUT=1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(code,status=400)=>Object.assign(new Error(code),{statusCode:status});
const STATES=new Set(['PROVIDER_NOT_ENABLED','PROVIDER_UNAVAILABLE','UNREADABLE','CANDIDATE_REVIEW']);
export const CANDIDATE_SCHEMA='CARUP_DEALER_OCR_CANDIDATE_1_0';
export const OBSERVABLE_FIELDS=Object.freeze([
  'legal_name','registration_number','registration_issuer',
  'tax_reference','physical_address','issued_at','expires_at'
]);
const FIELD_LINES=Object.freeze({
  legal_name:/^(?:registered (?:company|business) name|legal name)\s*:\s*(.+)$/i,
  registration_number:/^(?:registration (?:no\.?|number)|company (?:no\.?|number))\s*:\s*(.+)$/i,
  registration_issuer:/^(?:registered by|issued by|registration authority)\s*:\s*(.+)$/i,
  tax_reference:/^(?:tax (?:no\.?|number|reference))\s*:\s*(.+)$/i,
  physical_address:/^(?:registered (?:office )?address|physical address)\s*:\s*(.+)$/i,
  issued_at:/^(?:date (?:of )?issue|issued on)\s*:\s*(.+)$/i,
  expires_at:/^(?:expiry date|expiration date|expires on)\s*:\s*(.+)$/i,
});
function normalizeValue(raw){
  const value=String(raw||'').trim().replace(/\s+/g,' ');
  if(value.length<2||value.length>180||/[\x00-\x1f]/.test(value))return null;
  return value;
}
function isoDate(value){
  if(!/^\d{4}-\d\d-\d\d$/.test(value))return null;
  const d=new Date(value+'T00:00:00Z');
  return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value?value:null;
}
export function extractObservedCandidates(pages){
  if(!Array.isArray(pages)||pages.length>MAX_PAGES)throw fail('INVALID_OCR_PAGES');
  const fields={};const review_flags=[];
  for(const [index,page] of pages.entries()){
    if(typeof page!=='string')throw fail('INVALID_OCR_PAGE');
    for(const line of page.split(/\r?\n/).slice(0,1200)){
      const clean=line.trim();
      for(const key of OBSERVABLE_FIELDS){
        const match=FIELD_LINES[key].exec(clean);
        if(!match)continue;
        const value=normalizeValue(match[1]);
        if(!value){review_flags.push(key.toUpperCase()+'_UNREADABLE');continue;}
        if(['issued_at','expires_at'].includes(key)&&!isoDate(value)){
          review_flags.push(key.toUpperCase()+'_AMBIGUOUS_DATE');continue;
        }
        if(fields[key]&&fields[key].value!==value){
          review_flags.push(key.toUpperCase()+'_CONFLICTING_PAGES');continue;
        }
        // No imaginary OCR confidence, regulator validation or issuer assurance.
        fields[key]={value,page:index+1,confidence:null,source:'OBSERVED_LOCAL_OCR'};
      }
    }
  }
  return {fields,review_flags:[...new Set(review_flags)].slice(0,25)};
}
export function candidateMismatchFlags(fields,declared={}){
  const flags=[];
  for(const field of ['legal_name','registration_number','physical_address']){
    const observed=fields?.[field]?.value, expected=declared?.[field];
    if(typeof observed==='string'&&typeof expected==='string'&&expected.trim()&&
        observed.replace(/\s+/g,' ').trim().toLocaleLowerCase('en')!==
        expected.replace(/\s+/g,' ').trim().toLocaleLowerCase('en'))
      flags.push(field+'_DIFFERS_FROM_DECLARATION');
  }
  return flags;
}
/** One bounded child process, no shell, no remote calls, no temp file paths. */
export function invokeLocalOcrTool(executable,args,stdin,{timeoutMs=10000}={}){
  return new Promise((resolve,reject)=>{
    let finished=false,bytes=0;const chunks=[];
    const child=spawn(executable,args,{stdio:['pipe','pipe','pipe'],shell:false});
    const done=(err,result)=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      if(err)reject(err);else resolve(result);
    };
    const timer=setTimeout(()=>{
      child.kill('SIGKILL');
      done(fail('OCR_PROVIDER_UNAVAILABLE',503));
    },timeoutMs);
    child.on('error',()=>done(fail('OCR_PROVIDER_UNAVAILABLE',503)));
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>MAX_TOOL_OUTPUT){
        child.kill('SIGKILL');
        done(fail('OCR_PROVIDER_UNAVAILABLE',503));
      }else chunks.push(chunk);
    });
    child.stderr.on('data',()=>{}); // Never expose document text through logs.
    child.on('close',code=>{
      if(code!==0)return done(fail('OCR_PROVIDER_UNAVAILABLE',503));
      done(null,Buffer.concat(chunks));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(stdin);
  });
}
/**
 * Do not mistake a PDF for one image. pdfinfo must prove page count; every
 * page is rasterized and OCR'd. PDF>5 pages fails to explicit manual review.
 */
export async function runLocalCandidateOcr(bytes,mime,{
  enabled=process.env.CARUP_DEALER_OCR_LOCAL_ENABLED==='true',
  runner=invokeLocalOcrTool
}={}){
  if(!enabled)return {state:'PROVIDER_NOT_ENABLED',pages_processed:0,fields:{},review_flags:[]};
  const pages=[];
  try{
    if(mime==='application/pdf'){
      const info=(await runner('pdfinfo',['-'],bytes)).toString('utf8');
      const match=/^Pages:\s*(\d+)\s*$/mi.exec(info);
      if(!match||Number(match[1])<1||Number(match[1])>MAX_PAGES)
        return {state:'UNREADABLE',pages_processed:0,fields:{},
          review_flags:['PDF_PAGE_COUNT_NOT_QUALIFIED']};
      for(let p=1;p<=Number(match[1]);p++){
        const png=await runner('pdftoppm',['-f',String(p),'-l',String(p),
          '-singlefile','-png','-scale-to','2048','-'],bytes);
        if(png.length<32||!png.subarray(0,8).equals(
          Buffer.from([137,80,78,71,13,10,26,10])))
          return {state:'UNREADABLE',pages_processed:pages.length,fields:{},
            review_flags:['PDF_PAGE_RENDER_FAILED']};
        const text=(await runner('tesseract',['stdin','stdout','--psm','6','-l','eng'],png)).toString('utf8');
        pages.push(text);
      }
    }else if(mime==='image/jpeg'||mime==='image/png'){
      pages.push((await runner('tesseract',['stdin','stdout','--psm','6','-l','eng'],bytes)).toString('utf8'));
    }else throw fail('UNSUPPORTED_OCR_DOCUMENT');
  }catch{
    return {state:'PROVIDER_UNAVAILABLE',pages_processed:pages.length,fields:{},
      review_flags:['LOCAL_PROVIDER_FAILED_MANUAL_REVIEW_REQUIRED']};
  }
  const {fields,review_flags}=extractObservedCandidates(pages);
  return {state:Object.keys(fields).length?'CANDIDATE_REVIEW':'UNREADABLE',
    pages_processed:pages.length,fields,review_flags};
}
function assertActor(actor){requireClaimantSession(actor);return actor.userId;}
function assertUuid(id){if(typeof id!=='string'||!UUID.test(id))throw fail('INVALID_EVIDENCE_REFERENCE');return id;}
/** Never disclose private raw OCR text or direct storage paths in the receipt. */
export async function createClaimDocumentCandidate(claimId,evidenceId,actor,{
  extractor=runLocalCandidateOcr
}={}){
  const userId=assertActor(actor);assertUuid(claimId);assertUuid(evidenceId);
  const {data:claim,error:claimError}=await supabase.from('dealer_research_claim_requests')
    .select('claim_id,claimant_user_id,claim_status')
    .eq('claim_id',claimId).maybeSingle();
  if(claimError)throw fail('CLAIM_LOOKUP_UNAVAILABLE',503);
  if(!claim||claim.claimant_user_id!==userId)throw fail('CLAIM_NOT_FOUND',404);
  if(!['AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_APPROVED','CLAIM_DISPUTED','CLAIM_APPEALED']
    .includes(claim.claim_status))throw fail('CLAIM_EVIDENCE_INTAKE_CLOSED',409);
  const {data:evidence,error:evidenceError}=await supabase.from('dealer_claim_private_evidence')
    .select('evidence_id,claim_id,storage_bucket,storage_path,content_sha256,mime_type,file_bytes,scan_state,document_class')
    .eq('claim_id',claimId).eq('evidence_id',evidenceId).maybeSingle();
  if(evidenceError)throw fail('EVIDENCE_LOOKUP_UNAVAILABLE',503);
  if(!evidence||evidence.claim_id!==claimId||
    evidence.scan_state!=='CLEAN_CLAMAV_AT_UPLOAD'||evidence.storage_bucket!=='ocr-documents'||
    !/^dealership-claims\/[0-9a-f-]+\/[0-9a-f-]+\.(jpg|png|pdf)$/.test(evidence.storage_path))
    throw fail('PRIVATE_EVIDENCE_NOT_FOUND',404);
  if(!Number.isInteger(evidence.file_bytes)||evidence.file_bytes>MAX_BYTES)
    throw fail('EVIDENCE_UNSAFE_BYTES',409);
  const {data:stored,error:storageError}=await supabase.storage.from('ocr-documents')
    .download(evidence.storage_path);
  if(storageError||!stored||typeof stored.arrayBuffer!=='function')
    throw fail('PRIVATE_ORIGINAL_UNAVAILABLE',503);
  const bytes=Buffer.from(await stored.arrayBuffer());
  if(bytes.length!==evidence.file_bytes||sha(bytes)!==evidence.content_sha256)
    throw fail('ORIGINAL_EVIDENCE_HASH_MISMATCH',409);
  // Recheck MIME against bytes before passing the original to any decoder.
  decodeClaimDocument('data:'+evidence.mime_type+';base64,'+bytes.toString('base64'),evidence.mime_type);
  const result=await extractor(bytes,evidence.mime_type);
  if(!result||!STATES.has(result.state)||
    !Number.isInteger(result.pages_processed)||result.pages_processed<0||
    result.pages_processed>MAX_PAGES || !result.fields || typeof result.fields!=='object')
    throw fail('INVALID_OCR_PROVIDER_RESULT',503);
  const output=Object.fromEntries(OBSERVABLE_FIELDS.filter(k=>Object.hasOwn(result.fields,k))
    .map(k=>[k,result.fields[k]]));
  for(const [key,v] of Object.entries(output)){
    if(!v||typeof v.value!=='string'||v.value.length>180||
      !Number.isInteger(v.page)||v.page<1||v.page>MAX_PAGES||
      v.confidence!==null||v.source!=='OBSERVED_LOCAL_OCR')
      throw fail('UNQUALIFIED_OCR_FIELD',503);
  }
  const {data:receipt,error:rpcError}=await supabase.rpc('dealer_record_candidate_document_extraction',{
    p_claim_id:claimId,p_evidence_id:evidenceId,p_claimant_id:userId,
    p_evidence_sha:evidence.content_sha256,p_state:result.state,
    p_fields:output,p_pages:result.pages_processed,
    p_flags:Array.isArray(result.review_flags)?result.review_flags.slice(0,25):[],
    p_engine:'LOCAL_TESSERACT_V1',
  });
  if(rpcError||!receipt)throw fail('OCR_AUDIT_PERSISTENCE_UNAVAILABLE',503);
  return {receipt,fields:output,review_flags:Array.isArray(result.review_flags)?
    result.review_flags.slice(0,25):[],confidence:null,
    verified:false,legal_approval:false,tenant_activated:false};
}
export async function listMyClaimDocumentCandidates(claimId,actor){
  const userId=assertActor(actor);assertUuid(claimId);
  const {data:claim,error}=await supabase.from('dealer_research_claim_requests')
    .select('claimant_user_id').eq('claim_id',claimId).maybeSingle();
  if(error)throw fail('CLAIM_LOOKUP_UNAVAILABLE',503);
  if(!claim||claim.claimant_user_id!==userId)throw fail('CLAIM_NOT_FOUND',404);
  const {data, error:readError}=await supabase.from('dealer_claim_document_ocr_events')
    .select('event_id,evidence_id,document_class,extraction_state,extracted_fields,review_flags,pages_processed,created_at')
    .eq('claim_id',claimId).order('created_at',{ascending:false}).limit(50);
  if(readError)throw fail('OCR_CANDIDATE_LOOKUP_UNAVAILABLE',503);
  return (data||[]).map(r=>({...r,verified:false,legal_approval:false}));
}
