import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMPORT_ORDER_STATUSES, IMPORT_ORDER_TRANSITIONS } from '../constants/diaspora/diasporaStatuses.js';
import { DIASPORA_DOCUMENT_TYPES, GOVERNMENT_DOCUMENT_CATEGORIES } from '../constants/diaspora/diasporaDocumentTypes.js';
import {
  assertCanReadImportOrder,
  assertImportOrderIdRequired,
  canReadImportOrder,
  canReadTradeDocument,
  canTransitionImportOrderForContext,
  redactTradeDocumentStorage,
} from '../services/diaspora/diasporaAuthorization.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';

const routeFile = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
const serverFile = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const authMiddlewareFile = readFileSync(new URL('../middleware/authMiddleware.js', import.meta.url), 'utf8');
const migrationFile = readFileSync(new URL('../../database/migrations/013_diaspora_trade_schema.sql', import.meta.url), 'utf8');
const workflowService = readFileSync(new URL('../services/diaspora/diasporaWorkflowService.js', import.meta.url), 'utf8');
const importOrderService = readFileSync(new URL('../services/diaspora/diasporaImportOrderService.js', import.meta.url), 'utf8');
const documentService = readFileSync(new URL('../services/diaspora/diasporaDocumentService.js', import.meta.url), 'utf8');
const containerService = readFileSync(new URL('../services/diaspora/diasporaContainerService.js', import.meta.url), 'utf8');
const reservationService = readFileSync(new URL('../services/diaspora/diasporaReservationService.js', import.meta.url), 'utf8');
const shipmentService = readFileSync(new URL('../services/diaspora/diasporaShipmentService.js', import.meta.url), 'utf8');
const eventWorker = readFileSync(new URL('../services/eventBus/eventWorker.js', import.meta.url), 'utf8');

const authOrder = Object.freeze({
  id: 'order-1',
  tenant_id: 'tenant-1',
  buyer_id: 'buyer-1',
  created_by: 'creator-1',
  updated_by: 'updater-1',
  status: IMPORT_ORDER_STATUSES.IMPORT_REQUESTED,
});

const authParticipants = Object.freeze([
  {
    id: 'participant-1',
    import_order_id: 'order-1',
    user_id: 'seller-1',
    participant_role: 'seller',
    verification_status: 'VERIFIED',
  },
]);

const authDocument = Object.freeze({
  id: 'document-1',
  tenant_id: 'tenant-1',
  import_order_id: 'order-1',
  uploaded_by: 'buyer-1',
  document_type: 'bill_of_lading',
  document_url: 'https://example.test/document.pdf',
  storage_path: 'private/diaspora/order-1/document.pdf',
});

test('/api/diaspora is mounted once only and router uses relative routes only', () => {
  assert.equal((serverFile.match(/app\.use\('\/api\/diaspora',\s*diasporaRouter\)/g) || []).length, 1);
  assert.equal(routeFile.includes("router.get('/api/"), false);
  assert.equal(routeFile.includes("router.post('/api/"), false);
  assert.equal(routeFile.includes("router.patch('/api/"), false);
  assert.equal(routeFile.includes("router.delete('/api/"), false);
});

test('Diaspora workflow does not allow incomplete imports to jump straight to Zimbabwe-ready', () => {
  assert.equal(
    IMPORT_ORDER_TRANSITIONS[IMPORT_ORDER_STATUSES.IMPORT_REQUESTED].includes(IMPORT_ORDER_STATUSES.ZIMBABWE_READY),
    false,
  );
  assert.equal(
    IMPORT_ORDER_TRANSITIONS[IMPORT_ORDER_STATUSES.INSURANCE_PENDING].includes(IMPORT_ORDER_STATUSES.ZIMBABWE_READY),
    true,
  );
});

test('Diaspora workflow rejects representative illegal transition edges', () => {
  const illegalEdges = [
    [IMPORT_ORDER_STATUSES.IMPORT_REQUESTED, IMPORT_ORDER_STATUSES.SHIPPED],
    [IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING, IMPORT_ORDER_STATUSES.CONTAINER_BOOKED],
    [IMPORT_ORDER_STATUSES.DUTY_PENDING, IMPORT_ORDER_STATUSES.ZIMBABWE_READY],
    [IMPORT_ORDER_STATUSES.COMPLETED, IMPORT_ORDER_STATUSES.DISPUTED],
  ];

  for (const [from, to] of illegalEdges) {
    assert.equal(
      IMPORT_ORDER_TRANSITIONS[from].includes(to),
      false,
      `${from} should not directly transition to ${to}`,
    );
  }
});

