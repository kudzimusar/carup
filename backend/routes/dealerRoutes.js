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
import {rateLimiter} from '../middleware/securityMiddleware.js';
import dealerResearchRouter from './dealerResearchRoutes.js';
import {getMyVerifiedDealerWorkspace,addDeclaredDealerBranch,updateDeclaredDealerBranch}
  from '../services/dealer/dealerVerifiedWorkspaceService.js';
import {listMyOperationalDeclarations,recordMyOperationalDeclaration,readMyActivationCarryover}
  from '../services/dealer/dealerOperationalDeclarationsService.js';
import {listMyStorefrontMedia,uploadMyStorefrontMedia}
  from '../services/dealer/dealerStorefrontMediaService.js';
import {sendDealerRouteError}
  from '../services/dealer/dealerSqlRefusalMapper.js';
import {getDealerCommercialReadiness}
  from '../services/dealer/dealerCommercialReadinessService.js';
import {
  listCanonicalDealerStaff,inviteDealerStaff,listOwnDealerStaffInvitations,
  acceptDealerStaffInvitation,revokeDealerStaffInvitation,
} from '../services/dealer/dealerStaffMembershipService.js';
import {
  listMyStaffBranches,listMyOwnerStaffBranchScopes,
  grantMyStaffBranchScope,revokeMyStaffBranchScope,editMyStaffBranch,
} from '../services/dealer/dealerStaffBranchScopeService.js';
import {getMyCanonicalDealerInventory,recordMyCanonicalDealerPrivateDraft,
  correctMyCanonicalDealerPrivateDraft}
  from '../services/dealer/dealerTenantInventoryReadService.js';
import {prepareMyDealerListing,getMyDealerListingReadiness}
  from '../services/dealer/dealerCanonicalListingService.js';
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

// R6 security review #8a: write limits on the dealer workspace. Keyed per authenticated account and
// mounted AFTER session authentication, so unauthenticated traffic or another account behind the
// same NAT/CI IP cannot consume an owner's budget. Budgets per account per hour:
//   uploads (ClamAV scan + private 4 MiB storage write)       20
//   staff invitations / acceptances / revocations / scopes     30
//   all other owner/staff workspace writes                    120
const ownerUploadWriteLimit = rateLimiter({max:20,windowMs:3600000,isSensitive:true,
  bucket:'dealer-owner-upload-write',keyBy:'account'});
const ownerStaffWriteLimit = rateLimiter({max:30,windowMs:3600000,isSensitive:true,
  bucket:'dealer-owner-staff-write',keyBy:'account'});
const ownerWorkspaceWriteLimit = rateLimiter({max:120,windowMs:3600000,isSensitive:true,
  bucket:'dealer-owner-workspace-write',keyBy:'account'});

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
    sendDealerRouteError(res,next,error);
  }
});
// R6 C02: what activation carried from the approved application (owner only).
router.get('/api/dealer/activation-carryover',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const carryover=await readMyActivationCarryover(req.userContext);
    res.set('Cache-Control','no-store').json({carryover});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/operational-branches',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const branch=await addDeclaredDealerBranch(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({branch});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.patch('/api/dealer/operational-branches/:branchId',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const branch=await updateDeclaredDealerBranch(req.userContext,req.params.branchId,req.body||{});
    res.set('Cache-Control','no-store').status(200).json({branch});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});


// Versioned private dealer-supplied descriptions, policies and terms.
// No invented lender, warranty approval, review, merchant or public trust grant.
router.get('/api/dealer/operational-declarations',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const declarations=await listMyOperationalDeclarations(req.userContext);
    res.set('Cache-Control','no-store').json({declarations});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/operational-declarations/:section',
 authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await recordMyOperationalDeclaration(
      req.userContext,req.params.section,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// R5 T22: tenant-scoped dealership photo/media gallery for the approved active owner.
// ClamAV-scanned private storage; requires mandatory alt_text/caption and no OEM/logo rights claim.
router.get('/api/dealer/operational-media',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const media=await listMyStorefrontMedia(req.userContext);
    res.set('Cache-Control','no-store').json({media});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/operational-media',authorizeSessionRole([]),ownerUploadWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await uploadMyStorefrontMedia(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

router.post('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES),ownerWorkspaceWriteLimit, async (req, res, next) => {
  try {
    const profile = await createOrUpdateProfile(req.userContext?.userId, req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    sendDealerRouteError(res, next, err);
  }
});

router.get('/api/dealer/profile', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    res.json({ profile });
  } catch (err) {
    sendDealerRouteError(res, next, err);
  }
});

router.get('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branches = await listBranches(profile.id);
    res.set('Cache-Control', 'no-store').json({ branches });
  } catch (error) { sendDealerRouteError(res, next, error); }
});

