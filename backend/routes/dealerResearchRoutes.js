/**
 * CARUP-DEALER-ONB-001: research/publication and prospective claim routes.
 * Research is NOT a self-service dealer-approval service. Claims grant NO roles.
 */
import express from 'express';
import { exportBlankDealerIntakeXlsx } from '../services/dealer/dealerIntakeWorkbook.js';
import {
  uploadPrivateClaimEvidence,listMyClaimEvidence,reviewerEvidencePreview,
  reviewDealerClaim,submitClaimAppeal,exportClaimPrefilledWorkbook,
  importClaimWorkbook,saveManualClaimDraft,readMyClaimIntakeDraft,listClaimReviewQueue,listReviewClaimEvidence,
  previewMyClaimCsv,importMyClaimCsv,
} from '../services/dealer/dealerClaimApplicationService.js';
import { createClaimDocumentCandidate,listMyClaimDocumentCandidates } from '../services/dealer/dealerDocumentCandidateService.js';
import {readMyClaimJurisdictionPreview} from '../services/dealer/dealerJurisdictionPreview.js';
import {listFullStorefrontReviewQueue,recordFullStorefrontPublication,
  previewFullStorefrontCandidate} from '../services/dealer/dealerFullStorefrontService.js';
import {
  listLegalCountryPolicyReadiness,listPendingLegalDealershipCases,listPendingLegalDealerActivations,
  certifyLegalDealerCase,activateLegallyApprovedDealer,
  readMyOperationalDealerAuthority
} from '../services/dealer/dealerLegalActivationService.js';
import {
  submitDealerApplication,listMyDealerApplicationSubmissions,
  listDealerComplianceReviewQueue,previewDealerComplianceCase,
  recordDealerPreliminaryReview,
} from '../services/dealer/dealerComplianceApplicationService.js';
import {
  listMyCanonicalDealerFeedbackContext,submitMyPrivateDealerFeedback,
  listPrivateBuyerCaseReviewQueue,previewPrivateBuyerCase,
  recordPrivateBuyerCaseFinding,
} from '../services/dealer/dealerBuyerFeedbackService.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import {
  getPublicResearch,
  listPublicResearch,
  reviewResearchSeed,
  listResearchReviewQueue,
  recordResearchGroupingReview,recordResearchContactReview,getReviewedPublicResearchContacts,
  submitResearchClaim,
  listOwnResearchClaims,
  requestResearchCorrection,
  listResearchCorrectionsForReviewer,
} from '../services/dealer/dealerResearchService.js';

const router = express.Router();
const publicReadLimit = rateLimiter({ max: 40, windowMs: 60 * 1000, isSensitive: false });
// A legitimate complete application needs claim + originals + spreadsheet +
 // immutable submission. Keep each class at four sensitive operations/hour/IP,
 // AND retain an eight-write/hour/IP total claimant safety ceiling. Unlike the
 // former single four-write budget, independent evidence and intake steps cannot
 // silently make an otherwise valid submission impossible. Every write remains
 // authenticated and independently authorized by its existing service.
 const claimWriteLimit = rateLimiter({max:4,windowMs:3600000,isSensitive:true,bucket:'dealer-claim-control'});
 const evidenceWriteLimit = rateLimiter({max:4,windowMs:3600000,isSensitive:true,bucket:'dealer-private-evidence'});
 const applicationWriteLimit = rateLimiter({max:4,windowMs:3600000,isSensitive:true,bucket:'dealer-application-intake'});
 const claimantAggregateLimit = rateLimiter({max:8,windowMs:3600000,isSensitive:true,bucket:'dealer-claimant-total'});
const reviewWriteLimit = rateLimiter({ max: 15, windowMs: 60 * 60 * 1000, isSensitive: true });
const buyerCaseWriteLimit = rateLimiter({max:4,windowMs:3600000,
  isSensitive:true,bucket:'dealer-buyer-feedback'});
const buyerReviewWriteLimit = rateLimiter({max:12,windowMs:3600000,
  isSensitive:true,bucket:'dealer-independent-buyer-case-review'});
