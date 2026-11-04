/**
 * Dealer Compliance & Trust routes — Workstream B.
 *
 * Dealer self-service (dealer/admin):
 *   POST /api/dealer/profile        create or update own dealer profile
 *   GET  /api/dealer/profile        read own dealer profile
 *   POST /api/dealer/branches       add a branch to own profile
 *   GET  /api/dealer/requirements   list own compliance requirements
 *   POST /api/dealer/documents      record a compliance document (metadata only)
 *
 * Admin oversight (admin/government/reviewer):
 *   GET   /api/admin/dealers              list dealer profiles (tenant-scoped)
 *   GET   /api/admin/dealers/:id          read one dealer (full privileged view)
 *   PATCH /api/admin/dealers/:id/decision record a governance decision + apply its effect
 *
 * Buyer-safe (any authenticated user):
 *   GET  /api/dealers/:id/summary   coarse status + evidence band only (NO private data)
 *
 * A dealer may only ever act on THEIR OWN profile: self-service routes resolve the dealer
 * by the caller's userId, so a dealer can never read or mutate another dealer's full profile.
 */
import express from 'express';
import dealerResearchRouter from './dealerResearchRoutes.js';
import {getMyDealerMembershipSummary} from '../services/dealer/dealerOperationsReadService.js';
import {getMyVerifiedDealerWorkspace,addDeclaredDealerBranch,updateDeclaredDealerBranch}
  from '../services/dealer/dealerVerifiedWorkspaceService.js';
import {listMyOperationalDeclarations,recordMyOperationalDeclaration}
  from '../services/dealer/dealerOperationalDeclarationsService.js';
import {getDealerCommercialReadiness}
  from '../services/dealer/dealerCommercialReadinessService.js';
import {
  listCanonicalDealerStaff,inviteDealerStaff,listOwnDealerStaffInvitations,
  acceptDealerStaffInvitation,revokeDealerStaffInvitation,
} from '../services/dealer/dealerStaffMembershipService.js';
import {getMyCanonicalDealerInventory}
  from '../services/dealer/dealerTenantInventoryReadService.js';
import {getMyCanonicalDealerInquiries,advanceMyCanonicalDealerInquiry}
  from '../services/dealer/dealerTenantLeadReadService.js';
import { authorizeRole, authorizeSessionRole } from '../middleware/authMiddleware.js';
import {
  createOrUpdateProfile,
  getProfile,
  listProfiles,
  addBranch,
  listBranches,
  listRequirements,
  uploadDocument,
  recordDecision,
  evaluateCompliance,
  getBuyerSafeSummary,
} from '../services/dealer/dealerComplianceService.js';

const router = express.Router();

const DEALER_ROLES = ['dealer', 'admin'];
const ADMIN_ROLES = ['admin', 'government', 'reviewer'];

/** Resolve the caller's own dealer profile, or 404 if none exists yet. */
async function ownProfileOr404(req, res) {
  const profile = await getProfile(req.userContext?.userId);
  if (!profile) {
    res.status(404).json({ error: 'No dealer profile for this user. Create one first.' });
    return null;
  }
  return profile;
}

// ── dealer self-service ────────────────────────────────────────────────────────────

// Claim-approved canonical tenant owner may have a global member user.role.
// This requires actual active legal claim, approved country policy, tenant and
// organization membership independently of any legacy global dealer role.
router.get('/api/dealer/operational-workspace',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const workspace=await getMyVerifiedDealerWorkspace(req.userContext);
    res.set('Cache-Control','no-store').json({workspace});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.post('/api/dealer/operational-branches',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const branch=await addDeclaredDealerBranch(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({branch});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.patch('/api/dealer/operational-branches/:branchId',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const branch=await updateDeclaredDealerBranch(req.userContext,req.params.branchId,req.body||{});
    res.set('Cache-Control','no-store').status(200).json({branch});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});


// Versioned private dealer-supplied descriptions, policies and terms.
// No invented lender, warranty approval, review, merchant or public trust grant.
router.get('/api/dealer/operational-declarations',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const declarations=await listMyOperationalDeclarations(req.userContext);
    res.set('Cache-Control','no-store').json({declarations});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.post('/api/dealer/operational-declarations/:section',
 authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const receipt=await recordMyOperationalDeclaration(
      req.userContext,req.params.section,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

router.post('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await createOrUpdateProfile(req.userContext?.userId, req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branches = await listBranches(profile.id);
    res.set('Cache-Control', 'no-store').json({ branches });
  } catch (error) { next(error); }
});

router.post('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branch = await addBranch(profile.id, req.body || {});
    res.status(201).json({ branch });
  } catch (err) {
    next(err);
  }
});

router.get('/api/dealer/requirements', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const requirements = await listRequirements(profile.id);
    res.json({ requirements });
  } catch (err) {
    next(err);
  }
});