router.post('/api/dealer/branches', authorizeSessionRole(DEALER_ROLES),ownerWorkspaceWriteLimit, async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const branch = await addBranch(profile.id, req.body || {});
    res.status(201).json({ branch });
  } catch (err) {
    sendDealerRouteError(res, next, err);
  }
});

router.get('/api/dealer/requirements', authorizeSessionRole(DEALER_ROLES), async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const requirements = await listRequirements(profile.id);
    res.json({ requirements });
  } catch (err) {
    sendDealerRouteError(res, next, err);
  }
});

router.post('/api/dealer/documents', authorizeSessionRole(DEALER_ROLES),ownerUploadWriteLimit, async (req, res, next) => {
  try {
    const profile = await ownProfileOr404(req, res);
    if (!profile) return;
    const document = await uploadDocument(profile.id, req.body || {});
    res.status(201).json({ document });
  } catch (err) {
    if (/requires a doc_type/.test(err.message)) return res.status(400).json({ error: err.message });
    sendDealerRouteError(res, next, err);
  }
});

// R6 E: the former GET /api/dealer/operations/membership-summary is retired. It was gated
// by the legacy global dealer role, so canonically activated owners (global role "member")
// could never reach it, and the canonical workspace already reports the recorded tenant
// membership count. The tested read service remains in dealerOperationsReadService.js.

