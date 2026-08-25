import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import diasporaWorkbookRouter from './diasporaWorkbookRoutes.js';
import diasporaWorkbookXlsxRouter from './diasporaWorkbookXlsxRoutes.js';
import diasporaStockRouter from './diasporaStockRoutes.js';
import diasporaBuyerOrderRouter from './diasporaBuyerOrderRoutes.js';
import diasporaAiCommandRouter from './diasporaAiCommandRoutes.js';
import diasporaContainerMarketplaceRouter from './diasporaContainerMarketplaceRoutes.js';
import diasporaDriveRouter from './diasporaDriveRoutes.js';
import diasporaSubscriptionRoutes from './diasporaSubscriptionRoutes.js';
import diasporaSafeTradeRouter from './diasporaSafeTradeRoutes.js';
import diasporaTradeGraphRouter from './diasporaTradeGraphRoutes.js';
import diasporaSchedulerRouter from './diasporaSchedulerRoutes.js';
import { listDiasporaAudit } from '../services/diaspora/diasporaAuditService.js';
import { createImportOrder, listImportOrders, getImportOrder, assignSeller, addQuote, addPaymentMilestone, linkVehicleImportRecord } from '../services/diaspora/diasporaImportOrderService.js';
import { transitionImportOrder } from '../services/diaspora/diasporaWorkflowService.js';
import { completeOwnershipHandoff, getOwnershipHandoffStatus } from '../services/diaspora/diasporaOwnershipHandoffService.js';
import { createTradeProfile, listTradeProfiles, getTradeProfile, getOwnTradeProfiles, submitTradeProfileForReview, updateTradeProfile, verifyTradeProfile, suspendTradeProfile } from '../services/diaspora/diasporaTradeProfileService.js';
import { createTradeDocument, listTradeDocuments, getTradeDocument, getTradeDocumentWithStorage, recordDocumentExtraction, verifyTradeDocument, rejectTradeDocument } from '../services/diaspora/diasporaDocumentService.js';
import { createContainerShipment, listContainerShipments, getContainerShipment, transitionContainer } from '../services/diaspora/diasporaContainerService.js';
import { createCargoReservation, listCargoReservations, updateReservationStatus } from '../services/diaspora/diasporaReservationService.js';
import { createShipment, listShipments, getShipment, updateShipmentStage, getShipmentTimeline } from '../services/diaspora/diasporaShipmentService.js';
import { createComplianceReview, listComplianceReviews, updateComplianceReview, upsertGovernmentDocument, getGovernmentFootprint } from '../services/diaspora/diasporaComplianceService.js';
import { listNotificationPreferences } from '../services/diaspora/diasporaNotificationService.js';
import { createReputationRecord, listReputationRecords } from '../services/diaspora/diasporaReputationService.js';
import { CONTAINER_STATUSES, RESERVATION_STATUSES } from '../constants/diaspora/diasporaStatuses.js';
import { DocumentIntelligenceService } from '../services/document-intelligence/documentIntelligenceService.js';
import { generateSecureReadUrl } from '../services/storage/storageService.js';
import { requireProvenIdentity } from '../middleware/authMiddleware.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = authorizeRole();
const reviewerAuth = authorizeRole(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer', 'dealer']);

function pagination(req) {
  return {
    limit: Math.min(Number(req.query.limit || 50), 100),
    offset: Number(req.query.offset || 0),
  };
}

// Phase 1A: Diaspora Workbook Center. Mounted inside /api/diaspora by server.js.
router.use(diasporaWorkbookRouter);

// Track W: real .xlsx template download, base64 upload dry-run (reuses JSON validation), and export.
router.use(diasporaWorkbookXlsxRouter);

// Phase 3: Online stock, immutable stock ledger, and supply documents.
router.use(diasporaStockRouter);

// Phase 4: Buyer orders, Reverse RFQ marketplace, and quote selection.
router.use(diasporaBuyerOrderRouter);

// Phase 5: AI command center (draft actions, risk gates; high-risk execution blocked).
router.use(diasporaAiCommandRouter);

// Phase 6: Container co-loading marketplace (authoritative server-side capacity rules).
router.use(diasporaContainerMarketplaceRouter);

// Phase 7: Provider-abstracted Drive integration (feature-flagged; tokens never exposed).
router.use(diasporaDriveRouter);

// Phase 8: Subscription gate — plans, status, entitlements, usage, sandbox billing + idempotent webhook.
// Enforcement on protected ops is gated by DIASPORA_SUBSCRIPTION_ENFORCEMENT (default OFF).
router.use('/subscription', diasporaSubscriptionRoutes);

// Phase 9: SafeTrade trade-assurance overlay (state machine, eligibility, milestones, release
// policy, disputes, delivery). Sandbox-only payments; gated behind DIASPORA_SAFETRADE_ENABLED (off).
router.use(diasporaSafeTradeRouter);

// Phase 10: Trade Graph intelligence (tenant-safe, event-derived, AI-redacted reads + admin rebuild).
// Mounted UNDER the '/trade-graph' prefix so the router's internal feature-gate (DIASPORA_TRADE_GRAPH,
// default off → 404) is scoped to this prefix and cannot shadow sibling diaspora routes (the SafeTrade
// route-shadowing lesson: a blanket gate at the diaspora root 404s everything).
router.use('/trade-graph', diasporaTradeGraphRouter);

// Phase 2E: durable scheduled execution (ledger #27). Mounted UNDER '/scheduler' so the dispatch
// endpoint's secret gate is scoped to this prefix and cannot shadow sibling diaspora routes. Every
// job is OFF by default and turning one on takes two independent acts — the deployment flag AND the
// database `enabled` column — so the second is a kill switch an operator can pull mid-incident
// without a redeploy. While the deployment flag is unset the dispatch route answers
// 200 {dispatched:false, SCHEDULER_DISABLED} with or without a credential, running nothing and
// opening no database connection, so a cron can be wired ahead of activation without going red.
router.use('/scheduler', diasporaSchedulerRouter);

// Import Orders
router.get('/import-orders', auth, asyncHandler(async (req, res) => {
  const data = await listImportOrders({ userContext: req.userContext, status: req.query.status, ...pagination(req) });
  res.json({ data, pagination: pagination(req) });
}));

router.post('/import-orders', auth, asyncHandler(async (req, res) => {
  const data = await createImportOrder(req.body, req.userContext, req);
  res.status(201).json(data);
}));

router.get('/import-orders/:id', auth, asyncHandler(async (req, res) => {
  res.json(await getImportOrder(req.params.id, req.userContext));
}));

router.post('/import-orders/:id/assign-seller', auth, asyncHandler(async (req, res) => {
  res.json(await assignSeller(req.params.id, req.body, req.userContext, req));
}));

router.post('/import-orders/:id/quotes', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await addQuote(req.params.id, req.body, req.userContext, req));
}));