router.post('/api/dealer/documents', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const document = await uploadDocument(profile.id, req.body || {});
    res.status(201).json({ document });
  } catch (err) {
    if (/requires a doc_type/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Source of truth: existing canonical tenant_users; no parallel staff authority.
router.get('/api/dealer/operations/membership-summary',
  authorizeSessionRole(DEALER_ROLES),async(req,res,next)=>{
  try{
    const summary=await getMyDealerMembershipSummary(req.userContext);
    res.set('Cache-Control','no-store').json({summary});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// Strictly read-only commercial interface — no PAY-05 garage merchant can
// collect CarUp dealer fees or operate a dealership's own funds here.
router.get('/api/dealer/commercial-readiness',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const readiness=await getDealerCommercialReadiness(req.userContext);
    res.set('Cache-Control','no-store').json({readiness});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// C16: Existing CarUp account required; no phantom user, provider email,
// owner/admin promotion, global role change or branch permissions from an invite.
router.get('/api/dealer/operational-staff',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const staff=await listCanonicalDealerStaff(req.userContext);
    res.set('Cache-Control','no-store').json({staff});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.post('/api/dealer/staff-invitations',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const receipt=await inviteDealerStaff(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(202).json({receipt});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.get('/api/dealer/staff-invitations/mine',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const invitations=await listOwnDealerStaffInvitations(req.userContext);
    res.set('Cache-Control','no-store').json({invitations});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.post('/api/dealer/staff-invitations/:id/accept',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const receipt=await acceptDealerStaffInvitation(req.userContext,req.params.id);
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});
router.post('/api/dealer/staff-invitations/:id/revoke',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const receipt=await revokeDealerStaffInvitation(req.userContext,req.params.id);
    res.set('Cache-Control','no-store').status(200).json({receipt});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// C17: read actual vehicles strictly scoped to an active verified dealership
// tenant. VIN publication decisions remain in the existing seller domain.
router.get('/api/dealer/operational-inventory',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const inventory=await getMyCanonicalDealerInventory(req.userContext);
    res.set('Cache-Control','no-store').json({inventory});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// Read existing canonical Marketplace buyer inquiries only for the actually
// approved, active dealership tenant; no fake dealer_leads shadow table.
router.get('/api/dealer/operational-inquiries',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const inquiries=await getMyCanonicalDealerInquiries(req.userContext);
    res.set('Cache-Control','no-store').json({inquiries});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// Only two bounded seller-reported transitions are permitted. Moderation,
// assignment, Communications, financial and transaction authority remain separate.
router.patch('/api/dealer/operational-inquiries/:inquiryId/follow-up',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const receipt=await advanceMyCanonicalDealerInquiry(
      req.userContext,req.params.inquiryId,req.body?.next_status);
    res.set('Cache-Control','no-store').status(200).json({receipt});
  }catch(error){
    if(error.statusCode&&error.statusCode>=400&&error.statusCode<500)
      return res.status(error.statusCode).json({error:error.message});
    next(error);
  }
});

// ── admin oversight ─────────────────────────────────────────────────────────────────

router.get('/api/admin/dealers', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    // Tenant scoping: a tenant-scoped admin only sees dealers in their tenant.
    const dealers = await listProfiles({ tenantId: req.userContext?.tenantId || undefined });
    res.json({ dealers });
  } catch (err) {
    next(err);
  }
});

router.get('/api/admin/dealers/:id', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const compliance = await evaluateCompliance(profile.id);
    res.json({ profile, compliance });
  } catch (err) {
    next(err);
  }
});

router.patch('/api/admin/dealers/:id/decision', authorizeSessionRole(['admin','reviewer']), async (req, res, next) => {
  try {
    if (!req.userContext?.isVerified) {
      return res.status(403).json({ error: 'Independent verified reviewer session is required' });
    }
    const result = await recordDecision(
      req.params.id,
      {
        decision: req.body?.decision,
        requirement_key: req.body?.requirement_key,
        reason: req.body?.reason,
        payload: req.body?.payload,
      },
      { id: req.userContext?.userId, role: req.userContext?.platformRole || req.userContext?.role,
        authenticationMethod: req.userContext?.authenticationMethod,
        isVerified: req.userContext?.isVerified,
        reviewer_password: req.body?.reviewer_password },
    );
    res.status(201).json(result);
  } catch (err) {
    if (/Dealer not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/decision must be|requires a requirement_key|authenticated actor/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ error:err.message });
    }
    next(err);
  }
});

// ── buyer-safe ──────────────────────────────────────────────────────────────────────

router.get('/api/dealers/:id/summary', authorizeRole(), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const summary = await getBuyerSafeSummary(profile.id);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

// Canonical dealership research, claim and public routes share this existing dealer router.
// No new standalone server mount or parallel dealer auth authority is introduced.
router.use(dealerResearchRouter);

export default router;
