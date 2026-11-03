/**
 * CARUP-DEALER-ONB-001: research/publication and prospective claim routes.
 * Research is NOT a self-service dealer-approval service. Claims grant NO roles.
 */
import express from 'express';
import { exportBlankDealerIntakeXlsx } from '../services/dealer/dealerIntakeWorkbook.js';
import {
  uploadPrivateClaimEvidence,listMyClaimEvidence,reviewerEvidencePreview,
  reviewDealerClaim,submitClaimAppeal,exportClaimPrefilledWorkbook,
  importClaimWorkbook,readMyClaimIntakeDraft,listClaimReviewQueue,
} from '../services/dealer/dealerClaimApplicationService.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import {
  getPublicResearch,
  listPublicResearch,
  reviewResearchSeed,
  submitResearchClaim,
  listOwnResearchClaims,
  requestResearchCorrection,
  listResearchCorrectionsForReviewer,
} from '../services/dealer/dealerResearchService.js';

const router = express.Router();
const publicReadLimit = rateLimiter({ max: 40, windowMs: 60 * 1000, isSensitive: false });
const claimWriteLimit = rateLimiter({ max: 4, windowMs: 60 * 60 * 1000, isSensitive: true });
const reviewWriteLimit = rateLimiter({ max: 15, windowMs: 60 * 60 * 1000, isSensitive: true });
const session = authorizeSessionRole([]);
const reviewer = authorizeSessionRole(['admin','reviewer']);

function errorResponse(res, next, error) {
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  next(error);
}

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

router.get('/api/dealership/research/:seedId', publicReadLimit, async (req,res,next) => {
  try {
    const profile = await getPublicResearch(req.params.seedId);
    if (!profile) return res.status(404).json({ error:'Research listing not published' });
    res.set('Cache-Control','no-store').json({ profile });
  } catch (error) { errorResponse(res,next,error); }
});

// Correction or removal concerns are queued privately; no unreviewed request can
// hide, reassign or alter another dealership's public listing.
router.post('/api/dealership/research/:seedId/corrections', claimWriteLimit, async (req,res,next) => {
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
router.post('/api/dealership/research/:seedId/claim', claimWriteLimit, session, async (req,res,next) => {
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
router.post('/api/dealership/claims/:claimId/evidence',claimWriteLimit,session,async(req,res,next)=>{
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
router.post('/api/dealership/claims/:claimId/appeal',claimWriteLimit,session,async(req,res,next)=>{
  try {
    const appeal=await submitClaimAppeal(req.params.claimId,req.userContext,req.body?.reason);
    res.set('Cache-Control','no-store').status(202).json({appeal});
  } catch(error){errorResponse(res,next,error)}
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
router.post('/api/dealership/claims/:claimId/workbook',claimWriteLimit,session,async(req,res,next)=>{
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

// Research source eligibility must be independently reviewed with a valid session,
// verified platform reviewer role and per-source, documented case reasons. DB RPC
// appends immutable decision and writes safe public projection in one transaction.
router.post('/api/admin/dealership/research/:seedId/review', reviewWriteLimit, reviewer, async (req,res,next) => {
  try {
    const review = await reviewResearchSeed(req.params.seedId,req.userContext,req.body || {});
    res.set('Cache-Control','no-store').status(201).json({ review });
  } catch (error) { errorResponse(res,next,error); }
});

export default router;