router.get('/import-orders/:id/documents', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listTradeDocuments({ importOrderId: req.params.id, ...pagination(req) }, req.userContext) });
}));

router.post('/import-orders/:id/documents', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await createTradeDocument({ ...req.body, import_order_id: req.params.id }, req.userContext, req));
}));

router.get('/import-orders/:id/stages', auth, asyncHandler(async (req, res) => {
  const order = await getImportOrder(req.params.id, req.userContext);
  res.json({ status: order.status, audit: await listDiasporaAudit({ importOrderId: req.params.id }) });
}));

router.patch('/import-orders/:id/stages', auth, asyncHandler(async (req, res) => {
  if (!req.body.status) throw new ValidationError('status is required');
  res.json(await transitionImportOrder({ importOrderId: req.params.id, nextStatus: req.body.status, actorId: req.userContext.id, userContext: req.userContext, metadata: req.body.metadata || {}, req }));
}));

router.get('/import-orders/:id/audit', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listDiasporaAudit({ importOrderId: req.params.id, limit: Number(req.query.limit || 100) }) });
}));

// Payment milestone — a non-custodial reference record, not a payment API. `auth` is the coarse
// route filter; addPaymentMilestone reuses getImportOrder's own access gate (owner/participant/
// tenant-admin/reviewer) as the authority boundary, same convention as ownership-handoff above.
router.post('/import-orders/:id/payment-milestones', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await addPaymentMilestone(req.params.id, req.body, req.userContext, req));
}));

