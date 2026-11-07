/**
 * CARUP-DEALER-ONB-001 D3–D6.
 * Canonical users/sessions + existing private 'ocr-documents' storage. No fabricated
 * compliance, tenant, logo, inventory, funding, licence or OCR verification.
 */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { supabase } from '../../db/supabase.js';
import { verifyPassword } from '../../utils/passwordAuth.js';
import {
  exportPrefilledDealerWorkbook,parseCompletedDealerWorkbook,researchPrefillCandidates,
} from './dealerWorkbookRoundtrip.js';
import {intakeFieldLabels} from './dealerIntakeWorkbook.js';

import {buildManualDealerWorkbook} from './dealerManualIntake.js';
import {inspectDealerCsvImport,stageConfirmedDealerCsv} from './dealerCsvIntake.js';
import {throwIfDealerSecurityRefusal} from './dealerSqlRefusalMapper.js';
import {assertReviewerNotConflicted,loadReviewerConflicts} from './dealerReviewerConflicts.js';

const DOCS=new Set(['COMPANY_REGISTRATION','DIRECTOR_AUTHORITY','SIGNATORY_MANDATE',
  'BRANCH_AUTHORITY','PARENT_COMPANY_AUTHORITY']);
const CAN_REVIEW=new Set(['admin','reviewer','platform_admin','super_admin']);
const MAX_EVIDENCE=6*1024*1024;
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deny(code,status=403){
  return Object.assign(new Error(code),{statusCode:status,code});
}
function validateId(id){if(typeof id!=='string'||!UUID.test(id))throw deny('INVALID_CLAIM_ID',400);return id;}
export function requireClaimantSession(actor){
  if(!actor?.userId||actor.authenticationMethod!=='session')
    throw deny('REAL_SESSION_REQUIRED',401);
  return actor.userId;
}
export function requireIndependentReviewer(actor,claimantId){
  requireClaimantSession(actor);
  if(!actor.isVerified||!CAN_REVIEW.has(actor.platformRole)||actor.userId===claimantId)
    throw deny('INDEPENDENT_VERIFIED_REVIEWER_REQUIRED');
}
function assertClaimOwner(claim,actor){
  if(!claim||claim.claimant_user_id!==actor.userId)
    throw deny('CLAIM_NOT_FOUND',404);
}
async function loadClaim(claimId){
  const {data,error}=await supabase.from('dealer_research_claim_requests')
    .select('claim_id,seed_dealer_id,claimant_user_id,claimed_scope,claim_status,asserted_legal_business_name')
    .eq('claim_id',validateId(claimId)).maybeSingle();
  if(error)throw deny('CLAIM_STORAGE_UNAVAILABLE',503);
  if(!data)throw deny('CLAIM_NOT_FOUND',404);
  return data;
}
async function loadSource(seedId){
  const {data,error}=await supabase.from('dealer_research_seed_records')
    .select('seed_dealer_id,source_row_sha256,source_snapshot,publication_eligibility')
    .eq('seed_dealer_id',seedId).maybeSingle();
  if(error)throw deny('RESEARCH_SOURCE_UNAVAILABLE',503);
  if(!data)throw deny('RESEARCH_SOURCE_MISSING',409);
  return data;
}
/**
 * R6 security review #5: per-reviewer (per user id) step-up lockout, IN ADDITION to the per-IP
 * sensitive route buckets. Shared across backend instances in PostgreSQL
 * (dealer_begin/complete_reviewer_step_up, migration 20261103145000):
 *   - at most 5 step-up attempts that do not succeed per reviewer per 15-minute window;
 *   - the 5th failure locks that reviewer's step-up for 15 minutes (HTTP 429 REVIEWER_STEP_UP_LOCKED);
 *   - each attempt is reserved BEFORE the password is verified, so parallel guesses cannot exceed 5;
 *   - a successful step-up resets the window, so success paths never lock a reviewer out.
 * The guard fails closed (503) if the shared counter is unavailable.
 */
export const REVIEWER_STEP_UP_LOCKOUT_POLICY=Object.freeze({
  max_unsuccessful_attempts:5,window_minutes:15,lockout_minutes:15,scope:'per_reviewer_user_id',
});
async function stepUpGuardRpc(db,name,args){
  let result;
  try{result=await db.rpc(name,args);}catch{throw deny('REVIEWER_STEP_UP_GUARD_UNAVAILABLE',503);}
  if(result?.error||!result?.data||typeof result.data!=='object')
    throw deny('REVIEWER_STEP_UP_GUARD_UNAVAILABLE',503);
  return result.data;
}
/** Password reauthentication is mandatory for reviewer decisions and private evidence reads.
 * Never accept CarUp's development passwordless fallback as a step-up authentication.
 */
