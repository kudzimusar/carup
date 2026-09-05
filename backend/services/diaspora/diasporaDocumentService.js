import { supabase } from '../../db/supabase.js';
import { DOCUMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { validateTradeDocumentPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { notifyDiasporaMilestone } from './diasporaNotificationService.js';
import {
  assertCanReadTradeDocument,
  assertImportOrderIdRequired,
  canReadImportOrder,
  canReadTradeDocument,
  isPlatformReviewer,
  redactTradeDocumentStorage,
  requireUserContext,
} from './diasporaAuthorization.js';

async function getOrder(importOrderId) {
  const { data, error } = await supabase.from('diaspora_import_orders').select('*').eq('id', importOrderId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora import order not found');
  return data;
}

async function getOrderParticipants(importOrderId) {
  const { data, error } = await supabase
    .from('diaspora_import_order_participants')
    .select('*')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);

  if (error) throw new DatabaseError(error.message);
  return data || [];
}

async function getOrderAccess(importOrderId, userContext) {
  if (!importOrderId) {
    return { order: null, participants: [], canReadOrder: false };
  }

  const order = await getOrder(importOrderId);
  const participants = await getOrderParticipants(importOrderId);
  return {
    order,
    participants,
    canReadOrder: canReadImportOrder(order, participants, userContext),
  };
}

export async function createTradeDocument(payload, userContext = {}, req = null) {
  validateTradeDocumentPayload(payload);
  const order = payload.import_order_id ? await getOrder(payload.import_order_id) : null;
  const { data, error } = await supabase
    .from('diaspora_trade_documents')
    .insert({
      tenant_id: userContext?.tenantId || order?.tenant_id || payload.tenant_id || null,
      import_order_id: payload.import_order_id || null,
      uploaded_by: userContext?.id || payload.uploaded_by || null,
      document_type: payload.document_type,
      document_url: payload.document_url || null,
      storage_path: payload.storage_path || null,
      verification_status: payload.verification_status || DOCUMENT_STATUSES.UPLOADED,
      ocr_document_id: payload.ocr_document_id || null,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_DOCUMENT_UPLOADED', resourceType: 'diaspora_trade_document', resourceId: data.id, newState: data, req });

  if (order && order.status !== IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING && order.status !== IMPORT_ORDER_STATUSES.DOCUMENTS_VERIFIED) {
    try {
      await transitionImportOrder({ importOrderId: order.id, nextStatus: IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING, actorId: userContext?.id, userContext, metadata: { documentId: data.id }, req });
    } catch (err) {
      console.warn('Skipping automatic DOCUMENTS_PENDING transition:', err.message);
    }
  }

  await notifyDiasporaMilestone({ eventType: 'DIASPORA_DOCUMENT_UPLOADED', importOrder: order || data, actorId: userContext?.id, title: 'Trade document uploaded', message: 'A diaspora trade document has been uploaded for review.', metadata: { documentId: data.id, documentType: data.document_type } });
  return data;
}

export async function listTradeDocuments({ importOrderId, verificationStatus, limit = 50, offset = 0 }, userContext = {}) {
  const context = requireUserContext(userContext);
  assertImportOrderIdRequired(importOrderId, context);

  let query = supabase.from('diaspora_trade_documents').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (verificationStatus) query = query.eq('verification_status', verificationStatus);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);

  if (isPlatformReviewer(context) && !importOrderId) {
    return (data || []).map(redactTradeDocumentStorage);
  }

  const { order, participants, canReadOrder } = await getOrderAccess(importOrderId, context);
  const visibleDocuments = (data || []).filter((document) => canReadTradeDocument(document, order, participants, context));
  if (!canReadOrder && visibleDocuments.length === 0) {
    throw new NotFoundError('Diaspora trade documents not found');
  }

  return visibleDocuments.map(redactTradeDocumentStorage);
}

/**
 * Fetch a trade document the caller is authorized to read, WITHOUT redacting storage_path.
 *
 * For server-side processing only (e.g. OCR needs the storage path to generate a signed read URL).
 * The returned record MUST NOT be sent directly in an API response — use getTradeDocument() for
 * anything that reaches the client, which redacts storage_path/private_storage_path.
 */
export async function getTradeDocumentWithStorage(id, userContext = {}) {
  const context = requireUserContext(userContext);
  const { data, error } = await supabase.from('diaspora_trade_documents').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora trade document not found');

  const { order, participants } = await getOrderAccess(data.import_order_id, context);
  assertCanReadTradeDocument(data, order, participants, context);
  return data;
}

export async function getTradeDocument(id, userContext = {}) {
  return redactTradeDocumentStorage(await getTradeDocumentWithStorage(id, userContext));
}

const DIASPORA_PROVIDER_OCR_ROUTE = /\/api\/diaspora\/(?:documents|trade-documents)\/[^/?#]+\/run-ocr(?:$|[?#])/;

function retiredClientExtractionError() {
  const error = new ValidationError(
    'Client-authored OCR extraction records are retired. Provider-backed extraction must come from the governed Diaspora run-ocr workflow.'
  );
  error.statusCode = 410;
  error.code = 'CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED';
  return error;
}

/**
 * Runtime Diaspora OCR evidence must be derived from a provider execution CarUp itself observed.
 *
 * The historical service accepted extraction_provider, extracted_fields, confidence_score and
 * raw_response straight from an authenticated request body. The route-level convergence guard
 * already retires that endpoint, but truth integrity may not depend on route ordering alone. This
 * service therefore independently refuses any runtime request that did not originate from the
 * provider-backed /run-ocr path, and it derives the persisted fields/provider/confidence from the
 * returned Document Intelligence object rather than trusting duplicated caller fields.
 *
 * Direct service calls without an HTTP request are retained only for NODE_ENV=test integration
 * fixtures. There is no runtime caller without req in the repository.
 */
// Exported for adversarial regression only. This is the single point where a client-supplied
// provider name, confidence or field set is discarded in favour of the server-observed provider
// result, so that property must be provable by executing it — not by matching its source text.
export function normalizeProviderBackedExtraction(payload = {}, req = null) {
  if (!req) {
    if (process.env.NODE_ENV !== 'test') {
      throw retiredClientExtractionError();
    }
    return {
      extractionProvider: payload.extraction_provider || 'carup_ocr',
      extractedFields: payload.extracted_fields || {},
      confidenceScore: payload.confidence_score || 0,
      rawResponse: payload.raw_response || {},
    };
  }

  const sourceRoute = String(req.originalUrl || req.url || '');
  if (!DIASPORA_PROVIDER_OCR_ROUTE.test(sourceRoute)) {
    throw retiredClientExtractionError();
  }

  const raw = payload.raw_response;
  if (!raw || raw.executionStatus !== 'provider_succeeded' || raw.success !== true || !raw.provider || !raw.model) {
    throw new ValidationError(
      'Provider-backed OCR execution evidence is required before a Diaspora extraction can be recorded.'
    );
  }

  const extractedFields = raw.extractedData && typeof raw.extractedData === 'object'
    ? raw.extractedData
    : {};
  const confidenceScore = raw.confidenceReported === true && Number.isFinite(Number(raw.confidence))
    ? Number(raw.confidence)
    : 0;

  return {
    extractionProvider: raw.provider,
    extractedFields,
    confidenceScore,
    rawResponse: raw,
  };
}

export async function recordDocumentExtraction(documentId, payload, userContext = {}, req = null) {
  // This happens BEFORE any document/database read so the retired client-authored route cannot use
  // a valid document id to get as far as the evidence store. A provider outage/no-content result is
  // also refused here: no successful provider execution means no OCR_EXTRACTED state transition.
  const normalized = normalizeProviderBackedExtraction(payload, req);

  const doc = await getTradeDocument(documentId, userContext);
  const { data, error } = await supabase
    .from('diaspora_trade_document_extractions')
    .insert({
      trade_document_id: documentId,
      tenant_id: doc.tenant_id,
      extraction_provider: normalized.extractionProvider,
      extracted_fields: normalized.extractedFields,
      // Schema 013 keeps this NOT NULL. Zero is only the storage sentinel for "provider reported no
      // confidence"; raw_response.confidenceReported is the authority for whether a measurement
      // existed, so zero can never be interpreted as a substituted model score.
      confidence_score: normalized.confidenceScore,
      raw_response: normalized.rawResponse,
      verification_status: DOCUMENT_STATUSES.OCR_EXTRACTED,
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await supabase.from('diaspora_trade_documents').update({ verification_status: DOCUMENT_STATUSES.OCR_EXTRACTED, updated_by: userContext?.id, updated_at: new Date().toISOString() }).eq('id', documentId);
  await writeDiasporaAudit({ importOrderId: doc.import_order_id, tenantId: doc.tenant_id, actorId: userContext?.id, action: 'TRADE_DOCUMENT_OCR_EXTRACTED', resourceType: 'diaspora_trade_document_extraction', resourceId: data.id, newState: data, req });
  return data;
}

export async function verifyTradeDocument(id, payload = {}, userContext = {}, req = null) {
  const previous = await getTradeDocument(id, userContext);
  const { data, error } = await supabase
    .from('diaspora_trade_documents')
    .update({ verification_status: DOCUMENT_STATUSES.VERIFIED, reviewed_by: userContext?.id, reviewed_at: new Date().toISOString(), updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), verification: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await supabase.from('diaspora_trade_document_verifications').insert({ trade_document_id: id, tenant_id: data.tenant_id, verification_status: DOCUMENT_STATUSES.VERIFIED, verified_by: userContext?.id, verified_at: new Date().toISOString(), notes: payload.notes || null, metadata: payload.metadata || {} });
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_DOCUMENT_VERIFIED', resourceType: 'diaspora_trade_document', resourceId: id, previousState: previous, newState: data, req });

  if (data.import_order_id) {
    const { count } = await supabase.from('diaspora_trade_documents').select('*', { count: 'exact', head: true }).eq('import_order_id', data.import_order_id).neq('verification_status', DOCUMENT_STATUSES.VERIFIED).is('deleted_at', null);
    if (count === 0) {
      try {
        await transitionImportOrder({ importOrderId: data.import_order_id, nextStatus: IMPORT_ORDER_STATUSES.DOCUMENTS_VERIFIED, actorId: userContext?.id, userContext, metadata: { documentId: id }, req });
      } catch (err) {
        console.warn('Skipping automatic DOCUMENTS_VERIFIED transition:', err.message);
      }
    }
  }
  return data;
}

export async function rejectTradeDocument(id, payload = {}, userContext = {}, req = null) {
  const previous = await getTradeDocument(id, userContext);
  const { data, error } = await supabase
    .from('diaspora_trade_documents')
    .update({ verification_status: DOCUMENT_STATUSES.REJECTED, reviewed_by: userContext?.id, reviewed_at: new Date().toISOString(), updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), rejection: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await supabase.from('diaspora_trade_document_verifications').insert({ trade_document_id: id, tenant_id: data.tenant_id, verification_status: DOCUMENT_STATUSES.REJECTED, verified_by: userContext?.id, verified_at: new Date().toISOString(), notes: payload.reason || payload.notes || null, metadata: payload.metadata || {} });
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_DOCUMENT_REJECTED', resourceType: 'diaspora_trade_document', resourceId: id, previousState: previous, newState: data, req });
  return data;
}