router.post('/import-orders/:id/vehicle-import-record', reviewerAuth, asyncHandler(async (req, res) => {
  res.status(201).json(await linkVehicleImportRecord(req.params.id, req.body, req.userContext, req));
}));

// Cross-border ownership handoff — links a ZIMBABWE_READY order + VERIFIED vehicle_import_record into
// the canonical CarUp vehicle identity and appends the immutable per-VIN timeline event. The SERVICE is
// the authority boundary (platform admin/reviewer or the order's tenant admin; idempotent; VIN-conflict
// safe); reviewerAuth here is the coarse route filter only. GET is participant-readable status.
router.post('/import-orders/:id/ownership-handoff', reviewerAuth, asyncHandler(async (req, res) => {
  res.json(await completeOwnershipHandoff(req.params.id, req.body || {}, req.userContext, { req }));
}));

router.get('/import-orders/:id/ownership-handoff', auth, asyncHandler(async (req, res) => {
  res.json(await getOwnershipHandoffStatus(req.params.id, req.userContext, { req }));
}));

router.get('/import-orders/:id/government-footprint', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getGovernmentFootprint(req.params.id) });
}));

// Trade Profiles — self-service for buyers/sellers/suppliers (own profile only); reviewerAuth-gated
// verify/suspend is the coarse route filter, the service itself is the authority boundary (mirrors
// the ownership-handoff route convention above).
router.get('/trade-profiles', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listTradeProfiles({ roleType: req.query.roleType, verificationStatus: req.query.verificationStatus, country: req.query.country, ...pagination(req) }, req.userContext) });
}));

router.post('/trade-profiles', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await createTradeProfile(req.body, req.userContext, req));
}));

// /me MUST be registered before /:id, or Express matches 'me' as an :id.
router.get('/trade-profiles/me', auth, asyncHandler(async (req, res) => res.json({ data: await getOwnTradeProfiles(req.userContext) })));
router.get('/trade-profiles/:id', auth, asyncHandler(async (req, res) => res.json(await getTradeProfile(req.params.id, req.userContext))));
router.patch('/trade-profiles/:id', auth, asyncHandler(async (req, res) => res.json(await updateTradeProfile(req.params.id, req.body, req.userContext, req))));
router.post('/trade-profiles/:id/submit-review', auth, asyncHandler(async (req, res) => res.json(await submitTradeProfileForReview(req.params.id, req.body, req.userContext, req))));
router.post('/trade-profiles/:id/verify', reviewerAuth, asyncHandler(async (req, res) => res.json(await verifyTradeProfile(req.params.id, req.body, req.userContext, req))));
router.post('/trade-profiles/:id/suspend', reviewerAuth, asyncHandler(async (req, res) => res.json(await suspendTradeProfile(req.params.id, req.body, req.userContext, req))));