test('Diaspora workflow terminal states cannot mutate further', () => {
  assert.deepEqual(IMPORT_ORDER_TRANSITIONS[IMPORT_ORDER_STATUSES.COMPLETED], []);
  assert.deepEqual(IMPORT_ORDER_TRANSITIONS[IMPORT_ORDER_STATUSES.CANCELLED], []);
  assert.deepEqual(IMPORT_ORDER_TRANSITIONS[IMPORT_ORDER_STATUSES.DISPUTED], []);
});

test('Diaspora document registry includes required Japan-to-Zimbabwe trade documents', () => {
  for (const type of ['auction_sheet', 'bill_of_lading', 'commercial_invoice', 'export_certificate', 'customs_declaration', 'duty_receipt']) {
    assert.equal(DIASPORA_DOCUMENT_TYPES.includes(type), true, `${type} should be supported`);
  }
});

test('Government documentation footprint contains all Zimbabwe-ready prerequisites', () => {
  assert.equal(GOVERNMENT_DOCUMENT_CATEGORIES.length, 10);
  for (const category of ['ZIMRA_CLEARANCE', 'CVR_REGISTRATION', 'VID_ROADWORTHINESS', 'CID_POLICE_CLEARANCE', 'INSURANCE_RECORD']) {
    assert.equal(GOVERNMENT_DOCUMENT_CATEGORIES.includes(category), true, `${category} should be represented`);
  }

  for (const category of GOVERNMENT_DOCUMENT_CATEGORIES) {
    assert.equal(workflowService.includes(`'${category}'`), true, `${category} should be enforced by workflow service`);
  }
});

test('Zimbabwe-ready status is guarded by government document prerequisite assertion', () => {
  assert.equal(workflowService.includes('assertZimbabweReadyPrerequisites(importOrderId)'), true);
  assert.equal(workflowService.includes("nextStatus === IMPORT_ORDER_STATUSES.ZIMBABWE_READY"), true);
  assert.equal(workflowService.includes('Cannot mark import order as ZIMBABWE_READY'), true);
});

test('Import orders are order-first and do not create vehicle records immediately', () => {
  const createImportOrderBlock = importOrderService.slice(
    importOrderService.indexOf('export async function createImportOrder'),
    importOrderService.indexOf('export async function listImportOrders'),
  );
  assert.equal(createImportOrderBlock.includes("from('diaspora_import_orders')"), true);
  assert.equal(createImportOrderBlock.includes("from('vehicles')"), false);
  assert.equal(createImportOrderBlock.includes(".insert({"), false, 'createImportOrder should insert the cleaned order payload, not build vehicle rows');
});

test('Vehicle linking is isolated to verified import identity records and does not insert duplicate vehicles', () => {
  const linkBlock = importOrderService.slice(importOrderService.indexOf('export async function linkVehicleImportRecord'));
  assert.equal(linkBlock.includes("from('vehicle_import_records')"), true);
  assert.equal(linkBlock.includes('linked_vehicle_vin'), true);
  assert.equal(linkBlock.includes("from('vehicles')"), false);
  assert.equal(linkBlock.includes("vehicle_vin: payload.vehicle_vin || null"), true);
  assert.equal(linkBlock.includes("payload.verification_status !== 'VERIFIED'"), true);
  assert.equal(linkBlock.includes('Cannot link a vehicle VIN until import identity is verified'), true);
});

test('Critical workflow/document/container/shipment actions write audit logs', () => {
  const criticalSources = [
    ['import orders', importOrderService, ['IMPORT_ORDER_CREATED', 'SELLER_ASSIGNED', 'QUOTE_ISSUED', 'PAYMENT_MILESTONE_CREATED', 'VEHICLE_IMPORT_RECORD_LINKED']],
    ['documents', documentService, ['TRADE_DOCUMENT_UPLOADED', 'TRADE_DOCUMENT_OCR_EXTRACTED', 'TRADE_DOCUMENT_VERIFIED', 'TRADE_DOCUMENT_REJECTED']],
    ['containers', containerService, ['CONTAINER_CREATED', 'CONTAINER_STATUS_CHANGED']],
    ['reservations', reservationService, ['CARGO_RESERVATION_CREATED', 'CARGO_RESERVATION_']],
    ['shipments', shipmentService, ['SHIPMENT_CREATED', 'SHIPMENT_STAGE_CHANGED']],
  ];

  for (const [label, source, actions] of criticalSources) {
    assert.equal(source.includes('writeDiasporaAudit'), true, `${label} should use audit service`);
    for (const action of actions) {
      assert.equal(source.includes(action), true, `${label} should audit ${action}`);
    }
  }
});

test('Document rejection records verification state and audit event', () => {
  const rejectBlock = documentService.slice(documentService.indexOf('export async function rejectTradeDocument'));
  assert.equal(rejectBlock.includes('DOCUMENT_STATUSES.REJECTED'), true);
  assert.equal(rejectBlock.includes("from('diaspora_trade_document_verifications')"), true);
  assert.equal(rejectBlock.includes('TRADE_DOCUMENT_REJECTED'), true);
  assert.equal(rejectBlock.includes('writeDiasporaAudit'), true);
});

