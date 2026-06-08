import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import { listDiasporaAudit } from '../services/diaspora/diasporaAuditService.js';
import { createImportOrder, listImportOrders, getImportOrder, assignSeller, addQuote, addPaymentMilestone, linkVehicleImportRecord } from '../services/diaspora/diasporaImportOrderService.js';
import { transitionImportOrder } from '../services/diaspora/diasporaWorkflowService.js';
import { createTradeProfile, listTradeProfiles, getTradeProfile, verifyTradeProfile, suspendTradeProfile } from '../services/diaspora/diasporaTradeProfileService.js';
import { createTradeDocument, listTradeDocuments, getTradeDocument, recordDocumentExtraction, verifyTradeDocument, rejectTradeDocument } from '../services/diaspora/diasporaDocumentService.js';
import { createContainerShipment, listContainerShipments, getContainerShipment, transitionContainer } from '../services/diaspora/diasporaContainerService.js';
import { createCargoReservation, listCargoReservations, updateReservationStatus } from '../services/diaspora/diasporaReservationService.js';
import { createShipment, listShipments, getShipment, updateShipmentStage, getShipmentTimeline } from '../services/diaspora/diasporaShipmentService.js';
import { createComplianceReview, listComplianceReviews, updateComplianceReview, upsertGovernmentDocument, getGovernmentFootprint } from '../services/diaspora/diasporaComplianceService.js';
import { listNotificationPreferences } from '../services/diaspora/diasporaNotificationService.js';
import { createReputationRecord, listReputationRecords } from '../services/diaspora/diasporaReputationService.js';
import { CONTAINER_STATUSES, RESERVATION_STATUSES } from '../constants/diaspora/diasporaStatuses.js';
import DocumentIntelligenceService from '../services/document-intelligence/documentIntelligenceService.js';
import { generateSecureReadUrl } from '../services/storage/storageService.js';

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

router.post('/import-orders/:id/payment-milestones', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await addPaymentMilestone(req.params.id, req.body, req.userContext, req));
}));

router.post('/import-orders/:id/vehicle-import-record', reviewerAuth, asyncHandler(async (req, res) => {
  res.status(201).json(await linkVehicleImportRecord(req.params.id, req.body, req.userContext, req));
}));

router.get('/import-orders/:id/government-footprint', auth, asyncHandler(async (req, res) => {
  res.json({ data: await getGovernmentFootprint(req.params.id) });
}));

// Trade Profiles
router.get('/trade-profiles', auth, asyncHandler(async (req, res) => {
  res.json({ data: await listTradeProfiles({ roleType: req.query.roleType, verificationStatus: req.query.verificationStatus, country: req.query.country, ...pagination(req) }) });
}));

router.post('/trade-profiles', auth, asyncHandler(async (req, res) => {
  res.status(201).json(await createTradeProfile(req.body, req.userContext, req));
}));

router.get('/trade-profiles/:id', auth, asyncHandler(async (req, res) => res.json(await getTradeProfile(req.params.id))));
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
router.post('/documents/:id/run-ocr', reviewerAuth, asyncHandler(async (req, res) => {
  const documentId = req.params.id;
  const userContext = req.userContext;

  const doc = await getTradeDocument(documentId, userContext);
  if (!doc.storage_path) {
    throw new ValidationError('Document has no storage path. Upload a file first.');
  }

  const documentTypeMap = {
    'passport': 'passport',
    'national_id': 'national_id',
    'residence_card': 'national_id',
    'vehicle_registration': 'registration_book',
    'auction_sheet': 'customs_declaration',
    'bill_of_lading': 'customs_declaration',
    'commercial_invoice': 'customs_declaration',
    'export_certificate': 'customs_declaration',
    'customs_declaration': 'customs_declaration',
    'inspection_certificate': 'customs_declaration',
    'insurance_certificate': 'customs_declaration',
    'duty_receipt': 'customs_declaration',
    'packing_list': 'customs_declaration',
    'port_release_order': 'customs_declaration',
    'police_clearance': 'national_id',
    'mechanical_report': 'customs_declaration',
  };

  const ocrDocType = documentTypeMap[doc.document_type] || 'customs_declaration';

  let signedUrl;
  try {
    const result = await generateSecureReadUrl('ocr-documents', doc.storage_path);
    signedUrl = result.signedUrl;
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

  const MAX_OCR_FILE_SIZE = 10 * 1024 * 1024; // 10MB
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
router.get('/reservations', auth, asyncHandler(async (req, res) => res.json({ data: await listCargoReservations({ containerId: req.query.containerId, importOrderId: req.query.importOrderId, status: req.query.status, ...pagination(req) }) })));
router.post('/reservations', auth, asyncHandler(async (req, res) => res.status(201).json(await createCargoReservation(req.body, req.userContext, req))));
router.post('/reservations/:id/approve', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.APPROVED, req.userContext, req, req.body))));
router.post('/reservations/:id/reject', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.REJECTED, req.userContext, req, req.body))));
router.post('/reservations/:id/cancel', auth, asyncHandler(async (req, res) => res.json(await updateReservationStatus(req.params.id, RESERVATION_STATUSES.CANCELLED, req.userContext, req, req.body))));

// Shipments
router.get('/shipments', auth, asyncHandler(async (req, res) => res.json({ data: await listShipments({ importOrderId: req.query.importOrderId, status: req.query.status, ...pagination(req) }) })));
router.post('/shipments', auth, asyncHandler(async (req, res) => res.status(201).json(await createShipment(req.body, req.userContext, req))));
router.get('/shipments/:id', auth, asyncHandler(async (req, res) => res.json(await getShipment(req.params.id))));
router.get('/shipments/:id/timeline', auth, asyncHandler(async (req, res) => res.json({ data: await getShipmentTimeline(req.params.id) })));
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