// Trade Documents (both /documents and /trade-documents are intentionally supported under /api/diaspora)
async function documentListHandler(req, res) {
  res.json({ data: await listTradeDocuments({ importOrderId: req.query.importOrderId, verificationStatus: req.query.verificationStatus, ...pagination(req) }, req.userContext) });
}
async function documentCreateHandler(req, res) {
  res.status(201).json(await createTradeDocument(req.body, req.userContext, req));
}
router.get('/documents', auth, asyncHandler(documentListHandler));
router.post('/documents', auth, asyncHandler(documentCreateHandler));
router.get('/trade-documents', auth, asyncHandler(documentListHandler));
router.post('/trade-documents', auth, asyncHandler(documentCreateHandler));
router.get('/documents/:id', auth, asyncHandler(async (req, res) => res.json(await getTradeDocument(req.params.id, req.userContext))));
router.get('/trade-documents/:id', auth, asyncHandler(async (req, res) => res.json(await getTradeDocument(req.params.id, req.userContext))));
router.post('/documents/:id/extractions', auth, asyncHandler(async (req, res) => res.status(201).json(await recordDocumentExtraction(req.params.id, req.body, req.userContext, req))));
// Signs an object in the private `ocr-documents` bucket (passport, national ID, customs and
// registration paperwork), so the identity behind the reviewer role must be PROVEN, not asserted by
// a spoofable header. Found by the enumeration test rather than by reading — the FIFTH such site.
router.post('/documents/:id/run-ocr', reviewerAuth, requireProvenIdentity(), asyncHandler(async (req, res) => {
  const documentId = req.params.id;
  const userContext = req.userContext;

  const doc = await getTradeDocumentWithStorage(documentId, userContext);
  if (!doc.storage_path) {
    throw new ValidationError('Document has no storage path. Upload a file first.');
  }

  const documentTypeMap = {
    passport: 'passport',
    national_id: 'national_id',
    residence_card: 'national_id',
    vehicle_registration: 'registration_book',
    auction_sheet: 'customs_declaration',
    bill_of_lading: 'customs_declaration',
    commercial_invoice: 'customs_declaration',
    export_certificate: 'customs_declaration',
    customs_declaration: 'customs_declaration',
    inspection_certificate: 'customs_declaration',
    insurance_certificate: 'customs_declaration',
    duty_receipt: 'customs_declaration',
    packing_list: 'customs_declaration',
    port_release_order: 'customs_declaration',
    police_clearance: 'national_id',
    mechanical_report: 'customs_declaration',
  };

  const ocrDocType = documentTypeMap[doc.document_type] || 'customs_declaration';

  let signedUrl;
  try {
    signedUrl = await generateSecureReadUrl('ocr-documents', doc.storage_path);
  } catch (err) {
    throw new ValidationError('Failed to generate document access URL.');
  }

  let response;
  try {
    response = await fetch(signedUrl);
  } catch (err) {
    throw new ValidationError('Failed to fetch document from storage.');
  }

  if (!response.ok) {
    throw new ValidationError('Failed to fetch document from storage.');
  }

  const MAX_OCR_FILE_SIZE = 10 * 1024 * 1024;
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_OCR_FILE_SIZE) {
    throw new ValidationError('Document file exceeds maximum size limit of 10MB.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_OCR_FILE_SIZE) {
    throw new ValidationError('Document file exceeds maximum size limit of 10MB.');
  }

  const mimeType = response.headers.get('content-type') || 'application/pdf';
  const base64Data = `data:${mimeType};base64,${buffer.toString('base64')}`;

  let ocrResult;
  try {
    ocrResult = await DocumentIntelligenceService.extractDocumentData(ocrDocType, base64Data, userContext.id);
  } catch (err) {
    throw new ValidationError('OCR extraction failed. The document may be unreadable or unsupported.');
  }

  const extraction = await recordDocumentExtraction(documentId, {
    extraction_provider: 'carup_ocr',
    extracted_fields: ocrResult.extractedData || {},
    confidence_score: ocrResult.extractedData?.confidenceScore || 0,
    raw_response: ocrResult,
  }, userContext, req);

  res.status(201).json({
    extraction,
    ocr: {
      success: ocrResult.success,
      ocrDocumentId: ocrResult.ocrDocumentId,
      qualityMetrics: ocrResult.qualityMetrics,
    }
  });
}));
router.post('/documents/:id/verify', reviewerAuth, asyncHandler(async (req, res) => res.json(await verifyTradeDocument(req.params.id, req.body, req.userContext, req))));
router.post('/documents/:id/reject', reviewerAuth, asyncHandler(async (req, res) => res.json(await rejectTradeDocument(req.params.id, req.body, req.userContext, req))));
router.post('/trade-documents/:id/verify', reviewerAuth, asyncHandler(async (req, res) => res.json(await verifyTradeDocument(req.params.id, req.body, req.userContext, req))));
router.post('/trade-documents/:id/reject', reviewerAuth, asyncHandler(async (req, res) => res.json(await rejectTradeDocument(req.params.id, req.body, req.userContext, req))));

// Containers
router.get('/containers', auth, asyncHandler(async (req, res) => res.json({ data: await listContainerShipments({ status: req.query.status, ...pagination(req) }) })));
router.post('/containers', auth, asyncHandler(async (req, res) => res.status(201).json(await createContainerShipment(req.body, req.userContext, req))));
router.get('/containers/:id', auth, asyncHandler(async (req, res) => res.json(await getContainerShipment(req.params.id))));
router.post('/containers/:id/open-booking', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.BOOKING_OPEN, req.userContext, req))));
router.post('/containers/:id/close-booking', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.BOOKING_CLOSED, req.userContext, req))));
router.post('/containers/:id/mark-loading', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.LOADING, req.userContext, req))));
router.post('/containers/:id/mark-shipped', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.SHIPPED, req.userContext, req))));
router.post('/containers/:id/mark-arrived', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.ARRIVED, req.userContext, req))));
router.post('/containers/:id/mark-completed', auth, asyncHandler(async (req, res) => res.json(await transitionContainer(req.params.id, CONTAINER_STATUSES.COMPLETED, req.userContext, req))));