export async function requireReviewerPassword(actor,claim,password,{db=supabase,verify=verifyPassword}={}){
  requireIndependentReviewer(actor,claim?.claimant_user_id);
  if(typeof password!=='string'||password.length<8)throw deny('REAUTHENTICATION_REQUIRED');
  const gate=await stepUpGuardRpc(db,'dealer_begin_reviewer_step_up',{p_reviewer_id:actor.userId});
  if(gate.allowed!==true){
    const retry=Number.isInteger(gate.retry_after_seconds)&&gate.retry_after_seconds>0
      ?gate.retry_after_seconds:REVIEWER_STEP_UP_LOCKOUT_POLICY.lockout_minutes*60;
    throw Object.assign(deny('REVIEWER_STEP_UP_LOCKED',429),{retryAfterSeconds:retry});
  }
  let verified=false;
  try{
    const {data:user,error}=await db.from('users')
      .select('id,password_hash,is_verified,role')
      .eq('id',actor.userId).maybeSingle();
    verified=Boolean(!error&&user&&user.password_hash&&user.is_verified&&
      CAN_REVIEW.has(user.role)&&await verify(password,user.password_hash));
  }catch{verified=false;}
  await stepUpGuardRpc(db,'dealer_complete_reviewer_step_up',
    {p_reviewer_id:actor.userId,p_succeeded:verified});
  if(!verified)throw deny('REAUTHENTICATION_FAILED');
}
export function decodeClaimDocument(base64,mimeType){
  if(typeof base64!=='string'||typeof mimeType!=='string' ||
    !['image/jpeg','image/png','application/pdf'].includes(mimeType))
    throw deny('INVALID_CLAIM_DOCUMENT',400);
  const match=/^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(base64);
  if(!match||match[1]!==mimeType||match[2].length>MAX_EVIDENCE*1.38+8)
    throw deny('INVALID_DOCUMENT_ENVELOPE',400);
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length<32||bytes.length>MAX_EVIDENCE||
    bytes.toString('base64').replace(/=+$/,'')!==match[2].replace(/=+$/,''))
    throw deny('INVALID_DOCUMENT_BYTES',400);
  const head=bytes.subarray(0,8);
  const valid=mimeType==='image/jpeg'
    ? head[0]===0xff&&head[1]===0xd8&&bytes.subarray(-2).equals(Buffer.from([0xff,0xd9]))
    : mimeType==='image/png'
      ? head.equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : head.subarray(0,5).toString('ascii')==='%PDF-'&&
        bytes.subarray(-2048).toString('latin1').includes('%%EOF');
  if(!valid)throw deny('DOCUMENT_MAGIC_MISMATCH',400);
  return bytes;
}
/**
 * Free local ClamAV scanner. If unavailable, error, timeout, or ambiguous output:
 * refuse to store evidence as "clean" — no fabricated safety or external API.
 */