// Strictly read-only commercial interface — no PAY-05 garage merchant can
// collect CarUp dealer fees or operate a dealership's own funds here.
router.get('/api/dealer/commercial-readiness',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const readiness=await getDealerCommercialReadiness(req.userContext);
    res.set('Cache-Control','no-store').json({readiness});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// C16: Existing CarUp account required; no phantom user, provider email,
// owner/admin promotion, global role change or branch permissions from an invite.
router.get('/api/dealer/operational-staff',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const staff=await listCanonicalDealerStaff(req.userContext);
    res.set('Cache-Control','no-store').json({staff});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/staff-invitations',authorizeSessionRole([]),ownerStaffWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await inviteDealerStaff(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(202).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.get('/api/dealer/staff-invitations/mine',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const invitations=await listOwnDealerStaffInvitations(req.userContext);
    res.set('Cache-Control','no-store').json({invitations});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/staff-invitations/:id/accept',authorizeSessionRole([]),ownerStaffWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await acceptDealerStaffInvitation(req.userContext,req.params.id);
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/staff-invitations/:id/revoke',authorizeSessionRole([]),ownerStaffWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await revokeDealerStaffInvitation(req.userContext,req.params.id);
    res.set('Cache-Control','no-store').status(200).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// C16: canonical branch-scoped member authorization (explicitly separate
// from owner, seller, reviewer, financial and company signatory authority).
// Every request is bound to a genuine signed CarUp session; SQL requires
// both tenant_users + organization_users membership and current legal policy.
router.get('/api/dealer/staff-branches/mine',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const scopes=await listMyStaffBranches(req.userContext);
    res.set('Cache-Control','no-store').json({scopes});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.get('/api/dealer/staff-branch-scopes/owner',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const ledger=await listMyOwnerStaffBranchScopes(req.userContext);
    res.set('Cache-Control','no-store').json({ledger});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/staff-branch-scopes',authorizeSessionRole([]),ownerStaffWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await grantMyStaffBranchScope(req.userContext,req.body||{});
    res.set('Cache-Control','no-store').status(201).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.post('/api/dealer/staff-branch-scopes/:id/revoke',
  authorizeSessionRole([]),ownerStaffWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await revokeMyStaffBranchScope(req.userContext,req.params.id);
    res.set('Cache-Control','no-store').json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});
router.patch('/api/dealer/staff-branches/:scopeId',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await editMyStaffBranch(
      req.userContext,req.params.scopeId,req.body||{});
    res.set('Cache-Control','no-store').json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// C17: read actual vehicles strictly scoped to an active verified dealership
// tenant. VIN publication decisions remain in the existing seller domain.
router.get('/api/dealer/operational-inventory',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const inventory=await getMyCanonicalDealerInventory(req.userContext);
    res.set('Cache-Control','no-store').json({inventory});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// A legally activated owner can register a private DRAFT vehicle record inside
// the existing canonical vehicles table. No sale, seller rights, listing, trust
// or real-vehicle title is inferred. Global member role cannot self-promote.
router.post('/api/dealer/operational-inventory/private-drafts',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const draft=await recordMyCanonicalDealerPrivateDraft(
      req.userContext,req.body);
    res.set('Cache-Control','no-store').status(201).json({draft});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// Correct only existing, currently non-public canonical tenant VIN draft
// attributes. Source VIN, buyer/seller rights, payment, duty and Passport
// authority remain outside this surface; no cross-tenant lookup is exposed.
router.patch('/api/dealer/operational-inventory/private-drafts/:vin',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const draft=await correctMyCanonicalDealerPrivateDraft(
      req.userContext,req.params.vin,req.body);
    res.set('Cache-Control','no-store').json({draft});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// R4 P0-2: turn one of the owner's private tenant VIN drafts into a canonical seller listing
// candidate (owner = governed current seller, owned branch, dealer_declared facts). It stays
// UNPUBLISHED: publication is only ever the canonical POST /api/vehicles/:vin/publish gate.
router.post('/api/dealer/operational-inventory/:vin/listing-preparation',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const listing=await prepareMyDealerListing(req.userContext,req.params.vin,req.body);
    res.set('Cache-Control','no-store').json({listing});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// R4 P0-2: the canonical publication gate's own answer for this owner's VIN (labels/statuses only).
router.get('/api/dealer/operational-inventory/:vin/listing-readiness',
  authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const readiness=await getMyDealerListingReadiness(req.userContext,req.params.vin);
    res.set('Cache-Control','no-store').json({readiness});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// Read existing canonical Marketplace buyer inquiries only for the actually
// approved, active dealership tenant; no fake dealer_leads shadow table.
router.get('/api/dealer/operational-inquiries',authorizeSessionRole([]),async(req,res,next)=>{
  try{
    const inquiries=await getMyCanonicalDealerInquiries(req.userContext);
    res.set('Cache-Control','no-store').json({inquiries});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// Only two bounded seller-reported transitions are permitted. Moderation,
// assignment, Communications, financial and transaction authority remain separate.
router.patch('/api/dealer/operational-inquiries/:inquiryId/follow-up',
  authorizeSessionRole([]),ownerWorkspaceWriteLimit,async(req,res,next)=>{
  try{
    const receipt=await advanceMyCanonicalDealerInquiry(
      req.userContext,req.params.inquiryId,req.body?.next_status);
    res.set('Cache-Control','no-store').status(200).json({receipt});
  }catch(error){
    sendDealerRouteError(res,next,error);
  }
});

// ── admin oversight ─────────────────────────────────────────────────────────────────

router.get('/api/admin/dealers', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    // Tenant scoping: a tenant-scoped admin only sees dealers in their tenant.
    const dealers = await listProfiles({ tenantId: req.userContext?.tenantId || undefined });
    res.json({ dealers });
  } catch (err) {
    sendDealerRouteError(res, next, err);
  }
});

router.get('/api/admin/dealers/:id', authorizeSessionRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: `Dealer not found: ${req.params.id}` });
    const compliance = await evaluateCompliance(profile.id);
    res.json({ profile, compliance });
  } catch (err) {
    sendDealerRouteError(res, next, err);
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
    sendDealerRouteError(res, next, err);
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
    sendDealerRouteError(res, next, err);
  }
});

// Canonical dealership research, claim and public routes share this existing dealer router.
// No new standalone server mount or parallel dealer auth authority is introduced.
router.use(dealerResearchRouter);

export default router;