test('RLS protects private trade documents and no public document policy is present', () => {
  assert.equal(migrationFile.includes('ALTER TABLE diaspora_trade_documents ENABLE ROW LEVEL SECURITY;'), true);
  assert.equal(migrationFile.includes('CREATE POLICY "diaspora_documents_private_access" ON diaspora_trade_documents'), true);
  assert.equal(migrationFile.includes('CREATE POLICY "diaspora_documents_public'), false);
  assert.equal(/ON diaspora_trade_documents[\s\S]*USING \(true\)/.test(migrationFile), false);
});

test('All Diaspora domain tables have RLS enabled in the migration', () => {
  const tables = [
    'diaspora_import_orders',
    'diaspora_import_order_participants',
    'diaspora_trade_profiles',
    'diaspora_import_quotes',
    'diaspora_trade_documents',
    'diaspora_trade_document_extractions',
    'diaspora_trade_document_verifications',
    'diaspora_container_shipments',
    'diaspora_cargo_reservations',
    'diaspora_shipments',
    'diaspora_shipment_stage_events',
    'diaspora_compliance_reviews',
    'diaspora_payment_milestones',
    'diaspora_reputation_records',
    'diaspora_import_audit_log',
    'diaspora_notification_preferences',
    'vehicle_import_records',
    'vehicle_government_documents',
  ];

  for (const table of tables) {
    assert.equal(migrationFile.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`), true, `${table} should have RLS enabled`);
  }
});

test('Diaspora migration has no destructive statements against existing core tables', () => {
  const destructiveExistingTablePattern = /(DROP|TRUNCATE|DELETE\s+FROM)\s+(TABLE\s+IF\s+EXISTS\s+)?(users|vehicles|safepay_escrows|notification_queue|domain_events|organizations)\b/i;
  assert.equal(destructiveExistingTablePattern.test(migrationFile), false);
});

test('Event worker uses environment connection settings and no hard-coded Supabase credentials', () => {
  assert.equal(eventWorker.includes('process.env.EVENT_WORKER_DATABASE_URL'), true);
  assert.equal(eventWorker.includes('process.env.SUPABASE_POOLER_DB_URL'), true);
  assert.equal(eventWorker.includes('process.env.SUPABASE_TRANSACTION_POOLER_URL'), true);
  assert.equal(eventWorker.includes('EVENT_WORKER_INTERVAL_ENABLED'), true);
  assert.equal(eventWorker.includes('vhmnajoeicasaigiophh'), false);
  assert.equal(eventWorker.includes('HVYbYVb1x2ErqzH4'), false);
});

test('Service authorization blocks unrelated users from reading another import order', () => {
  assert.throws(
    () => assertCanReadImportOrder(authOrder, authParticipants, { id: 'stranger-1', role: 'member', tenantId: 'tenant-2' }),
    ForbiddenError,
  );
});

test('Service authorization allows order owner, assigned participant, and tenant admin to read import orders', () => {
  assert.equal(canReadImportOrder(authOrder, authParticipants, { id: 'buyer-1', role: 'buyer' }), true);
  assert.equal(canReadImportOrder(authOrder, authParticipants, { id: 'seller-1', role: 'seller' }), true);
  assert.equal(canReadImportOrder(authOrder, authParticipants, { id: 'admin-1', role: 'admin', tenantRole: 'admin', tenantId: 'tenant-1' }), true);
  assert.equal(canReadImportOrder(authOrder, authParticipants, { id: 'creator-1', role: 'member' }), true);
  assert.equal(canReadImportOrder(authOrder, authParticipants, { id: 'reviewer-1', role: 'government_reviewer', platformRole: 'government_reviewer' }), true);
});

test('Service authorization blocks unrelated users from listing another order trade documents', () => {
  assert.equal(
    canReadTradeDocument(authDocument, authOrder, authParticipants, { id: 'stranger-1', role: 'member', tenantId: 'tenant-2' }),
    false,
  );
});

test('Service authorization requires importOrderId for normal document list callers', () => {
  assert.throws(
    () => assertImportOrderIdRequired(undefined, { id: 'buyer-1', role: 'buyer' }),
    ValidationError,
  );
  assert.doesNotThrow(() => assertImportOrderIdRequired(undefined, { id: 'reviewer-1', role: 'government_reviewer', platformRole: 'government_reviewer' }));
});

test('Service authorization redacts private trade document storage paths from read responses', () => {
  const safeDocument = redactTradeDocumentStorage(authDocument);
  assert.equal('storage_path' in safeDocument, false);
  assert.equal(safeDocument.document_url, authDocument.document_url);
});

test('Service authorization blocks unrelated users from transitioning another import order', () => {
  assert.equal(
    canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.CANCELLED, { id: 'stranger-1', role: 'member' }),
    false,
  );
});

test('Service authorization allows authorized actors to perform permitted transitions', () => {
  assert.equal(
    canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.CANCELLED, { id: 'buyer-1', role: 'buyer' }),
    true,
  );
  assert.equal(
    canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.QUOTE_ISSUED, { id: 'seller-1', role: 'seller' }),
    true,
  );
  assert.equal(
    canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.DOCUMENTS_VERIFIED, { id: 'admin-1', role: 'admin', tenantRole: 'admin', tenantId: 'tenant-1' }),
    true,
  );
});

test('Diaspora authorization ignores client-requested reviewer role without trusted platform role', () => {
  const spoofedReviewer = {
    id: 'stranger-1',
    role: 'government_reviewer',
    requestedRole: 'government_reviewer',
    tenantId: 'tenant-2',
  };

  assert.equal(canReadImportOrder(authOrder, authParticipants, spoofedReviewer), false);
  assert.equal(canReadTradeDocument(authDocument, authOrder, authParticipants, spoofedReviewer), false);
  assert.equal(canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.CANCELLED, spoofedReviewer), false);
  assert.throws(() => assertImportOrderIdRequired(undefined, spoofedReviewer), ValidationError);
});

test('Diaspora authorization allows trusted platform reviewers and tenant admins from server-derived fields', () => {
  const trustedGovernment = { id: 'reviewer-1', role: 'government', platformRole: 'government' };
  const trustedPlatformAdmin = { id: 'platform-1', role: 'platform_admin', platformRole: 'platform_admin' };
  const trustedTenantAdmin = { id: 'tenant-admin-1', role: 'admin', tenantRole: 'admin', tenantId: 'tenant-1' };

  assert.equal(canReadImportOrder(authOrder, authParticipants, trustedGovernment), true);
  assert.doesNotThrow(() => assertImportOrderIdRequired(undefined, trustedPlatformAdmin));
  assert.equal(canTransitionImportOrderForContext(authOrder, authParticipants, IMPORT_ORDER_STATUSES.CANCELLED, trustedPlatformAdmin), true);
  assert.equal(canReadTradeDocument(authDocument, authOrder, authParticipants, trustedTenantAdmin), true);
});

test('Auth middleware treats x-stakeholder-role as requestedRole, not authority', () => {
  assert.equal(authMiddlewareFile.includes("const requestedRole = normalizeRole(req.headers['x-stakeholder-role'])"), true);
  assert.equal(authMiddlewareFile.includes('activeRole = roleHeader'), false);
  assert.equal(authMiddlewareFile.includes('resolveEffectiveRole({'), true);
  assert.equal(authMiddlewareFile.includes("requested !== 'admin'"), true);
  assert.equal(authMiddlewareFile.includes('platformRole,'), true);
  assert.equal(authMiddlewareFile.includes('tenantRole,'), true);
  assert.equal(authMiddlewareFile.includes('isVerified: Boolean(user.is_verified)'), true);
});

test('Diaspora routes pass user context into order, document, and transition service calls', () => {
  assert.equal(routeFile.includes('getImportOrder(req.params.id, req.userContext)'), true);
  assert.equal(routeFile.includes('listTradeDocuments({ importOrderId: req.params.id, ...pagination(req) }, req.userContext)'), true);
  assert.equal(routeFile.includes('listTradeDocuments({ importOrderId: req.query.importOrderId, verificationStatus: req.query.verificationStatus, ...pagination(req) }, req.userContext)'), true);
  assert.equal(routeFile.includes('getTradeDocument(req.params.id, req.userContext)'), true);
  assert.equal(routeFile.includes('userContext: req.userContext'), true);
});

test('Diaspora services enforce user-context authorization on direct reads and transitions', () => {
  assert.equal(importOrderService.includes('export async function getImportOrder(id, userContext = {})'), true);
  assert.equal(importOrderService.includes('assertCanReadImportOrder(data, participants, context)'), true);
  assert.equal(documentService.includes('export async function listTradeDocuments({ importOrderId, verificationStatus, limit = 50, offset = 0 }, userContext = {})'), true);
  assert.equal(documentService.includes('assertImportOrderIdRequired(importOrderId, context)'), true);
  assert.equal(documentService.includes('assertCanReadTradeDocument(data, order, participants, context)'), true);
  assert.equal(workflowService.includes('userContext = {}'), true);
  assert.equal(workflowService.includes('assertCanTransitionImportOrder(order, participants, nextStatus, context)'), true);
  assert.equal(documentService.includes('req.query.role'), false);
  assert.equal(routeFile.includes('req.body.role'), false);
});