export async function scanClaimBytesWithClamAv(bytes){
  return new Promise((resolve,reject)=>{
    const child=spawn('clamscan',['--no-summary','-'],{stdio:['pipe','pipe','pipe']});
    let ended=false,stdout='',stderr='';
    const timeout=setTimeout(()=>{if(!ended){child.kill('SIGKILL');ended=true;reject(deny('MALWARE_SCANNER_UNAVAILABLE',503));}},15000);
    function done(err,value){
      if(ended)return;
      ended=true;clearTimeout(timeout);
      if(err)reject(err);else resolve(value);
    }
    child.on('error',()=>done(deny('MALWARE_SCANNER_UNAVAILABLE',503)));
    child.stdout.on('data',v=>{stdout+=v.toString().slice(0,1000)});
    child.stderr.on('data',v=>{stderr+=v.toString().slice(0,300)});
    child.on('close',code=>{
      if(code===0 && /OK\s*$/m.test(stdout))return done(null,true);
      done(deny(code===1?'MALWARE_DETECTED':'MALWARE_SCANNER_UNAVAILABLE',code===1?400:503));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(bytes);
  });
}
export async function uploadPrivateClaimEvidence(claimId,actor,payload,{scan=scanClaimBytesWithClamAv}={}){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  // Claim approval grants only private applicant access; it does NOT finish
  // company compliance. Approved representatives must still supply original
  // incorporation, director, signatory and branch documents for separate
  // preliminary/legal review. They remain private, malware-scanned, immutable
  // and never become self-verified licence or tenant authority.
  if(!['AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_DISPUTED','CLAIM_APPEALED',
    'CLAIM_APPROVED'].includes(claim.claim_status))
    throw deny('CLAIM_EVIDENCE_INTAKE_CLOSED',409);
  if(!DOCS.has(payload?.document_class))throw deny('UNKNOWN_DOCUMENT_CLASS',400);
  const bytes=decodeClaimDocument(payload?.document,payload?.mime_type);
  const digest=SHA(bytes);
  const {data:existing,error:existingError}=await supabase.from('dealer_claim_private_evidence')
    .select('evidence_id,document_class,created_at,content_sha256')
    .eq('claim_id',claim.claim_id).eq('content_sha256',digest).maybeSingle();
  if(existingError)throw deny('EVIDENCE_LOOKUP_UNAVAILABLE',503);
  if(existing)return {evidence_id:existing.evidence_id,duplicate:true,
    document_class:existing.document_class,claim_id:claim.claim_id};
  if(!await scan(bytes))throw deny('MALWARE_SCANNER_UNAVAILABLE',503);
  const extension=payload.mime_type==='image/jpeg'?'jpg':payload.mime_type==='image/png'?'png':'pdf';
  const objectPath='dealership-claims/'+claim.claim_id+'/'+crypto.randomUUID()+'.'+extension;
  const {error:storageError}=await supabase.storage.from('ocr-documents')
    .upload(objectPath,bytes,{contentType:payload.mime_type,upsert:false});
  if(storageError)throw deny('PRIVATE_EVIDENCE_STORAGE_FAILED',503);
  const {data,error:dbError}=await supabase.from('dealer_claim_private_evidence')
    .insert({
      claim_id:claim.claim_id,uploader_user_id:actor.userId,
      document_class:payload.document_class,storage_path:objectPath,
      content_sha256:digest,mime_type:payload.mime_type,
      file_bytes:bytes.length,scan_state:'CLEAN_CLAMAV_AT_UPLOAD',
    }).select('evidence_id,claim_id,document_class,created_at').single();
  if(dbError){
    await supabase.storage.from('ocr-documents').remove([objectPath]).catch(()=>{});
    throw deny('PRIVATE_EVIDENCE_LEDGER_FAILED',503);
  }
  return {...data,duplicate:false,reviewed:false,verified:false};
}
export async function listMyClaimEvidence(claimId,actor){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  const {data,error}=await supabase.from('dealer_claim_private_evidence')
    .select('evidence_id,document_class,created_at,content_sha256')
    .eq('claim_id',claim.claim_id).order('created_at',{ascending:false}).limit(50);
  if(error)throw deny('EVIDENCE_LIST_UNAVAILABLE',503);
  return data||[];
}
export async function listReviewClaimEvidence(claimId,actor){
  const claim=await loadClaim(claimId);
  requireIndependentReviewer(actor,claim.claimant_user_id);
  // R6 closure: a reviewer who claims this business or works for its dealership sees nothing.
  await assertReviewerNotConflicted(actor,claim.seed_dealer_id);
  const {data,error}=await supabase.from('dealer_claim_private_evidence')
    .select('evidence_id,document_class,created_at,content_sha256')
    .eq('claim_id',claim.claim_id).order('created_at',{ascending:false}).limit(50);
  if(error)throw deny('REVIEW_EVIDENCE_LIST_UNAVAILABLE',503);
  return data||[];
}
export async function reviewerEvidencePreview(claimId,evidenceId,actor,password){
  const claim=await loadClaim(claimId);
  requireIndependentReviewer(actor,claim.claimant_user_id);
  // Refused before any step-up attempt is spent and before any signed link exists.
  await assertReviewerNotConflicted(actor,claim.seed_dealer_id);
  await requireReviewerPassword(actor,claim,password);
  validateId(evidenceId);
  const {data,error}=await supabase.from('dealer_claim_private_evidence')
    .select('evidence_id,claim_id,storage_bucket,storage_path,document_class,content_sha256')
    .eq('evidence_id',evidenceId).eq('claim_id',claim.claim_id).maybeSingle();
  if(error||!data)throw deny('REVIEW_EVIDENCE_NOT_FOUND',404);
  const {data:link,error:urlError}=await supabase.storage.from('ocr-documents')
    .createSignedUrl(data.storage_path,60);
  if(urlError||!link?.signedUrl)throw deny('REVIEW_EVIDENCE_UNAVAILABLE',503);
  return {evidence_id:data.evidence_id,document_class:data.document_class,
    sha256:data.content_sha256,expires_seconds:60,signed_url:link.signedUrl};
}
export async function reviewDealerClaim(claimId,actor,payload){
  const claim=await loadClaim(claimId);
  await requireReviewerPassword(actor,claim,payload?.reviewer_password);
  if(!['CLAIM_APPROVED','CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED'].includes(payload?.verdict))
    throw deny('INVALID_CLAIM_DECISION',400);
  if(typeof payload?.reason!=='string'||payload.reason.trim().length<40||payload.reason.length>3000)
    throw deny('REVIEW_REASON_REQUIRED',400);
  if(payload.verdict==='CLAIM_APPROVED' && (!UUID.test(payload?.evidence_id||'') ||
    typeof payload?.reviewed_issuer!=='string'||payload.reviewed_issuer.trim().length<3 ||
    payload?.verified_scope!==claim.claimed_scope))throw deny('REVIEWED_AUTHORITY_PROOF_REQUIRED',400);
  const {data,error}=await supabase.rpc('dealer_record_independent_claim_review',{
    p_claim_id:claim.claim_id,p_reviewer_id:actor.userId,p_verdict:payload.verdict,
    p_reason:payload.reason,p_evidence_id:payload.evidence_id||null,
    p_issuer:payload.reviewed_issuer||null,p_scope:payload.verified_scope||null,
  });
  if(error){throwIfDealerSecurityRefusal(error);throw deny('INDEPENDENT_CLAIM_REVIEW_REFUSED',409);}
  return data;
}
export async function submitClaimAppeal(claimId,actor,reason){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(!['CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED'].includes(claim.claim_status))
    throw deny('APPEAL_NOT_ELIGIBLE',409);
  if(typeof reason!=='string'||reason.trim().length<40||reason.length>3000)
    throw deny('APPEAL_REASON_REQUIRED',400);
  const {data,error}=await supabase.rpc('dealer_request_claim_appeal',{
    p_claim_id:claim.claim_id,p_appellant_id:actor.userId,p_reason:reason.trim(),
  });
  if(error)throw deny('APPEAL_CONFLICT_OR_UNAVAILABLE',409);
  return data;
}
export async function exportClaimPrefilledWorkbook(claimId,actor){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')throw deny('CLAIM_APPROVAL_REQUIRED',403);
  const source=await loadSource(claim.seed_dealer_id);
  const buffer=await exportPrefilledDealerWorkbook(claim,source);
  return {buffer,claim_id:claim.claim_id,source_sha256:source.source_row_sha256};
}
export async function importClaimWorkbook(claimId,actor,buffer,expectedVersion=0){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')throw deny('CLAIM_APPROVAL_REQUIRED',403);
  const source=await loadSource(claim.seed_dealer_id);
  const parsed=await parseCompletedDealerWorkbook(buffer,claim,source);
  if(!Number.isInteger(expectedVersion)||expectedVersion<0)
    throw deny('INVALID_EXPECTED_VERSION',400);
  const {data,error}=await supabase.rpc('dealer_save_claim_intake_draft',{
    p_claim_id:claim.claim_id,p_claimant_id:actor.userId,
    p_schema_version:parsed.document.schema,p_source_sha:source.source_row_sha256,
    p_workbook_sha:parsed.sha256,p_content:parsed.document,p_summary:parsed.record_counts,
    p_expected_version:expectedVersion,
  });
  if(error)throw deny('ATOMIC_DRAFT_IMPORT_REFUSED',409);
  return {receipt:data,record_counts:parsed.record_counts,
    legal_or_tenant_activation:false,verification_state:'NOT_VERIFIED'};
}
export async function saveManualClaimDraft(claimId,actor,patch,expectedVersion=0){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')throw deny('CLAIM_APPROVAL_REQUIRED',403);
  const source=await loadSource(claim.seed_dealer_id);
  if(!Number.isInteger(expectedVersion)||expectedVersion<0)
    throw deny('INVALID_EXPECTED_VERSION',400);
  const {data:previous,error:previousError}=await supabase.from('dealer_claim_intake_drafts')
    .select('content,submission_version')
    .eq('claim_id',claim.claim_id).eq('claimant_user_id',actor.userId).maybeSingle();
  if(previousError)throw deny('INTAKE_LOOKUP_UNAVAILABLE',503);
  if((previous?.submission_version||0)!==expectedVersion)
    throw deny('STALE_INTAKE_VERSION',409);
  const workbook=await buildManualDealerWorkbook(claim,source,patch,previous?.content||null);
  return importClaimWorkbook(claimId,actor,Buffer.from(await workbook.xlsx.writeBuffer()),expectedVersion);
}
/**
 * C03: legacy CSV preview and committed mapping are claim-scoped. No guessing,
 * no unrelated-source rows, no direct staff, role or VIN write.
 */
export async function previewMyClaimCsv(claimId,actor,csvBytes,tab){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')
    throw deny('CLAIM_APPROVAL_REQUIRED',403);
  return inspectDealerCsvImport(csvBytes,tab);
}
export async function importMyClaimCsv(claimId,actor,csvBytes,{
  target_tab,approved_mapping,acknowledge_mapping,csv_sha256,expected_version
}={}){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')
    throw deny('CLAIM_APPROVAL_REQUIRED',403);
  if(!Number.isInteger(expected_version)||expected_version<0)
    throw deny('INVALID_EXPECTED_VERSION',400);
  const source=await loadSource(claim.seed_dealer_id);
  const {data:existing,error:dbError}=await supabase.from('dealer_claim_intake_drafts')
    .select('content,submission_version').eq('claim_id',claim.claim_id)
    .eq('claimant_user_id',actor.userId).maybeSingle();
  if(dbError)throw deny('PRIVATE_DRAFT_UNAVAILABLE',503);
  if((existing?.submission_version||0)!==expected_version)
    throw deny('STALE_INTAKE_VERSION',409);
  const parsed=await stageConfirmedDealerCsv({
    bytes:csvBytes,tab:target_tab,approvedMapping:approved_mapping,
    acknowledged:acknowledge_mapping===true,expectedSha:csv_sha256,
    claim,source,previousDocument:existing?.content||null,
  });
  const {data,error}=await supabase.rpc('dealer_save_claim_intake_draft',{
    p_claim_id:claim.claim_id,p_claimant_id:actor.userId,
    p_schema_version:parsed.document.schema,p_source_sha:source.source_row_sha256,
    p_workbook_sha:parsed.sha256,p_content:parsed.document,
    p_summary:parsed.record_counts,p_expected_version:expected_version,
  });
  if(error)throw deny('ATOMIC_CSV_DRAFT_IMPORT_REFUSED',409);
  return {receipt:data,csv_sha256:parsed.csv_sha256,
    mapped_fields:Object.keys(parsed.source_header_mapping).length,
    mapping_confirmed:true,record_counts:parsed.record_counts,
    legal_or_tenant_activation:false,verified:false};
}

export async function readMyClaimIntakeDraft(claimId,actor){
  requireClaimantSession(actor);
  const claim=await loadClaim(claimId);
  assertClaimOwner(claim,actor);
  if(claim.claim_status!=='CLAIM_APPROVED')throw deny('CLAIM_APPROVAL_REQUIRED',403);
  const {data,error}=await supabase.from('dealer_claim_intake_drafts')
    .select('schema_version,content,submission_version,state,updated_at')
    .eq('claim_id',claim.claim_id).eq('claimant_user_id',actor.userId).maybeSingle();
  if(error)throw deny('INTAKE_READ_UNAVAILABLE',503);
  if(!data)return data;
  // Owner UAT D4: before freezing, the applicant reviews what CarUp read from their workbook and where
  // it differs from the research candidates THEIR OWN prefilled workbook carried (researchPrefillCandidates
  // returns exactly those values, no other research field). Best effort: a source read failure only
  // hides the comparison, never the applicant's saved draft.
  let research_candidates=null;
  try{research_candidates=researchPrefillCandidates(await loadSource(claim.seed_dealer_id));}
  catch{research_candidates=null;}
  return {...data,review_preview:{research_candidates,field_labels:intakeFieldLabels()}};
}
export async function listClaimReviewQueue(actor){
  requireIndependentReviewer(actor,'');
  const {data,error}=await supabase.from('dealer_research_claim_requests')
    .select('claim_id,seed_dealer_id,claimed_scope,claim_status,created_at')
    .order('created_at',{ascending:false}).limit(100);
  if(error)throw deny('REVIEW_QUEUE_UNAVAILABLE',503);
  const conflicts=await loadReviewerConflicts(actor);
  return (data||[]).filter(c=>!conflicts.conflicted(c.seed_dealer_id));
}