const session = authorizeSessionRole([]);
const reviewer = authorizeSessionRole(['admin','reviewer']);

function errorResponse(res, next, error) {
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  next(error);
}

// C08–C12: separate legal and final canonical activation authorities.
// No applicant direct approve/activate and no country-policy approval endpoint.
router.get('/api/dealership/claims/:claimId/operational-authority',
  session,async(req,res,next)=>{
  try{
    const authority=await readMyOperationalDealerAuthority(
      req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({authority});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/legal-policy/readiness',
  reviewer,async(req,res,next)=>{
  try{
    const policies=await listLegalCountryPolicyReadiness(req.userContext);
    res.set('Cache-Control','no-store').json({policies});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/legal-cases',
  reviewer,async(req,res,next)=>{
  try{
    const cases=await listPendingLegalDealershipCases(req.userContext);
    res.set('Cache-Control','no-store').json({cases});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/legal-cases/:submissionId/review',
  reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const review=await certifyLegalDealerCase(
      req.params.submissionId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/legal-approvals/queue',
  reviewer,async(req,res,next)=>{
  try{
    const cases=await listPendingLegalDealerActivations(req.userContext);
    res.set('Cache-Control','no-store').json({cases});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/legal-approvals/:legalReviewId/activate',
  reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const activation=await activateLegallyApprovedDealer(
      req.params.legalReviewId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({activation});
  }catch(error){errorResponse(res,next,error)}
});

// The blank customer-facing workbook never includes internal research or privileged data.
// Claim-specific, prefilled workbook export remains unavailable until independent approval.
router.get('/api/dealership/intake/template', publicReadLimit, async (_req,res,next) => {
  try {
    const buffer = await exportBlankDealerIntakeXlsx();
    res.set('Cache-Control','no-store')
      .set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition','attachment; filename="carup-dealer-intake-v1-blank.xlsx"')
      .status(200).send(buffer);
  } catch (error) { next(error); }
});

// Only reviewed, unsuppressed, non-disputed research publications appear here.
router.get('/api/dealership/research', publicReadLimit, async (req,res,next) => {
  try {
    const output = await listPublicResearch({
      q: req.query.q, city: req.query.city, page: req.query.page, limit: req.query.limit,
    });
    res.set('Cache-Control','no-store').json(output);
  } catch (error) { errorResponse(res,next,error); }
});

// Reviewed public source contact data only, strictly tied to current publication.
router.get('/api/dealership/research/:seedId/contact',publicReadLimit,async(req,res,next)=>{
  try{
    const contacts=await getReviewedPublicResearchContacts(req.params.seedId);
    if(!contacts)return res.status(404).json({error:'Research listing unavailable'});
    res.set('Cache-Control','no-store').json({contacts});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/dealership/research/:seedId', publicReadLimit, async (req,res,next) => {
  try {
    const profile = await getPublicResearch(req.params.seedId);
    if (!profile) return res.status(404).json({ error:'Research listing not published' });
    res.set('Cache-Control','no-store').json({ profile });
  } catch (error) { errorResponse(res,next,error); }
});

// Correction or removal concerns are queued privately; no unreviewed request can
// hide, reassign or alter another dealership's public listing.
router.post('/api/dealership/research/:seedId/corrections', claimantAggregateLimit,claimWriteLimit, async (req,res,next) => {
  try {
    const request = await requestResearchCorrection(req.params.seedId,req.body || {});
    res.set('Cache-Control','no-store').status(202).json({ request });
  } catch (error) { errorResponse(res,next,error); }
});

router.get('/api/admin/dealership/research/corrections', reviewer, async (req,res,next) => {
  try {
    res.set('Cache-Control','no-store').json({
      requests: await listResearchCorrectionsForReviewer(req.userContext),
    });
  } catch (error) { errorResponse(res,next,error); }
});

// A signed-in representative can signal a claim and start evidence review.
// NO tenant/role/verified status or access to a private prefilled workbook.
router.post('/api/dealership/research/:seedId/claim', claimantAggregateLimit,claimWriteLimit, session, async (req,res,next) => {
  try {
    const claim = await submitResearchClaim(req.params.seedId,req.userContext,req.body || {});
    res.set('Cache-Control','no-store').status(202).json({ claim });
  } catch (error) { errorResponse(res,next,error); }
});
router.get('/api/dealership/claims/mine', session, async (req,res,next) => {
  try {
    res.set('Cache-Control','no-store').json({ claims: await listOwnResearchClaims(req.userContext) });
  } catch (error) { errorResponse(res,next,error); }
});

// Sensitive document custody: uploaded originals are in the existing private
// ocr-documents bucket; ClamAV must return CLEAN or upload fails closed.
router.post('/api/dealership/claims/:claimId/evidence',claimantAggregateLimit,evidenceWriteLimit,session,async(req,res,next)=>{
  try {
    const receipt=await uploadPrivateClaimEvidence(req.params.claimId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  } catch(error){errorResponse(res,next,error)}
});
router.get('/api/dealership/claims/:claimId/evidence',session,async(req,res,next)=>{
  try {
    const evidence=await listMyClaimEvidence(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({evidence});
  } catch(error){errorResponse(res,next,error)}
});
router.post('/api/dealership/claims/:claimId/appeal',claimantAggregateLimit,claimWriteLimit,session,async(req,res,next)=>{
  try {
    const appeal=await submitClaimAppeal(req.params.claimId,req.userContext,req.body?.reason);
    res.set('Cache-Control','no-store').status(202).json({appeal});
  } catch(error){errorResponse(res,next,error)}
});
// Candidate-only local OCR never upgrades compliance, claim rights or publication.
router.post('/api/dealership/claims/:claimId/evidence/:evidenceId/extract',
 claimantAggregateLimit,evidenceWriteLimit,session,async(req,res,next)=>{
  try{
    const result=await createClaimDocumentCandidate(
      req.params.claimId,req.params.evidenceId,req.userContext);
    res.set('Cache-Control','no-store').status(202).json(result);
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/dealership/claims/:claimId/ocr-candidates',
 session,async(req,res,next)=>{
  try{
    const candidates=await listMyClaimDocumentCandidates(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({candidates});
  }catch(error){errorResponse(res,next,error)}
});

// Legacy CSV data remains private. A read-only header preview precedes a
// separate checksum/version-bound explicit human-confirmed mapping commit.
function csvEnvelope(raw){
  if(typeof raw!=='string'||raw.length>2.8*1024*1024||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))
    throw Object.assign(new Error('INVALID_CSV_BASE64'),{statusCode:400});
  const bytes=Buffer.from(raw,'base64');
  if(bytes.toString('base64').replace(/=+$/,'')!==raw.replace(/=+$/,''))
    throw Object.assign(new Error('NON_CANONICAL_CSV_BYTES'),{statusCode:400});
  return bytes;
}
router.post('/api/dealership/claims/:claimId/csv-preview',
 claimantAggregateLimit,applicationWriteLimit,session,async(req,res,next)=>{
  try{
    const preview=await previewMyClaimCsv(
      req.params.claimId,req.userContext,
      csvEnvelope(req.body?.csv_base64),req.body?.target_tab);
    res.set('Cache-Control','no-store').status(200).json({preview});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/dealership/claims/:claimId/csv-import',
 claimantAggregateLimit,applicationWriteLimit,session,async(req,res,next)=>{
  try{
    const receipt=await importMyClaimCsv(
      req.params.claimId,req.userContext,
      csvEnvelope(req.body?.csv_base64),req.body||{});
    res.set('Cache-Control','no-store').status(200).json(receipt);
  }catch(error){errorResponse(res,next,error)}
});

// Regulatory draft applicability is applicant-scoped and never an approval.
router.get('/api/dealership/claims/:claimId/jurisdiction-preview',
 session,async(req,res,next)=>{
  try{
    const preview=await readMyClaimJurisdictionPreview(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({preview});
  }catch(error){errorResponse(res,next,error)}
});

// D6: applicant signs an explicit declaration and freezes the CURRENT 12-tab
// submission version for independent preliminary review, not legal activation.
router.post('/api/dealership/claims/:claimId/compliance-submissions',
 claimantAggregateLimit,applicationWriteLimit,session,async(req,res,next)=>{
  try{
    const receipt=await submitDealerApplication(req.params.claimId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(202).json({receipt});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/dealership/claims/:claimId/compliance-submissions',
 session,async(req,res,next)=>{
  try{
    const submissions=await listMyDealerApplicationSubmissions(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({submissions});
  }catch(error){errorResponse(res,next,error)}
});
// No applicant can preview another business' frozen legal workbook or review findings.
router.get('/api/admin/dealership/compliance-submissions/queue',
 reviewer,async(req,res,next)=>{
  try{
    const submissions=await listDealerComplianceReviewQueue(req.userContext);
    res.set('Cache-Control','no-store').json({submissions});
  }catch(error){errorResponse(res,next,error)}
});
// Original private applicant declarations require independent reviewer password step-up.
router.post('/api/admin/dealership/compliance-submissions/:submissionId/preview',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const preview=await previewDealerComplianceCase(
      req.params.submissionId,req.userContext,req.body?.reviewer_password);
    res.set('Cache-Control','no-store').json({preview});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/compliance-submissions/:submissionId/review',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const review=await recordDealerPreliminaryReview(
      req.params.submissionId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  }catch(error){errorResponse(res,next,error)}
});

// The export contains private research candidates; only the independently
// approved claimant may download it. Never expose raw seed data to a visitor.
router.get('/api/dealership/claims/:claimId/workbook',session,async(req,res,next)=>{
  try {
    const {buffer,claim_id}=await exportClaimPrefilledWorkbook(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store')
      .set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition','attachment; filename="carup-dealer-'+claim_id+'-intake-v1.xlsx"')
      .send(buffer);
  } catch(error){errorResponse(res,next,error)}
});
router.post('/api/dealership/claims/:claimId/workbook',claimantAggregateLimit,applicationWriteLimit,session,async(req,res,next)=>{
  try {
    const base64=req.body?.workbook_base64;
    if(typeof base64!=='string'||base64.length>11*1024*1024||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      return res.status(400).json({error:'Invalid XLSX upload envelope'});
    const bytes=Buffer.from(base64,'base64');
    const result=await importClaimWorkbook(req.params.claimId,req.userContext,bytes,
      req.body?.expected_version??0);
    res.set('Cache-Control','no-store').status(200).json(result);
  } catch(error){errorResponse(res,next,error)}
});
router.post('/api/dealership/claims/:claimId/manual-draft',
 claimantAggregateLimit,applicationWriteLimit,session,async(req,res,next)=>{
  try {
    const result=await saveManualClaimDraft(req.params.claimId,req.userContext,
      req.body?.fields||{},req.body?.expected_version??0);
    res.set('Cache-Control','no-store').status(200).json(result);
  } catch(error){errorResponse(res,next,error)}
});
router.get('/api/dealership/claims/:claimId/intake',session,async(req,res,next)=>{
  try {
    const intake=await readMyClaimIntakeDraft(req.params.claimId,req.userContext);
    if(!intake)return res.status(404).json({error:'No workbook imported for this approved claim'});
    res.set('Cache-Control','no-store').json({intake});
  } catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/claims/queue',reviewer,async(req,res,next)=>{
  try {
    const claims=await listClaimReviewQueue(req.userContext);
    res.set('Cache-Control','no-store').json({claims});
  } catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/claims/:claimId/evidence',reviewer,async(req,res,next)=>{
  try {
    const evidence=await listReviewClaimEvidence(req.params.claimId,req.userContext);
    res.set('Cache-Control','no-store').json({evidence});
  } catch(error){errorResponse(res,next,error)}
});
// Reviewer must reenter their actual account password for each decision or private
// document preview; legacy passwordless auth and spoofed identity headers never qualify.
router.post('/api/admin/dealership/claims/:claimId/evidence/:evidenceId/preview',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try {
    const preview=await reviewerEvidencePreview(req.params.claimId,req.params.evidenceId,
      req.userContext,req.body?.reviewer_password);
    res.set('Cache-Control','no-store').json({preview});
  } catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/claims/:claimId/review',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try {
    const review=await reviewDealerClaim(req.params.claimId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  } catch(error){errorResponse(res,next,error)}
});

// Independently reviewed full dealer storefront is strictly SEPARATE from
// research publication, claim approval and legal/operating tenant activation.
router.get('/api/admin/dealership/full-storefronts/queue',
 reviewer,async(req,res,next)=>{
  try{
    const cases=await listFullStorefrontReviewQueue(req.userContext);
    res.set('Cache-Control','no-store').json({cases});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/full-storefronts/:seedId/preview',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const candidate=await previewFullStorefrontCandidate(
      req.params.seedId,req.userContext,req.body?.reviewer_password);
    res.set('Cache-Control','no-store').json({candidate});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/full-storefronts/:seedId/review',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const review=await recordFullStorefrontPublication(
      req.params.seedId,req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  }catch(error){errorResponse(res,next,error)}
});

// Each private research candidate requires an individual source/public-interest
// decision; this queue never leaks contact-rich research and has no bulk publish.
// Parent/branch research associations remain unverified and create no legal role.
router.post('/api/admin/dealership/research/:seedId/grouping-review',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const review=await recordResearchGroupingReview(req.params.seedId,
      req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  }catch(error){errorResponse(res,next,error)}
});
// Field-by-field address/site/phone review, never raw private source person/email.
router.post('/api/admin/dealership/research/:seedId/contact-review',
 reviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const review=await recordResearchContactReview(req.params.seedId,
      req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({review});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/research/queue',reviewer,async(req,res,next)=>{
  try{
    const queue=await listResearchReviewQueue(req.userContext,{
      page:req.query.page,limit:req.query.limit,
    });
    res.set('Cache-Control','no-store').json(queue);
  }catch(error){errorResponse(res,next,error)}
});

// Research source eligibility must be independently reviewed with a valid session,
// verified platform reviewer role and per-source, documented case reasons. DB RPC
// appends immutable decision and writes safe public projection in one transaction.
router.post('/api/admin/dealership/research/:seedId/review', reviewWriteLimit, reviewer, async (req,res,next) => {
  try {
    const review = await reviewResearchSeed(req.params.seedId,req.userContext,req.body || {});
    res.set('Cache-Control','no-store').status(201).json({ review });
  } catch (error) { errorResponse(res,next,error); }
});

// C23 private transaction-backed buyer cases: fail-closed SQL validates buyer,
// canonical escrow intent and activated dealer tenancy; never a public rating.
// Dealer legal owners cannot review complaints about their own dealership.
router.get('/api/dealership/buyer-feedback/mine',session,async(req,res,next)=>{
  try{
    const context=await listMyCanonicalDealerFeedbackContext(req.userContext);
    res.set('Cache-Control','no-store').json(context);
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/dealership/buyer-feedback/cases',
  buyerCaseWriteLimit,session,async(req,res,next)=>{
  try{
    const receipt=await submitMyPrivateDealerFeedback(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){errorResponse(res,next,error)}
});
router.get('/api/admin/dealership/buyer-feedback/queue',
  reviewer,async(req,res,next)=>{
  try{
    const cases=await listPrivateBuyerCaseReviewQueue(req.userContext);
    res.set('Cache-Control','no-store').json({cases});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/buyer-feedback/:caseId/preview',
  buyerReviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const preview=await previewPrivateBuyerCase(
      req.userContext,req.params.caseId,req.body?.reviewer_password);
    res.set('Cache-Control','no-store').json({preview});
  }catch(error){errorResponse(res,next,error)}
});
router.post('/api/admin/dealership/buyer-feedback/:caseId/review',
  buyerReviewWriteLimit,reviewer,async(req,res,next)=>{
  try{
    const finding=await recordPrivateBuyerCaseFinding(
      req.userContext,req.params.caseId,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({finding});
  }catch(error){errorResponse(res,next,error)}
});

export default router;