// Reservations
router.get('/reservations', auth, asyncHandler(async (req, res) => res.json({ data: await listCargoReservations({ containerId: req.query.containerId, importOrderId: req.query.importOrderId, status: req.query.status, ...pagination(req) }, req.userContext) })));
router.post('/reservations', auth, asyncHandler(async (req, res) => res.status(201).json(await createCargoReservation(req.body, req.userContext, req))));
router.post('/reservations/:id/approve', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.APPROVED, req.userContext, req, req.body))));
router.post('/reservations/:id/reject', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.REJECTED, req.userContext, req, req.body))));
router.post('/reservations/:id/cancel', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.CANCELLED, req.userContext, req, req.body))));

// Shipments
router.get('/shipments', auth, asyncHandler(async (req, res) => res.json({ data: await listShipments({ importOrderId: req.query.importOrderId, status: req.query.status, ...pagination(req) }, req.userContext) })));
router.post('/shipments', auth, asyncHandler(async (req, res) => res.status(201).json(await createShipment(req.body, req.userContext, req))));
router.get('/shipments/:id', auth, asyncHandler(async (req, res) => res.json(await getShipment(req.params.id, req.userContext))));
router.get('/shipments/:id/timeline', auth, asyncHandler(async (req, res) => res.json({ data: await getShipmentTimeline(req.params.id, req.userContext) })));
router.patch('/shipments/:id/stage', auth, asyncHandler(async (req, res) => res.json(await updateShipmentStage(req.params.id, req.body, req.userContext, req))));

// Compliance
router.get('/compliance', reviewerAuth, asyncHandler(async (req, res) => res.json({ data: await listComplianceReviews({ importOrderId: req.query.importOrderId, status: req.query.status, ...pagination(req) }) })));
router.post('/compliance', reviewerAuth, asyncHandler(async (req, res) => res.status(201).json(await createComplianceReview(req.body, req.userContext, req))));
router.post('/compliance/government-documents', reviewerAuth, asyncHandler(async (req, res) => res.status(201).json(await upsertGovernmentDocument(req.body, req.userContext, req))));
router.post('/compliance/:id/approve', reviewerAuth, asyncHandler(async (req, res) => res.json(await updateComplianceReview(req.params.id, 'APPROVED', req.body, req.userContext, req))));
router.post('/compliance/:id/flag', reviewerAuth, asyncHandler(async (req, res) => res.json(await updateComplianceReview(req.params.id, 'FLAGGED', req.body, req.userContext, req))));

// Milestones, Reputation, Notifications, Audit
router.get('/milestones', auth, asyncHandler(async (req, res) => {
  const order = req.query.importOrderId;
  if (!order) throw new ValidationError('importOrderId query parameter is required');
  const data = (await getImportOrder(order, req.userContext)).diaspora_payment_milestones || [];
  res.json({ data });
}));

router.get('/reviews', auth, asyncHandler(async (req, res) => res.json({ data: await listReputationRecords({ tradeProfileId: req.query.tradeProfileId, importOrderId: req.query.importOrderId, ...pagination(req) }) })));
router.get('/reputation', auth, asyncHandler(async (req, res) => res.json({ data: await listReputationRecords({ tradeProfileId: req.query.tradeProfileId, importOrderId: req.query.importOrderId, ...pagination(req) }) })));
router.post('/reputation', auth, asyncHandler(async (req, res) => res.status(201).json(await createReputationRecord(req.body, req.userContext, req))));
router.get('/notifications', auth, asyncHandler(async (req, res) => res.json({ data: await listNotificationPreferences(req.userContext.id) })));
router.get('/audit', reviewerAuth, asyncHandler(async (req, res) => res.json({ data: await listDiasporaAudit({ importOrderId: req.query.importOrderId, limit: Number(req.query.limit || 100) }) })));

export default router;
