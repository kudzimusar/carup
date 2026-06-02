import { supabase } from '../../db/supabase.js';
import { DOCUMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { DatabaseError, NotFoundError } from '../../utils/errors.js';
import { validateTradeDocumentPayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder } from './diasporaWorkflowService.js';
import { notifyDiasporaMilestone } from './diasporaNotificationService.js';

async function getOrder(importOrderId) {
  const { data, error } = await supabase.from('diaspora_import_orders').select('*').eq('id', importOrderId).single();
  if (error || !data) throw new NotFoundError('Diaspora import order not found');
  return data;
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
      await transitionImportOrder({ importOrderId: order.id, nextStatus: IMPORT_ORDER_STATUSES.DOCUMENTS_PENDING, actorId: userContext?.id, metadata: { documentId: data.id }, req });
    } catch (err) {
      console.warn('Skipping automatic DOCUMENTS_PENDING transition:', err.message);
    }
  }

  await notifyDiasporaMilestone({ eventType: 'DIASPORA_DOCUMENT_UPLOADED', importOrder: order || data, actorId: userContext?.id, title: 'Trade document uploaded', message: 'A diaspora trade document has been uploaded for review.', metadata: { documentId: data.id, documentType: data.document_type } });
  return data;
}

export async function listTradeDocuments({ importOrderId, verificationStatus, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_trade_documents').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (verificationStatus) query = query.eq('verification_status', verificationStatus);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getTradeDocument(id) {
  const { data, error } = await supabase.from('diaspora_trade_documents').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora trade document not found');
  return data;
}

export async function recordDocumentExtraction(documentId, payload, userContext = {}, req = null) {
  const doc = await getTradeDocument(documentId);
  const { data, error } = await supabase
    .from('diaspora_trade_document_extractions')
    .insert({
      trade_document_id: documentId,
      tenant_id: doc.tenant_id,
      extraction_provider: payload.extraction_provider || 'carup_ocr',
      extracted_fields: payload.extracted_fields || {},
      confidence_score: payload.confidence_score || 0,
      raw_response: payload.raw_response || {},
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
  const previous = await getTradeDocument(id);
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
        await transitionImportOrder({ importOrderId: data.import_order_id, nextStatus: IMPORT_ORDER_STATUSES.DOCUMENTS_VERIFIED, actorId: userContext?.id, metadata: { documentId: id }, req });
      } catch (err) {
        console.warn('Skipping automatic DOCUMENTS_VERIFIED transition:', err.message);
      }
    }
  }
  return data;
}

export async function rejectTradeDocument(id, payload = {}, userContext = {}, req = null) {
  const previous = await getTradeDocument(id);
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
